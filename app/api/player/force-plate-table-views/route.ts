import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { getDbPool } from '../../../../lib/auth-db';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';

type ViewType = 'athlete' | 'leaderboard';

declare global {
  var __forcePlateTableViewsReady: boolean | undefined;
  var __forcePlateTableViewLabelsReady: boolean | undefined;
}

async function ensureSchema() {
  if (global.__forcePlateTableViewsReady && global.__forcePlateTableViewLabelsReady) return;
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS force_plate_table_views (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      view_type TEXT NOT NULL CHECK (view_type IN ('athlete', 'leaderboard')),
      name TEXT NOT NULL,
      columns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      labels_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by_user_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_force_plate_table_views_unique
      ON force_plate_table_views (organization_id, school_code, view_type, LOWER(name));
    CREATE INDEX IF NOT EXISTS idx_force_plate_table_views_scope
      ON force_plate_table_views (organization_id, school_code, view_type, updated_at DESC);
  `);
  await getDbPool().query(`ALTER TABLE force_plate_table_views ADD COLUMN IF NOT EXISTS labels_json JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  global.__forcePlateTableViewsReady = true;
  global.__forcePlateTableViewLabelsReady = true;
}

function normalizeColumns(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean))).slice(0, 40);
}

function normalizeLabels(input: unknown, columns: string[]): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const allowed = new Set(columns);
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!allowed.has(key) || typeof value !== 'string') continue;
    const label = value.trim().replace(/\s+/g, ' ').slice(0, 48);
    if (label) labels[key] = label;
  }
  return labels;
}

function normalizeType(input: unknown): ViewType | null {
  return input === 'athlete' || input === 'leaderboard' ? input : null;
}

async function context() {
  const session = getSessionFromCookies(await cookies());
  if (!session) return null;
  if (!(await canUseProgrammingData(session)) || resolveProgrammingSchoolCode(session) !== 'PCU') return null;
  return {
    session,
    organizationId: await resolveProgrammingOrganizationId(session),
    schoolCode: 'PCU',
  };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureSchema();
  const result = await getDbPool().query<{
    id: number;
    view_type: ViewType;
    name: string;
    columns_json: unknown;
    labels_json: unknown;
  }>(
    `SELECT id, view_type, name, columns_json, labels_json
     FROM force_plate_table_views
     WHERE organization_id = $1 AND school_code = $2
     ORDER BY view_type, updated_at DESC, name`,
    [ctx.organizationId, ctx.schoolCode]
  );
  return NextResponse.json({
    items: result.rows.map((row) => {
      const columns = normalizeColumns(row.columns_json);
      return {
        id: Number(row.id),
        viewType: row.view_type,
        name: row.name,
        columns,
        columnLabels: normalizeLabels(row.labels_json, columns),
      };
    }),
  });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.session.role === 'player') return NextResponse.json({ error: 'Only coaches and admins can save shared views.' }, { status: 403 });
  await ensureSchema();
  const body = (await request.json().catch(() => null)) as { id?: unknown; viewType?: unknown; name?: unknown; columns?: unknown; columnLabels?: unknown } | null;
  const id = Number(body?.id ?? 0);
  const viewType = normalizeType(body?.viewType);
  const name = String(body?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const columns = normalizeColumns(body?.columns);
  const columnLabels = normalizeLabels(body?.columnLabels, columns);
  if (!viewType || !name || !columns.length) {
    return NextResponse.json({ error: 'A view name and at least one column are required.' }, { status: 400 });
  }
  try {
    const result = id > 0
      ? await getDbPool().query<{ id: number; view_type: ViewType; name: string; columns_json: unknown; labels_json: unknown }>(
          `UPDATE force_plate_table_views
           SET name = $5, columns_json = $6::jsonb, labels_json = $7::jsonb, updated_at = NOW()
           WHERE id = $1 AND organization_id = $2 AND school_code = $3 AND view_type = $4
           RETURNING id, view_type, name, columns_json, labels_json`,
          [id, ctx.organizationId, ctx.schoolCode, viewType, name, JSON.stringify(columns), JSON.stringify(columnLabels)]
        )
      : await getDbPool().query<{ id: number; view_type: ViewType; name: string; columns_json: unknown; labels_json: unknown }>(
          `INSERT INTO force_plate_table_views (organization_id, school_code, view_type, name, columns_json, labels_json, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
           RETURNING id, view_type, name, columns_json, labels_json`,
          [ctx.organizationId, ctx.schoolCode, viewType, name, JSON.stringify(columns), JSON.stringify(columnLabels), ctx.session.userId ?? null]
        );
    const row = result.rows[0];
    if (!row) return NextResponse.json({ error: 'Saved view was not found.' }, { status: 404 });
    const savedColumns = normalizeColumns(row.columns_json);
    return NextResponse.json({
      item: {
        id: Number(row.id),
        viewType: row.view_type,
        name: row.name,
        columns: savedColumns,
        columnLabels: normalizeLabels(row.labels_json, savedColumns),
      },
    });
  } catch (error) {
    const message = error instanceof Error && error.message.includes('idx_force_plate_table_views_unique')
      ? 'A saved view with that name already exists.'
      : error instanceof Error ? error.message : 'Could not save the view.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.session.role === 'player') return NextResponse.json({ error: 'Only coaches and admins can delete shared views.' }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get('id') ?? 0);
  if (!(id > 0)) return NextResponse.json({ error: 'View id is required.' }, { status: 400 });
  await ensureSchema();
  const result = await getDbPool().query(
    `DELETE FROM force_plate_table_views WHERE id = $1 AND organization_id = $2 AND school_code = $3`,
    [id, ctx.organizationId, ctx.schoolCode]
  );
  return NextResponse.json({ ok: (result.rowCount ?? 0) > 0 });
}

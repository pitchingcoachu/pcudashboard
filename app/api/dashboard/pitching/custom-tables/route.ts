import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveSchoolScopedOrganizationId } from '../../../../../lib/programming-scope';
import { ensureTrainingDbReady } from '../../../../../lib/training-db';
import { getDbPool } from '../../../../../lib/auth-db';
import type { PortalSession } from '../../../../../lib/portal-session';
import type { Pool } from 'pg';

const ALLOWED_CUSTOM_COLUMNS = new Set([
  '#',
  'Usage',
  'Overall',
  'BF',
  'Velo',
  'Max',
  'IVB',
  'HB',
  'Spin',
  'rTilt',
  'bTilt',
  'SpinEff',
  'Height',
  'Side',
  'Ext',
  'VAA',
  'HAA',
  'Strike%',
  'Swing%',
  'FPS%',
  'Early%',
  'Ahead%',
  'E+A%',
  '1-1W%',
  'InZone%',
  'Comp%',
  'QP%',
  'Whiff%',
  'K%',
  'BB%',
  'GB%',
  'Barrel%',
  'CSW%',
  'EV',
  'LA',
  'Stuff+',
  'Ctrl+',
  'QP+',
  'Pitching+',
  'RV/100',
  'ERA',
  'FIP',
  'xFIP',
  'IP',
  'P',
  'P/IP',
  'P/BF',
  'H',
  'XBH',
  'Barrels',
  'BB',
  'HBP',
  'K',
  'Whiffs',
  '0-0',
  'Behind',
  'Even',
  'Ahead',
  '<2K',
  '2K',
  'PA',
  'AB',
  'AVG',
  'SLG',
  'OBP',
  'OPS',
  'wOBA',
  'xWOBA',
  'ISO',
  'xISO',
  'BABIP',
  'Called-S%',
  'Take%',
  'Chase%',
  'GoZoneSw%',
  'IZswing%',
  'EdgeSwing%',
  'PosSD%',
  'Swings',
  'Takes',
  'Called-S',
  'Chases',
  'IZswings',
  'FPS',
  'EdgeSwings',
  'PosSD',
  'GoZoneSw',
]);

function normalizeColumns(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of input) {
    if (typeof value !== 'string') continue;
    const col = value.trim();
    if (!col || !ALLOWED_CUSTOM_COLUMNS.has(col) || seen.has(col)) continue;
    seen.add(col);
    deduped.push(col);
  }
  return deduped;
}

async function getSession(): Promise<PortalSession | null> {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return null;
  const role: PortalSession['role'] =
    session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin';
  return {
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role,
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  };
}

async function ensureDashboardCustomTableSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_custom_tables (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      school_code TEXT NOT NULL,
      name TEXT NOT NULL,
      columns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_custom_tables_org_school_name ON dashboard_custom_tables (organization_id, school_code, lower(name));`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_dashboard_custom_tables_org_school_updated ON dashboard_custom_tables (organization_id, school_code, updated_at DESC);`
  );
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureTrainingDbReady();
  const schoolCode = resolveDashboardSchoolCode(session);
  const scopedOrganizationIdResolved = resolveSchoolScopedOrganizationId(session);
  const scopedOrganizationId =
    Number.isFinite(scopedOrganizationIdResolved) && scopedOrganizationIdResolved > 0
      ? scopedOrganizationIdResolved
      : Number(session.organizationId ?? 0);
  if (!Number.isFinite(scopedOrganizationId) || scopedOrganizationId <= 0) {
    return NextResponse.json({ error: 'No valid organization scope for custom tables.' }, { status: 400 });
  }
  const pool = getDbPool();
  try {
    await ensureDashboardCustomTableSchema(pool);
    const result = await pool.query<{
      id: number;
      name: string;
      columns_json: unknown;
      created_at: string;
      updated_at: string;
    }>(
      `
      SELECT id, name, columns_json, created_at, updated_at
      FROM dashboard_custom_tables
      WHERE organization_id = $1 AND school_code = $2
      ORDER BY updated_at DESC, id DESC
      `,
      [scopedOrganizationId, schoolCode]
    );
    return NextResponse.json({
      items: result.rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        columns: normalizeColumns(row.columns_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load custom tables.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureTrainingDbReady();
  const schoolCode = resolveDashboardSchoolCode(session);
  const scopedOrganizationIdResolved = resolveSchoolScopedOrganizationId(session);
  const scopedOrganizationId =
    Number.isFinite(scopedOrganizationIdResolved) && scopedOrganizationIdResolved > 0
      ? scopedOrganizationIdResolved
      : Number(session.organizationId ?? 0);
  if (!Number.isFinite(scopedOrganizationId) || scopedOrganizationId <= 0) {
    return NextResponse.json({ error: 'No valid organization scope for custom tables.' }, { status: 400 });
  }
  const pool = getDbPool();
  try {
    await ensureDashboardCustomTableSchema(pool);
    const body = (await request.json().catch(() => ({}))) as {
      id?: number;
      name?: string;
      columns?: unknown;
    };
    const id = Number(body.id);
    const name = String(body.name ?? '').trim();
    const columns = normalizeColumns(body.columns);
    if (!name) return NextResponse.json({ error: 'Table name is required.' }, { status: 400 });
    const payload = JSON.stringify(columns);

    let saved;
    if (Number.isFinite(id) && id > 0) {
      saved = await pool.query<{
        id: number;
        name: string;
        columns_json: unknown;
        created_at: string;
        updated_at: string;
      }>(
        `
        UPDATE dashboard_custom_tables
           SET name = $4,
               columns_json = $5::jsonb,
               updated_at = NOW()
         WHERE id = $3
           AND organization_id = $1
           AND school_code = $2
         RETURNING id, name, columns_json, created_at, updated_at
        `,
        [scopedOrganizationId, schoolCode, id, name, payload]
      );
      if (!saved.rowCount) {
        return NextResponse.json({ error: 'Custom table not found.' }, { status: 404 });
      }
    } else {
      saved = await pool.query<{
        id: number;
        name: string;
        columns_json: unknown;
        created_at: string;
        updated_at: string;
      }>(
        `
        WITH existing AS (
          SELECT id
          FROM dashboard_custom_tables
          WHERE organization_id = $1
            AND school_code = $2
            AND lower(name) = lower($3)
          LIMIT 1
        ),
        updated AS (
          UPDATE dashboard_custom_tables d
             SET columns_json = $4::jsonb,
                 name = $3,
                 updated_at = NOW()
           WHERE d.id IN (SELECT id FROM existing)
           RETURNING d.id, d.name, d.columns_json, d.created_at, d.updated_at
        ),
        inserted AS (
          INSERT INTO dashboard_custom_tables (
            organization_id, school_code, name, columns_json, created_by_user_id
          )
          SELECT $1, $2, $3, $4::jsonb, $5
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          RETURNING id, name, columns_json, created_at, updated_at
        )
        SELECT id, name, columns_json, created_at, updated_at FROM updated
        UNION ALL
        SELECT id, name, columns_json, created_at, updated_at FROM inserted
        `,
        [scopedOrganizationId, schoolCode, name, payload, session.userId || null]
      );
    }

    const row = saved.rows[0];
    return NextResponse.json({
      item: {
        id: Number(row.id),
        name: row.name,
        columns: normalizeColumns(row.columns_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save custom table.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureTrainingDbReady();
  const schoolCode = resolveDashboardSchoolCode(session);
  const scopedOrganizationIdResolved = resolveSchoolScopedOrganizationId(session);
  const scopedOrganizationId =
    Number.isFinite(scopedOrganizationIdResolved) && scopedOrganizationIdResolved > 0
      ? scopedOrganizationIdResolved
      : Number(session.organizationId ?? 0);
  if (!Number.isFinite(scopedOrganizationId) || scopedOrganizationId <= 0) {
    return NextResponse.json({ error: 'No valid organization scope for custom tables.' }, { status: 400 });
  }
  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Valid id is required.' }, { status: 400 });
  }
  const pool = getDbPool();
  try {
    await ensureDashboardCustomTableSchema(pool);
    const result = await pool.query(
      `
      DELETE FROM dashboard_custom_tables
      WHERE id = $1
        AND organization_id = $2
        AND school_code = $3
      `,
      [id, scopedOrganizationId, schoolCode]
    );
    return NextResponse.json({ ok: (result.rowCount ?? 0) > 0 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete custom table.' },
      { status: 500 }
    );
  }
}

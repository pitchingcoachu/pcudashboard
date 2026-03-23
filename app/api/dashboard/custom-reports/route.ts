import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { resolveSchoolScopedOrganizationId } from '../../../../lib/programming-scope';
import { ensureTrainingDbReady } from '../../../../lib/training-db';
import { getDbPool, listActiveStaffOrganizationIdsByEmail } from '../../../../lib/auth-db';
import type { PortalSession } from '../../../../lib/portal-session';
import type { Pool } from 'pg';

type ReportPayload = {
  id?: number;
  name?: string;
  payload?: unknown;
  applyToAllSchools?: boolean;
};

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

async function ensureDashboardCustomReportsSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Prevent concurrent schema-creation races that can throw pg_class_relname_nsp_index.
    await client.query(`SELECT pg_advisory_xact_lock(77431102512031);`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS dashboard_custom_reports (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        school_code TEXT NOT NULL,
        applies_to_all_schools BOOLEAN NOT NULL DEFAULT FALSE,
        name TEXT NOT NULL,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE dashboard_custom_reports ADD COLUMN IF NOT EXISTS applies_to_all_schools BOOLEAN NOT NULL DEFAULT FALSE;`);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_custom_reports_org_school_scope_name ON dashboard_custom_reports (organization_id, school_code, applies_to_all_schools, lower(name));`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_dashboard_custom_reports_org_school_updated ON dashboard_custom_reports (organization_id, school_code, updated_at DESC);`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_dashboard_custom_reports_org_global_updated ON dashboard_custom_reports (organization_id, applies_to_all_schools, updated_at DESC);`
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureTrainingDbReady();
  const schoolCode = resolveDashboardSchoolCode(session);
  const scopedOrganizationId = resolveSchoolScopedOrganizationId(session);
  const accessibleOrgIdsRaw =
    session.role === 'admin' || session.role === 'coach'
      ? await listActiveStaffOrganizationIdsByEmail(session.email)
      : [];
  const accessibleOrgIds = Array.from(
    new Set([scopedOrganizationId, ...accessibleOrgIdsRaw].filter((id) => Number.isFinite(id) && id > 0))
  );
  const broadenSchoolScope = session.role === 'admin' || session.role === 'coach';
  const pool = getDbPool();
  try {
    await ensureDashboardCustomReportsSchema(pool);
    const result = await pool.query<{
      id: number;
      name: string;
      applies_to_all_schools: boolean;
      payload_json: unknown;
      created_at: string;
      updated_at: string;
    }>(
      `
      SELECT id, name, applies_to_all_schools, payload_json, created_at, updated_at
      FROM dashboard_custom_reports
      WHERE ((school_code = $2) AND (organization_id = $1 OR organization_id = ANY($3::int[]) OR $4::boolean))
         OR (applies_to_all_schools = TRUE AND (organization_id = ANY($3::int[]) OR $4::boolean))
      ORDER BY updated_at DESC, id DESC
      `,
      [scopedOrganizationId, schoolCode, accessibleOrgIds, broadenSchoolScope]
    );
    return NextResponse.json({
      items: result.rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        applyToAllSchools: Boolean(row.applies_to_all_schools),
        payload: row.payload_json ?? {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load custom reports.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureTrainingDbReady();
  const schoolCode = resolveDashboardSchoolCode(session);
  const scopedOrganizationId = resolveSchoolScopedOrganizationId(session);
  const accessibleOrgIdsRaw =
    session.role === 'admin' || session.role === 'coach'
      ? await listActiveStaffOrganizationIdsByEmail(session.email)
      : [];
  const editableOrgIds = Array.from(
    new Set([scopedOrganizationId, ...accessibleOrgIdsRaw].filter((id) => Number.isFinite(id) && id > 0))
  );
  const pool = getDbPool();
  try {
    await ensureDashboardCustomReportsSchema(pool);
    const body = (await request.json().catch(() => ({}))) as ReportPayload;
    const id = Number(body.id);
    const name = String(body.name ?? '').trim();
    const payload = body.payload ?? {};
    const applyToAllSchools = session.role === 'admin' ? Boolean(body.applyToAllSchools) : false;
    if (!name) return NextResponse.json({ error: 'Report name is required.' }, { status: 400 });

    let saved;
    if (Number.isFinite(id) && id > 0) {
      saved = await pool.query<{
        id: number;
        name: string;
        applies_to_all_schools: boolean;
        payload_json: unknown;
        created_at: string;
        updated_at: string;
      }>(
        `
        UPDATE dashboard_custom_reports
           SET name = $3,
               applies_to_all_schools = $5,
               payload_json = $4::jsonb,
               updated_at = NOW()
         WHERE id = $2
           AND organization_id = ANY($6::int[])
         RETURNING id, name, applies_to_all_schools, payload_json, created_at, updated_at
        `,
        [scopedOrganizationId, id, name, JSON.stringify(payload), applyToAllSchools, editableOrgIds]
      );
      if (!saved.rowCount) {
        return NextResponse.json({ error: 'Custom report not found.' }, { status: 404 });
      }
    } else {
      saved = await pool.query<{
        id: number;
        name: string;
        applies_to_all_schools: boolean;
        payload_json: unknown;
        created_at: string;
        updated_at: string;
      }>(
        `
        WITH existing AS (
          SELECT id
          FROM dashboard_custom_reports
          WHERE organization_id = $1
            AND school_code = $2
            AND applies_to_all_schools = $6
            AND lower(name) = lower($3)
          LIMIT 1
        ),
        updated AS (
          UPDATE dashboard_custom_reports d
             SET payload_json = $4::jsonb,
                 name = $3,
                 applies_to_all_schools = $6,
                 updated_at = NOW()
           WHERE d.id IN (SELECT id FROM existing)
           RETURNING d.id, d.name, d.applies_to_all_schools, d.payload_json, d.created_at, d.updated_at
        ),
        inserted AS (
          INSERT INTO dashboard_custom_reports (
            organization_id, school_code, applies_to_all_schools, name, payload_json, created_by_user_id
          )
          SELECT $1, $2, $6, $3, $4::jsonb, $5
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          RETURNING id, name, applies_to_all_schools, payload_json, created_at, updated_at
        )
        SELECT * FROM updated
        UNION ALL
        SELECT * FROM inserted
        LIMIT 1
        `,
        [scopedOrganizationId, schoolCode, name, JSON.stringify(payload), session.userId ?? null, applyToAllSchools]
      );
    }

    const row = saved.rows[0];
    return NextResponse.json({
      item: {
        id: Number(row.id),
        name: row.name,
        applyToAllSchools: Boolean(row.applies_to_all_schools),
        payload: row.payload_json ?? {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save custom report.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureTrainingDbReady();
  const schoolCode = resolveDashboardSchoolCode(session);
  const scopedOrganizationId = resolveSchoolScopedOrganizationId(session);
  const accessibleOrgIdsRaw =
    session.role === 'admin' || session.role === 'coach'
      ? await listActiveStaffOrganizationIdsByEmail(session.email)
      : [];
  const editableOrgIds = Array.from(
    new Set([scopedOrganizationId, ...accessibleOrgIdsRaw].filter((id) => Number.isFinite(id) && id > 0))
  );
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Report id is required.' }, { status: 400 });
  }

  try {
    const pool = getDbPool();
    await ensureDashboardCustomReportsSchema(pool);
    const deleted = await pool.query(
      `
      DELETE FROM dashboard_custom_reports
      WHERE id = $1
        AND organization_id = ANY($2::int[])
      `,
      [id, editableOrgIds]
    );
    if (!deleted.rowCount) {
      return NextResponse.json({ error: 'Custom report not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete custom report.' },
      { status: 500 }
    );
  }
}

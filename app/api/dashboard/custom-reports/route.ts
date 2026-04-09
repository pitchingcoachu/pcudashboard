import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { resolveSchoolScopedOrganizationId } from '../../../../lib/programming-scope';
import { getDbPool, listActiveStaffOrganizationIdsByEmail } from '../../../../lib/auth-db';
import type { PortalSession } from '../../../../lib/portal-session';
import type { Pool } from 'pg';

type ReportPayload = {
  id?: number;
  name?: string;
  payload?: unknown;
  applyToAllSchools?: boolean;
};

function normalizedReportNameKey(name: string): string {
  return name
    .trim()
    .replace(/\s*\(all schools\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function parseOrgSchoolMap(raw: string): Record<number, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<number, string> = {};
    for (const [orgIdRaw, schoolRaw] of Object.entries(parsed)) {
      const orgId = Number(orgIdRaw);
      const schoolCode = typeof schoolRaw === 'string' ? String(schoolRaw).trim().toUpperCase() : '';
      if (!Number.isFinite(orgId) || orgId <= 0 || !schoolCode) continue;
      out[orgId] = schoolCode;
    }
    return out;
  } catch {
    return {};
  }
}

function parseGlobalAdminEmails(): string[] {
  const raw = String(
    process.env.GLOBAL_ADMIN_EMAILS ??
      'jgaynor@pitchingcoachu.com,ahalverson@pitchingcoachu.com,jchipman@pitchingcoachu.com'
  );
  const values = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function isGlobalAdminSession(session: PortalSession): boolean {
  if (session.role !== 'admin') return false;
  if (process.env.NODE_ENV !== 'production') return true;
  const email = String(session.email ?? '').trim().toLowerCase();
  if (!email) return false;
  return parseGlobalAdminEmails().includes(email);
}

declare global {
  var __dashboardCustomReportsSchemaReady: boolean | undefined;
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

async function resolveCustomReportOrganizationScope(
  session: PortalSession,
  schoolCode: string
): Promise<{ primaryOrganizationId: number; organizationIds: number[] }> {
  const selectedSchool = String(schoolCode ?? '').trim().toUpperCase();
  const sessionOrgId = Number(session.organizationId ?? 0);
  const scopedOrganizationIdResolved = resolveSchoolScopedOrganizationId(session);
  const scopedOrganizationId =
    Number.isFinite(scopedOrganizationIdResolved) && scopedOrganizationIdResolved > 0
      ? scopedOrganizationIdResolved
      : sessionOrgId;
  const map = parseOrgSchoolMap(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}');
  const mappedOrgIds = Object.entries(map)
    .filter(([, mappedSchoolCode]) => mappedSchoolCode === selectedSchool)
    .map(([orgId]) => Number(orgId))
    .filter((orgId) => Number.isFinite(orgId) && orgId > 0);
  const orgSet = new Set<number>();
  if (Number.isFinite(scopedOrganizationId) && scopedOrganizationId > 0) orgSet.add(scopedOrganizationId);
  if (Number.isFinite(sessionOrgId) && sessionOrgId > 0) orgSet.add(sessionOrgId);
  for (const orgId of mappedOrgIds) orgSet.add(orgId);
  const organizationIds = Array.from(orgSet);
  const primaryOrganizationId =
    Number.isFinite(scopedOrganizationId) && scopedOrganizationId > 0
      ? scopedOrganizationId
      : Number.isFinite(sessionOrgId) && sessionOrgId > 0
        ? sessionOrgId
        : 0;

  // Keep PRO custom reports anchored to the signed-in org for all roles.
  // This prevents "missing report" behavior when school->org mapping changes.
  if (selectedSchool === 'PRO' && Number.isFinite(sessionOrgId) && sessionOrgId > 0) {
    const staffOrgIds =
      session.role === 'admin' || session.role === 'coach'
        ? await listActiveStaffOrganizationIdsByEmail(session.email).catch(() => [])
        : [];
    return {
      primaryOrganizationId: sessionOrgId,
      organizationIds: Array.from(new Set([sessionOrgId, ...mappedOrgIds, ...staffOrgIds])),
    };
  }
  const staffOrgIds =
    session.role === 'admin' || session.role === 'coach'
      ? await listActiveStaffOrganizationIdsByEmail(session.email).catch(() => [])
      : [];
  return { primaryOrganizationId, organizationIds: Array.from(new Set([...organizationIds, ...staffOrgIds])) };
}

async function ensureDashboardCustomReportsSchema(pool: Pool): Promise<void> {
  if (global.__dashboardCustomReportsSchemaReady) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '3s';`);
    await client.query(`SET LOCAL statement_timeout = '30s';`);
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
    global.__dashboardCustomReportsSchemaReady = true;
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
  const schoolCode = resolveDashboardSchoolCode(session);
  const { organizationIds } = await resolveCustomReportOrganizationScope(session, schoolCode);
  const isGlobalAdmin = isGlobalAdminSession(session);
  const userId = Number(session.userId ?? 0);
  const hasUserScope = Number.isFinite(userId) && userId > 0;
  if (!organizationIds.length && !isGlobalAdmin) {
    return NextResponse.json({ error: 'No valid organization scope for custom reports.' }, { status: 400 });
  }
  const pool = getDbPool();
  try {
    await ensureDashboardCustomReportsSchema(pool);
    const result = await pool.query<{
      id: number;
      name: string;
      applies_to_all_schools: boolean;
      school_code: string;
      payload_json: unknown;
      created_at: string;
      updated_at: string;
    }>(
      `
      SELECT id, name, applies_to_all_schools, school_code, payload_json, created_at, updated_at
      FROM dashboard_custom_reports
      WHERE (
        (($5::boolean OR organization_id = ANY($1::int[])) AND (school_code = $2 OR applies_to_all_schools = TRUE))
        OR ($3::boolean AND created_by_user_id = $4)
      )
      ORDER BY updated_at DESC, id DESC
      `,
      [organizationIds, schoolCode, hasUserScope, userId, isGlobalAdmin]
    );
    let rows = result.rows;
    if (!rows.length) {
      const fallback = await pool.query<{
        id: number;
        name: string;
        applies_to_all_schools: boolean;
        school_code: string;
        payload_json: unknown;
        created_at: string;
        updated_at: string;
      }>(
        `
        SELECT id, name, applies_to_all_schools, school_code, payload_json, created_at, updated_at
        FROM dashboard_custom_reports
        WHERE $4::boolean OR organization_id = ANY($1::int[]) OR ($2::boolean AND created_by_user_id = $3)
        ORDER BY updated_at DESC, id DESC
        `,
        [organizationIds, hasUserScope, userId, isGlobalAdmin]
      );
      rows = fallback.rows;
    }

    // Collapse duplicate names (e.g., school-scoped + all-schools copy).
    // Prefer school-specific rows for the selected school over global copies.
    const deduped = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = normalizedReportNameKey(row.name);
      const current = deduped.get(key);
      if (!current) {
        deduped.set(key, row);
        continue;
      }
      const rowIsSchoolSpecific = !row.applies_to_all_schools && String(row.school_code || '').toUpperCase() === schoolCode;
      const currentIsSchoolSpecific =
        !current.applies_to_all_schools && String(current.school_code || '').toUpperCase() === schoolCode;
      if (rowIsSchoolSpecific && !currentIsSchoolSpecific) {
        deduped.set(key, row);
        continue;
      }
      if (rowIsSchoolSpecific === currentIsSchoolSpecific) {
        const rowLooksCanonical = !/\(all schools\)\s*$/i.test(row.name);
        const currentLooksCanonical = !/\(all schools\)\s*$/i.test(current.name);
        if (rowLooksCanonical && !currentLooksCanonical) {
          deduped.set(key, row);
        }
      }
    }
    rows = Array.from(deduped.values());

    return NextResponse.json({
      items: rows.map((row) => ({
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
  const schoolCode = resolveDashboardSchoolCode(session);
  const { primaryOrganizationId, organizationIds } = await resolveCustomReportOrganizationScope(session, schoolCode);
  const isGlobalAdmin = isGlobalAdminSession(session);
  const userId = Number(session.userId ?? 0);
  const hasUserScope = Number.isFinite(userId) && userId > 0;
  if (
    !Number.isFinite(primaryOrganizationId) ||
    primaryOrganizationId <= 0 ||
    (!organizationIds.length && !isGlobalAdmin)
  ) {
    return NextResponse.json({ error: 'No valid organization scope for custom reports.' }, { status: 400 });
  }
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
           AND ($8::boolean OR organization_id = ANY($1::int[]) OR ($6::boolean AND created_by_user_id = $7))
         RETURNING id, name, applies_to_all_schools, payload_json, created_at, updated_at
        `,
        [organizationIds, id, name, JSON.stringify(payload), applyToAllSchools, hasUserScope, userId, isGlobalAdmin]
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
          WHERE ($10::boolean OR organization_id = ANY($1::int[]) OR ($7::boolean AND created_by_user_id = $8))
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
          SELECT $9, $2, $6, $3, $4::jsonb, $5
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          RETURNING id, name, applies_to_all_schools, payload_json, created_at, updated_at
        )
        SELECT * FROM updated
        UNION ALL
        SELECT * FROM inserted
        LIMIT 1
        `,
        [
          organizationIds,
          schoolCode,
          name,
          JSON.stringify(payload),
          session.userId ?? null,
          applyToAllSchools,
          hasUserScope,
          userId,
          primaryOrganizationId,
          isGlobalAdmin,
        ]
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
  const schoolCode = resolveDashboardSchoolCode(session);
  const { organizationIds } = await resolveCustomReportOrganizationScope(session, schoolCode);
  const isGlobalAdmin = isGlobalAdminSession(session);
  const userId = Number(session.userId ?? 0);
  const hasUserScope = Number.isFinite(userId) && userId > 0;
  if (!organizationIds.length && !isGlobalAdmin) {
    return NextResponse.json({ error: 'No valid organization scope for custom reports.' }, { status: 400 });
  }
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Report id is required.' }, { status: 400 });
  }

  try {
    const pool = getDbPool();
    await ensureDashboardCustomReportsSchema(pool);
    const protectedCheck = await pool.query<{ name: string }>(
      `
      SELECT name
      FROM dashboard_custom_reports
      WHERE id = $1
        AND ($5::boolean OR organization_id = ANY($2::int[]) OR ($3::boolean AND created_by_user_id = $4))
      LIMIT 1
      `,
      [id, organizationIds, hasUserScope, userId, isGlobalAdmin]
    );
    const existingName = String(protectedCheck.rows[0]?.name ?? '').trim();
    if (normalizedReportNameKey(existingName) === normalizedReportNameKey("Jared's Dashboard")) {
      return NextResponse.json({ error: "Jared's Dashboard is protected and cannot be deleted." }, { status: 400 });
    }
    const deleted = await pool.query(
      `
      DELETE FROM dashboard_custom_reports
      WHERE id = $1
        AND ($5::boolean OR organization_id = ANY($2::int[]) OR ($3::boolean AND created_by_user_id = $4))
      `,
      [id, organizationIds, hasUserScope, userId, isGlobalAdmin]
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

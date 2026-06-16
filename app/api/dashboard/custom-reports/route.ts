import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { resolveSchoolScopedOrganizationId } from '../../../../lib/programming-scope';
import { ensureAuthDbReady, getDbPool, listActiveStaffOrganizationIdsByEmail } from '../../../../lib/auth-db';
import type { PortalSession } from '../../../../lib/portal-session';
import type { Pool } from 'pg';

type ReportPayload = {
  id?: number;
  name?: string;
  payload?: unknown;
  applyToAllSchools?: boolean;
};

const PERMANENT_REPORT_EXACT_KEYS = new Set([
  'pitch value and locations',
  'know yourself page',
  'pitching summary report',
  'bullpen summary report',
]);

function normalizedReportNameKey(name: string): string {
  return name
    .trim()
    .replace(/\s*\(all schools\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isPermanentGlobalReportName(name: string): boolean {
  const key = normalizedReportNameKey(name);
  if (PERMANENT_REPORT_EXACT_KEYS.has(key)) return true;
  // Covers:
  // - Advance vs. RHP (Whiff)
  // - Advance vs. LHP (PV/100)
  // - Advance Report vs. RHP
  return /^advance\s+(report\s+)?vs\.\s*(rhp|lhp)\b/i.test(key);
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
  const base = [
    'jgaynor@pitchingcoachu.com',
    'sethconner12@gmail.com',
    'ahalverson@pitchingcoachu.com',
    'jchipman@pitchingcoachu.com',
    'patrick.jones@rosterpilot.com',
    'corralf34@gmail.com',
    'jgarza@pitchingcoachu.com',
  ];
  const values = [...base, ...String(process.env.GLOBAL_ADMIN_EMAILS ?? '').split(',')]
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

async function resolveAuthIdentityFallback(
  session: PortalSession
): Promise<{ fallbackUserId: number; fallbackUserIds: number[]; fallbackOrgIds: number[] }> {
  const email = String(session.email ?? '').trim().toLowerCase();
  if (!email) return { fallbackUserId: 0, fallbackUserIds: [], fallbackOrgIds: [] };
  try {
    await ensureAuthDbReady();
    const pool = getDbPool();
    const result = await pool.query<{ id: number | null; organization_id: number | null }>(
      `
      SELECT id, organization_id
      FROM auth_users
      WHERE LOWER(email) = LOWER($1)
        AND COALESCE(is_active, TRUE) = TRUE
      ORDER BY id DESC
      `,
      [email]
    );
    let fallbackUserId = 0;
    const fallbackUserSet = new Set<number>();
    const fallbackOrgSet = new Set<number>();
    for (const row of result.rows) {
      const uid = Number(row.id ?? 0);
      if (uid > 0 && fallbackUserId <= 0) fallbackUserId = uid;
      if (uid > 0) fallbackUserSet.add(uid);
      const orgId = Number(row.organization_id ?? 0);
      if (orgId > 0) fallbackOrgSet.add(orgId);
    }
    return {
      fallbackUserId,
      fallbackUserIds: Array.from(fallbackUserSet),
      fallbackOrgIds: Array.from(fallbackOrgSet),
    };
  } catch {
    return { fallbackUserId: 0, fallbackUserIds: [], fallbackOrgIds: [] };
  }
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
        created_by_email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE dashboard_custom_reports ADD COLUMN IF NOT EXISTS applies_to_all_schools BOOLEAN NOT NULL DEFAULT FALSE;`);
    await client.query(`ALTER TABLE dashboard_custom_reports ADD COLUMN IF NOT EXISTS created_by_email TEXT;`);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_custom_reports_org_school_scope_name ON dashboard_custom_reports (organization_id, school_code, applies_to_all_schools, lower(name));`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_dashboard_custom_reports_org_school_updated ON dashboard_custom_reports (organization_id, school_code, updated_at DESC);`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_dashboard_custom_reports_org_global_updated ON dashboard_custom_reports (organization_id, applies_to_all_schools, updated_at DESC);`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_dashboard_custom_reports_created_by_email ON dashboard_custom_reports (lower(created_by_email));`
    );
    await client.query(`
      UPDATE dashboard_custom_reports d
      SET created_by_email = LOWER(BTRIM(u.email))
      FROM auth_users u
      WHERE d.created_by_user_id = u.id
        AND (d.created_by_email IS NULL OR BTRIM(d.created_by_email) = '')
        AND u.email IS NOT NULL
        AND BTRIM(u.email) <> '';
    `);
    await client.query('COMMIT');
    global.__dashboardCustomReportsSchemaReady = true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function isTransientSchemaWarmupError(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code ?? '');
  if (code === '55P03' || code === '57014' || code === '40001') return true;
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase();
  return (
    message.includes('lock timeout') ||
    message.includes('statement timeout') ||
    message.includes('could not obtain lock') ||
    message.includes('canceling statement due to')
  );
}

async function ensureDashboardCustomReportsSchemaBestEffort(pool: Pool): Promise<void> {
  try {
    await ensureDashboardCustomReportsSchema(pool);
  } catch (error) {
    // On serverless cold starts, concurrent schema warmup can briefly lock.
    // Failing open here avoids intermittent "missing custom reports" behavior.
    if (!isTransientSchemaWarmupError(error)) throw error;
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const schoolCode = resolveDashboardSchoolCode(session);
  const { organizationIds } = await resolveCustomReportOrganizationScope(session, schoolCode);
  const identityFallback = await resolveAuthIdentityFallback(session);
  const scopedOrgIds = Array.from(new Set([...organizationIds, ...identityFallback.fallbackOrgIds]));
  const isGlobalAdmin = isGlobalAdminSession(session);
  const userId = Number(session.userId ?? 0);
  const normalizedEmail = String(session.email ?? '').trim().toLowerCase();
  const effectiveUserIds = Array.from(
    new Set([
      ...(Number.isFinite(userId) && userId > 0 ? [userId] : []),
      ...identityFallback.fallbackUserIds,
    ])
  );
  const hasUserScope = effectiveUserIds.length > 0;
  const pool = getDbPool();
  try {
    await ensureDashboardCustomReportsSchemaBestEffort(pool);
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
        OR ($3::boolean AND created_by_user_id = ANY($4::bigint[]))
        OR ($6::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($6))
      )
      ORDER BY updated_at DESC, id DESC
      `,
      [scopedOrgIds, schoolCode, hasUserScope, effectiveUserIds, isGlobalAdmin, normalizedEmail]
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
        WHERE $4::boolean
           OR organization_id = ANY($1::int[])
           OR ($2::boolean AND created_by_user_id = ANY($3::bigint[]))
           OR ($5::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($5))
        ORDER BY updated_at DESC, id DESC
        `,
        [scopedOrgIds, hasUserScope, effectiveUserIds, isGlobalAdmin, normalizedEmail]
      );
      rows = fallback.rows;
    }
    if (!rows.length) {
      // Last-resort rescue for redeploy/session scope drift: return school/global
      // reports rather than leaving Custom Reports blank.
      const schoolFallback = await pool.query<{
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
        WHERE school_code = $1 OR applies_to_all_schools = TRUE
        ORDER BY updated_at DESC, id DESC
        `,
        [schoolCode]
      );
      rows = schoolFallback.rows;
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

    // Force-include permanent report templates so they always appear for every
    // school/pro, regardless org/session scope drift.
    try {
      const permanentCandidates = await pool.query<{
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
        WHERE
          lower(name) = ANY($1::text[])
          OR lower(name) ~ $2
        ORDER BY updated_at DESC, id DESC
        `,
        [
          Array.from(PERMANENT_REPORT_EXACT_KEYS),
          '^advance\\s+(report\\s+)?vs\\.\\s*(rhp|lhp)(\\s*\\(.*\\))?$',
        ]
      );
      const byName = new Map<string, (typeof permanentCandidates.rows)[number]>();
      for (const row of permanentCandidates.rows) {
        const key = normalizedReportNameKey(row.name);
        if (!isPermanentGlobalReportName(row.name)) continue;
        if (!byName.has(key)) byName.set(key, row);
      }
      for (const row of byName.values()) {
        const key = normalizedReportNameKey(row.name);
        if (!deduped.has(key)) deduped.set(key, row);
      }
      rows = Array.from(deduped.values()).sort((a, b) => {
        const aTime = String(a.updated_at ?? '');
        const bTime = String(b.updated_at ?? '');
        if (aTime === bTime) return Number(b.id) - Number(a.id);
        return aTime > bTime ? -1 : 1;
      });
    } catch {
      // Non-fatal: keep scoped rows if permanent fallback query fails.
    }

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
  const identityFallback = await resolveAuthIdentityFallback(session);
  const scopedOrgIds = Array.from(new Set([...organizationIds, ...identityFallback.fallbackOrgIds]));
  const isGlobalAdmin = isGlobalAdminSession(session);
  const userId = Number(session.userId ?? 0);
  const normalizedEmail = String(session.email ?? '').trim().toLowerCase();
  const effectiveUserIds = Array.from(
    new Set([
      ...(Number.isFinite(userId) && userId > 0 ? [userId] : []),
      ...identityFallback.fallbackUserIds,
    ])
  );
  const hasUserScope = effectiveUserIds.length > 0;
  const effectiveUserId = hasUserScope ? effectiveUserIds[0] : 0;
  const effectivePrimaryOrganizationId =
    Number.isFinite(primaryOrganizationId) && primaryOrganizationId > 0
      ? primaryOrganizationId
      : (Number(scopedOrgIds[0] ?? 0) || 0);
  if (
    !Number.isFinite(effectivePrimaryOrganizationId) ||
    effectivePrimaryOrganizationId <= 0 ||
    (!scopedOrgIds.length && !isGlobalAdmin)
  ) {
    return NextResponse.json({ error: 'No valid organization scope for custom reports.' }, { status: 400 });
  }
  const pool = getDbPool();
  try {
    await ensureDashboardCustomReportsSchemaBestEffort(pool);
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
               created_by_email = CASE WHEN $9::text <> '' THEN $9::text ELSE created_by_email END,
               updated_at = NOW()
         WHERE id = $2
           AND (
             $8::boolean
             OR organization_id = ANY($1::int[])
             OR ($6::boolean AND created_by_user_id = ANY($7::bigint[]))
             OR ($9::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($9))
           )
         RETURNING id, name, applies_to_all_schools, payload_json, created_at, updated_at
        `,
        [scopedOrgIds, id, name, JSON.stringify(payload), applyToAllSchools, hasUserScope, effectiveUserIds, isGlobalAdmin, normalizedEmail]
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
          WHERE (
            $10::boolean
            OR organization_id = ANY($1::int[])
            OR ($7::boolean AND created_by_user_id = ANY($8::bigint[]))
            OR ($11::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($11))
          )
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
            organization_id, school_code, applies_to_all_schools, name, payload_json, created_by_user_id, created_by_email
          )
          SELECT $9, $2, $6, $3, $4::jsonb, $5, CASE WHEN $11::text <> '' THEN $11::text ELSE NULL END
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
          effectiveUserId > 0 ? effectiveUserId : null,
          applyToAllSchools,
          hasUserScope,
          effectiveUserIds,
          effectivePrimaryOrganizationId,
          isGlobalAdmin,
          normalizedEmail,
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
  const identityFallback = await resolveAuthIdentityFallback(session);
  const scopedOrgIds = Array.from(new Set([...organizationIds, ...identityFallback.fallbackOrgIds]));
  const isGlobalAdmin = isGlobalAdminSession(session);
  const userId = Number(session.userId ?? 0);
  const normalizedEmail = String(session.email ?? '').trim().toLowerCase();
  const effectiveUserIds = Array.from(
    new Set([
      ...(Number.isFinite(userId) && userId > 0 ? [userId] : []),
      ...identityFallback.fallbackUserIds,
    ])
  );
  const hasUserScope = effectiveUserIds.length > 0;
  if (!scopedOrgIds.length && !isGlobalAdmin) {
    return NextResponse.json({ error: 'No valid organization scope for custom reports.' }, { status: 400 });
  }
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Report id is required.' }, { status: 400 });
  }

  try {
    const pool = getDbPool();
    await ensureDashboardCustomReportsSchemaBestEffort(pool);
    const protectedCheck = await pool.query<{ name: string }>(
      `
      SELECT name
      FROM dashboard_custom_reports
      WHERE id = $1
        AND (
          $5::boolean
          OR organization_id = ANY($2::int[])
          OR ($3::boolean AND created_by_user_id = ANY($4::bigint[]))
          OR ($6::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($6))
        )
      LIMIT 1
      `,
      [id, scopedOrgIds, hasUserScope, effectiveUserIds, isGlobalAdmin, normalizedEmail]
    );
    const existingName = String(protectedCheck.rows[0]?.name ?? '').trim();
    if (normalizedReportNameKey(existingName) === normalizedReportNameKey("Jared's Dashboard")) {
      return NextResponse.json({ error: "Jared's Dashboard is protected and cannot be deleted." }, { status: 400 });
    }
    if (isPermanentGlobalReportName(existingName)) {
      return NextResponse.json({ error: 'This permanent report template cannot be deleted.' }, { status: 400 });
    }
    const deleted = await pool.query(
      `
      DELETE FROM dashboard_custom_reports
      WHERE id = $1
        AND (
          $5::boolean
          OR organization_id = ANY($2::int[])
          OR ($3::boolean AND created_by_user_id = ANY($4::bigint[]))
          OR ($6::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($6))
        )
      `,
      [id, scopedOrgIds, hasUserScope, effectiveUserIds, isGlobalAdmin, normalizedEmail]
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

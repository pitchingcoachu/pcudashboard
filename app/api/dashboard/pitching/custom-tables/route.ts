import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveSchoolScopedOrganizationId } from '../../../../../lib/programming-scope';
import { ensureTrainingDbReady } from '../../../../../lib/training-db';
import { ensureAuthDbReady, getDbPool, listActiveStaffOrganizationIdsByEmail } from '../../../../../lib/auth-db';
import type { PortalSession } from '../../../../../lib/portal-session';
import type { Pool } from 'pg';

function normalizeColumns(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of input) {
    if (typeof value !== 'string') continue;
    const col = value.trim();
    if (!col || seen.has(col)) continue;
    seen.add(col);
    deduped.push(col);
  }
  return deduped;
}

function normalizedTableNameKey(name: string): string {
  return String(name ?? '')
    .trim()
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
  var __dashboardCustomTablesSchemaReady: boolean | undefined;
}

async function getSession(request: Request): Promise<PortalSession | null> {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
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

async function resolveCustomTableOrganizationScope(
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

  // Keep PRO custom tables anchored to the signed-in org for all roles.
  // This prevents "missing table" behavior when school->org mapping changes.
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
    const fallbackUserIds: number[] = [];
    const fallbackOrgSet = new Set<number>();
    for (const row of result.rows) {
      const uid = Number(row.id ?? 0);
      if (uid > 0) {
        if (fallbackUserId <= 0) fallbackUserId = uid;
        fallbackUserIds.push(uid);
      }
      const orgId = Number(row.organization_id ?? 0);
      if (orgId > 0) fallbackOrgSet.add(orgId);
    }
    return { fallbackUserId, fallbackUserIds, fallbackOrgIds: Array.from(fallbackOrgSet) };
  } catch {
    return { fallbackUserId: 0, fallbackUserIds: [], fallbackOrgIds: [] };
  }
}

async function ensureDashboardCustomTableSchema(pool: Pool): Promise<void> {
  if (global.__dashboardCustomTablesSchemaReady) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '3s';`);
    await client.query(`SET LOCAL statement_timeout = '30s';`);
    // Prevent concurrent schema/index creation races across requests.
    await client.query(`SELECT pg_advisory_xact_lock(77431102512032);`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS dashboard_custom_tables (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        school_code TEXT NOT NULL,
        name TEXT NOT NULL,
        columns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        created_by_email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE dashboard_custom_tables ADD COLUMN IF NOT EXISTS created_by_email TEXT;`);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_custom_tables_org_school_name ON dashboard_custom_tables (organization_id, school_code, lower(name));`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_dashboard_custom_tables_org_school_updated ON dashboard_custom_tables (organization_id, school_code, updated_at DESC);`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_dashboard_custom_tables_created_by_email ON dashboard_custom_tables (lower(created_by_email));`
    );
    await client.query(`
      UPDATE dashboard_custom_tables d
      SET created_by_email = LOWER(BTRIM(u.email))
      FROM auth_users u
      WHERE d.created_by_user_id = u.id
        AND (d.created_by_email IS NULL OR BTRIM(d.created_by_email) = '')
        AND u.email IS NOT NULL
        AND BTRIM(u.email) <> '';
    `);
    await client.query('COMMIT');
    global.__dashboardCustomTablesSchemaReady = true;
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

async function ensureDashboardCustomTableSchemaBestEffort(pool: Pool): Promise<void> {
  try {
    await ensureDashboardCustomTableSchema(pool);
  } catch (error) {
    // On serverless cold starts, concurrent schema warmup can briefly lock.
    // Failing open here avoids intermittent "missing custom tables" behavior.
    if (!isTransientSchemaWarmupError(error)) throw error;
  }
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureTrainingDbReady();
  const schoolCode = resolveDashboardSchoolCode(session);
  const { organizationIds } = await resolveCustomTableOrganizationScope(session, schoolCode);
  const identityFallback = await resolveAuthIdentityFallback(session);
  const scopedOrgIds = Array.from(new Set([...organizationIds, ...identityFallback.fallbackOrgIds]));
  const userId = Number(session.userId ?? 0);
  const normalizedEmail = String(session.email ?? '').trim().toLowerCase();
  const globalAdminEmails = parseGlobalAdminEmails();
  const canShareAcrossSites = Boolean(normalizedEmail && globalAdminEmails.includes(normalizedEmail));
  const effectiveUserIds = Array.from(
    new Set([
      ...(Number.isFinite(userId) && userId > 0 ? [userId] : []),
      ...identityFallback.fallbackUserIds,
    ])
  );
  const hasUserScope = effectiveUserIds.length > 0;
  const pool = getDbPool();
  try {
    await ensureDashboardCustomTableSchemaBestEffort(pool);
    const scopedResult = await pool.query<{
      id: number;
      name: string;
      school_code: string;
      columns_json: unknown;
      created_by_email: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
      SELECT id, name, school_code, columns_json, created_by_email, created_at, updated_at
      FROM dashboard_custom_tables
      WHERE (
        (school_code = $6 AND (
          $4::boolean
          OR organization_id = ANY($1::int[])
          OR ($2::boolean AND created_by_user_id = ANY($3::bigint[]))
          OR ($5::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($5))
        ))
        OR LOWER(COALESCE(created_by_email, '')) = ANY($7::text[])
      )
      ORDER BY updated_at DESC, id DESC
      `,
      [scopedOrgIds, hasUserScope, effectiveUserIds, canShareAcrossSites, normalizedEmail, schoolCode, globalAdminEmails]
    );
    let candidateRows = scopedResult.rows;
    if (!candidateRows.length) {
      // Last-resort rescue for redeploy/session scope drift: keep school-owned
      // custom tables visible instead of returning an empty list.
      const schoolFallback = await pool.query<{
        id: number;
        name: string;
        school_code: string;
        columns_json: unknown;
        created_by_email: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `
        SELECT id, name, school_code, columns_json, created_by_email, created_at, updated_at
        FROM dashboard_custom_tables
        WHERE school_code = $1
        ORDER BY updated_at DESC, id DESC
        `,
        [schoolCode]
      );
      candidateRows = schoolFallback.rows;
    }
    const deduped = new Map<string, (typeof candidateRows)[number]>();
    for (const row of candidateRows) {
      const key = normalizedTableNameKey(row.name);
      const current = deduped.get(key);
      if (!current) {
        deduped.set(key, row);
        continue;
      }
      const rowIsSelectedSchool = String(row.school_code || '').toUpperCase() === schoolCode;
      const currentIsSelectedSchool = String(current.school_code || '').toUpperCase() === schoolCode;
      if (rowIsSelectedSchool && !currentIsSelectedSchool) {
        deduped.set(key, row);
        continue;
      }
      if (rowIsSelectedSchool === currentIsSelectedSchool) {
        if (new Date(row.updated_at).getTime() > new Date(current.updated_at).getTime()) {
          deduped.set(key, row);
        }
      }
    }
    const rows = Array.from(deduped.values()).sort((a, b) => {
      const aTime = new Date(a.updated_at).getTime();
      const bTime = new Date(b.updated_at).getTime();
      if (aTime !== bTime) return bTime - aTime;
      return Number(b.id) - Number(a.id);
    });
    return NextResponse.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        columns: normalizeColumns(row.columns_json),
        createdByEmail: row.created_by_email ?? null,
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
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureTrainingDbReady();
  const schoolCode = resolveDashboardSchoolCode(session);
  const { primaryOrganizationId, organizationIds } = await resolveCustomTableOrganizationScope(session, schoolCode);
  const identityFallback = await resolveAuthIdentityFallback(session);
  const scopedOrgIds = Array.from(new Set([...organizationIds, ...identityFallback.fallbackOrgIds]));
  const userId = Number(session.userId ?? 0);
  const normalizedEmail = String(session.email ?? '').trim().toLowerCase();
  const canShareAcrossSites = Boolean(normalizedEmail && parseGlobalAdminEmails().includes(normalizedEmail));
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
    (!scopedOrgIds.length && !canShareAcrossSites)
  ) {
    return NextResponse.json({ error: 'No valid organization scope for custom tables.' }, { status: 400 });
  }
  const pool = getDbPool();
  try {
    await ensureDashboardCustomTableSchemaBestEffort(pool);
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
        created_by_email: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `
        UPDATE dashboard_custom_tables
           SET name = $3,
               columns_json = $4::jsonb,
               created_by_email = CASE WHEN $8::text <> '' THEN $8::text ELSE created_by_email END,
               updated_at = NOW()
         WHERE id = $2
           AND (
             $7::boolean
             OR (
               school_code = $9
               AND (
                 organization_id = ANY($1::int[])
                 OR ($5::boolean AND created_by_user_id = ANY($6::bigint[]))
                 OR ($8::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($8))
               )
             )
           )
         RETURNING id, name, columns_json, created_by_email, created_at, updated_at
        `,
        [scopedOrgIds, id, name, payload, hasUserScope, effectiveUserIds, canShareAcrossSites, normalizedEmail, schoolCode]
      );
      if (!saved.rowCount) {
        return NextResponse.json({ error: 'Custom table not found.' }, { status: 404 });
      }
    } else {
      saved = await pool.query<{
        id: number;
        name: string;
        columns_json: unknown;
        created_by_email: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `
        WITH existing AS (
          SELECT id
          FROM dashboard_custom_tables
          WHERE (
            $9::boolean
            OR (
              school_code = $2
              AND (
                organization_id = ANY($1::int[])
                OR ($6::boolean AND created_by_user_id = ANY($7::bigint[]))
                OR ($10::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($10))
              )
            )
          )
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
           RETURNING d.id, d.name, d.columns_json, d.created_by_email, d.created_at, d.updated_at
        ),
        inserted AS (
          INSERT INTO dashboard_custom_tables (
            organization_id, school_code, name, columns_json, created_by_user_id, created_by_email
          )
          SELECT $8, $2, $3, $4::jsonb, $5, CASE WHEN $10::text <> '' THEN $10::text ELSE NULL END
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          RETURNING id, name, columns_json, created_by_email, created_at, updated_at
        )
        SELECT id, name, columns_json, created_by_email, created_at, updated_at FROM updated
        UNION ALL
        SELECT id, name, columns_json, created_by_email, created_at, updated_at FROM inserted
        `,
        [
          scopedOrgIds,
          schoolCode,
          name,
          payload,
          effectiveUserId > 0 ? effectiveUserId : null,
          hasUserScope,
          effectiveUserIds,
          effectivePrimaryOrganizationId,
          canShareAcrossSites,
          normalizedEmail,
        ]
      );
    }

    const row = saved.rows[0];
    return NextResponse.json({
      item: {
        id: Number(row.id),
        name: row.name,
        columns: normalizeColumns(row.columns_json),
        createdByEmail: row.created_by_email ?? null,
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
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureTrainingDbReady();
  const schoolCode = resolveDashboardSchoolCode(session);
  const { organizationIds } = await resolveCustomTableOrganizationScope(session, schoolCode);
  const identityFallback = await resolveAuthIdentityFallback(session);
  const scopedOrgIds = Array.from(new Set([...organizationIds, ...identityFallback.fallbackOrgIds]));
  const userId = Number(session.userId ?? 0);
  const normalizedEmail = String(session.email ?? '').trim().toLowerCase();
  const canShareAcrossSites = Boolean(normalizedEmail && parseGlobalAdminEmails().includes(normalizedEmail));
  const effectiveUserIds = Array.from(
    new Set([
      ...(Number.isFinite(userId) && userId > 0 ? [userId] : []),
      ...identityFallback.fallbackUserIds,
    ])
  );
  const hasUserScope = effectiveUserIds.length > 0;
  if (!scopedOrgIds.length && !canShareAcrossSites && !hasUserScope) {
    return NextResponse.json({ error: 'No valid organization scope for custom tables.' }, { status: 400 });
  }
  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Valid id is required.' }, { status: 400 });
  }
  const pool = getDbPool();
  try {
    await ensureDashboardCustomTableSchemaBestEffort(pool);
    const target = await pool.query<{ id: number; name: string; school_code: string }>(
      `
      SELECT id, name, school_code
      FROM dashboard_custom_tables
      WHERE id = $1
        AND (
          $5::boolean
          OR (
            school_code = $7
            AND (
              organization_id = ANY($2::int[])
              OR ($3::boolean AND created_by_user_id = ANY($4::bigint[]))
              OR ($6::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($6))
            )
          )
        )
      LIMIT 1
      `,
      [id, scopedOrgIds, hasUserScope, effectiveUserIds, canShareAcrossSites, normalizedEmail, schoolCode]
    );
    if (!(target.rowCount ?? 0)) {
      return NextResponse.json({ error: 'Custom table not found.' }, { status: 404 });
    }
    const existingName = String(target.rows[0]?.name ?? '').trim();
    if (normalizedTableNameKey(existingName) === normalizedTableNameKey("Jared's Dashboard")) {
      return NextResponse.json({ error: "Jared's Dashboard is protected and cannot be deleted." }, { status: 400 });
    }
    const result = await pool.query(
      `
      DELETE FROM dashboard_custom_tables
      WHERE school_code = $6
        AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = $7
        AND (
          $5::boolean
          OR (
            school_code = $9
            AND (
              organization_id = ANY($2::int[])
              OR ($3::boolean AND created_by_user_id = ANY($4::bigint[]))
              OR ($8::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($8))
            )
          )
        )
      `,
      [
        id,
        scopedOrgIds,
        hasUserScope,
        effectiveUserIds,
        canShareAcrossSites,
        target.rows[0].school_code,
        normalizedTableNameKey(target.rows[0].name),
        normalizedEmail,
        schoolCode,
      ]
    );
    return NextResponse.json({ ok: (result.rowCount ?? 0) > 0, deletedCount: Number(result.rowCount ?? 0) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete custom table.' },
      { status: 500 }
    );
  }
}

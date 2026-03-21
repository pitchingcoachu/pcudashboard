import { resolveDashboardSchoolCode } from './dashboard-access';
import { ensureAuthDbReady, getDbPool, isDatabaseConfigured } from './auth-db';
import type { PortalSession } from './portal-session';

type SessionLike = {
  email?: string;
  organizationId?: number;
  dashboardSchoolCode?: string | null;
  role?: string;
};

function normalizeSchoolCode(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

function parseProgrammingDataSchoolCodes(): string[] {
  const raw = String(process.env.PROGRAMMING_DATA_SCHOOL_CODES ?? 'PCU');
  const values = raw
    .split(',')
    .map((value) => normalizeSchoolCode(value))
    .filter(Boolean);
  return Array.from(new Set(values));
}

function parseOrgSchoolMap(raw: string): Record<number, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<number, string> = {};
    for (const [orgIdRaw, schoolRaw] of Object.entries(parsed)) {
      const orgId = Number(orgIdRaw);
      const school = typeof schoolRaw === 'string' ? normalizeSchoolCode(schoolRaw) : '';
      if (!Number.isFinite(orgId) || orgId <= 0 || !school) continue;
      out[orgId] = school;
    }
    return out;
  } catch {
    return {};
  }
}

function parseGlobalAdminEmails(): string[] {
  const raw = String(process.env.GLOBAL_ADMIN_EMAILS ?? 'jgaynor@pitchingcoachu.com');
  const values = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function isGlobalAdminSession(session: SessionLike): boolean {
  if (session.role !== 'admin') return false;
  const email = String(session.email ?? '').trim().toLowerCase();
  if (!email) return false;
  return parseGlobalAdminEmails().includes(email);
}

function resolveScopedOrganizationIdBySelectedSchool(session: SessionLike): number {
  if (!isGlobalAdminSession(session)) return session.organizationId ?? 0;
  const selectedSchool = resolveProgrammingSchoolCode(session);
  const map = parseOrgSchoolMap(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}');
  const match = Object.entries(map).find(([, schoolCode]) => schoolCode === selectedSchool);
  if (match) return Number(match[0]);
  return session.organizationId ?? 0;
}

export function resolveSchoolScopedOrganizationId(session: SessionLike): number {
  return resolveScopedOrganizationIdBySelectedSchool(session);
}

type SchoolProductAccess = {
  dashboard?: boolean;
  programming?: boolean;
  clientManagement?: boolean;
};

type SchoolProductAccessRecord = {
  dashboard: boolean;
  programming: boolean;
  clientManagement: boolean;
};

declare global {
  var __pcuSchoolAccessCache: Record<string, SchoolProductAccessRecord> | undefined;
  var __pcuSchoolAccessCacheAt: number | undefined;
  var __pcuSchoolAccessCacheLoading: Promise<void> | undefined;
}

function parseSchoolProductAccessMap(raw: string): Record<string, SchoolProductAccess> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, SchoolProductAccess> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const schoolCode = normalizeSchoolCode(key);
      if (!schoolCode || typeof value !== 'object' || !value) continue;
      const record = value as Record<string, unknown>;
      out[schoolCode] = {
        dashboard: typeof record.dashboard === 'boolean' ? record.dashboard : undefined,
        programming: typeof record.programming === 'boolean' ? record.programming : undefined,
        clientManagement: typeof record.clientManagement === 'boolean' ? record.clientManagement : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function normalizeAccess(value: SchoolProductAccess): SchoolProductAccessRecord {
  return {
    dashboard: value.dashboard !== false,
    programming: value.programming === true,
    clientManagement: value.clientManagement !== false,
  };
}

function parseEnvSchoolProductAccessMap(): Record<string, SchoolProductAccessRecord> {
  const raw = parseSchoolProductAccessMap(process.env.SCHOOL_PRODUCT_ACCESS_JSON ?? '{}');
  return Object.fromEntries(
    Object.entries(raw).map(([schoolCode, value]) => [schoolCode, normalizeAccess(value)])
  );
}

function getCachedSchoolAccessMap(): Record<string, SchoolProductAccessRecord> {
  if (!global.__pcuSchoolAccessCache) {
    global.__pcuSchoolAccessCache = parseEnvSchoolProductAccessMap();
    global.__pcuSchoolAccessCacheAt = Date.now();
  }
  return global.__pcuSchoolAccessCache;
}

function mergeWithEnvDefaults(rows: Array<{ school_code: string; dashboard: boolean; programming: boolean; client_management: boolean }>) {
  const map: Record<string, SchoolProductAccessRecord> = parseEnvSchoolProductAccessMap();
  for (const row of rows) {
    const schoolCode = normalizeSchoolCode(row.school_code);
    if (!schoolCode) continue;
    map[schoolCode] = {
      dashboard: Boolean(row.dashboard),
      programming: Boolean(row.programming),
      clientManagement: Boolean(row.client_management),
    };
  }
  return map;
}

async function ensureSchoolProductAccessTable(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await ensureAuthDbReady();
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS school_product_access (
      school_code TEXT PRIMARY KEY,
      dashboard BOOLEAN NOT NULL DEFAULT TRUE,
      programming BOOLEAN NOT NULL DEFAULT FALSE,
      client_management BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL
    );
  `);
}

export async function refreshSchoolProductAccessCache(force = false): Promise<void> {
  const cacheAgeMs = Date.now() - Number(global.__pcuSchoolAccessCacheAt ?? 0);
  if (!force && global.__pcuSchoolAccessCache && cacheAgeMs < 30_000) return;
  if (global.__pcuSchoolAccessCacheLoading) {
    await global.__pcuSchoolAccessCacheLoading;
    return;
  }

  global.__pcuSchoolAccessCacheLoading = (async () => {
    if (!isDatabaseConfigured()) {
      global.__pcuSchoolAccessCache = parseEnvSchoolProductAccessMap();
      global.__pcuSchoolAccessCacheAt = Date.now();
      return;
    }
    await ensureSchoolProductAccessTable();
    const pool = getDbPool();
    const rows = await pool.query<{ school_code: string; dashboard: boolean; programming: boolean; client_management: boolean }>(
      `SELECT school_code, dashboard, programming, client_management FROM school_product_access`
    );
    global.__pcuSchoolAccessCache = mergeWithEnvDefaults(rows.rows);
    global.__pcuSchoolAccessCacheAt = Date.now();
  })()
    .catch(() => {
      global.__pcuSchoolAccessCache = parseEnvSchoolProductAccessMap();
      global.__pcuSchoolAccessCacheAt = Date.now();
    })
    .finally(() => {
      global.__pcuSchoolAccessCacheLoading = undefined;
    });

  await global.__pcuSchoolAccessCacheLoading;
}

export async function getSchoolProductAccess(schoolCode: string): Promise<SchoolProductAccessRecord> {
  await refreshSchoolProductAccessCache();
  const normalized = normalizeSchoolCode(schoolCode);
  const map = getCachedSchoolAccessMap();
  if (map[normalized]) return map[normalized];
  const fallback = normalizeAccess({ dashboard: true, programming: false, clientManagement: true });
  return fallback;
}

export async function setSchoolProductAccess(
  input: {
    schoolCode: string;
    dashboard: boolean;
    programming: boolean;
    clientManagement: boolean;
    updatedByUserId?: number | null;
  }
): Promise<void> {
  const schoolCode = normalizeSchoolCode(input.schoolCode);
  if (!schoolCode) return;
  if (isDatabaseConfigured()) {
    await ensureSchoolProductAccessTable();
    const pool = getDbPool();
    await pool.query(
      `
      INSERT INTO school_product_access (school_code, dashboard, programming, client_management, updated_at, updated_by_user_id)
      VALUES ($1, $2, $3, $4, NOW(), $5)
      ON CONFLICT (school_code)
      DO UPDATE SET
        dashboard = EXCLUDED.dashboard,
        programming = EXCLUDED.programming,
        client_management = EXCLUDED.client_management,
        updated_at = NOW(),
        updated_by_user_id = EXCLUDED.updated_by_user_id
      `,
      [schoolCode, input.dashboard, input.programming, input.clientManagement, input.updatedByUserId ?? null]
    );
  }
  const map = getCachedSchoolAccessMap();
  map[schoolCode] = {
    dashboard: input.dashboard,
    programming: input.programming,
    clientManagement: input.clientManagement,
  };
  global.__pcuSchoolAccessCache = { ...map };
  global.__pcuSchoolAccessCacheAt = Date.now();
}

export function resolveProgrammingSchoolCode(session: SessionLike): string {
  return resolveDashboardSchoolCode({
    userId: 0,
    email: String(session.email ?? ''),
    name: undefined,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: null,
    dashboardSchoolCode: typeof session.dashboardSchoolCode === 'string' ? session.dashboardSchoolCode : null,
    appUrl: '',
    apps: [],
  });
}

function resolveSchoolProductAccess(session: SessionLike): SchoolProductAccess {
  const schoolCode = resolveProgrammingSchoolCode(session);
  const map = getCachedSchoolAccessMap();
  const fromCache = map[schoolCode];
  if (fromCache) return fromCache;
  return {};
}

export function canUseDashboardData(session: SessionLike): boolean {
  const access = resolveSchoolProductAccess(session);
  if (typeof access.dashboard === 'boolean') return access.dashboard;
  return true;
}

export function canUseProgrammingData(session: SessionLike): boolean {
  const access = resolveSchoolProductAccess(session);
  if (typeof access.programming === 'boolean') return access.programming;
  const schoolCode = resolveProgrammingSchoolCode(session);
  const allowed = parseProgrammingDataSchoolCodes();
  return allowed.includes(schoolCode);
}

export function canUseClientManagement(session: SessionLike): boolean {
  const access = resolveSchoolProductAccess(session);
  if (typeof access.clientManagement === 'boolean') return access.clientManagement;
  return true;
}

export function resolveClientManagementOrganizationId(session: SessionLike): number {
  return canUseClientManagement(session) ? resolveScopedOrganizationIdBySelectedSchool(session) : 0;
}

export function resolveProgrammingOrganizationId(session: SessionLike): number {
  return canUseProgrammingData(session) ? resolveScopedOrganizationIdBySelectedSchool(session) : 0;
}

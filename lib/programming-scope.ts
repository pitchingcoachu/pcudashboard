import { resolveDashboardSchoolCode } from './dashboard-access';
import { getDbPool, isDatabaseConfigured } from './auth-db';
import type { PortalSession } from './portal-session';

type SessionLike = {
  email?: string;
  organizationId?: number;
  dashboardSchoolCode?: string | null;
  role?: string;
};

const DEFAULT_DASHBOARD_TRIAL_TEMPLATE_ORG_ID = 22;

function normalizeSchoolCode(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

function resolveDashboardTrialTemplateOrganizationId(): number {
  const configured = Number(process.env.DASHBOARD_TRIAL_TEMPLATE_ORG_ID ?? '');
  if (Number.isFinite(configured) && configured > 0) return configured;
  return DEFAULT_DASHBOARD_TRIAL_TEMPLATE_ORG_ID;
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

export function isGlobalAdminSession(session: SessionLike): boolean {
  if (session.role !== 'admin') return false;
  const email = String(session.email ?? '').trim().toLowerCase();
  if (!email) return false;
  return parseGlobalAdminEmails().includes(email);
}

function resolveScopedOrganizationIdBySelectedSchool(session: SessionLike): number {
  const role = String(session.role ?? '').trim().toLowerCase();
  const canScopeBySelectedSchool = isGlobalAdminSession(session) || role === 'coach';
  if (!canScopeBySelectedSchool) return session.organizationId ?? 0;
  const selectedSchool = resolveProgrammingSchoolCode(session);
  const sessionOrgId = Number(session.organizationId ?? 0);
  if (selectedSchool === 'TRIAL' && sessionOrgId > 0 && !isGlobalAdminSession(session)) return sessionOrgId;
  const map = parseOrgSchoolMap(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}');
  const matches = Object.entries(map)
    .filter(([, schoolCode]) => schoolCode === selectedSchool)
    .map(([orgId]) => Number(orgId))
    .filter((orgId) => Number.isFinite(orgId) && orgId > 0);

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    if (sessionOrgId > 0 && matches.includes(sessionOrgId)) return sessionOrgId;
    return matches[0];
  }

  // Safety: prevent leaking one org's programming data into other selected schools.
  // Keep PCU fallback for the primary PCU org when map is incomplete.
  // Trial evaluator accounts are isolated by their own org; global admins use the seeded fake-data template org.
  if (selectedSchool === 'TRIAL') {
    if (!isGlobalAdminSession(session) && sessionOrgId > 0) return sessionOrgId;
    return resolveDashboardTrialTemplateOrganizationId();
  }
  if (selectedSchool === 'PCU' && sessionOrgId > 0) return sessionOrgId;
  // Global admins may be granted schools before env mapping is updated (for example PRO).
  // Fall back to their session org so admin create flows don't hard-fail on org_id=0.
  if (isGlobalAdminSession(session) && sessionOrgId > 0) return sessionOrgId;
  return 0;
}

export function resolveSchoolScopedOrganizationId(session: SessionLike): number {
  return resolveScopedOrganizationIdBySelectedSchool(session);
}

type SchoolProductAccess = {
  dashboard?: boolean;
  programming?: boolean;
  clientManagement?: boolean;
  mobileSchedule?: boolean;
  mobileWorkouts?: boolean;
};

type SchoolProductAccessRecord = {
  dashboard: boolean;
  programming: boolean;
  clientManagement: boolean;
  mobileSchedule: boolean;
  mobileWorkouts: boolean;
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
        mobileSchedule: typeof record.mobileSchedule === 'boolean' ? record.mobileSchedule : undefined,
        mobileWorkouts: typeof record.mobileWorkouts === 'boolean' ? record.mobileWorkouts : undefined,
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
    mobileSchedule: value.mobileSchedule !== false,
    mobileWorkouts: value.mobileWorkouts !== false,
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

function mergeWithEnvDefaults(rows: Array<{ school_code: string; dashboard: boolean; programming: boolean; client_management: boolean; mobile_schedule: boolean; mobile_workouts: boolean }>) {
  const map: Record<string, SchoolProductAccessRecord> = parseEnvSchoolProductAccessMap();
  for (const row of rows) {
    const schoolCode = normalizeSchoolCode(row.school_code);
    if (!schoolCode) continue;
    map[schoolCode] = {
      dashboard: Boolean(row.dashboard),
      programming: Boolean(row.programming),
      clientManagement: Boolean(row.client_management),
      mobileSchedule: Boolean(row.mobile_schedule),
      mobileWorkouts: Boolean(row.mobile_workouts),
    };
  }
  return map;
}

async function ensureSchoolProductAccessTable(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS school_product_access (
      school_code TEXT PRIMARY KEY,
      dashboard BOOLEAN NOT NULL DEFAULT TRUE,
      programming BOOLEAN NOT NULL DEFAULT FALSE,
      client_management BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_user_id BIGINT
    );
  `);
  // mobile_* columns are a separate, mobile-only gate -- deliberately not
  // reusing `programming`, which continues to control web independently.
  await pool.query(`ALTER TABLE school_product_access ADD COLUMN IF NOT EXISTS mobile_schedule BOOLEAN NOT NULL DEFAULT TRUE;`);
  await pool.query(`ALTER TABLE school_product_access ADD COLUMN IF NOT EXISTS mobile_workouts BOOLEAN NOT NULL DEFAULT TRUE;`);
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
    const rows = await pool.query<{
      school_code: string;
      dashboard: boolean;
      programming: boolean;
      client_management: boolean;
      mobile_schedule: boolean;
      mobile_workouts: boolean;
    }>(
      `SELECT school_code, dashboard, programming, client_management, mobile_schedule, mobile_workouts FROM school_product_access`
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
  const fallback = normalizeAccess({
    dashboard: true,
    programming: normalized === 'TRIAL' || parseProgrammingDataSchoolCodes().includes(normalized),
    clientManagement: true,
    mobileSchedule: true,
    mobileWorkouts: true,
  });
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
    const params = [schoolCode, input.dashboard, input.programming, input.clientManagement, input.updatedByUserId ?? null];
    const upsertSql = `
      INSERT INTO school_product_access (school_code, dashboard, programming, client_management, updated_at, updated_by_user_id)
      VALUES ($1, $2, $3, $4, NOW(), $5)
      ON CONFLICT (school_code)
      DO UPDATE SET
        dashboard = EXCLUDED.dashboard,
        programming = EXCLUDED.programming,
        client_management = EXCLUDED.client_management,
        updated_at = NOW(),
        updated_by_user_id = EXCLUDED.updated_by_user_id
    `;
    try {
      await pool.query(upsertSql, params);
    } catch (error) {
      const typed = error as { code?: string } | null;
      if (typed?.code === '23503') {
        // Allow access toggles to save even if the acting session user is not persisted in auth_users.
        await pool.query(upsertSql, [schoolCode, input.dashboard, input.programming, input.clientManagement, null]);
      } else {
        throw error;
      }
    }
  }
  const map = getCachedSchoolAccessMap();
  map[schoolCode] = {
    ...normalizeAccess(map[schoolCode] ?? {}),
    dashboard: input.dashboard,
    programming: input.programming,
    clientManagement: input.clientManagement,
  };
  global.__pcuSchoolAccessCache = { ...map };
  global.__pcuSchoolAccessCacheAt = Date.now();
}

// Mobile-only Schedule/Workouts lock -- deliberately separate from
// setSchoolProductAccess's `programming` flag, which continues to gate web
// independently per product decision.
export async function setSchoolMobileAccess(
  input: {
    schoolCode: string;
    mobileSchedule: boolean;
    mobileWorkouts: boolean;
    updatedByUserId?: number | null;
  }
): Promise<void> {
  const schoolCode = normalizeSchoolCode(input.schoolCode);
  if (!schoolCode) return;
  if (isDatabaseConfigured()) {
    await ensureSchoolProductAccessTable();
    const pool = getDbPool();
    const params = [schoolCode, input.mobileSchedule, input.mobileWorkouts, input.updatedByUserId ?? null];
    const upsertSql = `
      INSERT INTO school_product_access (school_code, mobile_schedule, mobile_workouts, updated_at, updated_by_user_id)
      VALUES ($1, $2, $3, NOW(), $4)
      ON CONFLICT (school_code)
      DO UPDATE SET
        mobile_schedule = EXCLUDED.mobile_schedule,
        mobile_workouts = EXCLUDED.mobile_workouts,
        updated_at = NOW(),
        updated_by_user_id = EXCLUDED.updated_by_user_id
    `;
    try {
      await pool.query(upsertSql, params);
    } catch (error) {
      const typed = error as { code?: string } | null;
      if (typed?.code === '23503') {
        await pool.query(upsertSql, [schoolCode, input.mobileSchedule, input.mobileWorkouts, null]);
      } else {
        throw error;
      }
    }
  }
  const map = getCachedSchoolAccessMap();
  map[schoolCode] = {
    ...normalizeAccess(map[schoolCode] ?? {}),
    mobileSchedule: input.mobileSchedule,
    mobileWorkouts: input.mobileWorkouts,
  };
  global.__pcuSchoolAccessCache = { ...map };
  global.__pcuSchoolAccessCacheAt = Date.now();
}

export function resolveProgrammingSchoolCode(session: SessionLike): string {
  const sessionOrgId = Number(session.organizationId ?? 0);
  if (!isGlobalAdminSession(session) && Number.isFinite(sessionOrgId) && sessionOrgId > 0) {
    const map = parseOrgSchoolMap(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}');
    if (map[sessionOrgId] === 'TRIAL') return 'TRIAL';
  }
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

// Always goes through getSchoolProductAccess (which self-warms the cache via
// refreshSchoolProductAccessCache) rather than reading the raw in-memory
// cache directly. Reading the raw cache let a cold serverless instance that
// hadn't yet had *any* async DB-backed read for a given school silently fall
// back to defaults -- e.g. programming defaulting to PCU-only -- which is
// why switching to a real school (LSU/OSU/Harvard) could 400 with "Session
// context missing" while the primary PCU org kept working.
async function resolveSchoolProductAccess(session: SessionLike): Promise<SchoolProductAccessRecord> {
  const schoolCode = resolveProgrammingSchoolCode(session);
  return getSchoolProductAccess(schoolCode);
}

export async function canUseDashboardData(session: SessionLike): Promise<boolean> {
  const access = await resolveSchoolProductAccess(session);
  return access.dashboard;
}

export async function canUseProgrammingData(session: SessionLike): Promise<boolean> {
  const access = await resolveSchoolProductAccess(session);
  return access.programming;
}

export async function canUseMobileSchedule(session: SessionLike): Promise<boolean> {
  const access = await resolveSchoolProductAccess(session);
  return access.mobileSchedule;
}

export async function canUseMobileWorkouts(session: SessionLike): Promise<boolean> {
  const access = await resolveSchoolProductAccess(session);
  return access.mobileWorkouts;
}

export async function canUseClientManagement(session: SessionLike): Promise<boolean> {
  const schoolCode = resolveProgrammingSchoolCode(session);
  if (schoolCode === 'PRO') return isGlobalAdminSession(session);
  const access = await resolveSchoolProductAccess(session);
  return access.clientManagement;
}

export async function resolveClientManagementOrganizationId(session: SessionLike): Promise<number> {
  return (await canUseClientManagement(session)) ? resolveScopedOrganizationIdBySelectedSchool(session) : 0;
}

export async function resolveProgrammingOrganizationId(session: SessionLike): Promise<number> {
  return (await canUseProgrammingData(session)) ? resolveScopedOrganizationIdBySelectedSchool(session) : 0;
}

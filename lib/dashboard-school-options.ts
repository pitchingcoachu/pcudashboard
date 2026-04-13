import { listActiveStaffOrganizationsByEmail } from './auth-db';
import type { PortalSession } from './portal-session';
import { resolveAllowedDashboardSchoolCodes, resolveDashboardSchoolCode } from './dashboard-access';

declare global {
  var __pcuStaffSchoolCodesCache: Map<string, { at: number; codes: string[] }> | undefined;
  var __pcuStaffSchoolCodesInflight: Map<string, Promise<string[]>> | undefined;
  var __pcuDashboardSchoolOptionsCache: Map<string, { at: number; codes: string[] }> | undefined;
}

const STAFF_CODES_TTL_MS = 5 * 60 * 1000;
const OPTIONS_TTL_MS = 60 * 1000;
const STAFF_QUERY_TIMEOUT_MS = 2500;

function normalizeSchoolCode(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function withLeagueAndPro(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set([...values, 'LEAGUE', 'PRO'].filter(isNonEmptyString)));
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

function schoolFromOrganizationId(organizationId: number): string | null {
  const map = parseOrgSchoolMap(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}');
  const school = map[organizationId];
  return school ? normalizeSchoolCode(school) : null;
}

function parseGlobalAdminEmails(): string[] {
  const base = [
    'jgaynor@pitchingcoachu.com',
    'ahalverson@pitchingcoachu.com',
    'jchipman@pitchingcoachu.com',
    'patrick.jones@rosterpilot.com',
    'corralf34@gmail.com',
  ];
  const values = [...base, ...String(process.env.GLOBAL_ADMIN_EMAILS ?? '').split(',')]
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function isGlobalAdminEmail(email: string): boolean {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return parseGlobalAdminEmails().includes(normalized);
}

function schoolFromOrganizationName(name: string | null | undefined): string | null {
  const value = String(name ?? '').trim();
  if (!value) return null;
  const upper = value.toUpperCase();
  const compact = upper.replace(/[^A-Z0-9]/g, '');
  const allowed = resolveAllowedDashboardSchoolCodes();
  for (const school of allowed) {
    const code = normalizeSchoolCode(school);
    if (!code) continue;
    if (upper === code || compact === code || upper.includes(code) || compact.includes(code)) return code;
  }
  return null;
}

const SCHOOL_DOMAIN_HINTS: Array<{ schoolCode: string; fragments: string[] }> = [
  { schoolCode: 'CBU', fragments: ['calbaptist.edu'] },
  { schoolCode: 'GCU', fragments: ['gcu.edu', 'gcu.com'] },
  { schoolCode: 'OSU', fragments: ['oregonstate.edu', 'okstate.edu'] },
  { schoolCode: 'CNU', fragments: ['cnu.edu'] },
  { schoolCode: 'GMU', fragments: ['gmu.edu'] },
  { schoolCode: 'LSU', fragments: ['lsu.edu'] },
  { schoolCode: 'UNM', fragments: ['unm.edu'] },
  { schoolCode: 'SEMO', fragments: ['semo.edu'] },
  { schoolCode: 'CREIGHTON', fragments: ['creighton.edu'] },
  { schoolCode: 'HARVARD', fragments: ['harvard.edu'] },
];

function schoolFromEmailDomain(email: string | null | undefined): string | null {
  const normalized = String(email ?? '').trim().toLowerCase();
  const atIdx = normalized.lastIndexOf('@');
  if (atIdx < 0) return null;
  const domain = normalized.slice(atIdx + 1);
  if (!domain) return null;
  for (const hint of SCHOOL_DOMAIN_HINTS) {
    if (hint.fragments.some((fragment) => domain === fragment || domain.endsWith(`.${fragment}`))) {
      return hint.schoolCode;
    }
  }
  return null;
}

function getStaffCodesCache() {
  if (!global.__pcuStaffSchoolCodesCache) global.__pcuStaffSchoolCodesCache = new Map();
  return global.__pcuStaffSchoolCodesCache;
}

function getStaffCodesInflight() {
  if (!global.__pcuStaffSchoolCodesInflight) global.__pcuStaffSchoolCodesInflight = new Map();
  return global.__pcuStaffSchoolCodesInflight;
}

function getOptionsCache() {
  if (!global.__pcuDashboardSchoolOptionsCache) global.__pcuDashboardSchoolOptionsCache = new Map();
  return global.__pcuDashboardSchoolOptionsCache;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function resolveStaffSchoolCodes(email: string): Promise<string[]> {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!normalizedEmail) return [];
  const now = Date.now();
  const cache = getStaffCodesCache();
  const cached = cache.get(normalizedEmail);
  if (cached && now - cached.at <= STAFF_CODES_TTL_MS) return cached.codes;

  const inflight = getStaffCodesInflight();
  const active = inflight.get(normalizedEmail);
  if (active) return active;

  const promise = (async () => {
    try {
      const organizations = await withTimeout(
        listActiveStaffOrganizationsByEmail(normalizedEmail),
        STAFF_QUERY_TIMEOUT_MS
      );
      const codes = organizations
        .map((org) => schoolFromOrganizationId(org.organizationId) ?? schoolFromOrganizationName(org.organizationName))
        .filter((value): value is string => Boolean(value));
      const deduped = Array.from(new Set(codes));
      cache.set(normalizedEmail, { at: Date.now(), codes: deduped });
      return deduped;
    } catch {
      return cached?.codes ?? [];
    } finally {
      inflight.delete(normalizedEmail);
    }
  })();

  inflight.set(normalizedEmail, promise);
  return promise;
}

export async function resolveSessionDashboardSchoolOptions(session: PortalSession): Promise<string[]> {
  const cacheKey = [
    String(session.role ?? ''),
    String(session.email ?? '').trim().toLowerCase(),
    Number(session.userId ?? 0),
    Number(session.organizationId ?? 0),
    Number(session.playerId ?? 0),
    normalizeSchoolCode(session.dashboardSchoolCode ?? ''),
  ].join('|');
  const optionsCache = getOptionsCache();
  const cached = optionsCache.get(cacheKey);
  if (cached && Date.now() - cached.at <= OPTIONS_TTL_MS) return cached.codes;

  const selected = normalizeSchoolCode(session.dashboardSchoolCode ?? '');
  const fallback = resolveDashboardSchoolCode(session);
  const domainHint = schoolFromEmailDomain(session.email);

  if (session.role === 'admin') {
    if (isGlobalAdminEmail(session.email)) {
      const resolved = withLeagueAndPro(resolveAllowedDashboardSchoolCodes());
      optionsCache.set(cacheKey, { at: Date.now(), codes: resolved });
      return resolved;
    }
    const codes = await resolveStaffSchoolCodes(session.email);
    const seededCodes = Array.from(new Set([...codes, domainHint].filter(isNonEmptyString)));
    const mergedBase = seededCodes.length
      ? seededCodes
      : Array.from(new Set([selected, fallback].filter(isNonEmptyString)));
    const merged = withLeagueAndPro(mergedBase);
    const resolved = merged.length > 0 ? merged : [fallback];
    optionsCache.set(cacheKey, { at: Date.now(), codes: resolved });
    return resolved;
  }

  if (session.role === 'coach') {
    const codes = await resolveStaffSchoolCodes(session.email);
    const seededCodes = Array.from(new Set([...codes, domainHint].filter(isNonEmptyString)));
    const mergedBase = seededCodes.length
      ? seededCodes
      : Array.from(new Set([selected, fallback].filter(isNonEmptyString)));
    const merged = withLeagueAndPro(mergedBase);
    const resolved = merged.length > 0 ? merged : [fallback];
    optionsCache.set(cacheKey, { at: Date.now(), codes: resolved });
    return resolved;
  }

  const resolved = withLeagueAndPro([fallback]);
  optionsCache.set(cacheKey, { at: Date.now(), codes: resolved });
  return resolved;
}

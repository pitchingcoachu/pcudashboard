import { listActiveStaffOrganizationsByEmail } from './auth-db';
import type { PortalSession } from './portal-session';
import { resolveAllowedDashboardSchoolCodes, resolveDashboardSchoolCode } from './dashboard-access';

function normalizeSchoolCode(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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

async function resolveStaffSchoolCodes(email: string): Promise<string[]> {
  const organizations = await listActiveStaffOrganizationsByEmail(email);
  const codes = organizations
    .map((org) => schoolFromOrganizationId(org.organizationId) ?? schoolFromOrganizationName(org.organizationName))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(codes));
}

export async function resolveSessionDashboardSchoolOptions(session: PortalSession): Promise<string[]> {
  const selected = normalizeSchoolCode(session.dashboardSchoolCode ?? '');
  const fallback = resolveDashboardSchoolCode(session);
  const domainHint = schoolFromEmailDomain(session.email);

  if (session.role === 'admin') {
    if (isGlobalAdminEmail(session.email)) return Array.from(new Set([...resolveAllowedDashboardSchoolCodes(), 'LEAGUE', 'PRO']));
    const codes = await resolveStaffSchoolCodes(session.email);
    const seededCodes = Array.from(new Set([...codes, domainHint].filter(isNonEmptyString)));
    const proAllowed = seededCodes.includes('PRO');
    const mergedBase = seededCodes.length
      ? seededCodes
      : Array.from(new Set([selected, fallback].filter(isNonEmptyString)));
    const merged = Array.from(new Set([...mergedBase, 'LEAGUE'].filter(isNonEmptyString))).filter(
      (code) => code !== 'PRO' || proAllowed
    );
    return merged.length > 0 ? merged : [fallback];
  }

  if (session.role === 'coach') {
    const codes = await resolveStaffSchoolCodes(session.email);
    const seededCodes = Array.from(new Set([...codes, domainHint].filter(isNonEmptyString)));
    // Coaches created under PRO should only see PRO unless explicitly linked to other schools.
    if (seededCodes.length === 1 && seededCodes[0] === 'PRO') return ['PRO'];
    const proAllowed = seededCodes.includes('PRO');
    const mergedBase = seededCodes.length
      ? seededCodes
      : Array.from(new Set([selected, fallback].filter(isNonEmptyString)));
    const merged = Array.from(new Set([...mergedBase, 'LEAGUE'].filter(isNonEmptyString))).filter(
      (code) => code !== 'PRO' || proAllowed
    );
    return merged.length > 0 ? merged : [fallback];
  }

  return [fallback];
}

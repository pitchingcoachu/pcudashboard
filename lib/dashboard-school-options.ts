import { listActiveStaffOrganizationsByEmail } from './auth-db';
import type { PortalSession } from './portal-session';
import { resolveAllowedDashboardSchoolCodes, resolveDashboardSchoolCode } from './dashboard-access';

function normalizeSchoolCode(value: string): string {
  return String(value ?? '').trim().toUpperCase();
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

async function resolveStaffSchoolCodes(email: string): Promise<string[]> {
  const organizations = await listActiveStaffOrganizationsByEmail(email);
  const codes = organizations
    .map((org) => schoolFromOrganizationId(org.organizationId) ?? schoolFromOrganizationName(org.organizationName))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(codes));
}

export async function resolveSessionDashboardSchoolOptions(session: PortalSession): Promise<string[]> {
  if (session.role === 'admin') {
    if (isGlobalAdminEmail(session.email)) return Array.from(new Set([...resolveAllowedDashboardSchoolCodes(), 'LEAGUE']));
    const codes = await resolveStaffSchoolCodes(session.email);
    const fallback = resolveDashboardSchoolCode(session);
    const selected = normalizeSchoolCode(session.dashboardSchoolCode ?? '');
    const merged = Array.from(new Set([...codes, selected, fallback, 'LEAGUE'].filter(Boolean)));
    return merged.length > 0 ? merged : [fallback];
  }

  if (session.role === 'coach') {
    const codes = await resolveStaffSchoolCodes(session.email);
    const fallback = resolveDashboardSchoolCode(session);
    const selected = normalizeSchoolCode(session.dashboardSchoolCode ?? '');
    const merged = Array.from(new Set([...codes, selected, fallback, 'LEAGUE'].filter(Boolean)));
    return merged.length > 0 ? merged : [fallback];
  }

  return [resolveDashboardSchoolCode(session)];
}

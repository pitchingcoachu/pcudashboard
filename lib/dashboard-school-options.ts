import { listActiveStaffOrganizationIdsByEmail } from './auth-db';
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

export async function resolveSessionDashboardSchoolOptions(session: PortalSession): Promise<string[]> {
  if (session.role === 'admin') return resolveAllowedDashboardSchoolCodes();

  if (session.role === 'coach') {
    const orgIds = await listActiveStaffOrganizationIdsByEmail(session.email);
    const codes = orgIds
      .map((orgId) => schoolFromOrganizationId(orgId))
      .filter((value): value is string => Boolean(value));
    const fallback = resolveDashboardSchoolCode(session);
    const selected = normalizeSchoolCode(session.dashboardSchoolCode ?? '');
    const merged = Array.from(new Set([...codes, selected, fallback].filter(Boolean)));
    return merged.length > 0 ? merged : [fallback];
  }

  return [resolveDashboardSchoolCode(session)];
}


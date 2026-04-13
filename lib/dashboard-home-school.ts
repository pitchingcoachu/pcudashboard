type OrgMap = Record<string, string>;

function normalizeSchoolCode(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function parseOrgSchoolMap(raw: string): OrgMap {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([k, v]) => k.trim().length > 0 && typeof v === 'string' && v.trim().length > 0)
        .map(([k, v]) => [k.trim(), normalizeSchoolCode(String(v))])
    );
  } catch {
    return {};
  }
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

export function resolveHomeDashboardSchoolCode(input: {
  email?: string | null;
  organizationId?: number | null;
  dashboardSchoolCode?: string | null;
}): string | null {
  const orgId = Number(input.organizationId ?? 0);
  if (Number.isFinite(orgId) && orgId > 0) {
    const map = parseOrgSchoolMap(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}');
    const mapped = normalizeSchoolCode(map[String(orgId)]);
    if (mapped) return mapped;
  }

  if (isGlobalAdminEmail(String(input.email ?? ''))) return 'PCU';

  const selected = normalizeSchoolCode(input.dashboardSchoolCode);
  if (selected) return selected;

  const fallback = normalizeSchoolCode(process.env.DASHBOARD_DEFAULT_SCHOOL_CODE ?? 'OSU');
  return fallback || 'OSU';
}


import type { PortalSession } from './portal-session';

type OrgMap = Record<string, string>;

function parseOrgSchoolMap(raw: string): OrgMap {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([k, v]) => k.trim().length > 0 && typeof v === 'string' && v.trim().length > 0)
        .map(([k, v]) => [k.trim(), String(v).trim().toUpperCase()])
    );
  } catch {
    return {};
  }
}

function normalizeSchoolCode(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

function parseAllowedSchoolCodes(raw: string): string[] {
  const values = String(raw ?? '')
    .split(',')
    .map((value) => normalizeSchoolCode(value))
    .filter(Boolean);
  return Array.from(new Set(values));
}

export function resolveAllowedDashboardSchoolCodes(): string[] {
  const envValues = parseAllowedSchoolCodes(process.env.DASHBOARD_ALLOWED_SCHOOL_CODES ?? '');
  const mapValues = Object.values(parseOrgSchoolMap(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}')).map((value) => normalizeSchoolCode(value));
  const fallback = normalizeSchoolCode(process.env.DASHBOARD_DEFAULT_SCHOOL_CODE ?? 'OSU') || 'OSU';
  const combined = Array.from(
    new Set([...envValues, ...mapValues, fallback, 'PCU', 'OSU', 'CNU', 'GCU', 'LSU', 'SEMO', 'CREIGHTON'].filter(Boolean))
  );
  return combined;
}

export function resolveDashboardSchoolCode(session: PortalSession): string {
  const selected = normalizeSchoolCode(String(session.dashboardSchoolCode ?? ''));
  if (selected) return selected;
  const mapRaw = process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}';
  const map = parseOrgSchoolMap(mapRaw);
  const fromMap = map[String(session.organizationId)];
  if (fromMap) return fromMap;
  const fallback = normalizeSchoolCode(process.env.DASHBOARD_DEFAULT_SCHOOL_CODE ?? 'OSU');
  return fallback || 'OSU';
}

export function resolveDashboardApiBaseUrl(): string {
  const configured =
    (process.env.DASHBOARD_API_BASE_URL ?? process.env.DASHBOARD_API_URL ?? '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  const isProdRuntime = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  if (isProdRuntime) {
    throw new Error('DASHBOARD_API_BASE_URL is not set in production.');
  }
  const base = 'http://127.0.0.1:8001';
  return base.replace(/\/+$/, '');
}

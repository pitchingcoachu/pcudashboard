import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardApiBaseUrl } from '../../../../lib/dashboard-access';
import { fetchDashboardJsonWithCache } from '../../../../lib/dashboard-route-cache';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { getPlayerForUser } from '../../../../lib/training-db';

type VeloRow = {
  name: string;
  fbVelo: number | null;
  veloMax: number | null;
};

function normalizeName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[%\s,]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowMetric(row: Record<string, unknown>, key: string): number | null {
  if (!(key in row)) return null;
  return parseNum(row[key]);
}

function rowMetricByAliases(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = rowMetric(row, key);
    if (value !== null) return value;
  }
  return null;
}

function rowMetricByPredicate(
  row: Record<string, unknown>,
  match: (key: string) => boolean,
  exclude?: (key: string) => boolean
): number | null {
  for (const [key, value] of Object.entries(row)) {
    const lower = key.toLowerCase();
    if (exclude && exclude(lower)) continue;
    if (!match(lower)) continue;
    const parsed = parseNum(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function findPitcherName(row: Record<string, unknown>): string {
  for (const [key, value] of Object.entries(row)) {
    if (key.toLowerCase().includes('pitcher')) return String(value ?? '').trim();
  }
  return String(row.Pitcher ?? row.pitcher ?? row.Name ?? row.name ?? '').trim();
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session))) {
    return NextResponse.json({ error: 'Programming access required.' }, { status: 403 });
  }
  const schoolCode = resolveProgrammingSchoolCode(session);
  if (schoolCode !== 'PCU') {
    return NextResponse.json({ rows: [] as VeloRow[] });
  }

  const inputUrl = new URL(request.url);
  const startDate = inputUrl.searchParams.get('startDate')?.trim() ?? '';
  const endDate = inputUrl.searchParams.get('endDate')?.trim() ?? '';
  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required.' }, { status: 400 });
  }

  const apiBase = resolveDashboardApiBaseUrl();
  const selectedSchoolCode = schoolCode;
  let scopedPitcher = '';
  if (session.role === 'player') {
    const organizationId = await resolveProgrammingOrganizationId(session);
    const ownPlayer = await getPlayerForUser({ organizationId, userId: session.userId ?? 0 });
    scopedPitcher = String(ownPlayer?.fullName ?? '').trim();
  }

  const url = new URL(`${apiBase}/v1/pitching/overview`);
  url.searchParams.set('school_code', selectedSchoolCode);
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('table_mode', 'Custom');
  url.searchParams.set('split_by', 'Pitcher');
  url.searchParams.set('custom_columns', 'Velo,Max');
  url.searchParams.set('pitch_types', 'Fastball,Sinker');
  url.searchParams.set('include_chart_points', '0');
  url.searchParams.set('include_row_pitches', '0');
  url.searchParams.set('include_trend_rows', '0');
  if (scopedPitcher) url.searchParams.set('pitcher', scopedPitcher);

  const cacheKey = `force-plate:fbsi-velo:${selectedSchoolCode}:${startDate}:${endDate}:${scopedPitcher || 'all'}`;
  const result = await fetchDashboardJsonWithCache({
    cacheKey,
    ttlMs: 45_000,
    staleTtlMs: 180_000,
    timeoutMs: 30_000,
    retries: 1,
    fetcher: (signal) =>
      fetch(url.toString(), {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal,
      }),
  });

  if (result.status < 200 || result.status >= 300) {
    return NextResponse.json(
      { error: String(result.payload.error ?? result.payload.detail ?? 'Failed to load velocity leaderboard.') },
      { status: 502 }
    );
  }

  const tableRows = Array.isArray((result.payload as { table_rows?: unknown[] }).table_rows)
    ? ((result.payload as { table_rows?: unknown[] }).table_rows as Array<Record<string, unknown>>)
    : [];

  const rows: VeloRow[] = [];
  for (const row of tableRows) {
    const name = findPitcherName(row);
    if (!name) continue;
    const fbVelo =
      rowMetricByAliases(row, ['Velo', 'velo', 'FBvelo', 'FB Velo']) ??
      rowMetricByPredicate(row, (k) => k.includes('velo') || k.includes('velocity'), (k) => k.includes('max'));
    const veloMax =
      rowMetricByAliases(row, ['Max', 'max', 'VeloMax', 'Max Velo']) ??
      rowMetricByPredicate(row, (k) => (k.includes('max') && (k.includes('velo') || k.includes('velocity'))) || k === 'max');
    rows.push({
      name,
      fbVelo,
      veloMax,
    });
  }

  return NextResponse.json({ rows });
}

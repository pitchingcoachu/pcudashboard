import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, shouldScopeDashboardPlayer } from '../../../../lib/dashboard-player-scope';
import { dashboardMetricLabel, dashboardMetricOptions, metricSampleColumn } from '../../../../lib/dashboard-metric-catalog';
import { fetchDashboardJsonWithCache } from '../../../../lib/dashboard-route-cache';
import { resolvePercentileComparisonWindow } from '../../../../lib/percentile-window';

export const maxDuration = 300;

type Domain = 'pitching' | 'hitting' | 'catching';
type Pool = 'ORG' | 'D1' | 'D2' | 'D3' | 'NAIA' | 'JUCO' | 'MLB' | 'AAA';

const CATCHING_METRICS = ['#', '# Throws', 'Velo', 'ExchangeTime', 'PopTime', 'SL+'];
const POOLS = new Set<Pool>(['ORG', 'D1', 'D2', 'D3', 'NAIA', 'JUCO', 'MLB', 'AAA']);
const BASEBALL_FILTER_PARAMS = [
  'session_type', 'pitch_types', 'ball_types', 'batter_side', 'hand', 'pitch_results', 'qp_locations',
  'in_zone', 'count_filter', 'after_count_filter', 'zone_locations', 'velo_min', 'velo_max', 'ivb_min',
  'ivb_max', 'hb_min', 'hb_max',
] as const;
const LOWER_PITCHING = new Set(['bbpct', 'hrpct', 'ev', 'rv100', 'pv100', 'era', 'fip', 'xfip', 'siera', 'whip', 'itmissavg', 'itmissmed']);
const LOWER_HITTING = new Set(['kpct', 'whiffpct', 'whiffrate', 'swstrkpct', 'zwhiffpct', 'chasepct', 'calledspct']);
const LOWER_CATCHING = new Set(['exchangetime', 'poptime']);

function token(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/%/g, 'pct').replace(/[^a-z0-9]/g, '');
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value ?? '').trim().replace(/,/g, '').replace(/%$/, '');
  if (!cleaned || cleaned === '-' || cleaned === '—') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowValue(row: Record<string, unknown>, column: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, column)) return row[column];
  const wanted = token(column);
  const key = Object.keys(row).find((candidate) => token(candidate) === wanted);
  return key ? row[key] : undefined;
}

function percentileForValue(value: number, values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 2 || Math.abs(sorted[sorted.length - 1] - sorted[0]) < 1e-9) return null;
  const bounded = Math.max(sorted[0], Math.min(sorted[sorted.length - 1], value));
  let less = 0;
  let equal = 0;
  for (const point of sorted) {
    if (point < bounded) less += 1;
    else if (point === bounded) equal += 1;
  }
  return Math.max(0, Math.min(100, ((less + equal * 0.5 - 0.5) / (sorted.length - 1)) * 100));
}

function isLowerBetter(domain: Domain, metric: string): boolean {
  const key = token(metric);
  return (domain === 'pitching' && LOWER_PITCHING.has(key))
    || (domain === 'hitting' && LOWER_HITTING.has(key))
    || (domain === 'catching' && LOWER_CATCHING.has(key));
}

function poolLabel(pool: Pool): string {
  if (pool === 'ORG') return 'Current Team / Organization';
  if (pool === 'D1') return 'NCAA Division I';
  if (pool === 'D2') return 'NCAA Division II';
  if (pool === 'D3') return 'NCAA Division III';
  if (pool === 'AAA') return 'Triple-A (AAA)';
  return pool;
}

function athleteColumn(domain: Domain): string {
  return domain === 'pitching' ? 'Pitcher' : domain === 'hitting' ? 'Batter' : 'Catcher';
}

function allowedMetric(domain: Domain, metric: string): boolean {
  if (domain === 'catching') return CATCHING_METRICS.includes(metric);
  return dashboardMetricOptions(domain).includes(metric);
}

async function loadOverview(url: URL): Promise<Record<string, unknown>> {
  const result = await fetchDashboardJsonWithCache({
    cacheKey: `baseball-percentile:${url.toString()}`,
    ttlMs: 60_000,
    staleTtlMs: 10 * 60_000,
    timeoutMs: 240_000,
    retries: 0,
    fetcher: () => fetch(url.toString(), { cache: 'no-store' }),
  });
  if (result.status < 200 || result.status >= 300) {
    const message = String(result.payload.error ?? result.payload.detail ?? `Dashboard API request failed (HTTP ${result.status}).`);
    throw new Error(message);
  }
  return result.payload;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const input = new URL(request.url);
  const domain = String(input.searchParams.get('domain') ?? '').trim().toLowerCase() as Domain;
  const metric = String(input.searchParams.get('metric') ?? '').trim();
  const requestedPool = String(input.searchParams.get('pool') ?? 'ORG').trim().toUpperCase() as Pool;
  if (!['pitching', 'hitting', 'catching'].includes(domain)) return NextResponse.json({ error: 'Invalid baseball data source.' }, { status: 400 });
  if (!metric || !allowedMetric(domain, metric)) return NextResponse.json({ error: 'Invalid metric.' }, { status: 400 });
  const pool: Pool = POOLS.has(requestedPool) ? requestedPool : 'ORG';

  const schoolCode = resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  });
  const mustScopePlayer = shouldScopeDashboardPlayer(session.role, schoolCode);
  const identity = mustScopePlayer
    ? await resolveDashboardPlayerIdentity({ role: session.role, organizationId: session.organizationId, userId: session.userId, name: session.name })
    : null;
  if (mustScopePlayer && !identity) return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });

  const playerParam = domain === 'pitching' ? 'pitcher' : domain === 'hitting' ? 'hitter' : 'catcher';
  const requestedPlayer = String(input.searchParams.get('player') ?? '').trim();
  const player = mustScopePlayer && identity ? scopedPlayerQueryName(identity, domain === 'catching' ? 'Catching' : domain === 'hitting' ? 'Hitting' : 'Pitching') : requestedPlayer;
  if (!player || player.toLowerCase() === 'all') return NextResponse.json({ error: 'Choose a specific athlete.' }, { status: 400 });

  const apiBase = resolveDashboardApiBaseUrl();
  const splitBy = athleteColumn(domain);
  const makeUrl = (targetSchool: string) => {
    const url = new URL(`${apiBase}/v1/${domain}/overview`);
    url.searchParams.set('school_code', targetSchool);
    url.searchParams.set('split_by', splitBy);
    url.searchParams.set('include_chart_points', '0');
    url.searchParams.set('include_row_pitches', '0');
    url.searchParams.set('include_trend_rows', '0');
    if (domain === 'catching') {
      url.searchParams.set('table_mode', 'Catching Data');
    } else {
      url.searchParams.set('table_mode', 'Custom');
      url.searchParams.set('custom_columns', `${metricSampleColumn(domain, metric)},${metric}`);
    }
    return url;
  };

  const currentUrl = makeUrl(schoolCode);
  currentUrl.searchParams.set(playerParam, player);
  const startDate = String(input.searchParams.get('start_date') ?? '').trim();
  const endDate = String(input.searchParams.get('end_date') ?? '').trim();
  if (startDate) currentUrl.searchParams.set('start_date', startDate);
  if (endDate) currentUrl.searchParams.set('end_date', endDate);

  const baselineSchool = pool === 'ORG' ? schoolCode : pool === 'MLB' || pool === 'AAA' ? 'PRO' : 'LEAGUE';
  const baselineUrl = makeUrl(baselineSchool);
  if (pool !== 'ORG') baselineUrl.searchParams.set('level', pool);
  const comparisonWindow = resolvePercentileComparisonWindow(input.searchParams);
  baselineUrl.searchParams.set('start_date', comparisonWindow.startDate);
  baselineUrl.searchParams.set('end_date', comparisonWindow.endDate);
  for (const key of BASEBALL_FILTER_PARAMS) {
    const value = String(input.searchParams.get(key) ?? '').trim();
    if (!value) continue;
    currentUrl.searchParams.set(key, value);
    baselineUrl.searchParams.set(key, value);
  }
  const teamType = String(input.searchParams.get('team') ?? '').trim();
  if (pool === 'ORG' && teamType && teamType.toLowerCase() !== 'all') baselineUrl.searchParams.set('team_type', teamType);

  try {
    const [currentPayload, baselinePayload] = await Promise.all([loadOverview(currentUrl), loadOverview(baselineUrl)]);
    const currentRows = Array.isArray(currentPayload.table_rows) ? currentPayload.table_rows as Array<Record<string, unknown>> : [];
    const baselineRows = Array.isArray(baselinePayload.table_rows) ? baselinePayload.table_rows as Array<Record<string, unknown>> : [];
    const currentRow = currentRows.find((row) => token(rowValue(row, splitBy)) === token(player))
      ?? currentRows.find((row) => ['all', 'overall'].includes(String(rowValue(row, splitBy) ?? '').trim().toLowerCase()))
      ?? currentRows[0];
    const value = currentRow ? numeric(rowValue(currentRow, metric)) : null;
    const distribution = baselineRows.flatMap((row) => {
      const athlete = String(rowValue(row, splitBy) ?? '').trim().toLowerCase();
      if (!athlete || athlete === 'all' || athlete === 'overall') return [];
      const candidate = numeric(rowValue(row, metric));
      return candidate === null ? [] : [candidate];
    });
    const raw = value === null ? null : percentileForValue(value, distribution);
    const lowerBetter = isLowerBetter(domain, metric);
    const percentile = raw === null ? null : lowerBetter ? 100 - raw : raw;
    return NextResponse.json({
      domain,
      metric,
      metricLabel: dashboardMetricLabel(metric),
      player,
      value,
      percentile,
      sampleSize: distribution.length,
      pool,
      poolLabel: poolLabel(pool),
      comparisonWindow: comparisonWindow.label,
      comparisonDateWindow: { startDate: comparisonWindow.startDate, endDate: comparisonWindow.endDate },
      rankingDirection: lowerBetter ? 'lower_is_better' : 'higher_is_better',
    }, { headers: { 'cache-control': 'private, max-age=30, stale-while-revalidate=300' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load baseball percentile data.' }, { status: 502 });
  }
}

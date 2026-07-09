import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, shouldScopeDashboardPlayer } from '../../../../../lib/dashboard-player-scope';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';

export const maxDuration = 300;
const PITCHING_OVERVIEW_CACHE_VERSION = 'adv-metrics-v9';

const RESPONSE_CACHE_HEADERS = {
  'cache-control': 'private, max-age=5, stale-while-revalidate=55',
} as const;
const SLOW_ROUTE_MS = 5000;

function parseSortableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[%\s,]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInningsToDecimal(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length > 2) return null;
  const whole = Number(parts[0] || '0');
  if (!Number.isFinite(whole)) return null;
  if (parts.length === 1) return whole;
  const outs = Number(parts[1] || '0');
  if (!Number.isFinite(outs)) return null;
  return whole + outs / 3;
}

function deriveFallbackEra(row: Record<string, unknown>): number | null {
  const ip = parseInningsToDecimal(row.IP);
  if (!ip || ip <= 0) return null;
  const hr = parseSortableNumber(row.HR) ?? 0;
  const bb = parseSortableNumber(row.BB) ?? 0;
  const hbp = parseSortableNumber(row.HBP) ?? 0;
  const k = parseSortableNumber(row.K) ?? 0;
  const h2 = parseSortableNumber(row['2B']) ?? 0;
  const h3 = parseSortableNumber(row['3B']) ?? 0;
  const h = parseSortableNumber(row.H) ?? 0;
  const h1Raw = parseSortableNumber(row['1B']);
  const h1 = h1Raw ?? Math.max(0, h - h2 - h3 - hr);
  const erEstimate =
    (0.47 * h1) +
    (0.78 * h2) +
    (1.09 * h3) +
    (1.4 * hr) +
    (0.33 * (bb + hbp)) -
    (0.1 * k);
  if (!Number.isFinite(erEstimate)) return null;
  return Math.max(0, (9 * erEstimate) / ip);
}

function deriveFallbackFip(row: Record<string, unknown>): number | null {
  const ip = parseInningsToDecimal(row.IP);
  if (!ip || ip <= 0) return null;
  const hr = parseSortableNumber(row.HR) ?? 0;
  const bb = parseSortableNumber(row.BB) ?? 0;
  const hbp = parseSortableNumber(row.HBP) ?? 0;
  const k = parseSortableNumber(row.K) ?? 0;
  const fip = ((13 * hr) + (3 * (bb + hbp)) - (2 * k)) / ip + 3.2;
  return Number.isFinite(fip) ? fip : null;
}

function deriveFallbackXFip(row: Record<string, unknown>): number | null {
  const ip = parseInningsToDecimal(row.IP);
  if (!ip || ip <= 0) return null;
  const bb = parseSortableNumber(row.BB) ?? 0;
  const hbp = parseSortableNumber(row.HBP) ?? 0;
  const k = parseSortableNumber(row.K) ?? 0;
  const hits = parseSortableNumber(row.H) ?? 0;
  const babip = parseSortableNumber(row.BABIP);
  const gbPctRaw = parseSortableNumber(row['GB%']);
  if (babip === null || babip <= 0 || gbPctRaw === null) return null;
  const inPlay = hits / babip;
  if (!Number.isFinite(inPlay) || inPlay <= 0) return null;
  const gbRate = Math.max(0, Math.min(1, gbPctRaw / 100));
  const fb = Math.max(0, inPlay * (1 - gbRate));
  const xHr = fb * 0.12;
  const xfip = ((13 * xHr) + (3 * (bb + hbp)) - (2 * k)) / ip + 3.2;
  return Number.isFinite(xfip) ? xfip : null;
}

function isAllLikeRowValue(value: unknown): boolean {
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'all' || text === 'all (pinned)';
}

function withEraBackfill(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const data = payload as { table_rows?: unknown[] };
  if (!Array.isArray(data.table_rows)) return payload;
  let changed = false;
  const nextRows = data.table_rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const rowObj = row as Record<string, unknown>;
    const eraRaw = rowObj.ERA;
    const hasEra =
      (typeof eraRaw === 'number' && Number.isFinite(eraRaw)) ||
      (typeof eraRaw === 'string' && eraRaw.trim().length > 0);
    if (hasEra) return row;
    const fallback = deriveFallbackEra(rowObj);
    if (fallback === null) return row;
    changed = true;
    return { ...rowObj, ERA: Number(fallback.toFixed(2)) };
  });
  if (!changed) return payload;
  return { ...(payload as Record<string, unknown>), table_rows: nextRows };
}

function withAdvancedAllRowBackfill(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const data = payload as { table_rows?: unknown[]; table_columns?: unknown[] };
  if (!Array.isArray(data.table_rows) || !Array.isArray(data.table_columns)) return payload;
  const splitColumn = String(data.table_columns[0] ?? '').trim();
  if (!splitColumn) return payload;
  let changed = false;
  const nextRows = data.table_rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const rowObj = row as Record<string, unknown>;
    if (!isAllLikeRowValue(rowObj[splitColumn])) return row;
    const era = parseSortableNumber(rowObj.ERA);
    const fip = parseSortableNumber(rowObj.FIP);
    const xfip = parseSortableNumber(rowObj.xFIP);
    let next = rowObj;
    if ((fip === null || (era !== null && Math.abs(fip - era) < 0.005))) {
      const fallbackFip = deriveFallbackFip(rowObj);
      if (fallbackFip !== null) {
        next = { ...next, FIP: Number(fallbackFip.toFixed(2)) };
      }
    }
    if ((xfip === null || (era !== null && Math.abs(xfip - era) < 0.005))) {
      const fallbackXFip = deriveFallbackXFip(rowObj);
      if (fallbackXFip !== null) {
        next = { ...next, xFIP: Number(fallbackXFip.toFixed(2)) };
      }
    }
    if (next !== rowObj) changed = true;
    return next;
  });
  if (!changed) return payload;
  return { ...(payload as Record<string, unknown>), table_rows: nextRows };
}

function applyOverviewBackfills(payload: unknown): unknown {
  // Do not mutate ERA/FIP/xFIP in the gateway. Use upstream values as source-of-truth.
  return payload;
}

function resolveOverviewTimeoutMs(schoolCode: string): number {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (upper === 'LEAGUE') return 60000;
  if (upper === 'PRO') return 45000;
  return 60000;
}

function resolveOverviewCachePolicy(
  schoolCode: string,
  options?: { preferBroadLeaderboardCache?: boolean }
): { ttlMs: number; staleTtlMs: number } {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (upper === 'PRO') return { ttlMs: 90000, staleTtlMs: 600000 };
  if (upper === 'LEAGUE' && options?.preferBroadLeaderboardCache) return { ttlMs: 90000, staleTtlMs: 600000 };
  if (upper === 'LEAGUE') return { ttlMs: 30000, staleTtlMs: 120000 };
  return { ttlMs: 45000, staleTtlMs: 180000 };
}

function resolveOverviewRetries(schoolCode: string): number {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  // League overview/heatmap requests are long-running and most exposed to brief
  // backend restarts; allow a couple retries before surfacing an error.
  if (upper === 'LEAGUE') return 2;
  return 1;
}

function parseIsoDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isTruthy(value: string): boolean {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function hasNonEmptyTableRows(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const rows = (payload as { table_rows?: unknown }).table_rows;
  return Array.isArray(rows) && rows.length > 0;
}

function hasValue(value: string): boolean {
  return String(value ?? '').trim().length > 0;
}

function trimCustomColumnsForBaseline(raw: string, maxCols = 48): string {
  const deduped = Array.from(
    new Set(
      String(raw ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    )
  );
  if (deduped.length <= maxCols) return deduped.join(',');
  return deduped.slice(0, maxCols).join(',');
}

async function maybeAttachPitchingHeatmapRollup(params: {
  request: Request;
  payload: unknown;
  schoolCode: string;
  startDate: string;
  endDate: string;
  sessionType: string;
  hand: string;
  batterSide: string;
  pitcher: string;
  teamType: string;
  pitchTypes: string;
  ballTypes?: string;
  includeChartPoints: string;
  chartOnly: string;
  splitBy: string;
  forceRaw: string;
  inZone: string;
  qpLocations: string;
  zoneLocations: string;
  pitchResults: string;
  countFilter: string;
  afterCountFilter: string;
  veloMin: string;
  veloMax: string;
  ivbMin: string;
  ivbMax: string;
  hbMin: string;
  hbMax: string;
  pcMin: string;
  pcMax: string;
}): Promise<unknown> {
  const {
    request,
    payload,
    schoolCode,
    startDate,
    endDate,
    sessionType,
    hand,
    batterSide,
    pitcher,
    teamType,
    pitchTypes,
    ballTypes = '',
    includeChartPoints,
    chartOnly,
    splitBy,
    forceRaw,
    inZone,
    qpLocations,
    zoneLocations,
    pitchResults,
    countFilter,
    afterCountFilter,
    veloMin,
    veloMax,
    ivbMin,
    ivbMax,
    hbMin,
    hbMax,
    pcMin,
    pcMax,
  } = params;
  const includeChartsRequested = isTruthy(includeChartPoints);
  if (!includeChartsRequested) return payload;
  if (String(splitBy ?? '').trim().toLowerCase() === 'game') return payload;
  if (isTruthy(forceRaw)) return payload;
  const isChartOnly = isTruthy(chartOnly);
  if (isChartOnly && String(schoolCode ?? '').trim().toUpperCase() !== 'LEAGUE') return payload;
  const hasUnsupportedFilters =
    hasValue(inZone) ||
    hasValue(qpLocations) ||
    hasValue(ballTypes) ||
    hasValue(zoneLocations) ||
    hasValue(pitchResults) ||
    hasValue(countFilter) ||
    hasValue(afterCountFilter) ||
    hasValue(veloMin) ||
    hasValue(veloMax) ||
    hasValue(ivbMin) ||
    hasValue(ivbMax) ||
    hasValue(hbMin) ||
    hasValue(hbMax) ||
    hasValue(pcMin) ||
    hasValue(pcMax);
  if (hasUnsupportedFilters) return payload;

  try {
    const requestUrl = new URL(request.url);
    const origin = `${requestUrl.protocol}//${requestUrl.host}`;
    const rollup = new URL('/api/dashboard/pitching/heatmap-rollup', origin);
    rollup.searchParams.set('school_code', schoolCode);
    if (startDate) rollup.searchParams.set('start_date', startDate);
    if (endDate) rollup.searchParams.set('end_date', endDate);
    if (sessionType) rollup.searchParams.set('session_type', sessionType);
    if (hand) rollup.searchParams.set('hand', hand);
    if (batterSide) rollup.searchParams.set('batter_side', batterSide);
    if (pitcher) rollup.searchParams.set('pitcher', pitcher);
    if (teamType) rollup.searchParams.set('team_type', teamType);
    if (pitchTypes) rollup.searchParams.set('pitch_types', pitchTypes);
    const response = await fetch(rollup.toString(), {
      cache: 'no-store',
      headers: { cookie: request.headers.get('cookie') ?? '' },
    });
    if (!response.ok) return payload;
    const rollupPayload = (await response.json().catch(() => ({}))) as { chart_points?: unknown[]; heatmap_points?: unknown[] };
    const rollupPoints = Array.isArray(rollupPayload.chart_points) ? rollupPayload.chart_points : [];
    if (!rollupPoints.length) return payload;
    if (!payload || typeof payload !== 'object') return payload;
    const next = payload as Record<string, unknown>;
    return {
      ...next,
      chart_points: rollupPoints,
      heatmap_points: Array.isArray(rollupPayload.heatmap_points) && rollupPayload.heatmap_points.length
        ? rollupPayload.heatmap_points
        : rollupPoints,
    };
  } catch {
    return payload;
  }
}

async function maybeReturnPitchingHeatmapRollupDirect(params: {
  request: Request;
  schoolCode: string;
  startDate: string;
  endDate: string;
  sessionType: string;
  hand: string;
  batterSide: string;
  pitcher: string;
  teamType: string;
  pitchTypes: string;
  includeChartPoints: string;
  chartOnly: string;
  inZone: string;
  qpLocations: string;
  zoneLocations: string;
  pitchResults: string;
  countFilter: string;
  afterCountFilter: string;
  veloMin: string;
  veloMax: string;
  ivbMin: string;
  ivbMax: string;
  hbMin: string;
  hbMax: string;
  pcMin: string;
  pcMax: string;
}): Promise<NextResponse | null> {
  const {
    request,
    schoolCode,
    startDate,
    endDate,
    sessionType,
    hand,
    batterSide,
    pitcher,
    teamType,
    pitchTypes,
    includeChartPoints,
    chartOnly,
    inZone,
    qpLocations,
    zoneLocations,
    pitchResults,
    countFilter,
    afterCountFilter,
    veloMin,
    veloMax,
    ivbMin,
    ivbMax,
    hbMin,
    hbMax,
    pcMin,
    pcMax,
  } = params;
  if (!isTruthy(includeChartPoints) || !isTruthy(chartOnly)) return null;
  if (String(schoolCode ?? '').trim().toUpperCase() !== 'LEAGUE') return null;
  const hasUnsupportedFilters =
    hasValue(inZone) ||
    hasValue(qpLocations) ||
    hasValue(zoneLocations) ||
    hasValue(pitchResults) ||
    hasValue(countFilter) ||
    hasValue(afterCountFilter) ||
    hasValue(veloMin) ||
    hasValue(veloMax) ||
    hasValue(ivbMin) ||
    hasValue(ivbMax) ||
    hasValue(hbMin) ||
    hasValue(hbMax) ||
    hasValue(pcMin) ||
    hasValue(pcMax);
  if (hasUnsupportedFilters) return null;

  try {
    const requestUrl = new URL(request.url);
    const origin = `${requestUrl.protocol}//${requestUrl.host}`;
    const rollup = new URL('/api/dashboard/pitching/heatmap-rollup', origin);
    rollup.searchParams.set('school_code', schoolCode);
    if (startDate) rollup.searchParams.set('start_date', startDate);
    if (endDate) rollup.searchParams.set('end_date', endDate);
    if (sessionType) rollup.searchParams.set('session_type', sessionType);
    if (hand) rollup.searchParams.set('hand', hand);
    if (batterSide) rollup.searchParams.set('batter_side', batterSide);
    if (pitcher) rollup.searchParams.set('pitcher', pitcher);
    if (teamType) rollup.searchParams.set('team_type', teamType);
    if (pitchTypes) rollup.searchParams.set('pitch_types', pitchTypes);
    const response = await fetch(rollup.toString(), { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(payload, {
      headers: {
        ...RESPONSE_CACHE_HEADERS,
        'x-dashboard-fallback': 'pitching-heatmap-rollup-direct',
      },
    });
  } catch {
    return null;
  }
}

async function fetchProSafePitchingLeaderboard(params: {
  apiBase: string;
  schoolCode: string;
  level: string;
  startDate: string;
  endDate: string;
  splitBy: string;
  tableMode: string;
  customColumns: string;
  cachePolicy: { ttlMs: number; staleTtlMs: number };
  timeoutMs: number;
  retries: number;
}) {
  const { apiBase, schoolCode, level, startDate, endDate, splitBy, tableMode, customColumns, cachePolicy, timeoutMs, retries } = params;
  const fallbackUrl = new URL(`${apiBase}/v1/pitching/overview`);
  fallbackUrl.searchParams.set('school_code', schoolCode);
  if (startDate) fallbackUrl.searchParams.set('start_date', startDate);
  if (endDate) fallbackUrl.searchParams.set('end_date', endDate);
  fallbackUrl.searchParams.set('team_type', 'All');
  if (level && level !== 'All') fallbackUrl.searchParams.set('level', level);
  fallbackUrl.searchParams.set('table_mode', tableMode || 'Live');
  if (customColumns) fallbackUrl.searchParams.set('custom_columns', customColumns);
  fallbackUrl.searchParams.set('split_by', splitBy === 'Pitcher Team' ? 'Pitcher Team' : 'Pitcher');
  fallbackUrl.searchParams.set('include_chart_points', '0');
  fallbackUrl.searchParams.set('include_row_pitches', '0');
  fallbackUrl.searchParams.set('include_trend_rows', '0');
  const fallback = await fetchDashboardJsonWithCache({
    cacheKey: `pitching:overview:pro-safe-leaderboard:${fallbackUrl.toString()}`,
    ttlMs: cachePolicy.ttlMs,
    staleTtlMs: cachePolicy.staleTtlMs,
    timeoutMs,
    retries,
    fetcher: () => fetch(fallbackUrl.toString(), { cache: 'no-store' }),
  });
  return fallback;
}

async function fetchLeagueSafePitchingLeaderboard(params: {
  apiBase: string;
  schoolCode: string;
  startDate: string;
  endDate: string;
  splitBy: string;
  tableMode: string;
  customColumns: string;
  cachePolicy: { ttlMs: number; staleTtlMs: number };
  timeoutMs: number;
  retries: number;
}) {
  const { apiBase, schoolCode, startDate, endDate, splitBy, tableMode, customColumns, cachePolicy, timeoutMs, retries } = params;
  const fallbackUrl = new URL(`${apiBase}/v1/pitching/overview`);
  fallbackUrl.searchParams.set('school_code', schoolCode);
  if (startDate) fallbackUrl.searchParams.set('start_date', startDate);
  if (endDate) fallbackUrl.searchParams.set('end_date', endDate);
  fallbackUrl.searchParams.set('team_type', 'All');
  fallbackUrl.searchParams.set('table_mode', tableMode || 'Live');
  if (customColumns) fallbackUrl.searchParams.set('custom_columns', customColumns);
  fallbackUrl.searchParams.set('split_by', splitBy === 'Pitcher Team' ? 'Pitcher Team' : 'Pitcher');
  fallbackUrl.searchParams.set('include_chart_points', '0');
  fallbackUrl.searchParams.set('include_row_pitches', '0');
  fallbackUrl.searchParams.set('include_trend_rows', '0');
  return fetchDashboardJsonWithCache({
    cacheKey: `pitching:overview:league-safe-leaderboard:${fallbackUrl.toString()}`,
    ttlMs: cachePolicy.ttlMs,
    staleTtlMs: cachePolicy.staleTtlMs,
    timeoutMs,
    retries,
    fetcher: () => fetch(fallbackUrl.toString(), { cache: 'no-store' }),
  });
}

async function maybeReturnPitchingPitchTypesRollup(params: {
  request: Request;
  schoolCode: string;
  startDate: string;
  endDate: string;
  level: string;
  sessionType: string;
  hand: string;
  batterSide: string;
  teamType: string;
  pitchTypes: string;
  customColumns: string;
}): Promise<NextResponse | null> {
  const {
    request,
    schoolCode,
    startDate,
    endDate,
    level,
    sessionType,
    hand,
    batterSide,
    teamType,
    pitchTypes,
    customColumns,
  } = params;
  try {
    const requestUrl = new URL(request.url);
    const origin = `${requestUrl.protocol}//${requestUrl.host}`;
    const rollup = new URL('/api/dashboard/pitching/table-rollup', origin);
    rollup.searchParams.set('school_code', schoolCode);
    if (startDate) rollup.searchParams.set('start_date', startDate);
    if (endDate) rollup.searchParams.set('end_date', endDate);
    if (level) rollup.searchParams.set('level', level);
    if (sessionType) rollup.searchParams.set('session_type', sessionType);
    if (hand) rollup.searchParams.set('hand', hand);
    if (batterSide) rollup.searchParams.set('batter_side', batterSide);
    if (teamType) rollup.searchParams.set('team_type', teamType);
    if (pitchTypes) rollup.searchParams.set('pitch_types', pitchTypes);
    if (customColumns) rollup.searchParams.set('custom_columns', customColumns);
    rollup.searchParams.set('split_by', 'Pitch Types');
    const response = await fetch(rollup.toString(), {
      cache: 'no-store',
      headers: { cookie: request.headers.get('cookie') ?? '' },
    });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(payload, {
      headers: {
        ...RESPONSE_CACHE_HEADERS,
        'x-dashboard-fallback': 'pitching-pitch-types-rollup',
      },
    });
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const routeStartedAt = Date.now();
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const inputUrl = new URL(request.url);
  const startDate = inputUrl.searchParams.get('start_date')?.trim() ?? '';
  const endDate = inputUrl.searchParams.get('end_date')?.trim() ?? '';
  const pitcher = inputUrl.searchParams.get('pitcher')?.trim() ?? '';
  const teamType = inputUrl.searchParams.get('team_type')?.trim() ?? '';
  const oppHitter = inputUrl.searchParams.get('opp_hitter')?.trim() ?? '';
  const withVideo = inputUrl.searchParams.get('with_video')?.trim() ?? '';
  const breakLines = inputUrl.searchParams.get('break_lines')?.trim() ?? '';
  const stuffLevel = inputUrl.searchParams.get('stuff_level')?.trim() ?? '';
  const stuffBase = inputUrl.searchParams.get('stuff_base')?.trim() ?? '';
  const hand = inputUrl.searchParams.get('hand')?.trim() ?? '';
  const batterSide = inputUrl.searchParams.get('batter_side')?.trim() ?? '';
  const venue = inputUrl.searchParams.get('venue')?.trim() ?? '';
  const sessionType = inputUrl.searchParams.get('session_type')?.trim() ?? '';
  const level = inputUrl.searchParams.get('level')?.trim() ?? '';
  const tableMode = inputUrl.searchParams.get('table_mode')?.trim() ?? '';
  const splitBy = inputUrl.searchParams.get('split_by')?.trim() ?? '';
  const rawCustomColumns = inputUrl.searchParams.get('custom_columns')?.trim() ?? '';
  const visualOption = inputUrl.searchParams.get('visual_option')?.trim() ?? '';
  const inZone = inputUrl.searchParams.get('in_zone')?.trim() ?? '';
  const qpLocations = inputUrl.searchParams.get('qp_locations')?.trim() ?? '';
  const pitchTypes = inputUrl.searchParams.get('pitch_types')?.trim() ?? '';
  const ballTypes = inputUrl.searchParams.get('ball_types')?.trim() ?? '';
  const zoneLocations = inputUrl.searchParams.get('zone_locations')?.trim() ?? '';
  const pitchResults = inputUrl.searchParams.get('pitch_results')?.trim() ?? '';
  const countFilter = inputUrl.searchParams.get('count_filter')?.trim() ?? '';
  const afterCountFilter = inputUrl.searchParams.get('after_count_filter')?.trim() ?? '';
  const veloMin = inputUrl.searchParams.get('velo_min')?.trim() ?? '';
  const veloMax = inputUrl.searchParams.get('velo_max')?.trim() ?? '';
  const ivbMin = inputUrl.searchParams.get('ivb_min')?.trim() ?? '';
  const ivbMax = inputUrl.searchParams.get('ivb_max')?.trim() ?? '';
  const hbMin = inputUrl.searchParams.get('hb_min')?.trim() ?? '';
  const hbMax = inputUrl.searchParams.get('hb_max')?.trim() ?? '';
  const pcMin = inputUrl.searchParams.get('pc_min')?.trim() ?? '';
  const pcMax = inputUrl.searchParams.get('pc_max')?.trim() ?? '';
  const bfMin = inputUrl.searchParams.get('bf_min')?.trim() ?? '';
  const bfMax = inputUrl.searchParams.get('bf_max')?.trim() ?? '';
  const ipMin = inputUrl.searchParams.get('ip_min')?.trim() ?? '';
  const ipMax = inputUrl.searchParams.get('ip_max')?.trim() ?? '';
  const includeChartPoints = inputUrl.searchParams.get('include_chart_points')?.trim() ?? '';
  const chartPointsLimit = inputUrl.searchParams.get('chart_points_limit')?.trim() ?? '';
  const chartOnly = inputUrl.searchParams.get('chart_only')?.trim() ?? '';
  const forceRaw = inputUrl.searchParams.get('force_raw')?.trim() ?? '';
  const percentileBaseline = isTruthy(inputUrl.searchParams.get('percentile_baseline')?.trim() ?? '');
  const percentilePool = inputUrl.searchParams.get('percentile_pool')?.trim().toLowerCase() ?? '';
  const useMlbPercentilePool = percentileBaseline && percentilePool === 'mlb';
  const customColumns = percentileBaseline
    ? trimCustomColumnsForBaseline(rawCustomColumns, 48)
    : rawCustomColumns;
  const includeRowPitches = inputUrl.searchParams.get('include_row_pitches')?.trim() ?? '';
  const includeTrendRows = inputUrl.searchParams.get('include_trend_rows')?.trim() ?? '';
  const resolvedSchoolCode = resolveDashboardSchoolCode({
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
  const schoolCode = percentileBaseline
    ? (useMlbPercentilePool ? 'PRO' : (String(resolvedSchoolCode).trim().toUpperCase() === 'PRO' ? 'PRO' : 'LEAGUE'))
    : resolvedSchoolCode;
  const shouldScopePlayer = !percentileBaseline && shouldScopeDashboardPlayer(session.role, schoolCode);
  let playerIdentity = null as Awaited<ReturnType<typeof resolveDashboardPlayerIdentity>>;
  if (shouldScopePlayer) {
    try {
      playerIdentity = await resolveDashboardPlayerIdentity({
        role: session.role,
        organizationId: session.organizationId,
        userId: session.userId,
        name: session.name,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Failed to resolve player identity.',
        },
        { status: 502 }
      );
    }
  }
  if (shouldScopePlayer && !playerIdentity) {
    return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
  }
    const scopedPitcher = shouldScopePlayer && playerIdentity ? scopedPlayerQueryName(playerIdentity, 'Pitching') : '';
    const directHeatmapRollup = await maybeReturnPitchingHeatmapRollupDirect({
      request,
      schoolCode,
      startDate,
      endDate,
      sessionType,
      hand,
      batterSide,
      pitcher: scopedPitcher || pitcher,
      teamType,
      pitchTypes,
      includeChartPoints: includeChartPoints || '',
      chartOnly: chartOnly || '',
      inZone,
      qpLocations,
      zoneLocations,
      pitchResults,
      countFilter,
      afterCountFilter,
      veloMin,
      veloMax,
      ivbMin,
      ivbMax,
      hbMin,
      hbMax,
      pcMin,
      pcMax,
    });
    if (directHeatmapRollup) return directHeatmapRollup;

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/pitching/overview`);
  url.searchParams.set('school_code', schoolCode);
  if (startDate) url.searchParams.set('start_date', startDate);
  if (endDate) url.searchParams.set('end_date', endDate);
  if (scopedPitcher) url.searchParams.set('pitcher', scopedPitcher);
  else if (!percentileBaseline && pitcher) url.searchParams.set('pitcher', pitcher);
  if (teamType) url.searchParams.set('team_type', teamType);
  if (oppHitter) url.searchParams.set('opp_hitter', oppHitter);
  if (withVideo) url.searchParams.set('with_video', withVideo);
  if (breakLines) url.searchParams.set('break_lines', breakLines);
  if (stuffLevel) url.searchParams.set('stuff_level', stuffLevel);
  if (stuffBase) url.searchParams.set('stuff_base', stuffBase);
  if (hand) url.searchParams.set('hand', hand);
  if (batterSide) url.searchParams.set('batter_side', batterSide);
  if (venue) url.searchParams.set('venue', venue);
  if (sessionType) url.searchParams.set('session_type', sessionType);
  if (level) url.searchParams.set('level', level);
  if (tableMode) url.searchParams.set('table_mode', tableMode);
  if (splitBy) url.searchParams.set('split_by', splitBy);
  if (customColumns) url.searchParams.set('custom_columns', customColumns);
  if (visualOption) url.searchParams.set('visual_option', visualOption);
  if (inZone) url.searchParams.set('in_zone', inZone);
  if (qpLocations) url.searchParams.set('qp_locations', qpLocations);
  if (pitchTypes) url.searchParams.set('pitch_types', pitchTypes);
  if (ballTypes && String(schoolCode ?? '').trim().toUpperCase() !== 'PRO' && String(schoolCode ?? '').trim().toUpperCase() !== 'LEAGUE') {
    url.searchParams.set('ball_types', ballTypes);
    url.searchParams.set('force_raw', '1');
  }
  if (zoneLocations) url.searchParams.set('zone_locations', zoneLocations);
  if (pitchResults) url.searchParams.set('pitch_results', pitchResults);
  if (countFilter) url.searchParams.set('count_filter', countFilter);
  if (afterCountFilter) url.searchParams.set('after_count_filter', afterCountFilter);
  if (veloMin) url.searchParams.set('velo_min', veloMin);
  if (veloMax) url.searchParams.set('velo_max', veloMax);
  if (ivbMin) url.searchParams.set('ivb_min', ivbMin);
  if (ivbMax) url.searchParams.set('ivb_max', ivbMax);
  if (hbMin) url.searchParams.set('hb_min', hbMin);
  if (hbMax) url.searchParams.set('hb_max', hbMax);
  if (pcMin) url.searchParams.set('pc_min', pcMin);
  if (pcMax) url.searchParams.set('pc_max', pcMax);
  if (bfMin) url.searchParams.set('bf_min', bfMin);
  if (bfMax) url.searchParams.set('bf_max', bfMax);
  if (ipMin) url.searchParams.set('ip_min', ipMin);
  if (ipMax) url.searchParams.set('ip_max', ipMax);
  const isLeague = String(schoolCode ?? '').trim().toUpperCase() === 'LEAGUE';
  const isPro = String(schoolCode ?? '').trim().toUpperCase() === 'PRO';
  const isLeaderboardLikeSplit = splitBy === 'Pitcher' || splitBy === 'Pitcher Team';
  const normalizedTableMode = tableMode.toLowerCase();
  const proLeaderboardDefaultModeRequested = !normalizedTableMode || normalizedTableMode === 'live';
  const leagueLeaderboardDefaultModeRequested = !normalizedTableMode || normalizedTableMode === 'live';
  const customModeRequested = tableMode.toLowerCase() === 'custom' || customColumns.length > 0;
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const daySpan = start && end ? Math.floor((end.getTime() - start.getTime()) / 86400000) + 1 : 0;
  const forceLeagueLight = isLeague && daySpan >= 14;
  const includeChartsRequested = isTruthy(includeChartPoints);
  const includeChartsExplicitlyDisabled = hasValue(includeChartPoints) && !includeChartsRequested;
  const includeTrendRowsRequested = isTruthy(includeTrendRows);
  const requestedPitcher = percentileBaseline ? '' : pitcher;
  const broadScope =
    !scopedPitcher &&
    !requestedPitcher &&
    !oppHitter &&
    (!teamType || teamType.toLowerCase() === 'all');

  if (includeChartPoints) url.searchParams.set('include_chart_points', includeChartPoints);
  if (chartPointsLimit) url.searchParams.set('chart_points_limit', chartPointsLimit);
  if (chartOnly) url.searchParams.set('chart_only', chartOnly);
  if (forceRaw) url.searchParams.set('force_raw', forceRaw);
  if (percentileBaseline) url.searchParams.set('percentile_baseline', '1');
  if (includeRowPitches) url.searchParams.set('include_row_pitches', includeRowPitches);
  if (includeTrendRows) url.searchParams.set('include_trend_rows', includeTrendRows);
  if (forceLeagueLight) {
    if (!hasValue(includeChartPoints)) {
      // Default large LEAGUE windows to light charts only when caller did not specify.
      url.searchParams.set('include_chart_points', '1');
      url.searchParams.set('chart_points_limit', '600');
    } else if (includeChartsExplicitlyDisabled) {
      // Respect explicit table-only requests (leaderboard fast-path).
      url.searchParams.set('include_chart_points', '0');
      url.searchParams.delete('chart_points_limit');
    }
    url.searchParams.set('include_row_pitches', '0');
    url.searchParams.set('include_trend_rows', '0');
  } else if (isLeague && !includeRowPitches) {
    // Default League calls to lighter payload unless explicitly requested for short windows.
    url.searchParams.set('include_row_pitches', '0');
  }
  if (!includeChartsRequested && !includeTrendRowsRequested && broadScope && daySpan >= 21 && !chartOnly) {
    url.searchParams.set('include_chart_points', '0');
    url.searchParams.set('include_row_pitches', '0');
    url.searchParams.set('include_trend_rows', '0');
  }
  if (shouldScopePlayer) {
    const requestedLimit = Number(url.searchParams.get('chart_points_limit') ?? '0');
    const cappedLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 400) : 400;
    url.searchParams.set('include_chart_points', '1');
    url.searchParams.set('chart_points_limit', String(cappedLimit));
    url.searchParams.set('include_row_pitches', '0');
  } else if (isTruthy(url.searchParams.get('include_chart_points') ?? '')) {
    const requestedLimit = Number(url.searchParams.get('chart_points_limit') ?? '0');
    const maxLimit = isTruthy(chartOnly) ? 6000 : (broadScope ? 600 : 2000);
    const cappedLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, maxLimit) : maxLimit;
    url.searchParams.set('chart_points_limit', String(cappedLimit));
  }
  const isProLeaderboardSplit = isPro && (splitBy === 'Pitcher' || splitBy === 'Pitcher Team');
  const proLeaderboardSafeModeRequested = proLeaderboardDefaultModeRequested || customModeRequested;
  const proBroadScope =
    isPro &&
    !scopedPitcher &&
    !requestedPitcher &&
    !oppHitter &&
    (!teamType || teamType.toLowerCase() === 'all');
  const hasProLeaderboardNarrowingFilters =
    hasValue(withVideo) ||
    hasValue(breakLines) ||
    hasValue(stuffLevel) ||
    hasValue(stuffBase) ||
    hasValue(hand) ||
    hasValue(batterSide) ||
    hasValue(venue) ||
    hasValue(sessionType) ||
    hasValue(qpLocations) ||
    hasValue(visualOption) ||
    hasValue(inZone) ||
    hasValue(pitchTypes) ||
    hasValue(ballTypes) ||
    hasValue(zoneLocations) ||
    hasValue(pitchResults) ||
    hasValue(countFilter) ||
    hasValue(afterCountFilter) ||
    hasValue(veloMin) ||
    hasValue(veloMax) ||
    hasValue(ivbMin) ||
    hasValue(ivbMax) ||
    hasValue(hbMin) ||
    hasValue(hbMax) ||
    hasValue(pcMin) ||
    hasValue(pcMax) ||
    hasValue(bfMin) ||
    hasValue(bfMax) ||
    hasValue(ipMin) ||
    hasValue(ipMax) ||
    hasValue(chartOnly) ||
    hasValue(forceRaw);
  const hasLeagueLeaderboardNarrowingFilters =
    hasValue(withVideo) ||
    hasValue(breakLines) ||
    hasValue(stuffLevel) ||
    hasValue(stuffBase) ||
    hasValue(hand) ||
    hasValue(batterSide) ||
    hasValue(venue) ||
    hasValue(sessionType) ||
    hasValue(qpLocations) ||
    hasValue(visualOption) ||
    hasValue(inZone) ||
    hasValue(pitchTypes) ||
    hasValue(ballTypes) ||
    hasValue(zoneLocations) ||
    hasValue(pitchResults) ||
    hasValue(countFilter) ||
    hasValue(afterCountFilter) ||
    hasValue(veloMin) ||
    hasValue(veloMax) ||
    hasValue(ivbMin) ||
    hasValue(ivbMax) ||
    hasValue(hbMin) ||
    hasValue(hbMax) ||
    hasValue(pcMin) ||
    hasValue(pcMax) ||
    hasValue(bfMin) ||
    hasValue(bfMax) ||
    hasValue(ipMin) ||
    hasValue(ipMax) ||
    hasValue(chartOnly) ||
    hasValue(forceRaw);
  const leagueBroadLeaderboard =
    isLeague &&
    !shouldScopePlayer &&
    broadScope &&
    isLeaderboardLikeSplit &&
    !hasLeagueLeaderboardNarrowingFilters &&
    !isTruthy(chartOnly);
  const shouldForceLeaguePitchTypesRollup =
    isLeague &&
    !shouldScopePlayer &&
    !percentileBaseline &&
    broadScope &&
    daySpan >= 14 &&
    splitBy === 'Pitch Types' &&
    !includeChartsRequested &&
    !isTruthy(chartOnly) &&
    !hasValue(withVideo) &&
    !hasValue(breakLines) &&
    !hasValue(venue) &&
    !hasValue(qpLocations) &&
    !hasValue(inZone) &&
    !hasValue(zoneLocations) &&
    !hasValue(pitchResults) &&
    !hasValue(countFilter) &&
    !hasValue(afterCountFilter) &&
    !hasValue(veloMin) &&
    !hasValue(veloMax) &&
    !hasValue(ivbMin) &&
    !hasValue(ivbMax) &&
    !hasValue(hbMin) &&
    !hasValue(hbMax) &&
    !hasValue(pcMin) &&
    !hasValue(pcMax) &&
    !hasValue(bfMin) &&
    !hasValue(bfMax) &&
    !hasValue(ipMin) &&
    !hasValue(ipMax);
  const shouldFallbackProPitchTypesRollup =
    isPro &&
    !shouldScopePlayer &&
    !percentileBaseline &&
    proBroadScope &&
    splitBy === 'Pitch Types' &&
    !includeChartsRequested &&
    !isTruthy(chartOnly) &&
    !hasValue(withVideo) &&
    !hasValue(breakLines) &&
    !hasValue(venue) &&
    !hasValue(qpLocations) &&
    !hasValue(inZone) &&
    !hasValue(zoneLocations) &&
    !hasValue(pitchResults) &&
    !hasValue(countFilter) &&
    !hasValue(afterCountFilter) &&
    !hasValue(veloMin) &&
    !hasValue(veloMax) &&
    !hasValue(ivbMin) &&
    !hasValue(ivbMax) &&
    !hasValue(hbMin) &&
    !hasValue(hbMax) &&
    !hasValue(pcMin) &&
    !hasValue(pcMax) &&
    !hasValue(bfMin) &&
    !hasValue(bfMax) &&
    !hasValue(ipMin) &&
    !hasValue(ipMax);
  if (shouldForceLeaguePitchTypesRollup) {
    const rollupPayload = await maybeReturnPitchingPitchTypesRollup({
      request,
      schoolCode,
      startDate,
      endDate,
      level,
      sessionType,
      hand,
      batterSide,
      teamType: teamType && teamType !== 'All' ? teamType : 'All',
      pitchTypes,
      customColumns,
    });
    if (rollupPayload) return rollupPayload;
  }
  if (leagueBroadLeaderboard) {
    // Keep League broad leaderboard requests on rollup-only payloads.
    url.searchParams.set('team_type', 'All');
    if (leagueLeaderboardDefaultModeRequested) {
      url.searchParams.set('table_mode', 'Live');
    }
    url.searchParams.set('split_by', splitBy === 'Pitcher Team' ? 'Pitcher Team' : 'Pitcher');
    url.searchParams.set('include_chart_points', '0');
    url.searchParams.set('include_row_pitches', '0');
    url.searchParams.set('include_trend_rows', '0');
    const dropKeys = [
      'with_video',
      'break_lines',
      'hand',
      'batter_side',
      'venue',
      'session_type',
      'qp_locations',
      'visual_option',
      'in_zone',
      'pitch_types',
      'ball_types',
      'zone_locations',
      'pitch_results',
      'count_filter',
      'after_count_filter',
      'velo_min',
      'velo_max',
      'ivb_min',
      'ivb_max',
      'hb_min',
      'hb_max',
      'pc_min',
      'pc_max',
      'bf_min',
      'bf_max',
      'ip_min',
      'ip_max',
      'chart_only',
      'chart_points_limit',
    ] as const;
    for (const key of dropKeys) url.searchParams.delete(key);
    if (!customModeRequested) {
      url.searchParams.delete('custom_columns');
    }
  }
  const shouldForceProLeaderboardRollupShape =
    isProLeaderboardSplit &&
    proBroadScope &&
    daySpan >= 14 &&
    proLeaderboardDefaultModeRequested &&
    !hasProLeaderboardNarrowingFilters &&
    !customModeRequested &&
    !(percentileBaseline && splitBy === 'Pitcher' && !!pitchTypes) &&
    !isTruthy(chartOnly);
  if (shouldForceProLeaderboardRollupShape) {
    // Match league broad-window behavior: keep this request strictly rollup-safe.
    url.searchParams.set('team_type', 'All');
    url.searchParams.set('table_mode', 'Live');
    url.searchParams.set('split_by', splitBy === 'Pitcher Team' ? 'Pitcher Team' : 'Pitcher');
    url.searchParams.set('include_chart_points', '0');
    url.searchParams.set('include_row_pitches', '0');
    url.searchParams.set('include_trend_rows', '0');
    const dropKeys = [
      'with_video',
      'break_lines',
      'hand',
      'batter_side',
      'venue',
      'session_type',
      'qp_locations',
      'custom_columns',
      'visual_option',
      'in_zone',
      'pitch_types',
      'ball_types',
      'zone_locations',
      'pitch_results',
      'count_filter',
      'after_count_filter',
      'velo_min',
      'velo_max',
      'ivb_min',
      'ivb_max',
      'hb_min',
      'hb_max',
      'pc_min',
      'pc_max',
      'bf_min',
      'bf_max',
      'ip_min',
      'ip_max',
      'chart_only',
      'chart_points_limit',
    ] as const;
    for (const key of dropKeys) url.searchParams.delete(key);
  }
  const cachePolicy = resolveOverviewCachePolicy(schoolCode, { preferBroadLeaderboardCache: leagueBroadLeaderboard });
  const isGameSplit = splitBy === 'Game';
  const gameSplitCacheBuster = isGameSplit ? `:game:${Date.now()}` : '';
  const customShapeCacheBuster = customModeRequested ? ':custom-shape-v3' : '';
  // Accuracy-first: do not preemptively serve PRO leaderboard-safe rollup payloads.
  // This avoids ERA/FIP/xFIP/SIERA drift versus summary/player views, which use
  // the primary overview path.
  const shouldPreferProSafeLeaderboard = false;
  const shouldPreferLeagueSafeLeaderboard = leagueBroadLeaderboard;

  if (shouldPreferProSafeLeaderboard) {
    try {
      const fallback = await fetchProSafePitchingLeaderboard({
        apiBase,
        schoolCode,
        level,
        startDate,
        endDate,
        splitBy,
        tableMode,
        customColumns,
        cachePolicy,
        timeoutMs: 25000,
        retries: 0,
      });
      if (fallback.status >= 200 && fallback.status < 300 && hasNonEmptyTableRows(fallback.payload)) {
        return NextResponse.json(applyOverviewBackfills(fallback.payload), {
          headers: {
            ...RESPONSE_CACHE_HEADERS,
            'x-dashboard-cache': fallback.cached ? 'HIT' : 'MISS',
            'x-dashboard-cache-source': fallback.source,
            'x-dashboard-upstream-ms': String(fallback.durationMs),
            'x-dashboard-route-ms': String(Date.now() - routeStartedAt),
            'x-dashboard-fallback': 'pro-leaderboard-safe-primary',
          },
        });
      }
    } catch {
      // Continue to primary route logic below.
    }
  }
  if (shouldPreferLeagueSafeLeaderboard) {
    try {
      const fallback = await fetchLeagueSafePitchingLeaderboard({
        apiBase,
        schoolCode,
        startDate,
        endDate,
        splitBy,
        tableMode,
        customColumns,
        cachePolicy,
        timeoutMs: 20000,
        retries: 0,
      });
      if (fallback.status >= 200 && fallback.status < 300 && hasNonEmptyTableRows(fallback.payload)) {
        return NextResponse.json(applyOverviewBackfills(fallback.payload), {
          headers: {
            ...RESPONSE_CACHE_HEADERS,
            'x-dashboard-cache': fallback.cached ? 'HIT' : 'MISS',
            'x-dashboard-cache-source': fallback.source,
            'x-dashboard-upstream-ms': String(fallback.durationMs),
            'x-dashboard-route-ms': String(Date.now() - routeStartedAt),
            'x-dashboard-fallback': 'league-leaderboard-safe-primary',
          },
        });
      }
    } catch {
      // Continue to primary route logic below.
    }
  }

  try {
    const result = await fetchDashboardJsonWithCache({
      cacheKey: `pitching:overview:${PITCHING_OVERVIEW_CACHE_VERSION}:${url.toString()}${gameSplitCacheBuster}${customShapeCacheBuster}`,
      ttlMs: cachePolicy.ttlMs,
      staleTtlMs: cachePolicy.staleTtlMs,
      timeoutMs: resolveOverviewTimeoutMs(schoolCode),
      retries: resolveOverviewRetries(schoolCode),
      fetcher: () => fetch(url.toString(), { cache: 'no-store' }),
    });
    if (
      result.status >= 200 &&
      result.status < 300 &&
      shouldPreferProSafeLeaderboard &&
      !hasNonEmptyTableRows(result.payload)
    ) {
      const uncachedResponse = await fetch(url.toString(), { cache: 'no-store' });
      const uncachedPayload = (await uncachedResponse.json().catch(() => ({}))) as Record<string, unknown>;
      if (uncachedResponse.ok && hasNonEmptyTableRows(uncachedPayload)) {
        return NextResponse.json(applyOverviewBackfills(uncachedPayload), {
          headers: {
            ...RESPONSE_CACHE_HEADERS,
            'x-dashboard-cache': 'MISS',
            'x-dashboard-cache-source': 'MISS',
            'x-dashboard-upstream-ms': String(result.durationMs),
            'x-dashboard-route-ms': String(Date.now() - routeStartedAt),
            'x-dashboard-fallback': 'pro-empty-cache-bypass',
          },
        });
      }
    }
    if (result.status < 200 || result.status >= 300) {
      if (shouldFallbackProPitchTypesRollup && result.status >= 500) {
        const rollupPayload = await maybeReturnPitchingPitchTypesRollup({
          request,
          schoolCode,
          startDate,
          endDate,
          level,
          sessionType,
          hand,
          batterSide,
          teamType: teamType && teamType !== 'All' ? teamType : 'All',
          pitchTypes,
          customColumns,
        });
        if (rollupPayload) return rollupPayload;
      }
      const shouldFallbackToLeanProLeaderboard =
        shouldForceProLeaderboardRollupShape && result.status >= 500;
      if (shouldFallbackToLeanProLeaderboard && result.status >= 500) {
        const fallback = await fetchProSafePitchingLeaderboard({
          apiBase,
          schoolCode,
          level,
          startDate,
          endDate,
          splitBy,
          tableMode,
          customColumns,
          cachePolicy,
          timeoutMs: resolveOverviewTimeoutMs(schoolCode),
          retries: resolveOverviewRetries(schoolCode),
        });
        if (fallback.status >= 200 && fallback.status < 300) {
          return NextResponse.json(applyOverviewBackfills(fallback.payload), {
            headers: {
              ...RESPONSE_CACHE_HEADERS,
              'x-dashboard-cache': fallback.cached ? 'HIT' : 'MISS',
              'x-dashboard-cache-source': fallback.source,
              'x-dashboard-upstream-ms': String(fallback.durationMs),
              'x-dashboard-route-ms': String(Date.now() - routeStartedAt),
              'x-dashboard-fallback': 'pro-leaderboard-safe',
            },
          });
        }
      }
      const routeError = result.payload.detail ?? result.payload.error;
      const message =
        typeof routeError === 'string' && routeError.trim().length
          ? routeError
          : `Dashboard API request failed (HTTP ${result.status}).`;
      return NextResponse.json({ error: message }, { status: result.status });
    }
    const payloadWithBackfills = applyOverviewBackfills(result.payload);
    const payloadWithRollupHeatmaps = await maybeAttachPitchingHeatmapRollup({
      request,
      payload: payloadWithBackfills,
      schoolCode,
      startDate,
      endDate,
      sessionType,
      hand,
      batterSide,
      pitcher: scopedPitcher || pitcher,
      teamType,
      pitchTypes,
      ballTypes,
      includeChartPoints: url.searchParams.get('include_chart_points') ?? includeChartPoints,
      chartOnly: url.searchParams.get('chart_only') ?? chartOnly,
      splitBy,
      forceRaw,
      inZone,
      qpLocations,
      zoneLocations,
      pitchResults,
      countFilter,
      afterCountFilter,
      veloMin,
      veloMax,
      ivbMin,
      ivbMax,
      hbMin,
      hbMax,
      pcMin,
      pcMax,
    });
    return NextResponse.json(payloadWithRollupHeatmaps, {
      headers: {
        ...RESPONSE_CACHE_HEADERS,
        'x-dashboard-cache': result.cached ? 'HIT' : 'MISS',
        'x-dashboard-cache-source': result.source,
        'x-dashboard-upstream-ms': String(result.durationMs),
        'x-dashboard-route-ms': String(Date.now() - routeStartedAt),
      },
    });
  } catch (error) {
    if (shouldFallbackProPitchTypesRollup) {
      const rollupPayload = await maybeReturnPitchingPitchTypesRollup({
        request,
        schoolCode,
        startDate,
        endDate,
        level,
        sessionType,
        hand,
        batterSide,
        teamType: teamType && teamType !== 'All' ? teamType : 'All',
        pitchTypes,
        customColumns,
      });
      if (rollupPayload) return rollupPayload;
    }
    const shouldFallbackToLeanProLeaderboard = shouldForceProLeaderboardRollupShape;
    if (shouldFallbackToLeanProLeaderboard) {
      try {
        const fallback = await fetchProSafePitchingLeaderboard({
          apiBase,
          schoolCode,
          level,
          startDate,
          endDate,
          splitBy,
          tableMode,
          customColumns,
          cachePolicy,
          timeoutMs: resolveOverviewTimeoutMs(schoolCode),
          retries: resolveOverviewRetries(schoolCode),
        });
        if (fallback.status >= 200 && fallback.status < 300) {
          return NextResponse.json(applyOverviewBackfills(fallback.payload), {
            headers: {
              ...RESPONSE_CACHE_HEADERS,
              'x-dashboard-cache': fallback.cached ? 'HIT' : 'MISS',
              'x-dashboard-cache-source': fallback.source,
              'x-dashboard-upstream-ms': String(fallback.durationMs),
              'x-dashboard-route-ms': String(Date.now() - routeStartedAt),
              'x-dashboard-fallback': 'pro-leaderboard-safe-catch',
            },
          });
        }
      } catch {
        // Fall through to route-level 502 below.
      }
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to reach dashboard API.',
      },
      { status: 502 }
    );
  } finally {
    const elapsed = Date.now() - routeStartedAt;
    if (elapsed >= SLOW_ROUTE_MS) {
      console.warn(`[dashboard][pitching/overview] slow request ${elapsed}ms`);
    }
  }
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, shouldScopeDashboardPlayer } from '../../../../../lib/dashboard-player-scope';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';

export const maxDuration = 300;

const RESPONSE_CACHE_HEADERS = {
  'cache-control': 'private, max-age=5, stale-while-revalidate=55',
} as const;
const SLOW_ROUTE_MS = 5000;

function resolveOverviewTimeoutMs(schoolCode: string): number {
  return String(schoolCode ?? '').trim().toUpperCase() === 'LEAGUE' ? 300000 : 120000;
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
  if (upper === 'PRO' || upper === 'LEAGUE') return 1;
  return 0;
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

async function maybeAttachHittingHeatmapRollup(params: {
  requestOrigin: string;
  schoolCode: string;
  level: string;
  startDate: string;
  endDate: string;
  sessionType: string;
  hand: string;
  hitter: string;
  teamType: string;
  pitchTypes: string;
  includeChartPoints: string;
  inputUrl: URL;
  payload: unknown;
}): Promise<unknown> {
  const {
    requestOrigin,
    schoolCode,
    level,
    startDate,
    endDate,
    sessionType,
    hand,
    hitter,
    teamType,
    pitchTypes,
    includeChartPoints,
    inputUrl,
    payload,
  } = params;

  if (!isTruthy(includeChartPoints)) return payload;
  if (!payload || typeof payload !== 'object') return payload;

  const hasUnsupportedFilters = [
    'pitch_results',
    'in_zone',
    'count_filter',
    'after_count_filter',
    'zone_locations',
    'bip_result',
    'velo_min',
    'velo_max',
    'ivb_min',
    'ivb_max',
    'hb_min',
    'hb_max',
    'pc_min',
    'pc_max',
  ].some((key) => hasValue(inputUrl.searchParams.get(key)?.trim() ?? ''));
  if (hasUnsupportedFilters) return payload;

  try {
    const rollup = new URL('/api/dashboard/hitting/heatmap-rollup', requestOrigin);
    rollup.searchParams.set('school_code', schoolCode);
    if (level) rollup.searchParams.set('level', level);
    if (startDate) rollup.searchParams.set('start_date', startDate);
    if (endDate) rollup.searchParams.set('end_date', endDate);
    if (sessionType) rollup.searchParams.set('session_type', sessionType);
    if (hand) rollup.searchParams.set('hand', hand);
    if (hitter) rollup.searchParams.set('hitter', hitter);
    if (teamType) rollup.searchParams.set('team_type', teamType);
    if (pitchTypes) rollup.searchParams.set('pitch_types', pitchTypes);

    const response = await fetch(rollup.toString(), { cache: 'no-store' });
    if (!response.ok) return payload;
    const rollupPayload = (await response.json().catch(() => ({}))) as { chart_points?: unknown[]; heatmap_points?: unknown[] };
    const rollupPoints = Array.isArray(rollupPayload.chart_points) ? rollupPayload.chart_points : [];
    if (!rollupPoints.length) return payload;
    return {
      ...(payload as Record<string, unknown>),
      chart_points: rollupPoints,
      heatmap_points: rollupPoints,
    };
  } catch {
    return payload;
  }
}

async function fetchProSafeHittingLeaderboard(params: {
  apiBase: string;
  schoolCode: string;
  level: string;
  startDate: string;
  endDate: string;
  splitBy: string;
  cachePolicy: { ttlMs: number; staleTtlMs: number };
  timeoutMs: number;
  retries: number;
}) {
  const { apiBase, schoolCode, level, startDate, endDate, splitBy, cachePolicy, timeoutMs, retries } = params;
  const fallbackUrl = new URL(`${apiBase}/v1/hitting/overview`);
  fallbackUrl.searchParams.set('school_code', schoolCode);
  if (startDate) fallbackUrl.searchParams.set('start_date', startDate);
  if (endDate) fallbackUrl.searchParams.set('end_date', endDate);
  fallbackUrl.searchParams.set('team_type', 'All');
  if (level && level !== 'All') fallbackUrl.searchParams.set('level', level);
  fallbackUrl.searchParams.set('table_mode', 'Results');
  fallbackUrl.searchParams.set('split_by', splitBy === 'Batter Team' ? 'Batter Team' : 'Batter');
  fallbackUrl.searchParams.set('include_chart_points', '0');
  const fallback = await fetchDashboardJsonWithCache({
    cacheKey: `hitting:overview:pro-safe-leaderboard:${fallbackUrl.toString()}`,
    ttlMs: cachePolicy.ttlMs,
    staleTtlMs: cachePolicy.staleTtlMs,
    timeoutMs,
    retries,
    fetcher: () => fetch(fallbackUrl.toString(), { cache: 'no-store' }),
  });
  return fallback;
}

async function fetchLeagueSafeHittingLeaderboard(params: {
  apiBase: string;
  schoolCode: string;
  startDate: string;
  endDate: string;
  splitBy: string;
  cachePolicy: { ttlMs: number; staleTtlMs: number };
  timeoutMs: number;
  retries: number;
}) {
  const { apiBase, schoolCode, startDate, endDate, splitBy, cachePolicy, timeoutMs, retries } = params;
  const fallbackUrl = new URL(`${apiBase}/v1/hitting/overview`);
  fallbackUrl.searchParams.set('school_code', schoolCode);
  if (startDate) fallbackUrl.searchParams.set('start_date', startDate);
  if (endDate) fallbackUrl.searchParams.set('end_date', endDate);
  fallbackUrl.searchParams.set('team_type', 'All');
  fallbackUrl.searchParams.set('table_mode', 'Results');
  fallbackUrl.searchParams.set('split_by', splitBy === 'Batter Team' ? 'Batter Team' : 'Batter');
  fallbackUrl.searchParams.set('include_chart_points', '0');
  return fetchDashboardJsonWithCache({
    cacheKey: `hitting:overview:league-safe-leaderboard:${fallbackUrl.toString()}`,
    ttlMs: cachePolicy.ttlMs,
    staleTtlMs: cachePolicy.staleTtlMs,
    timeoutMs,
    retries,
    fetcher: () => fetch(fallbackUrl.toString(), { cache: 'no-store' }),
  });
}

export async function GET(request: Request) {
  const routeStartedAt = Date.now();
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const inputUrl = new URL(request.url);
  const requestOrigin = inputUrl.origin;
  const requestedPercentileBaseline = isTruthy(inputUrl.searchParams.get('percentile_baseline')?.trim() ?? '');
  const percentilePool = inputUrl.searchParams.get('percentile_pool')?.trim().toLowerCase() ?? '';
  const useMlbPercentilePool = requestedPercentileBaseline && percentilePool === 'mlb';
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
  const schoolCode = requestedPercentileBaseline
    ? (useMlbPercentilePool ? 'PRO' : (String(resolvedSchoolCode).trim().toUpperCase() === 'PRO' ? 'PRO' : 'LEAGUE'))
    : resolvedSchoolCode;
  const splitBy = inputUrl.searchParams.get('split_by')?.trim() ?? '';
  const level = inputUrl.searchParams.get('level')?.trim() ?? '';
  const tableMode = inputUrl.searchParams.get('table_mode')?.trim() ?? '';
  const customColumns = inputUrl.searchParams.get('custom_columns')?.trim() ?? '';
  const startDate = inputUrl.searchParams.get('start_date')?.trim() ?? '';
  const endDate = inputUrl.searchParams.get('end_date')?.trim() ?? '';
  const teamType = inputUrl.searchParams.get('team_type')?.trim() ?? '';
  const sessionType = inputUrl.searchParams.get('session_type')?.trim() ?? '';
  const oppPitcher = inputUrl.searchParams.get('opp_pitcher')?.trim() ?? '';
  const hand = inputUrl.searchParams.get('hand')?.trim() ?? '';
  const batterSide = inputUrl.searchParams.get('batter_side')?.trim() ?? '';
  const venue = inputUrl.searchParams.get('venue')?.trim() ?? '';
  const hitterParam = inputUrl.searchParams.get('hitter')?.trim() ?? '';
  const includeChartPoints = inputUrl.searchParams.get('include_chart_points')?.trim() ?? '';
  const chartPointsLimit = inputUrl.searchParams.get('chart_points_limit')?.trim() ?? '';
  const chartOnly = inputUrl.searchParams.get('chart_only')?.trim() ?? '';
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const daySpan = start && end ? Math.floor((end.getTime() - start.getTime()) / 86400000) + 1 : 0;
  const shouldScopePlayer = !requestedPercentileBaseline && shouldScopeDashboardPlayer(session.role, schoolCode);
  const playerIdentity = shouldScopePlayer
    ? await resolveDashboardPlayerIdentity({
        role: session.role,
        organizationId: session.organizationId,
        userId: session.userId,
        name: session.name,
      })
    : null;
  if (shouldScopePlayer && !playerIdentity) {
    return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
  }
  const scopedHitter = shouldScopePlayer && playerIdentity ? scopedPlayerQueryName(playerIdentity, 'Hitting') : '';
  const pass = [
    'level',
    'start_date',
    'end_date',
    'hitter',
    'team_type',
    'session_type',
    'opp_pitcher',
    'hand',
    'batter_side',
    'venue',
    'table_mode',
    'split_by',
    'custom_columns',
    'in_zone',
    'pitch_types',
    'zone_locations',
    'pitch_results',
    'count_filter',
    'after_count_filter',
    'bip_result',
    'velo_min',
    'velo_max',
    'ivb_min',
    'ivb_max',
    'hb_min',
    'hb_max',
    'pc_min',
    'pc_max',
    'include_chart_points',
    'chart_points_limit',
    'chart_only',
    'force_raw',
    'recent_pa_mode',
    'recent_pa_count',
    'recent_pa_ignore_dates',
    'percentile_baseline',
  ] as const;

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/hitting/overview`);
  url.searchParams.set('school_code', schoolCode);
  for (const key of pass) {
    if (key === 'hitter' && scopedHitter) {
      url.searchParams.set('hitter', scopedHitter);
      continue;
    }
    if (key === 'hitter' && requestedPercentileBaseline) {
      continue;
    }
    const value = inputUrl.searchParams.get(key)?.trim() ?? '';
    if (value) url.searchParams.set(key, value);
  }
  const requestedHitter = requestedPercentileBaseline ? '' : hitterParam;
  const broadScope =
    !scopedHitter &&
    !requestedHitter &&
    !oppPitcher &&
    (!teamType || teamType.toLowerCase() === 'all');
  const isLeague = String(schoolCode ?? '').trim().toUpperCase() === 'LEAGUE';
  const isPro = String(schoolCode ?? '').trim().toUpperCase() === 'PRO';
  const normalizedTableMode = tableMode.toLowerCase();
  const proLeaderboardDefaultModeRequested = !normalizedTableMode || normalizedTableMode === 'results';
  const customModeRequested = tableMode.toLowerCase() === 'custom' || customColumns.length > 0;
  const isProLeaderboardSplit = isPro && (splitBy === 'Batter' || splitBy === 'Batter Team');
  const hasProLeaderboardNarrowingFilters =
    hasValue(oppPitcher) ||
    hasValue(hand) ||
    hasValue(batterSide) ||
    hasValue(venue) ||
    hasValue(inputUrl.searchParams.get('in_zone')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('pitch_types')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('zone_locations')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('pitch_results')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('count_filter')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('after_count_filter')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('bip_result')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('velo_min')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('velo_max')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('ivb_min')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('ivb_max')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('hb_min')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('hb_max')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('pc_min')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('pc_max')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('recent_pa_mode')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('recent_pa_count')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('recent_pa_ignore_dates')?.trim() ?? '') ||
    hasValue(inputUrl.searchParams.get('force_raw')?.trim() ?? '') ||
    hasValue(chartOnly);
  const hasLeagueLeaderboardNarrowingFilters = hasProLeaderboardNarrowingFilters;
  const leagueBroadLeaderboard =
    isLeague &&
    !shouldScopePlayer &&
    broadScope &&
    (splitBy === 'Batter' || splitBy === 'Batter Team') &&
    !customModeRequested &&
    !hasLeagueLeaderboardNarrowingFilters &&
    !isTruthy(chartOnly);
  if (leagueBroadLeaderboard) {
    // Keep League broad leaderboard requests on rollup-only payloads.
    url.searchParams.set('team_type', 'All');
    url.searchParams.set('table_mode', 'Results');
    url.searchParams.set('split_by', splitBy === 'Batter Team' ? 'Batter Team' : 'Batter');
    url.searchParams.set('include_chart_points', '0');
    const dropKeys = [
      'opp_pitcher',
      'hand',
      'batter_side',
      'venue',
      'custom_columns',
      'in_zone',
      'pitch_types',
      'zone_locations',
      'pitch_results',
      'count_filter',
      'after_count_filter',
      'bip_result',
      'velo_min',
      'velo_max',
      'ivb_min',
      'ivb_max',
      'hb_min',
      'hb_max',
      'pc_min',
      'pc_max',
      'chart_only',
      'chart_points_limit',
      'recent_pa_mode',
      'recent_pa_count',
      'recent_pa_ignore_dates',
    ] as const;
    for (const key of dropKeys) url.searchParams.delete(key);
  }
  const shouldForceProLeaderboardRollupShape =
    isProLeaderboardSplit &&
    broadScope &&
    daySpan >= 14 &&
    proLeaderboardDefaultModeRequested &&
    !hasProLeaderboardNarrowingFilters &&
    !customModeRequested &&
    !(requestedPercentileBaseline && splitBy === 'Batter' && !!inputUrl.searchParams.get('pitch_types')?.trim()) &&
    !isTruthy(chartOnly);
  if (!includeChartPoints && broadScope && daySpan >= 21 && !chartOnly) {
    url.searchParams.set('include_chart_points', '0');
  }
  if (shouldScopePlayer) {
    const requestedLimit = Number(chartPointsLimit || '0');
    const cappedLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 400) : 400;
    url.searchParams.set('include_chart_points', '1');
    url.searchParams.set('chart_points_limit', String(cappedLimit));
  } else if ((includeChartPoints || '').trim() === '1') {
    const requestedLimit = Number(chartPointsLimit || '0');
    const maxLimit = broadScope ? 600 : 2000;
    const cappedLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, maxLimit) : maxLimit;
    url.searchParams.set('chart_points_limit', String(cappedLimit));
  }
  if (shouldForceProLeaderboardRollupShape) {
    url.searchParams.set('team_type', 'All');
    url.searchParams.set('table_mode', 'Results');
    url.searchParams.set('split_by', splitBy === 'Batter Team' ? 'Batter Team' : 'Batter');
    url.searchParams.set('include_chart_points', '0');
    const dropKeys = [
      'opp_pitcher',
      'hand',
      'batter_side',
      'venue',
      'custom_columns',
      'in_zone',
      'pitch_types',
      'zone_locations',
      'pitch_results',
      'count_filter',
      'after_count_filter',
      'bip_result',
      'velo_min',
      'velo_max',
      'ivb_min',
      'ivb_max',
      'hb_min',
      'hb_max',
      'pc_min',
      'pc_max',
      'chart_only',
      'chart_points_limit',
      'recent_pa_mode',
      'recent_pa_count',
      'recent_pa_ignore_dates',
    ] as const;
    for (const key of dropKeys) url.searchParams.delete(key);
  }
  const cachePolicy = resolveOverviewCachePolicy(schoolCode, { preferBroadLeaderboardCache: leagueBroadLeaderboard });
  const isGameSplit = splitBy === 'Game';
  const gameSplitCacheBuster = isGameSplit ? `:game:${Date.now()}` : '';
  const shouldPreferProSafeLeaderboard =
    isPro &&
    !shouldScopePlayer &&
    broadScope &&
    (splitBy === 'Batter' || splitBy === 'Batter Team') &&
    proLeaderboardDefaultModeRequested &&
    !hasProLeaderboardNarrowingFilters &&
    !customModeRequested &&
    !(requestedPercentileBaseline && splitBy === 'Batter' && !!inputUrl.searchParams.get('pitch_types')?.trim()) &&
    !isTruthy(chartOnly);
  const shouldPreferLeagueSafeLeaderboard = leagueBroadLeaderboard;

  if (shouldPreferProSafeLeaderboard) {
    try {
      const fallback = await fetchProSafeHittingLeaderboard({
        apiBase,
        schoolCode,
        level,
        startDate,
        endDate,
        splitBy,
        cachePolicy,
        timeoutMs: 25000,
        retries: 0,
      });
      if (fallback.status >= 200 && fallback.status < 300 && hasNonEmptyTableRows(fallback.payload)) {
        return NextResponse.json(fallback.payload, {
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
      const fallback = await fetchLeagueSafeHittingLeaderboard({
        apiBase,
        schoolCode,
        startDate,
        endDate,
        splitBy,
        cachePolicy,
        timeoutMs: 20000,
        retries: 0,
      });
      if (fallback.status >= 200 && fallback.status < 300 && hasNonEmptyTableRows(fallback.payload)) {
        return NextResponse.json(fallback.payload, {
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
      cacheKey: `hitting:overview:${url.toString()}${gameSplitCacheBuster}`,
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
        return NextResponse.json(uncachedPayload, {
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
      const shouldFallbackToLeanProLeaderboard =
        isPro &&
        (splitBy === 'Batter' || splitBy === 'Batter Team') &&
        proLeaderboardDefaultModeRequested &&
        !hasProLeaderboardNarrowingFilters &&
        !customModeRequested &&
        !isTruthy(chartOnly);
      if (shouldFallbackToLeanProLeaderboard && result.status >= 500) {
        const fallback = await fetchProSafeHittingLeaderboard({
          apiBase,
          schoolCode,
          level,
          startDate,
          endDate,
          splitBy,
          cachePolicy,
          timeoutMs: resolveOverviewTimeoutMs(schoolCode),
          retries: resolveOverviewRetries(schoolCode),
        });
        if (fallback.status >= 200 && fallback.status < 300) {
          return NextResponse.json(fallback.payload, {
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
    const payloadWithRollupHeatmaps = await maybeAttachHittingHeatmapRollup({
      requestOrigin,
      schoolCode,
      level,
      startDate,
      endDate,
      sessionType,
      hand,
      hitter: scopedHitter || requestedHitter,
      teamType,
      pitchTypes: inputUrl.searchParams.get('pitch_types')?.trim() ?? '',
      includeChartPoints: url.searchParams.get('include_chart_points') ?? includeChartPoints,
      inputUrl,
      payload: result.payload,
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
    const shouldFallbackToLeanProLeaderboard =
      isPro &&
      (splitBy === 'Batter' || splitBy === 'Batter Team') &&
      proLeaderboardDefaultModeRequested &&
      !hasProLeaderboardNarrowingFilters &&
      !customModeRequested &&
      !isTruthy(chartOnly);
    if (shouldFallbackToLeanProLeaderboard) {
      try {
        const fallback = await fetchProSafeHittingLeaderboard({
          apiBase,
          schoolCode,
          level,
          startDate,
          endDate,
          splitBy,
          cachePolicy,
          timeoutMs: resolveOverviewTimeoutMs(schoolCode),
          retries: resolveOverviewRetries(schoolCode),
        });
        if (fallback.status >= 200 && fallback.status < 300) {
          return NextResponse.json(fallback.payload, {
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
      console.warn(`[dashboard][hitting/overview] slow request ${elapsed}ms`);
    }
  }
}

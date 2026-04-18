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

function resolveOverviewCachePolicy(schoolCode: string): { ttlMs: number; staleTtlMs: number } {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (upper === 'PRO') return { ttlMs: 90000, staleTtlMs: 600000 };
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
  const customColumns = inputUrl.searchParams.get('custom_columns')?.trim() ?? '';
  const visualOption = inputUrl.searchParams.get('visual_option')?.trim() ?? '';
  const inZone = inputUrl.searchParams.get('in_zone')?.trim() ?? '';
  const qpLocations = inputUrl.searchParams.get('qp_locations')?.trim() ?? '';
  const pitchTypes = inputUrl.searchParams.get('pitch_types')?.trim() ?? '';
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
  const includeChartPoints = inputUrl.searchParams.get('include_chart_points')?.trim() ?? '';
  const chartPointsLimit = inputUrl.searchParams.get('chart_points_limit')?.trim() ?? '';
  const chartOnly = inputUrl.searchParams.get('chart_only')?.trim() ?? '';
  const includeRowPitches = inputUrl.searchParams.get('include_row_pitches')?.trim() ?? '';
  const includeTrendRows = inputUrl.searchParams.get('include_trend_rows')?.trim() ?? '';
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
  const shouldScopePlayer = shouldScopeDashboardPlayer(session.role, schoolCode);
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
  const scopedPitcher = shouldScopePlayer && playerIdentity ? scopedPlayerQueryName(playerIdentity, 'Pitching') : '';

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/pitching/overview`);
  url.searchParams.set('school_code', schoolCode);
  if (startDate) url.searchParams.set('start_date', startDate);
  if (endDate) url.searchParams.set('end_date', endDate);
  if (scopedPitcher) url.searchParams.set('pitcher', scopedPitcher);
  else if (pitcher) url.searchParams.set('pitcher', pitcher);
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
  const isLeague = String(schoolCode ?? '').trim().toUpperCase() === 'LEAGUE';
  const isPro = String(schoolCode ?? '').trim().toUpperCase() === 'PRO';
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const daySpan = start && end ? Math.floor((end.getTime() - start.getTime()) / 86400000) + 1 : 0;
  const forceLeagueLight = isLeague && daySpan >= 14;
  const broadScope =
    !scopedPitcher &&
    !pitcher &&
    !oppHitter &&
    (!teamType || teamType.toLowerCase() === 'all');

  if (includeChartPoints) url.searchParams.set('include_chart_points', includeChartPoints);
  if (chartPointsLimit) url.searchParams.set('chart_points_limit', chartPointsLimit);
  if (chartOnly) url.searchParams.set('chart_only', chartOnly);
  if (includeRowPitches) url.searchParams.set('include_row_pitches', includeRowPitches);
  if (includeTrendRows) url.searchParams.set('include_trend_rows', includeTrendRows);
  if (forceLeagueLight) {
    url.searchParams.set('include_chart_points', '1');
    url.searchParams.set('chart_points_limit', '600');
    url.searchParams.set('include_row_pitches', '0');
    url.searchParams.set('include_trend_rows', '0');
  } else if (isLeague && !includeRowPitches) {
    // Default League calls to lighter payload unless explicitly requested for short windows.
    url.searchParams.set('include_row_pitches', '0');
  }
  if (!includeChartPoints && broadScope && daySpan >= 21 && !chartOnly) {
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
  } else if ((url.searchParams.get('include_chart_points') ?? '').trim() === '1') {
    const requestedLimit = Number(url.searchParams.get('chart_points_limit') ?? '0');
    const maxLimit = broadScope ? 600 : 2000;
    const cappedLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, maxLimit) : maxLimit;
    url.searchParams.set('chart_points_limit', String(cappedLimit));
  }
  const isProLeaderboardSplit = isPro && (splitBy === 'Pitcher' || splitBy === 'Pitcher Team');
  const proBroadScope =
    isPro &&
    !scopedPitcher &&
    !pitcher &&
    !oppHitter &&
    (!teamType || teamType.toLowerCase() === 'all');
  const shouldForceProLeaderboardRollupShape =
    isProLeaderboardSplit &&
    proBroadScope &&
    daySpan >= 14 &&
    !isTruthy(chartOnly);
  if (shouldForceProLeaderboardRollupShape) {
    // Match league broad-window behavior: keep this request strictly rollup-safe.
    url.searchParams.set('team_type', 'All');
    url.searchParams.set('level', 'MLB');
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
      'chart_only',
      'chart_points_limit',
    ] as const;
    for (const key of dropKeys) url.searchParams.delete(key);
  }
  const cachePolicy = resolveOverviewCachePolicy(schoolCode);
  const isGameSplit = splitBy === 'Game';
  const gameSplitCacheBuster = isGameSplit ? `:game:${Date.now()}` : '';

  try {
    const result = await fetchDashboardJsonWithCache({
      cacheKey: `pitching:overview:${url.toString()}${gameSplitCacheBuster}`,
      ttlMs: cachePolicy.ttlMs,
      staleTtlMs: cachePolicy.staleTtlMs,
      timeoutMs: resolveOverviewTimeoutMs(schoolCode),
      retries: resolveOverviewRetries(schoolCode),
      fetcher: () => fetch(url.toString(), { cache: 'no-store' }),
    });
    if (result.status < 200 || result.status >= 300) {
      const leaderboardLikeSplit = splitBy === 'Pitcher' || splitBy === 'Pitcher Team';
      const shouldFallbackToLeanProLeaderboard =
        isPro &&
        leaderboardLikeSplit &&
        !isTruthy(chartOnly);
      if (shouldFallbackToLeanProLeaderboard && result.status >= 500) {
        const fallbackUrl = new URL(`${apiBase}/v1/pitching/overview`);
        fallbackUrl.searchParams.set('school_code', schoolCode);
        if (startDate) fallbackUrl.searchParams.set('start_date', startDate);
        if (endDate) fallbackUrl.searchParams.set('end_date', endDate);
        fallbackUrl.searchParams.set('team_type', 'All');
        fallbackUrl.searchParams.set('level', 'MLB');
        fallbackUrl.searchParams.set('table_mode', 'Live');
        fallbackUrl.searchParams.set('split_by', 'Pitcher');
        fallbackUrl.searchParams.set('include_chart_points', '0');
        fallbackUrl.searchParams.set('include_row_pitches', '0');
        fallbackUrl.searchParams.set('include_trend_rows', '0');
        const fallback = await fetchDashboardJsonWithCache({
          cacheKey: `pitching:overview:pro-safe-leaderboard:${fallbackUrl.toString()}`,
          ttlMs: cachePolicy.ttlMs,
          staleTtlMs: cachePolicy.staleTtlMs,
          timeoutMs: resolveOverviewTimeoutMs(schoolCode),
          retries: resolveOverviewRetries(schoolCode),
          fetcher: () => fetch(fallbackUrl.toString(), { cache: 'no-store' }),
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
    return NextResponse.json(result.payload, {
      headers: {
        ...RESPONSE_CACHE_HEADERS,
        'x-dashboard-cache': result.cached ? 'HIT' : 'MISS',
        'x-dashboard-cache-source': result.source,
        'x-dashboard-upstream-ms': String(result.durationMs),
        'x-dashboard-route-ms': String(Date.now() - routeStartedAt),
      },
    });
  } catch (error) {
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

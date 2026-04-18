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

export async function GET(request: Request) {
  const routeStartedAt = Date.now();
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  const inputUrl = new URL(request.url);
  const splitBy = inputUrl.searchParams.get('split_by')?.trim() ?? '';
  const startDate = inputUrl.searchParams.get('start_date')?.trim() ?? '';
  const endDate = inputUrl.searchParams.get('end_date')?.trim() ?? '';
  const teamType = inputUrl.searchParams.get('team_type')?.trim() ?? '';
  const oppPitcher = inputUrl.searchParams.get('opp_pitcher')?.trim() ?? '';
  const hitterParam = inputUrl.searchParams.get('hitter')?.trim() ?? '';
  const includeChartPoints = inputUrl.searchParams.get('include_chart_points')?.trim() ?? '';
  const chartPointsLimit = inputUrl.searchParams.get('chart_points_limit')?.trim() ?? '';
  const chartOnly = inputUrl.searchParams.get('chart_only')?.trim() ?? '';
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const daySpan = start && end ? Math.floor((end.getTime() - start.getTime()) / 86400000) + 1 : 0;
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
  const scopedHitter = shouldScopePlayer && playerIdentity ? scopedPlayerQueryName(playerIdentity, 'Hitting') : '';
  const pass = [
    'level',
    'start_date',
    'end_date',
    'hitter',
    'team_type',
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
    'recent_pa_mode',
    'recent_pa_count',
    'recent_pa_ignore_dates',
  ] as const;

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/hitting/overview`);
  url.searchParams.set('school_code', schoolCode);
  for (const key of pass) {
    if (key === 'hitter' && scopedHitter) {
      url.searchParams.set('hitter', scopedHitter);
      continue;
    }
    const value = inputUrl.searchParams.get(key)?.trim() ?? '';
    if (value) url.searchParams.set(key, value);
  }
  const broadScope =
    !scopedHitter &&
    !hitterParam &&
    !oppPitcher &&
    (!teamType || teamType.toLowerCase() === 'all');
  const isPro = String(schoolCode ?? '').trim().toUpperCase() === 'PRO';
  const isProLeaderboardSplit = isPro && (splitBy === 'Batter' || splitBy === 'Batter Team');
  const shouldForceProLeaderboardRollupShape = isProLeaderboardSplit && !isTruthy(chartOnly);
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
    url.searchParams.set('level', 'MLB');
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
  const cachePolicy = resolveOverviewCachePolicy(schoolCode);
  const isGameSplit = splitBy === 'Game';
  const gameSplitCacheBuster = isGameSplit ? `:game:${Date.now()}` : '';

  try {
    const result = await fetchDashboardJsonWithCache({
      cacheKey: `hitting:overview:${url.toString()}${gameSplitCacheBuster}`,
      ttlMs: cachePolicy.ttlMs,
      staleTtlMs: cachePolicy.staleTtlMs,
      timeoutMs: resolveOverviewTimeoutMs(schoolCode),
      retries: resolveOverviewRetries(schoolCode),
      fetcher: () => fetch(url.toString(), { cache: 'no-store' }),
    });
    if (result.status < 200 || result.status >= 300) {
      const shouldFallbackToLeanProLeaderboard =
        isPro &&
        (splitBy === 'Batter' || splitBy === 'Batter Team') &&
        !isTruthy(chartOnly);
      if (shouldFallbackToLeanProLeaderboard && result.status >= 500) {
        const fallbackUrl = new URL(`${apiBase}/v1/hitting/overview`);
        fallbackUrl.searchParams.set('school_code', schoolCode);
        if (startDate) fallbackUrl.searchParams.set('start_date', startDate);
        if (endDate) fallbackUrl.searchParams.set('end_date', endDate);
        fallbackUrl.searchParams.set('team_type', 'All');
        fallbackUrl.searchParams.set('level', 'MLB');
        fallbackUrl.searchParams.set('table_mode', 'Results');
        fallbackUrl.searchParams.set('split_by', splitBy === 'Batter Team' ? 'Batter Team' : 'Batter');
        fallbackUrl.searchParams.set('include_chart_points', '0');
        const fallback = await fetchDashboardJsonWithCache({
          cacheKey: `hitting:overview:pro-safe-leaderboard:${fallbackUrl.toString()}`,
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
      console.warn(`[dashboard][hitting/overview] slow request ${elapsed}ms`);
    }
  }
}

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

function resolveOverviewTimeoutMs(schoolCode: string): number {
  return String(schoolCode ?? '').trim().toUpperCase() === 'LEAGUE' ? 300000 : 120000;
}

function resolveOverviewCachePolicy(schoolCode: string): { ttlMs: number; staleTtlMs: number } {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (upper === 'PRO') return { ttlMs: 90000, staleTtlMs: 600000 };
  if (upper === 'LEAGUE') return { ttlMs: 30000, staleTtlMs: 120000 };
  return { ttlMs: 45000, staleTtlMs: 180000 };
}

export async function GET(request: Request) {
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

  const shouldScopePlayer = shouldScopeDashboardPlayer(session.role, schoolCode);
  const inputUrl = new URL(request.url);
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
  const scopedCatcher = shouldScopePlayer && playerIdentity ? scopedPlayerQueryName(playerIdentity, 'Catching') : '';
  const pass = [
    'level',
    'start_date',
    'end_date',
    'session_type',
    'team_type',
    'catcher',
    'hand',
    'batter_side',
    'venue',
    'in_zone',
    'pitch_types',
    'zone_locations',
    'pitch_results',
    'count_filter',
    'after_count_filter',
    'table_mode',
    'split_by',
    'custom_columns',
    'hm_results',
    'velo_min',
    'velo_max',
    'pc_min',
    'pc_max',
    'include_chart_points',
    'chart_points_limit',
    'chart_only',
  ] as const;

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/catching/overview`);
  url.searchParams.set('school_code', schoolCode);
  for (const key of pass) {
    if (key === 'catcher' && scopedCatcher) {
      url.searchParams.set('catcher', scopedCatcher);
      continue;
    }
    const value = inputUrl.searchParams.get(key)?.trim() ?? '';
    if (value) url.searchParams.set(key, value);
  }
  if (shouldScopePlayer) {
    const requestedLimit = Number(url.searchParams.get('chart_points_limit') ?? '0');
    const cappedLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 300) : 300;
    url.searchParams.set('include_chart_points', '1');
    url.searchParams.set('chart_points_limit', String(cappedLimit));
  }
  const cachePolicy = resolveOverviewCachePolicy(schoolCode);

  try {
    const result = await fetchDashboardJsonWithCache({
      cacheKey: `catching:overview:${url.toString()}`,
      ttlMs: cachePolicy.ttlMs,
      staleTtlMs: cachePolicy.staleTtlMs,
      timeoutMs: resolveOverviewTimeoutMs(schoolCode),
      retries: 0,
      fetcher: () => fetch(url.toString(), { cache: 'no-store' }),
    });
    if (result.status < 200 || result.status >= 300) {
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
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to reach dashboard API.',
      },
      { status: 502 }
    );
  }
}

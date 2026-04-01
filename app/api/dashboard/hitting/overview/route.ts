import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName } from '../../../../../lib/dashboard-player-scope';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';

export const maxDuration = 300;

const RESPONSE_CACHE_HEADERS = {
  'cache-control': 'private, max-age=5, stale-while-revalidate=55',
} as const;

function resolveOverviewTimeoutMs(schoolCode: string): number {
  return String(schoolCode ?? '').trim().toUpperCase() === 'LEAGUE' ? 300000 : 120000;
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

  const inputUrl = new URL(request.url);
  const playerIdentity = await resolveDashboardPlayerIdentity({
    role: session.role,
    organizationId: session.organizationId,
    userId: session.userId,
    name: session.name,
  });
  if (session.role === 'player' && !playerIdentity) {
    return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
  }
  const scopedHitter = playerIdentity ? scopedPlayerQueryName(playerIdentity, 'Hitting') : '';
  const pass = [
    'level',
    'start_date',
    'end_date',
    'hitter',
    'team_type',
    'opp_pitcher',
    'hand',
    'batter_side',
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

  try {
    const result = await fetchDashboardJsonWithCache({
      cacheKey: `hitting:overview:${url.toString()}`,
      ttlMs: 30000,
      staleTtlMs: 120000,
      timeoutMs: resolveOverviewTimeoutMs(schoolCode),
      retries: 0,
      fetcher: () => fetch(url.toString(), { cache: 'no-store' }),
    });
    if (result.status < 200 || result.status >= 300) {
      return NextResponse.json({ error: String(result.payload.detail ?? result.payload.error ?? 'Dashboard API request failed.') }, { status: result.status });
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

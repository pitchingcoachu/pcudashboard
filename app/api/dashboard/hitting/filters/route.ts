import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, selectScopedPlayerName, shouldScopeDashboardPlayer } from '../../../../../lib/dashboard-player-scope';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';

const RESPONSE_CACHE_HEADERS = {
  'cache-control': 'private, max-age=30, stale-while-revalidate=300',
  vary: 'Cookie',
} as const;
const SLOW_ROUTE_MS = 2500;

function resolveFiltersTimeoutMs(schoolCode: string): number {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (upper === 'LEAGUE') return 120000;
  if (upper === 'PRO') return 120000;
  return 45000;
}

function pickLatestGameDate(payload: Record<string, unknown>): string | null {
  const games = Array.isArray(payload.available_games) ? payload.available_games : [];
  const dates = games
    .map((entry) => String((entry as { date?: unknown }).date ?? '').trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
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

  const apiBase = resolveDashboardApiBaseUrl();
  const inputUrl = new URL(request.url);
  const level = inputUrl.searchParams.get('level')?.trim() ?? '';
  const url = new URL(`${apiBase}/v1/hitting/filters`);
  url.searchParams.set('school_code', schoolCode);
  if (level) url.searchParams.set('level', level);

  try {
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

    const result = await fetchDashboardJsonWithCache({
      cacheKey: `hitting:filters:${url.toString()}`,
      ttlMs: 120000,
      staleTtlMs: 300000,
      timeoutMs: resolveFiltersTimeoutMs(schoolCode),
      retries: 1,
      fetcher: () => fetch(url.toString(), { cache: 'no-store' }),
    });
    if (result.status < 200 || result.status >= 300) {
      return NextResponse.json({ error: String(result.payload.detail ?? result.payload.error ?? 'Dashboard API request failed.') }, { status: result.status });
    }
    const payload = result.payload as Record<string, unknown>;
    let scopedHitter: string | null = null;
    if (shouldScopePlayer && playerIdentity && Array.isArray(payload.hitters)) {
      const scoped = selectScopedPlayerName(payload.hitters, playerIdentity);
      const fallback = scopedPlayerQueryName(playerIdentity, 'Hitting');
      scopedHitter = scoped || fallback || null;
      payload.hitters = scopedHitter ? [scopedHitter] : [];
    }
    if (shouldScopePlayer && scopedHitter) {
      const abUrl = new URL(`${apiBase}/v1/hitting/ab-report`);
      abUrl.searchParams.set('school_code', schoolCode);
      abUrl.searchParams.set('hitter', scopedHitter);
      const abResult = await fetchDashboardJsonWithCache({
        cacheKey: `hitting:filters:last-date:${abUrl.toString()}`,
        ttlMs: 120000,
        staleTtlMs: 300000,
        timeoutMs: 12000,
        retries: 0,
        fetcher: () => fetch(abUrl.toString(), { cache: 'no-store' }),
      });
      if (abResult.status >= 200 && abResult.status < 300) {
        const playerLastDate = pickLatestGameDate(abResult.payload as Record<string, unknown>);
        if (playerLastDate) {
          payload.player_last_date = playerLastDate;
          payload.max_date = playerLastDate;
        }
      }
    }
    return NextResponse.json(payload, {
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
      console.warn(`[dashboard][hitting/filters] slow request ${elapsed}ms`);
    }
  }
}

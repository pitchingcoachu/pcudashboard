import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, selectScopedPlayerName } from '../../../../../lib/dashboard-player-scope';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';

const RESPONSE_CACHE_HEADERS = {
  'cache-control': 'private, max-age=30, stale-while-revalidate=300',
  vary: 'Cookie',
} as const;

function resolveFiltersTimeoutMs(schoolCode: string): number {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (upper === 'LEAGUE') return 120000;
  if (upper === 'PRO') return 120000;
  return 45000;
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

  const apiBase = resolveDashboardApiBaseUrl();
  const inputUrl = new URL(request.url);
  const url = new URL(`${apiBase}/v1/catching/filters`);
  url.searchParams.set('school_code', schoolCode);
  const pass = ['start_date', 'end_date', 'session_type', 'level'] as const;
  for (const key of pass) {
    const value = inputUrl.searchParams.get(key)?.trim() ?? '';
    if (value) url.searchParams.set(key, value);
  }

  try {
    const playerIdentity = await resolveDashboardPlayerIdentity({
      role: session.role,
      organizationId: session.organizationId,
      userId: session.userId,
      name: session.name,
    });
    if (session.role === 'player' && !playerIdentity) {
      return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
    }

    const result = await fetchDashboardJsonWithCache({
      cacheKey: `catching:filters:${url.toString()}`,
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
    if (playerIdentity && Array.isArray(payload.catchers)) {
      const scoped = selectScopedPlayerName(payload.catchers, playerIdentity);
      payload.catchers = scoped ? [scoped] : [];
    }
    return NextResponse.json(payload, {
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

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, selectScopedPlayerName } from '../../../../../lib/dashboard-player-scope';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';

type Domain = 'Pitching' | 'Hitting' | 'Catching';

function uniqueNames(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean)));
}

const RESPONSE_CACHE_HEADERS = {
  'cache-control': 'private, max-age=20, stale-while-revalidate=100',
} as const;

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const inputUrl = new URL(request.url);
  const domainRaw = String(inputUrl.searchParams.get('domain') ?? '').trim();
  const domain: Domain = domainRaw === 'Hitting' || domainRaw === 'Catching' ? domainRaw : 'Pitching';

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
  const playerIdentity = await resolveDashboardPlayerIdentity({
    role: session.role,
    organizationId: session.organizationId,
    userId: session.userId,
    name: session.name,
  });
  if (session.role === 'player' && !playerIdentity) {
    return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
  }

  try {
    if (domain === 'Hitting' || domain === 'Pitching' || domain === 'Catching') {
      const filtersUrl = new URL(`${apiBase}/v1/${domain.toLowerCase()}/filters`);
      filtersUrl.searchParams.set('school_code', schoolCode);
      if (String(schoolCode ?? '').trim().toUpperCase() === 'PRO') {
        const level = String(inputUrl.searchParams.get('level') ?? '').trim();
        if (level && level !== 'All') filtersUrl.searchParams.set('level', level);
      }
      const result = await fetchDashboardJsonWithCache({
        cacheKey: `player-plans:${domain.toLowerCase()}:filters:${filtersUrl.toString()}`,
        ttlMs: 120000,
        staleTtlMs: 300000,
        timeoutMs: 10000,
        retries: 1,
        fetcher: () => fetch(filtersUrl.toString(), { cache: 'no-store' }),
      });
      if (result.status < 200 || result.status >= 300) {
        return NextResponse.json({ error: String(result.payload.detail ?? result.payload.error ?? 'Dashboard API request failed.') }, { status: result.status });
      }
      const poolRaw =
        domain === 'Hitting'
          ? result.payload.hitters
          : domain === 'Pitching'
            ? result.payload.pitchers
            : result.payload.catchers;
      const playerPool = uniqueNames(Array.isArray(poolRaw) ? poolRaw : []);
      if (!playerIdentity) return NextResponse.json({ players: playerPool }, { headers: RESPONSE_CACHE_HEADERS });
      const scoped = selectScopedPlayerName(playerPool, playerIdentity);
      if (scoped) return NextResponse.json({ players: [scoped] }, { headers: RESPONSE_CACHE_HEADERS });
      const fallback = scopedPlayerQueryName(playerIdentity, domain);
      return NextResponse.json({ players: fallback ? [fallback] : [] }, { headers: RESPONSE_CACHE_HEADERS });
    }

    return NextResponse.json({ players: [] }, { headers: RESPONSE_CACHE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load player options.' }, { status: 502 });
  }
}

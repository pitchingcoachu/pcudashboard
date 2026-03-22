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
    if (domain === 'Hitting') {
      const filtersUrl = new URL(`${apiBase}/v1/hitting/filters`);
      filtersUrl.searchParams.set('school_code', schoolCode);
      const result = await fetchDashboardJsonWithCache({
        cacheKey: `player-plans:hitting:filters:${filtersUrl.toString()}`,
        ttlMs: 30000,
        fetcher: () => fetch(filtersUrl.toString(), { cache: 'no-store' }),
      });
      if (result.status < 200 || result.status >= 300) {
        return NextResponse.json({ error: String(result.payload.detail ?? result.payload.error ?? 'Dashboard API request failed.') }, { status: result.status });
      }
      const hitterPool = uniqueNames(Array.isArray(result.payload.hitters) ? result.payload.hitters : []);
      const hitters = hitterPool;
      if (!playerIdentity) return NextResponse.json({ players: hitters });
      const scoped = selectScopedPlayerName(hitters, playerIdentity);
      if (scoped) return NextResponse.json({ players: [scoped] });
      const fallback = scopedPlayerQueryName(playerIdentity, 'Hitting');
      return NextResponse.json({ players: fallback ? [fallback] : [] });
    }

    const overviewUrl = new URL(`${apiBase}/v1/${domain.toLowerCase()}/overview`);
    overviewUrl.searchParams.set('school_code', schoolCode);
    overviewUrl.searchParams.set('team_type', schoolCode);
    overviewUrl.searchParams.set('split_by', domain === 'Pitching' ? 'Pitcher' : 'Catcher');

    const result = await fetchDashboardJsonWithCache({
      cacheKey: `player-plans:${domain.toLowerCase()}:overview:${overviewUrl.toString()}`,
      ttlMs: 30000,
      fetcher: () => fetch(overviewUrl.toString(), { cache: 'no-store' }),
    });
    if (result.status < 200 || result.status >= 300) {
      return NextResponse.json({ error: String(result.payload.detail ?? result.payload.error ?? 'Dashboard API request failed.') }, { status: result.status });
    }

    const splitNames = uniqueNames(
      (Array.isArray(result.payload.table_rows) ? result.payload.table_rows : [])
        .map((row: { Split?: unknown }) => String(row?.Split ?? '').trim())
        .filter((name: string) => name && name !== 'All')
    );
    if (splitNames.length) {
      if (!playerIdentity) return NextResponse.json({ players: splitNames });
      const scoped = selectScopedPlayerName(splitNames, playerIdentity);
      if (scoped) return NextResponse.json({ players: [scoped] });
      const fallback = scopedPlayerQueryName(playerIdentity, domain);
      return NextResponse.json({ players: fallback ? [fallback] : [] });
    }

    const pointNames = uniqueNames(
      (Array.isArray(result.payload.chart_points) ? result.payload.chart_points : []).map((row: { pitcher?: unknown; catcher?: unknown }) =>
        domain === 'Pitching' ? String(row?.pitcher ?? '').trim() : String(row?.catcher ?? '').trim()
      )
    );
    if (!playerIdentity) return NextResponse.json({ players: pointNames });
    const scoped = selectScopedPlayerName(pointNames, playerIdentity);
    if (scoped) return NextResponse.json({ players: [scoped] });
    const fallback = scopedPlayerQueryName(playerIdentity, domain);
    return NextResponse.json({ players: fallback ? [fallback] : [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load player options.' }, { status: 502 });
  }
}

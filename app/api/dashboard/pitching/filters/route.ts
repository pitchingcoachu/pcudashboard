import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, selectScopedPlayerName } from '../../../../../lib/dashboard-player-scope';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';

const RESPONSE_CACHE_HEADERS = {
  'cache-control': 'private, max-age=20, stale-while-revalidate=100',
} as const;

function uniqueNames(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean)));
}

function schoolRosterAdditions(schoolCode: string): { pitchers: string[] } {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (upper === 'PCU') {
    return {
      pitchers: ['Heather, Connor', 'Carr, Jordan', 'King, Stan', 'Jones, Grady', 'Birt, Henry'],
    };
  }
  return { pitchers: [] };
}

export async function GET() {
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
  const url = new URL(`${apiBase}/v1/pitching/filters`);
  url.searchParams.set('school_code', schoolCode);

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
      cacheKey: `pitching:filters:${url.toString()}`,
      ttlMs: 120000,
      staleTtlMs: 300000,
      timeoutMs: 10000,
      retries: 1,
      fetcher: () => fetch(url.toString(), { cache: 'no-store' }),
    });
    if (result.status < 200 || result.status >= 300) {
      return NextResponse.json({ error: String(result.payload.detail ?? result.payload.error ?? 'Dashboard API request failed.') }, { status: result.status });
    }
    const payload = result.payload as Record<string, unknown>;
    const additions = schoolRosterAdditions(schoolCode);
    if (Array.isArray(payload.pitchers) && additions.pitchers.length > 0) {
      payload.pitchers = uniqueNames([
        ...payload.pitchers.map((value) => String(value ?? '').trim()),
        ...additions.pitchers,
      ]);
    }
    if (playerIdentity && Array.isArray(payload.pitchers)) {
      const scoped = selectScopedPlayerName(payload.pitchers, playerIdentity);
      payload.pitchers = scoped ? [scoped] : [];
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

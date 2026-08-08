import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl } from '../../../../../lib/dashboard-access';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';

const RESPONSE_CACHE_HEADERS = {
  'cache-control': 'private, max-age=120, stale-while-revalidate=600',
  vary: 'Cookie',
} as const;

// Serves just the D1 pitcher -> team code map (school_code is always hardcoded
// to LEAGUE/D1 here, never taken from the request) so any authenticated
// dashboard user -- including college-site users comparing a pitcher against
// D1 arms in Pitcher DNA -- can resolve a real team for a D1 name, mirroring
// mlb-team-map's identical pattern for the MLB comparison pool.
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/pitching/filters`);
  url.searchParams.set('school_code', 'LEAGUE');
  url.searchParams.set('level', 'D1');

  try {
    const result = await fetchDashboardJsonWithCache({
      cacheKey: `pitching:d1-team-map:${url.toString()}`,
      ttlMs: 300000,
      staleTtlMs: 900000,
      timeoutMs: 30000,
      retries: 1,
      fetcher: () => fetch(url.toString(), { cache: 'no-store' }),
    });
    if (result.status < 200 || result.status >= 300) {
      return NextResponse.json({ error: 'Dashboard API request failed.' }, { status: result.status });
    }
    const payload = result.payload as Record<string, unknown>;
    return NextResponse.json(
      { pitchers_by_team_code: payload.pitchers_by_team_code ?? {} },
      { headers: RESPONSE_CACHE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reach dashboard API.' },
      { status: 502 }
    );
  }
}

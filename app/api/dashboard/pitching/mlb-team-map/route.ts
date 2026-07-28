import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl } from '../../../../../lib/dashboard-access';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';

const RESPONSE_CACHE_HEADERS = {
  'cache-control': 'private, max-age=120, stale-while-revalidate=600',
  vary: 'Cookie',
} as const;

// Serves just the MLB pitcher -> team code map (school_code is always hardcoded
// to PRO here, never taken from the request) so any authenticated dashboard
// user -- including college-site users comparing a pitcher against MLB arms in
// Arsenal DNA -- can resolve a real team/logo for an MLB name, the same way
// /api/dashboard/pitching/filters resolves it for users actually on the Pro site.
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/pitching/filters`);
  url.searchParams.set('school_code', 'PRO');
  url.searchParams.set('level', 'MLB');

  try {
    const result = await fetchDashboardJsonWithCache({
      cacheKey: `pitching:mlb-team-map:${url.toString()}`,
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

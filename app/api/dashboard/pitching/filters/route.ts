import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, selectScopedPlayerName, shouldScopeDashboardPlayer } from '../../../../../lib/dashboard-player-scope';
import { schoolRosterAdditions } from '../../../../../lib/dashboard-roster-additions';
import { listDashboardCsvPitcherNames } from '../../../../../lib/dashboard-csv-imports';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';
import { applyManagedRosterTeamScope } from '../../../../../lib/dashboard-managed-roster';
import { canonicalizeDashboardFilterPlayers } from '../../../../../lib/cross-school-player-data';

const RESPONSE_CACHE_HEADERS = {
  'cache-control': 'private, max-age=30, stale-while-revalidate=300',
  vary: 'Cookie',
} as const;
const SLOW_ROUTE_MS = 2500;
const PITCHING_FILTERS_ROSTER_CACHE_VERSION = 'managed-roster-team-scope-2026-09-04-v2';

function resolveFiltersTimeoutMs(schoolCode: string): number {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (upper === 'LEAGUE') return 120000;
  if (upper === 'PRO') return 120000;
  return 45000;
}

function uniqueNames(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean)));
}

function normalizePlayerName(value: string): string {
  const raw = String(value ?? '').trim();
  const firstLast = raw.includes(',')
    ? `${raw.split(',').slice(1).join(' ').trim()} ${raw.split(',')[0].trim()}`.trim()
    : raw;
  return firstLast.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mergePlayerNames(values: string[]): string[] {
  const names = new Map<string, string>();
  for (const value of values) {
    const name = String(value ?? '').trim();
    const key = normalizePlayerName(name);
    if (key && !names.has(key)) names.set(key, name);
  }
  return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
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
  const session = getSessionFromRequest(request, cookieStore);
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
  const forceRefresh = inputUrl.searchParams.get('force_refresh') === '1' || inputUrl.searchParams.get('force_refresh') === 'true';
  const shouldRefreshBallTypes = forceRefresh;
  const shouldRefreshUnmRosterScope = schoolCode === 'UNM';
  const url = new URL(`${apiBase}/v1/pitching/filters`);
  url.searchParams.set('school_code', schoolCode);
  if (level) url.searchParams.set('level', level);
  if (shouldRefreshBallTypes || shouldRefreshUnmRosterScope) url.searchParams.set('force_refresh', 'true');

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
      cacheKey: `pitching:filters:${PITCHING_FILTERS_ROSTER_CACHE_VERSION}:${shouldRefreshBallTypes ? 'force-ball-types' : 'cached'}:${url.toString()}`,
      ttlMs: forceRefresh ? 1000 : 120000,
      staleTtlMs: forceRefresh ? 0 : 300000,
      timeoutMs: resolveFiltersTimeoutMs(schoolCode),
      retries: 1,
      fetcher: () => fetch(url.toString(), { cache: 'no-store' }),
    });
    if (result.status < 200 || result.status >= 300) {
      return NextResponse.json({ error: String(result.payload.detail ?? result.payload.error ?? 'Dashboard API request failed.') }, { status: result.status });
    }
    const payload = result.payload as Record<string, unknown>;
    canonicalizeDashboardFilterPlayers({ payload, schoolCode, playerField: 'pitchers', mapField: 'pitchers_by_team_code' });
    await applyManagedRosterTeamScope({
      payload,
      schoolCode,
      fallbackOrganizationId: session.organizationId,
      playerField: 'pitchers',
      mapField: 'pitchers_by_team_code',
    });
    const csvPitchers = schoolCode === 'PRO' || schoolCode === 'LEAGUE'
      ? []
      : await listDashboardCsvPitcherNames(schoolCode).catch(() => []);
    if (csvPitchers.length > 0) {
      payload.pitchers = mergePlayerNames([
        ...(Array.isArray(payload.pitchers) ? payload.pitchers.map((value) => String(value ?? '').trim()) : []),
        ...csvPitchers,
      ]);
      const teamMap = payload.pitchers_by_team_code && typeof payload.pitchers_by_team_code === 'object'
        ? { ...(payload.pitchers_by_team_code as Record<string, unknown>) }
        : {};
      const schoolPitchers = Array.isArray(teamMap[schoolCode])
        ? (teamMap[schoolCode] as unknown[]).map((value) => String(value ?? '').trim())
        : [];
      teamMap[schoolCode] = mergePlayerNames([...schoolPitchers, ...csvPitchers]);
      payload.pitchers_by_team_code = teamMap;
    }
    const additions = schoolRosterAdditions(schoolCode);
    if (Array.isArray(payload.pitchers) && additions.pitchers.length > 0) {
      payload.pitchers = uniqueNames([
        ...payload.pitchers.map((value) => String(value ?? '').trim()),
        ...additions.pitchers,
      ]);
    }
    canonicalizeDashboardFilterPlayers({ payload, schoolCode, playerField: 'pitchers', mapField: 'pitchers_by_team_code' });
    let scopedPitcher: string | null = null;
    if (shouldScopePlayer && playerIdentity && Array.isArray(payload.pitchers)) {
      const scoped = selectScopedPlayerName(payload.pitchers, playerIdentity);
      const fallback = scopedPlayerQueryName(playerIdentity, 'Pitching');
      scopedPitcher = scoped || fallback || null;
      payload.pitchers = scopedPitcher ? [scopedPitcher] : [];
    }
    if (shouldScopePlayer && scopedPitcher) {
      const abUrl = new URL(`${apiBase}/v1/pitching/ab-report`);
      abUrl.searchParams.set('school_code', schoolCode);
      abUrl.searchParams.set('pitcher', scopedPitcher);
      const abResult = await fetchDashboardJsonWithCache({
        cacheKey: `pitching:filters:last-date:${abUrl.toString()}`,
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
      console.warn(`[dashboard][pitching/filters] slow request ${elapsed}ms`);
    }
  }
}

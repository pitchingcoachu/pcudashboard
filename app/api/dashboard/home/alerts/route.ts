import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, shouldScopeDashboardPlayer } from '../../../../../lib/dashboard-player-scope';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';

type FiltersPayload = {
  pitchers?: string[];
  hitters?: string[];
};

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolveDateWindows(): { seasonStart: string; seasonEnd: string; recentStart: string; recentEnd: string } {
  const now = new Date();
  const seasonStart = '2026-02-13';
  const seasonEnd = toYmd(now);
  const recentStartDate = new Date(now);
  recentStartDate.setDate(recentStartDate.getDate() - 13);
  return {
    seasonStart,
    seasonEnd,
    recentStart: toYmd(recentStartDate),
    recentEnd: seasonEnd,
  };
}

function normalizeNameFirstLast(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',');
  const first = rest.join(' ').trim();
  return `${first} ${last}`.replace(/\s+/g, ' ').trim();
}

function normalizedNameKey(value: string): string {
  const firstLast = normalizeNameFirstLast(String(value ?? ''));
  return firstLast.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[%,$]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowMetric(row: Record<string, unknown>, key: string): number | null {
  if (Object.prototype.hasOwnProperty.call(row, key)) return parseNumber(row[key]);
  const foundKey = Object.keys(row).find((candidate) => String(candidate).trim().toLowerCase() === key.toLowerCase());
  if (!foundKey) return null;
  return parseNumber(row[foundKey]);
}

function rowMetricByAliases(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = rowMetric(row, key);
    if (value !== null) return value;
  }
  return null;
}

function fetchCachedJson(url: URL, cacheKey: string, timeoutMs = 25000, retries = 0) {
  return fetchDashboardJsonWithCache({
    cacheKey,
    ttlMs: 45000,
    staleTtlMs: 180000,
    timeoutMs,
    retries,
    fetcher: (signal) => fetch(url.toString(), { cache: 'no-store', signal }),
  });
}

async function fetchFilters(apiBase: string, schoolCode: string): Promise<{ pitching: FiltersPayload; hitting: FiltersPayload }> {
  const pitchingUrl = new URL(`${apiBase}/v1/pitching/filters`);
  pitchingUrl.searchParams.set('school_code', schoolCode);
  const hittingUrl = new URL(`${apiBase}/v1/hitting/filters`);
  hittingUrl.searchParams.set('school_code', schoolCode);

  const [pitchingResult, hittingResult] = await Promise.all([
    fetchCachedJson(pitchingUrl, `home:alerts:filters:pitching:${pitchingUrl.toString()}`, 15000, 0),
    fetchCachedJson(hittingUrl, `home:alerts:filters:hitting:${hittingUrl.toString()}`, 15000, 0),
  ]);
  if (pitchingResult.status < 200 || pitchingResult.status >= 300) {
    throw new Error(String(pitchingResult.payload.error ?? pitchingResult.payload.detail ?? 'Failed to load pitching filters.'));
  }
  if (hittingResult.status < 200 || hittingResult.status >= 300) {
    throw new Error(String(hittingResult.payload.error ?? hittingResult.payload.detail ?? 'Failed to load hitting filters.'));
  }
  return {
    pitching: pitchingResult.payload as FiltersPayload,
    hitting: hittingResult.payload as FiltersPayload,
  };
}

type AlertRow = {
  name: string;
  sample: number;
  recentSample: number;
  metrics: Record<string, { season: number | null; recent: number | null }>;
};

type AlertsSnapshot = {
  pitching: AlertRow[];
  hitting: AlertRow[];
};

const alertsSnapshotCache = new Map<string, { at: number; payload: AlertsSnapshot }>();

function snapshotTtlMsForSchool(schoolCode: string): number {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (upper === 'LEAGUE' || upper === 'PRO') return 10 * 60 * 1000;
  return 60 * 1000;
}

function buildPitchingRows(
  seasonRows: Array<Record<string, unknown>>,
  recentRows: Array<Record<string, unknown>>,
  seasonFbSiRows: Array<Record<string, unknown>>,
  recentFbSiRows: Array<Record<string, unknown>>,
  allowedPlayerKeys?: Set<string>,
  minSeasonSample = 25
): AlertRow[] {
  const seasonVeloByName = new Map<string, number | null>();
  const recentVeloByName = new Map<string, number | null>();
  for (const row of seasonFbSiRows) {
    const rawName = String(row.Pitcher ?? row.pitcher ?? row.Name ?? '').trim();
    if (!rawName || rawName.toLowerCase() === 'all') continue;
    const key = normalizedNameKey(rawName);
    if (!key) continue;
    seasonVeloByName.set(key, rowMetric(row, 'Velo'));
  }
  for (const row of recentFbSiRows) {
    const rawName = String(row.Pitcher ?? row.pitcher ?? row.Name ?? '').trim();
    if (!rawName || rawName.toLowerCase() === 'all') continue;
    const key = normalizedNameKey(rawName);
    if (!key) continue;
    recentVeloByName.set(key, rowMetric(row, 'Velo'));
  }

  const byName = new Map<string, AlertRow>();
  for (const row of seasonRows) {
    const rawName = String(row.Pitcher ?? row.pitcher ?? row.Name ?? '').trim();
    if (!rawName || rawName.toLowerCase() === 'all') continue;
    const nameKey = normalizedNameKey(rawName);
    if (allowedPlayerKeys && allowedPlayerKeys.size > 0 && !allowedPlayerKeys.has(nameKey)) continue;
    const key = normalizedNameKey(rawName);
    if (!key) continue;
    byName.set(key, {
      name: normalizeNameFirstLast(rawName),
      sample: rowMetric(row, '#') ?? 0,
      recentSample: 0,
      metrics: {
        Velo: { season: seasonVeloByName.get(key) ?? null, recent: null },
        'K%': { season: rowMetric(row, 'K%'), recent: null },
        'BB%': { season: rowMetric(row, 'BB%'), recent: null },
        'E+A%': { season: rowMetric(row, 'E+A%'), recent: null },
      },
    });
  }
  for (const row of recentRows) {
    const rawName = String(row.Pitcher ?? row.pitcher ?? row.Name ?? '').trim();
    if (!rawName || rawName.toLowerCase() === 'all') continue;
    const key = normalizedNameKey(rawName);
    if (!key) continue;
    const current = byName.get(key);
    if (!current) continue;
    current.recentSample = rowMetric(row, '#') ?? current.recentSample;
    current.metrics.Velo.recent = recentVeloByName.get(key) ?? null;
    current.metrics['K%'].recent = rowMetric(row, 'K%');
    current.metrics['BB%'].recent = rowMetric(row, 'BB%');
    current.metrics['E+A%'].recent = rowMetric(row, 'E+A%');
  }
  return Array.from(byName.values())
    .filter((entry) => entry.sample >= minSeasonSample)
    .sort((a, b) => (b.recentSample - a.recentSample) || (b.sample - a.sample));
}

function buildHittingRows(
  seasonRows: Array<Record<string, unknown>>,
  recentRows: Array<Record<string, unknown>>,
  allowedPlayerKeys?: Set<string>,
  minSeasonSample = 20
): AlertRow[] {
  const byName = new Map<string, AlertRow>();
  for (const row of seasonRows) {
    const rawName = String(row.Batter ?? row.Hitter ?? row.hitter ?? row.Name ?? '').trim();
    if (!rawName || rawName.toLowerCase() === 'all') continue;
    const nameKey = normalizedNameKey(rawName);
    if (allowedPlayerKeys && allowedPlayerKeys.size > 0 && !allowedPlayerKeys.has(nameKey)) continue;
    const key = nameKey;
    if (!key) continue;
    byName.set(key, {
      name: normalizeNameFirstLast(rawName),
      sample: rowMetric(row, '#') ?? rowMetric(row, 'PA') ?? 0,
      recentSample: 0,
      metrics: {
        xWOBA: { season: rowMetric(row, 'xWOBA'), recent: null },
        'Barrel%': { season: rowMetric(row, 'Barrel%'), recent: null },
        'K%': { season: rowMetric(row, 'K%'), recent: null },
        'BB%': { season: rowMetric(row, 'BB%'), recent: null },
      },
    });
  }
  for (const row of recentRows) {
    const rawName = String(row.Batter ?? row.Hitter ?? row.hitter ?? row.Name ?? '').trim();
    if (!rawName || rawName.toLowerCase() === 'all') continue;
    const key = normalizedNameKey(rawName);
    if (!key) continue;
    const current = byName.get(key);
    if (!current) continue;
    current.recentSample = rowMetric(row, '#') ?? rowMetric(row, 'PA') ?? current.recentSample;
    current.metrics.xWOBA.recent = rowMetric(row, 'xWOBA');
    current.metrics['Barrel%'].recent = rowMetric(row, 'Barrel%');
    current.metrics['K%'].recent = rowMetric(row, 'K%');
    current.metrics['BB%'].recent = rowMetric(row, 'BB%');
  }
  return Array.from(byName.values())
    .filter((entry) => entry.sample >= minSeasonSample)
    .sort((a, b) => (b.recentSample - a.recentSample) || (b.sample - a.sample));
}

async function fetchPitchingAlerts(
  apiBase: string,
  schoolCode: string,
  dates: ReturnType<typeof resolveDateWindows>,
  allowedPlayerKeys?: Set<string>,
  scopedPitcher?: string,
  minSeasonSample = 25
): Promise<AlertRow[]> {
  const buildOverviewUrl = (startDate: string, endDate: string) => {
    const url = new URL(`${apiBase}/v1/pitching/overview`);
    url.searchParams.set('school_code', schoolCode);
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set('table_mode', 'Custom');
    url.searchParams.set('split_by', 'Pitcher');
    url.searchParams.set('custom_columns', 'K%,BB%,E+A%');
    url.searchParams.set('include_chart_points', '0');
    url.searchParams.set('include_row_pitches', '0');
    url.searchParams.set('include_trend_rows', '0');
    if (scopedPitcher) url.searchParams.set('pitcher', scopedPitcher);
    return url;
  };
  const buildFbSiVeloUrl = (startDate: string, endDate: string) => {
    const url = new URL(`${apiBase}/v1/pitching/overview`);
    url.searchParams.set('school_code', schoolCode);
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set('table_mode', 'Custom');
    url.searchParams.set('split_by', 'Pitcher');
    url.searchParams.set('custom_columns', 'Velo');
    url.searchParams.set('pitch_types', 'Fastball,Sinker');
    url.searchParams.set('include_chart_points', '0');
    url.searchParams.set('include_row_pitches', '0');
    url.searchParams.set('include_trend_rows', '0');
    if (scopedPitcher) url.searchParams.set('pitcher', scopedPitcher);
    return url;
  };
  const seasonUrl = buildOverviewUrl(dates.seasonStart, dates.seasonEnd);
  const recentUrl = buildOverviewUrl(dates.recentStart, dates.recentEnd);
  const seasonFbSiUrl = buildFbSiVeloUrl(dates.seasonStart, dates.seasonEnd);
  const recentFbSiUrl = buildFbSiVeloUrl(dates.recentStart, dates.recentEnd);
  const [seasonResult, recentResult, seasonFbSiResult, recentFbSiResult] = await Promise.all([
    fetchCachedJson(seasonUrl, `home:alerts:pitching:season:${seasonUrl.toString()}`),
    fetchCachedJson(recentUrl, `home:alerts:pitching:recent:${recentUrl.toString()}`),
    fetchCachedJson(seasonFbSiUrl, `home:alerts:pitching:season-fbsi-velo:${seasonFbSiUrl.toString()}`),
    fetchCachedJson(recentFbSiUrl, `home:alerts:pitching:recent-fbsi-velo:${recentFbSiUrl.toString()}`),
  ]);
  if (seasonResult.status < 200 || seasonResult.status >= 300) {
    throw new Error(String(seasonResult.payload.error ?? seasonResult.payload.detail ?? 'Failed to load pitching alerts.'));
  }
  if (recentResult.status < 200 || recentResult.status >= 300) {
    throw new Error(String(recentResult.payload.error ?? recentResult.payload.detail ?? 'Failed to load pitching alerts.'));
  }
  if (seasonFbSiResult.status < 200 || seasonFbSiResult.status >= 300) {
    throw new Error(String(seasonFbSiResult.payload.error ?? seasonFbSiResult.payload.detail ?? 'Failed to load pitching alerts.'));
  }
  if (recentFbSiResult.status < 200 || recentFbSiResult.status >= 300) {
    throw new Error(String(recentFbSiResult.payload.error ?? recentFbSiResult.payload.detail ?? 'Failed to load pitching alerts.'));
  }
  const seasonRows = Array.isArray((seasonResult.payload as { table_rows?: unknown[] }).table_rows)
    ? ((seasonResult.payload as { table_rows?: unknown[] }).table_rows as Array<Record<string, unknown>>)
    : [];
  const recentRows = Array.isArray((recentResult.payload as { table_rows?: unknown[] }).table_rows)
    ? ((recentResult.payload as { table_rows?: unknown[] }).table_rows as Array<Record<string, unknown>>)
    : [];
  const seasonFbSiRows = Array.isArray((seasonFbSiResult.payload as { table_rows?: unknown[] }).table_rows)
    ? ((seasonFbSiResult.payload as { table_rows?: unknown[] }).table_rows as Array<Record<string, unknown>>)
    : [];
  const recentFbSiRows = Array.isArray((recentFbSiResult.payload as { table_rows?: unknown[] }).table_rows)
    ? ((recentFbSiResult.payload as { table_rows?: unknown[] }).table_rows as Array<Record<string, unknown>>)
    : [];
  return buildPitchingRows(seasonRows, recentRows, seasonFbSiRows, recentFbSiRows, allowedPlayerKeys, minSeasonSample);
}

async function fetchHittingAlerts(
  apiBase: string,
  schoolCode: string,
  dates: ReturnType<typeof resolveDateWindows>,
  allowedPlayerKeys?: Set<string>,
  scopedHitter?: string,
  minSeasonSample = 20
): Promise<AlertRow[]> {
  const buildUrl = (startDate: string, endDate: string) => {
    const url = new URL(`${apiBase}/v1/hitting/overview`);
    url.searchParams.set('school_code', schoolCode);
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set('table_mode', 'Custom');
    url.searchParams.set('split_by', 'Batter');
    url.searchParams.set('custom_columns', 'xWOBA,Barrel%,K%,BB%');
    url.searchParams.set('include_chart_points', '0');
    if (scopedHitter) url.searchParams.set('hitter', scopedHitter);
    return url;
  };
  const seasonUrl = buildUrl(dates.seasonStart, dates.seasonEnd);
  const recentUrl = buildUrl(dates.recentStart, dates.recentEnd);
  const [seasonResult, recentResult] = await Promise.all([
    fetchCachedJson(seasonUrl, `home:alerts:hitting:season:${seasonUrl.toString()}`),
    fetchCachedJson(recentUrl, `home:alerts:hitting:recent:${recentUrl.toString()}`),
  ]);
  if (seasonResult.status < 200 || seasonResult.status >= 300) {
    throw new Error(String(seasonResult.payload.error ?? seasonResult.payload.detail ?? 'Failed to load hitting alerts.'));
  }
  if (recentResult.status < 200 || recentResult.status >= 300) {
    throw new Error(String(recentResult.payload.error ?? recentResult.payload.detail ?? 'Failed to load hitting alerts.'));
  }
  const seasonRows = Array.isArray((seasonResult.payload as { table_rows?: unknown[] }).table_rows)
    ? ((seasonResult.payload as { table_rows?: unknown[] }).table_rows as Array<Record<string, unknown>>)
    : [];
  const recentRows = Array.isArray((recentResult.payload as { table_rows?: unknown[] }).table_rows)
    ? ((recentResult.payload as { table_rows?: unknown[] }).table_rows as Array<Record<string, unknown>>)
    : [];
  return buildHittingRows(seasonRows, recentRows, allowedPlayerKeys, minSeasonSample);
}

export async function GET(request: Request) {
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
  const dates = resolveDateWindows();
  const apiBase = resolveDashboardApiBaseUrl();
  const shouldScopePlayer = shouldScopeDashboardPlayer(session.role, schoolCode);
  const staleSnapshotKey = `${schoolCode}:${dates.seasonStart}:${dates.seasonEnd}:${dates.recentStart}:${dates.recentEnd}:${shouldScopePlayer ? 'scoped' : 'all'}`;

  try {
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
    const scopedPitcher = shouldScopePlayer && playerIdentity ? scopedPlayerQueryName(playerIdentity, 'Pitching') : '';
    const scopedHitter = shouldScopePlayer && playerIdentity ? scopedPlayerQueryName(playerIdentity, 'Hitting') : '';
    const trendsUrl = new URL(`${apiBase}/v1/home/trends`);
    trendsUrl.searchParams.set('school_code', schoolCode);
    trendsUrl.searchParams.set('season_start', dates.seasonStart);
    trendsUrl.searchParams.set('season_end', dates.seasonEnd);
    trendsUrl.searchParams.set('recent_start', dates.recentStart);
    trendsUrl.searchParams.set('recent_end', dates.recentEnd);
    if (scopedPitcher) trendsUrl.searchParams.set('scoped_pitcher', scopedPitcher);
    if (scopedHitter) trendsUrl.searchParams.set('scoped_hitter', scopedHitter);
    const trendsResult = await fetchCachedJson(trendsUrl, `home:alerts:trends:${trendsUrl.toString()}`, 20000, 0);
    if (trendsResult.status >= 200 && trendsResult.status < 300) {
      const payload = trendsResult.payload as {
        school_code?: string;
        season_start?: string;
        season_end?: string;
        recent_start?: string;
        recent_end?: string;
        pitching?: AlertRow[];
        hitting?: AlertRow[];
      };
      if (Array.isArray(payload.pitching) && Array.isArray(payload.hitting)) {
        return NextResponse.json({
          school_code: payload.school_code ?? schoolCode,
          season_start: payload.season_start ?? dates.seasonStart,
          season_end: payload.season_end ?? dates.seasonEnd,
          recent_start: payload.recent_start ?? dates.recentStart,
          recent_end: payload.recent_end ?? dates.recentEnd,
          pitching: payload.pitching,
          hitting: payload.hitting,
        });
      }
    }
    const snapshotKey = `${schoolCode}:${dates.seasonStart}:${dates.seasonEnd}:${dates.recentStart}:${dates.recentEnd}:${shouldScopePlayer ? 'scoped' : 'all'}:${scopedPitcher.toLowerCase()}:${scopedHitter.toLowerCase()}`;
    const ttlMs = snapshotTtlMsForSchool(schoolCode);
    const cached = alertsSnapshotCache.get(snapshotKey);
    const now = Date.now();
    let snapshot: AlertsSnapshot;
    if (cached && now - cached.at <= ttlMs) {
      snapshot = cached.payload;
    } else {
      const filtersPayload = shouldScopePlayer ? null : await fetchFilters(apiBase, schoolCode);
      const allowedPitchingPlayers = new Set(
        (filtersPayload?.pitching.pitchers ?? [])
          .map((name) => normalizedNameKey(String(name ?? '')))
          .filter(Boolean)
      );
      const allowedHittingPlayers = new Set(
        (filtersPayload?.hitting.hitters ?? [])
          .map((name) => normalizedNameKey(String(name ?? '')))
          .filter(Boolean)
      );
      const [pitching, hitting] = await Promise.all([
        fetchPitchingAlerts(
          apiBase,
          schoolCode,
          dates,
          shouldScopePlayer ? undefined : allowedPitchingPlayers,
          scopedPitcher,
          shouldScopePlayer ? 0 : 25
        ),
        fetchHittingAlerts(
          apiBase,
          schoolCode,
          dates,
          shouldScopePlayer ? undefined : allowedHittingPlayers,
          scopedHitter,
          shouldScopePlayer ? 0 : 20
        ),
      ]);
      snapshot = { pitching, hitting };
      alertsSnapshotCache.set(snapshotKey, { at: now, payload: snapshot });
    }
    return NextResponse.json({
      school_code: schoolCode,
      season_start: dates.seasonStart,
      season_end: dates.seasonEnd,
      recent_start: dates.recentStart,
      recent_end: dates.recentEnd,
      pitching: snapshot.pitching,
      hitting: snapshot.hitting,
    });
  } catch (error) {
    // Degrade gracefully for home dashboard: serve stale snapshot if available,
    // otherwise return empty payload instead of a hard 502.
    const stale = Array.from(alertsSnapshotCache.entries()).find(([key]) => key.startsWith(staleSnapshotKey))?.[1];
    if (stale) {
      return NextResponse.json({
        school_code: schoolCode,
        season_start: dates.seasonStart,
        season_end: dates.seasonEnd,
        recent_start: dates.recentStart,
        recent_end: dates.recentEnd,
        pitching: stale.payload.pitching,
        hitting: stale.payload.hitting,
        degraded: true,
      });
    }
    return NextResponse.json({
      school_code: schoolCode,
      season_start: dates.seasonStart,
      season_end: dates.seasonEnd,
      recent_start: dates.recentStart,
      recent_end: dates.recentEnd,
      pitching: [],
      hitting: [],
      degraded: true,
      error: error instanceof Error ? error.message : 'Failed to load home alerts.',
    });
  }
}

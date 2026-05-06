import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, shouldScopeDashboardPlayer } from '../../../../../lib/dashboard-player-scope';

type FiltersPayload = {
  min_date?: string | null;
  max_date?: string | null;
  pitchers?: string[];
  hitters?: string[];
  team_types?: string[];
  pitchers_by_team_code?: Record<string, string[]>;
  hitters_by_team_code?: Record<string, string[]>;
};

type Candidate = {
  type: 'player' | 'team';
  value: string;
  suite: 'Pitching' | 'Hitting';
  team_code?: string;
};

type MetricItem = {
  key: string;
  value: string | number;
};

type SuiteSummary = {
  totalPitches: number;
  metrics: MetricItem[];
  tableColumns: string[];
  tableRows: Record<string, unknown>[];
};

type HomeSearchBaseSnapshot = {
  candidates: Candidate[];
  dateWindow: { startDate: string; endDate: string };
  latestDate: string | null;
};

const homeSearchBaseCache = new Map<string, { at: number; payload: HomeSearchBaseSnapshot }>();
const homeSearchBaseInflight = new Map<string, Promise<HomeSearchBaseSnapshot>>();

function resolveHomeSearchBaseTtlMs(schoolCode: string): number {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (upper === 'PRO') return 10 * 60 * 1000;
  if (upper === 'LEAGUE') return 5 * 60 * 1000;
  return 2 * 60 * 1000;
}

function normalizeText(value: string): string {
  return String(value ?? '').trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => normalizeText(entry)).filter(Boolean)));
}

function normalizeTeamKey(value: string): string {
  return normalizeText(value).toUpperCase();
}

function normalizeNameToken(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isLikelyTeamCode(value: string): boolean {
  const key = normalizeTeamKey(value);
  if (!key || key === 'ALL') return false;
  return /^[A-Z0-9]{2,}(?:_[A-Z0-9]+)+$/.test(key);
}

function buildCanonicalTeamCodeLookup(
  byTeamMaps: Array<Record<string, string[]> | undefined>
): Map<string, string> {
  const merged = new Map<string, string[]>();
  for (const source of byTeamMaps) {
    if (!source) continue;
    for (const [rawKey, names] of Object.entries(source)) {
      const key = normalizeText(rawKey);
      if (!key || !Array.isArray(names)) continue;
      merged.set(key, names.map((entry) => normalizeText(entry)).filter(Boolean));
    }
  }

  const signatureToCode = new Map<string, string>();
  for (const [key, names] of merged.entries()) {
    if (!isLikelyTeamCode(key)) continue;
    const signature = names.map(normalizeNameToken).filter(Boolean).sort().join('|');
    if (!signature) continue;
    if (!signatureToCode.has(signature)) signatureToCode.set(signature, normalizeTeamKey(key));
  }

  const lookup = new Map<string, string>();
  for (const [key, names] of merged.entries()) {
    const normalizedKey = normalizeTeamKey(key);
    if (!normalizedKey) continue;
    if (isLikelyTeamCode(normalizedKey)) {
      lookup.set(normalizedKey, normalizedKey);
      continue;
    }
    const signature = names.map(normalizeNameToken).filter(Boolean).sort().join('|');
    const resolved = signature ? signatureToCode.get(signature) : null;
    if (resolved) lookup.set(normalizedKey, resolved);
  }
  return lookup;
}

function normalizedNameKey(value: string): string {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return '';
  if (raw.includes(',')) {
    const [last, ...rest] = raw.split(',');
    const first = rest.join(' ').trim();
    return `${first} ${last}`.replace(/[^a-z0-9]/g, '');
  }
  return raw.replace(/[^a-z0-9]/g, '');
}

function mergePlayerTeamMap(target: Map<string, string>, byTeamCode?: Record<string, string[]>) {
  if (!byTeamCode) return;
  for (const [teamCodeRaw, names] of Object.entries(byTeamCode)) {
    const teamCode = normalizeText(teamCodeRaw).toUpperCase();
    if (!teamCode || !Array.isArray(names)) continue;
    for (const rawName of names) {
      const key = normalizedNameKey(rawName);
      if (!key) continue;
      if (!target.has(key)) target.set(key, teamCode);
    }
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveSeasonWindow(schoolCode: string, latestAvailableDate: string | null): { startDate: string; endDate: string } {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  const today = todayIso();

  if (upper === 'PRO') return { startDate: '2026-03-25', endDate: today };
  if (upper === 'CNU') return { startDate: '2026-01-31', endDate: today };
  if (upper === 'PCU') {
    const latest = latestAvailableDate && isIsoDate(latestAvailableDate) ? latestAvailableDate : today;
    return { startDate: latest, endDate: latest };
  }
  return { startDate: '2026-02-13', endDate: today };
}

function resolveScopedPlayerWindow(schoolCode: string, latestAvailableDate: string | null): { startDate: string; endDate: string } {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  const latest = latestAvailableDate && isIsoDate(latestAvailableDate) ? latestAvailableDate : todayIso();
  if (upper === 'PCU') return { startDate: latest, endDate: latest };
  if (upper === 'CNU') return { startDate: '2026-01-31', endDate: latest };
  if (upper === 'PRO') return { startDate: '2026-03-25', endDate: latest };
  return { startDate: '2026-02-13', endDate: latest };
}

function pickLatestDate(values: Array<string | null | undefined>): string | null {
  const valid = values
    .map((value) => normalizeText(String(value ?? '')))
    .filter((value) => isIsoDate(value))
    .sort();
  return valid.length ? valid[valid.length - 1] : null;
}

function normalizeMetricKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractSummaryMetrics(row: Record<string, unknown> | null | undefined): MetricItem[] {
  if (!row) return [];
  const blocked = new Set([
    'pitch_type',
    'group',
    'label',
    'name',
    'count',
    '#',
    'pitches',
    'bf',
    'pa',
    'ab',
  ]);
  const out: MetricItem[] = [];
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const key = normalizeText(rawKey);
    if (!key) continue;
    if (blocked.has(key.toLowerCase())) continue;
    if (rawValue === null || rawValue === undefined) continue;
    if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) continue;
    if (typeof rawValue !== 'number' && typeof rawValue !== 'string') continue;
    const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    if (value === '') continue;
    out.push({ key: normalizeMetricKey(key), value });
    if (out.length >= 8) break;
  }
  return out;
}

async function fetchJsonWithCache(url: URL, cacheKey: string, timeoutMs = 20000, retries = 0) {
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
    fetchJsonWithCache(pitchingUrl, `home:filters:pitching:${pitchingUrl.toString()}`, 15000, 0),
    fetchJsonWithCache(hittingUrl, `home:filters:hitting:${hittingUrl.toString()}`, 15000, 0),
  ]);

  if (pitchingResult.status < 200 || pitchingResult.status >= 300) {
    throw new Error(String(pitchingResult.payload.detail ?? pitchingResult.payload.error ?? 'Pitching filters request failed.'));
  }
  if (hittingResult.status < 200 || hittingResult.status >= 300) {
    throw new Error(String(hittingResult.payload.detail ?? hittingResult.payload.error ?? 'Hitting filters request failed.'));
  }

  return {
    pitching: pitchingResult.payload as FiltersPayload,
    hitting: hittingResult.payload as FiltersPayload,
  };
}

async function fetchSuiteSummary(input: {
  apiBase: string;
  schoolCode: string;
  startDate: string;
  endDate: string;
  targetType: 'player' | 'team';
  targetValue: string;
}): Promise<{ pitching: SuiteSummary | null; hitting: SuiteSummary | null }> {
  const pitchingUrl = new URL(`${input.apiBase}/v1/pitching/overview`);
  pitchingUrl.searchParams.set('school_code', input.schoolCode);
  pitchingUrl.searchParams.set('start_date', input.startDate);
  pitchingUrl.searchParams.set('end_date', input.endDate);
  pitchingUrl.searchParams.set('include_chart_points', '0');
  pitchingUrl.searchParams.set('include_row_pitches', '0');
  pitchingUrl.searchParams.set('include_trend_rows', '0');
  if (input.targetType === 'player') pitchingUrl.searchParams.set('pitcher', input.targetValue);
  else pitchingUrl.searchParams.set('team_type', input.targetValue);

  const hittingUrl = new URL(`${input.apiBase}/v1/hitting/overview`);
  hittingUrl.searchParams.set('school_code', input.schoolCode);
  hittingUrl.searchParams.set('start_date', input.startDate);
  hittingUrl.searchParams.set('end_date', input.endDate);
  hittingUrl.searchParams.set('include_chart_points', '0');
  if (input.targetType === 'player') hittingUrl.searchParams.set('hitter', input.targetValue);
  else hittingUrl.searchParams.set('team_type', input.targetValue);

  const [pitchingResult, hittingResult] = await Promise.all([
    fetchJsonWithCache(pitchingUrl, `home:overview:pitching:${pitchingUrl.toString()}`, 20000, 0),
    fetchJsonWithCache(hittingUrl, `home:overview:hitting:${hittingUrl.toString()}`, 20000, 0),
  ]);

  const pitchingPayload = pitchingResult.status >= 200 && pitchingResult.status < 300
    ? (pitchingResult.payload as { total_pitches?: number; table_columns?: string[]; table_rows?: Record<string, unknown>[] })
    : null;
  const hittingPayload = hittingResult.status >= 200 && hittingResult.status < 300
    ? (hittingResult.payload as { total_pitches?: number; table_columns?: string[]; table_rows?: Record<string, unknown>[] })
    : null;

  return {
    pitching: pitchingPayload
        ? {
            totalPitches: Number(pitchingPayload.total_pitches ?? 0),
            metrics: extractSummaryMetrics(Array.isArray(pitchingPayload.table_rows) ? pitchingPayload.table_rows[0] : null),
            tableColumns: Array.isArray(pitchingPayload.table_columns) ? pitchingPayload.table_columns.map((value) => String(value ?? '').trim()).filter(Boolean) : [],
            tableRows: Array.isArray(pitchingPayload.table_rows) ? pitchingPayload.table_rows : [],
          }
        : null,
    hitting: hittingPayload
      ? {
          totalPitches: Number(hittingPayload.total_pitches ?? 0),
          metrics: extractSummaryMetrics(Array.isArray(hittingPayload.table_rows) ? hittingPayload.table_rows[0] : null),
          tableColumns: Array.isArray(hittingPayload.table_columns) ? hittingPayload.table_columns.map((value) => String(value ?? '').trim()).filter(Boolean) : [],
          tableRows: Array.isArray(hittingPayload.table_rows) ? hittingPayload.table_rows : [],
        }
      : null,
  };
}

async function fetchLatestScopedDate(input: {
  apiBase: string;
  schoolCode: string;
  scopedPitcher: string;
  scopedHitter: string;
}): Promise<string | null> {
  const pitchingLatestPromise = input.scopedPitcher
    ? (async () => {
        const pitchingUrl = new URL(`${input.apiBase}/v1/pitching/ab-report`);
        pitchingUrl.searchParams.set('school_code', input.schoolCode);
        pitchingUrl.searchParams.set('pitcher', input.scopedPitcher);
        const pitchingResult = await fetchJsonWithCache(
          pitchingUrl,
          `home:scoped:last-date:pitching:${pitchingUrl.toString()}`,
          12000,
          0
        );
        if (pitchingResult.status < 200 || pitchingResult.status >= 300) return null;
        const games = Array.isArray((pitchingResult.payload as { available_games?: unknown[] }).available_games)
          ? ((pitchingResult.payload as { available_games?: unknown[] }).available_games as Array<Record<string, unknown>>)
          : [];
        return pickLatestDate(games.map((game) => String(game.date ?? '').trim()));
      })()
    : Promise.resolve<string | null>(null);
  const hittingLatestPromise = input.scopedHitter
    ? (async () => {
        const hittingUrl = new URL(`${input.apiBase}/v1/hitting/ab-report`);
        hittingUrl.searchParams.set('school_code', input.schoolCode);
        hittingUrl.searchParams.set('hitter', input.scopedHitter);
        const hittingResult = await fetchJsonWithCache(
          hittingUrl,
          `home:scoped:last-date:hitting:${hittingUrl.toString()}`,
          12000,
          0
        );
        if (hittingResult.status < 200 || hittingResult.status >= 300) return null;
        const games = Array.isArray((hittingResult.payload as { available_games?: unknown[] }).available_games)
          ? ((hittingResult.payload as { available_games?: unknown[] }).available_games as Array<Record<string, unknown>>)
          : [];
        return pickLatestDate(games.map((game) => String(game.date ?? '').trim()));
      })()
    : Promise.resolve<string | null>(null);
  const [pitchingLatest, hittingLatest] = await Promise.all([pitchingLatestPromise, hittingLatestPromise]);
  return pickLatestDate([pitchingLatest, hittingLatest]);
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
  const query = normalizeText(inputUrl.searchParams.get('q') ?? '').toLowerCase();
  const targetTypeRaw = normalizeText(inputUrl.searchParams.get('target_type') ?? '').toLowerCase();
  const targetValue = normalizeText(inputUrl.searchParams.get('target') ?? '');
  const targetType = targetTypeRaw === 'team' ? 'team' : targetTypeRaw === 'player' ? 'player' : null;
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

  try {
    const scopedPitcher = shouldScopePlayer && playerIdentity ? scopedPlayerQueryName(playerIdentity, 'Pitching') : '';
    const scopedHitter = shouldScopePlayer && playerIdentity ? scopedPlayerQueryName(playerIdentity, 'Hitting') : '';
    const snapshotKey = `${schoolCode}|${session.role}|${shouldScopePlayer ? 'scoped' : 'all'}|${scopedPitcher.toLowerCase()}|${scopedHitter.toLowerCase()}`;
    const ttlMs = resolveHomeSearchBaseTtlMs(schoolCode);
    const now = Date.now();
    const cachedBase = homeSearchBaseCache.get(snapshotKey);

    let baseSnapshot: HomeSearchBaseSnapshot | null = null;
    if (cachedBase && now - cachedBase.at <= ttlMs) {
      baseSnapshot = cachedBase.payload;
    } else {
      const inflight = homeSearchBaseInflight.get(snapshotKey);
      if (inflight) {
        try {
          baseSnapshot = await inflight;
        } catch (refreshError) {
          if (cachedBase) baseSnapshot = cachedBase.payload;
          else throw refreshError;
        }
      } else {
        const refreshPromise = (async (): Promise<HomeSearchBaseSnapshot> => {
          const { pitching, hitting } = shouldScopePlayer
            ? {
                pitching: { pitchers: uniqueStrings([scopedPitcher]) } as FiltersPayload,
                hitting: { hitters: uniqueStrings([scopedHitter]) } as FiltersPayload,
              }
            : await fetchFilters(apiBase, schoolCode);

          const pitchingPlayers = shouldScopePlayer ? uniqueStrings([scopedPitcher]) : uniqueStrings(pitching.pitchers ?? []);
          const hittingPlayers = shouldScopePlayer ? uniqueStrings([scopedHitter]) : uniqueStrings(hitting.hitters ?? []);
          const playerTeamByName = new Map<string, string>();
          mergePlayerTeamMap(playerTeamByName, pitching.pitchers_by_team_code);
          mergePlayerTeamMap(playerTeamByName, hitting.hitters_by_team_code);

          const playerMap = new Map<string, { value: string; inPitching: boolean; inHitting: boolean; team_code?: string }>();
          for (const name of pitchingPlayers) {
            const key = name.toLowerCase();
            const normalizedKey = normalizedNameKey(name);
            const current = playerMap.get(key) ?? { value: name, inPitching: false, inHitting: false };
            current.value = current.value || name;
            current.inPitching = true;
            if (!current.team_code && normalizedKey) current.team_code = playerTeamByName.get(normalizedKey);
            playerMap.set(key, current);
          }
          for (const name of hittingPlayers) {
            const key = name.toLowerCase();
            const normalizedKey = normalizedNameKey(name);
            const current = playerMap.get(key) ?? { value: name, inPitching: false, inHitting: false };
            current.value = current.value || name;
            current.inHitting = true;
            if (!current.team_code && normalizedKey) current.team_code = playerTeamByName.get(normalizedKey);
            playerMap.set(key, current);
          }
          const playerCandidates: Candidate[] = Array.from(playerMap.values())
            .map((entry) => ({
              type: 'player' as const,
              value: entry.value,
              suite: entry.inPitching ? 'Pitching' : 'Hitting',
              team_code: entry.team_code,
            }));

          const teamCandidates: Candidate[] = shouldScopePlayer
            ? []
            : (() => {
                const teamCodeLookup = buildCanonicalTeamCodeLookup([
                  pitching.pitchers_by_team_code,
                  hitting.hitters_by_team_code,
                ]);
                const teams = uniqueStrings([...(pitching.team_types ?? []), ...(hitting.team_types ?? [])])
                  .filter((value) => value.toLowerCase() !== 'all');
                return teams.map((value) => ({
                  type: 'team' as const,
                  value,
                  suite: 'Pitching' as const,
                  team_code: teamCodeLookup.get(normalizeTeamKey(value)) ?? normalizeTeamKey(value),
                }));
              })();

          const candidates: Candidate[] = [...playerCandidates, ...teamCandidates].sort((a, b) => {
            if (a.type !== b.type) return a.type.localeCompare(b.type);
            return a.value.localeCompare(b.value);
          });

          const latestDate = shouldScopePlayer
            ? await fetchLatestScopedDate({
                apiBase,
                schoolCode,
                scopedPitcher,
                scopedHitter,
              })
            : pickLatestDate([pitching.max_date, hitting.max_date]);
          const dateWindow = shouldScopePlayer
            ? resolveScopedPlayerWindow(schoolCode, latestDate)
            : resolveSeasonWindow(schoolCode, latestDate);

          return {
            candidates,
            dateWindow,
            latestDate,
          };
        })();
        homeSearchBaseInflight.set(snapshotKey, refreshPromise);
        try {
          baseSnapshot = await refreshPromise;
          homeSearchBaseCache.set(snapshotKey, { at: now, payload: baseSnapshot });
        } catch (refreshError) {
          if (cachedBase) {
            baseSnapshot = cachedBase.payload;
          } else {
            throw refreshError;
          }
        } finally {
          homeSearchBaseInflight.delete(snapshotKey);
        }
      }
    }

    const candidates = baseSnapshot?.candidates ?? [];
    const dateWindow = baseSnapshot?.dateWindow ?? resolveSeasonWindow(schoolCode, null);

    const filteredCandidates = query
      ? candidates.filter((candidate) => candidate.value.toLowerCase().includes(query))
      : candidates;

    let summary: { pitching: SuiteSummary | null; hitting: SuiteSummary | null } | null = null;
    if (targetType && targetValue) {
      const matchExists = candidates.some((candidate) => candidate.type === targetType && candidate.value.toLowerCase() === targetValue.toLowerCase());
      if (matchExists) {
        summary = await fetchSuiteSummary({
          apiBase,
          schoolCode,
          startDate: dateWindow.startDate,
          endDate: dateWindow.endDate,
          targetType,
          targetValue,
        });
      }
    }

    return NextResponse.json({
      school_code: schoolCode,
      date_window: dateWindow,
      candidates,
      suggestions: filteredCandidates.slice(0, 20),
      selected: targetType && targetValue ? { type: targetType, value: targetValue } : null,
      summary,
    });
  } catch (error) {
    const fallbackWindow = resolveSeasonWindow(schoolCode, null);
    return NextResponse.json({
      school_code: schoolCode,
      date_window: fallbackWindow,
      candidates: [],
      suggestions: [],
      selected: targetType && targetValue ? { type: targetType, value: targetValue } : null,
      summary: null,
      error: error instanceof Error ? error.message : 'Failed to load dashboard home search.',
    });
  }
}

import { fetchDashboardJsonWithCache } from '../dashboard-route-cache';

export type ChatDomain = 'pitching' | 'hitting';

export type FiltersPayload = {
  min_date?: string | null;
  max_date?: string | null;
  pitchers?: string[];
  hitters?: string[];
  table_modes?: string[];
};

export type OverviewPayload = {
  table_columns?: string[];
  table_rows?: Array<Record<string, unknown>>;
  total_pitches?: number;
};

export type PitchingAbReportPayload = {
  available_games?: Array<{ game_key?: string; date?: string }>;
  pa_groups?: Array<{
    pas?: Array<{
      pitches?: Array<{
        pitch_type?: string | null;
        velo?: number | null;
      }>;
    }>;
  }>;
};

export type ChatMetricLookup = {
  metricLabel: string;
  metricValue: string;
  sourceRowLabel: string;
  tableColumns: string[];
};

export function normalizeText(value: string): string {
  return String(value ?? '').trim();
}

export function normalizeKey(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeName(value: string): string {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',');
  const first = normalizeText(rest.join(' '));
  return normalizeText(`${first} ${last}`);
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

export function buildAllowedNameKeys(names: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of names) {
    const firstLast = normalizeName(raw);
    const keyFirstLast = normalizeKey(firstLast);
    if (keyFirstLast) out.add(keyFirstLast);
    const parts = firstLast.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const lastFirst = `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
      const keyLastFirst = normalizeKey(normalizeName(lastFirst));
      if (keyLastFirst) out.add(keyLastFirst);
    }
  }
  return out;
}

export function resolveModeCandidates(domain: ChatDomain, filters: FiltersPayload): string[] {
  const backendModes = Array.isArray(filters.table_modes) ? filters.table_modes : [];
  const pitchingFallback = ['Live', 'Process', 'Results', 'Stuff', 'Usage', 'Bullpen', 'Raw Data', 'Batted Ball Data'];
  const hittingFallback = ['Results', 'Process', 'Live', 'Usage', 'Raw Data', 'Batted Ball Data'];
  const merged = domain === 'pitching'
    ? [...backendModes, ...pitchingFallback]
    : [...backendModes, ...hittingFallback];
  return unique(merged);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function resolveSeasonWindow(schoolCode: string, latestAvailableDate: string | null): { startDate: string; endDate: string } {
  const upper = normalizeText(schoolCode).toUpperCase();
  const today = todayIso();
  const latest = latestAvailableDate && isIsoDate(latestAvailableDate) ? latestAvailableDate : today;
  if (upper === 'PRO') return { startDate: '2026-03-25', endDate: latest };
  if (upper === 'CNU') return { startDate: '2026-01-31', endDate: latest };
  if (upper === 'PCU') {
    return { startDate: latest, endDate: latest };
  }
  return { startDate: '2026-02-13', endDate: latest };
}

export function resolveLast14Window(endDate: string): { startDate: string; endDate: string } {
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return { startDate: endDate, endDate };
  const start = new Date(end.getTime() - 13 * 24 * 60 * 60 * 1000);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

export function formatStatValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '-';
    if (Number.isInteger(value)) return String(value);
    if (Math.abs(value) >= 100) return value.toFixed(1);
    return value.toFixed(3).replace(/\.?0+$/, '');
  }
  const raw = normalizeText(String(value));
  return raw || '-';
}

export function parseNumberLike(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = normalizeText(String(value ?? ''));
  if (!raw) return null;
  const cleaned = raw.replace(/[%,$]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLooseAliasMatch(rowKeyNorm: string, aliasKey: string): boolean {
  if (!rowKeyNorm || !aliasKey) return false;
  if (rowKeyNorm === aliasKey) return true;
  // Prevent ambiguous short-token matches (e.g. "k" matching "strike").
  if (aliasKey.length < 4) return false;
  return rowKeyNorm.includes(aliasKey);
}

export function resolveMetricLabelFromColumns(
  question: string,
  columns: string[],
  hints: string[],
  fallback: string
): string {
  const cleanedColumns = columns.map((value) => normalizeText(value)).filter(Boolean);
  if (!cleanedColumns.length) return hints[0] ?? fallback;
  const qNorm = normalizeKey(question);
  const qTokens = Array.from(
    new Set(question.toLowerCase().split(/[^a-z0-9+%]+/).filter(Boolean))
  );
  const hintNorms = hints.map((hint) => normalizeKey(hint)).filter(Boolean);

  let bestLabel = cleanedColumns[0];
  let bestScore = -1;
  for (const column of cleanedColumns) {
    const colNorm = normalizeKey(column);
    if (!colNorm) continue;
    let score = 0;
    if (qNorm.includes(colNorm)) score += 120;
    for (const hintNorm of hintNorms) {
      if (!hintNorm) continue;
      if (colNorm === hintNorm) score += 90;
      else if (colNorm.includes(hintNorm) || hintNorm.includes(colNorm)) score += 60;
    }
    const colTokens = column.toLowerCase().split(/[^a-z0-9+%]+/).filter(Boolean);
    for (const token of colTokens) {
      if (token.length < 2) continue;
      if (qTokens.includes(token)) score += 20;
    }
    const acronym = colTokens.map((token) => token[0]).join('');
    if (acronym.length >= 2 && qTokens.includes(acronym)) score += 35;
    if (score > bestScore) {
      bestScore = score;
      bestLabel = column;
    }
  }
  if (bestScore < 35) return hints[0] ?? fallback;
  return bestLabel;
}

export function findRowLabel(row: Record<string, unknown>, fallback: string): string {
  for (const key of ['Pitch Type', 'pitch_type', 'Hitter', 'hitter', 'Pitcher', 'pitcher', 'Team', 'team_type', 'group']) {
    const value = normalizeText(String(row[key] ?? ''));
    if (value) return value;
  }
  return fallback;
}

export function findCountRow(payload: OverviewPayload, countToken: string): Record<string, unknown> | null {
  const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
  const target = normalizeText(countToken);
  if (!target) return null;
  for (const row of rows) {
    const candidates = [
      row['After Count'],
      row.after_count,
      row.Count,
      row.count,
      row.split_value,
      row.Split,
      row.group,
    ];
    if (candidates.some((value) => normalizeText(String(value ?? '')) === target)) return row;
  }
  return null;
}

export function findPlayerRow(payload: OverviewPayload, domain: ChatDomain, playerName: string): Record<string, unknown> | null {
  const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
  if (!rows.length) return null;
  const target = normalizeKey(normalizeName(playerName));
  if (!target) return null;
  const keys = domain === 'pitching'
    ? ['Pitcher', 'pitcher', 'Name', 'name']
    : ['Hitter', 'hitter', 'Name', 'name'];
  for (const row of rows) {
    for (const key of keys) {
      const value = normalizeText(String(row[key] ?? ''));
      if (!value) continue;
      if (normalizeKey(normalizeName(value)) === target) return row;
    }
  }
  return null;
}

export function findPitchTypeRow(payload: OverviewPayload, pitchType: string): Record<string, unknown> | null {
  const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
  if (!rows.length) return null;
  const target = normalizeKey(pitchType);
  if (!target) return null;
  for (const row of rows) {
    const value = normalizeText(String(row['Pitch Type'] ?? row['pitch_type'] ?? row['Pitch'] ?? ''));
    if (!value) continue;
    if (normalizeKey(value) === target) return row;
  }
  return null;
}

export type BestPitchByMetric = { pitch: string; valueText: string; valueNum: number };

export function resolveBestPitchByMetric(payload: OverviewPayload, metricLabel: string, direction: 'highest' | 'lowest' = 'highest'): BestPitchByMetric | null {
  const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
  if (!rows.length) return null;
  let best: BestPitchByMetric | null = null;
  for (const row of rows) {
    const pitch = normalizeText(String(row.Pitch ?? row['Pitch Type'] ?? row['pitch_type'] ?? ''));
    if (!pitch || pitch.toLowerCase() === 'all') continue;
    const raw = row[metricLabel];
    const num = parseNumberLike(raw);
    if (num === null) continue;
    const text = normalizeText(String(raw ?? '')) || formatStatValue(raw);
    const better = !best || (direction === 'highest' ? num > best.valueNum : num < best.valueNum);
    if (better) {
      best = { pitch, valueText: text, valueNum: num };
    }
  }
  return best;
}

export function usageForPitch(payload: OverviewPayload, pitch: string): string {
  const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
  const pitchNorm = normalizeKey(pitch);
  const row = rows.find((item) => normalizeKey(String(item['Pitch Type'] ?? item['pitch_type'] ?? item['Pitch'] ?? '')) === pitchNorm);
  if (!row) return '-';
  return formatStatValue(row.Usage ?? row['Usage%'] ?? row['Usage %']);
}

export function resolveMetricFromOverview(
  payload: OverviewPayload,
  metricAliasSeed: string[],
): ChatMetricLookup | null {
  const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
  if (!rows.length) return null;
  const columns = Array.isArray(payload.table_columns) ? payload.table_columns.map((value) => normalizeText(String(value))).filter(Boolean) : [];
  const hintAliasKeys = unique(metricAliasSeed.map((entry) => normalizeKey(entry)));

  for (const row of rows) {
    const rowEntries = Object.entries(row).map(([key, value]) => [normalizeText(key), value] as const);
    const byNorm = new Map<string, { key: string; value: unknown }>();
    for (const [key, value] of rowEntries) {
      const norm = normalizeKey(key);
      if (!norm) continue;
      if (!byNorm.has(norm)) byNorm.set(norm, { key, value });
    }
    for (const aliasKey of hintAliasKeys) {
      const match = Array.from(byNorm.entries()).find(([rowKeyNorm]) => isLooseAliasMatch(rowKeyNorm, aliasKey));
      if (!match) continue;
      const [, entry] = match;
      if (entry.value === null || entry.value === undefined || normalizeText(String(entry.value)) === '') continue;
      return {
        metricLabel: entry.key,
        metricValue: formatStatValue(entry.value),
        sourceRowLabel: findRowLabel(row, 'Overall'),
        tableColumns: columns,
      };
    }
  }
  return null;
}

async function fetchJsonWithCache(url: URL, cacheKey: string, timeoutMs = 45000) {
  return fetchDashboardJsonWithCache({
    cacheKey,
    ttlMs: 30000,
    staleTtlMs: 120000,
    timeoutMs,
    retries: 1,
    fetcher: () => fetch(url.toString(), { cache: 'no-store' }),
  });
}

export async function fetchFilters(apiBase: string, schoolCode: string, domain: ChatDomain): Promise<FiltersPayload> {
  const url = new URL(`${apiBase}/v1/${domain}/filters`);
  url.searchParams.set('school_code', schoolCode);
  const result = await fetchJsonWithCache(url, `chat:filters:${domain}:${url.toString()}`, 90000);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(String(result.payload.error ?? result.payload.detail ?? `Failed ${domain} filters.`));
  }
  return result.payload as FiltersPayload;
}

export async function fetchOverview(input: {
  apiBase: string;
  domain: ChatDomain;
  schoolCode: string;
  startDate: string;
  endDate: string;
  playerName: string;
  level?: string | null;
  includePlayerFilter?: boolean;
  countFilter?: string | null;
  afterCountFilter?: string | null;
  batterSide?: string | null;
  splitBy?: string | null;
  tableMode?: string | null;
}): Promise<OverviewPayload> {
  const url = new URL(`${input.apiBase}/v1/${input.domain}/overview`);
  url.searchParams.set('school_code', input.schoolCode);
  url.searchParams.set('start_date', input.startDate);
  url.searchParams.set('end_date', input.endDate);
  const includePlayerFilter = input.includePlayerFilter !== false;
  if (input.domain === 'pitching') {
    if (includePlayerFilter) url.searchParams.set('pitcher', input.playerName);
    if (input.batterSide) url.searchParams.set('batter_side', input.batterSide);
  } else {
    if (includePlayerFilter) url.searchParams.set('hitter', input.playerName);
  }
  if (input.tableMode) url.searchParams.set('table_mode', input.tableMode);
  if (input.splitBy) url.searchParams.set('split_by', input.splitBy);
  if (input.level) url.searchParams.set('level', input.level);
  if (input.countFilter) url.searchParams.set('count_filter', input.countFilter);
  if (input.afterCountFilter) url.searchParams.set('after_count_filter', input.afterCountFilter);
  if (input.domain === 'pitching') {
    url.searchParams.set('include_chart_points', '0');
    url.searchParams.set('include_row_pitches', '0');
    url.searchParams.set('include_trend_rows', '0');
  } else {
    url.searchParams.set('include_chart_points', '0');
  }
  const result = await fetchJsonWithCache(url, `chat:overview:${input.domain}:${url.toString()}`, 120000);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(String(result.payload.error ?? result.payload.detail ?? `Failed ${input.domain} overview.`));
  }
  return result.payload as OverviewPayload;
}

export async function fetchPitchingAbReport(input: {
  apiBase: string;
  schoolCode: string;
  pitcher: string;
  gameKey?: string;
}): Promise<PitchingAbReportPayload> {
  const url = new URL(`${input.apiBase}/v1/pitching/ab-report`);
  url.searchParams.set('school_code', input.schoolCode);
  url.searchParams.set('pitcher', input.pitcher);
  if (input.gameKey) url.searchParams.set('game_key', input.gameKey);
  const result = await fetchJsonWithCache(url, `chat:ab-report:${url.toString()}`, 120000);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(String(result.payload.error ?? result.payload.detail ?? 'Failed pitching AB report.'));
  }
  return result.payload as PitchingAbReportPayload;
}

export function hasRows(payload: OverviewPayload | null | undefined): boolean {
  return Array.isArray(payload?.table_rows) && (payload?.table_rows?.length ?? 0) > 0;
}

export async function fetchPitchingGameDates(input: {
  apiBase: string;
  schoolCode: string;
  pitcher: string;
  startDate: string;
  endDate: string;
}): Promise<string[]> {
  const base = await fetchPitchingAbReport({
    apiBase: input.apiBase,
    schoolCode: input.schoolCode,
    pitcher: input.pitcher,
  });
  const games = Array.isArray(base.available_games) ? base.available_games : [];
  return unique(
    games
      .map((game) => normalizeText(String(game.date ?? '')))
      .filter((date) => date && date >= input.startDate && date <= input.endDate)
  ).sort((a, b) => a.localeCompare(b));
}

export type PitchTypeVeloSummary = { avgVelo: number; maxVelo: number; pitchCount: number };

export async function resolvePitchTypeVeloStatsFromAbReport(input: {
  apiBase: string;
  schoolCode: string;
  pitcher: string;
  pitchType: string;
  startDate: string;
  endDate: string;
}): Promise<PitchTypeVeloSummary | null> {
  const base = await fetchPitchingAbReport({
    apiBase: input.apiBase,
    schoolCode: input.schoolCode,
    pitcher: input.pitcher,
  });
  const games = Array.isArray(base.available_games) ? base.available_games : [];
  const eligible = games.filter((game) => {
    const date = normalizeText(String(game.date ?? ''));
    return date >= input.startDate && date <= input.endDate && normalizeText(String(game.game_key ?? ''));
  });
  if (!eligible.length) return null;

  let veloSum = 0;
  let veloCount = 0;
  let veloMax = Number.NEGATIVE_INFINITY;
  const pitchKey = normalizeKey(input.pitchType);
  const gameKeys = eligible
    .map((game) => normalizeText(String(game.game_key ?? '')))
    .filter(Boolean);
  if (!gameKeys.length) return null;

  const concurrency = 8;
  for (let start = 0; start < gameKeys.length; start += concurrency) {
    const chunk = gameKeys.slice(start, start + concurrency);
    const details = await Promise.all(
      chunk.map((gameKey) =>
        fetchPitchingAbReport({
          apiBase: input.apiBase,
          schoolCode: input.schoolCode,
          pitcher: input.pitcher,
          gameKey,
        })
      )
    );
    for (const detail of details) {
      const groups = Array.isArray(detail.pa_groups) ? detail.pa_groups : [];
      for (const group of groups) {
        const pas = Array.isArray(group.pas) ? group.pas : [];
        for (const pa of pas) {
          const pitches = Array.isArray(pa.pitches) ? pa.pitches : [];
          for (const pitch of pitches) {
            const type = normalizeKey(String(pitch.pitch_type ?? ''));
            if (type !== pitchKey) continue;
            const velo = typeof pitch.velo === 'number' ? pitch.velo : Number(pitch.velo);
            if (!Number.isFinite(velo)) continue;
            veloSum += velo;
            veloCount += 1;
            if (velo > veloMax) veloMax = velo;
          }
        }
      }
    }
  }
  if (veloCount <= 0) return null;
  return { avgVelo: veloSum / veloCount, maxVelo: veloMax, pitchCount: veloCount };
}

export type GameByGameVeloRow = { date: string; avgVelo: number; maxVelo: number; pitchCount: number };

export async function resolveGameByGamePitchVeloFromAbReport(input: {
  apiBase: string;
  schoolCode: string;
  pitcher: string;
  pitchType: string;
  startDate: string;
  endDate: string;
  maxGames?: number;
}): Promise<GameByGameVeloRow[]> {
  const base = await fetchPitchingAbReport({
    apiBase: input.apiBase,
    schoolCode: input.schoolCode,
    pitcher: input.pitcher,
  });
  const games = Array.isArray(base.available_games) ? base.available_games : [];
  let eligible = games
    .map((game) => ({
      gameKey: normalizeText(String(game.game_key ?? '')),
      date: normalizeText(String(game.date ?? '')),
    }))
    .filter((game) => game.gameKey && game.date && game.date >= input.startDate && game.date <= input.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  const maxGames = input.maxGames ?? 20;
  if (eligible.length > maxGames) {
    eligible = eligible.slice(eligible.length - maxGames);
  }
  if (!eligible.length) return [];

  const pitchKey = normalizeKey(input.pitchType);
  const out: GameByGameVeloRow[] = [];
  const concurrency = 8;
  for (let start = 0; start < eligible.length; start += concurrency) {
    const chunk = eligible.slice(start, start + concurrency);
    const details = await Promise.all(
      chunk.map((game) =>
        fetchPitchingAbReport({
          apiBase: input.apiBase,
          schoolCode: input.schoolCode,
          pitcher: input.pitcher,
          gameKey: game.gameKey,
        }).then((payload) => ({ game, payload }))
      )
    );
    for (const item of details) {
      let veloSum = 0;
      let veloCount = 0;
      let veloMax = Number.NEGATIVE_INFINITY;
      const groups = Array.isArray(item.payload.pa_groups) ? item.payload.pa_groups : [];
      for (const group of groups) {
        const pas = Array.isArray(group.pas) ? group.pas : [];
        for (const pa of pas) {
          const pitches = Array.isArray(pa.pitches) ? pa.pitches : [];
          for (const pitch of pitches) {
            if (normalizeKey(String(pitch.pitch_type ?? '')) !== pitchKey) continue;
            const velo = typeof pitch.velo === 'number' ? pitch.velo : Number(pitch.velo);
            if (!Number.isFinite(velo)) continue;
            veloSum += velo;
            veloCount += 1;
            if (velo > veloMax) veloMax = velo;
          }
        }
      }
      if (veloCount > 0) {
        out.push({
          date: item.game.date,
          avgVelo: veloSum / veloCount,
          maxVelo: veloMax,
          pitchCount: veloCount,
        });
      }
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function pickPlayerFromQuestion(question: string, candidates: string[]): string | null {
  const qNorm = normalizeKey(question);
  if (!qNorm) return null;
  let best: { name: string; len: number } | null = null;
  for (const raw of candidates) {
    const full = normalizeName(raw);
    const key = normalizeKey(full);
    if (!key) continue;
    if (qNorm.includes(key)) {
      if (!best || key.length > best.len) best = { name: raw, len: key.length };
      continue;
    }
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
      const firstLastKey = normalizeKey(firstLast);
      if (firstLastKey && qNorm.includes(firstLastKey)) {
        if (!best || firstLastKey.length > best.len) best = { name: raw, len: firstLastKey.length };
      }
    }
  }
  return best?.name ?? null;
}

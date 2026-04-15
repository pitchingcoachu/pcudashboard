import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { fetchDashboardJsonWithCache } from '../../../../lib/dashboard-route-cache';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, shouldScopeDashboardPlayer } from '../../../../lib/dashboard-player-scope';

type FiltersPayload = {
  min_date?: string | null;
  max_date?: string | null;
  pitchers?: string[];
  hitters?: string[];
  table_modes?: string[];
};

type OverviewPayload = {
  table_columns?: string[];
  table_rows?: Array<Record<string, unknown>>;
  total_pitches?: number;
};

type PitchingAbReportPayload = {
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

type ChatBody = {
  question?: string;
};

type ChatDomain = 'pitching' | 'hitting';

type ChatMetricLookup = {
  metricLabel: string;
  metricValue: string;
  sourceRowLabel: string;
  tableColumns: string[];
};

type LeaderboardContext = {
  expiresAt: number;
  domain: ChatDomain;
  metricLabel: string;
  startDate: string;
  endDate: string;
};

type UsageContext = {
  expiresAt: number;
  domain: ChatDomain;
  playerName: string;
};

type PlayerMetricContext = {
  expiresAt: number;
  domain: ChatDomain;
  playerName: string;
  metricLabel: string;
};

const METRIC_ALIASES: Record<string, string[]> = {
  'FPS%': ['fps', 'fps%', 'firstpitchstrike', 'firstpitchstrike%'],
  'BB%': ['bb', 'bb%', 'bbpct', 'walk%', 'walkpct'],
  'K%': ['k', 'k%', 'kpct', 'so%', 'sopct', 'strikeout%', 'strikeoutpct'],
  'PV/100': ['pv100', 'pv/100', 'pitchvalue', 'pitchvalue100'],
  'RV/100': ['rv100', 'rv/100', 'runvalue', 'runvalue100'],
  xWOBA: ['xwoba'],
  'Barrel%': ['barrel', 'barrel%', 'barrelpct'],
  'GoZoneSw%': ['gozonesw', 'gozonesw%', 'gozoneswpct'],
  Velo: ['velo', 'velocity', 'avgvelo'],
  'E+A%': ['e+a', 'e+a%', 'eapct'],
  'Whiff%': ['whiff', 'whiff%', 'whiffpct'],
  'CSW%': ['csw', 'csw%', 'cswpct'],
  'InZone%': ['inzone', 'inzone%', 'inzonepct'],
  IVB: ['ivb', 'inducedverticalbreak'],
  HB: ['hb', 'horizontalbreak'],
  Spin: ['spin', 'rpm'],
  Ext: ['ext', 'extension'],
  'Stuff+': ['stuff+', 'stuffplus'],
  'QP+': ['qp+', 'qpplus'],
  'Ctrl+': ['ctrl+', 'control+'],
  'Pitching+': ['pitching+', 'pitchingplus'],
  Usage: ['usage', 'usage%', 'usagepct'],
};

const LEADERBOARD_CONTEXT_TTL_MS = 10 * 60 * 1000;
const LEADERBOARD_CONTEXT_KEY = '__pcu_dashboard_chat_leaderboard_ctx_v1__';
const USAGE_CONTEXT_TTL_MS = 10 * 60 * 1000;
const USAGE_CONTEXT_KEY = '__pcu_dashboard_chat_usage_ctx_v1__';
const PLAYER_METRIC_CONTEXT_TTL_MS = 15 * 60 * 1000;
const PLAYER_METRIC_CONTEXT_KEY = '__pcu_dashboard_chat_player_metric_ctx_v1__';

function getLeaderboardContextStore(): Map<string, LeaderboardContext> {
  const globalRef = globalThis as typeof globalThis & {
    [LEADERBOARD_CONTEXT_KEY]?: Map<string, LeaderboardContext>;
  };
  if (!globalRef[LEADERBOARD_CONTEXT_KEY]) {
    globalRef[LEADERBOARD_CONTEXT_KEY] = new Map<string, LeaderboardContext>();
  }
  return globalRef[LEADERBOARD_CONTEXT_KEY]!;
}

function getUsageContextStore(): Map<string, UsageContext> {
  const globalRef = globalThis as typeof globalThis & {
    [USAGE_CONTEXT_KEY]?: Map<string, UsageContext>;
  };
  if (!globalRef[USAGE_CONTEXT_KEY]) {
    globalRef[USAGE_CONTEXT_KEY] = new Map<string, UsageContext>();
  }
  return globalRef[USAGE_CONTEXT_KEY]!;
}

function getPlayerMetricContextStore(): Map<string, PlayerMetricContext> {
  const globalRef = globalThis as typeof globalThis & {
    [PLAYER_METRIC_CONTEXT_KEY]?: Map<string, PlayerMetricContext>;
  };
  if (!globalRef[PLAYER_METRIC_CONTEXT_KEY]) {
    globalRef[PLAYER_METRIC_CONTEXT_KEY] = new Map<string, PlayerMetricContext>();
  }
  return globalRef[PLAYER_METRIC_CONTEXT_KEY]!;
}

function isLooseAliasMatch(rowKeyNorm: string, aliasKey: string): boolean {
  if (!rowKeyNorm || !aliasKey) return false;
  if (rowKeyNorm === aliasKey) return true;
  // Prevent ambiguous short-token matches (e.g. "k" matching "strike").
  if (aliasKey.length < 4) return false;
  return rowKeyNorm.includes(aliasKey);
}

function normalizeText(value: string): string {
  return String(value ?? '').trim();
}

function normalizeKey(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeName(value: string): string {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',');
  const first = normalizeText(rest.join(' '));
  return normalizeText(`${first} ${last}`);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

function buildAllowedNameKeys(names: string[]): Set<string> {
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

function resolveModeCandidates(domain: ChatDomain, filters: FiltersPayload): string[] {
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

function resolveSeasonWindow(schoolCode: string, latestAvailableDate: string | null): { startDate: string; endDate: string } {
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

function resolveLast14Window(endDate: string): { startDate: string; endDate: string } {
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return { startDate: endDate, endDate };
  const start = new Date(end.getTime() - 13 * 24 * 60 * 60 * 1000);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

function formatStatValue(value: unknown): string {
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

function withSource(base: string, source: string): string {
  const label = normalizeText(source);
  if (!label) return base;
  return `${base} [Source: ${label}]`;
}

function parseNumberLike(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = normalizeText(String(value ?? ''));
  if (!raw) return null;
  const cleaned = raw.replace(/[%,$]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseThreshold(question: string, key: string): number | null {
  const re = new RegExp(`(?:at least|>=|greater than or equal to|minimum of|min)\\s*(\\d+)\\s*${key}`, 'i');
  const match = question.match(re) ?? question.match(new RegExp(`(\\d+)\\s*${key}`, 'i'));
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBfThreshold(question: string): number | null {
  const patterns = [
    /(?:at least|>=|greater than or equal to|minimum of|min)\s*(\d+)\s*(?:bf|batters?\s*faced?|batters?)/i,
    /(\d+)\s*(?:bf|batters?\s*faced?|batters?)/i,
  ];
  for (const re of patterns) {
    const match = question.match(re);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseSinceDate(question: string): string | null {
  const lower = question.toLowerCase();
  if (!lower.includes('since')) return null;
  const iso = lower.match(/since\s+(20\d{2}-\d{2}-\d{2})/i);
  if (iso) return iso[1];
  const long = question.match(/since\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})/i);
  if (!long) return null;
  const date = new Date(`${long[1]} ${long[2]}, ${long[3]}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function wantsHighLow(question: string): boolean {
  const q = question.toLowerCase();
  return (q.includes('highest') || q.includes('lowest')) && (q.includes('who') || q.includes('what pitcher') || q.includes('what hitter'));
}

function wantsRosterMetricList(question: string): boolean {
  const q = question.toLowerCase();
  const asksList = /\blist\b|\bsend me\b|\bgive me\b/.test(q);
  const asksAll = /\ball\b|\bour\b/.test(q);
  const asksGroup = /\bpitchers?\b|\bhitters?\b/.test(q);
  return asksList && asksAll && asksGroup;
}

function parseDateFromQuestion(question: string): string | null {
  const iso = question.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const long = question.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b/i);
  if (!long) return null;
  const date = new Date(`${long[1]} ${long[2]}, ${long[3]}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function getLeaderboardContext(cacheKey: string): LeaderboardContext | null {
  const store = getLeaderboardContextStore();
  const item = store.get(cacheKey);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    store.delete(cacheKey);
    return null;
  }
  return item;
}

function setLeaderboardContext(cacheKey: string, context: Omit<LeaderboardContext, 'expiresAt'>): void {
  const store = getLeaderboardContextStore();
  store.set(cacheKey, {
    ...context,
    expiresAt: Date.now() + LEADERBOARD_CONTEXT_TTL_MS,
  });
}

function getUsageContext(cacheKey: string): UsageContext | null {
  const store = getUsageContextStore();
  const item = store.get(cacheKey);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    store.delete(cacheKey);
    return null;
  }
  return item;
}

function setUsageContext(cacheKey: string, context: Omit<UsageContext, 'expiresAt'>): void {
  const store = getUsageContextStore();
  store.set(cacheKey, {
    ...context,
    expiresAt: Date.now() + USAGE_CONTEXT_TTL_MS,
  });
}

function getPlayerMetricContext(cacheKey: string): PlayerMetricContext | null {
  const store = getPlayerMetricContextStore();
  const item = store.get(cacheKey);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    store.delete(cacheKey);
    return null;
  }
  return item;
}

function setPlayerMetricContext(cacheKey: string, context: Omit<PlayerMetricContext, 'expiresAt'>): void {
  const store = getPlayerMetricContextStore();
  store.set(cacheKey, {
    ...context,
    expiresAt: Date.now() + PLAYER_METRIC_CONTEXT_TTL_MS,
  });
}

function resolveDomain(question: string): ChatDomain {
  if (/\b(pitcher|pitching|fps%?|e\+a%?|csw%?|whiff%?|k%|bb%|inzone%?)\b/i.test(question)) return 'pitching';
  if (/\b(xwoba|barrel%?|gozonesw%?|hitter|hitting)\b/i.test(question)) return 'hitting';
  return 'pitching';
}

function resolveMetricHints(question: string): string[] {
  const q = question.toLowerCase();
  const hints: string[] = [];
  const hintPairs: Array<[RegExp, string]> = [
    [/fps%?|first pitch strike/i, 'FPS%'],
    [/bb%|walk/i, 'BB%'],
    [/k%|strikeout/i, 'K%'],
    [/pv\/100|pitch value/i, 'PV/100'],
    [/rv\/100|run value/i, 'RV/100'],
    [/xwoba/i, 'xWOBA'],
    [/barrel/i, 'Barrel%'],
    [/gozonesw/i, 'GoZoneSw%'],
    [/velo|velocity/i, 'Velo'],
    [/e\+a/i, 'E+A%'],
    [/whiff/i, 'Whiff%'],
    [/csw/i, 'CSW%'],
    [/inzone/i, 'InZone%'],
    [/\bivb\b|induced vertical break/i, 'IVB'],
    [/\bhb\b|horizontal break/i, 'HB'],
    [/\bspin\b|\brpm\b/i, 'Spin'],
    [/\bext\b|extension/i, 'Ext'],
    [/stuff\+/i, 'Stuff+'],
    [/qp\+/i, 'QP+'],
    [/ctrl\+|control\+/i, 'Ctrl+'],
    [/pitching\+/i, 'Pitching+'],
    [/usage/i, 'Usage'],
  ];
  for (const [re, metric] of hintPairs) {
    if (re.test(q)) hints.push(metric);
  }
  return unique(hints);
}

function resolveMetricLabelFromColumns(
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

function resolvePitchTypeFromQuestion(question: string): string | null {
  const q = question.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/\bfour[\s-]?seam(er)?\b|\bfastball\b|\bfb\b/, 'Fastball'],
    [/\bsinker\b|\btwo[\s-]?seam(er)?\b/, 'Sinker'],
    [/\bcutter\b|\bcut\b/, 'Cutter'],
    [/\bslider\b/, 'Slider'],
    [/\bsweeper\b/, 'Sweeper'],
    [/\bcurve(ball)?\b/, 'Curveball'],
    [/\bchange[\s-]?up\b|\bchangeup\b/, 'ChangeUp'],
    [/\bsplitter\b|\bsplit[-\s]?finger\b/, 'Splitter'],
    [/\bknuckle(ball)?\b/, 'Knuckleball'],
  ];
  for (const [re, pitchType] of map) {
    if (re.test(q)) return pitchType;
  }
  return null;
}

function isVelocityQuestion(question: string): boolean {
  return /\bvelo\b|\bvelocity\b/i.test(question);
}

function wantsGameByGame(question: string): boolean {
  return /\beach game\b|\bevery game\b|\bgame by game\b|\bby game\b|\beach outing\b|\bevery outing\b/i.test(question);
}

function asksMaxVelocity(question: string): boolean {
  return /\bmax\b|\bmaximum\b/i.test(question);
}

function asksAverageVelocity(question: string): boolean {
  return /\bavg\b|\baverage\b|\bmean\b/i.test(question);
}

function extractCountToken(question: string): string | null {
  const match = question.match(/\b([0-3]-[0-2])\b/);
  return match ? match[1] : null;
}

function includesAfterCount(question: string): boolean {
  return /\bafter\b/i.test(question) || /\bahead\b/i.test(question);
}

function resolveBatterSideFromQuestion(question: string): 'Left' | 'Right' | null {
  const q = question.toLowerCase();
  if (/\b(left|lefty|lefties|left-handed|left handed|lhh)\b/.test(q)) return 'Left';
  if (/\b(right|righty|righties|right-handed|right handed|rhh)\b/.test(q)) return 'Right';
  return null;
}

function wantsPitchUsageBreakdown(question: string): boolean {
  const q = question.toLowerCase();
  const asksUsage = q.includes('usage');
  const asksAllPitches = /\ball pitches\b|\beach pitch\b|\bpitch mix\b|\bpitches\b/.test(q);
  return asksUsage && asksAllPitches;
}

function wantsUsageFollowup(question: string): boolean {
  const q = question.toLowerCase();
  return /\bwhat about\b|\bhow about\b|\bagainst\b/.test(q);
}

function wantsLeftRightSplit(question: string): boolean {
  const q = question.toLowerCase();
  return /(left|lefty|lefties|lhh)/.test(q) && /(right|righty|righties|rhh)/.test(q);
}

function pickPlayerFromQuestion(question: string, candidates: string[]): string | null {
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

function pickPlayersFromQuestion(question: string, candidates: string[]): string[] {
  const qNorm = normalizeKey(question);
  if (!qNorm) return [];
  const matches: string[] = [];
  for (const raw of candidates) {
    const full = normalizeName(raw);
    const key = normalizeKey(full);
    if (!key) continue;
    if (qNorm.includes(key)) {
      matches.push(raw);
      continue;
    }
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
      const firstLastKey = normalizeKey(firstLast);
      if (firstLastKey && qNorm.includes(firstLastKey)) matches.push(raw);
    }
  }
  return unique(matches);
}

function wantsTeamScope(question: string): boolean {
  return /\bour team\b|\bteam[’']?s\b|\bfull team\b|\bwhole team\b|\bteam total\b|\bentire team\b/i.test(question);
}

function wantsGroupScope(question: string): boolean {
  return /\bgroup\b|\ball pitchers\b|\ball hitters\b|\ball players\b|\bour pitchers\b|\bour hitters\b|\bour players\b|\bpitching staff\b/i.test(question);
}

function findCountRow(payload: OverviewPayload, countToken: string): Record<string, unknown> | null {
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

function findRowLabel(row: Record<string, unknown>, fallback: string): string {
  for (const key of ['Pitch Type', 'pitch_type', 'Hitter', 'hitter', 'Pitcher', 'pitcher', 'Team', 'team_type', 'group']) {
    const value = normalizeText(String(row[key] ?? ''));
    if (value) return value;
  }
  return fallback;
}

function resolveMetricFromOverview(
  payload: OverviewPayload,
  question: string,
  hints: string[],
): ChatMetricLookup | null {
  const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
  if (!rows.length) return null;
  const columns = Array.isArray(payload.table_columns) ? payload.table_columns.map((value) => normalizeText(String(value))).filter(Boolean) : [];
  const hintAliasKeys = unique(
    hints.flatMap((hint) => {
      const base = normalizeText(hint);
      const aliases = METRIC_ALIASES[base] ?? [base];
      return aliases.map((entry) => normalizeKey(entry));
    })
  );

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

  const qNorm = normalizeKey(question);
  for (const row of rows) {
    const rowEntries = Object.entries(row).map(([key, value]) => [normalizeText(key), value] as const);
    for (const [key, value] of rowEntries) {
      const norm = normalizeKey(key);
      if (!norm) continue;
      if (qNorm.includes(norm)) {
        return {
          metricLabel: key,
          metricValue: formatStatValue(value),
          sourceRowLabel: findRowLabel(row, 'Overall'),
          tableColumns: columns,
        };
      }
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

async function fetchFilters(apiBase: string, schoolCode: string, domain: ChatDomain): Promise<FiltersPayload> {
  const url = new URL(`${apiBase}/v1/${domain}/filters`);
  url.searchParams.set('school_code', schoolCode);
  const result = await fetchJsonWithCache(url, `chat:filters:${domain}:${url.toString()}`, 90000);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(String(result.payload.error ?? result.payload.detail ?? `Failed ${domain} filters.`));
  }
  return result.payload as FiltersPayload;
}

async function fetchOverview(input: {
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

async function fetchPitchingAbReport(input: {
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

function hasRows(payload: OverviewPayload | null | undefined): boolean {
  return Array.isArray(payload?.table_rows) && (payload?.table_rows?.length ?? 0) > 0;
}

function findPlayerRow(payload: OverviewPayload, domain: ChatDomain, playerName: string): Record<string, unknown> | null {
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

function findPitchTypeRow(payload: OverviewPayload, pitchType: string): Record<string, unknown> | null {
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

async function resolvePitchTypeVeloStatsFromAbReport(input: {
  apiBase: string;
  schoolCode: string;
  pitcher: string;
  pitchType: string;
  startDate: string;
  endDate: string;
}): Promise<{ avgVelo: number; maxVelo: number; pitchCount: number } | null> {
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

async function resolveGameByGamePitchVeloFromAbReport(input: {
  apiBase: string;
  schoolCode: string;
  pitcher: string;
  pitchType: string;
  startDate: string;
  endDate: string;
}): Promise<Array<{ date: string; avgVelo: number; maxVelo: number; pitchCount: number }>> {
  const base = await fetchPitchingAbReport({
    apiBase: input.apiBase,
    schoolCode: input.schoolCode,
    pitcher: input.pitcher,
  });
  const games = Array.isArray(base.available_games) ? base.available_games : [];
  const eligible = games
    .map((game) => ({
      gameKey: normalizeText(String(game.game_key ?? '')),
      date: normalizeText(String(game.date ?? '')),
    }))
    .filter((game) => game.gameKey && game.date && game.date >= input.startDate && game.date <= input.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!eligible.length) return [];

  const pitchKey = normalizeKey(input.pitchType);
  const out: Array<{ date: string; avgVelo: number; maxVelo: number; pitchCount: number }> = [];
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

async function fetchPitchingGameDates(input: {
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

function resolveBestPitchPvRow(payload: OverviewPayload): { pitch: string; pv100: number; usage: string } | null {
  const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
  if (!rows.length) return null;
  let best: { pitch: string; pv100: number; usage: string } | null = null;
  for (const row of rows) {
    const pitch = normalizeText(String(row['Pitch Type'] ?? row['pitch_type'] ?? row['Pitch'] ?? ''));
    if (!pitch || pitch.toLowerCase() === 'all') continue;
    const pvRaw = row['PV/100'];
    const pv = typeof pvRaw === 'number' ? pvRaw : Number(pvRaw);
    if (!Number.isFinite(pv)) continue;
    const usage = formatStatValue(row.Usage ?? row['Usage%'] ?? row['Usage %']);
    if (!best || pv > best.pv100) best = { pitch, pv100: pv, usage };
  }
  return best;
}

function usageForPitch(payload: OverviewPayload, pitch: string): string {
  const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
  const pitchNorm = normalizeKey(pitch);
  const row = rows.find((item) => normalizeKey(String(item['Pitch Type'] ?? item['pitch_type'] ?? item['Pitch'] ?? '')) === pitchNorm);
  if (!row) return '-';
  return formatStatValue(row.Usage ?? row['Usage%'] ?? row['Usage %']);
}

function resolveBestPitchByMetric(payload: OverviewPayload, metricLabel: string): { pitch: string; valueText: string; valueNum: number } | null {
  const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
  if (!rows.length) return null;
  let best: { pitch: string; valueText: string; valueNum: number } | null = null;
  for (const row of rows) {
    const pitch = normalizeText(String(row.Pitch ?? row['Pitch Type'] ?? row['pitch_type'] ?? ''));
    if (!pitch || pitch.toLowerCase() === 'all') continue;
    const raw = row[metricLabel];
    const num = parseNumberLike(raw);
    if (num === null) continue;
    const text = normalizeText(String(raw ?? '')) || formatStatValue(raw);
    if (!best || num > best.valueNum) {
      best = { pitch, valueText: text, valueNum: num };
    }
  }
  return best;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as ChatBody;
  const question = normalizeText(body.question ?? '');
  if (!question) return NextResponse.json({ error: 'Question is required.' }, { status: 400 });

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
  const domain = resolveDomain(question);
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
    const filters = shouldScopePlayer
      ? ({ pitchers: [scopedPlayerQueryName(playerIdentity!, 'Pitching')], hitters: [scopedPlayerQueryName(playerIdentity!, 'Hitting')], max_date: null } as FiltersPayload)
      : await fetchFilters(apiBase, schoolCode, domain);
    const candidatePool = domain === 'pitching'
      ? unique(filters.pitchers ?? [])
      : unique(filters.hitters ?? []);
    const allowedPitcherKeys = buildAllowedNameKeys(unique(filters.pitchers ?? []));
    const allowedHitterKeys = buildAllowedNameKeys(unique(filters.hitters ?? []));
    const requestedPitchType = domain === 'pitching' ? resolvePitchTypeFromQuestion(question) : null;
    const velocityQuestion = isVelocityQuestion(question);
    const gameByGameQuestion = wantsGameByGame(question);
    const wantsMaxVelo = asksMaxVelocity(question);
    const wantsAvgVelo = asksAverageVelocity(question) || !wantsMaxVelo;
    const batterSide = domain === 'pitching' ? resolveBatterSideFromQuestion(question) : null;
    const metricHints = resolveMetricHints(question);
    const countTokenEarly = extractCountToken(question);
    const afterCount = includesAfterCount(question);
    const leaderboardContextKey = `${session.userId ?? 0}:${schoolCode}`;

    const runHighLowQuery = async (input: {
      metricLabel: string;
      targetDomain: ChatDomain;
      bfThreshold: number;
      seasonWindow: { startDate: string; endDate: string };
    }): Promise<NextResponse | null> => {
      const splitBy = input.targetDomain === 'pitching' ? 'Pitcher' : 'Hitter';
      const modes = resolveModeCandidates(input.targetDomain, filters);
      for (const mode of modes) {
        try {
          const board = await fetchOverview({
            apiBase,
            domain: input.targetDomain,
            schoolCode,
            startDate: input.seasonWindow.startDate,
            endDate: input.seasonWindow.endDate,
            playerName: '',
            includePlayerFilter: false,
            level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
            splitBy,
            tableMode: mode,
          });
          const rows = Array.isArray(board.table_rows) ? board.table_rows : [];
          if (!rows.length) continue;
          const tableColumns = Array.isArray(board.table_columns)
            ? board.table_columns.map((value) => normalizeText(String(value))).filter(Boolean)
            : Object.keys(rows[0] ?? {});
          const metricLabel = resolveMetricLabelFromColumns(
            question,
            tableColumns,
            [input.metricLabel, ...resolveMetricHints(question)],
            input.metricLabel
          );
          const entries = rows
            .map((row) => {
              const name = normalizeText(String(row[input.targetDomain === 'pitching' ? 'Pitcher' : 'Hitter'] ?? row.name ?? ''));
              const bf = parseNumberLike(row.BF);
              const value = parseNumberLike(row[metricLabel]);
              return { name, bf, value };
            })
            .filter((row) => {
              if (!row.name || row.bf === null || row.value === null || (row.bf ?? 0) < input.bfThreshold) return false;
              const key = normalizeKey(normalizeName(row.name));
              const allowed = input.targetDomain === 'pitching' ? allowedPitcherKeys : allowedHitterKeys;
              if (allowed.size === 0) return true;
              return allowed.has(key);
            });
          if (!entries.length) continue;
          const highest = entries.reduce((best, cur) => (cur.value! > best.value! ? cur : best));
          const lowest = entries.reduce((best, cur) => (cur.value! < best.value! ? cur : best));
          const pctMetric = metricLabel.includes('%');
          const fmt = (n: number) => (pctMetric ? `${n.toFixed(1)}%` : n.toFixed(3));

          setLeaderboardContext(leaderboardContextKey, {
            domain: input.targetDomain,
            metricLabel,
            startDate: input.seasonWindow.startDate,
            endDate: input.seasonWindow.endDate,
          });

          return NextResponse.json({
            answer: withSource(
              `Highest ${metricLabel}: ${highest.name} (${fmt(highest.value!)}; BF ${highest.bf}). Lowest ${metricLabel}: ${lowest.name} (${fmt(lowest.value!)}; BF ${lowest.bf}).`,
              `Table mode: ${mode}`
            ),
            confidence: 'high',
            evidence: [
              `Domain: ${input.targetDomain === 'pitching' ? 'Pitching' : 'Hitting'}`,
              `Window: ${input.seasonWindow.startDate} to ${input.seasonWindow.endDate}`,
              `Metric: ${metricLabel}`,
              `BF threshold: ${input.bfThreshold}`,
            ],
          });
        } catch {
          // continue modes
        }
      }
      return null;
    };

    if (wantsHighLow(question)) {
      const seasonWindow = resolveSeasonWindow(schoolCode, filters.max_date ?? null);
      const metricLabel = metricHints[0] ?? (domain === 'pitching' ? 'FPS%' : 'xWOBA');
      const bfThreshold = parseBfThreshold(question) ?? 20;
      const response = await runHighLowQuery({ metricLabel, targetDomain: domain, bfThreshold, seasonWindow });
      if (response) return response;
      return NextResponse.json({
        answer: `I could not compute highest/lowest ${metricLabel} from available tables for this window.`,
        confidence: 'low',
        evidence: [],
      });
    }

    if (wantsRosterMetricList(question)) {
      const seasonWindow = resolveSeasonWindow(schoolCode, filters.max_date ?? null);
      const startDate = parseDateFromQuestion(question) ?? seasonWindow.startDate;
      const endDate = seasonWindow.endDate;
      const targetDomain: ChatDomain = /\bhitters?\b/i.test(question) ? 'hitting' : 'pitching';
      const splitBy = targetDomain === 'pitching' ? 'Pitcher' : 'Hitter';
      const requestedMetric = metricHints[0] ?? (targetDomain === 'pitching' ? 'E+A%' : 'xWOBA');
      const allowed = targetDomain === 'pitching' ? allowedPitcherKeys : allowedHitterKeys;
      const modes = resolveModeCandidates(targetDomain, filters);

      for (const mode of modes) {
        try {
          const board = await fetchOverview({
            apiBase,
            domain: targetDomain,
            schoolCode,
            startDate,
            endDate,
            playerName: '',
            includePlayerFilter: false,
            level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
            splitBy,
            tableMode: mode,
          });
          const rows = Array.isArray(board.table_rows) ? board.table_rows : [];
          if (!rows.length) continue;
          const tableColumns = Array.isArray(board.table_columns)
            ? board.table_columns.map((value) => normalizeText(String(value))).filter(Boolean)
            : Object.keys(rows[0] ?? {});
          const metricLabel = resolveMetricLabelFromColumns(
            question,
            tableColumns,
            [requestedMetric, ...metricHints],
            requestedMetric
          );
          const list = rows
            .map((row) => {
              const name = normalizeText(String(row[targetDomain === 'pitching' ? 'Pitcher' : 'Hitter'] ?? row.name ?? ''));
              const key = normalizeKey(normalizeName(name));
              const metricRaw = row[metricLabel];
              const metric = normalizeText(String(metricRaw ?? '')) || formatStatValue(metricRaw);
              return { name, key, metric };
            })
            .filter((row) => row.name && row.metric && (allowed.size === 0 || allowed.has(row.key)));
          if (!list.length) continue;
          list.sort((a, b) => {
            const av = parseNumberLike(a.metric);
            const bv = parseNumberLike(b.metric);
            if (av === null && bv === null) return a.name.localeCompare(b.name);
            if (av === null) return 1;
            if (bv === null) return -1;
            return bv - av;
          });
          const answer = list.map((row) => `${normalizeName(row.name)}: ${row.metric}`).join('\n');
          return NextResponse.json({
            answer: withSource(answer, `Table mode: ${mode}`),
            confidence: 'high',
            evidence: [
              `Domain: ${targetDomain === 'pitching' ? 'Pitching' : 'Hitting'}`,
              `Window: ${startDate} to ${endDate}`,
              `Metric: ${metricLabel}`,
              `Players: ${list.length}`,
            ],
          });
        } catch {
          // continue
        }
      }
    }

    const usageContext = getUsageContext(leaderboardContextKey);
    if (domain === 'pitching' && (wantsPitchUsageBreakdown(question) || (batterSide && wantsUsageFollowup(question) && !!usageContext))) {
      const usageTargetName = shouldScopePlayer
        ? scopedPlayerQueryName(playerIdentity!, 'Pitching')
        : (pickPlayerFromQuestion(question, candidatePool) ?? usageContext?.playerName ?? null);
      if (!usageTargetName) {
        return NextResponse.json({
          answer: 'I could not match a pitcher name in that question. Please include first and last name.',
          confidence: 'low',
          evidence: [],
        });
      }
      const seasonWindow = resolveSeasonWindow(schoolCode, filters.max_date ?? null);
      const usageModes = ['Usage', ...resolveModeCandidates('pitching', filters)];
      for (const mode of unique(usageModes)) {
        try {
          const payload = await fetchOverview({
            apiBase,
            domain: 'pitching',
            schoolCode,
            startDate: seasonWindow.startDate,
            endDate: seasonWindow.endDate,
            playerName: usageTargetName,
            includePlayerFilter: true,
            level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
            splitBy: 'Pitch',
            tableMode: mode,
            batterSide,
          });
          const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
          if (!rows.length) continue;
          const usageRows = rows
            .map((row) => {
              const pitch = normalizeText(String(row.Pitch ?? row['Pitch Type'] ?? row.pitch_type ?? ''));
              const usage = normalizeText(String(row.Usage ?? row['Usage%'] ?? row['Usage %'] ?? ''));
              return { pitch, usage };
            })
            .filter((row) => row.pitch && row.pitch.toLowerCase() !== 'all' && row.usage);
          if (!usageRows.length) continue;
          const answer = usageRows.map((row) => `${row.pitch}: ${row.usage}`).join(', ');
          setUsageContext(leaderboardContextKey, {
            domain: 'pitching',
            playerName: usageTargetName,
          });
          return NextResponse.json({
            answer: withSource(`${normalizeName(usageTargetName)} pitch usage${batterSide ? ` vs ${batterSide}` : ''}: ${answer}.`, `Table mode: ${mode}`),
            confidence: 'high',
            evidence: [
              `Domain: Pitching`,
              `Window: ${seasonWindow.startDate} to ${seasonWindow.endDate}`,
              `Split: Pitch`,
              `Batter side: ${batterSide ?? 'All'}`,
            ],
          });
        } catch {
          // continue modes
        }
      }
    }

    const followupBfThreshold = parseBfThreshold(question);
    const leaderboardContext = getLeaderboardContext(leaderboardContextKey);
    if (!wantsHighLow(question) && followupBfThreshold !== null && leaderboardContext) {
      const response = await runHighLowQuery({
        metricLabel: leaderboardContext.metricLabel,
        targetDomain: leaderboardContext.domain,
        bfThreshold: followupBfThreshold,
        seasonWindow: { startDate: leaderboardContext.startDate, endDate: leaderboardContext.endDate },
      });
      if (response) return response;
      return NextResponse.json({
        answer: `I couldn't apply BF >= ${followupBfThreshold} to the prior leaderboard metric (${leaderboardContext.metricLabel}) from available tables.`,
        confidence: 'low',
        evidence: [],
      });
    }

    const cachedPlayerMetric = getPlayerMetricContext(leaderboardContextKey);
    const mentionedPlayers = pickPlayersFromQuestion(question, candidatePool);
    const resolvedPlayer = shouldScopePlayer
      ? (domain === 'pitching' ? scopedPlayerQueryName(playerIdentity!, 'Pitching') : scopedPlayerQueryName(playerIdentity!, 'Hitting'))
      : (pickPlayerFromQuestion(question, candidatePool) ?? cachedPlayerMetric?.playerName ?? null);

    const teamScope = wantsTeamScope(question) || wantsGroupScope(question);
    if (countTokenEarly && !shouldScopePlayer && (teamScope || mentionedPlayers.length > 1)) {
      const seasonWindow = resolveSeasonWindow(schoolCode, filters.max_date ?? null);
      const explicitSinceDate = parseSinceDate(question);
      const baseWindow = {
        startDate: explicitSinceDate ?? seasonWindow.startDate,
        endDate: seasonWindow.endDate,
      };
      const targetDomain: ChatDomain = /\bhitters?\b/i.test(question) ? 'hitting' : 'pitching';
      const splitBy = afterCount ? 'After Count' : 'Count';
      const allowed = targetDomain === 'pitching' ? allowedPitcherKeys : allowedHitterKeys;
      const selectedKeys = mentionedPlayers.length > 1 ? buildAllowedNameKeys(mentionedPlayers) : null;
      const modes = resolveModeCandidates(targetDomain, filters);
      for (const mode of modes) {
        try {
          const payload = await fetchOverview({
            apiBase,
            domain: targetDomain,
            schoolCode,
            startDate: baseWindow.startDate,
            endDate: baseWindow.endDate,
            playerName: '',
            includePlayerFilter: false,
            level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
            splitBy,
            tableMode: mode,
          });
          const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
          if (!rows.length) continue;
          const columns = Array.isArray(payload.table_columns)
            ? payload.table_columns.map((value) => normalizeText(String(value))).filter(Boolean)
            : Object.keys(rows[0] ?? {});
          const defaultMetric = metricHints[0] ?? (targetDomain === 'pitching' ? 'BB%' : 'xWOBA');
          const metricLabel = resolveMetricLabelFromColumns(question, columns, [defaultMetric, ...metricHints], defaultMetric);

          if (!selectedKeys || selectedKeys.size === 0) {
            const countRow = findCountRow(payload, countTokenEarly);
            if (!countRow) continue;
            const value = parseNumberLike(countRow[metricLabel]);
            if (value === null) continue;
            const outValue = metricLabel.includes('%') ? `${value.toFixed(1)}%` : value.toFixed(3);
            const scopeText = targetDomain === 'pitching' ? 'Team pitchers' : 'Team hitters';
            return NextResponse.json({
              answer: withSource(`${scopeText} ${metricLabel}: ${outValue}.`, `Table mode: ${mode}`),
              confidence: 'high',
              evidence: [
                `Domain: ${targetDomain === 'pitching' ? 'Pitching' : 'Hitting'}`,
                `Window: ${baseWindow.startDate} to ${baseWindow.endDate}`,
                `Split: ${splitBy}`,
                `Count: ${countTokenEarly}`,
                `Metric: ${metricLabel}`,
              ],
            });
          }

          let weightedSum = 0;
          let totalWeight = 0;
          const selectedNames = mentionedPlayers.filter((name) => selectedKeys.has(normalizeKey(normalizeName(name))));
          for (const selectedName of selectedNames) {
            const single = await fetchOverview({
              apiBase,
              domain: targetDomain,
              schoolCode,
              startDate: baseWindow.startDate,
              endDate: baseWindow.endDate,
              playerName: selectedName,
              includePlayerFilter: true,
              level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
              splitBy,
              tableMode: mode,
            });
            const singleRow = findCountRow(single, countTokenEarly);
            if (!singleRow) continue;
            const value = parseNumberLike(singleRow[metricLabel]);
            if (value === null) continue;
            const weight = parseNumberLike(singleRow.BF ?? singleRow.PA ?? singleRow.P ?? singleRow['#']) ?? 1;
            if (!Number.isFinite(weight) || weight <= 0) continue;
            weightedSum += value * weight;
            totalWeight += weight;
          }
          if (totalWeight <= 0) continue;
          const aggregated = weightedSum / totalWeight;
          const outValue = metricLabel.includes('%') ? `${aggregated.toFixed(1)}%` : aggregated.toFixed(3);
          const scopeText = selectedNames.map((name) => normalizeName(name)).join(', ');
          return NextResponse.json({
            answer: withSource(`${scopeText} ${metricLabel}: ${outValue}.`, `Table mode: ${mode}`),
            confidence: 'high',
            evidence: [
              `Domain: ${targetDomain === 'pitching' ? 'Pitching' : 'Hitting'}`,
              `Window: ${baseWindow.startDate} to ${baseWindow.endDate}`,
              `Split: ${splitBy}`,
              `Count: ${countTokenEarly}`,
              `Metric: ${metricLabel}`,
            ],
          });
        } catch {
          // continue
        }
      }
    }
    if (!resolvedPlayer) {
      return NextResponse.json({
        answer: 'I could not match a player name in that question. Please include first and last name.',
        confidence: 'low',
        evidence: [],
      });
    }

    const seasonWindow = resolveSeasonWindow(schoolCode, filters.max_date ?? null);
    const explicitSinceDate = parseSinceDate(question);
    const baseWindow = {
      startDate: explicitSinceDate ?? seasonWindow.startDate,
      endDate: seasonWindow.endDate,
    };
    const wantsLast2Weeks = /\blast\s*2\s*weeks\b/i.test(question) || /\b2\s*weeks\b/i.test(question);
    const last14Window = resolveLast14Window(baseWindow.endDate);
    const countToken = extractCountToken(question);
    if (countToken) {
      const countSplitBy = includesAfterCount(question) ? 'After Count' : 'Count';
      const countModes = resolveModeCandidates(domain, filters);
      for (const mode of countModes) {
        try {
          const payload = await fetchOverview({
            apiBase,
            domain,
            schoolCode,
            startDate: baseWindow.startDate,
            endDate: baseWindow.endDate,
            playerName: resolvedPlayer,
            level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
            splitBy: countSplitBy,
            tableMode: mode,
          });
          const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
          if (!rows.length) continue;
          const row = findCountRow(payload, countToken);
          if (!row) continue;
          const columns = Array.isArray(payload.table_columns)
            ? payload.table_columns.map((value) => normalizeText(String(value))).filter(Boolean)
            : Object.keys(row);
          const defaultMetric = metricHints[0] ?? (domain === 'pitching' ? 'BB%' : 'xWOBA');
          const metricLabel = resolveMetricLabelFromColumns(question, columns, [defaultMetric, ...metricHints], defaultMetric);
          const metricValue = parseNumberLike(row[metricLabel]);
          if (metricValue === null) continue;
          const outValue = metricLabel.includes('%') ? `${metricValue.toFixed(1)}%` : metricValue.toFixed(3);
          setPlayerMetricContext(leaderboardContextKey, {
            domain,
            playerName: resolvedPlayer,
            metricLabel,
          });
          return NextResponse.json({
            answer: withSource(`${normalizeName(resolvedPlayer)} ${metricLabel}: ${outValue}.`, `Table mode: ${mode}`),
            confidence: 'high',
            evidence: [
              `Domain: ${domain === 'pitching' ? 'Pitching' : 'Hitting'}`,
              `Window: ${baseWindow.startDate} to ${baseWindow.endDate}`,
              `Split: ${countSplitBy}`,
              `Count: ${countToken}`,
              requestedPitchType ? `Pitch type: ${requestedPitchType}` : 'Pitch type: all',
            ],
            table_columns: columns,
          });
        } catch {
          // continue
        }
      }
    }
    const asksHighestPitchByMetric = domain === 'pitching' && /\bhighest\b.*\bpitch\b|\bbest\b.*\bpitch\b/i.test(question);

    if (domain === 'pitching' && wantsLeftRightSplit(question) && !asksHighestPitchByMetric) {
      const modes = resolveModeCandidates('pitching', filters);
      for (const mode of modes) {
        try {
          const [leftPayload, rightPayload] = await Promise.all([
            fetchOverview({
              apiBase,
              domain: 'pitching',
              schoolCode,
              startDate: baseWindow.startDate,
              endDate: baseWindow.endDate,
              playerName: resolvedPlayer,
              level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
              splitBy: requestedPitchType ? 'Pitch' : 'Pitcher',
              tableMode: mode,
              batterSide: 'Left',
            }),
            fetchOverview({
              apiBase,
              domain: 'pitching',
              schoolCode,
              startDate: baseWindow.startDate,
              endDate: baseWindow.endDate,
              playerName: resolvedPlayer,
              level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
              splitBy: requestedPitchType ? 'Pitch' : 'Pitcher',
              tableMode: mode,
              batterSide: 'Right',
            }),
          ]);
          const leftScoped = requestedPitchType
            ? (() => {
                const row = findPitchTypeRow(leftPayload, requestedPitchType);
                return row ? ({ table_columns: leftPayload.table_columns, table_rows: [row] } as OverviewPayload) : null;
              })()
            : leftPayload;
          const rightScoped = requestedPitchType
            ? (() => {
                const row = findPitchTypeRow(rightPayload, requestedPitchType);
                return row ? ({ table_columns: rightPayload.table_columns, table_rows: [row] } as OverviewPayload) : null;
              })()
            : rightPayload;
          const mergedCols = unique([
            ...(Array.isArray((leftScoped ?? leftPayload).table_columns) ? (leftScoped ?? leftPayload).table_columns!.map((v) => normalizeText(String(v))) : []),
            ...(Array.isArray((rightScoped ?? rightPayload).table_columns) ? (rightScoped ?? rightPayload).table_columns!.map((v) => normalizeText(String(v))) : []),
          ]).filter(Boolean);
          const defaultMetric = cachedPlayerMetric?.metricLabel ?? (metricHints[0] ?? 'K%');
          const metricLabel = resolveMetricLabelFromColumns(
            question,
            mergedCols,
            [defaultMetric, ...metricHints],
            defaultMetric
          );
          const leftMetric = resolveMetricFromOverview(leftScoped ?? { table_rows: [], table_columns: [] }, question, [metricLabel, ...metricHints]);
          const rightMetric = resolveMetricFromOverview(rightScoped ?? { table_rows: [], table_columns: [] }, question, [metricLabel, ...metricHints]);
          if (!leftMetric && !rightMetric) continue;
          setPlayerMetricContext(leaderboardContextKey, {
            domain: 'pitching',
            playerName: resolvedPlayer,
            metricLabel,
          });
          return NextResponse.json({
            answer: withSource(
              `${normalizeName(resolvedPlayer)} ${metricLabel} vs Left: ${leftMetric?.metricValue ?? 'N/A'}, vs Right: ${rightMetric?.metricValue ?? 'N/A'}.`,
              `Table mode: ${mode}`
            ),
            confidence: 'high',
            evidence: [
              'Domain: Pitching',
              `Window: ${baseWindow.startDate} to ${baseWindow.endDate}`,
              `Metric: ${metricLabel}`,
              requestedPitchType ? `Pitch type: ${requestedPitchType}` : 'Pitch type: all',
            ],
          });
        } catch {
          // continue modes
        }
      }
    }

    if (domain === 'pitching' && velocityQuestion && requestedPitchType && gameByGameQuestion) {
      try {
        const rows = await resolveGameByGamePitchVeloFromAbReport({
          apiBase,
          schoolCode,
          pitcher: resolvedPlayer,
          pitchType: requestedPitchType,
          startDate: seasonWindow.startDate,
          endDate: seasonWindow.endDate,
        });
        if (rows.length > 0) {
          const lines = rows.map((row) => {
            const parts: string[] = [];
            if (wantsAvgVelo) parts.push(`avg ${row.avgVelo.toFixed(1)} mph`);
            if (wantsMaxVelo) parts.push(`max ${row.maxVelo.toFixed(1)} mph`);
            if (!parts.length) parts.push(`avg ${row.avgVelo.toFixed(1)} mph`);
            parts.push(`${row.pitchCount} pitches`);
            return `${row.date}: ${parts.join(', ')}`;
          });
          return NextResponse.json({
            answer: withSource(`${normalizeName(resolvedPlayer)} ${requestedPitchType} velocity by game:\n${lines.join('\n')}`, 'AB-report pitch events by game'),
            confidence: 'high',
            evidence: [
              `Domain: Pitching`,
              `Window: ${seasonWindow.startDate} to ${seasonWindow.endDate}`,
              `Pitch type: ${requestedPitchType}`,
            ],
          });
        }
      } catch {
        // continue into standard query paths
      }
    }

    if (domain === 'pitching' && gameByGameQuestion) {
      try {
        const metricLabel = metricHints[0] ?? 'Velo';
        const gameDates = await fetchPitchingGameDates({
          apiBase,
          schoolCode,
          pitcher: resolvedPlayer,
          startDate: baseWindow.startDate,
          endDate: baseWindow.endDate,
        });
        if (gameDates.length > 0) {
          const splitBy = requestedPitchType ? 'Pitch' : 'Pitcher';
          const modes = resolveModeCandidates('pitching', filters);
          let selectedMode: string | null = null;
          let selectedMetricLabel: string = metricLabel;
          for (const mode of modes) {
            const probe = await fetchOverview({
              apiBase,
              domain: 'pitching',
              schoolCode,
              startDate: gameDates[0],
              endDate: gameDates[0],
              playerName: resolvedPlayer,
              level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
              splitBy,
              tableMode: mode,
            });
            const scoped = requestedPitchType
              ? (() => {
                  const row = findPitchTypeRow(probe, requestedPitchType);
                  return row ? ({ table_columns: probe.table_columns, table_rows: [row] } as OverviewPayload) : null;
                })()
              : probe;
            const probeColumns = Array.isArray((scoped ?? probe).table_columns)
              ? (scoped ?? probe).table_columns!.map((value) => normalizeText(String(value))).filter(Boolean)
              : Object.keys(((scoped ?? probe).table_rows?.[0] as Record<string, unknown> | undefined) ?? {});
            const resolvedMetricLabel = resolveMetricLabelFromColumns(
              question,
              probeColumns,
              [metricLabel, ...metricHints],
              metricLabel
            );
            const metricProbe = resolveMetricFromOverview(
              scoped ?? { table_rows: [], table_columns: [] },
              question,
              [resolvedMetricLabel, ...metricHints]
            );
            if (metricProbe) {
              selectedMode = mode;
              selectedMetricLabel = metricProbe.metricLabel || resolvedMetricLabel;
              break;
            }
          }
          if (selectedMode) {
            const concurrency = 8;
            const lines: string[] = [];
            for (let start = 0; start < gameDates.length; start += concurrency) {
              const chunk = gameDates.slice(start, start + concurrency);
              const results = await Promise.all(
                chunk.map(async (date) => {
                  const payload = await fetchOverview({
                    apiBase,
                    domain: 'pitching',
                    schoolCode,
                    startDate: date,
                    endDate: date,
                    playerName: resolvedPlayer,
                    level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
                    splitBy,
                    tableMode: selectedMode!,
                  });
                  const scoped = requestedPitchType
                    ? (() => {
                        const row = findPitchTypeRow(payload, requestedPitchType);
                        return row ? ({ table_columns: payload.table_columns, table_rows: [row] } as OverviewPayload) : null;
                      })()
                    : payload;
                  const scopedColumns = Array.isArray((scoped ?? payload).table_columns)
                    ? (scoped ?? payload).table_columns!.map((value) => normalizeText(String(value))).filter(Boolean)
                    : Object.keys(((scoped ?? payload).table_rows?.[0] as Record<string, unknown> | undefined) ?? {});
                  const resolvedMetricLabel = resolveMetricLabelFromColumns(
                    question,
                    scopedColumns,
                    [selectedMetricLabel, ...metricHints],
                    selectedMetricLabel
                  );
                  const metric = resolveMetricFromOverview(
                    scoped ?? { table_rows: [], table_columns: [] },
                    question,
                    [resolvedMetricLabel, ...metricHints]
                  );
                  if (!metric) return null;
                  return `${date}: ${metric.metricValue}`;
                })
              );
              for (const row of results) {
                if (row) lines.push(row);
              }
            }
            if (lines.length > 0) {
              return NextResponse.json({
                answer: withSource(
                  `${normalizeName(resolvedPlayer)} ${requestedPitchType ? `${requestedPitchType} ` : ''}${selectedMetricLabel} by game:\n${lines.join('\n')}`,
                  `Table mode: ${selectedMode}`
                ),
                confidence: 'high',
                evidence: [
                  `Domain: Pitching`,
                  `Window: ${baseWindow.startDate} to ${baseWindow.endDate}`,
                  requestedPitchType ? `Pitch type: ${requestedPitchType}` : 'Pitch type: all',
                ],
              });
            }
          }
        }
      } catch {
        // continue into standard path
      }
    }

    const wantsBestPitch = domain === 'pitching' && /\bbest\b.*\bpv\/?100\b/i.test(question);
    const wantsVsHands = domain === 'pitching' && /(left|right|lefties|righties|lhh|rhh)/i.test(question);
    const nonPvMetricHint = metricHints.find((hint) => normalizeKey(hint) !== normalizeKey('PV/100'));

    if (domain === 'pitching' && wantsVsHands && asksHighestPitchByMetric && nonPvMetricHint) {
      const modes = resolveModeCandidates('pitching', filters);
      for (const mode of modes) {
        try {
          const [leftPayload, rightPayload] = await Promise.all([
            fetchOverview({
              apiBase,
              domain: 'pitching',
              schoolCode,
              startDate: seasonWindow.startDate,
              endDate: seasonWindow.endDate,
              playerName: resolvedPlayer,
              level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
              splitBy: 'Pitch',
              tableMode: mode,
              batterSide: 'Left',
            }),
            fetchOverview({
              apiBase,
              domain: 'pitching',
              schoolCode,
              startDate: seasonWindow.startDate,
              endDate: seasonWindow.endDate,
              playerName: resolvedPlayer,
              level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
              splitBy: 'Pitch',
              tableMode: mode,
              batterSide: 'Right',
            }),
          ]);
          const leftCols = Array.isArray(leftPayload.table_columns)
            ? leftPayload.table_columns.map((v) => normalizeText(String(v))).filter(Boolean)
            : [];
          const rightCols = Array.isArray(rightPayload.table_columns)
            ? rightPayload.table_columns.map((v) => normalizeText(String(v))).filter(Boolean)
            : [];
          const mergedCols = unique([...leftCols, ...rightCols]);
          const metricLabel = resolveMetricLabelFromColumns(
            question,
            mergedCols,
            [nonPvMetricHint, ...metricHints],
            nonPvMetricHint
          );
          const leftBest = resolveBestPitchByMetric(leftPayload, metricLabel);
          const rightBest = resolveBestPitchByMetric(rightPayload, metricLabel);
          if (!leftBest && !rightBest) continue;
          return NextResponse.json({
            answer: withSource(
              `${normalizeName(resolvedPlayer)} highest ${metricLabel} pitch vs Left: ${leftBest ? `${leftBest.pitch} (${leftBest.valueText})` : 'N/A'}. vs Right: ${rightBest ? `${rightBest.pitch} (${rightBest.valueText})` : 'N/A'}.`,
              `Table mode: ${mode}`
            ),
            confidence: 'high',
            evidence: [
              'Domain: Pitching',
              `Window: ${seasonWindow.startDate} to ${seasonWindow.endDate}`,
              `Metric: ${metricLabel}`,
              'Split: Pitch',
            ],
          });
        } catch {
          // continue
        }
      }
    }

    const wantsPvBestVsHands = domain === 'pitching' && wantsVsHands && /pv\/?100|pitch value/i.test(question);
    if (wantsBestPitch || wantsPvBestVsHands) {
      const splitPayload = await fetchOverview({
        apiBase,
        domain: 'pitching',
        schoolCode,
        startDate: seasonWindow.startDate,
        endDate: seasonWindow.endDate,
        playerName: resolvedPlayer,
        level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
        splitBy: 'Pitch',
        tableMode: 'Results',
      });
      const best = resolveBestPitchPvRow(splitPayload);
      if (!best) {
        return NextResponse.json({
          answer: `I found ${normalizeName(resolvedPlayer)} but could not compute best PV/100 pitch from current table rows.`,
          confidence: 'low',
          evidence: [],
        });
      }
      let leftUsage = '-';
      let rightUsage = '-';
      if (wantsVsHands) {
        const [leftPayload, rightPayload] = await Promise.all([
          fetchOverview({
            apiBase,
            domain: 'pitching',
            schoolCode,
            startDate: seasonWindow.startDate,
            endDate: seasonWindow.endDate,
            playerName: resolvedPlayer,
            level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
            splitBy: 'Pitch',
            tableMode: 'Results',
            batterSide: 'Left',
          }),
          fetchOverview({
            apiBase,
            domain: 'pitching',
            schoolCode,
            startDate: seasonWindow.startDate,
            endDate: seasonWindow.endDate,
            playerName: resolvedPlayer,
            level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
            splitBy: 'Pitch',
            tableMode: 'Results',
            batterSide: 'Right',
          }),
        ]);
        leftUsage = usageForPitch(leftPayload, best.pitch);
        rightUsage = usageForPitch(rightPayload, best.pitch);
      }
      return NextResponse.json({
        answer: withSource(
          `${normalizeName(resolvedPlayer)} best PV/100 pitch this season is ${best.pitch} (${best.pv100.toFixed(2)}). Usage overall: ${best.usage}, vs Left: ${leftUsage}, vs Right: ${rightUsage}.`,
          'Table mode: Results'
        ),
        confidence: 'medium',
        evidence: [
          `Domain: Pitching`,
          `Window: ${seasonWindow.startDate} to ${seasonWindow.endDate}`,
          `Split: Pitch`,
        ],
      });
    }

    const targetWindow = wantsLast2Weeks ? last14Window : baseWindow;
    const splitByDefault = domain === 'pitching'
      ? (requestedPitchType ? 'Pitch' : 'Pitcher')
      : 'Hitter';
    const modes = resolveModeCandidates(domain, filters);
    const overviewCandidates: Array<{ mode: string; payload: OverviewPayload }> = [];
    for (const mode of modes) {
      try {
        const candidate = await fetchOverview({
          apiBase,
          domain,
          schoolCode,
          startDate: targetWindow.startDate,
          endDate: targetWindow.endDate,
          playerName: resolvedPlayer,
          level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
          splitBy: splitByDefault,
          tableMode: mode,
          countFilter: countToken && !includesAfterCount(question) ? countToken : null,
          afterCountFilter: countToken && includesAfterCount(question) ? countToken : null,
        });
        overviewCandidates.push({ mode, payload: candidate });
        const scopedCandidate = requestedPitchType
          ? (() => {
              const pitchRow = findPitchTypeRow(candidate, requestedPitchType);
              if (!pitchRow) return null;
              return { table_columns: candidate.table_columns, table_rows: [pitchRow] } as OverviewPayload;
            })()
          : candidate;
        if (requestedPitchType && velocityQuestion && scopedCandidate) {
          const row = (Array.isArray(scopedCandidate.table_rows) ? scopedCandidate.table_rows[0] : null) as Record<string, unknown> | null;
          const avgRaw = row ? row.Velo : null;
          const maxRaw = row ? row.Max : null;
          const avg = typeof avgRaw === 'number' ? avgRaw : Number(avgRaw);
          const max = typeof maxRaw === 'number' ? maxRaw : Number(maxRaw);
          const avgText = Number.isFinite(avg) ? `${avg.toFixed(1)} mph` : '-';
          const maxText = Number.isFinite(max) ? `${max.toFixed(1)} mph` : '-';
          const pieces: string[] = [];
          if (wantsAvgVelo) pieces.push(`average ${requestedPitchType} Velo: ${avgText}`);
          if (wantsMaxVelo) pieces.push(`max ${requestedPitchType} Velo: ${maxText}`);
          if (!pieces.length) pieces.push(`${requestedPitchType} Velo: ${avgText}`);
          return NextResponse.json({
            answer: withSource(`${normalizeName(resolvedPlayer)} ${pieces.join(', ')}.`, `Table mode: ${mode}`),
            confidence: 'high',
            evidence: [
              `Domain: Pitching`,
              `Window: ${targetWindow.startDate} to ${targetWindow.endDate}`,
              `Pitch type: ${requestedPitchType}`,
              `Table mode: ${mode}`,
            ],
          });
        }
        if (requestedPitchType && !scopedCandidate) continue;
        const scopedColumns = Array.isArray((scopedCandidate ?? candidate).table_columns)
          ? (scopedCandidate ?? candidate).table_columns!.map((value) => normalizeText(String(value))).filter(Boolean)
          : Object.keys((((scopedCandidate ?? candidate).table_rows?.[0]) as Record<string, unknown> | undefined) ?? {});
        const resolvedMetricLabel = resolveMetricLabelFromColumns(
          question,
          scopedColumns,
          metricHints,
          domain === 'pitching' ? 'Velo' : 'xWOBA'
        );
        const resolved = resolveMetricFromOverview(
          scopedCandidate ?? candidate,
          question,
          [resolvedMetricLabel, ...metricHints]
        );
        if (resolved) {
          setPlayerMetricContext(leaderboardContextKey, {
            domain,
            playerName: resolvedPlayer,
            metricLabel: resolved.metricLabel,
          });
          return NextResponse.json({
            answer: withSource(`${normalizeName(resolvedPlayer)} ${resolved.metricLabel}: ${resolved.metricValue}.`, `Table mode: ${mode}`),
            confidence: 'high',
            evidence: [
              `Domain: ${domain === 'pitching' ? 'Pitching' : 'Hitting'}`,
              `Window: ${targetWindow.startDate} to ${targetWindow.endDate}`,
              countToken ? `${includesAfterCount(question) ? 'After-count' : 'Count'} filter: ${countToken}` : 'Count filter: none',
              `Row: ${resolved.sourceRowLabel}`,
              requestedPitchType ? `Pitch type: ${requestedPitchType}` : 'Pitch type: all',
              `Table mode: ${mode}`,
            ],
            table_columns: resolved.tableColumns,
          });
        }
      } catch {
        // Continue to next mode; a single mode failure should not fail chat.
      }
    }

    const hasAnyData = overviewCandidates.some((item) => hasRows(item.payload));
    if (!hasAnyData && requestedPitchType && velocityQuestion && domain === 'pitching') {
      try {
        const derived = await resolvePitchTypeVeloStatsFromAbReport({
          apiBase,
          schoolCode,
          pitcher: resolvedPlayer,
          pitchType: requestedPitchType,
          startDate: targetWindow.startDate,
          endDate: targetWindow.endDate,
        });
        if (derived) {
          const pieces: string[] = [];
          if (wantsAvgVelo) pieces.push(`average ${requestedPitchType} Velo: ${derived.avgVelo.toFixed(1)} mph`);
          if (wantsMaxVelo) pieces.push(`max ${requestedPitchType} Velo: ${derived.maxVelo.toFixed(1)} mph`);
          if (!pieces.length) pieces.push(`${requestedPitchType} Velo: ${derived.avgVelo.toFixed(1)} mph`);
          return NextResponse.json({
            answer: withSource(`${normalizeName(resolvedPlayer)} ${pieces.join(', ')}.`, 'AB-report pitch events'),
            confidence: 'medium',
            evidence: [
              `Domain: Pitching`,
              `Window: ${targetWindow.startDate} to ${targetWindow.endDate}`,
              `Pitch type: ${requestedPitchType}`,
              `Source: AB-report pitch events fallback (${derived.pitchCount} pitches).`,
            ],
          });
        }
      } catch {
        // continue to normal no-data handling below
      }
    }

    if (!hasAnyData) {
      // Fallback: upstream PRO endpoint can return empty rows when player filter is applied
      // even though the player exists in unfiltered split-by rows.
      if (requestedPitchType) {
        return NextResponse.json({
          answer: `I found ${normalizeName(resolvedPlayer)}, but pitch-type table rows are unavailable from the current endpoint for ${requestedPitchType} in this window (${targetWindow.startDate} to ${targetWindow.endDate}).`,
          confidence: 'low',
          evidence: [
            `Domain: ${domain === 'pitching' ? 'Pitching' : 'Hitting'}`,
            `Pitch type: ${requestedPitchType}`,
          ],
        });
      }
      for (const mode of modes) {
        try {
          const fallbackPayload = await fetchOverview({
            apiBase,
            domain,
            schoolCode,
            startDate: targetWindow.startDate,
            endDate: targetWindow.endDate,
            playerName: resolvedPlayer,
            level: normalizeText(schoolCode).toUpperCase() === 'PRO' ? 'All' : null,
            includePlayerFilter: false,
            splitBy: requestedPitchType ? 'Pitcher' : splitByDefault,
            tableMode: mode,
            countFilter: countToken && !includesAfterCount(question) ? countToken : null,
            afterCountFilter: countToken && includesAfterCount(question) ? countToken : null,
          });
          if (!hasRows(fallbackPayload)) continue;
          const matchedRow = findPlayerRow(fallbackPayload, domain, resolvedPlayer);
          if (!matchedRow) continue;
          const fallbackColumns = Array.isArray(fallbackPayload.table_columns)
            ? fallbackPayload.table_columns.map((value) => normalizeText(String(value))).filter(Boolean)
            : Object.keys(matchedRow);
          const resolvedMetricLabel = resolveMetricLabelFromColumns(
            question,
            fallbackColumns,
            metricHints,
            domain === 'pitching' ? 'Velo' : 'xWOBA'
          );
          const resolved = resolveMetricFromOverview(
            { table_columns: fallbackPayload.table_columns, table_rows: [matchedRow] },
            question,
            [resolvedMetricLabel, ...metricHints]
          );
          if (resolved) {
            setPlayerMetricContext(leaderboardContextKey, {
              domain,
              playerName: resolvedPlayer,
              metricLabel: resolved.metricLabel,
            });
            return NextResponse.json({
              answer: withSource(`${normalizeName(resolvedPlayer)} ${resolved.metricLabel}: ${resolved.metricValue}.`, `Table mode: ${mode}`),
              confidence: 'high',
              evidence: [
                `Domain: ${domain === 'pitching' ? 'Pitching' : 'Hitting'}`,
                `Window: ${targetWindow.startDate} to ${targetWindow.endDate}`,
                countToken ? `${includesAfterCount(question) ? 'After-count' : 'Count'} filter: ${countToken}` : 'Count filter: none',
                `Row: ${resolved.sourceRowLabel}`,
                requestedPitchType ? `Pitch type: ${requestedPitchType} (fallback to overall player row)` : 'Pitch type: all',
                `Table mode: ${mode}`,
                'Used unfiltered fallback row-match due backend player-filter mismatch.',
              ],
              table_columns: resolved.tableColumns,
            });
          }
        } catch {
          // continue
        }
      }
    }

    if (!hasAnyData) {
      return NextResponse.json({
        answer: `I found ${normalizeName(resolvedPlayer)}, but there are no tracked pitches in this window (${targetWindow.startDate} to ${targetWindow.endDate}). This player appears in roster/filter options but has no usable rows for this query yet.`,
        confidence: 'low',
        evidence: [
          `Domain: ${domain === 'pitching' ? 'Pitching' : 'Hitting'}`,
        ],
      });
    }

    const firstCandidate = overviewCandidates[0]?.payload ?? {};
    const firstMode = overviewCandidates[0]?.mode ?? 'Unknown';
    const firstScopedCandidate = requestedPitchType
      ? (() => {
          const pitchRow = findPitchTypeRow(firstCandidate as OverviewPayload, requestedPitchType);
          if (!pitchRow) return null;
          return { table_columns: (firstCandidate as OverviewPayload).table_columns, table_rows: [pitchRow] } as OverviewPayload;
        })()
      : (firstCandidate as OverviewPayload);
    const firstColumns = Array.isArray((firstScopedCandidate ?? (firstCandidate as OverviewPayload)).table_columns)
      ? (firstScopedCandidate ?? (firstCandidate as OverviewPayload)).table_columns!.map((value) => normalizeText(String(value))).filter(Boolean)
      : Object.keys((((firstScopedCandidate ?? (firstCandidate as OverviewPayload)).table_rows?.[0]) as Record<string, unknown> | undefined) ?? {});
    const firstResolvedMetricLabel = resolveMetricLabelFromColumns(
      question,
      firstColumns,
      metricHints,
      domain === 'pitching' ? 'Velo' : 'xWOBA'
    );
    const metric = resolveMetricFromOverview(
      requestedPitchType ? (firstScopedCandidate ?? { table_rows: [], table_columns: [] }) : (firstScopedCandidate ?? (firstCandidate as OverviewPayload)),
      question,
      [firstResolvedMetricLabel, ...metricHints]
    );
    if (!metric) {
      return NextResponse.json({
        answer: `I found ${normalizeName(resolvedPlayer)} but could not identify the exact stat in your question.`,
        confidence: 'low',
        evidence: [
          `Try asking with metric names shown in the table (example: BB%, K%, PV/100, xWOBA, Barrel%, GoZoneSw%).`,
        ],
      });
    }

    setPlayerMetricContext(leaderboardContextKey, {
      domain,
      playerName: resolvedPlayer,
      metricLabel: metric.metricLabel,
    });
    return NextResponse.json({
      answer: withSource(`${normalizeName(resolvedPlayer)} ${metric.metricLabel}: ${metric.metricValue}.`, `Table mode: ${firstMode}`),
      confidence: 'medium',
      evidence: [
        `Domain: ${domain === 'pitching' ? 'Pitching' : 'Hitting'}`,
        `Window: ${targetWindow.startDate} to ${targetWindow.endDate}`,
        countToken ? `${includesAfterCount(question) ? 'After-count' : 'Count'} filter: ${countToken}` : 'Count filter: none',
        `Row: ${metric.sourceRowLabel}`,
        requestedPitchType ? `Pitch type: ${requestedPitchType}` : 'Pitch type: all',
      ],
      table_columns: metric.tableColumns,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to answer chat question.',
      },
      { status: 502 }
    );
  }
}

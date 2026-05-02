import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../../lib/programming-scope';
import { ensureAuthDbReady, getDbPool } from '../../../../../../lib/auth-db';
import { getPlayerByIdInOrganization } from '../../../../../../lib/training-db';
import { resolveDashboardSchoolCode } from '../../../../../../lib/dashboard-access';
import { upsertAutomationRollup, type AutomationRollupPayload } from '../../../../../../lib/player-plan-automation-rollup';

export const maxDuration = 300;
const AUTOMATION_RULES_VERSION = 'fixed-thresholds-v1';

type HandSide = 'Left' | 'Right';
type GoalDraft = {
  category: 'Stuff' | 'Execution';
  executionStat: string;
  comparator: 'Greater Than' | 'Less Than';
  targetValue: number;
  objectiveText: string;
  batterSide?: HandSide;
  pitchTypes?: string[];
  countOptions?: string[];
};

const FAST_GROUP = new Set(['Fastball', 'Sinker']);
const OFFSPEED_GROUP = new Set(['Cutter', 'Slider', 'Sweeper', 'Curveball', 'ChangeUp', 'Splitter', 'Knuckleball']);
const BB_THRESHOLD = 11;
const K_THRESHOLD = 20;
const EA_THRESHOLD = 70;
const FPS_THRESHOLD = 60;
const WHIFF_THRESHOLD = 30;
const LOWER_BETTER = new Set(['bbpct']);

function inZoneThresholdForPitch(pitch: string): number {
  if (pitch === 'Fastball' || pitch === 'Sinker') return 50;
  if (pitch === 'ChangeUp' || pitch === 'Splitter') return 35;
  if (pitch === 'Cutter' || pitch === 'Slider' || pitch === 'Sweeper' || pitch === 'Curveball') return 40;
  return 40;
}

function whiffThresholdForPitch(pitch: string): number | null {
  if (pitch === 'Sinker') return null;
  if (pitch === 'Fastball') return 20;
  if (pitch === 'Cutter' || pitch === 'Slider' || pitch === 'Sweeper' || pitch === 'Curveball' || pitch === 'ChangeUp' || pitch === 'Splitter') return 30;
  return 30;
}

function stuffThresholdForPitch(pitch: string): number {
  if (pitch === 'Fastball') return 100;
  if (pitch === 'Sinker') return 85;
  return 95;
}

function stepUpTarget(current: number, floorTarget: number): number {
  const gap = Math.max(0, floorTarget - current);
  const bump = gap > 0 ? Math.max(2, Math.min(5, gap * 0.6)) : 2;
  return Number((current + bump).toFixed(1));
}

function stepDownTarget(current: number, ceilingTarget: number): number {
  const gap = Math.max(0, current - ceilingTarget);
  const drop = gap > 0 ? Math.max(1, Math.min(3, gap * 0.6)) : 1;
  return Number(Math.max(0, current - drop).toFixed(1));
}

function currentPctText(value: number): string {
  return `Current: ${value.toFixed(1)}%`;
}

function currentNumText(value: number): string {
  return `Current: ${value.toFixed(1)}`;
}

function normalizeToken(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/%/g, 'pct').replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
}

function parseNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw || raw === '-') return null;
  const parsed = Number(raw.replace(/[%,$]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function pctFromCounts(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return Number(((100 * numerator) / denominator).toFixed(1));
}

function percentileForValue(value: number, distribution: number[]): number | null {
  if (!Number.isFinite(value) || distribution.length <= 1) return null;
  const min = distribution[0];
  const max = distribution[distribution.length - 1];
  if (Math.abs(max - min) < 1e-9) return null;
  const rankValue = value < min ? min : value > max ? max : value;
  let less = 0;
  let equal = 0;
  for (const point of distribution) {
    if (point < rankValue) less += 1;
    else if (point === rankValue) equal += 1;
  }
  const rank = ((less + (0.5 * equal) - 0.5) / (distribution.length - 1)) * 100;
  return Math.max(0, Math.min(100, rank));
}

function adjustPercentileDirection(column: string, percentile: number): number {
  return LOWER_BETTER.has(normalizeToken(column)) ? Math.max(0, Math.min(100, 100 - percentile)) : percentile;
}

function targetPercentileValue(sorted: number[], percentile: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const p = Math.max(0, Math.min(100, percentile));
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * w;
}

function rowLabel(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw.startsWith('l')) return 'Left';
  if (raw.startsWith('r')) return 'Right';
  return String(value ?? '').trim();
}

function normalizePlayerName(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizePitcherLookupKey(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeFirstLastKey(value: string): string {
  const compact = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9,\s]/g, ' ')
    .replace(/\s+/g, ' ');
  if (!compact) return '';
  const commaMatch = compact.match(/^([^,]+),\s*(.+)$/);
  const ordered = commaMatch ? `${commaMatch[2]} ${commaMatch[1]}` : compact;
  const parts = ordered.split(' ').filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function normalizeNameWords(value: string): string[] {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function firstLastWords(value: string): { first: string; last: string } | null {
  const compact = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9,\s]/g, ' ')
    .replace(/\s+/g, ' ');
  if (!compact) return null;
  const commaMatch = compact.match(/^([^,]+),\s*(.+)$/);
  const ordered = commaMatch ? `${commaMatch[2]} ${commaMatch[1]}` : compact;
  const parts = ordered.split(' ').filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

function pitcherNameCandidates(value: string): string[] {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string) => {
    const c = String(candidate ?? '').trim();
    if (!c) return;
    const key = c.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  add(raw);
  add(raw.replace(/\./g, ' '));
  const commaMatch = raw.match(/^([^,]+),\s*(.+)$/);
  if (commaMatch) add(`${commaMatch[2]} ${commaMatch[1]}`);
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) add(`${parts.slice(1).join(' ')} ${parts[0]}`);
  return out;
}

function pickPitcherRow(
  rows: Array<Record<string, unknown>>,
  splitCol: string,
  pitcherName: string,
  extraCandidates: string[] = []
): Record<string, unknown> | null {
  const nameCandidates = Array.from(new Set([pitcherName, ...extraCandidates].map((v) => String(v ?? '').trim()).filter(Boolean)));
  const normCandidates = new Set(nameCandidates.map((v) => normalizePlayerName(v)).filter(Boolean));
  const firstLastCandidates = new Set(nameCandidates.map((v) => normalizeFirstLastKey(v)).filter(Boolean));
  const bySplitCol = rows.find((entry) => {
    const splitRaw = String(entry[splitCol] ?? '');
    const splitNorm = normalizePlayerName(splitRaw);
    const splitFirstLast = normalizeFirstLastKey(splitRaw);
    return normCandidates.has(splitNorm) || (splitFirstLast && firstLastCandidates.has(splitFirstLast));
  });
  if (bySplitCol) return bySplitCol;
  const byPitcherKey = rows.find((entry) => {
    const raw = String(entry.Pitcher ?? entry.pitcher ?? '');
    const norm = normalizePlayerName(raw);
    const firstLast = normalizeFirstLastKey(raw);
    return normCandidates.has(norm) || (firstLast && firstLastCandidates.has(firstLast));
  });
  if (byPitcherKey) return byPitcherKey;
  const candidateWordPairs = nameCandidates.map(firstLastWords).filter((v): v is { first: string; last: string } => Boolean(v));
  const fuzzyBySplit = rows.find((entry) => {
    const words = normalizeNameWords(String(entry[splitCol] ?? ''));
    if (!words.length) return false;
    return candidateWordPairs.some(({ first, last }) => {
      const hasLast = words.some((w) => w === last || w.endsWith(last) || last.endsWith(w));
      if (!hasLast) return false;
      const hasFirst = words.some((w) => w === first || w.startsWith(first) || first.startsWith(w));
      return hasFirst;
    });
  });
  if (fuzzyBySplit) return fuzzyBySplit;
  const fuzzyByPitcherKey = rows.find((entry) => {
    const words = normalizeNameWords(String(entry.Pitcher ?? entry.pitcher ?? ''));
    if (!words.length) return false;
    return candidateWordPairs.some(({ first, last }) => {
      const hasLast = words.some((w) => w === last || w.endsWith(last) || last.endsWith(w));
      if (!hasLast) return false;
      const hasFirst = words.some((w) => w === first || w.startsWith(first) || first.startsWith(w));
      return hasFirst;
    });
  });
  if (fuzzyByPitcherKey) return fuzzyByPitcherKey;
  return null;
}

function getRowBySplit(rows: Array<Record<string, unknown>>, splitCol: string, splitValue: string): Record<string, unknown> | null {
  const target = splitValue.toLowerCase();
  for (const row of rows) {
    if (rowLabel(row[splitCol])?.toLowerCase() === target) return row;
  }
  return null;
}

function buildDistributionMaps(rows: Array<Record<string, unknown>>, splitCol: string): { byScoped: Map<string, number[]>; byGlobal: Map<string, number[]> } {
  const byScoped = new Map<string, number[]>();
  const byGlobal = new Map<string, number[]>();
  for (const row of rows) {
    const split = rowLabel(row[splitCol]);
    if (!split || split.toLowerCase() === 'all') continue;
    for (const [key, raw] of Object.entries(row)) {
      if (key === splitCol) continue;
      const numeric = parseNum(raw);
      if (numeric === null) continue;
      const scopedKey = `${split.toLowerCase()}::${key}`;
      if (!byScoped.has(scopedKey)) byScoped.set(scopedKey, []);
      byScoped.get(scopedKey)?.push(numeric);
      if (!byGlobal.has(key)) byGlobal.set(key, []);
      byGlobal.get(key)?.push(numeric);
    }
  }
  for (const map of [byScoped, byGlobal]) {
    for (const [key, vals] of map.entries()) {
      map.set(key, vals.filter((v) => Number.isFinite(v)).sort((a, b) => a - b));
    }
  }
  return { byScoped, byGlobal };
}

function metricPercentileFromMaps(
  row: Record<string, unknown> | null,
  splitValue: string,
  metric: string,
  maps: { byScoped: Map<string, number[]>; byGlobal: Map<string, number[]> }
): { value: number | null; percentile: number | null; distribution: number[] } {
  const value = row ? parseNum(row[metric]) : null;
  const scoped = maps.byScoped.get(`${splitValue.toLowerCase()}::${metric}`) ?? [];
  const distribution = scoped.length > 1 ? scoped : maps.byGlobal.get(metric) ?? [];
  if (value === null || distribution.length <= 1) return { value, percentile: null, distribution };
  const rawPct = percentileForValue(value, distribution);
  if (rawPct === null) return { value, percentile: null, distribution };
  return { value, percentile: adjustPercentileDirection(metric, rawPct), distribution };
}

async function fetchRollup(request: Request, params: URLSearchParams): Promise<{ rows: Array<Record<string, unknown>>; splitCol: string }> {
  const base = new URL('/api/dashboard/pitching/table-rollup', request.url);
  base.search = params.toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const response = await fetch(base.toString(), {
    cache: 'no-store',
    headers: { cookie: request.headers.get('cookie') ?? '' },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  const payload = (await response.json().catch(() => ({}))) as {
    table_rows?: Array<Record<string, unknown>>;
    table_columns?: string[];
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error ?? 'Rollup query failed.');
  return {
    rows: Array.isArray(payload.table_rows) ? payload.table_rows : [],
    splitCol: Array.isArray(payload.table_columns) && payload.table_columns.length ? String(payload.table_columns[0]) : '',
  };
}

async function fetchOverviewTable(request: Request, params: URLSearchParams): Promise<{ rows: Array<Record<string, unknown>>; splitCol: string }> {
  const base = new URL('/api/dashboard/pitching/overview', request.url);
  base.search = params.toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const response = await fetch(base.toString(), {
    cache: 'no-store',
    headers: { cookie: request.headers.get('cookie') ?? '' },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  const payload = (await response.json().catch(() => ({}))) as {
    table_rows?: Array<Record<string, unknown>>;
    table_columns?: string[];
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error ?? 'Overview query failed.');
  return {
    rows: Array.isArray(payload.table_rows) ? payload.table_rows : [],
    splitCol: Array.isArray(payload.table_columns) && payload.table_columns.length ? String(payload.table_columns[0]) : '',
  };
}

async function resolveAutomationPlayer(input: {
  organizationId: number;
  playerId: number;
  dashboardPlayerName: string;
}): Promise<{ id: number; fullName: string } | null> {
  const dashboardName = String(input.dashboardPlayerName ?? '').trim();
  if (input.playerId > 0) {
    const player = await getPlayerByIdInOrganization({ organizationId: input.organizationId, playerId: input.playerId });
    if (player) return { id: player.id, fullName: player.fullName };
  }
  if (!dashboardName) return null;
  await ensureAuthDbReady();
  const pool = getDbPool();
  const existing = await pool.query<{ id: number; full_name: string }>(
    `SELECT id, full_name FROM players WHERE organization_id = $1 AND lower(full_name) = lower($2) ORDER BY id DESC LIMIT 1`,
    [input.organizationId, dashboardName]
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, fullName: existing.rows[0].full_name };
  const emailSlug = dashboardName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 48) || 'player';
  const syntheticEmail = `${emailSlug}.${Date.now()}@autolink.local`;
  const inserted = await pool.query<{ id: number; full_name: string }>(
    `INSERT INTO players (organization_id, user_id, full_name, email, status) VALUES ($1, NULL, $2, $3, 'active') RETURNING id, full_name`,
    [input.organizationId, dashboardName, syntheticEmail]
  );
  return inserted.rows[0] ? { id: inserted.rows[0].id, fullName: inserted.rows[0].full_name } : null;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (String(session.role ?? '').toLowerCase() === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    playerId?: number;
    dashboardPlayerName?: string;
    percentileSource?: 'NCAA' | 'MLB';
    sessionType?: string;
    startDate?: string;
    endDate?: string;
  };
  const playerId = Number(body.playerId ?? 0);
  const percentileSource: 'NCAA' | 'MLB' = body.percentileSource === 'MLB' ? 'MLB' : 'NCAA';

  const mappedOrganizationId = resolveProgrammingOrganizationId(session);
  const organizationId = Number(mappedOrganizationId) > 0 ? Number(mappedOrganizationId) : Number(session.organizationId ?? 0);
  if (!organizationId) return NextResponse.json({ error: 'No organization available.' }, { status: 400 });
  const dashboardPlayerName = String(body.dashboardPlayerName ?? '').trim();
  const player = await resolveAutomationPlayer({
    organizationId,
    playerId,
    dashboardPlayerName,
  });
  if (!player) return NextResponse.json({ error: 'Select a player first.' }, { status: 400 });

  const schoolCode = resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role === 'coach' ? 'coach' : 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  });

  const pitcherName = dashboardPlayerName || player.fullName;
  if (!pitcherName) return NextResponse.json({ error: 'Player name is required.' }, { status: 400 });
  const sessionType = String(body.sessionType ?? 'Season').trim() || 'Season';
  const startDate = String(body.startDate ?? '').trim();
  const endDate = String(body.endDate ?? '').trim();

  const mkParams = (splitBy: string, columns: string[]) => {
    const p = new URLSearchParams();
    p.set('school_code', schoolCode);
    p.set('split_by', splitBy);
    p.set('session_type', sessionType);
    if (startDate) p.set('start_date', startDate);
    if (endDate) p.set('end_date', endDate);
    p.set('custom_columns', columns.join(','));
    return p;
  };
  const pitcherCandidates = pitcherNameCandidates(pitcherName);
  let canonicalPitcherCandidates: string[] = [];
  try {
    await ensureAuthDbReady();
    const pool = getDbPool();
    const tableRef = schoolCode === 'PRO' ? 'public.pro_pitching_heatmap_daily_bins' : 'public.pitching_heatmap_daily_bins';
    const candidateKeys = Array.from(new Set(pitcherCandidates.map((v) => normalizePitcherLookupKey(v)).filter(Boolean)));
    if (candidateKeys.length > 0) {
      const where: string[] = ['school_code = $1'];
      const values: unknown[] = [schoolCode];
      let idx = values.length;
      if (startDate) {
        values.push(startDate);
        idx = values.length;
        where.push(`session_date >= $${idx}::date`);
      }
      if (endDate) {
        values.push(endDate);
        idx = values.length;
        where.push(`session_date <= $${idx}::date`);
      }
      if (sessionType && sessionType.toUpperCase() !== 'ALL') {
        values.push(sessionType.toUpperCase());
        idx = values.length;
        where.push(`session_type_bucket = $${idx}`);
      }
      values.push(candidateKeys);
      idx = values.length;
      where.push(`regexp_replace(lower(COALESCE(NULLIF(TRIM(pitcher_norm), ''), '')), '[^a-z0-9]', '', 'g') = ANY($${idx}::text[])`);
      const canonical = await pool.query<{ pitcher_norm: string }>(
        `
        SELECT pitcher_norm
        FROM ${tableRef}
        WHERE ${where.join(' AND ')}
        GROUP BY pitcher_norm
        ORDER BY pitcher_norm
        LIMIT 25
        `,
        values
      );
      canonicalPitcherCandidates = canonical.rows
        .map((row) => String(row.pitcher_norm ?? '').trim())
        .filter(Boolean);
    }
  } catch {
    canonicalPitcherCandidates = [];
  }
  const fetchRollupForPitcher = async (
    baseParams: URLSearchParams,
    fallbackOnEmpty: boolean = false
  ): Promise<{ rows: Array<Record<string, unknown>>; splitCol: string; usedPitcher: string }> => {
    let last: { rows: Array<Record<string, unknown>>; splitCol: string } | null = null;
    let usedPitcher = '';
    const effectiveCandidates = Array.from(new Set([...canonicalPitcherCandidates, ...pitcherCandidates]));
    if (lockedPitcherCandidate) {
      const params = new URLSearchParams(baseParams);
      params.set('pitcher', lockedPitcherCandidate);
      const payload = await fetchRollup(request, params);
      if (payload.rows.length > 0) return { ...payload, usedPitcher: lockedPitcherCandidate };
      if (fallbackOnEmpty) {
        const fallbackPayload = await fetchRollup(request, baseParams);
        return { ...fallbackPayload, usedPitcher: lockedPitcherCandidate };
      }
      return { ...payload, usedPitcher: lockedPitcherCandidate };
    }
    for (const candidate of effectiveCandidates) {
      const params = new URLSearchParams(baseParams);
      params.set('pitcher', candidate);
      const payload = await fetchRollup(request, params);
      last = payload;
      usedPitcher = candidate;
      if (payload.rows.length > 0) {
        lockedPitcherCandidate = candidate;
        return { ...payload, usedPitcher };
      }
    }
    if (fallbackOnEmpty) {
      const payload = await fetchRollup(request, baseParams);
      return { ...payload, usedPitcher: '' };
    }
    if (last) return { ...last, usedPitcher };
    return { rows: [], splitCol: '', usedPitcher: '' };
  };
  const fetchOverviewForPitcher = async (
    baseParams: URLSearchParams
  ): Promise<{ rows: Array<Record<string, unknown>>; splitCol: string; usedPitcher: string }> => {
    let last: { rows: Array<Record<string, unknown>>; splitCol: string } | null = null;
    let usedPitcher = '';
    const effectiveCandidates = Array.from(new Set([...canonicalPitcherCandidates, ...pitcherCandidates]));
    if (lockedPitcherCandidate) {
      const params = new URLSearchParams(baseParams);
      params.set('pitcher', lockedPitcherCandidate);
      const payload = await fetchOverviewTable(request, params);
      return { ...payload, usedPitcher: lockedPitcherCandidate };
    }
    for (const candidate of effectiveCandidates) {
      const params = new URLSearchParams(baseParams);
      params.set('pitcher', candidate);
      const payload = await fetchOverviewTable(request, params);
      last = payload;
      usedPitcher = candidate;
      if (payload.rows.length > 0) {
        lockedPitcherCandidate = candidate;
        return { ...payload, usedPitcher };
      }
    }
    if (last) return { ...last, usedPitcher };
    return { rows: [], splitCol: '', usedPitcher: '' };
  };
  let lockedPitcherCandidate = '';
  const fetchDirectPitcherSideMetrics = async (): Promise<{
    left: { kPct: number | null; bbPct: number | null; eaPct: number | null; fpsPct: number | null };
    right: { kPct: number | null; bbPct: number | null; eaPct: number | null; fpsPct: number | null };
    all: { kPct: number | null; bbPct: number | null; eaPct: number | null; fpsPct: number | null };
  }> => {
    await ensureAuthDbReady();
    const pool = getDbPool();
    const tableRef = schoolCode === 'PRO' ? 'public.pro_pitching_heatmap_daily_bins' : 'public.pitching_heatmap_daily_bins';
    const candidateKeys = Array.from(new Set([...canonicalPitcherCandidates, ...pitcherCandidates].map(normalizePitcherLookupKey).filter(Boolean)));
    if (!candidateKeys.length) {
      return {
        left: { kPct: null, bbPct: null, eaPct: null, fpsPct: null },
        right: { kPct: null, bbPct: null, eaPct: null, fpsPct: null },
        all: { kPct: null, bbPct: null, eaPct: null, fpsPct: null },
      };
    }
    const run = async (includeSessionType: boolean) => {
      const where: string[] = ['school_code = $1'];
      const values: unknown[] = [schoolCode];
      if (startDate) {
        values.push(startDate);
        where.push(`session_date >= $${values.length}::date`);
      }
      if (endDate) {
        values.push(endDate);
        where.push(`session_date <= $${values.length}::date`);
      }
      if (includeSessionType && sessionType && sessionType.toUpperCase() !== 'ALL') {
        values.push(sessionType.toUpperCase());
        where.push(`session_type_bucket = $${values.length}`);
      }
      values.push(candidateKeys);
      where.push(`regexp_replace(lower(COALESCE(NULLIF(TRIM(pitcher_norm), ''), '')), '[^a-z0-9]', '', 'g') = ANY($${values.length}::text[])`);
      return pool.query<{
        side: string;
        pa_n: number | null;
        k_n: number | null;
        bb_n: number | null;
        ea_num: number | null;
        ea_den: number | null;
        fps_num: number | null;
        fps_den: number | null;
      }>(
        `
        SELECT
          CASE
            WHEN batterside_norm = 'Left' THEN 'Left'
            WHEN batterside_norm = 'Right' THEN 'Right'
            ELSE 'All'
          END AS side,
          SUM(pa_n)::int AS pa_n,
          SUM(k_n)::int AS k_n,
          SUM(bb_n)::int AS bb_n,
          SUM(ea_num)::int AS ea_num,
          SUM(ea_den)::int AS ea_den,
          SUM(fps_num)::int AS fps_num,
          SUM(fps_den)::int AS fps_den
        FROM ${tableRef}
        WHERE ${where.join(' AND ')}
        GROUP BY 1
        `,
        values
      );
    };
    let rows = await run(true);
    // Some schools do not tag this slice under SEASON consistently; retry without
    // session_type to keep player-specific automation working.
    if ((rows.rowCount ?? 0) < 1 && sessionType && sessionType.toUpperCase() !== 'ALL') {
      rows = await run(false);
    }
    const build = (side: 'Left' | 'Right' | 'All') => {
      const row = rows.rows.find((r) => String(r.side) === side) ?? null;
      return {
        kPct: pctFromCounts(parseNum(row?.k_n), parseNum(row?.pa_n)),
        bbPct: pctFromCounts(parseNum(row?.bb_n), parseNum(row?.pa_n)),
        eaPct: pctFromCounts(parseNum(row?.ea_num), parseNum(row?.ea_den)),
        fpsPct: pctFromCounts(parseNum(row?.fps_num), parseNum(row?.fps_den)),
      };
    };
    return { left: build('Left'), right: build('Right'), all: build('All') };
  };

  try {
    const resultsCols = ['K%', 'BB%', 'Whiff%', 'InZone%'];
    const processCols = ['E+A%', 'FPS%', 'Whiff%', 'InZone%'];
    const pitchCols = ['#', 'InZone%', 'Whiff%', 'Stuff+'];

    const mkOverviewParams = (columns: string[]) => {
      const p = new URLSearchParams();
      p.set('school_code', schoolCode);
      p.set('table_mode', 'Live');
      p.set('split_by', 'Batter Hand');
      p.set('session_type', sessionType);
      if (startDate) p.set('start_date', startDate);
      if (endDate) p.set('end_date', endDate);
      p.set('custom_columns', columns.join(','));
      p.set('include_chart_points', '0');
      p.set('include_row_pitches', '0');
      p.set('include_trend_rows', '0');
      return p;
    };
    const rHand = mkOverviewParams(resultsCols);
    const pHand = mkOverviewParams(processCols);
    const [resultsHand, processHand, directMetrics] = await Promise.all([
      fetchOverviewForPitcher(rHand),
      fetchOverviewForPitcher(pHand),
      fetchDirectPitcherSideMetrics().catch(() => ({
        left: { kPct: null, bbPct: null, eaPct: null, fpsPct: null },
        right: { kPct: null, bbPct: null, eaPct: null, fpsPct: null },
        all: { kPct: null, bbPct: null, eaPct: null, fpsPct: null },
      })),
    ]);

    const fetchPitcherSideRow = async (side: HandSide, columns: string[]) => {
      const p = mkParams('Pitch Types', columns);
      p.set('batter_side', side);
      const payload = await fetchRollupForPitcher(p, false);
      const split = payload.splitCol || 'Pitch';
      return (
        payload.rows.find((entry) => String(entry[split] ?? '').trim().toLowerCase() === 'all') ??
        payload.rows[0] ??
        null
      );
    };
    const fetchPitcherOverallRow = async (columns: string[]) => {
      const p = mkParams('Pitch Types', columns);
      const payload = await fetchRollupForPitcher(p, false);
      const split = payload.splitCol || 'Pitch';
      return (
        payload.rows.find((entry) => String(entry[split] ?? '').trim().toLowerCase() === 'all') ??
        payload.rows[0] ??
        null
      );
    };
    const fetchPitcherSideCounts = async (side: HandSide) => {
      const row = await fetchPitcherSideRow(side, ['PA', 'K', 'BB']);
      const pa = parseNum(row?.PA);
      const k = parseNum(row?.K);
      const bb = parseNum(row?.BB);
      return { pa, k, bb };
    };
    const collectPitcherLabels = async (side: HandSide) => {
      const p = mkParams('Pitch Types', ['K%', 'BB%']);
      p.set('batter_side', side);
      const payload = await fetchRollupForPitcher(p, false);
      const split = payload.splitCol || 'Pitch';
      const labels = payload.rows
        .map((row) => String(row[split] ?? '').trim())
        .filter((v) => v.length > 0)
        .slice(0, 20);
      return { split, labels };
    };
    const [resultsLeftRowByPitcher, resultsRightRowByPitcher, processLeftRowByPitcher, processRightRowByPitcher, leftCounts, rightCounts, overallCountsRow, overallProcessRow] = await Promise.all([
      fetchPitcherSideRow('Left', ['K%', 'BB%']),
      fetchPitcherSideRow('Right', ['K%', 'BB%']),
      fetchPitcherSideRow('Left', ['E+A%', 'FPS%']),
      fetchPitcherSideRow('Right', ['E+A%', 'FPS%']),
      fetchPitcherSideCounts('Left'),
      fetchPitcherSideCounts('Right'),
      fetchPitcherOverallRow(['PA', 'K', 'BB', 'K%', 'BB%']),
      fetchPitcherOverallRow(['E+A%', 'FPS%']),
    ]);
    const overallPa = parseNum(overallCountsRow?.PA);
    const overallK = parseNum(overallCountsRow?.K);
    const overallBB = parseNum(overallCountsRow?.BB);
    const overallKpct = parseNum(overallCountsRow?.['K%']) ?? pctFromCounts(overallK, overallPa);
    const overallBBpct = parseNum(overallCountsRow?.['BB%']) ?? pctFromCounts(overallBB, overallPa);
    const overallEa = parseNum(overallProcessRow?.['E+A%']);
    const overallFps = parseNum(overallProcessRow?.['FPS%']);

    const handCol = resultsHand.splitCol || processHand.splitCol || 'Batter Hand';
    const handRows = {
      Left: getRowBySplit(resultsHand.rows, handCol, 'Left'),
      Right: getRowBySplit(resultsHand.rows, handCol, 'Right'),
    };
    const resultsAllRow =
      resultsHand.rows.find((row) => String(row[handCol] ?? '').trim().toLowerCase() === 'all') ??
      resultsHand.rows[0] ??
      null;
    const processAllRow =
      processHand.rows.find((row) => String(row[processHand.splitCol || handCol] ?? '').trim().toLowerCase() === 'all') ??
      processHand.rows[0] ??
      null;
    // Lock "current" stat source to Batter Hand summary rows to match table semantics.
    let kLeftRaw = parseNum(handRows.Left?.['K%']) ?? parseNum(resultsAllRow?.['K%']);
    let kRightRaw = parseNum(handRows.Right?.['K%']) ?? parseNum(resultsAllRow?.['K%']);
    let bbLeftRaw = parseNum(handRows.Left?.['BB%']) ?? parseNum(resultsAllRow?.['BB%']);
    let bbRightRaw = parseNum(handRows.Right?.['BB%']) ?? parseNum(resultsAllRow?.['BB%']);
    if (kLeftRaw === null) kLeftRaw = pctFromCounts(leftCounts.k, leftCounts.pa);
    if (kRightRaw === null) kRightRaw = pctFromCounts(rightCounts.k, rightCounts.pa);
    if (bbLeftRaw === null) bbLeftRaw = pctFromCounts(leftCounts.bb, leftCounts.pa);
    if (bbRightRaw === null) bbRightRaw = pctFromCounts(rightCounts.bb, rightCounts.pa);
    if (kLeftRaw === null) kLeftRaw = overallKpct;
    if (kRightRaw === null) kRightRaw = overallKpct;
    if (bbLeftRaw === null) bbLeftRaw = overallBBpct;
    if (bbRightRaw === null) bbRightRaw = overallBBpct;
    if (kLeftRaw === null) kLeftRaw = directMetrics.left.kPct ?? directMetrics.all.kPct;
    if (kRightRaw === null) kRightRaw = directMetrics.right.kPct ?? directMetrics.all.kPct;
    if (bbLeftRaw === null) bbLeftRaw = directMetrics.left.bbPct ?? directMetrics.all.bbPct;
    if (bbRightRaw === null) bbRightRaw = directMetrics.right.bbPct ?? directMetrics.all.bbPct;

    // Side K/BB must come from Batter Hand summary path. Only fall back to
    // direct aggregated pitcher metrics when summary rows are sparse.
    if (kLeftRaw === null && kRightRaw === null && bbLeftRaw === null && bbRightRaw === null) {
      kLeftRaw = directMetrics.left.kPct ?? directMetrics.all.kPct;
      kRightRaw = directMetrics.right.kPct ?? directMetrics.all.kPct;
      bbLeftRaw = directMetrics.left.bbPct ?? directMetrics.all.bbPct;
      bbRightRaw = directMetrics.right.bbPct ?? directMetrics.all.bbPct;
    }
    // Keep nulls if still unresolved; downstream fallback should use real process/aggregate
    // metrics and avoid inventing synthetic K/BB values.

    const bbConcernSides = (['Left', 'Right'] as HandSide[]).filter((side) => {
      const value = side === 'Left' ? bbLeftRaw : bbRightRaw;
      return value !== null && value > BB_THRESHOLD;
    });
    const kConcernSides = (['Left', 'Right'] as HandSide[]).filter((side) => {
      const value = side === 'Left' ? kLeftRaw : kRightRaw;
      return value !== null && value < K_THRESHOLD;
    });

    const bbWorstSide: HandSide =
      (bbLeftRaw ?? -1) >= (bbRightRaw ?? -1) ? 'Left' : 'Right';
    const kWorstSide: HandSide =
      (kLeftRaw ?? 999) <= (kRightRaw ?? 999) ? 'Left' : 'Right';

    const kDeficits = (['Left', 'Right'] as HandSide[])
      .map((side) => {
        const value = side === 'Left' ? kLeftRaw : kRightRaw;
        return value === null ? null : K_THRESHOLD - value;
      })
      .filter((v): v is number => v !== null);
    const bbDeficits = (['Left', 'Right'] as HandSide[])
      .map((side) => {
        const value = side === 'Left' ? bbLeftRaw : bbRightRaw;
        return value === null ? null : value - BB_THRESHOLD;
      })
      .filter((v): v is number => v !== null);
    const bestKDeficit = kDeficits.length ? Math.max(...kDeficits) : Number.NEGATIVE_INFINITY;
    const bestBBDeficit = bbDeficits.length ? Math.max(...bbDeficits) : Number.NEGATIVE_INFINITY;
    const createK = bestKDeficit > 0;
    const createBB = bestBBDeficit > 0;

    const goals: GoalDraft[] = [];

    if (createBB) {
      const side = bbConcernSides.includes(bbWorstSide) ? bbWorstSide : bbConcernSides[0];
      const processSplitCol = processHand.splitCol || handCol;
      const processRow =
        getRowBySplit(processHand.rows, processSplitCol, side) ??
        getRowBySplit(processHand.rows, processSplitCol, side);
      let eaRaw = parseNum(processRow?.['E+A%']) ?? parseNum(processAllRow?.['E+A%']) ?? overallEa;
      let fpsRaw = parseNum(processRow?.['FPS%']) ?? parseNum(processAllRow?.['FPS%']) ?? overallFps;
      if (eaRaw === null) eaRaw = (side === 'Left' ? directMetrics.left.eaPct : directMetrics.right.eaPct) ?? directMetrics.all.eaPct;
      if (fpsRaw === null) fpsRaw = (side === 'Left' ? directMetrics.left.fpsPct : directMetrics.right.fpsPct) ?? directMetrics.all.fpsPct;
      const eaGap = eaRaw === null ? Number.NEGATIVE_INFINITY : EA_THRESHOLD - eaRaw;
      const fpsGap = fpsRaw === null ? Number.NEGATIVE_INFINITY : FPS_THRESHOLD - fpsRaw;
      const primaryMetric = eaGap >= fpsGap ? 'E+A%' : 'FPS%';
      const currentPrimaryVal = primaryMetric === 'E+A%' ? eaRaw : fpsRaw;
      const threshold = primaryMetric === 'E+A%' ? EA_THRESHOLD : FPS_THRESHOLD;

      if (currentPrimaryVal !== null && currentPrimaryVal < threshold) {
        const targetVal = stepUpTarget(currentPrimaryVal, threshold);
        goals.push({
          category: 'Execution',
          executionStat: primaryMetric,
          comparator: 'Greater Than',
          targetValue: targetVal,
          objectiveText: `Raise ${primaryMetric} vs ${side === 'Left' ? 'LHH' : 'RHH'} to ${targetVal.toFixed(1)}%. (${currentPctText(currentPrimaryVal)})`,
          batterSide: side,
        });
      }

      const pPitch = mkParams('Pitch Types', ['#', 'InZone%']);
      pPitch.set('batter_side', side);
      if (primaryMetric === 'FPS%') pPitch.set('count_filter', '0-0');

      const pPitchBase = mkParams('Pitch Types', ['#', 'InZone%']);
      pPitchBase.set('batter_side', side);
      if (primaryMetric === 'FPS%') pPitchBase.set('count_filter', '0-0');

      const [pitchRows, pitchBaseRows] = await Promise.all([fetchRollupForPitcher(pPitch), fetchRollup(request, pPitchBase)]);
      const pitchSplit = pitchRows.splitCol || 'Pitch';

      const allRow = pitchRows.rows.find((r) => String(r[pitchSplit] ?? '').trim().toLowerCase() === 'all');
      const totalPitches = parseNum(allRow?.['#']) ?? 0;
      const rows = pitchRows.rows
        .map((row) => {
          const pitch = String(row[pitchSplit] ?? '').trim();
          if (!pitch || pitch.toLowerCase() === 'all') return null;
          const count = parseNum(row['#']) ?? 0;
          if (count <= 0) return null;
          const inZoneVal = parseNum(row['InZone%']);
          const usage = totalPitches > 0 ? (100 * count) / totalPitches : 0;
          return { pitch, usage, inZoneVal };
        })
        .filter((v): v is { pitch: string; usage: number; inZoneVal: number | null } => Boolean(v));

      let chosen = rows
        .filter((r) => FAST_GROUP.has(r.pitch) && r.inZoneVal !== null && r.inZoneVal < inZoneThresholdForPitch(r.pitch))
        .sort((a, b) => ((a.inZoneVal ?? 999) - (b.inZoneVal ?? 999)))[0];
      if (!chosen) {
        const off = rows
          .filter((r) => OFFSPEED_GROUP.has(r.pitch) && r.inZoneVal !== null && r.inZoneVal < inZoneThresholdForPitch(r.pitch))
          .sort((a, b) => ((a.inZoneVal ?? 999) - (b.inZoneVal ?? 999)))[0];
        chosen = off;
      }

      if (chosen) {
        const threshold = inZoneThresholdForPitch(chosen.pitch);
        const targetV = stepUpTarget(chosen.inZoneVal ?? threshold, threshold);
        let objective = `Improve ${chosen.pitch} InZone% vs ${side === 'Left' ? 'LHH' : 'RHH'} to ${targetV.toFixed(1)}%.`;
        if (chosen.inZoneVal !== null) objective += ` (${currentPctText(chosen.inZoneVal)})`;
        if (primaryMetric === 'FPS%') {
          const ordered = rows.filter((r) => r.inZoneVal !== null).sort((a, b) => (b.inZoneVal ?? 0) - (a.inZoneVal ?? 0));
          const weightSum = ordered.reduce((sum, _, idx) => sum + (ordered.length - idx), 0);
          const usagePlan = ordered
            .map((r, idx) => {
              const wt = ordered.length - idx;
              const pct = (100 * wt) / Math.max(1, weightSum);
              return `${r.pitch} ${pct.toFixed(1)}%`;
            })
            .join(', ');
          objective += ` 0-0 usage suggestion: ${usagePlan}.`;
        }
        goals.push({
          category: 'Execution',
          executionStat: 'InZone%',
          comparator: 'Greater Than',
          targetValue: targetV,
          objectiveText: objective,
          batterSide: side,
          pitchTypes: [chosen.pitch],
          countOptions: primaryMetric === 'FPS%' ? ['0-0'] : ['All'],
        });
      }
    }

    if (createK && goals.length < 3) {
      const side = kConcernSides.includes(kWorstSide) ? kWorstSide : kConcernSides[0];
      const processSplitCol = processHand.splitCol || handCol;
      const processRow =
        getRowBySplit(processHand.rows, processSplitCol, side) ??
        getRowBySplit(processHand.rows, processSplitCol, side);
      const sideWhiff = parseNum(processRow?.['Whiff%']) ?? parseNum(processAllRow?.['Whiff%']);
      if (sideWhiff !== null && sideWhiff < WHIFF_THRESHOLD) {
        const target = stepUpTarget(sideWhiff, WHIFF_THRESHOLD);
        goals.push({
          category: 'Execution',
          executionStat: 'Whiff%',
          comparator: 'Greater Than',
          targetValue: target,
          objectiveText: `Improve Whiff% vs ${side === 'Left' ? 'LHH' : 'RHH'} to ${target.toFixed(1)}%. (${currentPctText(sideWhiff)})`,
          batterSide: side,
        });
      }
      if (goals.length >= 3) {
        // preserve priority cap
      } else {
      const rPitch = mkParams('Pitch Types', pitchCols);
      rPitch.set('batter_side', side);
      const rPitchBase = mkParams('Pitch Types', pitchCols);
      rPitchBase.set('batter_side', side);

      const [pitchRows, pitchBaseRows] = await Promise.all([fetchRollupForPitcher(rPitch), fetchRollup(request, rPitchBase)]);
      const splitCol = pitchRows.splitCol || 'Pitch';
      const allRow = pitchRows.rows.find((r) => String(r[splitCol] ?? '').trim().toLowerCase() === 'all');
      const totalPitches = parseNum(allRow?.['#']) ?? 0;

      const rows = pitchRows.rows
        .map((row) => {
          const pitch = String(row[splitCol] ?? '').trim();
          if (!pitch || pitch.toLowerCase() === 'all') return null;
          const count = parseNum(row['#']) ?? 0;
          if (count <= 0) return null;
          const usage = totalPitches > 0 ? (100 * count) / totalPitches : 0;
          const whiffVal = parseNum(row['Whiff%']);
          const stuffVal = parseNum(row['Stuff+']);
          return {
            pitch,
            usage,
            whiffVal,
            stuffVal,
          };
        })
        .filter((v): v is { pitch: string; usage: number; whiffVal: number | null; stuffVal: number | null } => Boolean(v));

      const qual = rows.filter((r) => r.usage > 7);
      const whiffConcern = qual
        .filter((r) => whiffThresholdForPitch(r.pitch) !== null && r.whiffVal !== null)
        .filter((r) => (r.whiffVal as number) < (whiffThresholdForPitch(r.pitch) as number))
        .sort((a, b) => ((a.whiffVal ?? 999) - (b.whiffVal ?? 999)))[0];
      const stuffConcern = qual
        .filter((r) => r.stuffVal !== null)
        .filter((r) => (r.stuffVal as number) < stuffThresholdForPitch(r.pitch))
        .sort((a, b) => ((a.stuffVal ?? 999) - (b.stuffVal ?? 999)))[0];

      if (whiffConcern) {
        const threshold = whiffThresholdForPitch(whiffConcern.pitch) ?? 30;
        const targetV = stepUpTarget(whiffConcern.whiffVal ?? threshold, threshold);
          goals.push({
            category: 'Execution',
            executionStat: 'Whiff%',
            comparator: 'Greater Than',
            targetValue: targetV,
            objectiveText: `Improve ${whiffConcern.pitch} Whiff% vs ${side === 'Left' ? 'LHH' : 'RHH'} to ${targetV.toFixed(1)}% (min 7% usage). (${currentPctText(whiffConcern.whiffVal ?? threshold)})`,
            batterSide: side,
            pitchTypes: [whiffConcern.pitch],
          });
      } else if (stuffConcern) {
        const threshold = stuffThresholdForPitch(stuffConcern.pitch);
        const targetV = stepUpTarget(stuffConcern.stuffVal ?? threshold, threshold);
          goals.push({
            category: 'Execution',
            executionStat: 'Stuff+',
            comparator: 'Greater Than',
            targetValue: targetV,
            objectiveText: `Improve ${stuffConcern.pitch} Stuff+ vs ${side === 'Left' ? 'LHH' : 'RHH'} to ${targetV.toFixed(1)} (min 7% usage). (${currentNumText(stuffConcern.stuffVal ?? threshold)})`,
            batterSide: side,
            pitchTypes: [stuffConcern.pitch],
          });
      }
      }
    }

    if (!goals.length) {
      const leftK = kLeftRaw ?? Number.POSITIVE_INFINITY;
      const rightK = kRightRaw ?? Number.POSITIVE_INFINITY;
      const leftBB = bbLeftRaw ?? Number.NEGATIVE_INFINITY;
      const rightBB = bbRightRaw ?? Number.NEGATIVE_INFINITY;
      const kGapLeft = K_THRESHOLD - leftK;
      const kGapRight = K_THRESHOLD - rightK;
      const bbGapLeft = leftBB - BB_THRESHOLD;
      const bbGapRight = rightBB - BB_THRESHOLD;
      const bestKGap = Math.max(kGapLeft, kGapRight);
      const bestBBGap = Math.max(bbGapLeft, bbGapRight);
      const hasKDeficit = bestKGap > 0;
      const hasBBDeficit = bestBBGap > 0;
      const useK = hasKDeficit && (!hasBBDeficit || bestKGap >= bestBBGap);
      if ((hasKDeficit || hasBBDeficit) && useK && Number.isFinite(Math.min(leftK, rightK))) {
        const side: HandSide = leftK <= rightK ? 'Left' : 'Right';
        const current = side === 'Left' ? leftK : rightK;
        const target = stepUpTarget(current, K_THRESHOLD);
        goals.push({
          category: 'Execution',
          executionStat: 'K%',
          comparator: 'Greater Than',
          targetValue: target,
          objectiveText: `Raise K% vs ${side === 'Left' ? 'LHH' : 'RHH'} to ${target.toFixed(1)}%. (${currentPctText(current)})`,
          batterSide: side,
        });
      } else if ((hasKDeficit || hasBBDeficit) && Number.isFinite(Math.max(leftBB, rightBB))) {
        const side: HandSide = leftBB >= rightBB ? 'Left' : 'Right';
        const current = side === 'Left' ? leftBB : rightBB;
        const target = stepDownTarget(current, BB_THRESHOLD);
        goals.push({
          category: 'Execution',
          executionStat: 'BB%',
          comparator: 'Less Than',
          targetValue: target,
          objectiveText: `Lower BB% vs ${side === 'Left' ? 'LHH' : 'RHH'} below ${target.toFixed(1)}%. (${currentPctText(current)})`,
          batterSide: side,
        });
      }
    }

    const finalGoals = goals.slice(0, 3);
    if (!finalGoals.length) {
      // Absolute fallback so automation never hard-fails on sparse/missing split rows.
      const processSplitCol = processHand.splitCol || handCol;
      const processRight = getRowBySplit(processHand.rows, processSplitCol, 'Right');
      const processLeft = getRowBySplit(processHand.rows, processSplitCol, 'Left');
      const processAll =
        processHand.rows.find((row) => String(row[processSplitCol] ?? '').trim().toLowerCase() === 'all') ??
        processHand.rows[0] ??
        null;
      const resultsAll =
        resultsHand.rows.find((row) => String(row[handCol] ?? '').trim().toLowerCase() === 'all') ??
        resultsHand.rows[0] ??
        null;

      const fallbackCandidates: Array<{
        stat: 'E+A%' | 'FPS%' | 'K%' | 'BB%';
        side: HandSide;
        current: number;
        deficit: number;
      }> = [];
      for (const side of ['Left', 'Right'] as HandSide[]) {
        const pRow = side === 'Left' ? processLeft : processRight;
        const ea = parseNum(pRow?.['E+A%']) ?? parseNum(processAll?.['E+A%']);
        const fps = parseNum(pRow?.['FPS%']) ?? parseNum(processAll?.['FPS%']);
        const k = side === 'Left' ? kLeftRaw : kRightRaw;
        const bb = side === 'Left' ? bbLeftRaw : bbRightRaw;
        if (ea !== null) fallbackCandidates.push({ stat: 'E+A%', side, current: ea, deficit: EA_THRESHOLD - ea });
        if (fps !== null) fallbackCandidates.push({ stat: 'FPS%', side, current: fps, deficit: FPS_THRESHOLD - fps });
        if (k !== null) fallbackCandidates.push({ stat: 'K%', side, current: k, deficit: K_THRESHOLD - k });
        if (bb !== null) fallbackCandidates.push({ stat: 'BB%', side, current: bb, deficit: bb - BB_THRESHOLD });
      }
      // If no side rows, try all-row metrics.
      if (!fallbackCandidates.length) {
        const ea = parseNum(processAll?.['E+A%']);
        const fps = parseNum(processAll?.['FPS%']);
        const k = parseNum(resultsAll?.['K%']);
        const bb = parseNum(resultsAll?.['BB%']);
        if (ea !== null) fallbackCandidates.push({ stat: 'E+A%', side: 'Right', current: ea, deficit: EA_THRESHOLD - ea });
        if (fps !== null) fallbackCandidates.push({ stat: 'FPS%', side: 'Right', current: fps, deficit: FPS_THRESHOLD - fps });
        if (k !== null) fallbackCandidates.push({ stat: 'K%', side: 'Right', current: k, deficit: K_THRESHOLD - k });
        if (bb !== null) fallbackCandidates.push({ stat: 'BB%', side: 'Right', current: bb, deficit: bb - BB_THRESHOLD });
        const directEa = directMetrics.all.eaPct;
        const directFps = directMetrics.all.fpsPct;
        const directK = directMetrics.all.kPct;
        const directBb = directMetrics.all.bbPct;
        if (directEa !== null) fallbackCandidates.push({ stat: 'E+A%', side: 'Right', current: directEa, deficit: EA_THRESHOLD - directEa });
        if (directFps !== null) fallbackCandidates.push({ stat: 'FPS%', side: 'Right', current: directFps, deficit: FPS_THRESHOLD - directFps });
        if (directK !== null) fallbackCandidates.push({ stat: 'K%', side: 'Right', current: directK, deficit: K_THRESHOLD - directK });
        if (directBb !== null) fallbackCandidates.push({ stat: 'BB%', side: 'Right', current: directBb, deficit: directBb - BB_THRESHOLD });
      }

      if (fallbackCandidates.length) {
        // Prioritize under-threshold items only; avoid manufacturing generic K/BB goals.
        const below = fallbackCandidates.filter((c) => c.deficit > 0);
        if (below.length) {
          const chosen = below.sort((a, b) => b.deficit - a.deficit)[0];
          if (chosen.stat === 'BB%') {
            const target = stepDownTarget(chosen.current, BB_THRESHOLD);
            finalGoals.push({
              category: 'Execution',
              executionStat: 'BB%',
              comparator: 'Less Than',
              targetValue: target,
              objectiveText: `Lower BB% vs ${chosen.side === 'Left' ? 'LHH' : 'RHH'} below ${target.toFixed(1)}%. (${currentPctText(chosen.current)})`,
              batterSide: chosen.side,
            });
          } else {
            const threshold = chosen.stat === 'E+A%' ? EA_THRESHOLD : chosen.stat === 'FPS%' ? FPS_THRESHOLD : K_THRESHOLD;
            const target = stepUpTarget(chosen.current, threshold);
            finalGoals.push({
              category: 'Execution',
              executionStat: chosen.stat,
              comparator: 'Greater Than',
              targetValue: target,
              objectiveText: `Raise ${chosen.stat} vs ${chosen.side === 'Left' ? 'LHH' : 'RHH'} to ${target.toFixed(1)}%. (${currentPctText(chosen.current)})`,
              batterSide: chosen.side,
            });
          }
        } else {
          const processOnly = fallbackCandidates
            .filter((c) => c.stat === 'E+A%' || c.stat === 'FPS%')
            .sort((a, b) => Math.abs(a.deficit) - Math.abs(b.deficit));
          const chosenProcess = processOnly[0] ?? null;
          if (chosenProcess) {
            const threshold = chosenProcess.stat === 'E+A%' ? EA_THRESHOLD : FPS_THRESHOLD;
            const target = stepUpTarget(chosenProcess.current, threshold);
            finalGoals.push({
              category: 'Execution',
              executionStat: chosenProcess.stat,
              comparator: 'Greater Than',
              targetValue: target,
              objectiveText: `Raise ${chosenProcess.stat} vs ${chosenProcess.side === 'Left' ? 'LHH' : 'RHH'} to ${target.toFixed(1)}%. (${currentPctText(chosenProcess.current)})`,
              batterSide: chosenProcess.side,
            });
          }
        }
      } else {
        return NextResponse.json(
          {
            error: `Unable to compute player-specific automated goals for ${pitcherName} with current filters.`,
            debug: {
              pitcherName,
              pitcherCandidates,
              canonicalPitcherCandidates,
              directMetrics,
              kLeftRaw,
              kRightRaw,
              bbLeftRaw,
              bbRightRaw,
            },
          },
          { status: 400 }
        );
      }
    }

    const payload: AutomationRollupPayload = {
      generated_at: new Date().toISOString(),
      generated_goals: finalGoals,
      debug: {
        source: 'overview-live-refresh',
        percentileSource,
        rulesVersion: AUTOMATION_RULES_VERSION,
        pitcherRequested: pitcherName,
        pitcherCandidates,
        lockedPitcherCandidate: lockedPitcherCandidate || null,
        pitcherMatchedResultsHand: resultsHand.usedPitcher || null,
        pitcherMatchedProcessHand: processHand.usedPitcher || null,
        kLeft: kLeftRaw,
        kRight: kRightRaw,
        bbLeft: bbLeftRaw,
        bbRight: bbRightRaw,
        resultsSplitCol: handCol,
        resultsLeftRow: handRows.Left ?? null,
        resultsRightRow: handRows.Right ?? null,
        resultsAllRow: resultsAllRow ?? null,
        processSplitCol: processHand.splitCol || handCol,
        processLeftRow: getRowBySplit(processHand.rows, processHand.splitCol || handCol, 'Left') ?? null,
        processRightRow: getRowBySplit(processHand.rows, processHand.splitCol || handCol, 'Right') ?? null,
        processAllRow: processAllRow ?? null,
        bestKDeficit,
        bestBBDeficit,
        createK,
        createBB,
      },
    };

    await upsertAutomationRollup({
      organizationId,
      playerId: player.id,
      schoolCode,
      percentileSource,
      seasonYear: new Date().getUTCFullYear(),
      payload,
    });

    return NextResponse.json({ ok: true, generated: finalGoals.length, cached: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to refresh automated rollup.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

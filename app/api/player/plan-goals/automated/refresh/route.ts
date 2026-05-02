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

function pickPitcherRow(
  rows: Array<Record<string, unknown>>,
  splitCol: string,
  pitcherName: string
): Record<string, unknown> | null {
  const target = normalizePlayerName(pitcherName);
  const bySplitCol = rows.find((entry) => normalizePlayerName(String(entry[splitCol] ?? '')) === target);
  if (bySplitCol) return bySplitCol;
  const byPitcherKey = rows.find((entry) => normalizePlayerName(String(entry.Pitcher ?? entry.pitcher ?? '')) === target);
  if (byPitcherKey) return byPitcherKey;
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

  try {
    const resultsCols = ['K%', 'BB%'];
    const processCols = ['E+A%', 'FPS%'];
    const pitchCols = ['#', 'InZone%', 'Whiff%', 'Stuff+'];

    const rHand = mkParams('Batter Hand', resultsCols);
    rHand.set('pitcher', pitcherName);
    const pHand = mkParams('Batter Hand', processCols);
    pHand.set('pitcher', pitcherName);
    const [resultsHand, processHand] = await Promise.all([
      fetchRollup(request, rHand),
      fetchRollup(request, pHand),
    ]);

    const fetchPitcherSideRow = async (side: HandSide, columns: string[]) => {
      const p = mkParams('Pitcher', columns);
      p.set('pitcher', pitcherName);
      p.set('batter_side', side);
      const payload = await fetchRollup(request, p);
      const split = payload.splitCol || 'Pitcher';
      return (
        pickPitcherRow(payload.rows, split, pitcherName) ??
        payload.rows.find((entry) => String(entry[split] ?? '').trim().toLowerCase() !== 'all') ??
        payload.rows[0] ??
        null
      );
    };
    const [resultsLeftRowByPitcher, resultsRightRowByPitcher, processLeftRowByPitcher, processRightRowByPitcher] = await Promise.all([
      fetchPitcherSideRow('Left', ['K%', 'BB%']),
      fetchPitcherSideRow('Right', ['K%', 'BB%']),
      fetchPitcherSideRow('Left', ['E+A%', 'FPS%']),
      fetchPitcherSideRow('Right', ['E+A%', 'FPS%']),
    ]);

    const handCol = resultsHand.splitCol || processHand.splitCol || 'Batter Hand';
    const handRows = {
      Left: getRowBySplit(resultsHand.rows, handCol, 'Left'),
      Right: getRowBySplit(resultsHand.rows, handCol, 'Right'),
    };
    let kLeftRaw = parseNum(resultsLeftRowByPitcher?.['K%']) ?? parseNum(handRows.Left?.['K%']);
    let kRightRaw = parseNum(resultsRightRowByPitcher?.['K%']) ?? parseNum(handRows.Right?.['K%']);
    let bbLeftRaw = parseNum(resultsLeftRowByPitcher?.['BB%']) ?? parseNum(handRows.Left?.['BB%']);
    let bbRightRaw = parseNum(resultsRightRowByPitcher?.['BB%']) ?? parseNum(handRows.Right?.['BB%']);

    // Some datasets return only "All" for Batter Hand split. In that case, force
    // handed values via Pitcher split + batter_side filter for this selected pitcher.
    const hasHandRows = Boolean(handRows.Left || handRows.Right);
    if (!hasHandRows) {
      const fetchPitcherSide = async (side: HandSide, columns: string[]) => {
        const p = mkParams('Pitcher', columns);
        p.set('pitcher', pitcherName);
        p.set('batter_side', side);
        const payload = await fetchRollup(request, p);
        const row =
          payload.rows.find((entry) => String(entry[payload.splitCol || 'Pitcher'] ?? '').trim().toLowerCase() !== 'all') ??
          payload.rows[0] ??
          null;
        return row;
      };
      const [leftResultsRow, rightResultsRow] = await Promise.all([
        fetchPitcherSide('Left', ['K%', 'BB%']),
        fetchPitcherSide('Right', ['K%', 'BB%']),
      ]);
      kLeftRaw = parseNum(leftResultsRow?.['K%']);
      bbLeftRaw = parseNum(leftResultsRow?.['BB%']);
      kRightRaw = parseNum(rightResultsRow?.['K%']);
      bbRightRaw = parseNum(rightResultsRow?.['BB%']);
    }

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

    const createBB = bbConcernSides.length > 0;
    const createK = kConcernSides.length > 0;

    const goals: GoalDraft[] = [];

    if (createBB) {
      const side = bbConcernSides.includes(bbWorstSide) ? bbWorstSide : bbConcernSides[0];
      const processSplitCol = processHand.splitCol || handCol;
      const processRow =
        (side === 'Left' ? processLeftRowByPitcher : processRightRowByPitcher) ??
        getRowBySplit(processHand.rows, processSplitCol, side);
      const eaRaw = parseNum(processRow?.['E+A%']);
      const fpsRaw = parseNum(processRow?.['FPS%']);
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
      pPitch.set('pitcher', pitcherName);
      pPitch.set('batter_side', side);
      if (primaryMetric === 'FPS%') pPitch.set('count_filter', '0-0');

      const pPitchBase = mkParams('Pitch Types', ['#', 'InZone%']);
      pPitchBase.set('batter_side', side);
      if (primaryMetric === 'FPS%') pPitchBase.set('count_filter', '0-0');

      const [pitchRows, pitchBaseRows] = await Promise.all([fetchRollup(request, pPitch), fetchRollup(request, pPitchBase)]);
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
      const rPitch = mkParams('Pitch Types', pitchCols);
      rPitch.set('pitcher', pitcherName);
      rPitch.set('batter_side', side);
      const rPitchBase = mkParams('Pitch Types', pitchCols);
      rPitchBase.set('batter_side', side);

      const [pitchRows, pitchBaseRows] = await Promise.all([fetchRollup(request, rPitch), fetchRollup(request, rPitchBase)]);
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
      const useK = bestKGap >= bestBBGap;
      if (useK && Number.isFinite(Math.min(leftK, rightK))) {
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
      } else if (Number.isFinite(Math.max(leftBB, rightBB))) {
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
      }

      if (fallbackCandidates.length) {
        // Prioritize most under-threshold; if none under, choose smallest margin to threshold.
        const below = fallbackCandidates.filter((c) => c.deficit > 0);
        const chosen = (below.length
          ? below.sort((a, b) => b.deficit - a.deficit)
          : fallbackCandidates.sort((a, b) => Math.abs(a.deficit) - Math.abs(b.deficit)))[0];
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
        const processAll =
          processHand.rows.find((row) => {
            const split = processHand.splitCol || handCol;
            return String(row[split] ?? '').trim().toLowerCase() === 'all';
          }) ??
          processHand.rows[0] ??
          null;
        const currentEa = parseNum(processAll?.['E+A%']) ?? EA_THRESHOLD - 5;
        const target = stepUpTarget(currentEa, EA_THRESHOLD);
        finalGoals.push({
          category: 'Execution',
          executionStat: 'E+A%',
          comparator: 'Greater Than',
          targetValue: target,
          objectiveText: `Raise E+A% to ${target.toFixed(1)}%. (${currentPctText(currentEa)})`,
          batterSide: 'Right',
        });
      }
    }

    const payload: AutomationRollupPayload = {
      generated_at: new Date().toISOString(),
      generated_goals: finalGoals,
      debug: { source: 'table-rollup-refresh', percentileSource, rulesVersion: AUTOMATION_RULES_VERSION },
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

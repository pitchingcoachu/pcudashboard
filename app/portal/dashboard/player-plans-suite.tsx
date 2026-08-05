'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatTableDisplayValue } from '../../../lib/table-sort';
import { pitchLocationLabel as inZoneLabel } from '../../../lib/pitch-location';
import NativeDateInput from '../components/native-date-input';

type Domain = 'Pitching' | 'Hitting' | 'Catching';
type GoalSlot = 1 | 2 | 3;
type GoalCategory =
  | 'Mechanical'
  | 'Stuff'
  | 'Execution'
  | 'Hitting Stats'
  | 'Mental Side'
  | 'Strength'
  | 'Mobility'
  | 'Weight'
  | 'Swing Decisions'
  | 'Batted Ball'
  | 'Pre-Pitch Routine';
type Comparator = 'Greater Than' | 'Less Than';
type ChartType = 'Release' | 'Movement Plot' | 'Pitch Chart' | 'HeatMaps' | 'Trend';
type HeatmapView = 'Pitch' | 'Frequency' | 'Whiff Rate' | 'GB Rate' | 'Contact Rate' | 'Swing Rate' | 'Exit Velocity' | 'Run Values' | 'QP+' | 'Called Strike Rate';
type NoteCategory = 'Player Plan' | 'Weight Room' | 'Nutrition' | 'Mental Training';
type OptionItem = { value: string; label: string };

type PlayerOption = {
  playerId: number;
  fullName: string;
  throwsHand: string | null;
  batsHand: string | null;
  position: string | null;
};

type GoalDraft = {
  slotIndex: GoalSlot;
  category: GoalCategory | '';
  objectiveText: string;
  stuffType: '' | 'Velocity' | 'Movement';
  movementAxis: '' | 'IVB' | 'HB' | 'IVB+HB';
  executionStat: string;
  comparator: Comparator;
  targetValue: string;
  chartType: ChartType;
  heatmapView: HeatmapView;
  startDate: string;
  endDate: string;
  pitchTypes: string[];
  ballTypes: string[];
  pitchResults: string[];
  countOptions: string[];
  afterCountOptions: string[];
  teams: string[];
  hand: string;
  batterSide: string;
  sessionType: string;
  createdAt: string | null;
};

type GoalPayload = {
  schema: 'pcu_goal_v2';
  category: GoalCategory;
  objectiveText?: string;
  stuffType?: '' | 'Velocity' | 'Movement';
  movementAxis?: '' | 'IVB' | 'HB' | 'IVB+HB';
  executionStat?: string;
  comparator?: Comparator;
  targetValue?: number | null;
  chartType?: ChartType;
  heatmapView?: HeatmapView;
  filters?: {
    startDate?: string;
    endDate?: string;
    pitchTypes?: string[];
    ballTypes?: string[];
    pitchResults?: string[];
    countOptions?: string[];
    afterCountOptions?: string[];
    teams?: string[];
    hand?: string;
    batterSide?: string;
    sessionType?: string;
  };
};

type PlayerPlanNote = {
  id: number;
  playerId: number;
  domain: Domain;
  noteDate: string;
  category: NoteCategory;
  noteText: string;
  attachmentName: string | null;
  attachmentMimeType: string | null;
  attachmentDataUrl: string | null;
  createdAt: string;
};

type DashboardFilterOptions = {
  pitchers?: string[];
  hitters?: string[];
  catchers?: string[];
  pitch_types: string[];
  ball_types?: string[];
  pitch_results: string[];
  count_options: string[];
  after_count_options: string[];
  team_types: string[];
  hands?: string[];
  batter_sides?: string[];
};

type GoalChartState = {
  loading: boolean;
  error: string;
  points: Array<Record<string, unknown>>;
};
type MetricNode = { value: number | null; avg: number | null };
type AutomatedTreePitchMetric = {
  pitch: string;
  usage: MetricNode;
  usageLt2k: MetricNode;
  usage2k: MetricNode;
  inZone: MetricNode;
  strike: MetricNode;
  whiff: MetricNode;
  whiffLt2k: MetricNode;
  whiff2k: MetricNode;
  stuff: MetricNode;
};
type AutomatedTreeSideData = {
  kPct: MetricNode;
  bbPct: MetricNode;
  whiffPct: MetricNode;
  eaPct: MetricNode;
  fpsPct: MetricNode;
  pitches00: AutomatedTreePitchMetric[];
  pitchesAll: AutomatedTreePitchMetric[];
};
type AutomatedTreeData = { left: AutomatedTreeSideData; right: AutomatedTreeSideData; overallK: MetricNode; overallBB: MetricNode };
type HeatCell = { x: number; y: number; w: number; h: number; value: number; density: number };
type PlanMode = 'Manual' | 'Automated';
type SummaryMode = 'automated' | 'manual';

const DOMAIN_OPTIONS: Domain[] = ['Pitching', 'Hitting', 'Catching'];
const GOAL_CATEGORIES: GoalCategory[] = [
  'Mechanical',
  'Stuff',
  'Execution',
  'Hitting Stats',
  'Mental Side',
  'Strength',
  'Mobility',
  'Weight',
  'Swing Decisions',
  'Batted Ball',
  'Pre-Pitch Routine',
];
const DOMAIN_GOAL_CATEGORIES: Record<Domain, GoalCategory[]> = {
  Pitching: [
    'Mechanical',
    'Stuff',
    'Execution',
    'Mental Side',
    'Strength',
    'Mobility',
    'Weight',
    'Swing Decisions',
    'Batted Ball',
    'Pre-Pitch Routine',
  ],
  Hitting: [
    'Mechanical',
    'Hitting Stats',
    'Mental Side',
    'Strength',
    'Mobility',
    'Weight',
    'Swing Decisions',
    'Batted Ball',
    'Pre-Pitch Routine',
  ],
  Catching: [
    'Mechanical',
    'Execution',
    'Mental Side',
    'Strength',
    'Mobility',
    'Weight',
    'Swing Decisions',
    'Batted Ball',
    'Pre-Pitch Routine',
  ],
};
const DOMAIN_EXECUTION_FALLBACKS: Record<Domain, string[]> = {
  Pitching: [
    'Velo',
    'Max',
    'IVB',
    'HB',
    'Spin',
    'Height',
    'Side',
    'Ext',
    'Strike%',
    'Swing%',
    'FPS%',
    'Early%',
    'Ahead%',
    'E+A%',
    '1-1W%',
    'InZone%',
    'Comp%',
    'QP%',
    'Whiff%',
    'K%',
    'BB%',
    'GB%',
    'Barrel%',
    'CSW%',
    'EV',
    'LA',
    'Stuff+',
    'Ctrl+',
    'QP+',
    'Pitching+',
    'RV/100',
    'P',
    'BF',
    'Whiffs',
    'K',
    'BB',
    'AVG',
    'SLG',
    'OBP',
    'OPS',
    'wOBA',
    'xWOBA',
    'ISO',
    'xISO',
    'BABIP',
  ],
  Hitting: [
    'Swing%',
    'Whiff%',
    'FPS%',
    'Called-S%',
    'Take%',
    'Chase%',
    'GoZoneSw%',
    'IZswing%',
    'EdgeSwing%',
    'PosSD%',
    'PA',
    'AB',
    'AVG',
    'SLG',
    'OBP',
    'OPS',
    'wOBA',
    'xWOBA',
    'ISO',
    'xISO',
    'BABIP',
    'K%',
    'BB%',
    'GB%',
    'Barrel%',
    'EV',
    'LA',
  ],
  Catching: ['# Throws', 'Velo', 'ExchangeTime', 'PopTime', 'SL+'],
};
const HITTING_EXECUTION_ALLOWED = new Set(
  (DOMAIN_EXECUTION_FALLBACKS.Hitting ?? []).map((value) => normalizeExecutionStatKey(value))
);
const CHART_OPTIONS: ChartType[] = ['Release', 'Movement Plot', 'Pitch Chart', 'HeatMaps', 'Trend'];
const HEATMAP_VIEW_OPTIONS: HeatmapView[] = [
  'Pitch',
  'Frequency',
  'Whiff Rate',
  'GB Rate',
  'Contact Rate',
  'Swing Rate',
  'Exit Velocity',
  'Run Values',
  'QP+',
  'Called Strike Rate',
];
const NOTE_CATEGORIES: NoteCategory[] = ['Player Plan', 'Weight Room', 'Nutrition', 'Mental Training'];
const GOAL_CARD_HEIGHT = 700;
const GOAL_PANEL_HEIGHT = 430;
const GOAL_VISUAL_HEIGHT = 360;

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatNameFirstLast(name: string): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed.includes(',')) return trimmed;
  const [last, ...rest] = trimmed.split(',').map((part) => part.trim());
  const first = rest.join(' ').trim();
  if (!last || !first) return trimmed;
  return `${first} ${last}`;
}

function normalizePersonName(value: string): string {
  return formatNameFirstLast(value)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function firstLastKey(value: string): string {
  const cleaned = normalizePersonName(value);
  if (!cleaned) return '';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function uniqueNames(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean)));
}

function uniqueCanonicalNames(values: string[]): string[] {
  const map = new Map<string, string>();
  for (const raw of values) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;
    const key = normalizePersonName(trimmed);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || (existing.includes(',') && !trimmed.includes(','))) map.set(key, trimmed);
  }
  return Array.from(map.values());
}

function uniqueDisplayNames(values: string[]): string[] {
  const byNormalized = new Map<string, string>();
  for (const raw of values) {
    const display = formatNameFirstLast(String(raw ?? '').trim());
    const key = normalizePersonName(display);
    if (!key) continue;
    if (!byNormalized.has(key)) byNormalized.set(key, display);
  }
  return Array.from(byNormalized.values()).sort((a, b) => a.localeCompare(b));
}

function resolveDashboardPlayerName(selectedName: string, candidates: string[]): string {
  const selected = String(selectedName ?? '').trim();
  if (!selected) return '';
  const cleanedCandidates = uniqueNames(candidates.filter((value) => value && value !== 'All'));
  if (!cleanedCandidates.length) return selected;
  const exact = cleanedCandidates.find((value) => value === selected);
  if (exact) return exact;
  const normalizedSelected = normalizePersonName(selected);
  const normalizedMatch = cleanedCandidates.find((value) => normalizePersonName(value) === normalizedSelected);
  return normalizedMatch ?? selected;
}

function resolveTypedPlayerInput(inputName: string, candidates: string[]): string {
  const typed = String(inputName ?? '').trim();
  if (!typed) return '';
  const cleanedCandidates = uniqueNames(candidates.filter((value) => value && value !== 'All'));
  if (!cleanedCandidates.length) return typed;
  const exact = cleanedCandidates.find((value) => value === typed);
  if (exact) return exact;
  const typedNorm = normalizePersonName(typed);
  const normalizedMatch = cleanedCandidates.find((value) => normalizePersonName(value) === typedNorm);
  if (normalizedMatch) return normalizedMatch;
  const firstLastTyped = firstLastKey(typed);
  const firstLastMatch = cleanedCandidates.find((value) => firstLastKey(value) === firstLastTyped);
  return firstLastMatch ?? typed;
}

function normalizeNameKey(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function toMetricNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') return null;
  const parsed = Number(raw.replace(/[%,$]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function metricColor(value: number | null, avg: number | null, lowerBetter = false): string {
  if (value === null || avg === null) return 'rgba(255,255,255,0.9)';
  const delta = value - avg;
  const eps = Math.max(0.25, Math.abs(avg) * 0.01);
  if (Math.abs(delta) <= eps) return 'rgba(255,255,255,0.95)';
  const better = lowerBetter ? delta < 0 : delta > 0;
  return better ? '#22c55e' : '#ef4444';
}

function formatMetricValue(value: number | null, kind: 'pct' | 'plus' = 'pct'): string {
  if (value === null || !Number.isFinite(value)) return '--';
  if (kind === 'plus') return `${value.toFixed(1)}`;
  return `${value.toFixed(1)}%`;
}

function getRowLabelValue(row: Record<string, unknown>, preferredKeys: string[]): string {
  for (const key of preferredKeys) {
    const v = String(row[key] ?? '').trim();
    if (v) return v;
  }
  for (const [key, raw] of Object.entries(row)) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    if (key === '#' || /^\d+(\.\d+)?$/.test(v)) continue;
    return v;
  }
  return '';
}

function findMetricValue(row: Record<string, unknown> | null, keys: string[]): number | null {
  if (!row) return null;
  for (const key of keys) {
    if (key in row) {
      const n = toMetricNumber(row[key]);
      if (n !== null) return n;
    }
  }
  const normalizedTarget = new Set(keys.map((k) => k.toLowerCase().replace(/[^a-z0-9+]/g, '')));
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9+]/g, '');
    if (normalizedTarget.has(normalizedKey)) {
      const n = toMetricNumber(value);
      if (n !== null) return n;
    }
  }

  // Safe fallback: derive K%/BB% only when explicitly requested and only from count fields.
  const wantsKpct = keys.some((k) => k.trim().toLowerCase() === 'k%');
  const wantsBBpct = keys.some((k) => k.trim().toLowerCase() === 'bb%');
  if (wantsKpct || wantsBBpct) {
    const readByAliases = (aliases: string[]): number | null => {
      for (const alias of aliases) {
        if (alias in row) {
          const n = toMetricNumber(row[alias]);
          if (n !== null) return n;
        }
      }
      const normalizedAliases = new Set(aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9+]/g, '')));
      for (const [key, value] of Object.entries(row)) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9+]/g, '');
        if (!normalizedAliases.has(normalizedKey)) continue;
        const n = toMetricNumber(value);
        if (n !== null) return n;
      }
      return null;
    };

    const den = readByAliases(['PA', 'BF', '#', 'P', 'TBF', 'BF_n', 'PA_n']);
    if (den !== null && den > 0) {
      if (wantsKpct) {
        const k = readByAliases(['K', 'SO', 'Strikeouts', 'K_n', 'SO_n']);
        if (k !== null) return (k / den) * 100;
      }
      if (wantsBBpct) {
        const bb = readByAliases(['BB', 'Walks', 'BB_n']);
        if (bb !== null) return (bb / den) * 100;
      }
    }
  }
  return null;
}

const K_PCT_KEYS = ['K%', 'K Percent', 'K pct', 'SO%', 'Strikeout%', 'Strike Out%'];
const BB_PCT_KEYS = ['BB%', 'BB Percent', 'BB pct', 'Walk%', 'Walk Rate%'];
const FPS_KEYS = ['FPS%', 'FPS', 'First Pitch Strike%', 'FirstPitchStrike%', 'First Pitch Strike', 'FPS(FB)%', 'FPS(OS)%'];
const EA_KEYS = ['E+A%', 'EA%', 'E A%', 'Early+Ahead%', 'Early Ahead%', 'Early%', 'Ahead%'];

function findHeuristicMetricValue(row: Record<string, unknown> | null, metric: 'k' | 'bb' | 'fps' | 'ea'): number | null {
  if (!row) return null;
  const entries = Object.entries(row);
  const normalized = entries.map(([key, value]) => ({
    key,
    value,
    norm: key.toLowerCase().replace(/[^a-z0-9+]/g, ''),
  }));
  const read = (pattern: RegExp) => {
    for (const entry of normalized) {
      if (!pattern.test(entry.norm)) continue;
      const n = toMetricNumber(entry.value);
      if (n !== null) return n;
    }
    return null;
  };

  if (metric === 'k') return read(/^(k|kpct|kpercent|so|sopct|strikeoutpct)$/);
  if (metric === 'bb') return read(/^(bb|bbpct|bbpercent|walk|walkpct|walkratepct)$/);
  if (metric === 'fps') {
    const direct = read(/^(fps|fpspct|firstpitchstrike|firstpitchstrikepct|fpsfbpct|fpsospct)$/);
    if (direct !== null) return direct;
    const fb = read(/^fpsfbpct$/);
    const os = read(/^fpsospct$/);
    if (fb !== null && os !== null) return (fb + os) / 2;
    return fb ?? os;
  }

  const directEa = read(/^(ea|eapct|e\+apct|earlyahead|earlyaheadpct)$/);
  if (directEa !== null) return directEa;
  const early = read(/^earlypct$/);
  const ahead = read(/^aheadpct$/);
  if (early !== null && ahead !== null) return early + ahead;
  return early ?? ahead;
}

function weightedMetricFromPitches(rows: AutomatedTreePitchMetric[], metric: 'whiff' | 'stuff'): number | null {
  if (!rows.length) return null;
  let num = 0;
  let den = 0;
  for (const row of rows) {
    const usage = row.usage.value ?? 0;
    const value = metric === 'whiff' ? row.whiff.value : row.stuff.value;
    if (value === null || usage <= 0) continue;
    num += value * usage;
    den += usage;
  }
  if (den <= 0) return null;
  return num / den;
}

function weightedMetricAvgFromPitches(rows: AutomatedTreePitchMetric[], metric: 'whiff' | 'stuff'): number | null {
  if (!rows.length) return null;
  let num = 0;
  let den = 0;
  for (const row of rows) {
    const usage = row.usage.avg ?? 0;
    const value = metric === 'whiff' ? row.whiff.avg : row.stuff.avg;
    if (value === null || usage <= 0) continue;
    num += value * usage;
    den += usage;
  }
  if (den <= 0) return null;
  return num / den;
}

function weightedPitchMetric(rows: AutomatedTreePitchMetric[], metric: 'inZone' | 'strike' | 'whiff' | 'stuff', source: 'value' | 'avg' = 'value'): number | null {
  if (!rows.length) return null;
  let num = 0;
  let den = 0;
  for (const row of rows) {
    const usage = source === 'avg' ? (row.usage.avg ?? 0) : (row.usage.value ?? 0);
    if (usage <= 0) continue;
    const cell =
      metric === 'inZone'
        ? row.inZone
        : metric === 'strike'
          ? row.strike
          : metric === 'whiff'
            ? row.whiff
            : row.stuff;
    const metricValue = source === 'avg' ? cell.avg : cell.value;
    if (metricValue === null || !Number.isFinite(metricValue)) continue;
    num += metricValue * usage;
    den += usage;
  }
  if (den <= 0) return null;
  return num / den;
}

function weightedRawMetric(rows: Array<Record<string, unknown>>, metricKeys: string[]): number | null {
  if (!rows.length) return null;
  let num = 0;
  let den = 0;
  for (const row of rows) {
    const label = normalizeSplitLabel(getRowLabelValue(row, ['Pitch Types', 'Pitch Type', 'Pitch', 'Split']));
    if (!label || label.includes('all') || label.includes('overall')) continue;
    const w = findMetricValue(row, ['#', 'P', 'PA', 'BF']) ?? 0;
    const v = findMetricValue(row, metricKeys);
    if (w <= 0 || v === null) continue;
    num += v * w;
    den += w;
  }
  if (den <= 0) return null;
  return num / den;
}

function buildPitchRowsFromSummaryRows(rows: Array<Record<string, unknown>>, splitCol?: string): AutomatedTreePitchMetric[] {
  const out: AutomatedTreePitchMetric[] = [];
  let total = 0;
  const weightedRows: Array<{ row: Record<string, unknown>; pitch: string; w: number }> = [];
  for (const row of rows) {
    const pitch = getRowLabelValue(row, [splitCol || '', 'Pitch Types', 'Pitch Type', 'Pitch', 'Tagged Pitch Type']);
    if (!pitch || pitch.toLowerCase() === 'all') continue;
    const w = findMetricValue(row, ['#', 'P', 'PA', 'BF']) ?? 0;
    if (w > 0) {
      total += w;
      weightedRows.push({ row, pitch, w });
    }
  }
  for (const item of weightedRows) {
    const usage = total > 0 ? (item.w / total) * 100 : null;
    const whiff = findMetricValue(item.row, ['Whiff%']);
    const inZone = findMetricValue(item.row, ['InZone%']);
    const strike = findMetricValue(item.row, ['Strike%']);
    const stuff = findMetricValue(item.row, ['Stuff+', 'Stuff +', 'StuffPlus', 'stuff_plus', 'tj_stuff_plus']);
    out.push({
      pitch: item.pitch,
      usage: { value: usage, avg: null },
      usageLt2k: { value: null, avg: null },
      usage2k: { value: null, avg: null },
      inZone: { value: inZone, avg: null },
      strike: { value: strike, avg: null },
      whiff: { value: whiff, avg: null },
      whiffLt2k: { value: null, avg: null },
      whiff2k: { value: null, avg: null },
      stuff: { value: stuff, avg: null },
    });
  }
  return out.sort((a, b) => (b.usage.value ?? 0) - (a.usage.value ?? 0));
}

function meanMetricFromRows(rows: Array<Record<string, unknown>>, metricKeys: string[]): number | null {
  const vals: number[] = [];
  for (const row of rows) {
    const label = normalizeSplitLabel(getRowLabelValue(row, ['Pitch Types', 'Pitch Type', 'Pitch', 'Split']));
    if (!label || label.includes('all') || label.includes('overall')) continue;
    const v = findMetricValue(row, metricKeys);
    if (v !== null) vals.push(v);
  }
  if (!vals.length) return null;
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
}

function anyRowMetric(rows: Array<Record<string, unknown>>, metricKeys: string[]): number | null {
  for (const row of rows) {
    const v = findMetricValue(row, metricKeys);
    if (v !== null) return v;
  }
  return null;
}

function normalizePitchLabel(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeSplitLabel(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function colorFromThresholdBand(value: number | null, poor: number, great: number, higherBetter = true): string {
  if (value === null || !Number.isFinite(value)) return 'rgba(255,255,255,0.9)';
  if (higherBetter) {
    if (value < poor) return '#ef4444';
    if (value > great) return '#22c55e';
    return 'rgba(255,255,255,0.95)';
  }
  if (value > poor) return '#ef4444';
  if (value < great) return '#22c55e';
  return 'rgba(255,255,255,0.95)';
}

function pitchFamilyKey(pitch: string): string {
  const key = normalizePitchLabel(pitch);
  if (key.includes('fastball') || key === 'fb' || key === 'fourseam' || key === 'fourseamfastball') return 'fastball';
  if (key.includes('sinker') || key === 'si' || key === 'twoseam' || key === 'twoseamfastball') return 'sinker';
  if (key.includes('cutter') || key === 'fc') return 'cutter';
  if (key.includes('slider') || key === 'sl') return 'slider';
  if (key.includes('sweeper') || key === 'sv') return 'sweeper';
  if (key.includes('curve') || key === 'cu' || key === 'kc') return 'curveball';
  if (key.includes('change') || key === 'ch') return 'changeup';
  if (key.includes('split') || key === 'fs') return 'splitter';
  return key;
}

function treeMetricColor(metric: 'k' | 'bb' | 'whiff_overall' | 'stuff_overall' | 'fps' | 'inzone' | 'strike' | 'whiff_pitch' | 'stuff_pitch' | 'usage', value: number | null, pitch?: string): string {
  if (metric === 'usage') return 'rgba(255,255,255,0.95)';
  if (metric === 'k') return colorFromThresholdBand(value, 19, 25, true);
  if (metric === 'bb') return colorFromThresholdBand(value, 12, 8, false);
  if (metric === 'whiff_overall') return colorFromThresholdBand(value, 20, 26, true);
  if (metric === 'stuff_overall') return colorFromThresholdBand(value, 95, 105, true);
  if (metric === 'fps') return colorFromThresholdBand(value, 60, 64, true);
  if (metric === 'strike') return colorFromThresholdBand(value, 59, 65, true);
  if (metric === 'inzone') {
    const fam = pitchFamilyKey(pitch ?? '');
    if (fam === 'fastball' || fam === 'sinker') return colorFromThresholdBand(value, 49, 57, true);
    if (fam === 'changeup' || fam === 'splitter') return colorFromThresholdBand(value, 30, 40, true);
    if (fam === 'cutter' || fam === 'slider' || fam === 'curveball' || fam === 'sweeper') return colorFromThresholdBand(value, 40, 48, true);
    return colorFromThresholdBand(value, 44, 52, true);
  }
  if (metric === 'whiff_pitch') {
    const fam = pitchFamilyKey(pitch ?? '');
    if (fam === 'fastball') return colorFromThresholdBand(value, 15, 25, true);
    if (fam === 'sinker') return colorFromThresholdBand(value, 10, 14, true);
    if (fam === 'cutter') return colorFromThresholdBand(value, 21, 29, true);
    return colorFromThresholdBand(value, 28, 38, true);
  }
  if (metric === 'stuff_pitch') {
    const fam = pitchFamilyKey(pitch ?? '');
    if (fam === 'fastball') return colorFromThresholdBand(value, 97, 109, true);
    if (fam === 'sinker') return colorFromThresholdBand(value, 70, 90, true);
    return colorFromThresholdBand(value, 95, 105, true);
  }
  return 'rgba(255,255,255,0.95)';
}

function isTreeRed(color: string): boolean {
  return color === '#ef4444';
}

function isTreeGreen(color: string): boolean {
  return color === '#22c55e';
}

function overallRankLabel(metric: 'k' | 'bb', value: number | null): 'above average' | 'average' | 'below average' {
  const color = treeMetricColor(metric, value);
  if (isTreeGreen(color)) return 'above average';
  if (isTreeRed(color)) return 'below average';
  return 'average';
}

function playerNameQueryCandidates(selectedName: string, resolvedName: string): string[] {
  const selected = String(selectedName ?? '').trim();
  const resolved = String(resolvedName ?? '').trim();
  const set = new Set<string>();
  if (resolved) set.add(resolved);
  if (selected) set.add(selected);
  if (selected) set.add(formatNameFirstLast(selected));
  if (resolved) set.add(formatNameFirstLast(resolved));
  const asLastFirst = (value: string): string => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed || trimmed.includes(',')) return trimmed;
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return trimmed;
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(' ');
    return `${last}, ${first}`.trim();
  };
  if (selected) set.add(asLastFirst(selected));
  if (resolved) set.add(asLastFirst(resolved));
  return Array.from(set).filter(Boolean);
}

function toOptions(values: string[]): OptionItem[] {
  return values.length ? values.map((value) => ({ value, label: value })) : [{ value: 'All', label: 'All' }];
}

function withAllOption(values?: string[]): string[] {
  const cleaned = Array.from(
    new Set((values ?? []).map((value) => String(value ?? '').trim()).filter((value) => value.length > 0 && value !== 'All'))
  );
  return ['All', ...cleaned];
}

function normalizeExecutionStatKey(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/%/g, 'pct')
    .replace(/[+\s\-_/]/g, '');
}

function normalizeMulti(values: string[]): string[] {
  const unique = Array.from(new Set(values.filter((value) => value.trim().length > 0)));
  if (unique.length === 0) return ['All'];
  if (unique.includes('All')) return ['All'];
  return unique;
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const GOAL_CHART_COLORS: Record<string, string> = {
  Fastball: 'var(--portal-fastball-color)',
  Sinker: 'orange',
  Cutter: 'brown',
  Slider: 'red',
  Sweeper: 'purple',
  Curveball: 'blue',
  ChangeUp: 'darkgreen',
  Splitter: 'turquoise',
  Knuckleball: 'darkblue',
  Undefined: '#9ca3af',
};

function pitchHoverTextColor(bg?: string): string {
  if (!bg) return '#fff';
  const v = bg.toLowerCase();
  if (v.includes('--portal-fastball-color')) {
    const isLight = typeof document !== 'undefined' && document.body.classList.contains('theme-light');
    return isLight ? '#fff' : '#111';
  }
  if (v === '#ffffff' || v === 'white' || v === 'orange' || v === 'turquoise') return '#111';
  return '#fff';
}

function resolvePitchResultLabel(pitchCallRaw: string | null | undefined, playResultRaw: string | null | undefined): string {
  const pitchCall = (pitchCallRaw ?? '').trim();
  const playResult = (playResultRaw ?? '').trim();
  const valid = (value: string) => value.length > 0 && value !== 'Undefined';
  if (pitchCall === 'InPlay' && valid(playResult)) return playResult;
  if (valid(pitchCall) && /foul/i.test(pitchCall)) return 'Foul';
  if (pitchCall === 'HitByPitch' || playResult === 'HitByPitch') return 'HBP';
  if (valid(pitchCall)) return pitchCall;
  if (valid(playResult)) return playResult;
  return '-';
}

function chartTooltipText(point: Record<string, unknown>): string {
  const sessionType = String(point.session_type ?? '-');
  const pitchCall = String(point.pitch_call ?? '');
  const playResult = String(point.play_result ?? '');
  const velo = toNum(point.velo);
  const ivb = toNum(point.ivb);
  const hb = toNum(point.hb);
  const ev = toNum(point.exit_speed);
  const la = toNum(point.angle);
  const stuff = toNum(point.stuff_plus);
  const side = toNum(point.plate_side);
  const height = toNum(point.plate_height);
  return `Session: ${sessionType || '-'}\nResult: ${resolvePitchResultLabel(pitchCall, playResult)}\nVelo: ${
    velo !== null ? velo.toFixed(1) : '-'
  } mph\nIVB: ${ivb !== null ? ivb.toFixed(1) : '-'} in\nHB: ${hb !== null ? hb.toFixed(1) : '-'} in\nEV: ${
    ev !== null ? ev.toFixed(1) : '-'
  } mph\nLA: ${la !== null ? la.toFixed(1) : '-'}°\nStuff+: ${stuff !== null ? stuff.toFixed(1) : '-'}\nIn Zone: ${inZoneLabel(side, height)}`;
}

function releaseTooltipText(point: Record<string, unknown>): string {
  const sessionType = String(point.session_type ?? '-');
  const h = toNum(point.release_height);
  const s = toNum(point.release_side);
  const ext = toNum(point.extension);
  return `Session: ${sessionType || '-'}\nHeight: ${h !== null ? h.toFixed(2) : '-'} ft\nSide: ${s !== null ? s.toFixed(2) : '-'} ft\nExtension: ${
    ext !== null ? ext.toFixed(2) : '-'
  } ft`;
}

function shinyHeatSequential(tRaw: number): string {
  const t = Math.max(0, Math.min(1, tRaw));
  const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
  const rgb = (r: number, g: number, b: number) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  if (t < 0.2) return rgb(lerp(232, 142, t / 0.2), lerp(238, 183, t / 0.2), lerp(247, 225, t / 0.2));
  if (t < 0.45) return rgb(lerp(142, 170, (t - 0.2) / 0.25), lerp(183, 211, (t - 0.2) / 0.25), lerp(225, 235, (t - 0.2) / 0.25));
  if (t < 0.7) return rgb(lerp(170, 240, (t - 0.45) / 0.25), lerp(211, 218, (t - 0.45) / 0.25), lerp(235, 154, (t - 0.45) / 0.25));
  if (t < 0.88) return rgb(lerp(240, 235, (t - 0.7) / 0.18), lerp(218, 120, (t - 0.7) / 0.18), lerp(154, 82, (t - 0.7) / 0.18));
  return rgb(lerp(235, 216, (t - 0.88) / 0.12), lerp(120, 43, (t - 0.88) / 0.12), lerp(82, 52, (t - 0.88) / 0.12));
}

function divergingColor(value: number, min: number, mid: number, max: number): string {
  if (!Number.isFinite(value)) return 'rgba(255,255,255,0.08)';
  const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
  const rgb = (r: number, g: number, b: number) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  if (value <= mid) {
    const t = Math.max(0, Math.min(1, (value - min) / Math.max(1e-9, mid - min)));
    return rgb(lerp(32, 246, t), lerp(74, 248, t), lerp(135, 248, t));
  }
  const t = Math.max(0, Math.min(1, (value - mid) / Math.max(1e-9, max - mid)));
  return rgb(lerp(248, 176, t), lerp(248, 11, t), lerp(248, 52, t));
}

function formatMdyy(isoDate: string): string {
  if (!isoDate) return '';
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  const y = Number(match[1]) % 100;
  const m = Number(match[2]);
  const d = Number(match[3]);
  return `${m}/${d}/${String(y).padStart(2, '0')}`;
}

function resultShape(pitchCall: string, playResult: string): string {
  if (pitchCall === 'HitByPitch' || playResult === 'HitByPitch') return 'Ball';
  if (pitchCall === 'StrikeCalled') return 'Called Strike';
  if (pitchCall === 'BallCalled' || pitchCall === 'BallinDirt') return 'Ball';
  if (pitchCall === 'FoulBall' || pitchCall === 'FoulBallFieldable' || pitchCall === 'FoulBallNotFieldable') return 'Foul';
  if (pitchCall === 'StrikeSwinging') return 'Whiff';
  if (pitchCall === 'InPlay' && (playResult === 'Out' || playResult === 'FieldersChoice' || playResult === 'Sacrifice')) return 'In Play (Out)';
  if (pitchCall === 'InPlay' && (playResult === 'Single' || playResult === 'Double' || playResult === 'Triple' || playResult === 'HomeRun')) return 'In Play (Hit)';
  if (pitchCall === 'InPlay' && playResult === 'Error') return 'Error';
  return '';
}

function buildGoalHeatCells(points: Array<Record<string, unknown>>, metric: HeatmapView): HeatCell[] {
  const xMin = -2.5;
  const xMax = 2.5;
  const yMin = 0;
  const yMax = 4.5;
  const cols = 40;
  const rows = 40;
  const cellW = (xMax - xMin) / cols;
  const cellH = (yMax - yMin) / rows;
  const sigmaX = 0.36;
  const sigmaY = 0.36;
  const eps = 1e-9;
  const shrinkStrength = 8;
  const runValue = (point: Record<string, unknown>): number => {
    const mapped = toNum(point.run_value);
    if (mapped !== null) return mapped;
    const pitchCall = String(point.pitch_call ?? '');
    const playResult = String(point.play_result ?? '');
    const korbb = String(point.korbb ?? '');
    if (korbb === 'Strikeout') return -0.27;
    if (korbb === 'Walk') return 0.33;
    if (pitchCall === 'BallCalled' || pitchCall === 'BallinDirt' || pitchCall === 'BallIntentional') return 0.03;
    if (pitchCall === 'StrikeCalled' || pitchCall === 'StrikeSwinging' || pitchCall === 'FoulBall' || pitchCall === 'FoulBallFieldable' || pitchCall === 'FoulBallNotFieldable') return -0.03;
    if (pitchCall === 'InPlay') {
      if (playResult === 'Single') return 0.47;
      if (playResult === 'Double') return 0.78;
      if (playResult === 'Triple') return 1.09;
      if (playResult === 'HomeRun') return 1.4;
      if (playResult === 'Error') return 0.33;
      return -0.27;
    }
    return 0;
  };
  const valid = points
    .map((p) => ({ p, x: toNum(p.plate_side), y: toNum(p.plate_height) }))
    .filter((row): row is { p: Record<string, unknown>; x: number; y: number } => row.x !== null && row.y !== null);
  if (!valid.length) return [];

  const isSwingCall = (call: string) =>
    call === 'StrikeSwinging' || call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable' || call === 'InPlay';
  const globalSwingCount = valid.filter((rowPoint) => isSwingCall(String(rowPoint.p.pitch_call ?? ''))).length;
  const globalWhiffCount = valid.filter((rowPoint) => String(rowPoint.p.pitch_call ?? '') === 'StrikeSwinging').length;
  const globalInPlayCount = valid.filter((rowPoint) => String(rowPoint.p.pitch_call ?? '') === 'InPlay').length;
  const globalCalledStrikeCount = valid.filter((rowPoint) => String(rowPoint.p.pitch_call ?? '') === 'StrikeCalled').length;
  const globalGbCount = valid.filter((rowPoint) => String(rowPoint.p.tagged_hit_type ?? '') === 'GroundBall').length;
  const globalEvRows = valid.filter((rowPoint) => String(rowPoint.p.pitch_call ?? '') === 'InPlay' && toNum(rowPoint.p.exit_speed) !== null);
  const globalQpRows = valid.filter((rowPoint) => toNum(rowPoint.p.qp_plus) !== null);
  const globalEvAvg = globalEvRows.length > 0 ? globalEvRows.reduce((sum, rowPoint) => sum + Number(toNum(rowPoint.p.exit_speed) ?? 0), 0) / globalEvRows.length : 0;
  const globalQpAvg = globalQpRows.length > 0 ? globalQpRows.reduce((sum, rowPoint) => sum + Number(toNum(rowPoint.p.qp_plus) ?? 0), 0) / globalQpRows.length : 100;
  const globalRvAvg = valid.length > 0 ? valid.reduce((sum, rowPoint) => sum + runValue(rowPoint.p), 0) / valid.length : 0;

  const globalSwingRate = valid.length > 0 ? globalSwingCount / valid.length : 0;
  const globalWhiffRate = globalSwingCount > 0 ? globalWhiffCount / globalSwingCount : 0;
  const globalGbRate = globalInPlayCount > 0 ? globalGbCount / globalInPlayCount : 0;
  const globalContactRate = globalSwingCount > 0 ? globalInPlayCount / globalSwingCount : 0;
  const globalCalledStrikeRate = valid.length > 0 ? globalCalledStrikeCount / valid.length : 0;

  const cells: HeatCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    const cy = yMin + (row + 0.5) * cellH;
    for (let col = 0; col < cols; col += 1) {
      const cx = xMin + (col + 0.5) * cellW;
      let sumW = 0;
      let swingW = 0;
      let whiffW = 0;
      let calledStrikeW = 0;
      let inPlayW = 0;
      let gbW = 0;
      let evWSum = 0;
      let evW = 0;
      let qpWSum = 0;
      let qpW = 0;
      let rvWSum = 0;

      for (const rowPoint of valid) {
        const dx = (cx - rowPoint.x) / sigmaX;
        const dy = (cy - rowPoint.y) / sigmaY;
        const w = Math.exp(-0.5 * (dx * dx + dy * dy));
        if (w < 1e-6) continue;
        const call = String(rowPoint.p.pitch_call ?? '');
        const swing = isSwingCall(call);
        const inPlay = call === 'InPlay';
        const gb = String(rowPoint.p.tagged_hit_type ?? '') === 'GroundBall';

        sumW += w;
        if (swing) swingW += w;
        if (call === 'StrikeSwinging') whiffW += w;
        if (call === 'StrikeCalled') calledStrikeW += w;
        if (inPlay) inPlayW += w;
        if (gb) gbW += w;
        if (inPlay) {
          const ev = toNum(rowPoint.p.exit_speed);
          if (ev !== null) {
            evWSum += w * ev;
            evW += w;
          }
        }
        const qp = toNum(rowPoint.p.qp_plus);
        if (qp !== null) {
          qpWSum += w * qp;
          qpW += w;
        }
        rvWSum += w * runValue(rowPoint.p);
      }

      let value = sumW;
      if (metric === 'Whiff Rate') value = 100 * ((whiffW + shrinkStrength * globalWhiffRate) / Math.max(eps, swingW + shrinkStrength));
      if (metric === 'GB Rate') value = 100 * ((gbW + shrinkStrength * globalGbRate) / Math.max(eps, inPlayW + shrinkStrength));
      if (metric === 'Contact Rate') value = 100 * ((inPlayW + shrinkStrength * globalContactRate) / Math.max(eps, swingW + shrinkStrength));
      if (metric === 'Swing Rate') value = 100 * ((swingW + shrinkStrength * globalSwingRate) / Math.max(eps, sumW + shrinkStrength));
      if (metric === 'Called Strike Rate') value = 100 * ((calledStrikeW + shrinkStrength * globalCalledStrikeRate) / Math.max(eps, sumW + shrinkStrength));
      if (metric === 'Exit Velocity') value = (evWSum + shrinkStrength * globalEvAvg) / Math.max(eps, evW + shrinkStrength);
      if (metric === 'QP+') value = (qpWSum + shrinkStrength * globalQpAvg) / Math.max(eps, qpW + shrinkStrength);
      if (metric === 'Run Values') value = (rvWSum + shrinkStrength * globalRvAvg) / Math.max(eps, sumW + shrinkStrength);
      cells.push({ x: xMin + col * cellW, y: yMin + row * cellH, w: cellW, h: cellH, value, density: sumW });
    }
  }
  if (metric === 'Frequency') {
    const maxVal = Math.max(...cells.map((c) => c.value), eps);
    for (const c of cells) c.value = (100 * c.value) / maxVal;
  }
  return cells;
}

function parseStoredGoalDescription(category: string | null, value: string | null, slotIndex: GoalSlot, createdAt: string | null): GoalDraft {
  const normalizedCategory =
    category === 'Command'
      ? 'Execution'
      : category && GOAL_CATEGORIES.includes(category as GoalCategory)
        ? (category as GoalCategory)
        : '';
  const defaultGoal: GoalDraft = {
    slotIndex,
    category: normalizedCategory,
    objectiveText: value ?? '',
    stuffType: '',
    movementAxis: '',
    executionStat: '',
    comparator: 'Greater Than',
    targetValue: '',
    chartType: 'Trend',
    heatmapView: 'Frequency',
    startDate: '',
    endDate: '',
    pitchTypes: ['All'],
    ballTypes: ['All'],
    pitchResults: ['All'],
    countOptions: ['All'],
    afterCountOptions: ['All'],
    teams: ['All'],
    hand: 'All',
    batterSide: 'All',
    sessionType: 'Season',
    createdAt,
  };
  if (!value) return defaultGoal;
  try {
    const parsed = JSON.parse(value) as GoalPayload;
    if (parsed?.schema !== 'pcu_goal_v2') return defaultGoal;
    return {
      ...defaultGoal,
      category: parsed.category && GOAL_CATEGORIES.includes(parsed.category) ? parsed.category : defaultGoal.category,
      objectiveText: String(parsed.objectiveText ?? ''),
      stuffType: parsed.stuffType === 'Velocity' || parsed.stuffType === 'Movement' ? parsed.stuffType : '',
      movementAxis: parsed.movementAxis === 'IVB' || parsed.movementAxis === 'HB' || parsed.movementAxis === 'IVB+HB' ? parsed.movementAxis : '',
      executionStat: String(parsed.executionStat ?? ''),
      comparator: parsed.comparator === 'Less Than' ? 'Less Than' : 'Greater Than',
      targetValue:
        parsed.targetValue === null || parsed.targetValue === undefined || Number.isNaN(Number(parsed.targetValue))
          ? ''
          : String(parsed.targetValue),
      chartType:
        parsed.chartType === 'Release' || parsed.chartType === 'Movement Plot' || parsed.chartType === 'Pitch Chart' || parsed.chartType === 'HeatMaps'
          ? parsed.chartType
          : 'Trend',
      heatmapView: parsed.heatmapView && HEATMAP_VIEW_OPTIONS.includes(parsed.heatmapView) ? parsed.heatmapView : 'Frequency',
      startDate: String(parsed.filters?.startDate ?? ''),
      endDate: String(parsed.filters?.endDate ?? ''),
      pitchTypes: parsed.filters?.pitchTypes?.length ? parsed.filters.pitchTypes : ['All'],
      ballTypes: parsed.filters?.ballTypes?.length ? parsed.filters.ballTypes : ['All'],
      pitchResults: parsed.filters?.pitchResults?.length ? parsed.filters.pitchResults : ['All'],
      countOptions: parsed.filters?.countOptions?.length ? parsed.filters.countOptions : ['All'],
      afterCountOptions: parsed.filters?.afterCountOptions?.length ? parsed.filters.afterCountOptions : ['All'],
      teams: parsed.filters?.teams?.length ? parsed.filters.teams : ['All'],
      hand: String(parsed.filters?.hand ?? 'All') || 'All',
      batterSide: String(parsed.filters?.batterSide ?? 'All') || 'All',
      sessionType: String(parsed.filters?.sessionType ?? 'Season') || 'Season',
    };
  } catch {
    return defaultGoal;
  }
}

function serializeGoalDescription(goal: GoalDraft): string {
  const payload: GoalPayload = {
    schema: 'pcu_goal_v2',
    category: goal.category as GoalCategory,
    objectiveText: goal.objectiveText.trim(),
    stuffType: goal.stuffType,
    movementAxis: goal.movementAxis,
    executionStat: goal.executionStat.trim(),
    comparator: goal.comparator,
    targetValue: goal.targetValue.trim() ? Number(goal.targetValue) : null,
    chartType: goal.chartType,
    heatmapView: goal.heatmapView,
    filters: {
      startDate: goal.startDate,
      endDate: goal.endDate,
      pitchTypes: goal.pitchTypes,
      ballTypes: goal.ballTypes,
      pitchResults: goal.pitchResults,
      countOptions: goal.countOptions,
      afterCountOptions: goal.afterCountOptions,
      teams: goal.teams,
      hand: goal.hand,
      batterSide: goal.batterSide,
      sessionType: goal.sessionType,
    },
  };
  return JSON.stringify(payload);
}

function goalSummary(goal: GoalDraft): string {
  if (goal.category === 'Stuff') {
    const metric =
      goal.stuffType === 'Movement'
        ? `Movement ${goal.movementAxis || ''}`.trim()
        : goal.stuffType === 'Velocity'
          ? 'Velocity'
          : 'Stuff';
    const comparator = goal.comparator === 'Less Than' ? '<' : '>';
    return `${metric} ${comparator} ${goal.targetValue || '?'} ${goal.objectiveText ? `| ${goal.objectiveText}` : ''}`.trim();
  }
  if (goal.category === 'Execution' || goal.category === 'Hitting Stats') {
    const comparator = goal.comparator === 'Less Than' ? '<' : '>';
    return `${goal.executionStat || 'Stat'} ${comparator} ${goal.targetValue || '?'} ${goal.objectiveText ? `| ${goal.objectiveText}` : ''}`.trim();
  }
  return goal.objectiveText.trim();
}

function goalTypeLabel(goal: GoalDraft): string {
  if (goal.category === 'Stuff') {
    if (goal.stuffType === 'Movement') return `Movement${goal.movementAxis ? ` (${goal.movementAxis})` : ''}`;
    if (goal.stuffType === 'Velocity') return 'Velocity';
    return 'Stuff';
  }
  if (goal.category === 'Execution' || goal.category === 'Hitting Stats') return goal.executionStat || 'Stat';
  return goal.objectiveText.trim() ? `Note: ${goal.objectiveText.trim()}` : 'Note';
}

function isChartCapableGoal(goal: GoalDraft, domain: Domain): boolean {
  if (goal.category === 'Stuff') return domain === 'Pitching';
  if (goal.category === 'Execution') return domain === 'Pitching' || domain === 'Catching';
  if (goal.category === 'Hitting Stats') return domain === 'Hitting';
  return false;
}

function goalMetricValue(goal: GoalDraft, point: Record<string, unknown>): number | null {
  const num = (...keys: string[]) => {
    for (const key of keys) {
      const value = toNum(point[key]);
      if (value !== null) return value;
    }
    return null;
  };
  if (goal.category === 'Stuff') {
    if (goal.stuffType === 'Velocity') return num('velo', 'rel_speed');
    if (goal.stuffType === 'Movement') {
      if (goal.movementAxis === 'IVB') return num('ivb');
      if (goal.movementAxis === 'HB') return num('hb');
      if (goal.movementAxis === 'IVB+HB') {
        const ivb = num('ivb');
        const hb = num('hb');
        if (ivb === null || hb === null) return null;
        return (ivb + hb) / 2;
      }
    }
    return num('velo', 'rel_speed');
  }
  const key = normalizeExecutionStatKey(goal.executionStat);
  if (key === 'velocity' || key === 'velo') return num('velo', 'rel_speed');
  if (key === 'ivb') return num('ivb');
  if (key === 'hb') return num('hb');
  if (key === 'extension' || key === 'ext') return num('extension', 'ext_value');
  if (key === 'releaseheight' || key === 'height') return num('release_height', 'rel_height');
  if (key === 'releaseside' || key === 'side') return num('release_side', 'rel_side');
  if (key === 'spinrate' || key === 'spin') return num('spin_rate', 'spin');
  if (key === 'ev') return num('exit_speed');
  if (key === 'la') return num('angle');
  if (key === 'qp') return num('qp_plus');
  if (key === 'rv100') return num('run_value');
  if (key === 'max') return num('velo', 'rel_speed');
  return null;
}

function buildGoalMetricSeries(goal: GoalDraft, points: Array<Record<string, unknown>>): Array<{ date: string; value: number }> {
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const point of points) {
    const date = String(point.session_date ?? '').trim();
    if (!date) continue;
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date)?.push(point);
  }
  const avgFrom = (rows: Array<Record<string, unknown>>, ...keys: string[]): number | null => {
    const nums: number[] = [];
    for (const row of rows) {
      for (const key of keys) {
        const value = toNum(row[key]);
        if (value !== null) {
          nums.push(value);
          break;
        }
      }
    }
    if (!nums.length) return null;
    return nums.reduce((sum, v) => sum + v, 0) / nums.length;
  };
  const pct = (num: number, den: number): number | null => (den > 0 ? (100 * num) / den : null);
  const isStrike = (call: string): boolean =>
    call === 'StrikeCalled' || call === 'StrikeSwinging' || call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable' || call === 'InPlay';
  const isSwing = (call: string): boolean =>
    call === 'StrikeSwinging' || call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable' || call === 'InPlay';
  const isWhiff = (call: string): boolean => call === 'StrikeSwinging';
  const basesForPlay = (play: string): number => {
    if (play === 'Single') return 1;
    if (play === 'Double') return 2;
    if (play === 'Triple') return 3;
    if (play === 'HomeRun') return 4;
    return 0;
  };

  const rows = Array.from(grouped.entries())
    .map(([date, dayRows]) => {
      if (goal.category === 'Stuff') {
        const values = dayRows.map((row) => goalMetricValue(goal, row)).filter((v): v is number => v !== null);
        const value = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
        return value === null ? null : { date, value };
      }

      const key = normalizeExecutionStatKey(goal.executionStat);
      if (key === 'velocity' || key === 'velo') {
        const value = avgFrom(dayRows, 'velo', 'rel_speed');
        return value === null ? null : { date, value };
      }
      if (key === 'max') {
        const values = dayRows.map((row) => toNum(row.velo) ?? toNum(row.rel_speed)).filter((v): v is number => v !== null);
        if (!values.length) return null;
        return { date, value: Math.max(...values) };
      }
      if (key === 'ivb') {
        const value = avgFrom(dayRows, 'ivb');
        return value === null ? null : { date, value };
      }
      if (key === 'hb') {
        const value = avgFrom(dayRows, 'hb');
        return value === null ? null : { date, value };
      }
      if (key === 'extension' || key === 'ext') {
        const value = avgFrom(dayRows, 'extension', 'ext_value');
        return value === null ? null : { date, value };
      }
      if (key === 'releaseheight' || key === 'height') {
        const value = avgFrom(dayRows, 'release_height', 'rel_height');
        return value === null ? null : { date, value };
      }
      if (key === 'releaseside' || key === 'side') {
        const value = avgFrom(dayRows, 'release_side', 'rel_side');
        return value === null ? null : { date, value };
      }
      if (key === 'spinrate' || key === 'spin') {
        const value = avgFrom(dayRows, 'spin_rate', 'spin');
        return value === null ? null : { date, value };
      }
      if (key === 'ev') {
        const value = avgFrom(dayRows, 'exit_speed');
        return value === null ? null : { date, value };
      }
      if (key === 'la') {
        const value = avgFrom(dayRows, 'angle');
        return value === null ? null : { date, value };
      }
      if (key === 'qp' || key === 'qpplus') {
        const value = avgFrom(dayRows, 'qp_plus');
        return value === null ? null : { date, value };
      }

      const calledStrikes = dayRows.filter((row) => String(row.pitch_call ?? '') === 'StrikeCalled').length;
      const swings = dayRows.filter((row) => isSwing(String(row.pitch_call ?? ''))).length;
      const whiffs = dayRows.filter((row) => isWhiff(String(row.pitch_call ?? ''))).length;
      const strikes = dayRows.filter((row) => isStrike(String(row.pitch_call ?? ''))).length;
      const takes = dayRows.filter((row) => {
        const call = String(row.pitch_call ?? '');
        return call === 'BallCalled' || call === 'StrikeCalled' || call === 'Ball';
      }).length;
      const strikeLeft = -0.88;
      const strikeRight = 0.88;
      const strikeBottom = 1.5;
      const strikeTop = 3.6;
      const strikeMidX = (strikeLeft + strikeRight) / 2;
      const strikeMidY = (strikeBottom + strikeTop) / 2;
      const greenHalf = 7 / 24;
      const greenLeft = strikeMidX - greenHalf;
      const greenRight = strikeMidX + greenHalf;
      const greenBottom = strikeMidY - greenHalf;
      const greenTop = strikeMidY + greenHalf;
      let chaseDen = 0;
      let chaseNum = 0;
      let goZoneDen = 0;
      let goZoneSwNum = 0;
      let izDen = 0;
      let izSwNum = 0;
      let edgeDen = 0;
      let edgeSwNum = 0;
      let posSdPoints = 0;
      for (const row of dayRows) {
        const x = toNum(row.plate_side);
        const y = toNum(row.plate_height);
        if (x === null || y === null) continue;
        const swing = isSwing(String(row.pitch_call ?? ''));
        const inZone = x >= strikeLeft && x <= strikeRight && y >= strikeBottom && y <= strikeTop;
        const green = x >= greenLeft && x <= greenRight && y >= greenBottom && y <= greenTop;
        const outside = !inZone;
        const edge = inZone && !green;
        if (outside) {
          chaseDen += 1;
          if (swing) chaseNum += 1;
        }
        if (green) {
          goZoneDen += 1;
          if (swing) goZoneSwNum += 1;
        }
        if (inZone) {
          izDen += 1;
          if (swing) izSwNum += 1;
        }
        if (edge) {
          edgeDen += 1;
          if (swing) edgeSwNum += 1;
        }
        if ((swing && green) || (!swing && outside)) posSdPoints += 1;
      }
      let locN = 0;
      let compN = 0;
      for (const row of dayRows) {
        const x = toNum(row.plate_side);
        const y = toNum(row.plate_height);
        if (x === null || y === null) continue;
        locN += 1;
        const label = inZoneLabel(x, y);
        if (label === 'Yes' || label === 'Competitive') compN += 1;
      }
      const fpsDen = dayRows.filter((row) => toNum(row.balls_num) === 0 && toNum(row.strikes_num) === 0).length;
      const fpsNum = dayRows.filter((row) => toNum(row.balls_num) === 0 && toNum(row.strikes_num) === 0 && isStrike(String(row.pitch_call ?? ''))).length;
      const earlyDen = dayRows.filter((row) => {
        const b = toNum(row.balls_num);
        const s = toNum(row.strikes_num);
        return b !== null && s !== null && b + s <= 1;
      }).length;
      const earlyNum = dayRows.filter((row) => {
        const b = toNum(row.balls_num);
        const s = toNum(row.strikes_num);
        return b !== null && s !== null && b + s <= 1 && isStrike(String(row.pitch_call ?? ''));
      }).length;
      const aheadDen = dayRows.filter((row) => {
        const b = toNum(row.balls_num);
        const s = toNum(row.strikes_num);
        return b !== null && s !== null && s > b;
      }).length;
      const aheadNum = dayRows.filter((row) => {
        const b = toNum(row.balls_num);
        const s = toNum(row.strikes_num);
        return b !== null && s !== null && s > b && isStrike(String(row.pitch_call ?? ''));
      }).length;
      const eaDen = dayRows.filter((row) => {
        const b = toNum(row.balls_num);
        const s = toNum(row.strikes_num);
        return b !== null && s !== null && (b + s <= 1 || s > b);
      }).length;
      const eaNum = dayRows.filter((row) => {
        const b = toNum(row.balls_num);
        const s = toNum(row.strikes_num);
        return b !== null && s !== null && (b + s <= 1 || s > b) && isStrike(String(row.pitch_call ?? ''));
      }).length;
      const oneOneDen = dayRows.filter((row) => toNum(row.balls_num) === 1 && toNum(row.strikes_num) === 1).length;
      const oneOneNum = dayRows.filter((row) => toNum(row.balls_num) === 1 && toNum(row.strikes_num) === 1 && isStrike(String(row.pitch_call ?? ''))).length;
      const qpVals = dayRows.map((row) => toNum(row.qp_plus)).filter((v): v is number => v !== null);
      const qpNum = qpVals.filter((v) => v >= 100).length;
      const inPlays = dayRows.filter((row) => String(row.pitch_call ?? '') === 'InPlay');
      const inPlayN = inPlays.length;
      const gbN = inPlays.filter((row) => String(row.tagged_hit_type ?? '').toLowerCase() === 'groundball').length;
      const hardHitN = inPlays.filter((row) => {
        const ev = toNum(row.exit_speed);
        return ev !== null && ev >= 95;
      }).length;
      const zoneN = dayRows.filter((row) => {
        const x = toNum(row.plate_side);
        const y = toNum(row.plate_height);
        return inZoneLabel(x, y) === 'Yes';
      }).length;
      // Approximate batting outcomes from terminal pitches in this date bucket.
      let ab = 0;
      let hits = 0;
      let totalBases = 0;
      let bb = 0;
      let hbp = 0;
      let sf = 0;
      const bfKeys = new Set<string>();
      const kKeys = new Set<string>();
      const bbKeys = new Set<string>();
      let singles = 0;
      let doubles = 0;
      let triples = 0;
      let homers = 0;
      for (const row of dayRows) {
        const call = String(row.pitch_call ?? '');
        const play = String(row.play_result ?? '');
        const korbb = String(row.korbb ?? '');
        const paKey = `${String(row.game_id ?? row.game_uid ?? row.game_foreign_id ?? 'g')}|${String(row.play_id ?? row.pitch_event_id ?? row.pitch_number ?? '')}`;
        if (paKey.trim() !== 'g|') bfKeys.add(paKey);
        if (korbb === 'Walk') {
          bb += 1;
          bbKeys.add(paKey);
          continue;
        }
        if (call === 'HitByPitch' || play === 'HitByPitch') {
          hbp += 1;
          continue;
        }
        if (korbb === 'Strikeout') {
          ab += 1;
          kKeys.add(paKey);
          continue;
        }
        if (call === 'InPlay') {
          if (play === 'Sacrifice') {
            sf += 1;
            continue;
          }
          ab += 1;
          const bases = basesForPlay(play);
          if (bases > 0) {
            hits += 1;
            totalBases += bases;
            if (play === 'Single') singles += 1;
            if (play === 'Double') doubles += 1;
            if (play === 'Triple') triples += 1;
            if (play === 'HomeRun') homers += 1;
          }
          continue;
        }
      }
      const avg = ab > 0 ? hits / ab : null;
      const slg = ab > 0 ? totalBases / ab : null;
      const iso = avg !== null && slg !== null ? slg - avg : null;
      const obpDen = ab + bb + hbp + sf;
      const obp = obpDen > 0 ? (hits + bb + hbp) / obpDen : null;
      const ops = obp !== null && slg !== null ? obp + slg : null;
      const kCount = kKeys.size ? Number(kKeys.size) : dayRows.filter((row) => String(row.korbb ?? '') === 'Strikeout').length;
      const babipDen = ab - kCount - homers + sf;
      const babip = babipDen > 0 ? (hits - homers) / babipDen : null;
      const wobaDen = ab + bb + hbp + sf;
      const woba = wobaDen > 0 ? (0.69 * bb + 0.72 * hbp + 0.88 * singles + 1.247 * doubles + 1.578 * triples + 2.031 * homers) / wobaDen : null;
      const xwobaValues = dayRows
        .map((row) => toNum(row.xwoba) ?? toNum(row.xwoba_value) ?? toNum(row.estimated_woba_using_speedangle))
        .filter((value): value is number => value !== null);
      const xwoba = xwobaValues.length ? xwobaValues.reduce((sum, v) => sum + v, 0) / xwobaValues.length : null;
      const xiso =
        avgFrom(dayRows, 'xiso') ??
        (() => {
          const xslg = avgFrom(dayRows, 'xslg');
          const xavg = avgFrom(dayRows, 'xavg');
          if (xslg === null || xavg === null) return null;
          return xslg - xavg;
        })();

      const metricValueMap: Record<string, number | null> = {
        strikepct: pct(strikes, dayRows.length),
        zonepct: pct(zoneN, dayRows.length),
        inzonepct: pct(zoneN, dayRows.length),
        cswpct: pct(calledStrikes + whiffs, dayRows.length),
        whiffpct: pct(whiffs, swings),
        swingpct: pct(swings, dayRows.length),
        takepct: pct(takes, dayRows.length),
        chasepct: pct(chaseNum, chaseDen),
        gozoneswpct: pct(goZoneSwNum, goZoneDen),
        izswingpct: pct(izSwNum, izDen),
        edgeswingpct: pct(edgeSwNum, edgeDen),
        possdpct: pct(posSdPoints, dayRows.length),
        calledstrikepct: pct(calledStrikes, dayRows.length),
        calledspct: pct(calledStrikes, dayRows.length),
        gbpct: pct(gbN, inPlayN),
        barrelpct: pct(
          inPlays.filter((row) => {
            const ev = toNum(row.exit_speed);
            const la = toNum(row.angle);
            return ev !== null && la !== null && ev >= 98 && la >= 26 && la <= 30;
          }).length,
          inPlayN
        ),
        hardhitpct: pct(hardHitN, inPlayN),
        comppct: pct(compN, locN),
        fpspct: pct(fpsNum, fpsDen),
        earlypct: pct(earlyNum, earlyDen),
        aheadpct: pct(aheadNum, aheadDen),
        eapct: pct(eaNum, eaDen),
        '11wpct': pct(oneOneNum, oneOneDen),
        qppct: pct(qpNum, qpVals.length),
        k: kCount,
        bb: bbKeys.size ? Number(bbKeys.size) : dayRows.filter((row) => String(row.korbb ?? '') === 'Walk').length,
        whiffs,
        p: dayRows.length,
        bf: bfKeys.size > 0 ? bfKeys.size : null,
        kpct: pct(kKeys.size, bfKeys.size),
        bbpct: pct(bbKeys.size, bfKeys.size),
        rv100: dayRows.length
          ? (dayRows.reduce((sum, row) => {
              const rv = toNum(row.run_value);
              if (rv !== null) return sum + rv;
              return sum;
            }, 0) /
              dayRows.length) *
            100
          : null,
        avg,
        slg,
        iso,
        woba,
        xwoba,
        xiso,
        obp,
        ops,
        babip,
      };
      const value = metricValueMap[key] ?? null;
      return value === null ? null : { date, value };
    })
    .filter((row): row is { date: string; value: number } => row !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  return rows;
}

function goalStatLabel(goal: GoalDraft): string {
  if (goal.category === 'Stuff') {
    if (goal.stuffType === 'Movement') return goal.movementAxis || 'Movement';
    return goal.stuffType || 'Stuff';
  }
  return goal.executionStat || 'Stat';
}

function fmtGoalValueForGoal(goal: GoalDraft, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  const statLabel = goalStatLabel(goal).trim();
  const upper = statLabel.toUpperCase();
  const threeDecimalStats = new Set(['AVG', 'SLG', 'OBP', 'OPS', 'WOBA', 'XWOBA', 'ISO', 'XISO', 'BABIP']);
  if (threeDecimalStats.has(upper)) return formatTableDisplayValue(upper, value);
  if (statLabel.includes('%')) return `${value.toFixed(1)}%`;
  if (upper === 'SPIN RATE') return String(Math.round(value));
  if (upper === 'VELOCITY' || upper === 'HB' || upper === 'IVB' || upper === 'EXTENSION' || upper === 'RELEASE HEIGHT' || upper === 'RELEASE SIDE') {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

function goalUnit(goal: GoalDraft): string {
  const statLabel = goalStatLabel(goal).trim().toUpperCase();
  if (statLabel.includes('%')) return '';
  if (statLabel === 'VELOCITY') return 'mph';
  if (statLabel === 'IVB' || statLabel === 'HB') return '"';
  if (statLabel === 'SPIN RATE') return 'rpm';
  if (statLabel === 'EXTENSION' || statLabel === 'RELEASE HEIGHT' || statLabel === 'RELEASE SIDE') return 'ft';
  return '';
}

function formatGoalValueWithUnit(goal: GoalDraft, value: number | null): string {
  const base = fmtGoalValueForGoal(goal, value);
  if (base === '-') return base;
  const unit = goalUnit(goal);
  if (!unit) return base;
  return `${base} ${unit}`;
}

function formatGoalTargetWithUnit(goal: GoalDraft): string {
  const raw = goal.targetValue.trim();
  if (!raw) return '-';
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return formatGoalValueWithUnit(goal, n);
}

function goalMeetsTarget(goal: GoalDraft, value: number | null, target: number | null): boolean | null {
  if (value === null || target === null || !Number.isFinite(value) || !Number.isFinite(target)) return null;
  return goal.comparator === 'Less Than' ? value < target : value > target;
}

function nonAll(values: string[]): string[] {
  return values.filter((value) => String(value ?? '').trim().length > 0 && value !== 'All');
}

function buildChartGoalHeadline(goal: GoalDraft): string {
  const direction = goal.comparator === 'Less Than' ? 'Decrease' : 'Increase';
  const statLabel = goalStatLabel(goal);
  const pitchTypes = nonAll(goal.pitchTypes);
  const pitchTypePhrase = pitchTypes.length === 1 ? `${pitchTypes[0]} ` : '';
  const targetPhrase = formatGoalTargetWithUnit(goal);
  const parts: string[] = [];
  if (pitchTypes.length > 1) parts.push(`for ${pitchTypes.join(', ')}`);
  const pitchResults = nonAll(goal.pitchResults);
  if (pitchResults.length) parts.push(`on ${pitchResults.join(', ')} results`);
  if (goal.batterSide === 'Left') parts.push('against LHH');
  if (goal.batterSide === 'Right') parts.push('against RHH');
  if (goal.hand === 'Left') parts.push('vs LHP');
  if (goal.hand === 'Right') parts.push('vs RHP');
  const countValues = nonAll(goal.countOptions);
  if (countValues.length) parts.push(`in ${countValues.join(', ')} counts`);
  const afterCountValues = nonAll(goal.afterCountOptions);
  if (afterCountValues.length) parts.push(`after ${afterCountValues.join(', ')} counts`);
  const teams = nonAll(goal.teams);
  if (teams.length) parts.push(`for team filter ${teams.join(', ')}`);
  const filterSuffix = parts.length ? ` ${parts.join(' ')}` : '';
  return `${direction} ${pitchTypePhrase}${statLabel} to ${targetPhrase}${filterSuffix}`.replace(/\s+/g, ' ').trim();
}

function SearchableSingleSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: OptionItem[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="portal-search-select" ref={rootRef}>
      <button type="button" className="portal-search-select-trigger" onClick={() => setOpen((current) => !current)}>
        {selected?.label ?? placeholder ?? 'Select'}
      </button>
      {open ? (
        <div className="portal-search-select-menu">
          <input
            className="portal-search-select-input"
            placeholder="Type to filter..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="portal-search-select-options">
            {filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                className="portal-search-select-option"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SearchableMultiSelect({
  options,
  values,
  onChange,
}: {
  options: OptionItem[];
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selectedLabels = options.filter((option) => values.includes(option.value)).map((option) => option.label);
  const triggerText =
    values.includes('All') || values.length === 0
      ? 'All'
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : `${selectedLabels.length} selected`;

  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));

  const toggle = (value: string) => {
    if (value === 'All') {
      onChange(['All']);
      return;
    }
    const current = values.filter((entry) => entry !== 'All');
    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
    onChange(normalizeMulti(next));
  };

  return (
    <div className="portal-search-select" ref={rootRef}>
      <button type="button" className="portal-search-select-trigger" onClick={() => setOpen((current) => !current)}>
        {triggerText}
      </button>
      {open ? (
        <div className="portal-search-select-menu">
          <input
            className="portal-search-select-input"
            placeholder="Type to filter..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="portal-search-select-options">
            {filtered.map((option) => {
              const checked = values.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className="portal-search-select-option portal-search-select-option-multi"
                  onClick={() => toggle(option.value)}
                >
                  <span>{checked ? '✓' : ''}</span>
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function PlayerPlansSuite(props: { selectedSchoolCode?: string }) {
  const pageRef = useRef<HTMLElement | null>(null);
  const goalsExportRef = useRef<HTMLDivElement | null>(null);
  const searchParams = useSearchParams();
  const deepLinkedPlayerId = Number(searchParams.get('playerPlanPlayerId') ?? 0);
  const selectedSchoolCode = String(props.selectedSchoolCode ?? '').trim().toUpperCase();
  const [domain, setDomain] = useState<Domain>('Pitching');
  const [linkedPlayers, setLinkedPlayers] = useState<PlayerOption[]>([]);
  const [dashboardPlayerOptions, setDashboardPlayerOptions] = useState<string[]>([]);
  const [selectedPlayerName, setSelectedPlayerName] = useState('');
  const [playerInputName, setPlayerInputName] = useState('');
  const [headerNote, setHeaderNote] = useState('');
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [loadingGoals, setLoadingGoals] = useState(false);
  const [message, setMessage] = useState('');
  const [goalSavingSlot, setGoalSavingSlot] = useState<GoalSlot | null>(null);
  const [planGoals, setPlanGoals] = useState<GoalDraft[]>([1, 2, 3].map((slot) => parseStoredGoalDescription(null, null, slot as GoalSlot, null)));
  const [filterOptions, setFilterOptions] = useState<DashboardFilterOptions>({
    pitchers: ['All'],
    hitters: ['All'],
    catchers: ['All'],
    pitch_types: ['All'],
    ball_types: ['All'],
    pitch_results: ['All'],
    count_options: ['All'],
    after_count_options: ['All'],
    team_types: ['All'],
    hands: ['All'],
    batter_sides: ['All'],
  });
  const [goalCharts, setGoalCharts] = useState<Record<GoalSlot, GoalChartState>>({
    1: { loading: false, error: '', points: [] },
    2: { loading: false, error: '', points: [] },
    3: { loading: false, error: '', points: [] },
  });
  const [domainExecutionStats, setDomainExecutionStats] = useState<string[]>(DOMAIN_EXECUTION_FALLBACKS.Pitching);
  const [goalControlsVisible, setGoalControlsVisible] = useState<Record<GoalSlot, boolean>>({ 1: true, 2: true, 3: true });
  const [goalCount, setGoalCount] = useState<1 | 2 | 3>(3);
  const [goalChartHover, setGoalChartHover] = useState<{ x: number; y: number; text: string; bg?: string } | null>(null);
  const [goalStatPage, setGoalStatPage] = useState<Record<GoalSlot, number>>({ 1: 0, 2: 0, 3: 0 });
  const [planMode, setPlanMode] = useState<PlanMode>('Manual');
  const [planFiltersVisible, setPlanFiltersVisible] = useState(true);
  const [summaryMode, setSummaryMode] = useState<SummaryMode>('automated');
  const [manualSummaryNote, setManualSummaryNote] = useState('');
  const [isExportingPlanPdf, setIsExportingPlanPdf] = useState(false);
  const automationPercentileSource = 'NCAA';
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationLinkedPlayerId, setAutomationLinkedPlayerId] = useState('');
  const [automationSessionType, setAutomationSessionType] = useState('Season');
  const [automationStuffBase, setAutomationStuffBase] = useState<'Fastball' | 'Sinker'>('Fastball');
  const [automationStartDate, setAutomationStartDate] = useState('');
  const [automationEndDate, setAutomationEndDate] = useState('');
  const [automationTree, setAutomationTree] = useState<AutomatedTreeData | null>(null);
  const [automationTreeLoading, setAutomationTreeLoading] = useState(false);
  const [automationTreeError, setAutomationTreeError] = useState('');

  const centeredName = useMemo(() => formatNameFirstLast(selectedPlayerName), [selectedPlayerName]);
  const selectedDashboardPlayerName = useMemo(() => {
    const candidates =
      domain === 'Pitching'
        ? filterOptions.pitchers ?? []
        : domain === 'Hitting'
          ? filterOptions.hitters ?? []
          : filterOptions.catchers ?? [];
    return resolveDashboardPlayerName(selectedPlayerName, candidates);
  }, [domain, filterOptions.catchers, filterOptions.hitters, filterOptions.pitchers, selectedPlayerName]);
  const selectedPlayerId = useMemo(() => {
    const candidates = playerNameQueryCandidates(selectedPlayerName, selectedDashboardPlayerName);
    const normalizedCandidates = new Set(candidates.map((name) => normalizePersonName(name)).filter(Boolean));
    const firstLastCandidates = new Set(candidates.map((name) => firstLastKey(name)).filter(Boolean));
    const linked = linkedPlayers.find((player) => {
      const full = player.fullName ?? '';
      const normalizedLinked = normalizePersonName(full);
      const firstLastLinked = firstLastKey(full);
      if (normalizedCandidates.has(normalizedLinked) || firstLastCandidates.has(firstLastLinked)) return true;
      for (const candidate of normalizedCandidates) {
        if (!candidate || !normalizedLinked) continue;
        if (normalizedLinked.startsWith(candidate) || candidate.startsWith(normalizedLinked)) return true;
      }
      return false;
    });
    return linked?.playerId ?? 0;
  }, [linkedPlayers, selectedDashboardPlayerName, selectedPlayerName]);
  const playerQueryCandidates = useMemo(
    () => playerNameQueryCandidates(selectedPlayerName, selectedDashboardPlayerName),
    [selectedDashboardPlayerName, selectedPlayerName]
  );
  const automatedGoals = useMemo(
    () => planGoals.filter((goal) => Boolean(goal.category && (goal.objectiveText.trim() || goal.executionStat.trim() || goal.targetValue.trim()))),
    [planGoals]
  );
  const automationSummaryNote = useMemo(() => {
    if (!automationTree) return '';
    const fmt = (v: number | null, kind: 'pct' | 'plus' = 'pct') => formatMetricValue(v, kind).replace('--', 'N/A');
    const left = automationTree.left;
    const right = automationTree.right;

    const overallKRank = overallRankLabel('k', automationTree.overallK.value);
    const overallBBRank = overallRankLabel('bb', automationTree.overallBB.value);

    const kLeftColor = treeMetricColor('k', left.kPct.value);
    const kRightColor = treeMetricColor('k', right.kPct.value);
    const bbLeftColor = treeMetricColor('bb', left.bbPct.value);
    const bbRightColor = treeMetricColor('bb', right.bbPct.value);

    const kNeedsLeft = isTreeRed(kLeftColor);
    const kNeedsRight = isTreeRed(kRightColor);
    const bbNeedsLeft = isTreeRed(bbLeftColor);
    const bbNeedsRight = isTreeRed(bbRightColor);

    const pickRedPitch = (
      rows: AutomatedTreePitchMetric[],
      metric: 'whiff' | 'stuff' | 'strike' | 'inZone',
      colorMetric: 'whiff_pitch' | 'stuff_pitch' | 'strike' | 'inzone'
    ): AutomatedTreePitchMetric | null => {
      const red = rows
        .filter((row) => {
          const value = metric === 'whiff' ? row.whiff.value : metric === 'stuff' ? row.stuff.value : metric === 'strike' ? row.strike.value : row.inZone.value;
          return isTreeRed(treeMetricColor(colorMetric, value, row.pitch));
        })
        .sort((a, b) => (b.usage.value ?? 0) - (a.usage.value ?? 0));
      return red[0] ?? null;
    };

    const kSideFocus = kNeedsLeft ? 'Left' : kNeedsRight ? 'Right' : null;
    const bbSideFocus = bbNeedsLeft ? 'Left' : bbNeedsRight ? 'Right' : null;
    const kData = kSideFocus === 'Left' ? left : kSideFocus === 'Right' ? right : null;
    const bbData = bbSideFocus === 'Left' ? left : bbSideFocus === 'Right' ? right : null;

    const kWhiffRed = kData ? isTreeRed(treeMetricColor('whiff_overall', kData.whiffPct.value)) : false;
    const kStuffRed = kData
      ? isTreeRed(treeMetricColor('stuff_overall', weightedMetricFromPitches(kData.pitchesAll, 'stuff')))
      : false;
    const kWhiffPitch = kData ? pickRedPitch(kData.pitchesAll, 'whiff', 'whiff_pitch') : null;
    const kStuffPitch = kData ? pickRedPitch(kData.pitchesAll, 'stuff', 'stuff_pitch') : null;

    const bbFpsRed = bbData ? isTreeRed(treeMetricColor('fps', bbData.fpsPct.value)) : false;
    const bbEaRed = bbData ? isTreeRed(metricColor(bbData.eaPct.value, bbData.eaPct.avg, false)) : false;
    const bbStrikePitch = bbData ? pickRedPitch(bbData.pitches00, 'strike', 'strike') : null;
    const bbInZonePitch = bbData ? pickRedPitch(bbData.pitchesAll, 'inZone', 'inzone') : null;

    let handednessLine = '';
    if (!kNeedsLeft && !kNeedsRight && !bbNeedsLeft && !bbNeedsRight) {
      handednessLine = `By batter handedness, both LHH and RHH splits are currently performing above baseline in the core outcomes (K% and BB%), which indicates strong run-prevention shape across both sides.`;
    } else {
      const kPart = kNeedsLeft || kNeedsRight
        ? `K% needs the most support vs ${kNeedsLeft && kNeedsRight ? 'both LHH and RHH' : kNeedsLeft ? 'LHH' : 'RHH'}`
        : 'K% is stable across both handedness splits';
      const bbPart = bbNeedsLeft || bbNeedsRight
        ? `BB% needs the most support vs ${bbNeedsLeft && bbNeedsRight ? 'both LHH and RHH' : bbNeedsLeft ? 'LHH' : 'RHH'}`
        : 'BB% is stable across both handedness splits';
      handednessLine = `By batter handedness, ${kPart}, while ${bbPart}.`;
    }

    const improvementLines: string[] = [];
    if (kData && (kWhiffRed || kStuffRed || kWhiffPitch || kStuffPitch)) {
      const branchFocus = kWhiffRed
        ? `the Whiff% branch (${fmt(kData.whiffPct.value)})`
        : kStuffRed
          ? `the Stuff+ branch (${fmt(weightedMetricFromPitches(kData.pitchesAll, 'stuff'), 'plus')})`
          : 'execution quality under the K% path';
      const pitchFocus = kWhiffPitch
        ? `${kWhiffPitch.pitch} whiff (${fmt(kWhiffPitch.whiff.value)})`
        : kStuffPitch
          ? `${kStuffPitch.pitch} Stuff+ (${fmt(kStuffPitch.stuff.value, 'plus')})`
          : '';
      improvementLines.push(`Within the K% tree, the priority is ${branchFocus} vs ${kSideFocus === 'Left' ? 'LHH' : 'RHH'}${pitchFocus ? `, led by ${pitchFocus}` : ''}.`);
    }
    if (bbData && (bbFpsRed || bbEaRed || bbStrikePitch || bbInZonePitch)) {
      const branchFocus = bbFpsRed
        ? `the FPS% branch (${fmt(bbData.fpsPct.value)})`
        : bbEaRed
          ? `the E+A% branch (${fmt(bbData.eaPct.value)})`
          : 'first-pitch and strike quality in the BB% path';
      const pitchFocus = bbStrikePitch
        ? `${bbStrikePitch.pitch} strike% on 0-0 counts (${fmt(bbStrikePitch.strike.value)})`
        : bbInZonePitch
          ? `${bbInZonePitch.pitch} in-zone rate (${fmt(bbInZonePitch.inZone.value)})`
          : '';
      improvementLines.push(`Within the BB% tree, the priority is ${branchFocus} vs ${bbSideFocus === 'Left' ? 'LHH' : 'RHH'}${pitchFocus ? `, with the largest pressure point in ${pitchFocus}` : ''}.`);
    }
    if (!improvementLines.length) {
      const lightRedWhiff = pickRedPitch([...left.pitchesAll, ...right.pitchesAll], 'whiff', 'whiff_pitch');
      const lightRedStuff = pickRedPitch([...left.pitchesAll, ...right.pitchesAll], 'stuff', 'stuff_pitch');
      if (lightRedWhiff || lightRedStuff) {
        const pitchFocus = lightRedWhiff
          ? `${lightRedWhiff.pitch} whiff efficiency (${fmt(lightRedWhiff.whiff.value)})`
          : `${lightRedStuff?.pitch ?? 'a secondary pitch'} Stuff+ shape (${fmt(lightRedStuff?.stuff.value ?? null, 'plus')})`;
        improvementLines.push(`Even with strong top-line outcomes, the next refinement opportunity is ${pitchFocus} to further stabilize the tree depth.`);
      } else {
        improvementLines.push('Current tree signals are broadly stable with no major red branches; emphasis should remain on maintaining current strike-quality and swing-miss consistency.');
      }
    }

    return `Overall performance shows K% at ${fmt(automationTree.overallK.value)} (${overallKRank}) and BB% at ${fmt(automationTree.overallBB.value)} (${overallBBRank}). ${handednessLine} ${improvementLines.join(' ')}`;
  }, [automationTree]);

  const summaryStorageKey = useMemo(() => {
    const linkedId = Number(automationLinkedPlayerId);
    const playerKey = String((Number.isFinite(linkedId) && linkedId > 0 ? linkedId : selectedPlayerId) || 0);
    const nameKey = normalizeNameKey(selectedPlayerName || selectedDashboardPlayerName || 'unknown');
    const schoolKey = normalizeNameKey(selectedSchoolCode || 'all');
    return `player-plan-summary:${schoolKey}:${domain}:${playerKey}:${nameKey}`;
  }, [automationLinkedPlayerId, domain, selectedDashboardPlayerName, selectedPlayerId, selectedPlayerName, selectedSchoolCode]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(summaryStorageKey);
      if (!raw) {
        setSummaryMode('automated');
        setManualSummaryNote('');
        return;
      }
      const parsed = JSON.parse(raw) as { mode?: SummaryMode; manual?: string };
      setSummaryMode(parsed.mode === 'manual' ? 'manual' : 'automated');
      setManualSummaryNote(String(parsed.manual ?? ''));
    } catch {
      setSummaryMode('automated');
      setManualSummaryNote('');
    }
  }, [summaryStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(summaryStorageKey, JSON.stringify({ mode: summaryMode, manual: manualSummaryNote }));
    } catch {
      // no-op
    }
  }, [manualSummaryNote, summaryMode, summaryStorageKey]);

  async function downloadPlayerPlanPdf() {
    if (!goalsExportRef.current || isExportingPlanPdf) return;
    setIsExportingPlanPdf(true);
    let exportRoot: HTMLDivElement | null = null;
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const isLightMode = document.body.classList.contains('theme-light');
      const pageBg = isLightMode ? '#ffffff' : '#05070d';
      const textColor = isLightMode ? '#111827' : '#f8fafc';
      const mutedColor = isLightMode ? '#475569' : '#cbd5e1';
      const pearlLogoSrc = isLightMode
        ? '/pearl-lockup-stacked-black-transparent.png'
        : '/pearl-clam-transparent.png';
      const source = goalsExportRef.current.cloneNode(true) as HTMLDivElement;
      source.querySelectorAll('button,label,[data-player-plan-pdf-ignore="true"]').forEach((node) => node.remove());
      source.querySelectorAll<HTMLElement>('.portal-day-card').forEach((card) => {
        card.style.height = 'auto';
        card.style.minHeight = '0';
        card.style.overflow = 'visible';
        card.style.breakInside = 'avoid';
        card.style.pageBreakInside = 'avoid';
        card.style.padding = '12px';
      });
      source.querySelectorAll<HTMLElement>('*').forEach((node) => {
        if (node.style.overflowY === 'auto' || node.style.overflowY === 'scroll') node.style.overflowY = 'visible';
        if (node.style.overflow === 'auto' || node.style.overflow === 'scroll') node.style.overflow = 'visible';
        if (node.style.height === `${GOAL_PANEL_HEIGHT}px`) {
          node.style.height = '300px';
          node.style.minHeight = '300px';
        }
        if (node.style.height === `${GOAL_VISUAL_HEIGHT}px`) {
          node.style.height = '230px';
          node.style.minHeight = '230px';
        }
      });
      exportRoot = document.createElement('div');
      exportRoot.style.position = 'fixed';
      exportRoot.style.left = '-10000px';
      exportRoot.style.top = '0';
      exportRoot.style.width = '1040px';
      exportRoot.style.padding = '28px 30px 34px';
      exportRoot.style.background = pageBg;
      exportRoot.style.color = textColor;
      exportRoot.style.fontFamily = 'Manrope, Arial, sans-serif';
      exportRoot.style.boxSizing = 'border-box';
      const header = document.createElement('div');
      header.style.display = 'grid';
      header.style.gridTemplateColumns = '72px 1fr 72px';
      header.style.alignItems = 'center';
      header.style.gap = '18px';
      header.style.marginBottom = '22px';
      const leftLogo = document.createElement('img');
      leftLogo.src = pearlLogoSrc;
      leftLogo.alt = 'Pearl Player Development';
      leftLogo.style.width = '56px';
      leftLogo.style.height = '56px';
      leftLogo.style.objectFit = 'contain';
      const rightLogo = leftLogo.cloneNode() as HTMLImageElement;
      const titleWrap = document.createElement('div');
      titleWrap.style.textAlign = 'center';
      const title = document.createElement('h1');
      title.textContent = 'Player Plan Goals';
      title.style.margin = '0';
      title.style.fontSize = '24px';
      title.style.lineHeight = '1.15';
      title.style.fontWeight = '800';
      title.style.letterSpacing = '0';
      title.style.color = textColor;
      const subtitle = document.createElement('div');
      subtitle.textContent = centeredName || 'Player';
      subtitle.style.marginTop = '4px';
      subtitle.style.fontSize = '17px';
      subtitle.style.fontWeight = '800';
      subtitle.style.color = mutedColor;
      titleWrap.append(title, subtitle);
      header.append(leftLogo, titleWrap, rightLogo);
      source.style.display = 'grid';
      source.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
      source.style.alignItems = 'start';
      source.style.gap = '12px';
      source.style.width = '100%';
      exportRoot.append(header, source);
      document.body.appendChild(exportRoot);
      await Promise.all(
        Array.from(exportRoot.querySelectorAll('img')).map((img) =>
          img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })
        )
      );
      const canvas = await html2canvas(exportRoot, {
        backgroundColor: pageBg,
        scale: 2,
        useCORS: true,
      });
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 16;
      const contentWidth = pageWidth - margin * 2;
      const contentHeight = pageHeight - margin * 2;
      const scale = Math.min(contentWidth / canvas.width, contentHeight / canvas.height);
      const drawWidth = canvas.width * scale;
      const drawHeight = canvas.height * scale;
      const x = (pageWidth - drawWidth) / 2;
      const y = (pageHeight - drawHeight) / 2;
      pdf.setFillColor(pageBg);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, drawWidth, drawHeight, undefined, 'FAST');
      const safeName = normalizeNameKey(centeredName || 'player-plan') || 'player-plan';
      pdf.save(`${safeName}-development-plan.pdf`);
    } finally {
      exportRoot?.remove();
      setIsExportingPlanPdf(false);
    }
  }
  const linkedPlayerSelectOptions = useMemo(
    () =>
      [...linkedPlayers]
        .sort((a, b) => formatNameFirstLast(a.fullName).localeCompare(formatNameFirstLast(b.fullName)))
        .map((player) => ({ value: String(player.playerId), label: formatNameFirstLast(player.fullName) })),
    [linkedPlayers]
  );
  const linkedPlayersNameKey = useMemo(
    () =>
      linkedPlayers
        .map((player) => String(player.fullName ?? '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .join('|'),
    [linkedPlayers]
  );
  const resolvedAutomationPlayerId = useMemo(() => {
    const explicit = Number(automationLinkedPlayerId);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    return selectedPlayerId;
  }, [automationLinkedPlayerId, selectedPlayerId]);
  const resolvedAutomationPlayerName = useMemo(() => {
    const id = resolvedAutomationPlayerId;
    if (Number.isFinite(id) && id > 0) {
      const linked = linkedPlayers.find((player) => Number(player.playerId) === id);
      const name = String(linked?.fullName ?? '').trim();
      if (name) return name;
    }
    const selectedNorms = [
      normalizePersonName(selectedPlayerName),
      normalizePersonName(selectedDashboardPlayerName),
    ].filter(Boolean);
    const fuzzy = linkedPlayers.find((player) => {
      const full = normalizePersonName(player.fullName ?? '');
      return selectedNorms.some((cand) => full === cand || full.startsWith(cand) || cand.startsWith(full));
    });
    return String(fuzzy?.fullName ?? '').trim();
  }, [linkedPlayers, resolvedAutomationPlayerId, selectedDashboardPlayerName, selectedPlayerName]);
  const activePlanPlayerId = useMemo(() => {
    if (domain === 'Pitching' && planMode === 'Automated') return resolvedAutomationPlayerId;
    return selectedPlayerId;
  }, [domain, planMode, resolvedAutomationPlayerId, selectedPlayerId]);
  const commitPlayerInput = () => {
    const resolved = resolveTypedPlayerInput(playerInputName, dashboardPlayerOptions);
    if (!resolved) {
      setPlayerInputName(selectedPlayerName);
      return;
    }
    const match = dashboardPlayerOptions.find((name) => normalizePersonName(name) === normalizePersonName(resolved));
    if (!match) {
      setPlayerInputName(selectedPlayerName);
      return;
    }
    setSelectedPlayerName(match);
    setPlayerInputName(match);
  };
  useEffect(() => {
    setPlayerInputName(selectedPlayerName);
  }, [selectedPlayerName]);

  useEffect(() => {
    if (!(domain === 'Pitching' && planMode === 'Automated')) return;
    const pitcherName = (resolvedAutomationPlayerName || selectedDashboardPlayerName || selectedPlayerName || '').trim();
    const pitcherCandidates = Array.from(
      new Set(
        [
          ...playerNameQueryCandidates(selectedPlayerName, selectedDashboardPlayerName),
          ...playerNameQueryCandidates(resolvedAutomationPlayerName, resolvedAutomationPlayerName),
          pitcherName,
          pitcherName.replace(/,\s*$/, '').trim(),
          formatNameFirstLast(pitcherName),
        ]
          .map((x) => String(x ?? '').trim())
          .filter(Boolean)
      )
    );
    if (!pitcherName) {
      setAutomationTree(null);
      return;
    }
    let active = true;
    setAutomationTreeLoading(true);
    setAutomationTreeError('');
    const schoolCode = selectedSchoolCode || '';
    const isProSchool = schoolCode.trim().toUpperCase() === 'PRO';
    let effectivePitcherCandidates = [...pitcherCandidates];
    const toLastFirst = (name: string): string => {
      const trimmed = String(name ?? '').trim();
      if (!trimmed || trimmed.includes(',')) return trimmed;
      const parts = trimmed.split(/\s+/).filter(Boolean);
      if (parts.length < 2) return trimmed;
      const last = parts[parts.length - 1];
      const first = parts.slice(0, -1).join(' ');
      return `${last}, ${first}`.trim();
    };
    const hydrateCanonicalPitcherCandidate = async () => {
      try {
        const params = new URLSearchParams();
        if (schoolCode) params.set('school_code', schoolCode);
        params.set('session_type', automationSessionType || 'Season');
        params.set('stuff_base', automationStuffBase);
        if (automationStartDate) params.set('start_date', automationStartDate);
        if (automationEndDate) params.set('end_date', automationEndDate);
        params.set('split_by', 'Pitcher');
        params.set('custom_columns', 'K%,BB%');
        const r = await fetch(`/api/dashboard/pitching/table-rollup?${params.toString()}`, { cache: 'no-store' });
        const p = (await r.json().catch(() => ({}))) as { table_rows?: Array<Record<string, unknown>>; table_columns?: string[] };
        if (!r.ok || !Array.isArray(p.table_rows) || !p.table_rows.length) return;
        const splitCol = String(p.table_columns?.[0] ?? 'Pitcher') || 'Pitcher';
        const canonical = p.table_rows
          .map((row) => String(row[splitCol] ?? '').trim())
          .find((rowName) => {
            const rowNorm = normalizePersonName(rowName);
            return effectivePitcherCandidates.some((cand) => {
              const candNorm = normalizePersonName(cand);
              return rowNorm === candNorm || rowNorm.startsWith(candNorm) || candNorm.startsWith(rowNorm);
            });
          });
        if (!canonical) return;
        effectivePitcherCandidates = Array.from(new Set([canonical, ...effectivePitcherCandidates]));
      } catch {
        // no-op: keep original candidate set
      }
    };
    const fetchRollup = async (extra: Record<string, string>) => {
      const fetchWithTimeout = async (url: string, timeoutMs: number) => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(url, { cache: 'no-store', signal: controller.signal });
        } finally {
          window.clearTimeout(timeout);
        }
      };
      const run = async (withDates: boolean) => {
        const params = new URLSearchParams();
        if (schoolCode) params.set('school_code', schoolCode);
        params.set('session_type', automationSessionType || 'Season');
        params.set('stuff_base', automationStuffBase);
        if (withDates && automationStartDate) params.set('start_date', automationStartDate);
        if (withDates && automationEndDate) params.set('end_date', automationEndDate);
        Object.entries(extra).forEach(([k, v]) => params.set(k, v));
        let firstSuccessful: { rows: Array<Record<string, unknown>>; splitCol: string } | null = null;
        for (const candidate of effectivePitcherCandidates) {
          params.set('pitcher', candidate);
          let r: Response;
          try {
            r = await fetchWithTimeout(`/api/dashboard/pitching/table-rollup?${params.toString()}`, isProSchool ? 12000 : 16000);
          } catch {
            continue;
          }
          const p = (await r.json().catch(() => ({}))) as { table_rows?: Array<Record<string, unknown>>; table_columns?: string[]; error?: string };
          if (!r.ok) continue;
          const result = { rows: Array.isArray(p.table_rows) ? p.table_rows : [], splitCol: String(p.table_columns?.[0] ?? '') };
          if (!firstSuccessful) firstSuccessful = result;
          if (result.rows.length > 0) return result;
        }
        return firstSuccessful;
      };
      const dated = await run(true);
      if (dated && dated.rows.length > 0) return dated;
      if (automationStartDate || automationEndDate) {
        const noDate = await run(false);
        if (noDate) return noDate;
      }
      if (dated) return dated;
      throw new Error(`Failed to load automated tree data for ${pitcherName}.`);
    };
    const fetchOverviewHand = async (extra: Record<string, string>, withPitcher: boolean) => {
      const params = new URLSearchParams();
      if (schoolCode) params.set('school_code', schoolCode);
      params.set('table_mode', 'Live');
      params.set('split_by', 'Batter Hand');
      params.set('session_type', automationSessionType || 'Season');
      params.set('stuff_base', automationStuffBase);
      if (automationStartDate) params.set('start_date', automationStartDate);
      if (automationEndDate) params.set('end_date', automationEndDate);
      params.set('include_chart_points', '0');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
      Object.entries(extra).forEach(([k, v]) => params.set(k, v));
      if (!withPitcher) {
        const r = await fetch(`/api/dashboard/pitching/overview?${params.toString()}`, { cache: 'no-store' });
        const p = (await r.json().catch(() => ({}))) as { table_rows?: Array<Record<string, unknown>>; table_columns?: string[]; error?: string };
        if (!r.ok) throw new Error(p.error ?? 'Failed to load batter-hand baseline data.');
        return { rows: Array.isArray(p.table_rows) ? p.table_rows : [], splitCol: String(p.table_columns?.[0] ?? '') };
      }
      let firstSuccessful: { rows: Array<Record<string, unknown>>; splitCol: string } | null = null;
      for (const candidate of effectivePitcherCandidates) {
        params.set('pitcher', candidate);
        const r = await fetch(`/api/dashboard/pitching/overview?${params.toString()}`, { cache: 'no-store' });
        const p = (await r.json().catch(() => ({}))) as { table_rows?: Array<Record<string, unknown>>; table_columns?: string[]; error?: string };
        if (!r.ok) continue;
        const result = { rows: Array.isArray(p.table_rows) ? p.table_rows : [], splitCol: String(p.table_columns?.[0] ?? '') };
        if (!firstSuccessful) firstSuccessful = result;
        if (result.rows.length > 0) return result;
      }
      if (firstSuccessful) return firstSuccessful;
      throw new Error(`Failed to load batter-hand data for ${pitcherName}.`);
    };
    const fetchOverviewPitchTypes = async (extra: Record<string, string>, timeoutMs: number = 12000) => {
      const params = new URLSearchParams();
      if (schoolCode) params.set('school_code', schoolCode);
      params.set('table_mode', 'Live');
      params.set('split_by', 'Pitch Types');
      params.set('session_type', automationSessionType || 'Season');
      params.set('stuff_base', automationStuffBase);
      if (automationStartDate) params.set('start_date', automationStartDate);
      if (automationEndDate) params.set('end_date', automationEndDate);
      params.set('include_chart_points', '0');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
      Object.entries(extra).forEach(([k, v]) => params.set(k, v));
      let firstSuccessful: { rows: Array<Record<string, unknown>>; splitCol: string } | null = null;
      for (const candidate of effectivePitcherCandidates) {
        params.set('pitcher', candidate);
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
        let r: Response;
        try {
          r = await fetch(`/api/dashboard/pitching/overview?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
        } catch {
          window.clearTimeout(timeout);
          continue;
        }
        window.clearTimeout(timeout);
        const p = (await r.json().catch(() => ({}))) as { table_rows?: Array<Record<string, unknown>>; table_columns?: string[] };
        if (!r.ok) continue;
        const result = { rows: Array.isArray(p.table_rows) ? p.table_rows : [], splitCol: String(p.table_columns?.[0] ?? '') };
        if (!firstSuccessful) firstSuccessful = result;
        if (result.rows.length > 0) return result;
      }
      return firstSuccessful ?? { rows: [], splitCol: '' };
    };
    const fetchOverviewPitchTypesWithRows = async (extra: Record<string, string>, timeoutMs: number = 16000) => {
      if (isProSchool) return { rows: [], splitCol: '' };
      const params = new URLSearchParams();
      if (schoolCode) params.set('school_code', schoolCode);
      params.set('table_mode', 'Live');
      params.set('split_by', 'Pitch Types');
      params.set('session_type', automationSessionType || 'Season');
      params.set('stuff_base', automationStuffBase);
      if (automationStartDate) params.set('start_date', automationStartDate);
      if (automationEndDate) params.set('end_date', automationEndDate);
      params.set('include_chart_points', '0');
      params.set('include_row_pitches', '1');
      params.set('include_trend_rows', '0');
      Object.entries(extra).forEach(([k, v]) => params.set(k, v));
      let firstSuccessful: { rows: Array<Record<string, unknown>>; splitCol: string } | null = null;
      for (const candidate of effectivePitcherCandidates) {
        params.set('pitcher', candidate);
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
        let r: Response;
        try {
          r = await fetch(`/api/dashboard/pitching/overview?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
        } catch {
          window.clearTimeout(timeout);
          continue;
        }
        window.clearTimeout(timeout);
        const p = (await r.json().catch(() => ({}))) as { table_rows?: Array<Record<string, unknown>>; table_columns?: string[] };
        if (!r.ok) continue;
        const result = { rows: Array.isArray(p.table_rows) ? p.table_rows : [], splitCol: String(p.table_columns?.[0] ?? '') };
        if (!firstSuccessful) firstSuccessful = result;
        if (result.rows.length > 0) return result;
      }
      return firstSuccessful ?? { rows: [], splitCol: '' };
    };
    const fetchOverviewPointsForSide = async (batterSide: 'Left' | 'Right', timeoutMs: number = 18000) => {
      if (isProSchool) return [];
      const params = new URLSearchParams();
      if (schoolCode) params.set('school_code', schoolCode);
      params.set('table_mode', 'Live');
      params.set('split_by', 'Pitcher');
      params.set('session_type', automationSessionType || 'Season');
      params.set('stuff_base', automationStuffBase);
      if (automationStartDate) params.set('start_date', automationStartDate);
      if (automationEndDate) params.set('end_date', automationEndDate);
      params.set('include_chart_points', '1');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
      params.set('batter_side', batterSide);
      let best: Array<Record<string, unknown>> = [];
      for (const candidate of effectivePitcherCandidates) {
        params.set('pitcher', candidate);
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
          const r = await fetch(`/api/dashboard/pitching/overview?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
          const p = (await r.json().catch(() => ({}))) as { chart_points?: Array<Record<string, unknown>> };
          if (!r.ok) continue;
          const pts = Array.isArray(p.chart_points) ? p.chart_points : [];
          if (!best.length) best = pts;
          if (pts.length > 0) return pts;
        } catch {
          // try next candidate
        } finally {
          window.clearTimeout(timeout);
        }
      }
      return best;
    };
    const fetchOverviewPitchTypesBase = async (extra: Record<string, string>, timeoutMs: number = 12000) => {
      if (isProSchool) return { rows: [], splitCol: '' };
      const params = new URLSearchParams();
      if (schoolCode) params.set('school_code', schoolCode);
      params.set('table_mode', 'Live');
      params.set('split_by', 'Pitch Types');
      params.set('session_type', automationSessionType || 'Season');
      params.set('stuff_base', automationStuffBase);
      if (automationStartDate) params.set('start_date', automationStartDate);
      if (automationEndDate) params.set('end_date', automationEndDate);
      params.set('include_chart_points', '0');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
      Object.entries(extra).forEach(([k, v]) => params.set(k, v));
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const r = await fetch(`/api/dashboard/pitching/overview?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
        const p = (await r.json().catch(() => ({}))) as { table_rows?: Array<Record<string, unknown>>; table_columns?: string[] };
        if (!r.ok) return { rows: [], splitCol: '' };
        return { rows: Array.isArray(p.table_rows) ? p.table_rows : [], splitCol: String(p.table_columns?.[0] ?? '') };
      } catch {
        return { rows: [], splitCol: '' };
      } finally {
        window.clearTimeout(timeout);
      }
    };
    const fetchPitchTypesZeroZeroForPitcher = async (batterSide: 'Left' | 'Right') => {
      const rollupPayload = await fetchRollup({
        split_by: 'Pitch Types',
        custom_columns: '#,PA,InZone%,Strike%,Whiff%,Stuff+',
        batter_side: batterSide,
        count_filter: '0-0',
      });
      return rollupPayload;
    };
    const fetchPitchTypesAllForPitcher = async (batterSide?: 'Left' | 'Right') => {
      const rollupPayload = await fetchRollup({
        split_by: 'Pitch Types',
        custom_columns: '#,PA,InZone%,Strike%,Whiff%,Stuff+',
        ...(batterSide ? { batter_side: batterSide } : {}),
      });
      return rollupPayload;
    };
    const fetchPitchTypesByCountForPitcher = async (batterSide: 'Left' | 'Right', countFilter: '<2K' | '2K') => {
      return fetchRollup({
        split_by: 'Pitch Types',
        custom_columns: '#,PA,Whiff%,Stuff+,<2K,2K',
        batter_side: batterSide,
        count_filter: countFilter,
      });
    };
    const fetchBase = async (extra: Record<string, string>) => {
      // PRO-wide baseline rollups (without pitcher filter) can be extremely expensive
      // and intermittently time out. In automated tree mode we prefer availability
      // over broad baseline color references, so skip unscoped PRO baseline pulls.
      if (isProSchool && !Object.prototype.hasOwnProperty.call(extra, 'pitcher')) {
        const splitBy = String(extra.split_by ?? '').trim();
        const splitCol =
          splitBy === 'Batter Hand'
            ? 'Batter Hand'
            : splitBy === 'Pitch Types'
              ? 'Pitch'
              : splitBy || '';
        return { rows: [], splitCol };
      }
      const params = new URLSearchParams();
      if (schoolCode) params.set('school_code', schoolCode);
      params.set('session_type', automationSessionType || 'Season');
      params.set('stuff_base', automationStuffBase);
      if (automationStartDate) params.set('start_date', automationStartDate);
      if (automationEndDate) params.set('end_date', automationEndDate);
      Object.entries(extra).forEach(([k, v]) => params.set(k, v));
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), isProSchool ? 5000 : 12000);
      try {
        const r = await fetch(`/api/dashboard/pitching/table-rollup?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
        const p = (await r.json().catch(() => ({}))) as { table_rows?: Array<Record<string, unknown>>; table_columns?: string[]; error?: string };
        if (!r.ok) {
          if (isProSchool) return { rows: [], splitCol: String(p.table_columns?.[0] ?? '') };
          throw new Error(p.error ?? 'Failed to load automated tree baseline.');
        }
        return { rows: Array.isArray(p.table_rows) ? p.table_rows : [], splitCol: String(p.table_columns?.[0] ?? '') };
      } catch {
        if (isProSchool) return { rows: [], splitCol: String(extra.split_by ?? '') };
        throw new Error('Failed to load automated tree baseline.');
      } finally {
        window.clearTimeout(timeout);
      }
    };
    const readSplitText = (row: Record<string, unknown>, splitCol?: string) => {
      const splitKey = String(splitCol ?? '').trim();
      const preferredKeys = [
        'Batter Hand',
        'Batter Side',
        'Hand',
        'Split',
        ...(splitKey && splitKey !== '#' && splitKey !== 'P' && splitKey !== 'PA' ? [splitKey] : []),
      ];
      for (const key of preferredKeys) {
        const raw = String(row[key] ?? '').trim();
        if (!raw) continue;
        if (/^-?\d+(\.\d+)?$/.test(raw)) continue;
        return raw;
      }
      return getRowLabelValue(row, preferredKeys);
    };
    const sideRow = (rows: Array<Record<string, unknown>>, side: 'Left' | 'Right', splitCol?: string) => {
      const sideTokens = side === 'Left' ? ['left', 'lhh', 'vs left', 'v left'] : ['right', 'rhh', 'vs right', 'v right'];
      const otherTokens = side === 'Left' ? ['right', 'rhh'] : ['left', 'lhh'];
      return (
        rows.find((r) => {
          const raw = readSplitText(r, splitCol);
          const label = normalizeSplitLabel(raw);
          if (!label || label.includes('all') || label.includes('overall')) return false;
          const hasSide = sideTokens.some((t) => label === t || label.startsWith(`${t} `) || label.includes(` ${t} `) || label.endsWith(` ${t}`));
          const hasOther = otherTokens.some((t) => label === t || label.startsWith(`${t} `) || label.includes(` ${t} `) || label.endsWith(` ${t}`));
          return hasSide && !hasOther;
        }) ?? null
      );
    };
    const allRow = (rows: Array<Record<string, unknown>>, splitCol?: string) =>
      rows.find((r) => {
        const label = normalizeSplitLabel(
          readSplitText(r, splitCol) || getRowLabelValue(r, ['Pitch', 'Pitch Type', 'Pitch Types', 'Split'])
        );
        return (
          label === 'all' ||
          label === 'overall' ||
          label.includes('all batters') ||
          label.includes('all pitches') ||
          label.startsWith('all ')
        );
      }) ?? null;

    (async () => {
      try {
        await hydrateCanonicalPitcherCandidate();
        if (isProSchool) {
          const expanded = Array.from(
            new Set(
              effectivePitcherCandidates.flatMap((cand) => {
                const c = String(cand ?? '').trim();
                if (!c) return [];
                const lf = toLastFirst(c);
                return c === lf ? [c] : [lf, c];
              })
            )
          );
          if (expanded.length > 0) effectivePitcherCandidates = expanded;
        }
        const emptyPayload = { rows: [] as Array<Record<string, unknown>>, splitCol: '' };
        let [handPlayer, handBase, sidePitcherLeft, sidePitcherRight, pitchL00P, pitchL00B, pitchR00P, pitchR00B, pitchLAllP, pitchLAllB, pitchRAllP, pitchRAllB, pitchLlt2kP, pitchLlt2kB, pitchL2kP, pitchL2kB, pitchRlt2kP, pitchRlt2kB, pitchR2kP, pitchR2kB, sideLeftP, sideRightP, pitchLAllWithRows, pitchRAllWithRows, leftChartPoints, rightChartPoints] = await Promise.all([
          fetchRollup({ split_by: 'Batter Hand', custom_columns: '#,K%,BB%,Whiff%,E+A%,FPS%' }),
          fetchBase({ split_by: 'Batter Hand', custom_columns: '#,K%,BB%,Whiff%,E+A%,FPS%' }),
          fetchRollup({ split_by: 'Batter Hand', custom_columns: '#,K%,BB%,Whiff%,E+A%,FPS%', batter_side: 'Left' }),
          fetchRollup({ split_by: 'Batter Hand', custom_columns: '#,K%,BB%,Whiff%,E+A%,FPS%', batter_side: 'Right' }),
          fetchPitchTypesZeroZeroForPitcher('Left'),
          fetchBase({ split_by: 'Pitch Types', custom_columns: '#,PA,InZone%,Strike%,Whiff%,Stuff+', batter_side: 'Left', count_filter: '0-0' }),
          fetchPitchTypesZeroZeroForPitcher('Right'),
          fetchBase({ split_by: 'Pitch Types', custom_columns: '#,PA,InZone%,Strike%,Whiff%,Stuff+', batter_side: 'Right', count_filter: '0-0' }),
          fetchPitchTypesAllForPitcher('Left'),
          fetchBase({ split_by: 'Pitch Types', custom_columns: '#,PA,InZone%,Strike%,Whiff%,Stuff+', batter_side: 'Left' }),
          fetchPitchTypesAllForPitcher('Right'),
          fetchBase({ split_by: 'Pitch Types', custom_columns: '#,PA,InZone%,Strike%,Whiff%,Stuff+', batter_side: 'Right' }),
          fetchPitchTypesByCountForPitcher('Left', '<2K'),
          isProSchool ? Promise.resolve(emptyPayload) : fetchOverviewPitchTypesBase({ custom_columns: '#,PA,Whiff%,Stuff+,<2K,2K', batter_side: 'Left', count_filter: '<2K' }, 12000),
          fetchPitchTypesByCountForPitcher('Left', '2K'),
          isProSchool ? Promise.resolve(emptyPayload) : fetchOverviewPitchTypesBase({ custom_columns: '#,PA,Whiff%,Stuff+,<2K,2K', batter_side: 'Left', count_filter: '2K' }, 12000),
          fetchPitchTypesByCountForPitcher('Right', '<2K'),
          isProSchool ? Promise.resolve(emptyPayload) : fetchOverviewPitchTypesBase({ custom_columns: '#,PA,Whiff%,Stuff+,<2K,2K', batter_side: 'Right', count_filter: '<2K' }, 12000),
          fetchPitchTypesByCountForPitcher('Right', '2K'),
          isProSchool ? Promise.resolve(emptyPayload) : fetchOverviewPitchTypesBase({ custom_columns: '#,PA,Whiff%,Stuff+,<2K,2K', batter_side: 'Right', count_filter: '2K' }, 12000),
          fetchRollup({ split_by: 'Pitch Types', custom_columns: '#,PA,K%,BB%,InZone%,Strike%,Whiff%,E+A%,FPS%,Stuff+', batter_side: 'Left' }),
          fetchRollup({ split_by: 'Pitch Types', custom_columns: '#,PA,K%,BB%,InZone%,Strike%,Whiff%,E+A%,FPS%,Stuff+', batter_side: 'Right' }),
          isProSchool ? Promise.resolve(emptyPayload) : fetchOverviewPitchTypesWithRows({ custom_columns: '#,PA,Whiff%', batter_side: 'Left' }, 16000),
          isProSchool ? Promise.resolve(emptyPayload) : fetchOverviewPitchTypesWithRows({ custom_columns: '#,PA,Whiff%', batter_side: 'Right' }, 16000),
          isProSchool ? Promise.resolve([] as Array<Record<string, unknown>>) : fetchOverviewPointsForSide('Left', 18000),
          isProSchool ? Promise.resolve([] as Array<Record<string, unknown>>) : fetchOverviewPointsForSide('Right', 18000),
        ]);
        const hasCoreMetricValues = (rows: Array<Record<string, unknown>>) =>
          rows.some((row) =>
            findMetricValue(row, K_PCT_KEYS) !== null ||
            findMetricValue(row, BB_PCT_KEYS) !== null ||
            findMetricValue(row, FPS_KEYS) !== null ||
            findMetricValue(row, EA_KEYS) !== null
          );
        if (!isProSchool && (!hasCoreMetricValues(handPlayer.rows) || !hasCoreMetricValues(handBase.rows))) {
          const [overviewPlayerHand, overviewBaseHand] = await Promise.all([
            fetchOverviewHand({ custom_columns: '#,K%,BB%,Whiff%,E+A%,FPS%' }, true),
            fetchOverviewHand({ custom_columns: '#,K%,BB%,Whiff%,E+A%,FPS%' }, false),
          ]);
          if (!hasCoreMetricValues(handPlayer.rows) && overviewPlayerHand.rows.length > 0) handPlayer = overviewPlayerHand;
          if (!hasCoreMetricValues(handBase.rows) && overviewBaseHand.rows.length > 0) handBase = overviewBaseHand;
        }
        if (handPlayer.rows.length === 0) {
          const leftAll = allRow(sidePitcherLeft.rows, sidePitcherLeft.splitCol) ?? sidePitcherLeft.rows[0] ?? null;
          const rightAll = allRow(sidePitcherRight.rows, sidePitcherRight.splitCol) ?? sidePitcherRight.rows[0] ?? null;
          const synthesized: Array<Record<string, unknown>> = [];
          if (leftAll) synthesized.push({ ...leftAll, 'Batter Hand': 'Left' });
          if (rightAll) synthesized.push({ ...rightAll, 'Batter Hand': 'Right' });
          if (synthesized.length) handPlayer = { rows: synthesized, splitCol: 'Batter Hand' };
        }
        const hasAnyPlayerRows =
          handPlayer.rows.length > 0 ||
          pitchL00P.rows.length > 0 ||
          pitchR00P.rows.length > 0 ||
          pitchLAllP.rows.length > 0 ||
          pitchRAllP.rows.length > 0 ||
          sideLeftP.rows.length > 0 ||
          sideRightP.rows.length > 0;
        if (!hasAnyPlayerRows) {
          // Fail soft: keep rendering with whatever derived/baseline rows are available
          // rather than collapsing the entire tree with a blocking error.
        }

        const normalizePitchCallToken = (raw: string): string => {
          const token = String(raw ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
          if (!token) return '';
          if (token.includes('swings') || token === 'strikeswinging' || token === 'swingingstrike' || token === 'swingingstrikewhiff') return 'StrikeSwinging';
          if (token.includes('foul')) return 'FoulBall';
          if (token === 'inplay' || token.includes('inplay')) return 'InPlay';
          if (token === 'strikecalled' || token === 'calledstrike') return 'StrikeCalled';
          if (token.includes('ball')) return 'BallCalled';
          return String(raw ?? '').trim();
        };
        const isSwingCall = (call: string): boolean => {
          const c = normalizePitchCallToken(call);
          return c === 'StrikeSwinging' || c === 'FoulBall' || c === 'FoulBallFieldable' || c === 'FoulBallNotFieldable' || c === 'InPlay';
        };
        const buildCountWhiffMap = (payload: { rows: Array<Record<string, unknown>>; splitCol: string }) => {
          const out = new Map<string, { lt2k: number | null; twoK: number | null }>();
          for (const row of payload.rows) {
            const pitch = getRowLabelValue(row, [payload.splitCol || '', 'Pitch Types', 'Pitch Type', 'Pitch', 'Tagged Pitch Type']);
            if (!pitch || pitch.toLowerCase() === 'all') continue;
            const fam = pitchFamilyKey(pitch);
            const eventsRaw =
              (Array.isArray((row as { row_pitches?: unknown[] }).row_pitches) ? (row as { row_pitches?: unknown[] }).row_pitches : null) ??
              (Array.isArray((row as { pitches?: unknown[] }).pitches) ? (row as { pitches?: unknown[] }).pitches : null) ??
              [];
            const events = eventsRaw.filter((v): v is Record<string, unknown> => Boolean(v && typeof v === 'object'));
            let lt2kSwing = 0;
            let lt2kWhiff = 0;
            let twoKSwing = 0;
            let twoKWhiff = 0;
            for (const ev of events) {
              const s = toNum(ev.strikes_num);
              const call = normalizePitchCallToken(String(ev.pitch_call ?? ev.description ?? ''));
              if (s === null || !isSwingCall(call)) continue;
              if (s >= 2) {
                twoKSwing += 1;
                if (call === 'StrikeSwinging') twoKWhiff += 1;
              } else {
                lt2kSwing += 1;
                if (call === 'StrikeSwinging') lt2kWhiff += 1;
              }
            }
            const lt2k = lt2kSwing > 0 ? (lt2kWhiff / lt2kSwing) * 100 : null;
            const twoK = twoKSwing > 0 ? (twoKWhiff / twoKSwing) * 100 : null;
            if (!out.has(fam)) out.set(fam, { lt2k, twoK });
          }
          return out;
        };
        const leftCountWhiffMap = buildCountWhiffMap(pitchLAllWithRows);
        const rightCountWhiffMap = buildCountWhiffMap(pitchRAllWithRows);
        const buildCountWhiffMapFromPoints = (points: Array<Record<string, unknown>>) => {
          const acc = new Map<string, { lt2kSwing: number; lt2kWhiff: number; twoKSwing: number; twoKWhiff: number }>();
          for (const ev of points) {
            const pitch = String(ev.tagged_pitch_type ?? ev.pitch_type ?? ev.pitch ?? '').trim();
            if (!pitch) continue;
            const fam = pitchFamilyKey(pitch);
            const s = toNum(ev.strikes_num);
            const call = normalizePitchCallToken(String(ev.pitch_call ?? ev.description ?? ''));
            if (s === null || !isSwingCall(call)) continue;
            if (!acc.has(fam)) acc.set(fam, { lt2kSwing: 0, lt2kWhiff: 0, twoKSwing: 0, twoKWhiff: 0 });
            const item = acc.get(fam);
            if (!item) continue;
            if (s >= 2) {
              item.twoKSwing += 1;
              if (call === 'StrikeSwinging') item.twoKWhiff += 1;
            } else {
              item.lt2kSwing += 1;
              if (call === 'StrikeSwinging') item.lt2kWhiff += 1;
            }
          }
          const out = new Map<string, { lt2k: number | null; twoK: number | null }>();
          for (const [fam, item] of acc.entries()) {
            out.set(fam, {
              lt2k: item.lt2kSwing > 0 ? (item.lt2kWhiff / item.lt2kSwing) * 100 : null,
              twoK: item.twoKSwing > 0 ? (item.twoKWhiff / item.twoKSwing) * 100 : null,
            });
          }
          return out;
        };
        const leftPointCountWhiffMap = buildCountWhiffMapFromPoints(leftChartPoints);
        const rightPointCountWhiffMap = buildCountWhiffMapFromPoints(rightChartPoints);

        const mkPitchRows = (
          p: { rows: Array<Record<string, unknown>>; splitCol: string },
          b: { rows: Array<Record<string, unknown>>; splitCol: string },
          pLt2k?: { rows: Array<Record<string, unknown>>; splitCol: string } | null,
          bLt2k?: { rows: Array<Record<string, unknown>>; splitCol: string } | null,
          p2k?: { rows: Array<Record<string, unknown>>; splitCol: string } | null,
          b2k?: { rows: Array<Record<string, unknown>>; splitCol: string } | null,
          countWhiffMap?: Map<string, { lt2k: number | null; twoK: number | null }>
        ) => {
          const pAll = allRow(p.rows, p.splitCol);
          const bAll = allRow(b.rows, b.splitCol);
          const pTot = findMetricValue(pAll, ['#', 'P']) ?? 0;
          const bTot = findMetricValue(bAll, ['#', 'P']) ?? 0;
          const pLt2kAll = pLt2k ? allRow(pLt2k.rows, pLt2k.splitCol) : null;
          const p2kAll = p2k ? allRow(p2k.rows, p2k.splitCol) : null;
          const bLt2kAll = bLt2k ? allRow(bLt2k.rows, bLt2k.splitCol) : null;
          const b2kAll = b2k ? allRow(b2k.rows, b2k.splitCol) : null;
          const pLt2kTot = findMetricValue(pLt2kAll, ['#', 'P', 'PA', 'BF']) ?? 0;
          const p2kTot = findMetricValue(p2kAll, ['#', 'P', 'PA', 'BF']) ?? 0;
          const bLt2kTot = findMetricValue(bLt2kAll, ['#', 'P', 'PA', 'BF']) ?? 0;
          const b2kTot = findMetricValue(b2kAll, ['#', 'P', 'PA', 'BF']) ?? 0;
          const baselineByPitch = new Map<string, Record<string, unknown>>();
          const playerLt2kByPitch = new Map<string, Record<string, unknown>>();
          const baseLt2kByPitch = new Map<string, Record<string, unknown>>();
          const player2kByPitch = new Map<string, Record<string, unknown>>();
          const base2kByPitch = new Map<string, Record<string, unknown>>();
          const baselineByFamily = new Map<string, Record<string, unknown>>();
          const playerLt2kByFamily = new Map<string, Record<string, unknown>>();
          const baseLt2kByFamily = new Map<string, Record<string, unknown>>();
          const player2kByFamily = new Map<string, Record<string, unknown>>();
          const base2kByFamily = new Map<string, Record<string, unknown>>();
          for (const bRow of b.rows) {
            const bPitch = getRowLabelValue(bRow, [b.splitCol || '', 'Pitch Types', 'Pitch Type', 'Pitch', 'Tagged Pitch Type']);
            const key = normalizePitchLabel(bPitch);
            if (key && bPitch.toLowerCase() !== 'all') {
              baselineByPitch.set(key, bRow);
              const fam = pitchFamilyKey(bPitch);
              if (fam && !baselineByFamily.has(fam)) baselineByFamily.set(fam, bRow);
            }
          }
          for (const pRow of pLt2k?.rows ?? []) {
            const pitch = getRowLabelValue(pRow, [pLt2k?.splitCol || '', 'Pitch Types', 'Pitch Type', 'Pitch', 'Tagged Pitch Type']);
            const key = normalizePitchLabel(pitch);
            if (key && pitch.toLowerCase() !== 'all') {
              playerLt2kByPitch.set(key, pRow);
              const fam = pitchFamilyKey(pitch);
              if (fam && !playerLt2kByFamily.has(fam)) playerLt2kByFamily.set(fam, pRow);
            }
          }
          for (const bRow of bLt2k?.rows ?? []) {
            const pitch = getRowLabelValue(bRow, [bLt2k?.splitCol || '', 'Pitch Types', 'Pitch Type', 'Pitch', 'Tagged Pitch Type']);
            const key = normalizePitchLabel(pitch);
            if (key && pitch.toLowerCase() !== 'all') {
              baseLt2kByPitch.set(key, bRow);
              const fam = pitchFamilyKey(pitch);
              if (fam && !baseLt2kByFamily.has(fam)) baseLt2kByFamily.set(fam, bRow);
            }
          }
          for (const pRow of p2k?.rows ?? []) {
            const pitch = getRowLabelValue(pRow, [p2k?.splitCol || '', 'Pitch Types', 'Pitch Type', 'Pitch', 'Tagged Pitch Type']);
            const key = normalizePitchLabel(pitch);
            if (key && pitch.toLowerCase() !== 'all') {
              player2kByPitch.set(key, pRow);
              const fam = pitchFamilyKey(pitch);
              if (fam && !player2kByFamily.has(fam)) player2kByFamily.set(fam, pRow);
            }
          }
          for (const bRow of b2k?.rows ?? []) {
            const pitch = getRowLabelValue(bRow, [b2k?.splitCol || '', 'Pitch Types', 'Pitch Type', 'Pitch', 'Tagged Pitch Type']);
            const key = normalizePitchLabel(pitch);
            if (key && pitch.toLowerCase() !== 'all') {
              base2kByPitch.set(key, bRow);
              const fam = pitchFamilyKey(pitch);
              if (fam && !base2kByFamily.has(fam)) base2kByFamily.set(fam, bRow);
            }
          }
          const matchByKeyOrFamily = (
            pitchName: string,
            exact: Map<string, Record<string, unknown>>,
            family: Map<string, Record<string, unknown>>
          ) => {
            const key = normalizePitchLabel(pitchName);
            const direct = key ? exact.get(key) : null;
            if (direct) return direct;
            const fam = pitchFamilyKey(pitchName);
            if (fam) return family.get(fam) ?? null;
            return null;
          };
          return p.rows
            .map((row) => {
              const pitch = getRowLabelValue(row, [p.splitCol || '', 'Pitch Types', 'Pitch Type', 'Pitch', 'Tagged Pitch Type']);
              if (!pitch || pitch.toLowerCase() === 'all') return null;
              const pitchKey = normalizePitchLabel(pitch);
              const bRow = baselineByPitch.get(pitchKey) ?? matchByKeyOrFamily(pitch, baselineByPitch, baselineByFamily);
              const pLt2kRow = matchByKeyOrFamily(pitch, playerLt2kByPitch, playerLt2kByFamily);
              const bLt2kRow = matchByKeyOrFamily(pitch, baseLt2kByPitch, baseLt2kByFamily);
              const p2kRow = matchByKeyOrFamily(pitch, player2kByPitch, player2kByFamily);
              const b2kRow = matchByKeyOrFamily(pitch, base2kByPitch, base2kByFamily);
              const famWhiff = countWhiffMap?.get(pitchFamilyKey(pitch)) ?? null;
              const count = findMetricValue(row, ['#', 'P', 'PA', 'BF']) ?? 0;
              const bCount = findMetricValue(bRow, ['#', 'P', 'PA', 'BF']) ?? 0;
              const lt2kCount = findMetricValue(pLt2kRow, ['#', 'P', 'PA', 'BF']) ?? 0;
              const bLt2kCount = findMetricValue(bLt2kRow, ['#', 'P', 'PA', 'BF']) ?? 0;
              const twoKCount = findMetricValue(p2kRow, ['#', 'P', 'PA', 'BF']) ?? 0;
              const bTwoKCount = findMetricValue(b2kRow, ['#', 'P', 'PA', 'BF']) ?? 0;
              const usageLt2kDirect = findMetricValue(row, ['<2K', '<2k']);
              const usage2kDirect = findMetricValue(row, ['2K', '2k']);
              const bAllInZone = findMetricValue(bAll, ['InZone%']);
              const bAllStrike = findMetricValue(bAll, ['Strike%']);
              const bAllWhiff = findMetricValue(bAll, ['Whiff%']);
              const bAllStuff = findMetricValue(bAll, ['Stuff+', 'Stuff +', 'StuffPlus', 'stuff_plus', 'tj_stuff_plus']);
              return {
                pitch,
                usage: { value: pTot > 0 ? (count / pTot) * 100 : null, avg: bTot > 0 ? (bCount / bTot) * 100 : null },
                usageLt2k: {
                  value: pLt2kTot > 0 ? (lt2kCount / pLt2kTot) * 100 : usageLt2kDirect ?? (pTot > 0 ? (count / pTot) * 100 : null),
                  avg: bLt2kTot > 0 ? (bLt2kCount / bLt2kTot) * 100 : findMetricValue(bRow, ['<2K', '<2k']) ?? (bTot > 0 ? (bCount / bTot) * 100 : null),
                },
                usage2k: {
                  value: p2kTot > 0 ? (twoKCount / p2kTot) * 100 : usage2kDirect ?? (pTot > 0 ? (count / pTot) * 100 : null),
                  avg: b2kTot > 0 ? (bTwoKCount / b2kTot) * 100 : findMetricValue(bRow, ['2K', '2k']) ?? (bTot > 0 ? (bCount / bTot) * 100 : null),
                },
                inZone: { value: findMetricValue(row, ['InZone%']), avg: findMetricValue(bRow, ['InZone%']) ?? bAllInZone },
                strike: { value: findMetricValue(row, ['Strike%']), avg: findMetricValue(bRow, ['Strike%']) ?? bAllStrike },
                whiff: { value: findMetricValue(row, ['Whiff%']), avg: findMetricValue(bRow, ['Whiff%']) ?? bAllWhiff },
                whiffLt2k: {
                  value: findMetricValue(pLt2kRow, ['Whiff%']) ?? famWhiff?.lt2k ?? findMetricValue(row, ['Whiff%']),
                  avg: findMetricValue(bLt2kRow, ['Whiff%']) ?? findMetricValue(bRow, ['Whiff%']) ?? findMetricValue(bAll, ['Whiff%']),
                },
                whiff2k: {
                  value: findMetricValue(p2kRow, ['Whiff%']) ?? famWhiff?.twoK ?? findMetricValue(row, ['Whiff%']),
                  avg: findMetricValue(b2kRow, ['Whiff%']) ?? findMetricValue(bRow, ['Whiff%']) ?? findMetricValue(bAll, ['Whiff%']),
                },
                stuff: {
                  value: findMetricValue(row, ['Stuff+', 'Stuff +', 'StuffPlus', 'stuff_plus', 'tj_stuff_plus']),
                  avg: findMetricValue(bRow, ['Stuff+', 'Stuff +', 'StuffPlus', 'stuff_plus', 'tj_stuff_plus']) ?? bAllStuff,
                },
              } satisfies AutomatedTreePitchMetric;
            })
            .filter((v): v is AutomatedTreePitchMetric => Boolean(v))
            .sort((a, b) => (b.usage.value ?? 0) - (a.usage.value ?? 0));
        };

        const pLeft = sideRow(handPlayer.rows, 'Left', handPlayer.splitCol);
        const pRight = sideRow(handPlayer.rows, 'Right', handPlayer.splitCol);
        const bLeft = sideRow(handBase.rows, 'Left', handBase.splitCol);
        const bRight = sideRow(handBase.rows, 'Right', handBase.splitCol);
        const handPlayerNonAll = handPlayer.rows.filter((r) => !allRow([r], handPlayer.splitCol));
        const handBaseNonAll = handBase.rows.filter((r) => !allRow([r], handBase.splitCol));
        const pLeftFallback = pLeft ?? handPlayerNonAll[0] ?? null;
        const pRightFallback = pRight ?? handPlayerNonAll[1] ?? handPlayerNonAll[0] ?? null;
        const bLeftFallback = bLeft ?? handBaseNonAll[0] ?? null;
        const bRightFallback = bRight ?? handBaseNonAll[1] ?? handBaseNonAll[0] ?? null;
        const pAll = allRow(handPlayer.rows, handPlayer.splitCol);
        const bAll = allRow(handBase.rows, handBase.splitCol);
        const leftSummaryAll = allRow(sideLeftP.rows, sideLeftP.splitCol);
        const rightSummaryAll = allRow(sideRightP.rows, sideRightP.splitCol);
        const sideKCandidates = [
          findMetricValue(pLeftFallback, K_PCT_KEYS) ?? findHeuristicMetricValue(pLeftFallback, 'k'),
          findMetricValue(pRightFallback, K_PCT_KEYS) ?? findHeuristicMetricValue(pRightFallback, 'k'),
          findMetricValue(leftSummaryAll, K_PCT_KEYS) ?? findHeuristicMetricValue(leftSummaryAll, 'k'),
          findMetricValue(rightSummaryAll, K_PCT_KEYS) ?? findHeuristicMetricValue(rightSummaryAll, 'k'),
        ].filter((v): v is number => v !== null);
        const sideBBCandidates = [
          findMetricValue(pLeftFallback, BB_PCT_KEYS) ?? findHeuristicMetricValue(pLeftFallback, 'bb'),
          findMetricValue(pRightFallback, BB_PCT_KEYS) ?? findHeuristicMetricValue(pRightFallback, 'bb'),
          findMetricValue(leftSummaryAll, BB_PCT_KEYS) ?? findHeuristicMetricValue(leftSummaryAll, 'bb'),
          findMetricValue(rightSummaryAll, BB_PCT_KEYS) ?? findHeuristicMetricValue(rightSummaryAll, 'bb'),
        ].filter((v): v is number => v !== null);
        const sideKAvgCandidates = [findMetricValue(bLeftFallback, K_PCT_KEYS), findMetricValue(bRightFallback, K_PCT_KEYS)].filter((v): v is number => v !== null);
        const sideBBAvgCandidates = [findMetricValue(bLeftFallback, BB_PCT_KEYS), findMetricValue(bRightFallback, BB_PCT_KEYS)].filter((v): v is number => v !== null);
        const overallKFromSides = sideKCandidates.length ? sideKCandidates.reduce((sum, v) => sum + v, 0) / sideKCandidates.length : null;
        const overallBBFromSides = sideBBCandidates.length ? sideBBCandidates.reduce((sum, v) => sum + v, 0) / sideBBCandidates.length : null;
        const overallKAvgFromSides = sideKAvgCandidates.length ? sideKAvgCandidates.reduce((sum, v) => sum + v, 0) / sideKAvgCandidates.length : null;
        const overallBBAvgFromSides = sideBBAvgCandidates.length ? sideBBAvgCandidates.reduce((sum, v) => sum + v, 0) / sideBBAvgCandidates.length : null;
        const overallKValue = findMetricValue(pAll, K_PCT_KEYS) ?? findHeuristicMetricValue(pAll, 'k') ?? overallKFromSides;
        const overallKAvg = findMetricValue(bAll, K_PCT_KEYS) ?? overallKAvgFromSides;
        const overallBBValue = findMetricValue(pAll, BB_PCT_KEYS) ?? findHeuristicMetricValue(pAll, 'bb') ?? overallBBFromSides;
        const overallBBAvg = findMetricValue(bAll, BB_PCT_KEYS) ?? overallBBAvgFromSides;
        const overallEaValue = findMetricValue(pAll, EA_KEYS) ?? findHeuristicMetricValue(pAll, 'ea');
        const sidePitcherLeftAll = allRow(sidePitcherLeft.rows, sidePitcherLeft.splitCol) ?? sidePitcherLeft.rows[0] ?? null;
        const sidePitcherRightAll = allRow(sidePitcherRight.rows, sidePitcherRight.splitCol) ?? sidePitcherRight.rows[0] ?? null;

        const mkSide = (side: 'Left' | 'Right') => {
          const pRow = side === 'Left' ? pLeftFallback : pRightFallback;
          const bRow = side === 'Left' ? bLeftFallback : bRightFallback;
          const pSideDirect = side === 'Left' ? sidePitcherLeftAll : sidePitcherRightAll;
          const sideSummary = side === 'Left' ? allRow(sideLeftP.rows, sideLeftP.splitCol) : allRow(sideRightP.rows, sideRightP.splitCol);
          const sideSummaryRows = side === 'Left' ? sideLeftP.rows : sideRightP.rows;
          const sideAllRows =
            side === 'Left'
              ? mkPitchRows(
                  pitchLAllP,
                  pitchLAllB,
                  pitchLlt2kP,
                  pitchLlt2kB,
                  pitchL2kP,
                  pitchL2kB,
                  leftPointCountWhiffMap.size ? leftPointCountWhiffMap : leftCountWhiffMap
                )
              : mkPitchRows(
                  pitchRAllP,
                  pitchRAllB,
                  pitchRlt2kP,
                  pitchRlt2kB,
                  pitchR2kP,
                  pitchR2kB,
                  rightPointCountWhiffMap.size ? rightPointCountWhiffMap : rightCountWhiffMap
                );
          const sideLt2kPlayer = side === 'Left' ? pitchLlt2kP : pitchRlt2kP;
          const sideLt2kBase = side === 'Left' ? pitchLlt2kB : pitchRlt2kB;
          const side2kPlayer = side === 'Left' ? pitchL2kP : pitchR2kP;
          const side2kBase = side === 'Left' ? pitchL2kB : pitchR2kB;
          const countDerivedLt2k = mkPitchRows(
            sideLt2kPlayer,
            sideLt2kBase,
            sideLt2kPlayer,
            sideLt2kBase,
            side2kPlayer,
            side2kBase,
            side === 'Left'
              ? (leftPointCountWhiffMap.size ? leftPointCountWhiffMap : leftCountWhiffMap)
              : (rightPointCountWhiffMap.size ? rightPointCountWhiffMap : rightCountWhiffMap)
          );
          const countDerived2k = mkPitchRows(
            side2kPlayer,
            side2kBase,
            sideLt2kPlayer,
            sideLt2kBase,
            side2kPlayer,
            side2kBase,
            side === 'Left'
              ? (leftPointCountWhiffMap.size ? leftPointCountWhiffMap : leftCountWhiffMap)
              : (rightPointCountWhiffMap.size ? rightPointCountWhiffMap : rightCountWhiffMap)
          );
          const mergedCountDerived = (() => {
            const byPitch = new Map<string, AutomatedTreePitchMetric>();
            for (const row of [...countDerivedLt2k, ...countDerived2k]) {
              const key = normalizePitchLabel(row.pitch);
              if (!key) continue;
              if (!byPitch.has(key)) {
                byPitch.set(key, row);
                continue;
              }
              const prev = byPitch.get(key);
              if (!prev) continue;
              byPitch.set(key, {
                ...prev,
                usage: {
                  value: prev.usage.value ?? row.usage.value,
                  avg: prev.usage.avg ?? row.usage.avg,
                },
                usageLt2k: {
                  value: prev.usageLt2k.value ?? row.usageLt2k.value,
                  avg: prev.usageLt2k.avg ?? row.usageLt2k.avg,
                },
                usage2k: {
                  value: prev.usage2k.value ?? row.usage2k.value,
                  avg: prev.usage2k.avg ?? row.usage2k.avg,
                },
                inZone: {
                  value: prev.inZone.value ?? row.inZone.value,
                  avg: prev.inZone.avg ?? row.inZone.avg,
                },
                strike: {
                  value: prev.strike.value ?? row.strike.value,
                  avg: prev.strike.avg ?? row.strike.avg,
                },
                whiff: {
                  value: prev.whiff.value ?? row.whiff.value,
                  avg: prev.whiff.avg ?? row.whiff.avg,
                },
                whiffLt2k: {
                  value: prev.whiffLt2k.value ?? row.whiffLt2k.value,
                  avg: prev.whiffLt2k.avg ?? row.whiffLt2k.avg,
                },
                whiff2k: {
                  value: prev.whiff2k.value ?? row.whiff2k.value,
                  avg: prev.whiff2k.avg ?? row.whiff2k.avg,
                },
                stuff: {
                  value: prev.stuff.value ?? row.stuff.value,
                  avg: prev.stuff.avg ?? row.stuff.avg,
                },
              });
            }
            return Array.from(byPitch.values()).sort((a, b) => (b.usage.value ?? 0) - (a.usage.value ?? 0));
          })();
          const sideFallbackRows = buildPitchRowsFromSummaryRows(sideSummaryRows, side === 'Left' ? sideLeftP.splitCol : sideRightP.splitCol);
          const allRows = sideAllRows.length > 0 ? sideAllRows : (sideFallbackRows.length > 0 ? sideFallbackRows : mergedCountDerived);
          const zeroZeroRowsPrimary = side === 'Left' ? mkPitchRows(pitchL00P, pitchL00B) : mkPitchRows(pitchR00P, pitchR00B);
          const zeroZeroRows = zeroZeroRowsPrimary.length > 0 ? zeroZeroRowsPrimary : allRows;
          const whiffFromRows = weightedPitchMetric(allRows, 'whiff', 'value');
          const whiffAvgFromRows = weightedPitchMetric(allRows, 'whiff', 'avg');
          const fpsFromRows = weightedPitchMetric(zeroZeroRows, 'strike', 'value');
          const fpsAvgFromRows = weightedPitchMetric(zeroZeroRows, 'strike', 'avg');
          const kFromRows = weightedRawMetric(sideSummaryRows, K_PCT_KEYS) ?? meanMetricFromRows(sideSummaryRows, K_PCT_KEYS);
          const bbFromRows = weightedRawMetric(sideSummaryRows, BB_PCT_KEYS) ?? meanMetricFromRows(sideSummaryRows, BB_PCT_KEYS);
          const eaFromRows = weightedRawMetric(sideSummaryRows, EA_KEYS) ?? meanMetricFromRows(sideSummaryRows, EA_KEYS);
          return {
            kPct: {
              value:
                findMetricValue(pRow, K_PCT_KEYS) ??
                findHeuristicMetricValue(pRow, 'k') ??
                findMetricValue(pSideDirect, K_PCT_KEYS) ??
                findHeuristicMetricValue(pSideDirect, 'k') ??
                findMetricValue(sideSummary, K_PCT_KEYS) ??
                findHeuristicMetricValue(sideSummary, 'k') ??
                kFromRows ??
                anyRowMetric(sideSummaryRows, K_PCT_KEYS) ??
                anyRowMetric(handPlayer.rows, K_PCT_KEYS) ??
                overallKValue,
              avg: findMetricValue(bRow, K_PCT_KEYS) ?? overallKAvg,
            },
            bbPct: {
              value:
                findMetricValue(pRow, BB_PCT_KEYS) ??
                findHeuristicMetricValue(pRow, 'bb') ??
                findMetricValue(pSideDirect, BB_PCT_KEYS) ??
                findHeuristicMetricValue(pSideDirect, 'bb') ??
                findMetricValue(sideSummary, BB_PCT_KEYS) ??
                findHeuristicMetricValue(sideSummary, 'bb') ??
                bbFromRows ??
                anyRowMetric(sideSummaryRows, BB_PCT_KEYS) ??
                anyRowMetric(handPlayer.rows, BB_PCT_KEYS) ??
                overallBBValue,
              avg: findMetricValue(bRow, BB_PCT_KEYS) ?? overallBBAvg,
            },
            whiffPct: {
              value: findMetricValue(pRow, ['Whiff%']) ?? findMetricValue(pSideDirect, ['Whiff%']) ?? findMetricValue(sideSummary, ['Whiff%']) ?? weightedRawMetric(sideSummaryRows, ['Whiff%']) ?? whiffFromRows,
              avg: findMetricValue(bRow, ['Whiff%']) ?? whiffAvgFromRows,
            },
            eaPct: {
              value:
                findMetricValue(pRow, EA_KEYS) ??
                findHeuristicMetricValue(pRow, 'ea') ??
                findMetricValue(pSideDirect, EA_KEYS) ??
                findHeuristicMetricValue(pSideDirect, 'ea') ??
                findMetricValue(sideSummary, EA_KEYS) ??
                findHeuristicMetricValue(sideSummary, 'ea') ??
                eaFromRows ??
                anyRowMetric(sideSummaryRows, EA_KEYS) ??
                anyRowMetric(handPlayer.rows, EA_KEYS) ??
                overallEaValue,
              avg: findMetricValue(bRow, EA_KEYS),
            },
            fpsPct: {
              value:
                findMetricValue(pRow, FPS_KEYS) ??
                findHeuristicMetricValue(pRow, 'fps') ??
                findMetricValue(pSideDirect, FPS_KEYS) ??
                findHeuristicMetricValue(pSideDirect, 'fps') ??
                findMetricValue(sideSummary, FPS_KEYS) ??
                findHeuristicMetricValue(sideSummary, 'fps') ??
                weightedRawMetric(sideSummaryRows, FPS_KEYS) ??
                fpsFromRows,
              avg: findMetricValue(bRow, FPS_KEYS) ?? fpsAvgFromRows,
            },
            pitches00: zeroZeroRows,
            pitchesAll: allRows,
          } satisfies AutomatedTreeSideData;
        };

        const leftSide = mkSide('Left');
        const rightSide = mkSide('Right');
        const overallKFromBuiltSides =
          leftSide.kPct.value !== null && rightSide.kPct.value !== null
            ? (leftSide.kPct.value + rightSide.kPct.value) / 2
            : leftSide.kPct.value ?? rightSide.kPct.value;
        const overallBBFromBuiltSides =
          leftSide.bbPct.value !== null && rightSide.bbPct.value !== null
            ? (leftSide.bbPct.value + rightSide.bbPct.value) / 2
            : leftSide.bbPct.value ?? rightSide.bbPct.value;
        const next: AutomatedTreeData = {
          left: leftSide,
          right: rightSide,
          overallK: { value: overallKValue ?? overallKFromBuiltSides, avg: overallKAvg },
          overallBB: { value: overallBBValue ?? overallBBFromBuiltSides, avg: overallBBAvg },
        };
        if (!active) return;
        setAutomationTree(next);
      } catch (err) {
        if (!active) return;
        setAutomationTree(null);
        setAutomationTreeError(err instanceof Error ? err.message : 'Failed to build goal tree.');
      } finally {
        if (active) setAutomationTreeLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [automationEndDate, automationSessionType, automationStartDate, automationStuffBase, domain, linkedPlayers, planMode, resolvedAutomationPlayerId, resolvedAutomationPlayerName, selectedDashboardPlayerName, selectedPlayerName, selectedSchoolCode]);
  useEffect(() => {
    const allowed = new Set(DOMAIN_GOAL_CATEGORIES[domain] ?? GOAL_CATEGORIES);
    setPlanGoals((prev) =>
      prev.map((goal) => (goal.category && !allowed.has(goal.category) ? { ...goal, category: '' } : goal))
    );
  }, [domain]);
  const chartFetchGoalsRaw = useMemo(
    () => {
      if (domain === 'Pitching' && planMode === 'Automated') return [];
      return planGoals
        .filter((goal) => isChartCapableGoal(goal, domain))
        .map((goal) => ({
          slotIndex: goal.slotIndex,
          startDate: goal.startDate,
          endDate: goal.endDate,
          pitchTypes: goal.pitchTypes,
          ballTypes: goal.ballTypes,
          pitchResults: goal.pitchResults,
          countOptions: goal.countOptions,
          afterCountOptions: goal.afterCountOptions,
          teams: goal.teams,
          hand: goal.hand,
          batterSide: goal.batterSide,
          sessionType: goal.sessionType,
        }));
    },
    [domain, planGoals, planMode]
  );

  // Only re-fetch a goal's chart if its own filter fields changed, not when
  // an unrelated goal slot gets a category for the first time.
  const prevChartFetchGoalsRef = useRef<typeof chartFetchGoalsRaw>([]);
  const chartFetchGoals = useMemo(() => {
    const prev = prevChartFetchGoalsRef.current;
    const serializeGoal = (g: typeof chartFetchGoalsRaw[number]) =>
      `${g.slotIndex}|${g.startDate}|${g.endDate}|${g.sessionType}|${g.pitchTypes.join(',')}|${g.ballTypes.join(',')}|${g.pitchResults.join(',')}|${g.hand}|${g.batterSide}|${g.teams.join(',')}`;
    const prevMap = new Map(prev.map((g) => [g.slotIndex, serializeGoal(g)]));
    // Only include goals that are new or whose filters changed
    const changed = chartFetchGoalsRaw.filter((g) => prevMap.get(g.slotIndex) !== serializeGoal(g));
    prevChartFetchGoalsRef.current = chartFetchGoalsRaw;
    return changed;
  }, [chartFetchGoalsRaw]);

  useEffect(() => {
    let active = true;
    setLoadingPlayers(true);
    setMessage('');
    fetch('/api/dashboard/player-plans/players', { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { players?: PlayerOption[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load players.');
        if (!active) return;
        setLinkedPlayers(Array.isArray(payload.players) ? payload.players : []);
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : 'Failed to load players.');
      })
      .finally(() => {
        if (active) setLoadingPlayers(false);
      });
    return () => {
      active = false;
    };
  }, [selectedSchoolCode]);

  useEffect(() => {
    if (!Number.isFinite(deepLinkedPlayerId) || deepLinkedPlayerId <= 0) return;
    const linked = linkedPlayers.find((player) => player.playerId === deepLinkedPlayerId);
    if (!linked?.fullName) return;
    setSelectedPlayerName(linked.fullName);
    setPlayerInputName(linked.fullName);
  }, [deepLinkedPlayerId, linkedPlayers]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    params.set('domain', domain);
    if (selectedSchoolCode) params.set('school_code', selectedSchoolCode);
    fetch(`/api/dashboard/player-plans/domain-players?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { players?: string[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load player options.');
        const linkedNames = linkedPlayers
          .map((player) => String(player.fullName ?? '').trim())
          .filter(Boolean);
        const cleanedPlayers = uniqueDisplayNames(uniqueCanonicalNames([...(payload.players ?? []), ...linkedNames]));
        if (!active) return;
        if (cleanedPlayers.length) {
          setDashboardPlayerOptions(cleanedPlayers);
          setSelectedPlayerName((current) => (cleanedPlayers.includes(current) ? current : cleanedPlayers[0] ?? ''));
        } else {
          setDashboardPlayerOptions([]);
          setSelectedPlayerName('');
        }
      })
      .catch(() => {
        if (!active) return;
        setDashboardPlayerOptions([]);
        setSelectedPlayerName('');
      });
    return () => {
      active = false;
    };
  }, [domain, linkedPlayersNameKey, selectedSchoolCode]);

  useEffect(() => {
    const fallback = DOMAIN_EXECUTION_FALLBACKS[domain] ?? DOMAIN_EXECUTION_FALLBACKS.Pitching;
    if (!selectedDashboardPlayerName.trim()) {
      setDomainExecutionStats(fallback);
      return;
    }
    let active = true;
    const playerParam = domain === 'Pitching' ? 'pitcher' : domain === 'Hitting' ? 'hitter' : 'catcher';
    const params = new URLSearchParams();
    (async () => {
      try {
        const candidates = domain === 'Hitting' ? playerQueryCandidates : [selectedDashboardPlayerName];
        let payload: { available_table_columns?: string[]; table_columns?: string[] } | null = null;
        for (const candidate of candidates) {
          const params = new URLSearchParams();
          params.set(playerParam, candidate);
          if (domain !== 'Hitting') params.set('session_type', 'Season');
          const response = await fetch(`/api/dashboard/${domain.toLowerCase()}/overview?${params.toString()}`, { cache: 'no-store' });
          const parsed = (await response.json().catch(() => ({}))) as { available_table_columns?: string[]; table_columns?: string[] };
          if (!response.ok) continue;
          payload = parsed;
          break;
        }
        if (!active) return;
        if (!payload) {
          setDomainExecutionStats(fallback);
          return;
        }
        const fromApi = [
          ...(Array.isArray(payload.available_table_columns) ? payload.available_table_columns : []),
          ...(Array.isArray(payload.table_columns) ? payload.table_columns : []),
        ]
          .map((value) => String(value ?? '').trim())
          .filter((value) => value.length > 0 && value !== '#');
        let merged = Array.from(new Set([...fromApi, ...fallback]));
        if (domain === 'Hitting') {
          merged = merged.filter((value) => HITTING_EXECUTION_ALLOWED.has(normalizeExecutionStatKey(value)));
        }
        setDomainExecutionStats(merged.length ? merged : fallback);
      } catch {
        if (!active) return;
        setDomainExecutionStats(fallback);
      }
    })();
    return () => {
      active = false;
    };
  }, [domain, playerQueryCandidates, selectedDashboardPlayerName]);

  useEffect(() => {
    if (!selectedDashboardPlayerName.trim()) {
      setGoalCharts({
        1: { loading: false, error: '', points: [] },
        2: { loading: false, error: '', points: [] },
        3: { loading: false, error: '', points: [] },
      });
      return;
    }
    if (!chartFetchGoals.length) {
      setGoalCharts((prev) => ({
        1: { ...prev[1], loading: false, error: '' },
        2: { ...prev[2], loading: false, error: '' },
        3: { ...prev[3], loading: false, error: '' },
      }));
      return;
    }

    const playerParam = domain === 'Pitching' ? 'pitcher' : domain === 'Hitting' ? 'hitter' : 'catcher';
    const base = `/api/dashboard/${domain.toLowerCase()}/overview`;
    let active = true;
    const controller = new AbortController();

    setGoalCharts((prev) => {
      const next = { ...prev };
      for (const goal of chartFetchGoals) next[goal.slotIndex] = { ...next[goal.slotIndex], loading: true, error: '' };
      return next;
    });

    Promise.allSettled(
      chartFetchGoals.map(async (goal) => {
        const params = new URLSearchParams();
        const candidates = domain === 'Hitting' ? playerQueryCandidates : [selectedDashboardPlayerName];
        const candidateNameKeys = new Set(candidates.map((name) => normalizeNameKey(name)).filter(Boolean));
        let bestPoints: Array<Record<string, unknown>> = [];
        let lastError = '';
        for (const candidate of candidates) {
          const params = new URLSearchParams();
          params.set(playerParam, candidate);
          if (domain !== 'Hitting') params.set('session_type', goal.sessionType || 'Season');
          if (goal.startDate) params.set('start_date', goal.startDate);
          if (goal.endDate) params.set('end_date', goal.endDate);
          if (!goal.pitchTypes.includes('All')) params.set('pitch_types', goal.pitchTypes.join(','));
          if (domain === 'Pitching' && !goal.ballTypes.includes('All')) params.set('ball_types', goal.ballTypes.join(','));
          if (!goal.pitchResults.includes('All')) params.set('pitch_results', goal.pitchResults.join(','));
          if (!goal.countOptions.includes('All')) params.set('count_filter', goal.countOptions.join(','));
          if (!goal.afterCountOptions.includes('All')) params.set('after_count_filter', goal.afterCountOptions.join(','));
          if (goal.hand && goal.hand !== 'All') params.set('hand', goal.hand);
          if (goal.batterSide && goal.batterSide !== 'All') params.set('batter_side', goal.batterSide);
          const team = goal.teams.find((value) => value !== 'All');
          if (team) params.set('team_type', team);
          const response = await fetch(`${base}?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
          const payload = (await response.json().catch(() => ({}))) as { chart_points?: Array<Record<string, unknown>>; error?: string };
          if (!response.ok) {
            lastError = payload.error ?? 'Failed to load chart data.';
            continue;
          }
          const points = Array.isArray(payload.chart_points) ? payload.chart_points : [];
          bestPoints = points;
          if (points.length > 0) break;
        }
        if (domain === 'Hitting' && !bestPoints.length) {
          const params = new URLSearchParams();
          if (goal.startDate) params.set('start_date', goal.startDate);
          if (goal.endDate) params.set('end_date', goal.endDate);
          if (!goal.pitchTypes.includes('All')) params.set('pitch_types', goal.pitchTypes.join(','));
          if (!goal.pitchResults.includes('All')) params.set('pitch_results', goal.pitchResults.join(','));
          if (!goal.countOptions.includes('All')) params.set('count_filter', goal.countOptions.join(','));
          if (!goal.afterCountOptions.includes('All')) params.set('after_count_filter', goal.afterCountOptions.join(','));
          if (goal.hand && goal.hand !== 'All') params.set('hand', goal.hand);
          if (goal.batterSide && goal.batterSide !== 'All') params.set('batter_side', goal.batterSide);
          const team = goal.teams.find((value) => value !== 'All');
          if (team) params.set('team_type', team);
          const response = await fetch(`${base}?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
          const payload = (await response.json().catch(() => ({}))) as { chart_points?: Array<Record<string, unknown>>; error?: string };
          if (response.ok) {
            const points = Array.isArray(payload.chart_points) ? payload.chart_points : [];
            bestPoints = points.filter((point) => candidateNameKeys.has(normalizeNameKey(String(point.batter ?? ''))));
          } else {
            lastError = payload.error ?? lastError;
          }
        }
        if (!bestPoints.length && lastError) throw new Error(lastError);
        return { slotIndex: goal.slotIndex, points: bestPoints };
      })
    ).then((results) => {
      if (!active) return;
      setGoalCharts((prev) => {
        const next = { ...prev };
        results.forEach((result, index) => {
          const slotIndex = chartFetchGoals[index].slotIndex;
          if (result.status === 'fulfilled') next[slotIndex] = { loading: false, error: '', points: result.value.points };
          else {
            const reason = result.reason instanceof Error ? result.reason.message : 'Failed to load goal chart data.';
            if (reason.toLowerCase().includes('abort')) next[slotIndex] = { ...next[slotIndex], loading: false };
            else next[slotIndex] = { ...next[slotIndex], loading: false, error: reason };
          }
        });
        return next;
      });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [domain, playerQueryCandidates, selectedDashboardPlayerName, chartFetchGoals]);

  useEffect(() => {
    let active = true;
    const domainPath = domain.toLowerCase();
    const params = new URLSearchParams();
    if (selectedSchoolCode) params.set('school_code', selectedSchoolCode);
    if (domain === 'Pitching') params.set('force_refresh', '1');
    const filterUrl = `/api/dashboard/${domainPath}/filters${params.toString() ? `?${params.toString()}` : ''}`;
    fetch(filterUrl, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load dashboard filters.');
        const payload = (await response.json().catch(() => ({}))) as Partial<DashboardFilterOptions>;
        if (!active) return;
        setFilterOptions({
          pitchers: withAllOption(payload.pitchers),
          hitters: withAllOption(payload.hitters),
          catchers: withAllOption(payload.catchers),
          pitch_types: withAllOption(payload.pitch_types),
          ball_types: withAllOption(payload.ball_types),
          pitch_results: withAllOption(payload.pitch_results),
          count_options: withAllOption(payload.count_options),
          after_count_options: withAllOption(payload.after_count_options),
          team_types: withAllOption(payload.team_types),
          hands: withAllOption(payload.hands),
          batter_sides: withAllOption(payload.batter_sides),
        });
      })
      .catch(() => {
        if (!active) return;
        setFilterOptions((current) => current);
      });
    return () => {
      active = false;
    };
  }, [domain, selectedSchoolCode]);

  useEffect(() => {
    if (!activePlanPlayerId) {
      setPlanGoals([1, 2, 3].map((slot) => parseStoredGoalDescription(null, null, slot as GoalSlot, null)));
      return;
    }
    let active = true;
    setLoadingGoals(true);
    fetch(`/api/player/plan-goals?playerId=${activePlanPlayerId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          activeGoals?: Array<{ slotIndex: number; category: string | null; goalDescription: string | null; createdAt: string | null }>;
          error?: string;
        };
        if (!response.ok) {
          if (response.status === 404) {
            if (!active) return;
            setPlanGoals([1, 2, 3].map((slot) => parseStoredGoalDescription(null, null, slot as GoalSlot, null)));
            return;
          }
          throw new Error(payload.error ?? 'Failed to load goals.');
        }
        if (!active) return;
        const next = ([1, 2, 3] as GoalSlot[]).map((slot) => {
          const existing = payload.activeGoals?.find((goal) => goal.slotIndex === slot);
          return parseStoredGoalDescription(existing?.category ?? null, existing?.goalDescription ?? null, slot, existing?.createdAt ?? null);
        });
        setPlanGoals(next);
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : 'Failed to load goals.');
      })
      .finally(() => {
        if (active) setLoadingGoals(false);
      });

    return () => {
      active = false;
    };
  }, [activePlanPlayerId]);

  // Auto-save goals when filters change (debounced) so settings persist on reload.
  useEffect(() => {
    if (!activePlanPlayerId) return;
    const saveable = planGoals.filter((g) => g.category && isChartCapableGoal(g, domain));
    if (!saveable.length) return;
    const timer = setTimeout(() => {
      for (const goal of saveable) {
        void fetch('/api/player/plan-goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: activePlanPlayerId,
            slotIndex: goal.slotIndex,
            category: goal.category,
            goalDescription: serializeGoalDescription(goal),
          }),
        }).catch(() => {});
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    activePlanPlayerId,
    domain,
    // Only watch the filter fields that need to persist, not every keystroke field
    ...planGoals.map((g) => `${g.slotIndex}:${g.sessionType}:${g.startDate}:${g.endDate}:${g.pitchTypes.join(',')}:${g.ballTypes.join(',')}:${g.comparator}:${g.targetValue}:${g.chartType}`),
  ]);

  async function saveGoal(slotIndex: GoalSlot) {
    if (!activePlanPlayerId) {
      setMessage('Select a player first.');
      return;
    }
    const goal = planGoals.find((entry) => entry.slotIndex === slotIndex);
    if (!goal || !goal.category) return;
    setGoalSavingSlot(slotIndex);
    setMessage('');
    try {
      const response = await fetch('/api/player/plan-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: activePlanPlayerId,
          slotIndex,
          category: goal.category,
          goalDescription: serializeGoalDescription(goal),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        activeGoals?: Array<{ slotIndex: number; category: string | null; goalDescription: string | null; createdAt: string | null }>;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save goal.');
      // Only update the saved slot to avoid re-flashing other goals.
      const savedData = payload.activeGoals?.find((entry) => entry.slotIndex === slotIndex);
      if (savedData) {
        setPlanGoals((prev) =>
          prev.map((entry) =>
            entry.slotIndex === slotIndex
              ? parseStoredGoalDescription(savedData.category ?? null, savedData.goalDescription ?? null, slotIndex, savedData.createdAt ?? null)
              : entry
          )
        );
      }
      setMessage(`Goal ${slotIndex} saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save goal.');
    } finally {
      setGoalSavingSlot(null);
    }
  }

  async function completeGoal(slotIndex: GoalSlot) {
    if (!activePlanPlayerId) {
      setMessage('Select a player first.');
      return;
    }
    const completionDetails = window.prompt('Completion notes (optional):', '') ?? '';
    setGoalSavingSlot(slotIndex);
    setMessage('');
    try {
      const response = await fetch('/api/player/plan-goals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: activePlanPlayerId,
          slotIndex,
          completionDetails,
          domain,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        activeGoals?: Array<{ slotIndex: number; category: string | null; goalDescription: string | null; createdAt: string | null }>;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to complete goal.');
      const next = ([1, 2, 3] as GoalSlot[]).map((slot) => {
        const existing = payload.activeGoals?.find((entry) => entry.slotIndex === slot);
        return parseStoredGoalDescription(existing?.category ?? null, existing?.goalDescription ?? null, slot, existing?.createdAt ?? null);
      });
      setPlanGoals(next);
      setMessage(`Goal ${slotIndex} marked complete.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to complete goal.');
    } finally {
      setGoalSavingSlot(null);
    }
  }

  async function deleteGoal(slotIndex: GoalSlot) {
    if (!activePlanPlayerId) {
      setMessage('Select a player first.');
      return;
    }
    if (!window.confirm(`Delete Goal ${slotIndex}?`)) return;
    setGoalSavingSlot(slotIndex);
    setMessage('');
    try {
      const response = await fetch('/api/player/plan-goals', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: activePlanPlayerId,
          slotIndex,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        activeGoals?: Array<{ slotIndex: number; category: string | null; goalDescription: string | null; createdAt: string | null }>;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete goal.');
      const next = ([1, 2, 3] as GoalSlot[]).map((slot) => {
        const existing = payload.activeGoals?.find((entry) => entry.slotIndex === slot);
        return parseStoredGoalDescription(existing?.category ?? null, existing?.goalDescription ?? null, slot, existing?.createdAt ?? null);
      });
      setPlanGoals(next);
      setMessage(`Goal ${slotIndex} deleted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete goal.');
    } finally {
      setGoalSavingSlot(null);
    }
  }

  async function generateAutomatedGoals(options?: { forceClearExisting?: boolean; statusLabel?: string }) {
    const dashboardName = (selectedDashboardPlayerName || selectedPlayerName || '').trim();
    if (!dashboardName) {
      setMessage('Select a player first.');
      return;
    }
    if (domain !== 'Pitching') {
      setMessage('Automated player plans are currently available for Pitching only.');
      return;
    }
    setAutomationLoading(true);
    setMessage(options?.statusLabel ?? 'Building automated plan...');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      let response = await fetch('/api/player/plan-goals/automated', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          playerId: resolvedAutomationPlayerId > 0 ? resolvedAutomationPlayerId : undefined,
          dashboardPlayerName: dashboardName,
          percentileSource: automationPercentileSource,
          clearExisting: Boolean(options?.forceClearExisting),
        }),
      });
      let payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        activeGoals?: Array<{ slotIndex: number; category: string | null; goalDescription: string | null; createdAt: string | null }>;
        generated?: number;
      };
      const missingCache =
        !response.ok &&
        response.status === 400 &&
        String(payload.error ?? '').toLowerCase().includes('no automation cache found');
      const staleCache = !response.ok && response.status === 409;
      if (missingCache || staleCache) {
        setMessage('Refreshing automated data and retrying...');
        const refreshResponse = await fetch('/api/player/plan-goals/automated/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: resolvedAutomationPlayerId > 0 ? resolvedAutomationPlayerId : undefined,
            dashboardPlayerName: dashboardName,
            percentileSource: automationPercentileSource,
            sessionType: automationSessionType,
            stuffBase: automationStuffBase,
            startDate: automationStartDate,
            endDate: automationEndDate,
          }),
        });
        const refreshPayload = (await refreshResponse.json().catch(() => ({}))) as { error?: string };
        if (!refreshResponse.ok) throw new Error(refreshPayload.error ?? 'Failed to refresh automated cache.');
        response = await fetch('/api/player/plan-goals/automated', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            playerId: resolvedAutomationPlayerId > 0 ? resolvedAutomationPlayerId : undefined,
            dashboardPlayerName: dashboardName,
            percentileSource: automationPercentileSource,
            clearExisting: Boolean(options?.forceClearExisting),
          }),
        });
        payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          activeGoals?: Array<{ slotIndex: number; category: string | null; goalDescription: string | null; createdAt: string | null }>;
          generated?: number;
        };
      }
      if (!response.ok) throw new Error(payload.error ?? 'Failed to generate automated goals.');
      const payloadGoals = Array.isArray(payload.activeGoals) ? payload.activeGoals : [];
      if (payloadGoals.length) {
        const next = ([1, 2, 3] as GoalSlot[]).map((slot) => {
          const existing = payloadGoals.find((entry) => entry.slotIndex === slot);
          return parseStoredGoalDescription(existing?.category ?? null, existing?.goalDescription ?? null, slot, existing?.createdAt ?? null);
        });
        setPlanGoals(next);
        setMessage(`Automated plan created (${payload.generated ?? next.filter((goal) => Boolean(goal.category)).length} goals).`);
        return;
      }
      try {
        const refreshPlayerId = Number((payload as { playerId?: number }).playerId ?? resolvedAutomationPlayerId);
        if (!Number.isFinite(refreshPlayerId) || refreshPlayerId <= 0) throw new Error('Automated plan saved but player link could not be resolved.');
        const refreshResponse = await fetch(`/api/player/plan-goals?playerId=${refreshPlayerId}`, { cache: 'no-store' });
        const refreshPayload = (await refreshResponse.json().catch(() => ({}))) as {
          activeGoals?: Array<{ slotIndex: number; category: string | null; goalDescription: string | null; createdAt: string | null }>;
          error?: string;
        };
        if (!refreshResponse.ok) throw new Error(refreshPayload.error ?? 'Failed to refresh automated goals.');
        const next = ([1, 2, 3] as GoalSlot[]).map((slot) => {
          const existing = refreshPayload.activeGoals?.find((entry) => entry.slotIndex === slot);
          return parseStoredGoalDescription(existing?.category ?? null, existing?.goalDescription ?? null, slot, existing?.createdAt ?? null);
        });
        setPlanGoals(next);
        setMessage(`Automated plan created (${payload.generated ?? next.filter((goal) => Boolean(goal.category)).length} goals).`);
      } catch {
        const next = ([1, 2, 3] as GoalSlot[]).map((slot) => {
          const existing = payload.activeGoals?.find((entry) => entry.slotIndex === slot);
          return parseStoredGoalDescription(existing?.category ?? null, existing?.goalDescription ?? null, slot, existing?.createdAt ?? null);
        });
        setPlanGoals(next);
        setMessage(`Automated plan created (${payload.generated ?? next.filter((goal) => Boolean(goal.category)).length} goals).`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error && error.name === 'AbortError'
          ? 'Automated plan timed out after 45s. Try again; if it repeats, we need to trim backend query load.'
          : error instanceof Error
            ? error.message
            : 'Failed to generate automated goals.';
      setMessage(errorMessage);
    } finally {
      window.clearTimeout(timeout);
      setAutomationLoading(false);
    }
  }

  function goalHeaderStats(goal: GoalDraft): { average: number | null; recency2: number | null; statLabel: string } {
    const points = goalCharts[goal.slotIndex]?.points ?? [];
    const series = buildGoalMetricSeries(goal, points);
    if (!series.length) return { average: null, recency2: null, statLabel: goalStatLabel(goal) };
    const average = series.reduce((sum, row) => sum + row.value, 0) / series.length;
    const lastTwo = series.slice(-2);
    const recency2 = lastTwo.length ? lastTwo.reduce((sum, row) => sum + row.value, 0) / lastTwo.length : null;
    return { average, recency2, statLabel: goalStatLabel(goal) };
  }

  function renderGoalStatTable(goal: GoalDraft) {
    const points = goalCharts[goal.slotIndex]?.points ?? [];
    const series = buildGoalMetricSeries(goal, points).slice().sort((a, b) => b.date.localeCompare(a.date));
    if (!series.length) return <p className="portal-muted-text" style={{ margin: '6px 0 0 0' }}>No stat rows for current filters.</p>;
    const statLabel = goalStatLabel(goal);
    const targetValue = goal.targetValue.trim();
    const target = targetValue.length > 0 && Number.isFinite(Number(targetValue)) ? Number(targetValue) : null;
    const PAGE_SIZE = 5;
    const page = goalStatPage[goal.slotIndex] ?? 0;
    const totalPages = Math.ceil(series.length / PAGE_SIZE);
    const pageRows = series.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    return (
      <div style={{ marginTop: 8, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', margin: 0 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.12)', padding: '6px 8px', fontSize: 12 }}>Date</th>
              <th style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.12)', padding: '6px 8px', fontSize: 12 }}>{statLabel}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const meetsTarget = goalMeetsTarget(goal, row.value, target);
              return (
                <tr key={`goal-stat-row-${goal.slotIndex}-${row.date}`}>
                  <td style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '6px 8px', fontSize: 12 }}>{formatMdyy(row.date)}</td>
                  <td style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '6px 8px', fontSize: 12, color: meetsTarget === null ? 'inherit' : meetsTarget ? '#22c55e' : '#ef4444', fontWeight: meetsTarget === null ? 500 : 700 }}>
                    {fmtGoalValueForGoal(goal, row.value)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {totalPages > 1 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '6px 8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '2px 8px', fontSize: 12 }}
              disabled={page === 0}
              onClick={() => setGoalStatPage((prev) => ({ ...prev, [goal.slotIndex]: page - 1 }))}
            >
              ←
            </button>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{page + 1} / {totalPages}</span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '2px 8px', fontSize: 12 }}
              disabled={page >= totalPages - 1}
              onClick={() => setGoalStatPage((prev) => ({ ...prev, [goal.slotIndex]: page + 1 }))}
            >
              →
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderGoalChart(goal: GoalDraft) {
    const state = goalCharts[goal.slotIndex];
    if (!state || state.loading) return <p className="portal-muted-text" style={{ margin: 0 }}>Loading chart...</p>;
    if (state.error) return <p className="auth-error" style={{ margin: 0 }}>{state.error}</p>;
    const points = state.points;
    if (!points.length) return <p className="portal-muted-text" style={{ margin: 0 }}>No chart data for current filters.</p>;
    const num = (point: Record<string, unknown>, ...keys: string[]) => {
      for (const key of keys) {
        const value = toNum(point[key]);
        if (value !== null) return value;
      }
      return null;
    };
    const avgByType = Array.from(
      points.reduce((map, point) => {
        const pitchType = String(point.pitch_type ?? 'Undefined');
        const existing = map.get(pitchType) ?? {
          pitch_type: pitchType,
          count: 0,
          hb: 0,
          ivb: 0,
          release_side: 0,
          release_height: 0,
          velo: 0,
          extension: 0,
          stuff_plus: 0,
          hbN: 0,
          ivbN: 0,
          rsN: 0,
          rhN: 0,
          vN: 0,
          exN: 0,
          stN: 0,
        };
        existing.count += 1;
        const hb = num(point, 'hb');
        const ivb = num(point, 'ivb');
        const rs = num(point, 'release_side', 'rel_side');
        const rh = num(point, 'release_height', 'rel_height');
        const velo = num(point, 'velo', 'rel_speed');
        const ext = num(point, 'extension', 'ext_value');
        const stuff = num(point, 'stuff_plus');
        if (hb !== null) {
          existing.hb += hb;
          existing.hbN += 1;
        }
        if (ivb !== null) {
          existing.ivb += ivb;
          existing.ivbN += 1;
        }
        if (rs !== null) {
          existing.release_side += rs;
          existing.rsN += 1;
        }
        if (rh !== null) {
          existing.release_height += rh;
          existing.rhN += 1;
        }
        if (velo !== null) {
          existing.velo += velo;
          existing.vN += 1;
        }
        if (ext !== null) {
          existing.extension += ext;
          existing.exN += 1;
        }
        if (stuff !== null) {
          existing.stuff_plus += stuff;
          existing.stN += 1;
        }
        map.set(pitchType, existing);
        return map;
      }, new Map<string, { pitch_type: string; count: number; hb: number; ivb: number; release_side: number; release_height: number; velo: number; extension: number; stuff_plus: number; hbN: number; ivbN: number; rsN: number; rhN: number; vN: number; exN: number; stN: number }>())
    ).map(([, row]) => ({
      pitch_type: row.pitch_type,
      hb: row.hbN ? row.hb / row.hbN : null,
      ivb: row.ivbN ? row.ivb / row.ivbN : null,
      release_side: row.rsN ? row.release_side / row.rsN : null,
      release_height: row.rhN ? row.release_height / row.rhN : null,
      velo: row.vN ? row.velo / row.vN : null,
      extension: row.exN ? row.extension / row.exN : null,
      stuff_plus: row.stN ? row.stuff_plus / row.stN : null,
    }));

    if (goal.chartType === 'Release') {
      const w = 520;
      const h = 360;
      const pad = 22;
      const xMin = -4;
      const xMax = 4;
      const yMin = 0;
      const yMax = Math.max(6, ...points.map((p) => num(p, 'release_height', 'rel_height') ?? 0)) + 0.2;
      const plotW = w - pad * 2;
      const plotH = h - pad * 2;
      const xRange = xMax - xMin;
      const yRange = yMax - yMin;
      const scale = Math.min(plotW / xRange, plotH / yRange);
      const drawnW = xRange * scale;
      const drawnH = yRange * scale;
      const leftPad = (w - drawnW) / 2;
      const topPad = (h - drawnH) / 2;
      const px = (x: number) => leftPad + (x - xMin) * scale;
      const py = (y: number) => topPad + (yMax - y) * scale;
      const moundX = Array.from({ length: 81 }, (_, i) => -4 + (i / 80) * 8);
      const moundPts = [...moundX.map((x) => `${px(x)},${py(0.83 * (1 - (x / 4) ** 2))}`), ...moundX.slice().reverse().map((x) => `${px(x)},${py(0)}`)].join(' ');
      const rubberLeft = px(-1);
      const rubberRight = px(1);
      const rubberTop = py(0.9);
      const rubberBottom = py(0.76);
      const xTicks = [-4, -2, 0, 2, 4];
      const yTicks = [0, 1, 2, 3, 4, 5, 6];
      return (
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 360 }} onMouseLeave={() => setGoalChartHover(null)}>
          {xTicks.map((tick) => (
            <line key={`r-x-grid-${goal.slotIndex}-${tick}`} x1={px(tick)} y1={py(yMin)} x2={px(tick)} y2={py(yMax)} stroke="rgba(255,255,255,0.18)" />
          ))}
          {yTicks.map((tick) => (
            <line key={`r-y-grid-${goal.slotIndex}-${tick}`} x1={px(xMin)} y1={py(tick)} x2={px(xMax)} y2={py(tick)} stroke="rgba(255,255,255,0.18)" />
          ))}
          <polygon points={moundPts} fill="tan" opacity={0.5} />
          <rect
            x={Math.min(rubberLeft, rubberRight)}
            y={Math.min(rubberTop, rubberBottom)}
            width={Math.abs(rubberRight - rubberLeft)}
            height={Math.abs(rubberBottom - rubberTop)}
            fill="#ffffff"
            stroke="rgba(17,24,39,0.55)"
            strokeWidth={1}
            rx={2}
          />
          <line x1={px(0)} y1={py(0)} x2={px(0)} y2={py(yMax)} stroke="rgba(255,255,255,0.85)" />
          <line x1={px(xMin)} y1={py(0)} x2={px(xMax)} y2={py(0)} stroke="rgba(255,255,255,0.85)" />
          {xTicks.map((tick) => (
            <text key={`r-x-label-${goal.slotIndex}-${tick}`} x={px(tick)} y={py(yMin) + 20} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.9)">
              {tick}
            </text>
          ))}
          {yTicks.map((tick) => (
            <text key={`r-y-label-${goal.slotIndex}-${tick}`} x={px(xMin) - 8} y={py(tick) + 3.5} textAnchor="end" fontSize={10.5} fill="rgba(255,255,255,0.9)">
              {tick}
            </text>
          ))}
          {points
            .filter((p) => num(p, 'release_side', 'rel_side') !== null && num(p, 'release_height', 'rel_height') !== null)
            .map((p, i) => {
              const color = GOAL_CHART_COLORS[String(p.pitch_type ?? 'Undefined')] ?? '#9ca3af';
              return (
                <circle
                  key={`goal-release-p-${goal.slotIndex}-${i}`}
                  cx={px(num(p, 'release_side', 'rel_side') ?? 0)}
                  cy={py(num(p, 'release_height', 'rel_height') ?? 0)}
                  r={3.2}
                  fill={color}
                  stroke="rgba(0,0,0,0.52)"
                  strokeWidth={1.1}
                  opacity={0.42}
                  onMouseMove={(event) => setGoalChartHover({ x: event.clientX, y: event.clientY, text: releaseTooltipText(p), bg: color })}
                  onMouseLeave={() => setGoalChartHover(null)}
                />
              );
            })}
          {avgByType
            .filter((p) => p.release_side !== null && p.release_height !== null)
            .map((p) => {
              const color = GOAL_CHART_COLORS[p.pitch_type] ?? '#9ca3af';
              return (
                <circle
                  key={`goal-release-a-${goal.slotIndex}-${p.pitch_type}`}
                  cx={px(Number(p.release_side))}
                  cy={py(Number(p.release_height))}
                  r={8.6}
                  fill={color}
                  stroke="rgba(0,0,0,0.68)"
                  strokeWidth={2.2}
                  opacity={0.98}
                  onMouseMove={(event) =>
                    setGoalChartHover({
                      x: event.clientX,
                      y: event.clientY,
                      text: `${p.pitch_type}\nHeight: ${p.release_height?.toFixed(1) ?? '-'} ft\nSide: ${p.release_side?.toFixed(1) ?? '-'} ft\nExtension: ${
                        p.extension?.toFixed(1) ?? '-'
                      } ft`,
                      bg: color,
                    })
                  }
                  onMouseLeave={() => setGoalChartHover(null)}
                />
              );
            })}
        </svg>
      );
    }

    if (goal.chartType === 'Movement Plot') {
      const w = 520;
      const h = 360;
      const pad = 22;
      const xMin = -25;
      const xMax = 25;
      const yMin = -25;
      const yMax = 25;
      const plotW = w - pad * 2;
      const plotH = h - pad * 2;
      const xRange = xMax - xMin;
      const yRange = yMax - yMin;
      const scale = Math.min(plotW / xRange, plotH / yRange);
      const drawnW = xRange * scale;
      const drawnH = yRange * scale;
      const leftPad = (w - drawnW) / 2;
      const topPad = (h - drawnH) / 2;
      const px = (x: number) => leftPad + (x - xMin) * scale;
      const py = (y: number) => topPad + (yMax - y) * scale;
      const ticks = [-20, -10, 0, 10, 20];
      return (
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 360 }} onMouseLeave={() => setGoalChartHover(null)}>
          {ticks.map((tick) => (
            <line key={`m-x-grid-${goal.slotIndex}-${tick}`} x1={px(tick)} y1={py(yMin)} x2={px(tick)} y2={py(yMax)} stroke="rgba(255,255,255,0.18)" />
          ))}
          {ticks.map((tick) => (
            <line key={`m-y-grid-${goal.slotIndex}-${tick}`} x1={px(xMin)} y1={py(tick)} x2={px(xMax)} y2={py(tick)} stroke="rgba(255,255,255,0.18)" />
          ))}
          <line x1={px(xMin)} y1={py(0)} x2={px(xMax)} y2={py(0)} stroke="rgba(255,255,255,0.85)" />
          <line x1={px(0)} y1={py(yMin)} x2={px(0)} y2={py(yMax)} stroke="rgba(255,255,255,0.85)" />
          {ticks.map((tick) => (
            <text key={`m-x-label-${goal.slotIndex}-${tick}`} x={px(tick)} y={py(yMin) + 20} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.9)">
              {tick}
            </text>
          ))}
          {ticks.map((tick) => (
            <text key={`m-y-label-${goal.slotIndex}-${tick}`} x={px(xMin) - 8} y={py(tick) + 3.5} textAnchor="end" fontSize={10.5} fill="rgba(255,255,255,0.9)">
              {tick}
            </text>
          ))}
          {points
            .filter((p) => num(p, 'hb') !== null && num(p, 'ivb') !== null)
            .map((p, i) => {
              const color = GOAL_CHART_COLORS[String(p.pitch_type ?? 'Undefined')] ?? '#9ca3af';
              return (
                <circle
                  key={`goal-move-p-${goal.slotIndex}-${i}`}
                  cx={px(num(p, 'hb') ?? 0)}
                  cy={py(num(p, 'ivb') ?? 0)}
                  r={3.8}
                  fill={color}
                  stroke="rgba(0,0,0,0.52)"
                  strokeWidth={1.1}
                  opacity={0.42}
                  onMouseMove={(event) => setGoalChartHover({ x: event.clientX, y: event.clientY, text: chartTooltipText(p), bg: color })}
                  onMouseLeave={() => setGoalChartHover(null)}
                />
              );
            })}
          {avgByType
            .filter((p) => p.hb !== null && p.ivb !== null)
            .map((p) => {
              const color = GOAL_CHART_COLORS[p.pitch_type] ?? '#9ca3af';
              return (
                <circle
                  key={`goal-move-a-${goal.slotIndex}-${p.pitch_type}`}
                  cx={px(Number(p.hb))}
                  cy={py(Number(p.ivb))}
                  r={8.6}
                  fill={color}
                  stroke="rgba(0,0,0,0.68)"
                  strokeWidth={2.2}
                  opacity={0.98}
                  onMouseMove={(event) =>
                    setGoalChartHover({
                      x: event.clientX,
                      y: event.clientY,
                      text: `${p.pitch_type}\nVelo: ${p.velo?.toFixed(1) ?? '-'} mph\nIVB: ${p.ivb?.toFixed(1) ?? '-'} in\nHB: ${p.hb?.toFixed(1) ?? '-'} in\nStuff+: ${
                        p.stuff_plus?.toFixed(1) ?? '-'
                      }`,
                      bg: color,
                    })
                  }
                  onMouseLeave={() => setGoalChartHover(null)}
                />
              );
            })}
        </svg>
      );
    }

    if (goal.chartType === 'Pitch Chart' || goal.chartType === 'HeatMaps') {
      const w = 520;
      const h = 360;
      const pad = 16;
      const xMin = -2.5;
      const xMax = 2.5;
      const yMin = 0;
      const yMax = 4.5;
      const plotW = w - pad * 2;
      const plotH = h - pad * 2;
      const xRange = xMax - xMin;
      const yRange = yMax - yMin;
      const scale = Math.min(plotW / xRange, plotH / yRange);
      const drawnW = xRange * scale;
      const drawnH = yRange * scale;
      const leftPad = (w - drawnW) / 2;
      const topPad = (h - drawnH) / 2;
      const px = (x: number) => leftPad + (x - xMin) * scale;
      const py = (y: number) => topPad + (yMax - y) * scale;
      const strikeBottom = 1.5;
      const strikeTop = 3.6;
      const strikeLeft = -0.88;
      const strikeRight = 0.88;
      const compRadiusFt = 1.5;
      const strikeCenterX = (strikeLeft + strikeRight) / 2;
      const strikeCenterY = (strikeBottom + strikeTop) / 2;
      const compBottom = strikeCenterY - compRadiusFt;
      const compTop = strikeCenterY + compRadiusFt;
      const compLeft = strikeCenterX - compRadiusFt;
      const compRight = strikeCenterX + compRadiusFt;
      const selectedHeatmapView: HeatmapView = goal.heatmapView || 'Frequency';

      const pitchPoints = points.filter((p) => num(p, 'plate_side') !== null && num(p, 'plate_height') !== null);

      const glyph = (result: string, x: number, y: number, fill: string, key: string, title: string) => {
        const hoverProps = {
          onMouseMove: (event: { clientX: number; clientY: number }) => setGoalChartHover({ x: event.clientX, y: event.clientY, text: title, bg: fill }),
          onMouseLeave: () => setGoalChartHover(null),
        };
        if (result === 'Ball') return <circle key={key} cx={x} cy={y} r={8.4} fill="rgba(0,0,0,0.001)" stroke={fill} strokeWidth={2.1} {...hoverProps} />;
        if (result === 'Foul') return <polygon key={key} points={`${x},${y - 8.1} ${x - 7.3},${y + 6.2} ${x + 7.3},${y + 6.2}`} fill="rgba(0,0,0,0.001)" stroke={fill} strokeWidth={2.1} {...hoverProps} />;
        if (result === 'Whiff') return <text key={key} x={x} y={y + 6.3} fontSize={19} textAnchor="middle" fill={fill} {...hoverProps}>★</text>;
        if (result === 'In Play (Out)') return <polygon key={key} points={`${x},${y - 8.1} ${x - 7.3},${y + 6.2} ${x + 7.3},${y + 6.2}`} fill={fill} {...hoverProps} />;
        if (result === 'In Play (Hit)' || result === 'Single' || result === 'Double' || result === 'Triple' || result === 'HomeRun')
          return <rect key={key} x={x - 6.9} y={y - 6.9} width={13.8} height={13.8} fill={fill} {...hoverProps} />;
        if (result === 'Error') return <rect key={key} x={x - 6.9} y={y - 6.9} width={13.8} height={13.8} fill="rgba(0,0,0,0.001)" stroke={fill} strokeWidth={1.9} {...hoverProps} />;
        return <circle key={key} cx={x} cy={y} r={8.4} fill={fill} {...hoverProps} />;
      };

      const cells = goal.chartType === 'HeatMaps' ? buildGoalHeatCells(points, selectedHeatmapView) : [];
      const dynamicMinVal = cells.length ? Math.min(...cells.map((c) => c.value)) : 0;
      const dynamicMaxVal = cells.length ? Math.max(...cells.map((c) => c.value)) : 1;
      const dynamicMidVal = cells.length ? cells.map((c) => c.value).sort((a, b) => a - b)[Math.floor(cells.length / 2)] : 0;
      const minVal = selectedHeatmapView === 'Whiff Rate' ? 0 : dynamicMinVal;
      const maxVal = selectedHeatmapView === 'Whiff Rate' ? 50 : dynamicMaxVal;
      const midVal = selectedHeatmapView === 'Whiff Rate' ? 25 : dynamicMidVal;
      const densityMax = Math.max(1e-9, ...cells.map((c) => c.density));
      const maxAbs = Math.max(1, ...cells.map((c) => Math.abs(c.value)));

      return (
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 360 }} onMouseLeave={() => setGoalChartHover(null)}>
          <defs>
            <clipPath id={`location-zoom-clip-goal-${goal.slotIndex}`}>
              <rect x={0} y={0} width={w} height={h} />
            </clipPath>
            <filter id={`location-heat-blur-goal-${goal.slotIndex}`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="5.4" />
            </filter>
          </defs>
          <g clipPath={`url(#location-zoom-clip-goal-${goal.slotIndex})`}>
            {goal.chartType === 'HeatMaps' && selectedHeatmapView !== 'Pitch' ? (
              <>
                <g filter={`url(#location-heat-blur-goal-${goal.slotIndex})`}>
                  {cells.map((c, i) => {
                    const cx = px(c.x + c.w / 2);
                    const cy = py(c.y + c.h / 2);
                    const radius = Math.max(7.0, c.w * scale * 5.1);
                    const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                    const normalized =
                      selectedHeatmapView === 'Run Values'
                        ? Math.abs(c.value) / maxAbs
                        : selectedHeatmapView === 'QP+'
                          ? Math.abs(c.value - 100) / 100
                          : Math.max(0, (c.value - minVal) / Math.max(1e-9, maxVal - minVal));
                    if (selectedHeatmapView !== 'Frequency' && selectedHeatmapView !== 'QP+' && densityNorm < 0.03) return null;
                    if (selectedHeatmapView !== 'Run Values' && selectedHeatmapView !== 'QP+' && normalized < 0.06) return null;
                    const fill =
                      selectedHeatmapView === 'Run Values'
                        ? c.value >= 0
                          ? `rgba(255,48,48,${0.24 + Math.abs(c.value / maxAbs) * 0.76})`
                          : `rgba(54,129,255,${0.24 + Math.abs(c.value / maxAbs) * 0.76})`
                        : selectedHeatmapView === 'QP+'
                          ? divergingColor(c.value, 0, 100, 200)
                          : selectedHeatmapView === 'Frequency'
                            ? shinyHeatSequential(normalized)
                            : divergingColor(c.value, minVal, midVal, maxVal);
                    const runValueBoost = selectedHeatmapView === 'Run Values' ? Math.pow(normalized, 0.55) : normalized;
                    return (
                      <circle
                        key={`goal-heat-blur-${goal.slotIndex}-${i}`}
                        cx={cx}
                        cy={cy}
                        r={radius}
                        fill={fill}
                        opacity={Math.max(0.3, runValueBoost * 1.25 * (selectedHeatmapView === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))}
                      />
                    );
                  })}
                </g>
                {cells.map((c, i) => {
                    const cx = px(c.x + c.w / 2);
                    const cy = py(c.y + c.h / 2);
                    const radius = Math.max(1.4, c.w * scale * 1.08);
                    const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                    const normalized =
                      selectedHeatmapView === 'Run Values'
                        ? Math.abs(c.value) / maxAbs
                        : selectedHeatmapView === 'QP+'
                          ? Math.abs(c.value - 100) / 100
                          : Math.max(0, (c.value - minVal) / Math.max(1e-9, maxVal - minVal));
                    if (selectedHeatmapView !== 'Frequency' && selectedHeatmapView !== 'QP+' && densityNorm < 0.03) return null;
                    if (selectedHeatmapView !== 'Run Values' && selectedHeatmapView !== 'QP+' && normalized < 0.06) return null;
                    const fill =
                      selectedHeatmapView === 'Run Values'
                        ? c.value >= 0
                          ? `rgba(255,48,48,${0.2 + Math.abs(c.value / maxAbs) * 0.8})`
                          : `rgba(54,129,255,${0.2 + Math.abs(c.value / maxAbs) * 0.8})`
                        : selectedHeatmapView === 'QP+'
                          ? divergingColor(c.value, 0, 100, 200)
                          : selectedHeatmapView === 'Frequency'
                            ? shinyHeatSequential(normalized)
                            : divergingColor(c.value, minVal, midVal, maxVal);
                    const runValueBoost = selectedHeatmapView === 'Run Values' ? Math.pow(normalized, 0.55) : normalized;
                    return (
                      <circle
                        key={`goal-heat-core-${goal.slotIndex}-${i}`}
                        cx={cx}
                        cy={cy}
                        r={radius}
                        fill={fill}
                        opacity={Math.max(0.2, runValueBoost * 0.72 * (selectedHeatmapView === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))}
                        onMouseMove={(event) =>
                          setGoalChartHover({
                            x: event.clientX,
                            y: event.clientY,
                            text: `${selectedHeatmapView}: ${c.value.toFixed(
                              selectedHeatmapView === 'Run Values' || selectedHeatmapView === 'Exit Velocity' || selectedHeatmapView === 'QP+' ? 2 : 1
                            )}${selectedHeatmapView.includes('Rate') ? '%' : ''}`,
                          })
                        }
                        onMouseLeave={() => setGoalChartHover(null)}
                      />
                    );
                  })}
              </>
            ) : (
              pitchPoints.map((p, i) => {
                const x = px(num(p, 'plate_side') ?? 0);
                const y = py(num(p, 'plate_height') ?? 0);
                const color = GOAL_CHART_COLORS[String(p.pitch_type ?? 'Undefined')] ?? '#9ca3af';
                const result = resultShape(String(p.pitch_call ?? ''), String(p.play_result ?? ''));
                return glyph(result, x, y, color, `goal-loc-${goal.slotIndex}-${i}`, chartTooltipText(p));
              })
            )}
            <polygon
              points={`${px(-0.75)},${py(0.55)} ${px(0.75)},${py(0.55)} ${px(0.75)},${py(0.65)} ${px(0)},${py(0.75)} ${px(-0.75)},${py(0.65)}`}
              fill="none"
              stroke="rgba(255,255,255,0.85)"
            />
            <rect x={px(compLeft)} y={py(compTop)} width={px(compRight) - px(compLeft)} height={py(compBottom) - py(compTop)} fill="none" stroke="rgba(255,255,255,0.72)" />
            <line x1={px(compLeft)} y1={py(strikeCenterY)} x2={px(strikeLeft)} y2={py(strikeCenterY)} stroke="rgba(255,255,255,0.58)" />
            <line x1={px(strikeRight)} y1={py(strikeCenterY)} x2={px(compRight)} y2={py(strikeCenterY)} stroke="rgba(255,255,255,0.58)" />
            <line x1={px(0)} y1={py(compBottom)} x2={px(0)} y2={py(strikeBottom)} stroke="rgba(255,255,255,0.58)" />
            <line x1={px(0)} y1={py(strikeTop)} x2={px(0)} y2={py(compTop)} stroke="rgba(255,255,255,0.58)" />
            <rect x={px(strikeLeft)} y={py(strikeTop)} width={px(strikeRight) - px(strikeLeft)} height={py(strikeBottom) - py(strikeTop)} fill="none" stroke="rgba(255,255,255,0.95)" />
            <line x1={px(strikeLeft + ((strikeRight - strikeLeft) / 3))} y1={py(strikeBottom)} x2={px(strikeLeft + ((strikeRight - strikeLeft) / 3))} y2={py(strikeTop)} stroke="rgba(255,255,255,0.45)" />
            <line x1={px(strikeLeft + (((strikeRight - strikeLeft) * 2) / 3))} y1={py(strikeBottom)} x2={px(strikeLeft + (((strikeRight - strikeLeft) * 2) / 3))} y2={py(strikeTop)} stroke="rgba(255,255,255,0.45)" />
            <line x1={px(strikeLeft)} y1={py(strikeBottom + ((strikeTop - strikeBottom) / 3))} x2={px(strikeRight)} y2={py(strikeBottom + ((strikeTop - strikeBottom) / 3))} stroke="rgba(255,255,255,0.45)" />
            <line x1={px(strikeLeft)} y1={py(strikeBottom + (((strikeTop - strikeBottom) * 2) / 3))} x2={px(strikeRight)} y2={py(strikeBottom + (((strikeTop - strikeBottom) * 2) / 3))} stroke="rgba(255,255,255,0.45)" />
          </g>
        </svg>
      );
    }

    const series = buildGoalMetricSeries(goal, points);
    if (!series.length) return <p className="portal-muted-text" style={{ margin: 0 }}>No trend data for current filters.</p>;
    const width = 560;
    const height = 360;
    const left = 58;
    const right = 20;
    const top = 24;
    const bottom = series.length > 4 ? 88 : 70;
    const targetRaw = goal.targetValue.trim();
    const target = targetRaw.length > 0 ? Number(targetRaw) : Number.NaN;
    const values = series.map((point) => point.value);
    const domainValues = Number.isFinite(target) ? [...values, target] : values;
    const domainMin = Math.min(...domainValues);
    const domainMax = Math.max(...domainValues);
    const rawSpan = domainMin === domainMax ? Math.max(1, Math.abs(domainMax) * 0.08) : domainMax - domainMin;
    const yMin = domainMin - rawSpan * 0.08;
    const yMax = domainMax + rawSpan * 0.08;
    const px = (index: number) =>
      series.length === 1 ? width / 2 : left + (index / (series.length - 1)) * (width - left - right);
    const py = (value: number) => top + ((yMax - value) / Math.max(1e-6, yMax - yMin)) * (height - top - bottom);
    const targetY = Number.isFinite(target) ? py(target) : null;
    const path = series.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${px(idx).toFixed(1)} ${py(point.value).toFixed(1)}`).join(' ');
    const xTickIndexes = series.map((_, index) => index);
    const rotateDateLabels = series.length > 4;
    const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * (yMax - yMin));
    const yLabel = goalStatLabel(goal);

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: GOAL_VISUAL_HEIGHT }}>
        {yTicks.map((tick, i) => (
          <g key={`goal-trend-y-${goal.slotIndex}-${i}`}>
            <line x1={left} y1={py(tick)} x2={width - right} y2={py(tick)} stroke="rgba(255,255,255,0.16)" />
            <text x={left - 8} y={py(tick) + 3.5} textAnchor="end" fontSize={10.5} fill="rgba(255,255,255,0.9)">
              {tick.toFixed(1)}
            </text>
          </g>
        ))}
        {xTickIndexes.map((index) => (
          <g key={`goal-trend-x-${goal.slotIndex}-${index}`}>
            <line x1={px(index)} y1={top} x2={px(index)} y2={height - bottom} stroke="rgba(255,255,255,0.12)" />
            <text
              x={px(index)}
              y={height - bottom + (rotateDateLabels ? 22 : 16)}
              textAnchor={rotateDateLabels ? 'end' : 'middle'}
              fontSize={10.5}
              fill="rgba(255,255,255,0.9)"
              transform={rotateDateLabels ? `rotate(-35 ${px(index)} ${height - bottom + 22})` : undefined}
            >
              {formatMdyy(series[index].date)}
            </text>
          </g>
        ))}
        <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} stroke="rgba(255,255,255,0.35)" />
        <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="rgba(255,255,255,0.35)" />
        {targetY !== null ? (
          <line x1={left} y1={targetY} x2={width - right} y2={targetY} stroke="rgba(255,255,255,0.9)" strokeWidth={2} strokeDasharray="6 6" />
        ) : null}
        <path d={path} fill="none" stroke="#ef4444" strokeWidth={2.2} />
        {series.map((point, idx) => (
          <circle
            key={`goal-trend-dot-${goal.slotIndex}-${idx}`}
            cx={px(idx)}
            cy={py(point.value)}
            r={3.4}
            fill="#ef4444"
            onMouseMove={(event) =>
              setGoalChartHover({
                x: event.clientX,
                y: event.clientY,
                text: `Date: ${formatMdyy(point.date)}\n${yLabel}: ${fmtGoalValueForGoal(goal, point.value)}`,
                bg: '#ef4444',
              })
            }
            onMouseLeave={() => setGoalChartHover(null)}
          />
        ))}
        <text x={(left + width - right) / 2} y={height - 8} textAnchor="middle" fontSize={12} fill="rgba(255,255,255,0.9)">
          Date
        </text>
        <text transform={`translate(16 ${(top + height - bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fill="rgba(255,255,255,0.9)">
          {yLabel}
        </text>
      </svg>
    );
  }

  return (
    <section ref={pageRef} className="portal-player-plans-suite" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={() => void downloadPlayerPlanPdf()} disabled={isExportingPlanPdf}>
          {isExportingPlanPdf ? 'Downloading PDF...' : 'Download PDF'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setPlanFiltersVisible((prev) => !prev)}>
          {planFiltersVisible ? 'Hide Filters' : 'Show Filters'}
        </button>
      </div>

      {planFiltersVisible ? (
      <article className="portal-admin-card">
        <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))' }}>
          <label>
            Domain
            <select value={domain} onChange={(event) => setDomain((event.target.value as Domain) || 'Pitching')}>
              {DOMAIN_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            Player
            <input
              list="player-plans-player-options"
              value={playerInputName}
              onChange={(event) => setPlayerInputName(event.target.value)}
              onBlur={commitPlayerInput}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitPlayerInput();
                }
              }}
              placeholder={dashboardPlayerOptions.length ? 'Type or choose player...' : 'No players available'}
            />
            <datalist id="player-plans-player-options">
              {dashboardPlayerOptions.map((playerName) => (
                <option key={playerName} value={playerName} />
              ))}
            </datalist>
          </label>
          <label>
            Header Notes
            <input value={headerNote} onChange={(event) => setHeaderNote(event.target.value)} placeholder="Date / cycle / context..." />
          </label>
          <label>
            # of Goals
            <select value={goalCount} onChange={(event) => setGoalCount(Number(event.target.value) as 1 | 2 | 3)}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
        </div>
        <div
          className="portal-form-grid"
          style={{ gridTemplateColumns: domain === 'Pitching' ? 'repeat(6, minmax(170px, 1fr))' : '1fr', marginTop: 10 }}
        >
          <label>
            Goal Mode
            <select value={planMode} onChange={(event) => setPlanMode((event.target.value as PlanMode) || 'Manual')}>
              <option value="Manual">Manual</option>
              <option value="Automated">Automated</option>
            </select>
          </label>
          {domain === 'Pitching' && planMode === 'Automated' ? (
            <>
              <label>
                Linked Player
                <select value={automationLinkedPlayerId} onChange={(event) => setAutomationLinkedPlayerId(event.target.value)}>
                  <option value="">Use current player</option>
                  {linkedPlayerSelectOptions.map((player) => (
                    <option key={player.value} value={player.value}>
                      {player.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Session Type
                <select value={automationSessionType} onChange={(event) => setAutomationSessionType(event.target.value || 'Season')}>
                  <option value="Season">Season</option>
                  <option value="Game">Game</option>
                  <option value="Live">Live</option>
                  <option value="Bullpen">Bullpen</option>
                </select>
              </label>
              <label>
                Stuff+ Base
                <select value={automationStuffBase} onChange={(event) => setAutomationStuffBase(event.target.value === 'Sinker' ? 'Sinker' : 'Fastball')}>
                  <option value="Fastball">Fastball</option>
                  <option value="Sinker">Sinker</option>
                </select>
              </label>
              <label>
                Start Date
                <NativeDateInput value={automationStartDate} onChange={setAutomationStartDate} ariaLabel="Start Date" />
              </label>
              <label>
                End Date
                <NativeDateInput value={automationEndDate} onChange={setAutomationEndDate} ariaLabel="End Date" />
              </label>
              <label>
                Automation
                <div style={{ display: 'grid', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    onClick={() => void generateAutomatedGoals()}
                    disabled={automationLoading}
                  >
                    {automationLoading ? 'Building Goals...' : 'Create/Update Automated Goals'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ width: '100%' }}
                    onClick={() => void generateAutomatedGoals({ forceClearExisting: true, statusLabel: 'Refreshing goals from latest stats...' })}
                    disabled={automationLoading}
                  >
                    {automationLoading ? 'Rebuilding...' : 'Rebuild From Current Numbers (Overwrite)'}
                  </button>
                </div>
              </label>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
                <p className="portal-muted-text" style={{ margin: 0 }}>
                  Uses selected pitcher split data.
                  {!resolvedAutomationPlayerId ? ' Linked player selection is required.' : ''}
                </p>
              </div>
            </>
          ) : null}
        </div>
      </article>
      ) : null}

      <article className="portal-admin-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1.35rem', fontWeight: 800, letterSpacing: '0.02em', opacity: 0.95 }}>Player Development Plan</div>
        <h2 style={{ margin: '4px 0 0 0', fontSize: '1.12rem', fontWeight: 650 }}>{centeredName || '-'}</h2>
        <div style={{ marginTop: 8, fontSize: '0.9rem', letterSpacing: '0.02em', opacity: 0.8, fontStyle: 'italic' }}>
          {headerNote.trim() || ' '}
        </div>
      </article>

      {loadingPlayers || loadingGoals ? <p className="portal-muted-text">Loading player plan data...</p> : null}
      {message ? <p className={message.includes('Failed') || message.includes('Unauthorized') ? 'auth-error' : 'auth-message'}>{message}</p> : null}

      <article className="portal-admin-card">
        {domain === 'Pitching' && planMode === 'Automated' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {automationTreeLoading ? <p className="portal-muted-text" style={{ margin: 0 }}>Loading decision tree metrics...</p> : null}
            {automationTreeError ? <p className="auth-error" style={{ margin: 0 }}>{automationTreeError}</p> : null}
            {automationTree ? (
              <article
                className="portal-day-card"
                style={{ display: 'grid', gap: 12, padding: 12, border: '1px solid rgba(255,255,255,0.14)' }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(260px, 1fr))', gap: 12 }}>
                  {([
                    {
                      key: 'k',
                      title: 'K%',
                      color: treeMetricColor('k', automationTree.overallK.value),
                      valueText: formatMetricValue(automationTree.overallK.value),
                      branchA: { label: 'Whiff%', lowerBetter: false, sideMetric: 'whiffPct' as const, rows: 'pitchesAll' as const },
                      branchB: { label: 'Stuff+', lowerBetter: false, sideMetric: null, rows: 'pitchesAll' as const },
                    },
                    {
                      key: 'bb',
                      title: 'BB%',
                      color: treeMetricColor('bb', automationTree.overallBB.value),
                      valueText: formatMetricValue(automationTree.overallBB.value),
                      branchA: { label: 'FPS%', lowerBetter: false, sideMetric: 'fpsPct' as const, rows: 'pitches00' as const },
                      branchB: { label: 'E+A%', lowerBetter: false, sideMetric: 'eaPct' as const, rows: 'pitchesAll' as const },
                    },
                  ] as const).map((root) => (
                    <div key={root.key} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 10 }}>
                      <div style={{ textAlign: 'center', marginBottom: 10 }}>
                        <div style={{ display: 'inline-grid', placeItems: 'center', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 999, padding: '8px 18px', fontWeight: 800, minWidth: 104, minHeight: 54 }}>
                          <div style={{ lineHeight: 1.05, color: 'rgba(255,255,255,0.95)' }}>{root.title}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3, lineHeight: 1.05, color: root.color }}>{root.valueText}</div>
                        </div>
                      </div>
                      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div style={{ position: 'absolute', left: '50%', top: -6, width: 1, height: 14, background: 'rgba(255,255,255,0.25)' }} />
                        <div style={{ position: 'absolute', left: '25%', right: '25%', top: 8, height: 1, background: 'rgba(255,255,255,0.25)' }} />
                        {([
                          { side: 'Left', data: automationTree.left, label: 'LHH' },
                          { side: 'Right', data: automationTree.right, label: 'RHH' },
                        ] as const).map((side) => (
                          <div key={`${root.key}-${side.side}`} style={{ position: 'relative', display: 'grid', gap: 8, paddingTop: 10, gridTemplateRows: '56px auto' }}>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ display: 'inline-grid', placeItems: 'center', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: '4px 10px', fontWeight: 700, minWidth: 120, minHeight: 54 }}>
                                {side.label}{' '}
                                <span style={{ color: root.key === 'k' ? treeMetricColor('k', side.data.kPct.value) : treeMetricColor('bb', side.data.bbPct.value) }}>
                                  {root.key === 'k' ? formatMetricValue(side.data.kPct.value) : formatMetricValue(side.data.bbPct.value)}
                                </span>
                              </div>
                            </div>
                            <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'start', paddingTop: 18 }}>
                              <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: 18, background: 'rgba(255,255,255,0.2)' }} />
                              <div style={{ position: 'absolute', left: '25%', right: '25%', top: 18, height: 1, background: 'rgba(255,255,255,0.2)' }} />
                              {[root.branchA, root.branchB].map((branch) => {
                                const allRows = side.data.pitchesAll;
                                const zeroRows = side.data.pitches00;
                                const topMetric =
                                  branch.sideMetric === 'whiffPct'
                                    ? {
                                        value: side.data.whiffPct.value ?? weightedPitchMetric(allRows, 'whiff', 'value'),
                                        avg: side.data.whiffPct.avg ?? weightedPitchMetric(allRows, 'whiff', 'avg'),
                                      }
                                    : branch.sideMetric === 'fpsPct'
                                      ? {
                                          value: side.data.fpsPct.value ?? weightedPitchMetric(zeroRows, 'strike', 'value'),
                                          avg: side.data.fpsPct.avg ?? weightedPitchMetric(zeroRows, 'strike', 'avg'),
                                        }
                                    : branch.sideMetric === 'eaPct'
                                      ? side.data.eaPct
                                      : branch.label === 'Stuff+'
                                          ? { value: weightedMetricFromPitches(side.data.pitchesAll, 'stuff'), avg: weightedMetricAvgFromPitches(side.data.pitchesAll, 'stuff') }
                                          : null;
                                const rows = side.data[branch.rows];
                                return (
                                  <div key={`${root.key}-${side.side}-${branch.label}`} style={{ position: 'relative', display: 'grid', gap: 5, paddingTop: 14, minWidth: 0, gridTemplateRows: '44px auto' }}>
                                    <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: 14, background: 'rgba(255,255,255,0.2)' }} />
                                    <div
                                      style={{
                                        border: '1px solid rgba(255,255,255,0.16)',
                                        borderRadius: 8,
                                        padding: '6px 6px',
                                        fontWeight: 650,
                                        textAlign: 'center',
                                        minHeight: 42,
                                        display: 'grid',
                                        alignContent: 'center',
                                      }}
                                    >
                                      <div style={{ lineHeight: 1.05, color: 'rgba(255,255,255,0.95)' }}>{branch.label}</div>
                                      {topMetric ? (
                                        <div
                                          style={{
                                            fontSize: 12,
                                            fontWeight: 700,
                                            marginTop: 3,
                                            lineHeight: 1.05,
                                            color:
                                              branch.label === 'Whiff%'
                                                ? treeMetricColor('whiff_overall', topMetric?.value ?? null)
                                                : branch.label === 'Stuff+'
                                                  ? treeMetricColor('stuff_overall', topMetric?.value ?? null)
                                                  : branch.label === 'FPS%'
                                                    ? treeMetricColor('fps', topMetric?.value ?? null)
                                                    : metricColor(topMetric?.value ?? null, topMetric?.avg ?? null, false),
                                          }}
                                        >
                                          {formatMetricValue(topMetric.value, branch.label === 'Stuff+' ? 'plus' : 'pct')}
                                        </div>
                                      ) : null}
                                    </div>
                                    <div style={{ display: 'grid', gap: 4 }}>
                                      {rows.length === 0 ? (
                                        <div style={{ fontSize: 12, opacity: 0.7, border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 6, padding: '5px 7px' }}>
                                          {branch.label === 'FPS%' ? 'No 0-0 pitch-type rows returned for this split.' : 'No pitch-type rows returned for this split.'}
                                        </div>
                                      ) : null}
                                      {rows.slice(0, 8).map((pitch) => {
                                        const whiffColor = treeMetricColor('whiff_pitch', pitch.whiff.value, pitch.pitch);
                                        const stuffColor = treeMetricColor('stuff_pitch', pitch.stuff.value, pitch.pitch);
                                        const inZoneColor = treeMetricColor('inzone', pitch.inZone.value, pitch.pitch);
                                        const strikeColor = treeMetricColor('strike', pitch.strike.value, pitch.pitch);
                                        const usageColor = treeMetricColor('usage', pitch.usage.value, pitch.pitch);
                                        const whiffLt2kValue = pitch.whiffLt2k?.value ?? null;
                                        const whiff2kValue = pitch.whiff2k?.value ?? null;
                                        const usageLt2kValue = pitch.usageLt2k?.value ?? null;
                                        const usage2kValue = pitch.usage2k?.value ?? null;
                                        return (
                                          <div
                                            key={`${root.key}-${side.side}-${branch.label}-${pitch.pitch}`}
                                            style={{
                                              border: '1px solid rgba(255,255,255,0.08)',
                                              borderRadius: 6,
                                              padding: '5px 7px',
                                              fontSize: 12,
                                              display: 'grid',
                                              gap: 4,
                                              minHeight: 58,
                                              alignContent: 'start',
                                            }}
                                          >
                                            <div style={{ fontWeight: 600, lineHeight: 1.15, textAlign: 'center' }}>
                                              {branch.label === 'FPS%'
                                                ? `${pitch.pitch} - 0-0 counts`
                                                : branch.label === 'E+A%'
                                                  ? `${pitch.pitch} - Overall`
                                                  : pitch.pitch}
                                            </div>
                                            {branch.label === 'FPS%' ? (
                                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
                                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', color: inZoneColor, minHeight: 40, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                                                  InZone {formatMetricValue(pitch.inZone.value)}
                                                </div>
                                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', color: strikeColor, minHeight: 40, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                                                  Strike {formatMetricValue(pitch.strike.value)}
                                                </div>
                                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', color: usageColor, minHeight: 40, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                                                  Usage {formatMetricValue(pitch.usage.value)}
                                                </div>
                                              </div>
                                            ) : branch.label === 'E+A%' ? (
                                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
                                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', color: inZoneColor, minHeight: 40, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                                                  InZone {formatMetricValue(pitch.inZone.value)}
                                                </div>
                                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', color: strikeColor, minHeight: 40, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                                                  Strike {formatMetricValue(pitch.strike.value)}
                                                </div>
                                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', color: usageColor, minHeight: 40, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                                                  Usage {formatMetricValue(pitch.usage.value)}
                                                </div>
                                              </div>
                                            ) : branch.label === 'Stuff+' ? (
                                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
                                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', color: stuffColor, minHeight: 40, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                                                  Stuff+ {formatMetricValue(pitch.stuff.value, 'plus')}
                                                </div>
                                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', color: usageColor, minHeight: 40, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                                                  &lt;2K Usage {formatMetricValue(usageLt2kValue)}
                                                </div>
                                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', color: usageColor, minHeight: 40, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                                                  2K Usage {formatMetricValue(usage2kValue)}
                                                </div>
                                              </div>
                                            ) : (
                                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
                                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', color: whiffColor, minHeight: 40, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                                                  Overall {formatMetricValue(pitch.whiff.value)}
                                                </div>
                                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', color: treeMetricColor('whiff_pitch', whiffLt2kValue, pitch.pitch), minHeight: 40, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                                                  &lt;2K {formatMetricValue(whiffLt2kValue)}
                                                </div>
                                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', color: treeMetricColor('whiff_pitch', whiff2kValue, pitch.pitch), minHeight: 40, display: 'grid', alignContent: 'center', textAlign: 'center' }}>
                                                  2K {formatMetricValue(whiff2kValue)}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {(automationSummaryNote || manualSummaryNote.trim()) ? (
                  <div style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'grid', gap: 8, marginBottom: 8, justifyItems: 'start' }}>
                      <label style={{ display: 'inline-grid', gap: 4, fontSize: 12 }}>
                        <span className="portal-muted-text">Summary Mode</span>
                        <select
                          value={summaryMode}
                          onChange={(event) => setSummaryMode((event.target.value as SummaryMode) || 'automated')}
                          style={{
                            background: 'rgba(10, 14, 24, 0.78)',
                            color: 'rgba(241,245,249,0.95)',
                            border: '1px solid rgba(148,163,184,0.35)',
                            borderRadius: 8,
                            padding: '8px 10px',
                          }}
                        >
                          <option value="automated">Automated Summary</option>
                          <option value="manual">Manual Summary</option>
                        </select>
                      </label>
                      <div style={{ fontWeight: 700 }}>{summaryMode === 'manual' ? 'Summary' : 'Decision Tree Summary'}</div>
                    </div>
                    {summaryMode === 'manual' ? (
                      <textarea
                        value={manualSummaryNote}
                        onChange={(event) => setManualSummaryNote(event.target.value)}
                        placeholder="Write a summary note..."
                        rows={5}
                        style={{
                          width: '100%',
                          resize: 'vertical',
                          background: 'rgba(10, 14, 24, 0.78)',
                          color: 'rgba(241,245,249,0.95)',
                          border: '1px solid rgba(148,163,184,0.35)',
                          borderRadius: 8,
                          padding: '10px 12px',
                        }}
                      />
                    ) : (
                      <p className="portal-muted-text" style={{ margin: 0, lineHeight: 1.45, whiteSpace: 'normal' }}>
                        {automationSummaryNote}
                      </p>
                    )}
                  </div>
                ) : null}
              </article>
            ) : null}
            {automationLoading ? <p className="portal-muted-text" style={{ margin: 0 }}>Building automated plan...</p> : null}
            {!automationLoading && automatedGoals.length === 0 ? (
              <p className="portal-muted-text" style={{ margin: 0 }}>
                Click <strong>Create Automated Plan</strong> to generate goals.
              </p>
            ) : null}
          </div>
        ) : null}
        {!(domain === 'Pitching' && planMode === 'Automated') ? (
        <div ref={goalsExportRef} className="portal-profile-goals-grid" style={{ alignItems: 'stretch' }}>
          {planGoals.filter((goal) => goal.slotIndex <= goalCount).map((goal) => {
            const chartCapable = isChartCapableGoal(goal, domain);
            const controlsVisible = goalControlsVisible[goal.slotIndex] ?? true;
            const stats = goalHeaderStats(goal);
            const goalTarget =
              goal.targetValue.trim().length > 0 && Number.isFinite(Number(goal.targetValue.trim()))
                ? Number(goal.targetValue.trim())
                : null;
            const averageMeetsGoal = goalMeetsTarget(goal, stats.average, goalTarget);
            const averageColor =
              averageMeetsGoal === null ? 'rgba(255,255,255,0.9)' : averageMeetsGoal ? '#22c55e' : '#ef4444';
            const last2Higher = stats.recency2 !== null && stats.average !== null ? stats.recency2 > stats.average : null;
            const last2Lower = stats.recency2 !== null && stats.average !== null ? stats.recency2 < stats.average : null;
            const last2AtAverage = stats.recency2 !== null && stats.average !== null ? Math.abs(stats.recency2 - stats.average) < 1e-9 : null;
            const last2BetterThanAverage = last2AtAverage ? null : goalMeetsTarget(goal, stats.recency2, stats.average);
            const last2Color =
              last2BetterThanAverage === null ? 'rgba(255,255,255,0.9)' : last2BetterThanAverage ? '#22c55e' : '#ef4444';
            const last2Arrow = last2AtAverage ? '→' : last2Higher ? '↑' : last2Lower ? '↓' : '→';
            const summaryTitle = chartCapable
              ? buildChartGoalHeadline(goal)
              : `Category: ${goal.category || '-'} | Goal Type: ${goalTypeLabel(goal)} | Target: ${goal.targetValue.trim() || '-'}`;
            return (
              <article
                key={`player-plan-goal-${goal.slotIndex}`}
                className="portal-day-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: GOAL_CARD_HEIGHT,
                  minHeight: GOAL_CARD_HEIGHT,
                  overflowY: 'auto',
                }}
              >
                <div className="portal-row-between">
                  <h4 style={{ margin: 0 }}>Goal {goal.slotIndex}</h4>
                  <p className="portal-muted-text">Created: {goal.createdAt ? new Date(goal.createdAt).toLocaleDateString() : '-'}</p>
                </div>
                <button
                  type="button"
                  className={`btn btn-ghost ${controlsVisible ? '' : 'portal-custom-reports-show-btn'}`.trim()}
                  onClick={() =>
                    setGoalControlsVisible((current) => ({
                      ...current,
                      [goal.slotIndex]: !(current[goal.slotIndex] ?? true),
                    }))
                  }
                  style={{ marginBottom: 8 }}
                >
                  {controlsVisible ? 'Hide Filters' : 'Show Filters'}
                </button>
                {controlsVisible ? (
                  <>
                <label className="portal-inline-filter">
                  Category
                  <select
                    value={goal.category}
                    onChange={(event) =>
                      setPlanGoals((prev) =>
                        prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, category: event.target.value as GoalCategory | '' } : entry))
                      )
                    }
                  >
                    <option value="">Select category</option>
                    {(DOMAIN_GOAL_CATEGORIES[domain] ?? GOAL_CATEGORIES).map((category) => (
                      <option key={`${goal.slotIndex}-${category}`} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                {goal.category === 'Stuff' ? (
                  <>
                    <label className="portal-inline-filter">
                      Stuff Goal Type
                      <select
                        value={goal.stuffType}
                        onChange={(event) =>
                          setPlanGoals((prev) =>
                            prev.map((entry) =>
                              entry.slotIndex === goal.slotIndex
                                ? { ...entry, stuffType: (event.target.value as '' | 'Velocity' | 'Movement') || '' }
                                : entry
                            )
                          )
                        }
                      >
                        <option value="">Select</option>
                        <option value="Velocity">Velocity</option>
                        <option value="Movement">Movement</option>
                      </select>
                    </label>
                    {goal.stuffType === 'Movement' ? (
                      <label className="portal-inline-filter">
                        Movement Axis
                        <select
                          value={goal.movementAxis}
                          onChange={(event) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) =>
                                entry.slotIndex === goal.slotIndex
                                  ? { ...entry, movementAxis: (event.target.value as '' | 'IVB' | 'HB' | 'IVB+HB') || '' }
                                  : entry
                              )
                            )
                          }
                        >
                          <option value="">Select axis</option>
                          <option value="IVB">IVB</option>
                          <option value="HB">HB</option>
                          <option value="IVB+HB">Both (IVB + HB)</option>
                        </select>
                      </label>
                    ) : null}
                    <div className="portal-form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <label className="portal-inline-filter">
                        Comparator
                        <select
                          value={goal.comparator}
                          onChange={(event) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) =>
                                entry.slotIndex === goal.slotIndex
                                  ? { ...entry, comparator: event.target.value === 'Less Than' ? 'Less Than' : 'Greater Than' }
                                  : entry
                              )
                            )
                          }
                        >
                          <option value="Greater Than">Greater Than</option>
                          <option value="Less Than">Less Than</option>
                        </select>
                      </label>
                      <label className="portal-inline-filter">
                        Target Value
                        <input
                          value={goal.targetValue}
                          onChange={(event) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, targetValue: event.target.value } : entry))
                            )
                          }
                          placeholder="e.g. 15.5"
                        />
                      </label>
                    </div>
                  </>
                ) : null}

                {goal.category === 'Execution' || goal.category === 'Hitting Stats' ? (
                  <>
                    <label className="portal-inline-filter">
                      Stat
                      <select
                        value={goal.executionStat}
                        onChange={(event) =>
                          setPlanGoals((prev) =>
                            prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, executionStat: event.target.value } : entry))
                          )
                        }
                      >
                        <option value="">Select stat</option>
                        {domainExecutionStats.map((option) => (
                          <option key={`${goal.slotIndex}-execution-${option}`} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="portal-form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <label className="portal-inline-filter">
                        Comparator
                        <select
                          value={goal.comparator}
                          onChange={(event) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) =>
                                entry.slotIndex === goal.slotIndex
                                  ? { ...entry, comparator: event.target.value === 'Less Than' ? 'Less Than' : 'Greater Than' }
                                  : entry
                              )
                            )
                          }
                        >
                          <option value="Greater Than">Greater Than</option>
                          <option value="Less Than">Less Than</option>
                        </select>
                      </label>
                      <label className="portal-inline-filter">
                        Target Value
                        <input
                          value={goal.targetValue}
                          onChange={(event) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, targetValue: event.target.value } : entry))
                            )
                          }
                          placeholder="e.g. 32"
                        />
                      </label>
                    </div>
                  </>
                ) : null}

                <label className="portal-inline-filter">
                  Goal Notes / Objective
                  <textarea
                    rows={3}
                    value={goal.objectiveText}
                    onChange={(event) =>
                      setPlanGoals((prev) =>
                        prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, objectiveText: event.target.value } : entry))
                      )
                    }
                    placeholder={chartCapable ? 'Add context for this measurable goal...' : 'Write subjective goal notes here...'}
                  />
                </label>
                  </>
                ) : null}

                {chartCapable ? (
                  <>
                    {controlsVisible ? (
                      <>
                    <label className="portal-inline-filter">
                      Chart
                      <SearchableSingleSelect
                        options={toOptions(CHART_OPTIONS)}
                        value={goal.chartType}
                        onChange={(next) =>
                          setPlanGoals((prev) =>
                            prev.map((entry) =>
                              entry.slotIndex === goal.slotIndex
                                ? {
                                    ...entry,
                                    chartType:
                                      next === 'Release' || next === 'Movement Plot' || next === 'Pitch Chart' || next === 'HeatMaps'
                                        ? (next as ChartType)
                                        : 'Trend',
                                  }
                                : entry
                            )
                          )
                        }
                        placeholder="Trend"
                      />
                    </label>
                    {goal.chartType === 'HeatMaps' ? (
                      <label className="portal-inline-filter">
                        Heatmap View
                        <SearchableSingleSelect
                          options={toOptions(HEATMAP_VIEW_OPTIONS)}
                          value={goal.heatmapView}
                          onChange={(next) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) =>
                                entry.slotIndex === goal.slotIndex
                                  ? { ...entry, heatmapView: HEATMAP_VIEW_OPTIONS.includes(next as HeatmapView) ? (next as HeatmapView) : 'Frequency' }
                                  : entry
                              )
                            )
                          }
                          placeholder="Frequency"
                        />
                      </label>
                    ) : null}
                    <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))', gap: 8 }}>
                      <label className="portal-inline-filter">
                        Start Date
                        <NativeDateInput
                          value={goal.startDate}
                          onChange={(value) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, startDate: value } : entry))
                            )
                          }
                          ariaLabel="Start Date"
                        />
                      </label>
                      <label className="portal-inline-filter">
                        End Date
                        <NativeDateInput
                          value={goal.endDate}
                          onChange={(value) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, endDate: value } : entry))
                            )
                          }
                          ariaLabel="End Date"
                        />
                      </label>
                      {domain === 'Pitching' ? (
                        <label className="portal-inline-filter">
                          Session Type
                          <select
                            value={goal.sessionType}
                            onChange={(event) =>
                              setPlanGoals((prev) =>
                                prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, sessionType: event.target.value || 'Season' } : entry))
                              )
                            }
                          >
                            <option value="Season">Season (Games)</option>
                            <option value="Bullpen">Bullpen</option>
                            <option value="Live">Live BP</option>
                          </select>
                        </label>
                      ) : null}
                    </div>
                    <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(120px, 1fr))', gap: 8 }}>
                      <label className="portal-inline-filter">
                        Pitcher Hand
                        <SearchableSingleSelect
                          options={toOptions(filterOptions.hands ?? ['All'])}
                          value={goal.hand}
                          onChange={(next) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, hand: next || 'All' } : entry))
                            )
                          }
                          placeholder="All"
                        />
                      </label>
                      <label className="portal-inline-filter">
                        Batter Hand
                        <SearchableSingleSelect
                          options={toOptions(filterOptions.batter_sides ?? ['All'])}
                          value={goal.batterSide}
                          onChange={(next) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, batterSide: next || 'All' } : entry))
                            )
                          }
                          placeholder="All"
                        />
                      </label>
                      <label className="portal-inline-filter">
                        Pitch Type
                        <SearchableMultiSelect
                          options={toOptions(filterOptions.pitch_types)}
                          values={goal.pitchTypes}
                          onChange={(next) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, pitchTypes: next } : entry))
                            )
                          }
                        />
                      </label>
                      {domain === 'Pitching' ? (
                        <label className="portal-inline-filter">
                          Ball Type
                          <SearchableMultiSelect
                            options={toOptions(filterOptions.ball_types ?? ['All'])}
                            values={goal.ballTypes}
                            onChange={(next) =>
                              setPlanGoals((prev) =>
                                prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, ballTypes: next } : entry))
                              )
                            }
                          />
                        </label>
                      ) : null}
                      <label className="portal-inline-filter">
                        Pitch Results
                        <SearchableMultiSelect
                          options={toOptions(filterOptions.pitch_results)}
                          values={goal.pitchResults}
                          onChange={(next) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, pitchResults: next } : entry))
                            )
                          }
                        />
                      </label>
                      <label className="portal-inline-filter">
                        Count
                        <SearchableMultiSelect
                          options={toOptions(filterOptions.count_options)}
                          values={goal.countOptions}
                          onChange={(next) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, countOptions: next } : entry))
                            )
                          }
                        />
                      </label>
                      <label className="portal-inline-filter">
                        After Count
                        <SearchableMultiSelect
                          options={toOptions(filterOptions.after_count_options)}
                          values={goal.afterCountOptions}
                          onChange={(next) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, afterCountOptions: next } : entry))
                            )
                          }
                        />
                      </label>
                      <label className="portal-inline-filter">
                        Teams
                        <SearchableMultiSelect
                          options={toOptions(filterOptions.team_types)}
                          values={goal.teams}
                          onChange={(next) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, teams: next } : entry))
                            )
                          }
                        />
                      </label>
                    </div>
                      </>
                    ) : null}
                    <div
                      style={{
                        border: '1px solid rgba(255,255,255,0.14)',
                        borderRadius: 10,
                        padding: 10,
                        background: 'rgba(0,0,0,0.2)',
                        height: GOAL_PANEL_HEIGHT,
                        minHeight: GOAL_PANEL_HEIGHT,
                        marginTop: 8,
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>{summaryTitle}</div>
                      {!controlsVisible && goal.objectiveText.trim() ? (
                        <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 6, whiteSpace: 'pre-wrap' }}>
                          {goal.objectiveText.trim()}
                        </div>
                      ) : null}
                      <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 6 }}>
                        <div>
                          <span>Average: </span>
                          <span style={{ color: averageColor, fontWeight: 700 }}>
                            {formatGoalValueWithUnit(goal, stats.average)}
                          </span>
                        </div>
                        <div>
                          <span>{goal.sessionType === 'Bullpen' ? 'Last 2 bullpens: ' : goal.sessionType === 'Live' ? 'Last 2 live BPs: ' : 'Last 2 games: '}</span>
                          <span style={{ color: last2Color, fontWeight: 700 }}>
                            {`${last2Arrow} ${formatGoalValueWithUnit(goal, stats.recency2)}`}
                          </span>
                        </div>
                      </div>
                      <div style={{ flex: 1, minHeight: 0 }}>{renderGoalChart(goal)}</div>
                    </div>
                    {renderGoalStatTable(goal)}
                  </>
                ) : null}
                {!chartCapable && !controlsVisible ? (
                  <div
                    style={{
                      border: '1px solid rgba(255,255,255,0.14)',
                      borderRadius: 10,
                      padding: 10,
                      background: 'rgba(0,0,0,0.2)',
                      height: GOAL_PANEL_HEIGHT,
                      minHeight: GOAL_PANEL_HEIGHT,
                      marginTop: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{`Category: ${goal.category || '-'}`}</div>
                    <div
                      style={{
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 8,
                        padding: '8px 10px',
                        height: GOAL_VISUAL_HEIGHT,
                        whiteSpace: 'pre-wrap',
                        overflowY: 'auto',
                      }}
                    >
                      {goal.objectiveText.trim() || 'No note added yet.'}
                    </div>
                  </div>
                ) : null}
                {controlsVisible ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void saveGoal(goal.slotIndex)}
                    disabled={!goal.category || goalSavingSlot === goal.slotIndex || !activePlanPlayerId}
                  >
                    {goalSavingSlot === goal.slotIndex ? 'Saving...' : 'Save Goal'}
                  </button>
                ) : null}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: controlsVisible ? 8 : 0 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void completeGoal(goal.slotIndex)}
                    disabled={goalSavingSlot === goal.slotIndex || !goal.category || !activePlanPlayerId}
                  >
                    Complete Goal
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void deleteGoal(goal.slotIndex)}
                    disabled={goalSavingSlot === goal.slotIndex || !goal.category || !activePlanPlayerId}
                  >
                    Delete Goal
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        ) : null}
      </article>

      {goalChartHover ? (
        <div
          style={{
            position: 'fixed',
            left: goalChartHover.x + 12,
            top: goalChartHover.y + 12,
            zIndex: 9999,
            pointerEvents: 'none',
            background: goalChartHover.bg ?? '#111827',
            color: pitchHoverTextColor(goalChartHover.bg),
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 12,
            lineHeight: 1.35,
            whiteSpace: 'pre-line',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.18)',
            maxWidth: 260,
          }}
        >
          {goalChartHover.text}
        </div>
      ) : null}
    </section>
  );
}

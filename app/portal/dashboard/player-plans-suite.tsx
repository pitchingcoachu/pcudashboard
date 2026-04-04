'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTableDisplayValue } from '../../../lib/table-sort';

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
  pitchResults: string[];
  countOptions: string[];
  afterCountOptions: string[];
  teams: string[];
  hand: string;
  batterSide: string;
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
    pitchResults?: string[];
    countOptions?: string[];
    afterCountOptions?: string[];
    teams?: string[];
    hand?: string;
    batterSide?: string;
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
type HeatCell = { x: number; y: number; w: number; h: number; value: number; density: number };

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
  const [last, first] = trimmed.split(',').map((part) => part.trim());
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

function uniqueNames(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean)));
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

function normalizeNameKey(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
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
  return values.map((value) => ({ value, label: value }));
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
  Fastball: '#ffffff',
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

function inZoneLabel(x: number | null, y: number | null): string {
  if (x === null || y === null) return 'No';
  const inZone = x >= -0.88 && x <= 0.88 && y >= 1.5 && y <= 3.6;
  const comp = x >= -1.5 && x <= 1.5 && y >= (2.65 - 1.5) && y <= (2.65 + 1.5);
  if (inZone) return 'Yes';
  if (comp) return 'Competitive';
  return 'No';
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
    pitchResults: ['All'],
    countOptions: ['All'],
    afterCountOptions: ['All'],
    teams: ['All'],
    hand: 'All',
    batterSide: 'All',
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
      pitchResults: parsed.filters?.pitchResults?.length ? parsed.filters.pitchResults : ['All'],
      countOptions: parsed.filters?.countOptions?.length ? parsed.filters.countOptions : ['All'],
      afterCountOptions: parsed.filters?.afterCountOptions?.length ? parsed.filters.afterCountOptions : ['All'],
      teams: parsed.filters?.teams?.length ? parsed.filters.teams : ['All'],
      hand: String(parsed.filters?.hand ?? 'All') || 'All',
      batterSide: String(parsed.filters?.batterSide ?? 'All') || 'All',
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
      pitchResults: goal.pitchResults,
      countOptions: goal.countOptions,
      afterCountOptions: goal.afterCountOptions,
      teams: goal.teams,
      hand: goal.hand,
      batterSide: goal.batterSide,
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
      const compN = dayRows.filter((row) => {
        const x = toNum(row.plate_side);
        const y = toNum(row.plate_height);
        const label = inZoneLabel(x, y);
        return label === 'Yes' || label === 'Competitive';
      }).length;
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
        comppct: pct(compN, dayRows.length),
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

export default function PlayerPlansSuite() {
  const [domain, setDomain] = useState<Domain>('Pitching');
  const [linkedPlayers, setLinkedPlayers] = useState<PlayerOption[]>([]);
  const [dashboardPlayerOptions, setDashboardPlayerOptions] = useState<string[]>([]);
  const [selectedPlayerName, setSelectedPlayerName] = useState('');
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
  const [goalChartHover, setGoalChartHover] = useState<{ x: number; y: number; text: string; bg?: string } | null>(null);

  const selectedPlayerId = useMemo(() => {
    const normalized = normalizePersonName(selectedPlayerName);
    const linked = linkedPlayers.find((player) => normalizePersonName(player.fullName) === normalized);
    return linked?.playerId ?? 0;
  }, [linkedPlayers, selectedPlayerName]);
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
  const playerQueryCandidates = useMemo(
    () => playerNameQueryCandidates(selectedPlayerName, selectedDashboardPlayerName),
    [selectedDashboardPlayerName, selectedPlayerName]
  );
  useEffect(() => {
    const allowed = new Set(DOMAIN_GOAL_CATEGORIES[domain] ?? GOAL_CATEGORIES);
    setPlanGoals((prev) =>
      prev.map((goal) => (goal.category && !allowed.has(goal.category) ? { ...goal, category: '' } : goal))
    );
  }, [domain]);
  const chartFetchGoals = useMemo(
    () =>
      planGoals
        .filter((goal) => isChartCapableGoal(goal, domain))
        .map((goal) => ({
          slotIndex: goal.slotIndex,
          startDate: goal.startDate,
          endDate: goal.endDate,
          pitchTypes: goal.pitchTypes,
          pitchResults: goal.pitchResults,
          countOptions: goal.countOptions,
          afterCountOptions: goal.afterCountOptions,
          teams: goal.teams,
          hand: goal.hand,
          batterSide: goal.batterSide,
        })),
    [planGoals]
  );

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
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`/api/dashboard/player-plans/domain-players?domain=${encodeURIComponent(domain)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { players?: string[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load player options.');
        const cleanedPlayers = uniqueNames(payload.players ?? []);
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
  }, [domain]);

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
          if (domain !== 'Hitting') params.set('session_type', 'Season');
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
    fetch(`/api/dashboard/${domainPath}/filters`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load dashboard filters.');
        const payload = (await response.json().catch(() => ({}))) as Partial<DashboardFilterOptions>;
        if (!active) return;
        setFilterOptions({
          pitchers: payload.pitchers?.length ? ['All', ...payload.pitchers.filter((value) => value !== 'All')] : ['All'],
          hitters: payload.hitters?.length ? ['All', ...payload.hitters.filter((value) => value !== 'All')] : ['All'],
          catchers: payload.catchers?.length ? ['All', ...payload.catchers.filter((value) => value !== 'All')] : ['All'],
          pitch_types: payload.pitch_types?.length ? ['All', ...payload.pitch_types.filter((value) => value !== 'All')] : ['All'],
          pitch_results: payload.pitch_results?.length ? ['All', ...payload.pitch_results.filter((value) => value !== 'All')] : ['All'],
          count_options: payload.count_options?.length ? ['All', ...payload.count_options.filter((value) => value !== 'All')] : ['All'],
          after_count_options: payload.after_count_options?.length ? ['All', ...payload.after_count_options.filter((value) => value !== 'All')] : ['All'],
          team_types: payload.team_types?.length ? ['All', ...payload.team_types.filter((value) => value !== 'All')] : ['All'],
          hands: payload.hands?.length ? ['All', ...payload.hands.filter((value) => value !== 'All')] : ['All'],
          batter_sides: payload.batter_sides?.length ? ['All', ...payload.batter_sides.filter((value) => value !== 'All')] : ['All'],
        });
      })
      .catch(() => {
        if (!active) return;
        setFilterOptions({
          pitchers: ['All'],
          hitters: ['All'],
          catchers: ['All'],
          pitch_types: ['All'],
          pitch_results: ['All'],
          count_options: ['All'],
          after_count_options: ['All'],
          team_types: ['All'],
          hands: ['All'],
          batter_sides: ['All'],
        });
      });
    return () => {
      active = false;
    };
  }, [domain]);

  useEffect(() => {
    if (!selectedPlayerId) {
      setPlanGoals([1, 2, 3].map((slot) => parseStoredGoalDescription(null, null, slot as GoalSlot, null)));
      return;
    }
    let active = true;
    setLoadingGoals(true);
    fetch(`/api/player/plan-goals?playerId=${selectedPlayerId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          activeGoals?: Array<{ slotIndex: number; category: string | null; goalDescription: string | null; createdAt: string | null }>;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load goals.');
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
  }, [selectedPlayerId]);

  async function saveGoal(slotIndex: GoalSlot) {
    if (!selectedPlayerId) {
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
          playerId: selectedPlayerId,
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
      try {
        const refreshResponse = await fetch(`/api/player/plan-goals?playerId=${selectedPlayerId}`, { cache: 'no-store' });
        const refreshPayload = (await refreshResponse.json().catch(() => ({}))) as {
          activeGoals?: Array<{ slotIndex: number; category: string | null; goalDescription: string | null; createdAt: string | null }>;
          error?: string;
        };
        if (!refreshResponse.ok) throw new Error(refreshPayload.error ?? 'Failed to refresh goals.');
        const next = ([1, 2, 3] as GoalSlot[]).map((slot) => {
          const existing = refreshPayload.activeGoals?.find((entry) => entry.slotIndex === slot);
          return parseStoredGoalDescription(existing?.category ?? null, existing?.goalDescription ?? null, slot, existing?.createdAt ?? null);
        });
        setPlanGoals(next);
      } catch {
        const next = ([1, 2, 3] as GoalSlot[]).map((slot) => {
          const existing = payload.activeGoals?.find((entry) => entry.slotIndex === slot);
          return parseStoredGoalDescription(existing?.category ?? null, existing?.goalDescription ?? null, slot, existing?.createdAt ?? null);
        });
        setPlanGoals(next);
      }
      setMessage(`Goal ${slotIndex} saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save goal.');
    } finally {
      setGoalSavingSlot(null);
    }
  }

  function goalHeaderStats(goal: GoalDraft): { current: number | null; recency2: number | null; statLabel: string } {
    const points = goalCharts[goal.slotIndex]?.points ?? [];
    const series = buildGoalMetricSeries(goal, points);
    if (!series.length) return { current: null, recency2: null, statLabel: goalStatLabel(goal) };
    const current = series[series.length - 1]?.value ?? null;
    const lastTwo = series.slice(-2);
    const recency2 = lastTwo.length ? lastTwo.reduce((sum, row) => sum + row.value, 0) / lastTwo.length : null;
    return { current, recency2, statLabel: goalStatLabel(goal) };
  }

  function renderGoalStatTable(goal: GoalDraft) {
    const points = goalCharts[goal.slotIndex]?.points ?? [];
    const series = buildGoalMetricSeries(goal, points).slice().sort((a, b) => b.date.localeCompare(a.date));
    if (!series.length) return <p className="portal-muted-text" style={{ margin: '6px 0 0 0' }}>No stat rows for current filters.</p>;
    const statLabel = goalStatLabel(goal);
    const targetValue = goal.targetValue.trim();
    const target = targetValue.length > 0 && Number.isFinite(Number(targetValue)) ? Number(targetValue) : null;
    return (
      <div style={{ marginTop: 8, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, overflow: 'auto', maxHeight: 150 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', margin: 0 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.12)', padding: '6px 8px', fontSize: 12 }}>Date</th>
              <th style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.12)', padding: '6px 8px', fontSize: 12 }}>{statLabel}</th>
            </tr>
          </thead>
          <tbody>
            {series.map((row) => (
              <tr key={`goal-stat-row-${goal.slotIndex}-${row.date}`}>
                <td style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '6px 8px', fontSize: 12 }}>{formatMdyy(row.date)}</td>
                <td
                  style={{
                    textAlign: 'center',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    padding: '6px 8px',
                    fontSize: 12,
                    color: target === null ? 'inherit' : row.value >= target ? '#22c55e' : '#ef4444',
                    fontWeight: target === null ? 500 : 700,
                  }}
                >
                  {fmtGoalValueForGoal(goal, row.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
            <filter id={`location-heat-blur-goal-${goal.slotIndex}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.1" />
            </filter>
          </defs>
          <g clipPath={`url(#location-zoom-clip-goal-${goal.slotIndex})`}>
            {goal.chartType === 'HeatMaps' && selectedHeatmapView !== 'Pitch' ? (
              <>
                <g filter={`url(#location-heat-blur-goal-${goal.slotIndex})`}>
                  {cells.map((c, i) => {
                    const cx = px(c.x + c.w / 2);
                    const cy = py(c.y + c.h / 2);
                    const radius = Math.max(2.8, c.w * scale * 2.05);
                    const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                    const normalized =
                      selectedHeatmapView === 'Run Values'
                        ? Math.abs(c.value) / maxAbs
                        : selectedHeatmapView === 'QP+'
                          ? Math.abs(c.value - 100) / 100
                          : Math.max(0, (c.value - minVal) / Math.max(1e-9, maxVal - minVal));
                    if (selectedHeatmapView !== 'Frequency' && selectedHeatmapView !== 'QP+' && densityNorm < 0.16) return null;
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
                    if (selectedHeatmapView !== 'Frequency' && selectedHeatmapView !== 'QP+' && densityNorm < 0.16) return null;
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
    const bottom = 70;
    const min = Math.min(...series.map((point) => point.value));
    const max = Math.max(...series.map((point) => point.value));
    const yMin = min === max ? min - 1 : min;
    const yMax = min === max ? max + 1 : max;
    const px = (index: number) =>
      series.length === 1 ? width / 2 : left + (index / (series.length - 1)) * (width - left - right);
    const py = (value: number) => top + ((yMax - value) / Math.max(1e-6, yMax - yMin)) * (height - top - bottom);
    const targetRaw = goal.targetValue.trim();
    const target = targetRaw.length > 0 ? Number(targetRaw) : Number.NaN;
    const targetY = Number.isFinite(target) ? py(target) : null;
    const path = series.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${px(idx).toFixed(1)} ${py(point.value).toFixed(1)}`).join(' ');
    const xTickIndexes = Array.from(new Set([0, Math.floor((series.length - 1) * 0.25), Math.floor((series.length - 1) * 0.5), Math.floor((series.length - 1) * 0.75), series.length - 1]))
      .filter((index) => index >= 0 && index < series.length);
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
            <text x={px(index)} y={height - bottom + 16} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.9)">
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
        <text x={(left + width - right) / 2} y={height - 10} textAnchor="middle" fontSize={12} fill="rgba(255,255,255,0.9)">
          Date
        </text>
        <text transform={`translate(16 ${(top + height - bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fill="rgba(255,255,255,0.9)">
          {yLabel}
        </text>
      </svg>
    );
  }

  return (
    <section className="portal-player-plans-suite" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <article className="portal-admin-card">
        <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))' }}>
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
            <select value={selectedPlayerName} onChange={(event) => setSelectedPlayerName(event.target.value)}>
              {!dashboardPlayerOptions.length ? <option value="">No players available</option> : null}
              {dashboardPlayerOptions.map((playerName) => (
                <option key={playerName} value={playerName}>
                  {formatNameFirstLast(playerName)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Header Notes
            <input value={headerNote} onChange={(event) => setHeaderNote(event.target.value)} placeholder="Date / cycle / context..." />
          </label>
        </div>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, letterSpacing: '0.02em', opacity: 0.95 }}>Player Development Plan</div>
          <h2 style={{ margin: '4px 0 0 0', fontSize: '1.12rem', fontWeight: 650 }}>{centeredName || '-'}</h2>
          <div style={{ marginTop: 8, fontSize: '0.9rem', letterSpacing: '0.02em', opacity: 0.8, fontStyle: 'italic' }}>
            {headerNote.trim() || ' '}
          </div>
        </div>
      </article>

      {loadingPlayers || loadingGoals ? <p className="portal-muted-text">Loading player plan data...</p> : null}
      {message ? <p className={message.includes('Failed') || message.includes('Unauthorized') ? 'auth-error' : 'auth-message'}>{message}</p> : null}

      <article className="portal-admin-card">
        <h3 style={{ marginTop: 0 }}>Goals</h3>
        <div className="portal-profile-goals-grid" style={{ alignItems: 'stretch' }}>
          {planGoals.map((goal) => {
            const chartCapable = isChartCapableGoal(goal, domain);
            const controlsVisible = goalControlsVisible[goal.slotIndex] ?? true;
            const stats = goalHeaderStats(goal);
            const goalTarget =
              goal.targetValue.trim().length > 0 && Number.isFinite(Number(goal.targetValue.trim()))
                ? Number(goal.targetValue.trim())
                : null;
            const last2Higher = stats.recency2 !== null && goalTarget !== null ? stats.recency2 > goalTarget : null;
            const last2Lower = stats.recency2 !== null && goalTarget !== null ? stats.recency2 < goalTarget : null;
            const last2AtTarget = stats.recency2 !== null && goalTarget !== null ? Math.abs(stats.recency2 - goalTarget) < 1e-9 : null;
            const meetsGoal =
              stats.recency2 !== null && goalTarget !== null
                ? goal.comparator === 'Less Than'
                  ? stats.recency2 < goalTarget
                  : stats.recency2 > goalTarget
                : null;
            const last2Color =
              meetsGoal === null ? 'rgba(255,255,255,0.9)' : meetsGoal ? '#22c55e' : '#ef4444';
            const last2Arrow = last2AtTarget ? '→' : last2Higher ? '↑' : last2Lower ? '↓' : '→';
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
                        <input
                          type="date"
                          value={goal.startDate}
                          onChange={(event) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, startDate: event.target.value } : entry))
                            )
                          }
                        />
                      </label>
                      <label className="portal-inline-filter">
                        End Date
                        <input
                          type="date"
                          value={goal.endDate}
                          onChange={(event) =>
                            setPlanGoals((prev) =>
                              prev.map((entry) => (entry.slotIndex === goal.slotIndex ? { ...entry, endDate: event.target.value } : entry))
                            )
                          }
                        />
                      </label>
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
                      <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 6 }}>
                        <div>{`Current: ${formatGoalValueWithUnit(goal, stats.current)}`}</div>
                        <div>
                          <span>Last 2 games: </span>
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
                    disabled={!goal.category || goalSavingSlot === goal.slotIndex || !selectedPlayerId}
                  >
                    {goalSavingSlot === goal.slotIndex ? 'Saving...' : 'Save Goal'}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
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

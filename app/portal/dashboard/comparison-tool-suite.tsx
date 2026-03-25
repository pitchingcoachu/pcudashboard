'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatTableDisplayValue, parseSortableNumber, sortTableRows, type SortDirection } from '../../../lib/table-sort';

type Domain = 'Pitching' | 'Hitting' | 'Catching';
type ChartType = 'Heatmap' | 'Pitch Chart' | 'Velocity Chart' | 'Movement Plot' | 'Release Plot';
type OptionItem = { value: string; label: string };
type HeatMetric = 'Frequency' | 'Called Strike Rate' | 'Whiff Rate' | 'Exit Velocity' | 'GB Rate' | 'Contact Rate' | 'Swing Rate' | 'Run Values';
type VelocityMode = 'Velocity Chart (Game/Inning)' | 'Average Velocity by Game' | 'Average Velocity by Inning';
type ReleaseView = 'Averages Only' | 'Averages and Pitches' | 'Pitches';
type MovementView = 'Averages Only' | 'Averages and Pitches';

type FiltersPayload = {
  min_date?: string | null;
  max_date?: string | null;
  team_types?: string[];
  pitchers?: string[];
  hitters?: string[];
  catchers?: string[];
  pitch_types?: string[];
  pitch_result_options?: string[];
  count_options?: string[];
  after_count_options?: string[];
  session_types?: string[];
  hands?: string[];
  batter_sides?: string[];
  table_modes?: string[];
  split_by_options?: string[];
};

type ChartPoint = {
  pitch_event_id?: number | null;
  pitch_number?: number | null;
  pitch_no?: number | null;
  game_id?: string | null;
  game_uid?: string | null;
  game_foreign_id?: string | null;
  session_date?: string | null;
  session_type?: string | null;
  pitch_type?: string | null;
  plate_side?: number | null;
  plate_height?: number | null;
  pitch_call?: string | null;
  play_result?: string | null;
  tagged_hit_type?: string | null;
  run_value?: number | null;
  exit_speed?: number | null;
  angle?: number | null;
  rel_speed?: number | null;
  velo?: number | null;
  stuff_plus?: number | null;
  hb?: number | null;
  ivb?: number | null;
  release_side?: number | null;
  release_height?: number | null;
  extension?: number | null;
  inning?: number | string | null;
};

type OverviewPayload = {
  table_columns?: string[];
  table_rows?: Array<Record<string, string | number | null>>;
  chart_points?: ChartPoint[];
  heatmap_points?: ChartPoint[];
};
type HeatCell = { x: number; y: number; w: number; h: number; value: number; density: number };
type CellColors = { bg: string; text: string };

type PaneState = {
  domain: Domain;
  chartType: ChartType;
  heatMetric: HeatMetric;
  velocityMode: VelocityMode;
  releaseView: ReleaseView;
  movementView: MovementView;
  player: string;
  startDate: string;
  endDate: string;
  sessionType: string;
  teamType: string;
  pitchType: string;
  pitchResult: string;
  countFilter: string;
  afterCountFilter: string;
  pitcherHand: string;
  batterHand: string;
  tableMode: string;
  splitBy: string;
  sortColumn: string;
  sortDirection: SortDirection;
};

const DOMAIN_TABLES: Record<Domain, string[]> = {
  Pitching: ['Stuff', 'Process', 'Results', 'Bullpen', 'Live', 'Usage', 'Raw Data'],
  Hitting: ['Results', 'Swing Decisions'],
  Catching: ['Catching Data', 'Stuff', 'Process', 'Results', 'Bullpen', 'Live', 'Usage', 'Raw Data', 'Batted Ball Data', 'Swing Decisions'],
};
const DOMAIN_SPLIT_BY: Record<Domain, string[]> = {
  Pitching: [
    'Pitch Types',
    'Pitcher Hand',
    'Batter Hand',
    'Session Type',
    'Count',
    'After Count',
    'In Zone',
    'Zone Location',
    'Times Through Order',
    'Velocity',
    'IVB',
    'HB',
    'Pitcher',
    'Batter',
    'Catcher',
  ],
  Hitting: [
    'Pitch Types',
    'Pitcher Hand',
    'Batter Hand',
    'Session Type',
    'Count',
    'After Count',
    'In Zone',
    'Zone Location',
    'Times Through Order',
    'Velocity',
    'IVB',
    'HB',
    'Pitcher',
    'Batter',
    'Catcher',
  ],
  Catching: ['Pitch Types', 'Pitcher Hand', 'Batter Hand', 'Count', 'After Count', 'Zone Location', 'Times Through Order', 'Velocity', 'IVB', 'HB', 'Pitcher', 'Batter', 'Catcher'],
};
const CHART_OPTIONS: ChartType[] = ['Heatmap', 'Pitch Chart', 'Velocity Chart', 'Movement Plot', 'Release Plot'];
const HEAT_METRICS: HeatMetric[] = ['Frequency', 'Called Strike Rate', 'Whiff Rate', 'Exit Velocity', 'GB Rate', 'Contact Rate', 'Swing Rate', 'Run Values'];
const VELOCITY_MODES: VelocityMode[] = ['Velocity Chart (Game/Inning)', 'Average Velocity by Game', 'Average Velocity by Inning'];
const RELEASE_VIEWS: ReleaseView[] = ['Averages Only', 'Averages and Pitches', 'Pitches'];
const MOVEMENT_VIEWS: MovementView[] = ['Averages Only', 'Averages and Pitches'];
const PITCH_COLORS: Record<string, string> = {
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

function toNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
function fmtNum(value: number | null | undefined, digits = 1): string {
  if (!Number.isFinite(value as number)) return '-';
  return Number(value).toFixed(digits);
}
function formatShortDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}
function parseInningNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  const match = raw.match(/\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}
function timesThroughOrderRank(value: unknown): number {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 8;
  if (text === 'all') return -1;
  if (text.startsWith('1')) return 0;
  if (text.startsWith('2')) return 1;
  if (text.startsWith('3')) return 2;
  if (text.startsWith('4')) return 3;
  return 8;
}
function reorderTimesThroughOrderRows<T extends Record<string, unknown>>(rows: T[], splitColumn: string): T[] {
  if (!splitColumn) return rows;
  const allRows = rows.filter((row) => String(row[splitColumn] ?? '').trim().toLowerCase() === 'all');
  const nonAllRows = rows.filter((row) => String(row[splitColumn] ?? '').trim().toLowerCase() !== 'all');
  nonAllRows.sort((a, b) => {
    const rankA = timesThroughOrderRank(a[splitColumn]);
    const rankB = timesThroughOrderRank(b[splitColumn]);
    if (rankA !== rankB) return rankA - rankB;
    return String(a[splitColumn] ?? '').localeCompare(String(b[splitColumn] ?? ''));
  });
  return [...allRows, ...nonAllRows];
}
function normalizePitchTypeName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'all';
  if (normalized === 'all') return 'all';
  return normalized.replace(/\s+/g, '');
}
function getProcessThresholds(columnName: string, pitchTypeRaw: string): { poor: number; avg: number; great: number } | null {
  const pitchType = normalizePitchTypeName(pitchTypeRaw);
  if (columnName === 'InZone%') {
    if (['fastball', 'sinker'].includes(pitchType)) return { poor: 43, avg: 50, great: 57 };
    if (['cutter', 'slider', 'sweeper', 'curveball'].includes(pitchType)) return { poor: 37, avg: 43, great: 49 };
    if (['changeup', 'splitter', 'knuckleball'].includes(pitchType)) return { poor: 30, avg: 37, great: 44 };
    if (pitchType === 'all') return { poor: 42, avg: 47, great: 52 };
  }
  if (columnName === 'Comp%') {
    if (['fastball', 'sinker'].includes(pitchType)) return { poor: 79, avg: 83, great: 87 };
    if (['cutter', 'slider', 'sweeper', 'curveball'].includes(pitchType)) return { poor: 70, avg: 76, great: 82 };
    if (['changeup', 'splitter', 'knuckleball'].includes(pitchType)) return { poor: 65, avg: 74, great: 83 };
    if (pitchType === 'all') return { poor: 76, avg: 79, great: 82 };
  }
  if (columnName === 'Strike%') return { poor: 57, avg: 62, great: 67 };
  if (columnName === 'Swing%') {
    if (['fastball', 'sinker'].includes(pitchType)) return { poor: 40, avg: 44, great: 48 };
    if (['cutter', 'slider', 'sweeper'].includes(pitchType)) return { poor: 37, avg: 43, great: 49 };
    if (pitchType === 'curveball') return { poor: 28, avg: 35, great: 42 };
    if (['changeup', 'splitter'].includes(pitchType)) return { poor: 43, avg: 47, great: 51 };
    if (pitchType === 'all') return { poor: 40, avg: 45, great: 50 };
  }
  if (columnName === 'FPS%') return { poor: 55, avg: 60, great: 65 };
  if (columnName === 'E+A%' && pitchType === 'all') return { poor: 65, avg: 70, great: 75 };
  if (columnName === '1-1W%') return { poor: 58, avg: 63, great: 68 };
  if (columnName === 'Ahead%') return { poor: 32, avg: 37, great: 42 };
  if (columnName === 'QP%') return { poor: 38, avg: 48, great: 58 };
  if (columnName === 'Ctrl+') return { poor: 75, avg: 85, great: 95 };
  if (columnName === 'QP+') return { poor: 75, avg: 90, great: 105 };
  if (columnName === 'Pitching+') return { poor: 80, avg: 95, great: 110 };
  if (columnName === 'K%' && pitchType === 'all') return { poor: 18, avg: 23, great: 28 };
  if (columnName === 'BB%' && pitchType === 'all') return { poor: 11, avg: 9, great: 7 };
  if (columnName === 'Whiff%') {
    if (pitchType === 'fastball') return { poor: 18, avg: 22, great: 26 };
    if (pitchType === 'sinker') return { poor: 9, avg: 13, great: 17 };
    if (pitchType === 'cutter') return { poor: 22, avg: 27, great: 32 };
    if (['sweeper', 'curveball', 'slider', 'changeup', 'splitter'].includes(pitchType)) return { poor: 29, avg: 35, great: 41 };
    if (pitchType === 'all') return { poor: 21, avg: 26, great: 31 };
  }
  if (columnName === 'CSW%') {
    if (['fastball', 'sinker'].includes(pitchType)) return { poor: 23, avg: 27, great: 31 };
    if (['cutter', 'slider', 'sweeper', 'curveball'].includes(pitchType)) return { poor: 29, avg: 32, great: 35 };
    if (['splitter', 'changeup'].includes(pitchType)) return { poor: 22, avg: 28, great: 34 };
    if (pitchType === 'all') return { poor: 26, avg: 29, great: 32 };
  }
  if (columnName === 'GB%') {
    if (pitchType === 'fastball') return { poor: 31, avg: 39, great: 47 };
    if (pitchType === 'sinker') return { poor: 43, avg: 54, great: 65 };
    if (['cutter', 'slider', 'sweeper', 'curveball'].includes(pitchType)) return { poor: 36, avg: 43, great: 50 };
    if (['changeup', 'splitter'].includes(pitchType)) return { poor: 35, avg: 47, great: 59 };
    if (pitchType === 'all') return { poor: 38, avg: 43, great: 48 };
  }
  if (columnName === 'Barrel%') return { poor: 20, avg: 15, great: 10 };
  if (columnName === 'EV') return { poor: 95, avg: 85, great: 75 };
  if (columnName === 'Stuff+') return { poor: 90, avg: 100, great: 110 };
  if (columnName === 'RV/100') {
    if (pitchType === 'fastball') return { poor: 1.5, avg: 0.7, great: -0.1 };
    if (pitchType === 'sinker') return { poor: 2.3, avg: 0.9, great: -0.5 };
    if (pitchType === 'cutter') return { poor: 0.9, avg: -0.2, great: -1.3 };
    if (pitchType === 'slider') return { poor: -0.4, avg: -1.1, great: -1.8 };
    if (pitchType === 'curveball') return { poor: -0.1, avg: -1.3, great: -2.5 };
    if (pitchType === 'changeup') return { poor: 0.7, avg: -0.5, great: -1.7 };
    if (pitchType === 'splitter') return { poor: 0, avg: -1.4, great: -2.8 };
    return { poor: 0.7, avg: 0, great: -0.7 };
  }
  return null;
}
function getCellColorScale(value: string | number | null | undefined, columnName: string, pitchType: string): CellColors | null {
  const parsed = parseSortableNumber(value);
  if (parsed === null) return null;
  const thresholds = getProcessThresholds(columnName, pitchType);
  if (!thresholds) return null;
  const { poor, avg, great } = thresholds;
  const reverseScale = ['EV', 'Barrel%', 'BB%', 'RV/100'].includes(columnName);
  if (reverseScale) {
    if (parsed >= poor) return { bg: '#0066CC', text: 'white' };
    if (parsed >= (poor + avg) / 2) return { bg: '#66B2FF', text: 'black' };
    if (parsed >= avg) return { bg: '#FFFFFF', text: 'black' };
    if (parsed >= (avg + great) / 2) return { bg: '#FFB3B3', text: 'black' };
    if (parsed >= great) return { bg: '#FF6666', text: 'white' };
    return { bg: '#CC0000', text: 'white' };
  }
  if (parsed <= poor) return { bg: '#0066CC', text: 'white' };
  if (parsed <= (poor + avg) / 2) return { bg: '#66B2FF', text: 'black' };
  if (parsed <= avg) return { bg: '#FFFFFF', text: 'black' };
  if (parsed <= (avg + great) / 2) return { bg: '#FFB3B3', text: 'black' };
  if (parsed <= great) return { bg: '#FF6666', text: 'white' };
  return { bg: '#CC0000', text: 'white' };
}
function defaultTableMode(domain: Domain): string {
  if (domain === 'Pitching') return 'Live';
  if (domain === 'Hitting') return 'Results';
  return 'Catching Data';
}
function subjectLabel(domain: Domain): string {
  if (domain === 'Pitching') return 'Pitcher';
  if (domain === 'Hitting') return 'Hitter';
  return 'Catcher';
}
function inZoneLabel(x: number | null, y: number | null): string {
  if (x === null || y === null) return 'No';
  const inZone = x >= -0.88 && x <= 0.88 && y >= 1.5 && y <= 3.6;
  const comp = x >= -1.5 && x <= 1.5 && y >= (2.65 - 1.5) && y <= (2.65 + 1.5);
  if (inZone) return 'Yes';
  if (comp) return 'Competitive';
  return 'No';
}
function resultShape(pitchCallRaw: string | null | undefined, playResultRaw: string | null | undefined): string {
  const pitchCall = String(pitchCallRaw ?? '');
  const playResult = String(playResultRaw ?? '');
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
function resultLabel(pitchCallRaw: string | null | undefined, playResultRaw: string | null | undefined): string {
  const pitchCall = String(pitchCallRaw ?? '').trim();
  const playResult = String(playResultRaw ?? '').trim();
  const valid = (value: string) => value.length > 0 && value !== 'Undefined';
  if (pitchCall === 'InPlay' && valid(playResult)) return playResult;
  if (valid(pitchCall) && /foul/i.test(pitchCall)) return 'Foul';
  if (pitchCall === 'HitByPitch' || playResult === 'HitByPitch') return 'HBP';
  if (valid(pitchCall)) return pitchCall;
  if (valid(playResult)) return playResult;
  return '-';
}
function pitchHoverTextColor(bg?: string): string {
  if (!bg) return '#fff';
  const v = bg.toLowerCase();
  if (v === '#ffffff' || v === 'white' || v === 'orange' || v === 'turquoise') return '#111';
  return '#fff';
}
function formatNameFirstLast(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!trimmed.includes(',')) return trimmed;
  const [last, ...rest] = trimmed.split(',');
  const first = rest.join(' ').trim();
  const lastName = last.trim();
  return [first, lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
function optionItems(values: string[] | undefined, formatNames = false): OptionItem[] {
  const set = Array.from(new Set((values ?? []).map((entry) => String(entry ?? '').trim()).filter((entry) => entry && entry !== 'All')));
  return [{ value: 'All', label: 'All' }, ...set.map((entry) => ({ value: entry, label: formatNames ? formatNameFirstLast(entry) : entry }))];
}
function domainFiltersEndpoint(domain: Domain): string {
  if (domain === 'Pitching') return '/api/dashboard/pitching/filters';
  if (domain === 'Hitting') return '/api/dashboard/hitting/filters';
  return '/api/dashboard/catching/filters';
}
function domainOverviewEndpoint(domain: Domain): string {
  if (domain === 'Pitching') return '/api/dashboard/pitching/overview';
  if (domain === 'Hitting') return '/api/dashboard/hitting/overview';
  return '/api/dashboard/catching/overview';
}
function playerQueryKey(domain: Domain): 'pitcher' | 'hitter' | 'catcher' {
  if (domain === 'Pitching') return 'pitcher';
  if (domain === 'Hitting') return 'hitter';
  return 'catcher';
}
function normalizeNameForApi(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed === 'All' || trimmed.includes(',')) return trimmed === 'All' ? '' : trimmed;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return trimmed;
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
}
function emptyPaneState(): PaneState {
  return {
    domain: 'Pitching',
    chartType: 'Pitch Chart',
    heatMetric: 'Frequency',
    velocityMode: 'Velocity Chart (Game/Inning)',
    releaseView: 'Averages and Pitches',
    movementView: 'Averages and Pitches',
    player: 'All',
    startDate: '',
    endDate: '',
    sessionType: 'All',
    teamType: 'All',
    pitchType: 'All',
    pitchResult: 'All',
    countFilter: 'All',
    afterCountFilter: 'All',
    pitcherHand: 'All',
    batterHand: 'All',
    tableMode: defaultTableMode('Pitching'),
    splitBy: DOMAIN_SPLIT_BY.Pitching[0],
    sortColumn: '',
    sortDirection: 'desc',
  };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rgb = (r: number, g: number, b: number) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
function shinyHeatSequential(tRaw: number): string {
  const t = Math.max(0, Math.min(1, tRaw));
  if (t < 0.2) return rgb(lerp(232, 142, t / 0.2), lerp(238, 183, t / 0.2), lerp(247, 225, t / 0.2));
  if (t < 0.45) return rgb(lerp(142, 170, (t - 0.2) / 0.25), lerp(183, 211, (t - 0.2) / 0.25), lerp(225, 235, (t - 0.2) / 0.25));
  if (t < 0.7) return rgb(lerp(170, 240, (t - 0.45) / 0.25), lerp(211, 218, (t - 0.45) / 0.25), lerp(235, 154, (t - 0.45) / 0.25));
  if (t < 0.88) return rgb(lerp(240, 235, (t - 0.7) / 0.18), lerp(218, 120, (t - 0.7) / 0.18), lerp(154, 82, (t - 0.7) / 0.18));
  return rgb(lerp(235, 216, (t - 0.88) / 0.12), lerp(120, 43, (t - 0.88) / 0.12), lerp(82, 52, (t - 0.88) / 0.12));
}
function divergingColor(value: number, min: number, mid: number, max: number): string {
  if (!Number.isFinite(value)) return 'rgba(255,255,255,0.08)';
  if (value <= mid) {
    const t = Math.max(0, Math.min(1, (value - min) / Math.max(1e-9, mid - min)));
    return rgb(lerp(32, 246, t), lerp(74, 248, t), lerp(135, 248, t));
  }
  const t = Math.max(0, Math.min(1, (value - mid) / Math.max(1e-9, max - mid)));
  return rgb(lerp(248, 176, t), lerp(248, 11, t), lerp(248, 52, t));
}
function sequentialColor(value: number, min: number, max: number): string {
  if (!Number.isFinite(value)) return 'rgba(255,255,255,0.08)';
  const t = Math.max(0, Math.min(1, (value - min) / Math.max(1e-9, max - min)));
  return shinyHeatSequential(t);
}
function buildHeatCells(points: ChartPoint[], metric: HeatMetric): HeatCell[] {
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
  const runValue = (point: ChartPoint): number => {
    if (typeof point.run_value === 'number' && Number.isFinite(point.run_value)) return point.run_value;
    const pitchCall = String(point.pitch_call ?? '');
    const playResult = String(point.play_result ?? '');
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
    .map((point) => ({ point, x: toNum(point.plate_side), y: toNum(point.plate_height) }))
    .filter((entry): entry is { point: ChartPoint; x: number; y: number } => entry.x !== null && entry.y !== null);
  if (!valid.length) return [];

  const globalSwingCount = valid.filter((entry) => {
    const call = String(entry.point.pitch_call ?? '');
    return call === 'StrikeSwinging' || call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable' || call === 'InPlay';
  }).length;
  const globalWhiffCount = valid.filter((entry) => String(entry.point.pitch_call ?? '') === 'StrikeSwinging').length;
  const globalInPlayCount = valid.filter((entry) => String(entry.point.pitch_call ?? '') === 'InPlay').length;
  const globalGbCount = valid.filter((entry) => String(entry.point.tagged_hit_type ?? '') === 'GroundBall').length;
  const globalEvRows = valid.filter((entry) => String(entry.point.pitch_call ?? '') === 'InPlay' && typeof entry.point.exit_speed === 'number');
  const globalEvAvg = globalEvRows.length ? globalEvRows.reduce((sum, entry) => sum + Number(entry.point.exit_speed || 0), 0) / globalEvRows.length : 0;
  const globalRvAvg = valid.length ? valid.reduce((sum, entry) => sum + runValue(entry.point), 0) / valid.length : 0;
  const globalSwingRate = valid.length ? globalSwingCount / valid.length : 0;
  const globalWhiffRate = globalSwingCount ? globalWhiffCount / globalSwingCount : 0;
  const globalGbRate = globalInPlayCount ? globalGbCount / globalInPlayCount : 0;
  const globalContactRate = globalSwingCount ? globalInPlayCount / globalSwingCount : 0;
  const shrinkStrength = 8;

  const cells: HeatCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    const cy = yMin + (row + 0.5) * cellH;
    for (let col = 0; col < cols; col += 1) {
      const cx = xMin + (col + 0.5) * cellW;
      let sumW = 0;
      let swingW = 0;
      let whiffW = 0;
      let inPlayW = 0;
      let gbW = 0;
      let evWSum = 0;
      let evW = 0;
      let rvWSum = 0;
      for (const entry of valid) {
        const dx = (cx - entry.x) / sigmaX;
        const dy = (cy - entry.y) / sigmaY;
        const w = Math.exp(-0.5 * (dx * dx + dy * dy));
        if (w < 1e-6) continue;
        const call = String(entry.point.pitch_call ?? '');
        const swing = call === 'StrikeSwinging' || call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable' || call === 'InPlay';
        const inPlay = call === 'InPlay';
        const gb = String(entry.point.tagged_hit_type ?? '') === 'GroundBall';
        sumW += w;
        if (swing) swingW += w;
        if (call === 'StrikeSwinging') whiffW += w;
        if (inPlay) inPlayW += w;
        if (gb) gbW += w;
        if (inPlay && typeof entry.point.exit_speed === 'number') {
          evWSum += w * entry.point.exit_speed;
          evW += w;
        }
        rvWSum += w * runValue(entry.point);
      }
      let value = sumW;
      if (metric === 'Whiff Rate') value = 100 * ((whiffW + shrinkStrength * globalWhiffRate) / Math.max(eps, swingW + shrinkStrength));
      if (metric === 'GB Rate') value = 100 * ((gbW + shrinkStrength * globalGbRate) / Math.max(eps, inPlayW + shrinkStrength));
      if (metric === 'Contact Rate') value = 100 * ((inPlayW + shrinkStrength * globalContactRate) / Math.max(eps, swingW + shrinkStrength));
      if (metric === 'Swing Rate') value = 100 * ((swingW + shrinkStrength * globalSwingRate) / Math.max(eps, sumW + shrinkStrength));
      if (metric === 'Exit Velocity') value = (evWSum + shrinkStrength * globalEvAvg) / Math.max(eps, evW + shrinkStrength);
      if (metric === 'Run Values') value = (rvWSum + shrinkStrength * globalRvAvg) / Math.max(eps, sumW + shrinkStrength);
      cells.push({ x: xMin + col * cellW, y: yMin + row * cellH, w: cellW, h: cellH, value, density: sumW });
    }
  }
  if (metric === 'Frequency') {
    const maxVal = Math.max(...cells.map((cell) => cell.value), eps);
    for (const cell of cells) cell.value = (100 * cell.value) / maxVal;
  }
  return cells;
}

function ControlSelect({ label, value, options, onChange }: { label: string; value: string; options: OptionItem[]; onChange: (next: string) => void }) {
  return (
    <label style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function ComparisonPane({ title, compact = false }: { title: string; compact?: boolean }) {
  const paneId = useMemo(() => title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), [title]);
  const [state, setState] = useState<PaneState>(emptyPaneState);
  const [filters, setFilters] = useState<FiltersPayload | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [enableTableColors, setEnableTableColors] = useState(true);
  const [locationHover, setLocationHover] = useState<{ x: number; y: number; text: string; bg?: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(domainFiltersEndpoint(state.domain), { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as FiltersPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load filters.');
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setFilters(payload);
        setState((current) => {
          const latest = String(payload.max_date ?? '');
          const tableModes = payload.table_modes?.length ? payload.table_modes : DOMAIN_TABLES[current.domain];
          const splitOptions = payload.split_by_options?.length ? payload.split_by_options : DOMAIN_SPLIT_BY[current.domain];
          return {
            ...current,
            startDate: current.startDate || latest,
            endDate: current.endDate || latest,
            tableMode: tableModes.includes(current.tableMode) ? current.tableMode : tableModes[0],
            splitBy: splitOptions.includes(current.splitBy) ? current.splitBy : splitOptions[0],
          };
        });
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load filters.');
      });
    return () => {
      active = false;
    };
  }, [state.domain]);

  useEffect(() => {
    let active = true;
    if (!state.startDate || !state.endDate) return;
    const params = new URLSearchParams();
    params.set('start_date', state.startDate);
    params.set('end_date', state.endDate);
    if (state.player !== 'All') params.set(playerQueryKey(state.domain), normalizeNameForApi(state.player));
    if (state.sessionType !== 'All') params.set('session_type', state.sessionType);
    if (state.teamType !== 'All') params.set('team_type', state.teamType);
    if (state.pitchType !== 'All') params.set('pitch_types', state.pitchType);
    if (state.pitchResult !== 'All') params.set('pitch_results', state.pitchResult);
    if (state.countFilter !== 'All') params.set('count_filter', state.countFilter);
    if (state.afterCountFilter !== 'All') params.set('after_count_filter', state.afterCountFilter);
    if (state.pitcherHand !== 'All') params.set('hand', state.pitcherHand);
    if (state.batterHand !== 'All') params.set('batter_side', state.batterHand);
    params.set('table_mode', state.tableMode);
    params.set('split_by', state.splitBy);
    setLoading(true);
    setError('');
    fetch(`${domainOverviewEndpoint(state.domain)}?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as OverviewPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load data.');
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setOverview(payload);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load data.');
        setOverview(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [state.domain, state.startDate, state.endDate, state.player, state.sessionType, state.teamType, state.pitchType, state.pitchResult, state.countFilter, state.afterCountFilter, state.pitcherHand, state.batterHand, state.tableMode, state.splitBy]);

  const playerOptions = useMemo(() => {
    if (!filters) return [{ value: 'All', label: 'All' }];
    if (state.domain === 'Pitching') return optionItems(filters.pitchers, true);
    if (state.domain === 'Hitting') return optionItems(filters.hitters, true);
    return optionItems(filters.catchers, true);
  }, [filters, state.domain]);
  const teamOptions = useMemo(() => optionItems(filters?.team_types), [filters?.team_types]);
  const pitchTypeOptions = useMemo(() => optionItems(filters?.pitch_types), [filters?.pitch_types]);
  const pitchResultOptions = useMemo(() => optionItems(filters?.pitch_result_options), [filters?.pitch_result_options]);
  const countOptions = useMemo(() => optionItems(filters?.count_options), [filters?.count_options]);
  const afterCountOptions = useMemo(() => optionItems(filters?.after_count_options), [filters?.after_count_options]);
  const sessionOptions = useMemo(() => optionItems(filters?.session_types), [filters?.session_types]);
  const handOptions = useMemo(() => optionItems(filters?.hands), [filters?.hands]);
  const batterOptions = useMemo(() => optionItems(filters?.batter_sides), [filters?.batter_sides]);
  const tableModeOptions = useMemo(() => {
    const values = filters?.table_modes?.length ? filters.table_modes : DOMAIN_TABLES[state.domain];
    return values.map((value) => ({ value, label: value }));
  }, [filters?.table_modes, state.domain]);
  const splitByOptions = useMemo(() => {
    const fromFilters = filters?.split_by_options ?? [];
    const values = Array.from(new Set([...DOMAIN_SPLIT_BY[state.domain], ...fromFilters]));
    return values.map((value) => ({ value, label: value }));
  }, [filters?.split_by_options, state.domain]);

  const points = overview?.chart_points ?? [];
  const heatmapPoints = overview?.heatmap_points ?? points;
  const tableColumns = overview?.table_columns ?? [];
  const tableColorMode = useMemo(() => {
    if (!state.tableMode) return '';
    if (state.tableMode === 'Custom') return 'Custom';
    return state.tableMode;
  }, [state.tableMode]);
  const shouldColorTable = useMemo(
    () => enableTableColors && ['Process', 'Live', 'Results', 'Bullpen', 'Custom'].includes(tableColorMode),
    [enableTableColors, tableColorMode]
  );
  const colorColumnsByMode: Record<string, string[]> = {
    Process: ['InZone%', 'Comp%', 'Strike%', 'Swing%', 'FPS%', 'Early%', 'Ahead%', 'E+A%', '1-1W%', 'QP%', 'Ctrl+', 'QP+', 'Stuff+', 'Pitching+', 'RV/100'],
    Live: ['InZone%', 'Strike%', 'FPS%', 'E+A%', 'QP+', 'Ctrl+', 'Pitching+', 'K%', 'BB%', 'Whiff%'],
    Results: ['Whiff%', 'K%', 'BB%', 'CSW%', 'GB%', 'Barrel%', 'EV'],
    Bullpen: ['InZone%', 'Comp%', 'Ctrl+', 'Stuff+'],
    Custom: [
      'InZone%',
      'Comp%',
      'Strike%',
      'Swing%',
      'FPS%',
      'Early%',
      'Ahead%',
      'E+A%',
      '1-1W%',
      'QP%',
      'Ctrl+',
      'QP+',
      'Stuff+',
      'Pitching+',
      'RV/100',
      'K%',
      'BB%',
      'Whiff%',
      'CSW%',
      'GB%',
      'Barrel%',
      'EV',
    ],
  };
  const tableColorColumns = useMemo(() => colorColumnsByMode[tableColorMode] ?? [], [tableColorMode]);
  const splitColName = tableColumns[0] ?? '';
  const sortedRows = useMemo(() => {
    const splitColumn = tableColumns[0] ?? '';
    const sortCol = state.sortColumn && tableColumns.includes(state.sortColumn) ? state.sortColumn : (tableColumns[1] ?? tableColumns[0] ?? '');
    const baseRows = sortTableRows(overview?.table_rows ?? [], sortCol, state.sortDirection, splitColumn);
    if (state.splitBy === 'Times Through Order') {
      return reorderTimesThroughOrderRows(baseRows, splitColumn);
    }
    return baseRows;
  }, [overview?.table_rows, tableColumns, state.sortColumn, state.sortDirection, state.splitBy]);
  const pitchTypeForRow = (row: Record<string, string | number | null>): string => {
    if (state.splitBy !== 'Pitch Types') return 'all';
    const raw = row[splitColName];
    if (raw === null || raw === undefined) return 'all';
    const text = String(raw).trim();
    if (!text || text.toLowerCase() === 'all') return 'all';
    return text;
  };
  const getTableCellStyle = (row: Record<string, string | number | null>, column: string): { backgroundColor: string; color: string } | null => {
    if (column === splitColName && state.splitBy === 'Pitch Types') {
      const pitchType = pitchTypeForRow(row);
      if (pitchType === 'all') return null;
      const bg = PITCH_COLORS[pitchType];
      if (!bg) return null;
      return { backgroundColor: bg, color: pitchType === 'Fastball' ? '#111827' : '#f8fafc' };
    }
    if (!shouldColorTable) return null;
    if (!tableColorColumns.includes(column)) return null;
    const colors = getCellColorScale(row[column], column, pitchTypeForRow(row));
    if (!colors) return null;
    return { backgroundColor: colors.bg, color: colors.text };
  };

  const chart = state.chartType === 'Heatmap' ? (() => {
    const w = 560;
    const h = 460;
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
    const zoom = 1.2;
    const zoomTransform = `translate(${w / 2} ${h / 2}) scale(${zoom}) translate(${-w / 2} ${-h / 2})`;
    const cells = buildHeatCells(heatmapPoints, state.heatMetric);
    const values = cells.map((cell) => cell.value).sort((a, b) => a - b);
    const minVal = values.length ? values[0] : 0;
    const maxVal = values.length ? values[values.length - 1] : 1;
    const midVal = values.length ? values[Math.floor(values.length / 2)] : 0;
    const maxAbs = Math.max(1, ...cells.map((cell) => Math.abs(cell.value)));
    const densityMax = Math.max(1e-9, ...cells.map((cell) => cell.density));
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 460, border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10 }}>
          <defs>
            <clipPath id={`cmp-heat-clip-${paneId}`}>
              <rect x={0} y={0} width={w} height={h} />
            </clipPath>
            <filter id={`cmp-heat-blur-${paneId}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.1" />
            </filter>
            <filter id={`cmp-heat-blur-rv-${paneId}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.25" />
            </filter>
          </defs>
          <g transform={zoomTransform} clipPath={`url(#cmp-heat-clip-${paneId})`}>
            <g filter={state.heatMetric === 'Run Values' ? `url(#cmp-heat-blur-rv-${paneId})` : `url(#cmp-heat-blur-${paneId})`}>
              {cells.map((cell) => {
                const cx = px(cell.x + cell.w / 2);
                const cy = py(cell.y + cell.h / 2);
                const radius = Math.max(2.8, cell.w * scale * 2.05);
                const densityNorm = Math.max(0, Math.min(1, cell.density / densityMax));
                let fill = 'rgba(255,255,255,0.12)';
                if (state.heatMetric === 'Frequency') fill = sequentialColor(cell.value, minVal, maxVal);
                else if (state.heatMetric === 'Run Values') {
                  const ratio = cell.value / maxAbs;
                  fill = ratio >= 0 ? `rgba(255,48,48,${0.24 + Math.abs(ratio) * 0.76})` : `rgba(54,129,255,${0.24 + Math.abs(ratio) * 0.76})`;
                } else fill = divergingColor(cell.value, minVal, midVal, maxVal);
                const normalized = state.heatMetric === 'Run Values'
                  ? Math.abs(cell.value) / maxAbs
                  : Math.max(0, (cell.value - minVal) / Math.max(1e-9, maxVal - minVal));
                const runValueBoost = state.heatMetric === 'Run Values' ? Math.pow(normalized, 0.55) : normalized;
                if (state.heatMetric !== 'Frequency' && state.heatMetric !== 'Run Values' && densityNorm < 0.16) return null;
                if (state.heatMetric !== 'Run Values' && normalized < 0.06) return null;
                return <circle key={`cmp-blur-${cell.x}-${cell.y}`} cx={cx} cy={cy} r={radius} fill={fill} opacity={Math.max(0.3, runValueBoost * 1.25 * (state.heatMetric === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))} />;
              })}
            </g>
            {cells.map((cell) => {
              const cx = px(cell.x + cell.w / 2);
              const cy = py(cell.y + cell.h / 2);
              const radius = Math.max(1.4, cell.w * scale * 1.08);
              const densityNorm = Math.max(0, Math.min(1, cell.density / densityMax));
              let fill = 'rgba(255,255,255,0.12)';
              if (state.heatMetric === 'Frequency') fill = sequentialColor(cell.value, minVal, maxVal);
              else if (state.heatMetric === 'Run Values') {
                const ratio = cell.value / maxAbs;
                fill = ratio >= 0 ? `rgba(255,48,48,${0.2 + Math.abs(ratio) * 0.8})` : `rgba(54,129,255,${0.2 + Math.abs(ratio) * 0.8})`;
              } else fill = divergingColor(cell.value, minVal, midVal, maxVal);
              const normalized = state.heatMetric === 'Run Values'
                ? Math.abs(cell.value) / maxAbs
                : Math.max(0, (cell.value - minVal) / Math.max(1e-9, maxVal - minVal));
              const runValueBoost = state.heatMetric === 'Run Values' ? Math.pow(normalized, 0.55) : normalized;
              if (state.heatMetric !== 'Frequency' && state.heatMetric !== 'Run Values' && densityNorm < 0.16) return null;
              if (state.heatMetric !== 'Run Values' && normalized < 0.06) return null;
              return <circle key={`cmp-core-${cell.x}-${cell.y}`} cx={cx} cy={cy} r={radius} fill={fill} opacity={Math.max(0.2, runValueBoost * 0.72 * (state.heatMetric === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))} />;
            })}
            <polygon points={`${px(-0.75)},${py(0.55)} ${px(0.75)},${py(0.55)} ${px(0.75)},${py(0.65)} ${px(0)},${py(0.75)} ${px(-0.75)},${py(0.65)}`} fill="none" stroke="rgba(255,255,255,0.85)" />
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.82rem', opacity: 0.9 }}>Least</span>
          <div style={{ height: 8, width: 180, borderRadius: 999, background: 'linear-gradient(90deg, rgb(32,74,135), rgb(246,248,248), rgb(176,11,52))' }} />
          <span style={{ fontSize: '0.82rem', opacity: 0.9 }}>Most</span>
        </div>
      </div>
    );
  })() : state.chartType === 'Pitch Chart' ? (() => {
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
    const tooltipHtml = (point: ChartPoint): string =>
      `Result: ${resultLabel(point.pitch_call, point.play_result)}\nVelo: ${(toNum(point.rel_speed) ?? toNum(point.velo))?.toFixed(1) ?? '-'} mph\nIVB: ${toNum(point.ivb)?.toFixed(1) ?? '-'} in\nHB: ${toNum(point.hb)?.toFixed(1) ?? '-'} in\nEV: ${toNum(point.exit_speed)?.toFixed(1) ?? '-'} mph\nLA: ${toNum(point.angle)?.toFixed(1) ?? '-'}°\nIn Zone: ${inZoneLabel(toNum(point.plate_side), toNum(point.plate_height))}`;
    const glyph = (
      result: string,
      x: number,
      y: number,
      fill: string,
      key: string,
      titleText: string
    ) => {
      const hoverProps = {
        onMouseMove: (event: { clientX: number; clientY: number }) => setLocationHover({ x: event.clientX, y: event.clientY, text: titleText, bg: fill }),
        onMouseLeave: () => setLocationHover(null),
      };
      if (result === 'Ball') return <circle key={key} cx={x} cy={y} r={6.2} fill="none" stroke={fill} strokeWidth={1.8} {...hoverProps} />;
      if (result === 'Foul') return <polygon key={key} points={`${x},${y - 6} ${x - 5.4},${y + 4.6} ${x + 5.4},${y + 4.6}`} fill="none" stroke={fill} strokeWidth={1.8} {...hoverProps} />;
      if (result === 'Whiff') return <text key={key} x={x} y={y + 4.8} fontSize={13} textAnchor="middle" fill={fill} {...hoverProps}>★</text>;
      if (result === 'In Play (Out)') return <polygon key={key} points={`${x},${y - 6} ${x - 5.4},${y + 4.6} ${x + 5.4},${y + 4.6}`} fill={fill} {...hoverProps} />;
      if (result === 'In Play (Hit)' || result === 'Single' || result === 'Double' || result === 'Triple' || result === 'HomeRun') return <rect key={key} x={x - 5.1} y={y - 5.1} width={10.2} height={10.2} fill={fill} {...hoverProps} />;
      if (result === 'Error') return <rect key={key} x={x - 5.1} y={y - 5.1} width={10.2} height={10.2} fill="none" stroke={fill} strokeWidth={1.6} {...hoverProps} />;
      return <circle key={key} cx={x} cy={y} r={6.2} fill={fill} {...hoverProps} />;
    };
    return (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 360 }} onMouseLeave={() => setLocationHover(null)}>
        <polygon points={`${px(-0.75)},${py(0.55)} ${px(0.75)},${py(0.55)} ${px(0.75)},${py(0.65)} ${px(0)},${py(0.75)} ${px(-0.75)},${py(0.65)}`} fill="none" stroke="rgba(255,255,255,0.85)" />
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
        {points
          .filter((point) => toNum(point.plate_side) !== null && toNum(point.plate_height) !== null)
          .map((point, i) => {
            const x = px(Number(toNum(point.plate_side)));
            const y = py(Number(toNum(point.plate_height)));
            const color = PITCH_COLORS[String(point.pitch_type || 'Undefined')] ?? '#9ca3af';
            const result = resultShape(point.pitch_call, point.play_result);
            return glyph(result, x, y, color, `cmp-pitch-${i}`, tooltipHtml(point));
          })}
      </svg>
    );
  })() : state.chartType === 'Velocity Chart' ? (() => {
    const velocityPoints = [...points]
      .filter((point) => toNum(point.rel_speed) !== null || toNum(point.velo) !== null)
      .map((point) => ({ ...point, velocity: toNum(point.rel_speed) ?? toNum(point.velo) ?? null }))
      .filter((point): point is ChartPoint & { velocity: number } => point.velocity !== null)
      .sort((a, b) => {
        const da = Date.parse(a.session_date ?? '');
        const db = Date.parse(b.session_date ?? '');
        const dCmp = (Number.isFinite(da) ? da : 0) - (Number.isFinite(db) ? db : 0);
        if (dCmp !== 0) return dCmp;
        const pnCmp = (a.pitch_number ?? 0) - (b.pitch_number ?? 0);
        if (pnCmp !== 0) return pnCmp;
        const pnoCmp = (a.pitch_no ?? 0) - (b.pitch_no ?? 0);
        if (pnoCmp !== 0) return pnoCmp;
        return (a.pitch_event_id ?? 0) - (b.pitch_event_id ?? 0);
      })
      .map((point, idx) => ({ ...point, pitch_count: idx + 1 }));

    if (state.velocityMode === 'Velocity Chart (Game/Inning)') {
      const yVals = velocityPoints.map((point) => point.velocity).filter((value) => Number.isFinite(value));
      if (!velocityPoints.length || !yVals.length) return <p className="portal-muted-text">No velocity points.</p>;
      const byType = new Map<string, { sum: number; n: number }>();
      for (const point of velocityPoints) {
        const pitchType = String(point.pitch_type || 'Undefined');
        const current = byType.get(pitchType) ?? { sum: 0, n: 0 };
        current.sum += point.velocity;
        current.n += 1;
        byType.set(pitchType, current);
      }
      const avgByType = Array.from(byType.entries()).map(([pitchType, agg]) => ({
        pitch_type: pitchType,
        avg_velo: agg.n > 0 ? agg.sum / agg.n : null,
      }));
      const sessionTypes = Array.from(new Set(velocityPoints.map((point) => String(point.session_type || '').toLowerCase()).filter(Boolean)));
      const allLive = sessionTypes.length === 1 && sessionTypes[0] === 'live';
      const inningBoundaries: number[] = [];
      if (allLive) {
        for (let i = 1; i < velocityPoints.length; i += 1) {
          const prev = String(velocityPoints[i - 1].inning ?? '').trim();
          const cur = String(velocityPoints[i].inning ?? '').trim();
          if (prev && cur && prev !== cur) inningBoundaries.push(velocityPoints[i].pitch_count);
        }
      }
      const w = 980;
      const h = 340;
      const m = { l: 56, r: 20, t: 18, b: 44 };
      const pw = w - m.l - m.r;
      const ph = h - m.t - m.b;
      const yMinRaw = Math.min(...yVals);
      const yMaxRaw = Math.max(...yVals);
      const yMin = Math.floor(yMinRaw / 5) * 5;
      const yMax = Math.max(yMin + 5, Math.ceil(yMaxRaw / 5) * 5);
      const xMax = Math.max(5, Math.ceil(velocityPoints.length / 5) * 5);
      const px = (x: number) => m.l + (x / xMax) * pw;
      const py = (y: number) => m.t + ((yMax - y) / (yMax - yMin)) * ph;
      const yTicks = Array.from({ length: Math.floor((yMax - yMin) / 5) + 1 }, (_, i) => yMin + i * 5);
      const xTicks = Array.from({ length: Math.floor(xMax / 5) + 1 }, (_, i) => i * 5);
      return (
        <div style={{ position: 'relative' }}>
          <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 360, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }} onMouseLeave={() => setLocationHover(null)}>
            {yTicks.map((tick) => (
              <g key={`cmp-v1-y-${tick}`}>
                <line x1={m.l} y1={py(tick)} x2={w - m.r} y2={py(tick)} stroke="rgba(255,255,255,0.14)" />
                <text x={m.l - 8} y={py(tick) + 4} textAnchor="end" fill="rgba(255,255,255,0.78)" fontSize={11}>{tick}</text>
              </g>
            ))}
            {xTicks.map((tick) => (
              <g key={`cmp-v1-x-${tick}`}>
                <line x1={px(tick)} y1={m.t} x2={px(tick)} y2={h - m.b} stroke="rgba(255,255,255,0.08)" />
                <text x={px(tick)} y={h - 14} textAnchor="middle" fill="rgba(255,255,255,0.78)" fontSize={11}>{tick}</text>
              </g>
            ))}
            {avgByType
              .filter((row) => typeof row.avg_velo === 'number')
              .map((row) => (
                <line key={`cmp-v1-avg-${row.pitch_type}`} x1={m.l} y1={py(Number(row.avg_velo))} x2={w - m.r} y2={py(Number(row.avg_velo))} stroke={PITCH_COLORS[row.pitch_type] ?? '#9ca3af'} strokeWidth={1.1} opacity={0.8} />
              ))}
            {inningBoundaries.map((value) => (
              <line key={`cmp-v1-bound-${value}`} x1={px(value)} y1={m.t} x2={px(value)} y2={h - m.b} stroke="rgba(255,255,255,0.5)" strokeDasharray="4,4" />
            ))}
            {velocityPoints.map((point) => {
              const x = px(point.pitch_count);
              const y = py(point.velocity);
              const color = PITCH_COLORS[String(point.pitch_type || 'Undefined')] ?? '#9ca3af';
              return (
                <circle
                  key={`cmp-v1-pt-${point.pitch_event_id ?? point.pitch_count}`}
                  cx={x}
                  cy={y}
                  r={4.6}
                  fill={color}
                  stroke="rgba(0,0,0,0.5)"
                  onMouseMove={(event) =>
                    setLocationHover({
                      x: event.clientX,
                      y: event.clientY,
                      bg: color,
                      text: [
                        `Session: ${point.session_type || '-'}`,
                        `${point.pitch_type || 'Pitch'}`,
                        `Velo: ${fmtNum(point.velocity, 1)} mph`,
                        `IVB: ${fmtNum(toNum(point.ivb), 1)}`,
                        `HB: ${fmtNum(toNum(point.hb), 1)}`,
                      ].join('\n'),
                    })
                  }
                />
              );
            })}
          </svg>
        </div>
      );
    }

    if (state.velocityMode === 'Average Velocity by Game') {
      const grouped = new Map<string, { date: string; pitch_type: string; session_type: string; sumV: number; sumIvb: number; ivbN: number; sumHb: number; hbN: number; n: number }>();
      const dateSet = new Set<string>();
      for (const point of velocityPoints) {
        const date = String(point.session_date ?? '').slice(0, 10);
        if (!date) continue;
        dateSet.add(date);
        const pitchType = String(point.pitch_type || 'Undefined');
        const sessionType = String(point.session_type || 'Unknown');
        const key = `${date}|${pitchType}|${sessionType}`;
        const current = grouped.get(key) ?? { date, pitch_type: pitchType, session_type: sessionType, sumV: 0, sumIvb: 0, ivbN: 0, sumHb: 0, hbN: 0, n: 0 };
        current.sumV += point.velocity;
        current.n += 1;
        if (toNum(point.ivb) !== null) {
          current.sumIvb += Number(toNum(point.ivb));
          current.ivbN += 1;
        }
        if (toNum(point.hb) !== null) {
          current.sumHb += Number(toNum(point.hb));
          current.hbN += 1;
        }
        grouped.set(key, current);
      }
      const dateLevels = Array.from(dateSet).sort();
      const rows = Array.from(grouped.values())
        .map((group) => ({
          date: group.date,
          pitch_type: group.pitch_type,
          session_type: group.session_type,
          velo: group.n > 0 ? group.sumV / group.n : null,
          ivb: group.ivbN > 0 ? group.sumIvb / group.ivbN : null,
          hb: group.hbN > 0 ? group.sumHb / group.hbN : null,
          n: group.n,
        }))
        .filter((group): group is { date: string; pitch_type: string; session_type: string; velo: number; ivb: number | null; hb: number | null; n: number } => group.velo !== null)
        .sort((a, b) => {
          const dCmp = a.date.localeCompare(b.date);
          if (dCmp !== 0) return dCmp;
          return a.pitch_type.localeCompare(b.pitch_type);
        });
      if (!rows.length || !dateLevels.length) return <p className="portal-muted-text">No by-game velocity data.</p>;
      const yVals = rows.map((row) => Number(row.velo)).filter((value) => Number.isFinite(value));
      const w = 980;
      const h = 420;
      const m = { l: 56, r: 20, t: 18, b: 100 };
      const pw = w - m.l - m.r;
      const ph = h - m.t - m.b;
      const yMin = Math.floor(Math.min(...yVals) / 5) * 5;
      const yMax = Math.max(yMin + 5, Math.ceil(Math.max(...yVals) / 5) * 5);
      const dateX = new Map(dateLevels.map((date, i) => [date, m.l + (i / Math.max(1, dateLevels.length - 1)) * pw]));
      const py = (y: number) => m.t + ((yMax - y) / (yMax - yMin)) * ph;
      const yTicks = Array.from({ length: Math.floor((yMax - yMin) / 5) + 1 }, (_, i) => yMin + i * 5);
      const byType = new Map<string, typeof rows>();
      for (const row of rows) {
        const current = byType.get(row.pitch_type) ?? [];
        current.push(row);
        byType.set(row.pitch_type, current);
      }
      return (
        <div style={{ position: 'relative' }}>
          <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 430, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }} onMouseLeave={() => setLocationHover(null)}>
            {yTicks.map((tick) => (
              <g key={`cmp-v2-y-${tick}`}>
                <line x1={m.l} y1={py(tick)} x2={w - m.r} y2={py(tick)} stroke="rgba(255,255,255,0.14)" />
                <text x={m.l - 8} y={py(tick) + 4} textAnchor="end" fill="rgba(255,255,255,0.78)" fontSize={11}>{tick}</text>
              </g>
            ))}
            {dateLevels.map((date) => (
              <g key={`cmp-v2-x-${date}`}>
                <line x1={Number(dateX.get(date))} y1={m.t} x2={Number(dateX.get(date))} y2={h - m.b} stroke="rgba(255,255,255,0.08)" />
                <text x={Number(dateX.get(date))} y={h - m.b + 24} textAnchor="middle" dominantBaseline="hanging" fill="rgba(255,255,255,0.78)" fontSize={11}>
                  {formatShortDate(date)}
                </text>
              </g>
            ))}
            {Array.from(byType.entries()).map(([pitchType, arr]) => {
              const sorted = [...arr].sort((a, b) => a.date.localeCompare(b.date));
              const linePoints = sorted.map((row) => `${Number(dateX.get(row.date))},${py(Number(row.velo))}`).join(' ');
              return <polyline key={`cmp-v2-line-${pitchType}`} points={linePoints} fill="none" stroke={PITCH_COLORS[pitchType] ?? '#9ca3af'} strokeWidth={1.5} opacity={0.9} />;
            })}
            {rows.map((row, idx) => {
              const color = PITCH_COLORS[row.pitch_type] ?? '#9ca3af';
              return (
                <circle
                  key={`cmp-v2-pt-${idx}`}
                  cx={Number(dateX.get(row.date))}
                  cy={py(Number(row.velo))}
                  r={3.8}
                  fill={color}
                  stroke="rgba(0,0,0,0.5)"
                  onMouseMove={(event) =>
                    setLocationHover({
                      x: event.clientX,
                      y: event.clientY,
                      bg: color,
                      text: [
                        `Session: ${row.session_type || 'Unknown'}`,
                        `${row.pitch_type}`,
                        `Velo: ${fmtNum(row.velo, 1)} mph`,
                        `IVB: ${fmtNum(row.ivb, 1)}`,
                        `HB: ${fmtNum(row.hb, 1)}`,
                        `Pitches: ${row.n}`,
                      ].join('\n'),
                    })
                  }
                />
              );
            })}
          </svg>
        </div>
      );
    }

    const inningPoints = velocityPoints.filter((point) => String(point.session_type || '').toLowerCase().includes('live') && parseInningNumber(point.inning) !== null);
    if (!inningPoints.length) return <p className="portal-muted-text">No Live pitches with Inning values for current filters.</p>;
    const byGame = new Map<string, typeof inningPoints>();
    for (const point of inningPoints) {
      const dateKey = String(point.session_date ?? '').slice(0, 10);
      const gameKey = point.game_id || point.game_uid || point.game_foreign_id || dateKey || 'unknown_game';
      const current = byGame.get(gameKey) ?? [];
      current.push(point);
      byGame.set(gameKey, current);
    }
    const grouped = new Map<string, { inning_ord: number; pitch_type: string; sumV: number; n: number; sumIvb: number; ivbN: number; sumHb: number; hbN: number; games: Set<string> }>();
    for (const [gameKey, rows] of byGame.entries()) {
      const sorted = [...rows].sort((a, b) => {
        const da = Date.parse(a.session_date ?? '');
        const db = Date.parse(b.session_date ?? '');
        const dCmp = (Number.isFinite(da) ? da : 0) - (Number.isFinite(db) ? db : 0);
        if (dCmp !== 0) return dCmp;
        const pnCmp = (a.pitch_number ?? 0) - (b.pitch_number ?? 0);
        if (pnCmp !== 0) return pnCmp;
        const pnoCmp = (a.pitch_no ?? 0) - (b.pitch_no ?? 0);
        if (pnoCmp !== 0) return pnoCmp;
        return (a.pitch_event_id ?? 0) - (b.pitch_event_id ?? 0);
      });
      const inningOrder = new Map<string, number>();
      let inningCounter = 0;
      for (const point of sorted) {
        const parsedInning = parseInningNumber(point.inning);
        if (parsedInning === null) continue;
        const inningKey = String(parsedInning);
        if (!inningOrder.has(inningKey)) {
          inningCounter += 1;
          inningOrder.set(inningKey, inningCounter);
        }
        const inningOrd = inningOrder.get(inningKey);
        if (!inningOrd) continue;
        const pitchType = String(point.pitch_type || 'Undefined');
        const key = `${inningOrd}|${pitchType}`;
        const current = grouped.get(key) ?? { inning_ord: inningOrd, pitch_type: pitchType, sumV: 0, n: 0, sumIvb: 0, ivbN: 0, sumHb: 0, hbN: 0, games: new Set<string>() };
        current.sumV += point.velocity;
        current.n += 1;
        current.games.add(gameKey);
        if (toNum(point.ivb) !== null) {
          current.sumIvb += Number(toNum(point.ivb));
          current.ivbN += 1;
        }
        if (toNum(point.hb) !== null) {
          current.sumHb += Number(toNum(point.hb));
          current.hbN += 1;
        }
        grouped.set(key, current);
      }
    }
    const rows = Array.from(grouped.values())
      .map((group) => ({
        inning_ord: group.inning_ord,
        pitch_type: group.pitch_type,
        velo: group.n > 0 ? group.sumV / group.n : null,
        ivb: group.ivbN > 0 ? group.sumIvb / group.ivbN : null,
        hb: group.hbN > 0 ? group.sumHb / group.hbN : null,
        n: group.n,
        games: group.games.size,
      }))
      .filter((group): group is { inning_ord: number; pitch_type: string; velo: number; ivb: number | null; hb: number | null; n: number; games: number } => group.velo !== null)
      .sort((a, b) => (a.inning_ord - b.inning_ord) || a.pitch_type.localeCompare(b.pitch_type));
    if (!rows.length) return <p className="portal-muted-text">No Live pitches with Inning values for current filters.</p>;
    const yVals = rows.map((row) => Number(row.velo)).filter((value) => Number.isFinite(value));
    const xMax = Math.max(...rows.map((row) => row.inning_ord));
    const w = 980;
    const h = 340;
    const m = { l: 56, r: 20, t: 18, b: 44 };
    const pw = w - m.l - m.r;
    const ph = h - m.t - m.b;
    const yMin = Math.floor(Math.min(...yVals) / 5) * 5;
    const yMax = Math.max(yMin + 5, Math.ceil(Math.max(...yVals) / 5) * 5);
    const px = (x: number) => m.l + ((x - 1) / Math.max(1, xMax - 1)) * pw;
    const py = (y: number) => m.t + ((yMax - y) / (yMax - yMin)) * ph;
    const yTicks = Array.from({ length: Math.floor((yMax - yMin) / 5) + 1 }, (_, i) => yMin + i * 5);
    const xTicks = Array.from({ length: xMax }, (_, i) => i + 1);
    const byType = new Map<string, typeof rows>();
    for (const row of rows) {
      const current = byType.get(row.pitch_type) ?? [];
      current.push(row);
      byType.set(row.pitch_type, current);
    }
    return (
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 360, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }} onMouseLeave={() => setLocationHover(null)}>
          {yTicks.map((tick) => (
            <g key={`cmp-v3-y-${tick}`}>
              <line x1={m.l} y1={py(tick)} x2={w - m.r} y2={py(tick)} stroke="rgba(255,255,255,0.14)" />
              <text x={m.l - 8} y={py(tick) + 4} textAnchor="end" fill="rgba(255,255,255,0.78)" fontSize={11}>{tick}</text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <g key={`cmp-v3-x-${tick}`}>
              <line x1={px(tick)} y1={m.t} x2={px(tick)} y2={h - m.b} stroke="rgba(255,255,255,0.08)" />
              <text x={px(tick)} y={h - 14} textAnchor="middle" fill="rgba(255,255,255,0.78)" fontSize={11}>{tick}</text>
            </g>
          ))}
          {Array.from(byType.entries()).map(([pitchType, arr]) => {
            const sorted = [...arr].sort((a, b) => a.inning_ord - b.inning_ord);
            const linePoints = sorted.map((row) => `${px(row.inning_ord)},${py(Number(row.velo))}`).join(' ');
            return <polyline key={`cmp-v3-line-${pitchType}`} points={linePoints} fill="none" stroke={PITCH_COLORS[pitchType] ?? '#9ca3af'} strokeWidth={1.5} opacity={0.9} />;
          })}
          {rows.map((row, idx) => {
            const color = PITCH_COLORS[row.pitch_type] ?? '#9ca3af';
            return (
              <circle
                key={`cmp-v3-pt-${idx}`}
                cx={px(row.inning_ord)}
                cy={py(Number(row.velo))}
                r={3.8}
                fill={color}
                stroke="rgba(0,0,0,0.5)"
                onMouseMove={(event) =>
                  setLocationHover({
                    x: event.clientX,
                    y: event.clientY,
                    bg: color,
                    text: [
                      'Session: Live',
                      `Inning #: ${row.inning_ord}`,
                      `${row.pitch_type}`,
                      `Velo: ${fmtNum(row.velo, 1)} mph`,
                      `IVB: ${fmtNum(row.ivb, 1)}`,
                      `HB: ${fmtNum(row.hb, 1)}`,
                      `Games: ${row.games} | Pitches: ${row.n}`,
                    ].join('\n'),
                  })
                }
              />
            );
          })}
        </svg>
      </div>
    );
  })() : state.chartType === 'Release Plot' ? (() => {
    const w = 520;
    const h = 360;
    const pad = 22;
    const xMin = -4;
    const xMax = 4;
    const yMin = 0;
    const yMax = Math.max(6, ...points.map((point) => toNum(point.release_height) ?? 0)) + 0.2;
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
    const showPitches = state.releaseView === 'Averages and Pitches' || state.releaseView === 'Pitches';
    const showAverages = state.releaseView === 'Averages Only' || state.releaseView === 'Averages and Pitches';
    const moundX = Array.from({ length: 81 }, (_, i) => -4 + (i / 80) * 8);
    const moundPts = [
      ...moundX.map((x) => `${px(x)},${py(0.83 * (1 - (x / 4) ** 2))}`),
      ...moundX.slice().reverse().map((x) => `${px(x)},${py(0)}`),
    ].join(' ');
    const rubberLeft = px(-1);
    const rubberRight = px(1);
    const rubberTop = py(0.9);
    const rubberBottom = py(0.76);
    const xTicks = [-4, -2, 0, 2, 4];
    const yTicks = [0, 1, 2, 3, 4, 5, 6];
    const releaseTooltipHtml = (point: ChartPoint): string =>
      `Session: ${point.session_type || '-'}\nHeight: ${toNum(point.release_height)?.toFixed(2) ?? '-'} ft\nSide: ${toNum(point.release_side)?.toFixed(2) ?? '-'} ft\nExtension: ${toNum(point.extension)?.toFixed(2) ?? '-'} ft`;
    const avgByType = Object.entries(
      points.reduce<Record<string, { n: number; releaseSide: number; releaseHeight: number; extension: number; extensionN: number }>>(
        (acc, point) => {
          const pitchType = String(point.pitch_type || 'Undefined');
          const releaseSide = toNum(point.release_side);
          const releaseHeight = toNum(point.release_height);
          const extension = toNum(point.extension);
          if (releaseSide === null || releaseHeight === null) return acc;
          if (!acc[pitchType]) acc[pitchType] = { n: 0, releaseSide: 0, releaseHeight: 0, extension: 0, extensionN: 0 };
          acc[pitchType].n += 1;
          acc[pitchType].releaseSide += releaseSide;
          acc[pitchType].releaseHeight += releaseHeight;
          if (extension !== null) {
            acc[pitchType].extension += extension;
            acc[pitchType].extensionN += 1;
          }
          return acc;
        },
        {}
      )
    ).map(([pitchType, sums]) => ({
      pitch_type: pitchType,
      release_side: sums.n ? sums.releaseSide / sums.n : null,
      release_height: sums.n ? sums.releaseHeight / sums.n : null,
      extension: sums.extensionN ? sums.extension / sums.extensionN : null,
    }));
    return (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 360 }} onMouseLeave={() => setLocationHover(null)}>
        {xTicks.map((tick) => (
          <line key={`cmp-r-x-grid-${tick}`} x1={px(tick)} y1={py(yMin)} x2={px(tick)} y2={py(yMax)} stroke="rgba(255,255,255,0.18)" />
        ))}
        {yTicks.map((tick) => (
          <line key={`cmp-r-y-grid-${tick}`} x1={px(xMin)} y1={py(tick)} x2={px(xMax)} y2={py(tick)} stroke="rgba(255,255,255,0.18)" />
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
          <text key={`cmp-r-x-label-${tick}`} x={px(tick)} y={py(yMin) + 20} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.9)">
            {tick}
          </text>
        ))}
        {yTicks.map((tick) => (
          <text key={`cmp-r-y-label-${tick}`} x={px(xMin) - 8} y={py(tick) + 3.5} textAnchor="end" fontSize={10.5} fill="rgba(255,255,255,0.9)">
            {tick}
          </text>
        ))}
        {showPitches
          ? points
              .filter((point) => toNum(point.release_side) !== null && toNum(point.release_height) !== null)
              .map((point, i) => {
                const pitchType = String(point.pitch_type || 'Undefined');
                const color = PITCH_COLORS[pitchType] ?? PITCH_COLORS.Undefined;
                return (
                  <circle
                    key={`cmp-r-p-${i}`}
                    cx={px(Number(toNum(point.release_side)))}
                    cy={py(Number(toNum(point.release_height)))}
                    r={3.2}
                    fill={color}
                    stroke="rgba(0,0,0,0.52)"
                    strokeWidth={1.1}
                    opacity={0.42}
                    onMouseMove={(event) =>
                      setLocationHover({
                        x: event.clientX,
                        y: event.clientY,
                        text: releaseTooltipHtml(point),
                        bg: color,
                      })
                    }
                    onMouseLeave={() => setLocationHover(null)}
                  />
                );
              })
          : null}
        {showAverages
          ? avgByType
              .filter((point) => point.release_side !== null && point.release_height !== null)
              .map((point) => {
                const color = PITCH_COLORS[point.pitch_type] ?? PITCH_COLORS.Undefined;
                return (
                  <circle
                    key={`cmp-r-a-${point.pitch_type}`}
                    cx={px(Number(point.release_side))}
                    cy={py(Number(point.release_height))}
                    r={8.6}
                    fill={color}
                    stroke="rgba(0,0,0,0.68)"
                    strokeWidth={2.2}
                    opacity={0.98}
                    onMouseMove={(event) =>
                      setLocationHover({
                        x: event.clientX,
                        y: event.clientY,
                        text: `${point.pitch_type}\nHeight: ${point.release_height?.toFixed(1) ?? '-'} ft\nSide: ${point.release_side?.toFixed(1) ?? '-'} ft\nExtension: ${point.extension?.toFixed(1) ?? '-'} ft`,
                        bg: color,
                      })
                    }
                    onMouseLeave={() => setLocationHover(null)}
                  />
                );
              })
          : null}
      </svg>
    );
  })() : state.chartType === 'Movement Plot' ? (() => {
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
    const showPitches = state.movementView === 'Averages and Pitches';
    const showAverages = state.movementView === 'Averages Only' || state.movementView === 'Averages and Pitches';
    const ticks = [-20, -10, 0, 10, 20];
    const movementTooltipHtml = (point: ChartPoint): string =>
      `Session: ${point.session_type || '-'}\nResult: ${resultLabel(point.pitch_call, point.play_result)}\nVelo: ${(toNum(point.rel_speed) ?? toNum(point.velo))?.toFixed(1) ?? '-'} mph\nIVB: ${toNum(point.ivb)?.toFixed(1) ?? '-'} in\nHB: ${toNum(point.hb)?.toFixed(1) ?? '-'} in\nEV: ${toNum(point.exit_speed)?.toFixed(1) ?? '-'} mph\nLA: ${toNum(point.angle)?.toFixed(1) ?? '-'}°\nStuff+: ${toNum(point.stuff_plus)?.toFixed(1) ?? '-'}\nIn Zone: ${inZoneLabel(toNum(point.plate_side), toNum(point.plate_height))}`;
    const avgByType = Object.entries(
      points.reduce<Record<string, { n: number; hb: number; ivb: number; velo: number; stuff: number; stuffN: number }>>((acc, point) => {
        const pitchType = String(point.pitch_type || 'Undefined');
        const hb = toNum(point.hb);
        const ivb = toNum(point.ivb);
        if (hb === null || ivb === null) return acc;
        const velo = toNum(point.rel_speed) ?? toNum(point.velo);
        const stuffPlus = toNum(point.stuff_plus);
        if (!acc[pitchType]) acc[pitchType] = { n: 0, hb: 0, ivb: 0, velo: 0, stuff: 0, stuffN: 0 };
        acc[pitchType].n += 1;
        acc[pitchType].hb += hb;
        acc[pitchType].ivb += ivb;
        acc[pitchType].velo += velo ?? 0;
        if (stuffPlus !== null) {
          acc[pitchType].stuff += stuffPlus;
          acc[pitchType].stuffN += 1;
        }
        return acc;
      }, {})
    ).map(([pitchType, sums]) => ({
      pitch_type: pitchType,
      hb: sums.n ? sums.hb / sums.n : null,
      ivb: sums.n ? sums.ivb / sums.n : null,
      velo: sums.n ? sums.velo / sums.n : null,
      stuff_plus: sums.stuffN ? sums.stuff / sums.stuffN : null,
    }));
    return (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 360 }} onMouseLeave={() => setLocationHover(null)}>
        {ticks.map((tick) => (
          <line key={`cmp-m-x-grid-${tick}`} x1={px(tick)} y1={py(yMin)} x2={px(tick)} y2={py(yMax)} stroke="rgba(255,255,255,0.18)" />
        ))}
        {ticks.map((tick) => (
          <line key={`cmp-m-y-grid-${tick}`} x1={px(xMin)} y1={py(tick)} x2={px(xMax)} y2={py(tick)} stroke="rgba(255,255,255,0.18)" />
        ))}
        <line x1={px(xMin)} y1={py(0)} x2={px(xMax)} y2={py(0)} stroke="rgba(255,255,255,0.85)" />
        <line x1={px(0)} y1={py(yMin)} x2={px(0)} y2={py(yMax)} stroke="rgba(255,255,255,0.85)" />
        {ticks.map((tick) => (
          <text key={`cmp-m-x-label-${tick}`} x={px(tick)} y={py(yMin) + 20} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.9)">
            {tick}
          </text>
        ))}
        {ticks.map((tick) => (
          <text key={`cmp-m-y-label-${tick}`} x={px(xMin) - 8} y={py(tick) + 3.5} textAnchor="end" fontSize={10.5} fill="rgba(255,255,255,0.9)">
            {tick}
          </text>
        ))}
        {showPitches
          ? points
              .filter((point) => toNum(point.hb) !== null && toNum(point.ivb) !== null)
              .map((point, i) => {
                const pitchType = String(point.pitch_type || 'Undefined');
                const color = PITCH_COLORS[pitchType] ?? PITCH_COLORS.Undefined;
                return (
                  <circle
                    key={`cmp-m-p-${i}`}
                    cx={px(Number(toNum(point.hb)))}
                    cy={py(Number(toNum(point.ivb)))}
                    r={3.8}
                    fill={color}
                    stroke="rgba(0,0,0,0.52)"
                    strokeWidth={1.1}
                    opacity={0.42}
                    onMouseMove={(event) =>
                      setLocationHover({
                        x: event.clientX,
                        y: event.clientY,
                        text: movementTooltipHtml(point),
                        bg: color,
                      })
                    }
                    onMouseLeave={() => setLocationHover(null)}
                  />
                );
              })
          : null}
        {showAverages
          ? avgByType
              .filter((point) => point.hb !== null && point.ivb !== null)
              .map((point) => {
                const color = PITCH_COLORS[point.pitch_type] ?? PITCH_COLORS.Undefined;
                return (
                  <circle
                    key={`cmp-m-a-${point.pitch_type}`}
                    cx={px(Number(point.hb))}
                    cy={py(Number(point.ivb))}
                    r={8.6}
                    fill={color}
                    stroke="rgba(0,0,0,0.68)"
                    strokeWidth={2.2}
                    opacity={0.98}
                    onMouseMove={(event) =>
                      setLocationHover({
                        x: event.clientX,
                        y: event.clientY,
                        text: `${point.pitch_type}\nVelo: ${point.velo?.toFixed(1) ?? '-'} mph\nIVB: ${point.ivb?.toFixed(1) ?? '-'} in\nHB: ${point.hb?.toFixed(1) ?? '-'} in\nStuff+: ${point.stuff_plus?.toFixed(1) ?? '-'}`,
                        bg: color,
                      })
                    }
                    onMouseLeave={() => setLocationHover(null)}
                  />
                );
              })
          : null}
      </svg>
    );
  })() : (
    <svg viewBox="0 0 560 360" style={{ width: '100%', height: 360 }}>
      <rect x={0} y={0} width={560} height={360} fill="#0f172a" />
      {points.slice(0, 4000).map((point, idx) => {
        const x = toNum(point.plate_side) ?? toNum(point.hb) ?? toNum(point.release_side) ?? 0;
        const y = toNum(point.plate_height) ?? toNum(point.ivb) ?? toNum(point.release_height) ?? 0;
        const px = state.chartType === 'Pitch Chart'
          ? 40 + ((x + 2.5) / 5) * 480
          : state.chartType === 'Movement Plot'
            ? 40 + ((x + 25) / 50) * 480
            : state.chartType === 'Release Plot'
              ? 40 + ((x + 4) / 8) * 480
              : 40 + (idx / Math.max(1, points.length - 1)) * 480;
        const py = state.chartType === 'Pitch Chart'
          ? 20 + ((4.5 - y) / 4.5) * 320
          : state.chartType === 'Movement Plot'
            ? 20 + ((25 - y) / 50) * 320
            : state.chartType === 'Release Plot'
              ? 20 + ((6.5 - y) / 6.5) * 320
              : 320 - ((toNum(point.rel_speed) ?? toNum(point.velo) ?? 70) - 70) * 5;
        const pitchType = String(point.pitch_type || 'Undefined');
        const color = PITCH_COLORS[pitchType] ?? PITCH_COLORS.Undefined;
        return <circle key={idx} cx={px} cy={py} r={state.chartType === 'Velocity Chart' ? 3.8 : 3.8} fill={color} opacity={0.85} stroke="rgba(0,0,0,0.45)" strokeWidth={1} />;
      })}
    </svg>
  );

  return (
    <section style={{ minWidth: 0, display: 'grid', gap: 10 }}>
      <article className="portal-admin-card" style={{ padding: 12, display: 'grid', gap: 10 }}>
        <strong>{title}</strong>
        <div className="portal-form-grid" style={{ gridTemplateColumns: compact ? '1fr' : 'repeat(3, minmax(150px, 1fr))' }}>
          <ControlSelect
            label="Domain"
            value={state.domain}
            options={[{ value: 'Pitching', label: 'Pitching' }, { value: 'Hitting', label: 'Hitting' }, { value: 'Catching', label: 'Catching' }]}
            onChange={(next) =>
              setState((current) => ({
                ...current,
                domain: next as Domain,
                player: 'All',
                teamType: 'All',
                pitchType: 'All',
                pitchResult: 'All',
                countFilter: 'All',
                afterCountFilter: 'All',
                tableMode: defaultTableMode(next as Domain),
                splitBy: DOMAIN_SPLIT_BY[next as Domain][0],
              }))
            }
          />
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Start Date</span>
            <input type="date" value={state.startDate} onChange={(event) => setState((current) => ({ ...current, startDate: event.target.value }))} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>End Date</span>
            <input type="date" value={state.endDate} onChange={(event) => setState((current) => ({ ...current, endDate: event.target.value }))} />
          </label>
          <ControlSelect label="Chart" value={state.chartType} options={CHART_OPTIONS.map((value) => ({ value, label: value }))} onChange={(next) => setState((current) => ({ ...current, chartType: next as ChartType }))} />
          <ControlSelect label="Session Type" value={state.sessionType} options={sessionOptions} onChange={(next) => setState((current) => ({ ...current, sessionType: next }))} />
          <ControlSelect label={subjectLabel(state.domain)} value={state.player} options={playerOptions} onChange={(next) => setState((current) => ({ ...current, player: next }))} />
          {state.chartType === 'Heatmap' ? (
            <ControlSelect label="Heatmap Stat" value={state.heatMetric} options={HEAT_METRICS.map((value) => ({ value, label: value }))} onChange={(next) => setState((current) => ({ ...current, heatMetric: next as HeatMetric }))} />
          ) : state.chartType === 'Velocity Chart' ? (
            <ControlSelect label="Velocity View" value={state.velocityMode} options={VELOCITY_MODES.map((value) => ({ value, label: value }))} onChange={(next) => setState((current) => ({ ...current, velocityMode: next as VelocityMode }))} />
          ) : state.chartType === 'Release Plot' ? (
            <ControlSelect label="Release View" value={state.releaseView} options={RELEASE_VIEWS.map((value) => ({ value, label: value }))} onChange={(next) => setState((current) => ({ ...current, releaseView: next as ReleaseView }))} />
          ) : state.chartType === 'Movement Plot' ? (
            <ControlSelect label="Movement View" value={state.movementView} options={MOVEMENT_VIEWS.map((value) => ({ value, label: value }))} onChange={(next) => setState((current) => ({ ...current, movementView: next as MovementView }))} />
          ) : null}
          <ControlSelect label="Team" value={state.teamType} options={teamOptions} onChange={(next) => setState((current) => ({ ...current, teamType: next }))} />
          <ControlSelect label="Pitch Type" value={state.pitchType} options={pitchTypeOptions} onChange={(next) => setState((current) => ({ ...current, pitchType: next }))} />
          <ControlSelect label="Pitch Results" value={state.pitchResult} options={pitchResultOptions} onChange={(next) => setState((current) => ({ ...current, pitchResult: next }))} />
          <ControlSelect label="Count" value={state.countFilter} options={countOptions} onChange={(next) => setState((current) => ({ ...current, countFilter: next }))} />
          <ControlSelect label="After Count" value={state.afterCountFilter} options={afterCountOptions} onChange={(next) => setState((current) => ({ ...current, afterCountFilter: next }))} />
          <ControlSelect label="Pitcher Hand" value={state.pitcherHand} options={handOptions} onChange={(next) => setState((current) => ({ ...current, pitcherHand: next }))} />
          <ControlSelect label="Batter Hand" value={state.batterHand} options={batterOptions} onChange={(next) => setState((current) => ({ ...current, batterHand: next }))} />
        </div>
      </article>

      <article className="portal-admin-card dashboard-panel" style={{ padding: 12 }}>
        {loading ? <p>Loading chart...</p> : chart}
        {error ? <p style={{ color: '#ff8a8a' }}>{error}</p> : null}
        {locationHover ? (
          <div
            style={{
              position: 'fixed',
              left: locationHover.x + 12,
              top: locationHover.y + 12,
              pointerEvents: 'none',
              zIndex: 95,
              whiteSpace: 'pre-line',
              background: locationHover.bg ?? 'rgba(0,0,0,0.92)',
              color: pitchHoverTextColor(locationHover.bg),
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              lineHeight: 1.35,
              maxWidth: 280,
            }}
          >
            {locationHover.text}
          </div>
        ) : null}
      </article>

      <article className="portal-admin-card dashboard-panel" style={{ padding: 12, overflowX: 'auto' }}>
        <div className="portal-form-grid" style={{ marginBottom: 10, gridTemplateColumns: compact ? '1fr' : 'repeat(3, minmax(160px, 260px))' }}>
          <ControlSelect label="Table" value={state.tableMode} options={tableModeOptions} onChange={(next) => setState((current) => ({ ...current, tableMode: next }))} />
          <ControlSelect label="Split By" value={state.splitBy} options={splitByOptions} onChange={(next) => setState((current) => ({ ...current, splitBy: next }))} />
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Table Colors</span>
            <button type="button" className="btn btn-ghost" onClick={() => setEnableTableColors((current) => !current)}>
              {enableTableColors ? 'ON' : 'OFF'}
            </button>
          </label>
        </div>
        <table className="portal-table">
          <thead>
            <tr>
              {tableColumns.map((column) => {
                const activeSort = state.sortColumn === column;
                return (
                  <th key={column} style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      style={{ all: 'unset', cursor: 'pointer', color: 'inherit', display: 'inline-flex', justifyContent: 'center', width: '100%' }}
                      onClick={() => setState((current) => ({ ...current, sortColumn: column, sortDirection: current.sortColumn === column && current.sortDirection === 'desc' ? 'asc' : 'desc' }))}
                    >
                      {column}{activeSort ? ` ${state.sortDirection === 'asc' ? '↑' : '↓'}` : ''}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {tableColumns.map((column) => {
                  const raw = row[column];
                  const baseText = formatTableDisplayValue(column, raw);
                  const text = ['Pitcher', 'Batter', 'Catcher'].includes(column) ? formatNameFirstLast(baseText) : baseText;
                  const cellStyle = getTableCellStyle(row, column);
                  return (
                    <td key={`${rowIndex}-${column}`} style={cellStyle ? { ...cellStyle, fontWeight: 700, textAlign: 'center' } : { textAlign: 'center' }}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}

export default function ComparisonToolSuite() {
  const [isMobileView, setIsMobileView] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 900px)');
    const sync = () => setIsMobileView(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return (
    <section className="portal-comparison-suite" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <div
        className="portal-comparison-grid"
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: isMobileView ? '1fr' : 'repeat(auto-fit, minmax(660px, 1fr))',
          alignItems: 'start',
          minWidth: 0,
        }}
      >
        <ComparisonPane title="Left View" compact={isMobileView} />
        <ComparisonPane title="Right View" compact={isMobileView} />
      </div>
    </section>
  );
}

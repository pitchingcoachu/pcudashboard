'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { formatTableDisplayValue, parseSortableNumber, sortTableRows, type SortDirection } from '../../../lib/table-sort';
import { buildPinnedAllRow, pinKeyFromRow, sortRowsWithPins } from '../../../lib/leaderboard-pins';
import { downloadLeaderboardTablePdf } from '../../../lib/leaderboard-pdf-export';
import { getProTeamDisplayName, getProTeamLogoUrl, inferProTeamCode } from './pro-team-logos';
import { buildSharedXMetricHeatCells } from './shared-xmetrics-heatmap';
import { calcPitchValue } from './pitch-value';
import LeaderboardCorrelationModal from './leaderboard-correlation-modal';
import NativeDateInput from '../components/native-date-input';
import { isKnownSchoolBrand, resolveSchoolBrand } from '../../../lib/school-brand';
import { LEAGUE_TEAM_NAME_BY_CODE } from '../../../lib/league-team-name-map';
import { pitchLocationLabel as inZoneLabel } from '../../../lib/pitch-location';
import { dashboardActivityPath, dispatchPortalActivity } from './activity-events';
import { calculateExpectedMovement, magnusAngleDegrees, measuredTiltDegrees } from '../../../lib/expected-movement';

type FiltersPayload = {
  school_code: string;
  min_date: string | null;
  max_date: string | null;
  player_last_date?: string | null;
  pitchers: string[];
  team_types: string[];
  opp_hitters: string[];
  with_video_options: string[];
  break_lines_options: string[];
  stuff_level_options: string[];
  stuff_base_options: string[];
  hands: string[];
  batter_sides: string[];
  session_types: string[];
  pitch_types: string[];
  ball_types?: string[];
  zone_locations: string[];
  in_zone_options: string[];
  qp_location_options: string[];
  pitch_results: string[];
  count_options: string[];
  after_count_options: string[];
  level_options?: string[];
  pitchers_by_team_code?: Record<string, string[]>;
  opp_hitters_by_team_code?: Record<string, string[]>;
};

type OptionItem = { value: string; label: string; disabled?: boolean };

const PITCHING_FILTER_CLIENT_CACHE_VERSION = 'league-level-filtering-2026-08-03-v1';
const PRO_LEVEL_FILTER_OPTIONS = ['All', 'MLB', 'AAA'];
const NCAA_LEVEL_FILTER_OPTIONS = ['All', 'D1', 'D2', 'D3', 'NAIA', 'JUCO'];
// Break Lines reads from break_line_offsets_grid, which has real precomputed
// data for every level regardless of the current site -- unlike the page's
// main "Level" filter (site-scoped, see PRO_LEVEL_FILTER_OPTIONS /
// NCAA_LEVEL_FILTER_OPTIONS above), so its own picker always offers the
// full set.
const BREAK_LINES_LEVEL_OPTIONS = ['MLB', 'D1', 'D2', 'D3', 'JUCO', 'NAIA', 'ALL'];
const DEFAULT_COLLEGE_PERCENTILE_SCOPE = 'D1';

function dashboardPageSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

type PitchTypeRow = {
  pitch_type: string;
  pitches: number;
  usage_pct: number;
  avg_velo: number | null;
  max_velo: number | null;
  avg_spin: number | null;
  avg_ivb: number | null;
  avg_hb: number | null;
  avg_stuff: number | null;
};

type OverviewPayload = {
  school_code: string;
  pitcher: string | null;
  opp_hitter: string | null;
  break_lines: string | null;
  stuff_level: string | null;
  stuff_base: string | null;
  session_type: string | null;
  table_mode: string | null;
  split_by: string | null;
  total_pitches: number;
  avg_velo: number | null;
  max_velo: number | null;
  avg_spin: number | null;
  avg_ivb: number | null;
  avg_hb: number | null;
  avg_stuff: number | null;
  zone_pct: number | null;
  strike_pct: number | null;
  whiff_pct: number | null;
  table_columns: string[];
  available_table_columns: string[];
  table_rows: Record<string, string | number | null>[];
  row_pitches_by_key: Record<string, Array<{
    pitch_event_id: number | null;
    pitch_uid: string;
    play_id: string;
    game_id: string;
    game_uid: string;
    game_foreign_id: string;
    inning: string;
    pitch_no: number | null;
    pitch_number: number | null;
    session_date: string | null;
    pitcher: string;
    batter: string;
    catcher: string;
    pitcherthrows: string;
    batterside?: string;
    school_code?: string;
    pitcher_team_code: string;
    batter_team_code: string;
    pitcher_team_norm: string;
    batter_team_norm: string;
    pitch_type: string;
    session_type: string;
    pitch_call: string;
    play_result: string;
    korbb: string;
    tagged_hit_type: string;
    balls_num: number | null;
    strikes_num: number | null;
    outs_num: number | null;
    outs_on_play_num: number | null;
    run_value: number | null;
    pitch_value?: number | null;
    release_side: number | null;
    release_height: number | null;
    extension: number | null;
    hb: number | null;
    ivb: number | null;
    plate_side: number | null;
    plate_height: number | null;
    velo: number | null;
    spin: number | null;
    release_tilt: string;
    break_tilt: string;
    spin_eff: number | null;
    active_spin?: number | null;
    expected_hb?: number | null;
    expected_ivb?: number | null;
    expected_movement_model?: string | null;
    exit_speed: number | null;
    angle: number | null;
    vaa?: number | null;
    nvaa?: number | null;
    haa?: number | null;
    estimated_woba_using_speedangle?: number | null;
    estimated_ba_using_speedangle?: number | null;
    iso_value?: number | null;
    stuff_plus: number | null;
    qp_plus: number | null;
    video_clip_1: string;
    video_clip_2: string;
    video_clip_3: string;
  }>>;
  pitch_types: PitchTypeRow[];
  chart_points: {
    pitch_event_id: number | null;
    pitch_uid: string;
    play_id: string;
    game_id: string;
    game_uid: string;
    game_foreign_id: string;
    inning: string;
    pitch_no: number | null;
    pitch_number: number | null;
    session_date: string | null;
    pitcher: string;
    batter: string;
    catcher: string;
    pitcherthrows: string;
    batterside?: string;
    school_code?: string;
    pitcher_team_code: string;
    batter_team_code: string;
    pitcher_team_norm: string;
    batter_team_norm: string;
    pitch_type: string;
    session_type: string;
    pitch_call: string;
    play_result: string;
    korbb: string;
    tagged_hit_type: string;
    balls_num: number | null;
    strikes_num: number | null;
    outs_num: number | null;
    outs_on_play_num: number | null;
    run_value: number | null;
    pitch_value?: number | null;
    release_side: number | null;
    release_height: number | null;
    extension: number | null;
    hb: number | null;
    ivb: number | null;
    plate_side: number | null;
    plate_height: number | null;
    velo: number | null;
    spin: number | null;
    release_tilt: string;
    break_tilt: string;
    spin_eff: number | null;
    active_spin?: number | null;
    expected_hb?: number | null;
    expected_ivb?: number | null;
    expected_movement_model?: string | null;
    exit_speed: number | null;
    angle: number | null;
    vaa?: number | null;
    nvaa?: number | null;
    haa?: number | null;
    estimated_woba_using_speedangle?: number | null;
    estimated_ba_using_speedangle?: number | null;
    iso_value?: number | null;
    stuff_plus: number | null;
    qp_plus: number | null;
    video_clip_1: string;
    video_clip_2: string;
    video_clip_3: string;
  }[];
  heatmap_points?: Array<Record<string, unknown>>;
  trend_rows?: Array<{
    session_bucket: 'Bullpen' | 'Live BP' | 'Season';
    date: string;
    values: Record<string, number | null>;
  }>;
};

type AbReportPayload = {
  school_code: string;
  pitcher: string;
  selected_game_key: string | null;
  selected_game_date: string | null;
  available_games: Array<{
    game_key: string;
    date: string;
    label: string;
    opponent?: string;
  }>;
  pitch_type_legend: string[];
  pa_groups: Array<{
    batter: string;
    batter_side?: string;
    pas: Array<{
      pa_index: number;
      result_label: string;
      pitcher_label: string;
      pitches: PitchActionPoint[];
    }>;
  }>;
  total_pa: number;
};

type CustomTableConfig = {
  id: number;
  name: string;
  columns: string[];
  createdByEmail?: string | null;
  createdAt: string;
  updatedAt: string;
};

function customTableOptionLabel(item: CustomTableConfig): string {
  const name = String(item.name ?? '').trim();
  const creator = String(item.createdByEmail ?? '').trim();
  return creator ? `${name} (${creator})` : name;
}

function renderOptionLabel(label: string) {
  const match = String(label ?? '').match(/^(.*)\s+\(([^()\s@]+@[^()\s@]+)\)$/);
  if (!match) return label;
  return (
    <>
      {match[1]}
      <span className="portal-option-email"> ({match[2]})</span>
    </>
  );
}

type ManualVelocityEntry = {
  id: string;
  school_code: string;
  entry_date: string;
  pitcher: string;
  throw_type: string;
  plyo_drill: string;
  ball_weight_oz: number;
  velocity_mph: number;
  notes: string;
  created_at: string;
};

type TargetShape = { hb: number | null; ivb: number | null };
type HeatCell = { x: number; y: number; w: number; h: number; value: number; density: number };
type ChartHover = { x: number; y: number; text: string; bg?: string } | null;
type CellColors = { bg: string; text: string };
type PitchActionPoint = OverviewPayload['chart_points'][number];
type PitchEditSelectMode = 'single' | 'lasso';
type PlotLasso = { startX: number; startY: number; endX: number; endY: number; dragging: boolean } | null;
type BreakdownTool = 'line' | 'arrow' | 'circle' | 'pen' | 'text' | 'angle' | 'erase';
type ActionCompareLayout = 'side-by-side' | 'stacked' | 'overlay';
type BreakdownAnnotation = {
  id: string;
  tool: Exclude<BreakdownTool, 'erase'>;
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
  text?: string;
  fontSize?: number;
  angleMode?: 'acute' | 'obtuse';
};
type BreakdownAnnotationDragState = {
  id: string;
  anchor: { x: number; y: number };
  points: Array<{ x: number; y: number }>;
};
const BREAKDOWN_TOOL_LABELS: Record<BreakdownTool, string> = {
  line: 'Line',
  arrow: 'Arrow',
  circle: 'Circle',
  pen: 'Freehand',
  text: 'Text',
  angle: 'Angle',
  erase: 'Erase',
};
const BREAKDOWN_TOOL_ICONS: Record<BreakdownTool | 'view', string> = {
  view: '✥',
  line: '╱',
  arrow: '↗',
  circle: '○',
  pen: '~',
  text: 'T',
  angle: '∠',
  erase: '⌫',
};
const BREAKDOWN_TOOL_ORDER: BreakdownTool[] = ['line', 'arrow', 'circle', 'pen', 'angle', 'text', 'erase'];
const BREAKDOWN_COLOR_SWATCHES = ['#23f3f6', '#ffff00', '#f97316', '#ef4444', '#22c55e', '#ffffff'];
const BREAKDOWN_WIDTH_STEPS = [2, 4, 6, 8, 10];
const BREAKDOWN_TEXT_SIZE_STEPS = [24, 36, 48, 64, 80, 96];
const BREAKDOWN_RECORDING_MIME_OPTIONS = [
  { mimeType: 'video/mp4;codecs=h264,aac', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
];
const PITCH_TYPE_DISPLAY_ORDER = [
  'Fastball',
  'Sinker',
  'Cutter',
  'Slider',
  'Sweeper',
  'Curveball',
  'ChangeUp',
  'Splitter',
  'Knuckleball',
  'Undefined',
] as const;
const LEAGUE_SEASON_START = '2026-02-13';
const LEAGUE_D1_SEASON_END = '2026-06-22';
const PRO_SEASON_START = '2026-03-25';
const HANDED_MOVEMENT_PERCENTILE_COLUMNS = new Set(
  ['IVB', 'HB', 'Side', 'rTilt', 'bTilt'].map((column) => normalizePercentileColumnToken(column))
);
const SUMMARY_HANDED_COMPARISON_COLUMNS = new Set(
  ['IVB', 'HB'].map((column) => normalizePercentileColumnToken(column))
);
const SUMMARY_STRICT_ROW_DISTRIBUTION_COLUMNS = new Set(
  [
    'Velo',
    'Max',
    'IVB',
    'HB',
    'Height',
    'Side',
    'Ext',
    'Spin',
    'CSW%',
    'RV/100',
    'PV/100',
    'FIP',
    'xFIP',
    'ERA',
    'xWOBA',
    'xISO',
    'FPS(FB)%',
    'FPS(OS)%',
    'Whiff%',
    'SwStrk%',
    'Chase%',
  ].map((column) => normalizePercentileColumnToken(column))
);
const LOW_IVB_BETTER_PITCH_TYPES = new Set(
  ['Curveball', 'Sinker', 'ChangeUp', 'Splitter', 'Forkball', 'Forkballs', 'Screwball', 'Screwballs'].map((value) => normalizeNameToken(value))
);
const RIGHTY_LOW_HB_BETTER_PITCH_TYPES = new Set(
  ['Cutter', 'Slider', 'Sweeper', 'Curveball'].map((value) => normalizeNameToken(value))
);
const LEFTY_LOW_HB_BETTER_PITCH_TYPES = new Set(
  ['Fastball', 'Sinker', 'ChangeUp', 'Splitter', 'Forkball', 'Forkballs', 'Screwball', 'Screwballs'].map((value) => normalizeNameToken(value))
);
const LOWER_IS_BETTER_PERCENTILE_COLUMNS = new Set(
  ['BB%', 'HR%', 'Barrel%', 'EV', 'RV/100', 'PV/100', 'ERA', 'FIP', 'xFIP', 'SIERA'].map((column) => normalizePercentileColumnToken(column))
);
const PITCH_LOG_PERCENT_TOKENS = new Set([
  'usage',
  'inzonepct',
  'comppct',
  'strikepct',
  'swingpct',
  'fpspct',
  'whiffpct',
  'swstrkpct',
  'cswpct',
  'kpct',
  'bbpct',
  'hrpct',
  'gbpct',
  'barrelpct',
]);
const PITCH_LOG_ZERO_DECIMAL_TOKENS = new Set(['p', 'number', 'bf', 'spin']);
const PITCH_LOG_ONE_DECIMAL_TOKENS = new Set([
  'velo',
  'max',
  'ivb',
  'hb',
  'height',
  'side',
  'ext',
  'spineff',
  'stuffplus',
  'qpplus',
  'ev',
  'la',
  'vaa',
  'haa',
]);
const PITCH_LOG_TWO_DECIMAL_TOKENS = new Set(['rv100', 'pv100', 'era', 'fip', 'xfip', 'siera']);
const TEAM_CODE_PREFIX_LABELS: Record<string, string> = {
  HAR: 'Harvard University',
  PEN: 'University of Pennsylvania',
  OSU: 'Oklahoma State',
  LSU: 'LSU',
  GCU: 'Grand Canyon',
  CNU: 'CNU',
  CBU: 'CBU',
  GMU: 'GMU',
  UNM: 'UNM',
  UNOH: 'University of Northwestern Ohio',
  LEC: 'Lake Erie College',
  SEMO: 'SEMO',
  CRE: 'Creighton',
  PCU: 'Pitching Coach U',
};
const TREND_SCHOOL_TEAM_CODE_ALIASES: Record<string, string[]> = {
  OSU: ['OKLCOW', 'OKLCPR'],
  UNM: ['MEX_LOB'],
};
const LEAGUE_TEAM_CODE_BY_LABEL_TOKEN: Record<string, string> = Object.fromEntries(
  Object.entries(LEAGUE_TEAM_NAME_BY_CODE).map(([code, label]) => [normalizeLeagueTeamToken(label), code])
);


function fmtNum(value: unknown, digits = 1): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(digits);
}

function formatNameFirstLast(name: string): string {
  const normalized = (name || '').trim();
  if (!normalized) return '';
  const parts = normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts.slice(1).join(' ')} ${parts[0]}`.replace(/\s+/g, ' ').trim();
  return normalized;
}

function normalizePersonName(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const firstLast = formatNameFirstLast(raw);
  return firstLast
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pitchIdentityKey(pitch: PitchActionPoint): string {
  if (pitch.pitch_event_id) return `id:${pitch.pitch_event_id}`;
  return `k:${pitch.play_id}|${pitch.pitch_no ?? ''}|${pitch.pitch_number ?? ''}|${pitch.session_date ?? ''}|${pitch.pitcher ?? ''}`;
}

function formatShortDate(value: string): string {
  const trimmed = value.trim();
  const parts = trimmed.split('-');
  if (parts.length !== 3) return trimmed;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return trimmed;
  return `${month}/${day}/${String(year).slice(-2)}`;
}

function toYmdNow(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadTextFile(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function clampYmdToToday(value: string): string {
  const v = (value || '').trim();
  if (!v) return v;
  const today = toYmdNow();
  return v > today ? today : v;
}

function isFullMonthRange(startDate: string, endDate: string): boolean {
  if (!startDate || !endDate) return false;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  if (start.getFullYear() !== end.getFullYear() || start.getMonth() !== end.getMonth()) return false;
  if (start.getDate() !== 1) return false;
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  return end.getDate() === lastDay;
}

function formatDashboardDateLabel(
  startDate: string,
  endDate: string,
  isProSchool: boolean,
  schoolCodeRaw?: string,
  playerLastGameDateRaw?: string
): string {
  if (!startDate || !endDate) return '-';
  const today = toYmdNow();
  if (isProSchool && startDate === PRO_SEASON_START && endDate === today) return '2026 Season';
  const schoolCode = String(schoolCodeRaw ?? '').trim().toUpperCase();
  const isCollegeSchool = !!schoolCode && schoolCode !== 'PRO' && schoolCode !== 'LEAGUE' && schoolCode !== 'PCU';
  const collegeSeasonStart = schoolCode === 'CNU' ? '2026-01-30' : '2026-02-13';
  const playerLastGameDate = String(playerLastGameDateRaw ?? '').trim();
  if (isCollegeSchool && startDate === collegeSeasonStart && !!playerLastGameDate && endDate >= playerLastGameDate) {
    return '2026 Season';
  }
  if (isFullMonthRange(startDate, endDate)) {
    const dt = new Date(`${startDate}T00:00:00`);
    return dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  return startDate === endDate ? formatShortDate(startDate) : `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`;
}

function parseVelocityBatch(value: string): number[] {
  if (!value.trim()) return [];
  return value
    .split(/[,;\s|]+/)
    .map((token) => Number(token.trim()))
    .filter((num) => Number.isFinite(num) && num > 0);
}

function manualVeloHoverText(entry: ManualVelocityEntry): string {
  const lines = [
    `Date: ${formatShortDate(entry.entry_date)}`,
    `Throw Type: ${entry.throw_type}`,
  ];
  if (entry.throw_type === 'Plyo Velo' && entry.plyo_drill.trim()) lines.push(`Drill: ${entry.plyo_drill.trim()}`);
  lines.push(`Velo: ${fmtNum(entry.velocity_mph, 1)} mph`);
  lines.push(`Weight: ${fmtNum(entry.ball_weight_oz, 2)} oz`);
  return lines.join('\n');
}

function manualVelocitySeriesKey(entry: ManualVelocityEntry): string {
  return entry.throw_type === 'Plyo Velo'
    ? `Plyo: ${entry.plyo_drill?.trim() ? entry.plyo_drill.trim() : 'Unspecified'}`
    : entry.throw_type;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseInningNumber(value: string | null | undefined): number | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const direct = Number(raw);
  if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
  const match = raw.match(/(\d+)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function parseInningsToDecimal(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length > 2) return null;
  const whole = Number(parts[0] || '0');
  if (!Number.isFinite(whole)) return null;
  if (parts.length === 1) return whole;
  const outs = Number(parts[1] || '0');
  if (!Number.isFinite(outs)) return null;
  return whole + outs / 3;
}

function deriveFallbackEra(row: Record<string, string | number | null>): number | null {
  const ip = parseInningsToDecimal(row.IP);
  if (!ip || ip <= 0) return null;
  const hr = parseSortableNumber(row.HR) ?? 0;
  const bb = parseSortableNumber(row.BB) ?? 0;
  const hbp = parseSortableNumber(row.HBP) ?? 0;
  const k = parseSortableNumber(row.K) ?? 0;
  const h2 = parseSortableNumber(row['2B']) ?? 0;
  const h3 = parseSortableNumber(row['3B']) ?? 0;
  const h = parseSortableNumber(row.H) ?? 0;
  const h1Raw = parseSortableNumber(row['1B']);
  const h1 = h1Raw ?? Math.max(0, h - h2 - h3 - hr);
  const erEstimate =
    (0.47 * h1) +
    (0.78 * h2) +
    (1.09 * h3) +
    (1.4 * hr) +
    (0.33 * (bb + hbp)) -
    (0.1 * k);
  if (!Number.isFinite(erEstimate)) return null;
  return Math.max(0, (9 * erEstimate) / ip);
}

function deriveFallbackFip(row: Record<string, string | number | null>): number | null {
  const ip = parseInningsToDecimal(row.IP);
  if (!ip || ip <= 0) return null;
  const hr = parseSortableNumber(row.HR) ?? 0;
  const bb = parseSortableNumber(row.BB) ?? 0;
  const hbp = parseSortableNumber(row.HBP) ?? 0;
  const k = parseSortableNumber(row.K) ?? 0;
  const fip = ((13 * hr) + (3 * (bb + hbp)) - (2 * k)) / ip + 3.2;
  return Number.isFinite(fip) ? fip : null;
}

function deriveFallbackXFip(row: Record<string, string | number | null>): number | null {
  const ip = parseInningsToDecimal(row.IP);
  if (!ip || ip <= 0) return null;
  const bb = parseSortableNumber(row.BB) ?? 0;
  const hbp = parseSortableNumber(row.HBP) ?? 0;
  const k = parseSortableNumber(row.K) ?? 0;
  const hits = parseSortableNumber(row.H) ?? 0;
  const babip = parseSortableNumber(row.BABIP);
  const gbPctRaw = parseSortableNumber(row['GB%']);
  if (babip === null || babip <= 0 || gbPctRaw === null) return null;
  const inPlay = hits / babip;
  if (!Number.isFinite(inPlay) || inPlay <= 0) return null;
  const gbRate = Math.max(0, Math.min(1, gbPctRaw / 100));
  const fb = Math.max(0, inPlay * (1 - gbRate));
  const xHr = fb * 0.12;
  const xfip = ((13 * xHr) + (3 * (bb + hbp)) - (2 * k)) / ip + 3.2;
  return Number.isFinite(xfip) ? xfip : null;
}

function formatTiltClock(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '—';
  const colon = raw.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (colon) {
    const h = ((Number(colon[1]) - 1 + 12) % 12) + 1;
    const m = Math.max(0, Math.min(59, Number(colon[2])));
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  const dotClock = raw.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (dotClock) {
    const h = ((Number(dotClock[1]) - 1 + 12) % 12) + 1;
    const m = Math.max(0, Math.min(59, Number(dotClock[2])));
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const deg = ((n % 360) + 360) % 360;
  // Match Shiny deg_to_clock mapping:
  // 180° -> 12:00, 270° -> 3:00, 0° -> 6:00, 90° -> 9:00
  const shifted = (deg + 180) % 360;
  const totalMinutes = Math.round((shifted / 360) * 720) % 720;
  const h = Math.floor(totalMinutes / 60) || 12;
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function resolveAbPitchResult(pitch: PitchActionPoint): string {
  const pitchCall = (pitch.pitch_call ?? '').trim();
  const playResult = (pitch.play_result ?? '').trim();
  const valid = (value: string) => value.length > 0 && value !== 'Undefined';
  if (valid(pitchCall) && /foul/i.test(pitchCall)) return 'Foul';
  if (pitchCall === 'InPlay') {
    if (valid(playResult)) return playResult;
    return 'InPlay';
  }
  if (valid(pitchCall)) return pitchCall;
  if (valid(playResult)) return playResult;
  return '-';
}

function resolvePitchResultLabel(
  pitchCallRaw: string | null | undefined,
  playResultRaw: string | null | undefined
): string {
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

function resolvePitcherName(
  pitch: PitchActionPoint,
  selectedPitchers: string[] = []
): string {
  const raw = [
    pitch.pitcher,
    (pitch as unknown as Record<string, unknown>).Pitcher as string | undefined,
    (pitch as unknown as Record<string, unknown>).pitcher_name as string | undefined,
    (pitch as unknown as Record<string, unknown>).PitcherName as string | undefined,
    (pitch as unknown as Record<string, unknown>).athlete_name as string | undefined,
    (pitch as unknown as Record<string, unknown>).AthleteName as string | undefined,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => value.length > 0 && value.toLowerCase() !== 'unknown pitcher');

  if (raw) return raw;
  if (selectedPitchers.length === 1 && selectedPitchers[0] !== 'All') return selectedPitchers[0];
  return 'Unknown Pitcher';
}

function toOptions(values: string[], formatNames = false): OptionItem[] {
  return values.map((value) => ({
    value,
    label: formatNames ? formatNameFirstLast(value) : (value === 'Inning' ? 'Inning of Appearance' : value),
  }));
}

function pickDefaultTeamType(teamTypes: string[], schoolCode: string): string {
  if (!Array.isArray(teamTypes) || teamTypes.length === 0) return 'All';
  const cleaned = teamTypes.map((value) => String(value ?? '').trim()).filter(Boolean);
  if (cleaned.length === 0) return 'All';
  const school = String(schoolCode ?? '').trim();
  if (school.toUpperCase() === 'LEAGUE' || school.toUpperCase() === 'PRO') return 'All';
  const schoolNorm = school.toUpperCase();
  const exactSchool = cleaned.find((value) => value === school);
  if (exactSchool) return exactSchool;
  const normSchool = cleaned.find((value) => value.toUpperCase() === schoolNorm);
  if (normSchool) return normSchool;
  const teamOption = cleaned.find((value) => value.toLowerCase() === 'team');
  if (teamOption) return teamOption;
  const firstNonAll = cleaned.find((value) => value.toLowerCase() !== 'all');
  return firstNonAll ?? 'All';
}

function normalizeMulti(values: string[]): string[] {
  const unique = Array.from(new Set(values.filter((value) => value.trim().length > 0)));
  if (unique.length === 0) return ['All'];
  if (unique.includes('All')) return ['All'];
  return unique;
}

function normalizeColumnToken(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9%+]/g, '');
}

function normalizeTableRowsForColumns(
  columns: string[],
  rows: Array<Record<string, string | number | null>>
): Array<Record<string, string | number | null>> {
  if (!Array.isArray(columns) || !columns.length || !Array.isArray(rows) || !rows.length) return rows;
  return rows.map((row) => {
    const out = { ...row };
    const keyByToken = new Map<string, string>();
    for (const key of Object.keys(row)) {
      const token = normalizeColumnToken(key);
      if (!token || keyByToken.has(token)) continue;
      keyByToken.set(token, key);
    }
    for (const column of columns) {
      if (Object.prototype.hasOwnProperty.call(out, column)) continue;
      const matchKey = keyByToken.get(normalizeColumnToken(column));
      if (!matchKey) continue;
      out[column] = row[matchKey];
    }
    return out;
  });
}

function isAllLikeRowValue(value: unknown): boolean {
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'all' || text === 'all (pinned)';
}

function percentileForValue(value: number, distribution: number[]): number | null {
  if (!Number.isFinite(value) || !distribution.length) return null;
  if (distribution.length === 1) return null;
  const min = distribution[0];
  const max = distribution[distribution.length - 1];
  // When the pool has no variance, percentile is not meaningful.
  if (Math.abs(max - min) < 1e-9) return null;
  const rankValue = value < min ? min : (value > max ? max : value);
  let lessCount = 0;
  let equal = 0;
  for (const point of distribution) {
    if (point < rankValue) lessCount += 1;
    else if (point === rankValue) equal += 1;
  }
  // Endpoint-inclusive mid-rank percentile:
  // min/max map to 0/100 while ties remain centered.
  const rank = ((lessCount + (0.5 * equal) - 0.5) / (distribution.length - 1)) * 100;
  return Math.max(0, Math.min(100, rank));
}

function percentileRowKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function canonicalizeHandLabel(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === 'all') return String(value ?? '').trim();
  const compact = raw.replace(/[^a-z]/g, '');
  if (compact.startsWith('l')) return 'Left';
  if (compact.startsWith('r')) return 'Right';
  if (compact.startsWith('u')) return 'Unknown';
  return String(value ?? '').trim();
}

function percentileSplitRowKey(splitColumn: string, value: unknown): string {
  const splitToken = normalizePercentileColumnToken(splitColumn);
  if (
    splitToken === normalizePercentileColumnToken('Pitcher Hand') ||
    splitToken === normalizePercentileColumnToken('Batter Hand')
  ) {
    return percentileRowKey(canonicalizeHandLabel(value));
  }
  return percentileRowKey(value);
}

function normalizePercentileColumnToken(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/%/g, 'pct')
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]/g, '');
}

function adjustPercentileDirection(column: string, percentile: number): number {
  const token = normalizePercentileColumnToken(column);
  if (!LOWER_IS_BETTER_PERCENTILE_COLUMNS.has(token)) return percentile;
  return Math.max(0, Math.min(100, 100 - percentile));
}

function normalizeHandednessCode(value: unknown): 'R' | 'L' | '' {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('r')) return 'R';
  if (raw.startsWith('l')) return 'L';
  return '';
}

function normalizeBatterSideCode(value: unknown): 'R' | 'L' | 'S' | '' {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('s')) return 'S';
  if (raw.startsWith('l')) return 'L';
  if (raw.startsWith('r')) return 'R';
  return '';
}

function resolveAbBatterSide(group: AbReportPayload['pa_groups'][number]): 'R' | 'L' | 'S' | '' {
  const sides = new Set<'R' | 'L'>();
  const addSide = (value: unknown): boolean => {
    const side = normalizeBatterSideCode(value);
    if (side === 'S') return true;
    if (side) sides.add(side);
    return false;
  };
  if (addSide(group.batter_side)) return 'S';
  for (const pa of group.pas) {
    for (const pitch of pa.pitches) {
      if (addSide(pitch.batterside)) return 'S';
    }
  }
  if (sides.size > 1) return 'S';
  return sides.values().next().value ?? '';
}

function normalizePitchCallToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isPitchInZone(plateSide: unknown, plateHeight: unknown): boolean {
  const side = parseSortableNumber(plateSide);
  const height = parseSortableNumber(plateHeight);
  if (side === null || height === null) return false;
  return side >= -0.85 && side <= 0.85 && height >= 1.5 && height <= 3.5;
}

function isPitchStrike(pitchCall: string, isPro: boolean): boolean {
  if (!isPro) {
    return (
      pitchCall === 'StrikeCalled' ||
      pitchCall === 'StrikeSwinging' ||
      pitchCall === 'FoulBall' ||
      pitchCall === 'FoulBallFieldable' ||
      pitchCall === 'FoulBallNotFieldable' ||
      pitchCall === 'InPlay'
    );
  }
  const token = normalizePitchCallToken(pitchCall);
  return (
    token === 'called_strike' ||
    token === 'strikecalled' ||
    token === 'swinging_strike' ||
    token === 'swinging_strike_blocked' ||
    token === 'swinging_strike_pitchout' ||
    token === 'strikeswinging' ||
    token === 'foul' ||
    token === 'foul_tip' ||
    token === 'foul_bunt' ||
    token === 'foul_pitchout' ||
    token === 'missed_bunt' ||
    token.startsWith('foul') ||
    token.startsWith('in_play') ||
    token.startsWith('hit_into_play') ||
    token === 'inplay'
  );
}

function isPitchSwing(pitchCall: string, isPro: boolean): boolean {
  if (!isPro) {
    return (
      pitchCall === 'StrikeSwinging' ||
      pitchCall === 'FoulBall' ||
      pitchCall === 'FoulBallFieldable' ||
      pitchCall === 'FoulBallNotFieldable' ||
      pitchCall === 'InPlay'
    );
  }
  const token = normalizePitchCallToken(pitchCall);
  return (
    token === 'swinging_strike' ||
    token === 'swinging_strike_blocked' ||
    token === 'swinging_strike_pitchout' ||
    token === 'strikeswinging' ||
    token === 'foul' ||
    token === 'foul_tip' ||
    token === 'foul_bunt' ||
    token === 'foul_pitchout' ||
    token === 'missed_bunt' ||
    token.startsWith('foul') ||
    token.startsWith('in_play') ||
    token.startsWith('hit_into_play') ||
    token === 'inplay'
  );
}

function isPitchWhiff(pitchCall: string, isPro: boolean): boolean {
  if (!isPro) return pitchCall === 'StrikeSwinging';
  const token = normalizePitchCallToken(pitchCall);
  return (
    token === 'swinging_strike' ||
    token === 'swinging_strike_blocked' ||
    token === 'strikeswinging' ||
    token === 'foul_tip' ||
    token === 'foultip' ||
    token === 'bunt_foul_tip' ||
    token === 'buntfoultip'
  );
}

function pitchLogMetricValue(
  column: string,
  pitch: OverviewPayload['chart_points'][number],
  isPro: boolean
): string | number | null {
  const token = normalizePercentileColumnToken(column);
  const playResultToken = normalizePitchCallToken(pitch.play_result ?? '');
  const taggedHitType = normalizePitchCallToken(pitch.tagged_hit_type ?? '');
  const strike = isPitchStrike(String(pitch.pitch_call ?? ''), isPro);
  const swing = isPitchSwing(String(pitch.pitch_call ?? ''), isPro);
  const whiff = isPitchWhiff(String(pitch.pitch_call ?? ''), isPro);
  const inZone = isPitchInZone(pitch.plate_side, pitch.plate_height);
  const firstPitch = Number(pitch.balls_num ?? -1) === 0 && Number(pitch.strikes_num ?? -1) === 0;

  if (token === 'pitch') return pitch.pitch_type || '-';
  if (token === 'p' || token === 'number') return 1;
  if (token === 'usage') return null;
  if (token === 'bf') return firstPitch ? 1 : 0;
  if (token === 'velo' || token === 'max') return pitch.velo ?? null;
  if (token === 'ivb') return pitch.ivb ?? null;
  if (token === 'hb') return pitch.hb ?? null;
  if (token === 'xivb' || token === 'xhb' || token === 'divb' || token === 'dhb') {
    const pitchRow = pitch as unknown as Record<string, unknown>;
    const expected = calculateExpectedMovement({
      velocityMph: pitch.velo,
      spinRateRpm: pitch.spin,
      measuredTilt: pitch.release_tilt,
      extensionFeet: pitch.extension,
      spinEfficiency: pitch.spin_eff,
      activeSpinRpm: pitchRow.active_spin ?? pitchRow.activeSpin,
    });
    if (!expected || pitch.ivb === null || pitch.hb === null) return null;
    if (token === 'xivb') return expected.expectedIvb;
    if (token === 'xhb') return expected.expectedHb;
    if (token === 'divb') return Number(pitch.ivb) - expected.expectedIvb;
    return Number(pitch.hb) - expected.expectedHb;
  }
  if (token === 'spin') return pitch.spin ?? null;
  if (token === 'height') return pitch.release_height ?? null;
  if (token === 'side') return pitch.release_side ?? null;
  if (token === 'ext') return pitch.extension ?? null;
  if (token === 'rtilt' || token === 'releasetilt') return pitch.release_tilt || null;
  if (token === 'btilt' || token === 'breaktilt') return pitch.break_tilt || null;
  if (token === 'tiltdev') {
    const releaseDegrees = measuredTiltDegrees(pitch.release_tilt);
    let breakDegrees = measuredTiltDegrees(pitch.break_tilt);
    if (
      breakDegrees === null &&
      typeof pitch.ivb === 'number' &&
      typeof pitch.hb === 'number' &&
      (Math.abs(pitch.ivb) > 1e-9 || Math.abs(pitch.hb) > 1e-9)
    ) {
      breakDegrees = ((Math.atan2(pitch.hb, pitch.ivb) * 180) / Math.PI + 180 + 360) % 360;
    }
    if (releaseDegrees === null || breakDegrees === null) return null;
    return ((((breakDegrees - releaseDegrees + 180) % 360) + 360) % 360 - 180) * 2;
  }
  if (token === 'spineff') {
    const value = parseSortableNumber(pitch.spin_eff);
    if (value === null) return null;
    return Math.abs(value) <= 1 ? value * 100 : value;
  }
  if (token === 'stuffplus') return pitch.stuff_plus ?? null;
  if (token === 'qpplus') return pitch.qp_plus ?? null;
  if (token === 'ev') return pitch.exit_speed ?? null;
  if (token === 'la') return pitch.angle ?? null;
  if (token === 'vaa') {
    const pitchRow = pitch as unknown as Record<string, unknown>;
    return parseSortableNumber(pitchRow.vaa ?? pitchRow.VAA ?? pitchRow.vertapprangle ?? pitchRow.vert_appr_angle);
  }
  if (token === 'nvaa') {
    const pitchRow = pitch as unknown as Record<string, unknown>;
    return parseSortableNumber(pitchRow.nvaa ?? pitchRow.nVAA);
  }
  if (token === 'haa') {
    const pitchRow = pitch as unknown as Record<string, unknown>;
    return parseSortableNumber(pitchRow.haa ?? pitchRow.HAA ?? pitchRow.horzapprangle ?? pitchRow.horz_appr_angle);
  }
  if (token === 'rv100') return typeof pitch.run_value === 'number' ? pitch.run_value * 100 : null;
  if (token === 'pv100') return typeof pitch.pitch_value === 'number' ? pitch.pitch_value * 100 : null;
  if (token === 'inzonepct') return inZone ? 100 : 0;
  if (token === 'comppct') return inZone ? 100 : 0;
  if (token === 'strikepct') return strike ? 100 : 0;
  if (token === 'swingpct') return swing ? 100 : 0;
  if (token === 'fpspct') return firstPitch ? (strike ? 100 : 0) : null;
  if (token === 'whiffpct' || token === 'swstrkpct') return whiff ? 100 : 0;
  if (token === 'cswpct') return strike ? 100 : 0;
  if (token === 'kpct') return String(pitch.korbb ?? '').toLowerCase() === 'strikeout' || playResultToken === 'strikeout' ? 100 : 0;
  if (token === 'bbpct') return String(pitch.korbb ?? '').toLowerCase() === 'walk' || playResultToken === 'walk' ? 100 : 0;
  if (token === 'hrpct') return playResultToken === 'homerun' ? 100 : 0;
  if (token === 'gbpct') return taggedHitType.includes('ground') ? 100 : 0;
  if (token === 'barrelpct') return taggedHitType.includes('barrel') ? 100 : 0;
  return null;
}

function parseGameSplitToken(raw: unknown): { date: string; team: string; opponent: string; gameKey: string; pitcherMarker: string } {
  const token = String(raw ?? '').trim();
  const parts = token.split('||');
  if (parts.length >= 4) {
    return {
      date: String(parts[0] ?? '').trim(),
      team: String(parts[1] ?? '').trim() || '-',
      opponent: String(parts[2] ?? '').trim() || '-',
      gameKey: String(parts[3] ?? '').trim() || token,
      pitcherMarker: String(parts[4] ?? '').trim(),
    };
  }
  const dateMatch = token.match(/\d{4}-\d{2}-\d{2}/);
  return {
    date: dateMatch ? dateMatch[0] : '',
    team: '-',
    opponent: '-',
    gameKey: token || `${Date.now()}`,
    pitcherMarker: '',
  };
}

function getMetricValueFromRowByColumnToken(row: Record<string, unknown>, column: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, column)) return row[column];
  const target = normalizePercentileColumnToken(column);
  for (const [key, value] of Object.entries(row)) {
    if (normalizePercentileColumnToken(key) === target) return value;
  }
  return null;
}

function percentileTextColor(value: number): string {
  return value <= 30 || value >= 70 ? '#f8fafc' : '#0b1220';
}

function normalizeLeagueTeamToken(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isLikelyLeagueTeamCode(value: string): boolean {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  const upper = raw.toUpperCase();
  if (/^[A-Z0-9]{2,}(?:_[A-Z0-9]+)+$/.test(upper)) return true;
  // College codes are often plain uppercase tokens (e.g., GCU, PCU, LSU).
  return raw === upper && /^[A-Z0-9]{2,6}$/.test(raw);
}

function isMlbLeagueAggregateTeamLabel(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'AL' || normalized === 'NL' || normalized === 'AMERICAN LEAGUE' || normalized === 'NATIONAL LEAGUE';
}

function resolveLeagueTeamTypeForApi(
  teamTypeValue: string,
  byTeamMaps: Array<Record<string, string[]> | undefined>
): string {
  const raw = String(teamTypeValue ?? '').trim();
  if (!raw || raw.toLowerCase() === 'all') return raw;
  if (isLikelyLeagueTeamCode(raw)) return raw.toUpperCase();

  const merged = new Map<string, string[]>();
  for (const source of byTeamMaps) {
    if (!source) continue;
    for (const [key, names] of Object.entries(source)) {
      if (!Array.isArray(names)) continue;
      merged.set(String(key ?? '').trim(), names.map((entry) => String(entry ?? '').trim()).filter(Boolean));
    }
  }

  const lookupKey = normalizeLeagueTeamToken(raw);
  const findEntry = (): { key: string; names: string[] } | null => {
    for (const [key, names] of merged.entries()) {
      if (normalizeLeagueTeamToken(key) === lookupKey) return { key, names };
    }
    return null;
  };

  const matched = findEntry();
  if (!matched) return raw;
  if (isLikelyLeagueTeamCode(matched.key)) return matched.key.toUpperCase();

  const signature = matched.names
    .map(normalizeLeagueTeamToken)
    .filter(Boolean)
    .sort()
    .join('|');
  if (!signature) return raw;

  for (const [key, names] of merged.entries()) {
    if (!isLikelyLeagueTeamCode(key)) continue;
    const keySignature = names
      .map(normalizeLeagueTeamToken)
      .filter(Boolean)
      .sort()
      .join('|');
    if (keySignature && keySignature === signature) return key.toUpperCase();
  }
  return raw;
}

function buildLeagueTeamLabelByCode(
  byTeamMaps: Array<Record<string, string[]> | undefined>
): Record<string, string> {
  const entries: Array<{ key: string; names: string[] }> = [];
  for (const source of byTeamMaps) {
    if (!source) continue;
    for (const [keyRaw, namesRaw] of Object.entries(source)) {
      const key = String(keyRaw ?? '').trim();
      if (!key || !Array.isArray(namesRaw)) continue;
      const names = namesRaw.map((entry) => String(entry ?? '').trim()).filter(Boolean);
      entries.push({ key, names });
    }
  }

  const signatureFor = (names: string[]): string =>
    names
      .map(normalizeLeagueTeamToken)
      .filter(Boolean)
      .sort()
      .join('|');

  const labelBySignature = new Map<string, string>();
  for (const entry of entries) {
    if (isLikelyLeagueTeamCode(entry.key)) continue;
    const signature = signatureFor(entry.names);
    if (!signature || labelBySignature.has(signature)) continue;
    labelBySignature.set(signature, entry.key);
  }

  const out: Record<string, string> = {};
  for (const entry of entries) {
    if (!isLikelyLeagueTeamCode(entry.key)) continue;
    const signature = signatureFor(entry.names);
    if (!signature) continue;
    const label = labelBySignature.get(signature);
    if (label) out[entry.key.toUpperCase()] = label;
  }
  return out;
}

function toParamValue(values: string[]): string {
  return values.filter((value) => value !== 'All').join(';');
}

function toBallTypesParamValue(values: string[]): string {
  // Baseball is a real filter value. Only "All" should clear this filter.
  const selected = values.filter((value) => value !== 'All');
  return selected.join(';');
}

function schoolNameFromCodeIfKnown(value: string): string {
  const code = String(value ?? '').trim().toUpperCase();
  if (!code) return '';
  // resolveSchoolBrand always returns SOMETHING (falling back to the default
  // Pearl Player Development brand for any code it doesn't recognize) -- that
  // default is correct for a school-switcher logo, but wrong here, where an
  // unrecognized code needs to mean "unknown" so the next fallback strategy
  // in schoolNameFromTeamCodeFallback gets a chance instead of silently
  // returning "Pearl Player Development" as if it were a real school name.
  if (!isKnownSchoolBrand(code)) return '';
  const brand = resolveSchoolBrand(code);
  const logoAlt = String(brand.logoAlt ?? '').trim();
  const cleaned = logoAlt.replace(/\s+logo$/i, '').trim();
  if (!cleaned) return '';
  if (cleaned.toLowerCase() === 'school') return '';
  return cleaned;
}

// SCHOOL_BRANDS is keyed by bare school codes ("LSU"), but a player's own
// teamCode is often the site's raw Trackman team code ("LSU_TIG"), which
// doesn't match directly -- try the bare code first, then the prefix before
// the first underscore, before giving up (returning undefined rather than
// the default Pearl Player Development logo, which would be misleading here).
function resolveSchoolLogoByCodeOrPrefix(value: string): string | undefined {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return undefined;
  if (isKnownSchoolBrand(raw)) return resolveSchoolBrand(raw).logoSrc ?? undefined;
  const prefix = raw.split('_')[0];
  if (prefix && isKnownSchoolBrand(prefix)) return resolveSchoolBrand(prefix).logoSrc ?? undefined;
  return undefined;
}

function schoolNameFromTeamCodeFallback(value: string): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return '';
  const mapped = LEAGUE_TEAM_NAME_BY_CODE[raw];
  if (mapped) return mapped;
  const direct = TEAM_CODE_PREFIX_LABELS[raw];
  if (direct) return direct;
  const parts = raw.split('_').filter(Boolean);
  if (!parts.length) return '';
  const prefix = parts[0];
  const knownFromBrand = schoolNameFromCodeIfKnown(prefix);
  if (knownFromBrand) return knownFromBrand;
  return TEAM_CODE_PREFIX_LABELS[prefix] ?? '';
}

function resolveLeagueTeamCodeFromValue(value: string): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return '';
  if (LEAGUE_TEAM_NAME_BY_CODE[raw]) return raw;
  const token = normalizeLeagueTeamToken(raw);
  return LEAGUE_TEAM_CODE_BY_LABEL_TOKEN[token] ?? '';
}

function isPitchLikeSplitColumn(value: string): boolean {
  const token = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return token === 'pitch' || token === 'pitchtype' || token === 'pitchtypes';
}

function parseRangeLabel(value: string): { min?: string; max?: string } | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const plusMatch = text.match(/^(-?\d+(?:\.\d+)?)\+$/);
  if (plusMatch) return { min: plusMatch[1] };
  const rangeMatch = text.match(/^(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) return { min: rangeMatch[1], max: rangeMatch[2] };
  const ltMatch = text.match(/^<\s*(-?\d+(?:\.\d+)?)$/);
  if (ltMatch) return { max: ltMatch[1] };
  const gtMatch = text.match(/^>\s*(-?\d+(?:\.\d+)?)$/);
  if (gtMatch) return { min: gtMatch[1] };
  return null;
}

function resolvePitchTypeFilterValue(rowLabel: string, availablePitchTypes: string[]): string {
  const raw = String(rowLabel ?? '').trim();
  if (!raw) return raw;
  const token = normalizeNameToken(raw);
  const fromOptions = (availablePitchTypes ?? []).find((option) => normalizeNameToken(option) === token);
  if (fromOptions) return fromOptions;
  const aliasMap: Record<string, string> = {
    fourseam: 'Fastball',
    fourseamfastball: 'Fastball',
    fastball: 'Fastball',
    twoseam: 'Sinker',
    twoseamfastball: 'Sinker',
    sinker: 'Sinker',
    cutter: 'Cutter',
    slider: 'Slider',
    sweeper: 'Sweeper',
    curveball: 'Curveball',
    changeup: 'ChangeUp',
    splitter: 'Splitter',
    knuckleball: 'Knuckleball',
  };
  const alias = aliasMap[token];
  if (!alias) return raw;
  const canonical = (availablePitchTypes ?? []).find((option) => normalizeNameToken(option) === normalizeNameToken(alias));
  return canonical ?? alias;
}

function applyPitchingSummarySplitFilter(params: URLSearchParams, splitBy: string, rowLabel: string, availablePitchTypes: string[] = []): boolean {
  const clearKeys = [
    'pitch_types',
    'hand',
    'batter_side',
    'count_filter',
    'after_count_filter',
    'venue',
    'zone_locations',
    'opp_hitter',
    'team_type',
    'velo_min',
    'velo_max',
    'ivb_min',
    'ivb_max',
    'hb_min',
    'hb_max',
    'pc_min',
    'pc_max',
    'bf_min',
    'bf_max',
    'ip_min',
    'ip_max',
  ] as const;
  for (const key of clearKeys) params.delete(key);
  if (isAllLikeRowValue(rowLabel)) return true;
  switch (splitBy) {
    case 'Pitch Types': {
      const token = normalizeNameToken(rowLabel);
      // Guard against accidental hand-like labels getting applied as pitch_types
      // (e.g. "Right"/"Left"), which creates very expensive invalid baseline queries.
      if (token === 'left' || token === 'right' || token === 'lhh' || token === 'rhh') return false;
      const resolvedPitchType = resolvePitchTypeFilterValue(rowLabel, availablePitchTypes);
      const resolvedToken = normalizeNameToken(resolvedPitchType);
      const knownPitchTypes = new Set(
        (availablePitchTypes ?? [])
          .map((value) => normalizeNameToken(value))
          .filter(Boolean)
      );
      if (knownPitchTypes.size > 0 && !knownPitchTypes.has(resolvedToken)) return false;
      params.set('pitch_types', resolvedPitchType);
      return true;
    }
    case 'Pitcher Hand':
      params.set('hand', canonicalizeHandLabel(rowLabel));
      return true;
    case 'Batter Hand':
      params.set('batter_side', canonicalizeHandLabel(rowLabel));
      return true;
    case 'Count':
      params.set('count_filter', rowLabel);
      return true;
    case 'After Count':
      params.set('after_count_filter', rowLabel);
      return true;
    case 'Venue':
      params.set('venue', rowLabel);
      return true;
    case 'Zone Location':
      params.set('zone_locations', rowLabel);
      return true;
    case 'Batter':
      params.set('opp_hitter', rowLabel);
      return true;
    case 'Team':
    case 'Pitcher Team':
      params.set('team_type', rowLabel);
      return true;
    case 'Pitch Count': {
      const range = parseRangeLabel(rowLabel);
      if (!range) return false;
      if (range.min) params.set('pc_min', range.min);
      if (range.max) params.set('pc_max', range.max);
      return true;
    }
    case 'Velocity': {
      const range = parseRangeLabel(rowLabel);
      if (!range) return false;
      if (range.min) params.set('velo_min', range.min);
      if (range.max) params.set('velo_max', range.max);
      return true;
    }
    case 'IVB': {
      const range = parseRangeLabel(rowLabel);
      if (!range) return false;
      if (range.min) params.set('ivb_min', range.min);
      if (range.max) params.set('ivb_max', range.max);
      return true;
    }
    case 'HB': {
      const range = parseRangeLabel(rowLabel);
      if (!range) return false;
      if (range.min) params.set('hb_min', range.min);
      if (range.max) params.set('hb_max', range.max);
      return true;
    }
    default:
      return false;
  }
}

function normalizeNameToken(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function shouldInvertIvbForPitchTypeLabel(value: unknown): boolean {
  const token = normalizeNameToken(String(value ?? ''));
  if (!token) return false;
  return LOW_IVB_BETTER_PITCH_TYPES.has(token);
}

function shouldInvertHbForPitchTypeLabel(value: unknown, handCode: 'R' | 'L' | ''): boolean {
  const token = normalizeNameToken(String(value ?? ''));
  if (!token || !handCode) return false;
  if (handCode === 'R') return RIGHTY_LOW_HB_BETTER_PITCH_TYPES.has(token);
  return LEFTY_LOW_HB_BETTER_PITCH_TYPES.has(token);
}

function shouldInvertVaaForPitchTypeLabel(value: unknown): boolean {
  const token = normalizeNameToken(String(value ?? ''));
  if (!token) return false;
  if (token === 'all' || token === 'allpinned') return false;
  // Fastball remains "higher is better"; all other pitch types are inverted.
  return token !== 'fastball' && token !== 'fourseam' && token !== 'fourseamfastball';
}

function reconcileMultiSelection(values: string[], options: OptionItem[]): string[] {
  const optionValues = options.map((option) => String(option.value ?? '').trim()).filter(Boolean);
  const allowed = new Set(optionValues);
  const tokenToCanonical = new Map<string, string>();
  for (const option of options) {
    const canonical = String(option.value ?? '').trim();
    if (!canonical || canonical === 'All') continue;
    const valueToken = normalizeNameToken(canonical);
    if (valueToken && !tokenToCanonical.has(valueToken)) tokenToCanonical.set(valueToken, canonical);
    const labelToken = normalizeNameToken(option.label);
    if (labelToken && !tokenToCanonical.has(labelToken)) tokenToCanonical.set(labelToken, canonical);
    const firstLastToken = normalizeNameToken(formatNameFirstLast(canonical));
    if (firstLastToken && !tokenToCanonical.has(firstLastToken)) tokenToCanonical.set(firstLastToken, canonical);
  }
  const resolved: string[] = [];
  for (const raw of values) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed || trimmed === 'All') continue;
    if (allowed.has(trimmed)) {
      resolved.push(trimmed);
      continue;
    }
    const token = normalizeNameToken(trimmed);
    const canonical = token ? tokenToCanonical.get(token) : '';
    if (canonical) resolved.push(canonical);
  }
  return normalizeMulti(resolved);
}

function reorderColumns(columns: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return columns;
  if (fromIndex >= columns.length || toIndex >= columns.length) return columns;
  const next = [...columns];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

const FALLBACK_AVAILABLE_CUSTOM_COLUMNS = [
  '#',
  'Usage',
  'Overall',
  'BF',
  'Velo',
  'FBvelo',
  'Max',
  'IVB',
  'xIVB',
  'dIVB',
  'HB',
  'xHB',
  'dHB',
  'MagAngle',
  'Spin',
  'rTilt',
  'bTilt',
  'TiltDev',
  'SpinEff',
  'Height',
  'Side',
  'Ext',
  'VAA',
  'nVAA',
  'HAA',
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
  'SwStrk%',
  'K%',
  'BB%',
  'K-BB%',
  'GB%',
  'Barrel%',
  'CSW%',
  'EV',
  'LA',
  'Stuff+',
  'fbCHivbSEP',
  'fbSPivbSEP',
  'fbCTivbSEP',
  'fbSLivbSEP',
  'fbCBivbSEP',
  'fbSWivbSEP',
  'fbCHhbSEP',
  'fbSPhbSEP',
  'fbCThbSEP',
  'fbSLhbSEP',
  'fbCBhbSEP',
  'fbSWhbSEP',
  'siCHivbSEP',
  'siSPivbSEP',
  'siCTivbSEP',
  'siSLivbSEP',
  'siCBivbSEP',
  'siSWivbSEP',
  'siCHhbSEP',
  'siSPhbSEP',
  'siCThbSEP',
  'siSLhbSEP',
  'siCBhbSEP',
  'siSWhbSEP',
  'fbCHtotSEP',
  'fbSPtotSEP',
  'fbCTtotSEP',
  'fbSLtotSEP',
  'fbCBtotSEP',
  'fbSWtotSEP',
  'siCHtotSEP',
  'siSPtotSEP',
  'siCTtotSEP',
  'siSLtotSEP',
  'siCBtotSEP',
  'siSWtotSEP',
  'Ctrl+',
  'QP+',
  'Pitching+',
  'RV/100',
  'PV/100',
  'IP',
  'P',
  'P/IP',
  'P/BF',
  'H',
  'XBH',
  'Barrels',
  'BB',
  'HBP',
  'K',
  'Whiffs',
  'ERA',
  'FIP',
  'xFIP',
  'SIERA',
  'WHIP',
  'Fastball%',
  'Sinker%',
  'Cutter%',
  'Slider%',
  'Sweeper%',
  'Curveball%',
  'ChangeUp%',
  'Splitter%',
  'FastSink%',
  'Breaking%',
  'Change/Split%',
  '2kFB%',
  '2kOS%',
  '0-0',
  'Behind',
  'Even',
  'Ahead',
  '<2K',
  '2K',
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
];

const COLUMN_HEADER_TOOLTIPS: Record<string, string> = {
  'Fastball%': 'Fastball Usage Rate',
  'Sinker%': 'Sinker Usage Rate',
  'Cutter%': 'Cutter Usage Rate',
  'Slider%': 'Slider Usage Rate',
  'Sweeper%': 'Sweeper Usage Rate',
  'Curveball%': 'Curveball Usage Rate',
  'ChangeUp%': 'ChangeUp Usage Rate',
  'Splitter%': 'Splitter Usage Rate',
  'FastSink%': 'Fastball and Sinker Usage',
  'Breaking%': 'Cutter, Slider, Sweeper, Curveball Usage',
  'Change/Split%': 'Changeup and Splitter Usage',
  '2kFB%': 'Fastball and Sinker Usage in 2 strike',
  '2kOS%': 'Fastball and Sinker Usage in 2 strike',
};

const TREND_METRIC_OPTIONS: OptionItem[] = [
  { value: 'Velocity (Avg)', label: 'Velocity (Avg)' },
  { value: 'Velocity (Max)', label: 'Velocity (Max)' },
  { value: 'Spin', label: 'Spin' },
  { value: 'IVB', label: 'IVB' },
  { value: 'HB', label: 'HB' },
  { value: 'Release Height', label: 'Release Height' },
  { value: 'Release Side', label: 'Release Side' },
  { value: 'Extension', label: 'Extension' },
  { value: 'Stuff+', label: 'Stuff+' },
  { value: 'QP+', label: 'QP+' },
  { value: 'InZone%', label: 'InZone%' },
  { value: 'Comp%', label: 'Comp%' },
  { value: 'Strike%', label: 'Strike%' },
  { value: 'Swing%', label: 'Swing%' },
  { value: 'FPS%', label: 'FPS%' },
  { value: 'Early%', label: 'Early%' },
  { value: 'Ahead%', label: 'Ahead%' },
  { value: 'E+A%', label: 'E+A%' },
  { value: '1-1W%', label: '1-1W%' },
  { value: 'QP%', label: 'QP%' },
  { value: 'Whiff%', label: 'Whiff%' },
  { value: 'SwStrk%', label: 'SwStrk%' },
  { value: 'CSW%', label: 'CSW%' },
  { value: 'K%', label: 'K%' },
  { value: 'BB%', label: 'BB%' },
  { value: 'GB%', label: 'GB%' },
  { value: 'Barrel%', label: 'Barrel%' },
  { value: 'Exit Velocity', label: 'Exit Velocity' },
  { value: 'Launch Angle', label: 'Launch Angle' },
  { value: 'RV/100', label: 'RV/100' },
  { value: 'PV/100', label: 'PV/100' },
  { value: 'P', label: 'P' },
  { value: 'BF', label: 'BF' },
  { value: 'Whiffs', label: 'Whiffs' },
  { value: 'K', label: 'K' },
  { value: 'BB', label: 'BB' },
];
const TREND_SESSION_ORDER = ['Bullpen', 'Live BP', 'Season'] as const;
const TREND_SESSION_COLORS: Record<(typeof TREND_SESSION_ORDER)[number], string> = {
  Bullpen: '#60a5fa',
  'Live BP': '#f59e0b',
  Season: '#22c55e',
};

function normalizePitchTypeName(value: string): string {
  const v = value.trim().toLowerCase();
  if (!v) return 'all';
  if (v === 'all') return 'all';
  const compact = v.replace(/\s+/g, '');
  if (compact === 'forkball') return 'splitter';
  if (compact === 'screwball') return 'changeup';
  return compact;
}

function normalizeColorColumnName(value: string): string {
  const compact = String(value ?? '').replace(/\s+/g, '').replace(/％/g, '%').trim();
  const lower = compact.toLowerCase();
  if (lower === 'inzone%') return 'InZone%';
  if (lower === 'comp%') return 'Comp%';
  if (lower === 'strike%') return 'Strike%';
  if (lower === 'swing%') return 'Swing%';
  if (lower === 'fps%') return 'FPS%';
  if (lower === 'early%') return 'Early%';
  if (lower === 'ahead%') return 'Ahead%';
  if (lower === 'e+a%' || lower === 'ea%') return 'E+A%';
  if (lower === '1-1w%') return '1-1W%';
  if (lower === 'qp%') return 'QP%';
  if (lower === 'whiff%') return 'Whiff%';
  if (lower === 'swstrk%') return 'SwStrk%';
  if (lower === 'csw%') return 'CSW%';
  if (lower === 'k%') return 'K%';
  if (lower === 'bb%') return 'BB%';
  if (lower === 'hr%') return 'HR%';
  if (lower === 'gb%') return 'GB%';
  if (lower === 'era') return 'ERA';
  if (lower === 'fip') return 'FIP';
  if (lower === 'xfip') return 'xFIP';
  if (lower === 'siera') return 'SIERA';
  if (lower === 'barrel%') return 'Barrel%';
  if (lower === 'rv/100') return 'RV/100';
  if (lower === 'pv/100') return 'PV/100';
  return String(value ?? '').trim();
}

function getProcessThresholds(
  columnName: string,
  pitchTypeRaw: string,
  schoolCode?: string
): { poor: number; avg: number; great: number } | null {
  const metric = normalizeColorColumnName(columnName);
  const pitchType = normalizePitchTypeName(pitchTypeRaw);
  const schoolCodeNorm = String(schoolCode ?? '').trim().toUpperCase();
  const isPro = schoolCodeNorm === 'PRO' || schoolCodeNorm === 'MLB';
  if (metric === 'InZone%') {
    if (['fastball', 'sinker'].includes(pitchType)) return isPro ? { poor: 48, avg: 55, great: 62 } : { poor: 43, avg: 50, great: 57 };
    if (['cutter', 'slider', 'sweeper', 'curveball'].includes(pitchType)) return { poor: 37, avg: 43, great: 49 };
    if (['changeup', 'splitter', 'knuckleball'].includes(pitchType)) return { poor: 30, avg: 37, great: 44 };
    if (pitchType === 'all') return isPro ? { poor: 44, avg: 49, great: 54 } : { poor: 42, avg: 47, great: 52 };
  }
  if (metric === 'Comp%') {
    if (['fastball', 'sinker'].includes(pitchType)) return { poor: 79, avg: 83, great: 87 };
    if (['cutter', 'slider', 'sweeper', 'curveball'].includes(pitchType)) return { poor: 70, avg: 76, great: 82 };
    if (['changeup', 'splitter', 'knuckleball'].includes(pitchType)) return { poor: 65, avg: 74, great: 83 };
    if (pitchType === 'all') return { poor: 76, avg: 79, great: 82 };
  }
  if (metric === 'Strike%') return isPro ? { poor: 59, avg: 64, great: 69 } : { poor: 57, avg: 62, great: 67 };
  if (metric === 'Swing%') {
    if (['fastball', 'sinker'].includes(pitchType)) return { poor: 40, avg: 44, great: 48 };
    if (['cutter', 'slider', 'sweeper'].includes(pitchType)) return { poor: 37, avg: 43, great: 49 };
    if (pitchType === 'curveball') return { poor: 28, avg: 35, great: 42 };
    if (['changeup', 'splitter'].includes(pitchType)) return { poor: 43, avg: 47, great: 51 };
    if (pitchType === 'all') return { poor: 40, avg: 45, great: 50 };
  }
  if (metric === 'FPS%') return isPro ? { poor: 57, avg: 62, great: 67 } : { poor: 55, avg: 60, great: 65 };
  if (metric === 'E+A%' && pitchType === 'all') return isPro ? { poor: 68, avg: 73, great: 78 } : { poor: 65, avg: 70, great: 75 };
  if (metric === '1-1W%') return { poor: 58, avg: 63, great: 68 };
  if (metric === 'Ahead%') return isPro ? { poor: 34, avg: 39, great: 44 } : { poor: 32, avg: 37, great: 42 };
  if (metric === 'QP%') return { poor: 38, avg: 48, great: 58 };
  if (metric === 'Ctrl+') return { poor: 75, avg: 85, great: 95 };
  if (metric === 'QP+') return { poor: 75, avg: 90, great: 105 };
  if (metric === 'Pitching+') return { poor: 80, avg: 95, great: 110 };
  if (metric === 'K%' && pitchType === 'all') return { poor: 18, avg: 23, great: 28 };
  if (metric === 'BB%' && pitchType === 'all') return { poor: 11, avg: 9, great: 7 };
  if (metric === 'HR%' && pitchType === 'all') {
    if (isPro) return { poor: 4.0, avg: 3.0, great: 2.0 };
    return { poor: 3.4, avg: 2.4, great: 1.4 };
  }
  if (metric === 'Whiff%') {
    if (pitchType === 'fastball') return { poor: 18, avg: 22, great: 26 };
    if (pitchType === 'sinker') return { poor: 9, avg: 13, great: 17 };
    if (pitchType === 'cutter') return { poor: 22, avg: 27, great: 32 };
    if (['sweeper', 'curveball', 'slider', 'changeup', 'splitter'].includes(pitchType)) return { poor: 29, avg: 35, great: 41 };
    if (pitchType === 'all') return { poor: 21, avg: 26, great: 31 };
  }
  if (metric === 'CSW%') {
    if (['fastball', 'sinker'].includes(pitchType)) return { poor: 23, avg: 27, great: 31 };
    if (['cutter', 'slider', 'sweeper', 'curveball'].includes(pitchType)) return { poor: 29, avg: 32, great: 35 };
    if (['splitter', 'changeup'].includes(pitchType)) return { poor: 22, avg: 28, great: 34 };
    if (pitchType === 'all') return { poor: 26, avg: 29, great: 32 };
  }
  if (metric === 'GB%') {
    if (pitchType === 'fastball') return { poor: 31, avg: 39, great: 47 };
    if (pitchType === 'sinker') return { poor: 43, avg: 54, great: 65 };
    if (['cutter', 'slider', 'sweeper', 'curveball'].includes(pitchType)) return { poor: 36, avg: 43, great: 50 };
    if (['changeup', 'splitter'].includes(pitchType)) return { poor: 35, avg: 47, great: 59 };
    if (pitchType === 'all') return { poor: 38, avg: 43, great: 48 };
  }
  if (metric === 'ERA') {
    if (isPro) return { poor: 5.2, avg: 4.2, great: 3.2 };
    return null;
  }
  if (metric === 'FIP' || metric === 'xFIP' || metric === 'SIERA') {
    if (isPro) return { poor: 5.2, avg: 4.2, great: 3.2 };
    return { poor: 5.9, avg: 4.9, great: 3.9 };
  }
  if (metric === 'Barrel%') return { poor: 20, avg: 15, great: 10 };
  if (metric === 'EV') return { poor: 95, avg: 85, great: 75 };
  if (metric === 'Stuff+') return { poor: 90, avg: 100, great: 110 };
  if (metric === 'RV/100') {
    if (isPro) {
      if (pitchType === 'fastball') return { poor: 2.4, avg: -0.4, great: -2.4 };
      if (pitchType === 'sinker') return { poor: 2.4, avg: -0.6, great: -2.8 };
      if (pitchType === 'cutter') return { poor: 2.4, avg: -0.4, great: -2.4 };
      if (pitchType === 'slider') return { poor: 2.2, avg: -0.6, great: -2.8 };
      if (pitchType === 'sweeper') return { poor: 2.5, avg: -0.5, great: -2.5 };
      if (pitchType === 'curveball') return { poor: 2.0, avg: -0.1, great: -2.0 };
      if (pitchType === 'changeup') return { poor: 2.4, avg: -0.4, great: -2.4 };
      if (pitchType === 'splitter') return { poor: 2.5, avg: -0.5, great: -2.5 };
      if (pitchType === 'knuckleball') return { poor: 3.0, avg: 0.9, great: -0.1 };
      return { poor: 2.0, avg: -0.4, great: -2.0 };
    }
    if (pitchType === 'fastball') return { poor: 4.6, avg: 1.8, great: -0.2 };
    if (pitchType === 'sinker') return { poor: 4.6, avg: 1.6, great: -0.6 };
    if (pitchType === 'cutter') return { poor: 3.6, avg: 0.8, great: -1.2 };
    if (pitchType === 'slider') return { poor: 3.7, avg: 0.9, great: -1.3 };
    if (pitchType === 'sweeper') return { poor: 3.5, avg: 0.5, great: -1.5 };
    if (pitchType === 'curveball') return { poor: 3.1, avg: 1.0, great: -0.9 };
    if (pitchType === 'changeup') return { poor: 4.0, avg: 1.2, great: -0.8 };
    if (pitchType === 'splitter') return { poor: 3.9, avg: 0.9, great: -1.1 };
    if (pitchType === 'knuckleball') return { poor: 3.1, avg: 1.0, great: 0.0 };
    return { poor: 3.8, avg: 1.4, great: -0.2 };
  }
  if (metric === 'PV/100') {
    if (isPro) {
      if (pitchType === 'fastball') return { poor: 2.0, avg: 0.3, great: -1.4 };
      if (pitchType === 'sinker') return { poor: 3.0, avg: 1.4, great: -0.2 };
      if (pitchType === 'cutter') return { poor: 2.5, avg: 0.7, great: -1.1 };
      if (pitchType === 'slider') return { poor: 1.5, avg: -0.4, great: -2.3 };
      if (pitchType === 'sweeper' || pitchType === 'curveball') return { poor: 1.1, avg: -0.8, great: -2.7 };
      if (pitchType === 'changeup') return { poor: 2.0, avg: -0.1, great: -2.1 };
      if (pitchType === 'splitter') return { poor: 1.0, avg: -0.7, great: -2.4 };
      if (pitchType === 'knuckleball') return { poor: 1.1, avg: -0.8, great: -2.7 };
      return { poor: 2.0, avg: 0.2, great: -1.8 };
    }
    if (pitchType === 'fastball') return { poor: 2.9, avg: 1.2, great: -0.5 };
    if (pitchType === 'sinker') return { poor: 2.8, avg: 1.2, great: -0.4 };
    if (pitchType === 'cutter') return { poor: 1.7, avg: -0.1, great: -1.9 };
    if (pitchType === 'slider') return { poor: 1.0, avg: -0.9, great: -2.8 };
    if (pitchType === 'sweeper') return { poor: 0.2, avg: -1.7, great: -3.6 };
    if (pitchType === 'curveball') return { poor: 0.5, avg: -1.4, great: -3.3 };
    if (pitchType === 'changeup') return { poor: 1.5, avg: -0.6, great: -2.6 };
    if (pitchType === 'splitter') return { poor: 0.5, avg: -1.2, great: -2.9 };
    if (pitchType === 'knuckleball') return { poor: 1.7, avg: -0.2, great: -2.1 };
    return { poor: 2.1, avg: 0.3, great: -1.7 };
  }
  return null;
}

function getHeatmapFixedScale(metricRaw: string, selectedPitchTypesRaw: string[]): { min: number; mid: number; max: number } | null {
  const metric = String(metricRaw ?? '').trim();
  const selectedPitchTypes = selectedPitchTypesRaw
    .map((value) => normalizePitchTypeName(value))
    .filter((value) => value && value !== 'all');

  if (metric === 'Exit Velocity') return { min: 80, mid: 90, max: 100 };
  if (metric === 'PV/100') return { min: -2, mid: 0, max: 2 };
  if (metric === 'xWOBA') return { min: 0.27, mid: 0.32, max: 0.37 };
  if (metric === 'xISO') return { min: 0.05, mid: 0.175, max: 0.3 };

  if (metric === 'Whiff Rate' || metric === 'Whiff%') return { min: 0, mid: 25, max: 50 };
  if (metric === 'SwStrk%') return { min: 0, mid: 12.5, max: 25 };

  const pitchTypeForThreshold = selectedPitchTypes.length === 1 ? selectedPitchTypes[0] : 'all';
  if (metric === 'Swing Rate' || metric === 'Swing%') {
    return { min: 20, mid: 50, max: 80 };
  }
  if (metric === 'GB Rate' || metric === 'GB%') {
    const threshold = getProcessThresholds('GB%', pitchTypeForThreshold);
    if (threshold) return { min: threshold.poor, mid: threshold.avg, max: threshold.great };
  }
  if (metric === 'Contact Rate' || metric === 'Contact%') {
    if (selectedPitchTypes.length !== 1) return { min: 60, mid: 75, max: 90 };
    const pt = selectedPitchTypes[0];
    if (pt === 'fastball') return { min: 70, mid: 80, max: 90 };
    if (pt === 'sinker') return { min: 80, mid: 87.5, max: 95 };
    return { min: 55, mid: 67.5, max: 80 };
  }
  return null;
}

function formatHeatmapLegendValue(metric: string, value: number): string {
  if (metric === 'xWOBA' || metric === 'xISO') return value.toFixed(3);
  if (metric === 'PV/100' || metric === 'RV/100') return value.toFixed(1);
  if (metric === 'Exit Velocity') return `${Math.round(value)}`;
  return `${Math.round(value)}%`;
}

function getCellColorScale(
  value: string | number | null | undefined,
  columnName: string,
  pitchType: string,
  schoolCode?: string
): CellColors | null {
  const metric = normalizeColorColumnName(columnName);
  const parsed = parseSortableNumber(value);
  if (parsed === null) return null;
  const thresholds = getProcessThresholds(metric, pitchType, schoolCode);
  if (!thresholds) return null;
  const { poor, avg, great } = thresholds;
  const reverseScale = ['EV', 'Barrel%', 'BB%', 'HR%', 'ERA', 'FIP', 'xFIP', 'SIERA'].includes(metric) || metric === 'RV/100' || metric === 'PV/100';
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

function SearchableSingleSelect({
  options,
  value,
  onChange,
  placeholder,
  theme = 'dark',
  clearQueryOnSelect = true,
  menuStyle,
  disabled = false,
}: {
  options: OptionItem[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  theme?: 'dark' | 'light';
  clearQueryOnSelect?: boolean;
  menuStyle?: React.CSSProperties;
  disabled?: boolean;
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
  const commitSelection = (next: string) => {
    setOpen(false);
    if (clearQueryOnSelect) setQuery('');
    if (typeof window !== 'undefined') {
      window.setTimeout(() => onChange(next), 0);
      return;
    }
    onChange(next);
  };

  return (
    <div className="portal-search-select" ref={rootRef}>
      <button
        type="button"
        className="portal-search-select-trigger"
        disabled={disabled}
        title={disabled ? 'Expected movement requires measured tilt and active spin or spin efficiency.' : undefined}
        style={
          theme === 'light'
            ? { background: '#fff', color: '#374151', borderColor: '#cbd5e1', justifyContent: 'space-between' }
            : undefined
        }
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
      >
        {selected ? renderOptionLabel(selected.label) : placeholder ?? 'Select'}
      </button>
      {open ? (
        <div
          className="portal-search-select-menu"
          style={{
            ...(theme === 'light' ? { background: '#fff', borderColor: '#cbd5e1' } : {}),
            ...menuStyle,
          }}
        >
          <input
            className="portal-search-select-input"
            style={theme === 'light' ? { background: '#fff', color: '#374151', borderColor: '#d1d5db' } : undefined}
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
                disabled={option.disabled}
                title={option.disabled ? 'Expected movement requires measured tilt and active spin or spin efficiency.' : undefined}
                style={theme === 'light' ? { color: '#374151' } : undefined}
                onClick={() => {
                  if (!option.disabled) commitSelection(option.value);
                }}
              >
                {renderOptionLabel(option.label)}
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

function AbPaChart({
  pitches,
  resultLabel,
  onPitchClick,
  pitchColors,
  flipX = false,
  isProSchool = false,
}: {
  pitches: PitchActionPoint[];
  resultLabel: string;
  onPitchClick: (pitch: PitchActionPoint) => void;
  pitchColors: Record<string, string>;
  flipX?: boolean;
  isProSchool?: boolean;
}) {
  const [hover, setHover] = useState<ChartHover>(null);
  const abHoverTextColor = (bg?: string): string => {
    const value = String(bg ?? '').trim().toLowerCase();
    if (value.includes('--portal-fastball-color')) {
      const isLight = typeof document !== 'undefined' && document.body.classList.contains('theme-light');
      return isLight ? '#fff' : '#111';
    }
    if (value === '#ffffff' || value === '#fff' || value === 'white' || value === 'rgb(255,255,255)' || value === 'rgb(255, 255, 255)') {
      return '#111';
    }
    return '#fff';
  };
  const w = 360;
  const h = 280;
  const xMin = -3;
  const xMax = 3;
  const yMin = 0.5;
  const yMax = 5;
  const px = (x: number) => ((x - xMin) / (xMax - xMin)) * w;
  const py = (y: number) => ((yMax - y) / (yMax - yMin)) * h;
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

  const resultShape = (pitch: PitchActionPoint): string => {
    const call = pitch.pitch_call || '';
    const pr = pitch.play_result || '';
    const pitchIsPro =
      pitch.school_code != null && pitch.school_code !== ''
        ? String(pitch.school_code).trim().toUpperCase() === 'PRO'
        : isProSchool;
    if (pitchIsPro) {
      const norm = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const callN = norm(call);
      const prN = norm(pr);
      if (callN === 'called_strike' || callN === 'strikecalled') return 'Called Strike';
      if (
        callN === 'hit_by_pitch' ||
        callN === 'hitbypitch' ||
        prN === 'hit_by_pitch' ||
        prN === 'hitbypitch' ||
        callN === 'ball' ||
        callN === 'ballcalled' ||
        callN === 'ball_called' ||
        callN === 'ballindirt' ||
        callN === 'ball_in_dirt' ||
        callN === 'blocked_ball' ||
        callN === 'pitchout' ||
        callN === 'ball_pitchout' ||
        callN === 'intentional_ball' ||
        callN === 'intent_ball'
      ) {
        return 'Ball';
      }
      if (callN.includes('foul')) return 'Foul';
      if (callN === 'swinging_strike' || callN === 'swinging_strike_blocked' || callN === 'swinging_strike_pitchout' || callN === 'missed_bunt' || callN === 'strikeswinging') return 'Whiff';
      if (prN === 'single' || prN === 'double' || prN === 'triple' || prN === 'home_run' || prN === 'homerun') return 'In Play (Hit)';
      if (prN === 'field_error' || prN === 'error') return 'Error';
      if (callN.startsWith('in_play') || callN.startsWith('hit_into_play') || callN === 'inplay') return 'In Play (Out)';
      if (prN && !['walk', 'intent_walk', 'intentional_walk', 'strikeout', 'strikeout_double_play', 'hit_by_pitch', 'hitbypitch'].includes(prN)) return 'In Play (Out)';
      return '';
    }
    if (call === 'HitByPitch' || pr === 'HitByPitch') return 'Ball';
    if (call === 'StrikeCalled') return 'Called Strike';
    if (call === 'BallCalled' || call === 'BallinDirt') return 'Ball';
    if (call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable') return 'Foul';
    if (call === 'StrikeSwinging') return 'Whiff';
    if (call === 'InPlay' && (pr === 'Out' || pr === 'FieldersChoice' || pr === 'Sacrifice')) return 'In Play (Out)';
    if (call === 'InPlay' && (pr === 'Single' || pr === 'Double' || pr === 'Triple' || pr === 'HomeRun')) return 'In Play (Hit)';
    if (call === 'InPlay' && pr === 'Error') return 'Error';
    return '';
  };

  const hoverText = (pitch: PitchActionPoint, idx: number): string => {
    const countPart =
      pitch.balls_num !== null && pitch.strikes_num !== null ? `${pitch.balls_num}-${pitch.strikes_num}` : '-';
    const resultPart = resolveAbPitchResult(pitch);
    return [
      `Pitch #${idx + 1}`,
      `Pitcher: ${formatNameFirstLast(String(pitch.pitcher || '')) || '-'}`,
      `Batter: ${formatNameFirstLast(String(pitch.batter || '')) || '-'}`,
      `${pitch.pitch_type || 'Pitch'}`,
      `Velo: ${fmtNum(pitch.velo, 1)} mph`,
      `IVB: ${fmtNum(pitch.ivb, 1)}`,
      `HB: ${fmtNum(pitch.hb, 1)}`,
      `Count: ${countPart}`,
      `Result: ${resultPart}`,
    ].join('\n');
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        <strong>{resultLabel}</strong>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: '100%', height: 280, border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10 }}
        onMouseLeave={() => setHover(null)}
      >
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
        {pitches
          .filter((pitch) => typeof pitch.plate_side === 'number' && typeof pitch.plate_height === 'number')
          .map((pitch, i) => {
            const pitchFlipX =
              pitch.school_code != null && pitch.school_code !== ''
                ? String(pitch.school_code).trim().toUpperCase() === 'PRO'
                : flipX;
            const x = px(pitchFlipX ? -Number(pitch.plate_side) : Number(pitch.plate_side));
            const y = py(Number(pitch.plate_height));
            const shape = resultShape(pitch);
            const color = pitchColors[pitch.pitch_type] ?? '#9ca3af';
            return (
              <g
                key={`${pitch.pitch_event_id ?? i}-${i}`}
                onClick={() => onPitchClick(pitch)}
                onMouseMove={(event) => {
                  const svg = event.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  const xPct = (x / w) * rect.width;
                  const yPct = (y / h) * rect.height;
                  setHover({
                    x: xPct + 8,
                    y: yPct - 8,
                    text: hoverText(pitch, i),
                    bg: color,
                  });
                }}
                onMouseEnter={(event) => {
                  const svg = event.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  const xPct = (x / w) * rect.width;
                  const yPct = (y / h) * rect.height;
                  setHover({
                    x: xPct + 8,
                    y: yPct - 8,
                    text: hoverText(pitch, i),
                    bg: color,
                  });
                }}
                style={{ cursor: 'pointer' }}
              >
                {shape === 'Ball' ? <circle cx={x} cy={y} r={7.6} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={2.2} /> : null}
                {shape === 'Called Strike' ? <circle cx={x} cy={y} r={7.3} fill={color} stroke={color} strokeWidth={1.8} /> : null}
                {shape === 'Foul' ? <polygon points={`${x},${y - 8.1} ${x - 7.1},${y + 6.2} ${x + 7.1},${y + 6.2}`} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={2.1} /> : null}
                {shape === 'Whiff' ? <text x={x} y={y + 6.3} fontSize={20} textAnchor="middle" fill={color}>★</text> : null}
                {shape === 'In Play (Out)' ? <polygon points={`${x},${y - 8.1} ${x - 7.1},${y + 6.2} ${x + 7.1},${y + 6.2}`} fill={color} /> : null}
                {shape === 'In Play (Hit)' ? <rect x={x - 7.1} y={y - 7.1} width={14.2} height={14.2} fill={color} /> : null}
                {shape === 'Error' ? <rect x={x - 7.1} y={y - 7.1} width={14.2} height={14.2} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={2.1} /> : null}
                {shape === '' ? (
                  <path
                    d={`M ${x - 5.5} ${y - 5.5} L ${x + 5.5} ${y + 5.5} M ${x + 5.5} ${y - 5.5} L ${x - 5.5} ${y + 5.5}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                  />
                ) : null}
                <text x={x} y={y - 8} fontSize={11} textAnchor="middle" fill="white" stroke="rgba(0,0,0,0.55)" strokeWidth={0.6}>
                  {i + 1}
                </text>
              </g>
            );
          })}
      </svg>
      {hover ? (
        <div
          style={{
            position: 'absolute',
            left: hover.x,
            top: hover.y,
            transform: 'translate(0, -100%)',
            maxWidth: 320,
            background: hover.bg ?? '#111827',
            color: abHoverTextColor(hover.bg),
            border: '1px solid rgba(255,255,255,0.45)',
            borderRadius: 8,
            padding: '6px 8px',
            fontSize: '0.78rem',
            lineHeight: 1.3,
            whiteSpace: 'pre-line',
            pointerEvents: 'none',
            zIndex: 20,
            boxShadow: '0 10px 25px rgba(0,0,0,0.35)',
          }}
        >
          {hover.text}
        </div>
      ) : null}
    </div>
  );
}

const DNA_METRIC_COLUMNS = ['Velo', 'IVB', 'HB', 'Spin', 'Ext', 'Height', 'Side'] as const;
type DnaMetricColumn = (typeof DNA_METRIC_COLUMNS)[number];
const ARSENAL_PITCH_TYPES = ['Fastball', 'Sinker', 'Cutter', 'Slider', 'Sweeper', 'Curveball', 'ChangeUp', 'Splitter'] as const;
type ArsenalPitchType = (typeof ARSENAL_PITCH_TYPES)[number];
const MIN_ARSENAL_PITCHES_PER_TYPE = 10;
const MIN_ARSENAL_TOTAL_PITCHES = 50;
const MIN_ARSENAL_PITCH_TYPES = 2;
const DNA_METRIC_LABELS: Record<DnaMetricColumn, string> = {
  Velo: 'Velo',
  IVB: 'IVB',
  HB: 'HB',
  Spin: 'Spin',
  Ext: 'Extension',
  Height: 'Rel. Height',
  Side: 'Rel. Side',
};

type DnaPoolSource = 'MLB' | 'D1';

type DnaPitcherRow = {
  key: string;
  pitcher: string;
  teamCode: string;
  teamLabel: string;
  metrics: Partial<Record<DnaMetricColumn, number>>;
  pitches: number;
  throwsHand: 'R' | 'L';
  // Tags rows pulled from a comparison pool (school_code=PRO for MLB,
  // school_code=LEAGUE&level=D1 for D1) so the nearest-neighbor search can be
  // restricted to only match against that pool when a "Compare to X" mode is
  // on, instead of the pitcher's own team. Undefined means "own school".
  poolSource?: DnaPoolSource;
};

type ArsenalPitchRow = DnaPitcherRow & {
  pitchType: ArsenalPitchType;
};

type ArsenalComparisonPitchRow = ArsenalPitchRow & {
  usage: number;
};

const ARSENAL_PITCH_COLORS: Record<ArsenalPitchType, string> = {
  Fastball: '#f8fafc',
  Sinker: '#f59e0b',
  Cutter: '#a78bfa',
  Slider: '#ef4444',
  Sweeper: '#ec4899',
  Curveball: '#3b82f6',
  ChangeUp: '#22c55e',
  Splitter: '#06b6d4',
};

const ARSENAL_PITCH_ABBREVIATIONS: Record<ArsenalPitchType, string> = {
  Fastball: 'FB',
  Sinker: 'SI',
  Cutter: 'CT',
  Slider: 'SL',
  Sweeper: 'SW',
  Curveball: 'CB',
  ChangeUp: 'CH',
  Splitter: 'SP',
};

type ArsenalMovementBounds = {
  maxX: number;
  maxY: number;
};

function ArsenalMovementPlot({
  rows,
  bounds,
}: {
  rows: ArsenalComparisonPitchRow[];
  bounds: ArsenalMovementBounds;
}) {
  const width = 330;
  const height = 260;
  const margin = { top: 20, right: 18, bottom: 38, left: 44 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const x = (value: number) => margin.left + ((value + bounds.maxX) / (bounds.maxX * 2)) * plotWidth;
  const y = (value: number) =>
    margin.top + (1 - (value + bounds.maxY) / (bounds.maxY * 2)) * plotHeight;
  const xTicks = Array.from({ length: bounds.maxX / 5 + 1 }, (_, index) => -bounds.maxX + index * 10);
  const yTicks = Array.from({ length: bounds.maxY / 5 + 1 }, (_, index) => -bounds.maxY + index * 10);
  const usableRows = rows.filter(
    (row) => Number.isFinite(row.metrics.HB) && Number.isFinite(row.metrics.IVB)
  );

  return (
    <svg
      className="portal-arsenal-movement-plot"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Horizontal and induced vertical movement plot"
    >
      <defs>
        <filter id="arsenal-dot-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {xTicks.map((tick) => (
        <g key={`x-${tick}`}>
          <line x1={x(tick)} x2={x(tick)} y1={margin.top} y2={height - margin.bottom} className="portal-arsenal-gridline" />
          <text x={x(tick)} y={height - 18} textAnchor="middle" className="portal-arsenal-axis-tick">
            {tick}
          </text>
        </g>
      ))}
      {yTicks.map((tick) => (
        <g key={`y-${tick}`}>
          <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className="portal-arsenal-gridline" />
          <text x={margin.left - 9} y={y(tick) + 3} textAnchor="end" className="portal-arsenal-axis-tick">
            {tick}
          </text>
        </g>
      ))}
      <line x1={x(0)} x2={x(0)} y1={margin.top} y2={height - margin.bottom} className="portal-arsenal-zero-line" />
      <line x1={margin.left} x2={width - margin.right} y1={y(0)} y2={y(0)} className="portal-arsenal-zero-line" />
      <text x={margin.left + plotWidth / 2} y={height - 2} textAnchor="middle" className="portal-arsenal-axis-label">
        HB
      </text>
      <text
        x={13}
        y={margin.top + plotHeight / 2}
        textAnchor="middle"
        transform={`rotate(-90 13 ${margin.top + plotHeight / 2})`}
        className="portal-arsenal-axis-label"
      >
        IVB
      </text>
      {usableRows.map((row) => {
        const hb = row.metrics.HB as number;
        const ivb = row.metrics.IVB as number;
        const radius = Math.max(9, Math.min(15, 7 + Math.sqrt(Math.max(0, row.usage)) * 0.85));
        const color = ARSENAL_PITCH_COLORS[row.pitchType];
        return (
          <g key={row.pitchType} transform={`translate(${x(hb)} ${y(ivb)})`}>
            <title>
              {row.pitchType}: {ivb.toFixed(1)} IVB, {hb.toFixed(1)} HB, {row.usage.toFixed(1)}% usage
            </title>
            <circle r={radius} fill={color} fillOpacity={0.92} stroke="#020617" strokeWidth={2.5} filter="url(#arsenal-dot-glow)" />
            <text y={3.5} textAnchor="middle" className="portal-arsenal-pitch-label">
              {ARSENAL_PITCH_ABBREVIATIONS[row.pitchType]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Metrics whose sign is an artifact of which arm a pitcher throws with (e.g. a
// lefty's glove-side break/release is numerically the mirror of a righty's).
// Flipping lefties onto the same sign convention as righties lets pitchers
// with equivalent shapes land near each other in PCA space regardless of hand.
const HANDEDNESS_MIRRORED_COLUMNS = new Set<DnaMetricColumn>(['HB', 'Side']);

function normalizeForHandedness(row: DnaPitcherRow): Partial<Record<DnaMetricColumn, number>> {
  if (row.throwsHand !== 'L') return row.metrics;
  const normalized: Partial<Record<DnaMetricColumn, number>> = { ...row.metrics };
  for (const col of HANDEDNESS_MIRRORED_COLUMNS) {
    const value = normalized[col];
    if (value !== undefined) normalized[col] = -value;
  }
  return normalized;
}

const MIN_PITCHERS_PER_TEAM = 3;

// Collapses per-pitcher rows into one row per team (equal weight per pitcher,
// not weighted by pitch count) so the same PCA/rendering pipeline built for
// pitchers can run unchanged on teams. Handedness is normalized PER PITCHER
// before averaging -- otherwise a team with a 50/50 L/R mix would average
// HB/Side toward zero and hide real staff-wide movement tendencies, since raw
// lefty and righty values have opposite sign conventions.
//
// Grouping key is namespaced by poolSource (not bare teamCode) so an own-team
// code that happens to collide with an MLB/D1 team code (e.g. a school whose
// own code overlaps a LEAGUE code) never gets blended into one row -- own and
// pool teams are always aggregated as distinct rows even if their raw
// teamCode strings match.
function aggregateRowsByTeam(rows: DnaPitcherRow[]): DnaPitcherRow[] {
  const byTeam = new Map<string, DnaPitcherRow[]>();
  for (const row of rows) {
    const groupKey = `${row.poolSource ?? 'own'}::${row.teamCode}`;
    const list = byTeam.get(groupKey) ?? [];
    list.push(row);
    byTeam.set(groupKey, list);
  }
  const teamRows: DnaPitcherRow[] = [];
  for (const [groupKey, teamPitchers] of byTeam.entries()) {
    if (teamPitchers.length < MIN_PITCHERS_PER_TEAM) continue;
    const metrics: Partial<Record<DnaMetricColumn, number>> = {};
    for (const col of DNA_METRIC_COLUMNS) {
      const values = teamPitchers
        .map((pitcherRow) => normalizeForHandedness(pitcherRow)[col])
        .filter((value): value is number => value !== undefined);
      if (values.length) metrics[col] = values.reduce((sum, value) => sum + value, 0) / values.length;
    }
    const poolSource = teamPitchers[0].poolSource;
    teamRows.push({
      key: groupKey,
      pitcher: teamPitchers[0].teamLabel,
      teamCode: teamPitchers[0].teamCode,
      teamLabel: teamPitchers[0].teamLabel,
      metrics,
      pitches: teamPitchers.reduce((sum, pitcherRow) => sum + pitcherRow.pitches, 0),
      // Already handedness-normalized above; mark as Right so
      // computePitcherDnaPca's per-row normalization is a no-op here.
      throwsHand: 'R',
      poolSource,
    });
  }
  return teamRows;
}

type DnaPoint = {
  key: string;
  pitcher: string;
  teamCode: string;
  teamLabel: string;
  pc1: number;
  pc2: number;
  metrics: Partial<Record<DnaMetricColumn, number>>;
  // How many standard deviations from the cohort average this pitcher's
  // (handedness-normalized) value sits at, per metric -- used to rank which
  // metric is genuinely most extreme for this pitcher. Projecting through the
  // PCA loading vectors instead breaks down when two metrics have similar
  // loadings (they'd rank as equally "driving" even if the pitcher's real
  // values for them are very different).
  zScores: Partial<Record<DnaMetricColumn, number>>;
  arsenalFeatureValues?: Record<string, number>;
  arsenalFeatureZScores?: Record<string, number>;
  similarityVector?: number[];
  repertoire?: ArsenalPitchType[];
  poolSource?: DnaPoolSource;
};

type ArsenalFeatureLoading = {
  key: string;
  label: string;
  pc1: number;
  pc2: number;
};

// Symmetric eigendecomposition via the cyclic Jacobi method. Matrices here are
// small (<= 7x7, one dimension per DNA metric) so this converges in a handful
// of sweeps without needing a linear-algebra dependency.
function jacobiEigenDecomposition(matrixIn: number[][]): { values: number[]; vectors: number[][] } {
  const n = matrixIn.length;
  const a = matrixIn.map((row) => [...row]);
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < 100; sweep += 1) {
    let off = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) off += a[i][j] * a[i][j];
    }
    if (off < 1e-12) break;

    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-14) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        const app = a[p][p];
        const aqq = a[q][q];
        const apq = a[p][q];
        a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        a[p][q] = 0;
        a[q][p] = 0;
        for (let k = 0; k < n; k += 1) {
          if (k === p || k === q) continue;
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[p][k] = a[k][p];
          a[k][q] = s * akp + c * akq;
          a[q][k] = a[k][q];
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const values = Array.from({ length: n }, (_, i) => a[i][i]);
  const order = values.map((_, i) => i).sort((i, j) => values[j] - values[i]);
  return {
    values: order.map((i) => values[i]),
    vectors: order.map((i) => v.map((row) => row[i])),
  };
}

function computePitcherDnaPca(
  rows: DnaPitcherRow[],
  columns: DnaMetricColumn[],
  // Whether the cohort feeding this chart is scoped to a single pitch type
  // (e.g. "Sweeper" only, not a blended arsenal). Only in that case is there
  // one unambiguous "more break" direction for HB/Rel. Side -- when multiple
  // pitch types are mixed together, a pitcher's blended HB sign depends on
  // their arsenal mix (more sinkers vs. more sliders), so there's no single
  // "positive = more" direction that would be honest to apply.
  isSinglePitchTypeScope: boolean
): {
  points: DnaPoint[];
  loadings: Record<DnaMetricColumn, { pc1: number; pc2: number }>;
  varianceExplainedPct: { pc1: number; pc2: number };
} {
  const empty = {
    points: [] as DnaPoint[],
    loadings: {} as Record<DnaMetricColumn, { pc1: number; pc2: number }>,
    varianceExplainedPct: { pc1: 0, pc2: 0 },
  };
  const usableRows = rows.filter((row) => columns.every((col) => Number.isFinite(row.metrics[col])));
  if (usableRows.length < 3) return empty;

  const usable = usableRows.map((row) => ({ row, handednessNormalized: normalizeForHandedness(row) }));
  const n = usable.length;
  const p = columns.length;
  const means = columns.map((col) => usable.reduce((sum, entry) => sum + (entry.handednessNormalized[col] as number), 0) / n);
  const stds = columns.map((col, ci) => {
    const variance = usable.reduce((sum, entry) => sum + ((entry.handednessNormalized[col] as number) - means[ci]) ** 2, 0) / Math.max(1, n - 1);
    return Math.sqrt(variance) || 1;
  });

  const z = usable.map((entry) => columns.map((col, ci) => ((entry.handednessNormalized[col] as number) - means[ci]) / stds[ci]));

  const cov: number[][] = Array.from({ length: p }, () => Array.from({ length: p }, () => 0));
  for (let i = 0; i < p; i += 1) {
    for (let j = 0; j < p; j += 1) {
      let sum = 0;
      for (let k = 0; k < n; k += 1) sum += z[k][i] * z[k][j];
      cov[i][j] = sum / Math.max(1, n - 1);
    }
  }

  const { vectors, values } = jacobiEigenDecomposition(cov);
  const pc1Vec = vectors[0] ?? columns.map(() => 0);
  const pc2Vec = vectors[1] ?? columns.map(() => 0);

  // When the cohort is scoped to one pitch type, HB/Rel. Side have one
  // unambiguous "more break" direction PER HAND: whichever raw sign that
  // hand's own pitchers lean toward for this pitch type (e.g. righties'
  // sweepers average negative HB, lefties' sweepers average positive HB in
  // this data -- mirror images of each other, as expected). We derive each
  // hand's direction empirically from that hand's own raw (unflipped) values,
  // not the handedness-normalized mean, so the two hands are judged against
  // their own natural convention rather than one forced to match the other's.
  // With multiple pitch types blended together there's no single correct
  // direction (a sinker-heavy vs. slider-heavy arsenal disagree), so this
  // only applies in the single-pitch-type case.
  const moreBreakIsPositiveByHand: Record<'R' | 'L', boolean[]> = { R: [], L: [] };
  (['R', 'L'] as const).forEach((hand) => {
    const handRows = usable.filter((entry) => entry.row.throwsHand === hand);
    moreBreakIsPositiveByHand[hand] = columns.map((col) => {
      if (!HANDEDNESS_MIRRORED_COLUMNS.has(col)) return true;
      if (!handRows.length) return true;
      const rawMean = handRows.reduce((sum, entry) => sum + (entry.row.metrics[col] as number), 0) / handRows.length;
      return rawMean >= 0;
    });
  });

  const points: DnaPoint[] = usable.map((entry, k) => {
    const zScores = {} as Partial<Record<DnaMetricColumn, number>>;
    columns.forEach((col, ci) => {
      // z[k] is computed from the handedness-normalized (sign-flipped for
      // lefties) value, matching how the PCA position is derived. But the
      // metric VALUE we display next to it (entry.row.metrics) is the
      // pitcher's real, unflipped number -- so flip the z-score's sign back
      // here too, otherwise a lefty's displayed raw HB and its "std. dev."
      // can show opposite signs for the same stat, which reads as a
      // contradiction even though the underlying math is consistent.
      const isFlippedForHandedness = entry.row.throwsHand === 'L' && HANDEDNESS_MIRRORED_COLUMNS.has(col);
      let zScore = isFlippedForHandedness ? -z[k][ci] : z[k][ci];
      // Single-pitch-type view: reorient so "more break" always reads
      // positive, using THIS pitcher's own hand's natural sign convention
      // (not the opposite hand's), regardless of which raw sign that pitch
      // type happens to use in this data.
      const moreBreakIsPositive = moreBreakIsPositiveByHand[entry.row.throwsHand][ci];
      if (isSinglePitchTypeScope && HANDEDNESS_MIRRORED_COLUMNS.has(col) && !moreBreakIsPositive) {
        zScore = -zScore;
      }
      zScores[col] = zScore;
    });
    return {
      key: entry.row.key,
      pitcher: entry.row.pitcher,
      teamCode: entry.row.teamCode,
      teamLabel: entry.row.teamLabel,
      pc1: z[k].reduce((sum, value, ci) => sum + value * pc1Vec[ci], 0),
      pc2: z[k].reduce((sum, value, ci) => sum + value * pc2Vec[ci], 0),
      metrics: entry.row.metrics,
      zScores,
      poolSource: entry.row.poolSource,
    };
  });

  const loadings = {} as Record<DnaMetricColumn, { pc1: number; pc2: number }>;
  columns.forEach((col, ci) => {
    loadings[col] = { pc1: pc1Vec[ci], pc2: pc2Vec[ci] };
  });

  // Each column was standardized to unit variance, so the eigenvalues of the
  // covariance matrix sum to the number of columns (total variance = p).
  // An eigenvalue's share of that total is the fraction of variance its
  // component explains.
  const totalVariance = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const varianceExplainedPct = {
    pc1: (Math.max(0, values[0] ?? 0) / totalVariance) * 100,
    pc2: (Math.max(0, values[1] ?? 0) / totalVariance) * 100,
  };

  return { points, loadings, varianceExplainedPct };
}

function computeArsenalDnaPca(rows: ArsenalPitchRow[]): {
  points: DnaPoint[];
  loadings: ArsenalFeatureLoading[];
  varianceExplainedPct: { pc1: number; pc2: number };
} {
  const empty = {
    points: [] as DnaPoint[],
    loadings: [] as ArsenalFeatureLoading[],
    varianceExplainedPct: { pc1: 0, pc2: 0 },
  };
  const byPitcher = new Map<string, ArsenalPitchRow[]>();
  for (const row of rows) {
    if (row.pitches < MIN_ARSENAL_PITCHES_PER_TYPE) continue;
    const current = byPitcher.get(row.key) ?? [];
    current.push(row);
    byPitcher.set(row.key, current);
  }

  const profiles = Array.from(byPitcher.entries())
    .map(([key, pitchRows]) => {
      const totalPitches = pitchRows.reduce((sum, row) => sum + row.pitches, 0);
      return { key, pitchRows, totalPitches };
    })
    .filter(
      (profile) =>
        profile.totalPitches >= MIN_ARSENAL_TOTAL_PITCHES &&
        profile.pitchRows.length >= MIN_ARSENAL_PITCH_TYPES
    );
  if (profiles.length < 3) return empty;

  const featureDefs: Array<{
    key: string;
    label: string;
    pitchType: ArsenalPitchType;
    metric: DnaMetricColumn | 'Usage';
    presentMean: number;
  }> = [];
  for (const pitchType of ARSENAL_PITCH_TYPES) {
    const pitchRows = profiles
      .map((profile) => profile.pitchRows.find((row) => row.pitchType === pitchType))
      .filter((row): row is ArsenalPitchRow => Boolean(row));
    if (pitchRows.length < 3) continue;
    featureDefs.push({
      key: `${pitchType}|Usage`,
      label: `${pitchType} Usage`,
      pitchType,
      metric: 'Usage',
      presentMean: 0,
    });
    for (const metric of DNA_METRIC_COLUMNS) {
      const values = pitchRows
        .map((row) => normalizeForHandedness(row)[metric])
        .filter((value): value is number => Number.isFinite(value));
      if (values.length < 3) continue;
      featureDefs.push({
        key: `${pitchType}|${metric}`,
        label: `${pitchType} ${DNA_METRIC_LABELS[metric]}`,
        pitchType,
        metric,
        presentMean: values.reduce((sum, value) => sum + value, 0) / values.length,
      });
    }
  }
  if (featureDefs.length < 2) return empty;

  const rawMatrix = profiles.map((profile) =>
    featureDefs.map((feature) => {
      const row = profile.pitchRows.find((pitchRow) => pitchRow.pitchType === feature.pitchType);
      if (feature.metric === 'Usage') return row ? (row.pitches / profile.totalPitches) * 100 : 0;
      if (!row) return feature.presentMean;
      return normalizeForHandedness(row)[feature.metric] ?? feature.presentMean;
    })
  );
  const means = featureDefs.map((_, featureIndex) =>
    rawMatrix.reduce((sum, values) => sum + values[featureIndex], 0) / profiles.length
  );
  const stds = featureDefs.map((_, featureIndex) => {
    const variance =
      rawMatrix.reduce((sum, values) => sum + (values[featureIndex] - means[featureIndex]) ** 2, 0) /
      Math.max(1, profiles.length - 1);
    return Math.sqrt(variance) || 1;
  });
  const standardized = rawMatrix.map((values) =>
    values.map((value, featureIndex) => (value - means[featureIndex]) / stds[featureIndex])
  );

  const featureCount = featureDefs.length;
  const cov = Array.from({ length: featureCount }, () => Array.from({ length: featureCount }, () => 0));
  for (let i = 0; i < featureCount; i += 1) {
    for (let j = i; j < featureCount; j += 1) {
      let sum = 0;
      for (let rowIndex = 0; rowIndex < standardized.length; rowIndex += 1) {
        sum += standardized[rowIndex][i] * standardized[rowIndex][j];
      }
      const value = sum / Math.max(1, standardized.length - 1);
      cov[i][j] = value;
      cov[j][i] = value;
    }
  }
  const { vectors, values } = jacobiEigenDecomposition(cov);
  const pc1Vector = vectors[0] ?? featureDefs.map(() => 0);
  const pc2Vector = vectors[1] ?? featureDefs.map(() => 0);
  const points = profiles.map((profile, profileIndex): DnaPoint => {
    const firstRow = profile.pitchRows[0];
    const arsenalFeatureValues: Record<string, number> = {};
    const arsenalFeatureZScores: Record<string, number> = {};
    featureDefs.forEach((feature, featureIndex) => {
      arsenalFeatureValues[feature.key] = rawMatrix[profileIndex][featureIndex];
      arsenalFeatureZScores[feature.key] = standardized[profileIndex][featureIndex];
    });
    return {
      key: profile.key,
      pitcher: firstRow.pitcher,
      teamCode: firstRow.teamCode,
      teamLabel: firstRow.teamLabel,
      pc1: standardized[profileIndex].reduce((sum, value, featureIndex) => sum + value * pc1Vector[featureIndex], 0),
      pc2: standardized[profileIndex].reduce((sum, value, featureIndex) => sum + value * pc2Vector[featureIndex], 0),
      metrics: {},
      zScores: {},
      arsenalFeatureValues,
      arsenalFeatureZScores,
      similarityVector: standardized[profileIndex],
      repertoire: profile.pitchRows
        .slice()
        .sort((a, b) => b.pitches - a.pitches)
        .map((row) => row.pitchType),
      poolSource: firstRow.poolSource,
    };
  });
  const loadings = featureDefs.map((feature, featureIndex) => ({
    key: feature.key,
    label: feature.label,
    pc1: pc1Vector[featureIndex] ?? 0,
    pc2: pc2Vector[featureIndex] ?? 0,
  }));
  const totalVariance = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  return {
    points,
    loadings,
    varianceExplainedPct: {
      pc1: (Math.max(0, values[0] ?? 0) / totalVariance) * 100,
      pc2: (Math.max(0, values[1] ?? 0) / totalVariance) * 100,
    },
  };
}

function PitcherDnaPanel({
  filters,
  startDate,
  endDate,
  sharedFilterParams,
  selectedSchoolCode,
  isPro,
  isLeague,
  level,
  selectedPitchTypes,
  onNavigateToPitcher,
  onNavigateToTeam,
}: {
  filters: FiltersPayload | null;
  startDate: string;
  endDate: string;
  sharedFilterParams: URLSearchParams;
  selectedSchoolCode: string;
  isPro: boolean;
  isLeague: boolean;
  level: string;
  selectedPitchTypes: string[];
  onNavigateToPitcher: (pitcherName: string) => void;
  onNavigateToTeam: (teamCode: string) => void;
}) {
  const [rows, setRows] = useState<DnaPitcherRow[]>([]);
  const [arsenalRows, setArsenalRows] = useState<ArsenalPitchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredPitcher, setHoveredPitcher] = useState<string | null>(null);
  // Clicking a dot (or a "Most Similar" entry) pins the side panel to that
  // pitcher so it stays put while the mouse moves elsewhere -- hover alone
  // used to be the only way to populate the panel, which meant moving your
  // cursor toward the panel to click something in it un-hovered the dot and
  // made the whole panel disappear before you could click anything in it.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const searchRootRef = useRef<HTMLDivElement | null>(null);
  // Displayed to the user as "Pitch" -- the underlying literal stays 'Player'
  // since it's branched on throughout this component (and elsewhere in this
  // file 'Player' is coincidentally also a distinct value of the unrelated
  // leaderboardViewBy state), so only the button label changes.
  const [viewBy, setViewBy] = useState<'Player' | 'Team' | 'Arsenal'>('Player');
  const isArsenalView = viewBy === 'Arsenal';
  // "Team" compares within the same roster (teammates, or other teams for the
  // Team tab); "MLB" pulls in a second pool of school_code=PRO pitchers, "D1"
  // pulls in school_code=LEAGUE&level=D1 (same date/hand filters) so
  // nearest-neighbor matching can be restricted to that pool instead of
  // teammates. Comparing a pool against itself is meaningless, so MLB is
  // hidden while viewing the PRO site and D1 is hidden while viewing LEAGUE.
  const [compareMode, setCompareMode] = useState<'Team' | 'MLB' | 'D1'>('Team');
  const canCompareMlb = !isPro;
  const canCompareD1 = !isLeague;
  // Covers MLB comparison on ANY tab (Pitch/Team/Arsenal) -- needed anywhere
  // MLB team logos should resolve regardless of which tab the comparison was
  // opened from, not just Arsenal.
  const isMlbCompareActive = compareMode === 'MLB';
  // Snap back to Team if the active mode becomes unavailable (e.g. the user
  // switches to the PRO or LEAGUE site while MLB/D1 compare was active).
  useEffect(() => {
    if (compareMode === 'MLB' && !canCompareMlb) setCompareMode('Team');
    if (compareMode === 'D1' && !canCompareD1) setCompareMode('Team');
  }, [compareMode, canCompareMlb, canCompareD1]);
  // Real MLB pitcher -> team lookup for the MLB comparison pool (fetched
  // separately since /v1/pitching/filters?school_code=PRO returns team-scoped
  // rosters, and the arsenal table-rollup rows carry no per-pitcher team code).
  const [mlbPitcherTeamByName, setMlbPitcherTeamByName] = useState<Map<string, { teamCode: string; teamLabel: string }>>(
    new Map()
  );
  // Same idea for the D1 comparison pool, via /v1/pitching/filters?school_code=LEAGUE&level=D1.
  const [d1PitcherTeamByName, setD1PitcherTeamByName] = useState<Map<string, { teamCode: string; teamLabel: string }>>(
    new Map()
  );
  const [showArsenalComparison, setShowArsenalComparison] = useState(false);
  const [isExportingArsenalComparison, setIsExportingArsenalComparison] = useState(false);
  const [chartTitle, setChartTitle] = useState('Pitcher DNA');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [isLightTheme, setIsLightTheme] = useState(false);
  const [logoDataUri, setLogoDataUri] = useState<string | null>(null);
  const [teamLogoDataUris, setTeamLogoDataUris] = useState<Map<string, string>>(new Map());
  const svgRef = useRef<SVGSVGElement | null>(null);
  const arsenalComparisonRef = useRef<HTMLElement | null>(null);
  const sharedFilterParamsKey = sharedFilterParams.toString();

  const normalizePitcherKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  // Maps a pitcher's display name to their team code / label, so same-named
  // pitchers on different teams (a real occurrence on League/Pro) can be told
  // apart -- used for unique React keys, the hover tooltip, and click-to-Summary.
  const pitcherTeamByName = useMemo(() => {
    const lookup = new Map<string, { teamCode: string; teamLabel: string }>();
    const byTeamCode = filters?.pitchers_by_team_code;
    if (byTeamCode && Object.keys(byTeamCode).length > 0) {
      for (const [teamCode, names] of Object.entries(byTeamCode)) {
        const teamLabel = isPro
          ? getProTeamDisplayName(teamCode, (level as 'MLB' | 'AAA' | 'All') || 'All')
          : (LEAGUE_TEAM_NAME_BY_CODE[teamCode.toUpperCase()] ?? teamCode);
        for (const name of names ?? []) {
          const key = normalizePitcherKey(name);
          if (key) lookup.set(key, { teamCode, teamLabel });
        }
      }
    }
    return lookup;
  }, [filters?.pitchers_by_team_code, isPro, level]);

  const resolvePitcherTeam = useCallback(
    (pitcherName: string): { teamCode: string; teamLabel: string } => {
      const fromLookup = pitcherTeamByName.get(normalizePitcherKey(pitcherName));
      if (fromLookup) return fromLookup;
      // Single-team sites (a college) -- every pitcher belongs to the school itself.
      const fallbackCode = String(filters?.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase();
      return { teamCode: fallbackCode, teamLabel: fallbackCode };
    },
    [pitcherTeamByName, filters?.school_code, selectedSchoolCode]
  );

  // Resolves which logo (if any) to show for a given team code: Pro team
  // logos on the Pro site (or a college site's MLB comparison matches, which
  // resolve to a real MLB team code via mlbPitcherTeamByName), or the PCU logo
  // for PCU's own single-school site (every pitcher there belongs to "PCU"
  // via resolvePitcherTeam's fallback).
  const resolveTeamLogo = useCallback(
    (teamCode: string): string | undefined => {
      if (isPro || isMlbCompareActive) return teamLogoDataUris.get(teamCode);
      if (teamCode === 'PCU') return logoDataUri ?? undefined;
      return undefined;
    },
    [isPro, isMlbCompareActive, teamLogoDataUris, logoDataUri]
  );

  // Inline the logo as a data URI (rather than an <image href="/...">) so it's
  // guaranteed to render both on-screen and when the SVG is serialized/redrawn
  // to a canvas for PNG export -- a plain path reference can silently fail or
  // taint the canvas in that export path.
  useEffect(() => {
    let active = true;
    fetch('/pearl-clam-transparent.png')
      .then((res) => res.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('Failed to read logo image.'));
            reader.readAsDataURL(blob);
          })
      )
      .then((dataUri) => {
        if (active) setLogoDataUri(dataUri);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const syncTheme = () => setIsLightTheme(document.body.classList.contains('theme-light'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isArsenalView || !filters || !startDate || !endDate) return;
    let active = true;
    const controller = new AbortController();

    const buildParams = (handOverride: 'R' | 'L' | null) => {
      const params = new URLSearchParams(sharedFilterParamsKey);
      params.set('start_date', startDate);
      params.set('end_date', endDate);
      params.set('split_by', 'Pitcher');
      params.set('table_mode', 'Custom');
      params.set('custom_columns', ['#', ...DNA_METRIC_COLUMNS].join(','));
      params.set('include_chart_points', '0');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
      params.delete('visual_option');
      // The backend's `hand` param expects the full word ("Right"/"Left"), not
      // a single-letter code -- matches canonicalizeHandLabel's convention
      // used everywhere else in this file.
      if (handOverride) params.set('hand', handOverride === 'R' ? 'Right' : 'Left');
      return params;
    };

    const parseTableRows = (payload: Partial<OverviewPayload> | null, throwsHand: 'R' | 'L'): DnaPitcherRow[] => {
      const tableRows = Array.isArray(payload?.table_rows) ? (payload!.table_rows as Array<Record<string, string | number | null>>) : [];
      return tableRows
        .map((row) => {
          const pitcherName = String(row.Pitcher ?? row.pitcher ?? '').trim();
          if (!pitcherName || pitcherName.toLowerCase() === 'all') return null;
          const pitches = parseSortableNumber(row['#']) ?? 0;
          const metrics: Partial<Record<DnaMetricColumn, number>> = {};
          for (const col of DNA_METRIC_COLUMNS) {
            const parsed = parseSortableNumber(row[col]);
            if (parsed !== null) metrics[col] = parsed;
          }
          const { teamCode, teamLabel } = resolvePitcherTeam(pitcherName);
          return {
            key: `${normalizePitcherKey(pitcherName)}::${teamCode}`,
            pitcher: pitcherName,
            teamCode,
            teamLabel,
            metrics,
            pitches,
            throwsHand,
          };
        })
        .filter((row): row is DnaPitcherRow => row !== null);
    };

    // Fetch right- and left-handed pitchers separately (mirroring the sidebar's
    // own hand filter, or split R/L when it's set to All) so each pitcher's
    // handedness is known -- needed to flip HB / Release Side into a
    // hand-neutral orientation before PCA (see normalizeForHandedness).
    const requestedHandRaw = new URLSearchParams(sharedFilterParamsKey).get('hand');
    const requestedHand: 'R' | 'L' | null =
      requestedHandRaw === 'Right' ? 'R' : requestedHandRaw === 'Left' ? 'L' : null;
    const handsToFetch: Array<'R' | 'L'> = requestedHand ? [requestedHand] : ['R', 'L'];

    Promise.resolve()
      .then(() => {
        if (!active) return null;
        setLoading(true);
        setErrorMessage('');
        return Promise.all(
          handsToFetch.map((handValue) =>
            fetch(`/api/dashboard/pitching/overview?${buildParams(requestedHand ? null : handValue).toString()}`, {
              signal: controller.signal,
              cache: 'no-store',
            }).then((res) => (res.ok ? res.json() : null))
          )
        );
      })
      .then((payloads: Array<Partial<OverviewPayload> | null> | null) => {
        if (!active || !payloads) return;
        const mergedRows = handsToFetch.flatMap((handValue, i) => parseTableRows(payloads[i], handValue));
        // A pitcher can occasionally show up twice under the same name+team key
        // (e.g. inconsistent handedness tagging across appearances causing them
        // to land in both the Right and Left fetches, or duplicate roster
        // entries upstream). Keep the row with the larger sample so the chart
        // never renders two dots -- and two React children -- for one key.
        const byKey = new Map<string, DnaPitcherRow>();
        for (const row of mergedRows) {
          const existing = byKey.get(row.key);
          if (!existing || row.pitches > existing.pitches) byKey.set(row.key, row);
        }
        setRows(Array.from(byKey.values()));
      })
      .catch((err) => {
        if (!active || (err && err.name === 'AbortError')) return;
        setErrorMessage('Failed to load Pitcher DNA data.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [filters, startDate, endDate, sharedFilterParamsKey, resolvePitcherTeam, isArsenalView]);

  // Comparison pool for the Pitch and Team tabs (Arsenal has its own separate
  // fetch below, since it uses a different split_by and row shape). Fetches
  // school_code=PRO for MLB mode or school_code=LEAGUE&level=D1 for D1 mode --
  // structurally only one pool is ever in flight, since compareMode is a
  // single value and this effect no-ops entirely in Team mode.
  const [comparePoolRows, setComparePoolRows] = useState<DnaPitcherRow[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  useEffect(() => {
    if (isArsenalView || compareMode === 'Team' || !filters || !startDate || !endDate) {
      setComparePoolRows([]);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const poolSchoolCode = compareMode === 'MLB' ? 'PRO' : 'LEAGUE';
    const poolLevel = compareMode === 'MLB' ? 'MLB' : 'D1';

    const buildPoolParams = (handValue: 'R' | 'L') => {
      const params = new URLSearchParams(sharedFilterParamsKey);
      params.set('school_code', poolSchoolCode);
      params.set('start_date', startDate);
      params.set('end_date', endDate);
      params.set('split_by', 'Pitcher');
      params.set('custom_columns', ['#', ...DNA_METRIC_COLUMNS].join(','));
      params.set('hand', handValue === 'R' ? 'Right' : 'Left');
      params.set('level', poolLevel);
      // Keep pitch_types so the pool is scoped to the same pitch type(s) as
      // the own-school rows, not the pool's whole arsenal. Always drop
      // team_type: the site's own team code isn't a real PRO/LEAGUE team and
      // passing it through makes the backend 500 instead of ignoring it (same
      // hazard the Arsenal fetch below already works around).
      params.delete('team_type');
      // Comparison pools (MLB and D1) are always the pool's own full data,
      // never scoped by the site's own Session Type filter -- comparing an
      // LSU pitcher's Season-only data should compare against all of D1/MLB,
      // not just their own Season-tagged sessions. MLB's rollup also has no
      // bullpen/season distinction at all (pro data has no such column), so
      // this param would be silently ignored there anyway.
      params.delete('session_type');
      return params;
    };

    // The D1/NCAA rollup includes this same site's own roster (a college site
    // is itself part of the D1 universe), so a pitcher can appear in BOTH the
    // own-school pool and the D1 comparison pool as two rows for the same
    // real person -- without this exclusion, "most similar D1 pitcher" could
    // literally be yourself. Own-roster names come from filters.pitchers
    // (the same trusted roster list used elsewhere in this file).
    const ownRosterNames = new Set((filters.pitchers ?? []).map((name) => normalizePitcherKey(name)));

    const parsePoolRows = (payload: { table_rows?: Array<Record<string, string | number | null>> } | null, throwsHand: 'R' | 'L'): DnaPitcherRow[] => {
      const tableRows = Array.isArray(payload?.table_rows) ? payload.table_rows : [];
      return tableRows
        .map((row): DnaPitcherRow | null => {
          const pitcherName = String(row.Pitcher ?? '').trim();
          if (!pitcherName || pitcherName.toLowerCase() === 'all') return null;
          if (compareMode === 'D1' && ownRosterNames.has(normalizePitcherKey(pitcherName))) return null;
          const pitches = parseSortableNumber(row['#']) ?? 0;
          const metrics: Partial<Record<DnaMetricColumn, number>> = {};
          for (const metric of DNA_METRIC_COLUMNS) {
            const value = parseSortableNumber(row[metric]);
            if (value !== null) metrics[metric] = value;
          }
          // split_by=Pitcher returns no team column, so MLB/D1 names resolve
          // via the same name -> team lookups Arsenal already uses.
          const { teamCode, teamLabel } =
            compareMode === 'MLB'
              ? mlbPitcherTeamByName.get(normalizePitcherKey(pitcherName)) ?? { teamCode: 'MLB', teamLabel: 'MLB' }
              : d1PitcherTeamByName.get(normalizePitcherKey(pitcherName)) ?? { teamCode: 'D1', teamLabel: 'NCAA D1' };
          return {
            key: `${normalizePitcherKey(pitcherName)}::${teamCode}::${compareMode.toLowerCase()}`,
            pitcher: pitcherName,
            teamCode,
            teamLabel,
            metrics,
            pitches,
            throwsHand,
            poolSource: compareMode as DnaPoolSource,
          };
        })
        .filter((row): row is DnaPitcherRow => row !== null);
    };

    const requestedHandRaw = new URLSearchParams(sharedFilterParamsKey).get('hand');
    const requestedHand: 'R' | 'L' | null =
      requestedHandRaw === 'Right' ? 'R' : requestedHandRaw === 'Left' ? 'L' : null;
    const handsToFetch: Array<'R' | 'L'> = requestedHand ? [requestedHand] : ['R', 'L'];

    setPoolLoading(true);
    Promise.all(
      handsToFetch.map((handValue) =>
        fetch(`/api/dashboard/pitching/table-rollup?${buildPoolParams(handValue).toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        }).then((response) => (response.ok ? response.json() : null))
      )
    )
      .then((payloads) => {
        if (!active) return;
        setComparePoolRows(handsToFetch.flatMap((handValue, index) => parsePoolRows(payloads[index], handValue)));
      })
      .catch((error) => {
        if (!active || (error && error.name === 'AbortError')) return;
        setComparePoolRows([]);
      })
      .finally(() => {
        if (active) setPoolLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [isArsenalView, compareMode, filters, startDate, endDate, sharedFilterParamsKey, mlbPitcherTeamByName, d1PitcherTeamByName]);

  useEffect(() => {
    if (compareMode !== 'MLB' || mlbPitcherTeamByName.size > 0) return;
    let active = true;
    fetch('/api/dashboard/pitching/mlb-team-map', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { pitchers_by_team_code?: Record<string, string[]> } | null) => {
        if (!active || !payload?.pitchers_by_team_code) return;
        const lookup = new Map<string, { teamCode: string; teamLabel: string }>();
        for (const [teamCode, names] of Object.entries(payload.pitchers_by_team_code)) {
          const teamLabel = getProTeamDisplayName(teamCode, 'MLB');
          for (const name of names ?? []) {
            const key = normalizePitcherKey(name);
            if (key) lookup.set(key, { teamCode, teamLabel });
          }
        }
        if (lookup.size > 0) setMlbPitcherTeamByName(lookup);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [compareMode, mlbPitcherTeamByName.size]);

  useEffect(() => {
    if (compareMode !== 'D1' || d1PitcherTeamByName.size > 0) return;
    let active = true;
    fetch('/api/dashboard/pitching/d1-team-map', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { pitchers_by_team_code?: Record<string, string[]> } | null) => {
        if (!active || !payload?.pitchers_by_team_code) return;
        const lookup = new Map<string, { teamCode: string; teamLabel: string }>();
        for (const [teamCode, names] of Object.entries(payload.pitchers_by_team_code)) {
          // "Use their school name and if we don't have a school name, use
          // their team code" -- schoolNameFromTeamCodeFallback resolves the
          // real display name via LEAGUE_TEAM_NAME_BY_CODE (with a couple of
          // fallback strategies of its own); an empty result falls through to
          // the raw team code itself, never the generic "NCAA D1" label.
          const teamLabel = schoolNameFromTeamCodeFallback(teamCode) || teamCode;
          for (const name of names ?? []) {
            const key = normalizePitcherKey(name);
            if (key) lookup.set(key, { teamCode, teamLabel });
          }
        }
        if (lookup.size > 0) setD1PitcherTeamByName(lookup);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [compareMode, d1PitcherTeamByName.size]);

  useEffect(() => {
    if (!isArsenalView || !filters || !startDate || !endDate) return;
    let active = true;
    const controller = new AbortController();
    const requestedHandRaw = new URLSearchParams(sharedFilterParamsKey).get('hand');
    const requestedHand: 'R' | 'L' | null =
      requestedHandRaw === 'Right' ? 'R' : requestedHandRaw === 'Left' ? 'L' : null;
    const handsToFetch: Array<'R' | 'L'> = requestedHand ? [requestedHand] : ['R', 'L'];

    // filters.pitchers_by_team_code is the trusted roster list for the
    // sidebar's team dropdown; the API's own team_type param instead matches
    // against each pitch row's raw pitcherteam text, which for some rows is
    // the full school name ("Grand Canyon University") rather than the short
    // code ("GCU") -- that mismatch silently drops real roster pitchers when
    // filtered server-side. So the own-team fetch below is unfiltered by team
    // (matching what "All" already does) and instead filtered here, client-side,
    // against the roster list -- this also drops opponents/campers that "All"
    // otherwise pulls in.
    const currentTeamType = String(new URLSearchParams(sharedFilterParamsKey).get('team_type') ?? '').trim();
    const rosterNamesForCurrentTeam =
      currentTeamType && currentTeamType.toLowerCase() !== 'all'
        ? new Set((filters.pitchers_by_team_code?.[currentTeamType] ?? []).map((name) => normalizePitcherKey(name)))
        : null;
    // Full own-site roster (not just the currently-filtered team) for
    // excluding self-matches from the D1 pool -- see the D1 branch below.
    const ownRosterNamesForArsenal = new Set((filters.pitchers ?? []).map((name) => normalizePitcherKey(name)));

    const buildParams = (handValue: 'R' | 'L', schoolCodeOverride?: string) => {
      const params = new URLSearchParams(sharedFilterParamsKey);
      params.set('school_code', (schoolCodeOverride ?? String(filters.school_code ?? selectedSchoolCode)).trim().toUpperCase());
      params.set('start_date', startDate);
      params.set('end_date', endDate);
      params.set('split_by', 'Pitcher Arsenal');
      params.set('custom_columns', ['P', ...DNA_METRIC_COLUMNS].join(','));
      params.set('hand', handValue === 'R' ? 'Right' : 'Left');
      // Comparison pools always mean the pool's own level (MLB, D1) regardless
      // of the college site's own level filter, which doesn't apply to that pool.
      if (schoolCodeOverride === 'PRO') params.set('level', 'MLB');
      else if (schoolCodeOverride === 'LEAGUE') params.set('level', 'D1');
      else if (level) params.set('level', level);
      params.delete('pitch_types');
      // Always drop team_type: for the own-team pool it's filtered client-side
      // instead (see rosterNamesForCurrentTeam above); for the MLB/D1 pool, the
      // site's own team code (e.g. "PCU") isn't a real MLB/LEAGUE team and
      // passing it through made the backend 500 instead of just ignoring it.
      params.delete('team_type');
      // Comparison pools (MLB and D1) are always the pool's own full data,
      // never scoped by the site's own Session Type filter -- the own-school
      // fetch (schoolCodeOverride unset) keeps session_type as normal.
      if (schoolCodeOverride) params.delete('session_type');
      return params;
    };
    const parseArsenalRows = (
      payload: { table_rows?: Array<Record<string, string | number | null>> } | null,
      throwsHand: 'R' | 'L',
      poolSource: DnaPoolSource | undefined
    ): ArsenalPitchRow[] => {
      const tableRows = Array.isArray(payload?.table_rows) ? payload.table_rows : [];
      return tableRows
        .map((row): ArsenalPitchRow | null => {
          const pitcherName = String(row.Pitcher ?? '').trim();
          const rawPitchType = String(row.Pitch ?? '').trim();
          const pitchType = ARSENAL_PITCH_TYPES.find(
            (candidate) => candidate.toLowerCase() === rawPitchType.toLowerCase()
          );
          if (!pitcherName || pitcherName.toLowerCase() === 'all' || !pitchType) return null;
          if (!poolSource && rosterNamesForCurrentTeam && !rosterNamesForCurrentTeam.has(normalizePitcherKey(pitcherName))) {
            return null;
          }
          // The D1/NCAA rollup includes this site's own roster (a college site
          // is itself part of the D1 universe), so without this exclusion a
          // pitcher's own arsenal could be suggested as its own closest D1 match.
          if (poolSource === 'D1' && ownRosterNamesForArsenal.has(normalizePitcherKey(pitcherName))) return null;
          const pitches = parseSortableNumber(row.P) ?? 0;
          const metrics: Partial<Record<DnaMetricColumn, number>> = {};
          for (const metric of DNA_METRIC_COLUMNS) {
            const value = parseSortableNumber(row[metric]);
            if (value !== null) metrics[metric] = value;
          }
          // The Pitcher Arsenal split doesn't return a team code per pitcher
          // (only Team/Pitcher Team splits do, and those are aggregated by
          // team, not per-pitcher), so the real MLB/D1 team comes from a
          // separate name -> team lookup fetched once when that compare mode
          // turns on (mlbPitcherTeamByName / d1PitcherTeamByName).
          const { teamCode, teamLabel } =
            poolSource === 'MLB'
              ? mlbPitcherTeamByName.get(normalizePitcherKey(pitcherName)) ?? { teamCode: 'MLB', teamLabel: 'MLB' }
              : poolSource === 'D1'
                ? d1PitcherTeamByName.get(normalizePitcherKey(pitcherName)) ?? { teamCode: 'D1', teamLabel: 'NCAA D1' }
                : resolvePitcherTeam(pitcherName);
          return {
            key: `${normalizePitcherKey(pitcherName)}::${teamCode}${poolSource ? `::${poolSource.toLowerCase()}` : ''}`,
            pitcher: pitcherName,
            teamCode,
            teamLabel,
            metrics,
            pitches,
            throwsHand,
            pitchType,
            poolSource,
          };
        })
        .filter((row): row is ArsenalPitchRow => row !== null);
    };

    setLoading(true);
    setErrorMessage('');
    const fetchPool = (schoolCodeOverride: string | undefined, poolSource: DnaPoolSource | undefined) =>
      Promise.all(
        handsToFetch.map((handValue) =>
          fetch(`/api/dashboard/pitching/table-rollup?${buildParams(handValue, schoolCodeOverride).toString()}`, {
            signal: controller.signal,
            cache: 'no-store',
          }).then((response) => (response.ok ? response.json() : null))
        )
      ).then((payloads) => handsToFetch.flatMap((handValue, index) => parseArsenalRows(payloads[index], handValue, poolSource)));

    const poolSchool = compareMode === 'MLB' ? 'PRO' : compareMode === 'D1' ? 'LEAGUE' : undefined;

    Promise.all([
      fetchPool(undefined, undefined),
      poolSchool ? fetchPool(poolSchool, compareMode as DnaPoolSource) : Promise.resolve([]),
    ])
      .then(([ownRows, poolRows]) => {
        if (!active) return;
        const merged = [...ownRows, ...poolRows];
        const byPitcherAndType = new Map<string, ArsenalPitchRow>();
        for (const row of merged) {
          const key = `${row.key}::${row.pitchType}`;
          const existing = byPitcherAndType.get(key);
          if (!existing || row.pitches > existing.pitches) byPitcherAndType.set(key, row);
        }
        setArsenalRows(Array.from(byPitcherAndType.values()));
      })
      .catch((error) => {
        if (!active || (error && error.name === 'AbortError')) return;
        setErrorMessage('Failed to load Arsenal DNA data.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [endDate, filters, isArsenalView, compareMode, level, mlbPitcherTeamByName, d1PitcherTeamByName, resolvePitcherTeam, selectedSchoolCode, sharedFilterParamsKey, startDate]);

  const isSinglePitchTypeScope = useMemo(
    () => selectedPitchTypes.filter((value) => value.trim() && value.trim().toLowerCase() !== 'all').length === 1,
    [selectedPitchTypes]
  );

  // On-demand "Compare Movement" data for the Pitch tab -- unlike Arsenal
  // (which always fetches every pitch type for every pitcher up front), the
  // Pitch tab only fetches arsenal-shaped rows for the 4 pitchers actually
  // being compared (the highlighted point + its 3 nearest matches), scoped to
  // the single pitch type currently filtered (isSinglePitchTypeScope) -- this
  // is what the user asked for: "the same button... but only show the
  // filtered pitch type." Fetched only when the button is clicked, not
  // eagerly, so viewing the Pitch tab never doubles the data fetched.
  const [pitchComparisonRows, setPitchComparisonRows] = useState<ArsenalPitchRow[]>([]);
  const [pitchComparisonLoading, setPitchComparisonLoading] = useState(false);
  const fetchPitchComparisonRows = useCallback(
    async (targets: DnaPoint[]) => {
      if (!filters || !startDate || !endDate || !isSinglePitchTypeScope) return;
      const pitchTypeRaw = selectedPitchTypes.find((value) => value.trim() && value.trim().toLowerCase() !== 'all') ?? '';
      setPitchComparisonLoading(true);
      try {
        // Group targets by pool source so each group can be fetched with the
        // right school_code/level (own school, MLB, or D1) in one request.
        const bySource = new Map<'own' | DnaPoolSource, DnaPoint[]>();
        for (const target of targets) {
          const sourceKey = target.poolSource ?? 'own';
          const list = bySource.get(sourceKey) ?? [];
          list.push(target);
          bySource.set(sourceKey, list);
        }

        const requestedHandRaw = new URLSearchParams(sharedFilterParamsKey).get('hand');
        const requestedHand: 'R' | 'L' | null =
          requestedHandRaw === 'Right' ? 'R' : requestedHandRaw === 'Left' ? 'L' : null;
        const handsToFetch: Array<'R' | 'L'> = requestedHand ? [requestedHand] : ['R', 'L'];

        const allRows: ArsenalPitchRow[] = [];
        for (const [sourceKey, sourceTargets] of bySource.entries()) {
          const schoolCodeOverride = sourceKey === 'MLB' ? 'PRO' : sourceKey === 'D1' ? 'LEAGUE' : undefined;
          const params = handsToFetch.map((handValue) => {
            const p = new URLSearchParams(sharedFilterParamsKey);
            p.set('school_code', (schoolCodeOverride ?? String(filters.school_code ?? selectedSchoolCode)).trim().toUpperCase());
            p.set('start_date', startDate);
            p.set('end_date', endDate);
            p.set('split_by', 'Pitcher Arsenal');
            p.set('custom_columns', ['P', ...DNA_METRIC_COLUMNS].join(','));
            p.set('hand', handValue === 'R' ? 'Right' : 'Left');
            p.set('pitch_types', pitchTypeRaw);
            if (schoolCodeOverride === 'PRO') p.set('level', 'MLB');
            else if (schoolCodeOverride === 'LEAGUE') p.set('level', 'D1');
            else if (level) p.set('level', level);
            p.delete('team_type');
            // Comparison pools (MLB and D1) are always the pool's own full
            // data, never scoped by the site's own Session Type filter.
            if (schoolCodeOverride) p.delete('session_type');
            return p;
          });
          const payloads = await Promise.all(
            params.map((p) => fetch(`/api/dashboard/pitching/table-rollup?${p.toString()}`, { cache: 'no-store' }).then((res) => (res.ok ? res.json() : null)))
          );
          const targetNames = new Set(sourceTargets.map((t) => normalizePitcherKey(t.pitcher)));
          for (const payload of payloads) {
            const tableRows = Array.isArray(payload?.table_rows) ? (payload.table_rows as Array<Record<string, string | number | null>>) : [];
            for (const row of tableRows) {
              const pitcherName = String(row.Pitcher ?? '').trim();
              const rawPitchType = String(row.Pitch ?? '').trim();
              const pitchType = ARSENAL_PITCH_TYPES.find((candidate) => candidate.toLowerCase() === rawPitchType.toLowerCase());
              if (!pitcherName || !pitchType || !targetNames.has(normalizePitcherKey(pitcherName))) continue;
              const pitches = parseSortableNumber(row.P) ?? 0;
              const metrics: Partial<Record<DnaMetricColumn, number>> = {};
              for (const metric of DNA_METRIC_COLUMNS) {
                const value = parseSortableNumber(row[metric]);
                if (value !== null) metrics[metric] = value;
              }
              const match = sourceTargets.find((t) => normalizePitcherKey(t.pitcher) === normalizePitcherKey(pitcherName));
              allRows.push({
                key: match?.key ?? `${normalizePitcherKey(pitcherName)}::${match?.teamCode ?? ''}`,
                pitcher: pitcherName,
                teamCode: match?.teamCode ?? '',
                teamLabel: match?.teamLabel ?? '',
                metrics,
                pitches,
                throwsHand: requestedHand ?? 'R',
                pitchType,
                poolSource: sourceKey === 'own' ? undefined : sourceKey,
              });
            }
          }
        }
        setPitchComparisonRows(allRows);
      } catch {
        setPitchComparisonRows([]);
      } finally {
        setPitchComparisonLoading(false);
      }
    },
    [filters, startDate, endDate, isSinglePitchTypeScope, selectedPitchTypes, sharedFilterParamsKey, level, selectedSchoolCode]
  );

  const pcaInputRows = useMemo(() => {
    if (viewBy === 'Team') {
      // Aggregated separately per source (not merged first) so a shared team
      // code between own-school and pool rows can never blend into one row --
      // aggregateRowsByTeam's own poolSource-namespaced key would prevent a
      // collision either way, but this keeps the own-team result identical to
      // calling it alone, and makes the two aggregations easy to reason about.
      return [...aggregateRowsByTeam(rows), ...aggregateRowsByTeam(comparePoolRows)];
    }
    return [...rows, ...comparePoolRows];
  }, [rows, comparePoolRows, viewBy]);

  const standardPca = useMemo(
    () => computePitcherDnaPca(pcaInputRows, [...DNA_METRIC_COLUMNS], isSinglePitchTypeScope),
    [pcaInputRows, isSinglePitchTypeScope]
  );
  const arsenalPca = useMemo(() => computeArsenalDnaPca(arsenalRows), [arsenalRows]);
  // Includes comparison-pool (MLB/D1) points when a pool was fetched -- needed
  // so nearest-neighbor matching can resolve them, even though they're
  // excluded from the plotted scatter below (visiblePoints) to keep the chart
  // showing just this team's own roster.
  const points = viewBy === 'Arsenal' ? arsenalPca.points : standardPca.points;
  const visiblePoints = useMemo(() => points.filter((point) => !point.poolSource), [points]);
  const loadings = standardPca.loadings;
  const varianceExplainedPct = viewBy === 'Arsenal' ? arsenalPca.varianceExplainedPct : standardPca.varianceExplainedPct;

  // On Pro, show each team's actual logo -- instead of a plain dot in Team
  // view, and next to team names in the "Most Similar" list in Player view.
  // Logos are remote (MLB CDN) so they're fetched through the existing
  // image-proxy route and inlined as data URIs, same reasoning as the PCU
  // logo above -- guarantees they render in the PNG export too, and only the
  // teams actually shown are fetched (not every MLB/AAA team up front).
  useEffect(() => {
    // On Pro sites every plotted point needs a logo. On college sites, MLB
    // comparison-pool matches (excluded from visiblePoints, so pulled from the
    // full points array) get real team codes once mlbPitcherTeamByName
    // resolves -- on ANY tab (Pitch/Team/Arsenal), not just Arsenal.
    if (!isPro && !isMlbCompareActive) return;
    const logoSourcePoints = isPro ? visiblePoints : points.filter((point) => point.poolSource === 'MLB');
    if (!logoSourcePoints.length) return;
    let active = true;
    const teamCodes = Array.from(
      new Set(logoSourcePoints.map((point) => point.teamCode).filter((code) => Boolean(code) && code !== 'MLB'))
    );
    const missing = teamCodes.filter((code) => !teamLogoDataUris.has(code));
    if (!missing.length) return;
    Promise.all(
      missing.map((teamCode) => {
        const remoteUrl = getProTeamLogoUrl(teamCode);
        if (!remoteUrl) return null;
        const proxiedUrl = `/api/dashboard/image-proxy?url=${encodeURIComponent(remoteUrl)}`;
        return fetch(proxiedUrl)
          .then((res) => (res.ok ? res.blob() : null))
          .then(
            (blob) =>
              blob &&
              new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error('Failed to read team logo.'));
                reader.readAsDataURL(blob);
              })
          )
          .then((dataUri) => (dataUri ? ([teamCode, dataUri] as const) : null))
          .catch(() => null);
      })
    ).then((entries) => {
      if (!active) return;
      const next = new Map(teamLogoDataUris);
      for (const entry of entries) {
        if (entry) next.set(entry[0], entry[1]);
      }
      setTeamLogoDataUris(next);
    });
    return () => {
      active = false;
    };
  }, [isPro, isMlbCompareActive, viewBy, points, visiblePoints, teamLogoDataUris]);

  const matchedPitcher = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return visiblePoints.find((point) => point.pitcher.toLowerCase().includes(q)) ?? null;
  }, [visiblePoints, searchQuery]);

  // All matches for the current search text, so the dropdown can list every
  // name that matches rather than silently guessing/picking just one.
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return visiblePoints.filter((point) => point.pitcher.toLowerCase().includes(q)).slice(0, 25);
  }, [visiblePoints, searchQuery]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!searchRootRef.current) return;
      if (!searchRootRef.current.contains(event.target as Node)) setIsSearchDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Priority: an active hover always wins (temporary preview of whatever's
  // under the cursor); otherwise fall back to whichever pitcher/team was
  // last clicked/selected (persists after the mouse moves away); otherwise
  // fall back to a text search match.
  const highlightedKey = hoveredPitcher ?? selectedKey ?? matchedPitcher?.key ?? null;

  // Pins the side panel to a pitcher/team without leaving the DNA page --
  // used when clicking a dot's label area or a "Most Similar" entry, so you
  // can browse between related pitchers before deciding to navigate away.
  const selectPoint = (point: DnaPoint) => {
    setSelectedKey(point.key);
    setSearchQuery('');
  };

  const handlePointClick = (point: DnaPoint) => {
    // A comparison-pool point (MLB/D1) isn't a real team/pitcher in this
    // dashboard's own filters -- navigating to it would set a nonsense
    // team/pitcher filter. Just pin the side panel to it instead.
    if (point.poolSource) {
      selectPoint(point);
      return;
    }
    if (viewBy === 'Team') onNavigateToTeam(point.teamCode);
    else onNavigateToPitcher(point.pitcher);
  };

  const bounds = useMemo(() => {
    if (!visiblePoints.length) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const xs = visiblePoints.map((point) => point.pc1);
    const ys = visiblePoints.map((point) => point.pc2);
    const pad = (min: number, max: number) => {
      const span = max - min || 1;
      return { min: min - span * 0.1, max: max + span * 0.1 };
    };
    const xPadded = pad(Math.min(...xs), Math.max(...xs));
    const yPadded = pad(Math.min(...ys), Math.max(...ys));
    return { minX: xPadded.min, maxX: xPadded.max, minY: yPadded.min, maxY: yPadded.max };
  }, [visiblePoints]);

  const width = 860;
  const height = 620;
  const marginPx = 32;
  const topMarginPx = 80;
  const toSvgX = (value: number) =>
    marginPx + ((value - bounds.minX) / (bounds.maxX - bounds.minX || 1)) * (width - marginPx * 2);
  const toSvgY = (value: number) =>
    height - marginPx - ((value - bounds.minY) / (bounds.maxY - bounds.minY || 1)) * (height - marginPx - topMarginPx);

  const standardLoadings = useMemo(() => {
    return DNA_METRIC_COLUMNS
      .map((col) => ({ key: col, label: DNA_METRIC_LABELS[col], col, ...loadings[col] }))
      .filter((entry) => Number.isFinite(entry.pc1) && Number.isFinite(entry.pc2));
  }, [loadings]);
  const allLoadings = viewBy === 'Arsenal' ? arsenalPca.loadings : standardLoadings;

  // Draw arrows for every metric, sorted strongest-first. The weakest two
  // (by combined PC1/PC2 loading) are marked "faint" and rendered lighter --
  // they barely explain this particular 2D view, so de-emphasizing them
  // keeps the strong arrows readable without hiding any metric outright.
  const FAINT_ARROW_COUNT = 2;
  const chartArrowLoadings = useMemo(() => {
    const sorted = [...allLoadings].sort(
      (a, b) => (b.pc1 * b.pc1 + b.pc2 * b.pc2) - (a.pc1 * a.pc1 + a.pc2 * a.pc2)
    );
    if (viewBy === 'Arsenal') return sorted.slice(0, 6).map((entry) => ({ ...entry, isFaint: false }));
    return sorted.map((entry, index) => ({ ...entry, isFaint: index >= sorted.length - FAINT_ARROW_COUNT }));
  }, [allLoadings, viewBy]);
  const sidebarLoadings = useMemo(() => {
    if (viewBy !== 'Arsenal') return allLoadings;
    return [...allLoadings]
      .sort((a, b) => (b.pc1 * b.pc1 + b.pc2 * b.pc2) - (a.pc1 * a.pc1 + a.pc2 * a.pc2))
      .slice(0, 10);
  }, [allLoadings, viewBy]);

  const originX = toSvgX(0);
  const originY = toSvgY(0);

  // Scale loading vectors so the longest one's tip reaches almost all the way
  // to the plot's outer edge (in pixel space, from the origin), regardless of
  // how tightly the pitcher dots are clustered. Anchoring to the dot cloud's
  // own spread (as PCA scatters are mean-centered, that cloud sits right on
  // top of the origin) meant arrows never escaped the densest part of the
  // chart -- this guarantees arrows and their labels clear the dots.
  const vectorScale = useMemo(() => {
    const plotHalfWidthPx = Math.min(originX - marginPx, width - marginPx - originX);
    const plotHalfHeightPx = Math.min(originY - topMarginPx, height - marginPx - originY);
    const availablePx = Math.max(40, Math.min(plotHalfWidthPx, plotHalfHeightPx)) * 0.8;
    const maxLoadingMag = Math.max(
      0.001,
      ...chartArrowLoadings.map((entry) => Math.sqrt(entry.pc1 * entry.pc1 + entry.pc2 * entry.pc2))
    );
    return availablePx / maxLoadingMag;
  }, [originX, originY, width, height, marginPx, topMarginPx, chartArrowLoadings]);

  const dnaChartColors = useMemo(
    () =>
      isLightTheme
        ? {
            background: '#ffffff',
            title: '#111827',
            axisLine: 'rgba(100,116,139,0.4)',
            axisLabel: '#475569',
            vector: '#1f2937',
            dot: 'rgba(37,99,235,0.4)',
            dotStroke: 'rgba(30,64,175,0.35)',
          }
        : {
            // Matches .portal-admin-card / .portal-day-card's dark background
            // (rgba(10,10,10,0.76)) so the chart card blends with the rest of
            // the dashboard instead of standing out as its own dark navy box.
            background: '#0a0a0a',
            title: '#f8fafc',
            axisLine: 'rgba(148,163,184,0.4)',
            axisLabel: '#ffffff',
            vector: '#e2e8f0',
            dot: 'rgba(56,189,248,0.5)',
            dotStroke: 'rgba(226,232,240,0.35)',
          },
    [isLightTheme]
  );

  // Spread overlapping vector labels apart along the plot's outer ring so
  // metrics whose arrows point in nearly the same direction don't stack their
  // text on top of each other.
  const vectorLabelPositions = useMemo(() => {
    const withAngle = chartArrowLoadings.map((entry) => {
      const tipX = originX + entry.pc1 * vectorScale;
      const tipY = originY - entry.pc2 * vectorScale;
      return { key: entry.key, tipX, tipY, angle: Math.atan2(tipY - originY, tipX - originX) };
    });
    withAngle.sort((a, b) => a.angle - b.angle);
    const minAngleGapRad = (30 * Math.PI) / 180;
    for (let i = 1; i < withAngle.length; i += 1) {
      const prev = withAngle[i - 1];
      const curr = withAngle[i];
      if (curr.angle - prev.angle < minAngleGapRad) {
        curr.angle = prev.angle + minAngleGapRad;
      }
    }
    const positions = new Map<string, { x: number; y: number; anchor: 'start' | 'end' }>();
    withAngle.forEach((entry) => {
      const labelRadius = Math.hypot(entry.tipX - originX, entry.tipY - originY) + 20;
      const x = originX + Math.cos(entry.angle) * labelRadius;
      const y = originY + Math.sin(entry.angle) * labelRadius;
      positions.set(entry.key, { x, y, anchor: Math.cos(entry.angle) >= 0 ? 'start' : 'end' });
    });
    return positions;
  }, [chartArrowLoadings, vectorScale, originX, originY]);

  const highlightedPoint = useMemo(() => points.find((p) => p.key === highlightedKey) ?? null, [points, highlightedKey]);

  // For the highlighted pitcher, rank metrics by how many standard deviations
  // from the cohort average their actual (handedness-normalized) value sits
  // at -- i.e. how extreme this pitcher really is on each metric. Ranking by
  // projecting through the PCA loading vectors instead breaks down whenever
  // two metrics happen to have similar loadings: they'd rank as equally
  // "driving" even if the pitcher's real values for them are very different.
  const highlightedPitcherDrivers = useMemo(() => {
    if (!highlightedPoint || viewBy === 'Arsenal') return [];
    return DNA_METRIC_COLUMNS
      .filter((col) => highlightedPoint.zScores[col] !== undefined)
      .map((col) => ({ col, zScore: highlightedPoint.zScores[col] as number }))
      .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  }, [highlightedPoint, viewBy]);
  const highlightedArsenalDrivers = useMemo(() => {
    if (!highlightedPoint || viewBy !== 'Arsenal') return [];
    const zScores = highlightedPoint.arsenalFeatureZScores ?? {};
    const rawValues = highlightedPoint.arsenalFeatureValues ?? {};
    const labels = new Map(arsenalPca.loadings.map((entry) => [entry.key, entry.label]));
    return Object.entries(zScores)
      .map(([key, zScore]) => ({ key, label: labels.get(key) ?? key, zScore, value: rawValues[key] }))
      .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))
      .slice(0, 8);
  }, [arsenalPca.loadings, highlightedPoint, viewBy]);

  const NEAREST_NEIGHBOR_COUNT = 3;

  // "Closest" = smallest straight-line distance in the same PC1/PC2 space the
  // chart itself is plotted in, so this list agrees with what you'd eyeball
  // as "sitting near" the selected dot.
  const nearestNeighbors = useMemo(() => {
    if (!highlightedPoint) return [];
    return points
      .filter((point) => point.key !== highlightedPoint.key)
      // In MLB/D1 compare mode, only match the selected pitcher/team against
      // that pool (never a teammate); in Team mode, only match within the
      // pitcher's/team's own pool (never a stray pool row).
      .filter((point) => (compareMode === 'Team' ? !point.poolSource : point.poolSource === compareMode))
      .map((point) => ({
        point,
        distance:
          viewBy === 'Arsenal' && highlightedPoint.similarityVector && point.similarityVector
            ? Math.sqrt(
                point.similarityVector.reduce(
                  (sum, value, index) => sum + (value - (highlightedPoint.similarityVector?.[index] ?? 0)) ** 2,
                  0
                ) / Math.max(1, point.similarityVector.length)
              )
            : Math.hypot(point.pc1 - highlightedPoint.pc1, point.pc2 - highlightedPoint.pc2),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, NEAREST_NEIGHBOR_COUNT);
  }, [highlightedPoint, compareMode, points, viewBy]);

  const arsenalComparison = useMemo(() => {
    if ((viewBy !== 'Arsenal' && viewBy !== 'Player') || !highlightedPoint) return [];
    const sourceRows = viewBy === 'Arsenal' ? arsenalRows : pitchComparisonRows;
    return [highlightedPoint, ...nearestNeighbors.map(({ point }) => point)].map((point, index) => {
      const pitcherRows = sourceRows
        .filter((row) => row.key === point.key || normalizePitcherKey(row.pitcher) === normalizePitcherKey(point.pitcher))
        .sort(
          (a, b) =>
            ARSENAL_PITCH_TYPES.indexOf(a.pitchType) - ARSENAL_PITCH_TYPES.indexOf(b.pitchType)
        );
      const totalPitches = pitcherRows.reduce((sum, row) => sum + row.pitches, 0);
      return {
        point,
        rank: index,
        rows: pitcherRows.map((row) => ({
          ...row,
          usage: totalPitches > 0 ? (row.pitches / totalPitches) * 100 : 0,
        })),
      };
    });
  }, [arsenalRows, pitchComparisonRows, highlightedPoint, nearestNeighbors, viewBy]);

  const arsenalMovementBounds = useMemo<ArsenalMovementBounds>(() => {
    let maxHorizontalMovement = 20;
    let maxVerticalMovement = 20;
    for (const comparison of arsenalComparison) {
      for (const row of comparison.rows) {
        const horizontalMovement = row.metrics.HB;
        const verticalMovement = row.metrics.IVB;
        if (Number.isFinite(horizontalMovement)) {
          maxHorizontalMovement = Math.max(maxHorizontalMovement, Math.abs(horizontalMovement as number));
        }
        if (Number.isFinite(verticalMovement)) {
          maxVerticalMovement = Math.max(maxVerticalMovement, Math.abs(verticalMovement as number));
        }
      }
    }
    return {
      maxX: Math.ceil(maxHorizontalMovement / 10) * 10,
      maxY: Math.ceil(maxVerticalMovement / 10) * 10,
    };
  }, [arsenalComparison]);

  useEffect(() => {
    if (!showArsenalComparison) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowArsenalComparison(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showArsenalComparison]);

  useEffect(() => {
    if (viewBy !== 'Arsenal' && viewBy !== 'Player') setShowArsenalComparison(false);
  }, [viewBy]);

  // Clear the on-demand Pitch-tab comparison fetch whenever the selection
  // changes so a stale previous pitcher's rows can never leak into a new
  // comparison while the fresh fetch is in flight.
  useEffect(() => {
    setPitchComparisonRows([]);
  }, [highlightedPoint?.key]);

  const downloadArsenalComparisonPng = useCallback(async () => {
    const comparisonNode = arsenalComparisonRef.current;
    if (!comparisonNode || !highlightedPoint) return;
    setIsExportingArsenalComparison(true);
    const originalLogoSources: Array<{ image: HTMLImageElement; src: string }> = [];
    try {
      const [{ default: html2canvas }] = await Promise.all([import('html2canvas')]);
      const pearlLockupImage = comparisonNode.querySelector<HTMLImageElement>('.portal-arsenal-brand-lockup');
      await pearlLockupImage?.decode?.().catch(() => undefined);
      const logoImages = Array.from(
        comparisonNode.querySelectorAll<HTMLImageElement>('.portal-arsenal-pitcher-identity img')
      );
      await Promise.all(logoImages.map((image) => image.decode?.().catch(() => undefined)));
      const rasterizedLogos = logoImages.map((image) => {
        try {
          const size = 128;
          const logoCanvas = document.createElement('canvas');
          logoCanvas.width = size;
          logoCanvas.height = size;
          const logoContext = logoCanvas.getContext('2d');
          if (!logoContext || !image.naturalWidth || !image.naturalHeight) return image.currentSrc || image.src;
          const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
          const drawWidth = image.naturalWidth * scale;
          const drawHeight = image.naturalHeight * scale;
          logoContext.drawImage(image, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);
          return logoCanvas.toDataURL('image/png');
        } catch {
          return image.currentSrc || image.src;
        }
      });
      logoImages.forEach((image, index) => {
        originalLogoSources.push({ image, src: image.src });
        if (rasterizedLogos[index]) image.src = rasterizedLogos[index];
      });
      await Promise.all(logoImages.map((image) => image.decode?.().catch(() => undefined)));
      const exportWidth = comparisonNode.scrollWidth;
      const exportHeight = comparisonNode.scrollHeight;
      const canvas = await html2canvas(comparisonNode, {
        backgroundColor: '#050505',
        scale: 2,
        useCORS: true,
        width: exportWidth,
        height: exportHeight,
        windowWidth: exportWidth,
        windowHeight: exportHeight,
        onclone: (clonedDocument) => {
          const clonedComparison = clonedDocument.querySelector<HTMLElement>('[data-arsenal-comparison-export]');
          if (!clonedComparison) return;
          clonedComparison.classList.add('portal-arsenal-export-render');
          clonedComparison.style.width = `${exportWidth}px`;
          clonedComparison.style.maxHeight = 'none';
          clonedComparison.style.overflow = 'visible';
          const clonedHeader = clonedComparison.querySelector<HTMLElement>('.portal-arsenal-compare-header');
          if (clonedHeader) clonedHeader.style.position = 'relative';
          const clonedLogos = Array.from(
            clonedComparison.querySelectorAll<HTMLImageElement>('.portal-arsenal-pitcher-identity img')
          );
          clonedLogos.forEach((image, index) => {
            if (rasterizedLogos[index]) image.src = rasterizedLogos[index];
          });
        },
      });
      const link = document.createElement('a');
      const safePitcherName =
        formatNameFirstLast(highlightedPoint.pitcher).replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'pitcher';
      link.href = canvas.toDataURL('image/png');
      link.download = `${safePitcherName}-arsenal-comparison.png`;
      link.click();
    } finally {
      originalLogoSources.forEach(({ image, src }) => {
        image.src = src;
      });
      setIsExportingArsenalComparison(false);
    }
  }, [highlightedPoint]);

  const downloadPng = useCallback(async () => {
    const svgNode = svgRef.current;
    if (!svgNode) return;
    setIsExportingPng(true);
    try {
      const exportScale = 3;
      const exportGap = 14;
      const exportSidebarWidth = 330;
      const exportWidth = width + exportGap + exportSidebarWidth;
      const serializer = new XMLSerializer();
      const clone = svgNode.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const svgString = serializer.serializeToString(clone);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const objectUrl = URL.createObjectURL(svgBlob);
      try {
        const loadImage = (source: string, rejectOnError = false) =>
          new Promise<HTMLImageElement | null>((resolve, reject) => {
            const next = new Image();
            next.onload = () => resolve(next);
            next.onerror = () => {
              if (rejectOnError) reject(new Error('Failed to render chart for export.'));
              else resolve(null);
            };
            next.src = source;
          });
        const exportLogoSource = (point: DnaPoint) => {
          const loadedLogo = resolveTeamLogo(point.teamCode);
          if (loadedLogo) return loadedLogo;
          if (isPro) {
            const remoteUrl = getProTeamLogoUrl(point.teamCode);
            if (remoteUrl) return `/api/dashboard/image-proxy?url=${encodeURIComponent(remoteUrl)}`;
          }
          if (point.teamCode === 'PCU') {
            return isLightTheme
              ? '/pearl-lockup-stacked-black-transparent.png'
              : '/pearl-clam-transparent.png';
          }
          return null;
        };
        const [img, neighborLogoImages] = await Promise.all([
          loadImage(objectUrl, true),
          Promise.all(
            nearestNeighbors.map(({ point }) => {
              const source = exportLogoSource(point);
              return source ? loadImage(source) : Promise.resolve(null);
            })
          ),
        ]);
        if (!img) throw new Error('Failed to render chart for export.');
        const canvas = document.createElement('canvas');
        canvas.width = exportWidth * exportScale;
        canvas.height = height * exportScale;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(exportScale, exportScale);
        ctx.fillStyle = dnaChartColors.background;
        ctx.fillRect(0, 0, exportWidth, height);
        ctx.drawImage(img, 0, 0, width, height);

        const sidebarX = width + exportGap;
        const sidebarPadding = 18;
        const contentX = sidebarX + sidebarPadding;
        const contentWidth = exportSidebarWidth - sidebarPadding * 2;
        const panelGradient = ctx.createLinearGradient(sidebarX, 0, exportWidth, height);
        if (isLightTheme) {
          panelGradient.addColorStop(0, '#f8fafc');
          panelGradient.addColorStop(1, '#edf9fb');
        } else {
          panelGradient.addColorStop(0, '#0b1119');
          panelGradient.addColorStop(0.55, '#07131b');
          panelGradient.addColorStop(1, '#08101c');
        }
        ctx.fillStyle = panelGradient;
        ctx.fillRect(sidebarX, 0, exportSidebarWidth, height);
        ctx.strokeStyle = isLightTheme ? 'rgba(100,116,139,0.25)' : 'rgba(148,163,184,0.24)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sidebarX + 0.5, 0.5, exportSidebarWidth - 1, height - 1);

        const drawRoundedRect = (x: number, y: number, rectWidth: number, rectHeight: number, radius: number) => {
          const r = Math.min(radius, rectWidth / 2, rectHeight / 2);
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + rectWidth - r, y);
          ctx.quadraticCurveTo(x + rectWidth, y, x + rectWidth, y + r);
          ctx.lineTo(x + rectWidth, y + rectHeight - r);
          ctx.quadraticCurveTo(x + rectWidth, y + rectHeight, x + rectWidth - r, y + rectHeight);
          ctx.lineTo(x + r, y + rectHeight);
          ctx.quadraticCurveTo(x, y + rectHeight, x, y + rectHeight - r);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
          ctx.closePath();
        };
        const drawContainedImage = (image: HTMLImageElement, x: number, y: number, boxWidth: number, boxHeight: number) => {
          const scale = Math.min(boxWidth / image.naturalWidth, boxHeight / image.naturalHeight);
          const drawWidth = image.naturalWidth * scale;
          const drawHeight = image.naturalHeight * scale;
          ctx.drawImage(image, x + (boxWidth - drawWidth) / 2, y + (boxHeight - drawHeight) / 2, drawWidth, drawHeight);
        };
        const fitText = (value: string, maxWidth: number) => {
          if (ctx.measureText(value).width <= maxWidth) return value;
          let shortened = value;
          while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1);
          return `${shortened}…`;
        };

        ctx.textBaseline = 'top';
        const accentGradient = ctx.createLinearGradient(contentX, 0, contentX + contentWidth, 0);
        accentGradient.addColorStop(0, '#22d3ee');
        accentGradient.addColorStop(0.55, '#38bdf8');
        accentGradient.addColorStop(1, '#a78bfa');
        ctx.fillStyle = accentGradient;
        ctx.fillRect(contentX, 18, contentWidth, 3);
        ctx.font = '700 10px Manrope, Arial, sans-serif';
        const matchesLabel = `${chartTitle.trim() || 'Pitcher DNA'} Matches`.toUpperCase();
        ctx.fillText(fitText(matchesLabel, contentWidth), contentX, 32);
        ctx.fillStyle = dnaChartColors.title;
        ctx.font = '800 22px Manrope, Arial, sans-serif';
        ctx.fillText(viewBy === 'Team' ? 'Similar Teams' : 'Similar Pitchers', contentX, 50);

        if (highlightedPoint) {
          const highlightedName =
            viewBy === 'Team' ? highlightedPoint.pitcher : formatNameFirstLast(highlightedPoint.pitcher);
          ctx.fillStyle = dnaChartColors.axisLabel;
          ctx.font = '500 11px Manrope, Arial, sans-serif';
          ctx.fillText(`Closest to ${fitText(highlightedName, contentWidth - 48)}`, contentX, 82);

          nearestNeighbors.forEach(({ point }, index) => {
            const rowY = 112 + index * 104;
            const rowHeight = 88;
            drawRoundedRect(contentX, rowY, contentWidth, rowHeight, 12);
            const cardGradient = ctx.createLinearGradient(contentX, rowY, contentX + contentWidth, rowY + rowHeight);
            if (isLightTheme) {
              cardGradient.addColorStop(0, '#ffffff');
              cardGradient.addColorStop(1, '#f3f8fb');
            } else {
              cardGradient.addColorStop(0, '#15202c');
              cardGradient.addColorStop(1, '#101720');
            }
            ctx.fillStyle = cardGradient;
            ctx.fill();
            ctx.strokeStyle = isLightTheme ? 'rgba(14,165,233,0.2)' : 'rgba(125,211,252,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();

            const rankColor = index === 0 ? '#22d3ee' : index === 1 ? '#60a5fa' : '#a78bfa';
            ctx.fillStyle = rankColor;
            drawRoundedRect(contentX, rowY, 4, rowHeight, 2);
            ctx.fill();

            ctx.beginPath();
            ctx.arc(contentX + 24, rowY + rowHeight / 2, 13, 0, Math.PI * 2);
            ctx.fillStyle = isLightTheme ? '#e0f7fa' : 'rgba(34,211,238,0.14)';
            ctx.fill();
            ctx.strokeStyle = rankColor;
            ctx.stroke();
            ctx.fillStyle = isLightTheme ? '#0f172a' : '#f8fafc';
            ctx.font = '800 11px Manrope, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(String(index + 1), contentX + 24, rowY + 37);
            ctx.textAlign = 'left';

            const logoX = contentX + 48;
            const logoY = rowY + 18;
            const logoSize = 52;
            drawRoundedRect(logoX, logoY, logoSize, logoSize, 10);
            ctx.fillStyle = isLightTheme ? '#f1f5f9' : '#090d14';
            ctx.fill();
            ctx.strokeStyle = isLightTheme ? 'rgba(100,116,139,0.18)' : 'rgba(148,163,184,0.18)';
            ctx.stroke();
            const logoImage = neighborLogoImages[index];
            if (logoImage) {
              drawContainedImage(logoImage, logoX + 6, logoY + 6, logoSize - 12, logoSize - 12);
            } else {
              ctx.fillStyle = dnaChartColors.axisLabel;
              ctx.font = '800 11px Manrope, Arial, sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText(point.teamCode.slice(0, 4), logoX + logoSize / 2, logoY + 20);
              ctx.textAlign = 'left';
            }

            const pointName = viewBy === 'Team' ? point.pitcher : formatNameFirstLast(point.pitcher);
            const textX = contentX + 112;
            ctx.fillStyle = dnaChartColors.title;
            ctx.font = '800 14px Manrope, Arial, sans-serif';
            ctx.fillText(fitText(pointName, contentWidth - 124), textX, rowY + 17);
            ctx.fillStyle = dnaChartColors.axisLabel;
            ctx.font = '600 10px Manrope, Arial, sans-serif';
            const detail = viewBy === 'Team' ? point.teamCode : point.teamLabel;
            ctx.fillText(fitText(detail, contentWidth - 124), textX, rowY + 48);
            if (viewBy === 'Arsenal') {
              const selectedRepertoire = new Set(highlightedPoint.repertoire ?? []);
              const sharedPitchTypes = (point.repertoire ?? []).filter((pitchType) => selectedRepertoire.has(pitchType)).length;
              ctx.fillStyle = rankColor;
              ctx.font = '700 9px Manrope, Arial, sans-serif';
              ctx.fillText(`${sharedPitchTypes} SHARED PITCH TYPE${sharedPitchTypes === 1 ? '' : 'S'}`, textX, rowY + 66);
            }
          });
        } else {
          ctx.fillStyle = dnaChartColors.axisLabel;
          ctx.font = '500 12px Manrope, Arial, sans-serif';
          const emptyMessage =
            viewBy === 'Team' ? 'Select a team to show its closest matches.' : 'Select a pitcher to show his closest matches.';
          ctx.fillText(fitText(emptyMessage, contentWidth), contentX, 54);
        }

        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        const safeName = chartTitle.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'pitcher-dna';
        link.href = dataUrl;
        link.download = `${safeName}.png`;
        link.click();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } finally {
      setIsExportingPng(false);
    }
  }, [
    width,
    height,
    chartTitle,
    dnaChartColors,
    highlightedPoint,
    isPro,
    isLightTheme,
    nearestNeighbors,
    resolveTeamLogo,
    viewBy,
  ]);

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        {isEditingTitle ? (
          <input
            type="text"
            autoFocus
            value={chartTitle}
            onChange={(event) => setChartTitle(event.target.value)}
            onBlur={() => setIsEditingTitle(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.currentTarget.blur();
              }
            }}
            placeholder="Pitcher DNA"
            style={{
              font: 'inherit',
              fontSize: '1.3rem',
              fontWeight: 700,
              margin: 0,
              background: 'transparent',
              color: dnaChartColors.title,
              border: '1px solid rgba(148,163,184,0.5)',
              borderRadius: 6,
              padding: '2px 6px',
              minWidth: 200,
              alignSelf: 'flex-start',
            }}
          />
        ) : (
          <h3
            onClick={() => setIsEditingTitle(true)}
            title="Click to edit title"
            style={{ margin: 0, cursor: 'text', padding: '2px 6px', borderRadius: 6, alignSelf: 'flex-start' }}
          >
            {chartTitle.trim() || 'Pitcher DNA'}
          </h3>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.4)', flexShrink: 0 }}>
            <button
              type="button"
              className={viewBy === 'Player' ? 'btn btn-primary' : 'btn btn-ghost'}
              style={{ borderRadius: 0 }}
              onClick={() => {
                setViewBy('Player');
                setSelectedKey(null);
                setSearchQuery('');
                setChartTitle((current) => (current === 'Arsenal DNA' ? 'Pitcher DNA' : current));
              }}
            >
              Pitch
            </button>
            <button
              type="button"
              className={viewBy === 'Team' ? 'btn btn-primary' : 'btn btn-ghost'}
              style={{ borderRadius: 0 }}
              onClick={() => {
                setViewBy('Team');
                setSelectedKey(null);
                setSearchQuery('');
                setChartTitle((current) => (current === 'Arsenal DNA' ? 'Pitcher DNA' : current));
              }}
            >
              Team
            </button>
            <button
              type="button"
              className={viewBy === 'Arsenal' ? 'btn btn-primary' : 'btn btn-ghost'}
              style={{ borderRadius: 0 }}
              onClick={() => {
                setViewBy('Arsenal');
                setSelectedKey(null);
                setSearchQuery('');
                setChartTitle((current) => (current === 'Pitcher DNA' ? 'Arsenal DNA' : current));
              }}
            >
              Arsenal
            </button>
          </div>
          {canCompareMlb || canCompareD1 ? (
            <div
              style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.4)', flexShrink: 0 }}
              title={`Choose whether "Similar ${viewBy === 'Team' ? 'Teams' : 'Pitchers'}" matches within your own roster or against an MLB/D1 pool`}
            >
              {(['Team', ...(canCompareMlb ? (['MLB'] as const) : []), ...(canCompareD1 ? (['D1'] as const) : [])] as const).map(
                (option) => (
                  <button
                    key={option}
                    type="button"
                    className={compareMode === option ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ borderRadius: 0 }}
                    onClick={() => {
                      setCompareMode(option);
                      setSelectedKey(null);
                      setSearchQuery('');
                    }}
                  >
                    Compare: {option}
                  </button>
                )
              )}
            </div>
          ) : null}
          <div ref={searchRootRef} style={{ position: 'relative', flex: '1 1 180px', minWidth: 180 }}>
            <input
              type="text"
              className="portal-search-select-input"
              placeholder={viewBy === 'Team' ? 'Search for a team...' : 'Search for a pitcher...'}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSelectedKey(null);
                setIsSearchDropdownOpen(true);
              }}
              onFocus={() => setIsSearchDropdownOpen(true)}
              style={{ width: '100%' }}
            />
            {isSearchDropdownOpen && searchMatches.length ? (
              <div className="portal-search-select-menu" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20 }}>
                <div className="portal-search-select-options">
                  {searchMatches.map((point) => (
                    <button
                      key={point.key}
                      type="button"
                      className="portal-search-select-option"
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      onClick={() => {
                        selectPoint(point);
                        setSearchQuery(point.pitcher);
                        setIsSearchDropdownOpen(false);
                      }}
                    >
                      {resolveTeamLogo(point.teamCode) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resolveTeamLogo(point.teamCode)} alt="" width={16} height={16} style={{ objectFit: 'contain', flexShrink: 0 }} />
                      ) : null}
                      <span>
                        {viewBy === 'Team' ? point.pitcher : formatNameFirstLast(point.pitcher)}
                        {viewBy !== 'Team' ? <span className="portal-option-email"> ({point.teamLabel})</span> : null}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <button type="button" className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={() => { void downloadPng(); }} disabled={isExportingPng || !visiblePoints.length}>
            {isExportingPng ? 'Downloading...' : 'Download PNG'}
          </button>
        </div>
      </div>
      <p className="portal-muted-text" style={{ marginTop: 0 }}>
        {viewBy === 'Team'
          ? 'Teams with similar pitching staffs sit close together (average across each team\'s qualifying pitchers).'
          : viewBy === 'Arsenal'
          ? 'Pitchers with similar complete arsenals sit close together. Arsenal mode uses every qualifying pitch type and ignores the Pitch Type filter.'
          : 'Pitchers with similar stuff sit close together.'} Arrows show which metric is pulling {viewBy === 'Team' ? 'teams' : 'pitchers'} in that direction.
        {compareMode !== 'Team' && !isArsenalView
          ? ` "Compare: ${compareMode}" is on -- select a ${viewBy === 'Team' ? 'team' : 'pitcher'} below to see its 3 closest ${compareMode} matches (filtered by your current date range and other sidebar filters).${
              poolLoading ? ' Loading comparison pool...' : comparePoolRows.length === 0 ? ' No comparison data returned for the current filters.' : ''
            }`
          : compareMode !== 'Team'
          ? ` "Compare: ${compareMode}" is on -- select a pitcher below to see his 3 closest ${compareMode} arsenal matches (filtered by your current date range and other sidebar filters).`
          : ''}
      </p>
      {loading ? <p>Loading Pitcher DNA...</p> : null}
      {errorMessage ? <p className="portal-muted-text">{errorMessage}</p> : null}
      {!loading && !errorMessage && visiblePoints.length === 0 ? (
        <p className="portal-muted-text">
          {viewBy === 'Team'
            ? `Not enough teams with at least ${MIN_PITCHERS_PER_TEAM} qualifying pitchers for the current filters (need at least 3 teams).`
            : viewBy === 'Arsenal'
            ? `Not enough qualifying arsenals for the current filters. Pitchers need at least ${MIN_ARSENAL_TOTAL_PITCHES} total pitches and ${MIN_ARSENAL_PITCH_TYPES} pitch types with ${MIN_ARSENAL_PITCHES_PER_TYPE}+ pitches each.`
            : 'Not enough pitchers with complete data for the current filters (need at least 3).'}
        </p>
      ) : null}
      {visiblePoints.length > 0 ? (
        <div className="portal-admin-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 14, alignItems: 'start' }}>
          <article className="portal-day-card" style={{ overflowX: 'auto', background: dnaChartColors.background }}>
            <svg ref={svgRef} width={width} height={height} style={{ maxWidth: '100%', height: 'auto' }} fontFamily="Manrope, sans-serif">
              <defs>
                <marker id="dna-arrow-head" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill={dnaChartColors.vector} />
                </marker>
              </defs>
              <rect x={0} y={0} width={width} height={height} fill={dnaChartColors.background} />
              <text x={marginPx} y={30} fontSize={18} fontWeight={700} fill={dnaChartColors.title}>{chartTitle || 'Pitcher DNA'}</text>
              <text x={marginPx} y={48} fontSize={12} fill={dnaChartColors.axisLabel}>
                {visiblePoints.length} {viewBy === 'Team' ? `team${visiblePoints.length === 1 ? '' : 's'}` : `pitcher${visiblePoints.length === 1 ? '' : 's'}`}
              </text>
              {logoDataUri ? (
                <image
                  href={logoDataUri}
                  xlinkHref={logoDataUri}
                  x={width - 70}
                  y={6}
                  width={64}
                  height={64}
                  preserveAspectRatio="xMidYMid meet"
                />
              ) : null}
              <line x1={marginPx} y1={height - marginPx} x2={width - marginPx} y2={height - marginPx} stroke={dnaChartColors.axisLine} />
              <line x1={marginPx} y1={topMarginPx} x2={marginPx} y2={height - marginPx} stroke={dnaChartColors.axisLine} />
              <text x={width / 2} y={height - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill={dnaChartColors.axisLabel}>PC1 ({varianceExplainedPct.pc1.toFixed(0)}%)</text>
              <text x={12} y={(height + topMarginPx) / 2} textAnchor="middle" fontSize={12} fontWeight={700} fill={dnaChartColors.axisLabel} transform={`rotate(-90 12 ${(height + topMarginPx) / 2})`}>PC2 ({varianceExplainedPct.pc2.toFixed(0)}%)</text>
              <text x={width - marginPx} y={height - 20} textAnchor="end" fontSize={10} fill={dnaChartColors.axisLabel} opacity={0.75}>Toward an arrow = higher on that metric, away = lower</text>
              <text x={width - marginPx} y={height - 6} textAnchor="end" fontSize={10} fill={dnaChartColors.axisLabel} opacity={0.75}>Fainter arrows = less influence on this chart</text>
              {chartArrowLoadings.map((entry) => {
                const tipX = originX + entry.pc1 * vectorScale;
                const tipY = originY - entry.pc2 * vectorScale;
                const label = vectorLabelPositions.get(entry.key);
                return (
                  <g key={`vector-${entry.key}`} opacity={entry.isFaint ? 0.45 : 1}>
                    <line
                      x1={originX}
                      y1={originY}
                      x2={tipX}
                      y2={tipY}
                      stroke={dnaChartColors.vector}
                      strokeWidth={entry.isFaint ? 1.4 : 2.6}
                      markerEnd="url(#dna-arrow-head)"
                    />
                    {label ? (
                      <>
                        {Math.hypot(label.x - tipX, label.y - tipY) > 10 ? (
                          <line
                            x1={tipX}
                            y1={tipY}
                            x2={label.x}
                            y2={label.y}
                            stroke={dnaChartColors.vector}
                            strokeWidth={1}
                            strokeDasharray="2,3"
                            opacity={0.6}
                          />
                        ) : null}
                        <text
                          x={label.x}
                          y={label.y}
                          fontSize={entry.isFaint ? 12 : 15}
                          fontWeight={entry.isFaint ? 500 : 800}
                          textAnchor={label.anchor}
                          dominantBaseline="middle"
                          fill={dnaChartColors.vector}
                          stroke={dnaChartColors.background}
                          strokeWidth={entry.isFaint ? 3 : 4.5}
                          paintOrder="stroke"
                        >
                          {entry.label}
                        </text>
                      </>
                    ) : null}
                  </g>
                );
              })}
              {visiblePoints.filter((point) => highlightedKey !== point.key).map((point) => {
                const x = toSvgX(point.pc1);
                const y = toSvgY(point.pc2);
                const logoUri = viewBy === 'Team' ? resolveTeamLogo(point.teamCode) : undefined;
                if (logoUri) {
                  const size = 28;
                  return (
                    <image
                      key={point.key}
                      href={logoUri}
                      xlinkHref={logoUri}
                      x={x - size / 2}
                      y={y - size / 2}
                      width={size}
                      height={size}
                      preserveAspectRatio="xMidYMid meet"
                      onMouseEnter={() => setHoveredPitcher(point.key)}
                      onMouseLeave={() => setHoveredPitcher((current) => (current === point.key ? null : current))}
                      onClick={() => handlePointClick(point)}
                      style={{ cursor: 'pointer' }}
                    />
                  );
                }
                return (
                  <circle
                    key={point.key}
                    cx={x}
                    cy={y}
                    r={5}
                    fill={dnaChartColors.dot}
                    stroke={dnaChartColors.dotStroke}
                    strokeWidth={1}
                    onMouseEnter={() => setHoveredPitcher(point.key)}
                    onMouseLeave={() => setHoveredPitcher((current) => (current === point.key ? null : current))}
                    onClick={() => handlePointClick(point)}
                    style={{ cursor: 'pointer' }}
                  />
                );
              })}
              {highlightedPoint ? (
                <g>
                  {(() => {
                    const hx = toSvgX(highlightedPoint.pc1);
                    const hy = toSvgY(highlightedPoint.pc2);
                    // In MLB compare mode (any tab), the selected college
                    // pitcher's own dot shows their school's logo (a real
                    // per-school asset, e.g. gcu-logo.png); an MLB match
                    // instead shows its real MLB team logo (resolved via
                    // mlbPitcherTeamByName / resolveTeamLogo).
                    const highlightedLogoUri =
                      viewBy === 'Team'
                        ? resolveTeamLogo(highlightedPoint.teamCode)
                        : isMlbCompareActive && highlightedPoint.poolSource === 'MLB'
                        ? resolveTeamLogo(highlightedPoint.teamCode)
                        : isMlbCompareActive && !highlightedPoint.poolSource
                        ? resolveSchoolLogoByCodeOrPrefix(highlightedPoint.teamCode)
                        : undefined;
                    if (highlightedLogoUri) {
                      const size = 40;
                      return (
                        <>
                          <circle cx={hx} cy={hy} r={size / 2 + 3} fill="none" stroke="#f97316" strokeWidth={2.5} />
                          <image
                            href={highlightedLogoUri}
                            xlinkHref={highlightedLogoUri}
                            x={hx - size / 2}
                            y={hy - size / 2}
                            width={size}
                            height={size}
                            preserveAspectRatio="xMidYMid meet"
                            onMouseEnter={() => setHoveredPitcher(highlightedPoint.key)}
                            onMouseLeave={() => setHoveredPitcher((current) => (current === highlightedPoint.key ? null : current))}
                            onClick={() => handlePointClick(highlightedPoint)}
                            style={{ cursor: 'pointer' }}
                          />
                        </>
                      );
                    }
                    return (
                      <circle
                        cx={hx}
                        cy={hy}
                        r={8}
                        fill="#f97316"
                        stroke={dnaChartColors.background}
                        strokeWidth={2}
                        onMouseEnter={() => setHoveredPitcher(highlightedPoint.key)}
                        onMouseLeave={() => setHoveredPitcher((current) => (current === highlightedPoint.key ? null : current))}
                        onClick={() => handlePointClick(highlightedPoint)}
                        style={{ cursor: 'pointer' }}
                      />
                    );
                  })()}
                  <text
                    x={toSvgX(highlightedPoint.pc1) + 12}
                    y={toSvgY(highlightedPoint.pc2) - 18}
                    fontSize={13}
                    fontWeight={700}
                    fill={dnaChartColors.title}
                    stroke={dnaChartColors.background}
                    strokeWidth={4}
                    paintOrder="stroke"
                  >
                    {viewBy === 'Team' ? highlightedPoint.pitcher : formatNameFirstLast(highlightedPoint.pitcher)}
                  </text>
                  {viewBy !== 'Team' ? (
                    <text
                      x={toSvgX(highlightedPoint.pc1) + 12}
                      y={toSvgY(highlightedPoint.pc2) - 2}
                      fontSize={11}
                      fill={dnaChartColors.axisLabel}
                      stroke={dnaChartColors.background}
                      strokeWidth={4}
                      paintOrder="stroke"
                    >
                      ({highlightedPoint.teamLabel})
                    </text>
                  ) : null}
                </g>
              ) : null}
            </svg>
          </article>
          <article className="portal-day-card">
            <div>
              <h4 style={{ marginTop: 0, marginBottom: 4 }}>
                {viewBy === 'Team' ? 'Similar Teams' : 'Similar Pitchers'}
              </h4>
              {highlightedPoint ? (
                <>
                  <p className="portal-muted-text" style={{ fontSize: '0.8rem', marginTop: 0 }}>
                    Closest matches to{' '}
                    <strong>{viewBy === 'Team' ? highlightedPoint.pitcher : formatNameFirstLast(highlightedPoint.pitcher)}</strong>
                  </p>
                  {nearestNeighbors.length ? (
                    <div style={{ display: 'grid', gap: 4 }}>
                      {nearestNeighbors.map(({ point, distance }) => (
                        <button
                          key={point.key}
                          type="button"
                          onClick={() => selectPoint(point)}
                          title="Click to view this one"
                          style={{
                            display: 'block',
                            textAlign: 'left',
                            textTransform: 'none',
                            background: 'rgba(148,163,184,0.08)',
                            border: '1px solid rgba(148,163,184,0.18)',
                            borderRadius: 8,
                            padding: '6px 10px',
                            cursor: 'pointer',
                            color: 'inherit',
                          }}
                        >
                          <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                            {viewBy === 'Team' ? point.pitcher : formatNameFirstLast(point.pitcher)}
                          </div>
                          <div
                            className="portal-muted-text"
                            style={{ fontSize: '0.75rem', fontWeight: 400, display: 'flex', alignItems: 'center', gap: 5 }}
                          >
                            {viewBy !== 'Team' && resolveTeamLogo(point.teamCode) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={resolveTeamLogo(point.teamCode)}
                                alt=""
                                width={14}
                                height={14}
                                style={{ objectFit: 'contain', flexShrink: 0 }}
                              />
                            ) : null}
                            <span>
                              {viewBy === 'Team'
                                ? `distance ${distance.toFixed(2)}`
                                : viewBy === 'Arsenal'
                                ? `${point.teamLabel} · ${(point.repertoire ?? []).filter((pitchType) =>
                                    (highlightedPoint.repertoire ?? []).includes(pitchType)
                                  ).length} shared pitch types`
                                : point.teamLabel}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="portal-muted-text" style={{ fontSize: '0.8rem' }}>No similar matches are available.</p>
                  )}
                  {viewBy === 'Arsenal' && nearestNeighbors.length ? (
                    <button
                      type="button"
                      className="portal-arsenal-compare-trigger"
                      onClick={() => setShowArsenalComparison(true)}
                    >
                      <span>
                        <small>FULL ARSENAL VIEW</small>
                        Compare Movement
                      </span>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 7h11m0 0-3-3m3 3-3 3M19 17H8m0 0 3-3m-3 3 3 3" />
                      </svg>
                    </button>
                  ) : null}
                  {viewBy === 'Player' && nearestNeighbors.length && isSinglePitchTypeScope && highlightedPoint ? (
                    <button
                      type="button"
                      className="portal-arsenal-compare-trigger"
                      disabled={pitchComparisonLoading}
                      onClick={async () => {
                        await fetchPitchComparisonRows([highlightedPoint, ...nearestNeighbors.map(({ point }) => point)]);
                        setShowArsenalComparison(true);
                      }}
                    >
                      <span>
                        <small>{selectedPitchTypes.find((v) => v.trim() && v.trim().toLowerCase() !== 'all')} MOVEMENT</small>
                        {pitchComparisonLoading ? 'Loading...' : 'Compare Movement'}
                      </span>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 7h11m0 0-3-3m3 3-3 3M19 17H8m0 0 3-3m-3 3 3 3" />
                      </svg>
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="portal-muted-text" style={{ fontSize: '0.8rem', marginTop: 0 }}>
                  {viewBy === 'Team'
                    ? 'Select a team on the graph to see its closest matches.'
                    : 'Select a pitcher on the graph to see his closest matches.'}
                </p>
              )}
            </div>

            <div style={{ borderTop: '1px solid rgba(148,163,184,0.2)', paddingTop: 14 }}>
              <h4 style={{ marginTop: 0 }}>{viewBy === 'Arsenal' ? 'Top Arsenal Drivers' : 'Metric Loadings'}</h4>
              <p className="portal-muted-text" style={{ fontSize: '0.8rem' }}>
                {viewBy === 'Arsenal'
                  ? 'The pitch-specific traits contributing most to this two-dimensional arsenal view.'
                  : 'How much each metric contributes to PC1 / PC2. The 2 lightest arrows on the chart explain this view the least.'}
              </p>
              <div style={{ display: 'grid', gap: 6, fontSize: '0.85rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px', fontWeight: 700 }}>
                  <span>Metric</span>
                  <span>PC1</span>
                  <span>PC2</span>
                </div>
                {sidebarLoadings.map((entry) => (
                  <div key={entry.key} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px' }}>
                    <span>{entry.label}</span>
                    <span>{entry.pc1.toFixed(2)}</span>
                    <span>{entry.pc2.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              {highlightedPoint ? (
                <div style={{ marginTop: 14 }}>
                  <h4 style={{ marginBottom: 0 }}>
                    {viewBy === 'Team' ? highlightedPoint.pitcher : formatNameFirstLast(highlightedPoint.pitcher)}
                  </h4>
                  {viewBy !== 'Team' ? (
                    <p className="portal-muted-text" style={{ fontSize: '0.8rem', marginTop: 0 }}>({highlightedPoint.teamLabel})</p>
                  ) : null}
                  {viewBy === 'Arsenal' && highlightedArsenalDrivers.length ? (
                    <p className="portal-muted-text" style={{ fontSize: '0.8rem', marginTop: 0 }}>
                      Biggest driver: <strong>{highlightedArsenalDrivers[0].label}</strong>
                      {highlightedArsenalDrivers[1] ? <> (then {highlightedArsenalDrivers[1].label})</> : null}
                      {' '}— ranked by how far each pitch-specific trait is from the cohort average.
                    </p>
                  ) : highlightedPitcherDrivers.length ? (
                    <p className="portal-muted-text" style={{ fontSize: '0.8rem', marginTop: 0 }}>
                      Biggest driver: <strong>{DNA_METRIC_LABELS[highlightedPitcherDrivers[0].col]}</strong>
                      {highlightedPitcherDrivers[1] ? <> (then {DNA_METRIC_LABELS[highlightedPitcherDrivers[1].col]})</> : null}
                      {' '}— ranked by how far each raw value is from the cohort average, in standard deviations.
                      {isSinglePitchTypeScope ? ' For HB/Rel. Side, a positive std. dev. always means more break for this pitch type.' : ''}
                    </p>
                  ) : null}
                  <div style={{ display: 'grid', gap: 3, fontSize: '0.82rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 70px', fontWeight: 700 }}>
                      <span>Metric</span>
                      <span style={{ textAlign: 'right' }}>Value</span>
                      <span style={{ textAlign: 'right' }}>Std. Dev.</span>
                    </div>
                    {viewBy === 'Arsenal'
                      ? highlightedArsenalDrivers.map(({ key, label, value, zScore }) => (
                          <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 70px' }}>
                            <span className="portal-muted-text">{label}</span>
                            <span style={{ textAlign: 'right' }}>{Number.isFinite(value) ? Number(value).toFixed(1) : '-'}</span>
                            <span style={{ textAlign: 'right' }}>{zScore >= 0 ? '+' : ''}{zScore.toFixed(2)}</span>
                          </div>
                        ))
                      : highlightedPitcherDrivers.map(({ col, zScore }) => {
                          const value = highlightedPoint.metrics[col];
                          return (
                            <div key={col} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 70px' }}>
                              <span className="portal-muted-text">{DNA_METRIC_LABELS[col]}</span>
                              <span style={{ textAlign: 'right' }}>{value !== undefined ? Number(value).toFixed(1) : '-'}</span>
                              <span style={{ textAlign: 'right' }}>{zScore >= 0 ? '+' : ''}{zScore.toFixed(2)}</span>
                            </div>
                          );
                        })}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ marginTop: 10, width: '100%' }}
                    onClick={() => handlePointClick(highlightedPoint)}
                  >
                    {viewBy === 'Team' ? 'Filter to This Team' : 'View Summary'}
                  </button>
                </div>
              ) : null}
            </div>
          </article>
        </div>
      ) : null}
      {showArsenalComparison && arsenalComparison.length && typeof document !== 'undefined'
        ? createPortal(
          <div
          className="portal-arsenal-compare-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setShowArsenalComparison(false);
          }}
        >
          <section
            ref={arsenalComparisonRef}
            className="portal-arsenal-compare-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="arsenal-comparison-title"
            data-arsenal-comparison-export
          >
            <header className="portal-arsenal-compare-header">
              <div>
                <h2 id="arsenal-comparison-title">Arsenal DNA Comparison</h2>
              </div>
              <div className="portal-arsenal-compare-header-branding">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="portal-arsenal-brand-lockup"
                  src="/pearl-lockup-transparent.png"
                  alt="Pearl Player Development"
                />
                <div className="portal-arsenal-compare-actions" data-html2canvas-ignore="true">
                  <button
                    type="button"
                    className="portal-arsenal-download-button"
                    onClick={downloadArsenalComparisonPng}
                    disabled={isExportingArsenalComparison}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" />
                    </svg>
                    {isExportingArsenalComparison ? 'Building PNG…' : 'Download PNG'}
                  </button>
                  <button
                    type="button"
                    className="portal-arsenal-compare-close"
                    onClick={() => setShowArsenalComparison(false)}
                    aria-label="Close movement comparison"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              </div>
            </header>
            <div className="portal-arsenal-compare-grid">
              {arsenalComparison.map(({ point, rank, rows: comparisonRows }) => {
                const teamLogo = point.poolSource
                  ? resolveTeamLogo(point.teamCode)
                  : resolveTeamLogo(point.teamCode) ?? resolveSchoolLogoByCodeOrPrefix(point.teamCode);
                return (
                  <article
                    key={point.key}
                    className={`portal-arsenal-compare-card${rank === 0 ? ' portal-arsenal-compare-card--selected' : ''}`}
                  >
                    <div className="portal-arsenal-compare-card-heading">
                      <span className="portal-arsenal-rank">{rank === 0 ? 'SELECTED' : `#${rank} MATCH`}</span>
                      <div className="portal-arsenal-pitcher-identity">
                        {teamLogo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={teamLogo} alt="" width={38} height={38} />
                        ) : (
                          <span className="portal-arsenal-team-monogram">{point.teamCode.slice(0, 3)}</span>
                        )}
                        <div>
                          <h3>{formatNameFirstLast(point.pitcher)}</h3>
                          <p>{point.teamLabel}</p>
                        </div>
                      </div>
                    </div>
                    <div className="portal-arsenal-movement-frame">
                      <ArsenalMovementPlot rows={comparisonRows} bounds={arsenalMovementBounds} />
                    </div>
                    <div className="portal-arsenal-table-wrap">
                      <table className="portal-arsenal-comparison-table">
                        <colgroup>
                          <col className="portal-arsenal-pitch-column" />
                          {Array.from({ length: 8 }, (_, index) => (
                            <col key={index} />
                          ))}
                        </colgroup>
                        <thead>
                          <tr>
                            <th>Pitch</th>
                            <th>Usage</th>
                            <th>Velo</th>
                            <th>IVB</th>
                            <th>HB</th>
                            <th>Spin</th>
                            <th>Height</th>
                            <th>Side</th>
                            <th>Ext</th>
                          </tr>
                        </thead>
                        <tbody>
                          {comparisonRows.map((row) => (
                            <tr key={row.pitchType}>
                              <th scope="row">
                                <span
                                  className="portal-arsenal-pitch-swatch"
                                  style={{ background: ARSENAL_PITCH_COLORS[row.pitchType] }}
                                />
                                {row.pitchType}
                              </th>
                              <td>{row.usage.toFixed(1)}%</td>
                              <td>{row.metrics.Velo?.toFixed(1) ?? '—'}</td>
                              <td>{row.metrics.IVB?.toFixed(1) ?? '—'}</td>
                              <td>{row.metrics.HB?.toFixed(1) ?? '—'}</td>
                              <td>{row.metrics.Spin?.toFixed(0) ?? '—'}</td>
                              <td>{row.metrics.Height?.toFixed(1) ?? '—'}</td>
                              <td>{row.metrics.Side?.toFixed(1) ?? '—'}</td>
                              <td>{row.metrics.Ext?.toFixed(1) ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          </div>,
          document.body
        )
        : null}
    </div>
  );
}

export default function PitchingSuite({
  role,
  selectedSchoolCode,
  homeNavigateRequest,
}: {
  role?: 'admin' | 'coach' | 'player';
  selectedSchoolCode?: string;
  homeNavigateRequest?: {
    requestId: number;
    suite: 'Pitching' | 'Hitting';
    targetType: 'player' | 'team';
    targetValue: string;
    startDate: string;
    endDate: string;
    page?: 'Summary' | 'Leaderboard' | 'Game Log' | 'Pitch Log';
    navigationSource?: 'search' | 'home_leaderboard';
  } | null;
}) {
  const canUsePitchEdits = role === 'admin' || role === 'coach';
  const isPlayerRole = role === 'player';
  const initialSchoolCode = String(selectedSchoolCode ?? '').trim().toUpperCase();
  const shouldUsePcuDefaults = initialSchoolCode === 'PCU';
  const [dashboardPage, setDashboardPage] = useState<'Summary' | 'Leaderboard' | 'Game Log' | 'Pitch Log' | 'AB Report' | 'Velocity' | 'HeatMaps' | 'QP Locations' | 'Trend' | 'Velo Manual Entry' | 'Pitcher DNA'>('Summary');
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [filters, setFilters] = useState<FiltersPayload | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingAbReport, setLoadingAbReport] = useState(false);
  const [isDownloadingAbPdf, setIsDownloadingAbPdf] = useState(false);
  const [error, setError] = useState('');
  const [abError, setAbError] = useState('');
  const [abPdfError, setAbPdfError] = useState('');
  const [abReport, setAbReport] = useState<AbReportPayload | null>(null);
  const [abGameKey, setAbGameKey] = useState('');
  const abReportPdfRef = useRef<HTMLDivElement | null>(null);
  const [pitchEditsAppliedCount, setPitchEditsAppliedCount] = useState<number>(0);
  const [manualEntries, setManualEntries] = useState<ManualVelocityEntry[]>([]);
  const [loadingManualEntries, setLoadingManualEntries] = useState(false);
  const [manualEntriesError, setManualEntriesError] = useState('');
  const [manualEntryTab, setManualEntryTab] = useState<'Entry' | 'Progress'>('Entry');
  const [manualVeloStatus, setManualVeloStatus] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualPitcher, setManualPitcher] = useState('All');
  const [manualThrowType, setManualThrowType] = useState('Pulldowns');
  const [manualThrowTypeOther, setManualThrowTypeOther] = useState('');
  const [manualPlyoDrill, setManualPlyoDrill] = useState('');
  const [manualWeight, setManualWeight] = useState('5');
  const [manualSingleVelo, setManualSingleVelo] = useState('');
  const [manualBatchVelo, setManualBatchVelo] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualSelectedEntryId, setManualSelectedEntryId] = useState<string | null>(null);
  const [manualPitcherFilter, setManualPitcherFilter] = useState('All');
  const [manualTypeFilter, setManualTypeFilter] = useState<string[]>(['All']);
  const [manualDateStart, setManualDateStart] = useState('');
  const [manualDateEnd, setManualDateEnd] = useState('');
  const [manualWeightMin, setManualWeightMin] = useState('0.5');
  const [manualWeightMax, setManualWeightMax] = useState('64');
  const [manualChartType, setManualChartType] = useState<'Trend by Drill' | 'Velocity Distribution' | 'Weight vs Velocity' | 'PR Timeline'>('Trend by Drill');
  const [manualKpiSeriesFilter, setManualKpiSeriesFilter] = useState<string[]>(['All']);

  const [teamType, setTeamType] = useState('All');
  const [withVideo, setWithVideo] = useState('All');
  const [breakLines, setBreakLines] = useState('None');
  const [stuffLevel, setStuffLevel] = useState('College');
  const [stuffBase, setStuffBase] = useState('Fastball');
  const [hand, setHand] = useState('All');
  const [batterSide, setBatterSide] = useState('All');
  const [venue, setVenue] = useState('All');
  const [sessionType, setSessionType] = useState('');
  const [level, setLevel] = useState(
    initialSchoolCode === 'LEAGUE' ? 'D1' : initialSchoolCode === 'PRO' ? 'MLB' : 'All'
  );
  // Break Lines has its own level picker, independent of the page-wide
  // "Level" filter above -- that filter only ever offers the levels
  // relevant to the current site's own data (e.g. D1/D2/D3/JUCO/NAIA on a
  // college site, MLB/AAA on the pro site), but break_line_offsets_grid has
  // real precomputed data for every level regardless of which site you're
  // viewing, so this should never be constrained by site context.
  const [breakLinesLevel, setBreakLinesLevel] = useState(
    initialSchoolCode === 'PRO' ? 'MLB' : 'D1'
  );
  type BreakLineOffset = {
    offspeed_pitch_type: string;
    avg_ivb_offset: number;
    avg_hb_offset: number;
    sample_size: number;
    used_fallback: boolean;
  };
  const [breakLineOffsets, setBreakLineOffsets] = useState<BreakLineOffset[]>([]);
  const [breakLineOffsetsFallback, setBreakLineOffsetsFallback] = useState(false);
  const [qpLocations, setQpLocations] = useState('All');
  const [tableMode, setTableMode] = useState(shouldUsePcuDefaults ? 'Bullpen' : 'Live');
  const [splitBy, setSplitBy] = useState('Pitch Types');
  const [leaderboardSortColumn, setLeaderboardSortColumn] = useState('');
  const [leaderboardSortDirection, setLeaderboardSortDirection] = useState<SortDirection>('desc');
  const [leaderboardStatView, setLeaderboardStatView] = useState<'Stats' | 'Percentile'>('Stats');
  const [summaryStatView, setSummaryStatView] = useState<'Stats' | 'Percentile'>('Stats');
  const [leaderboardPercentileScope, setLeaderboardPercentileScope] = useState(DEFAULT_COLLEGE_PERCENTILE_SCOPE);
  const [summaryPercentileScope, setSummaryPercentileScope] = useState(DEFAULT_COLLEGE_PERCENTILE_SCOPE);
  const [leaderboardViewBy, setLeaderboardViewBy] = useState<'Player' | 'Team'>('Player');
  const [pinnedLeaderboardKeys, setPinnedLeaderboardKeys] = useState<Set<string>>(new Set());
  const [gameLogRows, setGameLogRows] = useState<Array<Record<string, unknown>>>([]);
  const [gameLogColumns, setGameLogColumns] = useState<string[]>([]);
  const [loadingGameLog, setLoadingGameLog] = useState(false);
  const [gameLogError, setGameLogError] = useState('');
  const [gameLogSortColumn, setGameLogSortColumn] = useState('Date');
  const [gameLogSortDirection, setGameLogSortDirection] = useState<SortDirection>('desc');
  const [pinnedGameLogKeys, setPinnedGameLogKeys] = useState<Set<string>>(new Set());
  const [pitchLogRows, setPitchLogRows] = useState<Array<Record<string, unknown>>>([]);
  const [pitchLogColumns, setPitchLogColumns] = useState<string[]>([]);
  const [loadingPitchLog, setLoadingPitchLog] = useState(false);
  const [pitchLogError, setPitchLogError] = useState('');
  const [pitchLogSortColumn, setPitchLogSortColumn] = useState('Date');
  const [pitchLogSortDirection, setPitchLogSortDirection] = useState<SortDirection>('desc');
  const [pinnedPitchLogKeys, setPinnedPitchLogKeys] = useState<Set<string>>(new Set());
  const pitchLogDefaultTableAppliedRef = useRef(false);
  const autoFallbackAppliedRef = useRef(false);
  const filtersCacheRef = useRef(new Map<string, { at: number; payload: FiltersPayload }>());
  const overviewCacheRef = useRef(new Map<string, { at: number; payload: OverviewPayload }>());
  const overviewInflightRef = useRef(new Map<string, Promise<OverviewPayload>>());
  const percentileBaselineCacheRef = useRef(new Map<string, { at: number; rows: Array<Record<string, string | number | null>> }>());
  const percentileBaselineHandedCacheRef = useRef(new Map<string, { at: number; rows: Array<Record<string, string | number | null>> }>());
  const movementComparisonCacheRef = useRef(
    new Map<string, { at: number; rows: Array<Record<string, string | number | null>>; splitColumn: string }>()
  );
  const summaryPercentileDistributionCacheRef = useRef(
    new Map<string, { at: number; base: Map<string, number[]>; handed: Map<string, number[]> }>()
  );
  const [abSortColumn, setAbSortColumn] = useState('Pitch #');
  const [abSortDirection, setAbSortDirection] = useState<SortDirection>('asc');
  const suppressNextFilterDateAutofillRef = useRef(false);
  const [manualEntriesSortColumn, setManualEntriesSortColumn] = useState('Date');
  const [manualEntriesSortDirection, setManualEntriesSortDirection] = useState<SortDirection>('desc');
  const [manualProgressSortColumn, setManualProgressSortColumn] = useState('Date');
  const [manualProgressSortDirection, setManualProgressSortDirection] = useState<SortDirection>('desc');
  const [visualOption, setVisualOption] = useState('Play Video');
  const [pitchEditSelectMode, setPitchEditSelectMode] = useState<PitchEditSelectMode>('single');
  const [enableTableColors, setEnableTableColors] = useState(false);
  const [showCellPercentiles, setShowCellPercentiles] = useState(false);
  const [percentileBaselineRequestKey, setPercentileBaselineRequestKey] = useState('');
  const [percentileBaselineRows, setPercentileBaselineRows] = useState<Array<Record<string, string | number | null>>>([]);
  const [loadingPercentileBaseline, setLoadingPercentileBaseline] = useState(false);
  const [loadingSummaryPitchTypePercentiles, setLoadingSummaryPitchTypePercentiles] = useState(false);
  const [summaryPitchTypeDistributions, setSummaryPitchTypeDistributions] = useState<Map<string, number[]>>(new Map());
  const [summaryPitchTypeHandedDistributions, setSummaryPitchTypeHandedDistributions] = useState<Map<string, number[]>>(new Map());
  const [percentileBaselineHandedRequestKey, setPercentileBaselineHandedRequestKey] = useState('');
  const [percentileBaselineHandedRows, setPercentileBaselineHandedRows] = useState<Array<Record<string, string | number | null>>>([]);
  const [movementComparisonRequestKey, setMovementComparisonRequestKey] = useState('');
  const [movementComparisonRows, setMovementComparisonRows] = useState<Array<Record<string, string | number | null>>>([]);
  const [movementComparisonSplitColumn, setMovementComparisonSplitColumn] = useState('');
  const [loadingMovementComparison, setLoadingMovementComparison] = useState(false);
  const [showLeaderboardCorrelation, setShowLeaderboardCorrelation] = useState(false);
  const [correlationOverviewBaseQuery, setCorrelationOverviewBaseQuery] = useState('');
  const [correlationAllStatColumns, setCorrelationAllStatColumns] = useState<string[]>([]);
  const [correlationAllStatRows, setCorrelationAllStatRows] = useState<Array<Record<string, string | number | null>>>([]);
  const [isExportingLeaderboardPdf, setIsExportingLeaderboardPdf] = useState(false);
  const [leaderboardExportFormat, setLeaderboardExportFormat] = useState<'PDF' | 'CSV'>('PDF');
  const [customTables, setCustomTables] = useState<CustomTableConfig[]>([]);
  const [loadingCustomTables, setLoadingCustomTables] = useState(false);
  const [customTablesLoaded, setCustomTablesLoaded] = useState(false);
  const [customTableName, setCustomTableName] = useState('');
  const [selectedCustomTableId, setSelectedCustomTableId] = useState<number | null>(null);
  const proDefaultTableAppliedRef = useRef(false);
  const gcuDefaultTableAppliedRef = useRef(false);
  const pcuDefaultTableAppliedRef = useRef(false);
  const proLeaderboardDefaultAppliedRef = useRef(false);
  const proLeaderboardDateDefaultAppliedRef = useRef(false);

  useEffect(() => {
    dispatchPortalActivity({
      eventType: 'page_view',
      path: dashboardActivityPath('pitching', dashboardPageSlug(dashboardPage)),
      metadata: {
        pageLabel: `Dashboard / Pitching / ${dashboardPage}`,
        section: 'Dashboard',
        suite: 'Pitching',
        subPage: dashboardPage,
        schoolCode: initialSchoolCode,
        tableMode,
        splitBy: dashboardPage === 'Leaderboard' ? (leaderboardViewBy === 'Team' ? 'Pitcher Team' : 'Pitcher') : splitBy,
        visualOption,
        leaderboardViewBy: dashboardPage === 'Leaderboard' ? leaderboardViewBy : '',
      },
    });
  }, [dashboardPage, initialSchoolCode, leaderboardViewBy, splitBy, tableMode, visualOption]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 900px)');
    const sync = () => setIsMobileView(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!isMobileView) return;
    setIsSidebarHidden(true);
  }, [isMobileView]);
  const [customTableColumns, setCustomTableColumns] = useState<string[]>([]);
  const [customColumnToAdd, setCustomColumnToAdd] = useState('');
  const [customSaveState, setCustomSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [customSaveMessage, setCustomSaveMessage] = useState('');
  const [dragColumnIndex, setDragColumnIndex] = useState<number | null>(null);
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [selectedPitchers, setSelectedPitchers] = useState<string[]>(['All']);
  const [selectedHitters, setSelectedHitters] = useState<string[]>(['All']);
  const [selectedPitchTypes, setSelectedPitchTypes] = useState<string[]>(['All']);
  const [selectedBallTypes, setSelectedBallTypes] = useState<string[]>(['Baseball']);
  const [selectedZoneLocations, setSelectedZoneLocations] = useState<string[]>(['All']);
  const [selectedPitchResults, setSelectedPitchResults] = useState<string[]>(['All']);
  const [selectedCountFilters, setSelectedCountFilters] = useState<string[]>(['All']);
  const [selectedAfterCountFilters, setSelectedAfterCountFilters] = useState<string[]>(['All']);
  const [selectedInZone, setSelectedInZone] = useState<string[]>(['All']);

  const [veloMin, setVeloMin] = useState('');
  const [veloMax, setVeloMax] = useState('');
  const [ivbMin, setIvbMin] = useState('');
  const [ivbMax, setIvbMax] = useState('');
  const [hbMin, setHbMin] = useState('');
  const [hbMax, setHbMax] = useState('');
  const [pcMin, setPcMin] = useState('');
  const [pcMax, setPcMax] = useState('');
  const [bfMin, setBfMin] = useState('');
  const [bfMax, setBfMax] = useState('');
  const [ipMin, setIpMin] = useState('');
  const [ipMax, setIpMax] = useState('');

  const [appliedFilterVersion, setAppliedFilterVersion] = useState(0);
  const [postEditCacheBust, setPostEditCacheBust] = useState<number>(0);
  const jaredDashboardTable = useMemo(() => {
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const preferred = customTables.find((item) => normalize(item.name) === 'jaredsdashboard');
    return preferred ?? null;
  }, [customTables]);
  const lastAppliedHomeRequestRef = useRef<number>(0);
  const leaderboardTableExportRef = useRef<HTMLDivElement | null>(null);
  const pcuSearchPlayerDatePendingRef = useRef(false);
  const summaryLocationViewTouchedRef = useRef(false);
  const [releaseView, setReleaseView] = useState('Averages Only');
  const [movementView, setMovementView] = useState('Averages and Pitches');
  const [magnusLine, setMagnusLine] = useState<'Off' | 'Fastball' | 'Sinker'>('Off');
  const [showMagnusAngle, setShowMagnusAngle] = useState(true);
  const [comparisonScope, setComparisonScope] = useState('MLB');
  const [showComparisonDots, setShowComparisonDots] = useState(false);
  const [showComparisonMagnusLine, setShowComparisonMagnusLine] = useState(false);
  const [locationView, setLocationView] = useState('Pitch');
  const [heatmapChartType, setHeatmapChartType] = useState<'Heat' | 'Pitch' | 'QP+'>('Pitch');
  const [heatmapStat, setHeatmapStat] = useState('Frequency');
  const [showTargetSettings, setShowTargetSettings] = useState(false);
  const [targetShapes, setTargetShapes] = useState<Record<string, TargetShape>>({});
  const [releaseHover, setReleaseHover] = useState<ChartHover>(null);
  const [movementHover, setMovementHover] = useState<ChartHover>(null);
  const [releaseLasso, setReleaseLasso] = useState<PlotLasso>(null);
  const [movementLasso, setMovementLasso] = useState<PlotLasso>(null);
  const [locationHover, setLocationHover] = useState<ChartHover>(null);
  const [qpLocationsHover, setQpLocationsHover] = useState<ChartHover>(null);
  const [velocityMainHover, setVelocityMainHover] = useState<ChartHover>(null);
  const [velocityGameHover, setVelocityGameHover] = useState<ChartHover>(null);
  const [velocityInningHover, setVelocityInningHover] = useState<ChartHover>(null);
  const [manualChartHover, setManualChartHover] = useState<ChartHover>(null);
  const [trendHover, setTrendHover] = useState<ChartHover>(null);
  const [headerTooltipHover, setHeaderTooltipHover] = useState<ChartHover>(null);
  const [trendMetric, setTrendMetric] = useState('Velocity (Avg)');
  const [actionMode, setActionMode] = useState<'video' | 'edit' | 'spin' | null>(null);
  const [actionPitches, setActionPitches] = useState<PitchActionPoint[]>([]);
  const [actionIndex, setActionIndex] = useState(0);
  const [editPitchType, setEditPitchType] = useState('');
  const [editPitcher, setEditPitcher] = useState('');
  const [editBallType, setEditBallType] = useState('');
  const [actionSaveState, setActionSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [actionSaveMessage, setActionSaveMessage] = useState('');
  const [actionIsPlaying, setActionIsPlaying] = useState(false);
  const [actionSpinFrame, setActionSpinFrame] = useState(12);

  useEffect(() => {
    if (!homeNavigateRequest) return;
    if (homeNavigateRequest.suite !== 'Pitching') return;
    if (lastAppliedHomeRequestRef.current === homeNavigateRequest.requestId) return;
    if (loadingFilters || !filters) return;
    const isProNavigate =
      String(selectedSchoolCode ?? '').toUpperCase() === 'PRO' ||
      String(selectedSchoolCode ?? '').toUpperCase() === 'MLB' ||
      String(filters?.school_code ?? '').toUpperCase() === 'PRO' ||
      String(filters?.school_code ?? '').toUpperCase() === 'MLB';
    const schoolCode = String(filters?.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase();
    const shouldUsePcuPlayerLatestDate =
      schoolCode === 'PCU' &&
      role !== 'player' &&
      homeNavigateRequest.navigationSource === 'search' &&
      homeNavigateRequest.targetType === 'player';
    lastAppliedHomeRequestRef.current = homeNavigateRequest.requestId;
    pcuSearchPlayerDatePendingRef.current = shouldUsePcuPlayerLatestDate;
    suppressNextFilterDateAutofillRef.current =
      homeNavigateRequest.navigationSource === 'search' ||
      homeNavigateRequest.navigationSource === 'home_leaderboard';
    setDashboardPage(homeNavigateRequest.page ?? 'Summary');
    setStartDate(homeNavigateRequest.startDate);
    setEndDate(homeNavigateRequest.endDate);
    if (homeNavigateRequest.navigationSource === 'home_leaderboard') {
      setWithVideo('All');
      setBreakLines('None');
      setHand('All');
      setBatterSide('All');
      setVenue('All');
      setQpLocations('All');
      setSelectedPitchTypes(['All']);
      setSelectedBallTypes(['Baseball']);
      setSelectedZoneLocations(['All']);
      setSelectedPitchResults(['All']);
      setSelectedCountFilters(['All']);
      setSelectedAfterCountFilters(['All']);
      setSelectedInZone(['All']);
      setVeloMin('');
      setVeloMax('');
      setIvbMin('');
      setIvbMax('');
      setHbMin('');
      setHbMax('');
      setPcMin('');
      setPcMax('');
      setBfMin('');
      setBfMax('');
      setIpMin('');
      setIpMax('');
      setTableMode('Live');
      setSplitBy('Pitch Types');
      setLeaderboardViewBy('Player');
      if (isProNavigate) setLevel('MLB');
    }
    if (homeNavigateRequest.targetType === 'player') {
      setTeamType('All');
      setSelectedPitchers([homeNavigateRequest.targetValue]);
      setSelectedHitters(['All']);
      if (isProNavigate && homeNavigateRequest.navigationSource === 'search') {
        setLevel('All');
      } else if (
        (String(selectedSchoolCode ?? '').toUpperCase() === 'LEAGUE' || String(filters?.school_code ?? '').toUpperCase() === 'LEAGUE') &&
        homeNavigateRequest.navigationSource === 'search'
      ) {
        const targetNorm = homeNavigateRequest.targetValue.trim().toLowerCase();
        const inCurrentLevel = (filters.pitchers ?? []).some((p) => p.trim().toLowerCase() === targetNorm);
        if (!inCurrentLevel) setLevel('All');
      }
    } else {
      setTeamType(homeNavigateRequest.targetValue);
      setSelectedPitchers(['All']);
      setSelectedHitters(['All']);
      if (
        (String(selectedSchoolCode ?? '').toUpperCase() === 'LEAGUE' || String(filters?.school_code ?? '').toUpperCase() === 'LEAGUE') &&
        homeNavigateRequest.navigationSource === 'search'
      ) {
        const targetNorm = homeNavigateRequest.targetValue.trim().toLowerCase();
        const inCurrentLevel = (filters.team_types ?? []).some((t) => t.trim().toLowerCase() === targetNorm);
        if (!inCurrentLevel) setLevel('All');
      }
    }
    setAppliedFilterVersion((current) => current + 1);
  }, [homeNavigateRequest, loadingFilters, filters, selectedSchoolCode, role]);
  const [actionSideBySide, setActionSideBySide] = useState(false);
  // Multi-Camera view: this pitch's own camera angles shown together (not to
  // be confused with actionSideBySide/Compare, which shows two DIFFERENT
  // pitches). Mutually exclusive with Compare -- turning one on turns the
  // other off, matching how each fully replaces the video stage's layout.
  const [actionMultiCameraMode, setActionMultiCameraMode] = useState(false);
  const [actionCompareLayout, setActionCompareLayout] = useState<ActionCompareLayout>('side-by-side');
  const [actionLeftPitchKey, setActionLeftPitchKey] = useState('');
  const [actionRightPitchKey, setActionRightPitchKey] = useState('');
  const [actionCompareVideoOverrides, setActionCompareVideoOverrides] = useState<Record<string, { video_clip_1?: string | null; video_clip_2?: string | null; video_clip_3?: string | null }>>({});
  const [actionVideoPlaying, setActionVideoPlaying] = useState(false);
  const [actionVideoTime, setActionVideoTime] = useState(0);
  const [actionVideoDuration, setActionVideoDuration] = useState(0);
  const [actionPlaybackRate, setActionPlaybackRate] = useState(1);
  const [actionVideoLoop, setActionVideoLoop] = useState(false);
  const [actionVideoRefreshNonce, setActionVideoRefreshNonce] = useState(0);
  const [actionVideoLookupLoading, setActionVideoLookupLoading] = useState(false);
  // Trackman can upload more than one Edgertronic camera angle per pitch
  // (video_clip_1/2/3). One shared index drives whichever clip array is
  // currently on screen -- single view, or both sides of Compare (so
  // "Camera 2" means the same physical angle on both sides when the two
  // pitches have matching camera counts, the common case). Reset whenever
  // the active pitch(es) change so a stale index from a different pitch's
  // camera set never carries over.
  const [actionCameraIndex, setActionCameraIndex] = useState(0);
  // Compare mode lets each side pick its own camera angle independently
  // (e.g. left = Edger, right = Camera 2), unlike single view which only
  // ever has one clip array to index into.
  const [actionCameraIndexLeft, setActionCameraIndexLeft] = useState(0);
  const [actionCameraIndexRight, setActionCameraIndexRight] = useState(0);
  // Multi-camera view: view 2+ of THIS pitch's own camera angles together,
  // in the modal itself, without exporting a file first -- distinct from
  // Compare mode (actionSideBySide), which shows two DIFFERENT pitches
  // side by side. Defaults to a single camera selected (index 0); clicking
  // additional camera tabs toggles them in/out (min 1 stays selected).
  // Reset whenever the active pitch changes so a stale selection referencing
  // a camera index this pitch doesn't have never carries over.
  const [actionMultiCameraIndices, setActionMultiCameraIndices] = useState<number[]>([0]);
  // Manual click-and-drag pan + zoom for the video, mainly so a
  // portrait/oddly-framed camera angle can be recentered/zoomed by hand
  // regardless of how the browser happens to be sizing the element -- a
  // direct escape hatch that doesn't depend on getting object-fit/aspect
  // CSS exactly right for every camera. Reset whenever the pitch or camera
  // selection changes so a stale pan/zoom never carries over. Compare mode
  // uses the same single pan/zoom pair applied to both panes at once (kept
  // in sync visually), matching how playback/scrubbing is already shared
  // across both compare videos elsewhere in this component.
  const [actionVideoZoom, setActionVideoZoom] = useState(1);
  const [actionVideoPan, setActionVideoPan] = useState({ x: 0, y: 0 });
  const actionVideoPanDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  // Bulk video export: pick current pitch vs. every pitch in the modal, and
  // which camera angle(s) to include, then stream the concatenated result
  // back from /api/dashboard/pitching/video-export as a file download.
  const [actionExportMenuOpen, setActionExportMenuOpen] = useState(false);
  const [actionExportScope, setActionExportScope] = useState<'current' | 'all'>('current');
  const [actionExportCameras, setActionExportCameras] = useState<Array<'edger' | '1' | '2' | '3'>>(['edger']);
  // 'sequential' (default) is the original export -- each selected camera's
  // clips concatenated across all pitches before moving to the next camera.
  // 'combined' shows every selected camera side by side for one pitch, then
  // advances to the next pitch's composite -- needs 2+ cameras selected.
  const [actionExportMode, setActionExportMode] = useState<'sequential' | 'combined'>('sequential');
  // Whether the metrics + strike-zone side panel is burned into the exported
  // video -- on by default (matches prior behavior before this toggle
  // existed), off gives a plain video-only export.
  const [actionExportShowMetrics, setActionExportShowMetrics] = useState(true);
  const [actionExportState, setActionExportState] = useState<'idle' | 'exporting' | 'error'>('idle');
  const [actionExportMessage, setActionExportMessage] = useState('');
  // Elapsed export time, driven by chunks actually arriving off the response
  // stream (see runActionVideoExport) rather than a plain timer -- this is a
  // multi-minute server-side ffmpeg job with no discrete progress signal, so
  // "time elapsed while bytes keep arriving" is the only honest indicator
  // that it's still alive rather than hung.
  const [actionExportElapsedSeconds, setActionExportElapsedSeconds] = useState(0);
  const [breakdownMode, setBreakdownMode] = useState(false);
  const [breakdownToolbarVisible, setBreakdownToolbarVisible] = useState(true);
  const [breakdownTool, setBreakdownTool] = useState<BreakdownTool>('line');
  const [breakdownColor, setBreakdownColor] = useState('#facc15');
  const [breakdownWidth, setBreakdownWidth] = useState(4);
  const [breakdownTextFontSize, setBreakdownTextFontSize] = useState(36);
  const [breakdownAnnotations, setBreakdownAnnotations] = useState<BreakdownAnnotation[]>([]);
  const [activeBreakdownAnnotation, setActiveBreakdownAnnotation] = useState<BreakdownAnnotation | null>(null);
  const [selectedBreakdownTextId, setSelectedBreakdownTextId] = useState('');
  const [draggingBreakdownAnnotation, setDraggingBreakdownAnnotation] = useState<BreakdownAnnotationDragState | null>(null);
  const [breakdownAngleMode, setBreakdownAngleMode] = useState<'acute' | 'obtuse'>('acute');
  const [breakdownAnglePending, setBreakdownAnglePending] = useState<Array<{ x: number; y: number }>>([]);
  const [breakdownNoteText, setBreakdownNoteText] = useState('');
  const [breakdownMessage, setBreakdownMessage] = useState('');
  const [breakdownSaving, setBreakdownSaving] = useState(false);
  const [showBreakdownNotePanel, setShowBreakdownNotePanel] = useState(false);
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'ready'>('idle');
  const [recordingUrl, setRecordingUrl] = useState('');
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recordingDownloadName, setRecordingDownloadName] = useState('video-breakdown.webm');
  const [isLightTheme, setIsLightTheme] = useState(true);
  const [isActionModalFullscreen, setIsActionModalFullscreen] = useState(false);
  const isLeaderboardPage = dashboardPage === 'Leaderboard';
  const effectiveSplitBy = isLeaderboardPage ? (leaderboardViewBy === 'Team' ? 'Pitcher Team' : 'Pitcher') : splitBy;
  const singleActionVideoRef = useRef<HTMLVideoElement | null>(null);
  const leftCompareVideoRef = useRef<HTMLVideoElement | null>(null);
  const rightCompareVideoRef = useRef<HTMLVideoElement | null>(null);
  // One ref per tile in Multi-Camera view (up to 3 today, since a pitch only
  // ever has up to 3 camera slots) -- indexed to match
  // actionMultiCameraIndices' order, not fixed like the single/compare refs
  // above, since which/how-many tiles are showing changes as the user
  // toggles cameras on and off.
  const multiCameraVideoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  // Each tile's real video dimensions, read for free from the <video>
  // element's own loadedmetadata event (no extra network request) -- used
  // to weight the 2-up split by aspect ratio, matching the export feature's
  // fix for the same "landscape clip squeezed into a narrow cell looks
  // tiny" problem. Keyed by tile index, reset whenever the pitch/camera
  // selection changes so a stale dimension from a different clip never
  // carries over into a new layout.
  const [actionMultiCameraDims, setActionMultiCameraDims] = useState<Array<{ width: number; height: number } | null>>([]);
  const actionViewRef = useRef<HTMLDivElement | null>(null);
  const actionModalCardRef = useRef<HTMLDivElement | null>(null);
  const breakdownCaptureRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingAnimationRef = useRef<number | null>(null);
  const breakdownAnnotationsRef = useRef<{
    annotations: BreakdownAnnotation[];
    active: BreakdownAnnotation | null;
    pending: Array<{ x: number; y: number }>;
    pendingColor: string;
    pendingWidth: number;
    pendingAngleMode: 'acute' | 'obtuse';
  }>({
    annotations: [],
    active: null,
    pending: [],
    pendingColor: '#facc15',
    pendingWidth: 4,
    pendingAngleMode: 'acute',
  });
  const latestOverviewRequestKeyRef = useRef('');
  const actionVideoRetryKeysRef = useRef(new Set<string>());
  const actionCompareVideoLookupKeysRef = useRef(new Set<string>());
  const actionVideoLookupCacheRef = useRef(new Map<number, Pick<PitchActionPoint, 'video_clip_1' | 'video_clip_2' | 'video_clip_3'>>());
  // video-lookup's response includes which camera slot (if any) is actually
  // Edgertronic footage per pitch -- kept in a side map rather than on
  // PitchActionPoint itself, since that type is shared with the overview
  // payload which doesn't carry this field. Keyed by pitch_event_id, value
  // is [cam1IsEdger, cam2IsEdger, cam3IsEdger].
  const actionVideoEdgerFlagsRef = useRef(new Map<number, [boolean, boolean, boolean]>());

  useEffect(() => {
    breakdownAnnotationsRef.current = {
      annotations: breakdownAnnotations,
      active: activeBreakdownAnnotation,
      pending: breakdownAnglePending,
      pendingColor: breakdownColor,
      pendingWidth: breakdownWidth,
      pendingAngleMode: breakdownAngleMode,
    };
  }, [activeBreakdownAnnotation, breakdownAngleMode, breakdownAnglePending, breakdownAnnotations, breakdownColor, breakdownWidth]);

  useEffect(() => {
    const syncTheme = () => setIsLightTheme(document.body.classList.contains('theme-light'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      const fullscreenDoc = document as Document & { webkitFullscreenElement?: Element | null };
      const fullscreenElement = document.fullscreenElement ?? fullscreenDoc.webkitFullscreenElement ?? null;
      setIsActionModalFullscreen(fullscreenElement === actionModalCardRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
    };
  }, []);

  const isLeague =
    String(selectedSchoolCode ?? '').toUpperCase() === 'LEAGUE' ||
    String(filters?.school_code ?? '').toUpperCase() === 'LEAGUE';
  const isPro =
    String(selectedSchoolCode ?? '').toUpperCase() === 'PRO' ||
    String(selectedSchoolCode ?? '').toUpperCase() === 'MLB' ||
    String(filters?.school_code ?? '').toUpperCase() === 'PRO' ||
    String(filters?.school_code ?? '').toUpperCase() === 'MLB';
  const dnaSharedFilterParams = useMemo(() => {
    const params = new URLSearchParams();
    const apiTeamType = isLeague
      ? resolveLeagueTeamTypeForApi(teamType, [filters?.pitchers_by_team_code, filters?.opp_hitters_by_team_code])
      : teamType;
    if (teamType && teamType !== 'All') params.set('team_type', apiTeamType);
    if ((isPro || isLeague) && level && level !== 'All') params.set('level', level);
    else if (!isPro && !isLeague && PRO_LEVEL_FILTER_OPTIONS.includes(level) && level !== 'All') params.set('level', level);
    if (withVideo && withVideo !== 'All') params.set('with_video', withVideo);
    if (breakLines && breakLines !== 'None') params.set('break_lines', breakLines);
    if (hand && hand !== 'All') params.set('hand', hand);
    if (batterSide && batterSide !== 'All') params.set('batter_side', batterSide);
    if (venue && venue !== 'All') params.set('venue', venue);
    if (!isPro && sessionType) params.set('session_type', sessionType);
    if (qpLocations && qpLocations !== 'All') params.set('qp_locations', qpLocations);

    const pitchersParam = toParamValue(selectedPitchers);
    const hittersParam = toParamValue(selectedHitters);
    const pitchTypesParam = toParamValue(selectedPitchTypes);
    const ballTypesParam = toBallTypesParamValue(selectedBallTypes);
    const zoneParam = toParamValue(selectedZoneLocations);
    const resultsParam = toParamValue(selectedPitchResults);
    const countParam = toParamValue(selectedCountFilters);
    const afterCountParam = toParamValue(selectedAfterCountFilters);
    const inZoneParam = toParamValue(selectedInZone);

    if (pitchersParam) params.set('pitcher', pitchersParam);
    if (hittersParam) params.set('opp_hitter', hittersParam);
    if (pitchTypesParam) params.set('pitch_types', pitchTypesParam);
    if (!isPro && !isLeague && ballTypesParam) params.set('ball_types', ballTypesParam);
    if (zoneParam) params.set('zone_locations', zoneParam);
    if (resultsParam) params.set('pitch_results', resultsParam);
    if (countParam) params.set('count_filter', countParam);
    if (afterCountParam) params.set('after_count_filter', afterCountParam);
    if (inZoneParam) params.set('in_zone', inZoneParam);
    if (veloMin) params.set('velo_min', veloMin);
    if (veloMax) params.set('velo_max', veloMax);
    if (ivbMin) params.set('ivb_min', ivbMin);
    if (ivbMax) params.set('ivb_max', ivbMax);
    if (hbMin) params.set('hb_min', hbMin);
    if (hbMax) params.set('hb_max', hbMax);
    if (pcMin) params.set('pc_min', pcMin);
    if (pcMax) params.set('pc_max', pcMax);
    if (bfMin) params.set('bf_min', bfMin);
    if (bfMax) params.set('bf_max', bfMax);
    if (ipMin) params.set('ip_min', ipMin);
    if (ipMax) params.set('ip_max', ipMax);
    return params;
  }, [
    isLeague,
    isPro,
    teamType,
    filters?.pitchers_by_team_code,
    filters?.opp_hitters_by_team_code,
    level,
    withVideo,
    breakLines,
    hand,
    batterSide,
    venue,
    sessionType,
    qpLocations,
    selectedPitchers,
    selectedHitters,
    selectedPitchTypes,
    selectedBallTypes,
    selectedZoneLocations,
    selectedPitchResults,
    selectedCountFilters,
    selectedAfterCountFilters,
    selectedInZone,
    veloMin,
    veloMax,
    ivbMin,
    ivbMax,
    hbMin,
    hbMax,
    pcMin,
    pcMax,
    bfMin,
    bfMax,
    ipMin,
    ipMax,
  ]);
  const collegeLevelPercentileOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const raw of [...(filters?.level_options ?? []), ...NCAA_LEVEL_FILTER_OPTIONS]) {
      const value = String(raw ?? '').trim();
      if (!value) continue;
      const upper = value.toUpperCase();
      if (upper === 'MLB' || upper === 'AAA') continue;
      if (seen.has(upper)) continue;
      seen.add(upper);
      options.push(value);
    }
    return options;
  }, [filters?.level_options]);
  const collegePercentileDefault = collegeLevelPercentileOptions.includes(DEFAULT_COLLEGE_PERCENTILE_SCOPE)
    ? DEFAULT_COLLEGE_PERCENTILE_SCOPE
    : (collegeLevelPercentileOptions[0] ?? 'All');
  const percentileTeamLabel = useMemo(() => {
    const school = String(filters?.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase();
    if (school && school !== 'PRO' && school !== 'LEAGUE') return school;
    const teamRaw = String(teamType ?? '').trim();
    if (teamRaw && teamRaw !== 'All' && isLikelyLeagueTeamCode(teamRaw)) return teamRaw.toUpperCase();
    return 'Team';
  }, [filters?.school_code, selectedSchoolCode, teamType]);
  const percentileScopeOptions = useMemo(
    () => [
      ...collegeLevelPercentileOptions.map((value) => ({ value, label: value })),
      { value: 'MLB', label: 'MLB' },
      { value: 'TEAM', label: percentileTeamLabel },
    ],
    [collegeLevelPercentileOptions, percentileTeamLabel]
  );
  // Movement-plot comparison-population scope. PRO always compares to MLB;
  // league sites reuse the same level/MLB/TEAM option set as percentile scope.
  const movementComparisonScopeOptions = percentileScopeOptions;
  const comparisonScopeLabel = isPro ? 'MLB' : (comparisonScope === 'TEAM' ? percentileTeamLabel : comparisonScope);
  const activeSchoolBrand = useMemo(
    () => resolveSchoolBrand(String(filters?.school_code ?? selectedSchoolCode ?? 'PCU')),
    [filters?.school_code, selectedSchoolCode]
  );
  const actionModalTheme = {
    panelBg: isLightTheme ? '#f3f4f6' : '#05070b',
    panelText: isLightTheme ? '#1f2937' : '#f8fafc',
    textStrong: isLightTheme ? '#111827' : '#f8fafc',
    muted: isLightTheme ? '#475569' : '#cbd5e1',
    softMuted: isLightTheme ? '#4b5563' : '#94a3b8',
    border: isLightTheme ? '#d1d5db' : 'rgba(148,163,184,0.28)',
    controlBg: isLightTheme ? '#fff' : 'rgba(15,23,42,0.96)',
    controlSoftBg: isLightTheme ? '#f8fafc' : 'rgba(2,6,23,0.88)',
    toolbarBg: isLightTheme ? '#fff' : 'rgba(2,6,23,0.92)',
    zoneStroke: isLightTheme ? '#111827' : '#f8fafc',
  };
  const actionModalButtonStyle = {
    background: actionModalTheme.controlBg,
    color: actionModalTheme.muted,
    borderColor: actionModalTheme.border,
  };
  const actionModalSearchTheme: 'light' | 'dark' = isLightTheme ? 'light' : 'dark';
  const actionModalSelectMenuStyle: React.CSSProperties = {
    zIndex: 5000,
    maxHeight: 'min(360px, 48vh)',
    boxShadow: isLightTheme ? '0 18px 44px rgba(15,23,42,0.22)' : '0 18px 44px rgba(0,0,0,0.55)',
  };
  const isGcu =
    String(selectedSchoolCode ?? '').toUpperCase() === 'GCU' ||
    String(filters?.school_code ?? '').toUpperCase() === 'GCU';
  const isPcu =
    String(selectedSchoolCode ?? '').toUpperCase() === 'PCU' ||
    String(filters?.school_code ?? '').toUpperCase() === 'PCU';
  const isPitchEditDisplay = canUsePitchEdits && visualOption === 'Pitch Edit';
  const isPitchEditLassoEnabled = isPitchEditDisplay && pitchEditSelectMode === 'lasso';
  const orientX = (x: number, pointSchoolCode?: string | null): number => {
    const shouldFlip =
      pointSchoolCode != null && pointSchoolCode !== ''
        ? String(pointSchoolCode).toUpperCase() === 'PRO'
        : isPro;
    return shouldFlip ? -x : x;
  };
  const canShowLeagueHeavyPages = !isLeague;
  // Hidden on all sites for everyone per product decision -- kept in the
  // code (not deleted) in case these tabs come back in the future.
  const canShowQpLocationsTab = false;
  const canShowVeloManualEntry = false && !isLeague && !isPro;
  const allPitchersSelected = selectedPitchers.length === 0 || selectedPitchers.every((value) => value === 'All');
  const allHittersSelected = selectedHitters.length === 0 || selectedHitters.every((value) => value === 'All');
  const isLeagueAllSelection = isLeague && teamType === 'All' && allPitchersSelected && allHittersSelected;
  const hideLeagueSummaryCharts =
    isLeague && dashboardPage === 'Summary' && isLeagueAllSelection;
  const leagueWindowDays = useMemo(() => {
    if (!isLeague || !startDate || !endDate) return 0;
    const start = Date.parse(startDate);
    const end = Date.parse(endDate);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    return Math.max(0, Math.floor((end - start) / 86400000) + 1);
  }, [isLeague, startDate, endDate]);
  const proWindowDays = useMemo(() => {
    if (!isPro || !startDate || !endDate) return 0;
    const start = Date.parse(startDate);
    const end = Date.parse(endDate);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    return Math.max(0, Math.floor((end - start) / 86400000) + 1);
  }, [isPro, startDate, endDate]);
  const isProAllSelection = isPro && teamType === 'All' && allPitchersSelected && allHittersSelected;
  const shouldForceLeagueFastTable =
    isLeague && (dashboardPage === 'Summary' || dashboardPage === 'Leaderboard') && leagueWindowDays > 14 && isLeagueAllSelection;
  const filteredPitchers = useMemo(() => {
    if (!filters) return [];
    if (teamType === 'All') return filters.pitchers ?? [];
    return filters.pitchers_by_team_code?.[teamType] ?? filters.pitchers ?? [];
  }, [filters, teamType]);
  const filteredOppHitters = useMemo(() => {
    if (!filters) return [];
    if (teamType === 'All') return filters.opp_hitters ?? [];
    return filters.opp_hitters_by_team_code?.[teamType] ?? filters.opp_hitters ?? [];
  }, [filters, teamType]);
  const pitcherOptions = useMemo(() => (filters ? [{ value: 'All', label: 'All' }, ...toOptions(filteredPitchers, true)] : []), [filters, filteredPitchers]);
  const hitterOptions = useMemo(() => (filters ? [{ value: 'All', label: 'All' }, ...toOptions(filteredOppHitters, true)] : []), [filters, filteredOppHitters]);
  const pitchTypeOptions = useMemo(() => (filters ? [{ value: 'All', label: 'All' }, ...toOptions(filters.pitch_types)] : []), [filters]);
  const ballTypeOptions = useMemo(() => (filters ? [{ value: 'All', label: 'All' }, ...toOptions(filters.ball_types ?? [])] : []), [filters]);
  const zoneLocationOptions = useMemo(
    () => (filters ? [{ value: 'All', label: 'All' }, ...toOptions(filters.zone_locations)] : []),
    [filters]
  );
  const pitchResultOptions = useMemo(
    () => (filters ? [{ value: 'All', label: 'All' }, ...toOptions(filters.pitch_results)] : []),
    [filters]
  );
  const countOptions = useMemo(() => (filters ? [{ value: 'All', label: 'All' }, ...toOptions(filters.count_options)] : []), [filters]);
  const afterCountOptions = useMemo(
    () => (filters ? [{ value: 'All', label: 'All' }, ...toOptions(filters.after_count_options)] : []),
    [filters]
  );
  const inZoneOptions = useMemo(
    () => (filters ? [{ value: 'All', label: 'All' }, ...toOptions(filters.in_zone_options.filter((option) => option !== 'All'))] : []),
    [filters]
  );
  const pitchEditPitchTypeOptions = useMemo(() => {
    const fromFilters = filters?.pitch_types ?? [];
    const all = Array.from(new Set([...fromFilters, ...actionPitches.map((pitch) => pitch.pitch_type).filter(Boolean)]));
    return toOptions(all);
  }, [filters?.pitch_types, actionPitches]);
  const pitchEditPitcherOptions = useMemo(() => {
    const fromFilters = filters?.pitchers ?? [];
    const all = Array.from(new Set([...fromFilters, ...actionPitches.map((pitch) => pitch.pitcher).filter(Boolean)]));
    return toOptions(all, true);
  }, [filters?.pitchers, actionPitches]);
  const pitchEditBallTypeOptions = useMemo(() => {
    const fromFilters = filters?.ball_types ?? [];
    const defaults = ['Baseball', 'Weighted Ball'];
    const all = Array.from(new Set([...defaults, ...fromFilters])).filter(Boolean);
    return toOptions(all);
  }, [filters?.ball_types]);

  useEffect(() => {
    if (!canShowVeloManualEntry && dashboardPage === 'Velo Manual Entry') {
      setDashboardPage('Summary');
    }
  }, [canShowVeloManualEntry, dashboardPage]);
  useEffect(() => {
    if (!canShowQpLocationsTab && dashboardPage === 'QP Locations') {
      setDashboardPage('Summary');
    }
  }, [canShowQpLocationsTab, dashboardPage]);
  useEffect(() => {
    if (!canShowLeagueHeavyPages && (dashboardPage === 'Velocity' || dashboardPage === 'Trend')) {
      setDashboardPage('Summary');
    }
  }, [canShowLeagueHeavyPages, dashboardPage]);
  useEffect(() => {
    if (dashboardPage !== 'Pitch Log') {
      pitchLogDefaultTableAppliedRef.current = false;
      return;
    }
    if (pitchLogDefaultTableAppliedRef.current) return;
    if (tableMode !== 'Stuff') {
      setTableMode('Stuff');
      setAppliedFilterVersion((current) => current + 1);
    }
    pitchLogDefaultTableAppliedRef.current = true;
  }, [dashboardPage, tableMode]);
  useEffect(() => {
    if (!isLeague && !isPro && leaderboardViewBy !== 'Player') {
      setLeaderboardViewBy('Player');
    }
  }, [isLeague, isPro, leaderboardViewBy]);
  useEffect(() => {
    if (!isLeague) return;
    const allowedTableModes = new Set(['Stuff', 'Expected Movement', 'Process', 'Results', 'Bullpen', 'Live', 'Usage', 'Pitch Usage', 'Raw Data', 'Batted Ball Data', 'Custom']);
    if (!allowedTableModes.has(tableMode)) {
      setTableMode('Live');
    }
    const allowedSplitBy = new Set([
      'All',
      'Pitch Types',
      'Pitcher',
      'Pitcher Hand',
      'Batter Hand',
      'Count',
      'After Count',
      'Venue',
      'Zone Location',
      'Times Through Order',
      'Inning',
      'Pitch Count',
      'Velocity',
      'IVB',
      'HB',
      'Batter',
      'Catcher',
      'Pitcher Team',
    ]);
    if (!allowedSplitBy.has(splitBy)) {
      setSplitBy('Pitch Types');
    }
  }, [isLeague, tableMode, splitBy]);
  useEffect(() => {
    if (!isLeaderboardPage) setHeaderTooltipHover(null);
  }, [isLeaderboardPage]);

  const manualPitcherOptions = useMemo(() => {
    const fromFilters = filters?.pitchers ?? [];
    const fromManual = manualEntries.map((entry) => entry.pitcher).filter(Boolean);
    const unique = Array.from(new Set([...fromFilters, ...fromManual])).sort((a, b) => a.localeCompare(b));
    return [{ value: 'All', label: 'All' }, ...toOptions(unique, true)];
  }, [filters?.pitchers, manualEntries]);
  useEffect(() => {
    const normalized = reconcileMultiSelection(selectedPitchers, pitcherOptions);
    if (normalized.length !== selectedPitchers.length || normalized.some((value, index) => value !== selectedPitchers[index])) {
      setSelectedPitchers(normalized);
    }
  }, [pitcherOptions, selectedPitchers]);

  useEffect(() => {
    const normalized = reconcileMultiSelection(selectedHitters, hitterOptions);
    if (normalized.length !== selectedHitters.length || normalized.some((value, index) => value !== selectedHitters[index])) {
      setSelectedHitters(normalized);
    }
  }, [hitterOptions, selectedHitters]);
  const manualThrowTypeOptions = useMemo(() => {
    const defaults = ['Pulldowns', 'Mound Velo', 'Plyo Velo', 'Bullpen', 'Other'];
    const fromManual = manualEntries.map((entry) => entry.throw_type).filter(Boolean);
    return Array.from(new Set([...defaults, ...fromManual]));
  }, [manualEntries]);
  const manualPlyoDrillOptions = useMemo(() => {
    const values = manualEntries
      .filter((entry) => entry.throw_type === 'Plyo Velo' && entry.plyo_drill.trim().length > 0)
      .map((entry) => entry.plyo_drill.trim());
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }, [manualEntries]);
  const manualFilteredEntries = useMemo(() => {
    return manualEntries.filter((entry) => {
      if (manualPitcherFilter !== 'All' && entry.pitcher !== manualPitcherFilter) return false;
      if (!manualTypeFilter.includes('All') && !manualTypeFilter.includes(entry.throw_type)) return false;
      if (manualDateStart && entry.entry_date < manualDateStart) return false;
      if (manualDateEnd && entry.entry_date > manualDateEnd) return false;
      const wMin = Number(manualWeightMin);
      const wMax = Number(manualWeightMax);
      if (Number.isFinite(wMin) && entry.ball_weight_oz < wMin) return false;
      if (Number.isFinite(wMax) && entry.ball_weight_oz > wMax) return false;
      return true;
    });
  }, [manualDateEnd, manualDateStart, manualEntries, manualPitcherFilter, manualTypeFilter, manualWeightMax, manualWeightMin]);
  const manualKpiSeriesOptions = useMemo(
    () =>
      Array.from(new Set(manualFilteredEntries.map((entry) => manualVelocitySeriesKey(entry))))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    [manualFilteredEntries]
  );
  const manualKpiFilteredEntries = useMemo(() => {
    if (manualKpiSeriesFilter.includes('All')) return manualFilteredEntries;
    const selected = new Set(manualKpiSeriesFilter);
    return manualFilteredEntries.filter((entry) => selected.has(manualVelocitySeriesKey(entry)));
  }, [manualFilteredEntries, manualKpiSeriesFilter]);
  useEffect(() => {
    if (manualKpiSeriesFilter.includes('All')) return;
    const valid = new Set(manualKpiSeriesOptions.map((option) => option.value));
    const next = manualKpiSeriesFilter.filter((value) => valid.has(value));
    if (next.length === manualKpiSeriesFilter.length) return;
    setManualKpiSeriesFilter(next.length ? next : ['All']);
  }, [manualKpiSeriesFilter, manualKpiSeriesOptions]);
  const manualKpis = useMemo(() => {
    if (!manualKpiFilteredEntries.length) return null;
    const velocities = manualKpiFilteredEntries.map((entry) => entry.velocity_mph).filter((value) => Number.isFinite(value));
    const avg = velocities.length ? velocities.reduce((sum, value) => sum + value, 0) / velocities.length : null;
    const peak = velocities.length ? Math.max(...velocities) : null;
    const typeCount = new Set(manualKpiFilteredEntries.map((entry) => manualVelocitySeriesKey(entry))).size;
    return {
      entries: manualKpiFilteredEntries.length,
      avg,
      peak,
      typeCount,
    };
  }, [manualKpiFilteredEntries]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 60000);
    setLoadingFilters(true);
    setError('');
    const filterParams = new URLSearchParams();
    if (level) filterParams.set('level', level);
    filterParams.set('client_cache_version', PITCHING_FILTER_CLIENT_CACHE_VERSION);
    const filterKey = `/api/dashboard/pitching/filters?${filterParams.toString()}`;
    const filterTtlMs = 120000;
    const applyFiltersPayload = (payload: FiltersPayload) => {
      autoFallbackAppliedRef.current = false;
      setFilters(payload);
      setTeamType(pickDefaultTeamType(payload.team_types ?? [], payload.school_code ?? ''));
      if (suppressNextFilterDateAutofillRef.current) {
        suppressNextFilterDateAutofillRef.current = false;
        return;
      }
      const playerLastDate = clampYmdToToday(payload.player_last_date ?? '');
      const latestDate = clampYmdToToday(playerLastDate || (payload.max_date ?? payload.min_date ?? ''));
      const nextDate = latestDate || toYmdNow();
      const minDate = payload.min_date ?? '';
      const isLeagueSchool = String(payload.school_code ?? '').toUpperCase() === 'LEAGUE';
      const isProSchool = String(payload.school_code ?? '').toUpperCase() === 'PRO';
      if (isPlayerRole && !isLeagueSchool && !isProSchool) {
        const schoolCode = String(payload.school_code ?? '').trim().toUpperCase();
        if (schoolCode === 'PCU') {
          setStartDate(nextDate);
          setEndDate(nextDate);
          return;
        }
        const defaultSeasonStart = schoolCode === 'CNU' ? '2026-01-30' : '2026-02-13';
        const seasonStart = minDate && minDate > defaultSeasonStart ? minDate : defaultSeasonStart;
        setStartDate(seasonStart);
        setEndDate(nextDate || seasonStart);
      } else if (isLeagueSchool) {
        const leagueStart = minDate && minDate > LEAGUE_SEASON_START ? minDate : LEAGUE_SEASON_START;
        if (level === 'D1') {
          setStartDate(LEAGUE_SEASON_START);
          setEndDate(LEAGUE_D1_SEASON_END);
        } else {
          setStartDate(leagueStart);
          setEndDate(nextDate || leagueStart);
        }
      } else {
        setStartDate(nextDate);
        setEndDate(nextDate);
      }
    };
    const cached = filtersCacheRef.current.get(filterKey);
    if (cached && Date.now() - cached.at < filterTtlMs) {
      applyFiltersPayload(cached.payload);
      setLoadingFilters(false);
      window.clearTimeout(timeoutId);
      return () => {
        active = false;
        window.clearTimeout(timeoutId);
        controller.abort();
      };
    }
    const requestPromise = (async () => {
      const response = await fetch(filterKey, { signal: controller.signal, cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as FiltersPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load dashboard filters.');
      return payload;
    })();
    requestPromise
      .then((payload) => {
        if (!active) return;
        filtersCacheRef.current.set(filterKey, { at: Date.now(), payload });
        applyFiltersPayload(payload);
      })
      .catch((requestError) => {
        if (!active) return;
        if (controller.signal.aborted) return;
        if (requestError instanceof DOMException && requestError.name === 'AbortError') {
          if (timedOut) setError('Timed out loading pitching filters. Please retry.');
          return;
        }
        setError(requestError instanceof Error ? requestError.message : 'Failed to load dashboard filters.');
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (active) setLoadingFilters(false);
      });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [level]);

  useEffect(() => {
    if (!manualDate) setManualDate(toYmdNow());
  }, [manualDate]);

  useEffect(() => {
    if (!isPro) return;
    if (stuffLevel !== 'Pro') setStuffLevel('Pro');
  }, [isPro, stuffLevel]);

  useEffect(() => {
    if (!isPro) return;
    if (!PRO_LEVEL_FILTER_OPTIONS.includes(level)) setLevel('MLB');
  }, [isPro, level]);

  useEffect(() => {
    if (isPro || !isLeague) return;
    const options = collegeLevelPercentileOptions.length ? collegeLevelPercentileOptions : NCAA_LEVEL_FILTER_OPTIONS;
    const nextDefault = options.includes('D1') ? 'D1' : (options[0] ?? 'All');
    const isProOnlyLevel = level === 'MLB' || level === 'AAA';
    if (!level || isProOnlyLevel || !options.includes(level)) setLevel(nextDefault);
  }, [collegeLevelPercentileOptions, isPro, isLeague, level]);

  useEffect(() => {
    if (isPro) return;
    const validScopes = new Set([...collegeLevelPercentileOptions, 'MLB', 'TEAM']);
    if (!validScopes.has(leaderboardPercentileScope)) setLeaderboardPercentileScope(collegePercentileDefault);
    if (!validScopes.has(summaryPercentileScope)) setSummaryPercentileScope(collegePercentileDefault);
  }, [collegeLevelPercentileOptions, collegePercentileDefault, isPro, leaderboardPercentileScope, summaryPercentileScope]);

  const loadManualEntries = useCallback(async () => {
    setLoadingManualEntries(true);
    setManualEntriesError('');
    try {
      const response = await fetch('/api/dashboard/pitching/manual-velocity', { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as { entries?: ManualVelocityEntry[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load manual velocity entries.');
      const rows = Array.isArray(payload.entries) ? payload.entries : [];
      setManualEntries(rows);
      if (!manualDateStart && rows.length > 0) setManualDateStart(rows[rows.length - 1].entry_date);
      if (!manualDateEnd && rows.length > 0) setManualDateEnd(rows[0].entry_date);
    } catch (requestError) {
      setManualEntriesError(requestError instanceof Error ? requestError.message : 'Failed to load manual velocity entries.');
    } finally {
      setLoadingManualEntries(false);
    }
  }, [manualDateEnd, manualDateStart]);

  useEffect(() => {
    void loadManualEntries();
  }, [loadManualEntries]);

  const canLoadOverview = useMemo(() => !!filters && !!startDate && !!endDate, [filters, startDate, endDate]);
  const selectedSinglePitcher = useMemo(() => {
    const selected = selectedPitchers.filter((value) => value !== 'All');
    return selected.length === 1 ? selected[0] : '';
  }, [selectedPitchers]);
  const selectedSinglePitcherHandCode = useMemo<'R' | 'L' | ''>(() => {
    const handFromFilter = normalizeHandednessCode(hand);
    if (!selectedSinglePitcher) return '';
    const points = overview?.chart_points ?? [];
    if (!points.length) return handFromFilter;
    const selectedNorm = String(selectedSinglePitcher).toLowerCase().replace(/[^a-z0-9]/g, '');
    const selectedFirstLastNorm = formatNameFirstLast(selectedSinglePitcher).toLowerCase().replace(/[^a-z0-9]/g, '');
    let right = 0;
    let left = 0;
    for (const point of points) {
      const pointName = String(point.pitcher ?? '').trim();
      if (!pointName) continue;
      const pointNorm = pointName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const pointFirstLastNorm = formatNameFirstLast(pointName).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        pointNorm !== selectedNorm &&
        pointNorm !== selectedFirstLastNorm &&
        pointFirstLastNorm !== selectedNorm &&
        pointFirstLastNorm !== selectedFirstLastNorm
      ) {
        continue;
      }
      const code = normalizeHandednessCode(point.pitcherthrows);
      if (code === 'R') right += 1;
      if (code === 'L') left += 1;
    }
    if (right > left && right > 0) return 'R';
    if (left > right && left > 0) return 'L';
    return handFromFilter;
  }, [hand, overview?.chart_points, selectedSinglePitcher]);
  const hasSpecificPitcherSelection = useMemo(
    () => selectedPitchers.some((value) => String(value ?? '').trim() !== '' && value !== 'All'),
    [selectedPitchers]
  );
  const canRunGameLog = hasSpecificPitcherSelection || (teamType && teamType !== 'All');
  const canRunPitchLog = canRunGameLog;
  const [selectedPitcherLastGameDate, setSelectedPitcherLastGameDate] = useState('');
  // Neither Game Log nor Pitch Log force a Session Type default on entry --
  // both start on whatever '' (the real "All" option in the Session Type
  // dropdown below) already resolves to, which is every session type
  // including bullpens and Live BP, not just real games. A prior version of
  // this effect forced Game Log to 'Season' the moment it was opened,
  // which silently hid all non-game sessions with no visible explanation.
  // Session Type still works as an explicit filter -- picking 'Season' from
  // the dropdown narrows either log down to real games only, same as
  // before -- this only removes the forced default.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    if (!filters || !selectedSinglePitcher) {
      setSelectedPitcherLastGameDate('');
      return () => {
        cancelled = true;
        controller.abort();
      };
    }
    const schoolCode = String(filters.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase();
    if (!schoolCode || schoolCode === 'PRO' || schoolCode === 'LEAGUE') {
      setSelectedPitcherLastGameDate('');
      return () => {
        cancelled = true;
        controller.abort();
      };
    }
    const seasonStart = String(filters.min_date ?? '').trim() || (schoolCode === 'CNU' ? '2026-01-30' : '2026-02-13');
    const seasonEnd = String(filters.max_date ?? toYmdNow()).trim() || toYmdNow();
    const params = new URLSearchParams();
    params.set('start_date', seasonStart);
    params.set('end_date', seasonEnd);
    params.set('pitcher', selectedSinglePitcher);
    params.set('table_mode', 'Live');
    params.set('split_by', 'Pitcher');
    params.set('include_chart_points', '1');
    params.set('chart_points_limit', '6000');
    params.set('include_row_pitches', '0');
    params.set('include_trend_rows', '0');
    params.set('chart_only', '1');
    void fetch(`/api/dashboard/pitching/overview?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { chart_points?: Array<{ session_date?: string | null }> };
        if (!response.ok) return '';
        const points = Array.isArray(payload.chart_points) ? payload.chart_points : [];
        let latest = '';
        for (const point of points) {
          const dateKey = String(point.session_date ?? '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
          if (!latest || dateKey > latest) latest = dateKey;
        }
        return latest;
      })
      .then((latest) => {
        if (cancelled) return;
        setSelectedPitcherLastGameDate(String(latest ?? '').trim());
      })
      .catch(() => {
        if (cancelled) return;
        setSelectedPitcherLastGameDate('');
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filters, selectedSinglePitcher, selectedSchoolCode]);
  useEffect(() => {
    if (!pcuSearchPlayerDatePendingRef.current) return;
    const latest = String(selectedPitcherLastGameDate ?? '').trim();
    pcuSearchPlayerDatePendingRef.current = false;
    if (!latest) return;
    setStartDate(latest);
    setEndDate(latest);
    setAppliedFilterVersion((current) => current + 1);
  }, [selectedPitcherLastGameDate]);
  const overviewHeaderLabel = useMemo(() => {
    const selected = selectedPitchers.filter((value) => value !== 'All');
    const playerLabel = selected.length === 1 ? formatNameFirstLast(selected[0]) : 'All';
    const effectiveSchoolCode = String(filters?.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase();
    const dateLabel = formatDashboardDateLabel(startDate, endDate, isPro, effectiveSchoolCode, selectedPitcherLastGameDate);
    return `${playerLabel} | ${dateLabel}`;
  }, [selectedPitchers, startDate, endDate, isPro, selectedSchoolCode, filters?.school_code, selectedPitcherLastGameDate]);

  const saveManualEntries = useCallback(async () => {
    let throwType = manualThrowType;
    if (throwType === 'Other') throwType = manualThrowTypeOther.trim();
    if (!throwType) {
      setManualVeloStatus('Enter a throw type before saving.');
      return;
    }
    if (throwType === 'Plyo Velo' && !manualPlyoDrill.trim()) {
      setManualVeloStatus('Enter or select a Plyo Drill for Plyo Velo entries.');
      return;
    }
    if (!manualPitcher || manualPitcher === 'All') {
      setManualVeloStatus('Pick a specific pitcher for manual entries.');
      return;
    }
    const weight = Number(manualWeight);
    if (!Number.isFinite(weight) || weight <= 0) {
      setManualVeloStatus('Ball weight must be a positive number.');
      return;
    }
    const single = Number(manualSingleVelo);
    const values = [
      ...(Number.isFinite(single) && single > 0 ? [single] : []),
      ...parseVelocityBatch(manualBatchVelo),
    ];
    if (!values.length) {
      setManualVeloStatus('No valid velocity values found. Use single value or batch values.');
      return;
    }
    setManualVeloStatus('Saving...');
    try {
      const response = await fetch('/api/dashboard/pitching/manual-velocity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entry_date: manualDate,
          pitcher: manualPitcher,
          throw_type: throwType,
          plyo_drill: throwType === 'Plyo Velo' ? manualPlyoDrill.trim() : '',
          ball_weight_oz: weight,
          velocities: values,
          notes: manualNotes.trim(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; created_count?: number };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save entries.');
      setManualSingleVelo('');
      setManualBatchVelo('');
      setManualVeloStatus(`Saved ${payload.created_count ?? values.length} ${(payload.created_count ?? values.length) === 1 ? 'entry' : 'entries'}.`);
      await loadManualEntries();
    } catch (requestError) {
      setManualVeloStatus(requestError instanceof Error ? requestError.message : 'Failed to save entries.');
    }
  }, [loadManualEntries, manualBatchVelo, manualDate, manualNotes, manualPitcher, manualPlyoDrill, manualSingleVelo, manualThrowType, manualThrowTypeOther, manualWeight]);

  const deleteManualEntry = useCallback(async () => {
    if (!manualSelectedEntryId) {
      setManualVeloStatus('Select a row in Recent Manual Entries to delete.');
      return;
    }
    setManualVeloStatus('Deleting...');
    try {
      const response = await fetch(`/api/dashboard/pitching/manual-velocity?entry_id=${manualSelectedEntryId}`, {
        method: 'DELETE',
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete selected entry.');
      setManualSelectedEntryId(null);
      setManualVeloStatus('Deleted selected entry.');
      await loadManualEntries();
    } catch (requestError) {
      setManualVeloStatus(requestError instanceof Error ? requestError.message : 'Failed to delete selected entry.');
    }
  }, [loadManualEntries, manualSelectedEntryId]);

  useEffect(() => {
    if (!canLoadOverview) return;
    let active = true;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, isPro ? 120000 : 90000);
    setLoadingOverview(true);
    setError('');
    const isLeaderboardPage = dashboardPage === 'Leaderboard';
    const params = new URLSearchParams();
    // Client-side cache buster for advanced metric parity fixes.
    params.set('metrics_v', '9');
    params.set('start_date', startDate);
    params.set('end_date', endDate);
    params.delete('force_raw');
    if (postEditCacheBust) params.set('_cb', String(postEditCacheBust));

    const apiTeamType = isLeague
      ? resolveLeagueTeamTypeForApi(teamType, [filters?.pitchers_by_team_code, filters?.opp_hitters_by_team_code])
      : teamType;
    if (teamType && teamType !== 'All') params.set('team_type', apiTeamType);
    if ((isPro || isLeague) && level && level !== 'All') {
      params.set('level', level);
    } else if (!isPro && !isLeague && PRO_LEVEL_FILTER_OPTIONS.includes(level) && level !== 'All') {
      params.set('level', level);
    }
    if (withVideo && withVideo !== 'All') params.set('with_video', withVideo);
    if (breakLines && breakLines !== 'None') params.set('break_lines', breakLines);
    if (stuffLevel) params.set('stuff_level', stuffLevel);
    if (stuffBase) params.set('stuff_base', stuffBase);
    if (hand && hand !== 'All') params.set('hand', hand);
    if (batterSide && batterSide !== 'All') params.set('batter_side', batterSide);
    if (venue && venue !== 'All') params.set('venue', venue);
    if (!isPro && sessionType) params.set('session_type', sessionType);
    if (qpLocations && qpLocations !== 'All') params.set('qp_locations', qpLocations);
    if (tableMode) params.set('table_mode', tableMode);
    if (effectiveSplitBy) params.set('split_by', effectiveSplitBy);
    if (tableMode === 'Custom' && customTableColumns.length > 0) {
      params.set('custom_columns', customTableColumns.join(','));
    }
    if (visualOption && visualOption !== 'All') params.set('visual_option', visualOption);

    const pitchersParam = toParamValue(selectedPitchers);
    const hittersParam = toParamValue(selectedHitters);
    const pitchTypesParam = toParamValue(selectedPitchTypes);
    const ballTypesParam = toBallTypesParamValue(selectedBallTypes);
    const zoneParam = toParamValue(selectedZoneLocations);
    const resultsParam = toParamValue(selectedPitchResults);
    const countParam = toParamValue(selectedCountFilters);
    const afterCountParam = toParamValue(selectedAfterCountFilters);
    const inZoneParam = toParamValue(selectedInZone);

    if (pitchersParam) params.set('pitcher', pitchersParam);
    if (hittersParam) params.set('opp_hitter', hittersParam);
    if (pitchTypesParam) params.set('pitch_types', pitchTypesParam);
    if (!isPro && !isLeague && ballTypesParam) params.set('ball_types', ballTypesParam);
    if (zoneParam) params.set('zone_locations', zoneParam);
    if (resultsParam) params.set('pitch_results', resultsParam);
    if (countParam) params.set('count_filter', countParam);
    if (afterCountParam) params.set('after_count_filter', afterCountParam);
    if (inZoneParam) params.set('in_zone', inZoneParam);
    if (veloMin) params.set('velo_min', veloMin);
    if (veloMax) params.set('velo_max', veloMax);
    if (ivbMin) params.set('ivb_min', ivbMin);
    if (ivbMax) params.set('ivb_max', ivbMax);
    if (hbMin) params.set('hb_min', hbMin);
    if (hbMax) params.set('hb_max', hbMax);
    if (pcMin) params.set('pc_min', pcMin);
    if (pcMax) params.set('pc_max', pcMax);
    if (bfMin) params.set('bf_min', bfMin);
    if (bfMax) params.set('bf_max', bfMax);
    if (ipMin) params.set('ip_min', ipMin);
    if (ipMax) params.set('ip_max', ipMax);
    const isTrendPage = dashboardPage === 'Trend';
    const isLeaderboard = dashboardPage === 'Leaderboard';
    const isGameLogPage = dashboardPage === 'Game Log';
    const isPitchLogPage = dashboardPage === 'Pitch Log';
    const isSummaryPage = dashboardPage === 'Summary';
    const isHeatMapsPage = dashboardPage === 'HeatMaps';
    const shouldDeferCharts = isSummaryPage || isTrendPage;
    const shouldLoadLeagueCharts = isLeague && !isLeagueAllSelection && !shouldForceLeagueFastTable;
    const shouldIncludeRowPitches =
      (!isLeague && !isPro) || (isLeague && !hideLeagueSummaryCharts && !shouldForceLeagueFastTable && leagueWindowDays <= 14);
    const shouldForceProFastSummary = isPro && isSummaryPage && !selectedSinglePitcher;
    let shouldScheduleCompanionCharts = false;
    if (shouldForceProFastSummary) {
      params.set('include_chart_points', '0');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
      shouldScheduleCompanionCharts = true;
    } else if (isPlayerRole) {
      if (shouldDeferCharts) {
        params.set('include_chart_points', '0');
        shouldScheduleCompanionCharts = true;
      } else {
        params.set('include_chart_points', '1');
        params.set('chart_points_limit', '300');
      }
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', isTrendPage ? '1' : '0');
    } else if (isLeaderboard) {
      // Match PRO behavior for leaderboard performance: table-only payload.
      params.set('include_chart_points', '0');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
    } else if (isHeatMapsPage) {
      params.set('include_chart_points', '1');
      params.set('chart_points_limit', isPro ? '1200' : '1000');
      params.set('chart_only', '1');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
    } else if (isGameLogPage || isPitchLogPage) {
      params.set('include_chart_points', '1');
      params.set('chart_points_limit', isPro ? '6000' : '5000');
      params.set('chart_only', '1');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
    } else if (hideLeagueSummaryCharts || shouldForceLeagueFastTable) {
      params.set('include_chart_points', '0');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
    } else {
      const baselineShouldIncludeCharts = shouldLoadLeagueCharts || !isLeague;
      if (shouldDeferCharts && baselineShouldIncludeCharts) {
        params.set('include_chart_points', '0');
        shouldScheduleCompanionCharts = true;
      } else {
        params.set('include_chart_points', baselineShouldIncludeCharts ? '1' : '0');
        if (baselineShouldIncludeCharts) params.set('chart_points_limit', isPro ? '500' : '1000');
      }
      params.set('include_row_pitches', shouldIncludeRowPitches ? '1' : '0');
      params.set('include_trend_rows', isLeague ? '0' : (isTrendPage ? '1' : '0'));
    }
    const isTableOnlyOverviewRequest =
      params.get('include_chart_points') === '0' &&
      params.get('include_row_pitches') === '0' &&
      params.get('include_trend_rows') === '0' &&
      !params.has('chart_only');
    if (isTableOnlyOverviewRequest) {
      params.delete('visual_option');
    }

    const shouldLoadLeaderboardBaseline =
      isLeaderboard &&
      (leaderboardStatView === 'Percentile' || enableTableColors);
    const shouldLoadGameLogBaseline = isGameLogPage && (showCellPercentiles || enableTableColors);
    const shouldLoadPitchLogBaseline = isPitchLogPage && (showCellPercentiles || enableTableColors);
    const shouldLoadPercentileBaseline =
      shouldLoadLeaderboardBaseline ||
      shouldLoadGameLogBaseline ||
      shouldLoadPitchLogBaseline ||
      (isSummaryPage && (showCellPercentiles || summaryStatView === 'Percentile' || enableTableColors));
    const shouldSkipLeagueBroadSummaryBaseline =
      isLeague &&
      isSummaryPage &&
      isLeagueAllSelection &&
      leagueWindowDays > 14;
    if (shouldLoadPercentileBaseline && !shouldSkipLeagueBroadSummaryBaseline) {
      const baselineParams = new URLSearchParams(params);
      baselineParams.delete('force_raw');
      baselineParams.set('percentile_baseline', '1');
      baselineParams.set('include_chart_points', '0');
      baselineParams.set('include_row_pitches', '0');
      baselineParams.set('include_trend_rows', '0');
      baselineParams.delete('chart_only');
      baselineParams.delete('chart_points_limit');
      baselineParams.delete('visual_option');
      baselineParams.delete('pitcher');
      if (isSummaryPage) {
        // Summary percentile baselines should always be a pitcher-wide pool.
        // Row-specific split filters are applied in the summary-percentiles pass.
        baselineParams.set('split_by', 'Pitcher');
      }
      // Keep percentile baseline lightweight on school sites. Heavy Custom-table
      // baseline requests with large custom column sets can time out and disable
      // all color coding.
      if (!isPro) {
        baselineParams.delete('custom_columns');
        if (baselineParams.get('table_mode') === 'Custom') baselineParams.set('table_mode', 'Live');
      }
      if (isGameLogPage || isPitchLogPage) baselineParams.set('split_by', 'Game');
      const activePercentileScope =
        isPro
          ? 'MLB'
          : (isLeaderboard || isGameLogPage || isPitchLogPage ? leaderboardPercentileScope : (isSummaryPage ? summaryPercentileScope : collegePercentileDefault));
      if (!isPro) {
        if (activePercentileScope === 'TEAM') {
          const schoolTeamCode = String(filters?.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase();
          if (teamType && teamType !== 'All') {
            baselineParams.set('team_type', apiTeamType);
          } else if (schoolTeamCode && schoolTeamCode !== 'PRO' && schoolTeamCode !== 'LEAGUE') {
            baselineParams.set('team_type', schoolTeamCode);
          }
        } else {
          baselineParams.set('team_type', 'All');
        }
      }
      if (isPro) {
        // Pro percentile baselines must always compare against league-wide MLB pool.
        // Do not inherit a selected team from the current page state.
        baselineParams.set('team_type', 'All');
      }
      if (!isPro && activePercentileScope === 'MLB') baselineParams.set('percentile_pool', 'mlb');
      else baselineParams.delete('percentile_pool');
      const useMlbPercentileScope = isPro || (!isPro && activePercentileScope === 'MLB');
      if (useMlbPercentileScope) {
        baselineParams.set('start_date', '2026-01-01');
        baselineParams.set('end_date', '2026-12-31');
        baselineParams.set('level', 'MLB');
      } else if (!isPro && activePercentileScope !== 'TEAM') {
        baselineParams.set('level', activePercentileScope);
      }
      setPercentileBaselineRequestKey(`/api/dashboard/pitching/overview?${baselineParams.toString()}`);
      if (selectedSinglePitcher && selectedSinglePitcherHandCode) {
        const handedParams = new URLSearchParams(baselineParams);
        handedParams.set('hand', selectedSinglePitcherHandCode);
        setPercentileBaselineHandedRequestKey(`/api/dashboard/pitching/overview?${handedParams.toString()}`);
      } else {
        setPercentileBaselineHandedRequestKey('');
      }
    } else {
      setPercentileBaselineRequestKey('');
      setPercentileBaselineHandedRequestKey('');
    }
    const requestKey = `/api/dashboard/pitching/overview?${params.toString()}`;
    latestOverviewRequestKeyRef.current = requestKey;
    if (isLeaderboardPage) setCorrelationOverviewBaseQuery(params.toString());
    const shouldSkipProCompanionChart = isPro && isSummaryPage && isProAllSelection && proWindowDays > 14;
    const shouldUseLeagueHeatmapCompanion =
      isLeague &&
      isHeatMapsPage &&
      Boolean(pitchersParam) &&
      !hittersParam &&
      !zoneParam &&
      !resultsParam &&
      !countParam &&
      !afterCountParam &&
      !inZoneParam &&
      !veloMin &&
      !veloMax &&
      !ivbMin &&
      !ivbMax &&
      !hbMin &&
      !hbMax &&
      !pcMin &&
      !pcMax;
    const chartRequestKey = ((shouldForceProFastSummary || shouldScheduleCompanionCharts) && !shouldSkipProCompanionChart)
      ? (() => {
          if (shouldUseLeagueHeatmapCompanion) {
            const heatmapParams = new URLSearchParams();
            heatmapParams.set('school_code', 'LEAGUE');
            if (startDate) heatmapParams.set('start_date', startDate);
            if (endDate) heatmapParams.set('end_date', endDate);
            if (level && level !== 'All') heatmapParams.set('level', level);
            if (sessionType) heatmapParams.set('session_type', sessionType);
            if (hand && hand !== 'All') heatmapParams.set('hand', hand);
            if (batterSide && batterSide !== 'All') heatmapParams.set('batter_side', batterSide);
            if (pitchersParam) heatmapParams.set('pitcher', pitchersParam);
            if (apiTeamType && apiTeamType !== 'All') heatmapParams.set('team_type', apiTeamType);
            if (pitchTypesParam) heatmapParams.set('pitch_types', pitchTypesParam);
            return `/api/dashboard/pitching/heatmap-rollup?${heatmapParams.toString()}`;
          }
          const chartParams = new URLSearchParams(params);
          chartParams.delete('force_raw');
          chartParams.set('include_chart_points', '1');
          chartParams.set(
            'chart_points_limit',
            shouldForceProFastSummary ? '350' : (isPlayerRole ? '300' : (isTrendPage && !isPro ? '6000' : (isPro ? '500' : '1000')))
          );
          chartParams.set('chart_only', '1');
          chartParams.set('include_row_pitches', '0');
          chartParams.set('include_trend_rows', '0');
          if (isLeague && isSummaryPage && Boolean(pitchersParam)) {
            chartParams.set('force_raw', '1');
          }
          return `/api/dashboard/pitching/overview?${chartParams.toString()}`;
        })()
      : null;
    const overviewTtlMs = isPro ? 90000 : 30000;
    if (isGameLogPage || isPitchLogPage) {
      setLoadingOverview(false);
      return () => {
        active = false;
        window.clearTimeout(timeoutId);
        controller.abort();
      };
    }
    const applyOverviewPayload = (payload: OverviewPayload) => {
      const tableColumns = Array.isArray(payload.table_columns) ? payload.table_columns : [];
      const availableColumns = Array.isArray(payload.available_table_columns) ? payload.available_table_columns : [];
      const allColumns = Array.from(new Set([...tableColumns, ...availableColumns]));
      const tableRows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
      const normalizedRows = normalizeTableRowsForColumns(allColumns, tableRows);
      const normalizedPayload =
        normalizedRows === tableRows
          ? payload
          : ({
              ...payload,
              table_rows: normalizedRows,
            } as OverviewPayload);
      const noRows = !Array.isArray(normalizedPayload.table_rows) || normalizedPayload.table_rows.length === 0;
      if (noRows && !autoFallbackAppliedRef.current) autoFallbackAppliedRef.current = true;
      setOverview((previous) => {
        if (!previous) return normalizedPayload;
        const incomingChartPoints = Array.isArray(normalizedPayload.chart_points) ? normalizedPayload.chart_points : [];
        const hasIncomingHeatmapPoints = Array.isArray(normalizedPayload.heatmap_points);
        const incomingHeatmapPoints = hasIncomingHeatmapPoints ? normalizedPayload.heatmap_points : [];
        const incomingTrendRows = Array.isArray(normalizedPayload.trend_rows) ? normalizedPayload.trend_rows : [];
        return {
          ...normalizedPayload,
          chart_points: incomingChartPoints.length ? incomingChartPoints : (previous.chart_points ?? []),
          // An explicit empty heatmap is a valid filtered result. Retaining the
          // previous points here displays stale data under the new filters.
          heatmap_points: hasIncomingHeatmapPoints ? incomingHeatmapPoints : (previous.heatmap_points ?? []),
          trend_rows: incomingTrendRows.length ? incomingTrendRows : (previous.trend_rows ?? []),
        };
      });
    };
    const applyChartPayload = (payload: OverviewPayload) => {
      setOverview((previous) => {
        if (!previous) return payload;
        const incomingChartPoints = Array.isArray(payload.chart_points) ? payload.chart_points : [];
        const hasIncomingHeatmapPoints = Array.isArray(payload.heatmap_points);
        const incomingHeatmapPoints = hasIncomingHeatmapPoints ? payload.heatmap_points : [];
        const incomingTrendRows = Array.isArray(payload.trend_rows) ? payload.trend_rows : [];
        return {
          ...previous,
          chart_points: incomingChartPoints.length > 0 ? incomingChartPoints : (previous.chart_points ?? []),
          heatmap_points: hasIncomingHeatmapPoints ? incomingHeatmapPoints : (previous.heatmap_points ?? []),
          // Chart-only companion responses intentionally omit trend rows. Keep
          // the full-dataset response instead of replacing it with an empty list.
          trend_rows: incomingTrendRows.length > 0 ? incomingTrendRows : (previous.trend_rows ?? []),
        };
      });
    };
    const loadCompanionChart = (key: string) => {
      const cachedChart = overviewCacheRef.current.get(key);
      if (cachedChart && Date.now() - cachedChart.at < overviewTtlMs) {
        applyChartPayload(cachedChart.payload);
        return;
      }
      const inflightChart = overviewInflightRef.current.get(key);
      const chartPromise =
        inflightChart ??
        (async () => {
          const response = await fetch(key, { signal: controller.signal });
          const chartPayload = (await response.json().catch(() => ({}))) as OverviewPayload & { error?: string };
          if (!response.ok) throw new Error(chartPayload.error ?? 'Failed to load pitching chart data.');
          return chartPayload;
        })();
      if (!inflightChart) overviewInflightRef.current.set(key, chartPromise);
      chartPromise
        .then((chartPayload) => {
          if (!active) return;
          overviewCacheRef.current.set(key, { at: Date.now(), payload: chartPayload });
          applyChartPayload(chartPayload);
        })
        .catch((chartError) => {
          if (!active) return;
          if (chartError instanceof DOMException && chartError.name === 'AbortError') return;
        })
        .finally(() => {
          overviewInflightRef.current.delete(key);
        });
    };
    const cachedOverview = overviewCacheRef.current.get(requestKey);
    const shouldBypassCachedEmptySummary =
      isPro &&
      isSummaryPage &&
      Boolean(selectedSinglePitcher) &&
      (!Array.isArray(cachedOverview?.payload?.table_rows) || (cachedOverview?.payload?.table_rows?.length ?? 0) === 0);
    if (cachedOverview && Date.now() - cachedOverview.at < overviewTtlMs && !shouldBypassCachedEmptySummary) {
      applyOverviewPayload(cachedOverview.payload);
      if (chartRequestKey) loadCompanionChart(chartRequestKey);
      setLoadingOverview(false);
      return () => {
        active = false;
        window.clearTimeout(timeoutId);
        overviewInflightRef.current.delete(requestKey);
        if (chartRequestKey) overviewInflightRef.current.delete(chartRequestKey);
        controller.abort();
      };
    }
    // Trend aggregation can take materially longer than the bounded chart query
    // on large PRO date ranges. Start the companion request immediately so the
    // page can render a stable preview while the exact full-range rows finish.
    if (isTrendPage && chartRequestKey) loadCompanionChart(chartRequestKey);
    const inflightOverview = overviewInflightRef.current.get(requestKey);
    const overviewPromise =
      inflightOverview ??
      (async () => {
        const response = await fetch(requestKey, { signal: controller.signal });
        const payload = (await response.json().catch(() => ({}))) as OverviewPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load pitching overview.');
        return payload;
      })();
    if (!inflightOverview) overviewInflightRef.current.set(requestKey, overviewPromise);
    overviewPromise
      .then(async (payload) => {
        if (!active) return;
        overviewCacheRef.current.set(requestKey, { at: Date.now(), payload });
        const shouldTryLeaderboardFallback =
          isPro &&
          isLeaderboard &&
          (!Array.isArray(payload.table_rows) || payload.table_rows.length === 0) &&
          !autoFallbackAppliedRef.current;
        const shouldTrySummaryPlayerFallback =
          isPro &&
          isSummaryPage &&
          Boolean(selectedSinglePitcher) &&
          (!Array.isArray(payload.table_rows) || payload.table_rows.length === 0);
        if (shouldTrySummaryPlayerFallback) {
          const fallbackParams = new URLSearchParams(params);
          fallbackParams.set('team_type', 'All');
          fallbackParams.set('table_mode', tableMode || 'Live');
          fallbackParams.set('split_by', 'Pitch Types');
          fallbackParams.set('include_chart_points', '0');
          fallbackParams.set('include_row_pitches', '0');
          fallbackParams.set('include_trend_rows', '0');
          fallbackParams.set('pitcher', selectedSinglePitcher);
          const dropKeys = [
            'opp_hitter',
            'with_video',
            'break_lines',
            'hand',
            'batter_side',
            'venue',
            'session_type',
            'qp_locations',
            'custom_columns',
            'visual_option',
            'in_zone',
            'pitch_types',
            'zone_locations',
            'pitch_results',
            'count_filter',
            'after_count_filter',
            'velo_min',
            'velo_max',
            'ivb_min',
            'ivb_max',
            'hb_min',
            'hb_max',
            'pc_min',
            'pc_max',
            'bf_min',
            'bf_max',
            'ip_min',
            'ip_max',
            'chart_only',
            'chart_points_limit',
          ] as const;
          for (const key of dropKeys) fallbackParams.delete(key);
          const fallbackKey = `/api/dashboard/pitching/overview?${fallbackParams.toString()}`;
          try {
            const fallbackResponse = await fetch(fallbackKey, { signal: controller.signal });
            const fallbackPayload = (await fallbackResponse.json().catch(() => ({}))) as OverviewPayload & { error?: string };
            if (fallbackResponse.ok && !fallbackPayload.error && Array.isArray(fallbackPayload.table_rows) && fallbackPayload.table_rows.length > 0) {
              overviewCacheRef.current.set(fallbackKey, { at: Date.now(), payload: fallbackPayload });
              applyOverviewPayload(fallbackPayload);
              if (chartRequestKey) loadCompanionChart(chartRequestKey);
              return;
            }
          } catch (fallbackErr) {
            if (!(fallbackErr instanceof DOMException && fallbackErr.name === 'AbortError')) {
              // Keep primary payload below if summary fallback request fails.
            }
          }
        }
        if (shouldTryLeaderboardFallback) {
          autoFallbackAppliedRef.current = true;
          const fallbackParams = new URLSearchParams(params);
          fallbackParams.set('team_type', 'All');
          if (level && level !== 'All') fallbackParams.set('level', level);
          else fallbackParams.delete('level');
          fallbackParams.set('table_mode', tableMode || 'Live');
          fallbackParams.set('split_by', leaderboardViewBy === 'Team' ? 'Pitcher Team' : 'Pitcher');
          fallbackParams.set('include_chart_points', '0');
          fallbackParams.set('include_row_pitches', '0');
          fallbackParams.set('include_trend_rows', '0');
          const dropKeys = [
            'with_video',
            'break_lines',
            'hand',
            'batter_side',
            'venue',
            'session_type',
            'qp_locations',
            'custom_columns',
            'visual_option',
            'in_zone',
            'pitch_types',
            'zone_locations',
            'pitch_results',
            'count_filter',
            'after_count_filter',
            'velo_min',
            'velo_max',
            'ivb_min',
            'ivb_max',
            'hb_min',
            'hb_max',
            'pc_min',
            'pc_max',
            'bf_min',
            'bf_max',
            'ip_min',
            'ip_max',
            'chart_only',
            'chart_points_limit',
          ] as const;
          for (const key of dropKeys) fallbackParams.delete(key);
          const fallbackKey = `/api/dashboard/pitching/overview?${fallbackParams.toString()}`;
          try {
            const fallbackResponse = await fetch(fallbackKey, { signal: controller.signal });
            const fallbackPayload = (await fallbackResponse.json().catch(() => ({}))) as OverviewPayload & { error?: string };
            if (fallbackResponse.ok && !fallbackPayload.error && Array.isArray(fallbackPayload.table_rows) && fallbackPayload.table_rows.length > 0) {
              overviewCacheRef.current.set(fallbackKey, { at: Date.now(), payload: fallbackPayload });
              applyOverviewPayload(fallbackPayload);
              return;
            }
          } catch (fallbackErr) {
            if (!(fallbackErr instanceof DOMException && fallbackErr.name === 'AbortError')) {
              // Keep primary payload below if fallback request fails.
            }
          }
        }
        applyOverviewPayload(payload);
        if (!chartRequestKey) return;
        loadCompanionChart(chartRequestKey);
      })
      .catch((requestError) => {
        if (!active) return;
        if (timedOut) {
          setError('Pitching overview request timed out. Please retry.');
          return;
        }
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load pitching overview.');
      })
      .finally(() => {
        overviewInflightRef.current.delete(requestKey);
        if (active) setLoadingOverview(false);
      });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      overviewInflightRef.current.delete(requestKey);
      if (chartRequestKey) overviewInflightRef.current.delete(chartRequestKey);
      controller.abort();
    };
  }, [
    appliedFilterVersion,
    batterSide,
    canLoadOverview,
    endDate,
    hand,
    venue,
    hbMax,
    hbMin,
    ivbMax,
    ivbMin,
    pcMax,
    pcMin,
    bfMax,
    bfMin,
    ipMax,
    ipMin,
    qpLocations,
    tableMode,
    effectiveSplitBy,
    hideLeagueSummaryCharts,
    shouldForceLeagueFastTable,
    leagueWindowDays,
    proWindowDays,
    isProAllSelection,
    customTableColumns,
    selectedCustomTableId,
    jaredDashboardTable,
    visualOption,
    selectedAfterCountFilters,
    selectedCountFilters,
    selectedHitters,
    selectedInZone,
    selectedPitchers,
    selectedPitchResults,
    selectedPitchTypes,
    selectedBallTypes,
    selectedZoneLocations,
    sessionType,
    startDate,
    teamType,
    level,
    breakLines,
    stuffLevel,
    stuffBase,
    dashboardPage,
    isPlayerRole,
    veloMax,
    veloMin,
    withVideo,
    selectedSinglePitcher,
    selectedSinglePitcherHandCode,
    leaderboardStatView,
    leaderboardPercentileScope,
    summaryPercentileScope,
    collegePercentileDefault,
    enableTableColors,
    showCellPercentiles,
    summaryStatView,
    filters?.school_code,
    selectedSchoolCode,
    postEditCacheBust,
  ]);

  useEffect(() => {
    if (!percentileBaselineRequestKey) {
      setPercentileBaselineRows([]);
      setLoadingPercentileBaseline(false);
      return;
    }
    const cached = percentileBaselineCacheRef.current.get(percentileBaselineRequestKey);
    if (cached && Date.now() - cached.at < 90_000) {
      setPercentileBaselineRows(cached.rows);
      setLoadingPercentileBaseline(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setLoadingPercentileBaseline(true);
    fetch(percentileBaselineRequestKey, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { table_rows?: Array<Record<string, string | number | null>>; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed percentile baseline request.');
        const baselineRows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
        if (!active) return;
        percentileBaselineCacheRef.current.set(percentileBaselineRequestKey, { at: Date.now(), rows: baselineRows });
        setPercentileBaselineRows(baselineRows);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setPercentileBaselineRows([]);
      })
      .finally(() => {
        if (!active) return;
        setLoadingPercentileBaseline(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [percentileBaselineRequestKey]);

  useEffect(() => {
    const wantsComparison = Boolean(selectedSinglePitcher) && (showComparisonDots || showComparisonMagnusLine);
    if (!wantsComparison) {
      setMovementComparisonRequestKey('');
      return;
    }
    const params = new URLSearchParams();
    params.set('start_date', startDate);
    params.set('end_date', endDate);
    params.set('split_by', 'Pitch Types');
    params.set('table_mode', 'Expected Movement');
    params.set('include_chart_points', '0');
    params.set('include_row_pitches', '0');
    params.set('include_trend_rows', '0');
    // Match the current pitcher's handedness so a lefty vs righty comparison
    // pool doesn't wash out horizontal break in the averaged Magnus line/dots.
    if (selectedSinglePitcherHandCode) {
      params.set('hand', selectedSinglePitcherHandCode === 'R' ? 'Right' : 'Left');
    }
    const scope = isPro ? 'MLB' : comparisonScope;
    if (scope === 'MLB') {
      params.set('school_code', 'PRO');
      params.set('level', 'MLB');
      // Mirror the percentile-baseline MLB pool: widen to a full-year window so
      // a short current-view date range doesn't starve the comparison population.
      params.set('start_date', '2026-01-01');
      params.set('end_date', '2026-12-31');
    } else if (scope === 'TEAM') {
      params.set('school_code', String(filters?.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase() || 'LEAGUE');
      const schoolTeamCode = String(filters?.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase();
      if (teamType && teamType !== 'All') {
        params.set(
          'team_type',
          isLeague ? resolveLeagueTeamTypeForApi(teamType, [filters?.pitchers_by_team_code, filters?.opp_hitters_by_team_code]) : teamType
        );
      } else if (schoolTeamCode && schoolTeamCode !== 'PRO' && schoolTeamCode !== 'LEAGUE') {
        params.set('team_type', schoolTeamCode);
      }
    } else {
      params.set('school_code', 'LEAGUE');
      params.set('level', scope);
    }
    const key = `/api/dashboard/pitching/overview?${params.toString()}`;
    setMovementComparisonRequestKey(key);
  }, [
    selectedSinglePitcher,
    selectedSinglePitcherHandCode,
    showComparisonDots,
    showComparisonMagnusLine,
    isPro,
    isLeague,
    comparisonScope,
    startDate,
    endDate,
    teamType,
    filters?.school_code,
    filters?.pitchers_by_team_code,
    filters?.opp_hitters_by_team_code,
    selectedSchoolCode,
  ]);

  useEffect(() => {
    if (!movementComparisonRequestKey) {
      setMovementComparisonRows([]);
      setMovementComparisonSplitColumn('');
      setLoadingMovementComparison(false);
      return;
    }
    const cached = movementComparisonCacheRef.current.get(movementComparisonRequestKey);
    if (cached && Date.now() - cached.at < 90_000) {
      setMovementComparisonRows(cached.rows);
      setMovementComparisonSplitColumn(cached.splitColumn);
      setLoadingMovementComparison(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setLoadingMovementComparison(true);
    fetch(movementComparisonRequestKey, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          table_rows?: Array<Record<string, string | number | null>>;
          table_columns?: string[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? 'Failed movement comparison request.');
        const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
        const splitColumn = Array.isArray(payload.table_columns) ? String(payload.table_columns[0] ?? '') : '';
        if (!active) return;
        movementComparisonCacheRef.current.set(movementComparisonRequestKey, { at: Date.now(), rows, splitColumn });
        setMovementComparisonRows(rows);
        setMovementComparisonSplitColumn(splitColumn);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setMovementComparisonRows([]);
        setMovementComparisonSplitColumn('');
      })
      .finally(() => {
        if (!active) return;
        setLoadingMovementComparison(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [movementComparisonRequestKey]);

  useEffect(() => {
    if (!percentileBaselineHandedRequestKey) {
      setPercentileBaselineHandedRows([]);
      return;
    }
    const cached = percentileBaselineHandedCacheRef.current.get(percentileBaselineHandedRequestKey);
    if (cached && Date.now() - cached.at < 90_000) {
      setPercentileBaselineHandedRows(cached.rows);
      return;
    }
    let active = true;
    const controller = new AbortController();
    fetch(percentileBaselineHandedRequestKey, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { table_rows?: Array<Record<string, string | number | null>>; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed handedness percentile baseline request.');
        const baselineRows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
        if (!active) return;
        percentileBaselineHandedCacheRef.current.set(percentileBaselineHandedRequestKey, { at: Date.now(), rows: baselineRows });
        setPercentileBaselineHandedRows(baselineRows);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setPercentileBaselineHandedRows([]);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [percentileBaselineHandedRequestKey]);

  useEffect(() => {
    const shouldLoadSummaryPercentiles =
      showCellPercentiles ||
      summaryStatView === 'Percentile' ||
      enableTableColors;
    if (dashboardPage !== 'Summary' || !shouldLoadSummaryPercentiles || !percentileBaselineRequestKey) {
      setSummaryPitchTypeDistributions(new Map());
      setSummaryPitchTypeHandedDistributions(new Map());
      setLoadingSummaryPitchTypePercentiles(false);
      return;
    }
    const tableColumns = Array.isArray(overview?.table_columns) ? overview.table_columns : [];
    const splitColumn = tableColumns[0] ?? '';
    const tableRows = Array.isArray(overview?.table_rows) ? overview.table_rows : [];
    if (!splitColumn || !tableRows.length) {
      setSummaryPitchTypeDistributions(new Map());
      setSummaryPitchTypeHandedDistributions(new Map());
      setLoadingSummaryPitchTypePercentiles(false);
      return;
    }
    const baseQuery = percentileBaselineRequestKey.split('?')[1] ?? '';
    if (!baseQuery) {
      setSummaryPitchTypeDistributions(new Map());
      setSummaryPitchTypeHandedDistributions(new Map());
      setLoadingSummaryPitchTypePercentiles(false);
      return;
    }
    const rowsByKey = new Map<string, string>();
    for (const row of tableRows) {
      const raw = String(row[splitColumn] ?? '').trim();
      if (!raw) continue;
      const key = percentileSplitRowKey(splitColumn, raw);
      if (!key || rowsByKey.has(key)) continue;
      const canonicalRowLabel = (
        normalizePercentileColumnToken(splitBy) === normalizePercentileColumnToken('Pitcher Hand') ||
        normalizePercentileColumnToken(splitBy) === normalizePercentileColumnToken('Batter Hand')
      )
        ? canonicalizeHandLabel(raw)
        : raw;
      rowsByKey.set(key, canonicalRowLabel);
    }
    if (!rowsByKey.size) {
      setSummaryPitchTypeDistributions(new Map());
      setSummaryPitchTypeHandedDistributions(new Map());
      setLoadingSummaryPitchTypePercentiles(false);
      return;
    }
    if (splitBy === 'Pitcher') {
      const cols = tableColumns.slice(1);
      const valuesByColumn = new Map<string, number[]>();
      const baselineRows = percentileBaselineRows;
      for (const column of cols) {
        const values = baselineRows
          .filter((r) => !isAllLikeRowValue(r[splitColumn]))
          .map((r) => parseSortableNumber(r[column]))
          .filter((v): v is number => v !== null)
          .sort((a, b) => a - b);
        if (values.length) valuesByColumn.set(column, values);
      }
      const next = new Map<string, number[]>();
      for (const rowKey of rowsByKey.keys()) {
        for (const [column, values] of valuesByColumn.entries()) {
          next.set(`${rowKey}::${column}`, values);
        }
      }
      setSummaryPitchTypeDistributions(next);
      setSummaryPitchTypeHandedDistributions(new Map());
      setLoadingSummaryPitchTypePercentiles(false);
      return;
    }
    const cacheKey = [
      'v4',
      splitBy,
      baseQuery,
      selectedSinglePitcherHandCode,
      Array.from(rowsByKey.keys()).sort().join('|'),
    ].join('::');
    const cached = summaryPercentileDistributionCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.at < 300000) {
      setSummaryPitchTypeDistributions(new Map(cached.base));
      setSummaryPitchTypeHandedDistributions(new Map(cached.handed));
      setLoadingSummaryPitchTypePercentiles(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const run = async () => {
      let timeoutId: number | null = null;
      try {
      const requests: Array<{ rowKey: string; query: string; handedQuery?: string }> = [];
      for (const [rowKey, rowLabel] of rowsByKey.entries()) {
        const params = new URLSearchParams(baseQuery);
        const activeSummaryScope = isPro ? 'MLB' : summaryPercentileScope;
        if (activeSummaryScope === 'MLB') {
          params.set('school_code', 'PRO');
          params.set('level', 'MLB');
        } else if (activeSummaryScope === 'TEAM') {
          const schoolTeamCode = String(filters?.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase();
          params.set('school_code', schoolTeamCode && schoolTeamCode !== 'PRO' && schoolTeamCode !== 'LEAGUE' ? schoolTeamCode : 'LEAGUE');
        } else {
          params.set('school_code', 'LEAGUE');
          params.set('level', activeSummaryScope);
        }
        params.set('split_by', 'Pitcher');
        params.delete('pitcher');
        params.set('include_chart_points', '0');
        params.set('include_row_pitches', '0');
        params.set('include_trend_rows', '0');
        params.delete('chart_only');
        params.delete('chart_points_limit');
        if (!applyPitchingSummarySplitFilter(params, splitBy, rowLabel, filters?.pitch_types ?? [])) continue;
        const baseParams = new URLSearchParams(params);
        const handedParams = new URLSearchParams(params);
        if (selectedSinglePitcherHandCode) handedParams.set('hand', selectedSinglePitcherHandCode);
        requests.push({
          rowKey,
          query: baseParams.toString(),
          handedQuery: selectedSinglePitcherHandCode ? handedParams.toString() : undefined,
        });
      }
      if (!requests.length) {
        if (!active) return;
        setSummaryPitchTypeDistributions(new Map());
        setSummaryPitchTypeHandedDistributions(new Map());
        setLoadingSummaryPitchTypePercentiles(false);
        return;
      }
      const cols = Array.from(
        new Set(
          ['#', ...tableColumns.slice(1)]
            .map((value) => String(value ?? '').trim())
            .filter(Boolean)
        )
      ).filter((column) => normalizePercentileColumnToken(column) !== normalizePercentileColumnToken(splitColumn));
      if (controller.signal.aborted || !active) return;
      setLoadingSummaryPitchTypePercentiles(true);
      timeoutId = window.setTimeout(() => {
        try {
          controller.abort();
        } catch {}
      }, 25000);
      const response = await fetch('/api/dashboard/pitching/summary-percentiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({
          requests,
          columns: cols,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        distributions?: Record<string, number[]>;
        handed_distributions?: Record<string, number[]>;
      };
      if (!response.ok) throw new Error('Failed summary percentile distributions.');
      if (!active) return;
      const next = new Map<string, number[]>();
      const nextHanded = new Map<string, number[]>();
      const base = payload.distributions ?? {};
      const handed = payload.handed_distributions ?? {};
      Object.entries(base).forEach(([key, values]) => {
        if (Array.isArray(values) && values.length) next.set(key, values);
      });
      Object.entries(handed).forEach(([key, values]) => {
        if (Array.isArray(values) && values.length) nextHanded.set(key, values);
      });
      summaryPercentileDistributionCacheRef.current.set(cacheKey, {
        at: Date.now(),
        base: new Map(next),
        handed: new Map(nextHanded),
      });
      setSummaryPitchTypeDistributions(next);
      setSummaryPitchTypeHandedDistributions(nextHanded);
      } finally {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        if (active) setLoadingSummaryPitchTypePercentiles(false);
      }
    };
    const timer = window.setTimeout(() => {
      void run().catch((error) => {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSummaryPitchTypeDistributions(new Map());
        setSummaryPitchTypeHandedDistributions(new Map());
        setLoadingSummaryPitchTypePercentiles(false);
      });
    }, 140);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [dashboardPage, splitBy, isPro, summaryPercentileScope, enableTableColors, showCellPercentiles, summaryStatView, percentileBaselineRequestKey, percentileBaselineRows, overview?.table_rows, overview?.table_columns, overview?.available_table_columns, selectedSinglePitcherHandCode, filters?.pitch_types, filters?.school_code, selectedSchoolCode]);

  const sortedGameLogRows = useMemo(
    () => sortTableRows(gameLogRows, gameLogSortColumn, gameLogSortDirection),
    [gameLogRows, gameLogSortColumn, gameLogSortDirection]
  );
  const gameLogRowsWithPins = useMemo(() => {
    if (!sortedGameLogRows.length || !gameLogColumns.length) return sortedGameLogRows;
    const apiAll = sortedGameLogRows.find((row) => String(row._game_pin_key ?? '') === '__game_all__') ?? null;
    const gameRows = sortedGameLogRows.filter((row) => String(row._game_pin_key ?? '') !== '__game_all__');
    const pinned: Array<Record<string, unknown>> = [];
    const unpinned: Array<Record<string, unknown>> = [];
    for (const row of gameRows) {
      const key = String(row._game_pin_key ?? '');
      if (key && pinnedGameLogKeys.has(key)) pinned.push(row);
      else unpinned.push(row);
    }
    const toTableRows = (rows: Array<Record<string, unknown>>) =>
      rows.map((row) => row as Record<string, string | number | null | undefined>);
    const pinnedAll = buildPinnedAllRow(gameLogColumns, toTableRows(pinned));
    const allRow = apiAll ?? buildPinnedAllRow(gameLogColumns, toTableRows(gameRows));
    const decorate = (row: Record<string, string | number | null | undefined> | null, kind: 'all' | 'all_pinned') => {
      if (!row) return null;
      return {
        ...row,
        Team: kind === 'all_pinned' ? 'All (Pinned)' : 'All',
        Date: '-',
        Opponent: '-',
        _game_pin_key: kind === 'all_pinned' ? '__game_all_pinned__' : '__game_all__',
        _game_row_kind: kind,
      } as Record<string, unknown>;
    };
    const pinnedAllRow = decorate(pinnedAll, 'all_pinned');
    const allSummaryRow = decorate(allRow as Record<string, string | number | null | undefined> | null, 'all');
    return [
      ...(allSummaryRow ? [allSummaryRow] : []),
      ...(pinnedAllRow ? [pinnedAllRow] : []),
      ...pinned,
      ...unpinned,
    ];
  }, [sortedGameLogRows, pinnedGameLogKeys]);
  const gameLogDisplayColumns = useMemo(() => {
    if (!gameLogColumns.length) return gameLogColumns;
    const lead = ['Date', 'Team', 'Opponent'];
    const leadSet = new Set(lead.map((column) => column.toLowerCase()));
    const orderedLead = lead.filter((column) => gameLogColumns.some((value) => value.toLowerCase() === column.toLowerCase()));
    const rest = gameLogColumns.filter((column) => !leadSet.has(column.toLowerCase()));
    return [...orderedLead, ...rest];
  }, [gameLogColumns]);
  const sortedPitchLogRows = useMemo(
    () => sortTableRows(pitchLogRows, pitchLogSortColumn, pitchLogSortDirection),
    [pitchLogRows, pitchLogSortColumn, pitchLogSortDirection]
  );
  const pinnedPitchLogRows = useMemo(
    () => sortedPitchLogRows.filter((row) => pinnedPitchLogKeys.has(String(row._pitch_pin_key ?? ''))),
    [sortedPitchLogRows, pinnedPitchLogKeys]
  );
  const pitchLogRowsWithPins = useMemo(() => {
    if (!pinnedPitchLogRows.length) return sortedPitchLogRows;
    const pinnedAll = buildPinnedAllRow(
      pitchLogColumns,
      pinnedPitchLogRows as Array<Record<string, string | number | null | undefined>>
    );
    const pinnedAllRow: Record<string, unknown> | null = pinnedAll
      ? {
          ...pinnedAll,
          Date: '-',
          Team: '-',
          Opponent: '-',
          Pitcher: 'All (Pinned)',
          Batter: '-',
          'Pitch Type': '-',
          Count: '-',
          Result: '-',
          _pitch_pin_key: '__pitch_all_pinned__',
          _pitch_row_kind: 'all_pinned',
        }
      : null;
    return [
      ...(pinnedAllRow ? [pinnedAllRow] : []),
      ...pinnedPitchLogRows,
      ...sortedPitchLogRows.filter((row) => !pinnedPitchLogKeys.has(String(row._pitch_pin_key ?? ''))),
    ];
  }, [sortedPitchLogRows, pinnedPitchLogRows, pinnedPitchLogKeys, pitchLogColumns]);
  const pitchLogVideoQueue = useMemo(() => {
    const sourceRows = pinnedPitchLogRows.length ? pinnedPitchLogRows : pitchLogRowsWithPins;
    return sourceRows
      .map((row) => row._pitch_action_point)
      .filter((pitch): pitch is PitchActionPoint => Boolean(pitch && typeof pitch === 'object'));
  }, [pinnedPitchLogRows, pitchLogRowsWithPins]);
  const pitchLogDisplayColumns = useMemo(() => {
    if (!pitchLogColumns.length) return pitchLogColumns;
    const lead = ['Date', 'Team', 'Opponent', 'Pitcher', 'Batter', 'Pitch Type', 'Count', 'Result'];
    const leadSet = new Set(lead.map((column) => column.toLowerCase()));
    const orderedLead = lead.filter((column) => pitchLogColumns.some((value) => value.toLowerCase() === column.toLowerCase()));
    const rest = pitchLogColumns.filter((column) => !leadSet.has(column.toLowerCase()));
    return [...orderedLead, ...rest];
  }, [pitchLogColumns]);

  useEffect(() => {
    if (dashboardPage !== 'Game Log') return;
    if (!canLoadOverview) return;
    if (!canRunGameLog) {
      setGameLogRows([]);
      setGameLogColumns([]);
      setGameLogError('');
      setLoadingGameLog(false);
      return;
    }
    let active = true;
    const controller = new AbortController();

    setLoadingGameLog(true);
    setGameLogError('');
    const run = async () => {
      const schoolCode = String(filters?.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase();
      const isPcuBullpenSelection = schoolCode === 'PCU' && !isPro && /bull/i.test(String(sessionType ?? ''));
      const apiTeamType = isLeague
        ? resolveLeagueTeamTypeForApi(teamType, [filters?.pitchers_by_team_code, filters?.opp_hitters_by_team_code])
        : teamType;
      const pitchersParam = toParamValue(selectedPitchers);
      const hittersParam = toParamValue(selectedHitters);
      const pitchTypesParam = toParamValue(selectedPitchTypes);
      const ballTypesParam = toBallTypesParamValue(selectedBallTypes);
      const zoneParam = toParamValue(selectedZoneLocations);
      const resultsParam = toParamValue(selectedPitchResults);
      const countParam = toParamValue(selectedCountFilters);
      const afterCountParam = toParamValue(selectedAfterCountFilters);
      const inZoneParam = toParamValue(selectedInZone);
      const params = new URLSearchParams();
      params.delete('force_raw');
      if (startDate) params.set('start_date', startDate);
      if (endDate) params.set('end_date', endDate);
      if (teamType && teamType !== 'All') params.set('team_type', apiTeamType);
      if ((isPro || isLeague) && level && level !== 'All') params.set('level', level);
      else if (!isPro && !isLeague && PRO_LEVEL_FILTER_OPTIONS.includes(level) && level !== 'All') params.set('level', level);
      if (withVideo && withVideo !== 'All') params.set('with_video', withVideo);
      if (breakLines && breakLines !== 'None') params.set('break_lines', breakLines);
      if (stuffLevel) params.set('stuff_level', stuffLevel);
      if (stuffBase) params.set('stuff_base', stuffBase);
      if (hand && hand !== 'All') params.set('hand', hand);
      if (batterSide && batterSide !== 'All') params.set('batter_side', batterSide);
      if (venue && venue !== 'All') params.set('venue', venue);
      if (!isPro && sessionType) params.set('session_type', sessionType);
      if (qpLocations && qpLocations !== 'All') params.set('qp_locations', qpLocations);
      if (tableMode) params.set('table_mode', tableMode);
      params.set('split_by', 'Game');
      if (tableMode === 'Custom' && customTableColumns.length > 0) params.set('custom_columns', customTableColumns.join(','));
      if (visualOption && visualOption !== 'All') params.set('visual_option', visualOption);
      if (pitchersParam) params.set('pitcher', pitchersParam);
      if (hittersParam) params.set('opp_hitter', hittersParam);
      if (pitchTypesParam) params.set('pitch_types', pitchTypesParam);
      if (!isPro && !isLeague && ballTypesParam) params.set('ball_types', ballTypesParam);
      if (zoneParam) params.set('zone_locations', zoneParam);
      if (resultsParam) params.set('pitch_results', resultsParam);
      if (countParam) params.set('count_filter', countParam);
      if (afterCountParam) params.set('after_count_filter', afterCountParam);
      if (inZoneParam) params.set('in_zone', inZoneParam);
      if (veloMin) params.set('velo_min', veloMin);
      if (veloMax) params.set('velo_max', veloMax);
      if (ivbMin) params.set('ivb_min', ivbMin);
      if (ivbMax) params.set('ivb_max', ivbMax);
      if (hbMin) params.set('hb_min', hbMin);
      if (hbMax) params.set('hb_max', hbMax);
      if (pcMin) params.set('pc_min', pcMin);
      if (pcMax) params.set('pc_max', pcMax);
      if (bfMin) params.set('bf_min', bfMin);
      if (bfMax) params.set('bf_max', bfMax);
      if (ipMin) params.set('ip_min', ipMin);
      if (ipMax) params.set('ip_max', ipMax);
      params.set('include_chart_points', isPcuBullpenSelection ? '1' : '0');
      if (isPcuBullpenSelection) params.set('chart_points_limit', '9000');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
      if (isPcuBullpenSelection) params.set('force_raw', '1');
      const response = await fetch(`/api/dashboard/pitching/overview?${params.toString()}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => ({}))) as OverviewPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load game log.');
      // Session Type ("All" by default -- see the removed forced-Season
      // effect above) doesn't reliably tag each row's own Game split-token
      // as a bullpen: confirmed live that the exact same underlying
      // session comes back as a plain game token ("date||...||g") when NO
      // session_type filter is sent, but as "date||...||practice_..." when
      // session_type=Bullpen IS sent for that same date/pitcher -- the
      // token format itself is a side effect of the filter, not a stable
      // property of the row. The only reliable way to know which dates are
      // bullpens is to ask explicitly. This is safe as a DATE-based join
      // only when exactly one specific pitcher is selected (one pitcher
      // realistically has at most one session per day); for team-wide or
      // multi-pitcher queries this second fetch is skipped and rows fall
      // back to the best-effort string check in nonGameSessionLabel below.
      let bullpenDates: Set<string> | null = null;
      if (!isPro && !sessionType && selectedPitchers.length === 1 && pitchersParam) {
        try {
          const bullpenParams = new URLSearchParams(params);
          bullpenParams.set('session_type', 'Bullpen');
          const bullpenResponse = await fetch(`/api/dashboard/pitching/overview?${bullpenParams.toString()}`, {
            signal: controller.signal,
            cache: 'no-store',
          });
          if (bullpenResponse.ok) {
            const bullpenPayload = (await bullpenResponse.json().catch(() => ({}))) as OverviewPayload;
            const bullpenColumns = Array.isArray(bullpenPayload.table_columns) ? bullpenPayload.table_columns : [];
            const bullpenSplitColumn = String(bullpenColumns[0] ?? 'Game').trim() || 'Game';
            const bullpenRowsRaw = Array.isArray(bullpenPayload.table_rows) ? bullpenPayload.table_rows : [];
            bullpenDates = new Set(
              bullpenRowsRaw
                .map((row) => parseGameSplitToken((row as Record<string, unknown>)[bullpenSplitColumn]).date)
                .filter((date) => date && date !== '-')
            );
          }
        } catch {
          // Best-effort -- rows fall back to the string-based check below.
        }
      }
      const tableColumns = Array.isArray(payload.table_columns) ? payload.table_columns : [];
      const availableColumns = Array.isArray(payload.available_table_columns) ? payload.available_table_columns : [];
      const tableRowsRaw = Array.isArray(payload.table_rows) ? payload.table_rows : [];
      const tableRows = normalizeTableRowsForColumns(
        Array.from(new Set([...tableColumns, ...availableColumns])),
        tableRowsRaw
      );
      const chartPoints = Array.isArray(payload.chart_points) ? payload.chart_points : [];
      const splitColumn = String(tableColumns[0] ?? 'Game').trim() || 'Game';
      const leadingColumns = ['Team', 'Date', 'Opponent'];
      const seen = new Set(leadingColumns.map((col) => col.toLowerCase()));
      const metricColumns = tableColumns.filter((column) => {
        const key = String(column ?? '').trim();
        if (!key) return false;
        if (key === splitColumn) return false;
        const lower = key.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      });
      const apiAllRow = tableRows.find((row) => String((row as Record<string, unknown>)[splitColumn] ?? '').trim().toLowerCase() === 'all');
      const rows = tableRows
        .filter((row) => String((row as Record<string, unknown>)[splitColumn] ?? '').trim().toLowerCase() !== 'all')
        .map((row, rowIndex) => {
          const parsed = parseGameSplitToken((row as Record<string, unknown>)[splitColumn]);
          return {
            ...(row as Record<string, unknown>),
            _game_pin_key: `${parsed.gameKey}|${parsed.date}|${rowIndex}`,
            _game_key: parsed.gameKey,
            _game_venue_marker: parsed.pitcherMarker,
            Team: parsed.team || '-',
            Date: parsed.date || '-',
            Opponent: parsed.opponent || '-',
          } as Record<string, unknown>;
        });
      const normalizeTeamToken = (value: unknown): string =>
        String(value ?? '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9_]/g, '');
      const isPlaceholderOpponent = (value: unknown): boolean => {
        const token = normalizeTeamToken(value);
        return token === '' || token === '-' || token === 'UNKNOWN' || token === 'OPP' || token === 'OPPONENT' || token === 'OPPONENTS';
      };
      const opponentByGameKey = new Map<string, string>();
      const ambiguousGameKey = new Set<string>();
      const opponentsByDate = new Map<string, Set<string>>();
      for (const row of rows) {
        const gameKey = String(row._game_key ?? '').trim();
        const dateKey = String(row.Date ?? '').trim();
        const opponent = String(row.Opponent ?? '').trim();
        if (!isPlaceholderOpponent(opponent)) {
          if (gameKey && gameKey !== '-') {
            const existing = opponentByGameKey.get(gameKey);
            if (!existing) opponentByGameKey.set(gameKey, opponent);
            else if (existing !== opponent) ambiguousGameKey.add(gameKey);
          }
          if (dateKey) {
            const set = opponentsByDate.get(dateKey) ?? new Set<string>();
            set.add(opponent);
            opponentsByDate.set(dateKey, set);
          }
        }
      }
      for (const key of ambiguousGameKey) opponentByGameKey.delete(key);
      // Game Log now defaults to showing every session type (see the
      // removed forced Session Type default above), not just real games.
      // Prefer the authoritative bullpenDates set (a real second fetch with
      // session_type=Bullpen explicitly applied -- see above) when
      // available; a row's own Game split-token is NOT a reliable signal
      // on its own (confirmed live: the exact same session's token comes
      // back as plain "g" with no session_type filter, but as
      // "practice_..." when session_type=Bullpen IS sent for that same
      // date/pitcher -- the token format is a side effect of the filter,
      // not a stable property of the row). The string check below is only
      // a fallback for when bullpenDates isn't available (team-wide/multi-
      // pitcher queries), and it does still catch it correctly whenever
      // this SPECIFIC query happened to include a session_type filter.
      const nonGameSessionLabel = (gameKey: string): string | null => {
        if (!gameKey || gameKey === 'g' || gameKey === '-') return null;
        const lower = gameKey.toLowerCase();
        if (lower.includes('bullpen')) return 'Bullpen';
        if (lower.includes('live_bp') || lower.includes('livebp') || lower.includes('live bp')) return 'Live BP';
        if (lower.includes('practice') || lower.includes('bull') || lower.includes('bp')) return 'Bullpen';
        return 'Non-Game';
      };
      let rowsResolved = rows.map((row) => {
        if (isPcuBullpenSelection) return { ...row, Opponent: '' };
        const dateKeyForLabel = String(row.Date ?? '').trim();
        if (bullpenDates && dateKeyForLabel && bullpenDates.has(dateKeyForLabel)) {
          return { ...row, Opponent: 'Bullpen' };
        }
        const gameKey = String(row._game_key ?? '').trim();
        // A real opponent (e.g. PRO rows, which always carry a genuine
        // batter team even for a bare numeric game_pk gameKey) always wins
        // over the best-effort session-type guess below -- nonGameSessionLabel
        // exists to label rows that have NO real opponent, not to override
        // ones that do.
        if (!isPlaceholderOpponent(row.Opponent)) return row;
        const sessionLabel = nonGameSessionLabel(gameKey);
        if (sessionLabel) return { ...row, Opponent: sessionLabel };
        const dateKey = String(row.Date ?? '').trim();
        const inferredFromGame = gameKey && gameKey !== '-' ? opponentByGameKey.get(gameKey) : undefined;
        if (inferredFromGame) return { ...row, Opponent: inferredFromGame };
        const byDate = dateKey ? Array.from(opponentsByDate.get(dateKey) ?? []) : [];
        if (byDate.length === 1) return { ...row, Opponent: byDate[0] };
        return row;
      });
      if (apiAllRow) {
        rowsResolved = [...rowsResolved, {
          ...(apiAllRow as Record<string, unknown>),
          [splitColumn]: 'All',
          _game_pin_key: '__game_all__',
          _game_key: 'all',
          _game_venue_marker: '',
          Team: 'All',
          Date: '-',
          Opponent: '-',
        }];
      }
      if (isPcuBullpenSelection && rowsResolved.length === 0 && chartPoints.length > 0) {
        const maxToken = normalizePercentileColumnToken('Max');
        const countTokens = new Set(['p', 'number']);
        const sumTokens = new Set(['bf']);
        const grouped = new Map<
          string,
          {
            date: string;
            team: string;
            sums: Record<string, number>;
            counts: Record<string, number>;
            maxes: Record<string, number>;
            pitchCount: number;
          }
        >();
        for (const pitch of chartPoints) {
          const dateValue = String(pitch.session_date ?? '').slice(0, 10) || '-';
          const teamValue = String(pitch.pitcher_team_code ?? '').trim() || schoolCode || '-';
          const groupKey = `${dateValue}||${teamValue}`;
          const bucket =
            grouped.get(groupKey) ??
            {
              date: dateValue,
              team: teamValue,
              sums: {},
              counts: {},
              maxes: {},
              pitchCount: 0,
            };
          bucket.pitchCount += 1;
          for (const column of metricColumns) {
            const token = normalizePercentileColumnToken(column);
            const rawMetric = pitchLogMetricValue(column, pitch, isPro);
            const numeric = parseSortableNumber(rawMetric);
            if (numeric === null) continue;
            if (token === maxToken) {
              const prev = bucket.maxes[column];
              bucket.maxes[column] = Number.isFinite(prev) ? Math.max(prev, numeric) : numeric;
              continue;
            }
            bucket.sums[column] = (bucket.sums[column] ?? 0) + numeric;
            bucket.counts[column] = (bucket.counts[column] ?? 0) + 1;
          }
          grouped.set(groupKey, bucket);
        }
        rowsResolved = Array.from(grouped.values())
          .sort((a, b) => String(b.date).localeCompare(String(a.date)))
          .map((bucket, rowIndex) => {
            const row: Record<string, unknown> = {
              Team: bucket.team,
              Date: bucket.date,
              Opponent: '',
              _game_pin_key: `bullpen|${bucket.date}|${bucket.team}|${rowIndex}`,
              _game_key: `bullpen|${bucket.date}|${bucket.team}`,
              _game_venue_marker: '',
            };
            for (const column of metricColumns) {
              const token = normalizePercentileColumnToken(column);
              if (countTokens.has(token)) {
                row[column] = bucket.pitchCount;
                continue;
              }
              if (sumTokens.has(token)) {
                row[column] = bucket.sums[column] ?? 0;
                continue;
              }
              if (token === maxToken) {
                row[column] = bucket.maxes[column] ?? null;
                continue;
              }
              const count = bucket.counts[column] ?? 0;
              row[column] = count > 0 ? (bucket.sums[column] ?? 0) / count : null;
            }
            return row;
          });
      }
      if (!active) return;
      setGameLogColumns([...leadingColumns, ...metricColumns]);
      setGameLogRows(rowsResolved);
    };
    run()
      .catch((requestError) => {
        if (!active) return;
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setGameLogError(requestError instanceof Error ? requestError.message : 'Failed to load game log.');
      })
      .finally(() => {
        if (active) setLoadingGameLog(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    dashboardPage,
    canLoadOverview,
    canRunGameLog,
    startDate,
    endDate,
    isLeague,
    teamType,
    filters?.pitchers_by_team_code,
    filters?.opp_hitters_by_team_code,
    selectedPitchers,
    selectedHitters,
    selectedPitchTypes,
    selectedBallTypes,
    selectedZoneLocations,
    selectedPitchResults,
    selectedCountFilters,
    selectedAfterCountFilters,
    selectedInZone,
    isPro,
    level,
    withVideo,
    breakLines,
    stuffLevel,
    stuffBase,
    hand,
    batterSide,
    venue,
    sessionType,
    qpLocations,
    tableMode,
    customTableColumns,
    visualOption,
    veloMin,
    veloMax,
    ivbMin,
    ivbMax,
    hbMin,
    hbMax,
    pcMin,
    pcMax,
    bfMin,
    bfMax,
    ipMin,
    ipMax,
    filters?.school_code,
    selectedSchoolCode,
  ]);

  useEffect(() => {
    if (dashboardPage !== 'Pitch Log') return;
    if (!canLoadOverview) return;
    if (!canRunPitchLog) {
      setPitchLogRows([]);
      setPitchLogColumns([]);
      setPitchLogError('');
      setLoadingPitchLog(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setLoadingPitchLog(true);
    setPitchLogError('');
    const run = async () => {
      const schoolCode = String(filters?.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase();
      const isPcuBullpenSelection = schoolCode === 'PCU' && !isPro && /bull/i.test(String(sessionType ?? ''));
      const apiTeamType = isLeague
        ? resolveLeagueTeamTypeForApi(teamType, [filters?.pitchers_by_team_code, filters?.opp_hitters_by_team_code])
        : teamType;
      const pitchersParam = toParamValue(selectedPitchers);
      const hittersParam = toParamValue(selectedHitters);
      const pitchTypesParam = toParamValue(selectedPitchTypes);
      const ballTypesParam = toBallTypesParamValue(selectedBallTypes);
      const zoneParam = toParamValue(selectedZoneLocations);
      const resultsParam = toParamValue(selectedPitchResults);
      const countParam = toParamValue(selectedCountFilters);
      const afterCountParam = toParamValue(selectedAfterCountFilters);
      const inZoneParam = toParamValue(selectedInZone);
      const params = new URLSearchParams();
      if (startDate) params.set('start_date', startDate);
      if (endDate) params.set('end_date', endDate);
      if (teamType && teamType !== 'All') params.set('team_type', apiTeamType);
      if ((isPro || isLeague) && level && level !== 'All') params.set('level', level);
      else if (!isPro && !isLeague && PRO_LEVEL_FILTER_OPTIONS.includes(level) && level !== 'All') params.set('level', level);
      if (withVideo && withVideo !== 'All') params.set('with_video', withVideo);
      if (breakLines && breakLines !== 'None') params.set('break_lines', breakLines);
      if (stuffLevel) params.set('stuff_level', stuffLevel);
      if (stuffBase) params.set('stuff_base', stuffBase);
      if (hand && hand !== 'All') params.set('hand', hand);
      if (batterSide && batterSide !== 'All') params.set('batter_side', batterSide);
      if (venue && venue !== 'All') params.set('venue', venue);
      if (!isPro && sessionType) params.set('session_type', sessionType);
      if (qpLocations && qpLocations !== 'All') params.set('qp_locations', qpLocations);
      if (tableMode) params.set('table_mode', tableMode);
      params.set('split_by', 'Game');
      if (tableMode === 'Custom' && customTableColumns.length > 0) params.set('custom_columns', customTableColumns.join(','));
      if (visualOption && visualOption !== 'All') params.set('visual_option', visualOption);
      if (pitchersParam) params.set('pitcher', pitchersParam);
      if (hittersParam) params.set('opp_hitter', hittersParam);
      if (pitchTypesParam) params.set('pitch_types', pitchTypesParam);
      if (!isPro && !isLeague && ballTypesParam) params.set('ball_types', ballTypesParam);
      if (zoneParam) params.set('zone_locations', zoneParam);
      if (resultsParam) params.set('pitch_results', resultsParam);
      if (countParam) params.set('count_filter', countParam);
      if (afterCountParam) params.set('after_count_filter', afterCountParam);
      if (inZoneParam) params.set('in_zone', inZoneParam);
      if (veloMin) params.set('velo_min', veloMin);
      if (veloMax) params.set('velo_max', veloMax);
      if (ivbMin) params.set('ivb_min', ivbMin);
      if (ivbMax) params.set('ivb_max', ivbMax);
      if (hbMin) params.set('hb_min', hbMin);
      if (hbMax) params.set('hb_max', hbMax);
      if (pcMin) params.set('pc_min', pcMin);
      if (pcMax) params.set('pc_max', pcMax);
      if (bfMin) params.set('bf_min', bfMin);
      if (bfMax) params.set('bf_max', bfMax);
      if (ipMin) params.set('ip_min', ipMin);
      if (ipMax) params.set('ip_max', ipMax);
      params.set('include_chart_points', '1');
      params.set('chart_points_limit', isPro ? '8000' : '7000');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
      params.set('force_raw', '1');
      const response = await fetch(`/api/dashboard/pitching/overview?${params.toString()}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => ({}))) as OverviewPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load pitch log.');
      const tableColumns = Array.isArray(payload.table_columns) ? payload.table_columns : [];
      const availableColumns = Array.isArray(payload.available_table_columns) ? payload.available_table_columns : [];
      const tableRowsRaw = Array.isArray(payload.table_rows) ? payload.table_rows : [];
      const tableRows = normalizeTableRowsForColumns(
        Array.from(new Set([...tableColumns, ...availableColumns])),
        tableRowsRaw
      );
      const splitColumn = String(tableColumns[0] ?? 'Game').trim() || 'Game';
      const metricColumns = tableColumns.filter((column) => {
        const key = String(column ?? '').trim();
        if (!key || key === splitColumn) return false;
        const lower = key.toLowerCase();
        return (
          lower !== 'date' &&
          lower !== 'team' &&
          lower !== 'opponent' &&
          lower !== 'pitcher' &&
          lower !== 'batter' &&
          lower !== 'pitch type' &&
          lower !== 'pitch' &&
          lower !== 'count' &&
          lower !== 'result'
        );
      });
      const leadColumns = ['Date', 'Team', 'Opponent', 'Pitcher', 'Batter', 'Pitch Type', 'Count', 'Result'];
      const rows: Array<Record<string, unknown>> = [];
      const rowPitchMap = payload.row_pitches_by_key ?? {};
      const rowPitchCount = Object.values(rowPitchMap).reduce((sum, bucket) => sum + (Array.isArray(bucket) ? bucket.length : 0), 0);
      let chartPoints = Array.isArray(payload.chart_points) ? payload.chart_points : [];
      let useChartPointFallback = rowPitchCount === 0 && chartPoints.length > 0;
      if (isPcuBullpenSelection && rowPitchCount === 0 && chartPoints.length === 0) {
        const fallbackParams = new URLSearchParams(params);
        fallbackParams.set('split_by', 'Pitcher');
        fallbackParams.set('include_chart_points', '1');
        fallbackParams.set('chart_points_limit', '9000');
        fallbackParams.set('include_row_pitches', '0');
        fallbackParams.set('include_trend_rows', '0');
        fallbackParams.set('chart_only', '1');
        const fallbackResponse = await fetch(`/api/dashboard/pitching/overview?${fallbackParams.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (fallbackResponse.ok) {
          const fallbackPayload = (await fallbackResponse.json().catch(() => ({}))) as OverviewPayload & { error?: string };
          chartPoints = Array.isArray(fallbackPayload.chart_points) ? fallbackPayload.chart_points : [];
          useChartPointFallback = chartPoints.length > 0;
        }
      }
      const buildGameMetaCompoundKey = (dateValue: string, teamValue: string, opponentValue: string): string =>
        `${dateValue.trim()}|${normalizeLeagueTeamToken(teamValue)}|${normalizeLeagueTeamToken(opponentValue)}`;
      const gameMetaByKey = new Map<string, { team: string; opponent: string; marker: string; rowMetrics: Record<string, unknown> }>();
      for (const row of tableRows) {
        const splitRaw = (row as Record<string, unknown>)[splitColumn];
        if (String(splitRaw ?? '').trim().toLowerCase() === 'all') continue;
        const parsed = parseGameSplitToken(splitRaw);
        const splitToken = String(splitRaw ?? '').trim();
        const gameKey = String(parsed.gameKey ?? '').trim();
        const meta = {
          team: parsed.team || '-',
          opponent: parsed.opponent || '-',
          marker: parsed.pitcherMarker || '',
          rowMetrics: row as Record<string, unknown>,
        };
        if (splitToken) gameMetaByKey.set(splitToken, meta);
        if (gameKey) gameMetaByKey.set(gameKey, meta);
        if (parsed.date && parsed.team && parsed.opponent) {
          gameMetaByKey.set(buildGameMetaCompoundKey(parsed.date, parsed.team, parsed.opponent), meta);
          const teamCode = resolveLeagueTeamCodeFromValue(parsed.team);
          const opponentCode = resolveLeagueTeamCodeFromValue(parsed.opponent);
          if (teamCode && opponentCode) {
            gameMetaByKey.set(buildGameMetaCompoundKey(parsed.date, teamCode, opponentCode), meta);
          }
        }
      }
      if (useChartPointFallback) {
        for (const pitch of chartPoints) {
          const gameKeyCandidates = [
            String(pitch.game_uid ?? '').trim(),
            String(pitch.game_id ?? '').trim(),
            String(pitch.game_foreign_id ?? '').trim(),
          ].filter(Boolean);
          const dateValue = String(pitch.session_date ?? '').slice(0, 10) || '-';
          const chartPitchTeamCode = String(pitch.pitcher_team_code ?? '').trim();
          const chartBatterTeamCode = String(pitch.batter_team_code ?? '').trim();
          const compoundCandidates = [
            buildGameMetaCompoundKey(dateValue, chartPitchTeamCode, chartBatterTeamCode),
            buildGameMetaCompoundKey(
              dateValue,
              LEAGUE_TEAM_NAME_BY_CODE[chartPitchTeamCode.toUpperCase()] ?? chartPitchTeamCode,
              LEAGUE_TEAM_NAME_BY_CODE[chartBatterTeamCode.toUpperCase()] ?? chartBatterTeamCode
            ),
          ];
          const matchedMeta = [
            ...gameKeyCandidates.map((key) => gameMetaByKey.get(key)),
            ...compoundCandidates.map((key) => gameMetaByKey.get(key)),
          ].find((value) => !!value);
          const item: Record<string, unknown> = {
            Date: dateValue,
            Team: matchedMeta?.team || String(pitch.pitcher_team_code ?? '').trim() || '-',
            Opponent: isPcuBullpenSelection ? '' : (matchedMeta?.opponent || String(pitch.batter_team_code ?? '').trim() || '-'),
            Pitcher: formatNameFirstLast(String(pitch.pitcher ?? '').trim()),
            Batter: formatNameFirstLast(String(pitch.batter ?? '').trim()),
            'Pitch Type': String(pitch.pitch_type ?? '').trim() || '-',
            Count: Number.isFinite(Number(pitch.balls_num)) && Number.isFinite(Number(pitch.strikes_num))
              ? `${Number(pitch.balls_num)}-${Number(pitch.strikes_num)}`
              : '-',
            Result: resolvePitchResultLabel(pitch.pitch_call, pitch.play_result),
            _game_venue_marker: matchedMeta?.marker || '',
            _pitch_sort_date: dateValue,
            _pitch_sort_game: gameKeyCandidates[0] || '-',
            _pitch_sort_no: Number(pitch.pitch_number ?? pitch.pitch_no ?? pitch.pitch_event_id ?? 0),
            _pitch_sort_event_id: Number(pitch.pitch_event_id ?? 0),
            _pitch_pin_key: pitchIdentityKey(pitch),
            _pitch_action_point: pitch,
          };
          for (const column of metricColumns) {
            const pitchValue = pitchLogMetricValue(column, pitch, isPro);
            if (pitchValue !== null && pitchValue !== undefined) {
              item[column] = pitchValue;
            } else {
              const token = normalizePercentileColumnToken(column);
              item[column] =
                (token === 'vaa' || token === 'haa')
                  ? (
                      matchedMeta?.rowMetrics
                        ? getMetricValueFromRowByColumnToken(matchedMeta.rowMetrics, column)
                        : null
                    )
                  : pitchValue;
            }
          }
          rows.push(item);
        }
      } else {
      for (const row of tableRows) {
        const splitRaw = (row as Record<string, unknown>)[splitColumn];
        if (String(splitRaw ?? '').trim().toLowerCase() === 'all') continue;
        const parsed = parseGameSplitToken(splitRaw);
        const rowKey = String(splitRaw ?? '').trim();
        const pitches = Array.isArray(payload.row_pitches_by_key?.[rowKey]) ? payload.row_pitches_by_key[rowKey] : [];
        for (const pitch of pitches) {
          const dateValue = String(pitch.session_date ?? '').slice(0, 10) || parsed.date || '-';
          const item: Record<string, unknown> = {
            Date: dateValue,
            Team: parsed.team || String(pitch.pitcher_team_code ?? '').trim() || '-',
            Opponent: isPcuBullpenSelection ? '' : (parsed.opponent || String(pitch.batter_team_code ?? '').trim() || '-'),
            Pitcher: formatNameFirstLast(String(pitch.pitcher ?? '').trim()),
            Batter: formatNameFirstLast(String(pitch.batter ?? '').trim()),
            'Pitch Type': String(pitch.pitch_type ?? '').trim() || '-',
            Count: Number.isFinite(Number(pitch.balls_num)) && Number.isFinite(Number(pitch.strikes_num))
              ? `${Number(pitch.balls_num)}-${Number(pitch.strikes_num)}`
              : '-',
            Result: resolvePitchResultLabel(pitch.pitch_call, pitch.play_result),
            _game_venue_marker: parsed.pitcherMarker,
            _pitch_sort_date: dateValue,
            _pitch_sort_game: parsed.gameKey || String(pitch.game_uid ?? '').trim() || String(pitch.game_id ?? '').trim(),
            _pitch_sort_no: Number(pitch.pitch_number ?? pitch.pitch_no ?? pitch.pitch_event_id ?? 0),
            _pitch_sort_event_id: Number(pitch.pitch_event_id ?? 0),
            _pitch_pin_key: pitchIdentityKey(pitch),
            _pitch_action_point: pitch,
          };
          for (const column of metricColumns) {
            const pitchValue = pitchLogMetricValue(column, pitch, isPro);
            if (pitchValue !== null && pitchValue !== undefined) {
              item[column] = pitchValue;
            } else {
              const token = normalizePercentileColumnToken(column);
              item[column] =
                (token === 'vaa' || token === 'haa')
                  ? getMetricValueFromRowByColumnToken(row as Record<string, unknown>, column)
                  : pitchValue;
            }
          }
          rows.push(item);
        }
      }
      }
      rows.sort((a, b) => {
        const dateCmp = String(b._pitch_sort_date ?? '').localeCompare(String(a._pitch_sort_date ?? ''));
        if (dateCmp !== 0) return dateCmp;
        const gameCmp = String(b._pitch_sort_game ?? '').localeCompare(String(a._pitch_sort_game ?? ''));
        if (gameCmp !== 0) return gameCmp;
        const noCmp = (parseSortableNumber(b._pitch_sort_no) ?? 0) - (parseSortableNumber(a._pitch_sort_no) ?? 0);
        if (noCmp !== 0) return noCmp;
        return (parseSortableNumber(b._pitch_sort_event_id) ?? 0) - (parseSortableNumber(a._pitch_sort_event_id) ?? 0);
      });
      if (!active) return;
      setPitchLogColumns([...leadColumns, ...metricColumns]);
      setPitchLogRows(rows);
    };
    run()
      .catch((requestError) => {
        if (!active) return;
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setPitchLogError(requestError instanceof Error ? requestError.message : 'Failed to load pitch log.');
      })
      .finally(() => {
        if (active) setLoadingPitchLog(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    dashboardPage,
    canLoadOverview,
    canRunPitchLog,
    startDate,
    endDate,
    isLeague,
    teamType,
    filters?.pitchers_by_team_code,
    filters?.opp_hitters_by_team_code,
    selectedPitchers,
    selectedHitters,
    selectedPitchTypes,
    selectedBallTypes,
    selectedZoneLocations,
    selectedPitchResults,
    selectedCountFilters,
    selectedAfterCountFilters,
    selectedInZone,
    isPro,
    level,
    withVideo,
    breakLines,
    stuffLevel,
    stuffBase,
    hand,
    batterSide,
    venue,
    sessionType,
    qpLocations,
    tableMode,
    customTableColumns,
    visualOption,
    veloMin,
    veloMax,
    ivbMin,
    ivbMax,
    hbMin,
    hbMax,
    pcMin,
    pcMax,
    bfMin,
    bfMax,
    ipMin,
    ipMax,
    filters?.school_code,
    selectedSchoolCode,
  ]);

  useEffect(() => {
    if (dashboardPage !== 'AB Report') return;
    if (!selectedSinglePitcher) {
      setAbReport(null);
      setAbError('');
      return;
    }
    let active = true;
    const controller = new AbortController();
    setLoadingAbReport(true);
    setAbError('');
    const params = new URLSearchParams();
    params.set('pitcher', selectedSinglePitcher);
    if (abGameKey) params.set('game_key', abGameKey);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    if (sessionType) params.set('session_type', sessionType);
    if (hand && hand !== 'All') params.set('hand', hand);
    if (batterSide && batterSide !== 'All') params.set('batter_side', batterSide);
    const hittersParam = toParamValue(selectedHitters);
    if (hittersParam) params.set('opp_hitter', hittersParam);
    const pitchTypesParam = toParamValue(selectedPitchTypes);
    if (pitchTypesParam) params.set('pitch_types', pitchTypesParam);
    const ballTypesParam = toBallTypesParamValue(selectedBallTypes);
    if (!isPro && !isLeague && ballTypesParam) params.set('ball_types', ballTypesParam);
    if (isLeague && teamType && teamType !== 'All') {
      params.set('team_type', resolveLeagueTeamTypeForApi(teamType, [filters?.pitchers_by_team_code, filters?.opp_hitters_by_team_code]));
    } else if (teamType && teamType !== 'All') {
      params.set('team_type', teamType);
    }

    fetch(`/api/dashboard/pitching/ab-report?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as AbReportPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load AB report.');
        if (!active) return;
        setAbReport(payload);
        if (!abGameKey && payload.selected_game_key) setAbGameKey(payload.selected_game_key);
      })
      .catch((requestError) => {
        if (!active) return;
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setAbError(requestError instanceof Error ? requestError.message : 'Failed to load AB report.');
      })
      .finally(() => {
        if (active) setLoadingAbReport(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    dashboardPage,
    selectedSinglePitcher,
    abGameKey,
    startDate,
    endDate,
    sessionType,
    isPro,
    isLeague,
    hand,
    batterSide,
    selectedHitters,
    selectedPitchTypes,
    selectedBallTypes,
    teamType,
    filters?.pitchers_by_team_code,
    filters?.opp_hitters_by_team_code,
  ]);

  useEffect(() => {
    if (!canUsePitchEdits && visualOption === 'Pitch Edit') {
      setVisualOption('Play Video');
    }
  }, [canUsePitchEdits, visualOption]);

  useEffect(() => {
    if (isPitchEditDisplay) return;
    setPitchEditSelectMode('single');
    setReleaseLasso(null);
    setMovementLasso(null);
  }, [isPitchEditDisplay]);

  const loadPitchEditCount = useCallback(async () => {
    if (!canUsePitchEdits) {
      setPitchEditsAppliedCount(0);
      return;
    }
    try {
      const response = await fetch('/api/dashboard/pitching/pitch-edit-count', { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as { edit_count?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load pitch edit count.');
      setPitchEditsAppliedCount(Number(payload.edit_count ?? 0));
    } catch {
      setPitchEditsAppliedCount(0);
    }
  }, [canUsePitchEdits]);

  const loadCustomTables = async () => {
    setLoadingCustomTables(true);
    setCustomSaveState('idle');
    setCustomSaveMessage('');
    try {
      const response = await fetch('/api/dashboard/pitching/custom-tables', { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        items?: CustomTableConfig[];
      };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load custom tables.');
      const items = Array.isArray(payload.items) ? payload.items : [];
      setCustomTables(items);
      setSelectedCustomTableId(null);
      setCustomTableName('');
      setCustomTableColumns([]);
    } catch (requestError) {
      setCustomSaveState('error');
      setCustomSaveMessage(requestError instanceof Error ? requestError.message : 'Failed to load custom tables.');
    } finally {
      setLoadingCustomTables(false);
      setCustomTablesLoaded(true);
    }
  };

  useEffect(() => {
    void loadCustomTables();
  }, []);

  useEffect(() => {
    if (!isPro || !customTablesLoaded || proDefaultTableAppliedRef.current) return;
    const canApplyDefault = selectedCustomTableId === null && tableMode === 'Live';
    if (!canApplyDefault) return;
    setTableMode('Live');
    setSelectedCustomTableId(null);
    setCustomTableName('');
    setCustomTableColumns([]);
    setAppliedFilterVersion((current) => current + 1);
    proDefaultTableAppliedRef.current = true;
  }, [isPro, customTablesLoaded, selectedCustomTableId, tableMode]);

  useEffect(() => {
    if (dashboardPage !== 'Leaderboard') {
      proLeaderboardDefaultAppliedRef.current = false;
      proLeaderboardDateDefaultAppliedRef.current = false;
      return;
    }
    if (!isPro || proLeaderboardDefaultAppliedRef.current) return;
    if (tableMode === 'Live') {
      proLeaderboardDefaultAppliedRef.current = true;
      return;
    }
    setTableMode('Live');
    setShowCustomEditor(false);
    setSelectedCustomTableId(null);
    setCustomTableName('');
    setCustomTableColumns([]);
    setCustomSaveState('idle');
    setCustomSaveMessage('');
    setAppliedFilterVersion((current) => current + 1);
    proLeaderboardDefaultAppliedRef.current = true;
  }, [dashboardPage, isPro, tableMode]);

  useEffect(() => {
    if (dashboardPage !== 'Leaderboard') {
      proLeaderboardDateDefaultAppliedRef.current = false;
      return;
    }
    if (!isPro || proLeaderboardDateDefaultAppliedRef.current) return;
    const todayYmd = toYmdNow();
    const needsStartReset = !startDate || startDate < PRO_SEASON_START;
    const needsEndReset = !endDate || endDate > todayYmd;
    if (!needsStartReset && !needsEndReset) {
      proLeaderboardDateDefaultAppliedRef.current = true;
      return;
    }
    if (needsStartReset) setStartDate(PRO_SEASON_START);
    if (needsEndReset) setEndDate(todayYmd);
    setAppliedFilterVersion((current) => current + 1);
    proLeaderboardDateDefaultAppliedRef.current = true;
  }, [dashboardPage, isPro, startDate, endDate]);

  useEffect(() => {
    if (!isPcu) {
      pcuDefaultTableAppliedRef.current = false;
      return;
    }
    if (pcuDefaultTableAppliedRef.current) return;
    if (tableMode === 'Live') {
      setTableMode('Bullpen');
      setAppliedFilterVersion((current) => current + 1);
    }
    setEnableTableColors(false);
    pcuDefaultTableAppliedRef.current = true;
  }, [isPcu, tableMode]);

  useEffect(() => {
    if (!isGcu) {
      gcuDefaultTableAppliedRef.current = false;
      return;
    }
    if (!customTablesLoaded || gcuDefaultTableAppliedRef.current) return;
    const canApplyDefault = selectedCustomTableId === null && (tableMode === 'Live' || tableMode === 'Custom');
    if (!canApplyDefault) return;
    setTableMode('Banny');
    setSelectedCustomTableId(null);
    setCustomTableName('');
    setCustomTableColumns([]);
    setAppliedFilterVersion((current) => current + 1);
    gcuDefaultTableAppliedRef.current = true;
  }, [isGcu, customTablesLoaded, selectedCustomTableId, tableMode]);

  useEffect(() => {
    setAbGameKey('');
  }, [selectedSinglePitcher]);

  useEffect(() => {
    void loadPitchEditCount();
  }, [loadPitchEditCount]);

  const saveCustomTable = async () => {
    const name = customTableName.trim();
    if (!name) {
      setCustomSaveState('error');
      setCustomSaveMessage('Enter a table name first.');
      return;
    }
    setCustomSaveState('saving');
    setCustomSaveMessage('');
    try {
      const response = await fetch('/api/dashboard/pitching/custom-tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedCustomTableId ?? undefined,
          name,
          columns: customTableColumns,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        item?: CustomTableConfig;
      };
      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? 'Failed to save custom table.');
      }
      const saved = payload.item;
      setCustomSaveState('saved');
      setCustomSaveMessage('Custom table saved.');
      setSelectedCustomTableId(saved.id);
      setCustomTableName(saved.name);
      setCustomTableColumns(saved.columns ?? []);
      setCustomTables((current) => {
        const next = [saved, ...current.filter((row) => row.id !== saved.id)];
        return next;
      });
      setAppliedFilterVersion((current) => current + 1);
    } catch (requestError) {
      setCustomSaveState('error');
      setCustomSaveMessage(requestError instanceof Error ? requestError.message : 'Failed to save custom table.');
    }
  };

  const deleteCustomTable = async () => {
    if (!selectedCustomTableId) return;
    setCustomSaveState('saving');
    setCustomSaveMessage('');
    try {
      const response = await fetch(`/api/dashboard/pitching/custom-tables?id=${selectedCustomTableId}`, {
        method: 'DELETE',
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to delete custom table.');
      }
      setCustomTables((current) => current.filter((row) => row.id !== selectedCustomTableId));
      setSelectedCustomTableId(null);
      setCustomTableName('');
      setCustomTableColumns([]);
      setCustomSaveState('saved');
      setCustomSaveMessage('Custom table deleted.');
      setAppliedFilterVersion((current) => current + 1);
    } catch (requestError) {
      setCustomSaveState('error');
      setCustomSaveMessage(requestError instanceof Error ? requestError.message : 'Failed to delete custom table.');
    }
  };

  const currentActionPitch = actionPitches[actionIndex] ?? null;

  const refreshActionPitchVideoUrls = async (pitches: PitchActionPoint[]): Promise<PitchActionPoint[]> => {
    if (!pitches.length) return pitches;
    const ids = Array.from(
      new Set(
        pitches
          .map((pitch) => Number(pitch.pitch_event_id))
          .filter((id) => Number.isFinite(id) && id > 0)
          .map((id) => Math.trunc(id))
      )
    );
    if (!ids.length) return pitches;
    const cachedById = actionVideoLookupCacheRef.current;
    let nextPitches = pitches.map((pitch) => {
      const id = Number(pitch.pitch_event_id);
      const cached = Number.isFinite(id) && id > 0 ? cachedById.get(Math.trunc(id)) : undefined;
      return cached
        ? {
            ...pitch,
            video_clip_1: cached.video_clip_1 ?? pitch.video_clip_1,
            video_clip_2: cached.video_clip_2 ?? pitch.video_clip_2,
            video_clip_3: cached.video_clip_3 ?? pitch.video_clip_3,
          }
        : pitch;
    });
    const missingIds = ids.filter((id) => !cachedById.has(id));
    if (!missingIds.length) return nextPitches;
    try {
      const req = new URL('/api/dashboard/pitching/video-lookup', window.location.origin);
      req.searchParams.set('ids', missingIds.join(','));
      req.searchParams.set('_video_refresh', String(Date.now()));
      const response = await fetch(req.toString(), { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as {
        pitches?: Array<
          PitchActionPoint & {
            video_clip_1_is_edger?: boolean;
            video_clip_2_is_edger?: boolean;
            video_clip_3_is_edger?: boolean;
          }
        >;
        error?: string;
      };
      if (!response.ok || payload.error) return nextPitches;
      const freshPoints = Array.isArray(payload.pitches) ? payload.pitches : [];
      if (!freshPoints.length) return nextPitches;
      const byId = new Map<number, PitchActionPoint>();
      for (const point of freshPoints) {
        const id = Number(point.pitch_event_id);
        if (Number.isFinite(id) && id > 0) {
          const normalizedId = Math.trunc(id);
          byId.set(normalizedId, point);
          cachedById.set(normalizedId, {
            video_clip_1: point.video_clip_1 ?? '',
            video_clip_2: point.video_clip_2 ?? '',
            video_clip_3: point.video_clip_3 ?? '',
          });
          actionVideoEdgerFlagsRef.current.set(normalizedId, [
            Boolean(point.video_clip_1_is_edger),
            Boolean(point.video_clip_2_is_edger),
            Boolean(point.video_clip_3_is_edger),
          ]);
        }
      }
      nextPitches = nextPitches.map((pitch) => {
        const id = Number(pitch.pitch_event_id);
        const fresh = Number.isFinite(id) && id > 0 ? byId.get(Math.trunc(id)) : undefined;
        if (!fresh) return pitch;
        return {
          ...pitch,
          video_clip_1: fresh.video_clip_1 ?? pitch.video_clip_1,
          video_clip_2: fresh.video_clip_2 ?? pitch.video_clip_2,
          video_clip_3: fresh.video_clip_3 ?? pitch.video_clip_3,
        };
      });
      return nextPitches;
    } catch {
      return nextPitches;
    }
  };

  const openActionModal = async (pitches: PitchActionPoint[], startingPitch?: PitchActionPoint) => {
    const deduped = Array.from(new Map(pitches.map((pitch) => [pitchIdentityKey(pitch), pitch])).values());
    if (!deduped.length) return;
    const startIndex = startingPitch
      ? Math.max(
          0,
          deduped.findIndex((pitch) => pitchIdentityKey(pitch) === pitchIdentityKey(startingPitch))
        )
      : 0;
    const nextMode: 'video' | 'edit' | 'spin' =
      visualOption === 'Pitch Edit' && canUsePitchEdits ? 'edit' : visualOption === 'Spin Visual' ? 'spin' : 'video';
    const startPitch = deduped[startIndex];
    const firstPitchHasVideo = Boolean(startPitch?.video_clip_1 || startPitch?.video_clip_2 || startPitch?.video_clip_3);
    setActionPitches(deduped);
    setActionIndex(startIndex);
    setActionMode(nextMode);
    setEditPitchType(startPitch?.pitch_type ?? '');
    setEditPitcher(resolvePitcherName(startPitch, selectedPitchers));
    setEditBallType('');
    setActionSaveState('idle');
    setActionSaveMessage('');
    setActionIsPlaying(nextMode === 'spin');
    setActionSpinFrame(12);
    setActionSideBySide(false);
    setActionLeftPitchKey('');
    setActionRightPitchKey('');
    setActionCompareVideoOverrides({});
    setActionVideoPlaying(false);
    setActionVideoTime(0);
    setActionVideoDuration(0);
    setActionVideoLookupLoading(nextMode === 'video' && !firstPitchHasVideo);
    setActionVideoRefreshNonce((value) => value + 1);
    setBreakdownToolbarVisible(true);
    actionVideoRetryKeysRef.current.clear();
    actionCompareVideoLookupKeysRef.current.clear();

    if (nextMode !== 'video') return;
    const refreshed = await refreshActionPitchVideoUrls(deduped);
    setActionPitches(refreshed);
    setActionVideoLookupLoading(false);
    setActionVideoRefreshNonce((value) => value + 1);
  };

  useEffect(() => {
    if (!currentActionPitch) return;
    setEditPitchType(currentActionPitch.pitch_type ?? '');
    setEditPitcher(resolvePitcherName(currentActionPitch, selectedPitchers));
    setEditBallType('');
    setActionSaveState('idle');
    setActionSaveMessage('');
  }, [actionIndex, currentActionPitch?.pitch_type, currentActionPitch?.pitcher]);

  useEffect(() => {
    if (!actionMode) return;
    if (!actionIsPlaying) return;
    if (actionMode === 'spin') return;
    const timer = window.setInterval(() => {
      setActionSpinFrame((value) => (value >= 128 ? 1 : value + 1));
    }, 60);
    return () => window.clearInterval(timer);
  }, [actionIsPlaying, actionMode]);

  const saveCurrentPitchEdit = async () => {
    const editIds = Array.from(
      new Set(actionPitches.map((pitch) => pitch.pitch_event_id).filter((id): id is number => typeof id === 'number' && id > 0))
    );
    if (!editIds.length) {
      setActionSaveState('error');
      setActionSaveMessage('Missing pitch id. Cannot save this edit.');
      return;
    }
    const nextPitchType = (editPitchType || currentActionPitch.pitch_type || '').trim();
    const nextPitcher = (editPitcher || resolvePitcherName(currentActionPitch, selectedPitchers) || '').trim();
    const nextBallType = editBallType.trim();
    if (!nextPitchType || !nextPitcher) {
      setActionSaveState('error');
      setActionSaveMessage('Pitch type and pitcher are required.');
      return;
    }

    setActionSaveState('saving');
    setActionSaveMessage('');
    try {
      const response = await fetch('/api/dashboard/pitching/pitch-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pitch_event_ids: editIds,
          pitch_type: nextPitchType,
          pitcher: nextPitcher,
          ...(nextBallType ? { ball_type: nextBallType } : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean; updated_count?: number };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Failed to save pitch edit.');
      }

      const editSet = new Set(editIds);
      const applyPitchEdit = (pitch: PitchActionPoint): PitchActionPoint =>
        editSet.has(Number(pitch.pitch_event_id ?? -1))
          ? { ...pitch, pitch_type: nextPitchType, pitcher: nextPitcher }
          : pitch;

      setOverview((previous) => {
        if (!previous) return previous;
        const nextChartPoints = (previous.chart_points ?? []).map((pitch) => applyPitchEdit(pitch as PitchActionPoint));
        const nextRowPitches = Object.fromEntries(
          Object.entries(previous.row_pitches_by_key ?? {}).map(([key, rows]) => [
            key,
            (rows ?? []).map((pitch) => applyPitchEdit(pitch as PitchActionPoint)),
          ])
        );
        const splitColumn = String(previous.table_columns?.[0] ?? '').trim();
        const splitNorm = splitColumn.toLowerCase().replace(/\s+/g, ' ');
        const countColumn = previous.table_columns?.includes('#') ? '#' : previous.table_columns?.includes('P') ? 'P' : '';
        const editableBefore = actionPitches.filter((pitch) => editSet.has(Number(pitch.pitch_event_id ?? -1)));
        const tableDelta = new Map<string, number>();
        const addDelta = (key: string, delta: number) => {
          const clean = String(key ?? '').trim();
          if (!clean) return;
          tableDelta.set(clean.toLowerCase(), (tableDelta.get(clean.toLowerCase()) ?? 0) + delta);
        };
        if (countColumn && editableBefore.length) {
          for (const pitch of editableBefore) {
            if (splitNorm === 'pitch' || splitNorm === 'pitch type' || splitNorm === 'pitch types') {
              addDelta(String(pitch.pitch_type ?? 'Undefined'), -1);
              addDelta(nextPitchType, 1);
            } else if (splitNorm === 'pitcher') {
              addDelta(resolvePitcherName(pitch, selectedPitchers) || String(pitch.pitcher ?? 'Unknown Pitcher'), -1);
              addDelta(nextPitcher, 1);
            }
            const allKey = String((previous.table_rows ?? []).find((row) => {
              const value = String((row as Record<string, unknown>)[splitColumn] ?? '').trim().toLowerCase();
              return value === 'all' || value === 'all (pinned)';
            })?.[splitColumn] ?? '');
            if (allKey) addDelta(allKey, 0);
          }
        }
        let nextTableRows: Record<string, string | number | null>[] = previous.table_rows ?? [];
        if (splitColumn && countColumn && tableDelta.size) {
          nextTableRows = nextTableRows.map((row) => {
            const rowObj = row as Record<string, string | number | null>;
            const rowName = String(rowObj[splitColumn] ?? '').trim();
            const delta = tableDelta.get(rowName.toLowerCase()) ?? 0;
            if (!delta) return row;
            const currentCount = Number(rowObj[countColumn] ?? 0);
            if (!Number.isFinite(currentCount)) return row;
            return { ...rowObj, [countColumn]: Math.max(0, currentCount + delta) };
          });
          const existingKeys = new Set(
            nextTableRows.map((row) => String((row as Record<string, unknown>)[splitColumn] ?? '').trim().toLowerCase())
          );
          for (const [key, delta] of tableDelta.entries()) {
            if (delta <= 0 || existingKeys.has(key) || key === 'all' || key === 'all (pinned)') continue;
            const displayValue = splitNorm === 'pitcher' ? nextPitcher : nextPitchType;
            nextTableRows = [...nextTableRows, { [splitColumn]: displayValue, [countColumn]: delta }];
          }
        }
        return {
          ...previous,
          chart_points: nextChartPoints,
          row_pitches_by_key: nextRowPitches,
          table_rows: nextTableRows,
        };
      });
      setActionPitches((rows) =>
        rows.map((row, idx) =>
          editIds.includes(row.pitch_event_id ?? -1)
            ? { ...row, pitch_type: nextPitchType, pitcher: nextPitcher }
            : row
        )
      );
      setActionSaveState('saved');
      setActionSaveMessage(`Saved ${payload.updated_count ?? editIds.length} pitch edit(s).`);
      const editCacheBust = Date.now();
      setPostEditCacheBust(editCacheBust);
      overviewCacheRef.current.clear();
      overviewInflightRef.current.clear();
      setAppliedFilterVersion((current) => current + 1);
      window.setTimeout(() => {
        overviewCacheRef.current.clear();
        overviewInflightRef.current.clear();
        setAppliedFilterVersion((current) => current + 1);
      }, 900);
      await loadPitchEditCount();
      setActionMode(null);
    } catch (requestError) {
      setActionSaveState('error');
      setActionSaveMessage(requestError instanceof Error ? requestError.message : 'Failed to save pitch edit.');
    }
  };

  const pitchColors: Record<string, string> = {
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
  const pitchHoverTextColor = (bg?: string): string => {
    if (!bg) return '#fff';
    const v = bg.toLowerCase();
    if (v.includes('--portal-fastball-color')) {
      const isLight = typeof document !== 'undefined' && document.body.classList.contains('theme-light');
      return isLight ? '#fff' : '#111';
    }
    if (v === '#ffffff' || v === 'white' || v === 'orange' || v === 'turquoise') return '#111';
    return '#fff';
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const rgb = (r: number, g: number, b: number) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  const divergingColor = (value: number, min: number, mid: number, max: number): string => {
    if (!Number.isFinite(value)) return 'rgba(255,255,255,0.08)';
    if (value <= mid) {
      const t = Math.max(0, Math.min(1, (value - min) / Math.max(1e-9, mid - min)));
      return rgb(lerp(32, 246, t), lerp(74, 248, t), lerp(135, 248, t));
    }
    const t = Math.max(0, Math.min(1, (value - mid) / Math.max(1e-9, max - mid)));
    return rgb(lerp(248, 220, t), lerp(248, 20, t), lerp(248, 20, t));
  };
  const sequentialColor = (value: number, min: number, max: number): string => {
    if (!Number.isFinite(value)) return 'rgba(255,255,255,0.08)';
    const mid = min + (max - min) * 0.5;
    return divergingColor(value, min, mid, max);
  };
  const resultShape = (pitchCall: string, playResult: string, pointSchoolCode?: string | null): string => {
    const effectiveSchoolCode =
      pointSchoolCode != null && pointSchoolCode !== ''
        ? String(pointSchoolCode).trim().toUpperCase()
        : String(selectedSchoolCode || '').trim().toUpperCase();
    if (effectiveSchoolCode === 'PRO') {
      const norm = (value: string): string => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const callN = norm(pitchCall);
      const prN = norm(playResult);
      if (callN === 'called_strike' || callN === 'strikecalled') return 'Called Strike';
      if (
        callN === 'hit_by_pitch' ||
        callN === 'hitbypitch' ||
        prN === 'hit_by_pitch' ||
        prN === 'hitbypitch' ||
        callN === 'ball' ||
        callN === 'ballcalled' ||
        callN === 'ball_called' ||
        callN === 'ballindirt' ||
        callN === 'ball_in_dirt' ||
        callN === 'blocked_ball' ||
        callN === 'pitchout' ||
        callN === 'ball_pitchout' ||
        callN === 'intentional_ball' ||
        callN === 'intent_ball'
      ) {
        return 'Ball';
      }
      if (callN.includes('foul')) return 'Foul';
      if (callN === 'swinging_strike' || callN === 'swinging_strike_blocked' || callN === 'swinging_strike_pitchout' || callN === 'missed_bunt' || callN === 'strikeswinging') return 'Whiff';
      if (prN === 'single' || prN === 'double' || prN === 'triple' || prN === 'home_run' || prN === 'homerun') return 'In Play (Hit)';
      if (prN === 'field_error' || prN === 'error') return 'Error';
      if (callN.startsWith('in_play') || callN.startsWith('hit_into_play') || callN === 'inplay') return 'In Play (Out)';
      if (prN && !['walk', 'intent_walk', 'intentional_walk', 'strikeout', 'strikeout_double_play', 'hit_by_pitch', 'hitbypitch'].includes(prN)) return 'In Play (Out)';
      return '';
    }
    if (pitchCall === 'HitByPitch' || playResult === 'HitByPitch') return 'Ball';
    if (pitchCall === 'StrikeCalled') return 'Called Strike';
    if (pitchCall === 'BallCalled' || pitchCall === 'BallinDirt') return 'Ball';
    if (pitchCall === 'FoulBall' || pitchCall === 'FoulBallFieldable' || pitchCall === 'FoulBallNotFieldable') return 'Foul';
    if (pitchCall === 'StrikeSwinging') return 'Whiff';
    if (pitchCall === 'InPlay' && (playResult === 'Out' || playResult === 'FieldersChoice' || playResult === 'Sacrifice')) return 'In Play (Out)';
    if (pitchCall === 'InPlay' && (playResult === 'Single' || playResult === 'Double' || playResult === 'Triple' || playResult === 'HomeRun')) return 'In Play (Hit)';
    if (pitchCall === 'InPlay' && playResult === 'Error') return 'Error';
    return '';
  };
  const fmt1 = (value: unknown): string => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(1) : '-';
  };
  const fmt2 = (value: unknown): string => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : '-';
  };
  const tooltipHtml = (point: OverviewPayload['chart_points'][number]): string => {
    const pitchCount = Number((point as { pitch_n?: unknown }).pitch_n);
    const isAggregatePoint =
      Number.isFinite(pitchCount) &&
      pitchCount > 0 &&
      !String(point.pitcher || '').trim() &&
      !String(point.batter || '').trim() &&
      !point.pitch_event_id;
    if (isAggregatePoint) {
      return `Pitch Type: ${point.pitch_type || '-'}\nPitches: ${Math.round(pitchCount)}\nVelo: ${fmt1(point.velo)} mph\nIVB: ${fmt1(point.ivb)} in\nHB: ${fmt1(point.hb)} in\nIn Zone: ${inZoneLabel(point.plate_side, point.plate_height)}`;
    }
    return `Pitcher: ${formatNameFirstLast(String(point.pitcher || '')) || '-'}\nBatter: ${formatNameFirstLast(String(point.batter || '')) || '-'}\nSession: ${point.session_type || '-'}\nResult: ${resolvePitchResultLabel(point.pitch_call, point.play_result)}\nVelo: ${fmt1(point.velo)} mph\nIVB: ${fmt1(point.ivb)} in\nHB: ${fmt1(point.hb)} in\nEV: ${fmt1(point.exit_speed)} mph\nLA: ${fmt1(point.angle)}°\nStuff+: ${fmt1(point.stuff_plus)}\nIn Zone: ${inZoneLabel(point.plate_side, point.plate_height)}`;
  };
  const releaseTooltipHtml = (point: OverviewPayload['chart_points'][number]): string =>
    `Session: ${point.session_type || '-'}\nHeight: ${fmt2(point.release_height)} ft\nSide: ${fmt2(Number.isFinite(Number(point.release_side)) ? orientX(Number(point.release_side), point.school_code) : null)} ft\nExtension: ${fmt2(point.extension)} ft`;
  const parseTiltToDegrees = (tilt: string): number | null => {
    const raw = (tilt ?? '').trim();
    if (!raw) return null;
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) {
      const normalized = ((asNumber % 360) + 360) % 360;
      return normalized;
    }
    const clockMatch = raw.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/) ?? raw.match(/^(\d{1,2})\.(\d{1,2})$/);
    const match = clockMatch;
    if (!match) return null;
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    const hoursMod = ((hh % 12) + 12) % 12;
    const totalDeg = (hoursMod * 60 + mm) * 0.5;
    let deg = (totalDeg - 180) % 360;
    if (deg < 0) deg += 360;
    return deg;
  };
  const tiltDegreesToVector = (deg: number | null): { x: number; y: number } | null => {
    if (deg === null || !Number.isFinite(deg)) return null;
    const rad = (deg * Math.PI) / 180;
    return {
      x: -Math.sin(rad),
      y: Math.cos(rad),
    };
  };
  const SpinVisualCanvas = ({
    releaseTilt,
    breakTilt,
    spinEff,
    pitcherHand,
    frame,
    playing,
    onFrameChange,
  }: {
    releaseTilt: string;
    breakTilt: string;
    spinEff: number | null;
    pitcherHand: string | null | undefined;
    frame: number;
    playing: boolean;
    onFrameChange: (nextFrame: number) => void;
  }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const animFrameRef = useRef<number | null>(null);
    const lastTsRef = useRef<number | null>(null);
    const frameRef = useRef<number>(frame);
    const lastEmitRef = useRef<number>(0);

    useEffect(() => {
      frameRef.current = frame;
    }, [frame]);

    const drawFrame = useCallback((targetFrame: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const ensureSize = () => {
        const parent = canvas.parentElement;
        const width = parent ? parent.clientWidth : 760;
        const height = parent ? parent.clientHeight : 560;
        const nextWidth = Math.max(420, Math.round(width));
        const nextHeight = Math.max(360, Math.round(height));
        if (canvas.width !== nextWidth) canvas.width = nextWidth;
        if (canvas.height !== nextHeight) canvas.height = nextHeight;
        return { width: nextWidth, height: nextHeight };
      };

      const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
      const normalize2D = (x: number, y: number) => {
        const len = Math.hypot(x, y);
        if (len < 1e-6) return null;
        return { x: x / len, y: y / len };
      };
      const tiltDegreesToVec = (deg: number | null) => {
        if (deg === null || !Number.isFinite(deg)) return null;
        const rad = (deg * Math.PI) / 180;
        return { x: -Math.sin(rad), y: Math.cos(rad) };
      };
      const clampSpinEfficiency = (val: number | null) => {
        if (val === null || !Number.isFinite(val)) return 1;
        const asPct = val > 1 ? val / 100 : val;
        return clamp(asPct, 0, 1);
      };

      const drawClockNumbers = (cx: number, cy: number, ringInner: number, ringOuter: number) => {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        const ringThickness = Math.max(1, ringOuter - ringInner);
        const fontSize = Math.max(9, Math.min(ringThickness * 0.5, ringOuter * 0.065));
        ctx.font = `${fontSize}px Inter, Helvetica Neue, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let clockRadius = ringInner + ringThickness * 0.58;
        const minRadius = ringInner + fontSize * 0.6;
        const maxRadius = ringOuter - fontSize * 0.6;
        clockRadius = clamp(clockRadius, minRadius, maxRadius);
        for (let hour = 1; hour <= 12; hour += 1) {
          const angle = Math.PI / 2 - (hour / 12) * Math.PI * 2;
          const x = cx + Math.cos(angle) * clockRadius;
          const y = cy - Math.sin(angle) * clockRadius;
          ctx.fillText(String(hour), x, y);
        }
        ctx.restore();
      };

      const drawTiltArrow = (cx: number, cy: number, radius: number, stageRadius: number, deg: number | null, color: string, dashed: boolean) => {
        const vec = tiltDegreesToVec(deg);
        if (!vec) return;
        const startRadius = radius * 1.01;
        const endRadius = Math.max(radius * 1.18, stageRadius - 2);
        const startX = cx + vec.x * startRadius;
        const startY = cy + vec.y * startRadius;
        const endX = cx + vec.x * endRadius;
        const endY = cy + vec.y * endRadius;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 5.8;
        ctx.lineCap = 'round';
        ctx.setLineDash(dashed ? [6, 5] : []);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        const headLen = radius * 0.14;
        const tiltAngle = Math.atan2(vec.y, vec.x);
        const perpAngle = tiltAngle + Math.PI / 2;
        const perpX = Math.cos(perpAngle);
        const perpY = Math.sin(perpAngle);
        const backAngle = tiltAngle + Math.PI;
        const baseX = endX + Math.cos(backAngle) * headLen;
        const baseY = endY + Math.sin(backAngle) * headLen;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(baseX + perpX * headLen * 0.5, baseY + perpY * headLen * 0.5);
        ctx.lineTo(baseX - perpX * headLen * 0.5, baseY - perpY * headLen * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };

      const drawSpinRod = (cx: number, cy: number, radius: number, stageRadius: number, rodDir: { x: number; y: number }, releaseDir: { x: number; y: number }, efficiency: number) => {
        const rodPerp = { x: -rodDir.y, y: rodDir.x };
        const outerLimit = Math.max(radius + 6, stageRadius - 2);
        const ballLimit = Math.max(2, radius);
        const rodWidth = Math.max(radius * 0.018, 1.2);
        const penetrationDistance = (1 - efficiency) * ballLimit;
        let fullSideSign = (rodDir.x * releaseDir.x + rodDir.y * releaseDir.y) >= 0 ? 1 : -1;
        const hand = String(pitcherHand ?? '').toUpperCase();
        if (hand.startsWith('L') || hand.startsWith('R')) {
          const handSign = hand.startsWith('L') ? -1 : 1;
          const sideVec = { x: releaseDir.y * handSign, y: -releaseDir.x * handSign };
          fullSideSign = (rodDir.x * sideVec.x + rodDir.y * sideVec.y) >= 0 ? 1 : -1;
        }

        const drawSeg = (startDist: number, endDist: number, color: string, alpha: number, dashed = false) => {
          const sx = cx + rodDir.x * startDist;
          const sy = cy + rodDir.y * startDist;
          const ex = cx + rodDir.x * endDist;
          const ey = cy + rodDir.y * endDist;
          ctx.save();
          ctx.strokeStyle = color;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = Math.max(1.4, rodWidth * 2);
          ctx.lineCap = 'butt';
          ctx.setLineDash(dashed ? [Math.max(6, radius * 0.08), Math.max(4, radius * 0.055)] : []);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
          void rodPerp;
        };
        drawSeg(-outerLimit, -ballLimit, 'rgba(120,120,120,1)', 0.32);
        drawSeg(ballLimit, outerLimit, 'rgba(120,120,120,1)', 0.32);
        drawSeg(-ballLimit, ballLimit, 'rgba(165,155,142,1)', 0.9, true);

        const visibilityEnd = Math.max(0, ballLimit - penetrationDistance);
        if (fullSideSign > 0) drawSeg(visibilityEnd, outerLimit, 'rgba(0,0,0,1)', 0.98);
        else drawSeg(-outerLimit, -visibilityEnd, 'rgba(0,0,0,1)', 0.98);
      };

      const drawOrbitingArrows = (cx: number, cy: number, radius: number, rotationRad: number, axisDir: { x: number; y: number }, efficiency: number) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1, radius), 0, Math.PI * 2);
        ctx.clip();
        const arrowCount = 10;
        const arrowLen = radius * 0.18;
        const arrowWidth = radius * 0.045;
        const curveMixRaw = clamp(1 - efficiency, 0, 1);
        const curveMix = Math.pow(curveMixRaw, 1.35);
        const axisAngle = Math.atan2(axisDir.y, axisDir.x);
        const travel = (rotationRad / (Math.PI * 2)) * 1.2;
        const fullCircleThreshold = 0.985;
        const circleRadius = radius * 0.995;
        const axisLen = radius;

        const samplePath = (phase: number) => {
          let p = phase;
          while (p < 0) p += 1;
          while (p >= 1) p -= 1;
          const lineProgress = 1 - p * 2;
          const lineX = cx + Math.cos(axisAngle) * lineProgress * axisLen;
          const lineY = cy + Math.sin(axisAngle) * lineProgress * axisLen;
          const lineTanX = -Math.cos(axisAngle);
          const lineTanY = -Math.sin(axisAngle);
          if (curveMixRaw >= fullCircleThreshold) {
            const fullAngle = axisAngle + p * Math.PI * 2;
            const fullX = cx + Math.cos(fullAngle) * circleRadius;
            const fullY = cy + Math.sin(fullAngle) * circleRadius;
            const t = normalize2D(-Math.sin(fullAngle), Math.cos(fullAngle)) ?? axisDir;
            return { x: fullX, y: fullY, tangent: t };
          }
          const arcAngle = axisAngle + p * Math.PI;
          const arcX = cx + Math.cos(arcAngle) * circleRadius;
          const arcY = cy + Math.sin(arcAngle) * circleRadius;
          const arcTanX = -Math.sin(arcAngle);
          const arcTanY = Math.cos(arcAngle);
          const finalX = lineX * (1 - curveMix) + arcX * curveMix;
          const finalY = lineY * (1 - curveMix) + arcY * curveMix;
          const tan = normalize2D(lineTanX * (1 - curveMix) + arcTanX * curveMix, lineTanY * (1 - curveMix) + arcTanY * curveMix) ?? { x: lineTanX, y: lineTanY };
          return { x: finalX, y: finalY, tangent: tan };
        };

        for (let i = 0; i < arrowCount; i += 1) {
          const phase = (i / arrowCount + travel) % 1;
          const pt = samplePath(phase);
          const tangent = pt.tangent;
          const normal = { x: -tangent.y, y: tangent.x };
          const phaseFade = 0.2 + 0.8 * (1 - Math.abs(phase - 0.5) * 2);
          const localLen = arrowLen * (0.3 + 0.7 * phaseFade);
          const tipX = pt.x + tangent.x * localLen * 0.55;
          const tipY = pt.y + tangent.y * localLen * 0.55;
          const baseX = pt.x - tangent.x * localLen * 0.35;
          const baseY = pt.y - tangent.y * localLen * 0.35;
          const headInnerX = tipX - tangent.x * localLen * 0.2;
          const headInnerY = tipY - tangent.y * localLen * 0.2;
          const grad = ctx.createLinearGradient(baseX, baseY, tipX, tipY);
          grad.addColorStop(0, 'rgba(170, 125, 48, 1)');
          grad.addColorStop(0.6, 'rgba(215, 185, 120, 1)');
          grad.addColorStop(1, 'rgba(255, 255, 255, 1)');
          ctx.save();
          ctx.globalAlpha = phaseFade;
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(headInnerX + normal.x * arrowWidth, headInnerY + normal.y * arrowWidth);
          ctx.lineTo(baseX + normal.x * arrowWidth, baseY + normal.y * arrowWidth);
          ctx.lineTo(baseX - normal.x * arrowWidth, baseY - normal.y * arrowWidth);
          ctx.lineTo(headInnerX - normal.x * arrowWidth, headInnerY - normal.y * arrowWidth);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(112, 72, 34, 1)';
          ctx.lineWidth = Math.max(1, radius * 0.02);
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      };

      const bounds = ensureSize();
      const width = bounds.width;
      const height = bounds.height;
      const cx = width / 2;
      const cy = height * 0.475;
      const edgeMargin = 16;
      const ringOuter = Math.max(
        120,
        Math.min(cx - edgeMargin, width - cx - edgeMargin, cy - edgeMargin, height - cy - edgeMargin)
      );
      const ringThickness = Math.max(24, Math.min(34, ringOuter * 0.14));
      const stageRadius = Math.max(90, ringOuter - ringThickness * 0.55);
      const ballGap = Math.max(12, ringOuter * 0.05);
      const radius = Math.max(78, Math.min(stageRadius - ballGap, stageRadius * 0.6));
      const releaseDeg = parseTiltToDegrees(releaseTilt);
      const breakDeg = parseTiltToDegrees(breakTilt);
      const releaseVec = tiltDegreesToVec(releaseDeg);
      const tiltDir = releaseVec ?? { x: 0, y: 1 };
      const rodDir = normalize2D(-tiltDir.y, tiltDir.x) ?? { x: 1, y: 0 };
      const efficiency = clampSpinEfficiency(spinEff);
      const rotation = ((targetFrame - 1) / 128) * Math.PI * 2;

      ctx.clearRect(0, 0, width, height);
      ctx.beginPath();
      ctx.arc(cx, cy, stageRadius + 16, 0, Math.PI * 2);
      ctx.strokeStyle = '#cdd2d9';
      ctx.lineWidth = ringThickness;
      ctx.stroke();
      drawClockNumbers(cx, cy, stageRadius, ringOuter);

      const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.1, cx, cy, radius * 1.1);
      grad.addColorStop(0, 'rgba(255,255,255,0.3)');
      grad.addColorStop(0.25, 'rgba(253,251,247,0.27)');
      grad.addColorStop(0.5, 'rgba(245,240,230,0.23)');
      grad.addColorStop(0.75, 'rgba(232,220,200,0.19)');
      grad.addColorStop(1, 'rgba(212,196,168,0.15)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(150,130,100,0.28)';
      ctx.stroke();

      drawSpinRod(cx, cy, radius, stageRadius, rodDir, releaseVec ?? { x: 0, y: 1 }, efficiency);
      drawOrbitingArrows(cx, cy, radius, rotation, releaseVec ?? { x: 0, y: 1 }, efficiency);

      drawTiltArrow(cx, cy, radius, stageRadius, releaseDeg, '#ffb300', true);
      drawTiltArrow(cx, cy, radius, stageRadius, breakDeg, '#4caf50', false);
    }, [breakTilt, pitcherHand, releaseTilt, spinEff]);

    useEffect(() => {
      if (playing) return;
      drawFrame(frameRef.current);
    }, [drawFrame, frame, playing]);

    useEffect(() => {
      if (animFrameRef.current !== null) {
        window.cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      lastTsRef.current = null;
      if (!playing) return;
      const fps = 24;
      const step = (ts: number) => {
        const prev = lastTsRef.current ?? ts;
        const delta = Math.max(0, ts - prev);
        lastTsRef.current = ts;
        frameRef.current += (delta * fps) / 1000;
        while (frameRef.current > 128) frameRef.current -= 128;
        while (frameRef.current < 1) frameRef.current += 128;
        drawFrame(frameRef.current);
        if (ts - lastEmitRef.current >= 1100) {
          lastEmitRef.current = ts;
          onFrameChange(Math.max(1, Math.min(128, Math.round(frameRef.current))));
        }
        animFrameRef.current = window.requestAnimationFrame(step);
      };
      animFrameRef.current = window.requestAnimationFrame(step);
      return () => {
        if (animFrameRef.current !== null) window.cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      };
    }, [drawFrame, onFrameChange, playing]);

    return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
  };
  const actionPitchCount = actionPitches.length;
  const actionDateLabel = currentActionPitch?.session_date ? formatShortDate(currentActionPitch.session_date) : '-';
  const hasActionVideo = !!(
    currentActionPitch &&
    (currentActionPitch.video_clip_1 || currentActionPitch.video_clip_2 || currentActionPitch.video_clip_3)
  );
  const actionVideoUrls = currentActionPitch
    ? [currentActionPitch.video_clip_1, currentActionPitch.video_clip_2, currentActionPitch.video_clip_3].filter(
        (url) => !!url && url.trim().length > 0
      )
    : [];
  const actionZoneW = 240;
  const actionZoneH = 260;
  const actionZoneXMin = -2.5;
  const actionZoneXMax = 2.5;
  const actionZoneYMin = 0;
  const actionZoneYMax = 4.5;
  const actionZonePad = 10;
  const actionZoneScale = Math.min(
    (actionZoneW - actionZonePad * 2) / (actionZoneXMax - actionZoneXMin),
    (actionZoneH - actionZonePad * 2) / (actionZoneYMax - actionZoneYMin)
  );
  const actionZoneDrawnW = (actionZoneXMax - actionZoneXMin) * actionZoneScale;
  const actionZoneDrawnH = (actionZoneYMax - actionZoneYMin) * actionZoneScale;
  const actionZoneLeftPad = (actionZoneW - actionZoneDrawnW) / 2;
  const actionZoneTopPad = (actionZoneH - actionZoneDrawnH) / 2;
  const actionZonePx = (x: number) => actionZoneLeftPad + (x - actionZoneXMin) * actionZoneScale;
  const actionZonePy = (y: number) => actionZoneTopPad + (actionZoneYMax - y) * actionZoneScale;
  const actionStrikeBottom = 1.5;
  const actionStrikeTop = 3.6;
  const actionStrikeLeft = -0.88;
  const actionStrikeRight = 0.88;
  const actionStrikeCenterX = (actionStrikeLeft + actionStrikeRight) / 2;
  const actionStrikeCenterY = (actionStrikeBottom + actionStrikeTop) / 2;
  const actionCompRadiusFt = 1.5;
  const actionCompBottom = actionStrikeCenterY - actionCompRadiusFt;
  const actionCompTop = actionStrikeCenterY + actionCompRadiusFt;
  const actionCompLeft = actionStrikeCenterX - actionCompRadiusFt;
  const actionCompRight = actionStrikeCenterX + actionCompRadiusFt;
  const actionPlateX =
    typeof currentActionPitch?.plate_side === 'number' && Number.isFinite(currentActionPitch.plate_side)
      ? actionZonePx(orientX(currentActionPitch.plate_side, currentActionPitch.school_code))
      : null;
  const actionPlateY =
    typeof currentActionPitch?.plate_height === 'number' && Number.isFinite(currentActionPitch.plate_height)
      ? actionZonePy(currentActionPitch.plate_height)
      : null;

  const pitchKeyFor = (pitch: PitchActionPoint): string => {
    return pitchIdentityKey(pitch);
  };
  const currentPitchKey = currentActionPitch ? pitchKeyFor(currentActionPitch) : '';
  const actionPitchVideoByKey = useMemo(() => {
    const next = new Map<string, PitchActionPoint>();
    actionPitches.forEach((pitch) => {
      const key = pitchIdentityKey(pitch);
      const hasVideo = Boolean(pitch.video_clip_1 || pitch.video_clip_2 || pitch.video_clip_3);
      if (key && hasVideo) next.set(key, pitch);
    });
    return next;
  }, [actionPitches]);
  const mergeActionCompareVideoOverride = (pitch: PitchActionPoint | null): PitchActionPoint | null => {
    if (!pitch) return null;
    const key = pitchIdentityKey(pitch);
    const override = actionCompareVideoOverrides[key];
    const refreshed = actionPitchVideoByKey.get(key);
    if (refreshed) {
      return {
        ...pitch,
        video_clip_1: refreshed.video_clip_1 ?? pitch.video_clip_1,
        video_clip_2: refreshed.video_clip_2 ?? pitch.video_clip_2,
        video_clip_3: refreshed.video_clip_3 ?? pitch.video_clip_3,
      };
    }
    if (!override) return pitch;
    return {
      ...pitch,
      video_clip_1: override.video_clip_1 ?? pitch.video_clip_1,
      video_clip_2: override.video_clip_2 ?? pitch.video_clip_2,
      video_clip_3: override.video_clip_3 ?? pitch.video_clip_3,
    };
  };
  const comparePitchPool = useMemo<PitchActionPoint[]>(
    () => (actionPitches.length ? actionPitches : ((overview?.chart_points as PitchActionPoint[] | undefined) ?? [])),
    [actionPitches, overview?.chart_points]
  );
  const comparePitchOptions = useMemo(
    () =>
      comparePitchPool.map((pitch, idx) => {
        const pitcherName = resolvePitcherName(pitch, selectedPitchers);
        const batterName =
          (pitch.batter && pitch.batter.trim()) ||
          ((pitch as unknown as Record<string, unknown>).Batter as string | undefined) ||
          '';
        return {
          value: `${idx}:${pitchKeyFor(pitch)}`,
          label: `${formatNameFirstLast(pitcherName)}${batterName ? ` vs ${formatNameFirstLast(batterName)}` : ''} | ${formatShortDate(
            pitch.session_date ?? ''
          )} | ${pitch.pitch_type} | ${fmtNum(pitch.velo, 1)} mph | IVB ${fmtNum(pitch.ivb, 1)} | HB ${fmtNum(pitch.hb, 1)}`,
        };
      }),
    [comparePitchPool, selectedPitchers]
  );
  const selectedLeftPitch = useMemo(
    () => {
      const idx = Number((actionLeftPitchKey || '').split(':')[0]);
      if (Number.isInteger(idx) && idx >= 0 && idx < comparePitchPool.length) return mergeActionCompareVideoOverride(comparePitchPool[idx]);
      return mergeActionCompareVideoOverride(currentActionPitch ?? null);
    },
    [comparePitchPool, actionLeftPitchKey, currentActionPitch, actionCompareVideoOverrides, actionPitchVideoByKey]
  );
  const selectedRightPitch = useMemo(
    () => {
      const idx = Number((actionRightPitchKey || '').split(':')[0]);
      if (Number.isInteger(idx) && idx >= 0 && idx < comparePitchPool.length) return mergeActionCompareVideoOverride(comparePitchPool[idx]);
      return null;
    },
    [comparePitchPool, actionRightPitchKey, actionCompareVideoOverrides, actionPitchVideoByKey]
  );
  const selectedLeftUrls = selectedLeftPitch
    ? [selectedLeftPitch.video_clip_1, selectedLeftPitch.video_clip_2, selectedLeftPitch.video_clip_3].filter(
        (url) => !!url && url.trim().length > 0
      )
    : [];
  const selectedRightUrls = selectedRightPitch
    ? [selectedRightPitch.video_clip_1, selectedRightPitch.video_clip_2, selectedRightPitch.video_clip_3].filter(
        (url) => !!url && url.trim().length > 0
      )
    : [];

  useEffect(() => {
    setActionCameraIndex(0);
    setActionCameraIndexLeft(0);
    setActionCameraIndexRight(0);
  }, [currentPitchKey, actionLeftPitchKey, actionRightPitchKey, actionSideBySide]);

  // Multi-camera selection deliberately does NOT reset on every pitch change
  // (unlike actionCameraIndex above) -- picking Edger + Camera 2 should stay
  // selected as you click Next/Prev through pitches, not snap back to just
  // Edger every time. Only clamp when the new pitch genuinely has fewer
  // camera slots than the current selection references (would otherwise
  // read out of range), and always leave at least camera 0 selected.
  useEffect(() => {
    setActionMultiCameraIndices((current) => {
      const clamped = current.filter((camIdx) => camIdx < actionVideoUrls.length);
      return clamped.length ? clamped : [0];
    });
    setActionMultiCameraDims([]);
  }, [currentPitchKey, actionVideoUrls.length]);

  useEffect(() => {
    setActionExportMenuOpen(false);
    setActionExportState('idle');
    setActionExportMessage('');
    // Deliberately keyed only on actionMode, not actionPitches -- actionPitches
    // gets a new array identity on nearly every render (video-url refreshes,
    // edits, etc.), which was closing this menu the instant it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionMode]);

  useEffect(() => {
    setActionVideoZoom(1);
    setActionVideoPan({ x: 0, y: 0 });
  }, [currentPitchKey, actionCameraIndex, actionCameraIndexLeft, actionCameraIndexRight, actionSideBySide]);

  const handleActionVideoPanStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (breakdownMode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    actionVideoPanDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: actionVideoPan.x,
      originY: actionVideoPan.y,
    };
  };
  const handleActionVideoPanMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = actionVideoPanDragRef.current;
    if (!drag) return;
    setActionVideoPan({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  };
  const handleActionVideoPanEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (actionVideoPanDragRef.current) event.currentTarget.releasePointerCapture(event.pointerId);
    actionVideoPanDragRef.current = null;
  };

  // Clamped so a shorter clip array (e.g. the compare-mode right pitch has
  // fewer camera angles than the left one) never indexes out of range.
  const pickCamera = (urls: string[], camIdx: number = actionCameraIndex): string =>
    urls.length ? urls[Math.min(camIdx, urls.length - 1)] : '';
  // The selected cameras' URLs, in a stable order (matches
  // actionMultiCameraIndices' sorted order, i.e. Camera 1/2/3 left-to-right
  // -- not the export's Edger-first/Back/Side ordering, since that requires
  // per-pitch camera_target data this component doesn't have loaded; good
  // enough for viewing, since the user is the one actively choosing which
  // cameras to look at here). Clamped against actionVideoUrls so a stale
  // index from a differently-shaped pitch never reads out of range.
  const actionMultiCameraUrls = actionMultiCameraIndices
    .map((camIdx) => actionVideoUrls[camIdx])
    .filter((url): url is string => !!url && url.trim().length > 0);
  const actionMultiCameraUrlsKey = actionMultiCameraUrls.join(',');

  // A stale dimension from the PREVIOUS tile arrangement must never apply to
  // the new one -- e.g. toggling Camera 3 off shifts what was tile index 2
  // down to index 1, and that slot's old (different clip's) aspect ratio
  // would otherwise briefly mis-weight the split until the new clip's own
  // loadedmetadata fires.
  useEffect(() => {
    setActionMultiCameraDims([]);
  }, [actionMultiCameraUrlsKey]);

  const activeCameraCount = Math.max(
    actionSideBySide ? selectedLeftUrls.length : actionVideoUrls.length,
    actionSideBySide ? selectedRightUrls.length : 0
  );
  const leftCameraCount = selectedLeftUrls.length;
  const rightCameraCount = selectedRightUrls.length;
  // "Camera 1" isn't a stable device -- it's Edgertronic footage the large
  // majority of the time but occasionally a phone, per-pitch. Only relabel
  // the tab to "Edger" when this specific pitch's clip in that slot is
  // actually confirmed Edgertronic; otherwise keep the generic "Camera N".
  const cameraTabLabel = (camIdx: number, referencePitch: PitchActionPoint | null = actionSideBySide ? selectedLeftPitch : currentActionPitch): string => {
    const id = Number(referencePitch?.pitch_event_id);
    const flags = Number.isFinite(id) && id > 0 ? actionVideoEdgerFlagsRef.current.get(Math.trunc(id)) : undefined;
    return flags?.[camIdx] ? 'Edger' : `Camera ${camIdx + 1}`;
  };

  // Export options are meaning-based, not slot-based: "Edger" always means
  // "whichever camera slot is actually Edgertronic for this pitch" (resolved
  // per pitch server-side, since that slot isn't fixed -- almost always 1,
  // but not guaranteed), plus one generic option per *non*-Edger slot that's
  // actually in use across the scoped pitches. A slot pitch A has as Edger
  // and pitch B has as non-Edger contributes to both groups; exporting
  // "Edger" then correctly pulls pitch A's clip from that slot and skips
  // pitch B (per pitch, not per fixed slot), matching what "Edger" should
  // mean when the same slot number isn't a stable device across pitches.
  const actionExportScopedPitches = actionExportScope === 'all' ? actionPitches : currentActionPitch ? [currentActionPitch] : [];
  const edgerFlagsFor = (pitch: PitchActionPoint): [boolean, boolean, boolean] => {
    const id = Number(pitch.pitch_event_id);
    return (Number.isFinite(id) && id > 0 && actionVideoEdgerFlagsRef.current.get(Math.trunc(id))) || [false, false, false];
  };
  const hasAnyEdgerClip = actionExportScopedPitches.some((pitch) => edgerFlagsFor(pitch).some(Boolean));
  const nonEdgerCameraSlots = (['1', '2', '3'] as const).filter((cam) => {
    const camIdx = Number(cam) - 1;
    const key = cam === '1' ? 'video_clip_1' : cam === '2' ? 'video_clip_2' : 'video_clip_3';
    return actionExportScopedPitches.some((pitch) => Boolean(String(pitch[key] ?? '').trim()) && !edgerFlagsFor(pitch)[camIdx]);
  });
  const actionExportAvailableCameras: Array<'edger' | '1' | '2' | '3'> = [
    ...(hasAnyEdgerClip ? (['edger'] as const) : []),
    ...nonEdgerCameraSlots,
  ];
  const actionExportAvailableCamerasKey = actionExportAvailableCameras.join(',');

  // Default the camera multi-select to "everything available" whenever the
  // available set changes (e.g. This Pitch vs All scope toggled) -- keyed on
  // a joined string, not the array itself, since actionExportAvailableCameras
  // is a new array identity on nearly every render.
  useEffect(() => {
    setActionExportCameras([...actionExportAvailableCameras]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionExportAvailableCamerasKey]);

  const actionExportCameraLabel = (cam: 'edger' | '1' | '2' | '3'): string => (cam === 'edger' ? 'Edger' : `Cam ${cam}`);

  useEffect(() => {
    if (!actionSideBySide) return;
    if (!comparePitchOptions.length) return;
    if (!actionLeftPitchKey || !comparePitchOptions.some((option) => option.value === actionLeftPitchKey)) {
      const match = comparePitchPool.findIndex((pitch) => pitchKeyFor(pitch) === currentPitchKey);
      setActionLeftPitchKey(comparePitchOptions[Math.max(0, match)]?.value ?? comparePitchOptions[0].value);
    }
    if (!actionRightPitchKey || !comparePitchOptions.some((option) => option.value === actionRightPitchKey) || actionRightPitchKey === actionLeftPitchKey) {
      const fallback = comparePitchOptions.find((option) => option.value !== actionLeftPitchKey);
      setActionRightPitchKey((fallback ?? comparePitchOptions[0]).value);
    }
  }, [actionSideBySide, comparePitchOptions, actionLeftPitchKey, actionRightPitchKey, currentPitchKey, comparePitchPool]);

  useEffect(() => {
    if (!actionSideBySide) return;
    if (!actionLeftPitchKey || !actionRightPitchKey) return;
    const selected = [selectedLeftPitch, selectedRightPitch].filter(Boolean) as PitchActionPoint[];
    const missingVideo = selected.filter((pitch) => {
      const key = pitchIdentityKey(pitch);
      if (!key || actionCompareVideoLookupKeysRef.current.has(key)) return false;
      const hasVideo = Boolean(pitch.video_clip_1 || pitch.video_clip_2 || pitch.video_clip_3);
      return !hasVideo;
    });
    if (!missingVideo.length) return;
    missingVideo.forEach((pitch) => actionCompareVideoLookupKeysRef.current.add(pitchIdentityKey(pitch)));
    let cancelled = false;
    void (async () => {
      const refreshed = await refreshActionPitchVideoUrls(missingVideo);
      if (cancelled) return;
      setActionCompareVideoOverrides((current) => {
        const next = { ...current };
        refreshed.forEach((pitch, index) => {
          const key = pitchIdentityKey(missingVideo[index] ?? pitch);
          if (!key) return;
          next[key] = {
            video_clip_1: pitch.video_clip_1 ?? null,
            video_clip_2: pitch.video_clip_2 ?? null,
            video_clip_3: pitch.video_clip_3 ?? null,
          };
        });
        return next;
      });
      setActionVideoRefreshNonce((value) => value + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [actionSideBySide, selectedLeftPitch, selectedRightPitch]);

  const isMultiCameraActive = actionMultiCameraMode && actionMultiCameraUrls.length > 1;

  const updateSyncedDuration = () => {
    const left = leftCompareVideoRef.current;
    const right = rightCompareVideoRef.current;
    const single = singleActionVideoRef.current;
    const leftDur = left?.duration && Number.isFinite(left.duration) ? left.duration : 0;
    const rightDur = right?.duration && Number.isFinite(right.duration) ? right.duration : 0;
    const singleDur = single?.duration && Number.isFinite(single.duration) ? single.duration : 0;
    const multiDurs = multiCameraVideoRefs.current
      .map((video) => (video?.duration && Number.isFinite(video.duration) ? video.duration : 0))
      .filter((d) => d > 0);
    const next = actionSideBySide
      ? leftDur && rightDur
        ? Math.min(leftDur, rightDur)
        : leftDur || rightDur || 0
      : isMultiCameraActive
        ? multiDurs.length
          ? Math.min(...multiDurs)
          : 0
        : singleDur;
    setActionVideoDuration(next);
  };

  const syncSeekVideos = (seconds: number) => {
    const bounded = Math.max(0, Math.min(actionVideoDuration || seconds, seconds));
    const single = singleActionVideoRef.current;
    const left = leftCompareVideoRef.current;
    const right = rightCompareVideoRef.current;
    if (actionSideBySide) {
      if (left) left.currentTime = bounded;
      if (right) right.currentTime = bounded;
    } else if (isMultiCameraActive) {
      multiCameraVideoRefs.current.forEach((video) => {
        if (video) video.currentTime = bounded;
      });
    } else if (single) {
      single.currentTime = bounded;
    }
    setActionVideoTime(bounded);
  };

  const syncPlayPauseVideos = async () => {
    const single = singleActionVideoRef.current;
    const left = leftCompareVideoRef.current;
    const right = rightCompareVideoRef.current;
    const videos = actionSideBySide
      ? [left, right].filter(Boolean)
      : isMultiCameraActive
        ? multiCameraVideoRefs.current.filter(Boolean)
        : [single].filter(Boolean);
    if (!videos.length) return;
    if (actionVideoPlaying) {
      videos.forEach((video) => video?.pause());
      setActionVideoPlaying(false);
      return;
    }
    try {
      videos.forEach((video) => {
        if (video) video.playbackRate = actionPlaybackRate;
      });
      await Promise.all(videos.map((video) => video?.play()));
      setActionVideoPlaying(true);
    } catch {
      setActionVideoPlaying(false);
    }
  };

  const stepActionVideo = (seconds: number) => {
    const base = actionSideBySide
      ? (leftCompareVideoRef.current?.currentTime ?? actionVideoTime)
      : isMultiCameraActive
        ? (multiCameraVideoRefs.current[0]?.currentTime ?? actionVideoTime)
        : (singleActionVideoRef.current?.currentTime ?? actionVideoTime);
    syncSeekVideos(base + seconds);
  };

  const resetActionVideos = () => {
    [singleActionVideoRef.current, leftCompareVideoRef.current, rightCompareVideoRef.current, ...multiCameraVideoRefs.current].forEach((video) => {
      if (!video) return;
      video.pause();
      video.currentTime = 0;
      video.playbackRate = actionPlaybackRate;
    });
    setActionVideoTime(0);
    setActionVideoPlaying(false);
  };

  const toggleActionModalFullscreen = async () => {
    const target = actionModalCardRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void }) | null;
    if (!target) return;
    const fullscreenDoc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const fullscreenElement = document.fullscreenElement ?? fullscreenDoc.webkitFullscreenElement ?? null;
    try {
      if (fullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await fullscreenDoc.webkitExitFullscreen?.();
        return;
      }
      if (target.requestFullscreen) await target.requestFullscreen();
      else await target.webkitRequestFullscreen?.();
    } catch (error) {
      setBreakdownMessage(error instanceof Error ? error.message : 'Fullscreen is not available.');
    }
  };

  const setActionVideoRate = (rate: number) => {
    setActionPlaybackRate(rate);
    [singleActionVideoRef.current, leftCompareVideoRef.current, rightCompareVideoRef.current, ...multiCameraVideoRefs.current].forEach((video) => {
      if (video) video.playbackRate = rate;
    });
  };

  const toggleActionVideoLoop = () => {
    setActionVideoLoop((prev) => {
      const next = !prev;
      [singleActionVideoRef.current, leftCompareVideoRef.current, rightCompareVideoRef.current, ...multiCameraVideoRefs.current].forEach((video) => {
        if (video) video.loop = next;
      });
      return next;
    });
  };

  const handleActionVideoLoadError = async (targetPitch: PitchActionPoint | null) => {
    if (!targetPitch) return;
    const retryKey = pitchIdentityKey(targetPitch);
    if (!retryKey || actionVideoRetryKeysRef.current.has(retryKey)) return;
    actionVideoRetryKeysRef.current.add(retryKey);
    const refreshed = await refreshActionPitchVideoUrls([targetPitch]);
    const first = refreshed[0];
    if (!first) return;
    setActionPitches((rows) =>
      rows.map((row) => (pitchIdentityKey(row) === retryKey ? { ...row, video_clip_1: first.video_clip_1, video_clip_2: first.video_clip_2, video_clip_3: first.video_clip_3 } : row))
    );
    setActionVideoRefreshNonce((value) => value + 1);
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      const primary = actionSideBySide
        ? leftCompareVideoRef.current
        : isMultiCameraActive
          ? multiCameraVideoRefs.current[0]
          : singleActionVideoRef.current;
      if (!primary) return;
      setActionVideoTime(primary.currentTime || 0);
      if (!actionVideoLoop && actionVideoDuration > 0 && primary.currentTime >= actionVideoDuration) {
        primary.pause();
        if (actionSideBySide) rightCompareVideoRef.current?.pause();
        if (isMultiCameraActive) multiCameraVideoRefs.current.forEach((video) => video?.pause());
        setActionVideoPlaying(false);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [actionSideBySide, actionVideoDuration, isMultiCameraActive]);

  useEffect(() => {
    if (!actionSideBySide) return;
    setActionVideoTime(0);
    setActionVideoPlaying(false);
  }, [actionSideBySide, actionLeftPitchKey, actionRightPitchKey]);

  const downloadUrl = (url: string, fileName: string) => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    downloadUrl(url, fileName);
    URL.revokeObjectURL(url);
  };

  const runActionVideoExport = async () => {
    const scopedPitches = actionExportScope === 'all' ? actionPitches : currentActionPitch ? [currentActionPitch] : [];
    const pitchEventIds = Array.from(
      new Set(
        scopedPitches
          .map((pitch) => Number(pitch.pitch_event_id ?? -1))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    );
    if (!pitchEventIds.length) {
      setActionExportState('error');
      setActionExportMessage('No pitch video found to export.');
      return;
    }

    const camerasToSend = actionExportCameras.filter((cam) => actionExportAvailableCameras.includes(cam));
    if (!camerasToSend.length) {
      setActionExportState('error');
      setActionExportMessage('Pick at least one camera to export.');
      return;
    }
    if (actionExportMode === 'combined' && camerasToSend.length < 2) {
      setActionExportState('error');
      setActionExportMessage('Combined export needs at least 2 cameras selected.');
      return;
    }

    setActionExportState('exporting');
    setActionExportMessage('');
    setActionExportElapsedSeconds(0);
    const startedAt = Date.now();
    const tickTimer = window.setInterval(() => {
      setActionExportElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    try {
      const response = await fetch('/api/dashboard/pitching/video-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pitchEventIds,
          camera: camerasToSend,
          mode: actionExportMode,
          showMetrics: actionExportShowMetrics,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || 'Failed to export video.');
      }
      // Read the response as it streams in rather than a single blocking
      // response.blob() -- the server sends real progress the whole time
      // (a 15s no-op heartbeat until ffmpeg finishes, then the actual file in
      // 64KB chunks), so this is the only way the UI can reflect "still
      // alive" instead of looking frozen for however long the export takes.
      const reader = response.body?.getReader();
      if (!reader) {
        const blob = await response.blob();
        downloadBlob(blob, `pitch-export-${pitchEventIds.length}-clip${pitchEventIds.length === 1 ? '' : 's'}.mp4`);
      } else {
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        const blob = new Blob(chunks as BlobPart[], { type: 'video/mp4' });
        downloadBlob(blob, `pitch-export-${pitchEventIds.length}-clip${pitchEventIds.length === 1 ? '' : 's'}.mp4`);
      }
      setActionExportState('idle');
      setActionExportMenuOpen(false);
    } catch (error) {
      setActionExportState('error');
      setActionExportMessage(error instanceof Error ? error.message : 'Failed to export video.');
    } finally {
      window.clearInterval(tickTimer);
    }
  };

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
      reader.readAsDataURL(blob);
    });

  const getBreakdownPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    };
  };

  const moveBreakdownAnnotationPoints = (drag: BreakdownAnnotationDragState, point: { x: number; y: number }) => {
    const rawDx = point.x - drag.anchor.x;
    const rawDy = point.y - drag.anchor.y;
    const minX = Math.min(...drag.points.map((p) => p.x));
    const maxX = Math.max(...drag.points.map((p) => p.x));
    const minY = Math.min(...drag.points.map((p) => p.y));
    const maxY = Math.max(...drag.points.map((p) => p.y));
    const dx = Math.max(-minX, Math.min(1 - maxX, rawDx));
    const dy = Math.max(-minY, Math.min(1 - maxY, rawDy));
    return drag.points.map((p) => ({
      x: Math.max(0, Math.min(1, p.x + dx)),
      y: Math.max(0, Math.min(1, p.y + dy)),
    }));
  };

  const annotationDistance = (annotation: BreakdownAnnotation, point: { x: number; y: number }): number => {
    if (!annotation.points.length) return 999;
    if (annotation.tool === 'text') {
      const anchor = annotation.points[0];
      return Math.hypot(anchor.x - point.x, anchor.y - point.y);
    }
    if (annotation.tool === 'circle' && annotation.points.length >= 2) {
      const [a, b] = annotation.points;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      const edge = Math.abs(Math.hypot((point.x - cx) / Math.max(rx, 0.001), (point.y - cy) / Math.max(ry, 0.001)) - 1);
      return edge * 0.08;
    }
    return Math.min(...annotation.points.map((p) => Math.hypot(p.x - point.x, p.y - point.y)));
  };

  const measureBreakdownAngle = (points: Array<{ x: number; y: number }>, mode: 'acute' | 'obtuse' = 'acute'): number | null => {
    if (points.length < 3) return null;
    const [a, b, c] = points;
    const ab = { x: a.x - b.x, y: a.y - b.y };
    const cb = { x: c.x - b.x, y: c.y - b.y };
    const dot = ab.x * cb.x + ab.y * cb.y;
    const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
    if (mag <= 0) return null;
    const deg = (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
    const acute = deg > 90 ? 180 - deg : deg;
    return mode === 'obtuse' ? 180 - acute : acute;
  };

  const handleBreakdownPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!breakdownMode) return;
    event.preventDefault();
    const point = getBreakdownPoint(event);
    if (breakdownTool !== 'erase') {
      const nearestAnnotation = breakdownAnnotations
        .filter((item) => item.points.length > 0)
        .map((item) => ({ item, distance: annotationDistance(item, point) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearestAnnotation && nearestAnnotation.distance <= 0.08) {
        if (nearestAnnotation.item.tool === 'text') {
          setSelectedBreakdownTextId(nearestAnnotation.item.id);
          setBreakdownTextFontSize(Math.max(16, Math.min(96, Number(nearestAnnotation.item.fontSize ?? 36))));
        }
        setDraggingBreakdownAnnotation({ id: nearestAnnotation.item.id, anchor: point, points: nearestAnnotation.item.points });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (breakdownTool === 'erase') {
      setBreakdownAnnotations((items) => {
        if (!items.length) return items;
        const nearest = items
          .map((item) => ({ item, distance: annotationDistance(item, point) }))
          .sort((a, b) => a.distance - b.distance)[0];
        if (!nearest || nearest.distance > 0.08) return items;
        return items.filter((item) => item.id !== nearest.item.id);
      });
      return;
    }
    if (breakdownTool === 'text') {
      const text = window.prompt('Text label');
      if (!text?.trim()) return;
      const id = `bd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setBreakdownAnnotations((items) => [
        ...items,
        {
          id,
          tool: 'text',
          color: breakdownColor,
          width: breakdownWidth,
          points: [point],
          text: text.trim(),
          fontSize: breakdownTextFontSize,
        },
      ]);
      setSelectedBreakdownTextId(id);
      return;
    }
    if (breakdownTool === 'angle') {
      const next = [...breakdownAnglePending, point];
      if (next.length === 3) {
        setBreakdownAnnotations((items) => [...items, {
          id: `bd-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          tool: 'angle',
          color: breakdownColor,
          width: breakdownWidth,
          points: next,
          angleMode: breakdownAngleMode,
        }]);
        setBreakdownAnglePending([]);
      } else {
        setBreakdownAnglePending(next);
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const annotation: BreakdownAnnotation = {
      id: `bd-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      tool: breakdownTool,
      color: breakdownColor,
      width: breakdownWidth,
      points: [point, point],
    };
    setActiveBreakdownAnnotation(annotation);
  };

  const handleBreakdownPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (draggingBreakdownAnnotation) {
      event.preventDefault();
      const point = getBreakdownPoint(event);
      const nextPoints = moveBreakdownAnnotationPoints(draggingBreakdownAnnotation, point);
      setBreakdownAnnotations((items) =>
        items.map((item) => (item.id === draggingBreakdownAnnotation.id ? { ...item, points: nextPoints } : item))
      );
      return;
    }
    if (!activeBreakdownAnnotation) return;
    event.preventDefault();
    const point = getBreakdownPoint(event);
    setActiveBreakdownAnnotation((current) => {
      if (!current) return current;
      if (current.tool === 'pen') return { ...current, points: [...current.points, point] };
      if (current.tool === 'angle') return current;
      return { ...current, points: [current.points[0], point] };
    });
  };

  const finishBreakdownAnnotation = (event?: ReactPointerEvent<SVGSVGElement>) => {
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (draggingBreakdownAnnotation) {
      setDraggingBreakdownAnnotation(null);
      return;
    }
    if (!activeBreakdownAnnotation) return;
    if (activeBreakdownAnnotation.tool === 'angle') return;
    setBreakdownAnnotations((items) => [...items, activeBreakdownAnnotation]);
    setActiveBreakdownAnnotation(null);
  };

  const drawAnnotationOnCanvas = (
    ctx: CanvasRenderingContext2D,
    annotation: BreakdownAnnotation,
    width: number,
    height: number
  ) => {
    const points = annotation.points;
    if (!points.length) return;
    ctx.save();
    ctx.strokeStyle = annotation.color;
    ctx.fillStyle = annotation.color;
    ctx.lineWidth = annotation.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (annotation.tool === 'text') {
      ctx.font = `700 ${Math.max(16, Number(annotation.fontSize ?? 36))}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(annotation.text ?? '', points[0].x * width, points[0].y * height);
    } else if (annotation.tool === 'circle' && points.length >= 2) {
      const x = Math.min(points[0].x, points[1].x) * width;
      const y = Math.min(points[0].y, points[1].y) * height;
      const w = Math.abs(points[1].x - points[0].x) * width;
      const h = Math.abs(points[1].y - points[0].y) * height;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (annotation.tool === 'angle' && points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(points[0].x * width, points[0].y * height);
      ctx.lineTo(points[1].x * width, points[1].y * height);
      ctx.lineTo(points[2].x * width, points[2].y * height);
      ctx.stroke();
      for (const point of points) {
        ctx.beginPath();
        ctx.arc(point.x * width, point.y * height, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.78)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = annotation.color;
        ctx.lineWidth = annotation.width;
      }
      const angle = measureBreakdownAngle(points, annotation.angleMode ?? 'acute');
      if (angle !== null) {
        ctx.font = '800 30px system-ui, -apple-system, sans-serif';
        ctx.fillText(`${angle.toFixed(1)}°`, points[1].x * width + 16, points[1].y * height - 16);
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x * width, points[0].y * height);
      for (const point of points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
      ctx.stroke();
      if (annotation.tool === 'arrow' && points.length >= 2) {
        const a = points[points.length - 2];
        const b = points[points.length - 1];
        const angle = Math.atan2((b.y - a.y) * height, (b.x - a.x) * width);
        const size = Math.max(14, annotation.width * 4);
        const x = b.x * width;
        const y = b.y * height;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  };

  const saveBreakdownNote = async (attachment: { name: string; mimeType: string; dataUrl: string }, defaultText: string) => {
    if (!currentActionPitch) return;
    setBreakdownSaving(true);
    setBreakdownMessage('');
    try {
      if (attachment.dataUrl.length > 60_000_000) {
        setBreakdownMessage('Breakdown file is too large for Player Notes. Use Download instead.');
        return;
      }
      const pitcherName = formatNameFirstLast(resolvePitcherName(currentActionPitch, selectedPitchers));
      const response = await fetch('/api/player/plan-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dashboardPlayerName: pitcherName,
          domain: 'General',
          noteDate: (currentActionPitch.session_date ?? '').slice(0, 10) || toYmdNow(),
          category: 'Edger',
          noteText: [
            breakdownNoteText.trim() || defaultText,
            '',
            `Pitch: ${currentActionPitch.pitch_type || '-'} | ${fmtNum(currentActionPitch.velo, 1)} mph | ${formatShortDate(currentActionPitch.session_date ?? '')}`,
            actionSideBySide && selectedRightPitch
              ? `Compare: ${selectedRightPitch.pitch_type || '-'} | ${fmtNum(selectedRightPitch.velo, 1)} mph | ${formatShortDate(selectedRightPitch.session_date ?? '')}`
              : '',
          ].filter(Boolean).join('\n'),
          attachmentName: attachment.name,
          attachmentMimeType: attachment.mimeType,
          attachmentDataUrl: attachment.dataUrl,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save breakdown note.');
      setBreakdownMessage('Saved to Player Notes.');
    } catch (error) {
      setBreakdownMessage(error instanceof Error ? error.message : 'Failed to save breakdown.');
    } finally {
      setBreakdownSaving(false);
    }
  };

  const captureBreakdownSnapshot = async (): Promise<string> => {
    // For single view, capture the full actionViewRef (video + side metrics + strike zone).
    // For side-by-side, capture breakdownCaptureRef (compact metrics are already inside it).
    const container = actionSideBySide ? breakdownCaptureRef.current : actionViewRef.current;
    if (!container) throw new Error('Breakdown view is not ready.');
    const { default: html2canvas } = await import('html2canvas');
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const snapshotCanvas = await html2canvas(container, {
      scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#000000',
      logging: false,
      ignoreElements: (element) => element instanceof HTMLElement && element.dataset.breakdownUi === 'true',
    });
    return snapshotCanvas.toDataURL('image/png');
  };

  const captureBreakdownSnapshotWithScreenShare = async (): Promise<string> => {
    const container = breakdownCaptureRef.current;
    if (!container) throw new Error('Breakdown view is not ready.');
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Snapshot capture is blocked by the browser for this video source.');
    }
    const breakdownUiElements = Array.from(document.querySelectorAll<HTMLElement>('[data-breakdown-ui="true"]'));
    const previousVisibility = breakdownUiElements.map((element) => element.style.visibility);
    breakdownUiElements.forEach((element) => {
      element.style.visibility = 'hidden';
    });
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    try {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      const rect = container.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      const videoWidth = video.videoWidth || Math.round(window.innerWidth * (window.devicePixelRatio || 1));
      const videoHeight = video.videoHeight || Math.round(window.innerHeight * (window.devicePixelRatio || 1));
      const scaleX = videoWidth / Math.max(1, window.innerWidth);
      const scaleY = videoHeight / Math.max(1, window.innerHeight);
      canvas.width = Math.max(1, Math.round(rect.width * scaleX));
      canvas.height = Math.max(1, Math.round(rect.height * scaleY));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Snapshot canvas is not available.');
      ctx.drawImage(
        video,
        Math.max(0, rect.left * scaleX),
        Math.max(0, rect.top * scaleY),
        Math.max(1, rect.width * scaleX),
        Math.max(1, rect.height * scaleY),
        0,
        0,
        canvas.width,
        canvas.height
      );
      return canvas.toDataURL('image/png');
    } finally {
      stream.getTracks().forEach((track) => track.stop());
      breakdownUiElements.forEach((element, index) => {
        element.style.visibility = previousVisibility[index] ?? '';
      });
    }
  };

  const captureBreakdownSnapshotSafe = async (): Promise<string> => {
    try {
      return await captureBreakdownSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      const insecure = /insecure|tainted|security/i.test(message) || error instanceof DOMException;
      if (!insecure) throw error;
      setBreakdownMessage('Video source blocks direct snapshot export. Choose this tab/window to capture the breakdown.');
      return captureBreakdownSnapshotWithScreenShare();
    }
  };

  const saveBreakdownSnapshot = async () => {
    try {
      const dataUrl = await captureBreakdownSnapshotSafe();
      await saveBreakdownNote(
        { name: `video-breakdown-${Date.now()}.png`, mimeType: 'image/png', dataUrl },
        'Video breakdown snapshot'
      );
    } catch (error) {
      setBreakdownMessage(error instanceof Error ? error.message : 'Failed to capture snapshot.');
    }
  };

  const downloadBreakdownSnapshot = async () => {
    try {
      const dataUrl = await captureBreakdownSnapshotSafe();
      downloadUrl(dataUrl, `video-breakdown-${Date.now()}.png`);
    } catch (error) {
      setBreakdownMessage(error instanceof Error ? error.message : 'Failed to capture snapshot.');
    }
  };

  const startBreakdownRecording = async () => {
    setBreakdownMessage('');
    setRecordingBlob(null);
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl('');
    try {
      const container = actionViewRef.current;
      if (!container || typeof MediaRecorder === 'undefined') {
        setBreakdownMessage('Recording is not supported in this browser.');
        return;
      }
      const videos = actionSideBySide
        ? [leftCompareVideoRef.current, rightCompareVideoRef.current].filter((video): video is HTMLVideoElement => Boolean(video))
        : [singleActionVideoRef.current].filter((video): video is HTMLVideoElement => Boolean(video));
      if (!videos.length) {
        setBreakdownMessage('Video is not ready to record.');
        return;
      }
      if (recordingAnimationRef.current !== null) {
        cancelAnimationFrame(recordingAnimationRef.current);
        recordingAnimationRef.current = null;
      }
      const rect = container.getBoundingClientRect();
      const scale = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, Math.round(rect.width * scale));
      canvas.height = Math.max(2, Math.round(rect.height * scale));
      const canvasScaleX = canvas.width / Math.max(1, rect.width);
      const canvasScaleY = canvas.height / Math.max(1, rect.height);
      const ctx = canvas.getContext('2d');
      const captureStream = canvas.captureStream?.(30);
      if (!ctx || !captureStream) {
        setBreakdownMessage('Canvas recording is not supported in this browser.');
        return;
      }
      const { default: html2canvas } = await import('html2canvas');
      let staticCanvas: HTMLCanvasElement | null = null;
      try {
        staticCanvas = await html2canvas(container, {
          scale,
          useCORS: true,
          allowTaint: false,
          backgroundColor: '#000000',
          logging: false,
          ignoreElements: (element) =>
            element instanceof HTMLElement
              ? element.dataset.breakdownUi === 'true' || element.dataset.breakdownRecordingIgnore === 'true'
              : element.getAttribute?.('data-breakdown-recording-ignore') === 'true',
        });
      } catch {
        staticCanvas = null;
      }
      const audioTracks = videos.flatMap((video) => {
        const capturedVideo = video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
        return capturedVideo.captureStream?.().getAudioTracks() ?? capturedVideo.mozCaptureStream?.().getAudioTracks() ?? [];
      });
      const stream = new MediaStream([...captureStream.getVideoTracks(), ...audioTracks]);
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      const recordingFormat = BREAKDOWN_RECORDING_MIME_OPTIONS.find((option) => MediaRecorder.isTypeSupported(option.mimeType)) ?? BREAKDOWN_RECORDING_MIME_OPTIONS[BREAKDOWN_RECORDING_MIME_OPTIONS.length - 1]!;
      const recorder = new MediaRecorder(stream, { mimeType: recordingFormat.mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (recordingAnimationRef.current !== null) {
          cancelAnimationFrame(recordingAnimationRef.current);
          recordingAnimationRef.current = null;
        }
        const blob = new Blob(recordingChunksRef.current, { type: recordingFormat.mimeType });
        setRecordingBlob(blob);
        setRecordingUrl(URL.createObjectURL(blob));
        setRecordingDownloadName(`video-breakdown-${Date.now()}.${recordingFormat.extension}`);
        setRecordingState('ready');
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
      };
      const drawVideoToElementBox = (video: HTMLVideoElement) => {
        const videoRect = video.getBoundingClientRect();
        const x = (videoRect.left - rect.left) * canvasScaleX;
        const y = (videoRect.top - rect.top) * canvasScaleY;
        const width = videoRect.width * canvasScaleX;
        const height = videoRect.height * canvasScaleY;
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y, width, height);
        if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
        const videoAspect = video.videoWidth / video.videoHeight;
        const boxAspect = width / Math.max(1, height);
        let drawWidth = width;
        let drawHeight = height;
        let drawX = x;
        let drawY = y;
        if (videoAspect > boxAspect) {
          drawHeight = width / videoAspect;
          drawY = y + (height - drawHeight) / 2;
        } else {
          drawWidth = height * videoAspect;
          drawX = x + (width - drawWidth) / 2;
        }
        try {
          ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
        } catch {
          // Cross-origin video frames can block canvas export. Keep the static capture and overlays.
        }
      };
      const renderFrame = () => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (staticCanvas) {
          ctx.drawImage(staticCanvas, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        videos.forEach(drawVideoToElementBox);
        const stage = breakdownCaptureRef.current;
        if (stage) {
          const stageRect = stage.getBoundingClientRect();
          const overlay = stage.querySelector<SVGSVGElement>('[data-breakdown-recording-ignore="true"]');
          const overlayRect = overlay?.getBoundingClientRect() ?? stageRect;
          const stageX = (overlayRect.left - rect.left) * canvasScaleX;
          const stageY = (overlayRect.top - rect.top) * canvasScaleY;
          ctx.save();
          ctx.translate(stageX, stageY);
          ctx.scale(canvasScaleX, canvasScaleY);
          const current = breakdownAnnotationsRef.current;
          current.annotations.forEach((annotation) => drawAnnotationOnCanvas(ctx, annotation, overlayRect.width, overlayRect.height));
          if (current.active) drawAnnotationOnCanvas(ctx, current.active, overlayRect.width, overlayRect.height);
          if (current.pending.length > 0) {
            drawAnnotationOnCanvas(
              ctx,
              {
                id: 'angle-pending-recording',
                tool: 'angle',
                color: current.pendingColor,
                width: current.pendingWidth,
                points: current.pending,
                angleMode: current.pendingAngleMode,
              },
              overlayRect.width,
              overlayRect.height
            );
          }
          ctx.restore();
        }
        recordingAnimationRef.current = requestAnimationFrame(renderFrame);
      };
      renderFrame();
      recorder.start();
      setRecordingState('recording');
      setBreakdownMessage('Recording Edger breakdown.');
    } catch (error) {
      setBreakdownMessage(error instanceof Error ? error.message : 'Failed to start recording.');
      if (recordingAnimationRef.current !== null) {
        cancelAnimationFrame(recordingAnimationRef.current);
        recordingAnimationRef.current = null;
      }
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      setRecordingState('idle');
    }
  };

  const stopBreakdownRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
    if (recordingAnimationRef.current !== null) {
      cancelAnimationFrame(recordingAnimationRef.current);
      recordingAnimationRef.current = null;
    }
  };

  const saveBreakdownRecording = async () => {
    if (!recordingBlob) {
      setBreakdownMessage('Record a breakdown first.');
      return;
    }
    const dataUrl = await blobToDataUrl(recordingBlob);
    await saveBreakdownNote(
      { name: recordingDownloadName, mimeType: recordingBlob.type || 'video/webm', dataUrl },
      'Recorded video breakdown'
    );
  };

  useEffect(() => {
    return () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
      if (recordingAnimationRef.current !== null) cancelAnimationFrame(recordingAnimationRef.current);
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [recordingUrl]);

  const renderBreakdownAnnotation = (annotation: BreakdownAnnotation, key: string) => {
    const pts = annotation.points;
    if (!pts.length) return null;
    const overlayUnits = 1000;
    const sx = (value: number) => value * overlayUnits;
    const strokeWidth = annotation.width;
    if (annotation.tool === 'text') {
      const selected = annotation.id === selectedBreakdownTextId;
      return (
        <text
          key={key}
          x={sx(pts[0].x)}
          y={sx(pts[0].y)}
          fill={annotation.color}
          fontSize={Math.max(16, Number(annotation.fontSize ?? 36))}
          fontWeight={800}
          style={{
            paintOrder: 'stroke',
            stroke: selected ? 'rgba(250,204,21,0.95)' : 'rgba(0,0,0,0.65)',
            strokeWidth: selected ? 7 : 5,
            cursor: breakdownMode && breakdownTool === 'text' ? 'move' : undefined,
          }}
        >
          {annotation.text}
        </text>
      );
    }
    if (annotation.tool === 'circle' && pts.length >= 2) {
      const x = sx(Math.min(pts[0].x, pts[1].x));
      const y = sx(Math.min(pts[0].y, pts[1].y));
      const w = sx(Math.abs(pts[1].x - pts[0].x));
      const h = sx(Math.abs(pts[1].y - pts[0].y));
      return <ellipse key={key} cx={x + w / 2} cy={y + h / 2} rx={Math.max(2, w / 2)} ry={Math.max(2, h / 2)} fill="none" stroke={annotation.color} strokeWidth={strokeWidth} />;
    }
    if (annotation.tool === 'angle') {
      const polyPoints = pts.map((point) => `${sx(point.x)},${sx(point.y)}`).join(' ');
      const angle = measureBreakdownAngle(pts, annotation.angleMode ?? 'acute');
      const vertex = pts[1] ?? pts[0];
      const dir1 = pts.length >= 2 ? { x: pts[0].x - vertex.x, y: pts[0].y - vertex.y } : { x: 0, y: -1 };
      const dir2 = pts.length >= 3 ? { x: pts[2].x - vertex.x, y: pts[2].y - vertex.y } : { x: 0, y: -1 };
      const mag1 = Math.hypot(dir1.x, dir1.y) || 1;
      const mag2 = Math.hypot(dir2.x, dir2.y) || 1;
      const bisect = { x: dir1.x / mag1 + dir2.x / mag2, y: dir1.y / mag1 + dir2.y / mag2 };
      const bisectMag = Math.hypot(bisect.x, bisect.y) || 1;
      const labelX = sx(vertex.x) + (bisect.x / bisectMag) * 60;
      const labelY = sx(vertex.y) + (bisect.y / bisectMag) * 60;
      return (
        <g key={key}>
          <polyline points={polyPoints} fill="none" stroke={annotation.color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((point, index) => <circle key={`${key}-angle-point-${index}`} cx={sx(point.x)} cy={sx(point.y)} r={7} fill={annotation.color} stroke="rgba(0,0,0,0.78)" strokeWidth={2} />)}
          {angle !== null ? (
            <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle" fill={annotation.color} fontSize={36} fontWeight={900} style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.72)', strokeWidth: 5 }}>
              {`${angle.toFixed(1)}°`}
            </text>
          ) : null}
        </g>
      );
    }
    const points = pts.map((point) => `${sx(point.x)},${sx(point.y)}`).join(' ');
    if (annotation.tool === 'arrow' && pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const size = 34;
      const bx = sx(b.x);
      const by = sx(b.y);
      const left = `${bx - size * Math.cos(angle - Math.PI / 6)},${by - size * Math.sin(angle - Math.PI / 6)}`;
      const right = `${bx - size * Math.cos(angle + Math.PI / 6)},${by - size * Math.sin(angle + Math.PI / 6)}`;
      return (
        <g key={key}>
          <polyline points={points} fill="none" stroke={annotation.color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          <polygon points={`${bx},${by} ${left} ${right}`} fill={annotation.color} />
        </g>
      );
    }
    return <polyline key={key} points={points} fill="none" stroke={annotation.color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
  };

  const renderBreakdownOverlay = () => (
    <svg
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      data-breakdown-recording-ignore="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        cursor: breakdownMode ? (breakdownTool === 'erase' ? 'not-allowed' : 'crosshair') : 'default',
        pointerEvents: breakdownMode ? 'auto' : 'none',
        touchAction: 'none',
      }}
      onPointerDown={handleBreakdownPointerDown}
      onPointerMove={handleBreakdownPointerMove}
      onPointerUp={finishBreakdownAnnotation}
      onPointerCancel={finishBreakdownAnnotation}
      onPointerLeave={finishBreakdownAnnotation}
    >
      {breakdownAnnotations.map((annotation) => renderBreakdownAnnotation(annotation, annotation.id))}
      {activeBreakdownAnnotation ? renderBreakdownAnnotation(activeBreakdownAnnotation, 'active-breakdown') : null}
      {breakdownAnglePending.length > 0 ? renderBreakdownAnnotation({ id: 'angle-pending', tool: 'angle', color: breakdownColor, width: breakdownWidth, points: breakdownAnglePending, angleMode: breakdownAngleMode }, 'angle-pending') : null}
    </svg>
  );

  const renderCompactVideoMetrics = (pitch: PitchActionPoint | null, align: 'left' | 'right') => {
    if (!pitch) return null;
    return (
      <div
        style={{
          display: 'grid',
          gap: 4,
          alignContent: 'start',
          color: '#f8fafc',
          fontWeight: 800,
          fontSize: '0.82rem',
          lineHeight: 1.08,
          textAlign: align,
          padding: '0.42rem 0.55rem',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 8,
          background: 'rgba(0,0,0,0.52)',
          minHeight: 0,
        }}
      >
        <div>{formatNameFirstLast(resolvePitcherName(pitch, selectedPitchers))}</div>
        <div>{formatShortDate(pitch.session_date ?? '')} | {pitch.pitch_type || '-'}</div>
        <div>
          {fmtNum(pitch.velo, 1)} mph | IVB: {fmtNum(pitch.ivb, 1)} | HB: {fmtNum(pitch.hb, 1)} | {fmtNum(pitch.spin, 0)} rpm
        </div>
        <div style={{ color: 'rgba(248,250,252,0.78)', fontSize: '0.76rem' }}>
          SpinEff: {pitch.spin_eff !== null ? `${fmtNum(pitch.spin_eff > 1 ? pitch.spin_eff : pitch.spin_eff * 100, 1)}%` : '-'} | bTilt: {formatTiltClock(pitch.break_tilt)} | Height: {fmtNum(pitch.release_height, 1)} | Side: {typeof pitch.release_side === 'number' ? fmtNum(orientX(pitch.release_side, pitch.school_code), 1) : '-'}
        </div>
      </div>
    );
  };

  const renderVideoPitchMetrics = (pitch: PitchActionPoint, align: 'left' | 'right', dark = false) => (
    <div
      style={{
        display: 'grid',
        gap: '0.36rem',
        color: dark ? '#f8fafc' : '#111827',
        fontWeight: 700,
        fontSize: '0.9rem',
        textAlign: align,
        alignContent: 'start',
      }}
    >
      <div>
        {formatNameFirstLast(resolvePitcherName(pitch, selectedPitchers))}
      </div>
      <div>{formatShortDate(pitch.session_date ?? '')}</div>
      <div style={{ color: dark ? '#cbd5e1' : '#4b5563', fontWeight: 600 }}>{formatNameFirstLast(pitch.batter || '')}</div>
      <div style={{ marginTop: 6 }}>{pitch.pitch_type}</div>
      <div>{fmtNum(pitch.velo, 1)} mph</div>
      <div>IVB: {fmtNum(pitch.ivb, 1)} in</div>
      <div>HB: {fmtNum(pitch.hb, 1)} in</div>
      <div>{fmtNum(pitch.spin, 0)} rpm</div>
      <div>
        SpinEff:{' '}
        {pitch.spin_eff !== null
          ? `${fmtNum(pitch.spin_eff > 1 ? pitch.spin_eff : pitch.spin_eff * 100, 1)}%`
          : '—'}
      </div>
      <div>rTilt: {formatTiltClock(pitch.release_tilt)}</div>
      <div>bTilt: {formatTiltClock(pitch.break_tilt)}</div>
      <div>Height: {fmtNum(pitch.release_height, 1)}</div>
      <div>Side: {typeof pitch.release_side === 'number' ? fmtNum(orientX(pitch.release_side, pitch.school_code), 1) : '-'}</div>
    </div>
  );

  const rawSummaryPoints = useMemo(() => {
    const points = overview?.chart_points ?? [];
    return points.map((point) => {
      const row = point as unknown as Record<string, unknown>;
      const expected = calculateExpectedMovement({
        velocityMph: point.velo,
        spinRateRpm: point.spin,
        measuredTilt: point.release_tilt,
        extensionFeet: point.extension,
        spinEfficiency: point.spin_eff,
        activeSpinRpm:
          row.active_spin
          ?? row.activeSpin
          ?? row.activespin
          ?? row.active_spin_rpm,
      });
      if (!expected) {
        return {
          ...point,
          expected_hb: null,
          expected_ivb: null,
          expected_movement_model: null,
        };
      }
      return {
        ...point,
        active_spin: expected.activeSpinRpm,
        expected_hb: expected.expectedHb,
        expected_ivb: expected.expectedIvb,
        expected_movement_model: expected.modelVersion,
      };
    });
  }, [overview?.chart_points]);
  const pitchLevelSummaryPoints = useMemo(
    () =>
      rawSummaryPoints.filter((point) => {
        if (!point || typeof point !== 'object') return false;
        const row = point as Record<string, unknown>;
        const hasPitchIdentity =
          row.pitch_event_id !== null && row.pitch_event_id !== undefined
          || Boolean(String(point.session_date ?? '').trim())
          || row.pitch_number !== null && row.pitch_number !== undefined
          || row.pitch_no !== null && row.pitch_no !== undefined;
        const isAggregateBin = row.pitch_n !== null && row.pitch_n !== undefined && !hasPitchIdentity;
        return hasPitchIdentity && !isAggregateBin;
      }),
    [rawSummaryPoints]
  );
  const rawHeatmapPoints = useMemo(
    () => ((overview?.heatmap_points as PitchActionPoint[] | undefined) ?? []),
    [overview?.heatmap_points]
  );
  const summaryPoints = useMemo(
    () => pitchLevelSummaryPoints,
    [pitchLevelSummaryPoints]
  );
  const resolveEditablePitchesForRow = useCallback(
    (row: Record<string, string | number | null>, rowKey: string): PitchActionPoint[] => {
      const mapped = (overview?.row_pitches_by_key?.[rowKey] ?? []) as PitchActionPoint[];
      if (mapped.length) return mapped;

      const splitColumn = String(overview?.table_columns?.[0] ?? '').trim();
      const rawSplitValue = String(row[splitColumn] ?? rowKey ?? '').trim();
      if (!rawSplitValue) return [];
      if (rawSplitValue.toLowerCase() === 'all') return summaryPoints;

      const norm = (value: string) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      const splitNorm = norm(splitColumn);
      const rowNorm = norm(rawSplitValue);

      if (splitNorm === 'pitch' || splitNorm === 'pitch type' || splitNorm === 'pitch types') {
        return summaryPoints.filter((pitch) => norm(pitch.pitch_type) === rowNorm);
      }
      if (splitNorm === 'pitcher') {
        const expected = normalizePersonName(rawSplitValue);
        return summaryPoints.filter((pitch) => normalizePersonName(pitch.pitcher) === expected);
      }
      if (splitNorm === 'batter') {
        const expected = normalizePersonName(rawSplitValue);
        return summaryPoints.filter((pitch) => normalizePersonName(pitch.batter) === expected);
      }
      if (splitNorm === 'catcher') {
        const expected = normalizePersonName(rawSplitValue);
        return summaryPoints.filter((pitch) => normalizePersonName(pitch.catcher) === expected);
      }
      if (splitNorm === 'session type') {
        return summaryPoints.filter((pitch) => norm(pitch.session_type) === rowNorm);
      }
      return [];
    },
    [overview?.row_pitches_by_key, overview?.table_columns, summaryPoints]
  );
  const fetchCompletePitchesForRow = useCallback(
    async (
      row: Record<string, string | number | null>,
      rowKey: string,
      currentPitches: PitchActionPoint[]
    ): Promise<PitchActionPoint[]> => {
      const rowPitchTarget = Number(row['#'] ?? row.P ?? row.pitches ?? 0);
      if (currentPitches.length && (!Number.isFinite(rowPitchTarget) || rowPitchTarget <= 0 || currentPitches.length >= rowPitchTarget)) {
        return currentPitches;
      }
      const baseRequestKey = latestOverviewRequestKeyRef.current;
      if (!baseRequestKey || typeof window === 'undefined') return currentPitches;
      const splitColumn = String(overview?.table_columns?.[0] ?? '').trim();
      const rawSplitValue = String(row[splitColumn] ?? rowKey ?? '').trim();
      if (!rawSplitValue) return currentPitches;

      try {
        const req = new URL(baseRequestKey, window.location.origin);
        const splitNorm = splitColumn.trim().toLowerCase().replace(/\s+/g, ' ');
        const isAll = rawSplitValue.toLowerCase() === 'all' || rawSplitValue.toLowerCase() === 'all (pinned)';
        req.searchParams.set('include_chart_points', '1');
        req.searchParams.set('include_row_pitches', '0');
        req.searchParams.set('include_trend_rows', '0');
        req.searchParams.set('chart_only', '1');
        req.searchParams.set('force_raw', '1');
        req.searchParams.set(
          'chart_points_limit',
          String(Math.min(12000, Math.max(2500, Math.ceil(Number.isFinite(rowPitchTarget) ? rowPitchTarget + 250 : 2500))))
        );
        req.searchParams.delete('percentile_baseline');

        if (!isAll) {
          if (splitNorm === 'pitch' || splitNorm === 'pitch type' || splitNorm === 'pitch types') {
            req.searchParams.set('pitch_types', rawSplitValue);
          } else if (splitNorm === 'pitcher') {
            req.searchParams.set('pitcher', rawSplitValue);
          } else if (splitNorm === 'batter') {
            req.searchParams.set('opp_hitter', rawSplitValue);
          } else if (splitNorm === 'catcher') {
            req.searchParams.set('catcher', rawSplitValue);
          } else if (splitNorm === 'session type') {
            req.searchParams.set('session_type', rawSplitValue);
          }
        }

        const response = await fetch(req.toString(), { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as { chart_points?: PitchActionPoint[]; error?: string };
        if (!response.ok || payload.error) return currentPitches;
        const fetched = Array.isArray(payload.chart_points) ? payload.chart_points : [];
        return fetched.length ? fetched : currentPitches;
      } catch {
        return currentPitches;
      }
    },
    [overview?.table_columns]
  );
  const summaryHeatmapPoints = useMemo(
    () => (rawHeatmapPoints.length ? rawHeatmapPoints : summaryPoints),
    [rawHeatmapPoints, summaryPoints]
  );
  useEffect(() => {
    if (summaryLocationViewTouchedRef.current) return;
    setLocationView(summaryHeatmapPoints.length > 100 ? 'Frequency' : 'Pitch');
  }, [summaryHeatmapPoints.length]);
  const activeSummaryPitchTypes = useMemo(
    () =>
      [...new Set(summaryPoints.map((point) => String(point.pitch_type || '').trim()).filter((value) => value && value !== 'Undefined'))].sort((a, b) => {
        const orderA = PITCH_TYPE_DISPLAY_ORDER.indexOf(a as (typeof PITCH_TYPE_DISPLAY_ORDER)[number]);
        const orderB = PITCH_TYPE_DISPLAY_ORDER.indexOf(b as (typeof PITCH_TYPE_DISPLAY_ORDER)[number]);
        if (orderA === -1 && orderB === -1) return a.localeCompare(b);
        if (orderA === -1) return 1;
        if (orderB === -1) return -1;
        return orderA - orderB;
      }),
    [summaryPoints]
  );
  const plottedPitcherHand = useMemo<'Left' | 'Right'>(() => {
    let hasLeft = false;
    let hasRight = false;
    for (const point of summaryPoints) {
      const raw = String(point.pitcherthrows ?? '').trim().toLowerCase();
      if (raw.startsWith('l')) hasLeft = true;
      if (raw.startsWith('r')) hasRight = true;
    }
    if (hasLeft && !hasRight) return 'Left';
    return 'Right';
  }, [summaryPoints]);
  const velocityMainData = useMemo(() => {
    const veloPoints = [...summaryPoints].filter((p) => typeof p.velo === 'number' && Number.isFinite(p.velo));
    const ordered = isPro
      // PRO rows already arrive in game sequence from API/backend (game/AB/event order).
      // Preserve that order for inning-edge separators.
      ? veloPoints
      : [...veloPoints].sort((a, b) => {
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
    const points = ordered.map((p, idx) => ({ ...p, pitch_count: idx + 1 }));

    const byType = new Map<string, { sum: number; n: number }>();
    for (const p of points) {
      const key = p.pitch_type || 'Undefined';
      const cur = byType.get(key) ?? { sum: 0, n: 0 };
      cur.sum += Number(p.velo);
      cur.n += 1;
      byType.set(key, cur);
    }
    const avgByType = Array.from(byType.entries()).map(([pitch_type, agg]) => ({
      pitch_type,
      avg_velo: agg.n > 0 ? agg.sum / agg.n : null,
    }));

    const selectedPitcherCount = selectedPitchers.filter((value) => value !== 'All').length;
    const dataPitcherSet = new Set(points.map((point) => String(point.pitcher ?? '').trim()).filter(Boolean));
    const dateSet = new Set(points.map((point) => String(point.session_date ?? '').slice(0, 10)).filter(Boolean));
    const gameSet = new Set(
      points
        .map((point) => String(point.game_id || point.game_uid || point.game_foreign_id || '').trim())
        .filter(Boolean)
    );
    const hasSingleGameOrDate = (gameSet.size > 0 && gameSet.size <= 1) || dateSet.size <= 1;
    const hasSinglePitcher = selectedPitcherCount === 1 || dataPitcherSet.size === 1;
    const showInningBoundaries = hasSinglePitcher && hasSingleGameOrDate;
    const inningToKey = (value: unknown): string => {
      const raw = String(value ?? '').trim();
      if (!raw) return '';
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) return String(Math.floor(numeric));
      const match = raw.match(/\d+/);
      return match ? match[0] : raw.toLowerCase();
    };
    const inningBoundaries: number[] = [];
    if (showInningBoundaries) {
      if (isPro) {
        // PRO: draw one separator per inning at the first pitch of that inning.
        const firstPitchByInning = new Map<string, number>();
        for (const point of points) {
          const key = inningToKey(point.inning);
          if (!key) continue;
          if (!firstPitchByInning.has(key)) firstPitchByInning.set(key, point.pitch_count);
        }
        const orderedFirstPitches = Array.from(firstPitchByInning.values()).sort((a, b) => a - b);
        inningBoundaries.push(...orderedFirstPitches.slice(1).map((value) => Math.max(0.5, value - 0.5)));
      } else {
        for (let i = 1; i < points.length; i += 1) {
          const prev = inningToKey(points[i - 1].inning);
          const cur = inningToKey(points[i].inning);
          if (prev && cur && prev !== cur) inningBoundaries.push(Math.max(0.5, points[i].pitch_count - 0.5));
        }
      }
    }

    return { points, avgByType, inningBoundaries, showInningBoundaries };
  }, [summaryPoints, selectedPitchers, isPro]);

  const velocityByGameData = useMemo(() => {
    const grouped = new Map<string, { date: string; pitch_type: string; session_type: string; sumV: number; sumIvb: number; ivbN: number; sumHb: number; hbN: number; n: number }>();
    const dateSet = new Set<string>();
    for (const p of summaryPoints) {
      if (!(typeof p.velo === 'number' && Number.isFinite(p.velo))) continue;
      const date = (p.session_date ?? '').slice(0, 10);
      if (!date) continue;
      dateSet.add(date);
      const pitchType = p.pitch_type || 'Undefined';
      const sessionType = p.session_type || 'Unknown';
      const key = `${date}|${pitchType}|${sessionType}`;
      const cur = grouped.get(key) ?? {
        date,
        pitch_type: pitchType,
        session_type: sessionType,
        sumV: 0,
        sumIvb: 0,
        ivbN: 0,
        sumHb: 0,
        hbN: 0,
        n: 0,
      };
      cur.sumV += Number(p.velo);
      cur.n += 1;
      if (typeof p.ivb === 'number' && Number.isFinite(p.ivb)) {
        cur.sumIvb += p.ivb;
        cur.ivbN += 1;
      }
      if (typeof p.hb === 'number' && Number.isFinite(p.hb)) {
        cur.sumHb += p.hb;
        cur.hbN += 1;
      }
      grouped.set(key, cur);
    }
    const dateLevels = Array.from(dateSet).sort();
    const rows = Array.from(grouped.values())
      .map((g) => ({
        date: g.date,
        pitch_type: g.pitch_type,
        session_type: g.session_type,
        velo: g.n > 0 ? g.sumV / g.n : null,
        ivb: g.ivbN > 0 ? g.sumIvb / g.ivbN : null,
        hb: g.hbN > 0 ? g.sumHb / g.hbN : null,
        n: g.n,
      }))
      .filter((g) => g.velo !== null)
      .sort((a, b) => {
        const dCmp = a.date.localeCompare(b.date);
        if (dCmp !== 0) return dCmp;
        return a.pitch_type.localeCompare(b.pitch_type);
      });
    return { rows, dateLevels };
  }, [summaryPoints]);

  const velocityByInningData = useMemo(() => {
    const inningPoints = summaryPoints.filter(
      (p) =>
        (p.session_type || '').toLowerCase().includes('live') &&
        typeof p.velo === 'number' &&
        Number.isFinite(p.velo) &&
        parseInningNumber(p.inning) !== null
    );
    if (!inningPoints.length) {
      return {
        rows: [] as Array<{ inning_ord: number; pitch_type: string; velo: number | null; ivb: number | null; hb: number | null; n: number; games: number }>,
        rowPitchesByKey: {} as Record<string, PitchActionPoint[]>,
      };
    }

    const byGame = new Map<string, PitchActionPoint[]>();
    for (const p of inningPoints) {
      const dateKey = (p.session_date ?? '').slice(0, 10);
      const gameKey = p.game_id || p.game_uid || p.game_foreign_id || dateKey || 'unknown_game';
      const cur = byGame.get(gameKey) ?? [];
      cur.push(p);
      byGame.set(gameKey, cur);
    }

    const grouped = new Map<string, { inning_ord: number; pitch_type: string; sumV: number; n: number; sumIvb: number; ivbN: number; sumHb: number; hbN: number; games: Set<string> }>();
    const rowPitchesByKey: Record<string, PitchActionPoint[]> = {};

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

      // Mirrors Shiny: InningOrd = match(Inning, unique(Inning)).
      const inningOrder = new Map<string, number>();
      let inningCounter = 0;

      for (let idx = 0; idx < sorted.length; idx += 1) {
        const p = sorted[idx];
        const parsedInning = parseInningNumber(p.inning);
        if (parsedInning === null) continue;
        const inningKey = String(parsedInning);
        if (!inningOrder.has(inningKey)) {
          inningCounter += 1;
          inningOrder.set(inningKey, inningCounter);
        }
        const inningOrd = inningOrder.get(inningKey) ?? null;

        if (inningOrd === null) continue;
        const pitchType = p.pitch_type || 'Undefined';
        const key = `${inningOrd}|${pitchType}`;
        const cur = grouped.get(key) ?? {
          inning_ord: inningOrd,
          pitch_type: pitchType,
          sumV: 0,
          n: 0,
          sumIvb: 0,
          ivbN: 0,
          sumHb: 0,
          hbN: 0,
          games: new Set<string>(),
        };
        cur.sumV += Number(p.velo);
        cur.n += 1;
        cur.games.add(gameKey);
        if (typeof p.ivb === 'number' && Number.isFinite(p.ivb)) {
          cur.sumIvb += p.ivb;
          cur.ivbN += 1;
        }
        if (typeof p.hb === 'number' && Number.isFinite(p.hb)) {
          cur.sumHb += p.hb;
          cur.hbN += 1;
        }
        grouped.set(key, cur);
        if (!rowPitchesByKey[key]) rowPitchesByKey[key] = [];
        rowPitchesByKey[key].push(p);
      }
    }

    const rows = Array.from(grouped.values())
      .map((g) => ({
        inning_ord: g.inning_ord,
        pitch_type: g.pitch_type,
        velo: g.n > 0 ? g.sumV / g.n : null,
        ivb: g.ivbN > 0 ? g.sumIvb / g.ivbN : null,
        hb: g.hbN > 0 ? g.sumHb / g.hbN : null,
        n: g.n,
        games: g.games.size,
      }))
      .filter((g) => g.velo !== null)
      .sort((a, b) => (a.inning_ord - b.inning_ord) || a.pitch_type.localeCompare(b.pitch_type));
    return { rows, rowPitchesByKey };
  }, [summaryPoints]);
  const trendSeriesBySessionData = useMemo(() => {
    type TrendAgg = {
      date: string;
      pitches: number;
      veloSum: number;
      veloN: number;
      veloMax: number;
      spinSum: number;
      spinN: number;
      ivbSum: number;
      ivbN: number;
      hbSum: number;
      hbN: number;
      relHeightSum: number;
      relHeightN: number;
      relSideSum: number;
      relSideN: number;
      extensionSum: number;
      extensionN: number;
      stuffSum: number;
      stuffN: number;
      qpSum: number;
      qpN: number;
      locN: number;
      inZoneN: number;
      compN: number;
      strikeN: number;
      swingN: number;
      whiffN: number;
      cswN: number;
      fpsDen: number;
      fpsNum: number;
      earlyDen: number;
      earlyNum: number;
      aheadDen: number;
      aheadNum: number;
      eaDen: number;
      eaNum: number;
      oneOneDen: number;
      oneOneNum: number;
      qpDen: number;
      qpNum: number;
      inPlayN: number;
      gbN: number;
      barrelN: number;
      evSum: number;
      evN: number;
      laSum: number;
      laN: number;
      rvSum: number;
      pvSum: number;
      whiffs: number;
      bfKeys: Set<string>;
      kKeys: Set<string>;
      bbKeys: Set<string>;
      rowPitches: PitchActionPoint[];
    };
    type TrendRow = {
      date: string;
      value: number | null;
      rowPitches: PitchActionPoint[];
      pitches?: number;
    };

    const backendTrendRows = overview?.trend_rows ?? [];
    const backendHasSelectedMetric = backendTrendRows.some((row) => {
      const metricValue = row.values?.[trendMetric];
      return typeof metricValue === 'number' && Number.isFinite(metricValue);
    });
    if (backendTrendRows.length > 0 && backendHasSelectedMetric) {
      const rowsBySession = TREND_SESSION_ORDER.reduce((acc, session) => {
        const rows = backendTrendRows
          .filter((row) => row.session_bucket === session)
          .map((row) => {
            const metricValue = row.values?.[trendMetric];
            const pitchCount = row.values?.P;
            return {
              date: row.date,
              value: typeof metricValue === 'number' && Number.isFinite(metricValue) ? metricValue : null,
              rowPitches: [],
              pitches: typeof pitchCount === 'number' && Number.isFinite(pitchCount) ? pitchCount : undefined,
            } as TrendRow;
          })
          .sort((a, b) => a.date.localeCompare(b.date));
        acc[session] = rows;
        return acc;
      }, {} as Record<(typeof TREND_SESSION_ORDER)[number], TrendRow[]>);

      const allDates = Array.from(
        new Set(
          TREND_SESSION_ORDER.flatMap((session) => rowsBySession[session].map((row) => row.date))
        )
      ).sort((a, b) => a.localeCompare(b));

      return { rowsBySession, allDates };
    }

    const parseRunValue = (point: PitchActionPoint): number => {
      if (typeof point.run_value === 'number' && Number.isFinite(point.run_value)) return point.run_value;
      const call = point.pitch_call || '';
      const play = point.play_result || '';
      const korbb = point.korbb || '';
      if (korbb === 'Strikeout') return -0.27;
      if (korbb === 'Walk') return 0.33;
      if (call === 'BallCalled' || call === 'BallinDirt' || call === 'BallIntentional') return 0.03;
      if (call === 'StrikeCalled' || call === 'StrikeSwinging' || call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable') return -0.03;
      if (call === 'InPlay') {
        if (play === 'Single') return 0.47;
        if (play === 'Double') return 0.78;
        if (play === 'Triple') return 1.09;
        if (play === 'HomeRun') return 1.4;
        if (play === 'Error') return 0.33;
        return -0.27;
      }
      return 0;
    };
    const parsePitchValue = (point: PitchActionPoint): number => calcPitchValue(point);

    const buildEmptyAgg = (date: string): TrendAgg => ({
      date,
      pitches: 0,
      veloSum: 0,
      veloN: 0,
      veloMax: Number.NEGATIVE_INFINITY,
      spinSum: 0,
      spinN: 0,
      ivbSum: 0,
      ivbN: 0,
      hbSum: 0,
      hbN: 0,
      relHeightSum: 0,
      relHeightN: 0,
      relSideSum: 0,
      relSideN: 0,
      extensionSum: 0,
      extensionN: 0,
      stuffSum: 0,
      stuffN: 0,
      qpSum: 0,
      qpN: 0,
      locN: 0,
      inZoneN: 0,
      compN: 0,
      strikeN: 0,
      swingN: 0,
      whiffN: 0,
      cswN: 0,
      fpsDen: 0,
      fpsNum: 0,
      earlyDen: 0,
      earlyNum: 0,
      aheadDen: 0,
      aheadNum: 0,
      eaDen: 0,
      eaNum: 0,
      oneOneDen: 0,
      oneOneNum: 0,
      qpDen: 0,
      qpNum: 0,
      inPlayN: 0,
      gbN: 0,
      barrelN: 0,
      evSum: 0,
      evN: 0,
      laSum: 0,
      laN: 0,
      rvSum: 0,
      pvSum: 0,
      whiffs: 0,
      bfKeys: new Set<string>(),
      kKeys: new Set<string>(),
      bbKeys: new Set<string>(),
      rowPitches: [],
    });
    const pct = (num: number, den: number) => (den > 0 ? (100 * num) / den : null);
    const metricForAgg = (agg: TrendAgg, metric: string): number | null => {
      const bf = agg.bfKeys.size;
      const k = agg.kKeys.size;
      const bb = agg.bbKeys.size;
      const values: Record<string, number | null> = {
        'Velocity (Avg)': agg.veloN > 0 ? agg.veloSum / agg.veloN : null,
        'Velocity (Max)': Number.isFinite(agg.veloMax) ? agg.veloMax : null,
        Spin: agg.spinN > 0 ? agg.spinSum / agg.spinN : null,
        IVB: agg.ivbN > 0 ? agg.ivbSum / agg.ivbN : null,
        HB: agg.hbN > 0 ? agg.hbSum / agg.hbN : null,
        'Release Height': agg.relHeightN > 0 ? agg.relHeightSum / agg.relHeightN : null,
        'Release Side': agg.relSideN > 0 ? agg.relSideSum / agg.relSideN : null,
        Extension: agg.extensionN > 0 ? agg.extensionSum / agg.extensionN : null,
        'Stuff+': agg.stuffN > 0 ? agg.stuffSum / agg.stuffN : null,
        'QP+': agg.qpN > 0 ? agg.qpSum / agg.qpN : null,
        'InZone%': pct(agg.inZoneN, agg.locN),
        'Comp%': pct(agg.compN, agg.locN),
        'Strike%': pct(agg.strikeN, agg.pitches),
        'Swing%': pct(agg.swingN, agg.pitches),
        'FPS%': pct(agg.fpsNum, agg.fpsDen),
        'Early%': pct(agg.earlyNum, agg.earlyDen),
        'Ahead%': pct(agg.aheadNum, agg.aheadDen),
        'E+A%': pct(agg.eaNum, agg.eaDen),
        '1-1W%': pct(agg.oneOneNum, agg.oneOneDen),
        'QP%': pct(agg.qpNum, agg.qpDen),
        'Whiff%': pct(agg.whiffN, agg.swingN),
        'SwStrk%': pct(agg.whiffN, agg.pitches),
        'CSW%': pct(agg.cswN, agg.pitches),
        'K%': pct(k, bf),
        'BB%': pct(bb, bf),
        'GB%': pct(agg.gbN, agg.inPlayN),
        'Barrel%': pct(agg.barrelN, agg.inPlayN),
        'Exit Velocity': agg.evN > 0 ? agg.evSum / agg.evN : null,
        'Launch Angle': agg.laN > 0 ? agg.laSum / agg.laN : null,
        'RV/100': agg.pitches > 0 ? (agg.rvSum / agg.pitches) * 100 : null,
        'PV/100': agg.pitches > 0 ? (agg.pvSum / agg.pitches) * 100 : null,
        P: agg.pitches,
        BF: bf,
        Whiffs: agg.whiffs,
        K: k,
        BB: bb,
      };
      return values[metric] ?? null;
    };
    const normalizeTeamCode = (value: string | null | undefined): string =>
      (value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const selectedSchoolCode = normalizeTeamCode(filters?.school_code);
    const schoolCodes = new Set<string>();
    if (selectedSchoolCode) schoolCodes.add(selectedSchoolCode);
    for (const alias of TREND_SCHOOL_TEAM_CODE_ALIASES[selectedSchoolCode] ?? []) {
      const normalizedAlias = normalizeTeamCode(alias);
      if (normalizedAlias) schoolCodes.add(normalizedAlias);
    }
    const isSchoolCode = (value: string | null | undefined): boolean => schoolCodes.has(normalizeTeamCode(value));
    const readPointString = (point: PitchActionPoint, keys: string[]): string => {
      for (const key of keys) {
        const value = (point as unknown as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
      }
      return '';
    };
    const normalizeSession = (point: PitchActionPoint): (typeof TREND_SESSION_ORDER)[number] | null => {
      const pitcherCode = normalizeTeamCode(
        readPointString(point, ['pitcher_team_code', 'pitcher_team_norm', 'pitcherteam', 'PitcherTeam', 'PitcherTeamCode', 'home_team', 'HomeTeam'])
      );
      const batterCode = normalizeTeamCode(
        readPointString(point, ['batter_team_code', 'batter_team_norm', 'batterteam', 'BatterTeam', 'BatterTeamCode', 'away_team', 'AwayTeam'])
      );
      const pitcherIsSchool = isSchoolCode(pitcherCode);
      const batterIsSchool = isSchoolCode(batterCode);
      const pitcherHasCode = pitcherCode.length > 0;
      const batterHasCode = batterCode.length > 0;

      // Exact requested rule using selected school team codes only:
      // Live BP: both PitcherTeam and BatterTeam are selected-school codes.
      // Season: one is selected-school code, the other is non-selected-school team code.
      if (pitcherHasCode && batterHasCode) {
        if (pitcherIsSchool && batterIsSchool) return 'Live BP';
        if (pitcherIsSchool !== batterIsSchool) return 'Season';
        return null;
      } else if (pitcherIsSchool !== batterIsSchool) {
        return 'Season';
      }

      const sessionType = point.session_type || '';
      const raw = (sessionType || '').trim().toLowerCase();
      if (!raw) return null;
      const v = raw.replace(/[\s_-]+/g, '');
      if (v.includes('bull') || v.includes('prac')) return 'Bullpen';
      // Do not infer Live BP/Season from labels.
      // Those two must come from team-code rules above.
      return null;
    };

    const bySession = new Map<(typeof TREND_SESSION_ORDER)[number], Map<string, TrendAgg>>();
    for (const session of TREND_SESSION_ORDER) bySession.set(session, new Map<string, TrendAgg>());
    for (const point of summaryPoints) {
      const date = (point.session_date ?? '').slice(0, 10);
      const session = normalizeSession(point);
      if (!date || !session) continue;
      const sessionMap = bySession.get(session);
      if (!sessionMap) continue;
      let agg = sessionMap.get(date);
      if (!agg) {
        agg = buildEmptyAgg(date);
        sessionMap.set(date, agg);
      }

      const call = point.pitch_call || '';
      const play = point.play_result || '';
      const balls = point.balls_num;
      const strikes = point.strikes_num;
      const paKeyRaw = `${point.game_id || point.game_uid || point.game_foreign_id || 'g'}|${point.play_id || point.pitch_event_id || point.pitch_no || point.pitch_number || 'p'}`;
      const paKey = paKeyRaw.trim();

      agg.rowPitches.push(point);
      agg.pitches += 1;
      if (typeof point.velo === 'number' && Number.isFinite(point.velo)) {
        agg.veloSum += point.velo;
        agg.veloN += 1;
        agg.veloMax = Math.max(agg.veloMax, point.velo);
      }
      if (typeof point.spin === 'number' && Number.isFinite(point.spin)) {
        agg.spinSum += point.spin;
        agg.spinN += 1;
      }
      if (typeof point.ivb === 'number' && Number.isFinite(point.ivb)) {
        agg.ivbSum += point.ivb;
        agg.ivbN += 1;
      }
      if (typeof point.hb === 'number' && Number.isFinite(point.hb)) {
        agg.hbSum += point.hb;
        agg.hbN += 1;
      }
      if (typeof point.release_height === 'number' && Number.isFinite(point.release_height)) {
        agg.relHeightSum += point.release_height;
        agg.relHeightN += 1;
      }
      if (typeof point.release_side === 'number' && Number.isFinite(point.release_side)) {
        agg.relSideSum += point.release_side;
        agg.relSideN += 1;
      }
      if (typeof point.extension === 'number' && Number.isFinite(point.extension)) {
        agg.extensionSum += point.extension;
        agg.extensionN += 1;
      }
      if (typeof point.stuff_plus === 'number' && Number.isFinite(point.stuff_plus)) {
        agg.stuffSum += point.stuff_plus;
        agg.stuffN += 1;
      }
      if (typeof point.qp_plus === 'number' && Number.isFinite(point.qp_plus)) {
        agg.qpSum += point.qp_plus;
        agg.qpN += 1;
        agg.qpDen += 1;
        if (point.qp_plus >= 100) agg.qpNum += 1;
      }

      const inZone = inZoneLabel(point.plate_side, point.plate_height);
      if (
        typeof point.plate_side === 'number' &&
        Number.isFinite(point.plate_side) &&
        typeof point.plate_height === 'number' &&
        Number.isFinite(point.plate_height)
      ) {
        agg.locN += 1;
      }
      if (inZone === 'Yes') agg.inZoneN += 1;
      if (inZone === 'Yes' || inZone === 'Competitive') agg.compN += 1;

      const isStrike = call === 'StrikeCalled' || call === 'StrikeSwinging' || call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable' || call === 'InPlay';
      const isSwing = call === 'StrikeSwinging' || call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable' || call === 'InPlay';
      const isWhiff = call === 'StrikeSwinging';

      if (isStrike) agg.strikeN += 1;
      if (isSwing) agg.swingN += 1;
      if (isWhiff) {
        agg.whiffN += 1;
        agg.whiffs += 1;
      }
      if (call === 'StrikeCalled' || isWhiff) agg.cswN += 1;

      if (typeof balls === 'number' && typeof strikes === 'number') {
        if (balls === 0 && strikes === 0) {
          agg.fpsDen += 1;
          if (isStrike) agg.fpsNum += 1;
        }
        if (balls + strikes <= 1) {
          agg.earlyDen += 1;
          if (isStrike) agg.earlyNum += 1;
        }
        if (strikes > balls) {
          agg.aheadDen += 1;
          if (isStrike) agg.aheadNum += 1;
        }
        if (balls === 1 && strikes === 1) {
          agg.oneOneDen += 1;
          if (isStrike) agg.oneOneNum += 1;
        }
      }

      if (typeof balls === 'number' && typeof strikes === 'number' && (balls + strikes <= 1 || strikes > balls)) {
        agg.eaDen += 1;
        if (isStrike) agg.eaNum += 1;
      }

      if (call === 'InPlay') {
        agg.inPlayN += 1;
        if ((point.tagged_hit_type || '').toLowerCase().includes('ground')) agg.gbN += 1;
        if ((point.tagged_hit_type || '').toLowerCase().includes('barrel')) agg.barrelN += 1;
        if (typeof point.exit_speed === 'number' && Number.isFinite(point.exit_speed)) {
          agg.evSum += point.exit_speed;
          agg.evN += 1;
        }
        if (typeof point.angle === 'number' && Number.isFinite(point.angle)) {
          agg.laSum += point.angle;
          agg.laN += 1;
        }
      }

      agg.rvSum += parseRunValue(point);
      agg.pvSum += parsePitchValue(point);
      agg.bfKeys.add(paKey);
      if (point.korbb === 'Strikeout') agg.kKeys.add(paKey);
      if (point.korbb === 'Walk') agg.bbKeys.add(paKey);
    }

    const rowsBySession = TREND_SESSION_ORDER.reduce((acc, session) => {
      const sessionMap = bySession.get(session);
      const rows: TrendRow[] = sessionMap
        ? Array.from(sessionMap.values())
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((agg) => ({
              date: agg.date,
              value: metricForAgg(agg, trendMetric),
              rowPitches: agg.rowPitches,
            }))
        : [];
      acc[session] = rows;
      return acc;
    }, {} as Record<(typeof TREND_SESSION_ORDER)[number], TrendRow[]>);

    const allDates = Array.from(
      new Set(
        TREND_SESSION_ORDER.flatMap((session) => rowsBySession[session].map((row) => row.date))
      )
    ).sort((a, b) => a.localeCompare(b));

    return { rowsBySession, allDates };
  }, [summaryPoints, trendMetric, overview?.trend_rows]);
  const targetShapeKey = useMemo(() => `portal-target-shapes:${filters?.school_code ?? 'DEFAULT'}`, [filters?.school_code]);
  const avgByType = useMemo(() => {
    const grouped = new Map<string, OverviewPayload['chart_points']>();
    for (const p of summaryPoints) {
      const key = p.pitch_type || 'Undefined';
      const cur = grouped.get(key) ?? [];
      cur.push(p);
      grouped.set(key, cur);
    }
    const safeMean = (vals: Array<number | null | undefined>) => {
      const n = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (!n.length) return null;
      return n.reduce((a, b) => a + b, 0) / n.length;
    };
    return Array.from(grouped.entries()).map(([pitchType, pts]) => ({
      pitch_type: pitchType,
      release_side: safeMean(pts.map((p) => (typeof p.release_side === 'number' ? orientX(p.release_side, p.school_code) : p.release_side))),
      release_height: safeMean(pts.map((p) => p.release_height)),
      extension: safeMean(pts.map((p) => p.extension)),
      hb: safeMean(pts.map((p) => p.hb)),
      ivb: safeMean(pts.map((p) => p.ivb)),
      velo: safeMean(pts.map((p) => p.velo)),
      stuff_plus: safeMean(pts.map((p) => p.stuff_plus)),
      count: pts.length,
    }));
  }, [summaryPoints]);

  // Break lines: fetch the fastball-shape-conditioned offset grid for
  // whichever base pitch (Fastball or Sinker) is selected, keyed on this
  // pitcher's own average movement location -- so e.g. a Changeup line
  // reflects real Changeup movement for pitchers who share this shape of
  // fastball, not a single population-wide average offset.
  useEffect(() => {
    const baseType = breakLines === 'Fastball' || breakLines === 'Sinker' ? breakLines : '';
    if (!baseType) {
      setBreakLineOffsets([]);
      setBreakLineOffsetsFallback(false);
      return;
    }
    const base = avgByType.find((p) => p.pitch_type === baseType);
    if (!base || base.hb === null || base.ivb === null) {
      setBreakLineOffsets([]);
      setBreakLineOffsetsFallback(false);
      return;
    }
    let active = true;
    const params = new URLSearchParams({
      level: breakLinesLevel,
      base_pitch_type: baseType,
      fb_ivb: String(base.ivb),
      fb_hb: String(plottedPitcherHand === 'Left' ? -base.hb : base.hb),
    });
    fetch(`/api/dashboard/pitching/break-line-offsets?${params.toString()}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { offsets?: BreakLineOffset[] } | null) => {
        if (!active) return;
        const offsets = payload?.offsets ?? [];
        setBreakLineOffsets(offsets);
        setBreakLineOffsetsFallback(offsets.some((row) => row.used_fallback));
      })
      .catch(() => {
        if (!active) return;
        setBreakLineOffsets([]);
        setBreakLineOffsetsFallback(false);
      });
    return () => {
      active = false;
    };
  }, [breakLines, breakLinesLevel, avgByType, plottedPitcherHand]);

  const expectedMovementData = useMemo(() => {
    const eligiblePoints: OverviewPayload['chart_points'] = [];
    const grouped = new Map<
      string,
      {
        count: number;
        actualHb: number;
        actualIvb: number;
        expectedHb: number;
        expectedIvb: number;
        velo: number;
        veloN: number;
        stuff: number;
        stuffN: number;
      }
    >();
    for (const point of summaryPoints) {
      if (
        typeof point.hb !== 'number' ||
        !Number.isFinite(point.hb) ||
        typeof point.ivb !== 'number' ||
        !Number.isFinite(point.ivb) ||
        typeof point.expected_hb !== 'number' ||
        !Number.isFinite(point.expected_hb) ||
        typeof point.expected_ivb !== 'number' ||
        !Number.isFinite(point.expected_ivb)
      ) {
        continue;
      }
      eligiblePoints.push(point);
      const key = point.pitch_type || 'Undefined';
      const current = grouped.get(key) ?? {
        count: 0,
        actualHb: 0,
        actualIvb: 0,
        expectedHb: 0,
        expectedIvb: 0,
        velo: 0,
        veloN: 0,
        stuff: 0,
        stuffN: 0,
      };
      current.count += 1;
      current.actualHb += Number(point.hb);
      current.actualIvb += Number(point.ivb);
      current.expectedHb += Number(point.expected_hb);
      current.expectedIvb += Number(point.expected_ivb);
      if (Number.isFinite(Number(point.velo))) {
        current.velo += Number(point.velo);
        current.veloN += 1;
      }
      if (Number.isFinite(Number(point.stuff_plus))) {
        current.stuff += Number(point.stuff_plus);
        current.stuffN += 1;
      }
      grouped.set(key, current);
    }
    const averages = Array.from(grouped.entries()).map(([pitch_type, aggregate]) => ({
      pitch_type,
      count: aggregate.count,
      hb: aggregate.actualHb / aggregate.count,
      ivb: aggregate.actualIvb / aggregate.count,
      expected_hb: aggregate.expectedHb / aggregate.count,
      expected_ivb: aggregate.expectedIvb / aggregate.count,
      velo: aggregate.veloN ? aggregate.velo / aggregate.veloN : null,
      stuff_plus: aggregate.stuffN ? aggregate.stuff / aggregate.stuffN : null,
    }));
    return { eligiblePoints, averages };
  }, [summaryPoints]);
  const fullMagnusAveragesByPitchType = useMemo(() => {
    const averages = new Map<
      string,
      {
        pitch_type: string;
        expected_hb: number;
        expected_ivb: number;
        magnus_angle: number | null;
      }
    >();
    const splitColumn = overview?.table_columns?.[0] ?? '';
    if (!splitColumn || splitBy !== 'Pitch Types') return averages;
    for (const row of overview?.table_rows ?? []) {
      const pitchType = String(row[splitColumn] ?? '').trim();
      if (!pitchType || isAllLikeRowValue(pitchType)) continue;
      const expectedHb = parseSortableNumber(row.xHB);
      const expectedIvb = parseSortableNumber(row.xIVB);
      if (expectedHb === null || expectedIvb === null) continue;
      averages.set(normalizeNameToken(pitchType), {
        pitch_type: pitchType,
        expected_hb: expectedHb,
        expected_ivb: expectedIvb,
        magnus_angle: parseSortableNumber(row.MagAngle),
      });
    }
    return averages;
  }, [overview?.table_columns, overview?.table_rows, splitBy]);

  // Comparison-population (MLB / college level / team) averages for the
  // Movement plot overlay -- same shape as fullMagnusAveragesByPitchType,
  // but sourced from a separately-scoped request (movementComparisonRows)
  // instead of the current view's own overview payload.
  const movementComparisonAveragesByPitchType = useMemo(() => {
    const averages = new Map<
      string,
      {
        pitch_type: string;
        actual_hb: number | null;
        actual_ivb: number | null;
        expected_hb: number | null;
        expected_ivb: number | null;
        magnus_angle: number | null;
      }
    >();
    if (!movementComparisonSplitColumn) return averages;
    for (const row of movementComparisonRows) {
      const pitchType = String(row[movementComparisonSplitColumn] ?? '').trim();
      if (!pitchType || isAllLikeRowValue(pitchType)) continue;
      const actualHb = parseSortableNumber(row.HB);
      const actualIvb = parseSortableNumber(row.IVB);
      const expectedHb = parseSortableNumber(row.xHB);
      const expectedIvb = parseSortableNumber(row.xIVB);
      if (actualHb === null && actualIvb === null && expectedHb === null && expectedIvb === null) continue;
      averages.set(normalizeNameToken(pitchType), {
        pitch_type: pitchType,
        actual_hb: actualHb,
        actual_ivb: actualIvb,
        expected_hb: expectedHb,
        expected_ivb: expectedIvb,
        magnus_angle: parseSortableNumber(row.MagAngle),
      });
    }
    return averages;
  }, [movementComparisonRows, movementComparisonSplitColumn]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(targetShapeKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, TargetShape>;
      setTargetShapes(parsed ?? {});
    } catch {
      setTargetShapes({});
    }
  }, [targetShapeKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(targetShapeKey, JSON.stringify(targetShapes));
  }, [targetShapeKey, targetShapes]);

  const buildHeatCells = (
    points: OverviewPayload['chart_points'],
    xKey: 'plate_side',
    yKey: 'plate_height',
    metric: string
  ): HeatCell[] => {
    const toFiniteNumber = (value: unknown): number | null => {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value === 'string') {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };
    if (metric === 'xWOBA' || metric === 'xISO') {
      const normalizedPoints = points.map((point) => {
        const pointRec = point as Record<string, unknown>;
        const rawX = point[xKey];
        const rawY = point[yKey];
        const xNum = toFiniteNumber(rawX);
        const yNum = toFiniteNumber(rawY);
        const x = xNum !== null ? orientX(xNum, point.school_code) : null;
        const y = yNum;
        return {
          plate_side: x,
          plate_height: y,
          estimated_woba_using_speedangle: (
            toFiniteNumber(point.estimated_woba_using_speedangle) ??
            toFiniteNumber(pointRec.xWOBA) ??
            toFiniteNumber(pointRec.xwoba)
          ),
          iso_value: (
            toFiniteNumber(point.iso_value) ??
            toFiniteNumber(pointRec.xISO) ??
            toFiniteNumber(pointRec.xiso)
          ),
        };
      });
      return buildSharedXMetricHeatCells(normalizedPoints, metric);
    }
    const xMin = -2.5;
    const xMax = 2.5;
    const yMin = 0;
    const yMax = 4.5;
    const cols = 40;
    const rows = 40;
    const cellW = (xMax - xMin) / cols;
    const cellH = (yMax - yMin) / rows;
    const sigmaX = 0.15;
    const sigmaY = 0.15;
    const eps = 1e-9;
    const normDesc = (value: unknown): string =>
      String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    const isInPlayCall = (pitch: OverviewPayload['chart_points'][number]): boolean => {
      const raw = String(pitch.pitch_call ?? '');
      if (raw === 'InPlay') return true;
      const d = normDesc(raw);
      return d.startsWith('in_play') || d.startsWith('hit_into_play');
    };
    const isSwingCall = (pitch: OverviewPayload['chart_points'][number]): boolean => {
      const raw = String(pitch.pitch_call ?? '');
      if (!isPro) {
        return raw === 'StrikeSwinging' || raw === 'FoulBall' || raw === 'FoulBallFieldable' || raw === 'FoulBallNotFieldable' || raw === 'InPlay';
      }
      const d = normDesc(raw);
      return (
        isInPlayCall(pitch) ||
        d === 'swinging_strike' ||
        d === 'swinging_strike_blocked' ||
        d === 'swinging_strike_pitchout' ||
        d === 'strikeswinging' ||
        d === 'foul' ||
        d === 'foul_tip' ||
        d === 'foul_bunt' ||
        d === 'foul_pitchout' ||
        d === 'missed_bunt' ||
        d.startsWith('foul')
      );
    };
    const isWhiffCall = (pitch: OverviewPayload['chart_points'][number]): boolean => {
      const raw = String(pitch.pitch_call ?? '');
      if (!isPro) return raw === 'StrikeSwinging';
      const d = normDesc(raw);
      return (
        d === 'swinging_strike' ||
        d === 'swinging_strike_blocked' ||
        d === 'strikeswinging' ||
        d === 'foul_tip' ||
        d === 'foultip' ||
        d === 'bunt_foul_tip' ||
        d === 'buntfoultip'
      );
    };
    const isGroundBall = (pitch: OverviewPayload['chart_points'][number]): boolean => {
      const tagged = normDesc(pitch.tagged_hit_type ?? '');
      return tagged.includes('ground_ball') || tagged === 'groundball';
    };
    const runValue = (pitch: OverviewPayload['chart_points'][number]): number | null => {
      if (typeof pitch.run_value === 'number' && Number.isFinite(pitch.run_value)) return pitch.run_value;
      if (isPro) return null;
      // Non-PRO fallback when run_value is missing on chart points.
      const pitchCall = pitch.pitch_call || '';
      const playResult = pitch.play_result || '';
      const korbb = pitch.korbb || '';
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
    const pitchValue = (pitch: OverviewPayload['chart_points'][number]): number => calcPitchValue(pitch);
    const valid = points
      .map((p) => {
        const rawX = p[xKey];
        const rawY = p[yKey];
        const adjustedX = typeof rawX === 'number' ? orientX(rawX, p.school_code) : rawX;
        return { p, x: adjustedX, y: rawY };
      })
      .filter(
        (row): row is { p: OverviewPayload['chart_points'][number]; x: number; y: number } =>
          row.x !== null &&
          row.y !== null &&
          row.x >= xMin &&
          row.x <= xMax &&
          row.y >= yMin &&
          row.y <= yMax
      );
    if (!valid.length) return [];
    const pointPitchCount = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).pitch_n);
      return n !== null && n > 0 ? n : 1;
    };
    const pointSwingCount = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).swing_n);
      if (n !== null && n >= 0) return n;
      return isSwingCall(pitch) ? 1 : 0;
    };
    const pointWhiffCount = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).whiff_n);
      if (n !== null && n >= 0) return n;
      return isWhiffCall(pitch) ? 1 : 0;
    };
    const pointInPlayCount = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).in_play_n);
      if (n !== null && n >= 0) return n;
      return isInPlayCall(pitch) ? 1 : 0;
    };
    const pointGbCount = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).gb_n);
      if (n !== null && n >= 0) return n;
      return isInPlayCall(pitch) && isGroundBall(pitch) ? 1 : 0;
    };
    const pointEvSum = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).ev_sum);
      if (n !== null) return n;
      const ev = toFiniteNumber(pitch.exit_speed);
      return ev !== null ? ev : 0;
    };
    const pointEvCount = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).ev_n);
      if (n !== null && n >= 0) return n;
      return isInPlayCall(pitch) && toFiniteNumber(pitch.exit_speed) !== null ? 1 : 0;
    };
    const pointQpSum = (pitch: OverviewPayload['chart_points'][number]): number => {
      const qp = toFiniteNumber(pitch.qp_plus);
      return qp !== null ? qp : 0;
    };
    const pointQpCount = (pitch: OverviewPayload['chart_points'][number]): number => {
      return toFiniteNumber(pitch.qp_plus) !== null ? 1 : 0;
    };
    const pointRvSum = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).run_value_sum);
      if (n !== null) return n;
      const rv = runValue(pitch);
      return typeof rv === 'number' && Number.isFinite(rv) ? rv * pointPitchCount(pitch) : 0;
    };
    const pointPvSum = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).pv_sum);
      if (n !== null) return n;
      const pv = pitchValue(pitch);
      return Number.isFinite(pv) ? pv * pointPitchCount(pitch) : 0;
    };
    const pointXwobaSum = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).xwoba_sum);
      if (n !== null) return n;
      const x = toFiniteNumber(pitch.estimated_woba_using_speedangle);
      return x !== null ? x : 0;
    };
    const pointXwobaCount = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).xwoba_n);
      if (n !== null && n >= 0) return n;
      return toFiniteNumber(pitch.estimated_woba_using_speedangle) !== null ? 1 : 0;
    };
    const pointXisoSum = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).xiso_sum);
      if (n !== null) return n;
      const x = toFiniteNumber(pitch.iso_value);
      return x !== null ? x : 0;
    };
    const pointXisoCount = (pitch: OverviewPayload['chart_points'][number]): number => {
      const n = toFiniteNumber((pitch as Record<string, unknown>).xiso_n);
      if (n !== null && n >= 0) return n;
      return toFiniteNumber(pitch.iso_value) !== null ? 1 : 0;
    };
    const globalXwobaRows = valid.filter(
      (rowPoint) =>
        typeof rowPoint.p.estimated_woba_using_speedangle === 'number' &&
        Number.isFinite(rowPoint.p.estimated_woba_using_speedangle)
    );
    const globalXisoRows = valid.filter(
      (rowPoint) =>
        typeof rowPoint.p.iso_value === 'number' &&
        Number.isFinite(rowPoint.p.iso_value)
    );

    const globalPitchCount = valid.reduce((sum, rowPoint) => sum + pointPitchCount(rowPoint.p), 0);
    const globalSwingCount = valid.reduce((sum, rowPoint) => sum + pointSwingCount(rowPoint.p), 0);
    const globalWhiffCount = valid.reduce((sum, rowPoint) => sum + pointWhiffCount(rowPoint.p), 0);
    const globalInPlayCount = valid.reduce((sum, rowPoint) => sum + pointInPlayCount(rowPoint.p), 0);
    const globalGbCount = valid.reduce((sum, rowPoint) => sum + pointGbCount(rowPoint.p), 0);
    const globalEvSum = valid.reduce((sum, rowPoint) => sum + pointEvSum(rowPoint.p), 0);
    const globalEvCount = valid.reduce((sum, rowPoint) => sum + pointEvCount(rowPoint.p), 0);
    const globalQpSum = valid.reduce((sum, rowPoint) => sum + pointQpSum(rowPoint.p), 0);
    const globalQpCount = valid.reduce((sum, rowPoint) => sum + pointQpCount(rowPoint.p), 0);
    const globalEvAvg =
      globalEvCount > 0
        ? globalEvSum / globalEvCount
        : 0;
    const globalQpAvg =
      globalQpCount > 0
        ? globalQpSum / globalQpCount
        : 100;
    const globalRvAvg = globalPitchCount > 0 ? valid.reduce((sum, rowPoint) => sum + pointRvSum(rowPoint.p), 0) / globalPitchCount : 0;
    const globalPvAvg = globalPitchCount > 0 ? valid.reduce((sum, rowPoint) => sum + pointPvSum(rowPoint.p), 0) / globalPitchCount : 0;
    const globalXwobaAvg =
      globalXwobaRows.length > 0
        ? globalXwobaRows.reduce((sum, rowPoint) => sum + Number(rowPoint.p.estimated_woba_using_speedangle || 0), 0) / globalXwobaRows.length
        : 0.35;
    const globalXisoAvg =
      globalXisoRows.length > 0
        ? globalXisoRows.reduce((sum, rowPoint) => sum + Number(rowPoint.p.iso_value || 0), 0) / globalXisoRows.length
        : 0.17;

    const globalSwingRate = globalPitchCount > 0 ? globalSwingCount / globalPitchCount : 0;
    const globalWhiffRate = globalSwingCount > 0 ? globalWhiffCount / globalSwingCount : 0;
    const globalSwStrkRate = globalPitchCount > 0 ? globalWhiffCount / globalPitchCount : 0;
    const globalGbRate = globalInPlayCount > 0 ? globalGbCount / globalInPlayCount : 0;
    const globalContactRate = globalSwingCount > 0 ? (globalSwingCount - globalWhiffCount) / globalSwingCount : 0;
    // Applies to Whiff Rate, SwStrk%, GB Rate, Contact Rate, Swing Rate, Exit
    // Velocity, and QP+ -- at the old default of 8, most grid cells (whose
    // real kernel-weighted counts aren't much larger than that) got pulled so
    // hard toward the team-wide average that these heatmaps looked almost
    // entirely white/faded instead of showing real hot/cold zones. RV/100 and
    // PV/100 intentionally keep their own separate, higher shrink strength
    // below (they're rate-of-run-value stats, noisier per-pitch than a simple
    // make/miss count, so they still benefit from stronger smoothing).
    const shrinkStrength = 1;
    const whiffShrinkStrength = 1;
    const runValueShrinkStrength = 0.5;
    const xMetricShrinkStrength = 0;

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
        let qpWSum = 0;
        let qpW = 0;
        let rvWSum = 0;
        let rvW = 0;
        let pvWSum = 0;
        let pvW = 0;
        let xwobaWSum = 0;
        let xwobaW = 0;
        let xisoWSum = 0;
        let xisoW = 0;

        for (const rowPoint of valid) {
          const dx = (cx - rowPoint.x) / sigmaX;
          const dy = (cy - rowPoint.y) / sigmaY;
          const w = Math.exp(-0.5 * (dx * dx + dy * dy));
          if (w < 1e-6) continue;
          const pitchN = pointPitchCount(rowPoint.p);
          sumW += w * pitchN;
          swingW += w * pointSwingCount(rowPoint.p);
          whiffW += w * pointWhiffCount(rowPoint.p);
          inPlayW += w * pointInPlayCount(rowPoint.p);
          gbW += w * pointGbCount(rowPoint.p);
          const evN = pointEvCount(rowPoint.p);
          if (evN > 0) {
            evWSum += w * pointEvSum(rowPoint.p);
            evW += w * evN;
          }
          const qpN = pointQpCount(rowPoint.p);
          if (qpN > 0) {
            qpWSum += w * pointQpSum(rowPoint.p);
            qpW += w * qpN;
          }
          rvWSum += w * pointRvSum(rowPoint.p);
          rvW += w * pitchN;
          pvWSum += w * pointPvSum(rowPoint.p);
          pvW += w * pitchN;
          const xwobaN = pointXwobaCount(rowPoint.p);
          if (xwobaN > 0) {
            xwobaWSum += w * pointXwobaSum(rowPoint.p);
            xwobaW += w * xwobaN;
          }
          const xisoN = pointXisoCount(rowPoint.p);
          if (xisoN > 0) {
            xisoWSum += w * pointXisoSum(rowPoint.p);
            xisoW += w * xisoN;
          }
        }

        let value = sumW;
        if (metric === 'Whiff Rate') value = 100 * ((whiffW + whiffShrinkStrength * globalWhiffRate) / Math.max(eps, swingW + whiffShrinkStrength));
        if (metric === 'SwStrk%') value = 100 * ((whiffW + whiffShrinkStrength * globalSwStrkRate) / Math.max(eps, sumW + whiffShrinkStrength));
        if (metric === 'GB Rate') value = 100 * ((gbW + shrinkStrength * globalGbRate) / Math.max(eps, inPlayW + shrinkStrength));
        if (metric === 'Contact Rate') value = 100 * (((swingW - whiffW) + shrinkStrength * globalContactRate) / Math.max(eps, swingW + shrinkStrength));
        if (metric === 'Swing Rate') value = 100 * ((swingW + shrinkStrength * globalSwingRate) / Math.max(eps, sumW + shrinkStrength));
        if (metric === 'Exit Velocity') value = (evWSum + shrinkStrength * globalEvAvg) / Math.max(eps, evW + shrinkStrength);
        if (metric === 'QP+') value = (qpWSum + shrinkStrength * globalQpAvg) / Math.max(eps, qpW + shrinkStrength);
        if (metric === 'RV/100' || metric === 'Run Values') {
          value = ((rvWSum + runValueShrinkStrength * globalRvAvg) / Math.max(eps, sumW + runValueShrinkStrength)) * 100;
        }
        if (metric === 'PV/100') {
          value = ((pvWSum + runValueShrinkStrength * globalPvAvg) / Math.max(eps, pvW + runValueShrinkStrength)) * 100;
        }
        if (metric === 'xWOBA') {
          value =
            xwobaW > eps
              ? (xwobaWSum + xMetricShrinkStrength * globalXwobaAvg) / Math.max(eps, xwobaW + xMetricShrinkStrength)
              : globalXwobaAvg;
        }
        if (metric === 'xISO') {
          value =
            xisoW > eps
              ? (xisoWSum + xMetricShrinkStrength * globalXisoAvg) / Math.max(eps, xisoW + xMetricShrinkStrength)
              : globalXisoAvg;
        }
        cells.push({ x: xMin + col * cellW, y: yMin + row * cellH, w: cellW, h: cellH, value, density: sumW });
      }
    }
    if (metric === 'Frequency') {
      const maxVal = Math.max(...cells.map((c) => c.value), eps);
      for (const c of cells) c.value = (100 * c.value) / maxVal;
    }
    return cells;
  };

  const buildQpPresetCells = (
    pitchType: string,
    handValue: string,
    countBucket: 'Ahead' | 'Even' | 'Behind'
  ): HeatCell[] => {
    const xMin = -2.5;
    const xMax = 2.5;
    const yMin = 0;
    const yMax = 4.5;
    const cols = 40;
    const rows = 40;
    const cellW = (xMax - xMin) / cols;
    const cellH = (yMax - yMin) / rows;
    const zoneMidY = (1.5 + 3.6) / 2;
    const compLeft = -1.5;
    const compRight = 1.5;
    const compBottom = zoneMidY - 1.5;
    const compTop = zoneMidY + 1.5;
    const normalizedHand = handValue.toLowerCase().startsWith('l') ? 'Left' : 'Right';
    const gloveCol = normalizedHand === 'Left' ? 3 : 1;
    const armCol = gloveCol === 3 ? 1 : 3;
    const cMid = 2;
    const rTop = 1;
    const rMid = 2;
    const rBot = 3;
    const seedMap: Record<string, Array<[number, number, number]>> = {
      Fastball: [[rTop, cMid, 1.0], [rTop, gloveCol, 1.0], [rTop, armCol, 1.0]],
      Sinker: [[rBot, cMid, 0.8], [rBot, armCol, 1.0], [rBot, gloveCol, 0.9]],
      Cutter: [[rMid, gloveCol, 1.0], [rTop, gloveCol, 1.0], [rTop, cMid, 0.75], [rBot, gloveCol, 0.8]],
      Slider: [[rBot, gloveCol, 1.0], [rBot, cMid, 0.8], [rMid, gloveCol, 0.7]],
      Sweeper: [[rBot, gloveCol, 1.0], [rBot, cMid, 0.75], [rMid, gloveCol, 0.65]],
      Curveball: [[rBot, cMid, 1.0], [rBot, gloveCol, 1.0], [rBot, armCol, 1.0]],
      ChangeUp: [[rBot, cMid, 1.0], [rBot, armCol, 0.9], [rBot, gloveCol, 0.7]],
      Splitter: [[rBot, cMid, 1.0], [rBot, armCol, 1.0], [rBot, gloveCol, 1.0]],
    };
    const seeds = seedMap[pitchType] ?? [[rMid, cMid, 0.6]];
    const decay = countBucket === 'Ahead' ? [1.0, 0.35, 0.15, 0.05] : countBucket === 'Even' ? [1.0, 0.55, 0.25, 0.1] : [1.0, 0.75, 0.45, 0.2];

    const zone9Square = (x: number, y: number): number | null => {
      if (!(compLeft <= x && x <= compRight && compBottom <= y && y <= compTop)) return null;
      const w = compRight - compLeft;
      const h = compTop - compBottom;
      const gx = Math.min(Math.max((x - compLeft) / w, 0), 1);
      const gy = Math.min(Math.max((y - compBottom) / h, 0), 1);
      const col = gx < 1 / 3 ? 1 : gx < 2 / 3 ? 2 : 3;
      const row = gy >= 2 / 3 ? 1 : gy >= 1 / 3 ? 2 : 3;
      return (row - 1) * 3 + col;
    };
    const sqToRc = (sq: number) => ({ row: Math.floor((sq - 1) / 3) + 1, col: ((sq - 1) % 3) + 1 });

    const cells: HeatCell[] = [];
    for (let row = 0; row < rows; row += 1) {
      const cy = yMin + (row + 0.5) * cellH;
      for (let col = 0; col < cols; col += 1) {
        const cx = xMin + (col + 0.5) * cellW;
        const sq = zone9Square(cx, cy);
        let weight = 0;
        if (sq !== null) {
          const rc = sqToRc(sq);
          for (const [sr, sc, sw] of seeds) {
            const d = Math.abs(sr - rc.row) + Math.abs(sc - rc.col);
            const di = d >= 3 ? 3 : d;
            weight = Math.max(weight, sw * decay[di]);
          }
        }
        cells.push({
          x: xMin + col * cellW,
          y: yMin + row * cellH,
          w: cellW,
          h: cellH,
          value: weight * 200.0,
          density: 1,
        });
      }
    }
    return cells;
  };

  const releaseSvg = useMemo(() => {
    const w = 400;
    const h = 360;
    const margin = { top: 4, right: 14, bottom: 16, left: 18 };
    const xMin = -4;
    const xMax = 4;
    const yMin = 0;
    const maxReleaseHeight = Math.max(...summaryPoints.map((p) => p.release_height ?? 0), 0);
    const yMax = Math.max(6, Math.ceil(maxReleaseHeight));
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    const xRange = xMax - xMin;
    const yRange = yMax - yMin;
    const scale = Math.min(plotW / xRange, plotH / yRange);
    const drawnW = xRange * scale;
    const drawnH = yRange * scale;
    const leftPad = margin.left + (plotW - drawnW) / 2;
    const topPad = margin.top + (plotH - drawnH) / 2;
    const px = (x: number) => leftPad + (x - xMin) * scale;
    const py = (y: number) => topPad + (yMax - y) * scale;
    const showPitches = releaseView === 'Averages and Pitches' || releaseView === 'Pitches';
    const showAverages = releaseView === 'Averages Only' || releaseView === 'Averages and Pitches';
    const moundX = Array.from({ length: 81 }, (_, i) => -4 + (i / 80) * 8);
    const moundPts = [...moundX.map((x) => `${px(x)},${py(0.83 * (1 - (x / 4) ** 2))}`), ...moundX.slice().reverse().map((x) => `${px(x)},${py(0)}`)].join(' ');
    const rubberLeft = px(-1);
    const rubberRight = px(1);
    const rubberTop = py(0.9);
    const rubberBottom = py(0.76);
    const xTicks = [-4, -2, 0, 2, 4];
    const yTicks = Array.from({ length: Math.max(1, Math.floor(yMax - yMin) + 1) }, (_, i) => yMin + i);
    const plottedPitches = summaryPoints.filter((p) => p.release_side !== null && p.release_height !== null);
    const toSvgPoint = (event: { clientX: number; clientY: number; currentTarget: SVGSVGElement }) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * w,
        y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * h,
      };
    };
    const finishLasso = (box: PlotLasso) => {
      if (!box) return;
      const minX = Math.min(box.startX, box.endX);
      const maxX = Math.max(box.startX, box.endX);
      const minY = Math.min(box.startY, box.endY);
      const maxY = Math.max(box.startY, box.endY);
      if (maxX - minX < 3 || maxY - minY < 3) return;
      const selected = plottedPitches.filter((pitch) => {
        const x = px(orientX(Number(pitch.release_side), pitch.school_code));
        const y = py(Number(pitch.release_height));
        return x >= minX && x <= maxX && y >= minY && y <= maxY;
      });
      if (selected.length) openActionModal(selected);
    };
    return (
      <svg
        className="portal-plot-dark-grid"
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: '100%', height: 360, cursor: isPitchEditLassoEnabled ? 'crosshair' : undefined }}
        onMouseDown={(event) => {
          if (!isPitchEditLassoEnabled) return;
          const next = toSvgPoint(event);
          setReleaseLasso({ startX: next.x, startY: next.y, endX: next.x, endY: next.y, dragging: true });
        }}
        onMouseMove={(event) => {
          if (!isPitchEditLassoEnabled || !releaseLasso?.dragging) return;
          const next = toSvgPoint(event);
          setReleaseLasso((current) => (current ? { ...current, endX: next.x, endY: next.y } : current));
        }}
        onMouseUp={(event) => {
          if (!isPitchEditLassoEnabled || !releaseLasso?.dragging) return;
          const next = toSvgPoint(event);
          const finalized = { ...releaseLasso, endX: next.x, endY: next.y };
          setReleaseLasso(null);
          finishLasso(finalized);
        }}
        onMouseLeave={() => {
          setReleaseHover(null);
          if (releaseLasso?.dragging) setReleaseLasso(null);
        }}
      >
        {xTicks.map((tick) => (
          <line key={`r-x-grid-${tick}`} x1={px(tick)} y1={py(yMin)} x2={px(tick)} y2={py(yMax)} stroke="rgba(255,255,255,0.18)" />
        ))}
        {yTicks.map((tick) => (
          <line key={`r-y-grid-${tick}`} x1={px(xMin)} y1={py(tick)} x2={px(xMax)} y2={py(tick)} stroke="rgba(255,255,255,0.18)" />
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
          <text key={`r-x-label-${tick}`} x={px(tick)} y={py(yMin) + 12} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.9)">
            {tick}
          </text>
        ))}
        {yTicks.map((tick) => (
          <text key={`r-y-label-${tick}`} x={px(xMin) - 8} y={py(tick) + 3.5} textAnchor="end" fontSize={10.5} fill="rgba(255,255,255,0.9)">
            {tick}
          </text>
        ))}
        {showPitches
          ? plottedPitches
              .filter((p) => Number.isFinite(Number(p.release_side)) && Number.isFinite(Number(p.release_height)))
              .map((p, i) => (
                <circle
                  key={`r-p-${i}`}
                  cx={px(orientX(Number(p.release_side), p.school_code))}
                  cy={py(Number(p.release_height))}
                  r={3.2}
                  fill={pitchColors[p.pitch_type] ?? '#9ca3af'}
                  stroke="rgba(0,0,0,0.52)"
                  strokeWidth={1.1}
                  opacity={0.42}
                  onMouseMove={(event) =>
                    setReleaseHover({
                      x: event.clientX,
                      y: event.clientY,
                      text: releaseTooltipHtml(p),
                      bg: pitchColors[p.pitch_type] ?? '#0f172a',
                    })
                  }
                  onMouseLeave={() => setReleaseHover(null)}
                  onClick={() => {
                    if (isPitchEditLassoEnabled) return;
                    openActionModal(
                      plottedPitches.filter((pt) => Number.isFinite(Number(pt.release_side)) && Number.isFinite(Number(pt.release_height))),
                      p
                    );
                  }}
                />
              ))
          : null}
        {showAverages
          ? avgByType
              .filter((p) => Number.isFinite(Number(p.release_side)) && Number.isFinite(Number(p.release_height)))
              .map((p) => (
                <circle
                  key={`r-a-${p.pitch_type}`}
                  cx={px(Number(p.release_side))}
                  cy={py(Number(p.release_height))}
                  r={8.6}
                  fill={pitchColors[p.pitch_type] ?? '#9ca3af'}
                  stroke="rgba(0,0,0,0.68)"
                  strokeWidth={2.2}
                  opacity={0.98}
                  onMouseMove={(event) =>
                    setReleaseHover({
                      x: event.clientX,
                      y: event.clientY,
                      text: `${p.pitch_type}\nHeight: ${fmt1(p.release_height)} ft\nSide: ${fmt1(Number.isFinite(Number(p.release_side)) ? Number(p.release_side) : null)} ft\nExtension: ${fmt1(p.extension)} ft`,
                      bg: pitchColors[p.pitch_type] ?? '#0f172a',
                    })
                  }
                  onMouseLeave={() => setReleaseHover(null)}
                  onClick={() => {
                    if (isPitchEditLassoEnabled) return;
                    const matched = summaryPoints.filter((sp) => sp.pitch_type === p.pitch_type);
                    if (matched.length) openActionModal(matched);
                  }}
                />
              ))
          : null}
        {isPitchEditLassoEnabled && releaseLasso ? (
          <rect
            x={Math.min(releaseLasso.startX, releaseLasso.endX)}
            y={Math.min(releaseLasso.startY, releaseLasso.endY)}
            width={Math.abs(releaseLasso.endX - releaseLasso.startX)}
            height={Math.abs(releaseLasso.endY - releaseLasso.startY)}
            fill="rgba(59,130,246,0.16)"
            stroke="rgba(147,197,253,0.95)"
            strokeWidth={1.4}
            pointerEvents="none"
          />
        ) : null}
      </svg>
    );
  }, [summaryPoints, avgByType, releaseView, isPro, isPitchEditLassoEnabled, releaseLasso, visualOption, canUsePitchEdits]);

  const movementSvg = useMemo(() => {
    const w = 400;
    const h = 360;
    const margin = { top: 4, right: 0, bottom: 26, left: 18 };
    const xMin = -25;
    const xMax = 25;
    const yMin = -25;
    const yMax = 25;
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    const xRange = xMax - xMin;
    const yRange = yMax - yMin;
    const scale = Math.min(plotW / xRange, plotH / yRange);
    const drawnW = xRange * scale;
    const drawnH = yRange * scale;
    const leftPad = margin.left + (plotW - drawnW) / 2;
    const topPad = margin.top + (plotH - drawnH) / 2;
    const px = (x: number) => leftPad + (x - xMin) * scale;
    const py = (y: number) => topPad + (yMax - y) * scale;
    const showActualOnly = movementView === 'Actual Movement — Individual Pitches';
    const showMagnusOnly = movementView === 'Magnus Movement — Individual Pitches';
    const showPitches =
      movementView === 'Averages and Pitches'
      || movementView === 'Target Shapes and Pitches'
      || showActualOnly;
    const showAverages = movementView === 'Averages Only' || movementView === 'Averages and Pitches';
    const showExpectedAverages = movementView === 'Expected vs Actual — Averages';
    const showExpectedPitches = movementView === 'Expected vs Actual — Individual Pitches';
    const showTargets = movementView === 'Target Shapes Only' || movementView === 'Target Shapes and Pitches';
    const ticks = [-20, -10, 0, 10, 20];
    // Break lines: offsets come from break_line_offsets_grid, a precomputed
    // table of "what does an average off-speed pitch look like relative to
    // THIS shape of fastball/sinker" (see scripts/refresh_break_line_offsets_grid.py),
    // replacing the old flat population-wide offset constants. Grid offsets
    // are stored in "righty space" (LHP horizontal break mirrored before
    // aggregation, matching normalizeForHandedness()'s -value-for-LHP
    // convention) -- so un-mirror avg_hb_offset back to this pitcher's own
    // hand for display by negating it only when plottedPitcherHand is Left.
    const baseType = breakLines === 'Fastball' || breakLines === 'Sinker' ? breakLines : '';
    const base = avgByType.find((p) => p.pitch_type === baseType);
    const handSign = plottedPitcherHand === 'Left' ? -1 : 1;
    const breakRows = base && base.hb !== null && base.ivb !== null
      ? breakLineOffsets
          .filter((row) => avgByType.some((a) => a.pitch_type === row.offspeed_pitch_type))
          .map((row) => ({
            pitch_type: row.offspeed_pitch_type,
            x1: Number(base.hb),
            y1: Number(base.ivb),
            x2: Number(base.hb) + row.avg_hb_offset * handSign,
            y2: Number(base.ivb) + row.avg_ivb_offset,
          }))
      : [];
    const plottedPitches = (
      showExpectedPitches || showMagnusOnly ? expectedMovementData.eligiblePoints : summaryPoints
    ).filter(
      (point) =>
        typeof point.hb === 'number' &&
        Number.isFinite(point.hb) &&
        typeof point.ivb === 'number' &&
        Number.isFinite(point.ivb)
    );
    const playerPitchTypeTokens = new Set(
      avgByType
        .filter((p) => p.pitch_type && p.pitch_type !== 'Undefined')
        .map((p) => normalizeNameToken(p.pitch_type))
    );
    const fullMagnusLineAverage =
      magnusLine === 'Off'
        ? null
        : fullMagnusAveragesByPitchType.get(normalizeNameToken(magnusLine)) ?? null;
    const magnusLineAverage =
      magnusLine === 'Off'
        ? null
        : fullMagnusLineAverage
          ?? expectedMovementData.averages.find((row) => row.pitch_type === magnusLine)
          ?? null;
    const magnusLineAngle = magnusLineAverage
      ? fullMagnusLineAverage?.magnus_angle
        ?? magnusAngleDegrees(magnusLineAverage.expected_ivb, magnusLineAverage.expected_hb)
      : null;
    const magnusLineEndpoints = (() => {
      if (!magnusLineAverage) return null;
      const vectorX = magnusLineAverage.expected_hb;
      const vectorY = magnusLineAverage.expected_ivb;
      if (!Number.isFinite(vectorX) || !Number.isFinite(vectorY)) return null;
      const xScale = Math.abs(vectorX) > 1e-9 ? xMax / Math.abs(vectorX) : Number.POSITIVE_INFINITY;
      const yScale = Math.abs(vectorY) > 1e-9 ? yMax / Math.abs(vectorY) : Number.POSITIVE_INFINITY;
      const endpointScale = Math.min(xScale, yScale);
      if (!Number.isFinite(endpointScale)) return null;
      return {
        x1: -vectorX * endpointScale,
        y1: -vectorY * endpointScale,
        x2: vectorX * endpointScale,
        y2: vectorY * endpointScale,
      };
    })();
    const comparisonMagnusLineAverage =
      showComparisonMagnusLine && magnusLine !== 'Off'
        ? movementComparisonAveragesByPitchType.get(normalizeNameToken(magnusLine)) ?? null
        : null;
    const comparisonMagnusLineAngle =
      comparisonMagnusLineAverage
      && Number.isFinite(comparisonMagnusLineAverage.expected_ivb)
      && Number.isFinite(comparisonMagnusLineAverage.expected_hb)
        ? comparisonMagnusLineAverage.magnus_angle
          ?? magnusAngleDegrees(
            comparisonMagnusLineAverage.expected_ivb as number,
            comparisonMagnusLineAverage.expected_hb as number
          )
        : null;
    const comparisonMagnusLineEndpoints = (() => {
      if (!comparisonMagnusLineAverage) return null;
      const rawX = comparisonMagnusLineAverage.expected_hb;
      const rawY = comparisonMagnusLineAverage.expected_ivb;
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;
      const vectorX: number = rawX as number;
      const vectorY: number = rawY as number;
      const xScale = Math.abs(vectorX) > 1e-9 ? xMax / Math.abs(vectorX) : Number.POSITIVE_INFINITY;
      const yScale = Math.abs(vectorY) > 1e-9 ? yMax / Math.abs(vectorY) : Number.POSITIVE_INFINITY;
      const endpointScale = Math.min(xScale, yScale);
      if (!Number.isFinite(endpointScale)) return null;
      return {
        x1: -vectorX * endpointScale,
        y1: -vectorY * endpointScale,
        x2: vectorX * endpointScale,
        y2: vectorY * endpointScale,
      };
    })();
    const expectedTooltip = (
      point: OverviewPayload['chart_points'][number],
      label = point.pitch_type
    ) => {
      const actualHb = Number(point.hb);
      const actualIvb = Number(point.ivb);
      const expectedHb = Number(point.expected_hb);
      const expectedIvb = Number(point.expected_ivb);
      const deltaHb = actualHb - expectedHb;
      const deltaIvb = actualIvb - expectedIvb;
      const residual = Math.hypot(deltaHb, deltaIvb);
      return `${label}\nActual IVB: ${fmt1(actualIvb)} in | HB: ${fmt1(actualHb)} in\nMagnus IVB: ${fmt1(expectedIvb)} in | HB: ${fmt1(expectedHb)} in\nActual − Magnus: IVB ${fmt1(deltaIvb)} in | HB ${fmt1(deltaHb)} in\nResidual: ${fmt1(residual)} in`;
    };
    const toSvgPoint = (event: { clientX: number; clientY: number; currentTarget: SVGSVGElement }) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * w,
        y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * h,
      };
    };
    const finishLasso = (box: PlotLasso) => {
      if (!box) return;
      const minX = Math.min(box.startX, box.endX);
      const maxX = Math.max(box.startX, box.endX);
      const minY = Math.min(box.startY, box.endY);
      const maxY = Math.max(box.startY, box.endY);
      if (maxX - minX < 3 || maxY - minY < 3) return;
      const selected = plottedPitches.filter((pitch) => {
        const hb = Number(showMagnusOnly ? pitch.expected_hb : pitch.hb);
        const ivb = Number(showMagnusOnly ? pitch.expected_ivb : pitch.ivb);
        if (!Number.isFinite(hb) || !Number.isFinite(ivb)) return false;
        const x = px(hb);
        const y = py(ivb);
        return x >= minX && x <= maxX && y >= minY && y <= maxY;
      });
      if (selected.length) openActionModal(selected);
    };
    return (
      <svg
        className="portal-plot-dark-grid"
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: '100%', height: 360, cursor: isPitchEditLassoEnabled ? 'crosshair' : undefined }}
        onMouseDown={(event) => {
          if (!isPitchEditLassoEnabled) return;
          const next = toSvgPoint(event);
          setMovementLasso({ startX: next.x, startY: next.y, endX: next.x, endY: next.y, dragging: true });
        }}
        onMouseMove={(event) => {
          if (!isPitchEditLassoEnabled || !movementLasso?.dragging) return;
          const next = toSvgPoint(event);
          setMovementLasso((current) => (current ? { ...current, endX: next.x, endY: next.y } : current));
        }}
        onMouseUp={(event) => {
          if (!isPitchEditLassoEnabled || !movementLasso?.dragging) return;
          const next = toSvgPoint(event);
          const finalized = { ...movementLasso, endX: next.x, endY: next.y };
          setMovementLasso(null);
          finishLasso(finalized);
        }}
        onMouseLeave={() => {
          setMovementHover(null);
          if (movementLasso?.dragging) setMovementLasso(null);
        }}
      >
        {ticks.map((tick) => (
          <line key={`m-x-grid-${tick}`} x1={px(tick)} y1={py(yMin)} x2={px(tick)} y2={py(yMax)} stroke="rgba(255,255,255,0.18)" />
        ))}
        {ticks.map((tick) => (
          <line key={`m-y-grid-${tick}`} x1={px(xMin)} y1={py(tick)} x2={px(xMax)} y2={py(tick)} stroke="rgba(255,255,255,0.18)" />
        ))}
        <line x1={px(xMin)} y1={py(0)} x2={px(xMax)} y2={py(0)} stroke="rgba(255,255,255,0.85)" />
        <line x1={px(0)} y1={py(yMin)} x2={px(0)} y2={py(yMax)} stroke="rgba(255,255,255,0.85)" />
        {ticks.map((tick) => (
          <text key={`m-x-label-${tick}`} x={px(tick)} y={py(yMin) + 12} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.9)">
            {tick}
          </text>
        ))}
        {ticks.map((tick) => (
          <text key={`m-y-label-${tick}`} x={px(xMin) - 8} y={py(tick) + 3.5} textAnchor="end" fontSize={10.5} fill="rgba(255,255,255,0.9)">
            {tick}
          </text>
        ))}
        {showMagnusAngle && magnusLineAngle !== null ? (
          <text
            x={px(xMin)}
            y={topPad + 10}
            textAnchor="start"
            fontSize={9.5}
            fontStyle="italic"
            fill={pitchColors[magnusLine] ?? 'rgba(255,255,255,0.85)'}
          >
            Magnus Angle: {magnusLineAngle.toFixed(1)}°
          </text>
        ) : null}
        {showMagnusAngle && showComparisonMagnusLine && comparisonMagnusLineAngle !== null ? (
          <text
            x={px(xMin)}
            y={topPad + 23}
            textAnchor="start"
            fontSize={9.5}
            fontStyle="italic"
            fill="#a3e635"
          >
            {comparisonScopeLabel} Magnus Angle: {comparisonMagnusLineAngle.toFixed(1)}°
          </text>
        ) : null}
        {magnusLineEndpoints && magnusLine !== 'Off' ? (
          <g pointerEvents="none">
            <line
              x1={px(magnusLineEndpoints.x1)}
              y1={py(magnusLineEndpoints.y1)}
              x2={px(magnusLineEndpoints.x2)}
              y2={py(magnusLineEndpoints.y2)}
              stroke={pitchColors[magnusLine] ?? '#e2e8f0'}
              strokeWidth={2}
              strokeDasharray="7 6"
              opacity={0.72}
            />
          </g>
        ) : null}
        {comparisonMagnusLineEndpoints && magnusLine !== 'Off' ? (
          <g pointerEvents="none">
            <line
              x1={px(comparisonMagnusLineEndpoints.x1)}
              y1={py(comparisonMagnusLineEndpoints.y1)}
              x2={px(comparisonMagnusLineEndpoints.x2)}
              y2={py(comparisonMagnusLineEndpoints.y2)}
              stroke="#a3e635"
              strokeWidth={2}
              strokeDasharray="2 3"
              opacity={0.85}
            />
          </g>
        ) : null}
        {showPitches
          ? plottedPitches
              .filter((p) => Number.isFinite(Number(p.hb)) && Number.isFinite(Number(p.ivb)))
              .map((p, i) => (
                <circle
                  key={`m-p-${i}`}
                  cx={px(Number(p.hb))}
                  cy={py(Number(p.ivb))}
                  r={3.8}
                  fill={pitchColors[p.pitch_type] ?? '#9ca3af'}
                  stroke="rgba(0,0,0,0.52)"
                  strokeWidth={1.1}
                  opacity={0.42}
                  onMouseMove={(event) =>
                    setMovementHover({
                      x: event.clientX,
                      y: event.clientY,
                      text: tooltipHtml(p),
                      bg: pitchColors[p.pitch_type] ?? '#0f172a',
                    })
                  }
                  onMouseLeave={() => setMovementHover(null)}
                  onClick={() => {
                    if (isPitchEditLassoEnabled) return;
                    openActionModal(
                      plottedPitches.filter((pt) => Number.isFinite(Number(pt.hb)) && Number.isFinite(Number(pt.ivb))),
                      p
                    );
                  }}
                />
              ))
          : null}
        {showExpectedPitches
          ? expectedMovementData.eligiblePoints.map((point, index) => {
              const color = pitchColors[point.pitch_type] ?? '#9ca3af';
              return (
                <g
                  key={`m-expected-pair-${point.pitch_event_id ?? point.pitch_uid ?? index}`}
                  className="portal-movement-pair"
                  onMouseMove={(event) =>
                    setMovementHover({
                      x: event.clientX,
                      y: event.clientY,
                      text: expectedTooltip(point),
                      bg: color,
                    })
                  }
                  onMouseLeave={() => setMovementHover(null)}
                  onClick={() => {
                    if (isPitchEditLassoEnabled) return;
                    openActionModal(expectedMovementData.eligiblePoints, point);
                  }}
                >
                  <circle
                    className="portal-movement-pair-marker portal-movement-pair-actual"
                    cx={px(Number(point.hb))}
                    cy={py(Number(point.ivb))}
                    r={3.8}
                    fill={color}
                    stroke="rgba(0,0,0,0.58)"
                    strokeWidth={1}
                    opacity={0.5}
                  />
                  <circle
                    className="portal-movement-pair-marker portal-movement-pair-expected"
                    cx={px(Number(point.expected_hb))}
                    cy={py(Number(point.expected_ivb))}
                    r={3.4}
                    fill="rgba(0,0,0,0.18)"
                    stroke={color}
                    strokeWidth={1.4}
                    opacity={0.72}
                  />
                </g>
              );
            })
          : null}
        {showMagnusOnly
          ? expectedMovementData.eligiblePoints.map((point, index) => {
              const color = pitchColors[point.pitch_type] ?? '#9ca3af';
              return (
                <circle
                  key={`m-magnus-p-${point.pitch_event_id ?? point.pitch_uid ?? index}`}
                  cx={px(Number(point.expected_hb))}
                  cy={py(Number(point.expected_ivb))}
                  r={3.8}
                  fill="rgba(0,0,0,0.18)"
                  stroke={color}
                  strokeWidth={1.5}
                  opacity={0.76}
                  onMouseMove={(event) =>
                    setMovementHover({
                      x: event.clientX,
                      y: event.clientY,
                      text: expectedTooltip(point),
                      bg: color,
                    })
                  }
                  onMouseLeave={() => setMovementHover(null)}
                  onClick={() => {
                    if (isPitchEditLassoEnabled) return;
                    openActionModal(expectedMovementData.eligiblePoints, point);
                  }}
                />
              );
            })
          : null}
        {showAverages
          ? avgByType
              .filter((p) => Number.isFinite(Number(p.hb)) && Number.isFinite(Number(p.ivb)))
              .map((p) => (
                <circle
                  key={`m-a-${p.pitch_type}`}
                  cx={px(Number(p.hb))}
                  cy={py(Number(p.ivb))}
                  r={8.6}
                  fill={pitchColors[p.pitch_type] ?? '#9ca3af'}
                  stroke="rgba(0,0,0,0.68)"
                  strokeWidth={2.2}
                  opacity={0.98}
                  onMouseMove={(event) =>
                    setMovementHover({
                      x: event.clientX,
                      y: event.clientY,
                      text: `${p.pitch_type}\nVelo: ${fmt1(p.velo)} mph\nIVB: ${fmt1(p.ivb)} in\nHB: ${fmt1(p.hb)} in\nStuff+: ${fmt1(p.stuff_plus)}`,
                      bg: pitchColors[p.pitch_type] ?? '#0f172a',
                    })
                  }
                  onMouseLeave={() => setMovementHover(null)}
                  onClick={() => {
                    if (isPitchEditLassoEnabled) return;
                    const matched = summaryPoints.filter((sp) => sp.pitch_type === p.pitch_type);
                    if (matched.length) openActionModal(matched);
                  }}
                />
              ))
          : null}
        {showExpectedAverages
          ? expectedMovementData.averages.map((row) => {
              const color = pitchColors[row.pitch_type] ?? '#9ca3af';
              const deltaHb = row.hb - row.expected_hb;
              const deltaIvb = row.ivb - row.expected_ivb;
              const tooltip =
                `${row.pitch_type} (${row.count} matched pitches)` +
                `\nActual IVB: ${fmt1(row.ivb)} in | HB: ${fmt1(row.hb)} in` +
                `\nMagnus IVB: ${fmt1(row.expected_ivb)} in | HB: ${fmt1(row.expected_hb)} in` +
                `\nActual − Magnus: IVB ${fmt1(deltaIvb)} in | HB ${fmt1(deltaHb)} in` +
                `\nResidual: ${fmt1(Math.hypot(deltaHb, deltaIvb))} in`;
              const matched = expectedMovementData.eligiblePoints.filter(
                (point) => point.pitch_type === row.pitch_type
              );
              return (
                <g
                  key={`m-expected-average-${row.pitch_type}`}
                  className="portal-movement-pair"
                  onMouseMove={(event) =>
                    setMovementHover({
                      x: event.clientX,
                      y: event.clientY,
                      text: tooltip,
                      bg: color,
                    })
                  }
                  onMouseLeave={() => setMovementHover(null)}
                  onClick={() => {
                    if (isPitchEditLassoEnabled || !matched.length) return;
                    openActionModal(matched);
                  }}
                >
                  <circle
                    className="portal-movement-pair-marker portal-movement-pair-actual"
                    cx={px(row.hb)}
                    cy={py(row.ivb)}
                    r={8.6}
                    fill={color}
                    stroke="rgba(0,0,0,0.68)"
                    strokeWidth={2.2}
                    opacity={0.98}
                  />
                  <circle
                    className="portal-movement-pair-marker portal-movement-pair-expected"
                    cx={px(row.expected_hb)}
                    cy={py(row.expected_ivb)}
                    r={8.6}
                    fill="rgba(0,0,0,0.76)"
                    stroke={color}
                    strokeWidth={2.6}
                    strokeDasharray="3 2"
                    opacity={0.98}
                  />
                </g>
              );
            })
          : null}
        {showComparisonDots
          ? Array.from(movementComparisonAveragesByPitchType.values())
              .filter((row) => playerPitchTypeTokens.has(normalizeNameToken(row.pitch_type)))
              .map((row) => {
              const color = '#a3e635';
              const hasActual = Number.isFinite(row.actual_hb) && Number.isFinite(row.actual_ivb);
              const hasExpected = Number.isFinite(row.expected_hb) && Number.isFinite(row.expected_ivb);
              if (!hasActual && !hasExpected) return null;
              const tooltip =
                `${row.pitch_type} — ${comparisonScopeLabel} average (not this player)` +
                (hasActual ? `\nActual IVB: ${fmt1(row.actual_ivb)} in | HB: ${fmt1(row.actual_hb)} in` : '') +
                (hasExpected ? `\nMagnus IVB: ${fmt1(row.expected_ivb)} in | HB: ${fmt1(row.expected_hb)} in` : '');
              return (
                <g
                  key={`m-comparison-${row.pitch_type}`}
                  className="portal-movement-comparison"
                  onMouseMove={(event) =>
                    setMovementHover({ x: event.clientX, y: event.clientY, text: tooltip, bg: color })
                  }
                  onMouseLeave={() => setMovementHover(null)}
                >
                  {hasActual ? (
                    <circle
                      cx={px(Number(row.actual_hb))}
                      cy={py(Number(row.actual_ivb))}
                      r={8.6}
                      fill={color}
                      stroke="rgba(0,0,0,0.68)"
                      strokeWidth={2.2}
                      opacity={0.98}
                    />
                  ) : null}
                  {hasExpected ? (
                    <circle
                      cx={px(Number(row.expected_hb))}
                      cy={py(Number(row.expected_ivb))}
                      r={8.6}
                      fill="rgba(0,0,0,0.76)"
                      stroke={color}
                      strokeWidth={2.6}
                      strokeDasharray="3 2"
                      opacity={0.98}
                    />
                  ) : null}
                </g>
              );
            })
          : null}
        {breakRows.map((row) => (
          <line key={`br-${row.pitch_type}`} x1={px(row.x1)} y1={py(row.y1)} x2={px(row.x2)} y2={py(row.y2)} stroke={pitchColors[row.pitch_type] ?? '#9ca3af'} strokeWidth={3.2} />
        ))}
        {showTargets
          ? avgByType
              .filter((p) => p.pitch_type !== 'Undefined')
              .map((p) => {
                const target = targetShapes[p.pitch_type];
                const hb = target?.hb ?? null;
                const ivb = target?.ivb ?? null;
                if (hb === null || ivb === null) return null;
                return (
                <g key={`m-t-${p.pitch_type}`}>
                  <circle cx={px(Number(hb))} cy={py(Number(ivb))} r={12} fill={pitchColors[p.pitch_type] ?? '#9ca3af'} opacity={0.1} />
                  <circle
                    cx={px(Number(hb))}
                    cy={py(Number(ivb))}
                    r={12}
                    fill="none"
                    stroke={pitchColors[p.pitch_type] ?? '#9ca3af'}
                    strokeWidth={2}
                    opacity={0.85}
                    onMouseMove={(event) =>
                      setMovementHover({
                        x: event.clientX,
                        y: event.clientY,
                        text: `${p.pitch_type} Target\nIVB: ${Number(ivb).toFixed(1)}\nHB: ${Number(hb).toFixed(1)}`,
                        bg: pitchColors[p.pitch_type] ?? '#0f172a',
                      })
                    }
                    onMouseLeave={() => setMovementHover(null)}
                    onClick={() => {
                      if (isPitchEditLassoEnabled) return;
                      const matched = summaryPoints.filter((sp) => sp.pitch_type === p.pitch_type);
                      if (matched.length) openActionModal(matched);
                    }}
                  />
                </g>
                );
              })
          : null}
        {isPitchEditLassoEnabled && movementLasso ? (
          <rect
            x={Math.min(movementLasso.startX, movementLasso.endX)}
            y={Math.min(movementLasso.startY, movementLasso.endY)}
            width={Math.abs(movementLasso.endX - movementLasso.startX)}
            height={Math.abs(movementLasso.endY - movementLasso.startY)}
            fill="rgba(59,130,246,0.16)"
            stroke="rgba(147,197,253,0.95)"
            strokeWidth={1.4}
            pointerEvents="none"
          />
        ) : null}
      </svg>
    );
  }, [summaryPoints, avgByType, expectedMovementData, fullMagnusAveragesByPitchType, movementComparisonAveragesByPitchType, showComparisonDots, showComparisonMagnusLine, comparisonScopeLabel, movementView, magnusLine, showMagnusAngle, breakLines, breakLineOffsets, plottedPitcherHand, targetShapes, isPitchEditLassoEnabled, movementLasso, visualOption, canUsePitchEdits]);

  const locationSvg = useMemo(() => {
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
    // Competitive box is 18 inches (1.5 ft) from strike-zone center on both axes.
    const compRadiusFt = 1.5;
    const strikeCenterX = (strikeLeft + strikeRight) / 2;
    const strikeCenterY = (strikeBottom + strikeTop) / 2;
    const compBottom = strikeCenterY - compRadiusFt;
    const compTop = strikeCenterY + compRadiusFt;
    const compLeft = strikeCenterX - compRadiusFt;
    const compRight = strikeCenterX + compRadiusFt;
    const zoom = locationView === 'Pitch' ? 1 : 1.2;
    const zoomTransform = `translate(${w / 2} ${h / 2}) scale(${zoom}) translate(${-w / 2} ${-h / 2})`;
    const isPvMetric = locationView === 'PV/100';
    const heatMetricView = locationView;
    const isRvLikeMetric = (heatMetricView === 'RV/100' || heatMetricView === 'Run Values') || heatMetricView === 'PV/100';
    const cells = locationView === 'Pitch' ? [] : buildHeatCells(summaryHeatmapPoints, 'plate_side', 'plate_height', heatMetricView);
    const values = cells.map((c) => c.value).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const densityMax = Math.max(1e-9, ...cells.map((c) => c.density));
    const dynamicMinVal = values.length ? values[0] : 0;
    const dynamicMaxVal = values.length ? values[values.length - 1] : 1;
    const dynamicMidVal = values.length ? values[Math.floor(values.length / 2)] : 0;
    const fixedScale = getHeatmapFixedScale(heatMetricView, selectedPitchTypes);
    const contactVisibilityScale = heatMetricView === 'Contact Rate' ? getHeatmapFixedScale('Whiff Rate', selectedPitchTypes) : null;
    const minVal = fixedScale?.min ?? dynamicMinVal;
    const maxVal = fixedScale?.max ?? dynamicMaxVal;
    const midVal = fixedScale?.mid ?? dynamicMidVal;
    const maxAbs = Math.max(1e-9, ...cells.map((c) => (Number.isFinite(c.value) ? Math.abs(c.value) : 0)));
    const rvMin = isPvMetric ? -2 : -5;
    const rvMax = isPvMetric ? 2 : 5;
    const locationVisiblePitches = summaryPoints.filter(
      (p) => Number.isFinite(Number(p.plate_side)) && Number.isFinite(Number(p.plate_height))
    );
    const glyph = (
      result: string,
      x: number,
      y: number,
      fill: string,
      key: string,
      title: string,
      point?: PitchActionPoint
    ) => {
      const hoverProps = {
        onMouseMove: (event: { clientX: number; clientY: number }) =>
          setLocationHover({ x: event.clientX, y: event.clientY, text: title, bg: fill }),
        onMouseLeave: () => setLocationHover(null),
        onClick: () => (point ? openActionModal(locationVisiblePitches, point) : undefined),
      };
      if (result === 'Ball') return <circle key={key} cx={x} cy={y} r={8.4} fill="rgba(0,0,0,0.001)" stroke={fill} strokeWidth={2.1} {...hoverProps} />;
      if (result === 'Foul') return <polygon key={key} points={`${x},${y-8.1} ${x-7.3},${y+6.2} ${x+7.3},${y+6.2}`} fill="rgba(0,0,0,0.001)" stroke={fill} strokeWidth={2.1} {...hoverProps} />;
      if (result === 'Whiff') return <text key={key} x={x} y={y + 6.3} fontSize={19} textAnchor="middle" fill={fill} {...hoverProps}>★</text>;
      if (result === 'In Play (Out)') return <polygon key={key} points={`${x},${y-8.1} ${x-7.3},${y+6.2} ${x+7.3},${y+6.2}`} fill={fill} {...hoverProps} />;
      if (result === 'In Play (Hit)' || result === 'Single' || result === 'Double' || result === 'Triple' || result === 'HomeRun') return <rect key={key} x={x - 6.9} y={y - 6.9} width={13.8} height={13.8} fill={fill} {...hoverProps} />;
      if (result === 'Error') return <rect key={key} x={x - 6.9} y={y - 6.9} width={13.8} height={13.8} fill="rgba(0,0,0,0.001)" stroke={fill} strokeWidth={1.9} {...hoverProps} />;
      return <circle key={key} cx={x} cy={y} r={8.4} fill={fill} {...hoverProps} />;
    };
    return (
      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: '100%', height: locationView === 'Pitch' ? 360 : 295 }}
        onMouseLeave={() => setLocationHover(null)}
      >
        <defs>
          <clipPath id="location-zoom-clip">
            <rect x={0} y={0} width={w} height={h} />
          </clipPath>
          <filter id="location-heat-blur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5.4" />
          </filter>
          <filter id="location-heat-blur-rv" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5.4" />
          </filter>
        </defs>
        <g transform={zoomTransform} clipPath="url(#location-zoom-clip)">
        {locationView !== 'Pitch'
          ? (
            <>
              <g filter={isRvLikeMetric ? 'url(#location-heat-blur-rv)' : 'url(#location-heat-blur)'}>
                {cells.map((c) => {
                  if (!Number.isFinite(c.value)) return null;
                  const cx = px(c.x + c.w / 2);
                  const cy = py(c.y + c.h / 2);
                  const radius = Math.max(4.5, c.w * scale * 3.6);
                  const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                  let fill = 'rgba(255,255,255,0.12)';
                  if (locationView === 'Frequency') {
                    fill = sequentialColor(c.value, minVal, maxVal);
                  } else if (isRvLikeMetric) {
                    const rvClamped = Math.max(rvMin, Math.min(rvMax, c.value));
                    fill = divergingColor(rvClamped, rvMin, 0, rvMax);
                  } else {
                    fill = divergingColor(c.value, minVal, midVal, maxVal);
                  }
                  const normalized =
                    isRvLikeMetric
                      ? Math.abs(Math.max(rvMin, Math.min(rvMax, c.value))) / rvMax
                      : heatMetricView === 'Contact Rate' && contactVisibilityScale
                        ? Math.max(
                            0,
                            Math.min(
                              1,
                              ((100 - c.value) - contactVisibilityScale.min) /
                                Math.max(1e-9, contactVisibilityScale.max - contactVisibilityScale.min)
                            )
                          )
                        : Math.max(0, Math.min(1, (c.value - minVal) / Math.max(1e-9, maxVal - minVal)));
                  const runValueBoost = normalized;
                  const isSwingRateView = heatMetricView === 'Swing Rate';
                  const isGbRateView = heatMetricView === 'GB Rate';
                  const isXMetricView = heatMetricView === 'xWOBA' || heatMetricView === 'xISO';
                  if (densityNorm < 0.03) return null;
                  return (
                    <circle
                      key={`blur-${c.x}-${c.y}`}
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill={fill}
                      opacity={
                        Math.max(0.3, runValueBoost * 1.25 * (heatMetricView === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))
                      }
                    />
                  );
                })}
              </g>
              {cells.map((c) => {
                if (!Number.isFinite(c.value)) return null;
                const cx = px(c.x + c.w / 2);
                const cy = py(c.y + c.h / 2);
                const radius = Math.max(1.0, c.w * scale * 0.75);
                const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                let fill = 'rgba(255,255,255,0.12)';
                if (locationView === 'Frequency') {
                  fill = sequentialColor(c.value, minVal, maxVal);
                } else if (isRvLikeMetric) {
                  const rvClamped = Math.max(rvMin, Math.min(rvMax, c.value));
                  fill = divergingColor(rvClamped, rvMin, 0, rvMax);
                } else {
                  fill = divergingColor(c.value, minVal, midVal, maxVal);
                }
                const normalized =
                  isRvLikeMetric
                    ? Math.abs(Math.max(rvMin, Math.min(rvMax, c.value))) / rvMax
                    : heatMetricView === 'Contact Rate' && contactVisibilityScale
                      ? Math.max(
                          0,
                          Math.min(
                            1,
                            ((100 - c.value) - contactVisibilityScale.min) /
                              Math.max(1e-9, contactVisibilityScale.max - contactVisibilityScale.min)
                          )
                        )
                      : Math.max(0, Math.min(1, (c.value - minVal) / Math.max(1e-9, maxVal - minVal)));
                const runValueBoost = normalized;
                const isSwingRateView = heatMetricView === 'Swing Rate';
                const isGbRateView = heatMetricView === 'GB Rate';
                const isXMetricView = heatMetricView === 'xWOBA' || heatMetricView === 'xISO';
                if (densityNorm < 0.03) return null;
                return (
                  <circle
                    key={`core-${c.x}-${c.y}`}
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill="rgba(0,0,0,0.001)"
                    onMouseMove={(event) =>
                      setLocationHover({
                        x: event.clientX,
                        y: event.clientY,
                        text: `${locationView}: ${fmtNum(c.value, locationView === 'xWOBA' || locationView === 'xISO' ? 3 : (isRvLikeMetric || locationView === 'Exit Velocity' ? 2 : 1))}`,
                      })
                    }
                    onMouseLeave={() => setLocationHover(null)}
                  />
                );
              })}
            </>
          )
          : null}
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
        {locationView === 'Pitch'
          ? locationVisiblePitches.map((p, i) => {
              const x = px(orientX(Number(p.plate_side), p.school_code));
              const y = py(Number(p.plate_height));
              const color = pitchColors[p.pitch_type] ?? '#9ca3af';
              const result = resultShape(p.pitch_call, p.play_result, p.school_code);
              return glyph(result, x, y, color, `loc-${i}`, tooltipHtml(p), p);
            })
          : null}
        </g>
      </svg>
    );
  }, [summaryPoints, summaryHeatmapPoints, locationView, isPro, selectedPitchTypes, visualOption, canUsePitchEdits]);

  const locationLegendRange = useMemo(() => {
    if (locationView === 'Pitch') return null;
    const cells = buildHeatCells(summaryHeatmapPoints, 'plate_side', 'plate_height', locationView);
    const values = cells.map((c) => c.value).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const dynamicMinVal = values.length ? values[0] : 0;
    const dynamicMaxVal = values.length ? values[values.length - 1] : 1;
    const fixedScale = getHeatmapFixedScale(locationView, selectedPitchTypes);
    return { min: fixedScale?.min ?? dynamicMinVal, max: fixedScale?.max ?? dynamicMaxVal, isFixed: !!fixedScale };
  }, [summaryHeatmapPoints, locationView, selectedPitchTypes]);

  const heatmapStatOptions = useMemo(
    () => [
      { value: 'Frequency', label: 'Frequency' },
      { value: 'Whiff Rate', label: 'Whiff Rate' },
      { value: 'SwStrk%', label: 'SwStrk%' },
      { value: 'GB Rate', label: 'GB Rate' },
      { value: 'Contact Rate', label: 'Contact Rate' },
      { value: 'Swing Rate', label: 'Swing Rate' },
      { value: 'Exit Velocity', label: 'Exit Velocity' },
      ...(isPro ? ([{ value: 'xWOBA', label: 'xWOBA' }, { value: 'xISO', label: 'xISO' }] as OptionItem[]) : []),
      { value: 'RV/100', label: 'RV/100' },
      { value: 'PV/100', label: 'PV/100' },
      { value: 'QP+', label: 'QP+' },
    ],
    [isPro]
  );
  const summaryHeatmapOptions = useMemo(
    () => [{ value: 'Pitch', label: 'Pitch' }, ...heatmapStatOptions.filter((option) => option.value !== 'QP+')],
    [heatmapStatOptions]
  );
  useEffect(() => {
    if (heatmapStat === 'xBA') setHeatmapStat('xWOBA');
    if (locationView === 'xBA') setLocationView('xWOBA');
  }, [heatmapStat, locationView]);
  const heatmapDisplayView = useMemo(() => {
    if (heatmapChartType === 'Pitch') return 'Pitch';
    if (heatmapChartType === 'QP+') return 'QP+';
    return heatmapStat;
  }, [heatmapChartType, heatmapStat]);
  const canRenderQpHeatmap = useMemo(() => {
    const selectedPitchTypeValues = selectedPitchTypes.filter((value) => value !== 'All');
    const hasSinglePitchType = selectedPitchTypeValues.length === 1;
    const hasPitcherContext = selectedPitchers.some((value) => value !== 'All') || (hand && hand !== 'All');
    const hasHitterContext = selectedHitters.some((value) => value !== 'All') || (batterSide && batterSide !== 'All');
    const selectedCountValues = selectedCountFilters.filter((value) => value !== 'All');
    const countBuckets = selectedCountValues.filter((value) => ['Ahead', 'Even', 'Behind'].includes(value));
    const hasSingleCountBucket = countBuckets.length === 1;
    return hasSinglePitchType && hasPitcherContext && hasHitterContext && hasSingleCountBucket;
  }, [selectedPitchTypes, selectedPitchers, hand, selectedHitters, batterSide, selectedCountFilters]);
  const qpSelectedPitchType = useMemo(() => selectedPitchTypes.filter((value) => value !== 'All')[0] ?? 'Fastball', [selectedPitchTypes]);
  const qpSelectedCountBucket = useMemo(() => {
    const selected = selectedCountFilters.filter((value) => value !== 'All' && ['Ahead', 'Even', 'Behind'].includes(value));
    return (selected[0] as 'Ahead' | 'Even' | 'Behind' | undefined) ?? 'Even';
  }, [selectedCountFilters]);
  const qpSelectedHand = useMemo(() => (hand && hand !== 'All' ? hand : 'Right'), [hand]);
  const canRenderQpLocationsPage = useMemo(
    () => !!(hand && hand !== 'All') && !!(batterSide && batterSide !== 'All'),
    [hand, batterSide]
  );
  const qpLocationsPitcherHand = useMemo(() => (hand && hand !== 'All' ? hand : 'Right'), [hand]);
  const qpLocationStateForPitch = useCallback((pitch: PitchActionPoint): 'Ahead' | 'Even' | 'Behind' => {
    const balls = pitch.balls_num ?? 0;
    const strikes = pitch.strikes_num ?? 0;
    if ((balls === 0 && strikes === 1) || (balls === 0 && strikes === 2) || (balls === 1 && strikes === 2)) return 'Ahead';
    if ((balls === 1 && strikes === 0) || (balls === 2 && strikes === 0) || (balls === 3 && strikes === 0) || (balls === 3 && strikes === 1) || (balls === 2 && strikes === 1)) return 'Behind';
    return 'Even';
  }, []);
  const qpLocationPitchTypes = useMemo(() => {
    const present = Array.from(
      new Set(
        summaryPoints
          .map((point) => point.pitch_type || 'Undefined')
          .filter((value) => value && value !== 'Undefined')
      )
    );
    return present
      .sort((a, b) => {
        const ia = PITCH_TYPE_DISPLAY_ORDER.indexOf(a as (typeof PITCH_TYPE_DISPLAY_ORDER)[number]);
        const ib = PITCH_TYPE_DISPLAY_ORDER.indexOf(b as (typeof PITCH_TYPE_DISPLAY_ORDER)[number]);
        const oa = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
        const ob = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
        if (oa !== ob) return oa - ob;
        return a.localeCompare(b);
      });
  }, [summaryPoints]);
  const qpLocationPointsByStateAndType = useMemo(() => {
    const map: Record<'Behind' | 'Even' | 'Ahead', Record<string, PitchActionPoint[]>> = {
      Behind: {},
      Even: {},
      Ahead: {},
    };
    for (const state of ['Behind', 'Even', 'Ahead'] as const) {
      for (const pitchType of qpLocationPitchTypes) map[state][pitchType] = [];
    }
    for (const point of summaryPoints) {
      if (point.plate_side === null || point.plate_height === null) continue;
      const pitchType = point.pitch_type || 'Undefined';
      if (!qpLocationPitchTypes.includes(pitchType)) continue;
      const state = qpLocationStateForPitch(point);
      map[state][pitchType].push(point);
    }
    return map;
  }, [summaryPoints, qpLocationPitchTypes, qpLocationStateForPitch]);

  const heatmapsPageSvg = useMemo(() => {
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
    const zoom = heatmapDisplayView === 'Pitch' ? 1 : 1.2;
    const zoomTransform = `translate(${w / 2} ${h / 2}) scale(${zoom}) translate(${-w / 2} ${-h / 2})`;
    const isPvMetric = heatmapDisplayView === 'PV/100';
    const heatMetricView = heatmapDisplayView;
    const isRvLikeMetric = (heatMetricView === 'RV/100' || heatMetricView === 'Run Values') || heatMetricView === 'PV/100';
    const allowHeatCells = heatmapDisplayView !== 'Pitch' && (heatmapDisplayView !== 'QP+' || canRenderQpHeatmap);
    const cells =
      !allowHeatCells
        ? []
        : heatmapDisplayView === 'QP+'
          ? buildQpPresetCells(qpSelectedPitchType, qpSelectedHand, qpSelectedCountBucket)
          : buildHeatCells(summaryHeatmapPoints, 'plate_side', 'plate_height', heatMetricView);
    const values = cells.map((c) => c.value).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const densityMax = Math.max(1e-9, ...cells.map((c) => c.density));
    const dynamicMinVal = values.length ? values[0] : 0;
    const dynamicMaxVal = values.length ? values[values.length - 1] : 1;
    const dynamicMidVal = values.length ? values[Math.floor(values.length / 2)] : 0;
    const fixedScale = getHeatmapFixedScale(heatMetricView, selectedPitchTypes);
    const contactVisibilityScale = heatMetricView === 'Contact Rate' ? getHeatmapFixedScale('Whiff Rate', selectedPitchTypes) : null;
    const minVal = fixedScale?.min ?? dynamicMinVal;
    const maxVal = fixedScale?.max ?? dynamicMaxVal;
    const midVal = fixedScale?.mid ?? dynamicMidVal;
    const maxAbs = Math.max(1e-9, ...cells.map((c) => (Number.isFinite(c.value) ? Math.abs(c.value) : 0)));
    const rvMin = isPvMetric ? -2 : -5;
    const rvMax = isPvMetric ? 2 : 5;
    const locationVisiblePitches = summaryPoints.filter(
      (p) => Number.isFinite(Number(p.plate_side)) && Number.isFinite(Number(p.plate_height))
    );
    const glyph = (
      result: string,
      x: number,
      y: number,
      fill: string,
      key: string,
      title: string,
      point?: PitchActionPoint
    ) => {
      const hoverProps = {
        onMouseMove: (event: { clientX: number; clientY: number }) =>
          setLocationHover({ x: event.clientX, y: event.clientY, text: title, bg: fill }),
        onMouseLeave: () => setLocationHover(null),
        onClick: () => (point ? openActionModal(locationVisiblePitches, point) : undefined),
      };
      if (result === 'Ball') return <circle key={key} cx={x} cy={y} r={8.6} fill="rgba(0,0,0,0.001)" stroke={fill} strokeWidth={2.1} {...hoverProps} />;
      if (result === 'Foul') return <polygon key={key} points={`${x},${y - 8.1} ${x - 7.3},${y + 6.2} ${x + 7.3},${y + 6.2}`} fill="rgba(0,0,0,0.001)" stroke={fill} strokeWidth={2.1} {...hoverProps} />;
      if (result === 'Whiff') return <text key={key} x={x} y={y + 6.4} fontSize={19} textAnchor="middle" fill={fill} {...hoverProps}>★</text>;
      if (result === 'In Play (Out)') return <polygon key={key} points={`${x},${y - 8.1} ${x - 7.3},${y + 6.2} ${x + 7.3},${y + 6.2}`} fill={fill} {...hoverProps} />;
      if (result === 'In Play (Hit)' || result === 'Single' || result === 'Double' || result === 'Triple' || result === 'HomeRun') return <rect key={key} x={x - 6.9} y={y - 6.9} width={13.8} height={13.8} fill={fill} {...hoverProps} />;
      if (result === 'Error') return <rect key={key} x={x - 6.9} y={y - 6.9} width={13.8} height={13.8} fill="rgba(0,0,0,0.001)" stroke={fill} strokeWidth={1.9} {...hoverProps} />;
      return <circle key={key} cx={x} cy={y} r={8.6} fill={fill} {...hoverProps} />;
    };
    return (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 460, border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10 }} onMouseLeave={() => setLocationHover(null)}>
        <defs>
          <clipPath id="location-zoom-clip-heatmaps-page">
            <rect x={0} y={0} width={w} height={h} />
          </clipPath>
          <filter id="location-heat-blur-heatmaps-page" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5.4" />
          </filter>
          <filter id="location-heat-blur-rv-heatmaps-page" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5.4" />
          </filter>
        </defs>
        <g transform={zoomTransform} clipPath="url(#location-zoom-clip-heatmaps-page)">
          {heatmapDisplayView !== 'Pitch' ? (
            <>
              <g filter={isRvLikeMetric ? 'url(#location-heat-blur-rv-heatmaps-page)' : 'url(#location-heat-blur-heatmaps-page)'}>
                {cells.map((c) => {
                  if (!Number.isFinite(c.value)) return null;
                  const cx = px(c.x + c.w / 2);
                  const cy = py(c.y + c.h / 2);
                  const radius = Math.max(4.5, c.w * scale * 3.6);
                  const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                  let fill = 'rgba(255,255,255,0.12)';
                  if (heatmapDisplayView === 'Frequency') {
                    fill = sequentialColor(c.value, minVal, maxVal);
                  } else if (heatmapDisplayView === 'QP+') {
                    fill = divergingColor(c.value, 0, 100, 200);
                  } else if (isRvLikeMetric) {
                    const rvClamped = Math.max(rvMin, Math.min(rvMax, c.value));
                    fill = divergingColor(rvClamped, rvMin, 0, rvMax);
                  } else {
                    fill = divergingColor(c.value, minVal, midVal, maxVal);
                  }
                  const normalized =
                    heatmapDisplayView === 'QP+'
                      ? Math.abs(c.value - 100) / 100
                      : isRvLikeMetric
                        ? Math.abs(Math.max(rvMin, Math.min(rvMax, c.value))) / rvMax
                        : heatMetricView === 'Contact Rate' && contactVisibilityScale
                          ? Math.max(
                              0,
                              Math.min(
                                1,
                                ((100 - c.value) - contactVisibilityScale.min) /
                                  Math.max(1e-9, contactVisibilityScale.max - contactVisibilityScale.min)
                              )
                            )
                          : Math.max(0, Math.min(1, (c.value - minVal) / Math.max(1e-9, maxVal - minVal)));
                  const runValueBoost = normalized;
                  const isSwingRateView = heatMetricView === 'Swing Rate';
                  const isGbRateView = heatMetricView === 'GB Rate';
                  const isXMetricView = heatMetricView === 'xWOBA' || heatMetricView === 'xISO';
                  if (densityNorm < 0.03) return null;
                  return (
                    <circle
                      key={`hp-blur-${c.x}-${c.y}`}
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill={fill}
                      opacity={
                        Math.max(0.3, runValueBoost * 1.25 * (heatMetricView === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))
                      }
                    />
                  );
                })}
              </g>
              {cells.map((c) => {
                if (!Number.isFinite(c.value)) return null;
                const cx = px(c.x + c.w / 2);
                const cy = py(c.y + c.h / 2);
                const radius = Math.max(1.0, c.w * scale * 0.75);
                const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                let fill = 'rgba(255,255,255,0.12)';
                if (heatmapDisplayView === 'Frequency') {
                  fill = sequentialColor(c.value, minVal, maxVal);
                } else if (heatmapDisplayView === 'QP+') {
                  fill = divergingColor(c.value, 0, 100, 200);
                } else if (isRvLikeMetric) {
                  const rvClamped = Math.max(rvMin, Math.min(rvMax, c.value));
                  fill = divergingColor(rvClamped, rvMin, 0, rvMax);
                } else {
                  fill = divergingColor(c.value, minVal, midVal, maxVal);
                }
                const normalized =
                  heatmapDisplayView === 'QP+'
                    ? Math.abs(c.value - 100) / 100
                    : isRvLikeMetric
                      ? Math.abs(Math.max(rvMin, Math.min(rvMax, c.value))) / rvMax
                      : heatMetricView === 'Contact Rate' && contactVisibilityScale
                        ? Math.max(
                            0,
                            Math.min(
                              1,
                              ((100 - c.value) - contactVisibilityScale.min) /
                                Math.max(1e-9, contactVisibilityScale.max - contactVisibilityScale.min)
                            )
                          )
                        : Math.max(0, Math.min(1, (c.value - minVal) / Math.max(1e-9, maxVal - minVal)));
                const runValueBoost = normalized;
                const isSwingRateView = heatMetricView === 'Swing Rate';
                const isGbRateView = heatMetricView === 'GB Rate';
                const isXMetricView = heatMetricView === 'xWOBA' || heatMetricView === 'xISO';
                if (densityNorm < 0.03) return null;
                return (
                  <circle
                    key={`hp-core-${c.x}-${c.y}`}
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill="rgba(0,0,0,0.001)"
                    onMouseMove={(event) =>
                      setLocationHover({
                        x: event.clientX,
                        y: event.clientY,
                        text: `${heatmapDisplayView}: ${fmtNum(c.value, heatmapDisplayView === 'xWOBA' || heatmapDisplayView === 'xISO' ? 3 : (isRvLikeMetric || heatmapDisplayView === 'Exit Velocity' || heatmapDisplayView === 'QP+' ? 2 : 1))}`,
                      })
                    }
                    onMouseLeave={() => setLocationHover(null)}
                  />
                );
              })}
            </>
          ) : null}
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
          {(heatmapDisplayView === 'Pitch' || heatmapDisplayView === 'QP+')
            ? locationVisiblePitches.map((p, i) => {
                const x = px(orientX(Number(p.plate_side), p.school_code));
                const y = py(Number(p.plate_height));
                const color = pitchColors[p.pitch_type] ?? '#9ca3af';
                const result = resultShape(p.pitch_call, p.play_result, p.school_code);
                const hoverText =
                  heatmapDisplayView === 'QP+'
                    ? `${tooltipHtml(p)}\nQP+: ${fmtNum(p.qp_plus, 1)}`
                    : tooltipHtml(p);
                return (
                  <g key={`hp-loc-wrap-${i}`} opacity={heatmapDisplayView === 'Pitch' ? 1 : 0.9}>
                    {glyph(result, x, y, color, `hp-loc-${i}`, hoverText, p)}
                  </g>
                );
              })
            : null}
        </g>
      </svg>
    );
  }, [summaryPoints, summaryHeatmapPoints, heatmapDisplayView, canRenderQpHeatmap, qpSelectedPitchType, qpSelectedCountBucket, qpSelectedHand, isPro, selectedPitchTypes, visualOption, canUsePitchEdits]);

  const heatmapsPageLegendRange = useMemo(() => {
    if (heatmapDisplayView === 'Pitch') return null;
    const allowHeatCells = heatmapDisplayView !== 'QP+' || canRenderQpHeatmap;
    const cells = !allowHeatCells
      ? []
      : heatmapDisplayView === 'QP+'
        ? buildQpPresetCells(qpSelectedPitchType, qpSelectedHand, qpSelectedCountBucket)
        : buildHeatCells(summaryHeatmapPoints, 'plate_side', 'plate_height', heatmapDisplayView);
    const values = cells.map((c) => c.value).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const dynamicMinVal = values.length ? values[0] : 0;
    const dynamicMaxVal = values.length ? values[values.length - 1] : 1;
    const fixedScale = getHeatmapFixedScale(heatmapDisplayView, selectedPitchTypes);
    return { min: fixedScale?.min ?? dynamicMinVal, max: fixedScale?.max ?? dynamicMaxVal, isFixed: !!fixedScale };
  }, [summaryHeatmapPoints, heatmapDisplayView, canRenderQpHeatmap, qpSelectedPitchType, qpSelectedHand, qpSelectedCountBucket, selectedPitchTypes]);

  const tableColorMode = useMemo(() => {
    if (!tableMode) return '';
    if (tableMode === 'Custom') return 'Custom';
    return tableMode;
  }, [tableMode]);

  const shouldColorTable = useMemo(
    () => enableTableColors && ['Stuff', 'Expected Movement', 'Process', 'Live', 'Results', 'Bullpen', 'Banny', 'Custom'].includes(tableColorMode),
    [enableTableColors, tableColorMode]
  );

  const colorColumnsByMode: Record<string, string[]> = {
    Stuff: ['Velo', 'Max', 'IVB', 'HB', 'rTilt', 'bTilt', 'TiltDev', 'SpinEff', 'Spin', 'Height', 'Side', 'Ext', 'VAA', 'nVAA', 'HAA', 'Stuff+'],
    'Expected Movement': ['Velo', 'Max', 'IVB', 'xIVB', 'dIVB', 'HB', 'xHB', 'dHB', 'MagAngle', 'rTilt', 'bTilt', 'TiltDev', 'SpinEff', 'Spin', 'Height', 'Side', 'Ext', 'VAA', 'nVAA', 'HAA'],
    Process: ['InZone%', '<2kInZone%', '2kInZone%', 'Strike%', '<2Kstrike%', '2Kstrike%', 'Comp%', 'Swing%', 'FPS%', 'Early%', 'Ahead%', 'E+A%', '1-1W%', 'HR%', 'RV/100', 'PV/100', 'ERA', 'FIP', 'xFIP', 'SIERA'],
    Live: ['InZone%', 'Strike%', 'FPS%', 'E+A%', 'QP+', 'Ctrl+', 'Pitching+', 'K%', 'BB%', 'HR%', 'Whiff%', 'SwStrk%', 'ERA', 'FIP', 'xFIP', 'SIERA'],
    Results: ['Whiff%', 'SwStrk%', 'K%', 'BB%', 'HR%', 'CSW%', 'GB%', 'FB%', 'Barrel%', 'EV', 'ERA', 'FIP', 'xFIP', 'SIERA'],
    Bullpen: ['InZone%', 'Comp%', 'Ctrl+', 'Stuff+'],
    Banny: ['Strike%', 'Whiff%', 'K%', 'BB%', 'QP+'],
    Custom: [
      'Velo',
      'Max',
      'IVB',
      'xIVB',
      'dIVB',
      'HB',
      'xHB',
      'dHB',
      'MagAngle',
      'Spin',
      'rTilt',
      'bTilt',
      'TiltDev',
      'SpinEff',
      'Height',
      'Side',
      'Ext',
      'VAA',
      'nVAA',
      'HAA',
      'InZone%',
      '<2kInZone%',
      '2kInZone%',
      'Comp%',
      'Strike%',
      '<2Kstrike%',
      '2Kstrike%',
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
      'PV/100',
      'K%',
      'BB%',
      'HR%',
      'Whiff%',
      'SwStrk%',
      'CSW%',
      'GB%',
      'FB%',
      'Barrel%',
      'EV',
      'ERA',
      'FIP',
      'xFIP',
      'SIERA',
    ],
  };

  const tableColorColumns = useMemo(() => colorColumnsByMode[tableColorMode] ?? [], [tableColorMode]);
  const tableColorColumnSet = useMemo(
    () => new Set(tableColorColumns.map((column) => normalizeColorColumnName(column))),
    [tableColorColumns]
  );
  const splitColName = overview?.table_columns?.[0] ?? '';
  const leaderboardPrimaryColumn = splitColName;
  const applyLeaderboardDrilldown = useCallback((rawValue: unknown, viewBy: 'Player' | 'Team') => {
    const rawText = String(rawValue ?? '').trim();
    if (!rawText || rawText.toLowerCase() === 'all') return;
    const todayYmd = toYmdNow();
    if (viewBy === 'Player') {
      setSelectedPitchers([rawText]);
      setSelectedHitters(['All']);
    } else {
      let nextTeam = rawText;
      if (isPro) {
        const display = getProTeamDisplayName(rawText, (level as 'MLB' | 'AAA' | 'All') || 'All');
        if (display) nextTeam = display;
      } else {
        const upper = rawText.toUpperCase();
        const mapped = LEAGUE_TEAM_NAME_BY_CODE[upper] ?? schoolNameFromTeamCodeFallback(upper);
        if (mapped) nextTeam = mapped;
      }
      setTeamType(nextTeam);
      setSelectedPitchers(['All']);
      setSelectedHitters(['All']);
    }
    if (isPro) {
      setStartDate(PRO_SEASON_START);
      setEndDate(todayYmd);
    }
    setDashboardPage('Summary');
    setAppliedFilterVersion((current) => current + 1);
  }, [isPro, level]);
  const customSavedModeOptions = useMemo(() => {
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return customTables
      .filter((item) => normalize(item.name) !== 'jaredsdashboard')
      .map((item) => ({ value: `custom_saved:${item.id}`, label: customTableOptionLabel(item) }));
  }, [customTables]);
  const tableModeOptions = useMemo(
    () =>
      (isLeague
        ? [
            { value: 'Stuff', label: 'Stuff' },
            { value: 'Expected Movement', label: 'Expected Movement' },
            { value: 'Live', label: 'Live' },
            { value: 'Process', label: 'Process' },
            { value: 'Results', label: 'Results' },
            { value: 'Bullpen', label: 'Bullpen' },
            ...(isGcu ? [{ value: 'Banny', label: 'Banny' }] : []),
            ...(jaredDashboardTable ? [{ value: 'jared_dashboard', label: "Jared's Dashboard" }] : []),
            { value: 'Usage', label: 'Count Usage' },
            { value: 'Pitch Usage', label: 'Pitch Usage' },
            { value: 'Raw Data', label: 'Raw Data' },
            { value: 'Batted Ball Data', label: 'Batted Ball Data' },
          ]
        : [
            { value: 'Stuff', label: 'Stuff' },
            { value: 'Expected Movement', label: 'Expected Movement' },
            { value: 'Process', label: 'Process' },
            { value: 'Results', label: 'Results' },
            { value: 'Bullpen', label: 'Bullpen' },
            { value: 'Live', label: 'Live' },
            ...(isGcu ? [{ value: 'Banny', label: 'Banny' }] : []),
            ...(jaredDashboardTable ? [{ value: 'jared_dashboard', label: "Jared's Dashboard" }] : []),
            { value: 'Usage', label: 'Count Usage' },
            { value: 'Pitch Usage', label: 'Pitch Usage' },
            { value: 'Raw Data', label: 'Raw Data' },
            { value: 'Batted Ball Data', label: 'Batted Ball Data' },
          ]
      ).concat([...customSavedModeOptions, { value: 'Custom', label: 'Custom' }]),
    [customSavedModeOptions, isGcu, isLeague, jaredDashboardTable]
  );
  const splitByOptions = useMemo(
    () =>
      isLeague
        ? [
            { value: 'All', label: 'All' },
            { value: 'Pitch Types', label: 'Pitch Types' },
            { value: 'Pitcher', label: 'Pitcher' },
            { value: 'Pitcher Hand', label: 'Pitcher Hand' },
            { value: 'Batter Hand', label: 'Batter Hand' },
            { value: 'Year', label: 'Year' },
            { value: 'Month', label: 'Month' },
            { value: 'Count', label: 'Count' },
            { value: 'After Count', label: 'After Count' },
            { value: 'Venue', label: 'Venue' },
            { value: 'Zone Location', label: 'Zone Location' },
            { value: 'Times Through Order', label: 'Times Through Order' },
            { value: 'Inning', label: 'Inning of Appearance' },
            { value: 'Pitch Count', label: 'Pitch Count' },
            { value: 'Velocity', label: 'Velocity' },
            { value: 'IVB', label: 'IVB' },
            { value: 'HB', label: 'HB' },
            { value: 'Batter', label: 'Batter' },
            { value: 'Catcher', label: 'Catcher' },
            { value: 'Team', label: 'Team' },
          ]
        : [
            { value: 'All', label: 'All' },
            { value: 'Pitch Types', label: 'Pitch Types' },
            { value: 'Batter Hand', label: 'Batter Hand' },
            { value: 'Year', label: 'Year' },
            { value: 'Month', label: 'Month' },
            { value: 'Count', label: 'Count' },
            { value: 'After Count', label: 'After Count' },
            { value: 'Venue', label: 'Venue' },
            { value: 'Zone Location', label: 'Zone Location' },
            { value: 'Times Through Order', label: 'Times Through Order' },
            { value: 'Inning', label: 'Inning of Appearance' },
            { value: 'Pitch Count', label: 'Pitch Count' },
            { value: 'Velocity', label: 'Velocity' },
            { value: 'IVB', label: 'IVB' },
            { value: 'HB', label: 'HB' },
            { value: 'Batter', label: 'Batter' },
            { value: 'Catcher', label: 'Catcher' },
            { value: 'Source', label: 'Source' },
          ],
    [isLeague]
  );
  const tableModeSelectValue = useMemo(
    () =>
      tableMode === 'Custom' && selectedCustomTableId
        ? (jaredDashboardTable && selectedCustomTableId === jaredDashboardTable.id ? 'jared_dashboard' : `custom_saved:${selectedCustomTableId}`)
        : tableMode,
    [tableMode, selectedCustomTableId, jaredDashboardTable]
  );
  const handleTableModeSelection = useCallback((next: string) => {
    if (isLeague && isLeaderboardPage) {
      setLoadingOverview(true);
      setError('');
    }
    if (next === 'jared_dashboard') {
      if (!jaredDashboardTable) return;
      setTableMode('Custom');
      setShowCustomEditor(false);
      setSelectedCustomTableId(jaredDashboardTable.id);
      setCustomTableName(jaredDashboardTable.name);
      setCustomTableColumns(jaredDashboardTable.columns ?? []);
      setCustomSaveState('idle');
      setCustomSaveMessage('');
      setAppliedFilterVersion((current) => current + 1);
      return;
    }
    if (next.startsWith('custom_saved:')) {
      const id = Number(next.replace('custom_saved:', ''));
      const found = customTables.find((row) => Number(row.id) === id);
      if (!found) return;
      setTableMode('Custom');
      setShowCustomEditor(false);
      setSelectedCustomTableId(found.id);
      setCustomTableName(found.name);
      setCustomTableColumns(found.columns ?? []);
      setCustomSaveState('idle');
      setCustomSaveMessage('');
      setAppliedFilterVersion((current) => current + 1);
      return;
    }
    setTableMode(next);
    if (next === 'Custom') {
      setShowCustomEditor(true);
      setSelectedCustomTableId(null);
      setCustomTableName('');
      setCustomTableColumns([]);
      setCustomSaveState('idle');
      setCustomSaveMessage('');
      setAppliedFilterVersion((current) => current + 1);
    } else {
      setShowCustomEditor(false);
    }
  }, [customTables, isLeague, isLeaderboardPage, jaredDashboardTable]);
  const handleLeaderboardViewBySelection = useCallback((next: string) => {
    if (isLeague && isLeaderboardPage) {
      setLoadingOverview(true);
      setError('');
    }
    setLeaderboardViewBy(next as 'Player' | 'Team');
  }, [isLeague, isLeaderboardPage]);
  const handleLeaderboardStatViewSelection = useCallback((next: string) => {
    if (isLeague && isLeaderboardPage) {
      setLoadingOverview(true);
      setError('');
    }
    setLeaderboardStatView(next as 'Stats' | 'Percentile');
  }, [isLeague, isLeaderboardPage]);
  const handleLeaderboardPercentileScopeSelection = useCallback((next: string) => {
    if (isLeague && isLeaderboardPage) {
      setLoadingOverview(true);
      setError('');
    }
    setLeaderboardPercentileScope(next);
  }, [isLeague, isLeaderboardPage]);
  const downloadLeaderboardPdf = useCallback(async () => {
    const wrapNode = leaderboardTableExportRef.current;
    if (!wrapNode) return;
    try {
      setError('');
      setIsExportingLeaderboardPdf(true);
      // Same "Player · Date Range" subtitle convention as the mobile report
      // exports (see pearl-player-development's bullpen-summary.tsx) --
      // player label falls back to "All Players" when nothing/`All` is
      // selected, matching how the sidebar's own pitcher filter reads.
      const playerLabel = allPitchersSelected
        ? 'All Players'
        : selectedPitchers.length === 1
        ? formatNameFirstLast(selectedPitchers[0])
        : `${selectedPitchers.length} Players`;
      const dateRangeLabel =
        startDate && endDate
          ? `${new Date(`${startDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${new Date(`${endDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
          : '';
      const safeMode = String(tableMode || 'leaderboard').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      const safeViewBy = String(leaderboardViewBy || 'player').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      await downloadLeaderboardTablePdf({
        wrapNode,
        titleText: 'Pitching Leaderboard',
        subtitleText: [playerLabel, dateRangeLabel].filter(Boolean).join('  ·  '),
        fileName: `pitching-leaderboard-${safeViewBy}-${safeMode}.pdf`,
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export leaderboard PDF.');
    } finally {
      setIsExportingLeaderboardPdf(false);
    }
  }, [leaderboardViewBy, tableMode, selectedPitchers, allPitchersSelected, startDate, endDate]);
  const displayedTableColumns = useMemo(() => {
    const splitColumn = overview?.table_columns?.[0] ?? 'Pitch';
    const isJaredDashboardSelection =
      tableMode === 'Custom' &&
      !!jaredDashboardTable &&
      Number(selectedCustomTableId ?? 0) > 0 &&
      Number(selectedCustomTableId) === Number(jaredDashboardTable.id);
    if (isPro && isLeaderboardPage && tableMode !== 'Custom' && !isJaredDashboardSelection) {
      return overview?.table_columns?.length
        ? overview.table_columns
        : [splitColumn];
    }
    if (tableMode === 'Custom') {
      return customTableColumns.length ? [splitColumn, ...customTableColumns] : [splitColumn];
    }
    return overview?.table_columns?.length
      ? overview.table_columns
      : ['Pitch Type', 'Pitches', 'Usage %', 'Avg Velo', 'Max Velo', 'Avg Spin', 'Avg IVB', 'Avg HB', 'Stuff+'];
  }, [overview?.table_columns, tableMode, customTableColumns, isPro, isLeaderboardPage, selectedCustomTableId, jaredDashboardTable]);
  const leaderboardBaseColumns = useMemo(() => displayedTableColumns, [displayedTableColumns]);
  useEffect(() => {
    if (!isLeaderboardPage) return;
    const preferred = leaderboardBaseColumns[1] ?? leaderboardBaseColumns[0] ?? '';
    if (!preferred) return;
    if (!leaderboardSortColumn || !leaderboardBaseColumns.includes(leaderboardSortColumn)) {
      setLeaderboardSortColumn(preferred);
      setLeaderboardSortDirection('desc');
    }
  }, [isLeaderboardPage, leaderboardBaseColumns, leaderboardSortColumn]);
  // Keep PV/100 source-of-truth on the backend/rollups so reloads cannot switch
  // between mixed client fallback and server-calculated values.
  // Pitch-count min/max filtering is enforced server-side for consistency.
  const tableRowsWithPv = useMemo(() => {
    const rows = overview?.table_rows ?? [];
    if (!isPro || !isLeaderboardPage || leaderboardViewBy !== 'Team') {
      return rows;
    }
    const firstColumn = displayedTableColumns[0] ?? overview?.table_columns?.[0] ?? '';
    if (!firstColumn) return rows;
    return rows.filter((row) => !isMlbLeagueAggregateTeamLabel((row as Record<string, unknown>)[firstColumn]));
  }, [overview?.table_rows, overview?.table_columns, displayedTableColumns, isPro, isLeaderboardPage, leaderboardViewBy, level]);
  const leaderboardRows = useMemo(() => {
    const rows = tableRowsWithPv;
    if (!isLeaderboardPage) return rows;
    const firstCol = leaderboardBaseColumns[0] ?? '';
    const sortCol =
      leaderboardSortColumn && leaderboardBaseColumns.includes(leaderboardSortColumn)
        ? leaderboardSortColumn
        : (leaderboardBaseColumns[1] ?? firstCol);
    if (!sortCol) return rows;
    const splitColumn = leaderboardBaseColumns[0] ?? '';
    return sortTableRows(rows, sortCol, leaderboardSortDirection, splitColumn);
  }, [tableRowsWithPv, isLeaderboardPage, leaderboardBaseColumns, leaderboardSortColumn, leaderboardSortDirection]);
  const leaderboardRowsWithPins = useMemo(() => {
    if (!isLeaderboardPage) return leaderboardRows;
    const sorted = sortRowsWithPins(
      leaderboardRows as Array<Record<string, string | number | null | undefined>>,
      leaderboardBaseColumns,
      pinnedLeaderboardKeys
    ) as Array<Record<string, string | number | null>>;
    return sorted;
  }, [isLeaderboardPage, leaderboardRows, leaderboardBaseColumns, pinnedLeaderboardKeys]);
  const pinnedLeaderboardRows = useMemo(() => {
    const firstColumn = leaderboardBaseColumns[0] ?? '';
    if (!isLeaderboardPage || !firstColumn || !pinnedLeaderboardKeys.size) return [];
    return leaderboardRows.filter((row) =>
      pinnedLeaderboardKeys.has(
        pinKeyFromRow(
          row as Record<string, string | number | null | undefined>,
          firstColumn
        )
      )
    ) as Array<Record<string, string | number | null>>;
  }, [isLeaderboardPage, leaderboardRows, leaderboardBaseColumns, pinnedLeaderboardKeys]);
  const openLeaderboardVideoQueue = async (
    clickedRow: Record<string, string | number | null>,
    clickedRowKey: string,
    clickedRowPitches: PitchActionPoint[]
  ) => {
    if (!pinnedLeaderboardRows.length) {
      await openActionModal(
        await fetchCompletePitchesForRow(clickedRow, clickedRowKey, clickedRowPitches)
      );
      return;
    }

    const firstColumn = leaderboardBaseColumns[0] ?? '';
    const completePinnedRows = await Promise.all(
      pinnedLeaderboardRows.map(async (row) => {
        const rowKey = String(row[firstColumn] ?? 'Unknown');
        const currentPitches = resolveEditablePitchesForRow(row, rowKey);
        return {
          pinKey: pinKeyFromRow(row, firstColumn),
          pitches: await fetchCompletePitchesForRow(row, rowKey, currentPitches),
        };
      })
    );
    const queuedPitches = completePinnedRows.flatMap((entry) => entry.pitches);
    const clickedPinKey = pinKeyFromRow(clickedRow, firstColumn);
    const startingPitch = completePinnedRows.find((entry) => entry.pinKey === clickedPinKey)?.pitches[0];
    await openActionModal(queuedPitches, startingPitch);
  };
  const percentileTableColumns = useMemo(
    () => (dashboardPage === 'Game Log' ? gameLogColumns : (dashboardPage === 'Pitch Log' ? pitchLogColumns : displayedTableColumns)),
    [dashboardPage, gameLogColumns, pitchLogColumns, displayedTableColumns]
  );
  const leaderboardTeamDistributions = useMemo(() => {
    const byColumn = new Map<string, number[]>();
    if (!isLeaderboardPage || isPro || leaderboardPercentileScope !== 'TEAM') return byColumn;
    const splitColumn = displayedTableColumns[0] ?? '';
    for (const column of displayedTableColumns.slice(1)) {
      for (const row of leaderboardRowsWithPins) {
        if (splitColumn && isAllLikeRowValue(row[splitColumn])) continue;
        const numeric = parseSortableNumber(row[column]);
        if (numeric === null) continue;
        if (!byColumn.has(column)) byColumn.set(column, []);
        byColumn.get(column)?.push(numeric);
      }
    }
    byColumn.forEach((values, key) => {
      byColumn.set(key, values.sort((a, b) => a - b));
    });
    return byColumn;
  }, [isLeaderboardPage, isPro, leaderboardPercentileScope, displayedTableColumns, leaderboardRowsWithPins]);
  const gameLogTeamDistributions = useMemo(() => {
    const byColumn = new Map<string, number[]>();
    if (dashboardPage !== 'Game Log' || isPro || leaderboardPercentileScope !== 'TEAM') return byColumn;
    const splitColumn = gameLogColumns[0] ?? '';
    for (const column of gameLogColumns.slice(1)) {
      for (const row of gameLogRowsWithPins) {
        if (splitColumn && isAllLikeRowValue(row[splitColumn])) continue;
        const numeric = parseSortableNumber(row[column]);
        if (numeric === null) continue;
        if (!byColumn.has(column)) byColumn.set(column, []);
        byColumn.get(column)?.push(numeric);
      }
    }
    byColumn.forEach((values, key) => byColumn.set(key, values.sort((a, b) => a - b)));
    return byColumn;
  }, [dashboardPage, isPro, leaderboardPercentileScope, gameLogColumns, gameLogRowsWithPins]);
  const leaderboardFallbackDistributions = useMemo(() => {
    const byColumn = new Map<string, number[]>();
    if (!isLeaderboardPage) return byColumn;
    const splitColumn = displayedTableColumns[0] ?? '';
    for (const column of displayedTableColumns.slice(1)) {
      const values = leaderboardRowsWithPins
        .filter((row) => !splitColumn || !isAllLikeRowValue(row[splitColumn]))
        .map((row) => parseSortableNumber(row[column]))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      if (values.length) byColumn.set(column, values);
    }
    return byColumn;
  }, [isLeaderboardPage, displayedTableColumns, leaderboardRowsWithPins]);
  const gameLogFallbackDistributions = useMemo(() => {
    const byColumn = new Map<string, number[]>();
    if (dashboardPage !== 'Game Log') return byColumn;
    const splitColumn = gameLogColumns[0] ?? '';
    const sourceRows = gameLogRowsWithPins.filter((row) => !splitColumn || !isAllLikeRowValue(row[splitColumn]));
    for (const column of gameLogColumns.slice(1)) {
      const values = sourceRows
        .map((row) => parseSortableNumber(row[column]))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      if (values.length) byColumn.set(column, values);
    }
    return byColumn;
  }, [dashboardPage, gameLogColumns, gameLogRowsWithPins]);
  const pitchLogTeamDistributions = useMemo(() => {
    const byColumn = new Map<string, number[]>();
    if (dashboardPage !== 'Pitch Log' || isPro || leaderboardPercentileScope !== 'TEAM') return byColumn;
    const splitColumn = pitchLogColumns[0] ?? '';
    for (const column of pitchLogColumns.slice(1)) {
      for (const row of sortedPitchLogRows) {
        if (splitColumn && isAllLikeRowValue(row[splitColumn])) continue;
        const numeric = parseSortableNumber(row[column]);
        if (numeric === null) continue;
        if (!byColumn.has(column)) byColumn.set(column, []);
        byColumn.get(column)?.push(numeric);
      }
    }
    byColumn.forEach((values, key) => byColumn.set(key, values.sort((a, b) => a - b)));
    return byColumn;
  }, [dashboardPage, isPro, leaderboardPercentileScope, pitchLogColumns, sortedPitchLogRows]);
  const pitchLogFallbackDistributions = useMemo(() => {
    const byColumn = new Map<string, number[]>();
    if (dashboardPage !== 'Pitch Log') return byColumn;
    const splitColumn = pitchLogColumns[0] ?? '';
    const sourceRows = sortedPitchLogRows.filter((row) => !splitColumn || !isAllLikeRowValue(row[splitColumn]));
    for (const column of pitchLogColumns.slice(1)) {
      const values = sourceRows
        .map((row) => parseSortableNumber(row[column]))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      if (values.length) byColumn.set(column, values);
    }
    return byColumn;
  }, [dashboardPage, pitchLogColumns, sortedPitchLogRows]);
  const percentileDistributionsByKey = useMemo(() => {
    const splitColumn = percentileTableColumns[0] ?? '';
    const scoped = new Map<string, number[]>();
    const globalByColumn = new Map<string, number[]>();
    const scopedHanded = new Map<string, number[]>();
    const globalByColumnHanded = new Map<string, number[]>();
    if (!splitColumn || !percentileBaselineRows.length) {
      return { splitColumn, scoped, globalByColumn, scopedHanded, globalByColumnHanded };
    }
    const accumulate = (
      rows: Array<Record<string, string | number | null>>,
      scopedTarget: Map<string, number[]>,
      globalTarget: Map<string, number[]>
    ) => {
      for (const column of percentileTableColumns.slice(1)) {
        for (const row of rows) {
          const rowKey = percentileSplitRowKey(splitColumn, row[splitColumn]);
          if (!rowKey) continue;
          const isAllRow = isAllLikeRowValue(row[splitColumn]);
          const numeric = parseSortableNumber(row[column]);
          if (numeric === null) continue;
          const scopedKey = `${rowKey}::${column}`;
          if (!scopedTarget.has(scopedKey)) scopedTarget.set(scopedKey, []);
          scopedTarget.get(scopedKey)?.push(numeric);
          if (isAllRow) continue;
          if (!globalTarget.has(column)) globalTarget.set(column, []);
          globalTarget.get(column)?.push(numeric);
        }
      }
    };
    accumulate(percentileBaselineRows, scoped, globalByColumn);
    if (percentileBaselineHandedRows.length) {
      accumulate(percentileBaselineHandedRows, scopedHanded, globalByColumnHanded);
    }
    [scoped, globalByColumn, scopedHanded, globalByColumnHanded].forEach((map) => {
      map.forEach((values, key) => {
        map.set(key, values.sort((a, b) => a - b));
      });
    });
    return { splitColumn, scoped, globalByColumn, scopedHanded, globalByColumnHanded };
  }, [percentileTableColumns, percentileBaselineRows, percentileBaselineHandedRows]);
  const percentileGlobalDistributionsByToken = useMemo(() => {
    const byToken = new Map<string, number[]>();
    const push = (token: string, value: number) => {
      if (!token || !Number.isFinite(value)) return;
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token)?.push(value);
    };
    for (const row of percentileBaselineRows) {
      for (const [key, raw] of Object.entries(row)) {
        if (isAllLikeRowValue(raw)) continue;
        const num = parseSortableNumber(raw);
        if (num === null) continue;
        push(normalizePercentileColumnToken(key), num);
      }
    }
    for (const row of percentileBaselineHandedRows) {
      for (const [key, raw] of Object.entries(row)) {
        if (isAllLikeRowValue(raw)) continue;
        const num = parseSortableNumber(raw);
        if (num === null) continue;
        push(normalizePercentileColumnToken(key), num);
      }
    }
    byToken.forEach((values, key) => {
      byToken.set(key, values.sort((a, b) => a - b));
    });
    return byToken;
  }, [percentileBaselineRows, percentileBaselineHandedRows]);
  const summaryFallbackDistributions = useMemo(() => {
    const byColumn = new Map<string, number[]>();
    if (dashboardPage !== 'Summary') return byColumn;
    const splitColumn = displayedTableColumns[0] ?? '';
    const rows = Array.isArray(overview?.table_rows) ? overview.table_rows : [];
    if (!splitColumn || !rows.length) return byColumn;
    for (const column of displayedTableColumns.slice(1)) {
      const values = rows
        .filter((row) => !isAllLikeRowValue(row[splitColumn]))
        .map((row) => parseSortableNumber(row[column]))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      if (values.length) byColumn.set(column, values);
    }
    return byColumn;
  }, [dashboardPage, displayedTableColumns, overview?.table_rows]);
  const summaryGlobalDistributionsByToken = useMemo(() => {
    const byToken = new Map<string, number[]>();
    const pushValues = (token: string, values: number[]) => {
      if (!token || !values.length) return;
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token)?.push(...values);
    };
    for (const [key, values] of summaryPitchTypeDistributions.entries()) {
      if (!values.length) continue;
      const idx = key.indexOf('::');
      if (idx < 0) continue;
      const col = key.slice(idx + 2);
      pushValues(normalizePercentileColumnToken(col), values);
    }
    for (const [key, values] of summaryPitchTypeHandedDistributions.entries()) {
      if (!values.length) continue;
      const idx = key.indexOf('::');
      if (idx < 0) continue;
      const col = key.slice(idx + 2);
      pushValues(normalizePercentileColumnToken(col), values);
    }
    for (const [token, values] of byToken.entries()) {
      byToken.set(token, values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b));
    }
    return byToken;
  }, [summaryPitchTypeDistributions, summaryPitchTypeHandedDistributions]);
  const pitcherHandByPitcher = useMemo(() => {
    const out: Record<string, 'R' | 'L'> = {};
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const counts = new Map<string, { r: number; l: number }>();
    const points = overview?.chart_points ?? [];
    for (const point of points) {
      const code = normalizeHandednessCode(point.pitcherthrows);
      if (!code) continue;
      const nameRaw = String(point.pitcher ?? '').trim();
      if (!nameRaw) continue;
      const keys = [nameRaw, formatNameFirstLast(nameRaw), norm(nameRaw), norm(formatNameFirstLast(nameRaw))].filter(Boolean);
      for (const key of keys) {
        const next = counts.get(key) ?? { r: 0, l: 0 };
        if (code === 'R') next.r += 1;
        else next.l += 1;
        counts.set(key, next);
      }
    }
    for (const [key, tally] of counts.entries()) {
      if (tally.r === tally.l) continue;
      out[key] = tally.r > tally.l ? 'R' : 'L';
    }
    return out;
  }, [overview?.chart_points]);
  const getCellPercentile = useCallback((
    row: Record<string, string | number | null>,
    column: string,
    rawValue: unknown
  ): number | null => {
    const isSummaryPageLocal = dashboardPage === 'Summary';
    const getColumnDistributionByToken = (map: Map<string, number[]>, col: string): number[] => {
      const direct = map.get(col);
      if (direct && direct.length) return direct;
      const token = normalizePercentileColumnToken(col);
      for (const [key, values] of map.entries()) {
        if (!values.length) continue;
        if (normalizePercentileColumnToken(key) === token) return values;
      }
      return [];
    };
    const getSummaryGlobalDistributionByToken = (col: string): number[] => {
      const token = normalizePercentileColumnToken(col);
      return summaryGlobalDistributionsByToken.get(token) ?? [];
    };
    const getScopedDistributionByToken = (map: Map<string, number[]>, rowKey: string, col: string): number[] => {
      const direct = map.get(`${rowKey}::${col}`);
      if (direct && direct.length) return direct;
      const token = normalizePercentileColumnToken(col);
      const rowPrefix = `${rowKey}::`;
      for (const [key, values] of map.entries()) {
        if (!values.length || !key.startsWith(rowPrefix)) continue;
        const colPart = key.slice(rowPrefix.length);
        if (normalizePercentileColumnToken(colPart) === token) return values;
      }
      return [];
    };
    const { splitColumn, scoped, globalByColumn, scopedHanded, globalByColumnHanded } = percentileDistributionsByKey;
    const rowSplitKey = splitColumn ? percentileSplitRowKey(splitColumn, row[splitColumn]) : '';
    const isPitchLikeSplit = isPitchLikeSplitColumn(splitColumn);
    const isAllSummaryRow = splitColumn ? isAllLikeRowValue(row[splitColumn]) : false;
    const columnToken = normalizePercentileColumnToken(column);
    const isUsageLikeColumn = columnToken === normalizePercentileColumnToken('Usage') || columnToken === normalizePercentileColumnToken('Overall');
    const isSummaryPitchTypeRow = isSummaryPageLocal && isPitchLikeSplit && !isAllSummaryRow;
    if (isSummaryPitchTypeRow && isUsageLikeColumn) return null;
    const isStrictSummaryColumn =
      isSummaryPageLocal &&
      !isAllSummaryRow &&
      SUMMARY_STRICT_ROW_DISTRIBUTION_COLUMNS.has(columnToken);
    const useHandedMovementDistribution = HANDED_MOVEMENT_PERCENTILE_COLUMNS.has(columnToken);
    const scopedDistribution =
      rowSplitKey && !isAllLikeRowValue(row[splitColumn])
        ? (
            useHandedMovementDistribution
              ? (
                  getScopedDistributionByToken(scopedHanded, rowSplitKey, column).length
                    ? getScopedDistributionByToken(scopedHanded, rowSplitKey, column)
                    : getScopedDistributionByToken(scoped, rowSplitKey, column)
                )
              : getScopedDistributionByToken(scoped, rowSplitKey, column)
        )
      : [];
    const scopedDistributionUsable = scopedDistribution.length > 1 ? scopedDistribution : [];
    const tokenGlobalDistribution = percentileGlobalDistributionsByToken.get(normalizePercentileColumnToken(column)) ?? [];
    const globalDistribution = useHandedMovementDistribution
      ? (
          getColumnDistributionByToken(globalByColumnHanded, column).length
            ? getColumnDistributionByToken(globalByColumnHanded, column)
            : getColumnDistributionByToken(globalByColumn, column)
        )
      : getColumnDistributionByToken(globalByColumn, column);
    const globalDistributionUsable = globalDistribution.length ? globalDistribution : tokenGlobalDistribution;
    const pitchTypeScopedDistribution =
      isPitchLikeSplit && rowSplitKey && !isAllLikeRowValue(row[splitColumn])
        ? scopedDistributionUsable
        : [];
    const isGameLogPageLocal = dashboardPage === 'Game Log';
    const isPitchLogPageLocal = dashboardPage === 'Pitch Log';
    const pitchLogTeamDistribution = pitchLogTeamDistributions.get(column) ?? [];
    const pitchLogFallbackDistribution = pitchLogFallbackDistributions.get(column) ?? [];
    const pitchLogDistributionUsable = pitchLogTeamDistribution.length ? pitchLogTeamDistribution : pitchLogFallbackDistribution;
    const distribution = isSummaryPageLocal
      ? (
          (() => {
            const key = `${rowSplitKey}::${column}`;
            const handedDistribution = (
              getScopedDistributionByToken(summaryPitchTypeHandedDistributions, rowSplitKey, column).length
                ? getScopedDistributionByToken(summaryPitchTypeHandedDistributions, rowSplitKey, column)
                : (summaryPitchTypeHandedDistributions.get(key) ?? [])
            );
            if (handedDistribution.length > 1 && SUMMARY_HANDED_COMPARISON_COLUMNS.has(normalizePercentileColumnToken(column))) {
              return handedDistribution;
            }
            const rowDistribution = (
              getScopedDistributionByToken(summaryPitchTypeDistributions, rowSplitKey, column).length
                ? getScopedDistributionByToken(summaryPitchTypeDistributions, rowSplitKey, column)
                : (summaryPitchTypeDistributions.get(key) ?? [])
            );
            if (rowDistribution.length > 1) return rowDistribution;
            const summaryGlobal = getSummaryGlobalDistributionByToken(column);
            const summaryFallback = globalDistributionUsable.length > 1
              ? globalDistributionUsable
              : summaryGlobal.length > 1
                ? summaryGlobal
                : [];
            if (isStrictSummaryColumn) return summaryFallback;
            if (isSummaryPitchTypeRow) return summaryFallback;
            if (isAllSummaryRow) return globalDistributionUsable;
            return scopedDistributionUsable.length ? scopedDistributionUsable : globalDistributionUsable;
          })()
        )
      : isLeaderboardPage
      ? (pitchTypeScopedDistribution.length ? pitchTypeScopedDistribution : globalDistributionUsable)
      : (isGameLogPageLocal || isPitchLogPageLocal)
      ? (isPitchLogPageLocal ? (pitchLogDistributionUsable.length ? pitchLogDistributionUsable : globalDistributionUsable) : globalDistributionUsable)
      : pitchTypeScopedDistribution.length ? pitchTypeScopedDistribution : scopedDistributionUsable.length ? scopedDistributionUsable : globalDistributionUsable;
    const effectiveDistribution = isSummaryPitchTypeRow
      ? distribution
      : isSummaryPageLocal && !distribution.length
      ? (
          (() => {
            const summaryGlobal = getSummaryGlobalDistributionByToken(column);
            if (summaryGlobal.length > 1) return summaryGlobal;
            return globalDistributionUsable.length > 1 ? globalDistributionUsable : [];
          })()
        )
      : distribution;
    if (!effectiveDistribution.length || effectiveDistribution.length <= 1) return null;
    const numeric = parseSortableNumber(rawValue);
    if (numeric === null) return null;
    const percentile = percentileForValue(numeric, effectiveDistribution);
    if (percentile === null) return null;
    let adjusted = adjustPercentileDirection(column, percentile);
    const pitcherHandCode = selectedSinglePitcherHandCode || normalizeHandednessCode(hand);
    const splitToken = normalizePercentileColumnToken(splitColumn);
    let sidePitcherHandCode = '';
    if (splitToken === normalizePercentileColumnToken('Pitcher Hand')) {
      sidePitcherHandCode = normalizeHandednessCode(row[splitColumn]);
    } else if (splitToken === normalizePercentileColumnToken('Pitcher') || splitToken === normalizePercentileColumnToken('Player')) {
      const rawName = String(row[splitColumn] ?? '').trim();
      const normalized = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const formatted = formatNameFirstLast(rawName);
      const formattedNorm = formatted.toLowerCase().replace(/[^a-z0-9]/g, '');
      sidePitcherHandCode =
        pitcherHandByPitcher[rawName] ??
        pitcherHandByPitcher[formatted] ??
        pitcherHandByPitcher[normalized] ??
        pitcherHandByPitcher[formattedNorm] ??
        '';
    }
    if (!sidePitcherHandCode) {
      const rowHandCandidates = [
        row['Pitcher Hand'],
        row['PitcherThrows'],
        row['Pitcher Throws'],
        row.Hand,
        row.Throws,
      ];
      for (const candidate of rowHandCandidates) {
        const parsed = normalizeHandednessCode(candidate);
        if (parsed) {
          sidePitcherHandCode = parsed;
          break;
        }
      }
    }
    if (!sidePitcherHandCode) sidePitcherHandCode = pitcherHandCode;
    if (
      isPitchLikeSplit &&
      columnToken === normalizePercentileColumnToken('IVB') &&
      shouldInvertIvbForPitchTypeLabel(row[splitColumn])
    ) {
      adjusted = Math.max(0, Math.min(100, 100 - adjusted));
    }
    if (
      isPitchLikeSplit &&
      columnToken === normalizePercentileColumnToken('HB') &&
      shouldInvertHbForPitchTypeLabel(row[splitColumn], pitcherHandCode)
    ) {
      adjusted = Math.max(0, Math.min(100, 100 - adjusted));
    }
    if (
      isPitchLikeSplit &&
      (
        columnToken === normalizePercentileColumnToken('VAA') ||
        columnToken === normalizePercentileColumnToken('nVAA')
      ) &&
      shouldInvertVaaForPitchTypeLabel(row[splitColumn])
    ) {
      adjusted = Math.max(0, Math.min(100, 100 - adjusted));
    }
    if (
      columnToken === normalizePercentileColumnToken('Side') &&
      (
        (isPro && sidePitcherHandCode === 'R') ||
        (!isPro && sidePitcherHandCode === 'L')
      )
    ) {
      adjusted = Math.max(0, Math.min(100, 100 - adjusted));
    }
    return adjusted;
  }, [isLeaderboardPage, isPro, dashboardPage, splitBy, hand, selectedSinglePitcher, selectedSinglePitcherHandCode, pitcherHandByPitcher, leaderboardPercentileScope, summaryPercentileScope, leaderboardTeamDistributions, leaderboardFallbackDistributions, gameLogTeamDistributions, gameLogFallbackDistributions, pitchLogTeamDistributions, pitchLogFallbackDistributions, percentileDistributionsByKey, percentileGlobalDistributionsByToken, summaryPitchTypeDistributions, summaryPitchTypeHandedDistributions, summaryFallbackDistributions, summaryGlobalDistributionsByToken]);
  const isGameLogPage = dashboardPage === 'Game Log';
  const isPitchLogPage = dashboardPage === 'Pitch Log';
  const correlationColumns = useMemo(
    () => {
      if (!showLeaderboardCorrelation || (!isLeaderboardPage && !isGameLogPage && !isPitchLogPage)) return [] as string[];
      if (isLeaderboardPage && correlationAllStatColumns.length) return correlationAllStatColumns;
      if (isGameLogPage) return gameLogColumns;
      if (isPitchLogPage) return pitchLogColumns;
      return displayedTableColumns;
    },
    [showLeaderboardCorrelation, isLeaderboardPage, isGameLogPage, isPitchLogPage, correlationAllStatColumns, gameLogColumns, pitchLogColumns, displayedTableColumns]
  );
  const correlationRows = useMemo(
    () => {
      if (!showLeaderboardCorrelation || (!isLeaderboardPage && !isGameLogPage && !isPitchLogPage)) return [] as Array<Record<string, string | number | null | undefined>>;
      if (isLeaderboardPage && correlationAllStatColumns.length) {
        return correlationAllStatRows as Array<Record<string, string | number | null | undefined>>;
      }
      return isGameLogPage
        ? (gameLogRowsWithPins as Array<Record<string, string | number | null | undefined>>)
        : isPitchLogPage
        ? (sortedPitchLogRows as Array<Record<string, string | number | null | undefined>>)
        : (leaderboardRowsWithPins as Array<Record<string, string | number | null | undefined>>);
    },
    [showLeaderboardCorrelation, isLeaderboardPage, isGameLogPage, isPitchLogPage, correlationAllStatColumns, correlationAllStatRows, gameLogRowsWithPins, sortedPitchLogRows, leaderboardRowsWithPins]
  );
  const latestTeamByPitcher = useMemo(() => {
    const points = overview?.chart_points ?? [];
    const latestTsByName: Record<string, number> = {};
    const out: Record<string, string> = {};
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    points.forEach((point) => {
      const name = String(point.pitcher ?? '').trim();
      const team = String(point.pitcher_team_code ?? '').trim().toUpperCase();
      if (!name || !team) return;
      const ts = point.session_date ? Date.parse(point.session_date) : NaN;
      const stamp = Number.isFinite(ts) ? ts : 0;
      const keys = [name, formatNameFirstLast(name), norm(name), norm(formatNameFirstLast(name))].filter(Boolean);
      const latestKnown = Math.max(...keys.map((k) => latestTsByName[k] ?? -1));
      if (stamp >= latestKnown) {
        keys.forEach((k) => {
          latestTsByName[k] = stamp;
          out[k] = team;
        });
      }
    });
    return out;
  }, [overview?.chart_points]);
  const filterTeamByPitcher = useMemo(() => {
    const out: Record<string, string> = {};
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const byTeam = filters?.pitchers_by_team_code ?? {};
    Object.entries(byTeam).forEach(([teamCodeRaw, names]) => {
      const teamCode = String(teamCodeRaw ?? '').trim().toUpperCase();
      if (!teamCode) return;
      (names ?? []).forEach((nameRaw) => {
        const name = String(nameRaw ?? '').trim();
        if (!name) return;
        const formatted = formatNameFirstLast(name);
        [name, formatted, norm(name), norm(formatted)].forEach((k) => {
          if (k) out[k] = teamCode;
        });
      });
    });
    return out;
  }, [filters?.pitchers_by_team_code]);
  const leagueTeamLabelByCode = useMemo(
    () => buildLeagueTeamLabelByCode([filters?.pitchers_by_team_code, filters?.opp_hitters_by_team_code]),
    [filters?.pitchers_by_team_code, filters?.opp_hitters_by_team_code]
  );
  const abCards = useMemo(() => {
    if (!abReport) return [] as Array<{ batter: string; pa: AbReportPayload['pa_groups'][number]['pas'][number] }>;
    return abReport.pa_groups.flatMap((group) =>
      group.pas.map((pa) => ({ batter: group.batter, pa }))
    );
  }, [abReport]);
  const abGameStatLine = useMemo(() => {
    if (!abCards.length) return '';
    const token = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    const walkTokens = new Set(['walk', 'baseonballs', 'intentwalk', 'intentionalwalk']);
    const strikeoutTokens = new Set(['strikeout', 'strikeoutdoubleplay']);
    let pitches = 0;
    let walks = 0;
    let strikeouts = 0;
    let outs = 0;
    let fpsNumerator = 0;
    let fpsDenominator = 0;
    let eaNumerator = 0;
    let eaDenominator = 0;
    for (const { pa } of abCards) {
      pitches += pa.pitches.length;
      const result = token(pa.result_label);
      if (walkTokens.has(result)) walks += 1;
      if (strikeoutTokens.has(result)) strikeouts += 1;
      for (const pitch of pa.pitches) {
        if (pitch.balls_num === null || pitch.strikes_num === null) continue;
        const balls = Number(pitch.balls_num);
        const strikes = Number(pitch.strikes_num);
        if (!Number.isFinite(balls) || !Number.isFinite(strikes)) continue;
        const pitchCall = String(pitch.pitch_call ?? '');
        const strike = isPitchStrike(pitchCall, isPro);
        const pitchCallToken = normalizePitchCallToken(pitchCall);
        const inPlay = pitchCallToken === 'inplay' || pitchCallToken.startsWith('in_play') || pitchCallToken.startsWith('hit_into_play');

        if (balls === 0 && strikes === 0) {
          fpsDenominator += 1;
          if (strike) fpsNumerator += 1;
        }

        if (isPro) {
          if (balls === 0 && strikes === 0) eaDenominator += 1;
          const earlyContact = (
            (balls === 0 && strikes === 0) ||
            (balls === 1 && strikes === 0) ||
            (balls === 0 && strikes === 1) ||
            (balls === 1 && strikes === 1)
          ) && inPlay;
          const aheadStrike = (
            (balls === 0 && strikes === 1) ||
            (balls === 1 && strikes === 1)
          ) && strike && !inPlay;
          if (earlyContact || aheadStrike) eaNumerator += 1;
        } else {
          const isEarlyOrAheadCount = balls + strikes <= 1 || strikes > balls;
          if (isEarlyOrAheadCount) {
            eaDenominator += 1;
            if (strike) eaNumerator += 1;
          }
        }
      }
      const terminalPitch = pa.pitches[pa.pitches.length - 1];
      const recordedOuts = Number(terminalPitch?.outs_on_play_num);
      if (Number.isFinite(recordedOuts) && recordedOuts > 0) {
        outs += Math.round(recordedOuts);
      } else if (result.includes('tripleplay')) {
        outs += 3;
      } else if (result.includes('doubleplay')) {
        outs += 2;
      } else if (
        strikeoutTokens.has(result) ||
        result.includes('out') ||
        ['fielderschoice', 'forceout', 'sacrifice', 'sacrificefly', 'sacrificebunt'].includes(result)
      ) {
        outs += 1;
      }
    }
    const innings = `${Math.floor(outs / 3)}.${outs % 3}`;
    const percentage = (numerator: number, denominator: number): string =>
      denominator > 0 ? `${(100 * numerator / denominator).toFixed(1)}%` : '-';
    return `IP ${innings} · P ${pitches} · FPS ${percentage(fpsNumerator, fpsDenominator)} · E+A ${percentage(eaNumerator, eaDenominator)} · BB ${walks} · K ${strikeouts}`;
  }, [abCards, isPro]);
  const abMatchup = useMemo(() => {
    if (!abReport) return null;
    const pitches = abReport.pa_groups.flatMap((group) => group.pas.flatMap((pa) => pa.pitches));
    const mostCommon = (values: Array<string | null | undefined>): string => {
      const counts = new Map<string, number>();
      for (const raw of values) {
        const value = String(raw ?? '').trim();
        const normalized = value.toUpperCase();
        if (!value || ['ALL', 'OPP', 'OPPONENT', 'OPPONENTS', 'CAMPERS', 'PRO'].includes(normalized)) continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    };
    const selectedGame = abReport.available_games.find((game) => game.game_key === abReport.selected_game_key);
    const rawTeam = mostCommon(pitches.map((pitch) => pitch.pitcher_team_code)) || (teamType !== 'All' ? teamType : '');
    const rawOpponent = mostCommon(pitches.map((pitch) => pitch.batter_team_code)) || selectedGame?.opponent || '';
    const proLevel = (level === 'AAA' || level === 'MLB') ? level : 'All';
    const nonProTeamLabel = (value: string): string => {
      const code = value.trim().toUpperCase();
      return leagueTeamLabelByCode[code] ?? LEAGUE_TEAM_NAME_BY_CODE[code] ?? value;
    };
    const effectiveSchoolCode = String(filters?.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase();
    const schoolLabel = activeSchoolBrand.logoAlt.replace(/\s+logo$/i, '').trim() || effectiveSchoolCode;
    const teamLabel = isPro
      ? getProTeamDisplayName(rawTeam, proLevel)
      : isLeague
        ? nonProTeamLabel(rawTeam)
        : schoolLabel;
    const opponentLabel = isPro ? getProTeamDisplayName(rawOpponent, proLevel) : nonProTeamLabel(rawOpponent);
    if (!opponentLabel) return null;

    const knownSchoolLogo = (value: string): string => {
      const brand = resolveSchoolBrand(value);
      if (!brand.logoSrc || brand.logoSrc === '/pearl-clam-transparent.png') return '';
      return brand.logoSrc;
    };
    const proLogo = (value: string): string => {
      const remote = getProTeamLogoUrl(value);
      return remote ? `/api/dashboard/image-proxy?url=${encodeURIComponent(remote)}` : '';
    };
    return {
      teamLabel: teamLabel || effectiveSchoolCode || 'Team',
      teamLogo: isPro ? proLogo(rawTeam) : (!isLeague ? (activeSchoolBrand.logoSrc ?? '') : knownSchoolLogo(rawTeam)),
      opponentLabel,
      opponentLogo: isPro ? proLogo(rawOpponent) : knownSchoolLogo(rawOpponent),
    };
  }, [abReport, activeSchoolBrand.logoAlt, activeSchoolBrand.logoSrc, filters?.school_code, isLeague, isPro, leagueTeamLabelByCode, level, selectedSchoolCode, teamType]);
  const downloadAbReportPdf = useCallback(async () => {
    if (!abReportPdfRef.current || !abReport || isDownloadingAbPdf) return;
    setIsDownloadingAbPdf(true);
    setAbPdfError('');
    let exportRoot: HTMLDivElement | null = null;
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const isLightMode = document.body.classList.contains('theme-light');
      const pageBg = isLightMode ? '#ffffff' : '#05070d';
      exportRoot = abReportPdfRef.current.cloneNode(true) as HTMLDivElement;
      exportRoot.querySelectorAll('[data-ab-pdf-ignore="true"]').forEach((node) => node.remove());
      exportRoot.style.position = 'fixed';
      exportRoot.style.left = '-12000px';
      exportRoot.style.top = '0';
      exportRoot.style.width = '1200px';
      exportRoot.style.padding = '24px';
      exportRoot.style.boxSizing = 'border-box';
      exportRoot.style.background = pageBg;
      const reportLayout = exportRoot.querySelector<HTMLElement>('.portal-pitching-ab-layout');
      if (reportLayout) reportLayout.style.gridTemplateColumns = 'minmax(0, 1fr)';
      exportRoot.querySelectorAll<HTMLElement>('.portal-ab-player-pa-grid').forEach((playerGrid) => {
        const paCount = Math.max(1, playerGrid.querySelectorAll('.portal-ab-pa-card').length);
        playerGrid.style.gridTemplateColumns = `repeat(${paCount}, minmax(0, 1fr))`;
        playerGrid.style.alignItems = 'start';
        playerGrid.style.gap = '10px';
        playerGrid.style.overflow = 'visible';
      });
      exportRoot.querySelectorAll<HTMLElement>('.portal-ab-pa-card').forEach((card) => {
        card.style.height = 'auto';
        card.style.minHeight = '0';
        card.style.minWidth = '0';
        card.style.overflow = 'visible';
      });
      exportRoot.querySelectorAll<SVGElement>('.portal-ab-pa-card svg').forEach((chart) => {
        chart.style.height = '170px';
      });
      exportRoot.querySelectorAll<HTMLElement>('.portal-ab-pa-table-wrap').forEach((tableWrap) => {
        tableWrap.style.width = '100%';
        tableWrap.style.height = 'auto';
        tableWrap.style.maxHeight = 'none';
        tableWrap.style.overflow = 'hidden';
        tableWrap.style.overflowX = 'hidden';
        tableWrap.style.overflowY = 'visible';
      });
      exportRoot.querySelectorAll<HTMLTableElement>('.portal-ab-pa-table-wrap .portal-table').forEach((table) => {
        table.style.width = '100%';
        table.style.minWidth = '0';
        table.style.tableLayout = 'fixed';
        const columnWidths = ['10%', '14%', '10%', '9%', '9%', '9%', '9%', '30%'];
        table.querySelectorAll<HTMLTableCellElement>('th, td').forEach((cell) => {
          cell.style.width = columnWidths[cell.cellIndex] ?? 'auto';
          cell.style.padding = '3px 2px';
          cell.style.fontSize = '10px';
          cell.style.lineHeight = '1.16';
          cell.style.whiteSpace = 'normal';
          cell.style.overflowWrap = 'anywhere';
        });
      });
      document.body.appendChild(exportRoot);

      const inlineLogoAsPng = async (logo: HTMLImageElement): Promise<void> => {
        const source = String(logo.getAttribute('src') || logo.src || '').trim();
        if (!source || source.startsWith('data:image/png')) return;
        let objectUrl = '';
        try {
          const response = await fetch(source, { cache: 'force-cache' });
          if (!response.ok) return;
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          const decoded = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Failed to decode team logo.'));
            image.src = objectUrl;
          });
          const targetWidth = Math.max(1, logo.clientWidth || 30);
          const targetHeight = Math.max(1, logo.clientHeight || 30);
          const exportScale = 4;
          const logoCanvas = document.createElement('canvas');
          logoCanvas.width = Math.round(targetWidth * exportScale);
          logoCanvas.height = Math.round(targetHeight * exportScale);
          const context = logoCanvas.getContext('2d');
          if (!context) return;
          const sourceWidth = Math.max(1, decoded.naturalWidth || decoded.width);
          const sourceHeight = Math.max(1, decoded.naturalHeight || decoded.height);
          const containScale = Math.min(logoCanvas.width / sourceWidth, logoCanvas.height / sourceHeight);
          const renderedWidth = sourceWidth * containScale;
          const renderedHeight = sourceHeight * containScale;
          context.drawImage(
            decoded,
            (logoCanvas.width - renderedWidth) / 2,
            (logoCanvas.height - renderedHeight) / 2,
            renderedWidth,
            renderedHeight
          );
          logo.removeAttribute('srcset');
          logo.src = logoCanvas.toDataURL('image/png');
        } catch {
          // Keep the original source when rasterization fails.
        } finally {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
      };
      await Promise.all(Array.from(exportRoot.querySelectorAll('img')).map(inlineLogoAsPng));
      await Promise.all(
        Array.from(exportRoot.querySelectorAll('img')).map((img) =>
          img.complete && img.naturalWidth > 0
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              })
        )
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 18;
      const drawWidth = pageWidth - margin * 2;
      const pageBottom = pageHeight - margin;
      const rowGap = 10;
      const fillPage = () => {
        pdf.setFillColor(isLightMode ? 255 : 5, isLightMode ? 255 : 7, isLightMode ? 255 : 13);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      };
      const capture = (element: HTMLElement) => html2canvas(element, {
        backgroundColor: pageBg,
        scale: 2,
        useCORS: true,
      });
      const header = exportRoot.querySelector<HTMLElement>('.portal-ab-report-header');
      const playerRows = Array.from(exportRoot.querySelectorAll<HTMLElement>('.portal-ab-player-row'));
      if (!header || !playerRows.length) throw new Error('AB report export content is incomplete.');

      const headerCanvas = await capture(header);
      const headerScale = drawWidth / headerCanvas.width;
      const headerHeight = headerCanvas.height * headerScale;
      const headerImage = headerCanvas.toDataURL('image/png');
      const rowStartY = margin + headerHeight + rowGap;
      const rowSlotHeight = (pageBottom - rowStartY - rowGap) / 2;
      const startPage = () => {
        fillPage();
        pdf.addImage(headerImage, 'PNG', margin, margin, drawWidth, headerHeight, undefined, 'FAST');
      };
      startPage();

      for (let rowIndex = 0; rowIndex < playerRows.length; rowIndex += 1) {
        if (rowIndex > 0 && rowIndex % 2 === 0) {
          pdf.addPage('letter', 'landscape');
          startPage();
        }
        const playerRow = playerRows[rowIndex];
        const rowCanvas = await capture(playerRow);
        const rowScale = Math.min(drawWidth / rowCanvas.width, rowSlotHeight / rowCanvas.height);
        const rowWidth = rowCanvas.width * rowScale;
        const rowHeight = rowCanvas.height * rowScale;
        const slotIndex = rowIndex % 2;
        const slotY = rowStartY + slotIndex * (rowSlotHeight + rowGap);
        pdf.addImage(
          rowCanvas.toDataURL('image/png'),
          'PNG',
          (pageWidth - rowWidth) / 2,
          slotY + Math.max(0, (rowSlotHeight - rowHeight) / 2),
          rowWidth,
          rowHeight,
          undefined,
          'FAST'
        );
        rowCanvas.width = 1;
        rowCanvas.height = 1;
      }
      headerCanvas.width = 1;
      headerCanvas.height = 1;

      const safePitcher = formatNameFirstLast(selectedSinglePitcher || abReport.pitcher || 'pitcher')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      pdf.save(`${safePitcher || 'pitcher'}-ab-report-${abReport.selected_game_date || 'game'}.pdf`);
    } catch (pdfError) {
      setAbPdfError(pdfError instanceof Error ? pdfError.message : 'Failed to download the AB report PDF.');
    } finally {
      exportRoot?.remove();
      setIsDownloadingAbPdf(false);
    }
  }, [abReport, isDownloadingAbPdf, selectedSinglePitcher]);
  const proxiedProTeamLogoUrl = useCallback((teamCodeLike: string | null | undefined): string => {
    const remoteLogoUrl = getProTeamLogoUrl(teamCodeLike);
    if (!remoteLogoUrl) return '';
    return `/api/dashboard/image-proxy?url=${encodeURIComponent(remoteLogoUrl)}`;
  }, []);
  const summaryTeamLogoUrl = useMemo(() => {
    if (!isPro || dashboardPage !== 'Summary') return '';
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    let teamCode = '';
    if (selectedSinglePitcher) {
      const key = String(selectedSinglePitcher ?? '').trim();
      const formatted = formatNameFirstLast(key);
      teamCode =
        latestTeamByPitcher[key] ??
        latestTeamByPitcher[formatted] ??
        latestTeamByPitcher[norm(key)] ??
        latestTeamByPitcher[norm(formatted)] ??
        filterTeamByPitcher[key] ??
        filterTeamByPitcher[formatted] ??
        filterTeamByPitcher[norm(key)] ??
        filterTeamByPitcher[norm(formatted)] ??
        '';
    }
    if (!teamCode && teamType && teamType !== 'All') {
      teamCode = inferProTeamCode(teamType);
    }
    return proxiedProTeamLogoUrl(teamCode) || '';
  }, [isPro, dashboardPage, selectedSinglePitcher, latestTeamByPitcher, filterTeamByPitcher, teamType, proxiedProTeamLogoUrl]);
  const gameLogHeader = useMemo(() => {
    const selected = selectedPitchers.filter((value) => value !== 'All');
    const primaryLabel = selected.length === 1
      ? formatNameFirstLast(selected[0])
      : (teamType && teamType !== 'All'
        ? (isPro ? getProTeamDisplayName(teamType, (level as 'MLB' | 'AAA' | 'All') || 'All') : (leagueTeamLabelByCode[teamType.toUpperCase()] ?? teamType))
        : 'Selection');
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    let teamCode = '';
    if (selected.length === 1) {
      const key = String(selected[0] ?? '').trim();
      const formatted = formatNameFirstLast(key);
      teamCode =
        latestTeamByPitcher[key] ??
        latestTeamByPitcher[formatted] ??
        latestTeamByPitcher[norm(key)] ??
        latestTeamByPitcher[norm(formatted)] ??
        filterTeamByPitcher[key] ??
        filterTeamByPitcher[formatted] ??
        filterTeamByPitcher[norm(key)] ??
        filterTeamByPitcher[norm(formatted)] ??
        '';
    }
    if (!teamCode && teamType && teamType !== 'All') {
      teamCode = inferProTeamCode(teamType);
    }
    return {
      label: `Game Log: ${primaryLabel}`,
      logoUrl: isPro ? (proxiedProTeamLogoUrl(teamCode) || '') : '',
    };
  }, [selectedPitchers, teamType, isPro, level, leagueTeamLabelByCode, latestTeamByPitcher, filterTeamByPitcher, proxiedProTeamLogoUrl]);
  const pitchLogHeader = useMemo(() => ({
    label: gameLogHeader.label.replace(/^Game Log:/, 'Pitch Log:'),
    logoUrl: gameLogHeader.logoUrl,
  }), [gameLogHeader]);
  const formatPitchingTableDisplayValue = useCallback(
    (column: string, value: unknown) => {
      if (isPro && normalizePercentileColumnToken(column) === normalizePercentileColumnToken('Side')) {
        const numeric = parseSortableNumber(value);
        if (numeric !== null) return formatTableDisplayValue(column, -numeric);
      }
      return formatTableDisplayValue(column, value);
    },
    [isPro]
  );
  const formatTeamLabel = useCallback((value: unknown): string => {
    const raw = String(value ?? '').trim();
    if (!raw) return '-';
    if (isPro) return raw;
    const upper = raw.toUpperCase();
    const leagueLabel = leagueTeamLabelByCode[upper];
    if (leagueLabel) return leagueLabel;
    const knownSchool = schoolNameFromCodeIfKnown(upper);
    if (knownSchool) return knownSchool;
    const fromTeamCode = schoolNameFromTeamCodeFallback(upper);
    if (fromTeamCode) return fromTeamCode;
    return raw;
  }, [isPro, leagueTeamLabelByCode]);
  const formatPitchLogCellDisplayValue = useCallback((column: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return '-';
    const token = normalizePercentileColumnToken(column);
    if (token === 'rtilt' || token === 'releasetilt' || token === 'btilt' || token === 'breaktilt') {
      return formatTiltClock(String(value ?? ''));
    }
    const numeric = parseSortableNumber(value);
    if (numeric === null) return formatPitchingTableDisplayValue(column, value);
    const adjusted = (isPro && token === 'side') ? -numeric : numeric;
    if (token === 'spineff') {
      const normalizedSpinEff = Math.abs(adjusted) <= 1 ? adjusted * 100 : adjusted;
      return `${normalizedSpinEff.toFixed(1)}%`;
    }
    if (PITCH_LOG_PERCENT_TOKENS.has(token)) return `${adjusted.toFixed(1)}%`;
    if (PITCH_LOG_ZERO_DECIMAL_TOKENS.has(token)) return String(Math.round(adjusted));
    if (PITCH_LOG_ONE_DECIMAL_TOKENS.has(token)) return adjusted.toFixed(1);
    if (PITCH_LOG_TWO_DECIMAL_TOKENS.has(token)) return adjusted.toFixed(2);
    return formatPitchingTableDisplayValue(column, value);
  }, [formatPitchingTableDisplayValue, isPro]);
  const sortedManualEntries = useMemo(
    () =>
      sortTableRows(
        manualEntries.map((entry) => ({
          ...entry,
          Date: entry.entry_date,
          Pitcher: entry.pitcher,
          'Throw Type': entry.throw_type,
          'Plyo Drill': entry.plyo_drill,
          'Ball (oz)': entry.ball_weight_oz,
          'Velo (mph)': entry.velocity_mph,
          Notes: entry.notes,
        })),
        manualEntriesSortColumn,
        manualEntriesSortDirection
      ) as Array<ManualVelocityEntry & Record<string, unknown>>,
    [manualEntries, manualEntriesSortColumn, manualEntriesSortDirection]
  );
  const sortedManualFilteredEntries = useMemo(
    () =>
      sortTableRows(
        manualFilteredEntries.map((entry) => ({
          ...entry,
          Date: entry.entry_date,
          Pitcher: entry.pitcher,
          'Throw Type': entry.throw_type,
          'Plyo Drill': entry.plyo_drill,
          'Ball (oz)': entry.ball_weight_oz,
          'Velo (mph)': entry.velocity_mph,
        })),
        manualProgressSortColumn,
        manualProgressSortDirection
      ) as Array<ManualVelocityEntry & Record<string, unknown>>,
    [manualFilteredEntries, manualProgressSortColumn, manualProgressSortDirection]
  );
  const availableCustomColumns = useMemo(
    () =>
      (() => {
        const base = overview?.available_table_columns?.length ? overview.available_table_columns : FALLBACK_AVAILABLE_CUSTOM_COLUMNS;
        return base.includes('PV/100') ? base : [...base, 'PV/100'];
      })(),
    [overview?.available_table_columns]
  );
  const correlationAxisColumns = useMemo(() => {
    const set = new Set<string>();
    for (const column of availableCustomColumns) {
      const value = String(column ?? '').trim();
      if (value) set.add(value);
    }
    for (const column of displayedTableColumns.slice(1)) {
      const value = String(column ?? '').trim();
      if (value) set.add(value);
    }
    return Array.from(set);
  }, [availableCustomColumns, displayedTableColumns]);
  useEffect(() => {
    // Correlation rows are now fetched on-demand in the modal by selected X/Y axes.
    // Keep these arrays cleared to avoid expensive "all stats" custom fetches.
    setCorrelationAllStatColumns([]);
    setCorrelationAllStatRows([]);
    return;
  }, [showLeaderboardCorrelation, dashboardPage, correlationOverviewBaseQuery, correlationAxisColumns, displayedTableColumns]);
  const remainingCustomColumns = useMemo(
    () => availableCustomColumns.filter((column) => !customTableColumns.includes(column)),
    [availableCustomColumns, customTableColumns]
  );

  const pitchTypeForRow = (row: Record<string, string | number | null>): string => {
    if (splitBy !== 'Pitch Types') return 'all';
    const raw = row[splitColName];
    if (raw === null || raw === undefined) return 'all';
    const asText = String(raw).trim();
    if (!asText || asText.toLowerCase() === 'all') return 'all';
    return asText;
  };

  const getTableCellStyle = (
    row: Record<string, string | number | null>,
    column: string
  ): { backgroundColor: string; color: string } | null => {
    const thresholdPitchType = isLeaderboardPage ? 'all' : pitchTypeForRow(row);
    if (column === splitColName && effectiveSplitBy === 'Pitch Types') {
      const pitchType = pitchTypeForRow(row);
      if (pitchType === 'all') return null;
      const bg = pitchColors[pitchType];
      if (!bg) return null;
      return { backgroundColor: bg, color: pitchHoverTextColor(bg) };
    }
    if (!shouldColorTable) return null;
    const normalizedColumn = normalizeColorColumnName(column);
    if (!tableColorColumnSet.has(normalizedColumn)) return null;
    const effectiveSchoolCode = String(overview?.school_code ?? selectedSchoolCode ?? '').trim().toUpperCase();
    const colors = getCellColorScale(row[column], normalizedColumn, thresholdPitchType, effectiveSchoolCode);
    if (!colors) return null;
    return { backgroundColor: colors.bg, color: colors.text };
  };

  const downloadLeaderboardCsv = useCallback(() => {
    if (!leaderboardRowsWithPins.length || !displayedTableColumns.length) return;
    const headers = ['Rank', ...displayedTableColumns];
    const lines: string[] = [headers.map(csvEscape).join(',')];
    let rankCounter = 0;
    for (const row of leaderboardRowsWithPins) {
      const rowKey = String(row[displayedTableColumns[0] ?? ''] ?? '').trim();
      const isAllRow = rowKey.toLowerCase() === 'all';
      const isPinnedAllRow = rowKey.toLowerCase() === 'all (pinned)';
      const rank = isAllRow || isPinnedAllRow ? '' : String(++rankCounter);
      const cells = displayedTableColumns.map((column, colIndex) => {
        const rawValue = row[column] ?? '-';
        if (colIndex === 0) {
          const formatted = typeof rawValue === 'string' ? formatNameFirstLast(rawValue) : String(rawValue);
          if (leaderboardViewBy !== 'Player') return formatTeamLabel(rawValue) || formatted;
          return formatted;
        }
        if (leaderboardStatView === 'Percentile' && !isAllRow && !isPinnedAllRow) {
          const percentile = getCellPercentile(row, column, rawValue);
          if (percentile !== null) return `${percentile.toFixed(1)}%`;
        }
        return formatPitchingTableDisplayValue(column, rawValue);
      });
      lines.push([rank, ...cells].map(csvEscape).join(','));
    }
    downloadTextFile(lines.join('\n'), `leaderboard-${toYmdNow()}.csv`, 'text/csv;charset=utf-8');
  }, [
    leaderboardRowsWithPins,
    displayedTableColumns,
    leaderboardViewBy,
    leaderboardStatView,
    formatTeamLabel,
    formatPitchingTableDisplayValue,
    getCellPercentile,
  ]);

  return (
    <section className="portal-panel portal-admin-panel" style={{ padding: '1rem' }}>
      <div
        className="portal-dashboard-suite-layout"
        style={
          isSidebarHidden
            ? { gridTemplateColumns: 'minmax(0, 1fr)' }
            : undefined
        }
      >
        {!isSidebarHidden ? (
          <article
            className={`portal-admin-card portal-dashboard-sidebar${isLeaderboardPage ? ' portal-dashboard-sidebar--compact' : ''}`}
            style={dashboardPage === 'AB Report' ? { minHeight: 'auto', height: 'fit-content', alignSelf: 'start' } : undefined}
          >
          <button type="button" className="btn btn-ghost" onClick={() => setIsSidebarHidden(true)}>
            Hide Filters
          </button>

          {loadingFilters || (!error && !filters) ? <p>Loading filters...</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}
          {!loadingFilters && !error && !filters ? <p className="auth-error">Failed to load dashboard filters.</p> : null}

          {filters ? (
            <>
              <div className="portal-form-grid">
                <label>
                  Start Date
                  <NativeDateInput value={startDate} onChange={setStartDate} ariaLabel="Start Date" />
                </label>
                <label>
                  End Date
                  <NativeDateInput value={endDate} onChange={setEndDate} ariaLabel="End Date" />
                </label>

                <label>
                  Team
                  <SearchableSingleSelect
                    options={toOptions(filters.team_types)}
                    value={teamType}
                    onChange={setTeamType}
                    placeholder="All"
                  />
                </label>
                {isPro || isLeague ? (
                  <label>
                    Level
                    <SearchableSingleSelect
                      options={toOptions(!isPro ? collegeLevelPercentileOptions : (filters.level_options ?? PRO_LEVEL_FILTER_OPTIONS))}
                      value={level}
                      onChange={setLevel}
                      placeholder={isPro ? 'MLB' : 'D1'}
                    />
                  </label>
                ) : (
                  <label>
                    Level
                    <SearchableSingleSelect
                      options={toOptions(PRO_LEVEL_FILTER_OPTIONS)}
                      value={PRO_LEVEL_FILTER_OPTIONS.includes(level) ? level : 'All'}
                      onChange={setLevel}
                      placeholder="All"
                    />
                  </label>
                )}
                {!isPro && !isLeague ? (
                  <label>
                    Session Type
                    <SearchableSingleSelect
                      options={[
                        { value: '', label: 'All' },
                        { value: 'Season', label: 'Season' },
                        { value: 'Bullpen', label: 'Bullpen' },
                        { value: 'Live BP', label: 'Live BP' },
                      ]}
                      value={sessionType}
                      onChange={setSessionType}
                      placeholder="All"
                    />
                  </label>
                ) : null}
                <label>
                  Pitchers
                  <SearchableMultiSelect options={pitcherOptions} values={selectedPitchers} onChange={setSelectedPitchers} />
                </label>
                <label>
                  Hitters
                  <SearchableMultiSelect options={hitterOptions} values={selectedHitters} onChange={setSelectedHitters} />
                </label>
                <label>
                  Pitcher Hand
                  <SearchableSingleSelect options={toOptions(filters.hands)} value={hand} onChange={setHand} placeholder="All" />
                </label>
                <label>
                  Batter Hand
                  <SearchableSingleSelect
                    options={toOptions(filters.batter_sides)}
                    value={batterSide}
                    onChange={setBatterSide}
                    placeholder="All"
                  />
                </label>
                <label>
                  Pitch Type
                  <SearchableMultiSelect
                    options={pitchTypeOptions}
                    values={selectedPitchTypes}
                    onChange={setSelectedPitchTypes}
                  />
                </label>
                {!isPro && !isLeague ? (
                  <label>
                    Ball Type
                    <SearchableMultiSelect
                      options={ballTypeOptions}
                      values={selectedBallTypes}
                      onChange={setSelectedBallTypes}
                    />
                  </label>
                ) : null}
                <label>
                  Pitch Results
                  <SearchableMultiSelect
                    options={pitchResultOptions}
                    values={selectedPitchResults}
                    onChange={setSelectedPitchResults}
                  />
                </label>
                <label>
                  QP Locations
                  <SearchableSingleSelect
                    options={toOptions(filters.qp_location_options)}
                    value={qpLocations}
                    onChange={setQpLocations}
                    placeholder="All"
                  />
                </label>
                <label>
                  Break Lines
                  <SearchableSingleSelect
                    options={toOptions(filters.break_lines_options)}
                    value={breakLines}
                    onChange={setBreakLines}
                    placeholder="None"
                  />
                </label>
                {breakLines === 'Fastball' || breakLines === 'Sinker' ? (
                  <label>
                    Break Lines Level
                    <SearchableSingleSelect
                      options={toOptions(BREAK_LINES_LEVEL_OPTIONS)}
                      value={breakLinesLevel}
                      onChange={setBreakLinesLevel}
                      placeholder="MLB"
                    />
                  </label>
                ) : null}
                <label>
                  Zone Location
                  <SearchableMultiSelect
                    options={zoneLocationOptions}
                    values={selectedZoneLocations}
                    onChange={setSelectedZoneLocations}
                  />
                </label>
                <label>
                  In Zone
                  <SearchableMultiSelect options={inZoneOptions} values={selectedInZone} onChange={setSelectedInZone} />
                </label>
                <label>
                  Count
                  <SearchableMultiSelect options={countOptions} values={selectedCountFilters} onChange={setSelectedCountFilters} />
                </label>
                <label>
                  After Count
                  <SearchableMultiSelect
                    options={afterCountOptions}
                    values={selectedAfterCountFilters}
                    onChange={setSelectedAfterCountFilters}
                  />
                </label>
              </div>

              <div className="portal-form-grid" style={{ marginTop: '0.8rem' }}>
                <label>
                  With Video
                  <SearchableSingleSelect
                    options={toOptions(filters.with_video_options)}
                    value={withVideo}
                    onChange={setWithVideo}
                    placeholder="All"
                  />
                </label>
                <label>
                  Venue
                  <SearchableSingleSelect
                    options={toOptions(['All', 'Home', 'Away'])}
                    value={venue}
                    onChange={setVenue}
                    placeholder="All"
                  />
                </label>
                <label>
                  Stuff+ Level
                  <SearchableSingleSelect
                    options={toOptions(filters.stuff_level_options)}
                    value={stuffLevel}
                    onChange={setStuffLevel}
                    placeholder="College"
                  />
                </label>
                <label>
                  Stuff+ Base Pitch
                  <SearchableSingleSelect
                    options={toOptions(filters.stuff_base_options)}
                    value={stuffBase}
                    onChange={setStuffBase}
                    placeholder="Fastball"
                  />
                </label>
                <label>
                  Velo Min
                  <input type="number" value={veloMin} onChange={(event) => setVeloMin(event.target.value)} />
                </label>
                <label>
                  Velo Max
                  <input type="number" value={veloMax} onChange={(event) => setVeloMax(event.target.value)} />
                </label>
                <label>
                  IVB Min
                  <input type="number" value={ivbMin} onChange={(event) => setIvbMin(event.target.value)} />
                </label>
                <label>
                  IVB Max
                  <input type="number" value={ivbMax} onChange={(event) => setIvbMax(event.target.value)} />
                </label>
                <label>
                  HB Min
                  <input type="number" value={hbMin} onChange={(event) => setHbMin(event.target.value)} />
                </label>
                <label>
                  HB Max
                  <input type="number" value={hbMax} onChange={(event) => setHbMax(event.target.value)} />
                </label>
                <label>
                  Pitch Count Min
                  <input type="number" value={pcMin} onChange={(event) => setPcMin(event.target.value)} />
                </label>
                <label>
                  Pitch Count Max
                  <input type="number" value={pcMax} onChange={(event) => setPcMax(event.target.value)} />
                </label>
                <label>
                  BF Min
                  <input type="number" value={bfMin} onChange={(event) => setBfMin(event.target.value)} />
                </label>
                <label>
                  BF Max
                  <input type="number" value={bfMax} onChange={(event) => setBfMax(event.target.value)} />
                </label>
                <label>
                  IP Min
                  <input type="number" step="0.1" value={ipMin} onChange={(event) => setIpMin(event.target.value)} />
                </label>
                <label>
                  IP Max
                  <input type="number" step="0.1" value={ipMax} onChange={(event) => setIpMax(event.target.value)} />
                </label>
              </div>

              <div
                className="portal-form-grid"
                style={{ marginTop: '0.8rem', gridTemplateColumns: 'minmax(220px, 320px)', justifyContent: 'center' }}
              >
                <label>
                  Display Option
                  <SearchableSingleSelect
                    options={[
                      { value: 'Play Video', label: 'Play Video' },
                      ...(canUsePitchEdits ? [{ value: 'Pitch Edit', label: 'Pitch Edit' }] : []),
                      { value: 'Spin Visual', label: 'Spin Visual' },
                    ]}
                    value={visualOption}
                    onChange={setVisualOption}
                    placeholder="Play Video"
                  />
                </label>
              </div>
              {isPitchEditDisplay ? (
                <div className="portal-form-grid" style={{ marginTop: '0.55rem' }}>
                  <label>
                    Pitch Edit Selection
                    <SearchableSingleSelect
                      options={[
                        { value: 'single', label: 'Single Click' },
                        { value: 'lasso', label: 'Lasso Drag' },
                      ]}
                      value={pitchEditSelectMode}
                      onChange={(next) => setPitchEditSelectMode((next as PitchEditSelectMode) || 'single')}
                      placeholder="Single Click"
                    />
                  </label>
                </div>
              ) : null}
              {canUsePitchEdits ? (
                <div style={{ marginTop: '0.8rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.12)' }}>
                  <p className="portal-muted-text" style={{ margin: 0 }}>
                    Pitch edits applied to database: <strong>{pitchEditsAppliedCount}</strong>
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
          </article>
        ) : null}

        <article className="portal-admin-card" style={{ alignContent: 'start' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            {isMobileView ? (
              <label className="portal-mobile-control-row">
                <span>Page</span>
                <select
                  className="portal-mobile-page-select"
                  value={dashboardPage}
                  onChange={(event) => setDashboardPage(event.target.value as typeof dashboardPage)}
                >
                  <option value="Summary">Summary</option>
                  <option value="Leaderboard">Leaderboard</option>
                  <option value="Game Log">Game Log</option>
                  <option value="Pitch Log">Pitch Log</option>
                  <option value="AB Report">AB Report</option>
                  {canShowLeagueHeavyPages ? <option value="Velocity">Velocity</option> : null}
                  {canShowLeagueHeavyPages ? <option value="Trend">Trend</option> : null}
                  <option value="HeatMaps">HeatMaps</option>
                  {canShowQpLocationsTab ? <option value="QP Locations">QP Locations</option> : null}
                  {canShowVeloManualEntry ? <option value="Velo Manual Entry">Velo Manual Entry</option> : null}
                  <option value="Pitcher DNA">Pitcher DNA</option>
                </select>
              </label>
            ) : (
              <div className="portal-suite-page-tabs" style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={dashboardPage === 'Summary' ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => setDashboardPage('Summary')}
                >
                  Summary
                </button>
                <button
                  type="button"
                  className={dashboardPage === 'Leaderboard' ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => setDashboardPage('Leaderboard')}
                >
                  Leaderboard
                </button>
                <button
                  type="button"
                  className={dashboardPage === 'Game Log' ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => setDashboardPage('Game Log')}
                >
                  Game Log
                </button>
                <button
                  type="button"
                  className={dashboardPage === 'Pitch Log' ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => setDashboardPage('Pitch Log')}
                >
                  Pitch Log
                </button>
                <button
                  type="button"
                  className={dashboardPage === 'AB Report' ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => setDashboardPage('AB Report')}
                >
                  AB Report
                </button>
                {canShowLeagueHeavyPages ? (
                  <button
                    type="button"
                    className={dashboardPage === 'Velocity' ? 'btn btn-primary' : 'btn btn-ghost'}
                    onClick={() => setDashboardPage('Velocity')}
                  >
                    Velocity
                  </button>
                ) : null}
                {canShowLeagueHeavyPages ? (
                  <button
                    type="button"
                    className={dashboardPage === 'Trend' ? 'btn btn-primary' : 'btn btn-ghost'}
                    onClick={() => setDashboardPage('Trend')}
                  >
                    Trend
                  </button>
                ) : null}
                <button
                  type="button"
                  className={dashboardPage === 'HeatMaps' ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => setDashboardPage('HeatMaps')}
                >
                  HeatMaps
                </button>
                {canShowQpLocationsTab ? (
                  <button
                    type="button"
                    className={dashboardPage === 'QP Locations' ? 'btn btn-primary' : 'btn btn-ghost'}
                    onClick={() => setDashboardPage('QP Locations')}
                  >
                    QP Locations
                  </button>
                ) : null}
                {canShowVeloManualEntry ? (
                  <button
                    type="button"
                    className={dashboardPage === 'Velo Manual Entry' ? 'btn btn-primary' : 'btn btn-ghost'}
                    onClick={() => setDashboardPage('Velo Manual Entry')}
                  >
                    Velo Manual Entry
                  </button>
                ) : null}
                <button
                  type="button"
                  className={dashboardPage === 'Pitcher DNA' ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => setDashboardPage('Pitcher DNA')}
                >
                  Pitcher DNA
                </button>
              </div>
            )}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              {!isMobileView && isLeaderboardPage ? (
                <>
                  <select
                    value={leaderboardExportFormat}
                    onChange={(event) => setLeaderboardExportFormat(event.target.value as 'PDF' | 'CSV')}
                    style={{ minHeight: 38, borderRadius: 8, padding: '0 0.5rem' }}
                    aria-label="Export format"
                  >
                    <option value="PDF">PDF</option>
                    <option value="CSV">CSV</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      if (leaderboardExportFormat === 'CSV') {
                        downloadLeaderboardCsv();
                      } else {
                        void downloadLeaderboardPdf();
                      }
                    }}
                    disabled={isExportingLeaderboardPdf || loadingOverview || !leaderboardRowsWithPins.length}
                  >
                    {isExportingLeaderboardPdf ? 'Downloading...' : `Download ${leaderboardExportFormat}`}
                  </button>
                </>
              ) : null}
              {isMobileView ? (
                <button type="button" className="btn btn-ghost" onClick={() => setIsSidebarHidden((value) => !value)}>
                  {isSidebarHidden ? 'Show Filters' : 'Hide Filters'}
                </button>
              ) : isSidebarHidden ? (
                <button type="button" className="btn btn-ghost" onClick={() => setIsSidebarHidden(false)}>
                  Show Filters
                </button>
              ) : null}
            </div>
          </div>
          {dashboardPage === 'Summary' || dashboardPage === 'Leaderboard' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <h3 style={{ margin: 0 }}>{overviewHeaderLabel}</h3>
                {summaryTeamLogoUrl ? (
                  <img
                    src={summaryTeamLogoUrl}
                    alt="Team"
                    style={{ width: 42, height: 42, objectFit: 'contain', flexShrink: 0 }}
                  />
                ) : null}
              </div>
              {loadingOverview ? <p>Loading pitching data...</p> : null}
              {overview ? (
                <>
              {!isLeaderboardPage ? (
              <>
              <div
                className="portal-admin-grid"
                style={{ gridTemplateColumns: 'repeat(3, minmax(260px, 1fr))', alignItems: 'start', marginBottom: '1rem' }}
              >
                <article className="portal-day-card" style={{ alignContent: 'start', gridTemplateRows: 'auto 40px auto' }}>
                  <h4 style={{ margin: '0 0 0.45rem 0', textAlign: 'center' }}>Release</h4>
                  <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, height: 40, marginBottom: 8 }}>
                    <SearchableSingleSelect
                      options={[
                        { value: 'Averages Only', label: 'Averages Only' },
                        { value: 'Averages and Pitches', label: 'Averages and Pitches' },
                        { value: 'Pitches', label: 'Pitches' },
                      ]}
                      value={releaseView}
                      onChange={setReleaseView}
                      placeholder="Averages Only"
                    />
                  </div>
                  <div style={{ position: 'relative' }}>
                    {hideLeagueSummaryCharts ? (
                      <p className="portal-muted-text" style={{ textAlign: 'center', margin: '0.5rem 0 0.75rem' }}>
                        Select a team or player to view chart data.
                      </p>
                    ) : (
                      releaseSvg
                    )}
                    {releaseHover ? (
                      <div
                        style={{
                          position: 'fixed',
                          left: releaseHover.x + 12,
                          top: releaseHover.y + 12,
                          zIndex: 80,
                          pointerEvents: 'none',
                          whiteSpace: 'pre-line',
                          background: releaseHover.bg ?? 'rgba(0,0,0,0.92)',
                          border: '1px solid rgba(255,255,255,0.22)',
                          borderRadius: 8,
                          padding: '0.35rem 0.45rem',
                          fontSize: '0.74rem',
                          lineHeight: 1.25,
                          color: pitchHoverTextColor(releaseHover.bg),
                        }}
                      >
                        {releaseHover.text}
                      </div>
                    ) : null}
                  </div>
                </article>
                <article className="portal-day-card" style={{ alignContent: 'start', gridTemplateRows: 'auto 40px auto' }}>
                  <h4 style={{ margin: '0 0 0.45rem 0', textAlign: 'center' }}>Movement</h4>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 0.8fr) auto',
                      alignItems: 'stretch',
                      gap: 8,
                      height: 40,
                      marginBottom: 8,
                    }}
                  >
                    <SearchableSingleSelect
                      options={[
                        { value: 'Averages Only', label: 'Averages Only' },
                        { value: 'Averages and Pitches', label: 'Averages and Pitches' },
                        {
                          value: 'Actual Movement — Individual Pitches',
                          label: 'Actual Movement — Individual Pitches',
                        },
                        {
                          value: 'Expected vs Actual — Averages',
                          label: 'Expected vs Actual — Averages',
                        },
                        {
                          value: 'Expected vs Actual — Individual Pitches',
                          label: 'Expected vs Actual — Individual Pitches',
                        },
                        {
                          value: 'Magnus Movement — Individual Pitches',
                          label: 'Magnus Movement — Individual Pitches',
                        },
                        { value: 'Target Shapes Only', label: 'Target Shapes Only' },
                        { value: 'Target Shapes and Pitches', label: 'Target Shapes and Pitches' },
                      ]}
                      value={movementView}
                      onChange={setMovementView}
                      placeholder="Averages and Pitches"
                    />
                    <SearchableSingleSelect
                      options={[
                        { value: 'Off', label: 'Magnus Line: Off' },
                        { value: 'Fastball', label: 'Magnus Line: Fastball' },
                        { value: 'Sinker', label: 'Magnus Line: Sinker' },
                      ]}
                      value={magnusLine}
                      onChange={(next) => {
                        if (next === 'Off' || next === 'Fastball' || next === 'Sinker') {
                          setMagnusLine(next);
                        }
                      }}
                      placeholder="Magnus Line: Off"
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ height: 40, paddingInline: '0.85rem', whiteSpace: 'nowrap' }}
                      onClick={() => setShowTargetSettings(true)}
                    >
                      Settings
                    </button>
                  </div>
                  <div style={{ position: 'relative' }}>
                    {hideLeagueSummaryCharts ? (
                      <p className="portal-muted-text" style={{ textAlign: 'center', margin: '0.5rem 0 0.75rem' }}>
                        Select a team or player to view chart data.
                      </p>
                    ) : (
                      movementSvg
                    )}
                    {movementHover ? (
                      <div
                        style={{
                          position: 'fixed',
                          left: movementHover.x + 12,
                          top: movementHover.y + 12,
                          zIndex: 80,
                          pointerEvents: 'none',
                          whiteSpace: 'pre-line',
                          background: movementHover.bg ?? 'rgba(0,0,0,0.92)',
                          border: '1px solid rgba(255,255,255,0.22)',
                          borderRadius: 8,
                          padding: '0.35rem 0.45rem',
                          fontSize: '0.74rem',
                          lineHeight: 1.25,
                          color: pitchHoverTextColor(movementHover.bg),
                        }}
                      >
                        {movementHover.text}
                      </div>
                    ) : null}
                    {(breakLines === 'Fastball' || breakLines === 'Sinker') && breakLineOffsetsFallback ? (
                      <p
                        className="portal-muted-text"
                        style={{ textAlign: 'center', fontSize: '0.72rem', margin: '0.35rem 0 0' }}
                      >
                        Limited {breakLinesLevel === 'ALL' ? '' : `${breakLinesLevel} `}sample for this fastball shape — break lines blended with all levels.
                      </p>
                    ) : null}
                    {showComparisonDots || (showComparisonMagnusLine && magnusLine !== 'Off') ? (
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem 1rem',
                          fontSize: '0.74rem',
                          marginTop: 6,
                          color: 'rgba(255,255,255,0.75)',
                        }}
                      >
                        {showComparisonDots ? (
                          <>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: '50%',
                                  background: 'rgba(255,255,255,0.55)',
                                  display: 'inline-block',
                                }}
                              />
                              Current player
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: '50%',
                                  background: '#a3e635',
                                  display: 'inline-block',
                                }}
                              />
                              {comparisonScopeLabel} average
                            </span>
                          </>
                        ) : null}
                        {showComparisonMagnusLine && magnusLine !== 'Off' ? (
                          <>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 16, height: 0, borderTop: `2px dashed ${pitchColors[magnusLine] ?? '#e2e8f0'}`, display: 'inline-block' }} />
                              Current player&apos;s Magnus line
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 16, height: 0, borderTop: '2px dotted #a3e635', display: 'inline-block' }} />
                              {comparisonScopeLabel} Magnus line
                            </span>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
                <article className="portal-day-card" style={{ alignContent: 'start', gridTemplateRows: 'auto 40px auto' }}>
                  <h4 style={{ margin: '0 0 0.45rem 0', textAlign: 'center' }}>HeatMaps</h4>
                  <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'stretch', height: 40, marginBottom: 8 }}>
                    <SearchableSingleSelect
                      options={summaryHeatmapOptions}
                      value={locationView}
                      onChange={(next) => {
                        summaryLocationViewTouchedRef.current = true;
                        setLocationView(next);
                      }}
                      placeholder="Pitch"
                    />
                  </div>
                  <div style={{ position: 'relative' }}>
                    {hideLeagueSummaryCharts ? (
                      <p className="portal-muted-text" style={{ textAlign: 'center', margin: '0.5rem 0 0.75rem' }}>
                        Select a team or player to view chart data.
                      </p>
                    ) : locationView !== 'Pitch' ? (
                      <div style={{ display: 'grid', justifyItems: 'center', gap: 4, marginBottom: 6 }}>
                        <div
                          style={{
                            width: 220,
                            height: 20,
                            border: '1px solid rgba(255,255,255,0.25)',
                            background: 'linear-gradient(90deg, rgb(32,74,135) 0%, rgb(246,248,248) 50%, rgb(220,20,20) 100%)',
                          }}
                        />
                        <div style={{ width: 220, display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'rgba(255,255,255,0.92)' }}>
                          <span>Least{locationLegendRange?.isFixed ? ` (${formatHeatmapLegendValue(locationView, locationLegendRange.min)})` : ''}</span>
                          <span>Most{locationLegendRange?.isFixed ? ` (${formatHeatmapLegendValue(locationView, locationLegendRange.max)})` : ''}</span>
                        </div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{locationView === 'Frequency' ? 'Pitch Frequency' : locationView}</div>
                      </div>
                    ) : null}
                    {!hideLeagueSummaryCharts ? locationSvg : null}
                    {locationHover ? (
                      <div
                        style={{
                          position: 'fixed',
                          left: locationHover.x + 12,
                          top: locationHover.y + 12,
                          zIndex: 80,
                          pointerEvents: 'none',
                          whiteSpace: 'pre-line',
                          background: locationHover.bg ?? 'rgba(0,0,0,0.92)',
                          border: '1px solid rgba(255,255,255,0.22)',
                          borderRadius: 8,
                          padding: '0.35rem 0.45rem',
                          fontSize: '0.74rem',
                          lineHeight: 1.25,
                          color: pitchHoverTextColor(locationHover.bg),
                        }}
                      >
                        {locationHover.text}
                      </div>
                    ) : null}
                  </div>
                </article>
              </div>
              <div className="portal-day-card" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1rem', alignItems: 'center', justifyContent: 'center' }}>
                  {activeSummaryPitchTypes
                    .map((name) => [name, pitchColors[name] ?? '#9ca3af'] as const)
                    .map(([name, color]) => (
                      <span key={`legend-${name}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 999, background: color, border: '1px solid rgba(255,255,255,0.45)' }} />
                        <span style={{ fontSize: '0.82rem' }}>{name}</span>
                      </span>
                    ))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1rem', alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
                  {[
                    { kind: 'called_strike', label: 'Called Strike' },
                    { kind: 'ball', label: 'Ball' },
                    { kind: 'foul', label: 'Foul' },
                    { kind: 'whiff', label: 'Whiff' },
                    { kind: 'in_play_out', label: 'In Play (Out)' },
                    { kind: 'in_play_hit', label: 'In Play (Hit)' },
                    { kind: 'error', label: 'Error' },
                  ].map((row) => (
                    <span key={`summary-result-legend-${row.label}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          lineHeight: 1,
                          flex: '0 0 14px',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                          {row.kind === 'called_strike' ? <circle cx="7" cy="7" r="4" fill="#fff" /> : null}
                          {row.kind === 'ball' ? <circle cx="7" cy="7" r="4" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                          {row.kind === 'foul' ? <polygon points="7,2 12,11 2,11" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                          {row.kind === 'whiff' ? (
                            <polygon points="7,1.5 8.7,5.2 12.8,5.2 9.5,7.6 10.8,11.8 7,9.3 3.2,11.8 4.5,7.6 1.2,5.2 5.3,5.2" fill="#fff" />
                          ) : null}
                          {row.kind === 'in_play_out' ? <polygon points="7,2 12,11 2,11" fill="#fff" /> : null}
                          {row.kind === 'in_play_hit' ? <rect x="3" y="3" width="8" height="8" fill="#fff" /> : null}
                          {row.kind === 'error' ? <rect x="3" y="3" width="8" height="8" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                        </svg>
                      </span>
                      <span>{row.label}</span>
                    </span>
                  ))}
                </div>
              </div>
              </>
              ) : null}

              <div
                className="portal-table-wrap"
                ref={isLeaderboardPage ? leaderboardTableExportRef : undefined}
                style={{ marginTop: '1rem', ...(isLeaderboardPage ? { maxHeight: '68vh', overflowY: 'auto' as const } : {}) }}
              >
                <div
                  className="portal-form-grid"
                  style={{
                    marginBottom: '0.8rem',
                    gridTemplateColumns: isLeaderboardPage
                      ? ((isLeague || isPro) ? 'repeat(4, minmax(160px, 260px))' : 'repeat(3, minmax(160px, 260px))')
                      : 'repeat(4, minmax(160px, 260px))',
                  }}
                >
                  <label>
                    Tables
                    <SearchableSingleSelect
                      options={tableModeOptions}
                      value={tableModeSelectValue}
                      onChange={handleTableModeSelection}
                      placeholder="Stuff"
                    />
                  </label>
                  {isLeaderboardPage && (isLeague || isPro) ? (
                    <label>
                      View By
                      <SearchableSingleSelect
                        options={[
                          { value: 'Player', label: 'Player' },
                          { value: 'Team', label: 'Team' },
                        ]}
                        value={leaderboardViewBy}
                        onChange={handleLeaderboardViewBySelection}
                        placeholder="Player"
                      />
                    </label>
                  ) : null}
                  {isLeaderboardPage ? (
                    <label>
                      Stat View
                      <SearchableSingleSelect
                        options={[
                          { value: 'Stats', label: 'Stats' },
                          { value: 'Percentile', label: 'Percentile' },
                        ]}
                        value={leaderboardStatView}
                        onChange={handleLeaderboardStatViewSelection}
                        placeholder="Stats"
                      />
                    </label>
                  ) : null}
                  {isLeaderboardPage && !isPro ? (
                    <label>
                      Percentile By
                      <SearchableSingleSelect
                        options={percentileScopeOptions}
                        value={leaderboardPercentileScope}
                        onChange={handleLeaderboardPercentileScopeSelection}
                        placeholder={collegePercentileDefault}
                      />
                    </label>
                  ) : null}
                  {isLeaderboardPage ? (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'nowrap', justifySelf: 'end' }}>
                      <div className="portal-color-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0.32rem 0.55rem' }}>
                        <span className="portal-color-toggle-label">Color Code</span>
                        <button
                          type="button"
                          className={`portal-color-toggle-btn${enableTableColors ? ' is-on' : ''}`}
                          aria-label="Toggle table color coding"
                          aria-pressed={enableTableColors}
                          title={enableTableColors ? 'Color code on' : 'Color code off'}
                          onClick={() => setEnableTableColors((current) => !current)}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{
                          whiteSpace: 'nowrap',
                          height: '2.22rem',
                          minHeight: '2.22rem',
                          padding: '0 1.05rem',
                          alignSelf: 'end',
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                        onClick={() => setShowLeaderboardCorrelation(true)}
                      >
                        View Chart
                      </button>
                    </div>
                  ) : null}
                  {!isLeaderboardPage ? (
                    <>
                      <label>
                        <span>Split By</span>
                        <SearchableSingleSelect
                          options={splitByOptions}
                          value={splitBy}
                          onChange={setSplitBy}
                          placeholder="Pitch Types"
                        />
                      </label>
                      {dashboardPage === 'Summary' ? (
                        <label>
                          <span>Stat View</span>
                          <SearchableSingleSelect
                            options={[
                              { value: 'Stats', label: 'Stats' },
                              { value: 'Percentile', label: 'Percentile' },
                            ]}
                            value={summaryStatView}
                            onChange={(next) => setSummaryStatView(next as 'Stats' | 'Percentile')}
                            placeholder="Stats"
                          />
                        </label>
                      ) : null}
                      {dashboardPage === 'Summary' && !isPro ? (
                        <label>
                          <span>Percentile By</span>
                          <SearchableSingleSelect
                            options={percentileScopeOptions}
                            value={summaryPercentileScope}
                            onChange={setSummaryPercentileScope}
                            placeholder={collegePercentileDefault}
                          />
                        </label>
                      ) : null}
                      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div className="portal-color-toggle">
                          <span className="portal-color-toggle-label">Color Code</span>
                          <button
                            type="button"
                            className={`portal-color-toggle-btn${enableTableColors ? ' is-on' : ''}`}
                            aria-label="Toggle table color coding"
                            aria-pressed={enableTableColors}
                            title={enableTableColors ? 'Color code on' : 'Color code off'}
                            onClick={() => setEnableTableColors((current) => !current)}
                          />
                        </div>
                        <div className="portal-color-toggle">
                          <span className="portal-color-toggle-label">Show Percentile</span>
                          <button
                            type="button"
                            className={`portal-color-toggle-btn${showCellPercentiles ? ' is-on' : ''}`}
                            aria-label="Toggle percentile labels in table cells"
                            aria-pressed={showCellPercentiles}
                            title={showCellPercentiles ? 'Percentile labels on' : 'Percentile labels off'}
                            onClick={() => setShowCellPercentiles((current) => !current)}
                          />
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
                {tableMode === 'Custom' && showCustomEditor ? (
                  <div className="portal-day-card" style={{ marginBottom: '0.9rem' }}>
                    <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: '0.75rem 0.9rem' }}>
                      <label>
                        Saved Custom Tables
                        <SearchableSingleSelect
                          options={[
                            { value: 'new', label: 'New Custom Table' },
                            ...customTables.map((item) => ({ value: String(item.id), label: customTableOptionLabel(item) })),
                          ]}
                          value={selectedCustomTableId ? String(selectedCustomTableId) : 'new'}
                          onChange={(next) => {
                            if (next === 'new') {
                              setSelectedCustomTableId(null);
                              setCustomTableName('');
                              setCustomTableColumns([]);
                              setCustomSaveState('idle');
                              setCustomSaveMessage('');
                              return;
                            }
                            const id = Number(next);
                            const found = customTables.find((row) => Number(row.id) === id);
                            if (!found) return;
                            setShowCustomEditor(true);
                            setSelectedCustomTableId(found.id);
                            setCustomTableName(found.name);
                            setCustomTableColumns(found.columns ?? []);
                            setCustomSaveState('idle');
                            setCustomSaveMessage('');
                            setAppliedFilterVersion((current) => current + 1);
                          }}
                          placeholder={loadingCustomTables ? 'Loading...' : 'New Custom Table'}
                        />
                      </label>
                      <label>
                        Custom Table Name
                        <input
                          value={customTableName}
                          onChange={(event) => setCustomTableName(event.target.value)}
                          placeholder="Example: OSU Live Pitching"
                        />
                      </label>
                      <label>
                        Add Column
                        <SearchableSingleSelect
                          options={remainingCustomColumns.map((column) => ({ value: column, label: column }))}
                          value={customColumnToAdd}
                          clearQueryOnSelect={false}
                          onChange={(next) => {
                            setCustomColumnToAdd(next);
                            if (!next || customTableColumns.includes(next)) return;
                            setCustomTableColumns((current) => [...current, next]);
                            setCustomColumnToAdd('');
                            setAppliedFilterVersion((current) => current + 1);
                          }}
                          placeholder="Choose column"
                        />
                      </label>
                      <div style={{ display: 'grid', alignContent: 'end' }}>
                        <div className="portal-choice-line-actions" style={{ justifyContent: 'flex-start', marginTop: '1.35rem' }}>
                          <button type="button" className="btn btn-primary" onClick={saveCustomTable} disabled={customSaveState === 'saving'}>
                            {customSaveState === 'saving' ? 'Saving...' : 'Save Table'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={deleteCustomTable}
                            disabled={!selectedCustomTableId || customSaveState === 'saving'}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: '0.6rem' }}>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                        Drag to reorder columns. Table starts blank; add the columns you want.
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.45rem',
                          minHeight: 40,
                          padding: '0.45rem',
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.16)',
                          background: 'rgba(255,255,255,0.02)',
                        }}
                      >
                        {customTableColumns.length ? (
                          customTableColumns.map((column, index) => (
                            <button
                              key={`${column}-${index}`}
                              type="button"
                              draggable
                              onDragStart={() => setDragColumnIndex(index)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                if (dragColumnIndex === null) return;
                                setCustomTableColumns((current) => reorderColumns(current, dragColumnIndex, index));
                                setDragColumnIndex(null);
                                setAppliedFilterVersion((current) => current + 1);
                              }}
                              className="btn btn-ghost"
                              style={{ minHeight: 'unset', padding: '0.3rem 0.5rem', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                            >
                              <span style={{ opacity: 0.7 }}>::</span>
                              <span>{column}</span>
                              <span
                                style={{ opacity: 0.8 }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setCustomTableColumns((current) => current.filter((_, i) => i !== index));
                                  setAppliedFilterVersion((current) => current + 1);
                                }}
                              >
                                ✕
                              </span>
                            </button>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No custom columns yet.</span>
                        )}
                      </div>
                      {customSaveMessage ? (
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: '0.82rem',
                            color: customSaveState === 'error' ? '#fca5a5' : '#86efac',
                          }}
                        >
                          {customSaveMessage}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {((isLeaderboardPage && loadingPercentileBaseline) || (!isLeaderboardPage && dashboardPage === 'Summary' && loadingSummaryPitchTypePercentiles)) && (
                  (isLeaderboardPage && leaderboardStatView === 'Percentile') ||
                  (
                    dashboardPage === 'Summary' &&
                    loadingSummaryPitchTypePercentiles &&
                    (
                      summaryStatView === 'Percentile' ||
                      showCellPercentiles ||
                      enableTableColors
                    )
                  )
                ) ? (
                  <p className="portal-muted-text" style={{ margin: '0 0 0.6rem 0' }}>Loading percentiles...</p>
                ) : null}
                {loadingOverview ? (
                  <p className="portal-muted-text" style={{ margin: '0 0 0.6rem 0' }}>
                    Loading leaderboard table...
                  </p>
                ) : null}
                {!loadingOverview ? (
                <>
                <table className="portal-table">
                  <thead>
                    <tr>
                      {isLeaderboardPage ? <th style={{ textAlign: 'center', position: isLeaderboardPage ? 'sticky' : undefined, top: isLeaderboardPage ? 0 : undefined, zIndex: isLeaderboardPage ? 3 : undefined, background: isLeaderboardPage ? ((typeof document !== 'undefined' && document.body.classList.contains('theme-light')) ? 'rgba(248,250,252,0.98)' : 'rgba(7,9,14,0.98)') : undefined }}>Rank</th> : null}
                      {displayedTableColumns.map((column, colIndex) => {
                        const isSortable = true;
                        const activeSort = leaderboardSortColumn === column;
                        const label = isLeaderboardPage && colIndex === 0 ? (leaderboardViewBy === 'Team' ? 'Team' : 'Player') : column;
                        const headerTooltip = COLUMN_HEADER_TOOLTIPS[column];
                        return (
                          <th
                            key={column}
                            onMouseEnter={
                              headerTooltip
                                ? (event) =>
                                    setHeaderTooltipHover({
                                      x: event.clientX,
                                      y: event.clientY,
                                      text: `${label}\n${headerTooltip}`,
                                      bg: '#111827',
                                    })
                                : undefined
                            }
                            onMouseMove={
                              headerTooltip
                                ? (event) =>
                                    setHeaderTooltipHover((current) =>
                                      current
                                        ? { ...current, x: event.clientX, y: event.clientY, text: `${label}\n${headerTooltip}` }
                                        : {
                                            x: event.clientX,
                                            y: event.clientY,
                                            text: `${label}\n${headerTooltip}`,
                                            bg: '#111827',
                                          }
                                    )
                                : undefined
                            }
                            onMouseLeave={headerTooltip ? () => setHeaderTooltipHover(null) : undefined}
                            style={{
                              textAlign: 'center',
                              cursor: isSortable ? 'pointer' : 'default',
                              position: isLeaderboardPage ? 'sticky' : undefined,
                              top: isLeaderboardPage ? 0 : undefined,
                              zIndex: isLeaderboardPage ? 3 : undefined,
                              background: activeSort
                                ? 'rgb(var(--portal-accent-rgb, 59,130,246))'
                                : (isLeaderboardPage ? ((typeof document !== 'undefined' && document.body.classList.contains('theme-light')) ? 'rgba(248,250,252,0.98)' : 'rgba(7,9,14,0.98)') : undefined),
                              color: activeSort ? '#fff' : undefined,
                            }}
                            onClick={
                              isSortable
                                  ? () => {
                                      if (leaderboardSortColumn === column) {
                                        setLeaderboardSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                                      } else {
                                        setLeaderboardSortColumn(column);
                                        setLeaderboardSortDirection(
                                          isLeaderboardPage && colIndex > 0 ? 'desc' : 'asc'
                                        );
                                      }
                                    }
                                  : undefined
                            }
                          >
                            {label}
                            {activeSort ? ` ${leaderboardSortDirection === 'asc' ? '↑' : '↓'}` : ''}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardRowsWithPins?.length
                      ? (() => {
                          let leaderboardRankCounter = 0;
                          return leaderboardRowsWithPins.map((row, idx) => {
                          const rowKey = String(row[displayedTableColumns?.[0] ?? 'row'] ?? 'Unknown');
                          const rowPitches = resolveEditablePitchesForRow(row, rowKey);
                          const rowPitchCount = Number(row['#'] ?? row.P ?? row.pitches ?? 0);
                          const canOpenRowPitches = rowPitches.length > 0 || (Number.isFinite(rowPitchCount) && rowPitchCount > 0);
                          const isAllRow = isLeaderboardPage && String(row[displayedTableColumns?.[0] ?? ''] ?? '').trim().toLowerCase() === 'all';
                          const isPinnedAllRow = isLeaderboardPage && String(row[displayedTableColumns?.[0] ?? ''] ?? '').trim().toLowerCase() === 'all (pinned)';
                          const rankValue = isAllRow || isPinnedAllRow ? '' : String(++leaderboardRankCounter);
                          return (
                          <tr
                            key={`${String(row[displayedTableColumns?.[0] ?? 'row'] ?? 'row')}-${idx}`}
                            style={isAllRow || isPinnedAllRow ? { background: 'rgba(255,255,255,0.12)', fontWeight: 700 } : undefined}
                          >
                            {isLeaderboardPage ? <td style={{ textAlign: 'center' }}>{rankValue}</td> : null}
                            {displayedTableColumns.map((column, colIndex) => (
                              <td
                                key={`${idx}-${column}`}
                                style={{
                                  textAlign:
                                    isLeaderboardPage && colIndex === 0 && (leaderboardViewBy === 'Player' || leaderboardViewBy === 'Team')
                                      ? (isAllRow ? 'center' : 'left')
                                      : 'center',
                                  background:
                                    leaderboardSortColumn === column &&
                                    !(
                                      (isLeaderboardPage && leaderboardStatView === 'Percentile' && colIndex > 0) ||
                                      (!isLeaderboardPage && dashboardPage === 'Summary' && summaryStatView === 'Percentile' && colIndex > 0)
                                    )
                                      ? 'rgb(var(--portal-accent-rgb, 59,130,246))'
                                      : undefined,
                                  color:
                                    leaderboardSortColumn === column &&
                                    !(
                                      (isLeaderboardPage && leaderboardStatView === 'Percentile' && colIndex > 0) ||
                                      (!isLeaderboardPage && dashboardPage === 'Summary' && summaryStatView === 'Percentile' && colIndex > 0)
                                    )
                                      ? '#fff'
                                      : undefined,
                                  cursor:
                                    (column === '#' && canOpenRowPitches)
                                    || (isLeaderboardPage && column === leaderboardPrimaryColumn && !isAllRow)
                                      ? 'pointer'
                                      : undefined,
                                  textDecoration:
                                    (column === '#' && canOpenRowPitches)
                                    || (isLeaderboardPage && column === leaderboardPrimaryColumn && !isAllRow)
                                      ? 'underline'
                                      : undefined,
                                }}
                                onClick={
                                  column === '#' && canOpenRowPitches
                                    ? () => void openLeaderboardVideoQueue(row, rowKey, rowPitches)
                                    : (isLeaderboardPage && column === leaderboardPrimaryColumn && !isAllRow)
                                      ? () => applyLeaderboardDrilldown(row[column], leaderboardViewBy)
                                      : undefined
                                }
                              >
                                {(() => {
                                  const rawValue = row[column] ?? '-';
                                  const percentileValue = getCellPercentile(row, column, rawValue);
                                  const percentilesReady =
                                    dashboardPage === 'Summary'
                                      ? !loadingSummaryPitchTypePercentiles
                                      : !loadingPercentileBaseline;
                                  const showLeaderboardPercentile =
                                    isLeaderboardPage &&
                                    leaderboardStatView === 'Percentile' &&
                                    percentilesReady &&
                                    colIndex > 0 &&
                                    !isAllRow &&
                                    !isPinnedAllRow;
                                  const showSummaryPercentile =
                                    !isLeaderboardPage &&
                                    dashboardPage === 'Summary' &&
                                    summaryStatView === 'Percentile' &&
                                    percentilesReady &&
                                    colIndex > 0;
                                  const value =
                                    isLeaderboardPage && column === displayedTableColumns[0] && typeof rawValue === 'string'
                                      ? (() => {
                                          const formatted = formatNameFirstLast(rawValue);
                                          if (leaderboardViewBy !== 'Player') {
                                            if (!isPro) {
                                              const rawTeam = String(rawValue ?? '').trim();
                                              if (!rawTeam || rawTeam.toLowerCase() === 'all') return rawTeam || formatted;
                                              if (isLeague) {
                                                const mappedLabel = leagueTeamLabelByCode[rawTeam.toUpperCase()];
                                                if (mappedLabel) return mappedLabel;
                                              }
                                              return rawTeam;
                                            }
                                            const teamCode = inferProTeamCode(rawValue);
                                            if (!teamCode || String(rawValue ?? '').trim().toLowerCase() === 'all') return formatted;
                                            const teamLogo = proxiedProTeamLogoUrl(teamCode);
                                            const teamName = getProTeamDisplayName(rawValue, (level as 'MLB' | 'AAA' | 'All') || 'All');
                                            if (!teamLogo) return teamName;
                                            return (
                                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-start' }}>
                                                <span style={{ width: 16, minWidth: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                                  <img src={teamLogo} alt={teamCode} style={{ width: 16, height: 16, objectFit: 'contain', display: 'inline-block' }} />
                                                </span>
                                                <span>{teamName}</span>
                                              </span>
                                            );
                                          }
                                          const key = String(rawValue).trim();
                                          const keyNorm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
                                          const formattedNorm = formatted.toLowerCase().replace(/[^a-z0-9]/g, '');
                                          let teamCode =
                                            latestTeamByPitcher[key] ??
                                            latestTeamByPitcher[keyNorm] ??
                                            latestTeamByPitcher[formatted] ??
                                            latestTeamByPitcher[formattedNorm] ??
                                            filterTeamByPitcher[key] ??
                                            filterTeamByPitcher[keyNorm] ??
                                            filterTeamByPitcher[formatted] ??
                                            filterTeamByPitcher[formattedNorm] ??
                                            '';
                                          if (!teamCode && isPro && rowPitches.length) {
                                            const rowPitchTeam = rowPitches.find((pitch) => {
                                              const code = String((pitch as { pitcher_team_code?: string }).pitcher_team_code ?? '').trim();
                                              return !!code;
                                            });
                                            teamCode = String(
                                              (rowPitchTeam as { pitcher_team_code?: string } | undefined)?.pitcher_team_code ?? ''
                                            )
                                              .trim()
                                              .toUpperCase();
                                          }
                                          if (!teamCode || String(rawValue ?? '').trim().toLowerCase() === 'all') return formatted;
                                          const logoUrl = isPro ? proxiedProTeamLogoUrl(teamCode) : '';
                                          if (!logoUrl) return formatted;
                                          return (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-start' }}>
                                              <span style={{ width: 16, minWidth: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <img src={logoUrl} alt={teamCode} style={{ width: 16, height: 16, objectFit: 'contain', display: 'inline-block' }} />
                                              </span>
                                              <span>{formatted}</span>
                                            </span>
                                          );
                                        })()
                                      : rawValue;
                                  const displayValue =
                                    !isLeaderboardPage &&
                                    dashboardPage === 'Summary' &&
                                    colIndex === 0 &&
                                    (normalizePercentileColumnToken(column) === normalizePercentileColumnToken('Team') ||
                                      normalizePercentileColumnToken(column) === normalizePercentileColumnToken('Pitcher Team'))
                                      ? formatTeamLabel(rawValue)
                                      : typeof value === 'string' || typeof value === 'number' || value === null || value === undefined
                                      ? formatPitchingTableDisplayValue(column, value)
                                      : value;
                                  const renderedCellValue =
                                    (showLeaderboardPercentile || showSummaryPercentile) && percentileValue !== null
                                      ? `${percentileValue.toFixed(1)}%`
                                      : displayValue;
                                  const canPinRow = isLeaderboardPage && column === displayedTableColumns[0] && !isAllRow && !isPinnedAllRow;
                                  const pinKey = canPinRow
                                    ? pinKeyFromRow(
                                        row as Record<string, string | number | null | undefined>,
                                        displayedTableColumns[0]
                                      )
                                    : '';
                                  const isPinnedRow = canPinRow && pinnedLeaderboardKeys.has(pinKey);
                                  const displayValueWithPin = canPinRow ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                      <button
                                        type="button"
                                        aria-label={isPinnedRow ? 'Unpin row' : 'Pin row'}
                                        title={isPinnedRow ? 'Unpin' : 'Pin'}
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          if (!pinKey) return;
                                          setPinnedLeaderboardKeys((current) => {
                                            const next = new Set(current);
                                            if (next.has(pinKey)) next.delete(pinKey);
                                            else next.add(pinKey);
                                            return next;
                                          });
                                        }}
                                        style={{
                                          border: 'none',
                                          background: 'transparent',
                                          color: isPinnedRow ? '#fbbf24' : 'rgba(255,255,255,0.7)',
                                          cursor: 'pointer',
                                          padding: 0,
                                          lineHeight: 1,
                                          fontSize: 14,
                                        }}
                                      >
                                        {isPinnedRow ? '📌' : '📍'}
                                      </button>
                                      <span>{displayValue}</span>
                                    </span>
                                  ) : renderedCellValue;
                                  const percentileCellStyle =
                                    enableTableColors &&
                                    percentilesReady &&
                                    colIndex > 0 &&
                                    percentileValue !== null
                                      ? {
                                          backgroundColor: divergingColor(percentileValue, 0, 50, 100),
                                          color: percentileTextColor(percentileValue),
                                        }
                                      : null;
                                  const activeCellStyle =
                                    percentileCellStyle ?? null;
                                  const summaryPercentileText =
                                    !isLeaderboardPage &&
                                    dashboardPage === 'Summary' &&
                                    summaryStatView === 'Stats' &&
                                    showCellPercentiles &&
                                    percentilesReady &&
                                    colIndex > 0 &&
                                    percentileValue !== null
                                      ? `${percentileValue.toFixed(1)}%`
                                      : null;
                                  const inlinePercentileText = summaryPercentileText;
                                  const splitHeaderToken = normalizeNameToken(String(displayedTableColumns?.[0] ?? ''));
                                  const isPitchSplitHeader =
                                    splitHeaderToken === 'pitch' ||
                                    splitHeaderToken === 'pitchtype' ||
                                    splitHeaderToken === 'pitchtypes';
                                  const shouldRenderPitchTypeBadge =
                                    colIndex === 0 &&
                                    isPitchSplitHeader &&
                                    !isAllRow &&
                                    !isPinnedAllRow;
                                  const pitchTypeCellColor =
                                    shouldRenderPitchTypeBadge
                                      ? (pitchColors[String(rawValue ?? '').trim()] ?? '')
                                      : '';
                                  const pitchTypeCellTextColor =
                                    pitchTypeCellColor ? pitchHoverTextColor(pitchTypeCellColor) : '';
                                  if (!activeCellStyle) {
                                    if (pitchTypeCellColor) {
                                      return (
                                        <span
                                          style={{
                                            backgroundColor: pitchTypeCellColor,
                                            color: pitchTypeCellTextColor,
                                            padding: '2px 4px',
                                            borderRadius: 3,
                                            display: 'inline-block',
                                            width: '100%',
                                            textAlign: 'center',
                                          }}
                                        >
                                          {displayValueWithPin}
                                        </span>
                                      );
                                    }
                                    if (!inlinePercentileText) return displayValueWithPin;
                                    return (
                                      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15 }}>
                                        <span>{displayValueWithPin}</span>
                                        <span style={{ fontSize: '0.66rem', opacity: 0.78, marginTop: 2 }}>{inlinePercentileText}</span>
                                      </span>
                                    );
                                  }
                                  return (
                                    <span
                                      style={{
                                        ...activeCellStyle,
                                        padding: '2px 4px',
                                        borderRadius: 3,
                                        display: 'inline-block',
                                        width: '100%',
                                        textAlign: 'center',
                                      }}
                                    >
                                      {inlinePercentileText ? (
                                        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15 }}>
                                          <span>{displayValueWithPin}</span>
                                          <span style={{ fontSize: '0.66rem', opacity: 0.88, marginTop: 2 }}>{inlinePercentileText}</span>
                                        </span>
                                      ) : (
                                        displayValueWithPin
                                      )}
                                    </span>
                                  );
                                })()}
                              </td>
                            ))}
                          </tr>
                        );
                        });
                        })()
                      : (Array.isArray(overview?.pitch_types) ? overview.pitch_types : []).map((row) => (
                          <tr key={row.pitch_type}>
                            <td style={{ textAlign: 'center' }}>{row.pitch_type}</td>
                            <td style={{ textAlign: 'center' }}>{row.pitches}</td>
                            <td style={{ textAlign: 'center' }}>{fmtNum(row.usage_pct)}%</td>
                            <td style={{ textAlign: 'center' }}>{fmtNum(row.avg_velo)}</td>
                            <td style={{ textAlign: 'center' }}>{fmtNum(row.max_velo)}</td>
                            <td style={{ textAlign: 'center' }}>{fmtNum(row.avg_spin, 0)}</td>
                            <td style={{ textAlign: 'center' }}>{fmtNum(row.avg_ivb)}</td>
                            <td style={{ textAlign: 'center' }}>{fmtNum(row.avg_hb)}</td>
                            <td style={{ textAlign: 'center' }}>{fmtNum(row.avg_stuff)}</td>
                          </tr>
                        ))}
                  </tbody>
                </table>
                {headerTooltipHover ? (
                  (() => {
                    const lines = String(headerTooltipHover.text || '').split('\n');
                    const title = lines[0] || '';
                    const body = lines.slice(1).join('\n');
                    return (
                  <div
                    style={{
                      position: 'fixed',
                      left: headerTooltipHover.x + 12,
                      top: headerTooltipHover.y + 12,
                      zIndex: 90,
                      pointerEvents: 'none',
                      whiteSpace: 'pre-line',
                      background: headerTooltipHover.bg ?? 'rgba(0,0,0,0.92)',
                      border: '1px solid rgba(255,255,255,0.22)',
                      borderRadius: 8,
                      padding: '0.35rem 0.45rem',
                      fontSize: '0.74rem',
                      lineHeight: 1.25,
                      color: '#f8fafc',
                      maxWidth: 320,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: body ? 4 : 0 }}>{title}</div>
                    {body}
                  </div>
                    );
                  })()
                ) : null}
                </>
              ) : null}
              </div>
                </>
              ) : null}
            </>
          ) : dashboardPage === 'Game Log' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ marginTop: 0, marginBottom: 0 }}>{gameLogHeader.label}</h3>
                {gameLogHeader.logoUrl ? (
                  <img src={gameLogHeader.logoUrl} alt="Team" style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0 }} />
                ) : null}
              </div>
              <div
                className="portal-form-grid"
                style={{
                  marginBottom: '0.8rem',
                  gridTemplateColumns: !isPro
                    ? 'minmax(170px, 240px) minmax(170px, 240px) auto'
                    : 'minmax(170px, 240px) auto',
                }}
              >
                <label>
                  Tables
                  <SearchableSingleSelect
                    options={tableModeOptions}
                    value={tableModeSelectValue}
                    onChange={handleTableModeSelection}
                    placeholder="Stuff"
                  />
                </label>
                {!isPro ? (
                  <label>
                  Percentile By
                  <SearchableSingleSelect
                      options={percentileScopeOptions}
                      value={leaderboardPercentileScope}
                      onChange={handleLeaderboardPercentileScopeSelection}
                      placeholder={collegePercentileDefault}
                    />
                  </label>
                ) : null}
                <div
                  style={{
                    display: 'flex',
                    minWidth: 0,
                    justifySelf: 'start',
                    alignItems: 'flex-end',
                    justifyContent: 'flex-start',
                    gap: 8,
                    flexWrap: 'nowrap',
                  }}
                >
                  <div className="portal-color-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0.32rem 0.55rem' }}>
                    <span className="portal-color-toggle-label">Color Code</span>
                    <button
                      type="button"
                      className={`portal-color-toggle-btn${enableTableColors ? ' is-on' : ''}`}
                      aria-label="Toggle table color coding"
                      aria-pressed={enableTableColors}
                      title={enableTableColors ? 'Color code on' : 'Color code off'}
                      onClick={() => setEnableTableColors((current) => !current)}
                    />
                  </div>
                  <div className="portal-color-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0.32rem 0.55rem' }}>
                    <span className="portal-color-toggle-label">Show Percentile</span>
                    <button
                      type="button"
                      className={`portal-color-toggle-btn${showCellPercentiles ? ' is-on' : ''}`}
                      aria-label="Toggle percentile labels in table cells"
                      aria-pressed={showCellPercentiles}
                      title={showCellPercentiles ? 'Percentile labels on' : 'Percentile labels off'}
                      onClick={() => setShowCellPercentiles((current) => !current)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{
                      whiteSpace: 'nowrap',
                      height: '2.22rem',
                      minHeight: '2.22rem',
                      padding: '0 1.05rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                    onClick={() => setShowLeaderboardCorrelation(true)}
                  >
                    View Chart
                  </button>
                </div>
              </div>
              {!canRunGameLog ? (
                <p className="portal-muted-text">
                  Game Log requires a selected team or player. Choose a team (not `All`) or filter to one or more pitchers.
                </p>
              ) : null}
              {canRunGameLog && loadingGameLog ? <p>Loading game log...</p> : null}
              {canRunGameLog && gameLogError ? <p className="auth-error">{gameLogError}</p> : null}
              {canRunGameLog && !loadingGameLog && !gameLogError && gameLogRowsWithPins.length === 0 ? (
                <p className="portal-muted-text">No game log rows found for the current filters.</p>
              ) : null}
              {canRunGameLog && !loadingGameLog && !gameLogError && gameLogRowsWithPins.length > 0 ? (
                <div className="portal-table-wrap" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th
                          style={{
                            textAlign: 'center',
                            position: 'sticky',
                            top: 0,
                            zIndex: 3,
                            background: (typeof document !== 'undefined' && document.body.classList.contains('theme-light')) ? 'rgba(248,250,252,0.98)' : 'rgba(7,9,14,0.98)',
                            width: 34,
                          }}
                        >
                          Pin
                        </th>
                        {gameLogDisplayColumns.map((column) => {
                          const activeSort = gameLogSortColumn === column;
                          return (
                            <th
                              key={`game-log-head-${column}`}
                              style={{
                                textAlign: 'center',
                                cursor: 'pointer',
                                position: 'sticky',
                                top: 0,
                                zIndex: 3,
                                background: activeSort ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : ((typeof document !== 'undefined' && document.body.classList.contains('theme-light')) ? 'rgba(248,250,252,0.98)' : 'rgba(7,9,14,0.98)'),
                                color: activeSort ? '#fff' : undefined,
                              }}
                              onClick={() => {
                                if (activeSort) {
                                  setGameLogSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                                } else {
                                  setGameLogSortColumn(column);
                                  setGameLogSortDirection(column === 'Date' ? 'desc' : 'asc');
                                }
                              }}
                            >
                              {column}
                              {activeSort ? ` ${gameLogSortDirection === 'asc' ? '↑' : '↓'}` : ''}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {gameLogRowsWithPins.map((row, rowIndex) => (
                        <tr
                          key={`game-log-row-${String(row._game_pin_key ?? rowIndex)}`}
                          style={(() => {
                            const rowKind = String(row._game_row_kind ?? '');
                            const isSummaryRow = rowKind === 'all' || rowKind === 'all_pinned';
                            return isSummaryRow ? { background: 'rgba(255,255,255,0.12)', fontWeight: 700 } : undefined;
                          })()}
                        >
                          {(() => {
                            const rowKind = String(row._game_row_kind ?? '');
                            const isSummaryRow = rowKind === 'all' || rowKind === 'all_pinned';
                            const isPinnedRow = pinnedGameLogKeys.has(String(row._game_pin_key ?? ''));
                            return (
                              <td style={{ textAlign: 'center' }}>
                                {isSummaryRow ? '' : (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    aria-label={isPinnedRow ? 'Unpin game row' : 'Pin game row'}
                                    title={isPinnedRow ? 'Unpin row' : 'Pin row'}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      const key = String(row._game_pin_key ?? '');
                                      if (!key) return;
                                      setPinnedGameLogKeys((current) => {
                                        const next = new Set(current);
                                        if (next.has(key)) next.delete(key);
                                        else next.add(key);
                                        return next;
                                      });
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key !== 'Enter' && event.key !== ' ') return;
                                      event.preventDefault();
                                      event.stopPropagation();
                                      const key = String(row._game_pin_key ?? '');
                                      if (!key) return;
                                      setPinnedGameLogKeys((current) => {
                                        const next = new Set(current);
                                        if (next.has(key)) next.delete(key);
                                        else next.add(key);
                                        return next;
                                      });
                                    }}
                                    style={{
                                      cursor: 'pointer',
                                      userSelect: 'none',
                                      color: isPinnedRow ? '#fbbf24' : 'rgba(255,255,255,0.72)',
                                      fontSize: 14,
                                      lineHeight: 1,
                                      display: 'inline-block',
                                    }}
                                  >
                                    {isPinnedRow ? '📌' : '📍'}
                                  </span>
                                )}
                              </td>
                            );
                          })()}
                          {gameLogDisplayColumns.map((column) => {
                            const rawValue = row[column];
                            const displayValue = column === 'Date' ? formatShortDate(String(rawValue ?? '')) : formatPitchingTableDisplayValue(column, rawValue);
                            const rowKind = String(row._game_row_kind ?? '');
                            const isSummaryRow = rowKind === 'all' || rowKind === 'all_pinned';
                            const percentileValue = getCellPercentile(
                              row as Record<string, string | number | null>,
                              column,
                              rawValue
                            );
                            const percentilesReady = !loadingPercentileBaseline;
                            const showGameLogPercentileLabel =
                              showCellPercentiles &&
                              percentilesReady &&
                              column !== 'Team' &&
                              column !== 'Date' &&
                              column !== 'Opponent' &&
                              !isSummaryRow &&
                              percentileValue !== null;
                            const percentileCellStyle =
                              enableTableColors &&
                              percentilesReady &&
                              percentileValue !== null &&
                              !isSummaryRow &&
                              column !== 'Team' &&
                              column !== 'Date' &&
                              column !== 'Opponent'
                                ? {
                                    backgroundColor: divergingColor(percentileValue, 0, 50, 100),
                                    color: percentileTextColor(percentileValue),
                                  }
                                : null;
                            return (
                              <td
                                key={`game-log-cell-${rowIndex}-${column}`}
                                style={{
                                  textAlign: 'center',
                                  background: gameLogSortColumn === column ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : undefined,
                                  color: gameLogSortColumn === column ? '#fff' : undefined,
                                }}
                              >
                                {column === 'Team' && isPro && !isSummaryRow ? (
                                  (() => {
                                    const code = inferProTeamCode(String(rawValue ?? ''));
                                    const logo = proxiedProTeamLogoUrl(code);
                                    return logo ? <img src={logo} alt={code || 'Team'} style={{ width: 18, height: 18, objectFit: 'contain' }} /> : <span>{displayValue}</span>;
                                  })()
                                ) : column === 'Opponent' && isPro && !isSummaryRow ? (
                                  (() => {
                                    const code = inferProTeamCode(String(rawValue ?? ''));
                                    const logo = proxiedProTeamLogoUrl(code);
                                    const markerRaw = String(row._game_venue_marker ?? '').trim().toLowerCase();
                                    const markerText = markerRaw === '@' || markerRaw === 'away'
                                      ? '@'
                                      : markerRaw === 'vs.' || markerRaw === 'vs' || markerRaw === 'home'
                                        ? 'vs.'
                                        : '';
                                    return (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                                        {markerText ? <span>{markerText}</span> : null}
                                        {logo ? <img src={logo} alt={code || 'Opponent'} style={{ width: 18, height: 18, objectFit: 'contain' }} /> : <span>{displayValue}</span>}
                                      </span>
                                    );
                                  })()
                                ) : column === 'Team' && !isPro && !isSummaryRow ? (
                                  formatTeamLabel(rawValue)
                                ) : column === 'Opponent' && !isPro && !isSummaryRow ? (
                                  (() => {
                                    const rawOpponent = String(rawValue ?? '').trim();
                                    if (!rawOpponent) return '';
                                    const markerRaw = String(row._game_venue_marker ?? '').trim().toLowerCase();
                                    const markerText = markerRaw === '@' || markerRaw === 'away'
                                      ? '@ '
                                      : markerRaw === 'vs.' || markerRaw === 'vs' || markerRaw === 'home'
                                        ? 'vs. '
                                        : '';
                                    return `${markerText}${formatTeamLabel(rawValue)}`;
                                  })()
                                ) : percentileCellStyle ? (
                                  <span
                                    style={{
                                      ...percentileCellStyle,
                                      padding: '2px 4px',
                                      borderRadius: 3,
                                      display: 'inline-block',
                                      width: '100%',
                                      textAlign: 'center',
                                    }}
                                  >
                                    {showGameLogPercentileLabel ? (
                                      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15 }}>
                                        <span>{displayValue}</span>
                                        <span style={{ fontSize: '0.66rem', opacity: 0.78, marginTop: 2 }}>{percentileValue!.toFixed(1)}%</span>
                                      </span>
                                    ) : (
                                      displayValue
                                    )}
                                  </span>
                                ) : (
                                  showGameLogPercentileLabel ? (
                                    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15 }}>
                                      <span>{displayValue}</span>
                                      <span style={{ fontSize: '0.66rem', opacity: 0.78, marginTop: 2 }}>{percentileValue!.toFixed(1)}%</span>
                                    </span>
                                  ) : (
                                    displayValue
                                  )
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : dashboardPage === 'Pitch Log' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ marginTop: 0, marginBottom: 0 }}>{pitchLogHeader.label}</h3>
                {pitchLogHeader.logoUrl ? (
                  <img src={pitchLogHeader.logoUrl} alt="Team" style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0 }} />
                ) : null}
              </div>
              <div
                className="portal-form-grid"
                style={{
                  marginBottom: '0.8rem',
                  gridTemplateColumns: !isPro
                    ? 'minmax(170px, 240px) minmax(170px, 240px) auto'
                    : 'minmax(170px, 240px) auto',
                }}
              >
                <label>
                  Tables
                  <SearchableSingleSelect
                    options={tableModeOptions}
                    value={tableModeSelectValue}
                    onChange={handleTableModeSelection}
                    placeholder="Stuff"
                  />
                </label>
                {!isPro ? (
                  <label>
                      Percentile By
                      <SearchableSingleSelect
                        options={percentileScopeOptions}
                        value={leaderboardPercentileScope}
                        onChange={handleLeaderboardPercentileScopeSelection}
                        placeholder={collegePercentileDefault}
                      />
                    </label>
                  ) : null}
                <div
                  style={{
                    display: 'flex',
                    minWidth: 0,
                    justifySelf: 'start',
                    alignItems: 'flex-end',
                    justifyContent: 'flex-start',
                    gap: 8,
                    flexWrap: 'nowrap',
                  }}
                >
                  <div className="portal-color-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0.32rem 0.55rem' }}>
                    <span className="portal-color-toggle-label">Color Code</span>
                    <button
                      type="button"
                      className={`portal-color-toggle-btn${enableTableColors ? ' is-on' : ''}`}
                      aria-label="Toggle table color coding"
                      aria-pressed={enableTableColors}
                      title={enableTableColors ? 'Color code on' : 'Color code off'}
                      onClick={() => setEnableTableColors((current) => !current)}
                    />
                  </div>
                  <div className="portal-color-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0.32rem 0.55rem' }}>
                    <span className="portal-color-toggle-label">Show Percentile</span>
                    <button
                      type="button"
                      className={`portal-color-toggle-btn${showCellPercentiles ? ' is-on' : ''}`}
                      aria-label="Toggle percentile labels in table cells"
                      aria-pressed={showCellPercentiles}
                      title={showCellPercentiles ? 'Percentile labels on' : 'Percentile labels off'}
                      onClick={() => setShowCellPercentiles((current) => !current)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{
                      whiteSpace: 'nowrap',
                      height: '2.22rem',
                      minHeight: '2.22rem',
                      padding: '0 1.05rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                    onClick={() => setShowLeaderboardCorrelation(true)}
                  >
                    View Chart
                  </button>
                </div>
              </div>
              {!canRunPitchLog ? (
                <p className="portal-muted-text">
                  Pitch Log requires a selected team or player. Choose a team (not `All`) or filter to one or more pitchers.
                </p>
              ) : null}
              {canRunPitchLog && loadingPitchLog ? <p>Loading pitch log...</p> : null}
              {canRunPitchLog && pitchLogError ? <p className="auth-error">{pitchLogError}</p> : null}
              {canRunPitchLog && !loadingPitchLog && !pitchLogError && sortedPitchLogRows.length === 0 ? (
                <p className="portal-muted-text">No pitch log rows found for the current filters.</p>
              ) : null}
              {canRunPitchLog && !loadingPitchLog && !pitchLogError && sortedPitchLogRows.length > 0 ? (
                <div className="portal-table-wrap" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th
                          style={{
                            textAlign: 'center',
                            position: 'sticky',
                            top: 0,
                            zIndex: 3,
                            background: (typeof document !== 'undefined' && document.body.classList.contains('theme-light'))
                              ? 'rgba(248,250,252,0.98)'
                              : 'rgba(7,9,14,0.98)',
                          }}
                        >
                          Pin
                        </th>
                        {pitchLogDisplayColumns.map((column) => {
                          const activeSort = pitchLogSortColumn === column;
                          return (
                            <th
                              key={`pitch-log-head-${column}`}
                              style={{
                                textAlign: 'center',
                                cursor: 'pointer',
                                position: 'sticky',
                                top: 0,
                                zIndex: 3,
                                background: activeSort ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : ((typeof document !== 'undefined' && document.body.classList.contains('theme-light')) ? 'rgba(248,250,252,0.98)' : 'rgba(7,9,14,0.98)'),
                                color: activeSort ? '#fff' : undefined,
                              }}
                              onClick={() => {
                                if (activeSort) {
                                  setPitchLogSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                                } else {
                                  setPitchLogSortColumn(column);
                                  setPitchLogSortDirection(column === 'Date' ? 'desc' : 'asc');
                                }
                              }}
                            >
                              {column}
                              {activeSort ? ` ${pitchLogSortDirection === 'asc' ? '↑' : '↓'}` : ''}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {pitchLogRowsWithPins.map((row, rowIndex) => {
                        const pinKey = String(row._pitch_pin_key ?? '');
                        const isPinned = Boolean(pinKey) && pinnedPitchLogKeys.has(pinKey);
                        const isPinnedAllRow = row._pitch_row_kind === 'all_pinned';
                        const rowPitch = row._pitch_action_point as PitchActionPoint | undefined;
                        return (
                        <tr
                          key={pinKey || `pitch-log-row-${rowIndex}`}
                          style={isPinnedAllRow ? { background: 'rgba(255,255,255,0.12)', fontWeight: 700 } : undefined}
                        >
                          <td style={{ textAlign: 'center' }}>
                            {isPinnedAllRow ? (
                              <span aria-hidden="true">—</span>
                            ) : (
                              <button
                              type="button"
                              aria-label={isPinned ? 'Unpin pitch' : 'Pin pitch'}
                              title={isPinned ? 'Unpin' : 'Pin'}
                              disabled={!pinKey}
                              onClick={() => {
                                if (!pinKey) return;
                                setPinnedPitchLogKeys((current) => {
                                  const next = new Set(current);
                                  if (next.has(pinKey)) next.delete(pinKey);
                                  else next.add(pinKey);
                                  return next;
                                });
                              }}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: isPinned ? '#fbbf24' : 'inherit',
                                opacity: isPinned ? 1 : 0.7,
                                cursor: pinKey ? 'pointer' : 'default',
                                padding: 0,
                                lineHeight: 1,
                                fontSize: 14,
                              }}
                            >
                              {isPinned ? '📌' : '📍'}
                              </button>
                            )}
                          </td>
                          {pitchLogDisplayColumns.map((column) => {
                            const rawValue = row[column];
                            const displayValue = column === 'Date' ? formatShortDate(String(rawValue ?? '')) : formatPitchLogCellDisplayValue(column, rawValue);
                            const canOpenPitchVideo = column === '#' && tableMode === 'Stuff' && (Boolean(rowPitch) || isPinnedAllRow);
                            const percentileValue = getCellPercentile(
                              row as Record<string, string | number | null>,
                              column,
                              rawValue
                            );
                            const percentilesReady = !loadingPercentileBaseline;
                            const showPitchLogPercentileLabel =
                              showCellPercentiles &&
                              percentilesReady &&
                              column !== 'Team' &&
                              column !== 'Date' &&
                              column !== 'Opponent' &&
                              column !== 'Pitcher' &&
                              column !== 'Batter' &&
                              column !== 'Pitch Type' &&
                              column !== 'Count' &&
                              column !== 'Result' &&
                              percentileValue !== null;
                            const percentileCellStyle =
                              enableTableColors &&
                              percentilesReady &&
                              percentileValue !== null &&
                              column !== 'Team' &&
                              column !== 'Date' &&
                              column !== 'Opponent'
                              && column !== 'Pitcher'
                              && column !== 'Batter'
                              && column !== 'Pitch Type'
                              && column !== 'Count'
                              && column !== 'Result'
                                ? {
                                    backgroundColor: divergingColor(percentileValue, 0, 50, 100),
                                    color: percentileTextColor(percentileValue),
                                  }
                                : null;
                            return (
                              <td
                                key={`pitch-log-cell-${rowIndex}-${column}`}
                                style={{
                                  textAlign: 'center',
                                  background: pitchLogSortColumn === column ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : undefined,
                                  color: pitchLogSortColumn === column ? '#fff' : undefined,
                                  cursor: canOpenPitchVideo ? 'pointer' : undefined,
                                  textDecoration: canOpenPitchVideo ? 'underline' : undefined,
                                }}
                                onClick={canOpenPitchVideo ? () => void openActionModal(pitchLogVideoQueue, rowPitch) : undefined}
                              >
                                {column === 'Team' && isPro ? (
                                  (() => {
                                    const code = inferProTeamCode(String(rawValue ?? ''));
                                    const logo = proxiedProTeamLogoUrl(code);
                                    return logo ? <img src={logo} alt={code || 'Team'} style={{ width: 18, height: 18, objectFit: 'contain' }} /> : <span>{displayValue}</span>;
                                  })()
                                ) : column === 'Opponent' && isPro ? (
                                  (() => {
                                    const code = inferProTeamCode(String(rawValue ?? ''));
                                    const logo = proxiedProTeamLogoUrl(code);
                                    const markerRaw = String(row._game_venue_marker ?? '').trim().toLowerCase();
                                    const markerText = markerRaw === '@' || markerRaw === 'away'
                                      ? '@'
                                      : markerRaw === 'vs.' || markerRaw === 'vs' || markerRaw === 'home'
                                        ? 'vs.'
                                        : '';
                                    return (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                                        {markerText ? <span>{markerText}</span> : null}
                                        {logo ? <img src={logo} alt={code || 'Opponent'} style={{ width: 18, height: 18, objectFit: 'contain' }} /> : <span>{displayValue}</span>}
                                      </span>
                                    );
                                  })()
                                ) : column === 'Team' && !isPro ? (
                                  formatTeamLabel(rawValue)
                                ) : column === 'Opponent' && !isPro ? (
                                  (() => {
                                    const rawOpponent = String(rawValue ?? '').trim();
                                    if (!rawOpponent) return '';
                                    const markerRaw = String(row._game_venue_marker ?? '').trim().toLowerCase();
                                    const markerText = markerRaw === '@' || markerRaw === 'away'
                                      ? '@ '
                                      : markerRaw === 'vs.' || markerRaw === 'vs' || markerRaw === 'home'
                                        ? 'vs. '
                                        : '';
                                    return `${markerText}${formatTeamLabel(rawValue)}`;
                                  })()
                                ) : percentileCellStyle ? (
                                  <span
                                    style={{
                                      ...percentileCellStyle,
                                      padding: '2px 4px',
                                      borderRadius: 3,
                                      display: 'inline-block',
                                      width: '100%',
                                      textAlign: 'center',
                                    }}
                                  >
                                    {showPitchLogPercentileLabel ? (
                                      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15 }}>
                                        <span>{displayValue}</span>
                                        <span style={{ fontSize: '0.66rem', opacity: 0.78, marginTop: 2 }}>{percentileValue!.toFixed(1)}%</span>
                                      </span>
                                    ) : (
                                      displayValue
                                    )}
                                  </span>
                                ) : (
                                  showPitchLogPercentileLabel ? (
                                    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15 }}>
                                      <span>{displayValue}</span>
                                      <span style={{ fontSize: '0.66rem', opacity: 0.78, marginTop: 2 }}>{percentileValue!.toFixed(1)}%</span>
                                    </span>
                                  ) : (
                                    displayValue
                                  )
                                )}
                              </td>
                            );
                          })}
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : dashboardPage === 'AB Report' ? (
            <div ref={abReportPdfRef}>
              <div className="dashboard-panel portal-ab-report-header" style={{ padding: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'start', gap: 12 }}>
                  <span aria-hidden="true" />
                  <div style={{ display: 'grid', justifyItems: 'center', textAlign: 'center', minWidth: 0 }}>
                    <h3 style={{ margin: 0 }}>
                      {selectedSinglePitcher ? formatNameFirstLast(selectedSinglePitcher) : 'AB Report'}
                    </h3>
                    <div className="portal-muted-text" style={{ marginTop: 3, fontSize: '0.82rem', fontWeight: 700 }}>
                      {abReport?.selected_game_date ? formatShortDate(abReport.selected_game_date) : '-'}
                    </div>
                    {abMatchup ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 9, minWidth: 0 }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                          {abMatchup.teamLogo ? (
                            <img src={abMatchup.teamLogo} alt={`${abMatchup.teamLabel} logo`} style={{ width: 30, height: 30, objectFit: 'contain', flex: '0 0 auto' }} />
                          ) : null}
                          <span style={{ fontWeight: 750 }}>{abMatchup.teamLabel}</span>
                        </div>
                        <span className="portal-muted-text" style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>vs</span>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                          {abMatchup.opponentLogo ? (
                            <img src={abMatchup.opponentLogo} alt={`${abMatchup.opponentLabel} logo`} style={{ width: 30, height: 30, objectFit: 'contain', flex: '0 0 auto' }} />
                          ) : null}
                          <span style={{ fontWeight: 750 }}>{abMatchup.opponentLabel}</span>
                        </div>
                      </div>
                    ) : null}
                    {abGameStatLine ? (
                      <div style={{ marginTop: abMatchup ? 7 : 9, fontSize: '0.9rem', fontWeight: 800, letterSpacing: '0.015em' }}>
                        {abGameStatLine}
                      </div>
                    ) : null}
                  </div>
                  {selectedSinglePitcher && abReport ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      data-ab-pdf-ignore="true"
                      disabled={isDownloadingAbPdf || !abCards.length}
                      onClick={() => void downloadAbReportPdf()}
                      style={{ justifySelf: 'end' }}
                    >
                      {isDownloadingAbPdf ? 'Downloading PDF...' : 'Download PDF'}
                    </button>
                  ) : null}
                </div>
              </div>
              {!selectedSinglePitcher ? (
                <p className="portal-muted-text" style={{ margin: '8px 0 0 0' }}>Select a single pitcher in the sidebar to view AB Report.</p>
              ) : null}
              {loadingAbReport ? <p>Loading AB report...</p> : null}
              {selectedSinglePitcher && abError ? <p className="auth-error">{abError}</p> : null}
              {selectedSinglePitcher && abPdfError ? <p className="auth-error" data-ab-pdf-ignore="true">{abPdfError}</p> : null}
              {selectedSinglePitcher && abReport ? (
                <div className="portal-pitching-ab-layout" style={{ display: 'grid', gridTemplateColumns: '280px minmax(0,1fr)', gap: 14 }}>
                  <aside className="portal-day-card portal-ab-sidebar" data-ab-pdf-ignore="true">
                    <label>
                      Select Game
                      <SearchableSingleSelect
                        options={abReport.available_games.map((game) => ({
                          value: game.game_key,
                          label: game.label
                            ? game.label
                            : game.date && game.game_key === game.date
                              ? formatShortDate(game.date)
                              : game.date
                                ? `${formatShortDate(game.date)} | ${game.game_key}`
                                : game.game_key,
                        }))}
                        value={abGameKey || abReport.selected_game_key || ''}
                        onChange={(next) => setAbGameKey(next)}
                        placeholder="Select game"
                      />
                    </label>
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Pitch Result</div>
                      <div style={{ display: 'grid', gap: 3, fontSize: '0.82rem' }}>
                        {[
                          { kind: 'called_strike', label: 'Called Strike' },
                          { kind: 'ball', label: 'Ball' },
                          { kind: 'foul', label: 'Foul' },
                          { kind: 'whiff', label: 'Whiff' },
                          { kind: 'in_play_out', label: 'In Play (Out)' },
                          { kind: 'in_play_hit', label: 'In Play (Hit)' },
                          { kind: 'error', label: 'Error' },
                        ].map((row) => (
                          <span key={`ab-result-legend-${row.label}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                width: 14,
                                height: 14,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                lineHeight: 1,
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                                {row.kind === 'called_strike' ? <circle cx="7" cy="7" r="4" fill="#fff" /> : null}
                                {row.kind === 'ball' ? <circle cx="7" cy="7" r="4" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                                {row.kind === 'foul' ? <polygon points="7,2 12,11 2,11" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                                {row.kind === 'whiff' ? (
                                  <polygon points="7,1.5 8.7,5.2 12.8,5.2 9.5,7.6 10.8,11.8 7,9.3 3.2,11.8 4.5,7.6 1.2,5.2 5.3,5.2" fill="#fff" />
                                ) : null}
                                {row.kind === 'in_play_out' ? <polygon points="7,2 12,11 2,11" fill="#fff" /> : null}
                                {row.kind === 'in_play_hit' ? <rect x="3" y="3" width="8" height="8" fill="#fff" /> : null}
                                {row.kind === 'error' ? <rect x="3" y="3" width="8" height="8" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                              </svg>
                            </span>
                            <span>{row.label}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Pitch Types</div>
                      <div style={{ display: 'grid', gap: 4 }}>
                        {[...abReport.pitch_type_legend]
                          .sort((a, b) => {
                            const ia = PITCH_TYPE_DISPLAY_ORDER.indexOf(a as (typeof PITCH_TYPE_DISPLAY_ORDER)[number]);
                            const ib = PITCH_TYPE_DISPLAY_ORDER.indexOf(b as (typeof PITCH_TYPE_DISPLAY_ORDER)[number]);
                            const oa = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
                            const ob = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
                            if (oa !== ob) return oa - ob;
                            return a.localeCompare(b);
                          })
                          .map((pt) => (
                          <span key={`ab-legend-${pt}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                            <span style={{ width: 12, height: 12, borderRadius: 2, background: pitchColors[pt] ?? '#9ca3af', border: '1px solid rgba(255,255,255,0.4)' }} />
                            <span>{pt}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </aside>
                  <div>
                    {abReport.pa_groups.length ? (
                      <div className="portal-ab-player-rows" style={{ display: 'grid', gap: 14 }}>
                        {abReport.pa_groups.map((group) => {
                          const batterSide = resolveAbBatterSide(group);
                          const batterNameColor = batterSide === 'L' ? '#dc2626' : batterSide === 'S' ? '#2563eb' : undefined;
                          return (
                          <section key={`ab-player-row-${group.batter}`} className="portal-ab-player-row" style={{ minWidth: 0 }}>
                            <h4 style={{ margin: '0 0 8px', textAlign: 'left', color: batterNameColor }}>
                              {formatNameFirstLast(group.batter)}{batterSide ? ` (${batterSide})` : ''}
                            </h4>
                            <div
                              className="portal-admin-grid portal-ab-pa-grid portal-ab-player-pa-grid"
                              style={{ gridTemplateColumns: `repeat(${group.pas.length}, minmax(300px, 1fr))`, overflowX: 'auto' }}
                            >
                              {group.pas.map((pa) => (
                          <article key={`ab-pa-${group.batter}-${pa.pa_index}`} className="portal-day-card portal-ab-pa-card">
                            <div style={{ textAlign: 'center', marginBottom: 2, fontWeight: 700 }}>{`PA #${pa.pa_index}`}</div>
                            <AbPaChart
                              pitches={pa.pitches}
                              resultLabel={pa.result_label}
                              onPitchClick={(pitch) => openActionModal(pa.pitches, pitch)}
                              pitchColors={pitchColors}
                              flipX={isPro}
                              isProSchool={isPro}
                            />
                            <div className="portal-table-wrap portal-ab-pa-table-wrap" style={{ marginTop: 8 }}>
                              <table className="portal-table">
                                <thead>
                                  <tr>
                                    {['Pitch #', 'Pitch', 'Velo', 'IVB', 'HB', 'EV', 'LA', 'Result'].map((column) => {
                                      const activeSort = abSortColumn === column;
                                      return (
                                        <th
                                          key={column}
                                          style={{
                                            textAlign: 'center',
                                            cursor: 'pointer',
                                            background: activeSort ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : undefined,
                                            color: activeSort ? '#fff' : undefined,
                                          }}
                                          onClick={() => {
                                            if (abSortColumn === column) {
                                              setAbSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                                            } else {
                                              setAbSortColumn(column);
                                              setAbSortDirection(column === 'Pitch #' ? 'asc' : 'desc');
                                            }
                                          }}
                                        >
                                          {column}
                                          {activeSort ? ` ${abSortDirection === 'asc' ? '↑' : '↓'}` : ''}
                                        </th>
                                      );
                                    })}
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortTableRows(
                                    pa.pitches.map((pitch, idx) => ({
                                      ...pitch,
                                      'Pitch #': idx + 1,
                                      Pitch: pitch.pitch_type || '-',
                                      Velo: pitch.velo,
                                      IVB: pitch.ivb,
                                      HB: pitch.hb,
                                      EV: pitch.exit_speed,
                                      LA: pitch.angle,
                                      Result: resolveAbPitchResult(pitch),
                                    })),
                                    abSortColumn,
                                    abSortDirection
                                  ).map((pitch, idx) => (
                                    <tr key={`ab-row-${idx}-${pitch.pitch_event_id ?? idx}`}>
                                      <td style={{ textAlign: 'center' }}>{String(pitch['Pitch #'] ?? idx + 1)}</td>
                                      <td style={{ textAlign: 'center' }}>{pitch.pitch_type || '-'}</td>
                                      <td style={{ textAlign: 'center' }}>{fmtNum(pitch.velo, 1)}</td>
                                      <td style={{ textAlign: 'center' }}>{fmtNum(pitch.ivb, 1)}</td>
                                      <td style={{ textAlign: 'center' }}>{fmtNum(pitch.hb, 1)}</td>
                                      <td style={{ textAlign: 'center' }}>{fmtNum(pitch.exit_speed, 1)}</td>
                                      <td style={{ textAlign: 'center' }}>{fmtNum(pitch.angle, 1)}</td>
                                      <td style={{ textAlign: 'center' }}>{resolveAbPitchResult(pitch)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </article>
                              ))}
                            </div>
                          </section>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="portal-muted-text">No completed plate appearances for the selected game.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : dashboardPage === 'Trend' ? (
            <>
              <h3>{overviewHeaderLabel}</h3>
              {loadingOverview ? <p>Loading trend data...</p> : null}
              {!((overview?.trend_rows?.length ?? 0) > 0 || summaryPoints.length > 0) ? (
                <p className="portal-muted-text">No trend data for current filters.</p>
              ) : (
                <article className="portal-day-card">
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px)', gap: 10, marginBottom: 10 }}>
                    <label>
                      Trend Stat
                      <SearchableSingleSelect
                        options={TREND_METRIC_OPTIONS}
                        value={trendMetric}
                        onChange={setTrendMetric}
                        placeholder="Velocity (Avg)"
                      />
                    </label>
                  </div>
                  {(() => {
                    const series = TREND_SESSION_ORDER.map((session) => ({
                      session,
                      color: TREND_SESSION_COLORS[session],
                      rows: trendSeriesBySessionData.rowsBySession[session].filter(
                        (row): row is { date: string; value: number; rowPitches: PitchActionPoint[]; pitches?: number } =>
                          typeof row.value === 'number' && Number.isFinite(row.value)
                      ),
                    }));
                    const allRows = series.flatMap((entry) => entry.rows);
                    if (!allRows.length) return <p className="portal-muted-text">No data available for this metric.</p>;

                    const w = 980;
                    const h = 400;
                    const m = { l: 64, r: 20, t: 18, b: 70 };
                    const pw = w - m.l - m.r;
                    const ph = h - m.t - m.b;
                    const pctMetrics = new Set(['InZone%', '<2kInZone%', '2kInZone%', 'Comp%', 'Strike%', '<2Kstrike%', '2Kstrike%', 'Swing%', 'FPS%', 'Early%', 'Ahead%', 'E+A%', '1-1W%', 'QP%', 'Whiff%', 'SwStrk%', 'CSW%', 'K%', 'BB%', 'GB%', 'FB%', 'Barrel%']);
                    const countMetrics = new Set(['P', 'BF', 'Whiffs', 'K', 'BB']);
                    const dateLevels = trendSeriesBySessionData.allDates;
                    const dateX = new Map(dateLevels.map((d, i) => [d, m.l + (i / Math.max(1, dateLevels.length - 1)) * pw]));
                    const vals = allRows.map((row) => row.value);
                    const minRaw = Math.min(...vals);
                    const maxRaw = Math.max(...vals);
                    let yMin = minRaw;
                    let yMax = maxRaw;
                    if (pctMetrics.has(trendMetric)) {
                      yMin = Math.max(0, Math.floor((minRaw - 2) / 5) * 5);
                      yMax = Math.min(100, Math.ceil((maxRaw + 2) / 5) * 5);
                      if (yMax <= yMin) yMax = Math.min(100, yMin + 5);
                    } else if (countMetrics.has(trendMetric)) {
                      yMin = Math.max(0, Math.floor(minRaw));
                      yMax = Math.ceil(maxRaw);
                      if (yMax <= yMin) yMax = yMin + 1;
                    } else if (trendMetric === 'Spin') {
                      yMin = Math.floor(minRaw / 100) * 100;
                      yMax = Math.ceil(maxRaw / 100) * 100;
                      if (yMax <= yMin) yMax = yMin + 100;
                    } else {
                      const pad = Math.max(0.4, (maxRaw - minRaw) * 0.12);
                      yMin = minRaw - pad;
                      yMax = maxRaw + pad;
                      if (yMax <= yMin) yMax = yMin + 1;
                    }
                    const py = (y: number) => m.t + ((yMax - y) / Math.max(1e-9, yMax - yMin)) * ph;
                    const ticksCount = 6;
                    const yTicks = Array.from({ length: ticksCount }, (_, idx) => yMin + (idx / (ticksCount - 1)) * (yMax - yMin));
                    const valueDigits = countMetrics.has(trendMetric) ? 0 : trendMetric === 'Spin' ? 0 : pctMetrics.has(trendMetric) ? 1 : 2;
                    const suffix = pctMetrics.has(trendMetric) ? '%' : '';

                    return (
                      <div style={{ position: 'relative' }}>
                        {!isPro ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 8 }}>
                            {series.map((entry) => (
                              <span key={`trend-legend-${entry.session}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                                <span style={{ width: 14, height: 3, borderRadius: 999, background: entry.color }} />
                                <span>{entry.session}</span>
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <svg
                          viewBox={`0 0 ${w} ${h}`}
                          style={{
                            width: '100%',
                            height: isMobileView ? 'auto' : 400,
                            aspectRatio: `${w} / ${h}`,
                            border: '1px solid rgba(255,255,255,0.14)',
                            borderRadius: 10,
                          }}
                          onMouseLeave={() => setTrendHover(null)}
                        >
                          {yTicks.map((tick, idx) => (
                            <g key={`trend-y-${idx}`}>
                              <line x1={m.l} y1={py(tick)} x2={w - m.r} y2={py(tick)} stroke="rgba(255,255,255,0.14)" />
                              <text x={m.l - 8} y={py(tick) + 4} textAnchor="end" fill="rgba(255,255,255,0.78)" fontSize={11}>
                                {tick.toFixed(valueDigits)}{suffix}
                              </text>
                            </g>
                          ))}
                          {dateLevels.map((d) => (
                            <g key={`trend-x-${d}`}>
                              <line x1={Number(dateX.get(d))} y1={m.t} x2={Number(dateX.get(d))} y2={h - m.b} stroke="rgba(255,255,255,0.08)" />
                              <text x={Number(dateX.get(d))} y={h - m.b + 22} textAnchor="middle" dominantBaseline="hanging" fill="rgba(255,255,255,0.78)" fontSize={11}>
                                {formatShortDate(d)}
                              </text>
                            </g>
                          ))}
                          {series.map((entry) => {
                            if (!entry.rows.length) return null;
                            const polyline = entry.rows
                              .map((row) => `${Number(dateX.get(row.date))},${py(row.value)}`)
                              .join(' ');
                            return (
                              <g key={`trend-series-${entry.session}`}>
                                <polyline points={polyline} fill="none" stroke={entry.color} strokeWidth={2.1} />
                                {entry.rows.map((row, idx) => (
                                  <circle
                                    key={`trend-pt-${entry.session}-${idx}`}
                                    cx={Number(dateX.get(row.date))}
                                    cy={py(row.value)}
                                    r={4.2}
                                    fill={entry.color}
                                    stroke="#ffffff"
                                    strokeWidth={1.2}
                                    onMouseMove={(event) =>
                                      setTrendHover({
                                        x: event.clientX,
                                        y: event.clientY,
                                        bg: '#111827',
                                        text: `${!isPro ? `${entry.session}\n` : ''}${formatShortDate(row.date)}\n${trendMetric}: ${fmtNum(row.value, valueDigits)}${suffix}\nPitches: ${row.pitches ?? row.rowPitches.length}`,
                                      })
                                    }
                                    onClick={() => {
                                      if (row.rowPitches.length > 0) openActionModal(row.rowPitches);
                                    }}
                                    style={{ cursor: 'pointer' }}
                                  />
                                ))}
                              </g>
                            );
                          })}
                        </svg>
                        {trendHover ? (
                          <div style={{ position: 'fixed', left: trendHover.x + 12, top: trendHover.y + 12, zIndex: 80, pointerEvents: 'none', whiteSpace: 'pre-line', background: trendHover.bg ?? 'rgba(0,0,0,0.92)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 8, padding: '0.35rem 0.45rem', fontSize: '0.74rem', lineHeight: 1.25, color: pitchHoverTextColor(trendHover.bg) }}>
                            {trendHover.text}
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
                </article>
              )}
            </>
          ) : dashboardPage === 'HeatMaps' ? (
            <>
              <h3>{overviewHeaderLabel}</h3>
              {loadingOverview ? <p>Loading heatmap data...</p> : null}
              {!summaryPoints.length ? (
                <p className="portal-muted-text">No heatmap data for current filters.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 14 }}>
                  <aside className="portal-day-card portal-ab-sidebar">
                    <label>
                      Chart Type
                      <SearchableSingleSelect
                        options={[
                          { value: 'Heat', label: 'Heat' },
                          { value: 'Pitch', label: 'Pitch' },
                          { value: 'QP+', label: 'QP+' },
                        ]}
                        value={heatmapChartType}
                        onChange={(next) => {
                          const normalized = next as 'Heat' | 'Pitch' | 'QP+';
                          setHeatmapChartType(normalized);
                          if (normalized === 'Pitch') setLocationView('Pitch');
                          if (normalized === 'QP+') setLocationView('QP+');
                          if (normalized === 'Heat') setLocationView(heatmapStat);
                        }}
                        placeholder="Pitch"
                      />
                    </label>
                    <label style={{ marginTop: 10 }}>
                      Stat
                      <SearchableSingleSelect
                        options={heatmapStatOptions}
                        value={heatmapStat}
                        onChange={(next) => {
                          setHeatmapStat(next);
                          if (heatmapChartType === 'Heat') setLocationView(next);
                        }}
                        placeholder="Frequency"
                      />
                    </label>
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Pitch Result</div>
                      <div style={{ display: 'grid', gap: 3, fontSize: '0.82rem' }}>
                        {[
                          { kind: 'called_strike', label: 'Called Strike' },
                          { kind: 'ball', label: 'Ball' },
                          { kind: 'foul', label: 'Foul' },
                          { kind: 'whiff', label: 'Whiff' },
                          { kind: 'in_play_out', label: 'In Play (Out)' },
                          { kind: 'in_play_hit', label: 'In Play (Hit)' },
                          { kind: 'error', label: 'Error' },
                        ].map((row) => (
                          <span key={`hm-result-legend-${row.label}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                width: 14,
                                height: 14,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                lineHeight: 1,
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                                {row.kind === 'called_strike' ? <circle cx="7" cy="7" r="4" fill="#fff" /> : null}
                                {row.kind === 'ball' ? <circle cx="7" cy="7" r="4" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                                {row.kind === 'foul' ? <polygon points="7,2 12,11 2,11" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                                {row.kind === 'whiff' ? (
                                  <polygon points="7,1.5 8.7,5.2 12.8,5.2 9.5,7.6 10.8,11.8 7,9.3 3.2,11.8 4.5,7.6 1.2,5.2 5.3,5.2" fill="#fff" />
                                ) : null}
                                {row.kind === 'in_play_out' ? <polygon points="7,2 12,11 2,11" fill="#fff" /> : null}
                                {row.kind === 'in_play_hit' ? <rect x="3" y="3" width="8" height="8" fill="#fff" /> : null}
                                {row.kind === 'error' ? <rect x="3" y="3" width="8" height="8" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                              </svg>
                            </span>
                            <span>{row.label}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Pitch Types</div>
                      <div style={{ display: 'grid', gap: 4 }}>
                        {PITCH_TYPE_DISPLAY_ORDER.map((pt) => (
                          <span key={`hm-legend-${pt}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                            <span style={{ width: 12, height: 12, borderRadius: 2, background: pitchColors[pt] ?? '#9ca3af', border: '1px solid rgba(255,255,255,0.4)' }} />
                            <span>{pt}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </aside>
                  <article className="portal-day-card" style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
                    {heatmapDisplayView !== 'Pitch' ? (
                      <div style={{ display: 'grid', justifyItems: 'center', gap: 4, marginBottom: 8 }}>
                        <div
                          style={{
                            width: 260,
                            height: 20,
                            border: '1px solid rgba(255,255,255,0.25)',
                            background: 'linear-gradient(90deg, rgb(32,74,135) 0%, rgb(246,248,248) 50%, rgb(220,20,20) 100%)',
                          }}
                        />
                        <div style={{ width: 260, display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'rgba(255,255,255,0.92)' }}>
                          <span>Least{heatmapsPageLegendRange?.isFixed ? ` (${formatHeatmapLegendValue(heatmapDisplayView, heatmapsPageLegendRange.min)})` : ''}</span>
                          <span>Most{heatmapsPageLegendRange?.isFixed ? ` (${formatHeatmapLegendValue(heatmapDisplayView, heatmapsPageLegendRange.max)})` : ''}</span>
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{heatmapDisplayView === 'Frequency' ? 'Pitch Frequency' : heatmapDisplayView}</div>
                      </div>
                    ) : null}
                    {heatmapDisplayView === 'QP+' && !canRenderQpHeatmap ? (
                      <p className="portal-muted-text" style={{ marginTop: 0, marginBottom: 10, textAlign: 'center' }}>
                        QP+ requires: one Pitch Type, Pitcher (or Pitcher Hand), Hitter (or Batter Hand), and one Count bucket (Ahead/Even/Behind).
                      </p>
                    ) : null}
                    <div style={{ position: 'relative' }}>
                      {heatmapsPageSvg}
                      {locationHover ? (
                        <div
                          style={{
                            position: 'fixed',
                            left: locationHover.x + 12,
                            top: locationHover.y + 12,
                            zIndex: 80,
                            pointerEvents: 'none',
                            whiteSpace: 'pre-line',
                            background: locationHover.bg ?? 'rgba(0,0,0,0.92)',
                            border: '1px solid rgba(255,255,255,0.22)',
                            borderRadius: 8,
                            padding: '0.35rem 0.45rem',
                            fontSize: '0.74rem',
                            lineHeight: 1.25,
                            color: pitchHoverTextColor(locationHover.bg),
                          }}
                        >
                          {locationHover.text}
                        </div>
                      ) : null}
                    </div>
                  </article>
                </div>
              )}
            </>
          ) : dashboardPage === 'Velo Manual Entry' ? (
            <>
              <h3>Velo Manual Entry</h3>
              {loadingManualEntries ? <p>Loading manual velocity entries...</p> : null}
              {manualEntriesError ? <p className="auth-error">{manualEntriesError}</p> : null}
              <div className="portal-choice-line-actions" style={{ marginBottom: 10 }}>
                <button type="button" className={manualEntryTab === 'Entry' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setManualEntryTab('Entry')}>
                  Entry
                </button>
                <button type="button" className={manualEntryTab === 'Progress' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setManualEntryTab('Progress')}>
                  Progress
                </button>
              </div>
              {manualEntryTab === 'Entry' ? (
                <div className="portal-admin-grid" style={{ gridTemplateColumns: 'minmax(300px, 420px) minmax(0, 1fr)', gap: 12 }}>
                  <article className="portal-day-card portal-manual-progress-sidebar">
                    <h4 style={{ marginTop: 0 }}>Add Velocity Entries</h4>
                    <div className="portal-form-grid">
                      <label>
                        Date
                        <NativeDateInput value={manualDate} onChange={setManualDate} ariaLabel="Date" />
                      </label>
                      <label>
                        Pitcher
                        <SearchableSingleSelect
                          options={manualPitcherOptions}
                          value={manualPitcher}
                          onChange={setManualPitcher}
                          placeholder="All"
                        />
                      </label>
                      <label>
                        Throw Type
                        <SearchableSingleSelect
                          options={manualThrowTypeOptions.map((value) => ({ value, label: value }))}
                          value={manualThrowType}
                          onChange={setManualThrowType}
                          placeholder="Pulldowns"
                        />
                      </label>
                      {manualThrowType === 'Other' ? (
                        <label>
                          Custom Throw Type
                          <input value={manualThrowTypeOther} onChange={(event) => setManualThrowTypeOther(event.target.value)} placeholder="e.g., Run-and-Gun" />
                        </label>
                      ) : null}
                      {manualThrowType === 'Plyo Velo' ? (
                        <label>
                          Plyo Drill
                          <input
                            value={manualPlyoDrill}
                            onChange={(event) => setManualPlyoDrill(event.target.value)}
                            placeholder="Select or type a plyo drill"
                            list="manual-plyo-drill-options"
                          />
                          <datalist id="manual-plyo-drill-options">
                            {manualPlyoDrillOptions.map((value) => (
                              <option key={`plyo-option-${value}`} value={value} />
                            ))}
                          </datalist>
                        </label>
                      ) : null}
                      <label>
                        Ball Weight (oz)
                        <input type="number" min={0.5} step={0.25} value={manualWeight} onChange={(event) => setManualWeight(event.target.value)} />
                      </label>
                      <label>
                        Single Velocity (mph)
                        <input type="number" min={30} step={0.1} value={manualSingleVelo} onChange={(event) => setManualSingleVelo(event.target.value)} />
                      </label>
                      <label style={{ gridColumn: '1 / -1' }}>
                        Batch Velocities
                        <textarea value={manualBatchVelo} onChange={(event) => setManualBatchVelo(event.target.value)} rows={3} placeholder="Enter multiple values: 90.2, 91.1, 92.0" />
                      </label>
                      <label style={{ gridColumn: '1 / -1' }}>
                        Notes
                        <textarea value={manualNotes} onChange={(event) => setManualNotes(event.target.value)} rows={2} placeholder="Drill cue, intent, feedback..." />
                      </label>
                    </div>
                    <div className="portal-choice-line-actions" style={{ marginTop: 10 }}>
                      <button type="button" className="btn btn-primary" onClick={() => void saveManualEntries()}>
                        Save Entries
                      </button>
                    </div>
                    {manualVeloStatus ? <p className="portal-muted-text" style={{ marginBottom: 0 }}>{manualVeloStatus}</p> : null}
                  </article>
                  <article className="portal-day-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <h4 style={{ margin: 0 }}>Recent Manual Entries</h4>
                      <button type="button" className="btn btn-ghost" onClick={() => void deleteManualEntry()}>
                        Delete Selected
                      </button>
                    </div>
                    {!manualEntries.length ? (
                      <p className="portal-muted-text">No manual entries yet.</p>
                    ) : (
                      <div style={{ maxHeight: 560, overflow: 'auto', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }}>
                        <table className="portal-table">
                          <thead>
                            <tr>
                              {['Date', 'Pitcher', 'Throw Type', 'Plyo Drill', 'Ball (oz)', 'Velo (mph)', 'Notes'].map((column) => {
                                const activeSort = manualEntriesSortColumn === column;
                                  return (
                                    <th
                                      key={column}
                                      style={{
                                        cursor: 'pointer',
                                        background: activeSort ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : undefined,
                                        color: activeSort ? '#fff' : undefined,
                                      }}
                                      onClick={() => {
                                        if (manualEntriesSortColumn === column) {
                                          setManualEntriesSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                                      } else {
                                        setManualEntriesSortColumn(column);
                                        setManualEntriesSortDirection(column === 'Pitcher' || column === 'Throw Type' || column === 'Plyo Drill' || column === 'Notes' ? 'asc' : 'desc');
                                      }
                                    }}
                                  >
                                    {column}
                                    {activeSort ? ` ${manualEntriesSortDirection === 'asc' ? '↑' : '↓'}` : ''}
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {sortedManualEntries.map((entry) => (
                              <tr
                                key={`manual-entry-${entry.id}`}
                                onClick={() => setManualSelectedEntryId(entry.id)}
                                style={{
                                  cursor: 'pointer',
                                  background: manualSelectedEntryId === entry.id ? 'rgba(220, 38, 38, 0.16)' : undefined,
                                }}
                              >
                                <td>{formatShortDate(entry.entry_date)}</td>
                                <td>{formatNameFirstLast(entry.pitcher)}</td>
                                <td>{entry.throw_type}</td>
                                <td>{entry.throw_type === 'Plyo Velo' ? entry.plyo_drill : ''}</td>
                                <td>{fmtNum(entry.ball_weight_oz, 2)}</td>
                                <td>{fmtNum(entry.velocity_mph, 1)}</td>
                                <td>{entry.notes}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>
                </div>
              ) : (
                <div className="portal-admin-grid" style={{ gridTemplateColumns: '280px minmax(0, 1fr)', gap: 12 }}>
                  <article className="portal-day-card">
                    <label>
                      Pitcher
                      <SearchableSingleSelect
                        options={manualPitcherOptions}
                        value={manualPitcherFilter}
                        onChange={setManualPitcherFilter}
                      />
                    </label>
                    <label>
                      Throw Type
                      <SearchableMultiSelect
                        options={[{ value: 'All', label: 'All' }, ...manualThrowTypeOptions.map((value) => ({ value, label: value }))]}
                        values={manualTypeFilter}
                        onChange={setManualTypeFilter}
                      />
                    </label>
                    <label>
                      Date Start
                      <NativeDateInput value={manualDateStart} onChange={setManualDateStart} ariaLabel="Date Start" />
                    </label>
                    <label>
                      Date End
                      <NativeDateInput value={manualDateEnd} onChange={setManualDateEnd} ariaLabel="Date End" />
                    </label>
                    <label>
                      Weight Min (oz)
                      <input type="number" min={0.5} step={0.25} value={manualWeightMin} onChange={(event) => setManualWeightMin(event.target.value)} />
                    </label>
                    <label>
                      Weight Max (oz)
                      <input type="number" min={0.5} step={0.25} value={manualWeightMax} onChange={(event) => setManualWeightMax(event.target.value)} />
                    </label>
                    <label>
                      Chart View
                      <SearchableSingleSelect
                        options={[
                          { value: 'Trend by Drill', label: 'Trend by Drill' },
                          { value: 'Velocity Distribution', label: 'Velocity Distribution' },
                          { value: 'Weight vs Velocity', label: 'Weight vs Velocity' },
                          { value: 'PR Timeline', label: 'PR Timeline' },
                        ]}
                        value={manualChartType}
                        onChange={(next) => setManualChartType(next as typeof manualChartType)}
                        placeholder="Trend by Drill"
                      />
                    </label>
                    <label>
                      KPI Data Points
                      <SearchableMultiSelect
                        options={[{ value: 'All', label: 'All' }, ...manualKpiSeriesOptions]}
                        values={manualKpiSeriesFilter}
                        onChange={setManualKpiSeriesFilter}
                      />
                    </label>
                  </article>
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div className="portal-admin-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(150px, 1fr))', gap: 10 }}>
                      <article className="portal-day-card"><div className="portal-muted-text">Entries</div><div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{manualKpis?.entries ?? 0}</div></article>
                      <article className="portal-day-card"><div className="portal-muted-text">Average Velo</div><div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{fmtNum(manualKpis?.avg, 1)}</div></article>
                      <article className="portal-day-card"><div className="portal-muted-text">Peak Velo</div><div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{fmtNum(manualKpis?.peak, 1)}</div></article>
                      <article className="portal-day-card"><div className="portal-muted-text">Data Points</div><div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{manualKpis?.typeCount ?? 0}</div></article>
                    </div>
                    <article className="portal-day-card">
                      <h4 style={{ marginTop: 0 }}>{manualChartType}</h4>
                      {!manualFilteredEntries.length ? (
                        <p className="portal-muted-text">No manual velocity data for current filters.</p>
                      ) : (
                        <div style={{ display: 'grid', gap: 10 }}>
                          <div style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: 8 }}>
                            {(() => {
                              const w = 980;
                              const h = 360;
                              const m = { l: 52, r: 16, t: 16, b: 56 };
                              const plotW = w - m.l - m.r;
                              const plotH = h - m.t - m.b;
                              const values = manualFilteredEntries.map((entry) => Number(entry.velocity_mph)).filter((value) => Number.isFinite(value));
                              const yMin = Math.floor((Math.min(...values) - 1) / 2) * 2;
                              const yMax = Math.max(yMin + 2, Math.ceil((Math.max(...values) + 1) / 2) * 2);
                              const py = (value: number) => m.t + ((yMax - value) / Math.max(0.00001, yMax - yMin)) * plotH;
                              const palette = ['#60a5fa', '#f59e0b', '#22c55e', '#ef4444', '#a78bfa', '#14b8a6', '#f97316', '#e879f9'];
                              const seriesKeys = Array.from(new Set(manualFilteredEntries.map((entry) => manualVelocitySeriesKey(entry)))).sort((a, b) => a.localeCompare(b));
                              const seriesColor = new Map(seriesKeys.map((type, index) => [type, palette[index % palette.length]]));
                              const legend = (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: '0.78rem' }}>
                                  {seriesKeys.map((key) => (
                                    <span key={`manual-legend-${key}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ width: 10, height: 10, borderRadius: 999, background: seriesColor.get(key) ?? '#9ca3af', border: '1px solid rgba(255,255,255,0.35)' }} />
                                      <span>{key}</span>
                                    </span>
                                  ))}
                                </div>
                              );

                              if (manualChartType === 'Velocity Distribution') {
                                const px = (index: number) => m.l + ((index + 0.5) / Math.max(1, seriesKeys.length)) * plotW;
                                return (
                                  <div style={{ display: 'grid', gap: 8 }}>
                                    {legend}
                                    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 340 }} onMouseLeave={() => setManualChartHover(null)}>
                                      {Array.from({ length: Math.floor((yMax - yMin) / 2) + 1 }, (_, i) => yMin + i * 2).map((tick) => (
                                        <g key={`manual-dist-y-${tick}`}>
                                          <line x1={m.l} y1={py(tick)} x2={w - m.r} y2={py(tick)} stroke="rgba(255,255,255,0.12)" />
                                          <text x={m.l - 8} y={py(tick) + 4} textAnchor="end" fill="rgba(255,255,255,0.75)" fontSize={11}>
                                            {tick}
                                          </text>
                                        </g>
                                      ))}
                                      {seriesKeys.map((type, index) => {
                                        const x = px(index);
                                        return (
                                          <text key={`manual-dist-x-${type}`} x={x} y={h - 16} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize={11}>
                                            {type}
                                          </text>
                                        );
                                      })}
                                      {manualFilteredEntries.map((entry, index) => {
                                        const key = manualVelocitySeriesKey(entry);
                                        const typeIndex = seriesKeys.findIndex((type) => type === key);
                                        const baseX = px(Math.max(0, typeIndex));
                                        const jitter = ((index % 9) - 4) * 2.2;
                                        return (
                                          <circle
                                            key={`manual-dist-pt-${entry.id}`}
                                            cx={baseX + jitter}
                                            cy={py(Number(entry.velocity_mph))}
                                            r={3.4}
                                            fill={seriesColor.get(key) ?? '#9ca3af'}
                                            opacity={0.8}
                                            onMouseMove={(event) =>
                                              setManualChartHover({
                                                x: event.clientX,
                                                y: event.clientY,
                                                bg: seriesColor.get(key) ?? '#111827',
                                                text: manualVeloHoverText(entry),
                                              })
                                            }
                                          />
                                        );
                                      })}
                                    </svg>
                                  </div>
                                );
                              }

                              if (manualChartType === 'Weight vs Velocity') {
                                const weightValues = manualFilteredEntries.map((entry) => Number(entry.ball_weight_oz)).filter((value) => Number.isFinite(value));
                                const xMin = Math.min(...weightValues);
                                const xMax = Math.max(...weightValues);
                                const px = (value: number) =>
                                  m.l + ((value - xMin) / Math.max(0.00001, xMax - xMin || 1)) * plotW;
                                return (
                                  <div style={{ display: 'grid', gap: 8 }}>
                                    {legend}
                                    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 340 }} onMouseLeave={() => setManualChartHover(null)}>
                                      {Array.from({ length: Math.floor((yMax - yMin) / 2) + 1 }, (_, i) => yMin + i * 2).map((tick) => (
                                        <g key={`manual-wv-y-${tick}`}>
                                          <line x1={m.l} y1={py(tick)} x2={w - m.r} y2={py(tick)} stroke="rgba(255,255,255,0.12)" />
                                          <text x={m.l - 8} y={py(tick) + 4} textAnchor="end" fill="rgba(255,255,255,0.75)" fontSize={11}>
                                            {tick}
                                          </text>
                                        </g>
                                      ))}
                                      {manualFilteredEntries.map((entry) => {
                                        const key = manualVelocitySeriesKey(entry);
                                        return (
                                          <circle
                                            key={`manual-wv-pt-${entry.id}`}
                                            cx={px(Number(entry.ball_weight_oz))}
                                            cy={py(Number(entry.velocity_mph))}
                                            r={3.5}
                                            fill={seriesColor.get(key) ?? '#9ca3af'}
                                            opacity={0.85}
                                            onMouseMove={(event) =>
                                              setManualChartHover({
                                                x: event.clientX,
                                                y: event.clientY,
                                                bg: seriesColor.get(key) ?? '#111827',
                                                text: manualVeloHoverText(entry),
                                              })
                                            }
                                          />
                                        );
                                      })}
                                      <text x={w / 2} y={h - 16} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize={11}>
                                        Ball Weight (oz)
                                      </text>
                                    </svg>
                                  </div>
                                );
                              }

                              const dateLevels = Array.from(
                                new Set(manualFilteredEntries.map((entry) => entry.entry_date))
                              ).sort((a, b) => a.localeCompare(b));
                              const pxDate = new Map(
                                dateLevels.map((date, index) => [
                                  date,
                                  m.l + (index / Math.max(1, dateLevels.length - 1)) * plotW,
                                ])
                              );

                              if (manualChartType === 'PR Timeline') {
                                const sorted = [...manualFilteredEntries].sort((a, b) =>
                                  a.entry_date === b.entry_date ? a.created_at.localeCompare(b.created_at) : a.entry_date.localeCompare(b.entry_date)
                                );
                                let runningMax = Number.NEGATIVE_INFINITY;
                                const pts = sorted.map((entry) => {
                                  runningMax = Math.max(runningMax, Number(entry.velocity_mph));
                                  return { date: entry.entry_date, value: runningMax };
                                });
                                const poly = pts
                                  .map((point) => `${Number(pxDate.get(point.date))},${py(point.value)}`)
                                  .join(' ');
                                return (
                                  <div style={{ display: 'grid', gap: 8 }}>
                                    {legend}
                                    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 340 }} onMouseLeave={() => setManualChartHover(null)}>
                                      {Array.from({ length: Math.floor((yMax - yMin) / 2) + 1 }, (_, i) => yMin + i * 2).map((tick) => (
                                        <g key={`manual-pr-y-${tick}`}>
                                          <line x1={m.l} y1={py(tick)} x2={w - m.r} y2={py(tick)} stroke="rgba(255,255,255,0.12)" />
                                          <text x={m.l - 8} y={py(tick) + 4} textAnchor="end" fill="rgba(255,255,255,0.75)" fontSize={11}>
                                            {tick}
                                          </text>
                                        </g>
                                      ))}
                                      <polyline points={poly} fill="none" stroke="#dc2626" strokeWidth={2} />
                                      {sorted.map((entry) => {
                                        const key = manualVelocitySeriesKey(entry);
                                        return (
                                          <circle
                                            key={`manual-pr-pt-${entry.id}`}
                                            cx={Number(pxDate.get(entry.entry_date))}
                                            cy={py(Number(entry.velocity_mph))}
                                            r={3.3}
                                            fill={seriesColor.get(key) ?? '#9ca3af'}
                                            opacity={0.55}
                                            onMouseMove={(event) =>
                                              setManualChartHover({
                                                x: event.clientX,
                                                y: event.clientY,
                                                bg: seriesColor.get(key) ?? '#111827',
                                                text: manualVeloHoverText(entry),
                                              })
                                            }
                                          />
                                        );
                                      })}
                                      {dateLevels.map((date) => (
                                        <text key={`manual-pr-x-${date}`} x={Number(pxDate.get(date))} y={h - 16} textAnchor="middle" fill="rgba(255,255,255,0.75)" fontSize={10}>
                                          {formatShortDate(date)}
                                        </text>
                                      ))}
                                    </svg>
                                  </div>
                                );
                              }

                              const grouped = new Map<string, Map<string, { sum: number; n: number; peak: number; weightSum: number; weightN: number }>>();
                              for (const entry of manualFilteredEntries) {
                                const key = manualVelocitySeriesKey(entry);
                                const byType = grouped.get(key) ?? new Map<string, { sum: number; n: number; peak: number; weightSum: number; weightN: number }>();
                                const cur = byType.get(entry.entry_date) ?? { sum: 0, n: 0, peak: Number.NEGATIVE_INFINITY, weightSum: 0, weightN: 0 };
                                cur.sum += Number(entry.velocity_mph);
                                cur.n += 1;
                                cur.peak = Math.max(cur.peak, Number(entry.velocity_mph));
                                if (Number.isFinite(Number(entry.ball_weight_oz))) {
                                  cur.weightSum += Number(entry.ball_weight_oz);
                                  cur.weightN += 1;
                                }
                                byType.set(entry.entry_date, cur);
                                grouped.set(key, byType);
                              }
                              return (
                                <div style={{ display: 'grid', gap: 8 }}>
                                  {legend}
                                  <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 340 }} onMouseLeave={() => setManualChartHover(null)}>
                                    {Array.from({ length: Math.floor((yMax - yMin) / 2) + 1 }, (_, i) => yMin + i * 2).map((tick) => (
                                      <g key={`manual-trend-y-${tick}`}>
                                        <line x1={m.l} y1={py(tick)} x2={w - m.r} y2={py(tick)} stroke="rgba(255,255,255,0.12)" />
                                        <text x={m.l - 8} y={py(tick) + 4} textAnchor="end" fill="rgba(255,255,255,0.75)" fontSize={11}>
                                          {tick}
                                        </text>
                                      </g>
                                    ))}
                                    {dateLevels.map((date) => (
                                      <text key={`manual-trend-x-${date}`} x={Number(pxDate.get(date))} y={h - 16} textAnchor="middle" fill="rgba(255,255,255,0.75)" fontSize={10}>
                                        {formatShortDate(date)}
                                      </text>
                                    ))}
                                    {Array.from(grouped.entries()).map(([throwType, perDate]) => {
                                      const points = dateLevels
                                        .filter((date) => perDate.has(date))
                                        .map((date) => {
                                          const rec = perDate.get(date)!;
                                          return {
                                            date,
                                            mean: rec.sum / Math.max(1, rec.n),
                                            peak: rec.peak,
                                            weightAvg: rec.weightN > 0 ? rec.weightSum / rec.weightN : null,
                                          };
                                        });
                                      const poly = points
                                        .map((point) => `${Number(pxDate.get(point.date))},${py(point.mean)}`)
                                        .join(' ');
                                      const color = seriesColor.get(throwType) ?? '#9ca3af';
                                      return (
                                        <g key={`manual-trend-line-${throwType}`}>
                                          <polyline points={poly} fill="none" stroke={color} strokeWidth={1.9} />
                                          {points.map((point, index) => (
                                            <g key={`manual-trend-pt-${throwType}-${index}`}>
                                              <circle
                                                cx={Number(pxDate.get(point.date))}
                                                cy={py(point.mean)}
                                                r={3.3}
                                                fill={color}
                                                onMouseMove={(event) =>
                                                  setManualChartHover({
                                                    x: event.clientX,
                                                    y: event.clientY,
                                                    bg: color,
                                                    text: [
                                                      `Date: ${formatShortDate(point.date)}`,
                                                      `Throw Type: ${throwType.startsWith('Plyo: ') ? 'Plyo Velo' : throwType}`,
                                                      ...(throwType.startsWith('Plyo: ') ? [`Drill: ${throwType.replace(/^Plyo:\s*/, '')}`] : []),
                                                      `Velo: ${fmtNum(point.mean, 1)} mph`,
                                                      `Weight: ${fmtNum(point.weightAvg, 2)} oz`,
                                                    ].join('\n'),
                                                  })
                                                }
                                              />
                                              <polygon
                                                points={`${Number(pxDate.get(point.date))},${py(point.peak) - 4.2} ${Number(pxDate.get(point.date)) - 3.6},${py(point.peak) + 3.4} ${Number(pxDate.get(point.date)) + 3.6},${py(point.peak) + 3.4}`}
                                                fill={color}
                                                opacity={0.7}
                                                onMouseMove={(event) =>
                                                  setManualChartHover({
                                                    x: event.clientX,
                                                    y: event.clientY,
                                                    bg: color,
                                                    text: [
                                                      `Date: ${formatShortDate(point.date)}`,
                                                      `Throw Type: ${throwType.startsWith('Plyo: ') ? 'Plyo Velo' : throwType}`,
                                                      ...(throwType.startsWith('Plyo: ') ? [`Drill: ${throwType.replace(/^Plyo:\s*/, '')}`] : []),
                                                      `Velo: ${fmtNum(point.peak, 1)} mph`,
                                                      `Weight: ${fmtNum(point.weightAvg, 2)} oz`,
                                                    ].join('\n'),
                                                  })
                                                }
                                              />
                                            </g>
                                          ))}
                                        </g>
                                      );
                                    })}
                                  </svg>
                                </div>
                              );
                            })()}
                          </div>
                          {manualChartHover ? (
                            <div
                              style={{
                                position: 'fixed',
                                left: manualChartHover.x + 12,
                                top: manualChartHover.y + 12,
                                zIndex: 90,
                                pointerEvents: 'none',
                                whiteSpace: 'pre-line',
                                background: manualChartHover.bg ?? 'rgba(0,0,0,0.92)',
                                border: '1px solid rgba(255,255,255,0.22)',
                                borderRadius: 8,
                                padding: '0.35rem 0.45rem',
                                fontSize: '0.74rem',
                                lineHeight: 1.25,
                                color: pitchHoverTextColor(manualChartHover.bg),
                              }}
                            >
                              {manualChartHover.text}
                            </div>
                          ) : null}
                          <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }}>
                            <table className="portal-table">
                              <thead>
                                <tr>
                                  {['Date', 'Pitcher', 'Throw Type', 'Plyo Drill', 'Ball (oz)', 'Velo (mph)'].map((column) => {
                                    const activeSort = manualProgressSortColumn === column;
                                    return (
                                      <th
                                        key={column}
                                        style={{
                                          cursor: 'pointer',
                                          background: activeSort ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : undefined,
                                          color: activeSort ? '#fff' : undefined,
                                        }}
                                        onClick={() => {
                                          if (manualProgressSortColumn === column) {
                                            setManualProgressSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                                          } else {
                                            setManualProgressSortColumn(column);
                                            setManualProgressSortDirection(column === 'Pitcher' || column === 'Throw Type' || column === 'Plyo Drill' ? 'asc' : 'desc');
                                          }
                                        }}
                                      >
                                        {column}
                                        {activeSort ? ` ${manualProgressSortDirection === 'asc' ? '↑' : '↓'}` : ''}
                                      </th>
                                    );
                                  })}
                                </tr>
                              </thead>
                              <tbody>
                                {sortedManualFilteredEntries.map((entry) => (
                                  <tr key={`manual-progress-${entry.id}`}>
                                    <td>{formatShortDate(entry.entry_date)}</td>
                                    <td>{formatNameFirstLast(entry.pitcher)}</td>
                                    <td>{entry.throw_type}</td>
                                    <td>{entry.throw_type === 'Plyo Velo' ? entry.plyo_drill : ''}</td>
                                    <td>{fmtNum(entry.ball_weight_oz, 2)}</td>
                                    <td>{fmtNum(entry.velocity_mph, 1)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </article>
                  </div>
                </div>
              )}
            </>
          ) : dashboardPage === 'QP Locations' ? (
            <>
              <h3>{overviewHeaderLabel}</h3>
              {loadingOverview ? <p>Loading QP location data...</p> : null}
              {!summaryPoints.length ? (
                <p className="portal-muted-text">No data for current filters.</p>
              ) : !canRenderQpLocationsPage ? (
                <div className="portal-day-card" style={{ textAlign: 'center', paddingBlock: '2rem' }}>
                  <h4 style={{ marginBottom: 6 }}>QP+ Locations requires handedness selection</h4>
                  <p className="portal-muted-text" style={{ margin: 0 }}>
                    Select both Pitcher Hand and Batter Hand to view QP Locations.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 14 }}>
                  <aside className="portal-day-card portal-ab-sidebar">
                    <div style={{ marginTop: 2 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Pitch Result</div>
                      <div style={{ display: 'grid', gap: 3, fontSize: '0.82rem' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>●</span><span>Called Strike</span></span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>○</span><span>Ball</span></span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>△</span><span>Foul</span></span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>★</span><span>Whiff</span></span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>▲</span><span>In Play (Out)</span></span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>■</span><span>In Play (Hit)</span></span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>□</span><span>Error</span></span>
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Pitch Types</div>
                      <div style={{ display: 'grid', gap: 4 }}>
                        {qpLocationPitchTypes.map((pt) => (
                          <span key={`qpl-legend-${pt}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                            <span style={{ width: 12, height: 12, borderRadius: 999, background: pitchColors[pt] ?? '#9ca3af', border: '1px solid rgba(255,255,255,0.45)' }} />
                            <span>{pt}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </aside>
                  <div style={{ display: 'grid', gap: 12 }}>
                    {(['Behind', 'Even', 'Ahead'] as const).map((state) => (
                      <article key={`qpl-state-${state}`} className="portal-day-card">
                        <h4 style={{ margin: 0, textAlign: 'center' }}>{state} Counts</h4>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, qpLocationPitchTypes.length))}, minmax(0, 1fr))`,
                            gap: 10,
                          }}
                        >
                          {qpLocationPitchTypes.map((pitchType) => {
                            const points = qpLocationPointsByStateAndType[state][pitchType] ?? [];
                            const cells = buildQpPresetCells(pitchType, qpLocationsPitcherHand, state);
                            const w = 240;
                            const h = 260;
                            const xMin = -2.5;
                            const xMax = 2.5;
                            const yMin = 0;
                            const yMax = 4.5;
                            const pad = 10;
                            const plotW = w - pad * 2;
                            const plotH = h - pad * 2;
                            const scale = Math.min(plotW / (xMax - xMin), plotH / (yMax - yMin));
                            const drawnW = (xMax - xMin) * scale;
                            const drawnH = (yMax - yMin) * scale;
                            const leftPad = (w - drawnW) / 2;
                            const topPad = (h - drawnH) / 2;
                            const px = (x: number) => leftPad + (x - xMin) * scale;
                            const py = (y: number) => topPad + (yMax - y) * scale;
                            return (
                              <div key={`qpl-facet-${state}-${pitchType}`} style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: 8, background: 'rgba(0,0,0,0.22)' }}>
                                <div style={{ textAlign: 'center', fontSize: '0.84rem', fontWeight: 700, marginBottom: 4 }}>{pitchType}</div>
                                <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 240 }}>
                                  {cells.map((c, idx) => (
                                    <rect
                                      key={`qpl-cell-${state}-${pitchType}-${idx}`}
                                      x={px(c.x)}
                                      y={py(c.y + c.h)}
                                      width={Math.max(1, c.w * scale + 0.4)}
                                      height={Math.max(1, c.h * scale + 0.4)}
                                      fill={divergingColor(c.value, 0, 100, 200)}
                                      opacity={0.62}
                                    />
                                  ))}
                                  <polygon
                                    points={`${px(-0.75)},${py(0.55)} ${px(0.75)},${py(0.55)} ${px(0.75)},${py(0.65)} ${px(0)},${py(0.75)} ${px(-0.75)},${py(0.65)}`}
                                    fill="none"
                                    stroke="rgba(255,255,255,0.85)"
                                  />
                                  <rect x={px(-0.88)} y={py(3.6)} width={px(0.88) - px(-0.88)} height={py(1.5) - py(3.6)} fill="none" stroke="rgba(255,255,255,0.95)" />
                                  <line x1={px(-0.88 + ((0.88 - -0.88) / 3))} y1={py(1.5)} x2={px(-0.88 + ((0.88 - -0.88) / 3))} y2={py(3.6)} stroke="rgba(255,255,255,0.45)" />
                                  <line x1={px(-0.88 + (((0.88 - -0.88) * 2) / 3))} y1={py(1.5)} x2={px(-0.88 + (((0.88 - -0.88) * 2) / 3))} y2={py(3.6)} stroke="rgba(255,255,255,0.45)" />
                                  <line x1={px(-0.88)} y1={py(1.5 + ((3.6 - 1.5) / 3))} x2={px(0.88)} y2={py(1.5 + ((3.6 - 1.5) / 3))} stroke="rgba(255,255,255,0.45)" />
                                  <line x1={px(-0.88)} y1={py(1.5 + (((3.6 - 1.5) * 2) / 3))} x2={px(0.88)} y2={py(1.5 + (((3.6 - 1.5) * 2) / 3))} stroke="rgba(255,255,255,0.45)" />
                                  {points.map((point, idx) => {
                                    const x = px(orientX(Number(point.plate_side), point.school_code));
                                    const y = py(Number(point.plate_height));
                                    const color = pitchColors[point.pitch_type] ?? '#9ca3af';
                                    const result = resultShape(point.pitch_call, point.play_result, point.school_code);
                                    const hoverText = `${tooltipHtml(point)}\nQP+: ${fmtNum(point.qp_plus, 1)}`;
                                    const hoverProps = {
                                      onMouseMove: (event: { clientX: number; clientY: number }) =>
                                        setQpLocationsHover({ x: event.clientX, y: event.clientY, text: hoverText, bg: color }),
                                      onMouseLeave: () => setQpLocationsHover(null),
                                      onClick: () => openActionModal(points, point),
                                    };
                                    if (result === 'Ball') return <circle key={`qpl-pt-${idx}`} cx={x} cy={y} r={7.4} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={1.9} {...hoverProps} />;
                                    if (result === 'Foul') return <polygon key={`qpl-pt-${idx}`} points={`${x},${y - 6.7} ${x - 6.0},${y + 5.1} ${x + 6.0},${y + 5.1}`} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={1.9} {...hoverProps} />;
                                    if (result === 'Whiff') return <text key={`qpl-pt-${idx}`} x={x} y={y + 5.3} fontSize={17} textAnchor="middle" fill={color} {...hoverProps}>★</text>;
                                    if (result === 'In Play (Out)') return <polygon key={`qpl-pt-${idx}`} points={`${x},${y - 6.7} ${x - 6.0},${y + 5.1} ${x + 6.0},${y + 5.1}`} fill={color} {...hoverProps} />;
                                    if (result === 'In Play (Hit)' || result === 'Single' || result === 'Double' || result === 'Triple' || result === 'HomeRun') return <rect key={`qpl-pt-${idx}`} x={x - 5.7} y={y - 5.7} width={11.4} height={11.4} fill={color} {...hoverProps} />;
                                    if (result === 'Error') return <rect key={`qpl-pt-${idx}`} x={x - 5.7} y={y - 5.7} width={11.4} height={11.4} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={1.8} {...hoverProps} />;
                                    return <circle key={`qpl-pt-${idx}`} cx={x} cy={y} r={7.2} fill={color} {...hoverProps} />;
                                  })}
                                </svg>
                              </div>
                            );
                          })}
                        </div>
                      </article>
                    ))}
                    {qpLocationsHover ? (
                      <div
                        style={{
                          position: 'fixed',
                          left: qpLocationsHover.x + 12,
                          top: qpLocationsHover.y + 12,
                          zIndex: 80,
                          pointerEvents: 'none',
                          whiteSpace: 'pre-line',
                          background: qpLocationsHover.bg ?? 'rgba(0,0,0,0.92)',
                          border: '1px solid rgba(255,255,255,0.22)',
                          borderRadius: 8,
                          padding: '0.35rem 0.45rem',
                          fontSize: '0.74rem',
                          lineHeight: 1.25,
                          color: pitchHoverTextColor(qpLocationsHover.bg),
                        }}
                      >
                        {qpLocationsHover.text}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </>
          ) : dashboardPage === 'Pitcher DNA' ? (
            <PitcherDnaPanel
              filters={filters}
              startDate={startDate}
              endDate={endDate}
              sharedFilterParams={dnaSharedFilterParams}
              selectedSchoolCode={initialSchoolCode}
              isPro={isPro}
              isLeague={isLeague}
              level={level}
              selectedPitchTypes={selectedPitchTypes}
              onNavigateToPitcher={(pitcherName) => {
                setTeamType('All');
                setSelectedPitchers([pitcherName]);
                setSplitBy('Pitch Types');
                setTableMode(shouldUsePcuDefaults ? 'Bullpen' : 'Live');
                setDashboardPage('Summary');
              }}
              onNavigateToTeam={(teamCode) => {
                setTeamType(teamCode);
                setSelectedPitchers(['All']);
                setLeaderboardViewBy('Player');
                setDashboardPage('Leaderboard');
              }}
            />
          ) : (
            <>
              <h3>{overviewHeaderLabel}</h3>
              {loadingOverview ? <p>Loading velocity data...</p> : null}
              {!summaryPoints.length ? (
                <p className="portal-muted-text">No velocity data for current filters.</p>
              ) : (
                <div className="portal-admin-grid" style={{ gridTemplateColumns: '1fr', gap: '0.9rem' }}>
                  <article className="portal-day-card">
                    <h4 style={{ margin: 0, textAlign: 'center' }}>Velocity Chart (Game/Inning)</h4>
                    {(() => {
                      const pts = velocityMainData.points;
                      const yVals = pts.map((p) => Number(p.velo)).filter((v) => Number.isFinite(v));
                      if (!pts.length || !yVals.length) return <p className="portal-muted-text">No velocity points.</p>;
                      const w = 980;
                      const h = 340;
                      const m = { l: 56, r: 20, t: 18, b: 44 };
                      const pw = w - m.l - m.r;
                      const ph = h - m.t - m.b;
                      const yMinRaw = Math.min(...yVals);
                      const yMaxRaw = Math.max(...yVals);
                      const yMin = Math.floor(yMinRaw / 5) * 5;
                      const yMax = Math.max(yMin + 5, Math.ceil(yMaxRaw / 5) * 5);
                      const xMax = Math.max(5, Math.ceil(pts.length / 5) * 5);
                      const px = (x: number) => m.l + (x / xMax) * pw;
                      const py = (y: number) => m.t + ((yMax - y) / (yMax - yMin)) * ph;
                      const yTicks = Array.from({ length: Math.floor((yMax - yMin) / 5) + 1 }, (_, i) => yMin + i * 5);
                      const xTicks = Array.from({ length: Math.floor(xMax / 5) + 1 }, (_, i) => i * 5);
                      return (
                        <div style={{ position: 'relative' }}>
                          <svg
                            viewBox={`0 0 ${w} ${h}`}
                            style={{
                              width: '100%',
                              height: isMobileView ? 'auto' : 360,
                              aspectRatio: `${w} / ${h}`,
                              border: '1px solid rgba(255,255,255,0.14)',
                              borderRadius: 10,
                            }}
                            onMouseLeave={() => setVelocityMainHover(null)}
                          >
                            {yTicks.map((t) => (
                              <g key={`v1-y-${t}`}>
                                <line x1={m.l} y1={py(t)} x2={w - m.r} y2={py(t)} stroke="rgba(255,255,255,0.14)" />
                                <text x={m.l - 8} y={py(t) + 4} textAnchor="end" fill="rgba(255,255,255,0.78)" fontSize={11}>{t}</text>
                              </g>
                            ))}
                            {xTicks.map((t) => (
                              <g key={`v1-x-${t}`}>
                                <line x1={px(t)} y1={m.t} x2={px(t)} y2={h - m.b} stroke="rgba(255,255,255,0.08)" />
                                <text x={px(t)} y={h - 14} textAnchor="middle" fill="rgba(255,255,255,0.78)" fontSize={11}>{t}</text>
                              </g>
                            ))}
                            {velocityMainData.avgByType
                              .filter((r) => typeof r.avg_velo === 'number')
                              .map((r) => (
                                <line key={`v1-avg-${r.pitch_type}`} x1={m.l} y1={py(Number(r.avg_velo))} x2={w - m.r} y2={py(Number(r.avg_velo))} stroke={pitchColors[r.pitch_type] ?? '#9ca3af'} strokeWidth={1.1} opacity={0.8} />
                              ))}
                            {velocityMainData.showInningBoundaries
                              ? velocityMainData.inningBoundaries.map((v) => (
                                  <line
                                    key={`v1-bound-${v}`}
                                    x1={px(v)}
                                    y1={m.t}
                                    x2={px(v)}
                                    y2={h - m.b}
                                    stroke="rgba(255,255,255,0.92)"
                                    strokeDasharray="6,6"
                                    strokeWidth={1.5}
                                  />
                                ))
                              : null}
                            {pts.map((p) => {
                              const x = px(p.pitch_count);
                              const y = py(Number(p.velo));
                              return (
                                <circle
                                  key={`v1-pt-${p.pitch_event_id ?? p.pitch_count}`}
                                  cx={x}
                                  cy={y}
                                  r={4.6}
                                  fill={pitchColors[p.pitch_type] ?? '#9ca3af'}
                                  stroke="rgba(0,0,0,0.5)"
                                  onMouseMove={(event) =>
                                    setVelocityMainHover({
                                      x: event.clientX,
                                      y: event.clientY,
                                      bg: pitchColors[p.pitch_type] ?? '#111827',
                                      text: [
                                        `Session: ${p.session_type || '-'}`,
                                        `${p.pitch_type || 'Pitch'}`,
                                        `Velo: ${fmtNum(p.velo, 1)} mph`,
                                        `IVB: ${fmtNum(p.ivb, 1)}`,
                                        `HB: ${fmtNum(p.hb, 1)}`,
                                      ].join('\n'),
                                    })
                                  }
                                  onClick={() => openActionModal(pts, p)}
                                  style={{ cursor: 'pointer' }}
                                />
                              );
                            })}
                          </svg>
                          {velocityMainHover ? (
                            <div style={{ position: 'fixed', left: velocityMainHover.x + 12, top: velocityMainHover.y + 12, zIndex: 80, pointerEvents: 'none', whiteSpace: 'pre-line', background: velocityMainHover.bg ?? 'rgba(0,0,0,0.92)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 8, padding: '0.35rem 0.45rem', fontSize: '0.74rem', lineHeight: 1.25, color: pitchHoverTextColor(velocityMainHover.bg) }}>
                              {velocityMainHover.text}
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </article>

                  <article className="portal-day-card">
                    <h4 style={{ margin: 0, textAlign: 'center' }}>Average Velocity by Game</h4>
                    {(() => {
                      const rows = velocityByGameData.rows;
                      const dateLevels = velocityByGameData.dateLevels;
                      if (!rows.length || !dateLevels.length) return <p className="portal-muted-text">No by-game velocity data.</p>;
                      const yVals = rows.map((r) => Number(r.velo)).filter((v) => Number.isFinite(v));
                      const w = 980;
                      const h = 420;
                      const m = { l: 56, r: 20, t: 18, b: 100 };
                      const pw = w - m.l - m.r;
                      const ph = h - m.t - m.b;
                      const yMin = Math.floor(Math.min(...yVals) / 5) * 5;
                      const yMax = Math.max(yMin + 5, Math.ceil(Math.max(...yVals) / 5) * 5);
                      const dateX = new Map(dateLevels.map((d, i) => [d, m.l + (i / Math.max(1, dateLevels.length - 1)) * pw]));
                      const py = (y: number) => m.t + ((yMax - y) / (yMax - yMin)) * ph;
                      const yTicks = Array.from({ length: Math.floor((yMax - yMin) / 5) + 1 }, (_, i) => yMin + i * 5);
                      const byType = new Map<string, typeof rows>();
                      for (const r of rows) {
                        const cur = byType.get(r.pitch_type) ?? [];
                        cur.push(r);
                        byType.set(r.pitch_type, cur);
                      }
                      return (
                        <div style={{ position: 'relative' }}>
                          <svg
                            viewBox={`0 0 ${w} ${h}`}
                            style={{
                              width: '100%',
                              height: isMobileView ? 'auto' : 430,
                              aspectRatio: `${w} / ${h}`,
                              border: '1px solid rgba(255,255,255,0.14)',
                              borderRadius: 10,
                            }}
                            onMouseLeave={() => setVelocityGameHover(null)}
                          >
                            {yTicks.map((t) => (
                              <g key={`v2-y-${t}`}>
                                <line x1={m.l} y1={py(t)} x2={w - m.r} y2={py(t)} stroke="rgba(255,255,255,0.14)" />
                                <text x={m.l - 8} y={py(t) + 4} textAnchor="end" fill="rgba(255,255,255,0.78)" fontSize={11}>{t}</text>
                              </g>
                            ))}
                            {dateLevels.map((d) => (
                              <g key={`v2-x-${d}`}>
                                <line x1={Number(dateX.get(d))} y1={m.t} x2={Number(dateX.get(d))} y2={h - m.b} stroke="rgba(255,255,255,0.08)" />
                                <text x={Number(dateX.get(d))} y={h - m.b + 24} textAnchor="middle" dominantBaseline="hanging" fill="rgba(255,255,255,0.78)" fontSize={11}>
                                  {formatShortDate(d)}
                                </text>
                              </g>
                            ))}
                            {Array.from(byType.entries()).map(([pitchType, arr]) => {
                              const sorted = [...arr].sort((a, b) => a.date.localeCompare(b.date));
                              const points = sorted.map((r) => `${Number(dateX.get(r.date))},${py(Number(r.velo))}`).join(' ');
                              return <polyline key={`v2-line-${pitchType}`} points={points} fill="none" stroke={pitchColors[pitchType] ?? '#9ca3af'} strokeWidth={1.5} opacity={0.9} />;
                            })}
                            {rows.map((r, idx) => (
                              <circle
                                key={`v2-pt-${idx}`}
                                cx={Number(dateX.get(r.date))}
                                cy={py(Number(r.velo))}
                                r={4.8}
                                fill={pitchColors[r.pitch_type] ?? '#9ca3af'}
                                stroke="rgba(0,0,0,0.5)"
                                onMouseMove={(event) =>
                                  setVelocityGameHover({
                                    x: event.clientX,
                                    y: event.clientY,
                                    bg: pitchColors[r.pitch_type] ?? '#111827',
                                    text: [
                                      `Session: ${r.session_type || 'Unknown'}`,
                                      `${r.pitch_type}`,
                                      `Velo: ${fmtNum(r.velo, 1)} mph`,
                                      `IVB: ${fmtNum(r.ivb, 1)}`,
                                      `HB: ${fmtNum(r.hb, 1)}`,
                                      `Pitches: ${r.n}`,
                                    ].join('\n'),
                                  })
                                }
                                onClick={() => {
                                  const matched = summaryPoints.filter(
                                    (p) =>
                                      (p.session_date ?? '').slice(0, 10) === r.date &&
                                      (p.pitch_type || 'Undefined') === r.pitch_type &&
                                      (p.session_type || 'Unknown') === r.session_type
                                  );
                                  if (matched.length) openActionModal(matched);
                                }}
                                style={{ cursor: 'pointer' }}
                              />
                            ))}
                          </svg>
                          {velocityGameHover ? (
                            <div style={{ position: 'fixed', left: velocityGameHover.x + 12, top: velocityGameHover.y + 12, zIndex: 80, pointerEvents: 'none', whiteSpace: 'pre-line', background: velocityGameHover.bg ?? 'rgba(0,0,0,0.92)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 8, padding: '0.35rem 0.45rem', fontSize: '0.74rem', lineHeight: 1.25, color: pitchHoverTextColor(velocityGameHover.bg) }}>
                              {velocityGameHover.text}
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </article>

                  <article className="portal-day-card">
                    <h4 style={{ margin: 0, textAlign: 'center' }}>Average Velocity by Inning</h4>
                    {(() => {
                      const rows = velocityByInningData.rows;
                      if (!rows.length) return <p className="portal-muted-text">No Live pitches with Inning values for current filters.</p>;
                      const yVals = rows.map((r) => Number(r.velo)).filter((v) => Number.isFinite(v));
                      const xMax = Math.max(...rows.map((r) => r.inning_ord));
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
                      for (const r of rows) {
                        const cur = byType.get(r.pitch_type) ?? [];
                        cur.push(r);
                        byType.set(r.pitch_type, cur);
                      }
                      return (
                        <div style={{ position: 'relative' }}>
                          <svg
                            viewBox={`0 0 ${w} ${h}`}
                            style={{
                              width: '100%',
                              height: isMobileView ? 'auto' : 360,
                              aspectRatio: `${w} / ${h}`,
                              border: '1px solid rgba(255,255,255,0.14)',
                              borderRadius: 10,
                            }}
                            onMouseLeave={() => setVelocityInningHover(null)}
                          >
                            {yTicks.map((t) => (
                              <g key={`v3-y-${t}`}>
                                <line x1={m.l} y1={py(t)} x2={w - m.r} y2={py(t)} stroke="rgba(255,255,255,0.14)" />
                                <text x={m.l - 8} y={py(t) + 4} textAnchor="end" fill="rgba(255,255,255,0.78)" fontSize={11}>{t}</text>
                              </g>
                            ))}
                            {xTicks.map((t) => (
                              <g key={`v3-x-${t}`}>
                                <line x1={px(t)} y1={m.t} x2={px(t)} y2={h - m.b} stroke="rgba(255,255,255,0.08)" />
                                <text x={px(t)} y={h - 14} textAnchor="middle" fill="rgba(255,255,255,0.78)" fontSize={11}>{t}</text>
                              </g>
                            ))}
                            {Array.from(byType.entries()).map(([pitchType, arr]) => {
                              const sorted = [...arr].sort((a, b) => a.inning_ord - b.inning_ord);
                              const points = sorted.map((r) => `${px(r.inning_ord)},${py(Number(r.velo))}`).join(' ');
                              return <polyline key={`v3-line-${pitchType}`} points={points} fill="none" stroke={pitchColors[pitchType] ?? '#9ca3af'} strokeWidth={1.5} opacity={0.9} />;
                            })}
                            {rows.map((r, idx) => (
                              <circle
                                key={`v3-pt-${idx}`}
                                cx={px(r.inning_ord)}
                                cy={py(Number(r.velo))}
                                r={4.8}
                                fill={pitchColors[r.pitch_type] ?? '#9ca3af'}
                                stroke="rgba(0,0,0,0.5)"
                                onMouseMove={(event) =>
                                  setVelocityInningHover({
                                    x: event.clientX,
                                    y: event.clientY,
                                    bg: pitchColors[r.pitch_type] ?? '#111827',
                                    text: [
                                      'Session: Live',
                                      `Inning #: ${r.inning_ord}`,
                                      `${r.pitch_type}`,
                                      `Velo: ${fmtNum(r.velo, 1)} mph`,
                                      `IVB: ${fmtNum(r.ivb, 1)}`,
                                      `HB: ${fmtNum(r.hb, 1)}`,
                                      `Games: ${r.games} | Pitches: ${r.n}`,
                                    ].join('\n'),
                                  })
                                }
                                onClick={() => {
                                  const matched = velocityByInningData.rowPitchesByKey[`${r.inning_ord}|${r.pitch_type}`] ?? [];
                                  if (matched.length) openActionModal(matched);
                                }}
                                style={{ cursor: 'pointer' }}
                              />
                            ))}
                          </svg>
                          {velocityInningHover ? (
                            <div style={{ position: 'fixed', left: velocityInningHover.x + 12, top: velocityInningHover.y + 12, zIndex: 80, pointerEvents: 'none', whiteSpace: 'pre-line', background: velocityInningHover.bg ?? 'rgba(0,0,0,0.92)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 8, padding: '0.35rem 0.45rem', fontSize: '0.74rem', lineHeight: 1.25, color: pitchHoverTextColor(velocityInningHover.bg) }}>
                              {velocityInningHover.text}
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </article>
                </div>
              )}
            </>
          )}
        </article>
      </div>
      {actionMode && currentActionPitch ? (
        <div className={`portal-modal-backdrop${actionMode === 'video' ? ' portal-edger-video-backdrop' : ''}`} onClick={() => setActionMode(null)}>
          <div
            ref={actionModalCardRef}
            className={`portal-modal-card${actionMode === 'video' ? ' portal-edger-video-modal' : ''}`}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Pitch action modal"
            style={{
              width: isActionModalFullscreen ? '100vw' : (actionMode === 'video' ? 'min(1320px, 94vw)' : 'min(1080px, 92vw)'),
              ...(actionMode === 'video'
                ? { height: isActionModalFullscreen ? '100vh' : '90vh', overflow: 'hidden', gridTemplateRows: 'auto auto minmax(0, 1fr)' }
                : { maxHeight: '88vh', overflow: 'auto' }),
              background: actionModalTheme.panelBg,
              color: actionModalTheme.panelText,
              border: `1px solid ${actionModalTheme.border}`,
              borderRadius: isActionModalFullscreen ? 0 : undefined,
              padding: isActionModalFullscreen ? '0.65rem' : '0.75rem',
              gap: actionMode === 'video' ? '0.45rem' : '0.65rem',
            }}
          >
            {actionMode === 'video' ? (
              <button type="button" className="portal-video-mobile-close" aria-label="Close video viewer" onClick={() => setActionMode(null)}>
                ×
              </button>
            ) : null}
            {actionMode === 'edit' && canUsePitchEdits ? (
              <>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: actionModalTheme.textStrong }}>
                  Edit Pitch Type for {actionPitchCount} pitch(es)
                </h3>
                <div style={{ borderTop: `1px solid ${actionModalTheme.border}`, margin: '0.2rem -1.1rem 0', paddingTop: '1rem', paddingInline: '1.1rem' }}>
                  <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(200px, 1fr))', gap: '1rem 1.4rem' }}>
                    <label style={{ color: actionModalTheme.muted, fontWeight: 700, fontSize: '0.9rem' }}>
                      NEW PITCH TYPE:
                      <SearchableSingleSelect
                        options={pitchEditPitchTypeOptions}
                        value={editPitchType}
                        onChange={setEditPitchType}
                        placeholder="Pitch Type"
                        theme={actionModalSearchTheme}
                      />
                    </label>
                    <label style={{ color: actionModalTheme.muted, fontWeight: 700, fontSize: '0.9rem' }}>
                      ASSIGN TO PITCHER:
                      <SearchableSingleSelect
                        options={pitchEditPitcherOptions}
                        value={editPitcher}
                        onChange={setEditPitcher}
                        placeholder="Pitcher"
                        theme={actionModalSearchTheme}
                      />
                    </label>
                    <label style={{ color: actionModalTheme.muted, fontWeight: 700, fontSize: '0.9rem' }}>
                      BALL TYPE:
                      <SearchableSingleSelect
                        options={pitchEditBallTypeOptions}
                        value={editBallType}
                        onChange={setEditBallType}
                        placeholder="(unchanged)"
                        theme={actionModalSearchTheme}
                      />
                    </label>
                  </div>
                  <div style={{ marginTop: '1rem', borderTop: `1px solid ${actionModalTheme.border}`, paddingTop: '1rem' }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: actionModalTheme.textStrong, marginBottom: 8 }}>Selected Pitches:</div>
                    <div style={{ display: 'grid', gap: 4, maxHeight: 180, overflow: 'auto', fontSize: '0.95rem', color: actionModalTheme.panelText }}>
                      {actionPitches.slice(0, 80).map((pitch, idx) => (
                        <div key={`sel-${pitch.pitch_event_id ?? idx}`}>
                          Pitch {idx + 1}: {pitch.pitch_type} - {formatShortDate(pitch.session_date ?? '')} ({fmtNum(pitch.velo, 1)} mph, HB: {fmtNum(pitch.hb, 1)}, IVB: {fmtNum(pitch.ivb, 1)})
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="portal-choice-line-actions" style={{ justifyContent: 'space-between', marginTop: '0.4rem' }}>
                  <button type="button" className="btn btn-ghost" style={actionModalButtonStyle} onClick={() => setActionMode(null)}>
                    Cancel
                  </button>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" className="btn btn-ghost" style={{ ...actionModalButtonStyle, color: actionModalTheme.softMuted }} disabled>
                      Delete Selected Pitches
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ background: actionModalTheme.controlBg, color: actionModalTheme.muted, border: `1px solid ${actionModalTheme.border}` }}
                      disabled={actionSaveState === 'saving'}
                      onClick={saveCurrentPitchEdit}
                    >
                      {actionSaveState === 'saving' ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
                {actionSaveMessage ? <div style={{ color: actionSaveState === 'error' ? '#b91c1c' : '#166534', fontWeight: 600 }}>{actionSaveMessage}</div> : null}
              </>
            ) : (
              <>
                <div className="portal-edger-video-nav" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: '0.65rem' }}>
                  <div>
                    <button type="button" className="btn btn-ghost" style={actionModalButtonStyle} disabled={actionIndex <= 0} onClick={() => setActionIndex((i) => Math.max(0, i - 1))}>
                      &lt; Prev
                    </button>
                  </div>
                  <div style={{ justifySelf: 'center', fontWeight: 700, color: actionModalTheme.softMuted }}>
                    {actionIndex + 1} of {actionPitchCount}
                  </div>
                  <div style={{ justifySelf: 'end' }}>
                    <button type="button" className="btn btn-ghost" style={actionModalButtonStyle} disabled={actionIndex >= actionPitchCount - 1} onClick={() => setActionIndex((i) => Math.min(actionPitchCount - 1, i + 1))}>
                      Next &gt;
                    </button>
                  </div>
                </div>

                {actionMode === 'video' ? (
                  <div className="portal-edger-video-picker" style={{ display: 'grid', justifyItems: 'center', gap: 6, minHeight: 0, overflow: actionSideBySide || actionExportMenuOpen ? 'visible' : 'hidden', position: 'relative', zIndex: 40 }}>
                    {actionSideBySide ? (
                      <div style={{ width: 'min(1080px, 100%)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, position: 'relative', zIndex: 50, overflow: 'visible' }}>
                        <div style={{ minWidth: 0, position: 'relative', zIndex: 52 }}>
                          <div style={{ fontSize: '0.75rem', color: actionModalTheme.muted, marginBottom: 4 }}>Left Video Pitch</div>
                          <SearchableSingleSelect
                            options={comparePitchOptions}
                            value={actionLeftPitchKey}
                            onChange={setActionLeftPitchKey}
                            placeholder="Select Left Pitch"
                            theme={actionModalSearchTheme}
                            menuStyle={actionModalSelectMenuStyle}
                          />
                        </div>
                        <div style={{ minWidth: 0, position: 'relative', zIndex: 51 }}>
                          <div style={{ fontSize: '0.75rem', color: actionModalTheme.muted, marginBottom: 4 }}>Right Video Pitch</div>
                          <SearchableSingleSelect
                            options={comparePitchOptions.filter((option) => option.value !== actionLeftPitchKey)}
                            value={actionRightPitchKey}
                            onChange={setActionRightPitchKey}
                            placeholder="Select Right Pitch"
                            theme={actionModalSearchTheme}
                            menuStyle={actionModalSelectMenuStyle}
                          />
                        </div>
                      </div>
                    ) : null}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className={actionSideBySide ? 'btn btn-primary' : 'btn btn-ghost'}
                        style={actionSideBySide ? { padding: '0.42rem 0.75rem' } : actionModalButtonStyle}
                        onClick={() =>
                          setActionSideBySide((v) => {
                            if (!v) setActionMultiCameraMode(false);
                            return !v;
                          })
                        }
                      >
                        {actionSideBySide ? 'Single View' : 'Compare'}
                      </button>
                      {!actionSideBySide && activeCameraCount > 1 ? (
                        <button
                          type="button"
                          className={actionMultiCameraMode ? 'btn btn-primary' : 'btn btn-ghost'}
                          style={actionMultiCameraMode ? { padding: '0.42rem 0.75rem' } : actionModalButtonStyle}
                          onClick={() => setActionMultiCameraMode((v) => !v)}
                        >
                          {actionMultiCameraMode ? 'Single Camera' : 'Multi-Camera'}
                        </button>
                      ) : null}
                      {actionSideBySide ? (
                        <>
                          <button
                            type="button"
                            className={actionCompareLayout === 'side-by-side' ? 'btn btn-primary' : 'btn btn-ghost'}
                            style={actionCompareLayout === 'side-by-side' ? { padding: '0.42rem 0.75rem' } : actionModalButtonStyle}
                            onClick={() => setActionCompareLayout('side-by-side')}
                          >
                            Side
                          </button>
                          <button
                            type="button"
                            className={actionCompareLayout === 'stacked' ? 'btn btn-primary' : 'btn btn-ghost'}
                            style={actionCompareLayout === 'stacked' ? { padding: '0.42rem 0.75rem' } : actionModalButtonStyle}
                            onClick={() => setActionCompareLayout('stacked')}
                          >
                            Stack
                          </button>
                          <button
                            type="button"
                            className={actionCompareLayout === 'overlay' ? 'btn btn-primary' : 'btn btn-ghost'}
                            style={actionCompareLayout === 'overlay' ? { padding: '0.42rem 0.75rem' } : actionModalButtonStyle}
                            onClick={() => setActionCompareLayout('overlay')}
                          >
                            Overlay
                          </button>
                        </>
                      ) : null}
                      <button type="button" className="btn btn-ghost" style={actionModalButtonStyle} onClick={() => void toggleActionModalFullscreen()}>
                        {isActionModalFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={actionModalButtonStyle}
                        onClick={() =>
                          downloadUrl(
                            (actionSideBySide ? pickCamera(selectedLeftUrls) : pickCamera(actionVideoUrls)) || '',
                            `pitch-${
                              (actionSideBySide ? selectedLeftPitch?.pitch_event_id : currentActionPitch.pitch_event_id) ??
                              (actionSideBySide ? selectedLeftPitch?.pitch_no : currentActionPitch.pitch_no) ??
                              'clip'
                            }.mp4`
                          )
                        }
                        disabled={actionSideBySide ? !selectedLeftUrls.length : !actionVideoUrls.length}
                      >
                        Download Pitch
                      </button>
                      <div style={{ position: 'relative' }}>
                        <button
                          type="button"
                          className={actionExportMenuOpen ? 'btn btn-primary' : 'btn btn-ghost'}
                          style={actionExportMenuOpen ? { padding: '0.42rem 0.75rem' } : actionModalButtonStyle}
                          onClick={() => setActionExportMenuOpen((v) => !v)}
                          disabled={actionSideBySide}
                          title={actionSideBySide ? 'Exit Compare to export' : undefined}
                        >
                          Export
                        </button>
                        {actionExportMenuOpen ? (
                          <div
                            style={{
                              position: 'absolute',
                              top: 'calc(100% + 6px)',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              zIndex: 60,
                              display: 'grid',
                              gap: 10,
                              width: 290,
                              padding: '0.75rem',
                              borderRadius: 12,
                              background: actionModalTheme.controlBg,
                              border: `1px solid ${actionModalTheme.border}`,
                              boxShadow: isLightTheme ? '0 18px 44px rgba(15,23,42,0.22)' : '0 18px 44px rgba(0,0,0,0.55)',
                            }}
                          >
                            <div style={{ display: 'grid', gap: 6 }}>
                              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: actionModalTheme.muted, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                Layout
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className={actionExportMode === 'sequential' ? 'btn btn-primary' : 'btn btn-ghost'}
                                  style={actionExportMode === 'sequential' ? { flex: 1, padding: '0.4rem 0.5rem' } : { ...actionModalButtonStyle, flex: 1, padding: '0.4rem 0.5rem' }}
                                  onClick={() => setActionExportMode('sequential')}
                                >
                                  Sequential
                                </button>
                                <button
                                  type="button"
                                  className={actionExportMode === 'combined' ? 'btn btn-primary' : 'btn btn-ghost'}
                                  style={actionExportMode === 'combined' ? { flex: 1, padding: '0.4rem 0.5rem' } : { ...actionModalButtonStyle, flex: 1, padding: '0.4rem 0.5rem' }}
                                  onClick={() => setActionExportMode('combined')}
                                >
                                  Combined
                                </button>
                              </div>
                              <div style={{ fontSize: '0.7rem', color: actionModalTheme.muted, lineHeight: 1.3 }}>
                                {actionExportMode === 'combined'
                                  ? 'Selected cameras shown together per pitch, then next pitch. Needs 2+ cameras.'
                                  : 'Each camera’s clips play through in full before the next camera.'}
                              </div>
                            </div>
                            <div style={{ display: 'grid', gap: 6 }}>
                              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: actionModalTheme.muted, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                Metrics Panel
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className={actionExportShowMetrics ? 'btn btn-primary' : 'btn btn-ghost'}
                                  style={actionExportShowMetrics ? { flex: 1, padding: '0.4rem 0.5rem' } : { ...actionModalButtonStyle, flex: 1, padding: '0.4rem 0.5rem' }}
                                  onClick={() => setActionExportShowMetrics(true)}
                                >
                                  On
                                </button>
                                <button
                                  type="button"
                                  className={!actionExportShowMetrics ? 'btn btn-primary' : 'btn btn-ghost'}
                                  style={!actionExportShowMetrics ? { flex: 1, padding: '0.4rem 0.5rem' } : { ...actionModalButtonStyle, flex: 1, padding: '0.4rem 0.5rem' }}
                                  onClick={() => setActionExportShowMetrics(false)}
                                >
                                  Off
                                </button>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gap: 6 }}>
                              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: actionModalTheme.muted, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                Pitches
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className={actionExportScope === 'current' ? 'btn btn-primary' : 'btn btn-ghost'}
                                  style={actionExportScope === 'current' ? { flex: 1, padding: '0.4rem 0.5rem' } : { ...actionModalButtonStyle, flex: 1, padding: '0.4rem 0.5rem' }}
                                  onClick={() => setActionExportScope('current')}
                                >
                                  This Pitch
                                </button>
                                <button
                                  type="button"
                                  className={actionExportScope === 'all' ? 'btn btn-primary' : 'btn btn-ghost'}
                                  style={actionExportScope === 'all' ? { flex: 1, padding: '0.4rem 0.5rem' } : { ...actionModalButtonStyle, flex: 1, padding: '0.4rem 0.5rem' }}
                                  onClick={() => setActionExportScope('all')}
                                  disabled={actionPitchCount <= 1}
                                >
                                  All {actionPitchCount}
                                </button>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gap: 6 }}>
                              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: actionModalTheme.muted, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                Camera
                              </div>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {actionExportAvailableCameras.map((cam) => {
                                  const selected = actionExportCameras.includes(cam);
                                  return (
                                    <button
                                      key={cam}
                                      type="button"
                                      className={selected ? 'btn btn-primary' : 'btn btn-ghost'}
                                      style={selected ? { padding: '0.4rem 0.6rem' } : { ...actionModalButtonStyle, padding: '0.4rem 0.6rem' }}
                                      onClick={() =>
                                        setActionExportCameras((current) =>
                                          current.includes(cam) ? current.filter((c) => c !== cam) : [...current, cam]
                                        )
                                      }
                                    >
                                      {actionExportCameraLabel(cam)}
                                    </button>
                                  );
                                })}
                                {actionExportAvailableCameras.length > 1 ? (
                                  <button
                                    type="button"
                                    className={
                                      actionExportAvailableCameras.every((cam) => actionExportCameras.includes(cam))
                                        ? 'btn btn-primary'
                                        : 'btn btn-ghost'
                                    }
                                    style={
                                      actionExportAvailableCameras.every((cam) => actionExportCameras.includes(cam))
                                        ? { padding: '0.4rem 0.6rem' }
                                        : { ...actionModalButtonStyle, padding: '0.4rem 0.6rem' }
                                    }
                                    onClick={() =>
                                      setActionExportCameras(
                                        actionExportAvailableCameras.every((cam) => actionExportCameras.includes(cam))
                                          ? []
                                          : [...actionExportAvailableCameras]
                                      )
                                    }
                                  >
                                    All
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ padding: '0.5rem 0.75rem', fontWeight: 700 }}
                              onClick={() => void runActionVideoExport()}
                              disabled={
                                actionExportState === 'exporting' ||
                                !actionExportAvailableCameras.length ||
                                !actionExportCameras.length ||
                                (actionExportMode === 'combined' && actionExportCameras.length < 2)
                              }
                            >
                              {actionExportState === 'exporting'
                                ? `Exporting… ${String(Math.floor(actionExportElapsedSeconds / 60)).padStart(2, '0')}:${String(actionExportElapsedSeconds % 60).padStart(2, '0')}`
                                : 'Download Export'}
                            </button>
                            {actionExportState === 'exporting' ? (
                              <div style={{ color: actionModalTheme.muted, fontWeight: 600, fontSize: '0.8rem' }}>
                                Large combined exports (many pitches, multiple cameras) can take several minutes -- this is
                                still working as long as the timer keeps counting up.
                              </div>
                            ) : null}
                            {actionExportState === 'error' && actionExportMessage ? (
                              <div style={{ color: '#b91c1c', fontWeight: 600, fontSize: '0.8rem' }}>{actionExportMessage}</div>
                            ) : null}
                            {!actionExportAvailableCameras.length ? (
                              <div style={{ color: actionModalTheme.muted, fontWeight: 600, fontSize: '0.8rem' }}>
                                No video found for this selection.
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div
                  ref={actionViewRef}
                  className="portal-edger-video-view"
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      actionMode === 'video' && actionSideBySide ? 'minmax(0, 1fr)' : 'minmax(0,1fr) 250px',
                    gap: '0.75rem',
                    alignItems: 'stretch',
                    minHeight: 0,
                  }}
                >
                  <div style={{ display: 'grid', gap: '0.5rem', minHeight: 0, gridTemplateRows: actionMode === 'video' ? 'minmax(0, 1fr) auto' : undefined }}>
                    {actionMode === 'video' ? (
                      <div
                        ref={breakdownCaptureRef}
                        className="portal-edger-video-stage"
                        style={{
                          position: 'relative',
                          background: '#000',
                          borderRadius: 10,
                          border: '1px solid #111827',
                          minHeight: 0,
                          height: '100%',
                          display: 'grid',
                          placeItems: 'center',
                          overflow: 'hidden',
                        }}
                      >
                        {!actionSideBySide && activeCameraCount >= 1 ? (
                          <div
                            style={{
                              position: 'absolute',
                              top: 10,
                              right: 10,
                              zIndex: 20,
                              display: 'flex',
                              gap: 6,
                              background: 'rgba(2,6,23,0.72)',
                              borderRadius: 10,
                              padding: 4,
                              backdropFilter: 'blur(8px)',
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            {Array.from({ length: activeCameraCount }, (_, camIdx) =>
                              activeCameraCount > 1 ? (
                                <button
                                  key={camIdx}
                                  type="button"
                                  className={
                                    (actionMultiCameraMode ? actionMultiCameraIndices.includes(camIdx) : camIdx === actionCameraIndex)
                                      ? 'btn btn-primary'
                                      : 'btn btn-ghost'
                                  }
                                  style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}
                                  onClick={() => {
                                    if (!actionMultiCameraMode) {
                                      setActionCameraIndex(camIdx);
                                      return;
                                    }
                                    setActionMultiCameraIndices((current) => {
                                      if (current.includes(camIdx)) {
                                        // Never let the last selected camera be
                                        // deselected -- there must always be
                                        // something to show.
                                        if (current.length === 1) return current;
                                        return current.filter((i) => i !== camIdx);
                                      }
                                      return [...current, camIdx].sort((a, b) => a - b);
                                    });
                                  }}
                                >
                                  {cameraTabLabel(camIdx)}
                                </button>
                              ) : (
                                // Single camera: show the label as a plain badge, not a
                                // clickable tab -- there's nothing else to switch to, but
                                // this is the only place the actual detected camera type
                                // is visible, and that visibility is the whole point.
                                <div
                                  key={camIdx}
                                  style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600 }}
                                >
                                  {cameraTabLabel(camIdx)}
                                </div>
                              )
                            )}
                          </div>
                        ) : null}
                        {actionMode === 'video' && hasActionVideo && !isMultiCameraActive ? (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 10,
                              left: actionSideBySide ? 'auto' : 10,
                              right: actionSideBySide ? 10 : 'auto',
                              zIndex: 20,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              background: 'rgba(2,6,23,0.72)',
                              borderRadius: 10,
                              padding: 4,
                              backdropFilter: 'blur(8px)',
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
                              onClick={() => setActionVideoZoom((z) => Math.max(actionSideBySide ? 0.25 : 1, Math.round((z - 0.25) * 100) / 100))}
                              disabled={actionVideoZoom <= (actionSideBySide ? 0.25 : 1)}
                            >
                              −
                            </button>
                            <span style={{ color: '#f8fafc', fontSize: '0.78rem', fontWeight: 700, minWidth: 38, textAlign: 'center' }}>
                              {Math.round(actionVideoZoom * 100)}%
                            </span>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
                              onClick={() => setActionVideoZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
                            >
                              +
                            </button>
                            {actionVideoZoom !== 1 || actionVideoPan.x !== 0 || actionVideoPan.y !== 0 ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }}
                                onClick={() => {
                                  setActionVideoZoom(1);
                                  setActionVideoPan({ x: 0, y: 0 });
                                }}
                              >
                                Reset
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {actionVideoLookupLoading ? (
                          <div style={{ color: '#f8fafc', fontSize: '2.35rem', fontWeight: 900, textAlign: 'center', letterSpacing: '0.01em' }}>
                            Loading video...
                          </div>
                        ) : hasActionVideo ? (
                          actionSideBySide ? (
                            selectedLeftUrls.length >= 1 ? (
                              <div
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  display: 'grid',
                                  gridTemplateColumns: actionCompareLayout === 'side-by-side' ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
                                  gridTemplateRows: actionCompareLayout === 'stacked' ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
                                  gap: actionCompareLayout === 'overlay' ? 0 : 12,
                                  padding: 12,
                                  alignItems: 'stretch',
                                  position: 'relative',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 8,
                                    width: '100%',
                                    height: '100%',
                                    minWidth: 0,
                                    minHeight: 0,
                                    overflow: 'hidden',
                                    position: 'relative',
                                    gridColumn: '1 / 2',
                                    gridRow: '1 / 2',
                                  }}
                                >
                                  {actionCompareLayout !== 'overlay' ? (
                                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', flex: '0 0 auto' }}>
                                      {renderCompactVideoMetrics(selectedLeftPitch, 'left')}
                                      {leftCameraCount >= 1 ? (
                                        <div
                                          style={{
                                            display: 'flex',
                                            gap: 6,
                                            flexShrink: 0,
                                            background: 'rgba(2,6,23,0.72)',
                                            borderRadius: 10,
                                            padding: 4,
                                            backdropFilter: 'blur(8px)',
                                          }}
                                          onPointerDown={(event) => event.stopPropagation()}
                                        >
                                          {Array.from({ length: leftCameraCount }, (_, camIdx) =>
                                            leftCameraCount > 1 ? (
                                              <button
                                                key={camIdx}
                                                type="button"
                                                className={camIdx === actionCameraIndexLeft ? 'btn btn-primary' : 'btn btn-ghost'}
                                                style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                                                onClick={() => setActionCameraIndexLeft(camIdx)}
                                              >
                                                {cameraTabLabel(camIdx, selectedLeftPitch)}
                                              </button>
                                            ) : (
                                              <div
                                                key={camIdx}
                                                style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 600 }}
                                              >
                                                {cameraTabLabel(camIdx, selectedLeftPitch)}
                                              </div>
                                            )
                                          )}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : leftCameraCount >= 1 ? (
                                    <div
                                      style={{
                                        position: 'absolute',
                                        top: 10,
                                        left: 10,
                                        zIndex: 20,
                                        display: 'flex',
                                        gap: 6,
                                        background: 'rgba(2,6,23,0.72)',
                                        borderRadius: 10,
                                        padding: 4,
                                        backdropFilter: 'blur(8px)',
                                      }}
                                      onPointerDown={(event) => event.stopPropagation()}
                                    >
                                      {Array.from({ length: leftCameraCount }, (_, camIdx) =>
                                        leftCameraCount > 1 ? (
                                          <button
                                            key={camIdx}
                                            type="button"
                                            className={camIdx === actionCameraIndexLeft ? 'btn btn-primary' : 'btn btn-ghost'}
                                            style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                                            onClick={() => setActionCameraIndexLeft(camIdx)}
                                          >
                                            {cameraTabLabel(camIdx, selectedLeftPitch)}
                                          </button>
                                        ) : (
                                          <div
                                            key={camIdx}
                                            style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 600 }}
                                          >
                                            {cameraTabLabel(camIdx, selectedLeftPitch)}
                                          </div>
                                        )
                                      )}
                                    </div>
                                  ) : null}
                                  <div
                                    style={{
                                      flex: '1 1 0',
                                      width: '100%',
                                      minWidth: 0,
                                      minHeight: 0,
                                      overflow: 'hidden',
                                      touchAction: 'none',
                                      cursor: breakdownMode ? undefined : actionVideoZoom > 1 ? 'grab' : 'default',
                                    }}
                                    onPointerDown={handleActionVideoPanStart}
                                    onPointerMove={handleActionVideoPanMove}
                                    onPointerUp={handleActionVideoPanEnd}
                                    onPointerCancel={handleActionVideoPanEnd}
                                  >
                                    <video
                                      key={`left-${actionLeftPitchKey}-${pickCamera(selectedLeftUrls, actionCameraIndexLeft) || 'none'}-${actionVideoRefreshNonce}`}
                                      ref={leftCompareVideoRef}
                                      crossOrigin="anonymous"
                                      loop={actionVideoLoop}
                                      style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'contain',
                                        background: '#000',
                                        transform: `translate(${actionVideoPan.x}px, ${actionVideoPan.y}px) scale(${actionVideoZoom})`,
                                        transformOrigin: 'center center',
                                        transition: actionVideoPanDragRef.current ? 'none' : 'transform 0.1s ease-out',
                                        pointerEvents: 'none',
                                      }}
                                      onLoadedMetadata={updateSyncedDuration}
                                      onPause={() => setActionVideoPlaying(false)}
                                      onPlay={() => setActionVideoPlaying(true)}
                                      onError={() => {
                                        void handleActionVideoLoadError(selectedLeftPitch ?? null);
                                      }}
                                    >
                                      <source src={pickCamera(selectedLeftUrls, actionCameraIndexLeft)} />
                                    </video>
                                  </div>
                                </div>
                                {selectedRightPitch ? (
                                  selectedRightUrls.length ? (
                                    <div
                                      style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 8,
                                        width: '100%',
                                        height: '100%',
                                        minWidth: 0,
                                        minHeight: 0,
                                        overflow: 'hidden',
                                        position: 'relative',
                                        gridColumn: actionCompareLayout === 'side-by-side' ? '2 / 3' : '1 / 2',
                                        gridRow: actionCompareLayout === 'stacked' ? '2 / 3' : '1 / 2',
                                        opacity: actionCompareLayout === 'overlay' ? 0.58 : 1,
                                        mixBlendMode: actionCompareLayout === 'overlay' ? 'screen' : undefined,
                                        pointerEvents: actionCompareLayout === 'overlay' ? 'none' : undefined,
                                      }}
                                    >
                                      {actionCompareLayout !== 'overlay' ? (
                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', flex: '0 0 auto' }}>
                                          {renderCompactVideoMetrics(selectedRightPitch, 'right')}
                                          {rightCameraCount >= 1 ? (
                                            <div
                                              style={{
                                                display: 'flex',
                                                gap: 6,
                                                flexShrink: 0,
                                                background: 'rgba(2,6,23,0.72)',
                                                borderRadius: 10,
                                                padding: 4,
                                                backdropFilter: 'blur(8px)',
                                              }}
                                              onPointerDown={(event) => event.stopPropagation()}
                                            >
                                              {Array.from({ length: rightCameraCount }, (_, camIdx) =>
                                                rightCameraCount > 1 ? (
                                                  <button
                                                    key={camIdx}
                                                    type="button"
                                                    className={camIdx === actionCameraIndexRight ? 'btn btn-primary' : 'btn btn-ghost'}
                                                    style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                                                    onClick={() => setActionCameraIndexRight(camIdx)}
                                                  >
                                                    {cameraTabLabel(camIdx, selectedRightPitch)}
                                                  </button>
                                                ) : (
                                                  <div
                                                    key={camIdx}
                                                    style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 600 }}
                                                  >
                                                    {cameraTabLabel(camIdx, selectedRightPitch)}
                                                  </div>
                                                )
                                              )}
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : rightCameraCount >= 1 ? (
                                        <div
                                          style={{
                                            position: 'absolute',
                                            top: 10,
                                            right: 10,
                                            zIndex: 20,
                                            display: 'flex',
                                            gap: 6,
                                            background: 'rgba(2,6,23,0.72)',
                                            borderRadius: 10,
                                            padding: 4,
                                            backdropFilter: 'blur(8px)',
                                          }}
                                          onPointerDown={(event) => event.stopPropagation()}
                                        >
                                          {Array.from({ length: rightCameraCount }, (_, camIdx) =>
                                            rightCameraCount > 1 ? (
                                              <button
                                                key={camIdx}
                                                type="button"
                                                className={camIdx === actionCameraIndexRight ? 'btn btn-primary' : 'btn btn-ghost'}
                                                style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                                                onClick={() => setActionCameraIndexRight(camIdx)}
                                              >
                                                {cameraTabLabel(camIdx, selectedRightPitch)}
                                              </button>
                                            ) : (
                                              <div
                                                key={camIdx}
                                                style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 600 }}
                                              >
                                                {cameraTabLabel(camIdx, selectedRightPitch)}
                                              </div>
                                            )
                                          )}
                                        </div>
                                      ) : null}
                                      <div
                                        style={{
                                          flex: '1 1 0',
                                          width: '100%',
                                          minWidth: 0,
                                          minHeight: 0,
                                          overflow: 'hidden',
                                          touchAction: 'none',
                                          cursor: breakdownMode ? undefined : actionVideoZoom > 1 ? 'grab' : 'default',
                                          pointerEvents: actionCompareLayout === 'overlay' ? 'none' : undefined,
                                        }}
                                        onPointerDown={handleActionVideoPanStart}
                                        onPointerMove={handleActionVideoPanMove}
                                        onPointerUp={handleActionVideoPanEnd}
                                        onPointerCancel={handleActionVideoPanEnd}
                                      >
                                        <video
                                          key={`right-${actionRightPitchKey}-${pickCamera(selectedRightUrls, actionCameraIndexRight) || 'none'}-${actionVideoRefreshNonce}`}
                                          ref={rightCompareVideoRef}
                                          crossOrigin="anonymous"
                                          loop={actionVideoLoop}
                                          style={{
                                            width: '100%',
                                            height: '100%',
                                            objectFit: 'contain',
                                            background: '#000',
                                            transform: `translate(${actionVideoPan.x}px, ${actionVideoPan.y}px) scale(${actionVideoZoom})`,
                                            transformOrigin: 'center center',
                                            transition: actionVideoPanDragRef.current ? 'none' : 'transform 0.1s ease-out',
                                            pointerEvents: 'none',
                                          }}
                                          onLoadedMetadata={updateSyncedDuration}
                                          onPause={() => setActionVideoPlaying(false)}
                                          onPlay={() => setActionVideoPlaying(true)}
                                          onError={() => {
                                            void handleActionVideoLoadError(selectedRightPitch ?? null);
                                          }}
                                        >
                                          <source src={pickCamera(selectedRightUrls, actionCameraIndexRight)} />
                                        </video>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <div style={{ color: '#f8fafc', display: 'grid', placeItems: 'center', textAlign: 'center', fontWeight: 700 }}>
                                        Selected compare pitch has no video.
                                      </div>
                                    </>
                                  )
                                ) : (
                                  <>
                                    <div style={{ color: '#f8fafc', display: 'grid', placeItems: 'center', textAlign: 'center', fontWeight: 700 }}>
                                      Select a second pitch to compare.
                                    </div>
                                  </>
                                )}
                                {actionCompareLayout === 'overlay' ? (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      left: 18,
                                      top: 18,
                                      right: 18,
                                      zIndex: 4,
                                      display: 'grid',
                                      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                                      gap: 8,
                                      pointerEvents: 'none',
                                    }}
                                  >
                                    {renderCompactVideoMetrics(selectedLeftPitch, 'left')}
                                    {renderCompactVideoMetrics(selectedRightPitch, 'right')}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div style={{ color: '#f8fafc', fontSize: '1.05rem', fontWeight: 700, textAlign: 'center' }}>
                                Selected left pitch has no video.
                              </div>
                            )
                          ) : actionMultiCameraMode && actionMultiCameraUrls.length > 1 ? (
                            // Multi-Camera view: mirrors the export feature's tile
                            // layout (1 fills the frame, 2 side by side weighted by
                            // aspect ratio, 3 = first tile on top spanning full
                            // width with the other two split below it) so switching
                            // between viewing here and the exported file looks the
                            // same. leftWFrac is read from each <video>'s own
                            // loadedmetadata event (videoWidth/videoHeight) rather
                            // than a HEAD request like the export uses server-side
                            // -- same math (computeTwoTileWidthFrac in the export
                            // route), just sourced client-side since the browser
                            // already has to load the video anyway.
                            (() => {
                              const twoTileLeftDims = actionMultiCameraUrls.length === 2 ? actionMultiCameraDims[0] : null;
                              const twoTileRightDims = actionMultiCameraUrls.length === 2 ? actionMultiCameraDims[1] : null;
                              let leftWFrac = 0.5;
                              if (twoTileLeftDims && twoTileRightDims && twoTileLeftDims.height > 0 && twoTileRightDims.height > 0) {
                                const leftRatio = twoTileLeftDims.width / twoTileLeftDims.height;
                                const rightRatio = twoTileRightDims.width / twoTileRightDims.height;
                                const total = leftRatio + rightRatio;
                                if (Number.isFinite(total) && total > 0) {
                                  leftWFrac = Math.min(0.85, Math.max(0.15, leftRatio / total));
                                }
                              }
                              const columns =
                                actionMultiCameraUrls.length === 3
                                  ? '1fr 1fr'
                                  : actionMultiCameraUrls.length === 2
                                    ? `${leftWFrac}fr ${1 - leftWFrac}fr`
                                    : `repeat(${actionMultiCameraUrls.length}, 1fr)`;
                              return (
                            <div
                              style={{
                                width: '100%',
                                height: '100%',
                                minHeight: 0,
                                display: 'grid',
                                gridTemplateColumns: columns,
                                gridTemplateRows: actionMultiCameraUrls.length === 3 ? '1fr 1fr' : '1fr',
                                gap: 4,
                                padding: 4,
                              }}
                            >
                              {actionMultiCameraUrls.map((url, tileIdx) => {
                                // Explicit placement for every tile (not just the
                                // spanning one) -- letting the 2nd/3rd tiles fall
                                // through to grid auto-flow while only tile 0 gets
                                // an explicit span produced a real bug: the browser
                                // placed tile 1 into row 1 / column 2 (auto-flow's
                                // next open cell) UNDER/instead of where tile 0's
                                // span should have reached, leaving row 1's right
                                // half blank and tile 1 missing from row 2 (confirmed
                                // via a real screenshot -- solid black gap top-right,
                                // only 2 of 3 tiles visible).
                                const gridArea =
                                  actionMultiCameraUrls.length === 3
                                    ? tileIdx === 0
                                      ? { gridColumn: '1 / 3', gridRow: '1 / 2' }
                                      : { gridColumn: tileIdx === 1 ? '1 / 2' : '2 / 3', gridRow: '2 / 3' }
                                    : { gridColumn: `${tileIdx + 1} / ${tileIdx + 2}`, gridRow: '1 / 2' };
                                return (
                                <div
                                  key={`multi-${currentPitchKey}-${url}-${actionVideoRefreshNonce}`}
                                  style={{
                                    position: 'relative',
                                    minWidth: 0,
                                    minHeight: 0,
                                    background: '#000',
                                    borderRadius: 6,
                                    overflow: 'hidden',
                                    ...gridArea,
                                  }}
                                >
                                  <video
                                    ref={(el) => {
                                      multiCameraVideoRefs.current[tileIdx] = el;
                                    }}
                                    crossOrigin="anonymous"
                                    autoPlay
                                    loop={actionVideoLoop}
                                    style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
                                    onLoadedMetadata={(event) => {
                                      if (tileIdx === 0) updateSyncedDuration();
                                      const video = event.currentTarget;
                                      if (video.videoWidth > 0 && video.videoHeight > 0) {
                                        setActionMultiCameraDims((current) => {
                                          const next = [...current];
                                          next[tileIdx] = { width: video.videoWidth, height: video.videoHeight };
                                          return next;
                                        });
                                      }
                                    }}
                                    onPause={tileIdx === 0 ? () => setActionVideoPlaying(false) : undefined}
                                    onPlay={tileIdx === 0 ? () => setActionVideoPlaying(true) : undefined}
                                    onError={() => {
                                      void handleActionVideoLoadError(currentActionPitch ?? null);
                                    }}
                                  >
                                    <source src={url} />
                                  </video>
                                </div>
                                );
                              })}
                            </div>
                              );
                            })()
                          ) : (
                            <div
                              style={{
                                width: '100%',
                                height: '100%',
                                overflow: 'hidden',
                                touchAction: 'none',
                                cursor: breakdownMode ? undefined : actionVideoZoom > 1 ? 'grab' : 'default',
                              }}
                              onPointerDown={handleActionVideoPanStart}
                              onPointerMove={handleActionVideoPanMove}
                              onPointerUp={handleActionVideoPanEnd}
                              onPointerCancel={handleActionVideoPanEnd}
                            >
                              <video
                                key={`single-${currentPitchKey}-${pickCamera(actionVideoUrls) || 'none'}-${actionVideoRefreshNonce}`}
                                ref={singleActionVideoRef}
                                crossOrigin="anonymous"
                                autoPlay
                                loop={actionVideoLoop}
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'contain',
                                  transform: `translate(${actionVideoPan.x}px, ${actionVideoPan.y}px) scale(${actionVideoZoom})`,
                                  transformOrigin: 'center center',
                                  transition: actionVideoPanDragRef.current ? 'none' : 'transform 0.1s ease-out',
                                  pointerEvents: 'none',
                                }}
                                onLoadedMetadata={updateSyncedDuration}
                                onPause={() => setActionVideoPlaying(false)}
                                onPlay={() => setActionVideoPlaying(true)}
                                onError={() => {
                                  void handleActionVideoLoadError(currentActionPitch ?? null);
                                }}
                              >
                                <source src={pickCamera(actionVideoUrls)} />
                              </video>
                            </div>
                          )
                        ) : (
                          <div style={{ color: '#f8fafc', fontSize: '2rem', fontWeight: 700 }}>No video available</div>
                        )}
                        {actionMode === 'video' && hasActionVideo && !actionVideoLookupLoading ? (
                          <div
                            className="portal-edger-breakdown-ui"
                            data-breakdown-ui="true"
                            style={{
                              position: 'absolute',
                              top: actionSideBySide ? 'auto' : 10,
                              bottom: actionSideBySide ? 10 : 'auto',
                              left: 10,
                              zIndex: 12,
                              display: 'grid',
                              gap: 8,
                              maxWidth: 'min(760px, calc(100% - 20px))',
                              pointerEvents: 'auto',
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {breakdownToolbarVisible ? (
                              <div
                                className="portal-edger-breakdown-toolbar"
                                style={{
                                  display: 'grid',
                                  gap: 8,
                                  padding: '0.45rem',
                                  border: '1px solid rgba(148,163,184,0.32)',
                                  borderRadius: 14,
                                  background: 'rgba(2,6,23,0.88)',
                                  boxShadow: '0 18px 34px rgba(0,0,0,0.3)',
                                  backdropFilter: 'blur(12px)',
                                }}
                              >
                                <div className="portal-edger-breakdown-tool-row" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    aria-label="Hide breakdown toolbar"
                                    title="Hide toolbar"
                                    style={{ ...actionModalButtonStyle, width: 36, minWidth: 36, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: 20 }}
                                    onClick={() => setBreakdownToolbarVisible(false)}
                                  >
                                    ×
                                  </button>
                                  <button
                                    type="button"
                                    className={!breakdownMode ? 'btn btn-primary' : 'btn btn-ghost'}
                                    aria-label="View and pan"
                                    title="View and pan"
                                    style={!breakdownMode ? { width: 36, minWidth: 36, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: 17 } : { ...actionModalButtonStyle, width: 36, minWidth: 36, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: 17 }}
                                    onClick={() => { setBreakdownMode(false); setBreakdownAnglePending([]); }}
                                  >
                                    {BREAKDOWN_TOOL_ICONS.view}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost portal-media-breakdown-color-tool"
                                    aria-label="Change drawing color"
                                    title="Color"
                                    style={{ ...actionModalButtonStyle, width: 36, minWidth: 36, height: 36, padding: 0, minHeight: 36, borderRadius: 10 }}
                                    onClick={() => {
                                      const currentIndex = BREAKDOWN_COLOR_SWATCHES.findIndex((swatch) => swatch.toLowerCase() === breakdownColor.toLowerCase());
                                      setBreakdownColor(BREAKDOWN_COLOR_SWATCHES[(currentIndex + 1) % BREAKDOWN_COLOR_SWATCHES.length]);
                                    }}
                                  >
                                    <span className="portal-media-breakdown-color-tool-dot" style={{ background: breakdownColor }} />
                                  </button>
                                  {breakdownMode && breakdownTool === 'angle' ? (
                                    <button
                                      type="button"
                                      className={breakdownAngleMode === 'obtuse' ? 'btn btn-primary portal-media-breakdown-mode-tool' : 'btn btn-ghost portal-media-breakdown-mode-tool'}
                                      aria-label="Toggle angle mode"
                                      title={breakdownAngleMode === 'acute' ? 'Angle: acute' : 'Angle: obtuse'}
                                      style={breakdownAngleMode === 'obtuse' ? { width: 36, minWidth: 36, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: 17 } : { ...actionModalButtonStyle, width: 36, minWidth: 36, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: 17 }}
                                      onClick={() => setBreakdownAngleMode((current) => (current === 'acute' ? 'obtuse' : 'acute'))}
                                    >
                                      <span>{breakdownAngleMode === 'acute' ? 'Ac' : 'Ob'}</span>
                                    </button>
                                  ) : null}
                                  {breakdownMode && breakdownTool === 'text' ? (
                                    <button
                                      type="button"
                                      className="btn btn-ghost portal-media-breakdown-mode-tool"
                                      aria-label="Change text size"
                                      title={`Font ${breakdownTextFontSize}`}
                                      style={{ ...actionModalButtonStyle, width: 36, minWidth: 36, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: 17 }}
                                      onClick={() => {
                                        const next = BREAKDOWN_TEXT_SIZE_STEPS.find((step) => step > breakdownTextFontSize) ?? BREAKDOWN_TEXT_SIZE_STEPS[0];
                                        setBreakdownTextFontSize(next);
                                        if (selectedBreakdownTextId) {
                                          setBreakdownAnnotations((items) =>
                                            items.map((item) => (item.id === selectedBreakdownTextId ? { ...item, fontSize: next } : item))
                                          );
                                        }
                                      }}
                                    >
                                      <span>{breakdownTextFontSize}</span>
                                    </button>
                                  ) : null}
                                  {BREAKDOWN_TOOL_ORDER.map((tool) => (
                                    <button
                                      key={tool}
                                      type="button"
                                      className={breakdownMode && breakdownTool === tool ? 'btn btn-primary' : 'btn btn-ghost'}
                                      aria-label={BREAKDOWN_TOOL_LABELS[tool]}
                                      title={tool === 'angle' && breakdownAnglePending.length > 0 ? `${BREAKDOWN_TOOL_LABELS[tool]} (${breakdownAnglePending.length}/3)` : BREAKDOWN_TOOL_LABELS[tool]}
                                      style={breakdownMode && breakdownTool === tool ? { width: 36, minWidth: 36, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: 17 } : { ...actionModalButtonStyle, width: 36, minWidth: 36, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: 17 }}
                                      onClick={() => {
                                        setBreakdownMode(true);
                                        setBreakdownTool(tool);
                                        setBreakdownAnglePending([]);
                                      }}
                                    >
                                      {BREAKDOWN_TOOL_ICONS[tool]}
                                    </button>
                                  ))}
                                  <button type="button" className="btn btn-ghost" style={{ ...actionModalButtonStyle, width: 44, minWidth: 44, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: '0.68rem', fontWeight: 900 }} onClick={() => setBreakdownAnnotations((items) => items.slice(0, -1))} disabled={!breakdownAnnotations.length} title="Undo">
                                    Undo
                                  </button>
                                  <button type="button" className="btn btn-ghost" style={{ ...actionModalButtonStyle, width: 44, minWidth: 44, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: '0.68rem', fontWeight: 900 }} onClick={() => setBreakdownAnnotations([])} disabled={!breakdownAnnotations.length} title="Clear">
                                    Clear
                                  </button>
                                  {recordingState === 'recording' ? (
                                    <button
                                      type="button"
                                      className="btn btn-primary portal-media-breakdown-record-tool is-recording"
                                      style={{ width: 44, minWidth: 44, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: '0.66rem', fontWeight: 900 }}
                                      onClick={stopBreakdownRecording}
                                      title="Stop recording"
                                    >
                                      Stop
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn btn-ghost portal-media-breakdown-record-tool"
                                      style={{ ...actionModalButtonStyle, width: 44, minWidth: 44, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: '0.66rem', fontWeight: 900 }}
                                      onClick={() => void startBreakdownRecording()}
                                      title="Record breakdown"
                                    >
                                      Rec
                                    </button>
                                  )}
                                  {recordingUrl ? (
                                    <a
                                      className="btn btn-ghost portal-media-breakdown-record-download"
                                      href={recordingUrl}
                                      download={recordingDownloadName}
                                      style={{ ...actionModalButtonStyle, width: 44, minWidth: 44, height: 36, padding: 0, minHeight: 36, borderRadius: 10, fontSize: '0.66rem', fontWeight: 900, display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}
                                      title="Download recording"
                                    >
                                      DL
                                    </a>
                                  ) : null}
                                  <button type="button" className={showBreakdownNotePanel ? 'btn btn-primary' : 'btn btn-ghost'} style={showBreakdownNotePanel ? { padding: '0 0.7rem', minHeight: 36, borderRadius: 10, fontSize: '0.72rem', fontWeight: 900 } : { ...actionModalButtonStyle, padding: '0 0.7rem', minHeight: 36, borderRadius: 10, fontSize: '0.72rem', fontWeight: 900 }} onClick={() => setShowBreakdownNotePanel((value) => !value)}>
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                data-breakdown-ui="true"
                                aria-label="Show breakdown toolbar"
                                title="Show toolbar"
                                style={{
                                  ...actionModalButtonStyle,
                                  width: 62,
                                  minWidth: 62,
                                  minHeight: 38,
                                  padding: 0,
                                  borderRadius: 12,
                                  background: 'rgba(2,6,23,0.82)',
                                  boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
                                }}
                                onClick={() => setBreakdownToolbarVisible(true)}
                              >
                                Tools
                              </button>
                            )}
                            {breakdownToolbarVisible && showBreakdownNotePanel ? (
                              <div
                                className="portal-edger-breakdown-save-panel"
                                style={{
                                  width: 'min(520px, calc(100vw - 80px))',
                                  display: 'grid',
                                  gap: 8,
                                  border: '1px solid rgba(148,163,184,0.32)',
                                  borderRadius: 12,
                                  padding: 10,
                                  background: 'rgba(2,6,23,0.92)',
                                  boxShadow: '0 14px 30px rgba(0,0,0,0.36)',
                                }}
                              >
                                <textarea
                                  value={breakdownNoteText}
                                  onChange={(event) => setBreakdownNoteText(event.target.value)}
                                  placeholder="Optional note for Player Notes..."
                                  style={{ minHeight: 74, resize: 'vertical', border: '1px solid rgba(148,163,184,0.38)', borderRadius: 8, padding: '0.55rem', color: '#f8fafc', background: 'rgba(15,23,42,0.94)', fontWeight: 600 }}
                                />
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <button type="button" className="btn btn-ghost" style={{ ...actionModalButtonStyle, padding: '0.42rem 0.7rem' }} onClick={downloadBreakdownSnapshot}>
                                    Download Snapshot
                                  </button>
                                  <button type="button" className="btn btn-primary" style={{ padding: '0.42rem 0.7rem' }} onClick={() => void saveBreakdownSnapshot()} disabled={breakdownSaving}>
                                    Save Snapshot
                                  </button>
                                  {recordingState === 'recording' ? (
                                    <button type="button" className="btn btn-primary" style={{ padding: '0.42rem 0.7rem' }} onClick={stopBreakdownRecording}>
                                      Stop Recording
                                    </button>
                                  ) : (
                                    <button type="button" className="btn btn-ghost" style={{ ...actionModalButtonStyle, padding: '0.42rem 0.7rem' }} onClick={() => void startBreakdownRecording()}>
                                      Record
                                    </button>
                                  )}
                                  {recordingUrl ? (
                                    <>
                                      <button type="button" className="btn btn-primary" style={{ padding: '0.42rem 0.7rem' }} onClick={() => void saveBreakdownRecording()} disabled={breakdownSaving}>
                                        Save Recording
                                      </button>
                                      <a className="btn btn-ghost" href={recordingUrl} download={recordingDownloadName} style={{ ...actionModalButtonStyle, padding: '0.42rem 0.7rem' }}>
                                        Download Recording
                                      </a>
                                    </>
                                  ) : null}
                                </div>
                                {breakdownMessage ? <div style={{ color: breakdownMessage.includes('Saved') ? '#86efac' : '#fde68a', fontWeight: 800, fontSize: '0.82rem' }}>{breakdownMessage}</div> : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {actionMode === 'video' && hasActionVideo ? renderBreakdownOverlay() : null}
                      </div>
                    ) : null}

                    {actionMode === 'video' && hasActionVideo ? (
                      <div className="portal-edger-video-controls" style={{ display: 'grid', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={actionModalButtonStyle}
                          onClick={syncPlayPauseVideos}
                          disabled={actionSideBySide ? (!selectedLeftUrls.length || !selectedRightUrls.length) : !actionVideoUrls.length}
                        >
                          {actionVideoPlaying ? 'Pause' : 'Play'}
                        </button>
                        <button type="button" className="btn btn-ghost" style={actionModalButtonStyle} onClick={resetActionVideos}>
                          Reset
                        </button>
                        <button
                          type="button"
                          className={actionVideoLoop ? 'btn btn-primary' : 'btn btn-ghost'}
                          style={actionVideoLoop ? { padding: '0.42rem 0.75rem' } : actionModalButtonStyle}
                          onClick={toggleActionVideoLoop}
                        >
                          Loop
                        </button>
                        <button type="button" className="btn btn-ghost" style={actionModalButtonStyle} onClick={() => stepActionVideo(-5 / 60)}>
                          -5 Frames
                        </button>
                        <button type="button" className="btn btn-ghost" style={actionModalButtonStyle} onClick={() => stepActionVideo(-1 / 60)}>
                          -1 Frame
                        </button>
                        <button type="button" className="btn btn-ghost" style={actionModalButtonStyle} onClick={() => stepActionVideo(1 / 60)}>
                          +1 Frame
                        </button>
                        <button type="button" className="btn btn-ghost" style={actionModalButtonStyle} onClick={() => stepActionVideo(5 / 60)}>
                          +5 Frames
                        </button>
                        <select value={actionPlaybackRate} onChange={(event) => setActionVideoRate(Number(event.target.value))} style={{ minHeight: 38, border: `1px solid ${actionModalTheme.border}`, borderRadius: 10, padding: '0 0.6rem', color: actionModalTheme.panelText, background: actionModalTheme.controlBg, fontWeight: 700 }}>
                          <option value={0.25}>0.25x</option>
                          <option value={0.5}>0.5x</option>
                          <option value={1}>1x</option>
                          <option value={1.5}>1.5x</option>
                        </select>
                        <span style={{ color: actionModalTheme.muted, fontWeight: 700, marginLeft: 'auto' }}>
                          {actionVideoTime.toFixed(2)}s / {(actionVideoDuration || 0).toFixed(2)}s
                        </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={actionVideoDuration || 0}
                          step={0.01}
                          value={Math.min(actionVideoTime, actionVideoDuration || actionVideoTime)}
                          onChange={(event) => syncSeekVideos(Number(event.target.value))}
                          disabled={!actionVideoDuration}
                          style={{ width: '100%' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button type="button" className="btn btn-ghost" style={actionModalButtonStyle} onClick={() => setActionMode(null)}>
                            Close
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {actionMode === 'spin' ? (
                      <>
                        <div
                          style={{
                            minHeight: 470,
                            height: 'min(64vh, 540px)',
                            borderRadius: 10,
                            border: `1px solid ${actionModalTheme.border}`,
                            background: actionModalTheme.controlSoftBg,
                            display: 'grid',
                            placeItems: 'center',
                            overflow: 'hidden',
                          }}
                        >
                          <SpinVisualCanvas
                            releaseTilt={currentActionPitch.release_tilt || ''}
                            breakTilt={currentActionPitch.break_tilt || ''}
                            spinEff={currentActionPitch.spin_eff}
                            pitcherHand={currentActionPitch.pitcherthrows}
                            frame={actionSpinFrame}
                            playing={actionIsPlaying}
                            onFrameChange={setActionSpinFrame}
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <button type="button" className="btn btn-ghost" style={actionModalButtonStyle} onClick={() => setActionIsPlaying(true)}>
                            Play
                          </button>
                          <button type="button" className="btn btn-ghost" style={actionModalButtonStyle} onClick={() => setActionIsPlaying(false)}>
                            Pause
                          </button>
                          <input
                            type="range"
                            min={1}
                            max={128}
                            value={actionSpinFrame}
                            onChange={(event) => setActionSpinFrame(Number(event.target.value))}
                            style={{ flex: 1 }}
                          />
                        </div>
                        <div style={{ border: `1px solid ${actionModalTheme.border}`, borderRadius: 10, background: actionModalTheme.controlBg, padding: '0.7rem', color: actionModalTheme.muted, fontSize: '0.86rem' }}>
                          Dashed gold arrow: Release tilt direction (rTilt) | Solid green arrow: Break tilt direction (bTilt)
                        </div>
                      </>
                    ) : null}
                  </div>

                  {!(actionMode === 'video' && actionSideBySide) ? (
                  <div style={{ display: 'grid', gap: 0, color: actionModalTheme.textStrong, fontSize: '0.98rem', alignSelf: 'start', overflowY: 'auto', width: 220 }}>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
                      {formatNameFirstLast(currentActionPitch.pitcher)}
                    </div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 500, color: actionModalTheme.muted, marginTop: 4 }}>
                      {actionDateLabel}
                    </div>
                    <hr style={{ width: '100%', borderColor: actionModalTheme.border, margin: '0.85rem 0' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.85rem' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: pitchColors[currentActionPitch.pitch_type] ?? '#9ca3af',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: '1.02rem', fontWeight: 700 }}>{currentActionPitch.pitch_type}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 14, rowGap: 12 }}>
                      {[
                        ['Velo', fmtNum(currentActionPitch.velo, 1)],
                        ['Spin', fmtNum(currentActionPitch.spin, 0)],
                        ['IVB', `${fmtNum(currentActionPitch.ivb, 1)} in`],
                        ['HB', `${fmtNum(currentActionPitch.hb, 1)} in`],
                        ['rTilt', formatTiltClock(currentActionPitch.release_tilt)],
                        ['bTilt', formatTiltClock(currentActionPitch.break_tilt)],
                        ['Height', fmtNum(currentActionPitch.release_height, 1)],
                        [
                          'Side',
                          typeof currentActionPitch.release_side === 'number'
                            ? fmtNum(orientX(currentActionPitch.release_side, currentActionPitch.school_code), 1)
                            : '-',
                        ],
                        ['Ext', fmtNum(currentActionPitch.extension, 1)],
                        [
                          'Spin Eff',
                          currentActionPitch.spin_eff !== null
                            ? `${fmtNum(currentActionPitch.spin_eff > 1 ? currentActionPitch.spin_eff : currentActionPitch.spin_eff * 100, 1)}%`
                            : '—',
                        ],
                      ].map(([label, value]) => (
                        <div key={label} style={{ textAlign: 'center' }}>
                          <div
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              color: actionModalTheme.softMuted,
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                            }}
                          >
                            {label}
                          </div>
                          <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: 2 }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    <hr style={{ width: '100%', borderColor: actionModalTheme.border, margin: '1rem 0 0' }} />
                    <div style={{ display: 'grid', justifyContent: 'center', marginTop: 10 }}>
                      <svg viewBox={`0 0 ${actionZoneW} ${actionZoneH}`} style={{ width: 172, height: 186 }}>
                        <polygon
                          points={`${actionZonePx(-0.75)},${actionZonePy(0.55)} ${actionZonePx(0.75)},${actionZonePy(0.55)} ${actionZonePx(0.75)},${actionZonePy(0.65)} ${actionZonePx(0)},${actionZonePy(0.75)} ${actionZonePx(-0.75)},${actionZonePy(0.65)}`}
                          fill="none"
                          stroke={actionModalTheme.zoneStroke}
                          strokeWidth="4"
                        />
                        <rect
                          x={actionZonePx(actionCompLeft)}
                          y={actionZonePy(actionCompTop)}
                          width={actionZonePx(actionCompRight) - actionZonePx(actionCompLeft)}
                          height={actionZonePy(actionCompBottom) - actionZonePy(actionCompTop)}
                          fill="none"
                          stroke={actionModalTheme.zoneStroke}
                          strokeWidth="4"
                        />
                        <line x1={actionZonePx(actionCompLeft)} y1={actionZonePy(actionStrikeCenterY)} x2={actionZonePx(actionStrikeLeft)} y2={actionZonePy(actionStrikeCenterY)} stroke={actionModalTheme.zoneStroke} strokeWidth="3" />
                        <line x1={actionZonePx(actionStrikeRight)} y1={actionZonePy(actionStrikeCenterY)} x2={actionZonePx(actionCompRight)} y2={actionZonePy(actionStrikeCenterY)} stroke={actionModalTheme.zoneStroke} strokeWidth="3" />
                        <line x1={actionZonePx(actionStrikeCenterX)} y1={actionZonePy(actionCompBottom)} x2={actionZonePx(actionStrikeCenterX)} y2={actionZonePy(actionStrikeBottom)} stroke={actionModalTheme.zoneStroke} strokeWidth="3" />
                        <line x1={actionZonePx(actionStrikeCenterX)} y1={actionZonePy(actionStrikeTop)} x2={actionZonePx(actionStrikeCenterX)} y2={actionZonePy(actionCompTop)} stroke={actionModalTheme.zoneStroke} strokeWidth="3" />
                        <rect
                          x={actionZonePx(actionStrikeLeft)}
                          y={actionZonePy(actionStrikeTop)}
                          width={actionZonePx(actionStrikeRight) - actionZonePx(actionStrikeLeft)}
                          height={actionZonePy(actionStrikeBottom) - actionZonePy(actionStrikeTop)}
                          fill="none"
                          stroke={actionModalTheme.zoneStroke}
                          strokeWidth="6"
                        />
                        <line x1={actionZonePx(actionStrikeLeft + ((actionStrikeRight - actionStrikeLeft) / 3))} y1={actionZonePy(actionStrikeBottom)} x2={actionZonePx(actionStrikeLeft + ((actionStrikeRight - actionStrikeLeft) / 3))} y2={actionZonePy(actionStrikeTop)} stroke={actionModalTheme.zoneStroke} strokeWidth="3" />
                        <line x1={actionZonePx(actionStrikeLeft + (((actionStrikeRight - actionStrikeLeft) * 2) / 3))} y1={actionZonePy(actionStrikeBottom)} x2={actionZonePx(actionStrikeLeft + (((actionStrikeRight - actionStrikeLeft) * 2) / 3))} y2={actionZonePy(actionStrikeTop)} stroke={actionModalTheme.zoneStroke} strokeWidth="3" />
                        <line x1={actionZonePx(actionStrikeLeft)} y1={actionZonePy(actionStrikeBottom + ((actionStrikeTop - actionStrikeBottom) / 3))} x2={actionZonePx(actionStrikeRight)} y2={actionZonePy(actionStrikeBottom + ((actionStrikeTop - actionStrikeBottom) / 3))} stroke={actionModalTheme.zoneStroke} strokeWidth="3" />
                        <line x1={actionZonePx(actionStrikeLeft)} y1={actionZonePy(actionStrikeBottom + (((actionStrikeTop - actionStrikeBottom) * 2) / 3))} x2={actionZonePx(actionStrikeRight)} y2={actionZonePy(actionStrikeBottom + (((actionStrikeTop - actionStrikeBottom) * 2) / 3))} stroke={actionModalTheme.zoneStroke} strokeWidth="3" />
                        {actionPlateX !== null && actionPlateY !== null ? (
                          <circle
                            cx={actionPlateX}
                            cy={actionPlateY}
                            r="10.5"
                            fill={pitchColors[currentActionPitch.pitch_type] ?? '#9ca3af'}
                            stroke={actionModalTheme.zoneStroke}
                            strokeWidth="2"
                          />
                        ) : null}
                      </svg>
                    </div>
                    <div style={{ display: 'grid', justifyContent: 'center' }}>
                      <img
                        src="/pearl-clam-transparent.png"
                        alt="Pearl Player Development"
                        style={{ width: 74, height: 74, objectFit: 'contain' }}
                      />
                    </div>
                  </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      {showLeaderboardCorrelation && (isLeaderboardPage || isGameLogPage || isPitchLogPage) ? (
        <LeaderboardCorrelationModal
          open
          onClose={() => setShowLeaderboardCorrelation(false)}
          title={isGameLogPage ? 'Pitching Game Log Correlation' : (isPitchLogPage ? 'Pitching Pitch Log Correlation' : 'Pitching Leaderboard Correlation')}
          columns={correlationColumns}
          axisColumns={isLeaderboardPage ? correlationAxisColumns : undefined}
          rows={correlationRows}
          minPointsRequired={isPitchLogPage ? 1 : 2}
          viewByLabel={isLeaderboardPage ? leaderboardViewBy : 'Player'}
          primaryColumnName={correlationColumns[0] ?? ''}
          formatValue={isPitchLogPage ? formatPitchLogCellDisplayValue : formatPitchingTableDisplayValue}
          correlationQueryBase={isLeaderboardPage ? correlationOverviewBaseQuery : undefined}
          siteLogoSrc={activeSchoolBrand.logoSrc ?? '/pearl-clam-transparent.png'}
          siteLogoAlt={activeSchoolBrand.logoAlt}
          pointLogoSrcForLabel={(label) => {
            if (!isPro || leaderboardViewBy !== 'Team') return '';
            const code = inferProTeamCode(label);
            const logo = code ? (getProTeamLogoUrl(code) || '') : '';
            return logo ? `/api/dashboard/image-proxy?url=${encodeURIComponent(logo)}` : '';
          }}
        />
      ) : null}
      {showTargetSettings ? (
        <div className="portal-modal-backdrop" onClick={() => setShowTargetSettings(false)}>
          <div className="portal-modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Movement settings">
            <div className="portal-modal-header">
              <h3>Movement Settings</h3>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 14,
                padding: '0.65rem 0.75rem',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
              }}
            >
              <div>
                <strong>Show MagAngle</strong>
                <div className="portal-muted-text" style={{ fontSize: '0.78rem', marginTop: 2 }}>
                  Display the Magnus line angle below the movement plot.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ minWidth: 76, height: 36 }}
                aria-pressed={showMagnusAngle}
                onClick={() => setShowMagnusAngle((current) => !current)}
              >
                {showMagnusAngle ? 'On' : 'Off'}
              </button>
            </div>
            <h4 style={{ margin: '0 0 0.6rem' }}>Comparison Overlay</h4>
            <div
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
                padding: '0.65rem 0.75rem',
                marginBottom: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div>
                <div className="portal-muted-text" style={{ fontSize: '0.78rem', marginBottom: 6 }}>
                  {isPro
                    ? 'Comparison population: MLB average.'
                    : 'Compare this player against average movement for:'}
                </div>
                {!isPro ? (
                  <SearchableSingleSelect
                    options={movementComparisonScopeOptions}
                    value={comparisonScope}
                    onChange={setComparisonScope}
                    placeholder="MLB"
                  />
                ) : null}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <strong>Show Comparison Dots</strong>
                  <div className="portal-muted-text" style={{ fontSize: '0.78rem', marginTop: 2 }}>
                    Overlay actual and Magnus-expected average dots for the selected comparison population.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ minWidth: 76, height: 36 }}
                  aria-pressed={showComparisonDots}
                  onClick={() => setShowComparisonDots((current) => !current)}
                >
                  {showComparisonDots ? 'On' : 'Off'}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <strong>Show Comparison Magnus Line</strong>
                  <div className="portal-muted-text" style={{ fontSize: '0.78rem', marginTop: 2 }}>
                    Draw the comparison population&apos;s Magnus line alongside your own (requires Magnus Line set above).
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ minWidth: 76, height: 36 }}
                  aria-pressed={showComparisonMagnusLine}
                  onClick={() => setShowComparisonMagnusLine((current) => !current)}
                >
                  {showComparisonMagnusLine ? 'On' : 'Off'}
                </button>
              </div>
              {loadingMovementComparison ? (
                <div className="portal-muted-text" style={{ fontSize: '0.76rem' }}>Loading comparison data…</div>
              ) : null}
            </div>
            <h4 style={{ margin: '0 0 0.6rem' }}>Target Shapes</h4>
            <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(200px, 1fr))' }}>
              {avgByType
                .filter((row) => row.pitch_type !== 'Undefined')
                .map((row) => {
                  const current = targetShapes[row.pitch_type] ?? { hb: null, ivb: null };
                  return (
                    <div key={`target-${row.pitch_type}`} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '0.6rem' }}>
                      <strong style={{ color: pitchColors[row.pitch_type] ?? '#fff' }}>{row.pitch_type}</strong>
                      <div className="portal-form-grid" style={{ marginTop: 8, gridTemplateColumns: 'repeat(2, minmax(80px, 1fr))' }}>
                        <label>
                          HB
                          <input
                            type="number"
                            step="0.1"
                            value={current.hb ?? ''}
                            onChange={(event) => {
                              const next = event.target.value.trim();
                              setTargetShapes((prev) => {
                                const prevRow = prev[row.pitch_type] ?? { hb: null, ivb: null };
                                const updated = { ...prevRow, hb: next === '' ? null : Number(next) };
                                if (updated.hb === null && updated.ivb === null) {
                                  const { [row.pitch_type]: _removed, ...rest } = prev;
                                  return rest;
                                }
                                return { ...prev, [row.pitch_type]: updated };
                              });
                            }}
                          />
                        </label>
                        <label>
                          IVB
                          <input
                            type="number"
                            step="0.1"
                            value={current.ivb ?? ''}
                            onChange={(event) => {
                              const next = event.target.value.trim();
                              setTargetShapes((prev) => {
                                const prevRow = prev[row.pitch_type] ?? { hb: null, ivb: null };
                                const updated = { ...prevRow, ivb: next === '' ? null : Number(next) };
                                if (updated.hb === null && updated.ivb === null) {
                                  const { [row.pitch_type]: _removed, ...rest } = prev;
                                  return rest;
                                }
                                return { ...prev, [row.pitch_type]: updated };
                              });
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
            </div>
            <div className="portal-choice-line-actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowTargetSettings(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

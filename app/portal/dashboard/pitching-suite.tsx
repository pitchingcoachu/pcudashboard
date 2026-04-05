'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTableDisplayValue, parseSortableNumber, sortTableRows, type SortDirection } from '../../../lib/table-sort';
import { getProTeamDisplayName, getProTeamLogoUrl, inferProTeamCode } from './pro-team-logos';
import { buildSharedXMetricHeatCells } from './shared-xmetrics-heatmap';
import { calcPitchValue } from './pitch-value';

type FiltersPayload = {
  school_code: string;
  min_date: string | null;
  max_date: string | null;
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

type OptionItem = { value: string; label: string };

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
    exit_speed: number | null;
    angle: number | null;
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
    exit_speed: number | null;
    angle: number | null;
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
  }>;
  pitch_type_legend: string[];
  pa_groups: Array<{
    batter: string;
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
  createdAt: string;
  updatedAt: string;
};

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
const PRO_SEASON_START = '2026-03-25';


function fmtNum(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return value.toFixed(digits);
}

function formatNameFirstLast(name: string): string {
  const trimmed = name.trim();
  if (!trimmed.includes(',')) return trimmed;
  const [last, first] = trimmed.split(',').map((part) => part.trim());
  if (!last || !first) return trimmed;
  return `${first} ${last}`;
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

function formatDashboardDateLabel(startDate: string, endDate: string, isProSchool: boolean): string {
  if (!startDate || !endDate) return '-';
  const today = toYmdNow();
  if (isProSchool && startDate === PRO_SEASON_START && endDate === today) return '2026 Season';
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
  lines.push(`Velo: ${entry.velocity_mph.toFixed(1)} mph`);
  lines.push(`Weight: ${entry.ball_weight_oz.toFixed(2)} oz`);
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

function toParamValue(values: string[]): string {
  return values.filter((value) => value !== 'All').join(';');
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
  'Max',
  'IVB',
  'HB',
  'Spin',
  'rTilt',
  'bTilt',
  'SpinEff',
  'Height',
  'Side',
  'Ext',
  'VAA',
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

const TREND_METRIC_OPTIONS: OptionItem[] = [
  { value: 'Velocity (Avg)', label: 'Velocity (Avg)' },
  { value: 'Velocity (Max)', label: 'Velocity (Max)' },
  { value: 'Spin', label: 'Spin' },
  { value: 'IVB', label: 'IVB' },
  { value: 'HB', label: 'HB' },
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
  return v.replace(/\s+/g, '');
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
  if (lower === 'csw%') return 'CSW%';
  if (lower === 'k%') return 'K%';
  if (lower === 'bb%') return 'BB%';
  if (lower === 'gb%') return 'GB%';
  if (lower === 'era') return 'ERA';
  if (lower === 'fip') return 'FIP';
  if (lower === 'xfip') return 'xFIP';
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
  if (metric === 'FIP' || metric === 'xFIP') {
    if (isPro) return { poor: 5.2, avg: 4.2, great: 3.2 };
    return { poor: 5.9, avg: 4.9, great: 3.9 };
  }
  if (metric === 'Barrel%') return { poor: 20, avg: 15, great: 10 };
  if (metric === 'EV') return { poor: 95, avg: 85, great: 75 };
  if (metric === 'Stuff+') return { poor: 90, avg: 100, great: 110 };
  if (metric === 'RV/100') {
    if (pitchType === 'fastball') return { poor: 1.5, avg: 0.7, great: -0.1 };
    if (pitchType === 'sinker') return { poor: 2.3, avg: 0.9, great: -0.5 };
    if (pitchType === 'cutter') return { poor: 0.9, avg: -0.2, great: -1.3 };
    if (pitchType === 'slider') return { poor: -0.4, avg: -1.1, great: -1.8 };
    if (pitchType === 'curveball') return { poor: -0.1, avg: -1.3, great: -2.5 };
    if (pitchType === 'changeup') return { poor: 0.7, avg: -0.5, great: -1.7 };
    if (pitchType === 'splitter') return { poor: 0, avg: -1.4, great: -2.8 };
    return { poor: 0.7, avg: 0, great: -0.7 };
  }
  if (metric === 'PV/100') {
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
  const reverseScale = ['EV', 'Barrel%', 'BB%', 'ERA', 'FIP', 'xFIP'].includes(metric) || metric === 'RV/100' || metric === 'PV/100';
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
}: {
  options: OptionItem[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  theme?: 'dark' | 'light';
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
      <button
        type="button"
        className="portal-search-select-trigger"
        style={
          theme === 'light'
            ? { background: '#fff', color: '#374151', borderColor: '#cbd5e1', justifyContent: 'space-between' }
            : undefined
        }
        onClick={() => setOpen((current) => !current)}
      >
        {selected?.label ?? placeholder ?? 'Select'}
      </button>
      {open ? (
        <div
          className="portal-search-select-menu"
          style={theme === 'light' ? { background: '#fff', borderColor: '#cbd5e1' } : undefined}
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
                style={theme === 'light' ? { color: '#374151' } : undefined}
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
    if (isProSchool) {
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
      if (callN === 'swinging_strike' || callN === 'swinging_strike_blocked' || callN === 'swinging_strike_pitchout' || callN === 'missed_bunt') return 'Whiff';
      if (prN === 'single' || prN === 'double' || prN === 'triple' || prN === 'home_run' || prN === 'homerun') return 'In Play (Hit)';
      if (prN === 'field_error' || prN === 'error') return 'Error';
      if (callN.startsWith('in_play') || callN.startsWith('hit_into_play')) return 'In Play (Out)';
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
            const x = px(flipX ? -Number(pitch.plate_side) : Number(pitch.plate_side));
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
                {shape === '' ? <circle cx={x} cy={y} r={7.0} fill={color} /> : null}
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

export default function PitchingSuite({
  role,
  selectedSchoolCode,
}: {
  role?: 'admin' | 'coach' | 'player';
  selectedSchoolCode?: string;
}) {
  const canUsePitchEdits = role === 'admin' || role === 'coach';
  const isPlayerRole = role === 'player';
  const [dashboardPage, setDashboardPage] = useState<'Summary' | 'Leaderboard' | 'AB Report' | 'Velocity' | 'HeatMaps' | 'QP Locations' | 'Trend' | 'Velo Manual Entry'>('Summary');
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [filters, setFilters] = useState<FiltersPayload | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingAbReport, setLoadingAbReport] = useState(false);
  const [error, setError] = useState('');
  const [abError, setAbError] = useState('');
  const [abReport, setAbReport] = useState<AbReportPayload | null>(null);
  const [abGameKey, setAbGameKey] = useState('');
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
  const [sessionType, setSessionType] = useState('');
  const [level, setLevel] = useState('MLB');
  const [qpLocations, setQpLocations] = useState('All');
  const [tableMode, setTableMode] = useState('Live');
  const [splitBy, setSplitBy] = useState('Pitch Types');
  const [leaderboardSortColumn, setLeaderboardSortColumn] = useState('');
  const [leaderboardSortDirection, setLeaderboardSortDirection] = useState<SortDirection>('desc');
  const [leaderboardViewBy, setLeaderboardViewBy] = useState<'Player' | 'Team'>('Player');
  const autoFallbackAppliedRef = useRef(false);
  const filtersCacheRef = useRef(new Map<string, { at: number; payload: FiltersPayload }>());
  const filtersInflightRef = useRef(new Map<string, Promise<FiltersPayload>>());
  const overviewCacheRef = useRef(new Map<string, { at: number; payload: OverviewPayload }>());
  const overviewInflightRef = useRef(new Map<string, Promise<OverviewPayload>>());
  const [abSortColumn, setAbSortColumn] = useState('Pitch #');
  const [abSortDirection, setAbSortDirection] = useState<SortDirection>('asc');
  const [manualEntriesSortColumn, setManualEntriesSortColumn] = useState('Date');
  const [manualEntriesSortDirection, setManualEntriesSortDirection] = useState<SortDirection>('desc');
  const [manualProgressSortColumn, setManualProgressSortColumn] = useState('Date');
  const [manualProgressSortDirection, setManualProgressSortDirection] = useState<SortDirection>('desc');
  const [visualOption, setVisualOption] = useState('Play Video');
  const [enableTableColors, setEnableTableColors] = useState(true);
  const [customTables, setCustomTables] = useState<CustomTableConfig[]>([]);
  const [loadingCustomTables, setLoadingCustomTables] = useState(false);
  const [customTableName, setCustomTableName] = useState('');
  const [selectedCustomTableId, setSelectedCustomTableId] = useState<number | null>(null);

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

  const [appliedFilterVersion, setAppliedFilterVersion] = useState(0);
  const [releaseView, setReleaseView] = useState('Averages Only');
  const [movementView, setMovementView] = useState('Averages and Pitches');
  const [locationView, setLocationView] = useState('Pitch');
  const [heatmapChartType, setHeatmapChartType] = useState<'Heat' | 'Pitch' | 'QP+'>('Pitch');
  const [heatmapStat, setHeatmapStat] = useState('Frequency');
  const [showTargetSettings, setShowTargetSettings] = useState(false);
  const [targetShapes, setTargetShapes] = useState<Record<string, TargetShape>>({});
  const [releaseHover, setReleaseHover] = useState<ChartHover>(null);
  const [movementHover, setMovementHover] = useState<ChartHover>(null);
  const [locationHover, setLocationHover] = useState<ChartHover>(null);
  const [qpLocationsHover, setQpLocationsHover] = useState<ChartHover>(null);
  const [velocityMainHover, setVelocityMainHover] = useState<ChartHover>(null);
  const [velocityGameHover, setVelocityGameHover] = useState<ChartHover>(null);
  const [velocityInningHover, setVelocityInningHover] = useState<ChartHover>(null);
  const [manualChartHover, setManualChartHover] = useState<ChartHover>(null);
  const [trendHover, setTrendHover] = useState<ChartHover>(null);
  const [trendMetric, setTrendMetric] = useState('Velocity (Avg)');
  const [actionMode, setActionMode] = useState<'video' | 'edit' | 'spin' | null>(null);
  const [actionPitches, setActionPitches] = useState<PitchActionPoint[]>([]);
  const [actionIndex, setActionIndex] = useState(0);
  const [editPitchType, setEditPitchType] = useState('');
  const [editPitcher, setEditPitcher] = useState('');
  const [actionSaveState, setActionSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [actionSaveMessage, setActionSaveMessage] = useState('');
  const [actionIsPlaying, setActionIsPlaying] = useState(false);
  const [actionSpinFrame, setActionSpinFrame] = useState(12);
  const [actionSideBySide, setActionSideBySide] = useState(false);
  const [actionLeftPitchKey, setActionLeftPitchKey] = useState('');
  const [actionRightPitchKey, setActionRightPitchKey] = useState('');
  const [actionVideoPlaying, setActionVideoPlaying] = useState(false);
  const [actionVideoTime, setActionVideoTime] = useState(0);
  const [actionVideoDuration, setActionVideoDuration] = useState(0);
  const isLeaderboardPage = dashboardPage === 'Leaderboard';
  const effectiveSplitBy = isLeaderboardPage ? (leaderboardViewBy === 'Team' ? 'Pitcher Team' : 'Pitcher') : splitBy;
  const leftCompareVideoRef = useRef<HTMLVideoElement | null>(null);
  const rightCompareVideoRef = useRef<HTMLVideoElement | null>(null);
  const actionViewRef = useRef<HTMLDivElement | null>(null);

  const isLeague =
    String(selectedSchoolCode ?? '').toUpperCase() === 'LEAGUE' ||
    String(filters?.school_code ?? '').toUpperCase() === 'LEAGUE';
  const isPro =
    String(selectedSchoolCode ?? '').toUpperCase() === 'PRO' ||
    String(selectedSchoolCode ?? '').toUpperCase() === 'MLB' ||
    String(filters?.school_code ?? '').toUpperCase() === 'PRO' ||
    String(filters?.school_code ?? '').toUpperCase() === 'MLB';
  const orientX = (x: number): number => (isPro ? -x : x);
  const canShowLeagueHeavyPages = !isLeague;
  const canShowVeloManualEntry = !isLeague;
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
  const shouldForceLeagueFastTable =
    isLeague && (dashboardPage === 'Summary' || dashboardPage === 'Leaderboard') && leagueWindowDays > 14 && isLeagueAllSelection;
  const filteredPitchers = useMemo(() => {
    if (!filters) return [];
    if (!isLeague || teamType === 'All') return filters.pitchers ?? [];
    return filters.pitchers_by_team_code?.[teamType] ?? [];
  }, [filters, isLeague, teamType]);
  const filteredOppHitters = useMemo(() => {
    if (!filters) return [];
    if (!isLeague || teamType === 'All') return filters.opp_hitters ?? [];
    return filters.opp_hitters_by_team_code?.[teamType] ?? [];
  }, [filters, isLeague, teamType]);
  const pitcherOptions = useMemo(() => (filters ? [{ value: 'All', label: 'All' }, ...toOptions(filteredPitchers, true)] : []), [filters, filteredPitchers]);
  const hitterOptions = useMemo(() => (filters ? [{ value: 'All', label: 'All' }, ...toOptions(filteredOppHitters, true)] : []), [filters, filteredOppHitters]);
  const pitchTypeOptions = useMemo(() => (filters ? [{ value: 'All', label: 'All' }, ...toOptions(filters.pitch_types)] : []), [filters]);
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

  useEffect(() => {
    if (!canShowVeloManualEntry && dashboardPage === 'Velo Manual Entry') {
      setDashboardPage('Summary');
    }
  }, [canShowVeloManualEntry, dashboardPage]);
  useEffect(() => {
    if (!canShowLeagueHeavyPages && (dashboardPage === 'Velocity' || dashboardPage === 'Trend' || dashboardPage === 'QP Locations')) {
      setDashboardPage('Summary');
    }
  }, [canShowLeagueHeavyPages, dashboardPage]);
  useEffect(() => {
    if (!isLeague && !isPro && leaderboardViewBy !== 'Player') {
      setLeaderboardViewBy('Player');
    }
  }, [isLeague, isPro, leaderboardViewBy]);
  useEffect(() => {
    if (!isLeague) return;
    const allowedTableModes = new Set(['Stuff', 'Process', 'Results', 'Bullpen', 'Live', 'Usage', 'Raw Data', 'Batted Ball Data', 'Custom']);
    if (!allowedTableModes.has(tableMode)) {
      setTableMode('Live');
    }
    const allowedSplitBy = new Set([
      'Pitch Types',
      'Pitcher',
      'Pitcher Hand',
      'Batter Hand',
      'Count',
      'After Count',
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

  const manualPitcherOptions = useMemo(() => {
    const fromFilters = filters?.pitchers ?? [];
    const fromManual = manualEntries.map((entry) => entry.pitcher).filter(Boolean);
    const unique = Array.from(new Set([...fromFilters, ...fromManual])).sort((a, b) => a.localeCompare(b));
    return [{ value: 'All', label: 'All' }, ...toOptions(unique, true)];
  }, [filters?.pitchers, manualEntries]);
  useEffect(() => {
    const allowed = new Set(pitcherOptions.map((option) => option.value));
    const next = selectedPitchers.filter((value) => allowed.has(value));
    const normalized = next.length ? next : ['All'];
    if (normalized.length !== selectedPitchers.length || normalized.some((value, index) => value !== selectedPitchers[index])) {
      setSelectedPitchers(normalized);
    }
  }, [pitcherOptions, selectedPitchers]);

  useEffect(() => {
    const allowed = new Set(hitterOptions.map((option) => option.value));
    const next = selectedHitters.filter((value) => allowed.has(value));
    const normalized = next.length ? next : ['All'];
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
    setLoadingFilters(true);
    setError('');
    const filterParams = new URLSearchParams();
    if (level) filterParams.set('level', level);
    const filterKey = `/api/dashboard/pitching/filters?${filterParams.toString()}`;
    const filterTtlMs = 120000;
    const applyFiltersPayload = (payload: FiltersPayload) => {
      autoFallbackAppliedRef.current = false;
      setFilters(payload);
      setTeamType(pickDefaultTeamType(payload.team_types ?? [], payload.school_code ?? ''));
      const latestDate = clampYmdToToday(payload.max_date ?? '');
      const minDate = payload.min_date ?? '';
      const isLeagueSchool = String(payload.school_code ?? '').toUpperCase() === 'LEAGUE';
      if (isLeagueSchool) {
        const leagueStart = minDate && minDate > LEAGUE_SEASON_START ? minDate : LEAGUE_SEASON_START;
        setStartDate(leagueStart);
        setEndDate(latestDate || leagueStart);
      } else {
        setStartDate(latestDate);
        setEndDate(latestDate);
      }
    };
    const cached = filtersCacheRef.current.get(filterKey);
    if (cached && Date.now() - cached.at < filterTtlMs) {
      applyFiltersPayload(cached.payload);
      setLoadingFilters(false);
      return () => {
        active = false;
        controller.abort();
      };
    }
    const inflight = filtersInflightRef.current.get(filterKey);
    const requestPromise =
      inflight ??
      (async () => {
        const response = await fetch(filterKey, { signal: controller.signal, cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as FiltersPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load dashboard filters.');
        return payload;
      })();
    if (!inflight) filtersInflightRef.current.set(filterKey, requestPromise);
    requestPromise
      .then((payload) => {
        if (!active) return;
        filtersCacheRef.current.set(filterKey, { at: Date.now(), payload });
        applyFiltersPayload(payload);
      })
      .catch((requestError) => {
        if (!active) return;
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load dashboard filters.');
      })
      .finally(() => {
        filtersInflightRef.current.delete(filterKey);
        if (active) setLoadingFilters(false);
      });

    return () => {
      active = false;
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
    if (!level) setLevel('MLB');
  }, [isPro, level]);

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
  const overviewHeaderLabel = useMemo(() => {
    const selected = selectedPitchers.filter((value) => value !== 'All');
    const playerLabel = selected.length === 1 ? formatNameFirstLast(selected[0]) : 'All';
    const dateLabel = formatDashboardDateLabel(startDate, endDate, isPro);
    return `${playerLabel} | ${dateLabel}`;
  }, [selectedPitchers, startDate, endDate, isPro]);
  const selectedSinglePitcher = useMemo(() => {
    const selected = selectedPitchers.filter((value) => value !== 'All');
    return selected.length === 1 ? selected[0] : '';
  }, [selectedPitchers]);

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
    setLoadingOverview(true);
    setError('');

    const params = new URLSearchParams();
    params.set('start_date', startDate);
    params.set('end_date', endDate);

    if (teamType && teamType !== 'All') params.set('team_type', teamType);
    if (isPro && level && level !== 'All') params.set('level', level);
    if (withVideo && withVideo !== 'All') params.set('with_video', withVideo);
    if (breakLines && breakLines !== 'None') params.set('break_lines', breakLines);
    if (stuffLevel) params.set('stuff_level', stuffLevel);
    if (stuffBase) params.set('stuff_base', stuffBase);
    if (hand && hand !== 'All') params.set('hand', hand);
    if (batterSide && batterSide !== 'All') params.set('batter_side', batterSide);
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
    const zoneParam = toParamValue(selectedZoneLocations);
    const resultsParam = toParamValue(selectedPitchResults);
    const countParam = toParamValue(selectedCountFilters);
    const afterCountParam = toParamValue(selectedAfterCountFilters);
    const inZoneParam = toParamValue(selectedInZone);

    if (pitchersParam) params.set('pitcher', pitchersParam);
    if (hittersParam) params.set('opp_hitter', hittersParam);
    if (pitchTypesParam) params.set('pitch_types', pitchTypesParam);
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
    const isTrendPage = dashboardPage === 'Trend';
    const isLeaderboard = dashboardPage === 'Leaderboard';
    const isSummaryPage = dashboardPage === 'Summary';
    const shouldLoadLeagueCharts = isLeague && !isLeagueAllSelection && !shouldForceLeagueFastTable;
    const shouldIncludeRowPitches =
      (!isLeague && !isPro) || (isLeague && !hideLeagueSummaryCharts && !shouldForceLeagueFastTable && leagueWindowDays <= 14);
    const shouldForceProFastSummary = isPro && isSummaryPage;
    if (shouldForceProFastSummary) {
      params.set('include_chart_points', '0');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
    } else if (isPlayerRole) {
      params.set('include_chart_points', '1');
      params.set('chart_points_limit', '300');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', isTrendPage ? '1' : '0');
    } else if (isLeaderboard) {
      params.set('include_chart_points', '1');
      params.set('chart_points_limit', isPro ? '400' : '1000');
      params.set('include_row_pitches', shouldIncludeRowPitches ? '1' : '0');
      params.set('include_trend_rows', '0');
    } else if (hideLeagueSummaryCharts || shouldForceLeagueFastTable) {
      params.set('include_chart_points', '0');
      params.set('include_row_pitches', '0');
      params.set('include_trend_rows', '0');
    } else {
      params.set('include_chart_points', shouldLoadLeagueCharts ? '1' : (isLeague ? '0' : '1'));
      if (shouldLoadLeagueCharts || !isLeague) params.set('chart_points_limit', isPro ? '500' : '1000');
      params.set('include_row_pitches', shouldIncludeRowPitches ? '1' : '0');
      params.set('include_trend_rows', isLeague ? '0' : (isTrendPage ? '1' : '0'));
    }
    const requestKey = `/api/dashboard/pitching/overview?${params.toString()}`;
    const chartRequestKey = shouldForceProFastSummary
      ? (() => {
          const chartParams = new URLSearchParams(params);
          chartParams.set('include_chart_points', '1');
          chartParams.set('chart_points_limit', '350');
          chartParams.set('chart_only', '1');
          chartParams.set('include_row_pitches', '0');
          chartParams.set('include_trend_rows', '0');
          return `/api/dashboard/pitching/overview?${chartParams.toString()}`;
        })()
      : null;
    const overviewTtlMs = isPro ? 90000 : 30000;
    const applyOverviewPayload = (payload: OverviewPayload) => {
      const noRows = !Array.isArray(payload.table_rows) || payload.table_rows.length === 0;
      if (noRows && !autoFallbackAppliedRef.current) autoFallbackAppliedRef.current = true;
      setOverview(payload);
    };
    const applyChartPayload = (payload: OverviewPayload) => {
      setOverview((previous) => {
        if (!previous) return payload;
        return {
          ...previous,
          chart_points: payload.chart_points ?? [],
          heatmap_points: payload.heatmap_points ?? [],
          trend_rows: payload.trend_rows ?? [],
        };
      });
    };
    const cachedOverview = overviewCacheRef.current.get(requestKey);
    if (cachedOverview && Date.now() - cachedOverview.at < overviewTtlMs) {
      applyOverviewPayload(cachedOverview.payload);
      setLoadingOverview(false);
      return () => {
        active = false;
        controller.abort();
      };
    }
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
      .then((payload) => {
        if (!active) return;
        overviewCacheRef.current.set(requestKey, { at: Date.now(), payload });
        applyOverviewPayload(payload);
        if (!chartRequestKey) return;

        const cachedChart = overviewCacheRef.current.get(chartRequestKey);
        if (cachedChart && Date.now() - cachedChart.at < overviewTtlMs) {
          applyChartPayload(cachedChart.payload);
          return;
        }

        const inflightChart = overviewInflightRef.current.get(chartRequestKey);
        const chartPromise =
          inflightChart ??
          (async () => {
            const response = await fetch(chartRequestKey, { signal: controller.signal });
            const chartPayload = (await response.json().catch(() => ({}))) as OverviewPayload & { error?: string };
            if (!response.ok) throw new Error(chartPayload.error ?? 'Failed to load pitching chart data.');
            return chartPayload;
          })();
        if (!inflightChart) overviewInflightRef.current.set(chartRequestKey, chartPromise);

        chartPromise
          .then((chartPayload) => {
            if (!active) return;
            overviewCacheRef.current.set(chartRequestKey, { at: Date.now(), payload: chartPayload });
            applyChartPayload(chartPayload);
          })
          .catch((chartError) => {
            if (!active) return;
            if (chartError instanceof DOMException && chartError.name === 'AbortError') return;
          })
          .finally(() => {
            overviewInflightRef.current.delete(chartRequestKey);
          });
      })
      .catch((requestError) => {
        if (!active) return;
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load pitching overview.');
      })
      .finally(() => {
        overviewInflightRef.current.delete(requestKey);
        if (active) setLoadingOverview(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    appliedFilterVersion,
    batterSide,
    canLoadOverview,
    endDate,
    hand,
    hbMax,
    hbMin,
    ivbMax,
    ivbMin,
    pcMax,
    pcMin,
    qpLocations,
    tableMode,
    effectiveSplitBy,
    hideLeagueSummaryCharts,
    shouldForceLeagueFastTable,
    leagueWindowDays,
    customTableColumns,
    visualOption,
    selectedAfterCountFilters,
    selectedCountFilters,
    selectedHitters,
    selectedInZone,
    selectedPitchers,
    selectedPitchResults,
    selectedPitchTypes,
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
    hand,
    batterSide,
    selectedHitters,
    selectedPitchTypes,
  ]);

  useEffect(() => {
    if (!canUsePitchEdits && visualOption === 'Pitch Edit') {
      setVisualOption('Play Video');
    }
  }, [canUsePitchEdits, visualOption]);

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
    }
  };

  useEffect(() => {
    void loadCustomTables();
  }, []);

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

  const openActionModal = (pitches: PitchActionPoint[]) => {
    if (!pitches.length) return;
    const nextMode: 'video' | 'edit' | 'spin' =
      visualOption === 'Pitch Edit' && canUsePitchEdits ? 'edit' : visualOption === 'Spin Visual' ? 'spin' : 'video';
    setActionPitches(pitches);
    setActionIndex(0);
    setActionMode(nextMode);
    setEditPitchType(pitches[0]?.pitch_type ?? '');
    setEditPitcher(resolvePitcherName(pitches[0], selectedPitchers));
    setActionSaveState('idle');
    setActionSaveMessage('');
    setActionIsPlaying(nextMode === 'spin');
    setActionSpinFrame(12);
    setActionSideBySide(false);
    setActionLeftPitchKey('');
    setActionRightPitchKey('');
    setActionVideoPlaying(false);
    setActionVideoTime(0);
    setActionVideoDuration(0);
  };

  useEffect(() => {
    if (!currentActionPitch) return;
    setEditPitchType(currentActionPitch.pitch_type ?? '');
    setEditPitcher(resolvePitcherName(currentActionPitch, selectedPitchers));
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
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean; updated_count?: number };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Failed to save pitch edit.');
      }

      setActionPitches((rows) =>
        rows.map((row, idx) =>
          editIds.includes(row.pitch_event_id ?? -1)
            ? { ...row, pitch_type: nextPitchType, pitcher: nextPitcher }
            : row
        )
      );
      setActionSaveState('saved');
      setActionSaveMessage(`Saved ${payload.updated_count ?? editIds.length} pitch edit(s).`);
      setAppliedFilterVersion((current) => current + 1);
      await loadPitchEditCount();
    } catch (requestError) {
      setActionSaveState('error');
      setActionSaveMessage(requestError instanceof Error ? requestError.message : 'Failed to save pitch edit.');
    }
  };

  const pitchColors: Record<string, string> = {
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
  const pitchHoverTextColor = (bg?: string): string => {
    if (!bg) return '#fff';
    const v = bg.toLowerCase();
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
    return rgb(lerp(248, 176, t), lerp(248, 11, t), lerp(248, 52, t));
  };
  const sequentialColor = (value: number, min: number, max: number): string => {
    if (!Number.isFinite(value)) return 'rgba(255,255,255,0.08)';
    const mid = min + (max - min) * 0.5;
    return divergingColor(value, min, mid, max);
  };
  const resultShape = (pitchCall: string, playResult: string): string => {
    if (String(selectedSchoolCode || '').trim().toUpperCase() === 'PRO') {
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
      if (callN === 'swinging_strike' || callN === 'swinging_strike_blocked' || callN === 'swinging_strike_pitchout' || callN === 'missed_bunt') return 'Whiff';
      if (prN === 'single' || prN === 'double' || prN === 'triple' || prN === 'home_run' || prN === 'homerun') return 'In Play (Hit)';
      if (prN === 'field_error' || prN === 'error') return 'Error';
      if (callN.startsWith('in_play') || callN.startsWith('hit_into_play')) return 'In Play (Out)';
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
  const inZoneLabel = (x: number | null, y: number | null): string => {
    if (x === null || y === null) return 'No';
    const inZone = x >= -0.88 && x <= 0.88 && y >= 1.5 && y <= 3.6;
    const comp = x >= -1.5 && x <= 1.5 && y >= (2.65 - 1.5) && y <= (2.65 + 1.5);
    if (inZone) return 'Yes';
    if (comp) return 'Competitive';
    return 'No';
  };
  const tooltipHtml = (point: OverviewPayload['chart_points'][number]): string =>
    `Pitcher: ${formatNameFirstLast(String(point.pitcher || '')) || '-'}\nBatter: ${formatNameFirstLast(String(point.batter || '')) || '-'}\nSession: ${point.session_type || '-'}\nResult: ${resolvePitchResultLabel(point.pitch_call, point.play_result)}\nVelo: ${point.velo !== null ? point.velo.toFixed(1) : '-'} mph\nIVB: ${point.ivb !== null ? point.ivb.toFixed(1) : '-'} in\nHB: ${point.hb !== null ? point.hb.toFixed(1) : '-'} in\nEV: ${point.exit_speed !== null ? point.exit_speed.toFixed(1) : '-'} mph\nLA: ${point.angle !== null ? point.angle.toFixed(1) : '-'}°\nStuff+: ${point.stuff_plus !== null ? point.stuff_plus.toFixed(1) : '-'}\nIn Zone: ${inZoneLabel(point.plate_side, point.plate_height)}`;
  const releaseTooltipHtml = (point: OverviewPayload['chart_points'][number]): string =>
    `Session: ${point.session_type || '-'}\nHeight: ${point.release_height !== null ? point.release_height.toFixed(2) : '-'} ft\nSide: ${point.release_side !== null ? orientX(point.release_side).toFixed(2) : '-'} ft\nExtension: ${point.extension !== null ? point.extension.toFixed(2) : '-'} ft`;
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
  const actionPlateX =
    currentActionPitch?.plate_side !== null && currentActionPitch?.plate_side !== undefined
      ? 120 + (orientX(currentActionPitch.plate_side) / 2.5) * 107
      : null;
  const actionPlateY =
    currentActionPitch?.plate_height !== null && currentActionPitch?.plate_height !== undefined
      ? 20 + ((4.5 - currentActionPitch.plate_height) / 4.5) * 180
      : null;

  const pitchKeyFor = (pitch: PitchActionPoint): string => {
    if (pitch.pitch_event_id) return `id:${pitch.pitch_event_id}`;
    return `k:${pitch.play_id}|${pitch.pitch_no ?? ''}|${pitch.pitch_number ?? ''}|${pitch.session_date ?? ''}|${pitch.pitcher ?? ''}`;
  };
  const currentPitchKey = currentActionPitch ? pitchKeyFor(currentActionPitch) : '';
  const comparePitchPool = useMemo<PitchActionPoint[]>(
    () => (overview?.chart_points as PitchActionPoint[] | undefined) ?? [],
    [overview?.chart_points]
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
      if (Number.isInteger(idx) && idx >= 0 && idx < comparePitchPool.length) return comparePitchPool[idx];
      return currentActionPitch ?? null;
    },
    [comparePitchPool, actionLeftPitchKey, currentActionPitch]
  );
  const selectedRightPitch = useMemo(
    () => {
      const idx = Number((actionRightPitchKey || '').split(':')[0]);
      if (Number.isInteger(idx) && idx >= 0 && idx < comparePitchPool.length) return comparePitchPool[idx];
      return null;
    },
    [comparePitchPool, actionRightPitchKey]
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

  const updateSyncedDuration = () => {
    const left = leftCompareVideoRef.current;
    const right = rightCompareVideoRef.current;
    const leftDur = left?.duration && Number.isFinite(left.duration) ? left.duration : 0;
    const rightDur = right?.duration && Number.isFinite(right.duration) ? right.duration : 0;
    const next = leftDur && rightDur ? Math.min(leftDur, rightDur) : leftDur || rightDur || 0;
    setActionVideoDuration(next);
  };

  const syncSeekVideos = (seconds: number) => {
    const left = leftCompareVideoRef.current;
    const right = rightCompareVideoRef.current;
    if (left) left.currentTime = seconds;
    if (right) right.currentTime = seconds;
    setActionVideoTime(seconds);
  };

  const syncPlayPauseVideos = async () => {
    const left = leftCompareVideoRef.current;
    const right = rightCompareVideoRef.current;
    if (!left || !right) return;
    if (actionVideoPlaying) {
      left.pause();
      right.pause();
      setActionVideoPlaying(false);
      return;
    }
    try {
      await Promise.all([left.play(), right.play()]);
      setActionVideoPlaying(true);
    } catch {
      setActionVideoPlaying(false);
    }
  };

  useEffect(() => {
    if (!actionSideBySide) {
      setActionVideoPlaying(false);
      setActionVideoTime(0);
      setActionVideoDuration(0);
      return;
    }
    const timer = window.setInterval(() => {
      const left = leftCompareVideoRef.current;
      if (!left) return;
      setActionVideoTime(left.currentTime || 0);
      if (actionVideoDuration > 0 && left.currentTime >= actionVideoDuration) {
        left.pause();
        rightCompareVideoRef.current?.pause();
        setActionVideoPlaying(false);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [actionSideBySide, actionVideoDuration]);

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
      <div>IVB: {fmtNum(pitch.ivb, 1)}"</div>
      <div>HB: {fmtNum(pitch.hb, 1)}"</div>
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
      <div>Side: {typeof pitch.release_side === 'number' ? fmtNum(orientX(pitch.release_side), 1) : '-'}</div>
    </div>
  );

  const summaryPoints = useMemo(() => overview?.chart_points ?? [], [overview]);
  const summaryHeatmapPoints = useMemo(
    () => ((overview?.heatmap_points as PitchActionPoint[] | undefined) ?? summaryPoints),
    [overview?.heatmap_points, summaryPoints]
  );
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
      stuffSum: number;
      stuffN: number;
      qpSum: number;
      qpN: number;
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
    if (backendTrendRows.length > 0) {
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
      stuffSum: 0,
      stuffN: 0,
      qpSum: 0,
      qpN: 0,
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
        'Stuff+': agg.stuffN > 0 ? agg.stuffSum / agg.stuffN : null,
        'QP+': agg.qpN > 0 ? agg.qpSum / agg.qpN : null,
        'InZone%': pct(agg.inZoneN, agg.pitches),
        'Comp%': pct(agg.compN, agg.pitches),
        'Strike%': pct(agg.strikeN, agg.pitches),
        'Swing%': pct(agg.swingN, agg.pitches),
        'FPS%': pct(agg.fpsNum, agg.fpsDen),
        'Early%': pct(agg.earlyNum, agg.earlyDen),
        'Ahead%': pct(agg.aheadNum, agg.aheadDen),
        'E+A%': pct(agg.eaNum, agg.eaDen),
        '1-1W%': pct(agg.oneOneNum, agg.oneOneDen),
        'QP%': pct(agg.qpNum, agg.qpDen),
        'Whiff%': pct(agg.whiffN, agg.swingN),
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
    if (selectedSchoolCode === 'OSU') {
      schoolCodes.add('OKLCOW');
      schoolCodes.add('OKLCPR');
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
      release_side: safeMean(pts.map((p) => p.release_side)),
      release_height: safeMean(pts.map((p) => p.release_height)),
      extension: safeMean(pts.map((p) => p.extension)),
      hb: safeMean(pts.map((p) => p.hb)),
      ivb: safeMean(pts.map((p) => p.ivb)),
      velo: safeMean(pts.map((p) => p.velo)),
      stuff_plus: safeMean(pts.map((p) => p.stuff_plus)),
      count: pts.length,
    }));
  }, [summaryPoints]);

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
    if (metric === 'xWOBA' || metric === 'xISO') {
      const normalizedPoints = points.map((point) => {
        const rawX = point[xKey];
        const rawY = point[yKey];
        const x = typeof rawX === 'number' && Number.isFinite(rawX) ? orientX(rawX) : null;
        const y = typeof rawY === 'number' && Number.isFinite(rawY) ? rawY : null;
        return {
          plate_side: x,
          plate_height: y,
          estimated_woba_using_speedangle:
            typeof point.estimated_woba_using_speedangle === 'number' && Number.isFinite(point.estimated_woba_using_speedangle)
              ? point.estimated_woba_using_speedangle
              : null,
          iso_value:
            typeof point.iso_value === 'number' && Number.isFinite(point.iso_value)
              ? point.iso_value
              : null,
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
      return d === 'swinging_strike' || d === 'swinging_strike_blocked' || d === 'foul_tip';
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
        const adjustedX = typeof rawX === 'number' ? orientX(rawX) : rawX;
        return { p, x: adjustedX, y: rawY };
      })
      .filter((row): row is { p: OverviewPayload['chart_points'][number]; x: number; y: number } => row.x !== null && row.y !== null);
    if (!valid.length) return [];
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

    const globalSwingCount = valid.filter((rowPoint) => isSwingCall(rowPoint.p)).length;
    const globalWhiffCount = valid.filter((rowPoint) => isWhiffCall(rowPoint.p)).length;
    const globalInPlayCount = valid.filter((rowPoint) => isInPlayCall(rowPoint.p)).length;
    const globalGbCount = valid.filter((rowPoint) => isInPlayCall(rowPoint.p) && isGroundBall(rowPoint.p)).length;
    const globalEvRows = valid.filter((rowPoint) => isInPlayCall(rowPoint.p) && typeof rowPoint.p.exit_speed === 'number');
    const globalQpRows = valid.filter((rowPoint) => typeof rowPoint.p.qp_plus === 'number' && Number.isFinite(rowPoint.p.qp_plus));
    const globalEvAvg =
      globalEvRows.length > 0
        ? globalEvRows.reduce((sum, rowPoint) => sum + Number(rowPoint.p.exit_speed || 0), 0) / globalEvRows.length
        : 0;
    const globalQpAvg =
      globalQpRows.length > 0
        ? globalQpRows.reduce((sum, rowPoint) => sum + Number(rowPoint.p.qp_plus || 0), 0) / globalQpRows.length
        : 100;
    const rvRows = valid
      .map((rowPoint) => runValue(rowPoint.p))
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const globalRvAvg = rvRows.length > 0 ? rvRows.reduce((sum, value) => sum + value, 0) / rvRows.length : 0;
    const pvRows = valid.map((rowPoint) => pitchValue(rowPoint.p)).filter((value) => Number.isFinite(value));
    const globalPvAvg = pvRows.length > 0 ? pvRows.reduce((sum, value) => sum + value, 0) / pvRows.length : 0;
    const globalXwobaAvg =
      globalXwobaRows.length > 0
        ? globalXwobaRows.reduce((sum, rowPoint) => sum + Number(rowPoint.p.estimated_woba_using_speedangle || 0), 0) / globalXwobaRows.length
        : 0.35;
    const globalXisoAvg =
      globalXisoRows.length > 0
        ? globalXisoRows.reduce((sum, rowPoint) => sum + Number(rowPoint.p.iso_value || 0), 0) / globalXisoRows.length
        : 0.17;

    const globalSwingRate = valid.length > 0 ? globalSwingCount / valid.length : 0;
    const globalWhiffRate = globalSwingCount > 0 ? globalWhiffCount / globalSwingCount : 0;
    const globalSwStrkRate = valid.length > 0 ? globalWhiffCount / valid.length : 0;
    const globalGbRate = globalInPlayCount > 0 ? globalGbCount / globalInPlayCount : 0;
    const globalContactRate = globalSwingCount > 0 ? (globalSwingCount - globalWhiffCount) / globalSwingCount : 0;
    const shrinkStrength = 8;
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
          const swing = isSwingCall(rowPoint.p);
          const inPlay = isInPlayCall(rowPoint.p);
          const gb = isGroundBall(rowPoint.p);

          sumW += w;
          if (swing) swingW += w;
          if (isWhiffCall(rowPoint.p)) whiffW += w;
          if (inPlay) inPlayW += w;
          if (gb) gbW += w;
          if (inPlay && typeof rowPoint.p.exit_speed === 'number') {
            evWSum += w * rowPoint.p.exit_speed;
            evW += w;
          }
          if (typeof rowPoint.p.qp_plus === 'number' && Number.isFinite(rowPoint.p.qp_plus)) {
            qpWSum += w * rowPoint.p.qp_plus;
            qpW += w;
          }
          const rv = runValue(rowPoint.p);
          if (typeof rv === 'number' && Number.isFinite(rv)) {
            rvWSum += w * rv;
            rvW += w;
          }
          const pv = pitchValue(rowPoint.p);
          if (Number.isFinite(pv)) {
            pvWSum += w * pv;
            pvW += w;
          }
          if (typeof rowPoint.p.estimated_woba_using_speedangle === 'number' && Number.isFinite(rowPoint.p.estimated_woba_using_speedangle)) {
            xwobaWSum += w * rowPoint.p.estimated_woba_using_speedangle;
            xwobaW += w;
          }
          if (typeof rowPoint.p.iso_value === 'number' && Number.isFinite(rowPoint.p.iso_value)) {
            xisoWSum += w * rowPoint.p.iso_value;
            xisoW += w;
          }
        }

        let value = sumW;
        if (metric === 'Whiff Rate') value = 100 * ((whiffW + shrinkStrength * globalWhiffRate) / Math.max(eps, swingW + shrinkStrength));
        if (metric === 'SwStrk%') value = 100 * ((whiffW + shrinkStrength * globalSwStrkRate) / Math.max(eps, sumW + shrinkStrength));
        if (metric === 'GB Rate') value = 100 * ((gbW + shrinkStrength * globalGbRate) / Math.max(eps, inPlayW + shrinkStrength));
        if (metric === 'Contact Rate') value = 100 * (((swingW - whiffW) + shrinkStrength * globalContactRate) / Math.max(eps, swingW + shrinkStrength));
        if (metric === 'Swing Rate') value = 100 * ((swingW + shrinkStrength * globalSwingRate) / Math.max(eps, sumW + shrinkStrength));
        if (metric === 'Exit Velocity') value = (evWSum + shrinkStrength * globalEvAvg) / Math.max(eps, evW + shrinkStrength);
        if (metric === 'QP+') value = (qpWSum + shrinkStrength * globalQpAvg) / Math.max(eps, qpW + shrinkStrength);
        if (metric === 'Run Values') {
          value = ((rvWSum + runValueShrinkStrength * globalRvAvg) / Math.max(eps, sumW + runValueShrinkStrength)) * 100;
        }
        if (metric === 'PV/100') {
          const localPv = (pvWSum + runValueShrinkStrength * globalPvAvg) / Math.max(eps, pvW + runValueShrinkStrength);
          value = (localPv - globalPvAvg) * 100;
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
    const w = 520;
    const h = 360;
    const pad = 4;
    const xMin = -4;
    const xMax = 4;
    const yMin = 0;
    const maxReleaseHeight = Math.max(...summaryPoints.map((p) => p.release_height ?? 0), 0);
    const yMax = Math.max(6, Math.ceil(maxReleaseHeight));
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
    return (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 360 }} onMouseLeave={() => setReleaseHover(null)}>
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
          <text key={`r-x-label-${tick}`} x={px(tick)} y={py(yMin) + 20} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.9)">
            {tick}
          </text>
        ))}
        {yTicks.map((tick) => (
          <text key={`r-y-label-${tick}`} x={px(xMin) - 8} y={py(tick) + 3.5} textAnchor="end" fontSize={10.5} fill="rgba(255,255,255,0.9)">
            {tick}
          </text>
        ))}
        {showPitches
          ? summaryPoints
              .filter((p) => p.release_side !== null && p.release_height !== null)
              .map((p, i) => (
                <circle
                  key={`r-p-${i}`}
                  cx={px(orientX(Number(p.release_side)))}
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
                  onClick={() => openActionModal([p])}
                />
              ))
          : null}
        {showAverages
          ? avgByType
              .filter((p) => p.release_side !== null && p.release_height !== null)
              .map((p) => (
                <circle
                  key={`r-a-${p.pitch_type}`}
                  cx={px(orientX(Number(p.release_side)))}
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
                      text: `${p.pitch_type}\nHeight: ${p.release_height?.toFixed(1) ?? '-'} ft\nSide: ${p.release_side !== null && p.release_side !== undefined ? orientX(Number(p.release_side)).toFixed(1) : '-'} ft\nExtension: ${p.extension?.toFixed(1) ?? '-'} ft`,
                      bg: pitchColors[p.pitch_type] ?? '#0f172a',
                    })
                  }
                  onMouseLeave={() => setReleaseHover(null)}
                  onClick={() => {
                    const matched = summaryPoints.filter((sp) => sp.pitch_type === p.pitch_type);
                    if (matched.length) openActionModal(matched);
                  }}
                />
              ))
          : null}
      </svg>
    );
  }, [summaryPoints, avgByType, releaseView, isPro]);

  const movementSvg = useMemo(() => {
    const w = 520;
    const h = 360;
    const pad = 4;
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
    const showPitches = movementView === 'Averages and Pitches' || movementView === 'Target Shapes and Pitches';
    const showAverages = movementView === 'Averages Only' || movementView === 'Averages and Pitches';
    const showTargets = movementView === 'Target Shapes Only' || movementView === 'Target Shapes and Pitches';
    const ticks = [-20, -10, 0, 10, 20];
    const breakMapFastball: Record<string, { ivb: number; hb: number }> = {
      Cutter: { ivb: -7, hb: 10 },
      Slider: { ivb: -15, hb: 12 },
      Sweeper: { ivb: -16, hb: 22 },
      Curveball: { ivb: -27, hb: 18 },
      ChangeUp: { ivb: -12, hb: -7 },
      Splitter: { ivb: -13, hb: -4 },
    };
    const breakMapSinker: Record<string, { ivb: number; hb: number }> = {
      Cutter: { ivb: 2, hb: 18 },
      Slider: { ivb: -6, hb: 20 },
      Sweeper: { ivb: -7, hb: 30 },
      Curveball: { ivb: -18, hb: 25 },
      ChangeUp: { ivb: -4, hb: 1 },
      Splitter: { ivb: -5, hb: 2 },
    };
    const baseType = breakLines === 'Fastball' || breakLines === 'Sinker' ? breakLines : '';
    const base = avgByType.find((p) => p.pitch_type === baseType);
    const direction = plottedPitcherHand === 'Right' ? -1 : 1;
    const breakRows = base && base.hb !== null && base.ivb !== null
      ? Object.entries(baseType === 'Sinker' ? breakMapSinker : breakMapFastball)
          .filter(([pt]) => avgByType.some((a) => a.pitch_type === pt))
          .map(([pt, sep]) => ({
            pitch_type: pt,
            x1: Number(base.hb),
            y1: Number(base.ivb),
            x2: Number(base.hb) + sep.hb * direction,
            y2: Number(base.ivb) + sep.ivb,
          }))
      : [];
    return (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 360 }} onMouseLeave={() => setMovementHover(null)}>
        {ticks.map((tick) => (
          <line key={`m-x-grid-${tick}`} x1={px(tick)} y1={py(yMin)} x2={px(tick)} y2={py(yMax)} stroke="rgba(255,255,255,0.18)" />
        ))}
        {ticks.map((tick) => (
          <line key={`m-y-grid-${tick}`} x1={px(xMin)} y1={py(tick)} x2={px(xMax)} y2={py(tick)} stroke="rgba(255,255,255,0.18)" />
        ))}
        <line x1={px(xMin)} y1={py(0)} x2={px(xMax)} y2={py(0)} stroke="rgba(255,255,255,0.85)" />
        <line x1={px(0)} y1={py(yMin)} x2={px(0)} y2={py(yMax)} stroke="rgba(255,255,255,0.85)" />
        {ticks.map((tick) => (
          <text key={`m-x-label-${tick}`} x={px(tick)} y={py(yMin) + 20} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.9)">
            {tick}
          </text>
        ))}
        {ticks.map((tick) => (
          <text key={`m-y-label-${tick}`} x={px(xMin) - 8} y={py(tick) + 3.5} textAnchor="end" fontSize={10.5} fill="rgba(255,255,255,0.9)">
            {tick}
          </text>
        ))}
        {showPitches
          ? summaryPoints
              .filter((p) => p.hb !== null && p.ivb !== null)
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
                  onClick={() => openActionModal([p])}
                />
              ))
          : null}
        {showAverages
          ? avgByType
              .filter((p) => p.hb !== null && p.ivb !== null)
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
                      text: `${p.pitch_type}\nVelo: ${p.velo?.toFixed(1) ?? '-'} mph\nIVB: ${p.ivb?.toFixed(1) ?? '-'} in\nHB: ${p.hb?.toFixed(1) ?? '-'} in\nStuff+: ${p.stuff_plus?.toFixed(1) ?? '-'}`,
                      bg: pitchColors[p.pitch_type] ?? '#0f172a',
                    })
                  }
                  onMouseLeave={() => setMovementHover(null)}
                  onClick={() => {
                    const matched = summaryPoints.filter((sp) => sp.pitch_type === p.pitch_type);
                    if (matched.length) openActionModal(matched);
                  }}
                />
              ))
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
                      const matched = summaryPoints.filter((sp) => sp.pitch_type === p.pitch_type);
                      if (matched.length) openActionModal(matched);
                    }}
                  />
                </g>
                );
              })
          : null}
      </svg>
    );
  }, [summaryPoints, avgByType, movementView, breakLines, plottedPitcherHand, targetShapes]);

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
    const isRvLikeMetric = heatMetricView === 'Run Values' || heatMetricView === 'PV/100';
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
        onClick: () => (point ? openActionModal([point]) : undefined),
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
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 360 }} onMouseLeave={() => setLocationHover(null)}>
        <defs>
          <clipPath id="location-zoom-clip">
            <rect x={0} y={0} width={w} height={h} />
          </clipPath>
          <filter id="location-heat-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.1" />
          </filter>
          <filter id="location-heat-blur-rv" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.1" />
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
                  const radius = Math.max(2.0, c.w * scale * 1.45);
                  const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                  let fill = 'rgba(255,255,255,0.12)';
                  if (locationView === 'Frequency') {
                    fill = sequentialColor(c.value, minVal, maxVal);
                  } else if (isRvLikeMetric) {
                    const rvClamped = Math.max(rvMin, Math.min(rvMax, c.value));
                    fill = divergingColor(isPvMetric ? rvClamped : -rvClamped, rvMin, 0, rvMax);
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
                  if (densityNorm < 0.16) return null;
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
                  fill = divergingColor(isPvMetric ? rvClamped : -rvClamped, rvMin, 0, rvMax);
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
                if (densityNorm < 0.16) return null;
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
                        text: `${locationView}: ${c.value.toFixed(locationView === 'xWOBA' || locationView === 'xISO' ? 3 : (isRvLikeMetric || locationView === 'Exit Velocity' ? 2 : 1))}`,
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
          ? summaryPoints
              .filter((p) => p.plate_side !== null && p.plate_height !== null)
              .map((p, i) => {
                const x = px(orientX(Number(p.plate_side)));
                const y = py(Number(p.plate_height));
                const color = pitchColors[p.pitch_type] ?? '#9ca3af';
                const result = resultShape(p.pitch_call, p.play_result);
                return glyph(result, x, y, color, `loc-${i}`, tooltipHtml(p), p);
              })
          : null}
        </g>
      </svg>
    );
  }, [summaryPoints, summaryHeatmapPoints, locationView, isPro, selectedPitchTypes]);

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
      { value: 'Run Values', label: 'Run Values' },
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
    const isRvLikeMetric = heatMetricView === 'Run Values' || heatMetricView === 'PV/100';
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
        onClick: () => (point ? openActionModal([point]) : undefined),
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
          <filter id="location-heat-blur-heatmaps-page" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.1" />
          </filter>
          <filter id="location-heat-blur-rv-heatmaps-page" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.1" />
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
                  const radius = Math.max(2.0, c.w * scale * 1.45);
                  const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                  let fill = 'rgba(255,255,255,0.12)';
                  if (heatmapDisplayView === 'Frequency') {
                    fill = sequentialColor(c.value, minVal, maxVal);
                  } else if (heatmapDisplayView === 'QP+') {
                    fill = divergingColor(c.value, 0, 100, 200);
                  } else if (isRvLikeMetric) {
                    const rvClamped = Math.max(rvMin, Math.min(rvMax, c.value));
                    fill = divergingColor(isPvMetric ? rvClamped : -rvClamped, rvMin, 0, rvMax);
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
                  if (densityNorm < 0.16) return null;
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
                  fill = divergingColor(isPvMetric ? rvClamped : -rvClamped, rvMin, 0, rvMax);
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
                if (densityNorm < 0.16) return null;
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
                        text: `${heatmapDisplayView}: ${c.value.toFixed(heatmapDisplayView === 'xWOBA' || heatmapDisplayView === 'xISO' ? 3 : (isRvLikeMetric || heatmapDisplayView === 'Exit Velocity' || heatmapDisplayView === 'QP+' ? 2 : 1))}`,
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
            ? summaryPoints
                .filter((p) => p.plate_side !== null && p.plate_height !== null)
                .map((p, i) => {
                  const x = px(orientX(Number(p.plate_side)));
                  const y = py(Number(p.plate_height));
                  const color = pitchColors[p.pitch_type] ?? '#9ca3af';
                  const result = resultShape(p.pitch_call, p.play_result);
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
  }, [summaryPoints, summaryHeatmapPoints, heatmapDisplayView, canRenderQpHeatmap, qpSelectedPitchType, qpSelectedCountBucket, qpSelectedHand, isPro, selectedPitchTypes]);

  const tableColorMode = useMemo(() => {
    if (!tableMode) return '';
    if (tableMode === 'Custom') return 'Custom';
    return tableMode;
  }, [tableMode]);

  const shouldColorTable = useMemo(
    () => enableTableColors && ['Process', 'Live', 'Results', 'Bullpen', 'Custom'].includes(tableColorMode),
    [enableTableColors, tableColorMode]
  );

  const colorColumnsByMode: Record<string, string[]> = {
    Process: ['InZone%', 'Comp%', 'Strike%', 'Swing%', 'FPS%', 'Early%', 'Ahead%', 'E+A%', '1-1W%', 'QP%', 'Ctrl+', 'QP+', 'Stuff+', 'Pitching+', 'RV/100', 'PV/100', 'ERA', 'FIP', 'xFIP'],
    Live: ['InZone%', 'Strike%', 'FPS%', 'E+A%', 'QP+', 'Ctrl+', 'Pitching+', 'K%', 'BB%', 'Whiff%', 'ERA', 'FIP', 'xFIP'],
    Results: ['Whiff%', 'K%', 'BB%', 'CSW%', 'GB%', 'Barrel%', 'EV', 'ERA', 'FIP', 'xFIP'],
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
      'PV/100',
      'K%',
      'BB%',
      'Whiff%',
      'CSW%',
      'GB%',
      'Barrel%',
      'EV',
      'ERA',
      'FIP',
      'xFIP',
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
  const tableModeOptions = useMemo(
    () =>
      (isLeague
        ? [
            { value: 'Stuff', label: 'Stuff' },
            { value: 'Live', label: 'Live' },
            { value: 'Process', label: 'Process' },
            { value: 'Results', label: 'Results' },
            { value: 'Bullpen', label: 'Bullpen' },
            { value: 'Usage', label: 'Usage' },
            { value: 'Raw Data', label: 'Raw Data' },
            { value: 'Batted Ball Data', label: 'Batted Ball Data' },
          ]
        : [
            { value: 'Stuff', label: 'Stuff' },
            { value: 'Process', label: 'Process' },
            { value: 'Results', label: 'Results' },
            { value: 'Bullpen', label: 'Bullpen' },
            { value: 'Live', label: 'Live' },
            { value: 'Usage', label: 'Usage' },
            { value: 'Raw Data', label: 'Raw Data' },
            { value: 'Batted Ball Data', label: 'Batted Ball Data' },
          ]
      ).concat([...customTables.map((item) => ({ value: `custom_saved:${item.id}`, label: item.name })), { value: 'Custom', label: 'Custom' }]),
    [customTables, isLeague]
  );
  const splitByOptions = useMemo(
    () =>
      isLeague
        ? [
            { value: 'Pitch Types', label: 'Pitch Types' },
            { value: 'Pitcher', label: 'Pitcher' },
            { value: 'Pitcher Hand', label: 'Pitcher Hand' },
            { value: 'Batter Hand', label: 'Batter Hand' },
            { value: 'Count', label: 'Count' },
            { value: 'After Count', label: 'After Count' },
            { value: 'Zone Location', label: 'Zone Location' },
            { value: 'Times Through Order', label: 'Times Through Order' },
            { value: 'Inning', label: 'Inning of Appearance' },
            { value: 'Pitch Count', label: 'Pitch Count' },
            { value: 'Velocity', label: 'Velocity' },
            { value: 'IVB', label: 'IVB' },
            { value: 'HB', label: 'HB' },
            { value: 'Batter', label: 'Batter' },
            { value: 'Catcher', label: 'Catcher' },
            { value: 'Pitcher Team', label: 'Team' },
          ]
        : [
            { value: 'Pitch Types', label: 'Pitch Types' },
            { value: 'Batter Hand', label: 'Batter Hand' },
            { value: 'Count', label: 'Count' },
            { value: 'After Count', label: 'After Count' },
            { value: 'Zone Location', label: 'Zone Location' },
            { value: 'Times Through Order', label: 'Times Through Order' },
            { value: 'Inning', label: 'Inning of Appearance' },
            { value: 'Pitch Count', label: 'Pitch Count' },
            { value: 'Velocity', label: 'Velocity' },
            { value: 'IVB', label: 'IVB' },
            { value: 'HB', label: 'HB' },
            { value: 'Batter', label: 'Batter' },
            { value: 'Catcher', label: 'Catcher' },
          ],
    [isLeague]
  );
  const tableModeSelectValue = useMemo(
    () => (tableMode === 'Custom' && selectedCustomTableId ? `custom_saved:${selectedCustomTableId}` : tableMode),
    [tableMode, selectedCustomTableId]
  );
  const displayedTableColumns = useMemo(() => {
    const splitColumn = overview?.table_columns?.[0] ?? 'Pitch';
    if (tableMode === 'Custom') {
      return customTableColumns.length ? [splitColumn, ...customTableColumns] : [splitColumn];
    }
    return overview?.table_columns?.length
      ? overview.table_columns
      : ['Pitch Type', 'Pitches', 'Usage %', 'Avg Velo', 'Max Velo', 'Avg Spin', 'Avg IVB', 'Avg HB', 'Stuff+'];
  }, [overview?.table_columns, tableMode, customTableColumns]);
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
  const tableRowsWithPv = useMemo(() => {
    const rows = overview?.table_rows ?? [];
    const rowPitchesByKey = overview?.row_pitches_by_key ?? {};
    const fallbackAllPitches = summaryPoints ?? [];
    if (!rows.length) return rows;
    return rows.map((row) => {
      const currentPv = row['PV/100'];
      if (currentPv !== null && currentPv !== undefined && currentPv !== '') return row;
      const splitKey = String(row[splitColName] ?? '').trim();
      if (!splitKey) return row;
      const rowPitches =
        rowPitchesByKey[splitKey] ??
        (splitKey.toLowerCase() === 'all' ? fallbackAllPitches : []);
      if (!rowPitches.length) return row;
      let pvSum = 0;
      let pvN = 0;
      for (const pitch of rowPitches) {
        const pv = calcPitchValue(pitch as Parameters<typeof calcPitchValue>[0]);
        if (!Number.isFinite(pv)) continue;
        pvSum += pv;
        pvN += 1;
      }
      if (pvN <= 0) return row;
      return { ...row, 'PV/100': Number(((pvSum / pvN) * 100).toFixed(1)) };
    });
  }, [overview?.table_rows, overview?.row_pitches_by_key, splitColName, summaryPoints]);
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
    return getProTeamLogoUrl(teamCode) || '';
  }, [isPro, dashboardPage, selectedSinglePitcher, latestTeamByPitcher, filterTeamByPitcher, teamType]);
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

          {loadingFilters ? <p>Loading filters...</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}

          {filters ? (
            <>
              <div className="portal-form-grid">
                <label>
                  Start Date
                  <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </label>
                <label>
                  End Date
                  <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
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
                {isPro ? (
                  <label>
                    Level
                    <SearchableSingleSelect
                      options={toOptions(filters.level_options ?? ['All', 'MLB', 'AAA'])}
                      value={level}
                      onChange={setLevel}
                      placeholder="MLB"
                    />
                  </label>
                ) : (
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
                )}
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
                  Pitchers
                  <SearchableMultiSelect options={pitcherOptions} values={selectedPitchers} onChange={setSelectedPitchers} />
                </label>
                <label>
                  Hitters
                  <SearchableMultiSelect options={hitterOptions} values={selectedHitters} onChange={setSelectedHitters} />
                </label>
                <label>
                  Pitch Type
                  <SearchableMultiSelect
                    options={pitchTypeOptions}
                    values={selectedPitchTypes}
                    onChange={setSelectedPitchTypes}
                  />
                </label>
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
                  Pitch Results
                  <SearchableMultiSelect
                    options={pitchResultOptions}
                    values={selectedPitchResults}
                    onChange={setSelectedPitchResults}
                  />
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
              </div>

              <div className="portal-form-grid" style={{ marginTop: '0.8rem' }}>
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
                  <option value="AB Report">AB Report</option>
                  {canShowLeagueHeavyPages ? <option value="Velocity">Velocity</option> : null}
                  {canShowLeagueHeavyPages ? <option value="Trend">Trend</option> : null}
                  <option value="HeatMaps">HeatMaps</option>
                  {canShowLeagueHeavyPages ? <option value="QP Locations">QP Locations</option> : null}
                  {canShowVeloManualEntry ? <option value="Velo Manual Entry">Velo Manual Entry</option> : null}
                </select>
              </label>
            ) : (
              <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
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
                {canShowLeagueHeavyPages ? (
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
              </div>
            )}
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
              <div className="portal-admin-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(260px, 1fr))', marginBottom: '1rem' }}>
                <article className="portal-day-card">
                  <h4 style={{ margin: '0 0 0.45rem 0', textAlign: 'center' }}>Release</h4>
                  <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', minHeight: 40, marginBottom: 8 }}>
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
                <article className="portal-day-card">
                  <h4 style={{ margin: '0 0 0.45rem 0', textAlign: 'center' }}>Movement</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 40, marginBottom: 8 }}>
                    <SearchableSingleSelect
                      options={[
                        { value: 'Averages Only', label: 'Averages Only' },
                        { value: 'Averages and Pitches', label: 'Averages and Pitches' },
                        { value: 'Target Shapes Only', label: 'Target Shapes Only' },
                        { value: 'Target Shapes and Pitches', label: 'Target Shapes and Pitches' },
                      ]}
                      value={movementView}
                      onChange={setMovementView}
                      placeholder="Averages and Pitches"
                    />
                    <button type="button" className="btn btn-ghost" onClick={() => setShowTargetSettings(true)}>
                      Target Settings
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
                  </div>
                </article>
                <article className="portal-day-card">
                  <h4 style={{ margin: '0 0 0.45rem 0', textAlign: 'center' }}>HeatMaps</h4>
                  <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', minHeight: 40, marginBottom: 8 }}>
                    <SearchableSingleSelect
                      options={summaryHeatmapOptions}
                      value={locationView}
                      onChange={setLocationView}
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
                            background: 'linear-gradient(90deg, rgb(32,74,135) 0%, rgb(246,248,248) 50%, rgb(176,11,52) 100%)',
                          }}
                        />
                        <div style={{ width: 220, display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'rgba(255,255,255,0.92)' }}>
                          <span>Least</span>
                          <span>Most</span>
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

              <div className="portal-table-wrap" style={{ marginTop: '1rem', ...(isLeaderboardPage ? { maxHeight: '68vh', overflowY: 'auto' as const } : {}) }}>
                <div
                  className="portal-form-grid"
                  style={{
                    marginBottom: '0.8rem',
                    gridTemplateColumns: isLeaderboardPage
                      ? (isLeague ? 'repeat(2, minmax(160px, 260px))' : 'minmax(160px, 260px)')
                      : 'repeat(2, minmax(160px, 260px))',
                  }}
                >
                  <label>
                    Tables
                    <SearchableSingleSelect
                      options={tableModeOptions}
                      value={tableModeSelectValue}
                      onChange={(next) => {
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
                      }}
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
                        onChange={(next) => setLeaderboardViewBy(next as 'Player' | 'Team')}
                        placeholder="Player"
                      />
                    </label>
                  ) : null}
                  {!isLeaderboardPage ? (
                    <label>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span>Split By</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                          <span>Color Code</span>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: '0.15rem 0.55rem', minHeight: 'unset' }}
                            onClick={() => setEnableTableColors((current) => !current)}
                          >
                            {enableTableColors ? 'ON' : 'OFF'}
                          </button>
                        </span>
                      </span>
                      <SearchableSingleSelect
                        options={splitByOptions}
                        value={splitBy}
                        onChange={setSplitBy}
                        placeholder="Pitch Types"
                      />
                    </label>
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
                            ...customTables.map((item) => ({ value: String(item.id), label: item.name })),
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
                <table className="portal-table">
                  <thead>
                    <tr>
                      {isLeaderboardPage ? <th style={{ textAlign: 'center', position: isLeaderboardPage ? 'sticky' : undefined, top: isLeaderboardPage ? 0 : undefined, zIndex: isLeaderboardPage ? 3 : undefined, background: isLeaderboardPage ? 'rgba(7,9,14,0.98)' : undefined }}>Rank</th> : null}
                      {displayedTableColumns.map((column, colIndex) => {
                        const isSortable = true;
                        const activeSort = leaderboardSortColumn === column;
                        const label = isLeaderboardPage && colIndex === 0 ? (leaderboardViewBy === 'Team' ? 'Team' : 'Player') : column;
                        return (
                          <th
                            key={column}
                            style={{ textAlign: 'center', cursor: isSortable ? 'pointer' : 'default', position: isLeaderboardPage ? 'sticky' : undefined, top: isLeaderboardPage ? 0 : undefined, zIndex: isLeaderboardPage ? 3 : undefined, background: isLeaderboardPage ? 'rgba(7,9,14,0.98)' : undefined }}
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
                    {leaderboardRows?.length
                      ? (() => {
                          let leaderboardRankCounter = 0;
                          return leaderboardRows.map((row, idx) => {
                          const rowKey = String(row[displayedTableColumns?.[0] ?? 'row'] ?? 'Unknown');
                          const rowPitches = overview.row_pitches_by_key?.[rowKey] ?? [];
                          const isAllRow = isLeaderboardPage && String(row[displayedTableColumns?.[0] ?? ''] ?? '').trim().toLowerCase() === 'all';
                          const rankValue = isAllRow ? '' : String(++leaderboardRankCounter);
                          return (
                          <tr
                            key={`${String(row[displayedTableColumns?.[0] ?? 'row'] ?? 'row')}-${idx}`}
                            style={isAllRow ? { background: 'rgba(255,255,255,0.12)', fontWeight: 700 } : undefined}
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
                                  cursor:
                                    (column === '#' && rowPitches.length)
                                    || (isLeaderboardPage && column === leaderboardPrimaryColumn && !isAllRow)
                                      ? 'pointer'
                                      : undefined,
                                  textDecoration:
                                    (column === '#' && rowPitches.length)
                                    || (isLeaderboardPage && column === leaderboardPrimaryColumn && !isAllRow)
                                      ? 'underline'
                                      : undefined,
                                }}
                                onClick={
                                  column === '#' && rowPitches.length
                                    ? () => openActionModal(rowPitches)
                                    : (isLeaderboardPage && column === leaderboardPrimaryColumn && !isAllRow)
                                      ? () => applyLeaderboardDrilldown(row[column], leaderboardViewBy)
                                      : undefined
                                }
                              >
                                {(() => {
                                  const cellStyle = getTableCellStyle(row, column);
                                  const rawValue = row[column] ?? '-';
                                  const value =
                                    isLeaderboardPage && column === displayedTableColumns[0] && typeof rawValue === 'string'
                                      ? (() => {
                                          const formatted = formatNameFirstLast(rawValue);
                                          if (leaderboardViewBy !== 'Player') {
                                            if (!isPro) return formatted;
                                            const teamCode = inferProTeamCode(rawValue);
                                            if (!teamCode || String(rawValue ?? '').trim().toLowerCase() === 'all') return formatted;
                                            const teamLogo = getProTeamLogoUrl(teamCode);
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
                                          const teamCode =
                                            latestTeamByPitcher[key] ??
                                            latestTeamByPitcher[keyNorm] ??
                                            latestTeamByPitcher[formatted] ??
                                            latestTeamByPitcher[formattedNorm] ??
                                            filterTeamByPitcher[key] ??
                                            filterTeamByPitcher[keyNorm] ??
                                            filterTeamByPitcher[formatted] ??
                                            filterTeamByPitcher[formattedNorm];
                                          if (!teamCode || String(rawValue ?? '').trim().toLowerCase() === 'all') return formatted;
                                          const logoUrl = isPro ? getProTeamLogoUrl(teamCode) : '';
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
                                    typeof value === 'string' || typeof value === 'number' || value === null || value === undefined
                                      ? formatTableDisplayValue(column, value)
                                      : value;
                                  if (!cellStyle) return displayValue;
                                  return (
                                    <span
                                      style={{
                                        ...cellStyle,
                                        padding: '2px 4px',
                                        borderRadius: 3,
                                        display: 'inline-block',
                                        width: '100%',
                                        textAlign: 'center',
                                      }}
                                    >
                                      {displayValue}
                                    </span>
                                  );
                                })()}
                              </td>
                            ))}
                          </tr>
                        );
                        });
                        })()
                      : overview.pitch_types.map((row) => (
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
              </div>
                </>
              ) : null}
            </>
          ) : dashboardPage === 'AB Report' ? (
            <>
              {selectedSinglePitcher ? (
                <h3>{`${formatNameFirstLast(selectedSinglePitcher)} | ${
                  abReport?.selected_game_date ? formatShortDate(abReport.selected_game_date) : '-'
                }`}</h3>
              ) : (
                <h3>AB Report</h3>
              )}
              {!selectedSinglePitcher ? (
                <p className="portal-muted-text">Select a single pitcher in the sidebar to view AB Report.</p>
              ) : null}
              {loadingAbReport ? <p>Loading AB report...</p> : null}
              {selectedSinglePitcher && abError ? <p className="auth-error">{abError}</p> : null}
              {selectedSinglePitcher && abReport ? (
                <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0,1fr)', gap: 14 }}>
                  <aside className="portal-day-card portal-ab-sidebar">
                    <label>
                      Select Game
                      <SearchableSingleSelect
                        options={abReport.available_games.map((game) => ({
                          value: game.game_key,
                          label:
                            game.date && game.game_key === game.date
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
                      abReport.pa_groups.map((group) => (
                        <section key={`ab-batter-${group.batter}`} style={{ marginBottom: 16 }}>
                          <h4 style={{ marginBottom: 8 }}>{formatNameFirstLast(group.batter)}</h4>
                          <div className="portal-admin-grid portal-ab-pa-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(300px, 1fr))' }}>
                            {group.pas.map((pa) => (
                              <article key={`ab-pa-${group.batter}-${pa.pa_index}`} className="portal-day-card portal-ab-pa-card">
                                <div style={{ textAlign: 'center', marginBottom: 4, fontWeight: 700 }}>{`PA #${pa.pa_index}`}</div>
                                <AbPaChart
                                  pitches={pa.pitches}
                                  resultLabel={pa.result_label}
                                  onPitchClick={(pitch) => openActionModal([pitch])}
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
                                              style={{ textAlign: 'center', cursor: 'pointer' }}
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
                      ))
                    ) : (
                      <p className="portal-muted-text">No completed plate appearances for the selected game.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </>
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
                    const pctMetrics = new Set(['InZone%', 'Comp%', 'Strike%', 'Swing%', 'FPS%', 'Early%', 'Ahead%', 'E+A%', '1-1W%', 'QP%', 'Whiff%', 'CSW%', 'K%', 'BB%', 'GB%', 'Barrel%']);
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
                                        text: `${!isPro ? `${entry.session}\n` : ''}${formatShortDate(row.date)}\n${trendMetric}: ${row.value.toFixed(valueDigits)}${suffix}\nPitches: ${row.pitches ?? row.rowPitches.length}`,
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
                            background: 'linear-gradient(90deg, rgb(32,74,135) 0%, rgb(246,248,248) 50%, rgb(176,11,52) 100%)',
                          }}
                        />
                        <div style={{ width: 260, display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'rgba(255,255,255,0.92)' }}>
                          <span>Least</span>
                          <span>Most</span>
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
                        <input type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)} />
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
                                    style={{ cursor: 'pointer' }}
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
                                <td>{entry.ball_weight_oz.toFixed(2)}</td>
                                <td>{entry.velocity_mph.toFixed(1)}</td>
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
                      <input type="date" value={manualDateStart} onChange={(event) => setManualDateStart(event.target.value)} />
                    </label>
                    <label>
                      Date End
                      <input type="date" value={manualDateEnd} onChange={(event) => setManualDateEnd(event.target.value)} />
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
                      <article className="portal-day-card"><div className="portal-muted-text">Average Velo</div><div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{manualKpis?.avg?.toFixed(1) ?? '-'}</div></article>
                      <article className="portal-day-card"><div className="portal-muted-text">Peak Velo</div><div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{manualKpis?.peak?.toFixed(1) ?? '-'}</div></article>
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
                                                      `Velo: ${point.mean.toFixed(1)} mph`,
                                                      `Weight: ${point.weightAvg !== null ? point.weightAvg.toFixed(2) : '-'} oz`,
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
                                                      `Velo: ${point.peak.toFixed(1)} mph`,
                                                      `Weight: ${point.weightAvg !== null ? point.weightAvg.toFixed(2) : '-'} oz`,
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
                                        style={{ cursor: 'pointer' }}
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
                                    <td>{entry.ball_weight_oz.toFixed(2)}</td>
                                    <td>{entry.velocity_mph.toFixed(1)}</td>
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
                                    const x = px(orientX(Number(point.plate_side)));
                                    const y = py(Number(point.plate_height));
                                    const color = pitchColors[point.pitch_type] ?? '#9ca3af';
                                    const result = resultShape(point.pitch_call, point.play_result);
                                    const hoverText = `${tooltipHtml(point)}\nQP+: ${fmtNum(point.qp_plus, 1)}`;
                                    const hoverProps = {
                                      onMouseMove: (event: { clientX: number; clientY: number }) =>
                                        setQpLocationsHover({ x: event.clientX, y: event.clientY, text: hoverText, bg: color }),
                                      onMouseLeave: () => setQpLocationsHover(null),
                                      onClick: () => openActionModal([point]),
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
                                  onClick={() => openActionModal([p])}
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
        <div className="portal-modal-backdrop" onClick={() => setActionMode(null)}>
          <div
            className="portal-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Pitch action modal"
            style={{
              width: 'min(1080px, 92vw)',
              maxHeight: '86vh',
              overflow: 'auto',
              background: '#f3f4f6',
              color: '#1f2937',
              border: '1px solid #d1d5db',
              padding: '0.85rem',
              gap: '0.65rem',
            }}
          >
            {actionMode === 'edit' && canUsePitchEdits ? (
              <>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#1f2937' }}>
                  Edit Pitch Type for {actionPitchCount} pitch(es)
                </h3>
                <div style={{ borderTop: '1px solid #d1d5db', margin: '0.2rem -1.1rem 0', paddingTop: '1rem', paddingInline: '1.1rem' }}>
                  <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(260px, 1fr))', gap: '1rem 1.4rem' }}>
                    <label style={{ color: '#374151', fontWeight: 700, fontSize: '0.9rem' }}>
                      NEW PITCH TYPE:
                      <SearchableSingleSelect
                        options={pitchEditPitchTypeOptions}
                        value={editPitchType}
                        onChange={setEditPitchType}
                        placeholder="Pitch Type"
                        theme="light"
                      />
                    </label>
                    <label style={{ color: '#374151', fontWeight: 700, fontSize: '0.9rem' }}>
                      ASSIGN TO PITCHER:
                      <SearchableSingleSelect
                        options={pitchEditPitcherOptions}
                        value={editPitcher}
                        onChange={setEditPitcher}
                        placeholder="Pitcher"
                        theme="light"
                      />
                    </label>
                  </div>
                  <div style={{ marginTop: '1rem', borderTop: '1px solid #d1d5db', paddingTop: '1rem' }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#111827', marginBottom: 8 }}>Selected Pitches:</div>
                    <div style={{ display: 'grid', gap: 4, maxHeight: 180, overflow: 'auto', fontSize: '0.95rem', color: '#1f2937' }}>
                      {actionPitches.slice(0, 80).map((pitch, idx) => (
                        <div key={`sel-${pitch.pitch_event_id ?? idx}`}>
                          Pitch {idx + 1}: {pitch.pitch_type} - {formatShortDate(pitch.session_date ?? '')} ({fmtNum(pitch.velo, 1)} mph, HB: {fmtNum(pitch.hb, 1)}, IVB: {fmtNum(pitch.ivb, 1)})
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="portal-choice-line-actions" style={{ justifyContent: 'space-between', marginTop: '0.4rem' }}>
                  <button type="button" className="btn btn-ghost" style={{ background: '#fff', color: '#4b5563', borderColor: '#cbd5e1' }} onClick={() => setActionMode(null)}>
                    Cancel
                  </button>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" className="btn btn-ghost" style={{ background: '#fff', color: '#9ca3af', borderColor: '#d1d5db' }} disabled>
                      Delete Selected Pitches
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ background: '#fff', color: '#374151', border: '1px solid #cbd5e1' }}
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: '1rem' }}>
                  <div>
                    <button type="button" className="btn btn-ghost" style={{ background: '#fff', color: '#475569', borderColor: '#cbd5e1' }} disabled={actionIndex <= 0} onClick={() => setActionIndex((i) => Math.max(0, i - 1))}>
                      &lt; Prev
                    </button>
                  </div>
                  <div style={{ justifySelf: 'center', fontWeight: 700, color: '#4b5563' }}>
                    {actionIndex + 1} of {actionPitchCount}
                  </div>
                  <div style={{ justifySelf: 'end' }}>
                    <button type="button" className="btn btn-ghost" style={{ background: '#fff', color: '#475569', borderColor: '#cbd5e1' }} disabled={actionIndex >= actionPitchCount - 1} onClick={() => setActionIndex((i) => Math.min(actionPitchCount - 1, i + 1))}>
                      Next &gt;
                    </button>
                  </div>
                </div>

                {actionMode === 'video' ? (
                  <div style={{ display: 'grid', justifyItems: 'center', gap: 10 }}>
                    {actionSideBySide ? (
                      <div style={{ width: 'min(980px, 100%)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#475569', marginBottom: 4 }}>Left Video Pitch</div>
                          <SearchableSingleSelect
                            options={comparePitchOptions}
                            value={actionLeftPitchKey}
                            onChange={setActionLeftPitchKey}
                            placeholder="Select Left Pitch"
                            theme="light"
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#475569', marginBottom: 4 }}>Right Video Pitch</div>
                          <SearchableSingleSelect
                            options={comparePitchOptions.filter((option) => option.value !== actionLeftPitchKey)}
                            value={actionRightPitchKey}
                            onChange={setActionRightPitchKey}
                            placeholder="Select Right Pitch"
                            theme="light"
                          />
                        </div>
                      </div>
                    ) : null}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                    <button type="button" className="btn btn-ghost" style={{ background: '#fff', color: '#475569', borderColor: '#cbd5e1' }} onClick={() => setActionSideBySide((v) => !v)}>
                      {actionSideBySide ? 'Single View' : 'Side-by-Side'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ background: '#fff', color: '#475569', borderColor: '#cbd5e1' }}
                      onClick={() =>
                        downloadUrl(
                          (actionSideBySide ? selectedLeftUrls[0] : actionVideoUrls[0]) || '',
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
                    </div>
                  </div>
                ) : null}

                <div
                  ref={actionViewRef}
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      actionMode === 'video' && actionSideBySide ? 'minmax(980px, 1fr)' : 'minmax(520px,1fr) 250px',
                    gap: '1rem',
                    alignItems: 'start',
                  }}
                >
                  <div style={{ display: 'grid', gap: '0.65rem' }}>
                    {actionMode === 'video' ? (
                      <div
                        style={{
                          background: '#000',
                          borderRadius: 10,
                          border: '1px solid #111827',
                          minHeight: 560,
                          display: 'grid',
                          placeItems: 'center',
                          overflow: 'hidden',
                        }}
                      >
                        {hasActionVideo ? (
                          actionSideBySide ? (
                            selectedLeftUrls.length >= 1 ? (
                              <div style={{ width: '100%', height: '100%', display: 'grid', gridTemplateColumns: '190px 1fr 1fr 190px', gap: 10, padding: 10 }}>
                                {selectedLeftPitch ? renderVideoPitchMetrics(selectedLeftPitch, 'left', true) : <div />}
                                <video
                                  key={`left-${actionLeftPitchKey}-${selectedLeftUrls[0] ?? 'none'}`}
                                  ref={leftCompareVideoRef}
                                  style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                                  onLoadedMetadata={updateSyncedDuration}
                                  onPause={() => setActionVideoPlaying(false)}
                                  onPlay={() => setActionVideoPlaying(true)}
                                >
                                  <source src={selectedLeftUrls[0]} />
                                </video>
                                {selectedRightPitch ? (
                                  selectedRightUrls.length ? (
                                    <>
                                      <video
                                        key={`right-${actionRightPitchKey}-${selectedRightUrls[0] ?? 'none'}`}
                                        ref={rightCompareVideoRef}
                                        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                                        onLoadedMetadata={updateSyncedDuration}
                                        onPause={() => setActionVideoPlaying(false)}
                                        onPlay={() => setActionVideoPlaying(true)}
                                      >
                                        <source src={selectedRightUrls[0]} />
                                      </video>
                                      {renderVideoPitchMetrics(selectedRightPitch, 'right', true)}
                                    </>
                                  ) : (
                                    <>
                                      <div style={{ color: '#f8fafc', display: 'grid', placeItems: 'center', textAlign: 'center', fontWeight: 700 }}>
                                        Selected compare pitch has no video.
                                      </div>
                                      {renderVideoPitchMetrics(selectedRightPitch, 'right', true)}
                                    </>
                                  )
                                ) : (
                                  <>
                                    <div style={{ color: '#f8fafc', display: 'grid', placeItems: 'center', textAlign: 'center', fontWeight: 700 }}>
                                      Select a second pitch to compare.
                                    </div>
                                    <div />
                                  </>
                                )}
                              </div>
                            ) : (
                              <div style={{ color: '#f8fafc', fontSize: '1.05rem', fontWeight: 700, textAlign: 'center' }}>
                                Selected left pitch has no video.
                              </div>
                            )
                          ) : (
                            <video controls autoPlay style={{ width: '100%', height: '100%', objectFit: 'contain' }}>
                              <source src={actionVideoUrls[0]} />
                            </video>
                          )
                        ) : (
                          <div style={{ color: '#f8fafc', fontSize: '2rem', fontWeight: 700 }}>No video available</div>
                        )}
                      </div>
                    ) : null}

                    {actionMode === 'video' && actionSideBySide ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ background: '#fff', color: '#1f2937', borderColor: '#cbd5e1' }}
                          onClick={syncPlayPauseVideos}
                          disabled={!selectedLeftUrls.length || !selectedRightUrls.length}
                        >
                          {actionVideoPlaying ? 'Pause' : 'Play'}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={actionVideoDuration || 0}
                          step={0.01}
                          value={Math.min(actionVideoTime, actionVideoDuration || actionVideoTime)}
                          onChange={(event) => syncSeekVideos(Number(event.target.value))}
                          disabled={!actionVideoDuration}
                          style={{ flex: 1 }}
                        />
                      </div>
                    ) : null}

                    {actionMode === 'spin' ? (
                      <>
                        <div
                          style={{
                            minHeight: 470,
                            height: 'min(64vh, 540px)',
                            borderRadius: 10,
                            border: '1px solid #d1d5db',
                            background: '#f8fafc',
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
                          <button type="button" className="btn btn-ghost" style={{ background: '#fff', color: '#1f2937', borderColor: '#cbd5e1' }} onClick={() => setActionIsPlaying(true)}>
                            Play
                          </button>
                          <button type="button" className="btn btn-ghost" style={{ background: '#fff', color: '#1f2937', borderColor: '#cbd5e1' }} onClick={() => setActionIsPlaying(false)}>
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
                        <div style={{ border: '1px solid #d1d5db', borderRadius: 10, background: '#fff', padding: '0.7rem', color: '#374151', fontSize: '0.86rem' }}>
                          Dashed gold arrow: Release tilt direction (rTilt) | Solid green arrow: Break tilt direction (bTilt)
                        </div>
                      </>
                    ) : null}
                  </div>

                  {!(actionMode === 'video' && actionSideBySide) ? (
                  <div style={{ display: 'grid', gap: '0.5rem', color: '#111827', fontWeight: 700, fontSize: '0.98rem' }}>
                    <div>
                      <div>{formatNameFirstLast(currentActionPitch.pitcher)}</div>
                      <div>{actionDateLabel}</div>
                    </div>
                    <hr style={{ width: '100%', borderColor: '#d1d5db' }} />
                    <div>{currentActionPitch.pitch_type}</div>
                    <div>{fmtNum(currentActionPitch.velo, 1)} mph</div>
                    <div>IVB: {fmtNum(currentActionPitch.ivb, 1)}"</div>
                    <div>HB: {fmtNum(currentActionPitch.hb, 1)}"</div>
                    <div>{fmtNum(currentActionPitch.spin, 0)} rpm</div>
                    <div>
                      SpinEff:{' '}
                      {currentActionPitch.spin_eff !== null
                        ? `${fmtNum(currentActionPitch.spin_eff > 1 ? currentActionPitch.spin_eff : currentActionPitch.spin_eff * 100, 1)}%`
                        : '—'}
                    </div>
                    <div>rTilt: {formatTiltClock(currentActionPitch.release_tilt)}</div>
                    <div>bTilt: {formatTiltClock(currentActionPitch.break_tilt)}</div>
                    <div>Height: {fmtNum(currentActionPitch.release_height, 1)}</div>
                    <div>Side: {typeof currentActionPitch.release_side === 'number' ? fmtNum(orientX(currentActionPitch.release_side), 1) : '-'}</div>
                    <div style={{ display: 'grid', justifyContent: 'center', marginTop: 8 }}>
                      <svg viewBox="0 0 240 252" style={{ width: 120, height: 126 }}>
                        <rect x={40} y={45} width={160} height={120} fill="none" stroke="#111827" strokeWidth="6" />
                        <line x1={93.33} y1={45} x2={93.33} y2={165} stroke="#111827" strokeWidth="3" />
                        <line x1={146.66} y1={45} x2={146.66} y2={165} stroke="#111827" strokeWidth="3" />
                        <line x1={40} y1={85} x2={200} y2={85} stroke="#111827" strokeWidth="3" />
                        <line x1={40} y1={125} x2={200} y2={125} stroke="#111827" strokeWidth="3" />
                        <rect x={13} y={20} width={214} height={178} fill="none" stroke="#111827" strokeWidth="4" />
                        <line x1={13} y1={104} x2={40} y2={104} stroke="#111827" strokeWidth="4" />
                        <line x1={200} y1={104} x2={227} y2={104} stroke="#111827" strokeWidth="4" />
                        <line x1={120} y1={20} x2={120} y2={45} stroke="#111827" strokeWidth="4" />
                        <polyline points="80,236 80,228 120,222 160,228 160,236 80,236" fill="none" stroke="#111827" strokeWidth="4" />
                        {actionPlateX !== null && actionPlateY !== null ? (
                          <circle
                            cx={actionPlateX}
                            cy={actionPlateY}
                            r="7"
                            fill={pitchColors[currentActionPitch.pitch_type] ?? '#9ca3af'}
                            stroke="#111827"
                            strokeWidth="1.5"
                          />
                        ) : null}
                      </svg>
                    </div>
                    <div style={{ display: 'grid', justifyContent: 'center' }}>
                      <img
                        src="/pitching-coach-u-logo.png"
                        alt="PCU"
                        style={{ width: 74, height: 74, objectFit: 'contain' }}
                      />
                    </div>
                  </div>
                  ) : null}
                </div>
                <div className="portal-choice-line-actions" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-ghost" style={{ background: '#fff', color: '#374151', borderColor: '#cbd5e1' }} onClick={() => setActionMode(null)}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      {showTargetSettings ? (
        <div className="portal-modal-backdrop" onClick={() => setShowTargetSettings(false)}>
          <div className="portal-modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Target settings">
            <div className="portal-modal-header">
              <h3>Target Settings</h3>
            </div>
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

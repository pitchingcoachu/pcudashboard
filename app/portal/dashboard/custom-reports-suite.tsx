'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { resolveSchoolBrand } from '../../../lib/school-brand';
import { formatTableDisplayValue, sortTableRows, type SortDirection } from '../../../lib/table-sort';
import { getProTeamLogoUrl, inferProTeamCode } from './pro-team-logos';

type OptionItem = { value: string; label: string };
type ReportType = 'Pitching' | 'Hitting' | 'Catching';
type ReportScope = 'Single Player' | 'Multi-Player';
type SprayViewMode = 'Batted Balls' | 'Bins';
type PanelType =
  | ''
  | 'Movement Plot'
  | 'Release Plot'
  | 'Location Plot'
  | 'Heatmap'
  | 'Velocity Chart'
  | 'Pitch Usage Pie Chart'
  | 'Pitch Usage Bar Chart'
  | 'Velocity Bar Chart'
  | 'Velocity Distribution'
  | 'Summary Table'
  | 'Spray Chart'
  | 'Note Section'
  | '2D Contact'
  | '3D Contact'
  | 'Horizontal Attack'
  | 'Vertical Attack'
  | 'Bat Speed'
  | 'EV and LA';
type FilterToken =
  | 'Dates'
  | 'Session Type'
  | 'Pitch Types'
  | 'Batter Hand'
  | 'Pitcher Hand'
  | 'Pitch Results'
  | 'QP Locations'
  | 'In Zone'
  | 'Count'
  | 'After Count'
  | 'Zone Location'
  | 'Velo Min/Max'
  | 'IVB Min/Max'
  | 'HB Min/Max';

type PitchingFiltersPayload = {
  school_code: string;
  min_date: string | null;
  max_date: string | null;
  pitchers: string[];
  team_types?: string[];
  pitchers_by_team_code?: Record<string, string[]>;
  level_options?: string[];
  session_types: string[];
  pitch_types: string[];
  batter_sides: string[];
  hands: string[];
  pitch_results: string[];
  count_options: string[];
  after_count_options: string[];
  zone_locations: string[];
  qp_location_options: string[];
  in_zone_options: string[];
};

type HittingFiltersPayload = {
  school_code: string;
  min_date: string | null;
  max_date: string | null;
  hitters: string[];
  team_types?: string[];
  hitters_by_team_code?: Record<string, string[]>;
  level_options?: string[];
  session_types?: string[];
  pitch_types: string[];
  batter_sides: string[];
  hands: string[];
  pitch_results: string[];
  count_options: string[];
  after_count_options: string[];
  zone_locations: string[];
  in_zone_options: string[];
  table_modes?: string[];
  split_by_options?: string[];
};

type CatchingFiltersPayload = {
  school_code: string;
  min_date: string | null;
  max_date: string | null;
  catchers: string[];
  team_types?: string[];
  catchers_by_team_code?: Record<string, string[]>;
  level_options?: string[];
  pitch_types: string[];
  hands: string[];
  batter_sides: string[];
  zone_locations: string[];
  in_zone_options: string[];
  pitch_results: string[];
  count_options: string[];
  after_count_options: string[];
};

type OverviewLitePayload = {
  table_columns?: string[];
  table_rows?: Array<Record<string, string | number | null>>;
  chart_points?: Array<{
    session_date?: string | null;
    pitch_type?: string | null;
    plate_side?: number | null;
    plate_height?: number | null;
    rel_speed?: number | null;
    velo?: number | null;
    ivb?: number | null;
    hb?: number | null;
    release_height?: number | null;
    release_side?: number | null;
    extension?: number | null;
    direction?: number | null;
    distance?: number | null;
    exit_speed?: number | null;
    angle?: number | null;
    contact_position_x?: number | null;
    contact_position_y?: number | null;
    contact_position_z?: number | null;
    vertical_attack_angle?: number | null;
    horizontal_attack_angle?: number | null;
    bat_speed?: number | null;
    inning?: number | null;
    pitcher?: string | null;
    game_id?: string | null;
    game_uid?: string | null;
    game_foreign_id?: string | null;
    pitch_number?: number | null;
    pitch_no?: number | null;
    pitch_event_id?: number | null;
    pitch_call?: string | null;
    play_result?: string | null;
    tagged_hit_type?: string | null;
    qp_plus?: number | null;
    run_value?: number | null;
    korbb?: string | null;
    catcher?: string | null;
    throw_speed?: number | null;
    exchange_time?: number | null;
    pop_time?: number | null;
    result_label?: string | null;
  }>;
  heatmap_points?: Array<{
    session_date?: string | null;
    pitch_type?: string | null;
    plate_side?: number | null;
    plate_height?: number | null;
    pitch_call?: string | null;
    play_result?: string | null;
    tagged_hit_type?: string | null;
    exit_speed?: number | null;
    run_value?: number | null;
    result_label?: string | null;
  }>;
};

type SavedReportItem = {
  id: number;
  name: string;
  applyToAllSchools?: boolean;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
};

type CellConfig = {
  panelType: PanelType;
  player: string;
  title: string;
  noteText: string;
  tableMode: string;
  heatStat: string;
  velocityChart: string;
  releaseView: string;
  movementView: string;
  colSpan: number;
  showControls: boolean;
  splitBy: string;
  filterSelect: FilterToken[];
  dateStart?: string;
  dateEnd?: string;
  sessionType: string;
  pitchTypes: string[];
  batterSide: string;
  pitcherHand: string;
  pitchResults: string[];
  qpLocations: string;
  inZone: string;
  countFilter: string[];
  afterCountFilter: string[];
  zoneLocations: string[];
  veloMin?: string;
  veloMax?: string;
  ivbMin?: string;
  ivbMax?: string;
  hbMin?: string;
  hbMax?: string;
  contact2dMode: 'individual' | 'average_pitch_type';
  contact2dColorBy: 'pitch_type' | 'exit_velocity' | 'result';
  contact3dMode: 'individual' | 'average_pitch_type';
  contact3dColorBy: 'pitch_type' | 'exit_velocity' | 'result';
  batSpeedDisplay: 'average' | 'individual';
  batSpeedColorBy: 'pitch_type' | 'exit_velocity' | 'result';
  evlaColorBy: 'result' | 'pitch_type';
  sprayView: SprayViewMode;
};

type ReportPayload = {
  title: string;
  subtitle: string;
  type: ReportType;
  team: string;
  scope: ReportScope;
  players: string[];
  rows: number;
  cols: number;
  useGlobalDates: boolean;
  showPitchTypeKey: boolean;
  showLocationChartKey?: boolean;
  showExitVelocityKey?: boolean;
  showBattedResultsKey?: boolean;
  enableTableColors?: boolean;
  globalStartDate: string;
  globalEndDate: string;
  rowPlayers: string[];
  rowNotes: string[];
  rowNoteSpans: number[];
  cells: Record<string, CellConfig>;
};

const PITCHING_PANEL_TYPES: PanelType[] = [
  '',
  'Movement Plot',
  'Release Plot',
  'Location Plot',
  'Heatmap',
  'Velocity Chart',
  'Pitch Usage Pie Chart',
  'Pitch Usage Bar Chart',
  'Velocity Bar Chart',
  'Velocity Distribution',
  'Summary Table',
  'Spray Chart',
  'Note Section',
];
const HITTING_PANEL_TYPES: PanelType[] = [
  '',
  'Movement Plot',
  'Release Plot',
  'Location Plot',
  'Heatmap',
  '2D Contact',
  '3D Contact',
  'Horizontal Attack',
  'Vertical Attack',
  'Bat Speed',
  'EV and LA',
  'Summary Table',
  'Spray Chart',
  'Note Section',
];
const CATCHING_PANEL_TYPES: PanelType[] = [
  '',
  'Heatmap',
  'Summary Table',
  'Note Section',
];
const FILTER_TOKENS: FilterToken[] = [
  'Dates',
  'Session Type',
  'Pitch Types',
  'Batter Hand',
  'Pitcher Hand',
  'Pitch Results',
  'QP Locations',
  'In Zone',
  'Count',
  'After Count',
  'Zone Location',
  'Velo Min/Max',
  'IVB Min/Max',
  'HB Min/Max',
];
const splitByLabel = (value: string): string => (value === 'Inning' ? 'Inning of Appearance' : value);
const UNIVERSAL_SPLIT_BY = [
  'Pitch Types',
  'Batter Side',
  'Pitcher Hand',
  'Batter Hand',
  'Session Type',
  'Count',
  'After Count',
  'In Zone',
  'Zone Location',
  'Times Through Order',
  'Inning',
  'Pitch Count',
  'Velocity',
  'IVB',
  'HB',
  'Pitcher',
  'Batter',
  'Catcher',
];
const PITCHING_TABLES = ['Stuff', 'Process', 'Results', 'Bullpen', 'Live', 'Usage', 'Raw Data'];
const HITTING_TABLES = ['Results', 'Swing Decisions'];
const CATCHING_TABLES = ['Catching Data', 'Stuff', 'Process', 'Results', 'Bullpen', 'Live', 'Usage', 'Raw Data', 'Batted Ball Data', 'Swing Decisions'];
const CATCHING_SPLIT_BY = UNIVERSAL_SPLIT_BY;
const HEATMAP_STATS = ['Frequency', 'Called Strike Rate', 'Whiff Rate', 'Exit Velocity', 'GB Rate', 'Contact Rate', 'Swing Rate', 'Run Values'];
const VELOCITY_CHART_OPTIONS = ['Velocity Chart (Game/Inning)', 'Average Velocity by Game', 'Average Velocity by Inning'];
const RELEASE_VIEW_OPTIONS = ['Averages Only', 'Averages and Pitches', 'Pitches'];
const MOVEMENT_VIEW_OPTIONS = ['Averages Only', 'Averages and Pitches'];
const PITCH_ORDER = ['Fastball', 'Sinker', 'Cutter', 'Slider', 'Sweeper', 'Curveball', 'ChangeUp', 'Splitter', 'Knuckleball', 'Undefined'];
const PITCH_ABBR: Record<string, string> = {
  Fastball: 'FB',
  Sinker: 'SI',
  Cutter: 'CT',
  Slider: 'SL',
  Sweeper: 'SW',
  Curveball: 'CB',
  ChangeUp: 'CH',
  Splitter: 'SP',
  Knuckleball: 'KN',
  Undefined: 'UN',
};
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
const PITCH_TYPE_ALIASES: Record<string, string> = {
  fastball: 'Fastball',
  fourseamfastball: 'Fastball',
  fourseam: 'Fastball',
  sinker: 'Sinker',
  oneseamfastball: 'Sinker',
  twoseamfastball: 'Sinker',
  twoseam: 'Sinker',
  cutter: 'Cutter',
  slider: 'Slider',
  sweeper: 'Sweeper',
  curveball: 'Curveball',
  changeup: 'ChangeUp',
  splitter: 'Splitter',
  knuckleball: 'Knuckleball',
  undefined: 'Undefined',
  unknown: 'Undefined',
  other: 'Undefined',
};

function canonicalPitchType(value: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const direct = PITCH_ORDER.find((entry) => entry.toLowerCase() === raw.toLowerCase());
  if (direct) return direct;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return PITCH_TYPE_ALIASES[key] ?? null;
}
const RESULT_COLOR_PALETTE: Record<string, string> = {
  Single: '#22c55e',
  Double: '#3b82f6',
  Triple: '#a855f7',
  HomeRun: '#ef4444',
  Out: '#e5e7eb',
  Error: '#f59e0b',
  FieldersChoice: '#06b6d4',
  Sacrifice: '#14b8a6',
  'Foul Ball': '#94a3b8',
  Unknown: '#94a3b8',
};
const EV_BINS = ['<70', '70-75', '75-80', '80-85', '85-90', '90-95', '95-100', '>100', 'Unknown'] as const;
const EV_COLOR_PALETTE: Record<(typeof EV_BINS)[number], string> = {
  '<70': '#1f4e79',
  '70-75': '#2f6fa3',
  '75-80': '#3f8fc6',
  '80-85': '#59b4d8',
  '85-90': '#7ccf9b',
  '90-95': '#f4d35e',
  '95-100': '#f59e0b',
  '>100': '#ef4444',
  Unknown: '#94a3b8',
};

function toFirstLast(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts.slice(1).join(' ')} ${parts[0]}`.replace(/\s+/g, ' ').trim();
  return trimmed;
}

function toYmd(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fmtShortDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
}

function normalizeNameForApi(value: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed === 'All') return '';
  return trimmed;
}

function subjectLabelForReportType(reportType: ReportType): string {
  if (reportType === 'Pitching') return 'Pitcher';
  if (reportType === 'Hitting') return 'Hitter';
  return 'Catcher';
}

function defaultTableModeForReportType(reportType: ReportType): string {
  if (reportType === 'Pitching') return 'Live';
  if (reportType === 'Hitting') return 'Results';
  return 'Catching Data';
}

function tableOptionsForReportType(reportType: ReportType): string[] {
  if (reportType === 'Pitching') return PITCHING_TABLES;
  if (reportType === 'Hitting') return HITTING_TABLES;
  return CATCHING_TABLES;
}

function panelOptionsForReportType(reportType: ReportType): PanelType[] {
  if (reportType === 'Pitching') return PITCHING_PANEL_TYPES;
  if (reportType === 'Hitting') return HITTING_PANEL_TYPES;
  return CATCHING_PANEL_TYPES;
}

function splitByOptionsForReportType(reportType: ReportType): string[] {
  if (reportType === 'Catching') return CATCHING_SPLIT_BY;
  return UNIVERSAL_SPLIT_BY;
}

function selectedValues(values: string[] | undefined): string[] {
  const list = (values ?? []).map((entry) => (entry ?? '').trim()).filter(Boolean);
  if (!list.length || list.includes('All')) return [];
  return list;
}

function normalizeNameKey(value: string): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildPlayerTeamMap(byTeamCode: Record<string, string[]> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(byTeamCode ?? {}).forEach(([teamCodeRaw, names]) => {
    const teamCode = String(teamCodeRaw ?? '').trim().toUpperCase();
    if (!teamCode) return;
    (names ?? []).forEach((nameRaw) => {
      const name = String(nameRaw ?? '').trim();
      if (!name) return;
      const formatted = toFirstLast(name);
      [name, formatted, normalizeNameKey(name), normalizeNameKey(formatted)].forEach((key) => {
        if (key) out[key] = teamCode;
      });
    });
  });
  return out;
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

function reorderInningRows<T extends Record<string, unknown>>(rows: T[], splitColumn: string): T[] {
  if (!splitColumn) return rows;
  const allRows = rows.filter((row) => String(row[splitColumn] ?? '').trim().toLowerCase() === 'all');
  const nonAllRows = rows.filter((row) => String(row[splitColumn] ?? '').trim().toLowerCase() !== 'all');
  const inningRank = (value: unknown): number => {
    const raw = String(value ?? '').trim();
    if (!raw || raw.toLowerCase() === 'unknown') return Number.MAX_SAFE_INTEGER;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
    const match = raw.match(/\d+/);
    return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
  };
  nonAllRows.sort((a, b) => {
    const rankA = inningRank(a[splitColumn]);
    const rankB = inningRank(b[splitColumn]);
    if (rankA !== rankB) return rankA - rankB;
    return String(a[splitColumn] ?? '').localeCompare(String(b[splitColumn] ?? ''));
  });
  return [...allRows, ...nonAllRows];
}

function reorderPitchCountRows<T extends Record<string, unknown>>(rows: T[], splitColumn: string): T[] {
  if (!splitColumn) return rows;
  const allRows = rows.filter((row) => String(row[splitColumn] ?? '').trim().toLowerCase() === 'all');
  const nonAllRows = rows.filter((row) => String(row[splitColumn] ?? '').trim().toLowerCase() !== 'all');
  const binRank = (value: unknown): number => {
    const raw = String(value ?? '').trim();
    if (!raw || raw.toLowerCase() === 'unknown') return Number.MAX_SAFE_INTEGER;
    const range = raw.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
    if (range) return Number(range[1]);
    const match = raw.match(/\d+/);
    return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
  };
  nonAllRows.sort((a, b) => {
    const rankA = binRank(a[splitColumn]);
    const rankB = binRank(b[splitColumn]);
    if (rankA !== rankB) return rankA - rankB;
    return String(a[splitColumn] ?? '').localeCompare(String(b[splitColumn] ?? ''));
  });
  return [...allRows, ...nonAllRows];
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
          <input className="portal-search-select-input" placeholder="Type to filter..." value={query} onChange={(event) => setQuery(event.target.value)} />
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

  const selectedText = values.includes('All') ? 'All' : values.length ? `${values.length} selected` : 'Select';
  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));

  const toggle = (nextValue: string) => {
    if (nextValue === 'All') {
      onChange(['All']);
      return;
    }
    const withoutAll = values.filter((entry) => entry !== 'All');
    if (withoutAll.includes(nextValue)) {
      const next = withoutAll.filter((entry) => entry !== nextValue);
      onChange(next.length ? next : ['All']);
      return;
    }
    onChange([...withoutAll, nextValue]);
  };

  return (
    <div className="portal-search-select" ref={rootRef}>
      <button type="button" className="portal-search-select-trigger" onClick={() => setOpen((current) => !current)}>
        {selectedText}
      </button>
      {open ? (
        <div className="portal-search-select-menu">
          <input className="portal-search-select-input" placeholder="Type to filter..." value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="portal-search-select-options">
            {filtered.map((option) => (
              <button key={option.value} type="button" className="portal-search-select-option portal-search-select-option-multi" onClick={() => toggle(option.value)}>
                <span>{values.includes(option.value) ? '✓' : ''}</span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

async function ensurePlotlyLoaded(): Promise<void> {
  if (typeof window === 'undefined') return;
  if ((window as unknown as { Plotly?: unknown }).Plotly) return;
  const key = '__plotlyLoaderPromise';
  const win = window as unknown as Record<string, unknown>;
  if (win[key]) {
    await (win[key] as Promise<void>);
    return;
  }
  win[key] = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.plot.ly/plotly-2.35.2.min.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Plotly.'));
    document.head.appendChild(script);
  });
  await (win[key] as Promise<void>);
}

function Contact3DChart({
  points,
  mode,
  colorBy,
}: {
  points: NonNullable<OverviewLitePayload['chart_points']>;
  mode: 'individual' | 'average_pitch_type';
  colorBy: 'pitch_type' | 'exit_velocity' | 'result';
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = ref.current;
    if (!mount) return;
    let cancelled = false;

    const render = async () => {
      await ensurePlotlyLoaded();
      if (cancelled) return;
      const Plotly = (
        window as unknown as {
          Plotly?: {
            react: (...args: unknown[]) => Promise<unknown>;
            Plots?: { resize: (el: HTMLElement) => void };
          };
        }
      ).Plotly;
      if (!Plotly) return;

      const source = points.filter(
        (p) => toNum(p.contact_position_x) !== null && toNum(p.contact_position_y) !== null && toNum(p.contact_position_z) !== null
      );
      const averaged =
        mode === 'average_pitch_type'
          ? Object.values(
              source.reduce<Record<string, { n: number; x: number; y: number; z: number; p: (typeof source)[number] }>>((acc, p) => {
                const key = p.pitch_type || 'Unknown';
                if (!acc[key]) acc[key] = { n: 0, x: 0, y: 0, z: 0, p };
                acc[key].n += 1;
                acc[key].x += toNum(p.contact_position_x) ?? 0;
                acc[key].y += toNum(p.contact_position_y) ?? 0;
                acc[key].z += toNum(p.contact_position_z) ?? 0;
                return acc;
              }, {})
            ).map((g) => ({ ...g.p, contact_position_x: g.x / g.n, contact_position_y: g.y / g.n, contact_position_z: g.z / g.n }))
          : source;

      const xVals = averaged.map((p) => toNum(p.contact_position_x) ?? 0);
      const yVals = averaged.map((p) => toNum(p.contact_position_z) ?? 0);
      const zVals = averaged.map((p) => toNum(p.contact_position_y) ?? 0);
      const colors = averaged.map((p) => {
        if (colorBy === 'pitch_type') return PITCH_COLORS[p.pitch_type || 'Undefined'] ?? PITCH_COLORS.Undefined;
        if (colorBy === 'exit_velocity') return EV_COLOR_PALETTE[evBin(p.exit_speed)];
        return RESULT_COLOR_PALETTE[resultLabelForSwing(p.play_result)] ?? RESULT_COLOR_PALETTE.Unknown;
      });
      const hovers = averaged.map(
        (p) =>
          `<b>${p.pitch_type || '-'}</b><br>` +
          `Result: ${resultLabelForSwing(p.play_result)}<br>` +
          `Forward: ${(toNum(p.contact_position_x) ?? 0).toFixed(1)} ft<br>` +
          `Height: ${(toNum(p.contact_position_y) ?? 0).toFixed(1)} ft<br>` +
          `Side: ${(toNum(p.contact_position_z) ?? 0).toFixed(1)} ft<br>` +
          `Velo: ${Number.isFinite((p.rel_speed ?? p.velo ?? null) as number) ? Number(p.rel_speed ?? p.velo).toFixed(1) : '-'} mph<br>` +
          `EV: ${Number.isFinite((p.exit_speed ?? null) as number) ? Number(p.exit_speed).toFixed(1) : '-'} mph<br>` +
          `LA: ${Number.isFinite((p.angle ?? null) as number) ? Number(p.angle).toFixed(1) : '-'}°`
      );

      const traces: unknown[] = [];
      traces.push({
        type: 'scatter3d',
        mode: 'markers',
        x: xVals,
        y: yVals,
        z: zVals,
        hovertemplate: '%{text}<extra></extra>',
        text: hovers,
        marker: {
          size: mode === 'average_pitch_type' ? 7 : 5,
          color: colors,
          opacity: 0.9,
          line: { color: 'rgba(255,255,255,0.55)', width: 1 },
        },
        showlegend: false,
      });

      const strikeX = 1.42;
      const zoneLeft = -0.88;
      const zoneRight = 0.88;
      const zoneBottom = 1.5;
      const zoneTop = 3.6;
      const zoneDx = (zoneRight - zoneLeft) / 3;
      const zoneDy = (zoneTop - zoneBottom) / 3;
      const lineTrace = (x: number[], y: number[], z: number[], width = 4, color = 'rgba(229,231,235,0.95)') => ({
        type: 'scatter3d',
        mode: 'lines',
        x,
        y,
        z,
        hoverinfo: 'skip',
        line: { color, width },
        showlegend: false,
      });
      traces.push(lineTrace([0.0, 0.58, 1.42, 1.42, 0.58, 0.0], [0.0, 0.71, 0.71, -0.71, -0.71, 0.0], [0, 0, 0, 0, 0, 0], 6, 'rgba(226,232,240,0.95)'));
      traces.push(lineTrace([strikeX, strikeX, strikeX, strikeX, strikeX], [zoneLeft, zoneRight, zoneRight, zoneLeft, zoneLeft], [zoneBottom, zoneBottom, zoneTop, zoneTop, zoneBottom], 5));
      traces.push(lineTrace([strikeX, strikeX], [zoneLeft + zoneDx, zoneLeft + zoneDx], [zoneBottom, zoneTop], 3, 'rgba(226,232,240,0.7)'));
      traces.push(lineTrace([strikeX, strikeX], [zoneLeft + zoneDx * 2, zoneLeft + zoneDx * 2], [zoneBottom, zoneTop], 3, 'rgba(226,232,240,0.7)'));
      traces.push(lineTrace([strikeX, strikeX], [zoneLeft, zoneRight], [zoneBottom + zoneDy, zoneBottom + zoneDy], 3, 'rgba(226,232,240,0.7)'));
      traces.push(lineTrace([strikeX, strikeX], [zoneLeft, zoneRight], [zoneBottom + zoneDy * 2, zoneBottom + zoneDy * 2], 3, 'rgba(226,232,240,0.7)'));

      const xRange = xVals.length ? [Math.min(...xVals, -0.2), Math.max(...xVals, 5.2)] : [-0.2, 5.2];
      const yRange = yVals.length ? [Math.min(...yVals, -2.5), Math.max(...yVals, 2.5)] : [-2.5, 2.5];
      const zRange = zVals.length ? [Math.min(...zVals, 0), Math.max(...zVals, 6)] : [0, 6];

      const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { l: 0, r: 0, t: 0, b: 0 },
        scene: {
          xaxis: { title: 'Forward (ft)', color: '#e5e7eb', gridcolor: 'rgba(255,255,255,0.15)', range: xRange },
          yaxis: { title: 'Side (ft)', color: '#e5e7eb', gridcolor: 'rgba(255,255,255,0.15)', range: yRange },
          zaxis: { title: 'Height (ft)', color: '#e5e7eb', gridcolor: 'rgba(255,255,255,0.15)', range: zRange },
          dragmode: 'orbit',
          aspectmode: 'manual',
          aspectratio: { x: 1.45, y: 1.25, z: 1.1 },
          camera: { eye: { x: 1.55, y: -1.45, z: 0.95 } },
          bgcolor: 'rgba(0,0,0,0)',
        },
        showlegend: false,
      };

      await Plotly.react(mount, traces, layout, { displayModeBar: false, responsive: true });
      const onResize = () => {
        try {
          Plotly.Plots?.resize(mount);
        } catch {
          // no-op
        }
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    };

    let cleanup: (() => void) | undefined;
    void render().then((fn) => {
      if (typeof fn === 'function') cleanup = fn;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [points, mode, colorBy]);

  return <div ref={ref} style={{ width: '100%', height: '100%', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }} />;
}

function emptyCell(): CellConfig {
  return {
    panelType: 'Summary Table',
    player: 'All',
    title: '',
    noteText: '',
    tableMode: 'Live',
    heatStat: 'Frequency',
    velocityChart: 'Velocity Chart (Game/Inning)',
    releaseView: 'Averages and Pitches',
    movementView: 'Averages and Pitches',
    colSpan: 1,
    showControls: true,
    splitBy: 'Pitch Types',
    filterSelect: ['Dates', 'Session Type', 'Pitch Types'],
    sessionType: 'All',
    pitchTypes: ['All'],
    batterSide: 'All',
    pitcherHand: 'All',
    pitchResults: ['All'],
    qpLocations: 'All',
    inZone: 'All',
    countFilter: ['All'],
    afterCountFilter: ['All'],
    zoneLocations: ['All'],
    contact2dMode: 'individual',
    contact2dColorBy: 'pitch_type',
    contact3dMode: 'individual',
    contact3dColorBy: 'pitch_type',
    batSpeedDisplay: 'average',
    batSpeedColorBy: 'pitch_type',
    evlaColorBy: 'result',
    sprayView: 'Batted Balls',
  };
}

function normalizeCellConfig(input: Partial<CellConfig> | undefined): CellConfig {
  const base = emptyCell();
  const merged: CellConfig = {
    ...base,
    ...(input ?? {}),
    filterSelect: (input?.filterSelect?.length ? input.filterSelect : base.filterSelect) as FilterToken[],
    pitchTypes: input?.pitchTypes?.length ? input.pitchTypes : base.pitchTypes,
    pitchResults: input?.pitchResults?.length ? input.pitchResults : base.pitchResults,
    countFilter: input?.countFilter?.length ? input.countFilter : base.countFilter,
    afterCountFilter: input?.afterCountFilter?.length ? input.afterCountFilter : base.afterCountFilter,
    zoneLocations: input?.zoneLocations?.length ? input.zoneLocations : base.zoneLocations,
  };
  merged.panelType = normalizePanelType(merged.panelType);
  merged.heatStat = HEATMAP_STATS.includes(merged.heatStat) ? merged.heatStat : 'Frequency';
  merged.velocityChart = VELOCITY_CHART_OPTIONS.includes(merged.velocityChart) ? merged.velocityChart : 'Velocity Chart (Game/Inning)';
  merged.releaseView = RELEASE_VIEW_OPTIONS.includes(merged.releaseView) ? merged.releaseView : 'Averages and Pitches';
  merged.movementView = MOVEMENT_VIEW_OPTIONS.includes(merged.movementView) ? merged.movementView : 'Averages and Pitches';
  merged.colSpan = Math.max(1, Math.min(5, Number((input as { colSpan?: number; rowSpan?: number } | undefined)?.colSpan ?? (input as { rowSpan?: number } | undefined)?.rowSpan ?? 1) || 1));
  merged.showControls = merged.showControls !== false;
  merged.contact2dMode = merged.contact2dMode === 'average_pitch_type' ? 'average_pitch_type' : 'individual';
  merged.contact2dColorBy = merged.contact2dColorBy === 'exit_velocity' || merged.contact2dColorBy === 'result' ? merged.contact2dColorBy : 'pitch_type';
  merged.contact3dMode = merged.contact3dMode === 'average_pitch_type' ? 'average_pitch_type' : 'individual';
  merged.contact3dColorBy = merged.contact3dColorBy === 'exit_velocity' || merged.contact3dColorBy === 'result' ? merged.contact3dColorBy : 'pitch_type';
  merged.batSpeedDisplay = merged.batSpeedDisplay === 'individual' ? 'individual' : 'average';
  merged.batSpeedColorBy = merged.batSpeedColorBy === 'exit_velocity' || merged.batSpeedColorBy === 'result' ? merged.batSpeedColorBy : 'pitch_type';
  merged.evlaColorBy = merged.evlaColorBy === 'pitch_type' ? 'pitch_type' : 'result';
  merged.sprayView = merged.sprayView === 'Bins' ? 'Bins' : 'Batted Balls';
  return merged;
}

function normalizePanelType(value: string): PanelType {
  const normalized = (value ?? '').trim();
  if (!normalized) return '';
  if (normalized === 'Table') return 'Summary Table';
  if (normalized === 'HeatMap') return 'Heatmap';
  if (normalized === 'Notes') return 'Note Section';
  if (normalized === 'AB Report') return 'Location Plot';
  return normalized as PanelType;
}

function orderedPitchStats(map: Record<string, number>): Array<[string, number]> {
  const keys = Object.keys(map);
  keys.sort((a, b) => {
    const ia = PITCH_ORDER.indexOf(a);
    const ib = PITCH_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return keys.map((k) => [k, map[k] ?? 0]);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rgb = (r: number, g: number, b: number) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
const sequentialColor = (value: number, min: number, max: number): string => {
  if (!Number.isFinite(value)) return 'rgba(255,255,255,0.08)';
  const mid = min + (max - min) * 0.5;
  return divergingColor(value, min, mid, max);
};
const divergingColor = (value: number, min: number, mid: number, max: number): string => {
  if (!Number.isFinite(value)) return 'rgba(255,255,255,0.08)';
  if (value <= mid) {
    const t = Math.max(0, Math.min(1, (value - min) / Math.max(1e-9, mid - min)));
    return rgb(lerp(32, 246, t), lerp(74, 248, t), lerp(135, 248, t));
  }
  const t = Math.max(0, Math.min(1, (value - mid) / Math.max(1e-9, max - mid)));
  return rgb(lerp(248, 176, t), lerp(248, 11, t), lerp(248, 52, t));
};
const normalizePitchTypeName = (value: string): string => {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return 'all';
  if (v === 'all') return 'all';
  return v.replace(/\s+/g, '');
};
const heatmapScaleFromMetricAndPitchTypes = (
  metricRaw: string,
  selectedPitchTypesRaw: string[]
): { min: number; mid: number; max: number } | null => {
  const metric = String(metricRaw ?? '').trim();
  const selectedPitchTypes = selectedPitchTypesRaw
    .map((value) => normalizePitchTypeName(value))
    .filter((value) => value && value !== 'all');

  if (metric === 'Exit Velocity') return { min: 80, mid: 90, max: 100 };

  if (metric === 'Whiff Rate') {
    if (selectedPitchTypes.length !== 1) return { min: 10, mid: 25, max: 40 };
    const pt = selectedPitchTypes[0];
    if (pt === 'fastball') return { min: 10, mid: 20, max: 30 };
    if (pt === 'sinker') return { min: 5, mid: 12.5, max: 20 };
    return { min: 20, mid: 32.5, max: 45 };
  }
  if (metric === 'Swing Rate') return { min: 20, mid: 50, max: 80 };
  if (metric === 'GB Rate') return { min: 38, mid: 43, max: 48 };
  if (metric === 'Contact Rate') {
    if (selectedPitchTypes.length !== 1) return { min: 60, mid: 75, max: 90 };
    const pt = selectedPitchTypes[0];
    if (pt === 'fastball') return { min: 70, mid: 80, max: 90 };
    if (pt === 'sinker') return { min: 80, mid: 87.5, max: 95 };
    return { min: 55, mid: 67.5, max: 80 };
  }
  return null;
};
const resultShape = (pitchCall: string, playResult: string, isProSchool = false): string => {
  if (isProSchool) {
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
const formatPitchResult = (pitchCallRaw: string | null | undefined, playResultRaw: string | null | undefined): string => {
  const pitchCall = (pitchCallRaw ?? '').trim();
  const playResult = (playResultRaw ?? '').trim();
  if (pitchCall === 'StrikeCalled') return 'Called Strike';
  if (pitchCall === 'StrikeSwinging') return 'Whiff';
  if (pitchCall === 'BallCalled' || pitchCall === 'BallinDirt') return 'Ball';
  if (pitchCall === 'HitByPitch' || playResult === 'HitByPitch') return 'HBP';
  if (pitchCall === 'FoulBall' || pitchCall === 'FoulBallFieldable' || pitchCall === 'FoulBallNotFieldable') return 'Foul';
  if (pitchCall === 'InPlay') return playResult || 'In Play';
  return pitchCall || playResult || '-';
};
const resultLabelForSwing = (playResultRaw: string | null | undefined): string => {
  const value = (playResultRaw || '').trim();
  if (!value || value === 'Undefined') return 'Unknown';
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (compact === 'homerun' || compact === 'homeruns' || compact === 'homer') return 'HomeRun';
  if (compact === 'single') return 'Single';
  if (compact === 'double') return 'Double';
  if (compact === 'triple') return 'Triple';
  if (compact === 'out') return 'Out';
  if (compact === 'fielderschoice') return 'FieldersChoice';
  if (compact === 'sacrifice') return 'Sacrifice';
  if (compact === 'error') return 'Error';
  return value;
};
const evBin = (value: number | null | undefined): (typeof EV_BINS)[number] => {
  if (!Number.isFinite(value as number)) return 'Unknown';
  const v = Number(value);
  if (v < 70) return '<70';
  if (v < 75) return '70-75';
  if (v < 80) return '75-80';
  if (v < 85) return '80-85';
  if (v < 90) return '85-90';
  if (v < 95) return '90-95';
  if (v < 100) return '95-100';
  return '>100';
};
const swingColorFor = (
  point: NonNullable<OverviewLitePayload['chart_points']>[number],
  mode: 'pitch_type' | 'exit_velocity' | 'result'
): string => {
  if (mode === 'pitch_type') return PITCH_COLORS[String(point.pitch_type || 'Undefined')] ?? PITCH_COLORS.Undefined;
  if (mode === 'exit_velocity') return EV_COLOR_PALETTE[evBin(toNum(point.exit_speed))];
  return RESULT_COLOR_PALETTE[resultLabelForSwing(point.play_result)] ?? RESULT_COLOR_PALETTE.Unknown;
};
const inZoneLabel = (x: number | null, y: number | null): string => {
  if (x === null || y === null) return 'No';
  const inZone = x >= -0.88 && x <= 0.88 && y >= 1.5 && y <= 3.6;
  const comp = x >= -1.5 && x <= 1.5 && y >= 1.05 && y <= 4.05;
  if (inZone) return 'Yes';
  if (comp) return 'Competitive';
  return 'No';
};

function toNum(value: unknown): number | null {
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function avgByPitchType(points: NonNullable<OverviewLitePayload['chart_points']>) {
  const byType = new Map<
    string,
    {
      n: number;
      velo: number;
      ivb: number;
      hb: number;
      releaseHeight: number;
      releaseSide: number;
      nVelo: number;
      nIvb: number;
      nHb: number;
      nRh: number;
      nRs: number;
    }
  >();
  for (const point of points) {
    const pitchType = ((point.pitch_type ?? '').trim() || 'Undefined') as string;
    const entry =
      byType.get(pitchType) ??
      { n: 0, velo: 0, ivb: 0, hb: 0, releaseHeight: 0, releaseSide: 0, nVelo: 0, nIvb: 0, nHb: 0, nRh: 0, nRs: 0 };
    entry.n += 1;
    const velo = toNum(point.rel_speed ?? point.velo);
    const ivb = toNum(point.ivb);
    const hb = toNum(point.hb);
    const rh = toNum(point.release_height);
    const rs = toNum(point.release_side);
    if (velo !== null) {
      entry.velo += velo;
      entry.nVelo += 1;
    }
    if (ivb !== null) {
      entry.ivb += ivb;
      entry.nIvb += 1;
    }
    if (hb !== null) {
      entry.hb += hb;
      entry.nHb += 1;
    }
    if (rh !== null) {
      entry.releaseHeight += rh;
      entry.nRh += 1;
    }
    if (rs !== null) {
      entry.releaseSide += rs;
      entry.nRs += 1;
    }
    byType.set(pitchType, entry);
  }
  const out: Array<{ pitchType: string; velo: number | null; ivb: number | null; hb: number | null; releaseHeight: number | null; releaseSide: number | null }> = [];
  for (const [pitchType, entry] of byType.entries()) {
    out.push({
      pitchType,
      velo: entry.nVelo ? entry.velo / entry.nVelo : null,
      ivb: entry.nIvb ? entry.ivb / entry.nIvb : null,
      hb: entry.nHb ? entry.hb / entry.nHb : null,
      releaseHeight: entry.nRh ? entry.releaseHeight / entry.nRh : null,
      releaseSide: entry.nRs ? entry.releaseSide / entry.nRs : null,
    });
  }
  out.sort((a, b) => {
    const ia = PITCH_ORDER.indexOf(a.pitchType);
    const ib = PITCH_ORDER.indexOf(b.pitchType);
    if (ia === -1 && ib === -1) return a.pitchType.localeCompare(b.pitchType);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return out;
}

function strikeZoneOverlay() {
  const fy = (y: number) => 4.8 - y;
  const strikeLeft = -0.83;
  const strikeRight = 0.83;
  const strikeBottom = 1.5;
  const strikeTop = 3.6;
  const compLeft = -1.5;
  const compRight = 1.5;
  const compBottom = 1.05;
  const compTop = 4.05;
  const midY = (strikeBottom + strikeTop) / 2;
  return (
    <>
      <rect x={strikeLeft} y={fy(strikeTop)} width={strikeRight - strikeLeft} height={strikeTop - strikeBottom} fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth={0.03} />
      <line x1={-0.28} y1={fy(strikeBottom)} x2={-0.28} y2={fy(strikeTop)} stroke="rgba(255,255,255,0.55)" strokeWidth={0.02} />
      <line x1={0.28} y1={fy(strikeBottom)} x2={0.28} y2={fy(strikeTop)} stroke="rgba(255,255,255,0.55)" strokeWidth={0.02} />
      <line x1={-0.83} y1={fy(2.2)} x2={0.83} y2={fy(2.2)} stroke="rgba(255,255,255,0.55)" strokeWidth={0.02} />
      <line x1={-0.83} y1={fy(2.9)} x2={0.83} y2={fy(2.9)} stroke="rgba(255,255,255,0.55)" strokeWidth={0.02} />
      <rect x={compLeft} y={fy(compTop)} width={compRight - compLeft} height={compTop - compBottom} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={0.02} />
      <line x1={compLeft} y1={fy(midY)} x2={strikeLeft} y2={fy(midY)} stroke="rgba(255,255,255,0.58)" strokeWidth={0.02} />
      <line x1={strikeRight} y1={fy(midY)} x2={compRight} y2={fy(midY)} stroke="rgba(255,255,255,0.58)" strokeWidth={0.02} />
      <line x1={0} y1={fy(compBottom)} x2={0} y2={fy(strikeBottom)} stroke="rgba(255,255,255,0.58)" strokeWidth={0.02} />
      <line x1={0} y1={fy(strikeTop)} x2={0} y2={fy(compTop)} stroke="rgba(255,255,255,0.58)" strokeWidth={0.02} />
      <polygon points={`${strikeLeft},${fy(0.55)} ${strikeRight},${fy(0.55)} ${strikeRight},${fy(0.65)} 0,${fy(0.75)} ${strikeLeft},${fy(0.65)}`} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={0.02} />
    </>
  );
}

function buildHeatCells(points: NonNullable<OverviewLitePayload['chart_points']>, metric: string, isProSchool = false) {
  const xMin = -2.5;
  const xMax = 2.5;
  const yMin = 0;
  const yMax = 4.5;
  const cols = isProSchool ? 44 : 40;
  const rows = isProSchool ? 44 : 40;
  const cellW = (xMax - xMin) / cols;
  const cellH = (yMax - yMin) / rows;
  const sigmaX = isProSchool ? 0.22 : 0.36;
  const sigmaY = isProSchool ? 0.22 : 0.36;
  const eps = 1e-9;
  const normDesc = (value: unknown): string =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const isInPlayCall = (point: NonNullable<OverviewLitePayload['chart_points']>[number]): boolean => {
    const raw = String(point.pitch_call ?? '');
    if (raw === 'InPlay') return true;
    const d = normDesc(raw);
    return d.startsWith('in_play') || d.startsWith('hit_into_play');
  };
  const isSwingCall = (point: NonNullable<OverviewLitePayload['chart_points']>[number]): boolean => {
    const raw = String(point.pitch_call ?? '');
    if (!isProSchool) {
      return raw === 'StrikeSwinging' || raw === 'FoulBall' || raw === 'FoulBallFieldable' || raw === 'FoulBallNotFieldable' || raw === 'InPlay';
    }
    const d = normDesc(raw);
    return (
      isInPlayCall(point) ||
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
  const isWhiffCall = (point: NonNullable<OverviewLitePayload['chart_points']>[number]): boolean => {
    const raw = String(point.pitch_call ?? '');
    if (!isProSchool) return raw === 'StrikeSwinging';
    const d = normDesc(raw);
    return d === 'swinging_strike' || d === 'swinging_strike_blocked' || d === 'foul_tip';
  };
  const isGroundBall = (point: NonNullable<OverviewLitePayload['chart_points']>[number]): boolean => {
    const tagged = normDesc(point.tagged_hit_type ?? '');
    return tagged.includes('ground_ball') || tagged === 'groundball';
  };
  const valid = points
    .map((point) => {
      const rawX = point.plate_side;
      const adjustedX = typeof rawX === 'number' ? (isProSchool ? -rawX : rawX) : rawX;
      return { point, x: adjustedX, y: point.plate_height };
    })
    .filter(
      (row): row is { point: NonNullable<OverviewLitePayload['chart_points']>[number]; x: number; y: number } =>
        row.x !== null && row.y !== null && row.x !== undefined && row.y !== undefined
    );
  if (!valid.length) return [] as Array<{ x: number; y: number; w: number; h: number; value: number; density: number }>;

  const runValue = (point: NonNullable<OverviewLitePayload['chart_points']>[number]): number => {
    if (typeof point.run_value === 'number' && Number.isFinite(point.run_value)) return point.run_value;
    if (isProSchool) return 0;
    const pitchCall = point.pitch_call || '';
    const playResult = point.play_result || '';
    const korbb = point.korbb || '';
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

  const globalSwingCount = valid.filter((row) => isSwingCall(row.point)).length;
  const globalWhiffCount = valid.filter((row) => isWhiffCall(row.point)).length;
  const globalInPlayCount = valid.filter((row) => isInPlayCall(row.point)).length;
  const globalGbCount = valid.filter((row) => isInPlayCall(row.point) && isGroundBall(row.point)).length;
  const globalEvRows = valid.filter((row) => isInPlayCall(row.point) && typeof row.point.exit_speed === 'number');
  const globalTakeRows = valid.filter((row) => ['StrikeCalled', 'BallCalled', 'BallinDirt'].includes(row.point.pitch_call || ''));
  const globalEvAvg = globalEvRows.length > 0 ? globalEvRows.reduce((sum, row) => sum + Number(row.point.exit_speed || 0), 0) / globalEvRows.length : 0;
  const globalRvAvg = valid.length > 0 ? valid.reduce((sum, row) => sum + runValue(row.point), 0) / valid.length : 0;
  const globalCsRate = globalTakeRows.length > 0 ? globalTakeRows.filter((row) => row.point.pitch_call === 'StrikeCalled').length / globalTakeRows.length : 0;
  const globalSwingRate = valid.length > 0 ? globalSwingCount / valid.length : 0;
  const globalWhiffRate = globalSwingCount > 0 ? globalWhiffCount / globalSwingCount : 0;
  const globalGbRate = globalInPlayCount > 0 ? globalGbCount / globalInPlayCount : 0;
  const globalContactRate = globalSwingCount > 0 ? (globalSwingCount - globalWhiffCount) / globalSwingCount : 0;
  const shrinkStrength = 8;
  const runValueShrinkStrength = 0.5;

  const cells: Array<{ x: number; y: number; w: number; h: number; value: number; density: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    const cy = yMin + (row + 0.5) * cellH;
    for (let col = 0; col < cols; col += 1) {
      const cx = xMin + (col + 0.5) * cellW;
      let sumW = 0;
      let swingW = 0;
      let whiffW = 0;
      let inPlayW = 0;
      let gbW = 0;
      let csW = 0;
      let takeW = 0;
      let evWSum = 0;
      let evW = 0;
      let rvWSum = 0;
      for (const rowPoint of valid) {
        const dx = (cx - rowPoint.x) / sigmaX;
        const dy = (cy - rowPoint.y) / sigmaY;
        const weight = Math.exp(-0.5 * (dx * dx + dy * dy));
        if (weight < 1e-6) continue;
        const call = rowPoint.point.pitch_call || '';
        const swing = isSwingCall(rowPoint.point);
        const inPlay = isInPlayCall(rowPoint.point);
        const gb = isGroundBall(rowPoint.point);
        const isTake = call === 'StrikeCalled' || call === 'BallCalled' || call === 'BallinDirt';
        sumW += weight;
        if (swing) swingW += weight;
        if (isWhiffCall(rowPoint.point)) whiffW += weight;
        if (inPlay) inPlayW += weight;
        if (gb) gbW += weight;
        if (isTake) {
          takeW += weight;
          if (call === 'StrikeCalled') csW += weight;
        }
        if (inPlay && typeof rowPoint.point.exit_speed === 'number') {
          evWSum += weight * rowPoint.point.exit_speed;
          evW += weight;
        }
        rvWSum += weight * runValue(rowPoint.point);
      }
      let value = sumW;
      if (metric === 'Called Strike Rate') value = 100 * ((csW + shrinkStrength * globalCsRate) / Math.max(eps, takeW + shrinkStrength));
      if (metric === 'Whiff Rate') value = 100 * ((whiffW + shrinkStrength * globalWhiffRate) / Math.max(eps, swingW + shrinkStrength));
      if (metric === 'GB Rate') value = 100 * ((gbW + shrinkStrength * globalGbRate) / Math.max(eps, inPlayW + shrinkStrength));
      if (metric === 'Contact Rate') value = 100 * (((swingW - whiffW) + shrinkStrength * globalContactRate) / Math.max(eps, swingW + shrinkStrength));
      if (metric === 'Swing Rate') value = 100 * ((swingW + shrinkStrength * globalSwingRate) / Math.max(eps, sumW + shrinkStrength));
      if (metric === 'Exit Velocity') value = (evWSum + shrinkStrength * globalEvAvg) / Math.max(eps, evW + shrinkStrength);
      if (metric === 'Run Values') value = ((rvWSum + runValueShrinkStrength * globalRvAvg) / Math.max(eps, sumW + runValueShrinkStrength)) * 100;
      cells.push({ x: xMin + col * cellW, y: yMin + row * cellH, w: cellW, h: cellH, value, density: sumW });
    }
  }
  if (metric === 'Frequency') {
    const maxVal = Math.max(...cells.map((cell) => cell.value), eps);
    for (const cell of cells) cell.value = (100 * cell.value) / maxVal;
  }
  return cells;
}

function ensureCellConfigMap(map: Record<string, CellConfig>, rows: number, cols: number): Record<string, CellConfig> {
  const next: Record<string, CellConfig> = {};
  for (let r = 1; r <= rows; r += 1) {
    for (let c = 1; c <= cols; c += 1) {
      const key = `r${r}c${c}`;
      next[key] = normalizeCellConfig(map[key]);
    }
  }
  return next;
}

function rowColFromCellId(cellId: string): { row: number; col: number } {
  const row = Number(cellId.match(/^r(\d+)c/)?.[1] ?? '1');
  const col = Number(cellId.match(/^r\d+c(\d+)$/)?.[1] ?? '1');
  return { row, col };
}

function templateCellIdForRow(cellId: string): string {
  const { col } = rowColFromCellId(cellId);
  return `r1c${col}`;
}

function effectiveCellConfigForScope(
  cellId: string,
  scope: ReportScope,
  map: Record<string, CellConfig>
): CellConfig {
  if (scope !== 'Multi-Player') return normalizeCellConfig(map[cellId]);
  const { row } = rowColFromCellId(cellId);
  if (row <= 1) return normalizeCellConfig(map[cellId]);
  return normalizeCellConfig(map[templateCellIdForRow(cellId)]);
}

type CustomReportsSuiteProps = {
  initialSchoolCode?: string;
};

export default function CustomReportsSuite({ initialSchoolCode = '' }: CustomReportsSuiteProps) {
  const [chartHover, setChartHover] = useState<{ x: number; y: number; text: string; bg?: string } | null>(null);
  const reportCanvasRef = useRef<HTMLElement | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [isMobileView, setIsMobileView] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState('');
  const [reportSubtitle, setReportSubtitle] = useState('');
  const [reportType, setReportType] = useState<ReportType>('Pitching');
  const [reportTeam, setReportTeam] = useState('All');
  const [reportScope, setReportScope] = useState<ReportScope>('Single Player');
  const [reportPlayers, setReportPlayers] = useState<string[]>(['All']);
  const [reportRows, setReportRows] = useState(1);
  const [reportCols, setReportCols] = useState(1);
  const [reportRowsInput, setReportRowsInput] = useState('1');
  const [reportColsInput, setReportColsInput] = useState('1');
  const [useGlobalDates, setUseGlobalDates] = useState(false);
  const [showPitchTypeKey, setShowPitchTypeKey] = useState(true);
  const [showLocationChartKey, setShowLocationChartKey] = useState(false);
  const [showExitVelocityKey, setShowExitVelocityKey] = useState(false);
  const [showBattedResultsKey, setShowBattedResultsKey] = useState(false);
  const [enableTableColors, setEnableTableColors] = useState(true);
  const [globalStartDate, setGlobalStartDate] = useState('');
  const [globalEndDate, setGlobalEndDate] = useState('');
  const [rowPlayers, setRowPlayers] = useState<string[]>(Array.from({ length: 15 }, () => 'All'));
  const [rowNotes, setRowNotes] = useState<string[]>(Array.from({ length: 15 }, () => ''));
  const [rowNoteSpans, setRowNoteSpans] = useState<number[]>(Array.from({ length: 15 }, () => 1));
  const [cellConfigs, setCellConfigs] = useState<Record<string, CellConfig>>({ r1c1: emptyCell() });
  const [colSpanInputs, setColSpanInputs] = useState<Record<string, string>>({});
  const [savedReports, setSavedReports] = useState<SavedReportItem[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [saveScope, setSaveScope] = useState<'Current School' | 'All Schools'>('Current School');
  const [userRole, setUserRole] = useState<'admin' | 'coach' | 'player'>('coach');
  const [playersByTeam, setPlayersByTeam] = useState<string[]>([]);
  const [playerTeamCodeByName, setPlayerTeamCodeByName] = useState<Record<string, string>>({});
  const [teamTypeOptions, setTeamTypeOptions] = useState<string[]>(['All']);
  const [sessionTypeOptions, setSessionTypeOptions] = useState<string[]>(['All']);
  const [levelOptions, setLevelOptions] = useState<string[]>(['All', 'MLB', 'AAA']);
  const [pitchTypeOptions, setPitchTypeOptions] = useState<string[]>(['All']);
  const [batterSideOptions, setBatterSideOptions] = useState<string[]>(['All']);
  const [pitcherHandOptions, setPitcherHandOptions] = useState<string[]>(['All']);
  const [pitchResultOptions, setPitchResultOptions] = useState<string[]>(['All']);
  const [countOptions, setCountOptions] = useState<string[]>(['All']);
  const [afterCountOptions, setAfterCountOptions] = useState<string[]>(['All']);
  const [zoneLocationOptions, setZoneLocationOptions] = useState<string[]>(['All']);
  const [qpLocationOptions, setQpLocationOptions] = useState<string[]>(['All', 'Yes', 'No']);
  const [inZoneOptions, setInZoneOptions] = useState<string[]>(['All']);
  const [schoolCode, setSchoolCode] = useState(initialSchoolCode);
  const [cellsData, setCellsData] = useState<Record<string, OverviewLitePayload>>({});
  const [tableSorts, setTableSorts] = useState<Record<string, { column: string; direction: SortDirection }>>({});
  const cellsCacheRef = useRef<Map<string, { at: number; payload: OverviewLitePayload }>>(new Map());
  const inflightRef = useRef<Map<string, Promise<OverviewLitePayload>>>(new Map());
  const isAdminUser = userRole === 'admin';
  const hoverTextColor = (bg?: string) => {
    if (!bg) return '#ffffff';
    const color = bg.trim().toLowerCase();
    if (['#ffffff', 'white', '#f8fafc', '#e5e7eb', 'yellow', 'orange'].includes(color)) return '#111827';
    return '#ffffff';
  };
  const pitchTypeCellStyle = (value: string) => {
    const canonical = canonicalPitchType(value);
    if (!canonical) return null;
    const bg = PITCH_COLORS[canonical] ?? '#9ca3af';
    return {
      label: canonical,
      cellStyle: {
        background: bg,
        color: hoverTextColor(bg),
        border: '1px solid rgba(255,255,255,0.28)',
        fontWeight: 700,
      } as const,
    };
  };
  const parseCellNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const num = Number(String(value).replace(/[%+,]/g, '').trim());
    return Number.isFinite(num) ? num : null;
  };
  const tableCellStyle = (column: string, rawValue: unknown, pitchTypeRaw = 'All'): Record<string, string | number> | null => {
    if (!enableTableColors) return null;
    const parsed = parseCellNumber(rawValue);
    if (parsed === null) return null;
    const metric = column.trim();
    const pitchType = String(pitchTypeRaw || 'All').trim().toLowerCase().replace(/\s+/g, '');
    const threshold = (() => {
      const isProSchool = String(schoolCode || '').trim().toUpperCase() === 'PRO';
      if (metric === 'InZone%') {
        if (['fastball', 'sinker'].includes(pitchType)) return isProSchool ? { poor: 48, avg: 55, great: 62 } : { poor: 43, avg: 50, great: 57 };
        if (['cutter', 'slider', 'sweeper', 'curveball'].includes(pitchType)) return { poor: 37, avg: 43, great: 49 };
        if (['changeup', 'splitter', 'knuckleball'].includes(pitchType)) return { poor: 30, avg: 37, great: 44 };
        return isProSchool ? { poor: 44, avg: 49, great: 54 } : { poor: 42, avg: 47, great: 52 };
      }
      if (metric === 'Comp%') return { poor: 76, avg: 79, great: 82 };
      if (metric === 'Strike%') return isProSchool ? { poor: 59, avg: 64, great: 69 } : { poor: 57, avg: 62, great: 67 };
      if (metric === 'Swing%') return { poor: 40, avg: 45, great: 50 };
      if (metric === 'FPS%') return isProSchool ? { poor: 57, avg: 62, great: 67 } : { poor: 55, avg: 60, great: 65 };
      if (metric === 'E+A%') return isProSchool ? { poor: 68, avg: 73, great: 78 } : { poor: 65, avg: 70, great: 75 };
      if (metric === '1-1W%') return { poor: 58, avg: 63, great: 68 };
      if (metric === 'Ahead%') return isProSchool ? { poor: 34, avg: 39, great: 44 } : { poor: 32, avg: 37, great: 42 };
      if (metric === 'QP%') return { poor: 38, avg: 48, great: 58 };
      if (metric === 'Ctrl+') return { poor: 75, avg: 85, great: 95 };
      if (metric === 'QP+') return { poor: 75, avg: 90, great: 105 };
      if (metric === 'Pitching+') return { poor: 80, avg: 95, great: 110 };
      if (metric === 'K%') return { poor: 18, avg: 23, great: 28 };
      if (metric === 'BB%') return { poor: 11, avg: 9, great: 7 };
      if (metric === 'Whiff%') return { poor: 21, avg: 26, great: 31 };
      if (metric === 'CSW%') return { poor: 26, avg: 29, great: 32 };
      if (metric === 'GB%') return { poor: 38, avg: 43, great: 48 };
      if (metric === 'Barrel%') return { poor: 20, avg: 15, great: 10 };
      if (metric === 'EV') return { poor: 95, avg: 85, great: 75 };
      if (metric === 'Stuff+') return { poor: 90, avg: 100, great: 110 };
      if (metric === 'RV/100') return { poor: 0.7, avg: 0, great: -0.7 };
      return null;
    })();
    if (!threshold) return null;
    const reverseScale =
      ['EV', 'Barrel%', 'BB%'].includes(metric) ||
      (metric === 'RV/100' && reportType === 'Pitching');
    const { poor, avg, great } = threshold;
    const color = (() => {
      if (reverseScale) {
        if (parsed >= poor) return { bg: '#0066CC', text: '#ffffff' };
        if (parsed >= (poor + avg) / 2) return { bg: '#66B2FF', text: '#111111' };
        if (parsed >= avg) return { bg: '#FFFFFF', text: '#111111' };
        if (parsed >= (avg + great) / 2) return { bg: '#FFB3B3', text: '#111111' };
        if (parsed >= great) return { bg: '#FF6666', text: '#ffffff' };
        return { bg: '#CC0000', text: '#ffffff' };
      }
      if (parsed <= poor) return { bg: '#0066CC', text: '#ffffff' };
      if (parsed <= (poor + avg) / 2) return { bg: '#66B2FF', text: '#111111' };
      if (parsed <= avg) return { bg: '#FFFFFF', text: '#111111' };
      if (parsed <= (avg + great) / 2) return { bg: '#FFB3B3', text: '#111111' };
      if (parsed <= great) return { bg: '#FF6666', text: '#ffffff' };
      return { bg: '#CC0000', text: '#ffffff' };
    })();
    return {
      background: color.bg,
      color: color.text,
      border: '1px solid rgba(255,255,255,0.28)',
      borderRadius: 4,
      padding: '2px 4px',
      display: 'inline-block',
      minWidth: '100%',
      textAlign: 'center',
    };
  };
  const cellSlots = useMemo(() => {
    const out: Array<{ cellId: string; colSpan: number }> = [];
    const occupied = new Set<string>();
    for (let r = 1; r <= reportRows; r += 1) {
      for (let c = 1; c <= reportCols; c += 1) {
        const key = `r${r}c${c}`;
        if (occupied.has(key)) continue;
        const cfg = effectiveCellConfigForScope(key, reportScope, cellConfigs);
        const colSpan = Math.max(1, Math.min(reportCols - c + 1, Number(cfg.colSpan) || 1));
        for (let cc = c + 1; cc <= c + colSpan - 1; cc += 1) {
          occupied.add(`r${r}c${cc}`);
        }
        out.push({ cellId: key, colSpan });
      }
    }
    return out;
  }, [reportRows, reportCols, reportScope, cellConfigs]);

  const visibleCellKeys = useMemo(() => cellSlots.map((entry) => entry.cellId), [cellSlots]);

  const playerOptions = useMemo<OptionItem[]>(() => {
    const list = playersByTeam.length ? playersByTeam : [];
    return [{ value: 'All', label: 'All' }, ...list.map((entry) => ({ value: entry, label: toFirstLast(entry) }))];
  }, [playersByTeam]);
  const playerLabel = useMemo(() => subjectLabelForReportType(reportType), [reportType]);
  const availableTableModes = useMemo(() => tableOptionsForReportType(reportType), [reportType]);
  const availablePanelTypes = useMemo(() => panelOptionsForReportType(reportType), [reportType]);
  const availableSplitByOptions = useMemo(() => splitByOptionsForReportType(reportType), [reportType]);

  const teamOptions = useMemo<OptionItem[]>(() => {
    const deduped = Array.from(new Set((teamTypeOptions ?? []).map((entry) => String(entry ?? '').trim()).filter(Boolean)));
    const normalized = deduped.map((entry) => ({ value: entry, label: entry }));
    if (!normalized.some((entry) => entry.value === 'All')) return [{ value: 'All', label: 'All' }, ...normalized];
    return normalized;
  }, [teamTypeOptions]);

  useEffect(() => {
    if (!teamOptions.some((entry) => entry.value === reportTeam)) {
      setReportTeam('All');
    }
  }, [teamOptions, reportTeam]);

  const reportOptions = useMemo<OptionItem[]>(
    () =>
      savedReports.map((item) => ({
        value: String(item.id),
        label: String(item.name ?? '').replace(/\s*\(all schools\)\s*$/i, '').trim(),
      })),
    [savedReports]
  );

  const pitchTypeLegend = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const payload of Object.values(cellsData)) {
      for (const point of payload.chart_points ?? []) {
        const value = (point.pitch_type ?? '').trim() || 'Undefined';
        counts[value] = (counts[value] ?? 0) + 1;
      }
    }
    return orderedPitchStats(counts).map(([pitchType]) => pitchType);
  }, [cellsData]);
  const battedResultLegend = useMemo(
    () => ['Single', 'Double', 'Triple', 'HomeRun', 'Out', 'Error', 'FieldersChoice', 'Sacrifice', 'Foul Ball'],
    []
  );

  useEffect(() => {
    setCellConfigs((current) => ensureCellConfigMap(current, reportRows, reportCols));
  }, [reportRows, reportCols]);

  useEffect(() => {
    setColSpanInputs((current) => {
      const next: Record<string, string> = {};
      const validKeys = new Set(Object.keys(cellConfigs));
      for (const [key, value] of Object.entries(current)) {
        if (validKeys.has(key)) next[key] = value;
      }
      return next;
    });
  }, [cellConfigs]);

  useEffect(() => {
    setReportRowsInput(String(reportRows));
  }, [reportRows]);

  useEffect(() => {
    setReportColsInput(String(reportCols));
  }, [reportCols]);

  useEffect(() => {
    setCellConfigs((current) => {
      const next = { ...current };
      const validTables = new Set(tableOptionsForReportType(reportType));
      const fallback = defaultTableModeForReportType(reportType);
      const validPanels = new Set(panelOptionsForReportType(reportType));
      const validSplitBy = new Set(splitByOptionsForReportType(reportType));
      for (const key of Object.keys(next)) {
        const normalized = normalizeCellConfig(next[key]);
        if (!validTables.has(normalized.tableMode)) {
          normalized.tableMode = fallback;
        }
        if (!validPanels.has(normalized.panelType)) {
          normalized.panelType = 'Summary Table';
        }
        if (!validSplitBy.has(normalized.splitBy)) {
          normalized.splitBy = splitByOptionsForReportType(reportType)[0] ?? 'Pitch Types';
        }
        next[key] = normalized;
      }
      return next;
    });
  }, [reportType]);

  useEffect(() => {
    let active = true;
    async function loadFilters() {
      setLoading(true);
      setError(null);
      try {
        const endpoint =
          reportType === 'Pitching'
            ? '/api/dashboard/pitching/filters'
            : reportType === 'Hitting'
              ? '/api/dashboard/hitting/filters'
              : '/api/dashboard/catching/filters';
        const response = await fetch(endpoint, { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) throw new Error(String(payload.error ?? 'Failed to load filters.'));
        if (!active) return;
        if (reportType === 'Pitching') {
          const typed = payload as unknown as PitchingFiltersPayload;
          const pitchers = Array.from(new Set((typed.pitchers ?? []).filter((entry) => entry && entry.trim())));
          setPlayersByTeam(pitchers);
          setPlayerTeamCodeByName(buildPlayerTeamMap(typed.pitchers_by_team_code));
          setSchoolCode(typed.school_code ?? '');
          setTeamTypeOptions(['All', ...Array.from(new Set((typed.team_types ?? []).filter(Boolean)))]);
          setSessionTypeOptions(['All', ...Array.from(new Set((typed.session_types ?? []).filter(Boolean)))]);
          setLevelOptions(['All', ...Array.from(new Set((typed.level_options ?? ['MLB', 'AAA']).filter(Boolean)))]);
          setPitchTypeOptions(['All', ...Array.from(new Set((typed.pitch_types ?? []).filter(Boolean)))]);
          setBatterSideOptions(['All', ...Array.from(new Set((typed.batter_sides ?? []).filter(Boolean)))]);
          setPitcherHandOptions(['All', ...Array.from(new Set((typed.hands ?? []).filter(Boolean)))]);
          setPitchResultOptions(['All', ...Array.from(new Set((typed.pitch_results ?? []).filter(Boolean)))]);
          setCountOptions(['All', ...Array.from(new Set((typed.count_options ?? []).filter(Boolean)))]);
          setAfterCountOptions(['All', ...Array.from(new Set((typed.after_count_options ?? []).filter(Boolean)))]);
          setZoneLocationOptions(['All', ...Array.from(new Set((typed.zone_locations ?? []).filter(Boolean)))]);
          setQpLocationOptions(['All', ...Array.from(new Set((typed.qp_location_options ?? []).filter(Boolean)))]);
          setInZoneOptions(['All', ...Array.from(new Set((typed.in_zone_options ?? []).filter(Boolean)))]);
          const min = toYmd(typed.min_date);
          const max = toYmd(typed.max_date);
          setGlobalStartDate(max || min || '');
          setGlobalEndDate(max || min || '');
        } else if (reportType === 'Hitting') {
          const typed = payload as unknown as HittingFiltersPayload;
          const hitters = Array.from(new Set((typed.hitters ?? []).filter((entry) => entry && entry.trim())));
          setPlayersByTeam(hitters);
          setPlayerTeamCodeByName(buildPlayerTeamMap(typed.hitters_by_team_code));
          setSchoolCode(typed.school_code ?? '');
          setTeamTypeOptions(['All', ...Array.from(new Set((typed.team_types ?? []).filter(Boolean)))]);
          setSessionTypeOptions(['All', ...Array.from(new Set((typed.session_types ?? ['Bullpen', 'Live BP', 'Season']).filter(Boolean)))]);
          setLevelOptions(['All', ...Array.from(new Set((typed.level_options ?? ['MLB', 'AAA']).filter(Boolean)))]);
          setPitchTypeOptions(['All', ...Array.from(new Set((typed.pitch_types ?? []).filter(Boolean)))]);
          setBatterSideOptions(['All', ...Array.from(new Set((typed.batter_sides ?? []).filter(Boolean)))]);
          setPitcherHandOptions(['All', ...Array.from(new Set((typed.hands ?? []).filter(Boolean)))]);
          setPitchResultOptions(['All', ...Array.from(new Set((typed.pitch_results ?? []).filter(Boolean)))]);
          setCountOptions(['All', ...Array.from(new Set((typed.count_options ?? []).filter(Boolean)))]);
          setAfterCountOptions(['All', ...Array.from(new Set((typed.after_count_options ?? []).filter(Boolean)))]);
          setZoneLocationOptions(['All', ...Array.from(new Set((typed.zone_locations ?? []).filter(Boolean)))]);
          setInZoneOptions(['All', ...Array.from(new Set((typed.in_zone_options ?? []).filter(Boolean)))]);
          setQpLocationOptions(['All', 'Yes', 'No']);
          const min = toYmd(typed.min_date);
          const max = toYmd(typed.max_date);
          setGlobalStartDate(max || min || '');
          setGlobalEndDate(max || min || '');
        } else {
          const typed = payload as unknown as CatchingFiltersPayload;
          const catchers = Array.from(new Set((typed.catchers ?? []).filter((entry) => entry && entry.trim())));
          setPlayersByTeam(catchers);
          setPlayerTeamCodeByName(buildPlayerTeamMap(typed.catchers_by_team_code));
          setSchoolCode(typed.school_code ?? '');
          setTeamTypeOptions(['All', ...Array.from(new Set((typed.team_types ?? []).filter(Boolean)))]);
          setSessionTypeOptions(['All', ...Array.from(new Set((['Season', 'Bullpen', 'Live BP'] as const).filter(Boolean)))]);
          setLevelOptions(['All', ...Array.from(new Set((typed.level_options ?? ['MLB', 'AAA']).filter(Boolean)))]);
          setPitchTypeOptions(['All', ...Array.from(new Set((typed.pitch_types ?? []).filter(Boolean)))]);
          setBatterSideOptions(['All', ...Array.from(new Set((typed.batter_sides ?? []).filter(Boolean)))]);
          setPitcherHandOptions(['All', ...Array.from(new Set((typed.hands ?? []).filter(Boolean)))]);
          setPitchResultOptions(['All', ...Array.from(new Set((typed.pitch_results ?? []).filter(Boolean)))]);
          setCountOptions(['All', ...Array.from(new Set((typed.count_options ?? []).filter(Boolean)))]);
          setAfterCountOptions(['All', ...Array.from(new Set((typed.after_count_options ?? []).filter(Boolean)))]);
          setZoneLocationOptions(['All', ...Array.from(new Set((typed.zone_locations ?? []).filter(Boolean)))]);
          setInZoneOptions(['All', ...Array.from(new Set((typed.in_zone_options ?? []).filter(Boolean)))]);
          setQpLocationOptions(['All', 'Yes', 'No']);
          const min = toYmd(typed.min_date);
          const max = toYmd(typed.max_date);
          setGlobalStartDate(max || min || '');
          setGlobalEndDate(max || min || '');
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load filters.');
      } finally {
        if (active) setLoading(false);
      }
    }
    loadFilters();
    return () => {
      active = false;
    };
  }, [reportType]);

  useEffect(() => {
    let active = true;
    async function loadSessionRole() {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as { role?: string };
        if (!active) return;
        const normalized: 'admin' | 'coach' | 'player' =
          payload.role === 'player' ? 'player' : payload.role === 'admin' ? 'admin' : 'coach';
        setUserRole(normalized);
      } catch {
        if (!active) return;
        setUserRole('coach');
      }
    }
    loadSessionRole();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isAdminUser && saveScope !== 'Current School') {
      setSaveScope('Current School');
    }
  }, [isAdminUser, saveScope]);

  useEffect(() => {
    let active = true;
    async function loadReports() {
      try {
        const response = await fetch('/api/dashboard/custom-reports', { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as { items?: SavedReportItem[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load saved reports.');
        if (!active) return;
        setSavedReports(payload.items ?? []);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load saved reports.');
      }
    }
    loadReports();
    return () => {
      active = false;
    };
  }, [schoolCode]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const CACHE_TTL_MS = 20_000;
    async function loadCellsData() {
      const requests = visibleCellKeys
        .map((cellId) => ({ cellId, config: effectiveCellConfigForScope(cellId, reportScope, cellConfigs) }))
        .filter(({ config }) => config && config.panelType !== 'Note Section')
        .slice(0, 24);
      if (!requests.length) {
        setCellsData({});
        return;
      }
      const out: Record<string, OverviewLitePayload> = {};
      await Promise.all(
        requests.map(async ({ cellId, config }) => {
          const rowNum = Number(cellId.match(/^r(\d+)c/)?.[1] ?? '1');
          const singleScopePlayer =
            config.player && config.player !== 'All' ? config.player : reportPlayers[0] || 'All';
          const scopePlayer = reportScope === 'Multi-Player' ? rowPlayers[rowNum - 1] ?? 'All' : singleScopePlayer;
          const normalizedPlayer = normalizeNameForApi(scopePlayer);
          const startDate = useGlobalDates ? globalStartDate : config.dateStart || globalStartDate;
          const endDate = useGlobalDates ? globalEndDate : config.dateEnd || globalEndDate;
          const cellFilters = config.filterSelect ?? ['Dates', 'Session Type', 'Pitch Types'];
          const params = new URLSearchParams();
          const isProSchool = String(activeSchoolCode || schoolCode || '').trim().toUpperCase() === 'PRO';
          if (startDate) params.set('start_date', startDate);
          if (endDate) params.set('end_date', endDate);
          params.set('split_by', config.splitBy || 'Pitch Types');
          params.set('table_mode', config.tableMode || defaultTableModeForReportType(reportType));
          if (cellFilters.includes('Session Type')) {
            const sessionOrLevel = (config.sessionType || (isProSchool ? 'MLB' : 'All')).trim();
            if (sessionOrLevel && sessionOrLevel !== 'All') {
              if (isProSchool) params.set('level', sessionOrLevel);
              else params.set('session_type', sessionOrLevel);
            }
          }
          if (cellFilters.includes('Pitch Types')) {
            const pitchTypes = selectedValues(config.pitchTypes);
            if (pitchTypes.length) params.set('pitch_types', pitchTypes.join(','));
          }
          if (cellFilters.includes('Batter Hand') && config.batterSide && config.batterSide !== 'All') {
            params.set('batter_side', config.batterSide);
          }
          if (cellFilters.includes('Pitcher Hand') && config.pitcherHand && config.pitcherHand !== 'All') {
            params.set('hand', config.pitcherHand);
          }
          if (cellFilters.includes('Pitch Results')) {
            const pitchResults = selectedValues(config.pitchResults);
            if (pitchResults.length) params.set('pitch_results', pitchResults.join(','));
          }
          if (cellFilters.includes('QP Locations') && config.qpLocations && config.qpLocations !== 'All' && reportType === 'Pitching') {
            params.set('qp_locations', config.qpLocations);
          }
          if (cellFilters.includes('In Zone') && config.inZone && config.inZone !== 'All') {
            params.set('in_zone', config.inZone);
          }
          if (cellFilters.includes('Count')) {
            const counts = selectedValues(config.countFilter);
            if (counts.length) params.set('count_filter', counts.join(','));
          }
          if (cellFilters.includes('After Count')) {
            const afterCounts = selectedValues(config.afterCountFilter);
            if (afterCounts.length) params.set('after_count_filter', afterCounts.join(','));
          }
          if (cellFilters.includes('Zone Location')) {
            const zones = selectedValues(config.zoneLocations);
            if (zones.length) params.set('zone_locations', zones.join(','));
          }
          if (cellFilters.includes('Velo Min/Max')) {
            if ((config.veloMin ?? '').trim()) params.set('velo_min', String(config.veloMin).trim());
            if ((config.veloMax ?? '').trim()) params.set('velo_max', String(config.veloMax).trim());
          }
          if (cellFilters.includes('IVB Min/Max')) {
            if ((config.ivbMin ?? '').trim()) params.set('ivb_min', String(config.ivbMin).trim());
            if ((config.ivbMax ?? '').trim()) params.set('ivb_max', String(config.ivbMax).trim());
          }
          if (cellFilters.includes('HB Min/Max')) {
            if ((config.hbMin ?? '').trim()) params.set('hb_min', String(config.hbMin).trim());
            if ((config.hbMax ?? '').trim()) params.set('hb_max', String(config.hbMax).trim());
          }
          if (reportType === 'Pitching') {
            if (normalizedPlayer) params.set('pitcher', normalizedPlayer);
            if (reportTeam && reportTeam !== 'All') params.set('team_type', reportTeam);
          } else if (reportType === 'Hitting') {
            if (normalizedPlayer) params.set('hitter', normalizedPlayer);
          } else {
            if (normalizedPlayer) params.set('catcher', normalizedPlayer);
            if (reportTeam && reportTeam !== 'All') params.set('team_type', reportTeam);
          }
          const endpoint =
            reportType === 'Pitching'
              ? '/api/dashboard/pitching/overview'
              : reportType === 'Hitting'
                ? '/api/dashboard/hitting/overview'
                : '/api/dashboard/catching/overview';
          const query = params.toString();
          const key = `${endpoint}?${query}`;
          try {
            const now = Date.now();
            const cached = cellsCacheRef.current.get(key);
            if (cached && now - cached.at < CACHE_TTL_MS) {
              out[cellId] = cached.payload;
              return;
            }
            const running = inflightRef.current.get(key);
            if (running) {
              out[cellId] = await running;
              return;
            }
            const requestPromise = (async () => {
              const response = await fetch(key, { cache: 'no-store', signal: controller.signal });
              const payload = (await response.json().catch(() => ({}))) as OverviewLitePayload & { error?: string };
              if (!response.ok) throw new Error(payload.error ?? 'Request failed');
              const normalized = payload ?? {};
              cellsCacheRef.current.set(key, { at: Date.now(), payload: normalized });
              return normalized;
            })();
            inflightRef.current.set(key, requestPromise);
            try {
              out[cellId] = await requestPromise;
            } finally {
              inflightRef.current.delete(key);
            }
          } catch {
            out[cellId] = {};
          }
        })
      );
      if (!active) return;
      setCellsData(out);
    }
    const timer = window.setTimeout(loadCellsData, 140);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    visibleCellKeys,
    cellConfigs,
    reportType,
    reportScope,
    rowPlayers,
    reportPlayers,
    useGlobalDates,
    globalStartDate,
    globalEndDate,
    reportTeam,
  ]);

  const applyPayload = (payload: ReportPayload) => {
    setReportTitle(payload.title ?? '');
    setReportSubtitle(payload.subtitle ?? '');
    setReportType((payload.type as ReportType) || 'Pitching');
    const rawTeam = String(payload.team ?? '').trim();
    const normalizedTeam = rawTeam.toUpperCase() === 'OSU' && schoolCode && schoolCode.toUpperCase() !== 'OSU' ? schoolCode : rawTeam;
    setReportTeam(normalizedTeam || 'All');
    setReportScope((payload.scope as ReportScope) || 'Single Player');
    setReportPlayers(payload.players?.length ? payload.players : ['All']);
    setReportRows(Math.max(1, Math.min(15, Number(payload.rows) || 1)));
    setReportCols(Math.max(1, Math.min(5, Number(payload.cols) || 1)));
    setUseGlobalDates(Boolean(payload.useGlobalDates));
    setShowPitchTypeKey(payload.showPitchTypeKey !== false);
    setShowLocationChartKey(Boolean(payload.showLocationChartKey));
    setShowExitVelocityKey(Boolean(payload.showExitVelocityKey));
    setShowBattedResultsKey(Boolean(payload.showBattedResultsKey));
    setEnableTableColors(payload.enableTableColors !== false);
    setGlobalStartDate(payload.globalStartDate || '');
    setGlobalEndDate(payload.globalEndDate || '');
    setRowPlayers(Array.from({ length: 15 }, (_, idx) => payload.rowPlayers?.[idx] ?? 'All'));
    setRowNotes(Array.from({ length: 15 }, (_, idx) => payload.rowNotes?.[idx] ?? ''));
    setRowNoteSpans(Array.from({ length: 15 }, (_, idx) => Math.max(1, Number(payload.rowNoteSpans?.[idx]) || 1)));
    setCellConfigs(ensureCellConfigMap(payload.cells ?? {}, Math.max(1, Math.min(15, Number(payload.rows) || 1)), Math.max(1, Math.min(5, Number(payload.cols) || 1))));
  };

  const currentPayload = (): ReportPayload => ({
    title: reportTitle,
    subtitle: reportSubtitle,
    type: reportType,
    team: reportTeam,
    scope: reportScope,
    players: reportPlayers,
    rows: reportRows,
    cols: reportCols,
    useGlobalDates,
    showPitchTypeKey,
    showLocationChartKey,
    showExitVelocityKey,
    showBattedResultsKey,
    enableTableColors,
    globalStartDate,
    globalEndDate,
    rowPlayers,
    rowNotes,
    rowNoteSpans,
    cells: ensureCellConfigMap(cellConfigs, reportRows, reportCols),
  });

  const saveReport = async () => {
    const selected = savedReports.find((entry) => entry.id === selectedReportId);
    const fallbackName = reportTitle.trim() || `Custom Report ${new Date().toLocaleDateString()}`;
    const name = window.prompt('Report name', selected?.name || fallbackName)?.trim();
    if (!name) return;
    try {
      const response = await fetch('/api/dashboard/custom-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: selected?.id,
          name,
          applyToAllSchools: isAdminUser && saveScope === 'All Schools',
          payload: currentPayload(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { item?: SavedReportItem; error?: string };
      if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Save failed');
      const item = payload.item;
      setSavedReports((current) => {
        const rest = current.filter((entry) => entry.id !== item.id);
        return [item, ...rest].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
      });
      setSelectedReportId(item.id);
      setSaveScope(isAdminUser && item.applyToAllSchools ? 'All Schools' : 'Current School');
      if (!reportTitle.trim()) setReportTitle(item.name);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const deleteReport = async () => {
    if (!selectedReportId) return;
    if (!window.confirm('Delete selected report?')) return;
    try {
      const response = await fetch(`/api/dashboard/custom-reports?id=${selectedReportId}`, { method: 'DELETE' });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Delete failed');
      setSavedReports((current) => current.filter((entry) => entry.id !== selectedReportId));
      setSelectedReportId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const resetReport = () => {
    setReportTitle('');
    setReportSubtitle('');
    setReportScope('Single Player');
    setReportPlayers(['All']);
    setReportRows(1);
    setReportCols(1);
    setUseGlobalDates(false);
    setShowPitchTypeKey(true);
    setRowPlayers(Array.from({ length: 15 }, () => 'All'));
    setRowNotes(Array.from({ length: 15 }, () => ''));
    setRowNoteSpans(Array.from({ length: 15 }, () => 1));
    setCellConfigs({ r1c1: emptyCell() });
    setSelectedReportId(null);
    setSaveScope('Current School');
  };

  const applyReportRowsInput = () => {
    const parsed = Number(reportRowsInput);
    const normalized = Number.isFinite(parsed) ? Math.max(1, Math.min(15, Math.trunc(parsed))) : reportRows;
    setReportRows(normalized);
    setReportRowsInput(String(normalized));
  };

  const applyReportColsInput = () => {
    const parsed = Number(reportColsInput);
    const normalized = Number.isFinite(parsed) ? Math.max(1, Math.min(5, Math.trunc(parsed))) : reportCols;
    setReportCols(normalized);
    setReportColsInput(String(normalized));
  };

  const applyColSpanInput = (cellId: string, maxSpan: number, fallback: number) => {
    const raw = colSpanInputs[cellId];
    const parsed = Number(raw);
    const normalized = Number.isFinite(parsed) ? Math.max(1, Math.min(maxSpan, Math.trunc(parsed))) : Math.max(1, Math.min(maxSpan, fallback || 1));
    setCellConfigs((current) => ({
      ...current,
      [cellId]: {
        ...(current[cellId] ?? emptyCell()),
        colSpan: normalized,
      },
    }));
    setColSpanInputs((current) => ({ ...current, [cellId]: String(normalized) }));
  };
  const downloadReportPdf = async () => {
    const reportNode = reportCanvasRef.current;
    if (!reportNode) return;
    try {
      setIsExportingPdf(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const canvas = await html2canvas(reportNode, {
        backgroundColor: '#000000',
        scale: 2,
        useCORS: true,
        logging: false,
        ignoreElements: (element) => element.getAttribute?.('data-export-ignore') === 'true',
      });
      const margin = 18;
      const maxPageWidth = 1400;
      const rawW = Math.max(1, canvas.width);
      const rawH = Math.max(1, canvas.height);
      const scale = Math.min(1, (maxPageWidth - margin * 2) / rawW);
      const drawW = rawW * scale;
      const drawH = rawH * scale;
      const pageWidth = drawW + margin * 2;
      const pageHeight = drawH + margin * 2;
      const orientation: 'portrait' | 'landscape' = pageWidth > pageHeight ? 'landscape' : 'portrait';

      const pdf = new jsPDF({
        orientation,
        unit: 'pt',
        format: [pageWidth, pageHeight],
      });
      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = Math.max(1, Math.round(pageWidth));
      bgCanvas.height = Math.max(1, Math.round(pageHeight));
      const bgCtx = bgCanvas.getContext('2d');
      if (bgCtx) {
        bgCtx.fillStyle = '#040507';
        bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

        const topLinear = bgCtx.createLinearGradient(0, 0, 0, bgCanvas.height);
        topLinear.addColorStop(0, 'rgba(200,16,46,0.28)');
        topLinear.addColorStop(0.38, 'rgba(200,16,46,0.08)');
        topLinear.addColorStop(1, 'rgba(0,0,0,0)');
        bgCtx.fillStyle = topLinear;
        bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

        const glow = bgCtx.createRadialGradient(
          bgCanvas.width * 0.5,
          bgCanvas.height * 0.12,
          0,
          bgCanvas.width * 0.5,
          bgCanvas.height * 0.12,
          bgCanvas.width * 0.95
        );
        glow.addColorStop(0, 'rgba(200,16,46,0.52)');
        glow.addColorStop(0.42, 'rgba(200,16,46,0.22)');
        glow.addColorStop(1, 'rgba(200,16,46,0)');
        bgCtx.fillStyle = glow;
        bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
      }
      pdf.addImage(bgCanvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, drawW, drawH, undefined, 'FAST');

      const safeName = (reportHeaderTitle || 'custom-report').replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-');
      pdf.save(`${safeName}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const reportHeaderTitle = useMemo(() => reportTitle.trim() || 'Custom Report', [reportTitle]);
  const activeSchoolCode = schoolCode || initialSchoolCode;
  const schoolBrand = useMemo(() => resolveSchoolBrand(activeSchoolCode), [activeSchoolCode]);
  const isProSchool = String(activeSchoolCode || '').trim().toUpperCase() === 'PRO';
  const reportHeaderPlayer = useMemo(() => {
    if (reportScope === 'Multi-Player') return 'Multi-Player';
    const chosen = selectedValues(reportPlayers);
    if (!chosen.length) return 'All';
    return chosen.map((name) => toFirstLast(name) || name).join(', ');
  }, [reportScope, reportPlayers]);
  const customReportRightLogoSrc = useMemo(() => {
    if (!isProSchool) return schoolBrand.logoSrc ?? '/pitching-coach-u-logo.png';
    const chosen = reportScope === 'Single Player' ? selectedValues(reportPlayers) : [];
    let teamCode = '';
    if (chosen.length === 1) {
      const selected = chosen[0] ?? '';
      const formatted = toFirstLast(selected);
      teamCode =
        playerTeamCodeByName[selected] ??
        playerTeamCodeByName[formatted] ??
        playerTeamCodeByName[normalizeNameKey(selected)] ??
        playerTeamCodeByName[normalizeNameKey(formatted)] ??
        '';
    }
    if (!teamCode && reportTeam && reportTeam !== 'All') {
      teamCode = inferProTeamCode(reportTeam);
    }
    if (!teamCode) return '/mlb-logo.png';
    return getProTeamLogoUrl(teamCode) || '/mlb-logo.png';
  }, [isProSchool, schoolBrand.logoSrc, reportScope, reportPlayers, playerTeamCodeByName, reportTeam]);
  const customReportRightLogoAlt = useMemo(() => {
    if (!isProSchool) return schoolBrand.logoSrc ? schoolBrand.logoAlt : schoolCode || 'School';
    return 'Team';
  }, [isProSchool, schoolBrand.logoSrc, schoolBrand.logoAlt, schoolCode]);

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
    setSidebarVisible(false);
  }, [isMobileView]);

  return (
    <section className="portal-panel portal-admin-panel" style={{ padding: '1rem' }}>
      <div className="portal-custom-reports-download-row">
        {!sidebarVisible || isMobileView ? (
          <button type="button" className="btn btn-ghost" onClick={() => setSidebarVisible((value) => !value)}>
            {sidebarVisible ? 'Hide Filters' : 'Show Filters'}
          </button>
        ) : null}
        <button type="button" className="btn btn-primary" onClick={downloadReportPdf}>
          Download as PDF
        </button>
      </div>
      <div className={`portal-dashboard-suite-layout portal-custom-reports-layout${sidebarVisible ? '' : ' portal-custom-reports-layout--no-sidebar'}`}>
        {sidebarVisible ? (
          <article className="portal-admin-card portal-dashboard-sidebar portal-custom-reports-sidebar">
            <button type="button" className="btn btn-ghost" onClick={() => setSidebarVisible(false)}>
              Hide Filters
            </button>
            <h3>Report Setup</h3>
            <div className="portal-form-grid">
              <label>
                Report Title
                <input value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} />
              </label>
              <label>
                Header Note (optional)
                <input value={reportSubtitle} onChange={(event) => setReportSubtitle(event.target.value)} />
              </label>
              <label>
                Report Type
                <SearchableSingleSelect
                  options={[
                    { value: 'Pitching', label: 'Pitching' },
                    { value: 'Hitting', label: 'Hitting' },
                    { value: 'Catching', label: 'Catching' },
                  ]}
                  value={reportType}
                  onChange={(next) => setReportType((next as ReportType) || 'Pitching')}
                />
              </label>
              <label>
                Team
                <SearchableSingleSelect options={teamOptions} value={reportTeam} onChange={setReportTeam} />
              </label>
              <label>
                Scope
                <SearchableSingleSelect
                  options={[
                    { value: 'Single Player', label: 'Single Player' },
                    { value: 'Multi-Player', label: 'Multi-Player' },
                  ]}
                  value={reportScope}
                  onChange={(next) => setReportScope((next as ReportScope) || 'Single Player')}
                />
              </label>
              {reportScope === 'Single Player' ? (
                <label>
                  {`${playerLabel}s`}
                  <SearchableMultiSelect options={playerOptions} values={reportPlayers} onChange={setReportPlayers} />
                </label>
              ) : (
                <label>
                  Multi-Player
                  <div className="portal-muted-text">Each row = 1 player</div>
                </label>
              )}
              <label>
                Rows
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={reportRowsInput}
                  onChange={(event) => setReportRowsInput(event.target.value)}
                  onBlur={applyReportRowsInput}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyReportRowsInput();
                    }
                  }}
                />
              </label>
              <label>
                Columns
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={reportColsInput}
                  onChange={(event) => setReportColsInput(event.target.value)}
                  onBlur={applyReportColsInput}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyReportColsInput();
                    }
                  }}
                />
              </label>
            </div>
            <div className="portal-custom-reports-sidebar-groups">
              <div className="portal-custom-reports-toggle-list">
                <label className="portal-checkbox-label">
                  <input type="checkbox" checked={useGlobalDates} onChange={(event) => setUseGlobalDates(event.target.checked)} />
                  Apply one date range to all panels
                </label>
                <label className="portal-checkbox-label">
                  <input type="checkbox" checked={showPitchTypeKey} onChange={(event) => setShowPitchTypeKey(event.target.checked)} />
                  Show pitch type key
                </label>
                <label className="portal-checkbox-label">
                  <input type="checkbox" checked={showLocationChartKey} onChange={(event) => setShowLocationChartKey(event.target.checked)} />
                  Show location chart key
                </label>
                <label className="portal-checkbox-label">
                  <input type="checkbox" checked={showExitVelocityKey} onChange={(event) => setShowExitVelocityKey(event.target.checked)} />
                  Show exit velocity key
                </label>
                <label className="portal-checkbox-label">
                  <input type="checkbox" checked={showBattedResultsKey} onChange={(event) => setShowBattedResultsKey(event.target.checked)} />
                  Show batted results key
                </label>
                <label className="portal-checkbox-label">
                  <input type="checkbox" checked={enableTableColors} onChange={(event) => setEnableTableColors(event.target.checked)} />
                  Color code tables
                </label>
              </div>

              {useGlobalDates ? (
                <div className="portal-form-grid portal-custom-reports-global-dates">
                  <label>
                    Global Start Date
                    <input type="date" value={globalStartDate} onChange={(event) => setGlobalStartDate(event.target.value)} />
                  </label>
                  <label>
                    Global End Date
                    <input type="date" value={globalEndDate} onChange={(event) => setGlobalEndDate(event.target.value)} />
                  </label>
                </div>
              ) : null}

              <label className="portal-custom-reports-saved">
                Saved Reports
                <SearchableSingleSelect
                  options={reportOptions}
                  value={selectedReportId ? String(selectedReportId) : ''}
                  placeholder="Select saved report"
                  onChange={(next) => {
                    const id = Number(next);
                    if (!Number.isFinite(id) || id <= 0) {
                      setSelectedReportId(null);
                      return;
                    }
                    setSelectedReportId(id);
                    const selected = savedReports.find((entry) => entry.id === id);
                    if (selected && selected.payload && typeof selected.payload === 'object') {
                      applyPayload(selected.payload as ReportPayload);
                    }
                    setSaveScope(isAdminUser && selected?.applyToAllSchools ? 'All Schools' : 'Current School');
                  }}
                />
              </label>
              {isAdminUser ? (
                <label>
                  Save Scope
                  <SearchableSingleSelect
                    options={[
                      { value: 'Current School', label: 'Current School' },
                      { value: 'All Schools', label: 'All Schools' },
                    ]}
                    value={saveScope}
                    onChange={(next) => setSaveScope(next === 'All Schools' ? 'All Schools' : 'Current School')}
                  />
                </label>
              ) : null}
            </div>
            {reportScope === 'Multi-Player' ? (
              <div className="portal-custom-reports-row-players">
                {Array.from({ length: reportRows }, (_, idx) => idx + 1).map((rowNumber) => (
                  <div key={rowNumber} className="portal-custom-reports-row-player-item">
                    <label>{`Row ${rowNumber} ${playerLabel}`}</label>
                    <SearchableSingleSelect
                      options={playerOptions}
                      value={rowPlayers[rowNumber - 1] ?? 'All'}
                      onChange={(next) =>
                        setRowPlayers((current) => {
                          const out = [...current];
                          out[rowNumber - 1] = next;
                          return out;
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            ) : null}
            <div className="portal-custom-reports-actions">
              <button type="button" className="btn btn-ghost" onClick={resetReport}>
                New Report
              </button>
              <button type="button" className="btn btn-primary" onClick={saveReport}>
                Save Report
              </button>
              <button type="button" className="btn btn-danger" onClick={deleteReport} disabled={!selectedReportId}>
                Delete Report
              </button>
            </div>
            {loading ? <p className="portal-muted-text">Loading filters...</p> : null}
            {error ? <p className="portal-error-text">{error}</p> : null}
          </article>
        ) : null}
        <div className="portal-admin-stack">
            <article
              ref={reportCanvasRef}
              className={`portal-day-card portal-custom-reports-canvas${isExportingPdf ? ' portal-custom-reports-canvas--export' : ''}`}
            >
              <div className="portal-custom-reports-brandbar">
                <img src="/pitching-coach-u-logo.png" alt="PCU" className="portal-custom-reports-brand-logo portal-custom-reports-brand-logo--pcu" />
                <header className="portal-custom-reports-header">
                  <h3>{reportHeaderTitle}</h3>
                  <p>{reportHeaderPlayer}</p>
                  {reportSubtitle ? <p>{reportSubtitle}</p> : null}
                </header>
                <img
                  src={customReportRightLogoSrc}
                  alt={customReportRightLogoAlt}
                  className={`portal-custom-reports-brand-logo portal-custom-reports-brand-logo--school${
                    String(activeSchoolCode || '').toUpperCase() === 'GCU' ? ' portal-custom-reports-brand-logo--school-gcu' : ''
                  }`}
                />
              </div>
              <div className="portal-custom-reports-grid" style={{ gridTemplateColumns: `repeat(${reportCols}, minmax(0, 1fr))` }}>
                {cellSlots.map(({ cellId, colSpan }) => {
                  const rawConfig = normalizeCellConfig(cellConfigs[cellId]);
                  const config = effectiveCellConfigForScope(cellId, reportScope, cellConfigs);
                  const payload = cellsData[cellId] ?? {};
                  const tableColumns = payload.table_columns ?? [];
                  const tableRows = payload.table_rows ?? [];
                  const tableSort = tableSorts[cellId];
                  const sortedRowsBase =
                    tableSort?.column && tableColumns.includes(tableSort.column)
                      ? sortTableRows(tableRows, tableSort.column, tableSort.direction, tableColumns[0] ?? '')
                      : tableRows;
                  const sortedTableRows =
                    (config.splitBy || 'Pitch Types') === 'Times Through Order'
                      ? reorderTimesThroughOrderRows(sortedRowsBase, tableColumns[0] ?? '')
                      : (config.splitBy || 'Pitch Types') === 'Inning'
                        ? reorderInningRows(sortedRowsBase, tableColumns[0] ?? '')
                      : (config.splitBy || 'Pitch Types') === 'Pitch Count'
                        ? reorderPitchCountRows(sortedRowsBase, tableColumns[0] ?? '')
                      : sortedRowsBase;
                  const chartPoints = payload.chart_points ?? [];
                  const heatmapPoints = payload.heatmap_points ?? chartPoints;
                  const { row: rowNumber, col: colNumber } = rowColFromCellId(cellId);
                  const isTemplateDrivenCell = reportScope === 'Multi-Player' && rowNumber > 1;
                  const inheritedPlayer =
                    reportScope === 'Multi-Player'
                      ? rowPlayers[rowNumber - 1] ?? 'All'
                      : config.player && config.player !== 'All'
                        ? config.player
                        : reportPlayers[0] || 'All';
                  const tableModeOptions = availableTableModes.map((entry) => ({
                    value: entry,
                    label: entry,
                  }));
                  const panelTypeOptions = availablePanelTypes.map((entry) => ({
                    value: entry,
                    label: entry || 'Select',
                  }));
                  const filterTokenOptions = FILTER_TOKENS.map((entry) => ({ value: entry, label: entry }));
                  const splitByOptions = availableSplitByOptions.map((entry) => ({ value: entry, label: splitByLabel(entry) }));
                  const contentType = normalizePanelType(config.panelType);
                  const isNote = contentType === 'Note Section';
                  const isSummaryTable = contentType === 'Summary Table';
                  const isLocation = contentType === 'Location Plot';
                  const isHeatMap = contentType === 'Heatmap';
                  const isVelocityLike = contentType === 'Velocity Chart' || contentType === 'Velocity Bar Chart' || contentType === 'Velocity Distribution';
                  const pitchTypeCounts = chartPoints.reduce<Record<string, number>>((acc, point) => {
                    const key = (point.pitch_type ?? '').trim() || 'Undefined';
                    acc[key] = (acc[key] ?? 0) + 1;
                    return acc;
                  }, {});
                  const pitchTypeCountList = orderedPitchStats(pitchTypeCounts);
                  const totalPitchCount = chartPoints.length || 1;
                  const pieTotal = pitchTypeCountList.reduce((sum, entry) => sum + entry[1], 0) || 1;
                  const isProSchool = String(activeSchoolCode || schoolCode || '').trim().toUpperCase() === 'PRO';
                  const heatCells = isHeatMap ? buildHeatCells(heatmapPoints, config.heatStat || 'Frequency', isProSchool) : [];

                  return (
                    <article
                      key={cellId}
                      className={`portal-custom-reports-cell${!(config.showControls ?? true) ? ' portal-custom-reports-cell--collapsed' : ''}`}
                      style={{ gridColumn: `span ${colSpan}` }}
                    >
                      {reportScope === 'Multi-Player' && colNumber === 1 ? (
                        <div className="portal-custom-reports-row-player-label">
                          {toFirstLast(inheritedPlayer) || 'All'}
                        </div>
                      ) : null}
                      <div className="portal-custom-reports-cell-controls">
                        {!isExportingPdf ? (
                          <button
                            type="button"
                            className={`btn btn-ghost ${(config.showControls ?? true) ? '' : 'portal-custom-reports-show-btn'}`.trim()}
                            data-export-ignore="true"
                            disabled={isTemplateDrivenCell}
                            onClick={() =>
                              isTemplateDrivenCell
                                ? undefined
                                :
                              setCellConfigs((current) => ({
                                ...current,
                                [cellId]: { ...(current[cellId] ?? emptyCell()), showControls: !(current[cellId]?.showControls ?? true) },
                              }))
                            }
                          >
                            {(config.showControls ?? true) ? 'Hide Filters' : 'Show Filters'}
                          </button>
                        ) : null}
                        {(config.showControls ?? true) ? (
                          <>
                        {isTemplateDrivenCell ? (
                          <div className="portal-muted-text">This row mirrors Row 1 settings for this column.</div>
                        ) : null}
                        {!isTemplateDrivenCell ? (
                          <>
                        <SearchableSingleSelect
                          options={panelTypeOptions}
                          value={contentType}
                          onChange={(next) =>
                            setCellConfigs((current) => ({
                              ...current,
                              [cellId]: { ...(current[cellId] ?? emptyCell()), panelType: normalizePanelType(next as PanelType) || 'Summary Table' },
                            }))
                          }
                        />
                        {reportScope === 'Single Player' ? (
                          <SearchableSingleSelect
                            options={playerOptions}
                            value={inheritedPlayer || 'All'}
                            onChange={(next) =>
                              setCellConfigs((current) => ({
                                ...current,
                                [cellId]: { ...(current[cellId] ?? emptyCell()), player: next },
                              }))
                            }
                          />
                        ) : (
                          <div className="portal-muted-text">{`${playerLabel}: ${toFirstLast(inheritedPlayer) || 'All'}`}</div>
                        )}
                        <input
                          placeholder="Panel title (optional)"
                          value={config.title}
                          onChange={(event) =>
                            setCellConfigs((current) => ({
                              ...current,
                              [cellId]: { ...(current[cellId] ?? emptyCell()), title: event.target.value },
                            }))
                          }
                        />
                        <label>Column Span</label>
                        {(() => {
                          const maxSpan = Math.max(1, reportCols - Number(cellId.match(/^r\d+c(\d+)$/)?.[1] ?? '1') + 1);
                          const displayValue = colSpanInputs[cellId] ?? String(config.colSpan ?? 1);
                          return (
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={displayValue}
                          onChange={(event) => {
                            const next = event.target.value.replace(/[^\d]/g, '');
                            setColSpanInputs((current) => ({ ...current, [cellId]: next }));
                          }}
                          onBlur={() => applyColSpanInput(cellId, maxSpan, Number(config.colSpan) || 1)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              applyColSpanInput(cellId, maxSpan, Number(config.colSpan) || 1);
                            }
                          }}
                        />
                          );
                        })()}
                        {isSummaryTable ? (
                          <>
                            <label>Table</label>
                            <SearchableSingleSelect
                              options={tableModeOptions}
                              value={config.tableMode || defaultTableModeForReportType(reportType)}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: { ...(current[cellId] ?? emptyCell()), tableMode: next },
                                }))
                              }
                            />
                            <label>Split By</label>
                            <SearchableSingleSelect
                              options={splitByOptions}
                              value={config.splitBy || 'Pitch Types'}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: { ...(current[cellId] ?? emptyCell()), splitBy: next },
                                }))
                              }
                            />
                          </>
                        ) : null}
                        {contentType === 'Release Plot' ? (
                          <>
                            <label>Release View</label>
                            <SearchableSingleSelect
                              options={RELEASE_VIEW_OPTIONS.map((entry) => ({ value: entry, label: entry }))}
                              value={config.releaseView || 'Averages and Pitches'}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: { ...(current[cellId] ?? emptyCell()), releaseView: next },
                                }))
                              }
                            />
                          </>
                        ) : null}
                        {contentType === 'Movement Plot' ? (
                          <>
                            <label>Movement View</label>
                            <SearchableSingleSelect
                              options={MOVEMENT_VIEW_OPTIONS.map((entry) => ({ value: entry, label: entry }))}
                              value={config.movementView || 'Averages and Pitches'}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: { ...(current[cellId] ?? emptyCell()), movementView: next },
                                }))
                              }
                            />
                          </>
                        ) : null}
                        {!isNote ? (
                          <>
                            <label>Filters to show</label>
                            <SearchableMultiSelect
                              options={filterTokenOptions}
                              values={config.filterSelect?.length ? config.filterSelect : ['Dates', 'Session Type', 'Pitch Types']}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: { ...(current[cellId] ?? emptyCell()), filterSelect: next as FilterToken[] },
                                }))
                              }
                            />
                            {(config.filterSelect ?? []).includes('Dates') ? (
                              <>
                                <label>Dates Start</label>
                                <input
                                  type="date"
                                  value={config.dateStart ?? ''}
                                  onChange={(event) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), dateStart: event.target.value },
                                    }))
                                  }
                                />
                                <label>Dates End</label>
                                <input
                                  type="date"
                                  value={config.dateEnd ?? ''}
                                  onChange={(event) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), dateEnd: event.target.value },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('Session Type') ? (
                              <>
                                <label>{String(activeSchoolCode || schoolCode || '').trim().toUpperCase() === 'PRO' ? 'Level' : 'Session Type'}</label>
                                <SearchableSingleSelect
                                  options={(
                                    String(activeSchoolCode || schoolCode || '').trim().toUpperCase() === 'PRO'
                                      ? levelOptions
                                      : sessionTypeOptions
                                  ).map((entry) => ({ value: entry, label: entry }))}
                                  value={config.sessionType || (String(activeSchoolCode || schoolCode || '').trim().toUpperCase() === 'PRO' ? 'MLB' : 'All')}
                                  onChange={(next) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), sessionType: next },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('Pitch Types') ? (
                              <>
                                <label>Pitch Types</label>
                                <SearchableMultiSelect
                                  options={pitchTypeOptions.map((entry) => ({ value: entry, label: entry }))}
                                  values={config.pitchTypes?.length ? config.pitchTypes : ['All']}
                                  onChange={(next) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), pitchTypes: next },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('Batter Hand') ? (
                              <>
                                <label>Batter Hand</label>
                                <SearchableSingleSelect
                                  options={batterSideOptions.map((entry) => ({ value: entry, label: entry }))}
                                  value={config.batterSide || 'All'}
                                  onChange={(next) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), batterSide: next },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('Pitcher Hand') ? (
                              <>
                                <label>Pitcher Hand</label>
                                <SearchableSingleSelect
                                  options={pitcherHandOptions.map((entry) => ({ value: entry, label: entry }))}
                                  value={config.pitcherHand || 'All'}
                                  onChange={(next) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), pitcherHand: next },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('Pitch Results') ? (
                              <>
                                <label>Pitch Results</label>
                                <SearchableMultiSelect
                                  options={pitchResultOptions.map((entry) => ({ value: entry, label: entry }))}
                                  values={config.pitchResults?.length ? config.pitchResults : ['All']}
                                  onChange={(next) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), pitchResults: next },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('QP Locations') && reportType === 'Pitching' ? (
                              <>
                                <label>QP Locations</label>
                                <SearchableSingleSelect
                                  options={qpLocationOptions.map((entry) => ({ value: entry, label: entry }))}
                                  value={config.qpLocations || 'All'}
                                  onChange={(next) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), qpLocations: next },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('In Zone') ? (
                              <>
                                <label>In Zone</label>
                                <SearchableSingleSelect
                                  options={inZoneOptions.map((entry) => ({ value: entry, label: entry }))}
                                  value={config.inZone || 'All'}
                                  onChange={(next) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), inZone: next },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('Count') ? (
                              <>
                                <label>Count</label>
                                <SearchableMultiSelect
                                  options={countOptions.map((entry) => ({ value: entry, label: entry }))}
                                  values={config.countFilter?.length ? config.countFilter : ['All']}
                                  onChange={(next) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), countFilter: next },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('After Count') ? (
                              <>
                                <label>After Count</label>
                                <SearchableMultiSelect
                                  options={afterCountOptions.map((entry) => ({ value: entry, label: entry }))}
                                  values={config.afterCountFilter?.length ? config.afterCountFilter : ['All']}
                                  onChange={(next) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), afterCountFilter: next },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('Zone Location') ? (
                              <>
                                <label>Zone Location</label>
                                <SearchableMultiSelect
                                  options={zoneLocationOptions.map((entry) => ({ value: entry, label: entry }))}
                                  values={config.zoneLocations?.length ? config.zoneLocations : ['All']}
                                  onChange={(next) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), zoneLocations: next },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('Velo Min/Max') ? (
                              <>
                                <label>Velo Min</label>
                                <input
                                  value={config.veloMin ?? ''}
                                  onChange={(event) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), veloMin: event.target.value },
                                    }))
                                  }
                                />
                                <label>Velo Max</label>
                                <input
                                  value={config.veloMax ?? ''}
                                  onChange={(event) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), veloMax: event.target.value },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('IVB Min/Max') ? (
                              <>
                                <label>IVB Min</label>
                                <input
                                  value={config.ivbMin ?? ''}
                                  onChange={(event) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), ivbMin: event.target.value },
                                    }))
                                  }
                                />
                                <label>IVB Max</label>
                                <input
                                  value={config.ivbMax ?? ''}
                                  onChange={(event) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), ivbMax: event.target.value },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                            {(config.filterSelect ?? []).includes('HB Min/Max') ? (
                              <>
                                <label>HB Min</label>
                                <input
                                  value={config.hbMin ?? ''}
                                  onChange={(event) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), hbMin: event.target.value },
                                    }))
                                  }
                                />
                                <label>HB Max</label>
                                <input
                                  value={config.hbMax ?? ''}
                                  onChange={(event) =>
                                    setCellConfigs((current) => ({
                                      ...current,
                                      [cellId]: { ...(current[cellId] ?? emptyCell()), hbMax: event.target.value },
                                    }))
                                  }
                                />
                              </>
                            ) : null}
                          </>
                        ) : null}
                        {isHeatMap ? (
                          <>
                            <label>Heatmap Type</label>
                            <SearchableSingleSelect
                              options={HEATMAP_STATS.map((entry) => ({ value: entry, label: entry }))}
                              value={config.heatStat || 'Frequency'}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: { ...(current[cellId] ?? emptyCell()), heatStat: next },
                                }))
                              }
                            />
                          </>
                        ) : null}
                        {contentType === 'Velocity Chart' ? (
                          <>
                            <label>Velocity Chart</label>
                            <SearchableSingleSelect
                              options={VELOCITY_CHART_OPTIONS.map((entry) => ({ value: entry, label: entry }))}
                              value={config.velocityChart || 'Velocity Chart (Game/Inning)'}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: { ...(current[cellId] ?? emptyCell()), velocityChart: next },
                                }))
                              }
                            />
                          </>
                        ) : null}
                        {contentType === '2D Contact' ? (
                          <>
                            <label>Display</label>
                            <SearchableSingleSelect
                              options={[
                                { value: 'individual', label: 'Individual Pitches' },
                                { value: 'average_pitch_type', label: 'Average by Pitch Type' },
                              ]}
                              value={config.contact2dMode}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: { ...(current[cellId] ?? emptyCell()), contact2dMode: next === 'average_pitch_type' ? 'average_pitch_type' : 'individual' },
                                }))
                              }
                            />
                            <label>Color By</label>
                            <SearchableSingleSelect
                              options={[
                                { value: 'pitch_type', label: 'Pitch Type' },
                                { value: 'exit_velocity', label: 'Exit Velocity' },
                                { value: 'result', label: 'Result' },
                              ]}
                              value={config.contact2dColorBy}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: {
                                    ...(current[cellId] ?? emptyCell()),
                                    contact2dColorBy: next === 'exit_velocity' || next === 'result' ? next : 'pitch_type',
                                  },
                                }))
                              }
                            />
                          </>
                        ) : null}
                        {contentType === '3D Contact' ? (
                          <>
                            <label>Display</label>
                            <SearchableSingleSelect
                              options={[
                                { value: 'individual', label: 'Individual Pitches' },
                                { value: 'average_pitch_type', label: 'Average by Pitch Type' },
                              ]}
                              value={config.contact3dMode}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: { ...(current[cellId] ?? emptyCell()), contact3dMode: next === 'average_pitch_type' ? 'average_pitch_type' : 'individual' },
                                }))
                              }
                            />
                            <label>Color By</label>
                            <SearchableSingleSelect
                              options={[
                                { value: 'pitch_type', label: 'Pitch Type' },
                                { value: 'exit_velocity', label: 'Exit Velocity' },
                                { value: 'result', label: 'Result' },
                              ]}
                              value={config.contact3dColorBy}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: {
                                    ...(current[cellId] ?? emptyCell()),
                                    contact3dColorBy: next === 'exit_velocity' || next === 'result' ? next : 'pitch_type',
                                  },
                                }))
                              }
                            />
                          </>
                        ) : null}
                        {contentType === 'Bat Speed' ? (
                          <>
                            <label>Display</label>
                            <SearchableSingleSelect
                              options={[
                                { value: 'average', label: 'Average' },
                                { value: 'individual', label: 'Individual Pitches' },
                              ]}
                              value={config.batSpeedDisplay}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: { ...(current[cellId] ?? emptyCell()), batSpeedDisplay: next === 'individual' ? 'individual' : 'average' },
                                }))
                              }
                            />
                            <label>Color By</label>
                            <SearchableSingleSelect
                              options={[
                                { value: 'pitch_type', label: 'Pitch Type' },
                                { value: 'exit_velocity', label: 'Exit Velocity' },
                                { value: 'result', label: 'Result' },
                              ]}
                              value={config.batSpeedColorBy}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: {
                                    ...(current[cellId] ?? emptyCell()),
                                    batSpeedColorBy: next === 'exit_velocity' || next === 'result' ? next : 'pitch_type',
                                  },
                                }))
                              }
                            />
                          </>
                        ) : null}
                        {contentType === 'EV and LA' ? (
                          <>
                            <label>Color By</label>
                            <SearchableSingleSelect
                              options={[
                                { value: 'result', label: 'Result' },
                                { value: 'pitch_type', label: 'Pitch Type' },
                              ]}
                              value={config.evlaColorBy}
                              onChange={(next) =>
                                setCellConfigs((current) => ({
                                  ...current,
                                  [cellId]: { ...(current[cellId] ?? emptyCell()), evlaColorBy: next === 'pitch_type' ? 'pitch_type' : 'result' },
                                }))
                              }
                            />
                          </>
                        ) : null}
                          </>
                        ) : null}
                          </>
                        ) : null}
                      </div>
                      {config.title ? <h4 className="portal-custom-reports-cell-title">{config.title}</h4> : null}
                      {isNote ? (
                        <textarea
                          className="portal-custom-reports-notes"
                          placeholder="Notes..."
                          value={isTemplateDrivenCell ? config.noteText : rawConfig.noteText}
                          onChange={(event) =>
                            setCellConfigs((current) => ({
                              ...current,
                              [cellId]: { ...(current[cellId] ?? emptyCell()), noteText: event.target.value },
                            }))
                          }
                        />
                      ) : contentType === 'Location Plot' ? (
                        <div className="portal-custom-reports-heatmap">
                          <svg viewBox="-2 -0.3 4 5.4" role="img" aria-label="Location plot" onMouseLeave={() => setChartHover(null)}>
                            {strikeZoneOverlay()}
                            {chartPoints.slice(0, 320).map((point, idx) => {
                              const rawX = Number(point.plate_side ?? NaN);
                              const y = Number(point.plate_height ?? NaN);
                              if (!Number.isFinite(rawX) || !Number.isFinite(y)) return null;
                              const x = isProSchool ? -rawX : rawX;
                              const pitchType = (point.pitch_type ?? '').trim() || 'Undefined';
                              const color = PITCH_COLORS[pitchType] ?? '#9ca3af';
                              const shape = resultShape(
                                String(point.pitch_call ?? ''),
                                String(point.play_result ?? ''),
                                String(schoolCode || '').trim().toUpperCase() === 'PRO'
                              );
                              const px = x;
                              const py = 4.8 - y;
                              const hoverText = `Session: ${point.session_date ? fmtShortDate(point.session_date) : '-'}\nResult: ${formatPitchResult(point.pitch_call, point.play_result)}\nVelo: ${toNum(point.rel_speed ?? point.velo)?.toFixed(1) ?? '-'} mph\nIVB: ${toNum(point.ivb)?.toFixed(1) ?? '-'} in\nHB: ${toNum(point.hb)?.toFixed(1) ?? '-'} in\nEV: ${toNum(point.exit_speed)?.toFixed(1) ?? '-'} mph\nLA: ${toNum(point.angle)?.toFixed(1) ?? '-'}`;
                              const hoverProps = {
                                onMouseMove: (event: { clientX: number; clientY: number }) =>
                                  setChartHover({
                                    x: event.clientX,
                                    y: event.clientY,
                                    bg: color,
                                    text: hoverText,
                                  }),
                                onMouseLeave: () => setChartHover(null),
                              };
                              if (shape === 'Ball') return <circle key={`${cellId}-loc-${idx}`} cx={px} cy={py} r={0.095} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={0.026} {...hoverProps} />;
                              if (shape === 'Called Strike') return <circle key={`${cellId}-loc-${idx}`} cx={px} cy={py} r={0.092} fill={color} stroke={color} strokeWidth={0.021} {...hoverProps} />;
                              if (shape === 'Foul') return <polygon key={`${cellId}-loc-${idx}`} points={`${px},${py - 0.09} ${px - 0.078},${py + 0.07} ${px + 0.078},${py + 0.07}`} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={0.026} {...hoverProps} />;
                              if (shape === 'Whiff') return <text key={`${cellId}-loc-${idx}`} x={px} y={py + 0.074} fontSize={0.26} textAnchor="middle" fill={color} {...hoverProps}>★</text>;
                              if (shape === 'In Play (Out)') return <polygon key={`${cellId}-loc-${idx}`} points={`${px},${py - 0.09} ${px - 0.078},${py + 0.07} ${px + 0.078},${py + 0.07}`} fill={color} {...hoverProps} />;
                              if (shape === 'In Play (Hit)') return <rect key={`${cellId}-loc-${idx}`} x={px - 0.073} y={py - 0.073} width={0.146} height={0.146} fill={color} {...hoverProps} />;
                              if (shape === 'Error') return <rect key={`${cellId}-loc-${idx}`} x={px - 0.073} y={py - 0.073} width={0.146} height={0.146} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={0.026} {...hoverProps} />;
                              return <circle key={`${cellId}-loc-${idx}`} cx={px} cy={py} r={0.09} fill={color} {...hoverProps} />;
                            })}
                          </svg>
                        </div>
                      ) : contentType === '2D Contact' ? (
                        <div className="portal-custom-reports-velocity">
                          <svg viewBox="0 0 720 560" style={{ width: '100%', height: '100%', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }} onMouseLeave={() => setChartHover(null)}>
                            {(() => {
                              const source = chartPoints.filter((p) => toNum(p.contact_position_x) !== null && toNum(p.contact_position_z) !== null);
                              const data =
                                config.contact2dMode === 'average_pitch_type'
                                  ? Object.values(
                                      source.reduce<Record<string, { n: number; x: number; z: number; p: (typeof source)[number] }>>((acc, p) => {
                                        const key = p.pitch_type || 'Unknown';
                                        if (!acc[key]) acc[key] = { n: 0, x: 0, z: 0, p };
                                        acc[key].n += 1;
                                        acc[key].x += Number(p.contact_position_x ?? 0);
                                        acc[key].z += Number(p.contact_position_z ?? 0);
                                        return acc;
                                      }, {})
                                    ).map((g) => ({ ...g.p, contact_position_x: g.x / g.n, contact_position_z: g.z / g.n }))
                                  : source;
                              if (!data.length) {
                                return <text x={360} y={286} textAnchor="middle" fill="rgba(255,255,255,0.78)" fontSize={18}>No contact-position data for current filters.</text>;
                              }
                              const ys = data.map((p) => Number(p.contact_position_x ?? 0)).filter((v) => Number.isFinite(v));
                              const yMin = ys.length ? Math.floor(Math.min(...ys, -0.6)) : -1;
                              const yMax = ys.length ? Math.ceil(Math.max(...ys, 1.0)) : 6;
                              const xMin = -2.5;
                              const xMax = 2.5;
                              const px = (x: number) => 20 + ((x - xMin) / (xMax - xMin)) * 680;
                              const py = (y: number) => 540 - ((y - yMin) / (yMax - yMin)) * 520;
                              return (
                                <>
                                  <rect x={px(-1.9)} y={py(0.9)} width={px(-0.9) - px(-1.9)} height={py(-0.45) - py(0.9)} fill="none" stroke="rgba(255,255,255,0.6)" />
                                  <rect x={px(0.9)} y={py(0.9)} width={px(1.9) - px(0.9)} height={py(-0.45) - py(0.9)} fill="none" stroke="rgba(255,255,255,0.6)" />
                                  <polygon points={`${px(-0.708)},${py(0.62)} ${px(0.708)},${py(0.62)} ${px(0.708)},${py(0.35)} ${px(0)},${py(0)} ${px(-0.708)},${py(0.35)}`} fill="none" stroke="rgba(255,255,255,0.8)" />
                                  {data.map((p, i) => {
                                    const x = toNum(p.contact_position_z) ?? 0;
                                    const y = toNum(p.contact_position_x) ?? 0;
                                    const color = swingColorFor(p, config.contact2dColorBy);
                                    const tip = `${p.pitch_type}\nResult: ${resultLabelForSwing(p.play_result)}\nVelo: ${Number.isFinite((p.rel_speed ?? null) as number) ? Number(p.rel_speed).toFixed(1) : '-'} mph\nEV: ${Number.isFinite((p.exit_speed ?? null) as number) ? Number(p.exit_speed).toFixed(1) : '-'} mph\nLA: ${Number.isFinite((p.angle ?? null) as number) ? Number(p.angle).toFixed(1) : '-'}°\nForward: ${Number(y).toFixed(1)} ft\nSide: ${Number(x).toFixed(1)} ft`;
                                    return (
                                      <circle
                                        key={`${cellId}-c2d-${i}`}
                                        cx={px(x)}
                                        cy={py(y)}
                                        r={config.contact2dMode === 'average_pitch_type' ? 4.5 : 3}
                                        fill={color}
                                        stroke="rgba(255,255,255,0.75)"
                                        strokeWidth={0.6}
                                        onMouseEnter={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: tip, bg: color })}
                                        onMouseMove={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: tip, bg: color })}
                                      />
                                    );
                                  })}
                                </>
                              );
                            })()}
                          </svg>
                        </div>
                      ) : contentType === '3D Contact' ? (
                        <div className="portal-custom-reports-velocity">
                          <Contact3DChart points={chartPoints} mode={config.contact3dMode} colorBy={config.contact3dColorBy} />
                        </div>
                      ) : contentType === 'Horizontal Attack' || contentType === 'Vertical Attack' ? (
                        <div className="portal-custom-reports-velocity">
                          <svg viewBox="0 0 720 620" style={{ width: '100%', height: '100%', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }} onMouseLeave={() => setChartHover(null)}>
                            {(() => {
                              const isHorizontal = contentType === 'Horizontal Attack';
                              const attackData = chartPoints.filter((p) => toNum(isHorizontal ? p.horizontal_attack_angle : p.vertical_attack_angle) !== null);
                              if (!attackData.length) {
                                return <text x={360} y={312} textAnchor="middle" fill="rgba(255,255,255,0.78)" fontSize={20}>No attack-angle contact data for current filters</text>;
                              }
                              const mean = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
                              const value = mean(attackData.map((p) => toNum(isHorizontal ? p.horizontal_attack_angle : p.vertical_attack_angle)).filter((v): v is number => v !== null));
                              const ev = mean(attackData.map((p) => toNum(p.exit_speed)).filter((v): v is number => v !== null));
                              const la = mean(attackData.map((p) => toNum(p.angle)).filter((v): v is number => v !== null));
                              return (
                                <>
                                  <text x={360} y={52} textAnchor="middle" fill="rgba(255,255,255,0.95)" fontSize={56} fontWeight={800}>{value !== null ? `${value.toFixed(1)}°` : '—'}</text>
                                  <text x={360} y={82} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize={20}>{isHorizontal ? 'Horizontal Attack' : 'Vertical Attack'}</text>
                                  <text x={360} y={104} textAnchor="middle" fill="rgba(255,255,255,0.84)" fontSize={15}>{`EV ${ev !== null ? ev.toFixed(1) : '—'} | LA ${la !== null ? la.toFixed(1) : '—'}`}</text>
                                  <line x1={120} y1={550} x2={600} y2={550} stroke="rgba(255,255,255,0.35)" />
                                  <line x1={360} y1={550} x2={360 + (isHorizontal ? 150 : 90)} y2={550 - (isHorizontal ? 20 : Math.max(-120, Math.min(120, value ?? 0)) * 2)} stroke="#ef4444" strokeWidth={3} />
                                  <circle cx={360} cy={550} r={8} fill="#b7791f" />
                                </>
                              );
                            })()}
                          </svg>
                        </div>
                      ) : contentType === 'Bat Speed' ? (
                        <div className="portal-custom-reports-velocity">
                          <svg viewBox="0 0 720 620" style={{ width: '100%', height: '100%', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }} onMouseLeave={() => setChartHover(null)}>
                            {(() => {
                              const source = chartPoints.filter((p) => Number.isFinite((p.bat_speed ?? null) as number));
                              const speeds = source.map((p) => Number(p.bat_speed));
                              const avg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
                              const min = 40;
                              const max = 80;
                              const toTheta = (s: number) => Math.PI * (1 - (Math.max(min, Math.min(max, s)) - min) / (max - min));
                              const centerX = 360;
                              const centerY = 520;
                              const r = 220;
                              const arcPts = Array.from({ length: 120 }, (_, i) => {
                                const t = Math.PI - (i / 119) * Math.PI;
                                return `${centerX + r * Math.cos(t)},${centerY - r * Math.sin(t)}`;
                              }).join(' ');
                              const avgT = toTheta(avg);
                              const avgX = centerX + (r * 0.86) * Math.cos(avgT);
                              const avgY = centerY - (r * 0.86) * Math.sin(avgT);
                              return (
                                <>
                                  <polyline points={arcPts} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="14" strokeLinecap="round" />
                                  <polyline points={arcPts} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
                                  {[40, 45, 50, 55, 60, 65, 70, 75, 80].map((tick) => {
                                    const t = toTheta(tick);
                                    const x1 = centerX + (r * 0.88) * Math.cos(t);
                                    const y1 = centerY - (r * 0.88) * Math.sin(t);
                                    const x2 = centerX + r * Math.cos(t);
                                    const y2 = centerY - r * Math.sin(t);
                                    const xl = centerX + (r * 1.08) * Math.cos(t);
                                    const yl = centerY - (r * 1.08) * Math.sin(t);
                                    return (
                                      <g key={`${cellId}-bs-${tick}`}>
                                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.65)" />
                                        <text x={xl} y={yl} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="12">{tick}</text>
                                      </g>
                                    );
                                  })}
                                  <line x1={centerX} y1={centerY} x2={avgX} y2={avgY} stroke="#ef4444" strokeWidth="3" />
                                  <circle cx={centerX} cy={centerY} r={5} fill="rgba(255,255,255,0.9)" />
                                  <text x={centerX} y={70} textAnchor="middle" fill="rgba(255,255,255,0.95)" fontSize="34" fontWeight={700}>{Number.isFinite(avg) ? `${avg.toFixed(1)} mph` : '—'}</text>
                                  {config.batSpeedDisplay === 'individual'
                                    ? source.map((p, i) => {
                                        const s = Number(p.bat_speed);
                                        const t = toTheta(s);
                                        const x = centerX + (r * 0.9) * Math.cos(t);
                                        const y = centerY - (r * 0.9) * Math.sin(t);
                                        const color = swingColorFor(p, config.batSpeedColorBy);
                                        const tip = `${p.pitch_type}\nBat Speed: ${s.toFixed(1)} mph\nEV: ${Number.isFinite((p.exit_speed ?? null) as number) ? Number(p.exit_speed).toFixed(1) : '-'} mph\nLA: ${Number.isFinite((p.angle ?? null) as number) ? Number(p.angle).toFixed(1) : '-'}°`;
                                        return <circle key={`${cellId}-bsi-${i}`} cx={x} cy={y} r={3.3} fill={color} stroke="rgba(255,255,255,0.6)" onMouseEnter={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: tip, bg: color })} onMouseMove={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: tip, bg: color })} />;
                                      })
                                    : null}
                                </>
                              );
                            })()}
                          </svg>
                        </div>
                      ) : contentType === 'EV and LA' ? (
                        <div className="portal-custom-reports-velocity">
                          <svg viewBox="0 0 720 620" style={{ width: '100%', height: '100%', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }} onMouseLeave={() => setChartHover(null)}>
                            {(() => {
                              const data = chartPoints.filter((p) => Number.isFinite((p.exit_speed ?? null) as number) && Number.isFinite((p.angle ?? null) as number) && String(p.pitch_call ?? '') === 'InPlay');
                              const centerX = 110;
                              const centerY = 310;
                              const r = 285;
                              const toTheta = (la: number) => (Math.max(-90, Math.min(90, la)) * Math.PI) / 180;
                              const toPt = (ev: number, la: number) => {
                                const theta = toTheta(la);
                                const rr = (Math.max(0, Math.min(120, ev)) / 120) * r;
                                return { x: centerX + rr * Math.cos(theta), y: centerY - rr * Math.sin(theta) };
                              };
                              const ringPath = (radius: number) => `M ${centerX} ${centerY - radius} A ${radius} ${radius} 0 0 1 ${centerX} ${centerY + radius}`;
                              return (
                                <>
                                  <path d={ringPath(r)} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
                                  <path d={ringPath((80 / 120) * r)} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeDasharray="4 4" />
                                  <path d={ringPath((40 / 120) * r)} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" strokeDasharray="4 4" />
                                  {[90, 45, 0, -45, -90].map((a) => {
                                    const p = toPt(120, a);
                                    return (
                                      <g key={`${cellId}-evla-a-${a}`}>
                                        <line x1={centerX} y1={centerY} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.18)" />
                                        <text x={centerX + (p.x - centerX) * 0.9} y={centerY + (p.y - centerY) * 0.9} fill="rgba(255,255,255,0.8)" fontSize="12">{a}°</text>
                                      </g>
                                    );
                                  })}
                                  <text x={centerX} y={centerY - r - 12} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="12" fontWeight={700}>120 mph</text>
                                  <text x={centerX + r + 10} y={centerY + 4} textAnchor="start" fill="rgba(255,255,255,0.85)" fontSize="12" fontWeight={700}>120 mph</text>
                                  <text x={centerX} y={centerY + r + 18} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="12" fontWeight={700}>120 mph</text>
                                  <text x={centerX + (80 / 120) * r + 6} y={centerY + 4} fill="rgba(255,255,255,0.75)" fontSize="11">80</text>
                                  <text x={centerX + (40 / 120) * r + 6} y={centerY + 4} fill="rgba(255,255,255,0.7)" fontSize="11">40</text>
                                  {data.map((p, i) => {
                                    const ev = Number(p.exit_speed);
                                    const la = Number(p.angle);
                                    const pt = toPt(ev, la);
                                    const color = config.evlaColorBy === 'pitch_type' ? (PITCH_COLORS[p.pitch_type || 'Undefined'] ?? PITCH_COLORS.Undefined) : (RESULT_COLOR_PALETTE[resultLabelForSwing(p.play_result)] ?? RESULT_COLOR_PALETTE.Unknown);
                                    const tip = `${p.pitch_type}\nResult: ${resultLabelForSwing(p.play_result)}\nEV: ${ev.toFixed(1)} mph\nLA: ${la.toFixed(1)}°`;
                                    return <circle key={`${cellId}-evla-${i}`} cx={pt.x} cy={pt.y} r={4} fill={color} stroke="rgba(255,255,255,0.7)" onMouseEnter={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: tip, bg: color })} onMouseMove={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: tip, bg: color })} />;
                                  })}
                                </>
                              );
                            })()}
                          </svg>
                        </div>
                      ) : contentType === 'Heatmap' ? (
                        <div className="portal-custom-reports-heatmap">
                          <div style={{ display: 'grid', gap: 4, margin: '0.1rem 0.2rem 0.35rem 0.2rem' }}>
                            <div
                              style={{
                                height: 20,
                                width: '72%',
                                justifySelf: 'center',
                                border: '1px solid rgba(255,255,255,0.25)',
                                background: 'linear-gradient(90deg, rgb(32,74,135) 0%, rgb(246,248,248) 50%, rgb(176,11,52) 100%)',
                              }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '72%', justifySelf: 'center', fontSize: '0.78rem', color: 'rgba(255,255,255,0.9)' }}>
                              <span>Least</span>
                              <span>Most</span>
                            </div>
                            <div style={{ fontSize: '0.9rem', fontWeight: 600, textAlign: 'center' }}>{config.heatStat || 'Heatmap'}</div>
                          </div>
                          <svg viewBox="0 0 360 460" role="img" aria-label="Heatmap" onMouseLeave={() => setChartHover(null)}>
                            {(() => {
                              const w = 360;
                              const h = 460;
                              const xMin = -2.1;
                              const xMax = 2.1;
                              const yMin = 0;
                              const yMax = 5;
                              const scale = w / (xMax - xMin);
                              const px = (x: number) => (x - xMin) * scale;
                              const py = (y: number) => (yMax - y) * scale;
                              const valueLabel = config.heatStat || 'Frequency';
                              const strikeBottom = 1.5;
                              const strikeTop = 3.6;
                              const strikeLeft = -0.88;
                              const strikeRight = 0.88;
                              const strikeCenterY = (strikeBottom + strikeTop) / 2;
                              const compLeft = -1.5;
                              const compRight = 1.5;
                              const compBottom = strikeCenterY - 1.5;
                              const compTop = strikeCenterY + 1.5;
                              const values = heatCells.map((c) => c.value).sort((a, b) => a - b);
                              const dynamicMinVal = values.length ? values[0] : 0;
                              const dynamicMaxVal = values.length ? values[values.length - 1] : 1;
                              const dynamicMidVal = values.length ? values[Math.floor(values.length / 2)] : 0;
                              const selectedHeatPitchTypes = (config.pitchTypes ?? []).filter((value) => value && value !== 'All');
                              const fixedScale = heatmapScaleFromMetricAndPitchTypes(valueLabel, selectedHeatPitchTypes);
                              const contactVisibilityScale = valueLabel === 'Contact Rate' ? heatmapScaleFromMetricAndPitchTypes('Whiff Rate', selectedHeatPitchTypes) : null;
                              const minVal = fixedScale?.min ?? dynamicMinVal;
                              const maxVal = fixedScale?.max ?? dynamicMaxVal;
                              const midVal = fixedScale?.mid ?? dynamicMidVal;
                              const maxAbs = Math.max(1e-9, ...heatCells.map((c) => Math.abs(c.value)));
                              const rvMin = isProSchool ? -5 : -2;
                              const rvMax = isProSchool ? 5 : 2;
                              const densityMax = Math.max(1e-9, ...heatCells.map((c) => c.density));
                              return (
                                <>
                                  <defs>
                                    <clipPath id={`custom-heat-clip-${cellId}`}>
                                      <rect x={0} y={0} width={w} height={h} />
                                    </clipPath>
                                    <filter id={`custom-heat-blur-${cellId}`} x="-20%" y="-20%" width="140%" height="140%">
                                      <feGaussianBlur stdDeviation={isProSchool ? (valueLabel === 'Run Values' ? 0.75 : 1.2) : (valueLabel === 'Run Values' ? 1.25 : 2.1)} />
                                    </filter>
                                  </defs>
                                  <g transform={`translate(${w / 2} ${h / 2}) scale(1.0) translate(${-w / 2} ${-h / 2})`} clipPath={`url(#custom-heat-clip-${cellId})`}>
                                    <g filter={`url(#custom-heat-blur-${cellId})`}>
                                      {heatCells.map((c) => {
                                        const cx = px(c.x + c.w / 2);
                                        const cy = py(c.y + c.h / 2);
                                        const radius = isProSchool ? Math.max(2.0, c.w * scale * 1.45) : Math.max(2.8, c.w * scale * 2.05);
                                        const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                                        let fill = 'rgba(255,255,255,0.12)';
                                        if (valueLabel === 'Frequency') {
                                          fill = sequentialColor(c.value, minVal, maxVal);
                                        } else if (valueLabel === 'Run Values') {
                                          const rvClamped = Math.max(rvMin, Math.min(rvMax, c.value));
                                          fill = divergingColor(rvClamped, rvMin, 0, rvMax);
                                        } else {
                                          fill = divergingColor(c.value, minVal, midVal, maxVal);
                                        }
                                        const normalized =
                                          valueLabel === 'Run Values'
                                            ? Math.abs(Math.max(rvMin, Math.min(rvMax, c.value))) / rvMax
                                            : valueLabel === 'Contact Rate' && contactVisibilityScale
                                              ? Math.max(
                                                  0,
                                                  Math.min(
                                                    1,
                                                    ((100 - c.value) - contactVisibilityScale.min) /
                                                      Math.max(1e-9, contactVisibilityScale.max - contactVisibilityScale.min)
                                                  )
                                                )
                                              : Math.max(0, Math.min(1, (c.value - minVal) / Math.max(1e-9, maxVal - minVal)));
                                        const runValueBoost = valueLabel === 'Run Values' ? Math.pow(normalized, 0.55) : normalized;
                                        const isSwingRateView = valueLabel === 'Swing Rate';
                                        if (valueLabel !== 'Frequency' && valueLabel !== 'Run Values' && densityNorm < (isSwingRateView ? 0.06 : 0.16)) return null;
                                        if (valueLabel !== 'Run Values' && !isSwingRateView && normalized < 0.06) return null;
                                        if (valueLabel === 'Run Values' && Math.abs(Math.max(rvMin, Math.min(rvMax, c.value))) < 0.15) return null;
                                        return (
                                          <circle
                                            key={`${cellId}-heat-blur-${c.x}-${c.y}`}
                                            cx={cx}
                                            cy={cy}
                                            r={radius}
                                            fill={fill}
                                            opacity={
                                              valueLabel === 'Run Values'
                                                ? Math.max(0.06, runValueBoost * 1.15 * Math.max(0.45, densityNorm))
                                                : Math.max(0.3, runValueBoost * 1.25 * (valueLabel === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))
                                            }
                                          />
                                        );
                                      })}
                                    </g>
                                    {heatCells.map((c) => {
                                      const cx = px(c.x + c.w / 2);
                                      const cy = py(c.y + c.h / 2);
                                      const radius = isProSchool ? Math.max(1.0, c.w * scale * 0.75) : Math.max(1.4, c.w * scale * 1.08);
                                      const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                                      let fill = 'rgba(255,255,255,0.12)';
                                      if (valueLabel === 'Frequency') {
                                        fill = sequentialColor(c.value, minVal, maxVal);
                                      } else if (valueLabel === 'Run Values') {
                                        const rvClamped = Math.max(rvMin, Math.min(rvMax, c.value));
                                        fill = divergingColor(rvClamped, rvMin, 0, rvMax);
                                      } else {
                                        fill = divergingColor(c.value, minVal, midVal, maxVal);
                                      }
                                      const normalized =
                                        valueLabel === 'Run Values'
                                          ? Math.abs(Math.max(rvMin, Math.min(rvMax, c.value))) / rvMax
                                          : valueLabel === 'Contact Rate' && contactVisibilityScale
                                            ? Math.max(
                                                0,
                                                Math.min(
                                                  1,
                                                  ((100 - c.value) - contactVisibilityScale.min) /
                                                    Math.max(1e-9, contactVisibilityScale.max - contactVisibilityScale.min)
                                                )
                                              )
                                            : Math.max(0, Math.min(1, (c.value - minVal) / Math.max(1e-9, maxVal - minVal)));
                                      const runValueBoost = valueLabel === 'Run Values' ? Math.pow(normalized, 0.55) : normalized;
                                      const isSwingRateView = valueLabel === 'Swing Rate';
                                      if (valueLabel !== 'Frequency' && valueLabel !== 'Run Values' && densityNorm < (isSwingRateView ? 0.06 : 0.16)) return null;
                                      if (valueLabel !== 'Run Values' && !isSwingRateView && normalized < 0.06) return null;
                                      if (valueLabel === 'Run Values' && Math.abs(Math.max(rvMin, Math.min(rvMax, c.value))) < 0.15) return null;
                                      return (
                                        <circle
                                          key={`${cellId}-heat-core-${c.x}-${c.y}`}
                                          cx={cx}
                                          cy={cy}
                                          r={radius}
                                          fill={fill}
                                          opacity={
                                            valueLabel === 'Run Values'
                                              ? Math.max(0.04, runValueBoost * 0.7 * Math.max(0.45, densityNorm))
                                              : Math.max(0.2, runValueBoost * 0.72 * (valueLabel === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))
                                          }
                                          onMouseMove={(event) =>
                                            setChartHover({
                                              x: event.clientX,
                                              y: event.clientY,
                                              text: `${valueLabel}: ${c.value.toFixed(valueLabel === 'Exit Velocity' || valueLabel === 'Run Values' ? 2 : 1)}`,
                                            })
                                          }
                                          onMouseLeave={() => setChartHover(null)}
                                        />
                                      );
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
                                </>
                              );
                            })()}
                          </svg>
                        </div>
                      ) : contentType === 'Movement Plot' ? (
                        <div className="portal-custom-reports-velocity">
                          {(() => {
                            const points = chartPoints
                              .map((point) => ({
                                hb: toNum(point.hb),
                                ivb: toNum(point.ivb),
                                velo: toNum(point.rel_speed ?? point.velo),
                                sessionDate: point.session_date ?? null,
                                pitchType: ((point.pitch_type ?? '').trim() || 'Undefined') as string,
                              }))
                              .filter((point): point is { hb: number; ivb: number; velo: number | null; sessionDate: string | null; pitchType: string } => point.hb !== null && point.ivb !== null);
                            const averages = avgByPitchType(chartPoints).filter((row) => row.hb !== null && row.ivb !== null);
                            const showPitches = (config.movementView || 'Averages and Pitches') === 'Averages and Pitches';
                            const showAverages = true;
                            return (
                              <svg viewBox="0 0 520 360" role="img" aria-label="Movement plot" onMouseLeave={() => setChartHover(null)}>
                                {[-20, -10, 0, 10, 20].map((tick) => (
                                  <line key={`${cellId}-m-v-${tick}`} x1={52 + ((tick + 25) / 50) * 416} y1={22} x2={52 + ((tick + 25) / 50) * 416} y2={338} stroke="rgba(255,255,255,0.18)" />
                                ))}
                                {[-20, -10, 0, 10, 20].map((tick) => (
                                  <line key={`${cellId}-m-h-${tick}`} x1={52} y1={22 + ((25 - tick) / 50) * 316} x2={468} y2={22 + ((25 - tick) / 50) * 316} stroke="rgba(255,255,255,0.18)" />
                                ))}
                                {[-20, -10, 0, 10, 20].map((tick) => (
                                  <text
                                    key={`${cellId}-m-xlab-${tick}`}
                                    x={52 + ((tick + 25) / 50) * 416}
                                    y={352}
                                    textAnchor="middle"
                                    fill="rgba(255,255,255,0.78)"
                                    fontSize={11}
                                  >
                                    {tick}
                                  </text>
                                ))}
                                {[-20, -10, 0, 10, 20].map((tick) => (
                                  <text
                                    key={`${cellId}-m-ylab-${tick}`}
                                    x={44}
                                    y={22 + ((25 - tick) / 50) * 316 + 4}
                                    textAnchor="end"
                                    fill="rgba(255,255,255,0.78)"
                                    fontSize={11}
                                  >
                                    {tick}
                                  </text>
                                ))}
                                <line x1={52} y1={180} x2={468} y2={180} stroke="rgba(255,255,255,0.85)" />
                                <line x1={260} y1={22} x2={260} y2={338} stroke="rgba(255,255,255,0.85)" />
                                {showPitches
                                  ? points.slice(0, 1200).map((point, idx) => (
                                      <circle
                                        key={`${cellId}-mov-p-${idx}`}
                                        cx={52 + ((point.hb + 25) / 50) * 416}
                                        cy={22 + ((25 - point.ivb) / 50) * 316}
                                        r={3.7}
                                        fill={PITCH_COLORS[point.pitchType] ?? '#9ca3af'}
                                        stroke="rgba(0,0,0,0.52)"
                                        strokeWidth={1.1}
                                        opacity={0.42}
                                        onMouseMove={(event) =>
                                          setChartHover({
                                            x: event.clientX,
                                            y: event.clientY,
                                            bg: PITCH_COLORS[point.pitchType] ?? '#111827',
                                            text: `Session: ${point.sessionDate ? fmtShortDate(point.sessionDate) : '-'}\n${point.pitchType}\nVelo: ${point.velo?.toFixed(1) ?? '-'} mph\nIVB: ${point.ivb.toFixed(1)} in\nHB: ${point.hb.toFixed(1)} in`,
                                          })
                                        }
                                        onMouseLeave={() => setChartHover(null)}
                                      />
                                    ))
                                  : null}
                                {showAverages
                                  ? averages.map((point) => (
                                      <circle
                                        key={`${cellId}-mov-a-${point.pitchType}`}
                                        cx={52 + (((point.hb ?? 0) + 25) / 50) * 416}
                                        cy={22 + ((25 - (point.ivb ?? 0)) / 50) * 316}
                                        r={8.6}
                                        fill={PITCH_COLORS[point.pitchType] ?? '#9ca3af'}
                                        stroke="rgba(0,0,0,0.68)"
                                        strokeWidth={2.2}
                                        opacity={0.95}
                                        onMouseMove={(event) =>
                                          setChartHover({
                                            x: event.clientX,
                                            y: event.clientY,
                                            bg: PITCH_COLORS[point.pitchType] ?? '#111827',
                                            text: `${point.pitchType}\nAvg Velo: ${point.velo?.toFixed(1) ?? '-'}\nAvg IVB: ${point.ivb?.toFixed(1) ?? '-'}\nAvg HB: ${point.hb?.toFixed(1) ?? '-'}`,
                                          })
                                        }
                                        onMouseLeave={() => setChartHover(null)}
                                      />
                                    ))
                                  : null}
                              </svg>
                            );
                          })()}
                        </div>
                      ) : contentType === 'Release Plot' ? (
                        <div className="portal-custom-reports-velocity">
                          {(() => {
                            const points = chartPoints
                              .map((point) => ({
                                x: (() => {
                                  const rs = toNum(point.release_side);
                                  if (rs === null) return null;
                                  return isProSchool ? -rs : rs;
                                })(),
                                y: toNum(point.release_height),
                                ext: toNum(point.extension),
                                sessionDate: point.session_date ?? null,
                                pitchType: ((point.pitch_type ?? '').trim() || 'Undefined') as string,
                              }))
                              .filter((point): point is { x: number; y: number; ext: number | null; sessionDate: string | null; pitchType: string } => point.x !== null && point.y !== null);
                            const averages = avgByPitchType(chartPoints).filter((row) => row.releaseSide !== null && row.releaseHeight !== null);
                            const showPitches = (config.releaseView || 'Averages and Pitches') !== 'Averages Only';
                            const showAverages = (config.releaseView || 'Averages and Pitches') !== 'Pitches';
                            const px = (x: number) => 52 + ((x + 4) / 8) * 416;
                            const py = (y: number) => 22 + ((6.5 - y) / 6.5) * 316;
                            const moundX = Array.from({ length: 81 }, (_, idx) => -4 + (idx / 80) * 8);
                            const moundPts = [
                              ...moundX.map((x) => `${px(x)},${py(0.83 * (1 - (x / 4) ** 2))}`),
                              ...moundX.slice().reverse().map((x) => `${px(x)},${py(0)}`),
                            ].join(' ');
                            return (
                              <svg viewBox="0 0 520 360" role="img" aria-label="Release plot" onMouseLeave={() => setChartHover(null)}>
                                {[-4, -2, 0, 2, 4].map((tick) => (
                                  <line key={`${cellId}-r-v-${tick}`} x1={52 + ((tick + 4) / 8) * 416} y1={22} x2={52 + ((tick + 4) / 8) * 416} y2={338} stroke="rgba(255,255,255,0.18)" />
                                ))}
                                {[0, 1, 2, 3, 4, 5, 6].map((tick) => (
                                  <line key={`${cellId}-r-h-${tick}`} x1={52} y1={22 + ((6.5 - tick) / 6.5) * 316} x2={468} y2={22 + ((6.5 - tick) / 6.5) * 316} stroke="rgba(255,255,255,0.18)" />
                                ))}
                                {[-4, -2, 0, 2, 4].map((tick) => (
                                  <text
                                    key={`${cellId}-r-xlab-${tick}`}
                                    x={52 + ((tick + 4) / 8) * 416}
                                    y={352}
                                    textAnchor="middle"
                                    fill="rgba(255,255,255,0.78)"
                                    fontSize={11}
                                  >
                                    {tick}
                                  </text>
                                ))}
                                {[0, 1, 2, 3, 4, 5, 6].map((tick) => (
                                  <text
                                    key={`${cellId}-r-ylab-${tick}`}
                                    x={44}
                                    y={22 + ((6.5 - tick) / 6.5) * 316 + 4}
                                    textAnchor="end"
                                    fill="rgba(255,255,255,0.78)"
                                    fontSize={11}
                                  >
                                    {tick}
                                  </text>
                                ))}
                                <polygon points={moundPts} fill="rgba(212,183,128,0.55)" stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
                                <rect
                                  x={Math.min(px(-1), px(1))}
                                  y={Math.min(py(0.9), py(0.76))}
                                  width={Math.abs(px(1) - px(-1))}
                                  height={Math.abs(py(0.76) - py(0.9))}
                                  fill="#ffffff"
                                  stroke="rgba(17,24,39,0.55)"
                                  strokeWidth={1}
                                  rx={2}
                                />
                                <line x1={260} y1={22} x2={260} y2={338} stroke="rgba(255,255,255,0.85)" />
                                <line x1={52} y1={338} x2={468} y2={338} stroke="rgba(255,255,255,0.85)" />
                                {showPitches
                                  ? points.slice(0, 1200).map((point, idx) => (
                                      <circle
                                        key={`${cellId}-rel-p-${idx}`}
                                        cx={52 + ((point.x + 4) / 8) * 416}
                                        cy={22 + ((6.5 - point.y) / 6.5) * 316}
                                        r={3.2}
                                        fill={PITCH_COLORS[point.pitchType] ?? '#9ca3af'}
                                        stroke="rgba(0,0,0,0.52)"
                                        strokeWidth={1.1}
                                        opacity={0.42}
                                        onMouseMove={(event) =>
                                          setChartHover({
                                            x: event.clientX,
                                            y: event.clientY,
                                            bg: PITCH_COLORS[point.pitchType] ?? '#111827',
                                            text: `Session: ${point.sessionDate ? fmtShortDate(point.sessionDate) : '-'}\n${point.pitchType}\nHeight: ${point.y.toFixed(2)} ft\nSide: ${point.x.toFixed(2)} ft\nExtension: ${point.ext?.toFixed(2) ?? '-'} ft`,
                                          })
                                        }
                                        onMouseLeave={() => setChartHover(null)}
                                      />
                                    ))
                                  : null}
                                {showAverages
                                  ? averages.map((point) => (
                                      <circle
                                        key={`${cellId}-rel-a-${point.pitchType}`}
                                        cx={52 + ((((point.releaseSide ?? 0) * (isProSchool ? -1 : 1)) + 4) / 8) * 416}
                                        cy={22 + ((6.5 - (point.releaseHeight ?? 0)) / 6.5) * 316}
                                        r={8.6}
                                        fill={PITCH_COLORS[point.pitchType] ?? '#9ca3af'}
                                        stroke="rgba(0,0,0,0.68)"
                                        strokeWidth={2.2}
                                        opacity={0.95}
                                        onMouseMove={(event) =>
                                          setChartHover({
                                            x: event.clientX,
                                            y: event.clientY,
                                            bg: PITCH_COLORS[point.pitchType] ?? '#111827',
                                            text: `${point.pitchType}\nAvg Height: ${point.releaseHeight?.toFixed(1) ?? '-'} ft\nAvg Side: ${point.releaseSide !== null && point.releaseSide !== undefined ? (point.releaseSide * (isProSchool ? -1 : 1)).toFixed(1) : '-'} ft`,
                                          })
                                        }
                                        onMouseLeave={() => setChartHover(null)}
                                      />
                                    ))
                                  : null}
                              </svg>
                            );
                          })()}
                        </div>
                      ) : contentType === 'Spray Chart' ? (
                        <div className="portal-custom-reports-velocity">
                          {(() => {
                            const w = 520;
                            const h = 340;
                            const xScale = (x: number) => ((x + 260) / 520) * w;
                            const yScale = (y: number) => h - (y / 420) * h;
                            const sprayView = config.sprayView === 'Bins' ? 'Bins' : 'Batted Balls';
                            const points = chartPoints
                              .map((point) => {
                                const pointAny = point as unknown as Record<string, unknown>;
                                const dirRaw = toNum(point.direction) ?? toNum(pointAny.bearing as number | string | null);
                                const distRaw =
                                  toNum(point.distance) ??
                                  toNum(pointAny.lasttrackeddistance as number | string | null) ??
                                  toNum(pointAny.lastTrackedDistance as number | string | null);
                                const plateSide = toNum(point.plate_side);
                                const ev = toNum(point.exit_speed);
                                const inferredDir =
                                  dirRaw !== null
                                    ? dirRaw
                                    : plateSide !== null
                                      ? Math.max(-45, Math.min(45, plateSide * 18))
                                      : null;
                                const inferredDist =
                                  distRaw !== null
                                    ? distRaw
                                    : ev !== null
                                      ? Math.max(40, Math.min(430, ev * 3.3))
                                      : null;
                                const isInPlay =
                                  String(point.pitch_call ?? '') === 'InPlay' ||
                                  Boolean(String(point.play_result ?? '').trim());
                                if (!isInPlay) return null;
                                const hcX = toNum(pointAny.hc_x as number | string | null);
                                const hcY = toNum(pointAny.hc_y as number | string | null);
                                let x: number | null = null;
                                let y: number | null = null;
                                let dist = inferredDist;
                                if (hcX !== null && hcY !== null) {
                                  const vx = hcX - 125.42;
                                  const vy = 198.27 - hcY;
                                  const mag = Math.hypot(vx, vy);
                                  if (mag > 0.001) {
                                    const resolvedDist = dist ?? Math.hypot(vx, vy) * 2;
                                    x = (vx / mag) * resolvedDist;
                                    y = (vy / mag) * resolvedDist;
                                    dist = resolvedDist;
                                  }
                                }
                                if ((x === null || y === null) && inferredDir !== null && dist !== null && dist > 0) {
                                  const radians = (inferredDir * Math.PI) / 180;
                                  x = dist * Math.sin(radians);
                                  y = dist * Math.cos(radians);
                                }
                                if (x === null || y === null || dist === null || dist <= 0) return null;
                                return {
                                  x,
                                  y,
                                  play: (point.play_result ?? '').trim(),
                                  ev,
                                  la: toNum(point.angle),
                                  distance: dist,
                                };
                              })
                              .filter((point): point is { x: number; y: number; play: string; ev: number | null; la: number | null; distance: number } => point !== null);
                            const fallbackPoints =
                              points.length === 0
                                ? chartPoints
                                    .map((point) => {
                                      const dist = toNum(point.distance);
                                      if (dist === null || dist <= 0) return null;
                                      return {
                                        x: 0,
                                        y: dist,
                                        play: (point.play_result ?? '').trim(),
                                        ev: toNum(point.exit_speed),
                                        la: toNum(point.angle),
                                        distance: dist,
                                      };
                                    })
                                    .filter((point): point is { x: number; y: number; play: string; ev: number | null; la: number | null; distance: number } => point !== null)
                                : points;
                            const pointsWithPolar = fallbackPoints.map((point) => ({
                              ...point,
                              angleDeg: (Math.atan2(point.x, point.y) * 180) / Math.PI,
                              distanceFt: Math.hypot(point.x, point.y),
                            }));
                            const outcomeColor = (playResult: string) => {
                              const normalized = resultLabelForSwing(playResult);
                              if (normalized === 'Single') return '#34d399';
                              if (normalized === 'Double') return '#60a5fa';
                              if (normalized === 'Triple') return '#c084fc';
                              if (normalized === 'HomeRun') return '#f87171';
                              return '#e5e7eb';
                            };
                            const fence: Array<{ x: number; y: number }> = [];
                            const rAt = (deg: number) => {
                              if (deg <= -22.5) return 330 + ((deg + 45) / 22.5) * 40;
                              if (deg <= 0) return 370 + ((deg + 22.5) / 22.5) * 30;
                              if (deg <= 22.5) return 400 - (deg / 22.5) * 30;
                              return 370 - ((deg - 22.5) / 22.5) * 40;
                            };
                            for (let deg = -45; deg <= 45; deg += 1) {
                              const r = rAt(deg);
                              const rad = (deg * Math.PI) / 180;
                              fence.push({ x: r * Math.sin(rad), y: r * Math.cos(rad) });
                            }
                            const firstBaseOuter = { x: 90 * Math.sin(Math.PI / 4), y: 90 * Math.cos(Math.PI / 4) };
                            const thirdBaseOuter = { x: -firstBaseOuter.x, y: firstBaseOuter.y };
                            const secondBaseCenter = { x: 0, y: 127 };
                            const moundCenter = { x: 0, y: 60.5 };
                            const innerDirtRadius = 82;
                            const outerDirtRadius = 138;
                            type SprayBin = {
                              key: string;
                              group: 'Infield' | 'Outfield';
                              label: string;
                              angleMin: number;
                              angleMax: number;
                              rInner: number;
                              rOuter: number;
                            };
                            const sprayBins: SprayBin[] = [
                              { key: 'infield-left', group: 'Infield', label: 'L', angleMin: -45, angleMax: -15, rInner: 0, rOuter: 130 },
                              { key: 'infield-center', group: 'Infield', label: 'C', angleMin: -15, angleMax: 15, rInner: 0, rOuter: 130 },
                              { key: 'infield-right', group: 'Infield', label: 'R', angleMin: 15, angleMax: 45, rInner: 0, rOuter: 130 },
                              { key: 'outfield-left', group: 'Outfield', label: 'L', angleMin: -45, angleMax: -15, rInner: 150, rOuter: 420 },
                              { key: 'outfield-center', group: 'Outfield', label: 'C', angleMin: -15, angleMax: 15, rInner: 150, rOuter: 420 },
                              { key: 'outfield-right', group: 'Outfield', label: 'R', angleMin: 15, angleMax: 45, rInner: 150, rOuter: 420 },
                            ];
                            const infieldTotal = pointsWithPolar.filter((point) => point.distanceFt <= 138).length;
                            const outfieldTotal = pointsWithPolar.length - infieldTotal;
                            const binStats = sprayBins.map((bin) => {
                              const count = pointsWithPolar.filter(
                                (point) =>
                                  point.distanceFt > bin.rInner &&
                                  point.distanceFt <= bin.rOuter &&
                                  point.angleDeg >= bin.angleMin &&
                                  point.angleDeg < bin.angleMax
                              ).length;
                              const denominator = bin.group === 'Infield' ? infieldTotal : outfieldTotal;
                              const pct = denominator > 0 ? (count / denominator) * 100 : 0;
                              return { ...bin, count, pct };
                            });
                            const infieldPcts = binStats.filter((bin) => bin.group === 'Infield').map((bin) => bin.pct);
                            const outfieldPcts = binStats.filter((bin) => bin.group === 'Outfield').map((bin) => bin.pct);
                            const infieldMinPct = infieldPcts.length ? Math.min(...infieldPcts) : 0;
                            const infieldMaxPct = infieldPcts.length ? Math.max(...infieldPcts) : 0;
                            const outfieldMinPct = outfieldPcts.length ? Math.min(...outfieldPcts) : 0;
                            const outfieldMaxPct = outfieldPcts.length ? Math.max(...outfieldPcts) : 0;
                            const colorForBin = (pct: number, group: 'Infield' | 'Outfield') => {
                              const min = group === 'Infield' ? infieldMinPct : outfieldMinPct;
                              const max = group === 'Infield' ? infieldMaxPct : outfieldMaxPct;
                              if (max - min < 1e-6) return 'rgb(248, 248, 248)';
                              return divergingColor(pct, min, min + (max - min) * 0.5, max);
                            };
                            const ringSlicePath = (rInner: number, rOuter: number, angleMin: number, angleMax: number) => {
                              const outerStart = { x: rOuter * Math.sin((angleMin * Math.PI) / 180), y: rOuter * Math.cos((angleMin * Math.PI) / 180) };
                              const outerEnd = { x: rOuter * Math.sin((angleMax * Math.PI) / 180), y: rOuter * Math.cos((angleMax * Math.PI) / 180) };
                              const innerStart = { x: rInner * Math.sin((angleMax * Math.PI) / 180), y: rInner * Math.cos((angleMax * Math.PI) / 180) };
                              const innerEnd = { x: rInner * Math.sin((angleMin * Math.PI) / 180), y: rInner * Math.cos((angleMin * Math.PI) / 180) };
                              const largeArc = Math.abs(angleMax - angleMin) > 180 ? 1 : 0;
                              return [
                                `M ${xScale(outerStart.x)} ${yScale(outerStart.y)}`,
                                `A ${Math.abs(xScale(rOuter) - xScale(0))} ${Math.abs(xScale(rOuter) - xScale(0))} 0 ${largeArc} 1 ${xScale(outerEnd.x)} ${yScale(outerEnd.y)}`,
                                `L ${xScale(innerStart.x)} ${yScale(innerStart.y)}`,
                                `A ${Math.abs(xScale(rInner) - xScale(0))} ${Math.abs(xScale(rInner) - xScale(0))} 0 ${largeArc} 0 ${xScale(innerEnd.x)} ${yScale(innerEnd.y)}`,
                                'Z',
                              ].join(' ');
                            };
                            const labelPoint = (bin: SprayBin) => {
                              const angleMid = ((bin.angleMin + bin.angleMax) / 2) * (Math.PI / 180);
                              const radius = bin.group === 'Infield' ? 148 : 435;
                              return { x: xScale(radius * Math.sin(angleMid)), y: yScale(radius * Math.cos(angleMid)) };
                            };
                            const arcEndpoint = (radius: number) => radius / Math.sqrt(2);
                            const baseDiamondOnLine = (outerX: number, outerY: number, sidePx = 9): string => {
                              const mag = Math.hypot(outerX, outerY) || 1;
                              const ux = outerX / mag;
                              const uy = outerY / mag;
                              const toSecondX = secondBaseCenter.x - outerX;
                              const toSecondY = secondBaseCenter.y - outerY;
                              const nMag = Math.hypot(toSecondX, toSecondY) || 1;
                              const nx = toSecondX / nMag;
                              const ny = toSecondY / nMag;
                              const half = sidePx / 2;
                              const outerA = { x: xScale(outerX - ux * half), y: yScale(outerY - uy * half) };
                              const outerB = { x: xScale(outerX + ux * half), y: yScale(outerY + uy * half) };
                              const innerA = { x: outerA.x + nx * sidePx, y: outerA.y - ny * sidePx };
                              const innerB = { x: outerB.x + nx * sidePx, y: outerB.y - ny * sidePx };
                              return `${outerA.x},${outerA.y} ${outerB.x},${outerB.y} ${innerB.x},${innerB.y} ${innerA.x},${innerA.y}`;
                            };
                            const centeredDiamond = (cx: number, cy: number, sizePx = 6): string => {
                              const x = xScale(cx);
                              const y = yScale(cy);
                              return `${x},${y - sizePx} ${x + sizePx},${y} ${x},${y + sizePx} ${x - sizePx},${y}`;
                            };
                            return (
                              <div style={{ display: 'grid', gap: 8 }}>
                                <div style={{ width: '100%', maxWidth: 240, justifySelf: 'center' }}>
                                  <SearchableSingleSelect
                                    options={[
                                      { value: 'Batted Balls', label: 'Batted Balls' },
                                      { value: 'Bins', label: 'Bins' },
                                    ]}
                                    value={sprayView}
                                    onChange={(next) =>
                                      setCellConfigs((current) => ({
                                        ...current,
                                        [cellId]: { ...(current[cellId] ?? emptyCell()), sprayView: next === 'Bins' ? 'Bins' : 'Batted Balls' },
                                      }))
                                    }
                                    placeholder="Batted Balls"
                                  />
                                </div>
                              <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Spray chart" onMouseLeave={() => setChartHover(null)}>
                                {sprayView === 'Bins'
                                  ? binStats.map((bin) => (
                                      <path
                                        key={`${cellId}-spray-bin-${bin.key}`}
                                        d={ringSlicePath(bin.rInner, bin.rOuter, bin.angleMin, bin.angleMax)}
                                        fill={colorForBin(bin.pct, bin.group)}
                                        opacity={0.45}
                                        stroke="rgba(255,255,255,0.18)"
                                        strokeWidth={1}
                                      />
                                    ))
                                  : null}
                                <polyline points={fence.map((p) => `${xScale(p.x)},${yScale(p.y)}`).join(' ')} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1" />
                                <line x1={xScale(0)} y1={yScale(0)} x2={xScale(-233)} y2={yScale(233)} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
                                <line x1={xScale(0)} y1={yScale(0)} x2={xScale(233)} y2={yScale(233)} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
                                <path
                                  d={`M ${xScale(-arcEndpoint(innerDirtRadius))} ${yScale(arcEndpoint(innerDirtRadius))}
                                    A ${Math.abs(xScale(innerDirtRadius) - xScale(0))} ${Math.abs(xScale(innerDirtRadius) - xScale(0))} 0 0 1
                                    ${xScale(arcEndpoint(innerDirtRadius))} ${yScale(arcEndpoint(innerDirtRadius))}`}
                                  fill="none"
                                  stroke="rgba(255,255,255,0.24)"
                                  strokeWidth="1"
                                />
                                <path
                                  d={`M ${xScale(-arcEndpoint(outerDirtRadius))} ${yScale(arcEndpoint(outerDirtRadius))}
                                    A ${Math.abs(xScale(outerDirtRadius) - xScale(0))} ${Math.abs(xScale(outerDirtRadius) - xScale(0))} 0 0 1
                                    ${xScale(arcEndpoint(outerDirtRadius))} ${yScale(arcEndpoint(outerDirtRadius))}`}
                                  fill="none"
                                  stroke="rgba(255,255,255,0.22)"
                                  strokeWidth="1"
                                />
                                <circle cx={xScale(moundCenter.x)} cy={yScale(moundCenter.y)} r={Math.abs(xScale(9) - xScale(0))} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                                <rect x={xScale(-4)} y={yScale(59)} width={xScale(4) - xScale(-4)} height={yScale(55) - yScale(59)} fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.7" />
                                <polygon points={baseDiamondOnLine(firstBaseOuter.x, firstBaseOuter.y)} fill="rgba(255,255,255,0.75)" stroke="rgba(255,255,255,0.95)" strokeWidth="0.9" />
                                <polygon points={baseDiamondOnLine(thirdBaseOuter.x, thirdBaseOuter.y)} fill="rgba(255,255,255,0.75)" stroke="rgba(255,255,255,0.95)" strokeWidth="0.9" />
                                <polygon points={centeredDiamond(secondBaseCenter.x, secondBaseCenter.y, 6)} fill="rgba(255,255,255,0.7)" stroke="rgba(255,255,255,0.95)" strokeWidth="0.9" />
                                {sprayView === 'Batted Balls'
                                  ? fallbackPoints.slice(0, 1200).map((point, idx) => {
                                      const normalizedPlayResult = resultLabelForSwing(point.play);
                                      const pointColor = outcomeColor(normalizedPlayResult);
                                      return (
                                        <circle
                                          key={`${cellId}-spr-${idx}`}
                                          cx={xScale(point.x)}
                                          cy={yScale(point.y)}
                                          r={3.8}
                                          fill={pointColor}
                                          opacity={0.95}
                                          onMouseMove={(event) =>
                                            setChartHover({
                                              x: event.clientX,
                                              y: event.clientY,
                                              bg: pointColor,
                                              text: `Result: ${normalizedPlayResult || 'Out'}\nEV: ${point.ev !== null ? `${point.ev.toFixed(1)} mph` : '-'}\nLA: ${point.la !== null ? `${point.la.toFixed(1)}°` : '-'}\nDistance: ${point.distance.toFixed(0)} ft`,
                                            })
                                          }
                                          onMouseLeave={() => setChartHover(null)}
                                        />
                                      );
                                    })
                                  : null}
                                {sprayView === 'Bins'
                                  ? binStats.map((bin) => {
                                      const pt = labelPoint(bin);
                                      return (
                                        <text
                                          key={`${cellId}-spray-bin-label-${bin.key}`}
                                          x={pt.x}
                                          y={pt.y}
                                          textAnchor="middle"
                                          fill="rgba(255,255,255,0.95)"
                                          fontSize={12}
                                          fontWeight={700}
                                        >
                                          {`${bin.pct.toFixed(0)}%`}
                                        </text>
                                      );
                                    })
                                  : null}
                              </svg>
                              </div>
                            );
                          })()}
                        </div>
                      ) : contentType === 'Pitch Usage Pie Chart' ? (
                        <div className="portal-custom-reports-velocity">
                          <div style={{ display: 'grid', justifyItems: 'center', gap: 8 }}>
                            <svg viewBox="0 0 260 172" role="img" aria-label="Pitch usage pie" style={{ display: 'block' }}>
                              {(() => {
                                if (!pitchTypeCountList.length) return null;
                                const total = pieTotal;
                                let angle = -Math.PI / 2;
                                const cx = 130;
                                const cy = 86;
                                const r = 62;
                                return pitchTypeCountList.map(([pitchType, count]) => {
                                  const sweep = (count / total) * Math.PI * 2;
                                  const x1 = cx + r * Math.cos(angle);
                                  const y1 = cy + r * Math.sin(angle);
                                  const nextA = angle + sweep;
                                  const x2 = cx + r * Math.cos(nextA);
                                  const y2 = cy + r * Math.sin(nextA);
                                  const large = sweep > Math.PI ? 1 : 0;
                                  const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
                                  angle = nextA;
                                  return <path key={`${cellId}-pie-${pitchType}`} d={path} fill={PITCH_COLORS[pitchType] ?? '#9ca3af'} stroke="rgba(255,255,255,0.25)" />;
                                });
                              })()}
                            </svg>
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
                              {pitchTypeCountList.slice(0, 8).map(([pitchType, count]) => (
                                <span key={`${cellId}-pie-k-${pitchType}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'rgba(255,255,255,0.92)' }}>
                                  <span
                                    style={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: 999,
                                      background: PITCH_COLORS[pitchType] ?? '#9ca3af',
                                      border: '1px solid rgba(255,255,255,0.35)',
                                      flex: '0 0 auto',
                                    }}
                                  />
                                  <span>{`${((count / pieTotal) * 100).toFixed(1)}%`}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : contentType === 'Pitch Usage Bar Chart' ? (
                        <div className="portal-custom-reports-velocity">
                          <svg viewBox="0 0 620 360" role="img" aria-label="Pitch usage bars">
                            {(() => {
                              if (!pitchTypeCountList.length) return null;
                              const max = Math.max(...pitchTypeCountList.map((entry) => entry[1]), 1);
                              const rows = pitchTypeCountList.slice(0, 10);
                              const colW = 52;
                              const totalWidth = rows.length * colW;
                              const xStart = (620 - totalWidth) / 2;
                              return rows.map(([pitchType, count], idx) => {
                                const barH = (count / max) * 260;
                                const x = xStart + idx * colW;
                                const y = 300 - barH;
                                const pct = (count / totalPitchCount) * 100;
                                return (
                                  <g key={`${cellId}-bar-${pitchType}`}>
                                    <rect x={x} y={y} width={34} height={barH} fill={PITCH_COLORS[pitchType] ?? '#9ca3af'} />
                                    <text x={x + 17} y={y - 6} textAnchor="middle" fontSize={12} fill="white">
                                      {`${pct.toFixed(1)}%`}
                                    </text>
                                    <text x={x + 17} y={334} textAnchor="middle" fontSize={11} fill="white">
                                      {PITCH_ABBR[pitchType] ?? pitchType.slice(0, 2).toUpperCase()}
                                    </text>
                                  </g>
                                );
                              });
                            })()}
                          </svg>
                        </div>
                      ) : contentType === 'Velocity Bar Chart' ? (
                        <div className="portal-custom-reports-velocity">
                          <svg viewBox="0 0 620 360" role="img" aria-label="Velocity bars">
                            {(() => {
                              const veloByType: Record<string, { sum: number; n: number }> = {};
                              for (const p of chartPoints) {
                                const k = (p.pitch_type ?? '').trim() || 'Undefined';
                                const v = Number(p.rel_speed ?? p.velo ?? NaN);
                                if (!Number.isFinite(v)) continue;
                                if (!veloByType[k]) veloByType[k] = { sum: 0, n: 0 };
                                veloByType[k].sum += v;
                                veloByType[k].n += 1;
                              }
                              const avgMap: Record<string, number> = {};
                              for (const [k, obj] of Object.entries(veloByType)) avgMap[k] = obj.n ? obj.sum / obj.n : 0;
                              const ordered = orderedPitchStats(avgMap);
                              if (!ordered.length) return null;
                              const rows = ordered.slice(0, 10);
                              const max = Math.max(...ordered.map((entry) => entry[1]), 1);
                              const min = Math.min(...ordered.map((entry) => entry[1]), 0);
                              const span = Math.max(0.1, max - min);
                              const colW = 52;
                              const totalWidth = rows.length * colW;
                              const xStart = (620 - totalWidth) / 2;
                              return rows.map(([pitchType, value], idx) => {
                                const barH = ((value - min) / span) * 260;
                                const x = xStart + idx * colW;
                                const y = 300 - barH;
                                return (
                                  <g key={`${cellId}-vbar-${pitchType}`}>
                                    <rect x={x} y={y} width={34} height={barH} fill={PITCH_COLORS[pitchType] ?? '#9ca3af'} />
                                    <text x={x + 17} y={y - 6} textAnchor="middle" fontSize={12} fill="white">
                                      {value.toFixed(1)}
                                    </text>
                                    <text x={x + 17} y={334} textAnchor="middle" fontSize={11} fill="white">
                                      {PITCH_ABBR[pitchType] ?? pitchType.slice(0, 2).toUpperCase()}
                                    </text>
                                  </g>
                                );
                              });
                            })()}
                          </svg>
                        </div>
                      ) : contentType === 'Velocity Distribution' ? (
                        <div className="portal-custom-reports-velocity">
                          <svg viewBox="0 0 860 520" role="img" aria-label="Velocity distribution">
                            {(() => {
                              const byType = new Map<string, number[]>();
                              for (const point of chartPoints) {
                                const pitchType = ((point.pitch_type ?? '').trim() || 'Undefined') as string;
                                const velo = toNum(point.rel_speed ?? point.velo);
                                if (velo === null) continue;
                                const list = byType.get(pitchType) ?? [];
                                list.push(velo);
                                byType.set(pitchType, list);
                              }
                              const ordered = orderedPitchStats(
                                Object.fromEntries(Array.from(byType.entries()).map(([pitchType, values]) => [pitchType, values.length]))
                              ).filter(([_, count]) => count > 0);
                              if (!ordered.length) return null;
                              const allValues = Array.from(byType.values()).flat();
                              const minRaw = Math.min(...allValues);
                              const maxRaw = Math.max(...allValues);
                              const minV = Math.floor(minRaw / 5) * 5;
                              const maxV = Math.ceil((maxRaw + 1e-6) / 5) * 5;
                              const safeMaxV = maxV > minV ? maxV : minV + 5;
                              const xTicks = Array.from({ length: Math.max(2, Math.floor((safeMaxV - minV) / 5) + 1) }, (_, idx) => minV + idx * 5);
                              const laneH = Math.min(220, Math.max(48, 440 / Math.max(1, ordered.length)));
                              const top = 26;
                              const left = 72;
                              const right = 24;
                              const width = 860 - left - right;
                              const xFor = (v: number) => left + ((v - minV) / Math.max(1, safeMaxV - minV)) * width;
                              const densityPath = (values: number[], baseY: number, scale: number) => {
                                if (!values.length) return '';
                                const samples = 120;
                                const sigma = 0.9;
                                const xs = Array.from({ length: samples }, (_, i) => minV + (i / (samples - 1)) * (safeMaxV - minV));
                                const dens = xs.map((x) => values.reduce((sum, v) => sum + Math.exp(-0.5 * ((x - v) / sigma) ** 2), 0));
                                const maxD = Math.max(...dens, 1e-6);
                                const ptsTop = xs.map((x, i) => `${xFor(x)},${baseY - (dens[i] / maxD) * scale}`).join(' ');
                                const ptsBot = xs
                                  .slice()
                                  .reverse()
                                  .map((x) => `${xFor(x)},${baseY}`)
                                  .join(' ');
                                return `${ptsTop} ${ptsBot}`;
                              };
                              return (
                                <>
                                  {xTicks.map((tick) => (
                                    <line key={`${cellId}-vd-x-${tick}`} x1={xFor(tick)} y1={top - 10} x2={xFor(tick)} y2={top + laneH * ordered.length} stroke="rgba(255,255,255,0.12)" />
                                  ))}
                                  {ordered.map(([pitchType], idx) => {
                                    const values = byType.get(pitchType) ?? [];
                                    const yBase = top + (idx + 1) * laneH;
                                    const median = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null;
                                    const polygon = densityPath(values, yBase, laneH * 0.72);
                                    return (
                                      <g key={`${cellId}-vd-row-${pitchType}`}>
                                        <text x={left - 14} y={yBase - laneH * 0.32} textAnchor="end" fontSize={22} fontWeight={800} fill="rgba(255,255,255,0.96)">
                                          {PITCH_ABBR[pitchType] ?? pitchType.slice(0, 2).toUpperCase()}
                                        </text>
                                        <line x1={left} y1={yBase} x2={860 - right} y2={yBase} stroke={PITCH_COLORS[pitchType] ?? '#9ca3af'} strokeWidth={1.4} opacity={0.95} />
                                        {polygon ? <polygon points={polygon} fill={PITCH_COLORS[pitchType] ?? '#9ca3af'} opacity={0.92} /> : null}
                                        {median !== null ? (
                                          <line x1={xFor(median)} y1={yBase - laneH * 0.75} x2={xFor(median)} y2={yBase} stroke="#111111" strokeWidth={2.6} strokeDasharray="9,8" />
                                        ) : null}
                                      </g>
                                    );
                                  })}
                                  {xTicks.map((tick) => (
                                    <text key={`${cellId}-vd-l-${tick}`} x={xFor(tick)} y={Math.min(506, top + laneH * ordered.length + 22)} textAnchor="middle" fontSize={13} fill="rgba(255,255,255,0.88)">
                                      {tick}
                                    </text>
                                  ))}
                                </>
                              );
                            })()}
                          </svg>
                        </div>
                      ) : contentType === 'Velocity Chart' ? (
                        <div className="portal-custom-reports-velocity">
                          <svg viewBox="0 0 620 360" role="img" aria-label="Velocity chart" onMouseLeave={() => setChartHover(null)}>
                            {(() => {
                              const raw = chartPoints
                                .map((point) => ({
                                  date: (point.session_date ?? '').slice(0, 10),
                                  velo: toNum(point.rel_speed ?? point.velo),
                                  inning: toNum(point.inning),
                                  inningRaw: String(point.inning ?? '').trim(),
                                  pitcher: String(point.pitcher ?? '').trim(),
                                  gameKey: String(point.game_id || point.game_uid || point.game_foreign_id || '').trim(),
                                  pitchType: ((point.pitch_type ?? '').trim() || 'Undefined') as string,
                                  pitchNumber: toNum(point.pitch_number),
                                  pitchNo: toNum(point.pitch_no),
                                  pitchEventId: toNum(point.pitch_event_id),
                                }))
                                .filter(
                                  (
                                    point
                                  ): point is {
                                    date: string;
                                    velo: number;
                                    inning: number | null;
                                    inningRaw: string;
                                    pitcher: string;
                                    gameKey: string;
                                    pitchType: string;
                                    pitchNumber: number | null;
                                    pitchNo: number | null;
                                    pitchEventId: number | null;
                                  } => Boolean(point.date) && point.velo !== null
                                );
                              if (!raw.length) return null;
                              const mode = config.velocityChart || 'Velocity Chart (Game/Inning)';
                              const m = { l: 46, r: 14, t: 10, b: mode === 'Average Velocity by Game' ? 64 : 30 };
                              const w = 620;
                              const h = 360;
                              const pw = w - m.l - m.r;
                              const ph = h - m.t - m.b;
                              const byType = new Map<string, Array<{ xKey: string; x: number; y: number }>>();
                              const inningBoundaries: number[] = [];
                              if (mode === 'Velocity Chart (Game/Inning)') {
                                const ordered = [...raw]
                                  .sort((a, b) => {
                                    const dCmp = a.date.localeCompare(b.date);
                                    if (dCmp !== 0) return dCmp;
                                    const pnCmp = (a.pitchNumber ?? 0) - (b.pitchNumber ?? 0);
                                    if (pnCmp !== 0) return pnCmp;
                                    const pnoCmp = (a.pitchNo ?? 0) - (b.pitchNo ?? 0);
                                    if (pnoCmp !== 0) return pnoCmp;
                                    return (a.pitchEventId ?? 0) - (b.pitchEventId ?? 0);
                                  })
                                  .map((row, idx) => ({ ...row, pitchCount: idx + 1 }));
                                const dateSet = new Set(ordered.map((row) => row.date).filter(Boolean));
                                const gameSet = new Set(ordered.map((row) => row.gameKey).filter(Boolean));
                                const dataPitcherSet = new Set(ordered.map((row) => row.pitcher).filter(Boolean));
                                const hasSingleGameOrDate = (gameSet.size > 0 && gameSet.size <= 1) || dateSet.size <= 1;
                                const selectedPlayer = String(config.player ?? '').trim();
                                const hasSinglePitcher = (selectedPlayer.length > 0 && selectedPlayer !== 'All') || dataPitcherSet.size === 1;
                                const showInningBoundaries = hasSinglePitcher && hasSingleGameOrDate;
                                const inningToKey = (value: unknown): string => {
                                  const raw = String(value ?? '').trim();
                                  if (!raw) return '';
                                  const numeric = Number(raw);
                                  if (Number.isFinite(numeric)) return String(Math.floor(numeric));
                                  const match = raw.match(/\d+/);
                                  return match ? match[0] : raw.toLowerCase();
                                };
                                if (showInningBoundaries) {
                                  for (let i = 1; i < ordered.length; i += 1) {
                                    const prev = inningToKey(ordered[i - 1].inningRaw);
                                    const cur = inningToKey(ordered[i].inningRaw);
                                    if (prev && cur && prev !== cur) inningBoundaries.push(ordered[i].pitchCount);
                                  }
                                }
                                for (const row of ordered) {
                                  const arr = byType.get(row.pitchType) ?? [];
                                  arr.push({ xKey: row.date, x: row.pitchCount, y: row.velo });
                                  byType.set(row.pitchType, arr);
                                }
                              } else if (mode === 'Average Velocity by Inning') {
                                const grouped = new Map<string, { sum: number; n: number }>();
                                for (const row of raw) {
                                  if (row.inning === null) continue;
                                  const inning = Math.max(1, Math.floor(row.inning));
                                  const key = `${inning}|${row.pitchType}`;
                                  const current = grouped.get(key) ?? { sum: 0, n: 0 };
                                  current.sum += row.velo;
                                  current.n += 1;
                                  grouped.set(key, current);
                                }
                                for (const [key, current] of grouped.entries()) {
                                  const [inningText, pitchType] = key.split('|');
                                  const inning = Number(inningText);
                                  const arr = byType.get(pitchType) ?? [];
                                  arr.push({ xKey: inningText, x: inning, y: current.sum / Math.max(1, current.n) });
                                  byType.set(pitchType, arr);
                                }
                              } else {
                                const grouped = new Map<string, { sum: number; n: number }>();
                                for (const row of raw) {
                                  const key = `${row.date}|${row.pitchType}`;
                                  const current = grouped.get(key) ?? { sum: 0, n: 0 };
                                  current.sum += row.velo;
                                  current.n += 1;
                                  grouped.set(key, current);
                                }
                                const dateKeys = Array.from(new Set(raw.map((row) => row.date))).sort((a, b) => a.localeCompare(b));
                                const dateToIndex = new Map(dateKeys.map((date, idx) => [date, idx + 1]));
                                for (const [key, current] of grouped.entries()) {
                                  const [date, pitchType] = key.split('|');
                                  const index = dateToIndex.get(date) ?? 1;
                                  const arr = byType.get(pitchType) ?? [];
                                  arr.push({ xKey: date, x: index, y: current.sum / Math.max(1, current.n) });
                                  byType.set(pitchType, arr);
                                }
                              }
                              const allRows = Array.from(byType.values()).flat();
                              if (!allRows.length) return null;
                              const isGameInning = mode === 'Velocity Chart (Game/Inning)';
                              const observedXMax = Math.max(...allRows.map((row) => row.x), 1);
                              const roundedGameMax = Math.ceil(observedXMax / 10) * 10;
                              const xMax = isGameInning ? Math.max(10, roundedGameMax) : observedXMax;
                              const xMin = isGameInning ? 0 : 1;
                              const values = allRows.map((row) => row.y);
                              const minRaw = Math.min(...values);
                              const maxRaw = Math.max(...values);
                              const yMin = Math.floor(minRaw / 5) * 5;
                              const yMax = Math.max(yMin + 5, Math.ceil(maxRaw / 5) * 5);
                              const yStep = 5;
                              const span = Math.max(0.1, yMax - yMin);
                              const px = (x: number) => m.l + ((x - xMin) / Math.max(1, xMax - xMin)) * pw;
                              const py = (y: number) => m.t + ((yMax - y) / span) * ph;
                              const xTicksRaw = isGameInning
                                ? (() => {
                                    const step = xMax <= 100 ? 10 : xMax <= 500 ? 50 : 100;
                                    return Array.from({ length: Math.floor(xMax / step) + 1 }, (_, idx) => idx * step);
                                  })()
                                : Array.from({ length: Math.max(1, xMax) }, (_, idx) => idx + 1);
                              const xTicks = Array.from(new Set(xTicksRaw));
                              const yTickCount = Math.max(2, Math.floor((yMax - yMin) / yStep) + 1);
                              const yTicks = Array.from({ length: yTickCount }, (_, idx) => yMin + idx * yStep);
                              return (
                                <>
                                  {yTicks.map((tick) => (
                                    <g key={`${cellId}-vv-y-${tick}`}>
                                      <line x1={m.l} y1={py(tick)} x2={w - m.r} y2={py(tick)} stroke="rgba(255,255,255,0.14)" />
                                      <text x={m.l - 8} y={py(tick) + 4} textAnchor="end" fill="rgba(255,255,255,0.78)" fontSize={11}>
                                        {Number.isInteger(tick) ? tick : tick.toFixed(1)}
                                      </text>
                                    </g>
                                  ))}
                                  {xTicks.map((tick) => (
                                    <line key={`${cellId}-vv-x-${tick}`} x1={px(tick)} y1={m.t} x2={px(tick)} y2={h - m.b} stroke="rgba(255,255,255,0.08)" />
                                  ))}
                                  {mode === 'Velocity Chart (Game/Inning)'
                                    ? inningBoundaries.map((value) => (
                                        <line
                                          key={`${cellId}-vv-bound-${value}`}
                                          x1={px(value)}
                                          y1={m.t}
                                          x2={px(value)}
                                          y2={h - m.b}
                                          stroke="rgba(255,255,255,0.92)"
                                          strokeDasharray="6,6"
                                          strokeWidth={1.5}
                                        />
                                      ))
                                    : null}
                                  {Array.from(byType.entries()).map(([pitchType, rows]) => {
                                    const sorted = [...rows].sort((a, b) => a.x - b.x);
                                    const points = sorted.map((row) => `${px(row.x)},${py(row.y)}`).join(' ');
                                    if (mode === 'Velocity Chart (Game/Inning)') return null;
                                    return <polyline key={`${cellId}-vl-line-${pitchType}`} fill="none" stroke={PITCH_COLORS[pitchType] ?? '#9ca3af'} strokeWidth={2} points={points} />;
                                  })}
                                  {mode === 'Velocity Chart (Game/Inning)'
                                    ? Array.from(byType.entries()).map(([pitchType, rows]) => {
                                        const mean = rows.length ? rows.reduce((sum, row) => sum + row.y, 0) / rows.length : null;
                                        if (mean === null) return null;
                                        return (
                                          <line
                                            key={`${cellId}-vl-avg-${pitchType}`}
                                            x1={m.l}
                                            y1={py(mean)}
                                            x2={w - m.r}
                                            y2={py(mean)}
                                            stroke={PITCH_COLORS[pitchType] ?? '#9ca3af'}
                                            strokeWidth={1.6}
                                            opacity={0.9}
                                          />
                                        );
                                      })
                                    : null}
                                  {Array.from(byType.entries()).flatMap(([pitchType, rows]) =>
                                    rows.map((row, idx) => (
                                      <circle
                                        key={`${cellId}-vl-pt-${pitchType}-${idx}`}
                                        cx={px(row.x)}
                                        cy={py(row.y)}
                                        r={5}
                                        fill={PITCH_COLORS[pitchType] ?? '#9ca3af'}
                                        stroke="rgba(0,0,0,0.55)"
                                        onMouseMove={(event) =>
                                          setChartHover({
                                            x: event.clientX,
                                            y: event.clientY,
                                            bg: PITCH_COLORS[pitchType] ?? '#111827',
                                            text:
                                              mode === 'Average Velocity by Inning'
                                                ? `${pitchType}\nInning: ${row.xKey}\nVelo: ${row.y.toFixed(1)} mph`
                                                : mode === 'Velocity Chart (Game/Inning)'
                                                  ? `${pitchType}\nPitch #: ${Math.round(row.x)}\nVelo: ${row.y.toFixed(1)} mph`
                                                  : `${pitchType}\nDate: ${fmtShortDate(row.xKey)}\nVelo: ${row.y.toFixed(1)} mph`,
                                          })
                                        }
                                        onMouseLeave={() => setChartHover(null)}
                                      />
                                    ))
                                  )}
                                  {xTicks.map((tick) => (
                                    <text key={`${cellId}-vv-xlab-${tick}`} x={px(tick)} y={h - (mode === 'Average Velocity by Game' ? 24 : 14)} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize={11}>
                                      {mode === 'Average Velocity by Inning'
                                        ? tick
                                        : mode === 'Velocity Chart (Game/Inning)'
                                          ? tick
                                          : fmtShortDate(Array.from(new Set(raw.map((row) => row.date))).sort((a, b) => a.localeCompare(b))[tick - 1] ?? '')}
                                    </text>
                                  ))}
                                </>
                              );
                            })()}
                          </svg>
                        </div>
                      ) : isVelocityLike ? (
                        <div className="portal-custom-reports-ab-list">
                          <p className="portal-muted-text">No data for selected velocity chart.</p>
                        </div>
                      ) : contentType === 'Summary Table' ? (
                        <div className="portal-custom-reports-table-wrap">
                          <table className="portal-table">
                            <thead>
                              <tr>
                                {tableColumns.map((column, columnIndex) => {
                                  const activeSort = tableSort?.column === column;
                                  return (
                                    <th
                                      key={`${cellId}-th-${column}`}
                                      style={{ cursor: 'pointer' }}
                                      onClick={() =>
                                        setTableSorts((current) => {
                                          const existing = current[cellId];
                                          return {
                                            ...current,
                                            [cellId]:
                                              existing?.column === column
                                                ? {
                                                    column,
                                                    direction: existing.direction === 'asc' ? 'desc' : 'asc',
                                                  }
                                                : {
                                                    column,
                                                    direction: columnIndex === 0 ? 'asc' : 'desc',
                                                  },
                                          };
                                        })
                                      }
                                    >
                                      {column}
                                      {activeSort ? ` ${tableSort?.direction === 'asc' ? '↑' : '↓'}` : ''}
                                    </th>
                                  );
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              {sortedTableRows.map((row, idx) => (
                                <tr key={`${cellId}-tr-${idx}`}>
                                  {tableColumns.map((column, columnIndex) => (
                                    <td
                                      key={`${cellId}-td-${idx}-${column}`}
                                      style={{
                                        textAlign: 'center',
                                        ...(() => {
                                          const val = formatTableDisplayValue(column, row[column]);
                                          const isAllRow = String(row[tableColumns[0]] ?? '').trim().toLowerCase() === 'all';
                                          const pitchStyle = !isAllRow && columnIndex === 0 ? pitchTypeCellStyle(val) : null;
                                          return pitchStyle?.cellStyle ?? {};
                                        })(),
                                      }}
                                    >
                                      {(() => {
                                        const splitValue = String(row[tableColumns[0]] ?? 'All');
                                        const style = tableCellStyle(column, row[column], splitValue);
                                        const val = formatTableDisplayValue(column, row[column]);
                                        const isAllRow = String(row[tableColumns[0]] ?? '').trim().toLowerCase() === 'all';
                                        const pitchStyle = !isAllRow && columnIndex === 0 ? pitchTypeCellStyle(val) : null;
                                        if (pitchStyle) return pitchStyle.label;
                                        if (!style) return val;
                                        return <span style={style}>{val}</span>;
                                      })()}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                              {!tableRows.length ? (
                                <tr>
                                  <td colSpan={Math.max(1, tableColumns.length || 1)} className="portal-muted-text">
                                    No data for current selection.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="portal-custom-reports-ab-list">
                          {(chartPoints.length ? chartPoints.slice(0, 12) : []).map((point, idx) => (
                            <p key={`${cellId}-ab-${idx}`}>
                              {`${fmtShortDate(point.session_date)} • ${(point.pitch_type ?? 'Undefined').trim() || 'Undefined'} • ${(point.pitch_call ?? point.play_result ?? '-').trim() || '-'}`}
                            </p>
                          ))}
                          {!chartPoints.length ? <p className="portal-muted-text">No pitches for current selection.</p> : null}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
              {showPitchTypeKey || showLocationChartKey || showExitVelocityKey || showBattedResultsKey ? (
                <div className="portal-custom-reports-legend" style={{ display: 'grid', gap: 8 }}>
                  {showPitchTypeKey ? (
                    <div>
                      <div className="portal-muted-text" style={{ marginBottom: 6 }}>Pitch Types</div>
                      <div className="portal-custom-reports-legend-grid">
                        {pitchTypeLegend.map((pitchType) => (
                          <span key={pitchType} className="portal-custom-reports-legend-item">
                            <span className="portal-custom-reports-legend-dot" style={{ background: PITCH_COLORS[pitchType] ?? '#9ca3af' }} />
                            <span>{pitchType}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {showLocationChartKey ? (
                    <div>
                      <div className="portal-muted-text" style={{ marginBottom: 6 }}>Location Chart Results</div>
                      <div className="portal-custom-reports-legend-grid">
                        {[
                          { key: 'called_strike', label: 'Called Strike' },
                          { key: 'ball', label: 'Ball' },
                          { key: 'foul', label: 'Foul' },
                          { key: 'whiff', label: 'Whiff' },
                          { key: 'in_play_out', label: 'In Play (Out)' },
                          { key: 'in_play_hit', label: 'In Play (Hit)' },
                          { key: 'error', label: 'Error' },
                        ].map((row) => (
                          <span key={`loc-key-${row.key}`} className="portal-custom-reports-legend-item">
                            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                              {row.key === 'called_strike' ? <circle cx="7" cy="7" r="4" fill="#fff" /> : null}
                              {row.key === 'ball' ? <circle cx="7" cy="7" r="4" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                              {row.key === 'foul' ? <polygon points="7,2 12,11 2,11" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                              {row.key === 'whiff' ? <polygon points="7,1.5 8.7,5.2 12.8,5.2 9.5,7.6 10.8,11.8 7,9.3 3.2,11.8 4.5,7.6 1.2,5.2 5.3,5.2" fill="#fff" /> : null}
                              {row.key === 'in_play_out' ? <polygon points="7,2 12,11 2,11" fill="#fff" /> : null}
                              {row.key === 'in_play_hit' ? <rect x="3" y="3" width="8" height="8" fill="#fff" /> : null}
                              {row.key === 'error' ? <rect x="3" y="3" width="8" height="8" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                            </svg>
                            <span>{row.label}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {showExitVelocityKey ? (
                    <div>
                      <div className="portal-muted-text" style={{ marginBottom: 6 }}>Exit Velocity</div>
                      <div className="portal-custom-reports-legend-grid">
                        {EV_BINS.map((bin) => (
                          <span key={`ev-key-${bin}`} className="portal-custom-reports-legend-item">
                            <span className="portal-custom-reports-legend-dot" style={{ background: EV_COLOR_PALETTE[bin] }} />
                            <span>{bin}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {showBattedResultsKey ? (
                    <div>
                      <div className="portal-muted-text" style={{ marginBottom: 6 }}>Batted Results</div>
                      <div className="portal-custom-reports-legend-grid">
                        {battedResultLegend.map((result) => (
                          <span key={`batted-key-${result}`} className="portal-custom-reports-legend-item">
                            <span className="portal-custom-reports-legend-dot" style={{ background: RESULT_COLOR_PALETTE[result] ?? RESULT_COLOR_PALETTE.Unknown }} />
                            <span>{result}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {chartHover ? (
                <div
                  style={{
                    position: 'fixed',
                    left: chartHover.x + 12,
                    top: chartHover.y + 12,
                    zIndex: 90,
                    pointerEvents: 'none',
                    whiteSpace: 'pre-line',
                    background: chartHover.bg ?? 'rgba(0,0,0,0.92)',
                    border: '1px solid rgba(255,255,255,0.22)',
                    borderRadius: 8,
                    padding: '0.35rem 0.45rem',
                    fontSize: '0.74rem',
                    lineHeight: 1.25,
                    color: hoverTextColor(chartHover.bg),
                  }}
                >
                  {chartHover.text}
                </div>
              ) : null}
            </article>
        </div>
      </div>
    </section>
  );
}

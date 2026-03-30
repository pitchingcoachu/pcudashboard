'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTableDisplayValue, parseSortableNumber, sortTableRows, type SortDirection } from '../../../lib/table-sort';
import { getProTeamLogoUrl, inferProTeamCode } from './pro-team-logos';

type OptionItem = { value: string; label: string };
type HeatCell = { x: number; y: number; w: number; h: number; value: number; density: number };

type HittingFiltersPayload = {
  school_code: string;
  min_date: string | null;
  max_date: string | null;
  team_types?: string[];
  level_options?: string[];
  hitters: string[];
  opp_pitchers: string[];
  hands: string[];
  batter_sides: string[];
  pitch_types: string[];
  zone_locations: string[];
  in_zone_options: string[];
  pitch_results: string[];
  count_options: string[];
  after_count_options: string[];
  bip_results: string[];
  table_modes: string[];
  split_by_options: string[];
  hitters_by_team_code?: Record<string, string[]>;
  opp_pitchers_by_team_code?: Record<string, string[]>;
};

type ChartPoint = {
  pitch_event_id?: number | null;
  session_date: string | null;
  pitcher: string;
  batter: string;
  pitcher_team_code?: string;
  batter_team_code?: string;
  pitcherthrows: string;
  batterside: string;
  pitch_type: string;
  pitch_call: string;
  play_result: string;
  result_label: string;
  session_type: string;
  rel_speed: number | null;
  exit_speed: number | null;
  angle: number | null;
  run_value?: number | null;
  estimated_woba_using_speedangle?: number | null;
  estimated_ba_using_speedangle?: number | null;
  distance: number | null;
  direction: number | null;
  hc_x?: number | null;
  hc_y?: number | null;
  plate_side: number | null;
  plate_height: number | null;
  contact_position_x?: number | null;
  contact_position_y?: number | null;
  contact_position_z?: number | null;
  vertical_attack_angle?: number | null;
  horizontal_attack_angle?: number | null;
  bat_speed?: number | null;
  pitch_number: number | null;
  balls_num?: number | null;
  strikes_num?: number | null;
  velo?: number | null;
  ivb?: number | null;
  hb?: number | null;
};

type ChartHover = { x: number; y: number; text: string; bg?: string } | null;

type HittingOverviewPayload = {
  school_code: string;
  hitter: string | null;
  opp_pitcher: string | null;
  start_date: string | null;
  end_date: string | null;
  total_pitches: number;
  table_mode: string;
  split_by: string;
  pitch_type_legend: string[];
  table_columns: string[];
  available_table_columns?: string[];
  table_rows: Record<string, string | number | null>[];
  chart_points: ChartPoint[];
};

type AbReportPayload = {
  school_code: string;
  hitter: string;
  selected_game_key: string | null;
  selected_game_date: string | null;
  available_games: Array<{
    game_key: string;
    date: string;
    label: string;
  }>;
  pitch_type_legend: string[];
  pa_groups: Array<{
    pitcher: string;
    pas: Array<{
      pa_index: number;
      result_label: string;
      hitter_label: string;
      pitches: ChartPoint[];
    }>;
  }>;
  total_pa: number;
};

type CustomTableConfig = {
  id: number;
  name: string;
  columns: string[];
  createdAt?: string;
  updatedAt?: string;
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

const RESULT_ORDER = ['Called Strike', 'Ball', 'Foul', 'Whiff', 'In Play (Out)', 'In Play (Hit)', 'Error'] as const;
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
const RESULT_LABELS: Record<string, string> = {
  'Called Strike': 'Called Strike',
  Ball: 'Ball',
  Foul: 'Foul',
  Whiff: 'Whiff',
  'In Play (Out)': 'In Play (Out)',
  'In Play (Hit)': 'In Play (Hit)',
  Error: 'Error',
};
const SPRAY_RESULT_ORDER = ['Single', 'Double', 'Triple', 'HomeRun', 'Out', 'Error'] as const;
const SPRAY_RESULT_LABELS: Record<(typeof SPRAY_RESULT_ORDER)[number], string> = {
  Single: 'Single',
  Double: 'Double',
  Triple: 'Triple',
  HomeRun: 'Home Run',
  Out: 'Out',
  Error: 'Error',
};
const SPRAY_RESULT_COLORS: Record<(typeof SPRAY_RESULT_ORDER)[number], string> = {
  Single: '#34d399',
  Double: '#60a5fa',
  Triple: '#c084fc',
  HomeRun: '#f87171',
  Out: '#e5e7eb',
  Error: '#f59e0b',
};
const SPLIT_BY_DEFAULT = 'Pitch Types';
const TABLE_MODE_DEFAULT = 'Results';
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
  'Called-S%',
  'Take%',
  'Chase%',
  'GoZoneSw%',
  'IZswing%',
  'EdgeSwing%',
  'PosSD%',
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
  'Swings',
  'Takes',
  'Called-S',
  'Chases',
  'IZswings',
  'FPS',
  'EdgeSwings',
  'PosSD',
  'GoZoneSw',
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

function reorderColumns(columns: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= columns.length || toIndex >= columns.length) return columns;
  const next = [...columns];
  const [item] = next.splice(fromIndex, 1);
  if (!item) return columns;
  next.splice(toIndex, 0, item);
  return next;
}

function markerForResult(resultLabel: string, x: number, y: number, color: string, key: string) {
  const strokeWidth = 2.2;
  const r = 7.6;
  switch (resultLabel) {
    case 'Ball':
      return <circle key={key} cx={x} cy={y} r={r} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={strokeWidth} />;
    case 'Foul': {
      const pts = `${x},${y - 9.5} ${x - 8.8},${y + 7.4} ${x + 8.8},${y + 7.4}`;
      return <polygon key={key} points={pts} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={strokeWidth} />;
    }
    case 'Whiff':
      return (
        <text key={key} x={x} y={y + 7.2} fill={color} fontSize="36" fontWeight={700} textAnchor="middle" dominantBaseline="middle">
          *
        </text>
      );
    case 'In Play (Out)': {
      const pts = `${x},${y - 9.5} ${x - 8.8},${y + 7.4} ${x + 8.8},${y + 7.4}`;
      return <polygon key={key} points={pts} fill={color} stroke={color} strokeWidth={1.2} />;
    }
    case 'In Play (Hit)':
      return <rect key={key} x={x - 6.8} y={y - 6.8} width={13.6} height={13.6} fill={color} stroke={color} strokeWidth={1.6} />;
    case 'Error':
      return <rect key={key} x={x - 7.4} y={y - 7.4} width={14.8} height={14.8} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={strokeWidth} />;
    default:
      return <circle key={key} cx={x} cy={y} r={r} fill={color} stroke={color} strokeWidth={1.2} />;
  }
}

function formatDateMMDDYY(value: string | null): string {
  if (!value) return 'All Dates';
  const dt = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return value;
  return `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(-2)}`;
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

function resolveAbPitchResult(pitch: ChartPoint): string {
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

function normalizedThrowHand(value: string): 'L' | 'R' | 'U' {
  const v = (value || '').trim().toLowerCase();
  if (v.startsWith('l')) return 'L';
  if (v.startsWith('r')) return 'R';
  return 'U';
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatNameFirstLast(name: string): string {
  const trimmed = name.trim();
  if (!trimmed.includes(',')) return trimmed;
  const [last, first] = trimmed.split(',').map((part) => part.trim());
  if (!last || !first) return trimmed;
  return `${first} ${last}`;
}

function toOptions(values?: string[], formatNames = false): OptionItem[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => ({ value, label: formatNames ? formatNameFirstLast(value) : value }));
}

function pickDefaultTeamType(teamTypes: string[] | undefined, schoolCode: string | undefined): string {
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

function hoverTextColor(bg?: string): string {
  if (!bg) return '#fff';
  const v = bg.toLowerCase();
  if (v === '#ffffff' || v === 'white' || v === 'orange' || v === 'turquoise') return '#111';
  return '#fff';
}

function resultLabelForSwing(playResult: string): string {
  const value = (playResult || '').trim();
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
}

function evBin(value: number | null | undefined): (typeof EV_BINS)[number] {
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
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rgb = (r: number, g: number, b: number) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
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
  const mid = min + (max - min) * 0.5;
  return divergingColor(value, min, mid, max);
}

function normalizePitchTypeName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function getHeatmapFixedScale(metricRaw: string, selectedPitchTypesRaw: string[]): { min: number; mid: number; max: number } | null {
  const metric = String(metricRaw ?? '').trim();
  const selectedPitchTypes = selectedPitchTypesRaw
    .map((value) => normalizePitchTypeName(value))
    .filter((value) => value && value !== 'all');

  if (metric === 'Exit Velocity') return { min: 80, mid: 90, max: 100 };
  if (metric === 'xWOBA') return { min: 0.25, mid: 0.33, max: 0.41 };
  if (metric === 'Whiff Rate') {
    if (selectedPitchTypes.length !== 1) return { min: 10, mid: 25, max: 40 };
    const pt = selectedPitchTypes[0];
    if (pt === 'fastball') return { min: 10, mid: 20, max: 30 };
    if (pt === 'sinker') return { min: 5, mid: 12.5, max: 20 };
    return { min: 20, mid: 32.5, max: 45 };
  }
  if (metric === 'Swing Rate') return { min: 20, mid: 50, max: 80 };
  if (metric === 'GB Rate') {
    if (selectedPitchTypes.length !== 1) return { min: 35, mid: 45, max: 55 };
    const pt = selectedPitchTypes[0];
    if (pt === 'sinker') return { min: 43, mid: 54, max: 65 };
    if (pt === 'fastball') return { min: 31, mid: 39, max: 47 };
    if (['cutter', 'slider', 'sweeper', 'curveball'].includes(pt)) return { min: 36, mid: 43, max: 50 };
    if (['changeup', 'splitter'].includes(pt)) return { min: 35, mid: 47, max: 59 };
    return { min: 35, mid: 45, max: 55 };
  }
  if (metric === 'Contact Rate') {
    if (selectedPitchTypes.length !== 1) return { min: 60, mid: 75, max: 90 };
    const pt = selectedPitchTypes[0];
    if (pt === 'fastball') return { min: 70, mid: 80, max: 90 };
    if (pt === 'sinker') return { min: 80, mid: 87.5, max: 95 };
    return { min: 55, mid: 67.5, max: 80 };
  }
  return null;
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

function LocationChart({
  title,
  points,
  displayView,
  selectedPitchTypes,
  strictRunValue,
  viewOptions,
  onViewChange,
  onPointHover,
  onPointLeave,
}: {
  title: string;
  points: ChartPoint[];
  displayView: string;
  selectedPitchTypes: string[];
  strictRunValue: boolean;
  viewOptions: OptionItem[];
  onViewChange: (next: string) => void;
  onPointHover: (hover: Exclude<ChartHover, null>) => void;
  onPointLeave: () => void;
}) {
  const w = 430;
  const h = 340;
  const pad = 26;
  const xMin = -2.5;
  const xMax = 2.5;
  const yMin = 0;
  const yMax = 4.5;

  const xScale = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * (w - pad * 2);
  const yScale = (y: number) => h - pad - ((y - yMin) / (yMax - yMin)) * (h - pad * 2);

  const zoneLeft = -0.88;
  const zoneRight = 0.88;
  const zoneBottom = 1.5;
  const zoneTop = 3.6;
  const midX = (zoneLeft + zoneRight) / 2;
  const midY = (zoneBottom + zoneTop) / 2;
  const compRadiusFt = 1.5;
  const compBottom = midY - compRadiusFt;
  const compTop = midY + compRadiusFt;
  const compLeft = midX - compRadiusFt;
  const compRight = midX + compRadiusFt;
  const greenHalf = 7 / 12;

  const inZone = points.filter((p) => parseNumber(p.plate_side) !== null && parseNumber(p.plate_height) !== null);
  const cells = displayView === 'Pitch' ? [] : buildHeatCells(inZone, displayView, strictRunValue);
  const values = cells.map((cell) => cell.value).sort((a, b) => a - b);
  const densityMax = Math.max(1e-9, ...cells.map((cell) => cell.density));
  const dynamicMinVal = values.length ? values[0] : 0;
  const dynamicMaxVal = values.length ? values[values.length - 1] : 1;
  const dynamicMidVal = values.length ? values[Math.floor(values.length / 2)] : 0;
  const fixedScale = getHeatmapFixedScale(displayView, selectedPitchTypes);
  const contactVisibilityScale = displayView === 'Contact Rate' ? getHeatmapFixedScale('Whiff Rate', selectedPitchTypes) : null;
  const minVal = fixedScale?.min ?? dynamicMinVal;
  const maxVal = fixedScale?.max ?? dynamicMaxVal;
  const midVal = fixedScale?.mid ?? dynamicMidVal;
  const rvMin = -5;
  const rvMax = 5;
  const zoom = displayView === 'Pitch' ? 1 : 1.2;
  const zoomTransform = `translate(${w / 2} ${h / 2}) scale(${zoom}) translate(${-w / 2} ${-h / 2})`;
  const idBase = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return (
    <div className="dashboard-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h4 style={{ margin: 0, textAlign: 'center' }}>{title}</h4>
      <div style={{ display: 'grid', justifyItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: 260 }}>
          <SearchableSingleSelect options={viewOptions} value={displayView} onChange={onViewChange} placeholder="Pitch" />
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 340, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }}>
        <defs>
          <clipPath id={`hitting-loc-zoom-clip-${idBase}`}>
            <rect x={0} y={0} width={w} height={h} />
          </clipPath>
          <filter id={`hitting-loc-heat-blur-${idBase}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
          <filter id={`hitting-loc-heat-blur-rv-${idBase}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.75" />
          </filter>
        </defs>
        <g transform={zoomTransform} clipPath={`url(#hitting-loc-zoom-clip-${idBase})`}>
        {displayView !== 'Pitch' ? (
          <>
            <g filter={displayView === 'Run Values' ? `url(#hitting-loc-heat-blur-rv-${idBase})` : `url(#hitting-loc-heat-blur-${idBase})`}>
              {cells.map((cell) => {
                if (!Number.isFinite(cell.value)) return null;
                const cx = xScale(cell.x + cell.w / 2);
                const cy = yScale(cell.y + cell.h / 2);
                const radius = Math.max(2.0, cell.w * ((w - pad * 2) / (xMax - xMin)) * 1.45);
                const densityNorm = Math.max(0, Math.min(1, cell.density / densityMax));
                let fill = 'rgba(255,255,255,0.12)';
                if (displayView === 'Frequency') fill = sequentialColor(cell.value, minVal, maxVal);
                else if (displayView === 'Run Values') fill = divergingColor(Math.max(rvMin, Math.min(rvMax, cell.value)), rvMin, 0, rvMax);
                else fill = divergingColor(cell.value, minVal, midVal, maxVal);
                const normalized =
                  displayView === 'Run Values'
                    ? Math.abs(Math.max(rvMin, Math.min(rvMax, cell.value))) / rvMax
                    : displayView === 'Contact Rate' && contactVisibilityScale
                      ? Math.max(
                          0,
                          Math.min(
                            1,
                            ((100 - cell.value) - contactVisibilityScale.min) /
                              Math.max(1e-9, contactVisibilityScale.max - contactVisibilityScale.min)
                          )
                        )
                      : Math.max(0, Math.min(1, (cell.value - minVal) / Math.max(1e-9, maxVal - minVal)));
                const runValueBoost = displayView === 'Run Values' ? Math.pow(normalized, 0.55) : normalized;
                const isSwingRateView = displayView === 'Swing Rate';
                if (displayView !== 'Frequency' && displayView !== 'Run Values' && densityNorm < (isSwingRateView ? 0.06 : 0.16)) return null;
                if (displayView !== 'Run Values' && !isSwingRateView && normalized < 0.06) return null;
                if (displayView === 'Run Values' && Math.abs(Math.max(rvMin, Math.min(rvMax, cell.value))) < 0.15) return null;
                return (
                  <circle
                    key={`loc-heat-${cell.x}-${cell.y}`}
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill={fill}
                    opacity={
                      displayView === 'Run Values'
                        ? Math.max(0.06, runValueBoost * 1.15 * Math.max(0.45, densityNorm))
                        : Math.max(0.3, runValueBoost * 1.25 * (displayView === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))
                    }
                  />
                );
              })}
            </g>
            {cells.map((cell) => {
              if (!Number.isFinite(cell.value)) return null;
              const cx = xScale(cell.x + cell.w / 2);
              const cy = yScale(cell.y + cell.h / 2);
              const radius = Math.max(1.0, cell.w * ((w - pad * 2) / (xMax - xMin)) * 0.75);
              const densityNorm = Math.max(0, Math.min(1, cell.density / densityMax));
              let fill = 'rgba(255,255,255,0.12)';
              if (displayView === 'Frequency') fill = sequentialColor(cell.value, minVal, maxVal);
              else if (displayView === 'Run Values') fill = divergingColor(Math.max(rvMin, Math.min(rvMax, cell.value)), rvMin, 0, rvMax);
              else fill = divergingColor(cell.value, minVal, midVal, maxVal);
              const normalized =
                displayView === 'Run Values'
                  ? Math.abs(Math.max(rvMin, Math.min(rvMax, cell.value))) / rvMax
                  : displayView === 'Contact Rate' && contactVisibilityScale
                    ? Math.max(
                        0,
                        Math.min(
                          1,
                          ((100 - cell.value) - contactVisibilityScale.min) /
                            Math.max(1e-9, contactVisibilityScale.max - contactVisibilityScale.min)
                        )
                      )
                    : Math.max(0, Math.min(1, (cell.value - minVal) / Math.max(1e-9, maxVal - minVal)));
              const runValueBoost = displayView === 'Run Values' ? Math.pow(normalized, 0.55) : normalized;
              const isSwingRateView = displayView === 'Swing Rate';
              if (displayView !== 'Frequency' && displayView !== 'Run Values' && densityNorm < (isSwingRateView ? 0.06 : 0.16)) return null;
              if (displayView !== 'Run Values' && !isSwingRateView && normalized < 0.06) return null;
              if (displayView === 'Run Values' && Math.abs(Math.max(rvMin, Math.min(rvMax, cell.value))) < 0.15) return null;
              return (
                <circle
                  key={`loc-heat-core-${cell.x}-${cell.y}`}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill={fill}
                  opacity={
                    displayView === 'Run Values'
                      ? Math.max(0.04, runValueBoost * 0.7 * Math.max(0.45, densityNorm))
                      : Math.max(0.2, runValueBoost * 0.72 * (displayView === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))
                  }
                  onMouseMove={(event) =>
                    onPointHover({
                      x: event.clientX,
                      y: event.clientY,
                      text: `${displayView}: ${cell.value.toFixed(displayView === 'xWOBA' ? 3 : (displayView === 'Run Values' || displayView === 'Exit Velocity' ? 2 : 1))}`,
                    })
                  }
                  onMouseLeave={onPointLeave}
                />
              );
            })}
          </>
        ) : null}
        {displayView === 'Pitch' ? (
          <rect x={xScale(midX - greenHalf)} y={yScale(midY + greenHalf)} width={xScale(midX + greenHalf) - xScale(midX - greenHalf)} height={yScale(midY - greenHalf) - yScale(midY + greenHalf)} fill="rgba(80,220,120,0.16)" />
        ) : null}
        <rect x={xScale(zoneLeft)} y={yScale(zoneTop)} width={xScale(zoneRight) - xScale(zoneLeft)} height={yScale(zoneBottom) - yScale(zoneTop)} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.2" />
        <line x1={xScale(zoneLeft + (zoneRight - zoneLeft) / 3)} y1={yScale(zoneBottom)} x2={xScale(zoneLeft + (zoneRight - zoneLeft) / 3)} y2={yScale(zoneTop)} stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
        <line x1={xScale(zoneLeft + (zoneRight - zoneLeft) * 2 / 3)} y1={yScale(zoneBottom)} x2={xScale(zoneLeft + (zoneRight - zoneLeft) * 2 / 3)} y2={yScale(zoneTop)} stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
        <line x1={xScale(zoneLeft)} y1={yScale(zoneBottom - (zoneBottom - zoneTop) / 3)} x2={xScale(zoneRight)} y2={yScale(zoneBottom - (zoneBottom - zoneTop) / 3)} stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
        <line x1={xScale(zoneLeft)} y1={yScale(zoneBottom - (zoneBottom - zoneTop) * 2 / 3)} x2={xScale(zoneRight)} y2={yScale(zoneBottom - (zoneBottom - zoneTop) * 2 / 3)} stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
        <polygon
          points={`${xScale(zoneLeft)},${yScale(0.2)} ${xScale(zoneRight)},${yScale(0.2)} ${xScale(zoneRight)},${yScale(0.35)} ${xScale(midX)},${yScale(0.44)} ${xScale(zoneLeft)},${yScale(0.35)}`}
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="1.2"
        />
        <rect x={xScale(compLeft)} y={yScale(compTop)} width={xScale(compRight) - xScale(compLeft)} height={yScale(compBottom) - yScale(compTop)} fill="none" stroke="rgba(255,255,255,0.72)" />
        <line x1={xScale(compLeft)} y1={yScale(midY)} x2={xScale(zoneLeft)} y2={yScale(midY)} stroke="rgba(255,255,255,0.58)" strokeWidth="1" />
        <line x1={xScale(zoneRight)} y1={yScale(midY)} x2={xScale(compRight)} y2={yScale(midY)} stroke="rgba(255,255,255,0.58)" strokeWidth="1" />
        <line x1={xScale(midX)} y1={yScale(compBottom)} x2={xScale(midX)} y2={yScale(zoneBottom)} stroke="rgba(255,255,255,0.58)" strokeWidth="1" />
        <line x1={xScale(midX)} y1={yScale(zoneTop)} x2={xScale(midX)} y2={yScale(compTop)} stroke="rgba(255,255,255,0.58)" strokeWidth="1" />
        {displayView === 'Pitch'
          ? inZone.map((point, idx) => {
              const ps = parseNumber(point.plate_side);
              const ph = parseNumber(point.plate_height);
              if (ps === null || ph === null) return null;
              const x = xScale(ps);
              const y = yScale(ph);
              const color = PITCH_COLORS[point.pitch_type] ?? PITCH_COLORS.Undefined;
              const tip = [
                `Pitcher: ${formatNameFirstLast(String(point.pitcher || '')) || '-'}`,
                `Batter: ${formatNameFirstLast(String(point.batter || '')) || '-'}`,
                point.pitch_type,
                point.result_label,
                point.rel_speed ? `${point.rel_speed.toFixed(1)} mph` : 'Velo: —',
                point.exit_speed ? `EV ${point.exit_speed.toFixed(1)}` : 'EV: —',
                point.angle ? `LA ${point.angle.toFixed(1)}` : 'LA: —',
              ].join('\n');
              return (
                <g
                  key={`pt-${idx}`}
                  onMouseEnter={(event) =>
                    onPointHover({
                      x: event.clientX,
                      y: event.clientY,
                      text: tip,
                      bg: color,
                    })
                  }
                  onMouseMove={(event) =>
                    onPointHover({
                      x: event.clientX,
                      y: event.clientY,
                      text: tip,
                      bg: color,
                    })
                  }
                  onMouseLeave={onPointLeave}
                >
                  {markerForResult(point.result_label, x, y, color, `m-${idx}`)}
                </g>
              );
            })
          : null}
        </g>
      </svg>
    </div>
  );
}

function AbPaChart({
  pitches,
  resultLabel,
  pitchColors,
}: {
  pitches: ChartPoint[];
  resultLabel: string;
  pitchColors: Record<string, string>;
}) {
  const [hover, setHover] = useState<ChartHover>(null);
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

  const resultShape = (pitch: ChartPoint): string => {
    const call = pitch.pitch_call || '';
    const pr = pitch.play_result || '';
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

  const hoverText = (pitch: ChartPoint, idx: number): string => {
    const countPart =
      pitch.balls_num !== null && pitch.balls_num !== undefined && pitch.strikes_num !== null && pitch.strikes_num !== undefined
        ? `${pitch.balls_num}-${pitch.strikes_num}`
        : '-';
    const velo = pitch.velo ?? pitch.rel_speed;
    const ivb = pitch.ivb;
    const hb = pitch.hb;
    const resultPart = resolveAbPitchResult(pitch);
    return [
      `Pitch #${idx + 1}`,
      `Pitcher: ${formatNameFirstLast(String(pitch.pitcher || '')) || '-'}`,
      `Batter: ${formatNameFirstLast(String(pitch.batter || '')) || '-'}`,
      `${pitch.pitch_type || 'Pitch'}`,
      `Velo: ${velo !== null && velo !== undefined ? velo.toFixed(1) : '-'} mph`,
      `IVB: ${ivb !== null && ivb !== undefined ? ivb.toFixed(1) : '-'}`,
      `HB: ${hb !== null && hb !== undefined ? hb.toFixed(1) : '-'}`,
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
            const x = px(Number(pitch.plate_side));
            const y = py(Number(pitch.plate_height));
            const shape = resultShape(pitch);
            const color = pitchColors[pitch.pitch_type] ?? '#9ca3af';
            return (
              <g
                key={`${pitch.pitch_event_id ?? i}-${i}`}
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
            color: hoverTextColor(hover.bg),
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

function SprayChart({
  points,
  view,
  onViewChange,
  onPointHover,
  onPointLeave,
}: {
  points: ChartPoint[];
  view: 'Batted Balls' | 'Bins';
  onViewChange: (next: 'Batted Balls' | 'Bins') => void;
  onPointHover: (hover: Exclude<ChartHover, null>) => void;
  onPointLeave: () => void;
}) {
  const w = 430;
  const h = 340;
  const pad = 16;
  const yMax = 420;
  const xMax = 300;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;
  const scale = Math.min(plotW / (xMax * 2), plotH / yMax);
  const drawnW = xMax * 2 * scale;
  const leftPad = (w - drawnW) / 2;
  const bottomPad = h - pad;
  const xScale = (x: number) => leftPad + (x + xMax) * scale;
  const yScale = (y: number) => bottomPad - y * scale;

  const livePoints = points
    .filter((p) => (p.pitch_call || '') === 'InPlay')
    .map((p) => {
      const hcX = parseNumber((p as ChartPoint & { hc_x?: number | null }).hc_x ?? null);
      const hcY = parseNumber((p as ChartPoint & { hc_y?: number | null }).hc_y ?? null);
      const direction = parseNumber(p.direction);
      const distance = parseNumber(p.distance);
      let x: number | null = null;
      let y: number | null = null;

      // Preferred Statcast path: use hit coordinates for spray angle vector and
      // hit_distance_sc for radial distance.
      if (hcX !== null && hcY !== null) {
        const vx = hcX - 125.42;
        const vy = 198.27 - hcY;
        const mag = Math.hypot(vx, vy);
        if (mag > 0.001) {
          if (distance !== null) {
            x = (vx / mag) * distance;
            y = (vy / mag) * distance;
          } else {
            // Coordinate-only fallback if distance missing.
            x = vx * 2;
            y = vy * 2;
          }
        }
      }

      // Legacy direction/distance path.
      if ((x === null || y === null) && direction !== null && distance !== null) {
        const mapped = (direction * 110) / 90;
        const rad = (mapped * Math.PI) / 180;
        x = distance * Math.sin(rad);
        y = distance * Math.cos(rad);
      }
      if (x === null || y === null) return null;
      return { ...p, x, y };
    })
    .filter((p): p is ChartPoint & { x: number; y: number } => p !== null);
  const pointsWithPolar = livePoints.map((point) => {
    const angleDeg = (Math.atan2(point.x, point.y) * 180) / Math.PI;
    const distanceFt = Math.hypot(point.x, point.y);
    return { ...point, angleDeg, distanceFt };
  });
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
    const infieldLabelRadius = 148;
    const outfieldLabelRadius = 435;
    const radius = bin.group === 'Infield' ? infieldLabelRadius : outfieldLabelRadius;
    return { x: xScale(radius * Math.sin(angleMid)), y: yScale(radius * Math.cos(angleMid)) };
  };

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

  const arcEndpoint = (radius: number) => radius / Math.sqrt(2);

  const baseDiamondOnLine = (outerX: number, outerY: number, sidePx = 9): string => {
    // Build a square where the outer edge is flush with the foul line.
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
    const p0 = `${outerA.x},${outerA.y}`;
    const p1 = `${outerB.x},${outerB.y}`;
    const p2 = `${innerB.x},${innerB.y}`;
    const p3 = `${innerA.x},${innerA.y}`;
    return `${p0} ${p1} ${p2} ${p3}`;
  };

  const centeredDiamond = (cx: number, cy: number, sizePx = 6): string => {
    const x = xScale(cx);
    const y = yScale(cy);
    return `${x},${y - sizePx} ${x + sizePx},${y} ${x},${y + sizePx} ${x - sizePx},${y}`;
  };

  return (
    <div className="dashboard-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h4 style={{ margin: 0, textAlign: 'center' }}>Spray Chart</h4>
      <div style={{ width: '100%', maxWidth: 240, margin: '0 auto' }}>
        <SearchableSingleSelect
          options={[
            { value: 'Batted Balls', label: 'Batted Balls' },
            { value: 'Bins', label: 'Bins' },
          ]}
          value={view}
          onChange={(next) => onViewChange(next as 'Batted Balls' | 'Bins')}
          placeholder="Batted Balls"
        />
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 340, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }}>
        {view === 'Bins'
          ? binStats.map((bin) => (
              <path
                key={`spray-bin-${bin.key}`}
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
        {view === 'Batted Balls'
          ? livePoints.map((p, idx) => {
              const normalizedPlayResult = resultLabelForSwing(p.play_result || 'Out');
              const color = outcomeColor(normalizedPlayResult);
              const tip = [
                `Pitcher: ${formatNameFirstLast(String(p.pitcher || '')) || '-'}`,
                `Batter: ${formatNameFirstLast(String(p.batter || '')) || '-'}`,
                p.pitch_type,
                normalizedPlayResult,
                p.exit_speed ? `EV ${p.exit_speed.toFixed(1)}` : 'EV: —',
                p.angle ? `LA ${p.angle.toFixed(1)}` : 'LA: —',
                p.distance ? `${p.distance.toFixed(0)} ft` : 'Distance: —',
              ].join('\n');
              return (
                <g key={`spray-${idx}`}>
                  <circle
                    cx={xScale(p.x)}
                    cy={yScale(p.y)}
                    r={3.6}
                    fill={color}
                    opacity={0.95}
                    onMouseEnter={(event) =>
                      onPointHover({
                        x: event.clientX,
                        y: event.clientY,
                        text: tip,
                        bg: color,
                      })
                    }
                    onMouseMove={(event) =>
                      onPointHover({
                        x: event.clientX,
                        y: event.clientY,
                        text: tip,
                        bg: color,
                      })
                    }
                    onMouseLeave={onPointLeave}
                  />
                </g>
              );
            })
          : null}
        {view === 'Bins'
          ? binStats.map((bin) => {
              const pt = labelPoint(bin);
              return (
                <text
                  key={`spray-bin-label-${bin.key}`}
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
}

function buildHeatCells(points: ChartPoint[], metric: string, strictRunValue = false): HeatCell[] {
  const xMin = -2.5;
  const xMax = 2.5;
  const yMin = 0;
  const yMax = 4.5;
  const cols = 40;
  const rows = 40;
  const cellW = (xMax - xMin) / cols;
  const cellH = (yMax - yMin) / rows;
  const sigmaX = 0.22;
  const sigmaY = 0.22;
  const eps = 1e-9;
  const valid = points
    .map((p) => ({ p, x: p.plate_side, y: p.plate_height }))
    .filter((row): row is { p: ChartPoint; x: number; y: number } => row.x !== null && row.y !== null);
  if (!valid.length) return [];

  const isSwing = (call: string) =>
    call === 'StrikeSwinging' || call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable' || call === 'InPlay';
  const isWhiff = (call: string) => call === 'StrikeSwinging';
  const isContact = (call: string) => call === 'InPlay';
  const isGroundBall = (point: ChartPoint) => {
    const tagged = String((point as ChartPoint & { tagged_hit_type?: string | null }).tagged_hit_type ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return tagged.includes('ground_ball') || tagged === 'groundball';
  };
  const xwobaRows = valid.filter(
    (row) =>
      typeof row.p.estimated_woba_using_speedangle === 'number' &&
      Number.isFinite(row.p.estimated_woba_using_speedangle)
  );
  const xbaRows = valid.filter(
    (row) =>
      typeof row.p.estimated_ba_using_speedangle === 'number' &&
      Number.isFinite(row.p.estimated_ba_using_speedangle)
  );
  const runValue = (point: ChartPoint): number | null => {
    if (typeof point.run_value === 'number' && Number.isFinite(point.run_value)) return point.run_value;
    if (strictRunValue) return null;
    const call = point.pitch_call || '';
    const play = point.play_result || '';
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

  const globalSwingCount = valid.filter((row) => isSwing(row.p.pitch_call || '')).length;
  const globalWhiffCount = valid.filter((row) => isWhiff(row.p.pitch_call || '')).length;
  const globalInPlayCount = valid.filter((row) => isContact(row.p.pitch_call || '')).length;
  const globalGbCount = valid.filter((row) => isContact(row.p.pitch_call || '') && isGroundBall(row.p)).length;
  const globalEvRows = valid.filter((row) => isContact(row.p.pitch_call || '') && typeof row.p.exit_speed === 'number');
  const rvRows = valid
    .map((row) => runValue(row.p))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const globalRvAvg = rvRows.length ? rvRows.reduce((sum, value) => sum + value, 0) / rvRows.length : 0;
  const globalEvAvg = globalEvRows.length ? globalEvRows.reduce((sum, row) => sum + Number(row.p.exit_speed || 0), 0) / globalEvRows.length : 0;
  const globalXwobaAvg =
    xwobaRows.length > 0
      ? xwobaRows.reduce((sum, row) => sum + Number(row.p.estimated_woba_using_speedangle || 0), 0) / xwobaRows.length
      : 0.35;
  const globalXbaAvg =
    xbaRows.length > 0
      ? xbaRows.reduce((sum, row) => sum + Number(row.p.estimated_ba_using_speedangle || 0), 0) / xbaRows.length
      : 0.3;
  const globalSwingRate = valid.length ? globalSwingCount / valid.length : 0;
  const globalWhiffRate = globalSwingCount ? globalWhiffCount / globalSwingCount : 0;
  const globalGbRate = globalInPlayCount ? globalGbCount / globalInPlayCount : 0;
  const globalContactRate = globalSwingCount ? (globalSwingCount - globalWhiffCount) / globalSwingCount : 0;
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
      let rvWSum = 0;
      let rvW = 0;
      let xwobaWSum = 0;
      let xwobaW = 0;
      let xbaWSum = 0;
      let xbaW = 0;
      for (const rowPoint of valid) {
        const dx = (cx - rowPoint.x) / sigmaX;
        const dy = (cy - rowPoint.y) / sigmaY;
        const w = Math.exp(-0.5 * (dx * dx + dy * dy));
        if (w < 1e-6) continue;
        const call = rowPoint.p.pitch_call || '';
        const swing = isSwing(call);
        const inPlay = isContact(call);
        const gb = isGroundBall(rowPoint.p);
        sumW += w;
        if (swing) swingW += w;
        if (isWhiff(call)) whiffW += w;
        if (inPlay) inPlayW += w;
        if (gb) gbW += w;
        if (inPlay && typeof rowPoint.p.exit_speed === 'number') {
          evWSum += w * rowPoint.p.exit_speed;
          evW += w;
        }
        const rv = runValue(rowPoint.p);
        if (typeof rv === 'number' && Number.isFinite(rv)) {
          rvWSum += w * rv;
          rvW += w;
        }
        if (typeof rowPoint.p.estimated_woba_using_speedangle === 'number' && Number.isFinite(rowPoint.p.estimated_woba_using_speedangle)) {
          xwobaWSum += w * rowPoint.p.estimated_woba_using_speedangle;
          xwobaW += w;
        }
        if (typeof rowPoint.p.estimated_ba_using_speedangle === 'number' && Number.isFinite(rowPoint.p.estimated_ba_using_speedangle)) {
          xbaWSum += w * rowPoint.p.estimated_ba_using_speedangle;
          xbaW += w;
        }
      }

      let value = sumW;
      if (metric === 'Whiff Rate') value = 100 * ((whiffW + shrinkStrength * globalWhiffRate) / Math.max(eps, swingW + shrinkStrength));
      if (metric === 'GB Rate') value = 100 * ((gbW + shrinkStrength * globalGbRate) / Math.max(eps, inPlayW + shrinkStrength));
      if (metric === 'Contact Rate') value = 100 * (((swingW - whiffW) + shrinkStrength * globalContactRate) / Math.max(eps, swingW + shrinkStrength));
      if (metric === 'Swing Rate') value = 100 * ((swingW + shrinkStrength * globalSwingRate) / Math.max(eps, sumW + shrinkStrength));
      if (metric === 'Exit Velocity') value = (evWSum + shrinkStrength * globalEvAvg) / Math.max(eps, evW + shrinkStrength);
      if (metric === 'Run Values') {
        value =
          rvW > eps
            ? ((rvWSum + runValueShrinkStrength * globalRvAvg) / Math.max(eps, rvW + runValueShrinkStrength)) * 100
            : Number.NaN;
      }
      if (metric === 'xWOBA') {
        value =
          xwobaW > eps
            ? (xwobaWSum + xMetricShrinkStrength * globalXwobaAvg) / Math.max(eps, xwobaW + xMetricShrinkStrength)
            : Number.NaN;
      }
      if (metric === 'xBA') {
        value =
          xbaW > eps
            ? (xbaWSum + xMetricShrinkStrength * globalXbaAvg) / Math.max(eps, xbaW + xMetricShrinkStrength)
            : Number.NaN;
      }

      cells.push({ x: xMin + col * cellW, y: yMin + row * cellH, w: cellW, h: cellH, value, density: sumW });
    }
  }
  if (metric === 'Frequency') {
    const maxVal = Math.max(...cells.map((c) => c.value), eps);
    for (const c of cells) c.value = (100 * c.value) / maxVal;
  }
  return cells;
}

export default function HittingSuite() {
  const [dashboardPage, setDashboardPage] = useState<'Summary' | 'Leaderboard' | 'AB Report' | 'HeatMaps' | 'Swing Data'>('Summary');
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [filters, setFilters] = useState<HittingFiltersPayload | null>(null);
  const [overview, setOverview] = useState<HittingOverviewPayload | null>(null);
  const [abReport, setAbReport] = useState<AbReportPayload | null>(null);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingAbReport, setLoadingAbReport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abError, setAbError] = useState<string | null>(null);
  const [abGameKey, setAbGameKey] = useState('');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [hitter, setHitter] = useState('All');
  const [teamType, setTeamType] = useState('All');
  const [level, setLevel] = useState('MLB');
  const [oppPitcher, setOppPitcher] = useState('All');
  const [hand, setHand] = useState('All');
  const [batterSide, setBatterSide] = useState('All');
  const [tableMode, setTableMode] = useState(TABLE_MODE_DEFAULT);
  const [splitBy, setSplitBy] = useState(SPLIT_BY_DEFAULT);
  const [customTables, setCustomTables] = useState<CustomTableConfig[]>([]);
  const [loadingCustomTables, setLoadingCustomTables] = useState(false);
  const [customTableName, setCustomTableName] = useState('');
  const [selectedCustomTableId, setSelectedCustomTableId] = useState<number | null>(null);
  const [customTableColumns, setCustomTableColumns] = useState<string[]>([]);
  const [customColumnToAdd, setCustomColumnToAdd] = useState('');
  const [customSaveState, setCustomSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [customSaveMessage, setCustomSaveMessage] = useState('');
  const [dragColumnIndex, setDragColumnIndex] = useState<number | null>(null);
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [appliedFilterVersion, setAppliedFilterVersion] = useState(0);
  const [chartHover, setChartHover] = useState<ChartHover>(null);
  const [swingTab, setSwingTab] = useState<'2D Contact' | '3D Contact' | 'Attack Angles' | 'Bat Speed' | 'EV and LA'>('2D Contact');
  const [contact2dMode, setContact2dMode] = useState<'individual' | 'average_pitch_type'>('individual');
  const [contact2dColorBy, setContact2dColorBy] = useState<'pitch_type' | 'exit_velocity' | 'result'>('pitch_type');
  const [contact3dMode, setContact3dMode] = useState<'individual' | 'average_pitch_type'>('individual');
  const [contact3dColorBy, setContact3dColorBy] = useState<'pitch_type' | 'exit_velocity' | 'result'>('pitch_type');
  const [attackAngleType, setAttackAngleType] = useState<'Horizontal Attack' | 'Vertical Attack'>('Horizontal Attack');
  const [attackScope, setAttackScope] = useState<'average' | 'pitch'>('average');
  const [attackPitchId, setAttackPitchId] = useState('');
  const [batSpeedDisplay, setBatSpeedDisplay] = useState<'average' | 'individual'>('average');
  const [batSpeedColorBy, setBatSpeedColorBy] = useState<'pitch_type' | 'exit_velocity' | 'result'>('pitch_type');
  const [evlaColorBy, setEvlaColorBy] = useState<'result' | 'pitch_type'>('result');
  const swing3dRef = useRef<HTMLDivElement | null>(null);
  const [heatmapChartType, setHeatmapChartType] = useState<'Heat' | 'Pitch'>('Pitch');
  const [heatmapStat, setHeatmapStat] = useState('Frequency');
  const [summaryRhpLocationView, setSummaryRhpLocationView] = useState('Pitch');
  const [summaryLhpLocationView, setSummaryLhpLocationView] = useState('Pitch');
  const [summarySprayView, setSummarySprayView] = useState<'Batted Balls' | 'Bins'>('Batted Balls');
  const [leaderboardSortColumn, setLeaderboardSortColumn] = useState('');
  const [leaderboardSortDirection, setLeaderboardSortDirection] = useState<SortDirection>('desc');
  const [leaderboardViewBy, setLeaderboardViewBy] = useState<'Player' | 'Team'>('Player');
  const autoFallbackAppliedRef = useRef(false);
  const [abSortColumn, setAbSortColumn] = useState('Pitch #');
  const [abSortDirection, setAbSortDirection] = useState<SortDirection>('asc');

  const [pitchTypes, setPitchTypes] = useState<string[]>([]);
  const [zoneLocations, setZoneLocations] = useState<string[]>([]);
  const [pitchResults, setPitchResults] = useState<string[]>([]);
  const [countFilter, setCountFilter] = useState<string[]>([]);
  const [afterCountFilter, setAfterCountFilter] = useState<string[]>([]);
  const [bipResult, setBipResult] = useState<string[]>([]);
  const [inZone, setInZone] = useState<string[]>([]);
  const [veloMin, setVeloMin] = useState('');
  const [veloMax, setVeloMax] = useState('');
  const [ivbMin, setIvbMin] = useState('');
  const [ivbMax, setIvbMax] = useState('');
  const [hbMin, setHbMin] = useState('');
  const [hbMax, setHbMax] = useState('');
  const [pcMin, setPcMin] = useState('');
  const [pcMax, setPcMax] = useState('');

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

  const isLeaderboardPage = dashboardPage === 'Leaderboard';
  const effectiveSplitBy = isLeaderboardPage ? (leaderboardViewBy === 'Team' ? 'Batter Team' : 'Batter') : splitBy;
  const isLeague = String(filters?.school_code ?? '').toUpperCase() === 'LEAGUE';
  const isPro = String(filters?.school_code ?? '').toUpperCase() === 'PRO';
  useEffect(() => {
    if (!isLeague && leaderboardViewBy !== 'Player') {
      setLeaderboardViewBy('Player');
    }
  }, [isLeague, leaderboardViewBy]);
  const teamTypeOptions = useMemo(() => {
    const school = String(filters?.school_code ?? '').trim();
    const base = ['All', school || 'OSU', 'Opponents', 'Campers'];
    const combined = [...base, ...((filters?.team_types ?? []).map((value) => String(value ?? '').trim()))];
    const unique = Array.from(new Set(combined.filter(Boolean)));
    return toOptions(unique);
  }, [filters?.school_code, filters?.team_types]);
  const hitterOptions = useMemo(() => {
    if (!filters) return [{ value: 'All', label: 'All' }];
    const values = !isLeague || teamType === 'All' ? (filters.hitters ?? []) : (filters.hitters_by_team_code?.[teamType] ?? []);
    return [{ value: 'All', label: 'All' }, ...toOptions(values, true)];
  }, [filters, isLeague, teamType]);
  const oppPitcherOptions = useMemo(() => {
    if (!filters) return [{ value: 'All', label: 'All' }];
    const values = !isLeague || teamType === 'All' ? (filters.opp_pitchers ?? []) : (filters.opp_pitchers_by_team_code?.[teamType] ?? []);
    return [{ value: 'All', label: 'All' }, ...toOptions(values, true)];
  }, [filters, isLeague, teamType]);

  useEffect(() => {
    const allowed = new Set(hitterOptions.map((option) => option.value));
    if (!allowed.has(hitter)) setHitter('All');
  }, [hitter, hitterOptions]);

  useEffect(() => {
    const allowed = new Set(oppPitcherOptions.map((option) => option.value));
    if (!allowed.has(oppPitcher)) setOppPitcher('All');
  }, [oppPitcher, oppPitcherOptions]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoadingFilters(true);
    const filterParams = new URLSearchParams();
    if (level) filterParams.set('level', level);
    fetch(`/api/dashboard/hitting/filters?${filterParams.toString()}`, { signal: controller.signal, cache: 'no-store' })
      .then((r) => r.json())
      .then((payload: HittingFiltersPayload & { error?: string }) => {
        if (cancelled) return;
        if ((payload as { error?: string }).error) {
          setError((payload as { error?: string }).error ?? 'Dashboard API request failed.');
          return;
        }
        autoFallbackAppliedRef.current = false;
        setFilters(payload);
        setTeamType(pickDefaultTeamType(payload.team_types, payload.school_code));
        setStartDate(payload.max_date ?? '');
        setEndDate(payload.max_date ?? '');
        setPitchTypes([]);
        setZoneLocations([]);
        setPitchResults([]);
        setCountFilter([]);
        setAfterCountFilter([]);
        setBipResult([]);
        setInZone([]);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load filters.');
      })
      .finally(() => {
        if (!cancelled) setLoadingFilters(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [level]);

  useEffect(() => {
    if (!isPro) return;
    if (!level) setLevel('MLB');
  }, [isPro, level]);

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
      setCustomTables(Array.isArray(payload.items) ? payload.items : []);
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
      const payload = (await response.json().catch(() => ({}))) as { error?: string; item?: CustomTableConfig };
      if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Failed to save custom table.');
      const saved = payload.item;
      setCustomSaveState('saved');
      setCustomSaveMessage('Custom table saved.');
      setSelectedCustomTableId(saved.id);
      setCustomTableName(saved.name);
      setCustomTableColumns(saved.columns ?? []);
      setCustomTables((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
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
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Failed to delete custom table.');
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

  useEffect(() => {
    if (!filters) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoadingOverview(true);
    setError(null);
    const params = new URLSearchParams();
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    if (hitter && hitter !== 'All') params.set('hitter', hitter);
    if (teamType && teamType !== 'All') params.set('team_type', teamType);
    if (isPro && level && level !== 'All') params.set('level', level);
    if (oppPitcher && oppPitcher !== 'All') params.set('opp_pitcher', oppPitcher);
    if (hand && hand !== 'All') params.set('hand', hand);
    if (batterSide && batterSide !== 'All') params.set('batter_side', batterSide);
    params.set('table_mode', tableMode);
    params.set('split_by', effectiveSplitBy);
    if (tableMode === 'Custom' && customTableColumns.length) {
      params.set('custom_columns', customTableColumns.join(','));
    }
    if (pitchTypes.length) params.set('pitch_types', pitchTypes.join(';'));
    if (zoneLocations.length) params.set('zone_locations', zoneLocations.join(';'));
    if (pitchResults.length) params.set('pitch_results', pitchResults.join(';'));
    if (countFilter.length) params.set('count_filter', countFilter.join(';'));
    if (afterCountFilter.length) params.set('after_count_filter', afterCountFilter.join(';'));
    if (bipResult.length) params.set('bip_result', bipResult.join(';'));
    if (inZone.length) params.set('in_zone', inZone.join(';'));
    if (veloMin.trim()) params.set('velo_min', veloMin.trim());
    if (veloMax.trim()) params.set('velo_max', veloMax.trim());
    if (ivbMin.trim()) params.set('ivb_min', ivbMin.trim());
    if (ivbMax.trim()) params.set('ivb_max', ivbMax.trim());
    if (hbMin.trim()) params.set('hb_min', hbMin.trim());
    if (hbMax.trim()) params.set('hb_max', hbMax.trim());
    if (pcMin.trim()) params.set('pc_min', pcMin.trim());
    if (pcMax.trim()) params.set('pc_max', pcMax.trim());
    params.set('include_chart_points', '1');

    fetch(`/api/dashboard/hitting/overview?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((payload: HittingOverviewPayload & { error?: string }) => {
        if (cancelled) return;
        if ((payload as { error?: string }).error) {
          setError((payload as { error?: string }).error ?? 'Dashboard API request failed.');
          return;
        }
        const noRows = !Array.isArray(payload.table_rows) || payload.table_rows.length === 0;
        if (noRows && !autoFallbackAppliedRef.current) {
          autoFallbackAppliedRef.current = true;
        }
        setOverview(payload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load hitting summary.');
      })
      .finally(() => {
        if (!cancelled) setLoadingOverview(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [appliedFilterVersion, filters, startDate, endDate, hitter, teamType, level, oppPitcher, hand, batterSide, tableMode, effectiveSplitBy, customTableColumns, pitchTypes, zoneLocations, pitchResults, countFilter, afterCountFilter, bipResult, inZone, veloMin, veloMax, ivbMin, ivbMax, hbMin, hbMax, pcMin, pcMax, dashboardPage, isPro]);

  const selectedSingleHitter = hitter && hitter !== 'All' ? hitter : '';

  useEffect(() => {
    if (dashboardPage !== 'AB Report') return;
    if (!selectedSingleHitter) {
      setAbReport(null);
      setAbError(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoadingAbReport(true);
    setAbError(null);
    const params = new URLSearchParams();
    params.set('hitter', selectedSingleHitter);
    if (abGameKey) params.set('game_key', abGameKey);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    if (teamType && teamType !== 'All') params.set('team_type', teamType);
    if (oppPitcher && oppPitcher !== 'All') params.set('opp_pitcher', oppPitcher);
    if (hand && hand !== 'All') params.set('hand', hand);
    if (batterSide && batterSide !== 'All') params.set('batter_side', batterSide);
    const selectedPitchTypes = (pitchTypes || []).filter((entry) => entry && entry !== 'All');
    if (selectedPitchTypes.length) params.set('pitch_types', selectedPitchTypes.join(';'));

    fetch(`/api/dashboard/hitting/ab-report?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then((r) => r.json())
      .then((payload: AbReportPayload & { error?: string }) => {
        if (cancelled) return;
        if ((payload as { error?: string }).error) {
          setAbError((payload as { error?: string }).error ?? 'AB Report request failed.');
          setAbReport(null);
          return;
        }
        setAbReport(payload);
        if (!abGameKey && payload.selected_game_key) setAbGameKey(payload.selected_game_key);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setAbError(err instanceof Error ? err.message : 'Failed to load hitting AB report.');
      })
      .finally(() => {
        if (!cancelled) setLoadingAbReport(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dashboardPage, selectedSingleHitter, abGameKey, startDate, endDate, teamType, oppPitcher, hand, batterSide, pitchTypes]);

  const points = overview?.chart_points ?? [];
  const rhpPoints = useMemo(() => points.filter((p) => normalizedThrowHand(p.pitcherthrows) === 'R'), [points]);
  const lhpPoints = useMemo(() => points.filter((p) => normalizedThrowHand(p.pitcherthrows) === 'L'), [points]);
  const tableModeOptions = useMemo(
    () => [
      { value: 'Results', label: 'Results' },
      { value: 'Swing Decisions', label: 'Swing Decisions' },
      { value: 'Batted Ball Data', label: 'Batted Ball Data' },
      ...customTables.map((item) => ({ value: `custom_saved:${item.id}`, label: item.name })),
      { value: 'Custom', label: 'Custom' },
    ],
    [customTables]
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
    return overview?.table_columns?.length ? overview.table_columns : [splitColumn];
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
  const leaderboardRows = useMemo(() => {
    const rows = overview?.table_rows ?? [];
    const firstCol = leaderboardBaseColumns[0] ?? '';
    const sortCol = leaderboardSortColumn && leaderboardBaseColumns.includes(leaderboardSortColumn)
      ? leaderboardSortColumn
      : (isLeaderboardPage ? (leaderboardBaseColumns[1] ?? firstCol) : '');
    if (!sortCol) return rows;
    const splitColumn = leaderboardBaseColumns[0] ?? '';
    return sortTableRows(rows, sortCol, leaderboardSortDirection, splitColumn);
  }, [overview?.table_rows, isLeaderboardPage, leaderboardBaseColumns, leaderboardSortColumn, leaderboardSortDirection]);
  const latestTeamByHitter = useMemo(() => {
    const points = overview?.chart_points ?? [];
    const latestTsByName: Record<string, number> = {};
    const out: Record<string, string> = {};
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    points.forEach((point) => {
      const name = String(point.batter ?? '').trim();
      const team = String(point.batter_team_code ?? '').trim().toUpperCase();
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
  const filterTeamByHitter = useMemo(() => {
    const out: Record<string, string> = {};
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const byTeam = filters?.hitters_by_team_code ?? {};
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
  }, [filters?.hitters_by_team_code]);
  const summaryTeamLogoUrl = useMemo(() => {
    if (!isPro || dashboardPage !== 'Summary') return '';
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    let teamCode = '';
    if (selectedSingleHitter) {
      const key = String(selectedSingleHitter ?? '').trim();
      const formatted = formatNameFirstLast(key);
      teamCode =
        latestTeamByHitter[key] ??
        latestTeamByHitter[formatted] ??
        latestTeamByHitter[norm(key)] ??
        latestTeamByHitter[norm(formatted)] ??
        filterTeamByHitter[key] ??
        filterTeamByHitter[formatted] ??
        filterTeamByHitter[norm(key)] ??
        filterTeamByHitter[norm(formatted)] ??
        '';
    }
    if (!teamCode && teamType && teamType !== 'All') {
      teamCode = inferProTeamCode(teamType);
    }
    return getProTeamLogoUrl(teamCode) || '';
  }, [isPro, dashboardPage, selectedSingleHitter, latestTeamByHitter, filterTeamByHitter, teamType]);
  const availableCustomColumns = useMemo(
    () =>
      overview?.available_table_columns?.length
        ? overview.available_table_columns
        : FALLBACK_AVAILABLE_CUSTOM_COLUMNS,
    [overview?.available_table_columns]
  );
  const remainingCustomColumns = useMemo(
    () => availableCustomColumns.filter((column) => !customTableColumns.includes(column)),
    [availableCustomColumns, customTableColumns]
  );

  const pitchLegend = useMemo(() => {
    const source = overview?.pitch_type_legend?.length ? overview.pitch_type_legend : Object.keys(PITCH_COLORS);
    return source.filter((t) => t && t !== '');
  }, [overview?.pitch_type_legend]);
  const abCards = useMemo(() => {
    if (!abReport) return [] as Array<{ pitcher: string; pa: AbReportPayload['pa_groups'][number]['pas'][number] }>;
    return abReport.pa_groups.flatMap((group) =>
      group.pas.map((pa) => ({ pitcher: group.pitcher, pa }))
    );
  }, [abReport]);
  const heatmapStatOptions = useMemo(
    () => [
      { value: 'Frequency', label: 'Frequency' },
      { value: 'Whiff Rate', label: 'Whiff Rate' },
      { value: 'GB Rate', label: 'GB Rate' },
      { value: 'Contact Rate', label: 'Contact Rate' },
      { value: 'Swing Rate', label: 'Swing Rate' },
      { value: 'Exit Velocity', label: 'Exit Velocity' },
      ...(isPro ? ([{ value: 'xWOBA', label: 'xWOBA' }] as OptionItem[]) : []),
      { value: 'Run Values', label: 'Run Values' },
    ],
    [isPro]
  );
  const summaryLocationViewOptions = useMemo(
    () => [{ value: 'Pitch', label: 'Pitch' }, ...heatmapStatOptions],
    [heatmapStatOptions]
  );
  const heatmapDisplayView = useMemo(() => {
    if (heatmapChartType === 'Pitch') return 'Pitch';
    return heatmapStat;
  }, [heatmapChartType, heatmapStat]);
  useEffect(() => {
    if (heatmapStat === 'xBA') setHeatmapStat('xWOBA');
    if (summaryRhpLocationView === 'xBA') setSummaryRhpLocationView('xWOBA');
    if (summaryLhpLocationView === 'xBA') setSummaryLhpLocationView('xWOBA');
  }, [heatmapStat, summaryRhpLocationView, summaryLhpLocationView]);
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

    const cells =
      heatmapDisplayView === 'Pitch'
        ? []
        : buildHeatCells(points, heatmapDisplayView, isPro);
    const values = cells.map((c) => c.value).sort((a, b) => a - b);
    const densityMax = Math.max(1e-9, ...cells.map((c) => c.density));
    const minVal = values.length ? values[0] : 0;
    const maxVal = values.length ? values[values.length - 1] : 1;
    const midVal = values.length ? values[Math.floor(values.length / 2)] : 0;
    const maxAbs = Math.max(1, ...cells.map((c) => Math.abs(c.value)));
    return (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 460, border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10 }} onMouseLeave={() => setChartHover(null)}>
        <defs>
          <clipPath id="hitting-heatmap-zoom-clip">
            <rect x={0} y={0} width={w} height={h} />
          </clipPath>
          <filter id="hitting-heatmap-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
          <filter id="hitting-heatmap-blur-rv" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.75" />
          </filter>
        </defs>
        <g transform={zoomTransform} clipPath="url(#hitting-heatmap-zoom-clip)">
          {heatmapDisplayView !== 'Pitch' ? (
            <>
              <g filter={heatmapDisplayView === 'Run Values' ? 'url(#hitting-heatmap-blur-rv)' : 'url(#hitting-heatmap-blur)'}>
                {cells.map((c) => {
                  const cx = px(c.x + c.w / 2);
                  const cy = py(c.y + c.h / 2);
                  const radius = Math.max(2.0, c.w * scale * 1.45);
                  const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                  let fill = 'rgba(255,255,255,0.12)';
                  if (heatmapDisplayView === 'Frequency') fill = sequentialColor(c.value, minVal, maxVal);
                  else if (heatmapDisplayView === 'Run Values') {
                    const ratio = c.value / maxAbs;
                    if (ratio >= 0) fill = `rgba(255,48,48,${0.24 + Math.abs(ratio) * 0.76})`;
                    else fill = `rgba(54,129,255,${0.24 + Math.abs(ratio) * 0.76})`;
                  } else {
                    fill = divergingColor(c.value, minVal, midVal, maxVal);
                  }
                  const normalized =
                    heatmapDisplayView === 'Run Values'
                      ? Math.abs(c.value) / maxAbs
                      : Math.max(0, (c.value - minVal) / Math.max(1e-9, maxVal - minVal));
                  const rvBoost = heatmapDisplayView === 'Run Values' ? Math.pow(normalized, 0.55) : normalized;
                  if (heatmapDisplayView !== 'Frequency' && densityNorm < 0.16) return null;
                  if (heatmapDisplayView !== 'Run Values' && normalized < 0.06) return null;
                  return <circle key={`h-heat-blur-${c.x}-${c.y}`} cx={cx} cy={cy} r={radius} fill={fill} opacity={Math.max(0.3, rvBoost * 1.25 * (heatmapDisplayView === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))} />;
                })}
              </g>
              {cells.map((c) => {
                const cx = px(c.x + c.w / 2);
                const cy = py(c.y + c.h / 2);
                const radius = Math.max(1.0, c.w * scale * 0.75);
                const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                let fill = 'rgba(255,255,255,0.12)';
                if (heatmapDisplayView === 'Frequency') fill = sequentialColor(c.value, minVal, maxVal);
                else if (heatmapDisplayView === 'Run Values') {
                  const ratio = c.value / maxAbs;
                  if (ratio >= 0) fill = `rgba(255,48,48,${0.2 + Math.abs(ratio) * 0.8})`;
                  else fill = `rgba(54,129,255,${0.2 + Math.abs(ratio) * 0.8})`;
                } else {
                  fill = divergingColor(c.value, minVal, midVal, maxVal);
                }
                const normalized =
                  heatmapDisplayView === 'Run Values'
                    ? Math.abs(c.value) / maxAbs
                    : Math.max(0, (c.value - minVal) / Math.max(1e-9, maxVal - minVal));
                const rvBoost = heatmapDisplayView === 'Run Values' ? Math.pow(normalized, 0.55) : normalized;
                if (heatmapDisplayView !== 'Frequency' && densityNorm < 0.16) return null;
                if (heatmapDisplayView !== 'Run Values' && normalized < 0.06) return null;
                return (
                  <circle
                    key={`h-heat-core-${c.x}-${c.y}`}
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill={fill}
                    opacity={Math.max(0.2, rvBoost * 0.72 * (heatmapDisplayView === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))}
                    onMouseMove={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: `${heatmapDisplayView}: ${c.value.toFixed(heatmapDisplayView === 'xWOBA' ? 3 : (heatmapDisplayView === 'Run Values' || heatmapDisplayView === 'Exit Velocity' ? 2 : 1))}` })}
                    onMouseLeave={() => setChartHover(null)}
                  />
                );
              })}
            </>
          ) : null}
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
          {heatmapDisplayView === 'Pitch'
            ? points
                .filter((p) => p.plate_side !== null && p.plate_height !== null)
                .map((p, i) => {
                  const x = px(Number(p.plate_side));
                  const y = py(Number(p.plate_height));
                  const color = PITCH_COLORS[p.pitch_type] ?? PITCH_COLORS.Undefined;
                  const tip = [
                    p.pitch_type,
                    p.result_label,
                    p.rel_speed ? `${p.rel_speed.toFixed(1)} mph` : 'Velo: —',
                    p.exit_speed ? `EV ${p.exit_speed.toFixed(1)}` : 'EV: —',
                    p.angle ? `LA ${p.angle.toFixed(1)}` : 'LA: —',
                  ].join('\n');
                  return (
                    <g
                      key={`h-p-${i}`}
                      onMouseEnter={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: tip, bg: color })}
                      onMouseMove={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: tip, bg: color })}
                      onMouseLeave={() => setChartHover(null)}
                    >
                      {markerForResult(p.result_label, x, y, color, `h-m-${i}`)}
                    </g>
                  );
                })
            : null}
        </g>
      </svg>
    );
  }, [heatmapDisplayView, heatmapStat, points]);
  const swingContactPoints = useMemo(
    () =>
      points.filter(
        (p) =>
          parseNumber(p.contact_position_x) !== null &&
          parseNumber(p.contact_position_z) !== null
      ),
    [points]
  );
  const swingContact3dPoints = useMemo(
    () =>
      points.filter(
        (p) =>
          parseNumber(p.contact_position_x) !== null &&
          parseNumber(p.contact_position_y) !== null &&
          parseNumber(p.contact_position_z) !== null
      ),
    [points]
  );
  const swingAttackPoints = useMemo(
    () =>
      points.filter((p) =>
        attackAngleType === 'Horizontal Attack'
          ? parseNumber(p.horizontal_attack_angle) !== null
          : parseNumber(p.vertical_attack_angle) !== null
      ),
    [points, attackAngleType]
  );
  const swingEvlaPoints = useMemo(
    () =>
      points.filter(
        (p) =>
          (p.pitch_call || '') === 'InPlay' &&
          Number.isFinite(parseNumber(p.exit_speed)) &&
          Number.isFinite(parseNumber(p.angle)) &&
          Number(p.angle) >= -90 &&
          Number(p.angle) <= 90
      ),
    [points]
  );
  useEffect(() => {
    if (attackScope !== 'pitch') return;
    if (!swingAttackPoints.length) {
      setAttackPitchId('');
      return;
    }
    if (!attackPitchId || !swingAttackPoints.some((p) => String(p.pitch_event_id ?? p.pitch_number ?? '') === attackPitchId)) {
      setAttackPitchId(String(swingAttackPoints[0]?.pitch_event_id ?? swingAttackPoints[0]?.pitch_number ?? ''));
    }
  }, [attackScope, swingAttackPoints, attackPitchId]);
  const swingColorFor = useCallback(
    (p: ChartPoint, colorBy: 'pitch_type' | 'exit_velocity' | 'result') => {
      if (colorBy === 'pitch_type') return PITCH_COLORS[p.pitch_type] ?? PITCH_COLORS.Undefined;
      if (colorBy === 'exit_velocity') return EV_COLOR_PALETTE[evBin(p.exit_speed)];
      return RESULT_COLOR_PALETTE[resultLabelForSwing(p.play_result)] ?? RESULT_COLOR_PALETTE.Unknown;
    },
    []
  );
  const swingLegend = useMemo(() => {
    const map = new Map<string, string>();
    if (swingTab === '2D Contact' || swingTab === '3D Contact') {
      const mode = swingTab === '2D Contact' ? contact2dColorBy : contact3dColorBy;
      const base = swingTab === '2D Contact' ? swingContactPoints : swingContact3dPoints;
      for (const p of base) {
        const key =
          mode === 'pitch_type' ? (p.pitch_type || 'Unknown') : mode === 'exit_velocity' ? evBin(p.exit_speed) : resultLabelForSwing(p.play_result);
        if (!map.has(key)) map.set(key, swingColorFor(p, mode));
      }
    } else if (swingTab === 'Bat Speed') {
      for (const p of points.filter((x) => Number.isFinite(x.bat_speed as number))) {
        const key =
          batSpeedColorBy === 'pitch_type'
            ? (p.pitch_type || 'Unknown')
            : batSpeedColorBy === 'exit_velocity'
              ? evBin(p.exit_speed)
              : resultLabelForSwing(p.play_result);
        if (!map.has(key)) map.set(key, swingColorFor(p, batSpeedColorBy));
      }
    } else if (swingTab === 'EV and LA') {
      for (const p of swingEvlaPoints) {
        const key = evlaColorBy === 'pitch_type' ? (p.pitch_type || 'Unknown') : resultLabelForSwing(p.play_result);
        if (!map.has(key)) map.set(key, evlaColorBy === 'pitch_type' ? (PITCH_COLORS[p.pitch_type] ?? PITCH_COLORS.Undefined) : (RESULT_COLOR_PALETTE[key] ?? RESULT_COLOR_PALETTE.Unknown));
      }
    }
    return Array.from(map.entries());
  }, [swingTab, contact2dColorBy, contact3dColorBy, batSpeedColorBy, evlaColorBy, swingContactPoints, swingContact3dPoints, swingEvlaPoints, points, swingColorFor]);

  useEffect(() => {
    if (swingTab !== '3D Contact') return;
    const mount = swing3dRef.current;
    if (!mount) return;
    let cancelled = false;

    const render = async () => {
      await ensurePlotlyLoaded();
      if (cancelled) return;
      const Plotly = (window as unknown as { Plotly?: { react: (...args: unknown[]) => Promise<unknown>; Plots?: { resize: (el: HTMLElement) => void } } }).Plotly;
      if (!Plotly) return;

      const source =
        contact3dMode === 'average_pitch_type'
          ? Object.values(
              swingContact3dPoints.reduce<Record<string, { n: number; x: number; y: number; z: number; p: ChartPoint }>>((acc, p) => {
                const key = p.pitch_type || 'Unknown';
                if (!acc[key]) acc[key] = { n: 0, x: 0, y: 0, z: 0, p };
                acc[key].n += 1;
                acc[key].x += parseNumber(p.contact_position_x) ?? 0;
                acc[key].y += parseNumber(p.contact_position_y) ?? 0;
                acc[key].z += parseNumber(p.contact_position_z) ?? 0;
                return acc;
              }, {})
            ).map((g) => ({ ...g.p, contact_position_x: g.x / g.n, contact_position_y: g.y / g.n, contact_position_z: g.z / g.n }))
          : swingContact3dPoints;

      const xVals = source.map((p) => parseNumber(p.contact_position_x) ?? 0);
      const yVals = source.map((p) => parseNumber(p.contact_position_z) ?? 0);
      const zVals = source.map((p) => parseNumber(p.contact_position_y) ?? 0);
      const colors = source.map((p) => swingColorFor(p, contact3dColorBy));
      const hovers = source.map(
        (p) =>
          `<b>${p.pitch_type || '-'}</b><br>` +
          `Result: ${resultLabelForSwing(p.play_result)}<br>` +
          `Forward: ${(parseNumber(p.contact_position_x) ?? 0).toFixed(1)} ft<br>` +
          `Height: ${(parseNumber(p.contact_position_y) ?? 0).toFixed(1)} ft<br>` +
          `Side: ${(parseNumber(p.contact_position_z) ?? 0).toFixed(1)} ft<br>` +
          `Velo: ${Number.isFinite((p.rel_speed ?? null) as number) ? Number(p.rel_speed).toFixed(1) : '-'} mph<br>` +
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
        marker: { size: contact3dMode === 'average_pitch_type' ? 7 : 5, color: colors, opacity: 0.9, line: { color: 'rgba(255,255,255,0.55)', width: 1 } },
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
  }, [swingTab, contact3dMode, contact3dColorBy, swingContact3dPoints, swingColorFor]);

  return (
    <section className="portal-panel portal-admin-panel" style={{ padding: '1rem' }}>
      <div
        className={`portal-dashboard-suite-layout${!isSidebarHidden && dashboardPage !== 'Swing Data' ? ' portal-dashboard-suite-layout--double' : ''}`}
        style={isSidebarHidden ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}
      >
        {!isSidebarHidden ? (
          <article className={`portal-admin-card portal-dashboard-sidebar${isLeaderboardPage ? ' portal-dashboard-sidebar--compact' : ''}`}>
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
                    Hitters
                    <SearchableSingleSelect
                      options={hitterOptions}
                      value={hitter}
                      onChange={setHitter}
                      placeholder="All"
                    />
                  </label>
                  <label>
                    Team
                    <SearchableSingleSelect
                      options={teamTypeOptions}
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
                  ) : null}
                  <label>
                    Opponent Pitchers
                    <SearchableMultiSelect options={oppPitcherOptions} values={oppPitcher === 'All' ? ['All'] : [oppPitcher]} onChange={(next) => setOppPitcher(next[0] ?? 'All')} />
                  </label>
                  <label>
                    Pitcher Hand
                    <SearchableSingleSelect options={toOptions(filters.hands)} value={hand} onChange={setHand} placeholder="All" />
                  </label>
                  <label>
                    Batter Side
                    <SearchableSingleSelect options={toOptions(filters.batter_sides)} value={batterSide} onChange={setBatterSide} placeholder="All" />
                  </label>
                  <label>
                    Pitch Type
                    <SearchableMultiSelect options={[{ value: 'All', label: 'All' }, ...toOptions(filters.pitch_types)]} values={pitchTypes} onChange={setPitchTypes} />
                  </label>
                  <label>
                    Zone Location
                    <SearchableMultiSelect options={[{ value: 'All', label: 'All' }, ...toOptions(filters.zone_locations)]} values={zoneLocations} onChange={setZoneLocations} />
                  </label>
                  <label>
                    In Zone
                    <SearchableMultiSelect options={[{ value: 'All', label: 'All' }, ...toOptions(filters.in_zone_options)]} values={inZone} onChange={setInZone} />
                  </label>
                  <label>
                    Pitch Results
                    <SearchableMultiSelect options={[{ value: 'All', label: 'All' }, ...toOptions(filters.pitch_results)]} values={pitchResults} onChange={setPitchResults} />
                  </label>
                  <label>
                    Count
                    <SearchableMultiSelect options={[{ value: 'All', label: 'All' }, ...toOptions(filters.count_options)]} values={countFilter} onChange={setCountFilter} />
                  </label>
                  <label>
                    After Count
                    <SearchableMultiSelect options={[{ value: 'All', label: 'All' }, ...toOptions(filters.after_count_options)]} values={afterCountFilter} onChange={setAfterCountFilter} />
                  </label>
                  <label>
                    BIP Result
                    <SearchableMultiSelect options={[{ value: 'All', label: 'All' }, ...toOptions(filters.bip_results)]} values={bipResult} onChange={setBipResult} />
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
              </>
            ) : null}
          </article>
        ) : null}

        {!isSidebarHidden && dashboardPage !== 'Swing Data' ? (
          <article
            className="portal-admin-card portal-dashboard-sidebar"
            style={dashboardPage === 'AB Report' ? { alignContent: 'start', height: 'fit-content', alignSelf: 'start' } : { alignContent: 'start' }}
          >
            <div style={{ display: 'grid', gap: 12 }}>
              {dashboardPage === 'AB Report' ? (
                <div className="dashboard-panel">
                  <label>
                    Select Game
                    <SearchableSingleSelect
                      options={(abReport?.available_games ?? []).map((game) => ({
                        value: game.game_key,
                        label:
                          game.date && game.game_key === game.date
                            ? formatShortDate(game.date)
                            : game.date
                              ? `${formatShortDate(game.date)} | ${game.game_key}`
                              : game.game_key,
                      }))}
                      value={abGameKey || abReport?.selected_game_key || ''}
                      onChange={(next) => setAbGameKey(next)}
                      placeholder={loadingAbReport ? 'Loading games...' : 'Select game'}
                    />
                  </label>
                </div>
              ) : null}
              {dashboardPage === 'HeatMaps' ? (
                <>
                  <div className="dashboard-panel">
                    <label>
                      Chart Type
                      <SearchableSingleSelect
                        options={[
                          { value: 'Heat', label: 'Heat' },
                          { value: 'Pitch', label: 'Pitch' },
                        ]}
                        value={heatmapChartType}
                        onChange={(next) => {
                          const normalized = next as 'Heat' | 'Pitch';
                          setHeatmapChartType(normalized);
                        }}
                        placeholder="Pitch"
                      />
                    </label>
                  </div>
                  <div className="dashboard-panel">
                    <label>
                      Stat
                      <SearchableSingleSelect
                        options={heatmapStatOptions}
                        value={heatmapStat}
                        onChange={setHeatmapStat}
                        placeholder="Frequency"
                      />
                    </label>
                  </div>
                </>
              ) : null}
              <div className="dashboard-panel">
                <h4 style={{ margin: '0 0 10px 0', textAlign: 'center' }}>Pitch Result</h4>
                <div style={{ display: 'grid', gap: 8 }}>
                  {RESULT_ORDER.map((result, idx) => (
                    <div key={result} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg width="20" height="20" viewBox="0 0 20 20">
                        {markerForResult(result, 10, 10, '#ffffff', `rk-${idx}`)}
                      </svg>
                      <span>{RESULT_LABELS[result]}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dashboard-panel">
                <h4 style={{ margin: '0 0 10px 0', textAlign: 'center' }}>Pitch Type</h4>
                <div style={{ display: 'grid', gap: 8 }}>
                  {pitchLegend.map((name) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 12, height: 12, borderRadius: '999px', background: PITCH_COLORS[name] ?? PITCH_COLORS.Undefined, display: 'inline-block' }} />
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              </div>
              {dashboardPage === 'Summary' || dashboardPage === 'Leaderboard' ? (
                <div className="dashboard-panel">
                  <h4 style={{ margin: '0 0 10px 0', textAlign: 'center' }}>Spray Results</h4>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {SPRAY_RESULT_ORDER.map((result) => (
                      <div key={result} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 12, height: 12, borderRadius: '999px', background: SPRAY_RESULT_COLORS[result], display: 'inline-block' }} />
                        <span>{SPRAY_RESULT_LABELS[result]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        ) : null}

        <article className="portal-admin-card" style={{ alignContent: 'start', minWidth: 0 }}>
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
                  <option value="HeatMaps">HeatMaps</option>
                  <option value="Swing Data">Swing Data</option>
                </select>
              </label>
            ) : (
              <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className={dashboardPage === 'Summary' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setDashboardPage('Summary')}>
                  Summary
                </button>
                <button type="button" className={dashboardPage === 'Leaderboard' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setDashboardPage('Leaderboard')}>
                  Leaderboard
                </button>
                <button type="button" className={dashboardPage === 'AB Report' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setDashboardPage('AB Report')}>
                  AB Report
                </button>
                <button type="button" className={dashboardPage === 'HeatMaps' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setDashboardPage('HeatMaps')}>
                  HeatMaps
                </button>
                <button type="button" className={dashboardPage === 'Swing Data' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setDashboardPage('Swing Data')}>
                  Swing Data
                </button>
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
          <div className="dashboard-main" style={{ gap: 12, minWidth: 0 }}>
            {dashboardPage === 'Summary' || dashboardPage === 'Leaderboard' ? (
              <>
            <div className="dashboard-panel" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ margin: 0 }}>{(hitter && hitter !== 'All') ? formatNameFirstLast(hitter) : 'All'} | {startDate === endDate ? formatDateMMDDYY(startDate || null) : `${formatDateMMDDYY(startDate || null)} - ${formatDateMMDDYY(endDate || null)}`}</h3>
                {summaryTeamLogoUrl ? (
                  <img
                    src={summaryTeamLogoUrl}
                    alt="Team"
                    style={{ width: 42, height: 42, objectFit: 'contain', flexShrink: 0 }}
                  />
                ) : null}
              </div>
              <p className="portal-muted-text" style={{ margin: '6px 0 0 0' }}>
                {overview ? `${overview.total_pitches.toLocaleString()} pitches` : 'Loading...'}
              </p>
            </div>

            {error ? <div className="dashboard-panel"><p style={{ color: '#ff8a8a' }}>{error}</p></div> : null}

            {!isLeaderboardPage ? (
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', minWidth: 0 }}>
                <LocationChart
                  title="vs. RHP"
                  points={rhpPoints}
                  displayView={summaryRhpLocationView}
                  selectedPitchTypes={pitchTypes}
                  strictRunValue={isPro}
                  viewOptions={summaryLocationViewOptions}
                  onViewChange={setSummaryRhpLocationView}
                  onPointHover={setChartHover}
                  onPointLeave={() => setChartHover(null)}
                />
                <SprayChart
                  points={points}
                  view={summarySprayView}
                  onViewChange={setSummarySprayView}
                  onPointHover={setChartHover}
                  onPointLeave={() => setChartHover(null)}
                />
                <LocationChart
                  title="vs. LHP"
                  points={lhpPoints}
                  displayView={summaryLhpLocationView}
                  selectedPitchTypes={pitchTypes}
                  strictRunValue={isPro}
                  viewOptions={summaryLocationViewOptions}
                  onViewChange={setSummaryLhpLocationView}
                  onPointHover={setChartHover}
                  onPointLeave={() => setChartHover(null)}
                />
              </div>
            ) : null}
            {chartHover && !isLeaderboardPage ? (
              <div
                style={{
                  position: 'fixed',
                  left: chartHover.x + 12,
                  top: chartHover.y + 12,
                  zIndex: 80,
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

            <div className="dashboard-panel" style={{ overflowX: 'auto', marginTop: 10 }}>
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
              Table
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
                placeholder={TABLE_MODE_DEFAULT}
              />
            </label>
            {isLeaderboardPage && isLeague ? (
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
                Split By
                <SearchableSingleSelect
                  options={(filters?.split_by_options?.length ? filters.split_by_options : [SPLIT_BY_DEFAULT]).map((item) => ({
                    value: item,
                    label: item,
                  }))}
                  value={splitBy}
                  onChange={setSplitBy}
                  placeholder={SPLIT_BY_DEFAULT}
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
                    placeholder="Example: Hitting Summary"
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
          {loadingOverview ? <p className="portal-muted-text">Loading summary table...</p> : null}
          {!loadingOverview && overview?.table_rows?.length ? (
            <div className="portal-table-wrap" style={isLeaderboardPage ? { maxHeight: '68vh', overflowY: 'auto' } : undefined}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  {isLeaderboardPage ? (
                    <th style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid rgba(255,255,255,0.18)', whiteSpace: 'nowrap', position: isLeaderboardPage ? 'sticky' : undefined, top: isLeaderboardPage ? 0 : undefined, zIndex: isLeaderboardPage ? 3 : undefined, background: isLeaderboardPage ? 'rgba(7,9,14,0.98)' : undefined }}>Rank</th>
                  ) : null}
                  {displayedTableColumns.map((col, colIndex) => {
                    const isSortable = true;
                    const activeSort = leaderboardSortColumn === col;
                    const label = isLeaderboardPage && colIndex === 0 ? (leaderboardViewBy === 'Team' ? 'Team' : 'Player') : col;
                    return (
                      <th
                        key={col}
                        style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid rgba(255,255,255,0.18)', whiteSpace: 'nowrap', cursor: isSortable ? 'pointer' : 'default', position: isLeaderboardPage ? 'sticky' : undefined, top: isLeaderboardPage ? 0 : undefined, zIndex: isLeaderboardPage ? 3 : undefined, background: isLeaderboardPage ? 'rgba(7,9,14,0.98)' : undefined }}
                        onClick={
                          isSortable
                            ? () => {
                                if (leaderboardSortColumn === col) {
                                  setLeaderboardSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                                } else {
                                  setLeaderboardSortColumn(col);
                                  setLeaderboardSortDirection(isLeaderboardPage && colIndex > 0 ? 'desc' : 'asc');
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
                {(() => {
                  let leaderboardRankCounter = 0;
                  return leaderboardRows.map((row, idx) => {
                    const isAllRow = isLeaderboardPage && String(row[displayedTableColumns[0] ?? ''] ?? '').trim().toLowerCase() === 'all';
                    const rankValue = isAllRow ? '' : String(++leaderboardRankCounter);
                    return (
                  <tr key={`row-${idx}`} style={isAllRow ? { background: 'rgba(255,255,255,0.12)', fontWeight: 700 } : undefined}>
                    {isLeaderboardPage ? (
                      <td style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' }}>{rankValue}</td>
                    ) : null}
                    {displayedTableColumns.map((col, colIndex) => {
                      const rawValue = row[col];
                      const displayValue =
                        isLeaderboardPage && colIndex === 0 && typeof rawValue === 'string'
                          ? (() => {
                              const formatted = formatNameFirstLast(rawValue);
                              if (leaderboardViewBy !== 'Player') return formatted;
                              const key = String(rawValue).trim();
                              const keyNorm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
                              const formattedNorm = formatted.toLowerCase().replace(/[^a-z0-9]/g, '');
                              const teamCode =
                                latestTeamByHitter[key] ??
                                latestTeamByHitter[keyNorm] ??
                                latestTeamByHitter[formatted] ??
                                latestTeamByHitter[formattedNorm] ??
                                filterTeamByHitter[key] ??
                                filterTeamByHitter[keyNorm] ??
                                filterTeamByHitter[formatted] ??
                                filterTeamByHitter[formattedNorm];
                              if (!teamCode || key.toLowerCase() === 'all') return formatted;
                              const logoUrl = isPro ? getProTeamLogoUrl(teamCode) : '';
                              if (!logoUrl) return formatted;
                              return (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-start' }}>
                                  <img src={logoUrl} alt={teamCode} style={{ width: 16, height: 16, objectFit: 'contain', display: 'inline-block' }} />
                                  <span>{formatted}</span>
                                </span>
                              );
                            })()
                          : rawValue;
                      const renderedValue =
                        typeof displayValue === 'string' || typeof displayValue === 'number' || displayValue === null || displayValue === undefined
                          ? formatTableDisplayValue(col, displayValue)
                          : displayValue;
                      return (
                        <td
                          key={`${idx}-${col}`}
                          style={{
                            textAlign:
                              isLeaderboardPage && leaderboardViewBy === 'Player' && colIndex === 0
                                ? (isAllRow ? 'center' : 'left')
                                : 'center',
                            padding: '8px 6px',
                            borderBottom: '1px solid rgba(255,255,255,0.1)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {displayValue === null || displayValue === undefined ? '—' : renderedValue}
                        </td>
                      );
                    })}
                  </tr>
                );
                  });
                })()}
              </tbody>
            </table>
            </div>
          ) : !loadingOverview ? (
            <p className="portal-muted-text">No data found for current filters.</p>
          ) : null}
            </div>
              </>
            ) : dashboardPage === 'HeatMaps' ? (
              <>
                <div className="dashboard-panel" style={{ padding: 14 }}>
                  <h3 style={{ margin: 0 }}>
                    {(hitter && hitter !== 'All') ? formatNameFirstLast(hitter) : 'All'} | {startDate === endDate ? formatDateMMDDYY(startDate || null) : `${formatDateMMDDYY(startDate || null)} - ${formatDateMMDDYY(endDate || null)}`}
                  </h3>
                  <p className="portal-muted-text" style={{ margin: '6px 0 0 0' }}>
                    {overview ? `${overview.total_pitches.toLocaleString()} pitches` : 'Loading...'}
                  </p>
                </div>
                {loadingOverview ? <p>Loading heatmap data...</p> : null}
                {!loadingOverview && !points.length ? (
                  <p className="portal-muted-text">No heatmap data for current filters.</p>
                ) : null}
                {!loadingOverview && points.length ? (
                  <div className="dashboard-panel" style={{ paddingTop: 12 }}>
                    {heatmapDisplayView !== 'Pitch' ? (
                      <div style={{ display: 'grid', gap: 4, justifyItems: 'center', marginBottom: 8 }}>
                        <div style={{ width: 440, maxWidth: '85%', height: 26, background: 'linear-gradient(90deg, rgb(32,74,135) 0%, rgb(246,248,248) 50%, rgb(176,11,52) 100%)', border: '1px solid rgba(255,255,255,0.22)' }} />
                        <div style={{ width: 440, maxWidth: '85%', display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 600 }}>
                          <span>Least</span>
                          <span>Most</span>
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{heatmapDisplayView === 'Frequency' ? 'Pitch Frequency' : heatmapDisplayView}</div>
                      </div>
                    ) : null}
                    {heatmapsPageSvg}
                  </div>
                ) : null}
                {chartHover ? (
                  <div
                    style={{
                      position: 'fixed',
                      left: chartHover.x + 12,
                      top: chartHover.y + 12,
                      zIndex: 80,
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
              </>
            ) : dashboardPage === 'Swing Data' ? (
              <>
                <div className="dashboard-panel" style={{ padding: 14 }}>
                  <h3 style={{ margin: 0 }}>
                    {(hitter && hitter !== 'All') ? formatNameFirstLast(hitter) : 'All'} | {startDate === endDate ? formatDateMMDDYY(startDate || null) : `${formatDateMMDDYY(startDate || null)} - ${formatDateMMDDYY(endDate || null)}`}
                  </h3>
                </div>
                <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                  {(['2D Contact', '3D Contact', 'Attack Angles', 'Bat Speed', 'EV and LA'] as const).map((tab) => (
                    <button key={tab} type="button" className={swingTab === tab ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setSwingTab(tab)}>
                      {tab}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
                  <div className="dashboard-panel" style={{ display: 'grid', gap: 10 }}>
                    {swingTab === '2D Contact' ? (
                      <>
                        <label>
                          Display
                          <SearchableSingleSelect
                            options={[
                              { value: 'individual', label: 'Individual Pitches' },
                              { value: 'average_pitch_type', label: 'Average by Pitch Type' },
                            ]}
                            value={contact2dMode}
                            onChange={(next) => setContact2dMode(next as 'individual' | 'average_pitch_type')}
                          />
                        </label>
                        <label>
                          Color By
                          <SearchableSingleSelect
                            options={[
                              { value: 'pitch_type', label: 'Pitch Type' },
                              { value: 'exit_velocity', label: 'Exit Velocity' },
                              { value: 'result', label: 'Result' },
                            ]}
                            value={contact2dColorBy}
                            onChange={(next) => setContact2dColorBy(next as 'pitch_type' | 'exit_velocity' | 'result')}
                          />
                        </label>
                      </>
                    ) : null}
                    {swingTab === '3D Contact' ? (
                      <>
                        <label>
                          Display
                          <SearchableSingleSelect
                            options={[
                              { value: 'individual', label: 'Individual Pitches' },
                              { value: 'average_pitch_type', label: 'Average by Pitch Type' },
                            ]}
                            value={contact3dMode}
                            onChange={(next) => setContact3dMode(next as 'individual' | 'average_pitch_type')}
                          />
                        </label>
                        <label>
                          Color By
                          <SearchableSingleSelect
                            options={[
                              { value: 'pitch_type', label: 'Pitch Type' },
                              { value: 'exit_velocity', label: 'Exit Velocity' },
                              { value: 'result', label: 'Result' },
                            ]}
                            value={contact3dColorBy}
                            onChange={(next) => setContact3dColorBy(next as 'pitch_type' | 'exit_velocity' | 'result')}
                          />
                        </label>
                      </>
                    ) : null}
                    {swingTab === 'Attack Angles' ? (
                      <>
                        <label>
                          Angle View
                          <SearchableSingleSelect
                            options={[
                              { value: 'Horizontal Attack', label: 'Horizontal Attack' },
                              { value: 'Vertical Attack', label: 'Vertical Attack' },
                            ]}
                            value={attackAngleType}
                            onChange={(next) => setAttackAngleType(next as 'Horizontal Attack' | 'Vertical Attack')}
                          />
                        </label>
                        <label>
                          Display
                          <SearchableSingleSelect
                            options={[
                              { value: 'average', label: 'Average' },
                              { value: 'pitch', label: 'Individual Pitch' },
                            ]}
                            value={attackScope}
                            onChange={(next) => setAttackScope(next as 'average' | 'pitch')}
                          />
                        </label>
                        {attackScope === 'pitch' ? (
                          <label>
                            Pitch
                            <SearchableSingleSelect
                              options={swingAttackPoints.map((p) => ({
                                value: String(p.pitch_event_id ?? p.pitch_number ?? ''),
                                label: `${formatShortDate(p.session_date ?? '')} | ${p.pitch_type} | ${Number.isFinite((p.rel_speed ?? null) as number) ? `${Number(p.rel_speed).toFixed(1)} mph` : '—'}`,
                              }))}
                              value={attackPitchId}
                              onChange={setAttackPitchId}
                              placeholder="Select pitch"
                            />
                          </label>
                        ) : null}
                      </>
                    ) : null}
                    {swingTab === 'Bat Speed' ? (
                      <>
                        <label>
                          Display
                          <SearchableSingleSelect
                            options={[
                              { value: 'average', label: 'Average' },
                              { value: 'individual', label: 'Individual Pitches' },
                            ]}
                            value={batSpeedDisplay}
                            onChange={(next) => setBatSpeedDisplay(next as 'average' | 'individual')}
                          />
                        </label>
                        <label>
                          Color By
                          <SearchableSingleSelect
                            options={[
                              { value: 'pitch_type', label: 'Pitch Type' },
                              { value: 'exit_velocity', label: 'Exit Velocity' },
                              { value: 'result', label: 'Result' },
                            ]}
                            value={batSpeedColorBy}
                            onChange={(next) => setBatSpeedColorBy(next as 'pitch_type' | 'exit_velocity' | 'result')}
                          />
                        </label>
                      </>
                    ) : null}
                    {swingTab === 'EV and LA' ? (
                      <label>
                        Color By
                        <SearchableSingleSelect
                          options={[
                            { value: 'result', label: 'Result' },
                            { value: 'pitch_type', label: 'Pitch Type' },
                          ]}
                          value={evlaColorBy}
                          onChange={(next) => setEvlaColorBy(next as 'result' | 'pitch_type')}
                        />
                      </label>
                    ) : null}
                    <div style={{ fontWeight: 700, marginTop: 6 }}>Color Key</div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {swingLegend.map(([label, color]) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 12, height: 12, borderRadius: 999, background: color, display: 'inline-block', border: '1px solid rgba(255,255,255,0.35)' }} />
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="dashboard-panel">
                    {swingTab === '2D Contact' && swingContactPoints.length === 0 ? (
                      <p className="portal-muted-text">No contact-position data for current filters.</p>
                    ) : null}
                    {swingTab === '3D Contact' && swingContact3dPoints.length === 0 ? (
                      <p className="portal-muted-text">No 3D contact-position data for current filters.</p>
                    ) : null}
                    {swingTab === '2D Contact' ? (
                      <svg viewBox="0 0 720 560" style={{ width: '100%', height: 560, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }} onMouseLeave={() => setChartHover(null)}>
                        {(() => {
                          const data =
                            contact2dMode === 'average_pitch_type'
                              ? Object.values(
                                  swingContactPoints.reduce<Record<string, { n: number; x: number; z: number; p: ChartPoint }>>((acc, p) => {
                                    const key = p.pitch_type || 'Unknown';
                                    if (!acc[key]) acc[key] = { n: 0, x: 0, z: 0, p };
                                    acc[key].n += 1;
                                    acc[key].x += Number(p.contact_position_x ?? 0);
                                    acc[key].z += Number(p.contact_position_z ?? 0);
                                    return acc;
                                  }, {})
                                ).map((g) => ({ ...g.p, contact_position_x: g.x / g.n, contact_position_z: g.z / g.n }))
                              : swingContactPoints;
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
                                const x = parseNumber(p.contact_position_z) ?? 0;
                                const y = parseNumber(p.contact_position_x) ?? 0;
                                const color = swingColorFor(p, contact2dColorBy);
                                const tip = `${p.pitch_type}\nResult: ${resultLabelForSwing(p.play_result)}\nVelo: ${Number.isFinite((p.rel_speed ?? null) as number) ? Number(p.rel_speed).toFixed(1) : '-'} mph\nEV: ${Number.isFinite((p.exit_speed ?? null) as number) ? Number(p.exit_speed).toFixed(1) : '-'} mph\nLA: ${Number.isFinite((p.angle ?? null) as number) ? Number(p.angle).toFixed(1) : '-'}°\nForward: ${Number(y).toFixed(1)} ft\nSide: ${Number(x).toFixed(1)} ft`;
                                return (
                                  <circle
                                    key={`s2-${i}`}
                                    cx={px(x)}
                                    cy={py(y)}
                                    r={contact2dMode === 'average_pitch_type' ? 4.5 : 3}
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
                    ) : null}
                    {swingTab === '3D Contact' ? (
                      <div
                        ref={swing3dRef}
                        style={{ width: '100%', height: 620, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }}
                      />
                    ) : null}
                    {swingTab === 'Attack Angles' ? (
                      <svg viewBox="0 0 720 620" style={{ width: '100%', height: 620, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }} onMouseLeave={() => setChartHover(null)}>
                        {(() => {
                          const full = swingAttackPoints;
                          const selectedPitchPool =
                            attackScope === 'pitch'
                              ? full.filter((p) => String(p.pitch_event_id ?? p.pitch_number ?? '') === attackPitchId)
                              : full;
                          const pool = selectedPitchPool.length ? selectedPitchPool : full;
                          if (!pool.length) {
                            return (
                              <text x={360} y={312} textAnchor="middle" fill="rgba(255,255,255,0.78)" fontSize={20}>
                                No attack-angle contact data for current filters
                              </text>
                            );
                          }

                          const mean = (vals: number[]) => {
                            if (!vals.length) return null;
                            return vals.reduce((a, b) => a + b, 0) / vals.length;
                          };
                          const modeSide = (() => {
                            const counts = new Map<string, number>();
                            for (const p of pool) {
                              const s = String(p.batterside ?? '').trim();
                              if (!s) continue;
                              counts.set(s, (counts.get(s) ?? 0) + 1);
                            }
                            let best = 'Right';
                            let bestN = -1;
                            for (const [k, n] of counts) {
                              if (n > bestN) {
                                best = k;
                                bestN = n;
                              }
                            }
                            return best;
                          })();
                          const isLefty = modeSide.toLowerCase().startsWith('l');

                          const selectedPitch = attackScope === 'pitch' ? pool[0] : null;
                          const selectedHorizontalAttack = selectedPitch
                            ? parseNumber(selectedPitch.horizontal_attack_angle)
                            : mean(pool.map((p) => parseNumber(p.horizontal_attack_angle)).filter((v): v is number => v !== null));
                          const selectedVerticalAttack = selectedPitch
                            ? parseNumber(selectedPitch.vertical_attack_angle)
                            : mean(pool.map((p) => parseNumber(p.vertical_attack_angle)).filter((v): v is number => v !== null));
                          const selectedContactX = selectedPitch
                            ? parseNumber(selectedPitch.contact_position_x)
                            : mean(pool.map((p) => parseNumber(p.contact_position_x)).filter((v): v is number => v !== null));
                          const selectedContactY = selectedPitch
                            ? parseNumber(selectedPitch.contact_position_y)
                            : mean(pool.map((p) => parseNumber(p.contact_position_y)).filter((v): v is number => v !== null));
                          const selectedContactZ = selectedPitch
                            ? parseNumber(selectedPitch.contact_position_z)
                            : mean(pool.map((p) => parseNumber(p.contact_position_z)).filter((v): v is number => v !== null));
                          const ev = selectedPitch
                            ? parseNumber(selectedPitch.exit_speed)
                            : mean(pool.map((p) => parseNumber(p.exit_speed)).filter((v): v is number => v !== null));
                          const la = selectedPitch
                            ? parseNumber(selectedPitch.angle)
                            : mean(pool.map((p) => parseNumber(p.angle)).filter((v): v is number => v !== null));
                          const result =
                            attackScope === 'pitch'
                              ? resultLabelForSwing(selectedPitch?.play_result ?? '')
                              : null;
                          const angleValue = parseNumber(
                            attackAngleType === 'Horizontal Attack'
                              ? selectedHorizontalAttack
                              : selectedVerticalAttack
                          );
                          const statsLine = attackScope === 'pitch'
                            ? `EV ${ev !== null ? ev.toFixed(1) : '—'} | LA ${la !== null ? la.toFixed(1) : '—'} | Result ${result || 'Foul'}`
                            : `EV ${ev !== null ? ev.toFixed(1) : '—'} | LA ${la !== null ? la.toFixed(1) : '—'}`;

                          const plotTop = 120;
                          const plotBottom = 588;
                          const plotLeft = 20;
                          const plotRight = 700;
                          const plotW = plotRight - plotLeft;
                          const plotH = plotBottom - plotTop;

                          const lineCol = 'rgba(255,255,255,0.88)';
                          const zeroCol = 'rgba(203,213,225,0.95)';
                          const plateCol = 'rgba(100,116,139,0.22)';
                          const batCol = '#d2b48c';
                          const batHiCol = '#cfa170';
                          const batHandleCol = '#8b5a2b';
                          const arrowCol = '#ef4444';

                          if (attackAngleType === 'Horizontal Attack') {
                            const cx = selectedContactZ ?? 0;
                            const cy = selectedContactX ?? 0;
                            let haa = selectedHorizontalAttack ?? 0;
                            if (isLefty) haa = -haa;
                            const rad = (haa * Math.PI) / 180;
                            const vecLen = 1.2;
                            const dx = Math.sin(rad) * vecLen;
                            const dy = Math.cos(rad) * vecLen;
                            const yVals = full.map((p) => parseNumber(p.contact_position_x)).filter((v): v is number => v !== null);
                            let yMin = yVals.length ? Math.floor(Math.min(...yVals, -0.6)) : -1;
                            let yMax = yVals.length ? Math.ceil(Math.max(...yVals, 1.0)) : 6;
                            if (!(Number.isFinite(yMin) && Number.isFinite(yMax)) || yMax <= yMin) {
                              yMin = -1;
                              yMax = 6;
                            }
                            const px = (x: number) => plotLeft + ((x + 2.5) / 5) * plotW;
                            const py = (y: number) => plotTop + (1 - (y - yMin) / (yMax - yMin)) * plotH;

                            const batHalf = (34 / 12) / 2;
                            const batTheta = -rad;
                            const b1x = cx - Math.cos(batTheta) * batHalf;
                            const b1y = cy - Math.sin(batTheta) * batHalf;
                            const b2x = cx + Math.cos(batTheta) * batHalf;
                            const b2y = cy + Math.sin(batTheta) * batHalf;

                            let barrelX = b1x;
                            let barrelY = b1y;
                            let handleX = b2x;
                            let handleY = b2y;
                            if (isLefty ? b1x > b2x : b1x < b2x) {
                              barrelX = b2x;
                              barrelY = b2y;
                              handleX = b1x;
                              handleY = b1y;
                            }

                            const batNorm = Math.hypot(barrelX - handleX, barrelY - handleY) || 1;
                            const ubx = (barrelX - handleX) / batNorm;
                            const uby = (barrelY - handleY) / batNorm;
                            const arrowStartInset = 0.17;
                            const currentArrowX = barrelX - ubx * arrowStartInset;
                            const currentArrowY = barrelY - uby * arrowStartInset;
                            const shiftX = cx - currentArrowX;
                            const shiftY = cy - currentArrowY;
                            barrelX += shiftX;
                            barrelY += shiftY;
                            handleX += shiftX;
                            handleY += shiftY;
                            const arrowX = barrelX - ubx * arrowStartInset;
                            const arrowY = barrelY - uby * arrowStartInset;
                            const dirNorm = Math.hypot(dx, dy) || 1;
                            const ux = dx / dirNorm;
                            const uy = dy / dirNorm;
                            const arrowLen = 1.0;

                            const segCount = 40;
                            const segs = Array.from({ length: segCount }, (_, i) => {
                              const t0 = i / segCount;
                              const t1 = (i + 1) / segCount;
                              const x0 = handleX + (barrelX - handleX) * t0;
                              const y0 = handleY + (barrelY - handleY) * t0;
                              const x1 = handleX + (barrelX - handleX) * t1;
                              const y1 = handleY + (barrelY - handleY) * t1;
                              const tm = (t0 + t1) / 2;
                              const lw = tm <= (2 / 3)
                                ? 6 + (tm / (2 / 3)) * 2
                                : 8 + ((tm - (2 / 3)) / (1 / 3)) * 6.8;
                              return { x0, y0, x1, y1, lw, lwh: Math.max(1.6, lw * 0.34) };
                            });

                            const pullLeft = isLefty ? 'OPPO' : 'PULL';
                            const pullRight = isLefty ? 'PULL' : 'OPPO';
                            return (
                              <>
                                <text x={360} y={52} textAnchor="middle" fill="rgba(255,255,255,0.95)" fontSize={56} fontWeight={800}>
                                  {angleValue !== null ? angleValue.toFixed(1) : '—'}°
                                </text>
                                <text x={360} y={82} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize={20}>
                                  Horizontal Attack
                                </text>
                                <text x={360} y={104} textAnchor="middle" fill="rgba(255,255,255,0.84)" fontSize={15}>
                                  {statsLine}
                                </text>

                                <rect x={px(-1.9)} y={py(0.9)} width={px(-0.9) - px(-1.9)} height={py(-0.45) - py(0.9)} fill="none" stroke={lineCol} strokeWidth={1.05} />
                                <rect x={px(0.9)} y={py(0.9)} width={px(1.9) - px(0.9)} height={py(-0.45) - py(0.9)} fill="none" stroke={lineCol} strokeWidth={1.05} />
                                <polygon
                                  points={`${px(-0.708)},${py(0.62)} ${px(0.708)},${py(0.62)} ${px(0.708)},${py(0.35)} ${px(0)},${py(0)} ${px(-0.708)},${py(0.35)} ${px(-0.708)},${py(0.62)}`}
                                  fill="none"
                                  stroke={lineCol}
                                  strokeWidth={1.05}
                                />
                                <line x1={px(arrowX)} y1={py(arrowY)} x2={px(arrowX)} y2={py(arrowY + arrowLen)} stroke={zeroCol} strokeWidth={1.4} strokeDasharray="5 5" />

                                {segs.map((s, i) => (
                                  <g key={`bat-${i}`}>
                                    <line x1={px(s.x0)} y1={py(s.y0)} x2={px(s.x1)} y2={py(s.y1)} stroke={batCol} strokeWidth={Math.max(1, s.lw)} strokeLinecap="round" />
                                    <line x1={px(s.x0)} y1={py(s.y0)} x2={px(s.x1)} y2={py(s.y1)} stroke={batHiCol} strokeOpacity={0.42} strokeWidth={Math.max(1, s.lwh)} strokeLinecap="round" />
                                  </g>
                                ))}
                                <circle cx={px(handleX)} cy={py(handleY)} r={4.8} fill={batHandleCol} />

                                <line x1={px(arrowX)} y1={py(arrowY)} x2={px(arrowX + ux * arrowLen)} y2={py(arrowY + uy * arrowLen)} stroke={arrowCol} strokeWidth={2.2} />
                                <polygon
                                  points={`${px(arrowX + ux * arrowLen)},${py(arrowY + uy * arrowLen)} ${px(arrowX + ux * (arrowLen - 0.12) - uy * 0.06)},${py(arrowY + uy * (arrowLen - 0.12) + ux * 0.06)} ${px(arrowX + ux * (arrowLen - 0.12) + uy * 0.06)},${py(arrowY + uy * (arrowLen - 0.12) - ux * 0.06)}`}
                                  fill={arrowCol}
                                />
                                <text x={px(-2.05)} y={py(yMax - 0.35)} textAnchor="start" fill="#22c55e" fontSize={15} fontWeight={700}>{pullLeft}</text>
                                <text x={px(2.05)} y={py(yMax - 0.35)} textAnchor="end" fill="#22c55e" fontSize={15} fontWeight={700}>{pullRight}</text>
                              </>
                            );
                          }

                          const cx = selectedContactX ?? 0;
                          const cy = selectedContactY ?? 0;
                          const vaa = selectedVerticalAttack ?? 0;
                          const xPlot = isLefty ? -cx : cx;
                          const rad = (vaa * Math.PI) / 180;
                          const vecLen = 1.15;
                          const faceDir = isLefty ? -1 : 1;
                          const capX = xPlot;
                          const capY = cy;
                          const zeroXEnd = capX + faceDir * vecLen;
                          const zeroYEnd = capY;
                          const arrowXEnd = capX + faceDir * Math.cos(rad) * vecLen;
                          const arrowYEnd = capY + Math.sin(rad) * vecLen;
                          const tipDir = isLefty ? 1 : -1;
                          const plateTemplate = [-0.36, -0.08, 0.0, -0.08, -0.36, -0.36];
                          const plateY = [0.22, 0.22, 0.26, 0.3, 0.3, 0.22];
                          const boxLower = [{ x: -1.45, y: 0.02 }, { x: 1.45, y: 0.02 }, { x: 1.18, y: 0.18 }, { x: -1.18, y: 0.18 }, { x: -1.45, y: 0.02 }];
                          const boxUpper = [{ x: -1.18, y: 0.36 }, { x: 1.18, y: 0.36 }, { x: 0.98, y: 0.5 }, { x: -0.98, y: 0.5 }, { x: -1.18, y: 0.36 }];
                          const xMin = isLefty ? -4.0 : -2.1;
                          const xMax = isLefty ? 2.1 : 4.0;
                          const yMin = 0;
                          const yMax = 4.4;
                          const px = (x: number) => plotLeft + ((x - xMin) / (xMax - xMin)) * plotW;
                          const py = (y: number) => plotTop + (1 - (y - yMin) / (yMax - yMin)) * plotH;

                          return (
                            <>
                              <text x={360} y={52} textAnchor="middle" fill="rgba(255,255,255,0.95)" fontSize={56} fontWeight={800}>
                                {angleValue !== null ? angleValue.toFixed(1) : '—'}°
                              </text>
                              <text x={360} y={82} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize={20}>
                                Vertical Attack
                              </text>
                              <text x={360} y={104} textAnchor="middle" fill="rgba(255,255,255,0.84)" fontSize={15}>
                                {statsLine}
                              </text>

                              <polygon points={boxUpper.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} fill="none" stroke={lineCol} strokeOpacity={0.4} strokeWidth={0.9} />
                              <polygon points={boxLower.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} fill="none" stroke={lineCol} strokeOpacity={0.8} strokeWidth={1.15} />
                              <polygon
                                points={plateTemplate.map((x, i) => `${px(x * tipDir)},${py(plateY[i] ?? 0)}`).join(' ')}
                                fill={plateCol}
                                stroke={lineCol}
                                strokeWidth={1}
                              />
                              <line x1={px(capX)} y1={py(capY)} x2={px(zeroXEnd)} y2={py(zeroYEnd)} stroke={zeroCol} strokeDasharray="5 5" strokeWidth={1.4} />
                              <circle cx={px(capX)} cy={py(capY)} r={8.2} fill="#a16207" />
                              <circle cx={px(capX)} cy={py(capY)} r={5.6} fill="#b7791f" fillOpacity={0.92} />
                              <line x1={px(capX)} y1={py(capY)} x2={px(arrowXEnd)} y2={py(arrowYEnd)} stroke={arrowCol} strokeWidth={2.2} />
                              <polygon
                                points={`${px(arrowXEnd)},${py(arrowYEnd)} ${px(arrowXEnd - faceDir * 0.13)},${py(arrowYEnd + 0.07)} ${px(arrowXEnd - faceDir * 0.13)},${py(arrowYEnd - 0.07)}`}
                                fill={arrowCol}
                              />
                            </>
                          );
                        })()}
                      </svg>
                    ) : null}
                    {swingTab === 'Bat Speed' ? (
                      <svg viewBox="0 0 720 620" style={{ width: '100%', height: 620, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }} onMouseLeave={() => setChartHover(null)}>
                        {(() => {
                          const source = points.filter((p) => Number.isFinite(p.bat_speed as number));
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
                                  <g key={`bs-${tick}`}>
                                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.65)" />
                                    <text x={xl} y={yl} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="12">{tick}</text>
                                  </g>
                                );
                              })}
                              <line x1={centerX} y1={centerY} x2={avgX} y2={avgY} stroke="#ef4444" strokeWidth="3" />
                              <circle cx={centerX} cy={centerY} r={5} fill="rgba(255,255,255,0.9)" />
                              <text x={centerX} y={70} textAnchor="middle" fill="rgba(255,255,255,0.95)" fontSize="34" fontWeight={700}>
                                {Number.isFinite(avg) ? `${avg.toFixed(1)} mph` : '—'}
                              </text>
                              {batSpeedDisplay === 'individual'
                                ? source.map((p, i) => {
                                    const s = Number(p.bat_speed);
                                    const t = toTheta(s);
                                    const x = centerX + (r * 0.9) * Math.cos(t);
                                    const y = centerY - (r * 0.9) * Math.sin(t);
                                    const color = swingColorFor(p, batSpeedColorBy);
                                    const tip = `${p.pitch_type}\nBat Speed: ${s.toFixed(1)} mph\nEV: ${Number.isFinite((p.exit_speed ?? null) as number) ? Number(p.exit_speed).toFixed(1) : '-'} mph\nLA: ${Number.isFinite((p.angle ?? null) as number) ? Number(p.angle).toFixed(1) : '-'}°`;
                                    return <circle key={`bsi-${i}`} cx={x} cy={y} r={3.3} fill={color} stroke="rgba(255,255,255,0.6)" onMouseEnter={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: tip, bg: color })} onMouseMove={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: tip, bg: color })} />;
                                  })
                                : null}
                            </>
                          );
                        })()}
                      </svg>
                    ) : null}
                    {swingTab === 'EV and LA' ? (
                      <svg viewBox="0 0 720 620" style={{ width: '100%', height: 620, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }} onMouseLeave={() => setChartHover(null)}>
                        {(() => {
                          const data = swingEvlaPoints;
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
                                  <g key={`evla-a-${a}`}>
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
                                const color = evlaColorBy === 'pitch_type' ? (PITCH_COLORS[p.pitch_type] ?? PITCH_COLORS.Undefined) : (RESULT_COLOR_PALETTE[resultLabelForSwing(p.play_result)] ?? RESULT_COLOR_PALETTE.Unknown);
                                const tip = `${p.pitch_type}\nResult: ${resultLabelForSwing(p.play_result)}\nEV: ${ev.toFixed(1)} mph\nLA: ${la.toFixed(1)}°`;
                                return <circle key={`evla-${i}`} cx={pt.x} cy={pt.y} r={4} fill={color} stroke="rgba(255,255,255,0.7)" onMouseEnter={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: tip, bg: color })} onMouseMove={(event) => setChartHover({ x: event.clientX, y: event.clientY, text: tip, bg: color })} />;
                              })}
                            </>
                          );
                        })()}
                      </svg>
                    ) : null}
                  </div>
                </div>
                {chartHover ? (
                  <div
                    style={{
                      position: 'fixed',
                      left: chartHover.x + 12,
                      top: chartHover.y + 12,
                      zIndex: 80,
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
              </>
            ) : (
              <>
                <div className="dashboard-panel" style={{ padding: 14 }}>
                  <h3 style={{ margin: 0 }}>
                    {(selectedSingleHitter ? formatNameFirstLast(selectedSingleHitter) : 'AB Report')} | {abReport?.selected_game_date ? formatShortDate(abReport.selected_game_date) : '-'}
                  </h3>
                  {!selectedSingleHitter ? (
                    <p className="portal-muted-text" style={{ margin: '8px 0 0 0' }}>
                      Select a single hitter in the sidebar to view AB Report.
                    </p>
                  ) : null}
                </div>
                {selectedSingleHitter && loadingAbReport ? <p>Loading AB report...</p> : null}
                {selectedSingleHitter && abError ? <p className="auth-error">{abError}</p> : null}
                {selectedSingleHitter && abReport ? (
                  <div>
                      {abCards.length ? (
                        <div className="portal-admin-grid portal-ab-pa-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(300px, 1fr))' }}>
                          {abCards.map(({ pitcher, pa }) => (
                            <article key={`ab-pa-${pitcher}-${pa.pa_index}`} className="portal-day-card portal-ab-pa-card">
                              <div style={{ textAlign: 'center', marginBottom: 2, fontWeight: 700 }}>{`PA #${pa.pa_index}`}</div>
                              <div style={{ textAlign: 'center', marginBottom: 6, fontSize: '0.82rem', opacity: 0.86 }}>{`Pitcher: ${formatNameFirstLast(pitcher)}`}</div>
                              <AbPaChart pitches={pa.pitches} resultLabel={pa.result_label} pitchColors={PITCH_COLORS} />
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
                                        Velo: pitch.velo ?? pitch.rel_speed,
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
                                        <td style={{ textAlign: 'center' }}>{pitch.velo ?? pitch.rel_speed ? Number(pitch.velo ?? pitch.rel_speed).toFixed(1) : '-'}</td>
                                        <td style={{ textAlign: 'center' }}>{pitch.ivb !== null && pitch.ivb !== undefined ? Number(pitch.ivb).toFixed(1) : '-'}</td>
                                        <td style={{ textAlign: 'center' }}>{pitch.hb !== null && pitch.hb !== undefined ? Number(pitch.hb).toFixed(1) : '-'}</td>
                                        <td style={{ textAlign: 'center' }}>{pitch.exit_speed !== null && pitch.exit_speed !== undefined ? Number(pitch.exit_speed).toFixed(1) : '-'}</td>
                                        <td style={{ textAlign: 'center' }}>{pitch.angle !== null && pitch.angle !== undefined ? Number(pitch.angle).toFixed(1) : '-'}</td>
                                        <td style={{ textAlign: 'center' }}>{resolveAbPitchResult(pitch)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="portal-muted-text">No completed plate appearances for the selected game.</p>
                      )}
                  </div>
                ) : null}
              </>
            )}
            </div>
        </article>
      </div>
    </section>
  );
}

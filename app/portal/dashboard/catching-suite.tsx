'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTableDisplayValue, sortTableRows, type SortDirection } from '../../../lib/table-sort';
import { buildPinnedAllRow, pinKeyFromRow, sortRowsWithPins } from '../../../lib/leaderboard-pins';
import { getProTeamLogoUrl } from './pro-team-logos';
import LeaderboardCorrelationModal from './leaderboard-correlation-modal';
import NativeDateInput from '../components/native-date-input';
import { resolveSchoolBrand } from '../../../lib/school-brand';

type OptionItem = { value: string; label: string };
const PRO_LEVEL_FILTER_OPTIONS = ['All', 'MLB', 'AAA'];
const NCAA_LEVEL_FILTER_OPTIONS = ['All', 'D1', 'D2', 'D3', 'NAIA', 'JUCO'];

type CatchingFiltersPayload = {
  school_code: string;
  min_date: string | null;
  max_date: string | null;
  catchers: string[];
  team_types?: string[];
  level_options?: string[];
  pitch_types: string[];
  hands: string[];
  batter_sides: string[];
  zone_locations: string[];
  in_zone_options: string[];
  pitch_results: string[];
  count_options: string[];
  after_count_options: string[];
  catchers_by_team_code?: Record<string, string[]>;
};

type CatchingPoint = {
  pitch_event_id: number | null;
  session_date: string | null;
  session_type: string;
  catcher: string;
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
  rel_speed: number | null;
  plate_side: number | null;
  plate_height: number | null;
  throw_speed: number | null;
  exchange_time: number | null;
  pop_time: number | null;
  target_base: string | null;
  base_x: number | null;
  base_y: number | null;
  base_z: number | null;
  pitch_number: number | null;
  tagged_hit_type?: string | null;
  exit_speed?: number | null;
  angle?: number | null;
  qp_plus?: number | null;
  run_value?: number | null;
};

type CatchingOverviewPayload = {
  school_code: string;
  start_date: string | null;
  end_date: string | null;
  session_type: string | null;
  catcher: string | null;
  hand: string | null;
  batter_side: string | null;
  total_pitches: number;
  table_mode: string;
  split_by?: string;
  table_columns: string[];
  available_table_columns: string[];
  table_rows: Array<Record<string, string | number | null>>;
  pitch_type_legend: string[];
  chart_points: CatchingPoint[];
  heatmap_points: CatchingPoint[];
};

type CustomTableConfig = {
  id: number;
  name: string;
  columns: string[];
  createdByEmail?: string | null;
  createdAt?: string;
  updatedAt?: string;
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

type HeatCell = { x: number; y: number; w: number; h: number; value: number; density: number };

const PITCH_COLORS: Record<string, string> = {
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

const RESULT_SHAPES: Record<string, 'circle' | 'ring' | 'triangle' | 'star' | 'square'> = {
  'Called Strike': 'circle',
  Ball: 'ring',
  Foul: 'triangle',
  Whiff: 'star',
  'In Play (Out)': 'triangle',
  'In Play (Hit)': 'square',
  Error: 'square',
  Undefined: 'ring',
};
const LEAGUE_SEASON_START = '2026-02-13';

function toYmdNow(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isAllLikeRowValue(value: unknown): boolean {
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'all' || text === 'all (pinned)';
}

function clampYmdToToday(value: string): string {
  const v = (value || '').trim();
  if (!v) return v;
  const today = toYmdNow();
  return v > today ? today : v;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

function formatNameFirstLast(name: string): string {
  const normalized = (name || '').trim();
  if (!normalized) return '';
  const parts = normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts.slice(1).join(' ')} ${parts[0]}`.replace(/\s+/g, ' ').trim();
  return normalized;
}

function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toOptions(values: string[]): OptionItem[] {
  return values.map((value) => ({ value, label: value === 'Inning' ? 'Inning of Appearance' : value }));
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

function withAll(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    const key = (v || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  push('All');
  for (const v of values) push(v);
  return out;
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
        {selected ? renderOptionLabel(selected.label) : placeholder ?? 'Select'}
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
          <input className="portal-search-select-input" placeholder="Type to filter..." value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="portal-search-select-options">
            {filtered.map((option) => {
              const checked = values.includes(option.value);
              return (
                <button key={option.value} type="button" className="portal-search-select-option portal-search-select-option-multi" onClick={() => toggle(option.value)}>
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

function pitchResultLabel(p: CatchingPoint): string {
  const call = p.pitch_call || '';
  const pr = p.play_result || '';
  if (call === 'StrikeCalled') return 'Called Strike';
  if (call === 'StrikeSwinging') return 'Whiff';
  if (call === 'BallCalled' || call === 'BallinDirt') return 'Ball';
  if (call === 'InPlay' && (pr === 'Single' || pr === 'Double' || pr === 'Triple' || pr === 'HomeRun')) return 'In Play (Hit)';
  if (call === 'InPlay' && (pr === 'Out' || pr === 'FieldersChoice' || pr === 'Sacrifice')) return 'In Play (Out)';
  if (call === 'InPlay' && pr === 'Error') return 'Error';
  if (call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable') return 'Foul';
  return 'Undefined';
}

function pitchResultDetailLabel(p: CatchingPoint): string {
  const call = (p.pitch_call || '').trim();
  const pr = (p.play_result || '').trim();
  const valid = (value: string) => value.length > 0 && value !== 'Undefined';
  if (call === 'InPlay' && valid(pr)) return pr;
  if (valid(call) && /foul/i.test(call)) return 'Foul';
  if (call === 'HitByPitch' || pr === 'HitByPitch') return 'HBP';
  if (valid(call)) return call;
  if (valid(pr)) return pr;
  return '-';
}

function markerShape(shape: string, x: number, y: number, color: string, key: string) {
  if (shape === 'ring') return <circle key={key} cx={x} cy={y} r={8.4} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={2.2} />;
  if (shape === 'triangle') return <polygon key={key} points={`${x},${y - 8.4} ${x - 7.1},${y + 6.0} ${x + 7.1},${y + 6.0}`} fill="rgba(0,0,0,0.001)" stroke={color} strokeWidth={2.1} />;
  if (shape === 'square') return <rect key={key} x={x - 6.0} y={y - 6.0} width={12.0} height={12.0} fill={color} stroke="rgba(255,255,255,0.45)" strokeWidth={0.9} />;
  if (shape === 'star') {
    const pts = [
      [x, y - 10.2], [x + 2.7, y - 2.7], [x + 9.9, y - 2.7], [x + 3.8, y + 1.7], [x + 6.3, y + 9.5],
      [x, y + 4.5], [x - 6.3, y + 9.5], [x - 3.8, y + 1.7], [x - 9.9, y - 2.7], [x - 2.7, y - 2.7],
    ].map((p) => p.join(',')).join(' ');
    return <polygon key={key} points={pts} fill={color} />;
  }
  return <circle key={key} cx={x} cy={y} r={7.1} fill={color} stroke="rgba(255,255,255,0.45)" strokeWidth={0.9} />;
}

function fmtNum(v: number | null | undefined, d = 1): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
  return v.toFixed(d);
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

export default function CatchingSuite() {
  const [filters, setFilters] = useState<CatchingFiltersPayload | null>(null);
  const [overview, setOverview] = useState<CatchingOverviewPayload | null>(null);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState<'Data and Performance' | 'Leaderboard' | 'HeatMaps'>('Data and Performance');
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);

  const [sessionType, setSessionType] = useState('All');
  const [level, setLevel] = useState('D1');
  const [teamType, setTeamType] = useState('All');
  const [catcher, setCatcher] = useState('All');
  const [hand, setHand] = useState('All');
  const [batterSide, setBatterSide] = useState('All');
  const [venue, setVenue] = useState('All');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [inZone, setInZone] = useState('All');
  const [pitchTypes, setPitchTypes] = useState<string[]>(['All']);
  const [zoneLocations, setZoneLocations] = useState<string[]>(['All']);
  const [pitchResults, setPitchResults] = useState<string[]>(['All']);
  const [selectedCountFilters, setSelectedCountFilters] = useState<string[]>(['All']);
  const [selectedAfterCountFilters, setSelectedAfterCountFilters] = useState<string[]>(['All']);
  const [veloMin, setVeloMin] = useState('');
  const [veloMax, setVeloMax] = useState('');
  const [pcMin, setPcMin] = useState('');
  const [pcMax, setPcMax] = useState('');

  const [tableMode, setTableMode] = useState('Catching Data');
  const [splitBy, setSplitBy] = useState('Pitch Types');
  const [customCols, setCustomCols] = useState<string[]>([]);
  const [customTables, setCustomTables] = useState<CustomTableConfig[]>([]);
  const [loadingCustomTables, setLoadingCustomTables] = useState(false);
  const [customTableName, setCustomTableName] = useState('');
  const [selectedCustomTableId, setSelectedCustomTableId] = useState<number | null>(null);
  const [customColumnToAdd, setCustomColumnToAdd] = useState('');
  const [customSaveState, setCustomSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [customSaveMessage, setCustomSaveMessage] = useState('');
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [leaderboardSortColumn, setLeaderboardSortColumn] = useState('');
  const [leaderboardSortDirection, setLeaderboardSortDirection] = useState<SortDirection>('desc');
  const [leaderboardViewBy, setLeaderboardViewBy] = useState<'Player' | 'Team'>('Player');
  const [pinnedLeaderboardKeys, setPinnedLeaderboardKeys] = useState<Set<string>>(new Set());
  const [showLeaderboardCorrelation, setShowLeaderboardCorrelation] = useState(false);

  const [hmChartType, setHmChartType] = useState<'Heat' | 'Pitch'>('Heat');
  const [hmStat, setHmStat] = useState('Frequency');
  const [hmHover, setHmHover] = useState<{ x: number; y: number; text: string; bg?: string } | null>(null);
  const autoFallbackAppliedRef = useRef(false);
  const overviewCacheRef = useRef(new Map<string, { at: number; payload: CatchingOverviewPayload }>());
  const overviewInflightRef = useRef(new Map<string, Promise<CatchingOverviewPayload>>());
  const isLeaderboardPage = page === 'Leaderboard';
  const effectiveSplitBy = isLeaderboardPage ? (leaderboardViewBy === 'Team' ? 'Pitcher Team' : 'Catcher') : splitBy;
  const isLeague = String(filters?.school_code ?? '').toUpperCase() === 'LEAGUE';
  const isPro = String(filters?.school_code ?? '').toUpperCase() === 'PRO';
  const activeSchoolBrand = useMemo(
    () => resolveSchoolBrand(String(filters?.school_code ?? 'PCU')),
    [filters?.school_code]
  );
  const isLeagueAllSelection = isLeague && teamType === 'All' && catcher === 'All';
  const leagueWindowDays = useMemo(() => {
    if (!isLeague || !dateStart || !dateEnd) return 0;
    const start = new Date(`${dateStart}T00:00:00`);
    const end = new Date(`${dateEnd}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
    return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  }, [isLeague, dateStart, dateEnd]);
  const shouldForceLeagueFastTable =
    isLeague && isLeaderboardPage && leagueWindowDays > 14 && isLeagueAllSelection;
  useEffect(() => {
    if (!isLeague && leaderboardViewBy !== 'Player') {
      setLeaderboardViewBy('Player');
    }
  }, [isLeague, leaderboardViewBy]);

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

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoadingFilters(true);
    const params = new URLSearchParams();
    if (level) params.set('level', level);
    fetch(`/api/dashboard/catching/filters?${params.toString()}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as CatchingFiltersPayload & { error?: string };
        if (!res.ok) {
          if (res.status === 404) throw new Error('Catching API endpoint not loaded. Restart Python API server.');
          throw new Error(payload.error ?? 'Failed to load catching filters.');
        }
        if (!active) return;
        autoFallbackAppliedRef.current = false;
        setFilters(payload);
        setTeamType(pickDefaultTeamType(payload.team_types, payload.school_code));
        const latest = clampYmdToToday(payload.max_date ?? payload.min_date ?? '');
        const nextDate = latest || toYmdNow();
        const minDate = payload.min_date ?? '';
        const isLeagueSchool = String(payload.school_code ?? '').toUpperCase() === 'LEAGUE';
        if (isLeagueSchool) {
          const leagueStart = minDate && minDate > LEAGUE_SEASON_START ? minDate : LEAGUE_SEASON_START;
          setDateStart(leagueStart);
          setDateEnd(nextDate || leagueStart);
        } else if (nextDate) {
          setDateStart(nextDate);
          setDateEnd(nextDate);
        }
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load catching filters.');
      })
      .finally(() => {
        if (active) setLoadingFilters(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [level]);

  useEffect(() => {
    if (!isPro) return;
    if (!PRO_LEVEL_FILTER_OPTIONS.includes(level)) setLevel('MLB');
  }, [isPro, level]);

  useEffect(() => {
    if (!isLeague) return;
    const options = Array.from(new Set([...(filters?.level_options ?? []), ...NCAA_LEVEL_FILTER_OPTIONS]));
    const nextDefault = options.includes('D1') ? 'D1' : (options[0] ?? 'All');
    if (!level || PRO_LEVEL_FILTER_OPTIONS.includes(level) || !options.includes(level)) setLevel(nextDefault);
  }, [filters?.level_options, isLeague, level]);

  useEffect(() => {
    if (!dateStart && !dateEnd) return;
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (dateStart) params.set('start_date', dateStart);
    if (dateEnd) params.set('end_date', dateEnd);
    if (!isPro && sessionType && sessionType !== 'All') params.set('session_type', sessionType);
    if ((isPro || isLeague) && level && level !== 'All') params.set('level', level);
    fetch(`/api/dashboard/catching/filters?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as CatchingFiltersPayload & { error?: string };
        if (!res.ok) throw new Error(payload.error ?? 'Failed to refresh catcher filters.');
        if (!active) return;
        setFilters((prev) => {
          if (!prev) return payload;
          return { ...prev, catchers: payload.catchers, catchers_by_team_code: payload.catchers_by_team_code };
        });
        if (catcher !== 'All' && !payload.catchers.includes(catcher)) setCatcher('All');
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
    };
  }, [dateStart, dateEnd, sessionType, catcher, isPro, isLeague, level]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (dateStart) params.set('start_date', dateStart);
    if (dateEnd) params.set('end_date', dateEnd);
    if (!isPro && sessionType && sessionType !== 'All') params.set('session_type', sessionType);
    if ((isPro || isLeague) && level && level !== 'All') params.set('level', level);
    if (teamType && teamType !== 'All') params.set('team_type', teamType);
    if (catcher && catcher !== 'All') params.set('catcher', catcher);
    if (hand && hand !== 'All') params.set('hand', hand);
    if (batterSide && batterSide !== 'All') params.set('batter_side', batterSide);
    if (venue && venue !== 'All') params.set('venue', venue);
    if (inZone && inZone !== 'All') params.set('in_zone', inZone);
    const pitchTypeTokens = pitchTypes.includes('All') ? [] : pitchTypes;
    if (pitchTypeTokens.length) params.set('pitch_types', pitchTypeTokens.join(','));
    const zoneTokens = zoneLocations.includes('All') ? [] : zoneLocations;
    if (zoneTokens.length) params.set('zone_locations', zoneTokens.join(','));
    const resultTokens = pitchResults.includes('All') ? [] : pitchResults;
    if (resultTokens.length) params.set('pitch_results', resultTokens.join(','));
    const countTokens = selectedCountFilters.includes('All') ? [] : selectedCountFilters;
    if (countTokens.length) params.set('count_filter', countTokens.join(','));
    const afterCountTokens = selectedAfterCountFilters.includes('All') ? [] : selectedAfterCountFilters;
    if (afterCountTokens.length) params.set('after_count_filter', afterCountTokens.join(','));
    if (veloMin) params.set('velo_min', veloMin);
    if (veloMax) params.set('velo_max', veloMax);
    if (pcMin) params.set('pc_min', pcMin);
    if (pcMax) params.set('pc_max', pcMax);
    params.set('table_mode', tableMode);
    if (effectiveSplitBy) params.set('split_by', effectiveSplitBy);
    if (tableMode === 'Custom' && customCols.length) params.set('custom_columns', customCols.join(','));
    const shouldForceProFastLoad = isPro;
    const shouldIncludeCharts = !shouldForceProFastLoad && !shouldForceLeagueFastTable;
    params.set('include_chart_points', shouldIncludeCharts ? '1' : '0');
    if (shouldIncludeCharts) {
      params.set('chart_points_limit', isPro ? '500' : '800');
    }

    const overviewUrl = `/api/dashboard/catching/overview?${params.toString()}`;
    const chartUrl = shouldForceProFastLoad
      ? (() => {
          const chartParams = new URLSearchParams(params);
          chartParams.set('include_chart_points', '1');
          chartParams.set('chart_points_limit', '350');
          chartParams.set('chart_only', '1');
          return `/api/dashboard/catching/overview?${chartParams.toString()}`;
        })()
      : null;
    const overviewTtlMs = isPro ? 90000 : 30000;
    const cachedOverview = overviewCacheRef.current.get(overviewUrl);
    const applyOverviewPayload = (payload: CatchingOverviewPayload) => {
      const noRows = !Array.isArray(payload.table_rows) || payload.table_rows.length === 0;
      if (noRows && !autoFallbackAppliedRef.current) autoFallbackAppliedRef.current = true;
      setOverview(payload);
      setError(null);
    };
    const applyChartPayload = (payload: CatchingOverviewPayload) => {
      setOverview((previous) => {
        if (!previous) return payload;
        return {
          ...previous,
          chart_points: payload.chart_points ?? [],
          heatmap_points: payload.heatmap_points ?? payload.chart_points ?? [],
          pitch_type_legend: payload.pitch_type_legend?.length ? payload.pitch_type_legend : previous.pitch_type_legend,
        };
      });
    };
    if (cachedOverview && Date.now() - cachedOverview.at < overviewTtlMs) {
      applyOverviewPayload(cachedOverview.payload);
      setLoadingOverview(false);
      return () => {
        active = false;
      };
    }
    setLoadingOverview(true);
    const inflightOverview = overviewInflightRef.current.get(overviewUrl);
    const overviewPromise =
      inflightOverview ??
      (async () => {
        const res = await fetch(overviewUrl, { cache: 'no-store' });
        const payload = (await res.json().catch(() => ({}))) as CatchingOverviewPayload & { error?: string };
        if (!res.ok) {
          if (res.status === 404) throw new Error('Catching API endpoint not loaded. Restart Python API server.');
          throw new Error(payload.error ?? 'Failed to load catching overview.');
        }
        return payload;
      })();
    if (!inflightOverview) overviewInflightRef.current.set(overviewUrl, overviewPromise);
    overviewPromise
      .then((payload) => {
        if (!active) return;
        overviewCacheRef.current.set(overviewUrl, { at: Date.now(), payload });
        applyOverviewPayload(payload);
        if (!chartUrl) return;
        const cachedChart = overviewCacheRef.current.get(chartUrl);
        if (cachedChart && Date.now() - cachedChart.at < overviewTtlMs) {
          applyChartPayload(cachedChart.payload);
          return;
        }
        const inflightChart = overviewInflightRef.current.get(chartUrl);
        const chartPromise =
          inflightChart ??
          (async () => {
            const chartRes = await fetch(chartUrl, { cache: 'no-store' });
            const chartPayload = (await chartRes.json().catch(() => ({}))) as CatchingOverviewPayload & { error?: string };
            if (!chartRes.ok) throw new Error(chartPayload.error ?? 'Failed to load chart data.');
            return chartPayload;
          })();
        if (!inflightChart) overviewInflightRef.current.set(chartUrl, chartPromise);
        chartPromise
          .then((chartPayload) => {
            if (!active) return;
            overviewCacheRef.current.set(chartUrl, { at: Date.now(), payload: chartPayload });
            applyChartPayload(chartPayload);
          })
          .catch(() => {
            if (!active) return;
          })
          .finally(() => {
            overviewInflightRef.current.delete(chartUrl);
          });
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load catching overview.');
      })
      .finally(() => {
        overviewInflightRef.current.delete(overviewUrl);
        if (active) setLoadingOverview(false);
      });
    return () => {
      active = false;
    };
  }, [dateStart, dateEnd, sessionType, level, teamType, catcher, hand, batterSide, venue, inZone, pitchTypes, zoneLocations, pitchResults, selectedCountFilters, selectedAfterCountFilters, veloMin, veloMax, pcMin, pcMax, tableMode, effectiveSplitBy, customCols, page, isPro, isLeague]);

  useEffect(() => {
    let active = true;
    setLoadingCustomTables(true);
    fetch('/api/dashboard/pitching/custom-tables', { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { items?: CustomTableConfig[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load custom tables.');
        if (!active) return;
        setCustomTables(Array.isArray(payload.items) ? payload.items : []);
      })
      .catch((requestError) => {
        if (!active) return;
        setCustomSaveState('error');
        setCustomSaveMessage(requestError instanceof Error ? requestError.message : 'Failed to load custom tables.');
      })
      .finally(() => {
        if (active) setLoadingCustomTables(false);
      });
    return () => {
      active = false;
    };
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
          columns: customCols,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; item?: CustomTableConfig };
      if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Failed to save custom table.');
      const saved = payload.item;
      setSelectedCustomTableId(saved.id);
      setCustomTableName(saved.name);
      setCustomCols(saved.columns ?? []);
      setCustomTables((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
      setCustomSaveState('saved');
      setCustomSaveMessage('Custom table saved.');
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
      setCustomCols([]);
      setCustomSaveState('saved');
      setCustomSaveMessage('Custom table deleted.');
    } catch (requestError) {
      setCustomSaveState('error');
      setCustomSaveMessage(requestError instanceof Error ? requestError.message : 'Failed to delete custom table.');
    }
  };

  const heatPoints = overview?.heatmap_points ?? [];
  const summaryPoints = useMemo(() => overview?.chart_points ?? [], [overview?.chart_points]);
  const heatmapDisplayView = useMemo(() => (hmChartType === 'Pitch' ? 'Pitch' : hmStat), [hmChartType, hmStat]);
  const heatmapStatOptions = useMemo(
    () => [
      { value: 'Frequency', label: 'Frequency' },
      { value: 'Called Strike Rate', label: 'Called Strike Rate' },
      { value: 'Whiff Rate', label: 'Whiff Rate' },
      { value: 'GB Rate', label: 'GB Rate' },
      { value: 'Contact Rate', label: 'Contact Rate' },
      { value: 'Swing Rate', label: 'Swing Rate' },
      { value: 'Exit Velocity', label: 'Exit Velocity' },
      { value: 'Run Values', label: 'Run Values' },
    ] satisfies OptionItem[],
    []
  );

  const buildHeatCells = (points: CatchingPoint[], metric: string): HeatCell[] => {
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
    const runValue = (pitch: CatchingPoint): number => {
      if (typeof pitch.run_value === 'number' && Number.isFinite(pitch.run_value)) return pitch.run_value;
      const call = pitch.pitch_call || '';
      const play = pitch.play_result || '';
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
    const valid = points
      .map((p) => ({ p, x: parseNumber(p.plate_side), y: parseNumber(p.plate_height) }))
      .filter((row): row is { p: CatchingPoint; x: number; y: number } => row.x !== null && row.y !== null);
    if (!valid.length) return [];

    const isSwing = (call: string) =>
      call === 'StrikeSwinging' || call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable' || call === 'InPlay';
    const globalSwingCount = valid.filter((rowPoint) => isSwing(rowPoint.p.pitch_call || '')).length;
    const globalWhiffCount = valid.filter((rowPoint) => (rowPoint.p.pitch_call || '') === 'StrikeSwinging').length;
    const globalInPlayCount = valid.filter((rowPoint) => (rowPoint.p.pitch_call || '') === 'InPlay').length;
    const globalGbCount = valid.filter((rowPoint) => (rowPoint.p.tagged_hit_type || '').toLowerCase().includes('ground')).length;
    const globalEvRows = valid.filter((rowPoint) => (rowPoint.p.pitch_call || '') === 'InPlay' && typeof rowPoint.p.exit_speed === 'number' && Number.isFinite(rowPoint.p.exit_speed));
    const globalTakeRows = valid.filter((rowPoint) => ['StrikeCalled', 'BallCalled', 'BallinDirt'].includes(rowPoint.p.pitch_call || ''));

    const globalEvAvg = globalEvRows.length > 0 ? globalEvRows.reduce((sum, rowPoint) => sum + Number(rowPoint.p.exit_speed || 0), 0) / globalEvRows.length : 0;
    const globalRvAvg = valid.length > 0 ? valid.reduce((sum, rowPoint) => sum + runValue(rowPoint.p), 0) / valid.length : 0;
    const globalCsRate = globalTakeRows.length > 0 ? globalTakeRows.filter((rowPoint) => rowPoint.p.pitch_call === 'StrikeCalled').length / globalTakeRows.length : 0;
    const globalSwingRate = valid.length > 0 ? globalSwingCount / valid.length : 0;
    const globalWhiffRate = globalSwingCount > 0 ? globalWhiffCount / globalSwingCount : 0;
    const globalGbRate = globalInPlayCount > 0 ? globalGbCount / globalInPlayCount : 0;
    const globalContactRate = globalSwingCount > 0 ? globalInPlayCount / globalSwingCount : 0;
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
        let csW = 0;
        let takeW = 0;
        let evWSum = 0;
        let evW = 0;
        let rvWSum = 0;

        for (const rowPoint of valid) {
          const dx = (cx - rowPoint.x) / sigmaX;
          const dy = (cy - rowPoint.y) / sigmaY;
          const w = Math.exp(-0.5 * (dx * dx + dy * dy));
          if (w < 1e-6) continue;
          const call = rowPoint.p.pitch_call || '';
          const swing = isSwing(call);
          const inPlay = call === 'InPlay';
          const gb = (rowPoint.p.tagged_hit_type || '').toLowerCase().includes('ground');
          const isTake = call === 'StrikeCalled' || call === 'BallCalled' || call === 'BallinDirt';

          sumW += w;
          if (swing) swingW += w;
          if (call === 'StrikeSwinging') whiffW += w;
          if (inPlay) inPlayW += w;
          if (gb) gbW += w;
          if (isTake) {
            takeW += w;
            if (call === 'StrikeCalled') csW += w;
          }
          if (inPlay && typeof rowPoint.p.exit_speed === 'number' && Number.isFinite(rowPoint.p.exit_speed)) {
            evWSum += w * rowPoint.p.exit_speed;
            evW += w;
          }
          rvWSum += w * runValue(rowPoint.p);
        }

        let value = sumW;
        if (metric === 'Called Strike Rate') value = 100 * ((csW + shrinkStrength * globalCsRate) / Math.max(eps, takeW + shrinkStrength));
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
      const maxVal = Math.max(...cells.map((c) => c.value), eps);
      for (const c of cells) c.value = (100 * c.value) / maxVal;
    }
    return cells;
  };

  const heatCells = useMemo(() => {
    if (page !== 'HeatMaps') return [];
    if (hmChartType !== 'Heat') return [];
    return buildHeatCells(heatPoints, heatmapDisplayView);
  }, [page, hmChartType, heatPoints, heatmapDisplayView]);

  const catcherOptions = useMemo(() => {
    const values = teamType === 'All' ? (filters?.catchers ?? []) : (filters?.catchers_by_team_code?.[teamType] ?? filters?.catchers ?? []);
    return withAll(values).map((value) => ({
      value,
      label: value === 'All' ? 'All' : formatNameFirstLast(value),
    }));
  }, [filters?.catchers, filters?.catchers_by_team_code, teamType]);
  const teamTypeOptions = useMemo(() => {
    const school = String(filters?.school_code ?? '').trim();
    const isPro = String(filters?.school_code ?? '').trim().toUpperCase() === 'PRO';
    const fromFilters = (filters?.team_types ?? []).map((value) => String(value ?? '').trim()).filter(Boolean);
    const base = isPro ? ['All'] : ['All', school || 'OSU', 'Opponents', 'Campers'];
    const values = Array.from(new Set([...base, ...fromFilters])).filter((value) =>
      isPro ? !['PRO', 'Opponents', 'Campers'].includes(value) : true
    );
    return toOptions(values);
  }, [filters?.school_code, filters?.team_types]);
  useEffect(() => {
    const allowed = new Set(catcherOptions.map((option) => option.value));
    if (!allowed.has(catcher)) setCatcher('All');
  }, [catcher, catcherOptions]);
  const handOptions = useMemo(() => toOptions(withAll(filters?.hands ?? ['All', 'Left', 'Right'])), [filters?.hands]);
  const batterSideOptions = useMemo(() => toOptions(withAll(filters?.batter_sides ?? ['All', 'Left', 'Right'])), [filters?.batter_sides]);
  const pitchTypeOptions = useMemo(() => toOptions(withAll(filters?.pitch_types ?? [])), [filters?.pitch_types]);
  const zoneLocationOptions = useMemo(() => toOptions(withAll(filters?.zone_locations ?? [])), [filters?.zone_locations]);
  const inZoneOptions = useMemo(() => toOptions(withAll(filters?.in_zone_options ?? ['All', 'Yes', 'No', 'Competitive'])), [filters?.in_zone_options]);
  const pitchResultOptions = useMemo(() => toOptions(withAll(filters?.pitch_results ?? [])), [filters?.pitch_results]);
  const countOptions = useMemo(() => toOptions(withAll(filters?.count_options ?? [])), [filters?.count_options]);
  const afterCountOptions = useMemo(() => toOptions(withAll(filters?.after_count_options ?? [])), [filters?.after_count_options]);
  const tableModeOptions = useMemo(
    () =>
      [
        { value: 'Catching Data', label: 'Catching Data' },
        { value: 'Stuff', label: 'Stuff' },
        { value: 'Process', label: 'Process' },
        { value: 'Results', label: 'Results' },
        { value: 'Bullpen', label: 'Bullpen' },
        { value: 'Live', label: 'Live' },
        { value: 'Banny', label: "Jared's Dashboard" },
        { value: 'Usage', label: 'Usage' },
        { value: 'Raw Data', label: 'Raw Data' },
        { value: 'Batted Ball Data', label: 'Batted Ball Data' },
        { value: 'Swing Decisions', label: 'Swing Decisions' },
        ...customTables.map((item) => ({ value: `custom_saved:${item.id}`, label: customTableOptionLabel(item) })),
        { value: 'Custom', label: 'Custom' },
      ] satisfies OptionItem[],
    [customTables]
  );
  const tableModeSelectValue = useMemo(
    () => (tableMode === 'Custom' && selectedCustomTableId ? `custom_saved:${selectedCustomTableId}` : tableMode),
    [tableMode, selectedCustomTableId]
  );
  const splitByOptions = useMemo(
    () =>
      toOptions([
        'Pitch Types',
        'Pitcher Hand',
        'Batter Hand',
        'Year',
        'Month',
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
        'Pitcher',
        'Batter',
        'Catcher',
      ]),
    []
  );
  const availableCustomColumns = useMemo(
    () => (overview?.available_table_columns?.length ? overview.available_table_columns : ['#', '# Throws', 'Velo', 'ExchangeTime', 'PopTime', 'SL+']),
    [overview?.available_table_columns]
  );
  const remainingCustomColumns = useMemo(
    () => availableCustomColumns.filter((column) => !customCols.includes(column)),
    [availableCustomColumns, customCols]
  );
  const leaderboardBaseColumns = useMemo(
    () => (overview?.table_columns ?? []),
    [overview?.table_columns]
  );
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
  const leaderboardRowsWithPins = useMemo(() => {
    if (!isLeaderboardPage) return leaderboardRows;
    const sorted = sortRowsWithPins(
      leaderboardRows as Array<Record<string, string | number | null | undefined>>,
      leaderboardBaseColumns,
      pinnedLeaderboardKeys
    ) as Array<Record<string, string | number | null>>;
    const splitColumn = leaderboardBaseColumns[0] ?? '';
    if (!splitColumn || !sorted.length) return sorted;
    const hasAll = sorted.some((row) => isAllLikeRowValue(row[splitColumn]));
    if (hasAll) return sorted;
    const syntheticAll = buildPinnedAllRow(
      leaderboardBaseColumns,
      sorted as Array<Record<string, string | number | null | undefined>>
    );
    if (!syntheticAll) return sorted;
    syntheticAll[splitColumn] = 'All';
    return [syntheticAll as Record<string, string | number | null>, ...sorted];
  }, [isLeaderboardPage, leaderboardRows, leaderboardBaseColumns, pinnedLeaderboardKeys]);
  const latestTeamByCatcher = useMemo(() => {
    const points = overview?.chart_points ?? [];
    const latestTsByName: Record<string, number> = {};
    const out: Record<string, string> = {};
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    points.forEach((point) => {
      const name = String(point.catcher ?? '').trim();
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
  const filterTeamByCatcher = useMemo(() => {
    const out: Record<string, string> = {};
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const byTeam = filters?.catchers_by_team_code ?? {};
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
  }, [filters?.catchers_by_team_code]);

  return (
    <section className="portal-panel portal-admin-panel" style={{ padding: '1rem' }}>
      <div className="portal-dashboard-suite-layout">
          {!isSidebarHidden ? (
            <article className={`portal-admin-card portal-dashboard-sidebar${isLeaderboardPage ? ' portal-dashboard-sidebar--compact' : ''}`}>
              <button type="button" className="btn btn-ghost" onClick={() => setIsSidebarHidden(true)}>
                Hide Filters
              </button>
              <div className="portal-form-grid">
                <label>
                  Start Date
                  <NativeDateInput value={dateStart} onChange={setDateStart} ariaLabel="Start Date" />
                </label>
                <label>
                  End Date
                  <NativeDateInput value={dateEnd} onChange={setDateEnd} ariaLabel="End Date" />
                </label>
                {isPro || isLeague ? (
                  <label>
                    Level
                    <SearchableSingleSelect
                      options={toOptions(isLeague ? Array.from(new Set([...(filters?.level_options ?? []), ...NCAA_LEVEL_FILTER_OPTIONS])) : (filters?.level_options ?? PRO_LEVEL_FILTER_OPTIONS))}
                      value={level}
                      onChange={setLevel}
                      placeholder={isPro ? 'MLB' : 'D1'}
                    />
                  </label>
                ) : null}
                {!isPro && !isLeague ? (
                  <label>
                    Session Type
                    <SearchableSingleSelect options={toOptions(withAll(['Season', 'Bullpen', 'Live BP']))} value={sessionType} onChange={setSessionType} placeholder="All" />
                  </label>
                ) : null}
                <label>
                  Team
                  <SearchableSingleSelect options={teamTypeOptions} value={teamType} onChange={setTeamType} placeholder="All" />
                </label>
                <label>
                  Catchers
                  <SearchableSingleSelect options={catcherOptions} value={catcher} onChange={setCatcher} placeholder="All" />
                </label>
                <label>
                  Pitcher Hand
                  <SearchableSingleSelect options={handOptions} value={hand} onChange={setHand} placeholder="All" />
                </label>
                <label>
                  Batter Hand
                  <SearchableSingleSelect options={batterSideOptions} value={batterSide} onChange={setBatterSide} placeholder="All" />
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
                  Pitch Type
                  <SearchableMultiSelect options={pitchTypeOptions} values={pitchTypes} onChange={setPitchTypes} />
                </label>
                <label>
                  Zone Location
                  <SearchableMultiSelect options={zoneLocationOptions} values={zoneLocations} onChange={setZoneLocations} />
                </label>
                <label>
                  In Zone
                  <SearchableSingleSelect options={inZoneOptions} value={inZone} onChange={setInZone} placeholder="All" />
                </label>
                <label>
                  Pitch Results
                  <SearchableMultiSelect options={pitchResultOptions} values={pitchResults} onChange={setPitchResults} />
                </label>
                <label>
                  Count
                  <SearchableMultiSelect options={countOptions} values={selectedCountFilters} onChange={setSelectedCountFilters} />
                </label>
                <label>
                  After Count
                  <SearchableMultiSelect options={afterCountOptions} values={selectedAfterCountFilters} onChange={setSelectedAfterCountFilters} />
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
                  Pitch Count Min
                  <input type="number" value={pcMin} onChange={(event) => setPcMin(event.target.value)} />
                </label>
                <label>
                  Pitch Count Max
                  <input type="number" value={pcMax} onChange={(event) => setPcMax(event.target.value)} />
                </label>
              </div>
            </article>
          ) : null}

          <article className="portal-admin-card" style={{ alignContent: 'start', minWidth: 0 }}>
            <div className="portal-day-card" style={{ marginBottom: '0.8rem', padding: '0.7rem 0.8rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                {isMobileView ? (
                  <label className="portal-mobile-control-row">
                    <span>Page</span>
                    <select
                      className="portal-mobile-page-select"
                      value={page}
                      onChange={(event) => setPage(event.target.value as typeof page)}
                    >
                      <option value="Data and Performance">Data and Performance</option>
                      <option value="Leaderboard">Leaderboard</option>
                      <option value="HeatMaps">HeatMaps</option>
                    </select>
                  </label>
                ) : (
                  <div className="portal-suite-page-tabs" style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className={page === 'Data and Performance' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setPage('Data and Performance')}>
                      DATA AND PERFORMANCE
                    </button>
                    <button type="button" className={page === 'Leaderboard' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setPage('Leaderboard')}>
                      LEADERBOARD
                    </button>
                    <button type="button" className={page === 'HeatMaps' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setPage('HeatMaps')}>
                      HEATMAPS
                    </button>
                  </div>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => setIsSidebarHidden((v) => !v)}>
                  {isSidebarHidden ? 'Show Filters' : 'Hide Filters'}
                </button>
              </div>
            </div>
            {loadingFilters || loadingOverview ? <p>Loading catching data...</p> : null}
            {error ? <p className="auth-error">{error}</p> : null}

            {page === 'Data and Performance' || page === 'Leaderboard' ? (
              <article className="portal-day-card">
                <div className="portal-stack">
                <div
                  className="portal-form-grid"
                  style={{
                    marginBottom: '0.8rem',
                    gridTemplateColumns: page === 'Leaderboard'
                      ? (isLeague ? 'repeat(3, minmax(160px, 260px))' : 'repeat(2, minmax(160px, 260px))')
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
                          setCustomCols(found.columns ?? []);
                          setCustomSaveState('idle');
                          setCustomSaveMessage('');
                          return;
                        }
                        setTableMode(next);
                        if (next === 'Custom') {
                          setShowCustomEditor(true);
                          setSelectedCustomTableId(null);
                          setCustomTableName('');
                          setCustomCols([]);
                          setCustomSaveState('idle');
                          setCustomSaveMessage('');
                        } else {
                          setShowCustomEditor(false);
                          setSelectedCustomTableId(null);
                        }
                      }}
                      placeholder="Catching Data"
                    />
                  </label>
                  {page === 'Leaderboard' && isLeague ? (
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
                  {page === 'Leaderboard' ? (
                    <div style={{ display: 'grid', alignContent: 'end', justifySelf: 'end' }}>
                      <button type="button" className="btn btn-ghost" onClick={() => setShowLeaderboardCorrelation(true)}>
                        View Chart
                      </button>
                    </div>
                  ) : null}
                  {page !== 'Leaderboard' ? (
                    <label>
                      <span>Split By</span>
                      <SearchableSingleSelect options={splitByOptions} value={splitBy} onChange={setSplitBy} placeholder="Pitch Types" />
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
                            ...customTables.map((item) => ({ value: String(item.id), label: customTableOptionLabel(item) })),
                          ]}
                          value={selectedCustomTableId ? String(selectedCustomTableId) : 'new'}
                          onChange={(next) => {
                            if (next === 'new') {
                              setSelectedCustomTableId(null);
                              setCustomTableName('');
                              setCustomCols([]);
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
                            setCustomCols(found.columns ?? []);
                            setCustomSaveState('idle');
                            setCustomSaveMessage('');
                          }}
                          placeholder={loadingCustomTables ? 'Loading...' : 'New Custom Table'}
                        />
                      </label>
                      <label>
                        Custom Table Name
                        <input value={customTableName} onChange={(event) => setCustomTableName(event.target.value)} placeholder="Example: Catching Review" />
                      </label>
                      <label>
                        Add Column
                        <SearchableSingleSelect
                          options={remainingCustomColumns.map((column) => ({ value: column, label: column }))}
                          value={customColumnToAdd}
                          onChange={(next) => {
                            setCustomColumnToAdd(next);
                            if (!next || customCols.includes(next)) return;
                            setCustomCols((current) => [...current, next]);
                            setCustomColumnToAdd('');
                          }}
                          placeholder="Choose column"
                        />
                      </label>
                      <div style={{ alignSelf: 'end', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-primary" onClick={saveCustomTable} disabled={customSaveState === 'saving'}>
                          {customSaveState === 'saving' ? 'Saving...' : 'Save Table'}
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={deleteCustomTable} disabled={!selectedCustomTableId || customSaveState === 'saving'}>
                          Delete
                        </button>
                      </div>
                    </div>
                    {customSaveMessage ? (
                      <p className={customSaveState === 'error' ? 'auth-error' : 'portal-muted-text'} style={{ marginTop: '0.65rem' }}>
                        {customSaveMessage}
                      </p>
                    ) : null}
                    <div style={{ marginTop: '0.65rem', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {customCols.length ? (
                        customCols.map((column, index) => (
                          <span key={`${column}-${index}`} className="portal-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span>{column}</span>
                            <button type="button" className="btn btn-ghost" style={{ padding: '0.1rem 0.35rem', minHeight: 'unset' }} onClick={() => setCustomCols((current) => current.filter((_, i) => i !== index))}>
                              ×
                            </button>
                          </span>
                        ))
                      ) : (
                        <span className="portal-muted-text">Add columns to build this custom table.</span>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="portal-table-wrap" style={page === 'Leaderboard' ? { maxHeight: '68vh', overflowY: 'auto' } : undefined}>
                  <table className="portal-table">
                    <thead>
                      <tr>
                        {page === 'Leaderboard' ? <th style={{ textAlign: 'center', position: page === 'Leaderboard' ? 'sticky' : undefined, top: page === 'Leaderboard' ? 0 : undefined, zIndex: page === 'Leaderboard' ? 3 : undefined, background: page === 'Leaderboard' ? ((typeof document !== 'undefined' && document.body.classList.contains('theme-light')) ? 'rgba(248,250,252,0.98)' : 'rgba(7,9,14,0.98)') : undefined }}>Rank</th> : null}
                        {(overview?.table_columns ?? []).map((c, colIndex) => {
                          const isSortable = true;
                          const activeSort = leaderboardSortColumn === c;
                          const label = page === 'Leaderboard' && colIndex === 0 ? (leaderboardViewBy === 'Team' ? 'Team' : 'Player') : c;
                          return (
                            <th
                              key={c}
                              style={{ textAlign: 'center', cursor: isSortable ? 'pointer' : 'default', position: page === 'Leaderboard' ? 'sticky' : undefined, top: page === 'Leaderboard' ? 0 : undefined, zIndex: page === 'Leaderboard' ? 3 : undefined, background: page === 'Leaderboard' ? ((typeof document !== 'undefined' && document.body.classList.contains('theme-light')) ? 'rgba(248,250,252,0.98)' : 'rgba(7,9,14,0.98)') : undefined }}
                              onClick={
                                isSortable
                                  ? () => {
                                      if (leaderboardSortColumn === c) {
                                        setLeaderboardSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                                      } else {
                                        setLeaderboardSortColumn(c);
                                        setLeaderboardSortDirection(page === 'Leaderboard' && colIndex > 0 ? 'desc' : 'asc');
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
                        return leaderboardRowsWithPins.map((row, idx) => {
                          const isAllRow = page === 'Leaderboard' && String(row[(overview?.table_columns ?? [])[0] ?? ''] ?? '').trim().toLowerCase() === 'all';
                          const isPinnedAllRow = page === 'Leaderboard' && String(row[(overview?.table_columns ?? [])[0] ?? ''] ?? '').trim().toLowerCase() === 'all (pinned)';
                          const rankValue = isAllRow || isPinnedAllRow ? '' : String(++leaderboardRankCounter);
                          return (
                        <tr key={`catch-row-${idx}`} style={isAllRow || isPinnedAllRow ? { background: 'rgba(255,255,255,0.12)', fontWeight: 700 } : undefined}>
                          {page === 'Leaderboard' ? <td style={{ textAlign: 'center' }}>{rankValue}</td> : null}
                          {(overview?.table_columns ?? []).map((c, colIndex) => {
                            const val = row[c];
                            const displayVal =
                              page === 'Leaderboard' && colIndex === 0 && typeof val === 'string'
                                ? (() => {
                                    const formatted = formatNameFirstLast(val);
                                    if (leaderboardViewBy !== 'Player') return formatted;
                                    const key = String(val).trim();
                                    const keyNorm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
                                    const formattedNorm = formatted.toLowerCase().replace(/[^a-z0-9]/g, '');
                                    const teamCode =
                                      latestTeamByCatcher[key] ??
                                      latestTeamByCatcher[keyNorm] ??
                                      latestTeamByCatcher[formatted] ??
                                      latestTeamByCatcher[formattedNorm] ??
                                      filterTeamByCatcher[key] ??
                                      filterTeamByCatcher[keyNorm] ??
                                      filterTeamByCatcher[formatted] ??
                                      filterTeamByCatcher[formattedNorm];
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
                                : val;
                            const renderedValue =
                              typeof displayVal === 'string' || typeof displayVal === 'number' || displayVal === null || displayVal === undefined
                                ? formatTableDisplayValue(c, displayVal)
                                : displayVal;
                            return (
                              <td
                                key={`${idx}-${c}`}
                                style={{
                                  textAlign:
                                    page === 'Leaderboard' && leaderboardViewBy === 'Player' && colIndex === 0
                                      ? (isAllRow ? 'center' : 'left')
                                      : 'center',
                                }}
                              >
                                {(() => {
                                  const canPinRow = page === 'Leaderboard' && colIndex === 0 && !isAllRow && !isPinnedAllRow;
                                  const pinKey = canPinRow
                                    ? pinKeyFromRow(
                                        row as Record<string, string | number | null | undefined>,
                                        (overview?.table_columns ?? [])[0] ?? ''
                                      )
                                    : '';
                                  const isPinnedRow = canPinRow && pinnedLeaderboardKeys.has(pinKey);
                                  const content = displayVal === null || displayVal === undefined ? '-' : renderedValue;
                                  if (!canPinRow) return content;
                                  return (
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
                                      <span>{content}</span>
                                    </span>
                                  );
                                })()}
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
                </div>
              </article>
            ) : null}

            {page === 'HeatMaps' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 14 }}>
                <aside className="portal-day-card portal-ab-sidebar">
                  <label>
                    Chart Type
                    <SearchableSingleSelect
                      options={[
                        { value: 'Heat', label: 'Heat' },
                        { value: 'Pitch', label: 'Pitch' },
                      ]}
                      value={hmChartType}
                      onChange={(next) => setHmChartType(next as 'Heat' | 'Pitch')}
                      placeholder="Pitch"
                    />
                  </label>
                  <label style={{ marginTop: 10 }}>
                    Stat
                    <SearchableSingleSelect options={heatmapStatOptions} value={hmStat} onChange={setHmStat} placeholder="Frequency" />
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
                          <span style={{ width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                              {row.kind === 'called_strike' ? <circle cx="7" cy="7" r="4" fill="#fff" /> : null}
                              {row.kind === 'ball' ? <circle cx="7" cy="7" r="4" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                              {row.kind === 'foul' ? <polygon points="7,2 12,11 2,11" fill="none" stroke="#fff" strokeWidth="1.8" /> : null}
                              {row.kind === 'whiff' ? <polygon points="7,1.5 8.7,5.2 12.8,5.2 9.5,7.6 10.8,11.8 7,9.3 3.2,11.8 4.5,7.6 1.2,5.2 5.3,5.2" fill="#fff" /> : null}
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
                      {['Fastball', 'Sinker', 'Cutter', 'Slider', 'Sweeper', 'Curveball', 'ChangeUp', 'Splitter', 'Knuckleball', 'Undefined'].map((pt) => (
                        <span key={`hm-legend-${pt}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                          <span style={{ width: 12, height: 12, borderRadius: 2, background: PITCH_COLORS[pt] ?? '#9ca3af', border: '1px solid rgba(255,255,255,0.4)' }} />
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
                  <svg viewBox="0 0 560 460" style={{ width: '100%', height: 460, border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10 }} onMouseLeave={() => setHmHover(null)}>
                    {(() => {
                      const w = 560;
                      const h = 460;
                      const xMin = -2.5;
                      const xMax = 2.5;
                      const yMin = 0;
                      const yMax = 4.5;
                      const pad = 16;
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
                      const values = heatCells.map((c) => c.value).sort((a, b) => a - b);
                      const densityMax = Math.max(1e-9, ...heatCells.map((c) => c.density));
                      const dynamicMinVal = values.length ? values[0] : 0;
                      const dynamicMaxVal = values.length ? values[values.length - 1] : 1;
                      const dynamicMidVal = values.length ? values[Math.floor(values.length / 2)] : 0;
                      const minVal = heatmapDisplayView === 'Whiff Rate' ? 0 : dynamicMinVal;
                      const maxVal = heatmapDisplayView === 'Whiff Rate' ? 50 : dynamicMaxVal;
                      const midVal = heatmapDisplayView === 'Whiff Rate' ? 25 : dynamicMidVal;
                      const maxAbs = Math.max(1, ...heatCells.map((c) => Math.abs(c.value)));

                      return (
                        <>
                          <defs>
                            <clipPath id="catching-heat-clip">
                              <rect x={0} y={0} width={w} height={h} />
                            </clipPath>
                            <filter id="catching-heat-blur" x="-20%" y="-20%" width="140%" height="140%">
                              <feGaussianBlur stdDeviation="2.1" />
                            </filter>
                            <filter id="catching-heat-blur-rv" x="-20%" y="-20%" width="140%" height="140%">
                              <feGaussianBlur stdDeviation="1.25" />
                            </filter>
                          </defs>
                          <g transform={zoomTransform} clipPath="url(#catching-heat-clip)">
                            {heatmapDisplayView !== 'Pitch' ? (
                              <>
                                <g filter={heatmapDisplayView === 'Run Values' ? 'url(#catching-heat-blur-rv)' : 'url(#catching-heat-blur)'}>
                                  {heatCells.map((c) => {
                                    const cx = px(c.x + c.w / 2);
                                    const cy = py(c.y + c.h / 2);
                                    const radius = Math.max(2.8, c.w * scale * 2.05);
                                    const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                                    let fill = 'rgba(255,255,255,0.12)';
                                    if (heatmapDisplayView === 'Frequency') fill = sequentialColor(c.value, minVal, maxVal);
                                    else if (heatmapDisplayView === 'Run Values') {
                                      const ratio = c.value / maxAbs;
                                      fill = ratio >= 0 ? `rgba(255,48,48,${0.24 + Math.abs(ratio) * 0.76})` : `rgba(54,129,255,${0.24 + Math.abs(ratio) * 0.76})`;
                                    } else fill = divergingColor(c.value, minVal, midVal, maxVal);
                                    const normalized =
                                      heatmapDisplayView === 'Run Values'
                                        ? Math.abs(c.value) / maxAbs
                                        : Math.max(0, (c.value - minVal) / Math.max(1e-9, maxVal - minVal));
                                    const runValueBoost = heatmapDisplayView === 'Run Values' ? Math.pow(normalized, 0.55) : normalized;
                                    if (heatmapDisplayView !== 'Frequency' && densityNorm < 0.03) return null;
                                    if (heatmapDisplayView !== 'Run Values' && normalized < 0.06) return null;
                                    return <circle key={`catching-heat-blur-${c.x}-${c.y}`} cx={cx} cy={cy} r={radius} fill={fill} opacity={Math.max(0.3, runValueBoost * 1.25 * (heatmapDisplayView === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))} />;
                                  })}
                                </g>
                                {heatCells.map((c) => {
                                  const cx = px(c.x + c.w / 2);
                                  const cy = py(c.y + c.h / 2);
                                  const radius = Math.max(1.4, c.w * scale * 1.08);
                                  const densityNorm = Math.max(0, Math.min(1, c.density / densityMax));
                                  let fill = 'rgba(255,255,255,0.12)';
                                  if (heatmapDisplayView === 'Frequency') fill = sequentialColor(c.value, minVal, maxVal);
                                  else if (heatmapDisplayView === 'Run Values') {
                                    const ratio = c.value / maxAbs;
                                    fill = ratio >= 0 ? `rgba(255,48,48,${0.2 + Math.abs(ratio) * 0.8})` : `rgba(54,129,255,${0.2 + Math.abs(ratio) * 0.8})`;
                                  } else fill = divergingColor(c.value, minVal, midVal, maxVal);
                                  const normalized =
                                    heatmapDisplayView === 'Run Values'
                                      ? Math.abs(c.value) / maxAbs
                                      : Math.max(0, (c.value - minVal) / Math.max(1e-9, maxVal - minVal));
                                  const runValueBoost = heatmapDisplayView === 'Run Values' ? Math.pow(normalized, 0.55) : normalized;
                                  if (heatmapDisplayView !== 'Frequency' && densityNorm < 0.03) return null;
                                  if (heatmapDisplayView !== 'Run Values' && normalized < 0.06) return null;
                                  return (
                                    <circle
                                      key={`catching-heat-core-${c.x}-${c.y}`}
                                      cx={cx}
                                      cy={cy}
                                      r={radius}
                                      fill={fill}
                                      opacity={Math.max(0.2, runValueBoost * 0.72 * (heatmapDisplayView === 'Frequency' ? 1 : Math.max(0.55, densityNorm)))}
                                      onMouseMove={(event) =>
                                        setHmHover({
                                          x: event.clientX,
                                          y: event.clientY,
                                          text: `${heatmapDisplayView}: ${c.value.toFixed(heatmapDisplayView === 'Run Values' || heatmapDisplayView === 'Exit Velocity' ? 2 : 1)}`,
                                        })
                                      }
                                      onMouseLeave={() => setHmHover(null)}
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
                            <line x1={px(strikeLeft + (strikeRight - strikeLeft) / 3)} y1={py(strikeBottom)} x2={px(strikeLeft + (strikeRight - strikeLeft) / 3)} y2={py(strikeTop)} stroke="rgba(255,255,255,0.45)" />
                            <line x1={px(strikeLeft + (2 * (strikeRight - strikeLeft)) / 3)} y1={py(strikeBottom)} x2={px(strikeLeft + (2 * (strikeRight - strikeLeft)) / 3)} y2={py(strikeTop)} stroke="rgba(255,255,255,0.45)" />
                            <line x1={px(strikeLeft)} y1={py(strikeBottom + (strikeTop - strikeBottom) / 3)} x2={px(strikeRight)} y2={py(strikeBottom + (strikeTop - strikeBottom) / 3)} stroke="rgba(255,255,255,0.45)" />
                            <line x1={px(strikeLeft)} y1={py(strikeBottom + (2 * (strikeTop - strikeBottom)) / 3)} x2={px(strikeRight)} y2={py(strikeBottom + (2 * (strikeTop - strikeBottom)) / 3)} stroke="rgba(255,255,255,0.45)" />
                            {heatmapDisplayView === 'Pitch'
                              ? summaryPoints
                                  .filter((p) => p.plate_side !== null && p.plate_height !== null)
                                  .map((p, i) => {
                                    const x = px(Number(p.plate_side));
                                    const y = py(Number(p.plate_height));
                                    const res = pitchResultLabel(p);
                                    const resultText = pitchResultDetailLabel(p);
                                    const shape = RESULT_SHAPES[res] ?? 'ring';
                                    const color = PITCH_COLORS[p.pitch_type] ?? PITCH_COLORS.Undefined;
                                    const hoverText = `Session: ${p.session_type || '-'}\nPitch Type: ${p.pitch_type || 'Undefined'}\nResult: ${resultText}\nVelo: ${fmtNum(p.rel_speed, 1)} mph\nEV: ${fmtNum(p.exit_speed, 1)} mph\nLA: ${fmtNum(p.angle, 1)}°\nPlate: ${fmtNum(parseNumber(p.plate_side), 2)}, ${fmtNum(parseNumber(p.plate_height), 2)}`;
                                    return (
                                      <g
                                        key={`catching-pitch-${i}`}
                                        onMouseMove={(event) => setHmHover({ x: event.clientX, y: event.clientY, text: hoverText, bg: color })}
                                        onMouseLeave={() => setHmHover(null)}
                                      >
                                        {markerShape(shape, x, y, color, `catching-pitch-shape-${i}`)}
                                      </g>
                                    );
                                  })
                              : null}
                          </g>
                        </>
                      );
                    })()}
                  </svg>
                  {hmHover ? (
                    <div
                      style={{
                        position: 'fixed',
                        left: hmHover.x + 12,
                        top: hmHover.y + 12,
                        background: hmHover.bg || 'rgba(15,23,42,0.98)',
                        color: pitchHoverTextColor(hmHover.bg),
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: 8,
                        padding: '0.5rem 0.65rem',
                        fontSize: '0.78rem',
                        lineHeight: 1.35,
                        whiteSpace: 'pre-line',
                        zIndex: 1000,
                        pointerEvents: 'none',
                      }}
                    >
                      {hmHover.text}
                    </div>
                  ) : null}
                </article>
              </div>
            ) : null}
          </article>
      </div>
      {showLeaderboardCorrelation && isLeaderboardPage ? (
        <LeaderboardCorrelationModal
          open
          onClose={() => setShowLeaderboardCorrelation(false)}
          title="Catching Leaderboard Correlation"
          columns={overview?.table_columns ?? []}
          axisColumns={availableCustomColumns}
          rows={leaderboardRowsWithPins}
          viewByLabel={leaderboardViewBy}
          primaryColumnName={(overview?.table_columns ?? [])[0] ?? ''}
          siteLogoSrc={activeSchoolBrand.logoSrc ?? '/pearl-clam-transparent.png'}
          siteLogoAlt={activeSchoolBrand.logoAlt}
        />
      ) : null}
    </section>
  );
}

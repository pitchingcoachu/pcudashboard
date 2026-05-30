'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { sortTableRows, type SortDirection } from '../../../lib/table-sort';
import LeaderboardCorrelationModal from './leaderboard-correlation-modal';

type Role = 'admin' | 'coach' | 'player';
type ViewMode = 'Force' | 'Moments';
type ForceMode = 'force' | 'bw';
type BiomechPageTab = 'summary' | 'leaderboard';
type LeaderboardViewMode = 'individual' | 'averages';
type OptionItem = { value: string; label: string };

type PitchOption = {
  pitchKey: string;
  label: string;
  capturedAt: string | null;
  velocityMph?: number | null;
  pitchType?: string | null;
};

type PitchPoint = {
  t: number;
  fx: number | null;
  fy: number | null;
  fz: number | null;
  mx: number | null;
  my: number | null;
  mz: number | null;
  phase_name?: string | null;
  device_id?: string | null;
  position_id?: string | null;
};

type Payload = {
  table_columns?: string[];
  table_rows?: Array<Record<string, string | number | null>>;
  leaderboard_individual_columns?: string[];
  leaderboard_individual_rows?: Array<Record<string, string | number | null>>;
  leaderboard_average_columns?: string[];
  leaderboard_average_rows?: Array<Record<string, string | number | null>>;
  pitch_options?: PitchOption[];
  selected_pitch_key?: string | null;
  selected_pitch_points?: PitchPoint[];
  pitcher_options?: string[];
  tags_options?: string[];
  pitch_type_options?: string[];
  selected_pitch_tags?: string | null;
  selected_pitch_type?: string | null;
  selected_pitch_player?: string | null;
  selected_pitch_date?: string | null;
  selected_pitch_velocity_mph?: number | null;
  pitch_velocity_by_key?: Record<string, number | null>;
  selected_pitch_body_weight_lb?: number | null;
  selected_pitch_stride_length_in?: number | null;
  selected_pitch_stride_direction_in?: number | null;
  all_sessions_leaderboard_individual_rows?: Array<Record<string, string | number | null>>;
  applied_start_date?: string | null;
  applied_end_date?: string | null;
  match_summary?: {
    totalSinglePitchFiles?: number;
    matchedSinglePitchFiles?: number;
    unmatchedSinglePitchFiles?: number;
    totalAllPitchRows?: number;
    matchedAllPitchRows?: number;
    unmatchedAllPitchRows?: number;
  };
  error?: string;
  debug?: {
    candidate_org_ids?: number[];
    selected_org_id?: number;
    applied_start_date?: string | null;
    applied_end_date?: string | null;
    table_rows_count?: number;
    pitch_options_count?: number;
  };
};

const BIOMECH_TABLE_COLUMNS = [
  'Name',
  'Date',
  '#',
  'Pitch Type',
  'Tags',
  'Pitch Velocity (mph)',
  'Back Leg Peak Fz (lb)',
  'Back Leg Peak Fy (lb)',
  'Mound Connection (BW%)',
  'Back Leg Impulse (lb·s)',
  'Back Leg Impulse Time (s)',
  'Back Leg YZ Transfer (s)',
  'Lead Leg Peak Fz (lb)',
  'Lead Leg Peak Fy (lb)',
  'Lead Leg Clawback (s)',
  'Lead Leg YZ Transfer (s)',
  'Y Transfer (s)',
  'Z Transfer (s)',
  'Stride Length (in)',
  'Stride Direction (in)',
] as const;

const EXCLUDED_SINGLE_PLAYER_TAGS = new Set([
  'untagged',
  '5oz',
  'fastball',
  'sinker',
  'cutter',
  'curveball',
  'slider',
  'sweeper',
  'splitter',
  'changeup',
]);

const PITCH_TYPE_ORDER = [
  'Fastball',
  'Sinker',
  'Cutter',
  'Slider',
  'Sweeper',
  'Curveball',
  'ChangeUp',
  'Splitter',
  'Knuckleball',
] as const;
const PITCH_TYPE_COLOR: Record<string, string> = {
  Fastball: 'var(--portal-fastball-color)',
  Sinker: 'orange',
  Cutter: 'brown',
  Slider: 'red',
  Sweeper: 'purple',
  Curveball: 'blue',
  ChangeUp: 'darkgreen',
  Splitter: 'turquoise',
  Knuckleball: '#6b7280',
};

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function toFinite(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFirstLastName(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',');
  return `${rest.join(' ').trim()} ${last.trim()}`.replace(/\s+/g, ' ').trim();
}

function normalizeMulti(values: string[]): string[] {
  const unique = Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));
  if (unique.length === 0) return ['All'];
  if (unique.includes('All')) return ['All'];
  return unique;
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
        ? selectedLabels[0] ?? 'All'
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

function formatBiomechTableValue(column: string, value: string | number | null, forceMode: ForceMode): string {
  if (value === null || value === undefined || value === '') return '—';
  if (column === '#') {
    const n = toFinite(value);
    return n === null ? String(value) : String(Math.round(n));
  }
  const isMsTransferColumn =
    column.includes('Back Leg Impulse Time') ||
    column.includes('Back Leg YZ Transfer') ||
    column.includes('Lead Leg YZ Transfer') ||
    column === 'Y Transfer (s)' ||
    column === 'Z Transfer (s)';
  const isForceColumn = column.includes('Peak Fz') || column.includes('Peak Fy');
  const isImpulseColumn = column.includes('Impulse');
  const isMoundConnectionColumn = column.includes('Mound Connection');
  const isBwPercentColumn = isMoundConnectionColumn || (forceMode === 'bw' && (isForceColumn || isImpulseColumn));
  const useThreeDecimals =
    isBwPercentColumn
    ||
    column.includes('YZ Transfer')
    || column.includes('Clawback')
    || column.includes('Y Transfer')
    || column.includes('Z Transfer');
  const digits = useThreeDecimals ? 3 : 1;
  const formatBwPercent = (raw: number): string => {
    // Some rows are ratio-form (0.52 => 52%), others may already be percent-form (52 => 52%).
    // Normalize display to avoid accidental double scaling.
    const abs = Math.abs(raw);
    const percentValue = abs > 3 ? raw : raw * 100;
    return `${percentValue.toFixed(1)}%`;
  };
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (isMsTransferColumn) return (value * 1000).toFixed(1);
    if (isBwPercentColumn) return formatBwPercent(value);
    return value.toFixed(digits);
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && String(value).trim() !== '') {
    if (isMsTransferColumn) return (parsed * 1000).toFixed(1);
    if (isBwPercentColumn) return formatBwPercent(parsed);
    return parsed.toFixed(digits);
  }
  return String(value);
}

function formatPitchOptionLabel(option: PitchOption, allOptions: PitchOption[], velocityByKey?: Record<string, number | null>): string {
  const rawLabel = String(option.label ?? '').trim();
  const pitcher = toFirstLastName(rawLabel) || 'Unknown Pitcher';
  const currentTs = option.capturedAt ? new Date(option.capturedAt) : null;
  if (!currentTs || !Number.isFinite(currentTs.getTime())) return pitcher;

  const dateKey = currentTs.toISOString().slice(0, 10);
  const samePitcherDate = allOptions
    .map((candidate) => {
      const candidatePitcher = toFirstLastName(String(candidate.label ?? '').trim());
      if (candidatePitcher !== pitcher) return null;
      const d = candidate.capturedAt ? new Date(candidate.capturedAt) : null;
      if (!d || !Number.isFinite(d.getTime())) return null;
      if (d.toISOString().slice(0, 10) !== dateKey) return null;
      return { pitchKey: candidate.pitchKey, timeMs: d.getTime() };
    })
    .filter((v): v is { pitchKey: string; timeMs: number } => Boolean(v))
    .sort((a, b) => a.timeMs - b.timeMs);

  const pitchNum = Math.max(1, samePitcherDate.findIndex((v) => v.pitchKey === option.pitchKey) + 1);
  const mm = String(currentTs.getMonth() + 1).padStart(2, '0');
  const dd = String(currentTs.getDate()).padStart(2, '0');
  const yy = String(currentTs.getFullYear() % 100).padStart(2, '0');
  const fromMap = velocityByKey ? velocityByKey[option.pitchKey] : null;
  const veloNum = typeof fromMap === 'number' && Number.isFinite(fromMap)
    ? fromMap
    : (typeof option.velocityMph === 'number' && Number.isFinite(option.velocityMph) ? option.velocityMph : null);
  const pitchType = String(option.pitchType ?? '').trim();
  const velo = veloNum !== null ? `${veloNum.toFixed(1)} mph` : '— mph';
  const pitchDetails = pitchType ? `${pitchType} | ${velo}` : velo;
  return `${pitcher} | ${mm}/${dd}/${yy} | Pitch #${pitchNum} | ${pitchDetails}`;
}

function LineChart({
  points,
  mode,
  forceMode,
  pitchVelocityMph,
  pitchType,
  bodyWeightLb,
  strideLengthIn,
  strideDirectionIn,
}: {
  points: PitchPoint[];
  mode: ViewMode;
  forceMode: ForceMode;
  pitchVelocityMph: number | null;
  pitchType: string | null;
  bodyWeightLb: number | null;
  strideLengthIn: number | null;
  strideDirectionIn: number | null;
}) {
  const roundAxisBound = (value: number, direction: 'up' | 'down') => {
    const isBwForceView = mode === 'Force' && forceMode === 'bw';
    if (isBwForceView) {
      const abs = Math.abs(value);
      const step = abs >= 3 ? 1 : abs >= 1 ? 0.5 : 0.25;
      if (direction === 'up') return Math.ceil(value / step) * step;
      return Math.floor(value / step) * step;
    }
    const abs = Math.abs(value);
    const step = abs >= 250 ? 100 : 50;
    if (direction === 'up') return Math.ceil(value / step) * step;
    return Math.floor(value / step) * step;
  };
  const [hoverClientX, setHoverClientX] = useState<number | null>(null);
  const metrics = mode === 'Force'
    ? [
        { key: 'fx', label: 'Fx' },
        { key: 'fy', label: 'Fy' },
        { key: 'fz', label: 'Fz' },
      ]
    : [
        { key: 'mx', label: 'Mx' },
        { key: 'my', label: 'My' },
        { key: 'mz', label: 'Mz' },
      ];
  const phaseStyles: Record<'loading' | 'delivery', Record<string, string>> = {
    loading: {
      fx: '#fca5a5',
      fy: '#bef264',
      fz: '#93c5fd',
      mx: '#fca5a5',
      my: '#bef264',
      mz: '#93c5fd',
    },
    delivery: {
      fx: '#ef4444',
      fy: '#84cc16',
      fz: '#2563eb',
      mx: '#ef4444',
      my: '#84cc16',
      mz: '#2563eb',
    },
  };
  const isMoundDevice = (value: string) => {
    const normalized = value.toLowerCase();
    return normalized.includes('pitching mound.drive') || normalized.includes('pitching mound.parent');
  };
  const isParentDevice = (value: string) => value.toLowerCase().includes('pitching mound.parent');
  const isDriveDevice = (value: string) => value.toLowerCase().includes('pitching mound.drive');
  const normalizePhase = (value: string | null | undefined): 'loading' | 'delivery' | null => {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'loading') return 'loading';
    if (normalized === 'delivery') return 'delivery';
    return null;
  };
  const phaseDisplayLabel = (phase: 'loading' | 'delivery' | null | undefined) => {
    if (phase === 'loading') return 'Back Leg';
    if (phase === 'delivery') return 'Lead Leg';
    return '';
  };

  const chartPoints = useMemo(() => {
    if (!points.length) return [] as PitchPoint[];
    const moundPoints = points.filter((point) => {
      const phase = normalizePhase(point.phase_name);
      if (!phase) return false;
      const deviceSource = String(point.device_id ?? '').trim();
      return isMoundDevice(deviceSource);
    });
    const hasParent = moundPoints.some((point) => isParentDevice(String(point.device_id ?? '').trim()));
    const sourcePoints = moundPoints.filter((point) => {
      const deviceSource = String(point.device_id ?? '').trim();
      if (hasParent) return isParentDevice(deviceSource);
      return isDriveDevice(deviceSource);
    });
    const rawTimes = sourcePoints.map((p) => toFinite(p.t)).filter((v): v is number => v !== null);
    if (!rawTimes.length) return [] as PitchPoint[];
    const minRawTime = Math.min(...rawTimes);
    const maxRawTime = Math.max(...rawTimes);
    const rawRange = maxRawTime - minRawTime;
    const treatAsMs = rawRange > 1000 || minRawTime > 100000;
    const toSeconds = (t: number) => (treatAsMs ? (t - minRawTime) / 1000 : t - minRawTime);
    const byPhaseAndTime = new Map<string, { t: number; phase_name: 'loading' | 'delivery'; fx: number[]; fy: number[]; fz: number[]; mx: number[]; my: number[]; mz: number[] }>();
    for (const point of sourcePoints) {
      const t = toFinite(point.t);
      if (t === null) continue;
      const phase = normalizePhase(point.phase_name);
      if (!phase) continue;
      const normalizedTime = Number(toSeconds(t).toFixed(4));
      const key = `${phase}:${normalizedTime}`;
      const bucket = byPhaseAndTime.get(key) ?? { t: normalizedTime, phase_name: phase, fx: [], fy: [], fz: [], mx: [], my: [], mz: [] };
      const fx = toFinite(point.fx);
      const fy = toFinite(point.fy);
      const fz = toFinite(point.fz);
      const mx = toFinite(point.mx);
      const my = toFinite(point.my);
      const mz = toFinite(point.mz);
      if (fx !== null) bucket.fx.push(fx);
      if (fy !== null) bucket.fy.push(fy);
      if (fz !== null) bucket.fz.push(fz);
      if (mx !== null) bucket.mx.push(mx);
      if (my !== null) bucket.my.push(my);
      if (mz !== null) bucket.mz.push(mz);
      byPhaseAndTime.set(key, bucket);
    }
    const averaged = Array.from(byPhaseAndTime.values())
      .sort((a, b) => a.t - b.t)
      .map((bucket) => {
        const avg = (values: number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);
        const forceScale = mode === 'Force' && forceMode === 'bw' && bodyWeightLb && bodyWeightLb > 0 ? bodyWeightLb : null;
        const scaleForce = (value: number | null) => (forceScale ? (value === null ? null : value / forceScale) : value);
        return {
          t: bucket.t,
          fx: scaleForce(avg(bucket.fx)),
          fy: scaleForce(avg(bucket.fy)),
          fz: scaleForce(avg(bucket.fz)),
          mx: avg(bucket.mx),
          my: avg(bucket.my),
          mz: avg(bucket.mz),
          phase_name: bucket.phase_name,
        };
      });
    const maxPoints = 1400;
    if (averaged.length <= maxPoints) return averaged as PitchPoint[];
    const step = averaged.length / maxPoints;
    const sampled: PitchPoint[] = [];
    for (let i = 0; i < maxPoints; i += 1) {
      sampled.push(averaged[Math.min(averaged.length - 1, Math.floor(i * step))] as PitchPoint);
    }
    return sampled;
  }, [bodyWeightLb, forceMode, mode, points]);

  const domain = useMemo(() => {
    if (!chartPoints.length) return null;
    const xs = chartPoints.map((p) => toFinite(p.t)).filter((v): v is number => v !== null);
    const ys: number[] = [];
    for (const point of chartPoints) {
      for (const metric of metrics) {
        const raw = (point as Record<string, unknown>)[metric.key];
        const value = toFinite(raw);
        if (value !== null) ys.push(value);
      }
    }
    if (!xs.length || !ys.length) return null;
    let minY = Math.min(...ys, 0);
    let maxY = Math.max(...ys, 0);
    minY = roundAxisBound(minY, 'down');
    maxY = roundAxisBound(maxY, 'up');
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY,
      maxY,
    };
  }, [chartPoints, metrics]);

  const transitionX = useMemo(() => {
    const loadingTimes = chartPoints
      .filter((point) => normalizePhase(point.phase_name) === 'loading')
      .map((point) => toFinite(point.t))
      .filter((v): v is number => v !== null);
    const deliveryTimes = chartPoints
      .filter((point) => normalizePhase(point.phase_name) === 'delivery')
      .map((point) => toFinite(point.t))
      .filter((v): v is number => v !== null);
    if (!loadingTimes.length || !deliveryTimes.length) return null;
    const lastLoading = Math.max(...loadingTimes);
    const firstDelivery = Math.min(...deliveryTimes);
    return (lastLoading + firstDelivery) / 2;
  }, [chartPoints]);

  const width = 860;
  const height = 520;
  const pad = { left: 54, right: 20, top: 16, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const minX = domain?.minX ?? 0;
  const maxX = domain?.maxX ?? 1;
  const minY = domain?.minY ?? -1;
  const maxY = domain?.maxY ?? 1;
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;

  const x = (v: number) => pad.left + ((v - minX) / dx) * plotW;
  const y = (v: number) => pad.top + (1 - (v - minY) / dy) * plotH;
  const formatYAxisTick = (value: number) => {
    if (mode === 'Force' && forceMode === 'bw') return (value * 100).toFixed(1);
    return value.toFixed(1);
  };

  const paths = (['loading', 'delivery'] as const).flatMap((phase) =>
    metrics.map((metric) => {
      let hasStarted = false;
      const d = chartPoints
        .map((point) => {
          const pointPhase = normalizePhase(point.phase_name);
          if (pointPhase !== phase) {
            hasStarted = false;
            return null;
          }
          const xv = toFinite(point.t);
          const yv = toFinite((point as Record<string, unknown>)[metric.key]);
          if (xv === null || yv === null) {
            hasStarted = false;
            return null;
          }
          const cmd = hasStarted ? 'L' : 'M';
          hasStarted = true;
          return `${cmd} ${x(xv).toFixed(2)} ${y(yv).toFixed(2)}`;
        })
        .filter(Boolean)
        .join(' ');
      return {
        ...metric,
        phase,
        color: phaseStyles[phase][metric.key] ?? '#e2e8f0',
        d,
      };
    })
  );
  const hoverPayload = useMemo(() => {
    if (!domain || hoverClientX === null || !chartPoints.length) return null;
    const tHover = minX + ((hoverClientX - pad.left) / plotW) * dx;
    let closest: PitchPoint | null = null;
    let closestDelta = Number.POSITIVE_INFINITY;
    for (const point of chartPoints) {
      const t = toFinite(point.t);
      if (t === null) continue;
      const delta = Math.abs(t - tHover);
      if (delta < closestDelta) {
        closest = point;
        closestDelta = delta;
      }
    }
    if (!closest) return null;
    const t = toFinite(closest.t);
    if (t === null) return null;
    const phase = normalizePhase(closest.phase_name);
    const metricsAtPoint = metrics.map((metric) => {
      const key = metric.key;
      const value = toFinite((closest as Record<string, unknown>)[key]);
      const color = phase ? (phaseStyles[phase][key] ?? '#e2e8f0') : '#e2e8f0';
      return { key, label: metric.label, value, color };
    });
    return {
      t,
      xPx: x(t),
      phase,
      metrics: metricsAtPoint,
    };
  }, [chartPoints, domain, dx, hoverClientX, metrics, minX, plotW]);
  const yTicks = useMemo(() => {
    if (!domain) return [] as number[];
    const isBwForceView = mode === 'Force' && forceMode === 'bw';
    const tickStep = isBwForceView
      ? (Math.max(Math.abs(domain.minY), Math.abs(domain.maxY)) >= 3 ? 1 : Math.max(Math.abs(domain.minY), Math.abs(domain.maxY)) >= 1 ? 0.5 : 0.25)
      : 50;
    const start = Math.ceil(domain.minY / tickStep) * tickStep;
    const end = Math.floor(domain.maxY / tickStep) * tickStep;
    const ticks: number[] = [];
    for (let v = start; v <= end; v += tickStep) ticks.push(Number(v.toFixed(6)));
    if (!ticks.includes(0)) ticks.push(0);
    return Array.from(new Set(ticks)).sort((a, b) => b - a);
  }, [domain, forceMode, mode]);

  const keyMetrics = useMemo(() => {
    const loading = chartPoints
      .filter((point) => normalizePhase(point.phase_name) === 'loading')
      .map((point) => ({ t: toFinite(point.t), fy: toFinite(point.fy), fz: toFinite(point.fz) }))
      .filter((p): p is { t: number; fy: number | null; fz: number | null } => p.t !== null)
      .sort((a, b) => a.t - b.t);
    const delivery = chartPoints
      .filter((point) => normalizePhase(point.phase_name) === 'delivery')
      .map((point) => ({ t: toFinite(point.t), fy: toFinite(point.fy), fz: toFinite(point.fz) }))
      .filter((p): p is { t: number; fy: number | null; fz: number | null } => p.t !== null)
      .sort((a, b) => a.t - b.t);

    const maxBy = (arr: Array<{ t: number; v: number | null }>) => arr.filter((r) => r.v !== null).reduce<{ t: number; v: number } | null>((best, row) => {
      if (row.v === null) return best;
      if (!best || row.v > best.v) return { t: row.t, v: row.v };
      return best;
    }, null);
    const minBy = (arr: Array<{ t: number; v: number | null }>) => arr.filter((r) => r.v !== null).reduce<{ t: number; v: number } | null>((best, row) => {
      if (row.v === null) return best;
      if (!best || row.v < best.v) return { t: row.t, v: row.v };
      return best;
    }, null);
    const integrateTrapezoid = (arr: Array<{ t: number; v: number }>) => {
      if (arr.length < 2) return 0;
      let area = 0;
      for (let i = 0; i < arr.length - 1; i += 1) {
        const a = arr[i];
        const b = arr[i + 1];
        const dt = Math.max(0, b.t - a.t);
        area += ((a.v + b.v) / 2) * dt;
      }
      return area;
    };

    const backPeakFz = maxBy(loading.map((p) => ({ t: p.t, v: p.fz })));
    const backPeakFy = maxBy(loading.map((p) => ({ t: p.t, v: p.fy })));
    const leadPeakFz = maxBy(delivery.map((p) => ({ t: p.t, v: p.fz })));
    const leadPeakFy = minBy(delivery.map((p) => ({ t: p.t, v: p.fy })));
    const firstLeadFz = delivery.find((p) => p.fz !== null);
    const backFzBeforeLead = firstLeadFz
      ? loading.filter((p) => p.fz !== null && p.t <= firstLeadFz.t).sort((a, b) => a.t - b.t).at(-1)?.fz ?? null
      : null;
    const forcesAlreadyScaledToBw = mode === 'Force' && forceMode === 'bw';
    const moundConnection =
      backFzBeforeLead === null
        ? null
        : (forcesAlreadyScaledToBw
          ? backFzBeforeLead
          : (bodyWeightLb && bodyWeightLb > 0 ? backFzBeforeLead / bodyWeightLb : null));

    let impulse: number | null = null;
    let impulseStartT: number | null = null;
    let impulseEndT: number | null = null;
    if (loading.length > 2) {
      // Start logic:
      // Use the lowest Back Leg Fz in the final pre-peak window
      // (captures the major valley immediately before the ramp to peak).
      const peakFz = maxBy(loading.map((p) => ({ t: p.t, v: p.fz })));
      const peakZIdx = peakFz ? loading.findIndex((p) => p.t === peakFz.t && p.fz === peakFz.v) : -1;
      let startIdx = -1;
      if (peakZIdx > 1 && peakFz) {
        const peakTime = peakFz.t;
        const prePeakWindowSeconds = 0.7;
        const windowStartTime = peakTime - prePeakWindowSeconds;
        const candidates: number[] = [];
        for (let i = 0; i < peakZIdx; i += 1) {
          const t = loading[i]?.t;
          if (t === undefined) continue;
          if (t >= windowStartTime) candidates.push(i);
        }
        if (candidates.length) {
          let minIdx = candidates[0] ?? 0;
          for (const idx of candidates) {
            const curr = loading[idx]?.fz;
            const best = loading[minIdx]?.fz;
            if (curr === null || curr === undefined) continue;
            if (best === null || best === undefined || curr < best) minIdx = idx;
          }
          startIdx = minIdx;
        } else {
          // Fallback: lowest Fz before peak if window is empty.
          let minIdx = 0;
          for (let i = 1; i < peakZIdx; i += 1) {
            const curr = loading[i]?.fz;
            const best = loading[minIdx]?.fz;
            if (curr === null || curr === undefined) continue;
            if (best === null || best === undefined || curr < best) minIdx = i;
          }
          startIdx = minIdx;
        }
      }
      if (startIdx >= 0) {
        // Y-force duration window: from startIdx through first Fy <= 0 after Peak Fy.
        const loadingFromStart = loading.slice(startIdx);
        const peakFyFromStart = maxBy(loadingFromStart.map((p) => ({ t: p.t, v: p.fy })));
        let endIdx = loading.length - 1;
        if (peakFyFromStart) {
          const peakIdx = loading.findIndex((p) => p.t === peakFyFromStart.t && p.fy === peakFyFromStart.v);
          if (peakIdx >= 0) {
            for (let i = peakIdx + 1; i < loading.length; i += 1) {
              const fy = loading[i]?.fy;
              if (fy !== null && fy <= 0) {
                endIdx = i;
                break;
              }
            }
          }
        }
        const impulseWindow = loading
          .slice(startIdx, endIdx + 1)
          .filter((p) => p.fy !== null)
          .map((p) => ({ t: p.t, v: Math.max(0, Number(p.fy)) }));
        impulse = integrateTrapezoid(impulseWindow);
        impulseStartT = loading[startIdx]?.t ?? null;
        impulseEndT = loading[endIdx]?.t ?? null;
      }
    }

    let clawbackTime: number | null = null;
    const landingIdx = delivery.findIndex((p) => (p.fy ?? 0) < 0);
    if (landingIdx >= 0) {
      const postLanding = delivery.slice(landingIdx + 1);
      const recover = postLanding.find((p) => (p.fy ?? Number.NEGATIVE_INFINITY) >= 0);
      if (recover) clawbackTime = Math.max(0, recover.t - delivery[landingIdx].t);
    }

    const yzTransferBack = backPeakFy && backPeakFz ? Math.abs(backPeakFy.t - backPeakFz.t) : null;
    const yzTransferFront = leadPeakFy && leadPeakFz ? Math.abs(leadPeakFy.t - leadPeakFz.t) : null;
    const yTransfer = backPeakFy && leadPeakFy ? Math.abs(leadPeakFy.t - backPeakFy.t) : null;
    const zTransfer = backPeakFz && leadPeakFz ? Math.abs(leadPeakFz.t - backPeakFz.t) : null;

    return {
      backPeakFz: backPeakFz?.v ?? null,
      backPeakFy: backPeakFy?.v ?? null,
      moundConnection,
      impulse,
      impulseStartT,
      impulseEndT,
      yzTransferBack,
      leadPeakFz: leadPeakFz?.v ?? null,
      leadPeakFy: leadPeakFy?.v ?? null,
      clawbackTime,
      yzTransferFront,
      yTransfer,
      zTransfer,
    };
  }, [bodyWeightLb, chartPoints, forceMode, mode]);

  const fmt = (value: number | null, digits = 2) => (value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits));
  const fmtMs = (value: number | null, digits = 1) => (value === null || !Number.isFinite(value) ? '—' : (value * 1000).toFixed(digits));
  const fmtForceOrImpulse = (value: number | null, digits = 1) => {
    if (value === null || !Number.isFinite(value)) return '—';
    if (mode === 'Force' && forceMode === 'bw') return `${(value * 100).toFixed(1)}%`;
    return value.toFixed(digits);
  };
  const fmtBwPercent = (value: number | null) => (value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`);
  const fmtHoverMetric = (metricKey: string, value: number | null) => {
    if (value === null || !Number.isFinite(value)) return '—';
    const isForceMetric = metricKey === 'fx' || metricKey === 'fy' || metricKey === 'fz';
    if (mode === 'Force' && forceMode === 'bw' && isForceMetric) return (value * 100).toFixed(1);
    return value.toFixed(1);
  };
  const impulseAreaPath = useMemo(() => {
    if (!domain) return '';
    const startT = keyMetrics.impulseStartT;
    const endT = keyMetrics.impulseEndT;
    if (startT === null || endT === null || endT <= startT) return '';
    const areaPoints = chartPoints
      .filter((point) => {
        const phase = normalizePhase(point.phase_name);
        const t = toFinite(point.t);
        const fy = toFinite(point.fy);
        return phase === 'loading' && t !== null && fy !== null && t >= startT && t <= endT;
      })
      .map((point) => ({ t: Number(point.t), fy: Number(point.fy) }))
      .sort((a, b) => a.t - b.t);
    if (areaPoints.length < 2) return '';
    const top = areaPoints.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${x(p.t).toFixed(2)} ${y(p.fy).toFixed(2)}`).join(' ');
    const close = `L ${x(areaPoints[areaPoints.length - 1]!.t).toFixed(2)} ${y(0).toFixed(2)} L ${x(areaPoints[0]!.t).toFixed(2)} ${y(0).toFixed(2)} Z`;
    return `${top} ${close}`;
  }, [chartPoints, domain, keyMetrics.impulseEndT, keyMetrics.impulseStartT]);

  if (!domain) {
    return <p style={{ color: '#9ca3af', margin: 0 }}>No single-pitch data for this selection.</p>;
  }
  return (
    <>
    <div data-biomech-chart-row="true" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.95fr) minmax(0, 1.05fr)', gap: 12, position: 'relative', zIndex: 0, overflow: 'hidden', alignItems: 'stretch' }}>
      <div data-biomech-graph-panel="true" style={{ position: 'relative', marginTop: pad.top }}>
        <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', maxWidth: '100%', background: 'linear-gradient(165deg, rgba(8,8,10,0.96), rgba(24,24,28,0.9))', border: '1px solid rgba(200,16,46,0.28)', borderRadius: 12, overflow: 'hidden', display: 'block' }}
        onMouseLeave={() => setHoverClientX(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (!rect.width) return;
          const xPos = ((event.clientX - rect.left) / rect.width) * width;
          const clamped = Math.max(pad.left, Math.min(width - pad.right, xPos));
          setHoverClientX(clamped);
        }}
      >
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
        {yTicks.map((tick) => {
          const yy = y(tick);
          const value = formatYAxisTick(tick);
          return (
            <g key={`grid-y-${tick}`}>
              <line x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} stroke="rgba(148,163,184,0.18)" strokeWidth="1" />
              <text x={pad.left - 8} y={yy + 4} fill="#cbd5e1" fontSize="11" textAnchor="end">{value}</text>
            </g>
          );
        })}
        <line
          x1={pad.left}
          y1={y(0)}
          x2={width - pad.right}
          y2={y(0)}
          stroke="rgba(226,232,240,0.8)"
          strokeWidth="1.5"
        />
        <text x={pad.left - 8} y={y(0) + 4} fill="#e2e8f0" fontSize="11" textAnchor="end">0.0</text>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const xx = pad.left + step * plotW;
          const value = (minX + step * (maxX - minX)).toFixed(1);
          return (
            <g key={`x-grid-${step}`}>
              <line x1={xx} y1={pad.top} x2={xx} y2={height - pad.bottom} stroke="rgba(148,163,184,0.12)" strokeWidth="1" />
              <text x={xx} y={height - pad.bottom + 16} fill="#cbd5e1" fontSize="11" textAnchor="middle">{value}s</text>
            </g>
          );
        })}
        <text x={width / 2} y={height - 8} fill="#cbd5e1" fontSize="12" textAnchor="middle">Time (s)</text>
        <text x={14} y={height / 2} fill="#cbd5e1" fontSize="12" transform={`rotate(-90 14 ${height / 2})`} textAnchor="middle">
          {mode === 'Force' && forceMode === 'bw' ? 'BW%' : 'Force'}
        </text>
        {transitionX !== null ? (
          <line
            x1={x(transitionX)}
            y1={pad.top}
            x2={x(transitionX)}
            y2={height - pad.bottom}
            stroke="rgba(226,232,240,0.8)"
            strokeWidth="1.5"
          />
        ) : null}
        {impulseAreaPath ? (
          <path
            d={impulseAreaPath}
            fill="rgba(132, 204, 22, 0.24)"
            stroke="none"
          />
        ) : null}
        {paths.map((metric) => (
          <path key={`${metric.phase}-${metric.key}`} d={metric.d} fill="none" stroke={metric.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hoverPayload ? (
          <line
            x1={hoverPayload.xPx}
            y1={pad.top}
            x2={hoverPayload.xPx}
            y2={height - pad.bottom}
            stroke="rgba(255,255,255,0.66)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        ) : null}
        {hoverPayload
          ? hoverPayload.metrics.map((metric) => {
              if (metric.value === null) return null;
              return (
                <circle
                  key={`hover-${metric.key}`}
                  cx={hoverPayload.xPx}
                  cy={y(metric.value)}
                  r={4}
                  fill={metric.color}
                  stroke="#020617"
                  strokeWidth={1.5}
                />
              );
            })
          : null}
        </svg>
        {hoverPayload ? (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: Math.max(8, Math.min(hoverPayload.xPx - 70, width - 170)),
            pointerEvents: 'none',
            background: 'rgba(12, 12, 14, 0.94)',
            border: '1px solid rgba(200,16,46,0.34)',
            borderRadius: 10,
            padding: '8px 10px',
            minWidth: 150,
            display: 'grid',
            gap: 4,
            color: '#e2e8f0',
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 700, color: '#cbd5e1' }}>
            t: {hoverPayload.t.toFixed(3)}s{hoverPayload.phase ? ` • ${phaseDisplayLabel(hoverPayload.phase)}` : ''}
          </div>
          {hoverPayload.metrics.map((metric) => (
            <div key={`tooltip-${metric.key}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: metric.color }} />
              <span>{metric.label}: {fmtHoverMetric(metric.key, metric.value)}</span>
            </div>
          ))}
        </div>
        ) : null}
      </div>
      <aside data-biomech-metrics-panel="true" style={{ border: '1px solid rgba(200,16,46,0.36)', borderRadius: 14, padding: '8px 12px 12px', background: 'linear-gradient(165deg, rgba(8,8,10,0.96), rgba(24,24,28,0.9))', display: 'grid', gap: 10, height: `calc(100% - ${pad.top}px)`, minHeight: 0, overflowY: 'auto', marginTop: pad.top, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)', boxSizing: 'border-box' }}>
        <h4 style={{ margin: '-2px 0 0', textAlign: 'center', fontSize: 16, fontWeight: 700, color: '#e5e7eb' }}>Key Metrics</h4>
        <div style={{ marginTop: -8, textAlign: 'center', color: '#cbd5e1', fontSize: 14, lineHeight: 1.1 }}>
          {String(pitchType ?? '').trim() ? (
            <>
              <strong style={{ color: '#f8fafc' }}>{String(pitchType ?? '').trim()}</strong>
              <span> | </span>
            </>
          ) : null}
          <strong style={{ color: '#f8fafc' }}>
            {pitchVelocityMph !== null && Number.isFinite(pitchVelocityMph) ? `${pitchVelocityMph.toFixed(1)} mph` : '— mph'}
          </strong>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, alignItems: 'stretch' }}>
        <div style={{ display: 'grid', alignContent: 'start', gap: 5, fontSize: 12, padding: 10, borderRadius: 10, background: 'rgba(17,17,20,0.88)', border: '1px solid rgba(200,16,46,0.3)', height: '100%' }}>
          <strong style={{ textAlign: 'left', fontSize: 12, color: '#e2e8f0', letterSpacing: '0.02em' }}>Back Leg</strong>
          <span style={{ color: '#cbd5e1' }}>Peak Fz ({mode === 'Force' && forceMode === 'bw' ? 'BW%' : 'lb'}): <strong style={{ color: '#f8fafc' }}>{fmtForceOrImpulse(keyMetrics.backPeakFz, 1)}</strong></span>
          <span style={{ color: '#cbd5e1' }}>Peak Fy ({mode === 'Force' && forceMode === 'bw' ? 'BW%' : 'lb'}): <strong style={{ color: '#f8fafc' }}>{fmtForceOrImpulse(keyMetrics.backPeakFy, 1)}</strong></span>
          <span style={{ color: '#cbd5e1' }}>Mound Connection (BW%): <strong style={{ color: '#f8fafc' }}>{fmtBwPercent(keyMetrics.moundConnection)}</strong></span>
          <span style={{ color: '#cbd5e1' }}>Impulse ({mode === 'Force' && forceMode === 'bw' ? 'BW%·s' : 'lb·s'}): <strong style={{ color: '#f8fafc' }}>{fmtForceOrImpulse(keyMetrics.impulse, 1)}</strong></span>
          <span style={{ color: '#cbd5e1' }}>Impulse Time (ms): <strong style={{ color: '#f8fafc' }}>{keyMetrics.impulseStartT !== null && keyMetrics.impulseEndT !== null ? fmtMs(Math.max(0, keyMetrics.impulseEndT - keyMetrics.impulseStartT)) : '—'}</strong></span>
          <span style={{ color: '#cbd5e1' }}>YZ Transfer Back (ms): <strong style={{ color: '#f8fafc' }}>{fmtMs(keyMetrics.yzTransferBack)}</strong></span>
        </div>
        <div style={{ display: 'grid', alignContent: 'start', gap: 5, fontSize: 12, minWidth: 0, padding: 10, borderRadius: 10, background: 'rgba(17,17,20,0.88)', border: '1px solid rgba(200,16,46,0.3)', height: '100%' }}>
          <strong style={{ textAlign: 'left', fontSize: 12, color: '#e2e8f0', letterSpacing: '0.02em' }}>Lead Leg</strong>
          <span style={{ color: '#cbd5e1' }}>Peak Fz ({mode === 'Force' && forceMode === 'bw' ? 'BW%' : 'lb'}): <strong style={{ color: '#f8fafc' }}>{fmtForceOrImpulse(keyMetrics.leadPeakFz, 1)}</strong></span>
          <span style={{ color: '#cbd5e1' }}>Peak Fy ({mode === 'Force' && forceMode === 'bw' ? 'BW%' : 'lb'}): <strong style={{ color: '#f8fafc' }}>{fmtForceOrImpulse(keyMetrics.leadPeakFy, 1)}</strong></span>
          <span style={{ color: '#cbd5e1' }}>Clawback Time (s): <strong style={{ color: '#f8fafc' }}>{fmt(keyMetrics.clawbackTime, 3)}</strong></span>
          <span style={{ color: '#cbd5e1' }}>YZ Transfer Front (ms): <strong style={{ color: '#f8fafc' }}>{fmtMs(keyMetrics.yzTransferFront)}</strong></span>
        </div>
        </div>
        <div style={{ display: 'grid', gap: 5, fontSize: 12, justifyItems: 'center', textAlign: 'center', padding: 10, borderRadius: 10, background: 'rgba(12,12,14,0.86)', border: '1px solid rgba(200,16,46,0.26)' }}>
          <strong style={{ color: '#e2e8f0', letterSpacing: '0.02em' }}>Other Metrics</strong>
          <span style={{ color: '#cbd5e1' }}>Y Transfer (ms): <strong style={{ color: '#f8fafc' }}>{fmtMs(keyMetrics.yTransfer)}</strong></span>
          <span style={{ color: '#cbd5e1' }}>Z Transfer (ms): <strong style={{ color: '#f8fafc' }}>{fmtMs(keyMetrics.zTransfer)}</strong></span>
          <span style={{ color: '#cbd5e1' }}>Stride Length (in): <strong style={{ color: '#f8fafc' }}>{fmt(strideLengthIn, 1)}</strong></span>
          <span style={{ color: '#cbd5e1' }}>Stride Direction (in): <strong style={{ color: '#f8fafc' }}>{fmt(strideDirectionIn, 1)}</strong></span>
        </div>
      </aside>
    </div>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
      {paths.map((metric) => (
        <span key={`legend-${metric.phase}-${metric.key}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#e2e8f0', fontSize: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: metric.color }} />
          {phaseDisplayLabel(metric.phase)} {metric.label}
        </span>
      ))}
    </div>
    </>
  );
}

export default function BiomechanicsSuite({ role, isActive = true }: { role: Role; isActive?: boolean }) {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [mode, setMode] = useState<ViewMode>('Force');
  const [forceMode, setForceMode] = useState<ForceMode>('force');
  const [appliedStartDate, setAppliedStartDate] = useState<string>('');
  const [appliedEndDate, setAppliedEndDate] = useState<string>('');
  const [appliedForceMode, setAppliedForceMode] = useState<ForceMode>('force');
  const [sortColumn, setSortColumn] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showLeaderboardCorrelation, setShowLeaderboardCorrelation] = useState<boolean>(false);
  const [pageTab, setPageTab] = useState<BiomechPageTab>('summary');
  const [leaderboardViewMode, setLeaderboardViewMode] = useState<LeaderboardViewMode>('individual');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isExportingSummaryPdf, setIsExportingSummaryPdf] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [tableColumns, setTableColumns] = useState<string[]>([]);
  const [tableRows, setTableRows] = useState<Array<Record<string, string | number | null>>>([]);
  const [leaderboardIndividualColumns, setLeaderboardIndividualColumns] = useState<string[]>([]);
  const [leaderboardIndividualRows, setLeaderboardIndividualRows] = useState<Array<Record<string, string | number | null>>>([]);
  const [leaderboardAverageColumns, setLeaderboardAverageColumns] = useState<string[]>([]);
  const [leaderboardAverageRows, setLeaderboardAverageRows] = useState<Array<Record<string, string | number | null>>>([]);
  const [allSessionsLeaderboardIndividualRows, setAllSessionsLeaderboardIndividualRows] = useState<Array<Record<string, string | number | null>>>([]);
  const [pitchOptions, setPitchOptions] = useState<PitchOption[]>([]);
  const [selectedPitchKey, setSelectedPitchKey] = useState<string>('');
  const [selectedPitchPoints, setSelectedPitchPoints] = useState<PitchPoint[]>([]);
  const [pitcherOptions, setPitcherOptions] = useState<string[]>([]);
  const [tagsOptions, setTagsOptions] = useState<string[]>([]);
  const [pitchTypeOptions, setPitchTypeOptions] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>(['All']);
  const [selectedPitchTypes, setSelectedPitchTypes] = useState<string[]>(['All']);
  const [appliedPitchers, setAppliedPitchers] = useState<string[]>(['All']);
  const [appliedTags, setAppliedTags] = useState<string[]>(['All']);
  const [appliedPitchTypes, setAppliedPitchTypes] = useState<string[]>(['All']);
  const [hasAppliedFilters, setHasAppliedFilters] = useState<boolean>(false);
  const [selectedPitchTags, setSelectedPitchTags] = useState<string>('');
  const [selectedPitchType, setSelectedPitchType] = useState<string>('');
  const [selectedPitchPlayer, setSelectedPitchPlayer] = useState<string>('');
  const [selectedPitchDate, setSelectedPitchDate] = useState<string>('');
  const [selectedPitchVelocityMph, setSelectedPitchVelocityMph] = useState<number | null>(null);
  const [pitchVelocityByKey, setPitchVelocityByKey] = useState<Record<string, number | null>>({});
  const [selectedPitchBodyWeightLb, setSelectedPitchBodyWeightLb] = useState<number | null>(null);
  const [selectedPitchStrideLengthIn, setSelectedPitchStrideLengthIn] = useState<number | null>(null);
  const [selectedPitchStrideDirectionIn, setSelectedPitchStrideDirectionIn] = useState<number | null>(null);
  const [selectedPitchers, setSelectedPitchers] = useState<string[]>(['All']);
  const [matchSummary, setMatchSummary] = useState<{
    totalSinglePitchFiles: number;
    matchedSinglePitchFiles: number;
    unmatchedSinglePitchFiles: number;
    totalAllPitchRows: number;
    matchedAllPitchRows: number;
    unmatchedAllPitchRows: number;
  }>({
    totalSinglePitchFiles: 0,
    matchedSinglePitchFiles: 0,
    unmatchedSinglePitchFiles: 0,
    totalAllPitchRows: 0,
    matchedAllPitchRows: 0,
    unmatchedAllPitchRows: 0,
  });
  const [uploadMessage, setUploadMessage] = useState<string>('');
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [uploadFilesDone, setUploadFilesDone] = useState<number>(0);
  const [uploadFilesTotal, setUploadFilesTotal] = useState<number>(0);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'processing'>('idle');
  const [allPitchInputKey, setAllPitchInputKey] = useState<number>(0);
  const [singlePitchInputKey, setSinglePitchInputKey] = useState<number>(0);
  const summaryCardRef = useRef<HTMLDivElement | null>(null);
  const summaryTableCardRef = useRef<HTMLDivElement | null>(null);
  const selectStyle: CSSProperties = {
    background: 'rgba(2, 6, 23, 0.72)',
    color: '#e2e8f0',
    border: '1px solid rgba(148, 163, 184, 0.45)',
    borderRadius: 10,
    minHeight: 40,
    fontSize: 15,
  };
  const filterLabelStyle: CSSProperties = { fontSize: 14, color: '#94a3b8' };
  const filterControlMinWidth = 250;

  const loadData = async (
    pitchKeyOverride?: string,
    override?: {
      startDate: string;
      endDate: string;
      pitchers: string[];
      tags: string[];
      pitchTypes: string[];
      forceMode: ForceMode;
    }
  ) => {
    setIsLoading(true);
    setError('');
    try {
      const activeStartDate = override?.startDate ?? appliedStartDate;
      const activeEndDate = override?.endDate ?? appliedEndDate;
      const activePitchers = override?.pitchers ?? appliedPitchers;
      const activeTags = override?.tags ?? appliedTags;
      const activePitchTypes = override?.pitchTypes ?? appliedPitchTypes;
      const activeForceMode = override?.forceMode ?? appliedForceMode;
      const query = new URLSearchParams();
      if (activeStartDate) query.set('startDate', activeStartDate);
      if (activeEndDate) query.set('endDate', activeEndDate);
      if (activePitchers.length && !activePitchers.includes('All')) query.set('pitcher', JSON.stringify(activePitchers));
      if (activeTags.length && !activeTags.includes('All')) query.set('tag', JSON.stringify(activeTags));
      if (activePitchTypes.length && !activePitchTypes.includes('All')) query.set('pitchType', JSON.stringify(activePitchTypes));
      query.set('forceMode', activeForceMode);
      if (pitchKeyOverride || selectedPitchKey) query.set('pitchKey', pitchKeyOverride || selectedPitchKey);
      const response = await fetch(`/api/dashboard/biomechanics?${query.toString()}`, { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as Payload;
      setDebugInfo('');
      if (!response.ok) throw new Error(payload.error || 'Failed to load biomechanics data.');
      if (payload.error) throw new Error(payload.error);
      const columns = BIOMECH_TABLE_COLUMNS as unknown as string[];
      const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
      const lbIndividualColumns = Array.isArray(payload.leaderboard_individual_columns) ? payload.leaderboard_individual_columns : [];
      const lbIndividualRows = Array.isArray(payload.leaderboard_individual_rows) ? payload.leaderboard_individual_rows : [];
      const lbAverageColumns = Array.isArray(payload.leaderboard_average_columns) ? payload.leaderboard_average_columns : [];
      const lbAverageRows = Array.isArray(payload.leaderboard_average_rows) ? payload.leaderboard_average_rows : [];
      const options = Array.isArray(payload.pitch_options) ? payload.pitch_options : [];
      const pitchKey = String(payload.selected_pitch_key ?? options[0]?.pitchKey ?? '');
      const points = Array.isArray(payload.selected_pitch_points) ? payload.selected_pitch_points : [];
      const uploadPitchers = Array.isArray(payload.pitcher_options) ? payload.pitcher_options : [];
      const nextTags = Array.isArray(payload.tags_options) ? payload.tags_options : [];
      const nextPitchTypes = Array.isArray(payload.pitch_type_options) ? payload.pitch_type_options : [];
      const responseAppliedStartDate = String(payload.applied_start_date ?? '').trim();
      const responseAppliedEndDate = String(payload.applied_end_date ?? '').trim();
      setTableColumns(columns);
      setTableRows(rows);
      setLeaderboardIndividualColumns(lbIndividualColumns);
      setLeaderboardIndividualRows(lbIndividualRows);
      setLeaderboardAverageColumns(lbAverageColumns);
      setLeaderboardAverageRows(lbAverageRows);
      setAllSessionsLeaderboardIndividualRows(Array.isArray(payload.all_sessions_leaderboard_individual_rows) ? payload.all_sessions_leaderboard_individual_rows : []);
      setPitchOptions(options);
      setSelectedPitchKey(pitchKey);
      setSelectedPitchPoints(points);
      setPitcherOptions(uploadPitchers);
      setTagsOptions(nextTags);
      setPitchTypeOptions(nextPitchTypes);
      setSelectedPitchTags(String(payload.selected_pitch_tags ?? ''));
      setSelectedPitchType(String(payload.selected_pitch_type ?? ''));
      setSelectedPitchPlayer(String(payload.selected_pitch_player ?? ''));
      setSelectedPitchDate(String(payload.selected_pitch_date ?? ''));
      setSelectedPitchVelocityMph(typeof payload.selected_pitch_velocity_mph === 'number' ? payload.selected_pitch_velocity_mph : null);
      setPitchVelocityByKey(payload.pitch_velocity_by_key && typeof payload.pitch_velocity_by_key === 'object' ? payload.pitch_velocity_by_key : {});
      setSelectedPitchBodyWeightLb(typeof payload.selected_pitch_body_weight_lb === 'number' ? payload.selected_pitch_body_weight_lb : null);
      setSelectedPitchStrideLengthIn(typeof payload.selected_pitch_stride_length_in === 'number' ? payload.selected_pitch_stride_length_in : null);
      setSelectedPitchStrideDirectionIn(typeof payload.selected_pitch_stride_direction_in === 'number' ? payload.selected_pitch_stride_direction_in : null);
      setMatchSummary({
        totalSinglePitchFiles: Number(payload.match_summary?.totalSinglePitchFiles ?? 0),
        matchedSinglePitchFiles: Number(payload.match_summary?.matchedSinglePitchFiles ?? 0),
        unmatchedSinglePitchFiles: Number(payload.match_summary?.unmatchedSinglePitchFiles ?? 0),
        totalAllPitchRows: Number(payload.match_summary?.totalAllPitchRows ?? 0),
        matchedAllPitchRows: Number(payload.match_summary?.matchedAllPitchRows ?? 0),
        unmatchedAllPitchRows: Number(payload.match_summary?.unmatchedAllPitchRows ?? 0),
      });
      if (responseAppliedStartDate && responseAppliedStartDate !== appliedStartDate) setAppliedStartDate(responseAppliedStartDate);
      if (responseAppliedEndDate && responseAppliedEndDate !== appliedEndDate) setAppliedEndDate(responseAppliedEndDate);
      setSelectedTags((current) => {
        if (current.length === 1 && current[0] === 'All') return current;
        const filtered = current.filter((value) => nextTags.includes(value));
        const next = normalizeMulti(filtered);
        if (next.length === current.length && next.every((v, i) => v === current[i])) return current;
        return next;
      });
      setSelectedPitchTypes((current) => {
        if (current.length === 1 && current[0] === 'All') return current;
        const filtered = current.filter((v) => nextPitchTypes.includes(v));
        const next = normalizeMulti(filtered);
        if (next.length === current.length && next.every((v, i) => v === current[i])) return current;
        return next;
      });
      setSelectedPitchers((current) => {
        if (current.length === 1 && current[0] === 'All') return current;
        const filtered = current.filter((value) => uploadPitchers.includes(value));
        const next = normalizeMulti(filtered);
        if (next.length === current.length && next.every((v, i) => v === current[i])) return current;
        return next;
      });
      if (!sortColumn && columns.length) setSortColumn(columns[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load biomechanics data.');
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    if (!startDate || !endDate) {
      setError('Select both start and end dates, then click Apply Filters.');
      return;
    }
    setError('');
    const nextPitchers = normalizeMulti(selectedPitchers);
    const nextTags = normalizeMulti(selectedTags);
    const nextPitchTypes = normalizeMulti(selectedPitchTypes);
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    setAppliedPitchers(nextPitchers);
    setAppliedTags(nextTags);
    setAppliedPitchTypes(nextPitchTypes);
    setAppliedForceMode(forceMode);
    setHasAppliedFilters(true);
    void loadData(undefined, {
      startDate,
      endDate,
      pitchers: nextPitchers,
      tags: nextTags,
      pitchTypes: nextPitchTypes,
      forceMode,
    });
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const className = 'biomechanics-suite-active';
    if (isActive) {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }
    return () => {
      document.body.classList.remove(className);
    };
  }, [isActive]);

  const sortedRows = useMemo(() => {
    const activeColumns =
      pageTab === 'summary'
        ? tableColumns
        : (leaderboardViewMode === 'individual' ? leaderboardIndividualColumns : leaderboardAverageColumns);
    const activeRows =
      pageTab === 'summary'
        ? tableRows
        : (leaderboardViewMode === 'individual' ? leaderboardIndividualRows : leaderboardAverageRows);
    if (!sortColumn || !activeColumns.includes(sortColumn)) return activeRows;
    return sortTableRows(activeRows, sortColumn, sortDirection);
  }, [
    sortColumn,
    sortDirection,
    pageTab,
    leaderboardViewMode,
    tableColumns,
    tableRows,
    leaderboardIndividualColumns,
    leaderboardIndividualRows,
    leaderboardAverageColumns,
    leaderboardAverageRows,
  ]);
  const isSingleAppliedPlayer = useMemo(() => {
    const selected = (appliedPitchers ?? []).filter((value) => String(value ?? '').trim().toUpperCase() !== 'ALL');
    return selected.length === 1;
  }, [appliedPitchers]);
  const summaryRowsByPitchType = useMemo(() => {
    if (!isSingleAppliedPlayer || pageTab !== 'summary') return sortedRows;
    const selectedPlayerRaw = (appliedPitchers ?? []).find((value) => String(value ?? '').trim().toUpperCase() !== 'ALL') ?? '';
    const selectedPlayerFirstLast = toFirstLastName(selectedPlayerRaw);
    const sourceRows = leaderboardIndividualRows.filter((row) => {
      const rowName = toFirstLastName(String(row.Name ?? ''));
      return rowName === selectedPlayerFirstLast;
    });
    const allSessionRows = allSessionsLeaderboardIndividualRows.filter((row) => {
      const rowName = toFirstLastName(String(row.Name ?? ''));
      return rowName === selectedPlayerFirstLast;
    });
    const currentSessionDates = new Set(
      sourceRows
        .map((row) => String(row.Date ?? '').trim())
        .filter(Boolean)
    );
    const allSessionRowsExcludingCurrent = allSessionRows.filter((row) => {
      const date = String(row.Date ?? '').trim();
      return !date || !currentSessionDates.has(date);
    });
    if (!sourceRows.length && !allSessionRowsExcludingCurrent.length) return sortedRows;
    type Agg = {
      pitchType: string;
      name: string;
      count: number;
      dateSet: Set<string>;
      tagsSet: Set<string>;
      sums: Record<string, number>;
      sessionLabel: 'Current Session' | 'All Sessions';
    };
    const aggregateRows = (
      rows: Array<Record<string, string | number | null>>,
      sessionLabel: 'Current Session' | 'All Sessions'
    ): Map<string, Agg> => {
      const byType = new Map<string, Agg>();
      for (const row of rows) {
        const pitchTypeRaw = String(row['Pitch Type'] ?? '').trim();
        const pitchType = pitchTypeRaw || 'Unspecified';
        const count = 1;
        const current = byType.get(pitchType) ?? {
          pitchType,
          name: String(row.Name ?? ''),
          count: 0,
          dateSet: new Set<string>(),
          tagsSet: new Set<string>(),
          sums: {},
          sessionLabel,
        };
        current.count += count;
        const dateVal = String(row.Date ?? '').trim();
        if (dateVal) current.dateSet.add(dateVal);
        const tagVal = String(row.Tags ?? '').trim();
        if (tagVal) current.tagsSet.add(tagVal);
        for (const column of BIOMECH_TABLE_COLUMNS) {
          if (column === 'Name' || column === 'Date' || column === '#' || column === 'Pitch Type' || column === 'Tags') continue;
          const value = toFinite(row[column] as unknown);
          if (value === null) continue;
          current.sums[column] = (current.sums[column] ?? 0) + value * count;
        }
        byType.set(pitchType, current);
      }
      return byType;
    };
    const currentByType = aggregateRows(sourceRows, 'Current Session');
    const allByType = aggregateRows(allSessionRowsExcludingCurrent, 'All Sessions');
    const allTypes = new Set<string>([...currentByType.keys(), ...allByType.keys()]);
    const rank = new Map<string, number>(PITCH_TYPE_ORDER.map((name, idx) => [name.toLowerCase(), idx]));
    const orderedTypes = Array.from(allTypes).sort((a, b) => {
      const aRank = rank.get(a.toLowerCase());
      const bRank = rank.get(b.toLowerCase());
      if (aRank !== undefined || bRank !== undefined) {
        if (aRank === undefined) return 1;
        if (bRank === undefined) return -1;
        if (aRank !== bRank) return aRank - bRank;
      }
      return a.localeCompare(b);
    });
    const orderedAggs: Agg[] = [];
    for (const pitchType of orderedTypes) {
      const curr = currentByType.get(pitchType);
      const all = allByType.get(pitchType);
      if (curr) orderedAggs.push(curr);
      if (all) orderedAggs.push(all);
    }
    return orderedAggs.map((agg) => {
      const output: Record<string, string | number | null> = {
        Name: agg.name,
        Date: agg.dateSet.size === 1 ? Array.from(agg.dateSet)[0] : (agg.dateSet.size > 1 ? 'Multi' : ''),
        '#': agg.count,
        Session: agg.sessionLabel,
        'Pitch Type': agg.pitchType,
        Tags: agg.tagsSet.size === 1 ? Array.from(agg.tagsSet)[0] : (agg.tagsSet.size > 1 ? 'Multi' : ''),
      };
      for (const column of BIOMECH_TABLE_COLUMNS) {
        if (column in output) continue;
        const sum = agg.sums[column];
        output[column] = sum === undefined || agg.count <= 0 ? null : sum / agg.count;
      }
      return output;
    });
  }, [isSingleAppliedPlayer, pageTab, sortedRows, appliedPitchers, leaderboardIndividualRows, allSessionsLeaderboardIndividualRows]);

  const shouldHideTagsColumnForSinglePlayer = useMemo(() => {
    if (!isSingleAppliedPlayer || pageTab !== 'summary') return false;
    if (!summaryRowsByPitchType.length) return false;
    return summaryRowsByPitchType.every((row) => {
      const raw = String(row.Tags ?? '').trim();
      if (!raw) return true;
      const parts = raw
        .split(/[|,;]+/g)
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean);
      if (!parts.length) return true;
      return parts.every((tag) => EXCLUDED_SINGLE_PLAYER_TAGS.has(tag));
    });
  }, [isSingleAppliedPlayer, pageTab, summaryRowsByPitchType]);

  const displayPitchOptions = useMemo(
    () => pitchOptions.map((option) => ({ ...option, label: formatPitchOptionLabel(option, pitchOptions, pitchVelocityByKey) })),
    [pitchOptions, pitchVelocityByKey]
  );
  const pitchTypeSelectOptions = useMemo(() => {
    const rank = new Map<string, number>(PITCH_TYPE_ORDER.map((name, idx) => [name.toLowerCase(), idx]));
    const sorted = [...pitchTypeOptions].sort((a, b) => {
      const aRank = rank.get(a.toLowerCase());
      const bRank = rank.get(b.toLowerCase());
      if (aRank !== undefined || bRank !== undefined) {
        if (aRank === undefined) return 1;
        if (bRank === undefined) return -1;
        if (aRank !== bRank) return aRank - bRank;
      }
      return a.localeCompare(b);
    });
    return [{ value: 'All', label: 'All' }, ...sorted.map((value) => ({ value, label: value }))];
  }, [pitchTypeOptions]);
  const playerSelectOptions = useMemo(
    () => [{ value: 'All', label: 'All' }, ...pitcherOptions.map((name) => ({ value: name, label: toFirstLastName(name) }))],
    [pitcherOptions]
  );
  const tagSelectOptions = useMemo(
    () => [{ value: 'All', label: 'All' }, ...tagsOptions.map((tag) => ({ value: tag, label: tag }))],
    [tagsOptions]
  );

  const uploadFiles = async (uploadKind: 'all_pitches' | 'single_pitch', files: FileList | null) => {
    if (!files?.length) return;
    setIsUploading(true);
    setError('');
    setUploadMessage('');
    setUploadFilesDone(0);
    setUploadFilesTotal(files.length);
    setUploadPhase('uploading');
    try {
      const uploadBatch = (batch: File[]) => new Promise<{ error?: string; filesProcessed?: number; rowsInserted?: number }>((resolve, reject) => {
        const formData = new FormData();
        formData.set('uploadKind', uploadKind);
        batch.forEach((file) => formData.append('files', file));
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/dashboard/biomechanics');
        xhr.onerror = () => reject(new Error('Upload failed.'));
        xhr.onload = () => {
          const json = (() => {
            try {
              return JSON.parse(xhr.responseText || '{}') as { error?: string; filesProcessed?: number; rowsInserted?: number };
            } catch {
              return {} as { error?: string; filesProcessed?: number; rowsInserted?: number };
            }
          })();
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(json.error || 'Upload failed.'));
            return;
          }
          resolve(json);
        };
        xhr.send(formData);
      });

      const picked = Array.from(files);
      let totalFilesProcessed = 0;
      let totalRowsInserted = 0;
      const batches = picked.map((file) => [file]);

      for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i] ?? [];
        setUploadPhase('uploading');
        const payload = await uploadBatch(batch);
        totalFilesProcessed += Number(payload.filesProcessed ?? batch.length);
        totalRowsInserted += Number(payload.rowsInserted ?? 0);
        setUploadFilesDone(i + 1);
      }
      setUploadPhase('processing');
      setUploadMessage(`Upload complete: ${totalFilesProcessed} file(s), ${totalRowsInserted} row(s) processed.`);
      if (uploadKind === 'all_pitches') setAllPitchInputKey((value) => value + 1);
      if (uploadKind === 'single_pitch') setSinglePitchInputKey((value) => value + 1);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
      setUploadPhase('idle');
      setUploadFilesDone(0);
      setUploadFilesTotal(0);
    }
  };

  const deleteSelectedPitch = async () => {
    const pitchKey = String(selectedPitchKey ?? '').trim();
    if (!pitchKey) return;
    const selectedLabel = displayPitchOptions.find((option) => option.pitchKey === pitchKey)?.label ?? 'this pitch';
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Delete ${selectedLabel}?\n\nThis removes the single-pitch file and its paired all-pitch row.`);
      if (!ok) return;
    }
    setIsDeleting(true);
    setError('');
    setUploadMessage('');
    try {
      const response = await fetch('/api/dashboard/biomechanics', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchKey }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Failed to delete pitch.');
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete pitch.');
    } finally {
      setIsDeleting(false);
    }
  };
  const downloadSummaryPdf = async () => {
    if (!summaryCardRef.current || isExportingSummaryPdf) return;
    setIsExportingSummaryPdf(true);
    setError('');
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const isSinglePlayerPdf = Boolean(isSingleAppliedPlayer);
      const isLightTheme = typeof document !== 'undefined' && document.body.classList.contains('theme-light');
      const pageBgHex = isLightTheme ? '#f8fafc' : '#000000';
      const exportRoot = summaryCardRef.current.cloneNode(true) as HTMLDivElement;
      exportRoot.style.width = isSinglePlayerPdf ? '1360px' : '920px';
      exportRoot.style.position = 'fixed';
      exportRoot.style.left = '-99999px';
      exportRoot.style.top = '0';
      exportRoot.style.zIndex = '-1';
      exportRoot.style.pointerEvents = 'none';
      exportRoot.style.background = pageBgHex;
      exportRoot.style.padding = isSinglePlayerPdf ? '8px' : '14px';
      exportRoot.style.gap = '8px';
      exportRoot.style.overflow = 'visible';
      const pdfLogoRow = document.createElement('div');
      pdfLogoRow.style.display = 'flex';
      pdfLogoRow.style.justifyContent = 'space-between';
      pdfLogoRow.style.alignItems = 'center';
      pdfLogoRow.style.margin = '0 0 4px 0';
      const leftLogo = document.createElement('img');
      leftLogo.src = '/pitching-coach-u-logo.png';
      leftLogo.alt = 'PCU logo';
      leftLogo.style.width = '70px';
      leftLogo.style.height = '70px';
      leftLogo.style.objectFit = 'contain';
      const rightLogo = document.createElement('img');
      rightLogo.src = '/pitching-coach-u-logo.png';
      rightLogo.alt = 'PCU logo';
      rightLogo.style.width = '70px';
      rightLogo.style.height = '70px';
      rightLogo.style.objectFit = 'contain';
      pdfLogoRow.append(leftLogo, rightLogo);
      exportRoot.prepend(pdfLogoRow);
      const chartRow = exportRoot.querySelector('[data-biomech-chart-row="true"]') as HTMLDivElement | null;
      const graphPanel = exportRoot.querySelector('[data-biomech-graph-panel="true"]') as HTMLDivElement | null;
      const metricsPanel = exportRoot.querySelector('[data-biomech-metrics-panel="true"]') as HTMLElement | null;
      const graphSvg = exportRoot.querySelector('[data-biomech-graph-panel="true"] svg') as SVGElement | null;
      const headerTitle = exportRoot.querySelector('p[style*="font-size: 18px"]') as HTMLParagraphElement | null;
      if (chartRow) {
        chartRow.style.gridTemplateColumns = 'minmax(0, 1fr)';
        chartRow.style.alignItems = 'start';
        chartRow.style.gap = '8px';
      }
      if (graphPanel) {
        graphPanel.style.marginTop = '0';
        graphPanel.style.width = '100%';
      }
      if (metricsPanel) {
        metricsPanel.style.order = '-1';
        metricsPanel.style.marginTop = '0';
        metricsPanel.style.height = 'auto';
        metricsPanel.style.overflowY = 'visible';
        metricsPanel.style.padding = '10px 12px 12px';
      }
      if (graphSvg) {
        graphSvg.style.maxWidth = '100%';
        graphSvg.style.height = isSinglePlayerPdf ? '300px' : '340px';
      }
      if (headerTitle) {
        headerTitle.style.fontSize = '28px';
        headerTitle.style.lineHeight = '1.1';
      }
      if (isSingleAppliedPlayer && summaryTableCardRef.current) {
        const tableClone = summaryTableCardRef.current.cloneNode(true) as HTMLDivElement;
        tableClone.style.marginTop = '8px';
        tableClone.style.paddingTop = '0';
        tableClone.style.overflow = 'visible';
        const tableWrap = tableClone.querySelector('.portal-table-wrap') as HTMLDivElement | null;
        if (tableWrap) {
          tableWrap.style.maxHeight = 'none';
          tableWrap.style.overflow = 'visible';
        }
        exportRoot.appendChild(tableClone);
      }
      if (isSinglePlayerPdf) {
        const cards = exportRoot.querySelectorAll('.portal-card');
        cards.forEach((card) => {
          (card as HTMLElement).style.overflow = 'visible';
        });
      }
      document.body.appendChild(exportRoot);
      const canvas = await html2canvas(exportRoot, {
        backgroundColor: pageBgHex,
        scale: Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1),
        useCORS: true,
      });
      exportRoot.remove();
      const imageData = canvas.toDataURL('image/jpeg', 0.9);
      const pdf = new jsPDF({ orientation: isSinglePlayerPdf ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const hex = pageBgHex.replace('#', '');
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      pdf.setFillColor(r, g, b);
      pdf.rect(0, 0, pageW, pageH, 'F');
      const margin = isSinglePlayerPdf ? 2 : 8;
      const usableW = pageW - margin * 2;
      const usableH = pageH - margin * 2;
      const scale = Math.min(usableW / canvas.width, usableH / canvas.height);
      const drawW = canvas.width * scale;
      const drawH = canvas.height * scale;
      const drawX = (pageW - drawW) / 2;
      const drawY = (pageH - drawH) / 2;
      pdf.addImage(imageData, 'JPEG', drawX, drawY, drawW, drawH, undefined, 'FAST');
      const player = String(selectedPitchPlayer ?? '').trim() || 'pitch';
      const date = String(selectedPitchDate ?? '').trim() || 'date';
      const safeName = `${player}_${date}`.replace(/[^a-z0-9_-]+/gi, '_');
      pdf.save(`biomechanics_summary_${safeName}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to download PDF.');
    } finally {
      setIsExportingSummaryPdf(false);
    }
  };

  const activeTableColumns =
    pageTab === 'summary'
      ? tableColumns
      : (leaderboardViewMode === 'individual' ? leaderboardIndividualColumns : leaderboardAverageColumns);
  const displayTableColumns =
    pageTab === 'summary' && isSingleAppliedPlayer
      ? (() => {
        const filtered = activeTableColumns.filter((column) => column !== 'Name' && column !== 'Date');
          const rest = filtered.filter((column) =>
            column !== 'Pitch Type' &&
            column !== '#' &&
            column !== 'Session' &&
            !(shouldHideTagsColumnForSinglePlayer && column === 'Tags')
          );
          return ['Pitch Type', '#', 'Session', ...rest];
        })()
      : activeTableColumns;
  const activeDisplayRows =
    pageTab === 'summary'
      ? summaryRowsByPitchType
      : sortedRows;
  const activeTableTitle =
    pageTab === 'summary'
      ? 'Summary Table'
      : (leaderboardViewMode === 'individual' ? 'Leaderboard: Individual Pitches' : 'Leaderboard: Averages');

  return (
    <section className="portal-panel portal-admin-panel" style={{ padding: '1rem', display: 'grid', gap: 14 }}>
      <h2 style={{ margin: 0 }}>Biomechanics</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={pageTab === 'summary' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setPageTab('summary')}>
          Summary
        </button>
        <button type="button" className={pageTab === 'leaderboard' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setPageTab('leaderboard')}>
          Leaderboard
        </button>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 4, minWidth: filterControlMinWidth }}>
          <span style={filterLabelStyle}>Start Date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="portal-select biomechanics-filter-control" style={selectStyle} />
        </label>
        <label style={{ display: 'grid', gap: 4, minWidth: filterControlMinWidth }}>
          <span style={filterLabelStyle}>End Date</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="portal-select biomechanics-filter-control" style={selectStyle} />
        </label>
        <label style={{ display: 'grid', gap: 4, minWidth: filterControlMinWidth }}>
          <span style={filterLabelStyle}>Player</span>
          <SearchableMultiSelect options={playerSelectOptions} values={selectedPitchers} onChange={setSelectedPitchers} />
        </label>
        <label style={{ display: 'grid', gap: 4, minWidth: filterControlMinWidth }}>
          <span style={filterLabelStyle}>Tags</span>
          <SearchableMultiSelect options={tagSelectOptions} values={selectedTags} onChange={setSelectedTags} />
        </label>
        <label style={{ display: 'grid', gap: 4, minWidth: filterControlMinWidth }}>
          <span style={filterLabelStyle}>Pitch Type</span>
          <SearchableMultiSelect
            options={pitchTypeSelectOptions}
            values={selectedPitchTypes}
            onChange={setSelectedPitchTypes}
          />
        </label>
        <button type="button" className="btn btn-ghost" onClick={applyFilters} disabled={isLoading || isUploading}>
          {isLoading ? 'Loading...' : 'Apply Filters'}
        </button>
      </div>
      {!hasAppliedFilters ? (
        <div style={{ color: '#94a3b8', fontSize: 13 }}>
          Select a date range and click <strong>Apply Filters</strong> to load biomechanics data.
        </div>
      ) : null}

      {pageTab === 'summary' ? (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ border: '1px solid rgba(148,163,184,0.25)', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Upload All-Pitches CSVs</h3>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>Use files with one row per pitch and metric columns.</p>
          {role === 'player' ? <p style={{ margin: 0, color: '#fca5a5', fontSize: 12 }}>Upload disabled for player role.</p> : null}
          <input
            key={allPitchInputKey}
            type="file"
            className="biomechanics-file-input"
            accept=".csv,text/csv"
            multiple
            onChange={(e) => void uploadFiles('all_pitches', e.currentTarget.files)}
            disabled={isUploading || role === 'player'}
          />
        </div>
        <div style={{ border: '1px solid rgba(148,163,184,0.25)', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Upload Single-Pitch CSVs</h3>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>Use files with time-series points for one pitch each.</p>
          <input
            key={singlePitchInputKey}
            type="file"
            className="biomechanics-file-input"
            accept=".csv,text/csv"
            multiple
            onChange={(e) => void uploadFiles('single_pitch', e.currentTarget.files)}
            disabled={isUploading || role === 'player'}
          />
        </div>
      </div>
      ) : null}

      {error ? <p className="auth-error" style={{ margin: 0 }}>{error}</p> : null}
      {!error && uploadMessage ? <p style={{ margin: 0, color: '#86efac' }}>{uploadMessage}</p> : null}
      {isUploading ? (
        <p style={{ margin: 0, color: '#93c5fd' }}>
          {uploadPhase === 'processing'
            ? `Processing on server... ${uploadFilesTotal}/${uploadFilesTotal}`
            : `Uploading CSV files... ${uploadFilesDone}/${uploadFilesTotal}`}
        </p>
      ) : null}
      <p style={{ margin: 0, color: '#cbd5e1', fontSize: 13 }}>
        Match Quality: {matchSummary.matchedAllPitchRows}/{matchSummary.totalAllPitchRows} pitches matched ({matchSummary.unmatchedAllPitchRows} unmatched all-pitch rows). Single-pitch files uploaded: {matchSummary.totalSinglePitchFiles} ({matchSummary.matchedSinglePitchFiles} currently paired).
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        {pageTab === 'leaderboard' ? (
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Leaderboard View</span>
            <select className="portal-select" value={leaderboardViewMode} onChange={(e) => setLeaderboardViewMode(e.target.value as LeaderboardViewMode)} style={selectStyle}>
              <option value="individual">Individual Pitches</option>
              <option value="averages">Averages</option>
            </select>
          </label>
        ) : null}
        {pageTab === 'summary' ? (
          <label style={{ display: 'grid', gap: 4, width: 460, maxWidth: '100%', flex: '0 0 auto' }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Pitch</span>
            <select
              className="portal-select"
              value={selectedPitchKey}
              style={selectStyle}
              disabled={!hasAppliedFilters}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedPitchKey(next);
                if (hasAppliedFilters) void loadData(next);
              }}
            >
              {displayPitchOptions.length ? displayPitchOptions.map((option) => (
                <option key={option.pitchKey} value={option.pitchKey}>{option.label}</option>
              )) : <option value="">No pitches available</option>}
            </select>
          </label>
        ) : null}
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>View</span>
          <select className="portal-select" value={mode} onChange={(e) => setMode(e.target.value as ViewMode)} style={selectStyle}>
            <option value="Force">Force (Fx, Fy, Fz)</option>
            <option value="Moments">Moments (Mx, My, Mz)</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>Scale</span>
          <select className="portal-select" value={forceMode} onChange={(e) => setForceMode(e.target.value as ForceMode)} style={selectStyle}>
            <option value="force">Force</option>
            <option value="bw">BW%</option>
          </select>
        </label>
      </div>

      {pageTab === 'summary' ? (
      <div ref={summaryCardRef} style={{ border: '1px solid rgba(148,163,184,0.25)', borderRadius: 10, padding: 12, display: 'grid', gap: 8, position: 'relative' }}>
        <div data-html2canvas-ignore="true" style={{ position: 'absolute', top: 10, right: 10, zIndex: 2 }}>
          <button type="button" className="btn btn-ghost" onClick={() => void downloadSummaryPdf()} disabled={isExportingSummaryPdf}>
            {isExportingSummaryPdf ? 'Downloading PDF...' : 'Download PDF'}
          </button>
        </div>
        <div style={{ display: 'grid', justifyItems: 'center', gap: 2, paddingTop: 2 }}>
          <p style={{ margin: 0, color: '#e2e8f0', fontSize: 22, fontWeight: 700, textAlign: 'center', lineHeight: 1.1 }}>
            {selectedPitchPlayer || '—'}
          </p>
          <p style={{ margin: 0, color: '#cbd5e1', fontSize: 16, textAlign: 'center', lineHeight: 1.15 }}>
            {selectedPitchDate || '—'}
          </p>
          {(() => {
            const parts: string[] = [];
            const tags = String(selectedPitchTags ?? '').trim();
            const hasTag = Boolean(tags) && tags.toLowerCase() !== 'untagged';
            if (hasTag) parts.push(tags);
            if (!parts.length) return null;
            return (
              <p style={{ margin: 0, color: '#cbd5e1', fontSize: 13, textAlign: 'center' }}>
                <strong>{parts.join(' | ')}</strong>
              </p>
            );
          })()}
        </div>
        <LineChart
          points={selectedPitchPoints}
          mode={mode}
          forceMode={forceMode}
          pitchVelocityMph={selectedPitchVelocityMph}
          pitchType={selectedPitchType}
          bodyWeightLb={selectedPitchBodyWeightLb}
          strideLengthIn={selectedPitchStrideLengthIn}
          strideDirectionIn={selectedPitchStrideDirectionIn}
        />
      </div>
      ) : null}

      <div ref={summaryTableCardRef} style={{ border: '1px solid rgba(148,163,184,0.25)', borderRadius: 10, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>{activeTableTitle}</h3>
          {pageTab === 'leaderboard' ? (
            <button type="button" className="btn btn-ghost" onClick={() => setShowLeaderboardCorrelation(true)}>
              View Chart
            </button>
          ) : null}
        </div>
        <div className="portal-table-wrap" style={{ maxHeight: '52vh', overflow: 'auto', position: 'relative' }}>
          <div
            style={{
              position: 'sticky',
              top: 0,
              height: 3,
              background: 'rgba(8,8,8,0.98)',
              zIndex: 8,
              pointerEvents: 'none',
            }}
          />
          <table className="portal-table" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                {displayTableColumns.map((column) => {
                  const active = sortColumn === column;
                  const glyph = active ? (sortDirection === 'desc' ? '↓' : '↑') : '';
                  return (
                    <th
                      key={column}
                      style={{
                        textAlign: 'center',
                        background: active ? 'rgb(120, 10, 28)' : 'rgba(8,8,8,0.96)',
                        position: 'sticky',
                        top: 0,
                        zIndex: 6,
                        boxShadow: active
                          ? '0 2px 0 rgb(120, 10, 28)'
                          : '0 2px 0 rgba(8,8,8,0.96)',
                        backgroundClip: 'padding-box',
                      }}
                    >
                      <button
                        type="button"
                        className="portal-table-sort-btn"
                        style={{
                          appearance: 'none',
                          border: 'none',
                          background: 'transparent',
                          color: 'inherit',
                          font: 'inherit',
                          fontWeight: 600,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                        onClick={() => {
                          setSortColumn(column);
                          setSortDirection((prev) => (active && prev === 'desc' ? 'asc' : 'desc'));
                        }}
                      >
                        {(forceMode === 'bw' && (column.includes('Peak Fz') || column.includes('Peak Fy') || column.includes('Impulse')))
                          ? column.replace('(lb·s)', '(BW%·s)').replace('(lb)', '(BW%)')
                          : (column.includes('Back Leg Impulse Time') || column.includes('Back Leg YZ Transfer') || column.includes('Lead Leg YZ Transfer') || column === 'Y Transfer (s)' || column === 'Z Transfer (s)')
                            ? column.replace('(s)', '(ms)')
                          : column}
                        {glyph ? ` ${glyph}` : ''}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {activeDisplayRows.length ? activeDisplayRows.map((row, rowIdx) => (
                <tr key={`bio-row-${rowIdx}`}>
                  {displayTableColumns.map((column) => (
                    (() => {
                      const pitchTypeCellValue = String(row['Pitch Type'] ?? '').trim();
                      const isPitchTypeCell = isSingleAppliedPlayer && pageTab === 'summary' && column === 'Pitch Type';
                      const isMergedPitchTypeMode = isSingleAppliedPlayer && pageTab === 'summary' && displayTableColumns.includes('Session');
                      if (isPitchTypeCell && isMergedPitchTypeMode) {
                        const prevPitchType = rowIdx > 0 ? String(activeDisplayRows[rowIdx - 1]?.['Pitch Type'] ?? '').trim() : '';
                        if (prevPitchType === pitchTypeCellValue) return null;
                      }
                      const pitchTypeBg = isPitchTypeCell ? (PITCH_TYPE_COLOR[pitchTypeCellValue] ?? '#6b7280') : undefined;
                      const pitchTypeTextColor = isPitchTypeCell
                        ? (pitchTypeCellValue.toLowerCase() === 'fastball' ? '#000000' : '#ffffff')
                        : undefined;
                      let pitchTypeRowSpan: number | undefined;
                      if (isPitchTypeCell && isMergedPitchTypeMode) {
                        let span = 1;
                        for (let i = rowIdx + 1; i < activeDisplayRows.length; i += 1) {
                          const nextPitchType = String(activeDisplayRows[i]?.['Pitch Type'] ?? '').trim();
                          if (nextPitchType !== pitchTypeCellValue) break;
                          span += 1;
                        }
                        pitchTypeRowSpan = span > 1 ? span : undefined;
                      }
                      return (
                    <td
                      key={`${rowIdx}-${column}`}
                      rowSpan={pitchTypeRowSpan}
                      style={{
                        textAlign: 'center',
                        background: pitchTypeBg ?? (rowIdx % 2 === 0 ? 'rgba(200,16,46,0.14)' : 'rgba(255,255,255,0.05)'),
                        color: pitchTypeTextColor,
                        fontWeight:
                          isSingleAppliedPlayer && pageTab === 'summary' && column === 'Pitch Type'
                            ? 700
                            : undefined,
                      }}
                    >
                      {formatBiomechTableValue(column, row[column] as string | number | null, forceMode)}
                    </td>
                      );
                    })()
                  ))}
                </tr>
              )) : (
                <tr>
                  <td colSpan={Math.max(1, displayTableColumns.length)} style={{ textAlign: 'center' }}>
                    {isLoading ? 'Loading...' : 'No rows available.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <LeaderboardCorrelationModal
        open={showLeaderboardCorrelation && pageTab === 'leaderboard'}
        onClose={() => setShowLeaderboardCorrelation(false)}
        title={leaderboardViewMode === 'individual' ? 'Biomechanics Leaderboard Correlation (Individual Pitches)' : 'Biomechanics Leaderboard Correlation (Averages)'}
        columns={displayTableColumns}
        rows={activeDisplayRows as Array<Record<string, string | number | null | undefined>>}
        viewByLabel="Player"
        primaryColumnName="Name"
        formatValue={(column, value) => formatBiomechTableValue(column, value as string | number | null, forceMode)}
      />
    </section>
  );
}

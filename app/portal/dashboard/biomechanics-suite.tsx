'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { formatTableDisplayValue, sortTableRows, type SortDirection } from '../../../lib/table-sort';

type Role = 'admin' | 'coach' | 'player';
type ViewMode = 'Force' | 'Moments';

type PitchOption = {
  pitchKey: string;
  label: string;
  capturedAt: string | null;
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
  pitch_options?: PitchOption[];
  selected_pitch_key?: string | null;
  selected_pitch_points?: PitchPoint[];
  pitcher_options?: string[];
  error?: string;
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

function LineChart({ points, mode }: { points: PitchPoint[]; mode: ViewMode }) {
  const roundAxisBound = (value: number, direction: 'up' | 'down') => {
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
        return {
          t: bucket.t,
          fx: avg(bucket.fx),
          fy: avg(bucket.fy),
          fz: avg(bucket.fz),
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
  }, [points]);

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

  if (!domain) {
    return <p style={{ color: '#9ca3af', margin: 0 }}>No single-pitch data for this selection.</p>;
  }

  const width = 860;
  const height = 520;
  const pad = { left: 54, right: 20, top: 16, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const dx = domain.maxX - domain.minX || 1;
  const dy = domain.maxY - domain.minY || 1;

  const x = (v: number) => pad.left + ((v - domain.minX) / dx) * plotW;
  const y = (v: number) => pad.top + (1 - (v - domain.minY) / dy) * plotH;

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
    const tHover = domain.minX + ((hoverClientX - pad.left) / plotW) * dx;
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
  }, [chartPoints, domain, dx, hoverClientX, metrics, plotW]);
  const yTicks = useMemo(() => {
    if (!domain) return [] as number[];
    const start = Math.ceil(domain.minY / 50) * 50;
    const end = Math.floor(domain.maxY / 50) * 50;
    const ticks: number[] = [];
    for (let v = start; v <= end; v += 50) ticks.push(v);
    if (!ticks.includes(0)) ticks.push(0);
    return Array.from(new Set(ticks)).sort((a, b) => b - a);
  }, [domain]);

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
  }, [chartPoints]);

  const fmt = (value: number | null, digits = 2) => (value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits));
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
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 860px) minmax(240px, 1fr)', gap: 12, position: 'relative', zIndex: 0, overflow: 'hidden', alignItems: 'start' }}>
      <div style={{ position: 'relative' }}>
        <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', maxWidth: 860, background: 'rgba(2,6,23,0.45)', borderRadius: 12, overflow: 'hidden', display: 'block' }}
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
          const value = tick.toFixed(1);
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
          const value = (domain.minX + step * (domain.maxX - domain.minX)).toFixed(1);
          return (
            <g key={`x-grid-${step}`}>
              <line x1={xx} y1={pad.top} x2={xx} y2={height - pad.bottom} stroke="rgba(148,163,184,0.12)" strokeWidth="1" />
              <text x={xx} y={height - pad.bottom + 16} fill="#cbd5e1" fontSize="11" textAnchor="middle">{value}s</text>
            </g>
          );
        })}
        <text x={width / 2} y={height - 8} fill="#cbd5e1" fontSize="12" textAnchor="middle">Time (s)</text>
        <text x={14} y={height / 2} fill="#cbd5e1" fontSize="12" transform={`rotate(-90 14 ${height / 2})`} textAnchor="middle">Force</text>
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
            background: 'rgba(2, 6, 23, 0.92)',
            border: '1px solid rgba(148,163,184,0.42)',
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
              <span>{metric.label}: {metric.value === null ? '—' : metric.value.toFixed(1)}</span>
            </div>
          ))}
        </div>
        ) : null}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          {paths.map((metric) => (
            <span key={`legend-${metric.phase}-${metric.key}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#e2e8f0', fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: metric.color }} />
              {phaseDisplayLabel(metric.phase)} {metric.label}
            </span>
          ))}
        </div>
      </div>
      <aside style={{ border: '1px solid rgba(148,163,184,0.25)', borderRadius: 10, padding: 12, background: 'rgba(2,6,23,0.35)', display: 'grid', gap: 10 }}>
        <h4 style={{ margin: 0 }}>Key Metrics</h4>
        <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
          <strong>Back Leg</strong>
          <span>Peak Fz (lb): {fmt(keyMetrics.backPeakFz, 1)}</span>
          <span>Peak Fy (lb): {fmt(keyMetrics.backPeakFy, 1)}</span>
          <span>Impulse (lb·s): {fmt(keyMetrics.impulse, 2)}</span>
          <span>YZ Transfer Back (s): {fmt(keyMetrics.yzTransferBack, 3)}</span>
        </div>
        <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
          <strong>Lead Leg</strong>
          <span>Peak Fz (lb): {fmt(keyMetrics.leadPeakFz, 1)}</span>
          <span>Peak Fy (lb): {fmt(keyMetrics.leadPeakFy, 1)}</span>
          <span>Clawback Time (s): {fmt(keyMetrics.clawbackTime, 3)}</span>
          <span>YZ Transfer Front (s): {fmt(keyMetrics.yzTransferFront, 3)}</span>
        </div>
        <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
          <strong>Other Metrics</strong>
          <span>Y Transfer (s): {fmt(keyMetrics.yTransfer, 3)}</span>
          <span>Z Transfer (s): {fmt(keyMetrics.zTransfer, 3)}</span>
        </div>
      </aside>
    </div>
  );
}

export default function BiomechanicsSuite({ role, isActive = true }: { role: Role; isActive?: boolean }) {
  const [startDate, setStartDate] = useState<string>(isoDateOffset(-30));
  const [endDate, setEndDate] = useState<string>(isoDateOffset(0));
  const [mode, setMode] = useState<ViewMode>('Force');
  const [sortColumn, setSortColumn] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [tableColumns, setTableColumns] = useState<string[]>([]);
  const [tableRows, setTableRows] = useState<Array<Record<string, string | number | null>>>([]);
  const [pitchOptions, setPitchOptions] = useState<PitchOption[]>([]);
  const [selectedPitchKey, setSelectedPitchKey] = useState<string>('');
  const [selectedPitchPoints, setSelectedPitchPoints] = useState<PitchPoint[]>([]);
  const [pitcherOptions, setPitcherOptions] = useState<string[]>([]);
  const [selectedPitcher, setSelectedPitcher] = useState<string>('ALL');
  const [selectedUploadPitcher, setSelectedUploadPitcher] = useState<string>('');
  const [pitcherSearch, setPitcherSearch] = useState<string>('');
  const [uploadMessage, setUploadMessage] = useState<string>('');
  const [uploadPercent, setUploadPercent] = useState<number>(0);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'processing'>('idle');
  const [allPitchInputKey, setAllPitchInputKey] = useState<number>(0);
  const [singlePitchInputKey, setSinglePitchInputKey] = useState<number>(0);
  const selectStyle: CSSProperties = {
    background: 'rgba(2, 6, 23, 0.72)',
    color: '#e2e8f0',
    border: '1px solid rgba(148, 163, 184, 0.45)',
    borderRadius: 10,
  };
  const pitcherSelectStyle: CSSProperties = {
    ...selectStyle,
    fontSize: '1.05rem',
    fontWeight: 600,
    minHeight: 42,
  };

  const loadData = async (pitchKeyOverride?: string) => {
    setIsLoading(true);
    setError('');
    try {
      const query = new URLSearchParams();
      if (startDate) query.set('startDate', startDate);
      if (endDate) query.set('endDate', endDate);
      if (selectedPitcher && selectedPitcher !== 'ALL') query.set('pitcher', selectedPitcher);
      if (pitchKeyOverride || selectedPitchKey) query.set('pitchKey', pitchKeyOverride || selectedPitchKey);
      const response = await fetch(`/api/dashboard/biomechanics?${query.toString()}`, { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok) throw new Error(payload.error || 'Failed to load biomechanics data.');
      const columns = Array.isArray(payload.table_columns) ? payload.table_columns : [];
      const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
      const options = Array.isArray(payload.pitch_options) ? payload.pitch_options : [];
      const pitchKey = String(payload.selected_pitch_key ?? options[0]?.pitchKey ?? '');
      const points = Array.isArray(payload.selected_pitch_points) ? payload.selected_pitch_points : [];
      const uploadPitchers = Array.isArray(payload.pitcher_options) ? payload.pitcher_options : [];
      setTableColumns(columns);
      setTableRows(rows);
      setPitchOptions(options);
      setSelectedPitchKey(pitchKey);
      setSelectedPitchPoints(points);
      setPitcherOptions(uploadPitchers);
      setSelectedUploadPitcher((current) => (current && uploadPitchers.includes(current) ? current : (uploadPitchers[0] ?? '')));
      if (!sortColumn && columns.length) setSortColumn(columns[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load biomechanics data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [selectedPitcher]);

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
    if (!sortColumn) return tableRows;
    return sortTableRows(tableRows, sortColumn, sortDirection);
  }, [sortColumn, sortDirection, tableRows]);

  const filteredPitcherOptions = useMemo(() => {
    const needle = pitcherSearch.trim().toLowerCase();
    const filtered = !needle ? pitcherOptions : pitcherOptions.filter((name) => toFirstLastName(name).toLowerCase().includes(needle));
    if (selectedUploadPitcher && !filtered.includes(selectedUploadPitcher) && pitcherOptions.includes(selectedUploadPitcher)) {
      return [selectedUploadPitcher, ...filtered];
    }
    return filtered;
  }, [pitcherOptions, pitcherSearch, selectedUploadPitcher]);

  const uploadFiles = async (uploadKind: 'all_pitches' | 'single_pitch', files: FileList | null) => {
    if (!files?.length) return;
    setIsUploading(true);
    setError('');
    setUploadMessage('');
    setUploadPercent(0);
    setUploadPhase('uploading');
    try {
      const formData = new FormData();
      formData.set('uploadKind', uploadKind);
      if (uploadKind === 'single_pitch') {
        if (!selectedUploadPitcher) throw new Error('Select a pitcher before uploading single-pitch CSV files.');
        formData.set('pitcherName', selectedUploadPitcher);
      }
      Array.from(files).forEach((file) => formData.append('files', file));
      const payload = await new Promise<{ error?: string; filesProcessed?: number; rowsInserted?: number }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/dashboard/biomechanics');
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const pct = Math.max(1, Math.min(95, Math.round((event.loaded / event.total) * 95)));
          setUploadPercent(pct);
        };
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
          setUploadPercent(100);
          setUploadPhase('idle');
          resolve(json);
        };
        xhr.upload.onload = () => {
          setUploadPercent(95);
          setUploadPhase('processing');
        };
        xhr.send(formData);
      });
      setUploadMessage(`Upload complete: ${Number(payload.filesProcessed ?? 0)} file(s), ${Number(payload.rowsInserted ?? 0)} row(s) processed.`);
      if (uploadKind === 'all_pitches') setAllPitchInputKey((value) => value + 1);
      if (uploadKind === 'single_pitch') setSinglePitchInputKey((value) => value + 1);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
      setUploadPhase('idle');
    }
  };

  return (
    <section className="portal-panel portal-admin-panel" style={{ padding: '1rem', display: 'grid', gap: 14 }}>
      <h2 style={{ margin: 0 }}>Biomechanics</h2>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>Start Date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="portal-select" style={selectStyle} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>End Date</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="portal-select" style={selectStyle} />
        </label>
        <label style={{ display: 'grid', gap: 4, minWidth: 220 }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>Player</span>
          <select
            className="portal-select"
            value={selectedPitcher}
            onChange={(e) => setSelectedPitcher(e.target.value)}
            style={selectStyle}
          >
            <option value="ALL">All</option>
            {pitcherOptions.map((name) => (
              <option key={`filter-${name}`} value={name}>{toFirstLastName(name)}</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-ghost" onClick={() => void loadData()} disabled={isLoading || isUploading}>
          {isLoading ? 'Loading...' : 'Apply Filters'}
        </button>
      </div>

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
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Pitcher</span>
            <input
              type="text"
              className="portal-select"
              placeholder="Search pitcher..."
              value={pitcherSearch}
              onChange={(e) => setPitcherSearch(e.target.value)}
              style={selectStyle}
            />
            <select className="portal-select" value={selectedUploadPitcher} onChange={(e) => setSelectedUploadPitcher(e.target.value)} style={pitcherSelectStyle}>
              {!filteredPitcherOptions.length ? <option value="">No matching pitchers</option> : null}
              {filteredPitcherOptions.map((name) => (
                <option key={name} value={name} style={{ color: '#0f172a', backgroundColor: '#f8fafc' }}>{toFirstLastName(name)}</option>
              ))}
            </select>
          </label>
          <input
            key={singlePitchInputKey}
            type="file"
            className="biomechanics-file-input"
            accept=".csv,text/csv"
            multiple
            onChange={(e) => void uploadFiles('single_pitch', e.currentTarget.files)}
            disabled={isUploading || !selectedUploadPitcher || role === 'player'}
          />
        </div>
      </div>

      {error ? <p className="auth-error" style={{ margin: 0 }}>{error}</p> : null}
      {!error && uploadMessage ? <p style={{ margin: 0, color: '#86efac' }}>{uploadMessage}</p> : null}
      {isUploading ? (
        <p style={{ margin: 0, color: '#93c5fd' }}>
          {uploadPhase === 'processing' ? 'Upload complete. Processing on server...' : 'Uploading CSV files...'}
        </p>
      ) : null}
      {isUploading ? (
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ height: 10, borderRadius: 999, background: 'rgba(148,163,184,0.25)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${uploadPercent}%`,
                background:
                  uploadPhase === 'processing'
                    ? 'repeating-linear-gradient(90deg, #22d3ee, #22d3ee 14px, #34d399 14px, #34d399 28px)'
                    : 'linear-gradient(90deg, #22d3ee, #34d399)',
                backgroundSize: uploadPhase === 'processing' ? '40px 10px' : undefined,
                transition: 'width 180ms ease',
              }}
            />
          </div>
          <p style={{ margin: 0, fontSize: 12, color: '#cbd5e1' }}>
            {uploadPhase === 'processing' ? '95% (server processing...)' : `${uploadPercent}%`}
          </p>
        </div>
      ) : null}

      <div style={{ border: '1px solid rgba(148,163,184,0.25)', borderRadius: 10, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'grid', gap: 4, minWidth: 360, flex: 1 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Pitch</span>
            <select
              className="portal-select"
              value={selectedPitchKey}
              style={selectStyle}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedPitchKey(next);
                void loadData(next);
              }}
            >
              {pitchOptions.length ? pitchOptions.map((option) => (
                <option key={option.pitchKey} value={option.pitchKey}>{option.label}</option>
              )) : <option value="">No pitches available</option>}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>View</span>
            <select className="portal-select" value={mode} onChange={(e) => setMode(e.target.value as ViewMode)} style={selectStyle}>
              <option value="Force">Force (Fx, Fy, Fz)</option>
              <option value="Moments">Moments (Mx, My, Mz)</option>
            </select>
          </label>
        </div>
        <LineChart points={selectedPitchPoints} mode={mode} />
      </div>

      <div style={{ border: '1px solid rgba(148,163,184,0.25)', borderRadius: 10, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>All-Pitches Table</h3>
        <div className="portal-table-wrap" style={{ maxHeight: '52vh', overflow: 'auto' }}>
          <table className="portal-table">
            <thead>
              <tr>
                {tableColumns.map((column) => {
                  const active = sortColumn === column;
                  const glyph = active ? (sortDirection === 'desc' ? '↓' : '↑') : '↕';
                  return (
                    <th key={column}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '0.2rem 0.35rem', minHeight: 'unset' }}
                        onClick={() => {
                          setSortColumn(column);
                          setSortDirection((prev) => (active && prev === 'desc' ? 'asc' : 'desc'));
                        }}
                      >
                        {column} {glyph}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length ? sortedRows.map((row, rowIdx) => (
                <tr key={`bio-row-${rowIdx}`}>
                  {tableColumns.map((column) => (
                    <td key={`${rowIdx}-${column}`}>{formatTableDisplayValue(column, row[column])}</td>
                  ))}
                </tr>
              )) : (
                <tr>
                  <td colSpan={Math.max(1, tableColumns.length)}>{isLoading ? 'Loading...' : 'No rows available.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';

type PlayerOption = {
  id: number;
  name: string;
};

type MetricOption = {
  key: string;
  label: string;
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight' | 'force_plate';
  group: 'Weight Progress' | 'Speed' | 'Jump Height' | 'Exercises' | 'Force Plate';
};

type TrendPoint = {
  date: string;
  value: number;
};

type PanelConfig = {
  metricKey: string;
  forcePlateTestType: string;
  forcePlatePointType: 'average' | 'rep';
};

type Props = {
  players: PlayerOption[];
  schoolCode: string;
  schoolLogoSrc: string | null;
  schoolLogoAlt: string;
};

const GROUP_ORDER: MetricOption['group'][] = ['Weight Progress', 'Speed', 'Jump Height', 'Exercises', 'Force Plate'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = String(date.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function toFixedSmart(value: number): string {
  if (!Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 100 || Number.isInteger(value)) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function buildTrendPath(points: TrendPoint[], width: number, height: number, pad = { l: 44, r: 16, t: 18, b: 34 }) {
  if (points.length < 2) return '';
  const values = points.map((point) => point.value).filter((value) => Number.isFinite(value));
  if (!values.length) return '';
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const ySpan = Math.max(0.0001, maxY - minY);

  const px = (index: number) => (points.length <= 1 ? pad.l : pad.l + (index / (points.length - 1)) * (width - pad.l - pad.r));
  const py = (value: number) => pad.t + ((maxY - value) / ySpan) * (height - pad.t - pad.b);
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${px(index).toFixed(2)} ${py(point.value).toFixed(2)}`).join(' ');
}

function yTicks(points: TrendPoint[], count = 5): number[] {
  const values = points.map((point) => point.value).filter((value) => Number.isFinite(value));
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (Math.abs(max - min) < 0.0001) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, idx) => min + step * idx);
}

export default function TestingBuilder({ players, schoolCode, schoolLogoSrc, schoolLogoAlt }: Props) {
  const [reportName, setReportName] = useState('Testing Dashboard');
  const [headerNote, setHeaderNote] = useState('');
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(2);
  const [playerId, setPlayerId] = useState<string>(players[0] ? String(players[0].id) : '');
  const [startDate, setStartDate] = useState(isoDaysAgo(90));
  const [endDate, setEndDate] = useState(todayIso());
  const [panels, setPanels] = useState<PanelConfig[]>([
    { metricKey: 'body_weight', forcePlateTestType: 'All', forcePlatePointType: 'average' },
    { metricKey: '', forcePlateTestType: 'All', forcePlatePointType: 'average' },
    { metricKey: '', forcePlateTestType: 'All', forcePlatePointType: 'average' },
    { metricKey: '', forcePlateTestType: 'All', forcePlatePointType: 'average' },
  ]);
  const [metrics, setMetrics] = useState<MetricOption[]>([]);
  const [seriesByKey, setSeriesByKey] = useState<Record<string, TrendPoint[]>>({});
  const [forcePlateTestTypes, setForcePlateTestTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const slotCount = rows * columns;

  useEffect(() => {
    setPanels((previous) => {
      if (previous.length === slotCount) return previous;
      if (previous.length > slotCount) return previous.slice(0, slotCount);
      return [
        ...previous,
        ...Array.from({ length: slotCount - previous.length }, () => ({
          metricKey: '',
          forcePlateTestType: 'All',
          forcePlatePointType: 'average' as const,
        })),
      ];
    });
  }, [slotCount]);

  const metricRequests = useMemo(
    () =>
      panels.map((panel, index) => ({
        panelIndex: index,
        metricKey: panel.metricKey,
        forcePlateTestType: panel.forcePlateTestType || 'All',
        forcePlatePointType: panel.forcePlatePointType || 'average',
      })),
    [panels]
  );

  useEffect(() => {
    if (!playerId) {
      setMetrics([]);
      setSeriesByKey({});
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      playerId,
      startDate,
      endDate,
      metricRequests: JSON.stringify(metricRequests),
    });
    setLoading(true);
    setError('');
    fetch(`/api/admin/testing/data?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load testing data.');
        setMetrics(Array.isArray(payload.metrics) ? payload.metrics : []);
        setSeriesByKey(payload.seriesByKey && typeof payload.seriesByKey === 'object' ? payload.seriesByKey : {});
        setForcePlateTestTypes(
          Array.isArray(payload.availableForcePlateTestTypes)
            ? payload.availableForcePlateTestTypes.map((value: unknown) => String(value ?? '').trim()).filter(Boolean)
            : []
        );
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Failed to load testing data.');
        setForcePlateTestTypes([]);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => controller.abort();
  }, [playerId, startDate, endDate, metricRequests]);

  const metricGroups = useMemo(() => {
    const grouped = new Map<MetricOption['group'], MetricOption[]>();
    for (const option of metrics) {
      const list = grouped.get(option.group) ?? [];
      list.push(option);
      grouped.set(option.group, list);
    }
    return grouped;
  }, [metrics]);

  return (
    <div className="portal-testing-layout">
      <aside className="portal-testing-sidebar">
        <label className="portal-inline-filter">
          Name
          <input value={reportName} onChange={(event) => setReportName(event.target.value)} placeholder="Testing Dashboard" />
        </label>
        <label className="portal-inline-filter">
          Header Note
          <textarea value={headerNote} onChange={(event) => setHeaderNote(event.target.value)} rows={3} />
        </label>
        <div className="portal-testing-grid-2">
          <label className="portal-inline-filter">
            Rows
            <select value={String(rows)} onChange={(event) => setRows(Math.max(1, Math.min(4, Number(event.target.value) || 1)))}>
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={String(value)}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-inline-filter">
            Columns
            <select value={String(columns)} onChange={(event) => setColumns(Math.max(1, Math.min(4, Number(event.target.value) || 1)))}>
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={String(value)}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="portal-inline-filter">
          Player
          <select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>
            {players.length === 0 ? <option value="">No players</option> : null}
            {players.map((player) => (
              <option key={player.id} value={String(player.id)}>
                {player.name}
              </option>
            ))}
          </select>
        </label>
        <div className="portal-testing-grid-2">
          <label className="portal-inline-filter">
            Start Date
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label className="portal-inline-filter">
            End Date
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
        </div>
        {loading ? <p className="portal-muted-text">Loading testing data...</p> : null}
        {error ? <p className="auth-error">{error}</p> : null}
      </aside>

      <section className="portal-testing-main">
        <header className="portal-testing-header">
          <img src="/pitching-coach-u-logo.png" alt="PCU logo" className="portal-testing-header-logo" />
          <div className="portal-testing-header-center">
            <h2>{reportName || 'Testing Dashboard'}</h2>
            <p>{players.find((player) => String(player.id) === playerId)?.name ?? 'Select Player'}</p>
            {headerNote.trim() ? <div className="portal-testing-header-note">{headerNote}</div> : null}
          </div>
          <img
            src={schoolLogoSrc ?? '/pitching-coach-u-logo.png'}
            alt={schoolLogoSrc ? schoolLogoAlt : `${schoolCode} logo`}
            className="portal-testing-header-logo"
          />
        </header>

        <div className="portal-testing-panels" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: slotCount }).map((_, idx) => {
            const panel = panels[idx] ?? { metricKey: '', forcePlateTestType: 'All', forcePlatePointType: 'average' as const };
            const seriesKey = `panel:${idx}`;
            const points = panel.metricKey ? seriesByKey[seriesKey] ?? [] : [];
            const path = buildTrendPath(points, 560, 300);
            const ticks = yTicks(points, 5);
            const metricLabel = metrics.find((metric) => metric.key === panel.metricKey)?.label ?? 'Select Metric';
            const isForcePlateMetric = panel.metricKey.startsWith('force_plate:');
            const forcePlateTestTypeOptions = ['All', ...forcePlateTestTypes];
            return (
              <article className="portal-testing-panel" key={`panel-${idx}`}>
                <label className="portal-inline-filter">
                  Metric
                  <select
                    value={panel.metricKey}
                    onChange={(event) => {
                      const next = [...panels];
                      next[idx] = { ...panel, metricKey: event.target.value };
                      setPanels(next);
                    }}
                  >
                    <option value="">Select metric</option>
                    {GROUP_ORDER.map((group) => {
                      const options = metricGroups.get(group) ?? [];
                      if (!options.length) return null;
                      return (
                        <optgroup key={group} label={group}>
                          {options.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </label>
                {isForcePlateMetric ? (
                  <div className="portal-testing-grid-2">
                    <label className="portal-inline-filter">
                      Exercise
                      <select
                        value={panel.forcePlateTestType}
                        onChange={(event) => {
                          const next = [...panels];
                          next[idx] = { ...panel, forcePlateTestType: event.target.value };
                          setPanels(next);
                        }}
                      >
                        {forcePlateTestTypeOptions.map((testType) => (
                          <option key={testType} value={testType}>
                            {testType}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="portal-inline-filter">
                      Data Type
                      <select
                        value={panel.forcePlatePointType}
                        onChange={(event) => {
                          const next = [...panels];
                          next[idx] = { ...panel, forcePlatePointType: event.target.value as 'average' | 'rep' };
                          setPanels(next);
                        }}
                      >
                        <option value="average">Average</option>
                        <option value="rep">Reps</option>
                      </select>
                    </label>
                  </div>
                ) : null}
                <div className="portal-testing-chart-title">{metricLabel}</div>
                {!panel.metricKey ? (
                  <p className="portal-muted-text">Choose a metric for this panel.</p>
                ) : points.length === 0 ? (
                  <p className="portal-muted-text">No data for the selected date range.</p>
                ) : (
                  <div className="portal-testing-chart-wrap">
                    <svg viewBox="0 0 560 300" style={{ width: '100%', height: 300 }}>
                      <rect x={0} y={0} width={560} height={300} fill="rgba(0,0,0,0.25)" rx={10} />
                      <line x1={44} y1={18} x2={44} y2={266} stroke="rgba(255,255,255,0.45)" strokeWidth={1.2} />
                      <line x1={44} y1={266} x2={544} y2={266} stroke="rgba(255,255,255,0.45)" strokeWidth={1.2} />
                      {ticks.map((tick, tickIdx) => {
                        const min = Math.min(...ticks);
                        const max = Math.max(...ticks);
                        const span = Math.max(0.0001, max - min);
                        const y = 18 + ((max - tick) / span) * (300 - 18 - 34);
                        return (
                          <g key={`y-${tickIdx}`}>
                            <line x1={44} y1={y} x2={544} y2={y} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
                            <text x={38} y={y + 4} textAnchor="end" fontSize={11} fill="rgba(255,255,255,0.75)">
                              {toFixedSmart(tick)}
                            </text>
                          </g>
                        );
                      })}
                      {points.map((point, pointIdx) => {
                        const x = points.length <= 1 ? 44 : 44 + (pointIdx / (points.length - 1)) * (560 - 44 - 16);
                        const values = points.map((valuePoint) => valuePoint.value);
                        const min = Math.min(...values);
                        const max = Math.max(...values);
                        const span = Math.max(0.0001, max - min);
                        const y = 18 + ((max - point.value) / span) * (300 - 18 - 34);
                        return (
                          <g key={`p-${point.date}-${pointIdx}`}>
                            <circle cx={x} cy={y} r={4.2} fill="#ff6b6b" />
                            {(pointIdx === 0 || pointIdx === points.length - 1 || pointIdx % Math.max(1, Math.floor(points.length / 4)) === 0) && (
                              <text x={x} y={282} textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.75)">
                                {shortDate(point.date)}
                              </text>
                            )}
                          </g>
                        );
                      })}
                      <path d={path} fill="none" stroke="#ff6b6b" strokeWidth={2.5} />
                      <text x={294} y={296} textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.82)" fontWeight={700}>
                        Date
                      </text>
                      <text
                        x={14}
                        y={142}
                        textAnchor="middle"
                        transform="rotate(-90 14 142)"
                        fontSize={11}
                        fill="rgba(255,255,255,0.82)"
                        fontWeight={700}
                      >
                        Value
                      </text>
                    </svg>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

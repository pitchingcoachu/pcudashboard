'use client';

import { useMemo, useState } from 'react';
import type { ValdPlayerSnapshot } from '../../../lib/vald-forceplates';

type Snapshot = {
  fetchedAt: string;
  tenantId: string;
  players: ValdPlayerSnapshot[];
};

function metricKey(name: string, unit: string): string {
  return `${name}__${unit}`;
}

function chartPath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function testTypeColor(index: number): string {
  const palette = [
    'rgba(56,189,248,0.95)',
    'rgba(34,197,94,0.95)',
    'rgba(249,115,22,0.95)',
    'rgba(168,85,247,0.95)',
    'rgba(236,72,153,0.95)',
    'rgba(250,204,21,0.95)',
  ];
  return palette[index % palette.length];
}

function valueRange(values: number[]): { min: number; max: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

function toIsoDate(value: string): string {
  const parsed = new Date(String(value ?? '').trim());
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function ForcePlatesDashboard({ snapshot }: { snapshot: Snapshot }) {
  const [selectedPlayer, setSelectedPlayer] = useState(snapshot.players[0]?.playerName ?? '');
  const [pointMode, setPointMode] = useState<'average' | 'rep'>('average');
  const player = useMemo(() => snapshot.players.find((entry) => entry.playerName === selectedPlayer) ?? null, [snapshot.players, selectedPlayer]);

  const metricOptions = useMemo(() => {
    if (!player) return [];
    const map = new Map<string, { name: string; unit: string; count: number }>();
    for (const row of player.metricRows) {
      const key = metricKey(row.metricName, row.metricUnit);
      const current = map.get(key) ?? { name: row.metricName, unit: row.metricUnit, count: 0 };
      current.count += 1;
      map.set(key, current);
    }
    const values = Array.from(map.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map((row) => ({ key: metricKey(row.name, row.unit), label: `${row.name}${row.unit ? ` (${row.unit})` : ''} • ${row.count}` }));
    return values;
  }, [player]);

  const [selectedMetricKey, setSelectedMetricKey] = useState('');
  const defaultMetricKey = useMemo(() => {
    if (!metricOptions.length) return '';
    const preferred = metricOptions.find((option) => option.key.toLowerCase().includes('jump height (flight time) in inches'));
    return preferred?.key ?? metricOptions[0].key;
  }, [metricOptions]);

  const metricRows = useMemo(() => {
    if (!player) return [];
    const activeMetric = selectedMetricKey || defaultMetricKey;
    const desiredType = pointMode === 'rep' ? 'rep' : 'average';
    return player.metricRows.filter(
      (row) =>
        metricKey(row.metricName, row.metricUnit) === activeMetric &&
        String(row.pointType ?? 'average') === desiredType
    );
  }, [player, selectedMetricKey, defaultMetricKey, pointMode]);

  const [selectedTestType, setSelectedTestType] = useState('All');
  const [dateRangeByPlayer, setDateRangeByPlayer] = useState<Record<string, { start: string; end: string }>>({});
  const testTypeOptions = useMemo(() => {
    if (!player) return ['All'];
    return ['All', ...Array.from(new Set(player.metricRows.map((row) => row.testType))).sort((a, b) => a.localeCompare(b))];
  }, [player]);
  const playerDateBounds = useMemo(() => {
    if (!player) return { min: '', max: '' };
    const dates = player.metricRows
      .map((row) => toIsoDate(String(row.dateTime ?? row.date)))
      .filter(Boolean)
      .sort();
    return { min: dates[0] ?? '', max: dates[dates.length - 1] ?? '' };
  }, [player]);
  const startDate = dateRangeByPlayer[selectedPlayer]?.start || playerDateBounds.min;
  const endDate = dateRangeByPlayer[selectedPlayer]?.end || playerDateBounds.max;

  const filteredRows = useMemo(
    () =>
      metricRows.filter((row) => {
        if (!(selectedTestType === 'All' || row.testType === selectedTestType)) return false;
        const rowIso = toIsoDate(String(row.dateTime ?? row.date));
        if (startDate && rowIso && rowIso < startDate) return false;
        if (endDate && rowIso && rowIso > endDate) return false;
        return true;
      }),
    [metricRows, selectedTestType, startDate, endDate]
  );

  const pointRows = useMemo(() => [...filteredRows], [filteredRows]);
  const chartPoints = useMemo(() => {
    if (pointRows.length < 1) return [];
    const values = pointRows.map((row) => row.value);
    const range = valueRange(values);
    const uniqueDates = Array.from(new Set(pointRows.map((row) => row.date)));
    const dateIndexMap = new Map(uniqueDates.map((date, index) => [date, index]));
    return pointRows.map((row, index) => {
      const dateIndex = dateIndexMap.get(row.date) ?? 0;
      const x = 56 + (dateIndex / Math.max(1, uniqueDates.length - 1)) * 476;
      const y = 196 - ((row.value - range.min) / (range.max - range.min)) * 156;
      return { x, y, value: row.value, date: row.date, testType: row.testType };
    });
  }, [pointRows]);
  const seriesByTestType = useMemo(() => {
    const types = Array.from(new Set(chartPoints.map((point) => point.testType)));
    return types.map((type) => ({
      testType: type,
      points: chartPoints.filter((point) => point.testType === type),
    }));
  }, [chartPoints]);
  const yScale = useMemo(() => {
    const values = filteredRows.map((row) => row.value);
    return values.length ? valueRange(values) : { min: 0, max: 1 };
  }, [filteredRows]);
  const yTicks = useMemo(() => {
    const { min, max } = yScale;
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const ratio = i / steps;
      const value = max - ratio * (max - min);
      const y = 40 + ratio * 156;
      return { y, value };
    });
  }, [yScale]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const latest = filteredRows[filteredRows.length - 1] ?? null;
  const avg = filteredRows.length ? filteredRows.reduce((sum, row) => sum + row.value, 0) / filteredRows.length : null;

  return (
    <div className="portal-admin-stack">
      <article className="portal-admin-card">
        <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(6, minmax(180px, 1fr))' }}>
          <label>
            Player
            <select value={selectedPlayer} onChange={(event) => setSelectedPlayer(event.target.value)}>
              {snapshot.players.map((entry) => (
                <option key={entry.playerName} value={entry.playerName}>
                  {entry.playerName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Metric
            <select value={selectedMetricKey} onChange={(event) => setSelectedMetricKey(event.target.value)}>
              <option value="">Jump Height (Flight Time) in Inches (default)</option>
              {metricOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Chart Points
            <select value={pointMode} onChange={(event) => setPointMode(event.target.value === 'rep' ? 'rep' : 'average')}>
              <option value="average">Average by Test</option>
              <option value="rep">Every Rep</option>
            </select>
          </label>
          <label>
            Test Type
            <select value={selectedTestType} onChange={(event) => setSelectedTestType(event.target.value)}>
              {testTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start Date
            <input
              type="date"
              value={startDate}
              min={playerDateBounds.min || undefined}
              max={endDate || playerDateBounds.max || undefined}
              onChange={(event) =>
                setDateRangeByPlayer((current) => ({
                  ...current,
                  [selectedPlayer]: { start: event.target.value, end: endDate },
                }))
              }
            />
          </label>
          <label>
            End Date
            <input
              type="date"
              value={endDate}
              min={startDate || playerDateBounds.min || undefined}
              max={playerDateBounds.max || undefined}
              onChange={(event) =>
                setDateRangeByPlayer((current) => ({
                  ...current,
                  [selectedPlayer]: { start: startDate, end: event.target.value },
                }))
              }
            />
          </label>
        </div>
      </article>

      <article className="portal-admin-card">
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <p style={{ margin: 0 }}>
            <strong>Data points:</strong> {filteredRows.length}
          </p>
          <p style={{ margin: 0 }}>
            <strong>Latest:</strong> {latest ? `${latest.value.toFixed(2)}${latest.metricUnit ? ` ${latest.metricUnit}` : ''}` : '--'}
          </p>
          <p style={{ margin: 0 }}>
            <strong>Average:</strong> {avg !== null ? `${avg.toFixed(2)}${latest?.metricUnit ? ` ${latest.metricUnit}` : ''}` : '--'}
          </p>
        </div>
        {chartPoints.length > 0 ? (
          <div style={{ marginTop: 10, display: 'grid', gap: 12, gridTemplateColumns: selectedTestType === 'All' && seriesByTestType.length > 1 ? 'minmax(0, 1fr) 160px' : '1fr' }}>
            <svg viewBox="0 0 560 220" width="100%" height="240" role="img" aria-label="Metric trend chart" className="portal-force-plate-chart">
              <rect x="0" y="0" width="560" height="220" fill="rgba(2,6,23,0.4)" rx="10" />
              <line x1="56" y1="196" x2="532" y2="196" stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
              <line x1="56" y1="20" x2="56" y2="196" stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
              {yTicks.map((tick, idx) => (
                <g key={`y-tick-${idx}`}>
                  <line x1="56" y1={tick.y} x2="532" y2={tick.y} stroke="rgba(148,163,184,0.14)" strokeWidth="1" />
                  <text className="portal-force-plate-chart-tick" x="52" y={tick.y + 3} fill="rgba(203,213,225,0.88)" fontSize="9" textAnchor="end">
                    {tick.value.toFixed(2)}
                  </text>
                </g>
              ))}
              <text className="portal-force-plate-chart-axis-label" x="294" y="214" fill="rgba(203,213,225,0.9)" fontSize="10" textAnchor="middle">
                Date
              </text>
              <text className="portal-force-plate-chart-axis-label" x="14" y="108" fill="rgba(203,213,225,0.9)" fontSize="10" textAnchor="middle" transform="rotate(-90, 14, 108)">
                Value
              </text>
              {seriesByTestType.map((series, index) =>
                series.points.length > 1 ? (
                  <path key={`series-${series.testType}`} d={chartPath(series.points)} fill="none" stroke={testTypeColor(index)} strokeWidth="2.5" />
                ) : null
              )}
              {chartPoints.map((point, index) => (
                <circle
                  key={`${point.date}-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={hoverIndex === index ? '5' : '3.5'}
                  fill={testTypeColor(seriesByTestType.findIndex((series) => series.testType === point.testType))}
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex((current) => (current === index ? null : current))}
                />
              ))}
              {hoverIndex !== null && chartPoints[hoverIndex] ? (
                (() => {
                  const point = chartPoints[hoverIndex];
                  const row = filteredRows[hoverIndex];
                  const tooltipX = Math.min(410, Math.max(80, point.x + 12));
                  const tooltipY = Math.max(18, point.y - 58);
                  const valueText = `${point.value.toFixed(2)}${row?.metricUnit ? ` ${row.metricUnit}` : ''}`;
                  return (
                    <g>
                      <rect x={tooltipX} y={tooltipY} width="140" height="46" rx="7" fill="rgba(15,23,42,0.95)" stroke="rgba(59,130,246,0.5)" strokeWidth="1" />
                      <text x={tooltipX + 8} y={tooltipY + 13} fill="#e2e8f0" fontSize="9">
                        {selectedPlayer}
                      </text>
                      <text x={tooltipX + 8} y={tooltipY + 26} fill="#cbd5e1" fontSize="9">
                        {point.date}
                      </text>
                      <text x={tooltipX + 8} y={tooltipY + 39} fill="#7dd3fc" fontSize="9">
                        {valueText}
                      </text>
                    </g>
                  );
                })()
              ) : null}
              {chartPoints.length > 0 ? (
                <>
                  <text className="portal-force-plate-chart-edge-date" x={56} y={208} fill="rgba(203,213,225,0.8)" fontSize="9" textAnchor="start">
                    {chartPoints[0]?.date ?? ''}
                  </text>
                  {(chartPoints[0]?.date ?? '') !== (chartPoints[chartPoints.length - 1]?.date ?? '') ? (
                    <text className="portal-force-plate-chart-edge-date" x={532} y={208} fill="rgba(203,213,225,0.8)" fontSize="9" textAnchor="end">
                      {chartPoints[chartPoints.length - 1]?.date ?? ''}
                    </text>
                  ) : null}
                </>
              ) : null}
            </svg>
            {selectedTestType === 'All' && seriesByTestType.length > 1 ? (
              <div style={{ alignSelf: 'start', display: 'grid', gap: 6, paddingTop: 8 }}>
                {seriesByTestType.map((series, index) => (
                  <div key={`legend-${series.testType}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: testTypeColor(index), display: 'inline-block' }} />
                    <span className="portal-force-plate-chart-legend-text" style={{ color: 'rgba(226,232,240,0.92)', fontSize: 12 }}>{series.testType}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="portal-muted-text" style={{ marginTop: 12 }}>
            Not enough metric values for a trend line yet.
          </p>
        )}
      </article>

      <article className="portal-admin-card">
        <h4 style={{ marginTop: 0 }}>Metric Values</h4>
        {filteredRows.length ? (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Test Type</th>
                <th>Metric</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {[...filteredRows].reverse().map((row, index) => (
                <tr key={`${row.testId}-${row.metricId}-${row.trialId ?? index}`}>
                  <td>{row.date}</td>
                  <td>{row.testType}</td>
                  <td>{`${row.metricName}${row.metricUnit ? ` (${row.metricUnit})` : ''}`}</td>
                  <td>{row.value.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="portal-muted-text">No metric rows available for this filter.</p>
        )}
      </article>

      {player ? (
        <article className="portal-admin-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ marginTop: 0, marginBottom: 4 }}>{player.playerName}</h3>
              <p className="portal-muted-text" style={{ margin: 0 }}>
                {player.profileId ? `Profile linked • ${player.testsCount} tests` : 'No VALD profile match yet'}
              </p>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2fr)', marginTop: 10 }}>
            <div>
              <h4 style={{ marginTop: 0 }}>Metric Averages</h4>
              {player.metricAverages.length ? (
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Avg</th>
                      <th>N</th>
                    </tr>
                  </thead>
                  <tbody>
                    {player.metricAverages.map((row) => (
                      <tr key={`${player.playerName}-${row.metric}`}>
                        <td>{row.metric}</td>
                        <td>{`${row.average.toFixed(2)}${row.unit ? ` ${row.unit}` : ''}`}</td>
                        <td>{row.samples}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="portal-muted-text">No metric averages available yet.</p>
              )}
            </div>
            <div>
              <h4 style={{ marginTop: 0 }}>Recent Tests</h4>
              {player.recentTests.length ? (
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Primary Metric</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {player.recentTests.map((row) => (
                      <tr key={`${row.testId}-${row.primaryMetric}`}>
                        <td>{row.date}</td>
                        <td>{row.testType}</td>
                        <td>{row.primaryMetric}</td>
                        <td>{row.primaryValue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="portal-muted-text">No tests returned for this player in the configured lookback window.</p>
              )}
            </div>
          </div>
        </article>
      ) : null}
    </div>
  );
}

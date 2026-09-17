'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { OvrSprintImportPreview, OvrSprintResult, OvrSprintUpload } from '../../../lib/ovr-sprint';
import styles from './ovr-sprint.module.css';

type Props = {
  initialResults: OvrSprintResult[];
  initialUploads: OvrSprintUpload[];
  canImport: boolean;
  viewMode?: 'sprint' | 'imports';
};
type Metric = 'totalTime' | 'splitTime' | 'speedMph';
type Tab = 'athlete' | 'leaderboard' | 'imports';
type DisplayMode = 'individual' | 'dailyAverage' | 'dailyBest';
type ChartPoint = { id: string; date: string; exercise: string; value: number; count: number };
type LeaderboardRow = {
  name: string;
  averages: Record<string, number | null>;
  speeds: Record<string, number | null>;
  bestTimes: Record<string, number | null>;
  bestSpeeds: Record<string, number | null>;
  counts: Record<string, number>;
};
type LeaderValueType = 'average' | 'best';
type PercentileGroup = { id: number; name: string };
type PercentileStat = { value: number | null; percentile: number | null; sampleSize: number };
type PercentileEntry = {
  groupLabel: string;
  stats: { latest: PercentileStat; previous: PercentileStat; change: PercentileStat; average: PercentileStat; peak: PercentileStat };
};
type PercentileResponse = {
  groups?: PercentileGroup[];
  selectedGroupId?: number | 'all';
  results?: Record<string, PercentileEntry>;
  error?: string;
};

const METRICS: Array<{ key: Metric; label: string; shortLabel: string; unit: string; lowerIsBetter: boolean }> = [
  { key: 'totalTime', label: 'Total Time', shortLabel: 'Time', unit: 's', lowerIsBetter: true },
  { key: 'splitTime', label: 'Split Time', shortLabel: 'Split', unit: 's', lowerIsBetter: true },
  { key: 'speedMph', label: 'Speed', shortLabel: 'Speed', unit: 'mph', lowerIsBetter: false },
];
const SPRINT_PANEL_EXERCISES = ['10yd Sprint', '40yd Sprint', '60yd Sprint'] as const;

function metricValue(row: OvrSprintResult, metric: Metric): number | null {
  const value = row[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatValue(value: number | null, metric: Metric): string {
  if (value === null) return '—';
  return metric === 'speedMph' ? value.toFixed(2) : value.toFixed(3);
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return year && month && day ? `${month}/${day}/${String(year).slice(-2)}` : value;
}

function startMethod(row: OvrSprintResult): string {
  if (row.note.includes('start method and OVR speed not provided')) return '—';
  return row.triggerStart ? 'Trigger' : row.inBeamStart ? 'In-beam' : 'Flying';
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const protectedValue = /^[=+@]/.test(raw) || (/^-/.test(raw) && !/^-[\d.]+$/.test(raw)) ? `'${raw}` : raw;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

function downloadCsv(rows: OvrSprintResult[]) {
  const headers = ['Athlete', 'Date', 'Exercise', 'Sprint #', 'Total Time (s)', 'Start', 'Split #', 'Split Time (s)', 'Distance (yd)', 'Speed (mph)', 'Note'];
  const body = rows.map((row) => [row.athleteName, row.date, row.exercise, row.sprintNumber, row.totalTime,
    startMethod(row), row.splitNumber, row.splitTime,
    row.distanceYards ?? '', row.speedMph ?? '', row.note]);
  const csv = `\uFEFF${[headers, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ovr-sprint-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadLeaderboardCsv(rows: LeaderboardRow[], tests: string[], valueType: LeaderValueType) {
  const timeLabel = valueType === 'best' ? 'Best Time (s)' : 'Avg Time (s)';
  const speedLabel = valueType === 'best' ? 'Best Speed (mph)' : 'Avg Speed (mph)';
  const timesByTest = valueType === 'best' ? 'bestTimes' : 'averages';
  const speedsByTest = valueType === 'best' ? 'bestSpeeds' : 'speeds';
  const csv = `\uFEFF${[
    ['Player', ...tests.flatMap((test) => [`${test} ${timeLabel}`, `${test} ${speedLabel}`, `${test} Trials`])],
    ...rows.map((row) => [row.name, ...tests.flatMap((test) => [row[timesByTest][test]?.toFixed(3) ?? '', row[speedsByTest][test]?.toFixed(2) ?? '', String(row.counts[test] ?? 0)])]),
  ].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ovr-sprint-leaderboard-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function uniqueTrials(rows: OvrSprintResult[]): OvrSprintResult[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [row.athleteName, row.date, row.exercise, row.sprintNumber, row.totalTime].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Duplicated (not imported) from lib/ovr-sprint.ts's ovrPercentile: that module
// pulls in node:crypto/pg via lib/auth-db.ts at the top level, so importing it
// here would drag server-only code into the client bundle. Same tie-aware rank
// formula; `invert` flips direction so a lower-is-better metric (sprint time)
// still reports a higher percentile for better performance.
function clientPercentile(value: number | null, population: Array<number | null>, invert: boolean): number | null {
  const sign = invert ? -1 : 1;
  const values = population.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)).map((entry) => entry * sign);
  const target = value !== null && Number.isFinite(value) ? value * sign : null;
  if (target === null || !values.length) return null;
  if (values.length === 1) return 100;
  let lower = 0;
  let equal = 0;
  for (const entry of values) {
    if (entry < target) lower += 1;
    else if (Math.abs(entry - target) < 1e-9) equal += 1;
  }
  return Math.round(((lower + Math.max(0, equal - 1) / 2) / (values.length - 1)) * 100);
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

// Ported from Force Plate's percentile badge (force-plates-dashboard.tsx).
function ordinal(value: number): string {
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  const mod100 = normalized % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : normalized % 10 === 1 ? 'st' : normalized % 10 === 2 ? 'nd' : normalized % 10 === 3 ? 'rd' : 'th';
  return `${normalized}${suffix}`;
}

// Red/yellow/green tiering for percentile badges: bottom third, middle
// third, top third. Same thresholds as Force Plate's percentileTierClass.
function percentileTierClass(percentile: number): string {
  if (percentile < 34) return styles.percentileLow;
  if (percentile < 67) return styles.percentileMid;
  return styles.percentileHigh;
}

function chartPointsForRows(rows: OvrSprintResult[], metric: Metric, displayMode: DisplayMode, lowerIsBetter: boolean): ChartPoint[] {
  const metricRows = metric === 'totalTime' ? uniqueTrials(rows) : rows;
  if (displayMode === 'individual') return metricRows.flatMap((row) => {
    const value = metricValue(row, metric);
    return value === null ? [] : [{ id: String(row.id), date: row.date, exercise: row.exercise, value, count: 1 }];
  });
  const groups = new Map<string, { date: string; exercise: string; values: number[] }>();
  for (const row of metricRows) {
    const value = metricValue(row, metric);
    if (value === null) continue;
    const key = `${row.date}|${row.exercise}`;
    const group = groups.get(key) ?? { date: row.date, exercise: row.exercise, values: [] };
    group.values.push(value);
    groups.set(key, group);
  }
  const reduce = displayMode === 'dailyBest' ? (values: number[]) => (lowerIsBetter ? Math.min(...values) : Math.max(...values)) : (values: number[]) => average(values) ?? 0;
  return [...groups.entries()].map(([id, group]) => ({
    id, date: group.date, exercise: group.exercise, value: reduce(group.values), count: group.values.length,
  })).sort((a, b) => a.date.localeCompare(b.date) || a.exercise.localeCompare(b.exercise));
}

const SERIES_COLORS = ['#e61e49', '#59a9e5', '#52d5a1', '#eab96e', '#c9a5ef'];

function SprintChart({ points, metric, mode, athlete, reduceLabel }: { points: ChartPoint[]; metric: Metric; mode: 'line' | 'bar'; athlete: string; reduceLabel: string }) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  if (!points.length) return <div className={styles.emptyChart}>No qualifying results for these filters.</div>;
  const series = [...new Set(points.map((point) => point.exercise))];
  const dates = [...new Set(points.map((point) => point.date))].sort();
  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = Math.max((maxValue - minValue) * 0.12, metric === 'speedMph' ? 0.5 : 0.08);
  const floor = Math.max(0, minValue - padding);
  const ceiling = maxValue + padding;
  const plotLeft = 58;
  const plotRight = 532;
  const baseline = 194;
  const dateX = (date: string) => dates.length === 1 ? (plotLeft + plotRight) / 2 : plotLeft + (dates.indexOf(date) / (dates.length - 1)) * (plotRight - plotLeft);
  const x = (point: ChartPoint) => {
    const onDate = points.filter((entry) => entry.date === point.date);
    if (onDate.length === 1) return dateX(point.date);
    const step = Math.min(11, (plotRight - plotLeft) / Math.max(1, dates.length * onDate.length * 2));
    return Math.max(plotLeft + 2, Math.min(plotRight - 2, dateX(point.date) + (onDate.indexOf(point) - (onDate.length - 1) / 2) * step));
  };
  const y = (value: number) => baseline - ((value - floor) / Math.max(0.0001, ceiling - floor)) * 170;
  const labelEvery = Math.max(1, Math.ceil(dates.length / 6));
  const seriesPoints = series.map((exercise) => ({ exercise, points: points.filter((point) => point.exercise === exercise) }));
  const hoveredPoint = points.find((point) => point.id === hoverId);
  const tooltipX = hoveredPoint ? Math.max(62, Math.min(350, x(hoveredPoint) + 12)) : 0;
  const tooltipY = hoveredPoint ? Math.max(8, Math.min(150, y(hoveredPoint.value) - 68)) : 0;
  return (
    <div className={styles.chartWrap}>
      <svg viewBox="0 0 560 232" role="img" aria-label={`${METRICS.find((item) => item.key === metric)?.label} trend`}>
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = ceiling - ((ceiling - floor) * tick) / 4;
          const tickY = y(value);
          return <g key={tick}><line x1={plotLeft} x2={plotRight} y1={tickY} y2={tickY} className={styles.gridLine} /><text x="52" y={tickY + 3} textAnchor="end" className={styles.axisText}>{formatValue(value, metric)}</text></g>;
        })}
        {mode === 'line' ? seriesPoints.map((entry, seriesIndex) => {
          const path = entry.points.map((point, index) => `${index ? 'L' : 'M'} ${x(point)} ${y(point.value)}`).join(' ');
          return entry.points.length > 1 ? <path key={entry.exercise} d={path} fill="none" stroke={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]} strokeWidth="2.5" /> : null;
        }) : null}
        {points.map((point) => {
          const seriesIndex = series.indexOf(point.exercise);
          const pointX = x(point);
          const pointY = y(point.value);
          const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length];
          const title = `${point.exercise} · ${formatDate(point.date)} · ${formatValue(point.value, metric)} ${metric === 'speedMph' ? 'mph' : 's'}${point.count > 1 ? ` · ${point.count} trials` : ''}`;
          if (mode === 'bar') {
            const slotWidth = Math.min(38, (plotRight - plotLeft) / Math.max(1, dates.length));
            const barWidth = Math.max(3, (slotWidth - 4) / Math.max(1, series.length));
            const barX = Math.max(plotLeft + 1, Math.min(plotRight - barWidth - 1, pointX - (barWidth * series.length) / 2 + seriesIndex * barWidth));
            return <rect key={point.id} x={barX} y={pointY} width={barWidth} height={baseline - pointY} rx="2" fill={color} opacity={hoverId === point.id ? 1 : .86} tabIndex={0} aria-label={title} onMouseEnter={() => setHoverId(point.id)} onMouseLeave={() => setHoverId(null)} onFocus={() => setHoverId(point.id)} onBlur={() => setHoverId(null)} />;
          }
          return <circle key={point.id} cx={pointX} cy={pointY} r={hoverId === point.id ? 5 : 4} fill={color} stroke="rgba(255,255,255,.9)" strokeWidth="1.3" tabIndex={0} aria-label={title} onMouseEnter={() => setHoverId(point.id)} onMouseLeave={() => setHoverId(null)} onFocus={() => setHoverId(point.id)} onBlur={() => setHoverId(null)} />;
        })}
        {hoveredPoint ? <g role="tooltip" pointerEvents="none">
          <rect x={tooltipX} y={tooltipY} width="194" height="64" rx="8" fill="rgba(15,23,42,.97)" stroke="rgba(230,30,73,.8)" strokeWidth="1" />
          <text x={tooltipX + 10} y={tooltipY + 15} fill="#fff" fontSize="10" fontWeight="800">{athlete}</text>
          <text x={tooltipX + 10} y={tooltipY + 29} fill="#cbd5e1" fontSize="9">{hoveredPoint.exercise} · {formatDate(hoveredPoint.date)}</text>
          <text x={tooltipX + 10} y={tooltipY + 46} fill="#fff" fontSize="13" fontWeight="800">{formatValue(hoveredPoint.value, metric)} {metric === 'speedMph' ? 'mph' : 's'}</text>
          <text x={tooltipX + 10} y={tooltipY + 58} fill="#94a3b8" fontSize="8">{hoveredPoint.count > 1 ? `${reduceLabel} of ${hoveredPoint.count} trials` : 'Individual trial'}</text>
        </g> : null}
        {dates.map((date, index) => index % labelEvery === 0 || index === dates.length - 1 ? <text key={date} x={dateX(date)} y="211" textAnchor="middle" className={styles.axisText}>{formatDate(date)}</text> : null)}
        <text x="295" y="227" textAnchor="middle" className={styles.axisText}>Date</text>
      </svg>
      {series.length > 1 ? <div className={styles.chartLegend}>{series.map((exercise, index) => <span key={exercise}><i style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />{exercise}</span>)}</div> : null}
    </div>
  );
}

export default function OvrSprintDashboard({ initialResults, initialUploads, canImport, viewMode = 'sprint' }: Props) {
  const [results, setResults] = useState(initialResults);
  const [uploads, setUploads] = useState(initialUploads);
  const [tab, setTab] = useState<Tab>(viewMode === 'imports' ? 'imports' : 'athlete');
  const [athlete, setAthlete] = useState(initialResults[0]?.athleteName ?? '');
  const [athleteSearch, setAthleteSearch] = useState('');
  const [athletePickerOpen, setAthletePickerOpen] = useState(false);
  const [exercise, setExercise] = useState(initialResults[0]?.exercise ?? 'All');
  const [distance, setDistance] = useState('All');
  const [metric, setMetric] = useState<Metric>('totalTime');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('dailyAverage');
  const [chartMode, setChartMode] = useState<'line' | 'bar'>('bar');
  const [leaderSort, setLeaderSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'Player', direction: 'asc' });
  const [leaderDisplay, setLeaderDisplay] = useState<'values' | 'percentiles' | 'both'>('values');
  const [leaderValueType, setLeaderValueType] = useState<LeaderValueType>('average');
  const [startDate, setStartDate] = useState(() => initialResults.map((row) => row.date).sort()[0] ?? '');
  const [endDate, setEndDate] = useState(() => initialResults.map((row) => row.date).sort().at(-1) ?? '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<OvrSprintImportPreview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [percentileGroupId, setPercentileGroupId] = useState<'all' | number>('all');
  const [percentileGroups, setPercentileGroups] = useState<PercentileGroup[]>([]);
  const [panelPercentiles, setPanelPercentiles] = useState<Record<string, PercentileEntry>>({});
  const [percentileLoading, setPercentileLoading] = useState(false);
  const [percentileError, setPercentileError] = useState('');

  const athletes = useMemo(() => [...new Set(results.map((row) => row.athleteName))].sort(), [results]);
  const exercises = useMemo(() => [...new Set(results.map((row) => row.exercise))].sort(), [results]);
  const distances = useMemo(() => [...new Set(results.flatMap((row) => row.distanceYards === null ? [] : [row.distanceYards]))].sort((a, b) => a - b), [results]);
  const filtered = useMemo(() => results.filter((row) =>
    (tab !== 'athlete' || row.athleteName === athlete)
    && (tab === 'leaderboard' || exercise === 'All' || row.exercise === exercise)
    && (distance === 'All' || row.distanceYards === Number(distance))
    && (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate)
    && (tab === 'leaderboard' || metricValue(row, metric) !== null)
  ), [athlete, distance, endDate, exercise, metric, results, startDate, tab]);
  const chronological = useMemo(() => [...filtered].sort((a, b) => a.date.localeCompare(b.date) || a.sprintNumber - b.sprintNumber || a.splitNumber - b.splitNumber), [filtered]);
  const metricConfig = METRICS.find((entry) => entry.key === metric) ?? METRICS[0];
  const chartPoints = useMemo(() => chartPointsForRows(chronological, metric, displayMode, metricConfig.lowerIsBetter), [chronological, metric, displayMode, metricConfig.lowerIsBetter]);
  const athletePlayerId = useMemo(() => results.find((row) => row.athleteName === athlete)?.playerId ?? null, [results, athlete]);

  // The three sprint cards are intentionally independent of the chart filters.
  // The chart follows the controls above; the cards consistently summarize
  // the athlete's 10-, 40-, and 60-yard sprint performance.
  const athleteRows = useMemo(() => results.filter((row) =>
    row.athleteName === athlete
    && (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate)
  ), [results, athlete, startDate, endDate]);

  useEffect(() => {
    if (tab !== 'athlete' || !athletePlayerId) {
      setPanelPercentiles({});
      setPercentileError('');
      return;
    }
    let active = true;
    setPercentileLoading(true);
    setPercentileError('');
    const params = new URLSearchParams({
      playerId: String(athletePlayerId),
      metric: 'totalTime',
      groupId: String(percentileGroupId),
    });
    for (const entry of SPRINT_PANEL_EXERCISES) params.append('exercise', entry);
    // Deliberately no startDate/endDate: percentiles always compare against
    // each athlete's and the cohort's full history, not the currently
    // filtered date range -- a narrow filter shouldn't shrink the sample.
    fetch(`/api/ovr-sprint/percentile?${params.toString()}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: PercentileResponse) => {
        if (!active) return;
        if (Array.isArray(payload.groups)) setPercentileGroups(payload.groups);
        if (payload.error) { setPercentileError(payload.error); setPanelPercentiles({}); return; }
        setPanelPercentiles(payload.results ?? {});
      })
      .catch(() => { if (active) { setPercentileError('Unable to load percentile data.'); setPanelPercentiles({}); } })
      .finally(() => { if (active) setPercentileLoading(false); });
    return () => { active = false; };
  }, [tab, athletePlayerId, percentileGroupId]);

  // Each card shows the average time from the latest session and compares it
  // with the average of the athlete's prior sessions in the preceding 30 days.
  const exercisePanels = useMemo(() => {
    return SPRINT_PANEL_EXERCISES.map((exerciseName) => {
      const rows = athleteRows.filter((row) => row.exercise === exerciseName);
      const values = uniqueTrials(rows)
        .map((row) => ({ date: row.date, value: row.totalTime }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const latestDate = values.at(-1)?.date ?? null;
      const latestDateValues = latestDate ? values.filter((entry) => entry.date === latestDate).map((entry) => entry.value) : [];
      const headline = average(latestDateValues);

      let trendPct: number | null = null;
      if (latestDate) {
        const cutoff = new Date(latestDate);
        cutoff.setDate(cutoff.getDate() - 30);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        const baselineDates = new Map<string, number[]>();
        for (const entry of values) {
          if (entry.date >= latestDate || entry.date < cutoffStr) continue;
          baselineDates.set(entry.date, [...(baselineDates.get(entry.date) ?? []), entry.value]);
        }
        const baselinePerDay = [...baselineDates.values()].map((dayValues) => average(dayValues) ?? 0);
        const baselineAvg = average(baselinePerDay);
        if (headline !== null && baselineAvg !== null && baselineAvg !== 0) {
          trendPct = ((headline - baselineAvg) / Math.abs(baselineAvg)) * 100;
        }
      }
      const favorable = trendPct === null || Math.abs(trendPct) < .0001 ? null : trendPct < 0;
      const percentileEntry = panelPercentiles[exerciseName];
      return {
        exercise: exerciseName,
        unit: 's',
        headline,
        headlinePercentile: percentileEntry?.stats.latest ?? null,
        trendPct,
        favorable,
        latestDate,
      };
    });
  }, [athleteRows, panelPercentiles]);

  const leaderboard = useMemo(() => {
    const grouped = new Map<string, Map<string, { times: number[]; speeds: number[] }>>();
    for (const row of uniqueTrials(filtered)) {
      const player = grouped.get(row.athleteName) ?? new Map<string, { times: number[]; speeds: number[] }>();
      const test = player.get(row.exercise) ?? { times: [], speeds: [] };
      test.times.push(row.totalTime);
      if (row.speedMph !== null) test.speeds.push(row.speedMph);
      player.set(row.exercise, test);
      grouped.set(row.athleteName, player);
    }
    const rows = [...grouped.entries()].map(([name, tests]): LeaderboardRow => ({
      name,
      averages: Object.fromEntries([...tests.entries()].map(([test, values]) => [test, average(values.times)])),
      speeds: Object.fromEntries([...tests.entries()].map(([test, values]) => [test, average(values.speeds)])),
      bestTimes: Object.fromEntries([...tests.entries()].map(([test, values]) => [test, values.times.length ? Math.min(...values.times) : null])),
      bestSpeeds: Object.fromEntries([...tests.entries()].map(([test, values]) => [test, values.speeds.length ? Math.max(...values.speeds) : null])),
      counts: Object.fromEntries([...tests.entries()].map(([test, values]) => [test, values.times.length])),
    }));
    const timesByTest = leaderValueType === 'best' ? 'bestTimes' : 'averages';
    const speedsByTest = leaderValueType === 'best' ? 'bestSpeeds' : 'speeds';
    return rows.sort((a, b) => {
      if (leaderSort.key === 'Player') return leaderSort.direction === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      const isSpeed = leaderSort.key.startsWith('speed:');
      const test = leaderSort.key.slice(isSpeed ? 6 : 5);
      const aValue = (isSpeed ? a[speedsByTest] : a[timesByTest])[test] ?? null;
      const bValue = (isSpeed ? b[speedsByTest] : b[timesByTest])[test] ?? null;
      if (aValue === null && bValue === null) return a.name.localeCompare(b.name);
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      return leaderSort.direction === 'asc' ? aValue - bValue || a.name.localeCompare(b.name) : bValue - aValue || a.name.localeCompare(b.name);
    });
  }, [filtered, leaderSort, leaderValueType]);

  // Percentile per cell, computed against everyone currently shown in the
  // leaderboard (same population the table already displays -- no group
  // selector on this tab, per the user's choice to keep it simple). Time is
  // inverted (lower = better = higher percentile); speed is not. Recomputed
  // against whichever value type (average/best) is currently selected so a
  // player's percentile always reflects the same numbers shown in the cell.
  const leaderboardPercentiles = useMemo(() => {
    const timesKey = leaderValueType === 'best' ? 'bestTimes' : 'averages';
    const speedsKey = leaderValueType === 'best' ? 'bestSpeeds' : 'speeds';
    const timesByTest = new Map<string, Array<number | null>>();
    const speedsByTest = new Map<string, Array<number | null>>();
    for (const row of leaderboard) {
      for (const [test, value] of Object.entries(row[timesKey])) {
        timesByTest.set(test, [...(timesByTest.get(test) ?? []), value]);
      }
      for (const [test, value] of Object.entries(row[speedsKey])) {
        speedsByTest.set(test, [...(speedsByTest.get(test) ?? []), value]);
      }
    }
    const result = new Map<string, { time: number | null; speed: number | null }>();
    for (const row of leaderboard) {
      for (const test of Object.keys(row.averages)) {
        const time = clientPercentile(row[timesKey][test] ?? null, timesByTest.get(test) ?? [], true);
        const speed = clientPercentile(row[speedsKey][test] ?? null, speedsByTest.get(test) ?? [], false);
        result.set(`${row.name}|${test}`, { time, speed });
      }
    }
    return result;
  }, [leaderboard, leaderValueType]);

  function sortLeaderboard(key: string) {
    setLeaderSort((current) => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: key.startsWith('speed:') ? 'desc' : 'asc' });
  }

  async function refreshData() {
    const response = await fetch('/api/ovr-sprint', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'Unable to refresh OVR data.');
    setResults(payload.results ?? []);
    setUploads(payload.uploads ?? []);
    if (!athlete && payload.results?.[0]?.athleteName) setAthlete(payload.results[0].athleteName);
  }

  async function submitFile(action: 'preview' | 'import') {
    if (!selectedFile) return;
    setUploading(true); setError(''); setNotice('');
    try {
      const form = new FormData(); form.append('action', action); form.append('file', selectedFile);
      const response = await fetch('/api/ovr-sprint', { method: 'POST', body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to process this export.');
      if (action === 'preview') setPreview(payload.preview);
      else {
        const upload = payload.upload as OvrSprintUpload;
        const newRows = Number(payload.newRows ?? upload.insertedRows);
        setNotice(payload.duplicateFile ? 'This exact export was already imported. No duplicates were added.' : `${newRows} new Sprint/VBT result${newRows === 1 ? '' : 's'} imported. ${upload.unmatchedRows ? `${upload.unmatchedRows} unmatched row${upload.unmatchedRows === 1 ? '' : 's'} held for review.` : 'Every athlete matched the PCU roster.'}`);
        setPreview(null); setSelectedFile(null); if (fileRef.current) fileRef.current.value = '';
        await refreshData();
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to process this export.'); }
    finally { setUploading(false); }
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.commandBar}>
        <div><p className={styles.eyebrow}>SPEED LAB</p><h3>{tab === 'athlete' ? athlete || 'Athlete analysis' : tab === 'leaderboard' ? 'Organization leaderboard' : 'Data intake'}</h3></div>
        {viewMode === 'sprint' ? <div className={styles.tabs} role="tablist">
          <button className={tab === 'athlete' ? styles.active : ''} onClick={() => setTab('athlete')}>Athlete</button>
          <button className={tab === 'leaderboard' ? styles.active : ''} onClick={() => setTab('leaderboard')}>Leaderboard</button>
        </div> : null}
      </section>

      {tab !== 'imports' ? <>
        {tab === 'athlete' ? <section className={styles.filterPanel}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>01 · BUILD THE VIEW</p><h3>Analysis controls</h3></div><div className={styles.presets} aria-label="Date range presets"><button onClick={() => setStartDate(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))}>30D</button><button onClick={() => setStartDate(new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))}>90D</button><button onClick={() => setStartDate(results.map((row) => row.date).sort()[0] ?? '')}>ALL</button></div></div>
          <div className={styles.primaryFilters}>
            <div className={styles.playerField}><span>Athlete</span><div className={styles.athletePicker}><button type="button" aria-expanded={athletePickerOpen} onClick={() => setAthletePickerOpen((open) => !open)}><span>{athlete || 'Select an athlete'}</span><b aria-hidden="true">⌄</b></button>{athletePickerOpen ? <div className={styles.athleteMenu}><input type="search" autoFocus value={athleteSearch} onChange={(event) => setAthleteSearch(event.target.value)} placeholder="Search athletes…" /><div className={styles.athleteMenuList}>{athletes.filter((name) => name.toLowerCase().includes(athleteSearch.toLowerCase())).map((name) => <button type="button" key={name} className={name === athlete ? styles.athleteSelected : ''} onClick={() => { setAthlete(name); setAthleteSearch(''); setAthletePickerOpen(false); }}>{name}</button>)}{!athletes.some((name) => name.toLowerCase().includes(athleteSearch.toLowerCase())) ? <p>No athletes match that search.</p> : null}</div></div> : null}</div></div>
            <label><span>Metric</span><select value={metric} onChange={(event) => setMetric(event.target.value as Metric)}>{METRICS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label} ({entry.unit})</option>)}</select></label>
          </div>
          <div className={styles.secondaryFilters}>
            <label><span>Sprint test</span><select value={exercise} onChange={(event) => setExercise(event.target.value)}><option>All</option>{exercises.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
            <label><span>Distance</span><select value={distance} onChange={(event) => setDistance(event.target.value)}><option>All</option>{distances.map((entry) => <option key={entry} value={entry}>{entry} yd</option>)}</select></label>
            <label><span>Show</span><select value={displayMode} onChange={(event) => setDisplayMode(event.target.value as DisplayMode)}><option value="individual">Individual trials</option><option value="dailyAverage">Average per date</option><option value="dailyBest">Best per date</option></select></label>
            <label><span>From</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label><span>Through</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          </div>
        </section> : null}

        {tab === 'athlete' ? <>
          <section className={styles.chartPanel}>
            <div className={styles.sectionHeading}>
              <div><p className={styles.eyebrow}>02 · PERFORMANCE SIGNAL</p><h3>Sprint test summary</h3><p>Latest session average · percentile and prior 30-day trend</p></div>
              <div className={styles.panelControls}>
                <label><span>Compare against</span><select value={String(percentileGroupId)} onChange={(event) => setPercentileGroupId(event.target.value === 'all' ? 'all' : Number(event.target.value))}><option value="all">All PCU athletes</option>{percentileGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
              </div>
            </div>
            {percentileError ? <p className={styles.error}>{percentileError}</p> : null}
            {exercisePanels.length ? <div className={styles.exercisePanelGrid}>
              {exercisePanels.map((panel) => (
                <article key={panel.exercise} className={styles.exercisePanel}>
                  <div className={styles.kpiLabelRow}>
                    <span>{panel.exercise}</span>
                    {percentileLoading ? <span className={styles.percentileBadge}>Ranking…</span>
                      : panel.headlinePercentile?.percentile != null ? <span className={`${styles.percentileBadge} ${percentileTierClass(panel.headlinePercentile.percentile)}`} title={`Compared with ${panel.headlinePercentile.sampleSize} athlete${panel.headlinePercentile.sampleSize === 1 ? '' : 's'} with qualifying data`}>{ordinal(panel.headlinePercentile.percentile)} percentile</span>
                      : <span className={`${styles.percentileBadge} ${styles.percentileUnavailable}`}>No rank</span>}
                  </div>
                  <strong>
                    {panel.headline === null ? '—' : formatValue(panel.headline, 'totalTime')}
                    {panel.headline !== null ? <small className={styles.statUnit}>{panel.unit}</small> : null}
                  </strong>
                  {panel.trendPct !== null ? (
                    <span className={panel.favorable === null ? undefined : panel.favorable ? styles.good : styles.bad}>
                      {panel.trendPct > 0 ? '▲' : panel.trendPct < 0 ? '▼' : '→'} {Math.abs(panel.trendPct).toFixed(1)}% vs. prior 30-day avg
                    </span>
                  ) : <span>{panel.latestDate ? `Latest session · ${formatDate(panel.latestDate)}` : 'No qualifying session'}</span>}
                </article>
              ))}
            </div> : <p className={styles.emptyChart}>No qualifying results for this athlete in this date range.</p>}
            <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>03 · TREND</p><h3>{metricConfig.label}</h3><p>{exercise === 'All' ? 'All sprint tests' : exercise} · {displayMode === 'dailyAverage' ? 'Average per date' : displayMode === 'dailyBest' ? 'Best per date' : 'Individual trials'} · {startDate || 'First result'} to {endDate || 'Latest result'}</p></div><span className={styles.liveBadge}><i /> {chartPoints.length} {displayMode === 'individual' ? 'results' : 'dates / tests'}</span></div>
            <div className={styles.chartActions}><span>{metricConfig.unit} · Lower time is faster</span><div className={styles.segmented}><button className={chartMode === 'line' ? styles.active : ''} onClick={() => setChartMode('line')}>Line</button><button className={chartMode === 'bar' ? styles.active : ''} onClick={() => setChartMode('bar')}>Bars</button></div></div>
            <SprintChart points={chartPoints} metric={metric} mode={chartMode} athlete={athlete} reduceLabel={displayMode === 'dailyBest' ? 'Best' : 'Average'} />
          </section>
        </> : <section className={styles.leaderboardPanel}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>ORGANIZATION VIEW</p><h3>Sprint leaderboard</h3><p>{leaderValueType === 'best' ? 'Best' : 'Average'} time and recorded speed by sprint distance, with trial counts. Click a measure to sort.</p></div><button className={styles.exportButton} onClick={() => downloadLeaderboardCsv(leaderboard, exercises, leaderValueType)}>Export CSV</button></div>
          <div className={styles.leaderFilters}>
            <label><span>Distance</span><select value={distance} onChange={(event) => setDistance(event.target.value)}><option>All</option>{distances.map((entry) => <option key={entry} value={entry}>{entry} yd</option>)}</select></label>
            <label><span>Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label><span>End date</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
            <div className={styles.displayToggle}>
              <span>Value</span>
              <div className={styles.displayToggleGroup} role="group" aria-label="Leaderboard value type">
                <button type="button" className={leaderValueType === 'average' ? styles.active : undefined} onClick={() => setLeaderValueType('average')}>Average</button>
                <button type="button" className={leaderValueType === 'best' ? styles.active : undefined} onClick={() => setLeaderValueType('best')}>Best</button>
              </div>
            </div>
            <div className={styles.displayToggle}>
              <span>Display</span>
              <div className={styles.displayToggleGroup} role="group" aria-label="Leaderboard display">
                <button type="button" className={leaderDisplay === 'values' ? styles.active : undefined} onClick={() => setLeaderDisplay('values')}>Values</button>
                <button type="button" className={leaderDisplay === 'percentiles' ? styles.active : undefined} onClick={() => setLeaderDisplay('percentiles')}>Percentiles</button>
                <button type="button" className={leaderDisplay === 'both' ? styles.active : undefined} onClick={() => setLeaderDisplay('both')}>Values + percentiles</button>
              </div>
            </div>
          </div>
          <div className={styles.tableScroll}><table className={styles.leaderTable} style={{ minWidth: `${Math.max(640, 180 + exercises.length * 340)}px` }}><thead>
            <tr><th rowSpan={2} className={leaderSort.key === 'Player' ? styles.sortedColumn : ''}><button type="button" onClick={() => sortLeaderboard('Player')}>Player {leaderSort.key === 'Player' ? (leaderSort.direction === 'asc' ? '↑' : '↓') : ''}</button></th>{exercises.map((test) => <th key={test} colSpan={3} className={styles.testGroup}>{test}</th>)}</tr>
            <tr>{exercises.flatMap((test) => [
              <th key={`${test}-time`} className={leaderSort.key === `time:${test}` ? styles.sortedColumn : ''}><button type="button" onClick={() => sortLeaderboard(`time:${test}`)}>{leaderValueType === 'best' ? 'Best' : 'Avg'} time (s) {leaderSort.key === `time:${test}` ? (leaderSort.direction === 'asc' ? '↑' : '↓') : ''}</button></th>,
              <th key={`${test}-speed`} className={leaderSort.key === `speed:${test}` ? styles.sortedColumn : ''}><button type="button" onClick={() => sortLeaderboard(`speed:${test}`)}>{leaderValueType === 'best' ? 'Best' : 'Avg'} speed (mph) {leaderSort.key === `speed:${test}` ? (leaderSort.direction === 'asc' ? '↑' : '↓') : ''}</button></th>,
              <th key={`${test}-trials`}>Trials</th>,
            ])}</tr>
          </thead><tbody>{leaderboard.map((row) => <tr key={row.name}><td>{row.name}</td>{exercises.flatMap((test) => {
            const pct = leaderboardPercentiles.get(`${row.name}|${test}`);
            const timeValue = leaderValueType === 'best' ? row.bestTimes[test] : row.averages[test];
            const speedValue = leaderValueType === 'best' ? row.bestSpeeds[test] : row.speeds[test];
            const count = row.counts[test] ?? 0;
            const timeText = timeValue === null || timeValue === undefined ? '—' : `${timeValue.toFixed(3)} s`;
            const speedText = speedValue === null || speedValue === undefined ? '—' : `${speedValue.toFixed(2)} mph`;
            const timePctText = pct?.time != null ? `${pct.time}th` : '—';
            const speedPctText = pct?.speed != null ? `${pct.speed}th` : '—';
            return [
              <td key={`${test}-time`} className={leaderSort.key === `time:${test}` ? styles.sortedCell : ''}>
                {leaderDisplay === 'values' ? timeText : leaderDisplay === 'percentiles' ? timePctText : `${timeText} (${timePctText})`}
              </td>,
              <td key={`${test}-speed`} className={leaderSort.key === `speed:${test}` ? styles.sortedCell : ''}>
                {leaderDisplay === 'values' ? speedText : leaderDisplay === 'percentiles' ? speedPctText : `${speedText} (${speedPctText})`}
              </td>,
              <td key={`${test}-trials`} className={styles.trialsCell}>{count || '—'}</td>,
            ];
          })}</tr>)}</tbody></table></div>
        </section>}

        {tab === 'athlete' ? <section className={styles.tablePanel}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>03 · RESULT LOG</p><h3>{displayMode !== 'individual' ? `${chartPoints.length} date / test ${displayMode === 'dailyBest' ? 'bests' : 'averages'}` : `${filtered.length} qualifying trials`}</h3></div><button className={styles.exportButton} onClick={() => downloadCsv(filtered)}>Export CSV</button></div>
          {displayMode !== 'individual' ? <div className={styles.tableScroll}><table><thead><tr><th>Date</th><th>Test</th><th>Trials</th><th>{displayMode === 'dailyBest' ? 'Best' : 'Average'} {metricConfig.label}</th></tr></thead><tbody>{[...chartPoints].reverse().map((point) => <tr key={point.id}><td>{formatDate(point.date)}</td><td>{point.exercise}</td><td>{point.count}</td><td>{formatValue(point.value, metric)} {metricConfig.unit}</td></tr>)}</tbody></table></div> :
          <div className={styles.tableScroll}><table><thead><tr><th>Date</th><th>Test</th><th>Sprint</th><th>Total</th><th>Split</th><th>Distance</th><th>Speed</th><th>Start</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td>{formatDate(row.date)}</td><td>{row.exercise}</td><td>#{row.sprintNumber}</td><td>{row.totalTime.toFixed(3)} s</td><td>#{row.splitNumber} · {row.splitTime.toFixed(3)} s</td><td>{row.distanceYards === null ? '—' : `${row.distanceYards} yd`}</td><td>{row.speedMph === null ? '—' : `${row.speedMph.toFixed(2)} mph`}</td><td>{startMethod(row)}</td></tr>)}</tbody></table></div>
          }
        </section> : null}
      </> : <section className={styles.importPanel}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>01 · IMPORT OVR CONNECT</p><h3>Bring OVR results into Pearl</h3><p>Upload the original OVR workbook. Pearl imports both Sprint and Velocity (VBT) sheets.</p></div></div>
        <div className={styles.dropzone}>
          <label className={styles.filePicker}>
            <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={(event) => { setSelectedFile(event.target.files?.[0] ?? null); setPreview(null); setNotice(''); setError(''); }} />
            <span className={styles.filePickerIcon} aria-hidden="true">↑</span>
            <span><strong>{selectedFile ? 'Change file' : 'Select OVR file'}</strong><small>Browse your computer</small></span>
          </label>
          <div className={styles.fileDetails}><strong>{selectedFile?.name ?? 'No file selected'}</strong><span>.xlsx workbook or Sprint .csv · 12 MB maximum</span></div>
          <button disabled={!selectedFile || uploading} onClick={() => submitFile('preview')}>{uploading ? 'Reading…' : 'Preview file'}</button>
        </div>
        {preview ? <div className={styles.previewCard}><div><p>Sprint results</p><strong>{preview.sprintRows}</strong></div><div><p>VBT results</p><strong>{preview.vbtRows}</strong></div><div><p>Athletes</p><strong>{preview.athletes.length}</strong></div><div><p>Date range</p><strong>{preview.minDate ? `${formatDate(preview.minDate)} – ${formatDate(preview.maxDate ?? preview.minDate)}` : '—'}</strong></div><button disabled={uploading} onClick={() => submitFile('import')}>Import results</button>{preview.warnings.length ? <p className={styles.warning}>{preview.warnings.join(' ')}</p> : null}</div> : null}
        {notice ? <p className={styles.notice}>{notice}</p> : null}{error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.importHistory}><h3>Import history</h3>{uploads.length ? uploads.map((upload) => <article key={upload.id}><div><strong>{upload.fileName}</strong><span>{new Date(upload.createdAt).toLocaleString()} · {upload.minDate ? `${formatDate(upload.minDate)} – ${formatDate(upload.maxDate ?? upload.minDate)}` : 'No dates'}</span></div><b>{upload.insertedRows} added</b><em>{upload.unmatchedRows ? `${upload.unmatchedRows} unmatched: ${upload.unmatchedAthletes.join(', ')}` : 'Roster matched'}</em></article>) : <p>No OVR exports have been imported yet.</p>}</div>
      </section>}
    </div>
  );
}

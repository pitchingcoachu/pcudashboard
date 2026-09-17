'use client';

import { useEffect, useMemo, useState } from 'react';
import type { OvrVbtResult } from '../../../lib/ovr-sprint';
import styles from './ovr-sprint.module.css';

type Props = { initialResults: OvrVbtResult[] };
type ViewTab = 'athlete' | 'leaderboard';
type DisplayMode = 'individual' | 'dailyAverage' | 'dailyBest';
type MetricKey = 'loadLbs' | 'targetMin' | 'targetMax' | 'avgVelocity' | 'peakVelocity' | 'avgPower' | 'peakPower' | 'romInches' | 'durationSeconds' | 'tpvSeconds' | 'eaIndex';
type MetricConfig = { key: MetricKey; label: string; unit: string; decimals: number; lowerIsBetter: boolean };
type Point = { id: string; date: string; exercise: string; value: number; count: number };
type PercentileGroup = { id: number; name: string };
type PercentileStat = { value: number | null; percentile: number | null; sampleSize: number };
type VbtPercentileResponse = {
  groups?: PercentileGroup[];
  result?: { groupLabel: string; stats: Partial<Record<MetricKey, PercentileStat>> };
  error?: string;
};

const METRICS: MetricConfig[] = [
  { key: 'loadLbs', label: 'Load', unit: 'lb', decimals: 1, lowerIsBetter: false },
  { key: 'targetMin', label: 'Target Min', unit: '', decimals: 2, lowerIsBetter: false },
  { key: 'targetMax', label: 'Target Max', unit: '', decimals: 2, lowerIsBetter: false },
  { key: 'avgVelocity', label: 'Average Velocity', unit: 'm/s', decimals: 2, lowerIsBetter: false },
  { key: 'peakVelocity', label: 'Peak Velocity', unit: 'm/s', decimals: 2, lowerIsBetter: false },
  { key: 'avgPower', label: 'Average Power', unit: 'W', decimals: 0, lowerIsBetter: false },
  { key: 'peakPower', label: 'Peak Power', unit: 'W', decimals: 0, lowerIsBetter: false },
  { key: 'romInches', label: 'Range of Motion', unit: 'in', decimals: 1, lowerIsBetter: false },
  { key: 'durationSeconds', label: 'Duration', unit: 's', decimals: 2, lowerIsBetter: true },
  { key: 'tpvSeconds', label: 'Time to Peak Velocity', unit: 's', decimals: 2, lowerIsBetter: true },
  { key: 'eaIndex', label: 'EA Index', unit: '', decimals: 2, lowerIsBetter: false },
];

const COLORS = ['#e61e49', '#59a9e5', '#52d5a1', '#eab96e', '#c9a5ef'];

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function valueOf(row: OvrVbtResult, metric: MetricKey): number | null {
  const value = row[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dateLabel(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${Number(month)}/${Number(day)}/${year.slice(-2)}` : value;
}

function formatValue(value: number | null, config: MetricConfig): string {
  return value === null ? '—' : value.toFixed(config.decimals);
}

function defaultExerciseForAthlete(results: OvrVbtResult[], athleteName: string): string {
  const athleteExercises = [...new Set(results.filter((row) => row.athleteName === athleteName).map((row) => row.exercise))].sort();
  return athleteExercises.find((name) => name.trim().toLowerCase() === 'trap bar deadlift') ?? athleteExercises[0] ?? 'All';
}

function ordinal(value: number): string {
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  const mod100 = normalized % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : normalized % 10 === 1 ? 'st' : normalized % 10 === 2 ? 'nd' : normalized % 10 === 3 ? 'rd' : 'th';
  return `${normalized}${suffix}`;
}

function percentileTierClass(percentile: number): string {
  if (percentile < 34) return styles.percentileLow;
  if (percentile < 67) return styles.percentileMid;
  return styles.percentileHigh;
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsv(rows: OvrVbtResult[]) {
  const headers = ['Athlete', 'Sport', 'Position', 'Group(s)', 'Date', 'Exercise', 'Set #', 'Load (lb)', 'Target Type', 'Target Min', 'Target Max', 'Rep #', 'Avg Velocity (m/s)', 'Peak Velocity (m/s)', 'Avg Power (W)', 'Peak Power (W)', 'ROM (in)', 'Duration (s)', 'TPV (s)', 'EA Index', 'Set Note'];
  const body = rows.map((row) => [row.athleteName, row.sport, row.position, row.groups, row.date, row.exercise, row.setNumber, row.loadLbs ?? '', row.targetType, row.targetMin ?? '', row.targetMax ?? '', row.repNumber, row.avgVelocity ?? '', row.peakVelocity ?? '', row.avgPower ?? '', row.peakPower ?? '', row.romInches ?? '', row.durationSeconds ?? '', row.tpvSeconds ?? '', row.eaIndex ?? '', row.note]);
  const blob = new Blob([`\uFEFF${[headers, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ovr-vbt-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function makePoints(rows: OvrVbtResult[], metric: MetricKey, mode: DisplayMode, lowerIsBetter: boolean): Point[] {
  if (mode === 'individual') return rows.flatMap((row) => {
    const value = valueOf(row, metric);
    return value === null ? [] : [{ id: String(row.id), date: row.date, exercise: row.exercise, value, count: 1 }];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const groups = new Map<string, { date: string; exercise: string; values: number[] }>();
  for (const row of rows) {
    const value = valueOf(row, metric);
    if (value === null) continue;
    const key = `${row.date}|${row.exercise}`;
    const group = groups.get(key) ?? { date: row.date, exercise: row.exercise, values: [] };
    group.values.push(value);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([id, group]) => ({
    id, date: group.date, exercise: group.exercise, count: group.values.length,
    value: mode === 'dailyBest' ? (lowerIsBetter ? Math.min(...group.values) : Math.max(...group.values)) : average(group.values) ?? 0,
  })).sort((a, b) => a.date.localeCompare(b.date) || a.exercise.localeCompare(b.exercise));
}

function VbtChart({ points, config, mode, athlete }: { points: Point[]; config: MetricConfig; mode: 'line' | 'bar'; athlete: string }) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  if (!points.length) return <div className={styles.emptyChart}>No qualifying VBT results for these filters.</div>;
  const dates = [...new Set(points.map((point) => point.date))].sort();
  const series = [...new Set(points.map((point) => point.exercise))];
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * .12, Math.abs(max || 1) * .04);
  const floor = Math.max(0, min - padding);
  const ceiling = max + padding;
  const left = 62;
  const right = 532;
  const baseline = 194;
  const dateX = (date: string) => dates.length === 1 ? (left + right) / 2 : left + (dates.indexOf(date) / (dates.length - 1)) * (right - left);
  const x = (point: Point) => {
    const sameDate = points.filter((entry) => entry.date === point.date);
    const offset = (sameDate.indexOf(point) - (sameDate.length - 1) / 2) * Math.min(10, 32 / Math.max(1, sameDate.length));
    return Math.max(left + 3, Math.min(right - 3, dateX(point.date) + offset));
  };
  const y = (value: number) => baseline - ((value - floor) / Math.max(.00001, ceiling - floor)) * 166;
  const labelEvery = Math.max(1, Math.ceil(dates.length / 6));
  const hovered = points.find((point) => point.id === hoverId);
  return <div className={styles.chartWrap}>
    <svg viewBox="0 0 560 232" role="img" aria-label={`${config.label} VBT trend`}>
      {[0, 1, 2, 3, 4].map((tick) => {
        const value = ceiling - ((ceiling - floor) * tick) / 4;
        return <g key={tick}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className={styles.gridLine} /><text x="55" y={y(value) + 3} textAnchor="end" className={styles.axisText}>{formatValue(value, config)}</text></g>;
      })}
      {mode === 'line' ? series.map((exercise, index) => {
        const entries = points.filter((point) => point.exercise === exercise);
        return entries.length > 1 ? <path key={exercise} d={entries.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'} ${x(point)} ${y(point.value)}`).join(' ')} fill="none" stroke={COLORS[index % COLORS.length]} strokeWidth="2.5" /> : null;
      }) : null}
      {points.map((point) => {
        const color = COLORS[series.indexOf(point.exercise) % COLORS.length];
        const pointX = x(point);
        const pointY = y(point.value);
        if (mode === 'bar') {
          const width = Math.max(4, Math.min(22, (right - left) / Math.max(1, points.length) - 4));
          return <rect key={point.id} x={pointX - width / 2} y={pointY} width={width} height={baseline - pointY} rx="2" fill={color} opacity={hoverId === point.id ? 1 : .88} onMouseEnter={() => setHoverId(point.id)} onMouseLeave={() => setHoverId(null)} />;
        }
        return <circle key={point.id} cx={pointX} cy={pointY} r={hoverId === point.id ? 5 : 4} fill={color} stroke="#fff" strokeWidth="1.2" onMouseEnter={() => setHoverId(point.id)} onMouseLeave={() => setHoverId(null)} />;
      })}
      {dates.map((date, index) => index % labelEvery === 0 || index === dates.length - 1 ? <text key={date} x={dateX(date)} y="211" textAnchor="middle" className={styles.axisText}>{dateLabel(date)}</text> : null)}
      <text x="295" y="227" textAnchor="middle" className={styles.axisText}>Date</text>
      {hovered ? <g pointerEvents="none"><rect x={Math.max(65, Math.min(345, x(hovered) + 10))} y={Math.max(8, y(hovered.value) - 62)} width="202" height="55" rx="8" fill="rgba(15,23,42,.97)" stroke="rgba(230,30,73,.8)" /><text x={Math.max(75, Math.min(355, x(hovered) + 20))} y={Math.max(24, y(hovered.value) - 46)} fill="#fff" fontSize="10" fontWeight="800">{athlete} · {hovered.exercise}</text><text x={Math.max(75, Math.min(355, x(hovered) + 20))} y={Math.max(41, y(hovered.value) - 29)} fill="#fff" fontSize="13" fontWeight="800">{formatValue(hovered.value, config)} {config.unit}</text><text x={Math.max(75, Math.min(355, x(hovered) + 20))} y={Math.max(53, y(hovered.value) - 17)} fill="#94a3b8" fontSize="8">{dateLabel(hovered.date)}{hovered.count > 1 ? ` · ${hovered.count} reps` : ''}</text></g> : null}
    </svg>
    {series.length > 1 ? <div className={styles.chartLegend}>{series.map((exercise, index) => <span key={exercise}><i style={{ background: COLORS[index % COLORS.length] }} />{exercise}</span>)}</div> : null}
  </div>;
}

export default function OvrVbtDashboard({ initialResults }: Props) {
  const initialAthlete = initialResults[0]?.athleteName ?? '';
  const [tab, setTab] = useState<ViewTab>('athlete');
  const [athlete, setAthlete] = useState(initialAthlete);
  const [exercise, setExercise] = useState(() => defaultExerciseForAthlete(initialResults, initialAthlete));
  const [load, setLoad] = useState('All');
  const [metric, setMetric] = useState<MetricKey>('avgVelocity');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('dailyAverage');
  const [chartMode, setChartMode] = useState<'line' | 'bar'>('bar');
  const [percentileGroupId, setPercentileGroupId] = useState<'all' | number>('all');
  const [percentileGroups, setPercentileGroups] = useState<PercentileGroup[]>([]);
  const [percentiles, setPercentiles] = useState<Partial<Record<MetricKey, PercentileStat>>>({});
  const [percentileLoading, setPercentileLoading] = useState(false);
  const [percentileError, setPercentileError] = useState('');
  const allDates = useMemo(() => initialResults.map((row) => row.date).sort(), [initialResults]);
  const [startDate, setStartDate] = useState(allDates[0] ?? '');
  const [endDate, setEndDate] = useState(allDates.at(-1) ?? '');
  const athletes = useMemo(() => [...new Set(initialResults.map((row) => row.athleteName))].sort(), [initialResults]);
  const exercises = useMemo(() => [...new Set(initialResults.map((row) => row.exercise))].sort(), [initialResults]);
  const athleteExercises = useMemo(() => [...new Set(initialResults.filter((row) => row.athleteName === athlete).map((row) => row.exercise))].sort(), [athlete, initialResults]);
  const loads = useMemo(() => [...new Set(initialResults.flatMap((row) => row.loadLbs === null ? [] : [row.loadLbs]))].sort((a, b) => a - b), [initialResults]);
  const config = METRICS.find((entry) => entry.key === metric) ?? METRICS[3];
  const athletePlayerId = useMemo(() => initialResults.find((row) => row.athleteName === athlete)?.playerId ?? null, [athlete, initialResults]);
  const percentileApplicable = tab === 'athlete' && Boolean(athletePlayerId) && exercise !== 'All';
  const filtered = useMemo(() => initialResults.filter((row) =>
    (tab === 'leaderboard' || row.athleteName === athlete) && (exercise === 'All' || row.exercise === exercise)
    && (load === 'All' || row.loadLbs === Number(load))
    && (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate) && valueOf(row, metric) !== null
  ), [athlete, endDate, exercise, initialResults, load, metric, startDate, tab]);
  const points = useMemo(() => makePoints(filtered, metric, displayMode, config.lowerIsBetter), [config.lowerIsBetter, displayMode, filtered, metric]);
  const panelRows = useMemo(() => initialResults
    .filter((row) => row.athleteName === athlete && (exercise === 'All' || row.exercise === exercise)
      && (load === 'All' || row.loadLbs === Number(load))
      && (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate))
    .sort((a, b) => a.date.localeCompare(b.date) || a.setNumber - b.setNumber || a.repNumber - b.repNumber), [athlete, endDate, exercise, initialResults, load, startDate]);
  const latestSessionDate = panelRows.at(-1)?.date ?? null;
  const latestSessionRows = useMemo(() => latestSessionDate ? panelRows.filter((row) => row.date === latestSessionDate) : [], [latestSessionDate, panelRows]);
  const signalCards: Array<{ key: MetricKey; label: string; unit: string; decimals: number }> = [
    { key: 'peakPower', label: 'Peak Power (W)', unit: 'W', decimals: 0 },
    { key: 'avgPower', label: 'Average Power (W)', unit: 'W', decimals: 0 },
    { key: 'tpvSeconds', label: 'Time to Peak Velocity (s)', unit: 's', decimals: 2 },
    { key: 'peakVelocity', label: 'Peak Velocity (m/s)', unit: 'm/s', decimals: 2 },
    { key: 'avgVelocity', label: 'Average Velocity (m/s)', unit: 'm/s', decimals: 2 },
  ];
  const signalCardData = signalCards.map((card) => {
    const currentValues = latestSessionRows.flatMap((row) => { const value = valueOf(row, card.key); return value === null ? [] : [value]; });
    const value = average(currentValues);
    let trendPct: number | null = null;
    if (latestSessionDate && value !== null) {
      const cutoff = new Date(`${latestSessionDate}T12:00:00Z`);
      cutoff.setUTCDate(cutoff.getUTCDate() - 30);
      const cutoffDate = cutoff.toISOString().slice(0, 10);
      const priorDates = new Map<string, number[]>();
      for (const row of panelRows) {
        if (row.date >= latestSessionDate || row.date < cutoffDate) continue;
        const rowValue = valueOf(row, card.key);
        if (rowValue !== null) priorDates.set(row.date, [...(priorDates.get(row.date) ?? []), rowValue]);
      }
      const baseline = average([...priorDates.values()].flatMap((entries) => { const result = average(entries); return result === null ? [] : [result]; }));
      if (baseline !== null && baseline !== 0) trendPct = ((value - baseline) / Math.abs(baseline)) * 100;
    }
    const lowerIsBetter = card.key === 'tpvSeconds';
    const favorable = trendPct === null || Math.abs(trendPct) < .0001 ? null : lowerIsBetter ? trendPct < 0 : trendPct > 0;
    return { ...card, value, trendPct, favorable, percentile: percentileApplicable ? percentiles[card.key] ?? null : null };
  });

  useEffect(() => {
    if (tab !== 'athlete' || !athletePlayerId || exercise === 'All') return;
    let active = true;
    queueMicrotask(() => { if (active) { setPercentileLoading(true); setPercentileError(''); } });
    const params = new URLSearchParams({ playerId: String(athletePlayerId), exercise, groupId: String(percentileGroupId) });
    if (load !== 'All') params.set('load', load);
    fetch(`/api/ovr-sprint/vbt-percentile?${params.toString()}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: VbtPercentileResponse) => {
        if (!active) return;
        if (Array.isArray(payload.groups)) setPercentileGroups(payload.groups);
        if (payload.error) { setPercentileError(payload.error); setPercentiles({}); return; }
        setPercentiles(payload.result?.stats ?? {});
      })
      .catch(() => { if (active) { setPercentileError('Unable to load VBT percentile data.'); setPercentiles({}); } })
      .finally(() => { if (active) setPercentileLoading(false); });
    return () => { active = false; };
  }, [athletePlayerId, exercise, load, percentileGroupId, tab]);
  const leaderboard = useMemo(() => {
    const groups = new Map<string, Map<string, number[]>>();
    for (const row of initialResults) {
      if ((startDate && row.date < startDate) || (endDate && row.date > endDate)) continue;
      if (load !== 'All' && row.loadLbs !== Number(load)) continue;
      const value = valueOf(row, metric);
      if (value === null) continue;
      const player = groups.get(row.athleteName) ?? new Map<string, number[]>();
      player.set(row.exercise, [...(player.get(row.exercise) ?? []), value]);
      groups.set(row.athleteName, player);
    }
    return [...groups.entries()].map(([name, tests]) => ({ name, values: Object.fromEntries([...tests.entries()].map(([test, entries]) => [test, average(entries)])), counts: Object.fromEntries([...tests.entries()].map(([test, entries]) => [test, entries.length])) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [endDate, initialResults, load, metric, startDate]);

  return <div className={styles.workspace}>
    <section className={styles.commandBar}>
      <div><p className={styles.eyebrow}>VELOCITY BASED TRAINING</p><h3>{tab === 'athlete' ? athlete || 'Athlete analysis' : 'Organization leaderboard'}</h3></div>
      <div className={styles.tabs}><button className={tab === 'athlete' ? styles.active : ''} onClick={() => setTab('athlete')}>Athlete</button><button className={tab === 'leaderboard' ? styles.active : ''} onClick={() => setTab('leaderboard')}>Leaderboard</button></div>
    </section>

    <section className={styles.filterPanel}>
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>01 · BUILD THE VIEW</p><h3>VBT analysis controls</h3></div><div className={styles.presets}><button onClick={() => setStartDate(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))}>30D</button><button onClick={() => setStartDate(new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))}>90D</button><button onClick={() => setStartDate(allDates[0] ?? '')}>ALL</button></div></div>
      <div className={styles.primaryFilters}>
        {tab === 'athlete' ? <label><span>Athlete</span><select value={athlete} onChange={(event) => { const nextAthlete = event.target.value; setAthlete(nextAthlete); setExercise(defaultExerciseForAthlete(initialResults, nextAthlete)); setLoad('All'); }}>{athletes.map((name) => <option key={name}>{name}</option>)}</select></label> : <label><span>Leaderboard scope</span><select value="all" disabled><option value="all">All VBT exercises</option></select></label>}
        <label><span>Metric</span><select value={metric} onChange={(event) => setMetric(event.target.value as MetricKey)}>{METRICS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}{entry.unit ? ` (${entry.unit})` : ''}</option>)}</select></label>
      </div>
      <div className={styles.secondaryFilters}>
        {tab === 'athlete' ? <label><span>VBT exercise</span><select value={exercise} onChange={(event) => { setExercise(event.target.value); setLoad('All'); }}><option>All</option>{athleteExercises.map((name) => <option key={name}>{name}</option>)}</select></label> : null}
        <label><span>Load</span><select value={load} onChange={(event) => setLoad(event.target.value)}><option>All</option>{loads.map((value) => <option key={value} value={value}>{value} lb</option>)}</select></label>
        <label><span>Show</span><select value={displayMode} onChange={(event) => setDisplayMode(event.target.value as DisplayMode)}><option value="individual">Individual reps</option><option value="dailyAverage">Average per date</option><option value="dailyBest">Best per date</option></select></label>
        <label><span>From</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label><span>Through</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      </div>
    </section>

    {tab === 'athlete' ? <>
      <section className={styles.chartPanel}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>02 · PERFORMANCE SIGNAL</p><h3>{config.label}</h3><p>{exercise === 'All' ? 'All VBT exercises' : exercise} · {startDate || 'First result'} to {endDate || 'Latest result'}</p></div><div className={styles.panelControls}><label><span>Compare against</span><select value={String(percentileGroupId)} onChange={(event) => setPercentileGroupId(event.target.value === 'all' ? 'all' : Number(event.target.value))}><option value="all">All PCU athletes</option>{percentileGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><span className={styles.liveBadge}><i /> {points.length} {displayMode === 'individual' ? 'reps' : 'dates / exercises'}</span></div></div>
        {percentileApplicable && percentileError ? <p className={styles.error}>{percentileError}</p> : null}
        <div className={styles.statGrid}>
          {signalCardData.map((card, index) => <article key={card.key} className={index === 0 ? styles.featuredStat : undefined}>
            <div className={styles.statCardHeader}><p>{card.label}</p>{percentileApplicable && percentileLoading ? <span className={styles.percentileBadge}>Ranking…</span> : card.percentile?.percentile != null ? <span className={`${styles.percentileBadge} ${percentileTierClass(card.percentile.percentile)}`} title={`Compared with ${card.percentile.sampleSize} athlete${card.percentile.sampleSize === 1 ? '' : 's'} with qualifying data`}>{ordinal(card.percentile.percentile)} percentile</span> : <span className={`${styles.percentileBadge} ${styles.percentileUnavailable}`}>No rank</span>}</div>
            <strong>{card.value === null ? '—' : card.value.toFixed(card.decimals)}{card.value !== null ? <small className={styles.statUnit}>{card.unit}</small> : null}</strong>
            {card.trendPct !== null ? <span className={card.favorable === null ? undefined : card.favorable ? styles.good : styles.bad}>{card.trendPct > 0 ? '▲' : card.trendPct < 0 ? '▼' : '→'} {Math.abs(card.trendPct).toFixed(1)}% vs. prior 30-day avg</span> : <span>{latestSessionDate ? `Latest session · ${dateLabel(latestSessionDate)}` : 'No qualifying session'}</span>}
          </article>)}
        </div>
        <div className={styles.chartActions}><span>{config.unit || 'value'} · {displayMode === 'dailyAverage' ? 'Average per date' : displayMode === 'dailyBest' ? 'Best per date' : 'Individual reps'}</span><div className={styles.segmented}><button className={chartMode === 'line' ? styles.active : ''} onClick={() => setChartMode('line')}>Line</button><button className={chartMode === 'bar' ? styles.active : ''} onClick={() => setChartMode('bar')}>Bars</button></div></div>
        <VbtChart points={points} config={config} mode={chartMode} athlete={athlete} />
      </section>
      <section className={styles.tablePanel}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>03 · RESULT LOG</p><h3>{filtered.length} qualifying reps</h3><p>Every Velocity-sheet field remains available in the raw result log.</p></div><button className={styles.exportButton} onClick={() => downloadCsv(filtered)}>Export CSV</button></div>
        <div className={styles.tableScroll}><table style={{ minWidth: 2380 }}><thead><tr><th>Athlete</th><th>Date</th><th>Sport</th><th>Position</th><th>Group</th><th>Exercise</th><th>Set</th><th>Rep</th><th>Load</th><th>Target Type</th><th>Target Min</th><th>Target Max</th><th>Avg Velocity</th><th>Peak Velocity</th><th>Avg Power</th><th>Peak Power</th><th>ROM</th><th>Duration</th><th>TPV</th><th>EA Index</th><th>Note</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td>{row.athleteName}</td><td>{dateLabel(row.date)}</td><td>{row.sport || '—'}</td><td>{row.position || '—'}</td><td>{row.groups || '—'}</td><td>{row.exercise}</td><td>#{row.setNumber}</td><td>#{row.repNumber}</td><td>{row.loadLbs ?? '—'} lb</td><td>{row.targetType || '—'}</td><td>{row.targetMin ?? '—'}</td><td>{row.targetMax ?? '—'}</td><td>{row.avgVelocity === null ? '—' : `${row.avgVelocity.toFixed(2)} m/s`}</td><td>{row.peakVelocity === null ? '—' : `${row.peakVelocity.toFixed(2)} m/s`}</td><td>{row.avgPower === null ? '—' : `${row.avgPower.toFixed(0)} W`}</td><td>{row.peakPower === null ? '—' : `${row.peakPower.toFixed(0)} W`}</td><td>{row.romInches === null ? '—' : `${row.romInches.toFixed(1)} in`}</td><td>{row.durationSeconds === null ? '—' : `${row.durationSeconds.toFixed(2)} s`}</td><td>{row.tpvSeconds === null ? '—' : `${row.tpvSeconds.toFixed(2)} s`}</td><td>{row.eaIndex?.toFixed(2) ?? '—'}</td><td>{row.note || '—'}</td></tr>)}</tbody></table></div>
      </section>
    </> : <section className={styles.leaderboardPanel}>
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>ORGANIZATION VIEW</p><h3>VBT leaderboard</h3><p>Average {config.label.toLowerCase()} by exercise for every athlete with qualifying data.</p></div></div>
      <div className={styles.tableScroll}><table className={styles.leaderTable} style={{ minWidth: Math.max(720, 220 + exercises.length * 180) }}><thead><tr><th>Player</th>{exercises.map((test) => <th key={test}>{test}<br /><small>{config.label}{config.unit ? ` (${config.unit})` : ''}</small></th>)}</tr></thead><tbody>{leaderboard.map((row) => <tr key={row.name}><td>{row.name}</td>{exercises.map((test) => <td key={test}>{row.values[test] == null ? '—' : <>{formatValue(row.values[test], config)} {config.unit}<small className={styles.cellSubtext}>{row.counts[test]} reps</small></>}</td>)}</tr>)}</tbody></table></div>
    </section>}
  </div>;
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ArmCareExam, ArmCareMetricValue, ArmCarePercentileStat, ArmCarePercentilesByExam } from '../../../lib/armcare';
import { armCareMetricUnit, armCareMetricValueForMode, type ArmCareForceMode } from '../../../lib/armcare-display';
import styles from './armcare-metrics-dashboard.module.css';

type Props = {
  fixedPlayerName?: string;
  canSync?: boolean;
};

type Payload = {
  exams?: ArmCareExam[];
  players?: string[];
  lastSyncedAt?: string | null;
  percentilesByExamId?: ArmCarePercentilesByExam;
  bodyWeightPercentilesByExamId?: ArmCarePercentilesByExam;
  groups?: Array<{ id: string; label: string; memberCount: number }>;
  error?: string;
};

const PRIMARY_METRICS = [
  ['Arm Score', ''],
  ['Total Strength', 'lb'],
  ['Shoulder Balance', ''],
  ['IRTARM Strength', 'lb'],
  ['ERTARM Strength', 'lb'],
] as const;

const ARMCARE_METRIC_LABELS: Record<string, string> = {
  'ERTARM Strength': 'Shoulder ER',
  'IRTARM Strength': 'Shoulder IR',
  'STARM Strength': 'Scaption',
  'GTARM Strength': 'Grip',
};

const LEADERBOARD_DETAIL_METRICS = ['ERTARM Strength', 'IRTARM Strength', 'STARM Strength', 'GTARM Strength', 'Shoulder Balance'] as const;

function metricDisplayName(metric: string): string {
  return ARMCARE_METRIC_LABELS[metric] ?? metric;
}

const METRIC_CATEGORY_ORDER = ['Readiness & Strength', 'Post-Throwing', 'Peak Force', 'Range of Motion', 'Throwing Workload', 'Other'] as const;

function metricCategory(metric: string): typeof METRIC_CATEGORY_ORDER[number] {
  if (/^(Arm Score|Total Strength|Shoulder Balance|Velo|SVR)| Strength$| RS$| Recovery$/i.test(metric)) return 'Readiness & Strength';
  if (/Post|%Fresh|Loss/i.test(metric)) return 'Post-Throwing';
  if (/Peak Force|Max-Lbs|Primer/i.test(metric)) return 'Peak Force';
  if (/ROM|TARC/i.test(metric)) return 'Range of Motion';
  if (/Pitch Count|High Intent|RPE|Throwing Time/i.test(metric)) return 'Throwing Workload';
  return 'Other';
}

function metricValue(exam: ArmCareExam | undefined, key: string): ArmCareMetricValue {
  return exam?.metrics?.[key] ?? null;
}

function numericMetric(exam: ArmCareExam, key: string): number | null {
  const raw = metricValue(exam, key);
  if (raw === null || raw === '' || typeof raw === 'boolean') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function numericMetricForMode(exam: ArmCareExam, key: string, forceMode: ArmCareForceMode): number | null {
  return armCareMetricValueForMode(key, metricValue(exam, key), exam.bodyWeightLb, forceMode);
}

function displayMetric(value: ArmCareMetricValue, digits = 1): string {
  if (value === null || value === '') return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(digits);
  return String(value);
}

function displayMetricByKey(value: ArmCareMetricValue, key: string, forceMode: ArmCareForceMode = 'force', bodyWeightLb?: number | null): string {
  const converted = armCareMetricValueForMode(key, value, bodyWeightLb, forceMode);
  if (converted === null) return value === null || value === '' ? '—' : forceMode === 'bw' ? '—' : displayMetric(value);
  if (key === 'Shoulder Balance') return converted.toFixed(2);
  return displayMetric(converted);
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatSync(value: string | null): string {
  if (!value) return 'Not synced yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function localIsoDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function changeLabel(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return 'No prior comparable exam';
  const difference = current - previous;
  if (Math.abs(difference) < 0.05) return 'No change from prior exam';
  return `${difference > 0 ? '+' : ''}${difference.toFixed(1)} from prior exam`;
}

type TrendModel = {
  path: string;
  points: Array<{ x: number; y: number; value: number; date: string }>;
  yTicks: Array<{ value: number; y: number }>;
  xTicks: Array<{ label: string; x: number }>;
};

function trendModel(exams: ArmCareExam[], key: string, kind: 'line' | 'bar', forceMode: ArmCareForceMode): TrendModel {
  const left = 76;
  const right = 728;
  const top = 24;
  const bottom = 278;
  const values = exams
    .map((exam) => ({ exam, value: numericMetricForMode(exam, key, forceMode) }))
    .filter((item): item is { exam: ArmCareExam; value: number } => item.value !== null)
    .reverse();
  if (!values.length) return { path: '', points: [], yTicks: [], xTicks: [] };
  const min = Math.min(...values.map((item) => item.value));
  const max = Math.max(...values.map((item) => item.value));
  const rawRange = max - min;
  const padding = rawRange > 0 ? rawRange * .12 : Math.max(Math.abs(max) * .08, 1);
  const chartMin = min - padding;
  const chartMax = max + padding;
  const range = chartMax - chartMin;
  const points = values.map((item, index) => ({
    x: kind === 'bar'
      ? left + ((index + .5) / values.length) * (right - left)
      : values.length === 1 ? (left + right) / 2 : left + (index / (values.length - 1)) * (right - left),
    y: bottom - ((item.value - chartMin) / range) * (bottom - top),
    value: item.value,
    date: item.exam.examDate,
  }));
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return { value: chartMax - ratio * range, y: top + ratio * (bottom - top) };
  });
  const maxXTicks = Math.min(6, values.length);
  const tickIndexes = Array.from(new Set(Array.from({ length: maxXTicks }, (_, index) => Math.round(index * (values.length - 1) / Math.max(1, maxXTicks - 1)))));
  const xTicks = tickIndexes.map((index) => ({ label: values[index]?.exam.examDate ?? '', x: points[index]?.x ?? left }));
  return { path: points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' '), points, yTicks, xTicks };
}

function shortAxisDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function axisNumber(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 100) return value.toFixed(0);
  if (magnitude >= 10) return value.toFixed(1);
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

function percentileClass(stat: ArmCarePercentileStat | undefined): string {
  if (!stat || stat.percentile === null) return styles.percentileUnavailable;
  if (stat.percentile < 34) return styles.percentileLow;
  if (stat.percentile < 67) return styles.percentileMid;
  return styles.percentileHigh;
}

function PercentileBadge({ stat, title }: { stat: ArmCarePercentileStat | undefined; title?: string }) {
  return <span className={`${styles.percentileBadge} ${percentileClass(stat)}`} title={title ?? (stat ? `Compared with ${stat.sampleSize} PCU athlete${stat.sampleSize === 1 ? '' : 's'} using their latest same-type exam` : undefined)}>
    {stat?.percentile === null || stat === undefined ? 'No rank' : `${ordinal(stat.percentile)} percentile`}
  </span>;
}

export default function ArmCareMetricsDashboard({ fixedPlayerName = '', canSync = false }: Props) {
  const [exams, setExams] = useState<ArmCareExam[]>([]);
  const [players, setPlayers] = useState<string[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState(fixedPlayerName);
  const [typeFilter, setTypeFilter] = useState('All');
  const [trendKey, setTrendKey] = useState('Arm Score');
  const [trendKind, setTrendKind] = useState<'line' | 'bar'>('line');
  const [forceMode, setForceMode] = useState<ArmCareForceMode>('force');
  const [view, setView] = useState<'player' | 'leaderboard'>('player');
  const [startDate, setStartDate] = useState('2026-05-01');
  const [endDate, setEndDate] = useState(localIsoDate);
  const [groups, setGroups] = useState<Array<{ id: string; label: string; memberCount: number }>>([]);
  const [groupId, setGroupId] = useState('all');
  const [comparisonStartDate, setComparisonStartDate] = useState('2026-05-01');
  const [comparisonEndDate, setComparisonEndDate] = useState(localIsoDate);
  const [leaderboardMetric, setLeaderboardMetric] = useState('Arm Score');
  const [leaderboardDisplay, setLeaderboardDisplay] = useState<'value' | 'percentile' | 'both'>('both');
  const [leaderboardSort, setLeaderboardSort] = useState<{ key: 'rank' | 'player' | 'exams' | 'value' | 'percentile' | `metric:${string}`; direction: 'asc' | 'desc' }>({ key: 'value', direction: 'desc' });
  const [percentilesByExamId, setPercentilesByExamId] = useState<ArmCarePercentilesByExam>({});
  const [bodyWeightPercentilesByExamId, setBodyWeightPercentilesByExamId] = useState<ArmCarePercentilesByExam>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  async function load(options: { quiet?: boolean; percentileOnly?: boolean } = {}) {
    if (!options.quiet) setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ groupId, comparisonStartDate, comparisonEndDate });
      if (fixedPlayerName) query.set('player', fixedPlayerName);
      const response = await fetch(`/api/armcare?${query.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load ArmCare Metrics.');
      const nextExams = Array.isArray(payload.exams) ? payload.exams : [];
      const nextPlayers = Array.isArray(payload.players) ? payload.players : [];
      if (!options.percentileOnly) {
        setExams(nextExams);
        setPlayers(nextPlayers);
        setLastSyncedAt(payload.lastSyncedAt ?? null);
        setSelectedPlayer((current) => fixedPlayerName || (current && nextPlayers.includes(current) ? current : nextPlayers[0] ?? ''));
      }
      setPercentilesByExamId(payload.percentilesByExamId ?? {});
      setBodyWeightPercentilesByExamId(payload.bodyWeightPercentilesByExamId ?? {});
      setGroups(payload.groups ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load ArmCare Metrics.');
    } finally {
      if (!options.quiet) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  // The player is fixed for the lifetime of this tab instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedPlayerName]);

  useEffect(() => {
    if (loading) return;
    const timeout = window.setTimeout(() => void load({ quiet: true, percentileOnly: true }), 250);
    return () => window.clearTimeout(timeout);
  // Only percentile comparison controls should trigger this quiet refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, comparisonStartDate, comparisonEndDate]);

  async function syncNow() {
    setSyncing(true);
    setError('');
    try {
      const response = await fetch('/api/armcare', { method: 'POST' });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to sync ArmCare Metrics.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sync ArmCare Metrics.');
    } finally {
      setSyncing(false);
    }
  }

  const playerExams = useMemo(
    () => exams.filter((exam) => !selectedPlayer || exam.playerName === selectedPlayer),
    [exams, selectedPlayer]
  );
  const examTypes = useMemo(
    () => Array.from(new Set((view === 'leaderboard' ? exams : playerExams).map((exam) => exam.examType).filter(Boolean))),
    [exams, playerExams, view]
  );
  const filteredExams = useMemo(
    () => playerExams.filter((exam) => (typeFilter === 'All' || exam.examType === typeFilter) && exam.examDate >= startDate && exam.examDate <= endDate),
    [playerExams, typeFilter, startDate, endDate]
  );
  const metricOptions = useMemo(() => {
    const numeric = new Set<string>();
    for (const exam of playerExams) {
      for (const key of Object.keys(exam.metrics)) {
        if (numericMetric(exam, key) !== null) numeric.add(key);
      }
    }
    return METRIC_CATEGORY_ORDER.map((category) => ({
      category,
      metrics: Array.from(numeric).filter((metric) => metricCategory(metric) === category).sort((a, b) => a.localeCompare(b)),
    })).filter((group) => group.metrics.length > 0);
  }, [playerExams]);
  const availableMetricSet = useMemo(() => new Set(metricOptions.flatMap((group) => group.metrics)), [metricOptions]);
  const latest = filteredExams[0];
  const previous = filteredExams[1];
  const effectiveTrendKey = availableMetricSet.has(trendKey) ? trendKey : metricOptions[0]?.metrics[0] ?? '';
  const trend = useMemo(() => trendModel(filteredExams, effectiveTrendKey, trendKind, forceMode), [filteredExams, effectiveTrendKey, trendKind, forceMode]);
  const effectivePercentilesByExamId = forceMode === 'bw' ? bodyWeightPercentilesByExamId : percentilesByExamId;
  const selectedPercentiles = latest ? effectivePercentilesByExamId[latest.examId] ?? {} : {};
  const trendUnit = armCareMetricUnit(effectiveTrendKey, forceMode);
  const allMetricOptions = useMemo(() => {
    const numeric = new Set<string>();
    for (const exam of exams) for (const key of Object.keys(exam.metrics)) if (numericMetric(exam, key) !== null) numeric.add(key);
    return METRIC_CATEGORY_ORDER.map((category) => ({
      category,
      metrics: Array.from(numeric).filter((metric) => metricCategory(metric) === category).sort((a, b) => a.localeCompare(b)),
    })).filter((group) => group.metrics.length > 0);
  }, [exams]);
  const leaderboardRows = useMemo(() => {
    const metricsToAggregate = Array.from(new Set([leaderboardMetric, ...LEADERBOARD_DETAIL_METRICS]));
    const byPlayer = new Map<string, { playerName: string; examCount: number; valuesByMetric: Map<string, number[]>; percentiles: number[]; sampleSizes: number[] }>();
    for (const exam of exams) {
      if (exam.examDate < startDate || exam.examDate > endDate || (typeFilter !== 'All' && exam.examType !== typeFilter)) continue;
      const bucket = byPlayer.get(exam.playerName) ?? { playerName: exam.playerName, examCount: 0, valuesByMetric: new Map<string, number[]>(), percentiles: [], sampleSizes: [] };
      bucket.examCount += 1;
      for (const metric of metricsToAggregate) {
        const value = numericMetricForMode(exam, metric, forceMode);
        if (value === null) continue;
        const values = bucket.valuesByMetric.get(metric) ?? [];
        values.push(value);
        bucket.valuesByMetric.set(metric, values);
      }
      const stat = effectivePercentilesByExamId[exam.examId]?.[leaderboardMetric];
      if (stat?.percentile !== null && stat?.percentile !== undefined) bucket.percentiles.push(stat.percentile);
      if (stat?.sampleSize) bucket.sampleSizes.push(stat.sampleSize);
      byPlayer.set(exam.playerName, bucket);
    }
    const ranked = Array.from(byPlayer.values()).flatMap((bucket) => {
      const selectedValues = bucket.valuesByMetric.get(leaderboardMetric) ?? [];
      if (!selectedValues.length) return [];
      const percentile = bucket.percentiles.length ? Math.round(bucket.percentiles.reduce((sum, value) => sum + value, 0) / bucket.percentiles.length) : null;
      const metricValues = Object.fromEntries(metricsToAggregate.map((metric) => {
        const values = bucket.valuesByMetric.get(metric) ?? [];
        return [metric, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null];
      }));
      return [{
        playerName: bucket.playerName,
        examCount: bucket.examCount,
        metricValues,
        value: selectedValues.reduce((sum, value) => sum + value, 0) / selectedValues.length,
        stat: { percentile, sampleSize: bucket.sampleSizes.length ? Math.max(...bucket.sampleSizes) : 0 },
      }];
    }).sort((a, b) => b.value - a.value || a.playerName.localeCompare(b.playerName)).map((row, index) => ({ ...row, rank: index + 1 }));
    const direction = leaderboardSort.direction === 'asc' ? 1 : -1;
    return ranked.sort((a, b) => {
      if (leaderboardSort.key === 'rank') return (a.rank - b.rank) * direction;
      if (leaderboardSort.key === 'player') return a.playerName.localeCompare(b.playerName) * direction;
      if (leaderboardSort.key === 'exams') return (a.examCount - b.examCount) * direction;
      if (leaderboardSort.key === 'percentile') return ((a.stat?.percentile ?? -1) - (b.stat?.percentile ?? -1)) * direction;
      if (leaderboardSort.key.startsWith('metric:')) {
        const metric = leaderboardSort.key.slice(7);
        return ((a.metricValues[metric] ?? -Infinity) - (b.metricValues[metric] ?? -Infinity)) * direction;
      }
      return (a.value - b.value) * direction;
    });
  }, [exams, startDate, endDate, typeFilter, leaderboardMetric, effectivePercentilesByExamId, leaderboardSort, forceMode]);

  function sortLeaderboard(key: typeof leaderboardSort.key) {
    setLeaderboardSort((current) => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: key === 'player' || key === 'rank' ? 'asc' : 'desc' });
  }

  const sortArrow = (key: typeof leaderboardSort.key) => leaderboardSort.key === key ? (leaderboardSort.direction === 'asc' ? ' ↑' : ' ↓') : '';
  const leaderboardMetricColumns = Array.from(new Set([leaderboardMetric, ...LEADERBOARD_DETAIL_METRICS]));

  if (loading) return <div className={styles.loading}>Loading ArmCare Metrics…</div>;

  return (
    <section className={styles.workspace} aria-label="ArmCare Metrics">
      <header className={styles.commandBar}>
        <div>
          <p className={styles.eyebrow}>ARM READINESS · STRENGTH · RANGE OF MOTION</p>
          <h3>ArmCare Metrics</h3>
          <p>Daily readiness and strength history synced from ArmCare.</p>
        </div>
        <div className={styles.syncCluster}>
          {canSync ? <div className={styles.viewTabs} role="tablist" aria-label="ArmCare view">
            <button type="button" role="tab" aria-selected={view === 'player'} onClick={() => setView('player')}>Player</button>
            <button type="button" role="tab" aria-selected={view === 'leaderboard'} onClick={() => setView('leaderboard')}>Leaderboard</button>
          </div> : null}
          <span><i /> Last sync {formatSync(lastSyncedAt)}</span>
          {canSync ? <button type="button" onClick={() => void syncNow()} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button> : null}
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.filterBar}>
        {view === 'player' ? <label>
          <span>Athlete</span>
          {fixedPlayerName ? <strong>{fixedPlayerName}</strong> : (
            <select value={selectedPlayer} onChange={(event) => { setSelectedPlayer(event.target.value); setTypeFilter('All'); }}>
              {players.map((player) => <option key={player} value={player}>{player}</option>)}
            </select>
          )}
        </label> : <label>
          <span>Leaderboard metric</span>
          <select value={leaderboardMetric} onChange={(event) => setLeaderboardMetric(event.target.value)}>
            {allMetricOptions.map((group) => <optgroup key={group.category} label={group.category}>{group.metrics.map((metric) => <option key={metric} value={metric}>{metricDisplayName(metric)}</option>)}</optgroup>)}
          </select>
        </label>}
        <label>
          <span>Exam type</span>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="All">All exams</option>
            {examTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>
          <span>Strength scale</span>
          <select value={forceMode} onChange={(event) => setForceMode(event.target.value === 'bw' ? 'bw' : 'force')}>
            <option value="force">Force (lb)</option>
            <option value="bw">Body Weight (%)</option>
          </select>
        </label>
        <label><span>From</span><input type="date" min="2026-05-01" max={endDate} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label><span>Through</span><input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
        <div className={styles.examCount}>
          <span>{view === 'player' ? 'Available exams' : 'Ranked players'}</span>
          <strong>{view === 'player' ? filteredExams.length : leaderboardRows.length}</strong>
          <small>{formatDate(startDate)}–{formatDate(endDate)}</small>
        </div>
      </div>

      <div className={styles.percentileControls}>
        <div><p className={styles.eyebrow}>PERCENTILE COMPARISON</p><h3>Comparison group</h3></div>
        <label><span>Group</span><select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="all">All PCU athletes</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.label} ({group.memberCount})</option>)}</select></label>
        <label><span>From</span><input type="date" min="2026-05-01" max={comparisonEndDate} value={comparisonStartDate} onChange={(event) => setComparisonStartDate(event.target.value)} /></label>
        <label><span>Through</span><input type="date" min={comparisonStartDate} value={comparisonEndDate} onChange={(event) => setComparisonEndDate(event.target.value)} /></label>
      </div>

      {view === 'leaderboard' ? (
        <article className={styles.tablePanel}>
          <div className={styles.panelHeading}>
            <div><p className={styles.eyebrow}>TEAM LEADERBOARD</p><h3>{metricDisplayName(leaderboardMetric)}</h3></div>
            <div className={styles.displayToggle} aria-label="Leaderboard display">
              {(['value', 'percentile', 'both'] as const).map((mode) => <button key={mode} type="button" aria-pressed={leaderboardDisplay === mode} onClick={() => setLeaderboardDisplay(mode)}>{mode === 'both' ? 'Both' : mode === 'value' ? 'Values' : 'Percentiles'}</button>)}
            </div>
          </div>
          <p className={styles.percentileContext}>Each athlete&apos;s value is the average of every qualifying exam in the selected date range. Percentiles are averaged across those exams using the selected comparison group.{forceMode === 'bw' ? ' Strength values use each athlete’s VALD body weight.' : ''}</p>
          <div className={styles.tableScroll}>
            <table className={styles.leaderboardTable}><thead><tr><th><button type="button" onClick={() => sortLeaderboard('rank')}>Rank{sortArrow('rank')}</button></th><th><button type="button" onClick={() => sortLeaderboard('player')}>Player{sortArrow('player')}</button></th><th><button type="button" onClick={() => sortLeaderboard('exams')}>Exams{sortArrow('exams')}</button></th>{leaderboardDisplay !== 'percentile' ? leaderboardMetricColumns.map((metric) => { const sortKey = metric === leaderboardMetric ? 'value' as const : `metric:${metric}` as const; const unit = armCareMetricUnit(metric, forceMode); return <th key={metric}><button type="button" onClick={() => sortLeaderboard(sortKey)}>Avg {metricDisplayName(metric)}{unit ? ` (${unit})` : ''}{sortArrow(sortKey)}</button></th>; }) : null}{leaderboardDisplay !== 'value' ? <th><button type="button" onClick={() => sortLeaderboard('percentile')}>Avg percentile{sortArrow('percentile')}</button></th> : null}</tr></thead>
              <tbody>{leaderboardRows.map((row) => <tr key={row.playerName}><td><b className={styles.rank}>{row.rank}</b></td><td className={styles.playerName}>{row.playerName}</td><td>{row.examCount}</td>{leaderboardDisplay !== 'percentile' ? leaderboardMetricColumns.map((metric) => <td key={metric}>{displayMetricByKey(row.metricValues[metric], metric)}</td>) : null}{leaderboardDisplay !== 'value' ? <td><PercentileBadge stat={row.stat} title={`Average percentile across ${row.examCount} qualifying exam${row.examCount === 1 ? '' : 's'}`} /></td> : null}</tr>)}</tbody>
            </table>
          </div>
          {!leaderboardRows.length ? <div className={styles.noTrend}>No qualifying values are available for this leaderboard.</div> : null}
        </article>
      ) : !latest ? (
        <div className={styles.empty}>
          <div className={styles.emptyMark}>AC</div>
          <h3>No ArmCare exams found</h3>
          <p>This athlete does not have a visible ArmCare exam on or after May 1, 2026.</p>
        </div>
      ) : (
        <>
          <div className={styles.latestHeader}>
            <div>
              <p className={styles.eyebrow}>LATEST EXAM</p>
              <h3>{formatDate(latest.examDate)}</h3>
            </div>
            <span className={styles.examType}>{latest.examType || 'Exam'}</span>
          </div>

          <div className={styles.statGrid}>
            {PRIMARY_METRICS.map(([key], index) => {
              const current = numericMetricForMode(latest, key, forceMode);
              const prior = previous ? numericMetricForMode(previous, key, forceMode) : null;
              const unit = armCareMetricUnit(key, forceMode);
              return (
                <article key={key} className={index === 0 ? styles.featured : ''}>
                  <div className={styles.statHeader}><p>{metricDisplayName(key)}</p><PercentileBadge stat={selectedPercentiles[key]} /></div>
                  <strong>{displayMetricByKey(current, key)}{current !== null && unit ? <small>{unit}</small> : null}</strong>
                  <span>{changeLabel(current, prior)}</span>
                </article>
              );
            })}
          </div>
          <p className={styles.percentileContext}>Percentiles compare each value with the selected group&apos;s latest {latest.examType || 'same-type'} exam from {formatDate(comparisonStartDate)} through {formatDate(comparisonEndDate)}.{forceMode === 'bw' ? ` Strength values use VALD body weight${latest.bodyWeightLb ? ` (${latest.bodyWeightLb.toFixed(1)} lb for this exam)` : '; no matching VALD body weight is available for this exam'}.` : ''}</p>

          <div className={styles.contentGrid}>
            <article className={styles.trendPanel}>
              <div className={styles.panelHeading}>
                <div>
                  <p className={styles.eyebrow}>LONGITUDINAL VIEW</p>
                  <h3>{metricDisplayName(effectiveTrendKey) || 'Metric'} trend</h3>
                </div>
                <div className={styles.chartControls}>
                  <div className={styles.displayToggle} aria-label="Graph type"><button type="button" aria-pressed={trendKind === 'line'} onClick={() => setTrendKind('line')}>Line</button><button type="button" aria-pressed={trendKind === 'bar'} onClick={() => setTrendKind('bar')}>Bar</button></div>
                  <select value={effectiveTrendKey} onChange={(event) => setTrendKey(event.target.value)} aria-label="Trend metric">
                    {metricOptions.map((group) => <optgroup key={group.category} label={group.category}>
                      {group.metrics.map((metric) => { const unit = armCareMetricUnit(metric, forceMode); return <option key={metric} value={metric}>{metricDisplayName(metric)}{unit ? ` (${unit})` : ''}</option>; })}
                    </optgroup>)}
                  </select>
                </div>
              </div>
              {trend.points.length ? (
                <div className={styles.chartWrap}>
                  <svg viewBox="0 0 760 340" role="img" aria-label={`${metricDisplayName(effectiveTrendKey)} across ${trend.points.length} exams`} preserveAspectRatio="xMidYMid meet">
                    <defs><clipPath id="armcare-trend-plot"><rect x="76" y="24" width="652" height="254" /></clipPath></defs>
                    {trend.yTicks.map((tick) => <g key={tick.y}>
                      <line x1="76" x2="728" y1={tick.y} y2={tick.y} className={styles.gridLine} />
                      <text x="66" y={tick.y + 4} textAnchor="end" className={styles.axisTick}>{axisNumber(tick.value)}</text>
                    </g>)}
                    <line x1="76" x2="76" y1="24" y2="278" className={styles.axisLine} />
                    <line x1="76" x2="728" y1="278" y2="278" className={styles.axisLine} />
                    {trendKind === 'line' ? <path d={trend.path} className={styles.trendLine} /> : null}
                    {trend.points.map((point) => trendKind === 'bar'
                      ? <rect key={`${point.date}-${point.x}`} x={point.x - Math.min(26, 250 / trend.points.length) / 2} y={point.y} width={Math.min(26, 250 / trend.points.length)} height={278 - point.y} rx="4" className={styles.trendBar} clipPath="url(#armcare-trend-plot)"><title>{formatDate(point.date)}: {point.value}{trendUnit ? ` ${trendUnit}` : ''}</title></rect>
                      : <circle key={`${point.date}-${point.x}`} cx={point.x} cy={point.y} r="5" className={styles.point}><title>{formatDate(point.date)}: {point.value}{trendUnit ? ` ${trendUnit}` : ''}</title></circle>)}
                    {trend.xTicks.map((tick) => <g key={`${tick.label}-${tick.x}`}>
                      <line x1={tick.x} x2={tick.x} y1="278" y2="284" className={styles.axisLine} />
                      <text x={tick.x} y="301" textAnchor="middle" className={styles.axisTick}>{shortAxisDate(tick.label)}</text>
                    </g>)}
                    <text x="402" y="330" textAnchor="middle" className={styles.axisTitle}>Exam Date</text>
                    <text x="18" y="151" textAnchor="middle" transform="rotate(-90 18 151)" className={styles.axisTitle}>{metricDisplayName(effectiveTrendKey)}{trendUnit ? ` (${trendUnit})` : ''}</text>
                  </svg>
                </div>
              ) : <div className={styles.noTrend}>No {metricDisplayName(effectiveTrendKey).toLowerCase()} values are available for these exams.</div>}
            </article>

            <article className={styles.recoveryPanel}>
              <div className={styles.panelHeading}>
                <div>
                  <p className={styles.eyebrow}>LATEST RECOVERY</p>
                  <h3>Movement status</h3>
                </div>
              </div>
              <div className={styles.recoveryList}>
                {[
                  ['Shoulder IR', 'IRTARM Recovery', 'IRTARM Strength'],
                  ['Shoulder ER', 'ERTARM Recovery', 'ERTARM Strength'],
                  ['Scaption', 'STARM Recovery', 'STARM Strength'],
                  ['Grip', 'GTARM Recovery', 'GTARM Strength'],
                ].map(([label, recoveryKey, strengthKey]) => {
                  const recovery = displayMetric(metricValue(latest, recoveryKey));
                  const strength = numericMetricForMode(latest, strengthKey, forceMode);
                  const strengthUnit = armCareMetricUnit(strengthKey, forceMode);
                  return <div key={label}><span>{label}<small>{strength === null ? (forceMode === 'bw' ? 'No VALD body weight' : 'No strength value') : `${strength.toFixed(1)} ${strengthUnit}`}</small></span><b data-status={recovery.toLowerCase()}>{recovery}</b></div>;
                })}
              </div>
            </article>
          </div>

          <article className={styles.tablePanel}>
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>EXAM HISTORY</p>
                <h3>ArmCare testing log</h3>
              </div>
            </div>
            <div className={styles.tableScroll}>
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Arm Score + Pctl</th><th>Total Strength ({armCareMetricUnit('Total Strength', forceMode)}) + Pctl</th><th>Shoulder IR ({armCareMetricUnit('IRTARM Strength', forceMode)})</th><th>Shoulder ER ({armCareMetricUnit('ERTARM Strength', forceMode)})</th><th>Scaption ({armCareMetricUnit('STARM Strength', forceMode)})</th><th>Grip ({armCareMetricUnit('GTARM Strength', forceMode)})</th><th>Shoulder Balance</th><th>Total %Fresh</th></tr></thead>
                <tbody>
                  {filteredExams.map((exam) => <tr key={exam.examId}>
                    <td>{formatDate(exam.examDate)}</td>
                    <td><span className={styles.tableType}>{exam.examType || 'Exam'}</span></td>
                    <td><div className={styles.metricCell}>{displayMetricByKey(metricValue(exam, 'Arm Score'), 'Arm Score', forceMode, exam.bodyWeightLb)}<PercentileBadge stat={effectivePercentilesByExamId[exam.examId]?.['Arm Score']} /></div></td>
                    <td><div className={styles.metricCell}>{displayMetricByKey(metricValue(exam, 'Total Strength'), 'Total Strength', forceMode, exam.bodyWeightLb)}<PercentileBadge stat={effectivePercentilesByExamId[exam.examId]?.['Total Strength']} /></div></td>
                    <td>{displayMetricByKey(metricValue(exam, 'IRTARM Strength'), 'IRTARM Strength', forceMode, exam.bodyWeightLb)}</td>
                    <td>{displayMetricByKey(metricValue(exam, 'ERTARM Strength'), 'ERTARM Strength', forceMode, exam.bodyWeightLb)}</td>
                    <td>{displayMetricByKey(metricValue(exam, 'STARM Strength'), 'STARM Strength', forceMode, exam.bodyWeightLb)}</td>
                    <td>{displayMetricByKey(metricValue(exam, 'GTARM Strength'), 'GTARM Strength', forceMode, exam.bodyWeightLb)}</td>
                    <td>{displayMetricByKey(metricValue(exam, 'Shoulder Balance'), 'Shoulder Balance', forceMode, exam.bodyWeightLb)}</td>
                    <td>{displayMetric(metricValue(exam, 'Total %Fresh'))}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </article>
        </>
      )}
    </section>
  );
}

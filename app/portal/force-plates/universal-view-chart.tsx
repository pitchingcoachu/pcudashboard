'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import LeaderboardCorrelationModal from '../dashboard/leaderboard-correlation-modal';
import { resolveSchoolBrand } from '../../../lib/school-brand';
import styles from './universal-view-chart.module.css';

type MetricOption = { key: string; label: string; unit: string; activities: string[] };
type SourceOption = { key: string; label: string; metrics: MetricOption[] };
type Catalog = {
  sources: SourceOption[];
  players: Array<{ id: number; name: string }>;
  groups: Array<{ id: string; name: string; categoryName?: string; label?: string; memberNames: string[] }>;
  minDate: string;
  maxDate: string;
};
type AxisState = { source: string; metric: string; activities: string[] };
type ChartResponse = {
  rows: Array<Record<string, string | number | null>>;
  xLabel: string;
  yLabel: string;
  matchedPlayers: number;
  matchedPoints?: number;
  pointMode?: 'averages' | 'observations';
  eligiblePlayers?: number;
  error?: string;
};

type MultiOption = { value: string; label: string; detail?: string };

const EMPTY_AXIS: AxisState = { source: '', metric: '', activities: ['All'] };

const VALD_TEST_ORDER = ['CMJ', 'SJ', 'SLJ', 'CMRJ', 'ABCMJ', 'DJ', 'IMTP', 'CMJ-SJ'];

function sourceActivityOptions(source?: SourceOption): string[] {
  if (!source) return [];
  const unique = Array.from(new Set(source.metrics.flatMap((metric) => metric.activities).filter((activity) => activity && activity !== 'All')));
  if (source.key === 'vald') {
    const order = new Map(VALD_TEST_ORDER.map((test, index) => [test, index]));
    return unique.toSorted((left, right) => {
      const leftOrder = order.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.localeCompare(right, undefined, { numeric: true });
    });
  }
  return unique.toSorted((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function preferredActivity(sourceKey: string, options: string[]): string {
  if (sourceKey === 'vald') return options.find((value) => value === 'CMJ') ?? options[0] ?? 'All';
  if (sourceKey === 'ovr_sprint') return options.find((value) => value === '10yd Sprint') ?? options[0] ?? 'All';
  if (sourceKey === 'ovr_vbt') return options.find((value) => value === 'Trap Bar Deadlift') ?? options[0] ?? 'All';
  return options[0] ?? 'All';
}

function metricSupportsActivity(metric: MetricOption, activity: string): boolean {
  return activity === 'All' || metric.activities.includes('All') || metric.activities.includes(activity);
}

function MetricSearchSelect({ options, value, onChange, disabled }: { options: MetricOption[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.key === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  }, [options, query]);
  const visibleOptions = filtered.slice(0, 200);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className={styles.metricPicker} ref={rootRef} style={{ minWidth: 0, width: '100%' }}>
      <button type="button" onClick={() => setOpen((current) => !current)} disabled={disabled} aria-expanded={open} style={{ overflow: 'hidden' }}>
        <span style={{ minWidth: 0, flex: 1 }}>{selected?.label ?? 'Choose metric'}</span><b>⌄</b>
      </button>
      {open ? <div className={styles.metricMenu}>
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search every metric…" />
        <div>
          {filtered.length ? visibleOptions.map((option) => (
            <button key={option.key} type="button" className={option.key === value ? styles.selectedMetric : ''} onClick={() => { onChange(option.key); setOpen(false); setQuery(''); }}>
              {option.label}
            </button>
          )) : <p>No matching metrics</p>}
          {filtered.length > visibleOptions.length ? <p>Showing the first {visibleOptions.length} results. Search to narrow the list.</p> : null}
        </div>
      </div> : null}
    </div>
  );
}

function SearchMultiSelect({ options, values, onChange, placeholder, searchPlaceholder = 'Search…', disabled = false }: {
  options: MultiOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  searchPlaceholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = new Set(values);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((option) => `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(needle)) : options;
  }, [options, query]);
  const selectedLabels = values.map((value) => options.find((option) => option.value === value)?.label ?? value);
  const summary = values.length === 0
    ? placeholder
    : values.length <= 3
      ? selectedLabels.join(', ')
      : `${selectedLabels.slice(0, 2).join(', ')} +${values.length - 2}`;

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const toggle = (value: string) => {
    if (selected.has(value)) onChange(values.filter((entry) => entry !== value));
    else onChange([...values, value]);
  };

  return <div className={styles.metricPicker} ref={rootRef} style={{ minWidth: 0, width: '100%' }}>
    <button type="button" onClick={() => setOpen((current) => !current)} disabled={disabled} aria-expanded={open} style={{ overflow: 'hidden' }}>
      <span style={{ minWidth: 0, flex: 1 }}>{summary}</span><b>⌄</b>
    </button>
    {open ? <div className={styles.metricMenu}>
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} />
      <div>
        {values.length ? <button type="button" onClick={() => onChange([])}>Clear selection</button> : null}
        {filtered.map((option) => <button key={option.value} type="button" className={selected.has(option.value) ? styles.selectedMetric : ''} onClick={() => toggle(option.value)}>
          <span aria-hidden="true" style={{ display: 'inline-block', width: 18 }}>{selected.has(option.value) ? '✓' : '○'}</span>
          {option.label}{option.detail ? <small style={{ display: 'block', marginLeft: 18, opacity: .58 }}>{option.detail}</small> : null}
        </button>)}
        {!filtered.length ? <p>No matching options</p> : null}
      </div>
    </div> : null}
  </div>;
}

function chooseDefaultAxes(sources: SourceOption[]): [AxisState, AxisState] {
  const findMetric = (sourceKey: string, matches: (label: string) => boolean): AxisState | null => {
    const source = sources.find((entry) => entry.key === sourceKey);
    const activity = preferredActivity(sourceKey, sourceActivityOptions(source));
    const compatibleMetrics = source?.metrics.filter((entry) => metricSupportsActivity(entry, activity)) ?? [];
    const metric = compatibleMetrics.find((entry) => matches(entry.label)) ?? compatibleMetrics[0];
    if (!source || !metric) return null;
    return { source: source.key, metric: metric.key, activities: [activity] };
  };
  const x = findMetric('vald', (label) => /^jump height \(flight time\) in inches/i.test(label)) ?? findMetric('axioforce', () => true) ?? findMetric('pitching', () => true) ?? EMPTY_AXIS;
  const preferredY = findMetric('pitching', (label) => /^Velo\b/i.test(label)) ?? findMetric('ovr_sprint', () => true);
  const y = preferredY ?? (sources[1]
    ? { source: sources[1].key, metric: sources[1].metrics[0]?.key ?? '', activities: [sources[1].metrics[0]?.activities[0] ?? 'All'] }
    : x);
  return [x, y];
}

function AxisCard({ axis, accent, sources, onChange }: { axis: AxisState; accent: 'x' | 'y'; sources: SourceOption[]; onChange: (axis: AxisState) => void }) {
  const source = sources.find((entry) => entry.key === axis.source);
  const metric = source?.metrics.find((entry) => entry.key === axis.metric);
  const isPitchSource = axis.source === 'pitching' || axis.source === 'hitting';
  const sourceActivities = sourceActivityOptions(source);
  const selectedActivity = axis.activities.find((activity) => sourceActivities.includes(activity)) ?? preferredActivity(axis.source, sourceActivities);
  const compatibleMetrics = isPitchSource
    ? source?.metrics ?? []
    : source?.metrics.filter((entry) => metricSupportsActivity(entry, selectedActivity)) ?? [];
  const pitchActivities = metric?.activities?.length ? metric.activities : ['All'];
  const selectSource = (sourceKey: string) => {
    const nextSource = sources.find((entry) => entry.key === sourceKey);
    const nextActivity = preferredActivity(sourceKey, sourceActivityOptions(nextSource));
    const nextMetric = nextSource?.metrics.find((entry) => metricSupportsActivity(entry, nextActivity));
    onChange({ source: sourceKey, metric: nextMetric?.key ?? '', activities: [nextActivity] });
  };
  const selectMetric = (metricKey: string) => {
    onChange({ ...axis, metric: metricKey });
  };
  const selectActivity = (activity: string) => {
    const nextMetric = metric && metricSupportsActivity(metric, activity)
      ? metric
      : source?.metrics.find((entry) => metricSupportsActivity(entry, activity));
    onChange({ ...axis, metric: nextMetric?.key ?? '', activities: [activity] });
  };

  const activityControl = <label><span>{axis.source === 'vald' ? 'Test' : axis.source === 'ovr_sprint' || axis.source === 'ovr_vbt' ? 'Exercise' : 'Pitch types'}</span>
    {isPitchSource ? <SearchMultiSelect
      options={pitchActivities.filter((activity) => activity !== 'All').map((activity) => ({ value: activity, label: activity }))}
      values={axis.activities.includes('All') ? [] : axis.activities}
      onChange={(values) => {
        const selected = new Set(values);
        const ordered = pitchActivities.filter((activity) => activity !== 'All' && selected.has(activity));
        onChange({ ...axis, activities: ordered.length ? ordered : ['All'] });
      }}
      placeholder="All pitch types"
      searchPlaceholder="Search pitch types…"
      disabled={pitchActivities.length <= 1}
    /> : <select value={selectedActivity} onChange={(event) => selectActivity(event.target.value)} disabled={!sourceActivities.length}>
      {sourceActivities.map((activity) => <option key={activity} value={activity}>{activity}</option>)}
    </select>}
  </label>;

  return <section className={`${styles.axisCard} ${accent === 'x' ? styles.axisX : styles.axisY}`}>
    <div className={styles.axisHeading}><span>{accent.toUpperCase()}</span><div><p>{accent === 'x' ? 'Horizontal axis' : 'Vertical axis'}</p><h3>{source?.label ?? 'Choose a source'}</h3></div></div>
    <label><span>Data source</span><select value={axis.source} onChange={(event) => selectSource(event.target.value)}>{sources.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>
    {isPitchSource ? null : activityControl}
    <label><span>Metric</span><MetricSearchSelect options={compatibleMetrics} value={axis.metric} onChange={selectMetric} disabled={!source || !compatibleMetrics.length} /></label>
    {isPitchSource ? activityControl : null}
  </section>;
}

function formatUniversalChartValue(column: string, value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return value === null || value === undefined || value === '' ? '—' : String(value);
  if (column.startsWith('VALD Force Plates ·') || column.startsWith('AxioForce Mound ·')) return numeric.toFixed(1);
  return String(value);
}

export default function UniversalViewChart({ schoolCode, fixedPlayerName }: { schoolCode: string; fixedPlayerName?: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [xAxis, setXAxis] = useState<AxisState>(EMPTY_AXIS);
  const [yAxis, setYAxis] = useState<AxisState>(EMPTY_AXIS);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [pointMode, setPointMode] = useState<'averages' | 'observations'>(fixedPlayerName ? 'observations' : 'averages');
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState('');
  const [chart, setChart] = useState<ChartResponse | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const schoolBrand = useMemo(() => resolveSchoolBrand(schoolCode), [schoolCode]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch('/api/dashboard/universal-chart?mode=catalog', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as Catalog & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Could not load chart options.');
        setCatalog(payload);
        if (fixedPlayerName) {
          const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
          const matched = payload.players?.find((player) => normalize(player.name) === normalize(fixedPlayerName));
          setSelectedPlayers(matched ? [matched.name] : [fixedPlayerName]);
        }
        const [x, y] = chooseDefaultAxes(payload.sources ?? []);
        setXAxis(x);
        setYAxis(y);
        const today = new Date().toISOString().slice(0, 10);
        const yearAgo = new Date();
        yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
        setStartDate(payload.minDate || yearAgo.toISOString().slice(0, 10));
        setEndDate(payload.maxDate || today);
      })
      .catch((loadError) => { if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Could not load chart options.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [fixedPlayerName]);

  const sameAxis = xAxis.source === yAxis.source && xAxis.metric === yAxis.metric && xAxis.activities.join(',') === yAxis.activities.join(',');

  async function buildChart() {
    if (!xAxis.metric || !yAxis.metric || !startDate || !endDate || sameAxis) return;
    setChartLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        mode: 'chart', startDate, endDate, pointMode,
        groupIds: groupIds.join(','), players: selectedPlayers.join(','),
        xSource: xAxis.source, xMetric: xAxis.metric, xActivities: xAxis.activities.join(','),
        ySource: yAxis.source, yMetric: yAxis.metric, yActivities: yAxis.activities.join(','),
      });
      const response = await fetch(`/api/dashboard/universal-chart?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as ChartResponse;
      if (!response.ok) throw new Error(payload.error || 'Could not build this chart.');
      setChart(payload);
      if (payload.rows.length < 2) setError(`Only ${payload.rows.length} matched data point${payload.rows.length === 1 ? '' : 's'} had both selected metrics in this date range. Two or more are needed for a comparison chart.`);
      else setChartOpen(true);
    } catch (chartError) {
      setError(chartError instanceof Error ? chartError.message : 'Could not build this chart.');
    } finally {
      setChartLoading(false);
    }
  }

  if (loading) return <div className={styles.loading}>Building the metric catalog…</div>;
  if (!catalog) return <article className={styles.errorCard}>{error || 'Chart options are unavailable.'}</article>;

  return <div className={styles.workspace}>
    <section className={styles.hero}>
      <div><p>05 · CROSS-SYSTEM ANALYSIS</p><h2>Compare every signal.</h2><span>Put any two athlete metrics on the same chart—from ball flight to force production, sprinting, and VBT.</span></div>
      <div className={styles.sourceRail}>{catalog.sources.map((source) => <span key={source.key}>{source.label}</span>)}</div>
    </section>

    <div className={styles.axisGrid}>
      <AxisCard axis={xAxis} accent="x" sources={catalog.sources} onChange={setXAxis} />
      <AxisCard axis={yAxis} accent="y" sources={catalog.sources} onChange={setYAxis} />
    </div>

    <section className={styles.scopeCard}>
      <div className={styles.scopeHeading}><div><p>Comparison scope</p><h3>{pointMode === 'averages' ? 'One dot per athlete' : 'Every matched date'}</h3></div><span>{pointMode === 'averages' ? 'Values are weighted averages across the selected range.' : 'Each dot is a player-date where both selected performance metrics exist.'} Players missing either metric are excluded.</span></div>
      <div className={styles.scopeGrid} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <label><span>Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label><span>End date</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
        {!fixedPlayerName && catalog.groups.length ? <label><span>VALD groups</span><SearchMultiSelect
          options={catalog.groups.map((group) => ({ value: group.id, label: group.label || group.name, detail: `${group.memberNames.length} athletes` }))}
          values={groupIds}
          onChange={setGroupIds}
          placeholder="All VALD groups"
          searchPlaceholder="Search VALD groups…"
        /></label> : null}
        {fixedPlayerName ? <label><span>Athlete</span><input value={fixedPlayerName} readOnly aria-label="Selected athlete" /></label> : <label><span>Specific players</span><SearchMultiSelect
          options={catalog.players.map((player) => ({ value: player.name, label: player.name }))}
          values={selectedPlayers}
          onChange={setSelectedPlayers}
          placeholder="All eligible players"
          searchPlaceholder="Search players…"
        /></label>}
        <label><span>Chart points</span><select value={pointMode} onChange={(event) => setPointMode(event.target.value === 'observations' ? 'observations' : 'averages')}>
          <option value="averages">Athlete averages</option>
          <option value="observations">Every data point / date</option>
        </select></label>
        <button type="button" onClick={() => void buildChart()} disabled={chartLoading || !xAxis.metric || !yAxis.metric || sameAxis || startDate > endDate}>
          {chartLoading ? 'Building chart…' : 'View chart'}
        </button>
      </div>
      {sameAxis ? <p className={styles.inlineError}>Choose two different metrics or test types.</p> : null}
      {error ? <p className={styles.inlineError}>{error}</p> : null}
      {chart && chart.rows.length >= 2 && !chartOpen ? <div className={styles.lastResult}><span><b>{chart.rows.length}</b> matched {chart.pointMode === 'observations' ? 'data points' : 'athletes'}</span><button type="button" onClick={() => setChartOpen(true)}>Reopen chart</button></div> : null}
    </section>

    {chart ? <LeaderboardCorrelationModal
      open={chartOpen}
      onClose={() => setChartOpen(false)}
      title="Cross-System Athlete Comparison"
      columns={[chart.pointMode === 'observations' ? 'Data Point' : 'Player', chart.xLabel, chart.yLabel]}
      axisColumns={[chart.xLabel, chart.yLabel]}
      rows={chart.rows}
      minPointsRequired={2}
      viewByLabel={chart.pointMode === 'observations' ? 'Data point' : 'Player'}
      primaryColumnName={chart.pointMode === 'observations' ? 'Data Point' : 'Player'}
      siteLogoSrc={schoolBrand.logoSrc ?? '/pearl-clam-transparent.png'}
      siteLogoAlt={schoolBrand.logoAlt}
      siteLogoSize={48}
      formatValue={formatUniversalChartValue}
    /> : null}
  </div>;
}

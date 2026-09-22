'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import styles from './ai-report-summary.module.css';

type ReportValue = string | number | null;
type ReportRow = Record<string, ReportValue>;
type ChartPoint = Record<string, unknown>;
type BiomechanicsPercentiles = {
  selectedGroupId: string;
  selectedGroupLabel: string;
  comparisonWindow?: string;
  rows: Record<string, Record<string, {
    value: number;
    percentile: number | null;
    sampleSize: number;
    rankingDirection?: 'higher_is_higher' | 'lower_is_better' | 'handedness_normalized';
  }>>;
};
type ForcePlatePercentileConfig = {
  player: string;
  groupId: string;
  testType: string;
  comparisonStartDate?: string;
  comparisonEndDate?: string;
  metrics: Array<{ value: string; label: string; metricName: string; metricUnit: string }>;
};
type BiomechanicsPercentileConfig = {
  player: string;
  groupId: string;
  forceMode: 'force' | 'bw';
  pitchType: string;
  comparisonStartDate?: string;
  comparisonEndDate?: string;
  metrics: Array<{ value: string; label: string }>;
};
type BaseballPercentileEvidence = { metric: string; metricLabel: string; value: number | null; percentile: number | null; sampleSize: number; poolLabel: string; comparisonWindow: string; rankingDirection: string };
export type AiReportPanel = { id: string; title: string; panelType: string; requestUrl: string; tableColumns: string[]; tableRows: ReportRow[]; chartPoints: object[]; options?: { heatStat?: string; contact2dColorBy?: string; contact3dColorBy?: string; batSpeedColorBy?: string; sprayView?: string; biomechanicsPercentiles?: BiomechanicsPercentiles; forcePlatePercentileConfig?: ForcePlatePercentileConfig; biomechanicsPercentileConfig?: BiomechanicsPercentileConfig; baseballPercentile?: BaseballPercentileEvidence } };
type AiReportSummaryProps = { reportType: string; title: string; playerName?: string; reportStart: string; reportEnd: string; panels: AiReportPanel[]; autoGenerate?:boolean; onReady?:(ready:boolean)=>void };
type MetricField = { key: string; label: string };
type MetricAggregate = { group: string; metric: string; average: number; minimum: number; maximum: number; sampleSize: number };

const CHART_METRICS: Record<string, MetricField[]> = {
  'Movement Plot': [{ key: 'ivb', label: 'IVB' }, { key: 'hb', label: 'HB' }],
  'Release Plot': [{ key: 'release_height', label: 'Release Height' }, { key: 'release_side', label: 'Release Side' }],
  'Location Plot': [{ key: 'plate_side', label: 'Plate Side' }, { key: 'plate_height', label: 'Plate Height' }],
  Heatmap: [{ key: 'plate_side', label: 'Plate Side' }, { key: 'plate_height', label: 'Plate Height' }],
  'Velocity Chart': [{ key: 'rel_speed', label: 'Velocity' }],
  'Velocity Bar Chart': [{ key: 'rel_speed', label: 'Velocity' }],
  'Velocity Distribution': [{ key: 'rel_speed', label: 'Velocity' }],
  '2D Contact': [{ key: 'contact_position_x', label: 'Contact Position X' }, { key: 'contact_position_z', label: 'Contact Position Z' }],
  '3D Contact': [{ key: 'contact_position_x', label: 'Contact Position X' }, { key: 'contact_position_y', label: 'Contact Position Y' }, { key: 'contact_position_z', label: 'Contact Position Z' }],
  'Horizontal Attack': [{ key: 'horizontal_attack_angle', label: 'Horizontal Attack Angle' }],
  'Vertical Attack': [{ key: 'vertical_attack_angle', label: 'Vertical Attack Angle' }],
  'Bat Speed': [{ key: 'bat_speed', label: 'Bat Speed' }],
  'EV and LA': [{ key: 'exit_speed', label: 'Exit Velocity' }, { key: 'angle', label: 'Launch Angle' }],
  'Spray Chart': [{ key: 'direction', label: 'Spray Direction' }, { key: 'distance', label: 'Distance' }],
  'Nutrition Calorie Trends': [
    { key: 'calories', label: 'Calories' },
    { key: 'target_calories', label: 'Calorie Target' },
  ],
  'Nutrition Macro Breakdown': [
    { key: 'protein_g', label: 'Protein' },
    { key: 'carbs_g', label: 'Carbohydrates' },
    { key: 'fat_g', label: 'Fat' },
  ],
  'Bullpen Script Trend Chart': [{ key: 'value', label: 'Bullpen Script Trend' }],
};

function shiftDate(value: string, days: number): string { const date = new Date(`${value}T12:00:00Z`); if (Number.isNaN(date.getTime())) return ''; date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function cleanNarrative(value: unknown): string { const lines = String(value ?? '').replace(/\r\n/g, '\n').split('\n'); while (lines.length && !lines[0].trim()) lines.shift(); if (lines[0] && /^(?:#+\s*)?.{0,100}\bsummary\b(?:\s*[-—:].*)?$/i.test(lines[0].trim())) lines.shift(); while (lines.length && (!lines[0].trim() || /^(?:session|reference window|comparison window)\s*:/i.test(lines[0].trim()))) lines.shift(); return lines.join('\n').trim(); }
function finiteNumber(value: unknown): number | null { if (typeof value === 'number') return Number.isFinite(value) ? value : null; const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); if (!match) return null; const parsed = Number(match[0]); return Number.isFinite(parsed) ? parsed : null; }

function panelMetricFields(panel: AiReportPanel): MetricField[] {
  const base = [...(CHART_METRICS[panel.panelType] ?? [])];
  const colorBy = panel.panelType === '2D Contact' ? panel.options?.contact2dColorBy : panel.panelType === '3D Contact' ? panel.options?.contact3dColorBy : panel.panelType === 'Bat Speed' ? panel.options?.batSpeedColorBy : '';
  if (colorBy === 'exit_velocity' && !base.some((field) => field.key === 'exit_speed')) base.push({ key: 'exit_speed', label: 'Exit Velocity' });
  return base;
}

function aggregatePoints(points: object[], fields: MetricField[]): MetricAggregate[] {
  const buckets = new Map<string, number[]>();
  for (const rawPoint of points) {
    const point = rawPoint as ChartPoint;
    const group = String(point.pitch_type ?? 'All').trim() || 'All';
    for (const field of fields) {
      const fallback = field.key === 'rel_speed' ? point.velo : undefined;
      const value = finiteNumber(point[field.key] ?? fallback);
      if (value === null) continue;
      const key = `${group}\u0000${field.label}`;
      const values = buckets.get(key) ?? []; values.push(value); buckets.set(key, values);
    }
  }
  return Array.from(buckets.entries()).map(([key, values]) => { const [group, metric] = key.split('\u0000'); return { group, metric, average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)), minimum: Number(Math.min(...values).toFixed(2)), maximum: Number(Math.max(...values).toFixed(2)), sampleSize: values.length }; });
}

function usageRows(points: object[]): Array<{ pitchType: string; count: number; share: number }> { const counts = new Map<string, number>(); for (const rawPoint of points) { const pitchType = String((rawPoint as ChartPoint).pitch_type ?? 'Unknown').trim() || 'Unknown'; counts.set(pitchType, (counts.get(pitchType) ?? 0) + 1); } const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0) || 1; return Array.from(counts, ([pitchType, count]) => ({ pitchType, count, share: Number(((count / total) * 100).toFixed(1)) })); }
function sanitizeTable(columns: string[], rows: ReportRow[]) { const visibleColumns = columns.map(String).filter(Boolean); return { columns: visibleColumns, rows: rows.slice(0, 80).map((row) => Object.fromEntries(visibleColumns.map((column) => [column, row[column] ?? null]))) }; }
function compareTables(current: ReturnType<typeof sanitizeTable>, reference: ReturnType<typeof sanitizeTable>) { const groupColumn = current.columns.includes('Pitch Type') ? 'Pitch Type' : current.columns[0]; const metadataColumns = new Set(['Name', 'Date', '#', 'Pitch Type', 'Tags', 'Session']); const metricColumns = current.columns.filter((column) => column !== groupColumn && !metadataColumns.has(column)); if (!groupColumn) return []; const referenceRows = new Map(reference.rows.map((row) => [String(row[groupColumn] ?? '').trim().toLowerCase(), row])); return current.rows.flatMap((row) => { const group = String(row[groupColumn] ?? 'All'); const referenceRow = referenceRows.get(group.trim().toLowerCase()); if (!referenceRow) return []; const currentSampleSize = finiteNumber(row['#'] ?? row.P ?? row.Pitches ?? row.PA); const referenceSampleSize = finiteNumber(referenceRow['#'] ?? referenceRow.P ?? referenceRow.Pitches ?? referenceRow.PA); return metricColumns.flatMap((metric) => { const currentValue = finiteNumber(row[metric]); const referenceValue = finiteNumber(referenceRow[metric]); return currentValue === null || referenceValue === null ? [] : [{ group, metric, current: currentValue, referenceAverage: referenceValue, difference: Number((currentValue - referenceValue).toFixed(2)), currentSampleSize, referenceSampleSize }]; }); }); }
function compareAggregates(current: MetricAggregate[], reference: MetricAggregate[]) { const referenceMap = new Map(reference.map((item) => [`${item.group}\u0000${item.metric}`, item])); return current.flatMap((item) => { const prior = referenceMap.get(`${item.group}\u0000${item.metric}`); return prior ? [{ group: item.group, metric: item.metric, currentAverage: item.average, referenceAverage: prior.average, difference: Number((item.average - prior.average).toFixed(2)), currentSampleSize: item.sampleSize, referenceSampleSize: prior.sampleSize }] : []; }); }
function requestForWindow(requestUrl: string, start: string, end: string): string { const url = new URL(requestUrl, window.location.origin); const biomechanics = url.pathname.includes('/biomechanics'); url.searchParams.set(biomechanics ? 'startDate' : 'start_date', start); url.searchParams.set(biomechanics ? 'endDate' : 'end_date', end); url.searchParams.set('recent_pa_ignore_dates', '0'); return `${url.pathname}?${url.searchParams.toString()}`; }
function mlbBenchmarkRequest(requestUrl: string): string { const url = new URL(requestUrl, window.location.origin); for (const key of ['start_date', 'end_date', 'pitcher', 'hitter', 'catcher', 'chart_only', 'chart_points_limit']) url.searchParams.delete(key); url.searchParams.set('percentile_baseline', '1'); url.searchParams.set('percentile_pool', 'mlb'); url.searchParams.set('include_chart_points', '0'); return `${url.pathname}?${url.searchParams.toString()}`; }
function requestContext(requestUrl: string) { const url = new URL(requestUrl, window.location.origin); return { sessionType: url.searchParams.get('session_type') ?? 'All', tableMode: url.searchParams.get('table_mode') ?? '', pitchTypes: url.searchParams.get('pitch_types') ?? 'All', countFilter: url.searchParams.get('count_filter') ?? 'All', afterCountFilter: url.searchParams.get('after_count_filter') ?? 'All', batterSide: url.searchParams.get('batter_side') ?? 'All' }; }
function playerFromPanelRequests(reportType: string, panels: AiReportPanel[]): string {
  const playerParam = /^hitting/i.test(reportType) ? 'hitter' : /^catching/i.test(reportType) ? 'catcher' : 'pitcher';
  const names = new Set(
    panels
      .map((panel) => new URL(panel.requestUrl, window.location.origin).searchParams.get(playerParam)?.trim() ?? '')
      .filter((name) => name && name.toLowerCase() !== 'all')
  );
  return names.size === 1 ? (Array.from(names)[0] ?? '') : '';
}
function currentEvidence(panel: AiReportPanel) {
  if (panel.panelType === 'Baseball Percentile Tile') {
    return { kind: 'percentiles' as const, group: panel.options?.baseballPercentile?.poolLabel ?? '', rows: panel.options?.baseballPercentile ? [panel.options.baseballPercentile] : [] };
  }
  if (panel.panelType === 'Summary Table' || panel.panelType === 'Biomechanics Table' || panel.panelType === 'Bullpen Script Summary Table') {
    return {
      kind: 'table' as const,
      ...sanitizeTable(panel.tableColumns, panel.tableRows),
      ...(panel.options?.biomechanicsPercentiles ? { percentiles: panel.options.biomechanicsPercentiles } : {}),
    };
  }
  if (panel.panelType === 'Pitch Usage Pie Chart' || panel.panelType === 'Pitch Usage Bar Chart') return { kind: 'usage' as const, rows: usageRows(panel.chartPoints) };
  return { kind: 'chart' as const, aggregates: aggregatePoints(panel.chartPoints, panelMetricFields(panel)) };
}
function allowedMetrics(panel: AiReportPanel): string[] {
  if (panel.panelType === 'Summary Table' || panel.panelType === 'Biomechanics Table' || panel.panelType === 'Bullpen Script Summary Table') {
    const metadataColumns = new Set(['Name', 'Date', '#', 'Pitch Type', 'Pitch', 'Tags', 'Session']);
    return panel.tableColumns.map(String).filter((column) => column && !metadataColumns.has(column));
  }
  if (panel.panelType === 'Performance Percentile Summary') return Array.from(new Set([
    ...(panel.options?.forcePlatePercentileConfig?.metrics.map((metric) => metric.label) ?? []),
    ...(panel.options?.biomechanicsPercentileConfig?.metrics.map((metric) => metric.label) ?? []),
  ]));
  if (panel.panelType === 'Baseball Percentile Tile') return panel.options?.baseballPercentile?.metricLabel ? [panel.options.baseballPercentile.metricLabel] : [];
  if (panel.panelType === 'Pitch Usage Pie Chart' || panel.panelType === 'Pitch Usage Bar Chart') return ['Pitch Usage'];
  const metrics = panelMetricFields(panel).map((field) => field.label);
  if (panel.panelType === 'Heatmap' && panel.options?.heatStat) metrics.push(panel.options.heatStat);
  if (panel.panelType === 'Spray Chart') metrics.push('Batted Ball Result');
  return Array.from(new Set(metrics));
}

async function loadForcePlatePercentileEvidence(panel: AiReportPanel, reportStart: string, reportEnd: string) {
  const config = panel.options?.forcePlatePercentileConfig;
  if (!config?.player || !config.metrics.length) return { kind: 'percentiles' as const, group: '', rows: [] };
  const rows = await Promise.all(config.metrics.map(async (metric) => {
    const rankParams = new URLSearchParams({
      player: config.player,
      metricName: metric.metricName,
      metricUnit: metric.metricUnit,
      groupId: config.groupId || 'all',
      testType: config.testType || 'All',
      mode: 'average',
      startDate: reportStart,
      endDate: reportEnd,
    });
    const overviewParams = new URLSearchParams({
      player: config.player,
      metrics: metric.value,
      test_type: config.testType || 'All',
      start_date: reportStart,
      end_date: reportEnd,
    });
    if (config.comparisonStartDate) rankParams.set('comparisonStartDate', config.comparisonStartDate);
    if (config.comparisonEndDate) rankParams.set('comparisonEndDate', config.comparisonEndDate);
    const [rankResponse, overviewResponse] = await Promise.all([
      fetch(`/api/player/force-plate-percentiles?${rankParams.toString()}`, { cache: 'no-store' }),
      fetch(`/api/dashboard/force-plates/overview?${overviewParams.toString()}`, { cache: 'no-store' }),
    ]);
    const rankPayload = await rankResponse.json().catch(() => ({})) as { selectedGroupLabel?: string; comparisonWindow?: string; stats?: { latest?: { percentile: number | null; sampleSize: number } } };
    const overviewPayload = await overviewResponse.json().catch(() => ({})) as { chart_points?: Array<Record<string, unknown>> };
    if (!rankResponse.ok || !overviewResponse.ok) return null;
    const points = (overviewPayload.chart_points ?? [])
      .filter((point) => String(point.metric ?? '') === metric.value)
      .flatMap((point) => {
        const value = finiteNumber(point.value);
        const date = String(point.session_date ?? '');
        return value === null ? [] : [{ value, date }];
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    const latest = points.at(-1);
    return {
      metric: metric.label,
      value: latest?.value ?? null,
      unit: metric.metricUnit,
      testType: config.testType || 'All',
      group: rankPayload.selectedGroupLabel ?? 'All PCU athletes',
      comparisonWindow: rankPayload.comparisonWindow ?? 'Last 365 days',
      percentile: rankPayload.stats?.latest?.percentile ?? null,
      sampleSize: rankPayload.stats?.latest?.sampleSize ?? 0,
    };
  }));
  const visibleRows = rows.filter((row): row is NonNullable<typeof row> => row !== null && row.value !== null);
  return { kind: 'percentiles' as const, group: visibleRows[0]?.group ?? '', rows: visibleRows };
}

async function loadPercentileSummaryEvidence(panel: AiReportPanel, reportStart: string, reportEnd: string) {
  const forcePlate = await loadForcePlatePercentileEvidence(panel, reportStart, reportEnd);
  const biomechanicsConfig = panel.options?.biomechanicsPercentileConfig;
  if (!biomechanicsConfig?.player || !biomechanicsConfig.metrics.length) return forcePlate;
  const params = new URLSearchParams({
    player: biomechanicsConfig.player,
    groupId: biomechanicsConfig.groupId || 'all',
    forceMode: biomechanicsConfig.forceMode || 'force',
    startDate: reportStart,
    endDate: reportEnd,
  });
  if (biomechanicsConfig.comparisonStartDate) params.set('comparisonStartDate', biomechanicsConfig.comparisonStartDate);
  if (biomechanicsConfig.comparisonEndDate) params.set('comparisonEndDate', biomechanicsConfig.comparisonEndDate);
  if (biomechanicsConfig.pitchType && biomechanicsConfig.pitchType !== 'All') {
    params.set('pitchTypes', JSON.stringify([biomechanicsConfig.pitchType]));
  }
  const response = await fetch(`/api/player/biomechanics-percentiles?${params.toString()}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as {
    selectedGroupLabel?: string;
    comparisonWindow?: string;
    rows?: Record<string, Record<string, {
      value: number;
      percentile: number | null;
      sampleSize: number;
      rankingDirection?: 'higher_is_higher' | 'lower_is_better' | 'handedness_normalized';
    }>>;
  };
  if (!response.ok) return forcePlate;
  const pitchType = biomechanicsConfig.pitchType && biomechanicsConfig.pitchType !== 'All' ? biomechanicsConfig.pitchType : 'All';
  const rankRow = payload.rows?.[pitchType] ?? payload.rows?.All ?? {};
  const biomechanicsRows = biomechanicsConfig.metrics.flatMap((metric) => {
    const rank = rankRow[metric.value];
    return rank ? [{
      source: 'AxioForce',
      metric: metric.label,
      value: rank.value,
      pitchType,
      group: payload.selectedGroupLabel ?? 'All PCU athletes',
      comparisonWindow: payload.comparisonWindow ?? 'Last 365 days',
      percentile: rank.percentile,
      sampleSize: rank.sampleSize,
      rankingDirection: rank.rankingDirection ?? 'higher_is_higher',
    }] : [];
  });
  return {
    kind: 'percentiles' as const,
    group: biomechanicsRows[0]?.group ?? forcePlate.group,
    rows: [...forcePlate.rows, ...biomechanicsRows],
  };
}

function parseDate(value: string): Date { return new Date(`${value || '2000-01-01'}T12:00:00`); }
function toDateValue(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function displayDate(value: string): string { const date = parseDate(value); return Number.isNaN(date.getTime()) ? 'Select date' : new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }).format(date); }

function SummaryDatePicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const [month, setMonth] = useState(() => { const date = parseDate(value); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const open = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const date = parseDate(value);
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setAnchor({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 284)), top: Math.max(12, rect.top - 326) });
  };
  const days = Array.from({ length: 42 }, (_, index) => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    return new Date(month.getFullYear(), month.getMonth(), index - first.getDay() + 1);
  });
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(month);
  return <label className={styles.dateField}>{label}<button type="button" className={styles.dateButton} onClick={open} aria-haspopup="dialog" aria-expanded={Boolean(anchor)}>{displayDate(value)}</button>{anchor ? createPortal(<><button type="button" className={styles.dateBackdrop} onClick={() => setAnchor(null)} aria-label="Close calendar" /><div className={styles.datePopover} role="dialog" aria-label={`${label} calendar`} style={{ left: anchor.left, top: anchor.top }}><div className={styles.calendarHeader}><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">‹</button><strong>{monthName}</strong><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">›</button></div><div className={styles.weekdays}>{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span key={day}>{day}</span>)}</div><div className={styles.calendarDays}>{days.map((day) => { const dayValue = toDateValue(day); const inMonth = day.getMonth() === month.getMonth(); return <button key={dayValue} type="button" className={`${!inMonth ? styles.outsideDay : ''} ${dayValue === value ? styles.selectedDay : ''}`} onClick={() => { onChange(dayValue); setAnchor(null); }}>{day.getDate()}</button>; })}</div></div></>, document.body) : null}</label>;
}

export default function AiReportSummary({ reportType, title, playerName = '', reportStart, reportEnd, panels, autoGenerate=false, onReady }: AiReportSummaryProps) {
  const duration = Math.max(1, Math.round((Date.parse(reportEnd) - Date.parse(reportStart)) / 86_400_000) + 1);
  const [comparisonStart, setComparisonStart] = useState(() => shiftDate(reportStart, -duration)); const [comparisonEnd, setComparisonEnd] = useState(() => shiftDate(reportStart, -1)); const [summary, setSummary] = useState(''); const [loading, setLoading] = useState(false); const [include, setInclude] = useState(true); const [error, setError] = useState('');
  const reportPanels = useMemo(() => panels.filter((panel) => panel.panelType !== 'Note Section' && (panel.requestUrl || panel.options?.forcePlatePercentileConfig || panel.options?.biomechanicsPercentileConfig || panel.options?.baseballPercentile)), [panels]);
  const autoGeneratedKeyRef = useRef('');
  useEffect(() => { setComparisonStart(shiftDate(reportStart, -duration)); setComparisonEnd(shiftDate(reportStart, -1)); setSummary(''); }, [duration, reportEnd, reportStart, reportType, title]);

  async function generate() {
    setLoading(true); setError('');
    try {
      const evidence = await Promise.all(reportPanels.map(async (panel) => {
        if (panel.panelType === 'Performance Percentile Summary') {
          const current = await loadPercentileSummaryEvidence(panel, reportStart, reportEnd);
          return {
            title: panel.title,
            panelType: panel.panelType,
            context: panel.requestUrl ? requestContext(panel.requestUrl) : { sessionType: 'All', tableMode: '', pitchTypes: 'All', countFilter: 'All', afterCountFilter: 'All', batterSide: 'All' },
            allowedMetrics: allowedMetrics(panel),
            current,
            reference: null,
            comparisons: [],
            mlbBenchmark: null,
          };
        }
        if (panel.panelType === 'Baseball Percentile Tile') {
          return {
            title: panel.title,
            panelType: panel.panelType,
            context: panel.requestUrl ? requestContext(panel.requestUrl) : { sessionType: 'All', tableMode: '', pitchTypes: 'All', countFilter: 'All', afterCountFilter: 'All', batterSide: 'All' },
            allowedMetrics: allowedMetrics(panel),
            current: currentEvidence(panel),
            reference: null,
            comparisons: [],
            mlbBenchmark: null,
          };
        }
        const response = await fetch(requestForWindow(panel.requestUrl, comparisonStart, comparisonEnd), { cache: 'no-store' });
        const referencePayload = await response.json() as { table_columns?: string[]; table_rows?: ReportRow[]; chart_points?: object[]; error?: string };
        if (!response.ok) throw new Error(referencePayload.error || `Could not load the comparison for ${panel.title}.`);
        const current = currentEvidence(panel);
        const reference = currentEvidence({
          ...panel,
          tableColumns: referencePayload.table_columns ?? [],
          tableRows: referencePayload.table_rows ?? [],
          chartPoints: referencePayload.chart_points ?? [],
          options: panel.options ? { ...panel.options, biomechanicsPercentiles: undefined } : undefined,
        });
        const comparisons = current.kind === 'table' && reference.kind === 'table' ? compareTables(current, reference) : current.kind === 'chart' && reference.kind === 'chart' ? compareAggregates(current.aggregates, reference.aggregates) : [];
                      let mlbBenchmark: ReturnType<typeof sanitizeTable> | null = null;
        if (panel.panelType === 'Summary Table' && /pitching|hitting/i.test(reportType)) {
          try {
            const benchmarkResponse = await fetch(mlbBenchmarkRequest(panel.requestUrl), {
              cache: 'no-store',
              signal: AbortSignal.timeout(5_000),
            });
            const benchmarkPayload = await benchmarkResponse.json() as { table_rows?: ReportRow[] };
            if (benchmarkResponse.ok) mlbBenchmark = sanitizeTable(panel.tableColumns, benchmarkPayload.table_rows ?? []);
          } catch { mlbBenchmark = null; }
        }
        return { title: panel.title, panelType: panel.panelType, context: requestContext(panel.requestUrl), allowedMetrics: allowedMetrics(panel), current, reference, comparisons, mlbBenchmark };
      }));
      const metricWhitelist = Array.from(new Set(evidence.flatMap((panel) => panel.allowedMetrics)));
      if (!metricWhitelist.length) throw new Error('Add a data panel to the report before generating a summary.');
      const resolvedPlayerName = playerName || playerFromPanelRequests(reportType, reportPanels);
      const response = await fetch('/api/ai/report-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportType, title, playerName: resolvedPlayerName, reportStart, reportEnd, comparisonStart, comparisonEnd, allowedMetrics: metricWhitelist, data: { panels: evidence } }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Could not generate summary.'); setSummary(cleanNarrative(payload.summary));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not generate summary.'); } finally { setLoading(false); onReady?.(true); }
  }

  useEffect(() => {
    if (!autoGenerate || !reportPanels.length || !reportStart || !reportEnd) return;
    const key = `${title}|${playerName}|${reportStart}|${reportEnd}|${reportPanels.map((panel) => panel.requestUrl).join('|')}`;
    if (autoGeneratedKeyRef.current === key) return;
    autoGeneratedKeyRef.current = key;
    onReady?.(false);
    void generate();
  // Generate once after the automated report's complete panel set is available.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[autoGenerate,reportPanels,reportStart,reportEnd,title,playerName]);

  return <section className={styles.summary} data-export-ignore={include && summary ? undefined : 'true'}>
    <div className={styles.heading}><div><span>Coach Analysis</span><h3>Report Summary</h3></div><button data-export-ignore="true" className="btn btn-primary" onClick={() => void generate()} disabled={loading || !reportPanels.length || !reportStart || !reportEnd}>{loading ? 'Generating…' : summary ? 'Regenerate' : 'Generate summary'}</button></div>
    <p data-export-ignore="true" className={styles.description}>Choose the comparison window, then generate a coach-style reading of the report.</p>
    <div data-export-ignore="true" className={styles.controls}><label>Report period<input value={`${reportStart} to ${reportEnd}`} readOnly /></label><SummaryDatePicker label="Comparison start" value={comparisonStart} onChange={setComparisonStart} /><SummaryDatePicker label="Comparison end" value={comparisonEnd} onChange={setComparisonEnd} /></div>
    {error ? <p data-export-ignore="true" className="auth-error">{error}</p> : null}
    {summary ? <><textarea data-export-ignore="true" className={styles.editor} rows={8} value={summary} onChange={(event) => setSummary(event.target.value)} /><div className={styles.exportText}>{summary}</div><label data-export-ignore="true" className="portal-checkbox-label"><input type="checkbox" checked={include} onChange={(event) => setInclude(event.target.checked)} /> Include this summary in report exports</label></> : null}
  </section>;
}

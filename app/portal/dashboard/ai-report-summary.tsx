'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './ai-report-summary.module.css';

type ReportValue = string | number | null;
type ReportRow = Record<string, ReportValue>;
type ChartPoint = Record<string, unknown>;
export type AiReportPanel = { id: string; title: string; panelType: string; requestUrl: string; tableColumns: string[]; tableRows: ReportRow[]; chartPoints: object[]; options?: { heatStat?: string; contact2dColorBy?: string; contact3dColorBy?: string; batSpeedColorBy?: string; sprayView?: string } };
type AiReportSummaryProps = { reportType: string; title: string; reportStart: string; reportEnd: string; panels: AiReportPanel[] };
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
function compareTables(current: ReturnType<typeof sanitizeTable>, reference: ReturnType<typeof sanitizeTable>) { const [groupColumn, ...metricColumns] = current.columns; if (!groupColumn) return []; const referenceRows = new Map(reference.rows.map((row) => [String(row[groupColumn] ?? '').trim().toLowerCase(), row])); return current.rows.flatMap((row) => { const group = String(row[groupColumn] ?? 'All'); const referenceRow = referenceRows.get(group.trim().toLowerCase()); if (!referenceRow) return []; return metricColumns.flatMap((metric) => { const currentValue = finiteNumber(row[metric]); const referenceValue = finiteNumber(referenceRow[metric]); return currentValue === null || referenceValue === null ? [] : [{ group, metric, current: currentValue, referenceAverage: referenceValue, difference: Number((currentValue - referenceValue).toFixed(2)) }]; }); }); }
function compareAggregates(current: MetricAggregate[], reference: MetricAggregate[]) { const referenceMap = new Map(reference.map((item) => [`${item.group}\u0000${item.metric}`, item])); return current.flatMap((item) => { const prior = referenceMap.get(`${item.group}\u0000${item.metric}`); return prior ? [{ group: item.group, metric: item.metric, currentAverage: item.average, referenceAverage: prior.average, difference: Number((item.average - prior.average).toFixed(2)), currentSampleSize: item.sampleSize, referenceSampleSize: prior.sampleSize }] : []; }); }
function requestForWindow(requestUrl: string, start: string, end: string): string { const url = new URL(requestUrl, window.location.origin); url.searchParams.set('start_date', start); url.searchParams.set('end_date', end); url.searchParams.set('recent_pa_ignore_dates', '0'); return `${url.pathname}?${url.searchParams.toString()}`; }
function mlbBenchmarkRequest(requestUrl: string): string { const url = new URL(requestUrl, window.location.origin); for (const key of ['start_date', 'end_date', 'pitcher', 'hitter', 'catcher', 'chart_only', 'chart_points_limit']) url.searchParams.delete(key); url.searchParams.set('percentile_baseline', '1'); url.searchParams.set('percentile_pool', 'mlb'); url.searchParams.set('include_chart_points', '0'); return `${url.pathname}?${url.searchParams.toString()}`; }
function currentEvidence(panel: AiReportPanel) { if (panel.panelType === 'Summary Table') return { kind: 'table' as const, ...sanitizeTable(panel.tableColumns, panel.tableRows) }; if (panel.panelType === 'Pitch Usage Pie Chart' || panel.panelType === 'Pitch Usage Bar Chart') return { kind: 'usage' as const, rows: usageRows(panel.chartPoints) }; return { kind: 'chart' as const, aggregates: aggregatePoints(panel.chartPoints, panelMetricFields(panel)) }; }
function allowedMetrics(panel: AiReportPanel): string[] { if (panel.panelType === 'Summary Table') return panel.tableColumns.slice(1).map(String).filter(Boolean); if (panel.panelType === 'Pitch Usage Pie Chart' || panel.panelType === 'Pitch Usage Bar Chart') return ['Pitch Usage']; const metrics = panelMetricFields(panel).map((field) => field.label); if (panel.panelType === 'Heatmap' && panel.options?.heatStat) metrics.push(panel.options.heatStat); if (panel.panelType === 'Spray Chart') metrics.push('Batted Ball Result'); return Array.from(new Set(metrics)); }

export default function AiReportSummary({ reportType, title, reportStart, reportEnd, panels }: AiReportSummaryProps) {
  const duration = Math.max(1, Math.round((Date.parse(reportEnd) - Date.parse(reportStart)) / 86_400_000) + 1);
  const [comparisonStart, setComparisonStart] = useState(() => shiftDate(reportStart, -duration)); const [comparisonEnd, setComparisonEnd] = useState(() => shiftDate(reportStart, -1)); const [summary, setSummary] = useState(''); const [loading, setLoading] = useState(false); const [include, setInclude] = useState(true); const [error, setError] = useState('');
  const reportPanels = useMemo(() => panels.filter((panel) => panel.panelType !== 'Note Section' && panel.requestUrl), [panels]);
  useEffect(() => { setComparisonStart(shiftDate(reportStart, -duration)); setComparisonEnd(shiftDate(reportStart, -1)); setSummary(''); }, [duration, reportEnd, reportStart, reportType, title]);

  async function generate() {
    setLoading(true); setError('');
    try {
      const evidence = await Promise.all(reportPanels.map(async (panel) => {
        const response = await fetch(requestForWindow(panel.requestUrl, comparisonStart, comparisonEnd), { cache: 'no-store' });
        const referencePayload = await response.json() as { table_columns?: string[]; table_rows?: ReportRow[]; chart_points?: object[]; error?: string };
        if (!response.ok) throw new Error(referencePayload.error || `Could not load the comparison for ${panel.title}.`);
        const current = currentEvidence(panel); const reference = currentEvidence({ ...panel, tableColumns: referencePayload.table_columns ?? [], tableRows: referencePayload.table_rows ?? [], chartPoints: referencePayload.chart_points ?? [] });
        const comparisons = current.kind === 'table' && reference.kind === 'table' ? compareTables(current, reference) : current.kind === 'chart' && reference.kind === 'chart' ? compareAggregates(current.aggregates, reference.aggregates) : [];
                      let mlbBenchmark: ReturnType<typeof sanitizeTable> | null = null;
        if (panel.panelType === 'Summary Table' && /pitching|hitting/i.test(reportType)) {
          try {
            const benchmarkResponse = await fetch(mlbBenchmarkRequest(panel.requestUrl), { cache: 'no-store' });
            const benchmarkPayload = await benchmarkResponse.json() as { table_rows?: ReportRow[] };
            if (benchmarkResponse.ok) mlbBenchmark = sanitizeTable(panel.tableColumns, benchmarkPayload.table_rows ?? []);
          } catch { mlbBenchmark = null; }
        }
        return { title: panel.title, panelType: panel.panelType, allowedMetrics: allowedMetrics(panel), current, reference, comparisons, mlbBenchmark };
      }));
      const metricWhitelist = Array.from(new Set(evidence.flatMap((panel) => panel.allowedMetrics)));
      if (!metricWhitelist.length) throw new Error('Add a data panel to the report before generating a summary.');
      const response = await fetch('/api/ai/report-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportType, title, reportStart, reportEnd, comparisonStart, comparisonEnd, allowedMetrics: metricWhitelist, data: { panels: evidence } }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Could not generate summary.'); setSummary(cleanNarrative(payload.summary));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not generate summary.'); } finally { setLoading(false); }
  }

  return <section className={styles.summary} data-export-ignore={include && summary ? undefined : 'true'}>
    <div className={styles.heading}><div><span>Coach Analysis</span><h3>Report Summary</h3></div><button data-export-ignore="true" className="btn btn-primary" onClick={() => void generate()} disabled={loading || !reportPanels.length || !reportStart || !reportEnd}>{loading ? 'Generating…' : summary ? 'Regenerate' : 'Generate summary'}</button></div>
    <p data-export-ignore="true" className={styles.description}>Choose the comparison window, then generate a coach-style reading of the report.</p>
    <div data-export-ignore="true" className={styles.controls}><label>Report period<input value={`${reportStart} to ${reportEnd}`} readOnly /></label><label>Comparison start<input type="date" value={comparisonStart} onChange={(event) => setComparisonStart(event.target.value)} /></label><label>Comparison end<input type="date" value={comparisonEnd} onChange={(event) => setComparisonEnd(event.target.value)} /></label></div>
    {error ? <p data-export-ignore="true" className="auth-error">{error}</p> : null}
    {summary ? <><textarea data-export-ignore="true" className={styles.editor} rows={8} value={summary} onChange={(event) => setSummary(event.target.value)} /><div className={styles.exportText}>{summary}</div><label data-export-ignore="true" className="portal-checkbox-label"><input type="checkbox" checked={include} onChange={(event) => setInclude(event.target.checked)} /> Include this summary in report exports</label></> : null}
  </section>;
}

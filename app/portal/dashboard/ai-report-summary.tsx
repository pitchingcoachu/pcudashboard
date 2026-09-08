'use client';

import { useEffect, useState } from 'react';
import styles from './ai-report-summary.module.css';

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type AiReportSummaryProps = {
  reportType: string;
  title: string;
  reportStart: string;
  reportEnd: string;
  data: unknown;
  domain: 'pitching' | 'hitting' | 'catching';
  comparisonParams?: Record<string, string>;
};

export default function AiReportSummary({ reportType, title, reportStart, reportEnd, data, domain, comparisonParams }: AiReportSummaryProps) {
  const duration = Math.max(1, Math.round((Date.parse(reportEnd) - Date.parse(reportStart)) / 86_400_000) + 1);
  const [comparisonStart, setComparisonStart] = useState(() => shiftDate(reportStart, -duration));
  const [comparisonEnd, setComparisonEnd] = useState(() => shiftDate(reportStart, -1));
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [include, setInclude] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setComparisonStart(shiftDate(reportStart, -duration));
    setComparisonEnd(shiftDate(reportStart, -1));
    setSummary('');
  }, [duration, reportEnd, reportStart, reportType, title]);

  async function generate() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(comparisonParams ?? {})) {
        if (value) params.set(key, value);
      }
      params.set('start_date', comparisonStart);
      params.set('end_date', comparisonEnd);
      params.set('include_chart_points', '1');
      const comparisonResponse = await fetch(`/api/dashboard/${domain}/overview?${params.toString()}`, { cache: 'no-store' });
      const comparisonPayload = await comparisonResponse.json();
      if (!comparisonResponse.ok) throw new Error(comparisonPayload.error || 'Could not load comparison data.');
      const comparisonData = {
        tableColumns: comparisonPayload.table_columns,
        tableRows: comparisonPayload.table_rows,
        chartPoints: comparisonPayload.chart_points?.slice?.(0, 500),
      };
      const response = await fetch('/api/ai/report-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportType, title, reportStart, reportEnd, comparisonStart, comparisonEnd, data: { currentReport: data, comparisonReport: comparisonData } }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not generate summary.');
      setSummary(payload.summary ?? '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not generate summary.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.summary} data-export-ignore={include && summary ? undefined : 'true'}>
      <div className={styles.heading}>
        <div>
          <span>Coach Analysis</span>
          <h3>Report Summary</h3>
        </div>
        <button data-export-ignore="true" className="btn btn-primary" onClick={() => void generate()} disabled={loading || !data || !reportStart || !reportEnd}>
          {loading ? 'Generating…' : summary ? 'Regenerate' : 'Generate summary'}
        </button>
      </div>
      <p data-export-ignore="true" className={styles.description}>Choose the comparison window, then generate a coach-style reading of the report.</p>
      <div data-export-ignore="true" className={styles.controls}>
        <label>Report period<input value={`${reportStart} to ${reportEnd}`} readOnly /></label>
        <label>Comparison start<input type="date" value={comparisonStart} onChange={(event) => setComparisonStart(event.target.value)} /></label>
        <label>Comparison end<input type="date" value={comparisonEnd} onChange={(event) => setComparisonEnd(event.target.value)} /></label>
      </div>
      {error ? <p data-export-ignore="true" className="auth-error">{error}</p> : null}
      {summary ? (
        <>
          <textarea data-export-ignore="true" className={styles.editor} rows={8} value={summary} onChange={(event) => setSummary(event.target.value)} />
          <div className={styles.exportText}>{summary}</div>
          <label data-export-ignore="true" className="portal-checkbox-label"><input type="checkbox" checked={include} onChange={(event) => setInclude(event.target.checked)} /> Include this summary in report exports</label>
        </>
      ) : null}
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';

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
    <section className="portal-panel" data-export-ignore={include ? undefined : 'true'} style={{ padding: 16, display: 'grid', gap: 10, marginTop: 14 }}>
      <div className="portal-row-between">
        <div>
          <h3 style={{ margin: 0 }}>AI Report Summary</h3>
          <p className="portal-muted-text" style={{ margin: '4px 0 0' }}>Coach-style interpretation of this custom report.</p>
        </div>
        <button className="btn btn-primary" onClick={() => void generate()} disabled={loading || !data || !reportStart || !reportEnd}>
          {loading ? 'Generating…' : summary ? 'Regenerate' : 'Generate summary'}
        </button>
      </div>
      <div className="portal-form-grid">
        <label>Report period<input value={`${reportStart} to ${reportEnd}`} readOnly /></label>
        <label>Comparison start<input type="date" value={comparisonStart} onChange={(event) => setComparisonStart(event.target.value)} /></label>
        <label>Comparison end<input type="date" value={comparisonEnd} onChange={(event) => setComparisonEnd(event.target.value)} /></label>
      </div>
      {error ? <p className="auth-error">{error}</p> : null}
      {summary ? (
        <>
          <textarea rows={8} value={summary} onChange={(event) => setSummary(event.target.value)} />
          <label className="portal-checkbox-label"><input type="checkbox" checked={include} onChange={(event) => setInclude(event.target.checked)} /> Include this summary in report exports</label>
        </>
      ) : null}
    </section>
  );
}

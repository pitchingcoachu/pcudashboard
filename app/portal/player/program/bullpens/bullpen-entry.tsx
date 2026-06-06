'use client';

import { useEffect, useMemo, useState } from 'react';

type ScriptTemplate = {
  id: string;
  name: string;
  rowCount: number;
  columns: string[];
  rows: string[][];
};

type LogEntry = {
  templateId: string;
  bullpenDate: string;
  rowsJson: Array<Record<string, string>>;
};

function toIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function isVelocityCol(col: string) {
  return col.trim().toLowerCase() === 'velocity';
}
function isExecutionCol(col: string) {
  return col.trim().toLowerCase() === 'execution' || col.trim().toLowerCase() === 'executed';
}
function isStrikeCol(col: string) {
  return col.trim().toLowerCase() === 'strike' || col.trim().toLowerCase() === 'strikes';
}
function isEditableCol(col: string) {
  return isVelocityCol(col) || isExecutionCol(col) || isStrikeCol(col);
}

function buildEmptyRows(rowCount: number, columns: string[], templateRows: string[][]): Array<Record<string, string>> {
  return Array.from({ length: rowCount }, (_, i) => {
    const obj: Record<string, string> = {};
    columns.forEach((col, ci) => {
      if (isEditableCol(col)) {
        obj[col] = '';
      } else {
        obj[col] = templateRows[i]?.[ci] ?? '';
      }
    });
    return obj;
  });
}

// Simple line chart SVG
function TrendChart({ data, label, color, format }: {
  data: { date: string; value: number }[];
  label: string;
  color: string;
  format: (v: number) => string;
}) {
  if (data.length < 2) {
    return (
      <div style={{ padding: '12px 0', color: '#94a3b8', fontSize: 13 }}>
        Need at least 2 entries to show trend.
      </div>
    );
  }
  const W = 340, H = 120, pad = { top: 12, right: 16, bottom: 28, left: 40 };
  const vals = data.map((d) => d.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const scaleX = (i: number) => pad.left + (i / (data.length - 1)) * (W - pad.left - pad.right);
  const scaleY = (v: number) => pad.top + (1 - (v - minV) / range) * (H - pad.top - pad.bottom);
  const points = data.map((d, i) => `${scaleX(i)},${scaleY(d.value)}`).join(' ');
  return (
    <div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <svg width={W} height={H} style={{ overflow: 'visible' }}>
        {[minV, (minV + maxV) / 2, maxV].map((tick, i) => (
          <g key={i}>
            <line x1={pad.left} x2={W - pad.right} y1={scaleY(tick)} y2={scaleY(tick)} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
            <text x={pad.left - 4} y={scaleY(tick) + 4} textAnchor="end" fontSize={9} fill="#64748b">{format(tick)}</text>
          </g>
        ))}
        <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={scaleX(i)} cy={scaleY(d.value)} r={3.5} fill={color} />
            <text x={scaleX(i)} y={H - pad.bottom + 14} textAnchor="middle" fontSize={9} fill="#64748b">
              {d.date.slice(5)}
            </text>
            <title>{`${d.date}: ${format(d.value)}`}</title>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function BullpenEntry({
  templates,
  state,
  playerId,
  previewQuery,
}: {
  templates: ScriptTemplate[];
  state: { selectedTemplateId: string; visibleTemplateIds: string[] };
  playerId: number;
  previewQuery: string;
}) {
  const visibleTemplates = useMemo(() => {
    const visibleSet = new Set((state.visibleTemplateIds ?? []).map(String));
    const filtered = templates.filter((t) => visibleSet.has(t.id));
    return filtered.length ? filtered : templates;
  }, [templates, state.visibleTemplateIds]);

  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [bullpenDate, setBullpenDate] = useState(toIsoDate(new Date()));

  // Sync selectedTemplateId once templates are available
  useEffect(() => {
    if (selectedTemplateId && visibleTemplates.some((t) => t.id === selectedTemplateId)) return;
    const preferred = state.selectedTemplateId && visibleTemplates.some((t) => t.id === state.selectedTemplateId)
      ? state.selectedTemplateId
      : visibleTemplates[0]?.id ?? '';
    if (preferred) setSelectedTemplateId(preferred);
  }, [visibleTemplates, state.selectedTemplateId]);
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [loadingEntries, setLoadingEntries] = useState(false);

  const template = visibleTemplates.find((t) => t.id === selectedTemplateId) ?? null;

  // Init rows when template changes
  useEffect(() => {
    if (!template) { setRows([]); return; }
    setRows(buildEmptyRows(template.rowCount, template.columns, template.rows));
  }, [template?.id]);

  // Load existing entries when template changes
  useEffect(() => {
    if (!selectedTemplateId) return;
    setLoadingEntries(true);
    fetch(`/api/player/bullpen-log?playerId=${playerId}&templateId=${encodeURIComponent(selectedTemplateId)}${previewQuery ? `&${previewQuery.slice(1)}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((payload: { entries?: LogEntry[] }) => {
        setLogEntries(Array.isArray(payload.entries) ? payload.entries : []);
      })
      .catch(() => {})
      .finally(() => setLoadingEntries(false));
  }, [selectedTemplateId, playerId]);

  // Load existing entry for selected date+template
  useEffect(() => {
    if (!template || !bullpenDate) return;
    const existing = logEntries.find((e) => e.templateId === selectedTemplateId && e.bullpenDate === bullpenDate);
    if (existing) {
      // Merge saved editable values into fresh rows (keep template's readonly values)
      const merged = buildEmptyRows(template.rowCount, template.columns, template.rows).map((row, i) => {
        const saved = existing.rowsJson[i];
        if (!saved) return row;
        const out = { ...row };
        template.columns.forEach((col) => {
          if (isEditableCol(col) && saved[col] !== undefined) out[col] = saved[col];
        });
        return out;
      });
      setRows(merged);
    } else {
      setRows(buildEmptyRows(template.rowCount, template.columns, template.rows));
    }
  }, [bullpenDate, selectedTemplateId, logEntries]);

  const handleSave = async () => {
    if (!template || !bullpenDate) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/player/bullpen-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, templateId: selectedTemplateId, bullpenDate, rowsJson: rows }),
      });
      const payload = await res.json();
      if (!res.ok) { setSaveMsg(payload.error ?? 'Failed to save.'); return; }
      setSaveMsg('Saved!');
      // Refresh entries
      const refresh = await fetch(`/api/player/bullpen-log?playerId=${playerId}&templateId=${encodeURIComponent(selectedTemplateId)}`, { cache: 'no-store' });
      const refreshPayload: { entries?: LogEntry[] } = await refresh.json();
      setLogEntries(Array.isArray(refreshPayload.entries) ? refreshPayload.entries : []);
      setTimeout(() => setSaveMsg(''), 2500);
    } finally {
      setSaving(false);
    }
  };

  type TrendView = 'by-date' | 'by-pitch-type' | 'by-ball-type';
  const [veloView, setVeloView] = useState<'individual' | 'avg-date'>('avg-date');
  const [checkboxView, setCheckboxView] = useState<TrendView>('by-date');

  // All rows across all entries, each annotated with date
  const allRows = useMemo(() => {
    return logEntries.flatMap((entry) =>
      (entry.rowsJson ?? []).map((row): Record<string, string> => ({ ...row, __date: entry.bullpenDate }))
    );
  }, [logEntries]);

  // Group rows by a grouping key and compute avg/pct for a column
  function groupAndCompute(col: string, groupKey: string, isVelo: boolean): { label: string; value: number }[] {
    const groups = new Map<string, { sum: number; count: number; yes: number }>();
    allRows.forEach((row) => {
      const key = String(row[groupKey] ?? '').trim() || '—';
      const val = String(row[col] ?? '').trim();
      if (!val) return;
      const existing = groups.get(key) ?? { sum: 0, count: 0, yes: 0 };
      if (isVelo) {
        const n = Number(val);
        if (Number.isFinite(n) && n > 0) { existing.sum += n; existing.count += 1; }
      } else {
        existing.count += 1;
        if (val.toLowerCase() === 'yes') existing.yes += 1;
      }
      groups.set(key, existing);
    });
    return Array.from(groups.entries())
      .map(([label, { sum, count, yes }]) => ({
        label,
        value: isVelo ? (count ? sum / count : 0) : (count ? (yes / count) * 100 : 0),
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  // Velocity by date (avg per session)
  const veloByDate = useMemo(() => {
    if (!template) return [];
    const veloCol = template.columns.find(isVelocityCol);
    if (!veloCol) return [];
    const byDate = new Map<string, { sum: number; count: number }>();
    allRows.forEach((row) => {
      const date = row.__date ?? '';
      const val = Number(row[veloCol] ?? '');
      if (!Number.isFinite(val) || val <= 0) return;
      const existing = byDate.get(date) ?? { sum: 0, count: 0 };
      existing.sum += val; existing.count += 1;
      byDate.set(date, existing);
    });
    return Array.from(byDate.entries())
      .map(([date, { sum, count }]) => ({ date, value: count ? sum / count : 0 }))
      .filter((d) => d.value > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [allRows, template]);

  // Individual velocity points (all pitches) with ball type label
  const veloIndividual = useMemo(() => {
    if (!template) return [];
    const veloCol = template.columns.find(isVelocityCol);
    const ballTypeCol = template.columns.find((c) => c.trim().toLowerCase() === 'ball type');
    if (!veloCol) return [];
    return allRows.map((row, i) => {
      const val = Number(row[veloCol] ?? '');
      if (!Number.isFinite(val) || val <= 0) return null;
      const ballType = ballTypeCol ? String(row[ballTypeCol] ?? '').trim() : '';
      return { index: i, date: row['__date'] ?? '', value: val, label: (ballType || row['__date']) ?? '' };
    }).filter((d): d is NonNullable<typeof d> => d !== null);
  }, [allRows, template]);

  // Checkbox pct grouped by chosen view
  const checkboxTrendData = useMemo(() => {
    if (!template) return {};
    const result: Record<string, { label: string; value: number }[]> = {};
    template.columns.forEach((col) => {
      if (!isExecutionCol(col) && !isStrikeCol(col)) return;
      const groupKey = checkboxView === 'by-date' ? '__date'
        : checkboxView === 'by-pitch-type' ? template.columns.find((c) => c.trim().toLowerCase() === 'pitch type') ?? '__date'
        : template.columns.find((c) => c.trim().toLowerCase() === 'ball type') ?? '__date';
      result[col] = groupAndCompute(col, groupKey, false);
    });
    return result;
  }, [allRows, template, checkboxView]);

  if (!visibleTemplates.length) {
    return <p className="portal-muted-text" style={{ margin: 0 }}>No bullpen scripts assigned yet.</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {visibleTemplates.length > 0 && (
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Script Template</span>
            <select
              className="portal-schedule-control"
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              style={{ minWidth: 200 }}
            >
              {visibleTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
        )}
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>Bullpen Date</span>
          <input
            type="date"
            className="portal-schedule-control"
            value={bullpenDate}
            onChange={(e) => setBullpenDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleSave()}
          disabled={saving || !template}
          style={{ alignSelf: 'flex-end' }}
        >
          {saving ? 'Saving...' : 'Save Bullpen'}
        </button>
        {saveMsg ? <span style={{ alignSelf: 'flex-end', fontSize: 13, color: saveMsg === 'Saved!' ? '#22c55e' : '#ef4444' }}>{saveMsg}</span> : null}
      </div>

      {/* Script grid */}
      {template ? (
        <div className="portal-panel" style={{ minHeight: 'unset', padding: '0.75rem', borderRadius: 10, border: '1px solid var(--calendar-grid-border, var(--border))', background: 'rgba(0,0,0,0.16)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 56px', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
            <img src="/pitching-coach-u-logo.png" alt="PCU" style={{ width: 48, height: 48, objectFit: 'contain', justifySelf: 'start' }} />
            <h3 style={{ margin: 0, textAlign: 'center', fontSize: '1.05rem', fontWeight: 800 }}>{template.name}</h3>
            <img src="/pitching-coach-u-logo.png" alt="PCU" style={{ width: 48, height: 48, objectFit: 'contain', justifySelf: 'end' }} />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'center', fontSize: '0.9rem', fontWeight: 800, padding: '0.4rem 0.35rem', borderBottom: '1px solid var(--calendar-grid-border, var(--border))', borderRight: '1px solid var(--calendar-grid-border, var(--border))' }}>
                    Pitch #
                  </th>
                  {template.columns.map((col) => (
                    <th key={col} style={{ textAlign: 'center', fontSize: '0.9rem', fontWeight: 800, padding: '0.4rem 0.35rem', borderBottom: '1px solid var(--calendar-grid-border, var(--border))', borderRight: '1px solid var(--calendar-grid-border, var(--border))', whiteSpace: 'nowrap', color: isEditableCol(col) ? '#c8102e' : 'inherit' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    <td style={{ textAlign: 'center', fontWeight: 700, padding: '0.32rem', borderBottom: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid var(--calendar-grid-border, var(--border))' }}>
                      {ri + 1}
                    </td>
                    {template.columns.map((col, ci) => {
                      const val = row[col] ?? '';
                      if (isVelocityCol(col)) {
                        return (
                          <td key={ci} style={{ padding: '0.2rem', borderBottom: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid var(--calendar-grid-border, var(--border))' }}>
                            <input
                              type="number"
                              className="portal-schedule-control"
                              value={val}
                              onChange={(e) => setRows((prev) => prev.map((r, i) => i === ri ? { ...r, [col]: e.target.value } : r))}
                              placeholder="mph"
                              style={{ width: '100%', minWidth: 70, textAlign: 'center', fontWeight: 600 }}
                            />
                          </td>
                        );
                      }
                      if (isExecutionCol(col) || isStrikeCol(col)) {
                        return (
                          <td key={ci} style={{ padding: '0.2rem', borderBottom: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid var(--calendar-grid-border, var(--border))' }}>
                            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: '4px 0' }}>
                              {(['Yes', 'No'] as const).map((opt) => (
                                <label key={opt} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', fontSize: 11, color: '#94a3b8' }}>
                                  {opt}
                                  <input
                                    type="radio"
                                    name={`row-${ri}-col-${ci}`}
                                    value={opt}
                                    checked={val === opt}
                                    onChange={() => setRows((prev) => prev.map((r, i) => i === ri ? { ...r, [col]: opt } : r))}
                                    style={{ accentColor: opt === 'Yes' ? '#22c55e' : '#ef4444' }}
                                  />
                                </label>
                              ))}
                            </div>
                          </td>
                        );
                      }
                      // Readonly cell
                      return (
                        <td key={ci} style={{ padding: '0.2rem', borderBottom: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid var(--calendar-grid-border, var(--border))' }}>
                          <div style={{ padding: '0.35rem 0.45rem', textAlign: 'center', fontSize: '0.95rem', fontWeight: 600, color: '#e2e8f0', opacity: 0.85 }}>
                            {val || '—'}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Trend charts */}
      {template && logEntries.length > 0 && !loadingEntries ? (
        <div className="portal-panel" style={{ minHeight: 'unset', padding: '1rem', display: 'grid', gap: 28 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Trends</h4>

          {/* Velocity charts */}
          {template.columns.some(isVelocityCol) ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>Velocity</span>
                <button type="button" className={veloView === 'avg-date' ? 'btn btn-primary' : 'btn btn-ghost'} style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => setVeloView('avg-date')}>Avg by Date</button>
                <button type="button" className={veloView === 'individual' ? 'btn btn-primary' : 'btn btn-ghost'} style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => setVeloView('individual')}>Individual Pitches</button>
              </div>
              {veloView === 'avg-date' ? (
                <TrendChart data={veloByDate} label="Avg Velocity by Date (mph)" color="#60a5fa" format={(v) => `${v.toFixed(1)} mph`} />
              ) : (
                <div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Individual Pitches by Ball Type &amp; Date</div>
                  {veloIndividual.length === 0 ? (
                    <p className="portal-muted-text" style={{ margin: 0 }}>No velocity data yet.</p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 340 }}>
                        <thead>
                          <tr>
                            <th style={{ padding: '4px 10px', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8' }}>#</th>
                            <th style={{ padding: '4px 10px', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8' }}>Date</th>
                            <th style={{ padding: '4px 10px', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8' }}>Ball Type</th>
                            <th style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8' }}>Velocity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {veloIndividual.map((p, i) => (
                            <tr key={i}>
                              <td style={{ padding: '3px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#64748b' }}>{i + 1}</td>
                              <td style={{ padding: '3px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{p.date}</td>
                              <td style={{ padding: '3px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#94a3b8' }}>{p.label !== p.date ? p.label : '—'}</td>
                              <td style={{ padding: '3px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'right', fontWeight: 700, color: '#60a5fa' }}>{p.value.toFixed(1)} mph</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {/* Execution / Strike % charts */}
          {template.columns.some((c) => isExecutionCol(c) || isStrikeCol(c)) ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>Execution / Strike %</span>
                <button type="button" className={checkboxView === 'by-date' ? 'btn btn-primary' : 'btn btn-ghost'} style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => setCheckboxView('by-date')}>By Date</button>
                <button type="button" className={checkboxView === 'by-pitch-type' ? 'btn btn-primary' : 'btn btn-ghost'} style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => setCheckboxView('by-pitch-type')}>By Pitch Type</button>
                <button type="button" className={checkboxView === 'by-ball-type' ? 'btn btn-primary' : 'btn btn-ghost'} style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => setCheckboxView('by-ball-type')}>By Ball Type</button>
              </div>
              {template.columns.filter((c) => isExecutionCol(c) || isStrikeCol(c)).map((col) => {
                const series = checkboxTrendData[col] ?? [];
                const isExec = isExecutionCol(col);
                const color = isExec ? '#22c55e' : '#f59e0b';
                const label = `${isExec ? 'Execution' : 'Strike'} % — ${checkboxView === 'by-date' ? 'by Date' : checkboxView === 'by-pitch-type' ? 'by Pitch Type' : 'by Ball Type'}`;
                if (checkboxView === 'by-date') {
                  // Use line chart for date view
                  const dateSeries = [...logEntries].sort((a, b) => a.bullpenDate.localeCompare(b.bullpenDate)).map((entry) => {
                    const colRows = (entry.rowsJson ?? []).map((r) => String(r[col] ?? '').trim()).filter(Boolean);
                    const yes = colRows.filter((v) => v.toLowerCase() === 'yes').length;
                    return colRows.length ? { date: entry.bullpenDate, value: (yes / colRows.length) * 100 } : null;
                  }).filter((d): d is { date: string; value: number } => d !== null);
                  return <TrendChart key={col} data={dateSeries} label={label} color={color} format={(v) => `${v.toFixed(0)}%`} />;
                }
                // Bar-style table for pitch type / ball type groupings
                return (
                  <div key={col}>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{label}</div>
                    {series.length === 0 ? (
                      <p className="portal-muted-text" style={{ margin: 0, fontSize: 12 }}>No data yet.</p>
                    ) : (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {series.map((item) => (
                          <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 48px', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                            <div style={{ height: 14, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(100, item.value)}%`, background: color, borderRadius: 4, transition: 'width 0.3s' }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color, textAlign: 'right' }}>{item.value.toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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

type BullpenTrendMetric = 'velocity' | 'execution' | 'strike';

type BullpenTrendBucket = {
  key: string;
  date: string;
  pitchType: string;
  ballType: string;
  value: number;
  count: number;
};

type BullpenVelocityPoint = {
  key: string;
  date: string;
  pitchType: string;
  ballType: string;
  value: number;
  pitchNumber: number;
};

type BullpenSummaryRow = {
  key: string;
  pitchType: string;
  ballType: string;
  count: number;
  avgVelocity: number | null;
  maxVelocity: number | null;
  executionPct: number | null;
  strikePct: number | null;
};

function formatTrendDate(value: string) {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  const [, month = '', day = ''] = raw.match(/^\d{4}-(\d{2})-(\d{2})$/) ?? [];
  return month && day ? `${Number(month)}/${Number(day)}` : raw;
}

function trendMetricLabel(metric: BullpenTrendMetric) {
  if (metric === 'velocity') return 'Avg Velocity';
  if (metric === 'execution') return 'Execution';
  return 'Strike';
}

function trendMetricFormat(metric: BullpenTrendMetric, value: number) {
  if (metric === 'velocity') return `${value.toFixed(1)} mph`;
  return `${value.toFixed(0)}%`;
}

function TrendBarChart({ data, metric }: {
  data: BullpenTrendBucket[];
  metric: BullpenTrendMetric;
}) {
  if (data.length < 1) {
    return (
      <div style={{ padding: '12px 0', color: '#94a3b8', fontSize: 13 }}>
        No trend data yet.
      </div>
    );
  }
  const dates = Array.from(new Set(data.map((d) => d.date))).sort((a, b) => a.localeCompare(b));
  const combos = Array.from(new Set(data.map((d) => `${d.pitchType}|${d.ballType}`))).sort((a, b) => a.localeCompare(b));
  const comboLabel = (combo: string) => {
    const [pitchType = 'Pitch', ballType = 'Ball'] = combo.split('|');
    return `${pitchType} / ${ballType}`;
  };
  const groupW = Math.max(96, combos.length * 18 + 34);
  const W = Math.max(720, dates.length * groupW + 92);
  const H = 310;
  const pad = { top: 28, right: 22, bottom: 68, left: 58 };
  const vals = data.map((d) => d.value);
  const minV = metric === 'velocity' ? Math.max(0, Math.floor(Math.min(...vals) - 2)) : 0;
  const maxRaw = Math.max(...vals);
  const maxV = metric === 'velocity' ? Math.ceil(maxRaw + 2) : 100;
  const range = Math.max(1, maxV - minV);
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const dateBand = chartW / dates.length;
  const barW = Math.max(10, Math.min(20, (dateBand - 28) / Math.max(1, combos.length)));
  const barGap = 0;
  const scaleY = (v: number) => pad.top + (1 - (v - minV) / range) * chartH;
  const baselineY = scaleY(minV);
  const palette = ['#60a5fa', '#f59e0b', '#22c55e', '#e11d48', '#a78bfa', '#14b8a6', '#f97316', '#38bdf8'];
  const colorByCombo = new Map(combos.map((combo, index) => [combo, palette[index % palette.length]] as const));
  const dataByDateCombo = new Map(data.map((d) => [`${d.date}|${d.pitchType}|${d.ballType}`, d] as const));
  const ticks = metric === 'velocity'
    ? [minV, minV + range / 2, maxV]
    : [0, 50, 100];
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {combos.map((combo) => (
          <span key={combo} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: '#cbd5e1', fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: colorByCombo.get(combo) ?? '#94a3b8' }} />
            {comboLabel(combo)}
          </span>
        ))}
      </div>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <svg width={W} height={H} role="img" aria-label={`${trendMetricLabel(metric)} by date, pitch type, and ball type`} style={{ display: 'block' }}>
          <rect x={0} y={0} width={W} height={H} rx={8} fill="rgba(2,6,23,0.18)" />
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={W - pad.right} y1={scaleY(tick)} y2={scaleY(tick)} stroke="rgba(148,163,184,0.14)" strokeWidth={1} />
              <text x={pad.left - 8} y={scaleY(tick) + 4} textAnchor="end" fontSize={11} fontWeight={700} fill="#94a3b8">
                {trendMetricFormat(metric, tick)}
              </text>
            </g>
          ))}
          <line x1={pad.left} x2={W - pad.right} y1={baselineY} y2={baselineY} stroke="rgba(226,232,240,0.28)" strokeWidth={1} />
          {dates.map((date, dateIndex) => {
            const groupLeft = pad.left + dateIndex * dateBand;
            const groupCenter = groupLeft + dateBand / 2;
            const dateBars = combos
              .map((combo) => {
                const [pitchType = 'Pitch', ballType = 'Ball'] = combo.split('|');
                const bucket = dataByDateCombo.get(`${date}|${pitchType}|${ballType}`);
                return bucket ? { combo, bucket } : null;
              })
              .filter((row): row is { combo: string; bucket: BullpenTrendBucket } => row !== null);
            const dateBarsWidth = dateBars.length * barW + Math.max(0, dateBars.length - 1) * barGap;
            const barsLeft = groupCenter - dateBarsWidth / 2;
            return (
              <g key={`trend-date-${date}`}>
                {dateIndex > 0 ? (
                  <line x1={groupLeft} x2={groupLeft} y1={pad.top} y2={baselineY + 10} stroke="rgba(148,163,184,0.12)" strokeWidth={1} />
                ) : null}
                {dateBars.map(({ combo, bucket: d }, comboIndex) => {
                  const cx = barsLeft + comboIndex * (barW + barGap) + barW / 2;
                  const y = scaleY(d.value);
                  const h = Math.max(2, baselineY - y);
                  const fill = colorByCombo.get(combo) ?? '#94a3b8';
                  return (
                    <g key={d.key}>
                      <rect
                        x={cx - barW / 2}
                        y={y}
                        width={barW}
                        height={h}
                        rx={4}
                        fill={fill}
                        stroke="rgba(255,255,255,0.22)"
                        strokeWidth={1}
                      />
                      <title>{`${d.date}\nPitch Type: ${d.pitchType}\nBall Type: ${d.ballType}\n${trendMetricLabel(metric)}: ${trendMetricFormat(metric, d.value)}\nPitches: ${d.count}`}</title>
                    </g>
                  );
                })}
                <text x={groupCenter} y={H - 38} textAnchor="middle" fontSize={11} fontWeight={800} fill="#e2e8f0">
                  {formatTrendDate(date)}
                </text>
              </g>
            );
          })}
          <text x={pad.left} y={18} fontSize={12} fontWeight={800} fill="#cbd5e1">
            {trendMetricLabel(metric)} by Date / Pitch Type / Ball Type
          </text>
        </svg>
      </div>
    </div>
  );
}

function VelocityScatterChart({ data }: { data: BullpenVelocityPoint[] }) {
  if (data.length < 1) {
    return (
      <div style={{ padding: '12px 0', color: '#94a3b8', fontSize: 13 }}>
        No individual velocity data yet.
      </div>
    );
  }
  const dates = Array.from(new Set(data.map((d) => d.date))).sort((a, b) => a.localeCompare(b));
  const combos = Array.from(new Set(data.map((d) => `${d.pitchType}|${d.ballType}`))).sort((a, b) => a.localeCompare(b));
  const comboLabel = (combo: string) => {
    const [pitchType = 'Pitch', ballType = 'Ball'] = combo.split('|');
    return `${pitchType} / ${ballType}`;
  };
  const maxPointsPerDate = Math.max(1, ...dates.map((date) => data.filter((point) => point.date === date).length));
  const groupW = Math.max(112, maxPointsPerDate * 14 + 42);
  const W = Math.max(720, dates.length * groupW + 92);
  const H = 310;
  const pad = { top: 28, right: 22, bottom: 68, left: 58 };
  const vals = data.map((d) => d.value);
  const minV = Math.max(0, Math.floor(Math.min(...vals) - 2));
  const maxV = Math.ceil(Math.max(...vals) + 2);
  const range = Math.max(1, maxV - minV);
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const dateBand = chartW / dates.length;
  const scaleY = (v: number) => pad.top + (1 - (v - minV) / range) * chartH;
  const baselineY = scaleY(minV);
  const palette = ['#60a5fa', '#f59e0b', '#22c55e', '#e11d48', '#a78bfa', '#14b8a6', '#f97316', '#38bdf8'];
  const colorByCombo = new Map(combos.map((combo, index) => [combo, palette[index % palette.length]] as const));
  const pointsByDate = new Map<string, BullpenVelocityPoint[]>();
  for (const point of data) {
    const arr = pointsByDate.get(point.date) ?? [];
    arr.push(point);
    pointsByDate.set(point.date, arr);
  }
  for (const arr of pointsByDate.values()) {
    arr.sort((a, b) => a.pitchNumber - b.pitchNumber || a.pitchType.localeCompare(b.pitchType) || a.ballType.localeCompare(b.ballType));
  }
  const ticks = [minV, minV + range / 2, maxV];
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {combos.map((combo) => (
          <span key={combo} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: '#cbd5e1', fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: colorByCombo.get(combo) ?? '#94a3b8' }} />
            {comboLabel(combo)}
          </span>
        ))}
      </div>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <svg width={W} height={H} role="img" aria-label="Individual pitch velocity scatter plot" style={{ display: 'block' }}>
          <rect x={0} y={0} width={W} height={H} rx={8} fill="rgba(2,6,23,0.18)" />
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={W - pad.right} y1={scaleY(tick)} y2={scaleY(tick)} stroke="rgba(148,163,184,0.14)" strokeWidth={1} />
              <text x={pad.left - 8} y={scaleY(tick) + 4} textAnchor="end" fontSize={11} fontWeight={700} fill="#94a3b8">
                {trendMetricFormat('velocity', tick)}
              </text>
            </g>
          ))}
          <line x1={pad.left} x2={W - pad.right} y1={baselineY} y2={baselineY} stroke="rgba(226,232,240,0.28)" strokeWidth={1} />
          {dates.map((date, dateIndex) => {
            const groupLeft = pad.left + dateIndex * dateBand;
            const groupCenter = groupLeft + dateBand / 2;
            const points = pointsByDate.get(date) ?? [];
            const pointGap = 12;
            const pointsWidth = Math.max(0, (points.length - 1) * pointGap);
            const pointsLeft = groupCenter - pointsWidth / 2;
            return (
              <g key={`velocity-date-${date}`}>
                {dateIndex > 0 ? (
                  <line x1={groupLeft} x2={groupLeft} y1={pad.top} y2={baselineY + 10} stroke="rgba(148,163,184,0.12)" strokeWidth={1} />
                ) : null}
                {points.map((point, pointIndex) => {
                  const combo = `${point.pitchType}|${point.ballType}`;
                  const cx = pointsLeft + pointIndex * pointGap;
                  const cy = scaleY(point.value);
                  const fill = colorByCombo.get(combo) ?? '#94a3b8';
                  return (
                    <g key={point.key}>
                      <circle cx={cx} cy={cy} r={5.5} fill={fill} stroke="rgba(255,255,255,0.8)" strokeWidth={1.2} />
                      <title>{`${point.date}\nPitch #: ${point.pitchNumber}\nPitch Type: ${point.pitchType}\nBall Type: ${point.ballType}\nVelocity: ${trendMetricFormat('velocity', point.value)}`}</title>
                    </g>
                  );
                })}
                <text x={groupCenter} y={H - 38} textAnchor="middle" fontSize={11} fontWeight={800} fill="#e2e8f0">
                  {formatTrendDate(date)}
                </text>
              </g>
            );
          })}
          <text x={pad.left} y={18} fontSize={12} fontWeight={800} fill="#cbd5e1">
            Individual Pitch Velocity by Date / Pitch Type / Ball Type
          </text>
        </svg>
      </div>
    </div>
  );
}

function getColumn(columns: string[], wanted: string) {
  const target = wanted.trim().toLowerCase();
  return columns.find((column) => column.trim().toLowerCase() === target) ?? null;
}

function getColumnValue(row: Record<string, string>, column: string | null, fallback: string) {
  if (!column) return fallback;
  return String(row[column] ?? '').trim() || fallback;
}

function isYes(value: string) {
  return value.trim().toLowerCase() === 'yes';
}

function isYesNo(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === 'yes' || normalized === 'no';
}

function formatSummaryNumber(value: number | null, suffix = '') {
  return value === null ? '—' : `${value.toFixed(1)}${suffix}`;
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

  const templateById = useMemo(() => new Map(visibleTemplates.map((row) => [row.id, row] as const)), [visibleTemplates]);

  // Load existing entries for all visible templates. The selected template still
  // controls the editable grid, but trends use the full bullpen history.
  useEffect(() => {
    if (!visibleTemplates.length) return;
    setLoadingEntries(true);
    fetch(`/api/player/bullpen-log?playerId=${playerId}${previewQuery ? `&${previewQuery.slice(1)}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((payload: { entries?: LogEntry[] }) => {
        const visibleIds = new Set(visibleTemplates.map((row) => row.id));
        const entries = Array.isArray(payload.entries) ? payload.entries : [];
        setLogEntries(entries.filter((entry) => visibleIds.has(entry.templateId)));
      })
      .catch(() => {})
      .finally(() => setLoadingEntries(false));
  }, [visibleTemplates, playerId, previewQuery]);

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
      const refresh = await fetch(`/api/player/bullpen-log?playerId=${playerId}${previewQuery ? `&${previewQuery.slice(1)}` : ''}`, { cache: 'no-store' });
      const refreshPayload: { entries?: LogEntry[] } = await refresh.json();
      const visibleIds = new Set(visibleTemplates.map((row) => row.id));
      const entries = Array.isArray(refreshPayload.entries) ? refreshPayload.entries : [];
      setLogEntries(entries.filter((entry) => visibleIds.has(entry.templateId)));
      setTimeout(() => setSaveMsg(''), 2500);
    } finally {
      setSaving(false);
    }
  };

  const [trendMetric, setTrendMetric] = useState<BullpenTrendMetric>('velocity');
  const [velocityTrendMode, setVelocityTrendMode] = useState<'average' | 'individual'>('average');
  const [trendStartDate, setTrendStartDate] = useState('');
  const [trendEndDate, setTrendEndDate] = useState('');

  // All rows across all entries, each annotated with date
  const allRows = useMemo(() => {
    return logEntries
      .filter((entry) => {
        const date = String(entry.bullpenDate ?? '').trim();
        if (!date) return false;
        if (trendStartDate && date < trendStartDate) return false;
        if (trendEndDate && date > trendEndDate) return false;
        return true;
      })
      .flatMap((entry) => {
        const sourceTemplate = templateById.get(entry.templateId);
        const columns = sourceTemplate?.columns ?? [];
        const velocityCol = columns.find(isVelocityCol) ?? '';
        const executionCol = columns.find(isExecutionCol) ?? '';
        const strikeCol = columns.find(isStrikeCol) ?? '';
        const pitchTypeCol = getColumn(columns, 'pitch type') ?? '';
        const ballTypeCol = getColumn(columns, 'ball type') ?? '';
        return (entry.rowsJson ?? []).map((row, index): Record<string, string> => ({
          ...row,
          __date: entry.bullpenDate,
          __pitchNumber: String(index + 1),
          __templateId: entry.templateId,
          __velocityCol: velocityCol,
          __executionCol: executionCol,
          __strikeCol: strikeCol,
          __pitchTypeCol: pitchTypeCol,
          __ballTypeCol: ballTypeCol,
        }));
      });
  }, [logEntries, templateById, trendStartDate, trendEndDate]);

  const trendMetricOptions = useMemo(() => {
    const options: Array<{ value: BullpenTrendMetric; label: string }> = [];
    if (visibleTemplates.some((row) => row.columns.some(isVelocityCol))) options.push({ value: 'velocity', label: 'Velocity' });
    if (visibleTemplates.some((row) => row.columns.some(isExecutionCol))) options.push({ value: 'execution', label: 'Execution %' });
    if (visibleTemplates.some((row) => row.columns.some(isStrikeCol))) options.push({ value: 'strike', label: 'Strike %' });
    return options;
  }, [visibleTemplates]);

  useEffect(() => {
    if (!trendMetricOptions.length) return;
    if (trendMetricOptions.some((option) => option.value === trendMetric)) return;
    setTrendMetric(trendMetricOptions[0]?.value ?? 'velocity');
  }, [trendMetric, trendMetricOptions]);

  const combinedTrendData = useMemo(() => {
    const groups = new Map<string, { date: string; pitchType: string; ballType: string; sum: number; count: number; yes: number }>();
    for (const row of allRows) {
      const valueCol = trendMetric === 'velocity' ? row.__velocityCol : trendMetric === 'execution' ? row.__executionCol : row.__strikeCol;
      if (!valueCol) continue;
      const date = String(row.__date ?? '').trim();
      if (!date) continue;
      const pitchType = getColumnValue(row, row.__pitchTypeCol || null, 'Pitch');
      const ballType = getColumnValue(row, row.__ballTypeCol || null, 'Ball');
      const rawValue = String(row[valueCol] ?? '').trim();
      if (!rawValue) continue;
      const key = `${date}|${pitchType}|${ballType}`;
      const group = groups.get(key) ?? { date, pitchType, ballType, sum: 0, count: 0, yes: 0 };
      if (trendMetric === 'velocity') {
        const value = Number(rawValue);
        if (!Number.isFinite(value) || value <= 0) continue;
        group.sum += value;
        group.count += 1;
      } else {
        group.count += 1;
        if (isYes(rawValue)) group.yes += 1;
      }
      groups.set(key, group);
    }
    return Array.from(groups.entries())
      .map(([key, group]) => ({
        key,
        date: group.date,
        pitchType: group.pitchType,
        ballType: group.ballType,
        count: group.count,
        value: trendMetric === 'velocity'
          ? (group.count ? group.sum / group.count : 0)
          : (group.count ? (group.yes / group.count) * 100 : 0),
      }))
      .filter((bucket) => bucket.count > 0 && bucket.value > 0)
      .sort((a, b) =>
        a.date.localeCompare(b.date) ||
        a.pitchType.localeCompare(b.pitchType) ||
        a.ballType.localeCompare(b.ballType)
      );
  }, [allRows, trendMetric]);

  const individualVelocityPoints = useMemo(() => {
    return allRows
      .map((row, index) => {
        const velocityCol = row.__velocityCol || '';
        if (!velocityCol) return null;
        const value = Number(String(row[velocityCol] ?? '').trim());
        if (!Number.isFinite(value) || value <= 0) return null;
        const date = String(row.__date ?? '').trim();
        if (!date) return null;
        return {
          key: `${date}|${index}|${value}`,
          date,
          pitchType: getColumnValue(row, row.__pitchTypeCol || null, 'Pitch'),
          ballType: getColumnValue(row, row.__ballTypeCol || null, 'Ball'),
          value,
          pitchNumber: Number(row.__pitchNumber) || index + 1,
        };
      })
      .filter((point): point is BullpenVelocityPoint => point !== null)
      .sort((a, b) => a.date.localeCompare(b.date) || a.pitchNumber - b.pitchNumber);
  }, [allRows]);

  const bullpenSummary = useMemo(() => {
    type SummaryAccumulator = {
      pitchType: string;
      ballType: string;
      count: number;
      velocitySum: number;
      velocityCount: number;
      maxVelocity: number | null;
      executionYes: number;
      executionCount: number;
      strikeYes: number;
      strikeCount: number;
    };
    const groups = new Map<string, SummaryAccumulator>();
    const total: SummaryAccumulator = {
      pitchType: 'All',
      ballType: 'All',
      count: 0,
      velocitySum: 0,
      velocityCount: 0,
      maxVelocity: null,
      executionYes: 0,
      executionCount: 0,
      strikeYes: 0,
      strikeCount: 0,
    };
    const addPitch = (group: SummaryAccumulator, velocity: number | null, execution: string, strike: string) => {
      group.count += 1;
      if (velocity !== null) {
        group.velocitySum += velocity;
        group.velocityCount += 1;
        group.maxVelocity = group.maxVelocity === null ? velocity : Math.max(group.maxVelocity, velocity);
      }
      if (isYesNo(execution)) {
        group.executionCount += 1;
        if (isYes(execution)) group.executionYes += 1;
      }
      if (isYesNo(strike)) {
        group.strikeCount += 1;
        if (isYes(strike)) group.strikeYes += 1;
      }
    };

    for (const row of allRows) {
      const velocityRaw = row.__velocityCol ? String(row[row.__velocityCol] ?? '').trim() : '';
      const velocityValue = Number(velocityRaw);
      const velocity = velocityRaw && Number.isFinite(velocityValue) && velocityValue > 0 ? velocityValue : null;
      const execution = row.__executionCol ? String(row[row.__executionCol] ?? '').trim() : '';
      const strike = row.__strikeCol ? String(row[row.__strikeCol] ?? '').trim() : '';
      if (velocity === null && !isYesNo(execution) && !isYesNo(strike)) continue;

      const pitchType = getColumnValue(row, row.__pitchTypeCol || null, 'Unspecified');
      const ballType = getColumnValue(row, row.__ballTypeCol || null, 'Unspecified');
      const key = `${pitchType}|${ballType}`;
      const group = groups.get(key) ?? {
        pitchType,
        ballType,
        count: 0,
        velocitySum: 0,
        velocityCount: 0,
        maxVelocity: null,
        executionYes: 0,
        executionCount: 0,
        strikeYes: 0,
        strikeCount: 0,
      };
      addPitch(group, velocity, execution, strike);
      addPitch(total, velocity, execution, strike);
      groups.set(key, group);
    }

    const toSummaryRow = (key: string, group: SummaryAccumulator): BullpenSummaryRow => ({
      key,
      pitchType: group.pitchType,
      ballType: group.ballType,
      count: group.count,
      avgVelocity: group.velocityCount > 0 ? group.velocitySum / group.velocityCount : null,
      maxVelocity: group.maxVelocity,
      executionPct: group.executionCount > 0 ? (group.executionYes / group.executionCount) * 100 : null,
      strikePct: group.strikeCount > 0 ? (group.strikeYes / group.strikeCount) * 100 : null,
    });
    const summaryRows = Array.from(groups.entries())
      .map(([key, group]) => toSummaryRow(key, group))
      .sort((a, b) => b.count - a.count || a.pitchType.localeCompare(b.pitchType) || a.ballType.localeCompare(b.ballType));
    return {
      total: total.count > 0 ? toSummaryRow('all', total) : null,
      rows: summaryRows,
    };
  }, [allRows]);

  const summaryHasVelocity = trendMetricOptions.some((option) => option.value === 'velocity');
  const summaryHasExecution = trendMetricOptions.some((option) => option.value === 'execution');
  const summaryHasStrike = trendMetricOptions.some((option) => option.value === 'strike');

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
                    <th key={col} style={{ textAlign: 'center', fontSize: '0.9rem', fontWeight: 800, padding: isVelocityCol(col) ? '0.35rem 0.2rem' : '0.4rem 0.35rem', borderBottom: '1px solid var(--calendar-grid-border, var(--border))', borderRight: '1px solid var(--calendar-grid-border, var(--border))', whiteSpace: 'nowrap', color: isEditableCol(col) ? '#c8102e' : 'inherit', width: isVelocityCol(col) ? 72 : undefined, minWidth: isVelocityCol(col) ? 72 : undefined, maxWidth: isVelocityCol(col) ? 72 : undefined }}>
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
                          <td key={ci} style={{ padding: '0.16rem', borderBottom: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid var(--calendar-grid-border, var(--border))', width: 72, minWidth: 72, maxWidth: 72 }}>
                            <input
                              type="number"
                              className="portal-schedule-control"
                              value={val}
                              onChange={(e) => setRows((prev) => prev.map((r, i) => i === ri ? { ...r, [col]: e.target.value } : r))}
                              placeholder="mph"
                              style={{ width: '100%', minWidth: 0, textAlign: 'center', fontWeight: 600, padding: '0.35rem 0.25rem' }}
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

      {/* Trend chart */}
      {template && logEntries.length > 0 && !loadingEntries && trendMetricOptions.length > 0 ? (
        <div className="portal-panel" style={{ minHeight: 'unset', padding: '1rem', display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#e2e8f0' }}>Trends</h4>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: 3 }}>
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>Start</span>
                <input
                  type="date"
                  className="portal-schedule-control"
                  value={trendStartDate}
                  onChange={(e) => setTrendStartDate(e.target.value)}
                  style={{ minHeight: 30, height: 30, fontSize: 12, padding: '0.25rem 0.45rem' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 3 }}>
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>End</span>
                <input
                  type="date"
                  className="portal-schedule-control"
                  value={trendEndDate}
                  onChange={(e) => setTrendEndDate(e.target.value)}
                  style={{ minHeight: 30, height: 30, fontSize: 12, padding: '0.25rem 0.45rem' }}
                />
              </label>
              {(trendStartDate || trendEndDate) ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '3px 10px', fontSize: 12, minHeight: 30 }}
                  onClick={() => {
                    setTrendStartDate('');
                    setTrendEndDate('');
                  }}
                >
                  All Dates
                </button>
              ) : null}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {trendMetricOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={trendMetric === option.value ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ padding: '3px 10px', fontSize: 12, minHeight: 30 }}
                    onClick={() => setTrendMetric(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {trendMetric === 'velocity' ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    className={velocityTrendMode === 'average' ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ padding: '3px 10px', fontSize: 12, minHeight: 30 }}
                    onClick={() => setVelocityTrendMode('average')}
                  >
                    Average
                  </button>
                  <button
                    type="button"
                    className={velocityTrendMode === 'individual' ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ padding: '3px 10px', fontSize: 12, minHeight: 30 }}
                    onClick={() => setVelocityTrendMode('individual')}
                  >
                    Individual Pitches
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          {trendMetric === 'velocity' && velocityTrendMode === 'individual' ? (
            <VelocityScatterChart data={individualVelocityPoints} />
          ) : (
            <TrendBarChart data={combinedTrendData} metric={trendMetric} />
          )}
          {bullpenSummary.total ? (
            <div className="portal-bullpen-summary">
              <div>
                <h4>Pitch Summary</h4>
                <p>Pitch totals and results for the selected date range.</p>
              </div>
              <div className="portal-table-wrap">
                <table className="portal-table portal-bullpen-summary-table">
                  <thead>
                    <tr>
                      <th>Pitch Type</th>
                      <th>Ball Type</th>
                      <th className="portal-bullpen-summary-number">#</th>
                      {summaryHasStrike ? <th className="portal-bullpen-summary-number">Strike %</th> : null}
                      {summaryHasVelocity ? <th className="portal-bullpen-summary-number">Avg Velo</th> : null}
                      {summaryHasVelocity ? <th className="portal-bullpen-summary-number">Max Velo</th> : null}
                      {summaryHasExecution ? <th className="portal-bullpen-summary-number">Execution %</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {[...bullpenSummary.rows, bullpenSummary.total].map((summaryRow) => (
                      <tr key={summaryRow.key} className={summaryRow.key === 'all' ? 'portal-bullpen-summary-all' : undefined}>
                        <td>{summaryRow.pitchType}</td>
                        <td>{summaryRow.ballType}</td>
                        <td className="portal-bullpen-summary-number">{summaryRow.count}</td>
                        {summaryHasStrike ? <td className="portal-bullpen-summary-number">{formatSummaryNumber(summaryRow.strikePct, '%')}</td> : null}
                        {summaryHasVelocity ? <td className="portal-bullpen-summary-number">{formatSummaryNumber(summaryRow.avgVelocity)}</td> : null}
                        {summaryHasVelocity ? <td className="portal-bullpen-summary-number">{formatSummaryNumber(summaryRow.maxVelocity)}</td> : null}
                        {summaryHasExecution ? <td className="portal-bullpen-summary-number">{formatSummaryNumber(summaryRow.executionPct, '%')}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';

type ScriptTemplate = {
  id: string;
  name: string;
  rowCount: number;
  columns: string[];
  columnTypes?: BullpenColumnType[];
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

type BullpenColumnType = 'auto' | 'text' | 'velocity' | 'strike';
const DEFAULT_COLUMN_TYPE: BullpenColumnType = 'auto';
const ALLOWED_COLUMN_TYPES = new Set<BullpenColumnType>(['auto', 'text', 'velocity', 'strike']);

function normalizeColumnTypes(raw: unknown, columnCount: number): BullpenColumnType[] {
  const source = Array.isArray(raw) ? raw : [];
  const types = source.slice(0, columnCount).map((value) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'yes-no') return 'strike';
    return ALLOWED_COLUMN_TYPES.has(normalized as BullpenColumnType) ? normalized as BullpenColumnType : DEFAULT_COLUMN_TYPE;
  });
  while (types.length < columnCount) types.push(DEFAULT_COLUMN_TYPE);
  return types;
}

function isVelocityCol(col: string) {
  return col.trim().toLowerCase() === 'velocity';
}
function isStrikeCol(col: string) {
  const normalized = col.trim().toLowerCase();
  return normalized === 'strike' || normalized === 'strikes' || normalized === 'strike or ball';
}

function resolveColumnType(col: string, type: BullpenColumnType = DEFAULT_COLUMN_TYPE): BullpenColumnType {
  if (type !== 'auto') return type;
  if (isVelocityCol(col)) return 'velocity';
  if (isStrikeCol(col)) return 'strike';
  return 'text';
}

function isEditableColumn(col: string, type: BullpenColumnType = DEFAULT_COLUMN_TYPE) {
  const resolvedType = resolveColumnType(col, type);
  return resolvedType === 'velocity' || resolvedType === 'strike';
}

function buildEmptyRows(rowCount: number, columns: string[], templateRows: string[][], columnTypes?: BullpenColumnType[]): Array<Record<string, string>> {
  const types = normalizeColumnTypes(columnTypes, columns.length);
  return Array.from({ length: rowCount }, (_, i) => {
    const obj: Record<string, string> = {};
    columns.forEach((col, ci) => {
      if (isEditableColumn(col, types[ci])) {
        obj[col] = '';
      } else {
        obj[col] = templateRows[i]?.[ci] ?? '';
      }
    });
    return obj;
  });
}

function buildAdditionalRow(columns: string[], saved?: Record<string, string>): Record<string, string> {
  const obj: Record<string, string> = {};
  columns.forEach((col) => {
    obj[col] = String(saved?.[col] ?? '');
  });
  return obj;
}

function hasTrackingValue(col: string, value: string, type: BullpenColumnType = DEFAULT_COLUMN_TYPE) {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  const resolvedType = resolveColumnType(col, type);
  if (resolvedType === 'velocity') {
    const velocity = Number(raw);
    return Number.isFinite(velocity) && velocity > 0;
  }
  if (resolvedType === 'strike') return isStrikeResult(raw);
  return false;
}

function getCurrentTrackingRowIndex(rows: Array<Record<string, string>>, columns: string[], columnTypes?: BullpenColumnType[]) {
  if (!rows.length) return -1;
  const types = normalizeColumnTypes(columnTypes, columns.length);
  let latestFilledIndex = -1;
  rows.forEach((row, rowIndex) => {
    if (columns.some((col, colIndex) => hasTrackingValue(col, row[col] ?? '', types[colIndex]))) {
      latestFilledIndex = rowIndex;
    }
  });
  const nextIndex = latestFilledIndex + 1;
  return nextIndex < rows.length ? nextIndex : -1;
}

type BullpenTrendMetric = 'velocity' | 'strike';

type BullpenTrendBucket = {
  key: string;
  date: string;
  comboKey: string;
  comboLabel: string;
  pitchType: string;
  ballType: string;
  drill: string;
  ballWeight: string;
  value: number;
  count: number;
};

type BullpenVelocityPoint = {
  key: string;
  date: string;
  comboKey: string;
  comboLabel: string;
  pitchType: string;
  ballType: string;
  drill: string;
  ballWeight: string;
  value: number;
  pitchNumber: number;
};

type BullpenSummaryRow = {
  key: string;
  pitchType: string;
  ballType: string;
  drill: string;
  ballWeight: string;
  count: number;
  avgVelocity: number | null;
  maxVelocity: number | null;
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
  const labelByCombo = new Map(data.map((d) => [d.comboKey, d.comboLabel] as const));
  const combos = Array.from(new Set(data.map((d) => d.comboKey))).sort((a, b) => (labelByCombo.get(a) ?? a).localeCompare(labelByCombo.get(b) ?? b));
  const comboLabel = (combo: string) => labelByCombo.get(combo) ?? combo;
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
  const dataByDateCombo = new Map(data.map((d) => [`${d.date}|${d.comboKey}`, d] as const));
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
                const bucket = dataByDateCombo.get(`${date}|${combo}`);
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
                      <title>{`${d.date}\nPitch Type: ${d.pitchType}\nBall Type: ${d.ballType}${d.drill !== 'All' ? `\nDrill: ${d.drill}` : ''}${d.ballWeight !== 'All' ? `\nBall Weight: ${d.ballWeight}` : ''}\n${trendMetricLabel(metric)}: ${trendMetricFormat(metric, d.value)}\nPitches: ${d.count}`}</title>
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
            {trendMetricLabel(metric)} by Date / Pitch Type / Ball Type{metric === 'velocity' ? ' / Drill / Ball Weight' : ''}
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
  const labelByCombo = new Map(data.map((d) => [d.comboKey, d.comboLabel] as const));
  const combos = Array.from(new Set(data.map((d) => d.comboKey))).sort((a, b) => (labelByCombo.get(a) ?? a).localeCompare(labelByCombo.get(b) ?? b));
  const comboLabel = (combo: string) => labelByCombo.get(combo) ?? combo;
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
    arr.sort((a, b) => a.pitchNumber - b.pitchNumber || a.comboLabel.localeCompare(b.comboLabel));
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
                  const combo = point.comboKey;
                  const cx = pointsLeft + pointIndex * pointGap;
                  const cy = scaleY(point.value);
                  const fill = colorByCombo.get(combo) ?? '#94a3b8';
                  return (
                    <g key={point.key}>
                      <circle cx={cx} cy={cy} r={5.5} fill={fill} stroke="rgba(255,255,255,0.8)" strokeWidth={1.2} />
                      <title>{`${point.date}\nPitch #: ${point.pitchNumber}\nPitch Type: ${point.pitchType}\nBall Type: ${point.ballType}${point.drill !== 'All' ? `\nDrill: ${point.drill}` : ''}${point.ballWeight !== 'All' ? `\nBall Weight: ${point.ballWeight}` : ''}\nVelocity: ${trendMetricFormat('velocity', point.value)}`}</title>
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
            Individual Pitch Velocity by Date / Pitch Type / Ball Type / Drill / Ball Weight
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

function getFactorKey(parts: string[]) {
  return parts.map((part) => part.replaceAll('|', '/').trim() || 'Unspecified').join('|');
}

function getFactorLabel(parts: string[]) {
  return parts.filter((part) => part && part !== 'All').join(' / ') || 'All';
}

function getVelocityFactorLabel(drill: string, ballWeight: string) {
  return getFactorLabel([drill, ballWeight]);
}

function getColumnValue(row: Record<string, string>, column: string | null, fallback: string) {
  if (!column) return fallback;
  return String(row[column] ?? '').trim() || fallback;
}

function isStrike(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === 'yes' || normalized === 'strike';
}

function isStrikeResult(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === 'yes' || normalized === 'no' || normalized === 'strike' || normalized === 'ball';
}

function getLogEntryColumns(entry: LogEntry) {
  const firstRow = entry.rowsJson.find((row) => row && typeof row === 'object');
  const savedColumns = String(firstRow?.__templateColumns ?? '').trim();
  if (savedColumns) {
    try {
      const parsed = JSON.parse(savedColumns);
      if (Array.isArray(parsed)) return parsed.map((column) => String(column ?? '').trim()).filter(Boolean);
    } catch {
      // Fall through to the self-describing row keys used by older saved entries.
    }
  }
  return firstRow ? Object.keys(firstRow).filter((column) => !column.startsWith('__')) : [];
}

function getLogEntryColumnTypes(entry: LogEntry, columns: string[], fallback?: BullpenColumnType[]) {
  const firstRow = entry.rowsJson.find((row) => row && typeof row === 'object');
  const savedColumnTypes = String(firstRow?.__templateColumnTypes ?? '').trim();
  if (savedColumnTypes) {
    try {
      return normalizeColumnTypes(JSON.parse(savedColumnTypes), columns.length);
    } catch {
      // Fall through to the selected template or auto defaults.
    }
  }
  return normalizeColumnTypes(fallback, columns.length);
}

function findColumnByType(columns: string[], columnTypes: BullpenColumnType[], wanted: BullpenColumnType) {
  const idx = columns.findIndex((column, columnIndex) => resolveColumnType(column, columnTypes[columnIndex]) === wanted);
  return idx >= 0 ? columns[idx] : '';
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
  }, [visibleTemplates, state.selectedTemplateId, selectedTemplateId]);
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [loadingEntries, setLoadingEntries] = useState(false);

  const template = visibleTemplates.find((t) => t.id === selectedTemplateId) ?? null;
  const templateColumnTypes = useMemo(() => (
    template ? normalizeColumnTypes(template.columnTypes, template.columns.length) : []
  ), [template]);
  const currentTrackingRowIndex = useMemo(() => {
    if (!template) return -1;
    return getCurrentTrackingRowIndex(rows, template.columns, templateColumnTypes);
  }, [rows, template, templateColumnTypes]);
  const addBullpenRow = () => {
    if (!template) return;
    setRows((prev) => [...prev, buildAdditionalRow(template.columns)]);
  };

  // Init rows when template changes
  useEffect(() => {
    if (!template) { setRows([]); return; }
    setRows(buildEmptyRows(template.rowCount, template.columns, template.rows, templateColumnTypes));
  }, [template, templateColumnTypes]);

  const templateById = useMemo(() => new Map(visibleTemplates.map((row) => [row.id, row] as const)), [visibleTemplates]);

  // Load existing entries for all visible templates. The selected template still
  // controls the editable grid, but trends use the full bullpen history.
  useEffect(() => {
    if (!visibleTemplates.length) return;
    setLoadingEntries(true);
    fetch(`/api/player/bullpen-log?playerId=${playerId}${previewQuery ? `&${previewQuery.slice(1)}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((payload: { entries?: LogEntry[] }) => {
        const entries = Array.isArray(payload.entries) ? payload.entries : [];
        setLogEntries(entries);
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
      const merged = buildEmptyRows(template.rowCount, template.columns, template.rows, templateColumnTypes).map((row, i) => {
        const saved = existing.rowsJson[i];
        if (!saved) return row;
        const out = { ...row };
        template.columns.forEach((col, colIndex) => {
          if (isEditableColumn(col, templateColumnTypes[colIndex]) && saved[col] !== undefined) out[col] = saved[col];
        });
        return out;
      });
      const additionalRows = existing.rowsJson
        .slice(template.rowCount)
        .map((saved) => buildAdditionalRow(template.columns, saved));
      setRows([...merged, ...additionalRows]);
    } else {
      setRows(buildEmptyRows(template.rowCount, template.columns, template.rows, templateColumnTypes));
    }
  }, [bullpenDate, selectedTemplateId, logEntries, template, templateColumnTypes]);

  const handleSave = async () => {
    if (!template || !bullpenDate) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/player/bullpen-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId,
          templateId: selectedTemplateId,
          bullpenDate,
          rowsJson: rows.map((row) => ({
            ...row,
            __templateName: template.name,
            __templateColumns: JSON.stringify(template.columns),
            __templateColumnTypes: JSON.stringify(templateColumnTypes),
          })),
        }),
      });
      const payload = await res.json();
      if (!res.ok) { setSaveMsg(payload.error ?? 'Failed to save.'); return; }
      setSaveMsg('Saved!');
      // Refresh entries
      const refresh = await fetch(`/api/player/bullpen-log?playerId=${playerId}${previewQuery ? `&${previewQuery.slice(1)}` : ''}`, { cache: 'no-store' });
      const refreshPayload: { entries?: LogEntry[] } = await refresh.json();
      const entries = Array.isArray(refreshPayload.entries) ? refreshPayload.entries : [];
      setLogEntries(entries);
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
        const savedColumns = getLogEntryColumns(entry);
        const columns = savedColumns.length ? savedColumns : sourceTemplate?.columns ?? [];
        const columnTypes = getLogEntryColumnTypes(entry, columns, sourceTemplate?.columnTypes);
        const velocityCol = findColumnByType(columns, columnTypes, 'velocity');
        const strikeCol = findColumnByType(columns, columnTypes, 'strike');
        const pitchTypeCol = getColumn(columns, 'pitch type') ?? '';
        const ballTypeCol = getColumn(columns, 'ball type') ?? '';
        const drillCol = getColumn(columns, 'drill') ?? '';
        const ballWeightCol = getColumn(columns, 'ball weight') ?? '';
        return (entry.rowsJson ?? []).map((row, index): Record<string, string> => ({
          ...row,
          __date: entry.bullpenDate,
          __pitchNumber: String(index + 1),
          __templateId: entry.templateId,
          __velocityCol: velocityCol,
          __strikeCol: strikeCol,
          __pitchTypeCol: pitchTypeCol,
          __ballTypeCol: ballTypeCol,
          __drillCol: drillCol,
          __ballWeightCol: ballWeightCol,
        }));
      });
  }, [logEntries, templateById, trendStartDate, trendEndDate]);

  const trendMetricOptions = useMemo(() => {
    const options: Array<{ value: BullpenTrendMetric; label: string }> = [];
    const templateColumns = visibleTemplates.flatMap((row) => {
      const types = normalizeColumnTypes(row.columnTypes, row.columns.length);
      return row.columns.map((column, index) => resolveColumnType(column, types[index]));
    });
    const savedColumns = logEntries.flatMap((entry) => {
      const sourceTemplate = templateById.get(entry.templateId);
      const columns = getLogEntryColumns(entry);
      const types = getLogEntryColumnTypes(entry, columns, sourceTemplate?.columnTypes);
      return columns.map((column, index) => resolveColumnType(column, types[index]));
    });
    const allTypes = [...templateColumns, ...savedColumns];
    if (allTypes.includes('velocity')) options.push({ value: 'velocity', label: 'Velocity' });
    if (allTypes.includes('strike')) options.push({ value: 'strike', label: 'Strike %' });
    return options;
  }, [visibleTemplates, logEntries, templateById]);

  useEffect(() => {
    if (!trendMetricOptions.length) return;
    if (trendMetricOptions.some((option) => option.value === trendMetric)) return;
    setTrendMetric(trendMetricOptions[0]?.value ?? 'velocity');
  }, [trendMetric, trendMetricOptions]);

  const combinedTrendData = useMemo(() => {
    const groups = new Map<string, { date: string; comboKey: string; comboLabel: string; pitchType: string; ballType: string; drill: string; ballWeight: string; sum: number; count: number; yes: number }>();
    for (const row of allRows) {
      const valueCol = trendMetric === 'velocity' ? row.__velocityCol : row.__strikeCol;
      if (!valueCol) continue;
      const date = String(row.__date ?? '').trim();
      if (!date) continue;
      const pitchType = getColumnValue(row, row.__pitchTypeCol || null, 'Pitch');
      const ballType = getColumnValue(row, row.__ballTypeCol || null, 'Ball');
      const drill = trendMetric === 'velocity' ? getColumnValue(row, row.__drillCol || null, 'All') : 'All';
      const ballWeight = trendMetric === 'velocity' ? getColumnValue(row, row.__ballWeightCol || null, 'All') : 'All';
      const comboParts = trendMetric === 'velocity' ? [drill, ballWeight] : [pitchType, ballType];
      const comboKey = getFactorKey(comboParts);
      const comboLabel = trendMetric === 'velocity' ? getVelocityFactorLabel(drill, ballWeight) : getFactorLabel(comboParts);
      const rawValue = String(row[valueCol] ?? '').trim();
      if (!rawValue) continue;
      const key = `${date}|${comboKey}`;
      const group = groups.get(key) ?? { date, comboKey, comboLabel, pitchType, ballType, drill, ballWeight, sum: 0, count: 0, yes: 0 };
      if (trendMetric === 'velocity') {
        const value = Number(rawValue);
        if (!Number.isFinite(value) || value <= 0) continue;
        group.sum += value;
        group.count += 1;
      } else {
        if (!isStrikeResult(rawValue)) continue;
        group.count += 1;
        if (isStrike(rawValue)) group.yes += 1;
      }
      groups.set(key, group);
    }
    return Array.from(groups.entries())
      .map(([key, group]) => ({
        key,
        date: group.date,
        comboKey: group.comboKey,
        comboLabel: group.comboLabel,
        pitchType: group.pitchType,
        ballType: group.ballType,
        drill: group.drill,
        ballWeight: group.ballWeight,
        count: group.count,
        value: trendMetric === 'velocity'
          ? (group.count ? group.sum / group.count : 0)
          : (group.count ? (group.yes / group.count) * 100 : 0),
      }))
      .filter((bucket) => bucket.count > 0 && bucket.value > 0)
      .sort((a, b) =>
        a.date.localeCompare(b.date) ||
        a.comboLabel.localeCompare(b.comboLabel)
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
        const pitchType = getColumnValue(row, row.__pitchTypeCol || null, 'Pitch');
        const ballType = getColumnValue(row, row.__ballTypeCol || null, 'Ball');
        const drill = getColumnValue(row, row.__drillCol || null, 'All');
        const ballWeight = getColumnValue(row, row.__ballWeightCol || null, 'All');
        const comboParts = [drill, ballWeight];
        return {
          key: `${date}|${index}|${value}`,
          date,
          comboKey: getFactorKey(comboParts),
          comboLabel: getVelocityFactorLabel(drill, ballWeight),
          pitchType,
          ballType,
          drill,
          ballWeight,
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
      drill: string;
      ballWeight: string;
      count: number;
      velocitySum: number;
      velocityCount: number;
      maxVelocity: number | null;
      strikeYes: number;
      strikeCount: number;
    };
    const groups = new Map<string, SummaryAccumulator>();
    const total: SummaryAccumulator = {
      pitchType: 'All',
      ballType: 'All',
      drill: 'All',
      ballWeight: 'All',
      count: 0,
      velocitySum: 0,
      velocityCount: 0,
      maxVelocity: null,
      strikeYes: 0,
      strikeCount: 0,
    };
    const addPitch = (group: SummaryAccumulator, velocity: number | null, strike: string) => {
      group.count += 1;
      if (velocity !== null) {
        group.velocitySum += velocity;
        group.velocityCount += 1;
        group.maxVelocity = group.maxVelocity === null ? velocity : Math.max(group.maxVelocity, velocity);
      }
      if (isStrikeResult(strike)) {
        group.strikeCount += 1;
        if (isStrike(strike)) group.strikeYes += 1;
      }
    };

    for (const row of allRows) {
      const velocityRaw = row.__velocityCol ? String(row[row.__velocityCol] ?? '').trim() : '';
      const velocityValue = Number(velocityRaw);
      const velocity = velocityRaw && Number.isFinite(velocityValue) && velocityValue > 0 ? velocityValue : null;
      const strike = row.__strikeCol ? String(row[row.__strikeCol] ?? '').trim() : '';
      if (velocity === null && !isStrikeResult(strike)) continue;

      const pitchType = getColumnValue(row, row.__pitchTypeCol || null, 'Unspecified');
      const ballType = getColumnValue(row, row.__ballTypeCol || null, 'Unspecified');
      const drill = getColumnValue(row, row.__drillCol || null, 'All');
      const ballWeight = getColumnValue(row, row.__ballWeightCol || null, 'All');
      const key = getFactorKey([pitchType, ballType, drill, ballWeight]);
      const group = groups.get(key) ?? {
        pitchType,
        ballType,
        drill,
        ballWeight,
        count: 0,
        velocitySum: 0,
        velocityCount: 0,
        maxVelocity: null,
        strikeYes: 0,
        strikeCount: 0,
      };
      addPitch(group, velocity, strike);
      addPitch(total, velocity, strike);
      groups.set(key, group);
    }

    const toSummaryRow = (key: string, group: SummaryAccumulator): BullpenSummaryRow => ({
      key,
      pitchType: group.pitchType,
      ballType: group.ballType,
      drill: group.drill,
      ballWeight: group.ballWeight,
      count: group.count,
      avgVelocity: group.velocityCount > 0 ? group.velocitySum / group.velocityCount : null,
      maxVelocity: group.maxVelocity,
      strikePct: group.strikeCount > 0 ? (group.strikeYes / group.strikeCount) * 100 : null,
    });
    const summaryRows = Array.from(groups.entries())
      .map(([key, group]) => toSummaryRow(key, group))
      .sort((a, b) => b.count - a.count || getFactorLabel([a.pitchType, a.ballType, a.drill, a.ballWeight]).localeCompare(getFactorLabel([b.pitchType, b.ballType, b.drill, b.ballWeight])));
    return {
      total: total.count > 0 ? toSummaryRow('all', total) : null,
      rows: summaryRows,
    };
  }, [allRows]);

  const savedEntrySummaries = useMemo(() => logEntries.map((entry) => {
    const sourceTemplate = templateById.get(entry.templateId);
    const savedColumns = getLogEntryColumns(entry);
    const columns = savedColumns.length ? savedColumns : sourceTemplate?.columns ?? [];
    const columnTypes = getLogEntryColumnTypes(entry, columns, sourceTemplate?.columnTypes);
    const velocityCol = findColumnByType(columns, columnTypes, 'velocity');
    const strikeCol = findColumnByType(columns, columnTypes, 'strike');
    let velocitySum = 0;
    let velocityCount = 0;
    let maxVelocity: number | null = null;
    let strikeCount = 0;
    let strikeYes = 0;
    for (const row of entry.rowsJson) {
      const velocity = Number(String(velocityCol ? row[velocityCol] ?? '' : '').trim());
      if (Number.isFinite(velocity) && velocity > 0) {
        velocitySum += velocity;
        velocityCount += 1;
        maxVelocity = maxVelocity === null ? velocity : Math.max(maxVelocity, velocity);
      }
      const strike = String(strikeCol ? row[strikeCol] ?? '' : '').trim();
      if (isStrikeResult(strike)) {
        strikeCount += 1;
        if (isStrike(strike)) strikeYes += 1;
      }
    }
    const savedName = String(entry.rowsJson[0]?.__templateName ?? '').trim();
    return {
      key: `${entry.templateId}|${entry.bullpenDate}`,
      date: entry.bullpenDate,
      name: sourceTemplate?.name || savedName || 'Saved Bullpen',
      strikePct: strikeCount > 0 ? (strikeYes / strikeCount) * 100 : null,
      avgVelocity: velocityCount > 0 ? velocitySum / velocityCount : null,
      maxVelocity,
    };
  }), [logEntries, templateById]);

  const summaryHasVelocity = trendMetricOptions.some((option) => option.value === 'velocity');
  const summaryHasStrike = trendMetricOptions.some((option) => option.value === 'strike');
  const summaryHasDrill = summaryHasVelocity && allRows.some((row) => String(row.__drillCol ?? '').trim());
  const summaryHasBallWeight = summaryHasVelocity && allRows.some((row) => String(row.__ballWeightCol ?? '').trim());

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
                  {template.columns.map((col, colIndex) => {
                    const columnType = resolveColumnType(col, templateColumnTypes[colIndex]);
                    const isVelocityColumn = columnType === 'velocity';
                    return (
                      <th key={`${col}-${colIndex}`} style={{ textAlign: 'center', fontSize: '0.9rem', fontWeight: 800, padding: isVelocityColumn ? '0.35rem 0.2rem' : '0.4rem 0.35rem', borderBottom: '1px solid var(--calendar-grid-border, var(--border))', borderRight: '1px solid var(--calendar-grid-border, var(--border))', whiteSpace: 'nowrap', color: isEditableColumn(col, templateColumnTypes[colIndex]) ? '#c8102e' : 'inherit', width: isVelocityColumn ? 72 : undefined, minWidth: isVelocityColumn ? 72 : undefined, maxWidth: isVelocityColumn ? 72 : undefined }}>
                        {col}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
                  const isCurrentRow = ri === currentTrackingRowIndex;
                  const isAdditionalRow = ri >= template.rowCount;
                  const currentRowCellStyle = isCurrentRow
                    ? { background: 'rgba(34,197,94,0.12)' }
                    : {};
                  return (
                    <tr key={ri} aria-current={isCurrentRow ? 'step' : undefined}>
                      <td style={{ textAlign: 'center', fontWeight: 700, padding: '0.32rem', borderBottom: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid var(--calendar-grid-border, var(--border))', boxShadow: isCurrentRow ? 'inset 4px 0 0 #22c55e' : undefined, ...currentRowCellStyle }}>
                        <div style={{ display: 'grid', justifyItems: 'center', gap: 2, lineHeight: 1.05 }}>
                          <span>{ri + 1}</span>
                          {isCurrentRow ? <span style={{ fontSize: 10, fontWeight: 900, color: '#86efac', textTransform: 'uppercase' }}>Now</span> : null}
                          {isAdditionalRow && !isCurrentRow ? <span style={{ fontSize: 9, fontWeight: 900, color: '#fbbf24', textTransform: 'uppercase' }}>Extra</span> : null}
                        </div>
                      </td>
                      {template.columns.map((col, ci) => {
                        const val = row[col] ?? '';
                        const columnType = resolveColumnType(col, templateColumnTypes[ci]);
                        if (columnType === 'velocity') {
                          return (
                            <td key={ci} style={{ padding: '0.16rem', borderBottom: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid var(--calendar-grid-border, var(--border))', width: 72, minWidth: 72, maxWidth: 72, ...currentRowCellStyle }}>
                              <input
                                type="number"
                                className="portal-schedule-control"
                                value={val}
                                onChange={(e) => setRows((prev) => prev.map((r, i) => i === ri ? { ...r, [col]: e.target.value } : r))}
                                placeholder="mph"
                                style={{ width: '100%', minWidth: 0, textAlign: 'center', fontWeight: 600, padding: '0.35rem 0.25rem', borderColor: isCurrentRow ? 'rgba(34,197,94,0.75)' : undefined, boxShadow: isCurrentRow ? '0 0 0 1px rgba(34,197,94,0.24)' : undefined }}
                              />
                            </td>
                          );
                        }
                        if (columnType === 'strike') {
                          return (
                            <td key={ci} style={{ padding: '0.2rem', borderBottom: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid var(--calendar-grid-border, var(--border))', ...currentRowCellStyle }}>
                              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: '4px 0' }}>
                                {(['Yes', 'No'] as const).map((opt) => (
                                  <label key={opt} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', fontSize: 11, color: isCurrentRow ? '#d1fae5' : '#94a3b8', fontWeight: isCurrentRow ? 800 : 400 }}>
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
                        if (isAdditionalRow) {
                          return (
                            <td key={ci} style={{ padding: '0.16rem', borderBottom: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid var(--calendar-grid-border, var(--border))', ...currentRowCellStyle }}>
                              <input
                                type="text"
                                className="portal-schedule-control"
                                value={val}
                                onChange={(e) => setRows((prev) => prev.map((r, i) => i === ri ? { ...r, [col]: e.target.value } : r))}
                                style={{ width: '100%', minWidth: 0, textAlign: 'center', fontWeight: 600, padding: '0.35rem 0.45rem', borderColor: isCurrentRow ? 'rgba(34,197,94,0.75)' : undefined, boxShadow: isCurrentRow ? '0 0 0 1px rgba(34,197,94,0.24)' : undefined }}
                              />
                            </td>
                          );
                        }
                        return (
                          <td key={ci} style={{ padding: '0.2rem', borderBottom: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid var(--calendar-grid-border, var(--border))', ...currentRowCellStyle }}>
                            <div style={{ padding: '0.35rem 0.45rem', textAlign: 'center', fontSize: '0.95rem', fontWeight: 600, color: isCurrentRow ? '#f8fafc' : '#e2e8f0', opacity: isCurrentRow ? 1 : 0.85 }}>
                              {val || '—'}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr>
                  <td
                    colSpan={template.columns.length + 1}
                    style={{ padding: '0.45rem 0.2rem 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={addBullpenRow}
                      disabled={!template}
                      aria-label="Add bullpen row"
                      style={{
                        width: '100%',
                        minHeight: 38,
                        justifyContent: 'center',
                        borderStyle: 'dashed',
                        color: '#d1fae5',
                        fontSize: '0.95rem',
                        fontWeight: 600,
                      }}
                    >
                      + Add Row
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {savedEntrySummaries.length > 0 && !loadingEntries ? (
        <div className="portal-panel" style={{ minHeight: 'unset', padding: '1rem' }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 800, color: '#e2e8f0' }}>Saved Bullpen Entries</h4>
          <div className="portal-table-wrap">
            <table className="portal-table portal-bullpen-summary-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Script</th>
                  <th className="portal-bullpen-summary-number">Strike %</th>
                  <th className="portal-bullpen-summary-number">Avg Velo</th>
                  <th className="portal-bullpen-summary-number">Max Velo</th>
                </tr>
              </thead>
              <tbody>
                {savedEntrySummaries.map((entry) => (
                  <tr key={entry.key}>
                    <td>{entry.date}</td>
                    <td>{entry.name}</td>
                    <td className="portal-bullpen-summary-number">{formatSummaryNumber(entry.strikePct, '%')}</td>
                    <td className="portal-bullpen-summary-number">{formatSummaryNumber(entry.avgVelocity)}</td>
                    <td className="portal-bullpen-summary-number">{formatSummaryNumber(entry.maxVelocity)}</td>
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
                <p>Pitch totals, results, and velocity factors for the selected date range.</p>
              </div>
              <div className="portal-table-wrap">
                <table className="portal-table portal-bullpen-summary-table">
                  <thead>
                    <tr>
                      <th>Pitch Type</th>
                      <th>Ball Type</th>
                      {summaryHasDrill ? <th>Drill</th> : null}
                      {summaryHasBallWeight ? <th>Ball Weight</th> : null}
                      <th className="portal-bullpen-summary-number">#</th>
                      {summaryHasStrike ? <th className="portal-bullpen-summary-number">Strike %</th> : null}
                      {summaryHasVelocity ? <th className="portal-bullpen-summary-number">Avg Velo</th> : null}
                      {summaryHasVelocity ? <th className="portal-bullpen-summary-number">Max Velo</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {[...bullpenSummary.rows, bullpenSummary.total].map((summaryRow) => (
                      <tr key={summaryRow.key} className={summaryRow.key === 'all' ? 'portal-bullpen-summary-all' : undefined}>
                        <td>{summaryRow.pitchType}</td>
                        <td>{summaryRow.ballType}</td>
                        {summaryHasDrill ? <td>{summaryRow.drill}</td> : null}
                        {summaryHasBallWeight ? <td>{summaryRow.ballWeight}</td> : null}
                        <td className="portal-bullpen-summary-number">{summaryRow.count}</td>
                        {summaryHasStrike ? <td className="portal-bullpen-summary-number">{formatSummaryNumber(summaryRow.strikePct, '%')}</td> : null}
                        {summaryHasVelocity ? <td className="portal-bullpen-summary-number">{formatSummaryNumber(summaryRow.avgVelocity)}</td> : null}
                        {summaryHasVelocity ? <td className="portal-bullpen-summary-number">{formatSummaryNumber(summaryRow.maxVelocity)}</td> : null}
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

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ValdPlayerSnapshot } from '../../../lib/vald-forceplates';
import { forcePlateDisplayUnit } from '../../../lib/dashboard-metric-catalog';
import LeaderboardCorrelationModal from '../dashboard/leaderboard-correlation-modal';
import styles from './force-plates-dashboard.module.css';

type Snapshot = {
  fetchedAt: string;
  tenantId: string;
  players: ValdPlayerSnapshot[];
};

type ForcePlateLeaderboardRow = {
  playerName: string;
  cmj: number | null;
  sj: number | null;
  cmjMax: number | null;
  sjMax: number | null;
  rsiModified: number | null;
  sq: number | null;
  metricAverages: Record<string, number | null>;
};

type SavedTableView = {
  id: number;
  viewType: 'athlete' | 'leaderboard';
  name: string;
  columns: string[];
  columnLabels: Record<string, string>;
};

type PercentileStat = { percentile: number | null; sampleSize: number };
type ForcePlateLegDisplay = 'selected' | 'left' | 'right' | 'both';
type PercentileResponse = {
  groups: Array<{ id: string; name: string; categoryName: string; label: string }>;
  selectedGroupId: string;
  selectedGroupLabel: string;
  stats: {
    latest: PercentileStat;
    previous: PercentileStat;
    change: PercentileStat;
    average: PercentileStat;
    peak: PercentileStat;
  };
};

const KG_TO_LB = 2.2046226218;
const BODY_WEIGHT_KG_KEY = metricKey('Body Weight', 'kg');

// Fixed athlete-tab summary panels: exact (metricName, metricUnit) identities
// confirmed against production force_plate_metric_rows data. Body Weight is
// stored in kg and converted to lb for display (convert: kg -> lb).
const FIXED_PANEL_METRICS = [
  { label: 'Jump Height', name: 'Jump Height (Flight Time) in Inches', unit: 'Inch', displayUnit: 'in', lowerIsBetter: false, convert: (value: number) => value },
  { label: 'Peak Power/BM', name: 'Peak Power / BM', unit: 'Watt Per Kilo', displayUnit: 'W/kg', lowerIsBetter: false, convert: (value: number) => value },
  { label: 'RSI-Modified', name: 'RSI-modified', unit: 'RSIModified', displayUnit: '', lowerIsBetter: false, convert: (value: number) => value },
  { label: 'Eccentric Braking RFD/BM', name: 'Eccentric Braking RFD / BM', unit: 'Newton Per Second Per Kilo', displayUnit: 'N/(s·kg)', lowerIsBetter: false, convert: (value: number) => value },
  { label: 'Body Weight', name: 'Body Weight', unit: 'kg', displayUnit: 'lb', lowerIsBetter: false, convert: (value: number) => value * KG_TO_LB },
] as const;

const BASE_TABLE_OPTIONS = [
  { key: 'CMJ', label: 'CMJ' },
  { key: 'SJ', label: 'SJ' },
  { key: 'CMJMax', label: 'CMJ Max' },
  { key: 'SJMax', label: 'SJ Max' },
  { key: 'RSI', label: 'RSI' },
  { key: 'SQ', label: 'SQ' },
  { key: 'FBvelo', label: 'FBvelo' },
  { key: 'VeloMax', label: 'VeloMax' },
] as const;

function metricKey(name: string, unit: string): string {
  return `${name}__${unit}`;
}

function splitMetricKey(key: string): { name: string; unit: string } {
  const separator = key.lastIndexOf('__');
  return separator >= 0 ? { name: key.slice(0, separator), unit: key.slice(separator + 2) } : { name: key, unit: '' };
}

function metricLeg(name: string): 'left' | 'right' | null {
  const match = String(name ?? '').match(/\s+-\s+(Left|Right)$/i);
  return match?.[1]?.toLowerCase() === 'left' ? 'left' : match?.[1]?.toLowerCase() === 'right' ? 'right' : null;
}

function metricBaseName(name: string): string {
  return String(name ?? '').replace(/\s+-\s+(Left|Right)$/i, '').trim();
}

function legLabel(value: 'left' | 'right' | null): string {
  return value === 'left' ? 'Left' : value === 'right' ? 'Right' : 'Selected';
}

function ordinal(value: number): string {
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  const mod100 = normalized % 100;
  const suffix = mod100 >= 11 && mod100 <= 13
    ? 'th'
    : normalized % 10 === 1
      ? 'st'
      : normalized % 10 === 2
        ? 'nd'
        : normalized % 10 === 3
          ? 'rd'
          : 'th';
  return `${normalized}${suffix}`;
}

function leaderboardValue(
  row: ForcePlateLeaderboardRow & { fbVelo: number | null; veloMax: number | null },
  column: string
): number | null {
  if (column === 'CMJ') return row.cmj;
  if (column === 'SJ') return row.sj;
  if (column === 'CMJMax') return row.cmjMax;
  if (column === 'SJMax') return row.sjMax;
  if (column === 'RSI') return row.rsiModified;
  if (column === 'SQ') return row.sq;
  if (column === 'FBvelo') return row.fbVelo;
  if (column === 'VeloMax') return row.veloMax;
  if (column.startsWith('metric:')) return row.metricAverages[column.slice('metric:'.length)] ?? null;
  return null;
}

// Every fixed base metric (CMJ/SJ height, RSI, velocity, etc.) is higher-is-better.
// Custom metrics are only inverted when their unit is a pure duration -- braking
// phase duration, contraction time, time to peak force, time to takeoff, etc. are
// all genuinely lower-is-better; everything else (force, power, velocity, percent
// ratios, "No Unit") stays higher-is-better since a ratio/percentage isn't itself
// a duration even when it's built from one.
const DURATION_UNITS = new Set(['millisecond', 'second', 's', 'ms']);

function isLowerBetterColumn(column: string): boolean {
  if (!column.startsWith('metric:')) return false;
  const { unit } = splitMetricKey(column.slice('metric:'.length));
  return DURATION_UNITS.has(unit.trim().toLowerCase());
}

function percentileRank(value: number, population: number[], invert = false): number {
  if (population.length <= 1) return 100;
  const sign = invert ? -1 : 1;
  const target = value * sign;
  let lower = 0;
  let equal = 0;
  for (const raw of population) {
    const entry = raw * sign;
    if (entry < target) lower += 1;
    else if (Math.abs(entry - target) < 1e-9) equal += 1;
  }
  return Math.round(((lower + Math.max(0, equal - 1) / 2) / (population.length - 1)) * 100);
}

// Red/yellow/green tiering for percentile badges: bottom third, middle
// third, top third.
function percentileTierClass(percentile: number): string {
  if (percentile < 34) return styles.percentileLow;
  if (percentile < 67) return styles.percentileMid;
  return styles.percentileHigh;
}

function PercentileBadge({ stat, loading }: { stat: PercentileStat | undefined; loading: boolean }) {
  if (loading) return <span className={styles.percentileBadge}>Ranking…</span>;
  if (!stat || stat.percentile === null) return <span className={`${styles.percentileBadge} ${styles.percentileUnavailable}`}>No rank</span>;
  return (
    <span className={`${styles.percentileBadge} ${percentileTierClass(stat.percentile)}`} title={`Compared with ${stat.sampleSize} athlete${stat.sampleSize === 1 ? '' : 's'} with qualifying data`}>
      {ordinal(stat.percentile)} percentile
    </span>
  );
}

function tableColumnLabel(column: string, options: ReadonlyArray<{ key: string; label: string }>, customLabels?: Record<string, string>): string {
  const custom = customLabels?.[column]?.trim();
  if (custom) return custom;
  const configured = options.find((option) => option.key === column)?.label;
  if (configured) return configured;
  if (!column.startsWith('metric:')) return column;
  const [name, unit = ''] = column.slice('metric:'.length).split('__');
  return `${name}${unit ? ` (${unit})` : ''}`;
}

function reorderColumn(columns: string[], source: string, target: string): string[] {
  const from = columns.indexOf(source);
  const to = columns.indexOf(target);
  if (from < 0 || to < 0 || from === to) return columns;
  const next = [...columns];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

type ExportCell = string | number | null;

function safeFileName(value: string): string {
  return value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'force-plate-export';
}

function csvCell(value: ExportCell): string {
  const raw = value === null ? '' : String(value);
  const protectedValue = /^[=+@]/.test(raw) || (/^-/.test(raw) && !/^-\d+(?:\.\d+)?$/.test(raw)) ? `'${raw}` : raw;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

function downloadCsv(headers: string[], rows: ExportCell[][], fileName: string) {
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadTablePdf(args: {
  title: string;
  subtitle: string;
  detail: string;
  headers: string[];
  rows: ExportCell[][];
  fileName: string;
}) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 30;
  const fixedWidth = 112;
  const usableMetricWidth = pageWidth - margin * 2 - fixedWidth;
  const columnsPerSection = Math.max(1, Math.floor(usableMetricWidth / 72));
  const metricHeaders = args.headers.slice(1);
  const sections = metricHeaders.length
    ? Array.from({ length: Math.ceil(metricHeaders.length / columnsPerSection) }, (_, index) => ({
        start: index * columnsPerSection,
        headers: metricHeaders.slice(index * columnsPerSection, (index + 1) * columnsPerSection),
      }))
    : [{ start: 0, headers: [] }];
  let pageNumber = 0;

  const fitText = (value: ExportCell, width: number) => {
    const text = value === null ? '—' : String(value);
    if (pdf.getTextWidth(text) <= width) return text;
    let fitted = text;
    while (fitted.length > 1 && pdf.getTextWidth(`${fitted}…`) > width) fitted = fitted.slice(0, -1);
    return `${fitted}…`;
  };

  for (const [sectionIndex, section] of sections.entries()) {
    let rowIndex = 0;
    do {
      if (pageNumber > 0) pdf.addPage();
      pageNumber += 1;
      pdf.setFillColor(10, 10, 12);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      pdf.setFillColor(190, 12, 48);
      pdf.rect(0, 0, 8, pageHeight, 'F');
      pdf.setTextColor(247, 244, 242);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(19);
      pdf.text(args.title, margin, 34);
      pdf.setFontSize(10);
      pdf.setTextColor(206, 198, 195);
      pdf.text(args.subtitle, margin, 52);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(155, 148, 146);
      pdf.text(args.detail, margin, 68);
      if (sections.length > 1) {
        pdf.text(`Columns ${section.start + 1}–${section.start + section.headers.length} of ${metricHeaders.length}`, pageWidth - margin, 68, { align: 'right' });
      }

      const tableHeaders = [args.headers[0], ...section.headers];
      const metricWidth = section.headers.length ? usableMetricWidth / section.headers.length : usableMetricWidth;
      const widths = [fixedWidth, ...section.headers.map(() => metricWidth)];
      let y = 84;
      const headerHeight = 38;
      let x = margin;
      pdf.setFillColor(190, 12, 48);
      pdf.rect(margin, y, pageWidth - margin * 2, headerHeight, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.2);
      pdf.setTextColor(255, 255, 255);
      tableHeaders.forEach((header, index) => {
        const lines = pdf.splitTextToSize(header.toUpperCase(), widths[index] - 10).slice(0, 2) as string[];
        pdf.text(lines, x + widths[index] / 2, y + (lines.length > 1 ? 13 : 21), { align: 'center' });
        x += widths[index];
      });
      y += headerHeight;

      const rowHeight = 24;
      const availableRows = Math.max(1, Math.floor((pageHeight - y - 38) / rowHeight));
      const pageRows = args.rows.slice(rowIndex, rowIndex + availableRows);
      pageRows.forEach((row, pageRowIndex) => {
        const exportRow = [row[0], ...row.slice(section.start + 1, section.start + 1 + section.headers.length)];
        if (pageRowIndex % 2 === 0) {
          pdf.setFillColor(20, 19, 21);
          pdf.rect(margin, y, pageWidth - margin * 2, rowHeight, 'F');
        }
        pdf.setDrawColor(47, 44, 46);
        pdf.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
        pdf.setFontSize(8);
        pdf.setTextColor(232, 227, 224);
        let cellX = margin;
        exportRow.forEach((cell, index) => {
          pdf.setFont('helvetica', index === 0 ? 'bold' : 'normal');
          pdf.text(fitText(cell, widths[index] - 10), cellX + widths[index] / 2, y + 15, { align: 'center' });
          cellX += widths[index];
        });
        y += rowHeight;
      });
      rowIndex += pageRows.length;
      if (!args.rows.length) rowIndex = 1;
    } while (rowIndex < args.rows.length);
  }

  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(120, 115, 114);
    pdf.text(`PEARL · FORCE PLATES  |  PAGE ${page} OF ${totalPages}`, pageWidth - margin, pageHeight - 14, { align: 'right' });
  }
  pdf.save(args.fileName);
}

function TableExportMenu({ disabled, onCsv, onPdf }: { disabled: boolean; onCsv: () => void; onPdf: () => Promise<void> }) {
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState('');
  return (
    <details className={styles.exportMenu}>
      <summary aria-label="Open export options"><span aria-hidden="true">⇩</span> Export</summary>
      <div>
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => {
            onCsv();
            event.currentTarget.closest('details')?.removeAttribute('open');
          }}
        >
          <strong>CSV</strong><span>Spreadsheet data</span>
        </button>
        <button
          type="button"
          disabled={disabled || exportingPdf}
          onClick={async (event) => {
            setError('');
            setExportingPdf(true);
            try {
              await onPdf();
              event.currentTarget.closest('details')?.removeAttribute('open');
            } catch (exportError) {
              setError(exportError instanceof Error ? exportError.message : 'Could not export PDF.');
            } finally {
              setExportingPdf(false);
            }
          }}
        >
          <strong>{exportingPdf ? 'Building…' : 'PDF'}</strong><span>Print-ready report</span>
        </button>
        {error ? <p>{error}</p> : null}
      </div>
    </details>
  );
}

function chartPath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function testTypeColor(index: number): string {
  const palette = [
    'rgba(56,189,248,0.95)',
    'rgba(34,197,94,0.95)',
    'rgba(249,115,22,0.95)',
    'rgba(168,85,247,0.95)',
    'rgba(236,72,153,0.95)',
    'rgba(250,204,21,0.95)',
  ];
  return palette[index % palette.length];
}

function valueRange(values: number[], lowerPaddingRatio = 0): { min: number; max: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min: min - (max - min) * lowerPaddingRatio, max };
}

function chartXPosition(index: number, count: number, view: 'line' | 'bar'): number {
  const plotLeft = 56;
  const plotWidth = 476;
  if (view === 'bar') return plotLeft + ((index + 0.5) / Math.max(1, count)) * plotWidth;
  return plotLeft + (index / Math.max(1, count - 1)) * plotWidth;
}

function toIsoDate(value: string): string {
  const parsed = new Date(String(value ?? '').trim());
  if (Number.isNaN(parsed.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

function chartDateKey(value: string): string {
  const iso = toIsoDate(value);
  return iso || String(value ?? '');
}

function displayDate(value: string): string {
  const iso = toIsoDate(value);
  if (!iso) return value || '—';
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day));
}

function normalizeName(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const firstLast = raw.includes(',')
    ? (() => {
        const [last, ...rest] = raw.split(',').map((x) => x.trim());
        const first = rest.join(' ').trim();
        return first && last ? `${first} ${last}` : raw;
      })()
    : raw;
  return firstLast
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isJumpHeightMetricName(metricName: string): boolean {
  const normalized = String(metricName ?? '').toLowerCase();
  return normalized.includes('jump height');
}

function pickJumpRows(
  rows: Array<{ testType: string; metricName: string; metricUnit: string; value: number }>,
  allowedTestTypes: string[]
): Array<{ testType: string; metricName: string; metricUnit: string; value: number }> {
  const tests = new Set(allowedTestTypes.map((t) => t.toUpperCase()));
  const candidates = rows.filter((row) => tests.has(String(row.testType ?? '').toUpperCase()) && isJumpHeightMetricName(row.metricName));
  if (!candidates.length) return [];
  const inchCandidates = candidates.filter((row) => String(row.metricUnit ?? '').toLowerCase().includes('inch'));
  if (inchCandidates.length) return inchCandidates;
  const flightTimeCandidates = candidates.filter((row) => String(row.metricName ?? '').toLowerCase().includes('flight time'));
  if (flightTimeCandidates.length) return flightTimeCandidates;
  return candidates;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeTestType(value: string): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function isCmjType(value: string): boolean {
  const n = normalizeTestType(value);
  return n === 'CMJ' || n.includes('CMJ');
}

function isSjType(value: string): boolean {
  const n = normalizeTestType(value);
  return n === 'SJ' || n === 'SQUATJUMP' || n.includes('SQUATJUMP');
}

function isSqType(value: string): boolean {
  const n = normalizeTestType(value);
  return n === 'SQ';
}

function buildJumpPerTestValues(
  rows: Array<{
    testId: string;
    testType: string;
    metricName: string;
    metricUnit: string;
    value: number;
    pointType?: 'average' | 'rep';
  }>,
  testMatch: (testType: string) => boolean
): number[] {
  const jumpRows = rows.filter((row) => testMatch(row.testType) && isJumpHeightMetricName(row.metricName));
  if (!jumpRows.length) return [];
  const byTest = new Map<string, Array<typeof jumpRows[number]>>();
  for (const row of jumpRows) {
    const list = byTest.get(row.testId) ?? [];
    list.push(row);
    byTest.set(row.testId, list);
  }
  const out: number[] = [];
  for (const rowsForTest of byTest.values()) {
    const avgRows = rowsForTest.filter((row) => String(row.pointType ?? 'average') === 'average');
    const repRows = rowsForTest.filter((row) => String(row.pointType ?? 'average') === 'rep');
    const selectPreferred = (candidates: Array<typeof jumpRows[number]>) => {
      const inch = candidates.filter((row) => String(row.metricUnit ?? '').toLowerCase().includes('inch'));
      if (inch.length) return inch;
      const ft = candidates.filter((row) => String(row.metricName ?? '').toLowerCase().includes('flight time'));
      if (ft.length) return ft;
      return candidates;
    };
    const avgPreferred = selectPreferred(avgRows);
    const repPreferred = selectPreferred(repRows);
    const v = mean(avgPreferred.map((row) => row.value)) ?? mean(repPreferred.map((row) => row.value));
    if (v !== null) out.push(v);
  }
  return out;
}

function computeJumpStats(
  rows: Array<{
    testId: string;
    testType: string;
    metricName: string;
    metricUnit: string;
    value: number;
    pointType?: 'average' | 'rep';
  }>,
  testMatch: (testType: string) => boolean
): { average: number | null; max: number | null } {
  const jumpRows = rows.filter((row) => testMatch(row.testType) && isJumpHeightMetricName(row.metricName));
  if (!jumpRows.length) return { average: null, max: null };
  const byTest = new Map<string, Array<typeof jumpRows[number]>>();
  for (const row of jumpRows) {
    const list = byTest.get(row.testId) ?? [];
    list.push(row);
    byTest.set(row.testId, list);
  }
  const selectPreferred = (candidates: Array<typeof jumpRows[number]>) => {
    const inch = candidates.filter((row) => String(row.metricUnit ?? '').toLowerCase().includes('inch'));
    if (inch.length) return inch;
    const ft = candidates.filter((row) => String(row.metricName ?? '').toLowerCase().includes('flight time'));
    if (ft.length) return ft;
    return candidates;
  };

  const perTest: number[] = [];
  const repValues: number[] = [];
  for (const rowsForTest of byTest.values()) {
    const avgRows = selectPreferred(rowsForTest.filter((row) => String(row.pointType ?? 'average') === 'average'));
    const reps = selectPreferred(rowsForTest.filter((row) => String(row.pointType ?? 'average') === 'rep'));
    if (reps.length) {
      perTest.push(mean(reps.map((row) => row.value)) ?? 0);
      repValues.push(...reps.map((row) => row.value));
    } else if (avgRows.length) {
      const v = mean(avgRows.map((row) => row.value));
      if (v !== null) perTest.push(v);
    }
  }
  const average = mean(perTest);
  const max = repValues.length ? Math.max(...repValues) : (perTest.length ? Math.max(...perTest) : null);
  return { average, max };
}

function SavedViewControls({
  viewType,
  savedViews,
  selectedId,
  name,
  columnCount,
  canManage,
  loading,
  saving,
  message,
  onSelect,
  onNameChange,
  onNew,
  onColumns,
  onSave,
  onDelete,
}: {
  viewType: 'athlete' | 'leaderboard';
  savedViews: SavedTableView[];
  selectedId: number | null;
  name: string;
  columnCount: number;
  canManage: boolean;
  loading: boolean;
  saving: boolean;
  message: string;
  onSelect: (value: string) => void;
  onNameChange: (value: string) => void;
  onNew: () => void;
  onColumns: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const options = savedViews.filter((view) => view.viewType === viewType);
  return (
    <div className={styles.savedViewShell}>
      <div className={styles.savedViewBar}>
        <label>
          <span>Saved table</span>
          <select value={selectedId ? String(selectedId) : 'working'} onChange={(event) => onSelect(event.target.value)}>
            <option value="working" disabled>{loading ? 'Loading saved tables…' : 'Working table'}</option>
            {options.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
          </select>
        </label>
        {canManage ? (
          <label className={styles.viewNameField}>
            <span>Table name</span>
            <input value={name} maxLength={80} placeholder="Name this table" onChange={(event) => onNameChange(event.target.value)} />
          </label>
        ) : null}
        <div className={styles.viewActions}>
          <button type="button" onClick={onColumns}>{columnCount} columns</button>
          {canManage ? <button type="button" onClick={onNew}>New table</button> : null}
          {canManage ? <button type="button" className={styles.saveViewButton} disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button> : null}
          {canManage && selectedId && selectedId > 0 ? <button type="button" className={styles.deleteViewButton} disabled={saving} onClick={onDelete}>Delete</button> : null}
        </div>
      </div>
      {message ? <p className={styles.viewMessage}>{message}</p> : null}
    </div>
  );
}

function ColumnEditor({
  options,
  columns,
  labels,
  search,
  onSearchChange,
  onColumnsChange,
  onLabelsChange,
}: {
  options: ReadonlyArray<{ key: string; label: string }>;
  columns: string[];
  labels: Record<string, string>;
  search: string;
  onSearchChange: (value: string) => void;
  onColumnsChange: (columns: string[]) => void;
  onLabelsChange: (labels: Record<string, string>) => void;
}) {
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const matchingOptions = options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()));
  const optionMap = new Map(options.map((option) => [option.key, option.label]));
  const moveBy = (column: string, amount: number) => {
    const index = columns.indexOf(column);
    const target = index + amount;
    if (index < 0 || target < 0 || target >= columns.length) return;
    const next = [...columns];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onColumnsChange(next);
  };

  return (
    <div className={styles.columnEditor}>
      <div className={styles.selectedColumnSection}>
        <div className={styles.columnEditorHeading}>
          <strong>Selected columns</strong>
          <span>Drag to reorder · rename for display</span>
        </div>
        <div className={styles.selectedColumnList}>
          {columns.map((column, index) => {
            const originalLabel = optionMap.get(column) ?? tableColumnLabel(column, options);
            return (
              <div
                key={`selected-${column}`}
                className={`${styles.selectedColumnRow}${draggedColumn === column ? ` ${styles.draggingColumn}` : ''}`}
                draggable
                onDragStart={() => setDraggedColumn(column)}
                onDragEnd={() => setDraggedColumn(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedColumn) onColumnsChange(reorderColumn(columns, draggedColumn, column));
                  setDraggedColumn(null);
                }}
              >
                <span className={styles.dragHandle} title="Drag to reorder" aria-hidden="true">⠿</span>
                <span className={styles.columnOrder}>{index + 1}</span>
                <div className={styles.originalColumnName} title={originalLabel}>{originalLabel}</div>
                <input
                  value={labels[column] ?? ''}
                  maxLength={48}
                  aria-label={`Display name for ${originalLabel}`}
                  placeholder="Custom display name"
                  onChange={(event) => {
                    const next = { ...labels };
                    if (event.target.value) next[column] = event.target.value;
                    else delete next[column];
                    onLabelsChange(next);
                  }}
                />
                <div className={styles.columnOrderButtons}>
                  <button type="button" disabled={index === 0} aria-label={`Move ${originalLabel} left`} onClick={() => moveBy(column, -1)}>←</button>
                  <button type="button" disabled={index === columns.length - 1} aria-label={`Move ${originalLabel} right`} onClick={() => moveBy(column, 1)}>→</button>
                  <button type="button" aria-label={`Remove ${originalLabel}`} onClick={() => onColumnsChange(columns.filter((key) => key !== column))}>×</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.availableColumnSection}>
        <div className={styles.columnEditorHeading}>
          <strong>Available metrics</strong>
          <span>Additions appear at the end</span>
        </div>
        <input type="search" value={search} placeholder="Search available columns…" onChange={(event) => onSearchChange(event.target.value)} />
        <div className={styles.columnGrid}>
          {matchingOptions.map((option) => {
            const checked = columns.includes(option.key);
            return (
              <label key={`available-${option.key}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onColumnsChange(event.target.checked ? [...columns, option.key] : columns.filter((key) => key !== option.key))}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ForcePlatesDashboard({
  snapshot,
  canManageViews,
  availableTestTypes = [],
}: {
  snapshot: Snapshot;
  canManageViews: boolean;
  availableTestTypes?: string[];
}) {
  const [activeTab, setActiveTab] = useState<'player' | 'leaderboard'>('player');
  const [players, setPlayers] = useState(snapshot.players);
  const [selectedPlayer, setSelectedPlayer] = useState(snapshot.players[0]?.playerName ?? '');
  const [loadedPlayerNames, setLoadedPlayerNames] = useState<Set<string>>(
    () => new Set(snapshot.players.filter((entry) => entry.metricRows.length > 0).map((entry) => entry.playerName))
  );
  const [loadingPlayer, setLoadingPlayer] = useState(false);
  const [playerLoadError, setPlayerLoadError] = useState('');
  const [pointMode, setPointMode] = useState<'average' | 'max'>('average');
  const [chartView, setChartView] = useState<'line' | 'bar'>('bar');
  const [metricSearch, setMetricSearch] = useState('');
  const [metricPickerOpen, setMetricPickerOpen] = useState(false);
  const [athleteSearch, setAthleteSearch] = useState('');
  const [athletePickerOpen, setAthletePickerOpen] = useState(false);
  const [percentileGroupId, setPercentileGroupId] = useState('all');
  const [percentileData, setPercentileData] = useState<PercentileResponse | null>(null);
  const [percentileLoading, setPercentileLoading] = useState(false);
  const [percentileError, setPercentileError] = useState('');
  const [legDisplay, setLegDisplay] = useState<ForcePlateLegDisplay>('selected');
  const [legPercentiles, setLegPercentiles] = useState<Record<string, PercentileStat | undefined>>({});
  const [legPercentilesLoading, setLegPercentilesLoading] = useState(false);
  const [panelPercentiles, setPanelPercentiles] = useState<Record<string, PercentileStat | undefined>>({});
  const [panelPercentilesLoading, setPanelPercentilesLoading] = useState(false);
  const player = useMemo(() => players.find((entry) => entry.playerName === selectedPlayer) ?? null, [players, selectedPlayer]);
  const visiblePlayers = useMemo(() => {
    const query = athleteSearch.trim().toLowerCase();
    return query ? players.filter((entry) => entry.playerName.toLowerCase().includes(query)) : players;
  }, [athleteSearch, players]);

  useEffect(() => {
    if (!selectedPlayer) return;
    const current = players.find((entry) => entry.playerName === selectedPlayer) ?? null;
    if (current?.metricRows.length || loadedPlayerNames.has(selectedPlayer)) return;
    let cancelled = false;
    setLoadingPlayer(true);
    setPlayerLoadError('');
    void fetch(`/api/player/force-plate-data?player=${encodeURIComponent(selectedPlayer)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { player?: ValdPlayerSnapshot | null; error?: string };
        if (!response.ok) throw new Error(payload.error || 'Could not load force plate data.');
        if (cancelled || !payload.player) return;
        setPlayers((existing) => existing.map((entry) => entry.playerName === selectedPlayer ? payload.player! : entry));
      })
      .catch((error) => {
        if (!cancelled) setPlayerLoadError(error instanceof Error ? error.message : 'Could not load force plate data.');
      })
      .finally(() => {
        if (!cancelled) {
          setLoadedPlayerNames((existing) => new Set(existing).add(selectedPlayer));
          setLoadingPlayer(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadedPlayerNames, players, selectedPlayer]);

  const metricOptions = useMemo(() => {
    if (!player) return [];
    const map = new Map<string, { name: string; unit: string; count: number }>();
    for (const row of player.metricRows) {
      const key = metricKey(row.metricName, row.metricUnit);
      const current = map.get(key) ?? { name: row.metricName, unit: row.metricUnit, count: 0 };
      current.count += 1;
      map.set(key, current);
    }
    const values = Array.from(map.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map((row) => {
        const key = metricKey(row.name, row.unit);
        // Body Weight is stored in kg; the picker only ever shows the lb
        // label since metricRows() converts its values before display.
        const displayUnit = key === BODY_WEIGHT_KG_KEY ? 'lb' : row.unit;
        return { key, label: `${row.name}${displayUnit ? ` (${displayUnit})` : ''} • ${row.count}` };
      });
    return values;
  }, [player]);
  const [selectedMetricKey, setSelectedMetricKey] = useState('');
  const defaultMetricKey = useMemo(() => {
    if (!metricOptions.length) return '';
    const preferredKey = metricKey('Peak Power / BM', 'Watt Per Kilo');
    const preferred = metricOptions.find((option) => option.key === preferredKey);
    return preferred?.key ?? metricOptions[0].key;
  }, [metricOptions]);
  const visibleMetricOptions = useMemo(() => {
    const query = metricSearch.trim().toLowerCase();
    if (!query) return metricOptions;
    const activeKey = selectedMetricKey || defaultMetricKey;
    return metricOptions.filter((option) => option.key === activeKey || option.label.toLowerCase().includes(query));
  }, [defaultMetricKey, metricOptions, metricSearch, selectedMetricKey]);

  const activeMetricKey = selectedMetricKey || defaultMetricKey;
  const activeMetricIdentity = useMemo(() => splitMetricKey(activeMetricKey), [activeMetricKey]);
  const availableLegMetricKeys = useMemo(() => {
    const selectedLeg = metricLeg(activeMetricIdentity.name);
    if (!selectedLeg || !activeMetricIdentity.unit) return [];
    const baseName = metricBaseName(activeMetricIdentity.name);
    const availableKeys = new Set(metricOptions.map((option) => option.key));
    const left = metricKey(`${baseName} - Left`, activeMetricIdentity.unit);
    const right = metricKey(`${baseName} - Right`, activeMetricIdentity.unit);
    return [left, right].filter((key) => availableKeys.has(key));
  }, [activeMetricIdentity.name, activeMetricIdentity.unit, metricOptions]);
  const displayedMetricKeys = useMemo(() => {
    if (legDisplay === 'selected' || !availableLegMetricKeys.length) return activeMetricKey ? [activeMetricKey] : [];
    if (legDisplay === 'both') return availableLegMetricKeys;
    return availableLegMetricKeys.filter((key) => metricLeg(splitMetricKey(key).name) === legDisplay);
  }, [activeMetricKey, availableLegMetricKeys, legDisplay]);
  const canSelectLegDisplay = availableLegMetricKeys.length > 0;

  const metricRows = useMemo(() => {
    if (!player) return [];
    const activeMetrics = new Set(displayedMetricKeys);
    const matchingRows = player.metricRows.filter((row) => activeMetrics.has(metricKey(row.metricName, row.metricUnit)));
    const converted = displayedMetricKeys.length === 1 && displayedMetricKeys[0] === BODY_WEIGHT_KG_KEY
      ? matchingRows.map((row) => ({ ...row, value: row.value * KG_TO_LB, metricUnit: 'lb' }))
      : matchingRows;
    if (pointMode === 'max') {
      const repRows = converted.filter((row) => String(row.pointType ?? 'average') === 'rep');
      return repRows.length ? repRows : converted.filter((row) => String(row.pointType ?? 'average') === 'average');
    }
    return converted.filter((row) => String(row.pointType ?? 'average') === 'average');
  }, [displayedMetricKeys, player, pointMode]);

  const [selectedTestType, setSelectedTestType] = useState('All');
  const [testTypeTouched, setTestTypeTouched] = useState(false);
  const [dateRangeByPlayer, setDateRangeByPlayer] = useState<Record<string, { start: string; end: string }>>({});
  const [leaderStartDate, setLeaderStartDate] = useState('');
  const [leaderEndDate, setLeaderEndDate] = useState('');
  const [leaderForceRows, setLeaderForceRows] = useState<ForcePlateLeaderboardRow[]>([]);
  const [leaderMetricOptions, setLeaderMetricOptions] = useState<Array<{ key: string; label: string }>>([]);
  const [leaderboardBounds, setLeaderboardBounds] = useState({ min: '', max: '' });
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState('');
  const [leaderVelocityRows, setLeaderVelocityRows] = useState<Array<{ name: string; fbVelo: number | null; veloMax: number | null }>>([]);
  const [leaderColumns, setLeaderColumns] = useState<string[]>(['CMJ', 'CMJMax', 'SJ', 'SJMax', 'RSI', 'FBvelo', 'VeloMax']);
  const [leaderColumnMenuOpen, setLeaderColumnMenuOpen] = useState(false);
  const [leaderSort, setLeaderSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'CMJ', dir: 'desc' });
  const [leaderTestType, setLeaderTestType] = useState('All');
  const [leaderTestOptions, setLeaderTestOptions] = useState<string[]>([]);
  const [leaderTestSearch, setLeaderTestSearch] = useState('');
  const [leaderTestPickerOpen, setLeaderTestPickerOpen] = useState(false);
  const [leaderDisplayMode, setLeaderDisplayMode] = useState<'value' | 'percentile' | 'both'>('value');
  const [showLeaderboardCorrelation, setShowLeaderboardCorrelation] = useState(false);
  const testTypeOptions = useMemo(() => {
    const playerTestTypes = player?.metricRows.map((row) => row.testType) ?? [];
    return ['All', ...Array.from(new Set([...availableTestTypes, ...playerTestTypes].filter(Boolean))).sort((a, b) => a.localeCompare(b))];
  }, [availableTestTypes, player]);
  // Default the chart to CMJ as soon as it's available, unless the coach has
  // already picked a test type themselves. Prefers an exact "CMJ" match over
  // isCmjType()'s broader match, since that also catches related-but-distinct
  // test types like "CMRJ" and "ABCMJ" (real production test_type values).
  useEffect(() => {
    if (testTypeTouched || testTypeOptions.length <= 1) return;
    const cmjOption = testTypeOptions.find((option) => normalizeTestType(option) === 'CMJ')
      ?? testTypeOptions.find((option) => option !== 'All' && isCmjType(option));
    if (cmjOption && cmjOption !== selectedTestType) setSelectedTestType(cmjOption);
  }, [testTypeOptions, testTypeTouched, selectedTestType]);
  const playerDateBounds = useMemo(() => {
    if (!player) return { min: '', max: '' };
    const dates = player.metricRows
      .map((row) => toIsoDate(String(row.dateTime ?? row.date)))
      .filter(Boolean)
      .sort();
    return { min: dates[0] ?? '', max: dates[dates.length - 1] ?? '' };
  }, [player]);
  const startDate = dateRangeByPlayer[selectedPlayer]?.start || playerDateBounds.min;
  const endDate = dateRangeByPlayer[selectedPlayer]?.end || playerDateBounds.max;

  const filteredRowsBase = useMemo(
    () =>
      metricRows.filter((row) => {
        if (!(selectedTestType === 'All' || row.testType === selectedTestType)) return false;
        const rowIso = toIsoDate(String(row.dateTime ?? row.date));
        if (startDate && rowIso && rowIso < startDate) return false;
        if (endDate && rowIso && rowIso > endDate) return false;
        return true;
      }),
    [metricRows, selectedTestType, startDate, endDate]
  );

  const filteredRows = useMemo(() => {
    if (pointMode !== 'max') return filteredRowsBase;
    const byDate = new Map<string, (typeof filteredRowsBase)[number]>();
    for (const row of filteredRowsBase) {
      const key = `${row.date}::${legDisplay === 'selected' ? row.testType : metricLeg(row.metricName) ?? row.testType}`;
      const current = byDate.get(key);
      if (!current || row.value > current.value) {
        byDate.set(key, row);
      }
    }
    return Array.from(byDate.values()).sort((a, b) => chartDateKey(a.date).localeCompare(chartDateKey(b.date)));
  }, [filteredRowsBase, legDisplay, pointMode]);

  const pointRows = useMemo(() => [...filteredRows], [filteredRows]);
  const chartDates = useMemo(
    () => Array.from(new Set(pointRows.map((row) => row.date))).sort((a, b) => chartDateKey(a).localeCompare(chartDateKey(b))),
    [pointRows]
  );
  const chartDateLabelIndexes = useMemo(() => {
    const maximumLabels = 8;
    if (chartDates.length <= maximumLabels) return new Set(chartDates.map((_, index) => index));
    return new Set(
      Array.from({ length: maximumLabels }, (_, index) =>
        Math.round((index / (maximumLabels - 1)) * (chartDates.length - 1))
      )
    );
  }, [chartDates]);
  const chartPoints = useMemo(() => {
    if (pointRows.length < 1) return [];
    const values = pointRows.map((row) => row.value);
    const range = valueRange(values, chartView === 'bar' ? 0.08 : 0);
    const sortedRows = [...pointRows].sort((a, b) => {
      const byDate = chartDateKey(a.date).localeCompare(chartDateKey(b.date));
      if (byDate !== 0) return byDate;
      const byType = a.testType.localeCompare(b.testType);
      if (byType !== 0) return byType;
      const byMetric = a.metricName.localeCompare(b.metricName);
      if (byMetric !== 0) return byMetric;
      return a.value - b.value;
    });
    const dateIndexMap = new Map(chartDates.map((date, index) => [date, index]));
    return sortedRows.map((row) => {
      const dateIndex = dateIndexMap.get(row.date) ?? 0;
      const x = chartXPosition(dateIndex, chartDates.length, chartView);
      const y = 196 - ((row.value - range.min) / (range.max - range.min)) * 156;
      const leg = metricLeg(row.metricName);
      const seriesKey = legDisplay === 'selected' || !leg ? row.testType : leg;
      return { x, y, value: row.value, date: row.date, testType: row.testType, metricUnit: row.metricUnit, metricName: row.metricName, leg, seriesKey };
    });
  }, [pointRows, chartDates, chartView, legDisplay]);
  const seriesByTestType = useMemo(() => {
    const types = Array.from(new Set(chartPoints.map((point) => point.seriesKey)));
    return types.map((type) => ({
      testType: type,
      label: type === 'left' ? 'Left' : type === 'right' ? 'Right' : type,
      points: chartPoints.filter((point) => point.seriesKey === type),
    }));
  }, [chartPoints]);
  const yScale = useMemo(() => {
    const values = filteredRows.map((row) => row.value);
    return values.length ? valueRange(values, chartView === 'bar' ? 0.08 : 0) : { min: 0, max: 1 };
  }, [filteredRows, chartView]);
  const yTicks = useMemo(() => {
    const { min, max } = yScale;
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const ratio = i / steps;
      const value = max - ratio * (max - min);
      const y = 40 + ratio * 156;
      return { y, value };
    });
  }, [yScale]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [playerColumns, setPlayerColumns] = useState<string[]>(['CMJ', 'CMJMax', 'SJ', 'SJMax', 'RSI', 'FBvelo', 'VeloMax']);
  const [playerColumnLabels, setPlayerColumnLabels] = useState<Record<string, string>>({});
  const [playerColumnMenuOpen, setPlayerColumnMenuOpen] = useState(false);
  const [playerColumnSearch, setPlayerColumnSearch] = useState('');
  const [playerSort, setPlayerSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'Date', dir: 'desc' });
  const [savedViews, setSavedViews] = useState<SavedTableView[]>([]);
  const [viewsLoading, setViewsLoading] = useState(true);
  const [viewSaveMessage, setViewSaveMessage] = useState('');
  const [viewSaving, setViewSaving] = useState(false);
  const [playerViewId, setPlayerViewId] = useState<number | null>(null);
  const [playerViewName, setPlayerViewName] = useState('Performance Snapshot');
  const [leaderViewId, setLeaderViewId] = useState<number | null>(null);
  const [leaderViewName, setLeaderViewName] = useState('Team Performance');
  const [leaderColumnLabels, setLeaderColumnLabels] = useState<Record<string, string>>({});
  const [leaderColumnSearch, setLeaderColumnSearch] = useState('');

  const testCount = new Set(filteredRows.map((row) => row.testId)).size;
  const selectedMetricLabel = (
    metricOptions.find((option) => option.key === (selectedMetricKey || defaultMetricKey))?.label ?? 'Select a metric'
  ).replace(/\s*•\s*\d+$/, '');
  const activeMetricLabel = legDisplay !== 'selected' && canSelectLegDisplay
    ? `${metricBaseName(activeMetricIdentity.name)}${activeMetricIdentity.unit ? ` (${activeMetricIdentity.unit})` : ''}`
    : selectedMetricLabel;

  useEffect(() => {
    if (!selectedPlayer || !activeMetricIdentity.name || loadingPlayer) return;
    let cancelled = false;
    // Deliberately no startDate/endDate -- see the fixed-panel percentile
    // fetch below for why percentiles ignore the active date filter.
    const params = new URLSearchParams({
      player: selectedPlayer,
      metricName: activeMetricIdentity.name,
      metricUnit: activeMetricIdentity.unit,
      groupId: percentileGroupId,
      testType: selectedTestType,
      mode: pointMode,
    });
    setPercentileLoading(true);
    setPercentileError('');
    void fetch(`/api/player/force-plate-percentiles?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as PercentileResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Could not calculate percentiles.');
        if (!cancelled) setPercentileData(payload);
      })
      .catch((error) => {
        if (!cancelled) {
          setPercentileData(null);
          setPercentileError(error instanceof Error ? error.message : 'Could not calculate percentiles.');
        }
      })
      .finally(() => {
        if (!cancelled) setPercentileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeMetricIdentity.name, activeMetricIdentity.unit, loadingPlayer, percentileGroupId, pointMode, selectedPlayer, selectedTestType]);

  useEffect(() => {
    if (!selectedPlayer || loadingPlayer || legDisplay === 'selected' || displayedMetricKeys.length < 1) {
      setLegPercentiles({});
      setLegPercentilesLoading(false);
      return;
    }
    let cancelled = false;
    setLegPercentilesLoading(true);
    void Promise.all(displayedMetricKeys.map(async (key) => {
      const identity = splitMetricKey(key);
      const params = new URLSearchParams({
        player: selectedPlayer,
        metricName: identity.name,
        metricUnit: identity.unit,
        groupId: percentileGroupId,
        testType: selectedTestType,
        mode: pointMode,
      });
      const response = await fetch(`/api/player/force-plate-percentiles?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as PercentileResponse & { error?: string };
      return [key, response.ok ? payload.stats?.latest : undefined] as const;
    })).then((entries) => {
      if (!cancelled) setLegPercentiles(Object.fromEntries(entries));
    }).finally(() => {
      if (!cancelled) setLegPercentilesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [displayedMetricKeys, legDisplay, loadingPlayer, percentileGroupId, pointMode, selectedPlayer, selectedTestType]);

  // Fixed athlete-summary panels (Jump Height, Peak Power/BM, RSI-Modified,
  // Eccentric Braking RFD/BM, Body Weight): each panel's percentile is fetched
  // independently of the top metric selector, reusing the same percentile
  // route with that panel's own fixed metric identity. Only the "latest" stat
  // is needed per panel (percentile of the athlete's most recent test).
  useEffect(() => {
    if (!selectedPlayer || loadingPlayer) return;
    let cancelled = false;
    setPanelPercentilesLoading(true);
    Promise.all(FIXED_PANEL_METRICS.map((panelMetric) => {
      // Deliberately no startDate/endDate: percentiles always compare against
      // each athlete's and the cohort's full history, not the currently
      // filtered date range -- a narrow filter shouldn't shrink the sample.
      const params = new URLSearchParams({
        player: selectedPlayer,
        metricName: panelMetric.name,
        metricUnit: panelMetric.unit,
        groupId: percentileGroupId,
        testType: selectedTestType,
        mode: pointMode,
      });
      return fetch(`/api/player/force-plate-percentiles?${params.toString()}`, { cache: 'no-store' })
        .then((response) => response.json())
        .then((payload: PercentileResponse & { error?: string }) => [panelMetric.label, payload?.stats?.latest] as const)
        .catch(() => [panelMetric.label, undefined] as const);
    })).then((entries) => {
      if (!cancelled) setPanelPercentiles(Object.fromEntries(entries));
    }).finally(() => {
      if (!cancelled) setPanelPercentilesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPlayer, loadingPlayer, percentileGroupId, selectedTestType, pointMode]);

  // Panel headline: average value on the athlete's most recent test date for
  // that metric (in range), converted to display units (e.g. kg -> lb for
  // Body Weight). Trend arrow compares that latest-date average against the
  // athlete's own average over the prior 30 days, excluding the latest test.
  const fixedPanels = useMemo(() => {
    if (!player) return [];
    return FIXED_PANEL_METRICS.map((panelMetric) => {
      const matching = player.metricRows.filter((row) =>
        row.metricName === panelMetric.name && row.metricUnit === panelMetric.unit && String(row.pointType ?? 'average') === 'average'
      );
      const values = matching.flatMap((row) => {
        if (selectedTestType !== 'All' && row.testType !== selectedTestType) return [];
        const iso = toIsoDate(String(row.dateTime ?? row.date));
        if (!iso) return [];
        if (startDate && iso < startDate) return [];
        if (endDate && iso > endDate) return [];
        return [{ date: iso, value: panelMetric.convert(row.value) }];
      }).sort((a, b) => a.date.localeCompare(b.date));

      const latestDate = values.at(-1)?.date ?? null;
      const latestAverage = latestDate ? mean(values.filter((entry) => entry.date === latestDate).map((entry) => entry.value)) : null;

      let trendPct: number | null = null;
      if (latestDate) {
        const cutoff = new Date(latestDate);
        cutoff.setDate(cutoff.getDate() - 30);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        const baseline = values.filter((entry) => entry.date < latestDate && entry.date >= cutoffStr).map((entry) => entry.value);
        const baselineAvg = mean(baseline);
        if (latestAverage !== null && baselineAvg !== null && baselineAvg !== 0) {
          trendPct = ((latestAverage - baselineAvg) / Math.abs(baselineAvg)) * 100;
        }
      }
      const favorable = trendPct !== null ? (panelMetric.lowerIsBetter ? trendPct < 0 : trendPct > 0) : null;
      return {
        label: panelMetric.label,
        unit: panelMetric.displayUnit,
        latestAverage,
        latestDate,
        trendPct,
        favorable,
        percentile: panelPercentiles[panelMetric.label],
      };
    });
  }, [player, selectedTestType, startDate, endDate, panelPercentiles]);

  const legPanels = useMemo(() => displayedMetricKeys.map((key) => {
    const identity = splitMetricKey(key);
    const leg = metricLeg(identity.name);
    const values = filteredRows
      .filter((row) => metricKey(row.metricName, row.metricUnit) === key)
      .map((row) => ({ date: toIsoDate(String(row.dateTime ?? row.date)), value: row.value }))
      .filter((row) => row.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    const latestDate = values.at(-1)?.date ?? null;
    const latestAverage = latestDate ? mean(values.filter((row) => row.date === latestDate).map((row) => row.value)) : null;
    let trendPct: number | null = null;
    if (latestDate && latestAverage !== null) {
      const cutoff = new Date(`${latestDate}T12:00:00Z`);
      cutoff.setUTCDate(cutoff.getUTCDate() - 30);
      const baseline = values.filter((row) => row.date < latestDate && row.date >= cutoff.toISOString().slice(0, 10)).map((row) => row.value);
      const baselineAverage = mean(baseline);
      if (baselineAverage !== null && baselineAverage !== 0) trendPct = ((latestAverage - baselineAverage) / Math.abs(baselineAverage)) * 100;
    }
    const lowerIsBetter = DURATION_UNITS.has(identity.unit.trim().toLowerCase());
    return {
      key,
      leg,
      label: `${legLabel(leg)} leg`,
      unit: forcePlateDisplayUnit(identity.unit),
      latestDate,
      latestAverage,
      trendPct,
      favorable: trendPct === null ? null : lowerIsBetter ? trendPct < 0 : trendPct > 0,
      percentile: legPercentiles[key],
    };
  }), [displayedMetricKeys, filteredRows, legPercentiles]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/player/force-plate-table-views', { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { items?: SavedTableView[]; error?: string };
        if (!response.ok) throw new Error(payload.error || 'Could not load saved tables.');
        if (!cancelled) {
          const rawItems = Array.isArray(payload.items) ? payload.items : [];
          const athleteJumpDashboard = rawItems.find(
            (view) => view.viewType === 'athlete' && view.name.trim().toLowerCase() === 'jump dashboard'
          );
          const leaderboardJumpDashboard = rawItems.find(
            (view) => view.viewType === 'leaderboard' && view.name.trim().toLowerCase() === 'jump dashboard'
          );
          const mirroredJumpDashboard = !leaderboardJumpDashboard && athleteJumpDashboard
            ? { ...athleteJumpDashboard, id: -athleteJumpDashboard.id, viewType: 'leaderboard' as const }
            : null;
          const items = mirroredJumpDashboard ? [...rawItems, mirroredJumpDashboard] : rawItems;
          setSavedViews(items);
          if (athleteJumpDashboard) {
            setPlayerViewId(athleteJumpDashboard.id);
            setPlayerViewName(athleteJumpDashboard.name);
            setPlayerColumns(athleteJumpDashboard.columns);
            setPlayerColumnLabels(athleteJumpDashboard.columnLabels ?? {});
          }
          const defaultLeaderboard = leaderboardJumpDashboard ?? mirroredJumpDashboard;
          if (defaultLeaderboard) {
            setLeaderViewId(defaultLeaderboard.id);
            setLeaderViewName(defaultLeaderboard.name);
            setLeaderColumns(defaultLeaderboard.columns);
            setLeaderColumnLabels(defaultLeaderboard.columnLabels ?? {});
            setLeaderSort({ key: defaultLeaderboard.columns[0] ?? 'Player', dir: 'desc' });
          }
        }
      })
      .catch((error) => {
        if (!cancelled) setViewSaveMessage(error instanceof Error ? error.message : 'Could not load saved tables.');
      })
      .finally(() => {
        if (!cancelled) setViewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chooseSavedView = (viewType: 'athlete' | 'leaderboard', value: string) => {
    if (value === 'new') {
      if (viewType === 'athlete') {
        setPlayerViewId(null);
        setPlayerViewName('');
        setPlayerColumnLabels({});
      } else {
        setLeaderViewId(null);
        setLeaderViewName('');
        setLeaderColumnLabels({});
      }
      setViewSaveMessage('New table ready. Name it, choose columns, and save.');
      return;
    }
    const found = savedViews.find((view) => view.id === Number(value) && view.viewType === viewType);
    if (!found) return;
    if (viewType === 'athlete') {
      setPlayerViewId(found.id);
      setPlayerViewName(found.name);
      setPlayerColumns(found.columns);
      setPlayerColumnLabels(found.columnLabels ?? {});
    } else {
      setLeaderViewId(found.id);
      setLeaderViewName(found.name);
      setLeaderColumns(found.columns);
      setLeaderColumnLabels(found.columnLabels ?? {});
      setLeaderSort({ key: found.columns[0] ?? 'Player', dir: 'desc' });
    }
    setViewSaveMessage('');
  };

  const saveTableView = async (viewType: 'athlete' | 'leaderboard') => {
    const name = (viewType === 'athlete' ? playerViewName : leaderViewName).trim();
    const columns = viewType === 'athlete' ? playerColumns : leaderColumns;
    const columnLabels = viewType === 'athlete' ? playerColumnLabels : leaderColumnLabels;
    const selectedId = viewType === 'athlete' ? playerViewId : leaderViewId;
    const id = selectedId && selectedId > 0 ? selectedId : null;
    if (!name || !columns.length) {
      setViewSaveMessage('Enter a table name and select at least one column.');
      return;
    }
    setViewSaving(true);
    setViewSaveMessage('');
    try {
      const response = await fetch('/api/player/force-plate-table-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id ?? undefined, viewType, name, columns, columnLabels }),
      });
      const payload = (await response.json().catch(() => ({}))) as { item?: SavedTableView; error?: string };
      if (!response.ok || !payload.item) throw new Error(payload.error || 'Could not save the table.');
      const saved = payload.item;
      setSavedViews((current) => [
        saved,
        ...current.filter((view) => (
          view.id !== saved.id
          && !(view.id < 0 && view.viewType === saved.viewType && view.name.trim().toLowerCase() === saved.name.trim().toLowerCase())
        )),
      ]);
      if (viewType === 'athlete') {
        setPlayerViewId(saved.id);
        setPlayerViewName(saved.name);
        setPlayerColumnLabels(saved.columnLabels ?? {});
      } else {
        setLeaderViewId(saved.id);
        setLeaderViewName(saved.name);
        setLeaderColumnLabels(saved.columnLabels ?? {});
      }
      setViewSaveMessage(`${saved.name} saved.`);
    } catch (error) {
      setViewSaveMessage(error instanceof Error ? error.message : 'Could not save the table.');
    } finally {
      setViewSaving(false);
    }
  };

  const deleteTableView = async (viewType: 'athlete' | 'leaderboard') => {
    const id = viewType === 'athlete' ? playerViewId : leaderViewId;
    if (!id || id < 1) return;
    setViewSaving(true);
    setViewSaveMessage('');
    try {
      const response = await fetch(`/api/player/force-plate-table-views?id=${id}`, { method: 'DELETE' });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not delete the table.');
      setSavedViews((current) => current.filter((view) => view.id !== id));
      if (viewType === 'athlete') {
        setPlayerViewId(null);
        setPlayerViewName('Performance Snapshot');
        setPlayerColumnLabels({});
      } else {
        setLeaderViewId(null);
        setLeaderViewName('Team Performance');
        setLeaderColumnLabels({});
      }
      setViewSaveMessage('Saved table deleted.');
    } catch (error) {
      setViewSaveMessage(error instanceof Error ? error.message : 'Could not delete the table.');
    } finally {
      setViewSaving(false);
    }
  };

  const setPlayerDatePreset = (days: number | null) => {
    if (!playerDateBounds.max) return;
    const end = playerDateBounds.max;
    if (days === null) {
      setDateRangeByPlayer((current) => ({ ...current, [selectedPlayer]: { start: playerDateBounds.min, end } }));
      return;
    }
    const endDateValue = new Date(`${end}T12:00:00Z`);
    endDateValue.setUTCDate(endDateValue.getUTCDate() - Math.max(0, days - 1));
    const start = endDateValue.toISOString().slice(0, 10);
    setDateRangeByPlayer((current) => ({
      ...current,
      [selectedPlayer]: { start: start < playerDateBounds.min ? playerDateBounds.min : start, end },
    }));
  };

  useEffect(() => {
    if (!leaderStartDate && leaderboardBounds.min) setLeaderStartDate(leaderboardBounds.min);
    if (!leaderEndDate && leaderboardBounds.max) setLeaderEndDate(leaderboardBounds.max);
  }, [leaderStartDate, leaderEndDate, leaderboardBounds.min, leaderboardBounds.max]);

  const leaderboardMetricOptions = useMemo(() => {
    return [
      ...BASE_TABLE_OPTIONS,
      ...leaderMetricOptions,
    ];
  }, [leaderMetricOptions]);
  const visibleLeaderTestOptions = useMemo(() => {
    const options = ['All', ...leaderTestOptions];
    const query = leaderTestSearch.trim().toLowerCase();
    return query
      ? options.filter((option) => option === leaderTestType || option.toLowerCase().includes(query))
      : options;
  }, [leaderTestOptions, leaderTestSearch, leaderTestType]);

  const playerTableMetricOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string }>();
    for (const row of player?.metricRows ?? []) {
      const key = metricKey(row.metricName, row.metricUnit);
      if (!map.has(key)) map.set(key, { key: `metric:${key}`, label: `${row.metricName}${row.metricUnit ? ` (${row.metricUnit})` : ''}` });
    }
    return [...BASE_TABLE_OPTIONS, ...Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))];
  }, [player]);

  useEffect(() => {
    if (activeTab !== 'leaderboard') return;
    let cancelled = false;
    setLeaderboardLoading(true);
    setLeaderboardError('');
    const params = new URLSearchParams();
    if (leaderStartDate) params.set('startDate', leaderStartDate);
    if (leaderEndDate) params.set('endDate', leaderEndDate);
    if (leaderTestType !== 'All') params.set('testType', leaderTestType);
    void fetch(`/api/player/force-plate-leaderboard?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          rows?: ForcePlateLeaderboardRow[];
          metricOptions?: Array<{ key: string; label: string }>;
          testOptions?: string[];
          minDate?: string;
          maxDate?: string;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || 'Could not load leaderboard data.');
        if (cancelled) return;
        setLeaderForceRows(Array.isArray(payload.rows) ? payload.rows : []);
        setLeaderMetricOptions(Array.isArray(payload.metricOptions) ? payload.metricOptions : []);
        const nextTestOptions = Array.isArray(payload.testOptions) ? payload.testOptions : [];
        setLeaderTestOptions(nextTestOptions);
        if (leaderTestType !== 'All' && !nextTestOptions.includes(leaderTestType)) setLeaderTestType('All');
        setLeaderboardBounds({ min: payload.minDate ?? '', max: payload.maxDate ?? '' });
      })
      .catch((error) => {
        if (!cancelled) setLeaderboardError(error instanceof Error ? error.message : 'Could not load leaderboard data.');
      })
      .finally(() => {
        if (!cancelled) setLeaderboardLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, leaderStartDate, leaderEndDate, leaderTestType]);

  useEffect(() => {
    const velocityStartDate = activeTab === 'player' ? startDate : leaderStartDate;
    const velocityEndDate = activeTab === 'player' ? endDate : leaderEndDate;
    if (!velocityStartDate || !velocityEndDate) return;
    let cancelled = false;
    const loadVelocity = async () => {
      try {
        const params = new URLSearchParams({ startDate: velocityStartDate, endDate: velocityEndDate });
        const response = await fetch(`/api/player/force-plate-velo?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as {
          rows?: Array<{ name: string; fbVelo: number | null; veloMax: number | null }>;
        };
        if (!response.ok) throw new Error('Failed');
        if (cancelled) return;
        setLeaderVelocityRows(Array.isArray(payload.rows) ? payload.rows : []);
      } catch {
        if (cancelled) return;
        setLeaderVelocityRows([]);
      }
    };
    void loadVelocity();
    return () => {
      cancelled = true;
    };
  }, [activeTab, startDate, endDate, leaderStartDate, leaderEndDate]);

  const resolveVeloForPlayer = (
    playerName: string,
    rows: Array<{ name: string; fbVelo: number | null; veloMax: number | null }>
  ): { fbVelo: number | null; veloMax: number | null } => {
    const exact = rows.find((row) => normalizeName(row.name) === normalizeName(playerName));
    if (exact) return { fbVelo: exact.fbVelo, veloMax: exact.veloMax };
    const targetTokens = normalizeName(playerName).split(' ').filter(Boolean);
    if (!targetTokens.length) return { fbVelo: null, veloMax: null };
    const targetLast = targetTokens[targetTokens.length - 1];
    const fuzzy = rows.find((row) => {
      const rowNorm = normalizeName(row.name);
      if (!rowNorm) return false;
      const rowTokens = rowNorm.split(' ').filter(Boolean);
      const rowLast = rowTokens[rowTokens.length - 1];
      if (!rowLast || rowLast !== targetLast) return false;
      return rowNorm.includes(targetTokens[0]) || normalizeName(playerName).includes(rowTokens[0] ?? '');
    });
    return fuzzy ? { fbVelo: fuzzy.fbVelo, veloMax: fuzzy.veloMax } : { fbVelo: null, veloMax: null };
  };

  const leaderboardRows = useMemo(() => leaderForceRows.map((row) => {
    const velo = resolveVeloForPlayer(row.playerName, leaderVelocityRows);
    return { ...row, fbVelo: velo.fbVelo, veloMax: velo.veloMax };
  }), [leaderForceRows, leaderVelocityRows]);

  const playerDateRows = useMemo(() => {
    if (!player) return [];
    const rangedAll = player.metricRows.filter((row) => {
      if (String(row.pointType ?? 'average') !== 'average') return false;
      if (selectedTestType !== 'All' && row.testType !== selectedTestType) return false;
      const iso = toIsoDate(String(row.dateTime ?? row.date));
      if (startDate && iso && iso < startDate) return false;
      if (endDate && iso && iso > endDate) return false;
      return true;
    });
    const byDate = new Map<string, typeof rangedAll>();
    for (const row of rangedAll) {
      const date = toIsoDate(String(row.dateTime ?? row.date)) || String(row.date ?? '');
      if (!date) continue;
      const current = byDate.get(date) ?? [];
      current.push(row);
      byDate.set(date, current);
    }
    return Array.from(byDate.entries()).map(([date, rows]) => {
      const byMetric = new Map<string, number[]>();
      for (const row of rows) {
        const key = metricKey(row.metricName, row.metricUnit);
        const values = byMetric.get(key) ?? [];
        values.push(row.value);
        byMetric.set(key, values);
      }
      const metricAverages = Object.fromEntries(
        Array.from(byMetric.entries()).map(([key, values]) => [key, mean(values)])
      ) as Record<string, number | null>;
      const cmjStats = computeJumpStats(rows, isCmjType);
      const sjStats = computeJumpStats(rows, isSjType);
      const sqStats = computeJumpStats(rows, isSqType);
      const rsiValues = rows
        .filter((row) => String(row.metricName ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').includes('rsimodified'))
        .map((row) => row.value);
      return {
        date,
        cmj: cmjStats.average,
        sj: sjStats.average,
        cmjMax: cmjStats.max,
        sjMax: sjStats.max,
        rsiModified: mean(rsiValues),
        sq: sqStats.average,
        metricAverages,
        fbVelo: null as number | null,
        veloMax: null as number | null,
      };
    });
  }, [player, selectedTestType, startDate, endDate]);

  const sortedPlayerDateRows = useMemo(() => {
    const valueFor = (row: (typeof playerDateRows)[number], column: string): number | string | null => {
      if (column === 'Date') return row.date;
      if (column === 'CMJ') return row.cmj;
      if (column === 'SJ') return row.sj;
      if (column === 'CMJMax') return row.cmjMax;
      if (column === 'SJMax') return row.sjMax;
      if (column === 'RSI') return row.rsiModified;
      if (column === 'SQ') return row.sq;
      if (column === 'FBvelo') return row.fbVelo;
      if (column === 'VeloMax') return row.veloMax;
      if (column.startsWith('metric:')) return row.metricAverages[column.slice('metric:'.length)] ?? null;
      return null;
    };
    return [...playerDateRows].sort((a, b) => {
      const aValue = valueFor(a, playerSort.key);
      const bValue = valueFor(b, playerSort.key);
      if (typeof aValue === 'string' || typeof bValue === 'string') {
        const comparison = String(aValue ?? '').localeCompare(String(bValue ?? ''));
        return playerSort.dir === 'asc' ? comparison : -comparison;
      }
      const aNumber = typeof aValue === 'number' ? aValue : Number.NEGATIVE_INFINITY;
      const bNumber = typeof bValue === 'number' ? bValue : Number.NEGATIVE_INFINITY;
      return playerSort.dir === 'asc' ? aNumber - bNumber : bNumber - aNumber;
    });
  }, [playerDateRows, playerSort]);

  const sortedLeaderboardRows = useMemo(() => {
    const valueFor = (row: (typeof leaderboardRows)[number], column: string): number | string | null => {
      if (column === 'Player') return row.playerName;
      return leaderboardValue(row, column);
    };
    const sorted = [...leaderboardRows].sort((a, b) => {
      const av = valueFor(a, leaderSort.key);
      const bv = valueFor(b, leaderSort.key);
      if (typeof av === 'string' || typeof bv === 'string') {
        const aText = String(av ?? '');
        const bText = String(bv ?? '');
        const cmp = aText.localeCompare(bText);
        return leaderSort.dir === 'asc' ? cmp : -cmp;
      }
      const aNum = typeof av === 'number' ? av : Number.NEGATIVE_INFINITY;
      const bNum = typeof bv === 'number' ? bv : Number.NEGATIVE_INFINITY;
      const cmp = aNum - bNum;
      return leaderSort.dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [leaderSort, leaderboardRows]);

  const leaderboardPercentiles = useMemo(() => {
    const result = new Map<string, Map<string, number>>();
    for (const column of leaderColumns) {
      const invert = isLowerBetterColumn(column);
      const values = leaderboardRows
        .map((row) => leaderboardValue(row, column))
        .filter((value): value is number => value !== null && Number.isFinite(value));
      const byPlayer = new Map<string, number>();
      for (const row of leaderboardRows) {
        const value = leaderboardValue(row, column);
        if (value !== null && Number.isFinite(value)) byPlayer.set(row.playerName, percentileRank(value, values, invert));
      }
      result.set(column, byPlayer);
    }
    return result;
  }, [leaderColumns, leaderboardRows]);

  const correlationMetrics = useMemo(() => {
    const seenLabels = new Set<string>();
    return leaderboardMetricOptions.flatMap((option) => {
      const label = tableColumnLabel(option.key, leaderboardMetricOptions, leaderColumnLabels);
      if (!label || seenLabels.has(label)) return [];
      seenLabels.add(label);
      return [{ key: option.key, label }];
    });
  }, [leaderboardMetricOptions, leaderColumnLabels]);

  const correlationAxisColumns = useMemo(
    () => correlationMetrics.map((metric) => metric.label),
    [correlationMetrics]
  );
  const correlationColumns = useMemo(() => ['Player', ...correlationAxisColumns], [correlationAxisColumns]);

  const correlationRows = useMemo(() => {
    return leaderboardRows.map((row) => {
      const out: Record<string, string | number | null> = { Player: row.playerName };
      for (const metric of correlationMetrics) {
        out[metric.label] = leaderboardValue(row, metric.key);
      }
      return out;
    });
  }, [leaderboardRows, correlationMetrics]);

  const playerExportHeaders = useMemo(
    () => ['Date', ...playerColumns.map((column) => tableColumnLabel(column, playerTableMetricOptions, playerColumnLabels))],
    [playerColumnLabels, playerColumns, playerTableMetricOptions]
  );
  const playerExportRows = useMemo<ExportCell[][]>(() => sortedPlayerDateRows.map((row) => [
    displayDate(row.date),
    ...playerColumns.map((column) => {
      let value: number | null = null;
      if (column === 'CMJ') value = row.cmj;
      else if (column === 'SJ') value = row.sj;
      else if (column === 'CMJMax') value = row.cmjMax;
      else if (column === 'SJMax') value = row.sjMax;
      else if (column === 'RSI') value = row.rsiModified;
      else if (column === 'SQ') value = row.sq;
      else if (column === 'FBvelo') value = row.fbVelo;
      else if (column === 'VeloMax') value = row.veloMax;
      else if (column.startsWith('metric:')) value = row.metricAverages[column.slice('metric:'.length)] ?? null;
      return value === null ? null : value.toFixed(1);
    }),
  ]), [playerColumns, sortedPlayerDateRows]);
  const leaderExportHeaders = useMemo(
    () => [
      'Player',
      ...leaderColumns.map((column) => {
        const label = tableColumnLabel(column, leaderboardMetricOptions, leaderColumnLabels);
        return leaderDisplayMode === 'percentile' ? `${label} Percentile` : leaderDisplayMode === 'both' ? `${label} (Value + Percentile)` : label;
      }),
    ],
    [leaderColumnLabels, leaderColumns, leaderboardMetricOptions, leaderDisplayMode]
  );
  const leaderExportRows = useMemo<ExportCell[][]>(() => sortedLeaderboardRows.map((row) => [
    row.playerName,
    ...leaderColumns.map((column) => {
      const value = leaderboardValue(row, column);
      const percentile = leaderboardPercentiles.get(column)?.get(row.playerName) ?? null;
      if (leaderDisplayMode === 'percentile') return percentile;
      if (leaderDisplayMode === 'both') return value === null ? null : `${value.toFixed(1)}${percentile === null ? '' : ` (${ordinal(percentile)})`}`;
      return value === null ? null : value.toFixed(1);
    }),
  ]), [leaderColumns, leaderboardPercentiles, leaderDisplayMode, sortedLeaderboardRows]);

  const playerExportBaseName = safeFileName(`${selectedPlayer}-${playerViewName || 'force-plate-table'}-${endDate || 'all-dates'}`);
  const leaderExportBaseName = safeFileName(`${leaderViewName || 'force-plate-leaderboard'}-${leaderTestType}-${leaderEndDate || 'all-dates'}`);
  const playerExportDetail = `${selectedTestType === 'All' ? 'All tests' : selectedTestType}  ·  ${startDate || 'First test'} to ${endDate || 'Latest test'}  ·  ${playerExportRows.length} dates`;
  const leaderDisplayModeLabel = leaderDisplayMode === 'percentile' ? 'Percentile ranks' : leaderDisplayMode === 'both' ? 'Values + percentiles' : 'Metric values';
  const leaderExportDetail = `${leaderTestType === 'All' ? 'All tests' : leaderTestType}  ·  ${leaderStartDate || 'First test'} to ${leaderEndDate || 'Latest test'}  ·  ${leaderDisplayModeLabel}  ·  ${leaderExportRows.length} athletes`;

  return (
    <div className={`${styles.workspace} portal-admin-stack`}>
      <section className={styles.commandBar}>
        <div>
          <p className={styles.eyebrow}>PERFORMANCE LAB</p>
          <div className={styles.contextLine}>
            <strong>{activeTab === 'player' ? selectedPlayer : 'Organization leaderboard'}</strong>
            <span aria-hidden="true">/</span>
            <span>{activeTab === 'player' ? activeMetricLabel : `${leaderboardRows.length} athletes with data`}</span>
          </div>
        </div>
        <div className={styles.viewSwitch} role="group" aria-label="Force plate view">
          <button
            type="button"
            className={activeTab === 'player' ? styles.activeView : styles.inactiveView}
            onClick={() => setActiveTab('player')}
          >
            Athlete Analysis
          </button>
          <button
            type="button"
            className={activeTab === 'leaderboard' ? styles.activeView : styles.inactiveView}
            onClick={() => setActiveTab('leaderboard')}
          >
            Leaderboard
          </button>
        </div>
      </section>

      {activeTab === 'player' ? (
      <section className={styles.filterDeck}>
        <div className={styles.filterHeader}>
          <div>
            <p className={styles.sectionIndex}>01 · BUILD THE VIEW</p>
            <h3>Analysis controls</h3>
          </div>
          <div className={styles.presets} aria-label="Date range presets">
            <button type="button" onClick={() => setPlayerDatePreset(30)}>30D</button>
            <button type="button" onClick={() => setPlayerDatePreset(90)}>90D</button>
            <button type="button" onClick={() => setPlayerDatePreset(180)}>6M</button>
            <button type="button" onClick={() => setPlayerDatePreset(null)}>ALL</button>
          </div>
        </div>
        <div className={styles.primaryFilters}>
          <div className={styles.playerField}>
            <span>Athlete</span>
            <div className={styles.metricPicker}>
              <button
                type="button"
                aria-expanded={athletePickerOpen}
                onClick={() => {
                  setAthletePickerOpen((current) => !current);
                  setMetricPickerOpen(false);
                }}
              >
                <span>{selectedPlayer || 'Select an athlete'}</span>
                <b aria-hidden="true">⌄</b>
              </button>
              {athletePickerOpen ? (
                <div className={`${styles.metricMenu} ${styles.athleteMenu}`}>
                  <input
                    type="search"
                    autoFocus
                    value={athleteSearch}
                    placeholder="Search athletes…"
                    onChange={(event) => setAthleteSearch(event.target.value)}
                  />
                  <div className={styles.metricMenuList}>
                    {visiblePlayers.length ? visiblePlayers.map((entry) => (
                      <button
                        type="button"
                        key={entry.playerName}
                        className={entry.playerName === selectedPlayer ? styles.metricOptionActive : undefined}
                        onClick={() => {
                          setSelectedPlayer(entry.playerName);
                          setAthleteSearch('');
                          setAthletePickerOpen(false);
                        }}
                      >
                        {entry.playerName}
                      </button>
                    )) : <p>No athletes match that search.</p>}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className={styles.metricField}>
            <span>Metric</span>
            <div className={styles.metricPicker}>
              <button
                type="button"
                onClick={() => {
                  setMetricPickerOpen((current) => !current);
                  setAthletePickerOpen(false);
                }}
                aria-expanded={metricPickerOpen}
              >
                <span>{activeMetricLabel}</span>
                <b aria-hidden="true">⌄</b>
              </button>
              {metricPickerOpen ? (
                <div className={styles.metricMenu}>
                  <input
                    type="search"
                    autoFocus
                    value={metricSearch}
                    placeholder="Search jump, force, asymmetry…"
                    onChange={(event) => setMetricSearch(event.target.value)}
                  />
                  <div className={styles.metricMenuList}>
                    {visibleMetricOptions.length ? visibleMetricOptions.map((option) => (
                      <button
                        type="button"
                        key={option.key}
                        className={option.key === (selectedMetricKey || defaultMetricKey) ? styles.metricOptionActive : undefined}
                        onClick={() => {
                          setSelectedMetricKey(option.key);
                          setMetricSearch('');
                          setMetricPickerOpen(false);
                        }}
                      >
                        {option.label}
                      </button>
                    )) : <p>No metrics match that search.</p>}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className={styles.secondaryFilters}>
          <label>
            <span>Chart</span>
            <select value={chartView} onChange={(event) => setChartView(event.target.value === 'bar' ? 'bar' : 'line')}>
              <option value="line">Line graph</option>
              <option value="bar">Bar graph</option>
            </select>
          </label>
          <label>
            <span>Display</span>
            <select
              value={pointMode}
              onChange={(event) => setPointMode(event.target.value === 'max' ? 'max' : 'average')}
            >
              <option value="average">Average by Test</option>
              <option value="max">Max by Date</option>
            </select>
          </label>
          <label>
            <span>Test type</span>
            <select value={selectedTestType} onChange={(event) => { setTestTypeTouched(true); setSelectedTestType(event.target.value); }}>
              {testTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {normalizeTestType(option) === 'SLJ' ? 'SLJ · Single Leg Jump' : option}
                </option>
              ))}
            </select>
          </label>
          {canSelectLegDisplay ? (
            <label>
              <span>Leg display</span>
              <select value={legDisplay} onChange={(event) => setLegDisplay(event.target.value as ForcePlateLegDisplay)}>
                <option value="selected">Selected metric</option>
                {availableLegMetricKeys.some((key) => metricLeg(splitMetricKey(key).name) === 'left') ? <option value="left">Left leg</option> : null}
                {availableLegMetricKeys.some((key) => metricLeg(splitMetricKey(key).name) === 'right') ? <option value="right">Right leg</option> : null}
                {availableLegMetricKeys.length > 1 ? <option value="both">Left + Right</option> : null}
              </select>
            </label>
          ) : null}
          <label>
            <span>Percentile group</span>
            <select value={percentileGroupId} onChange={(event) => setPercentileGroupId(event.target.value)}>
              <option value="all">All</option>
              {(percentileData?.groups ?? []).map((group) => (
                <option key={group.id} value={group.id}>{group.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>From</span>
            <input
              type="date"
              value={startDate}
              min={playerDateBounds.min || undefined}
              max={endDate || playerDateBounds.max || undefined}
              onChange={(event) =>
                setDateRangeByPlayer((current) => ({
                  ...current,
                  [selectedPlayer]: { start: event.target.value, end: endDate },
                }))
              }
            />
          </label>
          <label>
            <span>Through</span>
            <input
              type="date"
              value={endDate}
              min={startDate || playerDateBounds.min || undefined}
              max={playerDateBounds.max || undefined}
              onChange={(event) =>
                setDateRangeByPlayer((current) => ({
                  ...current,
                  [selectedPlayer]: { start: startDate, end: event.target.value },
                }))
              }
            />
          </label>
        </div>
        {percentileError ? <p className={styles.filterError}>{percentileError}</p> : null}
      </section>
      ) : null}

      {activeTab === 'player' && (loadingPlayer || playerLoadError) ? (
        <article className="portal-admin-card">
          <p className={playerLoadError ? 'auth-error' : 'portal-muted-text'} style={{ margin: 0 }}>
            {playerLoadError || `Loading ${selectedPlayer} force plate data...`}
          </p>
        </article>
      ) : null}

      {activeTab === 'player' ? (
      <section className={styles.analysisPanel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.sectionIndex}>02 · PERFORMANCE SIGNAL</p>
            <h3>Exercise summary</h3>
            <p>Average value for the latest test date, this date range · vs. last session&apos;s 30-day trend</p>
          </div>
        </div>
        <div className={styles.kpiGrid}>
          {(legDisplay !== 'selected' && canSelectLegDisplay ? legPanels : fixedPanels).map((panel) => (
            <div key={'key' in panel ? panel.key : panel.label} className={styles.kpiCard}>
              <div className={styles.kpiLabelRow}>
                <span>{panel.label}</span>
                <PercentileBadge stat={panel.percentile} loading={legDisplay !== 'selected' && canSelectLegDisplay ? legPercentilesLoading : panelPercentilesLoading} />
              </div>
              <strong>
                {panel.latestAverage === null ? '—' : panel.latestAverage.toFixed(1)}
              </strong>
              <small>
                {panel.unit ? `${panel.unit} · ` : ''}{panel.latestDate || 'No date'}
              </small>
              {panel.trendPct !== null ? (
                <small className={panel.favorable ? styles.positive : styles.negative}>
                  {panel.favorable ? '▲' : '▼'} {Math.abs(panel.trendPct).toFixed(1)}% vs. 30-day avg
                </small>
              ) : null}
            </div>
          ))}
        </div>

        <div className={styles.panelHeading}>
          <div>
            <p className={styles.sectionIndex}>03 · TREND</p>
            <h3>{activeMetricLabel}</h3>
            <p>{selectedTestType === 'All' ? 'All qualifying test types' : selectedTestType} · {startDate || 'First test'} to {endDate || 'Latest test'}</p>
          </div>
          <span className={styles.liveBadge}><i /> {testCount} tests</span>
        </div>
        {chartPoints.length > 0 ? (
          <div className={styles.chartLayout} style={{ gridTemplateColumns: seriesByTestType.length > 1 ? 'minmax(0, 1fr) 180px' : '1fr' }}>
            <div className={styles.chartCanvas}>
            <svg viewBox="0 0 560 232" width="100%" height="320" role="img" aria-label="Metric trend chart" className="portal-force-plate-chart">
              <rect x="0" y="0" width="560" height="232" fill="transparent" rx="10" />
              <line x1="56" y1="196" x2="532" y2="196" stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
              <line x1="56" y1="20" x2="56" y2="196" stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
              {chartDates.map((date, index) => {
                if (!chartDateLabelIndexes.has(index)) return null;
                const x = chartXPosition(index, chartDates.length, chartView);
                return (
                  <text
                    key={`x-date-${date}-${index}`}
                    className="portal-force-plate-chart-edge-date"
                    x={x}
                    y={208}
                    fill="rgba(203,213,225,0.8)"
                    fontSize="8"
                    textAnchor="middle"
                  >
                    {date}
                  </text>
                );
              })}
              {yTicks.map((tick, idx) => (
                <g key={`y-tick-${idx}`}>
                  <line x1="56" y1={tick.y} x2="532" y2={tick.y} stroke="rgba(148,163,184,0.14)" strokeWidth="1" />
                  <text className="portal-force-plate-chart-tick" x="52" y={tick.y + 3} fill="rgba(203,213,225,0.88)" fontSize="9" textAnchor="end">
                    {tick.value.toFixed(1)}
                  </text>
                </g>
              ))}
              <text className="portal-force-plate-chart-axis-label" x="294" y="224" fill="rgba(203,213,225,0.9)" fontSize="10" textAnchor="middle">
                Date
              </text>
              <text className="portal-force-plate-chart-axis-label" x="14" y="108" fill="rgba(203,213,225,0.9)" fontSize="10" textAnchor="middle" transform="rotate(-90, 14, 108)">
                Value
              </text>
              {chartView === 'line' ? seriesByTestType.map((series, index) =>
                series.points.length > 1 ? (
                  <path key={`series-${series.testType}`} d={chartPath(series.points)} fill="none" stroke={testTypeColor(index)} strokeWidth="2.5" />
                ) : null
              ) : null}
              {chartPoints.map((point, index) => {
                const seriesIndex = Math.max(0, seriesByTestType.findIndex((series) => series.testType === point.seriesKey));
                if (chartView === 'bar') {
                  const seriesCount = Math.max(1, seriesByTestType.length);
                  const slotWidth = Math.min(38, 420 / Math.max(1, chartDates.length));
                  const barWidth = Math.max(3, (slotWidth - 3) / seriesCount);
                  const groupWidth = barWidth * seriesCount;
                  const groupStart = point.x - groupWidth / 2;
                  const x = groupStart + seriesIndex * barWidth;
                  return <rect key={`${point.date}-${index}`} x={x} y={point.y} width={barWidth} height={196 - point.y} rx="1.5" fill={testTypeColor(seriesIndex)} opacity={hoverIndex === index ? 1 : 0.84} onMouseEnter={() => setHoverIndex(index)} onMouseLeave={() => setHoverIndex((current) => (current === index ? null : current))} />;
                }
                return <circle key={`${point.date}-${index}`} cx={point.x} cy={point.y} r={hoverIndex === index ? '5' : '3.5'} fill={testTypeColor(seriesIndex)} onMouseEnter={() => setHoverIndex(index)} onMouseLeave={() => setHoverIndex((current) => (current === index ? null : current))} />;
              })}
              {hoverIndex !== null && chartPoints[hoverIndex] ? (
                (() => {
                  const point = chartPoints[hoverIndex];
                  const tooltipX = Math.min(410, Math.max(80, point.x + 12));
                  const tooltipY = Math.max(18, point.y - 58);
                  const displayUnit = forcePlateDisplayUnit(point.metricUnit);
                  const valueText = `${point.value.toFixed(1)}${displayUnit ? ` ${displayUnit}` : ''}`;
                  return (
                    <g>
                      <rect x={tooltipX} y={tooltipY} width="140" height="46" rx="7" fill="rgba(15,23,42,0.95)" stroke="rgba(59,130,246,0.5)" strokeWidth="1" />
                      <text x={tooltipX + 8} y={tooltipY + 13} fill="#e2e8f0" fontSize="9">
                        {selectedPlayer}
                      </text>
                      <text x={tooltipX + 8} y={tooltipY + 26} fill="#cbd5e1" fontSize="9">
                        {point.date}{point.leg ? ` · ${legLabel(point.leg)}` : ''}
                      </text>
                      <text x={tooltipX + 8} y={tooltipY + 39} fill="#7dd3fc" fontSize="9">
                        {valueText}
                      </text>
                    </g>
                  );
                })()
              ) : null}
            </svg>
            </div>
            {seriesByTestType.length > 1 ? (
              <div className={styles.legend}>
                <span>{legDisplay !== 'selected' && canSelectLegDisplay ? 'Leg series' : 'Test series'}</span>
                {seriesByTestType.map((series, index) => (
                  <div key={`legend-${series.testType}`}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: testTypeColor(index), display: 'inline-block' }} />
                    <span className="portal-force-plate-chart-legend-text" style={{ color: 'rgba(226,232,240,0.92)', fontSize: 12 }}>{series.label}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className={styles.emptyChart}>
            Not enough metric values for a trend line yet.
          </div>
        )}
      </section>
      ) : null}

      {activeTab === 'player' ? (
      <section className={styles.summaryPanel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.sectionIndex}>03 · CUSTOM SNAPSHOT</p>
            <h3>{playerViewName || 'New athlete table'}</h3>
            <p>One row per testing date inside the active date range. Every selected metric is calculated independently.</p>
          </div>
          <TableExportMenu
            disabled={!playerExportRows.length || !playerColumns.length}
            onCsv={() => downloadCsv(playerExportHeaders, playerExportRows, `${playerExportBaseName}.csv`)}
            onPdf={() => downloadTablePdf({
              title: playerViewName || 'Force Plate Athlete Table',
              subtitle: selectedPlayer,
              detail: playerExportDetail,
              headers: playerExportHeaders,
              rows: playerExportRows,
              fileName: `${playerExportBaseName}.pdf`,
            })}
          />
        </div>
        <SavedViewControls
          viewType="athlete"
          savedViews={savedViews}
          selectedId={playerViewId}
          name={playerViewName}
          columnCount={playerColumns.length}
          canManage={canManageViews}
          loading={viewsLoading}
          saving={viewSaving}
          message={activeTab === 'player' ? viewSaveMessage : ''}
          onSelect={(value) => chooseSavedView('athlete', value)}
          onNameChange={setPlayerViewName}
          onNew={() => chooseSavedView('athlete', 'new')}
          onColumns={() => setPlayerColumnMenuOpen((current) => !current)}
          onSave={() => void saveTableView('athlete')}
          onDelete={() => void deleteTableView('athlete')}
        />
        {playerColumnMenuOpen ? (
          <ColumnEditor
            options={playerTableMetricOptions}
            columns={playerColumns}
            labels={playerColumnLabels}
            search={playerColumnSearch}
            onSearchChange={setPlayerColumnSearch}
            onColumnsChange={setPlayerColumns}
            onLabelsChange={setPlayerColumnLabels}
          />
        ) : null}
        {sortedPlayerDateRows.length ? (
          <div className="portal-table-wrap">
            <table className="portal-table">
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    background: playerSort.key === 'Date' ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : undefined,
                    color: playerSort.key === 'Date' ? '#fff' : undefined,
                  }}
                  onClick={() => setPlayerSort((current) => ({ key: 'Date', dir: current.key === 'Date' && current.dir === 'desc' ? 'asc' : 'desc' }))}
                >
                  <span style={{ userSelect: 'none' }}>Date{playerSort.key === 'Date' ? ` ${playerSort.dir === 'asc' ? '↑' : '↓'}` : ''}</span>
                </th>
                {playerColumns.map((column) => {
                  const optionLabel = tableColumnLabel(column, playerTableMetricOptions, playerColumnLabels);
                  return (
                    <th
                      key={`player-metric-head-${column}`}
                      style={{
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                        background: playerSort.key === column ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : undefined,
                        color: playerSort.key === column ? '#fff' : undefined,
                      }}
                      onClick={() =>
                        setPlayerSort((current) =>
                          current.key === column
                            ? { key: column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                            : { key: column, dir: 'desc' }
                        )
                      }
                    >
                      <span style={{ userSelect: 'none' }}>
                        {optionLabel}
                        {playerSort.key === column ? ` ${playerSort.dir === 'asc' ? '↑' : '↓'}` : ''}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedPlayerDateRows.map((row) => (
                <tr key={`player-date-row-${row.date}`}>
                  <td
                    style={
                      playerSort.key === 'Date'
                        ? { background: 'rgba(var(--portal-accent-rgb, 59,130,246), 0.18)', color: '#fff', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }
                        : { textAlign: 'center', whiteSpace: 'nowrap', fontWeight: 700 }
                    }
                  >
                    {displayDate(row.date)}
                  </td>
                  {playerColumns.map((column) => {
                    let value: number | null = null;
                    if (column === 'CMJ') value = row.cmj;
                    else if (column === 'SJ') value = row.sj;
                    else if (column === 'CMJMax') value = row.cmjMax;
                    else if (column === 'SJMax') value = row.sjMax;
                    else if (column === 'RSI') value = row.rsiModified;
                    else if (column === 'SQ') value = row.sq;
                    else if (column === 'FBvelo') value = row.fbVelo;
                    else if (column === 'VeloMax') value = row.veloMax;
                    else if (column.startsWith('metric:')) value = row.metricAverages[column.slice('metric:'.length)] ?? null;
                    const isActiveSortColumn = playerSort.key === column;
                    return (
                      <td
                        key={`player-date-cell-${row.date}-${column}`}
                        style={
                          isActiveSortColumn
                            ? { background: 'rgba(var(--portal-accent-rgb, 59,130,246), 0.18)', color: '#fff', fontWeight: 700, textAlign: 'center' }
                            : { textAlign: 'center' }
                        }
                      >
                        {value === null ? '-' : value.toFixed(1)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        ) : (
          <p className="portal-muted-text">No testing dates are available inside the current filters.</p>
        )}
      </section>
      ) : null}

      {activeTab === 'leaderboard' ? (
      <article className={`${styles.leaderboardPanel} portal-admin-card`}>
        <div className="portal-row-between">
          <div>
            <p className={styles.sectionIndex}>ORGANIZATION VIEW</p>
            <h3 style={{ marginTop: 0, marginBottom: 4 }}>{leaderViewName || 'New leaderboard table'}</h3>
            <p className="portal-muted-text" style={{ margin: 0 }}>
              {leaderTestType === 'All' ? 'All force-plate tests' : leaderTestType} · showing {leaderDisplayMode === 'percentile' ? 'percentile ranks' : leaderDisplayMode === 'both' ? 'values and percentiles' : 'metric values'}.
            </p>
          </div>
          <div className={styles.panelActions}>
            <TableExportMenu
              disabled={!leaderExportRows.length || !leaderColumns.length || leaderboardLoading}
              onCsv={() => downloadCsv(leaderExportHeaders, leaderExportRows, `${leaderExportBaseName}.csv`)}
              onPdf={() => downloadTablePdf({
                title: leaderViewName || 'Force Plate Leaderboard',
                subtitle: leaderTestType === 'All' ? 'All force-plate tests' : leaderTestType,
                detail: leaderExportDetail,
                headers: leaderExportHeaders,
                rows: leaderExportRows,
                fileName: `${leaderExportBaseName}.pdf`,
              })}
            />
            <button type="button" className="btn btn-ghost" onClick={() => setShowLeaderboardCorrelation(true)}>
              View Chart
            </button>
          </div>
        </div>
        {leaderboardLoading ? <p className="portal-muted-text">Loading organization metrics…</p> : null}
        {leaderboardError ? <p className="auth-error">{leaderboardError}</p> : null}
        <div className={styles.leaderFilters}>
          <div className={styles.metricField}>
            <span>Test</span>
            <div className={styles.metricPicker}>
              <button type="button" aria-expanded={leaderTestPickerOpen} onClick={() => setLeaderTestPickerOpen((current) => !current)}>
                <span>{leaderTestType}</span>
                <b aria-hidden="true">⌄</b>
              </button>
              {leaderTestPickerOpen ? (
                <div className={styles.metricMenu}>
                  <input
                    type="search"
                    autoFocus
                    value={leaderTestSearch}
                    placeholder="Search force plate tests…"
                    onChange={(event) => setLeaderTestSearch(event.target.value)}
                  />
                  <div className={styles.metricMenuList}>
                    {visibleLeaderTestOptions.map((option) => (
                      <button
                        type="button"
                        key={`leader-test-${option}`}
                        className={option === leaderTestType ? styles.metricOptionActive : undefined}
                        onClick={() => {
                          setLeaderTestType(option);
                          setLeaderTestSearch('');
                          setLeaderTestPickerOpen(false);
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className={styles.displayModeField}>
            <span>Display</span>
            <div className={styles.displayModeToggle} role="group" aria-label="Leaderboard display">
              <button type="button" className={leaderDisplayMode === 'value' ? styles.displayModeActive : undefined} onClick={() => setLeaderDisplayMode('value')}>Values</button>
              <button type="button" className={leaderDisplayMode === 'percentile' ? styles.displayModeActive : undefined} onClick={() => setLeaderDisplayMode('percentile')}>Percentiles</button>
              <button type="button" className={leaderDisplayMode === 'both' ? styles.displayModeActive : undefined} onClick={() => setLeaderDisplayMode('both')}>Values + percentiles</button>
            </div>
          </div>
          <label>
            <span>Start date</span>
            <input
              type="date"
              value={leaderStartDate}
              onChange={(event) => setLeaderStartDate(event.target.value)}
            />
          </label>
          <label>
            <span>End date</span>
            <input
              type="date"
              value={leaderEndDate}
              onChange={(event) => setLeaderEndDate(event.target.value)}
            />
          </label>
        </div>
        <SavedViewControls
          viewType="leaderboard"
          savedViews={savedViews}
          selectedId={leaderViewId}
          name={leaderViewName}
          columnCount={leaderColumns.length}
          canManage={canManageViews}
          loading={viewsLoading}
          saving={viewSaving}
          message={activeTab === 'leaderboard' ? viewSaveMessage : ''}
          onSelect={(value) => chooseSavedView('leaderboard', value)}
          onNameChange={setLeaderViewName}
          onNew={() => chooseSavedView('leaderboard', 'new')}
          onColumns={() => setLeaderColumnMenuOpen((current) => !current)}
          onSave={() => void saveTableView('leaderboard')}
          onDelete={() => void deleteTableView('leaderboard')}
        />
        {leaderColumnMenuOpen ? (
          <ColumnEditor
            options={leaderboardMetricOptions}
            columns={leaderColumns}
            labels={leaderColumnLabels}
            search={leaderColumnSearch}
            onSearchChange={setLeaderColumnSearch}
            onColumnsChange={setLeaderColumns}
            onLabelsChange={setLeaderColumnLabels}
          />
        ) : null}
        <div className="portal-table-wrap">
          <table className="portal-table">
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  background: leaderSort.key === 'Player' ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : undefined,
                  color: leaderSort.key === 'Player' ? '#fff' : undefined,
                }}
                onClick={() =>
                  setLeaderSort((current) =>
                    current.key === 'Player'
                      ? { key: 'Player', dir: current.dir === 'asc' ? 'desc' : 'asc' }
                      : { key: 'Player', dir: 'asc' }
                  )
                }
              >
                <span style={{ userSelect: 'none' }}>
                  Player
                  {leaderSort.key === 'Player' ? ` ${leaderSort.dir === 'asc' ? '↑' : '↓'}` : ''}
                </span>
              </th>
              {leaderColumns.map((column) => {
                const optionLabel = tableColumnLabel(column, leaderboardMetricOptions, leaderColumnLabels);
                return (
                  <th
                    key={`head-${column}`}
                    style={{
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      background: leaderSort.key === column ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : undefined,
                      color: leaderSort.key === column ? '#fff' : undefined,
                    }}
                    onClick={() =>
                      setLeaderSort((current) =>
                        current.key === column
                          ? { key: column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                          : { key: column, dir: 'desc' }
                      )
                    }
                  >
                    <span style={{ userSelect: 'none' }}>
                      {optionLabel}
                      {leaderSort.key === column ? ` ${leaderSort.dir === 'asc' ? '↑' : '↓'}` : ''}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedLeaderboardRows.map((row) => (
              <tr key={`leader-${row.playerName}`}>
                <td
                  style={
                    leaderSort.key === 'Player'
                      ? {
                          background: 'rgba(var(--portal-accent-rgb, 59,130,246), 0.18)',
                          color: '#fff',
                          fontWeight: 700,
                          textAlign: 'center',
                        }
                      : { textAlign: 'center' }
                  }
                >
                  {row.playerName}
                </td>
                {leaderColumns.map((column) => {
                  const value = leaderboardValue(row, column);
                  const percentile = leaderboardPercentiles.get(column)?.get(row.playerName) ?? null;
                  const isActiveSortColumn = leaderSort.key === column;
                  return (
                    <td
                      key={`val-${row.playerName}-${column}`}
                      style={
                        isActiveSortColumn
                          ? {
                              background: 'rgba(var(--portal-accent-rgb, 59,130,246), 0.18)',
                              color: '#fff',
                              fontWeight: 700,
                              textAlign: 'center',
                            }
                          : { textAlign: 'center' }
                      }
                    >
                      {leaderDisplayMode === 'percentile'
                        ? (percentile === null ? '-' : ordinal(percentile))
                        : leaderDisplayMode === 'both'
                        ? (value === null ? '-' : `${value.toFixed(1)}${percentile === null ? '' : ` (${ordinal(percentile)})`}`)
                        : (value === null ? '-' : value.toFixed(1))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </article>
      ) : null}

      <LeaderboardCorrelationModal
        open={showLeaderboardCorrelation}
        onClose={() => setShowLeaderboardCorrelation(false)}
        title="Force Plate Leaderboard Correlation"
        columns={correlationColumns}
        axisColumns={correlationAxisColumns}
        rows={correlationRows}
        viewByLabel="Player"
        primaryColumnName="Player"
        siteLogoSrc="/vald.webp"
        siteLogoAlt="VALD"
      />
    </div>
  );
}

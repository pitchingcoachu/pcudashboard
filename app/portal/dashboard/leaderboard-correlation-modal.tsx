'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTableDisplayValue, parseSortableNumber } from '../../../lib/table-sort';

type LeaderboardRow = Record<string, string | number | null | undefined>;

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  columns: string[];
  axisColumns?: string[];
  rows: LeaderboardRow[];
  minPointsRequired?: number;
  viewByLabel: 'Player' | 'Team';
  primaryColumnName?: string;
  siteLogoSrc?: string | null;
  siteLogoAlt?: string;
  pointLogoSrcForLabel?: (label: string) => string;
  formatValue?: (column: string, value: unknown) => string;
  correlationQueryBase?: string;
};

type ScatterPoint = {
  rank: number;
  label: string;
  displayLabel: string;
  x: number;
  y: number;
};

type HoverState = {
  point: ScatterPoint;
  x: number;
  y: number;
} | null;

const SVG_WIDTH = 960;
const SVG_HEIGHT = 560;
const PAD_LEFT = 68;
const PAD_RIGHT = 26;
const PAD_TOP = 74;
const PAD_BOTTOM = 64;
const STAT_DECIMALS = 1;
const R_SQUARED_DECIMALS = 2;

function formatNameFirstLast(name: string): string {
  const value = String(name ?? '').trim();
  if (!value) return '';
  if (value.includes(',')) {
    const [last, first] = value.split(',').map((part) => part.trim()).filter(Boolean);
    if (first && last) return `${first} ${last}`;
  }
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    return `${first} ${last}`;
  }
  return value;
}

function decimalPlacesFromFormatted(value: string): number | null {
  const normalized = value
    .trim()
    .replace(/,/g, '')
    .replace(/%$/g, '');
  const match = normalized.match(/^-?(?:(?:\d+)(?:\.(\d+))?|\.(\d+))$/);
  if (!match) return null;
  const decimals = match[1] ?? match[2] ?? '';
  return decimals.length;
}

function detectColumnDecimals(
  column: string,
  rows: LeaderboardRow[],
  labelColumn: string,
  formatter?: (column: string, value: unknown) => string
): number {
  let maxDecimals = 0;
  let foundAny = false;
  for (const row of rows) {
    const label = String(row[labelColumn] ?? '').trim();
    if (isAllSummaryLabel(label)) continue;
    const numeric = numericByColumnAlias(row, column);
    if (numeric === null) continue;
    foundAny = true;
    const formatted = formatter ? formatter(column, row[column]) : formatTableDisplayValue(column, row[column]);
    const decimals = decimalPlacesFromFormatted(formatted);
    if (decimals === null) continue;
    if (decimals > maxDecimals) maxDecimals = decimals;
  }
  if (!foundAny) return 3;
  return Math.max(0, Math.min(4, maxDecimals));
}

function hasAnyNumericPoints(column: string, rows: LeaderboardRow[], labelColumn: string): boolean {
  for (const row of rows) {
    const label = String(row[labelColumn] ?? '').trim();
    if (isAllSummaryLabel(label)) continue;
    const numeric = numericByColumnAlias(row, column);
    if (numeric !== null) return true;
  }
  return false;
}

function tableLikeTickValue(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '-';
  return value.toFixed(decimals);
}

function isLikelyPercentColumn(
  column: string,
  rows: LeaderboardRow[],
  labelColumn: string,
  formatter?: (column: string, value: unknown) => string
): boolean {
  const normalizedColumn = String(column ?? '').toLowerCase();
  if (normalizedColumn.includes('%') || normalizedColumn.includes('pct') || normalizedColumn.includes('percent')) {
    return true;
  }
  for (const row of rows) {
    const label = String(row[labelColumn] ?? '').trim();
    if (isAllSummaryLabel(label)) continue;
    const numeric = numericByColumnAlias(row, column);
    if (numeric === null) continue;
    const formatted = formatter ? formatter(column, row[column]) : formatTableDisplayValue(column, row[column]);
    if (String(formatted).includes('%')) return true;
  }
  return false;
}

function inferLabelColumn(columns: string[], primaryColumnName: string | undefined): string {
  if (primaryColumnName && columns.includes(primaryColumnName)) return primaryColumnName;
  return columns[0] ?? '';
}

function isAllSummaryLabel(value: string): boolean {
  const norm = value.trim().toLowerCase();
  return norm === 'all' || norm === 'all (pinned)';
}

/** Normalize token for fuzzy column-key matching (strip non-alphanumeric except % and +). */
function normalizeColumnToken(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/percent/g, 'pct')
    .replace(/%/g, 'pct')
    .replace(/[^a-z0-9+]/g, '');
}

function columnTokenCandidates(value: string): string[] {
  const token = normalizeColumnToken(value);
  if (!token) return [];
  const out = new Set<string>([token]);
  if (token.endsWith('pct')) out.add(token.slice(0, -3));
  else out.add(`${token}pct`);
  return Array.from(out);
}

function rowValuesByToken(row: LeaderboardRow, tokenCandidates: string[]): unknown[] {
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(row)) {
    const rowTokens = columnTokenCandidates(key);
    if (rowTokens.some((token) => tokenCandidates.includes(token))) values.push(value);
  }
  return values;
}

function parseCorrelationNumber(value: unknown): number | null {
  const direct = parseSortableNumber(value);
  if (direct !== null) return direct;
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const candidates: unknown[] = [
    obj.value,
    obj.raw,
    obj.numeric,
    obj.number,
    obj.display,
    obj.label,
    obj.text,
  ];
  for (const candidate of candidates) {
    const parsed = parseSortableNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function numericByColumnAlias(row: LeaderboardRow, column: string): number | null {
  const tokens = columnTokenCandidates(column);
  const tokenSet = new Set(tokens);
  const direct = parseCorrelationNumber(row[column]);
  if (direct !== null && !tokenSet.has('usage') && !tokenSet.has('usagepct')) return direct;
  const numericFromAliases = (aliasColumn: string): number | null => {
    const values = rowValuesByToken(row, columnTokenCandidates(aliasColumn));
    for (const value of values) {
      const parsed = parseCorrelationNumber(value);
      if (parsed !== null) return parsed;
    }
    return null;
  };
  const aliasValues = rowValuesByToken(row, tokens);
  for (const value of aliasValues) {
    const parsed = parseCorrelationNumber(value);
    if (parsed !== null) return parsed;
  }
  const fuzzyNumericFromKeys = (match: (token: string) => boolean): number | null => {
    for (const [key, value] of Object.entries(row)) {
      const token = normalizeColumnToken(key);
      if (!token || !match(token)) continue;
      const parsed = parseCorrelationNumber(value);
      if (parsed !== null) return parsed;
    }
    return null;
  };

  if (tokens.some((token) => token === 'fbvelo' || token === 'fastballvelo' || token === 'fourseamvelo')) {
    const explicitFastballVeloAliases = ['FBvelo', 'FB Velo', 'Fastball Velo', 'Four-Seam Velo', 'FA Velo'];
    for (const alias of explicitFastballVeloAliases) {
      const parsedAlias = numericFromAliases(alias);
      if (parsedAlias !== null) return parsedAlias;
    }
    const parsed = fuzzyNumericFromKeys((token) =>
      token.includes('fbvelo') ||
      token.includes('fastballvelo') ||
      token.includes('fourseamvelo') ||
      token.includes('favelo') ||
      ((token.includes('velo') || token.includes('velocity')) &&
        (token.includes('fb') || token.includes('fa') || token.includes('fastball') || token.includes('fourseam')))
    );
    if (parsed !== null) return parsed;
    const fallbackVelo = numericFromAliases('Velo');
    if (fallbackVelo !== null) return fallbackVelo;
  }
  if (tokens.some((token) => token === 'cswpct' || token === 'csw')) {
    const parsed = fuzzyNumericFromKeys((token) => token.includes('csw'));
    if (parsed !== null) return parsed;
  }

  if (tokenSet.has('usage') || tokenSet.has('usagepct')) {
    const usageSource = (() => {
      const aliasPriority = ['Usage', 'Usage%', 'Usage %'];
      for (const alias of aliasPriority) {
        const values = rowValuesByToken(row, columnTokenCandidates(alias));
        for (const value of values) {
          if (value !== null && value !== undefined && String(value).trim() !== '') return value;
        }
      }
      if (row[column] !== null && row[column] !== undefined && String(row[column]).trim() !== '') return row[column];
      for (const value of aliasValues) {
        if (value !== null && value !== undefined && String(value).trim() !== '') return value;
      }
      return null;
    })();
    const usageRaw = parseCorrelationNumber(usageSource);
    if (usageRaw !== null) {
      return usageRaw;
    }
  }
  if (tokenSet.has('kbbpct') || tokenSet.has('kbb')) {
    const k = numericFromAliases('K%');
    const bb = numericFromAliases('BB%');
    if (k !== null && bb !== null) return k - bb;
    const kCount = numericFromAliases('K');
    const bbCount = numericFromAliases('BB');
    const bfCount = numericFromAliases('BF');
    if (kCount !== null && bbCount !== null && bfCount !== null && bfCount > 0) {
      return ((kCount - bbCount) / bfCount) * 100;
    }
  }
  if (tokenSet.has('cswpct') || tokenSet.has('csw')) {
    const called = numericFromAliases('Called-S%');
    const whiff = numericFromAliases('Whiff%');
    if (called !== null && whiff !== null) return called + whiff;
    const calledStrikes = numericFromAliases('CS');
    const whiffs = numericFromAliases('Whiffs');
    const pitches = numericFromAliases('P');
    if (calledStrikes !== null && whiffs !== null && pitches !== null && pitches > 0) {
      return ((calledStrikes + whiffs) / pitches) * 100;
    }
  }
  return null;
}

function normalizeAxisNumericValue(column: string, numeric: number): number {
  if (!Number.isFinite(numeric)) return numeric;
  const tokenSet = new Set(columnTokenCandidates(column));
  if (tokenSet.has('usage') || tokenSet.has('usagepct')) {
    // Keep usage on native numeric scale to avoid artificial clumping from
    // mixed upstream encodings (percent string vs fraction vs percent number).
    return numeric;
  }
  return numeric;
}

/**
 * For each target column, ensure every row has a property keyed exactly by that
 * column name.  If the row already has it, keep it; otherwise try a
 * case-insensitive / punctuation-stripped match against the row's existing keys.
 */
function normalizeRowsForColumns(
  targetColumns: string[],
  rows: LeaderboardRow[]
): LeaderboardRow[] {
  if (!targetColumns.length || !rows.length) return rows;
  let changed = false;
  const result = rows.map((row) => {
    // Build a lookup: normalizedToken (with aliases) → original key
    const keyByToken = new Map<string, string>();
    for (const key of Object.keys(row)) {
      for (const token of columnTokenCandidates(key)) {
        if (!keyByToken.has(token)) keyByToken.set(token, key);
      }
    }
    let patched: LeaderboardRow | null = null;
    for (const col of targetColumns) {
      if (Object.prototype.hasOwnProperty.call(row, col)) continue;
      const match = columnTokenCandidates(col)
        .map((token) => keyByToken.get(token))
        .find((candidate): candidate is string => Boolean(candidate));
      if (!match) continue;
      if (!patched) patched = { ...row };
      patched[col] = row[match];
    }
    if (patched) {
      changed = true;
      return patched;
    }
    return row;
  });
  return changed ? result : rows;
}

function AxisSearchSelect({
  options,
  value,
  onChange,
  placeholder,
  isLightTheme,
}: {
  options: string[];
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  isLightTheme: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = useMemo(
    () => options.filter((option) => option.toLowerCase().includes(query.toLowerCase())),
    [options, query]
  );

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="portal-search-select-trigger"
        style={{
          width: '100%',
          justifyContent: 'space-between',
          fontSize: '1rem',
          fontWeight: 600,
          background: isLightTheme ? '#fff' : 'rgba(15, 23, 42, 0.82)',
          color: isLightTheme ? '#374151' : '#e5e7eb',
          borderColor: isLightTheme ? '#cbd5e1' : 'rgba(255,255,255,0.2)',
        }}
        onClick={() => setOpen((current) => !current)}
      >
        {value || placeholder}
      </button>
      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 30,
            borderRadius: 10,
            border: isLightTheme ? '1px solid #cbd5e1' : '1px solid rgba(255,255,255,0.16)',
            background: isLightTheme ? '#fff' : 'rgba(7, 15, 34, 0.98)',
            boxShadow: isLightTheme ? '0 10px 24px rgba(15,23,42,0.12)' : '0 12px 26px rgba(2,6,23,0.42)',
            padding: 8,
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search stat..."
            style={{
              width: '100%',
              borderRadius: 8,
              border: isLightTheme ? '1px solid #d1d5db' : '1px solid rgba(255,255,255,0.2)',
              background: isLightTheme ? '#fff' : 'rgba(15, 23, 42, 0.82)',
              color: isLightTheme ? '#374151' : '#f8fafc',
              fontSize: '0.98rem',
              padding: '0.42rem 0.5rem',
              marginBottom: 8,
            }}
          />
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 4 }}>
            {filtered.length ? (
              filtered.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  style={{
                    border: 0,
                    borderRadius: 8,
                    textAlign: 'left',
                    fontSize: '1rem',
                    fontWeight: 600,
                    padding: '0.42rem 0.5rem',
                    cursor: 'pointer',
                    background: value === option
                      ? (isLightTheme ? 'rgba(37,99,235,0.12)' : 'rgba(96,165,250,0.24)')
                      : 'transparent',
                    color: isLightTheme ? '#334155' : '#e2e8f0',
                  }}
                >
                  {option}
                </button>
              ))
            ) : (
              <div style={{ fontSize: '0.8rem', opacity: 0.75, padding: '0.2rem 0.25rem' }}>No matching stats</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function LeaderboardCorrelationModal({
  open,
  onClose,
  title,
  columns,
  axisColumns,
  rows,
  minPointsRequired = 2,
  viewByLabel,
  primaryColumnName,
  siteLogoSrc,
  siteLogoAlt,
  pointLogoSrcForLabel,
  formatValue,
  correlationQueryBase,
}: Props) {
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [xColumn, setXColumn] = useState('');
  const [yColumn, setYColumn] = useState('');
  const [showTrendline, setShowTrendline] = useState(true);
  const [customTitle, setCustomTitle] = useState('');
  const [hover, setHover] = useState<HoverState>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [siteLogoDataUrl, setSiteLogoDataUrl] = useState('');
  const [pointLogoDataUrls, setPointLogoDataUrls] = useState<Record<string, string>>({});
  const [fetchedAxisRows, setFetchedAxisRows] = useState<LeaderboardRow[] | null>(null);
  const [isLightTheme, setIsLightTheme] = useState(false);
  const isProSiteLogo = String(siteLogoSrc ?? '').toLowerCase().includes('mlb-logo');

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const syncTheme = () => setIsLightTheme(document.body.classList.contains('theme-light'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open || logoDataUrl) return;
    let cancelled = false;
    fetch('/pitching-coach-u-logo.png')
      .then(async (response) => {
        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(new Error('Failed to load logo.'));
          reader.readAsDataURL(blob);
        });
      })
      .then((dataUrl) => {
        if (!cancelled) setLogoDataUrl(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, logoDataUrl]);

  useEffect(() => {
    if (!open || !siteLogoSrc) {
      setSiteLogoDataUrl('');
      return;
    }
    let cancelled = false;
    fetch(siteLogoSrc)
      .then(async (response) => {
        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(new Error('Failed to load site logo.'));
          reader.readAsDataURL(blob);
        });
      })
      .then((dataUrl) => {
        if (!cancelled) setSiteLogoDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setSiteLogoDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, siteLogoSrc]);

  const labelColumn = useMemo(() => inferLabelColumn(columns, primaryColumnName), [columns, primaryColumnName]);

  const rawSelectableAxisColumns = useMemo(() => {
    if (!open) return [] as string[];
    const source = axisColumns?.length ? axisColumns : columns;
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const column of source) {
      const value = String(column ?? '').trim();
      if (!value || value === labelColumn || seen.has(value)) continue;
      seen.add(value);
      deduped.push(value);
    }
    return deduped;
  }, [open, axisColumns, columns, labelColumn]);

  useEffect(() => {
    if (!open) return;
    setHover(null);
  }, [open, xColumn, yColumn]);

  useEffect(() => {
    if (!open || !correlationQueryBase || !xColumn || !yColumn || xColumn === yColumn) {
      setFetchedAxisRows(null);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const run = async () => {
      const fetchRowsForColumns = async (columnsToFetch: string[]) => {
        const params = new URLSearchParams(correlationQueryBase);
        params.set('table_mode', 'Custom');
        params.set('custom_columns', columnsToFetch.join(','));
        params.set('force_raw', '1');
        params.set('include_chart_points', '0');
        params.set('include_row_pitches', '0');
        params.set('include_trend_rows', '0');
        params.delete('chart_only');
        params.delete('chart_points_limit');
        params.delete('visual_option');
        const response = await fetch(`/api/dashboard/pitching/overview?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          table_rows?: Array<Record<string, string | number | null>>;
          table_columns?: string[];
          available_table_columns?: string[];
        };
        if (!response.ok || !active) return [] as LeaderboardRow[];
        const rows = Array.isArray(payload.table_rows) ? payload.table_rows : [];
        const tableColumns = Array.isArray(payload.table_columns) ? payload.table_columns : [];
        const availableColumns = Array.isArray(payload.available_table_columns) ? payload.available_table_columns : [];
        return normalizeRowsForColumns(
          Array.from(new Set([labelColumn, ...columnsToFetch, ...tableColumns, ...availableColumns].filter(Boolean))),
          rows
        );
      };
      try {
        let normalized = await fetchRowsForColumns([xColumn, yColumn]);
        const hasCombinedX = hasAnyNumericPoints(xColumn, normalized, labelColumn);
        const hasCombinedY = hasAnyNumericPoints(yColumn, normalized, labelColumn);
        if (!hasCombinedX || !hasCombinedY) {
          const xRows = await fetchRowsForColumns([xColumn]);
          const yRows = await fetchRowsForColumns([yColumn]);
          const mergedByLabel = new Map<string, LeaderboardRow>();
          for (const row of xRows) {
            const key = String(row[labelColumn] ?? '').trim();
            if (!key) continue;
            mergedByLabel.set(key, { ...row });
          }
          for (const row of yRows) {
            const key = String(row[labelColumn] ?? '').trim();
            if (!key) continue;
            const existing = mergedByLabel.get(key) ?? { [labelColumn]: row[labelColumn] };
            existing[yColumn] = row[yColumn];
            mergedByLabel.set(key, existing);
          }
          const merged = Array.from(mergedByLabel.values());
          const hasMergedX = hasAnyNumericPoints(xColumn, merged, labelColumn);
          const hasMergedY = hasAnyNumericPoints(yColumn, merged, labelColumn);
          if (hasMergedX && hasMergedY) normalized = merged;
        }
        if (!active) return;
        setFetchedAxisRows(normalized);
      } catch (error) {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFetchedAxisRows(null);
      }
    };
    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [open, correlationQueryBase, xColumn, yColumn, labelColumn]);

  // Normalize rows so every selectable axis column (and the label column) has a
  // matching key, even if the original row data uses different casing / punctuation.
  const allTargetColumns = useMemo(() => {
    const set = new Set([...columns, ...rawSelectableAxisColumns]);
    return Array.from(set);
  }, [columns, rawSelectableAxisColumns]);

  const normalizedRows = useMemo(
    () => (open ? normalizeRowsForColumns(allTargetColumns, rows) : rows),
    [open, allTargetColumns, rows]
  );
  const sourceRows = useMemo(() => {
    const base = open && fetchedAxisRows && fetchedAxisRows.length ? fetchedAxisRows : normalizedRows;
    if (viewByLabel !== 'Team') return base;
    return base.filter((row) => {
      const v = String(row[labelColumn] ?? '').trim().toUpperCase();
      return v !== 'AL' && v !== 'NL' && v !== 'AMERICAN LEAGUE' && v !== 'NATIONAL LEAGUE';
    });
  }, [open, fetchedAxisRows, normalizedRows, viewByLabel, labelColumn]);

  const selectableAxisColumns = useMemo(
    () => (open ? rawSelectableAxisColumns : ([] as string[])),
    [open, rawSelectableAxisColumns]
  );

  useEffect(() => {
    if (!open) return;
    if (!selectableAxisColumns.length) {
      setXColumn('');
      setYColumn('');
      return;
    }
    if (!xColumn || !selectableAxisColumns.includes(xColumn)) {
      setXColumn(selectableAxisColumns[0] ?? '');
    }
    if (!yColumn || !selectableAxisColumns.includes(yColumn) || yColumn === (selectableAxisColumns[0] ?? '')) {
      const fallback = selectableAxisColumns.find((column) => column !== (selectableAxisColumns[0] ?? '')) ?? selectableAxisColumns[0] ?? '';
      setYColumn(fallback);
    }
  }, [open, selectableAxisColumns, xColumn, yColumn]);

  const xColumnHasAnyNumeric = useMemo(
    () => (open && xColumn ? hasAnyNumericPoints(xColumn, sourceRows, labelColumn) : false),
    [open, xColumn, sourceRows, labelColumn]
  );
  const yColumnHasAnyNumeric = useMemo(
    () => (open && yColumn ? hasAnyNumericPoints(yColumn, sourceRows, labelColumn) : false),
    [open, yColumn, sourceRows, labelColumn]
  );

  const points = useMemo(() => {
    if (!open) return [] as ScatterPoint[];
    if (!xColumn || !yColumn || !labelColumn) return [] as ScatterPoint[];
    let rank = 0;
    const out: ScatterPoint[] = [];
    for (const row of sourceRows) {
      const labelRaw = String(row[labelColumn] ?? '').trim();
      if (!labelRaw || isAllSummaryLabel(labelRaw)) continue;
      rank += 1;
      const xParsed = numericByColumnAlias(row, xColumn);
      const yParsed = numericByColumnAlias(row, yColumn);
      const xValueRaw = xParsed ?? (xColumnHasAnyNumeric ? 0 : null);
      const yValueRaw = yParsed ?? (yColumnHasAnyNumeric ? 0 : null);
      const xValue = xValueRaw === null ? null : normalizeAxisNumericValue(xColumn, xValueRaw);
      const yValue = yValueRaw === null ? null : normalizeAxisNumericValue(yColumn, yValueRaw);
      if (xValue === null || yValue === null) continue;
      out.push({
        rank,
        label: labelRaw,
        displayLabel: viewByLabel === 'Player' ? formatNameFirstLast(labelRaw) : labelRaw,
        x: xValue,
        y: yValue,
      });
    }
    return out;
  }, [open, sourceRows, xColumn, yColumn, labelColumn, viewByLabel, xColumnHasAnyNumeric, yColumnHasAnyNumeric]);

  const pointLogoSrcByLabel = useMemo(() => {
    if (!open) return {} as Record<string, string>;
    if (!pointLogoSrcForLabel || viewByLabel !== 'Team') return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const point of points) {
      const src = pointLogoSrcForLabel(point.label);
      if (src) out[point.label] = src;
    }
    return out;
  }, [open, points, pointLogoSrcForLabel, viewByLabel]);

  useEffect(() => {
    if (!open) {
      setPointLogoDataUrls({});
      return;
    }
    const entries = Object.entries(pointLogoSrcByLabel);
    if (!entries.length) {
      setPointLogoDataUrls({});
      return;
    }
    let cancelled = false;
    Promise.all(entries.map(async ([label, src]) => {
      try {
        const response = await fetch(src);
        if (!response.ok) return [label, ''] as const;
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(new Error('Failed to load point logo.'));
          reader.readAsDataURL(blob);
        });
        return [label, dataUrl] as const;
      } catch {
        return [label, ''] as const;
      }
    }))
      .then((loaded) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const [label, dataUrl] of loaded) {
          if (dataUrl) next[label] = dataUrl;
        }
        setPointLogoDataUrls(next);
      })
      .catch(() => {
        if (!cancelled) setPointLogoDataUrls({});
      });
    return () => {
      cancelled = true;
    };
  }, [open, pointLogoSrcByLabel]);

  const stats = useMemo(() => {
    if (!open || points.length < 2) {
      return {
        count: points.length,
        slope: null as number | null,
        intercept: null as number | null,
        rSquared: null as number | null,
        meanX: null as number | null,
        meanY: null as number | null,
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      };
    }
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const n = points.length;
    const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
    let ssX = 0;
    let ssY = 0;
    let cov = 0;
    for (let i = 0; i < n; i += 1) {
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      ssX += dx * dx;
      ssY += dy * dy;
      cov += dx * dy;
    }
    if (ssX <= 0 || ssY <= 0) {
      return { count: n, slope: null, intercept: null, rSquared: null, meanX, meanY, xMin, xMax, yMin, yMax };
    }
    const slope = cov / ssX;
    const intercept = meanY - slope * meanX;
    const r = cov / Math.sqrt(ssX * ssY);
    const rSquared = Math.max(0, Math.min(1, r * r));
    return { count: n, slope, intercept, rSquared, meanX, meanY, xMin, xMax, yMin, yMax };
  }, [open, points]);

  const ranges = useMemo(() => {
    const xSpan = Math.max(1e-9, stats.xMax - stats.xMin);
    const ySpan = Math.max(1e-9, stats.yMax - stats.yMin);
    const xPad = xSpan * 0.08;
    const yPad = ySpan * 0.1;
    return {
      x0: stats.xMin - xPad,
      x1: stats.xMax + xPad,
      y0: stats.yMin - yPad,
      y1: stats.yMax + yPad,
    };
  }, [stats]);

  const toChartX = useCallback((value: number) => {
    const width = SVG_WIDTH - PAD_LEFT - PAD_RIGHT;
    const den = Math.max(1e-9, ranges.x1 - ranges.x0);
    return PAD_LEFT + ((value - ranges.x0) / den) * width;
  }, [ranges.x0, ranges.x1]);

  const toChartY = useCallback((value: number) => {
    const height = SVG_HEIGHT - PAD_TOP - PAD_BOTTOM;
    const den = Math.max(1e-9, ranges.y1 - ranges.y0);
    return SVG_HEIGHT - PAD_BOTTOM - ((value - ranges.y0) / den) * height;
  }, [ranges.y0, ranges.y1]);

  const xDecimals = useMemo(
    () => (open ? detectColumnDecimals(xColumn, sourceRows, labelColumn, formatValue) : 2),
    [open, xColumn, sourceRows, labelColumn, formatValue]
  );
  const yDecimals = useMemo(
    () => (open ? detectColumnDecimals(yColumn, sourceRows, labelColumn, formatValue) : 2),
    [open, yColumn, sourceRows, labelColumn, formatValue]
  );
  const xIsPercent = useMemo(
    () => (open && xColumn ? isLikelyPercentColumn(xColumn, sourceRows, labelColumn, formatValue) : false),
    [open, xColumn, sourceRows, labelColumn, formatValue]
  );
  const yIsPercent = useMemo(
    () => (open && yColumn ? isLikelyPercentColumn(yColumn, sourceRows, labelColumn, formatValue) : false),
    [open, yColumn, sourceRows, labelColumn, formatValue]
  );
  const trendline = useMemo(() => {
    if (!showTrendline || stats.slope === null || stats.intercept === null || points.length < 2) return null;
    const xMin = ranges.x0;
    const xMax = ranges.x1;
    const yMin = ranges.y0;
    const yMax = ranges.y1;
    const m = stats.slope;
    const b = stats.intercept;
    const candidates: Array<{ x: number; y: number }> = [];
    const pushPoint = (x: number, y: number) => {
      const eps = 1e-9;
      if (x < xMin - eps || x > xMax + eps || y < yMin - eps || y > yMax + eps) return;
      const clamped = {
        x: Math.max(xMin, Math.min(xMax, x)),
        y: Math.max(yMin, Math.min(yMax, y)),
      };
      if (!candidates.some((p) => Math.abs(p.x - clamped.x) < 1e-7 && Math.abs(p.y - clamped.y) < 1e-7)) {
        candidates.push(clamped);
      }
    };
    pushPoint(xMin, (m * xMin) + b);
    pushPoint(xMax, (m * xMax) + b);
    if (Math.abs(m) > 1e-12) {
      pushPoint((yMin - b) / m, yMin);
      pushPoint((yMax - b) / m, yMax);
    }
    if (candidates.length < 2) return null;
    const byX = [...candidates].sort((a, z) => a.x - z.x);
    const first = byX[0];
    const last = byX[byX.length - 1];
    return {
      x1: toChartX(first.x),
      y1: toChartY(first.y),
      x2: toChartX(last.x),
      y2: toChartY(last.y),
    };
  }, [showTrendline, stats.slope, stats.intercept, points.length, ranges.x0, ranges.x1, ranges.y0, ranges.y1, toChartX, toChartY]);

  const handleDownload = useCallback(async () => {
    if (!chartWrapRef.current || isDownloading) return;
    setIsDownloading(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(chartWrapRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
      const link = document.createElement('a');
      const safeX = xColumn.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      const safeY = yColumn.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      link.href = canvas.toDataURL('image/png');
      link.download = `leaderboard-correlation-${safeX}-vs-${safeY}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error(error);
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, xColumn, yColumn]);

  if (!open) return null;

  return (
    <div className="portal-modal-backdrop" onClick={onClose}>
        <div
          className="portal-modal-card portal-corr-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Leaderboard correlation chart"
        >
        <div className="portal-modal-header">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="portal-corr-column-grid">
          <div className="portal-corr-column-panel">
            <h4>X Axis</h4>
            <AxisSearchSelect
              options={selectableAxisColumns}
              value={xColumn}
              onChange={setXColumn}
              placeholder="Select X axis stat"
              isLightTheme={isLightTheme}
            />
          </div>
          <div className="portal-corr-column-panel">
            <h4>Y Axis</h4>
            <AxisSearchSelect
              options={selectableAxisColumns}
              value={yColumn}
              onChange={setYColumn}
              placeholder="Select Y axis stat"
              isLightTheme={isLightTheme}
            />
          </div>
        </div>
        <label style={{ display: 'grid', gap: 6, maxWidth: 420 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.02em' }}>Chart Title (optional)</span>
          <input
            value={customTitle}
            onChange={(event) => setCustomTitle(event.target.value)}
            placeholder={`${title}: ${xColumn || 'X'} vs ${yColumn || 'Y'}`}
            style={{
              background: isLightTheme ? '#ffffff' : 'rgba(15, 23, 42, 0.82)',
              color: isLightTheme ? '#0f172a' : '#f8fafc',
              border: isLightTheme ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.22)',
              borderRadius: 8,
              padding: '0.45rem 0.55rem',
            }}
          />
        </label>

        {xColumn && yColumn && xColumn === yColumn ? (
          <p className="portal-muted-text" style={{ margin: 0 }}>
            Select two different columns to build the chart.
          </p>
        ) : null}
        {!selectableAxisColumns.length ? (
          <p className="portal-muted-text" style={{ margin: 0 }}>
            No columns are available for correlation on this view.
          </p>
        ) : null}

        {xColumn && yColumn && xColumn !== yColumn && points.length >= minPointsRequired ? (
          <>
            <div className="portal-corr-stats">
              <span>{viewByLabel}s: {stats.count}</span>
              <span>R<sup>2</sup>: {stats.rSquared === null ? '-' : stats.rSquared.toFixed(R_SQUARED_DECIMALS)}</span>
              <button
                type="button"
                className={`btn ${showTrendline ? 'btn-primary' : 'btn-ghost'} portal-corr-swap-btn`}
                onClick={() => setShowTrendline((current) => !current)}
              >
                {showTrendline ? 'Trendline On' : 'Trendline Off'}
              </button>
              <button type="button" className="btn btn-ghost portal-corr-swap-btn" onClick={() => {
                setXColumn(yColumn);
                setYColumn(xColumn);
              }}>
                Swap Axes
              </button>
              <button type="button" className="btn btn-primary portal-corr-download-btn" onClick={handleDownload} disabled={isDownloading}>
                {isDownloading ? 'Downloading...' : 'Download Image'}
              </button>
            </div>

            <div className="portal-corr-chart-wrap" ref={chartWrapRef}>
              <svg ref={svgRef} viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="portal-corr-chart" aria-label={`${xColumn} vs ${yColumn} correlation chart`}>
                <rect x={0} y={0} width={SVG_WIDTH} height={SVG_HEIGHT} fill="transparent" />
                {siteLogoDataUrl ? (
                  <image
                    href={siteLogoDataUrl}
                    x={14}
                    y={4}
                    width={isProSiteLogo ? 58 : 66}
                    height={isProSiteLogo ? 58 : 66}
                    preserveAspectRatio="xMidYMid meet"
                    aria-label={siteLogoAlt ?? 'Site logo'}
                  />
                ) : null}
                {customTitle.trim() ? (
                  <text
                    x={SVG_WIDTH / 2}
                    y={30}
                    textAnchor="middle"
                    fill={isLightTheme ? 'rgba(15,23,42,0.94)' : 'rgba(255,255,255,0.94)'}
                    fontSize={16}
                    fontWeight={800}
                    letterSpacing={0.2}
                  >
                    {customTitle.trim()}
                  </text>
                ) : null}
                {logoDataUrl ? (
                  <image
                    href={logoDataUrl}
                    x={(SVG_WIDTH - 330) / 2}
                    y={(SVG_HEIGHT - 330) / 2}
                    width={330}
                    height={330}
                    opacity={isLightTheme ? 0.14 : 0.19}
                    preserveAspectRatio="xMidYMid meet"
                  />
                ) : null}
                <line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={SVG_HEIGHT - PAD_BOTTOM} className="portal-corr-axis" stroke={isLightTheme ? 'rgba(15,23,42,0.6)' : 'rgba(255,255,255,0.66)'} strokeWidth={1.15} />
                <line x1={PAD_LEFT} y1={SVG_HEIGHT - PAD_BOTTOM} x2={SVG_WIDTH - PAD_RIGHT} y2={SVG_HEIGHT - PAD_BOTTOM} className="portal-corr-axis" stroke={isLightTheme ? 'rgba(15,23,42,0.6)' : 'rgba(255,255,255,0.66)'} strokeWidth={1.15} />
                {stats.meanX !== null ? (
                  <line
                    x1={toChartX(stats.meanX)}
                    y1={PAD_TOP}
                    x2={toChartX(stats.meanX)}
                    y2={SVG_HEIGHT - PAD_BOTTOM}
                    stroke={isLightTheme ? 'rgba(15,23,42,0.5)' : 'rgba(255,255,255,0.44)'}
                    strokeWidth={1.35}
                    strokeDasharray="5 5"
                  />
                ) : null}
                {stats.meanY !== null ? (
                  <line
                    x1={PAD_LEFT}
                    y1={toChartY(stats.meanY)}
                    x2={SVG_WIDTH - PAD_RIGHT}
                    y2={toChartY(stats.meanY)}
                    stroke={isLightTheme ? 'rgba(15,23,42,0.5)' : 'rgba(255,255,255,0.44)'}
                    strokeWidth={1.35}
                    strokeDasharray="5 5"
                  />
                ) : null}

                {Array.from({ length: 6 }).map((_, idx) => {
                  const t = idx / 5;
                  const gx = PAD_LEFT + t * (SVG_WIDTH - PAD_LEFT - PAD_RIGHT);
                  const gy = PAD_TOP + t * (SVG_HEIGHT - PAD_TOP - PAD_BOTTOM);
                  const xVal = ranges.x0 + t * (ranges.x1 - ranges.x0);
                  const yVal = ranges.y1 - t * (ranges.y1 - ranges.y0);
                  const tickFill = isLightTheme ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.78)';
                  return (
                    <g key={`grid-${idx}`}>
                      <text x={gx} y={SVG_HEIGHT - PAD_BOTTOM + 22} className="portal-corr-tick" textAnchor="middle" fill={tickFill} fontSize={11} fontWeight={600}>
                        {tableLikeTickValue(xVal, xDecimals)}{xIsPercent ? '%' : ''}
                      </text>
                      <text x={PAD_LEFT - 8} y={gy + 4} className="portal-corr-tick" textAnchor="end" fill={tickFill} fontSize={11} fontWeight={600}>
                        {tableLikeTickValue(yVal, yDecimals)}{yIsPercent ? '%' : ''}
                      </text>
                    </g>
                  );
                })}
                <text
                  x={SVG_WIDTH - PAD_RIGHT}
                  y={28}
                  textAnchor="end"
                  fill={isLightTheme ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.9)'}
                  fontSize={13}
                  fontWeight={800}
                >
                  R
                  <tspan baselineShift="super" fontSize="9">2</tspan>
                  <tspan>{` = ${stats.rSquared === null ? '-' : stats.rSquared.toFixed(R_SQUARED_DECIMALS)}`}</tspan>
                </text>
                {stats.meanX !== null ? (
                  <text
                    x={SVG_WIDTH - PAD_RIGHT}
                    y={46}
                    textAnchor="end"
                    fill={isLightTheme ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.82)'}
                    fontSize={11}
                    fontWeight={700}
                  >
                    {`Avg ${xColumn}: ${tableLikeTickValue(stats.meanX, STAT_DECIMALS)}`}
                  </text>
                ) : null}
                {stats.meanY !== null ? (
                  <text
                    x={SVG_WIDTH - PAD_RIGHT}
                    y={62}
                    textAnchor="end"
                    fill={isLightTheme ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.82)'}
                    fontSize={11}
                    fontWeight={700}
                  >
                    {`Avg ${yColumn}: ${tableLikeTickValue(stats.meanY, STAT_DECIMALS)}`}
                  </text>
                ) : null}
                {trendline ? (
                  <line
                    x1={trendline.x1}
                    y1={trendline.y1}
                    x2={trendline.x2}
                    y2={trendline.y2}
                    stroke="rgba(255,159,67,0.95)"
                    strokeWidth={2.2}
                  />
                ) : null}

                {points.map((point) => {
                  const cx = toChartX(point.x);
                  const cy = toChartY(point.y);
                  const pointLogoSrc = pointLogoDataUrls[point.label] ?? pointLogoSrcByLabel[point.label] ?? '';
                  return (
                    <g key={`${point.rank}-${point.label}`}>
                      {pointLogoSrc ? (
                        <image
                          href={pointLogoSrc}
                          x={cx - 12}
                          y={cy - 12}
                          width={24}
                          height={24}
                          preserveAspectRatio="xMidYMid meet"
                          style={{ cursor: 'pointer' }}
                          onMouseEnter={(event) => {
                            const bounds = chartWrapRef.current?.getBoundingClientRect();
                            if (!bounds) return;
                            setHover({
                              point,
                              x: event.clientX - bounds.left,
                              y: event.clientY - bounds.top,
                            });
                          }}
                          onMouseMove={(event) => {
                            const bounds = chartWrapRef.current?.getBoundingClientRect();
                            if (!bounds) return;
                            setHover({
                              point,
                              x: event.clientX - bounds.left,
                              y: event.clientY - bounds.top,
                            });
                          }}
                          onMouseLeave={() => setHover(null)}
                        />
                      ) : (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={6}
                          className="portal-corr-point"
                          onMouseEnter={(event) => {
                            const bounds = chartWrapRef.current?.getBoundingClientRect();
                            if (!bounds) return;
                            setHover({
                              point,
                              x: event.clientX - bounds.left,
                              y: event.clientY - bounds.top,
                            });
                          }}
                          onMouseMove={(event) => {
                            const bounds = chartWrapRef.current?.getBoundingClientRect();
                            if (!bounds) return;
                            setHover({
                              point,
                              x: event.clientX - bounds.left,
                              y: event.clientY - bounds.top,
                            });
                          }}
                          onMouseLeave={() => setHover(null)}
                        />
                      )}
                    </g>
                  );
                })}

                <text
                  x={(PAD_LEFT + SVG_WIDTH - PAD_RIGHT) / 2}
                  y={SVG_HEIGHT - 16}
                  className="portal-corr-axis-label"
                  textAnchor="middle"
                  fill={isLightTheme ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.88)'}
                  fontSize={13}
                  fontWeight={800}
                >
                  {xColumn}
                </text>
                <text
                  x={18}
                  y={(PAD_TOP + SVG_HEIGHT - PAD_BOTTOM) / 2}
                  className="portal-corr-axis-label"
                  textAnchor="middle"
                  transform={`rotate(-90, 18, ${(PAD_TOP + SVG_HEIGHT - PAD_BOTTOM) / 2})`}
                  fill={isLightTheme ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.88)'}
                  fontSize={13}
                  fontWeight={800}
                >
                  {yColumn}
                </text>
              </svg>
              {hover ? (
                <div
                  className="portal-corr-tooltip"
                  style={{
                    left: Math.min(Math.max(hover.x + 12, 8), 690),
                    top: Math.max(hover.y - 12, 8),
                  }}
                >
                  <div><strong>#{hover.point.rank}</strong> {hover.point.displayLabel}</div>
                  <div>{xColumn}: {hover.point.x.toFixed(STAT_DECIMALS)}{xIsPercent ? '%' : ''}</div>
                  <div>{yColumn}: {hover.point.y.toFixed(STAT_DECIMALS)}{yIsPercent ? '%' : ''}</div>
                </div>
              ) : null}
            </div>
          </>
        ) : xColumn && yColumn && xColumn !== yColumn ? (
          <p className="portal-muted-text" style={{ margin: 0 }}>
            Not enough valid rows for this column pair. At least {minPointsRequired} numeric point{minPointsRequired === 1 ? '' : 's'} {minPointsRequired === 1 ? 'is' : 'are'} required.
          </p>
        ) : null}
      </div>
    </div>
  );
}

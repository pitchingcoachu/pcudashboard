export type SortDirection = 'asc' | 'desc';

export type SortableRow = Record<string, unknown>;

const THREE_DECIMAL_STAT_COLUMNS = new Set([
  'AVG',
  'SLG',
  'OBP',
  'OPS',
  'WOBA',
  'XWOBA',
  'ISO',
  'XISO',
  'BABIP',
]);

const TWO_DECIMAL_STAT_COLUMNS = new Set([
  'ERA',
  'FIP',
  'XFIP',
  'SIERA',
  'WHIP',
]);
const ONE_DECIMAL_STAT_COLUMNS = new Set([
  'VELO',
  'MAX',
  'IVB',
  'XIVB',
  'DIVB',
  'HB',
  'XHB',
  'DHB',
  'HEIGHT',
  'SIDE',
  'EXT',
  'SPINEFF',
  'VAA',
  'NVAA',
  'HAA',
]);

function formatTiltClock(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '-';
  const colon = raw.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (colon) {
    const h = ((Number(colon[1]) - 1 + 12) % 12) + 1;
    const m = Math.max(0, Math.min(59, Number(colon[2])));
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  const dotClock = raw.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (dotClock) {
    const h = ((Number(dotClock[1]) - 1 + 12) % 12) + 1;
    const m = Math.max(0, Math.min(59, Number(dotClock[2])));
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const deg = ((n % 360) + 360) % 360;
  const shifted = (deg + 180) % 360;
  const totalMinutes = Math.round((shifted / 360) * 720) % 720;
  const h = Math.floor(totalMinutes / 60) || 12;
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function parseTiltDeviationMinutes(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value ?? '').trim().replace(/\u2212/g, '-');
  const match = raw.match(/^([+-])?\s*(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (!match) return parseSortableNumber(value);
  const sign = match[1] === '-' ? -1 : 1;
  return sign * ((Number(match[2]) * 60) + Number(match[3]));
}

export function parseSortableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.replace(/\u2212/g, '-'); // normalize unicode minus
  const parenNegative = normalized.match(/^\((.*)\)$/);
  const unsignedInner = (parenNegative ? parenNegative[1] : normalized).trim();
  const cleaned = unsignedInner.replace(/[%\s,$]/g, '');
  const directParsed = Number(cleaned);
  if (Number.isFinite(directParsed)) return parenNegative ? -directParsed : directParsed;
  const numericToken = cleaned.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i)?.[0];
  if (!numericToken) return null;
  const parsed = Number(numericToken);
  return Number.isFinite(parsed) ? parsed : null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function sortTableRows<T extends SortableRow>(
  rows: T[],
  sortColumn: string,
  sortDirection: SortDirection,
  splitColumn?: string
): T[] {
  if (!sortColumn) return rows;
  const withIndex = rows.map((row, idx) => ({ row, idx }));
  withIndex.sort((a, b) => {
    const av = a.row[sortColumn];
    const bv = b.row[sortColumn];
    const as = String(av ?? '').trim();
    const bs = String(bv ?? '').trim();
    let cmp = 0;
    if (ISO_DATE_RE.test(as) && ISO_DATE_RE.test(bs)) {
      cmp = as.localeCompare(bs);
    } else {
      const isTiltDev = sortColumn.trim().toUpperCase() === 'TILTDEV';
      const aNum = isTiltDev ? parseTiltDeviationMinutes(av) : parseSortableNumber(av);
      const bNum = isTiltDev ? parseTiltDeviationMinutes(bv) : parseSortableNumber(bv);
      if (aNum !== null && bNum !== null) {
        cmp = aNum - bNum;
      } else {
        cmp = as.toLowerCase().localeCompare(bs.toLowerCase());
      }
    }
    if (cmp === 0) cmp = a.idx - b.idx;
    return sortDirection === 'asc' ? cmp : -cmp;
  });
  const sorted = withIndex.map((entry) => entry.row);
  if (!splitColumn) return sorted;
  const isAllRow = (row: T) => String(row[splitColumn] ?? '').trim().toLowerCase() === 'all';
  const allRows = sorted.filter(isAllRow);
  const nonAllRows = sorted.filter((row) => !isAllRow(row));
  return [...allRows, ...nonAllRows];
}

export function formatTableDisplayValue(column: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const upper = column.trim().toUpperCase();
  if (upper === 'USAGE' || upper === 'USAGE %' || upper === 'USAGE%') {
    const numericValue = parseSortableNumber(value);
    if (numericValue === null) return String(value);
    const rawText = typeof value === 'string' ? value.trim() : '';
    const normalizedUsage = rawText.includes('%') || Math.abs(numericValue) > 1 ? numericValue : numericValue * 100;
    return `${normalizedUsage.toFixed(1)}%`;
  }
  if (upper.includes('%')) {
    const numericValue = parseSortableNumber(value);
    if (numericValue === null) return String(value);
    return `${numericValue.toFixed(1)}%`;
  }
  if (upper === 'RTILT' || upper === 'BTILT') return formatTiltClock(String(value));
  if (upper === 'TILTDEV') {
    const minutes = parseTiltDeviationMinutes(value);
    if (minutes === null) return String(value);
    const rounded = Math.round(minutes);
    const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
    const absolute = Math.abs(rounded);
    return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}`;
  }
  if (ONE_DECIMAL_STAT_COLUMNS.has(upper)) {
    const numericValue = parseSortableNumber(value);
    if (numericValue === null) return String(value);
    return numericValue.toFixed(1);
  }
  if (TWO_DECIMAL_STAT_COLUMNS.has(upper)) {
    const numericValue = parseSortableNumber(value);
    if (numericValue === null) return String(value);
    return numericValue.toFixed(2);
  }
  if (!THREE_DECIMAL_STAT_COLUMNS.has(upper)) {
    return String(value);
  }
  const numericValue = parseSortableNumber(value);
  if (numericValue === null) return String(value);
  const formatted = numericValue.toFixed(3);
  if (formatted.startsWith('-0.')) return formatted.replace('-0.', '-.');
  if (formatted.startsWith('0.')) return formatted.slice(1);
  return formatted;
}

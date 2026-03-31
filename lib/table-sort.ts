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
]);

export function parseSortableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[%\s,]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

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
    const aNum = parseSortableNumber(av);
    const bNum = parseSortableNumber(bv);
    let cmp = 0;
    if (aNum !== null && bNum !== null) {
      cmp = aNum - bNum;
    } else {
      cmp = String(av ?? '').toLowerCase().localeCompare(String(bv ?? '').toLowerCase());
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

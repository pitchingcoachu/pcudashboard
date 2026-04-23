type TableValue = string | number | null | undefined;
type TableRow = Record<string, TableValue>;

const TOTAL_COLUMNS = new Set([
  '#',
  'BF',
  'P',
  'PA',
  'AB',
  'H',
  '1B',
  '2B',
  '3B',
  'HR',
  'XBH',
  'Barrels',
  'BB',
  'HBP',
  'K',
  'Whiffs',
  'Swings',
  'Takes',
  'Called-S',
  'Chases',
  'IZswings',
  'FPS',
  'EdgeSwings',
  'PosSD',
  'GoZoneSw',
  'CS',
  'SB',
  'PB',
]);

const THREE_DECIMAL_COLUMNS = new Set([
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

const TWO_DECIMAL_COLUMNS = new Set([
  'ERA',
  'FIP',
  'XFIP',
  'P/IP',
  'P/BF',
]);

function isPercentLike(value: TableValue, column: string): boolean {
  if (column.includes('%')) return true;
  if (typeof value !== 'string') return false;
  return value.trim().endsWith('%');
}

function parseNumeric(value: TableValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[%,$]/g, '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundForColumn(value: number, column: string): number {
  const upper = column.trim().toUpperCase();
  if (THREE_DECIMAL_COLUMNS.has(upper)) return Math.round(value * 1000) / 1000;
  if (TWO_DECIMAL_COLUMNS.has(upper)) return Math.round(value * 100) / 100;
  if (TOTAL_COLUMNS.has(column)) return Math.round(value);
  return Math.round(value * 10) / 10;
}

function normalizeKey(value: TableValue): string {
  return String(value ?? '').trim().toLowerCase();
}

function resolveWeight(row: TableRow): number {
  const candidates = ['BF', '#', 'P', 'PA', 'AB'];
  for (const column of candidates) {
    const parsed = parseNumeric(row[column]);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return 1;
}

export function buildPinnedAllRow(columns: string[], pinnedRows: TableRow[]): TableRow | null {
  if (!columns.length || !pinnedRows.length) return null;
  const first = columns[0];
  const out: TableRow = { [first]: 'All (Pinned)' };
  for (const column of columns.slice(1)) {
    let weightedSum = 0;
    let weightTotal = 0;
    let simpleSum = 0;
    let simpleCount = 0;
    let maxValue = Number.NEGATIVE_INFINITY;
    let hasValue = false;
    let percentMode = false;
    for (const row of pinnedRows) {
      const raw = row[column];
      const value = parseNumeric(raw);
      if (value === null) continue;
      hasValue = true;
      percentMode = percentMode || isPercentLike(raw, column);
      const weight = resolveWeight(row);
      weightedSum += value * weight;
      weightTotal += weight;
      simpleSum += value;
      simpleCount += 1;
      if (value > maxValue) maxValue = value;
    }
    if (!hasValue) {
      out[column] = null;
      continue;
    }
    const lower = column.toLowerCase();
    if (lower === 'max' || lower.includes(' max')) {
      out[column] = roundForColumn(maxValue, column);
      continue;
    }
    if (TOTAL_COLUMNS.has(column) && !percentMode) {
      out[column] = roundForColumn(simpleSum, column);
      continue;
    }
    const avg = weightTotal > 0 ? (weightedSum / weightTotal) : (simpleCount > 0 ? simpleSum / simpleCount : 0);
    if (percentMode) out[column] = `${(Math.round(avg * 10) / 10).toFixed(1)}%`;
    else out[column] = roundForColumn(avg, column);
  }
  return out;
}

export function pinKeyFromRow(row: TableRow, firstColumn: string): string {
  return normalizeKey(row[firstColumn]);
}

export function sortRowsWithPins(
  rows: TableRow[],
  columns: string[],
  pinnedKeys: Set<string>
): TableRow[] {
  if (!rows.length || !columns.length) return rows;
  const first = columns[0];
  const existingAllRow = rows.find((row) => normalizeKey(row[first]) === 'all') ?? null;
  const syntheticAllRow = existingAllRow
    ? null
    : (() => {
        const sourceRows = rows.filter((row) => normalizeKey(row[first]) !== 'all');
        const built = buildPinnedAllRow(columns, sourceRows);
        if (!built) return null;
        built[first] = 'All';
        return built;
      })();
  const allRow = existingAllRow ?? syntheticAllRow;
  const pinnedRows = rows.filter((row) => {
    const key = normalizeKey(row[first]);
    return key !== 'all' && pinnedKeys.has(key);
  });
  const pinnedSet = new Set(pinnedRows.map((row) => normalizeKey(row[first])));
  const unpinnedRows = rows.filter((row) => {
    const key = normalizeKey(row[first]);
    return key !== 'all' && !pinnedSet.has(key);
  });
  const pinnedAll = buildPinnedAllRow(columns, pinnedRows);
  return [
    ...(allRow ? [allRow] : []),
    ...pinnedRows,
    ...(pinnedAll ? [pinnedAll] : []),
    ...unpinnedRows,
  ];
}

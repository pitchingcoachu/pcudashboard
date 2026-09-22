import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { bubbleCategoryIdFromType, isBubbleColumnType } from '../../../../../lib/bullpen-column-types';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { getBullpenLogEntries, listPlayerChoicesByOrganization } from '../../../../../lib/training-db';

type SavedRow = Record<string, string>;
type MetricOption = { value: string; label: string };
type NormalizedRow = {
  date: string;
  script: string;
  pitchNumber: number;
  pitchType: string;
  ballType: string;
  drill: string;
  ballWeight: string;
  velocity: number | null;
  strike: boolean | null;
  twoThirds: boolean | null;
  bubbles: Record<string, string>;
};

const normalizedHeader = (value: string) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const normalizedName = (value: string) => {
  const trimmed = String(value ?? '').trim().replace(/\s+/g, ' ');
  const comma = trimmed.match(/^([^,]+),\s*(.+)$/);
  return (comma ? `${comma[2]} ${comma[1]}` : trimmed).toLowerCase();
};
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry ?? '').trim()) : [];
  } catch { return []; }
}

function parseBubbleSnapshot(value: unknown): Record<string, { label: string; options: string[] }> {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, { label: string; options: string[] }>
      : {};
  } catch { return {}; }
}

function inferredType(column: string, storedType: string): string {
  const type = String(storedType ?? '').trim().toLowerCase();
  if (type && type !== 'auto') return type === 'yes-no' ? 'strike' : type;
  const header = normalizedHeader(column);
  if (header === 'velocity' || header === 'velo') return 'velocity';
  if (['strike', 'strikes', 'strikeorball'].includes(header)) return 'strike';
  if (['23', 'twothirds'].includes(header)) return 'two-thirds';
  return 'text';
}

function findColumn(columns: string[], aliases: string[]): string {
  const wanted = new Set(aliases.map(normalizedHeader));
  return columns.find((column) => wanted.has(normalizedHeader(column))) ?? '';
}

function resultValue(value: unknown): boolean | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'strike') return true;
  if (normalized === 'no' || normalized === 'ball') return false;
  return null;
}

function normalizeBallWeight(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || /^(?:unspecified|unknown|n\/?a|none|-|all)$/i.test(raw)) return '5 oz';
  const ounces = raw.match(/^(\d+(?:\.\d+)?)\s*(?:oz|ounce|ounces)$/i);
  return ounces ? `${ounces[1]} oz` : raw;
}

function hasSpecifiedBallWeight(value: unknown): boolean {
  const raw = String(value ?? '').trim();
  return Boolean(raw) && !/^(?:unspecified|unknown|n\/?a|none|-|all)$/i.test(raw);
}

function factorLabel(row: Pick<NormalizedRow, 'pitchType' | 'ballType' | 'drill' | 'ballWeight'>): string {
  const factors = [row.pitchType, row.ballType, row.drill, row.ballWeight]
    .filter((value) => value && value !== 'All' && value !== 'Baseball' && !/^(?:unspecified|unknown|n\/?a|none|-)$/i.test(value));
  return factors.length ? factors.join(' / ') : 'All';
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rounded(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(1));
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const url = new URL(request.url);
  const playerName = String(url.searchParams.get('player') ?? '').trim();
  if (!playerName || playerName.toLowerCase() === 'all') {
    return NextResponse.json({ error: 'Choose a specific athlete for bullpen-script panels.' }, { status: 400 });
  }
  const players = await listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null });
  const player = players.find((candidate) => normalizedName(candidate.fullName) === normalizedName(playerName));
  if (!player) return NextResponse.json({ error: 'Athlete not found in this organization.' }, { status: 404 });

  const startDate = validDate(url.searchParams.get('start_date') ?? '');
  const endDate = validDate(url.searchParams.get('end_date') ?? '');
  const requestedMetric = String(url.searchParams.get('metric') ?? 'velocity').trim() || 'velocity';
  const velocityMode = url.searchParams.get('velocity_mode') === 'individual' ? 'individual' : 'average';
  const filters = {
    script: String(url.searchParams.get('script') ?? 'All'),
    pitchType: String(url.searchParams.get('pitch_type') ?? 'All'),
    ballType: String(url.searchParams.get('ball_type') ?? 'All'),
    drill: String(url.searchParams.get('drill') ?? 'All'),
    ballWeight: String(url.searchParams.get('ball_weight') ?? 'All'),
  };
  const requestedTableMetrics = new Set(String(url.searchParams.get('table_metrics') ?? '').split(',').map((value) => value.trim()).filter(Boolean));
  const entries = await getBullpenLogEntries({ organizationId, playerId: player.playerId });
  const bubbleLabels = new Map<string, string>();
  const allRows: NormalizedRow[] = [];

  for (const entry of entries) {
    if (startDate && entry.bullpenDate < startDate) continue;
    if (endDate && entry.bullpenDate > endDate) continue;
    const first = entry.rowsJson.find((row) => row && typeof row === 'object') ?? {} as SavedRow;
    const storedColumns = parseJsonArray(first.__templateColumns);
    const columns = storedColumns.length ? storedColumns : Object.keys(first).filter((key) => !key.startsWith('__'));
    const storedTypes = parseJsonArray(first.__templateColumnTypes);
    const types = columns.map((column, index) => inferredType(column, storedTypes[index] ?? 'auto'));
    const snapshots = parseBubbleSnapshot(first.__templateBubbleCategories);
    Object.entries(snapshots).forEach(([id, definition]) => bubbleLabels.set(id, definition.label || 'Bubble Category'));
    const columnForType = (wanted: string) => columns.find((_, index) => types[index] === wanted) ?? '';
    const velocityColumn = columnForType('velocity');
    const strikeColumn = columnForType('strike');
    const twoThirdsColumn = columnForType('two-thirds');
    const bubbleColumns = columns.flatMap((column, index) => {
      const categoryId = bubbleCategoryIdFromType(types[index] ?? '');
      return categoryId ? [{ column, categoryId }] : [];
    });
    const pitchTypeColumn = findColumn(columns, ['pitch type', 'pitch types', 'pitch', 'pitch name']);
    const ballTypeColumn = findColumn(columns, ['ball type', 'ball', 'weighted ball']);
    const drillColumn = findColumn(columns, ['drill', 'drills', 'throw type', 'throwing type', 'velocity type']);
    const ballWeightColumn = findColumn(columns, ['ball weight', 'weight', 'ball wt']);
    const script = String(first.__templateName ?? '').trim() || entry.templateId || 'Bullpen Script';
    entry.rowsJson.forEach((row, index) => {
      const rawVelocity = Number(String(velocityColumn ? row[velocityColumn] ?? '' : '').trim());
      const rawBallWeight = ballWeightColumn ? row[ballWeightColumn] : '';
      const bubbles = Object.fromEntries(bubbleColumns.flatMap(({ column, categoryId }) => {
        const value = String(row[column] ?? '').trim();
        return value ? [[categoryId, value]] : [];
      }));
      allRows.push({
        date: entry.bullpenDate,
        script,
        pitchNumber: index + 1,
        pitchType: String(pitchTypeColumn ? row[pitchTypeColumn] ?? '' : '').trim() || 'Unspecified',
        ballType: String(ballTypeColumn ? row[ballTypeColumn] ?? '' : '').trim() || (hasSpecifiedBallWeight(rawBallWeight) ? 'Weighted Ball' : 'Baseball'),
        drill: String(drillColumn ? row[drillColumn] ?? '' : '').trim() || 'All',
        ballWeight: normalizeBallWeight(rawBallWeight),
        velocity: Number.isFinite(rawVelocity) && rawVelocity > 0 ? rawVelocity : null,
        strike: resultValue(strikeColumn ? row[strikeColumn] : ''),
        twoThirds: resultValue(twoThirdsColumn ? row[twoThirdsColumn] : ''),
        bubbles,
      });
    });
  }

  const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const hasVelocity = allRows.some((row) => row.velocity !== null);
  const hasStrike = allRows.some((row) => row.strike !== null);
  const hasTwoThirds = allRows.some((row) => row.twoThirds !== null);
  const bubbleIds = unique(allRows.flatMap((row) => Object.keys(row.bubbles)));
  const metricOptions: MetricOption[] = [
    ...(hasVelocity ? [{ value: 'velocity', label: 'Average Velocity' }] : []),
    ...(hasStrike ? [{ value: 'strike', label: 'Strike %' }] : []),
    ...(hasTwoThirds ? [{ value: 'two-thirds', label: '2/3%' }] : []),
    ...bubbleIds.map((id) => ({ value: `bubble:${id}`, label: bubbleLabels.get(id) ?? 'Bubble Category' })),
  ];
  const tableMetricOptions: MetricOption[] = [
    { value: 'count', label: 'Pitch Count' },
    ...(hasStrike ? [{ value: 'strike_pct', label: 'Strike %' }] : []),
    ...(hasTwoThirds ? [{ value: 'two_thirds_pct', label: '2/3%' }] : []),
    ...(hasVelocity ? [{ value: 'avg_velocity', label: 'Average Velocity' }, { value: 'max_velocity', label: 'Max Velocity' }] : []),
    ...bubbleIds.map((id) => ({ value: `bubble:${id}`, label: bubbleLabels.get(id) ?? 'Bubble Category' })),
  ];
  const metric = metricOptions.some((option) => option.value === requestedMetric)
    ? requestedMetric
    : metricOptions[0]?.value ?? requestedMetric;
  const filteredRows = allRows.filter((row) =>
    (row.velocity !== null || row.strike !== null || row.twoThirds !== null || Object.keys(row.bubbles).length > 0) &&
    (filters.script === 'All' || row.script === filters.script) &&
    (filters.pitchType === 'All' || row.pitchType === filters.pitchType) &&
    (filters.ballType === 'All' || row.ballType === filters.ballType) &&
    (filters.drill === 'All' || row.drill === filters.drill) &&
    (filters.ballWeight === 'All' || row.ballWeight === filters.ballWeight)
  );

  const chartPoints: Array<Record<string, string | number | null>> = [];
  if (metric === 'velocity' && velocityMode === 'individual') {
    filteredRows.forEach((row) => {
      if (row.velocity === null) return;
      chartPoints.push({ session_date: row.date, metric, value: row.velocity, series: factorLabel(row), pitch_number: row.pitchNumber, pitch_type: row.pitchType, ball_type: row.ballType, drill: row.drill, ball_weight: row.ballWeight, count: 1 });
    });
  } else if (isBubbleColumnType(metric)) {
    const categoryId = bubbleCategoryIdFromType(metric) ?? '';
    const groups = new Map<string, { date: string; option: string; count: number }>();
    filteredRows.forEach((row) => {
      const option = row.bubbles[categoryId];
      if (!option) return;
      const key = `${row.date}\u0000${option}`;
      const current = groups.get(key) ?? { date: row.date, option, count: 0 };
      current.count += 1;
      groups.set(key, current);
    });
    const totals = new Map<string, number>();
    groups.forEach((group) => totals.set(group.date, (totals.get(group.date) ?? 0) + group.count));
    groups.forEach((group) => chartPoints.push({ session_date: group.date, metric, value: totals.get(group.date) ? group.count / totals.get(group.date)! * 100 : 0, series: group.option, count: group.count }));
  } else {
    const groups = new Map<string, NormalizedRow[]>();
    filteredRows.forEach((row) => {
      const series = metric === 'two-thirds' ? 'All' : factorLabel(row);
      const key = `${row.date}\u0000${series}`;
      const values = groups.get(key) ?? [];
      values.push(row);
      groups.set(key, values);
    });
    groups.forEach((rows, key) => {
      const [date, series] = key.split('\u0000');
      const numericValues = metric === 'velocity'
        ? rows.flatMap((row) => row.velocity === null ? [] : [row.velocity])
        : metric === 'two-thirds'
          ? rows.flatMap((row) => row.twoThirds === null ? [] : [row.twoThirds ? 100 : 0])
          : rows.flatMap((row) => row.strike === null ? [] : [row.strike ? 100 : 0]);
      const value = average(numericValues);
      if (value !== null) chartPoints.push({ session_date: date, metric, value, series, count: numericValues.length });
    });
  }
  chartPoints.sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)) || String(a.series).localeCompare(String(b.series)));

  const summaryGroups = new Map<string, NormalizedRow[]>();
  filteredRows.forEach((row) => {
    const key = `${row.pitchType}\u0000${row.ballType}\u0000${row.drill}\u0000${row.ballWeight}`;
    const values = summaryGroups.get(key) ?? [];
    values.push(row);
    summaryGroups.set(key, values);
  });
  const visibleMetricValues = requestedTableMetrics.size ? tableMetricOptions.map((item) => item.value).filter((value) => requestedTableMetrics.has(value)) : tableMetricOptions.map((item) => item.value);
  const includeDrill = filteredRows.some((row) => row.drill !== 'All');
  const includeBallWeight = filteredRows.some((row) => row.ballWeight !== 'All');
  const factorColumns = ['Pitch Type', 'Ball Type', ...(includeDrill ? ['Drill'] : []), ...(includeBallWeight ? ['Ball Weight'] : [])];
  const metricLabelByValue = new Map(tableMetricOptions.map((item) => [item.value, item.label]));
  const summarize = (rows: NormalizedRow[], factors: { pitchType: string; ballType: string; drill: string; ballWeight: string }) => {
    const output: Record<string, string | number | null> = { 'Pitch Type': factors.pitchType, 'Ball Type': factors.ballType };
    if (includeDrill) output.Drill = factors.drill;
    if (includeBallWeight) output['Ball Weight'] = factors.ballWeight;
    for (const metricValue of visibleMetricValues) {
      const label = metricLabelByValue.get(metricValue) ?? metricValue;
      if (metricValue === 'count') output[label] = rows.length;
      else if (metricValue === 'avg_velocity') output[label] = rounded(average(rows.flatMap((row) => row.velocity === null ? [] : [row.velocity])));
      else if (metricValue === 'max_velocity') {
        const values = rows.flatMap((row) => row.velocity === null ? [] : [row.velocity]);
        output[label] = values.length ? Number(Math.max(...values).toFixed(1)) : null;
      } else if (metricValue === 'strike_pct') output[label] = rounded(average(rows.flatMap((row) => row.strike === null ? [] : [row.strike ? 100 : 0])));
      else if (metricValue === 'two_thirds_pct') output[label] = rounded(average(rows.flatMap((row) => row.twoThirds === null ? [] : [row.twoThirds ? 100 : 0])));
      else if (isBubbleColumnType(metricValue)) {
        const categoryId = bubbleCategoryIdFromType(metricValue) ?? '';
        const counts = new Map<string, number>();
        rows.forEach((row) => { const option = row.bubbles[categoryId]; if (option) counts.set(option, (counts.get(option) ?? 0) + 1); });
        const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
        output[label] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([option, count]) => `${option} ${total ? Math.round(count / total * 100) : 0}%`).join(' / ') || null;
      }
    }
    return output;
  };
  const tableRows = Array.from(summaryGroups.entries()).map(([key, rows]) => {
    const [pitchType, ballType, drill, ballWeight] = key.split('\u0000');
    return summarize(rows, { pitchType, ballType, drill, ballWeight });
  }).sort((a, b) => Number(b['Pitch Count'] ?? 0) - Number(a['Pitch Count'] ?? 0));
  if (filteredRows.length) tableRows.push(summarize(filteredRows, { pitchType: 'All', ballType: 'All', drill: 'All', ballWeight: 'All' }));

  return NextResponse.json({
    player: player.fullName,
    selected_metric: metric,
    metric_options: metricOptions,
    table_metric_options: tableMetricOptions,
    filter_options: {
      scripts: unique(allRows.map((row) => row.script)),
      pitchTypes: unique(allRows.map((row) => row.pitchType)),
      ballTypes: unique(allRows.map((row) => row.ballType)),
      drills: unique(allRows.map((row) => row.drill).filter((value) => value !== 'All')),
      ballWeights: unique(allRows.map((row) => row.ballWeight).filter((value) => value !== 'All')),
    },
    table_columns: [...factorColumns, ...visibleMetricValues.map((value) => metricLabelByValue.get(value) ?? value)],
    table_rows: tableRows,
    chart_points: chartPoints,
  });
}

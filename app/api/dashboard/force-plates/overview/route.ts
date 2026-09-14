import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { forcePlateFlagMetric, parseForcePlateFlagMetric } from '../../../../../lib/dashboard-metric-catalog';
import { loadForcePlateMetricCatalog, loadForcePlateReportMetricRows } from '../../../../../lib/force-plate-neon-db';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import { getPlayerForUser, listPlayerChoicesByOrganization } from '../../../../../lib/training-db';

function normalizeName(value: string): string {
  const raw = String(value ?? '').trim();
  const firstLast = raw.includes(',')
    ? (() => {
        const [last, ...rest] = raw.split(',').map((part) => part.trim());
        return `${rest.join(' ')} ${last}`.trim();
      })()
    : raw;
  return firstLast.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function metricLabel(metric: { metricName: string; metricUnit: string }): string {
  return `${metric.metricName}${metric.metricUnit ? ` (${metric.metricUnit})` : ''}`;
}

export async function GET(request: Request) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session)) || resolveProgrammingSchoolCode(session) !== 'PCU') {
    return NextResponse.json({ error: 'Force Plate Data is not available.' }, { status: 403 });
  }
  const organizationId = await resolveProgrammingOrganizationId(session);
  const roster = await listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null });
  let allowedNames = Array.from(new Set(roster.map((player) => String(player.fullName ?? '').trim()).filter(Boolean)));
  if (session.role === 'player') {
    const own = await getPlayerForUser({ organizationId, userId: session.userId ?? 0 });
    const ownNorm = normalizeName(own?.fullName ?? '');
    allowedNames = allowedNames.filter((name) => normalizeName(name) === ownNorm);
  }

  const url = new URL(request.url);
  const requestedPlayers = String(url.searchParams.get('player') ?? '')
    .split('|')
    .map((value) => value.trim())
    .filter((value) => value && value !== 'All');
  const encodedMetrics = String(url.searchParams.get('metrics') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const catalog = await loadForcePlateMetricCatalog({ organizationId, schoolCode: 'PCU' });
  const defaultMetric = catalog.metrics[0] ?? null;
  const parsedMetrics = encodedMetrics.map(parseForcePlateFlagMetric).filter((metric): metric is { metricName: string; metricUnit: string } => Boolean(metric));
  const metrics = parsedMetrics.length ? parsedMetrics : defaultMetric ? [defaultMetric] : [];
  const rows = await loadForcePlateReportMetricRows({
    organizationId,
    schoolCode: 'PCU',
    allowedPlayerNames: allowedNames,
    selectedPlayerNames: requestedPlayers,
    metrics,
    testType: String(url.searchParams.get('test_type') ?? 'All'),
    startDate: String(url.searchParams.get('start_date') ?? ''),
    endDate: String(url.searchParams.get('end_date') ?? ''),
  });

  const metricKeys = metrics.map((metric) => forcePlateFlagMetric(metric.metricName, metric.metricUnit));
  const tableColumns = ['Date', ...(requestedPlayers.length === 1 ? [] : ['Player']), 'Test Type', ...metricKeys];
  const grouped = new Map<string, Record<string, string | number | null>>();
  for (const row of rows) {
    const reportDate = row.dateTime.slice(0, 10) || row.date;
    const key = `${reportDate}\u001f${normalizeName(row.playerName)}\u001f${row.testType}`;
    const current = grouped.get(key) ?? {
      Date: reportDate,
      Player: row.playerName,
      'Test Type': row.testType,
    };
    current[forcePlateFlagMetric(row.metricName, row.metricUnit)] = Number(row.value.toFixed(3));
    grouped.set(key, current);
  }
  const chartPoints = rows.map((row) => ({
    session_date: row.dateTime.slice(0, 10) || row.date,
    date_time: row.dateTime,
    player: row.playerName,
    test_type: row.testType,
    metric: forcePlateFlagMetric(row.metricName, row.metricUnit),
    metric_name: row.metricName,
    metric_unit: row.metricUnit,
    value: row.value,
    sample: row.samples,
  }));
  return NextResponse.json({
    table_columns: tableColumns,
    table_rows: Array.from(grouped.values()),
    chart_points: chartPoints,
    heatmap_points: [],
    metric_options: catalog.metrics.map((metric) => ({
      value: forcePlateFlagMetric(metric.metricName, metric.metricUnit),
      label: metricLabel(metric),
      testTypes: metric.testTypes,
    })),
    test_types: catalog.testTypes,
  }, { headers: { 'cache-control': 'private, max-age=15, stale-while-revalidate=60' } });
}

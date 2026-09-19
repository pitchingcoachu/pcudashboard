import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../lib/ai-access';
import { getDbPool } from '../../../../lib/auth-db';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { dashboardMetricLabel, dashboardMetricOptions, forcePlateDisplayUnit, metricSampleColumn } from '../../../../lib/dashboard-metric-catalog';
import { ensurePerformanceRollupSchema, loadPerformanceDailyRollups, normalizePerformancePlayerName, type PerformanceRollupSource } from '../../../../lib/performance-rollups';
import { getPlayerForUser, listPlayerChoicesByOrganization } from '../../../../lib/training-db';
import { parseSortableNumber } from '../../../../lib/table-sort';
import { fetchValdProfileGroupDirectory, fetchValdProfileNamesForGroup } from '../../../../lib/vald-forceplates';

export const maxDuration = 120;

type ChartSource = 'pitching' | 'hitting' | PerformanceRollupSource;
type AxisInput = { source: ChartSource; metric: string; activities: string[] };
type MetricOption = { key: string; label: string; unit: string; activities: string[] };

const PITCH_TYPE_ORDER = ['Fastball', 'Sinker', 'Cutter', 'Slider', 'Sweeper', 'Curveball', 'ChangeUp', 'Splitter', 'Knuckleball'];

const SOURCE_LABELS: Record<ChartSource, string> = {
  pitching: 'Pitching',
  hitting: 'Hitting',
  axioforce: 'AxioForce Mound',
  vald: 'VALD Force Plates',
  ovr_sprint: 'OVR Sprint',
  ovr_vbt: 'OVR VBT',
};

const VALID_SOURCES = new Set<ChartSource>(Object.keys(SOURCE_LABELS) as ChartSource[]);

function normalizeName(value: unknown): string {
  return normalizePerformancePlayerName(String(value ?? ''));
}

function validIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function readAxis(url: URL, prefix: 'x' | 'y'): AxisInput | null {
  const source = String(url.searchParams.get(`${prefix}Source`) ?? '') as ChartSource;
  const metric = String(url.searchParams.get(`${prefix}Metric`) ?? '').trim();
  const rawActivities = String(url.searchParams.get(`${prefix}Activities`) ?? url.searchParams.get(`${prefix}Activity`) ?? 'All');
  const activities = Array.from(new Set(rawActivities.split(',').map((value) => value.trim()).filter(Boolean)));
  return VALID_SOURCES.has(source) && metric ? { source, metric, activities: activities.length ? activities : ['All'] } : null;
}

function orderedPitchTypes(values: string[]): string[] {
  const rank = (value: string) => {
    const index = PITCH_TYPE_ORDER.findIndex((pitchType) => pitchType.toLowerCase() === value.toLowerCase());
    return index < 0 ? PITCH_TYPE_ORDER.length : index;
  };
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function axisLabel(axis: AxisInput, option?: MetricOption): string {
  const performanceLabels: Record<string, string> = {
    total_time_seconds: 'Total Time (s)', split_time_seconds: 'Split Time (s)', speed_mph: 'Sprint Speed (mph)',
    load_lbs: 'Load (lb)', avg_velocity_mps: 'Average Velocity (m/s)', peak_velocity_mps: 'Peak Velocity (m/s)',
    avg_power_watts: 'Average Power (W)', peak_power_watts: 'Peak Power (W)', rom_inches: 'ROM (in)',
    duration_seconds: 'Duration (s)', tpv_seconds: 'Time to Peak Velocity (s)', ea_index: 'EA Index',
  };
  const [metricName, metricSuffix = ''] = axis.metric.split('\u001f');
  const decodedPerformanceMetric = axis.source === 'vald'
    ? `${metricName}${metricSuffix ? ` (${forcePlateDisplayUnit(metricSuffix)})` : ''}`
    : axis.source === 'axioforce'
      ? metricName
      : performanceLabels[axis.metric] ?? axis.metric;
  const metric = option?.label || (axis.source === 'pitching' || axis.source === 'hitting' ? dashboardMetricLabel(axis.metric) : decodedPerformanceMetric);
  const selectedActivities = axis.activities.filter((activity) => activity !== 'All');
  const activity = selectedActivities.length ? ` · ${selectedActivities.join(', ')}` : '';
  return `${SOURCE_LABELS[axis.source]} · ${metric}${activity}`;
}

async function loadLiveDashboardCatalog(source: 'pitching' | 'hitting', schoolCode: string): Promise<{ metrics: string[]; activities: string[] }> {
  const apiBase = resolveDashboardApiBaseUrl();
  const today = new Date().toISOString().slice(0, 10);
  const overviewUrl = new URL(`${apiBase}/v1/${source}/overview`);
  overviewUrl.searchParams.set('school_code', schoolCode);
  overviewUrl.searchParams.set('start_date', today);
  overviewUrl.searchParams.set('end_date', today);
  overviewUrl.searchParams.set('split_by', source === 'pitching' ? 'Pitcher' : 'Batter');
  overviewUrl.searchParams.set('include_chart_points', '0');
  const filtersUrl = new URL(`${apiBase}/v1/${source}/filters`);
  filtersUrl.searchParams.set('school_code', schoolCode);
  const [overview, filters] = await Promise.all([
    fetch(overviewUrl, { cache: 'no-store', signal: AbortSignal.timeout(20000) }).then(async (response) => response.ok ? await response.json() as Record<string, unknown> : {}).catch(() => ({} as Record<string, unknown>)),
    fetch(filtersUrl, { cache: 'no-store', signal: AbortSignal.timeout(20000) }).then(async (response) => response.ok ? await response.json() as Record<string, unknown> : {}).catch(() => ({} as Record<string, unknown>)),
  ]);
  const excluded = new Set(['#', 'Pitch', 'Pitcher', 'Batter', 'All', 'Overall', 'Usage']);
  const liveMetrics = Array.isArray(overview.available_table_columns)
    ? overview.available_table_columns.map((value: unknown) => String(value ?? '').trim()).filter((value: string) => value && !excluded.has(value))
    : [];
  const activities: string[] = Array.isArray(filters.pitch_types)
    ? filters.pitch_types.map((value: unknown) => String(value ?? '').trim()).filter(Boolean)
    : [];
  return {
    metrics: Array.from(new Set([...dashboardMetricOptions(source), ...liveMetrics])),
    activities: ['All', ...orderedPitchTypes(activities)],
  };
}

async function loadValdGroups(rosterNames: string[]) {
  const tenantId = String(process.env.VALD_FORCEDECKS_TENANT_ID ?? process.env.VALD_TEAM_ID ?? '').trim();
  if (!tenantId || !rosterNames.length) return [];
  const directory = await fetchValdProfileGroupDirectory(tenantId).catch(() => []);
  const memberships = await Promise.all(directory.map(async (group) => ({
    group,
    names: await fetchValdProfileNamesForGroup(tenantId, group.id).catch(() => []),
  })));
  const rosterByNorm = new Map(rosterNames.map((name) => [normalizeName(name), name]));
  return memberships.flatMap(({ group, names }) => {
    const memberNames = Array.from(new Set(names.map((name) => rosterByNorm.get(normalizeName(name))).filter((name): name is string => Boolean(name))));
    if (!memberNames.length) return [];
    return [{
      id: group.id,
      name: group.name,
      categoryName: group.categoryName,
      label: group.categoryName ? `${group.categoryName} · ${group.name}` : group.name,
      memberNames,
    }];
  });
}

async function catalogResponse(request: Request, access: Awaited<ReturnType<typeof requireAiAccess>>, schoolCode: string) {
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  await ensurePerformanceRollupSchema();
  const [performance, dateRange, roster, pitching, hitting] = await Promise.all([
    getDbPool().query<{
      source: PerformanceRollupSource; metric_key: string; metric_name: string; metric_unit: string; activities: string[];
    }>(
      `SELECT source, metric_key, MAX(metric_name) AS metric_name, MAX(metric_unit) AS metric_unit,
              array_agg(DISTINCT activity_type ORDER BY activity_type) AS activities
       FROM performance_metric_daily_rollups
       WHERE organization_id=$1 AND school_code=$2
       GROUP BY source, metric_key
       ORDER BY source, metric_name, metric_unit, metric_key`,
      [access.organizationId, schoolCode]
    ),
    getDbPool().query<{ min_date: string | null; max_date: string | null }>(
      `SELECT MIN(session_date)::text AS min_date, MAX(session_date)::text AS max_date
       FROM performance_metric_daily_rollups WHERE organization_id=$1 AND school_code=$2`,
      [access.organizationId, schoolCode]
    ),
    listPlayerChoicesByOrganization({ organizationId: access.organizationId, assignedCoachUserId: null }),
    loadLiveDashboardCatalog('pitching', schoolCode),
    loadLiveDashboardCatalog('hitting', schoolCode),
  ]);

  const own = access.role === 'player'
    ? await getPlayerForUser({ organizationId: access.organizationId, userId: access.userId })
    : null;
  const players = access.role === 'player'
    ? (own?.fullName ? [{ id: own.id, name: own.fullName }] : [])
    : roster.map((player) => ({ id: player.playerId, name: player.fullName }));
  const valdGroups = access.role === 'player' ? [] : await loadValdGroups(players.map((player) => player.name));
  const bySource = new Map<ChartSource, MetricOption[]>();
  for (const row of performance.rows) {
    const list = bySource.get(row.source) ?? [];
    const displayUnit = row.source === 'vald' ? forcePlateDisplayUnit(row.metric_unit) : row.metric_unit;
    list.push({
      key: row.metric_key,
      label: `${row.metric_name}${displayUnit ? ` (${displayUnit})` : ''}`,
      unit: row.metric_unit,
      activities: row.source === 'axioforce'
        ? ['All', ...(row.activities ?? []).filter(Boolean)]
        : (row.activities ?? []).filter(Boolean),
    });
    bySource.set(row.source, list);
  }
  bySource.set('pitching', pitching.metrics.map((metric) => ({ key: metric, label: dashboardMetricLabel(metric), unit: '', activities: pitching.activities })));
  bySource.set('hitting', hitting.metrics.map((metric) => ({ key: metric, label: dashboardMetricLabel(metric), unit: '', activities: hitting.activities })));

  const sources = (Object.keys(SOURCE_LABELS) as ChartSource[])
    .map((source) => ({ key: source, label: SOURCE_LABELS[source], metrics: bySource.get(source) ?? [] }))
    .filter((source) => source.metrics.length > 0);
  return NextResponse.json({
    sources,
    players,
    groups: valdGroups,
    minDate: dateRange.rows[0]?.min_date?.slice(0, 10) ?? '',
    maxDate: dateRange.rows[0]?.max_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  }, { headers: { 'cache-control': 'private, max-age=30, stale-while-revalidate=120' } });
}

async function loadPerformanceAxis(args: {
  access: Extract<Awaited<ReturnType<typeof requireAiAccess>>, { ok: true }>;
  schoolCode: string;
  axis: AxisInput;
  startDate: string;
  endDate: string;
  allowedPlayers: string[];
}): Promise<Map<string, { name: string; value: number; samples: number }>> {
  const rows = await loadPerformanceDailyRollups({
    organizationId: args.access.organizationId,
    schoolCode: args.schoolCode,
    source: args.axis.source as PerformanceRollupSource,
    playerNames: args.allowedPlayers,
    startDate: args.startDate,
    endDate: args.endDate,
    activityTypes: args.axis.activities.includes('All') ? undefined : args.axis.activities,
    metricKeys: [args.axis.metric],
  });
  const totals = new Map<string, { name: string; sum: number; samples: number }>();
  for (const row of rows) {
    const key = row.playerNameNorm || normalizeName(row.playerName);
    const current = totals.get(key) ?? { name: row.playerName, sum: 0, samples: 0 };
    current.sum += row.valueSum;
    current.samples += row.sampleCount;
    totals.set(key, current);
  }
  return new Map(Array.from(totals, ([key, value]) => [key, { name: value.name, value: value.sum / value.samples, samples: value.samples }]));
}

async function loadPerformanceObservations(args: {
  access: Extract<Awaited<ReturnType<typeof requireAiAccess>>, { ok: true }>;
  schoolCode: string;
  axis: AxisInput;
  startDate: string;
  endDate: string;
  allowedPlayers: string[];
}): Promise<Map<string, { name: string; date: string; value: number; samples: number }>> {
  const rows = await loadPerformanceDailyRollups({
    organizationId: args.access.organizationId,
    schoolCode: args.schoolCode,
    source: args.axis.source as PerformanceRollupSource,
    playerNames: args.allowedPlayers,
    startDate: args.startDate,
    endDate: args.endDate,
    activityTypes: args.axis.activities.includes('All') ? undefined : args.axis.activities,
    metricKeys: [args.axis.metric],
  });
  const totals = new Map<string, { name: string; date: string; sum: number; samples: number }>();
  for (const row of rows) {
    const playerKey = row.playerNameNorm || normalizeName(row.playerName);
    const key = `${playerKey}\u0000${row.sessionDate}`;
    const current = totals.get(key) ?? { name: row.playerName, date: row.sessionDate, sum: 0, samples: 0 };
    current.sum += row.valueSum;
    current.samples += row.sampleCount;
    totals.set(key, current);
  }
  return new Map(Array.from(totals, ([key, value]) => [key, {
    name: value.name,
    date: value.date,
    value: value.samples > 0 ? value.sum / value.samples : value.sum,
    samples: value.samples,
  }]));
}

async function loadDashboardAxes(args: {
  source: 'pitching' | 'hitting'; axes: AxisInput[]; schoolCode: string; startDate: string; endDate: string; allowedPlayers: string[];
}): Promise<Map<string, Map<string, { name: string; value: number; samples: number }>>> {
  const axisKey = (axis: AxisInput) => `${axis.metric}\u0000${axis.activities.join(',')}`;
  const uniqueAxes = Array.from(new Map(args.axes.map((axis) => [axisKey(axis), axis])).values());
  const batches = await Promise.all(uniqueAxes.map(async (axis) => {
    const sampleColumn = metricSampleColumn(args.source, axis.metric);
    const url = new URL(`${resolveDashboardApiBaseUrl()}/v1/${args.source}/overview`);
    url.searchParams.set('school_code', args.schoolCode);
    url.searchParams.set('start_date', args.startDate);
    url.searchParams.set('end_date', args.endDate);
    url.searchParams.set('split_by', args.source === 'pitching' ? 'Pitcher' : 'Batter');
    url.searchParams.set('table_mode', 'Custom');
    url.searchParams.set('custom_columns', Array.from(new Set([sampleColumn, axis.metric])).join(','));
    url.searchParams.set('include_chart_points', '0');
    if (!axis.activities.includes('All')) url.searchParams.set('pitch_types', axis.activities.join(','));
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(60000) });
    const payload = await response.json().catch(() => ({})) as { table_rows?: Array<Record<string, unknown>>; error?: string; detail?: string };
    if (!response.ok) throw new Error(payload.error ?? payload.detail ?? `Could not load ${SOURCE_LABELS[args.source]} data.`);
    const playerColumn = args.source === 'pitching' ? 'Pitcher' : 'Batter';
    const allowed = new Set(args.allowedPlayers.map(normalizeName));
    const values = new Map<string, { name: string; value: number; samples: number }>();
    for (const row of payload.table_rows ?? []) {
      const name = String(row[playerColumn] ?? '').trim();
      const key = normalizeName(name);
      if (!key || name.toLowerCase() === 'all' || !allowed.has(key)) continue;
      const value = parseSortableNumber(row[axis.metric]);
      if (value === null) continue;
      values.set(key, { name, value, samples: parseSortableNumber(row[sampleColumn]) ?? 0 });
    }
    return [axisKey(axis), values] as const;
  }));
  return new Map(batches);
}

export async function GET(request: Request) {
  const access = await requireAiAccess(request, false);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const schoolCode = resolveDashboardSchoolCode({
    userId: access.session.userId ?? 0,
    email: access.session.email,
    name: access.session.name,
    role: access.role === 'player' ? 'player' : access.role === 'coach' ? 'coach' : 'admin',
    organizationId: access.session.organizationId ?? access.organizationId,
    playerId: access.session.playerId ?? null,
    dashboardSchoolCode: access.session.dashboardSchoolCode ?? null,
    appUrl: access.session.appUrl,
    apps: access.session.apps,
  });
  const url = new URL(request.url);
  if ((url.searchParams.get('mode') ?? 'catalog') === 'catalog') return catalogResponse(request, access, schoolCode);

  const xAxis = readAxis(url, 'x');
  const yAxis = readAxis(url, 'y');
  const startDate = String(url.searchParams.get('startDate') ?? '');
  const endDate = String(url.searchParams.get('endDate') ?? '');
  if (!xAxis || !yAxis || !validIsoDate(startDate) || !validIsoDate(endDate) || startDate > endDate) {
    return NextResponse.json({ error: 'Choose two metrics and a valid date range.' }, { status: 400 });
  }

  const roster = await listPlayerChoicesByOrganization({ organizationId: access.organizationId, assignedCoachUserId: null });
  let allowedPlayers = roster.map((player) => player.fullName).filter(Boolean);
  if (access.role === 'player') {
    const own = await getPlayerForUser({ organizationId: access.organizationId, userId: access.userId });
    allowedPlayers = own?.fullName ? [own.fullName] : [];
  } else {
    const requestedGroupIds = new Set(String(url.searchParams.get('groupIds') ?? '').split(',').map((value) => value.trim()).filter(Boolean));
    if (requestedGroupIds.size) {
      const valdGroups = await loadValdGroups(allowedPlayers);
      const selectedGroupNames = new Set(valdGroups.filter((group) => requestedGroupIds.has(group.id)).flatMap((group) => group.memberNames).map(normalizeName));
      allowedPlayers = allowedPlayers.filter((name) => selectedGroupNames.has(normalizeName(name)));
    }
    const requestedPlayerNorms = new Set(String(url.searchParams.get('players') ?? '').split(',').map(normalizeName).filter(Boolean));
    if (requestedPlayerNorms.size) {
      allowedPlayers = allowedPlayers.filter((name) => requestedPlayerNorms.has(normalizeName(name)));
    }
  }
  if (!allowedPlayers.length) return NextResponse.json({ rows: [], xLabel: axisLabel(xAxis), yLabel: axisLabel(yAxis), matchedPlayers: 0 });

  const pointMode = url.searchParams.get('pointMode') === 'observations' ? 'observations' : 'averages';
  if (pointMode === 'observations') {
    if (xAxis.source === 'pitching' || xAxis.source === 'hitting' || yAxis.source === 'pitching' || yAxis.source === 'hitting') {
      return NextResponse.json({ error: 'Every data point currently supports VALD, AxioForce, Sprint, and VBT. Use athlete averages when either axis is Pitching or Hitting.' }, { status: 400 });
    }
    const [xObservations, yObservations] = await Promise.all([
      loadPerformanceObservations({ access, schoolCode, axis: xAxis, startDate, endDate, allowedPlayers }),
      loadPerformanceObservations({ access, schoolCode, axis: yAxis, startDate, endDate, allowedPlayers }),
    ]);
    const xLabel = axisLabel(xAxis);
    const yLabel = axisLabel(yAxis);
    const rows = Array.from(xObservations.entries()).flatMap(([key, x]) => {
      const y = yObservations.get(key);
      if (!y || !Number.isFinite(x.value) || !Number.isFinite(y.value)) return [];
      return [{
        'Data Point': `${x.name} · ${x.date}`,
        Player: x.name,
        Date: x.date,
        [xLabel]: x.value,
        [yLabel]: y.value,
        XSamples: x.samples,
        YSamples: y.samples,
      }];
    });
    return NextResponse.json({ rows, xLabel, yLabel, matchedPlayers: new Set(rows.map((row) => row.Player)).size, matchedPoints: rows.length, eligiblePlayers: allowedPlayers.length, pointMode }, {
      headers: { 'cache-control': 'private, max-age=30, stale-while-revalidate=120' },
    });
  }

  const dashboardAxes = [xAxis, yAxis].filter((axis): axis is AxisInput & { source: 'pitching' | 'hitting' } => axis.source === 'pitching' || axis.source === 'hitting');
  const [pitchingMaps, hittingMaps, xPerformance, yPerformance] = await Promise.all([
    dashboardAxes.some((axis) => axis.source === 'pitching')
      ? loadDashboardAxes({ source: 'pitching', axes: dashboardAxes.filter((axis) => axis.source === 'pitching'), schoolCode, startDate, endDate, allowedPlayers })
      : Promise.resolve(new Map()),
    dashboardAxes.some((axis) => axis.source === 'hitting')
      ? loadDashboardAxes({ source: 'hitting', axes: dashboardAxes.filter((axis) => axis.source === 'hitting'), schoolCode, startDate, endDate, allowedPlayers })
      : Promise.resolve(new Map()),
    xAxis.source !== 'pitching' && xAxis.source !== 'hitting'
      ? loadPerformanceAxis({ access, schoolCode, axis: xAxis, startDate, endDate, allowedPlayers })
      : Promise.resolve(null),
    yAxis.source !== 'pitching' && yAxis.source !== 'hitting'
      ? loadPerformanceAxis({ access, schoolCode, axis: yAxis, startDate, endDate, allowedPlayers })
      : Promise.resolve(null),
  ]);

  const axisMap = (axis: AxisInput, performance: Map<string, { name: string; value: number; samples: number }> | null) => {
    if (performance) return performance;
    const sourceMaps = axis.source === 'pitching' ? pitchingMaps : hittingMaps;
    return sourceMaps.get(`${axis.metric}\u0000${axis.activities.join(',')}`) ?? new Map<string, { name: string; value: number; samples: number }>();
  };
  const xValues = axisMap(xAxis, xPerformance);
  const yValues = axisMap(yAxis, yPerformance);
  const canonicalNames = new Map(allowedPlayers.map((name) => [normalizeName(name), name]));
  const xLabel = axisLabel(xAxis);
  const yLabel = axisLabel(yAxis);
  const rows = Array.from(canonicalNames.entries()).flatMap(([key, name]) => {
    const x = xValues.get(key);
    const y = yValues.get(key);
    if (!x || !y || !Number.isFinite(x.value) || !Number.isFinite(y.value)) return [];
    return [{ Player: name || x.name || y.name, [xLabel]: x.value, [yLabel]: y.value, XSamples: x.samples, YSamples: y.samples }];
  });
  return NextResponse.json({ rows, xLabel, yLabel, matchedPlayers: rows.length, eligiblePlayers: allowedPlayers.length, pointMode }, {
    headers: { 'cache-control': 'private, max-age=30, stale-while-revalidate=120' },
  });
}

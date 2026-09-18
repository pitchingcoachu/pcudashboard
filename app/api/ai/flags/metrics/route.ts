import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../../lib/ai-access';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { biomechanicsFlagMetric, dashboardMetricOptions, forcePlateFlagMetric, ovrSprintFlagMetric } from '../../../../../lib/dashboard-metric-catalog';
import { loadForcePlateMetricCatalog } from '../../../../../lib/force-plate-neon-db';
import { listOvrSprintResults } from '../../../../../lib/ovr-sprint';

// Mirrors lib/biomechanics-db.ts's tableColumnNames minus the identity
// columns (Name/Date/#/Pitch Type/Tags) -- a fixed, data-independent list,
// so this route doesn't need to run the (expensive) full snapshot query
// just to discover it. Keep in sync if that list changes.
const BIOMECHANICS_FLAGGABLE_COLUMNS = [
  'Pitch Velocity (mph)',
  'Back Leg Peak Fz (lb)',
  'Peak De-Weighting (lb)',
  'Z-Force Gain (lb)',
  'Back Leg Peak Fy (lb)',
  'Mound Connection (BW%)',
  'Back Leg Impulse (lb·s)',
  'Back Leg Impulse Time (s)',
  'Back Leg YZ Transfer (s)',
  'Lead Leg Peak Fz (lb)',
  'Lead Leg Peak Fy (lb)',
  'Lead Leg Clawback (s)',
  'Lead Leg FFC to Peak Y (s)',
  'Lead Leg YZ Transfer (s)',
  'Y Transfer (s)',
  'Z Transfer (s)',
  'Stride Length (in)',
  'Stride Direction (deg)',
];

type Domain = 'pitching' | 'hitting';

function cleanColumns(value: unknown, domain: Domain): string[] {
  const excluded = new Set(['#', 'Pitch', 'Pitcher', 'Batter', 'All', 'Overall', 'Usage']);
  const live = Array.isArray(value) ? value.map((entry) => String(entry ?? '').trim()).filter((entry) => entry && !excluded.has(entry)) : [];
  return live.length ? Array.from(new Set(live)) : dashboardMetricOptions(domain);
}

export async function GET(request: Request) {
  const access = await requireAiAccess(request, true);
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
  const today = new Date().toISOString().slice(0, 10);
  const apiBase = resolveDashboardApiBaseUrl();
  const load = async (domain: Domain) => {
    const url = new URL(`${apiBase}/v1/${domain}/overview`);
    url.searchParams.set('school_code', schoolCode);
    url.searchParams.set('start_date', today);
    url.searchParams.set('end_date', today);
    url.searchParams.set('split_by', domain === 'pitching' ? 'Pitcher' : 'Batter');
    url.searchParams.set('include_chart_points', '0');
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const payload = await response.json().catch(() => ({})) as { available_table_columns?: unknown };
      return cleanColumns(payload.available_table_columns, domain);
    } catch {
      return dashboardMetricOptions(domain);
    }
  };
  const [pitching, hitting, forcePlateCatalog, ovrSprintExercises] = await Promise.all([
    load('pitching'),
    load('hitting'),
    loadForcePlateMetricCatalog({ organizationId: access.organizationId, schoolCode }).catch(() => ({ metrics: [], testTypes: [] })),
    listOvrSprintResults({ organizationId: access.organizationId, schoolCode }).then((rows) => Array.from(new Set(rows.map((row) => row.exercise))).sort((a, b) => a.localeCompare(b))).catch(() => [] as string[]),
  ]);
  return NextResponse.json({
    metrics: {
      pitching,
      hitting,
      force_plates: forcePlateCatalog.metrics.map((metric) => forcePlateFlagMetric(metric.metricName, metric.metricUnit)),
      ovr_sprint: ovrSprintExercises.flatMap((exercise) => [ovrSprintFlagMetric(exercise, 'totalTime'), ovrSprintFlagMetric(exercise, 'speedMph')]),
      biomechanics: BIOMECHANICS_FLAGGABLE_COLUMNS.map((column) => biomechanicsFlagMetric(column)),
    },
    forcePlateTestTypes: forcePlateCatalog.testTypes,
    forcePlateTestTypesByMetric: Object.fromEntries(forcePlateCatalog.metrics.map((metric) => [
      forcePlateFlagMetric(metric.metricName, metric.metricUnit),
      metric.testTypes,
    ])),
  });
}

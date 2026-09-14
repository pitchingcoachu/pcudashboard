import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { forcePlateFlagMetric } from '../../../../../lib/dashboard-metric-catalog';
import { loadForcePlateMetricCatalog } from '../../../../../lib/force-plate-neon-db';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import { getPlayerForUser, listPlayerChoicesByOrganization } from '../../../../../lib/training-db';

export async function GET() {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session)) || resolveProgrammingSchoolCode(session) !== 'PCU') {
    return NextResponse.json({ error: 'Force Plate Data is not available.' }, { status: 403 });
  }
  const organizationId = await resolveProgrammingOrganizationId(session);
  const roster = await listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null });
  let players = Array.from(new Set(roster.map((player) => String(player.fullName ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  if (session.role === 'player') {
    const own = await getPlayerForUser({ organizationId, userId: session.userId ?? 0 });
    players = own?.fullName ? [own.fullName] : [];
  }
  const catalog = await loadForcePlateMetricCatalog({ organizationId, schoolCode: 'PCU' });
  return NextResponse.json({
    school_code: 'PCU',
    players,
    metrics: catalog.metrics.map((metric) => ({
      value: forcePlateFlagMetric(metric.metricName, metric.metricUnit),
      label: `${metric.metricName}${metric.metricUnit ? ` (${metric.metricUnit})` : ''}`,
      testTypes: metric.testTypes,
    })),
    test_types: catalog.testTypes,
    min_date: null,
    max_date: null,
  }, { headers: { 'cache-control': 'private, max-age=30, stale-while-revalidate=120' } });
}

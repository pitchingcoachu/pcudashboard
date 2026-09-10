import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../../lib/ai-access';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { dashboardMetricOptions } from '../../../../../lib/dashboard-metric-catalog';

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
  const [pitching, hitting] = await Promise.all([load('pitching'), load('hitting')]);
  return NextResponse.json({ metrics: { pitching, hitting } });
}

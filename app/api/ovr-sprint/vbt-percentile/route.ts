import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { getOvrVbtPercentiles, listOvrVbtGroups } from '../../../../lib/ovr-sprint';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { getPlayerForUser } from '../../../../lib/training-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = getSessionFromCookies(await cookies());
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const schoolCode = resolveDashboardSchoolCode({
      userId: session.userId ?? 0,
      email: session.email,
      name: session.name,
      role: session.role ?? 'admin',
      organizationId: session.organizationId ?? 0,
      playerId: session.playerId ?? null,
      dashboardSchoolCode: session.dashboardSchoolCode ?? null,
      appUrl: session.appUrl,
      apps: session.apps,
    }).trim().toUpperCase();
    if (schoolCode !== 'PCU') return NextResponse.json({ error: 'OVR Data is currently available only for PCU.' }, { status: 403 });
    const organizationId = await resolveProgrammingOrganizationId(session);
    const url = new URL(request.url);
    const playerId = Number(url.searchParams.get('playerId') ?? '0');
    const exercise = String(url.searchParams.get('exercise') ?? '').trim();
    const loadRaw = String(url.searchParams.get('load') ?? '').trim();
    const loadLbs = loadRaw && loadRaw !== 'All' ? Number(loadRaw) : null;
    const groupRaw = String(url.searchParams.get('groupId') ?? 'all').trim();
    const groupId: number | 'all' = groupRaw === 'all' || !groupRaw ? 'all' : Number(groupRaw);
    const startDate = String(url.searchParams.get('startDate') ?? '').trim() || null;
    const endDate = String(url.searchParams.get('endDate') ?? '').trim() || null;
    if (!Number.isFinite(playerId) || playerId <= 0 || !exercise || exercise === 'All') {
      return NextResponse.json({ error: 'A valid player and VBT exercise are required.' }, { status: 400 });
    }
    if (loadLbs !== null && !Number.isFinite(loadLbs)) return NextResponse.json({ error: 'Invalid load.' }, { status: 400 });
    if (groupId !== 'all' && (!Number.isFinite(groupId) || groupId <= 0)) return NextResponse.json({ error: 'Invalid group.' }, { status: 400 });
    if (session.role === 'player') {
      const own = await getPlayerForUser({ organizationId, userId: session.userId ?? 0 });
      if (!own || own.id !== playerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const [groups, result] = await Promise.all([
      listOvrVbtGroups({ organizationId, schoolCode }),
      getOvrVbtPercentiles({ organizationId, schoolCode, playerId, exercise, loadLbs, groupId, startDate, endDate }),
    ]);
    return NextResponse.json({
      groups,
      selectedGroupId: groupId,
      comparisonWindow: 'full_history',
      selectedWindow: { startDate, endDate },
      result,
    }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load VBT percentiles.' }, { status: 500 });
  }
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { getPlayerForUser } from '../../../../lib/training-db';
import { getOvrSprintPercentile, listOvrSprintGroups } from '../../../../lib/ovr-sprint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authContext() {
  const session = getSessionFromCookies(await cookies());
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
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
  if (schoolCode !== 'PCU') return { error: NextResponse.json({ error: 'OVR Sprint is currently available only for PCU.' }, { status: 403 }) } as const;
  const organizationId = await resolveProgrammingOrganizationId(session);
  return { session, schoolCode, organizationId } as const;
}

export async function GET(request: Request) {
  try {
    const auth = await authContext();
    if ('error' in auth) return auth.error;

    const url = new URL(request.url);
    const playerId = Number(url.searchParams.get('playerId') ?? '0');
    const exercises = Array.from(new Set(url.searchParams.getAll('exercise').map((entry) => entry.trim()).filter(Boolean)));
    const metric = url.searchParams.get('metric') === 'speedMph' ? 'speedMph' : 'totalTime';
    const groupIdRaw = String(url.searchParams.get('groupId') ?? 'all').trim();
    const groupId: number | 'all' = groupIdRaw === 'all' || !groupIdRaw ? 'all' : Number(groupIdRaw);
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    if (!Number.isFinite(playerId) || playerId <= 0 || !exercises.length) {
      return NextResponse.json({ error: 'Valid playerId and at least one exercise are required.' }, { status: 400 });
    }
    if (groupId !== 'all' && (!Number.isFinite(groupId) || groupId <= 0)) {
      return NextResponse.json({ error: 'Invalid groupId.' }, { status: 400 });
    }

    if (auth.session.role === 'player') {
      const own = await getPlayerForUser({ organizationId: auth.organizationId, userId: auth.session.userId ?? 0 });
      if (!own || own.id !== playerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [groups, resultByExercise] = await Promise.all([
      listOvrSprintGroups({ organizationId: auth.organizationId, schoolCode: auth.schoolCode }),
      getOvrSprintPercentile({
        organizationId: auth.organizationId,
        schoolCode: auth.schoolCode,
        playerId,
        exercises,
        metric,
        groupId,
        startDate,
        endDate,
      }),
    ]);

    return NextResponse.json({
      groups,
      selectedGroupId: groupId,
      results: Object.fromEntries(resultByExercise),
    }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load percentile data.' }, { status: 500 });
  }
}

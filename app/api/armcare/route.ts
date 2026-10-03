import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/auth';
import { armCareExamsAsBodyWeightPercent, calculateArmCarePercentiles, listArmCareExams, normalizeArmCarePlayerName, syncArmCareExams } from '../../../lib/armcare';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { resolveProgrammingOrganizationId } from '../../../lib/programming-scope';
import { getPlayerForUser, listDashboardPlayerGroups, listPlayerChoicesByOrganization } from '../../../lib/training-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function authContext(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
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
  if (schoolCode !== 'PCU') {
    return { error: NextResponse.json({ error: 'ArmCare Metrics are currently available only for PCU.' }, { status: 403 }) } as const;
  }
  const organizationId = await resolveProgrammingOrganizationId(session);
  return { session, schoolCode, organizationId } as const;
}

export async function GET(request: Request) {
  try {
    const auth = await authContext(request);
    if ('error' in auth) return auth.error;
    const searchParams = new URL(request.url).searchParams;
    const comparisonStartDate = String(searchParams.get('comparisonStartDate') ?? '2026-05-01').trim();
    const comparisonEndDate = String(searchParams.get('comparisonEndDate') ?? new Date().toISOString().slice(0, 10)).trim();
    const requestedGroupId = String(searchParams.get('groupId') ?? 'all').trim();
    let playerId: number | null = null;
    let playerName = '';
    if (auth.session.role === 'player') {
      const ownPlayer = await getPlayerForUser({ organizationId: auth.organizationId, userId: auth.session.userId ?? 0 });
      if (!ownPlayer) return NextResponse.json({ exams: [], players: [], lastSyncedAt: null, percentilesByExamId: {}, bodyWeightPercentilesByExamId: {}, groups: [] }, { headers: { 'cache-control': 'private, no-store' } });
      playerId = ownPlayer.id;
      playerName = ownPlayer.fullName;
    } else {
      const requestedName = String(searchParams.get('player') ?? '').trim();
      if (requestedName) {
        const roster = await listPlayerChoicesByOrganization({ organizationId: auth.organizationId });
        const requestedNorm = normalizeArmCarePlayerName(requestedName);
        const selected = roster.find((player) => normalizeArmCarePlayerName(player.fullName) === requestedNorm);
        if (!selected) return NextResponse.json({ error: 'That player is not available in this organization.' }, { status: 404 });
        playerId = selected.playerId;
        playerName = selected.fullName;
      }
    }
    const result = await listArmCareExams({
      organizationId: auth.organizationId,
      schoolCode: auth.schoolCode,
      playerId,
      playerName: playerId ? '' : playerName,
    });
    const population = playerId
      ? await listArmCareExams({ organizationId: auth.organizationId, schoolCode: auth.schoolCode })
      : result;
    const players = Array.from(new Set(result.exams.map((exam) => exam.playerName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const dashboardGroups = auth.session.role === 'player' ? [] : await listDashboardPlayerGroups({
      organizationId: auth.organizationId,
      startDate: comparisonStartDate,
      endDate: comparisonEndDate,
    });
    const selectedGroup = requestedGroupId === 'all'
      ? null
      : dashboardGroups.find((group) => String(group.id) === requestedGroupId) ?? null;
    const selectedGroupId = selectedGroup ? String(selectedGroup.id) : 'all';
    const percentilesByExamId = calculateArmCarePercentiles(result.exams, population.exams, {
      cohortPlayerNames: selectedGroup?.memberNames,
      comparisonStartDate,
      comparisonEndDate,
    });
    const bodyWeightPercentilesByExamId = calculateArmCarePercentiles(
      armCareExamsAsBodyWeightPercent(result.exams),
      armCareExamsAsBodyWeightPercent(population.exams),
      {
        cohortPlayerNames: selectedGroup?.memberNames,
        comparisonStartDate,
        comparisonEndDate,
      },
    );
    const groups = dashboardGroups.map((group) => ({ id: String(group.id), label: group.name, memberCount: group.memberNames.length }));
    return NextResponse.json({ ...result, players, percentilesByExamId, bodyWeightPercentilesByExamId, groups, selectedGroupId, comparisonStartDate, comparisonEndDate }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load ArmCare Metrics.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authContext(request);
    if ('error' in auth) return auth.error;
    if (auth.session.role !== 'admin' && auth.session.role !== 'coach') {
      return NextResponse.json({ error: 'Only coaches and administrators can sync ArmCare data.' }, { status: 403 });
    }
    const result = await syncArmCareExams({ organizationId: auth.organizationId, schoolCode: auth.schoolCode });
    return NextResponse.json({ ok: true, ...result }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to sync ArmCare Metrics.' }, { status: 500 });
  }
}

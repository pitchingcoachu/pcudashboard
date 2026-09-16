import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { listOvrSprintResults } from '../../../../../lib/ovr-sprint';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import { getPlayerForUser, listPlayerChoicesByOrganization } from '../../../../../lib/training-db';

export async function GET() {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session)) || resolveProgrammingSchoolCode(session) !== 'PCU') {
    return NextResponse.json({ error: 'OVR Sprint data is not available.' }, { status: 403 });
  }
  const organizationId = await resolveProgrammingOrganizationId(session);
  const roster = await listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null });
  let rosterEntries = roster.map((player) => ({ id: player.playerId, name: String(player.fullName ?? '').trim() })).filter((entry) => entry.name);
  if (session.role === 'player') {
    const own = await getPlayerForUser({ organizationId, userId: session.userId ?? 0 });
    rosterEntries = own?.fullName ? [{ id: own.id, name: own.fullName }] : [];
  }
  const players = Array.from(new Set(rosterEntries.map((entry) => entry.name))).sort((a, b) => a.localeCompare(b));
  const results = await listOvrSprintResults({ organizationId, schoolCode: 'PCU' });
  const exercises = Array.from(new Set(results.map((row) => row.exercise))).sort((a, b) => a.localeCompare(b));
  return NextResponse.json({
    school_code: 'PCU',
    players,
    player_ids: rosterEntries,
    exercises: exercises.map((exercise) => ({ value: exercise, label: exercise })),
  }, { headers: { 'cache-control': 'private, max-age=30, stale-while-revalidate=120' } });
}

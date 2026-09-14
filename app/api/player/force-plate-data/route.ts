import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { getPlayerForUser, listPlayerChoicesByOrganization } from '../../../../lib/training-db';
import { loadForcePlateSnapshotFromNeon } from '../../../../lib/force-plate-neon-db';

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

export async function GET(request: Request) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session)) || resolveProgrammingSchoolCode(session) !== 'PCU') {
    return NextResponse.json({ error: 'Force Plate Data is not available.' }, { status: 403 });
  }
  const organizationId = await resolveProgrammingOrganizationId(session);
  const requestedName = String(new URL(request.url).searchParams.get('player') ?? '').trim();
  if (!requestedName) return NextResponse.json({ error: 'Player is required.' }, { status: 400 });

  const roster = await listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null });
  const rosterPlayer = roster.find((player) => normalizeName(player.fullName) === normalizeName(requestedName));
  if (!rosterPlayer) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });
  if (session.role === 'player') {
    const own = await getPlayerForUser({ organizationId, userId: session.userId ?? 0 });
    if (!own || normalizeName(own.fullName) !== normalizeName(rosterPlayer.fullName)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const result = await loadForcePlateSnapshotFromNeon({
    organizationId,
    schoolCode: 'PCU',
    allowedPlayerNames: [rosterPlayer.fullName],
    metricPlayerNames: [rosterPlayer.fullName],
    pointTypes: ['average'],
  });
  const player = result.snapshot?.players[0] ?? null;
  return NextResponse.json({ player }, { headers: { 'cache-control': 'private, no-store' } });
}

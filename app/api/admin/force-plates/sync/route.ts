import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import { listPlayerChoicesByOrganization } from '../../../../../lib/training-db';
import { fetchValdForceDecksSnapshot } from '../../../../../lib/vald-forceplates';
import { saveForcePlateSnapshot } from '../../../../../lib/force-plate-cache-db';

function toFirstLast(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',').map((x) => x.trim());
  const first = rest.join(' ').trim();
  return first && last ? `${first} ${last}` : raw;
}

export async function POST() {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!canUseProgrammingData(session)) {
    return NextResponse.json({ error: 'Programming access required.' }, { status: 403 });
  }
  const schoolCode = resolveProgrammingSchoolCode(session);
  if (schoolCode !== 'PCU') {
    return NextResponse.json({ error: 'Force Plate Sync is enabled only for PCU.' }, { status: 400 });
  }

  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return NextResponse.json({ error: 'Invalid programming organization.' }, { status: 400 });
  }

  const players = await listPlayerChoicesByOrganization({
    organizationId,
    assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
  });
  const names = Array.from(new Set(players.map((player) => toFirstLast(String(player.fullName ?? '').trim())).filter(Boolean)));
  if (!names.length) return NextResponse.json({ error: 'No players found for sync.' }, { status: 400 });

  const snapshot = await fetchValdForceDecksSnapshot(names);
  const write = await saveForcePlateSnapshot({ organizationId, schoolCode, snapshot });
  if (!write.ok) return NextResponse.json({ error: write.error }, { status: 500 });

  return NextResponse.json({
    ok: true,
    playerCount: snapshot.players.length,
    fetchedAt: snapshot.fetchedAt,
  });
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { listMessageablePlayersForOrganization } from '../../../../lib/messaging-db';
import { listCoachesByOrganization } from '../../../../lib/training-db';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const organizationId = Number(session.organizationId ?? 0);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'No organization found for session.' }, { status: 403 });
  }

  const coaches = await listCoachesByOrganization(organizationId);
  // listCoachesByOrganization's userId can come back as a string at runtime
  // despite being typed as number (see identical note in
  // conversations/route.ts) -- coerce before comparing against session.userId.
  const coachOptions = coaches
    .filter((c) => Number(c.userId) !== (session.userId ?? -1))
    .map((c) => ({ userId: Number(c.userId), name: c.name, role: c.role }));

  if (session.role === 'player') {
    return NextResponse.json({ coaches: coachOptions });
  }

  if (session.role === 'coach' || session.role === 'admin') {
    const players = await listMessageablePlayersForOrganization(organizationId);
    return NextResponse.json({
      players: players.map((p) => ({ userId: p.userId, playerId: p.playerId, fullName: p.fullName })),
      coaches: coachOptions,
    });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

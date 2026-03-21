import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { getPlayerForUser, listClientsByOrganization } from '../../../../../lib/training-db';

export async function GET() {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.role === 'player') {
    const own = await getPlayerForUser({
      organizationId: session.organizationId ?? 0,
      userId: session.userId ?? 0,
    });
    if (!own) return NextResponse.json({ players: [] });
    return NextResponse.json({
      players: [
        {
          playerId: own.id,
          fullName: own.fullName,
          throwsHand: own.throwsHand,
          batsHand: own.batsHand,
          position: own.position,
        },
      ],
    });
  }

  const clients = await listClientsByOrganization(session.organizationId ?? 0);
  const filtered = session.role === 'coach' ? clients.filter((client) => client.assignedCoachUserId === session.userId) : clients;
  return NextResponse.json({
    players: filtered.map((player) => ({
      playerId: player.playerId,
      fullName: player.fullName,
      throwsHand: player.throwsHand,
      batsHand: player.batsHand,
      position: player.position,
    })),
  });
}

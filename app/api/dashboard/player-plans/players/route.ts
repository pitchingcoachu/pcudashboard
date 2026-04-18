import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { getPlayerForUser, listPlayerSummariesByOrganization } from '../../../../../lib/training-db';
import { logApiTiming } from '../../../../../lib/request-timing';

export async function GET() {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'dashboard.player-plans.players.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });

  if (session.role === 'player') {
    const own = await getPlayerForUser({
      organizationId: session.organizationId ?? 0,
      userId: session.userId ?? 0,
    });
    if (!own) return finish(200, { players: [] }, { role: 'player', count: 0 });
    return finish(200, {
      players: [
        {
          playerId: own.id,
          fullName: own.fullName,
          throwsHand: own.throwsHand,
          batsHand: own.batsHand,
          position: own.position,
        },
      ],
    }, { role: 'player', count: 1 });
  }

  const filtered = await listPlayerSummariesByOrganization({
    organizationId: session.organizationId ?? 0,
    assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
  });
  return finish(200, {
    players: filtered.map((player) => ({
      playerId: player.playerId,
      fullName: player.fullName,
      throwsHand: player.throwsHand,
      batsHand: player.batsHand,
      position: player.position,
    })),
  }, { role: session.role ?? 'unknown', count: filtered.length });
}

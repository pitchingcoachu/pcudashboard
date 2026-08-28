import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { getPlayerForUser, listPlayerSummariesByOrganization } from '../../../../../lib/training-db';
import { logApiTiming } from '../../../../../lib/request-timing';
import { resolvePlayerContentOrganizationId } from '../../../../../lib/player-content-scope';

export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'dashboard.player-plans.players.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  const mappedOrganizationId = await resolvePlayerContentOrganizationId(session);
  const scopedOrganizationId =
    Number.isFinite(Number(mappedOrganizationId)) && Number(mappedOrganizationId) > 0
      ? Number(mappedOrganizationId)
      : 0;

  if (scopedOrganizationId <= 0) {
    return finish(200, { players: [] }, { role: session.role ?? 'unknown', count: 0, unresolvedOrg: true });
  }

  if (session.role === 'player') {
    const own = await getPlayerForUser({
      organizationId: scopedOrganizationId,
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
    organizationId: scopedOrganizationId,
    assignedCoachUserId: null,
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

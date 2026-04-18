import { getPlayerForUser, isCoachAssignedToPlayer, playerExistsInOrganization } from './training-db';
import { resolveProgrammingOrganizationId } from './programming-scope';

type SessionLike = {
  role?: string;
  organizationId?: number;
  userId?: number;
  playerId?: number | null;
} | null;

export async function canManagePlayer(session: SessionLike, playerId: number): Promise<boolean> {
  if (!session) return false;
  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0 || !Number.isFinite(playerId) || playerId <= 0) return false;

  if (session.role === 'admin') {
    return playerExistsInOrganization({ organizationId, playerId });
  }

  if (session.role === 'coach') {
    const userId = session.userId ?? 0;
    if (!Number.isFinite(userId) || userId <= 0) return false;
    return isCoachAssignedToPlayer({ organizationId, coachUserId: userId, playerId });
  }

  if (session.role === 'player') {
    const ownPlayer = await getPlayerForUser({
      organizationId,
      userId: session.userId ?? 0,
    });
    const allowed = ownPlayer?.id ?? session.playerId ?? 0;
    return allowed === playerId;
  }

  return false;
}

import { getPlayerForUser, isCoachAssignedToPlayer, playerExistsInOrganization } from './training-db';
import { resolveProgrammingOrganizationId } from './programming-scope';

type SessionLike = {
  role?: string;
  organizationId?: number;
  userId?: number;
  playerId?: number | null;
} | null;

export async function canManagePlayer(session: SessionLike, playerId: number): Promise<boolean> {
  const organizationId = await resolveManageablePlayerOrganizationId(session, playerId);
  return organizationId > 0;
}

export async function resolveManageablePlayerOrganizationId(session: SessionLike, playerId: number): Promise<number> {
  if (!session) return 0;
  const mappedOrganizationId = resolveProgrammingOrganizationId(session);
  const sessionOrganizationId = Number(session.organizationId ?? 0);
  const candidateOrganizationIds = Array.from(
    new Set(
      [mappedOrganizationId, sessionOrganizationId]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );
  if (candidateOrganizationIds.length === 0 || !Number.isFinite(playerId) || playerId <= 0) return 0;

  if (session.role === 'admin') {
    for (const organizationId of candidateOrganizationIds) {
      if (await playerExistsInOrganization({ organizationId, playerId })) return organizationId;
    }
    return 0;
  }

  if (session.role === 'coach') {
    const userId = session.userId ?? 0;
    if (!Number.isFinite(userId) || userId <= 0) return 0;
    for (const organizationId of candidateOrganizationIds) {
      if (await isCoachAssignedToPlayer({ organizationId, coachUserId: userId, playerId })) return organizationId;
    }
    return 0;
  }

  if (session.role === 'player') {
    for (const organizationId of candidateOrganizationIds) {
      const ownPlayer = await getPlayerForUser({
        organizationId,
        userId: session.userId ?? 0,
      });
      const allowed = ownPlayer?.id ?? session.playerId ?? 0;
      if (allowed === playerId) return organizationId;
    }
    return 0;
  }

  return 0;
}

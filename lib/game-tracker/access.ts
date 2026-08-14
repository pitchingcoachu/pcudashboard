import { cookies } from 'next/headers';
import { getSessionFromRequest } from '../auth';
import { resolveProgrammingSchoolCode } from '../programming-scope';
import { resolveOrganizationIdForSchool } from '../training-db';

export class GameTrackerAccessError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function requireGameTrackerAccess(request: Request, write = false) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) throw new GameTrackerAccessError('Unauthorized', 401);
  if (session.role === 'player' || (write && session.role !== 'admin' && session.role !== 'coach')) {
    throw new GameTrackerAccessError('Game Tracker scoring is available to coaches and admins.', 403);
  }
  const schoolCode = resolveProgrammingSchoolCode(session);
  const organizationId = await resolveOrganizationIdForSchool({
    schoolCode,
    fallbackOrganizationId: Number(session.organizationId ?? 0),
    createIfMissing: false,
    allowFallbackIfUnresolved: true,
  });
  if (organizationId <= 0) throw new GameTrackerAccessError('No school organization is connected to this account.', 403);
  return { session, schoolCode, organizationId };
}

export function gameTrackerErrorResponse(error: unknown) {
  const status = error instanceof GameTrackerAccessError ? error.status : 400;
  const message = error instanceof Error ? error.message : 'Game Tracker request failed.';
  return Response.json({ error: message }, { status });
}

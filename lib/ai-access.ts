import { cookies } from 'next/headers';
import { getSessionFromRequest } from './auth';
import { resolveProgrammingOrganizationId } from './programming-scope';

export async function requireAiAccess(request: Request, staffOnly = false, requireOrganization = true) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const role = session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin';
  if (staffOnly && role === 'player') return { ok: false as const, status: 403, error: 'Staff access required.' };
  const organizationId = requireOrganization ? Number(await resolveProgrammingOrganizationId(session)) : Number(session.organizationId ?? 0);
  if (requireOrganization && !organizationId) return { ok: false as const, status: 403, error: 'Organization access required.' };
  return { ok: true as const, session, role, organizationId, userId: Number(session.userId ?? 0), playerId: Number(session.playerId ?? 0) || null };
}

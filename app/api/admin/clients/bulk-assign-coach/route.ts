import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { canUseClientManagement, resolveClientManagementOrganizationId, resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import { assignCoachToPlayer, resolveOrganizationIdForSchool } from '../../../../../lib/training-db';

// POST { playerIds: number[]; coachUserId: number | null } -> assigns (or,
// when coachUserId is null, clears) one coach across many players at once.
// Applied one-at-a-time with partial-success reporting (same shape as the
// Player Groups bulk-workout-assign endpoint) so one bad playerId doesn't
// abort the whole batch.
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const canManageClients = await canUseClientManagement(session);
  if (!canManageClients) return NextResponse.json({ error: 'Client management is not enabled for your organization.' }, { status: 403 });

  const organizationId = await resolveOrganizationIdForSchool({
    schoolCode: resolveProgrammingSchoolCode(session),
    fallbackOrganizationId: await resolveClientManagementOrganizationId(session),
    createIfMissing: false,
  });
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { playerIds?: number[]; coachUserId?: number | null };
  const playerIds = Array.isArray(body.playerIds) ? body.playerIds.map(Number).filter((id) => Number.isFinite(id) && id > 0) : [];
  if (!playerIds.length) return NextResponse.json({ error: 'playerIds is required.' }, { status: 400 });

  const coachUserIdRaw = Number(body.coachUserId ?? 0);
  const coachUserId = Number.isFinite(coachUserIdRaw) && coachUserIdRaw > 0 ? coachUserIdRaw : null;

  const results = await Promise.all(
    playerIds.map(async (playerId) => ({ playerId, result: await assignCoachToPlayer({ organizationId, playerId, coachUserId }) }))
  );
  const succeeded = results.filter((r) => r.result.ok).length;
  const failed = results.filter((r) => !r.result.ok).map(({ playerId, result }) => ({ playerId, error: result.ok ? '' : result.error }));

  return NextResponse.json({ ok: true, succeeded, failed });
}

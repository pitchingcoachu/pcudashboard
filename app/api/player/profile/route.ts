import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { getPlayerByIdInOrganization, getPlayerForUser, updatePlayerProfile } from '../../../../lib/training-db';
import { canManagePlayer } from '../../../../lib/portal-access';

async function resolveAllowedPlayerId(session: { role?: string; organizationId?: number; userId?: number; playerId?: number | null } | null, requestedPlayerId: number) {
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };

  if (session.role === 'player') {
    const ownPlayer = await getPlayerForUser({
      organizationId: session.organizationId ?? 0,
      userId: session.userId ?? 0,
    });
    const allowed = ownPlayer?.id ?? session.playerId ?? 0;
    if (allowed !== requestedPlayerId) return { ok: false as const, status: 403, error: 'Forbidden' };
    return { ok: true as const, playerId: allowed };
  }

  const allowed = await canManagePlayer(session as { role?: 'admin' | 'coach' | 'player'; organizationId?: number; userId?: number; playerId?: number | null }, requestedPlayerId);
  if (!allowed) return { ok: false as const, status: 403, error: 'Forbidden' };
  const player = await getPlayerByIdInOrganization({
    organizationId: session.organizationId ?? 0,
    playerId: requestedPlayerId,
  });
  if (!player) return { ok: false as const, status: 404, error: 'Player not found.' };
  return { ok: true as const, playerId: player.id };
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? 0);

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await resolveAllowedPlayerId(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const canAssignCoach = session.role === 'admin' || session.role === 'coach';
  const assignedCoachRaw = Number(body.assignedCoachUserId ?? 0);
  const assignedCoachUserId =
    canAssignCoach && Number.isFinite(assignedCoachRaw) && assignedCoachRaw > 0 ? assignedCoachRaw : null;
  const parsedProfileWeight = Number(body.profileWeightLbs);
  const profileWeightLbs =
    Number.isFinite(parsedProfileWeight) && parsedProfileWeight > 0 ? parsedProfileWeight : null;

  const result = await updatePlayerProfile({
    organizationId: session.organizationId ?? 0,
    playerId: allowed.playerId,
    fullName: String(body.fullName ?? ''),
    email: String(body.email ?? ''),
    dateOfBirth: String(body.dateOfBirth ?? ''),
    schoolTeam: String(body.schoolTeam ?? ''),
    phone: String(body.phone ?? ''),
    collegeCommitment: String(body.collegeCommitment ?? ''),
    gradYear: String(body.gradYear ?? ''),
    position: String(body.position ?? ''),
    batsHand: String(body.batsHand ?? ''),
    throwsHand: String(body.throwsHand ?? ''),
    height: String(body.height ?? ''),
    profileWeightLbs,
    profilePhotoDataUrl: typeof body.profilePhotoDataUrl === 'string' ? body.profilePhotoDataUrl : undefined,
    assignedCoachUserId: canAssignCoach ? assignedCoachUserId : undefined,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

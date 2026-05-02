import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { canManagePlayer } from '../../../../lib/portal-access';
import {
  completePlayerPlanGoal,
  getPlayerByIdInOrganization,
  getPlayerForUser,
  listPlayerPlanGoalsForPlayer,
  upsertPlayerPlanGoal,
} from '../../../../lib/training-db';

function resolvePlanGoalsOrganizationId(
  session: { organizationId?: number; role?: string; userId?: number; playerId?: number | null } | null
): number {
  if (!session) return 0;
  const mapped = Number(resolveProgrammingOrganizationId(session));
  if (Number.isFinite(mapped) && mapped > 0) return mapped;
  const fallback = Number(session.organizationId ?? 0);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

async function resolveAllowedPlayerId(
  session: { role?: string; organizationId?: number; userId?: number; playerId?: number | null } | null,
  requestedPlayerId: number
) {
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const organizationId = resolvePlanGoalsOrganizationId(session);
  if (!organizationId) return { ok: false as const, status: 400, error: 'No organization is available for this session.' };

  if (session.role === 'player') {
    const ownPlayer = await getPlayerForUser({
      organizationId,
      userId: session.userId ?? 0,
    });
    const allowed = ownPlayer?.id ?? session.playerId ?? 0;
    if (allowed !== requestedPlayerId) return { ok: false as const, status: 403, error: 'Forbidden' };
    return { ok: true as const, playerId: allowed };
  }

  const allowed = await canManagePlayer(
    session as { role?: 'admin' | 'coach' | 'player'; organizationId?: number; userId?: number; playerId?: number | null },
    requestedPlayerId
  );
  const player = await getPlayerByIdInOrganization({
    organizationId,
    playerId: requestedPlayerId,
  });
  // Admins should be able to access any player row in the currently-resolved org,
  // even when legacy session.organizationId differs from mapped programming org.
  if (!allowed && session.role !== 'admin') return { ok: false as const, status: 403, error: 'Forbidden' };
  if (!player) return { ok: false as const, status: 404, error: 'Player not found.' };
  return { ok: true as const, playerId: player.id };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await resolveAllowedPlayerId(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const data = await listPlayerPlanGoalsForPlayer({ playerId: allowed.playerId });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? 0);
  const slotIndex = Number(body.slotIndex ?? 0);
  const category = String(body.category ?? '');
  const goalDescription = String(body.goalDescription ?? '');

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await resolveAllowedPlayerId(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const result = await upsertPlayerPlanGoal({
    organizationId: resolvePlanGoalsOrganizationId(session),
    playerId: allowed.playerId,
    slotIndex,
    category,
    goalDescription,
    createdByUserId: session.userId ?? 0,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const data = await listPlayerPlanGoalsForPlayer({ playerId: allowed.playerId });
  return NextResponse.json({ ok: true, ...data });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? 0);
  const slotIndex = Number(body.slotIndex ?? 0);
  const completionDetails = String(body.completionDetails ?? '');

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await resolveAllowedPlayerId(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const result = await completePlayerPlanGoal({
    organizationId: resolvePlanGoalsOrganizationId(session),
    playerId: allowed.playerId,
    slotIndex,
    completionDetails,
    completedByUserId: session.userId ?? 0,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const data = await listPlayerPlanGoalsForPlayer({ playerId: allowed.playerId });
  return NextResponse.json({ ok: true, ...data });
}

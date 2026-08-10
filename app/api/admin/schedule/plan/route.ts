import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import {
  addPlanWorkoutAssignment,
  deletePlanProgramItem,
  getPlayerByIdInOrganization,
  listPlanProgramItemsForPlayer,
  movePlanProgramItem,
  normalizePlanSection,
  updatePlanItemTargetCount,
} from '../../../../../lib/training-db';
import { canManagePlayer } from '../../../../../lib/portal-access';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'playerId is required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }
  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const items = await listPlanProgramItemsForPlayer({ playerId });
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; workoutId?: number; planSection?: string; targetCount?: number | null }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  const userId = session.userId ?? 0;
  const playerId = Number(body.playerId ?? 0);
  const workoutId = Number(body.workoutId ?? 0);
  const planSection = normalizePlanSection(String(body.planSection ?? ''));
  if (organizationId <= 0 || userId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }
  if (!Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(workoutId) || workoutId <= 0 || !planSection) {
    return NextResponse.json({ error: 'playerId, workoutId, and planSection are required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const result = await addPlanWorkoutAssignment({
    organizationId,
    userId,
    playerId,
    workoutId,
    planSection,
    targetCount: body.targetCount ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; itemId?: number; planSection?: string; targetCount?: number | null }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  const playerId = Number(body.playerId ?? 0);
  const itemId = Number(body.itemId ?? 0);
  if (organizationId <= 0 || !Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(itemId) || itemId <= 0) {
    return NextResponse.json({ error: 'playerId and itemId are required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Two independent, optional edits share this endpoint: moving an item to
  // a different section, and/or changing its target completion count.
  if (body.planSection !== undefined) {
    const planSection = normalizePlanSection(String(body.planSection ?? ''));
    if (!planSection) return NextResponse.json({ error: 'planSection is invalid.' }, { status: 400 });
    const moveResult = await movePlanProgramItem({ organizationId, playerId, itemId, targetSection: planSection });
    if (!moveResult.ok) return NextResponse.json({ error: moveResult.error }, { status: 400 });
  }
  if (body.targetCount !== undefined) {
    const targetResult = await updatePlanItemTargetCount({ organizationId, playerId, itemId, targetCount: body.targetCount });
    if (!targetResult.ok) return NextResponse.json({ error: targetResult.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; itemId?: number }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  const playerId = Number(body.playerId ?? 0);
  const itemId = Number(body.itemId ?? 0);
  if (organizationId <= 0 || !Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(itemId) || itemId <= 0) {
    return NextResponse.json({ error: 'playerId and itemId are required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await deletePlanProgramItem({ organizationId, playerId, itemId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

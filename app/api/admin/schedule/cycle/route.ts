import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import {
  addCycleWorkoutAssignment,
  getPlayerByIdInOrganization,
  listCycleProgramItemsForPlayer,
  moveCycleProgramItem,
} from '../../../../../lib/training-db';
import { canManagePlayer } from '../../../../../lib/portal-access';

function parseCycleSlot(value: string): 'medium' | 'high' | 'low' | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'medium' || normalized === 'high' || normalized === 'low') return normalized;
  return null;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'playerId is required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const player = await getPlayerByIdInOrganization({ organizationId: session.organizationId ?? 0, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const items = await listCycleProgramItemsForPlayer({ playerId });
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; workoutId?: number; cycleSlot?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const organizationId = session.organizationId ?? 0;
  const userId = session.userId ?? 0;
  const playerId = Number(body.playerId ?? 0);
  const workoutId = Number(body.workoutId ?? 0);
  const cycleSlot = parseCycleSlot(String(body.cycleSlot ?? ''));
  if (organizationId <= 0 || userId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }
  if (!Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(workoutId) || workoutId <= 0 || !cycleSlot) {
    return NextResponse.json({ error: 'playerId, workoutId, and cycleSlot are required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const result = await addCycleWorkoutAssignment({
    organizationId,
    userId,
    playerId,
    workoutId,
    cycleSlot,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; itemId?: number; cycleSlot?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const organizationId = session.organizationId ?? 0;
  const playerId = Number(body.playerId ?? 0);
  const itemId = Number(body.itemId ?? 0);
  const cycleSlot = parseCycleSlot(String(body.cycleSlot ?? ''));
  if (organizationId <= 0 || !Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(itemId) || itemId <= 0 || !cycleSlot) {
    return NextResponse.json({ error: 'playerId, itemId, and cycleSlot are required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await moveCycleProgramItem({
    organizationId,
    playerId,
    itemId,
    targetSlot: cycleSlot,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

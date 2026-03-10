import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { addProgramItem, getPlayerByIdInOrganization, listProgramItemsForPlayerByDateRange } from '../../../../../lib/training-db';
import { canManagePlayer } from '../../../../../lib/portal-access';

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const startDate = parseDate(url.searchParams.get('startDate') ?? '');
  const endDate = parseDate(url.searchParams.get('endDate') ?? '');
  if (!Number.isFinite(playerId) || playerId <= 0 || !startDate || !endDate) {
    return NextResponse.json({ error: 'playerId, startDate, and endDate are required.' }, { status: 400 });
  }
  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const player = await getPlayerByIdInOrganization({ organizationId: session.organizationId ?? 0, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const items = await listProgramItemsForPlayerByDateRange({ playerId, startDate, endDate });
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; dayDate?: string; workoutId?: number; programName?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const playerId = Number(body.playerId ?? 0);
  const dayDate = parseDate(String(body.dayDate ?? ''));
  const workoutId = Number(body.workoutId ?? 0);
  const organizationId = session.organizationId ?? 0;
  const userId = session.userId ?? 0;

  if (organizationId <= 0 || userId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }
  if (!Number.isFinite(playerId) || playerId <= 0 || !dayDate || !Number.isFinite(workoutId) || workoutId <= 0) {
    return NextResponse.json({ error: 'playerId, dayDate, and workoutId are required.' }, { status: 400 });
  }
  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const result = await addProgramItem({
    organizationId,
    userId,
    playerId,
    dayDate,
    assignmentType: 'workout',
    workoutId,
    programName: String(body.programName ?? 'Current Program'),
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

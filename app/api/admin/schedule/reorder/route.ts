import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { getPlayerByIdInOrganization, reorderProgramDayItems } from '../../../../../lib/training-db';

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.role ?? 'admin') !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; dayDate?: string; orderedItemIds?: number[] }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const playerId = Number(body.playerId ?? 0);
  const dayDate = parseDate(String(body.dayDate ?? ''));
  const orderedItemIds = Array.isArray(body.orderedItemIds) ? body.orderedItemIds.map((value) => Number(value)) : [];
  const organizationId = session.organizationId ?? 0;

  if (organizationId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }
  if (!Number.isFinite(playerId) || playerId <= 0 || !dayDate || orderedItemIds.length === 0) {
    return NextResponse.json({ error: 'playerId, dayDate, and orderedItemIds are required.' }, { status: 400 });
  }
  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const result = await reorderProgramDayItems({ organizationId, playerId, dayDate, orderedItemIds });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

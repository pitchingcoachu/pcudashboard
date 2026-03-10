import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { getPlayerByIdInOrganization, moveProgramItemToDate } from '../../../../../lib/training-db';

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
    | { playerId?: number; itemId?: number; targetDate?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const playerId = Number(body.playerId ?? 0);
  const itemId = Number(body.itemId ?? 0);
  const targetDate = parseDate(String(body.targetDate ?? ''));
  const organizationId = session.organizationId ?? 0;

  if (organizationId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }
  if (!Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(itemId) || itemId <= 0 || !targetDate) {
    return NextResponse.json({ error: 'playerId, itemId, and targetDate are required.' }, { status: 400 });
  }

  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const result = await moveProgramItemToDate({ organizationId, playerId, itemId, targetDate });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

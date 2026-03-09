import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import {
  getPlayerByIdInOrganization,
  getPlayerForUser,
  listProgramItemsForPlayerByDateRange,
} from '../../../../lib/training-db';

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const startDate = parseDate(url.searchParams.get('startDate') ?? '');
  const endDate = parseDate(url.searchParams.get('endDate') ?? '');

  if (!Number.isFinite(playerId) || playerId <= 0 || !startDate || !endDate) {
    return NextResponse.json({ error: 'playerId, startDate, and endDate are required.' }, { status: 400 });
  }

  if (session.role === 'player') {
    const ownPlayer = await getPlayerForUser({
      organizationId: session.organizationId ?? 0,
      userId: session.userId ?? 0,
    });
    const allowed = ownPlayer?.id ?? session.playerId ?? 0;
    if (allowed !== playerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else {
    const player = await getPlayerByIdInOrganization({
      organizationId: session.organizationId ?? 0,
      playerId,
    });
    if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });
  }

  const items = await listProgramItemsForPlayerByDateRange({
    playerId,
    startDate,
    endDate,
  });

  return NextResponse.json({ items });
}

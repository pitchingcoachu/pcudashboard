import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { listProgramItemsForPlayerByDateRange } from '../../../../lib/training-db';
import { canManagePlayer } from '../../../../lib/portal-access';
import { logApiTiming } from '../../../../lib/request-timing';

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'player.program-items.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const startDate = parseDate(url.searchParams.get('startDate') ?? '');
  const endDate = parseDate(url.searchParams.get('endDate') ?? '');

  if (!Number.isFinite(playerId) || playerId <= 0 || !startDate || !endDate) {
    return finish(400, { error: 'playerId, startDate, and endDate are required.' });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return finish(403, { error: 'Forbidden' });

  const items = await listProgramItemsForPlayerByDateRange({
    playerId,
    startDate,
    endDate,
  });

  return finish(200, { items }, { playerId, startDate, endDate, count: Array.isArray(items) ? items.length : 0 });
}

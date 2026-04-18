import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { listExerciseLoadHistoryForPlayer } from '../../../../lib/training-db';
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
    logApiTiming({ route: 'player.exercise-history.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const beforeDate = parseDate(url.searchParams.get('beforeDate') ?? '') ?? undefined;
  const exerciseIds = String(url.searchParams.get('exerciseIds') ?? '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!Number.isFinite(playerId) || playerId <= 0 || exerciseIds.length === 0) {
    return finish(400, { error: 'playerId and exerciseIds are required.' });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return finish(403, { error: 'Forbidden' });

  const history = await listExerciseLoadHistoryForPlayer({
    playerId,
    exerciseIds,
    beforeDate,
    perExerciseLimit: 500,
  });

  return finish(200, { history }, { playerId, exerciseCount: exerciseIds.length });
}

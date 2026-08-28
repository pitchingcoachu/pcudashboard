import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { listExerciseTrendForPlayer } from '../../../../lib/training-db';
import { canManagePlayer } from '../../../../lib/portal-access';
import { logApiTiming } from '../../../../lib/request-timing';

async function ensurePlayerAccess(session: { role?: string; organizationId?: number; userId?: number; playerId?: number | null } | null, playerId: number) {
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return { ok: false as const, status: 403, error: 'Forbidden' };
  return { ok: true as const, playerId };
}

export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'player.exercise-trend.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const exerciseId = Number(url.searchParams.get('exerciseId') ?? '0');

  if (!Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(exerciseId) || exerciseId <= 0) {
    return finish(400, { error: 'Valid playerId and exerciseId are required.' });
  }

  const allowed = await ensurePlayerAccess(session, playerId);
  if (!allowed.ok) return finish(allowed.status, { error: allowed.error });

  const trend = await listExerciseTrendForPlayer({
    playerId: allowed.playerId,
    exerciseId,
  });

  return finish(200, { trend }, { playerId, exerciseId, points: Array.isArray(trend) ? trend.length : 0 });
}

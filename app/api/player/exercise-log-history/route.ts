import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { listExerciseLogHistoryForItem, updateExerciseLogHistoryEntry } from '../../../../lib/training-db';
import { canManagePlayer } from '../../../../lib/portal-access';
import { logApiTiming } from '../../../../lib/request-timing';

async function ensurePlayerAccess(session: { role?: string; organizationId?: number; userId?: number; playerId?: number | null } | null, playerId: number) {
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return { ok: false as const, status: 403, error: 'Forbidden' };
  return { ok: true as const, playerId };
}

function parseScheduleType(value: string | null): 'cycle' | 'plan' | null {
  if (value === 'cycle' || value === 'plan') return value;
  return null;
}

export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'player.exercise-log-history.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const itemId = Number(url.searchParams.get('itemId') ?? '0');
  const scheduleType = parseScheduleType(url.searchParams.get('scheduleType'));

  if (!Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(itemId) || itemId <= 0 || !scheduleType) {
    return finish(400, { error: 'Valid playerId, itemId, and scheduleType (cycle or plan) are required.' });
  }

  const allowed = await ensurePlayerAccess(session, playerId);
  if (!allowed.ok) return finish(allowed.status, { error: allowed.error });

  const entries = await listExerciseLogHistoryForItem({ playerId: allowed.playerId, itemId, scheduleType });
  return finish(200, { entries }, { playerId, itemId, scheduleType, count: entries.length });
}

export async function PATCH(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'player.exercise-log-history.PATCH', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return finish(400, { error: 'Invalid request.' });

  const playerId = Number((body as { playerId?: unknown }).playerId);
  const itemId = Number((body as { itemId?: unknown }).itemId);
  const historyId = Number((body as { historyId?: unknown }).historyId);
  const scheduleType = parseScheduleType(String((body as { scheduleType?: unknown }).scheduleType ?? ''));

  if (
    !Number.isFinite(playerId) || playerId <= 0 ||
    !Number.isFinite(itemId) || itemId <= 0 ||
    !Number.isFinite(historyId) || historyId <= 0 ||
    !scheduleType
  ) {
    return finish(400, { error: 'Valid playerId, itemId, historyId, and scheduleType (cycle or plan) are required.' });
  }

  const allowed = await ensurePlayerAccess(session, playerId);
  if (!allowed.ok) return finish(allowed.status, { error: allowed.error });

  const result = await updateExerciseLogHistoryEntry({
    playerId: allowed.playerId,
    scheduleType,
    itemId,
    historyId,
    performedSets: typeof (body as { performedSets?: unknown }).performedSets === 'string' ? (body as { performedSets: string }).performedSets : undefined,
    performedReps: typeof (body as { performedReps?: unknown }).performedReps === 'string' ? (body as { performedReps: string }).performedReps : undefined,
    performedLoad: typeof (body as { performedLoad?: unknown }).performedLoad === 'string' ? (body as { performedLoad: string }).performedLoad : undefined,
    notes: typeof (body as { notes?: unknown }).notes === 'string' ? (body as { notes: string }).notes : undefined,
  });

  if (!result.ok) return finish(400, { error: result.error });
  return finish(200, { ok: true });
}

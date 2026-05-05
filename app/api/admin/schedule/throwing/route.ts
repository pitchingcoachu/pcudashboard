import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { getScheduleThrowingState, playerExistsInOrganization, saveScheduleThrowingState } from '../../../../../lib/training-db';
import { logApiTiming } from '../../../../../lib/request-timing';

export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.throwing.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };

  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return finish(400, { error: 'Session context missing. Please log out and log in again.' });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) return finish(400, { error: 'playerId is required.' });

  const exists = await playerExistsInOrganization({ organizationId, playerId });
  if (!exists) return finish(404, { error: 'Player not found in this organization.' });

  const state = await getScheduleThrowingState({ organizationId, playerId });
  return finish(200, state, { organizationId, playerId });
}

export async function POST(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.throwing.POST', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };

  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const organizationId = resolveProgrammingOrganizationId(session);
  const userId = Number(session.userId ?? 0);
  if (organizationId <= 0 || userId <= 0) {
    return finish(400, { error: 'Session context missing. Please log out and log in again.' });
  }

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; byDate?: Record<string, unknown>; weekNotes?: Record<string, unknown>; templates?: unknown[] }
    | null;
  if (!body) return finish(400, { error: 'Invalid JSON body.' });

  const playerId = Number(body.playerId ?? 0);
  if (!Number.isFinite(playerId) || playerId <= 0) return finish(400, { error: 'playerId is required.' });

  const exists = await playerExistsInOrganization({ organizationId, playerId });
  if (!exists) return finish(404, { error: 'Player not found in this organization.' });

  const result = await saveScheduleThrowingState({
    organizationId,
    playerId,
    userId,
    byDate: body.byDate ?? {},
    weekNotes: body.weekNotes ?? {},
    templates: Array.isArray(body.templates) ? body.templates : [],
  });
  if (!result.ok) return finish(400, { error: result.error });
  return finish(200, { ok: true }, { organizationId, playerId });
}

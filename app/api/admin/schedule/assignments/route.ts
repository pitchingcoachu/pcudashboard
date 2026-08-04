import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { addProgramItem, listProgramItemsForPlayerByDateRange } from '../../../../../lib/training-db';
import { canManagePlayer, resolveManageablePlayerOrganizationId } from '../../../../../lib/portal-access';
import { logApiTiming } from '../../../../../lib/request-timing';
import { sendPushNotificationToUsers } from '../../../../../lib/push-notifications';

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.assignments.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const startDate = parseDate(url.searchParams.get('startDate') ?? '');
  const endDate = parseDate(url.searchParams.get('endDate') ?? '');
  if (!Number.isFinite(playerId) || playerId <= 0 || !startDate || !endDate) {
    return finish(400, { error: 'playerId, startDate, and endDate are required.' });
  }
  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return finish(400, { error: 'Session context missing. Please log out and log in again.' });
  }
  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return finish(403, { error: 'Forbidden' });

  const items = await listProgramItemsForPlayerByDateRange({ playerId, startDate, endDate });
  return finish(200, { items }, { playerId, startDate, endDate, count: Array.isArray(items) ? items.length : 0 });
}

export async function POST(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.assignments.POST', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; dayDate?: string; workoutId?: number; programName?: string }
    | null;
  if (!body) return finish(400, { error: 'Invalid JSON body.' });

  const playerId = Number(body.playerId ?? 0);
  const dayDate = parseDate(String(body.dayDate ?? ''));
  const workoutId = Number(body.workoutId ?? 0);
  const userId = session.userId ?? 0;

  if (userId <= 0) {
    return finish(400, { error: 'Session context missing. Please log out and log in again.' });
  }
  if (!Number.isFinite(playerId) || playerId <= 0 || !dayDate || !Number.isFinite(workoutId) || workoutId <= 0) {
    return finish(400, { error: 'playerId, dayDate, and workoutId are required.' });
  }
  const manageableOrganizationId = await resolveManageablePlayerOrganizationId(session, playerId);
  if (manageableOrganizationId <= 0) return finish(403, { error: 'Forbidden' });

  const result = await addProgramItem({
    organizationId: manageableOrganizationId,
    userId,
    playerId,
    dayDate,
    assignmentType: 'workout',
    workoutId,
    programName: String(body.programName ?? 'Current Program'),
  });

  if (!result.ok) return finish(400, { error: result.error });

  if (result.playerUserId) {
    void sendPushNotificationToUsers({
      userIds: [result.playerUserId],
      title: 'New workout assigned',
      body: result.workoutName
        ? `${result.workoutName} was added to your schedule for ${dayDate}.`
        : `A new workout was added to your schedule for ${dayDate}.`,
      data: { type: 'workout_assigned', itemId: result.itemId, dayDate },
    });
  }

  return finish(200, { ok: true, itemId: result.itemId }, { playerId, dayDate, workoutId, itemId: result.itemId });
}

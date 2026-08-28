import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { addProgramItem, listPlayerIdsForGroup, listProgramItemsForPlayerByDateRange } from '../../../../../lib/training-db';
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
    | { playerId?: number; groupId?: number; dayDate?: string; workoutId?: number; workoutIds?: number[]; programName?: string }
    | null;
  if (!body) return finish(400, { error: 'Invalid JSON body.' });

  const groupId = Number(body.groupId ?? 0);
  const dayDate = parseDate(String(body.dayDate ?? ''));
  const workoutId = Number(body.workoutId ?? 0);
  // groupId requests may send workoutIds (multi-select); the single-player
  // path below only ever sends the legacy singular workoutId.
  const workoutIds = Array.from(
    new Set((body.workoutIds ?? (workoutId > 0 ? [workoutId] : [])).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  );
  const userId = session.userId ?? 0;
  const programName = String(body.programName ?? 'Current Program');

  if (userId <= 0) {
    return finish(400, { error: 'Session context missing. Please log out and log in again.' });
  }
  if (!dayDate || workoutIds.length === 0) {
    return finish(400, { error: 'dayDate and at least one workout are required.' });
  }

  // groupId fans this same assignment out to every current member of the
  // group, once per selected workout -- a per-(player, workout) failure
  // (e.g. a player removed from the org since the group was built) is
  // reported individually rather than failing the whole batch, since a
  // partial success is more useful than an all-or-nothing rollback across
  // unrelated players/workouts.
  if (Number.isFinite(groupId) && groupId > 0) {
    const organizationId = await resolveProgrammingOrganizationId(session);
    if (organizationId <= 0) return finish(403, { error: 'Forbidden' });
    const playerIds = await listPlayerIdsForGroup({ organizationId, groupId });
    if (playerIds.length === 0) return finish(400, { error: 'This group has no players in it.' });

    const pairs = playerIds.flatMap((playerId) => workoutIds.map((assignWorkoutId) => ({ playerId, workoutId: assignWorkoutId })));
    const results = await Promise.all(
      pairs.map(async ({ playerId, workoutId: assignWorkoutId }) => {
        const result = await addProgramItem({
          organizationId,
          userId,
          playerId,
          dayDate,
          assignmentType: 'workout',
          workoutId: assignWorkoutId,
          programName,
        });
        if (result.ok && result.playerUserId) {
          void sendPushNotificationToUsers({
            userIds: [result.playerUserId],
            title: 'New workout assigned',
            body: result.workoutName
              ? `${result.workoutName} was added to your schedule for ${dayDate}.`
              : `A new workout was added to your schedule for ${dayDate}.`,
            data: { type: 'workout_assigned', itemId: result.itemId, dayDate },
          });
        }
        return { playerId, workoutId: assignWorkoutId, ...result };
      })
    );
    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    return finish(
      200,
      {
        ok: true,
        groupId,
        succeeded,
        failed: failed.map((f) => ({ playerId: f.playerId, workoutId: f.workoutId, error: 'error' in f ? f.error : 'Unknown error' })),
      },
      { groupId, dayDate, workoutIds, succeeded, failedCount: failed.length }
    );
  }

  const playerId = Number(body.playerId ?? 0);
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return finish(400, { error: 'playerId or groupId is required.' });
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
    programName,
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

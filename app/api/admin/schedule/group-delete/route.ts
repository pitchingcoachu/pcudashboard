import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import {
  deleteGroupWorkoutAssignment,
  previewGroupWorkoutAssignmentMatches,
  type GroupWorkoutAssignmentTarget,
} from '../../../../../lib/training-db';
import { logApiTiming } from '../../../../../lib/request-timing';

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function parseTarget(params: {
  organizationId: number;
  groupId: number;
  workoutId: number;
  scheduleType: string | null;
  dayDate: string | null;
  planSection: string | null;
  cycleSlot: string | null;
}): GroupWorkoutAssignmentTarget | null {
  const { organizationId, groupId, workoutId, scheduleType } = params;
  if (scheduleType === 'calendar') {
    const dayDate = params.dayDate ? parseDate(params.dayDate) : null;
    if (!dayDate) return null;
    return { organizationId, groupId, workoutId, scheduleType: 'calendar', dayDate };
  }
  if (scheduleType === 'plan') {
    const planSection = (params.planSection ?? '').trim();
    if (!planSection) return null;
    return { organizationId, groupId, workoutId, scheduleType: 'plan', planSection };
  }
  if (scheduleType === 'cycle') {
    const cycleSlot = (params.cycleSlot ?? '').trim();
    if (!cycleSlot) return null;
    return { organizationId, groupId, workoutId, scheduleType: 'cycle', cycleSlot };
  }
  return null;
}

// Bulk-removes a workout that was applied to an entire group at once (e.g.
// via the group-assign flow), for whichever CURRENT members still have a
// matching item -- see previewGroupWorkoutAssignmentMatches for why this is
// match-based rather than tied to the original assign action.
export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.group-delete.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return finish(400, { error: 'Session context missing. Please log out and log in again.' });

  const url = new URL(request.url);
  const groupId = Number(url.searchParams.get('groupId') ?? '0');
  const workoutId = Number(url.searchParams.get('workoutId') ?? '0');
  if (!Number.isFinite(groupId) || groupId <= 0 || !Number.isFinite(workoutId) || workoutId <= 0) {
    return finish(400, { error: 'Valid groupId and workoutId are required.' });
  }

  const target = parseTarget({
    organizationId,
    groupId,
    workoutId,
    scheduleType: url.searchParams.get('scheduleType'),
    dayDate: url.searchParams.get('dayDate'),
    planSection: url.searchParams.get('planSection'),
    cycleSlot: url.searchParams.get('cycleSlot'),
  });
  if (!target) return finish(400, { error: 'A valid scheduleType and its target (dayDate, planSection, or cycleSlot) are required.' });

  const matches = await previewGroupWorkoutAssignmentMatches(target);
  return finish(200, { matches }, { groupId, workoutId, count: matches.length });
}

export async function POST(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.group-delete.POST', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return finish(400, { error: 'Session context missing. Please log out and log in again.' });

  const body = (await request.json().catch(() => null)) as
    | {
        groupId?: number;
        workoutId?: number;
        scheduleType?: string;
        dayDate?: string;
        planSection?: string;
        cycleSlot?: string;
      }
    | null;
  if (!body) return finish(400, { error: 'Invalid JSON body.' });

  const groupId = Number(body.groupId ?? 0);
  const workoutId = Number(body.workoutId ?? 0);
  if (!Number.isFinite(groupId) || groupId <= 0 || !Number.isFinite(workoutId) || workoutId <= 0) {
    return finish(400, { error: 'Valid groupId and workoutId are required.' });
  }

  const target = parseTarget({
    organizationId,
    groupId,
    workoutId,
    scheduleType: body.scheduleType ?? null,
    dayDate: body.dayDate ?? null,
    planSection: body.planSection ?? null,
    cycleSlot: body.cycleSlot ?? null,
  });
  if (!target) return finish(400, { error: 'A valid scheduleType and its target (dayDate, planSection, or cycleSlot) are required.' });

  const result = await deleteGroupWorkoutAssignment(target);
  return finish(
    200,
    { ok: true, groupId, succeeded: result.succeeded, failed: result.failed },
    { groupId, workoutId, succeeded: result.succeeded, failedCount: result.failed.length }
  );
}

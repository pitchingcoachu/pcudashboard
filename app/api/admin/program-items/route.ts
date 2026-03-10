import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { addProgramItem } from '../../../../lib/training-db';
import { canManagePlayer } from '../../../../lib/portal-access';

function redirectWithMessage(request: Request, redirectTo: string, key: 'ok' | 'error', value: string) {
  const url = new URL(redirectTo, request.url);
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const session = getSessionFromCookies(cookieStore);
    if (!session) {
      return NextResponse.redirect(new URL('/login', request.url), 303);
    }

    if (session.role === 'player') {
      return NextResponse.redirect(new URL('/portal/player', request.url), 303);
    }

    const form = await request.formData();
    const redirectTo = String(form.get('redirectTo') ?? '/portal/admin/clients');
    const organizationId = session.organizationId ?? 0;
    const userId = session.userId ?? 0;
    if (organizationId <= 0 || userId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Session context missing. Please log out and log in again.');
    }

    const playerId = Number(String(form.get('playerId') ?? '0'));
    const exerciseIdRaw = String(form.get('exerciseId') ?? '');
    const workoutIdRaw = String(form.get('workoutId') ?? '');
    const assignmentTypeRaw = String(form.get('assignmentType') ?? '').toLowerCase();
    const assignmentType = assignmentTypeRaw === 'exercise' ? 'exercise' : 'workout';
    const exerciseId = exerciseIdRaw ? Number(exerciseIdRaw) : undefined;
    const workoutId = workoutIdRaw ? Number(workoutIdRaw) : undefined;

    if (!Number.isFinite(playerId) || playerId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Player is required.');
    }

    const allowed = await canManagePlayer(session, playerId);
    if (!allowed) {
      return redirectWithMessage(request, redirectTo, 'error', 'You do not have access to edit this player.');
    }

    if (assignmentType === 'exercise' && (!exerciseId || !Number.isFinite(exerciseId) || exerciseId <= 0)) {
      return redirectWithMessage(request, redirectTo, 'error', 'Choose an exercise assignment.');
    }

    if (assignmentType === 'workout' && (!workoutId || !Number.isFinite(workoutId) || workoutId <= 0)) {
      return redirectWithMessage(request, redirectTo, 'error', 'Choose a workout assignment.');
    }

    const result = await addProgramItem({
      organizationId,
      userId,
      playerId,
      assignmentType,
      dayDate: String(form.get('dayDate') ?? ''),
      exerciseId,
      workoutId,
      prescribedSets: String(form.get('prescribedSets') ?? ''),
      prescribedReps: String(form.get('prescribedReps') ?? ''),
      prescribedLoad: String(form.get('prescribedLoad') ?? ''),
      prescribedNotes: String(form.get('prescribedNotes') ?? ''),
      programName: String(form.get('programName') ?? ''),
    });

    if (!result.ok) {
      return redirectWithMessage(request, redirectTo, 'error', result.error);
    }

    return redirectWithMessage(request, redirectTo, 'ok', 'Assignment added to calendar.');
  } catch (error) {
    return redirectWithMessage(
      request,
      '/portal/admin/clients',
      'error',
      error instanceof Error ? error.message : 'Failed to save assignment.'
    );
  }
}

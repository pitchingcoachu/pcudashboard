import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { updateWorkout } from '../../../../../lib/training-db';

function redirectWithMessage(request: Request, redirectTo: string, key: 'ok' | 'error', value: string) {
  const url = new URL(redirectTo, request.url);
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}

function wantsJsonResponse(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  const requestedWith = request.headers.get('x-requested-with') ?? '';
  return accept.includes('application/json') || requestedWith.toLowerCase() === 'fetch';
}

export async function POST(request: Request) {
  const wantsJson = wantsJsonResponse(request);
  try {
    const cookieStore = await cookies();
    const session = getSessionFromRequest(request, cookieStore);
    if (!session) {
      if (wantsJson) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return NextResponse.redirect(new URL('/login', request.url), 303);
    }
    if (session.role === 'player') {
      if (wantsJson) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      return NextResponse.redirect(new URL('/portal/player', request.url), 303);
    }

    const organizationId = resolveProgrammingOrganizationId(session);
    const userId = session.userId ?? 0;
    if (organizationId <= 0 || userId <= 0) {
      const message = 'Session context missing. Please log out and log in again.';
      if (wantsJson) return NextResponse.json({ error: message }, { status: 400 });
      return redirectWithMessage(request, '/portal/admin/workouts', 'error', message);
    }

    const contentType = request.headers.get('content-type') ?? '';
    let workoutId: number;
    let name: string;
    let category: string;
    let description: string;
    let calendarLinkTarget: string;
    let exerciseItems: Array<{ exerciseId: number; prefix: string; prescribedSets: string; prescribedReps: string; prescribedLoad: string; notes: string }>;
    let redirectTo = '/portal/admin/workouts';

    if (contentType.includes('application/json')) {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      workoutId = Number(body.workoutId ?? 0);
      name = String(body.name ?? '');
      category = String(body.category ?? '');
      description = String(body.description ?? '');
      calendarLinkTarget = String(body.calendarLinkTarget ?? '');
      const items = Array.isArray(body.exerciseItems) ? body.exerciseItems : [];
      exerciseItems = items
        .map((item) => {
          const record = item as Record<string, unknown>;
          return {
            exerciseId: Number(record.exerciseId ?? 0),
            prefix: String(record.prefix ?? ''),
            prescribedSets: String(record.prescribedSets ?? ''),
            prescribedReps: String(record.prescribedReps ?? ''),
            prescribedLoad: String(record.prescribedLoad ?? ''),
            notes: String(record.notes ?? ''),
          };
        })
        .filter((item) => Number.isFinite(item.exerciseId) && item.exerciseId > 0);
    } else {
      const form = await request.formData();
      redirectTo = String(form.get('redirectTo') ?? '/portal/admin/workouts');
      workoutId = Number(String(form.get('workoutId') ?? '0'));
      name = String(form.get('name') ?? '');
      category = String(form.get('category') ?? '');
      description = String(form.get('description') ?? '');
      calendarLinkTarget = String(form.get('calendarLinkTarget') ?? '');
      const exerciseIds = form
        .getAll('exerciseIds')
        .map((value) => Number(String(value)))
        .filter((value) => Number.isFinite(value) && value > 0);
      exerciseItems = exerciseIds.map((exerciseId) => ({
        exerciseId,
        prefix: String(form.get(`prefix_${exerciseId}`) ?? ''),
        prescribedSets: String(form.get(`prescribedSets_${exerciseId}`) ?? ''),
        prescribedReps: String(form.get(`prescribedReps_${exerciseId}`) ?? ''),
        prescribedLoad: String(form.get(`prescribedLoad_${exerciseId}`) ?? ''),
        notes: String(form.get(`notes_${exerciseId}`) ?? ''),
      }));
    }

    if (!Number.isFinite(workoutId) || workoutId <= 0) {
      const message = 'Workout ID is required.';
      if (wantsJson) return NextResponse.json({ error: message }, { status: 400 });
      return redirectWithMessage(request, redirectTo, 'error', message);
    }

    const result = await updateWorkout({
      organizationId,
      userId,
      workoutId,
      name,
      category,
      description,
      calendarLinkTarget,
      exerciseItems,
    });

    if (!result.ok) {
      if (wantsJson) return NextResponse.json({ error: result.error }, { status: 400 });
      return redirectWithMessage(request, redirectTo, 'error', result.error);
    }
    if (wantsJson) return NextResponse.json({ ok: true });
    return redirectWithMessage(request, '/portal/admin/workouts', 'ok', 'Workout updated.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update workout.';
    if (wantsJson) return NextResponse.json({ error: message }, { status: 500 });
    return redirectWithMessage(request, '/portal/admin/workouts', 'error', message);
  }
}

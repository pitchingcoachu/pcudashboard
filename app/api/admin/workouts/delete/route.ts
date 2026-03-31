import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { deleteWorkout } from '../../../../../lib/training-db';

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
    const session = getSessionFromCookies(cookieStore);
    if (!session) {
      if (wantsJson) return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
      return NextResponse.redirect(new URL('/login', request.url), 303);
    }

    if (session.role === 'player') {
      if (wantsJson) return NextResponse.json({ ok: false, error: 'Players cannot delete workouts.' }, { status: 403 });
      return NextResponse.redirect(new URL('/portal/player', request.url), 303);
    }

    const form = await request.formData();
    const redirectTo = String(form.get('redirectTo') ?? '/portal/admin/workouts');
    const workoutId = Number(String(form.get('workoutId') ?? '0'));

    if (!Number.isFinite(workoutId) || workoutId <= 0) {
      if (wantsJson) return NextResponse.json({ ok: false, error: 'Workout ID is required.' }, { status: 400 });
      return redirectWithMessage(request, redirectTo, 'error', 'Workout ID is required.');
    }

    const organizationId = resolveProgrammingOrganizationId(session);
    if (organizationId <= 0) {
      if (wantsJson) {
        return NextResponse.json(
          { ok: false, error: 'Session organization not found. Please log out and log in again.' },
          { status: 400 }
        );
      }
      return redirectWithMessage(request, redirectTo, 'error', 'Session organization not found. Please log out and log in again.');
    }

    const result = await deleteWorkout({
      organizationId,
      workoutId,
    });

    if (!result.ok) {
      if (wantsJson) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      return redirectWithMessage(request, redirectTo, 'error', result.error);
    }

    if (wantsJson) return NextResponse.json({ ok: true, message: 'Workout deleted.' });
    return redirectWithMessage(request, '/portal/admin/workouts', 'ok', 'Workout deleted.');
  } catch (error) {
    if (wantsJson) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : 'Failed to delete workout.' },
        { status: 500 }
      );
    }
    return redirectWithMessage(
      request,
      '/portal/admin/workouts',
      'error',
      error instanceof Error ? error.message : 'Failed to delete workout.'
    );
  }
}

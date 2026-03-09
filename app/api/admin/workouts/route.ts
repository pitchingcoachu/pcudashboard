import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { createWorkout } from '../../../../lib/training-db';

function redirectWithMessage(request: Request, redirectTo: string, key: 'ok' | 'error', value: string) {
  const url = new URL(redirectTo, request.url);
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const session = getSessionFromCookies(cookieStore);
    if (!session) return NextResponse.redirect(new URL('/login', request.url), 303);
    if ((session.role ?? 'admin') !== 'admin') return NextResponse.redirect(new URL('/portal/player', request.url), 303);

    const form = await request.formData();
    const redirectTo = String(form.get('redirectTo') ?? '/portal/admin/workouts');
    const organizationId = session.organizationId ?? 0;
    const userId = session.userId ?? 0;
    if (organizationId <= 0 || userId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Session context missing. Please log out and log in again.');
    }

    const exerciseIds = form
      .getAll('exerciseIds')
      .map((value) => Number(String(value)))
      .filter((value) => Number.isFinite(value) && value > 0);

    const exerciseItems = exerciseIds.map((exerciseId) => ({
      exerciseId,
      prefix: String(form.get(`prefix_${exerciseId}`) ?? ''),
      prescribedSets: String(form.get(`prescribedSets_${exerciseId}`) ?? ''),
      prescribedReps: String(form.get(`prescribedReps_${exerciseId}`) ?? ''),
      prescribedLoad: String(form.get(`prescribedLoad_${exerciseId}`) ?? ''),
      notes: String(form.get(`notes_${exerciseId}`) ?? ''),
    }));

    const result = await createWorkout({
      organizationId,
      userId,
      name: String(form.get('name') ?? ''),
      category: String(form.get('category') ?? ''),
      description: String(form.get('description') ?? ''),
      exerciseItems,
    });

    if (!result.ok) return redirectWithMessage(request, redirectTo, 'error', result.error);
    return redirectWithMessage(request, redirectTo, 'ok', 'Workout created.');
  } catch (error) {
    return redirectWithMessage(request, '/portal/admin/workouts', 'error', error instanceof Error ? error.message : 'Failed to save workout.');
  }
}

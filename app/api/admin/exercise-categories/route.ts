import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { createExerciseCategory } from '../../../../lib/training-db';

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
    if (session.role === 'player') return NextResponse.redirect(new URL('/portal/player', request.url), 303);

    const form = await request.formData();
    const redirectTo = String(form.get('redirectTo') ?? '/portal/admin/exercises');
    const organizationId = session.organizationId ?? 0;
    const userId = session.userId ?? 0;
    if (organizationId <= 0 || userId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Session context missing. Please log out and log in again.');
    }

    const result = await createExerciseCategory({
      organizationId,
      userId,
      name: String(form.get('name') ?? ''),
    });

    if (!result.ok) return redirectWithMessage(request, redirectTo, 'error', result.error);
    return redirectWithMessage(request, redirectTo, 'ok', 'Category saved.');
  } catch (error) {
    return redirectWithMessage(
      request,
      '/portal/admin/exercises',
      'error',
      error instanceof Error ? error.message : 'Failed to save category.'
    );
  }
}

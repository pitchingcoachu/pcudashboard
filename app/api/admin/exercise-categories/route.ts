import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { createExerciseCategory } from '../../../../lib/training-db';

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
      if (wantsJson) return NextResponse.json({ ok: false, error: 'Players cannot save categories.' }, { status: 403 });
      return NextResponse.redirect(new URL('/portal/player', request.url), 303);
    }

    const form = await request.formData();
    const redirectTo = String(form.get('redirectTo') ?? '/portal/admin/exercises');
    const organizationId = resolveProgrammingOrganizationId(session);
    const userId = session.userId ?? 0;
    if (organizationId <= 0 || userId <= 0) {
      if (wantsJson) {
        return NextResponse.json(
          { ok: false, error: 'Session context missing. Please log out and log in again.' },
          { status: 400 }
        );
      }
      return redirectWithMessage(request, redirectTo, 'error', 'Session context missing. Please log out and log in again.');
    }

    const result = await createExerciseCategory({
      organizationId,
      userId,
      name: String(form.get('name') ?? ''),
    });

    if (!result.ok) {
      if (wantsJson) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      return redirectWithMessage(request, redirectTo, 'error', result.error);
    }
    if (wantsJson) return NextResponse.json({ ok: true, message: 'Category saved.' });
    return redirectWithMessage(request, redirectTo, 'ok', 'Category saved.');
  } catch (error) {
    if (wantsJson) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : 'Failed to save category.' },
        { status: 500 }
      );
    }
    return redirectWithMessage(
      request,
      '/portal/admin/exercises',
      'error',
      error instanceof Error ? error.message : 'Failed to save category.'
    );
  }
}

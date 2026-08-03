import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { createExerciseCategory, listExerciseCategoriesByOrganization } from '../../../../lib/training-db';

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

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = resolveProgrammingOrganizationId(session);
  const categories = await listExerciseCategoriesByOrganization(organizationId);
  return NextResponse.json({ categories });
}

export async function POST(request: Request) {
  const wantsJson = wantsJsonResponse(request);
  try {
    const cookieStore = await cookies();
    const session = getSessionFromRequest(request, cookieStore);
    if (!session) {
      if (wantsJson) return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
      return NextResponse.redirect(new URL('/login', request.url), 303);
    }
    if (session.role === 'player') {
      if (wantsJson) return NextResponse.json({ ok: false, error: 'Players cannot save categories.' }, { status: 403 });
      return NextResponse.redirect(new URL('/portal/player', request.url), 303);
    }

    const contentType = request.headers.get('content-type') ?? '';
    let name: string;
    let redirectTo = '/portal/admin/exercises';
    if (contentType.includes('application/json')) {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      name = String(body.name ?? '');
    } else {
      const form = await request.formData();
      redirectTo = String(form.get('redirectTo') ?? '/portal/admin/exercises');
      name = String(form.get('name') ?? '');
    }

    const organizationId = resolveProgrammingOrganizationId(session);
    const userId = session.userId ?? 0;
    if (organizationId <= 0 || userId <= 0) {
      const message = 'Session context missing. Please log out and log in again.';
      if (wantsJson) return NextResponse.json({ ok: false, error: message }, { status: 400 });
      return redirectWithMessage(request, redirectTo, 'error', message);
    }

    const result = await createExerciseCategory({ organizationId, userId, name });

    if (!result.ok) {
      if (wantsJson) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      return redirectWithMessage(request, redirectTo, 'error', result.error);
    }
    if (wantsJson) return NextResponse.json({ ok: true, message: 'Category saved.' });
    return redirectWithMessage(request, redirectTo, 'ok', 'Category saved.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save category.';
    if (wantsJson) return NextResponse.json({ ok: false, error: message }, { status: 500 });
    return redirectWithMessage(request, '/portal/admin/exercises', 'error', message);
  }
}

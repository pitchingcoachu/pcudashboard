import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { createExercise, listExercisesByOrganization } from '../../../../lib/training-db';

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
  if (!session) return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ ok: false, error: 'Forbidden.' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'Session context missing. Please log out and log in again.' },
      { status: 400 }
    );
  }

  const exercises = await listExercisesByOrganization(organizationId);
  return NextResponse.json({ ok: true, exercises });
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
      if (wantsJson) return NextResponse.json({ ok: false, error: 'Players cannot save exercises.' }, { status: 403 });
      return NextResponse.redirect(new URL('/portal/player', request.url), 303);
    }

    const form = await request.formData();
    const redirectTo = String(form.get('redirectTo') ?? '/portal/admin/exercises');
    const organizationId = await resolveProgrammingOrganizationId(session);
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

    const result = await createExercise({
      organizationId,
      userId,
      name: String(form.get('name') ?? ''),
      category: String(form.get('category') ?? ''),
      repMeasure: String(form.get('repMeasure') ?? ''),
      trackingType: String(form.get('trackingType') ?? ''),
      repsPerSide: form.get('repsPerSide') === 'on',
      description: String(form.get('description') ?? ''),
      instructionVideoUrl: String(form.get('instructionVideoUrl') ?? ''),
      coachingCues: String(form.get('coachingCues') ?? ''),
    });

    if (!result.ok) {
      if (wantsJson) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      return redirectWithMessage(request, redirectTo, 'error', result.error);
    }

    if (wantsJson) return NextResponse.json({ ok: true, message: 'Exercise saved.' });
    return redirectWithMessage(request, redirectTo, 'ok', 'Exercise saved.');
  } catch (error) {
    if (wantsJson) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : 'Failed to save exercise.' },
        { status: 500 }
      );
    }
    return redirectWithMessage(request, '/portal/admin/exercises', 'error', error instanceof Error ? error.message : 'Failed to save exercise.');
  }
}

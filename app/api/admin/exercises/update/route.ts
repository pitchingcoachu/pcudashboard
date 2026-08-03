import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { updateExercise } from '../../../../../lib/training-db';

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
      return redirectWithMessage(request, '/portal/admin/exercises', 'error', message);
    }

    const contentType = request.headers.get('content-type') ?? '';
    let exerciseId: number;
    let name: string;
    let category: string;
    let repMeasure: string;
    let trackingType: string;
    let repsPerSide: boolean;
    let description: string;
    let instructionVideoUrl: string;
    let coachingCues: string;
    let redirectTo = '/portal/admin/exercises';

    if (contentType.includes('application/json')) {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      exerciseId = Number(body.exerciseId ?? 0);
      name = String(body.name ?? '');
      category = String(body.category ?? '');
      repMeasure = String(body.repMeasure ?? '');
      trackingType = String(body.trackingType ?? '');
      repsPerSide = Boolean(body.repsPerSide);
      description = String(body.description ?? '');
      instructionVideoUrl = String(body.instructionVideoUrl ?? '');
      coachingCues = String(body.coachingCues ?? '');
    } else {
      const form = await request.formData();
      redirectTo = String(form.get('redirectTo') ?? '/portal/admin/exercises');
      exerciseId = Number(String(form.get('exerciseId') ?? '0'));
      name = String(form.get('name') ?? '');
      category = String(form.get('category') ?? '');
      repMeasure = String(form.get('repMeasure') ?? '');
      trackingType = String(form.get('trackingType') ?? '');
      repsPerSide = form.get('repsPerSide') === 'on';
      description = String(form.get('description') ?? '');
      instructionVideoUrl = String(form.get('instructionVideoUrl') ?? '');
      coachingCues = String(form.get('coachingCues') ?? '');
    }

    if (!Number.isFinite(exerciseId) || exerciseId <= 0) {
      const message = 'Exercise ID is required.';
      if (wantsJson) return NextResponse.json({ error: message }, { status: 400 });
      return redirectWithMessage(request, redirectTo, 'error', message);
    }

    const result = await updateExercise({
      organizationId,
      userId,
      exerciseId,
      name,
      category,
      repMeasure,
      trackingType,
      repsPerSide,
      description,
      instructionVideoUrl,
      coachingCues,
    });

    if (!result.ok) {
      if (wantsJson) return NextResponse.json({ error: result.error }, { status: 400 });
      return redirectWithMessage(request, redirectTo, 'error', result.error);
    }
    if (wantsJson) return NextResponse.json({ ok: true });
    return redirectWithMessage(request, '/portal/admin/exercises', 'ok', 'Exercise updated.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update exercise.';
    if (wantsJson) return NextResponse.json({ error: message }, { status: 500 });
    return redirectWithMessage(request, '/portal/admin/exercises', 'error', message);
  }
}

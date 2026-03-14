import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { createClientWithLogin } from '../../../../lib/training-db';

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

    if ((session.role ?? 'admin') !== 'admin' && (session.role ?? 'admin') !== 'coach') {
      return NextResponse.redirect(new URL('/portal/player', request.url), 303);
    }

    const form = await request.formData();
    const redirectTo = String(form.get('redirectTo') ?? '/portal/admin/clients');
    const organizationId = session.organizationId ?? 0;
    if (organizationId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Session organization not found. Please log out and log in again.');
    }

    const fullName = String(form.get('fullName') ?? '');
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const dateOfBirth = String(form.get('dateOfBirth') ?? '');
    const schoolTeam = String(form.get('schoolTeam') ?? '');
    const phone = String(form.get('phone') ?? '');
    const collegeCommitment = String(form.get('collegeCommitment') ?? '');
    const gradYear = String(form.get('gradYear') ?? '');
    const position = String(form.get('position') ?? '');
    const height = String(form.get('height') ?? '');
    const profileWeightRaw = Number(String(form.get('profileWeightLbs') ?? ''));
    const profileWeightLbs = Number.isFinite(profileWeightRaw) && profileWeightRaw > 0 ? profileWeightRaw : undefined;
    const batsHand = String(form.get('batsHand') ?? '');
    const throwsHand = String(form.get('throwsHand') ?? '');
    const assignedCoachUserIdFromForm = Number(String(form.get('assignedCoachUserId') ?? '0'));
    const assignedCoachUserId =
      session.role === 'coach'
        ? session.userId ?? undefined
        : Number.isFinite(assignedCoachUserIdFromForm) && assignedCoachUserIdFromForm > 0
          ? assignedCoachUserIdFromForm
          : undefined;

    const result = await createClientWithLogin({
      organizationId,
      fullName,
      email,
      password,
      dateOfBirth,
      schoolTeam,
      phone,
      collegeCommitment,
      gradYear,
      position,
      height,
      profileWeightLbs,
      batsHand,
      throwsHand,
      assignedCoachUserId,
    });

    if (!result.ok) {
      return redirectWithMessage(request, redirectTo, 'error', result.error);
    }

    return redirectWithMessage(request, redirectTo, 'ok', 'Client added successfully.');
  } catch (error) {
    return redirectWithMessage(request, '/portal/admin/clients', 'error', error instanceof Error ? error.message : 'Failed to create client.');
  }
}

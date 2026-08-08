import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveClientManagementOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { createClientWithLogin, listClientsByOrganizationPaged, resolveOrganizationIdForSchool } from '../../../../lib/training-db';

function redirectWithMessage(request: Request, redirectTo: string, key: 'ok' | 'error', value: string) {
  const url = new URL(redirectTo, request.url);
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ players: [] });

  const selectedSchoolCode = resolveProgrammingSchoolCode(session);
  const fallbackOrgId = await resolveClientManagementOrganizationId(session);
  const organizationId = await resolveOrganizationIdForSchool({
    schoolCode: selectedSchoolCode,
    fallbackOrganizationId: fallbackOrgId,
    createIfMissing: false,
  });
  if (organizationId <= 0) return NextResponse.json({ players: [] });

  const q = new URL(request.url).searchParams.get('q') ?? '';
  const result = await listClientsByOrganizationPaged({
    organizationId,
    page: 1,
    pageSize: 500,
    query: q,
    assignedCoachOnlyUserId: session.role === 'coach' ? (session.userId ?? null) : null,
  });
  return NextResponse.json({
    players: result.rows.map((r) => ({ playerId: r.playerId, fullName: r.fullName })),
  });
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
    const scopedOrganizationId = await resolveClientManagementOrganizationId(session);
    const selectedSchoolCode = resolveProgrammingSchoolCode(session);
    const organizationId = await resolveOrganizationIdForSchool({
      schoolCode: selectedSchoolCode,
      fallbackOrganizationId: scopedOrganizationId,
      createIfMissing: session.role === 'admin' && selectedSchoolCode === 'PRO',
    });
    if (organizationId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Client management is not enabled for this school.');
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
      schoolCode: selectedSchoolCode,
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

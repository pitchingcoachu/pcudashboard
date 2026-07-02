import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { isGlobalAdminSession, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import {
  createStaffUser,
  ensureDashboardTrialOrganizationForCoach,
  resolveOrganizationIdForSchool,
  seedDashboardTrialOrganizationFromPcu,
} from '../../../../lib/training-db';

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
    if ((session.role ?? 'admin') !== 'admin') {
      return NextResponse.redirect(new URL('/portal/player', request.url), 303);
    }

    const form = await request.formData();
    const redirectTo = String(form.get('redirectTo') ?? '/portal/admin/coaches');
    const selectedSchoolCode = resolveProgrammingSchoolCode(session);
    const email = String(form.get('email') ?? '').trim();
    const organizationId =
      selectedSchoolCode === 'TRIAL'
        ? await ensureDashboardTrialOrganizationForCoach(email)
        : await resolveOrganizationIdForSchool({
            schoolCode: selectedSchoolCode,
            fallbackOrganizationId: 0,
            createIfMissing: session.role === 'admin' && selectedSchoolCode !== 'LEAGUE',
          });
    if (organizationId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Coach management is not enabled for this school.');
    }

    const roleRaw = String(form.get('role') ?? '').trim().toLowerCase();
    const role = roleRaw === 'coach' ? 'coach' : 'admin';
    const result = await createStaffUser({
      organizationId,
      name: String(form.get('name') ?? ''),
      email,
      phone: String(form.get('phone') ?? ''),
      password: String(form.get('password') ?? ''),
      role,
      allowCrossSchoolLinking: isGlobalAdminSession(session),
    });
    if (!result.ok) return redirectWithMessage(request, redirectTo, 'error', result.error);
    if (selectedSchoolCode === 'TRIAL') {
      const seeded = await seedDashboardTrialOrganizationFromPcu({
        organizationId,
        coachUserId: result.userId,
        createdByUserId: session.userId ?? result.userId,
      });
      if (!seeded.ok) return redirectWithMessage(request, redirectTo, 'error', seeded.error);
    }
    return redirectWithMessage(request, redirectTo, 'ok', 'Coach profile created.');
  } catch (error) {
    return redirectWithMessage(
      request,
      '/portal/admin/coaches',
      'error',
      error instanceof Error ? error.message : 'Failed to create coach profile.'
    );
  }
}

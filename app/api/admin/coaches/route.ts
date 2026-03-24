import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveClientManagementOrganizationId } from '../../../../lib/programming-scope';
import { createStaffUser } from '../../../../lib/training-db';

function redirectWithMessage(request: Request, redirectTo: string, key: 'ok' | 'error', value: string) {
  const url = new URL(redirectTo, request.url);
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}

function parseGlobalAdminEmails(): string[] {
  const raw = String(process.env.GLOBAL_ADMIN_EMAILS ?? 'jgaynor@pitchingcoachu.com');
  const values = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function isGlobalAdminEmail(email: string): boolean {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return parseGlobalAdminEmails().includes(normalized);
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
    const organizationId = resolveClientManagementOrganizationId(session);
    if (organizationId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Coach management is not enabled for this school.');
    }

    const roleRaw = String(form.get('role') ?? '').trim().toLowerCase();
    const role = roleRaw === 'coach' ? 'coach' : 'admin';

    const result = await createStaffUser({
      organizationId,
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? ''),
      phone: String(form.get('phone') ?? ''),
      password: String(form.get('password') ?? ''),
      role,
      allowCrossSchoolLinking: isGlobalAdminEmail(session.email),
    });

    if (!result.ok) return redirectWithMessage(request, redirectTo, 'error', result.error);
    return redirectWithMessage(
      request,
      redirectTo,
      'ok',
      result.reusedExistingPassword
        ? 'Coach profile created. Existing password for this email was reused across schools.'
        : 'Coach profile created.'
    );
  } catch (error) {
    return redirectWithMessage(
      request,
      '/portal/admin/coaches',
      'error',
      error instanceof Error ? error.message : 'Failed to create coach profile.'
    );
  }
}

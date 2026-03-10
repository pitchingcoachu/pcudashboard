import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { createStaffUser } from '../../../../lib/training-db';

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
    const organizationId = session.organizationId ?? 0;
    if (organizationId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Session organization not found. Please log out and log in again.');
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
    });

    if (!result.ok) return redirectWithMessage(request, redirectTo, 'error', result.error);
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

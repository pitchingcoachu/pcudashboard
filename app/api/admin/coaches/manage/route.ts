import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { deleteStaffUser, setStaffActiveStatus } from '../../../../../lib/training-db';

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

    const staffUserId = Number(String(form.get('staffUserId') ?? '0'));
    const action = String(form.get('action') ?? '').trim().toLowerCase();

    if (!Number.isFinite(staffUserId) || staffUserId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Valid coach user is required.');
    }
    if (staffUserId === (session.userId ?? 0)) {
      return redirectWithMessage(request, redirectTo, 'error', 'You cannot modify your own account here.');
    }

    if (action === 'activate' || action === 'deactivate') {
      const result = await setStaffActiveStatus({
        organizationId,
        staffUserId,
        isActive: action === 'activate',
      });
      if (!result.ok) return redirectWithMessage(request, redirectTo, 'error', result.error);
      return redirectWithMessage(request, redirectTo, 'ok', action === 'activate' ? 'Coach activated.' : 'Coach deactivated.');
    }

    if (action === 'delete') {
      const result = await deleteStaffUser({ organizationId, staffUserId });
      if (!result.ok) return redirectWithMessage(request, redirectTo, 'error', result.error);
      return redirectWithMessage(request, redirectTo, 'ok', 'Coach deleted.');
    }

    return redirectWithMessage(request, redirectTo, 'error', 'Invalid action.');
  } catch (error) {
    return redirectWithMessage(
      request,
      '/portal/admin/coaches',
      'error',
      error instanceof Error ? error.message : 'Failed to update coach.'
    );
  }
}

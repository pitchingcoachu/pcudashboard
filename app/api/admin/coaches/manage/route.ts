import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveClientManagementOrganizationId } from '../../../../../lib/programming-scope';
import { deleteStaffUser, setStaffActiveStatus, syncStaffUserSchools, updateStaffUser } from '../../../../../lib/training-db';

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

    if (action === 'update') {
      const roleRaw = String(form.get('role') ?? '').trim().toLowerCase();
      const role = roleRaw === 'coach' ? 'coach' : 'admin';
      const globalAdmin = isGlobalAdminEmail(session.email);
      const selectedOrganizationIds = Array.from(
        new Set(
          form
            .getAll('organizationIds')
            .map((value) => Number(String(value ?? '').trim()))
            .filter((value) => Number.isFinite(value) && value > 0)
        )
      );
      if (globalAdmin && selectedOrganizationIds.length > 0) {
        const syncResult = await syncStaffUserSchools({
          organizationId,
          staffUserId,
          name: String(form.get('name') ?? ''),
          email: String(form.get('email') ?? ''),
          phone: String(form.get('phone') ?? ''),
          role,
          targetOrganizationIds: selectedOrganizationIds,
        });
        if (!syncResult.ok) return redirectWithMessage(request, redirectTo, 'error', syncResult.error);
        return redirectWithMessage(request, redirectTo, 'ok', 'Coach updated across selected schools.');
      }
      const result = await updateStaffUser({
        organizationId,
        staffUserId,
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        phone: String(form.get('phone') ?? ''),
        role,
      });
      if (!result.ok) return redirectWithMessage(request, redirectTo, 'error', result.error);
      return redirectWithMessage(request, redirectTo, 'ok', 'Coach updated.');
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

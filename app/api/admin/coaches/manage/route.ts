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

function parseOrgSchoolMap(raw: string): Record<number, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<number, string> = {};
    for (const [orgIdRaw, schoolRaw] of Object.entries(parsed)) {
      const orgId = Number(orgIdRaw);
      const school = typeof schoolRaw === 'string' ? schoolRaw.trim().toUpperCase() : '';
      if (!Number.isFinite(orgId) || orgId <= 0 || !school) continue;
      out[orgId] = school;
    }
    return out;
  } catch {
    return {};
  }
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
      const selectedSchoolCodes = Array.from(
        new Set(
          form
            .getAll('schoolCodes')
            .map((value) => String(value ?? '').trim().toUpperCase())
            .filter(Boolean)
        )
      );
      if (globalAdmin && selectedSchoolCodes.length > 0) {
        const map = parseOrgSchoolMap(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}');
        const targetOrgIds = Array.from(
          new Set(
            Object.entries(map)
              .filter(([, school]) => selectedSchoolCodes.includes(school))
              .map(([orgId]) => Number(orgId))
              .filter((orgId) => Number.isFinite(orgId) && orgId > 0)
          )
        );
        const syncResult = await syncStaffUserSchools({
          organizationId,
          staffUserId,
          name: String(form.get('name') ?? ''),
          email: String(form.get('email') ?? ''),
          phone: String(form.get('phone') ?? ''),
          role,
          targetOrganizationIds: targetOrgIds.length > 0 ? targetOrgIds : [organizationId],
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

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  createSessionToken,
  DOMAIN_SESSION_COOKIE_NAME,
  getDomainSessionCookieOptions,
  getSessionCookieOptions,
  getSessionFromRequest,
  SESSION_COOKIE_NAME,
} from '../../../../lib/auth';
import { resolveSessionDashboardSchoolOptions } from '../../../../lib/dashboard-school-options';
import { getLoginOrganizationIdForUser, resolveOrganizationIdForSchool } from '../../../../lib/training-db';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { schoolCode?: string | null };
  const requested = String(body.schoolCode ?? '').trim().toUpperCase();
  const role: 'admin' | 'coach' | 'player' =
    session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin';
  const allowed = await resolveSessionDashboardSchoolOptions({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role,
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  });
  const nextSchoolCode = requested && allowed.includes(requested) ? requested : null;

  const isMobileClient = request.headers.get('x-client') === 'mobile';

  // Mobile has no separate "selected school" concept layered on top of the
  // login org the way web does (dashboardSchoolCode alone) -- switching
  // schools on mobile re-scopes the ENTIRE session by changing
  // organizationId itself, since every mobile-facing route already reads
  // session.organizationId directly. Web's cookie-based flow is unchanged:
  // it never touches organizationId, only dashboardSchoolCode.
  let nextOrganizationId = session.organizationId;
  if (isMobileClient && nextSchoolCode) {
    // No fallbackOrganizationId here on purpose: passing the caller's own org
    // lets resolveOrganizationIdForSchool short-circuit onto it whenever its
    // name loosely contains the school code (e.g. a personal org named "LSU
    // Organization" would hijack a switch to the real "LSU" org). Omitting it
    // forces an exact-name match against the real school org.
    const resolved = await resolveOrganizationIdForSchool({ schoolCode: nextSchoolCode });
    if (resolved > 0) nextOrganizationId = resolved;
  } else if (isMobileClient && !nextSchoolCode) {
    // Switching back to "My Organization" -- restore the real login org, not
    // whatever org a previous school switch left in session.organizationId.
    const loginOrganizationId = await getLoginOrganizationIdForUser(session.userId ?? 0);
    if (loginOrganizationId > 0) nextOrganizationId = loginOrganizationId;
  }

  const token = createSessionToken({
    userId: session.userId,
    email: session.email,
    appUrl: session.appUrl,
    apps: session.apps,
    name: session.name,
    role: session.role,
    organizationId: nextOrganizationId,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: nextSchoolCode,
  });

  if (isMobileClient) {
    return NextResponse.json({ ok: true, token, schoolCode: nextSchoolCode, organizationId: nextOrganizationId });
  }

  const requestUrl = new URL(request.url);
  const hostname = requestUrl.hostname;
  const response = NextResponse.json({ ok: true, schoolCode: nextSchoolCode });
  response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
  const domainOptions = getDomainSessionCookieOptions(hostname);
  if (domainOptions) {
    response.cookies.set(DOMAIN_SESSION_COOKIE_NAME, token, domainOptions);
  }
  return response;
}

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
import { resolveOrganizationIdForSchool } from '../../../../lib/training-db';

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
    const resolved = await resolveOrganizationIdForSchool({
      schoolCode: nextSchoolCode,
      fallbackOrganizationId: session.organizationId,
    });
    if (resolved > 0) nextOrganizationId = resolved;
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

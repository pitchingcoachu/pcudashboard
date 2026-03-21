import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  createSessionToken,
  DOMAIN_SESSION_COOKIE_NAME,
  getDomainSessionCookieOptions,
  getSessionCookieOptions,
  getSessionFromCookies,
  SESSION_COOKIE_NAME,
} from '../../../../lib/auth';
import { resolveAllowedDashboardSchoolCodes } from '../../../../lib/dashboard-access';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { schoolCode?: string | null };
  const requested = String(body.schoolCode ?? '').trim().toUpperCase();
  const allowed = resolveAllowedDashboardSchoolCodes();
  const nextSchoolCode = requested && allowed.includes(requested) ? requested : null;

  const token = createSessionToken({
    userId: session.userId,
    email: session.email,
    appUrl: session.appUrl,
    apps: session.apps,
    name: session.name,
    role: session.role,
    organizationId: session.organizationId,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: nextSchoolCode,
  });

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

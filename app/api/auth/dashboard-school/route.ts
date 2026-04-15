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
import { resolveSessionDashboardSchoolOptions } from '../../../../lib/dashboard-school-options';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
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

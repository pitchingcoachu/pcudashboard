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
import { canUseProgrammingData } from '../../../../lib/programming-scope';
import { resolveHomeDashboardSchoolCode } from '../../../../lib/dashboard-home-school';
import { resolveSessionDashboardSchoolOptions } from '../../../../lib/dashboard-school-options';

function normalizeSchoolCode(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function resolveDefaultDashboardSchoolCode(): string {
  const value = normalizeSchoolCode(process.env.DASHBOARD_DEFAULT_SCHOOL_CODE ?? 'OSU');
  return value || 'OSU';
}

function choosePreferredSchoolCode(current: string | null | undefined, allowed: string[]): string | null {
  const normalizedAllowed = Array.from(
    new Set(allowed.map((code) => normalizeSchoolCode(code)).filter(Boolean))
  );
  const preferred =
    normalizedAllowed.find((code) => code !== 'LEAGUE' && code !== 'PRO') ??
    normalizedAllowed[0] ??
    null;
  const currentCode = normalizeSchoolCode(current);
  if (!currentCode) return preferred;
  if (!normalizedAllowed.length) return currentCode;
  if (!normalizedAllowed.includes(currentCode)) return preferred ?? currentCode;
  const defaultCode = resolveDefaultDashboardSchoolCode();
  if (currentCode === defaultCode && preferred && preferred !== currentCode) return preferred;
  return currentCode;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url), 303);
  }

  const normalizedCurrent = String(session.dashboardSchoolCode ?? '').trim().toUpperCase();
  let normalizedHome = normalizedCurrent;
  let shouldResetSchool = false;

  if (!normalizedHome) {
    let homeSchoolCode = resolveHomeDashboardSchoolCode({
      email: session.email,
      organizationId: session.organizationId ?? null,
      dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    });
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
    homeSchoolCode = choosePreferredSchoolCode(homeSchoolCode, allowed);
    normalizedHome = String(homeSchoolCode ?? '').trim().toUpperCase();
    shouldResetSchool = Boolean(normalizedHome) && normalizedCurrent !== normalizedHome;
  }

  const selectedSchoolCode = String(normalizedHome || session.dashboardSchoolCode || '').trim().toUpperCase();
  const isPcuSchool = selectedSchoolCode === 'PCU';
  const destination = isPcuSchool
    ? session.role === 'player'
      ? canUseProgrammingData({
          role: session.role,
          organizationId: session.organizationId ?? 0,
          email: session.email,
          dashboardSchoolCode: normalizedHome || session.dashboardSchoolCode || null,
        })
        ? '/portal/player'
        : '/portal/dashboard'
      : '/portal/admin'
    : '/portal/dashboard';

  const response = NextResponse.redirect(new URL(destination, request.url), 303);
  if (shouldResetSchool) {
    const token = createSessionToken({
      userId: session.userId,
      email: session.email,
      appUrl: session.appUrl,
      apps: session.apps,
      name: session.name,
      role: session.role,
      organizationId: session.organizationId,
      playerId: session.playerId ?? null,
      dashboardSchoolCode: normalizedHome,
    });
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
    const domainOptions = getDomainSessionCookieOptions(requestUrl.hostname);
    if (domainOptions) {
      response.cookies.set(DOMAIN_SESSION_COOKIE_NAME, token, domainOptions);
    }
  }

  return response;
}

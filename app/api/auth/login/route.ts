import { NextResponse } from 'next/server';
import {
  createSessionToken,
  DOMAIN_SESSION_COOKIE_NAME,
  getDomainSessionCookieOptions,
  getSessionCookieOptions,
  LEGACY_SESSION_COOKIE_NAMES,
  SESSION_COOKIE_NAME,
  validateLoginCredentials,
} from '../../../../lib/auth';
import { resolveSessionDashboardSchoolOptions } from '../../../../lib/dashboard-school-options';
import { resolveHomeDashboardSchoolCode } from '../../../../lib/dashboard-home-school';
import { canUseProgrammingData } from '../../../../lib/programming-scope';

type LoginPayload = {
  email?: string;
  password?: string;
};

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

export async function POST(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const isWebMode = requestUrl.searchParams.get('mode') === 'web';
    const contentType = request.headers.get('content-type') ?? '';

    let email = '';
    let password = '';

    if (contentType.includes('application/json')) {
      const body = (await request.json()) as LoginPayload;
      email = (body.email ?? '').trim();
      password = body.password ?? '';
    } else {
      const formData = await request.formData();
      email = String(formData.get('email') ?? '').trim();
      password = String(formData.get('password') ?? '');
    }

    if (!email || !password) {
      if (isWebMode) {
        return NextResponse.redirect(new URL('/login?error=missing', request.url), 303);
      }
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
    }

    const user = await validateLoginCredentials(email, password);
    if (!user) {
      if (isWebMode) {
        return NextResponse.redirect(new URL('/login?error=invalid', request.url), 303);
      }
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    let resolvedDashboardSchoolCode = resolveHomeDashboardSchoolCode({
      email: user.email,
      organizationId: user.organizationId ?? null,
      dashboardSchoolCode: user.dashboardSchoolCode ?? null,
    });
    const normalizedRole: 'admin' | 'coach' | 'player' =
      user.role === 'player' ? 'player' : user.role === 'coach' ? 'coach' : 'admin';
    const allowed = await resolveSessionDashboardSchoolOptions({
      userId: user.userId ?? 0,
      email: user.email,
      name: user.name,
      role: normalizedRole,
      organizationId: user.organizationId ?? 0,
      playerId: user.playerId ?? null,
      dashboardSchoolCode: user.dashboardSchoolCode ?? null,
      appUrl: user.appUrl,
      apps: user.apps,
    });
    resolvedDashboardSchoolCode = choosePreferredSchoolCode(resolvedDashboardSchoolCode, allowed);

    const token = createSessionToken({
      ...user,
      dashboardSchoolCode: resolvedDashboardSchoolCode,
    });
    const hostname = requestUrl.hostname;

    if (isWebMode) {
      const destination =
        normalizedRole === 'player'
          ? canUseProgrammingData({
              role: normalizedRole,
              organizationId: user.organizationId ?? 0,
              email: user.email,
              dashboardSchoolCode: resolvedDashboardSchoolCode,
            })
            ? '/portal/player'
            : '/portal/dashboard'
          : '/portal/admin';
      const response = NextResponse.redirect(new URL(destination, request.url), 303);
      response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
      const domainOptions = getDomainSessionCookieOptions(hostname);
      if (domainOptions) {
        response.cookies.set(DOMAIN_SESSION_COOKIE_NAME, token, domainOptions);
      }
      for (const legacyCookieName of LEGACY_SESSION_COOKIE_NAMES) {
        response.cookies.set(legacyCookieName, '', { ...getSessionCookieOptions(), maxAge: 0 });
      }
      return response;
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
    const domainOptions = getDomainSessionCookieOptions(hostname);
    if (domainOptions) {
      response.cookies.set(DOMAIN_SESSION_COOKIE_NAME, token, domainOptions);
    }
    for (const legacyCookieName of LEGACY_SESSION_COOKIE_NAMES) {
      response.cookies.set(legacyCookieName, '', { ...getSessionCookieOptions(), maxAge: 0 });
    }
    return response;
  } catch (error) {
    const requestUrl = new URL(request.url);
    const isWebMode = requestUrl.searchParams.get('mode') === 'web';
    if (isWebMode) {
      return NextResponse.redirect(new URL('/login?error=server', request.url), 303);
    }
    return NextResponse.json(
      { error: `Login failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

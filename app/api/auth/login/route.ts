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
import { canUseProgrammingData } from '../../../../lib/programming-scope';

type LoginPayload = {
  email?: string;
  password?: string;
};

function parseOrgSchoolMap(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([k, v]) => k.trim().length > 0 && typeof v === 'string' && v.trim().length > 0)
        .map(([k, v]) => [k.trim(), String(v).trim().toUpperCase()])
    );
  } catch {
    return {};
  }
}

function resolveMappedSchoolCodeForOrgId(organizationId: number | null | undefined): string | null {
  const orgId = Number(organizationId ?? 0);
  if (!Number.isFinite(orgId) || orgId <= 0) return null;
  const map = parseOrgSchoolMap(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}');
  const code = map[String(orgId)];
  return code ? String(code).trim().toUpperCase() : null;
}

function parseGlobalAdminEmails(): string[] {
  const raw = String(
    process.env.GLOBAL_ADMIN_EMAILS ??
      'jgaynor@pitchingcoachu.com,ahalverson@pitchingcoachu.com,jchipman@pitchingcoachu.com'
  );
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

function resolveLoginDefaultDashboardSchoolCode(email: string, current: string | null | undefined): string | null | undefined {
  if (isGlobalAdminEmail(email)) {
    return 'PCU';
  }
  return current;
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

    const orgMappedSchoolCode =
      user.role === 'admin' ? null : resolveMappedSchoolCodeForOrgId(user.organizationId ?? null);
    const resolvedDashboardSchoolCode =
      orgMappedSchoolCode ?? resolveLoginDefaultDashboardSchoolCode(user.email, user.dashboardSchoolCode);

    const token = createSessionToken({
      ...user,
      dashboardSchoolCode: resolvedDashboardSchoolCode,
    });
    const hostname = requestUrl.hostname;

    if (isWebMode) {
      const destination =
        user.role === 'player'
          ? canUseProgrammingData({
              role: user.role,
              organizationId: user.organizationId ?? 0,
              email: user.email,
              dashboardSchoolCode: user.dashboardSchoolCode ?? null,
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

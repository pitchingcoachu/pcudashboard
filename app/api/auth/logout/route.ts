import { NextResponse } from 'next/server';
import {
  DOMAIN_SESSION_COOKIE_NAME,
  getDomainSessionCookieOptions,
  getSessionCookieOptions,
  LEGACY_SESSION_COOKIE_NAMES,
  SESSION_COOKIE_NAME,
} from '../../../../lib/auth';

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  const hostname = new URL(request.url).hostname;
  response.cookies.set(SESSION_COOKIE_NAME, '', { ...getSessionCookieOptions(), maxAge: 0 });
  const domainOptions = getDomainSessionCookieOptions(hostname);
  if (domainOptions) {
    response.cookies.set(DOMAIN_SESSION_COOKIE_NAME, '', { ...domainOptions, maxAge: 0 });
  }
  for (const legacyCookieName of LEGACY_SESSION_COOKIE_NAMES) {
    response.cookies.set(legacyCookieName, '', { ...getSessionCookieOptions(), maxAge: 0 });
  }
  return response;
}

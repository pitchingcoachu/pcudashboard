import { NextResponse } from 'next/server';
import { getSessionCookieOptions, SESSION_COOKIE_NAME } from '../../../../lib/auth';

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  const hostname = new URL(request.url).hostname;
  response.cookies.set(SESSION_COOKIE_NAME, '', { ...getSessionCookieOptions(hostname), maxAge: 0 });
  return response;
}

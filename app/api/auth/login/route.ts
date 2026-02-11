import { NextResponse } from 'next/server';
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME, validateLoginCredentials } from '../../../../lib/auth';

type LoginPayload = {
  email?: string;
  password?: string;
};

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

    const token = createSessionToken(user);
    const hostname = requestUrl.hostname;

    if (isWebMode) {
      const response = NextResponse.redirect(new URL('/portal', request.url), 303);
      response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions(hostname));
      return response;
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions(hostname));
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

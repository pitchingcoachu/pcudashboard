import { NextResponse } from 'next/server';
import { isDatabaseConfigured, resetPasswordWithToken } from '../../../../lib/auth-db';

type ResetPayload = {
  token?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ResetPayload;
  const token = (body.token ?? '').trim();
  const password = body.password ?? '';

  if (!token || !password) {
    return NextResponse.json({ error: 'Token and password are required.' }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Password reset requires DATABASE_URL configuration.' }, { status: 500 });
  }

  const didReset = await resetPasswordWithToken(token, password);
  if (!didReset) {
    return NextResponse.json({ error: 'Invalid or expired reset token.' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

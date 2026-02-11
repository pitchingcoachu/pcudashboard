import { NextResponse } from 'next/server';
import { createPasswordResetToken, isDatabaseConfigured } from '../../../../lib/auth-db';

type ForgotPayload = {
  email?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ForgotPayload;
    const email = (body.email ?? '').trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    if (!isDatabaseConfigured()) {
      return NextResponse.json({ error: 'Password reset requires DATABASE_URL configuration.' }, { status: 500 });
    }

    const tokenRecord = await createPasswordResetToken(email);

    // Always return success to avoid exposing whether the email exists.
    if (!tokenRecord) {
      return NextResponse.json({ ok: true });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      return NextResponse.json({ error: 'RESEND_API_KEY is not configured.' }, { status: 500 });
    }

    const fromEmail = process.env.DEMO_REQUEST_FROM_EMAIL ?? 'onboarding@resend.dev';
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(tokenRecord.token)}`;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [tokenRecord.email],
        subject: 'Reset your PCU Dashboard password',
        text: `Use this link to reset your password: ${resetUrl}`,
        html: `<p>Use this link to reset your PCU Dashboard password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
      }),
    });

    if (!resendResponse.ok) {
      // Do not leak provider errors to end-users on forgot-password.
      // We still return success to keep response consistent and prevent account enumeration signals.
      console.error('Forgot-password email provider error:', await resendResponse.text());
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: `Forgot-password request failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

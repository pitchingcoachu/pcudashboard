import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { DEMO_REQUEST_FOLLOWUP_TEMPLATE_KEY, htmlToPlainText, saveEmailTemplate } from '../../../../lib/email-templates';

function redirectWithMessage(request: Request, redirectTo: string, key: 'ok' | 'error', value: string) {
  const url = new URL(redirectTo, request.url);
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const redirectTo = '/portal/admin/email-templates';
  try {
    const cookieStore = await cookies();
    const session = getSessionFromCookies(cookieStore);
    if (!session) return NextResponse.redirect(new URL('/login', request.url), 303);
    if ((session.role ?? 'admin') !== 'admin' || session.email.trim().toLowerCase() !== 'jgaynor@pitchingcoachu.com') {
      return redirectWithMessage(request, '/portal/admin', 'error', 'Only authorized admins can edit email templates.');
    }

    const form = await request.formData();
    const subject = String(form.get('subject') ?? '').trim();
    const bodyHtml = String(form.get('bodyHtml') ?? '').trim();
    const bodyText = String(form.get('bodyText') ?? '').trim() || htmlToPlainText(bodyHtml);
    if (!subject || (!bodyText && !bodyHtml)) {
      return redirectWithMessage(request, redirectTo, 'error', 'Subject and body are required.');
    }

    await saveEmailTemplate({
      templateKey: DEMO_REQUEST_FOLLOWUP_TEMPLATE_KEY,
      fromName: String(form.get('fromName') ?? '').trim(),
      fromEmail: String(form.get('fromEmail') ?? '').trim(),
      subject,
      bodyText,
      bodyHtml,
    });

    return redirectWithMessage(request, redirectTo, 'ok', 'Email template saved.');
  } catch (error) {
    return redirectWithMessage(
      request,
      redirectTo,
      'error',
      error instanceof Error ? error.message : 'Failed to save email template.'
    );
  }
}

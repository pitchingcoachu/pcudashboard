import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../lib/auth';

type FeedbackPayload = {
  message?: string;
  pagePath?: string;
  pageTitle?: string;
  browserUrl?: string;
};

const MAX_FEEDBACK_LENGTH = 4000;

export async function POST(request: Request) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as FeedbackPayload;
  const message = String(payload.message ?? '').trim();
  if (!message) return NextResponse.json({ error: 'Feedback message is required.' }, { status: 400 });
  if (message.length > MAX_FEEDBACK_LENGTH) {
    return NextResponse.json({ error: `Feedback message must be ${MAX_FEEDBACK_LENGTH} characters or fewer.` }, { status: 400 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY is not configured.' }, { status: 500 });
  }

  const toEmail = process.env.FEEDBACK_TO_EMAIL ?? 'jgaynor@pitchingcoachu.com';
  const fromEmail = process.env.FEEDBACK_FROM_EMAIL ?? process.env.DEMO_REQUEST_FROM_EMAIL ?? 'onboarding@resend.dev';
  const pagePath = String(payload.pagePath ?? '').trim() || '(unknown page)';
  const pageTitle = String(payload.pageTitle ?? '').trim() || '(unknown title)';
  const browserUrl = String(payload.browserUrl ?? '').trim() || request.headers.get('referer') || '(unknown url)';
  const schoolCode = session.dashboardSchoolCode ?? '(none)';
  const subject = `PCU feedback - ${pagePath.slice(0, 120)}`;
  const text = [
    'New PCU Dashboard feedback submitted.',
    '',
    'From:',
    `Name: ${session.name ?? '(not provided)'}`,
    `Email: ${session.email}`,
    `Role: ${session.role ?? 'admin'}`,
    `User ID: ${session.userId ?? '(none)'}`,
    `Organization ID: ${session.organizationId ?? '(none)'}`,
    `Player ID: ${session.playerId ?? '(none)'}`,
    `School: ${schoolCode}`,
    '',
    'Page:',
    `Path: ${pagePath}`,
    `Title: ${pageTitle}`,
    `URL: ${browserUrl}`,
    '',
    'Message:',
    message,
  ].join('\n');
  const html = `
    <h2>New PCU Dashboard feedback submitted</h2>
    <h3>From</h3>
    <p>
      <strong>Name:</strong> ${escapeHtml(session.name ?? '(not provided)')}<br />
      <strong>Email:</strong> ${escapeHtml(session.email)}<br />
      <strong>Role:</strong> ${escapeHtml(session.role ?? 'admin')}<br />
      <strong>User ID:</strong> ${escapeHtml(String(session.userId ?? '(none)'))}<br />
      <strong>Organization ID:</strong> ${escapeHtml(String(session.organizationId ?? '(none)'))}<br />
      <strong>Player ID:</strong> ${escapeHtml(String(session.playerId ?? '(none)'))}<br />
      <strong>School:</strong> ${escapeHtml(schoolCode)}
    </p>
    <h3>Page</h3>
    <p>
      <strong>Path:</strong> ${escapeHtml(pagePath)}<br />
      <strong>Title:</strong> ${escapeHtml(pageTitle)}<br />
      <strong>URL:</strong> ${escapeHtml(browserUrl)}
    </p>
    <h3>Message</h3>
    <p>${escapeHtml(message).replaceAll('\n', '<br />')}</p>
  `;

  try {
    await sendResendEmail(resendApiKey, {
      from: fromEmail,
      to: [toEmail],
      reply_to: session.email,
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error('Feedback email provider error:', error);
    return NextResponse.json({ error: 'Feedback email could not be sent.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

async function sendResendEmail(
  resendApiKey: string,
  payload: {
    from: string;
    to: string[];
    reply_to?: string;
    subject: string;
    text: string;
    html: string;
  }
) {
  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resendResponse.ok) {
    throw new Error(await resendResponse.text());
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

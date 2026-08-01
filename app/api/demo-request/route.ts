import { NextResponse } from 'next/server';
import { createDashboardTrialCoach } from '../../../lib/training-db';

type DemoPayload = {
  name?: string;
  email?: string;
  phone?: string;
  school_or_facility?: string;
  role?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as DemoPayload;
  const name = (body.name ?? '').trim();
  const email = (body.email ?? '').trim();
  const phone = (body.phone ?? '').trim();
  const schoolOrFacility = (body.school_or_facility ?? '').trim();
  const role = (body.role ?? '').trim();

  if (!name || !email || !schoolOrFacility || !role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const sheetsWebhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  const requireEmailDelivery = process.env.REQUIRE_DEMO_REQUEST_EMAIL !== 'false';
  const allowLocalPreviewOnly = process.env.NODE_ENV !== 'production' && !resendApiKey && !sheetsWebhookUrl;
  if (!resendApiKey && !sheetsWebhookUrl) {
    if (!allowLocalPreviewOnly) {
      return NextResponse.json({ error: 'No delivery method configured' }, { status: 500 });
    }
  }

  const deliveryResults: string[] = [];
  const deliveryErrors: string[] = [];
  let emailDelivered = false;
  let confirmationEmailDelivered = false;
  let followupPreview: { subject: string; html: string; text: string } | null = null;
  const trialPassword = process.env.DEMO_TRIAL_DEFAULT_PASSWORD ?? 'pitchingcoachu';
  const trialDays = Math.max(1, Math.min(60, Number(process.env.DEMO_TRIAL_DAYS ?? 7) || 7));
  const trialLoginUrl = new URL('/login', request.url).toString();
  const trialAccount = await createDashboardTrialCoach({
    name,
    email,
    phone,
    password: trialPassword,
    trialDays,
  });
  if (!trialAccount.ok) {
    return NextResponse.json(
      { error: trialAccount.error, code: trialAccount.code },
      { status: trialAccount.code === 'duplicate_trial' ? 409 : 500 }
    );
  }
  const trialExpiresAt = formatTrialExpiration(trialAccount.expiresAt);
  const toEmail = process.env.DEMO_REQUEST_TO_EMAIL ?? 'info@pitchingcoachu.com';
  const fromEmail = process.env.DEMO_REQUEST_FROM_EMAIL ?? 'onboarding@resend.dev';
  const confirmationFromEmail = process.env.DEMO_REQUEST_CONFIRMATION_FROM_EMAIL ?? fromEmail;
  const replyToEmail = process.env.DEMO_REQUEST_REPLY_TO_EMAIL ?? toEmail;
  followupPreview = buildTrialFollowupPreview({
    email,
    password: trialPassword,
    loginUrl: trialLoginUrl,
  });
  const sheetsRequest = sheetsWebhookUrl
    ? fetchWithTimeout(
        sheetsWebhookUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submitted_at: new Date().toISOString(),
            name,
            email,
            phone: phone || '',
            school_or_facility: schoolOrFacility,
            role,
          }),
        },
        2500
      )
    : null;

  if (resendApiKey) {
    const subject = `New PCU Demo Request - ${name}`;
    const text = [
      'New demo request submitted:',
      '',
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone || '(not provided)'}`,
      `School/Facility: ${schoolOrFacility}`,
      `Role: ${role}`,
      '',
      'Trial account:',
      `Login: ${trialLoginUrl}`,
      `Email: ${email}`,
      `Password: ${trialPassword}`,
      `Expires: ${trialExpiresAt}`,
      `Trial org ID: ${trialAccount.organizationId}`,
      `Coach user ID: ${trialAccount.userId}`,
    ].join('\n');

    const html = `
      <h2>New PCU Demo Request</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone || '(not provided)')}</p>
      <p><strong>School/Facility:</strong> ${escapeHtml(schoolOrFacility)}</p>
      <p><strong>Role:</strong> ${escapeHtml(role)}</p>
      <h3>Trial account</h3>
      <p><strong>Login:</strong> <a href="${escapeHtml(trialLoginUrl)}">${escapeHtml(trialLoginUrl)}</a></p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Password:</strong> ${escapeHtml(trialPassword)}</p>
      <p><strong>Expires:</strong> ${escapeHtml(trialExpiresAt)}</p>
      <p><strong>Trial org ID:</strong> ${trialAccount.organizationId}<br /><strong>Coach user ID:</strong> ${trialAccount.userId}</p>
    `;

    const emailTasks = [
      sendResendEmail(resendApiKey, {
        from: fromEmail,
        to: [toEmail],
        reply_to: email,
        subject,
        text,
        html,
      }),
      followupPreview
        ? sendResendEmail(resendApiKey, {
            from: confirmationFromEmail,
            to: [email],
            reply_to: replyToEmail,
            subject: followupPreview.subject,
            text: followupPreview.text,
            html: followupPreview.html,
          })
        : Promise.reject(new Error('Follow-up preview could not be rendered.')),
    ] as const;

    const [notificationResult, confirmationResult] = await Promise.allSettled(emailTasks);
    if (notificationResult.status === 'fulfilled') {
      emailDelivered = true;
      deliveryResults.push('email');
    } else {
      deliveryErrors.push(`Email provider error: ${String(notificationResult.reason)}`);
    }
    if (confirmationResult.status === 'fulfilled') {
      confirmationEmailDelivered = true;
      deliveryResults.push('confirmation_email');
    } else {
      deliveryErrors.push(`Confirmation email provider error: ${String(confirmationResult.reason)}`);
    }
  } else if (allowLocalPreviewOnly) {
    if (followupPreview) {
      deliveryResults.push('local_preview');
    }
  } else if (requireEmailDelivery) {
    deliveryErrors.push('Email provider error: RESEND_API_KEY is not configured');
  }

  if (sheetsRequest) {
    try {
      const sheetsResponse = await sheetsRequest;

      if (!sheetsResponse.ok) {
        const sheetError = await sheetsResponse.text();
        deliveryErrors.push(`Google Sheets webhook error: ${sheetError}`);
      } else {
        deliveryResults.push('sheets');
      }
    } catch (error) {
      deliveryErrors.push(`Google Sheets webhook error: ${String(error)}`);
    }
  }

  if (deliveryResults.length === 0) {
    console.error('Demo request delivery failed:', deliveryErrors.join(' | '));
    return NextResponse.json({ error: deliveryErrors.join(' | ') }, { status: 502 });
  }

  const warnings: string[] = [];
  if (requireEmailDelivery && !emailDelivered) {
    warnings.push(allowLocalPreviewOnly ? 'Local preview only. No email was sent.' : 'Request saved, but email notification failed.');
  }
  if (resendApiKey && !confirmationEmailDelivered) {
    warnings.push('Request saved, but follow-up email failed.');
  }
  if (deliveryErrors.length > 0) {
    console.error('Demo request delivery issues:', deliveryErrors.join(' | '));
  }

  return NextResponse.json({
    ok: true,
    delivered_via: deliveryResults,
    warnings,
    followupPreview,
    trial: {
      loginUrl: trialLoginUrl,
      email,
      expiresAt: trialExpiresAt,
    },
  });
}

function formatTrialExpiration(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Phoenix',
  });
}

function buildTrialFollowupPreview(input: { email: string; password: string; loginUrl: string }): { subject: string; html: string; text: string } {
  const loomUrl = 'https://www.loom.com/share/8cd75fe607114b8797a68458aacf326e';
  const loginUrl = input.loginUrl;
  const subject = 'Your PCU Dashboard trial account is ready';
  const text = [
    'Thank you for your interest in the PCU Dashboard!',
    '',
    `To start, click here (${loomUrl}) to watch a 5 minute video walkthrough on key features of the dashboard.`,
    '',
    `To access your trial account, Click here (${loginUrl}) to go to log in page. Your log in credentials are:`,
    '',
    `Email: ${input.email}`,
    `Password: ${input.password}`,
    '',
    'Players used in the trial account are fake names with real data for you to get an idea of what you can do.',
    '',
    'Please reach out with any questions via email at info@pitchingcoachu.com or by phone (call or text) at (602)321-8909.',
    '',
    'We look forward to talking soon!',
    '',
    'All the best,',
    '',
    'PCU team',
  ].join('\n');
  const html = [
    '<p>Thank you for your interest in the PCU Dashboard!</p>',
    `<p>To start, <a href="${loomUrl}" target="_blank" rel="noopener noreferrer">click here</a> to watch a 5 minute video walkthrough on key features of the dashboard.</p>`,
    `<p>To access your trial account, <a href="${loginUrl}" target="_blank" rel="noopener noreferrer">Click here</a> to go to log in page. Your log in credentials are:</p>`,
    `<p>Email: ${escapeHtml(input.email)}<br />Password: ${escapeHtml(input.password)}</p>`,
    '<p>Players used in the trial account are fake names with real data for you to get an idea of what you can do.</p>',
    '<p>Please reach out with any questions via email at <a href="mailto:info@pitchingcoachu.com">info@pitchingcoachu.com</a> or by phone (call or text) at <a href="tel:+16023218909">(602)321-8909</a>.</p>',
    '<p>We look forward to talking soon!</p>',
    '<p>All the best,</p>',
    '<p>PCU team</p>',
  ].join('\n');
  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

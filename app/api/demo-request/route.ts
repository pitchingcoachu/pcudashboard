import { NextResponse } from 'next/server';
import {
  DEMO_REQUEST_FOLLOWUP_TEMPLATE_KEY,
  getEmailTemplate,
  renderDemoRequestTemplate,
} from '../../../lib/email-templates';

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
  const toEmail = process.env.DEMO_REQUEST_TO_EMAIL ?? 'info@pitchingcoachu.com';
  const fromEmail = process.env.DEMO_REQUEST_FROM_EMAIL ?? 'onboarding@resend.dev';
  const confirmationFromEmail = process.env.DEMO_REQUEST_CONFIRMATION_FROM_EMAIL ?? fromEmail;
  const replyToEmail = process.env.DEMO_REQUEST_REPLY_TO_EMAIL ?? toEmail;
  try {
    const template = await getEmailTemplate(DEMO_REQUEST_FOLLOWUP_TEMPLATE_KEY);
    const rendered = renderDemoRequestTemplate(
      template,
      {
        name,
        email,
        phone,
        school_or_facility: schoolOrFacility,
        role,
      },
      confirmationFromEmail
    );
    followupPreview = {
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };
  } catch (error) {
    deliveryErrors.push(`Follow-up preview render error: ${String(error)}`);
  }
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
    ].join('\n');

    const html = `
      <h2>New PCU Demo Request</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone || '(not provided)')}</p>
      <p><strong>School/Facility:</strong> ${escapeHtml(schoolOrFacility)}</p>
      <p><strong>Role:</strong> ${escapeHtml(role)}</p>
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
  });
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

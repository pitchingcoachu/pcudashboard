import { NextResponse } from 'next/server';

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
  if (!resendApiKey && !sheetsWebhookUrl) {
    return NextResponse.json({ error: 'No delivery method configured' }, { status: 500 });
  }

  const deliveryResults: string[] = [];
  const deliveryErrors: string[] = [];

  if (resendApiKey) {
    const toEmail = process.env.DEMO_REQUEST_TO_EMAIL ?? 'info@pitchingcoachu.com';
    const fromEmail = process.env.DEMO_REQUEST_FROM_EMAIL ?? 'onboarding@resend.dev';

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

    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [toEmail],
          reply_to: email,
          subject,
          text,
          html,
        }),
      });

      if (!resendResponse.ok) {
        const errorText = await resendResponse.text();
        deliveryErrors.push(`Email provider error: ${errorText}`);
      } else {
        deliveryResults.push('email');
      }
    } catch (error) {
      deliveryErrors.push(`Email provider error: ${String(error)}`);
    }
  }

  if (sheetsWebhookUrl) {
    try {
      const sheetsResponse = await fetch(sheetsWebhookUrl, {
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
      });

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
    return NextResponse.json({ error: deliveryErrors.join(' | ') }, { status: 502 });
  }

  return NextResponse.json({ ok: true, delivered_via: deliveryResults });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

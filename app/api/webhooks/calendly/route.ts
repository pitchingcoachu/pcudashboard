import { after, NextResponse } from 'next/server';
import { listStaffForSchool } from '../../../../lib/auth-db';
import { cancelExternalAssessment, upsertExternalAssessment } from '../../../../lib/booking-db';
import { calendlyOrganizationId, isAssessmentEvent, parseCalendlyInvitee, verifyCalendlySignature } from '../../../../lib/calendly';
import { syncGoogleCalendarForTimes } from '../../../../lib/google-calendar';
import { sendPushNotificationToUsers } from '../../../../lib/push-notifications';
import { createNotificationsForUsers } from '../../../../lib/training-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

async function notifyAdmins(title: string, detail: string) {
  const admins = (await listStaffForSchool('PCU')).filter((person) => person.role === 'admin').map((person) => person.userId);
  if (!admins.length) return;
  await createNotificationsForUsers({ recipientUserIds: admins, eventType: 'session_booked', title, detail, path: '/portal/dashboard?suite=scheduling', actorName: 'Calendly' });
  await sendPushNotificationToUsers({ userIds: admins, title, body: detail, data: { type: 'session_booked' } });
}

// Calendly reschedules arrive as `invitee.canceled` (old time) followed by `invitee.created` (new time),
// each with its own invitee URI, so handling create + cancel covers reschedules too.
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyCalendlySignature(rawBody, request.headers.get('calendly-webhook-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }

  const invitee = parseCalendlyInvitee(body);
  if (!invitee || !isAssessmentEvent(invitee)) return NextResponse.json({ ok: true, ignored: true });
  const organizationId = calendlyOrganizationId();
  if (!organizationId) return NextResponse.json({ error: 'Calendly organization is not configured.' }, { status: 500 });

  try {
    if (invitee.event === 'invitee.created') {
      const result = await upsertExternalAssessment({
        organizationId, source: 'calendly', externalId: invitee.inviteeUri, startsAt: invitee.startsAt, endsAt: invitee.endsAt,
        name: invitee.name, email: invitee.email, phone: invitee.phone, location: invitee.location,
      });
      after(async () => {
        await syncGoogleCalendarForTimes(organizationId, [invitee.startsAt]);
        if (result.created) await notifyAdmins('Assessment booked', `${invitee.name || invitee.email} · ${formatWhen(invitee.startsAt)}`).catch(() => {});
      });
      return NextResponse.json({ ok: true, bookingId: result.bookingId, created: result.created });
    }
    const cancelled = await cancelExternalAssessment({ organizationId, source: 'calendly', externalId: invitee.inviteeUri });
    after(async () => {
      await syncGoogleCalendarForTimes(organizationId, [invitee.startsAt]);
      if (cancelled) await notifyAdmins('Assessment cancelled', `${invitee.name || invitee.email} · ${formatWhen(invitee.startsAt)}`).catch(() => {});
    });
    return NextResponse.json({ ok: true, cancelled: Boolean(cancelled) });
  } catch (error) {
    // A non-2xx response makes Calendly retry delivery.
    console.error('[calendly-webhook] failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to record booking.' }, { status: 500 });
  }
}

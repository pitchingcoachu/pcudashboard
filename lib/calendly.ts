import { createHmac, timingSafeEqual } from 'node:crypto';

// Calendly signs each webhook as `Calendly-Webhook-Signature: t=<unix seconds>,v1=<hex hmac>`, where the
// HMAC-SHA256 (keyed with the subscription's signing key) covers `${t}.${rawBody}`.
const SIGNATURE_TOLERANCE_SECONDS = 180;

export function verifyCalendlySignature(rawBody: string, header: string | null): boolean {
  const signingKey = String(process.env.CALENDLY_WEBHOOK_SIGNING_KEY ?? '').trim();
  if (!signingKey || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=', 2).map((value) => value.trim())));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', signingKey).update(`${parts.t}.${rawBody}`).digest();
  const given = Buffer.from(String(parts.v1 ?? ''), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type CalendlyInvitee = {
  event: 'invitee.created' | 'invitee.canceled';
  inviteeUri: string; name: string; email: string; phone: string;
  eventTypeUri: string; eventName: string; startsAt: string; endsAt: string; location: string;
};

type CalendlyPayload = {
  event?: string;
  payload?: {
    uri?: string; name?: string; email?: string; text_reminder_number?: string | null;
    questions_and_answers?: Array<{ question?: string; answer?: string }>;
    scheduled_event?: { name?: string; event_type?: string; start_time?: string; end_time?: string; location?: { location?: string; type?: string } | null };
  };
};

export function parseCalendlyInvitee(body: unknown): CalendlyInvitee | null {
  const data = body as CalendlyPayload;
  if (data?.event !== 'invitee.created' && data?.event !== 'invitee.canceled') return null;
  const invitee = data.payload;
  const scheduled = invitee?.scheduled_event;
  if (!invitee?.uri || !scheduled?.start_time || !scheduled.end_time) return null;
  const phoneAnswer = (invitee.questions_and_answers ?? []).find((item) => /phone|cell|mobile/i.test(item.question ?? ''))?.answer;
  return {
    event: data.event, inviteeUri: invitee.uri, name: String(invitee.name ?? '').trim(), email: String(invitee.email ?? '').trim(),
    phone: String(invitee.text_reminder_number || phoneAnswer || '').trim(),
    eventTypeUri: String(scheduled.event_type ?? ''), eventName: String(scheduled.name ?? ''),
    startsAt: new Date(scheduled.start_time).toISOString(), endsAt: new Date(scheduled.end_time).toISOString(),
    location: String(scheduled.location?.location ?? ''),
  };
}

/**
 * Only the assessment event type should land on the schedule (your other Calendly events, like the
 * Pearl call, are ignored). Set CALENDLY_ASSESSMENT_EVENT_TYPES to the event type URI(s); without it,
 * any event whose name contains "assessment" is accepted.
 */
export function isAssessmentEvent(invitee: CalendlyInvitee): boolean {
  const configured = String(process.env.CALENDLY_ASSESSMENT_EVENT_TYPES ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (configured.length) return configured.includes(invitee.eventTypeUri);
  return /assessment/i.test(invitee.eventName);
}

/** The organization Calendly bookings belong to: CALENDLY_ORGANIZATION_ID, else the org mapped to PCU. */
export function calendlyOrganizationId(): number {
  const explicit = Number(process.env.CALENDLY_ORGANIZATION_ID ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  try {
    const map = JSON.parse(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}') as Record<string, unknown>;
    const match = Object.entries(map).find(([, school]) => String(school).trim().toUpperCase() === 'PCU');
    return match ? Number(match[0]) : 0;
  } catch { return 0; }
}

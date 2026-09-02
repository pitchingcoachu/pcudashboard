import { NextResponse } from 'next/server';
import {
  getTrackmanValidationCode,
  isTrackmanWebhookAuthorized,
  storeTrackmanSession,
  unwrapTrackmanEvents,
} from '../../../../../lib/trackman-live-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isTrackmanWebhookAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const events = unwrapTrackmanEvents(body);
  const validationCode = getTrackmanValidationCode(events);
  if (validationCode) return NextResponse.json({ validationResponse: validationCode });

  let accepted = 0;
  for (const event of events) {
    if (await storeTrackmanSession(event.data, event.eventTime)) accepted += 1;
  }
  return NextResponse.json({ ok: true, accepted });
}

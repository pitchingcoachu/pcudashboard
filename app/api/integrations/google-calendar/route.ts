import { NextResponse } from 'next/server';
import { disconnectGoogleCalendar, getGoogleCalendarStatus, syncGoogleCalendarRange } from '../../../../lib/google-calendar';
import { googleCalendarAdminAccess } from '../../../../lib/google-calendar-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: Request) {
  const auth = await googleCalendarAdminAccess(request); if ('error' in auth) return auth.error;
  return NextResponse.json(await getGoogleCalendarStatus(auth.organizationId));
}

/** "Sync now": reconciles yesterday through the 60-day booking window. */
export async function POST(request: Request) {
  const auth = await googleCalendarAdminAccess(request); if ('error' in auth) return auth.error;
  try {
    const from = new Date(Date.now() - 86_400_000), to = new Date(Date.now() + 61 * 86_400_000);
    const result = await syncGoogleCalendarRange(auth.organizationId, from, to);
    if (!result) return NextResponse.json({ error: 'Google Calendar is not connected.' }, { status: 400 });
    return NextResponse.json({ ok: true, ...result, status: await getGoogleCalendarStatus(auth.organizationId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sync failed.' }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const auth = await googleCalendarAdminAccess(request); if ('error' in auth) return auth.error;
  await disconnectGoogleCalendar(auth.organizationId);
  return NextResponse.json({ ok: true });
}

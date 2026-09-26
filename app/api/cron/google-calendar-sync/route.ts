import { NextResponse } from 'next/server';
import { listGoogleCalendarOrganizations, syncGoogleCalendarRange } from '../../../../lib/google-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Bookings sync to Google right after each change; this sweep catches anything a failed or
// interrupted sync missed. Vercel Cron authenticates with `Authorization: Bearer <CRON_SECRET>`.
function isAuthorized(request: Request): boolean {
  const cronSecret = String(process.env.CRON_SECRET ?? '').trim();
  const auth = String(request.headers.get('authorization') ?? '').trim();
  return Boolean(cronSecret) && auth === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const from = new Date(Date.now() - 86_400_000), to = new Date(Date.now() + 61 * 86_400_000);
  const results: Array<{ organizationId: number; upserted?: number; deleted?: number; error?: string }> = [];
  for (const organizationId of await listGoogleCalendarOrganizations()) {
    try {
      const result = await syncGoogleCalendarRange(organizationId, from, to);
      results.push({ organizationId, upserted: result?.upserted ?? 0, deleted: result?.deleted ?? 0 });
    } catch (error) {
      results.push({ organizationId, error: error instanceof Error ? error.message : 'Sync failed.' });
    }
  }
  return NextResponse.json({ ok: true, results });
}

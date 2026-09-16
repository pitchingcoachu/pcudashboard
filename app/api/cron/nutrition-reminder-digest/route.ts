import { NextResponse } from 'next/server';
import { sendNutritionReminderDigest } from '../../../../lib/training-db';

// Vercel's own Cron dispatcher calls this route with `Authorization: Bearer
// <CRON_SECRET>` -- same dual-secret acceptance as daily-player-notes so a
// manual/external trigger (x-cron-key) also works for testing.
function isAuthorized(request: Request): boolean {
  const configuredKey = String(process.env.NUTRITION_REMINDER_CRON_KEY ?? '').trim();
  const cronSecret = String(process.env.CRON_SECRET ?? '').trim();
  if (!configuredKey && !cronSecret) return false;
  const headerKey = String(request.headers.get('x-cron-key') ?? '').trim();
  if (configuredKey && headerKey && headerKey === configuredKey) return true;
  const auth = String(request.headers.get('authorization') ?? '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (configuredKey && token && token === configuredKey) return true;
    if (cronSecret && token && token === cronSecret) return true;
  }
  return false;
}

// Arizona/Phoenix does not observe DST, so "8pm Phoenix" is a fixed UTC
// offset (03:00 UTC) -- vercel.json schedules this route directly at that
// UTC time rather than firing hourly with a timezone check like the
// Eastern-time daily digest needs to handle EST/EDT.
export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await sendNutritionReminderDigest();
  return NextResponse.json({ ok: true, notified: result.notified });
}

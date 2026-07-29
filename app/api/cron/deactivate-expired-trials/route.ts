import { NextResponse } from 'next/server';
import { deactivateExpiredDashboardTrialAccounts } from '../../../../lib/training-db';

// Vercel's own Cron dispatcher (as opposed to a manual/external curl) calls
// this route with `Authorization: Bearer <CRON_SECRET>`, using the reserved
// CRON_SECRET env var -- it does not send x-cron-key or a bearer token
// matching TRIAL_ACCOUNT_CRON_KEY/FORCE_PLATE_SYNC_CRON_KEY. Without also
// accepting CRON_SECRET, every real Vercel Cron invocation 401s and the
// route silently never runs.
function isAuthorized(request: Request): boolean {
  const configuredKey = String(process.env.TRIAL_ACCOUNT_CRON_KEY ?? process.env.FORCE_PLATE_SYNC_CRON_KEY ?? '').trim();
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

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await deactivateExpiredDashboardTrialAccounts();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, deactivatedCount: result.deactivatedCount });
}

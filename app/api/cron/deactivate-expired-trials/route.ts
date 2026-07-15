import { NextResponse } from 'next/server';
import { deactivateExpiredDashboardTrialAccounts } from '../../../../lib/training-db';

function isAuthorized(request: Request): boolean {
  const configured = String(process.env.TRIAL_ACCOUNT_CRON_KEY ?? process.env.FORCE_PLATE_SYNC_CRON_KEY ?? '').trim();
  if (!configured) return false;
  const headerKey = String(request.headers.get('x-cron-key') ?? '').trim();
  if (headerKey && headerKey === configured) return true;
  const auth = String(request.headers.get('authorization') ?? '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token && token === configured) return true;
  }
  return false;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await deactivateExpiredDashboardTrialAccounts();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, deactivatedCount: result.deactivatedCount });
}

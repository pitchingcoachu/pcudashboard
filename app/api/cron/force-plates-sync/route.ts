import { NextResponse } from 'next/server';
import { runForcePlateSync } from '../../../../lib/force-plate-sync-runner';

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function isAuthorized(request: Request): boolean {
  const configured = String(process.env.FORCE_PLATE_SYNC_CRON_KEY ?? '').trim();
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
  const url = new URL(request.url);
  const forceFullSync = String(url.searchParams.get('full') ?? '').trim() === '1';
  const orgId = parsePositiveInt(String(process.env.FORCE_PLATE_SYNC_ORGANIZATION_ID ?? ''));
  const schoolCode = String(process.env.FORCE_PLATE_SYNC_SCHOOL_CODE ?? 'PCU').trim().toUpperCase();
  if (!orgId) return NextResponse.json({ error: 'FORCE_PLATE_SYNC_ORGANIZATION_ID missing.' }, { status: 400 });
  const synced = await runForcePlateSync({
    organizationId: orgId,
    schoolCode,
    assignedCoachUserId: null,
    forceFullSync,
  });
  if (!synced.ok) return NextResponse.json({ error: synced.error }, { status: 500 });
  return NextResponse.json({
    ok: true,
    playerCount: synced.playerCount,
    fetchedAt: synced.fetchedAt,
    lookbackDaysUsed: synced.lookbackDaysUsed,
    forceFullSync: synced.forceFullSync,
  });
}

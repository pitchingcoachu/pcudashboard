import { after, NextResponse } from 'next/server';
import { runForcePlateSync } from '../../../../lib/force-plate-sync-runner';

export const maxDuration = 300;
const ROUTE_VERSION = 'force-plate-sync-async-2026-06-11';

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
  const asyncMode = String(url.searchParams.get('async') ?? '').trim() === '1';
  const maxRunSeconds = parsePositiveInt(String(url.searchParams.get('maxRunSeconds') ?? ''));
  const playerBatchSize = parsePositiveInt(String(url.searchParams.get('playerBatchSize') ?? ''));
  const trialFetchLimit = parsePositiveInt(String(url.searchParams.get('trialFetchLimit') ?? ''));
  const lookbackDays = parsePositiveInt(String(url.searchParams.get('lookbackDays') ?? ''));
  const recentTestLimit = parsePositiveInt(String(url.searchParams.get('recentTestLimit') ?? ''));
  const testsWindowDays = parsePositiveInt(String(url.searchParams.get('testsWindowDays') ?? ''));
  const requestTimeoutMs = parsePositiveInt(String(url.searchParams.get('requestTimeoutMs') ?? ''));
  const requestMaxAttempts = parsePositiveInt(String(url.searchParams.get('requestMaxAttempts') ?? ''));
  const orgId = parsePositiveInt(String(process.env.FORCE_PLATE_SYNC_ORGANIZATION_ID ?? ''));
  const schoolCode = String(process.env.FORCE_PLATE_SYNC_SCHOOL_CODE ?? 'PCU').trim().toUpperCase();
  if (String(url.searchParams.get('ping') ?? '').trim() === '1') {
    return NextResponse.json({ ok: true, routeVersion: ROUTE_VERSION, asyncSupported: true });
  }
  if (!orgId) return NextResponse.json({ error: 'FORCE_PLATE_SYNC_ORGANIZATION_ID missing.' }, { status: 400 });
  const runWithOverrides = async () => {
    const previousValdRequestTimeoutMs = process.env.VALD_REQUEST_TIMEOUT_MS;
    const previousValdRequestMaxAttempts = process.env.VALD_REQUEST_MAX_ATTEMPTS;
    if (requestTimeoutMs > 0) process.env.VALD_REQUEST_TIMEOUT_MS = String(requestTimeoutMs);
    if (requestMaxAttempts > 0) process.env.VALD_REQUEST_MAX_ATTEMPTS = String(requestMaxAttempts);
    try {
      return await runForcePlateSync({
        organizationId: orgId,
        schoolCode,
        assignedCoachUserId: null,
        forceFullSync,
        maxRunSecondsOverride: maxRunSeconds || null,
        playerBatchSizeOverride: playerBatchSize || null,
        trialFetchLimitOverride: trialFetchLimit || null,
        lookbackDaysOverride: lookbackDays || null,
        recentTestLimitOverride: recentTestLimit || null,
        testsWindowDaysOverride: testsWindowDays || null,
      });
    } finally {
      if (previousValdRequestTimeoutMs === undefined) delete process.env.VALD_REQUEST_TIMEOUT_MS;
      else process.env.VALD_REQUEST_TIMEOUT_MS = previousValdRequestTimeoutMs;
      if (previousValdRequestMaxAttempts === undefined) delete process.env.VALD_REQUEST_MAX_ATTEMPTS;
      else process.env.VALD_REQUEST_MAX_ATTEMPTS = previousValdRequestMaxAttempts;
    }
  };

  if (asyncMode) {
    after(async () => {
      const synced = await runWithOverrides();
      if (!synced.ok) {
        console.error('[force-plate-sync] async cron failed', { error: synced.error });
      }
    });
    return NextResponse.json(
      {
        ok: true,
        accepted: true,
        routeVersion: ROUTE_VERSION,
        forceFullSync,
        maxRunSeconds: maxRunSeconds || null,
        playerBatchSize: playerBatchSize || null,
        lookbackDays: lookbackDays || null,
      },
      { status: 202 }
    );
  }

  const synced = await runWithOverrides();
  if (!synced.ok) return NextResponse.json({ error: synced.error }, { status: 500 });
  return NextResponse.json({
    ok: true,
    routeVersion: ROUTE_VERSION,
    playerCount: synced.playerCount,
    testCount: synced.testCount,
    metricRowCount: synced.metricRowCount,
    fetchedAt: synced.fetchedAt,
    lookbackDaysUsed: synced.lookbackDaysUsed,
    forceFullSync: synced.forceFullSync,
  });
}

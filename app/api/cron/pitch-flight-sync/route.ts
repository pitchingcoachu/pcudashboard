import { NextResponse } from 'next/server';
import { syncPitchFlightBackfill } from '../../../../lib/pitch-flight-sync';

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const cronSecret = String(process.env.CRON_SECRET ?? '').trim();
  const configuredKey = String(process.env.PITCH_FLIGHT_SYNC_CRON_KEY ?? '').trim();
  if (!cronSecret && !configuredKey) return false;
  const headerKey = String(request.headers.get('x-cron-key') ?? '').trim();
  const authorization = String(request.headers.get('authorization') ?? '').trim();
  const bearer = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
  return Boolean((cronSecret && bearer === cronSecret) || (configuredKey && (headerKey === configuredKey || bearer === configuredKey)));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await syncPitchFlightBackfill({ incremental: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Pitch-flight sync failed.' },
      { status: 500 }
    );
  }
}

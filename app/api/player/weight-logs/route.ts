import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import {
  getPlayerByIdInOrganization,
  getPlayerForUser,
  listBodyWeightLogsForPlayer,
  upsertBodyWeightLog,
} from '../../../../lib/training-db';

async function ensurePlayerAccess(session: { role?: string; organizationId?: number; userId?: number; playerId?: number | null } | null, playerId: number) {
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if (session.role === 'player') {
    const ownPlayer = await getPlayerForUser({
      organizationId: session.organizationId ?? 0,
      userId: session.userId ?? 0,
    });
    const allowed = ownPlayer?.id ?? session.playerId ?? 0;
    if (allowed !== playerId) return { ok: false as const, status: 403, error: 'Forbidden' };
    return { ok: true as const, playerId: allowed };
  }

  const player = await getPlayerByIdInOrganization({
    organizationId: session.organizationId ?? 0,
    playerId,
  });
  if (!player) return { ok: false as const, status: 404, error: 'Player not found.' };
  return { ok: true as const, playerId: player.id };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await ensurePlayerAccess(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const logs = await listBodyWeightLogsForPlayer({ playerId: allowed.playerId, limit: 365 });
  return NextResponse.json({ logs });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? 0);
  const logDate = String(body.logDate ?? '');
  const weightLbs = Number(body.weightLbs ?? 0);

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await ensurePlayerAccess(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const result = await upsertBodyWeightLog({
    playerId: allowed.playerId,
    loggedByUserId: session.userId ?? 0,
    logDate,
    weightLbs,
    notes: String(body.notes ?? ''),
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const logs = await listBodyWeightLogsForPlayer({ playerId: allowed.playerId, limit: 365 });
  return NextResponse.json({ ok: true, logs });
}

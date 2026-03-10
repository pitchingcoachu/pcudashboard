import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { listExerciseTrendForPlayer } from '../../../../lib/training-db';
import { canManagePlayer } from '../../../../lib/portal-access';

async function ensurePlayerAccess(session: { role?: string; organizationId?: number; userId?: number; playerId?: number | null } | null, playerId: number) {
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return { ok: false as const, status: 403, error: 'Forbidden' };
  return { ok: true as const, playerId };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const exerciseId = Number(url.searchParams.get('exerciseId') ?? '0');

  if (!Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(exerciseId) || exerciseId <= 0) {
    return NextResponse.json({ error: 'Valid playerId and exerciseId are required.' }, { status: 400 });
  }

  const allowed = await ensurePlayerAccess(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const trend = await listExerciseTrendForPlayer({
    playerId: allowed.playerId,
    exerciseId,
  });

  return NextResponse.json({ trend });
}

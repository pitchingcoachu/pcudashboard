import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { listExerciseLoadHistoryForPlayer } from '../../../../lib/training-db';
import { canManagePlayer } from '../../../../lib/portal-access';

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const beforeDate = parseDate(url.searchParams.get('beforeDate') ?? '') ?? undefined;
  const exerciseIds = String(url.searchParams.get('exerciseIds') ?? '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!Number.isFinite(playerId) || playerId <= 0 || exerciseIds.length === 0) {
    return NextResponse.json({ error: 'playerId and exerciseIds are required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const history = await listExerciseLoadHistoryForPlayer({
    playerId,
    exerciseIds,
    beforeDate,
    perExerciseLimit: 500,
  });

  return NextResponse.json({ history });
}

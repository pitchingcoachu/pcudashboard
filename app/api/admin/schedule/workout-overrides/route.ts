import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { canManagePlayer } from '../../../../../lib/portal-access';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { listProgramItemsForPlayerByDateRange, saveProgramWorkoutExerciseOverrides } from '../../../../../lib/training-db';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | {
        playerId?: number;
        itemId?: number;
        dayDate?: string;
        overrides?: Array<{
          workoutExerciseIndex?: number;
          exerciseId?: number | null;
          prescribedSets?: string | null;
          prescribedReps?: string | null;
          prescribedLoad?: string | null;
          notes?: string | null;
        }>;
      }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const organizationId = resolveProgrammingOrganizationId(session);
  const playerId = Number(body.playerId ?? 0);
  const itemId = Number(body.itemId ?? 0);
  const dayDate = String(body.dayDate ?? '').trim();
  if (organizationId <= 0 || !Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(itemId) || itemId <= 0) {
    return NextResponse.json({ error: 'playerId and itemId are required.' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
    return NextResponse.json({ error: 'dayDate is required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await saveProgramWorkoutExerciseOverrides({
    organizationId,
    playerId,
    programDayItemId: itemId,
    userId: session.userId ?? null,
    overrides: Array.isArray(body.overrides)
      ? body.overrides.map((override) => ({
          workoutExerciseIndex: Number(override.workoutExerciseIndex ?? -1),
          exerciseId: override.exerciseId ?? null,
          prescribedSets: override.prescribedSets ?? null,
          prescribedReps: override.prescribedReps ?? null,
          prescribedLoad: override.prescribedLoad ?? null,
          notes: override.notes ?? null,
        }))
      : [],
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const nextDay = new Date(`${dayDate}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const endDate = nextDay.toISOString().slice(0, 10);
  const items = await listProgramItemsForPlayerByDateRange({ playerId, startDate: dayDate, endDate });
  const item = items.find((row) => row.itemId === itemId) ?? null;
  return NextResponse.json({ ok: true, item });
}

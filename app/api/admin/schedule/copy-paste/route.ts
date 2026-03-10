import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { getPlayerByIdInOrganization, replaceProgramItemsForDates } from '../../../../../lib/training-db';

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

type CopyItemInput = {
  assignmentType?: 'exercise' | 'workout';
  exerciseId?: number;
  workoutId?: number;
  prescribedSets?: string;
  prescribedReps?: string;
  prescribedLoad?: string;
  prescribedNotes?: string;
};

type DayPlanInput = {
  dayDate?: string;
  items?: CopyItemInput[];
};

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.role ?? 'admin') !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; programName?: string; dayPlans?: DayPlanInput[] }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const playerId = Number(body.playerId ?? 0);
  const organizationId = session.organizationId ?? 0;
  const userId = session.userId ?? 0;
  if (organizationId <= 0 || userId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'playerId is required.' }, { status: 400 });
  }

  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const dayPlans = (body.dayPlans ?? [])
    .map((day) => ({
      dayDate: parseDate(String(day.dayDate ?? '')),
      items: (day.items ?? []).map((item) => ({
        assignmentType: item.assignmentType === 'exercise' ? 'exercise' : 'workout',
        exerciseId: Number(item.exerciseId ?? 0),
        workoutId: Number(item.workoutId ?? 0),
        prescribedSets: String(item.prescribedSets ?? ''),
        prescribedReps: String(item.prescribedReps ?? ''),
        prescribedLoad: String(item.prescribedLoad ?? ''),
        prescribedNotes: String(item.prescribedNotes ?? ''),
      })),
    }))
    .filter((day) => Boolean(day.dayDate)) as Array<{
      dayDate: string;
      items: Array<{
        assignmentType: 'exercise' | 'workout';
        exerciseId?: number;
        workoutId?: number;
        prescribedSets?: string;
        prescribedReps?: string;
        prescribedLoad?: string;
        prescribedNotes?: string;
      }>;
    }>;

  if (dayPlans.length === 0) {
    return NextResponse.json({ error: 'No day plans to paste.' }, { status: 400 });
  }

  const result = await replaceProgramItemsForDates({
    organizationId,
    userId,
    playerId,
    programName: String(body.programName ?? 'Current Program'),
    dayPlans,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

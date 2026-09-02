import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import {
  DEFAULT_THROWING_FIELDS,
  getMasterCalendarTitle,
  getScheduleThrowingState,
  getThrowingFieldSchema,
  listPlayerChoicesByOrganization,
  listProgramItemsForPlayerByDateRange,
} from '../../../../../lib/training-db';
import { logApiTiming } from '../../../../../lib/request-timing';

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.master-calendar.day.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const url = new URL(request.url);
  const date = url.searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return finish(400, { error: 'date is required and must be YYYY-MM-DD.' });
  }

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return finish(400, { error: 'Session context missing. Please log out and log in again.' });
  }

  const nextDay = addDays(date, 1);

  const [players, fieldSchema, title] = await Promise.all([
    listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null, activeOnly: true }).catch(() => []),
    getThrowingFieldSchema({ organizationId }).catch(() => DEFAULT_THROWING_FIELDS),
    getMasterCalendarTitle({ organizationId }).catch(() => 'Master Calendar'),
  ]);

  const playerRows = await Promise.all(
    players.map(async (player) => {
      const [throwingState, items] = await Promise.all([
        getScheduleThrowingState({ organizationId, playerId: player.playerId }).catch(
          () => ({ byDate: {}, weekNotes: {}, templates: [] }) as Awaited<ReturnType<typeof getScheduleThrowingState>>
        ),
        listProgramItemsForPlayerByDateRange({ playerId: player.playerId, startDate: date, endDate: nextDay }).catch(() => []),
      ]);
      const dayEntry = (throwingState.byDate?.[date] ?? {}) as Record<string, unknown>;
      const throwing: Record<string, string> = {};
      for (const field of fieldSchema) throwing[field.key] = String(dayEntry[field.key] ?? '');
      const workoutNames = items
        .filter((row) => row.dayDate === date && row.itemType === 'workout')
        .map((row) => row.itemName)
        .filter(Boolean);
      return {
        playerId: player.playerId,
        fullName: player.fullName,
        throwing,
        workoutNames,
      };
    })
  );

  return finish(200, { date, title, fieldSchema, players: playerRows }, { organizationId, date, playerCount: playerRows.length });
}

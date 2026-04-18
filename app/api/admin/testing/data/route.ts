import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { canManagePlayer } from '../../../../../lib/portal-access';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { logApiTiming } from '../../../../../lib/request-timing';
import {
  type ExerciseLoadHistoryEntry,
  getPlayerByIdInOrganization,
  listBodyWeightLogsForPlayer,
  listExerciseLoadHistoryForPlayer,
  listTrackedExercisesForPlayer,
} from '../../../../../lib/training-db';

type MetricOption = {
  key: string;
  label: string;
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight';
  group: 'Weight Progress' | 'Speed' | 'Jump Height' | 'Exercises';
};

type TrendPoint = {
  date: string;
  value: number;
};

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function classifyExercise(name: string, category: string): MetricOption['group'] {
  const value = `${name} ${category}`.toLowerCase();
  if (/jump|vertical|broad/.test(value)) return 'Jump Height';
  if (/speed|sprint|dash|yard|velo|velocity|mph/.test(value)) return 'Speed';
  if (/bench|squat|deadlift|trap bar|weight|press/.test(value)) return 'Weight Progress';
  return 'Exercises';
}

function numericAverage(values: string[]): number | null {
  const nums = values
    .map((value) => Number(String(value ?? '').replace(/[^\d.-]/g, '')))
    .filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function withinRange(day: string, startDate: string, endDate: string): boolean {
  if (startDate && day < startDate) return false;
  if (endDate && day > endDate) return false;
  return true;
}

export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.testing.data.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const organizationId = resolveProgrammingOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return finish(200, { metrics: [], seriesByKey: {} });
  }

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const startDateRaw = String(url.searchParams.get('startDate') ?? '').trim();
  const endDateRaw = String(url.searchParams.get('endDate') ?? '').trim();
  const startDate = isIsoDate(startDateRaw) ? startDateRaw : '';
  const endDate = isIsoDate(endDateRaw) ? endDateRaw : '';
  const metricKeys = String(url.searchParams.get('metricKeys') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return finish(400, { error: 'Valid playerId is required.' });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return finish(404, { error: 'Player not found.' });
  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return finish(404, { error: 'Player not found.' });

  const tracked = await listTrackedExercisesForPlayer({ playerId });
  const exerciseMetrics: MetricOption[] = tracked.map((exercise) => ({
      key: `exercise:${exercise.exerciseId}`,
      label: `${exercise.name} (${exercise.trackingType})`,
      trackingType: exercise.trackingType,
      group: classifyExercise(exercise.name, exercise.category),
    }));
  const baseMetric: MetricOption = { key: 'body_weight', label: 'Body Weight (lbs)', trackingType: 'lbs', group: 'Weight Progress' };
  const metrics: MetricOption[] = [baseMetric, ...exerciseMetrics].sort((a, b) => {
    if (a.key === 'body_weight') return -1;
    if (b.key === 'body_weight') return 1;
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    return a.label.localeCompare(b.label);
  });

  const requestedExerciseIds = Array.from(
    new Set(
      metricKeys
        .filter((key) => key.startsWith('exercise:'))
        .map((key) => Number(key.slice('exercise:'.length)))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );

  const [weightLogs, exerciseHistory] = await Promise.all([
    metricKeys.includes('body_weight') ? listBodyWeightLogsForPlayer({ playerId, limit: 500 }) : Promise.resolve([]),
    requestedExerciseIds.length
      ? listExerciseLoadHistoryForPlayer({ playerId, exerciseIds: requestedExerciseIds, perExerciseLimit: 300 })
      : Promise.resolve({} as Record<number, ExerciseLoadHistoryEntry[]>),
  ]);

  const seriesByKey: Record<string, TrendPoint[]> = {};

  if (metricKeys.includes('body_weight')) {
    seriesByKey.body_weight = weightLogs
      .filter((row) => withinRange(row.logDate, startDate, endDate))
      .map((row) => ({ date: row.logDate, value: Number(row.weightLbs) }))
      .filter((row) => Number.isFinite(row.value))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  for (const exerciseId of requestedExerciseIds) {
    const rows = exerciseHistory[exerciseId] ?? [];
    const byDate = new Map<string, number[]>();
    for (const row of rows) {
      if (!withinRange(row.dayDate, startDate, endDate)) continue;
      const avg = numericAverage(row.loads);
      if (avg === null) continue;
      const cur = byDate.get(row.dayDate) ?? [];
      cur.push(avg);
      byDate.set(row.dayDate, cur);
    }
    const points = Array.from(byDate.entries())
      .map(([date, values]) => ({
        date,
        value: values.reduce((sum, value) => sum + value, 0) / values.length,
      }))
      .filter((row) => Number.isFinite(row.value))
      .sort((a, b) => a.date.localeCompare(b.date));
    seriesByKey[`exercise:${exerciseId}`] = points;
  }

  return finish(
    200,
    {
      playerName: player.fullName,
      metrics,
      seriesByKey,
    },
    {
      playerId,
      metricKeysCount: metricKeys.length,
      seriesCount: Object.keys(seriesByKey).length,
    }
  );
}

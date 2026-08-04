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
import { fetchValdForceDecksSnapshot } from '../../../../../lib/vald-forceplates';

type MetricOption = {
  key: string;
  label: string;
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight' | 'velocity' | 'force_plate';
  group: 'Weight Progress' | 'Speed' | 'Jump Height' | 'Exercises' | 'Force Plate';
};

type TrendPoint = {
  date: string;
  value: number;
};
type MetricRequest = {
  panelIndex: number;
  metricKey: string;
  forcePlateTestType?: string;
  forcePlatePointType?: 'average' | 'rep';
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

function toIsoDay(value: string): string {
  const parsed = new Date(String(value ?? '').trim());
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
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

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return finish(200, { metrics: [], seriesByKey: {} });
  }

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const startDateRaw = String(url.searchParams.get('startDate') ?? '').trim();
  const endDateRaw = String(url.searchParams.get('endDate') ?? '').trim();
  const startDate = isIsoDate(startDateRaw) ? startDateRaw : '';
  const endDate = isIsoDate(endDateRaw) ? endDateRaw : '';
  const metricRequestsRaw = String(url.searchParams.get('metricRequests') ?? '').trim();
  const metricRequests = (() => {
    if (!metricRequestsRaw) return [] as MetricRequest[];
    try {
      const parsed = JSON.parse(metricRequestsRaw) as MetricRequest[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [] as MetricRequest[];
    }
  })();
  const metricKeys = Array.from(new Set(metricRequests.map((request) => String(request.metricKey ?? '').trim()).filter(Boolean)));

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return finish(400, { error: 'Valid playerId is required.' });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return finish(404, { error: 'Player not found.' });
  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return finish(404, { error: 'Player not found.' });

  const [tracked, valdSnapshot] = await Promise.all([
    listTrackedExercisesForPlayer({ playerId }),
    fetchValdForceDecksSnapshot([player.fullName]).catch(() => null),
  ]);
  const valdPlayer = valdSnapshot?.players?.[0] ?? null;
  const exerciseMetrics: MetricOption[] = tracked.map((exercise) => ({
      key: `exercise:${exercise.exerciseId}`,
      label: `${exercise.name} (${exercise.trackingType})`,
      trackingType: exercise.trackingType,
      group: classifyExercise(exercise.name, exercise.category),
    }));
  const forcePlateMetrics: MetricOption[] = (() => {
    if (!valdPlayer) return [];
    const seen = new Set<string>();
    const options: MetricOption[] = [];
    for (const row of valdPlayer.metricRows ?? []) {
      const metricName = String(row.metricName ?? '').trim();
      if (!metricName) continue;
      const metricUnit = String(row.metricUnit ?? '').trim();
      const key = `force_plate:${metricName}__${metricUnit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const testType = String(row.testType ?? '').trim();
      options.push({
        key,
        label: `${metricName}${metricUnit ? ` (${metricUnit})` : ''}`,
        trackingType: 'force_plate',
        group: 'Force Plate',
      });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  })();
  const baseMetric: MetricOption = { key: 'body_weight', label: 'Body Weight (lbs)', trackingType: 'lbs', group: 'Weight Progress' };
  const metrics: MetricOption[] = [baseMetric, ...exerciseMetrics, ...forcePlateMetrics].sort((a, b) => {
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
  const requestedForcePlateMetrics = metricKeys
    .filter((key) => key.startsWith('force_plate:'))
    .map((key) => key.slice('force_plate:'.length))
    .map((value) => {
      const [metricName, metricUnit = ''] = value.split('__');
      return { metricName: String(metricName ?? '').trim(), metricUnit: String(metricUnit ?? '').trim(), key: value };
    })
    .filter((value) => value.metricName);

  const [weightLogs, exerciseHistory] = await Promise.all([
    metricKeys.includes('body_weight') ? listBodyWeightLogsForPlayer({ playerId, limit: 500 }) : Promise.resolve([]),
    requestedExerciseIds.length
      ? listExerciseLoadHistoryForPlayer({ playerId, exerciseIds: requestedExerciseIds, perExerciseLimit: 300 })
      : Promise.resolve({} as Record<number, ExerciseLoadHistoryEntry[]>),
  ]);

  const seriesByKey: Record<string, TrendPoint[]> = {};
  const availableForcePlateTestTypes = Array.from(
    new Set((valdPlayer?.metricRows ?? []).map((row) => String(row.testType ?? '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  if (metricKeys.includes('body_weight')) {
    const byDate = new Map<string, number[]>();
    for (const row of weightLogs) {
      if (!withinRange(row.logDate, startDate, endDate)) continue;
      const value = Number(row.weightLbs);
      if (!Number.isFinite(value)) continue;
      const current = byDate.get(row.logDate) ?? [];
      current.push(value);
      byDate.set(row.logDate, current);
    }
    const forceWeightMaxByDate = new Map<string, number>();
    for (const row of valdPlayer?.metricRows ?? []) {
      const metricName = String(row.metricName ?? '').trim().toLowerCase();
      if (metricName !== 'bodyweight in pounds' && metricName !== 'body weight') continue;
      const dayDate = toIsoDay(String(row.dateTime ?? row.date ?? ''));
      if (!dayDate || !withinRange(dayDate, startDate, endDate)) continue;
      const value = Number(row.value);
      if (!Number.isFinite(value)) continue;
      const current = forceWeightMaxByDate.get(dayDate);
      if (!Number.isFinite(current ?? NaN) || value > Number(current)) {
        forceWeightMaxByDate.set(dayDate, value);
      }
    }
    for (const [dayDate, value] of forceWeightMaxByDate.entries()) {
      const current = byDate.get(dayDate) ?? [];
      current.push(value);
      byDate.set(dayDate, current);
    }
    seriesByKey.body_weight = Array.from(byDate.entries())
      .map(([date, values]) => ({
        date,
        value: values.reduce((sum, value) => sum + value, 0) / values.length,
      }))
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

  const forcePlateSeriesByMetricAndFilter: Record<string, TrendPoint[]> = {};
  if (requestedForcePlateMetrics.length && valdPlayer) {
    for (const metric of requestedForcePlateMetrics) {
      const matchingRequests = metricRequests.filter((request) => request.metricKey === `force_plate:${metric.key}`);
      const filterCombos = matchingRequests.length
        ? Array.from(
            new Set(
              matchingRequests.map((request) => `${request.forcePlateTestType || 'All'}__${request.forcePlatePointType || 'average'}`)
            )
          )
        : ['All__average'];
      for (const combo of filterCombos) {
        const [testTypeFilter, pointTypeFilter] = combo.split('__');
        const pointType = pointTypeFilter === 'rep' ? 'rep' : 'average';
      const byDate = new Map<string, number[]>();
      const repPoints: TrendPoint[] = [];
      for (const row of valdPlayer.metricRows ?? []) {
        const rowName = String(row.metricName ?? '').trim();
        const rowUnit = String(row.metricUnit ?? '').trim();
        const rowTestType = String(row.testType ?? '').trim();
        const rowPointType = String(row.pointType ?? 'average').trim();
        if (rowName !== metric.metricName || rowUnit !== metric.metricUnit) continue;
        if (testTypeFilter && testTypeFilter !== 'All' && rowTestType !== testTypeFilter) continue;
        if (rowPointType !== pointType) continue;
        const dayDate = toIsoDay(String(row.dateTime ?? row.date ?? ''));
        if (!dayDate || !withinRange(dayDate, startDate, endDate)) continue;
        const value = Number(row.value);
        if (!Number.isFinite(value)) continue;
        if (pointType === 'rep') {
          repPoints.push({ date: dayDate, value });
          continue;
        }
        const current = byDate.get(dayDate) ?? [];
        current.push(value);
        byDate.set(dayDate, current);
      }
      const points =
        pointType === 'rep'
          ? repPoints.sort((a, b) => a.date.localeCompare(b.date))
          : Array.from(byDate.entries())
              .map(([date, values]) => ({
                date,
                value: values.reduce((sum, value) => sum + value, 0) / values.length,
              }))
              .filter((row) => Number.isFinite(row.value))
              .sort((a, b) => a.date.localeCompare(b.date));
        forcePlateSeriesByMetricAndFilter[`force_plate:${metric.key}__${testTypeFilter || 'All'}__${pointType}`] = points;
      }
    }
  }

  for (const request of metricRequests) {
    const panelIndex = Number(request.panelIndex);
    if (!Number.isFinite(panelIndex) || panelIndex < 0) continue;
    const metricKey = String(request.metricKey ?? '').trim();
    if (!metricKey) continue;
    if (metricKey === 'body_weight') {
      seriesByKey[`panel:${panelIndex}`] = seriesByKey.body_weight ?? [];
      continue;
    }
    if (metricKey.startsWith('exercise:')) {
      seriesByKey[`panel:${panelIndex}`] = seriesByKey[metricKey] ?? [];
      continue;
    }
    if (metricKey.startsWith('force_plate:')) {
      const fpKey = `${metricKey}__${request.forcePlateTestType || 'All'}__${request.forcePlatePointType === 'rep' ? 'rep' : 'average'}`;
      seriesByKey[`panel:${panelIndex}`] = forcePlateSeriesByMetricAndFilter[fpKey] ?? [];
    }
  }

  return finish(
    200,
    {
      playerName: player.fullName,
      metrics,
      seriesByKey,
      availableForcePlateTestTypes,
    },
    {
      playerId,
      metricKeysCount: metricKeys.length,
      seriesCount: Object.keys(seriesByKey).length,
    }
  );
}

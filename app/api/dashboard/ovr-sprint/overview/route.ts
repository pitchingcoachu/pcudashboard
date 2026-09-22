import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { listOvrSprintResults, listOvrVbtResults, type OvrVbtResult } from '../../../../../lib/ovr-sprint';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import { getPlayerForUser, listPlayerChoicesByOrganization } from '../../../../../lib/training-db';

function normalizeName(value: string): string {
  const raw = String(value ?? '').trim();
  const firstLast = raw.includes(',')
    ? (() => {
        const [last, ...rest] = raw.split(',').map((part) => part.trim());
        return `${rest.join(' ')} ${last}`.trim();
      })()
    : raw;
  return firstLast.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function GET(request: Request) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session)) || resolveProgrammingSchoolCode(session) !== 'PCU') {
    return NextResponse.json({ error: 'OVR data is not available for this organization.' }, { status: 403 });
  }
  const organizationId = await resolveProgrammingOrganizationId(session);
  const roster = await listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null });
  let allowedNames = Array.from(new Set(roster.map((player) => String(player.fullName ?? '').trim()).filter(Boolean)));
  if (session.role === 'player') {
    const own = await getPlayerForUser({ organizationId, userId: session.userId ?? 0 });
    const ownNorm = normalizeName(own?.fullName ?? '');
    allowedNames = allowedNames.filter((name) => normalizeName(name) === ownNorm);
  }
  const allowedNorms = new Set(allowedNames.map(normalizeName));

  const url = new URL(request.url);
  const requestedPlayers = String(url.searchParams.get('player') ?? '')
    .split('|')
    .map((value) => value.trim())
    .filter((value) => value && value !== 'All');
  const requestedNorms = new Set(requestedPlayers.map(normalizeName));
  const requestedExercises = String(url.searchParams.get('exercises') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const source = url.searchParams.get('source') === 'vbt' ? 'vbt' : 'sprint';
  const requestedMetric = String(url.searchParams.get('metric') ?? '');
  const startDate = String(url.searchParams.get('start_date') ?? '').trim();
  const endDate = String(url.searchParams.get('end_date') ?? '').trim();

  if (source === 'vbt') {
    const metricOptions: Array<{ value: keyof OvrVbtResult; label: string; unit: string; decimals: number }> = [
      { value: 'loadLbs', label: 'Load', unit: 'lb', decimals: 1 },
      { value: 'targetMin', label: 'Target Minimum', unit: '', decimals: 2 },
      { value: 'targetMax', label: 'Target Maximum', unit: '', decimals: 2 },
      { value: 'avgVelocity', label: 'Average Velocity', unit: 'm/s', decimals: 3 },
      { value: 'peakVelocity', label: 'Peak Velocity', unit: 'm/s', decimals: 3 },
      { value: 'avgPower', label: 'Average Power', unit: 'W', decimals: 1 },
      { value: 'peakPower', label: 'Peak Power', unit: 'W', decimals: 1 },
      { value: 'romInches', label: 'Range of Motion', unit: 'in', decimals: 2 },
      { value: 'durationSeconds', label: 'Duration', unit: 's', decimals: 3 },
      { value: 'tpvSeconds', label: 'Time to Peak Velocity', unit: 's', decimals: 3 },
      { value: 'eaIndex', label: 'Eccentric Acceleration Index', unit: '', decimals: 3 },
    ];
    const selectedMetric = metricOptions.find((option) => option.value === requestedMetric) ?? metricOptions[1];
    const allResults = await listOvrVbtResults({ organizationId, schoolCode: 'PCU' });
    const exerciseOptions = Array.from(new Set(allResults.map((row) => row.exercise))).sort((a, b) => a.localeCompare(b));
    const exercises = requestedExercises.length ? requestedExercises : exerciseOptions.slice(0, 1);
    const rows = allResults.filter((row) => {
      if (!allowedNorms.has(normalizeName(row.athleteName))) return false;
      if (requestedNorms.size && !requestedNorms.has(normalizeName(row.athleteName))) return false;
      if (exercises.length && !exercises.includes(row.exercise)) return false;
      if (startDate && row.date < startDate) return false;
      if (endDate && row.date > endDate) return false;
      return true;
    });
    const tableColumns = ['Date', ...(requestedPlayers.length === 1 ? [] : ['Player']), 'Exercise', 'Set', 'Rep', 'Load (lb)', 'Target Type', 'Target Min', 'Target Max', 'Avg Velocity (m/s)', 'Peak Velocity (m/s)', 'Avg Power (W)', 'Peak Power (W)', 'ROM (in)', 'Duration (s)', 'TPV (s)', 'EA Index'];
    const rounded = (value: number | null, decimals: number) => value === null ? null : Number(value.toFixed(decimals));
    const tableRows = rows.map((row) => ({
      Date: row.date, Player: row.athleteName, Exercise: row.exercise, Set: row.setNumber, Rep: row.repNumber,
      'Load (lb)': rounded(row.loadLbs, 1), 'Target Type': row.targetType, 'Target Min': rounded(row.targetMin, 2), 'Target Max': rounded(row.targetMax, 2),
      'Avg Velocity (m/s)': rounded(row.avgVelocity, 3), 'Peak Velocity (m/s)': rounded(row.peakVelocity, 3),
      'Avg Power (W)': rounded(row.avgPower, 1), 'Peak Power (W)': rounded(row.peakPower, 1), 'ROM (in)': rounded(row.romInches, 2),
      'Duration (s)': rounded(row.durationSeconds, 3), 'TPV (s)': rounded(row.tpvSeconds, 3), 'EA Index': rounded(row.eaIndex, 3),
    }));
    const chartPoints = rows.flatMap((row) => {
      const value = row[selectedMetric.value];
      return typeof value === 'number' && Number.isFinite(value) ? [{ session_date: row.date, player: row.athleteName, exercise: row.exercise, metric: selectedMetric.value, value }] : [];
    });
    return NextResponse.json({
      source,
      selected_metric: selectedMetric.value,
      metric_label: selectedMetric.label,
      metric_unit: selectedMetric.unit,
      table_columns: tableColumns,
      table_rows: tableRows,
      chart_points: chartPoints,
      exercise_options: exerciseOptions.map((exercise) => ({ value: exercise, label: exercise })),
      metric_options: metricOptions.map(({ value, label, unit }) => ({ value, label: unit ? `${label} (${unit})` : label })),
    }, { headers: { 'cache-control': 'private, max-age=15, stale-while-revalidate=60' } });
  }

  const metric = requestedMetric === 'speedMph' ? 'speedMph' : 'totalTime';
  const allResults = await listOvrSprintResults({ organizationId, schoolCode: 'PCU' });
  const exerciseOptions = Array.from(new Set(allResults.map((row) => row.exercise))).sort((a, b) => a.localeCompare(b));
  const exercises = requestedExercises.length ? requestedExercises : exerciseOptions.slice(0, 1);

  const rows = allResults.filter((row) => {
    if (!allowedNorms.has(normalizeName(row.athleteName))) return false;
    if (requestedNorms.size && !requestedNorms.has(normalizeName(row.athleteName))) return false;
    if (exercises.length && !exercises.includes(row.exercise)) return false;
    if (startDate && row.date < startDate) return false;
    if (endDate && row.date > endDate) return false;
    const value = metric === 'speedMph' ? row.speedMph : row.totalTime;
    return value !== null && Number.isFinite(value);
  });

  const tableColumns = ['Date', ...(requestedPlayers.length === 1 ? [] : ['Player']), 'Exercise', 'Sprint #', 'Total Time (s)', 'Split #', 'Split Time (s)', 'Distance (yd)', 'Speed (mph)'];
  const grouped = new Map<string, Record<string, string | number | null>>();
  for (const row of rows) {
    const value = metric === 'speedMph' ? row.speedMph : row.totalTime;
    const key = `${row.date}${normalizeName(row.athleteName)}${row.exercise}${row.sprintNumber}${row.splitNumber}`;
    grouped.set(key, {
      Date: row.date,
      Player: row.athleteName,
      Exercise: row.exercise,
      'Sprint #': row.sprintNumber,
      'Total Time (s)': Number(row.totalTime.toFixed(3)),
      'Split #': row.splitNumber,
      'Split Time (s)': Number(row.splitTime.toFixed(3)),
      'Distance (yd)': row.distanceYards === null ? null : Number(row.distanceYards.toFixed(2)),
      'Speed (mph)': row.speedMph === null ? null : Number(row.speedMph.toFixed(3)),
    });
  }
  const chartPoints = rows.map((row) => ({
    session_date: row.date,
    player: row.athleteName,
    exercise: row.exercise,
    metric,
    value: metric === 'speedMph' ? row.speedMph : row.totalTime,
  }));

  return NextResponse.json({
    source,
    selected_metric: metric,
    metric_label: metric === 'speedMph' ? 'Speed' : 'Total Time',
    metric_unit: metric === 'speedMph' ? 'mph' : 's',
    table_columns: tableColumns,
    table_rows: Array.from(grouped.values()),
    chart_points: chartPoints,
    exercise_options: exerciseOptions.map((exercise) => ({ value: exercise, label: exercise })),
    metric_options: [
      { value: 'totalTime', label: 'Total Time (s)' },
      { value: 'speedMph', label: 'Speed (mph)' },
    ],
  }, { headers: { 'cache-control': 'private, max-age=15, stale-while-revalidate=60' } });
}

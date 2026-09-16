import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { listOvrSprintResults } from '../../../../../lib/ovr-sprint';
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
    return NextResponse.json({ error: 'OVR Sprint data is not available.' }, { status: 403 });
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
  const metric = url.searchParams.get('metric') === 'speedMph' ? 'speedMph' : 'totalTime';
  const startDate = String(url.searchParams.get('start_date') ?? '').trim();
  const endDate = String(url.searchParams.get('end_date') ?? '').trim();

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

  const tableColumns = ['Date', ...(requestedPlayers.length === 1 ? [] : ['Player']), 'Exercise', metric === 'speedMph' ? 'Speed (mph)' : 'Total Time (s)'];
  const grouped = new Map<string, Record<string, string | number | null>>();
  for (const row of rows) {
    const value = metric === 'speedMph' ? row.speedMph : row.totalTime;
    const key = `${row.date}${normalizeName(row.athleteName)}${row.exercise}${row.sprintNumber}`;
    grouped.set(key, {
      Date: row.date,
      Player: row.athleteName,
      Exercise: row.exercise,
      [metric === 'speedMph' ? 'Speed (mph)' : 'Total Time (s)']: value === null ? null : Number(value.toFixed(3)),
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
    table_columns: tableColumns,
    table_rows: Array.from(grouped.values()),
    chart_points: chartPoints,
    exercise_options: exerciseOptions.map((exercise) => ({ value: exercise, label: exercise })),
  }, { headers: { 'cache-control': 'private, max-age=15, stale-while-revalidate=60' } });
}

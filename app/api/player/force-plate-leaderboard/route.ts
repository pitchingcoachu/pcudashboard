import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { loadForcePlateLeaderboardAggregates } from '../../../../lib/force-plate-neon-db';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { getPlayerForUser, listPlayerChoicesByOrganization } from '../../../../lib/training-db';

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

function metricKey(name: string, unit: string): string {
  return `${name}__${unit}`;
}

function normalizeTestType(value: string): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function weightedAverage(rows: Array<{ averageValue: number; samples: number }>): number | null {
  const valid = rows.filter((row) => Number.isFinite(row.averageValue) && row.samples > 0);
  const samples = valid.reduce((sum, row) => sum + row.samples, 0);
  return samples ? valid.reduce((sum, row) => sum + row.averageValue * row.samples, 0) / samples : null;
}

function jumpStats(
  rows: Array<{ testType: string; metricName: string; metricUnit: string; averageValue: number; maximumValue: number; samples: number }>,
  matchesTest: (value: string) => boolean
): { average: number | null; max: number | null } {
  const candidates = rows.filter((row) => matchesTest(row.testType) && row.metricName.toLowerCase().includes('jump height'));
  const inches = candidates.filter((row) => row.metricUnit.toLowerCase().includes('inch'));
  const flightTime = candidates.filter((row) => row.metricName.toLowerCase().includes('flight time'));
  const selected = inches.length ? inches : flightTime.length ? flightTime : candidates;
  return {
    average: weightedAverage(selected),
    max: selected.length ? Math.max(...selected.map((row) => row.maximumValue)) : null,
  };
}

export async function GET(request: Request) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session)) || resolveProgrammingSchoolCode(session) !== 'PCU') {
    return NextResponse.json({ error: 'Force Plate Data is not available.' }, { status: 403 });
  }
  const organizationId = await resolveProgrammingOrganizationId(session);
  const roster = await listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null });
  let playerNames = Array.from(new Set(roster.map((player) => String(player.fullName ?? '').trim()).filter(Boolean)));
  if (session.role === 'player') {
    const own = await getPlayerForUser({ organizationId, userId: session.userId ?? 0 });
    const ownNorm = normalizeName(own?.fullName ?? '');
    playerNames = playerNames.filter((name) => normalizeName(name) === ownNorm);
  }

  const url = new URL(request.url);
  const startDate = String(url.searchParams.get('startDate') ?? '').trim();
  const endDate = String(url.searchParams.get('endDate') ?? '').trim();
  const selectedTestType = String(url.searchParams.get('testType') ?? 'All').trim() || 'All';
  const result = await loadForcePlateLeaderboardAggregates({
    organizationId,
    schoolCode: 'PCU',
    allowedPlayerNames: playerNames,
    startDate,
    endDate,
  });
  const testOptions = Array.from(new Set(result.rows.map((row) => row.testType).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const scopedRows = selectedTestType === 'All'
    ? result.rows
    : result.rows.filter((row) => row.testType === selectedTestType);
  const byPlayer = new Map<string, typeof result.rows>();
  for (const row of scopedRows) {
    const list = byPlayer.get(normalizeName(row.playerName)) ?? [];
    list.push(row);
    byPlayer.set(normalizeName(row.playerName), list);
  }
  const metricOptions = Array.from(
    new Map(scopedRows.map((row) => {
      const key = metricKey(row.metricName, row.metricUnit);
      return [key, { key: `metric:${key}`, label: `${row.metricName}${row.metricUnit ? ` (${row.metricUnit})` : ''}` }];
    })).values()
  ).sort((a, b) => a.label.localeCompare(b.label));

  const rows = playerNames.flatMap((playerName) => {
    const playerRows = byPlayer.get(normalizeName(playerName)) ?? [];
    if (!playerRows.length) return [];
    const metricAverages: Record<string, number | null> = {};
    const metrics = new Map<string, typeof playerRows>();
    for (const row of playerRows) {
      const key = metricKey(row.metricName, row.metricUnit);
      const list = metrics.get(key) ?? [];
      list.push(row);
      metrics.set(key, list);
    }
    for (const [key, values] of metrics) metricAverages[key] = weightedAverage(values);
    const cmj = jumpStats(playerRows, (value) => normalizeTestType(value).includes('CMJ'));
    const sj = jumpStats(playerRows, (value) => {
      const type = normalizeTestType(value);
      return type === 'SJ' || type.includes('SQUATJUMP');
    });
    const sq = jumpStats(playerRows, (value) => normalizeTestType(value) === 'SQ');
    const rsiRows = playerRows.filter((row) => row.metricName.toLowerCase().replace(/[^a-z0-9]/g, '').includes('rsimodified'));
    return [{
      playerName,
      cmj: cmj.average,
      sj: sj.average,
      cmjMax: cmj.max,
      sjMax: sj.max,
      rsiModified: weightedAverage(rsiRows),
      sq: sq.average,
      metricAverages,
    }];
  });

  return NextResponse.json(
    { rows, metricOptions, testOptions, selectedTestType, minDate: result.minDate, maxDate: result.maxDate },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}

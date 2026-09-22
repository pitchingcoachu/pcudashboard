import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { loadPerformanceDailyRollups } from '../../../../lib/performance-rollups';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { getPlayerForUser, listPlayerChoicesByOrganization, listPlayerSummariesByOrganization } from '../../../../lib/training-db';
import { fetchValdProfileGroupDirectory, fetchValdProfileNamesForGroup } from '../../../../lib/vald-forceplates';
import { resolvePercentileComparisonWindow } from '../../../../lib/percentile-window';

export const maxDuration = 120;

const BIOMECHANICS_COLUMNS = [
  'Name', 'Date', '#', 'Pitch Type',
  'Pitch Velocity (mph)', 'Back Leg Peak Fz (lb)', 'Peak De-Weighting (lb)',
  'Z-Force Gain (lb)', 'Back Leg Peak Fy (lb)', 'Mound Connection (BW%)',
  'Back Leg Impulse (lb·s)', 'Back Leg Impulse Time (s)', 'Back Leg YZ Transfer (s)',
  'Lead Leg Peak Fz (lb)', 'Lead Leg Peak Fy (lb)', 'Lead Leg Clawback (s)',
  'Lead Leg FFC to Peak Y (s)', 'Lead Leg YZ Transfer (s)', 'Y Transfer (s)',
  'Z Transfer (s)', 'Stride Length (in)', 'Stride Direction (deg)',
];

function pivotRollups(
  rollups: Awaited<ReturnType<typeof loadPerformanceDailyRollups>>,
  forceMode: 'force' | 'bw'
): Array<Record<string, string | number | null>> {
  const suffix = `\u001f${forceMode}`;
  const bySession = new Map<string, Record<string, string | number | null>>();
  for (const rollup of rollups) {
    if (!rollup.metricKey.endsWith(suffix)) continue;
    const key = [rollup.playerNameNorm, rollup.sessionDate, rollup.activityType].join('\u001f');
    const row = bySession.get(key) ?? {
      Name: rollup.playerName,
      Date: rollup.sessionDate,
      '#': 0,
      'Pitch Type': rollup.activityType,
    };
    row[rollup.metricName] = rollup.sampleCount > 0 ? rollup.valueSum / rollup.sampleCount : null;
    row['#'] = Math.max(Number(row['#'] ?? 0), rollup.sampleCount);
    bySession.set(key, row);
  }
  return Array.from(bySession.values());
}

type CellRank = {
  value: number;
  percentile: number | null;
  sampleSize: number;
  rankingDirection: 'higher_is_higher' | 'lower_is_better' | 'handedness_normalized';
};

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

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(value: number, population: number[], invert = false): { percentile: number | null; sampleSize: number } {
  const sign = invert ? -1 : 1;
  const target = value * sign;
  const values = population.filter(Number.isFinite).map((entry) => entry * sign);
  if (!values.length) return { percentile: null, sampleSize: 0 };
  if (values.length === 1) return { percentile: 100, sampleSize: 1 };
  let lower = 0;
  let equal = 0;
  for (const entry of values) {
    if (entry < target) lower += 1;
    else if (Math.abs(entry - target) < 1e-9) equal += 1;
  }
  return {
    percentile: Math.max(0, Math.min(100, Math.round(((lower + Math.max(0, equal - 1) / 2) / (values.length - 1)) * 100))),
    sampleSize: values.length,
  };
}

function lowerIsBetter(column: string): boolean {
  return column === 'Lead Leg Peak Fy (lb)' || column.includes('Transfer (s)') || column.includes('Clawback (s)');
}

function parsePitchTypes(value: string): string[] {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch {}
  return raw.split('|').map((item) => item.trim()).filter(Boolean);
}

function summarizeByPlayerAndPitchType(
  rows: Array<Record<string, string | number | null>>,
  columns: string[]
): Map<string, Map<string, Record<string, number>>> {
  type Aggregate = { count: number; sums: Record<string, number>; counts: Record<string, number> };
  const aggregates = new Map<string, Map<string, Aggregate>>();
  for (const row of rows) {
    const playerKey = normalizeName(String(row.Name ?? ''));
    if (!playerKey) continue;
    const pitchType = String(row['Pitch Type'] ?? '').trim() || 'Unspecified';
    const byPitch = aggregates.get(playerKey) ?? new Map<string, Aggregate>();
    const add = (key: string) => {
      const aggregate = byPitch.get(key) ?? { count: 0, sums: {}, counts: {} };
      const weight = Math.max(1, finite(row['#']) ?? 1);
      aggregate.count += weight;
      for (const column of columns) {
        if (column === 'Name' || column === 'Date' || column === '#' || column === 'Pitch Type' || column === 'Tags') continue;
        const value = finite(row[column]);
        if (value === null) continue;
        aggregate.sums[column] = (aggregate.sums[column] ?? 0) + value * weight;
        aggregate.counts[column] = (aggregate.counts[column] ?? 0) + weight;
      }
      byPitch.set(key, aggregate);
    };
    add(pitchType);
    add('All');
    aggregates.set(playerKey, byPitch);
  }

  const summaries = new Map<string, Map<string, Record<string, number>>>();
  for (const [playerKey, byPitch] of aggregates.entries()) {
    const playerRows = new Map<string, Record<string, number>>();
    for (const [pitchType, aggregate] of byPitch.entries()) {
      const summary: Record<string, number> = { '#': aggregate.count };
      for (const [column, sum] of Object.entries(aggregate.sums)) {
        const count = aggregate.counts[column] ?? 0;
        if (count > 0) summary[column] = sum / count;
      }
      playerRows.set(pitchType, summary);
    }
    summaries.set(playerKey, playerRows);
  }
  return summaries;
}

function rowsForPlayer(rows: Array<Record<string, string | number | null>>, playerName: string) {
  const key = normalizeName(playerName);
  return rows.filter((row) => normalizeName(String(row.Name ?? '')) === key);
}

function dateMs(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Date.parse(/\dT/.test(raw) ? raw : `${raw}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function averageMetric(rows: Array<Record<string, string | number | null>>, column: string): number | null {
  const values = rows.flatMap((row) => {
    const value = finite(row[column]);
    return value === null ? [] : [{ value, weight: Math.max(1, finite(row['#']) ?? 1) }];
  });
  const totalWeight = values.reduce((sum, entry) => sum + entry.weight, 0);
  return totalWeight ? values.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight : null;
}

function latestSessionMetric(rows: Array<Record<string, string | number | null>>, column: string): { value: number | null; date: string | null; dateMs: number | null } {
  const dated = rows.flatMap((row) => {
    const ms = dateMs(row.Date);
    return ms === null ? [] : [{ row, ms, date: String(row.Date ?? '') }];
  });
  const latestMs = dated.reduce<number | null>((latest, row) => latest === null || row.ms > latest ? row.ms : latest, null);
  if (latestMs === null) return { value: null, date: null, dateMs: null };
  const latestRows = dated.filter((row) => row.ms === latestMs).map((row) => row.row);
  return { value: averageMetric(latestRows, column), date: dated.find((row) => row.ms === latestMs)?.date ?? null, dateMs: latestMs };
}

export async function GET(request: Request) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session)) || resolveProgrammingSchoolCode(session) !== 'PCU') {
    return NextResponse.json({ error: 'AxioForce data is not available.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const requestedPlayer = String(url.searchParams.get('player') ?? '').trim();
  const groupId = String(url.searchParams.get('groupId') ?? 'all').trim() || 'all';
  if (!requestedPlayer) return NextResponse.json({ error: 'Player is required.' }, { status: 400 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  const [roster, rosterSummaries] = await Promise.all([
    listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null }),
    listPlayerSummariesByOrganization({ organizationId, assignedCoachUserId: null }),
  ]);
  const rosterNames = Array.from(new Set(roster.map((player) => String(player.fullName ?? '').trim()).filter(Boolean)));
  const rosterByNorm = new Map(rosterNames.map((name) => [normalizeName(name), name]));
  const throwsHandByNorm = new Map(rosterSummaries.map((player) => [normalizeName(player.fullName), String(player.throwsHand ?? '').trim().toUpperCase()]));
  const canonicalPlayer = rosterByNorm.get(normalizeName(requestedPlayer));
  if (!canonicalPlayer) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });
  if (session.role === 'player') {
    const own = await getPlayerForUser({ organizationId, userId: session.userId ?? 0 });
    if (!own || normalizeName(own.fullName) !== normalizeName(canonicalPlayer)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const tenantId = String(process.env.VALD_FORCEDECKS_TENANT_ID ?? process.env.VALD_TEAM_ID ?? '').trim();
  const allGroups = tenantId ? await fetchValdProfileGroupDirectory(tenantId).catch(() => []) : [];
  const memberships = new Map(await Promise.all(allGroups.map(async (group) => [
    group.id,
    await fetchValdProfileNamesForGroup(tenantId, group.id).catch(() => []),
  ] as const)));
  const rosterNorms = new Set(rosterNames.map(normalizeName));
  const groups = allGroups.filter((group) => (memberships.get(group.id) ?? []).some((name) => rosterNorms.has(normalizeName(name))));
  const validGroup = groupId === 'all' ? null : groups.find((group) => group.id === groupId) ?? null;
  if (groupId !== 'all' && !validGroup) return NextResponse.json({ error: 'VALD group not found.' }, { status: 400 });

  let cohortNames = rosterNames;
  if (validGroup) {
    const groupNorms = new Set((memberships.get(validGroup.id) ?? []).map(normalizeName));
    cohortNames = rosterNames.filter((name) => groupNorms.has(normalizeName(name)));
  }
  const queryNames = Array.from(new Set([...cohortNames, canonicalPlayer]));
  const pitchTypes = parsePitchTypes(String(url.searchParams.get('pitchTypes') ?? ''));
  const startDate = String(url.searchParams.get('startDate') ?? '').trim();
  const endDate = String(url.searchParams.get('endDate') ?? '').trim();
  const comparisonWindow = resolvePercentileComparisonWindow(url.searchParams);
  const forceMode = url.searchParams.get('forceMode') === 'bw' ? 'bw' : 'force';
  const rollups = await loadPerformanceDailyRollups({
    organizationId,
    schoolCode: 'PCU',
    source: 'axioforce',
    playerNames: queryNames,
    activityTypes: pitchTypes.length ? pitchTypes : undefined,
  });
  const populationRows = pivotRollups(rollups, forceMode);
  if (!populationRows.length) {
    return NextResponse.json({ error: 'Biomechanics rollups are not ready yet.' }, { status: 503 });
  }
  const columns = BIOMECHANICS_COLUMNS;
  const comparisonRows = populationRows.filter((row) => {
    const date = String(row.Date ?? '').slice(0, 10);
    return date >= comparisonWindow.startDate && date <= comparisonWindow.endDate;
  });
  const populationSummaries = summarizeByPlayerAndPitchType(comparisonRows, columns);
  const startMs = startDate ? Date.parse(`${startDate}T00:00:00Z`) : null;
  const endMs = endDate ? Date.parse(`${endDate}T23:59:59.999Z`) : null;
  const selectedWindowRows = populationRows.filter((row) => {
    if (normalizeName(String(row.Name ?? '')) !== normalizeName(canonicalPlayer)) return false;
    const rowMs = dateMs(row.Date);
    if (rowMs === null) return !startDate && !endDate;
    if (startMs !== null && Number.isFinite(startMs) && rowMs < startMs) return false;
    if (endMs !== null && Number.isFinite(endMs) && rowMs > endMs) return false;
    return true;
  });
  const selectedSummaries = summarizeByPlayerAndPitchType(selectedWindowRows, columns);
  const selectedRows = selectedSummaries.get(normalizeName(canonicalPlayer)) ?? new Map<string, Record<string, number>>();
  const normalizeForRank = (column: string, value: number, playerName: string) => {
    if (column !== 'Stride Direction (deg)') return value;
    return throwsHandByNorm.get(normalizeName(playerName)) === 'L' ? -value : value;
  };
  const rows: Record<string, Record<string, CellRank>> = {};
  for (const [pitchType, selected] of selectedRows.entries()) {
    const cells: Record<string, CellRank> = {};
    for (const column of columns) {
      if (column === 'Name' || column === 'Date' || column === '#' || column === 'Pitch Type' || column === 'Tags') continue;
      const value = finite(selected[column]);
      if (value === null) continue;
      const population = cohortNames.flatMap((name) => {
        const candidate = populationSummaries.get(normalizeName(name))?.get(pitchType)?.[column];
        return typeof candidate === 'number' && Number.isFinite(candidate) ? [normalizeForRank(column, candidate, name)] : [];
      });
      cells[column] = {
        value,
        rankingDirection: column === 'Stride Direction (deg)'
          ? 'handedness_normalized'
          : lowerIsBetter(column) ? 'lower_is_better' : 'higher_is_higher',
        ...percentile(normalizeForRank(column, value, canonicalPlayer), population, lowerIsBetter(column)),
      };
    }
    rows[pitchType] = cells;
  }

  const signalDefinitions = [
    { key: 'backLegPeakZ', label: 'Back Leg Peak Z', column: 'Back Leg Peak Fz (lb)' },
    { key: 'backLegPeakY', label: 'Back Leg Peak Y', column: 'Back Leg Peak Fy (lb)' },
    { key: 'backLegImpulse', label: 'Back Leg Impulse', column: 'Back Leg Impulse (lb·s)' },
    { key: 'backLegYzTransfer', label: 'Back Leg YZ Transfer', column: 'Back Leg YZ Transfer (s)' },
    { key: 'leadLegPeakY', label: 'Lead Leg Peak Y', column: 'Lead Leg Peak Fy (lb)' },
    { key: 'leadLegClawback', label: 'Lead Leg Clawback', column: 'Lead Leg Clawback (s)' },
  ] as const;
  const selectedIndividualRows = selectedWindowRows;
  const fullTargetRows = rowsForPlayer(populationRows, canonicalPlayer);
  const signals = Object.fromEntries(signalDefinitions.map((definition) => {
    const latest = latestSessionMetric(selectedIndividualRows, definition.column);
    const baselineRows = latest.dateMs === null
      ? []
      : fullTargetRows.filter((row) => {
          const ms = dateMs(row.Date);
          return ms !== null && ms < latest.dateMs! && ms >= latest.dateMs! - 30 * 86_400_000;
        });
    const baseline = averageMetric(baselineRows, definition.column);
    const trendPct = latest.value !== null && baseline !== null && baseline !== 0
      ? ((latest.value - baseline) / Math.abs(baseline)) * 100
      : null;
    const population = cohortNames.flatMap((name) => {
      const value = latestSessionMetric(rowsForPlayer(comparisonRows, name), definition.column).value;
      return value === null ? [] : [value];
    });
    const rank = latest.value === null
      ? { percentile: null, sampleSize: population.length }
      : percentile(latest.value, population, lowerIsBetter(definition.column));
    return [definition.key, {
      label: definition.label,
      column: definition.column,
      value: latest.value,
      date: latest.date,
      baseline30Day: baseline,
      trendPct,
      lowerIsBetter: lowerIsBetter(definition.column),
      ...rank,
    }];
  }));

  const selectedGroupLabel = validGroup
    ? (validGroup.categoryName ? `${validGroup.categoryName} · ${validGroup.name}` : validGroup.name)
    : 'All PCU athletes';
  return NextResponse.json({
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      categoryName: group.categoryName,
      label: group.categoryName ? `${group.categoryName} · ${group.name}` : group.name,
    })),
    selectedGroupId: validGroup?.id ?? 'all',
    selectedGroupLabel,
    comparisonWindow: comparisonWindow.label,
    comparisonDateWindow: { startDate: comparisonWindow.startDate, endDate: comparisonWindow.endDate },
    selectedWindow: { startDate: startDate || null, endDate: endDate || null },
    columns,
    rows,
    signals,
  }, { headers: { 'cache-control': 'private, no-store' } });
}

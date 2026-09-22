import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import type { ForcePlatePercentileRow } from '../../../../lib/force-plate-neon-db';
import { loadPerformanceDailyRollups } from '../../../../lib/performance-rollups';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { getPlayerForUser, listPlayerChoicesByOrganization } from '../../../../lib/training-db';
import { fetchValdProfileGroupDirectory, fetchValdProfileNamesForGroup } from '../../../../lib/vald-forceplates';
import { resolvePercentileComparisonWindow } from '../../../../lib/percentile-window';

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

type Summary = {
  latest: number | null;
  previous: number | null;
  change: number | null;
  average: number | null;
  peak: number | null;
};

function summarize(rows: ForcePlatePercentileRow[], mode: 'average' | 'max'): Summary {
  let selected = [...rows];
  if (mode === 'max') {
    const byDate = new Map<string, ForcePlatePercentileRow>();
    for (const row of selected) {
      const current = byDate.get(row.dateShort);
      if (!current || row.value > current.value) byDate.set(row.dateShort, row);
    }
    selected = Array.from(byDate.values());
  }
  selected.sort((a, b) => {
    const aDate = a.dateTime || a.dateShort;
    const bDate = b.dateTime || b.dateShort;
    return aDate.localeCompare(bDate) || a.testId.localeCompare(b.testId);
  });
  const latestRow = selected[selected.length - 1] ?? null;
  const previousRow = latestRow
    ? selected.slice(0, -1).reverse().find((row) => row.testType === latestRow.testType) ?? null
    : null;
  const values = selected.map((row) => row.value).filter(Number.isFinite);
  return {
    latest: latestRow?.value ?? null,
    previous: previousRow?.value ?? null,
    change: latestRow && previousRow ? latestRow.value - previousRow.value : null,
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    peak: values.length ? Math.max(...values) : null,
  };
}

// Pure-duration metrics (braking phase duration, contraction time, time to peak
// force/takeoff, etc.) are lower-is-better; everything else this route serves
// (force, power, velocity, jump height, RSI, percent ratios) is higher-is-better.
const DURATION_UNITS = new Set(['millisecond', 'second', 's', 'ms']);

function isLowerBetterMetric(metricUnit: string): boolean {
  return DURATION_UNITS.has(metricUnit.trim().toLowerCase());
}

function percentile(value: number | null, population: Array<number | null>, invert = false): { percentile: number | null; sampleSize: number } {
  const sign = invert ? -1 : 1;
  const values = population.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)).map((entry) => entry * sign);
  const target = value !== null && Number.isFinite(value) ? value * sign : null;
  if (target === null || !values.length) return { percentile: null, sampleSize: values.length };
  if (values.length === 1) return { percentile: 100, sampleSize: 1 };
  let lower = 0;
  let equal = 0;
  for (const entry of values) {
    if (entry < target) lower += 1;
    else if (Math.abs(entry - target) < 1e-9) equal += 1;
  }
  return { percentile: Math.round(((lower + Math.max(0, equal - 1) / 2) / (values.length - 1)) * 100), sampleSize: values.length };
}

export async function GET(request: Request) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session)) || resolveProgrammingSchoolCode(session) !== 'PCU') {
    return NextResponse.json({ error: 'Force Plate Data is not available.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const requestedPlayer = String(url.searchParams.get('player') ?? '').trim();
  const metricName = String(url.searchParams.get('metricName') ?? '').trim();
  const metricUnit = String(url.searchParams.get('metricUnit') ?? '').trim();
  const groupId = String(url.searchParams.get('groupId') ?? 'all').trim() || 'all';
  const testType = String(url.searchParams.get('testType') ?? 'All').trim() || 'All';
  const mode = url.searchParams.get('mode') === 'max' ? 'max' : 'average';
  if (!requestedPlayer || !metricName) {
    return NextResponse.json({ error: 'Player and metric are required.' }, { status: 400 });
  }

  const organizationId = await resolveProgrammingOrganizationId(session);
  const roster = await listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null });
  const rosterNames = Array.from(new Set(roster.map((player) => String(player.fullName ?? '').trim()).filter(Boolean)));
  const rosterByNorm = new Map(rosterNames.map((name) => [normalizeName(name), name]));
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
    const valdNames = memberships.get(validGroup.id) ?? [];
    const groupNorms = new Set(valdNames.map(normalizeName));
    cohortNames = rosterNames.filter((name) => groupNorms.has(normalizeName(name)));
  }
  const queryNames = Array.from(new Set([...cohortNames, canonicalPlayer]));
  const startDate = String(url.searchParams.get('startDate') ?? '').trim();
  const endDate = String(url.searchParams.get('endDate') ?? '').trim();
  const comparisonWindow = resolvePercentileComparisonWindow(url.searchParams);
  const rollups = await loadPerformanceDailyRollups({
    organizationId,
    schoolCode: 'PCU',
    source: 'vald',
    playerNames: queryNames,
    activityTypes: testType !== 'All' ? [testType] : undefined,
    metricKeys: [`${metricName}\u001f${metricUnit}`],
  });
  const populationRows: ForcePlatePercentileRow[] = rollups.map((row) => ({
    playerName: row.playerName,
    testId: `${row.sessionDate}:${row.activityType}`,
    dateTime: `${row.sessionDate}T12:00:00.000Z`,
    dateShort: row.sessionDate,
    testType: row.activityType,
    value: mode === 'max' ? row.valueMax : row.sampleCount > 0 ? row.valueSum / row.sampleCount : row.latestValue,
  }));
  const filteredSelectedRows = startDate || endDate
    ? populationRows.filter((row) => normalizeName(row.playerName) === normalizeName(canonicalPlayer)
        && (!startDate || row.dateShort >= startDate) && (!endDate || row.dateShort <= endDate))
    : null;
  const comparisonRows = populationRows.filter((row) => row.dateShort >= comparisonWindow.startDate && row.dateShort <= comparisonWindow.endDate);
  const rowsByPlayer = new Map<string, ForcePlatePercentileRow[]>();
  for (const row of comparisonRows) {
    const key = normalizeName(row.playerName);
    const current = rowsByPlayer.get(key) ?? [];
    current.push(row);
    rowsByPlayer.set(key, current);
  }
  const selected = summarize(filteredSelectedRows ?? populationRows.filter((row) => normalizeName(row.playerName) === normalizeName(canonicalPlayer)), mode);
  const population = cohortNames.map((name) => summarize(rowsByPlayer.get(normalizeName(name)) ?? [], mode));
  const invert = isLowerBetterMetric(metricUnit);
  const stats = {
    latest: percentile(selected.latest, population.map((entry) => entry.latest), invert),
    previous: percentile(selected.previous, population.map((entry) => entry.previous), invert),
    change: percentile(selected.change, population.map((entry) => entry.change), invert),
    average: percentile(selected.average, population.map((entry) => entry.average), invert),
    peak: percentile(selected.peak, population.map((entry) => entry.peak), invert),
  };

  return NextResponse.json({
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      categoryName: group.categoryName,
      label: group.categoryName ? `${group.categoryName} · ${group.name}` : group.name,
    })),
    selectedGroupId: validGroup?.id ?? 'all',
    selectedGroupLabel: validGroup ? (validGroup.categoryName ? `${validGroup.categoryName} · ${validGroup.name}` : validGroup.name) : 'All PCU athletes',
    comparisonWindow: comparisonWindow.label,
    comparisonDateWindow: { startDate: comparisonWindow.startDate, endDate: comparisonWindow.endDate },
    selectedWindow: { startDate: startDate || null, endDate: endDate || null },
    stats,
  }, { headers: { 'cache-control': 'private, no-store' } });
}

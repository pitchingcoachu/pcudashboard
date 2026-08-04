import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { canManagePlayer } from '../../../../lib/portal-access';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { getPlayerByIdInOrganization } from '../../../../lib/training-db';
import { loadForcePlateSnapshot } from '../../../../lib/force-plate-cache-db';
import { loadForcePlateSnapshotFromNeon } from '../../../../lib/force-plate-neon-db';

type ForcePlateMetricOption = {
  key: string;
  label: string;
};

type ForcePlateTrendPoint = {
  dayDate: string;
  averageLoad: number;
};

function normalizeName(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const firstLast = raw.includes(',')
    ? (() => {
        const [last, ...rest] = raw.split(',').map((x) => x.trim());
        const first = rest.join(' ').trim();
        return first && last ? `${first} ${last}` : raw;
      })()
    : raw;
  return firstLast
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toIsoDay(value: string): string {
  const parsed = new Date(String(value ?? '').trim());
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function metricKey(metricName: string, metricUnit: string): string {
  return `${String(metricName ?? '').trim()}__${String(metricUnit ?? '').trim()}`;
}

function bodyWeightLbsFromMetric(metricName: string, metricUnit: string, value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const name = String(metricName ?? '').trim().toLowerCase();
  const unit = String(metricUnit ?? '').trim().toLowerCase();
  if (name === 'bodyweight in pounds' || unit === 'pound' || unit === 'pounds' || unit === 'lb' || unit === 'lbs') {
    if (value < 130) return value * 2.20462262185;
    return value;
  }
  if (name === 'body weight' && (unit === 'kg' || unit === 'kilo' || unit === 'kilogram' || unit === 'kilograms')) {
    return value * 2.20462262185;
  }
  if (
    name === 'bodyweight in kilograms' ||
    unit === 'kg' ||
    unit === 'kilo' ||
    unit === 'kilogram' ||
    unit === 'kilograms'
  ) {
    return value * 2.20462262185;
  }
  return null;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!(await canUseProgrammingData(session)) || resolveProgrammingSchoolCode(session) !== 'PCU') {
    return NextResponse.json({
      options: [],
      trendByMetric: {},
      valdWeightLogs: [],
      defaultMetricKey: '',
    });
  }

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'Invalid programming organization.' }, { status: 400 });
  }
  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  try {
    const schoolCode = resolveProgrammingSchoolCode(session);
    const neon = await loadForcePlateSnapshotFromNeon({
      organizationId,
      schoolCode,
      allowedPlayerNames: [player.fullName],
    });
    const cached = neon.snapshot ? { snapshot: neon.snapshot } : await loadForcePlateSnapshot({ organizationId, schoolCode });
    if (!cached.snapshot) {
      return NextResponse.json(
        { error: 'Force plate cache is empty. Ask an admin to run Force Plate Sync.' },
        { status: 503 }
      );
    }
    const snapshot = cached.snapshot;
    const selected =
      snapshot.players.find((entry) => normalizeName(entry.playerName) === normalizeName(player.fullName)) ??
      snapshot.players[0] ??
      null;

    if (!selected || !selected.metricRows.length) {
      return NextResponse.json({
        options: [],
        trendByMetric: {},
        valdWeightLogs: [],
        defaultMetricKey: '',
      });
    }

    const optionMap = new Map<string, ForcePlateMetricOption>();
    const trendBuckets = new Map<string, Map<string, { sum: number; count: number }>>();
    const weightByDate = new Map<string, number>();

    for (const row of selected.metricRows) {
      if (!Number.isFinite(Number(row.value))) continue;
      const key = metricKey(row.metricName, row.metricUnit);
      if (!optionMap.has(key)) {
        const label = row.metricUnit ? `${row.metricName} (${row.metricUnit})` : row.metricName;
        optionMap.set(key, { key, label });
      }
      const isoDay = toIsoDay(row.dateTime ?? row.date);
      if (!isoDay) continue;
      const metricDates = trendBuckets.get(key) ?? new Map<string, { sum: number; count: number }>();
      const dateBucket = metricDates.get(isoDay) ?? { sum: 0, count: 0 };
      dateBucket.sum += Number(row.value);
      dateBucket.count += 1;
      metricDates.set(isoDay, dateBucket);
      trendBuckets.set(key, metricDates);

      const bodyWeight = bodyWeightLbsFromMetric(row.metricName, row.metricUnit, Number(row.value));
      if (bodyWeight !== null && Number.isFinite(bodyWeight)) {
        const current = weightByDate.get(isoDay);
        if (!Number.isFinite(current ?? NaN) || Number(bodyWeight) > Number(current)) {
          weightByDate.set(isoDay, bodyWeight);
        }
      }
    }

    const trendByMetric = Object.fromEntries(
      Array.from(trendBuckets.entries()).map(([key, dayMap]) => [
        key,
        Array.from(dayMap.entries())
          .map(([dayDate, bucket]) => ({
            dayDate,
            averageLoad: bucket.count > 0 ? bucket.sum / bucket.count : 0,
          }))
          .sort((a, b) => a.dayDate.localeCompare(b.dayDate)),
      ])
    ) as Record<string, ForcePlateTrendPoint[]>;

    const options = Array.from(optionMap.values()).sort((a, b) => a.label.localeCompare(b.label));
    const valdWeightLogs = Array.from(weightByDate.entries())
      .map(([logDate, weightLbs]) => ({ logDate, weightLbs, notes: 'VALD Force Plate' }))
      .sort((a, b) => a.logDate.localeCompare(b.logDate));

    const findDefaultMetricKey = (): string => {
      const lower = options.map((opt) => ({ ...opt, lower: opt.key.toLowerCase() }));
      const jumpHeightInches = lower.find(
        (opt) =>
          opt.lower.includes('jump height') &&
          opt.lower.includes('(flight time)') &&
          (opt.lower.endsWith('__inch') || opt.lower.endsWith('__in') || opt.lower.endsWith('__inches'))
      );
      if (jumpHeightInches) return jumpHeightInches.key;
      const anyJumpHeightInches = lower.find(
        (opt) =>
          opt.lower.includes('jump height') &&
          (opt.lower.endsWith('__inch') || opt.lower.endsWith('__in') || opt.lower.endsWith('__inches'))
      );
      if (anyJumpHeightInches) return anyJumpHeightInches.key;
      const flightTimeAnyUnit = lower.find(
        (opt) => opt.lower.includes('jump height') && opt.lower.includes('(flight time)')
      );
      if (flightTimeAnyUnit) return flightTimeAnyUnit.key;
      return lower.find((opt) => opt.lower.includes('jump height'))?.key ?? options[0]?.key ?? '';
    };
    const defaultMetricKey = findDefaultMetricKey();

    return NextResponse.json({
      options,
      trendByMetric,
      valdWeightLogs,
      defaultMetricKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load force plate data.';
    console.error('[force-plate-profile] failed', {
      playerId,
      message,
      at: new Date().toISOString(),
    });
    const isValdRateLimit = /429/.test(message) || /rate limit/i.test(message);
    if (isValdRateLimit) {
      return NextResponse.json(
        { error: 'VALD is rate-limiting requests right now. Please retry in about a minute.' },
        { status: 503, headers: { 'retry-after': '60' } }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

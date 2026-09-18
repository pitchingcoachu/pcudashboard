import type { FlagRuleRow } from './ai-workspace-db';
import { getDbPool } from './auth-db';
import { canonicalFlagMetric, metricSampleColumn, parseBiomechanicsFlagMetric, parseForcePlateFlagMetric, parseOvrSprintFlagMetric } from './dashboard-metric-catalog';
import { resolveDashboardApiBaseUrl } from './dashboard-access';
import { parseSortableNumber } from './table-sort';
import { listOvrSprintResults } from './ovr-sprint';
import { getBiomechanicsSnapshot } from './biomechanics-db';

type FlagDomain = 'pitching' | 'hitting' | 'force_plates' | 'ovr_sprint' | 'biomechanics';
type DashboardFlagRule = FlagRuleRow & { domain: 'pitching' | 'hitting' };
type Point = Record<string, unknown>;

/** Converts yards/seconds to mph -- same formula used elsewhere for OVR
 * Sprint speed derivation this session (distance * 3600 / (time * 1760)). */
function yardsPerSecondToMph(distanceYards: number, timeSeconds: number): number | null {
  if (!Number.isFinite(distanceYards) || !Number.isFinite(timeSeconds) || timeSeconds <= 0) return null;
  return (distanceYards * 3600) / (timeSeconds * 1760);
}

/** Parses Biomechanics' display-formatted "M/D/YY" date (from
 * formatDateKeyMddyy in lib/biomechanics-db.ts) back to ISO "YYYY-MM-DD" so
 * it matches the session_date shape flag-evaluation.ts expects everywhere
 * else. Assumes a post-2000 2-digit year, true for all data in this app. */
function biomechDateLabelToIso(label: string): string | null {
  const match = String(label ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!match) return null;
  const month = match[1].padStart(2, '0');
  const day = match[2].padStart(2, '0');
  const year = `20${match[3]}`;
  return `${year}-${month}-${day}`;
}

function parseMetricValue(metric: string, value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (metric === 'TiltDev') {
    const match = raw.match(/^([+-])?\s*(\d{1,2}):(\d{2})$/);
    if (match) return (match[1] === '-' ? -1 : 1) * ((Number(match[2]) * 60) + Number(match[3]));
  }
  if (metric === 'rTilt' || metric === 'bTilt') {
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      const clockMinutes = ((Number(match[1]) % 12) * 60) + Number(match[2]);
      return ((clockMinutes / 2) - 180 + 360) % 360;
    }
  }
  return parseSortableNumber(value);
}

function selectedPitchTypes(rule: FlagRuleRow): string[] {
  const values = rule.pitchTypes?.length ? rule.pitchTypes : [rule.pitchType];
  return values.map((value) => String(value ?? '').trim()).filter(Boolean);
}

function filterKey(rule: FlagRuleRow): string {
  if (rule.domain === 'force_plates') return `${rule.domain}\u0000${String(rule.testType ?? 'All').trim().toLowerCase()}`;
  const pitches = selectedPitchTypes(rule)
    .filter((value) => value.toLowerCase() !== 'all')
    .map((value) => value.toLowerCase())
    .sort()
    .join(';');
  return `${rule.domain}\u0000${String(rule.sessionType ?? 'All').trim().toLowerCase()}\u0000${pitches}`;
}

async function mapConcurrent<T, R>(values: T[], limit: number, map: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await map(values[index]);
    }
  }));
  return output;
}

/** Load daily values from the same overview engine used by Summary Tables. */
export async function loadFlagMetricPoints(input: {
  organizationId: number;
  schoolCode: string;
  startDate: string;
  endDate: string;
  domains: FlagDomain[];
  rules: FlagRuleRow[];
  allowedPlayerNames?: string[];
}): Promise<{ pitching: Point[]; hitting: Point[]; force_plates: Point[]; ovr_sprint: Point[]; biomechanics: Point[] }> {
  const schoolCode = String(input.schoolCode ?? '').trim().toUpperCase();
  const playerKey = (value: unknown) => String(value ?? '')
    .trim()
    .replace(/^([^,]+),\s*(.+)$/, '$2 $1')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  const allowedPlayerKeys = input.allowedPlayerNames
    ? new Set(input.allowedPlayerNames.map(playerKey).filter(Boolean))
    : null;
  const dashboardDomains = input.domains.filter((domain): domain is 'pitching' | 'hitting' => domain !== 'force_plates');
  const table = schoolCode === 'PRO' ? 'public.pro_pitch_events' : 'public.pitch_events';
  const dateResult = dashboardDomains.length
    ? await getDbPool().query<{ session_date: string }>(
        `SELECT DISTINCT session_date::text AS session_date
           FROM ${table}
          WHERE school_code = $1
            AND session_date >= $2::date
            AND session_date <= $3::date
          ORDER BY session_date DESC`,
        [schoolCode, input.startDate, input.endDate]
      )
    : { rows: [] };
  const dates = dateResult.rows.map((row) => String(row.session_date).slice(0, 10)).filter(Boolean);
  const dashboardRules = input.rules.filter(
    (entry): entry is DashboardFlagRule => entry.enabled && entry.domain !== 'force_plates' && input.domains.includes(entry.domain)
  );
  const groups = new Map<string, DashboardFlagRule[]>();
  for (const rule of dashboardRules) {
    const key = filterKey(rule);
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }

  const apiBase = resolveDashboardApiBaseUrl();
  const tasks = Array.from(groups.values()).flatMap((rules) => dates.map((date) => ({ rules, date })));
  const batches = await mapConcurrent(tasks, 6, async ({ rules, date }) => {
    const first = rules[0];
    const domain = first.domain;
    const metrics = Array.from(new Set(rules.map((rule) => canonicalFlagMetric(rule.metric))));
    const sampleColumns = Array.from(new Set(rules.map((rule) => metricSampleColumn(domain, rule.metric))));
    const url = new URL(`${apiBase}/v1/${domain}/overview`);
    url.searchParams.set('school_code', schoolCode);
    url.searchParams.set('start_date', date);
    url.searchParams.set('end_date', date);
    url.searchParams.set('split_by', domain === 'pitching' ? 'Pitcher' : 'Batter');
    url.searchParams.set('table_mode', 'Custom');
    url.searchParams.set('custom_columns', Array.from(new Set([...sampleColumns, ...metrics])).join(','));
    url.searchParams.set('include_chart_points', '0');
    const pitches = selectedPitchTypes(first).filter((value) => value.toLowerCase() !== 'all');
    if (pitches.length) url.searchParams.set('pitch_types', pitches.join(';'));
    if (first.sessionType && first.sessionType.toLowerCase() !== 'all') url.searchParams.set('session_type', first.sessionType);

    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(60000) });
    const payload = await response.json().catch(() => ({})) as { table_rows?: Point[]; error?: string; detail?: string };
    if (!response.ok) throw new Error(payload.error ?? payload.detail ?? `Could not load ${domain} flag metrics.`);
    const playerColumn = domain === 'pitching' ? 'Pitcher' : 'Batter';
    const points: Point[] = [];
    for (const row of payload.table_rows ?? []) {
      const player = String(row[playerColumn] ?? '').trim();
      if (!player || player.toLowerCase() === 'all') continue;
      if (allowedPlayerKeys && !allowedPlayerKeys.has(playerKey(player))) continue;
      for (const rule of rules) {
        const metric = canonicalFlagMetric(rule.metric);
        const value = parseMetricValue(metric, row[metric]);
        const sampleColumn = metricSampleColumn(domain, metric);
        const sample = parseSortableNumber(row[sampleColumn]);
        if (value === null || sample === null) continue;
        points.push({
          __rule_id: rule.id,
          [domain === 'pitching' ? 'pitcher' : 'batter']: player,
          session_date: date,
          pitch_type: 'All',
          session_type: first.sessionType,
          [metric]: value,
          [`${metric}_n`]: sample,
        });
      }
    }
    return { domain, points };
  });

  const output: { pitching: Point[]; hitting: Point[]; force_plates: Point[]; ovr_sprint: Point[]; biomechanics: Point[] } = { pitching: [], hitting: [], force_plates: [], ovr_sprint: [], biomechanics: [] };
  for (const batch of batches) output[batch.domain].push(...batch.points);
  const forcePlateRules = input.rules.filter((rule) => rule.enabled && rule.domain === 'force_plates');
  if (forcePlateRules.length) {
    const metricIdentities = Array.from(new Set(forcePlateRules.flatMap((rule) => {
      const parsed = parseForcePlateFlagMetric(rule.metric);
      return parsed ? [`${parsed.metricName}\u001f${parsed.metricUnit}`] : [];
    })));
    const playerNorms = input.allowedPlayerNames
      ? Array.from(new Set(input.allowedPlayerNames.map((name) => String(name ?? '').trim().toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ')).filter(Boolean)))
      : [];
    if (metricIdentities.length && playerNorms.length) {
      const forceRows = await getDbPool().query<{
        player_name: string;
        session_date: string;
        test_type: string;
        metric_name: string;
        metric_unit: string;
        metric_value: number;
        samples: number;
      }>(
        `SELECT player_name,
                date_time_utc::date::text AS session_date,
                test_type,
                metric_name,
                metric_unit,
                AVG(value)::double precision AS metric_value,
                COUNT(DISTINCT test_id)::integer AS samples
         FROM force_plate_metric_rows
         WHERE organization_id = $1
           AND school_code = $2
           AND player_name_norm = ANY($3::text[])
           AND point_type = 'average'
           AND date_time_utc >= $4::date
           AND date_time_utc < $5::date + INTERVAL '1 day'
           AND (metric_name || chr(31) || metric_unit) = ANY($6::text[])
         GROUP BY player_name, date_time_utc::date, test_type, metric_name, metric_unit
         ORDER BY session_date DESC, player_name, test_type, metric_name, metric_unit`,
        [input.organizationId, schoolCode, playerNorms, input.startDate, input.endDate, metricIdentities]
      );
      for (const row of forceRows.rows) {
        for (const rule of forcePlateRules) {
          const parsed = parseForcePlateFlagMetric(rule.metric);
          if (!parsed || parsed.metricName !== row.metric_name || parsed.metricUnit !== row.metric_unit) continue;
          if (rule.testType !== 'All' && rule.testType !== row.test_type) continue;
          output.force_plates.push({
            __rule_id: rule.id,
            player_name: row.player_name,
            session_date: row.session_date,
            test_type: row.test_type,
            [rule.metric]: Number(row.metric_value),
            [`${rule.metric}_n`]: Number(row.samples),
          });
        }
      }
    }
  }

  const ovrSprintRules = input.rules.filter((rule) => rule.enabled && rule.domain === 'ovr_sprint');
  if (ovrSprintRules.length) {
    const results = await listOvrSprintResults({ organizationId: input.organizationId, schoolCode });
    const allowedKeys = input.allowedPlayerNames ? new Set(input.allowedPlayerNames.map(playerKey).filter(Boolean)) : null;
    // One attempt = one (player, exercise, date, sprintNumber) group. Every
    // split row of an attempt shares the same total_time_seconds (confirmed
    // live: OVR stores it duplicated per split, not once per attempt), so
    // any row's totalTime is correct; speedMph, however, genuinely varies
    // per split for multi-split exercises, so "total speed" is derived as
    // distance-weighted (sum of that attempt's split distances / total
    // time), which collapses to the single split's own speed for
    // single-split exercises (10/40/60yd Sprint, 5-10-5) with no special-casing.
    const attempts = new Map<string, { player: string; date: string; exercise: string; totalTime: number; distanceSum: number; hasDistance: boolean }>();
    for (const row of results) {
      if (row.date < input.startDate || row.date > input.endDate) continue;
      if (allowedKeys && !allowedKeys.has(playerKey(row.athleteName))) continue;
      const key = `${playerKey(row.athleteName)} ${row.date} ${row.exercise} ${row.sprintNumber}`;
      const attempt = attempts.get(key) ?? { player: row.athleteName, date: row.date, exercise: row.exercise, totalTime: row.totalTime, distanceSum: 0, hasDistance: true };
      if (row.distanceYards === null) attempt.hasDistance = false;
      else attempt.distanceSum += row.distanceYards;
      attempts.set(key, attempt);
    }
    for (const attempt of attempts.values()) {
      const speedMph = attempt.hasDistance ? yardsPerSecondToMph(attempt.distanceSum, attempt.totalTime) : null;
      for (const rule of ovrSprintRules) {
        const parsed = parseOvrSprintFlagMetric(rule.metric);
        if (!parsed || parsed.exercise !== attempt.exercise) continue;
        const value = parsed.metric === 'speedMph' ? speedMph : attempt.totalTime;
        if (value === null) continue;
        output.ovr_sprint.push({
          __rule_id: rule.id,
          player_name: attempt.player,
          session_date: attempt.date,
          [rule.metric]: value,
          [`${rule.metric}_n`]: 1,
        });
      }
    }
  }

  const biomechanicsRules = input.rules.filter((rule) => rule.enabled && rule.domain === 'biomechanics');
  if (biomechanicsRules.length) {
    const snapshot = await getBiomechanicsSnapshot({
      organizationId: input.organizationId,
      schoolCode,
      startDate: input.startDate,
      endDate: input.endDate,
      selectedPitcher: null,
      forceMode: 'force',
    });
    const allowedKeys = input.allowedPlayerNames ? new Set(input.allowedPlayerNames.map(playerKey).filter(Boolean)) : null;
    for (const row of snapshot.leaderboardIndividualRows) {
      const player = String(row.Name ?? '').trim();
      if (!player) continue;
      if (allowedKeys && !allowedKeys.has(playerKey(player))) continue;
      const sessionDate = biomechDateLabelToIso(String(row.Date ?? ''));
      if (!sessionDate || sessionDate < input.startDate || sessionDate > input.endDate) continue;
      for (const rule of biomechanicsRules) {
        const parsed = parseBiomechanicsFlagMetric(rule.metric);
        if (!parsed) continue;
        const value = parseSortableNumber(row[parsed.column]);
        if (value === null) continue;
        output.biomechanics.push({
          __rule_id: rule.id,
          player_name: player,
          session_date: sessionDate,
          [rule.metric]: value,
          [`${rule.metric}_n`]: 1,
        });
      }
    }
  }

  return output;
}

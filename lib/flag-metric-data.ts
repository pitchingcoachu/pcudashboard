import type { FlagRuleRow } from './ai-workspace-db';
import { getDbPool } from './auth-db';
import { canonicalFlagMetric, metricSampleColumn } from './dashboard-metric-catalog';
import { resolveDashboardApiBaseUrl } from './dashboard-access';
import { parseSortableNumber } from './table-sort';

type FlagDomain = 'pitching' | 'hitting';
type Point = Record<string, unknown>;

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
  schoolCode: string;
  startDate: string;
  endDate: string;
  domains: FlagDomain[];
  rules: FlagRuleRow[];
}): Promise<{ pitching: Point[]; hitting: Point[] }> {
  const schoolCode = String(input.schoolCode ?? '').trim().toUpperCase();
  const table = schoolCode === 'PRO' ? 'public.pro_pitch_events' : 'public.pitch_events';
  const dateResult = await getDbPool().query<{ session_date: string }>(
    `SELECT DISTINCT session_date::text AS session_date
       FROM ${table}
      WHERE school_code = $1
        AND session_date >= $2::date
        AND session_date <= $3::date
      ORDER BY session_date DESC`,
    [schoolCode, input.startDate, input.endDate]
  );
  const dates = dateResult.rows.map((row) => String(row.session_date).slice(0, 10)).filter(Boolean);
  const groups = new Map<string, FlagRuleRow[]>();
  for (const rule of input.rules.filter((entry) => entry.enabled && input.domains.includes(entry.domain))) {
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

  const output: { pitching: Point[]; hitting: Point[] } = { pitching: [], hitting: [] };
  for (const batch of batches) output[batch.domain].push(...batch.points);
  return output;
}

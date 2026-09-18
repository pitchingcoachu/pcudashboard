import { getDbPool, isDatabaseConfigured } from './auth-db';

export type PerformanceRollupSource = 'axioforce' | 'vald' | 'ovr_sprint' | 'ovr_vbt';

export type PerformanceDailyRollupRow = {
  source: PerformanceRollupSource;
  sessionDate: string;
  playerId?: number | null;
  playerNameNorm: string;
  playerName: string;
  activityType: string;
  metricKey: string;
  metricName: string;
  metricUnit: string;
  sampleCount: number;
  valueSum: number;
  valueMin: number;
  valueMax: number;
  latestValue: number;
};

let schemaReady: Promise<void> | null = null;

export function normalizePerformancePlayerName(value: string): string {
  const raw = String(value ?? '').trim();
  const firstLast = raw.includes(',')
    ? (() => {
        const [last, ...rest] = raw.split(',').map((part) => part.trim()).filter(Boolean);
        return `${rest.join(' ')} ${last}`.trim();
      })()
    : raw;
  return firstLast.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function ensurePerformanceRollupSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  if (!isDatabaseConfigured()) return;
  schemaReady = (async () => {
    const pool = getDbPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS performance_metric_daily_rollups (
        organization_id BIGINT NOT NULL,
        school_code TEXT NOT NULL,
        source TEXT NOT NULL,
        session_date DATE NOT NULL,
        player_id BIGINT,
        player_name_norm TEXT NOT NULL,
        player_name TEXT NOT NULL,
        activity_type TEXT NOT NULL DEFAULT '',
        metric_key TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        metric_unit TEXT NOT NULL DEFAULT '',
        sample_count INTEGER NOT NULL,
        value_sum DOUBLE PRECISION NOT NULL,
        value_min DOUBLE PRECISION NOT NULL,
        value_max DOUBLE PRECISION NOT NULL,
        latest_value DOUBLE PRECISION NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (
          organization_id, school_code, source, session_date,
          player_name_norm, activity_type, metric_key
        )
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_performance_rollups_source_date_player
      ON performance_metric_daily_rollups
        (organization_id, school_code, source, session_date, player_name_norm);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_performance_rollups_source_metric_activity
      ON performance_metric_daily_rollups
        (organization_id, school_code, source, metric_key, activity_type, player_name_norm, session_date);
    `);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

export async function replacePerformanceRollupRange(args: {
  organizationId: number;
  schoolCode: string;
  source: PerformanceRollupSource;
  startDate: string;
  endDate: string;
  rows: PerformanceDailyRollupRow[];
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await ensurePerformanceRollupSchema();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM performance_metric_daily_rollups
       WHERE organization_id=$1 AND school_code=$2 AND source=$3
         AND session_date BETWEEN $4::date AND $5::date`,
      [args.organizationId, args.schoolCode, args.source, args.startDate, args.endDate]
    );
    const chunkSize = 150;
    for (let offset = 0; offset < args.rows.length; offset += chunkSize) {
      const chunk = args.rows.slice(offset, offset + chunkSize);
      const values: unknown[] = [];
      const placeholders = chunk.map((row, index) => {
        const base = index * 17;
        values.push(
          args.organizationId, args.schoolCode, row.source, row.sessionDate,
          row.playerId ?? null, row.playerNameNorm, row.playerName, row.activityType,
          row.metricKey, row.metricName, row.metricUnit, row.sampleCount,
          row.valueSum, row.valueMin, row.valueMax, row.latestValue, new Date()
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4}::date,$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17})`;
      });
      await client.query(
        `INSERT INTO performance_metric_daily_rollups (
           organization_id, school_code, source, session_date, player_id,
           player_name_norm, player_name, activity_type, metric_key, metric_name,
           metric_unit, sample_count, value_sum, value_min, value_max, latest_value, updated_at
         ) VALUES ${placeholders.join(',')}
         ON CONFLICT (organization_id, school_code, source, session_date, player_name_norm, activity_type, metric_key)
         DO UPDATE SET
           player_id=EXCLUDED.player_id,
           player_name=EXCLUDED.player_name,
           metric_name=EXCLUDED.metric_name,
           metric_unit=EXCLUDED.metric_unit,
           sample_count=EXCLUDED.sample_count,
           value_sum=EXCLUDED.value_sum,
           value_min=EXCLUDED.value_min,
           value_max=EXCLUDED.value_max,
           latest_value=EXCLUDED.latest_value,
           updated_at=EXCLUDED.updated_at`,
        values
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

type Aggregate = PerformanceDailyRollupRow;

export function buildAxioforceDailyRollups(
  rows: Array<Record<string, string | number | null>>,
  forceMode: 'force' | 'bw'
): PerformanceDailyRollupRow[] {
  const identityColumns = new Set(['Name', 'Date', '#', 'Pitch Type', 'Tags', 'Session']);
  const aggregates = new Map<string, Aggregate>();
  for (const row of rows) {
    const playerName = String(row.Name ?? '').trim();
    const playerNameNorm = normalizePerformancePlayerName(playerName);
    const sessionDate = parseDisplayDate(String(row.Date ?? ''));
    if (!playerNameNorm || !sessionDate) continue;
    const activityType = String(row['Pitch Type'] ?? '').trim() || 'Unspecified';
    for (const [metricName, raw] of Object.entries(row)) {
      if (identityColumns.has(metricName)) continue;
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value)) continue;
      const metricUnit = metricUnitFromLabel(metricName);
      const metricKey = `${metricName}\u001f${forceMode}`;
      const key = [sessionDate, playerNameNorm, activityType, metricKey].join('\u001f');
      const current = aggregates.get(key);
      if (!current) {
        aggregates.set(key, {
          source: 'axioforce', sessionDate, playerNameNorm, playerName, activityType,
          metricKey, metricName, metricUnit, sampleCount: 1, valueSum: value,
          valueMin: value, valueMax: value, latestValue: value,
        });
      } else {
        current.sampleCount += 1;
        current.valueSum += value;
        current.valueMin = Math.min(current.valueMin, value);
        current.valueMax = Math.max(current.valueMax, value);
        current.latestValue = value;
      }
    }
  }
  return Array.from(aggregates.values());
}

function parseDisplayDate(value: string): string | null {
  const raw = value.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!us) return null;
  const year = Number(us[3]) < 100 ? 2000 + Number(us[3]) : Number(us[3]);
  return `${year}-${String(Number(us[1])).padStart(2, '0')}-${String(Number(us[2])).padStart(2, '0')}`;
}

function metricUnitFromLabel(label: string): string {
  return label.match(/\(([^()]*)\)\s*$/)?.[1] ?? '';
}

export async function refreshValdPerformanceRollups(args: {
  organizationId: number;
  schoolCode: string;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<void> {
  await ensurePerformanceRollupSchema();
  const startDate = args.startDate || '1900-01-01';
  const endDate = args.endDate || '2999-12-31';
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM performance_metric_daily_rollups
       WHERE organization_id=$1 AND school_code=$2 AND source='vald'
         AND session_date >= $3::date AND session_date <= $4::date`,
      [args.organizationId, args.schoolCode, startDate, endDate]
    );
    await client.query(
      `INSERT INTO performance_metric_daily_rollups (
       organization_id, school_code, source, session_date, player_id, player_name_norm,
       player_name, activity_type, metric_key, metric_name, metric_unit, sample_count,
       value_sum, value_min, value_max, latest_value, updated_at
     )
     SELECT r.organization_id, r.school_code, 'vald',
       (r.date_time_utc AT TIME ZONE 'America/Phoenix')::date,
       NULL::bigint, r.player_name_norm, MAX(r.player_name), r.test_type,
       r.metric_name || E'\u001f' || r.metric_unit, r.metric_name, r.metric_unit,
       COUNT(*)::integer, SUM(r.value), MIN(r.value), MAX(r.value),
       AVG(r.value), NOW()
     FROM force_plate_metric_rows r
     WHERE r.organization_id=$1 AND r.school_code=$2
       AND r.point_type='average' AND r.date_time_utc IS NOT NULL
       AND r.date_time_utc >= $3::date
       AND r.date_time_utc < $4::date + INTERVAL '1 day'
     GROUP BY r.organization_id, r.school_code,
       (r.date_time_utc AT TIME ZONE 'America/Phoenix')::date,
       r.player_name_norm, r.test_type, r.metric_name, r.metric_unit
     ON CONFLICT (organization_id, school_code, source, session_date, player_name_norm, activity_type, metric_key)
     DO UPDATE SET player_id=EXCLUDED.player_id, player_name=EXCLUDED.player_name,
       sample_count=EXCLUDED.sample_count, value_sum=EXCLUDED.value_sum,
       value_min=EXCLUDED.value_min, value_max=EXCLUDED.value_max,
       latest_value=EXCLUDED.latest_value, updated_at=NOW()`,
      [args.organizationId, args.schoolCode, startDate, endDate]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function refreshOvrPerformanceRollups(args: { organizationId: number; schoolCode: string }): Promise<void> {
  await ensurePerformanceRollupSchema();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
    `DELETE FROM performance_metric_daily_rollups
     WHERE organization_id=$1 AND school_code=$2 AND source IN ('ovr_sprint','ovr_vbt')`,
    [args.organizationId, args.schoolCode]
  );
    await client.query(
    `INSERT INTO performance_metric_daily_rollups (
       organization_id, school_code, source, session_date, player_id, player_name_norm,
       player_name, activity_type, metric_key, metric_name, metric_unit, sample_count,
       value_sum, value_min, value_max, latest_value, updated_at
     )
     SELECT r.organization_id, r.school_code, 'ovr_sprint', r.result_date, r.player_id,
       r.athlete_name_norm, MAX(COALESCE(p.full_name,r.athlete_name)), r.exercise,
       metric.metric_key, metric.metric_name, metric.metric_unit,
       COUNT(metric.value)::integer, SUM(metric.value), MIN(metric.value), MAX(metric.value),
       (ARRAY_AGG(metric.value ORDER BY r.sprint_number DESC, r.split_number DESC))[1], NOW()
     FROM ovr_sprint_results r
     LEFT JOIN players p ON p.id=r.player_id AND p.organization_id=r.organization_id
     CROSS JOIN LATERAL (VALUES
       ('total_time_seconds','Total Time','s',r.total_time_seconds),
       ('split_time_seconds','Split Time','s',r.split_time_seconds),
       ('speed_mph','Sprint Speed','mph',r.speed_mph)
     ) metric(metric_key,metric_name,metric_unit,value)
     WHERE r.organization_id=$1 AND r.school_code=$2 AND r.player_id IS NOT NULL AND metric.value IS NOT NULL
     GROUP BY r.organization_id,r.school_code,r.result_date,r.player_id,r.athlete_name_norm,r.exercise,
       metric.metric_key,metric.metric_name,metric.metric_unit
     ON CONFLICT (organization_id, school_code, source, session_date, player_name_norm, activity_type, metric_key)
     DO UPDATE SET player_id=EXCLUDED.player_id, player_name=EXCLUDED.player_name,
       sample_count=EXCLUDED.sample_count,value_sum=EXCLUDED.value_sum,value_min=EXCLUDED.value_min,
       value_max=EXCLUDED.value_max,latest_value=EXCLUDED.latest_value,updated_at=NOW()`,
    [args.organizationId, args.schoolCode]
  );
    await client.query(
    `INSERT INTO performance_metric_daily_rollups (
       organization_id, school_code, source, session_date, player_id, player_name_norm,
       player_name, activity_type, metric_key, metric_name, metric_unit, sample_count,
       value_sum, value_min, value_max, latest_value, updated_at
     )
     SELECT r.organization_id, r.school_code, 'ovr_vbt', r.result_date, r.player_id,
       r.athlete_name_norm, MAX(COALESCE(p.full_name,r.athlete_name)), r.exercise,
       metric.metric_key, metric.metric_name, metric.metric_unit,
       COUNT(metric.value)::integer, SUM(metric.value), MIN(metric.value), MAX(metric.value),
       (ARRAY_AGG(metric.value ORDER BY r.set_number DESC,r.rep_number DESC))[1], NOW()
     FROM ovr_vbt_results r
     LEFT JOIN players p ON p.id=r.player_id AND p.organization_id=r.organization_id
     CROSS JOIN LATERAL (VALUES
       ('load_lbs','Load','lb',r.load_lbs),('avg_velocity_mps','Average Velocity','m/s',r.avg_velocity_mps),
       ('peak_velocity_mps','Peak Velocity','m/s',r.peak_velocity_mps),('avg_power_watts','Average Power','W',r.avg_power_watts),
       ('peak_power_watts','Peak Power','W',r.peak_power_watts),('rom_inches','ROM','in',r.rom_inches),
       ('duration_seconds','Duration','s',r.duration_seconds),('tpv_seconds','Time to Peak Velocity','s',r.tpv_seconds),
       ('ea_index','EA Index','',r.ea_index)
     ) metric(metric_key,metric_name,metric_unit,value)
     WHERE r.organization_id=$1 AND r.school_code=$2 AND r.player_id IS NOT NULL AND metric.value IS NOT NULL
     GROUP BY r.organization_id,r.school_code,r.result_date,r.player_id,r.athlete_name_norm,r.exercise,
       metric.metric_key,metric.metric_name,metric.metric_unit
     ON CONFLICT (organization_id, school_code, source, session_date, player_name_norm, activity_type, metric_key)
     DO UPDATE SET player_id=EXCLUDED.player_id, player_name=EXCLUDED.player_name,
       sample_count=EXCLUDED.sample_count,value_sum=EXCLUDED.value_sum,value_min=EXCLUDED.value_min,
       value_max=EXCLUDED.value_max,latest_value=EXCLUDED.latest_value,updated_at=NOW()`,
    [args.organizationId, args.schoolCode]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function loadPerformanceDailyRollups(args: {
  organizationId: number;
  schoolCode: string;
  source: PerformanceRollupSource;
  playerNames?: string[];
  startDate?: string | null;
  endDate?: string | null;
  activityTypes?: string[];
  metricKeys?: string[];
}): Promise<PerformanceDailyRollupRow[]> {
  await ensurePerformanceRollupSchema();
  const names = (args.playerNames ?? []).map(normalizePerformancePlayerName).filter(Boolean);
  const result = await getDbPool().query<{
    source: PerformanceRollupSource; session_date: string; player_id: number | null;
    player_name_norm: string; player_name: string; activity_type: string; metric_key: string;
    metric_name: string; metric_unit: string; sample_count: number; value_sum: number;
    value_min: number; value_max: number; latest_value: number;
  }>(
    `SELECT source,session_date::text,player_id,player_name_norm,player_name,activity_type,
       metric_key,metric_name,metric_unit,sample_count,value_sum,value_min,value_max,latest_value
     FROM performance_metric_daily_rollups
     WHERE organization_id=$1 AND school_code=$2 AND source=$3
       AND ($4::text[] IS NULL OR player_name_norm=ANY($4::text[]))
       AND ($5::date IS NULL OR session_date >= $5::date)
       AND ($6::date IS NULL OR session_date <= $6::date)
       AND ($7::text[] IS NULL OR activity_type=ANY($7::text[]))
       AND ($8::text[] IS NULL OR metric_key=ANY($8::text[]))
     ORDER BY session_date ASC,player_name ASC,activity_type ASC,metric_key ASC`,
    [args.organizationId,args.schoolCode,args.source,names.length ? names : null,
      args.startDate || null,args.endDate || null,args.activityTypes?.length ? args.activityTypes : null,
      args.metricKeys?.length ? args.metricKeys : null]
  );
  return result.rows.map((row) => ({
    source: row.source, sessionDate: row.session_date, playerId: row.player_id === null ? null : Number(row.player_id),
    playerNameNorm: row.player_name_norm, playerName: row.player_name, activityType: row.activity_type,
    metricKey: row.metric_key, metricName: row.metric_name, metricUnit: row.metric_unit,
    sampleCount: Number(row.sample_count), valueSum: Number(row.value_sum), valueMin: Number(row.value_min),
    valueMax: Number(row.value_max), latestValue: Number(row.latest_value),
  }));
}

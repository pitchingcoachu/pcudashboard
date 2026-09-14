import { getDbPool, isDatabaseConfigured } from './auth-db';
import type { ValdMetricRow, ValdPlayerSnapshot, ValdSnapshot } from './vald-forceplates';

declare global {
  var __pcuForcePlateNeonReady: boolean | undefined;
}

function normalizeName(value: string): string {
  const raw = String(value ?? '').trim();
  const firstLast = raw.includes(',')
    ? (() => {
        const [last, ...firstParts] = raw.split(',').map((part) => part.trim()).filter(Boolean);
        return `${firstParts.join(' ')} ${last}`.trim();
      })()
    : raw;
  return firstLast
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function ensureForcePlateNeonTables(): Promise<void> {
  if (global.__pcuForcePlateNeonReady) return;
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS force_plate_players (
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      player_name_norm TEXT NOT NULL,
      player_name TEXT NOT NULL,
      profile_id TEXT,
      tests_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, school_code, player_name_norm)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS force_plate_tests (
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      test_id TEXT NOT NULL,
      player_name_norm TEXT NOT NULL,
      player_name TEXT NOT NULL,
      profile_id TEXT,
      test_type TEXT NOT NULL,
      recorded_date_utc TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, school_code, test_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS force_plate_metric_rows (
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      test_id TEXT NOT NULL,
      trial_id TEXT,
      player_name_norm TEXT NOT NULL,
      player_name TEXT NOT NULL,
      date_short TEXT NOT NULL,
      date_time_utc TIMESTAMPTZ,
      test_type TEXT NOT NULL,
      metric_id INTEGER NOT NULL,
      metric_name TEXT NOT NULL,
      metric_unit TEXT NOT NULL DEFAULT '',
      value DOUBLE PRECISION NOT NULL,
      point_type TEXT NOT NULL DEFAULT 'average',
      point_label TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS force_plate_sync_state (
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      last_synced_at TIMESTAMPTZ,
      last_run_started_at TIMESTAMPTZ,
      last_run_completed_at TIMESTAMPTZ,
      last_status TEXT,
      last_error TEXT,
      player_cursor INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, school_code)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS force_plate_player_backfill_state (
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      player_name_norm TEXT NOT NULL,
      completed_at TIMESTAMPTZ,
      last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_error TEXT,
      PRIMARY KEY (organization_id, school_code, player_name_norm)
    );
  `);
  await pool.query(`ALTER TABLE force_plate_sync_state ADD COLUMN IF NOT EXISTS player_cursor INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_force_plate_metric_rows_player
    ON force_plate_metric_rows (organization_id, school_code, player_name_norm);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_force_plate_metric_rows_player_point_date
    ON force_plate_metric_rows (organization_id, school_code, player_name_norm, point_type, date_time_utc);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_force_plate_metric_rows_test
    ON force_plate_metric_rows (organization_id, school_code, test_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_force_plate_tests_semantic_lookup
    ON force_plate_tests (organization_id, school_code, player_name_norm, recorded_date_utc);
  `);
  global.__pcuForcePlateNeonReady = true;
}

export async function listForcePlateHistoricallySearchedPlayerNorms(args: {
  organizationId: number;
  schoolCode: string;
}): Promise<Set<string>> {
  if (!isDatabaseConfigured()) return new Set();
  await ensureForcePlateNeonTables();
  const result = await getDbPool().query<{ player_name_norm: string }>(
    `SELECT player_name_norm
     FROM force_plate_player_backfill_state
     WHERE organization_id = $1 AND school_code = $2 AND completed_at IS NOT NULL`,
    [args.organizationId, args.schoolCode]
  );
  return new Set(result.rows.map((row) => row.player_name_norm));
}

export async function markForcePlatePlayerHistoricalSearch(args: {
  organizationId: number;
  schoolCode: string;
  playerNameNorm: string;
  ok: boolean;
  error?: string | null;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await ensureForcePlateNeonTables();
  await getDbPool().query(
    `INSERT INTO force_plate_player_backfill_state (
       organization_id, school_code, player_name_norm, completed_at, last_attempt_at, last_error
     ) VALUES ($1, $2, $3, CASE WHEN $4 THEN NOW() ELSE NULL END, NOW(), $5)
     ON CONFLICT (organization_id, school_code, player_name_norm)
     DO UPDATE SET
       completed_at = CASE WHEN $4 THEN NOW() ELSE force_plate_player_backfill_state.completed_at END,
       last_attempt_at = NOW(),
       last_error = $5`,
    [args.organizationId, args.schoolCode, args.playerNameNorm, args.ok, args.error ?? null]
  );
}

export type ForcePlateSyncState = {
  organizationId: number;
  schoolCode: string;
  lastSyncedAt: string | null;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  playerCursor: number;
};

function parseIso(value: string | undefined): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function upsertForcePlateSnapshotToNeon(args: {
  organizationId: number;
  schoolCode: string;
  snapshot: ValdSnapshot;
}): Promise<{ ok: true; playerCount: number; testCount: number; metricRowCount: number } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureForcePlateNeonTables();
  const pool = getDbPool();
  const client = await pool.connect();
  let playerCount = 0;
  let testCount = 0;
  let metricRowCount = 0;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [1347634252, args.organizationId]);
    for (const player of args.snapshot.players) {
      playerCount += 1;
      const playerNorm = normalizeName(player.playerName);
      await client.query(
        `
          INSERT INTO force_plate_players (
            organization_id, school_code, player_name_norm, player_name, profile_id, tests_count, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (organization_id, school_code, player_name_norm)
          DO UPDATE SET
            player_name = EXCLUDED.player_name,
            profile_id = EXCLUDED.profile_id,
            tests_count = GREATEST(force_plate_players.tests_count, EXCLUDED.tests_count),
            updated_at = NOW()
        `,
        [args.organizationId, args.schoolCode, playerNorm, player.playerName, player.profileId, player.testsCount]
      );

      const testsById = new Map<string, { testType: string; recorded: Date | null }>();
      for (const row of player.metricRows) {
        const current = testsById.get(row.testId) ?? { testType: row.testType, recorded: null };
        const parsed = parseIso(row.dateTime);
        if (parsed && (!current.recorded || parsed.getTime() > current.recorded.getTime())) current.recorded = parsed;
        testsById.set(row.testId, current);
      }
      const canonicalTestIds = new Map<string, string>();
      for (const [testId, test] of testsById.entries()) {
        let canonicalTestId = testId;
        if (test.recorded) {
          const equivalent = await client.query<{ test_id: string }>(
            `SELECT test_id
             FROM force_plate_tests
             WHERE organization_id = $1
               AND school_code = $2
               AND player_name_norm = $3
               AND LOWER(TRIM(test_type)) = LOWER(TRIM($4))
               AND recorded_date_utc BETWEEN $5::timestamptz - INTERVAL '1 second'
                                        AND $5::timestamptz + INTERVAL '1 second'
             ORDER BY CASE WHEN test_id LIKE 'csv-%' THEN 1 ELSE 0 END, test_id`,
            [args.organizationId, args.schoolCode, playerNorm, test.testType, test.recorded]
          );
          const existingApiId = equivalent.rows.find((row) => !row.test_id.startsWith('csv-'))?.test_id;
          if (testId.startsWith('csv-') && existingApiId) {
            canonicalTestId = existingApiId;
          } else if (!testId.startsWith('csv-')) {
            for (const duplicate of equivalent.rows.filter((row) => row.test_id.startsWith('csv-') && row.test_id !== testId)) {
              await client.query(
                `UPDATE force_plate_metric_rows
                 SET test_id = $4, updated_at = NOW()
                 WHERE organization_id = $1 AND school_code = $2 AND test_id = $3`,
                [args.organizationId, args.schoolCode, duplicate.test_id, testId]
              );
              await client.query(
                `DELETE FROM force_plate_tests
                 WHERE organization_id = $1 AND school_code = $2 AND test_id = $3`,
                [args.organizationId, args.schoolCode, duplicate.test_id]
              );
            }
          }
        }
        canonicalTestIds.set(testId, canonicalTestId);
      }
      const canonicalTestsById = new Map<string, { testType: string; recorded: Date | null }>();
      for (const [testId, test] of testsById.entries()) {
        canonicalTestsById.set(canonicalTestIds.get(testId) ?? testId, test);
      }
      for (const [testId, test] of canonicalTestsById.entries()) {
        testCount += 1;
        await client.query(
          `
            INSERT INTO force_plate_tests (
              organization_id, school_code, test_id, player_name_norm, player_name, profile_id, test_type, recorded_date_utc, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (organization_id, school_code, test_id)
            DO UPDATE SET
              player_name_norm = EXCLUDED.player_name_norm,
              player_name = EXCLUDED.player_name,
              profile_id = EXCLUDED.profile_id,
              test_type = EXCLUDED.test_type,
              recorded_date_utc = COALESCE(EXCLUDED.recorded_date_utc, force_plate_tests.recorded_date_utc),
              updated_at = NOW()
          `,
          [args.organizationId, args.schoolCode, testId, playerNorm, player.playerName, player.profileId, test.testType, test.recorded]
        );
      }

      const normalizedRows = player.metricRows.map((row) => ({
        ...row,
        testId: canonicalTestIds.get(row.testId) ?? row.testId,
      }));
      const rowsByTest = new Map<string, ValdMetricRow[]>();
      for (const row of normalizedRows) {
        const rows = rowsByTest.get(row.testId) ?? [];
        rows.push(row);
        rowsByTest.set(row.testId, rows);
      }
      for (const [testId, incomingRows] of rowsByTest) {
        const hasRepRows = incomingRows.some((row) => row.pointType === 'rep');
        if (hasRepRows) {
          await client.query(
            `DELETE FROM force_plate_metric_rows
             WHERE organization_id = $1 AND school_code = $2 AND test_id = $3`,
            [args.organizationId, args.schoolCode, testId]
          );
          continue;
        }
        const metricIds = Array.from(new Set(incomingRows.map((row) => row.metricId)));
        await client.query(
          `DELETE FROM force_plate_metric_rows
           WHERE organization_id = $1
             AND school_code = $2
             AND test_id = $3
             AND point_type = 'average'
             AND metric_id = ANY($4::int[])`,
          [args.organizationId, args.schoolCode, testId, metricIds]
        );
      }
      const METRIC_ROW_BATCH_SIZE = 200;
      for (let start = 0; start < normalizedRows.length; start += METRIC_ROW_BATCH_SIZE) {
        const chunk = normalizedRows.slice(start, start + METRIC_ROW_BATCH_SIZE);
        metricRowCount += chunk.length;
        const values: unknown[] = [];
        const placeholders: string[] = [];
        chunk.forEach((row, idx) => {
          const base = idx * 15;
          placeholders.push(
            `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},NOW())`
          );
          values.push(
            args.organizationId,
            args.schoolCode,
            row.testId,
            row.trialId ?? null,
            playerNorm,
            player.playerName,
            row.date,
            parseIso(row.dateTime),
            row.testType,
            row.metricId,
            row.metricName,
            row.metricUnit ?? '',
            row.value,
            row.pointType ?? 'average',
            row.pointLabel ?? null
          );
        });
        await client.query(
          `
            INSERT INTO force_plate_metric_rows (
              organization_id, school_code, test_id, trial_id, player_name_norm, player_name, date_short, date_time_utc,
              test_type, metric_id, metric_name, metric_unit, value, point_type, point_label, updated_at
            )
            VALUES ${placeholders.join(',')}
          `,
          values
        );
      }
    }
    await client.query('COMMIT');
    client.release();
    return { ok: true, playerCount, testCount, metricRowCount };
  } catch (error) {
    // A connection whose ROLLBACK itself fails (e.g. because the original
    // error already broke the connection, or the ROLLBACK hits the same
    // query_timeout under load) must not be handed back to the pool as if
    // nothing happened -- confirmed via a real production incident: an
    // earlier sync run's connection was found still "idle in transaction"
    // in pg_stat_activity minutes later, holding a lock that made a
    // completely unrelated later query (markForcePlateSyncRunCompleted's
    // trivial single-row UPSERT) hang for 20+ seconds until timeout. Pass
    // an Error to client.release() so node-postgres destroys the
    // connection instead of returning a possibly-still-transactional one
    // to the pool for reuse.
    let rollbackFailed = false;
    try {
      await client.query('ROLLBACK');
    } catch {
      rollbackFailed = true;
    }
    if (rollbackFailed) {
      client.release(new Error('force_plate_neon_db: rollback failed, destroying connection'));
    } else {
      client.release();
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to write force plate tables.' };
  }
}

function buildPlayerSnapshot(playerName: string, profileId: string | null, testsCount: number, rows: ValdMetricRow[]): ValdPlayerSnapshot {
  const sortedRows = [...rows].sort((a, b) => String(a.dateTime ?? a.date).localeCompare(String(b.dateTime ?? b.date)));
  const recentByTest = new Map<string, ValdMetricRow[]>();
  for (const row of sortedRows) {
    const list = recentByTest.get(row.testId) ?? [];
    list.push(row);
    recentByTest.set(row.testId, list);
  }
  const recentTests = Array.from(recentByTest.entries())
    .map(([testId, list]) => {
      const last = list[list.length - 1];
      return {
        testId,
        date: last?.date ?? '',
        testType: last?.testType ?? 'Unknown',
        primaryMetric: last?.metricName ?? 'Metric',
        primaryValue: last ? `${Number(last.value).toFixed(1)}${last.metricUnit ? ` ${last.metricUnit}` : ''}` : '--',
      };
    })
    .slice(-40)
    .reverse();
  return {
    playerName,
    profileId,
    testsCount,
    recentTests,
    metricAverages: [],
    trend: [],
    metricRows: sortedRows,
  };
}

export async function loadForcePlateSnapshotFromNeon(args: {
  organizationId: number;
  schoolCode: string;
  allowedPlayerNames?: string[];
  metricPlayerNames?: string[];
  pointTypes?: Array<'average' | 'rep'>;
  includeMetrics?: boolean;
}): Promise<{ snapshot: ValdSnapshot | null }> {
  if (!isDatabaseConfigured()) return { snapshot: null };
  await ensureForcePlateNeonTables();
  const pool = getDbPool();
  const playersResult = await pool.query<{
    player_name_norm: string;
    player_name: string;
    profile_id: string | null;
    tests_count: number;
  }>(
    `
      SELECT player_name_norm, player_name, profile_id, tests_count
      FROM force_plate_players
      WHERE organization_id = $1 AND school_code = $2
      ORDER BY player_name ASC
    `,
    [args.organizationId, args.schoolCode]
  );
  if (!playersResult.rowCount) return { snapshot: null };
  const allowed = new Set((args.allowedPlayerNames ?? []).map((name) => normalizeName(name)));
  const playerRows = playersResult.rows.filter((row) => (allowed.size ? allowed.has(row.player_name_norm) : true));
  if (!playerRows.length) return { snapshot: null };
  const requestedMetricNorms = new Set((args.metricPlayerNames ?? []).map((name) => normalizeName(name)));
  const metricPlayerRows = requestedMetricNorms.size
    ? playerRows.filter((row) => requestedMetricNorms.has(row.player_name_norm))
    : playerRows;
  const norms = metricPlayerRows.map((row) => row.player_name_norm);
  const pointTypes = Array.from(new Set(args.pointTypes ?? ['average', 'rep']));
  type MetricDbRow = {
    player_name_norm: string;
    test_id: string;
    trial_id: string | null;
    date_short: string;
    date_time_utc: string | null;
    test_type: string;
    metric_id: number;
    metric_name: string;
    metric_unit: string;
    value: number;
    point_type: string;
    point_label: string | null;
  };
  let metricDbRows: MetricDbRow[] = [];
  if (args.includeMetrics !== false && norms.length) {
    const metricsResult = await pool.query<MetricDbRow>(
      `
      SELECT player_name_norm, test_id, trial_id, date_short, date_time_utc, test_type, metric_id, metric_name, metric_unit, value, point_type, point_label
      FROM force_plate_metric_rows
      WHERE organization_id = $1
        AND school_code = $2
        AND player_name_norm = ANY($3::text[])
        AND point_type = ANY($4::text[])
      ORDER BY COALESCE(date_time_utc, NOW()) ASC, test_id ASC
      `,
      [args.organizationId, args.schoolCode, norms, pointTypes]
    );
    metricDbRows = metricsResult.rows;
  }
  const byPlayer = new Map<string, ValdMetricRow[]>();
  for (const row of metricDbRows) {
    const list = byPlayer.get(row.player_name_norm) ?? [];
    list.push({
      testId: row.test_id,
      trialId: row.trial_id ?? undefined,
      date: row.date_short,
      dateTime: row.date_time_utc ?? undefined,
      testType: row.test_type,
      metricId: row.metric_id,
      metricName: row.metric_name,
      metricUnit: row.metric_unit,
      value: Number(row.value),
      pointType: row.point_type === 'rep' ? 'rep' : 'average',
      pointLabel: row.point_label ?? undefined,
    });
    byPlayer.set(row.player_name_norm, list);
  }
  const players: ValdPlayerSnapshot[] = playerRows.map((row) =>
    buildPlayerSnapshot(row.player_name, row.profile_id, Number(row.tests_count ?? 0), byPlayer.get(row.player_name_norm) ?? [])
  );
  return {
    snapshot: {
      fetchedAt: new Date().toISOString(),
      tenantId: 'neon',
      players,
    },
  };
}

export type ForcePlateLeaderboardAggregate = {
  playerName: string;
  testType: string;
  metricName: string;
  metricUnit: string;
  averageValue: number;
  maximumValue: number;
  samples: number;
};

export async function loadForcePlateMetricCatalog(args: {
  organizationId: number;
  schoolCode: string;
}): Promise<{
  metrics: Array<{ metricName: string; metricUnit: string; testTypes: string[] }>;
  testTypes: string[];
}> {
  if (!isDatabaseConfigured()) return { metrics: [], testTypes: [] };
  await ensureForcePlateNeonTables();
  const result = await getDbPool().query<{ metric_name: string; metric_unit: string; test_type: string }>(
    `SELECT DISTINCT metric_name, metric_unit, test_type
     FROM force_plate_metric_rows
     WHERE organization_id = $1
       AND school_code = $2
       AND point_type = 'average'
     ORDER BY metric_name, metric_unit, test_type`,
    [args.organizationId, args.schoolCode]
  );
  const metricMap = new Map<string, { metricName: string; metricUnit: string; testTypes: string[] }>();
  for (const row of result.rows) {
    const key = `${row.metric_name}\u001f${row.metric_unit}`;
    const current = metricMap.get(key) ?? { metricName: row.metric_name, metricUnit: row.metric_unit, testTypes: [] };
    if (row.test_type && !current.testTypes.includes(row.test_type)) current.testTypes.push(row.test_type);
    metricMap.set(key, current);
  }
  const metrics = Array.from(metricMap.values()).map((metric) => ({ ...metric, testTypes: metric.testTypes.sort((a, b) => a.localeCompare(b)) }));
  const testTypes = Array.from(new Set(result.rows.map((row) => row.test_type).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  return { metrics, testTypes };
}

export type ForcePlateReportMetricRow = {
  playerName: string;
  date: string;
  dateTime: string;
  testType: string;
  metricName: string;
  metricUnit: string;
  value: number;
  samples: number;
};

export async function loadForcePlateReportMetricRows(args: {
  organizationId: number;
  schoolCode: string;
  allowedPlayerNames: string[];
  selectedPlayerNames?: string[];
  metrics: Array<{ metricName: string; metricUnit: string }>;
  testType?: string;
  startDate?: string;
  endDate?: string;
}): Promise<ForcePlateReportMetricRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureForcePlateNeonTables();
  const allowedNorms = new Set(args.allowedPlayerNames.map((name) => normalizeName(name)).filter(Boolean));
  const requestedNorms = (args.selectedPlayerNames ?? []).map((name) => normalizeName(name)).filter(Boolean);
  const playerNorms = requestedNorms.length
    ? Array.from(new Set(requestedNorms.filter((name) => allowedNorms.has(name))))
    : Array.from(allowedNorms);
  const metrics = args.metrics.filter((metric) => metric.metricName.trim());
  if (!playerNorms.length || !metrics.length) return [];
  const metricNames = metrics.map((metric) => metric.metricName);
  const metricUnits = metrics.map((metric) => metric.metricUnit);
  const result = await getDbPool().query<{
    player_name: string;
    date_short: string;
    date_time_utc: string | null;
    test_type: string;
    metric_name: string;
    metric_unit: string;
    value: number;
    samples: number;
  }>(
    `SELECT
       player_name,
       date_short,
       MAX(date_time_utc)::text AS date_time_utc,
       test_type,
       metric_name,
       metric_unit,
       AVG(value)::double precision AS value,
       COUNT(DISTINCT test_id)::integer AS samples
     FROM force_plate_metric_rows
     WHERE organization_id = $1
       AND school_code = $2
       AND player_name_norm = ANY($3::text[])
       AND point_type = 'average'
       AND ($4::date IS NULL OR date_time_utc >= $4::date)
       AND ($5::date IS NULL OR date_time_utc < $5::date + INTERVAL '1 day')
       AND (metric_name, metric_unit) IN (
         SELECT metric_name, metric_unit
         FROM unnest($6::text[], $7::text[]) AS selected(metric_name, metric_unit)
       )
       AND ($8::text IS NULL OR test_type = $8)
     GROUP BY player_name, date_short, test_type, metric_name, metric_unit
     ORDER BY MAX(date_time_utc) ASC NULLS LAST, date_short ASC, player_name ASC, test_type ASC, metric_name ASC, metric_unit ASC`,
    [
      args.organizationId,
      args.schoolCode,
      playerNorms,
      args.startDate || null,
      args.endDate || null,
      metricNames,
      metricUnits,
      args.testType && args.testType !== 'All' ? args.testType : null,
    ]
  );
  return result.rows.map((row) => ({
    playerName: row.player_name,
    date: row.date_short,
    dateTime: row.date_time_utc ?? '',
    testType: row.test_type,
    metricName: row.metric_name,
    metricUnit: row.metric_unit,
    value: Number(row.value),
    samples: Number(row.samples),
  }));
}

export type ForcePlatePercentileRow = {
  playerName: string;
  testId: string;
  dateTime: string;
  dateShort: string;
  testType: string;
  value: number;
};

export async function loadForcePlatePercentileRows(args: {
  organizationId: number;
  schoolCode: string;
  allowedPlayerNames: string[];
  metricName: string;
  metricUnit: string;
  testType?: string;
  startDate?: string;
  endDate?: string;
}): Promise<ForcePlatePercentileRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureForcePlateNeonTables();
  const playerNorms = Array.from(new Set(args.allowedPlayerNames.map((name) => normalizeName(name)).filter(Boolean)));
  if (!playerNorms.length || !args.metricName.trim()) return [];
  const result = await getDbPool().query<{
    player_name: string;
    test_id: string;
    date_time_utc: string | null;
    date_short: string;
    test_type: string;
    value: number;
  }>(
    `SELECT player_name, test_id, date_time_utc::text, date_short, test_type, value
     FROM force_plate_metric_rows
     WHERE organization_id = $1
       AND school_code = $2
       AND player_name_norm = ANY($3::text[])
       AND point_type = 'average'
       AND metric_name = $4
       AND metric_unit = $5
       AND ($6::text IS NULL OR test_type = $6)
       AND ($7::date IS NULL OR date_time_utc >= $7::date)
       AND ($8::date IS NULL OR date_time_utc < $8::date + INTERVAL '1 day')
     ORDER BY player_name_norm, date_time_utc ASC NULLS FIRST, date_short ASC, test_id ASC`,
    [
      args.organizationId,
      args.schoolCode,
      playerNorms,
      args.metricName,
      args.metricUnit,
      args.testType && args.testType !== 'All' ? args.testType : null,
      args.startDate || null,
      args.endDate || null,
    ]
  );
  return result.rows.map((row) => ({
    playerName: row.player_name,
    testId: row.test_id,
    dateTime: row.date_time_utc ?? '',
    dateShort: row.date_short,
    testType: row.test_type,
    value: Number(row.value),
  }));
}

export async function loadForcePlateLeaderboardAggregates(args: {
  organizationId: number;
  schoolCode: string;
  allowedPlayerNames: string[];
  startDate?: string;
  endDate?: string;
}): Promise<{ rows: ForcePlateLeaderboardAggregate[]; minDate: string; maxDate: string }> {
  if (!isDatabaseConfigured()) return { rows: [], minDate: '', maxDate: '' };
  await ensureForcePlateNeonTables();
  const playerNorms = Array.from(new Set(args.allowedPlayerNames.map((name) => normalizeName(name)).filter(Boolean)));
  if (!playerNorms.length) return { rows: [], minDate: '', maxDate: '' };
  const result = await getDbPool().query<{
    player_name: string;
    test_type: string;
    metric_name: string;
    metric_unit: string;
    average_value: number;
    maximum_value: number;
    samples: number;
    min_date: string | null;
    max_date: string | null;
  }>(
    `SELECT
       player_name,
       test_type,
       metric_name,
       metric_unit,
       AVG(value)::double precision AS average_value,
       MAX(value)::double precision AS maximum_value,
       COUNT(*)::integer AS samples,
       MIN(date_time_utc)::text AS min_date,
       MAX(date_time_utc)::text AS max_date
     FROM force_plate_metric_rows
     WHERE organization_id = $1
       AND school_code = $2
       AND player_name_norm = ANY($3::text[])
       AND point_type = 'average'
       AND ($4::date IS NULL OR date_time_utc >= $4::date)
       AND ($5::date IS NULL OR date_time_utc < $5::date + INTERVAL '1 day')
     GROUP BY player_name, test_type, metric_name, metric_unit
     ORDER BY player_name, test_type, metric_name, metric_unit`,
    [args.organizationId, args.schoolCode, playerNorms, args.startDate || null, args.endDate || null]
  );
  const dates = result.rows.flatMap((row) => [row.min_date, row.max_date]).filter((value): value is string => Boolean(value)).sort();
  return {
    rows: result.rows.map((row) => ({
      playerName: row.player_name,
      testType: row.test_type,
      metricName: row.metric_name,
      metricUnit: row.metric_unit,
      averageValue: Number(row.average_value),
      maximumValue: Number(row.maximum_value),
      samples: Number(row.samples),
    })),
    minDate: dates[0]?.slice(0, 10) ?? '',
    maxDate: dates[dates.length - 1]?.slice(0, 10) ?? '',
  };
}

export async function getForcePlateSyncState(args: {
  organizationId: number;
  schoolCode: string;
}): Promise<ForcePlateSyncState | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureForcePlateNeonTables();
  const pool = getDbPool();
  const result = await pool.query<{
    organization_id: number;
    school_code: string;
    last_synced_at: string | null;
    last_run_started_at: string | null;
    last_run_completed_at: string | null;
    last_status: string | null;
    last_error: string | null;
    player_cursor: number | null;
  }>(
    `
      SELECT organization_id, school_code, last_synced_at, last_run_started_at, last_run_completed_at, last_status, last_error, player_cursor
      FROM force_plate_sync_state
      WHERE organization_id = $1 AND school_code = $2
      LIMIT 1
    `,
    [args.organizationId, args.schoolCode]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    schoolCode: row.school_code,
    lastSyncedAt: row.last_synced_at,
    lastRunStartedAt: row.last_run_started_at,
    lastRunCompletedAt: row.last_run_completed_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    playerCursor: Math.max(0, Number(row.player_cursor ?? 0)),
  };
}

export async function markForcePlateSyncRunStarted(args: {
  organizationId: number;
  schoolCode: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await ensureForcePlateNeonTables();
  const pool = getDbPool();
  await pool.query(
    `
      INSERT INTO force_plate_sync_state (
        organization_id, school_code, last_run_started_at, last_status, last_error, updated_at
      )
      VALUES ($1, $2, NOW(), 'running', NULL, NOW())
      ON CONFLICT (organization_id, school_code)
      DO UPDATE SET
        last_run_started_at = NOW(),
        last_status = 'running',
        last_error = NULL,
        updated_at = NOW()
    `,
    [args.organizationId, args.schoolCode]
  );
}

export async function markForcePlateSyncRunCompleted(args: {
  organizationId: number;
  schoolCode: string;
  ok: boolean;
  syncedAt?: string | null;
  error?: string | null;
  nextPlayerCursor?: number;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await ensureForcePlateNeonTables();
  const pool = getDbPool();
  const syncedAt = args.syncedAt ? new Date(args.syncedAt) : null;
  await pool.query(
    `
      INSERT INTO force_plate_sync_state (
        organization_id, school_code, last_synced_at, last_run_started_at, last_run_completed_at, last_status, last_error, player_cursor, updated_at
      )
      VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, $6, NOW())
      ON CONFLICT (organization_id, school_code)
      DO UPDATE SET
        last_synced_at = CASE WHEN $4 = 'ok' THEN COALESCE($3, force_plate_sync_state.last_synced_at) ELSE force_plate_sync_state.last_synced_at END,
        last_run_completed_at = NOW(),
        last_status = $4,
        last_error = $5,
        player_cursor = CASE WHEN $6 IS NULL THEN force_plate_sync_state.player_cursor ELSE $6 END,
        updated_at = NOW()
    `,
    [
      args.organizationId,
      args.schoolCode,
      syncedAt,
      args.ok ? 'ok' : 'error',
      args.ok ? null : String(args.error ?? 'Sync failed.'),
      Number.isFinite(Number(args.nextPlayerCursor)) ? Math.max(0, Number(args.nextPlayerCursor)) : 0,
    ]
  );
}

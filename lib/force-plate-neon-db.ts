import { getDbPool, isDatabaseConfigured } from './auth-db';
import type { ValdMetricRow, ValdPlayerSnapshot, ValdSnapshot } from './vald-forceplates';

declare global {
  var __pcuForcePlateNeonReady: boolean | undefined;
}

function normalizeName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ');
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
  const norms = playerRows.map((row) => row.player_name_norm);
  const metricsResult = await pool.query<{
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
  }>(
    `
      SELECT player_name_norm, test_id, trial_id, date_short, date_time_utc, test_type, metric_id, metric_name, metric_unit, value, point_type, point_label
      FROM force_plate_metric_rows
      WHERE organization_id = $1
        AND school_code = $2
        AND player_name_norm = ANY($3::text[])
      ORDER BY COALESCE(date_time_utc, NOW()) ASC, test_id ASC
    `,
    [args.organizationId, args.schoolCode, norms]
  );
  const byPlayer = new Map<string, ValdMetricRow[]>();
  for (const row of metricsResult.rows) {
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

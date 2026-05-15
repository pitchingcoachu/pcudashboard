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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, school_code)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_force_plate_metric_rows_player
    ON force_plate_metric_rows (organization_id, school_code, player_name_norm);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_force_plate_metric_rows_test
    ON force_plate_metric_rows (organization_id, school_code, test_id);
  `);
  global.__pcuForcePlateNeonReady = true;
}

export type ForcePlateSyncState = {
  organizationId: number;
  schoolCode: string;
  lastSyncedAt: string | null;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureForcePlateNeonTables();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const player of args.snapshot.players) {
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
      for (const [testId, test] of testsById.entries()) {
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

      const syncedTestIds = Array.from(testsById.keys());
      if (syncedTestIds.length) {
        await client.query(
          `
            DELETE FROM force_plate_metric_rows
            WHERE organization_id = $1
              AND school_code = $2
              AND test_id = ANY($3::text[])
          `,
          [args.organizationId, args.schoolCode, syncedTestIds]
        );
      }
      for (const row of player.metricRows) {
        await client.query(
          `
            INSERT INTO force_plate_metric_rows (
              organization_id, school_code, test_id, trial_id, player_name_norm, player_name, date_short, date_time_utc,
              test_type, metric_id, metric_name, metric_unit, value, point_type, point_label, updated_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
          `,
          [
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
            row.pointLabel ?? null,
          ]
        );
      }
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to write force plate tables.' };
  } finally {
    client.release();
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
  }>(
    `
      SELECT organization_id, school_code, last_synced_at, last_run_started_at, last_run_completed_at, last_status, last_error
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
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await ensureForcePlateNeonTables();
  const pool = getDbPool();
  const syncedAt = args.syncedAt ? new Date(args.syncedAt) : null;
  await pool.query(
    `
      INSERT INTO force_plate_sync_state (
        organization_id, school_code, last_synced_at, last_run_started_at, last_run_completed_at, last_status, last_error, updated_at
      )
      VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, NOW())
      ON CONFLICT (organization_id, school_code)
      DO UPDATE SET
        last_synced_at = CASE WHEN $4 = 'ok' THEN COALESCE($3, force_plate_sync_state.last_synced_at) ELSE force_plate_sync_state.last_synced_at END,
        last_run_completed_at = NOW(),
        last_status = $4,
        last_error = $5,
        updated_at = NOW()
    `,
    [
      args.organizationId,
      args.schoolCode,
      syncedAt,
      args.ok ? 'ok' : 'error',
      args.ok ? null : String(args.error ?? 'Sync failed.'),
    ]
  );
}

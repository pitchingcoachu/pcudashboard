import { getDbPool } from './auth-db';

export type TrackmanSyncStatus = {
  lastRequestedAt: string | null;
  lastCompletedAt: string | null;
  status: 'idle' | 'queued' | 'success' | 'failed';
  cooldownUntil: string | null;
};

const TRACKMAN_SYNC_COOLDOWN_MINUTES = 15;

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await getDbPool().query(`
        CREATE TABLE IF NOT EXISTS trackman_sync_status (
          school_code TEXT PRIMARY KEY, last_requested_at TIMESTAMPTZ, last_completed_at TIMESTAMPTZ,
          last_status TEXT NOT NULL DEFAULT 'idle', last_requested_by_user_id INTEGER,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    })().catch((error) => { schemaReady = null; throw error; });
  }
  return schemaReady;
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/^﻿/, '').trim();
}

function schoolCode(value: string): string {
  const normalized = cleanText(value).toUpperCase();
  if (!/^[A-Z0-9_-]{2,32}$/.test(normalized)) {
    throw new Error('Select a specific school before syncing TrackMan data.');
  }
  return normalized;
}

export async function getTrackmanSyncStatus(schoolCodeValue: string): Promise<TrackmanSyncStatus> {
  const school = schoolCode(schoolCodeValue);
  await ensureSchema();
  const result = await getDbPool().query(`
    SELECT last_requested_at::text, last_completed_at::text,
      COALESCE(last_status, 'idle') AS last_status,
      CASE WHEN last_requested_at > NOW() - INTERVAL '${TRACKMAN_SYNC_COOLDOWN_MINUTES} minutes'
        THEN (last_requested_at + INTERVAL '${TRACKMAN_SYNC_COOLDOWN_MINUTES} minutes')::text ELSE NULL END AS cooldown_until
    FROM (SELECT $1::text AS school_code) base
    LEFT JOIN trackman_sync_status USING (school_code)
  `, [school]);
  const row = result.rows[0] ?? {};
  const status = ['queued', 'success', 'failed'].includes(row.last_status) ? row.last_status : 'idle';
  return {
    lastRequestedAt: row.last_requested_at ?? null,
    lastCompletedAt: row.last_completed_at ?? null,
    status,
    cooldownUntil: row.cooldown_until ?? null,
  };
}

export async function reserveTrackmanSync(schoolCodeValue: string, userId: number): Promise<TrackmanSyncStatus | null> {
  const school = schoolCode(schoolCodeValue);
  await ensureSchema();
  const result = await getDbPool().query(`
    INSERT INTO trackman_sync_status (school_code, last_requested_at, last_status, last_requested_by_user_id, updated_at)
    VALUES ($1, NOW(), 'queued', $2, NOW())
    ON CONFLICT (school_code) DO UPDATE SET
      last_requested_at=NOW(), last_status='queued', last_requested_by_user_id=EXCLUDED.last_requested_by_user_id, updated_at=NOW()
    WHERE trackman_sync_status.last_requested_at IS NULL
       OR trackman_sync_status.last_requested_at <= NOW() - INTERVAL '${TRACKMAN_SYNC_COOLDOWN_MINUTES} minutes'
    RETURNING last_requested_at::text
  `, [school, userId || null]);
  if (!result.rows[0]) return null;
  return getTrackmanSyncStatus(school);
}

export async function releaseTrackmanSyncReservation(schoolCodeValue: string): Promise<void> {
  const school = schoolCode(schoolCodeValue);
  await ensureSchema();
  await getDbPool().query(`
    UPDATE trackman_sync_status SET last_requested_at=NULL, last_status='failed', updated_at=NOW() WHERE school_code=$1
  `, [school]);
}

/**
 * Called by a TrackMan workflow's final step when it finishes (success or
 * failure), so status reporting is truthful instead of stuck at "queued"
 * forever. The recency guard on last_requested_at is what tells a manual
 * click apart from a routine cron run: a manual sync's last_requested_at is
 * always fresh (set the moment the button was clicked, minutes before this
 * fires), while a cron-triggered run's last_requested_at is either null or a
 * stale timestamp from an unrelated earlier manual click. Only a fresh
 * request returns a requestedByUserId to notify -- cron completions still
 * update last_status/last_completed_at via the second unconditional UPDATE,
 * they just don't notify anyone.
 */
export async function completeTrackmanSync(
  schoolCodeValue: string,
  status: 'success' | 'failed'
): Promise<{ requestedByUserId: number | null }> {
  const school = schoolCode(schoolCodeValue);
  await ensureSchema();
  const pool = getDbPool();
  const recent = await pool.query(`
    UPDATE trackman_sync_status SET last_completed_at=NOW(), last_status=$2, updated_at=NOW()
    WHERE school_code=$1 AND last_requested_at > NOW() - INTERVAL '2 hours'
    RETURNING last_requested_by_user_id
  `, [school, status]);
  if (recent.rows[0]) {
    const userId = recent.rows[0].last_requested_by_user_id;
    return { requestedByUserId: userId ? Number(userId) : null };
  }
  await pool.query(`
    INSERT INTO trackman_sync_status (school_code, last_completed_at, last_status, updated_at)
    VALUES ($1, NOW(), $2, NOW())
    ON CONFLICT (school_code) DO UPDATE SET last_completed_at=NOW(), last_status=EXCLUDED.last_status, updated_at=NOW()
  `, [school, status]);
  return { requestedByUserId: null };
}

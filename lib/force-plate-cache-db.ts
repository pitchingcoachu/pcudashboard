import { getDbPool, isDatabaseConfigured } from './auth-db';
import type { ValdSnapshot } from './vald-forceplates';

declare global {
  var __pcuForcePlateCacheTableReady: boolean | undefined;
}

async function ensureForcePlateCacheTable(): Promise<void> {
  if (global.__pcuForcePlateCacheTableReady) return;
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS force_plate_snapshots (
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, school_code)
    );
  `);
  global.__pcuForcePlateCacheTableReady = true;
}

export async function saveForcePlateSnapshot(args: {
  organizationId: number;
  schoolCode: string;
  snapshot: ValdSnapshot;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureForcePlateCacheTable();
  const pool = getDbPool();
  await pool.query(
    `
      INSERT INTO force_plate_snapshots (organization_id, school_code, snapshot, synced_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (organization_id, school_code)
      DO UPDATE SET snapshot = EXCLUDED.snapshot, synced_at = NOW()
    `,
    [args.organizationId, args.schoolCode, JSON.stringify(args.snapshot)]
  );
  return { ok: true };
}

export async function loadForcePlateSnapshot(args: {
  organizationId: number;
  schoolCode: string;
}): Promise<{
  snapshot: ValdSnapshot | null;
  syncedAt: string | null;
}> {
  if (!isDatabaseConfigured()) return { snapshot: null, syncedAt: null };
  await ensureForcePlateCacheTable();
  const pool = getDbPool();
  const result = await pool.query<{ snapshot: unknown; synced_at: string }>(
    `
      SELECT snapshot, synced_at
      FROM force_plate_snapshots
      WHERE organization_id = $1 AND school_code = $2
      LIMIT 1
    `,
    [args.organizationId, args.schoolCode]
  );
  const row = result.rows[0];
  if (!row) return { snapshot: null, syncedAt: null };
  const parsed = row.snapshot as ValdSnapshot;
  return { snapshot: parsed, syncedAt: row.synced_at };
}

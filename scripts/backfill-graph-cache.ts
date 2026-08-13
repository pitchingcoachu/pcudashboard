/**
 * One-time backfill: reads existing raw rows from biomechanics_single_pitch_points,
 * downsamples each pitch to GRAPH_CACHE_TARGET_POINTS using LTTB, writes to
 * biomechanics_graph_cache. Safe to run multiple times (upserts).
 *
 * Usage:
 *   npx tsx scripts/backfill-graph-cache.ts
 *
 * After the cache is fully populated and verified, you can delete the raw table:
 *   DROP TABLE biomechanics_single_pitch_points;
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '.env.local') });
import { Pool } from 'pg';
import { lttbDownsample, GRAPH_CACHE_TARGET_POINTS } from '../lib/biomechanics-storage';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
const organizationId = Number(process.env.AXIOFORCE_ORGANIZATION_ID ?? 1);
const schoolCode = String(process.env.AXIOFORCE_SCHOOL_CODE ?? 'PCU').trim().toUpperCase();
const fileNameContains = String(process.env.AXIOFORCE_BACKFILL_FILE_CONTAINS ?? '').trim();

function inferPlayerName(sourceFileName: string): string | null {
  const normalized = sourceFileName.replace(/\\/g, '/');
  const folder = normalized.split('/').slice(-2, -1)[0] ?? '';
  const parts = folder.split(/[_-]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const [last, ...firstParts] = parts;
  return `${firstParts.join(' ')} ${last}`.trim() || null;
}

function normalizeName(value: string | null): string | null {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return normalized || null;
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS biomechanics_graph_cache (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      source_file_hash TEXT NOT NULL,
      point_index INTEGER NOT NULL,
      t DOUBLE PRECISION NOT NULL,
      fx DOUBLE PRECISION,
      fy DOUBLE PRECISION,
      fz DOUBLE PRECISION,
      mx DOUBLE PRECISION,
      my DOUBLE PRECISION,
      mz DOUBLE PRECISION,
      phase_name TEXT,
      device_id TEXT,
      position_id TEXT,
      r2_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, school_code, source_file_hash, point_index)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_biomech_graph_cache_scope
    ON biomechanics_graph_cache (organization_id, school_code, source_file_hash, point_index ASC)
  `);
  await pool.query(`ALTER TABLE biomechanics_graph_cache ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE biomechanics_graph_cache ADD COLUMN IF NOT EXISTS pitcher_name TEXT`);
  await pool.query(`ALTER TABLE biomechanics_graph_cache ADD COLUMN IF NOT EXISTS pitcher_name_norm TEXT`);
  console.log('Table ready.');
}

async function main() {
  await ensureTable();
  console.log('Fetching distinct pitch hashes from raw table...');
  const hashResult = await pool.query<{ organization_id: number; school_code: string; source_file_hash: string; source_file_name: string }>(
    `SELECT DISTINCT p.organization_id, p.school_code, p.source_file_hash, u.source_file_name
     FROM biomechanics_single_pitch_points p
     JOIN biomechanics_uploads u
       ON u.organization_id = p.organization_id
      AND u.school_code = p.school_code
      AND u.source_file_hash = p.source_file_hash
      AND u.upload_kind = 'single_pitch'
     WHERE p.organization_id = $1
       AND p.school_code = $2
       AND ($3 = '' OR u.source_file_name ILIKE '%' || $3 || '%')
       AND NOT EXISTS (
         SELECT 1 FROM biomechanics_graph_cache c
         WHERE c.organization_id = p.organization_id
           AND c.school_code = p.school_code
           AND c.source_file_hash = p.source_file_hash
       )
     ORDER BY p.school_code, p.source_file_hash`,
    [organizationId, schoolCode, fileNameContains]
  );
  const hashes = hashResult.rows;
  console.log(`Found ${hashes.length} pitches to backfill.`);

  let done = 0;
  let skipped = 0;

  for (const { organization_id, school_code, source_file_hash, source_file_name } of hashes) {
    let attempts = 0;
    while (attempts < 3) {
      try {
        attempts += 1;
    // Skip if already cached.
    const existing = await pool.query(
      `SELECT 1 FROM biomechanics_graph_cache
       WHERE organization_id = $1 AND school_code = $2 AND source_file_hash = $3
       LIMIT 1`,
      [organization_id, school_code, source_file_hash]
    );
    if (existing.rows.length > 0) {
      skipped += 1;
      if (skipped % 50 === 0) console.log(`  Skipped ${skipped} already-cached pitches...`);
      break;
    }

    // Fetch raw points for this pitch.
    const rawResult = await pool.query<{
      t: number; fx: number | null; fy: number | null; fz: number | null;
      mx: number | null; my: number | null; mz: number | null;
      row_json: Record<string, unknown> | null;
      point_index: number; captured_at: string | null; pitcher_name: string | null; pitcher_name_norm: string | null;
    }>(
      `SELECT t, fx, fy, fz, mx, my, mz, row_json, point_index, captured_at, pitcher_name, pitcher_name_norm
       FROM biomechanics_single_pitch_points
       WHERE organization_id = $1 AND school_code = $2 AND source_file_hash = $3
       ORDER BY point_index ASC`,
      [organization_id, school_code, source_file_hash]
    );

    const rawPoints = rawResult.rows.map((row) => {
      const rj = (row.row_json ?? {}) as Record<string, unknown>;
      const phaseName = (rj['Phase Name'] ?? rj['Phase'] ?? null) as string | null;
      const deviceId = (rj['Device Id'] ?? rj['Device'] ?? null) as string | null;
      const positionId = (rj['Position Id'] ?? rj['Position'] ?? null) as string | null;
      // Use row_json unix ms time if available (more precise), else db t value.
      const rawTimeMs = rj['Time (Unix ms)'] ? Number(rj['Time (Unix ms)']) : null;
      const t = (rawTimeMs !== null && Number.isFinite(rawTimeMs)) ? rawTimeMs : Number(row.t ?? 0);
      return {
        t,
        fx: row.fx ?? null,
        fy: row.fy ?? null,
        fz: row.fz ?? null,
        mx: row.mx ?? null,
        my: row.my ?? null,
        mz: row.mz ?? null,
        phase_name: phaseName,
        device_id: deviceId,
        position_id: positionId,
      };
    });

    if (rawPoints.length === 0) break;

    const graphPoints = lttbDownsample(rawPoints, GRAPH_CACHE_TARGET_POINTS);
    const firstRaw = rawResult.rows[0];
    const capturedAt = firstRaw?.captured_at ?? null;
    const pitcherName = firstRaw?.pitcher_name ?? inferPlayerName(source_file_name);
    const pitcherNameNorm = firstRaw?.pitcher_name_norm ?? normalizeName(pitcherName);

    // Insert in chunks.
    const chunkSize = 100;
    for (let start = 0; start < graphPoints.length; start += chunkSize) {
      const chunk = graphPoints.slice(start, start + chunkSize);
      const values: unknown[] = [];
      const rowsSql: string[] = [];
      for (let i = 0; i < chunk.length; i += 1) {
        const p = chunk[i]!;
        const idx = start + i;
        const base = values.length;
        rowsSql.push(
          `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14},$${base+15},$${base+16},$${base+17})`
        );
        values.push(
          organization_id, school_code, source_file_hash, idx,
          p.t, p.fx, p.fy, p.fz, p.mx, p.my, p.mz,
          p.phase_name, p.device_id, p.position_id,
          capturedAt, pitcherName, pitcherNameNorm
        );
      }
      await pool.query(
        `INSERT INTO biomechanics_graph_cache
           (organization_id, school_code, source_file_hash, point_index,
            t, fx, fy, fz, mx, my, mz, phase_name, device_id, position_id,
            captured_at, pitcher_name, pitcher_name_norm)
         VALUES ${rowsSql.join(',')}
         ON CONFLICT (organization_id, school_code, source_file_hash, point_index)
         DO UPDATE SET
           t = EXCLUDED.t, fx = EXCLUDED.fx, fy = EXCLUDED.fy, fz = EXCLUDED.fz,
           mx = EXCLUDED.mx, my = EXCLUDED.my, mz = EXCLUDED.mz,
           phase_name = EXCLUDED.phase_name, device_id = EXCLUDED.device_id,
           position_id = EXCLUDED.position_id, captured_at = EXCLUDED.captured_at,
           pitcher_name = EXCLUDED.pitcher_name, pitcher_name_norm = EXCLUDED.pitcher_name_norm`,
        values
      );
    }

    done += 1;
    if (done % 10 === 0) console.log(`  Cached ${done}/${hashes.length - skipped} pitches...`);
    break; // success — exit retry loop
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempts >= 3) {
          console.error(`  Failed after 3 attempts for ${source_file_hash}: ${msg}`);
          break;
        }
        console.log(`  Connection error, retrying (attempt ${attempts}/3)...`);
        await new Promise((r) => setTimeout(r, 2000 * attempts));
      }
    } // end retry loop
  }

  const rollupTable = await pool.query<{ table_name: string | null }>(
    `SELECT to_regclass('public.biomechanics_query_rollups')::text AS table_name`
  );
  if (rollupTable.rows[0]?.table_name) {
    await pool.query(
      `DELETE FROM biomechanics_query_rollups WHERE organization_id = $1 AND school_code = $2`,
      [organizationId, schoolCode]
    );
    console.log('Cleared stale biomechanics response caches.');
  }

  console.log(`Done. Cached: ${done}, Already existed: ${skipped}, Total: ${hashes.length}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

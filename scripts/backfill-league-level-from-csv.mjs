import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Pool } from 'pg';

dotenv.config({ path: '.env.local' });
dotenv.config();

const DEFAULT_DATA_DIR = '/Users/jaredgaynor/Documents/GitHub/leaguewide/data/v3';
const dataDir = process.argv.find((arg) => arg.startsWith('--data-dir='))?.slice('--data-dir='.length) || DEFAULT_DATA_DIR;
const dryRun = process.argv.includes('--dry-run');
const verifyOnly = process.argv.includes('--verify-only');
const terminateRollupLock = process.argv.includes('--terminate-rollup-lock');
const startDate = process.argv.find((arg) => arg.startsWith('--start-date='))?.slice('--start-date='.length) || '2026-01-23';
const endDate = process.argv.find((arg) => arg.startsWith('--end-date='))?.slice('--end-date='.length) || null;
const schoolCode = process.argv.find((arg) => arg.startsWith('--school-code='))?.slice('--school-code='.length) || 'LEAGUE';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || process.env.DASHBOARD_DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not configured.');
  process.exit(1);
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizeColumn(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function csvDataYear(filePath) {
  const bn = path.basename(filePath);
  const wrapped = bn.match(/^(?:v3|practice)_\d{4}_\d{2}_\d{2}_(\d{4})/i);
  if (wrapped) return Number(wrapped[1]);
  const leading = bn.match(/^(\d{4})/);
  return leading ? Number(leading[1]) : NaN;
}

function variantKey(filePath) {
  return path.basename(filePath).toLowerCase()
    .replace(/\.csv$/i, '')
    .replace(/_unverified$/i, '')
    .replace(/_verified$/i, '')
    .replace(/-unverified$/i, '')
    .replace(/-verified$/i, '');
}

function shouldKeepFile(filePath) {
  const bn = path.basename(filePath).toLowerCase();
  if (!bn.endsWith('.csv')) return false;
  if (['private', 'playerpositioning', 'json'].some((token) => bn.includes(token))) return false;
  const year = csvDataYear(filePath);
  return Number.isFinite(year) && year >= 2026;
}

async function walk(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function preferVerified(files) {
  const groups = new Map();
  for (const file of files) {
    const key = variantKey(file);
    const group = groups.get(key) || [];
    group.push(file);
    groups.set(key, group);
  }
  const selected = [];
  for (const group of groups.values()) {
    const verified = group.filter((file) => !/unverified/i.test(path.basename(file)));
    selected.push(...(verified.length ? verified : group));
  }
  return selected.sort();
}

async function collectLevelsFromFile(filePath, levelsByPitchUid) {
  const stream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let pitchUidIdx = -1;
  let levelIdx = -1;
  let rows = 0;
  let usable = 0;
  let conflicts = 0;

  for await (const line of rl) {
    if (header === null) {
      header = parseCsvLine(line.replace(/^\uFEFF/, ''));
      const normalized = header.map(normalizeColumn);
      pitchUidIdx = normalized.indexOf('pitchuid');
      levelIdx = normalized.indexOf('level');
      if (pitchUidIdx < 0 || levelIdx < 0) break;
      continue;
    }
    rows += 1;
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    const pitchUid = String(values[pitchUidIdx] || '').trim();
    const level = String(values[levelIdx] || '').trim().toUpperCase();
    if (!pitchUid || !level) continue;
    usable += 1;
    const key = pitchUid.toLowerCase();
    const existing = levelsByPitchUid.get(key);
    if (existing && existing !== level) {
      conflicts += 1;
      continue;
    }
    levelsByPitchUid.set(key, level);
  }

  return { rows, usable, conflicts };
}

async function insertBatch(client, rows) {
  if (!rows.length) return;
  const values = [];
  const placeholders = [];
  rows.forEach((row, idx) => {
    const base = idx * 2;
    placeholders.push(`($${base + 1}, $${base + 2})`);
    values.push(row.pitchUid, row.level);
  });
  await client.query(
    `INSERT INTO tmp_pitchuid_level (pitchuid_norm, level)
     VALUES ${placeholders.join(',')}
     ON CONFLICT (pitchuid_norm) DO UPDATE SET level = EXCLUDED.level`,
    values,
  );
}

async function main() {
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    if (terminateRollupLock) {
      const holders = await client.query(
        `SELECT a.pid, a.state, a.application_name, LEFT(a.query, 220) AS query
         FROM pg_locks l
         JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE l.locktype = 'advisory'
           AND l.classid = 0
           AND l.objid = 910001
           AND l.granted = true
           AND a.pid <> pg_backend_pid()`,
      );
      console.log('Terminating league rollup advisory lock holders:', holders.rows);
      for (const row of holders.rows) {
        await client.query('SELECT pg_terminate_backend($1)', [row.pid]);
      }
      return;
    }

    const dateParams = [schoolCode, startDate];
    let dateSql = 'school_code = $1 AND session_date >= $2::date';
    if (endDate) {
      dateParams.push(endDate);
      dateSql += ` AND session_date <= $${dateParams.length}::date`;
    }

    const before = await client.query(
      `SELECT COUNT(*)::int AS blank_rows, COUNT(DISTINCT LOWER(TRIM(pitchuid)))::int AS blank_pitchuids
       FROM public.pitch_events
       WHERE ${dateSql}
         AND NULLIF(TRIM(COALESCE(pitchuid, '')), '') IS NOT NULL
         AND NULLIF(TRIM(COALESCE(level, '')), '') IS NULL`,
      dateParams,
    );
    console.log('Blank level before:', before.rows[0]);

    if (verifyOnly) {
      const rawLevels = await client.query(
        `SELECT COALESCE(NULLIF(UPPER(TRIM(level)), ''), '<blank>') AS level, COUNT(*)::int AS rows
         FROM public.pitch_events
         WHERE ${dateSql}
         GROUP BY 1
         ORDER BY rows DESC, level`,
        dateParams,
      );
      const rollupLevels = await client.query(
        `SELECT COALESCE(NULLIF(UPPER(TRIM(level_bucket)), ''), '<blank>') AS level, COUNT(*)::int AS rows, COALESCE(SUM(pitches), 0)::bigint AS pitches
         FROM public.pitch_events_daily_rollup_league
         WHERE school_code = $1
         GROUP BY 1
         ORDER BY pitches DESC, rows DESC, level`,
        [schoolCode],
      );
      const splitRollupLevels = await client.query(
        `SELECT COALESCE(NULLIF(UPPER(TRIM(level_bucket)), ''), '<blank>') AS level, COUNT(*)::int AS rows, COALESCE(SUM(pitches), 0)::bigint AS pitches
         FROM public.pitch_events_daily_rollup_league_split
         WHERE school_code = $1
         GROUP BY 1
         ORDER BY pitches DESC, rows DESC, level`,
        [schoolCode],
      );
      const rollupSchools = await client.query(
        `SELECT school_code, COUNT(*)::int AS rows, COALESCE(SUM(pitches), 0)::bigint AS pitches
         FROM public.pitch_events_daily_rollup_league
         GROUP BY 1
         ORDER BY pitches DESC, rows DESC, school_code
         LIMIT 20`,
      );
      const constraints = await client.query(
        `SELECT t.relname AS table_name, c.conname, pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname IN ('pitch_events_daily_rollup_league', 'pitch_events_daily_rollup_league_split', 'pitch_events_game_rollup_league')
           AND c.contype = 'p'
         ORDER BY t.relname`,
      );
      const lockHolders = await client.query(
        `SELECT a.pid, a.state, a.application_name, a.wait_event_type, a.wait_event,
                now() - a.query_start AS query_age,
                LEFT(a.query, 220) AS query
         FROM pg_locks l
         JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE l.locktype = 'advisory'
           AND l.classid = 0
           AND l.objid = 910001
           AND l.granted = true
         ORDER BY a.query_start NULLS LAST`,
      );
      console.log('Raw level distribution:', rawLevels.rows);
      console.log('Daily rollup level distribution:', rollupLevels.rows);
      console.log('Split rollup level distribution:', splitRollupLevels.rows);
      console.log('Daily rollup schools:', rollupSchools.rows);
      console.log('Rollup primary keys:', constraints.rows);
      console.log('League rollup advisory lock holders:', lockHolders.rows);
      return;
    }

    const sourceRows = await client.query(
      `SELECT DISTINCT source_file
       FROM public.pitch_events
       WHERE ${dateSql}
         AND NULLIF(TRIM(COALESCE(pitchuid, '')), '') IS NOT NULL
         AND NULLIF(TRIM(COALESCE(level, '')), '') IS NULL
         AND source_file IS NOT NULL`,
      dateParams,
    );
    const wantedBasenames = new Set(sourceRows.rows.map((row) => path.basename(String(row.source_file || ''))).filter(Boolean));

    const allFiles = (await walk(dataDir)).filter(shouldKeepFile);
    const filteredFiles = wantedBasenames.size
      ? allFiles.filter((file) => wantedBasenames.has(path.basename(file)))
      : allFiles;
    const selectedFiles = preferVerified(filteredFiles);
    console.log('CSV files considered:', { all: allFiles.length, matchingDatabaseFiles: filteredFiles.length, selected: selectedFiles.length });

    const levelsByPitchUid = new Map();
    let parsedRows = 0;
    let usableRows = 0;
    let conflicts = 0;
    let processed = 0;
    for (const file of selectedFiles) {
      const stats = await collectLevelsFromFile(file, levelsByPitchUid);
      parsedRows += stats.rows;
      usableRows += stats.usable;
      conflicts += stats.conflicts;
      processed += 1;
      if (processed % 250 === 0) {
        console.log(`Parsed ${processed}/${selectedFiles.length} files; level pitchuids=${levelsByPitchUid.size}`);
      }
    }
    console.log('CSV level map:', { parsedRows, usableRows, pitchuidsWithLevel: levelsByPitchUid.size, conflicts });

    if (dryRun) {
      console.log('Dry run only; no database rows updated.');
      return;
    }

    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE tmp_pitchuid_level (pitchuid_norm text PRIMARY KEY, level text NOT NULL) ON COMMIT DROP');
    const batch = [];
    for (const [pitchUid, level] of levelsByPitchUid.entries()) {
      batch.push({ pitchUid, level });
      if (batch.length >= 5000) {
        await insertBatch(client, batch);
        batch.length = 0;
      }
    }
    await insertBatch(client, batch);

    const updateParams = [schoolCode, startDate];
    let updateDateSql = 'pe.school_code = $1 AND pe.session_date >= $2::date';
    if (endDate) {
      updateParams.push(endDate);
      updateDateSql += ` AND pe.session_date <= $${updateParams.length}::date`;
    }
    const updated = await client.query(
      `UPDATE public.pitch_events pe
       SET level = m.level
       FROM tmp_pitchuid_level m
       WHERE ${updateDateSql}
         AND LOWER(TRIM(pe.pitchuid)) = m.pitchuid_norm
         AND NULLIF(TRIM(COALESCE(pe.level, '')), '') IS NULL`,
      updateParams,
    );
    await client.query('COMMIT');
    console.log('Rows updated:', updated.rowCount);

    const after = await client.query(
      `SELECT COALESCE(NULLIF(UPPER(TRIM(level)), ''), '<blank>') AS level, COUNT(*)::int AS rows
       FROM public.pitch_events
       WHERE ${dateSql}
       GROUP BY 1
       ORDER BY rows DESC, level`,
      dateParams,
    );
    console.log('Level distribution after:', after.rows);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

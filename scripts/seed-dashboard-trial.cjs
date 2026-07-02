const { Pool } = require('pg');

const SOURCE_SCHOOL = 'LSU';
const TARGET_SCHOOL = 'TRIAL';
const TEAM_LABEL = 'Dashboard Trial';
const TEAM_MARKERS = new Set(['LSU_TIG', 'LSU_FAL', 'LSU']);
const TARGET_TEAM_CODE = 'TRIAL';

const FIRST_NAMES = [
  'Mason', 'Carter', 'Nolan', 'Evan', 'Cole', 'Logan', 'Wyatt', 'Caleb', 'Parker', 'Owen',
  'Grant', 'Reid', 'Blake', 'Luke', 'Tyler', 'Ryan', 'Austin', 'Dylan', 'Gavin', 'Chase',
  'Brody', 'Eli', 'Jack', 'Connor', 'Miles', 'Hayden', 'Brady', 'Cooper', 'Camden', 'Jace',
];
const LAST_NAMES = [
  'Anderson', 'Bennett', 'Carver', 'Collins', 'Dawson', 'Foster', 'Graham', 'Hayes', 'Hudson', 'Lawson',
  'Miller', 'Palmer', 'Reed', 'Sullivan', 'Turner', 'Walker', 'West', 'Wright', 'Young', 'Brooks',
  'Bryant', 'Campbell', 'Coleman', 'Ellis', 'Hughes', 'Morgan', 'Phillips', 'Russell', 'Stewart', 'Warren',
];

function qident(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fakeName(index) {
  return `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]}`;
}

async function getColumns(client, tableName) {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [tableName]
  );
  return result.rows.map((row) => row.column_name);
}

async function insertNameMap(client) {
  const names = await client.query(
    `
      SELECT DISTINCT name
      FROM (
        SELECT pitcher AS name FROM pitch_events WHERE school_code = $1
        UNION ALL
        SELECT batter AS name FROM pitch_events WHERE school_code = $1
        UNION ALL
        SELECT catcher AS name FROM pitch_events WHERE school_code = $1
      ) names
      WHERE TRIM(COALESCE(name, '')) <> ''
      ORDER BY name
    `,
    [SOURCE_SCHOOL]
  );

  await client.query(`
    CREATE TEMP TABLE trial_name_map (
      real_norm TEXT PRIMARY KEY,
      fake_name TEXT NOT NULL,
      fake_norm TEXT NOT NULL
    ) ON COMMIT DROP
  `);

  let index = 0;
  for (const row of names.rows) {
    const realNorm = normalizeName(row.name);
    if (!realNorm) continue;
    const mappedName = fakeName(index);
    await client.query(
      `
        INSERT INTO trial_name_map (real_norm, fake_name, fake_norm)
        VALUES ($1, $2, $3)
        ON CONFLICT (real_norm) DO NOTHING
      `,
      [realNorm, mappedName, normalizeName(mappedName)]
    );
    index += 1;
  }
  return index;
}

async function clonePitchDataFiles(client) {
  await client.query(
    `
      INSERT INTO pitch_data_files (school_code, source_file, file_checksum, file_mtime, row_count, loaded_at)
      SELECT
        $1,
        'dashboard-trial/' || source_file,
        'trial-' || COALESCE(file_checksum, source_file),
        file_mtime,
        row_count,
        NOW()
      FROM pitch_data_files
      WHERE school_code = $2
      ON CONFLICT (school_code, source_file)
      DO UPDATE SET
        row_count = EXCLUDED.row_count,
        loaded_at = NOW()
    `,
    [TARGET_SCHOOL, SOURCE_SCHOOL]
  );
}

function pitchEventsExpression(column) {
  const raw = `pe.${qident(column)}`;
  if (column === 'school_code') return `'${TARGET_SCHOOL}'`;
  if (column === 'file_id') {
    return `(SELECT f.file_id FROM pitch_data_files f WHERE f.school_code = '${TARGET_SCHOOL}' AND f.source_file = 'dashboard-trial/' || pe.source_file LIMIT 1)`;
  }
  if (column === 'source_file') return `'dashboard-trial/' || pe.source_file`;
  if (column === 'pitcher' || column === 'batter' || column === 'catcher') {
    return `COALESCE((SELECT m.fake_name FROM trial_name_map m WHERE m.real_norm = regexp_replace(lower(COALESCE(NULLIF(TRIM(${raw}), ''), '')), '[^a-z0-9]', '', 'g')), ${raw})`;
  }
  if (column === 'email') return 'NULL';
  if (['pitcherteam', 'batterteam', 'catcherteam', 'hometeam', 'awayteam'].includes(column)) {
    const normalized = `regexp_replace(UPPER(COALESCE(NULLIF(TRIM(${raw}), ''), '')), '[^A-Z0-9_]', '', 'g')`;
    const markersSql = Array.from(TEAM_MARKERS).map((value) => `'${value}'`).join(', ');
    return `CASE WHEN ${normalized} IN (${markersSql}) THEN '${TARGET_TEAM_CODE}' ELSE ${raw} END`;
  }
  if (column === 'videoclip' || column === 'videoclip2' || column === 'videoclip3') return 'NULL';
  if (column === 'created_at') return 'NOW()';
  return raw;
}

async function clonePitchEvents(client) {
  const columns = (await getColumns(client, 'pitch_events')).filter((column) => column !== 'id');
  const columnSql = columns.map(qident).join(', ');
  const selectSql = columns.map(pitchEventsExpression).join(', ');
  await client.query(
    `
      INSERT INTO pitch_events (${columnSql})
      SELECT ${selectSql}
      FROM pitch_events pe
      WHERE pe.school_code = $1
    `,
    [SOURCE_SCHOOL]
  );
}

function heatmapExpression(tableAlias, column) {
  const raw = `${tableAlias}.${qident(column)}`;
  if (column === 'school_code') return `'${TARGET_SCHOOL}'`;
  if (column === 'pitcher_norm' || column === 'batter_norm') {
    return `COALESCE((SELECT m.fake_norm FROM trial_name_map m WHERE m.real_norm = ${raw}), ${raw})`;
  }
  if (column === 'pitcher_team_code' || column === 'batter_team_code') {
    const normalized = `regexp_replace(UPPER(COALESCE(NULLIF(TRIM(${raw}), ''), '')), '[^A-Z0-9_]', '', 'g')`;
    const markersSql = Array.from(TEAM_MARKERS).map((value) => `'${value}'`).join(', ');
    return `CASE WHEN ${normalized} IN (${markersSql}) THEN '${TARGET_TEAM_CODE}' ELSE ${raw} END`;
  }
  if (column === 'updated_at') return 'NOW()';
  return raw;
}

async function cloneHeatmapTable(client, tableName) {
  const columns = await getColumns(client, tableName);
  const columnSql = columns.map(qident).join(', ');
  const selectSql = columns.map((column) => heatmapExpression('src', column)).join(', ');
  await client.query(
    `
      INSERT INTO ${qident(tableName)} (${columnSql})
      SELECT ${selectSql}
      FROM ${qident(tableName)} src
      WHERE src.school_code = $1
      ON CONFLICT DO NOTHING
    `,
    [SOURCE_SCHOOL]
  );
}

async function refreshTrialVideoMap(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS video_map_trial (
      LIKE video_map_lsu INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING STORAGE INCLUDING COMMENTS
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS video_map_trial_pkey
    ON video_map_trial (session_id, camera_slot, play_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS video_map_trial_school_play_idx
    ON video_map_trial (school_code, play_id, camera_slot)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS video_map_trial_play_slot_idx
    ON video_map_trial (play_id, camera_slot)
    WHERE cloudinary_url IS NOT NULL AND trim(cloudinary_url) <> ''
  `);
  await client.query(`DELETE FROM video_map_trial WHERE school_code = $1`, [TARGET_SCHOOL]);
  await client.query(
    `
      INSERT INTO video_map_trial (
        session_id,
        play_id,
        camera_slot,
        camera_name,
        camera_target,
        video_type,
        azure_blob,
        azure_md5,
        cloudinary_url,
        cloudinary_public_id,
        uploaded_at,
        school_code
      )
      SELECT
        vm.session_id,
        vm.play_id,
        vm.camera_slot,
        vm.camera_name,
        vm.camera_target,
        vm.video_type,
        vm.azure_blob,
        vm.azure_md5,
        vm.cloudinary_url,
        vm.cloudinary_public_id,
        vm.uploaded_at,
        $1 AS school_code
      FROM video_map_lsu vm
      WHERE vm.play_id IS NOT NULL
        AND trim(vm.play_id) <> ''
        AND vm.cloudinary_url IS NOT NULL
        AND trim(vm.cloudinary_url) <> ''
        AND EXISTS (
          SELECT 1
          FROM pitch_events pe
          WHERE pe.school_code = $1
            AND lower(trim(COALESCE(pe.playid::text, ''))) = lower(trim(vm.play_id))
        )
      ON CONFLICT (session_id, camera_slot, play_id)
      DO UPDATE SET
        camera_name = EXCLUDED.camera_name,
        camera_target = EXCLUDED.camera_target,
        video_type = EXCLUDED.video_type,
        azure_blob = EXCLUDED.azure_blob,
        azure_md5 = EXCLUDED.azure_md5,
        cloudinary_url = EXCLUDED.cloudinary_url,
        cloudinary_public_id = EXCLUDED.cloudinary_public_id,
        uploaded_at = EXCLUDED.uploaded_at,
        school_code = EXCLUDED.school_code
    `,
    [TARGET_SCHOOL]
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO schools (school_code)
        VALUES ($1)
        ON CONFLICT (school_code) DO NOTHING
      `,
      [TARGET_SCHOOL]
    );
    await client.query(
      `
        INSERT INTO school_product_access (school_code, dashboard, programming, client_management, updated_at, updated_by_user_id)
        VALUES ($1, TRUE, TRUE, TRUE, NOW(), NULL)
        ON CONFLICT (school_code)
        DO UPDATE SET dashboard = TRUE, programming = TRUE, client_management = TRUE, updated_at = NOW()
      `,
      [TARGET_SCHOOL]
    );

    await client.query(`DELETE FROM pitch_events WHERE school_code = $1`, [TARGET_SCHOOL]);
    await client.query(`DELETE FROM pitch_events_daily_rollup_league WHERE school_code = $1`, [TARGET_SCHOOL]);
    await client.query(`DELETE FROM pitch_events_daily_rollup_league_split WHERE school_code = $1`, [TARGET_SCHOOL]);
    await client.query(`DELETE FROM pitching_heatmap_daily_bins WHERE school_code = $1`, [TARGET_SCHOOL]);
    await client.query(`DELETE FROM hitting_heatmap_daily_bins WHERE school_code = $1`, [TARGET_SCHOOL]);
    await client.query(`DELETE FROM dashboard_filters_snapshot WHERE school_code = $1`, [TARGET_SCHOOL]);
    await client.query(`DELETE FROM dashboard_home_trends_snapshot WHERE school_code = $1`, [TARGET_SCHOOL]);
    await client.query(`DELETE FROM pitch_data_files WHERE school_code = $1`, [TARGET_SCHOOL]);

    const mappedNames = await insertNameMap(client);
    await clonePitchDataFiles(client);
    await clonePitchEvents(client);
    await cloneHeatmapTable(client, 'pitching_heatmap_daily_bins');
    await cloneHeatmapTable(client, 'hitting_heatmap_daily_bins');
    await refreshTrialVideoMap(client);

    const summary = await client.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM pitch_events WHERE school_code = $1) AS pitches,
          (SELECT COUNT(*)::int FROM pitch_data_files WHERE school_code = $1) AS files,
          (SELECT COUNT(*)::int FROM pitching_heatmap_daily_bins WHERE school_code = $1) AS pitching_bins,
          (SELECT COUNT(*)::int FROM hitting_heatmap_daily_bins WHERE school_code = $1) AS hitting_bins,
          (SELECT COUNT(*)::int FROM video_map_trial WHERE school_code = $1) AS video_rows
      `,
      [TARGET_SCHOOL]
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({ schoolCode: TARGET_SCHOOL, mappedNames, ...summary.rows[0] }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
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

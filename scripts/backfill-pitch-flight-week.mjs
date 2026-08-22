import { config } from 'dotenv';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });
const connectionString = process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not configured.');

const { Pool } = pg;
const pool = new Pool({ connectionString });

function csvFiles(root) {
  const out = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...csvFiles(path));
    else if (name.toLowerCase().endsWith('.csv')) out.push(path);
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field.trim());
      field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function numberOrNull(value) {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value) {
  const text = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function minusDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function normalizedPitchType(value) {
  const raw = String(value ?? '').trim();
  const token = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['fastball', 'fourseam', 'fourseamfastball', '4seamfastball', 'ff', 'fa'].includes(token)) return 'Fastball';
  if (['sinker', 'oneseamfastball', 'twoseam', 'twoseamfastball', 'si', 'ft'].includes(token)) return 'Sinker';
  if (['cutter', 'fc'].includes(token)) return 'Cutter';
  if (['slider', 'sl'].includes(token)) return 'Slider';
  if (['sweeper', 'st'].includes(token)) return 'Sweeper';
  if (['curveball', 'knucklecurve', 'cu', 'kc'].includes(token)) return 'Curveball';
  if (['changeup', 'ch'].includes(token)) return 'ChangeUp';
  if (['splitter', 'splitfinger', 'splitfingerfastball', 'sp', 'fs'].includes(token)) return 'Splitter';
  if (['knuckleball', 'kn'].includes(token)) return 'Knuckleball';
  return raw || 'Undefined';
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.pitch_flight_backfill (
      id BIGSERIAL PRIMARY KEY,
      school_code TEXT NOT NULL,
      session_date DATE NOT NULL,
      pitch_uid TEXT NOT NULL,
      source_file TEXT NOT NULL,
      pitcher TEXT,
      pitcher_throws TEXT,
      pitcher_team TEXT,
      batter TEXT,
      batter_side TEXT,
      pitch_type TEXT NOT NULL,
      session_type TEXT,
      ball_type TEXT,
      pitch_call TEXT,
      balls INTEGER,
      strikes INTEGER,
      velocity DOUBLE PRECISION,
      spin_rate DOUBLE PRECISION,
      ivb DOUBLE PRECISION,
      hb DOUBLE PRECISION,
      release_height DOUBLE PRECISION,
      release_side DOUBLE PRECISION,
      extension DOUBLE PRECISION,
      plate_height DOUBLE PRECISION,
      plate_side DOUBLE PRECISION,
      zone_time DOUBLE PRECISION,
      x0 DOUBLE PRECISION,
      y0 DOUBLE PRECISION,
      z0 DOUBLE PRECISION,
      vx0 DOUBLE PRECISION,
      vy0 DOUBLE PRECISION,
      vz0 DOUBLE PRECISION,
      ax0 DOUBLE PRECISION,
      ay0 DOUBLE PRECISION,
      az0 DOUBLE PRECISION,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (school_code, pitch_uid)
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS pitch_flight_backfill_school_date_idx ON public.pitch_flight_backfill (school_code, session_date DESC)`);
}

const SQL_NUMBER = (column) => `(regexp_match(COALESCE(${column}::text, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision`;

async function backfillDatabaseSchools(client) {
  const schoolsResult = await client.query(`SELECT DISTINCT school_code FROM public.pitch_events WHERE NULLIF(TRIM(school_code), '') IS NOT NULL ORDER BY school_code`);
  const results = [];
  for (const { school_code: schoolCode } of schoolsResult.rows) {
    const latestResult = await client.query(`
      SELECT "Date"::text AS latest_date
      FROM public.pitch_data
      WHERE school_code = $1
        AND ${SQL_NUMBER('"ZoneTime"')} BETWEEN 0.2 AND 0.9
        AND ${SQL_NUMBER('"vx0"')} IS NOT NULL AND ${SQL_NUMBER('"vy0"')} IS NOT NULL AND ${SQL_NUMBER('"vz0"')} IS NOT NULL
        AND ${SQL_NUMBER('"ax0"')} IS NOT NULL AND ${SQL_NUMBER('"ay0"')} IS NOT NULL AND ${SQL_NUMBER('"az0"')} IS NOT NULL
      ORDER BY "Date" DESC LIMIT 1
    `, [schoolCode]);
    const latestDate = latestResult.rows[0]?.latest_date;
    if (!latestDate) {
      results.push({ schoolCode, latestDate: null, rows: 0 });
      continue;
    }
    const cutoff = minusDays(latestDate, 6);
    const pitchToken = `regexp_replace(lower(COALESCE(NULLIF(TRIM("TaggedPitchType"), ''), NULLIF(TRIM("AutoPitchType"), ''), '')), '[^a-z0-9]', '', 'g')`;
    const inserted = await client.query(`
      INSERT INTO public.pitch_flight_backfill (
        school_code, session_date, pitch_uid, source_file, pitcher, pitcher_throws, pitcher_team, batter,
        batter_side, pitch_type, session_type, ball_type, pitch_call, balls, strikes, velocity, spin_rate,
        ivb, hb, release_height, release_side, extension, plate_height, plate_side, zone_time,
        x0, y0, z0, vx0, vy0, vz0, ax0, ay0, az0
      )
      SELECT
        $1, "Date", BTRIM("PitchUID"), 'pitch_data', NULLIF(TRIM("Pitcher"), ''), NULLIF(TRIM("PitcherThrows"), ''),
        NULLIF(TRIM("PitcherTeam"), ''), NULLIF(TRIM("Batter"), ''), NULLIF(TRIM("BatterSide"), ''),
        CASE
          WHEN ${pitchToken} IN ('fastball','fourseam','fourseamfastball','4seamfastball','ff','fa') THEN 'Fastball'
          WHEN ${pitchToken} IN ('sinker','oneseamfastball','twoseam','twoseamfastball','si','ft') THEN 'Sinker'
          WHEN ${pitchToken} IN ('cutter','fc') THEN 'Cutter'
          WHEN ${pitchToken} IN ('slider','sl') THEN 'Slider'
          WHEN ${pitchToken} IN ('sweeper','st') THEN 'Sweeper'
          WHEN ${pitchToken} IN ('curveball','knucklecurve','cu','kc') THEN 'Curveball'
          WHEN ${pitchToken} IN ('changeup','ch') THEN 'ChangeUp'
          WHEN ${pitchToken} IN ('splitter','splitfinger','splitfingerfastball','sp','fs') THEN 'Splitter'
          WHEN ${pitchToken} IN ('knuckleball','kn') THEN 'Knuckleball'
          ELSE COALESCE(NULLIF(TRIM("TaggedPitchType"), ''), NULLIF(TRIM("AutoPitchType"), ''), 'Undefined') END,
        NULLIF(TRIM("SessionType"), ''), 'Baseball', NULLIF(TRIM("PitchCall"), ''),
        ${SQL_NUMBER('"Balls"')}::int, ${SQL_NUMBER('"Strikes"')}::int, ${SQL_NUMBER('"RelSpeed"')}, ${SQL_NUMBER('"SpinRate"')},
        ${SQL_NUMBER('"InducedVertBreak"')}, ${SQL_NUMBER('"HorzBreak"')}, ${SQL_NUMBER('"RelHeight"')}, ${SQL_NUMBER('"RelSide"')},
        ${SQL_NUMBER('"Extension"')}, ${SQL_NUMBER('"PlateLocHeight"')}, ${SQL_NUMBER('"PlateLocSide"')}, ${SQL_NUMBER('"ZoneTime"')},
        ${SQL_NUMBER('"x0"')}, ${SQL_NUMBER('"y0"')}, ${SQL_NUMBER('"z0"')}, ${SQL_NUMBER('"vx0"')}, ${SQL_NUMBER('"vy0"')},
        ${SQL_NUMBER('"vz0"')}, ${SQL_NUMBER('"ax0"')}, ${SQL_NUMBER('"ay0"')}, ${SQL_NUMBER('"az0"')}
      FROM public.pitch_data
      WHERE school_code = $1 AND "Date" BETWEEN $2::date AND $3::date
        AND NULLIF(BTRIM("PitchUID"), '') IS NOT NULL
        AND ${SQL_NUMBER('"ZoneTime"')} BETWEEN 0.2 AND 0.9
        AND ${SQL_NUMBER('"vx0"')} IS NOT NULL AND ${SQL_NUMBER('"vy0"')} IS NOT NULL AND ${SQL_NUMBER('"vz0"')} IS NOT NULL
        AND ${SQL_NUMBER('"ax0"')} IS NOT NULL AND ${SQL_NUMBER('"ay0"')} IS NOT NULL AND ${SQL_NUMBER('"az0"')} IS NOT NULL
      ON CONFLICT (school_code, pitch_uid) DO NOTHING
    `, [schoolCode, cutoff, latestDate]);
    results.push({ schoolCode, latestDate, cutoff, rows: inserted.rowCount || 0 });
  }
  return results;
}

async function main() {
  const roots = [resolve(process.cwd(), 'trackman files')];
  const rootCsv = resolve(process.cwd(), '20260526-SargentsStad-1_unverified.csv');
  const files = [...roots.flatMap(csvFiles), rootCsv];
  const parsed = [];
  for (const path of files) {
    for (const row of parseCsv(readFileSync(path, 'utf8'))) {
      const date = isoDate(row.Date);
      const pitchUid = String(row.PitchUID ?? '').trim();
      const required = ['ZoneTime', 'x0', 'y0', 'z0', 'vx0', 'vy0', 'vz0', 'ax0', 'ay0', 'az0'];
      if (!date || !pitchUid || required.some((key) => numberOrNull(row[key]) === null)) continue;
      parsed.push({ row, date, path });
    }
  }
  const latestDate = parsed.map((item) => item.date).sort().at(-1);
  if (!latestDate) throw new Error('No complete TrackMan trajectories found.');
  const latestByPitcher = new Map();
  for (const item of parsed) {
    const pitcher = String(item.row.Pitcher ?? '').trim().toLowerCase() || 'unknown';
    if (!latestByPitcher.has(pitcher) || item.date > latestByPitcher.get(pitcher)) latestByPitcher.set(pitcher, item.date);
  }
  const selected = parsed.filter((item) => {
    const pitcher = String(item.row.Pitcher ?? '').trim().toLowerCase() || 'unknown';
    const pitcherLatest = latestByPitcher.get(pitcher);
    return item.date >= minusDays(pitcherLatest, 6) && item.date <= pitcherLatest;
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureSchema(client);
    // Database-backed sources are synchronized by lib/pitch-flight-sync.ts.
    // This script is intentionally limited to local TrackMan CSVs.
    const databaseSites = [];
    for (const { row, date, path } of selected) {
      const values = [
        'PCU', date, String(row.PitchUID).trim(), basename(path), String(row.Pitcher ?? '').trim() || null,
        String(row.PitcherThrows ?? '').trim() || null, String(row.PitcherTeam ?? '').trim() || null,
        String(row.Batter ?? '').trim() || null, String(row.BatterSide ?? '').trim() || null,
        normalizedPitchType(row.TaggedPitchType || row.AutoPitchType),
        String(row.PitchSession || row.SessionType || row.PracticeType || '').trim() || null,
        String(row.CustomLabel || 'Baseball').trim() || 'Baseball', String(row.PitchCall ?? '').trim() || null,
        numberOrNull(row.Balls), numberOrNull(row.Strikes), numberOrNull(row.RelSpeed), numberOrNull(row.SpinRate),
        numberOrNull(row.InducedVertBreak), numberOrNull(row.HorzBreak), numberOrNull(row.RelHeight),
        numberOrNull(row.RelSide), numberOrNull(row.Extension), numberOrNull(row.PlateLocHeight),
        numberOrNull(row.PlateLocSide), numberOrNull(row.ZoneTime), numberOrNull(row.x0), numberOrNull(row.y0),
        numberOrNull(row.z0), numberOrNull(row.vx0), numberOrNull(row.vy0), numberOrNull(row.vz0),
        numberOrNull(row.ax0), numberOrNull(row.ay0), numberOrNull(row.az0),
      ];
      await client.query(`
        INSERT INTO public.pitch_flight_backfill (
          school_code, session_date, pitch_uid, source_file, pitcher, pitcher_throws, pitcher_team, batter,
          batter_side, pitch_type, session_type, ball_type, pitch_call, balls, strikes, velocity, spin_rate,
          ivb, hb, release_height, release_side, extension, plate_height, plate_side, zone_time,
          x0, y0, z0, vx0, vy0, vz0, ax0, ay0, az0
        ) VALUES (${values.map((_, index) => `$${index + 1}`).join(',')})
        ON CONFLICT (school_code, pitch_uid) DO UPDATE SET
          session_date = EXCLUDED.session_date, source_file = EXCLUDED.source_file, pitcher = EXCLUDED.pitcher,
          pitcher_throws = EXCLUDED.pitcher_throws, pitcher_team = EXCLUDED.pitcher_team, batter = EXCLUDED.batter,
          batter_side = EXCLUDED.batter_side, pitch_type = EXCLUDED.pitch_type, session_type = EXCLUDED.session_type,
          ball_type = EXCLUDED.ball_type, pitch_call = EXCLUDED.pitch_call, balls = EXCLUDED.balls,
          strikes = EXCLUDED.strikes, velocity = EXCLUDED.velocity, spin_rate = EXCLUDED.spin_rate,
          ivb = EXCLUDED.ivb, hb = EXCLUDED.hb, release_height = EXCLUDED.release_height,
          release_side = EXCLUDED.release_side, extension = EXCLUDED.extension, plate_height = EXCLUDED.plate_height,
          plate_side = EXCLUDED.plate_side, zone_time = EXCLUDED.zone_time, x0 = EXCLUDED.x0, y0 = EXCLUDED.y0,
          z0 = EXCLUDED.z0, vx0 = EXCLUDED.vx0, vy0 = EXCLUDED.vy0, vz0 = EXCLUDED.vz0,
          ax0 = EXCLUDED.ax0, ay0 = EXCLUDED.ay0, az0 = EXCLUDED.az0, imported_at = NOW()
      `, values);
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ databaseSites, localCsv: { schoolCode: 'PCU', latestDate, strategy: 'latest-seven-days-per-pitcher', files: files.length, insertedOrUpdated: selected.length } }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

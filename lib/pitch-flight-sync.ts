import type { PoolClient } from 'pg';
import { getDbPool } from './auth-db';

const NUMBER_PATTERN = '[-+]?[0-9]*\\.?[0-9]+';

// First-run floor for syncPitchEvents' incremental date filter -- see the
// comment at its call site. Not meant to be moved forward over time; once
// the sync has run once for a school, its own MAX(session_date) takes over.
const PITCH_EVENTS_SYNC_FLOOR_DATE = '2026-05-01';

function textNumber(column: string): string {
  return `(regexp_match(COALESCE(${column}::text, ''), '${NUMBER_PATTERN}'))[1]::double precision`;
}

function pitchTypeSql(tagged: string, automatic: string): string {
  const token = `regexp_replace(lower(COALESCE(NULLIF(TRIM(${tagged}), ''), NULLIF(TRIM(${automatic}), ''), '')), '[^a-z0-9]', '', 'g')`;
  return `CASE
    WHEN ${token} IN ('fastball','fourseam','fourseamfastball','4seamfastball','ff','fa') THEN 'Fastball'
    WHEN ${token} IN ('sinker','oneseamfastball','twoseam','twoseamfastball','si','ft') THEN 'Sinker'
    WHEN ${token} IN ('cutter','fc') THEN 'Cutter'
    WHEN ${token} IN ('slider','sl') THEN 'Slider'
    WHEN ${token} IN ('sweeper','st') THEN 'Sweeper'
    WHEN ${token} IN ('curveball','knucklecurve','cu','kc') THEN 'Curveball'
    WHEN ${token} IN ('changeup','ch') THEN 'ChangeUp'
    WHEN ${token} IN ('splitter','splitfinger','splitfingerfastball','sp','fs') THEN 'Splitter'
    WHEN ${token} IN ('knuckleball','kn') THEN 'Knuckleball'
    ELSE COALESCE(NULLIF(TRIM(${tagged}), ''), NULLIF(TRIM(${automatic}), ''), 'Undefined') END`;
}

export async function ensurePitchFlightSchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.pitch_flight_backfill (
      id BIGSERIAL PRIMARY KEY, school_code TEXT NOT NULL, session_date DATE NOT NULL,
      pitch_uid TEXT NOT NULL, source_file TEXT NOT NULL, pitcher TEXT, pitcher_throws TEXT,
      pitcher_team TEXT, batter TEXT, batter_side TEXT, pitch_type TEXT NOT NULL,
      session_type TEXT, ball_type TEXT, pitch_call TEXT, balls INTEGER, strikes INTEGER,
      velocity DOUBLE PRECISION, spin_rate DOUBLE PRECISION, ivb DOUBLE PRECISION, hb DOUBLE PRECISION,
      release_height DOUBLE PRECISION, release_side DOUBLE PRECISION, extension DOUBLE PRECISION,
      plate_height DOUBLE PRECISION, plate_side DOUBLE PRECISION, zone_time DOUBLE PRECISION,
      x0 DOUBLE PRECISION, y0 DOUBLE PRECISION, z0 DOUBLE PRECISION,
      vx0 DOUBLE PRECISION, vy0 DOUBLE PRECISION, vz0 DOUBLE PRECISION,
      ax0 DOUBLE PRECISION, ay0 DOUBLE PRECISION, az0 DOUBLE PRECISION,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (school_code, pitch_uid)
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS pitch_flight_backfill_school_date_idx ON public.pitch_flight_backfill (school_code, session_date DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS pitch_flight_backfill_school_pitcher_date_idx ON public.pitch_flight_backfill (school_code, pitcher, session_date DESC)`);
}

const UPSERT_UPDATE = `
  session_date = EXCLUDED.session_date, source_file = EXCLUDED.source_file,
  pitcher = EXCLUDED.pitcher, pitcher_throws = EXCLUDED.pitcher_throws,
  pitcher_team = EXCLUDED.pitcher_team, batter = EXCLUDED.batter, batter_side = EXCLUDED.batter_side,
  pitch_type = EXCLUDED.pitch_type, session_type = EXCLUDED.session_type,
  ball_type = EXCLUDED.ball_type, pitch_call = EXCLUDED.pitch_call,
  balls = EXCLUDED.balls, strikes = EXCLUDED.strikes, velocity = EXCLUDED.velocity,
  spin_rate = EXCLUDED.spin_rate, ivb = EXCLUDED.ivb, hb = EXCLUDED.hb,
  release_height = EXCLUDED.release_height, release_side = EXCLUDED.release_side,
  extension = EXCLUDED.extension, plate_height = EXCLUDED.plate_height,
  plate_side = EXCLUDED.plate_side, zone_time = EXCLUDED.zone_time,
  x0 = EXCLUDED.x0, y0 = EXCLUDED.y0, z0 = EXCLUDED.z0,
  vx0 = EXCLUDED.vx0, vy0 = EXCLUDED.vy0, vz0 = EXCLUDED.vz0,
  ax0 = EXCLUDED.ax0, ay0 = EXCLUDED.ay0, az0 = EXCLUDED.az0, imported_at = NOW()
`;

const INSERT_COLUMNS = `
  school_code, session_date, pitch_uid, source_file, pitcher, pitcher_throws, pitcher_team,
  batter, batter_side, pitch_type, session_type, ball_type, pitch_call, balls, strikes,
  velocity, spin_rate, ivb, hb, release_height, release_side, extension, plate_height,
  plate_side, zone_time, x0, y0, z0, vx0, vy0, vz0, ax0, ay0, az0
`;

async function syncPitchData(client: PoolClient, incremental: boolean): Promise<number> {
  const type = pitchTypeSql('pd."TaggedPitchType"', 'pd."AutoPitchType"');
  const incrementalWhere = incremental
    ? `AND NOT EXISTS (
        SELECT 1 FROM public.pitch_flight_backfill bf
        WHERE bf.school_code = pd.school_code AND bf.pitch_uid = TRIM(pd."PitchUID")
      )
      AND pd."Date" >= COALESCE((SELECT MAX(session_date) FROM public.pitch_flight_backfill WHERE source_file = 'pitch_data'), DATE '1900-01-01')`
    : '';
  const result = await client.query(`
    WITH complete AS (
      SELECT pd.*, pd.ctid AS source_ctid, ${type} AS pitch_type
      FROM public.pitch_data pd
      WHERE NULLIF(TRIM(pd.school_code), '') IS NOT NULL
        AND pd."Date" IS NOT NULL AND NULLIF(TRIM(pd."PitchUID"), '') IS NOT NULL
        AND ${textNumber('pd."ZoneTime"')} BETWEEN 0.2 AND 0.9
        AND ${textNumber('pd."x0"')} IS NOT NULL AND ${textNumber('pd."y0"')} IS NOT NULL AND ${textNumber('pd."z0"')} IS NOT NULL
        AND ${textNumber('pd."vx0"')} IS NOT NULL AND ${textNumber('pd."vy0"')} IS NOT NULL AND ${textNumber('pd."vz0"')} IS NOT NULL
        AND ${textNumber('pd."ax0"')} IS NOT NULL AND ${textNumber('pd."ay0"')} IS NOT NULL AND ${textNumber('pd."az0"')} IS NOT NULL
        ${incrementalWhere}
    ), deduped AS (
      SELECT DISTINCT ON (school_code, TRIM("PitchUID")) *
      FROM complete
      ORDER BY school_code, TRIM("PitchUID"), "Date" DESC, source_ctid DESC
    ), eligible AS (
      SELECT deduped.*,
        MAX("Date") OVER (PARTITION BY school_code, lower(TRIM("Pitcher"))) AS pitcher_latest
      FROM deduped
    )
    INSERT INTO public.pitch_flight_backfill (${INSERT_COLUMNS})
    SELECT school_code, "Date", TRIM("PitchUID"), 'pitch_data', NULLIF(TRIM("Pitcher"), ''),
      NULLIF(TRIM("PitcherThrows"), ''), NULLIF(TRIM("PitcherTeam"), ''), NULLIF(TRIM("Batter"), ''),
      NULLIF(TRIM("BatterSide"), ''), pitch_type, NULLIF(TRIM("SessionType"), ''), 'Baseball',
      NULLIF(TRIM("PitchCall"), ''), ${textNumber('"Balls"')}::int, ${textNumber('"Strikes"')}::int,
      ${textNumber('"RelSpeed"')}, ${textNumber('"SpinRate"')}, ${textNumber('"InducedVertBreak"')},
      ${textNumber('"HorzBreak"')}, ${textNumber('"RelHeight"')}, ${textNumber('"RelSide"')},
      ${textNumber('"Extension"')}, ${textNumber('"PlateLocHeight"')}, ${textNumber('"PlateLocSide"')},
      ${textNumber('"ZoneTime"')}, ${textNumber('"x0"')}, ${textNumber('"y0"')}, ${textNumber('"z0"')},
      ${textNumber('"vx0"')}, ${textNumber('"vy0"')}, ${textNumber('"vz0"')},
      ${textNumber('"ax0"')}, ${textNumber('"ay0"')}, ${textNumber('"az0"')}
    FROM eligible
    WHERE "Date" >= pitcher_latest - 6
    ON CONFLICT (school_code, pitch_uid) DO UPDATE SET ${UPSERT_UPDATE}
  `);
  return result.rowCount ?? 0;
}

async function syncVmiV3(client: PoolClient, incremental: boolean): Promise<number> {
  const type = pitchTypeSql('v."TaggedPitchType"', 'v."AutoPitchType"');
  const eventSource = incremental ? 'recent_events' : 'public.pitch_events';
  const recentEventsCte = incremental
    ? `recent_events AS MATERIALIZED (
        SELECT pe.* FROM public.pitch_events pe
        WHERE pe.session_date >= COALESCE(
          (SELECT MAX(session_date) FROM public.pitch_flight_backfill WHERE source_file = 'vmi_v3_data'),
          DATE '1900-01-01'
        )
      ),`
    : '';
  const incrementalWhere = incremental
    ? `AND NOT EXISTS (
        SELECT 1 FROM public.pitch_flight_backfill bf
        WHERE bf.school_code = pe.school_code AND bf.pitch_uid = TRIM(v."PitchUID")
      )`
    : '';
  const result = await client.query(`
    WITH ${recentEventsCte} matched AS (
      SELECT DISTINCT ON (pe.school_code, TRIM(v."PitchUID"))
        pe.school_code, pe.session_date, TRIM(v."PitchUID") AS pitch_uid,
        COALESCE(NULLIF(TRIM(v."Pitcher"), ''), NULLIF(TRIM(pe.pitcher), '')) AS pitcher,
        COALESCE(NULLIF(TRIM(v."PitcherThrows"), ''), NULLIF(TRIM(pe.pitcherthrows), '')) AS pitcher_throws,
        COALESCE(NULLIF(TRIM(v."PitcherTeam"), ''), NULLIF(TRIM(pe.pitcherteam), '')) AS pitcher_team,
        COALESCE(NULLIF(TRIM(v."Batter"), ''), NULLIF(TRIM(pe.batter), '')) AS batter,
        COALESCE(NULLIF(TRIM(v."BatterSide"), ''), NULLIF(TRIM(pe.batterside), '')) AS batter_side,
        ${type} AS pitch_type, COALESCE(NULLIF(TRIM(pe.session_type), ''), NULLIF(TRIM(pe.sessiontype), '')) AS session_type,
        COALESCE(NULLIF(TRIM(pe.customlabel), ''), 'Baseball') AS ball_type,
        COALESCE(NULLIF(TRIM(v."PitchCall"), ''), NULLIF(TRIM(pe.pitchcall), '')) AS pitch_call,
        ${textNumber('v."Balls"')}::int AS balls, ${textNumber('v."Strikes"')}::int AS strikes,
        ${textNumber('v."RelSpeed"')} AS velocity, ${textNumber('v."SpinRate"')} AS spin_rate,
        ${textNumber('v."InducedVertBreak"')} AS ivb, ${textNumber('v."HorzBreak"')} AS hb,
        ${textNumber('v."RelHeight"')} AS release_height, ${textNumber('v."RelSide"')} AS release_side,
        ${textNumber('v."Extension"')} AS extension, ${textNumber('v."PlateLocHeight"')} AS plate_height,
        ${textNumber('v."PlateLocSide"')} AS plate_side, ${textNumber('v."ZoneTime"')} AS zone_time,
        ${textNumber('v."x0"')} AS x0, ${textNumber('v."y0"')} AS y0, ${textNumber('v."z0"')} AS z0,
        ${textNumber('v."vx0"')} AS vx0, ${textNumber('v."vy0"')} AS vy0, ${textNumber('v."vz0"')} AS vz0,
        ${textNumber('v."ax0"')} AS ax0, ${textNumber('v."ay0"')} AS ay0, ${textNumber('v."az0"')} AS az0
      FROM public.vmi_v3_data v
      JOIN ${eventSource} pe ON TRIM(pe.pitchuid) = TRIM(v."PitchUID")
      WHERE NULLIF(TRIM(v."PitchUID"), '') IS NOT NULL AND pe.session_date IS NOT NULL
        AND ${textNumber('v."ZoneTime"')} BETWEEN 0.2 AND 0.9
        AND ${textNumber('v."x0"')} IS NOT NULL AND ${textNumber('v."y0"')} IS NOT NULL AND ${textNumber('v."z0"')} IS NOT NULL
        AND ${textNumber('v."vx0"')} IS NOT NULL AND ${textNumber('v."vy0"')} IS NOT NULL AND ${textNumber('v."vz0"')} IS NOT NULL
        AND ${textNumber('v."ax0"')} IS NOT NULL AND ${textNumber('v."ay0"')} IS NOT NULL AND ${textNumber('v."az0"')} IS NOT NULL
        ${incrementalWhere}
      ORDER BY pe.school_code, TRIM(v."PitchUID"), pe.created_at DESC NULLS LAST, pe.id DESC
    ), recent AS (
      SELECT matched.*, MAX(session_date) OVER (PARTITION BY school_code, lower(TRIM(pitcher))) AS pitcher_latest
      FROM matched
    )
    INSERT INTO public.pitch_flight_backfill (${INSERT_COLUMNS})
    SELECT school_code, session_date, pitch_uid, 'vmi_v3_data', pitcher, pitcher_throws, pitcher_team,
      batter, batter_side, pitch_type, session_type, ball_type, pitch_call, balls, strikes,
      velocity, spin_rate, ivb, hb, release_height, release_side, extension, plate_height, plate_side,
      zone_time, x0, y0, z0, vx0, vy0, vz0, ax0, ay0, az0
    FROM recent WHERE session_date >= pitcher_latest - 6
    ON CONFLICT (school_code, pitch_uid) DO UPDATE SET ${UPSERT_UPDATE}
  `);
  return result.rowCount ?? 0;
}

// pitch_data stopped receiving new rows for every school around Nov 2025;
// the actively-written table since is pitch_events (lowercase columns, no
// quoting needed -- unlike pitch_data's PascalCase quoted columns). Its
// x0/y0/z0/vx0/vy0/vz0/ax0/ay0/az0 columns were only added once the source
// ingestion pipeline (a separate repo per school) started capturing them;
// schools without that fix will simply have those columns NULL here and
// contribute no eligible rows, same as any other missing-data case. There's
// no zone_time-equivalent column on pitch_events -- left NULL, matching
// pitch_flight_backfill's existing nullable column; durationForPitch() in
// the ball-flight API already falls back to solving flight time from
// vy0/ay0 when flightTime is null.
//
// Looped per school_code rather than one cross-school query: pitch_events
// holds 1M+ rows across all schools combined, and at that volume Postgres's
// planner falls back to a sequential scan on the largest date partition
// even with a matching index in place (confirmed via EXPLAIN -- partition
// selectivity, not a missing index), which times out. Scoped to one
// school's rows at a time this is fast and each iteration's failure (e.g.
// one school's data briefly unavailable) doesn't block the others.
async function syncPitchEvents(client: PoolClient, incremental: boolean): Promise<number> {
  const type = pitchTypeSql('pe.taggedpitchtype', "''");
  // On the true first run (no pitch_flight_backfill rows with
  // source_file='pitch_events' yet), the MAX(session_date) subquery below is
  // NULL -- falling back to 1900-01-01 would scan a school's entire
  // pitch_events history. PITCH_EVENTS_SYNC_FLOOR_DATE bounds that first run
  // instead; once any row exists the real MAX(session_date) takes over
  // automatically and this floor stops mattering.
  const floorDateSql = incremental
    ? `COALESCE(
        (SELECT MAX(session_date) FROM public.pitch_flight_backfill WHERE source_file = 'pitch_events' AND school_code = $1),
        DATE '${PITCH_EVENTS_SYNC_FLOOR_DATE}'
      )`
    : `DATE '${PITCH_EVENTS_SYNC_FLOOR_DATE}'`;

  const schoolRows = await client.query<{ school_code: string }>(`
    SELECT DISTINCT school_code
    FROM public.pitch_events
    WHERE NULLIF(TRIM(school_code), '') IS NOT NULL
      AND session_date >= DATE '${PITCH_EVENTS_SYNC_FLOOR_DATE}'
  `);

  let totalRows = 0;
  for (const { school_code: schoolCode } of schoolRows.rows) {
    const incrementalWhere = incremental
      ? `AND NOT EXISTS (
          SELECT 1 FROM public.pitch_flight_backfill bf
          WHERE bf.school_code = pe.school_code AND bf.pitch_uid = TRIM(pe.pitchuid)
        )`
      : '';
    const result = await client.query(`
      WITH complete AS (
        SELECT pe.*, pe.ctid AS source_ctid, ${type} AS pitch_type
        FROM public.pitch_events pe
        WHERE pe.school_code = $1
          AND pe.session_date IS NOT NULL AND NULLIF(TRIM(pe.pitchuid), '') IS NOT NULL
          AND pe.session_date >= ${floorDateSql}
          AND ${textNumber('pe.x0')} IS NOT NULL AND ${textNumber('pe.y0')} IS NOT NULL AND ${textNumber('pe.z0')} IS NOT NULL
          AND ${textNumber('pe.vx0')} IS NOT NULL AND ${textNumber('pe.vy0')} IS NOT NULL AND ${textNumber('pe.vz0')} IS NOT NULL
          AND ${textNumber('pe.ax0')} IS NOT NULL AND ${textNumber('pe.ay0')} IS NOT NULL AND ${textNumber('pe.az0')} IS NOT NULL
          ${incrementalWhere}
      ), deduped AS (
        SELECT DISTINCT ON (school_code, TRIM(pitchuid)) *
        FROM complete
        ORDER BY school_code, TRIM(pitchuid), session_date DESC, source_ctid DESC
      ), eligible AS (
        SELECT deduped.*,
          MAX(session_date) OVER (PARTITION BY school_code, lower(TRIM(pitcher))) AS pitcher_latest
        FROM deduped
      )
      INSERT INTO public.pitch_flight_backfill (${INSERT_COLUMNS})
      SELECT school_code, session_date, TRIM(pitchuid), 'pitch_events', NULLIF(TRIM(pitcher), ''),
        NULLIF(TRIM(pitcherthrows), ''), NULLIF(TRIM(pitcherteam), ''), NULLIF(TRIM(batter), ''),
        NULLIF(TRIM(batterside), ''), pitch_type, NULLIF(TRIM(sessiontype), ''), 'Baseball',
        NULLIF(TRIM(pitchcall), ''), ${textNumber('balls')}::int, ${textNumber('strikes')}::int,
        ${textNumber('relspeed')}, ${textNumber('spinrate')}, ${textNumber('inducedvertbreak')},
        ${textNumber('horzbreak')}, ${textNumber('relheight')}, ${textNumber('relside')},
        ${textNumber('extension')}, ${textNumber('platelocheight')}, ${textNumber('platelocside')},
        NULL, ${textNumber('x0')}, ${textNumber('y0')}, ${textNumber('z0')},
        ${textNumber('vx0')}, ${textNumber('vy0')}, ${textNumber('vz0')},
      ${textNumber('ax0')}, ${textNumber('ay0')}, ${textNumber('az0')}
      FROM eligible
      WHERE session_date >= pitcher_latest - 6
      ON CONFLICT (school_code, pitch_uid) DO UPDATE SET ${UPSERT_UPDATE}
    `, [schoolCode]);
    totalRows += result.rowCount ?? 0;
  }
  return totalRows;
}

export async function syncPitchFlightBackfill(options: { incremental?: boolean } = {}): Promise<{ pitchDataRows: number; vmiRows: number; pitchEventsRows: number }> {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '110s'`);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('pitch-flight-backfill-sync'))`);
    await ensurePitchFlightSchema(client);
    const incremental = options.incremental === true;
    const pitchDataRows = await syncPitchData(client, incremental);
    const vmiRows = await syncVmiV3(client, incremental);
    const pitchEventsRows = await syncPitchEvents(client, incremental);
    await client.query('COMMIT');
    return { pitchDataRows, vmiRows, pitchEventsRows };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

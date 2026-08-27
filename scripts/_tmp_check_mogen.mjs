import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL, max: 1 });
try {
  console.log('=== pitch_events rows for Mogen, any school, recent ===');
  const r1 = await pool.query(`
    SELECT id, school_code, session_date, pitcher, taggedpitchtype, playid, pitchuid
    FROM public.pitch_events
    WHERE lower(coalesce(pitcher,'')) LIKE '%mogen%'
    ORDER BY session_date DESC, id DESC LIMIT 20
  `);
  console.table(r1.rows);

  console.log('=== pitch_data rows for Mogen (national/shared table), recent ===');
  const r2 = await pool.query(`
    SELECT "PitchUID" AS pitch_uid, "Date" AS date, "Pitcher" AS pitcher, "PitcherTeam" AS pitcher_team,
      "TaggedPitchType" AS pitch_type
    FROM public.pitch_data
    WHERE lower(coalesce("Pitcher",'')) LIKE '%mogen%'
    ORDER BY "Date" DESC LIMIT 20
  `);
  console.table(r2.rows);
} finally { await pool.end(); }

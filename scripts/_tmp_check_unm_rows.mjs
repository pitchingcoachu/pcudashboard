import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL, max: 1 });
try {
  console.log('=== sample UNM pitch_events rows for today ===');
  const r1 = await pool.query(`
    SELECT id, session_date, pitcher, taggedpitchtype, playid, pitchuid, relspeed, spinrate
    FROM public.pitch_events
    WHERE school_code = 'UNM' AND session_date = DATE '2026-08-26'
    ORDER BY id LIMIT 10
  `);
  console.table(r1.rows);

  console.log('=== distinct pitchers in this UNM batch ===');
  const r2 = await pool.query(`
    SELECT pitcher, COUNT(*) AS n
    FROM public.pitch_events
    WHERE school_code = 'UNM' AND session_date = DATE '2026-08-26'
    GROUP BY pitcher ORDER BY n DESC
  `);
  console.table(r2.rows);

  console.log('=== rollups table check for UNM today, if exists ===');
  try {
    const r3 = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name ILIKE '%rollup%'
    `);
    console.table(r3.rows);
  } catch (e) { console.log('rollup check failed', e.message); }
} finally { await pool.end(); }

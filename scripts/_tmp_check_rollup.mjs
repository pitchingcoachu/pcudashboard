import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL, max: 1 });
try {
  console.log('=== find rollup tables that might hold school-scoped daily counts ===');
  const r1 = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name ILIKE '%college%rollup%'
  `);
  console.table(r1.rows);

  console.log('=== columns on pitch_events_daily_rollup_league (sample) ===');
  const r2 = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'pitch_events_daily_rollup_league' ORDER BY ordinal_position
  `);
  console.table(r2.rows);

  console.log('=== rollup rows for UNM, today ===');
  const r3 = await pool.query(`
    SELECT * FROM public.pitch_events_daily_rollup_league
    WHERE school_code = 'UNM' AND session_date = DATE '2026-08-26'
    LIMIT 10
  `);
  console.table(r3.rows);
} finally { await pool.end(); }

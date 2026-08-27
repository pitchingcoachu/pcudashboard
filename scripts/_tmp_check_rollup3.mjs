import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL, max: 1 });
try {
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'pitch_events_daily_rollup_league' ORDER BY ordinal_position
  `);
  console.log(cols.rows.map(r => r.column_name).filter(c => /school|date|pitch|team|player|pitcher/i.test(c)).join('\n'));

  console.log('=== count of UNM rollup rows by date, last week ===');
  const r2 = await pool.query(`
    SELECT session_date, COUNT(*) AS n, SUM(pitches) AS total_pitches
    FROM public.pitch_events_daily_rollup_league
    WHERE school_code = 'UNM' AND session_date >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY session_date ORDER BY session_date DESC
  `);
  console.table(r2.rows);
} finally { await pool.end(); }

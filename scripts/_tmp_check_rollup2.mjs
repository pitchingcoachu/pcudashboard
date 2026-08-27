import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL, max: 1 });
try {
  console.log('=== rollup row summary for UNM, today ===');
  const r = await pool.query(`
    SELECT school_code, session_date, pitcher, pitch_n
    FROM public.pitch_events_daily_rollup_league
    WHERE school_code = 'UNM' AND session_date = DATE '2026-08-26'
    ORDER BY pitcher LIMIT 20
  `);
  console.table(r.rows);

  console.log('=== count of UNM rollup rows by date, last week ===');
  const r2 = await pool.query(`
    SELECT session_date, COUNT(*) AS n, SUM(pitch_n) AS total_pitches
    FROM public.pitch_events_daily_rollup_league
    WHERE school_code = 'UNM' AND session_date >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY session_date ORDER BY session_date DESC
  `);
  console.table(r2.rows);
} finally { await pool.end(); }

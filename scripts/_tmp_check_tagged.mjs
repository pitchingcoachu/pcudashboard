import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL, max: 1 });
try {
  console.log('=== taggedpitchtype distribution for UNM today ===');
  const r = await pool.query(`
    SELECT taggedpitchtype, COUNT(*) AS n
    FROM public.pitch_events
    WHERE school_code = 'UNM' AND session_date = DATE '2026-08-26'
    GROUP BY taggedpitchtype
  `);
  console.table(r.rows);

  console.log('=== pitcherteam values for UNM today (check TRIAL exclusion doesnt apply here, thats LEAGUE-only) ===');
  const r2 = await pool.query(`
    SELECT pitcherteam, COUNT(*) AS n
    FROM public.pitch_events
    WHERE school_code = 'UNM' AND session_date = DATE '2026-08-26'
    GROUP BY pitcherteam
  `);
  console.table(r2.rows);

  console.log('=== level values for UNM today ===');
  const r3 = await pool.query(`
    SELECT level, COUNT(*) AS n
    FROM public.pitch_events
    WHERE school_code = 'UNM' AND session_date = DATE '2026-08-26'
    GROUP BY level
  `);
  console.table(r3.rows);
} finally { await pool.end(); }

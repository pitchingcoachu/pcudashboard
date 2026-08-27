import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL, max: 1 });
try {
  console.log('=== pitch_data_files for UNM, recent ===');
  const r1 = await pool.query(`
    SELECT file_id, school_code, source_file, row_count, file_mtime, loaded_at
    FROM public.pitch_data_files
    WHERE school_code = 'UNM'
    ORDER BY loaded_at DESC LIMIT 15
  `);
  console.table(r1.rows);

  console.log('=== pitch_events count by school_code and session_date, last 3 days ===');
  const r2 = await pool.query(`
    SELECT school_code, session_date, COUNT(*) AS n
    FROM public.pitch_events
    WHERE session_date >= CURRENT_DATE - INTERVAL '3 days' OR session_date IS NULL
    GROUP BY school_code, session_date
    ORDER BY session_date DESC NULLS LAST, school_code
  `);
  console.table(r2.rows);
} finally { await pool.end(); }

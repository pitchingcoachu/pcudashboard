import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  const res = await client.query(`
    SELECT date, time, relspeed, pitcher, session_date
    FROM pitch_events
    WHERE school_code = 'PCU'
      AND session_date BETWEEN DATE '2026-05-15' AND DATE '2026-05-25'
      AND time IS NOT NULL
      AND btrim(time) <> ''
    ORDER BY session_date, id
    LIMIT 30
  `);
  console.log(JSON.stringify(res.rows, null, 2));
} finally {
  client.release();
  await pool.end();
}


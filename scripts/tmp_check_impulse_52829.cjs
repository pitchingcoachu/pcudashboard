const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = await c.query(`
    SELECT
      COUNT(*)::int AS total_52829,
      COUNT(*) FILTER (WHERE m.impulse_time IS NOT NULL)::int AS with_impulse_time_52829,
      COUNT(*) FILTER (WHERE m.impulse_time IS NULL)::int AS without_impulse_time_52829
    FROM biomechanics_pitch_metrics m
    JOIN biomechanics_single_pitch_points p
      ON p.organization_id = m.organization_id
     AND p.school_code = m.school_code
     AND p.source_file_hash = m.source_file_hash
     AND p.point_index = 0
    WHERE m.organization_id = 1
      AND m.school_code = 'PCU'
      AND COALESCE(p.captured_at::date, NOW()::date) BETWEEN DATE '2026-05-28' AND DATE '2026-05-29'
  `);
  console.log(JSON.stringify(q.rows[0], null, 2));
  await c.end();
})();

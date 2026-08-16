import { getDbPool } from '../lib/auth-db';

async function main() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT ppi.plan_section, w.name as workout_name
      FROM public.program_plan_items ppi
      JOIN public.workouts w ON w.id = ppi.workout_id
      WHERE ppi.plan_section = 'throwing'
      LIMIT 20
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (e) {
    console.error('query failed:', e);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

import { getDbPool } from '../lib/auth-db';

async function main() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT ppi.id as plan_item_id, ppi.player_id, ppi.workout_id, wl.name, wl.calendar_link_target
      FROM public.program_plan_items ppi
      JOIN public.workout_library wl ON wl.id = ppi.workout_id
      WHERE ppi.plan_section = 'throwing'
      ORDER BY ppi.updated_at DESC
      LIMIT 15
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

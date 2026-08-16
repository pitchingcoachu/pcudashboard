import { getDbPool } from '../lib/auth-db';

async function main() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT ppi.id, ppi.player_id, ppi.workout_id, wl.name,
        pdi.prescribed_notes, pdi.exercise_id, e.name as exercise_name
      FROM public.program_plan_items ppi
      JOIN public.workout_library wl ON wl.id = ppi.workout_id
      LEFT JOIN public.workout_exercises pdi ON pdi.workout_id = wl.id
      LEFT JOIN public.exercises e ON e.id = pdi.exercise_id
      WHERE wl.name = 'Throwing (High)'
      LIMIT 10
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (e) {
    console.error('failed:', e instanceof Error ? e.message : e);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

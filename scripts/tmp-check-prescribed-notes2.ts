import { getDbPool } from '../lib/auth-db';

async function main() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='workout_exercises'
      ORDER BY column_name
    `);
    console.log('workout_exercises columns:', cols.rows.map((r: any) => r.column_name));

    const result = await client.query(`
      SELECT we.*
      FROM public.workout_exercises we
      JOIN public.workout_library wl ON wl.id = we.workout_id
      WHERE wl.name = 'Throwing (High)'
      LIMIT 5
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

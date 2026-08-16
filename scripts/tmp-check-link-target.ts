import { getDbPool } from '../lib/auth-db';

async function main() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, name, calendar_link_target
      FROM public.workout_library
      WHERE name IN ('Throwing (High)', 'Throwing (Medium)', 'Throwing (Low)', 'Bullpen', 'Post-Throwing Drills')
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

import { getDbPool } from '../lib/auth-db';

async function main() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='workout_library'
      ORDER BY column_name
    `);
    console.log('workout_library columns:', cols.rows.map((r: any) => r.column_name));

    const result = await client.query(`
      SELECT * FROM public.workout_library WHERE name = 'Throwing (High)' LIMIT 3
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

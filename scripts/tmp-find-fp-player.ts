import { getDbPool } from '../lib/auth-db';

async function main() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT player_name, tests_count FROM public.force_plate_players
      WHERE tests_count > 0
      ORDER BY tests_count DESC
      LIMIT 5
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

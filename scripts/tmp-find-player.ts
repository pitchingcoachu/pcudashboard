import { getDbPool } from '../lib/auth-db';

async function main() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, full_name FROM public.players
      WHERE organization_id = 1
      LIMIT 5
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

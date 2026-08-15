import { getDbPool } from '../lib/auth-db';

async function main() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT organization_id, last_synced_at, last_status, last_error
      FROM public.force_plate_sync_state
      ORDER BY last_synced_at DESC
      LIMIT 5
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

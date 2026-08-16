import { getDbPool } from '../lib/auth-db';

async function main() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name LIKE '%program%'
      ORDER BY table_name, column_name
    `);
    console.log(cols.rows.map((r: any) => r.column_name).join(', '));
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name LIKE '%program%'
    `);
    console.log('tables:', tables.rows.map((r: any) => r.table_name));
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

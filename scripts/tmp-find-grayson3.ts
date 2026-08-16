import { getDbPool } from '../lib/auth-db';

async function main() {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, session_date, school_code, session_type,
        COALESCE(to_jsonb(pe)->>'videoclip', '') as v1,
        COALESCE(to_jsonb(pe)->>'videoclip2', '') as v2,
        COALESCE(to_jsonb(pe)->>'videoclip3', '') as v3
      FROM public.pitch_events pe
      WHERE pitcher = 'Headon, Grayson'
      ORDER BY session_date DESC
      LIMIT 40
    `);
    console.log('total:', result.rows.length);
    console.log(JSON.stringify(result.rows.map((r: any) => ({ id: r.id, date: r.session_date, school: r.school_code, type: r.session_type, hasV1: Boolean(r.v1), hasV2: Boolean(r.v2), hasV3: Boolean(r.v3) })), null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

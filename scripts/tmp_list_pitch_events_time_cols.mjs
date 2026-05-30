import { Client } from 'pg';
const c=new Client({connectionString:process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL});
await c.connect();
const cols=await c.query(`
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='pitch_events'
ORDER BY ordinal_position
`);
console.log('columns:', cols.rows.map(r=>r.column_name).join(', '));
const timeish=cols.rows.filter(r=>/time|date|timestamp|utc|local|release|pitch/i.test(r.column_name));
console.log('time-ish:', timeish);
for (const col of timeish.map(r=>r.column_name)) {
  try {
    const q = `SELECT COUNT(*)::int AS total, COUNT(${col})::int AS nonnull FROM pitch_events WHERE school_code='PCU' AND session_date BETWEEN '2026-05-28'::date AND '2026-05-29'::date`;
    const r = await c.query(q);
    const sampleQ = `SELECT ${col}::text AS v FROM pitch_events WHERE school_code='PCU' AND session_date BETWEEN '2026-05-28'::date AND '2026-05-29'::date AND ${col} IS NOT NULL LIMIT 5`;
    const s = await c.query(sampleQ);
    console.log(col, r.rows[0], s.rows.map(x=>x.v));
  } catch (e) {
    console.log(col, 'ERR', String(e.message||e));
  }
}
await c.end();

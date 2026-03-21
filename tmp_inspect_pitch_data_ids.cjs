const fs = require('fs');
const { Client } = require('pg');
const lines = fs.readFileSync('.env.local', 'utf8').split(/\n/).filter(Boolean);
const env = {};
for (const l of lines) { const i = l.indexOf('='); if (i > 0) env[l.slice(0, i)] = l.slice(i + 1); }
const cs = env.DASHBOARD_DATABASE_URL || env.DATABASE_URL;
(async()=>{
 const c = new Client({connectionString: cs}); await c.connect();
 const cols = await c.query(`
   select column_name
   from information_schema.columns
   where table_schema='public' and table_name='pitch_data'
   order by ordinal_position
 `);
 const cand = cols.rows.map(r=>r.column_name).filter(n=>/pitch|play|game|uid|id|session|inning|date/i.test(n));
 console.log(cand);
 await c.end();
})().catch(e=>{console.error(e); process.exit(1);});

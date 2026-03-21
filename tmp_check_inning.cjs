const fs = require('fs');
const { Client } = require('pg');
const lines = fs.readFileSync('.env.local', 'utf8').split(/\n/).filter(Boolean);
const env = {};
for (const l of lines) { const i = l.indexOf('='); if (i > 0) env[l.slice(0, i)] = l.slice(i + 1); }
const cs = env.DASHBOARD_DATABASE_URL || env.DATABASE_URL;
(async()=>{
 const c = new Client({connectionString: cs}); await c.connect();
 const bySchool = await c.query(`
   select school_code,
          count(*) filter (where coalesce(session_type,'') ilike '%live%') as live_total,
          count(*) filter (where coalesce(session_type,'') ilike '%live%' and coalesce(trim(inning), '') <> '') as live_with_inning
   from pitch_events
   group by school_code
   order by live_with_inning desc nulls last
   limit 20
 `);
 console.log(bySchool.rows);
 await c.end();
})().catch(e=>{console.error(e); process.exit(1);});

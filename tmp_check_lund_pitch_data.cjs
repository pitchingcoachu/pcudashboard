const fs = require('fs');
const { Client } = require('pg');
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\n/).filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return i > 0 ? [l.slice(0, i), l.slice(i + 1)] : null;
  }).filter(Boolean)
);
const cs = env.DASHBOARD_DATABASE_URL || env.DATABASE_URL;
(async () => {
  const c = new Client({ connectionString: cs });
  await c.connect();
  const q1 = await c.query(`select count(*) as n from pitch_data where lower("Pitcher"::text) like '%lund%'`);
  const q2 = await c.query(`
    select "Pitcher"::text as pitcher, min("Date"::date) as min_d, max("Date"::date) as max_d, count(*) n
    from pitch_data
    where lower("Pitcher"::text) like '%lund%'
    group by 1
    order by n desc
    limit 20
  `);
  console.log('pitch_data lund count', q1.rows[0]);
  console.log('pitch_data lund groups', q2.rows);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

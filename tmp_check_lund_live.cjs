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
  const q = await c.query(`
    select
      pitcher,
      count(*) as total,
      count(*) filter (where lower(coalesce(session_type, sessiontype, '')) like '%live%') as live_total,
      count(*) filter (
        where lower(coalesce(session_type, sessiontype, '')) like '%live%'
          and coalesce(trim(coalesce(to_jsonb(pe)->>'inning', to_jsonb(pe)->>'Inning', '')), '') <> ''
      ) as live_inning_direct,
      count(*) filter (
        where lower(coalesce(session_type, sessiontype, '')) like '%live%'
          and coalesce(trim(inning), '') <> ''
      ) as live_inning_column
    from pitch_events pe
    where school_code='OSU'
      and session_date between '2026-03-01'::date and '2026-03-15'::date
      and pitcher='Lund, Ethan'
    group by pitcher
  `);
  console.log(q.rows);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

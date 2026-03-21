const fs = require('fs');
const { Client } = require('pg');
const lines = fs.readFileSync('.env.local', 'utf8').split(/\n/).filter(Boolean);
const env = {};
for (const l of lines) { const i = l.indexOf('='); if (i > 0) env[l.slice(0, i)] = l.slice(i + 1); }
const cs = env.DASHBOARD_DATABASE_URL || env.DATABASE_URL;
(async()=>{
 const c = new Client({connectionString: cs}); await c.connect();
 const q = await c.query(`
   with pe as (
     select id,
            (case when date::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then date::date else null end) as d,
            lower(trim(pitcher)) as pitcher_norm,
            round(relspeed::numeric, 1) as v,
            round(inducedvertbreak::numeric, 1) as ivb,
            round(horzbreak::numeric, 1) as hb,
            round(platelocside::numeric, 2) as ps,
            round(platelocheight::numeric, 2) as ph
     from pitch_events
     where coalesce(session_type,'') ilike '%live%'
       and (case when date::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then date::date else null end) <= '2026-02-13'::date
       and coalesce(trim(inning), '') = ''
   ), pd as (
     select
       "Date"::date as d,
       lower(trim("Pitcher"::text)) as pitcher_norm,
       round("RelSpeed"::numeric, 1) as v,
       round("InducedVertBreak"::numeric, 1) as ivb,
       round("HorzBreak"::numeric, 1) as hb,
       round("PlateLocSide"::numeric, 2) as ps,
       round("PlateLocHeight"::numeric, 2) as ph,
       "Inning"::text as inning
     from pitch_data
     where "Date"::date <= '2026-02-13'::date
       and coalesce(trim("Inning"::text), '') <> ''
   ), m as (
     select pe.id, count(*) as c
     from pe join pd using (d,pitcher_norm,v,ivb,hb,ps,ph)
     group by pe.id
   )
   select
     count(*) filter (where c = 1) as uniquely_matchable,
     count(*) filter (where c > 1) as ambiguous,
     count(*) as matchable_total
   from m
 `);
 console.log(q.rows[0]);
 await c.end();
})().catch(e=>{console.error(e); process.exit(1);});

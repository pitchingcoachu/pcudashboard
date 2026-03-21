const fs = require('fs');
const { Client } = require('pg');
const lines = fs.readFileSync('.env.local', 'utf8').split(/\n/).filter(Boolean);
const env = {};
for (const l of lines) { const i = l.indexOf('='); if (i > 0) env[l.slice(0, i)] = l.slice(i + 1); }
const cs = env.DASHBOARD_DATABASE_URL || env.DATABASE_URL;

(async()=>{
  const c = new Client({connectionString: cs});
  await c.connect();

  await c.query(`alter table public.pitch_events add column if not exists inning text`);

  const before = await c.query(`
    select
      count(*) as total,
      count(*) filter (where coalesce(trim(inning), '') <> '') as with_inning,
      count(*) filter (where coalesce(session_type,'') ilike '%live%') as live_total,
      count(*) filter (where coalesce(session_type,'') ilike '%live%' and coalesce(trim(inning), '') <> '') as live_with_inning
    from public.pitch_events
  `);
  console.log('before', before.rows[0]);

  const upd = await c.query(`
    with src as (
      select distinct on ("PitchUID")
        "PitchUID"::text as pitchuid,
        "Inning"::text as inning
      from public.pitch_data
      where "PitchUID" is not null and coalesce(trim("PitchUID"::text), '') <> ''
        and "Inning" is not null and coalesce(trim("Inning"::text), '') <> ''
      order by "PitchUID", "Date" desc nulls last
    )
    update public.pitch_events pe
    set inning = src.inning
    from src
    where pe.pitchuid = src.pitchuid
      and coalesce(trim(pe.inning), '') = ''
    returning pe.id
  `);
  console.log('updated_rows', upd.rowCount);

  const after = await c.query(`
    select
      count(*) as total,
      count(*) filter (where coalesce(trim(inning), '') <> '') as with_inning,
      count(*) filter (where coalesce(session_type,'') ilike '%live%') as live_total,
      count(*) filter (where coalesce(session_type,'') ilike '%live%' and coalesce(trim(inning), '') <> '') as live_with_inning
    from public.pitch_events
  `);
  console.log('after', after.rows[0]);

  await c.end();
})();

const fs = require('fs');
const { Client } = require('pg');
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\n/).filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return i > 0 ? [l.slice(0, i), l.slice(i + 1)] : null;
  }).filter(Boolean)
);
const cs = env.DASHBOARD_DATABASE_URL || env.DATABASE_URL;
(async()=>{
  const c = new Client({connectionString: cs});
  await c.connect();

  const q1 = await c.query(`
    select count(*) as n_2026
    from pitch_data
    where "Date"::date between '2026-03-01'::date and '2026-03-15'::date
  `);
  console.log('pitch_data rows 2026-03-01..03-15', q1.rows[0]);

  const q2 = await c.query(`
    select "Pitcher"::text as pitcher, count(*) n
    from pitch_data
    where "Date"::date between '2026-03-01'::date and '2026-03-15'::date
    group by 1
    order by n desc
    limit 20
  `);
  console.log('top pitchers in pitch_data for range', q2.rows);

  const q3 = await c.query(`
    with pe as (
      select
        coalesce(to_jsonb(pe)->>'pitchuid', to_jsonb(pe)->>'pitch_uid', pe.pitchuid::text, '') as pitchuid_eff,
        coalesce(to_jsonb(pe)->>'playid', to_jsonb(pe)->>'play_id', pe.playid::text, '') as playid_eff
      from pitch_events pe
      where pe.school_code='OSU'
        and pe.pitcher='Lund, Ethan'
        and pe.session_date between '2026-03-01'::date and '2026-03-15'::date
    )
    select
      count(*) as total,
      count(*) filter (where coalesce(trim(pitchuid_eff),'')<>'') as with_pitchuid,
      count(*) filter (where coalesce(trim(playid_eff),'')<>'') as with_playid,
      count(*) filter (
        where coalesce(trim(pitchuid_eff),'')<>'' and exists(
          select 1 from pitch_data pd
          where pd."PitchUID" is not null and lower(btrim(pd."PitchUID"::text))=lower(btrim(pe.pitchuid_eff))
        )
      ) as pitchuid_found_in_pitch_data,
      count(*) filter (
        where coalesce(trim(playid_eff),'')<>'' and exists(
          select 1 from pitch_data pd
          where pd."PlayID" is not null and lower(btrim(pd."PlayID"::text))=lower(btrim(pe.playid_eff))
        )
      ) as playid_found_in_pitch_data
    from pe
  `);
  console.log('Lund 2026 key mapping coverage', q3.rows[0]);

  await c.end();
})().catch(e=>{console.error(e); process.exit(1);});

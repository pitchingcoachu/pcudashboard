const fs = require('fs');
const { Client } = require('pg');
const lines = fs.readFileSync('.env.local', 'utf8').split(/\n/).filter(Boolean);
const env = {};
for (const l of lines) { const i = l.indexOf('='); if (i > 0) env[l.slice(0, i)] = l.slice(i + 1); }
const cs = env.DASHBOARD_DATABASE_URL || env.DATABASE_URL;
(async()=>{
  const c = new Client({connectionString: cs});
  await c.connect();

  const q1 = await c.query(`
    select pitcher, count(*) n
    from pitch_events
    where school_code='OSU'
      and session_date between '2026-03-01'::date and '2026-03-15'::date
      and lower(pitcher) like '%lund%'
    group by pitcher
    order by n desc
    limit 20
  `);
  console.log('pitch_events pitchers like lund', q1.rows);

  const q2 = await c.query(`
    select "Pitcher" as pitcher, count(*) n
    from pitch_data
    where "Date" between '2026-03-01'::date and '2026-03-15'::date
      and lower("Pitcher") like '%lund%'
    group by "Pitcher"
    order by n desc
    limit 20
  `);
  console.log('pitch_data pitchers like lund', q2.rows);

  const q3 = await c.query(`
    with pd_uid_map as (
      select distinct on (lower(btrim(pd."PitchUID"::text)))
        lower(btrim(pd."PitchUID"::text)) as pitchuid_key,
        pd."Inning"::text as inning
      from public.pitch_data pd
      where pd."PitchUID" is not null
        and btrim(pd."PitchUID"::text) <> ''
        and pd."Inning" is not null
        and btrim(pd."Inning"::text) <> ''
      order by lower(btrim(pd."PitchUID"::text)), pd."Date" desc nulls last
    ),
    pd_play_map as (
      select distinct on (lower(btrim(pd."PlayID"::text)))
        lower(btrim(pd."PlayID"::text)) as playid_key,
        pd."Inning"::text as inning
      from public.pitch_data pd
      where pd."PlayID" is not null
        and btrim(pd."PlayID"::text) <> ''
        and pd."Inning" is not null
        and btrim(pd."Inning"::text) <> ''
      order by lower(btrim(pd."PlayID"::text)), pd."Date" desc nulls last
    ),
    base as (
      select
        pe.pitcher,
        pe.session_date,
        coalesce(nullif(trim(coalesce(to_jsonb(pe)->>'inning', to_jsonb(pe)->>'Inning', '')), ''), nullif(trim(pd_uid.inning), ''), nullif(trim(pd_play.inning), ''), '') as inning,
        coalesce(nullif(trim(pe.session_type), ''), nullif(trim(pe.sessiontype), ''), 'Unknown') as session_type,
        coalesce(to_jsonb(pe)->>'pitchuid', to_jsonb(pe)->>'pitch_uid', pe.pitchuid::text, '') as pitchuid_eff,
        coalesce(to_jsonb(pe)->>'playid', to_jsonb(pe)->>'play_id', pe.playid::text, '') as playid_eff
      from pitch_events pe
      left join pd_uid_map pd_uid
        on lower(btrim(coalesce(to_jsonb(pe)->>'pitchuid', to_jsonb(pe)->>'pitch_uid', pe.pitchuid::text, ''))) <> ''
       and lower(btrim(coalesce(to_jsonb(pe)->>'pitchuid', to_jsonb(pe)->>'pitch_uid', pe.pitchuid::text, ''))) = pd_uid.pitchuid_key
      left join pd_play_map pd_play
        on lower(btrim(coalesce(to_jsonb(pe)->>'playid', to_jsonb(pe)->>'play_id', pe.playid::text, ''))) <> ''
       and lower(btrim(coalesce(to_jsonb(pe)->>'playid', to_jsonb(pe)->>'play_id', pe.playid::text, ''))) = pd_play.playid_key
      where pe.school_code='OSU'
        and pe.session_date between '2026-03-01'::date and '2026-03-15'::date
        and lower(pe.pitcher) like '%lund%'
    )
    select
      pitcher,
      count(*) as total,
      count(*) filter (where lower(session_type) like '%live%') as live_total,
      count(*) filter (where lower(session_type) like '%live%' and coalesce(trim(inning),'')<>'') as live_with_inning,
      count(*) filter (where coalesce(trim(pitchuid_eff),'')<>'') as with_pitchuid,
      count(*) filter (where coalesce(trim(playid_eff),'')<>'') as with_playid
    from base
    group by pitcher
    order by total desc
  `);
  console.log('resolved coverage', q3.rows);

  await c.end();
})().catch(e=>{console.error(e); process.exit(1);});

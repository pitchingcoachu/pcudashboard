const fs = require('fs');
const { Client } = require('pg');
const lines = fs.readFileSync('.env.local', 'utf8').split(/\n/).filter(Boolean);
const env = {};
for (const l of lines) { const i = l.indexOf('='); if (i > 0) env[l.slice(0, i)] = l.slice(i + 1); }
const cs = env.DASHBOARD_DATABASE_URL || env.DATABASE_URL;
(async()=>{
  const c = new Client({connectionString: cs});
  await c.connect();
  const q = await c.query(`
    with pd_uid_map as (
      select distinct on (btrim(pd."PitchUID"::text))
        btrim(pd."PitchUID"::text) as pitchuid_key,
        pd."Inning"::text as inning
      from public.pitch_data pd
      where pd."PitchUID" is not null
        and btrim(pd."PitchUID"::text) <> ''
        and pd."Inning" is not null
        and btrim(pd."Inning"::text) <> ''
      order by btrim(pd."PitchUID"::text), pd."Date" desc nulls last
    ),
    pd_play_map as (
      select distinct on (btrim(pd."PlayID"::text))
        btrim(pd."PlayID"::text) as playid_key,
        pd."Inning"::text as inning
      from public.pitch_data pd
      where pd."PlayID" is not null
        and btrim(pd."PlayID"::text) <> ''
        and pd."Inning" is not null
        and btrim(pd."Inning"::text) <> ''
      order by btrim(pd."PlayID"::text), pd."Date" desc nulls last
    ), pe_base as (
      select pe.*, coalesce(nullif(trim(pe.session_type),''), nullif(trim(pe.sessiontype),''), 'Unknown') as st
      from public.pitch_events pe
      where pe.school_code='OSU'
    )
    select
      count(*) filter (where lower(st) like '%live%') as live_total,
      count(*) filter (where lower(st) like '%live%' and coalesce(trim(coalesce(to_jsonb(pe_base)->>'inning',to_jsonb(pe_base)->>'Inning','')), '') <> '') as live_inning_direct,
      count(*) filter (where lower(st) like '%live%' and coalesce(trim(pe_base.pitchuid::text),'') <> '' and pd_uid.inning is not null) as live_inning_uid_match,
      count(*) filter (where lower(st) like '%live%' and coalesce(trim(pe_base.playid::text),'') <> '' and pd_play.inning is not null) as live_inning_play_match,
      count(*) filter (where lower(st) like '%live%' and coalesce(nullif(trim(coalesce(to_jsonb(pe_base)->>'inning',to_jsonb(pe_base)->>'Inning','')),''), nullif(trim(pd_uid.inning),''), nullif(trim(pd_play.inning),''), '') <> '') as live_inning_resolved
    from pe_base
    left join pd_uid_map pd_uid on btrim(coalesce(pe_base.pitchuid::text,'')) <> '' and btrim(coalesce(pe_base.pitchuid::text,'')) = pd_uid.pitchuid_key
    left join pd_play_map pd_play on btrim(coalesce(pe_base.playid::text,'')) <> '' and btrim(coalesce(pe_base.playid::text,'')) = pd_play.playid_key
  `);
  console.log(q.rows[0]);

  const s = await c.query(`
    select
      count(*) filter (where school_code='OSU' and coalesce(trim(pitchuid::text),'') <> '') as osu_with_pitchuid,
      count(*) filter (where school_code='OSU' and coalesce(trim(playid::text),'') <> '') as osu_with_playid,
      count(*) filter (where school_code='OSU' and coalesce(trim(pitchuid::text),'') <> '' and coalesce(session_type,'') ilike '%live%') as osu_live_with_pitchuid,
      count(*) filter (where school_code='OSU' and coalesce(trim(playid::text),'') <> '' and coalesce(session_type,'') ilike '%live%') as osu_live_with_playid
    from pitch_events
  `);
  console.log(s.rows[0]);
  await c.end();
})().catch(e=>{console.error(e); process.exit(1);});

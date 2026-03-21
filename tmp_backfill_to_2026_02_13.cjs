const fs = require('fs');
const { Client } = require('pg');

const lines = fs.readFileSync('.env.local', 'utf8').split(/\n/).filter(Boolean);
const env = {};
for (const l of lines) {
  const i = l.indexOf('=');
  if (i > 0) env[l.slice(0, i)] = l.slice(i + 1);
}
const cs = env.DASHBOARD_DATABASE_URL || env.DATABASE_URL;
if (!cs) {
  console.error('No DB URL found in .env.local');
  process.exit(1);
}

(async () => {
  const c = new Client({ connectionString: cs });
  await c.connect();

  const cutoff = '2026-02-13';
  const peDateExpr = "case when pe.date::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then pe.date::date else null end";

  await c.query('BEGIN');
  await c.query(`alter table public.pitch_events add column if not exists inning text`);

  const before = await c.query(`
    select
      count(*) filter (where coalesce(session_type,'') ilike '%live%' and (${peDateExpr}) <= $1::date) as live_total_cutoff,
      count(*) filter (where coalesce(session_type,'') ilike '%live%' and (${peDateExpr}) <= $1::date and coalesce(trim(inning), '') <> '') as live_with_inning_cutoff,
      count(*) filter (where (${peDateExpr}) <= $1::date) as total_cutoff,
      count(*) filter (where (${peDateExpr}) <= $1::date and coalesce(trim(inning), '') <> '') as total_with_inning_cutoff
    from public.pitch_events pe
  `, [cutoff]);

  const updByUid = await c.query(`
    with src as (
      select distinct on ("PitchUID")
        "PitchUID"::text as pitchuid,
        "Inning"::text as inning
      from public.pitch_data
      where "PitchUID" is not null
        and coalesce(trim("PitchUID"::text), '') <> ''
        and "Date"::date <= $1::date
        and "Inning" is not null
        and coalesce(trim("Inning"::text), '') <> ''
      order by "PitchUID", "Date" desc nulls last
    )
    update public.pitch_events pe
    set inning = src.inning
    from src
    where pe.pitchuid = src.pitchuid
      and (${peDateExpr}) <= $1::date
      and coalesce(trim(pe.inning), '') = ''
    returning pe.id
  `, [cutoff]);

  const updByPlayId = await c.query(`
    with src as (
      select distinct on ("PlayID")
        "PlayID"::text as playid,
        "Inning"::text as inning
      from public.pitch_data
      where "PlayID" is not null
        and coalesce(trim("PlayID"::text), '') <> ''
        and "Date"::date <= $1::date
        and "Inning" is not null
        and coalesce(trim("Inning"::text), '') <> ''
      order by "PlayID", "Date" desc nulls last
    )
    update public.pitch_events pe
    set inning = src.inning
    from src
    where coalesce(pe.playid::text, '') = src.playid
      and (${peDateExpr}) <= $1::date
      and coalesce(trim(pe.inning), '') = ''
    returning pe.id
  `, [cutoff]);

  const after = await c.query(`
    select
      count(*) filter (where coalesce(session_type,'') ilike '%live%' and (${peDateExpr}) <= $1::date) as live_total_cutoff,
      count(*) filter (where coalesce(session_type,'') ilike '%live%' and (${peDateExpr}) <= $1::date and coalesce(trim(inning), '') <> '') as live_with_inning_cutoff,
      count(*) filter (where (${peDateExpr}) <= $1::date) as total_cutoff,
      count(*) filter (where (${peDateExpr}) <= $1::date and coalesce(trim(inning), '') <> '') as total_with_inning_cutoff
    from public.pitch_events pe
  `, [cutoff]);

  const osuAfter = await c.query(`
    select
      count(*) filter (where school_code='OSU' and coalesce(session_type,'') ilike '%live%' and (${peDateExpr}) <= $1::date) as osu_live_total_cutoff,
      count(*) filter (where school_code='OSU' and coalesce(session_type,'') ilike '%live%' and (${peDateExpr}) <= $1::date and coalesce(trim(inning), '') <> '') as osu_live_with_inning_cutoff
    from public.pitch_events pe
  `, [cutoff]);

  await c.query('COMMIT');

  console.log(JSON.stringify({
    cutoff,
    before: before.rows[0],
    updated_by_pitchuid: updByUid.rowCount,
    updated_by_playid: updByPlayId.rowCount,
    after: after.rows[0],
    osu_after: osuAfter.rows[0]
  }, null, 2));

  await c.end();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});

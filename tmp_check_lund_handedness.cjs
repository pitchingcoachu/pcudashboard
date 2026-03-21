const fs = require('fs');
const { Client } = require('pg');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split(/\n/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=');
      return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : null;
    })
    .filter(Boolean)
);

const connectionString = env.DASHBOARD_DATABASE_URL || env.DATABASE_URL;

(async () => {
  const client = new Client({ connectionString });
  await client.connect();

  const pitchEvents = await client.query(`
    select
      session_date::date as session_date,
      pitcher,
      coalesce(pitcherthrows, '') as pitcherthrows,
      count(*) as pitches
    from pitch_events
    where school_code = 'OSU'
      and pitcher = 'Lund, Ethan'
      and session_date between '2026-03-13'::date and '2026-03-16'::date
    group by 1, 2, 3
    order by 1, 3
  `);

  const pitchData = await client.query(`
    select
      "Date"::date as session_date,
      "Pitcher"::text as pitcher,
      coalesce("PitcherThrows"::text, '') as pitcherthrows,
      count(*) as pitches
    from pitch_data
    where "Pitcher" = 'Lund, Ethan'
      and "Date"::date between '2026-03-13'::date and '2026-03-16'::date
    group by 1, 2, 3
    order by 1, 3
  `);

  console.log('pitch_events');
  console.log(pitchEvents.rows);
  console.log('pitch_data');
  console.log(pitchData.rows);

  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

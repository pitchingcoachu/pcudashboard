import { Client } from 'pg';
const school='PCU', start='2026-05-28', end='2026-05-29';
const client=new Client({connectionString:process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL});
await client.connect();

const dateSql='AND session_date >= $2::date AND session_date <= $3::date';
const attempts=[
`
SELECT
  COALESCE(NULLIF(TRIM(pitcher), ''), '') AS pitcher_name,
  session_date::text AS session_date,
  NULLIF(TRIM(COALESCE(time::text, '')), '') AS tm_time,
  relspeed::double precision AS velo,
  NULLIF(TRIM(COALESCE(taggedpitchtype::text, '')), '') AS pitch_type
FROM pitch_events
WHERE school_code = $1
  ${dateSql}
  AND relspeed IS NOT NULL
  AND COALESCE(NULLIF(TRIM(pitcher), ''), '') <> ''
`,
`
SELECT
  COALESCE(NULLIF(TRIM(pitcher), ''), '') AS pitcher_name,
  session_date::text AS session_date,
  NULLIF(TRIM(COALESCE(time::text, '')), '') AS tm_time,
  relspeed::double precision AS velo,
  NULL::text AS pitch_type
FROM pitch_events
WHERE school_code = $1
  ${dateSql}
  AND relspeed IS NOT NULL
  AND COALESCE(NULLIF(TRIM(pitcher), ''), '') <> ''
`,
`
SELECT
  COALESCE(NULLIF(TRIM(pitcher), ''), '') AS pitcher_name,
  session_date::text AS session_date,
  NULLIF(TRIM(COALESCE(time::text, '')), '') AS tm_time,
  "RelSpeed"::double precision AS velo,
  NULLIF(TRIM(COALESCE("TaggedPitchType"::text, '')), '') AS pitch_type
FROM pitch_events
WHERE school_code = $1
  ${dateSql}
  AND "RelSpeed" IS NOT NULL
  AND COALESCE(NULLIF(TRIM(pitcher), ''), '') <> ''
`,
`
SELECT
  COALESCE(NULLIF(TRIM(pitcher), ''), '') AS pitcher_name,
  session_date::text AS session_date,
  NULLIF(TRIM(COALESCE(time::text, '')), '') AS tm_time,
  "RelSpeed"::double precision AS velo,
  NULLIF(TRIM(COALESCE(taggedpitchtype::text, '')), '') AS pitch_type
FROM pitch_events
WHERE school_code = $1
  ${dateSql}
  AND "RelSpeed" IS NOT NULL
  AND COALESCE(NULLIF(TRIM(pitcher), ''), '') <> ''
`,
`
SELECT
  COALESCE(NULLIF(TRIM("Pitcher"::text), ''), '') AS pitcher_name,
  "Date"::text AS session_date,
  NULLIF(TRIM(COALESCE("Time"::text, '')), '') AS tm_time,
  "RelSpeed"::double precision AS velo,
  NULLIF(TRIM(COALESCE("TaggedPitchType"::text, '')), '') AS pitch_type
FROM pitch_events
WHERE school_code = $1
  ${dateSql}
  AND "RelSpeed" IS NOT NULL
  AND COALESCE(NULLIF(TRIM("Pitcher"::text), ''), '') <> ''
`,
`
SELECT
  COALESCE(NULLIF(TRIM(COALESCE("Pitcher"::text, pitcher)), ''), '') AS pitcher_name,
  COALESCE("Date"::text, session_date::text) AS session_date,
  NULLIF(TRIM(COALESCE("Time"::text, time::text, '')), '') AS tm_time,
  COALESCE("RelSpeed"::double precision, relspeed::double precision) AS velo,
  NULLIF(TRIM(COALESCE("TaggedPitchType"::text, taggedpitchtype::text, '')), '') AS pitch_type
FROM pitch_events
WHERE school_code = $1
  ${dateSql}
  AND COALESCE("RelSpeed"::double precision, relspeed::double precision) IS NOT NULL
  AND COALESCE(NULLIF(TRIM(COALESCE("Pitcher"::text, pitcher)), ''), '') <> ''
`
];
function parseTimeSec(raw){
  const text=String(raw??'').trim();
  if(!text) return null;
  const m=text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?\s*(AM|PM)?/i);
  if(!m) return null;
  let h=Number(m[1]??0), mi=Number(m[2]??0), s=Number(m[3]??0);
  const ap=String(m[5]??'').toUpperCase();
  if(ap==='PM'&&h<12) h+=12;
  if(ap==='AM'&&h===12) h=0;
  if(![h,mi,s].every(Number.isFinite)) return null;
  return h*3600+mi*60+s;
}
for(let i=0;i<attempts.length;i++){
  try{
    const r=await client.query(attempts[i],[school,start,end]);
    let timed=0, notTimed=0;
    for(const row of r.rows){
      const t=parseTimeSec(row.tm_time);
      if(t==null) notTimed++; else timed++;
    }
    console.log(`attempt ${i+1}: rows=${r.rows.length} timed=${timed} notTimed=${notTimed} sample_tm_time=${JSON.stringify(r.rows.slice(0,5).map(x=>x.tm_time))}`);
  }catch(e){
    console.log(`attempt ${i+1}: ERROR ${String(e.message||e)}`);
  }
}
await client.end();

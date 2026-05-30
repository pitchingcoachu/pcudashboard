import { Client } from 'pg';
const c=new Client({connectionString:process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL});
await c.connect();
const allRes=await c.query(`
SELECT row_json
FROM biomechanics_pitch_rows
WHERE organization_id=1 AND school_code='PCU'
  AND captured_at::date BETWEEN '2026-05-28'::date AND '2026-05-29'::date
LIMIT 50
`);
const tmRes=await c.query(`
SELECT pitch_key, pitchuid, pitcher, session_date, relspeed, taggedpitchtype
FROM pitch_events
WHERE school_code='PCU' AND session_date BETWEEN '2026-05-28'::date AND '2026-05-29'::date
LIMIT 50
`);

const candidateKeys=['pitch_key','pitchkey','PitchKey','pitchuid','pitch_uid','PitchUID','PitchUID','PitchId','pitchid','PlayId','playid','UUID','uuid'];
const samples=[];
for(const r of allRes.rows){
  const j=r.row_json||{};
  const found={};
  for(const k of Object.keys(j)){
    if(candidateKeys.some(c=>c.toLowerCase()===k.toLowerCase())) found[k]=j[k];
  }
  if(Object.keys(found).length) samples.push(found);
}
console.log('all-pitch row_json id-like sample count',samples.length);
console.log(samples.slice(0,10));

const tmKeys = tmRes.rows.map(r=>({pitch_key:r.pitch_key,pitchuid:r.pitchuid,pitcher:r.pitcher,session_date:r.session_date}));
console.log('trackman sample', tmKeys.slice(0,10));

// brute-force check overlap between any string in all row json and pitch_events.pitch_key/pitchuid
const tmIdSet=new Set(tmRes.rows.flatMap(r=>[String(r.pitch_key??''),String(r.pitchuid??'')]).filter(Boolean));
let overlaps=0;
for(const r of allRes.rows){
  const j=r.row_json||{};
  const vals=Object.values(j).map(v=>String(v??'').trim()).filter(Boolean);
  if(vals.some(v=>tmIdSet.has(v))) overlaps++;
}
console.log('overlap rows in first 50:', overlaps);
await c.end();

import { Client } from 'pg';
const school='PCU', orgId=1;
const start='2026-05-28', end='2026-05-29';
const client=new Client({connectionString:process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL});
await client.connect();

const allRes=await client.query(`
SELECT captured_at,row_json
FROM biomechanics_pitch_rows
WHERE organization_id=$1 AND school_code=$2 AND captured_at::date BETWEEN $3::date AND $4::date
ORDER BY captured_at ASC
`,[orgId,school,start,end]);

const variants=[
`SELECT pitcher,session_date::text as session_date,time::text as tm_time,relspeed::double precision as velo,taggedpitchtype::text as pt FROM pitch_events WHERE school_code=$1 AND session_date BETWEEN $2::date AND $3::date AND relspeed IS NOT NULL AND COALESCE(NULLIF(TRIM(pitcher),''),'')<>''`,
`SELECT pitcher,session_date::text as session_date,time::text as tm_time,"RelSpeed"::double precision as velo,"TaggedPitchType"::text as pt FROM pitch_events WHERE school_code=$1 AND session_date BETWEEN $2::date AND $3::date AND "RelSpeed" IS NOT NULL AND COALESCE(NULLIF(TRIM(pitcher),''),'')<>''`,
`SELECT pitcher,session_date::text as session_date,time::text as tm_time,"RelSpeed"::double precision as velo,taggedpitchtype::text as pt FROM pitch_events WHERE school_code=$1 AND session_date BETWEEN $2::date AND $3::date AND "RelSpeed" IS NOT NULL AND COALESCE(NULLIF(TRIM(pitcher),''),'')<>''`
];

function toFirstLast(value){const raw=String(value??'').trim();if(!raw) return '';if(!raw.includes(',')) return raw.replace(/\s+/g,' ').trim();const [last,...rest]=raw.split(',');return `${rest.join(' ').trim()} ${last.trim()}`.replace(/\s+/g,' ').trim();}
function buildNameKeys(value){const raw=String(value??'').trim();if(!raw) return [];const base=raw.replace(/\s+/g,' ').trim();const fl=toFirstLast(base);const as=v=>v.toLowerCase().replace(/[^a-z0-9]/g,'');const set=new Set([as(base),as(fl)].filter(Boolean));const t=fl.split(/\s+/).filter(Boolean);if(t.length===2)set.add(as(`${t[1]} ${t[0]}`));return [...set];}
function secFromTm(raw){const text=String(raw??'').trim();if(!text) return null;const m=text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?\s*(AM|PM)?/i);if(!m) return null;let h=Number(m[1]??0);const mi=Number(m[2]??0);const s=Number(m[3]??0);const ap=String(m[5]??'').toUpperCase();if(ap==='PM'&&h<12)h+=12;if(ap==='AM'&&h===12)h=0;if(![h,mi,s].every(Number.isFinite)) return null;return h*3600+mi*60+s;}
function secFromIso(iso){if(!iso)return null;const d=new Date(iso);if(!Number.isFinite(d.getTime())) return null;const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/Phoenix',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d);const h=Number(p.find(x=>x.type==='hour')?.value??NaN);const m=Number(p.find(x=>x.type==='minute')?.value??NaN);const s=Number(p.find(x=>x.type==='second')?.value??NaN);if(![h,m,s].every(Number.isFinite))return null;return h*3600+m*60+s;}
function dateKey(iso){const d=new Date(iso);if(!Number.isFinite(d.getTime()))return null;const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Phoenix',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);return `${p.find(x=>x.type==='year')?.value}${p.find(x=>x.type==='month')?.value}${p.find(x=>x.type==='day')?.value}`;}

let tmMap=new Map();
for(let i=0;i<variants.length;i++){
  try{
    const r=await client.query(variants[i],[school,start,end]);
    const map=new Map();
    for(const row of r.rows){
      const dk=String(row.session_date??'').replace(/-/g,'');
      const v=Number(row.velo);
      if(!dk||!Number.isFinite(v)) continue;
      for(const k of buildNameKeys(row.pitcher)){
        const key=`${k}|${dk}`;
        const arr=map.get(key)||[];
        arr.push({tSec:secFromTm(row.tm_time),velo:v,pt:String(row.pt??'').trim()||null,p:row.pitcher});
        map.set(key,arr);
      }
    }
    console.log('variant',i+1,'rows',r.rows.length,'mappedKeys',map.size);
    if(map.size>0){tmMap=map;break;}
  }catch(e){console.log('variant',i+1,'err',String(e.message||e));}
}

let total=0, noNameDate=0, noTimed=0, over5=0, good=0;
for(const row of allRes.rows){
  const j=row.row_json||{};
  const name=(j.Player||j.Name||j.Pitcher||`${j['First Name']||''} ${j['Last Name']||''}`.trim()||'').toString().trim();
  const dk=dateKey(row.captured_at);
  const t=secFromIso(row.captured_at);
  total++;
  const rows=buildNameKeys(name).flatMap(k=>tmMap.get(`${k}|${dk}`)||[]);
  if(!rows.length){noNameDate++; continue;}
  const timed=rows.filter(r=>r.tSec!=null);
  if(!timed.length){noTimed++; continue;}
  let best=1e9;
  for(const tr of timed) best=Math.min(best,Math.abs(tr.tSec-t));
  if(best<=5) good++; else over5++;
}
console.log({total,noNameDate,noTimed,over5,good});
await client.end();

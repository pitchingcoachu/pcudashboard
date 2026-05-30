import { Client } from 'pg';

const school = 'PCU';
const orgId = 1;
const start = '2026-05-28';
const end = '2026-05-29';

const client = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL });
await client.connect();

const allRes = await client.query(`
  SELECT source_file_hash, row_index, captured_at, row_json
  FROM biomechanics_pitch_rows
  WHERE organization_id=$1 AND school_code=$2
    AND captured_at::date BETWEEN $3::date AND $4::date
  ORDER BY captured_at ASC, row_index ASC
`, [orgId, school, start, end]);

const singleRes = await client.query(`
  SELECT u.source_file_hash, u.source_file_name, p.captured_at, p.t
  FROM biomechanics_uploads u
  LEFT JOIN biomechanics_single_pitch_points p
    ON p.organization_id=u.organization_id
   AND p.school_code=u.school_code
   AND p.source_file_hash=u.source_file_hash
   AND p.point_index=0
  WHERE u.organization_id=$1 AND u.school_code=$2
    AND u.upload_kind='single_pitch'
    AND COALESCE(p.captured_at, u.created_at)::date BETWEEN $3::date AND $4::date
  ORDER BY COALESCE(p.captured_at, u.created_at) ASC
`, [orgId, school, start, end]);

const tmRes = await client.query(`
  SELECT pitcher, session_date, time, relspeed, taggedpitchtype
  FROM pitch_events
  WHERE school_code=$1
    AND session_date BETWEEN $2::date AND $3::date
    AND relspeed IS NOT NULL
  ORDER BY session_date, time
`, [school, start, end]);

function secFromIso(iso){
  if(!iso) return null;
  const d=new Date(iso);
  if(!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/Phoenix',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d);
  const h=Number(parts.find(p=>p.type==='hour')?.value ?? NaN);
  const m=Number(parts.find(p=>p.type==='minute')?.value ?? NaN);
  const s=Number(parts.find(p=>p.type==='second')?.value ?? NaN);
  if(![h,m,s].every(Number.isFinite)) return null;
  return h*3600+m*60+s;
}
function dateKeyIso(iso){
  if(!iso) return null;
  const d = new Date(iso);
  if(!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Phoenix',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  const y=parts.find(p=>p.type==='year')?.value; const m=parts.find(p=>p.type==='month')?.value; const da=parts.find(p=>p.type==='day')?.value;
  return y&&m&&da?`${y}${m}${da}`:null;
}
function secFromTm(raw){
  const text = String(raw ?? '').trim();
  const m = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?\s*(AM|PM)?/i);
  if(!m) return null;
  let h=Number(m[1]??0); const mi=Number(m[2]??0); const s=Number(m[3]??0); const ap=String(m[5]??'').toUpperCase();
  if(ap==='PM' && h<12) h+=12; if(ap==='AM' && h===12) h=0;
  if(![h,mi,s].every(Number.isFinite)) return null;
  return h*3600+mi*60+s;
}
function normName(v){return String(v??'').trim().toLowerCase().replace(/\./g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function nameKeys(v){
  const raw=String(v??'').trim(); if(!raw) return [];
  const base = raw.replace(/\s+/g,' ').trim();
  const firstLast = base.includes(',') ? `${base.split(',').slice(1).join(' ').trim()} ${base.split(',')[0].trim()}`.replace(/\s+/g,' ').trim() : base;
  const as = s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
  const set=new Set([as(base),as(firstLast)].filter(Boolean));
  const t=firstLast.split(/\s+/).filter(Boolean); if(t.length===2) set.add(as(`${t[1]} ${t[0]}`));
  return [...set];
}

const allRows = allRes.rows.map(r=>{
  const j = r.row_json || {};
  const name = (j.Player||j.Name||j.Pitcher||`${j['First Name']||''} ${j['Last Name']||''}`.trim()||'Unknown').toString().trim();
  return {hash:r.source_file_hash, cap:r.captured_at, dateKey:dateKeyIso(r.captured_at), tSec:secFromIso(r.captured_at), name};
}).filter(r=>r.dateKey);
const singleRows = singleRes.rows.map(r=>{
  const t = Number(r.t);
  const tIso = Number.isFinite(t) && t>1e10 ? new Date(t).toISOString() : null;
  const tSec = tIso ? secFromIso(tIso) : secFromIso(r.captured_at);
  const dateKey = tIso ? dateKeyIso(tIso) : dateKeyIso(r.captured_at);
  return {hash:r.source_file_hash, file:r.source_file_name, cap:r.captured_at, tRaw:r.t, tIso, tSec, dateKey};
}).filter(r=>r.dateKey);

const tmMap = new Map();
for(const r of tmRes.rows){
  const dk = String(r.session_date||'').replace(/-/g,'');
  for(const k of nameKeys(r.pitcher)){
    const kk=`${k}|${dk}`;
    const arr=tmMap.get(kk)||[];
    arr.push({tSec:secFromTm(r.time), velo:Number(r.relspeed), pt:r.taggedpitchtype, p:r.pitcher});
    tmMap.set(kk,arr);
  }
}

const byDate = new Map();
for(const r of allRows){const a=byDate.get(r.dateKey)||[];a.push(r);byDate.set(r.dateKey,a);} 
for(const r of singleRows){const a=byDate.get(`s|${r.dateKey}`)||[];a.push(r);byDate.set(`s|${r.dateKey}`,a);} 

for(const dk of ['20260528','20260529']){
  const alls=[...(byDate.get(dk)||[])].sort((a,b)=>(a.tSec??1e9)-(b.tSec??1e9));
  const singles=[...(byDate.get(`s|${dk}`)||[])].sort((a,b)=>(a.tSec??1e9)-(b.tSec??1e9));
  console.log('\nDATE',dk,'all',alls.length,'single',singles.length);
  let missingSingleTime=0; for(const s of singles){ if(s.tSec==null) missingSingleTime++; }
  console.log('single missing tSec',missingSingleTime);
  const used=new Set();
  let gt5=0; let noTm=0; let noTmIn5=0;
  for(const s of singles){
    let bi=-1, bd=1e9;
    for(let i=0;i<alls.length;i++){
      if(used.has(i)) continue;
      const at=alls[i].tSec;
      if(s.tSec==null || at==null) continue;
      const d=Math.abs(at-s.tSec);
      if(d<bd){bd=d;bi=i;}
    }
    if(bi<0){for(let i=0;i<alls.length;i++){if(!used.has(i)){bi=i;break;}}}
    if(bi<0) continue;
    used.add(bi);
    if(!Number.isFinite(bd) || bd>5) gt5++;
    const a=alls[bi];
    const keys=nameKeys(a.name);
    const tmRows=keys.flatMap(k=>tmMap.get(`${k}|${dk}`)||[]).filter(x=>x.tSec!=null);
    if(!tmRows.length){noTm++; continue;}
    let best=1e9; for(const t of tmRows){best=Math.min(best,Math.abs(t.tSec-a.tSec));}
    if(best>5) noTmIn5++;
  }
  console.log('all match delta >5s',gt5,'no tm rows',noTm,'tm delta >5s',noTmIn5);
}

await client.end();

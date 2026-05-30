import { Client } from 'pg';
const client = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL });
await client.connect();

const allRes = await client.query(`
SELECT DISTINCT
  COALESCE(NULLIF(TRIM((row_json->>'Player')),''), NULLIF(TRIM((row_json->>'Name')),''), NULLIF(TRIM((row_json->>'Pitcher')),''), TRIM(COALESCE(row_json->>'First Name','') || ' ' || COALESCE(row_json->>'Last Name',''))) AS name
FROM biomechanics_pitch_rows
WHERE organization_id=1 AND school_code='PCU'
  AND captured_at::date BETWEEN '2026-05-28'::date AND '2026-05-29'::date
ORDER BY 1
`);
const tmRes = await client.query(`
SELECT DISTINCT COALESCE(NULLIF(TRIM(pitcher),''),'') AS pitcher
FROM pitch_events
WHERE school_code='PCU'
  AND session_date BETWEEN '2026-05-28'::date AND '2026-05-29'::date
ORDER BY 1
`);

const norm = (v)=>String(v??'').trim().toLowerCase().replace(/\./g,'').replace(/[^a-z0-9]+/g,'');
const toFirstLast=(v)=>{const s=String(v??'').trim();if(!s) return '';if(!s.includes(',')) return s.replace(/\s+/g,' ').trim();const [last,...rest]=s.split(',');return `${rest.join(' ').trim()} ${last.trim()}`.replace(/\s+/g,' ').trim();};
const keys=(v)=>{const b=String(v??'').replace(/\s+/g,' ').trim();const fl=toFirstLast(b);const as=(x)=>x.toLowerCase().replace(/[^a-z0-9]/g,'');const set=new Set([as(b),as(fl)].filter(Boolean));const t=fl.split(/\s+/).filter(Boolean);if(t.length===2)set.add(as(`${t[1]} ${t[0]}`));return [...set];};

const allNames = allRes.rows.map(r=>String(r.name??'').trim()).filter(Boolean);
const tmNames = tmRes.rows.map(r=>String(r.pitcher??'').trim()).filter(Boolean);
const tmKeySet = new Set(tmNames.flatMap(keys));

console.log('ALL distinct names:', allNames.length);
for(const n of allNames){
  const ks = keys(n);
  const hit = ks.some(k=>tmKeySet.has(k));
  console.log(hit ? 'MATCH' : 'MISS', '|', n, '| keys=', ks.join(','));
}
console.log('\nTM distinct names:', tmNames.length);
for(const n of tmNames){
  console.log('-', n, '| keys=', keys(n).join(','));
}

await client.end();

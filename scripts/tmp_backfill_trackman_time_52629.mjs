import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

function parseCsv(text) {
  const out = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let field = '';
  let current = [];
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i] ?? '';
    const next = normalized[i + 1] ?? '';
    if (ch === '"') {
      if (inQuotes && next === '"') { field += '"'; i += 1; } else { inQuotes = !inQuotes; }
      continue;
    }
    if (ch === ',' && !inQuotes) { current.push(field); field = ''; continue; }
    if (ch === '\n' && !inQuotes) { current.push(field); rows.push(current); current = []; field = ''; continue; }
    field += ch;
  }
  current.push(field); rows.push(current);
  const headers = (rows.shift() ?? []).map((h) => String(h ?? '').trim());
  if (!headers.length || headers.every((h) => !h)) return [];
  for (const row of rows) {
    if (!row.length) continue;
    const rec = {};
    let hasValue = false;
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i] ?? `Column ${i+1}`;
      const val = String(row[i] ?? '').trim();
      if (val) hasValue = true;
      rec[key] = val;
    }
    if (hasValue) out.push(rec);
  }
  return out;
}

async function walkCsv(dir) {
  const out = [];
  const ents = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of ents) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walkCsv(full));
    else if (ent.isFile() && ent.name.toLowerCase().endsWith('.csv')) out.push(full);
  }
  return out;
}

const root = path.resolve('./trackman files');
const files = await walkCsv(root);
const pairs = [];
for (const f of files) {
  const txt = await fs.readFile(f, 'utf8');
  const rows = parseCsv(txt);
  for (const r of rows) {
    const pitchuid = String(r.PitchUID ?? r.pitchuid ?? r.pitchUid ?? '').trim();
    const tm = String(r.Time ?? r.time ?? '').trim();
    if (!pitchuid || !tm) continue;
    pairs.push([pitchuid, tm]);
  }
}
const dedup = new Map();
for (const [u,t] of pairs) if (!dedup.has(u)) dedup.set(u, t);
const entries = [...dedup.entries()];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL });
const client = await pool.connect();
let updated = 0;
try {
  const chunk = 500;
  for (let i = 0; i < entries.length; i += chunk) {
    const batch = entries.slice(i, i + chunk);
    const vals = [];
    const placeholders = [];
    for (let j = 0; j < batch.length; j += 1) {
      const base = j * 2;
      placeholders.push(`($${base+1},$${base+2})`);
      vals.push(batch[j][0], batch[j][1]);
    }
    const sql = `
      UPDATE pitch_events pe
      SET time = src.tm_time
      FROM (VALUES ${placeholders.join(',')}) AS src(pitchuid, tm_time)
      WHERE pe.school_code = 'PCU'
        AND pe.session_date BETWEEN DATE '2026-05-26' AND DATE '2026-05-29'
        AND pe.pitchuid = src.pitchuid
        AND (pe.time IS NULL OR btrim(pe.time) = '')
    `;
    const res = await client.query(sql, vals);
    updated += Number(res.rowCount || 0);
  }

  const check = await client.query(`
    SELECT
      session_date::text,
      COUNT(*)::int AS total_rows,
      SUM(CASE WHEN time IS NOT NULL AND btrim(time) <> '' THEN 1 ELSE 0 END)::int AS rows_with_time
    FROM pitch_events
    WHERE school_code='PCU'
      AND session_date BETWEEN DATE '2026-05-26' AND DATE '2026-05-29'
    GROUP BY 1
    ORDER BY 1
  `);
  console.log(JSON.stringify({ files: files.length, csv_pitchuid_time_pairs: pairs.length, unique_pitchuids: entries.length, rows_updated: updated, verify: check.rows }, null, 2));
} finally {
  client.release();
  await pool.end();
}

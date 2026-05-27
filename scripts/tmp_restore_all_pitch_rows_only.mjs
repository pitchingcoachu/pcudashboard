import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ORG_ID = Number(process.env.ORG_ID || 1);
const SCHOOL_CODE = String(process.env.SCHOOL_CODE || 'PCU').trim().toUpperCase();
const FILE_PATH = String(process.env.ALL_PITCH_FILE || 'Axioforce/All pitch CSVs/metrics_export_20260525_194847.csv');

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not configured.');
  process.exit(1);
}

function canonicalKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function pickValueCaseInsensitive(row, keys) {
  const index = new Map();
  for (const [k, v] of Object.entries(row)) index.set(canonicalKey(k), v);
  for (const key of keys) {
    const v = index.get(canonicalKey(key));
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function toDateOrNull(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const normalized = raw.includes(' ') && /^\d{4}-\d{2}-\d{2}\s+\d/.test(raw) ? raw.replace(/\s+/, 'T') : raw;
  const d = new Date(normalized);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function parseUsDateTimeToIso(value) {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  let hour = Number(m[4] ?? 0);
  const minute = Number(m[5] ?? 0);
  const second = Number(m[6] ?? 0);
  const ampm = String(m[7] ?? '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  const dt = new Date(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.toISOString();
}

function parseCapturedAtFromRow(row) {
  const raw = pickValueCaseInsensitive(row, [
    'date',
    'recorded_date',
    'recorded',
    'pitch_date',
    'capture date/time',
    'capture date/time (america/phoenix)',
    'capture datetime',
    'timestamp',
    'time (unix ms)',
    'unix ms',
    'time',
    'datetime',
    'date_time',
    'utc_time',
  ]);
  if (raw === null) return null;
  const asString = String(raw).trim();
  if (!asString) return null;
  const numeric = Number(asString);
  if (Number.isFinite(numeric) && numeric > 10_000_000_000) return new Date(numeric).toISOString();
  return toDateOrNull(asString) ?? parseUsDateTimeToIso(asString);
}

function parsePitchLabelFromRow(row, fallback) {
  const pitchNo = pickValueCaseInsensitive(row, ['pitch_no', 'pitch number', 'pitch_number', 'pitch#']);
  const pitchType = pickValueCaseInsensitive(row, ['pitch_type', 'pitch type', 'type']);
  const athlete = pickValueCaseInsensitive(row, ['player', 'pitcher', 'athlete', 'name']);
  const pieces = [athlete, pitchType, pitchNo].map((v) => String(v ?? '').trim()).filter(Boolean);
  return pieces.length ? pieces.join(' | ') : fallback;
}

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
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      current.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' && !inQuotes) {
      current.push(field);
      rows.push(current);
      current = [];
      field = '';
      continue;
    }
    field += ch;
  }
  current.push(field);
  rows.push(current);

  const headers = (rows.shift() ?? []).map((h) => String(h ?? '').trim());
  if (!headers.length || headers.every((h) => !h)) return [];

  for (const row of rows) {
    if (!row.length) continue;
    const record = {};
    let hasValue = false;
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i] ?? `Column ${i + 1}`;
      const value = String(row[i] ?? '').trim();
      if (value) hasValue = true;
      record[key] = value;
    }
    if (hasValue) out.push(record);
  }
  return out;
}

const fileName = path.basename(FILE_PATH);
const csvContent = await fs.readFile(FILE_PATH, 'utf8');
const rows = parseCsv(csvContent);
const sourceFileHash = createHash('sha256').update(csvContent).digest('hex');

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();

try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '2s'");
  await client.query("SET LOCAL statement_timeout = '120s'");

  const existingUpload = await client.query(
    `SELECT id FROM biomechanics_uploads
     WHERE organization_id = $1 AND school_code = $2 AND upload_kind = 'all_pitches' AND source_file_hash = $3
     LIMIT 1 FOR UPDATE`,
    [ORG_ID, SCHOOL_CODE, sourceFileHash]
  );

  let uploadId = Number(existingUpload.rows[0]?.id ?? 0);
  if (uploadId > 0) {
    await client.query(
      `UPDATE biomechanics_uploads
       SET source_file_name = $4, row_count = $5, created_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND school_code = $3`,
      [uploadId, ORG_ID, SCHOOL_CODE, fileName, rows.length]
    );
  } else {
    const inserted = await client.query(
      `INSERT INTO biomechanics_uploads
       (organization_id, school_code, upload_kind, source_file_name, source_file_hash, row_count, created_by_user_id)
       VALUES ($1,$2,'all_pitches',$3,$4,$5,NULL)
       RETURNING id`,
      [ORG_ID, SCHOOL_CODE, fileName, sourceFileHash, rows.length]
    );
    uploadId = Number(inserted.rows[0]?.id ?? 0);
  }

  await client.query(
    `DELETE FROM biomechanics_pitch_rows
     WHERE organization_id = $1 AND school_code = $2 AND source_file_hash = $3`,
    [ORG_ID, SCHOOL_CODE, sourceFileHash]
  );

  let insertedRows = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? {};
    const capturedAt = parseCapturedAtFromRow(row);
    const pitchLabel = parsePitchLabelFromRow(row, `${fileName} | Row ${i + 1}`);
    const result = await client.query(
      `INSERT INTO biomechanics_pitch_rows
       (organization_id, school_code, upload_id, source_file_hash, row_index, captured_at, pitch_label, row_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [ORG_ID, SCHOOL_CODE, uploadId, sourceFileHash, i, capturedAt, pitchLabel, JSON.stringify(row)]
    );
    insertedRows += Number(result.rowCount ?? 0);
  }

  const finalCount = await client.query(
    `SELECT COUNT(*)::int AS n FROM biomechanics_pitch_rows WHERE organization_id = $1 AND school_code = $2`,
    [ORG_ID, SCHOOL_CODE]
  );

  await client.query('COMMIT');

  console.log(JSON.stringify({
    organization_id: ORG_ID,
    school_code: SCHOOL_CODE,
    source_file: FILE_PATH,
    restored_rows: insertedRows,
    final_all_pitch_rows: Number(finalCount.rows[0]?.n ?? 0),
  }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

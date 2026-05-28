import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

const ORG_ID = 1;
const SCHOOL_CODE = 'PCU';
const ROOT = '/Users/jaredgaynor/Documents/GitHub/pcudashboard/Axioforce';
const ALL_PITCH_DIR = path.join(ROOT, 'All pitch CSVs');
const SINGLE_PITCH_DIR = path.join(ROOT, 'Single Pitch CSVs', 'Axioforce');

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

function pickStringCaseInsensitive(row, keys) {
  const value = pickValueCaseInsensitive(row, keys);
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function toFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
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
  const m = raw.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );
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
    'capture date/time (american/phoenix)',
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
  if (Number.isFinite(numeric) && numeric > 10000000000) return new Date(numeric).toISOString();
  return toDateOrNull(asString) ?? parseUsDateTimeToIso(asString);
}

function parsePitchLabelFromRow(row, fallback) {
  const pitchNo = pickValueCaseInsensitive(row, ['pitch_no', 'pitch number', 'pitch_number', 'pitch#']);
  const pitchType = pickValueCaseInsensitive(row, ['pitch_type', 'pitch type', 'type']);
  const athlete = pickValueCaseInsensitive(row, ['player', 'pitcher', 'athlete', 'name']);
  const pieces = [athlete, pitchType, pitchNo].map((part) => String(part ?? '').trim()).filter(Boolean);
  if (pieces.length) return pieces.join(' | ');
  return fallback;
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ');
}

function normalizePhase(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'loading') return 'loading';
  if (normalized === 'delivery') return 'delivery';
  return null;
}

function computePitchMetrics(points) {
  const isMoundDevice = (value) => {
    const normalized = String(value ?? '').toLowerCase();
    return normalized.includes('pitching mound.drive') || normalized.includes('pitching mound.parent');
  };
  const isParentDevice = (value) => String(value ?? '').toLowerCase().includes('pitching mound.parent');
  const isDriveDevice = (value) => String(value ?? '').toLowerCase().includes('pitching mound.drive');
  const phasePoints = points.filter((point) => normalizePhase(point.phase_name));
  const moundPoints = phasePoints.filter((point) => isMoundDevice(point.device_id));
  const hasParent = moundPoints.some((point) => isParentDevice(point.device_id));
  const sourcePoints = moundPoints.filter((point) => (hasParent ? isParentDevice(point.device_id) : isDriveDevice(point.device_id)));
  const rawTimes = sourcePoints.map((point) => toFinite(point.t)).filter((v) => v !== null);
  if (!rawTimes.length) {
    return {
      backPeakFz: null, backPeakFy: null, moundConnection: null, impulse: null, yzTransferBack: null,
      leadPeakFz: null, leadPeakFy: null, clawbackTime: null, yzTransferFront: null, yTransfer: null, zTransfer: null,
    };
  }
  const minRawTime = Math.min(...rawTimes);
  const maxRawTime = Math.max(...rawTimes);
  const rawRange = maxRawTime - minRawTime;
  const treatAsMs = rawRange > 1000 || minRawTime > 100000;
  const normalizedPoints = sourcePoints.map((point) => {
    const rawT = toFinite(point.t);
    if (rawT === null) return null;
    const t = treatAsMs ? (rawT - minRawTime) / 1000 : (rawT - minRawTime);
    return { t, fy: toFinite(point.fy), fz: toFinite(point.fz), phase: normalizePhase(point.phase_name) };
  }).filter((point) => point !== null && point.phase !== null);

  const loading = normalizedPoints.filter((p) => p.phase === 'loading').map((p) => ({ t: p.t, fy: p.fy, fz: p.fz })).sort((a, b) => a.t - b.t);
  const delivery = normalizedPoints.filter((p) => p.phase === 'delivery').map((p) => ({ t: p.t, fy: p.fy, fz: p.fz })).sort((a, b) => a.t - b.t);

  const maxBy = (arr) => arr.filter((r) => r.v !== null).reduce((best, row) => (!best || row.v > best.v ? { t: row.t, v: row.v } : best), null);
  const minBy = (arr) => arr.filter((r) => r.v !== null).reduce((best, row) => (!best || row.v < best.v ? { t: row.t, v: row.v } : best), null);
  const integrateTrapezoid = (arr) => {
    if (arr.length < 2) return 0;
    let area = 0;
    for (let i = 0; i < arr.length - 1; i += 1) {
      const a = arr[i];
      const b = arr[i + 1];
      area += ((a.v + b.v) / 2) * Math.max(0, b.t - a.t);
    }
    return area;
  };

  const backPeakFz = maxBy(loading.map((p) => ({ t: p.t, v: p.fz })));
  const backPeakFy = maxBy(loading.map((p) => ({ t: p.t, v: p.fy })));
  const leadPeakFz = maxBy(delivery.map((p) => ({ t: p.t, v: p.fz })));
  const leadPeakFy = minBy(delivery.map((p) => ({ t: p.t, v: p.fy })));
  const firstLeadFz = delivery.find((p) => p.fz !== null);
  const backFzBeforeLead = firstLeadFz
    ? loading.filter((p) => p.fz !== null && p.t <= firstLeadFz.t).sort((a, b) => a.t - b.t).at(-1)?.fz ?? null
    : null;

  let impulse = null;
  if (loading.length > 2) {
    const peakFz = maxBy(loading.map((p) => ({ t: p.t, v: p.fz })));
    const peakZIdx = peakFz ? loading.findIndex((p) => p.t === peakFz.t && p.fz === peakFz.v) : -1;
    let startIdx = -1;
    if (peakZIdx > 1 && peakFz) {
      const windowStartTime = peakFz.t - 0.7;
      const candidates = [];
      for (let i = 0; i < peakZIdx; i += 1) if (loading[i]?.t >= windowStartTime) candidates.push(i);
      if (candidates.length) {
        let minIdx = candidates[0];
        for (const idx of candidates) {
          const curr = loading[idx]?.fz;
          const best = loading[minIdx]?.fz;
          if (curr === null || curr === undefined) continue;
          if (best === null || best === undefined || curr < best) minIdx = idx;
        }
        startIdx = minIdx;
      }
    }
    if (startIdx >= 0) {
      const loadingFromStart = loading.slice(startIdx);
      const peakFyFromStart = maxBy(loadingFromStart.map((p) => ({ t: p.t, v: p.fy })));
      let endIdx = loading.length - 1;
      if (peakFyFromStart) {
        const peakIdx = loading.findIndex((p) => p.t === peakFyFromStart.t && p.fy === peakFyFromStart.v);
        if (peakIdx >= 0) {
          for (let i = peakIdx + 1; i < loading.length; i += 1) {
            const fy = loading[i]?.fy;
            if (fy !== null && fy <= 0) {
              endIdx = i;
              break;
            }
          }
        }
      }
      const impulseWindow = loading
        .slice(startIdx, endIdx + 1)
        .filter((p) => p.fy !== null)
        .map((p) => ({ t: p.t, v: Math.max(0, Number(p.fy)) }));
      impulse = integrateTrapezoid(impulseWindow);
    }
  }

  let clawbackTime = null;
  const landingIdx = delivery.findIndex((p) => (p.fy ?? 0) < 0);
  if (landingIdx >= 0) {
    const recover = delivery.slice(landingIdx + 1).find((p) => (p.fy ?? Number.NEGATIVE_INFINITY) >= 0);
    if (recover) clawbackTime = Math.max(0, recover.t - delivery[landingIdx].t);
  }

  return {
    backPeakFz: backPeakFz?.v ?? null,
    backPeakFy: backPeakFy?.v ?? null,
    moundConnection: backFzBeforeLead,
    impulse,
    yzTransferBack: backPeakFy && backPeakFz ? Math.abs(backPeakFy.t - backPeakFz.t) : null,
    leadPeakFz: leadPeakFz?.v ?? null,
    leadPeakFy: leadPeakFy?.v ?? null,
    clawbackTime,
    yzTransferFront: leadPeakFy && leadPeakFz ? Math.abs(leadPeakFy.t - leadPeakFz.t) : null,
    yTransfer: backPeakFy && leadPeakFy ? Math.abs(leadPeakFy.t - backPeakFy.t) : null,
    zTransfer: backPeakFz && leadPeakFz ? Math.abs(leadPeakFz.t - backPeakFz.t) : null,
  };
}

async function upsertUpload(client, { uploadKind, sourceFileName, sourceFileHash, rowCount }) {
  const existing = await client.query(
    `SELECT id FROM biomechanics_uploads WHERE organization_id = $1 AND school_code = $2 AND upload_kind = $3 AND source_file_hash = $4 LIMIT 1`,
    [ORG_ID, SCHOOL_CODE, uploadKind, sourceFileHash]
  );
  if (existing.rowCount) {
    const id = Number(existing.rows[0].id);
    await client.query(
      `UPDATE biomechanics_uploads
       SET source_file_name = $4, row_count = $5, created_by_user_id = NULL, created_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND school_code = $3`,
      [id, ORG_ID, SCHOOL_CODE, sourceFileName, rowCount]
    );
    return id;
  }
  const inserted = await client.query(
    `INSERT INTO biomechanics_uploads (organization_id, school_code, upload_kind, source_file_name, source_file_hash, row_count, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,NULL)
     RETURNING id`,
    [ORG_ID, SCHOOL_CODE, uploadKind, sourceFileName, sourceFileHash, rowCount]
  );
  return Number(inserted.rows[0].id);
}

async function clearBiomech(client) {
  await client.query(`DELETE FROM biomechanics_pitch_metrics WHERE organization_id = $1 AND school_code = $2`, [ORG_ID, SCHOOL_CODE]);
  await client.query(`DELETE FROM biomechanics_single_pitch_points WHERE organization_id = $1 AND school_code = $2`, [ORG_ID, SCHOOL_CODE]);
  await client.query(`DELETE FROM biomechanics_pitch_rows WHERE organization_id = $1 AND school_code = $2`, [ORG_ID, SCHOOL_CODE]);
  await client.query(`DELETE FROM biomechanics_uploads WHERE organization_id = $1 AND school_code = $2`, [ORG_ID, SCHOOL_CODE]);
}

async function importAllPitchFile(client, filePath) {
  const sourceFileName = path.basename(filePath);
  const csvContent = await fs.readFile(filePath, 'utf8');
  const rows = parseCsv(csvContent);
  const sourceFileHash = createHash('sha256').update(csvContent).digest('hex');
  await client.query('BEGIN');
  try {
    const uploadId = await upsertUpload(client, { uploadKind: 'all_pitches', sourceFileName, sourceFileHash, rowCount: rows.length });
    await client.query(`DELETE FROM biomechanics_pitch_rows WHERE organization_id = $1 AND school_code = $2 AND source_file_hash = $3`, [ORG_ID, SCHOOL_CODE, sourceFileHash]);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const capturedAt = parseCapturedAtFromRow(row);
      const pitchLabel = parsePitchLabelFromRow(row, `Pitch ${i + 1}`);
      await client.query(
        `INSERT INTO biomechanics_pitch_rows (organization_id, school_code, upload_id, source_file_hash, row_index, captured_at, pitch_label, row_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [ORG_ID, SCHOOL_CODE, uploadId, sourceFileHash, i, capturedAt, pitchLabel, JSON.stringify(row)]
      );
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function importSinglePitchFile(client, filePath, idx, total) {
  const sourceFileName = path.basename(filePath);
  const csvContent = await fs.readFile(filePath, 'utf8');
  const rows = parseCsv(csvContent);
  const sourceFileHash = createHash('sha256').update(csvContent).digest('hex');
  const fallbackLabel = sourceFileName;
  const pitchLabel = parsePitchLabelFromRow(rows[0] ?? {}, fallbackLabel);
  const firstRow = rows[0] ?? {};
  const firstName = pickStringCaseInsensitive(firstRow, ['First Name', 'FirstName', 'first_name']) ?? '';
  const lastName = pickStringCaseInsensitive(firstRow, ['Last Name', 'LastName', 'last_name']) ?? '';
  const playerName = pickStringCaseInsensitive(firstRow, ['Player', 'Pitcher', 'Name']) ?? (`${firstName} ${lastName}`.trim() || null);
  const playerNorm = playerName ? normalizeName(playerName) : null;

  const pointsForMetrics = [];
  await client.query('BEGIN');
  try {
    const uploadId = await upsertUpload(client, { uploadKind: 'single_pitch', sourceFileName, sourceFileHash, rowCount: rows.length });
    await client.query(`DELETE FROM biomechanics_single_pitch_points WHERE organization_id = $1 AND school_code = $2 AND source_file_hash = $3`, [ORG_ID, SCHOOL_CODE, sourceFileHash]);
    await client.query(`DELETE FROM biomechanics_pitch_metrics WHERE organization_id = $1 AND school_code = $2 AND source_file_hash = $3`, [ORG_ID, SCHOOL_CODE, sourceFileHash]);

    const batchSize = 500;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      const values = [];
      const placeholders = [];
      for (let i = 0; i < batch.length; i += 1) {
        const row = batch[i];
        const pointIndex = offset + i;
        const t = toFinite(pickValueCaseInsensitive(row, ['time', 't', 'time (unix ms)', 'time_unix_ms', 'timestamp_ms', 'unix ms'])) ?? pointIndex;
        const fx = toFinite(pickValueCaseInsensitive(row, ['fx']));
        const fy = toFinite(pickValueCaseInsensitive(row, ['fy']));
        const fz = toFinite(pickValueCaseInsensitive(row, ['fz']));
        const mx = toFinite(pickValueCaseInsensitive(row, ['mx']));
        const my = toFinite(pickValueCaseInsensitive(row, ['my']));
        const mz = toFinite(pickValueCaseInsensitive(row, ['mz']));
        const capturedAt = parseCapturedAtFromRow(row);
        const phaseName = pickStringCaseInsensitive(row, ['Phase Name', 'Phase']);
        const deviceId = pickStringCaseInsensitive(row, ['Device Id', 'Device']);
        pointsForMetrics.push({ t, fx, fy, fz, mx, my, mz, phase_name: phaseName, device_id: deviceId });
        const base = i * 16;
        placeholders.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13}::jsonb,$${base + 14},$${base + 15},$${base + 16})`);
        values.push(
          ORG_ID, SCHOOL_CODE, uploadId, sourceFileHash, pointIndex, t, fx, fy, fz, mx, my, mz, JSON.stringify(row), capturedAt, pitchLabel, playerName
        );
      }
      const playerNormValues = [];
      for (let i = 0; i < batch.length; i += 1) playerNormValues.push(playerNorm);
      // append pitcher_name_norm separately by replacing INSERT statement columns
      const valuesWithNorm = [];
      const placeholdersWithNorm = [];
      for (let i = 0; i < batch.length; i += 1) {
        const base = i * 17;
        const rowVals = values.slice(i * 16, i * 16 + 16);
        valuesWithNorm.push(...rowVals, playerNormValues[i]);
        placeholdersWithNorm.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13}::jsonb,$${base + 14},$${base + 15},$${base + 16},$${base + 17})`);
      }
      await client.query(
        `INSERT INTO biomechanics_single_pitch_points
         (organization_id, school_code, upload_id, source_file_hash, point_index, t, fx, fy, fz, mx, my, mz, row_json, captured_at, pitch_label, pitcher_name, pitcher_name_norm)
         VALUES ${placeholdersWithNorm.join(',')}`,
        valuesWithNorm
      );
    }

    const computed = computePitchMetrics(pointsForMetrics);
    await client.query(
      `INSERT INTO biomechanics_pitch_metrics
      (organization_id, school_code, source_file_hash, back_peak_fz, back_peak_fy, mound_connection, impulse, impulse_time, yz_transfer_back, lead_peak_fz, lead_peak_fy, clawback_time, yz_transfer_front, y_transfer, z_transfer)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        ORG_ID, SCHOOL_CODE, sourceFileHash, computed.backPeakFz, computed.backPeakFy, computed.moundConnection, computed.impulse,
        computed.impulseTime ?? null, computed.yzTransferBack, computed.leadPeakFz, computed.leadPeakFy, computed.clawbackTime, computed.yzTransferFront,
        computed.yTransfer, computed.zTransfer,
      ]
    );
    await client.query('COMMIT');
    if (idx % 25 === 0 || idx === total) {
      console.log(`single-pitch imported ${idx}/${total}`);
    }
    return rows.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL missing');

  const allFiles = (await fs.readdir(ALL_PITCH_DIR)).filter((f) => f.toLowerCase().endsWith('.csv')).map((f) => path.join(ALL_PITCH_DIR, f));
  const singleFiles = (await fs.readdir(SINGLE_PITCH_DIR)).filter((f) => f.toLowerCase().endsWith('.csv')).sort().map((f) => path.join(SINGLE_PITCH_DIR, f));
  if (!allFiles.length) throw new Error('No all-pitch CSV files found.');
  if (!singleFiles.length) throw new Error('No single-pitch CSV files found.');

  const pool = new Pool({ connectionString: dbUrl });
  const client = await pool.connect();
  try {
    console.log(`found all-pitch files: ${allFiles.length}`);
    console.log(`found single-pitch files: ${singleFiles.length}`);
    await client.query('BEGIN');
    await clearBiomech(client);
    await client.query('COMMIT');
    console.log('cleared existing biomechanics data');

    let allRowsInserted = 0;
    for (const file of allFiles) {
      const count = await importAllPitchFile(client, file);
      allRowsInserted += count;
      console.log(`all-pitch imported: ${path.basename(file)} (${count} rows)`);
    }

    let singlePointsInserted = 0;
    for (let i = 0; i < singleFiles.length; i += 1) {
      const count = await importSinglePitchFile(client, singleFiles[i], i + 1, singleFiles.length);
      singlePointsInserted += count;
    }

    const verify = await client.query(
      `SELECT
        (SELECT COUNT(*) FROM biomechanics_pitch_rows WHERE organization_id = $1 AND school_code = $2)::int AS all_pitch_rows,
        (SELECT COUNT(DISTINCT source_file_hash) FROM biomechanics_single_pitch_points WHERE organization_id = $1 AND school_code = $2)::int AS single_files,
        (SELECT COUNT(*) FROM biomechanics_single_pitch_points WHERE organization_id = $1 AND school_code = $2)::bigint AS single_points,
        (SELECT COUNT(*) FROM biomechanics_pitch_metrics WHERE organization_id = $1 AND school_code = $2)::int AS metrics_rows`,
      [ORG_ID, SCHOOL_CODE]
    );
    console.log(JSON.stringify({
      imported: { allRowsInserted, singlePointsInserted, singleFileCount: singleFiles.length },
      verify: verify.rows[0],
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(String(err?.stack ?? err?.message ?? err));
  process.exit(1);
});

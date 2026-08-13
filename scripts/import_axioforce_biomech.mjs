import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

const ORG_ID = Number(process.env.AXIOFORCE_ORGANIZATION_ID ?? 1);
const SCHOOL_CODE = String(process.env.AXIOFORCE_SCHOOL_CODE ?? 'PCU').trim().toUpperCase();
const ROOT = path.resolve(process.env.AXIOFORCE_ROOT ?? path.join(process.cwd(), 'Axioforce'));
const ALL_PITCH_DIR = path.join(ROOT, 'All pitch CSVs');
const SINGLE_PITCH_DIR = path.join(ROOT, 'Single Pitch CSVs');
const IMPORT_MODE = String(process.env.AXIOFORCE_IMPORT_MODE ?? 'replace').trim().toLowerCase();
const GRAPH_CACHE_TARGET_POINTS = 600;

async function listCsvFilesRecursive(directory) {
  const files = [];
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listCsvFilesRecursive(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) files.push(fullPath);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function fileSha256(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function alreadyImported(client, uploadKind, filePath) {
  const sourceFileHash = await fileSha256(filePath);
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM biomechanics_uploads
       WHERE organization_id = $1 AND school_code = $2 AND upload_kind = $3 AND source_file_hash = $4
     ) AS has_upload,
     CASE WHEN $3 = 'single_pitch' THEN EXISTS (
       SELECT 1 FROM biomechanics_graph_cache
       WHERE organization_id = $1 AND school_code = $2 AND source_file_hash = $4
     ) ELSE TRUE END AS has_graph_cache`,
    [ORG_ID, SCHOOL_CODE, uploadKind, sourceFileHash]
  );
  return Boolean(result.rows[0]?.has_upload && result.rows[0]?.has_graph_cache);
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

function inferPlayerNameFromPath(filePath) {
  const folder = path.basename(path.dirname(filePath));
  const parts = folder.split(/[_-]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const [last, ...firstParts] = parts;
  return `${firstParts.join(' ')} ${last}`.trim() || null;
}

function lttbDownsample(points, targetCount) {
  const n = points.length;
  if (n <= targetCount) return points;
  if (targetCount < 3) return [points[0], points[n - 1]];
  const sampled = [points[0]];
  const bucketSize = (n - 2) / (targetCount - 2);
  let prevIdx = 0;
  for (let i = 0; i < targetCount - 2; i += 1) {
    const bucketStart = Math.floor(i * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n - 1);
    const nextBucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextBucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n - 1);
    let avgFz = 0;
    let avgT = 0;
    let avgCount = 0;
    for (let j = nextBucketStart; j < nextBucketEnd; j += 1) {
      const point = points[j];
      if (!point) continue;
      avgT += point.t;
      avgFz += point.fz ?? 0;
      avgCount += 1;
    }
    if (avgCount > 0) {
      avgT /= avgCount;
      avgFz /= avgCount;
    }
    const previous = points[prevIdx];
    let maxArea = -1;
    let maxIdx = bucketStart;
    for (let j = bucketStart; j < bucketEnd; j += 1) {
      const point = points[j];
      if (!point) continue;
      const area = Math.abs(
        (previous.t - avgT) * ((point.fz ?? 0) - (previous.fz ?? 0)) -
        (previous.t - point.t) * (avgFz - (previous.fz ?? 0))
      ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }
    sampled.push(points[maxIdx]);
    prevIdx = maxIdx;
  }
  sampled.push(points[n - 1]);
  return sampled;
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
  let impulseTime = null;
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
      const startT = loading[startIdx]?.t ?? null;
      const endT = loading[endIdx]?.t ?? null;
      impulseTime = startT !== null && endT !== null ? Math.max(0, endT - startT) : null;
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
    impulseTime,
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
  await client.query(`DELETE FROM biomechanics_graph_cache WHERE organization_id = $1 AND school_code = $2`, [ORG_ID, SCHOOL_CODE]);
  await client.query(`DELETE FROM biomechanics_single_pitch_points WHERE organization_id = $1 AND school_code = $2`, [ORG_ID, SCHOOL_CODE]);
  await client.query(`DELETE FROM biomechanics_pitch_rows WHERE organization_id = $1 AND school_code = $2`, [ORG_ID, SCHOOL_CODE]);
  await client.query(`DELETE FROM biomechanics_uploads WHERE organization_id = $1 AND school_code = $2`, [ORG_ID, SCHOOL_CODE]);
}

async function importAllPitchFile(client, filePath) {
  const sourceFileName = path.relative(ROOT, filePath);
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
  const sourceFileName = path.relative(ROOT, filePath);
  const csvContent = await fs.readFile(filePath, 'utf8');
  const rows = parseCsv(csvContent);
  const sourceFileHash = createHash('sha256').update(csvContent).digest('hex');
  const fallbackLabel = sourceFileName;
  const pitchLabel = parsePitchLabelFromRow(rows[0] ?? {}, fallbackLabel);
  const firstRow = rows[0] ?? {};
  const firstName = pickStringCaseInsensitive(firstRow, ['First Name', 'FirstName', 'first_name']) ?? '';
  const lastName = pickStringCaseInsensitive(firstRow, ['Last Name', 'LastName', 'last_name']) ?? '';
  const playerName = pickStringCaseInsensitive(firstRow, ['Player', 'Pitcher', 'Name']) ?? (`${firstName} ${lastName}`.trim() || inferPlayerNameFromPath(filePath));
  const playerNorm = playerName ? normalizeName(playerName) : null;
  const pitchCapturedAt = parseCapturedAtFromRow(firstRow);

  const pointsForMetrics = [];
  await client.query('BEGIN');
  try {
    const uploadId = await upsertUpload(client, { uploadKind: 'single_pitch', sourceFileName, sourceFileHash, rowCount: rows.length });
    await client.query(`DELETE FROM biomechanics_single_pitch_points WHERE organization_id = $1 AND school_code = $2 AND source_file_hash = $3`, [ORG_ID, SCHOOL_CODE, sourceFileHash]);
    await client.query(`DELETE FROM biomechanics_graph_cache WHERE organization_id = $1 AND school_code = $2 AND source_file_hash = $3`, [ORG_ID, SCHOOL_CODE, sourceFileHash]);
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
        const positionId = pickStringCaseInsensitive(row, ['Position Id', 'Position']);
        pointsForMetrics.push({ t, fx, fy, fz, mx, my, mz, phase_name: phaseName, device_id: deviceId, position_id: positionId });
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

    const graphPoints = lttbDownsample(pointsForMetrics, GRAPH_CACHE_TARGET_POINTS);
    const graphChunkSize = 100;
    for (let offset = 0; offset < graphPoints.length; offset += graphChunkSize) {
      const chunk = graphPoints.slice(offset, offset + graphChunkSize);
      const values = [];
      const placeholders = [];
      for (let i = 0; i < chunk.length; i += 1) {
        const point = chunk[i];
        const base = i * 17;
        placeholders.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17})`);
        values.push(
          ORG_ID, SCHOOL_CODE, sourceFileHash, offset + i,
          point.t, point.fx, point.fy, point.fz, point.mx, point.my, point.mz,
          point.phase_name, point.device_id, point.position_id,
          pitchCapturedAt, playerName, playerNorm
        );
      }
      await client.query(
        `INSERT INTO biomechanics_graph_cache
         (organization_id, school_code, source_file_hash, point_index, t, fx, fy, fz, mx, my, mz,
          phase_name, device_id, position_id, captured_at, pitcher_name, pitcher_name_norm)
         VALUES ${placeholders.join(',')}`,
        values
      );
    }

    const computed = computePitchMetrics(pointsForMetrics);
    await client.query(
      `INSERT INTO biomechanics_pitch_metrics
      (organization_id, school_code, source_file_hash, back_peak_fz, back_peak_fy, mound_connection, impulse, impulse_time, yz_transfer_back, lead_peak_fz, lead_peak_fy, clawback_time, yz_transfer_front, y_transfer, z_transfer)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (organization_id, school_code, source_file_hash)
      DO UPDATE SET
        back_peak_fz = EXCLUDED.back_peak_fz,
        back_peak_fy = EXCLUDED.back_peak_fy,
        mound_connection = EXCLUDED.mound_connection,
        impulse = EXCLUDED.impulse,
        impulse_time = EXCLUDED.impulse_time,
        yz_transfer_back = EXCLUDED.yz_transfer_back,
        lead_peak_fz = EXCLUDED.lead_peak_fz,
        lead_peak_fy = EXCLUDED.lead_peak_fy,
        clawback_time = EXCLUDED.clawback_time,
        yz_transfer_front = EXCLUDED.yz_transfer_front,
        y_transfer = EXCLUDED.y_transfer,
        z_transfer = EXCLUDED.z_transfer`,
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

  const allFiles = await listCsvFilesRecursive(ALL_PITCH_DIR);
  const singleFiles = await listCsvFilesRecursive(SINGLE_PITCH_DIR);
  if (!allFiles.length && !singleFiles.length) throw new Error(`No Axioforce CSV files found under ${ROOT}.`);
  if (!Number.isInteger(ORG_ID) || ORG_ID <= 0) throw new Error('AXIOFORCE_ORGANIZATION_ID must be a positive integer.');
  if (IMPORT_MODE !== 'replace' && IMPORT_MODE !== 'incremental') {
    throw new Error('AXIOFORCE_IMPORT_MODE must be replace or incremental.');
  }

  const pool = new Pool({ connectionString: dbUrl });
  const client = await pool.connect();
  try {
    console.log(`scope: organization=${ORG_ID} school=${SCHOOL_CODE} mode=${IMPORT_MODE}`);
    console.log(`found all-pitch files: ${allFiles.length}`);
    console.log(`found single-pitch files: ${singleFiles.length}`);
    if (IMPORT_MODE === 'replace') {
      await client.query('BEGIN');
      await clearBiomech(client);
      await client.query('COMMIT');
      console.log('cleared existing biomechanics data');
    }

    let allRowsInserted = 0;
    let skippedFiles = 0;
    for (const file of allFiles) {
      if (IMPORT_MODE === 'incremental' && await alreadyImported(client, 'all_pitches', file)) {
        skippedFiles += 1;
        continue;
      }
      const count = await importAllPitchFile(client, file);
      allRowsInserted += count;
      console.log(`all-pitch imported: ${path.relative(ROOT, file)} (${count} rows)`);
    }

    let singlePointsInserted = 0;
    for (let i = 0; i < singleFiles.length; i += 1) {
      if (IMPORT_MODE === 'incremental' && await alreadyImported(client, 'single_pitch', singleFiles[i])) {
        skippedFiles += 1;
        continue;
      }
      const count = await importSinglePitchFile(client, singleFiles[i], i + 1, singleFiles.length);
      singlePointsInserted += count;
    }

    const verify = await client.query(
      `SELECT
        (SELECT COUNT(*) FROM biomechanics_pitch_rows WHERE organization_id = $1 AND school_code = $2)::int AS all_pitch_rows,
        (SELECT COUNT(DISTINCT source_file_hash) FROM biomechanics_single_pitch_points WHERE organization_id = $1 AND school_code = $2)::int AS single_files,
        (SELECT COUNT(DISTINCT source_file_hash) FROM biomechanics_graph_cache WHERE organization_id = $1 AND school_code = $2)::int AS graph_cache_files,
        (SELECT COUNT(*) FROM biomechanics_single_pitch_points WHERE organization_id = $1 AND school_code = $2)::bigint AS single_points,
        (SELECT COUNT(*) FROM biomechanics_pitch_metrics WHERE organization_id = $1 AND school_code = $2)::int AS metrics_rows`,
      [ORG_ID, SCHOOL_CODE]
    );
    console.log(JSON.stringify({
      imported: { allRowsInserted, singlePointsInserted, singleFileCount: singleFiles.length, skippedFiles },
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

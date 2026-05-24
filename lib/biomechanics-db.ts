import { createHash } from 'node:crypto';
import { getDbPool, isDatabaseConfigured } from './auth-db';

export type BiomechanicsUploadKind = 'all_pitches' | 'single_pitch';

export type BiomechPitchOption = {
  pitchKey: string;
  label: string;
  capturedAt: string | null;
};

export type BiomechSinglePitchPoint = {
  t: number;
  fx: number | null;
  fy: number | null;
  fz: number | null;
  mx: number | null;
  my: number | null;
  mz: number | null;
  phase_name?: string | null;
  device_id?: string | null;
  position_id?: string | null;
};

type BiomechComputedMetrics = {
  backPeakFz: number | null;
  backPeakFy: number | null;
  impulse: number | null;
  yzTransferBack: number | null;
  leadPeakFz: number | null;
  leadPeakFy: number | null;
  clawbackTime: number | null;
  yzTransferFront: number | null;
  yTransfer: number | null;
  zTransfer: number | null;
};

type BiomechTableSummaryRow = {
  Name: string;
  Tags: string;
  'Back Leg Peak Fz (lb)': number | null;
  'Back Leg Peak Fy (lb)': number | null;
  'Back Leg Impulse (lb·s)': number | null;
  'Back Leg YZ Transfer (s)': number | null;
  'Lead Leg Peak Fz (lb)': number | null;
  'Lead Leg Peak Fy (lb)': number | null;
  'Lead Leg Clawback (s)': number | null;
  'Lead Leg YZ Transfer (s)': number | null;
  'Y Transfer (s)': number | null;
  'Z Transfer (s)': number | null;
  'Stride Length (in)': number | null;
  'Stride Direction (in)': number | null;
};

type NameMapping = {
  playerName?: string | null;
};

declare global {
  var __pcuBiomechanicsDbReady: boolean | undefined;
  var __pcuBiomechanicsDbPatched: boolean | undefined;
}

function normalizeSchoolCode(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ');
}

function toFinite(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateOrNull(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const normalized = raw.includes(' ') && /^\d{4}-\d{2}-\d{2}\s+\d/.test(raw)
    ? raw.replace(/\s+/, 'T')
    : raw;
  const d = new Date(normalized);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function parseUsDateTimeToIso(value: string): string | null {
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

function canonicalKey(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function pickValueCaseInsensitive(row: Record<string, unknown>, keys: string[]): unknown {
  const index = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) index.set(canonicalKey(k), v);
  for (const key of keys) {
    const v = index.get(canonicalKey(key));
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function pickStringCaseInsensitive(row: Record<string, unknown>, keys: string[]): string | null {
  const value = pickValueCaseInsensitive(row, keys);
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseCapturedAtFromRow(row: Record<string, unknown>): string | null {
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
  if (Number.isFinite(numeric) && numeric > 10_000_000_000) {
    return new Date(numeric).toISOString();
  }
  return toDateOrNull(asString) ?? parseUsDateTimeToIso(asString);
}

function parsePitchLabelFromRow(row: Record<string, unknown>, fallback: string): string {
  const pitchNo = pickValueCaseInsensitive(row, ['pitch_no', 'pitch number', 'pitch_number', 'pitch#']);
  const pitchType = pickValueCaseInsensitive(row, ['pitch_type', 'pitch type', 'type']);
  const athlete = pickValueCaseInsensitive(row, ['player', 'pitcher', 'athlete', 'name']);
  const pieces = [athlete, pitchType, pitchNo]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);
  if (pieces.length) return pieces.join(' | ');
  return fallback;
}

function normalizePhase(value: string | null | undefined): 'loading' | 'delivery' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'loading') return 'loading';
  if (normalized === 'delivery') return 'delivery';
  return null;
}

function parseSingleFileNameParts(fileName: string): { dateKey: string | null; timeKey: number | null } {
  const match = String(fileName ?? '').match(/(\d{8})_(\d+)\.csv/i);
  if (!match) return { dateKey: null, timeKey: null };
  return { dateKey: String(match[1] ?? ''), timeKey: Number(match[2] ?? Number.NaN) };
}

function dateKeyPhoenixFromIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  if (!y || !m || !day) return null;
  return `${y}${m}${day}`;
}

function computePitchMetrics(points: BiomechSinglePitchPoint[]): BiomechComputedMetrics {
  const loading = points
    .filter((point) => normalizePhase(point.phase_name) === 'loading')
    .map((point) => ({ t: toFinite(point.t), fy: toFinite(point.fy), fz: toFinite(point.fz) }))
    .filter((p): p is { t: number; fy: number | null; fz: number | null } => p.t !== null)
    .sort((a, b) => a.t - b.t);
  const delivery = points
    .filter((point) => normalizePhase(point.phase_name) === 'delivery')
    .map((point) => ({ t: toFinite(point.t), fy: toFinite(point.fy), fz: toFinite(point.fz) }))
    .filter((p): p is { t: number; fy: number | null; fz: number | null } => p.t !== null)
    .sort((a, b) => a.t - b.t);

  const maxBy = (arr: Array<{ t: number; v: number | null }>) => arr.filter((r) => r.v !== null).reduce<{ t: number; v: number } | null>((best, row) => {
    if (row.v === null) return best;
    if (!best || row.v > best.v) return { t: row.t, v: row.v };
    return best;
  }, null);
  const minBy = (arr: Array<{ t: number; v: number | null }>) => arr.filter((r) => r.v !== null).reduce<{ t: number; v: number } | null>((best, row) => {
    if (row.v === null) return best;
    if (!best || row.v < best.v) return { t: row.t, v: row.v };
    return best;
  }, null);
  const integrateTrapezoid = (arr: Array<{ t: number; v: number }>) => {
    if (arr.length < 2) return 0;
    let area = 0;
    for (let i = 0; i < arr.length - 1; i += 1) {
      const a = arr[i];
      const b = arr[i + 1];
      const dt = Math.max(0, b.t - a.t);
      area += ((a.v + b.v) / 2) * dt;
    }
    return area;
  };

  const backPeakFz = maxBy(loading.map((p) => ({ t: p.t, v: p.fz })));
  const backPeakFy = maxBy(loading.map((p) => ({ t: p.t, v: p.fy })));
  const leadPeakFz = maxBy(delivery.map((p) => ({ t: p.t, v: p.fz })));
  const leadPeakFy = minBy(delivery.map((p) => ({ t: p.t, v: p.fy })));

  let impulse: number | null = null;
  if (loading.length > 2) {
    const peakFz = maxBy(loading.map((p) => ({ t: p.t, v: p.fz })));
    const peakZIdx = peakFz ? loading.findIndex((p) => p.t === peakFz.t && p.fz === peakFz.v) : -1;
    let startIdx = -1;
    if (peakZIdx > 1 && peakFz) {
      const peakTime = peakFz.t;
      const windowStartTime = peakTime - 0.7;
      const candidates: number[] = [];
      for (let i = 0; i < peakZIdx; i += 1) {
        const t = loading[i]?.t;
        if (t !== undefined && t >= windowStartTime) candidates.push(i);
      }
      if (candidates.length) {
        let minIdx = candidates[0] ?? 0;
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

  let clawbackTime: number | null = null;
  const landingIdx = delivery.findIndex((p) => (p.fy ?? 0) < 0);
  if (landingIdx >= 0) {
    const recover = delivery.slice(landingIdx + 1).find((p) => (p.fy ?? Number.NEGATIVE_INFINITY) >= 0);
    if (recover) clawbackTime = Math.max(0, recover.t - delivery[landingIdx].t);
  }

  return {
    backPeakFz: backPeakFz?.v ?? null,
    backPeakFy: backPeakFy?.v ?? null,
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

async function ensureBiomechanicsTables(): Promise<void> {
  if (global.__pcuBiomechanicsDbReady) {
    if (global.__pcuBiomechanicsDbPatched) return;
    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '2s';`);
      await client.query(`SET LOCAL statement_timeout = '15s';`);
      await client.query(`ALTER TABLE biomechanics_single_pitch_points ADD COLUMN IF NOT EXISTS pitcher_name TEXT;`);
      await client.query(`ALTER TABLE biomechanics_single_pitch_points ADD COLUMN IF NOT EXISTS pitcher_name_norm TEXT;`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_pitch_rows_scope_date ON biomechanics_pitch_rows (organization_id, school_code, captured_at DESC);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_single_points_scope ON biomechanics_single_pitch_points (organization_id, school_code, source_file_hash, point_index ASC);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_single_points_scope_date ON biomechanics_single_pitch_points (organization_id, school_code, captured_at DESC);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_single_points_scope_hash ON biomechanics_single_pitch_points (organization_id, school_code, source_file_hash);`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_biomech_uploads_scope_kind_hash ON biomechanics_uploads (organization_id, school_code, upload_kind, source_file_hash);`);
      await client.query('COMMIT');
      global.__pcuBiomechanicsDbPatched = true;
    } catch {
      await client.query('ROLLBACK');
      // Ignore patch warmup failures; runtime paths can still operate on base schema.
    } finally {
      client.release();
    }
    return;
  }
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '3s';`);
    await client.query(`SET LOCAL statement_timeout = '30s';`);
    await client.query(`SELECT pg_advisory_xact_lock(77431102519901);`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS biomechanics_uploads (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        school_code TEXT NOT NULL,
        upload_kind TEXT NOT NULL,
        source_file_name TEXT NOT NULL,
        source_file_hash TEXT NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        created_by_user_id BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS biomechanics_pitch_rows (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        school_code TEXT NOT NULL,
        upload_id BIGINT NOT NULL REFERENCES biomechanics_uploads(id) ON DELETE CASCADE,
        source_file_hash TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        captured_at TIMESTAMPTZ,
        pitch_label TEXT,
        row_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, school_code, source_file_hash, row_index)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS biomechanics_single_pitch_points (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        school_code TEXT NOT NULL,
        upload_id BIGINT NOT NULL REFERENCES biomechanics_uploads(id) ON DELETE CASCADE,
        source_file_hash TEXT NOT NULL,
        point_index INTEGER NOT NULL,
        t DOUBLE PRECISION NOT NULL,
        fx DOUBLE PRECISION,
        fy DOUBLE PRECISION,
        fz DOUBLE PRECISION,
        mx DOUBLE PRECISION,
        my DOUBLE PRECISION,
        mz DOUBLE PRECISION,
        row_json JSONB NOT NULL,
        captured_at TIMESTAMPTZ,
        pitch_label TEXT,
        pitcher_name TEXT,
        pitcher_name_norm TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, school_code, source_file_hash, point_index)
      );
    `);
    await client.query(`ALTER TABLE biomechanics_single_pitch_points ADD COLUMN IF NOT EXISTS pitcher_name TEXT;`);
    await client.query(`ALTER TABLE biomechanics_single_pitch_points ADD COLUMN IF NOT EXISTS pitcher_name_norm TEXT;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_pitch_rows_scope_date ON biomechanics_pitch_rows (organization_id, school_code, captured_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_single_points_scope ON biomechanics_single_pitch_points (organization_id, school_code, source_file_hash, point_index ASC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_single_points_scope_date ON biomechanics_single_pitch_points (organization_id, school_code, captured_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_single_points_scope_hash ON biomechanics_single_pitch_points (organization_id, school_code, source_file_hash);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_biomech_uploads_scope_kind_hash ON biomechanics_uploads (organization_id, school_code, upload_kind, source_file_hash);`);
    await client.query('COMMIT');
    global.__pcuBiomechanicsDbReady = true;
    global.__pcuBiomechanicsDbPatched = true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function saveAllPitchRows(args: {
  organizationId: number;
  schoolCode: string;
  sourceFileName: string;
  csvContent: string;
  rows: Array<Record<string, unknown> & NameMapping>;
  createdByUserId: number | null;
}): Promise<{ insertedRows: number }> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  await ensureBiomechanicsTables();
  const pool = getDbPool();
  const sourceFileHash = createHash('sha256').update(args.csvContent).digest('hex');
  const schoolCode = normalizeSchoolCode(args.schoolCode);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uploadInsert = await client.query<{ id: number }>(
      `
      INSERT INTO biomechanics_uploads (
        organization_id, school_code, upload_kind, source_file_name, source_file_hash, row_count, created_by_user_id
      ) VALUES ($1, $2, 'all_pitches', $3, $4, $5, $6)
      ON CONFLICT (organization_id, school_code, upload_kind, source_file_hash)
      DO UPDATE SET
        source_file_name = EXCLUDED.source_file_name,
        row_count = EXCLUDED.row_count,
        created_by_user_id = EXCLUDED.created_by_user_id,
        created_at = NOW()
      RETURNING id
      `,
      [args.organizationId, schoolCode, args.sourceFileName, sourceFileHash, args.rows.length, args.createdByUserId]
    );
    const uploadId = Number(uploadInsert.rows[0]?.id ?? 0);
    await client.query(
      `
      DELETE FROM biomechanics_pitch_rows
      WHERE organization_id = $1
        AND school_code = $2
        AND source_file_hash = $3
      `,
      [args.organizationId, schoolCode, sourceFileHash]
    );
    let insertedRows = 0;
    for (let idx = 0; idx < args.rows.length; idx += 1) {
      const row = args.rows[idx] ?? {};
      const capturedAt = parseCapturedAtFromRow(row);
      const pitchLabel = parsePitchLabelFromRow(row, `${args.sourceFileName} | Row ${idx + 1}`);
      const result = await client.query(
        `
        INSERT INTO biomechanics_pitch_rows (
          organization_id, school_code, upload_id, source_file_hash, row_index, captured_at, pitch_label, row_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
        ON CONFLICT (organization_id, school_code, source_file_hash, row_index)
        DO UPDATE SET
          captured_at = EXCLUDED.captured_at,
          pitch_label = EXCLUDED.pitch_label,
          row_json = EXCLUDED.row_json
        `,
        [
          args.organizationId,
          schoolCode,
          uploadId,
          sourceFileHash,
          idx,
          capturedAt,
          pitchLabel,
          JSON.stringify(row),
        ]
      );
      insertedRows += result.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return { insertedRows };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function saveSinglePitchPoints(args: {
  organizationId: number;
  schoolCode: string;
  sourceFileName: string;
  csvContent: string;
  rows: Array<Record<string, unknown>>;
  createdByUserId: number | null;
  pitcherName?: string | null;
  onChunkCommitted?: (rowsCommitted: number) => void;
}): Promise<{ insertedRows: number; pitchKey: string }> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  await ensureBiomechanicsTables();
  const pool = getDbPool();
  const sourceFileHash = createHash('sha256').update(args.csvContent).digest('hex');
  const schoolCode = normalizeSchoolCode(args.schoolCode);
  const client = await pool.connect();
  try {
    const firstRow = args.rows[0] ?? {};
    const capturedAt = parseCapturedAtFromRow(firstRow);
    const pitcherName = String(args.pitcherName ?? '').trim();
    const pitchLabel = pitcherName ? `${pitcherName} | ${args.sourceFileName}` : parsePitchLabelFromRow(firstRow, args.sourceFileName);

    await client.query('BEGIN');
    const uploadInsert = await client.query<{ id: number }>(
      `
      INSERT INTO biomechanics_uploads (
        organization_id, school_code, upload_kind, source_file_name, source_file_hash, row_count, created_by_user_id
      ) VALUES ($1, $2, 'single_pitch', $3, $4, $5, $6)
      ON CONFLICT (organization_id, school_code, upload_kind, source_file_hash)
      DO UPDATE SET
        source_file_name = EXCLUDED.source_file_name,
        row_count = EXCLUDED.row_count,
        created_by_user_id = EXCLUDED.created_by_user_id,
        created_at = NOW()
      RETURNING id
      `,
      [args.organizationId, schoolCode, args.sourceFileName, sourceFileHash, args.rows.length, args.createdByUserId]
    );
    const uploadId = Number(uploadInsert.rows[0]?.id ?? 0);
    await client.query(
      `
      DELETE FROM biomechanics_single_pitch_points
      WHERE organization_id = $1
        AND school_code = $2
        AND source_file_hash = $3
      `,
      [args.organizationId, schoolCode, sourceFileHash]
    );
    let insertedRows = 0;
    const pitcherNorm = normalizeName(pitcherName || '');
    const chunkSize = 100;
    for (let start = 0; start < args.rows.length; start += chunkSize) {
      const chunk = args.rows.slice(start, start + chunkSize);
      const values: unknown[] = [];
      const rowsSql: string[] = [];
      for (let i = 0; i < chunk.length; i += 1) {
        const idx = start + i;
        const row = chunk[i] ?? {};
        const t =
          toFinite(pickValueCaseInsensitive(row, [
            'time',
            't',
            'time (unix ms)',
            'time_unix_ms',
            'time unix ms',
            'timestamp_ms',
            'unix ms',
            'ms',
            'frame',
          ])) ??
          idx;
        const fx = toFinite(pickValueCaseInsensitive(row, ['Fx', 'F_x']));
        const fy = toFinite(pickValueCaseInsensitive(row, ['Fy', 'F_y']));
        const fz = toFinite(pickValueCaseInsensitive(row, ['Fz', 'F_z']));
        const mx = toFinite(pickValueCaseInsensitive(row, ['Mx', 'M_x']));
        const my = toFinite(pickValueCaseInsensitive(row, ['My', 'M_y']));
        const mz = toFinite(pickValueCaseInsensitive(row, ['Mz', 'M_z']));
        const base = values.length;
        rowsSql.push(
          `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13}::jsonb,$${base + 14},$${base + 15},$${base + 16},$${base + 17})`
        );
        values.push(
          args.organizationId,
          schoolCode,
          uploadId,
          sourceFileHash,
          idx,
          t,
          fx,
          fy,
          fz,
          mx,
          my,
          mz,
          JSON.stringify(row),
          capturedAt,
          pitchLabel,
          pitcherName || null,
          pitcherNorm
        );
      }

      const result = await client.query(
        `
        INSERT INTO biomechanics_single_pitch_points (
          organization_id, school_code, upload_id, source_file_hash, point_index, t, fx, fy, fz, mx, my, mz,
          row_json, captured_at, pitch_label, pitcher_name, pitcher_name_norm
        ) VALUES ${rowsSql.join(',')}
        ON CONFLICT (organization_id, school_code, source_file_hash, point_index)
        DO UPDATE SET
          t = EXCLUDED.t,
          fx = EXCLUDED.fx,
          fy = EXCLUDED.fy,
          fz = EXCLUDED.fz,
          mx = EXCLUDED.mx,
          my = EXCLUDED.my,
          mz = EXCLUDED.mz,
          row_json = EXCLUDED.row_json,
          captured_at = EXCLUDED.captured_at,
          pitch_label = EXCLUDED.pitch_label,
          pitcher_name = EXCLUDED.pitcher_name,
          pitcher_name_norm = EXCLUDED.pitcher_name_norm
        `,
        values
      );
      insertedRows += result.rowCount ?? 0;
      if (args.onChunkCommitted) args.onChunkCommitted(chunk.length);
    }
    await client.query('COMMIT');
    return { insertedRows, pitchKey: sourceFileHash };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getBiomechanicsSnapshot(args: {
  organizationId: number;
  schoolCode: string;
  startDate?: string | null;
  endDate?: string | null;
  selectedPitchKey?: string | null;
  selectedPitcher?: string | null;
  selectedTag?: string | null;
}): Promise<{
  tableColumns: string[];
  tableRows: Array<Record<string, string | number | null>>;
  pitchOptions: BiomechPitchOption[];
  selectedPitchKey: string | null;
  selectedPitchPoints: BiomechSinglePitchPoint[];
  tagsOptions: string[];
  selectedPitchTags: string | null;
  matchSummary: {
    totalSinglePitchFiles: number;
    matchedSinglePitchFiles: number;
    unmatchedSinglePitchFiles: number;
    totalAllPitchRows: number;
    matchedAllPitchRows: number;
    unmatchedAllPitchRows: number;
  };
}> {
  if (!isDatabaseConfigured()) {
    return {
      tableColumns: [],
      tableRows: [],
      pitchOptions: [],
      selectedPitchKey: null,
      selectedPitchPoints: [],
      tagsOptions: [],
      selectedPitchTags: null,
      matchSummary: {
        totalSinglePitchFiles: 0,
        matchedSinglePitchFiles: 0,
        unmatchedSinglePitchFiles: 0,
        totalAllPitchRows: 0,
        matchedAllPitchRows: 0,
        unmatchedAllPitchRows: 0,
      },
    };
  }
  await ensureBiomechanicsTables();
  const pool = getDbPool();
  const schoolCode = normalizeSchoolCode(args.schoolCode);
  const selectedPitcher = String(args.selectedPitcher ?? '').trim();
  const selectedPitcherNorm = normalizeName(selectedPitcher);

  const dateFilterParts: string[] = [];
  const values: Array<string | number> = [args.organizationId, schoolCode];
  if (args.startDate) {
    values.push(args.startDate);
    dateFilterParts.push(`COALESCE(captured_at, created_at) >= $${values.length}::date`);
  }
  if (args.endDate) {
    values.push(args.endDate);
    dateFilterParts.push(`COALESCE(captured_at, created_at) < ($${values.length}::date + INTERVAL '1 day')`);
  }
  const dateFilterSql = dateFilterParts.length ? `AND ${dateFilterParts.join(' AND ')}` : '';
  const summaryValues: Array<string | number> = [...values];
  let tablePitcherFilterSql = '';
  if (selectedPitcherNorm) {
    values.push(selectedPitcherNorm);
    const pitcherParamIndex = values.length;
    tablePitcherFilterSql = `
      AND COALESCE(
        NULLIF(TRIM(LOWER(regexp_replace(COALESCE(row_json->>'Player', ''), '[^a-z0-9]+', ' ', 'g'))), ''),
        NULLIF(TRIM(LOWER(regexp_replace(COALESCE(row_json->>'Name', ''), '[^a-z0-9]+', ' ', 'g'))), ''),
        NULLIF(TRIM(LOWER(regexp_replace(COALESCE(row_json->>'Pitcher', ''), '[^a-z0-9]+', ' ', 'g'))), ''),
        NULLIF(TRIM(LOWER(regexp_replace(COALESCE(row_json->>'First Name', '') || ' ' || COALESCE(row_json->>'Last Name', ''), '[^a-z0-9]+', ' ', 'g'))), '')
      ) = $${pitcherParamIndex}
    `;
  }

  const rowResult = await pool.query<{ row_json: Record<string, string | number | null>; captured_at: string | null; created_at: string | null }>(
    `
    SELECT row_json, captured_at::text AS captured_at, created_at::text AS created_at
    FROM biomechanics_pitch_rows
    WHERE organization_id = $1
      AND school_code = $2
      ${dateFilterSql}
      ${tablePitcherFilterSql}
    ORDER BY COALESCE(captured_at, created_at) DESC
    LIMIT 1200
    `,
    values
  );
  const summaryAllRowsResult = await pool.query<{ total_rows: string }>(
    `
    SELECT COUNT(*)::text AS total_rows
    FROM biomechanics_pitch_rows
    WHERE organization_id = $1
      AND school_code = $2
      ${dateFilterSql}
    `,
    summaryValues
  );

  const selectedTag = String(args.selectedTag ?? '').trim();

  let pitchOptionsResult = await pool.query<{
    pitch_key: string;
    label: string;
    captured_at: string | null;
    pitcher_name: string | null;
    source_file_name: string | null;
  }>(
    `
    SELECT
      p.source_file_hash AS pitch_key,
      COALESCE(
        NULLIF(TRIM(MAX(p.pitch_label)), ''),
        NULLIF(TRIM(MAX(p.pitcher_name)), ''),
        MAX(p.source_file_hash)
      ) AS label,
      MAX(p.captured_at)::text AS captured_at,
      NULLIF(TRIM(MAX(p.pitcher_name)), '') AS pitcher_name,
      NULLIF(TRIM(MAX(u.source_file_name)), '') AS source_file_name
    FROM biomechanics_single_pitch_points p
    LEFT JOIN biomechanics_uploads u
      ON u.organization_id = p.organization_id
     AND u.school_code = p.school_code
     AND u.upload_kind = 'single_pitch'
     AND u.source_file_hash = p.source_file_hash
    WHERE p.organization_id = $1
      AND p.school_code = $2
      ${dateFilterSql}
      
    GROUP BY p.source_file_hash
    ORDER BY MAX(COALESCE(p.captured_at, p.created_at)) DESC
    LIMIT 400
    `,
    values
  ).catch(async (error) => {
    const code = String((error as { code?: unknown } | null)?.code ?? '');
    const message = String((error as { message?: unknown } | null)?.message ?? '').toLowerCase();
    const missingPitcherName = code === '42703' || message.includes('pitcher_name');
    if (!missingPitcherName) throw error;
    await ensureBiomechanicsTables();
    return pool.query<{
      pitch_key: string;
      label: string;
      captured_at: string | null;
      pitcher_name: string | null;
      source_file_name: string | null;
    }>(
      `
      SELECT
        p.source_file_hash AS pitch_key,
        COALESCE(
          NULLIF(TRIM(MAX(p.pitch_label)), ''),
          NULLIF(TRIM(MAX(p.pitcher_name)), ''),
          MAX(p.source_file_hash)
        ) AS label,
        MAX(p.captured_at)::text AS captured_at,
        NULLIF(TRIM(MAX(p.pitcher_name)), '') AS pitcher_name,
        NULLIF(TRIM(MAX(u.source_file_name)), '') AS source_file_name
      FROM biomechanics_single_pitch_points p
      LEFT JOIN biomechanics_uploads u
        ON u.organization_id = p.organization_id
       AND u.school_code = p.school_code
       AND u.upload_kind = 'single_pitch'
       AND u.source_file_hash = p.source_file_hash
      WHERE p.organization_id = $1
        AND p.school_code = $2
        ${dateFilterSql}
        
      GROUP BY p.source_file_hash
      ORDER BY MAX(COALESCE(p.captured_at, p.created_at)) DESC
      LIMIT 400
      `,
      values
    );
  });
  const summarySingleFilesResult = await pool.query<{ total_files: string }>(
    `
    SELECT COUNT(DISTINCT source_file_hash)::text AS total_files
    FROM biomechanics_single_pitch_points
    WHERE organization_id = $1
      AND school_code = $2
      ${dateFilterSql}
    `,
    summaryValues
  );

  const allRows = rowResult.rows.map((row) => {
    const json = (row.row_json ?? {}) as Record<string, unknown>;
    const playerRaw =
      pickStringCaseInsensitive(json, ['Player', 'Name', 'Pitcher']) ??
      `${pickStringCaseInsensitive(json, ['First Name']) ?? ''} ${pickStringCaseInsensitive(json, ['Last Name']) ?? ''}`.trim();
    const tags = pickStringCaseInsensitive(json, ['Tags', 'Tag']) ?? 'UnTagged';
    const capturedAt = row.captured_at ?? row.created_at ?? null;
    const dateKey = dateKeyPhoenixFromIso(capturedAt);
    const strideLengthCm = toFinite(pickValueCaseInsensitive(json, ['strideLength (cm)', 'strideLength', 'Stride Length (cm)']));
    const strideWidthCm = toFinite(pickValueCaseInsensitive(json, ['strideWidth (cm)', 'strideWidth', 'Stride Width (cm)']));
    return {
      name: playerRaw || 'Unknown',
      nameNorm: normalizeName(playerRaw),
      tags,
      dateKey,
      capturedAt,
      strideLengthIn: strideLengthCm === null ? null : strideLengthCm / 2.54,
      strideDirectionIn: strideWidthCm === null ? null : strideWidthCm / 2.54,
    };
  }).filter((row) => row.dateKey);

  const singleRows = pitchOptionsResult.rows.map((row) => {
    const sourceFileName = String(row.source_file_name ?? '').trim();
    const parts = parseSingleFileNameParts(sourceFileName);
    return {
      pitchKey: row.pitch_key,
      label: row.label,
      capturedAt: row.captured_at,
      pitcherName: String(row.pitcher_name ?? '').trim() || null,
      pitcherNorm: normalizeName(row.pitcher_name ?? ''),
      sourceFileName,
      dateKey: parts.dateKey,
      timeKey: parts.timeKey,
    };
  });

  const allRowsForPitcherGrouping = allRows.filter((row) => row.nameNorm);
  const allGroups = new Map<string, Array<typeof allRowsForPitcherGrouping[number]>>();
  for (const row of allRowsForPitcherGrouping) {
    const key = `${row.nameNorm}|${row.dateKey}`;
    const arr = allGroups.get(key) ?? [];
    arr.push(row);
    allGroups.set(key, arr);
  }
  for (const arr of allGroups.values()) {
    arr.sort((a, b) => String(a.capturedAt ?? '').localeCompare(String(b.capturedAt ?? '')));
  }

  const singleGroups = new Map<string, Array<typeof singleRows[number]>>();
  for (const row of singleRows) {
    if (!row.dateKey || row.timeKey === null || !Number.isFinite(row.timeKey)) continue;
    const key = row.pitcherNorm ? `${row.pitcherNorm}|${row.dateKey}` : `__date_only__|${row.dateKey}`;
    const arr = singleGroups.get(key) ?? [];
    arr.push(row);
    singleGroups.set(key, arr);
  }
  for (const arr of singleGroups.values()) {
    arr.sort((a, b) => Number(a.timeKey ?? 0) - Number(b.timeKey ?? 0));
  }

  const mapping = new Map<string, { name: string; tags: string; strideLengthIn: number | null; strideDirectionIn: number | null }>();
  for (const [key, singles] of singleGroups.entries()) {
    const allForGroup = key.startsWith('__date_only__|')
      ? allRows.filter((row) => `__date_only__|${row.dateKey}` === key)
      : (allGroups.get(key) ?? []);
    const n = Math.min(singles.length, allForGroup.length);
    for (let i = 0; i < n; i += 1) {
      const single = singles[i];
      const allRow = allForGroup[i];
      if (!single || !allRow) continue;
      mapping.set(single.pitchKey, {
        name: allRow.name,
        tags: allRow.tags || 'UnTagged',
        strideLengthIn: allRow.strideLengthIn,
        strideDirectionIn: allRow.strideDirectionIn,
      });
    }
  }

  const tagsOptions = Array.from(new Set(Array.from(mapping.values()).map((v) => v.tags).filter(Boolean))).sort((a, b) => a.localeCompare(b));

  const pitchOptionsUnfiltered: BiomechPitchOption[] = singleRows.map((row) => ({
    pitchKey: row.pitchKey,
    label: row.label,
    capturedAt: row.capturedAt,
  }));
  const pitchOptions = pitchOptionsUnfiltered.filter((option) => {
    if (selectedPitcherNorm) {
      const meta = mapping.get(option.pitchKey);
      if (normalizeName(meta?.name ?? '') !== selectedPitcherNorm) return false;
    }
    if (!selectedTag || selectedTag.toUpperCase() === 'ALL') return true;
    const meta = mapping.get(option.pitchKey);
    return (meta?.tags ?? '') === selectedTag;
  });
  const selectedPitchKey =
    args.selectedPitchKey && pitchOptions.some((option) => option.pitchKey === args.selectedPitchKey)
      ? args.selectedPitchKey
      : (pitchOptions[0]?.pitchKey ?? null);

  let selectedPitchPoints: BiomechSinglePitchPoint[] = [];
  if (selectedPitchKey) {
    const pointsResult = await pool.query<BiomechSinglePitchPoint & { row_json?: Record<string, unknown> | null }>(
      `
      SELECT t, fx, fy, fz, mx, my, mz, row_json
      FROM biomechanics_single_pitch_points
      WHERE organization_id = $1
        AND school_code = $2
        AND source_file_hash = $3
      ORDER BY point_index ASC
      `,
      [args.organizationId, schoolCode, selectedPitchKey]
    );
    selectedPitchPoints = pointsResult.rows.map((row) => {
      const rowJson = (row.row_json ?? {}) as Record<string, unknown>;
      const rowTimeMs = toFinite(pickValueCaseInsensitive(rowJson, ['Time (Unix ms)', 'time_unix_ms', 'time unix ms', 'timestamp_ms', 'unix ms']));
      const dbTime = toFinite(row.t);
      const t = rowTimeMs !== null ? rowTimeMs : Number(dbTime ?? 0);
      return {
        t,
        fx: toFinite(row.fx),
        fy: toFinite(row.fy),
        fz: toFinite(row.fz),
        mx: toFinite(row.mx),
        my: toFinite(row.my),
        mz: toFinite(row.mz),
        phase_name: pickStringCaseInsensitive(rowJson, ['Phase Name', 'Phase']),
        device_id: pickStringCaseInsensitive(rowJson, ['Device Id', 'Device']),
        position_id: pickStringCaseInsensitive(rowJson, ['Position Id', 'Position']),
      };
    });
  }

  const selectedPitchTags = selectedPitchKey ? (mapping.get(selectedPitchKey)?.tags ?? null) : null;
  const totalAllRowsFromDb = Number(summaryAllRowsResult.rows[0]?.total_rows ?? 0);
  const totalSingleFilesFromDb = Number(summarySingleFilesResult.rows[0]?.total_files ?? 0);
  const totalAllForSummary = Math.max(allRows.length, totalAllRowsFromDb);
  const totalSinglesForSummary = Math.max(singleRows.length, totalSingleFilesFromDb);
  const matchedForSummary = Math.min(mapping.size, totalAllForSummary);
  const matchSummary = {
    totalSinglePitchFiles: totalSinglesForSummary,
    matchedSinglePitchFiles: mapping.size,
    unmatchedSinglePitchFiles: Math.max(0, totalSinglesForSummary - mapping.size),
    totalAllPitchRows: totalAllForSummary,
    matchedAllPitchRows: matchedForSummary,
    unmatchedAllPitchRows: Math.max(0, totalAllForSummary - matchedForSummary),
  };

  const metricKeys = pitchOptions.map((p) => p.pitchKey);
  const pitchMetricsMap = new Map<string, BiomechComputedMetrics>();
  if (metricKeys.length) {
    const pointsAgg = await pool.query<BiomechSinglePitchPoint & { source_file_hash: string; row_json?: Record<string, unknown> | null }>(
      `
      SELECT source_file_hash, t, fx, fy, fz, mx, my, mz, row_json
      FROM biomechanics_single_pitch_points
      WHERE organization_id = $1
        AND school_code = $2
        AND source_file_hash = ANY($3::text[])
      ORDER BY source_file_hash, point_index ASC
      `,
      [args.organizationId, schoolCode, metricKeys]
    );
    const grouped = new Map<string, BiomechSinglePitchPoint[]>();
    for (const row of pointsAgg.rows) {
      const point: BiomechSinglePitchPoint = {
        t: toFinite(row.t) ?? 0,
        fx: toFinite(row.fx),
        fy: toFinite(row.fy),
        fz: toFinite(row.fz),
        mx: toFinite(row.mx),
        my: toFinite(row.my),
        mz: toFinite(row.mz),
        phase_name: pickStringCaseInsensitive((row.row_json ?? {}) as Record<string, unknown>, ['Phase Name', 'Phase']),
        device_id: pickStringCaseInsensitive((row.row_json ?? {}) as Record<string, unknown>, ['Device Id', 'Device']),
        position_id: pickStringCaseInsensitive((row.row_json ?? {}) as Record<string, unknown>, ['Position Id', 'Position']),
      };
      const arr = grouped.get(row.source_file_hash) ?? [];
      arr.push(point);
      grouped.set(row.source_file_hash, arr);
    }
    for (const [pitchKey, points] of grouped.entries()) {
      pitchMetricsMap.set(pitchKey, computePitchMetrics(points));
    }
  }

  const tableColumnNames = [
    'Name',
    'Tags',
    'Back Leg Peak Fz (lb)',
    'Back Leg Peak Fy (lb)',
    'Back Leg Impulse (lb·s)',
    'Back Leg YZ Transfer (s)',
    'Lead Leg Peak Fz (lb)',
    'Lead Leg Peak Fy (lb)',
    'Lead Leg Clawback (s)',
    'Lead Leg YZ Transfer (s)',
    'Y Transfer (s)',
    'Z Transfer (s)',
    'Stride Length (in)',
    'Stride Direction (in)',
  ];
  const agg = new Map<string, { name: string; tags: string; count: number; sums: Record<string, number>; strideLen: number[]; strideDir: number[] }>();
  for (const option of pitchOptions) {
    const meta = mapping.get(option.pitchKey);
    const metrics = pitchMetricsMap.get(option.pitchKey);
    if (!meta || !metrics) continue;
    const key = `${meta.name}|${meta.tags}`;
    const curr = agg.get(key) ?? { name: meta.name, tags: meta.tags, count: 0, sums: {}, strideLen: [], strideDir: [] };
    curr.count += 1;
    const add = (k: keyof BiomechComputedMetrics) => {
      const v = metrics[k];
      if (v !== null && Number.isFinite(v)) curr.sums[k] = (curr.sums[k] ?? 0) + v;
    };
    add('backPeakFz'); add('backPeakFy'); add('impulse'); add('yzTransferBack');
    add('leadPeakFz'); add('leadPeakFy'); add('clawbackTime'); add('yzTransferFront');
    add('yTransfer'); add('zTransfer');
    if (meta.strideLengthIn !== null && Number.isFinite(meta.strideLengthIn)) curr.strideLen.push(meta.strideLengthIn);
    if (meta.strideDirectionIn !== null && Number.isFinite(meta.strideDirectionIn)) curr.strideDir.push(meta.strideDirectionIn);
    agg.set(key, curr);
  }
  const avg = (sum: number | undefined, count: number) => (sum === undefined || count <= 0 ? null : sum / count);
  const avgArr = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
  const tableRows: BiomechTableSummaryRow[] = Array.from(agg.values())
    .sort((a, b) => a.name.localeCompare(b.name) || a.tags.localeCompare(b.tags))
    .map((r) => ({
      Name: r.name,
      Tags: r.tags,
      'Back Leg Peak Fz (lb)': avg(r.sums.backPeakFz, r.count),
      'Back Leg Peak Fy (lb)': avg(r.sums.backPeakFy, r.count),
      'Back Leg Impulse (lb·s)': avg(r.sums.impulse, r.count),
      'Back Leg YZ Transfer (s)': avg(r.sums.yzTransferBack, r.count),
      'Lead Leg Peak Fz (lb)': avg(r.sums.leadPeakFz, r.count),
      'Lead Leg Peak Fy (lb)': avg(r.sums.leadPeakFy, r.count),
      'Lead Leg Clawback (s)': avg(r.sums.clawbackTime, r.count),
      'Lead Leg YZ Transfer (s)': avg(r.sums.yzTransferFront, r.count),
      'Y Transfer (s)': avg(r.sums.yTransfer, r.count),
      'Z Transfer (s)': avg(r.sums.zTransfer, r.count),
      'Stride Length (in)': avgArr(r.strideLen),
      'Stride Direction (in)': avgArr(r.strideDir),
    }));

  return {
    tableColumns: tableColumnNames,
    tableRows,
    pitchOptions,
    selectedPitchKey,
    selectedPitchPoints,
    tagsOptions,
    selectedPitchTags,
    matchSummary,
  };
}

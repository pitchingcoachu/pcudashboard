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
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
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
  return toDateOrNull(asString);
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
      RETURNING id
      `,
      [args.organizationId, schoolCode, args.sourceFileName, sourceFileHash, args.rows.length, args.createdByUserId]
    );
    const uploadId = Number(uploadInsert.rows[0]?.id ?? 0);
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
  pitcherName: string;
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
      RETURNING id
      `,
      [args.organizationId, schoolCode, args.sourceFileName, sourceFileHash, args.rows.length, args.createdByUserId]
    );
    const uploadId = Number(uploadInsert.rows[0]?.id ?? 0);
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
}): Promise<{
  tableColumns: string[];
  tableRows: Array<Record<string, string | number | null>>;
  pitchOptions: BiomechPitchOption[];
  selectedPitchKey: string | null;
  selectedPitchPoints: BiomechSinglePitchPoint[];
}> {
  if (!isDatabaseConfigured()) return { tableColumns: [], tableRows: [], pitchOptions: [], selectedPitchKey: null, selectedPitchPoints: [] };
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
  let tablePitcherFilterSql = '';
  let singlePitcherFilterSql = '';
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
    singlePitcherFilterSql = `AND COALESCE(NULLIF(TRIM(pitcher_name_norm), ''), '') = $${pitcherParamIndex}`;
  }

  const rowResult = await pool.query<{
    row_json: Record<string, string | number | null>;
  }>(
    `
    SELECT row_json
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

  const tableRows = rowResult.rows.map((row) => row.row_json ?? {});
  const columnSet = new Set<string>();
  for (const row of tableRows) {
    for (const key of Object.keys(row)) {
      if (!String(key).trim()) continue;
      columnSet.add(key);
    }
  }
  const tableColumns = Array.from(columnSet);

  let pitchOptionsResult = await pool.query<{
    pitch_key: string;
    label: string;
    captured_at: string | null;
  }>(
    `
    SELECT
      source_file_hash AS pitch_key,
      COALESCE(
        NULLIF(TRIM(MAX(pitch_label)), ''),
        NULLIF(TRIM(MAX(pitcher_name)), ''),
        MAX(source_file_hash)
      ) AS label,
      MAX(captured_at)::text AS captured_at
    FROM biomechanics_single_pitch_points
    WHERE organization_id = $1
      AND school_code = $2
      ${dateFilterSql}
      ${singlePitcherFilterSql}
    GROUP BY source_file_hash
    ORDER BY MAX(COALESCE(captured_at, created_at)) DESC
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
    }>(
      `
      SELECT
        source_file_hash AS pitch_key,
        COALESCE(
          NULLIF(TRIM(MAX(pitch_label)), ''),
          NULLIF(TRIM(MAX(pitcher_name)), ''),
          MAX(source_file_hash)
        ) AS label,
        MAX(captured_at)::text AS captured_at
      FROM biomechanics_single_pitch_points
      WHERE organization_id = $1
        AND school_code = $2
        ${dateFilterSql}
        ${singlePitcherFilterSql}
      GROUP BY source_file_hash
      ORDER BY MAX(COALESCE(captured_at, created_at)) DESC
      LIMIT 400
      `,
      values
    );
  });

  const pitchOptions: BiomechPitchOption[] = pitchOptionsResult.rows.map((row) => ({
    pitchKey: row.pitch_key,
    label: row.label,
    capturedAt: row.captured_at,
  }));
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

  return {
    tableColumns,
    tableRows,
    pitchOptions,
    selectedPitchKey,
    selectedPitchPoints,
  };
}

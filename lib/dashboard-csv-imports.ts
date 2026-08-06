import { createHash, randomBytes } from 'crypto';
import type { PoolClient } from 'pg';
import { getDbPool } from './auth-db';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 10;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const INSERT_CHUNK_SIZE = 150;

const RAPSODO_REQUIRED_HEADERS = [
  'Date',
  'Pitch Type',
  'Velocity',
  'Total Spin',
  'Release Height',
  'Release Side',
  'Release Extension (ft)',
] as const;

type ThrowingHand = 'Right' | 'Left';

export type DashboardCsvPreview = {
  fileName: string;
  provider: 'Rapsodo';
  playerName: string;
  providerPlayerId: string;
  totalRows: number;
  validRows: number;
  skippedRows: number;
  minDate: string | null;
  maxDate: string | null;
  pitchTypes: Array<{ name: string; count: number }>;
  metricCoverage: Array<{ key: string; label: string; populated: number; total: number }>;
  warnings: string[];
};

export type DashboardCsvUploadHistory = {
  id: number;
  provider: string;
  fileName: string;
  pitcherName: string;
  throwingHand: string;
  rowCount: number;
  insertedRows: number;
  skippedRows: number;
  minDate: string | null;
  maxDate: string | null;
  status: string;
  refreshRequestedAt: string | null;
  refreshCompletedAt: string | null;
  createdAt: string;
};

type CanonicalPitchRow = {
  sessionDate: string;
  time: string;
  pitcher: string;
  pitcherId: string;
  pitchType: string;
  pitchId: string;
  pitchKey: string;
  velocity: number;
  spinRate: number | null;
  spinEfficiency: number | null;
  releaseTilt: string;
  ivb: number | null;
  hb: number | null;
  releaseHeight: number | null;
  releaseSide: number | null;
  extension: number | null;
  vaa: number | null;
  haa: number | null;
  plateSide: number | null;
  plateHeight: number | null;
  pitchCall: string;
};

type ParsedDashboardCsv = {
  preview: DashboardCsvPreview;
  rows: CanonicalPitchRow[];
};

type ImportInput = {
  schoolCode: string;
  organizationId: number;
  createdByUserId: number | null;
  fileName: string;
  fileBytes: Uint8Array;
  throwingHand: ThrowingHand;
};

type ImportResult = {
  upload: DashboardCsvUploadHistory;
  duplicateFile: boolean;
  refreshToken: string | null;
};

let schemaReady: Promise<void> | null = null;

function normalizeSchoolCode(value: string): string {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,32}$/.test(normalized)) throw new Error('Invalid school code.');
  if (normalized === 'PRO' || normalized === 'LEAGUE') {
    throw new Error('Manual provider uploads must target a specific school dashboard.');
  }
  return normalized;
}

function cleanFileName(value: string): string {
  const base = String(value || 'upload.csv').split(/[\\/]/).pop() || 'upload.csv';
  return base.replace(/[^a-zA-Z0-9._ -]+/g, '_').slice(0, 180);
}

function normalizeCell(value: unknown): string {
  const cleaned = String(value ?? '').trim();
  return cleaned === '-' ? '' : cleaned;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted value.');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function finiteNumber(value: unknown): number | null {
  const raw = normalizeCell(value);
  if (!raw) return null;
  const parsed = Number(raw.replace(/%$/, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= min && parsed <= max ? parsed : null;
}

const MONTHS = new Map([
  ['jan', '01'], ['feb', '02'], ['mar', '03'], ['apr', '04'], ['may', '05'], ['jun', '06'],
  ['jul', '07'], ['aug', '08'], ['sep', '09'], ['oct', '10'], ['nov', '11'], ['dec', '12'],
]);

function parseRapsodoDate(value: string): { date: string; time: string } | null {
  const raw = normalizeCell(value);
  const match = raw.match(/^(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return null;
  const month = MONTHS.get(match[1].toLowerCase());
  if (!month) return null;
  const day = Number(match[2]);
  let hour = Number(match[4]) % 12;
  if (match[7].toUpperCase() === 'PM') hour += 12;
  if (day < 1 || day > 31 || hour < 0 || hour > 23) return null;
  return {
    date: `${match[3]}-${month}-${String(day).padStart(2, '0')}`,
    time: `${String(hour).padStart(2, '0')}:${match[5]}:${match[6]}`,
  };
}

function normalizePitchType(value: string): string {
  const token = normalizeCell(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const aliases: Record<string, string> = {
    fastball: 'Fastball',
    fourseam: 'Fastball',
    fourseamfastball: 'Fastball',
    twoseam: 'Sinker',
    twoseamfastball: 'Sinker',
    sinker: 'Sinker',
    cutter: 'Cutter',
    slider: 'Slider',
    sweeper: 'Sweeper',
    curve: 'Curveball',
    curveball: 'Curveball',
    knucklecurve: 'Curveball',
    change: 'ChangeUp',
    changeup: 'ChangeUp',
    splitter: 'Splitter',
    splitfinger: 'Splitter',
    knuckleball: 'Knuckleball',
  };
  return aliases[token] ?? '';
}

function valueByHeader(row: string[], indexes: Map<string, number>, name: string): string {
  const index = indexes.get(name);
  return index === undefined ? '' : normalizeCell(row[index]);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateDashboardCsvBatch(files: Array<{ size: number; name: string }>): void {
  if (!files.length) throw new Error('Choose at least one CSV file.');
  if (files.length > MAX_FILES_PER_UPLOAD) throw new Error(`Upload no more than ${MAX_FILES_PER_UPLOAD} files at once.`);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error('The selected files exceed the 20 MB combined upload limit.');
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.csv')) throw new Error(`${file.name} is not a CSV file.`);
    if (file.size <= 0) throw new Error(`${file.name} is empty.`);
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} exceeds the 5 MB file limit.`);
  }
}

export function analyzeDashboardCsv(fileName: string, fileBytes: Uint8Array): ParsedDashboardCsv {
  const safeName = cleanFileName(fileName);
  const text = Buffer.from(fileBytes).toString('utf8').replace(/^\uFEFF/, '');
  const csvRows = parseCsvRows(text);
  const headerIndex = csvRows.findIndex((row) => normalizeCell(row[0]).toLowerCase() === 'no');
  if (headerIndex < 0) throw new Error(`${safeName}: could not find a Rapsodo pitching header row.`);

  const metadataRows = csvRows.slice(0, headerIndex);
  const metadata = new Map<string, string>();
  for (const row of metadataRows) {
    const key = normalizeCell(row[0]).replace(/:$/, '').toLowerCase();
    const value = normalizeCell(row[1]);
    if (key && value) metadata.set(key, value);
  }

  const header = csvRows[headerIndex].map(normalizeCell);
  const headerCounts = new Map<string, number>();
  for (const name of header) headerCounts.set(name, (headerCounts.get(name) ?? 0) + 1);
  const duplicateHeaders = [...headerCounts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  if (duplicateHeaders.length) {
    throw new Error(`${safeName}: duplicate columns detected (${duplicateHeaders.join(', ')}). Re-export the complete Rapsodo pitching metric set.`);
  }
  const missingHeaders = RAPSODO_REQUIRED_HEADERS.filter((name) => !headerCounts.has(name));
  if (!headerCounts.has('Unique ID') && !headerCounts.has('Pitch ID')) missingHeaders.push('Unique ID or Pitch ID' as never);
  if (!headerCounts.has('VB (spin)') && !headerCounts.has('VB (trajectory)')) missingHeaders.push('VB (spin) or VB (trajectory)' as never);
  if (!headerCounts.has('HB (spin)') && !headerCounts.has('HB (trajectory)')) missingHeaders.push('HB (spin) or HB (trajectory)' as never);
  if (missingHeaders.length) {
    throw new Error(`${safeName}: missing required Rapsodo columns: ${missingHeaders.join(', ')}.`);
  }

  const playerName = metadata.get('player name') ?? '';
  const playerId = metadata.get('player id') ?? '';
  if (!playerName) throw new Error(`${safeName}: Player Name metadata is missing.`);
  const indexes = new Map(header.map((name, index) => [name, index] as const));
  const bodyRows = csvRows.slice(headerIndex + 1).filter((row) => row.some((cell) => normalizeCell(cell)));
  const rows: CanonicalPitchRow[] = [];
  let invalidDateRows = 0;
  let invalidMetricRows = 0;
  let unknownPitchTypeRows = 0;
  let trajectoryMovementFallbacks = 0;
  let duplicatePitchRows = 0;
  const seenPitchKeys = new Set<string>();

  for (const sourceRow of bodyRows) {
    const parsedDate = parseRapsodoDate(valueByHeader(sourceRow, indexes, 'Date'));
    const pitchType = normalizePitchType(valueByHeader(sourceRow, indexes, 'Pitch Type'));
    const velocity = boundedNumber(valueByHeader(sourceRow, indexes, 'Velocity'), 30, 115);
    if (!parsedDate) {
      invalidDateRows += 1;
      continue;
    }
    if (!pitchType) {
      unknownPitchTypeRows += 1;
      continue;
    }
    if (velocity === null) {
      invalidMetricRows += 1;
      continue;
    }

    const uniqueId = valueByHeader(sourceRow, indexes, 'Unique ID');
    const pitchId = valueByHeader(sourceRow, indexes, 'Pitch ID') || uniqueId;
    if (!pitchId && !uniqueId) {
      invalidMetricRows += 1;
      continue;
    }
    const rawIvbSpin = boundedNumber(valueByHeader(sourceRow, indexes, 'VB (spin)'), -60, 60);
    const rawHbSpin = boundedNumber(valueByHeader(sourceRow, indexes, 'HB (spin)'), -60, 60);
    const rawIvbTrajectory = boundedNumber(valueByHeader(sourceRow, indexes, 'VB (trajectory)'), -60, 60);
    const rawHbTrajectory = boundedNumber(valueByHeader(sourceRow, indexes, 'HB (trajectory)'), -60, 60);
    if ((rawIvbSpin === null && rawIvbTrajectory !== null) || (rawHbSpin === null && rawHbTrajectory !== null)) {
      trajectoryMovementFallbacks += 1;
    }
    const plateSideInches = boundedNumber(valueByHeader(sourceRow, indexes, 'Strike Zone Side'), -72, 72);
    const plateHeightInches = boundedNumber(valueByHeader(sourceRow, indexes, 'Strike Zone Height'), -24, 96);
    const isStrike = valueByHeader(sourceRow, indexes, 'Is Strike').toUpperCase();
    const sourceIdentity = uniqueId || `${playerId || playerName}:${parsedDate.date}:${parsedDate.time}:${pitchId}`;
    const pitchKey = `rapsodo:${sha256(sourceIdentity).slice(0, 32)}`;
    if (seenPitchKeys.has(pitchKey)) {
      duplicatePitchRows += 1;
      continue;
    }
    seenPitchKeys.add(pitchKey);

    rows.push({
      sessionDate: parsedDate.date,
      time: parsedDate.time,
      pitcher: playerName,
      pitcherId: playerId,
      pitchType,
      pitchId,
      pitchKey,
      velocity,
      spinRate: boundedNumber(valueByHeader(sourceRow, indexes, 'Total Spin'), 0, 5000),
      spinEfficiency: boundedNumber(valueByHeader(sourceRow, indexes, 'Spin Efficiency (release)'), 0, 100),
      releaseTilt: valueByHeader(sourceRow, indexes, 'Spin Direction'),
      ivb: rawIvbSpin ?? rawIvbTrajectory,
      hb: rawHbSpin ?? rawHbTrajectory,
      releaseHeight: boundedNumber(valueByHeader(sourceRow, indexes, 'Release Height'), 2, 9),
      releaseSide: boundedNumber(valueByHeader(sourceRow, indexes, 'Release Side'), -5, 5),
      extension: boundedNumber(valueByHeader(sourceRow, indexes, 'Release Extension (ft)'), 0, 10),
      vaa: boundedNumber(valueByHeader(sourceRow, indexes, 'Vertical Approach Angle'), -30, 15),
      haa: boundedNumber(valueByHeader(sourceRow, indexes, 'Horizontal Approach Angle'), -30, 30),
      plateSide: plateSideInches === null ? null : plateSideInches / 12,
      plateHeight: plateHeightInches === null ? null : plateHeightInches / 12,
      pitchCall: isStrike === 'Y' ? 'RapsodoStrike' : isStrike === 'N' ? 'BallCalled' : '',
    });
  }

  if (!rows.length) throw new Error(`${safeName}: no valid Rapsodo pitching rows were found.`);
  const pitchTypeCounts = new Map<string, number>();
  for (const row of rows) pitchTypeCounts.set(row.pitchType, (pitchTypeCounts.get(row.pitchType) ?? 0) + 1);
  const dates = rows.map((row) => row.sessionDate).sort();
  const coverageFields: Array<[keyof CanonicalPitchRow, string, string]> = [
    ['velocity', 'velocity', 'Velocity'],
    ['spinRate', 'spin', 'Spin'],
    ['ivb', 'ivb', 'IVB'],
    ['hb', 'hb', 'HB'],
    ['releaseHeight', 'release', 'Release'],
    ['plateSide', 'location', 'Location'],
    ['vaa', 'approach', 'Approach angles'],
  ];
  const warnings = [
    invalidDateRows ? `${invalidDateRows} row${invalidDateRows === 1 ? '' : 's'} skipped because the date could not be read.` : '',
    invalidMetricRows ? `${invalidMetricRows} row${invalidMetricRows === 1 ? '' : 's'} skipped because a pitch ID or valid velocity was missing.` : '',
    unknownPitchTypeRows ? `${unknownPitchTypeRows} row${unknownPitchTypeRows === 1 ? '' : 's'} skipped because the pitch type was blank or unsupported.` : '',
    duplicatePitchRows ? `${duplicatePitchRows} duplicate pitch row${duplicatePitchRows === 1 ? '' : 's'} skipped inside the file.` : '',
    trajectoryMovementFallbacks ? `${trajectoryMovementFallbacks} row${trajectoryMovementFallbacks === 1 ? '' : 's'} used trajectory movement because spin-induced movement was unavailable.` : '',
    'Rapsodo bullpen files do not include batter, count, swing, whiff, or batted-ball outcomes.',
  ].filter(Boolean);

  return {
    rows,
    preview: {
      fileName: safeName,
      provider: 'Rapsodo',
      playerName,
      providerPlayerId: playerId,
      totalRows: bodyRows.length,
      validRows: rows.length,
      skippedRows: bodyRows.length - rows.length,
      minDate: dates[0] ?? null,
      maxDate: dates[dates.length - 1] ?? null,
      pitchTypes: [...pitchTypeCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      metricCoverage: coverageFields.map(([field, key, label]) => ({
        key,
        label,
        populated: rows.reduce((count, row) => count + (row[field] !== null && row[field] !== '' ? 1 : 0), 0),
        total: rows.length,
      })),
      warnings,
    },
  };
}

async function ensureDashboardCsvSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const pool = getDbPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dashboard_csv_uploads (
        id BIGSERIAL PRIMARY KEY,
        school_code TEXT NOT NULL,
        organization_id BIGINT NULL,
        provider TEXT NOT NULL,
        source_file_name TEXT NOT NULL,
        source_file_sha256 TEXT NOT NULL,
        file_size_bytes INT NOT NULL,
        status TEXT NOT NULL DEFAULT 'complete',
        pitcher_name TEXT NOT NULL,
        provider_player_id TEXT NULL,
        throwing_hand TEXT NOT NULL,
        session_type TEXT NOT NULL DEFAULT 'Bullpen',
        row_count INT NOT NULL,
        inserted_rows INT NOT NULL,
        skipped_rows INT NOT NULL,
        min_session_date DATE NULL,
        max_session_date DATE NULL,
        warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw_csv BYTEA NULL,
        created_by_user_id BIGINT NULL,
        refresh_token_sha256 TEXT NULL,
        refresh_requested_at TIMESTAMPTZ NULL,
        refresh_completed_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS dashboard_csv_uploads_school_hash_uidx
      ON dashboard_csv_uploads (school_code, source_file_sha256)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS dashboard_csv_uploads_school_created_idx
      ON dashboard_csv_uploads (school_code, created_at DESC)
    `);
    await pool.query(`ALTER TABLE dashboard_csv_uploads ADD COLUMN IF NOT EXISTS refresh_completed_at TIMESTAMPTZ NULL`);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function historyRow(row: Record<string, unknown>): DashboardCsvUploadHistory {
  return {
    id: Number(row.id),
    provider: String(row.provider ?? ''),
    fileName: String(row.source_file_name ?? ''),
    pitcherName: String(row.pitcher_name ?? ''),
    throwingHand: String(row.throwing_hand ?? ''),
    rowCount: Number(row.row_count ?? 0),
    insertedRows: Number(row.inserted_rows ?? 0),
    skippedRows: Number(row.skipped_rows ?? 0),
    minDate: row.min_session_date ? String(row.min_session_date) : null,
    maxDate: row.max_session_date ? String(row.max_session_date) : null,
    status: String(row.status ?? ''),
    refreshRequestedAt: row.refresh_requested_at ? String(row.refresh_requested_at) : null,
    refreshCompletedAt: row.refresh_completed_at ? String(row.refresh_completed_at) : null,
    createdAt: String(row.created_at ?? ''),
  };
}

export async function listDashboardCsvUploads(schoolCodeInput: string, limit = 30): Promise<DashboardCsvUploadHistory[]> {
  await ensureDashboardCsvSchema();
  const schoolCode = normalizeSchoolCode(schoolCodeInput);
  const result = await getDbPool().query(
    `SELECT id, provider, source_file_name, pitcher_name, throwing_hand, row_count, inserted_rows,
            skipped_rows, min_session_date::text, max_session_date::text, status,
            refresh_requested_at::text, refresh_completed_at::text, created_at::text
       FROM dashboard_csv_uploads
      WHERE school_code = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [schoolCode, Math.max(1, Math.min(100, Math.floor(limit)))]
  );
  return result.rows.map((row) => historyRow(row));
}

export async function listDashboardCsvPitcherNames(schoolCodeInput: string): Promise<string[]> {
  await ensureDashboardCsvSchema();
  const schoolCode = normalizeSchoolCode(schoolCodeInput);
  const result = await getDbPool().query<{ pitcher_name: string }>(
    `SELECT DISTINCT NULLIF(TRIM(pitcher_name), '') AS pitcher_name
       FROM dashboard_csv_uploads
      WHERE school_code = $1
        AND status = 'complete'
        AND NULLIF(TRIM(pitcher_name), '') IS NOT NULL
      ORDER BY pitcher_name`,
    [schoolCode]
  );
  return result.rows.map((row) => String(row.pitcher_name ?? '').trim()).filter(Boolean);
}

function toDbText(value: string | number | null): string | null {
  if (value === null || value === '') return null;
  return String(value);
}

async function insertPitchRows(
  client: PoolClient,
  input: { schoolCode: string; fileId: number; sourcePath: string; throwingHand: ThrowingHand; rows: CanonicalPitchRow[] }
): Promise<number> {
  let inserted = 0;
  for (let offset = 0; offset < input.rows.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = input.rows.slice(offset, offset + INSERT_CHUNK_SIZE);
    const keys = chunk.map((row) => row.pitchKey);
    const existing = await client.query<{ pitch_key: string }>(
      `SELECT pitch_key FROM pitch_events WHERE school_code = $1 AND pitch_key = ANY($2::text[])`,
      [input.schoolCode, keys]
    );
    const existingKeys = new Set(existing.rows.map((row) => row.pitch_key));
    const pending = chunk.filter((row) => !existingKeys.has(row.pitchKey));
    if (!pending.length) continue;

    const columns = [
      'school_code', 'file_id', 'session_date', 'session_type', 'source_file', 'pitch_key', 'date', 'pitcher',
      'pitcherthrows', 'taggedpitchtype', 'inducedvertbreak', 'horzbreak', 'relspeed', 'releasetilt', 'breaktilt',
      'spinefficiency', 'spinrate', 'relheight', 'relside', 'extension', 'vertapprangle', 'horzapprangle',
      'platelocside', 'platelocheight', 'pitchcall', 'sessiontype', 'pitchuid', 'pitchid', 'pitcherteam', 'time',
      'customlabel', 'pitcherid', 'relspeed_num', 'ivb_num', 'hb_num',
    ];
    const values: unknown[] = [];
    const placeholders = pending.map((row, rowIndex) => {
      const rowValues = [
        input.schoolCode, input.fileId, row.sessionDate, 'Bullpen', input.sourcePath, row.pitchKey, row.sessionDate,
        row.pitcher, input.throwingHand, row.pitchType, toDbText(row.ivb), toDbText(row.hb), toDbText(row.velocity),
        row.releaseTilt || null, row.releaseTilt || null, toDbText(row.spinEfficiency), toDbText(row.spinRate),
        toDbText(row.releaseHeight), toDbText(row.releaseSide), toDbText(row.extension), toDbText(row.vaa),
        toDbText(row.haa), toDbText(row.plateSide), toDbText(row.plateHeight), row.pitchCall || null, 'Bullpen',
        row.pitchKey, row.pitchId || null, input.schoolCode, row.time, 'Baseball', row.pitcherId || null,
        row.velocity, row.ivb, row.hb,
      ];
      values.push(...rowValues);
      return `(${rowValues.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(',')})`;
    });
    const result = await client.query(
      `INSERT INTO pitch_events (${columns.join(',')}) VALUES ${placeholders.join(',')} RETURNING id`,
      values
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

export async function importDashboardCsv(input: ImportInput): Promise<ImportResult> {
  await ensureDashboardCsvSchema();
  const schoolCode = normalizeSchoolCode(input.schoolCode);
  if (input.throwingHand !== 'Right' && input.throwingHand !== 'Left') throw new Error('Select a throwing hand for every file.');
  const parsed = analyzeDashboardCsv(input.fileName, input.fileBytes);
  const fileHash = sha256(input.fileBytes);
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`dashboard-csv:${schoolCode}`]);
    const duplicate = await client.query(
      `SELECT id, provider, source_file_name, pitcher_name, throwing_hand, row_count, inserted_rows,
              skipped_rows, min_session_date::text, max_session_date::text, status,
              refresh_requested_at::text, refresh_completed_at::text, created_at::text
         FROM dashboard_csv_uploads
        WHERE school_code = $1 AND source_file_sha256 = $2
        LIMIT 1`,
      [schoolCode, fileHash]
    );
    if (duplicate.rows[0]) {
      await client.query('COMMIT');
      return { upload: historyRow(duplicate.rows[0]), duplicateFile: true, refreshToken: null };
    }

    const safeName = cleanFileName(input.fileName);
    const sourcePath = `manual/rapsodo/${schoolCode}/${fileHash.slice(0, 16)}/${safeName}`;
    const fileRecord = await client.query<{ file_id: string }>(
      `INSERT INTO pitch_data_files (school_code, source_file, file_checksum, file_mtime, row_count)
       VALUES ($1, $2, $3, NOW(), $4)
       RETURNING file_id`,
      [schoolCode, sourcePath, fileHash, parsed.preview.validRows]
    );
    const fileId = Number(fileRecord.rows[0]?.file_id);
    if (!Number.isFinite(fileId) || fileId <= 0) throw new Error('Unable to allocate an upload file record.');
    const insertedRows = await insertPitchRows(client, {
      schoolCode,
      fileId,
      sourcePath,
      throwingHand: input.throwingHand,
      rows: parsed.rows,
    });
    const skippedRows = parsed.preview.totalRows - insertedRows;
    const refreshToken = randomBytes(32).toString('hex');
    const uploadResult = await client.query(
      `INSERT INTO dashboard_csv_uploads (
         school_code, organization_id, provider, source_file_name, source_file_sha256, file_size_bytes,
         status, pitcher_name, provider_player_id, throwing_hand, session_type, row_count, inserted_rows,
         skipped_rows, min_session_date, max_session_date, warnings, raw_csv, created_by_user_id,
         refresh_token_sha256
       ) VALUES ($1,$2,'Rapsodo',$3,$4,$5,'complete',$6,$7,$8,'Bullpen',$9,$10,$11,$12::date,$13::date,$14::jsonb,$15,$16,$17)
       RETURNING id, provider, source_file_name, pitcher_name, throwing_hand, row_count, inserted_rows,
                 skipped_rows, min_session_date::text, max_session_date::text, status,
                 refresh_requested_at::text, refresh_completed_at::text, created_at::text`,
      [
        schoolCode,
        input.organizationId > 0 ? input.organizationId : null,
        safeName,
        fileHash,
        input.fileBytes.byteLength,
        parsed.preview.playerName,
        parsed.preview.providerPlayerId || null,
        input.throwingHand,
        parsed.preview.totalRows,
        insertedRows,
        skippedRows,
        parsed.preview.minDate,
        parsed.preview.maxDate,
        JSON.stringify(parsed.preview.warnings),
        Buffer.from(input.fileBytes),
        input.createdByUserId && input.createdByUserId > 0 ? input.createdByUserId : null,
        sha256(refreshToken),
      ]
    );
    await client.query('COMMIT');
    return { upload: historyRow(uploadResult.rows[0]), duplicateFile: false, refreshToken };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

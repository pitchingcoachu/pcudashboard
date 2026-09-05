import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getDbPool, isDatabaseConfigured } from './auth-db';

const MAX_FILES = 10;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const INSERT_CHUNK = 300;

type CsvKind = 'workload' | 'events';
type WorkloadImportRow = {
  playerKey: string; firstName: string; lastName: string; date: string;
  acRatio: number | null; acuteWorkload: number | null; chronicWorkload: number | null;
  oneDayWorkload: number | null; totalThrowCount: number | null; highEffortThrowCount: number | null;
};
type EventImportRow = {
  eventKey: string; playerKey: string; firstName: string; lastName: string; datetime: string;
  tag: string | null; highEffort: boolean; armSlot: number | null; armSpeed: number | null;
  shoulderRotation: number | null; torque: number | null; ballVelocity: number | null;
  ballWeight: number | null; ballWeightUnit: string | null; simulated: boolean;
};

export type PulseOverviewPlayer = {
  playerKey: string; playerName: string; lastDate: string | null; acRatio: number | null;
  acuteWorkload: number | null; chronicWorkload: number | null; oneDayWorkload: number | null;
  totalThrowCount: number | null; highEffortThrowCount: number | null; eventCount28d: number;
};

let schemaReady: Promise<void> | null = null;

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/^\uFEFF/, '').trim();
}

function schoolCode(value: string): string {
  const normalized = cleanText(value).toUpperCase();
  if (!/^[A-Z0-9_-]{2,32}$/.test(normalized) || normalized === 'LEAGUE' || normalized === 'PRO') {
    throw new Error('Select a specific school before importing PULSE data.');
  }
  return normalized;
}

function playerKey(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
}

function numberOrNull(value: unknown): number | null {
  const raw = cleanText(value);
  if (!raw) return null;
  const valueNumber = Number(raw);
  return Number.isFinite(valueNumber) ? valueNumber : null;
}

function booleanValue(value: unknown): boolean {
  return ['true', '1', 'yes', 'y'].includes(cleanText(value).toLowerCase());
}

function isoDate(value: unknown): string | null {
  const parsed = new Date(cleanText(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function isoDatetime(value: unknown): string | null {
  const parsed = new Date(cleanText(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted value.');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((entry) => entry.some((value) => cleanText(value)));
}

function rowObjects(bytes: Uint8Array): { headers: string[]; rows: Array<Record<string, string>> } {
  const parsed = parseCsv(new TextDecoder('utf-8').decode(bytes));
  if (parsed.length < 2) throw new Error('CSV has no data rows.');
  const headers = parsed[0].map(cleanText);
  const rows = parsed.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, cleanText(values[index])]))
  );
  return { headers, rows };
}

function detectKind(headers: string[]): CsvKind {
  const keys = new Set(headers.map((header) => header.toLowerCase()));
  if (keys.has('date') && keys.has('a:c ratio') && keys.has('acute workload')) return 'workload';
  if (keys.has('datetime') && keys.has('armspeed') && keys.has('torque')) return 'events';
  throw new Error('CSV is not a recognized PULSE workload or events export.');
}

function parseWorkload(rows: Array<Record<string, string>>): WorkloadImportRow[] {
  return rows.flatMap((row) => {
    const firstName = cleanText(row.firstName);
    const lastName = cleanText(row.lastName);
    const date = isoDate(row.date);
    const key = playerKey(firstName, lastName);
    if (!firstName || !lastName || !date || !key) return [];
    return [{
      playerKey: key, firstName, lastName, date,
      acRatio: numberOrNull(row['A:C Ratio']), acuteWorkload: numberOrNull(row['Acute Workload']),
      chronicWorkload: numberOrNull(row['Chronic Workload']), oneDayWorkload: numberOrNull(row['One Day Workload']),
      totalThrowCount: numberOrNull(row['Total Throw Count']), highEffortThrowCount: numberOrNull(row['High Effort Throw Count']),
    }];
  });
}

function parseEvents(rows: Array<Record<string, string>>): EventImportRow[] {
  return rows.flatMap((row) => {
    const firstName = cleanText(row.firstName);
    const lastName = cleanText(row.lastName);
    const datetime = isoDatetime(row.datetime);
    const key = playerKey(firstName, lastName);
    if (!firstName || !lastName || !datetime || !key) return [];
    const identity = [key, datetime, row.tag, row.armSlot, row.armSpeed, row.torque, row.ballWeight].join('|');
    return [{
      eventKey: createHash('sha256').update(identity).digest('hex'), playerKey: key, firstName, lastName, datetime,
      tag: cleanText(row.tag) || null, highEffort: booleanValue(row.highEffort), armSlot: numberOrNull(row.armSlot),
      armSpeed: numberOrNull(row.armSpeed), shoulderRotation: numberOrNull(row.shoulderRotation), torque: numberOrNull(row.torque),
      ballVelocity: numberOrNull(row.ballVelocity), ballWeight: numberOrNull(row.ballWeight),
      ballWeightUnit: cleanText(row.preferredBallWeightUnit) || null, simulated: booleanValue(row.simulated),
    }];
  });
}

async function ensureSchema(): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const pool = getDbPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pulse_uploads (
        id BIGSERIAL PRIMARY KEY, school_code TEXT NOT NULL, organization_id INTEGER, file_name TEXT NOT NULL,
        file_hash TEXT NOT NULL, source_type TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0,
        inserted_rows INTEGER NOT NULL DEFAULT 0, min_date DATE, max_date DATE, uploaded_by_user_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (school_code, file_hash)
      );
      CREATE TABLE IF NOT EXISTS pulse_workload_daily (
        id BIGSERIAL PRIMARY KEY, school_code TEXT NOT NULL, player_key TEXT NOT NULL, first_name TEXT NOT NULL,
        last_name TEXT NOT NULL, workload_date DATE NOT NULL, ac_ratio DOUBLE PRECISION, acute_workload DOUBLE PRECISION,
        chronic_workload DOUBLE PRECISION, one_day_workload DOUBLE PRECISION, total_throw_count INTEGER,
        high_effort_throw_count INTEGER, source_upload_id BIGINT REFERENCES pulse_uploads(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (school_code, player_key, workload_date)
      );
      CREATE TABLE IF NOT EXISTS pulse_events (
        id BIGSERIAL PRIMARY KEY, school_code TEXT NOT NULL, event_key TEXT NOT NULL, player_key TEXT NOT NULL,
        first_name TEXT NOT NULL, last_name TEXT NOT NULL, event_time TIMESTAMPTZ NOT NULL, tag TEXT,
        high_effort BOOLEAN NOT NULL DEFAULT FALSE, arm_slot DOUBLE PRECISION, arm_speed DOUBLE PRECISION,
        shoulder_rotation DOUBLE PRECISION, torque DOUBLE PRECISION, ball_velocity DOUBLE PRECISION,
        ball_weight DOUBLE PRECISION, ball_weight_unit TEXT, simulated BOOLEAN NOT NULL DEFAULT FALSE,
        source_upload_id BIGINT REFERENCES pulse_uploads(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (school_code, event_key)
      );
      CREATE INDEX IF NOT EXISTS pulse_workload_school_player_date_idx ON pulse_workload_daily (school_code, player_key, workload_date DESC);
      CREATE INDEX IF NOT EXISTS pulse_events_school_player_time_idx ON pulse_events (school_code, player_key, event_time DESC);
      CREATE INDEX IF NOT EXISTS pulse_uploads_school_created_idx ON pulse_uploads (school_code, created_at DESC);
    `);
  })().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

function cleanFileName(value: string): string {
  return (value.split(/[\\/]/).pop() || 'pulse.csv').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180);
}

export function validatePulseFiles(files: File[]): void {
  if (!files.length) throw new Error('Choose at least one PULSE CSV.');
  if (files.length > MAX_FILES) throw new Error(`Choose no more than ${MAX_FILES} CSVs at once.`);
  let total = 0;
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.csv')) throw new Error(`${file.name} is not a CSV.`);
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} exceeds the 8 MB limit.`);
    total += file.size;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error('Combined upload exceeds the 30 MB limit.');
}

export function analyzePulseCsv(fileName: string, bytes: Uint8Array) {
  const parsed = rowObjects(bytes);
  const kind = detectKind(parsed.headers);
  const rows = kind === 'workload' ? parseWorkload(parsed.rows) : parseEvents(parsed.rows);
  if (!rows.length) throw new Error(`${fileName} contains no valid PULSE rows.`);
  const dates = rows
    .map((row) => kind === 'workload' ? (row as WorkloadImportRow).date : (row as EventImportRow).datetime.slice(0, 10))
    .sort();
  return {
    fileName,
    kind,
    rowCount: rows.length,
    playerCount: new Set(rows.map((row) => row.playerKey)).size,
    minDate: dates[0],
    maxDate: dates[dates.length - 1],
  };
}

async function insertWorkload(client: PoolClient, school: string, uploadId: number, rows: WorkloadImportRow[]): Promise<number> {
  let affected = 0;
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK) {
    const chunk = rows.slice(offset, offset + INSERT_CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((row) => {
      const start = values.length;
      values.push(school, row.playerKey, row.firstName, row.lastName, row.date, row.acRatio, row.acuteWorkload, row.chronicWorkload,
        row.oneDayWorkload, row.totalThrowCount, row.highEffortThrowCount, uploadId);
      return `(${Array.from({ length: 12 }, (_, index) => `$${start + index + 1}`).join(',')})`;
    });
    const result = await client.query(`
      INSERT INTO pulse_workload_daily (school_code, player_key, first_name, last_name, workload_date, ac_ratio,
        acute_workload, chronic_workload, one_day_workload, total_throw_count, high_effort_throw_count, source_upload_id)
      VALUES ${tuples.join(',')}
      ON CONFLICT (school_code, player_key, workload_date) DO UPDATE SET
        first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, ac_ratio=EXCLUDED.ac_ratio,
        acute_workload=EXCLUDED.acute_workload, chronic_workload=EXCLUDED.chronic_workload,
        one_day_workload=EXCLUDED.one_day_workload, total_throw_count=EXCLUDED.total_throw_count,
        high_effort_throw_count=EXCLUDED.high_effort_throw_count, source_upload_id=EXCLUDED.source_upload_id, updated_at=NOW()
    `, values);
    affected += result.rowCount ?? 0;
  }
  return affected;
}

async function insertEvents(client: PoolClient, school: string, uploadId: number, rows: EventImportRow[]): Promise<number> {
  let affected = 0;
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK) {
    const chunk = rows.slice(offset, offset + INSERT_CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((row) => {
      const start = values.length;
      values.push(school, row.eventKey, row.playerKey, row.firstName, row.lastName, row.datetime, row.tag, row.highEffort,
        row.armSlot, row.armSpeed, row.shoulderRotation, row.torque, row.ballVelocity, row.ballWeight, row.ballWeightUnit, row.simulated, uploadId);
      return `(${Array.from({ length: 17 }, (_, index) => `$${start + index + 1}`).join(',')})`;
    });
    const result = await client.query(`
      INSERT INTO pulse_events (school_code, event_key, player_key, first_name, last_name, event_time, tag, high_effort,
        arm_slot, arm_speed, shoulder_rotation, torque, ball_velocity, ball_weight, ball_weight_unit, simulated, source_upload_id)
      VALUES ${tuples.join(',')} ON CONFLICT (school_code, event_key) DO NOTHING
    `, values);
    affected += result.rowCount ?? 0;
  }
  return affected;
}

export async function importPulseFile(input: { schoolCode: string; organizationId: number; userId: number; file: File }) {
  const school = schoolCode(input.schoolCode);
  await ensureSchema();
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex');
  const parsed = rowObjects(bytes);
  const kind = detectKind(parsed.headers);
  const rows = kind === 'workload' ? parseWorkload(parsed.rows) : parseEvents(parsed.rows);
  if (!rows.length) throw new Error(`${input.file.name} contains no valid PULSE rows.`);
  const dates = rows.map((row) => kind === 'workload' ? (row as WorkloadImportRow).date : (row as EventImportRow).datetime.slice(0, 10)).sort();

  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ id: string; source_type: string; row_count: number; inserted_rows: number }>(
      `SELECT id::text, source_type, row_count, inserted_rows FROM pulse_uploads WHERE school_code=$1 AND file_hash=$2`, [school, hash]);
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      return { fileName: input.file.name, kind: existing.rows[0].source_type, rowCount: existing.rows[0].row_count, insertedRows: 0, duplicate: true };
    }
    const upload = await client.query<{ id: string }>(`
      INSERT INTO pulse_uploads (school_code, organization_id, file_name, file_hash, source_type, row_count, min_date, max_date, uploaded_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text
    `, [school, input.organizationId || null, cleanFileName(input.file.name), hash, kind, rows.length, dates[0], dates[dates.length - 1], input.userId || null]);
    const uploadId = Number(upload.rows[0].id);
    const insertedRows = kind === 'workload'
      ? await insertWorkload(client, school, uploadId, rows as WorkloadImportRow[])
      : await insertEvents(client, school, uploadId, rows as EventImportRow[]);
    await client.query(`UPDATE pulse_uploads SET inserted_rows=$1 WHERE id=$2`, [insertedRows, uploadId]);
    await client.query('COMMIT');
    return { fileName: input.file.name, kind, rowCount: rows.length, insertedRows, duplicate: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function num(value: unknown): number | null {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
}

export async function getPulseDashboard(input: { schoolCode: string; playerKey?: string; startDate?: string; endDate?: string; sort?: string }) {
  const school = schoolCode(input.schoolCode);
  await ensureSchema();
  const pool = getDbPool();
  const playersResult = await pool.query(`
    WITH names AS (
      SELECT player_key, first_name, last_name FROM pulse_workload_daily WHERE school_code=$1
      UNION SELECT player_key, first_name, last_name FROM pulse_events WHERE school_code=$1
    ), latest AS (
      SELECT DISTINCT ON (player_key) player_key, workload_date::text AS last_date, ac_ratio, acute_workload, chronic_workload,
        one_day_workload, total_throw_count, high_effort_throw_count
      FROM pulse_workload_daily WHERE school_code=$1 ORDER BY player_key, workload_date DESC
    ), recent_events AS (
      SELECT player_key, COUNT(*)::int AS event_count FROM pulse_events
      WHERE school_code=$1 AND event_time >= NOW() - INTERVAL '28 days' GROUP BY player_key
    )
    SELECT n.player_key, MIN(n.first_name) AS first_name, MIN(n.last_name) AS last_name, l.last_date, l.ac_ratio,
      l.acute_workload, l.chronic_workload, l.one_day_workload, l.total_throw_count, l.high_effort_throw_count,
      COALESCE(r.event_count,0)::int AS event_count
    FROM names n LEFT JOIN latest l USING(player_key) LEFT JOIN recent_events r USING(player_key)
    GROUP BY n.player_key,l.last_date,l.ac_ratio,l.acute_workload,l.chronic_workload,l.one_day_workload,l.total_throw_count,
      l.high_effort_throw_count,r.event_count ORDER BY MIN(n.last_name),MIN(n.first_name)
  `, [school]);
  const players: PulseOverviewPlayer[] = playersResult.rows.map((row) => ({
    playerKey: row.player_key, playerName: `${row.first_name} ${row.last_name}`.trim(), lastDate: row.last_date ?? null,
    acRatio: num(row.ac_ratio), acuteWorkload: num(row.acute_workload), chronicWorkload: num(row.chronic_workload),
    oneDayWorkload: num(row.one_day_workload), totalThrowCount: num(row.total_throw_count),
    highEffortThrowCount: num(row.high_effort_throw_count), eventCount28d: Number(row.event_count ?? 0),
  }));
  const selectedKey = players.some((player) => player.playerKey === input.playerKey) ? input.playerKey! : players[0]?.playerKey ?? '';
  const conditions = ['school_code=$1', 'player_key=$2'];
  const params: unknown[] = [school, selectedKey];
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.startDate ?? '')) { params.push(input.startDate); conditions.push(`workload_date >= $${params.length}::date`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.endDate ?? '')) { params.push(input.endDate); conditions.push(`workload_date <= $${params.length}::date`); }
  const direction = input.sort === 'asc' ? 'ASC' : 'DESC';
  const workload = selectedKey ? (await pool.query(`
    SELECT workload_date::text AS date, ac_ratio, acute_workload, chronic_workload, one_day_workload,
      total_throw_count, high_effort_throw_count FROM pulse_workload_daily WHERE ${conditions.join(' AND ')} ORDER BY workload_date ${direction}
  `, params)).rows.map((row) => ({ date: row.date, acRatio: num(row.ac_ratio), acuteWorkload: num(row.acute_workload),
    chronicWorkload: num(row.chronic_workload), oneDayWorkload: num(row.one_day_workload), totalThrowCount: num(row.total_throw_count),
    highEffortThrowCount: num(row.high_effort_throw_count) })) : [];

  const eventConditions = ['school_code=$1', 'player_key=$2'];
  const eventParams: unknown[] = [school, selectedKey];
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.startDate ?? '')) { eventParams.push(input.startDate); eventConditions.push(`event_time >= $${eventParams.length}::date`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.endDate ?? '')) { eventParams.push(input.endDate); eventConditions.push(`event_time < ($${eventParams.length}::date + INTERVAL '1 day')`); }
  const events = selectedKey ? (await pool.query(`
    SELECT id::text, event_time::text AS datetime, tag, high_effort, arm_slot, arm_speed, shoulder_rotation, torque,
      ball_velocity, ball_weight, ball_weight_unit, simulated FROM pulse_events WHERE ${eventConditions.join(' AND ')}
    ORDER BY event_time ${direction}, id ${direction} LIMIT 10000
  `, eventParams)).rows.map((row) => ({ id: row.id, datetime: row.datetime, tag: row.tag, highEffort: row.high_effort,
    armSlot: num(row.arm_slot), armSpeed: num(row.arm_speed), shoulderRotation: num(row.shoulder_rotation), torque: num(row.torque),
    ballVelocity: num(row.ball_velocity), ballWeight: num(row.ball_weight), ballWeightUnit: row.ball_weight_unit, simulated: row.simulated })) : [];

  const dailyEvents = selectedKey ? (await pool.query(`
    SELECT event_time::date::text AS date, COUNT(*)::int AS throws, COUNT(*) FILTER (WHERE high_effort)::int AS high_effort,
      AVG(arm_speed) AS arm_speed, MAX(arm_speed) AS max_arm_speed, AVG(torque) AS torque, MAX(torque) AS max_torque,
      AVG(arm_slot) AS arm_slot, AVG(shoulder_rotation) AS shoulder_rotation
    FROM pulse_events WHERE ${eventConditions.join(' AND ')} GROUP BY event_time::date ORDER BY event_time::date ${direction}
  `, eventParams)).rows.map((row) => ({ date: row.date, throws: Number(row.throws), highEffortThrows: Number(row.high_effort),
    armSpeed: num(row.arm_speed), maxArmSpeed: num(row.max_arm_speed), torque: num(row.torque), maxTorque: num(row.max_torque),
    armSlot: num(row.arm_slot), shoulderRotation: num(row.shoulder_rotation) })) : [];

  const summary = selectedKey ? (await pool.query(`
    SELECT
      (
        SELECT COALESCE(SUM(w.total_throw_count), 0) / 7.0
        FROM pulse_workload_daily w
        WHERE w.school_code=$1 AND w.player_key=$2
          AND w.workload_date BETWEEN (
            SELECT MAX(workload_date) - 7
            FROM pulse_workload_daily
            WHERE school_code=$1 AND player_key=$2
          ) AND (
            SELECT MAX(workload_date) - 1
            FROM pulse_workload_daily
            WHERE school_code=$1 AND player_key=$2
          )
      ) AS throws_7,
      COUNT(*) FILTER (WHERE event_time >= NOW()-INTERVAL '28 days') / 28.0 AS throws_28,
      AVG(torque) FILTER (WHERE event_time >= NOW()-INTERVAL '7 days') AS torque_7,
      AVG(arm_speed) FILTER (WHERE event_time >= NOW()-INTERVAL '7 days') AS arm_speed_7
    FROM pulse_events WHERE school_code=$1 AND player_key=$2
  `, [school, selectedKey])).rows[0] : null;
  const stress = selectedKey ? (await pool.query(`
    WITH anchor AS (
      SELECT MAX(workload_date) AS end_date
      FROM pulse_workload_daily
      WHERE school_code=$1 AND player_key=$2
    ), daily_torque_power AS (
      SELECT event_time::date AS event_date, SUM(POWER(ABS(torque), 1.3)) AS torque_power
      FROM pulse_events
      WHERE school_code=$1 AND player_key=$2 AND torque IS NOT NULL
      GROUP BY event_time::date
    ), body_weight AS (
      SELECT POWER(
        SUM(d.torque_power) / NULLIF(SUM(w.one_day_workload), 0),
        1.0 / 1.3
      ) AS pounds
      FROM pulse_workload_daily w
      JOIN daily_torque_power d ON d.event_date = w.workload_date
      WHERE w.school_code=$1 AND w.player_key=$2 AND w.one_day_workload > 0
    ), event_averages AS (
      SELECT
        AVG(torque) FILTER (
          WHERE event_time::date BETWEEN (SELECT end_date FROM anchor) - 6 AND (SELECT end_date FROM anchor)
        ) AS torque_7,
        AVG(torque) FILTER (
          WHERE event_time::date BETWEEN (SELECT end_date FROM anchor) - 27 AND (SELECT end_date FROM anchor)
        ) AS torque_28
      FROM pulse_events
      WHERE school_code=$1 AND player_key=$2 AND torque IS NOT NULL
    )
    SELECT
      e.torque_7 / NULLIF(b.pounds, 0) AS stress_7,
      e.torque_28 / NULLIF(b.pounds, 0) AS stress_28
    FROM event_averages e
    CROSS JOIN body_weight b
  `, [school, selectedKey])).rows[0] : null;
  const uploads = (await pool.query(`SELECT id::text,file_name,source_type,row_count,inserted_rows,min_date::text,max_date::text,created_at::text
    FROM pulse_uploads WHERE school_code=$1 ORDER BY created_at DESC LIMIT 12`, [school])).rows.map((row) => ({
      id: row.id, fileName: row.file_name, kind: row.source_type, rowCount: Number(row.row_count), insertedRows: Number(row.inserted_rows),
      minDate: row.min_date, maxDate: row.max_date, createdAt: row.created_at,
    }));
  return { schoolCode: school, players, selectedPlayerKey: selectedKey, workload, events, dailyEvents, uploads,
    summary: { throws7: Number(summary?.throws_7 ?? 0), throws28: Number(summary?.throws_28 ?? 0),
      avgTorque7: num(summary?.torque_7), avgArmSpeed7: num(summary?.arm_speed_7), avgStress7: num(stress?.stress_7), avgStress28: num(stress?.stress_28) } };
}

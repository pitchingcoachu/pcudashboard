import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { getDbPool, isDatabaseConfigured } from './auth-db';

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const REQUIRED_HEADERS = [
  'Athlete', 'Date', 'Exercise', 'Sprint #', 'Total Time (s)', 'In-Beam Start',
  'Trigger Start', 'Split #', 'Split Time (s)', 'Distance (yd)', 'Speed (mph)', 'Set Note',
] as const;

export type OvrSprintResult = {
  id: number;
  playerId: number | null;
  athleteName: string;
  date: string;
  exercise: string;
  sprintNumber: number;
  totalTime: number;
  inBeamStart: boolean;
  triggerStart: boolean;
  splitNumber: number;
  splitTime: number;
  distanceYards: number | null;
  speedMph: number | null;
  note: string;
};

export type OvrSprintUpload = {
  id: number;
  fileName: string;
  rowCount: number;
  insertedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  unmatchedAthletes: string[];
  minDate: string | null;
  maxDate: string | null;
  createdAt: string;
};

export type OvrSprintImportPreview = {
  fileName: string;
  totalRows: number;
  validRows: number;
  athletes: string[];
  exercises: string[];
  minDate: string | null;
  maxDate: string | null;
  warnings: string[];
};

type ParsedRow = Omit<OvrSprintResult, 'id' | 'playerId'> & { resultKey: string; athleteNameNorm: string };

let schemaReady: Promise<void> | null = null;

export function normalizeOvrAthleteName(value: string): string {
  const raw = String(value ?? '').trim();
  const firstLast = raw.includes(',')
    ? (() => {
        const [last, ...first] = raw.split(',').map((part) => part.trim()).filter(Boolean);
        return `${first.join(' ')} ${last}`.trim();
      })()
    : raw;
  return firstLast.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/^\uFEFF/, '').trim();
}

function numberValue(value: unknown): number | null {
  const parsed = Number(clean(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  return ['yes', 'true', '1', 'y'].includes(clean(value).toLowerCase());
}

function isoDate(value: unknown): string | null {
  const raw = clean(value);
  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? 'A';
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function parseSharedStrings(xml: string): string[] {
  return Array.from(xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g), (match) =>
    Array.from(match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (text) => decodeXml(text[1])).join('')
  );
}

function parseWorksheet(xml: string, shared: string[]): string[][] {
  return Array.from(xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g), (rowMatch) => {
    const values: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const reference = attributes.match(/\br="([A-Z]+\d+)"/)?.[1] ?? 'A1';
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? '';
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        ?? body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1]
        ?? '';
      values[columnIndex(reference)] = type === 's' ? (shared[Number(raw)] ?? '') : decodeXml(raw);
    }
    return values;
  });
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
  if (quoted) throw new Error('The CSV contains an unclosed quoted value.');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

async function workbookRows(fileName: string, bytes: Uint8Array): Promise<string[][]> {
  if (fileName.toLowerCase().endsWith('.csv')) return parseCsv(new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, ''));
  if (!fileName.toLowerCase().endsWith('.xlsx')) throw new Error('Choose an OVR .xlsx or Sprint .csv export.');
  const zip = await JSZip.loadAsync(bytes);
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const relationshipsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !relationshipsXml) throw new Error('The workbook structure could not be read.');
  const sprintSheet = Array.from(workbookXml.matchAll(/<sheet\s([^>]+)\/?\s*>/g))
    .map((match) => ({ name: decodeXml(match[1].match(/\bname="([^"]+)"/)?.[1] ?? ''), id: match[1].match(/r:id="([^"]+)"/)?.[1] ?? '' }))
    .find((sheet) => sheet.name.trim().toLowerCase() === 'sprint');
  if (!sprintSheet) throw new Error('This OVR workbook does not contain a Sprint sheet.');
  const relationship = Array.from(relationshipsXml.matchAll(/<Relationship\s([^>]+)\/?\s*>/g))
    .map((match) => ({ id: match[1].match(/\bId="([^"]+)"/)?.[1] ?? '', target: match[1].match(/\bTarget="([^"]+)"/)?.[1] ?? '' }))
    .find((entry) => entry.id === sprintSheet.id);
  if (!relationship) throw new Error('The Sprint worksheet could not be located.');
  const sheetPath = relationship.target.startsWith('/') ? relationship.target.slice(1) : `xl/${relationship.target.replace(/^\.\//, '')}`;
  const sheetXml = await zip.file(sheetPath)?.async('string');
  if (!sheetXml) throw new Error('The Sprint worksheet could not be opened.');
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  return parseWorksheet(sheetXml, sharedXml ? parseSharedStrings(sharedXml) : []);
}

async function parseOvrSprint(fileName: string, bytes: Uint8Array): Promise<{ preview: OvrSprintImportPreview; rows: ParsedRow[] }> {
  if (!bytes.byteLength) throw new Error(`${fileName} is empty.`);
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`${fileName} exceeds the 12 MB limit.`);
  const grid = (await workbookRows(fileName, bytes)).filter((row) => row.some((value) => clean(value)));
  if (grid.length < 2) throw new Error('The Sprint sheet has no data rows.');
  const headers = grid[0].map(clean);
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`The Sprint sheet is missing: ${missing.join(', ')}.`);
  const indexes = new Map(headers.map((header, index) => [header, index]));
  const value = (row: string[], header: string) => clean(row[indexes.get(header) ?? -1]);
  const warnings: string[] = [];
  const rows = grid.slice(1).flatMap((row, rowIndex): ParsedRow[] => {
    const athleteName = value(row, 'Athlete');
    const athleteNameNorm = normalizeOvrAthleteName(athleteName);
    const date = isoDate(value(row, 'Date'));
    const exercise = value(row, 'Exercise');
    const sprintNumber = integerValue(value(row, 'Sprint #'));
    const totalTime = numberValue(value(row, 'Total Time (s)'));
    const splitNumber = integerValue(value(row, 'Split #'));
    const splitTime = numberValue(value(row, 'Split Time (s)'));
    if (!athleteNameNorm || !date || !exercise || sprintNumber === null || totalTime === null || splitNumber === null || splitTime === null) {
      warnings.push(`Row ${rowIndex + 2} was skipped because a required value was missing or invalid.`);
      return [];
    }
    const identity = [athleteNameNorm, date, exercise.toLowerCase(), sprintNumber, totalTime, splitNumber, splitTime, value(row, 'Distance (yd)'), value(row, 'Speed (mph)')].join('|');
    return [{
      resultKey: createHash('sha256').update(identity).digest('hex'), athleteName, athleteNameNorm, date, exercise,
      sprintNumber, totalTime, inBeamStart: booleanValue(value(row, 'In-Beam Start')),
      triggerStart: booleanValue(value(row, 'Trigger Start')), splitNumber, splitTime,
      distanceYards: numberValue(value(row, 'Distance (yd)')), speedMph: numberValue(value(row, 'Speed (mph)')),
      note: value(row, 'Set Note'),
    }];
  });
  const dates = rows.map((row) => row.date).sort();
  return {
    preview: {
      fileName, totalRows: Math.max(0, grid.length - 1), validRows: rows.length,
      athletes: [...new Set(rows.map((row) => row.athleteName))].sort(),
      exercises: [...new Set(rows.map((row) => row.exercise))].sort(),
      minDate: dates[0] ?? null, maxDate: dates.at(-1) ?? null, warnings: warnings.slice(0, 12),
    },
    rows,
  };
}

async function ensureSchema(): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await getDbPool().query(`
      CREATE TABLE IF NOT EXISTS ovr_sprint_uploads (
        id BIGSERIAL PRIMARY KEY, organization_id BIGINT NOT NULL, school_code TEXT NOT NULL,
        file_name TEXT NOT NULL, file_hash TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0,
        inserted_rows INTEGER NOT NULL DEFAULT 0, matched_rows INTEGER NOT NULL DEFAULT 0,
        unmatched_rows INTEGER NOT NULL DEFAULT 0, unmatched_athletes JSONB NOT NULL DEFAULT '[]'::jsonb,
        min_date DATE, max_date DATE, uploaded_by_user_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, school_code, file_hash)
      );
      CREATE TABLE IF NOT EXISTS ovr_sprint_results (
        id BIGSERIAL PRIMARY KEY, organization_id BIGINT NOT NULL, school_code TEXT NOT NULL,
        result_key TEXT NOT NULL, athlete_name TEXT NOT NULL, athlete_name_norm TEXT NOT NULL,
        player_id BIGINT, result_date DATE NOT NULL, exercise TEXT NOT NULL, sprint_number INTEGER NOT NULL,
        total_time_seconds DOUBLE PRECISION NOT NULL, in_beam_start BOOLEAN NOT NULL DEFAULT FALSE,
        trigger_start BOOLEAN NOT NULL DEFAULT FALSE, split_number INTEGER NOT NULL,
        split_time_seconds DOUBLE PRECISION NOT NULL, distance_yards DOUBLE PRECISION, speed_mph DOUBLE PRECISION,
        note TEXT NOT NULL DEFAULT '', source_upload_id BIGINT REFERENCES ovr_sprint_uploads(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, school_code, result_key)
      );
      CREATE INDEX IF NOT EXISTS ovr_sprint_results_scope_date_idx
        ON ovr_sprint_results (organization_id, school_code, result_date DESC);
      CREATE INDEX IF NOT EXISTS ovr_sprint_results_player_date_idx
        ON ovr_sprint_results (organization_id, school_code, player_id, result_date DESC);
    `);
  })().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

export async function analyzeOvrSprintExport(fileName: string, bytes: Uint8Array): Promise<OvrSprintImportPreview> {
  return (await parseOvrSprint(fileName, bytes)).preview;
}

export async function importOvrSprintExport(input: {
  organizationId: number; schoolCode: string; uploadedByUserId: number | null; fileName: string; bytes: Uint8Array;
}): Promise<{ upload: OvrSprintUpload; duplicateFile: boolean }> {
  await ensureSchema();
  const parsed = await parseOvrSprint(input.fileName, input.bytes);
  const fileHash = createHash('sha256').update(input.bytes).digest('hex');
  const schoolCode = clean(input.schoolCode).toUpperCase();
  const pool = getDbPool();
  const existing = await pool.query('SELECT id FROM ovr_sprint_uploads WHERE organization_id=$1 AND school_code=$2 AND file_hash=$3', [input.organizationId, schoolCode, fileHash]);
  if (existing.rows[0]) {
    const uploads = await listOvrSprintUploads(input.organizationId, schoolCode);
    const upload = uploads.find((entry) => entry.id === Number(existing.rows[0].id));
    if (!upload) throw new Error('The existing import could not be loaded.');
    return { upload, duplicateFile: true };
  }

  const roster = await pool.query<{ id: string; full_name: string }>('SELECT id, full_name FROM players WHERE organization_id=$1', [input.organizationId]);
  const rosterByName = new Map(roster.rows.map((player) => [normalizeOvrAthleteName(player.full_name), Number(player.id)]));
  const unmatched = [...new Set(parsed.rows.filter((row) => !rosterByName.has(row.athleteNameNorm)).map((row) => row.athleteName))].sort();
  const matchedRows = parsed.rows.filter((row) => rosterByName.has(row.athleteNameNorm)).length;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uploadResult = await client.query<{ id: string }>(`
      INSERT INTO ovr_sprint_uploads
        (organization_id, school_code, file_name, file_hash, row_count, matched_rows, unmatched_rows, unmatched_athletes, min_date, max_date, uploaded_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11) RETURNING id
    `, [input.organizationId, schoolCode, input.fileName.slice(0, 180), fileHash, parsed.rows.length, matchedRows, parsed.rows.length - matchedRows, JSON.stringify(unmatched), parsed.preview.minDate, parsed.preview.maxDate, input.uploadedByUserId]);
    const uploadId = Number(uploadResult.rows[0].id);
    let insertedRows = 0;
    for (const row of parsed.rows) {
      const inserted = await client.query(`
        INSERT INTO ovr_sprint_results
          (organization_id, school_code, result_key, athlete_name, athlete_name_norm, player_id, result_date, exercise,
           sprint_number, total_time_seconds, in_beam_start, trigger_start, split_number, split_time_seconds,
           distance_yards, speed_mph, note, source_upload_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (organization_id, school_code, result_key) DO UPDATE SET
          player_id=COALESCE(EXCLUDED.player_id,ovr_sprint_results.player_id), note=EXCLUDED.note, updated_at=NOW()
        RETURNING (xmax = 0) AS inserted
      `, [input.organizationId, schoolCode, row.resultKey, row.athleteName, row.athleteNameNorm, rosterByName.get(row.athleteNameNorm) ?? null,
        row.date, row.exercise, row.sprintNumber, row.totalTime, row.inBeamStart, row.triggerStart, row.splitNumber,
        row.splitTime, row.distanceYards, row.speedMph, row.note, uploadId]);
      if (inserted.rows[0]?.inserted) insertedRows += 1;
    }
    await client.query('UPDATE ovr_sprint_uploads SET inserted_rows=$1 WHERE id=$2', [insertedRows, uploadId]);
    await client.query('COMMIT');
    const upload = (await listOvrSprintUploads(input.organizationId, schoolCode)).find((entry) => entry.id === uploadId);
    if (!upload) throw new Error('The completed import could not be loaded.');
    return { upload, duplicateFile: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listOvrSprintResults(input: {
  organizationId: number; schoolCode: string; playerId?: number | null;
}): Promise<OvrSprintResult[]> {
  await ensureSchema();
  const params: unknown[] = [input.organizationId, clean(input.schoolCode).toUpperCase()];
  const playerFilter = input.playerId ? `AND r.player_id=$${params.push(input.playerId)}` : 'AND r.player_id IS NOT NULL';
  const result = await getDbPool().query(`
    SELECT r.id, r.player_id, COALESCE(p.full_name,r.athlete_name) AS athlete_name, r.result_date::text,
      r.exercise, r.sprint_number, r.total_time_seconds, r.in_beam_start, r.trigger_start,
      r.split_number, r.split_time_seconds, r.distance_yards, r.speed_mph, r.note
    FROM ovr_sprint_results r LEFT JOIN players p ON p.id=r.player_id AND p.organization_id=r.organization_id
    WHERE r.organization_id=$1 AND r.school_code=$2 ${playerFilter}
    ORDER BY r.result_date DESC, athlete_name, r.exercise, r.sprint_number, r.split_number
  `, params);
  return result.rows.map((row) => ({
    id: Number(row.id), playerId: row.player_id === null ? null : Number(row.player_id), athleteName: row.athlete_name,
    date: row.result_date, exercise: row.exercise, sprintNumber: Number(row.sprint_number), totalTime: Number(row.total_time_seconds),
    inBeamStart: Boolean(row.in_beam_start), triggerStart: Boolean(row.trigger_start), splitNumber: Number(row.split_number),
    splitTime: Number(row.split_time_seconds), distanceYards: row.distance_yards === null ? null : Number(row.distance_yards),
    speedMph: row.speed_mph === null ? null : Number(row.speed_mph), note: row.note ?? '',
  }));
}

export async function listOvrSprintUploads(organizationId: number, schoolCodeValue: string): Promise<OvrSprintUpload[]> {
  await ensureSchema();
  const result = await getDbPool().query(`
    SELECT id,file_name,row_count,inserted_rows,matched_rows,unmatched_rows,unmatched_athletes,
      min_date::text,max_date::text,created_at::text
    FROM ovr_sprint_uploads WHERE organization_id=$1 AND school_code=$2 ORDER BY created_at DESC LIMIT 30
  `, [organizationId, clean(schoolCodeValue).toUpperCase()]);
  return result.rows.map((row) => ({
    id: Number(row.id), fileName: row.file_name, rowCount: Number(row.row_count), insertedRows: Number(row.inserted_rows),
    matchedRows: Number(row.matched_rows), unmatchedRows: Number(row.unmatched_rows),
    unmatchedAthletes: Array.isArray(row.unmatched_athletes) ? row.unmatched_athletes.map(String) : [],
    minDate: row.min_date ?? null, maxDate: row.max_date ?? null, createdAt: row.created_at,
  }));
}

export type OvrSprintGroup = { id: number; name: string };

export type OvrSprintPercentileStat = { value: number | null; percentile: number | null; sampleSize: number };
export type OvrSprintPercentileResult = {
  groupLabel: string;
  stats: {
    latest: OvrSprintPercentileStat;
    previous: OvrSprintPercentileStat;
    change: OvrSprintPercentileStat;
    average: OvrSprintPercentileStat;
    peak: OvrSprintPercentileStat;
  };
};

/** Tie-aware rank percentile, ported from the Force Plate percentile route
 * (app/api/player/force-plate-percentiles/route.ts). When `invert` is true,
 * ranks by -value instead of value, so a lower-is-better metric (e.g. sprint
 * time) still reports a higher percentile for better performance -- matching
 * how a coach reads "90th percentile" as "one of the best," not "one of the
 * highest raw values." */
export function ovrPercentile(value: number | null, population: Array<number | null>, invert: boolean): { percentile: number | null; sampleSize: number } {
  const sign = invert ? -1 : 1;
  const values = population.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)).map((entry) => entry * sign);
  const target = value !== null && Number.isFinite(value) ? value * sign : null;
  if (target === null || !values.length) return { percentile: null, sampleSize: values.length };
  if (values.length === 1) return { percentile: 100, sampleSize: 1 };
  let lower = 0;
  let equal = 0;
  for (const entry of values) {
    if (entry < target) lower += 1;
    else if (Math.abs(entry - target) < 1e-9) equal += 1;
  }
  return { percentile: Math.round(((lower + Math.max(0, equal - 1) / 2) / (values.length - 1)) * 100), sampleSize: values.length };
}

/** Groups available for percentile comparison: this app's own player_groups,
 * filtered to those with at least one member who has a matched OVR Sprint
 * result in this school (mirrors how the Force Plate route filters VALD
 * groups down to ones with overlapping roster members). */
export async function listOvrSprintGroups(input: { organizationId: number; schoolCode: string }): Promise<OvrSprintGroup[]> {
  await ensureSchema();
  const schoolCode = clean(input.schoolCode).toUpperCase();
  const result = await getDbPool().query<{ id: number; name: string }>(`
    SELECT DISTINCT g.id, g.name
    FROM player_groups g
    JOIN player_group_members m ON m.group_id = g.id
    JOIN ovr_sprint_results r ON r.player_id = m.player_id AND r.organization_id = g.organization_id AND r.school_code = $2
    WHERE g.organization_id = $1
    ORDER BY g.name ASC
  `, [input.organizationId, schoolCode]);
  return result.rows.map((row) => ({ id: Number(row.id), name: row.name }));
}

type PlayerSummary = { latest: number | null; previous: number | null; change: number | null; average: number | null; peak: number | null };

/** Same reduction as Force Plate's summarize() (app/api/player/force-plate-percentiles/route.ts):
 * latest/previous/change come from chronological order (ties broken by sprint number),
 * average and peak (best -- min for time, max for speed) are computed over every
 * qualifying row in range. */
function summarizePlayer(rows: Array<{ date: string; sprintNumber: number; value: number }>, lowerIsBetter: boolean): PlayerSummary {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.sprintNumber - b.sprintNumber);
  const latestRow = sorted.at(-1) ?? null;
  const previousRow = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  const values = sorted.map((row) => row.value);
  return {
    latest: latestRow?.value ?? null,
    previous: previousRow?.value ?? null,
    change: latestRow && previousRow ? latestRow.value - previousRow.value : null,
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    peak: values.length ? (lowerIsBetter ? Math.min(...values) : Math.max(...values)) : null,
  };
}

/**
 * Percentile rank of a player's Latest/Previous/Change/Average/Peak stats
 * against a cohort, for one or more exercises and one metric (total time or
 * speed) -- mirrors Force Plate's percentile route exactly (same five-stat
 * Summary shape, same per-stat percentile against the cohort's distribution
 * of that same stat). One result per exercise is returned, keyed by exercise
 * name, from a single query covering every cohort player's raw rows.
 */
export async function getOvrSprintPercentile(input: {
  organizationId: number;
  schoolCode: string;
  playerId: number;
  exercises: string[];
  metric: 'totalTime' | 'speedMph';
  groupId: number | 'all';
  startDate?: string | null;
  endDate?: string | null;
}): Promise<Map<string, OvrSprintPercentileResult>> {
  await ensureSchema();
  const schoolCode = clean(input.schoolCode).toUpperCase();
  const invert = input.metric === 'totalTime';
  const valueColumn = input.metric === 'totalTime' ? 'total_time_seconds' : 'speed_mph';

  const exercises = Array.from(new Set(input.exercises.map((entry) => clean(entry)).filter(Boolean)));
  if (!exercises.length) return new Map();

  const params: unknown[] = [input.organizationId, schoolCode, exercises];
  let cohortJoin = '';
  if (input.groupId !== 'all') {
    params.push(input.groupId);
    cohortJoin = `JOIN player_group_members gm ON gm.player_id = r.player_id AND gm.group_id = $${params.length}`;
  }
  let dateFilter = '';
  if (input.startDate) {
    params.push(input.startDate);
    dateFilter += ` AND r.result_date >= $${params.length}::date`;
  }
  if (input.endDate) {
    params.push(input.endDate);
    dateFilter += ` AND r.result_date <= $${params.length}::date`;
  }

  const result = await getDbPool().query<{ exercise: string; player_id: number; result_date: string; sprint_number: number; value: number | null }>(`
    SELECT r.exercise, r.player_id, r.result_date::text AS result_date, r.sprint_number, r.${valueColumn} AS value
    FROM ovr_sprint_results r
    ${cohortJoin}
    WHERE r.organization_id = $1 AND r.school_code = $2 AND r.exercise = ANY($3)
      AND r.player_id IS NOT NULL AND r.${valueColumn} IS NOT NULL${dateFilter}
  `, params);

  const byExercise = new Map<string, Map<number, Array<{ date: string; sprintNumber: number; value: number }>>>();
  for (const row of result.rows) {
    const byPlayer = byExercise.get(row.exercise) ?? new Map<number, Array<{ date: string; sprintNumber: number; value: number }>>();
    const playerId = Number(row.player_id);
    const rows = byPlayer.get(playerId) ?? [];
    rows.push({ date: row.result_date, sprintNumber: Number(row.sprint_number), value: Number(row.value) });
    byPlayer.set(playerId, rows);
    byExercise.set(row.exercise, byPlayer);
  }

  let groupLabel = 'All PCU athletes';
  if (input.groupId !== 'all') {
    const groupRow = await getDbPool().query<{ name: string }>(`SELECT name FROM player_groups WHERE id=$1 AND organization_id=$2`, [input.groupId, input.organizationId]);
    groupLabel = groupRow.rows[0]?.name ?? 'Group';
  }

  const output = new Map<string, OvrSprintPercentileResult>();
  for (const exercise of exercises) {
    const byPlayer = byExercise.get(exercise) ?? new Map<number, Array<{ date: string; sprintNumber: number; value: number }>>();
    const summaries = new Map<number, PlayerSummary>();
    for (const [playerId, rows] of byPlayer) summaries.set(playerId, summarizePlayer(rows, invert));
    const targetSummary = summaries.get(input.playerId) ?? { latest: null, previous: null, change: null, average: null, peak: null };
    const population = Array.from(summaries.values());
    const statOf = (key: keyof PlayerSummary): OvrSprintPercentileStat => {
      const { percentile, sampleSize } = ovrPercentile(targetSummary[key], population.map((entry) => entry[key]), invert);
      return { value: targetSummary[key], percentile, sampleSize };
    };
    output.set(exercise, {
      groupLabel,
      stats: { latest: statOf('latest'), previous: statOf('previous'), change: statOf('change'), average: statOf('average'), peak: statOf('peak') },
    });
  }
  return output;
}

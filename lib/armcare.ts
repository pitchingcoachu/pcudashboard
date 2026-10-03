import { createHash } from 'node:crypto';
import { getDbPool, isDatabaseConfigured } from './auth-db';
import { armCareMetricValueForMode, isArmCareForceMetric } from './armcare-display';

export const ARMCARE_DEFAULT_START_DATE = '2026-05-01';
const ARMCARE_TOKEN_URL = 'https://server.armcare.com/token';
const ARMCARE_EXAMS_URL = 'https://newserver.armcare.com/v1/third-party/exams-info';

type ArmCareSourceRow = Record<string, unknown>;

type ArmCareTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

export type ArmCareMetricValue = string | number | boolean | null;

export type ArmCareExam = {
  examId: string;
  playerId: number | null;
  playerName: string;
  armCareId: string | null;
  examDate: string;
  examTime: string | null;
  timezone: string | null;
  examType: string;
  bodyWeightLb: number | null;
  metrics: Record<string, ArmCareMetricValue>;
};

export type ArmCarePercentileStat = {
  percentile: number | null;
  sampleSize: number;
};

export type ArmCarePercentilesByExam = Record<string, Record<string, ArmCarePercentileStat>>;

export type ArmCareSyncResult = {
  received: number;
  eligible: number;
  imported: number;
  matched: number;
  unmatched: number;
  cutoffDate: string;
  syncedAt: string;
};

const IDENTITY_FIELDS = new Set([
  'Exam Date', 'Email', 'ArmCare ID', 'Last Name', 'First Name', 'Gender', 'DOB',
  'Height (ft)', 'Height (in)', 'Weight (lbs)', 'Country', 'State/Prov', 'Position 1',
  'Position 2', 'Position 3', 'Position 4', 'Position 5', 'Playing Level', 'Throws',
  'Bats', 'Surgery', 'Time', 'Timezone', 'Exam Type', 'isHide', 'Exam ID',
]);

let schemaPromise: Promise<void> | null = null;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeArmCarePlayerName(value: string): string {
  const trimmed = value.trim();
  const commaParts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  const firstLast = commaParts.length >= 2
    ? `${commaParts.slice(1).join(' ')} ${commaParts[0]}`
    : trimmed;
  return firstLast.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeEmail(value: unknown): string {
  return text(value).toLowerCase();
}

function parseExamDate(value: unknown): string | null {
  const raw = text(value);
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = Number(us[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) return raw;
  return null;
}

function normalizeMetric(value: unknown): ArmCareMetricValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes'].includes(text(value).toLowerCase());
}

function metricsFromRow(row: ArmCareSourceRow): Record<string, ArmCareMetricValue> {
  const metrics: Record<string, ArmCareMetricValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!IDENTITY_FIELDS.has(key)) metrics[key] = normalizeMetric(value);
  }
  return metrics;
}

function fallbackExamId(row: ArmCareSourceRow, examDate: string): string {
  const seed = [row.Email, row['First Name'], row['Last Name'], examDate, row.Time, row['Exam Type']].map(text).join('|');
  return `fallback-${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

function configuredStartDate(): string {
  const value = text(process.env.ARMCARE_SYNC_START_DATE) || ARMCARE_DEFAULT_START_DATE;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error('ARMCARE_SYNC_START_DATE must use YYYY-MM-DD format.');
  }
  return value;
}

async function ensureArmCareSchemaImpl(): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS armcare_exams (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      exam_id TEXT NOT NULL,
      player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
      armcare_id TEXT,
      player_email TEXT,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      player_name TEXT NOT NULL,
      player_name_norm TEXT NOT NULL,
      exam_date DATE NOT NULL,
      exam_time TEXT,
      timezone TEXT,
      exam_type TEXT NOT NULL DEFAULT '',
      is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
      metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, school_code, exam_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_armcare_exams_scope_date ON armcare_exams (organization_id, school_code, exam_date DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_armcare_exams_player_date ON armcare_exams (organization_id, player_id, exam_date DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_armcare_exams_name_date ON armcare_exams (organization_id, school_code, player_name_norm, exam_date DESC);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS armcare_sync_runs (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      status TEXT NOT NULL,
      cutoff_date DATE NOT NULL,
      received_count INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      matched_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_armcare_sync_runs_scope_created ON armcare_sync_runs (organization_id, school_code, created_at DESC);`);
}

export async function ensureArmCareSchema(): Promise<void> {
  if (!schemaPromise) schemaPromise = ensureArmCareSchemaImpl().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  await schemaPromise;
}

async function fetchArmCareRows(): Promise<ArmCareSourceRow[]> {
  const username = text(process.env.ARMCARE_API_USERNAME);
  const password = text(process.env.ARMCARE_API_PASSWORD);
  if (!username || !password) throw new Error('ArmCare API credentials are not configured.');

  const tokenResponse = await fetch(ARMCARE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'password', username, password }),
    cache: 'no-store',
  });
  if (!tokenResponse.ok) throw new Error(`ArmCare authentication failed (${tokenResponse.status}).`);
  const token = await tokenResponse.json() as ArmCareTokenResponse;
  if (!text(token.access_token)) throw new Error('ArmCare authentication returned no access token.');

  const examsResponse = await fetch(ARMCARE_EXAMS_URL, {
    headers: { authorization: `Bearer ${token.access_token}` },
    cache: 'no-store',
  });
  if (!examsResponse.ok) throw new Error(`ArmCare exam retrieval failed (${examsResponse.status}).`);
  const payload = await examsResponse.json() as { playerExamsInfo?: unknown };
  return Array.isArray(payload.playerExamsInfo) ? payload.playerExamsInfo as ArmCareSourceRow[] : [];
}

export async function syncArmCareExams(args: { organizationId: number; schoolCode?: string }): Promise<ArmCareSyncResult> {
  await ensureArmCareSchema();
  const organizationId = Number(args.organizationId);
  if (!Number.isFinite(organizationId) || organizationId <= 0) throw new Error('A valid organization is required for ArmCare sync.');
  const schoolCode = text(args.schoolCode || 'PCU').toUpperCase();
  const cutoffDate = configuredStartDate();
  const rows = await fetchArmCareRows();
  const eligible = rows.flatMap((row) => {
    const examDate = parseExamDate(row['Exam Date']);
    if (!examDate || examDate < cutoffDate) return [];
    return [{ row, examDate }];
  });

  const pool = getDbPool();
  const players = await pool.query<{ id: number; full_name: string; email: string | null }>(
    `SELECT id, full_name, email FROM players WHERE organization_id = $1`,
    [organizationId]
  );
  const byEmail = new Map(players.rows
    .filter((player) => normalizeEmail(player.email))
    .map((player) => [normalizeEmail(player.email), { id: Number(player.id), fullName: player.full_name }]));
  const byName = new Map(players.rows
    .map((player) => [normalizeArmCarePlayerName(player.full_name), { id: Number(player.id), fullName: player.full_name }]));
  const client = await pool.connect();
  let imported = 0;
  let matched = 0;

  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM armcare_exams WHERE organization_id = $1 AND school_code = $2 AND exam_date < $3::date`,
      [organizationId, schoolCode, cutoffDate]
    );
    for (const { row, examDate } of eligible) {
      const firstName = text(row['First Name']);
      const lastName = text(row['Last Name']);
      const armCarePlayerName = `${firstName} ${lastName}`.trim();
      const armCarePlayerNameNorm = normalizeArmCarePlayerName(armCarePlayerName);
      const email = normalizeEmail(row.Email);
      const playerMatch = byEmail.get(email) ?? byName.get(armCarePlayerNameNorm) ?? null;
      const playerId = playerMatch?.id ?? null;
      const playerName = playerMatch?.fullName ?? armCarePlayerName;
      const playerNameNorm = normalizeArmCarePlayerName(playerName);
      if (playerId) matched += 1;
      const examId = text(row['Exam ID']) || fallbackExamId(row, examDate);
      await client.query(
        `
          INSERT INTO armcare_exams (
            organization_id, school_code, exam_id, player_id, armcare_id, player_email,
            first_name, last_name, player_name, player_name_norm, exam_date, exam_time,
            timezone, exam_type, is_hidden, metrics_json, raw_json, synced_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,$13,$14,$15,$16::jsonb,$17::jsonb,NOW())
          ON CONFLICT (organization_id, school_code, exam_id) DO UPDATE SET
            player_id = EXCLUDED.player_id,
            armcare_id = EXCLUDED.armcare_id,
            player_email = EXCLUDED.player_email,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            player_name = EXCLUDED.player_name,
            player_name_norm = EXCLUDED.player_name_norm,
            exam_date = EXCLUDED.exam_date,
            exam_time = EXCLUDED.exam_time,
            timezone = EXCLUDED.timezone,
            exam_type = EXCLUDED.exam_type,
            is_hidden = EXCLUDED.is_hidden,
            metrics_json = EXCLUDED.metrics_json,
            raw_json = EXCLUDED.raw_json,
            synced_at = NOW()
        `,
        [
          organizationId, schoolCode, examId, playerId, text(row['ArmCare ID']) || null, email || null,
          firstName, lastName, playerName, playerNameNorm, examDate, text(row.Time) || null,
          text(row.Timezone) || null, text(row['Exam Type']), booleanValue(row.isHide),
          JSON.stringify(metricsFromRow(row)), JSON.stringify(row),
        ]
      );
      imported += 1;
    }
    await client.query(
      `INSERT INTO armcare_sync_runs (organization_id, school_code, status, cutoff_date, received_count, imported_count, matched_count)
       VALUES ($1,$2,'completed',$3::date,$4,$5,$6)`,
      [organizationId, schoolCode, cutoffDate, rows.length, imported, matched]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await pool.query(
      `INSERT INTO armcare_sync_runs (organization_id, school_code, status, cutoff_date, received_count, imported_count, matched_count, error_message)
       VALUES ($1,$2,'failed',$3::date,$4,$5,$6,$7)`,
      [organizationId, schoolCode, cutoffDate, rows.length, imported, matched, error instanceof Error ? error.message : 'Unknown sync error']
    ).catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return {
    received: rows.length,
    eligible: eligible.length,
    imported,
    matched,
    unmatched: Math.max(0, imported - matched),
    cutoffDate,
    syncedAt: new Date().toISOString(),
  };
}

function valdBodyWeightLbs(metricName: string, metricUnit: string, value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const name = text(metricName).toLowerCase();
  const unit = text(metricUnit).toLowerCase();
  if (['kg', 'kilo', 'kilogram', 'kilograms'].includes(unit) || name.includes('kilogram')) return value * 2.20462262185;
  if (['lb', 'lbs', 'pound', 'pounds'].includes(unit) || name.includes('pound')) return value < 130 ? value * 2.20462262185 : value;
  return value < 130 ? value * 2.20462262185 : value;
}

async function valdBodyWeightsForExams(args: {
  organizationId: number;
  schoolCode: string;
  playerNames: string[];
}): Promise<Map<string, Array<{ date: string; weightLb: number }>>> {
  const requestedNames = new Set(args.playerNames.map(normalizeArmCarePlayerName).filter(Boolean));
  if (!requestedNames.size) return new Map();
  const pool = getDbPool();
  const result = await pool.query<{
    player_name: string;
    weight_date: string;
    metric_name: string;
    metric_unit: string;
    value: number;
  }>(
    `SELECT player_name,
            COALESCE(date_time_utc::date::text, NULLIF(TRIM(date_short), '')) AS weight_date,
            metric_name, metric_unit, value
     FROM force_plate_metric_rows
     WHERE organization_id = $1
       AND UPPER(TRIM(school_code)) = $2
       AND value > 0
       AND point_type = 'average'
       AND REGEXP_REPLACE(LOWER(metric_name), '[^a-z0-9]+', '', 'g') IN ('bodyweight', 'bodyweightinpounds', 'bodyweightinkilograms', 'athleteweight')
     ORDER BY player_name_norm, COALESCE(date_time_utc::date::text, NULLIF(TRIM(date_short), '')) ASC`,
    [args.organizationId, args.schoolCode],
  ).catch((error: unknown) => {
    // ArmCare remains usable before the optional VALD cache table is created;
    // BW% values simply stay unavailable until a force-plate sync populates it.
    if ((error as { code?: string })?.code === '42P01') return { rows: [] };
    throw error;
  });
  const byPlayerDate = new Map<string, Map<string, number>>();
  for (const row of result.rows) {
    const playerKey = normalizeArmCarePlayerName(row.player_name);
    const date = text(row.weight_date).slice(0, 10);
    if (!requestedNames.has(playerKey) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const weightLb = valdBodyWeightLbs(row.metric_name, row.metric_unit, Number(row.value));
    if (weightLb === null) continue;
    const weightsByDate = byPlayerDate.get(playerKey) ?? new Map<string, number>();
    const current = weightsByDate.get(date);
    if (current === undefined || weightLb > current) weightsByDate.set(date, weightLb);
    byPlayerDate.set(playerKey, weightsByDate);
  }
  return new Map(Array.from(byPlayerDate.entries()).map(([playerKey, weightsByDate]) => [
    playerKey,
    Array.from(weightsByDate.entries()).map(([date, weightLb]) => ({ date, weightLb })).sort((a, b) => a.date.localeCompare(b.date)),
  ]));
}

function bodyWeightForExam(
  weights: Array<{ date: string; weightLb: number }> | undefined,
  examDate: string,
): number | null {
  if (!weights?.length) return null;
  let latestPrior: number | null = null;
  for (const entry of weights) {
    if (entry.date <= examDate) latestPrior = entry.weightLb;
    else return latestPrior ?? entry.weightLb;
  }
  return latestPrior;
}

export async function listArmCareExams(args: {
  organizationId: number;
  schoolCode?: string;
  playerId?: number | null;
  playerName?: string;
}): Promise<{ exams: ArmCareExam[]; lastSyncedAt: string | null }> {
  await ensureArmCareSchema();
  const schoolCode = text(args.schoolCode || 'PCU').toUpperCase();
  const values: unknown[] = [args.organizationId, schoolCode];
  const clauses = ['organization_id = $1', 'school_code = $2', 'is_hidden = FALSE'];
  if (Number(args.playerId) > 0) {
    values.push(Number(args.playerId));
    clauses.push(`player_id = $${values.length}`);
  } else if (text(args.playerName)) {
    values.push(normalizeArmCarePlayerName(text(args.playerName)));
    clauses.push(`player_name_norm = $${values.length}`);
  }
  const pool = getDbPool();
  const [examResult, syncResult] = await Promise.all([
    pool.query<{
      exam_id: string; player_id: number | null; player_name: string; armcare_id: string | null;
      exam_date: string; exam_time: string | null; timezone: string | null; exam_type: string;
      metrics_json: Record<string, ArmCareMetricValue>;
    }>(
      `SELECT exam_id, player_id, player_name, armcare_id, exam_date::text, exam_time, timezone, exam_type, metrics_json
       FROM armcare_exams WHERE ${clauses.join(' AND ')} ORDER BY exam_date DESC, exam_time DESC NULLS LAST, exam_id DESC`,
      values
    ),
    pool.query<{ created_at: string }>(
      `SELECT created_at::text FROM armcare_sync_runs
       WHERE organization_id = $1 AND school_code = $2 AND status = 'completed'
       ORDER BY created_at DESC LIMIT 1`,
      [args.organizationId, schoolCode]
    ),
  ]);
  const bodyWeights = await valdBodyWeightsForExams({
    organizationId: args.organizationId,
    schoolCode,
    playerNames: examResult.rows.map((row) => row.player_name),
  });
  return {
    exams: examResult.rows.map((row) => ({
      examId: row.exam_id,
      playerId: row.player_id == null ? null : Number(row.player_id),
      playerName: row.player_name,
      armCareId: row.armcare_id,
      examDate: row.exam_date,
      examTime: row.exam_time,
      timezone: row.timezone,
      examType: row.exam_type,
      bodyWeightLb: bodyWeightForExam(bodyWeights.get(normalizeArmCarePlayerName(row.player_name)), row.exam_date),
      metrics: row.metrics_json ?? {},
    })),
    lastSyncedAt: syncResult.rows[0]?.created_at ?? null,
  };
}

function numericValue(value: ArmCareMetricValue): number | null {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function armCareExamsAsBodyWeightPercent(exams: ArmCareExam[]): ArmCareExam[] {
  return exams.map((exam) => ({
    ...exam,
    metrics: Object.fromEntries(Object.entries(exam.metrics).map(([metric, value]) => [
      metric,
      isArmCareForceMetric(metric)
        ? armCareMetricValueForMode(metric, value, exam.bodyWeightLb, 'bw')
        : value,
    ])),
  }));
}

function percentileRank(value: number, population: number[]): number | null {
  if (!population.length) return null;
  if (population.length === 1) return 100;
  let lower = 0;
  let equal = 0;
  for (const entry of population) {
    if (entry < value) lower += 1;
    else if (Math.abs(entry - value) < 1e-9) equal += 1;
  }
  return Math.round(((lower + Math.max(0, equal - 1) / 2) / (population.length - 1)) * 100);
}

export function calculateArmCarePercentiles(
  targetExams: ArmCareExam[],
  populationExams: ArmCareExam[],
  options: {
    cohortPlayerNames?: string[];
    comparisonStartDate?: string;
    comparisonEndDate?: string;
  } = {}
): ArmCarePercentilesByExam {
  const cohortNames = options.cohortPlayerNames === undefined
    ? null
    : new Set(options.cohortPlayerNames.map(normalizeArmCarePlayerName));
  const eligiblePopulation = populationExams.filter((exam) => {
    if (options.comparisonStartDate && exam.examDate < options.comparisonStartDate) return false;
    if (options.comparisonEndDate && exam.examDate > options.comparisonEndDate) return false;
    return !cohortNames || cohortNames.has(normalizeArmCarePlayerName(exam.playerName));
  });
  const populationCache = new Map<string, number[]>();
  const populationFor = (examType: string, metric: string): number[] => {
    const cacheKey = `${examType}\u0000${metric}`;
    const cached = populationCache.get(cacheKey);
    if (cached) return cached;
    const latestByPlayer = new Map<string, number>();
    for (const exam of eligiblePopulation) {
      if (exam.examType !== examType || latestByPlayer.has(exam.playerName)) continue;
      const value = numericValue(exam.metrics[metric] ?? null);
      if (value !== null) latestByPlayer.set(exam.playerName, value);
    }
    const values = Array.from(latestByPlayer.values());
    populationCache.set(cacheKey, values);
    return values;
  };

  return Object.fromEntries(targetExams.map((exam) => {
    const stats = Object.fromEntries(Object.entries(exam.metrics).flatMap(([metric, rawValue]) => {
      const value = numericValue(rawValue);
      if (value === null) return [];
      const population = populationFor(exam.examType, metric);
      return [[metric, { percentile: percentileRank(value, population), sampleSize: population.length }]];
    }));
    return [exam.examId, stats];
  }));
}

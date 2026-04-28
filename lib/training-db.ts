import { createPasswordHash, ensureAuthDbReady, getDbPool, isDatabaseConfigured, verifyPasswordAgainstHash } from './auth-db';
const DEFAULT_DASHBOARD_URL = 'https://pitchingcoachu.shinyapps.io/TMdata/';

declare global {
  var __pcuTrainingDbReady: boolean | undefined;
  var __pcuTrainingDbReadyPromise: Promise<void> | undefined;
  var __pcuAuthUsersSequenceStructureReady: boolean | undefined;
  var __pcuTrainingTrackingTypeReady: boolean | undefined;
}

export type ClientRow = {
  playerId: number;
  userId: number | null;
  fullName: string;
  email: string;
  dateOfBirth: string | null;
  schoolTeam: string | null;
  phone: string | null;
  collegeCommitment: string | null;
  gradYear: string | null;
  position: string | null;
  batsHand: string | null;
  throwsHand: string | null;
  assignedCoachUserId: number | null;
  assignedCoachName: string | null;
  status: string;
  userRole: 'admin' | 'coach' | 'player' | null;
};

export type ClientListPage = {
  rows: ClientRow[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export type CoachAssignedPlayerRow = {
  playerId: number;
  fullName: string;
  email: string;
  status: string;
  assignedCoachUserId: number | null;
};

export type CoachRow = {
  userId: number;
  name: string;
  email: string;
  phone: string | null;
  role: 'admin' | 'coach';
  isActive: boolean;
  assignedPlayerCount: number;
};

export type PlayerChoiceRow = {
  playerId: number;
  fullName: string;
  assignedCoachUserId: number | null;
};

export type PlayerSummaryRow = {
  playerId: number;
  fullName: string;
  assignedCoachUserId: number | null;
  throwsHand: string | null;
  batsHand: string | null;
  position: string | null;
};

export type WorkoutChoiceRow = {
  id: number;
  name: string;
  category: string;
  exerciseCount: number;
};

export type PlayerProfileRow = {
  id: number;
  fullName: string;
  email: string;
  dateOfBirth: string | null;
  schoolTeam: string | null;
  phone: string | null;
  collegeCommitment: string | null;
  gradYear: string | null;
  position: string | null;
  batsHand: string | null;
  throwsHand: string | null;
  height: string | null;
  profileWeightLbs: number | null;
  profilePhotoDataUrl: string | null;
  assignedCoachUserId: number | null;
  assignedCoachName: string | null;
  age: number | null;
};

export type BodyWeightLogRow = {
  logDate: string;
  weightLbs: number;
  notes: string | null;
};

export type PlayerPlanGoalRow = {
  slotIndex: 1 | 2 | 3;
  category: string | null;
  goalDescription: string | null;
  createdAt: string | null;
};

export type CompletedPlayerPlanGoalRow = {
  id: number;
  slotIndex: 1 | 2 | 3;
  category: string;
  goalDescription: string;
  completionDetails: string | null;
  createdAt: string;
  completedAt: string;
};

export type PlayerPlanNoteRow = {
  id: number;
  playerId: number;
  domain: 'Pitching' | 'Hitting' | 'Catching' | 'General';
  noteDate: string;
  category: string;
  noteText: string;
  attachmentName: string | null;
  attachmentMimeType: string | null;
  attachmentDataUrl: string | null;
  createdAt: string;
  createdByUserId: number | null;
};

export type DashboardPlayerNoteRow = {
  id: number;
  organizationId: number;
  dashboardPlayerName: string;
  domain: 'Pitching' | 'Hitting' | 'Catching' | 'General';
  noteDate: string;
  category: string;
  noteText: string;
  attachmentName: string | null;
  attachmentMimeType: string | null;
  attachmentDataUrl: string | null;
  createdAt: string;
  createdByUserId: number | null;
};

export type TrackedExerciseRow = {
  exerciseId: number;
  name: string;
  category: string;
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight';
};

export type ExerciseCategoryRow = {
  id: number;
  name: string;
};

export type ExerciseRow = {
  id: number;
  name: string;
  category: string;
  repMeasure: 'reps' | 'seconds' | 'distance';
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight';
  repsPerSide: boolean;
  description: string | null;
  instructionVideoUrl: string | null;
  coachingCues: string | null;
};

export type WorkoutRow = {
  id: number;
  name: string;
  category: string;
  description: string | null;
  exerciseCount: number;
  exerciseNames: string[];
};

export type WorkoutEditorItem = {
  exerciseId: number;
  exerciseName: string;
  category: string;
  repMeasure: 'reps' | 'seconds' | 'distance';
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight';
  repsPerSide: boolean;
  sortOrder: number;
  prefix: string | null;
  prescribedSets: string | null;
  prescribedReps: string | null;
  notes: string | null;
};

export type WorkoutDetailRow = {
  id: number;
  name: string;
  category: string;
  description: string | null;
  items: WorkoutEditorItem[];
};

export type ScheduleTemplateItemRow = {
  id: number;
  workoutId: number;
  workoutName: string;
  workoutCategory: string | null;
  sortOrder: number;
  prescribedSets: string | null;
  prescribedReps: string | null;
  prescribedLoad: string | null;
  prescribedNotes: string | null;
};

export type ScheduleTemplateDayRow = {
  id: number;
  dayOffset: number;
  items: ScheduleTemplateItemRow[];
};

export type ScheduleTemplateRow = {
  id: number;
  name: string;
  totalDays: number;
  workoutCount: number;
  createdAt: string;
  updatedAt: string;
  days: ScheduleTemplateDayRow[];
};

export type WorkoutExerciseAssignment = {
  exerciseId: number | null;
  prefix: string | null;
  name: string;
  category: string;
  repMeasure: 'reps' | 'seconds' | 'distance';
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight';
  repsPerSide: boolean;
  prescribedSets: string | null;
  prescribedReps: string | null;
  instructionVideoUrl: string | null;
  description: string | null;
  coachingCues: string | null;
};

export type ProgramItemRow = {
  itemId: number;
  dayDate: string;
  scheduleType: 'calendar' | 'cycle';
  cycleSlot: 'medium' | 'high' | 'low' | 'mobility' | 's_and_c' | null;
  itemType: 'exercise' | 'workout';
  itemName: string;
  workoutDescription: string | null;
  exerciseId: number | null;
  workoutId: number | null;
  workoutCategory: string | null;
  exerciseCategory: string;
  instructionVideoUrl: string | null;
  workoutExerciseNames: string[];
  workoutExercises: WorkoutExerciseAssignment[];
  repMeasure: 'reps' | 'seconds' | 'distance';
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight';
  repsPerSide: boolean;
  exerciseDescription: string | null;
  exerciseCoachingCues: string | null;
  prescribedSets: string | null;
  prescribedReps: string | null;
  prescribedLoad: string | null;
  prescribedNotes: string | null;
  completed: boolean;
  performedSets: string | null;
  performedReps: string | null;
  performedLoad: string | null;
  logNotes: string | null;
  programName: string;
};

export type ExerciseLoadHistoryEntry = {
  dayDate: string;
  sourceName: string;
  loads: string[];
  prescribedReps: string | null;
  repMeasure: 'reps' | 'seconds' | 'distance';
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight';
  repsPerSide: boolean;
};

export type AssessmentWorkoutScoreRow = {
  dayDate: string;
  workoutName: string;
  exerciseScores: Array<{
    exerciseId: number | null;
    exerciseName: string;
    prefix: string | null;
    score: 1 | 2 | 3 | null;
    note: string | null;
  }>;
};

export type DashboardCustomTableRow = {
  id: number;
  name: string;
  columns: string[];
  createdAt: string;
  updatedAt: string;
};

export type OrganizationOptionRow = {
  organizationId: number;
  organizationName: string;
  schoolCode: string;
};

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
};

function isAuthUsersPrimaryKeyViolation(error: unknown): boolean {
  const typed = error as { code?: string; constraint?: string; message?: string } | null;
  const message = String(typed?.message ?? '').toLowerCase();
  return (
    typed?.code === '23505' &&
    (typed?.constraint === 'auth_users_pkey' ||
      message.includes('auth_users_pkey') ||
      (message.includes('duplicate key') && message.includes('auth_users')))
  );
}

async function ensureAuthUsersIdSequence(db: Queryable): Promise<void> {
  await ensureAuthUsersIdSequenceStructure(db);
  await syncAuthUsersIdSequence(db);
}

async function ensureAuthUsersIdSequenceStructure(db: Queryable): Promise<void> {
  if (global.__pcuAuthUsersSequenceStructureReady) return;
  await db.query(`CREATE SEQUENCE IF NOT EXISTS auth_users_id_seq;`);
  await db.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS id BIGINT;`);
  await db.query(`
    DO $$
    BEGIN
      IF pg_get_serial_sequence('auth_users', 'id') IS NULL THEN
        EXECUTE 'ALTER TABLE auth_users ALTER COLUMN id SET DEFAULT nextval(''auth_users_id_seq'')';
      END IF;
    END $$;
  `);
  await db.query(`UPDATE auth_users SET id = nextval('auth_users_id_seq') WHERE id IS NULL;`);
  global.__pcuAuthUsersSequenceStructureReady = true;
}

async function syncAuthUsersIdSequence(db: Queryable): Promise<void> {
  await db.query(`
    SELECT setval(
      COALESCE(pg_get_serial_sequence('auth_users', 'id'), 'auth_users_id_seq'),
      COALESCE((SELECT MAX(id) FROM auth_users), 0) + 1,
      false
    );
  `);
}

export async function ensureTrainingDbReady(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  if (global.__pcuTrainingDbReady) return;
  if (global.__pcuTrainingDbReadyPromise) {
    await global.__pcuTrainingDbReadyPromise;
    return;
  }

  global.__pcuTrainingDbReadyPromise = (async () => {
    await ensureAuthDbReady();
    const pool = getDbPool();
    await ensureAuthUsersIdSequence(pool);
    await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS phone TEXT;`);
    await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS height TEXT;`);
    await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS profile_weight_lbs DOUBLE PRECISION;`);
    await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS profile_photo_data_url TEXT;`);
    if (!global.__pcuTrainingTrackingTypeReady) {
      await pool.query(`ALTER TABLE exercise_library ADD COLUMN IF NOT EXISTS tracking_type TEXT NOT NULL DEFAULT 'lbs';`);
      await pool.query(`UPDATE exercise_library SET tracking_type = 'lbs' WHERE tracking_type IS NULL OR LENGTH(TRIM(tracking_type)) = 0;`);
      global.__pcuTrainingTrackingTypeReady = true;
    }
    await pool.query(
      `ALTER TABLE players ADD COLUMN IF NOT EXISTS assigned_coach_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL;`
    );
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_assigned_coach ON players (assigned_coach_user_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_org_full_name ON players (organization_id, full_name);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_org_assigned_full_name ON players (organization_id, assigned_coach_user_id, full_name);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_users_org_role_name ON auth_users (organization_id, role, name);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_exercise_library_org_name ON exercise_library (organization_id, name);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_workout_library_org_name ON workout_library (organization_id, name);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout_sort ON workout_exercises (workout_id, sort_order);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_programs_org ON programs (organization_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_days_program ON program_days (program_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_day_items_exercise ON program_day_items (exercise_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_day_items_workout ON program_day_items (workout_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_organizations_upper_trim_name ON organizations ((UPPER(TRIM(name))));`);
    await pool.query(`UPDATE auth_users SET is_active = TRUE WHERE is_active IS NULL;`);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_custom_tables (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      school_code TEXT NOT NULL,
      name TEXT NOT NULL,
      columns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_custom_tables_org_school_name ON dashboard_custom_tables (organization_id, school_code, lower(name));`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_dashboard_custom_tables_org_school_updated ON dashboard_custom_tables (organization_id, school_code, updated_at DESC);`
    );
    await pool.query(`
    CREATE TABLE IF NOT EXISTS player_plan_notes (
      id BIGSERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      note_date DATE NOT NULL,
      category TEXT NOT NULL,
      note_text TEXT NOT NULL,
      attachment_name TEXT,
      attachment_mime_type TEXT,
      attachment_data_url TEXT,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_player_plan_notes_player_date ON player_plan_notes (player_id, note_date DESC, created_at DESC);`);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_player_notes (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      dashboard_player_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      note_date DATE NOT NULL,
      category TEXT NOT NULL,
      note_text TEXT NOT NULL,
      attachment_name TEXT,
      attachment_mime_type TEXT,
      attachment_data_url TEXT,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_dashboard_player_notes_org_name_date ON dashboard_player_notes (organization_id, dashboard_player_name, note_date DESC, created_at DESC);`
    );
    await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_templates (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_template_days (
      id BIGSERIAL PRIMARY KEY,
      template_id BIGINT NOT NULL REFERENCES schedule_templates(id) ON DELETE CASCADE,
      day_offset INTEGER NOT NULL CHECK (day_offset >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (template_id, day_offset)
    );
  `);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_template_day_items (
      id BIGSERIAL PRIMARY KEY,
      template_day_id BIGINT NOT NULL REFERENCES schedule_template_days(id) ON DELETE CASCADE,
      workout_id INTEGER NOT NULL REFERENCES workout_library(id) ON DELETE CASCADE,
      prescribed_sets TEXT,
      prescribed_reps TEXT,
      prescribed_load TEXT,
      prescribed_notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_templates_org_name ON schedule_templates (organization_id, lower(name));`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_schedule_templates_org_updated ON schedule_templates (organization_id, updated_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_schedule_template_days_template_offset ON schedule_template_days (template_id, day_offset);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_schedule_template_day_items_day_sort ON schedule_template_day_items (template_day_id, sort_order);`);
    global.__pcuTrainingDbReady = true;
  })().finally(() => {
    global.__pcuTrainingDbReadyPromise = undefined;
  });

  await global.__pcuTrainingDbReadyPromise;
}

function validateHttpUrl(value: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: '' };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'URL must use http or https.' };
    }
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false, error: 'URL is not valid.' };
  }
}

function normalizeCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeTrackingType(value: string | null | undefined): 'lbs' | 'seconds' | 'inches' | 'body_weight' {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'seconds') return 'seconds';
  if (normalized === 'inches') return 'inches';
  if (normalized === 'body_weight' || normalized === 'body weight' || normalized === 'bodyweight') return 'body_weight';
  return 'lbs';
}

function normalizeCycleSlot(value: string): 'medium' | 'high' | 'low' | 'mobility' | 's_and_c' | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'medium' || normalized === 'high' || normalized === 'low' || normalized === 'mobility') return normalized;
  if (normalized === 's&c' || normalized === 's_and_c' || normalized === 's-c' || normalized === 'sc') return 's_and_c';
  return null;
}

function deriveUsernameFromEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseSetCount(value: string | null): number {
  if (!value) return 1;
  const match = value.match(/\d+/);
  if (!match) return 1;
  const count = Number(match[0]);
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(count, 12);
}

function parseLoadValues(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const ASSESSMENT_NOTES_TOKEN = '[ASSESSMENT_NOTES]';

function parseAssessmentNotesFromLog(value: string | null): string[] {
  const raw = String(value ?? '');
  const tokenIndex = raw.indexOf(ASSESSMENT_NOTES_TOKEN);
  if (tokenIndex === -1) return [];
  const payload = raw.slice(tokenIndex + ASSESSMENT_NOTES_TOKEN.length).trim();
  if (!payload) return [];
  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => String(entry ?? '').trim());
  } catch {
    return [];
  }
}

type TrainingReadCacheEntry = {
  expiresAt: number;
  value: unknown;
};

const TRAINING_READ_CACHE_KEY = '__pcu_training_read_cache_v1__';
const TRAINING_READ_INFLIGHT_KEY = '__pcu_training_read_inflight_v1__';
const TRAINING_READ_CACHE_MAX_ENTRIES = 800;

function _trainingReadCacheStore(): Map<string, TrainingReadCacheEntry> {
  const globalRef = globalThis as typeof globalThis & {
    [TRAINING_READ_CACHE_KEY]?: Map<string, TrainingReadCacheEntry>;
  };
  if (!globalRef[TRAINING_READ_CACHE_KEY]) {
    globalRef[TRAINING_READ_CACHE_KEY] = new Map<string, TrainingReadCacheEntry>();
  }
  return globalRef[TRAINING_READ_CACHE_KEY]!;
}

function _trainingReadInflightStore(): Map<string, Promise<unknown>> {
  const globalRef = globalThis as typeof globalThis & {
    [TRAINING_READ_INFLIGHT_KEY]?: Map<string, Promise<unknown>>;
  };
  if (!globalRef[TRAINING_READ_INFLIGHT_KEY]) {
    globalRef[TRAINING_READ_INFLIGHT_KEY] = new Map<string, Promise<unknown>>();
  }
  return globalRef[TRAINING_READ_INFLIGHT_KEY]!;
}

function _trainingClone<T>(value: T): T {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch {
    // Fallback below.
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function _trainingPruneExpired(now: number) {
  const cache = _trainingReadCacheStore();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

function _trainingPruneOldest() {
  const cache = _trainingReadCacheStore();
  if (cache.size <= TRAINING_READ_CACHE_MAX_ENTRIES) return;
  const ordered = Array.from(cache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const removeCount = Math.max(1, cache.size - TRAINING_READ_CACHE_MAX_ENTRIES);
  for (let idx = 0; idx < removeCount; idx += 1) {
    cache.delete(ordered[idx][0]);
  }
}

async function _withTrainingReadCache<T>(cacheKey: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const ttl = Math.max(250, ttlMs);
  _trainingPruneExpired(now);
  const cache = _trainingReadCacheStore();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return _trainingClone(cached.value as T);
  }
  const inflight = _trainingReadInflightStore();
  const existing = inflight.get(cacheKey);
  if (existing) {
    return _trainingClone((await existing) as T);
  }
  const run = (async () => {
    try {
      const value = await loader();
      cache.set(cacheKey, { expiresAt: Date.now() + ttl, value: _trainingClone(value) });
      _trainingPruneOldest();
      return value;
    } finally {
      inflight.delete(cacheKey);
    }
  })();
  inflight.set(cacheKey, run as Promise<unknown>);
  return _trainingClone((await run) as T);
}

function _invalidateTrainingReadCache(prefixes: string[]) {
  if (!prefixes.length) return;
  const cache = _trainingReadCacheStore();
  for (const key of Array.from(cache.keys())) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      cache.delete(key);
    }
  }
}

function _invalidateTrainingReadCacheForOrganization(organizationId: number) {
  const org = Number(organizationId);
  if (!Number.isFinite(org) || org <= 0) return;
  _invalidateTrainingReadCache([
    `player_choices:${org}:`,
    `player_summaries:${org}:`,
    `client_count:${org}:`,
    `client_status_counts:${org}:`,
    `clients_paged:${org}:`,
    `coaches_list:${org}`,
    `coach_assigned_players:${org}`,
    `exercise_count:${org}`,
    `workout_count:${org}`,
    `workout_choices:${org}`,
    `schedule_templates:${org}`,
  ]);
}

function _invalidateTrainingReadCacheForPlayer(playerId: number) {
  const pid = Number(playerId);
  if (!Number.isFinite(pid) || pid <= 0) return;
  _invalidateTrainingReadCache([
    `exercise_history:${pid}:`,
    `tracked_exercises:${pid}`,
  ]);
}

export async function listClientsByOrganization(organizationId: number): Promise<ClientRow[]> {
  const paged = await listClientsByOrganizationPaged({
    organizationId,
    page: 1,
    pageSize: 50000,
  });
  return paged.rows;
}

export async function listClientsByOrganizationPaged(input: {
  organizationId: number;
  page: number;
  pageSize: number;
  query?: string;
  coachUserId?: number | null;
  assignedCoachOnlyUserId?: number | null;
}): Promise<ClientListPage> {
  if (!isDatabaseConfigured()) return { rows: [], totalCount: 0, page: 1, pageSize: 100 };
  await ensureTrainingDbReady();
  const rawPage = Number(input.page);
  const rawPageSize = Number(input.pageSize);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 ? Math.min(Math.floor(rawPageSize), 50000) : 100;
  const offset = (page - 1) * pageSize;
  const query = String(input.query ?? '').trim();
  const coachUserId = Number(input.coachUserId ?? 0);
  const assignedCoachOnlyUserId = Number(input.assignedCoachOnlyUserId ?? 0);
  const cacheKey = `clients_paged:${input.organizationId}:${page}:${pageSize}:${query.toLowerCase()}:${Number.isFinite(coachUserId) ? coachUserId : 0}:${Number.isFinite(assignedCoachOnlyUserId) ? assignedCoachOnlyUserId : 0}`;

  return _withTrainingReadCache(cacheKey, 12_000, async () => {
    const pool = getDbPool();

    const filters: string[] = ['p.organization_id = $1'];
    const params: Array<number | string> = [input.organizationId];
    let nextParamIndex = 2;
    if (Number.isFinite(coachUserId) && coachUserId > 0) {
      filters.push(`p.assigned_coach_user_id = $${nextParamIndex}`);
      params.push(coachUserId);
      nextParamIndex += 1;
    }
    if (Number.isFinite(assignedCoachOnlyUserId) && assignedCoachOnlyUserId > 0) {
      filters.push(`p.assigned_coach_user_id = $${nextParamIndex}`);
      params.push(assignedCoachOnlyUserId);
      nextParamIndex += 1;
    }
    const hasQuery = query.length > 0;
    if (hasQuery) {
      filters.push(`(p.full_name ILIKE $${nextParamIndex} OR p.email ILIKE $${nextParamIndex} OR COALESCE(coach.name, '') ILIKE $${nextParamIndex})`);
      params.push(`%${query}%`);
      nextParamIndex += 1;
    }
    const whereSql = filters.join(' AND ');

    const countResult = await pool.query<{ total_count: string }>(
      `
        SELECT COUNT(*)::text AS total_count
        FROM players p
        ${hasQuery ? 'LEFT JOIN auth_users coach ON coach.id = p.assigned_coach_user_id' : ''}
        WHERE ${whereSql}
      `,
      params
    );
    const totalCount = Number(countResult.rows[0]?.total_count ?? '0') || 0;

    const result = await pool.query<{
      player_id: number;
      user_id: number | null;
      full_name: string;
      email: string;
      date_of_birth: string | null;
      school_team: string | null;
      phone: string | null;
      college_commitment: string | null;
      grad_year: string | null;
      position: string | null;
      bats_hand: string | null;
      throws_hand: string | null;
      assigned_coach_user_id: number | null;
      assigned_coach_name: string | null;
      status: string;
      user_role: string | null;
    }>(
      `
        SELECT
          p.id AS player_id,
          p.user_id,
          p.full_name,
          p.email,
          p.date_of_birth::text,
          p.school_team,
          p.phone,
          p.college_commitment,
          p.grad_year,
          p.position,
          p.bats_hand,
          p.throws_hand,
          p.assigned_coach_user_id,
          coach.name AS assigned_coach_name,
          p.status,
          u.role AS user_role
        FROM players p
        LEFT JOIN auth_users u ON u.id = p.user_id
        LEFT JOIN auth_users coach ON coach.id = p.assigned_coach_user_id
        WHERE ${whereSql}
        ORDER BY p.full_name ASC
        LIMIT $${nextParamIndex}
        OFFSET $${nextParamIndex + 1}
      `,
      [...params, pageSize, offset]
    );

    return {
      rows: result.rows.map((row) => ({
        playerId: row.player_id,
        userId: row.user_id,
        fullName: row.full_name,
        email: row.email,
        dateOfBirth: row.date_of_birth,
        schoolTeam: row.school_team,
        phone: row.phone,
        collegeCommitment: row.college_commitment,
        gradYear: row.grad_year,
        position: row.position,
        batsHand: row.bats_hand,
        throwsHand: row.throws_hand,
        assignedCoachUserId: row.assigned_coach_user_id,
        assignedCoachName: row.assigned_coach_name,
        status: row.status,
        userRole: row.user_role === 'admin' || row.user_role === 'coach' || row.user_role === 'player' ? row.user_role : null,
      })),
      totalCount,
      page,
      pageSize,
    };
  });
}

export async function listCoachesByOrganization(organizationId: number): Promise<CoachRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const cacheKey = `coaches_list:${organizationId}`;
  return _withTrainingReadCache(cacheKey, 12_000, async () => {
    const pool = getDbPool();
    const result = await pool.query<{
      user_id: number;
      name: string | null;
      email: string;
      phone: string | null;
      role: string;
      is_active: boolean | null;
      assigned_player_count: string;
    }>(
      `
        SELECT
          u.id AS user_id,
          u.name,
          u.email,
          u.phone,
          u.role,
          u.is_active,
          COUNT(p.id)::text AS assigned_player_count
        FROM auth_users u
        LEFT JOIN players p ON p.assigned_coach_user_id = u.id
        WHERE u.organization_id = $1
          AND u.role IN ('admin', 'coach')
        GROUP BY u.id, u.name, u.email, u.phone, u.role, u.is_active
        ORDER BY
          CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END,
          COALESCE(u.name, u.email) ASC
      `,
      [organizationId]
    );

    return result.rows
      .map((row): CoachRow => ({
        userId: row.user_id,
        name: (row.name ?? '').trim() || row.email,
        email: row.email,
        phone: row.phone,
        role: row.role === 'coach' ? 'coach' : 'admin',
        isActive: row.is_active !== false,
        assignedPlayerCount: Number(row.assigned_player_count ?? '0') || 0,
      }))
      .filter((row) => row.role === 'admin' || row.role === 'coach');
  });
}

export async function listCoachAssignedPlayersByOrganization(organizationId: number): Promise<CoachAssignedPlayerRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const cacheKey = `coach_assigned_players:${organizationId}`;
  return _withTrainingReadCache(cacheKey, 12_000, async () => {
    const pool = getDbPool();
    const result = await pool.query<{
      player_id: number;
      full_name: string;
      email: string;
      status: string;
      assigned_coach_user_id: number | null;
    }>(
      `
        SELECT
          p.id AS player_id,
          p.full_name,
          p.email,
          p.status,
          p.assigned_coach_user_id
        FROM players p
        WHERE p.organization_id = $1
        ORDER BY p.full_name ASC
      `,
      [organizationId]
    );
    return result.rows.map((row) => ({
      playerId: row.player_id,
      fullName: row.full_name,
      email: row.email,
      status: row.status,
      assignedCoachUserId: row.assigned_coach_user_id,
    }));
  });
}

export async function listPlayerChoicesByOrganization(input: {
  organizationId: number;
  assignedCoachUserId?: number | null;
}): Promise<PlayerChoiceRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const assignedCoachUserId = Number(input.assignedCoachUserId ?? 0);
  const useCoachFilter = Number.isFinite(assignedCoachUserId) && assignedCoachUserId > 0;
  const cacheKey = `player_choices:${input.organizationId}:${useCoachFilter ? assignedCoachUserId : 0}`;
  return _withTrainingReadCache(cacheKey, 20_000, async () => {
    const pool = getDbPool();
    const result = await pool.query<{
      player_id: number;
      full_name: string;
      assigned_coach_user_id: number | null;
    }>(
      `
        SELECT p.id AS player_id, p.full_name, p.assigned_coach_user_id
        FROM players p
        WHERE p.organization_id = $1
        ${useCoachFilter ? 'AND p.assigned_coach_user_id = $2' : ''}
        ORDER BY p.full_name ASC
      `,
      useCoachFilter ? [input.organizationId, assignedCoachUserId] : [input.organizationId]
    );
    return result.rows.map((row) => ({
      playerId: row.player_id,
      fullName: row.full_name,
      assignedCoachUserId: row.assigned_coach_user_id,
    }));
  });
}

export async function listPlayerSummariesByOrganization(input: {
  organizationId: number;
  assignedCoachUserId?: number | null;
}): Promise<PlayerSummaryRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const assignedCoachUserId = Number(input.assignedCoachUserId ?? 0);
  const useCoachFilter = Number.isFinite(assignedCoachUserId) && assignedCoachUserId > 0;
  const cacheKey = `player_summaries:${input.organizationId}:${useCoachFilter ? assignedCoachUserId : 0}`;
  return _withTrainingReadCache(cacheKey, 20_000, async () => {
    const pool = getDbPool();
    const result = await pool.query<{
      player_id: number;
      full_name: string;
      assigned_coach_user_id: number | null;
      throws_hand: string | null;
      bats_hand: string | null;
      position: string | null;
    }>(
      `
        SELECT
          p.id AS player_id,
          p.full_name,
          p.assigned_coach_user_id,
          p.throws_hand,
          p.bats_hand,
          p.position
        FROM players p
        WHERE p.organization_id = $1
        ${useCoachFilter ? 'AND p.assigned_coach_user_id = $2' : ''}
        ORDER BY p.full_name ASC
      `,
      useCoachFilter ? [input.organizationId, assignedCoachUserId] : [input.organizationId]
    );
    return result.rows.map((row) => ({
      playerId: row.player_id,
      fullName: row.full_name,
      assignedCoachUserId: row.assigned_coach_user_id,
      throwsHand: row.throws_hand,
      batsHand: row.bats_hand,
      position: row.position,
    }));
  });
}

export async function getClientCountByOrganization(input: {
  organizationId: number;
  assignedCoachUserId?: number | null;
}): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  await ensureTrainingDbReady();
  const assignedCoachUserId = Number(input.assignedCoachUserId ?? 0);
  const useCoachFilter = Number.isFinite(assignedCoachUserId) && assignedCoachUserId > 0;
  const cacheKey = `client_count:${input.organizationId}:${useCoachFilter ? assignedCoachUserId : 0}`;
  return _withTrainingReadCache(cacheKey, 15_000, async () => {
    const pool = getDbPool();
    const result = await pool.query<{ total_count: string }>(
      `
        SELECT COUNT(*)::text AS total_count
        FROM players p
        WHERE p.organization_id = $1
        ${useCoachFilter ? 'AND p.assigned_coach_user_id = $2' : ''}
      `,
      useCoachFilter ? [input.organizationId, assignedCoachUserId] : [input.organizationId]
    );
    return Number(result.rows[0]?.total_count ?? '0') || 0;
  });
}

export async function listClientStatusCountsByOrganization(input: {
  organizationId: number;
  assignedCoachUserId?: number | null;
}): Promise<Array<{ status: string; count: number }>> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const assignedCoachUserId = Number(input.assignedCoachUserId ?? 0);
  const useCoachFilter = Number.isFinite(assignedCoachUserId) && assignedCoachUserId > 0;
  const cacheKey = `client_status_counts:${input.organizationId}:${useCoachFilter ? assignedCoachUserId : 0}`;
  return _withTrainingReadCache(cacheKey, 15_000, async () => {
    const pool = getDbPool();
    const result = await pool.query<{ status_key: string; status_count: string }>(
      `
        SELECT
          COALESCE(NULLIF(TRIM(p.status), ''), 'unknown') AS status_key,
          COUNT(*)::text AS status_count
        FROM players p
        WHERE p.organization_id = $1
        ${useCoachFilter ? 'AND p.assigned_coach_user_id = $2' : ''}
        GROUP BY status_key
        ORDER BY status_key ASC
      `,
      useCoachFilter ? [input.organizationId, assignedCoachUserId] : [input.organizationId]
    );
    return result.rows.map((row) => ({
      status: row.status_key,
      count: Number(row.status_count ?? '0') || 0,
    }));
  });
}

export async function listWorkoutChoicesByOrganization(organizationId: number): Promise<WorkoutChoiceRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const cacheKey = `workout_choices:${organizationId}`;
  return _withTrainingReadCache(cacheKey, 25_000, async () => {
    const pool = getDbPool();
    const result = await pool.query<{
      id: number;
      name: string;
      category: string;
      exercise_count: string;
    }>(
      `
        SELECT
          w.id,
          w.name,
          w.category,
          COUNT(we.id)::text AS exercise_count
        FROM workout_library w
        LEFT JOIN workout_exercises we ON we.workout_id = w.id
        WHERE w.organization_id = $1
        GROUP BY w.id, w.name, w.category
        ORDER BY w.name ASC
      `,
      [organizationId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      exerciseCount: Number(row.exercise_count ?? '0') || 0,
    }));
  });
}

export async function getExerciseCountByOrganization(organizationId: number): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  await ensureTrainingDbReady();
  const cacheKey = `exercise_count:${organizationId}`;
  return _withTrainingReadCache(cacheKey, 20_000, async () => {
    const pool = getDbPool();
    const result = await pool.query<{ total_count: string }>(
      `
        SELECT COUNT(*)::text AS total_count
        FROM exercise_library
        WHERE organization_id = $1
      `,
      [organizationId]
    );
    return Number(result.rows[0]?.total_count ?? '0') || 0;
  });
}

export async function getWorkoutCountByOrganization(organizationId: number): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  await ensureTrainingDbReady();
  const cacheKey = `workout_count:${organizationId}`;
  return _withTrainingReadCache(cacheKey, 20_000, async () => {
    const pool = getDbPool();
    const result = await pool.query<{ total_count: string }>(
      `
        SELECT COUNT(*)::text AS total_count
        FROM workout_library
        WHERE organization_id = $1
      `,
      [organizationId]
    );
    return Number(result.rows[0]?.total_count ?? '0') || 0;
  });
}

export async function listStaffOrganizationIdsByEmail(email: string): Promise<number[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!normalizedEmail) return [];
  const result = await pool.query<{ organization_id: number | null }>(
    `
      SELECT DISTINCT organization_id
      FROM auth_users
      WHERE LOWER(email) = LOWER($1)
        AND role IN ('admin', 'coach')
        AND organization_id IS NOT NULL
      ORDER BY organization_id ASC
    `,
    [normalizedEmail]
  );
  return result.rows
    .map((row) => Number(row.organization_id ?? 0))
    .filter((id) => Number.isFinite(id) && id > 0);
}

export async function listOrganizationOptions(): Promise<OrganizationOptionRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const orgRows = await pool.query<{ id: number; name: string | null }>(`SELECT id, name FROM organizations`);
  const schoolByOrgId = (() => {
    try {
      const parsed = JSON.parse(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}') as Record<string, unknown>;
      const out: Record<number, string> = {};
      for (const [orgIdRaw, schoolRaw] of Object.entries(parsed)) {
        const orgId = Number(orgIdRaw);
        const school = typeof schoolRaw === 'string' ? schoolRaw.trim().toUpperCase() : '';
        if (!Number.isFinite(orgId) || orgId <= 0 || !school) continue;
        out[orgId] = school;
      }
      return out;
    } catch {
      return {} as Record<number, string>;
    }
  })();
  return orgRows.rows
    .map((row) => ({
      organizationId: Number(row.id ?? 0),
      organizationName: String(row.name ?? '').trim() || `Organization ${row.id}`,
      schoolCode: String(schoolByOrgId[Number(row.id ?? 0)] ?? '').trim().toUpperCase(),
    }))
    .filter((row) => Number.isFinite(row.organizationId) && row.organizationId > 0)
    .sort((a, b) => {
      const aKey = `${a.schoolCode || 'ZZZ'} ${a.organizationName}`.toUpperCase();
      const bKey = `${b.schoolCode || 'ZZZ'} ${b.organizationName}`.toUpperCase();
      return aKey.localeCompare(bKey);
    });
}

function parseOrgSchoolMap(): Record<number, string> {
  try {
    const parsed = JSON.parse(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}') as Record<string, unknown>;
    const out: Record<number, string> = {};
    for (const [orgIdRaw, schoolRaw] of Object.entries(parsed)) {
      const orgId = Number(orgIdRaw);
      const school = typeof schoolRaw === 'string' ? schoolRaw.trim().toUpperCase() : '';
      if (!Number.isFinite(orgId) || orgId <= 0 || !school) continue;
      out[orgId] = school;
    }
    return out;
  } catch {
    return {};
  }
}

function orgNameLikelyMatchesSchoolCode(orgName: string, schoolCode: string): boolean {
  const upperName = orgName.trim().toUpperCase();
  if (!upperName) return false;
  const compactName = upperName.replace(/[^A-Z0-9]/g, '');
  const compactSchool = schoolCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compactSchool) return false;
  if (upperName === schoolCode || compactName === compactSchool) return true;
  if (upperName.includes(schoolCode) || compactName.includes(compactSchool)) return true;
  // Legacy primary PCU org name heuristic.
  if (schoolCode === 'PCU' && upperName.includes('PITCHINGCOACHU')) return true;
  return false;
}

export async function resolveOrganizationIdForSchool(input: {
  schoolCode: string;
  fallbackOrganizationId?: number;
  createIfMissing?: boolean;
}): Promise<number> {
  if (!isDatabaseConfigured()) return Number(input.fallbackOrganizationId ?? 0) || 0;
  await ensureTrainingDbReady();
  const schoolCode = String(input.schoolCode ?? '').trim().toUpperCase();
  const fallbackOrganizationId = Number(input.fallbackOrganizationId ?? 0);
  if (!schoolCode) return Number.isFinite(fallbackOrganizationId) && fallbackOrganizationId > 0 ? fallbackOrganizationId : 0;
  const normalizedFallback = Number.isFinite(fallbackOrganizationId) && fallbackOrganizationId > 0 ? fallbackOrganizationId : 0;
  const cacheKey = `resolve_org_id_for_school:${schoolCode}:${normalizedFallback}:${input.createIfMissing ? 1 : 0}`;
  return _withTrainingReadCache(cacheKey, 45_000, async () => {
    const schoolByOrgId = parseOrgSchoolMap();
    const mapped = Object.entries(schoolByOrgId).find(([, code]) => code === schoolCode);
    if (mapped) {
      const orgId = Number(mapped[0]);
      if (Number.isFinite(orgId) && orgId > 0) return orgId;
    }

    const pool = getDbPool();
    if (normalizedFallback > 0) {
      const fallbackMappedSchool = String(schoolByOrgId[normalizedFallback] ?? '').trim().toUpperCase();
      if (fallbackMappedSchool && fallbackMappedSchool === schoolCode) return normalizedFallback;
      const fallbackOrg = await pool.query<{ name: string | null }>(
        `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
        [normalizedFallback]
      );
      const fallbackName = String(fallbackOrg.rows[0]?.name ?? '').trim();
      if (orgNameLikelyMatchesSchoolCode(fallbackName, schoolCode)) return normalizedFallback;
    }

    const byName = await pool.query<{ id: number }>(
      `
        SELECT id
        FROM organizations
        WHERE UPPER(TRIM(name)) = $1
        ORDER BY id ASC
        LIMIT 1
      `,
      [schoolCode]
    );
    if ((byName.rowCount ?? 0) > 0) {
      const orgId = Number(byName.rows[0]?.id ?? 0);
      if (Number.isFinite(orgId) && orgId > 0) return orgId;
    }

    if (input.createIfMissing) {
      // Do not rely on a UNIQUE constraint existing on organizations.name.
      // Some production environments were bootstrapped without that exact
      // constraint, causing ON CONFLICT(...) to throw and crash admin pages.
      try {
        const created = await pool.query<{ id: number }>(
          `
            INSERT INTO organizations (name)
            VALUES ($1)
            RETURNING id
          `,
          [schoolCode]
        );
        const orgId = Number(created.rows[0]?.id ?? 0);
        if (Number.isFinite(orgId) && orgId > 0) return orgId;
      } catch {
        // Concurrent create or schema mismatch; fall through to lookup.
      }

      const createdLookup = await pool.query<{ id: number }>(
        `
          SELECT id
          FROM organizations
          WHERE UPPER(TRIM(name)) = $1
          ORDER BY id ASC
          LIMIT 1
        `,
        [schoolCode]
      );
      if ((createdLookup.rowCount ?? 0) > 0) {
        const orgId = Number(createdLookup.rows[0]?.id ?? 0);
        if (Number.isFinite(orgId) && orgId > 0) return orgId;
      }
    }

    return normalizedFallback;
  });
}

export async function isCoachAssignedToPlayer(input: {
  organizationId: number;
  coachUserId: number;
  playerId: number;
}): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query<{ id: number }>(
    `
      SELECT p.id
      FROM players p
      WHERE p.organization_id = $1
        AND p.id = $2
        AND p.assigned_coach_user_id = $3
      LIMIT 1
    `,
    [input.organizationId, input.playerId, input.coachUserId]
  );
  return (result.rowCount ?? 0) === 1;
}

export async function playerExistsInOrganization(input: {
  organizationId: number;
  playerId: number;
}): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ id: number }>(
    `
      SELECT p.id
      FROM players p
      WHERE p.organization_id = $1
        AND p.id = $2
      LIMIT 1
    `,
    [input.organizationId, input.playerId]
  );
  return (result.rowCount ?? 0) === 1;
}

export async function createClientWithLogin(input: {
  organizationId: number;
  fullName: string;
  email: string;
  password: string;
  assignedCoachUserId?: number;
  dateOfBirth?: string;
  schoolTeam?: string;
  phone?: string;
  collegeCommitment?: string;
  gradYear?: string;
  position?: string;
  height?: string;
  profileWeightLbs?: number;
  batsHand?: string;
  throwsHand?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const normalizedEmail = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!normalizedEmail || !fullName || !input.password) {
    return { ok: false, error: 'Name, email, and password are required.' };
  }

  const assignedCoachUserId =
    Number.isFinite(Number(input.assignedCoachUserId ?? 0)) && Number(input.assignedCoachUserId ?? 0) > 0
      ? Number(input.assignedCoachUserId)
      : null;
  const profileWeightLbs =
    Number.isFinite(Number(input.profileWeightLbs ?? NaN)) && Number(input.profileWeightLbs ?? NaN) > 0
      ? Number(input.profileWeightLbs)
      : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`SET LOCAL statement_timeout = '20s'`);
    const lockResult = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_xact_lock($1) AS locked`, [947232]);
    if (!Boolean(lockResult.rows[0]?.locked)) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Another player create/update is already running. Please try again in a few seconds.' };
    }

    const existingUser = await client.query<{ id: number }>(
      `SELECT id FROM auth_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail]
    );
    if ((existingUser.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'A login already exists with that email.' };
    }

    const passwordHash = createPasswordHash(input.password);
    await client.query(`SAVEPOINT sp_insert_auth_user_player`);
    let insertedUser;
    try {
      insertedUser = await client.query<{ id: number }>(
        `
          INSERT INTO auth_users (email, username, name, password, password_hash, app_url, role, organization_id)
          VALUES ($1, $2, $3, $4, $5, $6, 'player', $7)
          RETURNING id
        `,
        [
          normalizedEmail,
          deriveUsernameFromEmail(normalizedEmail),
          fullName,
          passwordHash,
          passwordHash,
          DEFAULT_DASHBOARD_URL,
          input.organizationId,
        ]
      );
    } catch (error) {
      if (!isAuthUsersPrimaryKeyViolation(error)) throw error;
      await client.query(`ROLLBACK TO SAVEPOINT sp_insert_auth_user_player`);
      await ensureAuthUsersIdSequence(client);
      try {
        insertedUser = await client.query<{ id: number }>(
          `
            INSERT INTO auth_users (email, username, name, password, password_hash, app_url, role, organization_id)
            VALUES ($1, $2, $3, $4, $5, $6, 'player', $7)
            RETURNING id
          `,
          [
            normalizedEmail,
            deriveUsernameFromEmail(normalizedEmail),
            fullName,
            passwordHash,
            passwordHash,
            DEFAULT_DASHBOARD_URL,
            input.organizationId,
          ]
        );
      } catch (retryError) {
        await client.query(`ROLLBACK TO SAVEPOINT sp_insert_auth_user_player`);
        throw retryError;
      }
    } finally {
      try {
        await client.query(`RELEASE SAVEPOINT sp_insert_auth_user_player`);
      } catch {
        // ignore; outer transaction cleanup handles final state
      }
    }

    if (assignedCoachUserId) {
      const coachResult = await client.query<{ id: number }>(
        `
          SELECT id
          FROM auth_users
          WHERE id = $1
            AND organization_id = $2
            AND role IN ('admin', 'coach')
          LIMIT 1
        `,
        [assignedCoachUserId, input.organizationId]
      );
      if ((coachResult.rowCount ?? 0) !== 1) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'Assigned coach was not found in your organization.' };
      }
    }

    await client.query(
      `
        INSERT INTO players (
          organization_id,
          user_id,
          full_name,
          email,
          date_of_birth,
          school_team,
          phone,
          college_commitment,
          grad_year,
          position,
          height,
          profile_weight_lbs,
          bats_hand,
          throws_hand,
          assigned_coach_user_id,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'active')
      `,
      [
        input.organizationId,
        insertedUser.rows[0].id,
        fullName,
        normalizedEmail,
        /^\d{4}-\d{2}-\d{2}$/.test((input.dateOfBirth ?? '').trim()) ? input.dateOfBirth?.trim() : null,
        (input.schoolTeam ?? '').trim() || null,
        (input.phone ?? '').trim() || null,
        (input.collegeCommitment ?? '').trim() || null,
        (input.gradYear ?? '').trim() || null,
        (input.position ?? '').trim() || null,
        (input.height ?? '').trim() || null,
        profileWeightLbs,
        (input.batsHand ?? '').trim() || null,
        (input.throwsHand ?? '').trim() || null,
        assignedCoachUserId,
      ]
    );

    await client.query('COMMIT');
    _invalidateTrainingReadCacheForOrganization(input.organizationId);
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to create client.' };
  } finally {
    client.release();
  }
}

export async function createStaffUser(input: {
  organizationId: number;
  name: string;
  email: string;
  password: string;
  phone?: string;
  role: 'admin' | 'coach';
  allowCrossSchoolLinking?: boolean;
}): Promise<{ ok: true; reusedExistingPassword: boolean } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const normalizedEmail = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!name || !normalizedEmail || !input.password) {
    return { ok: false, error: 'Name, email, and password are required.' };
  }
  if (input.role !== 'admin' && input.role !== 'coach') {
    return { ok: false, error: 'Role must be admin or coach.' };
  }

  const existingSameOrg = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM auth_users
      WHERE LOWER(email) = LOWER($1)
        AND organization_id = $2
      LIMIT 1
    `,
    [normalizedEmail, input.organizationId]
  );
  if ((existingSameOrg.rowCount ?? 0) > 0) {
    return { ok: false, error: 'A coach/admin login already exists with that email for this school.' };
  }

  const existingOtherOrgs = await pool.query<{ organization_id: number | null }>(
    `
      SELECT DISTINCT organization_id
      FROM auth_users
      WHERE LOWER(email) = LOWER($1)
        AND role IN ('admin', 'coach')
        AND organization_id IS NOT NULL
        AND organization_id <> $2
      LIMIT 1
    `,
    [normalizedEmail, input.organizationId]
  );
  if ((existingOtherOrgs.rowCount ?? 0) > 0 && !input.allowCrossSchoolLinking) {
    return { ok: false, error: 'Only global admin can link the same coach email across multiple schools.' };
  }

  const existingAny = await pool.query<{ password_hash: string | null; role: string | null; name: string | null }>(
    `
      SELECT password_hash, role, name
      FROM auth_users
      WHERE LOWER(email) = LOWER($1)
      ORDER BY id ASC
      LIMIT 1
    `,
    [normalizedEmail]
  );
  if ((existingAny.rowCount ?? 0) > 0) {
    const existingRole = String(existingAny.rows[0].role ?? '').trim().toLowerCase();
    if (existingRole && existingRole !== 'admin' && existingRole !== 'coach') {
      return { ok: false, error: 'This email is already used by a player account. Use a different email.' };
    }
  }

  const existingNameRaw = String(existingAny.rows[0]?.name ?? '').trim();
  const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (existingNameRaw && normalizeName(existingNameRaw) !== normalizeName(name)) {
    return { ok: false, error: `This email is already linked as "${existingNameRaw}". Use that same name.` };
  }

  const reusedExistingPassword = Boolean((existingAny.rows[0]?.password_hash ?? '').trim());
  if (reusedExistingPassword) {
    const existingHash = String(existingAny.rows[0]?.password_hash ?? '').trim();
    if (!verifyPasswordAgainstHash(existingHash, input.password)) {
      return { ok: false, error: 'This email already exists. Enter the same existing password for this email.' };
    }
  }
  const passwordHash = reusedExistingPassword
    ? String(existingAny.rows[0]?.password_hash ?? '').trim()
    : createPasswordHash(input.password);
  const canonicalName = existingNameRaw || name;
  const insertValues = [
    normalizedEmail,
    deriveUsernameFromEmail(normalizedEmail),
    canonicalName,
    (input.phone ?? '').trim() || null,
    passwordHash,
    passwordHash,
    DEFAULT_DASHBOARD_URL,
    input.role,
    input.organizationId,
  ];
  const insertSql = `
    INSERT INTO auth_users (
      email, username, name, phone, password, password_hash, app_url, role, organization_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `;
  // Production can have occasional auth_users id sequence drift (manual imports,
  // legacy bootstraps). Proactively sync before insert and retry on pkey conflicts.
  await ensureAuthUsersIdSequence(pool);
  let inserted = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await pool.query(insertSql, insertValues);
      inserted = true;
      break;
    } catch (error) {
      if (!isAuthUsersPrimaryKeyViolation(error)) throw error;
      await ensureAuthUsersIdSequence(pool);
    }
  }
  if (!inserted) {
    return {
      ok: false,
      error: 'Could not create coach/admin profile because user ID sequencing is out of sync. Please retry.',
    };
  }

  return { ok: true, reusedExistingPassword };
}

export async function setStaffActiveStatus(input: {
  organizationId: number;
  staffUserId: number;
  isActive: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const updated = await pool.query<{ id: number }>(
    `
      UPDATE auth_users
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
        AND organization_id = $3
        AND role IN ('admin', 'coach')
      RETURNING id
    `,
    [input.isActive, input.staffUserId, input.organizationId]
  );
  if ((updated.rowCount ?? 0) !== 1) return { ok: false, error: 'Coach user not found.' };
  return { ok: true };
}

export async function deleteStaffUser(input: {
  organizationId: number;
  staffUserId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '3s'`);
    await client.query(`SET LOCAL statement_timeout = '8s'`);
    const deleted = await client.query<{ id: number }>(
      `
        DELETE FROM auth_users
        WHERE id = $1
          AND organization_id = $2
          AND role IN ('admin', 'coach')
        RETURNING id
      `,
      [input.staffUserId, input.organizationId]
    );
    if ((deleted.rowCount ?? 0) !== 1) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Coach user not found.' };
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to delete coach.' };
  } finally {
    client.release();
  }
}

export async function updateStaffUser(input: {
  organizationId: number;
  staffUserId: number;
  name: string;
  email: string;
  phone?: string;
  role: 'admin' | 'coach';
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const normalizedEmail = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!name || !normalizedEmail) {
    return { ok: false, error: 'Name and email are required.' };
  }
  if (input.role !== 'admin' && input.role !== 'coach') {
    return { ok: false, error: 'Role must be admin or coach.' };
  }

  const existing = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM auth_users
      WHERE LOWER(email) = LOWER($1)
        AND id <> $2
        AND organization_id = $3
      LIMIT 1
    `,
    [normalizedEmail, input.staffUserId, input.organizationId]
  );
  if ((existing.rowCount ?? 0) > 0) {
    return { ok: false, error: 'A coach/admin login already exists with that email for this school.' };
  }

  const updated = await pool.query<{ id: number }>(
    `
      UPDATE auth_users
      SET
        name = $1,
        email = $2,
        username = $3,
        phone = $4,
        role = $5,
        updated_at = NOW()
      WHERE id = $6
        AND organization_id = $7
        AND role IN ('admin', 'coach')
      RETURNING id
    `,
    [
      name,
      normalizedEmail,
      deriveUsernameFromEmail(normalizedEmail),
      (input.phone ?? '').trim() || null,
      input.role,
      input.staffUserId,
      input.organizationId,
    ]
  );
  if ((updated.rowCount ?? 0) !== 1) return { ok: false, error: 'Coach user not found.' };
  return { ok: true };
}

export async function syncStaffUserSchools(input: {
  organizationId: number;
  staffUserId: number;
  name: string;
  email: string;
  phone?: string;
  role: 'admin' | 'coach';
  targetOrganizationIds: number[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const normalizedEmail = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (!name || !normalizedEmail) return { ok: false, error: 'Name and email are required.' };
    if (input.role !== 'admin' && input.role !== 'coach') return { ok: false, error: 'Role must be admin or coach.' };
    const targetOrganizationIds = Array.from(
      new Set(
        input.targetOrganizationIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    );
    if (targetOrganizationIds.length < 1) return { ok: false, error: 'Select at least one school.' };

    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`SET LOCAL statement_timeout = '20s'`);
    const lockResult = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_xact_lock($1) AS locked`, [947231]);
    if (!Boolean(lockResult.rows[0]?.locked)) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Another coach update is already running. Please try again in a few seconds.' };
    }
    await client.query(`LOCK TABLE auth_users IN SHARE ROW EXCLUSIVE MODE`);
    await ensureAuthUsersIdSequence(client);

    const anchorResult = await client.query<{
      id: number;
      email: string;
      password: string | null;
      password_hash: string | null;
    }>(
      `
        SELECT id, email, password, password_hash
        FROM auth_users
        WHERE id = $1
          AND organization_id = $2
          AND role IN ('admin', 'coach')
        LIMIT 1
      `,
      [input.staffUserId, input.organizationId]
    );
    if ((anchorResult.rowCount ?? 0) !== 1) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Coach user not found.' };
    }
    const sourcePassword = String(anchorResult.rows[0]?.password ?? '').trim();
    const sourcePasswordHash = String(anchorResult.rows[0]?.password_hash ?? '').trim();
    if (!sourcePasswordHash) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Existing password hash is missing for this user.' };
    }
    const oldEmail = String(anchorResult.rows[0]?.email ?? '').trim().toLowerCase();

    const emailConflict = await client.query<{ id: number }>(
      `
        SELECT id
        FROM auth_users
        WHERE LOWER(email) = LOWER($1)
          AND organization_id = ANY($2::int[])
          AND id <> ALL(
            COALESCE(
              (
                SELECT array_agg(id)
                FROM auth_users
                WHERE LOWER(email) = LOWER($3)
                  AND role IN ('admin', 'coach')
              ),
              ARRAY[]::int[]
            )
          )
        LIMIT 1
      `,
      [normalizedEmail, targetOrganizationIds, oldEmail]
    );
    if ((emailConflict.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Another coach/admin already uses that email in one of the selected schools.' };
    }

    const existingRows = await client.query<{ id: number; organization_id: number | null }>(
      `
        SELECT id, organization_id
        FROM auth_users
        WHERE LOWER(email) = LOWER($1)
          AND role IN ('admin', 'coach')
      `,
      [oldEmail]
    );
    const existingByOrg = new Map<number, number>();
    for (const row of existingRows.rows) {
      const orgId = Number(row.organization_id ?? 0);
      const rowId = Number(row.id ?? 0);
      if (!Number.isFinite(orgId) || orgId <= 0 || !Number.isFinite(rowId) || rowId <= 0) continue;
      existingByOrg.set(orgId, rowId);
    }

    for (const orgId of targetOrganizationIds) {
      const existingId = existingByOrg.get(orgId);
      if (existingId) {
        await client.query(
          `
            UPDATE auth_users
            SET
              name = $1,
              email = $2,
              username = $3,
              phone = $4,
              role = $5,
              updated_at = NOW()
            WHERE id = $6
          `,
          [name, normalizedEmail, deriveUsernameFromEmail(normalizedEmail), (input.phone ?? '').trim() || null, input.role, existingId]
        );
      } else {
        const insertValues = [
          normalizedEmail,
          deriveUsernameFromEmail(normalizedEmail),
          name,
          (input.phone ?? '').trim() || null,
          sourcePassword || sourcePasswordHash,
          sourcePasswordHash,
          DEFAULT_DASHBOARD_URL,
          input.role,
          orgId,
        ];
        await client.query(`SAVEPOINT sp_insert_auth_user_staff`);
        try {
          await client.query(
            `
              INSERT INTO auth_users (
                email, username, name, phone, password, password_hash, app_url, role, organization_id
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `,
            insertValues
          );
        } catch (error) {
          if (!isAuthUsersPrimaryKeyViolation(error)) throw error;
          await client.query(`ROLLBACK TO SAVEPOINT sp_insert_auth_user_staff`);
          await ensureAuthUsersIdSequence(client);
          try {
            await client.query(
              `
                INSERT INTO auth_users (
                  email, username, name, phone, password, password_hash, app_url, role, organization_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              `,
              insertValues
            );
          } catch (retryError) {
            await client.query(`ROLLBACK TO SAVEPOINT sp_insert_auth_user_staff`);
            throw retryError;
          }
        } finally {
          try {
            await client.query(`RELEASE SAVEPOINT sp_insert_auth_user_staff`);
          } catch {
            // ignore; outer transaction cleanup handles final state
          }
        }
      }
    }

    const removeOrgIds = Array.from(existingByOrg.keys()).filter((orgId) => !targetOrganizationIds.includes(orgId));
    if (removeOrgIds.length > 0) {
      await client.query(
        `
          DELETE FROM auth_users
          WHERE LOWER(email) = LOWER($1)
            AND role IN ('admin', 'coach')
            AND organization_id = ANY($2::int[])
        `,
        [oldEmail, removeOrgIds]
      );
    }

    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to sync coach schools.' };
  } finally {
    client.release();
  }
}

export async function deleteClientUser(input: {
  organizationId: number;
  playerId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deletedPlayer = await client.query<{ user_id: number | null }>(
      `
        DELETE FROM players
        WHERE id = $1
          AND organization_id = $2
        RETURNING user_id
      `,
      [input.playerId, input.organizationId]
    );
    if ((deletedPlayer.rowCount ?? 0) !== 1) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Player not found.' };
    }
    const userId = Number(deletedPlayer.rows[0]?.user_id ?? 0);
    if (Number.isFinite(userId) && userId > 0) {
      await client.query(
        `
          DELETE FROM auth_users
          WHERE id = $1
            AND organization_id = $2
            AND role = 'player'
        `,
        [userId, input.organizationId]
      );
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to delete player.' };
  } finally {
    client.release();
  }
}

export async function listExerciseCategoriesByOrganization(organizationId: number): Promise<ExerciseCategoryRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query<{ id: number; name: string }>(
    `
      SELECT id, name
      FROM exercise_categories
      WHERE organization_id = $1
      ORDER BY name ASC
    `,
    [organizationId]
  );

  const rows = result.rows.map((row) => ({ id: row.id, name: row.name }));
  if (rows.length > 0) return rows;

  return [
    { id: -1, name: 'lift' },
    { id: -2, name: 'throw' },
    { id: -3, name: 'drill' },
    { id: -4, name: 'recovery' },
  ];
}

export async function createExerciseCategory(input: {
  organizationId: number;
  userId: number;
  name: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const name = normalizeCategoryName(input.name);
  if (!name) return { ok: false, error: 'Category name is required.' };

  await pool.query(
    `
      INSERT INTO exercise_categories (organization_id, name, created_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (organization_id, name)
      DO UPDATE SET updated_at = NOW()
    `,
    [input.organizationId, name, input.userId]
  );

  _invalidateTrainingReadCacheForOrganization(input.organizationId);
  return { ok: true };
}

export async function listExercisesByOrganization(organizationId: number): Promise<ExerciseRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query<{
    id: number;
    name: string;
    category: string;
    rep_measure: string;
    tracking_type: string | null;
    reps_per_side: boolean;
    description: string | null;
    instruction_video_url: string | null;
    coaching_cues: string | null;
  }>(
    `
      SELECT id, name, category, rep_measure, tracking_type, reps_per_side, description, instruction_video_url, coaching_cues
      FROM exercise_library
      WHERE organization_id = $1
      ORDER BY name ASC
    `,
    [organizationId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    repMeasure: row.rep_measure === 'seconds' ? 'seconds' : row.rep_measure === 'distance' ? 'distance' : 'reps',
    trackingType: normalizeTrackingType(row.tracking_type),
    repsPerSide: Boolean(row.reps_per_side),
    description: row.description,
    instructionVideoUrl: row.instruction_video_url,
    coachingCues: row.coaching_cues,
  }));
}

export async function getExerciseByIdInOrganization(input: {
  organizationId: number;
  exerciseId: number;
}): Promise<ExerciseRow | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query<{
    id: number;
    name: string;
    category: string;
    rep_measure: string;
    tracking_type: string | null;
    reps_per_side: boolean;
    description: string | null;
    instruction_video_url: string | null;
    coaching_cues: string | null;
  }>(
    `
      SELECT id, name, category, rep_measure, tracking_type, reps_per_side, description, instruction_video_url, coaching_cues
      FROM exercise_library
      WHERE organization_id = $1 AND id = $2
      LIMIT 1
    `,
    [input.organizationId, input.exerciseId]
  );

  if ((result.rowCount ?? 0) !== 1) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    repMeasure: row.rep_measure === 'seconds' ? 'seconds' : row.rep_measure === 'distance' ? 'distance' : 'reps',
    trackingType: normalizeTrackingType(row.tracking_type),
    repsPerSide: Boolean(row.reps_per_side),
    description: row.description,
    instructionVideoUrl: row.instruction_video_url,
    coachingCues: row.coaching_cues,
  };
}

export async function createExercise(input: {
  organizationId: number;
  userId: number;
  name: string;
  category: string;
  repMeasure?: string;
  trackingType?: string;
  repsPerSide?: boolean;
  description?: string;
  instructionVideoUrl?: string;
  coachingCues?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const name = input.name.trim();
  const category = normalizeCategoryName(input.category);
  const repMeasure = input.repMeasure === 'seconds' ? 'seconds' : input.repMeasure === 'distance' ? 'distance' : 'reps';
  const trackingType = normalizeTrackingType(input.trackingType);
  const repsPerSide = repMeasure === 'reps' ? Boolean(input.repsPerSide) : false;
  if (!name) return { ok: false, error: 'Exercise name is required.' };
  if (!category) return { ok: false, error: 'Category is required.' };

  const videoCheck = validateHttpUrl(input.instructionVideoUrl ?? '');
  if (!videoCheck.ok) return { ok: false, error: videoCheck.error };

  await pool.query(
    `
      INSERT INTO exercise_categories (organization_id, name, created_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (organization_id, name)
      DO UPDATE SET updated_at = NOW()
    `,
    [input.organizationId, category, input.userId]
  );

  await pool.query(
    `
      INSERT INTO exercise_library (
        organization_id, name, category, rep_measure, tracking_type, reps_per_side, description, instruction_video_url, coaching_cues, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      input.organizationId,
      name,
      category,
      repMeasure,
      trackingType,
      repsPerSide,
      (input.description ?? '').trim() || null,
      videoCheck.value || null,
      (input.coachingCues ?? '').trim() || null,
      input.userId,
    ]
  );

  _invalidateTrainingReadCacheForOrganization(input.organizationId);
  return { ok: true };
}

export async function updateExercise(input: {
  organizationId: number;
  userId: number;
  exerciseId: number;
  name: string;
  category: string;
  repMeasure?: string;
  trackingType?: string;
  repsPerSide?: boolean;
  description?: string;
  instructionVideoUrl?: string;
  coachingCues?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const name = input.name.trim();
  const category = normalizeCategoryName(input.category);
  const repMeasure = input.repMeasure === 'seconds' ? 'seconds' : input.repMeasure === 'distance' ? 'distance' : 'reps';
  const trackingType = normalizeTrackingType(input.trackingType);
  const repsPerSide = repMeasure === 'reps' ? Boolean(input.repsPerSide) : false;
  if (!name) return { ok: false, error: 'Exercise name is required.' };
  if (!category) return { ok: false, error: 'Category is required.' };

  const videoCheck = validateHttpUrl(input.instructionVideoUrl ?? '');
  if (!videoCheck.ok) return { ok: false, error: videoCheck.error };

  await pool.query(
    `
      INSERT INTO exercise_categories (organization_id, name, created_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (organization_id, name)
      DO UPDATE SET updated_at = NOW()
    `,
    [input.organizationId, category, input.userId]
  );

  const updated = await pool.query<{ id: number }>(
    `
      UPDATE exercise_library
      SET
        name = $1,
        category = $2,
        rep_measure = $3,
        tracking_type = $4,
        reps_per_side = $5,
        description = $6,
        instruction_video_url = $7,
        coaching_cues = $8,
        updated_at = NOW()
      WHERE id = $9 AND organization_id = $10
      RETURNING id
    `,
    [
      name,
      category,
      repMeasure,
      trackingType,
      repsPerSide,
      (input.description ?? '').trim() || null,
      videoCheck.value || null,
      (input.coachingCues ?? '').trim() || null,
      input.exerciseId,
      input.organizationId,
    ]
  );

  if ((updated.rowCount ?? 0) !== 1) {
    return { ok: false, error: 'Exercise was not found in your organization.' };
  }
  _invalidateTrainingReadCacheForOrganization(input.organizationId);
  return { ok: true };
}

export async function deleteExercise(input: {
  organizationId: number;
  exerciseId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const inWorkouts = await pool.query<{ n: string }>(
    `
      SELECT COUNT(*)::text AS n
      FROM workout_exercises we
      JOIN workout_library w ON w.id = we.workout_id
      WHERE we.exercise_id = $1 AND w.organization_id = $2
    `,
    [input.exerciseId, input.organizationId]
  );
  if (Number(inWorkouts.rows[0]?.n ?? '0') > 0) {
    return { ok: false, error: 'This exercise is used in one or more workouts. Remove it from workouts first.' };
  }

  const inPrograms = await pool.query<{ n: string }>(
    `
      SELECT COUNT(*)::text AS n
      FROM program_day_items i
      JOIN program_days d ON d.id = i.program_day_id
      JOIN programs p ON p.id = d.program_id
      WHERE i.exercise_id = $1 AND p.organization_id = $2
    `,
    [input.exerciseId, input.organizationId]
  );
  if (Number(inPrograms.rows[0]?.n ?? '0') > 0) {
    return { ok: false, error: 'This exercise is assigned in one or more programs. Remove assignments first.' };
  }

  const deleted = await pool.query<{ id: number }>(
    `
      DELETE FROM exercise_library
      WHERE id = $1 AND organization_id = $2
      RETURNING id
    `,
    [input.exerciseId, input.organizationId]
  );
  if ((deleted.rowCount ?? 0) !== 1) {
    return { ok: false, error: 'Exercise not found.' };
  }

  _invalidateTrainingReadCacheForOrganization(input.organizationId);
  return { ok: true };
}

export async function deleteWorkout(input: {
  organizationId: number;
  workoutId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const inPrograms = await pool.query<{ n: string }>(
    `
      SELECT COUNT(*)::text AS n
      FROM program_day_items i
      JOIN program_days d ON d.id = i.program_day_id
      JOIN programs p ON p.id = d.program_id
      WHERE i.workout_id = $1 AND p.organization_id = $2
    `,
    [input.workoutId, input.organizationId]
  );
  if (Number(inPrograms.rows[0]?.n ?? '0') > 0) {
    return { ok: false, error: 'This workout is assigned in one or more programs. Remove assignments first.' };
  }

  const deleted = await pool.query<{ id: number }>(
    `
      DELETE FROM workout_library
      WHERE id = $1 AND organization_id = $2
      RETURNING id
    `,
    [input.workoutId, input.organizationId]
  );
  if ((deleted.rowCount ?? 0) !== 1) {
    return { ok: false, error: 'Workout not found.' };
  }

  _invalidateTrainingReadCacheForOrganization(input.organizationId);
  return { ok: true };
}

export async function listWorkoutsByOrganization(organizationId: number): Promise<WorkoutRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query<{
    id: number;
    name: string;
    category: string;
    description: string | null;
    exercise_count: string;
    exercise_names: string | null;
  }>(
    `
      SELECT
        w.id,
        w.name,
        w.category,
        w.description,
        COUNT(we.id)::text AS exercise_count,
        STRING_AGG(
          CASE
            WHEN we.exercise_prefix IS NOT NULL AND LENGTH(TRIM(we.exercise_prefix)) > 0
              THEN CONCAT(TRIM(we.exercise_prefix), ': ', e.name)
            ELSE e.name
          END,
          ', '
          ORDER BY we.sort_order, e.name
        ) AS exercise_names
      FROM workout_library w
      LEFT JOIN workout_exercises we ON we.workout_id = w.id
      LEFT JOIN exercise_library e ON e.id = we.exercise_id
      WHERE w.organization_id = $1
      GROUP BY w.id, w.name, w.category, w.description
      ORDER BY w.name ASC
    `,
    [organizationId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    exerciseCount: Number(row.exercise_count),
    exerciseNames: row.exercise_names ? row.exercise_names.split(', ').filter(Boolean) : [],
  }));
}

export async function getWorkoutByIdInOrganization(input: {
  organizationId: number;
  workoutId: number;
}): Promise<WorkoutDetailRow | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const workoutResult = await pool.query<{ id: number; name: string; category: string; description: string | null }>(
    `
      SELECT id, name, category, description
      FROM workout_library
      WHERE id = $1 AND organization_id = $2
      LIMIT 1
    `,
    [input.workoutId, input.organizationId]
  );
  if ((workoutResult.rowCount ?? 0) !== 1) return null;

  const itemsResult = await pool.query<{
    exercise_id: number;
    exercise_name: string;
    category: string;
    rep_measure: 'reps' | 'seconds' | 'distance';
    tracking_type: string | null;
    reps_per_side: boolean;
    sort_order: number;
    prefix: string | null;
    prescribed_sets: string | null;
    prescribed_reps: string | null;
    notes: string | null;
  }>(
    `
      SELECT
        we.exercise_id,
        e.name AS exercise_name,
        e.category,
        e.rep_measure,
        e.tracking_type,
        e.reps_per_side,
        we.sort_order,
        we.exercise_prefix AS prefix,
        we.prescribed_sets,
        we.prescribed_reps,
        we.notes
      FROM workout_exercises we
      JOIN exercise_library e ON e.id = we.exercise_id
      WHERE we.workout_id = $1
      ORDER BY we.sort_order ASC, e.name ASC
    `,
    [input.workoutId]
  );

  const workout = workoutResult.rows[0];
  return {
    id: workout.id,
    name: workout.name,
    category: workout.category,
    description: workout.description,
    items: itemsResult.rows.map((row) => ({
      exerciseId: row.exercise_id,
      exerciseName: row.exercise_name,
      category: row.category,
      repMeasure: row.rep_measure,
      trackingType: normalizeTrackingType(row.tracking_type),
      repsPerSide: row.reps_per_side,
      sortOrder: row.sort_order,
      prefix: row.prefix,
      prescribedSets: row.prescribed_sets,
      prescribedReps: row.prescribed_reps,
      notes: row.notes,
    })),
  };
}

function addDaysIso(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function listScheduleTemplatesByOrganization(organizationId: number): Promise<ScheduleTemplateRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const cacheKey = `schedule_templates:${organizationId}`;
  return _withTrainingReadCache(cacheKey, 25_000, async () => {
    const pool = getDbPool();
    const result = await pool.query<{
      id: number;
      name: string;
      created_at: string;
      updated_at: string;
      day_id: number | null;
      day_offset: number | null;
      item_id: number | null;
      workout_id: number | null;
      workout_name: string | null;
      workout_category: string | null;
      sort_order: number | null;
      prescribed_sets: string | null;
      prescribed_reps: string | null;
      prescribed_load: string | null;
      prescribed_notes: string | null;
    }>(
      `
        SELECT
          t.id,
          t.name,
          t.created_at::text,
          t.updated_at::text,
          d.id AS day_id,
          d.day_offset,
          i.id AS item_id,
          i.workout_id,
          w.name AS workout_name,
          w.category AS workout_category,
          i.sort_order,
          i.prescribed_sets,
          i.prescribed_reps,
          i.prescribed_load,
          i.prescribed_notes
        FROM schedule_templates t
        LEFT JOIN schedule_template_days d ON d.template_id = t.id
        LEFT JOIN schedule_template_day_items i ON i.template_day_id = d.id
        LEFT JOIN workout_library w ON w.id = i.workout_id
        WHERE t.organization_id = $1
        ORDER BY t.updated_at DESC, t.id DESC, d.day_offset ASC NULLS LAST, i.sort_order ASC NULLS LAST, i.id ASC NULLS LAST
      `,
      [organizationId]
    );

    const byTemplate = new Map<number, ScheduleTemplateRow>();
    const dayMaps = new Map<number, Map<number, ScheduleTemplateDayRow>>();
    for (const row of result.rows) {
      const templateId = Number(row.id);
      if (!byTemplate.has(templateId)) {
        byTemplate.set(templateId, {
          id: templateId,
          name: row.name,
          totalDays: 0,
          workoutCount: 0,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          days: [],
        });
        dayMaps.set(templateId, new Map());
      }
      const template = byTemplate.get(templateId)!;
      const dayId = Number(row.day_id ?? 0);
      if (dayId > 0) {
        const dayMap = dayMaps.get(templateId)!;
        if (!dayMap.has(dayId)) {
          dayMap.set(dayId, {
            id: dayId,
            dayOffset: Number(row.day_offset ?? 0),
            items: [],
          });
        }
        const day = dayMap.get(dayId)!;
        const itemId = Number(row.item_id ?? 0);
        if (itemId > 0) {
          day.items.push({
            id: itemId,
            workoutId: Number(row.workout_id ?? 0),
            workoutName: String(row.workout_name ?? 'Workout'),
            workoutCategory: row.workout_category,
            sortOrder: Number(row.sort_order ?? 1),
            prescribedSets: row.prescribed_sets,
            prescribedReps: row.prescribed_reps,
            prescribedLoad: row.prescribed_load,
            prescribedNotes: row.prescribed_notes,
          });
        }
      }
      template.workoutCount += Number(row.item_id ?? 0) > 0 ? 1 : 0;
    }

    const templates = Array.from(byTemplate.values());
    for (const template of templates) {
      const dayMap = dayMaps.get(template.id);
      const days = dayMap ? Array.from(dayMap.values()).sort((a, b) => a.dayOffset - b.dayOffset) : [];
      template.days = days;
      template.totalDays = days.length > 0 ? days[days.length - 1].dayOffset + 1 : 0;
    }
    return templates;
  });
}

export async function saveScheduleTemplate(input: {
  organizationId: number;
  userId: number;
  templateId?: number;
  name: string;
  days: Array<{
    dayOffset: number;
    items: Array<{
      workoutId: number;
      prescribedSets?: string;
      prescribedReps?: string;
      prescribedLoad?: string;
      prescribedNotes?: string;
    }>;
  }>;
}): Promise<{ ok: true; templateId: number } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const name = String(input.name ?? '').trim();
  if (!name) return { ok: false, error: 'Template name is required.' };

  const cleanedDays = (input.days ?? [])
    .map((day) => ({
      dayOffset: Number(day.dayOffset),
      items: (day.items ?? [])
        .map((item) => ({
          workoutId: Number(item.workoutId ?? 0),
          prescribedSets: String(item.prescribedSets ?? '').trim(),
          prescribedReps: String(item.prescribedReps ?? '').trim(),
          prescribedLoad: String(item.prescribedLoad ?? '').trim(),
          prescribedNotes: String(item.prescribedNotes ?? '').trim(),
        }))
        .filter((item) => Number.isFinite(item.workoutId) && item.workoutId > 0),
    }))
    .filter((day) => Number.isFinite(day.dayOffset) && day.dayOffset >= 0 && day.items.length > 0)
    .sort((a, b) => a.dayOffset - b.dayOffset);
  if (cleanedDays.length === 0) return { ok: false, error: 'Add at least one workout day before saving.' };

  const workoutIds = Array.from(new Set(cleanedDays.flatMap((day) => day.items.map((item) => item.workoutId))));
  if (workoutIds.length === 0) return { ok: false, error: 'No workouts found for this template.' };
  const validWorkouts = await pool.query<{ id: number }>(
    `SELECT id FROM workout_library WHERE organization_id = $1 AND id = ANY($2::int[])`,
    [input.organizationId, workoutIds]
  );
  if (validWorkouts.rows.length !== workoutIds.length) {
    return { ok: false, error: 'One or more workouts are not available in this organization.' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let templateId = Number(input.templateId ?? 0);
    if (templateId > 0) {
      const owned = await client.query<{ id: number }>(
        `SELECT id FROM schedule_templates WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [templateId, input.organizationId]
      );
      if ((owned.rowCount ?? 0) !== 1) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'Template not found.' };
      }
      await client.query(
        `UPDATE schedule_templates SET name = $1, updated_at = NOW() WHERE id = $2`,
        [name, templateId]
      );
    } else {
      const created = await client.query<{ id: number }>(
        `
          INSERT INTO schedule_templates (organization_id, name, created_by_user_id)
          VALUES ($1, $2, $3)
          RETURNING id
        `,
        [input.organizationId, name, input.userId]
      );
      templateId = Number(created.rows[0].id);
    }

    await client.query(`DELETE FROM schedule_template_days WHERE template_id = $1`, [templateId]);
    for (const day of cleanedDays) {
      const dayResult = await client.query<{ id: number }>(
        `
          INSERT INTO schedule_template_days (template_id, day_offset)
          VALUES ($1, $2)
          RETURNING id
        `,
        [templateId, day.dayOffset]
      );
      const templateDayId = Number(dayResult.rows[0].id);
      let sortOrder = 1;
      for (const item of day.items) {
        await client.query(
          `
            INSERT INTO schedule_template_day_items (
              template_day_id,
              workout_id,
              prescribed_sets,
              prescribed_reps,
              prescribed_load,
              prescribed_notes,
              sort_order
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            templateDayId,
            item.workoutId,
            item.prescribedSets || null,
            item.prescribedReps || null,
            item.prescribedLoad || null,
            item.prescribedNotes || null,
            sortOrder,
          ]
        );
        sortOrder += 1;
      }
    }

    await client.query('COMMIT');
    _invalidateTrainingReadCacheForOrganization(input.organizationId);
    return { ok: true, templateId };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to save template.' };
  } finally {
    client.release();
  }
}

export async function deleteScheduleTemplate(input: {
  organizationId: number;
  templateId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const deleted = await pool.query<{ id: number }>(
    `DELETE FROM schedule_templates WHERE id = $1 AND organization_id = $2 RETURNING id`,
    [input.templateId, input.organizationId]
  );
  if ((deleted.rowCount ?? 0) !== 1) return { ok: false, error: 'Template not found.' };
  _invalidateTrainingReadCacheForOrganization(input.organizationId);
  return { ok: true };
}

export async function applyScheduleTemplateToPlayer(input: {
  organizationId: number;
  userId: number;
  playerId: number;
  templateId: number;
  startDate: string;
  programName?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const date = String(input.startDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'startDate must be YYYY-MM-DD.' };

  const playerCheck = await pool.query<{ id: number }>(
    `SELECT id FROM players WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [input.playerId, input.organizationId]
  );
  if ((playerCheck.rowCount ?? 0) !== 1) {
    return { ok: false, error: 'Player was not found in your organization.' };
  }

  const templateRows = await pool.query<{
    day_offset: number;
    workout_id: number;
    prescribed_sets: string | null;
    prescribed_reps: string | null;
    prescribed_load: string | null;
    prescribed_notes: string | null;
    sort_order: number;
  }>(
    `
      SELECT
        d.day_offset,
        i.workout_id,
        i.prescribed_sets,
        i.prescribed_reps,
        i.prescribed_load,
        i.prescribed_notes,
        i.sort_order
      FROM schedule_templates t
      JOIN schedule_template_days d ON d.template_id = t.id
      JOIN schedule_template_day_items i ON i.template_day_id = d.id
      WHERE t.id = $1
        AND t.organization_id = $2
      ORDER BY d.day_offset ASC, i.sort_order ASC, i.id ASC
    `,
    [input.templateId, input.organizationId]
  );
  if (templateRows.rows.length === 0) return { ok: false, error: 'Template has no workouts to apply.' };

  const programId = await getOrCreateCurrentProgram({
    organizationId: input.organizationId,
    userId: input.userId,
    playerId: input.playerId,
    programName: input.programName,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const byOffset = new Map<number, typeof templateRows.rows>();
    for (const row of templateRows.rows) {
      const offset = Number(row.day_offset ?? 0);
      const list = byOffset.get(offset) ?? [];
      list.push(row);
      byOffset.set(offset, list);
    }

    for (const [offset, rows] of byOffset.entries()) {
      const dayDate = addDaysIso(date, offset);
      const day = await client.query<{ id: number }>(
        `
          INSERT INTO program_days (program_id, day_date)
          VALUES ($1, $2)
          ON CONFLICT (program_id, day_date)
          DO UPDATE SET updated_at = NOW()
          RETURNING id
        `,
        [programId, dayDate]
      );
      const programDayId = Number(day.rows[0].id);
      const orderResult = await client.query<{ next_order: number }>(
        `
          SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
          FROM program_day_items
          WHERE program_day_id = $1
        `,
        [programDayId]
      );
      let nextOrder = Number(orderResult.rows[0].next_order ?? 1);
      for (const row of rows) {
        await client.query(
          `
            INSERT INTO program_day_items (
              program_day_id,
              exercise_id,
              workout_id,
              prescribed_sets,
              prescribed_reps,
              prescribed_load,
              prescribed_notes,
              sort_order
            )
            VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
          `,
          [
            programDayId,
            Number(row.workout_id),
            row.prescribed_sets,
            row.prescribed_reps,
            row.prescribed_load,
            row.prescribed_notes,
            nextOrder,
          ]
        );
        nextOrder += 1;
      }
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to apply template.' };
  } finally {
    client.release();
  }
}

export async function createWorkout(input: {
  organizationId: number;
  userId: number;
  name: string;
  category: string;
  description?: string;
  exerciseItems: Array<{
    exerciseId: number;
    prefix?: string;
    prescribedSets?: string;
    prescribedReps?: string;
    prescribedLoad?: string;
    notes?: string;
  }>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Workout name is required.' };
  const category = input.category.trim();
  if (!category) return { ok: false, error: 'Workout category is required.' };

  const uniqueExerciseIds = Array.from(
    new Set(
      input.exerciseItems
        .map((item) => item.exerciseId)
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
  const validExerciseSet = new Set(uniqueExerciseIds);
  const validItems = input.exerciseItems.filter(
    (item) => Number.isFinite(item.exerciseId) && item.exerciseId > 0 && validExerciseSet.has(item.exerciseId)
  );
  if (uniqueExerciseIds.length > 0) {
    const exerciseCheck = await pool.query<{ id: number }>(
      `
        SELECT id
        FROM exercise_library
        WHERE organization_id = $1 AND id = ANY($2::int[])
      `,
      [input.organizationId, uniqueExerciseIds]
    );

    if (exerciseCheck.rows.length !== uniqueExerciseIds.length) {
      return { ok: false, error: 'One or more exercises were not found in your library.' };
    }
  }

  if (uniqueExerciseIds.length === 0) {
    await pool.query(
      `
        INSERT INTO workout_library (organization_id, name, category, description, created_by)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [input.organizationId, name, category, (input.description ?? '').trim() || null, input.userId]
    );
    _invalidateTrainingReadCacheForOrganization(input.organizationId);
    return { ok: true };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const workout = await client.query<{ id: number }>(
      `
        INSERT INTO workout_library (organization_id, name, category, description, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [input.organizationId, name, category, (input.description ?? '').trim() || null, input.userId]
    );

    if (validItems.length > 0) {
      const workoutId = workout.rows[0].id;
      const exerciseIds: number[] = [];
      const prefixes: Array<string | null> = [];
      const sortOrders: number[] = [];
      const prescribedSets: Array<string | null> = [];
      const prescribedReps: Array<string | null> = [];
      const prescribedLoads: Array<string | null> = [];
      const notes: Array<string | null> = [];

      validItems.forEach((item, index) => {
        exerciseIds.push(item.exerciseId);
        prefixes.push((item.prefix ?? '').trim() || null);
        sortOrders.push(index + 1);
        prescribedSets.push((item.prescribedSets ?? '').trim() || null);
        prescribedReps.push((item.prescribedReps ?? '').trim() || null);
        prescribedLoads.push((item.prescribedLoad ?? '').trim() || null);
        notes.push((item.notes ?? '').trim() || null);
      });

      await client.query(
        `
          INSERT INTO workout_exercises (
            workout_id, exercise_id, exercise_prefix, sort_order, prescribed_sets, prescribed_reps, prescribed_load, notes
          )
          SELECT
            $1::int,
            payload.exercise_id,
            payload.exercise_prefix,
            payload.sort_order,
            payload.prescribed_sets,
            payload.prescribed_reps,
            payload.prescribed_load,
            payload.notes
          FROM UNNEST(
            $2::int[],
            $3::text[],
            $4::int[],
            $5::text[],
            $6::text[],
            $7::text[],
            $8::text[]
          ) AS payload(
            exercise_id,
            exercise_prefix,
            sort_order,
            prescribed_sets,
            prescribed_reps,
            prescribed_load,
            notes
          )
          ORDER BY payload.sort_order
        `,
        [workoutId, exerciseIds, prefixes, sortOrders, prescribedSets, prescribedReps, prescribedLoads, notes]
      );
    }

    await client.query('COMMIT');
    _invalidateTrainingReadCacheForOrganization(input.organizationId);
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to create workout.' };
  } finally {
    client.release();
  }
}

export async function updateWorkout(input: {
  organizationId: number;
  userId: number;
  workoutId: number;
  name: string;
  category: string;
  description?: string;
  exerciseItems: Array<{
    exerciseId: number;
    prefix?: string;
    prescribedSets?: string;
    prescribedReps?: string;
    prescribedLoad?: string;
    notes?: string;
  }>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  void input.userId;

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Workout name is required.' };
  const category = input.category.trim();
  if (!category) return { ok: false, error: 'Workout category is required.' };
  if (!Number.isFinite(input.workoutId) || input.workoutId <= 0) return { ok: false, error: 'Workout ID is required.' };

  const uniqueExerciseIds = Array.from(
    new Set(
      input.exerciseItems
        .map((item) => item.exerciseId)
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
  const validExerciseSet = new Set(uniqueExerciseIds);
  const validItems = input.exerciseItems.filter(
    (item) => Number.isFinite(item.exerciseId) && item.exerciseId > 0 && validExerciseSet.has(item.exerciseId)
  );
  if (uniqueExerciseIds.length > 0) {
    const exerciseCheck = await pool.query<{ id: number }>(
      `
        SELECT id
        FROM exercise_library
        WHERE organization_id = $1 AND id = ANY($2::int[])
      `,
      [input.organizationId, uniqueExerciseIds]
    );
    if (exerciseCheck.rows.length !== uniqueExerciseIds.length) {
      return { ok: false, error: 'One or more exercises were not found in your library.' };
    }
  }

  if (uniqueExerciseIds.length === 0) {
    const updatedWorkout = await pool.query<{ id: number }>(
      `
        UPDATE workout_library
        SET
          name = $1,
          category = $2,
          description = $3,
          updated_at = NOW()
        WHERE id = $4 AND organization_id = $5
        RETURNING id
      `,
      [name, category, (input.description ?? '').trim() || null, input.workoutId, input.organizationId]
    );
    if ((updatedWorkout.rowCount ?? 0) !== 1) {
      return { ok: false, error: 'Workout was not found in your organization.' };
    }
    await pool.query(`DELETE FROM workout_exercises WHERE workout_id = $1`, [input.workoutId]);
    _invalidateTrainingReadCacheForOrganization(input.organizationId);
    return { ok: true };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updatedWorkout = await client.query<{ id: number }>(
      `
        UPDATE workout_library
        SET
          name = $1,
          category = $2,
          description = $3,
          updated_at = NOW()
        WHERE id = $4 AND organization_id = $5
        RETURNING id
      `,
      [name, category, (input.description ?? '').trim() || null, input.workoutId, input.organizationId]
    );

    if ((updatedWorkout.rowCount ?? 0) !== 1) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Workout was not found in your organization.' };
    }

    await client.query(`DELETE FROM workout_exercises WHERE workout_id = $1`, [input.workoutId]);

    if (validItems.length > 0) {
      const exerciseIds: number[] = [];
      const prefixes: Array<string | null> = [];
      const sortOrders: number[] = [];
      const prescribedSets: Array<string | null> = [];
      const prescribedReps: Array<string | null> = [];
      const prescribedLoads: Array<string | null> = [];
      const notes: Array<string | null> = [];

      validItems.forEach((item, index) => {
        exerciseIds.push(item.exerciseId);
        prefixes.push((item.prefix ?? '').trim() || null);
        sortOrders.push(index + 1);
        prescribedSets.push((item.prescribedSets ?? '').trim() || null);
        prescribedReps.push((item.prescribedReps ?? '').trim() || null);
        prescribedLoads.push((item.prescribedLoad ?? '').trim() || null);
        notes.push((item.notes ?? '').trim() || null);
      });

      await client.query(
        `
          INSERT INTO workout_exercises (
            workout_id, exercise_id, exercise_prefix, sort_order, prescribed_sets, prescribed_reps, prescribed_load, notes
          )
          SELECT
            $1::int,
            payload.exercise_id,
            payload.exercise_prefix,
            payload.sort_order,
            payload.prescribed_sets,
            payload.prescribed_reps,
            payload.prescribed_load,
            payload.notes
          FROM UNNEST(
            $2::int[],
            $3::text[],
            $4::int[],
            $5::text[],
            $6::text[],
            $7::text[],
            $8::text[]
          ) AS payload(
            exercise_id,
            exercise_prefix,
            sort_order,
            prescribed_sets,
            prescribed_reps,
            prescribed_load,
            notes
          )
          ORDER BY payload.sort_order
        `,
        [input.workoutId, exerciseIds, prefixes, sortOrders, prescribedSets, prescribedReps, prescribedLoads, notes]
      );
    }

    await client.query('COMMIT');
    _invalidateTrainingReadCacheForOrganization(input.organizationId);
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to update workout.' };
  } finally {
    client.release();
  }
}

async function getOrCreateCurrentProgram(input: {
  organizationId: number;
  playerId: number;
  userId: number;
  programName?: string;
}): Promise<number> {
  const pool = getDbPool();
  const existing = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM programs
      WHERE organization_id = $1
        AND player_id = $2
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)
      ORDER BY start_date DESC
      LIMIT 1
    `,
    [input.organizationId, input.playerId]
  );

  if ((existing.rowCount ?? 0) === 1) return existing.rows[0].id;

  const created = await pool.query<{ id: number }>(
    `
      INSERT INTO programs (organization_id, player_id, name, start_date, end_date, created_by)
      VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + INTERVAL '90 days', $4)
      RETURNING id
    `,
    [input.organizationId, input.playerId, input.programName?.trim() || 'Current Program', input.userId]
  );

  return created.rows[0].id;
}

export async function addProgramItem(input: {
  organizationId: number;
  userId: number;
  playerId: number;
  dayDate: string;
  assignmentType: 'exercise' | 'workout';
  exerciseId?: number;
  workoutId?: number;
  prescribedSets?: string;
  prescribedReps?: string;
  prescribedLoad?: string;
  prescribedNotes?: string;
  programName?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const date = input.dayDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'Date must be YYYY-MM-DD.' };
  }

  const playerCheck = await pool.query<{ id: number }>(
    `SELECT id FROM players WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [input.playerId, input.organizationId]
  );
  if ((playerCheck.rowCount ?? 0) !== 1) {
    return { ok: false, error: 'Player was not found in your organization.' };
  }

  let exerciseId: number | null = null;
  let workoutId: number | null = null;

  if (input.assignmentType === 'exercise') {
    const exId = input.exerciseId ?? 0;
    const exerciseCheck = await pool.query<{ id: number }>(
      `SELECT id FROM exercise_library WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [exId, input.organizationId]
    );
    if ((exerciseCheck.rowCount ?? 0) !== 1) {
      return { ok: false, error: 'Exercise was not found in your organization.' };
    }
    exerciseId = exId;
  } else {
    const wkId = input.workoutId ?? 0;
    const workoutCheck = await pool.query<{ id: number }>(
      `SELECT id FROM workout_library WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [wkId, input.organizationId]
    );
    if ((workoutCheck.rowCount ?? 0) !== 1) {
      return { ok: false, error: 'Workout was not found in your organization.' };
    }
    workoutId = wkId;
  }

  const programId = await getOrCreateCurrentProgram(input);

  const day = await pool.query<{ id: number }>(
    `
      INSERT INTO program_days (program_id, day_date)
      VALUES ($1, $2)
      ON CONFLICT (program_id, day_date)
      DO UPDATE SET updated_at = NOW()
      RETURNING id
    `,
    [programId, date]
  );

  const orderResult = await pool.query<{ next_order: number }>(
    `
      SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
      FROM program_day_items
      WHERE program_day_id = $1
    `,
    [day.rows[0].id]
  );

  await pool.query(
    `
      INSERT INTO program_day_items (
        program_day_id,
        exercise_id,
        workout_id,
        prescribed_sets,
        prescribed_reps,
        prescribed_load,
        prescribed_notes,
        sort_order
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      day.rows[0].id,
      exerciseId,
      workoutId,
      (input.prescribedSets ?? '').trim() || null,
      (input.prescribedReps ?? '').trim() || null,
      (input.prescribedLoad ?? '').trim() || null,
      (input.prescribedNotes ?? '').trim() || null,
      orderResult.rows[0].next_order,
    ]
  );

  return { ok: true };
}

export async function replaceProgramItemsForDates(input: {
  organizationId: number;
  userId: number;
  playerId: number;
  programName?: string;
  dayPlans: Array<{
    dayDate: string;
    items: Array<{
      assignmentType: 'exercise' | 'workout';
      exerciseId?: number;
      workoutId?: number;
      prescribedSets?: string;
      prescribedReps?: string;
      prescribedLoad?: string;
      prescribedNotes?: string;
    }>;
  }>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const playerCheck = await pool.query<{ id: number }>(
    `SELECT id FROM players WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [input.playerId, input.organizationId]
  );
  if ((playerCheck.rowCount ?? 0) !== 1) {
    return { ok: false, error: 'Player was not found in your organization.' };
  }

  const cleanedDayPlans = input.dayPlans
    .map((day) => ({
      dayDate: day.dayDate.trim(),
      items: day.items ?? [],
    }))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.dayDate));

  if (cleanedDayPlans.length === 0) {
    return { ok: false, error: 'At least one valid day is required.' };
  }

  const exerciseIds = Array.from(
    new Set(
      cleanedDayPlans
        .flatMap((day) => day.items)
        .filter((item) => item.assignmentType === 'exercise')
        .map((item) => Number(item.exerciseId ?? 0))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
  const workoutIds = Array.from(
    new Set(
      cleanedDayPlans
        .flatMap((day) => day.items)
        .filter((item) => item.assignmentType === 'workout')
        .map((item) => Number(item.workoutId ?? 0))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  if (exerciseIds.length > 0) {
    const validExercises = await pool.query<{ id: number }>(
      `SELECT id FROM exercise_library WHERE organization_id = $1 AND id = ANY($2::int[])`,
      [input.organizationId, exerciseIds]
    );
    if (validExercises.rows.length !== exerciseIds.length) {
      return { ok: false, error: 'One or more copied exercises are not available in this organization.' };
    }
  }

  if (workoutIds.length > 0) {
    const validWorkouts = await pool.query<{ id: number }>(
      `SELECT id FROM workout_library WHERE organization_id = $1 AND id = ANY($2::int[])`,
      [input.organizationId, workoutIds]
    );
    if (validWorkouts.rows.length !== workoutIds.length) {
      return { ok: false, error: 'One or more copied workouts are not available in this organization.' };
    }
  }

  const programId = await getOrCreateCurrentProgram({
    organizationId: input.organizationId,
    userId: input.userId,
    playerId: input.playerId,
    programName: input.programName,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const dayPlan of cleanedDayPlans) {
      const dayResult = await client.query<{ id: number }>(
        `
          INSERT INTO program_days (program_id, day_date)
          VALUES ($1, $2)
          ON CONFLICT (program_id, day_date)
          DO UPDATE SET updated_at = NOW()
          RETURNING id
        `,
        [programId, dayPlan.dayDate]
      );
      const programDayId = dayResult.rows[0].id;

      await client.query(`DELETE FROM program_day_items WHERE program_day_id = $1`, [programDayId]);

      let sortOrder = 1;
      for (const item of dayPlan.items) {
        const assignmentType = item.assignmentType === 'exercise' ? 'exercise' : 'workout';
        const exerciseIdValue = Number(item.exerciseId ?? 0);
        const workoutIdValue = Number(item.workoutId ?? 0);
        if (assignmentType === 'exercise' && (!Number.isFinite(exerciseIdValue) || exerciseIdValue <= 0)) continue;
        if (assignmentType === 'workout' && (!Number.isFinite(workoutIdValue) || workoutIdValue <= 0)) continue;

        await client.query(
          `
            INSERT INTO program_day_items (
              program_day_id,
              exercise_id,
              workout_id,
              prescribed_sets,
              prescribed_reps,
              prescribed_load,
              prescribed_notes,
              sort_order
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            programDayId,
            assignmentType === 'exercise' ? exerciseIdValue : null,
            assignmentType === 'workout' ? workoutIdValue : null,
            (item.prescribedSets ?? '').trim() || null,
            (item.prescribedReps ?? '').trim() || null,
            (item.prescribedLoad ?? '').trim() || null,
            (item.prescribedNotes ?? '').trim() || null,
            sortOrder,
          ]
        );
        sortOrder += 1;
      }
    }

    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to paste copied schedule.' };
  } finally {
    client.release();
  }
}

export async function listProgramItemsForPlayerByMonth(input: {
  playerId: number;
  month: string;
}): Promise<ProgramItemRow[]> {
  const monthStart = `${input.month}-01`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monthStart)) return [];
  const start = monthStart;
  const year = Number(monthStart.slice(0, 4));
  const monthIndex = Number(monthStart.slice(5, 7)) - 1;
  const next = new Date(Date.UTC(year, monthIndex + 1, 1));
  const nextMonthStart = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return listProgramItemsForPlayerByDateRange({ playerId: input.playerId, startDate: start, endDate: nextMonthStart });
}

export async function listProgramItemsForPlayerByDateRange(input: {
  playerId: number;
  startDate: string;
  endDate: string;
}): Promise<ProgramItemRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) return [];

  const result = await pool.query<{
    item_id: number;
    day_date: string;
    item_type: 'exercise' | 'workout';
    exercise_id: number | null;
    workout_id: number | null;
    workout_category: string | null;
    item_name: string;
    workout_description: string | null;
    exercise_category: string;
    rep_measure: string | null;
    tracking_type: string | null;
    reps_per_side: boolean | null;
    instruction_video_url: string | null;
    exercise_description: string | null;
    exercise_coaching_cues: string | null;
    workout_exercise_names: string | null;
    workout_exercise_json: unknown;
    prescribed_sets: string | null;
    prescribed_reps: string | null;
    prescribed_load: string | null;
    prescribed_notes: string | null;
    completed: boolean | null;
    performed_sets: string | null;
    performed_reps: string | null;
    performed_load: string | null;
    log_notes: string | null;
    program_name: string;
  }>(
    `
      WITH selected_workout_ids AS (
        SELECT DISTINCT i.workout_id
        FROM programs p
        JOIN program_days d ON d.program_id = p.id
        JOIN program_day_items i ON i.program_day_id = d.id
        WHERE p.player_id = $1
          AND d.day_date >= $2::date
          AND d.day_date < $3::date
          AND i.workout_id IS NOT NULL
      ),
      workout_summaries AS (
        SELECT
          sw.workout_id,
          STRING_AGG(
            CASE
              WHEN we2.exercise_prefix IS NOT NULL AND LENGTH(TRIM(we2.exercise_prefix)) > 0
                THEN CONCAT(TRIM(we2.exercise_prefix), ': ', e2.name)
              ELSE e2.name
            END,
            ', '
            ORDER BY we2.sort_order, e2.name
          ) AS exercise_names,
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'exerciseId', e2.id,
                'prefix', we2.exercise_prefix,
                'name', e2.name,
                'category', e2.category,
                'repMeasure', e2.rep_measure,
                'trackingType', e2.tracking_type,
                'repsPerSide', e2.reps_per_side,
                'prescribedSets', we2.prescribed_sets,
                'prescribedReps', we2.prescribed_reps,
                'instructionVideoUrl', e2.instruction_video_url,
                'description', e2.description,
                'coachingCues', e2.coaching_cues
              )
              ORDER BY we2.sort_order, e2.name
            ) FILTER (WHERE e2.id IS NOT NULL),
            '[]'::json
          ) AS exercise_json
        FROM selected_workout_ids sw
        LEFT JOIN workout_exercises we2 ON we2.workout_id = sw.workout_id
        LEFT JOIN exercise_library e2 ON e2.id = we2.exercise_id
        GROUP BY sw.workout_id
      )
      SELECT
        i.id AS item_id,
        d.day_date::text,
        CASE WHEN i.workout_id IS NOT NULL THEN 'workout' ELSE 'exercise' END::text AS item_type,
        i.exercise_id,
        i.workout_id,
        w.category AS workout_category,
        COALESCE(w.name, e.name, 'Assignment') AS item_name,
        w.description AS workout_description,
        CASE WHEN i.workout_id IS NOT NULL THEN 'workout' ELSE COALESCE(e.category, 'exercise') END AS exercise_category,
        COALESCE(e.rep_measure, 'reps') AS rep_measure,
        COALESCE(e.tracking_type, 'lbs') AS tracking_type,
        COALESCE(e.reps_per_side, FALSE) AS reps_per_side,
        e.instruction_video_url,
        e.description AS exercise_description,
        e.coaching_cues AS exercise_coaching_cues,
        ws.exercise_names AS workout_exercise_names,
        ws.exercise_json AS workout_exercise_json,
        i.prescribed_sets,
        i.prescribed_reps,
        i.prescribed_load,
        i.prescribed_notes,
        l.completed,
        l.performed_sets,
        l.performed_reps,
        l.performed_load,
        l.notes AS log_notes,
        p.name AS program_name
      FROM programs p
      JOIN program_days d ON d.program_id = p.id
      JOIN program_day_items i ON i.program_day_id = d.id
      LEFT JOIN exercise_library e ON e.id = i.exercise_id
      LEFT JOIN workout_library w ON w.id = i.workout_id
      LEFT JOIN workout_summaries ws ON ws.workout_id = i.workout_id
      LEFT JOIN exercise_logs l ON l.program_day_item_id = i.id AND l.player_id = p.player_id
      WHERE p.player_id = $1
        AND d.day_date >= $2::date
        AND d.day_date < $3::date
      ORDER BY d.day_date ASC, i.sort_order ASC, i.id ASC
    `,
    [input.playerId, input.startDate, input.endDate]
  );

  return result.rows.map((row) => ({
    // The pg driver returns JSON columns as parsed objects.
    workoutExercises: Array.isArray(row.workout_exercise_json)
      ? (row.workout_exercise_json as WorkoutExerciseAssignment[])
      : [],
    itemId: row.item_id,
    dayDate: row.day_date,
    scheduleType: 'calendar',
    cycleSlot: null,
    itemType: row.item_type === 'workout' ? 'workout' : 'exercise',
    itemName: row.item_name,
    workoutDescription: row.workout_description,
    exerciseId: row.exercise_id,
    workoutId: row.workout_id,
    workoutCategory: row.workout_category,
    exerciseCategory: row.exercise_category,
    repMeasure: row.rep_measure === 'seconds' ? 'seconds' : row.rep_measure === 'distance' ? 'distance' : 'reps',
    trackingType: normalizeTrackingType(row.tracking_type),
    repsPerSide: Boolean(row.reps_per_side),
    exerciseDescription: row.exercise_description,
    exerciseCoachingCues: row.exercise_coaching_cues,
    instructionVideoUrl: row.instruction_video_url,
    workoutExerciseNames: row.workout_exercise_names ? row.workout_exercise_names.split(', ').filter(Boolean) : [],
    prescribedSets: row.prescribed_sets,
    prescribedReps: row.prescribed_reps,
    prescribedLoad: row.prescribed_load,
    prescribedNotes: row.prescribed_notes,
    completed: Boolean(row.completed),
    performedSets: row.performed_sets,
    performedReps: row.performed_reps,
    performedLoad: row.performed_load,
    logNotes: row.log_notes,
    programName: row.program_name,
  }));
}

export async function listCycleProgramItemsForPlayer(input: { playerId: number }): Promise<ProgramItemRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query<{
    item_id: number;
    cycle_slot: 'medium' | 'high' | 'low' | 'mobility' | 's_and_c';
    workout_id: number;
    workout_name: string;
    workout_category: string | null;
    workout_description: string | null;
    workout_exercise_names: string | null;
    workout_exercise_json: unknown;
  }>(
    `
      WITH selected_workout_ids AS (
        SELECT DISTINCT ci.workout_id
        FROM program_cycle_items ci
        WHERE ci.player_id = $1
      ),
      workout_summaries AS (
        SELECT
          sw.workout_id,
          STRING_AGG(
            CASE
              WHEN we2.exercise_prefix IS NOT NULL AND LENGTH(TRIM(we2.exercise_prefix)) > 0
                THEN CONCAT(TRIM(we2.exercise_prefix), ': ', e2.name)
              ELSE e2.name
            END,
            ', '
            ORDER BY we2.sort_order, e2.name
          ) AS exercise_names,
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'exerciseId', e2.id,
                'prefix', we2.exercise_prefix,
                'name', e2.name,
                'category', e2.category,
                'repMeasure', e2.rep_measure,
                'trackingType', e2.tracking_type,
                'repsPerSide', e2.reps_per_side,
                'prescribedSets', we2.prescribed_sets,
                'prescribedReps', we2.prescribed_reps,
                'instructionVideoUrl', e2.instruction_video_url,
                'description', e2.description,
                'coachingCues', e2.coaching_cues
              )
              ORDER BY we2.sort_order, e2.name
            ) FILTER (WHERE e2.id IS NOT NULL),
            '[]'::json
          ) AS exercise_json
        FROM selected_workout_ids sw
        LEFT JOIN workout_exercises we2 ON we2.workout_id = sw.workout_id
        LEFT JOIN exercise_library e2 ON e2.id = we2.exercise_id
        GROUP BY sw.workout_id
      )
      SELECT
        ci.id AS item_id,
        ci.cycle_slot,
        w.id AS workout_id,
        w.name AS workout_name,
        w.category AS workout_category,
        w.description AS workout_description,
        ws.exercise_names AS workout_exercise_names,
        ws.exercise_json AS workout_exercise_json
      FROM program_cycle_items ci
      JOIN workout_library w ON w.id = ci.workout_id
      LEFT JOIN workout_summaries ws ON ws.workout_id = ci.workout_id
      WHERE ci.player_id = $1
      ORDER BY
        CASE ci.cycle_slot
          WHEN 'medium' THEN 1
          WHEN 'high' THEN 2
          WHEN 'low' THEN 3
          WHEN 'mobility' THEN 4
          WHEN 's_and_c' THEN 5
          ELSE 6
        END ASC,
        ci.sort_order ASC,
        ci.id ASC
    `,
    [input.playerId]
  );

  const today = new Date();
  const dayDate = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(
    today.getUTCDate()
  ).padStart(2, '0')}`;

  return result.rows.map((row) => ({
    workoutExercises: Array.isArray(row.workout_exercise_json)
      ? (row.workout_exercise_json as WorkoutExerciseAssignment[])
      : [],
    itemId: row.item_id,
    dayDate,
    scheduleType: 'cycle',
    cycleSlot: row.cycle_slot,
    itemType: 'workout',
    itemName: row.workout_name,
    workoutDescription: row.workout_description,
    exerciseId: null,
    workoutId: row.workout_id,
    workoutCategory: row.workout_category,
    exerciseCategory: 'workout',
    repMeasure: 'reps',
    trackingType: 'lbs',
    repsPerSide: false,
    exerciseDescription: null,
    exerciseCoachingCues: null,
    instructionVideoUrl: null,
    workoutExerciseNames: row.workout_exercise_names ? row.workout_exercise_names.split(', ').filter(Boolean) : [],
    prescribedSets: null,
    prescribedReps: null,
    prescribedLoad: null,
    prescribedNotes: null,
    completed: false,
    performedSets: null,
    performedReps: null,
    performedLoad: null,
    logNotes: null,
    programName: '3-Day Cycle',
  }));
}

export async function addCycleWorkoutAssignment(input: {
  organizationId: number;
  userId: number;
  playerId: number;
  workoutId: number;
  cycleSlot: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const slot = normalizeCycleSlot(input.cycleSlot);
  if (!slot) return { ok: false, error: 'Cycle slot must be medium, high, low, mobility, or s_and_c.' };

  const workout = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM workout_library
      WHERE id = $1 AND organization_id = $2
      LIMIT 1
    `,
    [input.workoutId, input.organizationId]
  );
  if ((workout.rowCount ?? 0) !== 1) return { ok: false, error: 'Workout was not found.' };

  const nextOrder = await pool.query<{ next_order: number }>(
    `
      SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
      FROM program_cycle_items
      WHERE player_id = $1 AND cycle_slot = $2
    `,
    [input.playerId, slot]
  );

  await pool.query(
    `
      INSERT INTO program_cycle_items (
        organization_id, player_id, cycle_slot, workout_id, sort_order, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [input.organizationId, input.playerId, slot, input.workoutId, Number(nextOrder.rows[0]?.next_order ?? 1), input.userId]
  );

  return { ok: true };
}

export async function moveCycleProgramItem(input: {
  organizationId: number;
  playerId: number;
  itemId: number;
  targetSlot: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const slot = normalizeCycleSlot(input.targetSlot);
  if (!slot) return { ok: false, error: 'Cycle slot must be medium, high, low, mobility, or s_and_c.' };
  if (!Number.isFinite(input.itemId) || input.itemId <= 0) return { ok: false, error: 'Valid itemId is required.' };

  const existing = await pool.query<{ id: number; cycle_slot: 'medium' | 'high' | 'low' | 'mobility' | 's_and_c' }>(
    `
      SELECT id, cycle_slot
      FROM program_cycle_items
      WHERE id = $1
        AND organization_id = $2
        AND player_id = $3
      LIMIT 1
    `,
    [input.itemId, input.organizationId, input.playerId]
  );
  if ((existing.rowCount ?? 0) !== 1) return { ok: false, error: 'Cycle item not found.' };
  const sourceSlot = existing.rows[0].cycle_slot;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const nextOrder = await client.query<{ next_order: number }>(
      `
        SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
        FROM program_cycle_items
        WHERE player_id = $1 AND cycle_slot = $2
      `,
      [input.playerId, slot]
    );

    await client.query(
      `
        UPDATE program_cycle_items
        SET cycle_slot = $1,
            sort_order = $2,
            updated_at = NOW()
        WHERE id = $3
      `,
      [slot, Number(nextOrder.rows[0]?.next_order ?? 1), input.itemId]
    );

    await client.query(
      `
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order ASC, id ASC) AS next_order
          FROM program_cycle_items
          WHERE player_id = $1
            AND cycle_slot = $2
        )
        UPDATE program_cycle_items AS i
        SET sort_order = ordered.next_order,
            updated_at = NOW()
        FROM ordered
        WHERE i.id = ordered.id
      `,
      [input.playerId, sourceSlot]
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to move cycle item.' };
  } finally {
    client.release();
  }
}

export async function listExerciseLoadHistoryForPlayer(input: {
  playerId: number;
  exerciseIds: number[];
  beforeDate?: string;
  perExerciseLimit?: number;
}): Promise<Record<number, ExerciseLoadHistoryEntry[]>> {
  const exerciseIds = Array.from(new Set(input.exerciseIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (exerciseIds.length === 0) return {};
  if (!isDatabaseConfigured()) return {};
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const beforeDate = (input.beforeDate ?? '').trim();
  const hasBeforeDate = /^\d{4}-\d{2}-\d{2}$/.test(beforeDate);
  const perExerciseLimit = Math.max(1, Math.min(500, input.perExerciseLimit ?? 100));
  const cacheKey = `exercise_history:${input.playerId}:${hasBeforeDate ? beforeDate : '-'}:${perExerciseLimit}:${exerciseIds.join(',')}`;
  return _withTrainingReadCache(cacheKey, 10_000, async () => {
    const resultMap: Record<number, ExerciseLoadHistoryEntry[]> = {};

    const rows = await pool.query<{
      day_date: string;
      source_name: string;
      exercise_id: number | null;
      prescribed_reps: string | null;
      rep_measure: 'reps' | 'seconds' | 'distance';
      tracking_type: string | null;
      reps_per_side: boolean;
      performed_load: string | null;
      workout_exercise_json: unknown;
    }>(
      `
      WITH history_rows AS (
        SELECT
          COALESCE(d.day_date, h.logged_at::date)::text AS day_date,
          COALESCE(w.name, cw.name, e.name, 'Assignment') AS source_name,
          i.exercise_id,
          i.prescribed_reps,
          COALESCE(e.rep_measure, 'reps') AS rep_measure,
          COALESCE(e.tracking_type, 'lbs') AS tracking_type,
          COALESCE(e.reps_per_side, FALSE) AS reps_per_side,
          h.performed_load,
          CASE
            WHEN h.schedule_type = 'cycle' THEN cws.exercise_json
            ELSE ws.exercise_json
          END AS workout_exercise_json
        FROM exercise_log_history h
        LEFT JOIN program_day_items i ON i.id = h.program_day_item_id
        LEFT JOIN program_days d ON d.id = i.program_day_id
        LEFT JOIN exercise_library e ON e.id = i.exercise_id
        LEFT JOIN workout_library w ON w.id = i.workout_id
        LEFT JOIN program_cycle_items ci ON ci.id = h.cycle_item_id
        LEFT JOIN workout_library cw ON cw.id = ci.workout_id
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              JSON_AGG(
                JSON_BUILD_OBJECT(
                  'exerciseId', e2.id,
                  'prescribedSets', we2.prescribed_sets,
                  'prescribedReps', we2.prescribed_reps,
                  'repMeasure', e2.rep_measure,
                  'trackingType', e2.tracking_type,
                  'repsPerSide', e2.reps_per_side
                )
                ORDER BY we2.sort_order, e2.name
              ),
              '[]'::json
            ) AS exercise_json
          FROM workout_exercises we2
          JOIN exercise_library e2 ON e2.id = we2.exercise_id
          WHERE we2.workout_id = i.workout_id
        ) ws ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              JSON_AGG(
                JSON_BUILD_OBJECT(
                  'exerciseId', e2.id,
                  'prescribedSets', we2.prescribed_sets,
                  'prescribedReps', we2.prescribed_reps,
                  'repMeasure', e2.rep_measure,
                  'trackingType', e2.tracking_type,
                  'repsPerSide', e2.reps_per_side
                )
                ORDER BY we2.sort_order, e2.name
              ),
              '[]'::json
            ) AS exercise_json
          FROM workout_exercises we2
          JOIN exercise_library e2 ON e2.id = we2.exercise_id
          WHERE we2.workout_id = ci.workout_id
        ) cws ON TRUE
        WHERE h.player_id = $1
          AND h.performed_load IS NOT NULL
          AND LENGTH(TRIM(h.performed_load)) > 0
          AND COALESCE(LOWER(w.category), LOWER(cw.category), '') <> 'assessment'
          AND (
            i.exercise_id = ANY($2::int[])
            OR EXISTS (
              SELECT 1
              FROM workout_exercises wx
              WHERE wx.workout_id = i.workout_id
                AND wx.exercise_id = ANY($2::int[])
            )
            OR EXISTS (
              SELECT 1
              FROM workout_exercises wx
              WHERE wx.workout_id = ci.workout_id
                AND wx.exercise_id = ANY($2::int[])
            )
          )
          AND ($3::date IS NULL OR COALESCE(d.day_date, h.logged_at::date) < $3::date)
      ),
      legacy_rows AS (
        SELECT
          d.day_date::text AS day_date,
          COALESCE(w.name, e.name, 'Assignment') AS source_name,
          i.exercise_id,
          i.prescribed_reps,
          COALESCE(e.rep_measure, 'reps') AS rep_measure,
          COALESCE(e.tracking_type, 'lbs') AS tracking_type,
          COALESCE(e.reps_per_side, FALSE) AS reps_per_side,
          l.performed_load,
          ws.exercise_json AS workout_exercise_json
        FROM programs p
        JOIN program_days d ON d.program_id = p.id
        JOIN program_day_items i ON i.program_day_id = d.id
        JOIN exercise_logs l ON l.program_day_item_id = i.id AND l.player_id = p.player_id
        LEFT JOIN exercise_library e ON e.id = i.exercise_id
        LEFT JOIN workout_library w ON w.id = i.workout_id
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              JSON_AGG(
                JSON_BUILD_OBJECT(
                  'exerciseId', e2.id,
                  'prescribedSets', we2.prescribed_sets,
                  'prescribedReps', we2.prescribed_reps,
                  'repMeasure', e2.rep_measure,
                  'trackingType', e2.tracking_type,
                  'repsPerSide', e2.reps_per_side
                )
                ORDER BY we2.sort_order, e2.name
              ),
              '[]'::json
            ) AS exercise_json
          FROM workout_exercises we2
          JOIN exercise_library e2 ON e2.id = we2.exercise_id
          WHERE we2.workout_id = i.workout_id
        ) ws ON TRUE
        WHERE p.player_id = $1
          AND l.performed_load IS NOT NULL
          AND LENGTH(TRIM(l.performed_load)) > 0
          AND COALESCE(LOWER(w.category), '') <> 'assessment'
          AND (
            i.exercise_id = ANY($2::int[])
            OR EXISTS (
              SELECT 1
              FROM workout_exercises wx
              WHERE wx.workout_id = i.workout_id
                AND wx.exercise_id = ANY($2::int[])
            )
          )
          AND ($3::date IS NULL OR d.day_date < $3::date)
          AND NOT EXISTS (
            SELECT 1
            FROM exercise_log_history h
            WHERE h.player_id = p.player_id
              AND h.program_day_item_id = i.id
          )
      )
      SELECT day_date, source_name, exercise_id, prescribed_reps, rep_measure, tracking_type, reps_per_side, performed_load, workout_exercise_json
      FROM history_rows
      UNION ALL
      SELECT day_date, source_name, exercise_id, prescribed_reps, rep_measure, tracking_type, reps_per_side, performed_load, workout_exercise_json
      FROM legacy_rows
      ORDER BY day_date DESC
      LIMIT 500
    `,
      [input.playerId, exerciseIds, hasBeforeDate ? beforeDate : null]
    );

    const limitReached = new Map<number, number>();
    for (const exerciseId of exerciseIds) {
      resultMap[exerciseId] = [];
      limitReached.set(exerciseId, 0);
    }

    for (const row of rows.rows) {
      const rowLoads = parseLoadValues(row.performed_load);
      if (rowLoads.length === 0) continue;

    if (row.exercise_id && exerciseIds.includes(row.exercise_id)) {
      const current = limitReached.get(row.exercise_id) ?? 0;
      if (current < perExerciseLimit) {
        resultMap[row.exercise_id].push({
          dayDate: row.day_date,
          sourceName: row.source_name,
          loads: rowLoads,
          prescribedReps: row.prescribed_reps,
          repMeasure: row.rep_measure === 'seconds' ? 'seconds' : row.rep_measure === 'distance' ? 'distance' : 'reps',
          trackingType: normalizeTrackingType(row.tracking_type),
          repsPerSide: Boolean(row.reps_per_side),
        });
        limitReached.set(row.exercise_id, current + 1);
      }
      continue;
    }

    const workoutExercises = Array.isArray(row.workout_exercise_json)
      ? (row.workout_exercise_json as Array<{
          exerciseId?: number | null;
          prescribedSets?: string | null;
          prescribedReps?: string | null;
          repMeasure?: 'reps' | 'seconds' | 'distance' | null;
          trackingType?: string | null;
          repsPerSide?: boolean | null;
        }>)
      : [];
    if (workoutExercises.length === 0) continue;

    let loadIndex = 0;
    for (const exercise of workoutExercises) {
      const exId = Number(exercise.exerciseId ?? 0);
      const setCount = parseSetCount(exercise.prescribedSets ?? null);
      const exerciseLoads = rowLoads.slice(loadIndex, loadIndex + setCount);
      loadIndex += setCount;
      if (!exerciseIds.includes(exId) || exerciseLoads.length === 0) continue;
      const current = limitReached.get(exId) ?? 0;
      if (current >= perExerciseLimit) continue;
      resultMap[exId].push({
        dayDate: row.day_date,
        sourceName: row.source_name,
        loads: exerciseLoads,
        prescribedReps: exercise.prescribedReps ?? null,
        repMeasure:
          exercise.repMeasure === 'seconds'
            ? 'seconds'
            : exercise.repMeasure === 'distance'
              ? 'distance'
              : 'reps',
        trackingType: normalizeTrackingType(exercise.trackingType),
        repsPerSide: Boolean(exercise.repsPerSide),
      });
      limitReached.set(exId, current + 1);
    }

      if (Array.from(limitReached.values()).every((count) => count >= perExerciseLimit)) break;
    }

    return resultMap;
  });
}

export async function reorderProgramDayItems(input: {
  organizationId: number;
  playerId: number;
  dayDate: string;
  orderedItemIds: number[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const dayDate = input.dayDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) return { ok: false, error: 'Date must be YYYY-MM-DD.' };
  const itemIds = input.orderedItemIds.filter((id) => Number.isFinite(id) && id > 0);
  if (itemIds.length === 0) return { ok: false, error: 'No items to reorder.' };

  const result = await pool.query<{ item_id: number }>(
    `
      SELECT i.id AS item_id
      FROM programs p
      JOIN program_days d ON d.program_id = p.id
      JOIN program_day_items i ON i.program_day_id = d.id
      WHERE p.organization_id = $1
        AND p.player_id = $2
        AND d.day_date = $3::date
      ORDER BY i.sort_order ASC, i.id ASC
    `,
    [input.organizationId, input.playerId, dayDate]
  );

  const existingIds = result.rows.map((row) => row.item_id);
  if (existingIds.length !== itemIds.length) return { ok: false, error: 'Reorder payload does not match day items.' };
  const existingSet = new Set(existingIds);
  if (itemIds.some((id) => !existingSet.has(id))) return { ok: false, error: 'One or more items are invalid for that date.' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let sortOrder = 1;
    for (const itemId of itemIds) {
      await client.query(`UPDATE program_day_items SET sort_order = $1, updated_at = NOW() WHERE id = $2`, [sortOrder, itemId]);
      sortOrder += 1;
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to reorder items.' };
  } finally {
    client.release();
  }
}

export async function moveProgramItemToDate(input: {
  organizationId: number;
  playerId: number;
  itemId: number;
  targetDate: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const date = input.targetDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Date must be YYYY-MM-DD.' };
  if (!Number.isFinite(input.itemId) || input.itemId <= 0) return { ok: false, error: 'Valid itemId is required.' };

  const source = await pool.query<{
    item_id: number;
    source_day_date: string;
    source_program_day_id: number;
    program_id: number;
  }>(
    `
      SELECT
        i.id AS item_id,
        d.day_date::text AS source_day_date,
        d.id AS source_program_day_id,
        p.id AS program_id
      FROM programs p
      JOIN program_days d ON d.program_id = p.id
      JOIN program_day_items i ON i.program_day_id = d.id
      WHERE p.organization_id = $1
        AND p.player_id = $2
        AND i.id = $3
      LIMIT 1
    `,
    [input.organizationId, input.playerId, input.itemId]
  );

  if ((source.rowCount ?? 0) !== 1) return { ok: false, error: 'Schedule item was not found for this player.' };
  const sourceRow = source.rows[0];
  if (sourceRow.source_day_date === date) return { ok: true };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const targetDay = await client.query<{ id: number }>(
      `
        INSERT INTO program_days (program_id, day_date)
        VALUES ($1, $2::date)
        ON CONFLICT (program_id, day_date)
        DO UPDATE SET updated_at = NOW()
        RETURNING id
      `,
      [sourceRow.program_id, date]
    );
    const targetProgramDayId = targetDay.rows[0]?.id;
    if (!targetProgramDayId) throw new Error('Unable to create target day.');

    const orderResult = await client.query<{ next_order: number }>(
      `
        SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
        FROM program_day_items
        WHERE program_day_id = $1
      `,
      [targetProgramDayId]
    );
    const nextOrder = Number(orderResult.rows[0]?.next_order ?? 1);

    await client.query(
      `
        UPDATE program_day_items
        SET program_day_id = $1,
            sort_order = $2,
            updated_at = NOW()
        WHERE id = $3
      `,
      [targetProgramDayId, nextOrder, input.itemId]
    );

    await client.query(
      `
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order ASC, id ASC) AS next_order
          FROM program_day_items
          WHERE program_day_id = $1
        )
        UPDATE program_day_items AS i
        SET sort_order = ordered.next_order,
            updated_at = NOW()
        FROM ordered
        WHERE i.id = ordered.id
      `,
      [sourceRow.source_program_day_id]
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to move schedule item.' };
  } finally {
    client.release();
  }
}

export async function deleteProgramItem(input: {
  organizationId: number;
  playerId: number;
  itemId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  if (!Number.isFinite(input.itemId) || input.itemId <= 0) return { ok: false, error: 'Valid itemId is required.' };

  const deleted = await pool.query<{ id: number }>(
    `
      DELETE FROM program_day_items i
      USING program_days d, programs p
      WHERE i.id = $1
        AND i.program_day_id = d.id
        AND d.program_id = p.id
        AND p.organization_id = $2
        AND p.player_id = $3
      RETURNING i.id
    `,
    [input.itemId, input.organizationId, input.playerId]
  );

  if ((deleted.rowCount ?? 0) !== 1) return { ok: false, error: 'Schedule item not found.' };
  return { ok: true };
}

export async function clearProgramItemsForDate(input: {
  organizationId: number;
  playerId: number;
  dayDate: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const dayDate = input.dayDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) return { ok: false, error: 'Date must be YYYY-MM-DD.' };

  await pool.query(
    `
      DELETE FROM program_day_items i
      USING program_days d, programs p
      WHERE i.program_day_id = d.id
        AND d.program_id = p.id
        AND d.day_date = $1::date
        AND p.organization_id = $2
        AND p.player_id = $3
    `,
    [dayDate, input.organizationId, input.playerId]
  );

  return { ok: true };
}

export async function upsertExerciseLog(input: {
  playerId: number;
  itemId: number;
  scheduleType?: 'calendar' | 'cycle';
  loggedByUserId: number;
  completed: boolean;
  performedSets?: string;
  performedReps?: string;
  performedLoad?: string;
  notes?: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const scheduleType = input.scheduleType === 'cycle' ? 'cycle' : 'calendar';
  const performedSets = (input.performedSets ?? '').trim() || null;
  const performedReps = (input.performedReps ?? '').trim() || null;
  const performedLoad = (input.performedLoad ?? '').trim() || null;
  const notes = (input.notes ?? '').trim() || null;

  if (scheduleType === 'cycle') {
    const allowedItem = await pool.query<{ id: number }>(
      `
        SELECT id
        FROM program_cycle_items
        WHERE id = $1 AND player_id = $2
        LIMIT 1
      `,
      [input.itemId, input.playerId]
    );
    if ((allowedItem.rowCount ?? 0) !== 1) throw new Error('Cycle item not assigned to player.');

    await pool.query(
      `
        INSERT INTO exercise_log_history (
          player_id,
          schedule_type,
          cycle_item_id,
          performed_sets,
          performed_reps,
          performed_load,
          completed,
          notes,
          logged_by_user_id,
          logged_at
        )
        VALUES ($1, 'cycle', $2, $3, $4, $5, $6, $7, $8, NOW())
      `,
      [input.playerId, input.itemId, performedSets, performedReps, performedLoad, input.completed, notes, input.loggedByUserId]
    );
    _invalidateTrainingReadCacheForPlayer(input.playerId);
    return;
  }

  const allowedItem = await pool.query<{ id: number }>(
    `
      SELECT i.id
      FROM program_day_items i
      JOIN program_days d ON d.id = i.program_day_id
      JOIN programs p ON p.id = d.program_id
      WHERE i.id = $1 AND p.player_id = $2
      LIMIT 1
    `,
    [input.itemId, input.playerId]
  );
  if ((allowedItem.rowCount ?? 0) !== 1) throw new Error('Program item not assigned to player.');

  await pool.query(
    `
      INSERT INTO exercise_logs (
        player_id,
        program_day_item_id,
        performed_sets,
        performed_reps,
        performed_load,
        completed,
        notes,
        logged_by_user_id,
        logged_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (player_id, program_day_item_id)
      DO UPDATE SET
        performed_sets = EXCLUDED.performed_sets,
        performed_reps = EXCLUDED.performed_reps,
        performed_load = EXCLUDED.performed_load,
        completed = EXCLUDED.completed,
        notes = EXCLUDED.notes,
        logged_by_user_id = EXCLUDED.logged_by_user_id,
        logged_at = NOW(),
        updated_at = NOW()
    `,
    [input.playerId, input.itemId, performedSets, performedReps, performedLoad, input.completed, notes, input.loggedByUserId]
  );

  await pool.query(
    `
      INSERT INTO exercise_log_history (
        player_id,
        schedule_type,
        program_day_item_id,
        performed_sets,
        performed_reps,
        performed_load,
        completed,
        notes,
        logged_by_user_id,
        logged_at
      )
      VALUES ($1, 'calendar', $2, $3, $4, $5, $6, $7, $8, NOW())
    `,
    [input.playerId, input.itemId, performedSets, performedReps, performedLoad, input.completed, notes, input.loggedByUserId]
  );
  _invalidateTrainingReadCacheForPlayer(input.playerId);
}

export async function getPlayerByIdInOrganization(input: {
  organizationId: number;
  playerId: number;
}): Promise<PlayerProfileRow | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query<{
    id: number;
    full_name: string;
    email: string;
    date_of_birth: string | null;
    school_team: string | null;
    phone: string | null;
    college_commitment: string | null;
    grad_year: string | null;
    position: string | null;
    bats_hand: string | null;
    throws_hand: string | null;
    height: string | null;
    profile_weight_lbs: string | null;
    profile_photo_data_url: string | null;
    assigned_coach_user_id: number | null;
    assigned_coach_name: string | null;
    age_years: string | null;
  }>(
    `
      SELECT
        p.id,
        p.full_name,
        p.email,
        p.date_of_birth::text,
        p.school_team,
        p.phone,
        p.college_commitment,
        p.grad_year,
        p.position,
        p.bats_hand,
        p.throws_hand,
        p.height,
        p.profile_weight_lbs::text,
        p.profile_photo_data_url,
        p.assigned_coach_user_id,
        coach.name AS assigned_coach_name,
        CASE
          WHEN p.date_of_birth IS NULL THEN NULL
          ELSE DATE_PART('year', AGE(CURRENT_DATE, p.date_of_birth))::text
        END AS age_years
      FROM players p
      LEFT JOIN auth_users coach ON coach.id = p.assigned_coach_user_id
      WHERE p.id = $1 AND p.organization_id = $2
      LIMIT 1
    `,
    [input.playerId, input.organizationId]
  );

  if ((result.rowCount ?? 0) !== 1) return null;
  return {
    id: result.rows[0].id,
    fullName: result.rows[0].full_name,
    email: result.rows[0].email,
    dateOfBirth: result.rows[0].date_of_birth,
    schoolTeam: result.rows[0].school_team,
    phone: result.rows[0].phone,
    collegeCommitment: result.rows[0].college_commitment,
    gradYear: result.rows[0].grad_year,
    position: result.rows[0].position,
    batsHand: result.rows[0].bats_hand,
    throwsHand: result.rows[0].throws_hand,
    height: result.rows[0].height,
    profileWeightLbs: result.rows[0].profile_weight_lbs ? Number(result.rows[0].profile_weight_lbs) : null,
    profilePhotoDataUrl: result.rows[0].profile_photo_data_url,
    assignedCoachUserId: result.rows[0].assigned_coach_user_id,
    assignedCoachName: result.rows[0].assigned_coach_name,
    age: result.rows[0].age_years ? Number(result.rows[0].age_years) : null,
  };
}

export async function getPlayerForUser(input: {
  organizationId: number;
  userId: number;
}): Promise<PlayerProfileRow | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query<{
    id: number;
    full_name: string;
    email: string;
    date_of_birth: string | null;
    school_team: string | null;
    phone: string | null;
    college_commitment: string | null;
    grad_year: string | null;
    position: string | null;
    bats_hand: string | null;
    throws_hand: string | null;
    height: string | null;
    profile_weight_lbs: string | null;
    profile_photo_data_url: string | null;
    assigned_coach_user_id: number | null;
    assigned_coach_name: string | null;
    age_years: string | null;
  }>(
    `
      SELECT
        p.id,
        p.full_name,
        p.email,
        p.date_of_birth::text,
        p.school_team,
        p.phone,
        p.college_commitment,
        p.grad_year,
        p.position,
        p.bats_hand,
        p.throws_hand,
        p.height,
        p.profile_weight_lbs::text,
        p.profile_photo_data_url,
        p.assigned_coach_user_id,
        coach.name AS assigned_coach_name,
        CASE
          WHEN p.date_of_birth IS NULL THEN NULL
          ELSE DATE_PART('year', AGE(CURRENT_DATE, p.date_of_birth))::text
        END AS age_years
      FROM players p
      LEFT JOIN auth_users coach ON coach.id = p.assigned_coach_user_id
      WHERE p.organization_id = $1 AND p.user_id = $2
      LIMIT 1
    `,
    [input.organizationId, input.userId]
  );

  if ((result.rowCount ?? 0) !== 1) return null;
  return {
    id: result.rows[0].id,
    fullName: result.rows[0].full_name,
    email: result.rows[0].email,
    dateOfBirth: result.rows[0].date_of_birth,
    schoolTeam: result.rows[0].school_team,
    phone: result.rows[0].phone,
    collegeCommitment: result.rows[0].college_commitment,
    gradYear: result.rows[0].grad_year,
    position: result.rows[0].position,
    batsHand: result.rows[0].bats_hand,
    throwsHand: result.rows[0].throws_hand,
    height: result.rows[0].height,
    profileWeightLbs: result.rows[0].profile_weight_lbs ? Number(result.rows[0].profile_weight_lbs) : null,
    profilePhotoDataUrl: result.rows[0].profile_photo_data_url,
    assignedCoachUserId: result.rows[0].assigned_coach_user_id,
    assignedCoachName: result.rows[0].assigned_coach_name,
    age: result.rows[0].age_years ? Number(result.rows[0].age_years) : null,
  };
}

export async function updatePlayerProfile(input: {
  organizationId: number;
  playerId: number;
  fullName: string;
  email: string;
  assignedCoachUserId?: number | null;
  dateOfBirth?: string;
  schoolTeam?: string;
  phone?: string;
  collegeCommitment?: string;
  gradYear?: string;
  position?: string;
  batsHand?: string;
  throwsHand?: string;
  height?: string;
  profileWeightLbs?: number | null;
  profilePhotoDataUrl?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  if (!fullName || !email) return { ok: false, error: 'Name and email are required.' };
  const height = (input.height ?? '').trim() || null;
  const profileWeightLbs =
    input.profileWeightLbs === null || input.profileWeightLbs === undefined || Number.isNaN(Number(input.profileWeightLbs))
      ? null
      : Number(input.profileWeightLbs);
  const profilePhotoProvided = input.profilePhotoDataUrl !== undefined;
  const profilePhotoDataUrl = (input.profilePhotoDataUrl ?? '').trim() || null;
  if (profilePhotoDataUrl && profilePhotoDataUrl.length > 2_000_000) {
    return { ok: false, error: 'Profile photo is too large. Please upload a smaller image.' };
  }

  const assignedCoachProvided = input.assignedCoachUserId !== undefined;
  let assignedCoachUserId: number | null = null;
  if (assignedCoachProvided && input.assignedCoachUserId && Number.isFinite(Number(input.assignedCoachUserId)) && Number(input.assignedCoachUserId) > 0) {
    assignedCoachUserId = Number(input.assignedCoachUserId);
    const coachResult = await pool.query<{ id: number }>(
      `
        SELECT id
        FROM auth_users
        WHERE id = $1
          AND organization_id = $2
          AND role IN ('admin', 'coach')
        LIMIT 1
      `,
      [assignedCoachUserId, input.organizationId]
    );
    if ((coachResult.rowCount ?? 0) !== 1) {
      return { ok: false, error: 'Assigned coach was not found in your organization.' };
    }
  }

  const updated = await pool.query<{ id: number }>(
    `
      UPDATE players
      SET
        full_name = $1,
        email = $2,
        date_of_birth = $3,
        school_team = $4,
        phone = $5,
        college_commitment = $6,
        grad_year = $7,
        position = $8,
        bats_hand = $9,
        throws_hand = $10,
        height = $11,
        profile_weight_lbs = $12,
        profile_photo_data_url = CASE WHEN $13::boolean THEN $14 ELSE profile_photo_data_url END,
        assigned_coach_user_id = CASE WHEN $15::boolean THEN $16 ELSE assigned_coach_user_id END,
        updated_at = NOW()
      WHERE id = $17 AND organization_id = $18
      RETURNING id
    `,
    [
      fullName,
      email,
      /^\d{4}-\d{2}-\d{2}$/.test((input.dateOfBirth ?? '').trim()) ? input.dateOfBirth?.trim() : null,
      (input.schoolTeam ?? '').trim() || null,
      (input.phone ?? '').trim() || null,
      (input.collegeCommitment ?? '').trim() || null,
      (input.gradYear ?? '').trim() || null,
      (input.position ?? '').trim() || null,
      (input.batsHand ?? '').trim() || null,
      (input.throwsHand ?? '').trim() || null,
      height,
      profileWeightLbs,
      profilePhotoProvided,
      profilePhotoDataUrl,
      assignedCoachProvided,
      assignedCoachUserId,
      input.playerId,
      input.organizationId,
    ]
  );

  if ((updated.rowCount ?? 0) !== 1) return { ok: false, error: 'Player not found in your organization.' };
  _invalidateTrainingReadCacheForOrganization(input.organizationId);
  return { ok: true };
}

export async function listBodyWeightLogsForPlayer(input: { playerId: number; limit?: number }): Promise<BodyWeightLogRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const limit = Math.max(1, Math.min(365, input.limit ?? 120));

  const result = await pool.query<{ log_date: string; weight_lbs: string; notes: string | null }>(
    `
      SELECT log_date::text, weight_lbs::text, notes
      FROM body_weight_logs
      WHERE player_id = $1
      ORDER BY log_date ASC
      LIMIT $2
    `,
    [input.playerId, limit]
  );

  return result.rows.map((row) => ({
    logDate: row.log_date,
    weightLbs: Number(row.weight_lbs),
    notes: row.notes,
  }));
}

export async function listPlayerPlanGoalsForPlayer(input: {
  playerId: number;
  completedLimit?: number;
}): Promise<{ activeGoals: PlayerPlanGoalRow[]; completedGoals: CompletedPlayerPlanGoalRow[] }> {
  if (!isDatabaseConfigured()) {
    return {
      activeGoals: [
        { slotIndex: 1, category: null, goalDescription: null, createdAt: null },
        { slotIndex: 2, category: null, goalDescription: null, createdAt: null },
        { slotIndex: 3, category: null, goalDescription: null, createdAt: null },
      ],
      completedGoals: [],
    };
  }
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const completedLimit = Math.max(1, Math.min(500, input.completedLimit ?? 200));

  const [activeResult, completedResult] = await Promise.all([
    pool.query<{ slot_index: number; category: string; goal_description: string; created_at: string }>(
      `
        SELECT slot_index, category, goal_description, created_at::text
        FROM player_plan_goals
        WHERE player_id = $1
        ORDER BY slot_index ASC
      `,
      [input.playerId]
    ),
    pool.query<{
      id: number;
      slot_index: number;
      category: string;
      goal_description: string;
      completion_details: string | null;
      created_at: string;
      completed_at: string;
    }>(
      `
        SELECT
          id,
          slot_index,
          category,
          goal_description,
          completion_details,
          created_at::text,
          completed_at::text
        FROM completed_player_plan_goals
        WHERE player_id = $1
        ORDER BY completed_at DESC, id DESC
        LIMIT $2
      `,
      [input.playerId, completedLimit]
    ),
  ]);

  const activeBySlot = new Map<number, PlayerPlanGoalRow>();
  for (const row of activeResult.rows) {
    if (row.slot_index < 1 || row.slot_index > 3) continue;
    activeBySlot.set(row.slot_index, {
      slotIndex: row.slot_index as 1 | 2 | 3,
      category: row.category,
      goalDescription: row.goal_description,
      createdAt: row.created_at,
    });
  }

  const activeGoals: PlayerPlanGoalRow[] = [1, 2, 3].map((slot) => {
    const existing = activeBySlot.get(slot);
    return (
      existing ?? {
        slotIndex: slot as 1 | 2 | 3,
        category: null,
        goalDescription: null,
        createdAt: null,
      }
    );
  });

  const completedGoals: CompletedPlayerPlanGoalRow[] = completedResult.rows
    .filter((row) => row.slot_index >= 1 && row.slot_index <= 3)
    .map((row) => ({
      id: row.id,
      slotIndex: row.slot_index as 1 | 2 | 3,
      category: row.category,
      goalDescription: row.goal_description,
      completionDetails: row.completion_details,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));

  return { activeGoals, completedGoals };
}

export async function upsertPlayerPlanGoal(input: {
  organizationId: number;
  playerId: number;
  slotIndex: number;
  category: string;
  goalDescription: string;
  createdByUserId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  if (!Number.isFinite(input.slotIndex) || input.slotIndex < 1 || input.slotIndex > 3) {
    return { ok: false, error: 'slotIndex must be 1, 2, or 3.' };
  }
  const category = input.category.trim();
  const goalDescription = input.goalDescription.trim();
  if (!category) return { ok: false, error: 'Goal category is required.' };
  if (!goalDescription) return { ok: false, error: 'Goal description is required.' };

  const playerCheck = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM players
      WHERE id = $1 AND organization_id = $2
      LIMIT 1
    `,
    [input.playerId, input.organizationId]
  );
  if ((playerCheck.rowCount ?? 0) !== 1) return { ok: false, error: 'Player not found in your organization.' };

  await pool.query(
    `
      INSERT INTO player_plan_goals (
        player_id,
        slot_index,
        category,
        goal_description,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (player_id, slot_index)
      DO UPDATE SET
        category = EXCLUDED.category,
        goal_description = EXCLUDED.goal_description,
        created_by_user_id = EXCLUDED.created_by_user_id,
        updated_at = NOW()
    `,
    [input.playerId, input.slotIndex, category, goalDescription, input.createdByUserId]
  );

  return { ok: true };
}

export async function listPlayerPlanNotesForPlayer(input: {
  playerId: number;
  domain?: 'Pitching' | 'Hitting' | 'Catching' | 'General';
  limit?: number;
}): Promise<PlayerPlanNoteRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const limit = Math.max(1, Math.min(500, input.limit ?? 250));
  const domain = input.domain?.trim();
  const filteredDomain = domain === 'Pitching' || domain === 'Hitting' || domain === 'Catching' ? domain : null;

  const result = await pool.query<{
    id: number;
    player_id: number;
    domain: string;
    note_date: string;
    category: string;
    note_text: string;
    attachment_name: string | null;
    attachment_mime_type: string | null;
    attachment_data_url: string | null;
    created_at: string;
    created_by_user_id: number | null;
  }>(
    `
      SELECT
        id,
        player_id,
        domain,
        note_date::text,
        category,
        note_text,
        attachment_name,
        attachment_mime_type,
        attachment_data_url,
        created_at::text,
        created_by_user_id
      FROM player_plan_notes
      WHERE player_id = $1
        AND ($2::text IS NULL OR domain = $2::text)
      ORDER BY note_date DESC, created_at DESC
      LIMIT $3
    `,
    [input.playerId, filteredDomain, limit]
  );

  return result.rows
    .map((row) => {
      const domainValue =
        row.domain === 'Pitching' || row.domain === 'Hitting' || row.domain === 'Catching' || row.domain === 'General' ? row.domain : null;
      const categoryValue = String(row.category ?? '').trim();
      if (!domainValue || !categoryValue) return null;
      return {
        id: row.id,
        playerId: row.player_id,
        domain: domainValue,
        noteDate: row.note_date,
        category: categoryValue,
        noteText: row.note_text,
        attachmentName: row.attachment_name,
        attachmentMimeType: row.attachment_mime_type,
        attachmentDataUrl: row.attachment_data_url,
        createdAt: row.created_at,
        createdByUserId: row.created_by_user_id,
      } satisfies PlayerPlanNoteRow;
    })
    .filter((row): row is PlayerPlanNoteRow => Boolean(row));
}

export async function createPlayerPlanNote(input: {
  organizationId: number;
  playerId: number;
  domain: 'Pitching' | 'Hitting' | 'Catching' | 'General';
  noteDate: string;
  category: string;
  noteText: string;
  attachmentName?: string;
  attachmentMimeType?: string;
  attachmentDataUrl?: string;
  createdByUserId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.noteDate.trim())) return { ok: false, error: 'Date must be YYYY-MM-DD.' };
  const noteText = input.noteText.trim();
  if (!noteText) return { ok: false, error: 'Note text is required.' };

  const playerCheck = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM players
      WHERE id = $1 AND organization_id = $2
      LIMIT 1
    `,
    [input.playerId, input.organizationId]
  );
  if ((playerCheck.rowCount ?? 0) !== 1) return { ok: false, error: 'Player not found in your organization.' };

  const attachmentDataUrl = String(input.attachmentDataUrl ?? '').trim() || null;
  if (attachmentDataUrl && attachmentDataUrl.length > 9_000_000) {
    return { ok: false, error: 'Attachment is too large.' };
  }

  await pool.query(
    `
      INSERT INTO player_plan_notes (
        player_id,
        domain,
        note_date,
        category,
        note_text,
        attachment_name,
        attachment_mime_type,
        attachment_data_url,
        created_by_user_id
      )
      VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)
    `,
    [
      input.playerId,
      input.domain,
      input.noteDate.trim(),
      input.category,
      noteText,
      String(input.attachmentName ?? '').trim() || null,
      String(input.attachmentMimeType ?? '').trim() || null,
      attachmentDataUrl,
      input.createdByUserId,
    ]
  );

  return { ok: true };
}

export async function listDashboardPlayerNotes(input: {
  organizationId: number;
  dashboardPlayerName: string;
  domain?: 'Pitching' | 'Hitting' | 'Catching' | 'General';
  limit?: number;
}): Promise<DashboardPlayerNoteRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_player_notes (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      dashboard_player_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      note_date DATE NOT NULL,
      category TEXT NOT NULL,
      note_text TEXT NOT NULL,
      attachment_name TEXT,
      attachment_mime_type TEXT,
      attachment_data_url TEXT,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_dashboard_player_notes_org_name_date ON dashboard_player_notes (organization_id, dashboard_player_name, note_date DESC, created_at DESC);`
  );
  const name = input.dashboardPlayerName.trim();
  if (!name) return [];
  const filteredDomain = input.domain && (input.domain === 'Pitching' || input.domain === 'Hitting' || input.domain === 'Catching' || input.domain === 'General')
    ? input.domain
    : null;
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(500, Math.trunc(Number(input.limit)))) : 500;
  const result = await pool.query<{
    id: number;
    organization_id: number;
    dashboard_player_name: string;
    domain: string;
    note_date: string;
    category: string;
    note_text: string;
    attachment_name: string | null;
    attachment_mime_type: string | null;
    attachment_data_url: string | null;
    created_at: string;
    created_by_user_id: number | null;
  }>(
    `
      SELECT
        id,
        organization_id,
        dashboard_player_name,
        domain,
        note_date::text,
        category,
        note_text,
        attachment_name,
        attachment_mime_type,
        attachment_data_url,
        created_at::text,
        created_by_user_id
      FROM dashboard_player_notes
      WHERE organization_id = $1
        AND dashboard_player_name = $2
        AND ($3::text IS NULL OR domain = $3::text)
      ORDER BY note_date DESC, created_at DESC
      LIMIT $4
    `,
    [input.organizationId, name, filteredDomain, limit]
  );

  return result.rows
    .map((row) => {
      const domainValue =
        row.domain === 'Pitching' || row.domain === 'Hitting' || row.domain === 'Catching' || row.domain === 'General' ? row.domain : null;
      const categoryValue = String(row.category ?? '').trim();
      if (!domainValue || !categoryValue) return null;
      return {
        id: row.id,
        organizationId: row.organization_id,
        dashboardPlayerName: row.dashboard_player_name,
        domain: domainValue,
        noteDate: row.note_date,
        category: categoryValue,
        noteText: row.note_text,
        attachmentName: row.attachment_name,
        attachmentMimeType: row.attachment_mime_type,
        attachmentDataUrl: row.attachment_data_url,
        createdAt: row.created_at,
        createdByUserId: row.created_by_user_id,
      } satisfies DashboardPlayerNoteRow;
    })
    .filter((row): row is DashboardPlayerNoteRow => Boolean(row));
}

export async function listDashboardPlayerNotesByOrganization(input: {
  organizationId: number;
  domain?: 'Pitching' | 'Hitting' | 'Catching' | 'General';
  limit?: number;
}): Promise<DashboardPlayerNoteRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_player_notes (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      dashboard_player_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      note_date DATE NOT NULL,
      category TEXT NOT NULL,
      note_text TEXT NOT NULL,
      attachment_name TEXT,
      attachment_mime_type TEXT,
      attachment_data_url TEXT,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_dashboard_player_notes_org_name_date ON dashboard_player_notes (organization_id, dashboard_player_name, note_date DESC, created_at DESC);`
  );
  const filteredDomain = input.domain && (input.domain === 'Pitching' || input.domain === 'Hitting' || input.domain === 'Catching' || input.domain === 'General')
    ? input.domain
    : null;
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(1000, Math.trunc(Number(input.limit)))) : 1000;
  const result = await pool.query<{
    id: number;
    organization_id: number;
    dashboard_player_name: string;
    domain: string;
    note_date: string;
    category: string;
    note_text: string;
    attachment_name: string | null;
    attachment_mime_type: string | null;
    attachment_data_url: string | null;
    created_at: string;
    created_by_user_id: number | null;
  }>(
    `
      SELECT
        id,
        organization_id,
        dashboard_player_name,
        domain,
        note_date::text,
        category,
        note_text,
        attachment_name,
        attachment_mime_type,
        attachment_data_url,
        created_at::text,
        created_by_user_id
      FROM dashboard_player_notes
      WHERE organization_id = $1
        AND ($2::text IS NULL OR domain = $2::text)
      ORDER BY note_date DESC, created_at DESC
      LIMIT $3
    `,
    [input.organizationId, filteredDomain, limit]
  );
  return result.rows
    .map((row) => {
      const domainValue =
        row.domain === 'Pitching' || row.domain === 'Hitting' || row.domain === 'Catching' || row.domain === 'General' ? row.domain : null;
      const categoryValue = String(row.category ?? '').trim();
      if (!domainValue || !categoryValue) return null;
      return {
        id: row.id,
        organizationId: row.organization_id,
        dashboardPlayerName: row.dashboard_player_name,
        domain: domainValue,
        noteDate: row.note_date,
        category: categoryValue,
        noteText: row.note_text,
        attachmentName: row.attachment_name,
        attachmentMimeType: row.attachment_mime_type,
        attachmentDataUrl: row.attachment_data_url,
        createdAt: row.created_at,
        createdByUserId: row.created_by_user_id,
      } satisfies DashboardPlayerNoteRow;
    })
    .filter((row): row is DashboardPlayerNoteRow => Boolean(row));
}

export async function createDashboardPlayerNote(input: {
  organizationId: number;
  dashboardPlayerName: string;
  domain: 'Pitching' | 'Hitting' | 'Catching' | 'General';
  noteDate: string;
  category: string;
  noteText: string;
  attachmentName?: string;
  attachmentMimeType?: string;
  attachmentDataUrl?: string;
  createdByUserId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_player_notes (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      dashboard_player_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      note_date DATE NOT NULL,
      category TEXT NOT NULL,
      note_text TEXT NOT NULL,
      attachment_name TEXT,
      attachment_mime_type TEXT,
      attachment_data_url TEXT,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_dashboard_player_notes_org_name_date ON dashboard_player_notes (organization_id, dashboard_player_name, note_date DESC, created_at DESC);`
  );
  const dashboardPlayerName = input.dashboardPlayerName.trim();
  if (!dashboardPlayerName) return { ok: false, error: 'Player name is required.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.noteDate.trim())) return { ok: false, error: 'Date must be YYYY-MM-DD.' };
  const category = input.category.trim();
  if (!category) return { ok: false, error: 'Category is required.' };
  if (category.length > 80) return { ok: false, error: 'Category must be 80 characters or fewer.' };
  const noteText = input.noteText.trim();
  if (!noteText) return { ok: false, error: 'Note text is required.' };

  const attachmentDataUrl = String(input.attachmentDataUrl ?? '').trim() || null;
  if (attachmentDataUrl && attachmentDataUrl.length > 9_000_000) {
    return { ok: false, error: 'Attachment is too large.' };
  }

  await pool.query(
    `
      INSERT INTO dashboard_player_notes (
        organization_id,
        dashboard_player_name,
        domain,
        note_date,
        category,
        note_text,
        attachment_name,
        attachment_mime_type,
        attachment_data_url,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10)
    `,
    [
      input.organizationId,
      dashboardPlayerName,
      input.domain,
      input.noteDate.trim(),
      category,
      noteText,
      String(input.attachmentName ?? '').trim() || null,
      String(input.attachmentMimeType ?? '').trim() || null,
      attachmentDataUrl,
      input.createdByUserId,
    ]
  );

  return { ok: true };
}

export async function updateDashboardPlayerNote(input: {
  organizationId: number;
  noteId: number;
  noteDate: string;
  category: string;
  noteText: string;
  attachmentName?: string;
  attachmentMimeType?: string;
  attachmentDataUrl?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  if (!Number.isFinite(input.noteId) || input.noteId <= 0) return { ok: false, error: 'Valid noteId is required.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.noteDate ?? '').trim())) return { ok: false, error: 'Date must be YYYY-MM-DD.' };
  const category = String(input.category ?? '').trim();
  if (!category) return { ok: false, error: 'Category is required.' };
  if (category.length > 80) return { ok: false, error: 'Category must be 80 characters or fewer.' };
  const noteText = String(input.noteText ?? '').trim();
  if (!noteText) return { ok: false, error: 'Note text is required.' };
  const attachmentDataUrl = String(input.attachmentDataUrl ?? '').trim() || null;
  if (attachmentDataUrl && attachmentDataUrl.length > 9_000_000) return { ok: false, error: 'Attachment is too large.' };

  const result = await pool.query(
    `
      UPDATE dashboard_player_notes
      SET
        note_date = $1::date,
        category = $2,
        note_text = $3,
        attachment_name = $4,
        attachment_mime_type = $5,
        attachment_data_url = $6,
        updated_at = NOW()
      WHERE id = $7
        AND organization_id = $8
    `,
    [
      String(input.noteDate).trim(),
      category,
      noteText,
      String(input.attachmentName ?? '').trim() || null,
      String(input.attachmentMimeType ?? '').trim() || null,
      attachmentDataUrl,
      input.noteId,
      input.organizationId,
    ]
  );
  if ((result.rowCount ?? 0) < 1) return { ok: false, error: 'Note not found.' };
  return { ok: true };
}

export async function deleteDashboardPlayerNote(input: {
  organizationId: number;
  noteId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  if (!Number.isFinite(input.noteId) || input.noteId <= 0) return { ok: false, error: 'Valid noteId is required.' };
  const result = await pool.query(
    `
      DELETE FROM dashboard_player_notes
      WHERE id = $1
        AND organization_id = $2
    `,
    [input.noteId, input.organizationId]
  );
  if ((result.rowCount ?? 0) < 1) return { ok: false, error: 'Note not found.' };
  return { ok: true };
}

export async function completePlayerPlanGoal(input: {
  organizationId: number;
  playerId: number;
  slotIndex: number;
  completionDetails: string;
  completedByUserId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  if (!Number.isFinite(input.slotIndex) || input.slotIndex < 1 || input.slotIndex > 3) {
    return { ok: false, error: 'slotIndex must be 1, 2, or 3.' };
  }

  const playerCheck = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM players
      WHERE id = $1 AND organization_id = $2
      LIMIT 1
    `,
    [input.playerId, input.organizationId]
  );
  if ((playerCheck.rowCount ?? 0) !== 1) return { ok: false, error: 'Player not found in your organization.' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const activeGoal = await client.query<{
      id: number;
      category: string;
      goal_description: string;
      created_at: string;
    }>(
      `
        SELECT id, category, goal_description, created_at::text
        FROM player_plan_goals
        WHERE player_id = $1
          AND slot_index = $2
        LIMIT 1
      `,
      [input.playerId, input.slotIndex]
    );
    if ((activeGoal.rowCount ?? 0) !== 1) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'No active goal found in that column.' };
    }

    const goal = activeGoal.rows[0];
    await client.query(
      `
        INSERT INTO completed_player_plan_goals (
          player_id,
          slot_index,
          category,
          goal_description,
          completion_details,
          created_at,
          completed_at,
          completed_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz, NOW(), $7)
      `,
      [
        input.playerId,
        input.slotIndex,
        goal.category,
        goal.goal_description,
        input.completionDetails.trim() || null,
        goal.created_at,
        input.completedByUserId,
      ]
    );

    await client.query(
      `
        DELETE FROM player_plan_goals
        WHERE id = $1
      `,
      [goal.id]
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to complete goal.' };
  } finally {
    client.release();
  }
}

export async function upsertBodyWeightLog(input: {
  playerId: number;
  loggedByUserId: number;
  logDate: string;
  weightLbs: number;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.logDate.trim())) return { ok: false, error: 'Date must be YYYY-MM-DD.' };
  if (!Number.isFinite(input.weightLbs) || input.weightLbs <= 0) return { ok: false, error: 'Weight must be positive.' };

  await pool.query(
    `
      INSERT INTO body_weight_logs (player_id, log_date, weight_lbs, notes, created_by_user_id)
      VALUES ($1, $2::date, $3, $4, $5)
      ON CONFLICT (player_id, log_date)
      DO UPDATE SET
        weight_lbs = EXCLUDED.weight_lbs,
        notes = EXCLUDED.notes,
        created_by_user_id = EXCLUDED.created_by_user_id,
        updated_at = NOW()
    `,
    [input.playerId, input.logDate.trim(), input.weightLbs, (input.notes ?? '').trim() || null, input.loggedByUserId]
  );

  return { ok: true };
}

export async function listExerciseTrendForPlayer(input: { playerId: number; exerciseId: number }): Promise<Array<{ dayDate: string; averageLoad: number }>> {
  const history = await listExerciseLoadHistoryForPlayer({
    playerId: input.playerId,
    exerciseIds: [input.exerciseId],
    perExerciseLimit: 100,
  });

  const series = history[input.exerciseId] ?? [];
  return series
    .map((entry) => {
      const numeric = entry.loads.map((value) => Number(value.replace(/[^\d.-]/g, ''))).filter((value) => Number.isFinite(value));
      const averageLoad = numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : 0;
      return { dayDate: entry.dayDate, averageLoad };
    })
    .filter((row) => row.averageLoad > 0)
    .sort((a, b) => a.dayDate.localeCompare(b.dayDate));
}

export async function listTrackedExercisesForPlayer(input: { playerId: number }): Promise<TrackedExerciseRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const cacheKey = `tracked_exercises:${input.playerId}`;
  return _withTrainingReadCache(cacheKey, 20_000, async () => {
    const pool = getDbPool();
    const result = await pool.query<{ exercise_id: number; name: string; category: string; tracking_type: string | null }>(
      `
      WITH history_direct AS (
        SELECT DISTINCT i.exercise_id
        FROM exercise_log_history h
        JOIN program_day_items i ON i.id = h.program_day_item_id
        WHERE h.player_id = $1
          AND i.exercise_id IS NOT NULL
          AND h.performed_load IS NOT NULL
          AND LENGTH(TRIM(h.performed_load)) > 0
      ),
      history_workout_calendar AS (
        SELECT DISTINCT we.exercise_id
        FROM exercise_log_history h
        JOIN program_day_items i ON i.id = h.program_day_item_id
        JOIN workout_exercises we ON we.workout_id = i.workout_id
        JOIN workout_library wl ON wl.id = i.workout_id
        WHERE h.player_id = $1
          AND i.workout_id IS NOT NULL
          AND COALESCE(LOWER(wl.category), '') <> 'assessment'
          AND h.performed_load IS NOT NULL
          AND LENGTH(TRIM(h.performed_load)) > 0
      ),
      history_workout_cycle AS (
        SELECT DISTINCT we.exercise_id
        FROM exercise_log_history h
        JOIN program_cycle_items ci ON ci.id = h.cycle_item_id
        JOIN workout_exercises we ON we.workout_id = ci.workout_id
        JOIN workout_library wl ON wl.id = ci.workout_id
        WHERE h.player_id = $1
          AND COALESCE(LOWER(wl.category), '') <> 'assessment'
          AND h.performed_load IS NOT NULL
          AND LENGTH(TRIM(h.performed_load)) > 0
      ),
      legacy_direct AS (
        SELECT DISTINCT i.exercise_id
        FROM programs p
        JOIN program_days d ON d.program_id = p.id
        JOIN program_day_items i ON i.program_day_id = d.id
        JOIN exercise_logs l ON l.program_day_item_id = i.id AND l.player_id = p.player_id
        WHERE p.player_id = $1
          AND i.exercise_id IS NOT NULL
          AND l.performed_load IS NOT NULL
          AND LENGTH(TRIM(l.performed_load)) > 0
          AND NOT EXISTS (
            SELECT 1 FROM exercise_log_history h WHERE h.player_id = p.player_id AND h.program_day_item_id = i.id
          )
      ),
      legacy_workout AS (
        SELECT DISTINCT we.exercise_id
        FROM programs p
        JOIN program_days d ON d.program_id = p.id
        JOIN program_day_items i ON i.program_day_id = d.id
        JOIN exercise_logs l ON l.program_day_item_id = i.id AND l.player_id = p.player_id
        JOIN workout_exercises we ON we.workout_id = i.workout_id
        JOIN workout_library wl ON wl.id = i.workout_id
        WHERE p.player_id = $1
          AND i.workout_id IS NOT NULL
          AND COALESCE(LOWER(wl.category), '') <> 'assessment'
          AND l.performed_load IS NOT NULL
          AND LENGTH(TRIM(l.performed_load)) > 0
          AND NOT EXISTS (
            SELECT 1 FROM exercise_log_history h WHERE h.player_id = p.player_id AND h.program_day_item_id = i.id
          )
      ),
      all_exercises AS (
        SELECT exercise_id FROM history_direct
        UNION
        SELECT exercise_id FROM history_workout_calendar
        UNION
        SELECT exercise_id FROM history_workout_cycle
        UNION
        SELECT exercise_id FROM legacy_direct
        UNION
        SELECT exercise_id FROM legacy_workout
      )
      SELECT e.id AS exercise_id, e.name, e.category, e.tracking_type
      FROM all_exercises a
      JOIN exercise_library e ON e.id = a.exercise_id
      ORDER BY e.name ASC
      `,
      [input.playerId]
    );

    return result.rows.map((row) => ({
      exerciseId: row.exercise_id,
      name: row.name,
      category: row.category,
      trackingType: normalizeTrackingType(row.tracking_type),
    }));
  });
}

export async function listAssessmentWorkoutScoresForPlayer(input: {
  playerId: number;
  limit?: number;
}): Promise<AssessmentWorkoutScoreRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const limit = Math.max(10, Math.min(500, input.limit ?? 120));

  const result = await pool.query<{
    day_date: string;
    workout_name: string;
    performed_load: string | null;
    log_notes: string | null;
    workout_exercise_json: unknown;
  }>(
    `
      SELECT
        d.day_date::text AS day_date,
        w.name AS workout_name,
        l.performed_load,
        l.notes AS log_notes,
        ws.exercise_json AS workout_exercise_json
      FROM programs p
      JOIN program_days d ON d.program_id = p.id
      JOIN program_day_items i ON i.program_day_id = d.id
      JOIN exercise_logs l ON l.program_day_item_id = i.id AND l.player_id = p.player_id
      JOIN workout_library w ON w.id = i.workout_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'exerciseId', e2.id,
                'exerciseName', e2.name,
                'prefix', we2.exercise_prefix
              )
              ORDER BY we2.sort_order, e2.name
            ),
            '[]'::json
          ) AS exercise_json
        FROM workout_exercises we2
        JOIN exercise_library e2 ON e2.id = we2.exercise_id
        WHERE we2.workout_id = i.workout_id
      ) ws ON TRUE
      WHERE p.player_id = $1
        AND COALESCE(LOWER(w.category), '') = 'assessment'
        AND l.performed_load IS NOT NULL
        AND LENGTH(TRIM(l.performed_load)) > 0
      ORDER BY d.day_date DESC, i.id DESC
      LIMIT $2
    `,
    [input.playerId, limit]
  );

  return result.rows.map((row) => {
    const rawExercises = Array.isArray(row.workout_exercise_json) ? row.workout_exercise_json : [];
    const scoreValues = parseLoadValues(row.performed_load);
    const noteValues = parseAssessmentNotesFromLog(row.log_notes);
    const exerciseScores = rawExercises.map((entry, index) => {
      const mapped =
        entry && typeof entry === 'object'
          ? (entry as { exerciseId?: number; exerciseName?: string; prefix?: string | null })
          : {};
      const rawScore = Number(scoreValues[index] ?? '');
      let score: 1 | 2 | 3 | null = null;
      if (rawScore === 1 || rawScore === 2 || rawScore === 3) score = rawScore;
      return {
        exerciseId: Number.isFinite(Number(mapped.exerciseId)) ? Number(mapped.exerciseId) : null,
        exerciseName: String(mapped.exerciseName ?? `Exercise ${index + 1}`),
        prefix: typeof mapped.prefix === 'string' ? mapped.prefix : null,
        score,
        note: noteValues[index] || null,
      };
    });

    return {
      dayDate: row.day_date,
      workoutName: row.workout_name,
      exerciseScores,
    };
  });
}

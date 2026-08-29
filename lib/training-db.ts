import { createPasswordHash, ensureAuthDbReady, getDbPool, isDatabaseConfigured, listStaffForSchool, verifyPasswordAgainstHash } from './auth-db';
import { NOTE_ATTACHMENT_DATA_URL_MAX_LENGTH } from './note-attachment-limits';
import { resolveHomeDashboardSchoolCode } from './dashboard-home-school';
import type { PortalActivityEventType } from './portal-activity';
const DEFAULT_DASHBOARD_URL = 'https://pitchingcoachu.shinyapps.io/TMdata/';
const DASHBOARD_TRIAL_ORG_PREFIX = 'Dashboard Trial - ';
const DEFAULT_DASHBOARD_TRIAL_TEMPLATE_ORG_ID = 22;
const PCU_TEMPLATE_ORGANIZATION_ID = 1;
const TRIAL_FAKE_FIRST_NAMES = [
  'Mason',
  'Carter',
  'Nolan',
  'Evan',
  'Cole',
  'Logan',
  'Wyatt',
  'Caleb',
  'Parker',
  'Owen',
  'Grant',
  'Reid',
  'Blake',
  'Luke',
  'Tyler',
  'Ryan',
  'Austin',
  'Dylan',
  'Gavin',
  'Chase',
];
const TRIAL_FAKE_LAST_NAMES = [
  'Anderson',
  'Bennett',
  'Carver',
  'Collins',
  'Dawson',
  'Foster',
  'Graham',
  'Hayes',
  'Hudson',
  'Lawson',
  'Miller',
  'Palmer',
  'Reed',
  'Sullivan',
  'Turner',
  'Walker',
  'West',
  'Wright',
  'Young',
  'Brooks',
];

const TRAINING_DB_VERSION = '2026-07-04-player-media';

declare global {
  var __pcuTrainingDbReady: boolean | string | undefined;
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

export type PlayerProfileListRow = PlayerChoiceRow & {
  goals: PlayerPlanGoalRow[];
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
  calendarLinkTarget: CalendarLinkTarget;
  isShared: boolean;
};

export type PlayerProfileRow = {
  id: number;
  fullName: string;
  email: string;
  status: string;
  dateOfBirth: string | null;
  schoolTeam: string | null;
  schoolCode: string | null;
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
  id: number;
  logDate: string;
  weightLbs: number;
  notes: string | null;
  mediaId: number | null;
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
  playerVisible: boolean;
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

export type PlayerMediaRow = {
  id: number;
  organizationId: number;
  playerId: number;
  mediaType: 'photo' | 'video' | 'pdf';
  title: string;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  r2Key: string;
  sourceType: string | null;
  sourceLabel: string | null;
  breakdownAnnotations: unknown[];
  createdAt: string;
  updatedAt: string;
  createdByUserId: number | null;
};

export type PortalActivityUserSummaryRow = {
  userId: number | null;
  email: string;
  name: string | null;
  role: 'admin' | 'coach' | 'player' | 'unknown';
  organizationId: number | null;
  organizationName: string | null;
  playerId: number | null;
  dashboardSchoolCode: string | null;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  lastPath: string | null;
  lastMetadata: Record<string, unknown> | null;
  loginCount30d: number;
  pageViewCount30d: number;
  keyActionCount30d: number;
};

export type PortalActivityRecentEventRow = {
  id: number;
  email: string;
  name: string | null;
  role: 'admin' | 'coach' | 'player' | 'unknown';
  organizationName: string | null;
  eventType: PortalActivityEventType;
  path: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type PortalNotificationRow = {
  id: number;
  eventType: 'note_added' | 'media_uploaded';
  title: string;
  detail: string;
  path: string;
  actorName: string | null;
  actorRole: 'admin' | 'coach' | 'player' | 'unknown';
  playerId: number | null;
  playerName: string | null;
  createdAt: string;
};

export type TrackedExerciseRow = {
  exerciseId: number;
  name: string;
  category: string;
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight' | 'velocity';
};

export type ExerciseCategoryRow = {
  id: number;
  name: string;
};

export type ExerciseRow = {
  id: number;
  sourceOrganizationId: number;
  isShared: boolean;
  name: string;
  category: string;
  repMeasure: 'reps' | 'seconds' | 'distance';
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight' | 'velocity';
  repsPerSide: boolean;
  description: string | null;
  instructionVideoUrl: string | null;
  coachingCues: string | null;
};

export type WorkoutRow = {
  id: number;
  sourceOrganizationId: number;
  isShared: boolean;
  name: string;
  category: string;
  description: string | null;
  calendarLinkTarget: CalendarLinkTarget;
  exerciseCount: number;
  exerciseNames: string[];
};

export type WorkoutEditorItem = {
  exerciseId: number;
  exerciseName: string;
  category: string;
  repMeasure: 'reps' | 'seconds' | 'distance';
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight' | 'velocity';
  repsPerSide: boolean;
  sortOrder: number;
  prefix: string | null;
  prescribedSets: string | null;
  prescribedReps: string | null;
  prescribedLoad: string | null;
  notes: string | null;
};

export type WorkoutDetailRow = {
  id: number;
  sourceOrganizationId: number;
  isShared: boolean;
  name: string;
  category: string;
  description: string | null;
  calendarLinkTarget: CalendarLinkTarget;
  items: WorkoutEditorItem[];
};

export type CalendarLinkTarget = 'none' | 'throwing' | 'bullpens' | 'velocity' | 'drills';

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
  workoutExerciseIndex?: number;
  exerciseId: number | null;
  prefix: string | null;
  name: string;
  category: string;
  repMeasure: 'reps' | 'seconds' | 'distance';
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight' | 'velocity';
  repsPerSide: boolean;
  prescribedSets: string | null;
  prescribedReps: string | null;
  prescribedLoad: string | null;
  notes: string | null;
  templateExerciseId?: number | null;
  templatePrescribedSets?: string | null;
  templatePrescribedReps?: string | null;
  templatePrescribedLoad?: string | null;
  templateNotes?: string | null;
  isCustomized?: boolean;
  instructionVideoUrl: string | null;
  description: string | null;
  coachingCues: string | null;
};

export type WorkoutExerciseOverrideInput = {
  workoutExerciseIndex: number;
  exerciseId: number | null;
  prescribedSets: string | null;
  prescribedReps: string | null;
  prescribedLoad: string | null;
  notes: string | null;
};

export type ProgramPlanSection = 'daily_prep' | 'throwing' | 'post_throw_arm_care' | 's_and_c' | 'movement_mobility';

export type ProgramItemRow = {
  itemId: number;
  dayDate: string;
  scheduleType: 'calendar' | 'cycle' | 'plan';
  cycleSlot: 'medium' | 'high' | 'low' | 'mobility' | 's_and_c' | null;
  planSection: ProgramPlanSection | null;
  targetCount: number | null;
  completedCount: number | null;
  /** When this Plan item was assigned to the player -- coach/admin-only, stripped for player sessions same as targetCount/completedCount. */
  planItemAddedAt: string | null;
  itemType: 'exercise' | 'workout';
  itemName: string;
  workoutDescription: string | null;
  exerciseId: number | null;
  workoutId: number | null;
  workoutCategory: string | null;
  calendarLinkTarget: CalendarLinkTarget;
  exerciseCategory: string;
  instructionVideoUrl: string | null;
  workoutExerciseNames: string[];
  workoutExercises: WorkoutExerciseAssignment[];
  repMeasure: 'reps' | 'seconds' | 'distance';
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight' | 'velocity';
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
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight' | 'velocity';
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

function resolveDashboardTrialTemplateOrganizationId(): number {
  const configured = Number(process.env.DASHBOARD_TRIAL_TEMPLATE_ORG_ID ?? '');
  if (Number.isFinite(configured) && configured > 0) return configured;
  return DEFAULT_DASHBOARD_TRIAL_TEMPLATE_ORG_ID;
}

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
};

function isAuthUsersPrimaryKeyViolation(error: unknown): boolean {
  const typed = error as { code?: string; constraint?: string; message?: string } | null;
  const message = String(typed?.message ?? '').toLowerCase();
  const duplicatesIdValue = message.includes('(id)=') || message.includes(' key (id)=');
  return (
    typed?.code === '23505' &&
    (typed?.constraint === 'idx_auth_users_id_unique' ||
      (typed?.constraint === 'auth_users_pkey' && duplicatesIdValue) ||
      (message.includes('auth_users_pkey') && duplicatesIdValue) ||
      (message.includes('duplicate key') && message.includes('auth_users') && duplicatesIdValue))
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
  if (global.__pcuTrainingDbReady === TRAINING_DB_VERSION) return;
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
    await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS receive_player_note_emails BOOLEAN NOT NULL DEFAULT TRUE;`);
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
    await pool.query(`ALTER TABLE workout_library ADD COLUMN IF NOT EXISTS calendar_link_target TEXT NOT NULL DEFAULT 'none';`);
    await pool.query(`UPDATE workout_library SET calendar_link_target = 'none' WHERE calendar_link_target IS NULL OR LENGTH(TRIM(calendar_link_target)) = 0;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_workout_library_org_name ON workout_library (organization_id, name);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout_sort ON workout_exercises (workout_id, sort_order);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_programs_org ON programs (organization_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_days_program ON program_days (program_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_day_items_exercise ON program_day_items (exercise_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_day_items_workout ON program_day_items (workout_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_organizations_upper_trim_name ON organizations ((UPPER(TRIM(name))));`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_activity_events (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER,
        email TEXT NOT NULL,
        name TEXT,
        role TEXT NOT NULL DEFAULT 'unknown',
        organization_id INTEGER,
        player_id INTEGER,
        dashboard_school_code TEXT,
        event_type TEXT NOT NULL,
        path TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        user_agent TEXT,
        ip_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_activity_events_created ON portal_activity_events (created_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_activity_events_email_created ON portal_activity_events (LOWER(email), created_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_activity_events_type_created ON portal_activity_events (event_type, created_at DESC);`);
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
    // 'organization' matches the pre-existing implicit default (any org
    // member could already see any org-scoped table) -- adding this column
    // must not silently hide anything that was previously visible.
    await pool.query(
      `ALTER TABLE dashboard_custom_tables ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'organization' CHECK (visibility IN ('private', 'organization', 'global'));`
    );
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
      source_type TEXT,
      source_id TEXT,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    await pool.query(`ALTER TABLE player_plan_notes ADD COLUMN IF NOT EXISTS source_type TEXT;`);
    await pool.query(`ALTER TABLE player_plan_notes ADD COLUMN IF NOT EXISTS source_id TEXT;`);
    await pool.query(`ALTER TABLE player_plan_notes ADD COLUMN IF NOT EXISTS player_visible BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_player_plan_notes_player_date ON player_plan_notes (player_id, note_date DESC, created_at DESC);`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_player_plan_notes_source ON player_plan_notes (player_id, source_type, source_id);`);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS player_media (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL DEFAULT 0,
      r2_key TEXT NOT NULL,
      source_type TEXT,
      source_label TEXT,
      breakdown_annotations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    await pool.query(`ALTER TABLE player_media ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General';`);
    await pool.query(`ALTER TABLE player_media ADD COLUMN IF NOT EXISTS source_type TEXT;`);
    await pool.query(`ALTER TABLE player_media ADD COLUMN IF NOT EXISTS source_label TEXT;`);
    await pool.query(`ALTER TABLE player_media ADD COLUMN IF NOT EXISTS breakdown_annotations_json JSONB NOT NULL DEFAULT '[]'::jsonb;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_player_media_player_created ON player_media (player_id, created_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_player_media_org_player_category ON player_media (organization_id, player_id, lower(category));`);
    await pool.query(`ALTER TABLE body_weight_logs ADD COLUMN IF NOT EXISTS media_id BIGINT REFERENCES player_media(id) ON DELETE SET NULL;`);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS note_media (
      id BIGSERIAL PRIMARY KEY,
      note_id BIGINT NOT NULL REFERENCES player_plan_notes(id) ON DELETE CASCADE,
      media_id BIGINT NOT NULL REFERENCES player_media(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_note_media_unique ON note_media (note_id, media_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_note_media_note ON note_media (note_id);`);
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
    await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_throwing_state (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      by_date_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      week_notes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      templates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, player_id)
    );
  `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_schedule_throwing_state_org_player ON schedule_throwing_state (organization_id, player_id);`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bullpen_log_entries (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        template_id TEXT NOT NULL,
        bullpen_date DATE NOT NULL,
        rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, player_id, template_id, bullpen_date)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bullpen_log_entries_player ON bullpen_log_entries (organization_id, player_id, template_id, bullpen_date DESC);`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hitting_log_entries (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        template_id TEXT NOT NULL,
        hitting_date DATE NOT NULL,
        rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, player_id, template_id, hitting_date)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_hitting_log_entries_player ON hitting_log_entries (organization_id, player_id, template_id, hitting_date DESC);`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bubble_category_defs (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        updated_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, label)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bubble_category_defs_org ON bubble_category_defs (organization_id);`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS questionnaires (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        questions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_questionnaires_org_updated ON questionnaires (organization_id, updated_at DESC);`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS questionnaire_assignments (
        id BIGSERIAL PRIMARY KEY,
        questionnaire_id BIGINT NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        group_name TEXT NOT NULL DEFAULT '',
        player_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        notify_start_date DATE NOT NULL DEFAULT CURRENT_DATE,
        frequency TEXT NOT NULL DEFAULT 'once',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_questionnaire_assignments_org_active ON questionnaire_assignments (organization_id, is_active, notify_start_date);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_questionnaire_assignments_questionnaire ON questionnaire_assignments (questionnaire_id);`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS questionnaire_responses (
        id BIGSERIAL PRIMARY KEY,
        questionnaire_id BIGINT NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
        assignment_id BIGINT NOT NULL REFERENCES questionnaire_assignments(id) ON DELETE CASCADE,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        due_date DATE NOT NULL,
        answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (assignment_id, player_id, due_date)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_questionnaire_responses_org_submitted ON questionnaire_responses (organization_id, submitted_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_questionnaire_responses_player_due ON questionnaire_responses (player_id, due_date DESC);`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS program_workout_exercise_overrides (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        workout_id INTEGER NOT NULL REFERENCES workout_library(id) ON DELETE CASCADE,
        program_day_item_id BIGINT NOT NULL REFERENCES program_day_items(id) ON DELETE CASCADE,
        workout_exercise_index INTEGER NOT NULL,
        exercise_id INTEGER REFERENCES exercise_library(id) ON DELETE SET NULL,
        prescribed_sets TEXT,
        prescribed_reps TEXT,
        prescribed_load TEXT,
        notes TEXT,
        updated_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (program_day_item_id, workout_exercise_index)
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_program_workout_exercise_overrides_player_workout_updated
       ON program_workout_exercise_overrides (organization_id, player_id, workout_id, updated_at DESC);`
    );
    // Same shape as program_workout_exercise_overrides but keyed to a
    // Training Program (plan) item instead of a calendar day item -- plan
    // items aren't date-scoped, so they can't share the calendar table's
    // program_day_item_id FK. A parallel table (rather than nullable sibling
    // FK columns on one shared table) avoids partial-unique-index/ON
    // CONFLICT-target complexity for what is otherwise a one-row-per-slot override.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS program_plan_item_exercise_overrides (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        workout_id INTEGER NOT NULL REFERENCES workout_library(id) ON DELETE CASCADE,
        program_plan_item_id INTEGER NOT NULL REFERENCES program_plan_items(id) ON DELETE CASCADE,
        workout_exercise_index INTEGER NOT NULL,
        exercise_id INTEGER REFERENCES exercise_library(id) ON DELETE SET NULL,
        prescribed_sets TEXT,
        prescribed_reps TEXT,
        prescribed_load TEXT,
        notes TEXT,
        updated_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (program_plan_item_id, workout_exercise_index)
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_program_plan_item_exercise_overrides_player_workout_updated
       ON program_plan_item_exercise_overrides (organization_id, player_id, workout_id, updated_at DESC);`
    );
    global.__pcuTrainingDbReady = TRAINING_DB_VERSION;
  })().finally(() => {
    global.__pcuTrainingDbReadyPromise = undefined;
  });

  await global.__pcuTrainingDbReadyPromise;
}

async function ensureWorkoutLibraryCalendarLinkTargetColumn(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  await pool.query(`ALTER TABLE workout_library ADD COLUMN IF NOT EXISTS calendar_link_target TEXT NOT NULL DEFAULT 'none';`);
  await pool.query(`UPDATE workout_library SET calendar_link_target = 'none' WHERE calendar_link_target IS NULL OR LENGTH(TRIM(calendar_link_target)) = 0;`);
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

function normalizeTrackingType(value: string | null | undefined): 'lbs' | 'seconds' | 'inches' | 'body_weight' | 'velocity' {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'seconds') return 'seconds';
  if (normalized === 'inches') return 'inches';
  if (normalized === 'body_weight' || normalized === 'body weight' || normalized === 'bodyweight') return 'body_weight';
  if (normalized === 'velocity') return 'velocity';
  return 'lbs';
}

function normalizeCalendarLinkTarget(value: string | null | undefined): CalendarLinkTarget {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[‐‑‒–—−-]+/g, '_')
    .replace(/\s+/g, '_');
  if (normalized === 'throwing' || normalized === 'throwing_calendar') return 'throwing';
  if (normalized === 'bullpen' || normalized === 'bullpens') return 'bullpens';
  if (normalized === 'velocity' || normalized === 'velocity_plan') return 'velocity';
  if (normalized === 'drill' || normalized === 'drills') return 'drills';
  return 'none';
}

function normalizeCycleSlot(value: string): 'medium' | 'high' | 'low' | 'mobility' | 's_and_c' | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'medium' || normalized === 'high' || normalized === 'low' || normalized === 'mobility') return normalized;
  if (normalized === 's&c' || normalized === 's_and_c' || normalized === 's-c' || normalized === 'sc') return 's_and_c';
  return null;
}

const PLAN_SECTIONS = ['daily_prep', 'throwing', 'post_throw_arm_care', 's_and_c', 'movement_mobility'] as const;

export function normalizePlanSection(value: string): ProgramPlanSection | null {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const match = PLAN_SECTIONS.find((section) => section === normalized);
  return match ?? null;
}

const TRAINING_PROGRAM_SECTION_LABELS: Record<ProgramPlanSection, string> = {
  daily_prep: 'Daily Prep',
  throwing: 'Throwing',
  post_throw_arm_care: 'Post-Throw Arm Care',
  s_and_c: 'S&C',
  movement_mobility: 'Movement and Mobility',
};

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

function cleanOverrideText(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function copyLatestWorkoutExerciseOverridesForNewItem(input: {
  db: Queryable;
  organizationId: number;
  playerId: number;
  workoutId: number;
  programDayItemId: number;
  userId: number | null;
}): Promise<void> {
  await input.db.query(
    `
      INSERT INTO program_workout_exercise_overrides (
        organization_id,
        player_id,
        workout_id,
        program_day_item_id,
        workout_exercise_index,
        exercise_id,
        prescribed_sets,
        prescribed_reps,
        prescribed_load,
        notes,
        updated_by_user_id,
        updated_at
      )
      SELECT
        $1,
        $2,
        $3,
        $4,
        latest.workout_exercise_index,
        latest.exercise_id,
        latest.prescribed_sets,
        latest.prescribed_reps,
        latest.prescribed_load,
        latest.notes,
        $5,
        NOW()
      FROM (
        SELECT DISTINCT ON (workout_exercise_index)
          workout_exercise_index,
          exercise_id,
          prescribed_sets,
          prescribed_reps,
          prescribed_load,
          notes,
          updated_at
        FROM program_workout_exercise_overrides
        WHERE organization_id = $1
          AND player_id = $2
          AND workout_id = $3
          AND program_day_item_id <> $4
        ORDER BY workout_exercise_index, updated_at DESC, id DESC
      ) latest
      ON CONFLICT (program_day_item_id, workout_exercise_index)
      DO NOTHING
    `,
    [input.organizationId, input.playerId, input.workoutId, input.programDayItemId, input.userId]
  );
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
    ...(org === PCU_TEMPLATE_ORGANIZATION_ID
      ? ['exercise_count:', 'workout_count:', 'workout_choices:']
      : []),
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
        ORDER BY
          CASE WHEN LOWER(COALESCE(NULLIF(TRIM(p.status), ''), 'active')) = 'inactive' THEN 1 ELSE 0 END ASC,
          p.full_name ASC
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

export async function getUserEmailPreferences(userId: number): Promise<{ receivePlayerNoteEmails: boolean } | null> {
  if (!isDatabaseConfigured() || !Number.isFinite(userId) || userId <= 0) return null;
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ receive_player_note_emails: boolean }>(
    `SELECT receive_player_note_emails FROM auth_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { receivePlayerNoteEmails: row.receive_player_note_emails !== false };
}

export async function setUserReceivePlayerNoteEmails(input: {
  userId: number;
  receivePlayerNoteEmails: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'Database is not configured.' };
  if (!Number.isFinite(input.userId) || input.userId <= 0) return { ok: false, error: 'Invalid user.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  await pool.query(
    `UPDATE auth_users SET receive_player_note_emails = $2 WHERE id = $1`,
    [input.userId, input.receivePlayerNoteEmails]
  );
  return { ok: true };
}

export type DailyPlayerNoteDigestEntry = {
  playerName: string;
  domain: string;
  noteDate: string;
  category: string;
  noteText: string;
  attachmentName: string | null;
  attachmentMimeType: string | null;
  attachmentDataUrl: string | null;
  createdAt: string;
  authorName: string;
};

export type DailyPlayerNoteDigestOrg = {
  organizationId: number;
  schoolCode: string;
  entries: DailyPlayerNoteDigestEntry[];
  recipients: Array<{ email: string; name: string }>;
};

// Powers the daily player-notes email cron: for every organization that has
// at least one note created inside [startIso, endIso), returns the notes
// (grouped, with author names resolved) and the opted-in admin/coach
// recipients for that org. Organizations with zero notes in the window are
// simply absent from the result, so the caller never has to special-case
// "nothing to send" -- an empty list already means that.
export async function listDailyPlayerNoteDigests(input: {
  startIso: string;
  endIso: string;
}): Promise<DailyPlayerNoteDigestOrg[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const notesResult = await pool.query<{
    organization_id: number;
    player_name: string;
    domain: string;
    note_date: string;
    category: string;
    note_text: string;
    attachment_name: string | null;
    attachment_mime_type: string | null;
    attachment_data_url: string | null;
    created_at: string;
    author_name: string | null;
    author_email: string | null;
  }>(
    `
      SELECT
        p.organization_id,
        p.full_name AS player_name,
        n.domain,
        n.note_date::text,
        n.category,
        n.note_text,
        n.attachment_name,
        n.attachment_mime_type,
        n.attachment_data_url,
        n.created_at::text,
        u.name AS author_name,
        u.email AS author_email
      FROM player_plan_notes n
      JOIN players p ON p.id = n.player_id
      LEFT JOIN auth_users u ON u.id = n.created_by_user_id
      WHERE n.created_at >= $1::timestamptz AND n.created_at < $2::timestamptz

      UNION ALL

      SELECT
        n.organization_id,
        n.dashboard_player_name AS player_name,
        n.domain,
        n.note_date::text,
        n.category,
        n.note_text,
        n.attachment_name,
        n.attachment_mime_type,
        n.attachment_data_url,
        n.created_at::text,
        u.name AS author_name,
        u.email AS author_email
      FROM dashboard_player_notes n
      LEFT JOIN auth_users u ON u.id = n.created_by_user_id
      WHERE n.created_at >= $1::timestamptz AND n.created_at < $2::timestamptz

      ORDER BY organization_id, player_name, note_date DESC, created_at DESC
    `,
    [input.startIso, input.endIso]
  );

  if (!notesResult.rows.length) return [];

  const orgIds = Array.from(new Set(notesResult.rows.map((row) => row.organization_id)));

  const recipientsResult = await pool.query<{
    organization_id: number;
    email: string;
    name: string | null;
  }>(
    `
      SELECT organization_id, email, name
      FROM auth_users
      WHERE organization_id = ANY($1::int[])
        AND role IN ('admin', 'coach')
        AND is_active IS NOT FALSE
        AND receive_player_note_emails IS NOT FALSE
    `,
    [orgIds]
  );

  // Every admin/coach in the org (opted in or not) is used to infer the
  // org's school code -- opting out of emails shouldn't also blank out the
  // signal used to resolve the subject line for people who stayed opted in.
  const allOrgUsersResult = await pool.query<{ organization_id: number; email: string }>(
    `
      SELECT organization_id, email
      FROM auth_users
      WHERE organization_id = ANY($1::int[])
        AND role IN ('admin', 'coach')
      ORDER BY organization_id, CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id
    `,
    [orgIds]
  );
  // There's no per-user school-code column in the schema -- the same
  // resolution the login flow uses (DASHBOARD_ORG_SCHOOL_MAP env var, or a
  // hardcoded global-admin email list, or a default fallback) is reused here
  // via resolveHomeDashboardSchoolCode so the subject line matches what that
  // org's own dashboard actually resolves to.
  const representativeEmailByOrg = new Map<number, string>();
  for (const row of allOrgUsersResult.rows) {
    if (!representativeEmailByOrg.has(row.organization_id)) {
      representativeEmailByOrg.set(row.organization_id, row.email);
    }
  }
  const resolveSchoolCode = (organizationId: number): string => {
    const email = representativeEmailByOrg.get(organizationId) ?? null;
    return (
      resolveHomeDashboardSchoolCode({ email, organizationId }) ?? `ORG-${organizationId}`
    );
  };

  const recipientsByOrg = new Map<number, Array<{ email: string; name: string }>>();
  for (const row of recipientsResult.rows) {
    const list = recipientsByOrg.get(row.organization_id) ?? [];
    list.push({ email: row.email, name: (row.name ?? '').trim() || row.email });
    recipientsByOrg.set(row.organization_id, list);
  }

  const entriesByOrg = new Map<number, DailyPlayerNoteDigestEntry[]>();
  for (const row of notesResult.rows) {
    const domain = String(row.domain ?? '').trim();
    const list = entriesByOrg.get(row.organization_id) ?? [];
    list.push({
      playerName: row.player_name,
      domain,
      noteDate: row.note_date,
      category: row.category,
      noteText: row.note_text,
      attachmentName: row.attachment_name,
      attachmentMimeType: row.attachment_mime_type,
      attachmentDataUrl: row.attachment_data_url,
      createdAt: row.created_at,
      authorName: (row.author_name ?? '').trim() || row.author_email || 'Unknown',
    });
    entriesByOrg.set(row.organization_id, list);
  }

  return orgIds
    .map((organizationId) => ({
      organizationId,
      schoolCode: resolveSchoolCode(organizationId),
      entries: entriesByOrg.get(organizationId) ?? [],
      recipients: recipientsByOrg.get(organizationId) ?? [],
    }))
    .filter((org) => org.entries.length > 0 && org.recipients.length > 0);
}

export async function listDashboardTrialCoaches(): Promise<CoachRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
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
      JOIN organizations o ON o.id = u.organization_id
      LEFT JOIN players p ON p.assigned_coach_user_id = u.id
      WHERE u.role IN ('admin', 'coach')
        AND LOWER(TRIM(o.name)) LIKE LOWER($1)
      GROUP BY u.id, u.name, u.email, u.phone, u.role, u.is_active
      ORDER BY COALESCE(u.name, u.email) ASC
    `,
    [`${DASHBOARD_TRIAL_ORG_PREFIX}%`]
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

export async function listDashboardTrialCoachAssignedPlayers(): Promise<CoachAssignedPlayerRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{
    player_id: number;
    full_name: string;
    email: string;
    status: string;
    assigned_coach_user_id: number | null;
  }>(
    `
      SELECT p.id AS player_id, p.full_name, p.email, p.status, p.assigned_coach_user_id
      FROM players p
      JOIN organizations o ON o.id = p.organization_id
      WHERE LOWER(TRIM(o.name)) LIKE LOWER($1)
      ORDER BY p.full_name ASC
    `,
    [`${DASHBOARD_TRIAL_ORG_PREFIX}%`]
  );
  return result.rows.map((row) => ({
    playerId: row.player_id,
    fullName: row.full_name,
    email: row.email,
    status: row.status,
    assignedCoachUserId: row.assigned_coach_user_id,
  }));
}

export async function resolveDashboardTrialOrganizationIdForStaffUser(staffUserId: number): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ organization_id: number | null }>(
    `
      SELECT u.organization_id
      FROM auth_users u
      JOIN organizations o ON o.id = u.organization_id
      WHERE u.id = $1
        AND u.role IN ('admin', 'coach')
        AND LOWER(TRIM(o.name)) LIKE LOWER($2)
      LIMIT 1
    `,
    [staffUserId, `${DASHBOARD_TRIAL_ORG_PREFIX}%`]
  );
  return Number(result.rows[0]?.organization_id ?? 0) || 0;
}

export async function listPlayerChoicesByOrganization(input: {
  organizationId: number;
  assignedCoachUserId?: number | null;
  activeOnly?: boolean;
}): Promise<PlayerChoiceRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const assignedCoachUserId = Number(input.assignedCoachUserId ?? 0);
  const useCoachFilter = Number.isFinite(assignedCoachUserId) && assignedCoachUserId > 0;
  const activeOnly = input.activeOnly === true;
  const cacheKey = `player_choices:${input.organizationId}:${useCoachFilter ? assignedCoachUserId : 0}:${activeOnly ? 1 : 0}`;
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
        ${activeOnly ? "AND LOWER(COALESCE(NULLIF(TRIM(p.status), ''), 'active')) = 'active'" : ''}
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

export async function listPlayerProfilesWithPlanGoals(input: {
  organizationId: number;
  assignedCoachUserId?: number | null;
}): Promise<PlayerProfileListRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const assignedCoachUserId = Number(input.assignedCoachUserId ?? 0);
  const useCoachFilter = Number.isFinite(assignedCoachUserId) && assignedCoachUserId > 0;
  const cacheKey = `player_profiles_goals:${input.organizationId}:${useCoachFilter ? assignedCoachUserId : 0}`;
  return _withTrainingReadCache(cacheKey, 20_000, async () => {
    const pool = getDbPool();
    const result = await pool.query<{
      player_id: number;
      full_name: string;
      assigned_coach_user_id: number | null;
      slot_index: number | null;
      category: string | null;
      goal_description: string | null;
      created_at: string | null;
    }>(
      `
        SELECT
          p.id AS player_id,
          p.full_name,
          p.assigned_coach_user_id,
          g.slot_index,
          g.category,
          g.goal_description,
          g.created_at::text
        FROM players p
        LEFT JOIN player_plan_goals g
          ON g.player_id = p.id
          AND g.slot_index BETWEEN 1 AND 3
        WHERE p.organization_id = $1
        AND LOWER(COALESCE(NULLIF(TRIM(p.status), ''), 'active')) = 'active'
        ${useCoachFilter ? 'AND p.assigned_coach_user_id = $2' : ''}
        ORDER BY p.full_name ASC, g.slot_index ASC
      `,
      useCoachFilter ? [input.organizationId, assignedCoachUserId] : [input.organizationId]
    );

    const byPlayer = new Map<number, PlayerProfileListRow>();
    for (const row of result.rows) {
      let player = byPlayer.get(row.player_id);
      if (!player) {
        player = {
          playerId: row.player_id,
          fullName: row.full_name,
          assignedCoachUserId: row.assigned_coach_user_id,
          goals: [],
        };
        byPlayer.set(row.player_id, player);
      }
      if (row.slot_index && row.slot_index >= 1 && row.slot_index <= 3) {
        player.goals.push({
          slotIndex: row.slot_index as 1 | 2 | 3,
          category: row.category,
          goalDescription: row.goal_description,
          createdAt: row.created_at,
        });
      }
    }

    return Array.from(byPlayer.values());
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

export type PlayerGroupRow = {
  id: number;
  name: string;
  memberCount: number;
  createdAt: string;
};

export type PlayerGroupWithMembersRow = {
  id: number;
  name: string;
  members: PlayerSummaryRow[];
};

// Groups are intentionally never exposed to the player role -- coaches/admins
// only, enforced at the API layer (no /api/player/groups route exists at
// all), matching the player_plan_notes.player_visible pattern used elsewhere
// for coach-authored, player-hidden content.
export async function listPlayerGroups(input: { organizationId: number }): Promise<PlayerGroupRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ id: number; name: string; member_count: string; created_at: string }>(
    `
      SELECT g.id, g.name, COUNT(m.player_id)::text AS member_count, g.created_at::text
      FROM player_groups g
      LEFT JOIN player_group_members m ON m.group_id = g.id
      WHERE g.organization_id = $1
      GROUP BY g.id, g.name, g.created_at
      ORDER BY g.name ASC
    `,
    [input.organizationId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    memberCount: Number(row.member_count),
    createdAt: row.created_at,
  }));
}

export async function getPlayerGroupWithMembers(input: {
  organizationId: number;
  groupId: number;
}): Promise<PlayerGroupWithMembersRow | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const groupResult = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM player_groups WHERE id = $1 AND organization_id = $2`,
    [input.groupId, input.organizationId]
  );
  const group = groupResult.rows[0];
  if (!group) return null;
  const membersResult = await pool.query<{
    player_id: number;
    full_name: string;
    assigned_coach_user_id: number | null;
    throws_hand: string | null;
    bats_hand: string | null;
    position: string | null;
  }>(
    `
      SELECT p.id AS player_id, p.full_name, p.assigned_coach_user_id, p.throws_hand, p.bats_hand, p.position
      FROM player_group_members m
      JOIN players p ON p.id = m.player_id
      WHERE m.group_id = $1
      ORDER BY p.full_name ASC
    `,
    [input.groupId]
  );
  return {
    id: group.id,
    name: group.name,
    members: membersResult.rows.map((row) => ({
      playerId: row.player_id,
      fullName: row.full_name,
      assignedCoachUserId: row.assigned_coach_user_id,
      throwsHand: row.throws_hand,
      batsHand: row.bats_hand,
      position: row.position,
    })),
  };
}

/** Player ids for a group, scoped to the organization -- the fan-out source
 * for "apply this workout to the whole group" actions. Returns [] (not an
 * error) for a group id that doesn't belong to this organization, so callers
 * that build an assignment list can safely treat it as "no members." */
export async function listPlayerIdsForGroup(input: { organizationId: number; groupId: number }): Promise<number[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ player_id: number }>(
    `
      SELECT m.player_id
      FROM player_group_members m
      JOIN player_groups g ON g.id = m.group_id
      WHERE m.group_id = $1 AND g.organization_id = $2
    `,
    [input.groupId, input.organizationId]
  );
  return result.rows.map((row) => row.player_id);
}

export type GroupWorkoutAssignmentTarget = {
  organizationId: number;
  groupId: number;
  workoutId: number;
} & ({ scheduleType: 'calendar'; dayDate: string } | { scheduleType: 'plan'; planSection: string } | { scheduleType: 'cycle'; cycleSlot: string });

export type GroupWorkoutAssignmentMatch = {
  playerId: number;
  playerName: string;
  itemId: number;
};

// Finds every CURRENT group member's item for this workout on this day/
// section/slot -- there is no persisted link back to a specific group-assign
// action (program_day_items/program_plan_items/program_cycle_items don't
// store a groupId), so this re-derives the target set by matching group
// membership x workout x day/section/slot instead. That means it can miss a
// player removed from the group since the original assignment, or sweep up
// a matching item assigned some other way (e.g. manually, outside the group
// flow) -- deliberately accepted per the "match-based delete" design so the
// UI can show exactly what it found before the caller confirms.
export async function previewGroupWorkoutAssignmentMatches(
  target: GroupWorkoutAssignmentTarget
): Promise<GroupWorkoutAssignmentMatch[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();

  if (target.scheduleType === 'calendar') {
    const dayDate = target.dayDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) return [];
    const result = await pool.query<{ player_id: number; player_name: string; item_id: number }>(
      `
        SELECT p.player_id, pl.full_name AS player_name, i.id AS item_id
        FROM player_group_members m
        JOIN player_groups g ON g.id = m.group_id
        JOIN players pl ON pl.id = m.player_id
        JOIN programs p ON p.player_id = m.player_id AND p.organization_id = g.organization_id
        JOIN program_days d ON d.program_id = p.id AND d.day_date = $4::date
        JOIN program_day_items i ON i.program_day_id = d.id AND i.workout_id = $3
        WHERE m.group_id = $1 AND g.organization_id = $2
      `,
      [target.groupId, target.organizationId, target.workoutId, dayDate]
    );
    return result.rows.map((row) => ({ playerId: row.player_id, playerName: row.player_name, itemId: row.item_id }));
  }

  if (target.scheduleType === 'plan') {
    const planSection = normalizePlanSection(target.planSection);
    if (!planSection) return [];
    const result = await pool.query<{ player_id: number; player_name: string; item_id: number }>(
      `
        SELECT m.player_id, pl.full_name AS player_name, i.id AS item_id
        FROM player_group_members m
        JOIN player_groups g ON g.id = m.group_id
        JOIN players pl ON pl.id = m.player_id
        JOIN program_plan_items i ON i.player_id = m.player_id AND i.organization_id = g.organization_id
          AND i.plan_section = $4 AND i.workout_id = $3
        WHERE m.group_id = $1 AND g.organization_id = $2
      `,
      [target.groupId, target.organizationId, target.workoutId, planSection]
    );
    return result.rows.map((row) => ({ playerId: row.player_id, playerName: row.player_name, itemId: row.item_id }));
  }

  const cycleSlot = target.cycleSlot;
  const result = await pool.query<{ player_id: number; player_name: string; item_id: number }>(
    `
      SELECT m.player_id, pl.full_name AS player_name, i.id AS item_id
      FROM player_group_members m
      JOIN player_groups g ON g.id = m.group_id
      JOIN players pl ON pl.id = m.player_id
      JOIN program_cycle_items i ON i.player_id = m.player_id AND i.organization_id = g.organization_id
        AND i.cycle_slot = $4 AND i.workout_id = $3
      WHERE m.group_id = $1 AND g.organization_id = $2
    `,
    [target.groupId, target.organizationId, target.workoutId, cycleSlot]
  );
  return result.rows.map((row) => ({ playerId: row.player_id, playerName: row.player_name, itemId: row.item_id }));
}

export async function deleteGroupWorkoutAssignment(
  target: GroupWorkoutAssignmentTarget
): Promise<{ succeeded: number; failed: Array<{ playerId: number; error: string }> }> {
  const matches = await previewGroupWorkoutAssignmentMatches(target);
  const results = await Promise.all(
    matches.map(async (match) => {
      const result =
        target.scheduleType === 'calendar'
          ? await deleteProgramItem({ organizationId: target.organizationId, playerId: match.playerId, itemId: match.itemId })
          : target.scheduleType === 'plan'
            ? await deletePlanProgramItem({ organizationId: target.organizationId, playerId: match.playerId, itemId: match.itemId })
            : await deleteCycleProgramItem({ organizationId: target.organizationId, playerId: match.playerId, itemId: match.itemId });
      return { playerId: match.playerId, ...result };
    })
  );
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).map((r) => ({ playerId: r.playerId, error: 'error' in r ? r.error : 'Unknown error' }));
  return { succeeded, failed };
}

export async function createPlayerGroup(input: {
  organizationId: number;
  name: string;
  createdByUserId: number;
}): Promise<{ ok: true; groupId: number } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Group name is required.' };
  try {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO player_groups (organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`,
      [input.organizationId, name, input.createdByUserId]
    );
    return { ok: true, groupId: result.rows[0].id };
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      return { ok: false, error: `A group named "${name}" already exists.` };
    }
    return { ok: false, error: 'Failed to create group.' };
  }
}

// Finds-or-creates a player_groups row by name (case-insensitive, matching
// the table's own uniqueness) and replaces its membership with playerIds --
// used to turn a questionnaire assignment's typed "Group Name" + checked
// players into a real, reusable Player Group every time that questionnaire
// is saved, so the same name later shows up as a normal group everywhere
// else (e.g. the workout Apply-to-Group flow) without a second group
// system. Silently no-ops (returns null) for an empty name or player list --
// this is a best-effort side effect of saving a questionnaire, not a
// user-facing action of its own, so it should never fail the actual save.
export async function upsertPlayerGroupByName(input: {
  organizationId: number;
  name: string;
  playerIds: number[];
  createdByUserId: number;
}): Promise<number | null> {
  const name = input.name.trim();
  if (!name || input.playerIds.length === 0) return null;
  if (!isDatabaseConfigured()) return null;
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM player_groups WHERE organization_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [input.organizationId, name]
  );
  let groupId = existing.rows[0]?.id ?? null;
  if (!groupId) {
    const created = await createPlayerGroup({ organizationId: input.organizationId, name, createdByUserId: input.createdByUserId });
    if (!created.ok) return null;
    groupId = created.groupId;
  }
  const synced = await setPlayerGroupMembers({ organizationId: input.organizationId, groupId, playerIds: input.playerIds });
  return synced.ok ? groupId : null;
}

export async function renamePlayerGroup(input: {
  organizationId: number;
  groupId: number;
  name: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Group name is required.' };
  try {
    const result = await pool.query(
      `UPDATE player_groups SET name = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
      [name, input.groupId, input.organizationId]
    );
    if (result.rowCount === 0) return { ok: false, error: 'Group not found.' };
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      return { ok: false, error: `A group named "${name}" already exists.` };
    }
    return { ok: false, error: 'Failed to rename group.' };
  }
}

export async function deletePlayerGroup(input: { organizationId: number; groupId: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query(`DELETE FROM player_groups WHERE id = $1 AND organization_id = $2`, [input.groupId, input.organizationId]);
  if (result.rowCount === 0) return { ok: false, error: 'Group not found.' };
  return { ok: true };
}

/** Replaces a group's full membership list in one call -- simplest contract
 * for a web/mobile "edit group" screen that submits the whole checked-player
 * set at once rather than diffing adds/removes itself. */
export async function setPlayerGroupMembers(input: {
  organizationId: number;
  groupId: number;
  playerIds: number[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const group = await pool.query(`SELECT id FROM player_groups WHERE id = $1 AND organization_id = $2`, [input.groupId, input.organizationId]);
  if (group.rowCount === 0) return { ok: false, error: 'Group not found.' };

  // Only players that actually belong to this organization can be added --
  // mirrors the allow-list intersection pattern in admin/questionnaires.
  const validPlayers = await pool.query<{ id: number }>(
    `SELECT id FROM players WHERE organization_id = $1 AND id = ANY($2::int[])`,
    [input.organizationId, input.playerIds]
  );
  const validPlayerIds = validPlayers.rows.map((row) => row.id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM player_group_members WHERE group_id = $1`, [input.groupId]);
    if (validPlayerIds.length > 0) {
      const values = validPlayerIds.map((_, index) => `($1, $${index + 2})`).join(', ');
      await client.query(`INSERT INTO player_group_members (group_id, player_id) VALUES ${values}`, [input.groupId, ...validPlayerIds]);
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: 'Failed to update group members.' };
  } finally {
    client.release();
  }
}

/** Which group ids a player belongs to -- used to preselect membership when
 * editing a player from their own profile, or to show group chips on a
 * roster row. */
export async function listGroupIdsForPlayer(input: { playerId: number }): Promise<number[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ group_id: number }>(`SELECT group_id FROM player_group_members WHERE player_id = $1`, [input.playerId]);
  return result.rows.map((row) => row.group_id);
}

export type VideoExportJobStatus = 'queued' | 'processing' | 'ready' | 'failed';

export type VideoExportJobRow = {
  id: number;
  name: string;
  status: VideoExportJobStatus;
  errorMessage: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
  completedAt: string | null;
};

export async function createVideoExportJob(input: {
  organizationId: number;
  requestedByUserId: number;
  name: string;
  requestParams: Record<string, unknown>;
}): Promise<number> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  await ensureAuthDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO video_export_jobs (organization_id, requested_by_user_id, name, status, request_params)
      VALUES ($1, $2, $3, 'queued', $4::jsonb)
      RETURNING id
    `,
    [input.organizationId, input.requestedByUserId, input.name.trim() || 'Untitled Export', JSON.stringify(input.requestParams)]
  );
  return result.rows[0].id;
}

export async function markVideoExportJobProcessing(jobId: number): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  await pool.query(`UPDATE video_export_jobs SET status = 'processing' WHERE id = $1`, [jobId]);
}

export async function markVideoExportJobReady(input: { jobId: number; r2Key: string; fileSizeBytes: number }): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  await pool.query(
    `UPDATE video_export_jobs SET status = 'ready', r2_key = $2, file_size_bytes = $3, completed_at = NOW() WHERE id = $1`,
    [input.jobId, input.r2Key, input.fileSizeBytes]
  );
}

export async function markVideoExportJobFailed(input: { jobId: number; errorMessage: string }): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  await pool.query(
    `UPDATE video_export_jobs SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1`,
    [input.jobId, input.errorMessage.slice(0, 2000)]
  );
}

// Scoped to the requesting user (not the whole org) -- exports are a
// personal download list, like a browser's download history, not a shared
// coach/admin resource the way Player Groups or the roster is.
export async function listVideoExportJobsForUser(input: { userId: number; limit?: number }): Promise<VideoExportJobRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureAuthDbReady();
  const pool = getDbPool();
  const limit = Math.max(1, Math.min(200, input.limit ?? 50));
  const result = await pool.query<{
    id: number;
    name: string;
    status: VideoExportJobStatus;
    error_message: string | null;
    file_size_bytes: string | null;
    created_at: string;
    completed_at: string | null;
  }>(
    `
      SELECT id, name, status, error_message, file_size_bytes::text, created_at::text, completed_at::text
      FROM video_export_jobs
      WHERE requested_by_user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [input.userId, limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    errorMessage: row.error_message,
    fileSizeBytes: row.file_size_bytes ? Number(row.file_size_bytes) : null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

export async function getVideoExportJobForUser(input: { userId: number; jobId: number }): Promise<(VideoExportJobRow & { r2Key: string | null }) | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureAuthDbReady();
  const pool = getDbPool();
  const result = await pool.query<{
    id: number;
    name: string;
    status: VideoExportJobStatus;
    error_message: string | null;
    file_size_bytes: string | null;
    r2_key: string | null;
    created_at: string;
    completed_at: string | null;
  }>(
    `
      SELECT id, name, status, error_message, file_size_bytes::text, r2_key, created_at::text, completed_at::text
      FROM video_export_jobs
      WHERE id = $1 AND requested_by_user_id = $2
      LIMIT 1
    `,
    [input.jobId, input.userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    errorMessage: row.error_message,
    fileSizeBytes: row.file_size_bytes ? Number(row.file_size_bytes) : null,
    r2Key: row.r2_key,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function deleteVideoExportJobForUser(input: { userId: number; jobId: number }): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  const pool = getDbPool();
  const result = await pool.query<{ r2_key: string | null }>(
    `DELETE FROM video_export_jobs WHERE id = $1 AND requested_by_user_id = $2 RETURNING r2_key`,
    [input.jobId, input.userId]
  );
  return result.rows[0]?.r2_key ?? null;
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
    await ensureWorkoutLibraryCalendarLinkTargetColumn();
    const result = await pool.query<{
      id: number;
      name: string;
      category: string;
      calendar_link_target: string | null;
      exercise_count: string;
      organization_id: number;
    }>(
      `
        SELECT
          w.id,
          w.name,
          w.category,
          w.calendar_link_target,
          w.organization_id,
          COUNT(we.id)::text AS exercise_count
        FROM workout_library w
        LEFT JOIN workout_exercises we ON we.workout_id = w.id
        WHERE w.organization_id = ANY(ARRAY[$1, $2]::int[])
          AND (
            w.organization_id = $1
            OR NOT EXISTS (
              SELECT 1 FROM workout_library own
              WHERE own.organization_id = $1
                AND LOWER(TRIM(own.name)) = LOWER(TRIM(w.name))
            )
          )
        GROUP BY w.id, w.name, w.category, w.calendar_link_target, w.organization_id
        ORDER BY w.name ASC
      `,
      [organizationId, PCU_TEMPLATE_ORGANIZATION_ID]
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      calendarLinkTarget: normalizeCalendarLinkTarget(row.calendar_link_target),
      exerciseCount: Number(row.exercise_count ?? '0') || 0,
      isShared: organizationId !== PCU_TEMPLATE_ORGANIZATION_ID && row.organization_id === PCU_TEMPLATE_ORGANIZATION_ID,
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
        FROM exercise_library e
        WHERE e.organization_id = ANY(ARRAY[$1, $2]::int[])
          AND (
            e.organization_id = $1
            OR NOT EXISTS (
              SELECT 1 FROM exercise_library own
              WHERE own.organization_id = $1
                AND LOWER(TRIM(own.name)) = LOWER(TRIM(e.name))
                AND LOWER(TRIM(COALESCE(own.category, ''))) = LOWER(TRIM(COALESCE(e.category, '')))
            )
          )
      `,
      [organizationId, PCU_TEMPLATE_ORGANIZATION_ID]
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
        FROM workout_library w
        WHERE w.organization_id = ANY(ARRAY[$1, $2]::int[])
          AND (
            w.organization_id = $1
            OR NOT EXISTS (
              SELECT 1 FROM workout_library own
              WHERE own.organization_id = $1
                AND LOWER(TRIM(own.name)) = LOWER(TRIM(w.name))
            )
          )
      `,
      [organizationId, PCU_TEMPLATE_ORGANIZATION_ID]
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

export async function getLoginOrganizationIdForUser(userId: number): Promise<number> {
  if (!isDatabaseConfigured() || !Number.isFinite(userId) || userId <= 0) return 0;
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ organization_id: number | null }>(
    `SELECT organization_id FROM auth_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return Number(result.rows[0]?.organization_id ?? 0) || 0;
}

export async function resolveOrganizationIdForSchool(input: {
  schoolCode: string;
  fallbackOrganizationId?: number;
  createIfMissing?: boolean;
  allowFallbackIfUnresolved?: boolean;
}): Promise<number> {
  if (!isDatabaseConfigured()) return Number(input.fallbackOrganizationId ?? 0) || 0;
  await ensureTrainingDbReady();
  const schoolCode = String(input.schoolCode ?? '').trim().toUpperCase();
  const fallbackOrganizationId = Number(input.fallbackOrganizationId ?? 0);
  if (!schoolCode) return Number.isFinite(fallbackOrganizationId) && fallbackOrganizationId > 0 ? fallbackOrganizationId : 0;
  const normalizedFallback = Number.isFinite(fallbackOrganizationId) && fallbackOrganizationId > 0 ? fallbackOrganizationId : 0;
  if (schoolCode === 'TRIAL') return normalizedFallback || resolveDashboardTrialTemplateOrganizationId();
  const allowFallbackIfUnresolved = input.allowFallbackIfUnresolved !== false;
  const cacheKey = `resolve_org_id_for_school:${schoolCode}:${normalizedFallback}:${input.createIfMissing ? 1 : 0}:${allowFallbackIfUnresolved ? 1 : 0}`;
  return _withTrainingReadCache(cacheKey, 45_000, async () => {
    const schoolByOrgId = parseOrgSchoolMap();
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

    const mapped = Object.entries(schoolByOrgId).find(([, code]) => code === schoolCode);
    if (mapped) {
      const orgId = Number(mapped[0]);
      if (Number.isFinite(orgId) && orgId > 0) return orgId;
    }

    const byName = await pool.query<{ id: number }>(
      `
        SELECT id
        FROM organizations
        WHERE UPPER(TRIM(name)) IN ($1, $2)
        ORDER BY
          CASE WHEN UPPER(TRIM(name)) = $1 THEN 0 ELSE 1 END,
          id ASC
        LIMIT 1
      `,
      [schoolCode, `${schoolCode} ORGANIZATION`]
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

    return allowFallbackIfUnresolved ? normalizedFallback : 0;
  });
}

function normalizeTrialEmail(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

function fakeTrialPlayerName(index: number): string {
  const first = TRIAL_FAKE_FIRST_NAMES[index % TRIAL_FAKE_FIRST_NAMES.length];
  const last = TRIAL_FAKE_LAST_NAMES[Math.floor(index / TRIAL_FAKE_FIRST_NAMES.length) % TRIAL_FAKE_LAST_NAMES.length];
  return `${first} ${last}`;
}

export function isDashboardTrialOrganizationName(value: string | null | undefined): boolean {
  return String(value ?? '').trim().toLowerCase().startsWith(DASHBOARD_TRIAL_ORG_PREFIX.toLowerCase());
}

export async function ensureDashboardTrialOrganizationForCoach(email: string): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const normalizedEmail = normalizeTrialEmail(email);
  if (!normalizedEmail) return 0;
  const orgName = `${DASHBOARD_TRIAL_ORG_PREFIX}${normalizedEmail}`;
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM organizations WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) ORDER BY id ASC LIMIT 1`,
    [orgName]
  );
  if ((existing.rowCount ?? 0) > 0) return Number(existing.rows[0]?.id ?? 0) || 0;
  const created = await pool.query<{ id: number }>(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [orgName]);
  return Number(created.rows[0]?.id ?? 0) || 0;
}

export async function seedDashboardTrialOrganizationFromPcu(input: {
  organizationId: number;
  coachUserId?: number | null;
  createdByUserId?: number | null;
}): Promise<{ ok: true; players: number; exercises: number; workouts: number } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const targetOrganizationId = Number(input.organizationId);
  if (!Number.isFinite(targetOrganizationId) || targetOrganizationId <= 0) return { ok: false, error: 'Valid trial organization is required.' };
  const coachUserId = Number(input.coachUserId ?? 0);
  const assignedCoachUserId = Number.isFinite(coachUserId) && coachUserId > 0 ? coachUserId : null;
  const createdByUserId = Number(input.createdByUserId ?? assignedCoachUserId ?? 0) || null;
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sourceOrgId = PCU_TEMPLATE_ORGANIZATION_ID;

    await client.query(
      `
        INSERT INTO exercise_library (
          organization_id, name, category, description, instruction_video_url, coaching_cues,
          created_by, rep_measure, reps_per_side, tracking_type, created_at, updated_at
        )
        SELECT
          $1, e.name, e.category, e.description, e.instruction_video_url, e.coaching_cues,
          $2, e.rep_measure, e.reps_per_side, e.tracking_type, NOW(), NOW()
        FROM exercise_library e
        WHERE e.organization_id = $3
          AND NOT EXISTS (
            SELECT 1
            FROM exercise_library existing
            WHERE existing.organization_id = $1
              AND LOWER(TRIM(existing.name)) = LOWER(TRIM(e.name))
              AND LOWER(TRIM(COALESCE(existing.category, ''))) = LOWER(TRIM(COALESCE(e.category, '')))
          )
      `,
      [targetOrganizationId, createdByUserId, sourceOrgId]
    );

    await client.query(
      `
        INSERT INTO workout_library (
          organization_id, name, description, category, calendar_link_target, created_by, created_at, updated_at
        )
        SELECT
          $1, w.name, w.description, w.category, w.calendar_link_target, $2, NOW(), NOW()
        FROM workout_library w
        WHERE w.organization_id = $3
          AND NOT EXISTS (
            SELECT 1
            FROM workout_library existing
            WHERE existing.organization_id = $1
              AND LOWER(TRIM(existing.name)) = LOWER(TRIM(w.name))
          )
      `,
      [targetOrganizationId, createdByUserId, sourceOrgId]
    );

    await client.query(
      `
        INSERT INTO workout_exercises (
          workout_id, exercise_id, sort_order, prescribed_sets, prescribed_reps,
          prescribed_load, notes, exercise_prefix, created_at, updated_at
        )
        SELECT
          target_workout.id,
          target_exercise.id,
          we.sort_order,
          we.prescribed_sets,
          we.prescribed_reps,
          we.prescribed_load,
          we.notes,
          we.exercise_prefix,
          NOW(),
          NOW()
        FROM workout_exercises we
        JOIN workout_library source_workout ON source_workout.id = we.workout_id AND source_workout.organization_id = $2
        JOIN workout_library target_workout
          ON target_workout.organization_id = $1
         AND LOWER(TRIM(target_workout.name)) = LOWER(TRIM(source_workout.name))
        LEFT JOIN exercise_library source_exercise ON source_exercise.id = we.exercise_id
        LEFT JOIN exercise_library target_exercise
          ON target_exercise.organization_id = $1
         AND LOWER(TRIM(target_exercise.name)) = LOWER(TRIM(source_exercise.name))
         AND LOWER(TRIM(COALESCE(target_exercise.category, ''))) = LOWER(TRIM(COALESCE(source_exercise.category, '')))
        WHERE NOT EXISTS (
          SELECT 1
          FROM workout_exercises existing
          WHERE existing.workout_id = target_workout.id
            AND existing.sort_order = we.sort_order
            AND COALESCE(existing.exercise_prefix, '') = COALESCE(we.exercise_prefix, '')
        )
        ON CONFLICT DO NOTHING
      `,
      [targetOrganizationId, sourceOrgId]
    );

    const sourcePlayers = await client.query<{
      status: string | null;
      college_commitment: string | null;
      grad_year: string | null;
      position: string | null;
      height: string | null;
      profile_weight_lbs: number | null;
      bats_hand: string | null;
      throws_hand: string | null;
    }>(
      `
        SELECT status, college_commitment, grad_year, position, height,
               profile_weight_lbs, bats_hand, throws_hand
        FROM players
        WHERE organization_id = $1
        ORDER BY full_name ASC, id ASC
      `,
      [sourceOrgId]
    );

    for (const [playerIndex, row] of sourcePlayers.rows.entries()) {
      const fakeName = fakeTrialPlayerName(playerIndex);
      const fakeEmail = `trial.player.${String(targetOrganizationId)}.${String(playerIndex + 1).padStart(2, '0')}@example.invalid`;
      await client.query(
        `
          INSERT INTO players (
            organization_id, school_code, user_id, full_name, email, status, school_team, phone,
            college_commitment, grad_year, position, height, profile_weight_lbs,
            bats_hand, throws_hand, assigned_coach_user_id, created_at, updated_at
          )
          SELECT
            $1, 'TRIAL', NULL, $2, $3, COALESCE($4, 'active'), 'Dashboard Trial', NULL,
            $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
          WHERE NOT EXISTS (
            SELECT 1 FROM players WHERE organization_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($3))
          )
        `,
        [
          targetOrganizationId,
          fakeName,
          fakeEmail,
          row.status,
          row.college_commitment,
          row.grad_year,
          row.position,
          row.height,
          row.profile_weight_lbs,
          row.bats_hand,
          row.throws_hand,
          assignedCoachUserId,
        ]
      );
    }

    if (assignedCoachUserId) {
      await client.query(
        `
          UPDATE players
          SET assigned_coach_user_id = $2,
              updated_at = NOW()
          WHERE organization_id = $1
        `,
        [targetOrganizationId, assignedCoachUserId]
      );
    }

    await client.query(
      `
        INSERT INTO schedule_throwing_state (
          organization_id, player_id, by_date_json, week_notes_json, templates_json,
          created_by_user_id, updated_by_user_id, created_at, updated_at
        )
        SELECT
          $1, 0, COALESCE(s.by_date_json, '{}'::jsonb), COALESCE(s.week_notes_json, '{}'::jsonb),
          COALESCE(s.templates_json, '{}'::jsonb), $2, $2, NOW(), NOW()
        FROM schedule_throwing_state s
        WHERE s.organization_id = $3 AND s.player_id = 0
        ON CONFLICT (organization_id, player_id)
        DO UPDATE SET
          templates_json = EXCLUDED.templates_json,
          week_notes_json = EXCLUDED.week_notes_json,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = NOW()
      `,
      [targetOrganizationId, createdByUserId, sourceOrgId]
    );

    await client.query(
      `
        INSERT INTO dashboard_custom_reports (
          organization_id, school_code, name, payload_json, created_by_user_id,
          created_at, updated_at, applies_to_all_schools, created_by_email
        )
        SELECT
          $1, 'TRIAL', r.name, r.payload_json, $2, NOW(), NOW(), FALSE, NULL
        FROM dashboard_custom_reports r
        WHERE r.organization_id = $3
          AND r.school_code = 'PCU'
          AND NOT EXISTS (
            SELECT 1
            FROM dashboard_custom_reports existing
            WHERE existing.organization_id = $1
              AND existing.school_code = 'TRIAL'
              AND existing.applies_to_all_schools = FALSE
              AND LOWER(TRIM(existing.name)) = LOWER(TRIM(r.name))
          )
      `,
      [targetOrganizationId, createdByUserId, sourceOrgId]
    );

    await client.query(
      `
        INSERT INTO dashboard_custom_tables (
          organization_id, school_code, name, columns_json, created_by_user_id,
          created_at, updated_at, created_by_email
        )
        SELECT
          $1, 'TRIAL', t.name, t.columns_json, $2, NOW(), NOW(), NULL
        FROM dashboard_custom_tables t
        WHERE t.organization_id = $3
          AND t.school_code = 'PCU'
          AND NOT EXISTS (
            SELECT 1
            FROM dashboard_custom_tables existing
            WHERE existing.organization_id = $1
              AND existing.school_code = 'TRIAL'
              AND LOWER(TRIM(existing.name)) = LOWER(TRIM(t.name))
          )
      `,
      [targetOrganizationId, createdByUserId, sourceOrgId]
    );

    const counts = await client.query<{ players: string; exercises: string; workouts: string }>(
      `
        SELECT
          (SELECT COUNT(*)::text FROM players WHERE organization_id = $1) AS players,
          (SELECT COUNT(*)::text FROM exercise_library WHERE organization_id = $1) AS exercises,
          (SELECT COUNT(*)::text FROM workout_library WHERE organization_id = $1) AS workouts
      `,
      [targetOrganizationId]
    );

    await client.query('COMMIT');
    _invalidateTrainingReadCacheForOrganization(targetOrganizationId);
    return {
      ok: true,
      players: Number(counts.rows[0]?.players ?? '0') || 0,
      exercises: Number(counts.rows[0]?.exercises ?? '0') || 0,
      workouts: Number(counts.rows[0]?.workouts ?? '0') || 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to seed Dashboard Trial organization.' };
  } finally {
    client.release();
  }
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
  schoolCode?: string;
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
          school_code,
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'active')
      `,
      [
        input.organizationId,
        (input.schoolCode ?? '').trim().toUpperCase() || null,
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
}): Promise<{ ok: true; reusedExistingPassword: boolean; userId: number } | { ok: false; error: string }> {
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
    RETURNING id
  `;
  // Production can have occasional auth_users id sequence drift (manual imports,
  // legacy bootstraps). Proactively sync before insert and retry on pkey conflicts.
  await ensureAuthUsersIdSequence(pool);
  let insertedUserId = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const inserted = await pool.query<{ id: number }>(insertSql, insertValues);
      insertedUserId = Number(inserted.rows[0]?.id ?? 0) || 0;
      break;
    } catch (error) {
      const typed = error as { code?: string; constraint?: string; message?: string } | null;
      if (typed?.code === '23505' && typed?.constraint === 'auth_users_pkey') {
        return {
          ok: false,
          error: 'This coach/admin login already exists with this email. Edit the existing staff account instead of creating a duplicate.',
        };
      }
      if (!isAuthUsersPrimaryKeyViolation(error)) throw error;
      await ensureAuthUsersIdSequence(pool);
    }
  }
  if (insertedUserId <= 0) {
    return {
      ok: false,
      error: 'Could not create coach/admin profile because user ID sequencing is out of sync. Please retry.',
    };
  }

  return { ok: true, reusedExistingPassword, userId: insertedUserId };
}

export async function createDashboardTrialCoach(input: {
  name: string;
  email: string;
  phone?: string;
  password: string;
  trialDays?: number;
}): Promise<
  | { ok: true; userId: number; organizationId: number; expiresAt: string }
  | { ok: false; error: string; code?: 'duplicate_trial' }
> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  await ensureAuthDbReady();
  const normalizedEmail = normalizeTrialEmail(input.email);
  const name = input.name.trim();
  const password = input.password;
  if (!name || !normalizedEmail || !password) return { ok: false, error: 'Name, email, and password are required.' };
  const organizationId = await ensureDashboardTrialOrganizationForCoach(normalizedEmail);
  if (organizationId <= 0) return { ok: false, error: 'Could not create trial organization.' };

  const trialDays = Math.max(1, Math.min(60, Number(input.trialDays ?? 7) || 7));
  const pool = getDbPool();
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;`);
  await ensureAuthUsersIdSequence(pool);
  const passwordHash = createPasswordHash(password);
  const expiresAtResult = await pool.query<{ expires_at: string }>(
    `SELECT (NOW() + ($1::int * INTERVAL '1 day'))::text AS expires_at`,
    [trialDays]
  );
  const expiresAt = String(expiresAtResult.rows[0]?.expires_at ?? '');

  const existing = await pool.query<{ id: number; trial_expires_at: string | null }>(
    `
      SELECT id, trial_expires_at::text AS trial_expires_at
      FROM auth_users
      WHERE LOWER(COALESCE(email, '')) = LOWER($1)
         OR LOWER(COALESCE(username, '')) = LOWER($1)
      ORDER BY id ASC
      LIMIT 1
    `,
    [normalizedEmail]
  );

  if ((existing.rowCount ?? 0) > 0) {
    return {
      ok: false,
      code: 'duplicate_trial',
      error: 'A free trial has already been created for this email. Each email is limited to one trial.',
    };
  }

  let inserted: { rows: Array<{ id: number }> };
  try {
    inserted = await pool.query<{ id: number }>(
      `
        INSERT INTO auth_users (
          email, username, name, phone, password, password_hash, app_url, role, organization_id, is_active, trial_expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $5, $6, 'coach', $7, TRUE, $8::timestamptz)
        RETURNING id
      `,
      [
        normalizedEmail,
        normalizedEmail,
        name,
        (input.phone ?? '').trim() || null,
        passwordHash,
        DEFAULT_DASHBOARD_URL,
        organizationId,
        expiresAt,
      ]
    );
  } catch (error) {
    const typed = error as { code?: string; constraint?: string; detail?: string; message?: string } | null;
    const detail = String(typed?.detail ?? typed?.message ?? '').toLowerCase();
    if (
      typed?.code === '23505' &&
      (typed.constraint === 'auth_users_pkey' ||
        typed.constraint === 'auth_users_email_key' ||
        detail.includes('(username)=') ||
        detail.includes('(email)='))
    ) {
      return {
        ok: false,
        code: 'duplicate_trial',
        error: 'A free trial has already been created for this email. Each email is limited to one trial.',
      };
    }
    throw error;
  }
  const userId = Number(inserted.rows[0]?.id ?? 0) || 0;
  if (userId <= 0) return { ok: false, error: 'Could not create trial coach account.' };
  const seeded = await seedDashboardTrialOrganizationFromPcu({
    organizationId,
    coachUserId: userId,
    createdByUserId: userId,
  });
  if (!seeded.ok) return { ok: false, error: seeded.error };
  return { ok: true, userId, organizationId, expiresAt };
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

export async function deactivateExpiredDashboardTrialAccounts(): Promise<{ ok: true; deactivatedCount: number } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  await ensureAuthDbReady();
  const pool = getDbPool();
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;`);
  const result = await pool.query<{ id: number }>(
    `
      UPDATE auth_users
      SET is_active = FALSE, updated_at = NOW()
      WHERE COALESCE(is_active, TRUE) = TRUE
        AND role IN ('admin', 'coach')
        AND trial_expires_at IS NOT NULL
        AND trial_expires_at <= NOW()
      RETURNING id
    `
  );
  return { ok: true, deactivatedCount: result.rowCount ?? 0 };
}

function normalizeActivityRole(value: string | null | undefined): 'admin' | 'coach' | 'player' | 'unknown' {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'admin') return 'admin';
  if (normalized === 'coach') return 'coach';
  if (normalized === 'player') return 'player';
  return 'unknown';
}

function normalizeActivityEventTypeForDb(value: string): PortalActivityEventType {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'login_success') return 'login_success';
  if (normalized === 'bullpen_saved') return 'bullpen_saved';
  if (normalized === 'workout_logged') return 'workout_logged';
  if (normalized === 'questionnaire_completed') return 'questionnaire_completed';
  if (normalized === 'note_added') return 'note_added';
  if (normalized === 'media_uploaded') return 'media_uploaded';
  return 'page_view';
}

async function ensurePortalActivityEventsTable(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_activity_events (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER,
      email TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'unknown',
      organization_id INTEGER,
      player_id INTEGER,
      dashboard_school_code TEXT,
      event_type TEXT NOT NULL,
      path TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      user_agent TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_activity_events_created ON portal_activity_events (created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_activity_events_email_created ON portal_activity_events (LOWER(email), created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_activity_events_type_created ON portal_activity_events (event_type, created_at DESC);`);
}

let notificationsTableReady = false;
async function ensureNotificationsTable(): Promise<void> {
  if (notificationsTableReady) return;
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      recipient_user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      path TEXT,
      actor_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      actor_name TEXT,
      actor_role TEXT,
      player_id INTEGER,
      player_name TEXT,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON notifications (recipient_user_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON notifications (recipient_user_id) WHERE read_at IS NULL;`);
  notificationsTableReady = true;
}

export type NotificationRow = {
  id: number;
  eventType: string;
  title: string;
  detail: string | null;
  path: string | null;
  actorName: string | null;
  actorRole: string | null;
  playerId: number | null;
  playerName: string | null;
  read: boolean;
  createdAt: string;
};

export async function createNotificationsForUsers(input: {
  recipientUserIds: number[];
  eventType: string;
  title: string;
  detail?: string | null;
  path?: string | null;
  actorUserId?: number | null;
  actorName?: string | null;
  actorRole?: string | null;
  playerId?: number | null;
  playerName?: string | null;
}): Promise<void> {
  const recipients = Array.from(
    new Set(input.recipientUserIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (recipients.length === 0 || !isDatabaseConfigured()) return;
  await ensureTrainingDbReady();
  await ensureNotificationsTable();
  const pool = getDbPool();
  await pool.query(
    `
      INSERT INTO notifications (
        recipient_user_id, event_type, title, detail, path,
        actor_user_id, actor_name, actor_role, player_id, player_name
      )
      SELECT recipient_id, $2, $3, $4, $5, $6, $7, $8, $9, $10
      FROM UNNEST($1::int[]) AS recipient_id
    `,
    [
      recipients,
      input.eventType,
      input.title,
      input.detail ?? null,
      input.path ?? null,
      Number.isFinite(Number(input.actorUserId)) && Number(input.actorUserId) > 0 ? Number(input.actorUserId) : null,
      input.actorName ?? null,
      input.actorRole ?? null,
      Number.isFinite(Number(input.playerId)) && Number(input.playerId) > 0 ? Number(input.playerId) : null,
      input.playerName ?? null,
    ]
  );
}

export async function listNotificationsForUser(input: {
  userId: number;
  limit?: number;
}): Promise<{ notifications: NotificationRow[]; unreadCount: number }> {
  const userId = Number(input.userId ?? 0);
  if (!isDatabaseConfigured() || !Number.isFinite(userId) || userId <= 0) return { notifications: [], unreadCount: 0 };
  await ensureTrainingDbReady();
  await ensureNotificationsTable();
  const pool = getDbPool();
  const limit = Math.max(5, Math.min(50, Number(input.limit ?? 20) || 20));

  const [rowsResult, unreadResult] = await Promise.all([
    pool.query<{
      id: string; event_type: string; title: string; detail: string | null; path: string | null;
      actor_name: string | null; actor_role: string | null; player_id: number | null; player_name: string | null;
      read_at: string | null; created_at: string;
    }>(
      `
        SELECT id::text, event_type, title, detail, path, actor_name, actor_role, player_id, player_name, read_at::text, created_at::text
        FROM notifications
        WHERE recipient_user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `,
      [userId, limit]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications WHERE recipient_user_id = $1 AND read_at IS NULL`,
      [userId]
    ),
  ]);

  const notifications = rowsResult.rows.map((row) => ({
    id: Number(row.id),
    eventType: row.event_type,
    title: row.title,
    detail: row.detail,
    path: row.path,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    playerId: row.player_id,
    playerName: row.player_name,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
  } satisfies NotificationRow));

  return { notifications, unreadCount: Number(unreadResult.rows[0]?.count ?? '0') || 0 };
}

/**
 * Notify every coach/admin at a player's school about new note/media activity,
 * using the explicit user_school_access grant table -- never organization_id,
 * which is not a reliable school boundary (see DASHBOARD_ORG_SCHOOL_MAP /
 * players.school_code migration notes). Returns the recipient user ids so the
 * caller can also fan out a push notification.
 */
export async function notifyStaffForPlayerActivity(input: {
  schoolCode: string | null;
  excludeUserId?: number | null;
  eventType: string;
  title: string;
  detail?: string | null;
  path?: string | null;
  actorUserId?: number | null;
  actorName?: string | null;
  actorRole?: string | null;
  playerId: number;
  playerName: string | null;
}): Promise<number[]> {
  const schoolCode = String(input.schoolCode ?? '').trim().toUpperCase();
  if (!schoolCode) return [];
  const staff = await listStaffForSchool(schoolCode);
  const recipients = staff.map((s) => s.userId).filter((id) => id !== (input.excludeUserId ?? -1));
  if (recipients.length === 0) return [];
  await createNotificationsForUsers({
    recipientUserIds: recipients,
    eventType: input.eventType,
    title: input.title,
    detail: input.detail,
    path: input.path,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    actorRole: input.actorRole,
    playerId: input.playerId,
    playerName: input.playerName,
  });
  return recipients;
}

/** Notify a player (their own user_id) about new staff activity on their profile. */
export async function notifyPlayerForStaffActivity(input: {
  playerUserId: number | null;
  eventType: string;
  title: string;
  detail?: string | null;
  path?: string | null;
  actorUserId?: number | null;
  actorName?: string | null;
  actorRole?: string | null;
  playerId: number;
  playerName: string | null;
}): Promise<number[]> {
  const userId = Number(input.playerUserId ?? 0);
  if (!Number.isFinite(userId) || userId <= 0) return [];
  await createNotificationsForUsers({
    recipientUserIds: [userId],
    eventType: input.eventType,
    title: input.title,
    detail: input.detail,
    path: input.path,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    actorRole: input.actorRole,
    playerId: input.playerId,
    playerName: input.playerName,
  });
  return [userId];
}

export async function markNotificationsReadForUser(input: { userId: number; notificationIds?: number[] }): Promise<void> {
  const userId = Number(input.userId ?? 0);
  if (!isDatabaseConfigured() || !Number.isFinite(userId) || userId <= 0) return;
  await ensureTrainingDbReady();
  await ensureNotificationsTable();
  const pool = getDbPool();
  const ids = Array.isArray(input.notificationIds)
    ? input.notificationIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    : [];
  if (ids.length > 0) {
    await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE recipient_user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL`,
      [userId, ids]
    );
  } else {
    await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE recipient_user_id = $1 AND read_at IS NULL`,
      [userId]
    );
  }
}

export async function recordPortalActivityEvent(input: {
  userId?: number | null;
  email: string;
  name?: string | null;
  role?: 'admin' | 'coach' | 'player' | string | null;
  organizationId?: number | null;
  playerId?: number | null;
  dashboardSchoolCode?: string | null;
  eventType: PortalActivityEventType;
  path?: string | null;
  metadata?: Record<string, unknown> | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<void> {
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!email || !isDatabaseConfigured()) return;
  await ensureTrainingDbReady();
  await ensurePortalActivityEventsTable();
  const pool = getDbPool();
  await pool.query(
    `
      INSERT INTO portal_activity_events (
        user_id,
        email,
        name,
        role,
        organization_id,
        player_id,
        dashboard_school_code,
        event_type,
        path,
        metadata,
        user_agent,
        ip_address
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
    `,
    [
      Number.isFinite(Number(input.userId)) && Number(input.userId) > 0 ? Number(input.userId) : null,
      email,
      String(input.name ?? '').trim() || null,
      normalizeActivityRole(input.role),
      Number.isFinite(Number(input.organizationId)) && Number(input.organizationId) > 0 ? Number(input.organizationId) : null,
      Number.isFinite(Number(input.playerId)) && Number(input.playerId) > 0 ? Number(input.playerId) : null,
      String(input.dashboardSchoolCode ?? '').trim().toUpperCase() || null,
      input.eventType,
      String(input.path ?? '').trim().slice(0, 500) || null,
      JSON.stringify(input.metadata ?? {}),
      String(input.userAgent ?? '').trim().slice(0, 1000) || null,
      String(input.ipAddress ?? '').trim().slice(0, 120) || null,
    ]
  );
}

async function ensureDevicePushTokensTable(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_push_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expo_push_token TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'unknown',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_device_push_tokens_token ON device_push_tokens (expo_push_token);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user ON device_push_tokens (user_id);`);
}

export async function upsertDevicePushToken(input: {
  userId: number;
  expoPushToken: string;
  platform?: string | null;
}): Promise<void> {
  const userId = Number(input.userId ?? 0);
  const expoPushToken = String(input.expoPushToken ?? '').trim();
  if (!isDatabaseConfigured() || !Number.isFinite(userId) || userId <= 0 || !expoPushToken) return;
  await ensureTrainingDbReady();
  await ensureDevicePushTokensTable();
  const pool = getDbPool();
  await pool.query(
    `
      INSERT INTO device_push_tokens (user_id, expo_push_token, platform, last_seen_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (expo_push_token)
      DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = NOW()
    `,
    [userId, expoPushToken, String(input.platform ?? '').trim().toLowerCase() || 'unknown']
  );
}

export async function deleteDevicePushToken(expoPushToken: string): Promise<void> {
  const token = String(expoPushToken ?? '').trim();
  if (!isDatabaseConfigured() || !token) return;
  await ensureTrainingDbReady();
  await ensureDevicePushTokensTable();
  const pool = getDbPool();
  await pool.query(`DELETE FROM device_push_tokens WHERE expo_push_token = $1`, [token]);
}

export async function listDevicePushTokensForUsers(userIds: number[]): Promise<string[]> {
  const ids = Array.from(new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  if (!isDatabaseConfigured() || ids.length === 0) return [];
  await ensureTrainingDbReady();
  await ensureDevicePushTokensTable();
  const pool = getDbPool();
  const result = await pool.query<{ expo_push_token: string }>(
    `SELECT expo_push_token FROM device_push_tokens WHERE user_id = ANY($1::int[])`,
    [ids]
  );
  return result.rows.map((row) => row.expo_push_token);
}

export async function listPortalActivityOverview(input: {
  role?: string | null;
  query?: string | null;
  limit?: number;
} = {}): Promise<{ users: PortalActivityUserSummaryRow[]; recentEvents: PortalActivityRecentEventRow[] }> {
  if (!isDatabaseConfigured()) return { users: [], recentEvents: [] };
  await ensureTrainingDbReady();
  await ensurePortalActivityEventsTable();
  const pool = getDbPool();
  const role = normalizeActivityRole(input.role);
  const q = String(input.query ?? '').trim();
  const limit = Math.max(20, Math.min(500, Number(input.limit ?? 200) || 200));

  const filters: string[] = [];
  const params: unknown[] = [];
  if (role !== 'unknown') {
    params.push(role);
    filters.push(`e.role = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    filters.push(`(e.email ILIKE $${params.length} OR COALESCE(e.name, '') ILIKE $${params.length} OR COALESCE(o.name, '') ILIKE $${params.length})`);
  }
  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const usersResult = await pool.query<{
    user_id: number | null;
    email: string;
    name: string | null;
    role: string;
    organization_id: number | null;
    organization_name: string | null;
    player_id: number | null;
    dashboard_school_code: string | null;
    last_login_at: string | null;
    last_activity_at: string | null;
    last_path: string | null;
    last_metadata: Record<string, unknown> | null;
    login_count_30d: string;
    page_view_count_30d: string;
    key_action_count_30d: string;
  }>(
    `
      WITH ranked AS (
        SELECT
          e.*,
          ROW_NUMBER() OVER (PARTITION BY LOWER(e.email) ORDER BY e.created_at DESC, e.id DESC) AS row_rank
        FROM portal_activity_events e
      ),
      aggregates AS (
        SELECT
          LOWER(email) AS email_key,
          MAX(created_at) FILTER (WHERE event_type = 'login_success')::text AS last_login_at,
          MAX(created_at)::text AS last_activity_at,
          COUNT(*) FILTER (WHERE event_type = 'login_success' AND created_at >= NOW() - INTERVAL '30 days')::text AS login_count_30d,
          COUNT(*) FILTER (WHERE event_type = 'page_view' AND created_at >= NOW() - INTERVAL '30 days')::text AS page_view_count_30d,
          COUNT(*) FILTER (WHERE event_type <> 'page_view' AND event_type <> 'login_success' AND created_at >= NOW() - INTERVAL '30 days')::text AS key_action_count_30d
        FROM portal_activity_events
        GROUP BY LOWER(email)
      )
      SELECT
        e.user_id,
        e.email,
        e.name,
        e.role,
        e.organization_id,
        o.name AS organization_name,
        e.player_id,
        e.dashboard_school_code,
        a.last_login_at,
        a.last_activity_at,
        e.path AS last_path,
        e.metadata AS last_metadata,
        a.login_count_30d,
        a.page_view_count_30d,
        a.key_action_count_30d
      FROM ranked e
      JOIN aggregates a ON a.email_key = LOWER(e.email)
      LEFT JOIN organizations o ON o.id = e.organization_id
      ${whereSql}
        ${whereSql ? 'AND' : 'WHERE'} e.row_rank = 1
      ORDER BY COALESCE(a.last_activity_at, '') DESC
      LIMIT $${params.length + 1}
    `,
    [...params, limit]
  );

  const eventsResult = await pool.query<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    organization_name: string | null;
    event_type: string;
    path: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>(
    `
      SELECT
        e.id::text AS id,
        e.email,
        e.name,
        e.role,
        o.name AS organization_name,
        e.event_type,
        e.path,
        e.metadata,
        e.created_at::text AS created_at
      FROM portal_activity_events e
      LEFT JOIN organizations o ON o.id = e.organization_id
      ${whereSql}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $${params.length + 1}
    `,
    [...params, limit]
  );

  return {
    users: usersResult.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      name: row.name,
      role: normalizeActivityRole(row.role),
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      playerId: row.player_id,
      dashboardSchoolCode: row.dashboard_school_code,
      lastLoginAt: row.last_login_at,
      lastActivityAt: row.last_activity_at,
      lastPath: row.last_path,
      lastMetadata: row.last_metadata && typeof row.last_metadata === 'object' ? row.last_metadata : null,
      loginCount30d: Number(row.login_count_30d ?? '0') || 0,
      pageViewCount30d: Number(row.page_view_count_30d ?? '0') || 0,
      keyActionCount30d: Number(row.key_action_count_30d ?? '0') || 0,
    })),
    recentEvents: eventsResult.rows.map((row) => ({
      id: Number(row.id),
      email: row.email,
      name: row.name,
      role: normalizeActivityRole(row.role),
      organizationName: row.organization_name,
      eventType: normalizeActivityEventTypeForDb(row.event_type),
      path: row.path,
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : null,
      createdAt: row.created_at,
    })),
  };
}

function notificationMetadataString(metadata: Record<string, unknown> | null, key: string): string {
  const value = metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export async function listPortalNotifications(input: {
  organizationId: number;
  playerId?: number | null;
  eventTypes?: Array<'note_added' | 'media_uploaded'>;
  actorRoles?: Array<'admin' | 'coach' | 'player'>;
  mediaTypes?: Array<'photo' | 'video' | 'pdf'>;
  playerPath?: string;
  limit?: number;
  sinceDays?: number;
}): Promise<{ notifications: PortalNotificationRow[]; count: number }> {
  const organizationId = Number(input.organizationId ?? 0);
  if (!isDatabaseConfigured() || organizationId <= 0) return { notifications: [], count: 0 };
  await ensureTrainingDbReady();
  await ensurePortalActivityEventsTable();
  const pool = getDbPool();
  const limit = Math.max(5, Math.min(50, Number(input.limit ?? 15) || 15));
  const sinceDays = Math.max(1, Math.min(90, Number(input.sinceDays ?? 30) || 30));
  const eventTypes = (Array.isArray(input.eventTypes) && input.eventTypes.length > 0 ? input.eventTypes : ['note_added', 'media_uploaded'])
    .filter((value): value is 'note_added' | 'media_uploaded' => value === 'note_added' || value === 'media_uploaded');
  const actorRoles = (Array.isArray(input.actorRoles) ? input.actorRoles : [])
    .filter((value): value is 'admin' | 'coach' | 'player' => value === 'admin' || value === 'coach' || value === 'player');
  const mediaTypes = (Array.isArray(input.mediaTypes) ? input.mediaTypes : [])
    .filter((value): value is 'photo' | 'video' | 'pdf' => value === 'photo' || value === 'video' || value === 'pdf');
  const filters = [
    `organization_id = $1`,
    `event_type = ANY($3::text[])`,
    `created_at >= NOW() - ($2::int * INTERVAL '1 day')`,
  ];
  const queryParams: unknown[] = [organizationId, sinceDays, eventTypes];
  const playerId = Number(input.playerId ?? 0);
  if (Number.isFinite(playerId) && playerId > 0) {
    queryParams.push(playerId);
    filters.push(`player_id = $${queryParams.length}`);
  }
  if (actorRoles.length > 0) {
    queryParams.push(actorRoles);
    filters.push(`role = ANY($${queryParams.length}::text[])`);
  }
  if (mediaTypes.length > 0) {
    queryParams.push(mediaTypes);
    filters.push(`metadata->>'mediaType' = ANY($${queryParams.length}::text[])`);
  }
  const whereSql = filters.join('\n        AND ');

  const rowsResult = await pool.query<{
    id: string;
    event_type: string;
    path: string | null;
    metadata: Record<string, unknown> | null;
    name: string | null;
    email: string;
    role: string;
    player_id: number | null;
    created_at: string;
  }>(
    `
      SELECT
        id::text,
        event_type,
        path,
        metadata,
        name,
        email,
        role,
        player_id,
        created_at::text
      FROM portal_activity_events
      WHERE ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT $${queryParams.length + 1}
    `,
    [...queryParams, limit]
  );

  const countResult = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM portal_activity_events
      WHERE ${whereSql}
    `,
    queryParams
  );

  const notifications = rowsResult.rows.map((row) => {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : null;
    const eventType = row.event_type === 'media_uploaded' ? 'media_uploaded' : 'note_added';
    const playerName = notificationMetadataString(metadata, 'playerName') || notificationMetadataString(metadata, 'dashboardPlayerName') || null;
    const playerId = Number(row.player_id ?? metadata?.playerId ?? 0);
    const mediaType = notificationMetadataString(metadata, 'mediaType');
    const mediaTitle = notificationMetadataString(metadata, 'mediaTitle');
    const noteCategory = notificationMetadataString(metadata, 'category');
    const noteDomain = notificationMetadataString(metadata, 'domain');
    const profilePath = input.playerPath || (Number.isFinite(playerId) && playerId > 0 ? `/portal/player?previewPlayerId=${playerId}` : '/profiles');
    const title = eventType === 'media_uploaded'
      ? `${mediaType ? `${mediaType[0]?.toUpperCase() ?? ''}${mediaType.slice(1)}` : 'Media'} uploaded`
      : 'Player note added';
    const detailParts = [
      playerName ? `for ${playerName}` : '',
      eventType === 'media_uploaded' && mediaTitle ? mediaTitle : '',
      eventType === 'note_added' && noteCategory ? noteCategory : '',
      eventType === 'note_added' && noteDomain ? noteDomain : '',
    ].filter(Boolean);
    return {
      id: Number(row.id),
      eventType,
      title,
      detail: detailParts.join(' · ') || 'Recent player activity',
      path: profilePath,
      actorName: String(row.name ?? '').trim() || String(row.email ?? '').trim() || null,
      actorRole: normalizeActivityRole(row.role),
      playerId: Number.isFinite(playerId) && playerId > 0 ? playerId : null,
      playerName,
      createdAt: row.created_at,
    } satisfies PortalNotificationRow;
  });

  return {
    notifications,
    count: Number(countResult.rows[0]?.count ?? '0') || 0,
  };
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
      SELECT DISTINCT ON (LOWER(TRIM(name))) id, name
      FROM exercise_categories
      WHERE organization_id = ANY(ARRAY[$1, $2]::int[])
      ORDER BY LOWER(TRIM(name)), (organization_id = $1) DESC, id
    `,
    [organizationId, PCU_TEMPLATE_ORGANIZATION_ID]
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
  await ensureWorkoutLibraryCalendarLinkTargetColumn();

  // Include PCU template exercises (org 1) for all orgs so every school sees the shared library.
  // The org's own exercises take priority; PCU duplicates (same name+category) are excluded.
  const orgIds = organizationId === PCU_TEMPLATE_ORGANIZATION_ID
    ? [organizationId]
    : [organizationId, PCU_TEMPLATE_ORGANIZATION_ID];

  const result = await pool.query<{
    id: number;
    organization_id: number;
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
      SELECT id, organization_id, name, category, rep_measure, tracking_type, reps_per_side, description, instruction_video_url, coaching_cues
      FROM exercise_library e
      WHERE organization_id = ANY($1::int[])
        AND (
          organization_id = $2
          OR NOT EXISTS (
            SELECT 1 FROM exercise_library own
            WHERE own.organization_id = $2
              AND LOWER(TRIM(own.name)) = LOWER(TRIM(e.name))
              AND LOWER(TRIM(COALESCE(own.category, ''))) = LOWER(TRIM(COALESCE(e.category, '')))
          )
        )
      ORDER BY name ASC
    `,
    [orgIds, organizationId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    sourceOrganizationId: row.organization_id,
    isShared: organizationId !== PCU_TEMPLATE_ORGANIZATION_ID && row.organization_id === PCU_TEMPLATE_ORGANIZATION_ID,
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
    organization_id: number;
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
      SELECT id, organization_id, name, category, rep_measure, tracking_type, reps_per_side, description, instruction_video_url, coaching_cues
      FROM exercise_library
      WHERE id = $2 AND organization_id = ANY(ARRAY[$1, $3]::int[])
      LIMIT 1
    `,
    [input.organizationId, input.exerciseId, PCU_TEMPLATE_ORGANIZATION_ID]
  );

  if ((result.rowCount ?? 0) !== 1) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    sourceOrganizationId: row.organization_id,
    isShared: input.organizationId !== PCU_TEMPLATE_ORGANIZATION_ID && row.organization_id === PCU_TEMPLATE_ORGANIZATION_ID,
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
      WHERE we.exercise_id = $1
        AND ($2 = $3 OR w.organization_id = $2)
    `,
    [input.exerciseId, input.organizationId, PCU_TEMPLATE_ORGANIZATION_ID]
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
      WHERE i.exercise_id = $1
        AND ($2 = $3 OR p.organization_id = $2)
    `,
    [input.exerciseId, input.organizationId, PCU_TEMPLATE_ORGANIZATION_ID]
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
      WHERE i.workout_id = $1
        AND ($2 = $3 OR p.organization_id = $2)
    `,
    [input.workoutId, input.organizationId, PCU_TEMPLATE_ORGANIZATION_ID]
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

  // Include PCU template workouts (org 1) for all orgs. The org's own workouts take priority;
  // PCU duplicates (same name) are excluded so local overrides win.
  const orgIds = organizationId === PCU_TEMPLATE_ORGANIZATION_ID
    ? [organizationId]
    : [organizationId, PCU_TEMPLATE_ORGANIZATION_ID];

  const result = await pool.query<{
    id: number;
    organization_id: number;
    name: string;
    category: string;
    description: string | null;
    calendar_link_target: string | null;
    exercise_count: string;
    exercise_names: string | null;
  }>(
    `
      SELECT
        w.id,
        w.organization_id,
        w.name,
        w.category,
        w.description,
        w.calendar_link_target,
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
      WHERE w.organization_id = ANY($1::int[])
        AND (
          w.organization_id = $2
          OR NOT EXISTS (
            SELECT 1 FROM workout_library own
            WHERE own.organization_id = $2
              AND LOWER(TRIM(own.name)) = LOWER(TRIM(w.name))
          )
        )
      GROUP BY w.id, w.organization_id, w.name, w.category, w.description, w.calendar_link_target
      ORDER BY w.name ASC
    `,
    [orgIds, organizationId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    sourceOrganizationId: row.organization_id,
    isShared: organizationId !== PCU_TEMPLATE_ORGANIZATION_ID && row.organization_id === PCU_TEMPLATE_ORGANIZATION_ID,
    name: row.name,
    category: row.category,
    description: row.description,
    calendarLinkTarget: normalizeCalendarLinkTarget(row.calendar_link_target),
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
  await ensureWorkoutLibraryCalendarLinkTargetColumn();

  const workoutResult = await pool.query<{ id: number; organization_id: number; name: string; category: string; description: string | null; calendar_link_target: string | null }>(
    `
      SELECT id, organization_id, name, category, description, calendar_link_target
      FROM workout_library
      WHERE id = $1 AND organization_id = ANY(ARRAY[$2, $3]::int[])
      LIMIT 1
    `,
    [input.workoutId, input.organizationId, PCU_TEMPLATE_ORGANIZATION_ID]
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
    prescribed_load: string | null;
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
        we.prescribed_load,
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
    sourceOrganizationId: workout.organization_id,
    isShared: input.organizationId !== PCU_TEMPLATE_ORGANIZATION_ID && workout.organization_id === PCU_TEMPLATE_ORGANIZATION_ID,
    name: workout.name,
    category: workout.category,
    description: workout.description,
    calendarLinkTarget: normalizeCalendarLinkTarget(workout.calendar_link_target),
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
      prescribedLoad: row.prescribed_load,
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
    `SELECT id FROM workout_library WHERE organization_id = ANY(ARRAY[$1, $3]::int[]) AND id = ANY($2::int[])`,
    [input.organizationId, workoutIds, PCU_TEMPLATE_ORGANIZATION_ID]
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

export async function getScheduleThrowingState(input: {
  organizationId: number;
  playerId: number;
}): Promise<{ byDate: Record<string, unknown>; weekNotes: Record<string, unknown>; templates: unknown }> {
  if (!isDatabaseConfigured()) return { byDate: {}, weekNotes: {}, templates: [] };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{
    by_date_json: Record<string, unknown> | null;
    week_notes_json: Record<string, unknown> | null;
    templates_json: unknown[] | null;
  }>(
    `
      SELECT by_date_json, week_notes_json, templates_json
      FROM schedule_throwing_state
      WHERE organization_id = $1 AND player_id = $2
      LIMIT 1
    `,
    [input.organizationId, input.playerId]
  );
  if ((result.rowCount ?? 0) < 1) return { byDate: {}, weekNotes: {}, templates: [] };
  return {
    byDate: (result.rows[0]?.by_date_json ?? {}) as Record<string, unknown>,
    weekNotes: (result.rows[0]?.week_notes_json ?? {}) as Record<string, unknown>,
    templates: (result.rows[0]?.templates_json ?? []) as unknown,
  };
}

export async function getRecoverableBullpenScripts(input: {
  organizationId: number;
}): Promise<unknown[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ script: unknown }>(
    `
      SELECT DISTINCT ON (LOWER(TRIM(templates_json #>> '{bullpen,current,title}')))
        templates_json #> '{bullpen,current}' AS script
      FROM schedule_throwing_state
      WHERE organization_id = $1
        AND player_id > 0
        AND jsonb_typeof(templates_json #> '{bullpen,current}') = 'object'
        AND TRIM(COALESCE(templates_json #>> '{bullpen,current,title}', '')) <> ''
      ORDER BY
        LOWER(TRIM(templates_json #>> '{bullpen,current,title}')),
        updated_at DESC
    `,
    [input.organizationId]
  );
  return result.rows.map((row) => row.script).filter(Boolean);
}

export async function getRecoverableVelocityScripts(input: {
  organizationId: number;
}): Promise<unknown[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ script: unknown }>(
    `
      SELECT DISTINCT ON (LOWER(TRIM(templates_json #>> '{velocity,current,title}')))
        templates_json #> '{velocity,current}' AS script
      FROM schedule_throwing_state
      WHERE organization_id = $1
        AND player_id > 0
        AND jsonb_typeof(templates_json #> '{velocity,current}') = 'object'
        AND TRIM(COALESCE(templates_json #>> '{velocity,current,title}', '')) <> ''
      ORDER BY
        LOWER(TRIM(templates_json #>> '{velocity,current,title}')),
        updated_at DESC
    `,
    [input.organizationId]
  );
  return result.rows.map((row) => row.script).filter(Boolean);
}

export async function getRecoverableThrowingTemplates(input: {
  organizationId: number;
}): Promise<unknown[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ template: unknown }>(
    `
      WITH expanded AS (
        SELECT
          template,
          LOWER(TRIM(COALESCE(template->>'name', ''))) AS template_name,
          updated_at AS sort_time
        FROM schedule_throwing_state,
          LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(templates_json) = 'array' THEN templates_json
              WHEN jsonb_typeof(templates_json->'throwingTemplates') = 'array' THEN templates_json->'throwingTemplates'
              ELSE '[]'::jsonb
            END
          ) AS template
        WHERE organization_id = $1
          AND player_id >= 0
      )
      SELECT DISTINCT ON (template_name) template
      FROM expanded
      WHERE template_name <> ''
      ORDER BY template_name, sort_time DESC
    `,
    [input.organizationId]
  );
  return result.rows.map((row) => row.template).filter(Boolean);
}

export async function saveScheduleThrowingState(input: {
  organizationId: number;
  playerId: number;
  userId: number;
  byDate: Record<string, unknown>;
  weekNotes: Record<string, unknown>;
  templates: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  try {
    await pool.query(
      `
        INSERT INTO schedule_throwing_state (
          organization_id,
          player_id,
          by_date_json,
          week_notes_json,
          templates_json,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $6)
        ON CONFLICT (organization_id, player_id)
        DO UPDATE SET
          by_date_json = EXCLUDED.by_date_json,
          week_notes_json = EXCLUDED.week_notes_json,
          templates_json = EXCLUDED.templates_json,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = NOW()
      `,
      [
        input.organizationId,
        input.playerId,
        JSON.stringify(input.byDate ?? {}),
        JSON.stringify(input.weekNotes ?? {}),
        JSON.stringify(input.templates ?? []),
        input.userId,
      ]
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to save throwing state.' };
  }
}

export async function getPcuSharedThrowingState(): Promise<{ byDate: Record<string, unknown>; weekNotes: Record<string, unknown>; templates: unknown }> {
  return getScheduleThrowingState({ organizationId: PCU_TEMPLATE_ORGANIZATION_ID, playerId: 0 });
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
  calendarLinkTarget?: string;
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
  const calendarLinkTarget = normalizeCalendarLinkTarget(input.calendarLinkTarget);

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
        WHERE organization_id = ANY(ARRAY[$1, $3]::int[]) AND id = ANY($2::int[])
      `,
      [input.organizationId, uniqueExerciseIds, PCU_TEMPLATE_ORGANIZATION_ID]
    );

    if (exerciseCheck.rows.length !== uniqueExerciseIds.length) {
      return { ok: false, error: 'One or more exercises were not found in your library.' };
    }
  }

  if (uniqueExerciseIds.length === 0) {
    await pool.query(
      `
        INSERT INTO workout_library (organization_id, name, category, description, created_by, calendar_link_target)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [input.organizationId, name, category, (input.description ?? '').trim() || null, input.userId, calendarLinkTarget]
    );
    _invalidateTrainingReadCacheForOrganization(input.organizationId);
    return { ok: true };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const workout = await client.query<{ id: number }>(
      `
        INSERT INTO workout_library (organization_id, name, category, description, created_by, calendar_link_target)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [input.organizationId, name, category, (input.description ?? '').trim() || null, input.userId, calendarLinkTarget]
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
  calendarLinkTarget?: string;
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
  const calendarLinkTarget = normalizeCalendarLinkTarget(input.calendarLinkTarget);

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
        WHERE organization_id = ANY(ARRAY[$1, $3]::int[]) AND id = ANY($2::int[])
      `,
      [input.organizationId, uniqueExerciseIds, PCU_TEMPLATE_ORGANIZATION_ID]
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
          calendar_link_target = $4,
          updated_at = NOW()
        WHERE id = $5 AND organization_id = $6
        RETURNING id
      `,
      [name, category, (input.description ?? '').trim() || null, calendarLinkTarget, input.workoutId, input.organizationId]
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
          calendar_link_target = $4,
          updated_at = NOW()
        WHERE id = $5 AND organization_id = $6
        RETURNING id
      `,
      [name, category, (input.description ?? '').trim() || null, calendarLinkTarget, input.workoutId, input.organizationId]
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
}): Promise<
  | { ok: true; itemId: number; playerUserId: number | null; playerName: string; workoutName: string | null }
  | { ok: false; error: string }
> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const date = input.dayDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'Date must be YYYY-MM-DD.' };
  }

  const playerCheck = await pool.query<{ id: number; user_id: number | null; full_name: string }>(
    `SELECT id, user_id, full_name FROM players WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [input.playerId, input.organizationId]
  );
  if ((playerCheck.rowCount ?? 0) !== 1) {
    return { ok: false, error: 'Player was not found in your organization.' };
  }
  const playerUserId = playerCheck.rows[0].user_id;
  const playerName = playerCheck.rows[0].full_name;

  let exerciseId: number | null = null;
  let workoutId: number | null = null;
  let workoutName: string | null = null;

  if (input.assignmentType === 'exercise') {
    const exId = input.exerciseId ?? 0;
    const exerciseCheck = await pool.query<{ id: number }>(
      `SELECT id FROM exercise_library WHERE id = $1 AND organization_id = ANY(ARRAY[$2, $3]::int[]) LIMIT 1`,
      [exId, input.organizationId, PCU_TEMPLATE_ORGANIZATION_ID]
    );
    if ((exerciseCheck.rowCount ?? 0) !== 1) {
      return { ok: false, error: 'Exercise was not found in your organization.' };
    }
    exerciseId = exId;
  } else {
    const wkId = input.workoutId ?? 0;
    const workoutCheck = await pool.query<{ id: number; name: string }>(
      `SELECT id, name FROM workout_library WHERE id = $1 AND organization_id = ANY(ARRAY[$2, $3]::int[]) LIMIT 1`,
      [wkId, input.organizationId, PCU_TEMPLATE_ORGANIZATION_ID]
    );
    if ((workoutCheck.rowCount ?? 0) !== 1) {
      return { ok: false, error: 'Workout was not found in your organization.' };
    }
    workoutId = wkId;
    workoutName = workoutCheck.rows[0].name;
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

  const insertResult = await pool.query<{ id: number }>(
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
      RETURNING id
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

  const itemId = Number(insertResult.rows[0].id);
  if (workoutId) {
    await copyLatestWorkoutExerciseOverridesForNewItem({
      db: pool,
      organizationId: input.organizationId,
      playerId: input.playerId,
      workoutId,
      programDayItemId: itemId,
      userId: input.userId,
    });
  }

  return { ok: true, itemId, playerUserId, playerName, workoutName };
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
      `SELECT id FROM exercise_library WHERE organization_id = ANY(ARRAY[$1, $3]::int[]) AND id = ANY($2::int[])`,
      [input.organizationId, exerciseIds, PCU_TEMPLATE_ORGANIZATION_ID]
    );
    if (validExercises.rows.length !== exerciseIds.length) {
      return { ok: false, error: 'One or more copied exercises are not available in this organization.' };
    }
  }

  if (workoutIds.length > 0) {
    const validWorkouts = await pool.query<{ id: number }>(
      `SELECT id FROM workout_library WHERE organization_id = ANY(ARRAY[$1, $3]::int[]) AND id = ANY($2::int[])`,
      [input.organizationId, workoutIds, PCU_TEMPLATE_ORGANIZATION_ID]
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

        const insertedProgramItem = await client.query<{ id: number }>(
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
            RETURNING id
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
        if (assignmentType === 'workout') {
          await copyLatestWorkoutExerciseOverridesForNewItem({
            db: client,
            organizationId: input.organizationId,
            playerId: input.playerId,
            workoutId: workoutIdValue,
            programDayItemId: Number(insertedProgramItem.rows[0].id),
            userId: input.userId,
          });
        }
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

export async function saveProgramWorkoutExerciseOverrides(input: {
  organizationId: number;
  playerId: number;
  programDayItemId: number;
  userId: number | null;
  overrides: WorkoutExerciseOverrideInput[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const itemCheck = await pool.query<{ workout_id: number | null }>(
    `
      SELECT i.workout_id
      FROM program_day_items i
      JOIN program_days d ON d.id = i.program_day_id
      JOIN programs p ON p.id = d.program_id
      WHERE i.id = $1
        AND p.player_id = $2
        AND p.organization_id = $3
      LIMIT 1
    `,
    [input.programDayItemId, input.playerId, input.organizationId]
  );
  const workoutId = Number(itemCheck.rows[0]?.workout_id ?? 0);
  if ((itemCheck.rowCount ?? 0) !== 1 || !Number.isFinite(workoutId) || workoutId <= 0) {
    return { ok: false, error: 'Scheduled workout was not found.' };
  }

  const cleaned = input.overrides
    .map((override) => ({
      workoutExerciseIndex: Math.floor(Number(override.workoutExerciseIndex)),
      exerciseId: Number.isFinite(Number(override.exerciseId ?? 0)) && Number(override.exerciseId ?? 0) > 0 ? Math.floor(Number(override.exerciseId)) : null,
      prescribedSets: cleanOverrideText(override.prescribedSets),
      prescribedReps: cleanOverrideText(override.prescribedReps),
      prescribedLoad: cleanOverrideText(override.prescribedLoad),
      notes: cleanOverrideText(override.notes),
    }))
    .filter((override) => Number.isFinite(override.workoutExerciseIndex) && override.workoutExerciseIndex >= 0)
    .slice(0, 200);

  const replacementExerciseIds = Array.from(new Set(cleaned.map((override) => override.exerciseId).filter((id): id is number => Number.isFinite(Number(id)) && Number(id) > 0)));
  if (replacementExerciseIds.length > 0) {
    const validExerciseRows = await pool.query<{ id: number }>(
      `
        SELECT id
        FROM exercise_library
        WHERE organization_id = $1
          AND id = ANY($2::int[])
      `,
      [input.organizationId, replacementExerciseIds]
    );
    const validExerciseIds = new Set(validExerciseRows.rows.map((row) => Number(row.id)));
    if (replacementExerciseIds.some((exerciseId) => !validExerciseIds.has(exerciseId))) {
      return { ok: false, error: 'Replacement exercise was not found in your organization.' };
    }
  }

  const templateRows = await pool.query<{
    workout_exercise_index: number;
    exercise_id: number | null;
    prescribed_sets: string | null;
    prescribed_reps: string | null;
    prescribed_load: string | null;
    notes: string | null;
  }>(
    `
      SELECT
        ROW_NUMBER() OVER (ORDER BY we.sort_order, e.name) - 1 AS workout_exercise_index,
        we.exercise_id,
        we.prescribed_sets,
        we.prescribed_reps,
        we.prescribed_load,
        we.notes
      FROM workout_exercises we
      LEFT JOIN exercise_library e ON e.id = we.exercise_id
      WHERE we.workout_id = $1
      ORDER BY we.sort_order, e.name
    `,
    [workoutId]
  );
  const templateByIndex = new Map(
    templateRows.rows.map((row) => [
      Number(row.workout_exercise_index),
      {
        exerciseId: Number(row.exercise_id ?? 0) > 0 ? Number(row.exercise_id) : null,
        prescribedSets: cleanOverrideText(row.prescribed_sets),
        prescribedReps: cleanOverrideText(row.prescribed_reps),
        prescribedLoad: cleanOverrideText(row.prescribed_load),
        notes: cleanOverrideText(row.notes),
      },
    ])
  );
  const changed = cleaned.filter((override) => {
    const template = templateByIndex.get(override.workoutExerciseIndex);
    if (!template) return true;
    return (
      override.exerciseId !== template.exerciseId ||
      override.prescribedSets !== template.prescribedSets ||
      override.prescribedReps !== template.prescribedReps ||
      override.prescribedLoad !== template.prescribedLoad ||
      override.notes !== template.notes
    );
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM program_workout_exercise_overrides WHERE program_day_item_id = $1`, [input.programDayItemId]);
    for (const override of changed) {
      await client.query(
        `
          INSERT INTO program_workout_exercise_overrides (
            organization_id,
            player_id,
            workout_id,
            program_day_item_id,
            workout_exercise_index,
            exercise_id,
            prescribed_sets,
            prescribed_reps,
            prescribed_load,
            notes,
            updated_by_user_id,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          ON CONFLICT (program_day_item_id, workout_exercise_index)
          DO UPDATE SET
            exercise_id = EXCLUDED.exercise_id,
            prescribed_sets = EXCLUDED.prescribed_sets,
            prescribed_reps = EXCLUDED.prescribed_reps,
            prescribed_load = EXCLUDED.prescribed_load,
            notes = EXCLUDED.notes,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = NOW()
        `,
        [
          input.organizationId,
          input.playerId,
          workoutId,
          input.programDayItemId,
          override.workoutExerciseIndex,
          override.exerciseId,
          override.prescribedSets,
          override.prescribedReps,
          override.prescribedLoad,
          override.notes,
          input.userId,
        ]
      );
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to save workout customizations.' };
  } finally {
    client.release();
  }
}

/** Same behavior as saveProgramWorkoutExerciseOverrides but for a Training
 * Program (plan) item -- plan items carry player_id/organization_id
 * directly, so ownership validation is a single-table lookup instead of the
 * calendar path's program_day_items -> program_days -> programs join. */
export async function savePlanWorkoutExerciseOverrides(input: {
  organizationId: number;
  playerId: number;
  programPlanItemId: number;
  userId: number | null;
  overrides: WorkoutExerciseOverrideInput[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const itemCheck = await pool.query<{ workout_id: number | null }>(
    `
      SELECT workout_id
      FROM program_plan_items
      WHERE id = $1
        AND player_id = $2
        AND organization_id = $3
      LIMIT 1
    `,
    [input.programPlanItemId, input.playerId, input.organizationId]
  );
  const workoutId = Number(itemCheck.rows[0]?.workout_id ?? 0);
  if ((itemCheck.rowCount ?? 0) !== 1 || !Number.isFinite(workoutId) || workoutId <= 0) {
    return { ok: false, error: 'Training Program item was not found.' };
  }

  const cleaned = input.overrides
    .map((override) => ({
      workoutExerciseIndex: Math.floor(Number(override.workoutExerciseIndex)),
      exerciseId: Number.isFinite(Number(override.exerciseId ?? 0)) && Number(override.exerciseId ?? 0) > 0 ? Math.floor(Number(override.exerciseId)) : null,
      prescribedSets: cleanOverrideText(override.prescribedSets),
      prescribedReps: cleanOverrideText(override.prescribedReps),
      prescribedLoad: cleanOverrideText(override.prescribedLoad),
      notes: cleanOverrideText(override.notes),
    }))
    .filter((override) => Number.isFinite(override.workoutExerciseIndex) && override.workoutExerciseIndex >= 0)
    .slice(0, 200);

  const replacementExerciseIds = Array.from(new Set(cleaned.map((override) => override.exerciseId).filter((id): id is number => Number.isFinite(Number(id)) && Number(id) > 0)));
  if (replacementExerciseIds.length > 0) {
    const validExerciseRows = await pool.query<{ id: number }>(
      `
        SELECT id
        FROM exercise_library
        WHERE organization_id = $1
          AND id = ANY($2::int[])
      `,
      [input.organizationId, replacementExerciseIds]
    );
    const validExerciseIds = new Set(validExerciseRows.rows.map((row) => Number(row.id)));
    if (replacementExerciseIds.some((exerciseId) => !validExerciseIds.has(exerciseId))) {
      return { ok: false, error: 'Replacement exercise was not found in your organization.' };
    }
  }

  const templateRows = await pool.query<{
    workout_exercise_index: number;
    exercise_id: number | null;
    prescribed_sets: string | null;
    prescribed_reps: string | null;
    prescribed_load: string | null;
    notes: string | null;
  }>(
    `
      SELECT
        ROW_NUMBER() OVER (ORDER BY we.sort_order, e.name) - 1 AS workout_exercise_index,
        we.exercise_id,
        we.prescribed_sets,
        we.prescribed_reps,
        we.prescribed_load,
        we.notes
      FROM workout_exercises we
      LEFT JOIN exercise_library e ON e.id = we.exercise_id
      WHERE we.workout_id = $1
      ORDER BY we.sort_order, e.name
    `,
    [workoutId]
  );
  const templateByIndex = new Map(
    templateRows.rows.map((row) => [
      Number(row.workout_exercise_index),
      {
        exerciseId: Number(row.exercise_id ?? 0) > 0 ? Number(row.exercise_id) : null,
        prescribedSets: cleanOverrideText(row.prescribed_sets),
        prescribedReps: cleanOverrideText(row.prescribed_reps),
        prescribedLoad: cleanOverrideText(row.prescribed_load),
        notes: cleanOverrideText(row.notes),
      },
    ])
  );
  const changed = cleaned.filter((override) => {
    const template = templateByIndex.get(override.workoutExerciseIndex);
    if (!template) return true;
    return (
      override.exerciseId !== template.exerciseId ||
      override.prescribedSets !== template.prescribedSets ||
      override.prescribedReps !== template.prescribedReps ||
      override.prescribedLoad !== template.prescribedLoad ||
      override.notes !== template.notes
    );
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM program_plan_item_exercise_overrides WHERE program_plan_item_id = $1`, [input.programPlanItemId]);
    for (const override of changed) {
      await client.query(
        `
          INSERT INTO program_plan_item_exercise_overrides (
            organization_id,
            player_id,
            workout_id,
            program_plan_item_id,
            workout_exercise_index,
            exercise_id,
            prescribed_sets,
            prescribed_reps,
            prescribed_load,
            notes,
            updated_by_user_id,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          ON CONFLICT (program_plan_item_id, workout_exercise_index)
          DO UPDATE SET
            exercise_id = EXCLUDED.exercise_id,
            prescribed_sets = EXCLUDED.prescribed_sets,
            prescribed_reps = EXCLUDED.prescribed_reps,
            prescribed_load = EXCLUDED.prescribed_load,
            notes = EXCLUDED.notes,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = NOW()
        `,
        [
          input.organizationId,
          input.playerId,
          workoutId,
          input.programPlanItemId,
          override.workoutExerciseIndex,
          override.exerciseId,
          override.prescribedSets,
          override.prescribedReps,
          override.prescribedLoad,
          override.notes,
          input.userId,
        ]
      );
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to save workout customizations.' };
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
    calendar_link_target: string | null;
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
      WITH selected_items AS (
        SELECT i.id AS item_id, i.workout_id
        FROM programs p
        JOIN program_days d ON d.program_id = p.id
        JOIN program_day_items i ON i.program_day_id = d.id
        WHERE p.player_id = $1
          AND d.day_date >= $2::date
          AND d.day_date < $3::date
          AND i.workout_id IS NOT NULL
      ),
      workout_rows AS (
        SELECT
          si.item_id,
          si.workout_id,
          we2.exercise_id,
          we2.exercise_prefix,
          we2.prescribed_sets,
          we2.prescribed_reps,
          we2.prescribed_load,
          we2.notes,
          we2.sort_order,
          e2.name,
          e2.category,
          e2.rep_measure,
          e2.tracking_type,
          e2.reps_per_side,
          e2.instruction_video_url,
          e2.description,
          e2.coaching_cues,
          ROW_NUMBER() OVER (PARTITION BY si.item_id ORDER BY we2.sort_order, e2.name) - 1 AS workout_exercise_index
        FROM selected_items si
        LEFT JOIN workout_exercises we2 ON we2.workout_id = si.workout_id
        LEFT JOIN exercise_library e2 ON e2.id = we2.exercise_id
      ),
      workout_summaries AS (
        SELECT
          wr.item_id,
          STRING_AGG(
            CASE
              WHEN wr.exercise_prefix IS NOT NULL AND LENGTH(TRIM(wr.exercise_prefix)) > 0
                THEN CONCAT(TRIM(wr.exercise_prefix), ': ', COALESCE(oe.name, wr.name))
              ELSE COALESCE(oe.name, wr.name)
            END,
            ', '
            ORDER BY wr.sort_order, COALESCE(oe.name, wr.name)
          ) AS exercise_names,
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'workoutExerciseIndex', wr.workout_exercise_index,
                'exerciseId', COALESCE(o.exercise_id, wr.exercise_id),
                'prefix', wr.exercise_prefix,
                'name', COALESCE(oe.name, wr.name),
                'category', COALESCE(oe.category, wr.category),
                'repMeasure', COALESCE(oe.rep_measure, wr.rep_measure),
                'trackingType', COALESCE(oe.tracking_type, wr.tracking_type),
                'repsPerSide', COALESCE(oe.reps_per_side, wr.reps_per_side),
                'prescribedSets', COALESCE(o.prescribed_sets, wr.prescribed_sets),
                'prescribedReps', COALESCE(o.prescribed_reps, wr.prescribed_reps),
                'prescribedLoad', COALESCE(o.prescribed_load, wr.prescribed_load),
                'notes', COALESCE(o.notes, wr.notes),
                'templateExerciseId', wr.exercise_id,
                'templatePrescribedSets', wr.prescribed_sets,
                'templatePrescribedReps', wr.prescribed_reps,
                'templatePrescribedLoad', wr.prescribed_load,
                'templateNotes', wr.notes,
                'isCustomized', o.id IS NOT NULL,
                'instructionVideoUrl', COALESCE(oe.instruction_video_url, wr.instruction_video_url),
                'description', COALESCE(oe.description, wr.description),
                'coachingCues', COALESCE(oe.coaching_cues, wr.coaching_cues)
              )
              ORDER BY wr.sort_order, COALESCE(oe.name, wr.name)
            ) FILTER (WHERE COALESCE(o.exercise_id, wr.exercise_id) IS NOT NULL),
            '[]'::json
          ) AS exercise_json
        FROM workout_rows wr
        LEFT JOIN program_workout_exercise_overrides o
          ON o.program_day_item_id = wr.item_id
          AND o.workout_exercise_index = wr.workout_exercise_index
        LEFT JOIN exercise_library oe ON oe.id = o.exercise_id
        GROUP BY wr.item_id
      )
      SELECT
        i.id AS item_id,
        d.day_date::text,
        CASE WHEN i.workout_id IS NOT NULL THEN 'workout' ELSE 'exercise' END::text AS item_type,
        i.exercise_id,
        i.workout_id,
        w.category AS workout_category,
        w.calendar_link_target,
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
      LEFT JOIN workout_summaries ws ON ws.item_id = i.id
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
    planSection: null,
    targetCount: null,
    completedCount: null,
    planItemAddedAt: null,
    itemType: row.item_type === 'workout' ? 'workout' : 'exercise',
    itemName: row.item_name,
    workoutDescription: row.workout_description,
    exerciseId: row.exercise_id,
    workoutId: row.workout_id,
    workoutCategory: row.workout_category,
    calendarLinkTarget: normalizeCalendarLinkTarget(row.calendar_link_target),
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

// program_cycle_items / program_plan_items are recurring assignments (unlike
// program_day_items, which get a fresh row per calendar day), so "what did
// they last log for this item" must be scoped to today or a stale value from
// a prior day leaks into a brand-new session as a pre-filled default. Uses
// the same America/Phoenix day boundary as the questionnaire helpers below
// (todayIsoForQuestionnaires) since the app has no per-org timezone config.
const PROGRAM_LOG_DAY_TIME_ZONE = 'America/Phoenix';

function todayIsoForProgramLogs(): string {
  return isoDateInTimeZone(new Date(), PROGRAM_LOG_DAY_TIME_ZONE);
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
    calendar_link_target: string | null;
    workout_exercise_names: string | null;
    workout_exercise_json: unknown;
    completed: boolean | null;
    performed_sets: string | null;
    performed_reps: string | null;
    performed_load: string | null;
    log_notes: string | null;
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
                'prescribedLoad', we2.prescribed_load,
                'notes', we2.notes,
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
        w.calendar_link_target,
        ws.exercise_names AS workout_exercise_names,
        ws.exercise_json AS workout_exercise_json,
        h.completed,
        h.performed_sets,
        h.performed_reps,
        h.performed_load,
        h.notes AS log_notes
      FROM program_cycle_items ci
      JOIN workout_library w ON w.id = ci.workout_id
      LEFT JOIN workout_summaries ws ON ws.workout_id = ci.workout_id
      LEFT JOIN LATERAL (
        SELECT
          eh.completed,
          eh.performed_sets,
          eh.performed_reps,
          eh.performed_load,
          eh.notes
        FROM exercise_log_history eh
        WHERE eh.player_id = ci.player_id
          AND eh.schedule_type = 'cycle'
          AND eh.cycle_item_id = ci.id
          AND (eh.logged_at AT TIME ZONE 'America/Phoenix')::date = $2::date
        ORDER BY eh.logged_at DESC, eh.id DESC
        LIMIT 1
      ) h ON TRUE
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
    [input.playerId, todayIsoForProgramLogs()]
  );

  const dayDate = todayIsoForProgramLogs();

  return result.rows.map((row) => ({
    workoutExercises: Array.isArray(row.workout_exercise_json)
      ? (row.workout_exercise_json as WorkoutExerciseAssignment[])
      : [],
    itemId: row.item_id,
    dayDate,
    scheduleType: 'cycle',
    cycleSlot: row.cycle_slot,
    planSection: null,
    targetCount: null,
    completedCount: null,
    planItemAddedAt: null,
    itemType: 'workout',
    itemName: row.workout_name,
    workoutDescription: row.workout_description,
    exerciseId: null,
    workoutId: row.workout_id,
    workoutCategory: row.workout_category,
    calendarLinkTarget: normalizeCalendarLinkTarget(row.calendar_link_target),
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
    completed: Boolean(row.completed),
    performedSets: row.performed_sets,
    performedReps: row.performed_reps,
    performedLoad: row.performed_load,
    logNotes: row.log_notes,
    programName: '3-Day Cycle',
  }));
}

// Coach-only fields (targetCount, completedCount, and every plan section
// note) are computed here unconditionally -- the API route is what strips
// them for a player-role session, not this function. Keeping the
// computation here and the access decision in the route keeps the
// role-check in exactly one place per caller, matching how canManagePlayer
// gating already works for the rest of this file.
export async function listPlanProgramItemsForPlayer(input: { playerId: number }): Promise<ProgramItemRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query<{
    item_id: number;
    plan_section: ProgramPlanSection;
    target_count: number | null;
    workout_id: number;
    workout_name: string;
    workout_category: string | null;
    workout_description: string | null;
    calendar_link_target: string | null;
    workout_exercise_names: string | null;
    workout_exercise_json: unknown;
    completed: boolean | null;
    performed_sets: string | null;
    performed_reps: string | null;
    performed_load: string | null;
    log_notes: string | null;
    completed_count: string;
    added_at: string;
  }>(
    `
      WITH selected_items AS (
        SELECT pi.id AS item_id, pi.workout_id
        FROM program_plan_items pi
        WHERE pi.player_id = $1
      ),
      workout_rows AS (
        SELECT
          si.item_id,
          si.workout_id,
          we2.exercise_id,
          we2.exercise_prefix,
          we2.prescribed_sets,
          we2.prescribed_reps,
          we2.prescribed_load,
          we2.notes,
          we2.sort_order,
          e2.name,
          e2.category,
          e2.rep_measure,
          e2.tracking_type,
          e2.reps_per_side,
          e2.instruction_video_url,
          e2.description,
          e2.coaching_cues,
          ROW_NUMBER() OVER (PARTITION BY si.item_id ORDER BY we2.sort_order, e2.name) - 1 AS workout_exercise_index
        FROM selected_items si
        LEFT JOIN workout_exercises we2 ON we2.workout_id = si.workout_id
        LEFT JOIN exercise_library e2 ON e2.id = we2.exercise_id
      ),
      workout_summaries AS (
        SELECT
          wr.item_id,
          STRING_AGG(
            CASE
              WHEN wr.exercise_prefix IS NOT NULL AND LENGTH(TRIM(wr.exercise_prefix)) > 0
                THEN CONCAT(TRIM(wr.exercise_prefix), ': ', COALESCE(oe.name, wr.name))
              ELSE COALESCE(oe.name, wr.name)
            END,
            ', '
            ORDER BY wr.sort_order, COALESCE(oe.name, wr.name)
          ) AS exercise_names,
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'workoutExerciseIndex', wr.workout_exercise_index,
                'exerciseId', COALESCE(o.exercise_id, wr.exercise_id),
                'prefix', wr.exercise_prefix,
                'name', COALESCE(oe.name, wr.name),
                'category', COALESCE(oe.category, wr.category),
                'repMeasure', COALESCE(oe.rep_measure, wr.rep_measure),
                'trackingType', COALESCE(oe.tracking_type, wr.tracking_type),
                'repsPerSide', COALESCE(oe.reps_per_side, wr.reps_per_side),
                'prescribedSets', COALESCE(o.prescribed_sets, wr.prescribed_sets),
                'prescribedReps', COALESCE(o.prescribed_reps, wr.prescribed_reps),
                'prescribedLoad', COALESCE(o.prescribed_load, wr.prescribed_load),
                'notes', COALESCE(o.notes, wr.notes),
                'templateExerciseId', wr.exercise_id,
                'templatePrescribedSets', wr.prescribed_sets,
                'templatePrescribedReps', wr.prescribed_reps,
                'templatePrescribedLoad', wr.prescribed_load,
                'templateNotes', wr.notes,
                'isCustomized', o.id IS NOT NULL,
                'instructionVideoUrl', COALESCE(oe.instruction_video_url, wr.instruction_video_url),
                'description', COALESCE(oe.description, wr.description),
                'coachingCues', COALESCE(oe.coaching_cues, wr.coaching_cues)
              )
              ORDER BY wr.sort_order, COALESCE(oe.name, wr.name)
            ) FILTER (WHERE COALESCE(o.exercise_id, wr.exercise_id) IS NOT NULL),
            '[]'::json
          ) AS exercise_json
        FROM workout_rows wr
        LEFT JOIN program_plan_item_exercise_overrides o
          ON o.program_plan_item_id = wr.item_id
          AND o.workout_exercise_index = wr.workout_exercise_index
        LEFT JOIN exercise_library oe ON oe.id = o.exercise_id
        GROUP BY wr.item_id
      )
      SELECT
        pi.id AS item_id,
        pi.plan_section,
        pi.target_count,
        pi.created_at::text AS added_at,
        w.id AS workout_id,
        w.name AS workout_name,
        w.category AS workout_category,
        w.description AS workout_description,
        w.calendar_link_target,
        ws.exercise_names AS workout_exercise_names,
        ws.exercise_json AS workout_exercise_json,
        latest.completed,
        latest.performed_sets,
        latest.performed_reps,
        latest.performed_load,
        latest.notes AS log_notes,
        COALESCE(counts.completed_count, 0) AS completed_count
      FROM program_plan_items pi
      JOIN workout_library w ON w.id = pi.workout_id
      LEFT JOIN workout_summaries ws ON ws.item_id = pi.id
      LEFT JOIN LATERAL (
        SELECT
          eh.completed,
          eh.performed_sets,
          eh.performed_reps,
          eh.performed_load,
          eh.notes
        FROM exercise_log_history eh
        WHERE eh.player_id = pi.player_id
          AND eh.schedule_type = 'plan'
          AND eh.plan_item_id = pi.id
          AND (eh.logged_at AT TIME ZONE 'America/Phoenix')::date = $2::date
        ORDER BY eh.logged_at DESC, eh.id DESC
        LIMIT 1
      ) latest ON TRUE
      LEFT JOIN LATERAL (
        -- Counts distinct calendar days with a completed log, not raw log
        -- rows -- opening/closing and re-saving the same workout multiple
        -- times in one day (or on a re-visit later that day) must only add
        -- 1 toward the tally, never more.
        SELECT COUNT(DISTINCT eh.logged_at::date) AS completed_count
        FROM exercise_log_history eh
        WHERE eh.player_id = pi.player_id
          AND eh.schedule_type = 'plan'
          AND eh.plan_item_id = pi.id
          AND eh.completed = TRUE
      ) counts ON TRUE
      WHERE pi.player_id = $1
      ORDER BY
        CASE pi.plan_section
          WHEN 'daily_prep' THEN 1
          WHEN 'throwing' THEN 2
          WHEN 'post_throw_arm_care' THEN 3
          WHEN 's_and_c' THEN 4
          WHEN 'movement_mobility' THEN 5
          ELSE 6
        END ASC,
        pi.sort_order ASC,
        pi.id ASC
    `,
    [input.playerId, todayIsoForProgramLogs()]
  );

  const dayDate = todayIsoForProgramLogs();

  return result.rows.map((row) => ({
    workoutExercises: Array.isArray(row.workout_exercise_json)
      ? (row.workout_exercise_json as WorkoutExerciseAssignment[])
      : [],
    itemId: row.item_id,
    dayDate,
    scheduleType: 'plan',
    cycleSlot: null,
    planSection: row.plan_section,
    targetCount: row.target_count,
    completedCount: Number(row.completed_count) || 0,
    planItemAddedAt: row.added_at,
    itemType: 'workout',
    itemName: row.workout_name,
    workoutDescription: row.workout_description,
    exerciseId: null,
    workoutId: row.workout_id,
    workoutCategory: row.workout_category,
    calendarLinkTarget: normalizeCalendarLinkTarget(row.calendar_link_target),
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
    completed: Boolean(row.completed),
    performedSets: row.performed_sets,
    performedReps: row.performed_reps,
    performedLoad: row.performed_load,
    logNotes: row.log_notes,
    programName: 'Plan',
  }));
}

export async function addPlanWorkoutAssignment(input: {
  organizationId: number;
  userId: number;
  playerId: number;
  workoutId: number;
  planSection: string;
  targetCount?: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const section = normalizePlanSection(input.planSection);
  if (!section) return { ok: false, error: 'Plan section must be daily_prep, throwing, post_throw_arm_care, s_and_c, or movement_mobility.' };
  const targetCount = input.targetCount != null && Number.isFinite(input.targetCount) && input.targetCount > 0 ? Math.trunc(input.targetCount) : null;

  const workout = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM workout_library
      WHERE id = $1 AND organization_id = ANY(ARRAY[$2, $3]::int[])
      LIMIT 1
    `,
    [input.workoutId, input.organizationId, PCU_TEMPLATE_ORGANIZATION_ID]
  );
  if ((workout.rowCount ?? 0) !== 1) return { ok: false, error: 'Workout was not found.' };

  const nextOrder = await pool.query<{ next_order: number }>(
    `
      SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
      FROM program_plan_items
      WHERE player_id = $1 AND plan_section = $2
    `,
    [input.playerId, section]
  );

  await pool.query(
    `
      INSERT INTO program_plan_items (
        organization_id, player_id, plan_section, workout_id, sort_order, target_count, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [input.organizationId, input.playerId, section, input.workoutId, Number(nextOrder.rows[0]?.next_order ?? 1), targetCount, input.userId]
  );

  return { ok: true };
}

export async function updatePlanItemTargetCount(input: {
  organizationId: number;
  playerId: number;
  itemId: number;
  targetCount: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const targetCount = input.targetCount != null && Number.isFinite(input.targetCount) && input.targetCount > 0 ? Math.trunc(input.targetCount) : null;

  const result = await pool.query(
    `
      UPDATE program_plan_items
      SET target_count = $1, updated_at = NOW()
      WHERE id = $2 AND organization_id = $3 AND player_id = $4
    `,
    [targetCount, input.itemId, input.organizationId, input.playerId]
  );
  if ((result.rowCount ?? 0) !== 1) return { ok: false, error: 'Plan item not found.' };
  return { ok: true };
}

export async function movePlanProgramItem(input: {
  organizationId: number;
  playerId: number;
  itemId: number;
  targetSection: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const section = normalizePlanSection(input.targetSection);
  if (!section) return { ok: false, error: 'Plan section must be daily_prep, throwing, post_throw_arm_care, s_and_c, or movement_mobility.' };
  if (!Number.isFinite(input.itemId) || input.itemId <= 0) return { ok: false, error: 'Valid itemId is required.' };

  const existing = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM program_plan_items
      WHERE id = $1 AND organization_id = $2 AND player_id = $3
      LIMIT 1
    `,
    [input.itemId, input.organizationId, input.playerId]
  );
  if ((existing.rowCount ?? 0) !== 1) return { ok: false, error: 'Plan item not found.' };

  const nextOrder = await pool.query<{ next_order: number }>(
    `
      SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
      FROM program_plan_items
      WHERE player_id = $1 AND plan_section = $2
    `,
    [input.playerId, section]
  );

  await pool.query(
    `
      UPDATE program_plan_items
      SET plan_section = $1, sort_order = $2, updated_at = NOW()
      WHERE id = $3
    `,
    [section, Number(nextOrder.rows[0]?.next_order ?? 1), input.itemId]
  );

  return { ok: true };
}

// Mirrors reorderProgramDayItems' validate-then-transactional-update shape,
// but scoped to a player+section (plan items are recurring, not date-bound,
// so there's no program_days/day_date join here -- the whole section's
// current member set is the equivalent of "that day's items").
export async function reorderPlanProgramItems(input: {
  organizationId: number;
  playerId: number;
  planSection: string;
  orderedItemIds: number[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const section = normalizePlanSection(input.planSection);
  if (!section) return { ok: false, error: 'Plan section must be daily_prep, throwing, post_throw_arm_care, s_and_c, or movement_mobility.' };
  const itemIds = input.orderedItemIds.filter((id) => Number.isFinite(id) && id > 0);
  if (itemIds.length === 0) return { ok: false, error: 'No items to reorder.' };

  const result = await pool.query<{ item_id: number }>(
    `
      SELECT id AS item_id
      FROM program_plan_items
      WHERE organization_id = $1 AND player_id = $2 AND plan_section = $3
      ORDER BY sort_order ASC, id ASC
    `,
    [input.organizationId, input.playerId, section]
  );

  const existingIds = result.rows.map((row) => row.item_id);
  if (existingIds.length !== itemIds.length) return { ok: false, error: 'Reorder payload does not match section items.' };
  const existingSet = new Set(existingIds);
  if (itemIds.some((id) => !existingSet.has(id))) return { ok: false, error: 'One or more items are invalid for that section.' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let sortOrder = 1;
    for (const itemId of itemIds) {
      await client.query(`UPDATE program_plan_items SET sort_order = $1, updated_at = NOW() WHERE id = $2`, [sortOrder, itemId]);
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

export async function deletePlanProgramItem(input: {
  organizationId: number;
  playerId: number;
  itemId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query(
    `
      DELETE FROM program_plan_items
      WHERE id = $1 AND organization_id = $2 AND player_id = $3
    `,
    [input.itemId, input.organizationId, input.playerId]
  );
  if ((result.rowCount ?? 0) !== 1) return { ok: false, error: 'Plan item not found.' };
  return { ok: true };
}

function emptyPlanSectionNotes(): Record<ProgramPlanSection, string> {
  return {
    daily_prep: '',
    throwing: '',
    post_throw_arm_care: '',
    s_and_c: '',
    movement_mobility: '',
  };
}

// Notifies every admin/coach in the org when a player's completion count
// for a Training Program item is at or past its target -- fires on every
// qualifying completion (not just the first time target is reached), per
// product decision. Callers should fire-and-forget this (it already
// swallows its own errors) since a missed notification shouldn't fail the
// underlying workout-log write.
async function notifyStaffOnPlanTargetReached(input: {
  organizationId: number;
  playerId: number;
  planItemId: number;
  targetCount: number;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();

  const countResult = await pool.query<{ completed_count: string }>(
    `
      SELECT COUNT(DISTINCT logged_at::date) AS completed_count
      FROM exercise_log_history
      WHERE player_id = $1
        AND schedule_type = 'plan'
        AND plan_item_id = $2
        AND completed = TRUE
    `,
    [input.playerId, input.planItemId]
  );
  const completedCount = Number(countResult.rows[0]?.completed_count ?? 0);
  if (completedCount < input.targetCount) return;

  const contextResult = await pool.query<{ player_name: string; workout_name: string; plan_section: ProgramPlanSection }>(
    `
      SELECT p.full_name AS player_name, w.name AS workout_name, pi.plan_section
      FROM program_plan_items pi
      JOIN players p ON p.id = pi.player_id
      JOIN workout_library w ON w.id = pi.workout_id
      WHERE pi.id = $1
      LIMIT 1
    `,
    [input.planItemId]
  );
  const context = contextResult.rows[0];
  if (!context) return;

  const recipientsResult = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM auth_users
      WHERE organization_id = $1
        AND role IN ('admin', 'coach')
        AND is_active IS NOT FALSE
    `,
    [input.organizationId]
  );
  const recipientUserIds = recipientsResult.rows.map((row) => row.id);
  if (recipientUserIds.length === 0) return;

  const sectionLabel = TRAINING_PROGRAM_SECTION_LABELS[context.plan_section] ?? context.plan_section;
  const title = `${context.player_name} completed a Training Program goal`;
  const detail = `${context.workout_name} (${sectionLabel}): ${completedCount}/${input.targetCount} times completed.`;

  await createNotificationsForUsers({
    recipientUserIds,
    eventType: 'plan_target_reached',
    title,
    detail,
    path: '/portal/player/program',
    playerId: input.playerId,
    playerName: context.player_name,
  });

  const { sendPushNotificationToUsers } = await import('./push-notifications');
  await sendPushNotificationToUsers({
    userIds: recipientUserIds,
    title,
    body: detail,
    data: { type: 'plan_target_reached', playerId: input.playerId, planItemId: input.planItemId },
  }).catch(() => {});
}

// Player-specific note wins when non-empty; otherwise falls back to the
// org-wide standard note for that section. A player-specific row that's
// present but blank (coach cleared it) is treated the same as "no row at
// all" -- it still falls back to the standard note, per product decision.
export async function getPlanSectionNotes(input: { organizationId: number; playerId: number }): Promise<Record<ProgramPlanSection, string>> {
  const empty = emptyPlanSectionNotes();
  if (!isDatabaseConfigured()) return empty;
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const [playerResult, defaultResult] = await Promise.all([
    pool.query<{ plan_section: ProgramPlanSection; note_text: string }>(
      `SELECT plan_section, note_text FROM program_plan_section_notes WHERE player_id = $1`,
      [input.playerId]
    ),
    pool.query<{ plan_section: ProgramPlanSection; note_text: string }>(
      `SELECT plan_section, note_text FROM program_plan_section_default_notes WHERE organization_id = $1`,
      [input.organizationId]
    ),
  ]);

  const notes = { ...empty };
  for (const row of defaultResult.rows) {
    notes[row.plan_section] = row.note_text;
  }
  for (const row of playerResult.rows) {
    if (row.note_text.trim()) notes[row.plan_section] = row.note_text;
  }
  return notes;
}

// The raw per-player override only (no fallback to the org default) -- used
// by the coach builder's editable note field, where an empty box must mean
// "no override set" rather than showing the merged/effective text (which
// would make saving silently write the default text back as a real
// per-player override the first time the field loses focus).
export async function getRawPlanSectionNotes(input: { playerId: number }): Promise<Record<ProgramPlanSection, string>> {
  const empty = emptyPlanSectionNotes();
  if (!isDatabaseConfigured()) return empty;
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query<{ plan_section: ProgramPlanSection; note_text: string }>(
    `SELECT plan_section, note_text FROM program_plan_section_notes WHERE player_id = $1`,
    [input.playerId]
  );
  const notes = { ...empty };
  for (const row of result.rows) {
    notes[row.plan_section] = row.note_text;
  }
  return notes;
}

export async function setPlanSectionNote(input: {
  organizationId: number;
  playerId: number;
  planSection: string;
  noteText: string;
  updatedByUserId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const section = normalizePlanSection(input.planSection);
  if (!section) return { ok: false, error: 'Plan section must be daily_prep, throwing, post_throw_arm_care, s_and_c, or movement_mobility.' };

  await pool.query(
    `
      INSERT INTO program_plan_section_notes (organization_id, player_id, plan_section, note_text, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (player_id, plan_section)
      DO UPDATE SET note_text = EXCLUDED.note_text, updated_by = EXCLUDED.updated_by, updated_at = NOW()
    `,
    [input.organizationId, input.playerId, section, input.noteText.trim(), input.updatedByUserId]
  );
  return { ok: true };
}

// The org-wide standard note shown for every player without their own
// non-empty override -- see getPlanSectionNotes.
export async function getPlanSectionDefaultNotes(input: { organizationId: number }): Promise<Record<ProgramPlanSection, string>> {
  const empty = emptyPlanSectionNotes();
  if (!isDatabaseConfigured()) return empty;
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query<{ plan_section: ProgramPlanSection; note_text: string }>(
    `SELECT plan_section, note_text FROM program_plan_section_default_notes WHERE organization_id = $1`,
    [input.organizationId]
  );
  const notes = { ...empty };
  for (const row of result.rows) {
    notes[row.plan_section] = row.note_text;
  }
  return notes;
}

export async function setPlanSectionDefaultNote(input: {
  organizationId: number;
  planSection: string;
  noteText: string;
  updatedByUserId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const section = normalizePlanSection(input.planSection);
  if (!section) return { ok: false, error: 'Plan section must be daily_prep, throwing, post_throw_arm_care, s_and_c, or movement_mobility.' };

  await pool.query(
    `
      INSERT INTO program_plan_section_default_notes (organization_id, plan_section, note_text, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (organization_id, plan_section)
      DO UPDATE SET note_text = EXCLUDED.note_text, updated_by = EXCLUDED.updated_by, updated_at = NOW()
    `,
    [input.organizationId, section, input.noteText.trim(), input.updatedByUserId]
  );
  return { ok: true };
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
      WHERE id = $1 AND organization_id = ANY(ARRAY[$2, $3]::int[])
      LIMIT 1
    `,
    [input.workoutId, input.organizationId, PCU_TEMPLATE_ORGANIZATION_ID]
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

export async function deleteCycleProgramItem(input: {
  organizationId: number;
  playerId: number;
  itemId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  if (!Number.isFinite(input.itemId) || input.itemId <= 0) return { ok: false, error: 'Valid itemId is required.' };

  const deleted = await pool.query<{ cycle_slot: 'medium' | 'high' | 'low' | 'mobility' | 's_and_c' }>(
    `
      DELETE FROM program_cycle_items
      WHERE id = $1
        AND organization_id = $2
        AND player_id = $3
      RETURNING cycle_slot
    `,
    [input.itemId, input.organizationId, input.playerId]
  );
  if ((deleted.rowCount ?? 0) !== 1) return { ok: false, error: 'Cycle item not found.' };

  const slot = deleted.rows[0]?.cycle_slot;
  if (slot) {
    await pool.query(
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
      [input.playerId, slot]
    );
  }

  return { ok: true };
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
          COALESCE(w.name, cw.name, pw.name, e.name, 'Assignment') AS source_name,
          i.exercise_id,
          i.prescribed_reps,
          COALESCE(e.rep_measure, 'reps') AS rep_measure,
          COALESCE(e.tracking_type, 'lbs') AS tracking_type,
          COALESCE(e.reps_per_side, FALSE) AS reps_per_side,
          h.performed_load,
          CASE
            WHEN h.schedule_type = 'cycle' THEN cws.exercise_json
            WHEN h.schedule_type = 'plan' THEN pws.exercise_json
            ELSE ws.exercise_json
          END AS workout_exercise_json
        FROM exercise_log_history h
        LEFT JOIN program_day_items i ON i.id = h.program_day_item_id
        LEFT JOIN program_days d ON d.id = i.program_day_id
        LEFT JOIN exercise_library e ON e.id = i.exercise_id
        LEFT JOIN workout_library w ON w.id = i.workout_id
        LEFT JOIN program_cycle_items ci ON ci.id = h.cycle_item_id
        LEFT JOIN workout_library cw ON cw.id = ci.workout_id
        LEFT JOIN program_plan_items pi2 ON pi2.id = h.plan_item_id
        LEFT JOIN workout_library pw ON pw.id = pi2.workout_id
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              JSON_AGG(
                JSON_BUILD_OBJECT(
                  'exerciseId', e2.id,
                  'prescribedSets', we2.prescribed_sets,
                  'prescribedReps', we2.prescribed_reps,
                  'prescribedLoad', we2.prescribed_load,
                  'notes', we2.notes,
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
          WHERE we2.workout_id = pi2.workout_id
        ) pws ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              JSON_AGG(
                JSON_BUILD_OBJECT(
                  'exerciseId', e2.id,
                  'prescribedSets', we2.prescribed_sets,
                  'prescribedReps', we2.prescribed_reps,
                  'prescribedLoad', we2.prescribed_load,
                  'notes', we2.notes,
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
                  'prescribedLoad', we2.prescribed_load,
                  'notes', we2.notes,
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
          AND COALESCE(LOWER(w.category), LOWER(cw.category), LOWER(pw.category), '') <> 'assessment'
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
            OR EXISTS (
              SELECT 1
              FROM workout_exercises wx
              WHERE wx.workout_id = pi2.workout_id
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
                  'prescribedLoad', we2.prescribed_load,
                  'notes', we2.notes,
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
  scheduleType?: 'calendar' | 'cycle' | 'plan';
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
  const scheduleType = input.scheduleType === 'cycle' ? 'cycle' : input.scheduleType === 'plan' ? 'plan' : 'calendar';
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

  if (scheduleType === 'plan') {
    const allowedItem = await pool.query<{ id: number; organization_id: number; target_count: number | null }>(
      `
        SELECT id, organization_id, target_count
        FROM program_plan_items
        WHERE id = $1 AND player_id = $2
        LIMIT 1
      `,
      [input.itemId, input.playerId]
    );
    if ((allowedItem.rowCount ?? 0) !== 1) throw new Error('Plan item not assigned to player.');
    const planItem = allowedItem.rows[0];

    await pool.query(
      `
        INSERT INTO exercise_log_history (
          player_id,
          schedule_type,
          plan_item_id,
          performed_sets,
          performed_reps,
          performed_load,
          completed,
          notes,
          logged_by_user_id,
          logged_at
        )
        VALUES ($1, 'plan', $2, $3, $4, $5, $6, $7, $8, NOW())
      `,
      [input.playerId, input.itemId, performedSets, performedReps, performedLoad, input.completed, notes, input.loggedByUserId]
    );
    _invalidateTrainingReadCacheForPlayer(input.playerId);

    if (input.completed && planItem.target_count) {
      void notifyStaffOnPlanTargetReached({
        organizationId: planItem.organization_id,
        playerId: input.playerId,
        planItemId: input.itemId,
        targetCount: planItem.target_count,
      }).catch(() => {});
    }
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

export type ExerciseLogHistoryItemEntry = {
  id: number;
  dayDate: string;
  loggedAt: string;
  completed: boolean;
  performedSets: string | null;
  performedReps: string | null;
  performedLoad: string | null;
  notes: string | null;
};

// Recurring (cycle/plan) items reuse the same item id across every day a
// player logs it, so upsertExerciseLog/listCycleProgramItemsForPlayer only
// ever surface "today's" entry. This lists every past day's entry for one
// item so a coach/player can review or correct an earlier session -- source
// of truth is exercise_log_history, grouped to one row per Phoenix-local day
// (a player re-saving the same day's log multiple times should show as one
// editable entry, using the latest save for that day).
export async function listExerciseLogHistoryForItem(input: {
  playerId: number;
  itemId: number;
  scheduleType: 'cycle' | 'plan';
  limit?: number;
}): Promise<ExerciseLogHistoryItemEntry[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const limit = Math.max(1, Math.min(200, input.limit ?? 60));
  const itemColumn = input.scheduleType === 'cycle' ? 'cycle_item_id' : 'plan_item_id';

  const result = await pool.query<{
    id: number;
    day_date: string;
    logged_at: string;
    completed: boolean;
    performed_sets: string | null;
    performed_reps: string | null;
    performed_load: string | null;
    notes: string | null;
  }>(
    `
      SELECT DISTINCT ON ((logged_at AT TIME ZONE 'America/Phoenix')::date)
        id,
        (logged_at AT TIME ZONE 'America/Phoenix')::date::text AS day_date,
        logged_at::text AS logged_at,
        completed,
        performed_sets,
        performed_reps,
        performed_load,
        notes
      FROM exercise_log_history
      WHERE player_id = $1
        AND schedule_type = $2
        AND ${itemColumn} = $3
      ORDER BY (logged_at AT TIME ZONE 'America/Phoenix')::date DESC, logged_at DESC, id DESC
      LIMIT $4
    `,
    [input.playerId, input.scheduleType, input.itemId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    dayDate: row.day_date,
    loggedAt: row.logged_at,
    completed: row.completed,
    performedSets: row.performed_sets,
    performedReps: row.performed_reps,
    performedLoad: row.performed_load,
    notes: row.notes,
  }));
}

// Edits a single past day's history row in place (rather than inserting a
// new one), since exercise_log_history is otherwise append-only and the
// "one row per day" grouping above needs that row's content to be exactly
// what a coach/player corrected it to, not a duplicate.
export async function updateExerciseLogHistoryEntry(input: {
  playerId: number;
  scheduleType: 'cycle' | 'plan';
  itemId: number;
  historyId: number;
  performedSets?: string;
  performedReps?: string;
  performedLoad?: string;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const itemColumn = input.scheduleType === 'cycle' ? 'cycle_item_id' : 'plan_item_id';
  const performedSets = (input.performedSets ?? '').trim() || null;
  const performedReps = (input.performedReps ?? '').trim() || null;
  const performedLoad = (input.performedLoad ?? '').trim() || null;
  const notes = (input.notes ?? '').trim() || null;

  const result = await pool.query(
    `
      UPDATE exercise_log_history
      SET performed_sets = $1,
          performed_reps = $2,
          performed_load = $3,
          notes = $4
      WHERE id = $5
        AND player_id = $6
        AND schedule_type = $7
        AND ${itemColumn} = $8
    `,
    [performedSets, performedReps, performedLoad, notes, input.historyId, input.playerId, input.scheduleType, input.itemId]
  );
  if ((result.rowCount ?? 0) === 0) return { ok: false, error: 'Log entry was not found.' };
  _invalidateTrainingReadCacheForPlayer(input.playerId);
  return { ok: true };
}

export async function getPlayerNotificationContext(input: {
  organizationId: number;
  playerId: number;
}): Promise<{ userId: number | null; schoolCode: string | null; fullName: string } | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ user_id: number | null; school_code: string | null; full_name: string }>(
    `SELECT user_id, school_code, full_name FROM players WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [input.playerId, input.organizationId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { userId: row.user_id, schoolCode: row.school_code, fullName: row.full_name };
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
    status: string | null;
    date_of_birth: string | null;
    school_team: string | null;
    school_code: string | null;
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
        p.status,
        p.date_of_birth::text,
        p.school_team,
        p.school_code,
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
    status: result.rows[0].status || 'active',
    dateOfBirth: result.rows[0].date_of_birth,
    schoolTeam: result.rows[0].school_team,
    schoolCode: result.rows[0].school_code,
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
    status: string | null;
    date_of_birth: string | null;
    school_team: string | null;
    school_code: string | null;
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
        p.status,
        p.date_of_birth::text,
        p.school_team,
        p.school_code,
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
    status: result.rows[0].status || 'active',
    dateOfBirth: result.rows[0].date_of_birth,
    schoolTeam: result.rows[0].school_team,
    schoolCode: result.rows[0].school_code,
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

export type PlayerProLink = {
  playerId: number;
  proPlayerName: string;
  createdAt: string;
};

function normalizeProName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Confirms `playerId` belongs to `organizationId` before any link read/write
 * -- the same ownership check used throughout this file (see getPlayerForUser
 * above) -- so a coach at one school can never touch another school's player. */
async function assertPlayerInOrganization(organizationId: number, playerId: number): Promise<boolean> {
  const pool = getDbPool();
  const result = await pool.query(`SELECT 1 FROM players WHERE id = $1 AND organization_id = $2 LIMIT 1`, [
    playerId,
    organizationId,
  ]);
  return (result.rowCount ?? 0) === 1;
}

export async function getPlayerProLink(input: { organizationId: number; playerId: number }): Promise<PlayerProLink | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureTrainingDbReady();
  const owned = await assertPlayerInOrganization(input.organizationId, input.playerId);
  if (!owned) return null;

  const pool = getDbPool();
  const result = await pool.query<{ player_id: number; pro_player_name: string; created_at: string }>(
    `SELECT player_id, pro_player_name, created_at::text FROM player_pro_links WHERE player_id = $1 LIMIT 1`,
    [input.playerId]
  );
  if ((result.rowCount ?? 0) !== 1) return null;
  return {
    playerId: result.rows[0].player_id,
    proPlayerName: result.rows[0].pro_player_name,
    createdAt: result.rows[0].created_at,
  };
}

/** "Last, First" <-> "First Last" for the same name -- the dashboard's
 * pitcher/hitter selector always shows "Last, First" (matching TrackMan
 * school data), but a players.full_name isn't guaranteed to be stored in
 * that order (e.g. a manually-added placeholder roster entry may just be
 * "First Last"). Returns both orderings so a lookup can match either. */
function nameOrderingVariants(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const variants = new Set<string>([trimmed]);
  if (trimmed.includes(',')) {
    const [last, ...rest] = trimmed.split(',');
    const first = rest.join(' ').trim();
    if (first && last.trim()) variants.add(`${first} ${last.trim()}`.replace(/\s+/g, ' ').trim());
  } else {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      variants.add(`${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`.trim());
    }
  }
  return Array.from(variants);
}

/** Resolves a school player's PRO link by their display name (as it appears
 * in the pitcher/hitter overview selector) rather than by playerId -- the
 * overview routes only ever see a name string, never the players.id it
 * belongs to. Matches on full_name within the caller's own organization
 * only, so a coach at one school can never pick up another school's link. */
export async function getPlayerProLinkByPlayerName(input: {
  organizationId: number;
  playerName: string;
}): Promise<PlayerProLink | null> {
  if (!isDatabaseConfigured()) return null;
  const nameVariants = nameOrderingVariants(input.playerName);
  if (!nameVariants.length) return null;
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ player_id: number; pro_player_name: string; created_at: string }>(
    `
      SELECT ppl.player_id, ppl.pro_player_name, ppl.created_at::text
      FROM player_pro_links ppl
      JOIN players p ON p.id = ppl.player_id
      WHERE p.organization_id = $1 AND p.full_name = ANY($2::text[])
      LIMIT 1
    `,
    [input.organizationId, nameVariants]
  );
  if ((result.rowCount ?? 0) !== 1) return null;
  return {
    playerId: result.rows[0].player_id,
    proPlayerName: result.rows[0].pro_player_name,
    createdAt: result.rows[0].created_at,
  };
}

export async function setPlayerProLink(input: {
  organizationId: number;
  playerId: number;
  proPlayerName: string;
  createdByUserId: number | null;
}): Promise<PlayerProLink | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureTrainingDbReady();
  const owned = await assertPlayerInOrganization(input.organizationId, input.playerId);
  if (!owned) return null;

  const pool = getDbPool();
  const proNameNorm = normalizeProName(input.proPlayerName);
  const result = await pool.query<{ player_id: number; pro_player_name: string; created_at: string }>(
    `
      INSERT INTO player_pro_links (player_id, pro_player_name, pro_name_norm, created_by_user_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (player_id) DO UPDATE SET
        pro_player_name = EXCLUDED.pro_player_name,
        pro_name_norm = EXCLUDED.pro_name_norm,
        created_by_user_id = EXCLUDED.created_by_user_id,
        created_at = NOW()
      RETURNING player_id, pro_player_name, created_at::text
    `,
    [input.playerId, input.proPlayerName.trim(), proNameNorm, input.createdByUserId]
  );
  return {
    playerId: result.rows[0].player_id,
    proPlayerName: result.rows[0].pro_player_name,
    createdAt: result.rows[0].created_at,
  };
}

export async function deletePlayerProLink(input: { organizationId: number; playerId: number }): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  await ensureTrainingDbReady();
  const owned = await assertPlayerInOrganization(input.organizationId, input.playerId);
  if (!owned) return false;

  const pool = getDbPool();
  await pool.query(`DELETE FROM player_pro_links WHERE player_id = $1`, [input.playerId]);
  return true;
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
  if (profilePhotoDataUrl) {
    // Compare decoded byte size, not the base64 string length (~33% larger than
    // the underlying bytes) -- otherwise images under the intended size cap can
    // get falsely rejected once base64-encoded.
    const base64Payload = profilePhotoDataUrl.slice(profilePhotoDataUrl.indexOf(',') + 1);
    const decodedByteLength = Math.floor((base64Payload.length * 3) / 4);
    if (decodedByteLength > 5_000_000) {
      return { ok: false, error: 'Profile photo is too large. Please upload a smaller image.' };
    }
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
  _invalidateTrainingReadCacheForPlayer(input.playerId);
  return { ok: true };
}

export async function setPlayerStatus(input: {
  organizationId: number;
  playerId: number;
  status: 'active' | 'inactive';
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const status = input.status === 'inactive' ? 'inactive' : 'active';
  const updated = await pool.query<{ id: number }>(
    `
      UPDATE players
      SET status = $1, updated_at = NOW()
      WHERE id = $2 AND organization_id = $3
      RETURNING id
    `,
    [status, input.playerId, input.organizationId]
  );

  if ((updated.rowCount ?? 0) !== 1) return { ok: false, error: 'Player not found in your organization.' };
  _invalidateTrainingReadCacheForOrganization(input.organizationId);
  _invalidateTrainingReadCacheForPlayer(input.playerId);
  return { ok: true };
}

export async function listBodyWeightLogsForPlayer(input: { playerId: number; limit?: number }): Promise<BodyWeightLogRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const limit = Math.max(1, Math.min(365, input.limit ?? 120));

  const result = await pool.query<{ id: number; log_date: string; weight_lbs: string; notes: string | null; media_id: number | null }>(
    `
      SELECT id, log_date::text, weight_lbs::text, notes, media_id
      FROM body_weight_logs
      WHERE player_id = $1
      ORDER BY log_date ASC
      LIMIT $2
    `,
    [input.playerId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    logDate: row.log_date,
    weightLbs: Number(row.weight_lbs),
    notes: row.notes,
    mediaId: row.media_id,
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

export async function clearPlayerPlanGoalsForPlayer(input: {
  organizationId: number;
  playerId: number;
  keepSlotIndexes?: number[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
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

  const keep = Array.from(new Set((input.keepSlotIndexes ?? []).filter((slot) => Number.isFinite(slot) && slot >= 1 && slot <= 3)));
  if (!keep.length) {
    await pool.query(`DELETE FROM player_plan_goals WHERE player_id = $1`, [input.playerId]);
    return { ok: true };
  }
  await pool.query(`DELETE FROM player_plan_goals WHERE player_id = $1 AND slot_index <> ALL($2::smallint[])`, [
    input.playerId,
    keep,
  ]);
  return { ok: true };
}

export async function listPlayerPlanNotesForPlayer(input: {
  organizationId: number;
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
    player_visible: boolean;
    created_at: string;
    created_by_user_id: number | null;
  }>(
    `
      SELECT
        n.id,
        n.player_id,
        n.domain,
        n.note_date::text,
        n.category,
        n.note_text,
        n.attachment_name,
        n.attachment_mime_type,
        n.attachment_data_url,
        n.player_visible,
        n.created_at::text,
        n.created_by_user_id
      FROM player_plan_notes n
      JOIN players p ON p.id = n.player_id
      WHERE n.player_id = $1
        AND p.organization_id = $2
        AND ($3::text IS NULL OR n.domain = $3::text)
      ORDER BY n.note_date DESC, n.created_at DESC
      LIMIT $4
    `,
    [input.playerId, input.organizationId, filteredDomain, limit]
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
        playerVisible: row.player_visible,
        createdAt: row.created_at,
        createdByUserId: row.created_by_user_id,
      } satisfies PlayerPlanNoteRow;
    })
    .filter((row): row is PlayerPlanNoteRow => Boolean(row));
}

export async function getPlayerPlanNoteById(input: {
  organizationId: number;
  playerId: number;
  noteId: number;
}): Promise<PlayerPlanNoteRow | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureTrainingDbReady();
  const pool = getDbPool();
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
    player_visible: boolean;
    created_at: string;
    created_by_user_id: number | null;
  }>(
    `
      SELECT
        n.id, n.player_id, n.domain, n.note_date::text, n.category, n.note_text,
        n.attachment_name, n.attachment_mime_type, n.attachment_data_url,
        n.player_visible, n.created_at::text, n.created_by_user_id
      FROM player_plan_notes n
      JOIN players p ON p.id = n.player_id
      WHERE n.id = $1 AND n.player_id = $2 AND p.organization_id = $3
      LIMIT 1
    `,
    [input.noteId, input.playerId, input.organizationId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const domainValue =
    row.domain === 'Pitching' || row.domain === 'Hitting' || row.domain === 'Catching' || row.domain === 'General' ? row.domain : null;
  if (!domainValue) return null;
  return {
    id: row.id,
    playerId: row.player_id,
    domain: domainValue,
    noteDate: row.note_date,
    category: String(row.category ?? '').trim(),
    noteText: row.note_text,
    attachmentName: row.attachment_name,
    attachmentMimeType: row.attachment_mime_type,
    attachmentDataUrl: row.attachment_data_url,
    playerVisible: row.player_visible,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
  };
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
  sourceType?: string;
  sourceId?: string;
  playerVisible?: boolean;
  createdByUserId: number;
}): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
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
  if (attachmentDataUrl && attachmentDataUrl.length > NOTE_ATTACHMENT_DATA_URL_MAX_LENGTH) {
    return { ok: false, error: 'Attachments are too large. Please keep uploads under about 45 MB total.' };
  }

  const result = await pool.query<{ id: number }>(
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
        source_type,
        source_id,
        player_visible,
        created_by_user_id
      )
      VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
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
      String(input.sourceType ?? '').trim() || null,
      String(input.sourceId ?? '').trim() || null,
      Boolean(input.playerVisible),
      input.createdByUserId,
    ]
  );

  return { ok: true, id: result.rows[0]?.id ?? 0 };
}

export async function linkMediaToNote(input: { noteId: number; mediaIds: number[] }): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const mediaIds = Array.from(new Set(input.mediaIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  if (mediaIds.length === 0) return;
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const values = mediaIds.map((_, index) => `($1, $${index + 2})`).join(', ');
  await pool.query(
    `INSERT INTO note_media (note_id, media_id) VALUES ${values} ON CONFLICT DO NOTHING`,
    [input.noteId, ...mediaIds]
  );
}

export async function listMediaForNotes(noteIds: number[]): Promise<Map<number, PlayerMediaRow[]>> {
  const ids = Array.from(new Set(noteIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  const byNote = new Map<number, PlayerMediaRow[]>();
  if (!isDatabaseConfigured() || ids.length === 0) return byNote;
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{
    note_id: number;
    id: number;
    organization_id: number;
    player_id: number;
    media_type: string;
    title: string;
    category: string;
    file_name: string;
    content_type: string;
    size_bytes: string;
    r2_key: string;
    source_type: string | null;
    source_label: string | null;
    breakdown_annotations_json: unknown;
    created_at: string;
    updated_at: string;
    created_by_user_id: number | null;
  }>(
    `
      SELECT
        nm.note_id,
        m.id, m.organization_id, m.player_id, m.media_type, m.title, m.category,
        m.file_name, m.content_type, m.size_bytes, m.r2_key, m.source_type, m.source_label,
        m.breakdown_annotations_json, m.created_at::text, m.updated_at::text, m.created_by_user_id
      FROM note_media nm
      JOIN player_media m ON m.id = nm.media_id
      WHERE nm.note_id = ANY($1::bigint[])
      ORDER BY m.created_at ASC
    `,
    [ids]
  );
  for (const row of result.rows) {
    const mediaType = row.media_type === 'photo' || row.media_type === 'video' || row.media_type === 'pdf' ? row.media_type : 'photo';
    const media: PlayerMediaRow = {
      id: row.id,
      organizationId: row.organization_id,
      playerId: row.player_id,
      mediaType,
      title: row.title,
      category: row.category,
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes ?? '0') || 0,
      r2Key: row.r2_key,
      sourceType: row.source_type,
      sourceLabel: row.source_label,
      breakdownAnnotations: Array.isArray(row.breakdown_annotations_json) ? row.breakdown_annotations_json : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdByUserId: row.created_by_user_id,
    };
    const list = byNote.get(row.note_id) ?? [];
    list.push(media);
    byNote.set(row.note_id, list);
  }
  return byNote;
}

export async function updatePlayerPlanNote(input: {
  organizationId: number;
  playerId: number;
  noteId: number;
  noteDate: string;
  category: string;
  noteText: string;
  attachmentName?: string;
  attachmentMimeType?: string;
  attachmentDataUrl?: string;
  playerVisible?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  if (!Number.isFinite(input.playerId) || input.playerId <= 0) return { ok: false, error: 'Valid playerId is required.' };
  if (!Number.isFinite(input.noteId) || input.noteId <= 0) return { ok: false, error: 'Valid noteId is required.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.noteDate ?? '').trim())) return { ok: false, error: 'Date must be YYYY-MM-DD.' };
  const category = String(input.category ?? '').trim();
  if (!category) return { ok: false, error: 'Category is required.' };
  if (category.length > 80) return { ok: false, error: 'Category must be 80 characters or fewer.' };
  const noteText = String(input.noteText ?? '').trim();
  if (!noteText) return { ok: false, error: 'Note text is required.' };
  const attachmentDataUrl = String(input.attachmentDataUrl ?? '').trim() || null;
  if (attachmentDataUrl && attachmentDataUrl.length > NOTE_ATTACHMENT_DATA_URL_MAX_LENGTH) {
    return { ok: false, error: 'Attachments are too large. Please keep uploads under about 45 MB total.' };
  }

  const result = await pool.query(
    `
      UPDATE player_plan_notes AS n
      SET
        note_date = $1::date,
        category = $2,
        note_text = $3,
        attachment_name = $4,
        attachment_mime_type = $5,
        attachment_data_url = $6,
        player_visible = COALESCE($7, n.player_visible),
        updated_at = NOW()
      FROM players p
      WHERE n.id = $8
        AND n.player_id = $9
        AND p.id = n.player_id
        AND p.organization_id = $10
    `,
    [
      String(input.noteDate).trim(),
      category,
      noteText,
      String(input.attachmentName ?? '').trim() || null,
      String(input.attachmentMimeType ?? '').trim() || null,
      attachmentDataUrl,
      typeof input.playerVisible === 'boolean' ? input.playerVisible : null,
      input.noteId,
      input.playerId,
      input.organizationId,
    ]
  );
  if ((result.rowCount ?? 0) < 1) return { ok: false, error: 'Note not found.' };
  return { ok: true };
}

export async function deletePlayerPlanNote(input: {
  organizationId: number;
  playerId: number;
  noteId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  if (!Number.isFinite(input.playerId) || input.playerId <= 0) return { ok: false, error: 'Valid playerId is required.' };
  if (!Number.isFinite(input.noteId) || input.noteId <= 0) return { ok: false, error: 'Valid noteId is required.' };
  const result = await pool.query(
    `
      DELETE FROM player_plan_notes AS n
      USING players p
      WHERE n.id = $1
        AND n.player_id = $2
        AND p.id = n.player_id
        AND p.organization_id = $3
    `,
    [input.noteId, input.playerId, input.organizationId]
  );
  if ((result.rowCount ?? 0) < 1) return { ok: false, error: 'Note not found.' };
  return { ok: true };
}

export async function listPlayerPlanNoteCategoriesByOrganization(input: {
  organizationId: number;
  domain?: 'Pitching' | 'Hitting' | 'Catching' | 'General';
}): Promise<string[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const filteredDomain =
    input.domain && (input.domain === 'Pitching' || input.domain === 'Hitting' || input.domain === 'Catching' || input.domain === 'General')
      ? input.domain
      : null;
  const result = await pool.query<{ category: string }>(
    `
      SELECT category
      FROM (
        SELECT BTRIM(n.category) AS category
        FROM player_plan_notes n
        JOIN players p ON p.id = n.player_id
        WHERE p.organization_id = $1
          AND ($2::text IS NULL OR n.domain = $2::text)
          AND BTRIM(COALESCE(n.category, '')) <> ''
        UNION
        SELECT BTRIM(category) AS category
        FROM dashboard_player_notes
        WHERE organization_id = $1
          AND ($2::text IS NULL OR domain = $2::text)
          AND BTRIM(COALESCE(category, '')) <> ''
      ) categories
      GROUP BY category
      ORDER BY lower(category), category
    `,
    [input.organizationId, filteredDomain]
  );
  return result.rows.map((row) => String(row.category ?? '').trim()).filter(Boolean);
}

export async function listPlayerMedia(input: {
  organizationId: number;
  playerId: number;
  mediaType?: 'photo' | 'video' | 'pdf';
}): Promise<PlayerMediaRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const mediaType = input.mediaType === 'photo' || input.mediaType === 'video' || input.mediaType === 'pdf' ? input.mediaType : null;
  const result = await pool.query<{
    id: number;
    organization_id: number;
    player_id: number;
    media_type: string;
    title: string;
    category: string;
    file_name: string;
    content_type: string;
    size_bytes: string | number;
    r2_key: string;
    source_type: string | null;
    source_label: string | null;
    breakdown_annotations_json: unknown;
    created_at: string;
    updated_at: string;
    created_by_user_id: number | null;
  }>(
    `
      SELECT
        id,
        organization_id,
        player_id,
        media_type,
        title,
        category,
        file_name,
        content_type,
        size_bytes,
        r2_key,
        source_type,
        source_label,
        COALESCE(breakdown_annotations_json, '[]'::jsonb) AS breakdown_annotations_json,
        created_at::text,
        updated_at::text,
        created_by_user_id
      FROM player_media
      WHERE organization_id = $1
        AND player_id = $2
        AND ($3::text IS NULL OR media_type = $3::text)
      ORDER BY created_at DESC, id DESC
    `,
    [input.organizationId, input.playerId, mediaType]
  );
  return result.rows
    .map((row) => {
      const mediaTypeValue = row.media_type === 'photo' || row.media_type === 'video' || row.media_type === 'pdf' ? row.media_type : null;
      if (!mediaTypeValue) return null;
      return {
        id: Number(row.id),
        organizationId: Number(row.organization_id),
        playerId: Number(row.player_id),
        mediaType: mediaTypeValue,
        title: String(row.title ?? '').trim() || String(row.file_name ?? 'Media'),
        category: String(row.category ?? '').trim() || 'General',
        fileName: row.file_name,
        contentType: row.content_type,
        sizeBytes: Number(row.size_bytes ?? 0) || 0,
        r2Key: row.r2_key,
        sourceType: row.source_type,
        sourceLabel: row.source_label,
        breakdownAnnotations: Array.isArray(row.breakdown_annotations_json) ? row.breakdown_annotations_json : [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdByUserId: row.created_by_user_id,
      } satisfies PlayerMediaRow;
    })
    .filter((row): row is PlayerMediaRow => Boolean(row));
}

export async function listPlayerMediaCategoriesByOrganization(input: {
  organizationId: number;
  mediaType?: 'photo' | 'video' | 'pdf';
}): Promise<string[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const mediaType = input.mediaType === 'photo' || input.mediaType === 'video' || input.mediaType === 'pdf' ? input.mediaType : null;
  const result = await pool.query<{ category: string }>(
    `
      SELECT category
      FROM (
        SELECT BTRIM(category) AS category
        FROM player_media
        WHERE organization_id = $1
          AND ($2::text IS NULL OR media_type = $2::text)
          AND BTRIM(COALESCE(category, '')) <> ''
      ) categories
      GROUP BY category
      ORDER BY lower(category), category
    `,
    [input.organizationId, mediaType]
  );
  return result.rows.map((row) => String(row.category ?? '').trim()).filter(Boolean);
}

export async function getPlayerMedia(input: {
  organizationId: number;
  mediaId: number;
}): Promise<PlayerMediaRow | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ player_id: number }>(`SELECT player_id FROM player_media WHERE id = $1 AND organization_id = $2`, [
    input.mediaId,
    input.organizationId,
  ]);
  const playerId = result.rows[0]?.player_id ?? 0;
  if (!playerId) return null;
  const rows = await listPlayerMedia({ organizationId: input.organizationId, playerId });
  return rows.find((row) => Number(row.id) === Number(input.mediaId)) ?? null;
}

export async function createPlayerMedia(input: {
  organizationId: number;
  playerId: number;
  mediaType: 'photo' | 'video' | 'pdf';
  title: string;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  r2Key: string;
  sourceType?: string;
  sourceLabel?: string;
  createdByUserId: number;
}): Promise<{ ok: true; id: number; media: PlayerMediaRow } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const mediaType = input.mediaType === 'photo' || input.mediaType === 'video' || input.mediaType === 'pdf' ? input.mediaType : null;
  if (!mediaType) return { ok: false, error: 'Media type must be photo, video, or pdf.' };
  const playerCheck = await pool.query(`SELECT id FROM players WHERE id = $1 AND organization_id = $2 LIMIT 1`, [
    input.playerId,
    input.organizationId,
  ]);
  if ((playerCheck.rowCount ?? 0) !== 1) return { ok: false, error: 'Player not found in your organization.' };
  const result = await pool.query<{
    id: number;
    organization_id: number;
    player_id: number;
    media_type: string;
    title: string;
    category: string;
    file_name: string;
    content_type: string;
    size_bytes: string | number;
    r2_key: string;
    source_type: string | null;
    source_label: string | null;
    breakdown_annotations_json: unknown;
    created_at: string;
    updated_at: string;
    created_by_user_id: number | null;
  }>(
    `
      INSERT INTO player_media (
        organization_id,
        player_id,
        media_type,
        title,
        category,
        file_name,
        content_type,
        size_bytes,
        r2_key,
        source_type,
        source_label,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING
        id, organization_id, player_id, media_type, title, category,
        file_name, content_type, size_bytes, r2_key, source_type, source_label,
        breakdown_annotations_json, created_at::text, updated_at::text, created_by_user_id
    `,
    [
      input.organizationId,
      input.playerId,
      mediaType,
      String(input.title ?? '').trim() || String(input.fileName ?? 'Media'),
      String(input.category ?? '').trim() || 'General',
      String(input.fileName ?? '').trim() || 'media',
      String(input.contentType ?? '').trim() || 'application/octet-stream',
      Math.max(0, Math.round(Number(input.sizeBytes) || 0)),
      input.r2Key,
      String(input.sourceType ?? '').trim() || null,
      String(input.sourceLabel ?? '').trim() || null,
      input.createdByUserId,
    ]
  );
  const row = result.rows[0];
  if (!row) return { ok: false, error: 'Insert did not return the created row.' };
  const media: PlayerMediaRow = {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    playerId: Number(row.player_id),
    mediaType,
    title: row.title,
    category: row.category,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes ?? 0) || 0,
    r2Key: row.r2_key,
    sourceType: row.source_type,
    sourceLabel: row.source_label,
    breakdownAnnotations: Array.isArray(row.breakdown_annotations_json) ? row.breakdown_annotations_json : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUserId: row.created_by_user_id,
  };
  return { ok: true, id: media.id, media };
}

export async function updatePlayerMedia(input: {
  organizationId: number;
  mediaId: number;
  title?: string;
  category?: string;
  breakdownAnnotations?: unknown[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const updates: string[] = [];
  const values: unknown[] = [];
  if (typeof input.title === 'string') {
    const title = input.title.trim();
    if (!title) return { ok: false, error: 'Title is required.' };
    values.push(title);
    updates.push(`title = $${values.length}`);
  }
  if (typeof input.category === 'string') {
    const category = input.category.trim() || 'General';
    values.push(category);
    updates.push(`category = $${values.length}`);
  }
  if (Array.isArray(input.breakdownAnnotations)) {
    values.push(JSON.stringify(input.breakdownAnnotations));
    updates.push(`breakdown_annotations_json = $${values.length}::jsonb`);
  }
  if (!updates.length) return { ok: false, error: 'No media updates provided.' };
  values.push(input.mediaId, input.organizationId);
  const mediaIdParam = values.length - 1;
  const organizationIdParam = values.length;
  const result = await pool.query(
    `
      UPDATE player_media
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${mediaIdParam} AND organization_id = $${organizationIdParam}
    `,
    values
  );
  if ((result.rowCount ?? 0) < 1) return { ok: false, error: 'Media not found.' };
  return { ok: true };
}

export async function deletePlayerMedia(input: {
  organizationId: number;
  mediaId: number;
}): Promise<{ ok: true; r2Key: string } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ r2_key: string }>(
    `DELETE FROM player_media WHERE id = $1 AND organization_id = $2 RETURNING r2_key`,
    [input.mediaId, input.organizationId]
  );
  if ((result.rowCount ?? 0) < 1) return { ok: false, error: 'Media not found.' };
  return { ok: true, r2Key: result.rows[0]?.r2_key ?? '' };
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
  if (attachmentDataUrl && attachmentDataUrl.length > NOTE_ATTACHMENT_DATA_URL_MAX_LENGTH) {
    return { ok: false, error: 'Attachments are too large. Please keep uploads under about 45 MB total.' };
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
  if (attachmentDataUrl && attachmentDataUrl.length > NOTE_ATTACHMENT_DATA_URL_MAX_LENGTH) {
    return { ok: false, error: 'Attachments are too large. Please keep uploads under about 45 MB total.' };
  }

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

export async function deletePlayerPlanGoal(input: {
  organizationId: number;
  playerId: number;
  slotIndex: number;
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

  await pool.query(
    `
      DELETE FROM player_plan_goals
      WHERE player_id = $1
        AND slot_index = $2
    `,
    [input.playerId, input.slotIndex]
  );
  return { ok: true };
}

export async function upsertBodyWeightLog(input: {
  playerId: number;
  loggedByUserId: number;
  logDate: string;
  weightLbs: number;
  notes?: string;
  mediaId?: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.logDate.trim())) return { ok: false, error: 'Date must be YYYY-MM-DD.' };
  if (!Number.isFinite(input.weightLbs) || input.weightLbs <= 0) return { ok: false, error: 'Weight must be positive.' };

  const mediaId = Number.isFinite(input.mediaId) && Number(input.mediaId) > 0 ? Number(input.mediaId) : null;

  await pool.query(
    `
      INSERT INTO body_weight_logs (player_id, log_date, weight_lbs, notes, media_id, created_by_user_id)
      VALUES ($1, $2::date, $3, $4, $5, $6)
      ON CONFLICT (player_id, log_date)
      DO UPDATE SET
        weight_lbs = EXCLUDED.weight_lbs,
        notes = EXCLUDED.notes,
        media_id = COALESCE(EXCLUDED.media_id, body_weight_logs.media_id),
        created_by_user_id = EXCLUDED.created_by_user_id,
        updated_at = NOW()
    `,
    [input.playerId, input.logDate.trim(), input.weightLbs, (input.notes ?? '').trim() || null, mediaId, input.loggedByUserId]
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
      history_workout_plan AS (
        SELECT DISTINCT we.exercise_id
        FROM exercise_log_history h
        JOIN program_plan_items pi ON pi.id = h.plan_item_id
        JOIN workout_exercises we ON we.workout_id = pi.workout_id
        JOIN workout_library wl ON wl.id = pi.workout_id
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
        SELECT exercise_id FROM history_workout_plan
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

export type BullpenLogEntry = {
  id: number;
  templateId: string;
  bullpenDate: string;
  rowsJson: Array<Record<string, string>>;
  updatedAt: string;
};

export type HittingLogEntry = {
  id: number;
  templateId: string;
  hittingDate: string;
  rowsJson: Array<Record<string, string>>;
  updatedAt: string;
};

export type BubbleCategoryDefRow = {
  id: string;
  label: string;
  options: string[];
  updatedAt: string;
};

export type QuestionnaireQuestionType = 'text' | 'multiple_choice' | 'scale' | 'number' | 'yes_no';

export type QuestionnaireQuestion = {
  id: string;
  prompt: string;
  type: QuestionnaireQuestionType;
  options: string[];
  scaleMin: number;
  scaleMax: number;
};

export type QuestionnaireAssignmentRow = {
  id: number;
  groupName: string;
  playerIds: number[];
  notifyStartDate: string;
  frequency: 'once' | 'daily' | 'weekly' | 'monthly';
  isActive: boolean;
};

export type QuestionnaireRow = {
  id: number;
  organizationId: number;
  name: string;
  questions: QuestionnaireQuestion[];
  assignments: QuestionnaireAssignmentRow[];
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type QuestionnaireResponseRow = {
  id: number;
  questionnaireId: number;
  questionnaireName: string;
  assignmentId: number;
  groupName: string;
  playerId: number;
  playerName: string;
  dueDate: string;
  answers: Record<string, string>;
  submittedAt: string;
};

export type PendingQuestionnaireRow = {
  questionnaireId: number;
  questionnaireName: string;
  assignmentId: number;
  groupName: string;
  dueDate: string;
  questions: QuestionnaireQuestion[];
};

export async function saveBullpenLogEntry(input: {
  organizationId: number;
  playerId: number;
  userId: number | null;
  templateId: string;
  bullpenDate: string;
  rowsJson: Array<Record<string, string>>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  try {
    await pool.query(
      `INSERT INTO bullpen_log_entries (organization_id, player_id, template_id, bullpen_date, rows_json, created_by_user_id, updated_at)
       VALUES ($1, $2, $3, $4::date, $5::jsonb, $6, NOW())
       ON CONFLICT (organization_id, player_id, template_id, bullpen_date)
       DO UPDATE SET rows_json = EXCLUDED.rows_json, updated_at = NOW(), created_by_user_id = EXCLUDED.created_by_user_id`,
      [input.organizationId, input.playerId, input.templateId, input.bullpenDate, JSON.stringify(input.rowsJson), input.userId]
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to save bullpen log entry.' };
  }
}

export async function getBullpenLogEntries(input: {
  organizationId: number;
  playerId: number;
  templateId?: string | null;
}): Promise<BullpenLogEntry[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const templateFilter = input.templateId ? `AND template_id = $3` : '';
  const values: unknown[] = [input.organizationId, input.playerId];
  if (input.templateId) values.push(input.templateId);
  const result = await pool.query<{ id: number; template_id: string; bullpen_date: string; rows_json: unknown; updated_at: string }>(
    `SELECT id, template_id, bullpen_date::text AS bullpen_date, rows_json, updated_at::text AS updated_at
     FROM bullpen_log_entries
     WHERE organization_id = $1 AND player_id = $2 ${templateFilter}
     ORDER BY bullpen_date DESC`,
    values
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    templateId: String(row.template_id ?? ''),
    bullpenDate: String(row.bullpen_date ?? ''),
    rowsJson: Array.isArray(row.rows_json) ? (row.rows_json as Array<Record<string, string>>) : [],
    updatedAt: String(row.updated_at ?? ''),
  }));
}

export async function saveHittingLogEntry(input: {
  organizationId: number;
  playerId: number;
  userId: number | null;
  templateId: string;
  hittingDate: string;
  rowsJson: Array<Record<string, string>>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  try {
    await pool.query(
      `INSERT INTO hitting_log_entries (organization_id, player_id, template_id, hitting_date, rows_json, created_by_user_id, updated_at)
       VALUES ($1, $2, $3, $4::date, $5::jsonb, $6, NOW())
       ON CONFLICT (organization_id, player_id, template_id, hitting_date)
       DO UPDATE SET rows_json = EXCLUDED.rows_json, updated_at = NOW(), created_by_user_id = EXCLUDED.created_by_user_id`,
      [input.organizationId, input.playerId, input.templateId, input.hittingDate, JSON.stringify(input.rowsJson), input.userId]
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to save hitting log entry.' };
  }
}

export async function getHittingLogEntries(input: {
  organizationId: number;
  playerId: number;
  templateId?: string | null;
}): Promise<HittingLogEntry[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const templateFilter = input.templateId ? `AND template_id = $3` : '';
  const values: unknown[] = [input.organizationId, input.playerId];
  if (input.templateId) values.push(input.templateId);
  const result = await pool.query<{ id: number; template_id: string; hitting_date: string; rows_json: unknown; updated_at: string }>(
    `SELECT id, template_id, hitting_date::text AS hitting_date, rows_json, updated_at::text AS updated_at
     FROM hitting_log_entries
     WHERE organization_id = $1 AND player_id = $2 ${templateFilter}
     ORDER BY hitting_date DESC`,
    values
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    templateId: String(row.template_id ?? ''),
    hittingDate: String(row.hitting_date ?? ''),
    rowsJson: Array.isArray(row.rows_json) ? (row.rows_json as Array<Record<string, string>>) : [],
    updatedAt: String(row.updated_at ?? ''),
  }));
}

export async function getBubbleCategories(input: { organizationId: number }): Promise<BubbleCategoryDefRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ id: number; label: string; options_json: unknown; updated_at: string }>(
    `SELECT id, label, options_json, updated_at::text AS updated_at
     FROM bubble_category_defs
     WHERE organization_id = $1
     ORDER BY label ASC`,
    [input.organizationId]
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    label: String(row.label ?? ''),
    options: Array.isArray(row.options_json) ? (row.options_json as string[]).map((v) => String(v)) : [],
    updatedAt: String(row.updated_at ?? ''),
  }));
}

export async function createBubbleCategory(input: {
  organizationId: number;
  userId: number | null;
  label: string;
  options: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  try {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO bubble_category_defs (organization_id, label, options_json, created_by_user_id, updated_by_user_id, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $4, NOW())
       RETURNING id`,
      [input.organizationId, input.label, JSON.stringify(input.options), input.userId]
    );
    return { ok: true, id: String(result.rows[0]?.id ?? '') };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create bubble category.';
    if (message.includes('duplicate key value') || message.includes('unique constraint')) {
      return { ok: false, error: 'A bubble category with that name already exists.' };
    }
    return { ok: false, error: message };
  }
}

export async function updateBubbleCategory(input: {
  organizationId: number;
  userId: number | null;
  id: string;
  label: string;
  options: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  try {
    const result = await pool.query(
      `UPDATE bubble_category_defs
       SET label = $3, options_json = $4::jsonb, updated_by_user_id = $5, updated_at = NOW()
       WHERE organization_id = $1 AND id = $2::bigint`,
      [input.organizationId, input.id, input.label, JSON.stringify(input.options), input.userId]
    );
    if (!result.rowCount) return { ok: false, error: 'Bubble category not found.' };
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update bubble category.';
    if (message.includes('duplicate key value') || message.includes('unique constraint')) {
      return { ok: false, error: 'A bubble category with that name already exists.' };
    }
    return { ok: false, error: message };
  }
}

export async function deleteBubbleCategory(input: { organizationId: number; id: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  try {
    await pool.query(`DELETE FROM bubble_category_defs WHERE organization_id = $1 AND id = $2::bigint`, [input.organizationId, input.id]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to delete bubble category.' };
  }
}

function normalizeQuestionnaireFrequency(value: unknown): QuestionnaireAssignmentRow['frequency'] {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'daily' || normalized === 'weekly' || normalized === 'monthly') return normalized;
  return 'once';
}

function normalizeQuestionType(value: unknown): QuestionnaireQuestionType {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'multiple_choice' || normalized === 'scale' || normalized === 'number' || normalized === 'yes_no') return normalized;
  return 'text';
}

function normalizeQuestionnaireQuestions(value: unknown): QuestionnaireQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((question, index) => {
      const entry = question && typeof question === 'object' ? (question as Record<string, unknown>) : {};
      const prompt = String(entry.prompt ?? '').trim();
      if (!prompt) return null;
      const type = normalizeQuestionType(entry.type);
      const options = Array.isArray(entry.options)
        ? entry.options.map((option) => String(option ?? '').trim()).filter(Boolean).slice(0, 12)
        : [];
      const scaleMinRaw = Number(entry.scaleMin ?? 1);
      const scaleMaxRaw = Number(entry.scaleMax ?? 10);
      const scaleMin = Number.isFinite(scaleMinRaw) ? Math.max(0, Math.min(99, Math.floor(scaleMinRaw))) : 1;
      const scaleMax = Number.isFinite(scaleMaxRaw) ? Math.max(scaleMin + 1, Math.min(100, Math.floor(scaleMaxRaw))) : 10;
      return {
        id: String(entry.id ?? `q-${index + 1}`).trim() || `q-${index + 1}`,
        prompt,
        type,
        options,
        scaleMin,
        scaleMax,
      };
    })
    .filter((question): question is QuestionnaireQuestion => question !== null)
    .slice(0, 40);
}

function normalizePlayerIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
        .map((id) => Math.floor(id))
    )
  );
}

const QUESTIONNAIRE_DAY_TIME_ZONE = 'America/Phoenix';

function isoDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
}

function todayIsoForQuestionnaires(): string {
  return isoDateInTimeZone(new Date(), QUESTIONNAIRE_DAY_TIME_ZONE);
}

function addQuestionnaireDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addQuestionnaireMonths(value: string, months: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function currentQuestionnaireDueDate(startDate: string, frequency: QuestionnaireAssignmentRow['frequency'], today = todayIsoForQuestionnaires()): string {
  if (!startDate || startDate > today || frequency === 'once') return startDate;
  if (frequency === 'daily') return today;
  if (frequency === 'weekly') {
    let dueDate = startDate;
    while (addQuestionnaireDays(dueDate, 7) <= today) dueDate = addQuestionnaireDays(dueDate, 7);
    return dueDate;
  }
  let dueDate = startDate;
  while (addQuestionnaireMonths(dueDate, 1) <= today) dueDate = addQuestionnaireMonths(dueDate, 1);
  return dueDate;
}

export async function createQuestionnaire(input: {
  organizationId: number;
  userId: number | null;
  name: string;
  questions: unknown;
  assignments: Array<{
    groupName?: string;
    playerIds?: unknown;
    notifyStartDate?: string;
    frequency?: unknown;
  }>;
}): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const name = input.name.trim().replace(/\s+/g, ' ');
  const questions = normalizeQuestionnaireQuestions(input.questions);
  if (!name) return { ok: false, error: 'Questionnaire name is required.' };
  if (!questions.length) return { ok: false, error: 'Add at least one question.' };

  const assignments = input.assignments
    .map((assignment) => ({
      groupName: String(assignment.groupName ?? '').trim().replace(/\s+/g, ' '),
      playerIds: normalizePlayerIds(assignment.playerIds),
      notifyStartDate: /^\d{4}-\d{2}-\d{2}$/.test(String(assignment.notifyStartDate ?? ''))
        ? String(assignment.notifyStartDate)
        : todayIsoForQuestionnaires(),
      frequency: normalizeQuestionnaireFrequency(assignment.frequency),
    }))
    .filter((assignment) => assignment.playerIds.length > 0)
    .slice(0, 20);
  if (!assignments.length) return { ok: false, error: 'Choose at least one player to receive this questionnaire.' };

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query<{ id: string }>(
      `INSERT INTO questionnaires (organization_id, name, questions_json, created_by_user_id, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       RETURNING id::text AS id`,
      [input.organizationId, name, JSON.stringify(questions), input.userId]
    );
    const questionnaireId = Number(created.rows[0]?.id ?? 0);
    for (const assignment of assignments) {
      await client.query(
        `INSERT INTO questionnaire_assignments
          (questionnaire_id, organization_id, group_name, player_ids_json, notify_start_date, frequency, created_by_user_id, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::date, $6, $7, NOW())`,
        [
          questionnaireId,
          input.organizationId,
          assignment.groupName,
          JSON.stringify(assignment.playerIds),
          assignment.notifyStartDate,
          assignment.frequency,
          input.userId,
        ]
      );
    }
    await client.query('COMMIT');
    return { ok: true, id: questionnaireId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to create questionnaire.' };
  } finally {
    client.release();
  }
}

export async function updateQuestionnaire(input: {
  questionnaireId: number;
  organizationId: number;
  userId: number | null;
  name: string;
  questions: unknown;
  assignments: Array<{
    id?: number;
    groupName?: string;
    playerIds?: unknown;
    notifyStartDate?: string;
    frequency?: unknown;
  }>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const questionnaireId = Number(input.questionnaireId);
  const name = input.name.trim().replace(/\s+/g, ' ');
  const questions = normalizeQuestionnaireQuestions(input.questions);
  if (!Number.isFinite(questionnaireId) || questionnaireId <= 0) {
    return { ok: false, error: 'Questionnaire is required.' };
  }
  if (!name) return { ok: false, error: 'Questionnaire name is required.' };
  if (!questions.length) return { ok: false, error: 'Add at least one question.' };

  const assignments = input.assignments
    .map((assignment) => ({
      id: Number.isFinite(Number(assignment.id)) && Number(assignment.id) > 0 ? Number(assignment.id) : null,
      groupName: String(assignment.groupName ?? '').trim().replace(/\s+/g, ' '),
      playerIds: normalizePlayerIds(assignment.playerIds),
      notifyStartDate: /^\d{4}-\d{2}-\d{2}$/.test(String(assignment.notifyStartDate ?? ''))
        ? String(assignment.notifyStartDate)
        : todayIsoForQuestionnaires(),
      frequency: normalizeQuestionnaireFrequency(assignment.frequency),
    }))
    .filter((assignment) => assignment.playerIds.length > 0)
    .slice(0, 20);
  if (!assignments.length) return { ok: false, error: 'Choose at least one player to receive this questionnaire.' };

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE questionnaires
       SET name = $3, questions_json = $4::jsonb, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [questionnaireId, input.organizationId, name, JSON.stringify(questions)]
    );
    if (updated.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Questionnaire was not found.' };
    }

    const activeAssignmentIds: number[] = [];
    for (const assignment of assignments) {
      if (assignment.id) {
        const assignmentUpdated = await client.query(
          `UPDATE questionnaire_assignments
           SET group_name = $4,
               player_ids_json = $5::jsonb,
               notify_start_date = $6::date,
               frequency = $7,
               is_active = TRUE,
               updated_at = NOW()
           WHERE id = $1 AND questionnaire_id = $2 AND organization_id = $3`,
          [
            assignment.id,
            questionnaireId,
            input.organizationId,
            assignment.groupName,
            JSON.stringify(assignment.playerIds),
            assignment.notifyStartDate,
            assignment.frequency,
          ]
        );
        if (assignmentUpdated.rowCount !== 1) {
          throw new Error('One of the questionnaire assignments was not found.');
        }
        activeAssignmentIds.push(assignment.id);
        continue;
      }

      const created = await client.query<{ id: string }>(
        `INSERT INTO questionnaire_assignments
          (questionnaire_id, organization_id, group_name, player_ids_json, notify_start_date, frequency, created_by_user_id, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::date, $6, $7, NOW())
         RETURNING id::text AS id`,
        [
          questionnaireId,
          input.organizationId,
          assignment.groupName,
          JSON.stringify(assignment.playerIds),
          assignment.notifyStartDate,
          assignment.frequency,
          input.userId,
        ]
      );
      activeAssignmentIds.push(Number(created.rows[0]?.id ?? 0));
    }

    await client.query(
      `UPDATE questionnaire_assignments
       SET is_active = FALSE, updated_at = NOW()
       WHERE questionnaire_id = $1
         AND organization_id = $2
         AND NOT (id = ANY($3::bigint[]))`,
      [questionnaireId, input.organizationId, activeAssignmentIds]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to update questionnaire.' };
  } finally {
    client.release();
  }
}

export async function deleteQuestionnaire(input: {
  questionnaireId: number;
  organizationId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const questionnaireId = Number(input.questionnaireId);
  if (!Number.isFinite(questionnaireId) || questionnaireId <= 0) {
    return { ok: false, error: 'Questionnaire is required.' };
  }
  const pool = getDbPool();
  try {
    const result = await pool.query(
      `DELETE FROM questionnaires
       WHERE id = $1 AND organization_id = $2`,
      [questionnaireId, input.organizationId]
    );
    return result.rowCount === 1 ? { ok: true } : { ok: false, error: 'Questionnaire was not found.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to delete questionnaire.' };
  }
}

export async function listQuestionnairesForOrganization(organizationId: number): Promise<QuestionnaireRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const result = await pool.query<{
    id: string;
    organization_id: number;
    name: string;
    questions_json: unknown;
    created_by_user_id: number | null;
    created_at: string;
    updated_at: string;
    assignment_id: string | null;
    group_name: string | null;
    player_ids_json: unknown;
    notify_start_date: string | null;
    frequency: string | null;
    is_active: boolean | null;
  }>(
    `SELECT
       q.id::text AS id,
       q.organization_id,
       q.name,
       q.questions_json,
       q.created_by_user_id,
       q.created_at::text AS created_at,
       q.updated_at::text AS updated_at,
       a.id::text AS assignment_id,
       a.group_name,
       a.player_ids_json,
       a.notify_start_date::text AS notify_start_date,
       a.frequency,
       a.is_active
     FROM questionnaires q
     LEFT JOIN questionnaire_assignments a ON a.questionnaire_id = q.id
     WHERE q.organization_id = $1
     ORDER BY q.updated_at DESC, a.id ASC`,
    [organizationId]
  );
  const byQuestionnaire = new Map<number, QuestionnaireRow>();
  for (const row of result.rows) {
    const id = Number(row.id);
    let questionnaire = byQuestionnaire.get(id);
    if (!questionnaire) {
      questionnaire = {
        id,
        organizationId: row.organization_id,
        name: row.name,
        questions: normalizeQuestionnaireQuestions(row.questions_json),
        assignments: [],
        createdByUserId: row.created_by_user_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      byQuestionnaire.set(id, questionnaire);
    }
    if (row.assignment_id) {
      questionnaire.assignments.push({
        id: Number(row.assignment_id),
        groupName: String(row.group_name ?? ''),
        playerIds: normalizePlayerIds(row.player_ids_json),
        notifyStartDate: String(row.notify_start_date ?? ''),
        frequency: normalizeQuestionnaireFrequency(row.frequency),
        isActive: row.is_active !== false,
      });
    }
  }
  return Array.from(byQuestionnaire.values());
}

export async function listQuestionnaireResponses(input: {
  organizationId: number;
  questionnaireId?: number | null;
  playerId?: number | null;
  groupName?: string | null;
}): Promise<QuestionnaireResponseRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const values: unknown[] = [input.organizationId];
  const filters: string[] = [`r.organization_id = $1`];
  const questionnaireId = Number(input.questionnaireId ?? 0);
  if (Number.isFinite(questionnaireId) && questionnaireId > 0) {
    values.push(questionnaireId);
    filters.push(`r.questionnaire_id = $${values.length}`);
  }
  const playerId = Number(input.playerId ?? 0);
  if (Number.isFinite(playerId) && playerId > 0) {
    values.push(playerId);
    filters.push(`r.player_id = $${values.length}`);
  }
  const groupName = String(input.groupName ?? '').trim();
  if (groupName) {
    values.push(groupName.toLowerCase());
    filters.push(`LOWER(a.group_name) = $${values.length}`);
  }
  const pool = getDbPool();
  const result = await pool.query<{
    id: string;
    questionnaire_id: string;
    questionnaire_name: string;
    assignment_id: string;
    group_name: string | null;
    player_id: number;
    player_name: string;
    due_date: string;
    answers_json: unknown;
    submitted_at: string;
  }>(
    `SELECT
       r.id::text AS id,
       r.questionnaire_id::text AS questionnaire_id,
       q.name AS questionnaire_name,
       r.assignment_id::text AS assignment_id,
       a.group_name,
       r.player_id,
       p.full_name AS player_name,
       r.due_date::text AS due_date,
       r.answers_json,
       r.submitted_at::text AS submitted_at
     FROM questionnaire_responses r
     JOIN questionnaires q ON q.id = r.questionnaire_id
     JOIN questionnaire_assignments a ON a.id = r.assignment_id
     JOIN players p ON p.id = r.player_id
     WHERE ${filters.join(' AND ')}
     ORDER BY r.submitted_at DESC
     LIMIT 1000`,
    values
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    questionnaireId: Number(row.questionnaire_id),
    questionnaireName: row.questionnaire_name,
    assignmentId: Number(row.assignment_id),
    groupName: String(row.group_name ?? ''),
    playerId: row.player_id,
    playerName: row.player_name,
    dueDate: row.due_date,
    answers: row.answers_json && typeof row.answers_json === 'object' && !Array.isArray(row.answers_json) ? (row.answers_json as Record<string, string>) : {},
    submittedAt: row.submitted_at,
  }));
}

export async function listPendingQuestionnairesForPlayer(input: {
  organizationId: number;
  playerId: number;
}): Promise<PendingQuestionnaireRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const today = todayIsoForQuestionnaires();
  const pool = getDbPool();
  const result = await pool.query<{
    questionnaire_id: string;
    questionnaire_name: string;
    questions_json: unknown;
    assignment_id: string;
    group_name: string | null;
    notify_start_date: string;
    frequency: string;
  }>(
    `SELECT
       q.id::text AS questionnaire_id,
       q.name AS questionnaire_name,
       q.questions_json,
       a.id::text AS assignment_id,
       a.group_name,
       a.notify_start_date::text AS notify_start_date,
       a.frequency
     FROM questionnaire_assignments a
     JOIN questionnaires q ON q.id = a.questionnaire_id
     WHERE a.organization_id = $1
       AND a.is_active = TRUE
       AND a.notify_start_date <= $2::date
       AND a.player_ids_json @> $3::jsonb
     ORDER BY a.notify_start_date ASC, a.id ASC`,
    [input.organizationId, today, JSON.stringify([input.playerId])]
  );
  const pending: PendingQuestionnaireRow[] = [];
  for (const row of result.rows) {
    const dueDate = currentQuestionnaireDueDate(row.notify_start_date, normalizeQuestionnaireFrequency(row.frequency), today);
    if (!dueDate || dueDate > today) continue;
    const response = await pool.query<{ id: string }>(
      `SELECT id::text AS id
       FROM questionnaire_responses
       WHERE organization_id = $1
         AND player_id = $2
         AND due_date = $3::date
         AND (assignment_id = $4 OR questionnaire_id = $5)
       LIMIT 1`,
      [input.organizationId, input.playerId, dueDate, Number(row.assignment_id), Number(row.questionnaire_id)]
    );
    if (response.rowCount) continue;
    pending.push({
      questionnaireId: Number(row.questionnaire_id),
      questionnaireName: row.questionnaire_name,
      assignmentId: Number(row.assignment_id),
      groupName: String(row.group_name ?? ''),
      dueDate,
      questions: normalizeQuestionnaireQuestions(row.questions_json),
    });
  }
  return pending;
}

export async function saveQuestionnaireResponse(input: {
  organizationId: number;
  playerId: number;
  assignmentId: number;
  questionnaireId: number;
  dueDate: string;
  answers: Record<string, string>;
  submittedByUserId?: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) return { ok: false, error: 'Invalid due date.' };
  const pool = getDbPool();
  const assignment = await pool.query<{ player_ids_json: unknown }>(
    `SELECT player_ids_json
     FROM questionnaire_assignments
     WHERE id = $1 AND questionnaire_id = $2 AND organization_id = $3 AND is_active = TRUE
     LIMIT 1`,
    [input.assignmentId, input.questionnaireId, input.organizationId]
  );
  if (!assignment.rowCount) return { ok: false, error: 'Questionnaire is no longer available.' };
  const playerIds = normalizePlayerIds(assignment.rows[0]?.player_ids_json);
  if (!playerIds.includes(input.playerId)) return { ok: false, error: 'Questionnaire is not assigned to this player.' };
  const cleanAnswers = Object.fromEntries(
    Object.entries(input.answers ?? {})
      .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
      .filter(([key]) => key.length > 0)
  );
  const saved = await pool.query<{ id: string }>(
    `INSERT INTO questionnaire_responses
       (questionnaire_id, assignment_id, organization_id, player_id, due_date, answers_json, submitted_at)
     VALUES ($1, $2, $3, $4, $5::date, $6::jsonb, NOW())
     ON CONFLICT (assignment_id, player_id, due_date)
     DO UPDATE SET answers_json = EXCLUDED.answers_json, submitted_at = NOW()
     RETURNING id::text AS id`,
    [input.questionnaireId, input.assignmentId, input.organizationId, input.playerId, input.dueDate, JSON.stringify(cleanAnswers)]
  );
  const responseId = Number(saved.rows[0]?.id ?? 0);
  if (Number.isFinite(responseId) && responseId > 0) {
    await upsertQuestionnaireResponsePlayerNote({
      organizationId: input.organizationId,
      responseId,
      createdByUserId: Number(input.submittedByUserId ?? 0) || null,
    });
  }
  return { ok: true };
}

function formatQuestionnaireResponseNote(input: {
  questionnaireName: string;
  dueDate: string;
  submittedAt: string;
  groupName: string;
  questions: QuestionnaireQuestion[];
  answers: Record<string, string>;
}): string {
  const lines: string[] = [`Questionnaire: ${input.questionnaireName}`, ''];
  for (const question of input.questions) {
    const answer = String(input.answers[question.id] ?? '').trim();
    lines.push(question.prompt);
    lines.push(answer || 'No answer');
    lines.push('');
  }
  return lines.join('\n').trim();
}

export async function upsertQuestionnaireResponsePlayerNote(input: {
  organizationId: number;
  responseId: number;
  createdByUserId?: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const response = await pool.query<{
    id: string;
    player_id: number;
    questionnaire_name: string;
    questions_json: unknown;
    group_name: string | null;
    due_date: string;
    answers_json: unknown;
    submitted_at: string;
  }>(
    `
      SELECT
        r.id::text AS id,
        r.player_id,
        q.name AS questionnaire_name,
        q.questions_json,
        a.group_name,
        r.due_date::text AS due_date,
        r.answers_json,
        r.submitted_at::text AS submitted_at
      FROM questionnaire_responses r
      JOIN questionnaires q ON q.id = r.questionnaire_id
      JOIN questionnaire_assignments a ON a.id = r.assignment_id
      JOIN players p ON p.id = r.player_id
      WHERE r.id = $1
        AND r.organization_id = $2
        AND p.organization_id = $2
      LIMIT 1
    `,
    [input.responseId, input.organizationId]
  );
  if ((response.rowCount ?? 0) !== 1) return { ok: false, error: 'Questionnaire response not found.' };

  const row = response.rows[0];
  const answers = row.answers_json && typeof row.answers_json === 'object' && !Array.isArray(row.answers_json) ? (row.answers_json as Record<string, string>) : {};
  const noteText = formatQuestionnaireResponseNote({
    questionnaireName: row.questionnaire_name,
    dueDate: row.due_date,
    submittedAt: row.submitted_at,
    groupName: String(row.group_name ?? ''),
    questions: normalizeQuestionnaireQuestions(row.questions_json),
    answers,
  });
  const sourceType = 'questionnaire_response';
  const sourceId = String(row.id);
  const noteDate = String(row.submitted_at ?? '').slice(0, 10) || row.due_date;

  await pool.query(
    `
      INSERT INTO player_plan_notes (
        player_id,
        domain,
        note_date,
        category,
        note_text,
        source_type,
        source_id,
        created_by_user_id
      )
      VALUES ($1, 'General', $2::date, 'Questionnaires', $3, $4, $5, $6)
      ON CONFLICT (player_id, source_type, source_id)
      DO UPDATE SET
        note_date = EXCLUDED.note_date,
        category = EXCLUDED.category,
        note_text = EXCLUDED.note_text,
        updated_at = NOW(),
        created_by_user_id = COALESCE(EXCLUDED.created_by_user_id, player_plan_notes.created_by_user_id)
    `,
    [row.player_id, noteDate, noteText, sourceType, sourceId, input.createdByUserId ?? null]
  );

  return { ok: true };
}

import { createPasswordHash, ensureAuthDbReady, getDbPool, isDatabaseConfigured } from './auth-db';
const DEFAULT_DASHBOARD_URL = 'https://pitchingcoachu.shinyapps.io/TMdata/';

export type ClientRow = {
  playerId: number;
  userId: number | null;
  fullName: string;
  email: string;
  dateOfBirth: string | null;
  schoolTeam: string | null;
  phone: string | null;
  collegeCommitment: string | null;
  batsHand: string | null;
  throwsHand: string | null;
  status: string;
  userRole: 'admin' | 'player' | null;
};

export type PlayerProfileRow = {
  id: number;
  fullName: string;
  email: string;
  dateOfBirth: string | null;
  schoolTeam: string | null;
  phone: string | null;
  collegeCommitment: string | null;
  batsHand: string | null;
  throwsHand: string | null;
  age: number | null;
};

export type BodyWeightLogRow = {
  logDate: string;
  weightLbs: number;
  notes: string | null;
};

export type TrackedExerciseRow = {
  exerciseId: number;
  name: string;
  category: string;
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

export type WorkoutExerciseAssignment = {
  exerciseId: number | null;
  prefix: string | null;
  name: string;
  category: string;
  repMeasure: 'reps' | 'seconds' | 'distance';
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
};

export async function ensureTrainingDbReady(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await ensureAuthDbReady();
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

export async function listClientsByOrganization(organizationId: number): Promise<ClientRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const result = await pool.query<{
    player_id: number;
    user_id: number | null;
    full_name: string;
    email: string;
    date_of_birth: string | null;
    school_team: string | null;
    phone: string | null;
    college_commitment: string | null;
    bats_hand: string | null;
    throws_hand: string | null;
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
        p.bats_hand,
        p.throws_hand,
        p.status,
        u.role AS user_role
      FROM players p
      LEFT JOIN auth_users u ON u.id = p.user_id
      WHERE p.organization_id = $1
      ORDER BY p.full_name ASC
    `,
    [organizationId]
  );

  return result.rows.map((row) => ({
    playerId: row.player_id,
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    dateOfBirth: row.date_of_birth,
    schoolTeam: row.school_team,
    phone: row.phone,
    collegeCommitment: row.college_commitment,
    batsHand: row.bats_hand,
    throwsHand: row.throws_hand,
    status: row.status,
    userRole: row.user_role === 'admin' || row.user_role === 'player' ? row.user_role : null,
  }));
}

export async function createClientWithLogin(input: {
  organizationId: number;
  fullName: string;
  email: string;
  password: string;
  dateOfBirth?: string;
  schoolTeam?: string;
  phone?: string;
  collegeCommitment?: string;
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingUser = await client.query<{ id: number }>(
      `SELECT id FROM auth_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail]
    );
    if ((existingUser.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'A login already exists with that email.' };
    }

    const passwordHash = createPasswordHash(input.password);
    const insertedUser = await client.query<{ id: number }>(
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

    await client.query(
      `
        INSERT INTO players (
          organization_id, user_id, full_name, email, date_of_birth, school_team, phone, college_commitment, bats_hand, throws_hand, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active')
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
        (input.batsHand ?? '').trim() || null,
        (input.throwsHand ?? '').trim() || null,
      ]
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to create client.' };
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
    reps_per_side: boolean;
    description: string | null;
    instruction_video_url: string | null;
    coaching_cues: string | null;
  }>(
    `
      SELECT id, name, category, rep_measure, reps_per_side, description, instruction_video_url, coaching_cues
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
    reps_per_side: boolean;
    description: string | null;
    instruction_video_url: string | null;
    coaching_cues: string | null;
  }>(
    `
      SELECT id, name, category, rep_measure, reps_per_side, description, instruction_video_url, coaching_cues
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
        organization_id, name, category, rep_measure, reps_per_side, description, instruction_video_url, coaching_cues, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      input.organizationId,
      name,
      category,
      repMeasure,
      repsPerSide,
      (input.description ?? '').trim() || null,
      videoCheck.value || null,
      (input.coachingCues ?? '').trim() || null,
      input.userId,
    ]
  );

  return { ok: true };
}

export async function updateExercise(input: {
  organizationId: number;
  userId: number;
  exerciseId: number;
  name: string;
  category: string;
  repMeasure?: string;
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
        reps_per_side = $4,
        description = $5,
        instruction_video_url = $6,
        coaching_cues = $7,
        updated_at = NOW()
      WHERE id = $8 AND organization_id = $9
      RETURNING id
    `,
    [
      name,
      category,
      repMeasure,
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
      repsPerSide: row.reps_per_side,
      sortOrder: row.sort_order,
      prefix: row.prefix,
      prescribedSets: row.prescribed_sets,
      prescribedReps: row.prescribed_reps,
      notes: row.notes,
    })),
  };
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
  if (input.exerciseItems.length === 0) return { ok: false, error: 'Add at least one exercise to the workout.' };

  const uniqueExerciseIds = Array.from(
    new Set(
      input.exerciseItems
        .map((item) => item.exerciseId)
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
  if (uniqueExerciseIds.length === 0) return { ok: false, error: 'Add at least one valid exercise.' };

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

    let sortOrder = 1;
    for (const item of input.exerciseItems) {
      const exerciseId = item.exerciseId;
      if (!uniqueExerciseIds.includes(exerciseId)) continue;
      await client.query(
        `
          INSERT INTO workout_exercises (
            workout_id, exercise_id, exercise_prefix, sort_order, prescribed_sets, prescribed_reps, prescribed_load, notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          workout.rows[0].id,
          exerciseId,
          (item.prefix ?? '').trim() || null,
          sortOrder,
          (item.prescribedSets ?? '').trim() || null,
          (item.prescribedReps ?? '').trim() || null,
          (item.prescribedLoad ?? '').trim() || null,
          (item.notes ?? '').trim() || null,
        ]
      );
      sortOrder += 1;
    }

    await client.query('COMMIT');
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
  if (input.exerciseItems.length === 0) return { ok: false, error: 'Add at least one exercise to the workout.' };

  const uniqueExerciseIds = Array.from(
    new Set(
      input.exerciseItems
        .map((item) => item.exerciseId)
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
  if (uniqueExerciseIds.length === 0) return { ok: false, error: 'Add at least one valid exercise.' };

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

    let sortOrder = 1;
    for (const item of input.exerciseItems) {
      const exerciseId = item.exerciseId;
      if (!uniqueExerciseIds.includes(exerciseId)) continue;
      await client.query(
        `
          INSERT INTO workout_exercises (
            workout_id, exercise_id, exercise_prefix, sort_order, prescribed_sets, prescribed_reps, prescribed_load, notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          input.workoutId,
          exerciseId,
          (item.prefix ?? '').trim() || null,
          sortOrder,
          (item.prescribedSets ?? '').trim() || null,
          (item.prescribedReps ?? '').trim() || null,
          (item.prescribedLoad ?? '').trim() || null,
          (item.notes ?? '').trim() || null,
        ]
      );
      sortOrder += 1;
    }

    await client.query('COMMIT');
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
      LEFT JOIN LATERAL (
        SELECT
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
                'repsPerSide', e2.reps_per_side,
                'prescribedSets', we2.prescribed_sets,
                'prescribedReps', we2.prescribed_reps,
                'instructionVideoUrl', e2.instruction_video_url,
                'description', e2.description,
                'coachingCues', e2.coaching_cues
              )
              ORDER BY we2.sort_order, e2.name
            ),
            '[]'::json
          ) AS exercise_json
        FROM workout_exercises we2
        JOIN exercise_library e2 ON e2.id = we2.exercise_id
        WHERE we2.workout_id = i.workout_id
      ) ws ON TRUE
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
    itemType: row.item_type === 'workout' ? 'workout' : 'exercise',
    itemName: row.item_name,
    workoutDescription: row.workout_description,
    exerciseId: row.exercise_id,
    workoutId: row.workout_id,
    workoutCategory: row.workout_category,
    exerciseCategory: row.exercise_category,
    repMeasure: row.rep_measure === 'seconds' ? 'seconds' : row.rep_measure === 'distance' ? 'distance' : 'reps',
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

export async function listExerciseLoadHistoryForPlayer(input: {
  playerId: number;
  exerciseIds: number[];
  beforeDate?: string;
  perExerciseLimit?: number;
}): Promise<Record<number, ExerciseLoadHistoryEntry[]>> {
  const resultMap: Record<number, ExerciseLoadHistoryEntry[]> = {};
  const exerciseIds = Array.from(new Set(input.exerciseIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (exerciseIds.length === 0) return resultMap;
  if (!isDatabaseConfigured()) return resultMap;
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const beforeDate = (input.beforeDate ?? '').trim();
  const hasBeforeDate = /^\d{4}-\d{2}-\d{2}$/.test(beforeDate);
  const perExerciseLimit = Math.max(1, Math.min(12, input.perExerciseLimit ?? 5));

  const rows = await pool.query<{
    day_date: string;
    source_name: string;
    exercise_id: number | null;
    performed_load: string | null;
    workout_exercise_json: unknown;
  }>(
    `
      SELECT
        d.day_date::text,
        COALESCE(w.name, e.name, 'Assignment') AS source_name,
        i.exercise_id,
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
                'prescribedSets', we2.prescribed_sets
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
      ORDER BY d.day_date DESC, i.id DESC
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
        });
        limitReached.set(row.exercise_id, current + 1);
      }
      continue;
    }

    const workoutExercises = Array.isArray(row.workout_exercise_json)
      ? (row.workout_exercise_json as Array<{ exerciseId?: number | null; prescribedSets?: string | null }>)
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
      });
      limitReached.set(exId, current + 1);
    }

    if (Array.from(limitReached.values()).every((count) => count >= perExerciseLimit)) break;
  }

  return resultMap;
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

export async function upsertExerciseLog(input: {
  playerId: number;
  itemId: number;
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
    [
      input.playerId,
      input.itemId,
      (input.performedSets ?? '').trim() || null,
      (input.performedReps ?? '').trim() || null,
      (input.performedLoad ?? '').trim() || null,
      input.completed,
      (input.notes ?? '').trim() || null,
      input.loggedByUserId,
    ]
  );
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
    bats_hand: string | null;
    throws_hand: string | null;
    age_years: string | null;
  }>(
    `
      SELECT
        id,
        full_name,
        email,
        date_of_birth::text,
        school_team,
        phone,
        college_commitment,
        bats_hand,
        throws_hand,
        CASE
          WHEN date_of_birth IS NULL THEN NULL
          ELSE DATE_PART('year', AGE(CURRENT_DATE, date_of_birth))::text
        END AS age_years
      FROM players
      WHERE id = $1 AND organization_id = $2
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
    batsHand: result.rows[0].bats_hand,
    throwsHand: result.rows[0].throws_hand,
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
    bats_hand: string | null;
    throws_hand: string | null;
    age_years: string | null;
  }>(
    `
      SELECT
        id,
        full_name,
        email,
        date_of_birth::text,
        school_team,
        phone,
        college_commitment,
        bats_hand,
        throws_hand,
        CASE
          WHEN date_of_birth IS NULL THEN NULL
          ELSE DATE_PART('year', AGE(CURRENT_DATE, date_of_birth))::text
        END AS age_years
      FROM players
      WHERE organization_id = $1 AND user_id = $2
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
    batsHand: result.rows[0].bats_hand,
    throwsHand: result.rows[0].throws_hand,
    age: result.rows[0].age_years ? Number(result.rows[0].age_years) : null,
  };
}

export async function updatePlayerProfile(input: {
  organizationId: number;
  playerId: number;
  fullName: string;
  email: string;
  dateOfBirth?: string;
  schoolTeam?: string;
  phone?: string;
  collegeCommitment?: string;
  batsHand?: string;
  throwsHand?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: 'DATABASE_URL is not configured.' };
  await ensureTrainingDbReady();
  const pool = getDbPool();

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  if (!fullName || !email) return { ok: false, error: 'Name and email are required.' };

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
        bats_hand = $7,
        throws_hand = $8,
        updated_at = NOW()
      WHERE id = $9 AND organization_id = $10
      RETURNING id
    `,
    [
      fullName,
      email,
      /^\d{4}-\d{2}-\d{2}$/.test((input.dateOfBirth ?? '').trim()) ? input.dateOfBirth?.trim() : null,
      (input.schoolTeam ?? '').trim() || null,
      (input.phone ?? '').trim() || null,
      (input.collegeCommitment ?? '').trim() || null,
      (input.batsHand ?? '').trim() || null,
      (input.throwsHand ?? '').trim() || null,
      input.playerId,
      input.organizationId,
    ]
  );

  if ((updated.rowCount ?? 0) !== 1) return { ok: false, error: 'Player not found in your organization.' };
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
  const pool = getDbPool();

  const result = await pool.query<{ exercise_id: number; name: string; category: string }>(
    `
      WITH direct_assignments AS (
        SELECT DISTINCT i.exercise_id
        FROM programs p
        JOIN program_days d ON d.program_id = p.id
        JOIN program_day_items i ON i.program_day_id = d.id
        JOIN exercise_logs l ON l.program_day_item_id = i.id AND l.player_id = p.player_id
        WHERE p.player_id = $1
          AND i.exercise_id IS NOT NULL
          AND l.performed_load IS NOT NULL
          AND LENGTH(TRIM(l.performed_load)) > 0
      ),
      workout_assignments AS (
        SELECT DISTINCT we.exercise_id
        FROM programs p
        JOIN program_days d ON d.program_id = p.id
        JOIN program_day_items i ON i.program_day_id = d.id
        JOIN exercise_logs l ON l.program_day_item_id = i.id AND l.player_id = p.player_id
        JOIN workout_exercises we ON we.workout_id = i.workout_id
        WHERE p.player_id = $1
          AND i.workout_id IS NOT NULL
          AND l.performed_load IS NOT NULL
          AND LENGTH(TRIM(l.performed_load)) > 0
      ),
      all_exercises AS (
        SELECT exercise_id FROM direct_assignments
        UNION
        SELECT exercise_id FROM workout_assignments
      )
      SELECT e.id AS exercise_id, e.name, e.category
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
  }));
}

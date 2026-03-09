import { Client } from 'pg';

const DEFAULT_APP_URL = 'https://pitchingcoachu.shinyapps.io/TMdata/';

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optionalIntEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid numeric env var: ${name}`);
  return parsed;
}

async function getOrgId(client, envName, fallbackFirst = false) {
  const forced = optionalIntEnv(envName);
  if (forced) return forced;
  if (!fallbackFirst) return null;
  const result = await client.query(`SELECT id FROM organizations ORDER BY id ASC LIMIT 1`);
  if (!result.rows[0]?.id) throw new Error(`Could not resolve organization id for ${envName}`);
  return Number(result.rows[0].id);
}

async function ensureTargetOrg(source, target, sourceOrgId, forcedTargetOrgId) {
  if (forcedTargetOrgId) {
    const check = await target.query(`SELECT id FROM organizations WHERE id = $1 LIMIT 1`, [forcedTargetOrgId]);
    if (!check.rows[0]?.id) throw new Error(`TARGET_ORG_ID ${forcedTargetOrgId} not found`);
    return forcedTargetOrgId;
  }

  const sourceOrg = await source.query(`SELECT id, name FROM organizations WHERE id = $1 LIMIT 1`, [sourceOrgId]);
  const sourceName = sourceOrg.rows[0]?.name;
  if (!sourceName) throw new Error(`Source org ${sourceOrgId} not found`);

  const existing = await target.query(`SELECT id FROM organizations WHERE name = $1 LIMIT 1`, [sourceName]);
  if (existing.rows[0]?.id) return Number(existing.rows[0].id);

  const inserted = await target.query(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [sourceName]);
  return Number(inserted.rows[0].id);
}

async function migrateUsersAndPlayers(source, target, sourceOrgId, targetOrgId) {
  const sourcePlayers = await source.query(
    `
      SELECT
        p.id AS player_id,
        p.full_name,
        p.email,
        p.date_of_birth,
        p.school_team,
        p.phone,
        p.college_commitment,
        p.bats_hand,
        p.throws_hand,
        p.status,
        u.id AS user_id,
        u.email AS user_email,
        u.username,
        u.name AS user_name,
        u.password,
        u.password_hash,
        u.role
      FROM players p
      LEFT JOIN auth_users u ON u.id = p.user_id
      WHERE p.organization_id = $1
      ORDER BY p.id ASC
    `,
    [sourceOrgId]
  );

  const playerIdMap = new Map();

  for (const row of sourcePlayers.rows) {
    let targetUserId = null;

    if (row.user_email) {
      const normalizedEmail = String(row.user_email).trim().toLowerCase();
      const existingUser = await target.query(`SELECT id FROM auth_users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [normalizedEmail]);

      if (existingUser.rows[0]?.id) {
        targetUserId = Number(existingUser.rows[0].id);
        await target.query(
          `
            UPDATE auth_users
            SET
              organization_id = $1,
              role = COALESCE(NULLIF($2, ''), role),
              app_url = $3,
              updated_at = NOW()
            WHERE id = $4
          `,
          [targetOrgId, String(row.role ?? 'player'), DEFAULT_APP_URL, targetUserId]
        );
      } else {
        const insertedUser = await target.query(
          `
            INSERT INTO auth_users (
              email, username, name, password, password_hash, app_url, role, organization_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
          `,
          [
            normalizedEmail,
            String(row.username ?? normalizedEmail),
            String(row.user_name ?? row.full_name ?? normalizedEmail),
            String(row.password ?? row.password_hash ?? ''),
            String(row.password_hash ?? row.password ?? ''),
            DEFAULT_APP_URL,
            String(row.role ?? 'player'),
            targetOrgId,
          ]
        );
        targetUserId = Number(insertedUser.rows[0].id);
      }
    }

    const normalizedPlayerEmail = String(row.email).trim().toLowerCase();
    const existingPlayer = await target.query(
      `SELECT id FROM players WHERE organization_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
      [targetOrgId, normalizedPlayerEmail]
    );

    let targetPlayerId;
    if (existingPlayer.rows[0]?.id) {
      targetPlayerId = Number(existingPlayer.rows[0].id);
      await target.query(
        `
          UPDATE players
          SET
            user_id = COALESCE($1, user_id),
            full_name = $2,
            email = $3,
            date_of_birth = $4,
            school_team = $5,
            phone = $6,
            college_commitment = $7,
            bats_hand = $8,
            throws_hand = $9,
            status = $10,
            updated_at = NOW()
          WHERE id = $11
        `,
        [
          targetUserId,
          String(row.full_name ?? ''),
          normalizedPlayerEmail,
          row.date_of_birth,
          row.school_team,
          row.phone,
          row.college_commitment,
          row.bats_hand,
          row.throws_hand,
          String(row.status ?? 'active'),
          targetPlayerId,
        ]
      );
    } else {
      const insertedPlayer = await target.query(
        `
          INSERT INTO players (
            organization_id, user_id, full_name, email, date_of_birth, school_team, phone,
            college_commitment, bats_hand, throws_hand, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id
        `,
        [
          targetOrgId,
          targetUserId,
          String(row.full_name ?? ''),
          normalizedPlayerEmail,
          row.date_of_birth,
          row.school_team,
          row.phone,
          row.college_commitment,
          row.bats_hand,
          row.throws_hand,
          String(row.status ?? 'active'),
        ]
      );
      targetPlayerId = Number(insertedPlayer.rows[0].id);
    }

    playerIdMap.set(Number(row.player_id), targetPlayerId);
  }

  return { playerIdMap, migratedPlayers: sourcePlayers.rowCount ?? 0 };
}

async function migrateCategories(source, target, sourceOrgId, targetOrgId) {
  const rows = await source.query(`SELECT id, name FROM exercise_categories WHERE organization_id = $1 ORDER BY id ASC`, [sourceOrgId]);
  const map = new Map();

  for (const row of rows.rows) {
    const existing = await target.query(
      `SELECT id FROM exercise_categories WHERE organization_id = $1 AND name = $2 LIMIT 1`,
      [targetOrgId, row.name]
    );
    const categoryId = existing.rows[0]?.id
      ? Number(existing.rows[0].id)
      : Number(
          (
            await target.query(
              `INSERT INTO exercise_categories (organization_id, name) VALUES ($1, $2) RETURNING id`,
              [targetOrgId, row.name]
            )
          ).rows[0].id
        );
    map.set(Number(row.id), categoryId);
  }

  return { categoryIdMap: map, migratedCategories: rows.rowCount ?? 0 };
}

async function migrateExercises(source, target, sourceOrgId, targetOrgId) {
  const rows = await source.query(
    `
      SELECT id, name, category, rep_measure, reps_per_side, description, instruction_video_url, coaching_cues
      FROM exercise_library
      WHERE organization_id = $1
      ORDER BY id ASC
    `,
    [sourceOrgId]
  );

  const map = new Map();

  for (const row of rows.rows) {
    const existing = await target.query(
      `SELECT id FROM exercise_library WHERE organization_id = $1 AND name = $2 AND category = $3 LIMIT 1`,
      [targetOrgId, row.name, row.category]
    );

    let exerciseId;
    if (existing.rows[0]?.id) {
      exerciseId = Number(existing.rows[0].id);
      await target.query(
        `
          UPDATE exercise_library
          SET
            rep_measure = $1,
            reps_per_side = $2,
            description = $3,
            instruction_video_url = $4,
            coaching_cues = $5,
            updated_at = NOW()
          WHERE id = $6
        `,
        [
          String(row.rep_measure ?? 'reps'),
          Boolean(row.reps_per_side),
          row.description,
          row.instruction_video_url,
          row.coaching_cues,
          exerciseId,
        ]
      );
    } else {
      exerciseId = Number(
        (
          await target.query(
            `
              INSERT INTO exercise_library (
                organization_id, name, category, rep_measure, reps_per_side, description, instruction_video_url, coaching_cues
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              RETURNING id
            `,
            [
              targetOrgId,
              row.name,
              row.category,
              String(row.rep_measure ?? 'reps'),
              Boolean(row.reps_per_side),
              row.description,
              row.instruction_video_url,
              row.coaching_cues,
            ]
          )
        ).rows[0].id
      );
    }

    map.set(Number(row.id), exerciseId);
  }

  return { exerciseIdMap: map, migratedExercises: rows.rowCount ?? 0 };
}

async function migrateWorkouts(source, target, sourceOrgId, targetOrgId, exerciseIdMap) {
  const workouts = await source.query(
    `SELECT id, name, category, description FROM workout_library WHERE organization_id = $1 ORDER BY id ASC`,
    [sourceOrgId]
  );

  const workoutIdMap = new Map();

  for (const row of workouts.rows) {
    const existing = await target.query(
      `SELECT id FROM workout_library WHERE organization_id = $1 AND name = $2 LIMIT 1`,
      [targetOrgId, row.name]
    );

    let workoutId;
    if (existing.rows[0]?.id) {
      workoutId = Number(existing.rows[0].id);
      await target.query(
        `UPDATE workout_library SET category = $1, description = $2, updated_at = NOW() WHERE id = $3`,
        [String(row.category ?? 'General'), row.description, workoutId]
      );
    } else {
      workoutId = Number(
        (
          await target.query(
            `INSERT INTO workout_library (organization_id, name, category, description) VALUES ($1, $2, $3, $4) RETURNING id`,
            [targetOrgId, row.name, String(row.category ?? 'General'), row.description]
          )
        ).rows[0].id
      );
    }

    workoutIdMap.set(Number(row.id), workoutId);
  }

  const workoutExercises = await source.query(
    `
      SELECT workout_id, exercise_id, exercise_prefix, sort_order, prescribed_sets, prescribed_reps, prescribed_load, notes
      FROM workout_exercises
      ORDER BY workout_id ASC, sort_order ASC, id ASC
    `
  );

  for (const row of workoutExercises.rows) {
    const mappedWorkoutId = workoutIdMap.get(Number(row.workout_id));
    const mappedExerciseId = exerciseIdMap.get(Number(row.exercise_id));
    if (!mappedWorkoutId || !mappedExerciseId) continue;

    await target.query(
      `
        INSERT INTO workout_exercises (
          workout_id, exercise_id, exercise_prefix, sort_order, prescribed_sets, prescribed_reps, prescribed_load, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (workout_id, exercise_id, sort_order)
        DO UPDATE SET
          exercise_prefix = EXCLUDED.exercise_prefix,
          prescribed_sets = EXCLUDED.prescribed_sets,
          prescribed_reps = EXCLUDED.prescribed_reps,
          prescribed_load = EXCLUDED.prescribed_load,
          notes = EXCLUDED.notes,
          updated_at = NOW()
      `,
      [
        mappedWorkoutId,
        mappedExerciseId,
        row.exercise_prefix,
        Number(row.sort_order ?? 0),
        row.prescribed_sets,
        row.prescribed_reps,
        row.prescribed_load,
        row.notes,
      ]
    );
  }

  return { workoutIdMap, migratedWorkouts: workouts.rowCount ?? 0 };
}

async function main() {
  const sourceUrl = requiredEnv('SOURCE_DATABASE_URL');
  const targetUrl = requiredEnv('TARGET_DATABASE_URL');

  const source = new Client({ connectionString: sourceUrl, ssl: sourceUrl.includes('sslmode=require') || sourceUrl.includes('sslmode=verify-full') ? { rejectUnauthorized: false } : undefined });
  const target = new Client({ connectionString: targetUrl, ssl: targetUrl.includes('sslmode=require') || targetUrl.includes('sslmode=verify-full') ? { rejectUnauthorized: false } : undefined });

  await source.connect();
  await target.connect();

  try {
    const sourceOrgId = await getOrgId(source, 'SOURCE_ORG_ID', true);
    const forcedTargetOrgId = optionalIntEnv('TARGET_ORG_ID');
    const targetOrgId = await ensureTargetOrg(source, target, sourceOrgId, forcedTargetOrgId);

    console.log(`Migrating source org ${sourceOrgId} -> target org ${targetOrgId}`);

    await target.query('BEGIN');

    const { migratedPlayers } = await migrateUsersAndPlayers(source, target, sourceOrgId, targetOrgId);
    const { migratedCategories } = await migrateCategories(source, target, sourceOrgId, targetOrgId);
    const { exerciseIdMap, migratedExercises } = await migrateExercises(source, target, sourceOrgId, targetOrgId);
    const { migratedWorkouts } = await migrateWorkouts(source, target, sourceOrgId, targetOrgId, exerciseIdMap);

    await target.query('COMMIT');

    console.log('Migration complete');
    console.log(JSON.stringify({ migratedPlayers, migratedCategories, migratedExercises, migratedWorkouts }, null, 2));
  } catch (error) {
    await target.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

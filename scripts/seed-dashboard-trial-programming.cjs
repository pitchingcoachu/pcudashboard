const { Pool } = require('pg');

const SOURCE_ORG_ID = 1;
const TARGET_ORG_NAME = 'Dashboard Trial';

const FIRST_NAMES = [
  'Mason', 'Carter', 'Nolan', 'Evan', 'Cole', 'Logan', 'Wyatt', 'Caleb', 'Parker', 'Owen',
  'Grant', 'Reid', 'Blake', 'Luke', 'Tyler', 'Ryan', 'Austin', 'Dylan', 'Gavin', 'Chase',
];
const LAST_NAMES = [
  'Anderson', 'Bennett', 'Carver', 'Collins', 'Dawson', 'Foster', 'Graham', 'Hayes', 'Hudson', 'Lawson',
  'Miller', 'Palmer', 'Reed', 'Sullivan', 'Turner', 'Walker', 'West', 'Wright', 'Young', 'Brooks',
];

function fakeName(index) {
  return `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]}`;
}

async function ensureOrg(client) {
  const existing = await client.query(
    `SELECT id FROM organizations WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) ORDER BY id ASC LIMIT 1`,
    [TARGET_ORG_NAME]
  );
  if (existing.rowCount) return Number(existing.rows[0].id);
  const created = await client.query(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [TARGET_ORG_NAME]);
  return Number(created.rows[0].id);
}

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const targetOrgId = await ensureOrg(client);

    await client.query(
      `
        INSERT INTO exercise_library (
          organization_id, name, category, description, instruction_video_url, coaching_cues,
          created_by, rep_measure, reps_per_side, tracking_type, created_at, updated_at
        )
        SELECT
          $1, e.name, e.category, e.description, e.instruction_video_url, e.coaching_cues,
          NULL, e.rep_measure, e.reps_per_side, e.tracking_type, NOW(), NOW()
        FROM exercise_library e
        WHERE e.organization_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM exercise_library existing
            WHERE existing.organization_id = $1
              AND LOWER(TRIM(existing.name)) = LOWER(TRIM(e.name))
              AND LOWER(TRIM(COALESCE(existing.category, ''))) = LOWER(TRIM(COALESCE(e.category, '')))
          )
      `,
      [targetOrgId, SOURCE_ORG_ID]
    );

    await client.query(
      `
        INSERT INTO workout_library (
          organization_id, name, description, category, calendar_link_target, created_by, created_at, updated_at
        )
        SELECT
          $1, w.name, w.description, w.category, w.calendar_link_target, NULL, NOW(), NOW()
        FROM workout_library w
        WHERE w.organization_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM workout_library existing
            WHERE existing.organization_id = $1
              AND LOWER(TRIM(existing.name)) = LOWER(TRIM(w.name))
          )
      `,
      [targetOrgId, SOURCE_ORG_ID]
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
          SELECT 1 FROM workout_exercises existing
          WHERE existing.workout_id = target_workout.id
            AND existing.sort_order = we.sort_order
            AND COALESCE(existing.exercise_prefix, '') = COALESCE(we.exercise_prefix, '')
        )
        ON CONFLICT DO NOTHING
      `,
      [targetOrgId, SOURCE_ORG_ID]
    );

    const sourcePlayers = await client.query(
      `
        SELECT status, college_commitment, grad_year, position, height,
               profile_weight_lbs, bats_hand, throws_hand
        FROM players
        WHERE organization_id = $1
        ORDER BY full_name ASC, id ASC
      `,
      [SOURCE_ORG_ID]
    );
    for (const [index, row] of sourcePlayers.rows.entries()) {
      const nextName = fakeName(index);
      const nextEmail = `trial.template.player.${String(index + 1).padStart(2, '0')}@example.invalid`;
      await client.query(
        `
          UPDATE players
          SET full_name = $2,
              status = COALESCE($4, 'active'),
              school_team = 'Dashboard Trial',
              college_commitment = $5,
              grad_year = $6,
              position = $7,
              height = $8,
              profile_weight_lbs = $9,
              bats_hand = $10,
              throws_hand = $11,
              updated_at = NOW()
          WHERE organization_id = $1
            AND LOWER(TRIM(email)) = LOWER(TRIM($3))
        `,
        [
          targetOrgId,
          nextName,
          nextEmail,
          row.status,
          row.college_commitment,
          row.grad_year,
          row.position,
          row.height,
          row.profile_weight_lbs,
          row.bats_hand,
          row.throws_hand,
        ]
      );
      await client.query(
        `
          INSERT INTO players (
            organization_id, user_id, full_name, email, status, school_team, phone,
            college_commitment, grad_year, position, height, profile_weight_lbs,
            bats_hand, throws_hand, assigned_coach_user_id, created_at, updated_at
          )
          SELECT
            $1, NULL, $2, $3, COALESCE($4, 'active'), 'Dashboard Trial', NULL,
            $5, $6, $7, $8, $9, $10, $11, NULL, NOW(), NOW()
          WHERE NOT EXISTS (
            SELECT 1 FROM players WHERE organization_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($3))
          )
        `,
        [
          targetOrgId,
          nextName,
          nextEmail,
          row.status,
          row.college_commitment,
          row.grad_year,
          row.position,
          row.height,
          row.profile_weight_lbs,
          row.bats_hand,
          row.throws_hand,
        ]
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
          COALESCE(s.templates_json, '{}'::jsonb), NULL, NULL, NOW(), NOW()
        FROM schedule_throwing_state s
        WHERE s.organization_id = $2 AND s.player_id = 0
        ON CONFLICT (organization_id, player_id)
        DO UPDATE SET
          templates_json = EXCLUDED.templates_json,
          week_notes_json = EXCLUDED.week_notes_json,
          updated_at = NOW()
      `,
      [targetOrgId, SOURCE_ORG_ID]
    );

    await client.query(
      `
        INSERT INTO dashboard_custom_reports (
          organization_id, school_code, name, payload_json, created_by_user_id,
          created_at, updated_at, applies_to_all_schools, created_by_email
        )
        SELECT $1, 'TRIAL', r.name, r.payload_json, NULL, NOW(), NOW(), FALSE, NULL
        FROM dashboard_custom_reports r
        WHERE r.organization_id = $2 AND r.school_code = 'PCU'
        ON CONFLICT (organization_id, school_code, applies_to_all_schools, lower(name))
        DO UPDATE SET payload_json = EXCLUDED.payload_json, updated_at = NOW()
      `,
      [targetOrgId, SOURCE_ORG_ID]
    );

    await client.query(
      `
        INSERT INTO dashboard_custom_tables (
          organization_id, school_code, name, columns_json, created_by_user_id,
          created_at, updated_at, created_by_email
        )
        SELECT $1, 'TRIAL', t.name, t.columns_json, NULL, NOW(), NOW(), NULL
        FROM dashboard_custom_tables t
        WHERE t.organization_id = $2 AND t.school_code = 'PCU'
        ON CONFLICT (organization_id, school_code, lower(name))
        DO UPDATE SET columns_json = EXCLUDED.columns_json, updated_at = NOW()
      `,
      [targetOrgId, SOURCE_ORG_ID]
    );

    const summary = await client.query(
      `
        SELECT
          $1::int AS organization_id,
          (SELECT COUNT(*)::int FROM players WHERE organization_id = $1) AS players,
          (SELECT COUNT(*)::int FROM exercise_library WHERE organization_id = $1) AS exercises,
          (SELECT COUNT(*)::int FROM workout_library WHERE organization_id = $1) AS workouts,
          (SELECT COUNT(*)::int FROM dashboard_custom_reports WHERE organization_id = $1 AND school_code = 'TRIAL') AS reports,
          (SELECT COUNT(*)::int FROM dashboard_custom_tables WHERE organization_id = $1 AND school_code = 'TRIAL') AS tables
      `,
      [targetOrgId]
    );
    await client.query('COMMIT');
    console.log(JSON.stringify(summary.rows[0], null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

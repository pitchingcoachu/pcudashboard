import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: '.env.local' });
dotenv.config();

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || process.env.DASHBOARD_DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not configured.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('sslmode=require') || connectionString.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
});

function normalizeQuestionType(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'multiple_choice' || normalized === 'scale' || normalized === 'number' || normalized === 'yes_no') return normalized;
  return 'text';
}

function normalizeQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((question, index) => {
      const entry = question && typeof question === 'object' ? question : {};
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
    .filter(Boolean)
    .slice(0, 40);
}

function formatNote(row) {
  const answers = row.answers_json && typeof row.answers_json === 'object' && !Array.isArray(row.answers_json) ? row.answers_json : {};
  const questions = normalizeQuestions(row.questions_json);
  const lines = [
    `Questionnaire: ${row.questionnaire_name}`,
    `Submitted: ${row.submitted_at}`,
    `Due Date: ${row.due_date}`,
  ];
  const groupName = String(row.group_name ?? '').trim();
  if (groupName) lines.push(`Group: ${groupName}`);
  lines.push('');
  for (const question of questions) {
    const answer = String(answers[question.id] ?? '').trim();
    lines.push(question.prompt);
    lines.push(answer || 'No answer');
    lines.push('');
  }
  return lines.join('\n').trim();
}

async function main() {
  await pool.query(`ALTER TABLE player_plan_notes ADD COLUMN IF NOT EXISTS source_type TEXT;`);
  await pool.query(`ALTER TABLE player_plan_notes ADD COLUMN IF NOT EXISTS source_id TEXT;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_player_plan_notes_source ON player_plan_notes (player_id, source_type, source_id);`);

  const responses = await pool.query(`
    SELECT
      r.id::text AS id,
      r.organization_id,
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
    JOIN players p ON p.id = r.player_id AND p.organization_id = r.organization_id
    ORDER BY r.id ASC
  `);

  let upserted = 0;
  for (const row of responses.rows) {
    const noteText = formatNote(row);
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
        VALUES ($1, 'General', $2::date, 'Questionnaires', $3, 'questionnaire_response', $4, NULL)
        ON CONFLICT (player_id, source_type, source_id)
        DO UPDATE SET
          note_date = EXCLUDED.note_date,
          category = EXCLUDED.category,
          note_text = EXCLUDED.note_text,
          updated_at = NOW()
      `,
      [row.player_id, noteDate, noteText, row.id]
    );
    upserted += 1;
  }

  console.log(JSON.stringify({ responses: responses.rowCount, upserted }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

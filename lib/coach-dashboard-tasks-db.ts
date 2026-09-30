import { getDbPool, isDatabaseConfigured } from './auth-db';

export type TaskPriority = 'high' | 'medium' | 'low';

export type CoachDashboardTask = {
  id: number;
  title: string;
  notes: string;
  dueDate: string | null;
  priority: TaskPriority;
  playerId: number | null;
  playerName: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Owner = { organizationId: number; ownerUserId: number };
export type TaskFields = { title: string; notes: string; dueDate: string | null; priority: TaskPriority; playerId: number | null };

const PRIORITIES: TaskPriority[] = ['high', 'medium', 'low'];
const COLUMNS = `t.id,t.title,t.notes,t.due_date::text,t.priority,t.player_id,p.full_name AS player_name,
  t.completed_at,t.created_at,t.updated_at`;

let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

export async function ensureCoachDashboardTaskSchema(): Promise<void> {
  if (!isDatabaseConfigured() || schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await getDbPool().query(`
      CREATE TABLE IF NOT EXISTS coach_dashboard_tasks (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        owner_user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        due_date DATE,
        priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
        player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_coach_dashboard_tasks_owner_open
        ON coach_dashboard_tasks (owner_user_id, organization_id, completed_at);
    `);
    schemaReady = true;
  })().finally(() => { schemaPromise = null; });
  return schemaPromise;
}

/** Timestamps go out as ISO strings, which every browser (Safari included) can parse. */
const isoTimestamp = (value: unknown) => new Date(value as string | Date).toISOString();

function taskFromRow(row: Record<string, unknown>): CoachDashboardTask {
  return {
    id: Number(row.id), title: String(row.title), notes: String(row.notes ?? ''),
    dueDate: row.due_date ? String(row.due_date) : null,
    priority: PRIORITIES.includes(row.priority as TaskPriority) ? row.priority as TaskPriority : 'medium',
    playerId: row.player_id ? Number(row.player_id) : null, playerName: row.player_name ? String(row.player_name) : null,
    completedAt: row.completed_at ? isoTimestamp(row.completed_at) : null,
    createdAt: isoTimestamp(row.created_at), updatedAt: isoTimestamp(row.updated_at),
  };
}

/** Validates and normalizes task input from a request body. */
export function parseTaskFields(body: Record<string, unknown>): TaskFields {
  const title = String(body.title ?? '').trim().slice(0, 300);
  if (!title) throw new Error('A task needs a title.');
  const dueDate = String(body.dueDate ?? '').trim();
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('Due date must be a valid date.');
  const priority = PRIORITIES.includes(body.priority as TaskPriority) ? body.priority as TaskPriority : 'medium';
  const playerId = Number(body.playerId) > 0 ? Number(body.playerId) : null;
  return { title, notes: String(body.notes ?? '').trim().slice(0, 5_000), dueDate: dueDate || null, priority, playerId };
}

async function selectTask(owner: Owner, id: number): Promise<CoachDashboardTask | null> {
  const result = await getDbPool().query(
    `SELECT ${COLUMNS} FROM coach_dashboard_tasks t LEFT JOIN players p ON p.id=t.player_id
     WHERE t.id=$3 AND t.organization_id=$1 AND t.owner_user_id=$2`,
    [owner.organizationId, owner.ownerUserId, id],
  );
  return result.rows[0] ? taskFromRow(result.rows[0]) : null;
}

/** Open tasks (all of them) or completed tasks (newest first), plus both counts. */
export async function listCoachDashboardTasks(input: Owner & { status: 'open' | 'completed' }) {
  await ensureCoachDashboardTaskSchema();
  const pool = getDbPool();
  const [tasks, counts] = await Promise.all([
    pool.query(
      `SELECT ${COLUMNS} FROM coach_dashboard_tasks t LEFT JOIN players p ON p.id=t.player_id
       WHERE t.organization_id=$1 AND t.owner_user_id=$2 AND t.completed_at IS ${input.status === 'open' ? '' : 'NOT '}NULL
       ORDER BY ${input.status === 'open' ? 't.created_at DESC' : 't.completed_at DESC'} LIMIT 2000`,
      [input.organizationId, input.ownerUserId],
    ),
    pool.query<{ open: string; completed: string }>(
      `SELECT COUNT(*) FILTER (WHERE completed_at IS NULL) AS open, COUNT(*) FILTER (WHERE completed_at IS NOT NULL) AS completed
       FROM coach_dashboard_tasks WHERE organization_id=$1 AND owner_user_id=$2`,
      [input.organizationId, input.ownerUserId],
    ),
  ]);
  return { tasks: tasks.rows.map(taskFromRow), openCount: Number(counts.rows[0]?.open ?? 0), completedCount: Number(counts.rows[0]?.completed ?? 0) };
}

/** Only athletes in the coach's organization can be linked to a task. */
async function allowedPlayerId(owner: Owner, playerId: number | null): Promise<number | null> {
  if (!playerId) return null;
  const result = await getDbPool().query(`SELECT id FROM players WHERE id=$1 AND organization_id=$2`, [playerId, owner.organizationId]);
  return result.rows[0] ? playerId : null;
}

export async function createCoachDashboardTask(input: Owner & TaskFields): Promise<CoachDashboardTask> {
  await ensureCoachDashboardTaskSchema();
  const playerId = await allowedPlayerId(input, input.playerId);
  const result = await getDbPool().query<{ id: number }>(
    `INSERT INTO coach_dashboard_tasks (organization_id,owner_user_id,title,notes,due_date,priority,player_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [input.organizationId, input.ownerUserId, input.title, input.notes, input.dueDate, input.priority, playerId],
  );
  const task = await selectTask(input, Number(result.rows[0].id));
  if (!task) throw new Error('Could not save the task.');
  return task;
}

/** Edits a task's fields and/or marks it done (completed=true) or not done (completed=false). */
export async function updateCoachDashboardTask(input: Owner & { id: number; fields?: TaskFields; completed?: boolean }): Promise<CoachDashboardTask | null> {
  await ensureCoachDashboardTaskSchema();
  const pool = getDbPool();
  if (input.fields) {
    const playerId = await allowedPlayerId(input, input.fields.playerId);
    await pool.query(
      `UPDATE coach_dashboard_tasks SET title=$4,notes=$5,due_date=$6,priority=$7,player_id=$8,updated_at=NOW()
       WHERE id=$3 AND organization_id=$1 AND owner_user_id=$2`,
      [input.organizationId, input.ownerUserId, input.id, input.fields.title, input.fields.notes, input.fields.dueDate, input.fields.priority, playerId],
    );
  }
  if (input.completed !== undefined) {
    await pool.query(
      `UPDATE coach_dashboard_tasks SET completed_at=${input.completed ? 'COALESCE(completed_at,NOW())' : 'NULL'},updated_at=NOW()
       WHERE id=$3 AND organization_id=$1 AND owner_user_id=$2`,
      [input.organizationId, input.ownerUserId, input.id],
    );
  }
  return selectTask(input, input.id);
}

export async function deleteCoachDashboardTask(input: Owner & { id: number }): Promise<boolean> {
  await ensureCoachDashboardTaskSchema();
  const result = await getDbPool().query(
    `DELETE FROM coach_dashboard_tasks WHERE id=$3 AND organization_id=$1 AND owner_user_id=$2`,
    [input.organizationId, input.ownerUserId, input.id],
  );
  return Boolean(result.rowCount);
}

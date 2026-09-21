import { getDbPool, isDatabaseConfigured } from './auth-db';
import {
  listOrgQuestionnaireCatalog,
  listPlanProgramItemsForPlayer,
  listPlayerChoicesByOrganization,
  listPlayerProfilesWithPlanGoals,
  listQuestionnaireResponses,
} from './training-db';

export type CoachDashboardNote = {
  id: number;
  category: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CoachDashboardMedia = {
  id: number;
  title: string;
  category: string;
  mediaType: 'photo' | 'video' | 'pdf';
  fileName: string;
  contentType: string;
  sizeBytes: number;
  r2Key: string;
  breakdownAnnotations: unknown[];
  createdAt: string;
};

let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

export async function ensureCoachDashboardSchema(): Promise<void> {
  if (!isDatabaseConfigured() || schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const pool = getDbPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coach_dashboard_players (
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        owner_user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (organization_id, owner_user_id, player_id)
      );
      CREATE INDEX IF NOT EXISTS idx_coach_dashboard_players_owner
        ON coach_dashboard_players (owner_user_id, organization_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_coach_dashboard_players_player
        ON coach_dashboard_players (organization_id, player_id, owner_user_id);

      CREATE TABLE IF NOT EXISTS coach_dashboard_notes (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        owner_user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        category TEXT NOT NULL DEFAULT 'Ideas',
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_coach_dashboard_notes_owner_updated
        ON coach_dashboard_notes (owner_user_id, organization_id, is_pinned DESC, updated_at DESC);

      CREATE TABLE IF NOT EXISTS coach_dashboard_media (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        owner_user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'General',
        media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video', 'pdf')),
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL DEFAULT 0,
        r2_key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_coach_dashboard_media_owner_created
        ON coach_dashboard_media (owner_user_id, organization_id, created_at DESC);
      ALTER TABLE coach_dashboard_media
        ADD COLUMN IF NOT EXISTS breakdown_annotations_json JSONB NOT NULL DEFAULT '[]'::jsonb;

      CREATE TABLE IF NOT EXISTS coach_dashboard_media_categories (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        owner_user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_dashboard_media_categories_owner_name
        ON coach_dashboard_media_categories (organization_id, owner_user_id, LOWER(name));
    `);
    schemaReady = true;
  })().finally(() => { schemaPromise = null; });
  return schemaPromise;
}

function noteFromRow(row: Record<string, unknown>): CoachDashboardNote {
  return {
    id: Number(row.id), category: String(row.category), title: String(row.title), body: String(row.body),
    pinned: Boolean(row.is_pinned), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mediaFromRow(row: Record<string, unknown>): CoachDashboardMedia {
  const mediaType = row.media_type === 'video' || row.media_type === 'pdf' ? row.media_type : 'photo';
  return {
    id: Number(row.id), title: String(row.title), category: String(row.category), mediaType,
    fileName: String(row.file_name), contentType: String(row.content_type), sizeBytes: Number(row.size_bytes) || 0,
    r2Key: String(row.r2_key), breakdownAnnotations:Array.isArray(row.breakdown_annotations_json)?row.breakdown_annotations_json:[], createdAt: String(row.created_at),
  };
}

export async function listCoachDashboardSelectedPlayerIds(input: { organizationId: number; ownerUserId: number }): Promise<number[]> {
  await ensureCoachDashboardSchema();
  if (!isDatabaseConfigured()) return [];
  const result = await getDbPool().query<{ player_id: number }>(
    `SELECT player_id FROM coach_dashboard_players WHERE organization_id=$1 AND owner_user_id=$2 ORDER BY created_at, player_id`,
    [input.organizationId, input.ownerUserId],
  );
  return result.rows.map((row) => Number(row.player_id)).filter((id) => id > 0);
}

export async function replaceCoachDashboardPlayers(input: { organizationId: number; ownerUserId: number; playerIds: number[] }): Promise<void> {
  await ensureCoachDashboardSchema();
  const uniqueIds = Array.from(new Set(input.playerIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))).slice(0, 100);
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const allowed = uniqueIds.length
      ? await client.query<{ id: number }>(`SELECT id FROM players WHERE organization_id=$1 AND id=ANY($2::int[])`, [input.organizationId, uniqueIds])
      : { rows: [] as Array<{ id: number }> };
    const allowedIds = allowed.rows.map((row) => Number(row.id));
    await client.query(`DELETE FROM coach_dashboard_players WHERE organization_id=$1 AND owner_user_id=$2`, [input.organizationId, input.ownerUserId]);
    if (allowedIds.length) {
      await client.query(
        `INSERT INTO coach_dashboard_players (organization_id, owner_user_id, player_id)
         SELECT $1, $2, UNNEST($3::int[]) ON CONFLICT DO NOTHING`,
        [input.organizationId, input.ownerUserId, allowedIds],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listCoachDashboardNotes(input: { organizationId: number; ownerUserId: number }): Promise<CoachDashboardNote[]> {
  await ensureCoachDashboardSchema();
  const result = await getDbPool().query(
    `SELECT id,category,title,body,is_pinned,created_at::text,updated_at::text FROM coach_dashboard_notes
     WHERE organization_id=$1 AND owner_user_id=$2 ORDER BY is_pinned DESC, updated_at DESC LIMIT 300`,
    [input.organizationId, input.ownerUserId],
  );
  return result.rows.map(noteFromRow);
}

export async function saveCoachDashboardNote(input: { organizationId: number; ownerUserId: number; id?: number; category: string; title: string; body: string; pinned?: boolean }): Promise<CoachDashboardNote> {
  await ensureCoachDashboardSchema();
  const category = input.category.trim().slice(0, 80) || 'Ideas';
  const title = input.title.trim().slice(0, 180);
  const body = input.body.trim().slice(0, 20_000);
  if (!title || !body) throw new Error('A title and note are required.');
  const result = input.id
    ? await getDbPool().query(
        `UPDATE coach_dashboard_notes SET category=$4,title=$5,body=$6,is_pinned=$7,updated_at=NOW()
         WHERE id=$3 AND organization_id=$1 AND owner_user_id=$2
         RETURNING id,category,title,body,is_pinned,created_at::text,updated_at::text`,
        [input.organizationId, input.ownerUserId, input.id, category, title, body, Boolean(input.pinned)],
      )
    : await getDbPool().query(
        `INSERT INTO coach_dashboard_notes (organization_id,owner_user_id,category,title,body,is_pinned)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,category,title,body,is_pinned,created_at::text,updated_at::text`,
        [input.organizationId, input.ownerUserId, category, title, body, Boolean(input.pinned)],
      );
  if (!result.rows[0]) throw new Error('Note not found.');
  return noteFromRow(result.rows[0]);
}

export async function deleteCoachDashboardNote(input: { organizationId: number; ownerUserId: number; id: number }): Promise<boolean> {
  await ensureCoachDashboardSchema();
  const result = await getDbPool().query(`DELETE FROM coach_dashboard_notes WHERE id=$3 AND organization_id=$1 AND owner_user_id=$2`, [input.organizationId, input.ownerUserId, input.id]);
  return Boolean(result.rowCount);
}

export async function listCoachDashboardMedia(input: { organizationId: number; ownerUserId: number }): Promise<CoachDashboardMedia[]> {
  await ensureCoachDashboardSchema();
  const result = await getDbPool().query(
    `SELECT id,title,category,media_type,file_name,content_type,size_bytes,r2_key,breakdown_annotations_json,created_at::text
     FROM coach_dashboard_media WHERE organization_id=$1 AND owner_user_id=$2 ORDER BY created_at DESC LIMIT 300`,
    [input.organizationId, input.ownerUserId],
  );
  return result.rows.map(mediaFromRow);
}

export async function listCoachDashboardMediaCategories(input: { organizationId: number; ownerUserId: number }): Promise<string[]> {
  await ensureCoachDashboardSchema();
  const result = await getDbPool().query<{ name:string }>(
    `SELECT name FROM coach_dashboard_media_categories
     WHERE organization_id=$1 AND owner_user_id=$2 ORDER BY LOWER(name), name`,
    [input.organizationId,input.ownerUserId],
  );
  return result.rows.map((row)=>String(row.name).trim()).filter(Boolean);
}

export async function saveCoachDashboardMediaCategory(input: { organizationId:number; ownerUserId:number; name:string }): Promise<string> {
  await ensureCoachDashboardSchema();
  const name=input.name.trim().replace(/\s+/g,' ').slice(0,80);
  if(!name)throw new Error('Enter a category name.');
  await getDbPool().query(
    `INSERT INTO coach_dashboard_media_categories (organization_id,owner_user_id,name)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [input.organizationId,input.ownerUserId,name],
  );
  const result=await getDbPool().query<{name:string}>(
    `SELECT name FROM coach_dashboard_media_categories
     WHERE organization_id=$1 AND owner_user_id=$2 AND LOWER(name)=LOWER($3) LIMIT 1`,
    [input.organizationId,input.ownerUserId,name],
  );
  return String(result.rows[0]?.name??name);
}

export async function createCoachDashboardMedia(input: Omit<CoachDashboardMedia, 'id' | 'createdAt' | 'breakdownAnnotations'> & { organizationId: number; ownerUserId: number }): Promise<CoachDashboardMedia> {
  await ensureCoachDashboardSchema();
  const result = await getDbPool().query(
    `INSERT INTO coach_dashboard_media (organization_id,owner_user_id,title,category,media_type,file_name,content_type,size_bytes,r2_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id,title,category,media_type,file_name,content_type,size_bytes,r2_key,breakdown_annotations_json,created_at::text`,
    [input.organizationId, input.ownerUserId, input.title.trim().slice(0,180) || input.fileName, input.category.trim().slice(0,80) || 'General', input.mediaType, input.fileName, input.contentType, input.sizeBytes, input.r2Key],
  );
  return mediaFromRow(result.rows[0]);
}

export async function getCoachDashboardMedia(input: { organizationId: number; ownerUserId: number; id: number }): Promise<CoachDashboardMedia | null> {
  await ensureCoachDashboardSchema();
  const result = await getDbPool().query(
    `SELECT id,title,category,media_type,file_name,content_type,size_bytes,r2_key,breakdown_annotations_json,created_at::text
     FROM coach_dashboard_media WHERE id=$3 AND organization_id=$1 AND owner_user_id=$2`,
    [input.organizationId, input.ownerUserId, input.id],
  );
  return result.rows[0] ? mediaFromRow(result.rows[0]) : null;
}

export async function saveCoachDashboardMediaAnnotations(input: { organizationId:number; ownerUserId:number; id:number; annotations:unknown[] }): Promise<CoachDashboardMedia | null> {
  await ensureCoachDashboardSchema();
  const result=await getDbPool().query(
    `UPDATE coach_dashboard_media SET breakdown_annotations_json=$4::jsonb
     WHERE id=$3 AND organization_id=$1 AND owner_user_id=$2
     RETURNING id,title,category,media_type,file_name,content_type,size_bytes,r2_key,breakdown_annotations_json,created_at::text`,
    [input.organizationId,input.ownerUserId,input.id,JSON.stringify(input.annotations)],
  );
  return result.rows[0]?mediaFromRow(result.rows[0]):null;
}

export async function deleteCoachDashboardMedia(input: { organizationId: number; ownerUserId: number; id: number }): Promise<string | null> {
  await ensureCoachDashboardSchema();
  const result = await getDbPool().query<{ r2_key: string }>(
    `DELETE FROM coach_dashboard_media WHERE id=$3 AND organization_id=$1 AND owner_user_id=$2 RETURNING r2_key`,
    [input.organizationId, input.ownerUserId, input.id],
  );
  return result.rows[0]?.r2_key ?? null;
}

export async function listDashboardCoachUserIdsForPlayer(input: { organizationId: number; playerId: number }): Promise<number[]> {
  await ensureCoachDashboardSchema();
  const result = await getDbPool().query<{ owner_user_id: number }>(
    `SELECT owner_user_id FROM coach_dashboard_players WHERE organization_id=$1 AND player_id=$2`,
    [input.organizationId, input.playerId],
  );
  return result.rows.map((row) => Number(row.owner_user_id)).filter((id) => id > 0);
}

export async function getCoachDashboardOverview(input: { organizationId: number; ownerUserId: number }) {
  await ensureCoachDashboardSchema();
  const [availablePlayers, selectedIds, personalNotes, personalMedia, mediaCategories] = await Promise.all([
    listPlayerChoicesByOrganization({ organizationId: input.organizationId, activeOnly: true }),
    listCoachDashboardSelectedPlayerIds(input),
    listCoachDashboardNotes(input),
    listCoachDashboardMedia(input),
    listCoachDashboardMediaCategories(input),
  ]);
  const selectedSet = new Set(selectedIds);
  const selectedPlayers = availablePlayers.filter((player) => selectedSet.has(player.playerId));
  if (!selectedIds.length) return { availablePlayers, selectedPlayerIds: selectedIds, players: [], personalNotes, personalMedia, mediaCategories, playerNotes: [], reports: [], questionnaireTrends: [], workouts: [] };

  const pool = getDbPool();
  const [profiles, planItems, responses, catalog, notesResult, reportsResult] = await Promise.all([
    listPlayerProfilesWithPlanGoals({ organizationId: input.organizationId }),
    Promise.all(selectedIds.map(async (playerId) => ({ playerId, items: await listPlanProgramItemsForPlayer({ playerId }) }))),
    listQuestionnaireResponses({ organizationId: input.organizationId }),
    listOrgQuestionnaireCatalog({ organizationId: input.organizationId }),
    pool.query(
      `SELECT * FROM (
         SELECT n.id,p.id AS player_id,p.full_name AS player_name,n.domain,n.note_date::text,n.category,n.note_text,n.is_pinned,n.created_at::text
         FROM player_plan_notes n JOIN players p ON p.id=n.player_id
         WHERE p.organization_id=$1 AND p.id=ANY($2::int[])
         UNION ALL
         SELECT -n.id AS id,p.id AS player_id,p.full_name AS player_name,n.domain,n.note_date::text,n.category,n.note_text,FALSE AS is_pinned,n.created_at::text
         FROM dashboard_player_notes n
         JOIN players p ON p.organization_id=n.organization_id AND LOWER(BTRIM(p.full_name))=LOWER(BTRIM(n.dashboard_player_name))
         WHERE n.organization_id=$1 AND p.id=ANY($2::int[])
       ) notes
       ORDER BY is_pinned DESC,note_date DESC,created_at DESC LIMIT 250`,
      [input.organizationId, selectedIds],
    ),
    pool.query(
      `SELECT m.id,m.player_id,p.full_name AS player_name,m.title,m.category,m.file_name,m.created_at::text
       FROM player_media m JOIN players p ON p.id=m.player_id
       WHERE m.organization_id=$1 AND m.player_id=ANY($2::int[]) AND m.source_type='automated_report'
       ORDER BY m.created_at DESC LIMIT 200`,
      [input.organizationId, selectedIds],
    ),
  ]);

  const catalogById = new Map(catalog.map((entry) => [entry.questionnaireId, entry]));
  const trendMap = new Map<string, { playerId:number; playerName:string; questionnaireName:string; question:string; points:Array<{date:string;value:number}> }>();
  for (const response of responses) {
    if (!selectedSet.has(response.playerId)) continue;
    const questionnaire = catalogById.get(response.questionnaireId);
    if (!questionnaire) continue;
    for (const question of questionnaire.questions) {
      const raw = response.answers[question.id];
      const direct = Number(raw);
      const value = Number.isFinite(direct) ? direct : String(raw).toLowerCase() === 'yes' ? 1 : String(raw).toLowerCase() === 'no' ? 0 : null;
      if (value === null) continue;
      const key = `${response.playerId}:${response.questionnaireId}:${question.id}`;
      const series = trendMap.get(key) ?? { playerId:response.playerId, playerName:response.playerName, questionnaireName:response.questionnaireName, question:question.prompt, points:[] };
      series.points.push({ date: response.dueDate, value });
      trendMap.set(key, series);
    }
  }
  const questionnaireTrends = Array.from(trendMap.values())
    .map((series) => ({ ...series, points: series.points.sort((a,b) => a.date.localeCompare(b.date)).slice(-16) }))
    .filter((series) => series.points.length >= 2)
    .slice(0, 30);

  const playerNameById = new Map(availablePlayers.map((player) => [player.playerId, player.fullName]));
  const workouts = planItems.flatMap(({ playerId, items }) => items
    .filter((item) => item.itemType === 'workout')
    .map((item) => ({ playerId, playerName:playerNameById.get(playerId) ?? 'Player', itemId:item.itemId, name:item.itemName, section:item.planSection, targetCount:item.targetCount, completedCount:item.completedCount ?? 0 }))
  );

  const profileById = new Map(profiles.map((profile) => [profile.playerId, profile]));
  return {
    availablePlayers,
    selectedPlayerIds: selectedIds,
    players: selectedPlayers.map((player) => ({ ...player, goals: profileById.get(player.playerId)?.goals ?? [] })),
    personalNotes,
    personalMedia,
    mediaCategories,
    playerNotes: notesResult.rows.map((row) => ({ id:Number(row.id), playerId:Number(row.player_id), playerName:String(row.player_name), domain:String(row.domain), noteDate:String(row.note_date), category:String(row.category), noteText:String(row.note_text), pinned:Boolean(row.is_pinned), createdAt:String(row.created_at) })),
    reports: reportsResult.rows.map((row) => ({ id:Number(row.id), playerId:Number(row.player_id), playerName:String(row.player_name), title:String(row.title), category:String(row.category), fileName:String(row.file_name), createdAt:String(row.created_at) })),
    questionnaireTrends,
    workouts,
  };
}

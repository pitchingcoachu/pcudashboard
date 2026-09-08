import { getDbPool, isDatabaseConfigured } from './auth-db';

export type AiSessionStatus = 'uploaded' | 'processing' | 'ready' | 'failed';
export type AiSessionRow = {
  id: number;
  title: string;
  sessionType: string;
  sourceKind: 'audio' | 'video';
  status: AiSessionStatus;
  summaryBullets: string[];
  transcriptText: string;
  playerVisible: boolean;
  keepAudio: boolean;
  audioAvailable: boolean;
  playerIds: number[];
  playerNames: string[];
  createdAt: string;
  errorMessage: string | null;
};

export type FlagRuleRow = {
  id: number;
  name: string;
  domain: 'pitching' | 'hitting';
  metric: string;
  pitchType: string;
  direction: 'increase' | 'decrease' | 'either';
  threshold: number;
  thresholdType: 'absolute' | 'percent';
  baselineDays: number;
  minimumSample: number;
  targetPlayer: string;
  sessionType: string;
  notificationsEnabled: boolean;
  cooldownHours: number;
  enabled: boolean;
  createdAt: string;
  createdByUserId: number | null;
};

declare global {
  var __pcuAiWorkspaceReady: boolean | undefined;
  var __pcuAiWorkspaceReadyPromise: Promise<void> | undefined;
}

export async function ensureAiWorkspaceReady(): Promise<void> {
  if (!isDatabaseConfigured() || global.__pcuAiWorkspaceReady) return;
  if (global.__pcuAiWorkspaceReadyPromise) return global.__pcuAiWorkspaceReadyPromise;
  global.__pcuAiWorkspaceReadyPromise = (async () => {
    const pool = getDbPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_sessions (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        title TEXT NOT NULL,
        session_type TEXT NOT NULL DEFAULT 'General',
        source_kind TEXT NOT NULL CHECK (source_kind IN ('audio', 'video')),
        source_r2_key TEXT,
        source_file_name TEXT,
        source_content_type TEXT,
        source_size_bytes BIGINT NOT NULL DEFAULT 0,
        audio_r2_key TEXT,
        audio_content_type TEXT,
        status TEXT NOT NULL DEFAULT 'uploaded',
        summary_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        transcript_text TEXT NOT NULL DEFAULT '',
        player_visible BOOLEAN NOT NULL DEFAULT FALSE,
        keep_audio BOOLEAN NOT NULL DEFAULT FALSE,
        audio_expires_at TIMESTAMPTZ,
        error_message TEXT,
        created_by_user_id BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_sessions_org_created ON ai_sessions (organization_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS ai_session_players (
        session_id BIGINT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
        player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        PRIMARY KEY (session_id, player_id)
      );
      CREATE TABLE IF NOT EXISTS metric_flag_rules (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        name TEXT NOT NULL,
        domain TEXT NOT NULL CHECK (domain IN ('pitching', 'hitting')),
        metric TEXT NOT NULL,
        pitch_type TEXT NOT NULL DEFAULT 'All',
        direction TEXT NOT NULL CHECK (direction IN ('increase', 'decrease', 'either')),
        threshold DOUBLE PRECISION NOT NULL,
        threshold_type TEXT NOT NULL CHECK (threshold_type IN ('absolute', 'percent')),
        baseline_days INTEGER NOT NULL DEFAULT 30,
        minimum_sample INTEGER NOT NULL DEFAULT 5,
        target_player TEXT NOT NULL DEFAULT 'All',
        session_type TEXT NOT NULL DEFAULT 'All',
        notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        cooldown_hours INTEGER NOT NULL DEFAULT 24,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_by_user_id BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_metric_flag_rules_org ON metric_flag_rules (organization_id, enabled, domain);
      CREATE TABLE IF NOT EXISTS metric_flag_notifications (
        rule_id BIGINT NOT NULL REFERENCES metric_flag_rules(id) ON DELETE CASCADE,
        player_name TEXT NOT NULL,
        session_date DATE NOT NULL,
        notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (rule_id, player_name, session_date)
      );
    `);
    global.__pcuAiWorkspaceReady = true;
  })().finally(() => { global.__pcuAiWorkspaceReadyPromise = undefined; });
  return global.__pcuAiWorkspaceReadyPromise;
}

function mapSession(row: Record<string, unknown>): AiSessionRow {
  return {
    id: Number(row.id), title: String(row.title), sessionType: String(row.session_type),
    sourceKind: row.source_kind === 'video' ? 'video' : 'audio', status: row.status as AiSessionStatus,
    summaryBullets: Array.isArray(row.summary_json) ? row.summary_json.map(String) : [],
    transcriptText: String(row.transcript_text ?? ''), playerVisible: Boolean(row.player_visible),
    keepAudio: Boolean(row.keep_audio), audioAvailable: Boolean(row.audio_r2_key),
    playerIds: Array.isArray(row.player_ids) ? row.player_ids.map(Number) : [],
    playerNames: Array.isArray(row.player_names) ? row.player_names.map(String) : [],
    createdAt: String(row.created_at), errorMessage: row.error_message ? String(row.error_message) : null,
  };
}

export async function listAiSessions(input: { organizationId: number; playerId?: number; includeStaffOnly: boolean }): Promise<AiSessionRow[]> {
  await ensureAiWorkspaceReady();
  const result = await getDbPool().query<Record<string, unknown>>(`
    SELECT s.*, COALESCE(array_agg(p.id) FILTER (WHERE p.id IS NOT NULL), '{}') AS player_ids,
      COALESCE(array_agg(p.full_name ORDER BY p.full_name) FILTER (WHERE p.id IS NOT NULL), '{}') AS player_names
    FROM ai_sessions s
    LEFT JOIN ai_session_players sp ON sp.session_id = s.id
    LEFT JOIN players p ON p.id = sp.player_id
    WHERE s.organization_id = $1
      AND ($2::bigint IS NULL OR EXISTS (SELECT 1 FROM ai_session_players x WHERE x.session_id = s.id AND x.player_id = $2))
      AND ($3::boolean OR s.player_visible = TRUE)
    GROUP BY s.id ORDER BY s.created_at DESC LIMIT 200
  `, [input.organizationId, input.playerId ?? null, input.includeStaffOnly]);
  return result.rows.map(mapSession);
}

export async function createAiSession(input: { organizationId: number; userId: number; title: string; sessionType: string; sourceKind: 'audio' | 'video'; r2Key: string; fileName: string; contentType: string; sizeBytes: number; playerIds: number[]; playerVisible: boolean; keepAudio: boolean }): Promise<number> {
  await ensureAiWorkspaceReady();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query<{ id: number }>(`INSERT INTO ai_sessions
      (organization_id,title,session_type,source_kind,source_r2_key,source_file_name,source_content_type,source_size_bytes,player_visible,keep_audio,created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [input.organizationId,input.title,input.sessionType,input.sourceKind,input.r2Key,input.fileName,input.contentType,input.sizeBytes,input.playerVisible,input.keepAudio,input.userId]);
    const id = Number(created.rows[0].id);
    for (const playerId of [...new Set(input.playerIds)]) {
      await client.query(`INSERT INTO ai_session_players (session_id,player_id)
        SELECT $1,p.id FROM players p WHERE p.id=$2 AND p.organization_id=$3 ON CONFLICT DO NOTHING`, [id,playerId,input.organizationId]);
    }
    await client.query('COMMIT');
    return id;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function getAiSessionForOrganization(id: number, organizationId: number): Promise<(AiSessionRow & { sourceR2Key: string | null; sourceFileName: string; sourceContentType: string; audioR2Key: string | null; audioContentType: string }) | null> {
  await ensureAiWorkspaceReady();
  const result = await getDbPool().query<Record<string, unknown>>(`SELECT s.*,
    COALESCE(array_agg(p.id) FILTER (WHERE p.id IS NOT NULL), '{}') AS player_ids,
    COALESCE(array_agg(p.full_name ORDER BY p.full_name) FILTER (WHERE p.id IS NOT NULL), '{}') AS player_names
    FROM ai_sessions s LEFT JOIN ai_session_players sp ON sp.session_id=s.id LEFT JOIN players p ON p.id=sp.player_id
    WHERE s.id=$1 AND s.organization_id=$2 GROUP BY s.id`, [id,organizationId]);
  const row=result.rows[0];
  return row ? { ...mapSession(row), sourceR2Key: row.source_r2_key ? String(row.source_r2_key) : null,
    sourceFileName: String(row.source_file_name ?? 'recording'), sourceContentType: String(row.source_content_type ?? 'application/octet-stream'),
    audioR2Key: row.audio_r2_key ? String(row.audio_r2_key) : null, audioContentType: String(row.audio_content_type ?? 'audio/mp4') } : null;
}

export async function updateAiSessionResult(input: { id: number; organizationId: number; status: AiSessionStatus; transcript?: string; bullets?: string[]; audioR2Key?: string | null; audioContentType?: string | null; sourceR2Key?: string | null; error?: string | null }): Promise<void> {
  await ensureAiWorkspaceReady();
  await getDbPool().query(`UPDATE ai_sessions SET status=$3, transcript_text=COALESCE($4,transcript_text), summary_json=COALESCE($5::jsonb,summary_json),
    audio_r2_key=COALESCE($6,audio_r2_key), audio_content_type=COALESCE($7,audio_content_type), source_r2_key=$8,
    audio_expires_at=CASE WHEN $6 IS NOT NULL AND keep_audio=FALSE THEN NOW()+INTERVAL '30 days' ELSE audio_expires_at END,
    error_message=$9, updated_at=NOW() WHERE id=$1 AND organization_id=$2`,
    [input.id,input.organizationId,input.status,input.transcript ?? null,input.bullets ? JSON.stringify(input.bullets) : null,input.audioR2Key ?? null,input.audioContentType ?? null,input.sourceR2Key ?? null,input.error ?? null]);
}

export async function syncAiSessionPlayerNotes(id: number, organizationId: number): Promise<void> {
  await ensureAiWorkspaceReady();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM player_plan_notes AS note
       USING players AS player
       WHERE note.player_id = player.id
         AND player.organization_id = $1
         AND note.source_type = 'ai_session'
         AND note.source_id = $2`,
      [organizationId, String(id)]
    );
    const result = await client.query<{
      title: string;
      session_type: string;
      summary_json: unknown;
      transcript_text: string;
    }>(
      `SELECT title, session_type, summary_json, transcript_text
       FROM ai_sessions
       WHERE id = $1 AND organization_id = $2 AND status = 'ready' AND player_visible = TRUE`,
      [id, organizationId]
    );
    const session = result.rows[0];
    if (session) {
      const bullets = Array.isArray(session.summary_json) ? session.summary_json.map(String).filter(Boolean) : [];
      const sections = [
        `AI Session: ${session.title}`,
        `Session Type: ${session.session_type}`,
        bullets.length ? `Key Points:\n${bullets.map((bullet) => `• ${bullet}`).join('\n')}` : '',
        session.transcript_text.trim() ? `Full Transcript:\n${session.transcript_text.trim()}` : '',
      ].filter(Boolean);
      await client.query(
        `INSERT INTO player_plan_notes (
           player_id, domain, note_date, category, note_text, source_type, source_id,
           player_visible, created_by_user_id
         )
         SELECT player.id, 'General', ai.created_at::date, 'AI Session', $3,
                'ai_session', $4, TRUE, ai.created_by_user_id
         FROM ai_sessions AS ai
         JOIN ai_session_players AS linked ON linked.session_id = ai.id
         JOIN players AS player ON player.id = linked.player_id AND player.organization_id = ai.organization_id
         WHERE ai.id = $1 AND ai.organization_id = $2`,
        [id, organizationId, sections.join('\n\n'), String(id)]
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

export async function deleteAiSession(id: number, organizationId: number): Promise<string[]> {
  await ensureAiWorkspaceReady();
  const pool = getDbPool();
  await pool.query(`DELETE FROM player_plan_notes AS note USING players AS player WHERE note.player_id=player.id AND player.organization_id=$2 AND note.source_type='ai_session' AND note.source_id=$1`,[String(id),organizationId]);
  const result=await pool.query<{ source_r2_key:string|null; audio_r2_key:string|null }>(`DELETE FROM ai_sessions WHERE id=$1 AND organization_id=$2 RETURNING source_r2_key,audio_r2_key`,[id,organizationId]);
  return result.rows.flatMap((r)=>[r.source_r2_key,r.audio_r2_key]).filter((v):v is string=>Boolean(v));
}
export async function editAiSession(input:{id:number;organizationId:number;title:string;sessionType:string;summaryBullets:string[];transcriptText:string;playerVisible:boolean;keepAudio:boolean}):Promise<void>{await ensureAiWorkspaceReady();await getDbPool().query(`UPDATE ai_sessions SET title=$3,session_type=$4,summary_json=$5::jsonb,transcript_text=$6,player_visible=$7,keep_audio=$8,audio_expires_at=CASE WHEN $8 THEN NULL WHEN audio_r2_key IS NOT NULL THEN COALESCE(audio_expires_at,NOW()+INTERVAL '30 days') ELSE NULL END,updated_at=NOW() WHERE id=$1 AND organization_id=$2`,[input.id,input.organizationId,input.title,input.sessionType,JSON.stringify(input.summaryBullets),input.transcriptText,input.playerVisible,input.keepAudio]);await syncAiSessionPlayerNotes(input.id,input.organizationId);}

function mapFlagRule(row: Record<string, unknown>): FlagRuleRow {
  return { id:Number(row.id),name:String(row.name),domain:row.domain as 'pitching'|'hitting',metric:String(row.metric),pitchType:String(row.pitch_type),
    direction:row.direction as FlagRuleRow['direction'],threshold:Number(row.threshold),thresholdType:row.threshold_type as FlagRuleRow['thresholdType'],
    baselineDays:Number(row.baseline_days),minimumSample:Number(row.minimum_sample),targetPlayer:String(row.target_player),sessionType:String(row.session_type),
    notificationsEnabled:Boolean(row.notifications_enabled),cooldownHours:Number(row.cooldown_hours),enabled:Boolean(row.enabled),createdAt:String(row.created_at),createdByUserId:row.created_by_user_id?Number(row.created_by_user_id):null };
}

export async function listFlagRules(organizationId:number):Promise<FlagRuleRow[]> { await ensureAiWorkspaceReady(); const r=await getDbPool().query<Record<string,unknown>>(`SELECT * FROM metric_flag_rules WHERE organization_id=$1 ORDER BY created_at DESC`,[organizationId]);return r.rows.map(mapFlagRule); }
export async function saveFlagRule(input:Omit<FlagRuleRow,'id'|'createdAt'|'createdByUserId'> & {organizationId:number;userId:number;id?:number}):Promise<number> {
  await ensureAiWorkspaceReady(); const values=[input.organizationId,input.name,input.domain,input.metric,input.pitchType,input.direction,input.threshold,input.thresholdType,input.baselineDays,input.minimumSample,input.targetPlayer,input.sessionType,input.notificationsEnabled,input.cooldownHours,input.enabled,input.userId];
  if(input.id){const r=await getDbPool().query<{id:number}>(`UPDATE metric_flag_rules SET name=$2,domain=$3,metric=$4,pitch_type=$5,direction=$6,threshold=$7,threshold_type=$8,baseline_days=$9,minimum_sample=$10,target_player=$11,session_type=$12,notifications_enabled=$13,cooldown_hours=$14,enabled=$15,updated_at=NOW() WHERE organization_id=$1 AND id=$17 RETURNING id`,[...values,input.id]);return Number(r.rows[0]?.id||0);}
  const r=await getDbPool().query<{id:number}>(`INSERT INTO metric_flag_rules (organization_id,name,domain,metric,pitch_type,direction,threshold,threshold_type,baseline_days,minimum_sample,target_player,session_type,notifications_enabled,cooldown_hours,enabled,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,values);return Number(r.rows[0].id);
}
export async function deleteFlagRule(id:number,organizationId:number):Promise<void>{await ensureAiWorkspaceReady();await getDbPool().query(`DELETE FROM metric_flag_rules WHERE id=$1 AND organization_id=$2`,[id,organizationId]);}
export async function claimFlagNotification(ruleId:number,playerName:string,sessionDate:string):Promise<boolean>{await ensureAiWorkspaceReady();const r=await getDbPool().query(`INSERT INTO metric_flag_notifications (rule_id,player_name,session_date) VALUES ($1,$2,$3::date) ON CONFLICT DO NOTHING RETURNING rule_id`,[ruleId,playerName,sessionDate]);return (r.rowCount??0)>0;}

export async function listExpiredAiAudio():Promise<Array<{id:number;organizationId:number;r2Key:string}>>{await ensureAiWorkspaceReady();const r=await getDbPool().query<{id:number;organization_id:number;audio_r2_key:string}>(`SELECT id,organization_id,audio_r2_key FROM ai_sessions WHERE keep_audio=FALSE AND audio_r2_key IS NOT NULL AND audio_expires_at<=NOW() LIMIT 500`);return r.rows.map(x=>({id:Number(x.id),organizationId:Number(x.organization_id),r2Key:x.audio_r2_key}));}
export async function clearAiAudio(id:number,organizationId:number):Promise<void>{await getDbPool().query(`UPDATE ai_sessions SET audio_r2_key=NULL,audio_content_type=NULL,audio_expires_at=NULL,updated_at=NOW() WHERE id=$1 AND organization_id=$2`,[id,organizationId]);}

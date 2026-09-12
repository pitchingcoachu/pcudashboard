import { getDbPool } from './auth-db';

export type ReportAutomationDateMode = 'automation_day' | 'fixed' | 'rolling_days' | 'month_to_date' | 'previous_month_to_date' | 'previous_month';
export type ReportAutomationPanel = {
  id: string;
  title: string;
  requestUrl: string;
  dateMode: ReportAutomationDateMode;
  fixedStart: string;
  fixedEnd: string;
  rollingDays: number;
};

export type ReportAutomationRow = {
  id: number;
  organizationId: number;
  createdByUserId: number | null;
  reportKey: string;
  reportTitle: string;
  sourcePath: string;
  customReportId: number | null;
  profileCategory: string;
  cadence: 'daily' | 'weekly';
  weekdays: number[];
  localTime: string;
  timeZone: string;
  playerScope: 'all' | 'selected';
  playerIds: number[];
  reportPanels: ReportAutomationPanel[];
  onlyWhenData: boolean;
  includeAiSummary: boolean;
  notifyPlayers: boolean;
  active: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportAutomationRunRow = {
  id: number;
  automationId: number;
  playerId: number;
  reportDate: string;
  status: 'running' | 'saved' | 'skipped' | 'failed';
  detail: string;
  mediaId: number | null;
  createdAt: string;
  completedAt: string | null;
};

let ready = false;
let readyPromise: Promise<void> | null = null;

export async function ensureReportAutomationSchema(): Promise<void> {
  if (ready) return;
  if (readyPromise) return readyPromise;
  readyPromise = runReportAutomationSchemaMigration().finally(() => { readyPromise = null; });
  return readyPromise;
}

async function runReportAutomationSchemaMigration(): Promise<void> {
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_automations (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      report_key TEXT NOT NULL,
      report_title TEXT NOT NULL,
      source_path TEXT NOT NULL DEFAULT '',
      custom_report_id BIGINT,
      profile_category TEXT NOT NULL DEFAULT 'Reports',
      cadence TEXT NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily', 'weekly')),
      weekdays INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,0],
      local_time TIME NOT NULL DEFAULT '17:00',
      time_zone TEXT NOT NULL DEFAULT 'America/Phoenix',
      player_scope TEXT NOT NULL DEFAULT 'all' CHECK (player_scope IN ('all', 'selected')),
      player_ids BIGINT[] NOT NULL DEFAULT '{}',
      report_panels JSONB NOT NULL DEFAULT '[]'::jsonb,
      only_when_data BOOLEAN NOT NULL DEFAULT TRUE,
      include_ai_summary BOOLEAN NOT NULL DEFAULT FALSE,
      notify_players BOOLEAN NOT NULL DEFAULT TRUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_report_automations_due ON report_automations (is_active, local_time);
    CREATE INDEX IF NOT EXISTS idx_report_automations_org ON report_automations (organization_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS report_automation_runs (
      id BIGSERIAL PRIMARY KEY,
      automation_id BIGINT NOT NULL REFERENCES report_automations(id) ON DELETE CASCADE,
      player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      report_date DATE NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'saved', 'skipped', 'failed')),
      detail TEXT NOT NULL DEFAULT '',
      media_id BIGINT REFERENCES player_media(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      UNIQUE (automation_id, player_id, report_date)
    );
    CREATE INDEX IF NOT EXISTS idx_report_automation_runs_automation ON report_automation_runs (automation_id, created_at DESC);
    ALTER TABLE report_automations ADD COLUMN IF NOT EXISTS report_panels JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE report_automations ADD COLUMN IF NOT EXISTS include_ai_summary BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE report_automations ADD COLUMN IF NOT EXISTS custom_report_id BIGINT;
    ALTER TABLE report_automations ADD COLUMN IF NOT EXISTS profile_category TEXT NOT NULL DEFAULT 'Reports';
  `);
  ready = true;
}

function mapAutomation(row: Record<string, unknown>): ReportAutomationRow {
  const rawPanels = Array.isArray(row.report_panels) ? row.report_panels : [];
  const reportPanels = rawPanels.flatMap((value): ReportAutomationPanel[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const panel = value as Record<string, unknown>;
    const requestUrl = String(panel.requestUrl ?? '');
    if (!requestUrl.startsWith('/api/')) return [];
    const mode = String(panel.dateMode ?? 'automation_day');
    const dateMode: ReportAutomationDateMode = ['fixed','rolling_days','month_to_date','previous_month_to_date','previous_month'].includes(mode)
      ? mode as ReportAutomationDateMode
      : 'automation_day';
    return [{
      id:String(panel.id ?? '').slice(0,100), title:String(panel.title ?? 'Report panel').slice(0,180), requestUrl:requestUrl.slice(0,4000), dateMode,
      fixedStart:String(panel.fixedStart ?? '').slice(0,10), fixedEnd:String(panel.fixedEnd ?? '').slice(0,10),
      rollingDays:Math.max(1,Math.min(365,Number(panel.rollingDays) || 30)),
    }];
  }).slice(0, 36);
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), createdByUserId: row.created_by_user_id == null ? null : Number(row.created_by_user_id),
    reportKey: String(row.report_key), reportTitle: String(row.report_title), sourcePath: String(row.source_path ?? ''), customReportId: row.custom_report_id == null ? null : Number(row.custom_report_id), profileCategory:String(row.profile_category ?? 'Reports').trim() || 'Reports',
    cadence: row.cadence === 'weekly' ? 'weekly' : 'daily', weekdays: Array.isArray(row.weekdays) ? row.weekdays.map(Number) : [],
    localTime: String(row.local_time ?? '17:00').slice(0, 5), timeZone: String(row.time_zone),
    playerScope: row.player_scope === 'selected' ? 'selected' : 'all', playerIds: Array.isArray(row.player_ids) ? row.player_ids.map(Number) : [], reportPanels,
    onlyWhenData: Boolean(row.only_when_data), includeAiSummary: Boolean(row.include_ai_summary), notifyPlayers: Boolean(row.notify_players), active: Boolean(row.is_active),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export async function listReportAutomations(organizationId: number): Promise<ReportAutomationRow[]> {
  await ensureReportAutomationSchema();
  const result = await getDbPool().query(`SELECT * FROM report_automations WHERE organization_id=$1 ORDER BY is_active DESC, updated_at DESC`, [organizationId]);
  return result.rows.map(mapAutomation);
}

export async function saveReportAutomation(input: Omit<ReportAutomationRow, 'id' | 'lastRunAt' | 'createdAt' | 'updatedAt'> & { id?: number }): Promise<ReportAutomationRow> {
  await ensureReportAutomationSchema();
  const values = [input.organizationId, input.createdByUserId, input.reportKey, input.reportTitle, input.sourcePath, input.customReportId, input.profileCategory, input.cadence, input.weekdays, input.localTime, input.timeZone, input.playerScope, input.playerIds, JSON.stringify(input.reportPanels), input.onlyWhenData, input.includeAiSummary, input.notifyPlayers, input.active];
  const result = input.id
    ? await getDbPool().query(`UPDATE report_automations SET created_by_user_id=COALESCE(created_by_user_id,$2::bigint),report_key=$3,report_title=$4,source_path=$5,custom_report_id=$6,profile_category=$7,cadence=$8,weekdays=$9,local_time=$10,time_zone=$11,player_scope=$12,player_ids=$13,report_panels=$14::jsonb,only_when_data=$15,include_ai_summary=$16,notify_players=$17,is_active=$18,updated_at=NOW() WHERE id=$19 AND organization_id=$1 RETURNING *`, [...values, input.id])
    : await getDbPool().query(`INSERT INTO report_automations (organization_id,created_by_user_id,report_key,report_title,source_path,custom_report_id,profile_category,cadence,weekdays,local_time,time_zone,player_scope,player_ids,report_panels,only_when_data,include_ai_summary,notify_players,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18) RETURNING *`, values);
  if (!result.rows[0]) throw new Error('Automation was not found.');
  return mapAutomation(result.rows[0]);
}

export async function deleteReportAutomation(organizationId: number, id: number): Promise<boolean> {
  await ensureReportAutomationSchema();
  const result = await getDbPool().query(`DELETE FROM report_automations WHERE id=$1 AND organization_id=$2`, [id, organizationId]);
  return Boolean(result.rowCount);
}

export async function listDueReportAutomations(now: Date): Promise<ReportAutomationRow[]> {
  await ensureReportAutomationSchema();
  const rows = await getDbPool().query(`SELECT * FROM report_automations WHERE is_active=TRUE`);
  return rows.rows.map(mapAutomation).filter((automation) => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: automation.timeZone, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(now);
      const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
      const localTime = `${value('hour') === '24' ? '00' : value('hour')}:${value('minute')}`;
      const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(value('weekday'));
      const [hour, minute] = localTime.split(':').map(Number);
      const [targetHour, targetMinute] = automation.localTime.split(':').map(Number);
      const minutesAfterTarget = hour * 60 + minute - (targetHour * 60 + targetMinute);
      return minutesAfterTarget >= 0 && minutesAfterTarget < 15 && (automation.cadence === 'daily' || automation.weekdays.includes(weekday));
    } catch { return false; }
  });
}

export async function claimAutomationRun(automationId: number, playerId: number, reportDate: string, force=false): Promise<number | null> {
  await ensureReportAutomationSchema();
  const result = await getDbPool().query(`
    INSERT INTO report_automation_runs (automation_id,player_id,report_date,status)
    VALUES ($1,$2,$3,'running')
    ON CONFLICT (automation_id,player_id,report_date) DO UPDATE
      SET status='running', detail='', completed_at=NULL, created_at=NOW()
      WHERE ($4::boolean AND report_automation_runs.status <> 'running')
         OR (report_automation_runs.status IN ('failed','skipped')
             AND report_automation_runs.completed_at < NOW() - INTERVAL '4 minutes')
    RETURNING id
  `, [automationId, playerId, reportDate, force]);
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

export async function finishAutomationRun(runId: number, status: 'saved' | 'skipped' | 'failed', detail: string, mediaId?: number | null): Promise<void> {
  await getDbPool().query(`UPDATE report_automation_runs SET status=$2,detail=$3,media_id=$4,completed_at=NOW() WHERE id=$1`, [runId, status, detail.slice(0, 1000), mediaId ?? null]);
}

export async function listAutomationRuns(organizationId: number, automationId?: number): Promise<ReportAutomationRunRow[]> {
  await ensureReportAutomationSchema();
  const result = await getDbPool().query(`SELECT r.* FROM report_automation_runs r JOIN report_automations a ON a.id=r.automation_id WHERE a.organization_id=$1 AND ($2::bigint IS NULL OR a.id=$2) ORDER BY r.created_at DESC LIMIT 150`, [organizationId, automationId ?? null]);
  return result.rows.map((row) => ({ id:Number(row.id), automationId:Number(row.automation_id), playerId:Number(row.player_id), reportDate:String(row.report_date).slice(0,10), status:row.status, detail:String(row.detail??''), mediaId:row.media_id==null?null:Number(row.media_id), createdAt:String(row.created_at), completedAt:row.completed_at?String(row.completed_at):null }));
}

import { ensureAuthDbReady, getDbPool, isDatabaseConfigured } from './auth-db';

export type AutomationRollupPayload = {
  generated_at: string;
  generated_goals: Array<{
    category: 'Stuff' | 'Execution';
    executionStat: string;
    comparator: 'Greater Than' | 'Less Than';
    targetValue: number;
    objectiveText: string;
    batterSide?: 'Left' | 'Right';
    pitchTypes?: string[];
    countOptions?: string[];
  }>;
  debug?: Record<string, unknown>;
};

async function ensureAutomationRollupTable(): Promise<void> {
  await ensureAuthDbReady();
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_plan_automation_rollups (
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      school_code TEXT NOT NULL,
      percentile_source TEXT NOT NULL,
      season_year INTEGER NOT NULL,
      payload_json JSONB NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, player_id, school_code, percentile_source, season_year)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_plan_automation_rollups_lookup
    ON player_plan_automation_rollups (organization_id, school_code, percentile_source, season_year, generated_at DESC);
  `);
}

export async function getAutomationRollup(input: {
  organizationId: number;
  playerId: number;
  schoolCode: string;
  percentileSource: 'NCAA' | 'MLB';
  seasonYear: number;
}): Promise<{ payload: AutomationRollupPayload; generatedAt: string } | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureAutomationRollupTable();
  const pool = getDbPool();
  const result = await pool.query<{ payload_json: AutomationRollupPayload; generated_at: string }>(
    `
      SELECT payload_json, generated_at::text
      FROM player_plan_automation_rollups
      WHERE organization_id = $1
        AND player_id = $2
        AND school_code = $3
        AND percentile_source = $4
        AND season_year = $5
      LIMIT 1
    `,
    [input.organizationId, input.playerId, input.schoolCode, input.percentileSource, input.seasonYear]
  );
  if ((result.rowCount ?? 0) < 1) return null;
  return { payload: result.rows[0].payload_json, generatedAt: result.rows[0].generated_at };
}

export async function upsertAutomationRollup(input: {
  organizationId: number;
  playerId: number;
  schoolCode: string;
  percentileSource: 'NCAA' | 'MLB';
  seasonYear: number;
  payload: AutomationRollupPayload;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await ensureAutomationRollupTable();
  const pool = getDbPool();
  await pool.query(
    `
      INSERT INTO player_plan_automation_rollups (
        organization_id,
        player_id,
        school_code,
        percentile_source,
        season_year,
        payload_json,
        generated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
      ON CONFLICT (organization_id, player_id, school_code, percentile_source, season_year)
      DO UPDATE SET
        payload_json = EXCLUDED.payload_json,
        generated_at = NOW()
    `,
    [
      input.organizationId,
      input.playerId,
      input.schoolCode,
      input.percentileSource,
      input.seasonYear,
      JSON.stringify(input.payload),
    ]
  );
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveSchoolScopedOrganizationId } from '../../../../../lib/programming-scope';
import { ensureAuthDbReady, getDbPool } from '../../../../../lib/auth-db';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { clearPlayerPlanGoalsForPlayer, getPlayerByIdInOrganization, listPlayerPlanGoalsForPlayer, upsertPlayerPlanGoal } from '../../../../../lib/training-db';
import { getAutomationRollup } from '../../../../../lib/player-plan-automation-rollup';

type GoalDraft = {
  category: 'Stuff' | 'Execution';
  executionStat: string;
  comparator: 'Greater Than' | 'Less Than';
  targetValue: number;
  objectiveText: string;
  batterSide?: 'Left' | 'Right';
  pitchTypes?: string[];
  countOptions?: string[];
};
const AUTOMATION_RULES_VERSION = 'fixed-thresholds-v4';

function normalizeSchoolCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function parseOrgSchoolMap(raw: string): Record<number, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<number, string> = {};
    for (const [orgIdRaw, schoolRaw] of Object.entries(parsed)) {
      const orgId = Number(orgIdRaw);
      const school = normalizeSchoolCode(typeof schoolRaw === 'string' ? schoolRaw : '');
      if (!Number.isFinite(orgId) || orgId <= 0 || !school) continue;
      out[orgId] = school;
    }
    return out;
  } catch {
    return {};
  }
}

async function resolveAutomationPlayer(input: {
  organizationId: number;
  playerId: number;
  dashboardPlayerName: string;
}): Promise<{ id: number; fullName: string } | null> {
  const dashboardName = String(input.dashboardPlayerName ?? '').trim();
  if (input.playerId > 0) {
    const player = await getPlayerByIdInOrganization({ organizationId: input.organizationId, playerId: input.playerId });
    if (player) return { id: player.id, fullName: player.fullName };
  }
  if (!dashboardName) return null;
  await ensureAuthDbReady();
  const pool = getDbPool();
  const existing = await pool.query<{ id: number; full_name: string }>(
    `SELECT id, full_name FROM players WHERE organization_id = $1 AND lower(full_name) = lower($2) ORDER BY id DESC LIMIT 1`,
    [input.organizationId, dashboardName]
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, fullName: existing.rows[0].full_name };
  const emailSlug = dashboardName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 48) || 'player';
  const syntheticEmail = `${emailSlug}.${Date.now()}@autolink.local`;
  const inserted = await pool.query<{ id: number; full_name: string }>(
    `INSERT INTO players (organization_id, user_id, full_name, email, status) VALUES ($1, NULL, $2, $3, 'active') RETURNING id, full_name`,
    [input.organizationId, dashboardName, syntheticEmail]
  );
  return inserted.rows[0] ? { id: inserted.rows[0].id, fullName: inserted.rows[0].full_name } : null;
}

type GoalPayload = {
  schema: 'pcu_goal_v2';
  category: 'Stuff' | 'Execution';
  objectiveText?: string;
  executionStat?: string;
  comparator?: 'Greater Than' | 'Less Than';
  targetValue?: number | null;
  chartType?: 'Trend';
  heatmapView?: 'Frequency';
  filters?: {
    batterSide?: string;
    pitchTypes?: string[];
    countOptions?: string[];
  };
};

function serializeGoal(goal: GoalDraft): string {
  const payload: GoalPayload = {
    schema: 'pcu_goal_v2',
    category: goal.category,
    objectiveText: goal.objectiveText,
    executionStat: goal.executionStat,
    comparator: goal.comparator,
    targetValue: Number.isFinite(goal.targetValue) ? Number(goal.targetValue.toFixed(1)) : null,
    chartType: 'Trend',
    heatmapView: 'Frequency',
    filters: {
      batterSide: goal.batterSide ?? 'All',
      pitchTypes: goal.pitchTypes?.length ? goal.pitchTypes : ['All'],
      countOptions: goal.countOptions?.length ? goal.countOptions : ['All'],
    },
  };
  return JSON.stringify(payload);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (String(session.role ?? '').toLowerCase() === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    playerId?: number;
    dashboardPlayerName?: string;
    percentileSource?: 'NCAA' | 'MLB';
    clearExisting?: boolean;
  };

  const playerId = Number(body.playerId ?? 0);
  const percentileSource: 'NCAA' | 'MLB' = body.percentileSource === 'MLB' ? 'MLB' : 'NCAA';
  const mappedOrganizationId = resolveSchoolScopedOrganizationId(session);
  const organizationId = Number(mappedOrganizationId) > 0 ? Number(mappedOrganizationId) : 0;
  if (!organizationId) return NextResponse.json({ error: 'No organization is available for the current site/session.' }, { status: 400 });

  const player = await resolveAutomationPlayer({
    organizationId,
    playerId,
    dashboardPlayerName: String(body.dashboardPlayerName ?? '').trim(),
  });
  if (!player) return NextResponse.json({ error: 'Select a player first.' }, { status: 400 });

  const schoolCode = resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role === 'coach' ? 'coach' : 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  });
  const mappedSchoolCode = parseOrgSchoolMap(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}')[organizationId] ?? '';
  if (mappedSchoolCode && schoolCode && mappedSchoolCode !== schoolCode) {
    return NextResponse.json(
      { error: `Safety stop: selected school ${schoolCode} does not match resolved org mapping ${mappedSchoolCode}.` },
      { status: 409 }
    );
  }
  const seasonYear = new Date().getUTCFullYear();

  const rollup = await getAutomationRollup({
    organizationId,
    playerId: player.id,
    schoolCode,
    percentileSource,
    seasonYear,
  });
  if (!rollup || !Array.isArray(rollup.payload.generated_goals) || !rollup.payload.generated_goals.length) {
    return NextResponse.json({ error: 'No automation cache found. Click Refresh Automated Cache first.' }, { status: 400 });
  }
  const rollupDebug = (rollup.payload as { debug?: { rulesVersion?: string } }).debug;
  if (!rollupDebug || rollupDebug.rulesVersion !== AUTOMATION_RULES_VERSION) {
    return NextResponse.json(
      { error: 'Automation cache is out of date. Click Refresh Automated Cache, then Create Automated Plan.' },
      { status: 409 }
    );
  }

  const goals = rollup.payload.generated_goals.slice(0, 3);
  if (Boolean(body.clearExisting)) {
    const clear = await clearPlayerPlanGoalsForPlayer({
      organizationId,
      playerId: player.id,
    });
    if (!clear.ok) return NextResponse.json({ error: clear.error }, { status: 400 });
  }
  for (let i = 0; i < goals.length; i += 1) {
    const slotIndex = (i + 1) as 1 | 2 | 3;
    const goal = goals[i];
    const result = await upsertPlayerPlanGoal({
      organizationId,
      playerId: player.id,
      slotIndex,
      category: goal.category,
      goalDescription: serializeGoal(goal),
      createdByUserId: session.userId ?? 0,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const keepSlots = goals.map((_, idx) => idx + 1);
  const trim = await clearPlayerPlanGoalsForPlayer({
    organizationId,
    playerId: player.id,
    keepSlotIndexes: keepSlots,
  });
  if (!trim.ok) return NextResponse.json({ error: trim.error }, { status: 400 });

  const data = await listPlayerPlanGoalsForPlayer({ playerId: player.id });
  return NextResponse.json({ ok: true, generated: goals.length, cachedAt: rollup.generatedAt, playerId: player.id, ...data });
}

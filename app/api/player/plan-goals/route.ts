import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveSchoolScopedOrganizationId } from '../../../../lib/programming-scope';
import { canManagePlayer } from '../../../../lib/portal-access';
import {
  deletePlayerPlanGoal,
  completePlayerPlanGoal,
  createPlayerPlanNote,
  getPlayerByIdInOrganization,
  getPlayerForUser,
  listPlayerPlanGoalsForPlayer,
  upsertPlayerPlanGoal,
} from '../../../../lib/training-db';

type GoalPayload = {
  schema?: string;
  category?: string;
  objectiveText?: string;
  executionStat?: string;
  comparator?: 'Greater Than' | 'Less Than';
  targetValue?: number | null;
  filters?: {
    batterSide?: string;
    pitchTypes?: string[];
    countOptions?: string[];
  };
};

function formatCompletedGoalNote(goal: { slotIndex: number; category: string; goalDescription: string; completionDetails: string; completedBy: string }): string {
  const lines: string[] = [];
  lines.push(`Completed Goal ${goal.slotIndex}`);
  lines.push(`Completed By: ${goal.completedBy || 'Unknown'}`);
  lines.push(`Category: ${goal.category}`);

  let parsed: GoalPayload | null = null;
  try {
    parsed = JSON.parse(goal.goalDescription) as GoalPayload;
  } catch {
    parsed = null;
  }

  if (parsed) {
    if (parsed.executionStat) lines.push(`Stat: ${parsed.executionStat}`);
    if (parsed.comparator) lines.push(`Comparator: ${parsed.comparator}`);
    if (typeof parsed.targetValue === 'number' && Number.isFinite(parsed.targetValue)) lines.push(`Target: ${parsed.targetValue}`);
    if (parsed.filters?.batterSide) lines.push(`Batter Side: ${parsed.filters.batterSide}`);
    const pitchTypes = (parsed.filters?.pitchTypes ?? []).filter(Boolean);
    if (pitchTypes.length) lines.push(`Pitch Types: ${pitchTypes.join(', ')}`);
    const countOptions = (parsed.filters?.countOptions ?? []).filter(Boolean);
    if (countOptions.length) lines.push(`Counts: ${countOptions.join(', ')}`);
    const objective = String(parsed.objectiveText ?? '').trim();
    if (objective) lines.push(`Objective: ${objective}`);
  } else {
    lines.push(`Goal: ${goal.goalDescription}`);
  }

  const completion = goal.completionDetails.trim();
  if (completion) lines.push(`Completion Notes: ${completion}`);
  return lines.join('\n');
}

function resolvePlanGoalsOrganizationId(
  session: { organizationId?: number; role?: string; userId?: number; playerId?: number | null } | null
): number {
  if (!session) return 0;
  const mapped = Number(resolveSchoolScopedOrganizationId(session));
  if (Number.isFinite(mapped) && mapped > 0) return mapped;
  return 0;
}

async function resolveAllowedPlayerId(
  session: { role?: string; organizationId?: number; userId?: number; playerId?: number | null } | null,
  requestedPlayerId: number
) {
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const organizationId = resolvePlanGoalsOrganizationId(session);
  if (!organizationId) return { ok: false as const, status: 400, error: 'No organization is available for this session.' };

  if (session.role === 'player') {
    const ownPlayer = await getPlayerForUser({
      organizationId,
      userId: session.userId ?? 0,
    });
    const allowed = ownPlayer?.id ?? session.playerId ?? 0;
    if (allowed !== requestedPlayerId) return { ok: false as const, status: 403, error: 'Forbidden' };
    return { ok: true as const, playerId: allowed };
  }

  const allowed = await canManagePlayer(
    session as { role?: 'admin' | 'coach' | 'player'; organizationId?: number; userId?: number; playerId?: number | null },
    requestedPlayerId
  );
  const player = await getPlayerByIdInOrganization({
    organizationId,
    playerId: requestedPlayerId,
  });
  // Admins should be able to access any player row in the currently-resolved org,
  // even when legacy session.organizationId differs from mapped programming org.
  if (!allowed && session.role !== 'admin') return { ok: false as const, status: 403, error: 'Forbidden' };
  if (!player) return { ok: false as const, status: 404, error: 'Player not found.' };
  return { ok: true as const, playerId: player.id };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await resolveAllowedPlayerId(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const data = await listPlayerPlanGoalsForPlayer({ playerId: allowed.playerId });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? 0);
  const slotIndex = Number(body.slotIndex ?? 0);
  const category = String(body.category ?? '');
  const goalDescription = String(body.goalDescription ?? '');

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await resolveAllowedPlayerId(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const result = await upsertPlayerPlanGoal({
    organizationId: resolvePlanGoalsOrganizationId(session),
    playerId: allowed.playerId,
    slotIndex,
    category,
    goalDescription,
    createdByUserId: session.userId ?? 0,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const data = await listPlayerPlanGoalsForPlayer({ playerId: allowed.playerId });
  return NextResponse.json({ ok: true, ...data });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? 0);
  const slotIndex = Number(body.slotIndex ?? 0);
  const completionDetails = String(body.completionDetails ?? '');
  const domainRaw = String(body.domain ?? '');
  const domain = domainRaw === 'Pitching' || domainRaw === 'Hitting' || domainRaw === 'Catching' || domainRaw === 'General' ? domainRaw : 'General';

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await resolveAllowedPlayerId(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const before = await listPlayerPlanGoalsForPlayer({ playerId: allowed.playerId, completedLimit: 1 });
  const goalToComplete = before.activeGoals.find((goal) => goal.slotIndex === slotIndex);

  const result = await completePlayerPlanGoal({
    organizationId: resolvePlanGoalsOrganizationId(session),
    playerId: allowed.playerId,
    slotIndex,
    completionDetails,
    completedByUserId: session.userId ?? 0,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  if (goalToComplete?.category && goalToComplete.goalDescription) {
    const noteDate = new Date().toISOString().slice(0, 10);
    const noteBody = formatCompletedGoalNote({
      slotIndex,
      category: goalToComplete.category,
      goalDescription: goalToComplete.goalDescription,
      completionDetails,
      completedBy: 'Goal Completion Automation',
    });
    await createPlayerPlanNote({
      organizationId: resolvePlanGoalsOrganizationId(session),
      playerId: allowed.playerId,
      domain,
      noteDate,
      category: 'Player Plan',
      noteText: noteBody,
      createdByUserId: session.userId ?? 0,
    });
  }

  const data = await listPlayerPlanGoalsForPlayer({ playerId: allowed.playerId });
  return NextResponse.json({ ok: true, ...data });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? 0);
  const slotIndex = Number(body.slotIndex ?? 0);

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await resolveAllowedPlayerId(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const result = await deletePlayerPlanGoal({
    organizationId: resolvePlanGoalsOrganizationId(session),
    playerId: allowed.playerId,
    slotIndex,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const data = await listPlayerPlanGoalsForPlayer({ playerId: allowed.playerId });
  return NextResponse.json({ ok: true, ...data });
}

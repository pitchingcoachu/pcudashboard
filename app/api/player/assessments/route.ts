import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../../lib/player-content-scope';
import {
  getPlayerAssessmentById,
  getPlayerByIdInOrganization,
  listPlayerAssessments,
  listPlayerPlanNotesForPlayer,
  saveOrUpdatePlayerAssessment,
} from '../../../../lib/training-db';

async function requireStaffSession(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if (session.role === 'player') return { ok: false as const, status: 403, error: 'Only coaches and admins can record assessments.' };
  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (organizationId <= 0) return { ok: false as const, status: 403, error: 'Programming data is not available for this school.' };
  return { ok: true as const, session, organizationId };
}

export async function GET(request: Request) {
  const scope = await requireStaffSession(request);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const assessmentId = Number(url.searchParams.get('assessmentId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });

  const player = await getPlayerByIdInOrganization({ organizationId: scope.organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  if (Number.isFinite(assessmentId) && assessmentId > 0) {
    const assessment = await getPlayerAssessmentById({ organizationId: scope.organizationId, playerId, assessmentId });
    if (!assessment) return NextResponse.json({ error: 'Assessment not found.' }, { status: 404 });
    return NextResponse.json({ assessment });
  }

  const assessments = await listPlayerAssessments({ organizationId: scope.organizationId, playerId });
  return NextResponse.json({ assessments });
}

export async function POST(request: Request) {
  const scope = await requireStaffSession(request);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? 0);
  const assessmentDate = String(body.assessmentDate ?? '');
  const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? (body.answers as Record<string, unknown>) : {};

  if (!Number.isFinite(playerId) || playerId <= 0) return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  const player = await getPlayerByIdInOrganization({ organizationId: scope.organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const saved = await saveOrUpdatePlayerAssessment({
    organizationId: scope.organizationId,
    playerId,
    assessmentDate,
    answers,
    createdByUserId: scope.session.userId ?? null,
  });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });

  const notes = await listPlayerPlanNotesForPlayer({ organizationId: scope.organizationId, playerId });
  return NextResponse.json({ ok: true, assessmentId: saved.id, notes });
}

export async function PATCH(request: Request) {
  const scope = await requireStaffSession(request);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? 0);
  const assessmentId = Number(body.assessmentId ?? 0);
  const assessmentDate = String(body.assessmentDate ?? '');
  const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? (body.answers as Record<string, unknown>) : {};

  if (!Number.isFinite(playerId) || playerId <= 0) return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  if (!Number.isFinite(assessmentId) || assessmentId <= 0) return NextResponse.json({ error: 'Valid assessmentId is required.' }, { status: 400 });
  const player = await getPlayerByIdInOrganization({ organizationId: scope.organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const saved = await saveOrUpdatePlayerAssessment({
    organizationId: scope.organizationId,
    playerId,
    assessmentDate,
    answers,
    createdByUserId: scope.session.userId ?? null,
    assessmentId,
  });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });

  const notes = await listPlayerPlanNotesForPlayer({ organizationId: scope.organizationId, playerId });
  return NextResponse.json({ ok: true, assessmentId: saved.id, notes });
}

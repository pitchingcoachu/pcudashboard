import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionFromRequest } from '../../../../lib/auth';
import { canManagePlayer } from '../../../../lib/portal-access';
import { readActivityRequestMeta } from '../../../../lib/portal-activity';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import {
  getPlayerForUser,
  listPendingQuestionnairesForPlayer,
  recordPortalActivityEvent,
  saveQuestionnaireResponse,
} from '../../../../lib/training-db';

async function resolvePlayerId(session: NonNullable<ReturnType<typeof getSessionFromRequest>>, requestedPlayerId: number | null) {
  const organizationId = resolveProgrammingOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) return 0;
  if (session.role === 'player') {
    const ownPlayer = await getPlayerForUser({
      organizationId,
      userId: session.userId ?? 0,
    });
    return ownPlayer?.id ?? session.playerId ?? 0;
  }
  const playerId = requestedPlayerId ?? 0;
  if (!Number.isFinite(playerId) || playerId <= 0) return 0;
  const allowed = await canManagePlayer(session, playerId);
  return allowed ? playerId : 0;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const organizationId = resolveProgrammingOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) return NextResponse.json({ pending: [] });

  const url = new URL(request.url);
  const requestedPlayerId = Number(url.searchParams.get('playerId') ?? '0');
  const playerId = await resolvePlayerId(session, Number.isFinite(requestedPlayerId) && requestedPlayerId > 0 ? requestedPlayerId : null);
  if (!playerId) return NextResponse.json({ pending: [] });

  const pending = await listPendingQuestionnairesForPlayer({ organizationId, playerId });
  return NextResponse.json({ pending });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const organizationId = resolveProgrammingOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'Programming data is not available.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const requestedPlayerId = Number((body as { playerId?: unknown }).playerId ?? 0);
  const playerId = await resolvePlayerId(session, Number.isFinite(requestedPlayerId) && requestedPlayerId > 0 ? requestedPlayerId : null);
  if (!playerId) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const assignmentId = Number((body as { assignmentId?: unknown }).assignmentId ?? 0);
  const questionnaireId = Number((body as { questionnaireId?: unknown }).questionnaireId ?? 0);
  const dueDate = String((body as { dueDate?: unknown }).dueDate ?? '');
  const answersRaw = (body as { answers?: unknown }).answers;
  const answers = answersRaw && typeof answersRaw === 'object' && !Array.isArray(answersRaw) ? (answersRaw as Record<string, string>) : {};

  if (!Number.isFinite(assignmentId) || assignmentId <= 0 || !Number.isFinite(questionnaireId) || questionnaireId <= 0) {
    return NextResponse.json({ error: 'Invalid questionnaire.' }, { status: 400 });
  }

  const result = await saveQuestionnaireResponse({
    organizationId,
    playerId,
    assignmentId,
    questionnaireId,
    dueDate,
    answers,
    submittedByUserId: session.userId ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const { userAgent, ipAddress } = await readActivityRequestMeta(request);
  void recordPortalActivityEvent({
    userId: session.userId ?? null,
    email: session.email,
    name: session.name ?? null,
    role: session.role ?? 'admin',
    organizationId,
    playerId,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    eventType: 'questionnaire_completed',
    path: '/portal/player',
    metadata: { assignmentId, questionnaireId, dueDate },
    userAgent,
    ipAddress,
  }).catch(() => {});

  const pending = await listPendingQuestionnairesForPlayer({ organizationId, playerId });
  return NextResponse.json({ ok: true, pending });
}

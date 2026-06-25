import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import {
  createQuestionnaire,
  listPlayerChoicesByOrganization,
  listQuestionnaireResponses,
  listQuestionnairesForOrganization,
} from '../../../../lib/training-db';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = resolveProgrammingOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ questionnaires: [], responses: [] });
  }

  const url = new URL(request.url);
  const questionnaireId = Number(url.searchParams.get('questionnaireId') ?? '0');
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const groupName = String(url.searchParams.get('groupName') ?? '').trim();

  const [questionnaires, responses] = await Promise.all([
    listQuestionnairesForOrganization(organizationId),
    listQuestionnaireResponses({
      organizationId,
      questionnaireId: Number.isFinite(questionnaireId) && questionnaireId > 0 ? questionnaireId : null,
      playerId: Number.isFinite(playerId) && playerId > 0 ? playerId : null,
      groupName,
    }),
  ]);

  return NextResponse.json({ questionnaires, responses });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = resolveProgrammingOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'Programming data is not available for this school.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const assignments = Array.isArray((body as { assignments?: unknown }).assignments)
    ? ((body as { assignments: Array<Record<string, unknown>> }).assignments ?? [])
    : [];
  const allowedPlayers = await listPlayerChoicesByOrganization({
    organizationId,
    assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
    activeOnly: true,
  });
  const allowedPlayerIds = new Set(allowedPlayers.map((player) => player.playerId));
  const sanitizedAssignments = assignments.map((assignment) => ({
    ...assignment,
    playerIds: Array.isArray(assignment.playerIds)
      ? assignment.playerIds.map((id) => Number(id)).filter((id) => allowedPlayerIds.has(id))
      : [],
  }));

  const result = await createQuestionnaire({
    organizationId,
    userId: session.userId ?? null,
    name: String((body as { name?: unknown }).name ?? ''),
    questions: (body as { questions?: unknown }).questions,
    assignments: sanitizedAssignments,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const [questionnaires, responses] = await Promise.all([
    listQuestionnairesForOrganization(organizationId),
    listQuestionnaireResponses({ organizationId }),
  ]);
  return NextResponse.json({ ok: true, id: result.id, questionnaires, responses });
}

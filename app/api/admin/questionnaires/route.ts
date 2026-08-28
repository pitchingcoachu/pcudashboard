import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../../lib/player-content-scope';
import {
  createQuestionnaire,
  deleteQuestionnaire,
  listPlayerChoicesByOrganization,
  listQuestionnaireResponses,
  listQuestionnairesForOrganization,
  updateQuestionnaire,
  upsertPlayerGroupByName,
} from '../../../../lib/training-db';

// A questionnaire assignment's typed "Group Name" plus whichever players are
// checked becomes a real, reusable Player Group on every save -- best-effort
// only, never allowed to fail the actual questionnaire save.
async function syncPlayerGroupsFromAssignments(input: {
  assignments: QuestionnaireAssignmentInput[];
  organizationId: number;
  userId: number | null;
}): Promise<void> {
  if (!input.userId) return;
  for (const assignment of input.assignments) {
    const groupName = String(assignment.groupName ?? '').trim();
    const playerIds = Array.isArray(assignment.playerIds) ? (assignment.playerIds as number[]) : [];
    if (!groupName || playerIds.length === 0) continue;
    await upsertPlayerGroupByName({
      organizationId: input.organizationId,
      name: groupName,
      playerIds,
      createdByUserId: input.userId,
    }).catch(() => null);
  }
}

type QuestionnaireAssignmentInput = Record<string, unknown> & {
  id?: unknown;
  playerIds?: unknown;
};

async function sanitizeAssignments(input: {
  assignments: QuestionnaireAssignmentInput[];
  organizationId: number;
  coachUserId: number | null;
  preservedPlayerIds?: number[];
}) {
  const allowedPlayers = await listPlayerChoicesByOrganization({
    organizationId: input.organizationId,
    assignedCoachUserId: input.coachUserId,
    activeOnly: true,
  });
  const allowedPlayerIds = new Set(allowedPlayers.map((player) => player.playerId));
  for (const playerId of input.preservedPlayerIds ?? []) allowedPlayerIds.add(playerId);
  return input.assignments.map((assignment) => ({
    ...assignment,
    id: Number(assignment.id),
    playerIds: Array.isArray(assignment.playerIds)
      ? assignment.playerIds.map((id) => Number(id)).filter((id) => allowedPlayerIds.has(id))
      : [],
  }));
}

function canManageQuestionnaire(input: {
  role?: string;
}) {
  return input.role === 'admin' || input.role === 'coach';
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolvePlayerContentOrganizationId(session);
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

  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'Programming data is not available for this school.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const assignments: QuestionnaireAssignmentInput[] = Array.isArray((body as { assignments?: unknown }).assignments)
    ? ((body as { assignments: Array<Record<string, unknown>> }).assignments ?? [])
    : [];
  const sanitizedAssignments = await sanitizeAssignments({
    assignments,
    organizationId,
    coachUserId: null,
  });

  const result = await createQuestionnaire({
    organizationId,
    userId: session.userId ?? null,
    name: String((body as { name?: unknown }).name ?? ''),
    questions: (body as { questions?: unknown }).questions,
    assignments: sanitizedAssignments,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  await syncPlayerGroupsFromAssignments({ assignments: sanitizedAssignments, organizationId, userId: session.userId ?? null });

  const [questionnaires, responses] = await Promise.all([
    listQuestionnairesForOrganization(organizationId),
    listQuestionnaireResponses({ organizationId }),
  ]);
  return NextResponse.json({ ok: true, id: result.id, questionnaires, responses });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'Programming data is not available for this school.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const questionnaireId = Number((body as { questionnaireId?: unknown }).questionnaireId);
  const currentQuestionnaires = await listQuestionnairesForOrganization(organizationId);
  const current = currentQuestionnaires.find((questionnaire) => questionnaire.id === questionnaireId);
  if (!current) return NextResponse.json({ error: 'Questionnaire was not found.' }, { status: 404 });
  if (
    !canManageQuestionnaire({
      role: session.role,
    })
  ) {
    return NextResponse.json({ error: 'You do not have permission to edit questionnaires.' }, { status: 403 });
  }

  const assignments: QuestionnaireAssignmentInput[] = Array.isArray((body as { assignments?: unknown }).assignments)
    ? ((body as { assignments: Array<Record<string, unknown>> }).assignments ?? [])
    : [];
  const sanitizedAssignments = await sanitizeAssignments({
    assignments,
    organizationId,
    coachUserId: null,
    preservedPlayerIds: current.assignments.flatMap((assignment) => assignment.playerIds),
  });
  const result = await updateQuestionnaire({
    questionnaireId,
    organizationId,
    userId: session.userId ?? null,
    name: String((body as { name?: unknown }).name ?? ''),
    questions: (body as { questions?: unknown }).questions,
    assignments: sanitizedAssignments,
  });
  if (!result.ok) {
    const status = result.error === 'Questionnaire was not found.' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  await syncPlayerGroupsFromAssignments({ assignments: sanitizedAssignments, organizationId, userId: session.userId ?? null });

  const [questionnaires, responses] = await Promise.all([
    listQuestionnairesForOrganization(organizationId),
    listQuestionnaireResponses({ organizationId }),
  ]);
  return NextResponse.json({ ok: true, questionnaires, responses });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'Programming data is not available for this school.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const questionnaireId = Number(body && typeof body === 'object' ? (body as { questionnaireId?: unknown }).questionnaireId : 0);
  const currentQuestionnaires = await listQuestionnairesForOrganization(organizationId);
  const current = currentQuestionnaires.find((questionnaire) => questionnaire.id === questionnaireId);
  if (!current) return NextResponse.json({ error: 'Questionnaire was not found.' }, { status: 404 });
  if (
    !canManageQuestionnaire({
      role: session.role,
    })
  ) {
    return NextResponse.json({ error: 'You do not have permission to delete questionnaires.' }, { status: 403 });
  }

  const result = await deleteQuestionnaire({ questionnaireId, organizationId });
  if (!result.ok) {
    const status = result.error === 'Questionnaire was not found.' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  const [questionnaires, responses] = await Promise.all([
    listQuestionnairesForOrganization(organizationId),
    listQuestionnaireResponses({ organizationId }),
  ]);
  return NextResponse.json({ ok: true, questionnaires, responses });
}

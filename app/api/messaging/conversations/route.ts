import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import {
  createGroupConversation,
  findActiveMessageUserByEmail,
  findOrCreateOneToOneConversation,
  getUnreadMessageCountForUser,
  listConversationsForUser,
  listMessageablePlayersForOrganization,
  listMessageableUsersAcrossOrganizations,
} from '../../../../lib/messaging-db';
import { listCoachesByOrganization } from '../../../../lib/training-db';
import { COMPANY_MESSAGING_OWNER_EMAIL, isCompanyMessagingOwner } from '../../../../lib/messaging-access';

async function requireSession(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const organizationId = Number(session.organizationId ?? 0);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return { ok: false as const, status: 403, error: 'No organization found for session.' };
  }
  return { ok: true as const, session, organizationId };
}

export async function GET(request: Request) {
  const allowed = await requireSession(request);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const url = new URL(request.url);
  if (url.searchParams.get('unreadOnly') === '1') {
    const unreadCount = await getUnreadMessageCountForUser(allowed.session.userId ?? 0);
    return NextResponse.json({ unreadCount });
  }
  const conversations = await listConversationsForUser({
    userId: allowed.session.userId ?? 0,
  });
  return NextResponse.json({ conversations });
}

export async function POST(request: Request) {
  const allowed = await requireSession(request);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const { session, organizationId } = allowed;
  const currentUserId = session.userId ?? 0;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const participantUserIds = Array.isArray(body.participantUserIds)
    ? Array.from(new Set(body.participantUserIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)))
    : [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  if (participantUserIds.length === 0) {
    return NextResponse.json({ error: 'At least one participant is required.' }, { status: 400 });
  }

  if (participantUserIds.includes(currentUserId)) {
    return NextResponse.json({ error: 'You cannot add yourself as a recipient.' }, { status: 400 });
  }

  let conversationOrganizationId = organizationId;
  if (isCompanyMessagingOwner(session)) {
    const directory = await listMessageableUsersAcrossOrganizations();
    const directoryById = new Map(directory.map((user) => [user.userId, user]));
    const recipients = participantUserIds.map((id) => directoryById.get(id));
    if (recipients.some((recipient) => !recipient)) {
      return NextResponse.json({ error: 'Recipients must be active coaches, admins, or players.' }, { status: 403 });
    }
    const recipientOrganizations = Array.from(new Set(recipients.map((recipient) => recipient?.organizationId).filter((id): id is number => Boolean(id))));
    if (recipientOrganizations.length === 1) conversationOrganizationId = recipientOrganizations[0];
  } else if (session.role === 'player') {
    const coaches = await listCoachesByOrganization(organizationId);
    const coachUserIds = new Set(coaches.filter((coach) => coach.isActive).map((coach) => Number(coach.userId)));
    const invalid = participantUserIds.some((id) => !coachUserIds.has(id));
    if (invalid) return NextResponse.json({ error: 'Players can only message coaches or admins at their school.' }, { status: 403 });
  } else if (session.role === 'coach' || session.role === 'admin') {
    const [players, coaches, companyOwner] = await Promise.all([
      listMessageablePlayersForOrganization(organizationId),
      listCoachesByOrganization(organizationId),
      findActiveMessageUserByEmail(COMPANY_MESSAGING_OWNER_EMAIL),
    ]);
    const messageablePlayerUserIds = new Set(players.map((player) => Number(player.userId)));
    const coachUserIds = new Set(coaches.filter((coach) => coach.isActive).map((coach) => Number(coach.userId)));
    if (companyOwner) coachUserIds.add(companyOwner.userId);
    const invalid = participantUserIds.some((id) => !messageablePlayerUserIds.has(id) && !coachUserIds.has(id));
    if (invalid) return NextResponse.json({ error: 'Recipients must be at your school or the Pearl company administrator.' }, { status: 403 });
  } else {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (participantUserIds.length === 1 && !name) {
    const result = await findOrCreateOneToOneConversation({
      organizationId: conversationOrganizationId,
      userIdA: currentUserId,
      userIdB: participantUserIds[0],
      createdByUserId: currentUserId,
    });
    return NextResponse.json({ ok: true, conversationId: result.id, created: result.created });
  }

  if (!name) {
    return NextResponse.json({ error: 'Group chats need a name.' }, { status: 400 });
  }
  const created = await createGroupConversation({
    organizationId: conversationOrganizationId,
    name,
    participantUserIds,
    createdByUserId: currentUserId,
  });
  return NextResponse.json({ ok: true, conversationId: created.id, created: true });
}

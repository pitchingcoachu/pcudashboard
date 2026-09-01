import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import {
  addConversationParticipants,
  getConversationMeta,
  isConversationParticipant,
  listMessageablePlayersForOrganization,
  removeConversationParticipant,
} from '../../../../../../lib/messaging-db';
import { listCoachesByOrganization } from '../../../../../../lib/training-db';

// PATCH { addUserIds?: number[]; removeUserIds?: number[] } -- adds and/or
// removes members from an existing group chat. Restricted to coach/admin
// participants of the group (any of them, not just the creator).
export async function PATCH(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId: conversationIdParam } = await params;
  const conversationId = Number(conversationIdParam);
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return NextResponse.json({ error: 'Valid conversationId is required.' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'coach' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Only coaches and admins can manage group members.' }, { status: 403 });
  }

  const currentUserId = session.userId ?? 0;
  const isParticipant = await isConversationParticipant({ conversationId, userId: currentUserId });
  if (!isParticipant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const conversation = await getConversationMeta(conversationId);
  if (!conversation) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  if (!conversation.isGroup) {
    return NextResponse.json({ error: 'Only group conversations have editable membership.' }, { status: 400 });
  }

  const organizationId = Number(session.organizationId ?? 0);
  if (organizationId !== conversation.organizationId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const addUserIds = Array.isArray(body.addUserIds)
    ? Array.from(new Set(body.addUserIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)))
    : [];
  const removeUserIds = Array.isArray(body.removeUserIds)
    ? Array.from(new Set(body.removeUserIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)))
    : [];

  if (!addUserIds.length && !removeUserIds.length) {
    return NextResponse.json({ error: 'addUserIds or removeUserIds is required.' }, { status: 400 });
  }

  if (addUserIds.length) {
    const [players, coaches] = await Promise.all([
      listMessageablePlayersForOrganization(organizationId),
      listCoachesByOrganization(organizationId),
    ]);
    const messageablePlayerUserIds = new Set(players.map((p) => Number(p.userId)));
    const coachUserIds = new Set(coaches.map((c) => Number(c.userId)));
    const invalid = addUserIds.some((id) => !messageablePlayerUserIds.has(id) && !coachUserIds.has(id));
    if (invalid) return NextResponse.json({ error: 'New members must be players, coaches, or admins at your school.' }, { status: 403 });
  }

  const currentParticipantIds = new Set(conversation.participants.map((p) => p.userId));
  const remainingAfterRemoval = new Set(currentParticipantIds);
  for (const id of removeUserIds) remainingAfterRemoval.delete(id);
  for (const id of addUserIds) remainingAfterRemoval.add(id);
  if (remainingAfterRemoval.size < 2) {
    return NextResponse.json({ error: 'A group needs at least 2 members.' }, { status: 400 });
  }

  if (removeUserIds.length) {
    await Promise.all(removeUserIds.map((userId) => removeConversationParticipant({ conversationId, userId })));
  }
  if (addUserIds.length) {
    await addConversationParticipants({ conversationId, userIds: addUserIds });
  }

  const updated = await getConversationMeta(conversationId);
  return NextResponse.json({ ok: true, conversation: updated });
}

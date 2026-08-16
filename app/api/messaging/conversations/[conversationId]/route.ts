import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { deleteObjectFromR2 } from '../../../../../lib/biomechanics-storage';
import {
  deleteGroupConversation,
  getConversationMeta,
  hideConversationForUser,
  isConversationParticipant,
  listMessages,
} from '../../../../../lib/messaging-db';

async function requireParticipant(request: Request, conversationId: number) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return { ok: false as const, status: 400, error: 'Valid conversationId is required.' };
  }
  const isParticipant = await isConversationParticipant({ conversationId, userId: session.userId ?? 0 });
  if (!isParticipant) return { ok: false as const, status: 403, error: 'Forbidden' };
  return { ok: true as const, session };
}

export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId: conversationIdParam } = await params;
  const conversationId = Number(conversationIdParam);
  const allowed = await requireParticipant(request, conversationId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const conversation = await getConversationMeta(conversationId);
  if (!conversation) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });

  const url = new URL(request.url);
  const before = url.searchParams.get('before');
  const limit = Number(url.searchParams.get('limit') ?? '30') || 30;
  const { messages, hasMore } = await listMessages({
    conversationId,
    currentUserId: allowed.session.userId ?? 0,
    beforeMessageId: before ? Number(before) : null,
    limit,
  });

  return NextResponse.json({ conversation, messages, hasMore });
}

// DELETE ?mode=hide (default) removes this conversation from just the
// caller's own list -- other participants are unaffected, and it reappears
// automatically if a new message arrives later.
// DELETE ?mode=group removes a group conversation for everyone, restricted
// to the group's creator or an admin in the same organization.
export async function DELETE(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId: conversationIdParam } = await params;
  const conversationId = Number(conversationIdParam);
  const allowed = await requireParticipant(request, conversationId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === 'group' ? 'group' : 'hide';

  if (mode === 'hide') {
    await hideConversationForUser({ conversationId, userId: allowed.session.userId ?? 0 });
    return NextResponse.json({ ok: true });
  }

  const conversation = await getConversationMeta(conversationId);
  if (!conversation) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  if (!conversation.isGroup) {
    return NextResponse.json({ error: 'Only group conversations can be deleted for everyone.' }, { status: 400 });
  }
  const isCreator = conversation.createdByUserId !== null && conversation.createdByUserId === allowed.session.userId;
  const isOrgAdmin = allowed.session.role === 'admin' && allowed.session.organizationId === conversation.organizationId;
  if (!isCreator && !isOrgAdmin) {
    return NextResponse.json({ error: 'Only the group creator or an admin can delete this group.' }, { status: 403 });
  }

  const r2Keys = await deleteGroupConversation(conversationId);
  await Promise.all(r2Keys.map((key) => deleteObjectFromR2(key).catch(() => {})));
  return NextResponse.json({ ok: true });
}

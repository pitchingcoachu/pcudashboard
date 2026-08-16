import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../../../lib/auth';
import { isConversationParticipant, toggleMessageReaction } from '../../../../../../../../lib/messaging-db';

const ALLOWED_REACTIONS = new Set(['👍', '❤️', '😂', '😮', '😢', '🔥']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> }
) {
  const { conversationId: conversationIdParam, messageId: messageIdParam } = await params;
  const conversationId = Number(conversationIdParam);
  const messageId = Number(messageIdParam);
  if (!Number.isFinite(conversationId) || conversationId <= 0 || !Number.isFinite(messageId) || messageId <= 0) {
    return NextResponse.json({ error: 'Valid conversationId and messageId are required.' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.userId ?? 0;
  const isParticipant = await isConversationParticipant({ conversationId, userId });
  if (!isParticipant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const emoji = typeof body.emoji === 'string' ? body.emoji : '';
  if (!ALLOWED_REACTIONS.has(emoji)) {
    return NextResponse.json({ error: 'Unsupported reaction.' }, { status: 400 });
  }

  const result = await toggleMessageReaction({ conversationId, messageId, userId, emoji });
  if (!result) return NextResponse.json({ error: 'Message not found or was deleted.' }, { status: 404 });
  return NextResponse.json({ ok: true, active: result.active });
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { getConversationMeta, isConversationParticipant, listMessages } from '../../../../../lib/messaging-db';

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
    beforeMessageId: before ? Number(before) : null,
    limit,
  });

  return NextResponse.json({ conversation, messages, hasMore });
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import { getConversationMeta, isConversationParticipant, setConversationPhoto } from '../../../../../../lib/messaging-db';

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId: conversationIdParam } = await params;
  const conversationId = Number(conversationIdParam);
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return NextResponse.json({ error: 'Valid conversationId is required.' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isParticipant = await isConversationParticipant({ conversationId, userId: session.userId ?? 0 });
  if (!isParticipant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const conversation = await getConversationMeta(conversationId);
  if (!conversation) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  if (!conversation.isGroup) {
    return NextResponse.json({ error: 'Only group conversations have a settable photo.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { photoDataUrl?: string | null };
  const photoDataUrl = typeof body.photoDataUrl === 'string' && body.photoDataUrl.trim() ? body.photoDataUrl.trim() : null;

  try {
    await setConversationPhoto({ conversationId, photoDataUrl });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save photo.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, photoDataUrl });
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import {
  createMessage,
  getConversationMeta,
  getConversationParticipantIds,
  getMessageById,
  isConversationParticipant,
} from '../../../../../../lib/messaging-db';
import { sendPushNotificationToUsers } from '../../../../../../lib/push-notifications';

type AttachmentInput = {
  r2Key: string;
  contentType: string;
  kind: 'photo' | 'video' | 'pdf';
  fileName: string;
  sizeBytes: number;
};

function parseAttachments(value: unknown, expectedKeyPrefix: string): AttachmentInput[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const attachments: AttachmentInput[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const record = entry as Record<string, unknown>;
    const r2Key = String(record.r2Key ?? '').trim();
    const contentType = String(record.contentType ?? '').trim();
    const fileName = String(record.fileName ?? '').trim();
    const sizeBytes = Number(record.sizeBytes ?? 0) || 0;
    const kind = contentType.startsWith('image/') ? 'photo' : contentType.startsWith('video/') ? 'video' : contentType === 'application/pdf' ? 'pdf' : null;
    if (!r2Key || !contentType || !fileName || !kind) return null;
    if (!r2Key.startsWith(expectedKeyPrefix)) return null;
    attachments.push({ r2Key, contentType, fileName, sizeBytes, kind });
  }
  return attachments;
}

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

  const conversationMeta = await getConversationMeta(conversationId);
  if (!conversationMeta) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  const expectedKeyPrefix = `chat-attachments/org-${conversationMeta.organizationId}/conversation-${conversationId}/`;
  const attachments = parseAttachments(body.attachments, expectedKeyPrefix);
  if (attachments === null) {
    return NextResponse.json({ error: 'One or more attachments are invalid.' }, { status: 400 });
  }
  if (!text && attachments.length === 0) {
    return NextResponse.json({ error: 'Message needs text or an attachment.' }, { status: 400 });
  }

  const senderUserId = session.userId ?? 0;
  const created = await createMessage({
    conversationId,
    senderUserId,
    body: text || null,
    attachments,
  });

  const participantIds = await getConversationParticipantIds(conversationId);
  const recipientIds = participantIds.filter((id) => id !== senderUserId);
  if (recipientIds.length > 0) {
    const preview = text
      ? text.slice(0, 120)
      : `Sent ${attachments.length > 1 ? `${attachments.length} attachments` : attachments[0].kind}`;
    const senderName = session.name || session.email || 'New message';
    void sendPushNotificationToUsers({
      userIds: recipientIds,
      title: conversationMeta.isGroup ? (conversationMeta.name ?? 'New group message') : senderName,
      body: conversationMeta.isGroup ? `${senderName}: ${preview}` : preview,
      data: { type: 'message', conversationId },
    });
  }

  const message = await getMessageById(created.id);
  return NextResponse.json({ ok: true, message });
}

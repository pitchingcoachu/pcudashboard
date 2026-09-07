import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { getR2Bucket, getR2Client } from '../../../../../lib/biomechanics-storage';
import { getConversationMeta, isConversationParticipant } from '../../../../../lib/messaging-db';
import { MAX_MESSAGE_ATTACHMENT_BYTES, messageAttachmentKind, normalizeMessageContentType } from '../../../../../lib/message-attachments';

/** Local browsers cannot PUT directly to the production bucket's restricted CORS origins. */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development' || process.env.VERCEL === '1') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const conversationId = Number(new URL(request.url).searchParams.get('conversationId'));
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
    return NextResponse.json({ error: 'Valid conversationId is required.' }, { status: 400 });
  }
  if (!await isConversationParticipant({ conversationId, userId: session.userId ?? 0 })) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const conversation = await getConversationMeta(conversationId);
  if (!conversation) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  const client = getR2Client();
  if (!client) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  if (Number(request.headers.get('content-length')) > MAX_MESSAGE_ATTACHMENT_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: 'Attachment is too large. Limit is 100 MB.' }, { status: 400 });
  }
  // Bound even chunked multipart requests before decoding the file.
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: 'A file is required.' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_MESSAGE_ATTACHMENT_BYTES + 1024 * 1024) {
      await reader.cancel();
      return NextResponse.json({ error: 'Attachment is too large. Limit is 100 MB.' }, { status: 400 });
    }
    chunks.push(value);
  }
  const payload = new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } });
  const form = await payload.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'A file is required.' }, { status: 400 });
  if (file.size > MAX_MESSAGE_ATTACHMENT_BYTES) return NextResponse.json({ error: 'Attachment is too large. Limit is 100 MB.' }, { status: 400 });
  const contentType = normalizeMessageContentType(file.name, file.type);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const r2Key = `chat-attachments/org-${conversation.organizationId}/conversation-${conversationId}/${messageAttachmentKind(contentType)}-${randomUUID()}-${safeName}`;
  await client.send(new PutObjectCommand({ Bucket: getR2Bucket(), Key: r2Key, ContentType: contentType, Body: Buffer.from(await file.arrayBuffer()) }));
  return NextResponse.json({ r2Key, contentType, fileName: file.name, sizeBytes: file.size });
}

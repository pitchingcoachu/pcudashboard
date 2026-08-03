import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { getR2Bucket, getR2Client } from '../../../../../lib/biomechanics-storage';
import { getMessageAttachment, isConversationParticipant } from '../../../../../lib/messaging-db';

export async function GET(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { attachmentId: rawAttachmentId } = await context.params;
  const attachmentId = Number(rawAttachmentId);
  if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
    return NextResponse.json({ error: 'Valid attachmentId is required.' }, { status: 400 });
  }

  const attachment = await getMessageAttachment(attachmentId);
  if (!attachment) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });

  const isParticipant = await isConversationParticipant({ conversationId: attachment.conversationId, userId: session.userId ?? 0 });
  if (!isParticipant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const client = getR2Client();
  if (!client) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const bucket = getR2Bucket();
  const rangeHeader = request.headers.get('range');

  try {
    const cmd = new GetObjectCommand({
      Bucket: bucket,
      Key: attachment.r2Key,
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    });
    const response = await client.send(cmd);
    if (!response.Body) return NextResponse.json({ error: 'Empty response from storage.' }, { status: 502 });

    const headers = new Headers();
    headers.set('Content-Type', attachment.contentType);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'private, max-age=300');
    headers.set('Content-Disposition', `inline; filename="${attachment.fileName.replace(/"/g, '')}"`);
    if (response.ContentLength) headers.set('Content-Length', String(response.ContentLength));
    if (response.ContentRange) headers.set('Content-Range', response.ContentRange);

    const body = response.Body as AsyncIterable<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of body) { controller.enqueue(chunk); }
          controller.close();
        } catch (err) { controller.error(err); }
      },
    });

    return new Response(stream, { status: rangeHeader ? 206 : 200, headers });
  } catch (err) {
    console.error('[chat attachment serve] R2 error:', err);
    return NextResponse.json({ error: 'Failed to fetch from storage.' }, { status: 502 });
  }
}

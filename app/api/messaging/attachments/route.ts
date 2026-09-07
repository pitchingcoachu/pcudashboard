import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSessionFromRequest } from '../../../../lib/auth';
import { getR2Bucket, getR2Client, isR2Configured } from '../../../../lib/biomechanics-storage';
import { isConversationParticipant } from '../../../../lib/messaging-db';

import { MAX_MESSAGE_ATTACHMENT_BYTES, messageAttachmentKind, normalizeMessageContentType } from '../../../../lib/message-attachments';

function buildR2Key(organizationId: number, conversationId: number, fileName: string, contentType: string): string {
  const safeName = String(fileName ?? 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const kind = messageAttachmentKind(contentType);
  return `chat-attachments/org-${organizationId}/conversation-${conversationId}/${kind}-${Date.now()}-${safeName}`;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(session.organizationId ?? 0);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'No organization found for session.' }, { status: 403 });
  }

  const conversationId = Number(url.searchParams.get('conversationId') ?? '0');
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return NextResponse.json({ error: 'Valid conversationId is required.' }, { status: 400 });
  }
  const isParticipant = await isConversationParticipant({ conversationId, userId: session.userId ?? 0 });
  if (!isParticipant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const fileName = String(url.searchParams.get('fileName') ?? '').trim();
  const contentType = normalizeMessageContentType(fileName, String(url.searchParams.get('contentType') ?? ''));
  if (!fileName) {
    return NextResponse.json({ error: 'A file name is required.' }, { status: 400 });
  }
  const sizeBytes = Number(url.searchParams.get('sizeBytes') ?? 0);
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return NextResponse.json({ error: 'Invalid attachment size.' }, { status: 400 });
  if (sizeBytes > MAX_MESSAGE_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: 'Attachment is too large. Limit is 100 MB.' }, { status: 400 });
  }

  if (!isR2Configured()) {
    return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  }

  const r2Key = buildR2Key(organizationId, conversationId, fileName, contentType);
  const client = getR2Client()!;
  const bucket = getR2Bucket();
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: r2Key, ContentType: contentType }),
    { expiresIn: 3600 }
  );
  return NextResponse.json({ presign: true, uploadUrl, r2Key, contentType });
}

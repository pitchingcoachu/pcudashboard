import { PutObjectCommand } from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../../lib/ai-access';
import { getR2Bucket, getR2Client, isR2Configured } from '../../../../../lib/biomechanics-storage';

export const maxDuration = 300;

const MAX_RECORDING_BYTES = 200 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

function isLocalUploadRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') return true;
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export async function PUT(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!isLocalUploadRequest(request)) {
    return NextResponse.json({ error: 'Recording relay uploads are only available during local development.' }, { status: 403 });
  }
  if (!isR2Configured() || !getR2Client()) {
    return NextResponse.json({ error: 'Recording storage is not configured.' }, { status: 503 });
  }

  const r2Key = String(request.headers.get('x-recording-key') ?? '').trim();
  const contentType = String(request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const declaredSize = Number(request.headers.get('x-recording-size') ?? 0);
  const expectedPrefix = `ai-sessions/org-${access.organizationId}/uploads/`;
  if (!r2Key.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: 'Recording upload does not belong to this organization.' }, { status: 403 });
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'Choose an MP3, M4A, WAV, WebM, MP4, or MOV recording.' }, { status: 400 });
  }
  if (!Number.isFinite(declaredSize) || declaredSize <= 0 || declaredSize > MAX_RECORDING_BYTES) {
    return NextResponse.json({ error: 'Recording must be under 200 MB.' }, { status: 400 });
  }

  const body = Buffer.from(await request.arrayBuffer());
  if (body.length !== declaredSize) {
    return NextResponse.json({ error: 'The recording upload was incomplete. Please try again.' }, { status: 400 });
  }

  await getR2Client()!.send(new PutObjectCommand({
    Bucket: getR2Bucket(),
    Key: r2Key,
    Body: body,
    ContentType: contentType,
    ContentLength: body.length,
  }));

  return NextResponse.json({ ok: true });
}

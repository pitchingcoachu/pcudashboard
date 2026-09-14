import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../../lib/ai-access';
import { getR2Bucket, getR2Client, isR2Configured } from '../../../../../lib/biomechanics-storage';
import { getOpenAiTranscriptionKey } from '../../../../../lib/openai-transcription-config';

export const maxDuration = 300;

const MAX_RECORDING_BYTES = 200 * 1024 * 1024;
const MULTIPART_THRESHOLD_BYTES = 24 * 1024 * 1024;
const MULTIPART_PART_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

function validateRecordingKey(key: string, organizationId: number): boolean {
  return key.startsWith(`ai-sessions/org-${organizationId}/uploads/`);
}

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export async function POST(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    getOpenAiTranscriptionKey();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Speech transcription is not configured.' },
      { status: 503 }
    );
  }
  const body = await request.json().catch(() => ({})) as { fileName?: string; contentType?: string; sizeBytes?: number };
  const fileName = String(body.fileName ?? 'recording').trim();
  const contentType = String(body.contentType ?? '').split(';')[0].trim().toLowerCase();
  const sizeBytes = Number(body.sizeBytes ?? 0);
  if (!ALLOWED.has(contentType)) {
    return NextResponse.json({ error: 'Choose an MP3, M4A, WAV, WebM, MP4, or MOV recording.' }, { status: 400 });
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_RECORDING_BYTES) {
    return NextResponse.json({ error: 'Recording must be under 200 MB.' }, { status: 400 });
  }
  if (!isR2Configured() || !getR2Client()) {
    return NextResponse.json({ error: 'Recording storage is not configured.' }, { status: 503 });
  }

  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'recording';
  const r2Key = `ai-sessions/org-${access.organizationId}/uploads/${Date.now()}-${crypto.randomUUID()}-${safe}`;
  const client = getR2Client()!;
  const bucket = getR2Bucket();

  // Large browser PUTs can be terminated with no resumable progress. Upload
  // those recordings as independently retryable 10 MB parts. Localhost keeps
  // using the local relay because R2 CORS intentionally excludes local origins.
  if (sizeBytes >= MULTIPART_THRESHOLD_BYTES && !isLocalRequest(request)) {
    const started = await client.send(new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: r2Key,
      ContentType: contentType,
    }));
    if (!started.UploadId) return NextResponse.json({ error: 'Storage did not start the recording upload.' }, { status: 502 });
    const partCount = Math.ceil(sizeBytes / MULTIPART_PART_BYTES);
    const partUrls = await Promise.all(
      Array.from({ length: partCount }, async (_, index) => {
        const partNumber = index + 1;
        const uploadUrl = await getSignedUrl(
          client,
          new UploadPartCommand({ Bucket: bucket, Key: r2Key, UploadId: started.UploadId, PartNumber: partNumber }),
          { expiresIn: 3600 }
        );
        return { partNumber, uploadUrl };
      })
    );
    return NextResponse.json({
      multipart: true,
      uploadId: started.UploadId,
      partSize: MULTIPART_PART_BYTES,
      partUrls,
      r2Key,
      contentType,
    });
  }

  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: r2Key, ContentType: contentType }),
    { expiresIn: 3600 }
  );
  return NextResponse.json({ multipart: false, uploadUrl, r2Key, contentType });
}

export async function PATCH(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => ({})) as {
    r2Key?: string;
    uploadId?: string;
    expectedParts?: number;
    expectedSize?: number;
  };
  const r2Key = String(body.r2Key ?? '').trim();
  const uploadId = String(body.uploadId ?? '').trim();
  const expectedParts = Number(body.expectedParts ?? 0);
  const expectedSize = Number(body.expectedSize ?? 0);
  if (!validateRecordingKey(r2Key, access.organizationId) || !uploadId) {
    return NextResponse.json({ error: 'Invalid multipart recording upload.' }, { status: 400 });
  }
  if (!Number.isFinite(expectedParts) || expectedParts <= 0 || expectedParts > 40 || !Number.isFinite(expectedSize) || expectedSize <= 0 || expectedSize > MAX_RECORDING_BYTES) {
    return NextResponse.json({ error: 'Invalid multipart recording size.' }, { status: 400 });
  }
  if (!isR2Configured() || !getR2Client()) {
    return NextResponse.json({ error: 'Recording storage is not configured.' }, { status: 503 });
  }

  const client = getR2Client()!;
  const bucket = getR2Bucket();
  const listed = await client.send(new ListPartsCommand({ Bucket: bucket, Key: r2Key, UploadId: uploadId }));
  const parts = (listed.Parts ?? [])
    .filter((part) => part.PartNumber && part.ETag)
    .sort((a, b) => Number(a.PartNumber) - Number(b.PartNumber));
  const uploadedBytes = parts.reduce((sum, part) => sum + Number(part.Size ?? 0), 0);
  if (parts.length !== expectedParts || uploadedBytes !== expectedSize) {
    return NextResponse.json({ error: 'One or more recording parts did not finish uploading.' }, { status: 409 });
  }
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: r2Key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts.map((part) => ({ ETag: part.ETag, PartNumber: part.PartNumber })) },
  }));
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const r2Key = String(url.searchParams.get('r2Key') ?? '').trim();
  const uploadId = String(url.searchParams.get('uploadId') ?? '').trim();
  if (!validateRecordingKey(r2Key, access.organizationId) || !uploadId || !isR2Configured() || !getR2Client()) {
    return NextResponse.json({ ok: true });
  }
  await getR2Client()!.send(new AbortMultipartUploadCommand({
    Bucket: getR2Bucket(),
    Key: r2Key,
    UploadId: uploadId,
  })).catch(() => {});
  return NextResponse.json({ ok: true });
}

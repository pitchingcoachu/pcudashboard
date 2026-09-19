import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import {
  getObjectMetadataFromR2,
  getR2Bucket,
  getR2Client,
  isR2Configured,
} from '../../../../../lib/biomechanics-storage';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';

const MAX_EXERCISE_VIDEO_BYTES = 350 * 1024 * 1024;

function inferVideoContentType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mov') || lower.endsWith('.qt')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.m4v')) return 'video/mp4';
  return 'video/mp4';
}

function extensionFor(fileName: string, contentType: string): string {
  const match = fileName.toLowerCase().match(/\.(mp4|m4v|mov|qt|webm)$/);
  if (match) return match[1] === 'qt' ? 'mov' : match[1];
  if (contentType === 'video/quicktime') return 'mov';
  if (contentType === 'video/webm') return 'webm';
  return 'mp4';
}

async function requireStaff(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return { error: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }) } as const;
  if (session.role === 'player') return { error: NextResponse.json({ error: 'Forbidden.' }, { status: 403 }) } as const;
  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return { error: NextResponse.json({ error: 'No programming organization is configured.' }, { status: 400 }) } as const;
  }
  return { organizationId } as const;
}

function publicVideoUrl(request: Request, r2Key: string): string {
  const url = new URL('/api/exercises/media', request.url);
  url.searchParams.set('key', r2Key);
  return url.toString();
}

function buildR2Key(organizationId: number, fileName: string, contentType: string): string {
  return `exercise-media/org-${organizationId}/${randomUUID()}.${extensionFor(fileName, contentType)}`;
}

export async function GET(request: Request) {
  const auth = await requireStaff(request);
  if ('error' in auth) return auth.error;

  const url = new URL(request.url);
  const fileName = String(url.searchParams.get('fileName') ?? 'exercise-video.mp4').trim();
  const contentType = String(url.searchParams.get('contentType') ?? '').trim() || inferVideoContentType(fileName);
  const sizeBytes = Number(url.searchParams.get('sizeBytes') ?? 0) || 0;
  if (!contentType.startsWith('video/')) {
    return NextResponse.json({ error: 'Choose a video file.' }, { status: 400 });
  }
  if (sizeBytes <= 0 || sizeBytes > MAX_EXERCISE_VIDEO_BYTES) {
    return NextResponse.json({ error: 'Video must be 350 MB or smaller.' }, { status: 400 });
  }
  if (!isR2Configured() || !getR2Client()) {
    return NextResponse.json({ error: 'Video storage is not configured.' }, { status: 503 });
  }

  const r2Key = buildR2Key(auth.organizationId, fileName, contentType);
  const uploadUrl = await getSignedUrl(
    getR2Client()!,
    new PutObjectCommand({ Bucket: getR2Bucket(), Key: r2Key, ContentType: contentType }),
    { expiresIn: 3600 }
  );
  return NextResponse.json({ uploadUrl, r2Key, contentType });
}

export async function POST(request: Request) {
  const auth = await requireStaff(request);
  if ('error' in auth) return auth.error;
  if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size <= 0 || file.size > MAX_EXERCISE_VIDEO_BYTES) {
      return NextResponse.json({ error: 'Choose a video no larger than 350 MB.' }, { status: 400 });
    }
    const contentType = file.type || inferVideoContentType(file.name);
    if (!contentType.startsWith('video/')) return NextResponse.json({ error: 'Choose a video file.' }, { status: 400 });
    const client = getR2Client();
    if (!client) return NextResponse.json({ error: 'Video storage is not configured.' }, { status: 503 });
    const r2Key = buildR2Key(auth.organizationId, file.name, contentType);
    await client.send(new PutObjectCommand({
      Bucket: getR2Bucket(),
      Key: r2Key,
      ContentType: contentType,
      Body: Buffer.from(await file.arrayBuffer()),
    }));
    return NextResponse.json({ ok: true, videoUrl: publicVideoUrl(request, r2Key) });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r2Key = String(body.r2Key ?? '').trim();
  const sizeBytes = Number(body.sizeBytes ?? 0) || 0;
  if (!r2Key.startsWith(`exercise-media/org-${auth.organizationId}/`)) {
    return NextResponse.json({ error: 'This upload does not belong to your organization.' }, { status: 403 });
  }
  const stored = await getObjectMetadataFromR2(r2Key);
  if (!stored || stored.contentLength <= 0 || (sizeBytes > 0 && stored.contentLength !== sizeBytes)) {
    return NextResponse.json({ error: 'The video upload is missing or incomplete.' }, { status: 400 });
  }
  if (!stored.contentType.startsWith('video/') || stored.contentLength > MAX_EXERCISE_VIDEO_BYTES) {
    return NextResponse.json({ error: 'The uploaded file is not a supported video.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, videoUrl: publicVideoUrl(request, r2Key) });
}

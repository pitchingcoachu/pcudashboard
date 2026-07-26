import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { getR2Client, getR2Bucket } from '../../../../../lib/biomechanics-storage';
import { resolvePlayerContentOrganizationId } from '../../../../../lib/player-content-scope';
import { getPlayerMedia } from '../../../../../lib/training-db';
import { GetObjectCommand } from '@aws-sdk/client-s3';

function localRoot(): string {
  return path.join(process.cwd(), '.motion-capture-uploads');
}

function inferContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.mov') || lower.endsWith('.qt')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

function nodeToWebStream(readable: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      readable.on('data', (chunk: Buffer | string) => {
        controller.enqueue(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      readable.on('end', () => controller.close());
      readable.on('error', (err) => controller.error(err));
    },
    cancel() {
      if (typeof (readable as NodeJS.ReadableStream & { destroy?: () => void }).destroy === 'function') {
        (readable as NodeJS.ReadableStream & { destroy: () => void }).destroy();
      }
    },
  });
}

export async function GET(request: Request, context: { params: Promise<{ mediaId: string }> }) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Players can access their own media (canManagePlayer enforces ownership below)
  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'No organization found for session.' }, { status: 403 });

  const { mediaId: rawMediaId } = await context.params;
  const mediaId = Number(rawMediaId);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return NextResponse.json({ error: 'Valid mediaId is required.' }, { status: 400 });
  }

  const media = await getPlayerMedia({ organizationId, mediaId });
  if (!media) {
    return NextResponse.json({ error: `Media not found. mediaId=${mediaId} organizationId=${organizationId}` }, { status: 404 });
  }
  // Players can only access their own media
  if (session.role === 'player' && media.playerId !== (session.playerId ?? -1)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rangeHeader = request.headers.get('range');
  const contentType = media.contentType || inferContentType(media.r2Key);

  // ── Local file serving ───────────────────────────────────────────────────
  if (media.r2Key.startsWith('local:')) {
    const localKey = media.r2Key.slice('local:'.length);
    const filePath = path.join(localRoot(), localKey);

    let fileSize: number;
    try {
      const info = await stat(filePath);
      fileSize = info.size;
    } catch {
      return NextResponse.json({ error: 'Media file not found on disk.' }, { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'private, max-age=300');

    if (rangeHeader) {
      const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : fileSize - 1;
      const chunkSize = end - start + 1;
      headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      headers.set('Content-Length', String(chunkSize));
      const stream = nodeToWebStream(createReadStream(filePath, { start, end }));
      return new Response(stream, { status: 206, headers });
    }

    headers.set('Content-Length', String(fileSize));
    const stream = nodeToWebStream(createReadStream(filePath));
    return new Response(stream, { status: 200, headers });
  }

  // ── R2 serving ───────────────────────────────────────────────────────────
  const client = getR2Client();
  if (!client) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const bucket = getR2Bucket();

  try {
    const cmd = new GetObjectCommand({
      Bucket: bucket,
      Key: media.r2Key,
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    });
    const response = await client.send(cmd);
    if (!response.Body) return NextResponse.json({ error: 'Empty response from storage.' }, { status: 502 });

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'private, max-age=300');
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
    console.error('[media serve] R2 error:', err);
    return NextResponse.json({ error: 'Failed to fetch from storage.' }, { status: 502 });
  }
}

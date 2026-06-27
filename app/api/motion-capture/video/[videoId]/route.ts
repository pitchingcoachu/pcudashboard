import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { getObjectFromR2 } from '../../../../../lib/biomechanics-storage';
import { getMotionCaptureVideoForAccess } from '../../../../../lib/motion-capture-db';
import { canManagePlayer } from '../../../../../lib/portal-access';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';

function asyncIterableToStream(iterable: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel() {
      if (typeof iterator.return === 'function') await iterator.return();
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { videoId: rawVideoId } = await params;
  const videoId = Number(rawVideoId ?? '0');
  if (!Number.isFinite(videoId) || videoId <= 0) return NextResponse.json({ error: 'Invalid video id.' }, { status: 400 });

  const organizationId = resolveProgrammingOrganizationId(session);
  const video = await getMotionCaptureVideoForAccess({ organizationId, videoId });
  if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 });
  const allowed = await canManagePlayer(session, video.playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const object = await getObjectFromR2(video.r2Key);
  if (!object) return NextResponse.json({ error: 'Video file is not available.' }, { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type', object.contentType || video.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'private, max-age=300');
  headers.set('Accept-Ranges', 'none');
  if (object.contentLength !== null) headers.set('Content-Length', String(object.contentLength));
  return new Response(asyncIterableToStream(object.body), { status: 200, headers });
}

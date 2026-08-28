import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import { getObjectFromR2 } from '../../../../../../lib/biomechanics-storage';
import { getVideoExportJobForUser } from '../../../../../../lib/training-db';

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

// Re-downloading a finished export just re-streams the same stored R2
// object -- no re-render, matching the "shouldn't have to re-download the
// full several minutes" requirement.
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = Number(session.userId ?? 0);
  const { jobId: rawJobId } = await params;
  const jobId = Number(rawJobId ?? '0');
  if (!Number.isFinite(jobId) || jobId <= 0) return NextResponse.json({ error: 'Invalid job id.' }, { status: 400 });

  const job = await getVideoExportJobForUser({ userId, jobId });
  if (!job) return NextResponse.json({ error: 'Export not found.' }, { status: 404 });
  if (job.status !== 'ready' || !job.r2Key) {
    return NextResponse.json({ error: 'Export is not ready yet.' }, { status: 409 });
  }

  const object = await getObjectFromR2(job.r2Key);
  if (!object) return NextResponse.json({ error: 'Export file is not available.' }, { status: 404 });

  const safeName = job.name.replace(/[^a-zA-Z0-9 ._-]+/g, '-').trim() || 'video-export';
  const headers = new Headers();
  headers.set('Content-Type', 'video/mp4');
  headers.set('Content-Disposition', `attachment; filename="${safeName}.mp4"`);
  headers.set('X-Content-Type-Options', 'nosniff');
  if (object.contentLength !== null) headers.set('Content-Length', String(object.contentLength));
  return new Response(asyncIterableToStream(object.body), { status: 200, headers });
}

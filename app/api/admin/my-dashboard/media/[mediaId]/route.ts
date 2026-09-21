import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../../../../lib/player-content-scope';
import { getCoachDashboardMedia } from '../../../../../../lib/coach-dashboard-db';
import { getObjectFromR2 } from '../../../../../../lib/biomechanics-storage';

function toWebStream(body: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of body) controller.enqueue(chunk);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export async function GET(request: Request, context: { params: Promise<{ mediaId: string }> }) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session || session.role === 'player' || !session.userId) return NextResponse.json({ error:'Forbidden' }, { status:403 });
  const organizationId = await resolvePlayerContentOrganizationId(session);
  const { mediaId } = await context.params;
  const media = await getCoachDashboardMedia({ organizationId, ownerUserId:session.userId, id:Number(mediaId) });
  if (!media) return NextResponse.json({ error:'Media not found.' }, { status:404 });
  const range=request.headers.get('range');
  const object = await getObjectFromR2(media.r2Key,range);
  if (!object) return NextResponse.json({ error:'File not found.' }, { status:404 });
  return new Response(toWebStream(object.body), {
    status:object.contentRange?206:200,
    headers: {
      'Content-Type': media.contentType,
      ...(object.contentLength ? { 'Content-Length': String(object.contentLength) } : {}),
      'Accept-Ranges':'bytes',
      ...(object.contentRange?{'Content-Range':object.contentRange}:{}),
      'Content-Disposition': `inline; filename="${media.fileName.replace(/["\r\n]/g, '')}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}

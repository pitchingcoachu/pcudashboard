import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../../../lib/dashboard-access';
import type { PortalSession } from '../../../../../../lib/portal-session';
import { getBiomechanicsPitchVideo } from '../../../../../../lib/biomechanics-db';
import { getObjectFromR2 } from '../../../../../../lib/biomechanics-storage';
import { resolveSchoolScopedOrganizationId } from '../../../../../../lib/programming-scope';

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

function toScopedSession(session: NonNullable<Awaited<ReturnType<typeof getSession>>>): PortalSession {
  return {
    email: session.email,
    appUrl: session.appUrl,
    apps: session.apps,
    name: session.name,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    userId: Number(session.userId ?? 0),
    organizationId: Number(session.organizationId ?? 0),
    playerId: session.playerId ?? null,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
  };
}

async function getSession() {
  const cookieStore = await cookies();
  return getSessionFromCookies(cookieStore);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pitchKey: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const scopedSession = toScopedSession(session);
  const schoolCode = resolveDashboardSchoolCode(scopedSession);
  if (schoolCode !== 'PCU') return NextResponse.json({ error: 'Biomechanics is only enabled for PCU.' }, { status: 403 });

  const { pitchKey: rawPitchKey } = await params;
  const pitchKey = String(rawPitchKey ?? '').trim();
  if (!pitchKey) return NextResponse.json({ error: 'pitchKey is required.' }, { status: 400 });

  const scopedOrgId = resolveSchoolScopedOrganizationId(scopedSession);
  const organizationId = Number.isFinite(Number(scopedOrgId)) && Number(scopedOrgId) > 0 ? Number(scopedOrgId) : Number(session.organizationId ?? 0);
  const candidateOrgIds = Array.from(
    new Set(
      [Number(scopedOrgId), Number(session.organizationId ?? 0), ...(schoolCode === 'PCU' ? [1] : [])]
        .filter((v) => Number.isFinite(v) && v > 0)
    )
  );

  let video = await getBiomechanicsPitchVideo({ organizationId, schoolCode, pitchKey });
  if (!video) {
    for (const orgId of candidateOrgIds) {
      if (orgId === organizationId) continue;
      video = await getBiomechanicsPitchVideo({ organizationId: orgId, schoolCode, pitchKey });
      if (video) break;
    }
  }
  if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 });

  const object = await getObjectFromR2(video.r2Key);
  if (!object) return NextResponse.json({ error: 'Video file is not available.' }, { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type', object.contentType || video.contentType || 'video/mp4');
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('Accept-Ranges', 'none');
  if (object.contentLength !== null) headers.set('Content-Length', String(object.contentLength));
  return new Response(asyncIterableToStream(object.body), { status: 200, headers });
}

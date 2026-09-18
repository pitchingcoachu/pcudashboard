import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../../../lib/dashboard-access';
import type { PortalSession } from '../../../../../../lib/portal-session';
import { getBiomechanicsPitchOwnerName, getBiomechanicsPitchVideo } from '../../../../../../lib/biomechanics-db';
import { getObjectFromR2 } from '../../../../../../lib/biomechanics-storage';
import { resolveProgrammingOrganizationId, resolveSchoolScopedOrganizationId } from '../../../../../../lib/programming-scope';
import { getPlayerForUser } from '../../../../../../lib/training-db';

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

function normalizeName(value: string): string {
  const raw = String(value ?? '').trim();
  const firstLast = raw.includes(',')
    ? (() => {
        const [last, ...rest] = raw.split(',').map((part) => part.trim());
        return `${rest.join(' ')} ${last}`.trim();
      })()
    : raw;
  return firstLast.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
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

  const ownPlayer = session.role === 'player'
    ? await getPlayerForUser({ organizationId: await resolveProgrammingOrganizationId(scopedSession), userId: session.userId ?? 0 })
    : null;
  if (session.role === 'player' && !ownPlayer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let video = null as Awaited<ReturnType<typeof getBiomechanicsPitchVideo>>;
  for (const orgId of candidateOrgIds) {
    if (session.role === 'player') {
      const ownerName = await getBiomechanicsPitchOwnerName({ organizationId: orgId, schoolCode, pitchKey });
      if (!ownerName || normalizeName(ownerName) !== normalizeName(ownPlayer?.fullName ?? '')) continue;
    }
    video = await getBiomechanicsPitchVideo({ organizationId: orgId, schoolCode, pitchKey });
    if (video) break;
  }
  if (session.role === 'player' && !video) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

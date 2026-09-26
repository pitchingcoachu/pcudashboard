import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import type { PortalSession } from '../../../../../lib/portal-session';
import { createSignedR2DownloadUrl, signedR2Redirect } from '../../../../../lib/r2-signed-download';
import generatedManifest from '../../../../../public/mocap/pcu-mocap-manifest.json';

const AVAILABLE_CAMERAS: Record<string, ReadonlySet<number>> = Object.assign({
  test: new Set([1, 2, 3]),
  'tj-kenyon': new Set([1, 2, 3, 4, 5]),
}, Object.fromEntries(generatedManifest.map((capture) => [capture.datasetKey, new Set(capture.availableCameras)])));

function toScopedSession(session: NonNullable<ReturnType<typeof getSessionFromCookies>>): PortalSession {
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

export async function GET(request: Request) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (resolveDashboardSchoolCode(toScopedSession(session)) !== 'PCU') {
    return NextResponse.json({ error: 'Motion Capture is not enabled for this organization.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const dataset = String(url.searchParams.get('dataset') ?? '').trim().toLowerCase();
  const camera = Number(url.searchParams.get('camera') ?? '0');
  const view = String(url.searchParams.get('view') ?? 'overlay').trim().toLowerCase();
  if (!AVAILABLE_CAMERAS[dataset]?.has(camera)) {
    return NextResponse.json({ error: 'Video angle not found.' }, { status: 404 });
  }
  if (view !== 'overlay' && view !== 'raw') {
    return NextResponse.json({ error: 'Video view not found.' }, { status: 404 });
  }

  const key = `motion-capture/pcu/${dataset}/${view === 'raw' ? 'raw-' : ''}camera-${camera}.mp4`;
  const signedUrl = await createSignedR2DownloadUrl({ key, contentType: 'video/mp4', expiresIn: 60 * 60 });
  if (!signedUrl) return NextResponse.json({ error: 'Video storage is unavailable.' }, { status: 503 });
  return signedR2Redirect(signedUrl);
}

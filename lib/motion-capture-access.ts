import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from './auth';
import { isDatabaseConfigured } from './auth-db';
import { resolveDashboardSchoolCode } from './dashboard-access';
import type { PortalSession } from './portal-session';
import generatedManifest from '../public/mocap/pcu-mocap-manifest.json';

export const DATASET_FRAME_BOUNDS: Record<string, { first: number; last: number }> = Object.assign({
  test: { first: 55, last: 133 },
  'tj-kenyon': { first: 125, last: 199 },
}, Object.fromEntries(generatedManifest.map((capture) => [capture.datasetKey, {
  first: capture.startFrame,
  last: capture.endFrame,
}])));

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

export async function authorizedMotionCaptureSession(write = false) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const scoped = toScopedSession(session);
  if (resolveDashboardSchoolCode(scoped) !== 'PCU') {
    return { response: NextResponse.json({ error: 'Motion Capture is not enabled for this organization.' }, { status: 403 }) };
  }
  if (write && scoped.role === 'player') {
    return { response: NextResponse.json({ error: 'Only coaches and admins can edit motion-capture data.' }, { status: 403 }) };
  }
  if (!isDatabaseConfigured()) {
    return { response: NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 503 }) };
  }
  return { session: scoped };
}

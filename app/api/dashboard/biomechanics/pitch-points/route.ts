import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import type { PortalSession } from '../../../../../lib/portal-session';
import { getBiomechanicsPitchPoints } from '../../../../../lib/biomechanics-db';
import { resolveSchoolScopedOrganizationId } from '../../../../../lib/programming-scope';

export const maxDuration = 60;

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

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const scopedSession = toScopedSession(session);
  const schoolCode = resolveDashboardSchoolCode(scopedSession);
  if (schoolCode !== 'PCU') return NextResponse.json({ error: 'Biomechanics is only enabled for PCU.' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const pitchKey = String(searchParams.get('pitchKey') ?? '').trim();
  const forceMode = String(searchParams.get('forceMode') ?? '').trim().toLowerCase() === 'bw' ? 'bw' : 'force';
  if (!pitchKey) return NextResponse.json({ error: 'pitchKey is required.' }, { status: 400 });

  const scopedOrgId = resolveSchoolScopedOrganizationId(scopedSession);
  const organizationId = Number.isFinite(Number(scopedOrgId)) && Number(scopedOrgId) > 0 ? Number(scopedOrgId) : Number(session.organizationId ?? 0);

  const candidateOrgIds = Array.from(
    new Set(
      [Number(scopedOrgId), Number(session.organizationId ?? 0), ...(schoolCode === 'PCU' ? [1] : [])]
        .filter((v) => Number.isFinite(v) && v > 0)
    )
  );

  try {
    let points = await getBiomechanicsPitchPoints({ organizationId, schoolCode, pitchKey });
    if (!points.length) {
      for (const orgId of candidateOrgIds) {
        if (orgId === organizationId) continue;
        points = await getBiomechanicsPitchPoints({ organizationId: orgId, schoolCode, pitchKey });
        if (points.length) break;
      }
    }

    // forceMode is accepted for future server-side scaling; currently scaling is applied client-side
    void forceMode;

    return NextResponse.json(
      { pitch_points: points },
      { headers: { 'cache-control': 'private, max-age=300, stale-while-revalidate=60' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load pitch points.' },
      { status: 500 }
    );
  }
}

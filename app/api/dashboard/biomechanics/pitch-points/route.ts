import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import type { PortalSession } from '../../../../../lib/portal-session';
import { getBiomechanicsPitchOwnerName, getBiomechanicsPitchPoints } from '../../../../../lib/biomechanics-db';
import { resolveProgrammingOrganizationId, resolveSchoolScopedOrganizationId } from '../../../../../lib/programming-scope';
import { getPlayerForUser } from '../../../../../lib/training-db';

export const maxDuration = 60;

type PitchPoints = Awaited<ReturnType<typeof getBiomechanicsPitchPoints>>;
const pitchPointMemoryCache = new Map<string, { at: number; points: PitchPoints }>();
const PITCH_POINT_CACHE_TTL_MS = 5 * 60 * 1000;

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

  const ownPlayer = session.role === 'player'
    ? await getPlayerForUser({ organizationId: await resolveProgrammingOrganizationId(scopedSession), userId: session.userId ?? 0 })
    : null;
  if (session.role === 'player' && !ownPlayer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    let points: PitchPoints = [];
    for (const orgId of candidateOrgIds) {
      if (session.role === 'player') {
        const ownerName = await getBiomechanicsPitchOwnerName({ organizationId: orgId, schoolCode, pitchKey });
        if (!ownerName || normalizeName(ownerName) !== normalizeName(ownPlayer?.fullName ?? '')) continue;
      }
      const cacheKey = `${orgId}:${schoolCode}:${pitchKey}`;
      const cached = pitchPointMemoryCache.get(cacheKey);
      if (cached && Date.now() - cached.at < PITCH_POINT_CACHE_TTL_MS) {
        points = cached.points;
      } else {
        points = await getBiomechanicsPitchPoints({ organizationId: orgId, schoolCode, pitchKey });
        if (points.length) pitchPointMemoryCache.set(cacheKey, { at: Date.now(), points });
      }
      if (points.length) break;
    }

    if (session.role === 'player' && !points.length) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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

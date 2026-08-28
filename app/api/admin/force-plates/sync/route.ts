import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import { runForcePlateSync } from '../../../../../lib/force-plate-sync-runner';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await canUseProgrammingData(session))) {
    return NextResponse.json({ error: 'Programming access required.' }, { status: 403 });
  }
  const schoolCode = resolveProgrammingSchoolCode(session);
  if (schoolCode !== 'PCU') {
    return NextResponse.json({ error: 'Force Plate Sync is enabled only for PCU.' }, { status: 400 });
  }

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return NextResponse.json({ error: 'Invalid programming organization.' }, { status: 400 });
  }

  const url = new URL(request.url);
  const forceFullSync = String(url.searchParams.get('full') ?? '').trim() === '1';
  const synced = await runForcePlateSync({
    organizationId,
    schoolCode,
    assignedCoachUserId: null,
    forceFullSync,
  });
  if (!synced.ok) return NextResponse.json({ error: synced.error }, { status: 500 });

  return NextResponse.json({
    ok: true,
    playerCount: synced.playerCount,
    fetchedAt: synced.fetchedAt,
    lookbackDaysUsed: synced.lookbackDaysUsed,
    forceFullSync: synced.forceFullSync,
  });
}

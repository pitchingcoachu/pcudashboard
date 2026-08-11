import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { isDatabaseConfigured } from '../../../../../lib/auth-db';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { lookupPitchVideoUrls, parseVideoLookupIds } from '../../../../../lib/pitching-video-lookup';

export async function GET(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 500 });

  const requestUrl = new URL(request.url);
  const ids = parseVideoLookupIds(requestUrl.searchParams.get('ids'));
  if (!ids.length) return NextResponse.json({ pitches: [] });

  const schoolCode = resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  })
    .trim()
    .toUpperCase();

  try {
    const pitches = await lookupPitchVideoUrls(ids, schoolCode);
    return NextResponse.json({ pitches });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to refresh video URLs.' },
      { status: 500 }
    );
  }
}

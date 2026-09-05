import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../../lib/programming-scope';
import { getIntendedZoneTargetingProfiles } from '../../../../../../lib/training-db';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const url = new URL(request.url);
  const pitcherName = String(url.searchParams.get('pitcherName') ?? '').trim();
  if (!pitcherName) return NextResponse.json({ error: 'pitcherName is required.' }, { status: 400 });

  const splitValues = (key: string) => String(url.searchParams.get(key) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value && value.toLowerCase() !== 'all');

  const profiles = await getIntendedZoneTargetingProfiles({
    organizationId,
    pitcherName,
    startDate: url.searchParams.get('startDate') || null,
    endDate: url.searchParams.get('endDate') || null,
    pitchTypes: splitValues('pitchTypes'),
    ballTypes: splitValues('ballTypes'),
  });

  return NextResponse.json({ profiles, locationSampleMinimum: 26 });
}

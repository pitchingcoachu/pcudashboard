import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../../lib/programming-scope';
import { getIntendedZonePitchTypeStats, getIntendedZonePitcherLeaderboard } from '../../../../../../lib/training-db';

// GET ?pitcherName=X&startDate=&endDate= -> pitch-type breakdown for one pitcher.
// GET ?leaderboard=1&startDate=&endDate= -> org-wide per-pitcher leaderboard.
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const url = new URL(request.url);
  const startDate = url.searchParams.get('startDate') || null;
  const endDate = url.searchParams.get('endDate') || null;
  const pitchTypesRaw = url.searchParams.get('pitchTypes') || '';
  const pitchTypes = pitchTypesRaw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value && value.toLowerCase() !== 'all');

  if (url.searchParams.get('leaderboard') === '1') {
    const leaderboard = await getIntendedZonePitcherLeaderboard({ organizationId, startDate, endDate, pitchTypes });
    return NextResponse.json({ leaderboard });
  }

  const pitcherName = String(url.searchParams.get('pitcherName') ?? '').trim();
  if (!pitcherName) return NextResponse.json({ error: 'pitcherName is required.' }, { status: 400 });

  const splitBy = url.searchParams.get('splitBy') === 'targetSize' ? 'targetSize' : 'pitchType';
  const stats = await getIntendedZonePitchTypeStats({ organizationId, pitcherName, startDate, endDate, pitchTypes, splitBy });
  return NextResponse.json({ stats });
}

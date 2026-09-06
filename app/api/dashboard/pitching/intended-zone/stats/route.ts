import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../../lib/programming-scope';
import { getIntendedZonePitchTypeStats, getIntendedZonePitcherLeaderboard, listIntendedZoneBallTypes } from '../../../../../../lib/training-db';

// A cold serverless instance's first DB round-trip (schema check, pool
// connect) occasionally loses the race against the pg driver's client-side
// query_timeout -- retrying once against the now-warm pool/connection
// resolves it without the user having to manually refresh.
async function withRetryOnTimeout<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && error.message === 'Query read timeout') {
      return await fn();
    }
    throw error;
  }
}

// GET ?pitcherName=X&startDate=&endDate= -> pitch-type breakdown for one pitcher.
// GET ?leaderboard=1&startDate=&endDate= -> org-wide per-pitcher leaderboard.
// GET ?ballTypeOptions=1 -> the org's own distinct ball type labels (free-text
// per org, e.g. "Baseball", "+5%"), for populating the Ball Type filter.
export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const session = getSessionFromRequest(request, cookieStore);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const organizationId = await resolveProgrammingOrganizationId(session);
    if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

    const url = new URL(request.url);

    if (url.searchParams.get('ballTypeOptions') === '1') {
      const ballTypes = await withRetryOnTimeout(() => listIntendedZoneBallTypes({ organizationId }));
      return NextResponse.json({ ballTypes });
    }

    const startDate = url.searchParams.get('startDate') || null;
    const endDate = url.searchParams.get('endDate') || null;
    const pitchTypesRaw = url.searchParams.get('pitchTypes') || '';
    const pitchTypes = pitchTypesRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value && value.toLowerCase() !== 'all');

    const ballTypesRaw = url.searchParams.get('ballTypes') || '';
    const ballTypes = ballTypesRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value && value.toLowerCase() !== 'all');

    const splitByRaw = url.searchParams.get('splitBy');
    const splitBy = splitByRaw === 'targetSize' || splitByRaw === 'targetLocation' || splitByRaw === 'ballType'
      ? splitByRaw
      : 'pitchType';

    if (url.searchParams.get('leaderboard') === '1') {
      const [leaderboard, stats] = await withRetryOnTimeout(() =>
        Promise.all([
          getIntendedZonePitcherLeaderboard({ organizationId, startDate, endDate, pitchTypes, ballTypes }),
          getIntendedZonePitchTypeStats({ organizationId, startDate, endDate, pitchTypes, ballTypes, splitBy }),
        ])
      );
      return NextResponse.json({ leaderboard, stats });
    }

    const pitcherName = String(url.searchParams.get('pitcherName') ?? '').trim();
    if (!pitcherName) return NextResponse.json({ error: 'pitcherName is required.' }, { status: 400 });

    const stats = await withRetryOnTimeout(() =>
      getIntendedZonePitchTypeStats({ organizationId, pitcherName, startDate, endDate, pitchTypes, ballTypes, splitBy })
    );
    return NextResponse.json({ stats });
  } catch (error) {
    // Without this, a transient DB error (pool exhaustion, a dropped
    // connection) returns Next.js's default HTML 500 page instead of JSON --
    // the client's response.json() then throws its own confusing parse
    // error instead of the real message, making failures look random/
    // unexplained ("hit or miss") rather than a clear retryable error.
    const message =
      error instanceof Error && error.message === 'Query read timeout'
        ? 'The database took too long to respond. Please try again.'
        : error instanceof Error
          ? error.message
          : 'Failed to load Intended Target stats.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

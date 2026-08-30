import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../../lib/programming-scope';
import {
  getIntendedZoneSession,
  listIntendedZonePitches,
  matchIntendedZonePitch,
  queueIntendedZoneTarget,
} from '../../../../../../lib/training-db';
import { getPracticeBalls, getPracticePlays, type TrackmanPitchBall } from '../../../../../../lib/trackman-data-api';

function isTrackedPitch(ball: unknown): ball is TrackmanPitchBall {
  return Boolean(ball) && typeof ball === 'object' && (ball as { trackType?: string }).trackType === 'Pitch';
}

// GET ?sessionId= -> poll: pulls the latest TrackMan data for the attached
// session, matches any newly-tracked pitches to pending (un-thrown) queued
// targets in order, then returns the full up-to-date pitch list. Safe to
// call on an interval during a live session -- matching only ever consumes
// the OLDEST pending target, so out-of-order duplicate polls don't
// double-match a pitch that's already been recorded (TrackMan's playId is
// checked for "already have this one" implicitly, since a pitch already
// matched is no longer pending on the next poll and getPracticeBalls always
// returns the session's full history, not just new pitches since last call).
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const url = new URL(request.url);
  const sessionId = Number(url.searchParams.get('sessionId') ?? '0');
  if (!Number.isFinite(sessionId) || sessionId <= 0) return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 });

  const izSession = await getIntendedZoneSession({ organizationId, sessionId });
  if (!izSession) return NextResponse.json({ error: 'Session was not found.' }, { status: 404 });

  if (izSession.trackmanSessionId) {
    try {
      const [balls, plays] = await Promise.all([
        getPracticeBalls(izSession.trackmanSessionId),
        getPracticePlays(izSession.trackmanSessionId).catch(() => []),
      ]);
      const existing = await listIntendedZonePitches({ organizationId, sessionId });
      const alreadyMatchedPlayIds = new Set(existing.map((p) => p.trackmanPlayId).filter((id): id is string => Boolean(id)));
      const playTagById = new Map(plays.map((p) => [p.playID, p]));

      const newPitches = balls.filter(isTrackedPitch).filter((ball) => !alreadyMatchedPlayIds.has(ball.playId));
      // TrackMan returns balls in tracked order already; match oldest-first
      // so they line up with the order targets were queued in.
      for (const ball of newPitches) {
        const location = ball.pitch.location;
        const play = playTagById.get(ball.playId);
        await matchIntendedZonePitch({
          organizationId,
          sessionId,
          trackmanPlayId: ball.playId,
          plateLocSide: typeof location?.plateLocSide === 'number' ? location.plateLocSide : null,
          plateLocHeight: typeof location?.plateLocHeight === 'number' ? location.plateLocHeight : null,
          pitchType: play?.pitchTag?.taggedPitchType ?? null,
          relSpeed: typeof ball.pitch.release?.relSpeed === 'number' ? ball.pitch.release.relSpeed : null,
          inducedVertBreak: typeof ball.pitch.trajectory?.inducedVertBreak === 'number' ? ball.pitch.trajectory.inducedVertBreak : null,
          horzBreak: typeof ball.pitch.trajectory?.horzBreak === 'number' ? ball.pitch.trajectory.horzBreak : null,
          pitcherThrows: play?.pitcher?.pitcherThrows ?? null,
          taggedPitcherName: play?.pitcher?.pitcher ?? null,
          thrownAt: null,
        });
      }
    } catch (error) {
      // Best-effort: if TrackMan is briefly unreachable, still return
      // whatever's already stored rather than failing the whole poll.
      console.error('[intended-zone] poll failed:', error);
    }
  }

  const pitches = await listIntendedZonePitches({ organizationId, sessionId });
  return NextResponse.json({ session: izSession, pitches });
}

// POST -> queue the coach's tapped intended target for the next pitch.
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const body = (await request.json().catch(() => null)) as
    | { sessionId?: number; intendedSideFt?: number; intendedHeightFt?: number; targetRadiusFt?: number }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const sessionId = Number(body.sessionId ?? 0);
  const intendedSideFt = Number(body.intendedSideFt);
  const intendedHeightFt = Number(body.intendedHeightFt);
  const targetRadiusFt = Number(body.targetRadiusFt);
  if (
    !Number.isFinite(sessionId) ||
    sessionId <= 0 ||
    !Number.isFinite(intendedSideFt) ||
    !Number.isFinite(intendedHeightFt) ||
    !Number.isFinite(targetRadiusFt) ||
    targetRadiusFt <= 0
  ) {
    return NextResponse.json({ error: 'sessionId, intendedSideFt, intendedHeightFt, and targetRadiusFt are required.' }, { status: 400 });
  }

  const result = await queueIntendedZoneTarget({ organizationId, sessionId, intendedSideFt, intendedHeightFt, targetRadiusFt });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, pitchId: result.pitchId, pitchIndex: result.pitchIndex });
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../../lib/programming-scope';
import {
  deleteIntendedZonePitch,
  getIntendedZoneSession,
  listIntendedZonePitches,
  matchIntendedZonePitch,
  queueIntendedZoneTarget,
  recordManualIntendedZonePitch,
} from '../../../../../../lib/training-db';
import { getPracticeBalls, getPracticePlays, type TrackmanPitchBall } from '../../../../../../lib/trackman-data-api';
import { listBufferedTrackmanPitches } from '../../../../../../lib/trackman-live-webhook';

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
    // The B1 webhook feed is the primary live path. Events are persisted as
    // soon as TrackMan pushes them, including when the coach's browser is
    // briefly offline; polling this route only drains that durable buffer.
    try {
      const buffered = await listBufferedTrackmanPitches(izSession.trackmanSessionId);
      const existing = await listIntendedZonePitches({ organizationId, sessionId });
      const alreadyMatchedPlayIds = new Set(existing.map((p) => p.trackmanPlayId).filter((id): id is string => Boolean(id)));
      const sessionStartedAtMs = new Date(izSession.startedAt).getTime();
      for (const pitch of buffered.filter((item) => {
        if (alreadyMatchedPlayIds.has(item.playId)) return false;
        const trackedAtMs = item.trackedAt ? new Date(item.trackedAt).getTime() : Number.NaN;
        return !Number.isFinite(trackedAtMs) || trackedAtMs >= sessionStartedAtMs;
      })) {
        const matched = await matchIntendedZonePitch({
          organizationId,
          sessionId,
          trackmanPlayId: pitch.playId,
          plateLocSide: pitch.plateLocSideFt,
          plateLocHeight: pitch.plateLocHeightFt,
          pitchType: pitch.pitchType,
          relSpeed: pitch.relSpeedMph,
          inducedVertBreak: pitch.inducedVertBreakIn,
          horzBreak: pitch.horzBreakIn,
          pitcherThrows: pitch.pitcherThrows,
          taggedPitcherName: pitch.taggedPitcherName,
          thrownAt: pitch.trackedAt,
          targetCreatedBefore: pitch.trackedAt,
        });
        if (matched.ok) alreadyMatchedPlayIds.add(pitch.playId);
      }
    } catch (error) {
      console.error('[intended-zone] webhook buffer read failed:', error);
    }

    // Keep the existing Data API as a fallback/backfill path. This covers
    // any delivery missed while the B1 iPad or webhook endpoint was offline.
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

// POST -> queue the coach's tapped intended target for the next pitch
// (live/ftp_deferred modes), OR -- when { manual: true, actualSideFt,
// actualHeightFt } is included -- record a fully manual pitch in one call:
// both the intended target and the actual landing spot, no TrackMan
// involved at all.
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const body = (await request.json().catch(() => null)) as
    | {
        sessionId?: number;
        intendedSideFt?: number;
        intendedHeightFt?: number;
        targetRadiusFt?: number;
        manual?: boolean;
        actualSideFt?: number;
        actualHeightFt?: number;
        pitchType?: string | null;
        pitcherThrows?: string | null;
      }
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

  if (body.manual) {
    const actualSideFt = Number(body.actualSideFt);
    const actualHeightFt = Number(body.actualHeightFt);
    if (!Number.isFinite(actualSideFt) || !Number.isFinite(actualHeightFt)) {
      return NextResponse.json({ error: 'actualSideFt and actualHeightFt are required for a manual pitch.' }, { status: 400 });
    }
    const result = await recordManualIntendedZonePitch({
      organizationId,
      sessionId,
      intendedSideFt,
      intendedHeightFt,
      targetRadiusFt,
      actualSideFt,
      actualHeightFt,
      pitchType: body.pitchType?.trim() || null,
      pitcherThrows: body.pitcherThrows?.trim() || null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, pitch: result.pitch });
  }

  const result = await queueIntendedZoneTarget({ organizationId, sessionId, intendedSideFt, intendedHeightFt, targetRadiusFt });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, pitchId: result.pitchId, pitchIndex: result.pitchIndex });
}

// DELETE ?pitchId= -> remove a single pitch (used for the manual mode's
// undo right after a mis-tap, or an explicit delete from the pitch log).
export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const url = new URL(request.url);
  const pitchId = Number(url.searchParams.get('pitchId') ?? '0');
  if (!Number.isFinite(pitchId) || pitchId <= 0) return NextResponse.json({ error: 'pitchId is required.' }, { status: 400 });

  const result = await deleteIntendedZonePitch({ organizationId, pitchId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../../lib/programming-scope';
import {
  deleteIntendedZonePitch,
  getPendingIntendedZoneTargetCursor,
  getIntendedZoneSession,
  listIntendedZonePitches,
  matchIntendedZonePitch,
  placeOrMoveIntendedZoneTarget,
  queueIntendedZoneTarget,
  recordManualIntendedZonePitch,
  refreshIntendedZonePitchMetadata,
  setPendingIntendedZoneTargetBallCount,
} from '../../../../../../lib/training-db';
import { getPracticeBalls, getPracticePlays, type TrackmanPitchBall } from '../../../../../../lib/trackman-data-api';
import { listBufferedTrackmanPitches, type TrackmanFlightData } from '../../../../../../lib/trackman-live-webhook';

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
  const syncFallback = url.searchParams.get('fallback') === '1';
  const syncMetadata = syncFallback || url.searchParams.get('metadata') === '1';
  if (!Number.isFinite(sessionId) || sessionId <= 0) return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 });

  const izSession = await getIntendedZoneSession({ organizationId, sessionId });
  if (!izSession) return NextResponse.json({ error: 'Session was not found.' }, { status: 404 });
  const liveFlightByPlayId = new Map<string, TrackmanFlightData>();

  if (izSession.trackmanSessionId) {
    const webhookReceivedAtByPlayId = new Map<string, string>();
    // The B1 webhook feed is the primary live path. Events are persisted as
    // soon as TrackMan pushes them, including when the coach's browser is
    // briefly offline; polling this route only drains that durable buffer.
    try {
      const buffered = await listBufferedTrackmanPitches(izSession.trackmanSessionId);
      for (const pitch of buffered) {
        if (pitch.receivedAt) webhookReceivedAtByPlayId.set(pitch.playId, pitch.receivedAt);
        if (pitch.flightData) liveFlightByPlayId.set(pitch.playId, pitch.flightData);
      }
      const existing = await listIntendedZonePitches({ organizationId, sessionId });
      const existingByPlayId = new Map<string, (typeof existing)[number]>();
      for (const pitch of existing) {
        if (pitch.trackmanPlayId) existingByPlayId.set(pitch.trackmanPlayId, pitch);
      }

      // Refresh a matched row only when the durable webhook buffer actually
      // has newer/corrected measurements or metadata. Previously every poll
      // rewrote every pitch in the TrackMan session.
      for (const pitch of buffered) {
        const current = existingByPlayId.get(pitch.playId);
        if (!current) continue;
        const changed =
          (pitch.plateLocSideFt !== null && (current.plateLocSide === null || Math.abs(pitch.plateLocSideFt - current.plateLocSide) > 0.0001)) ||
          (pitch.plateLocHeightFt !== null && (current.plateLocHeight === null || Math.abs(pitch.plateLocHeightFt - current.plateLocHeight) > 0.0001)) ||
          (pitch.relSpeedMph !== null && (current.relSpeed === null || Math.abs(pitch.relSpeedMph - current.relSpeed) > 0.0001)) ||
          (pitch.inducedVertBreakIn !== null && (current.inducedVertBreak === null || Math.abs(pitch.inducedVertBreakIn - current.inducedVertBreak) > 0.0001)) ||
          (pitch.horzBreakIn !== null && (current.horzBreak === null || Math.abs(pitch.horzBreakIn - current.horzBreak) > 0.0001)) ||
          (pitch.pitchType !== null && pitch.pitchType !== current.pitchType) ||
          (pitch.taggedPitcherName !== null && pitch.taggedPitcherName !== current.taggedPitcherName);
        if (!changed) continue;
        await matchIntendedZonePitch({
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
          targetCreatedBefore: pitch.receivedAt,
        });
      }

      // Match at most the first webhook pitch received after the one active
      // target. Pitches received while no target was active remain skipped.
      const pendingCursor = await getPendingIntendedZoneTargetCursor({ organizationId, sessionId });
      const sessionStartedAtMs = new Date(izSession.startedAt).getTime();
      const targetCreatedAtMs = pendingCursor ? new Date(pendingCursor.createdAt).getTime() : Number.POSITIVE_INFINITY;
      const nextPitch = pendingCursor
        ? buffered.find((pitch) => {
            if (existingByPlayId.has(pitch.playId) || !pitch.receivedAt) return false;
            const receivedAtMs = new Date(pitch.receivedAt).getTime();
            return Number.isFinite(receivedAtMs) && receivedAtMs >= sessionStartedAtMs && receivedAtMs >= targetCreatedAtMs;
          })
        : null;
      if (nextPitch) {
        await matchIntendedZonePitch({
          organizationId,
          sessionId,
          trackmanPlayId: nextPitch.playId,
          plateLocSide: nextPitch.plateLocSideFt,
          plateLocHeight: nextPitch.plateLocHeightFt,
          pitchType: nextPitch.pitchType,
          relSpeed: nextPitch.relSpeedMph,
          inducedVertBreak: nextPitch.inducedVertBreakIn,
          horzBreak: nextPitch.horzBreakIn,
          pitcherThrows: nextPitch.pitcherThrows,
          taggedPitcherName: nextPitch.taggedPitcherName,
          thrownAt: nextPitch.trackedAt,
          targetCreatedBefore: nextPitch.receivedAt,
        });
      }
    } catch (error) {
      console.error('[intended-zone] webhook buffer read failed:', error);
    }

    // Keep the pull API as a throttled fallback/metadata path rather than
    // blocking every four-second webhook refresh on two remote requests.
    if (syncMetadata) {
      try {
        const [balls, plays] = await Promise.all([
          syncFallback ? getPracticeBalls(izSession.trackmanSessionId) : Promise.resolve([]),
          getPracticePlays(izSession.trackmanSessionId),
        ]);
        const playTagById = new Map(plays.map((p) => [p.playID, p]));

        // iPad classifications live in the eventually-consistent Plays feed,
        // not the ball webhook. Refresh them directly by playId so a missing
        // or slow Balls response cannot prevent a label from being applied.
        await refreshIntendedZonePitchMetadata({
          organizationId,
          sessionId,
          plays: plays.map((play) => ({
            playId: play.playID,
            pitchType: play.pitchTag?.taggedPitchType ?? null,
            taggedPitcherName: play.pitcher?.pitcher ?? null,
          })),
        });

        const trackedPitches = balls.filter(isTrackedPitch);
        const existing = await listIntendedZonePitches({ organizationId, sessionId });
        const existingByPlayId = new Map<string, (typeof existing)[number]>();
        for (const pitch of existing) {
          if (pitch.trackmanPlayId) existingByPlayId.set(pitch.trackmanPlayId, pitch);
        }

        // Then consider at most one new ball for the one pending target. A null
        // watermark means the snapshot failed, so Data API matching fails closed
        // and the timestamped webhook remains the only safe live path.
        const pendingCursor = await getPendingIntendedZoneTargetCursor({ organizationId, sessionId });
        if (pendingCursor?.trackmanBallCountAtTarget !== null && pendingCursor?.trackmanBallCountAtTarget !== undefined) {
          for (let trackmanBallIndex = pendingCursor.trackmanBallCountAtTarget; trackmanBallIndex < trackedPitches.length; trackmanBallIndex += 1) {
            const ball = trackedPitches[trackmanBallIndex];
            if (existingByPlayId.has(ball.playId)) continue;
            const location = ball.pitch.location;
            const play = playTagById.get(ball.playId);
            const matched = await matchIntendedZonePitch({
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
              targetCreatedBefore: webhookReceivedAtByPlayId.get(ball.playId) ?? null,
              trackmanBallIndex,
            });
            if (matched.ok) break;
          }
        }
      } catch (error) {
        // Best-effort: if TrackMan is briefly unreachable, still return
        // whatever's already stored rather than failing the whole poll.
        console.error('[intended-zone] poll failed:', error);
      }
    }
  }

  const pitches = await listIntendedZonePitches({ organizationId, sessionId });
  return NextResponse.json({
    session: izSession,
    pitches: pitches.map((pitch) => ({
      ...pitch,
      flightData: pitch.trackmanPlayId ? liveFlightByPlayId.get(pitch.trackmanPlayId) ?? null : null,
    })),
  });
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

// PUT -> immediately place the next live/FTP target, or move that same
// still-unmatched target when the coach taps a different location.
export async function PUT(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });
  const body = (await request.json().catch(() => null)) as {
    sessionId?: number;
    intendedSideFt?: number;
    intendedHeightFt?: number;
    targetRadiusFt?: number;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const sessionId = Number(body.sessionId ?? 0);
  const intendedSideFt = Number(body.intendedSideFt);
  const intendedHeightFt = Number(body.intendedHeightFt);
  const targetRadiusFt = Number(body.targetRadiusFt);
  if (!Number.isFinite(sessionId) || sessionId <= 0 || !Number.isFinite(intendedSideFt) || !Number.isFinite(intendedHeightFt) || !Number.isFinite(targetRadiusFt) || targetRadiusFt <= 0) {
    return NextResponse.json({ error: 'sessionId, intendedSideFt, intendedHeightFt, and targetRadiusFt are required.' }, { status: 400 });
  }

  const izSession = await getIntendedZoneSession({ organizationId, sessionId });
  if (!izSession) return NextResponse.json({ error: 'Session was not found.' }, { status: 404 });

  // Activate the target in our database immediately. Waiting on TrackMan's
  // pull API before inserting used to create a several-second blind spot in
  // which a pitch thrown after the coach's tap looked older than the target.
  const result = await placeOrMoveIntendedZoneTarget({
    organizationId,
    sessionId,
    intendedSideFt,
    intendedHeightFt,
    targetRadiusFt,
    trackmanBallCountAtTarget: null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  if (!result.moved && izSession.mode === 'live' && izSession.trackmanSessionId) {
    try {
      const balls = await getPracticeBalls(izSession.trackmanSessionId);
      await setPendingIntendedZoneTargetBallCount({
        organizationId,
        pitchId: result.pitchId,
        trackmanBallCountAtTarget: balls.filter(isTrackedPitch).length,
      });
    } catch (error) {
      // The timestamped webhook path remains safe. A null watermark makes the
      // Data API fallback fail closed instead of consuming historical pitches.
      console.error('[intended-zone] target watermark snapshot failed:', error);
    }
  }
  return NextResponse.json(result);
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

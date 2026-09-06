import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../../lib/programming-scope';
import {
  deleteIntendedZoneSession,
  endIntendedZoneSession,
  getIntendedZoneSession,
  listIntendedZoneSessionsForPitcher,
  matchIntendedZoneSessionByPitcherAndTime,
  refreshIntendedZonePitchMetadata,
  reopenIntendedZoneSession,
  resetIntendedZoneSessionMatches,
  startIntendedZoneSession,
} from '../../../../../../lib/training-db';
import { discoverPracticeSessions, getPracticePlays } from '../../../../../../lib/trackman-data-api';
import { listLiveTrackmanSessions } from '../../../../../../lib/trackman-live-webhook';

// GET ?pitcherName= -> this pitcher's past intended-zone sessions.
// GET ?discover=1 -> today's TrackMan practice sessions, to pick which one
// a live tracking session should attach to (informational only; a session
// can also be started with no TrackMan session attached yet and linked
// later once the coach knows which one is theirs).
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const url = new URL(request.url);

  if (url.searchParams.get('discover') === '1') {
    const today = new Date();
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 1);
    const liveSessions = await listLiveTrackmanSessions().catch(() => []);
    try {
      const apiSessions = await discoverPracticeSessions({
        startDate: start.toISOString().slice(0, 10),
        endDate: today.toISOString().slice(0, 10),
        sessionType: 'All',
      });
      const liveIds = new Set(liveSessions.map((item) => item.sessionId));
      return NextResponse.json({ sessions: [...liveSessions, ...apiSessions.filter((item) => !liveIds.has(item.sessionId))] });
    } catch (error) {
      if (liveSessions.length) return NextResponse.json({ sessions: liveSessions });
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to reach TrackMan.' },
        { status: 502 }
      );
    }
  }

  const pitcherName = String(url.searchParams.get('pitcherName') ?? '').trim();
  if (!pitcherName) {
    return NextResponse.json({ error: 'pitcherName is required.' }, { status: 400 });
  }
  const sessions = await listIntendedZoneSessionsForPitcher({ organizationId, pitcherName });
  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const body = (await request.json().catch(() => null)) as
    | { pitcherName?: string | null; trackmanSessionId?: string | null; targetRadiusFt?: number; mode?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const targetRadiusFt = Number(body.targetRadiusFt ?? 0.3);
  const result = await startIntendedZoneSession({
    organizationId,
    pitcherName: body.pitcherName?.trim() || null,
    trackmanSessionId: body.trackmanSessionId?.trim() || null,
    targetRadiusFt: Number.isFinite(targetRadiusFt) && targetRadiusFt > 0 ? targetRadiusFt : 0.3,
    startedByUserId: session.userId ?? null,
    mode: body.mode === 'ftp_deferred' || body.mode === 'manual' ? body.mode : 'live',
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const created = await getIntendedZoneSession({ organizationId, sessionId: result.sessionId });
  return NextResponse.json({ ok: true, session: created });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { sessionId?: number; action?: string } | null;
  if (!body || (body.action !== 'end' && body.action !== 'reopen' && body.action !== 'check_ftp_match' && body.action !== 'reset_matches')) {
    return NextResponse.json(
      { error: 'Only { action: "end" }, { action: "reopen" }, { action: "check_ftp_match" }, or { action: "reset_matches" } are supported.' },
      { status: 400 }
    );
  }

  const sessionId = Number(body.sessionId ?? 0);
  if (!Number.isFinite(sessionId) || sessionId <= 0) return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 });

  if (body.action === 'check_ftp_match') {
    const matchResult = await matchIntendedZoneSessionByPitcherAndTime({ organizationId, sessionId });
    if (!matchResult.ok) return NextResponse.json({ error: matchResult.error }, { status: 400 });
    return NextResponse.json({ ok: true, matched: matchResult.matched });
  }

  if (body.action === 'reset_matches') {
    const resetResult = await resetIntendedZoneSessionMatches({ organizationId, sessionId });
    if (!resetResult.ok) return NextResponse.json({ error: resetResult.error }, { status: 400 });
    return NextResponse.json({ ok: true, reset: resetResult.reset });
  }

  if (body.action === 'reopen') {
    const reopenResult = await reopenIntendedZoneSession({ organizationId, sessionId });
    if (!reopenResult.ok) return NextResponse.json({ error: reopenResult.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const currentSession = await getIntendedZoneSession({ organizationId, sessionId });
  if (currentSession?.mode === 'live' && currentSession.trackmanSessionId) {
    try {
      const plays = await getPracticePlays(currentSession.trackmanSessionId);
      await refreshIntendedZonePitchMetadata({
        organizationId,
        sessionId,
        plays: plays.map((play) => ({
          playId: play.playID,
          pitchType: play.pitchTag?.taggedPitchType ?? null,
          taggedPitcherName: play.pitcher?.pitcher ?? null,
        })),
      });
    } catch (error) {
      // Ending a session must remain reliable even if TrackMan is briefly
      // unavailable. The FTP reconciliation will provide the final backup.
      console.error('[intended-zone] final Plays metadata refresh failed:', error);
    }
  }

  const result = await endIntendedZoneSession({ organizationId, sessionId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const url = new URL(request.url);
  const sessionId = Number(url.searchParams.get('sessionId') ?? '0');
  if (!Number.isFinite(sessionId) || sessionId <= 0) return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 });

  const result = await deleteIntendedZoneSession({ organizationId, sessionId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

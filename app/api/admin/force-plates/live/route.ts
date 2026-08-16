import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { canManagePlayer } from '../../../../../lib/portal-access';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { logApiTiming } from '../../../../../lib/request-timing';
import { getPlayerByIdInOrganization, listPlayerChoicesByOrganization } from '../../../../../lib/training-db';
import { fetchValdForceDecksSnapshot } from '../../../../../lib/vald-forceplates';

function toFirstLast(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',').map((part) => part.trim());
  const first = rest.join(' ').trim();
  return first && last ? `${first} ${last}` : raw;
}

function handleValdError(error: unknown, finish: (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => NextResponse) {
  const message = error instanceof Error ? error.message : 'Failed to fetch ForceDecks data.';
  const isValdRateLimit = /429/.test(message) || /rate limit/i.test(message);
  if (isValdRateLimit) {
    return NextResponse.json(
      { error: 'VALD is rate-limiting requests right now -- wait a moment and try again.' },
      { status: 503, headers: { 'retry-after': '60' } }
    );
  }
  return finish(502, { error: message });
}

// Pulls ForceDecks data straight from the VALD API on demand -- no Postgres
// involved at all, so it isn't affected by the sync pipeline's cron/cache
// staleness (the sync writes to Neon separately for roster-wide historical
// reporting; this route exists specifically for "what did this player just
// do" while on-site). Supports two modes: a single player (?playerId=),
// tuned for speed with full trial detail since it's one player; or the
// whole roster (?all=1), which reuses the SAME multi-player code path
// admin/testing/data/route.ts and the Postgres-backed /portal/force-plates
// page already rely on elsewhere in this codebase -- one combined VALD
// request for every player, aggregate/average metrics only, no per-rep
// trial breakdown (trialFetchLimit is already forced to 0 for >1 player
// names by fetchValdForceDecksSnapshot itself), which is what keeps an
// all-roster live fetch from taking as long as N single-player fetches.
export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.force-plates.live.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return finish(400, { error: 'No programming data is configured for this school.' });
  }

  const url = new URL(request.url);
  const wantsAllPlayers = url.searchParams.get('all') === '1';

  if (wantsAllPlayers) {
    const roster = await listPlayerChoicesByOrganization({
      organizationId,
      assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
    });
    const playerNames = Array.from(
      new Set(roster.map((player) => toFirstLast(String(player.fullName ?? '').trim())).filter(Boolean))
    );
    if (!playerNames.length) return finish(404, { error: 'No players found.' });

    try {
      // Same 30-day window as the single-player path -- covers anyone
      // who's tested recently without the recursive-bisection cost a much
      // longer lookback would add across an entire roster at once.
      const snapshot = await fetchValdForceDecksSnapshot(playerNames, {
        lookbackDaysOverride: 30,
        testsWindowDaysOverride: 30,
      });
      return finish(
        200,
        { snapshot },
        { playerCount: playerNames.length, playersWithTests: snapshot.players.filter((p) => p.testsCount > 0).length }
      );
    } catch (error) {
      return handleValdError(error, finish);
    }
  }

  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return finish(400, { error: 'Valid playerId is required.' });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return finish(404, { error: 'Player not found.' });
  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return finish(404, { error: 'Player not found.' });

  const playerName = toFirstLast(String(player.fullName ?? '').trim());
  if (!playerName) return finish(404, { error: 'Player not found.' });

  try {
    // Tighter window than the sync's own default (180 days) -- a live,
    // on-site lookup needs to come back in a few seconds, not the 60-120+
    // seconds a full 180-day/30-day-windowed search with per-test trial
    // fetches took in testing. 30 days covers anyone who's tested recently;
    // a player with nothing in the last 30 days almost certainly hasn't
    // tested on VALD recently at all. testsWindowDaysOverride matches
    // lookbackDaysOverride so the /tests call only needs a single window
    // (no recursive date-bisection) when a player's recent test count is
    // reasonable, which is the common case for one player's last month.
    const snapshot = await fetchValdForceDecksSnapshot([playerName], {
      lookbackDaysOverride: 30,
      testsWindowDaysOverride: 30,
    });
    return finish(
      200,
      { snapshot, playerName },
      { playerId, testsCount: snapshot.players[0]?.testsCount ?? 0 }
    );
  } catch (error) {
    return handleValdError(error, finish);
  }
}

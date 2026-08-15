import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { canManagePlayer } from '../../../../../lib/portal-access';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { logApiTiming } from '../../../../../lib/request-timing';
import { getPlayerByIdInOrganization } from '../../../../../lib/training-db';
import { fetchValdForceDecksSnapshot } from '../../../../../lib/vald-forceplates';

function toFirstLast(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',').map((part) => part.trim());
  const first = rest.join(' ').trim();
  return first && last ? `${first} ${last}` : raw;
}

// Pulls a single player's ForceDecks data straight from the VALD API on
// demand -- no Postgres involved at all, so it isn't affected by the sync
// pipeline's cron/cache staleness (the sync writes to Neon separately for
// roster-wide historical reporting; this route exists specifically for "what
// did this one player just do" while on-site). Reuses the exact live-fetch
// function admin/testing/data/route.ts already calls per-request in
// production, just without threading its result into a custom metrics panel.
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
    const snapshot = await fetchValdForceDecksSnapshot([playerName]);
    return finish(
      200,
      { snapshot, playerName },
      { playerId, testsCount: snapshot.players[0]?.testsCount ?? 0 }
    );
  } catch (error) {
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
}

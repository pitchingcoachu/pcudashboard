import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../../lib/player-content-scope';
import { getPlayerForUser, listPortalNotifications } from '../../../../lib/training-db';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ count: 0, notifications: [] });

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? 15);
  const sinceDays = Number(url.searchParams.get('sinceDays') ?? 30);
  if (session.role === 'player') {
    let playerId = Number(session.playerId ?? 0);
    const userId = Number(session.userId ?? 0);
    if ((!Number.isFinite(playerId) || playerId <= 0) && Number.isFinite(userId) && userId > 0) {
      const player = await getPlayerForUser({ organizationId, userId });
      playerId = Number(player?.id ?? 0);
    }
    if (!Number.isFinite(playerId) || playerId <= 0) return NextResponse.json({ count: 0, notifications: [] });
    const payload = await listPortalNotifications({
      organizationId,
      playerId,
      eventTypes: ['media_uploaded'],
      actorRoles: ['admin', 'coach'],
      mediaTypes: ['photo', 'video'],
      playerPath: '/portal/player',
      limit,
      sinceDays,
    });
    return NextResponse.json(payload);
  }

  if (session.role !== 'admin' && session.role !== 'coach') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const payload = await listPortalNotifications({ organizationId, limit, sinceDays });
  return NextResponse.json(payload);
}

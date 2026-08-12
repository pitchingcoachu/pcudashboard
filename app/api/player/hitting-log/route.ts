import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { readActivityRequestMeta } from '../../../../lib/portal-activity';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { canManagePlayer } from '../../../../lib/portal-access';
import { getPlayerForUser, playerExistsInOrganization, getHittingLogEntries, recordPortalActivityEvent, saveHittingLogEntry } from '../../../../lib/training-db';

async function resolvePlayerId(session: ReturnType<typeof getSessionFromRequest>, requestedPlayerId: number) {
  if (!session) return null;
  const organizationId = await resolveProgrammingOrganizationId(session);
  if (session.role === 'player') {
    const userId = Number(session.userId ?? 0);
    const ownPlayer = userId > 0 ? await getPlayerForUser({ organizationId, userId }) : null;
    return ownPlayer ? Number(ownPlayer.id) : null;
  }
  if ((session.role === 'admin' || session.role === 'coach') && requestedPlayerId > 0) {
    if (session.role === 'coach') {
      const allowed = await canManagePlayer(session, requestedPlayerId);
      if (!allowed) return null;
    }
    const exists = await playerExistsInOrganization({ organizationId, playerId: requestedPlayerId });
    return exists ? requestedPlayerId : null;
  }
  return null;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const organizationId = await resolveProgrammingOrganizationId(session);
  const url = new URL(request.url);
  const requestedPlayerId = Number(url.searchParams.get('playerId') ?? '0');
  const templateId = url.searchParams.get('templateId') ?? undefined;
  const playerId = await resolvePlayerId(session, requestedPlayerId);
  if (!playerId) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });
  const entries = await getHittingLogEntries({ organizationId, playerId, templateId });
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const organizationId = await resolveProgrammingOrganizationId(session);
  const body = (await request.json().catch(() => null)) as {
    playerId?: number;
    templateId?: string;
    hittingDate?: string;
    rowsJson?: Array<Record<string, string>>;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const requestedPlayerId = Number(body.playerId ?? 0);
  const playerId = await resolvePlayerId(session, requestedPlayerId);
  if (!playerId) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });
  const templateId = String(body.templateId ?? '').trim();
  const hittingDate = String(body.hittingDate ?? '').trim();
  if (!templateId || !hittingDate) return NextResponse.json({ error: 'templateId and hittingDate are required.' }, { status: 400 });
  const rowsJson = Array.isArray(body.rowsJson) ? body.rowsJson : [];
  const result = await saveHittingLogEntry({
    organizationId,
    playerId,
    userId: Number(session.userId ?? 0) || null,
    templateId,
    hittingDate,
    rowsJson,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  const { userAgent, ipAddress } = await readActivityRequestMeta(request);
  void recordPortalActivityEvent({
    userId: session.userId ?? null,
    email: session.email,
    name: session.name ?? null,
    role: session.role ?? 'admin',
    organizationId,
    playerId,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    eventType: 'hitting_saved',
    path: '/portal/player/program/hitting',
    metadata: { templateId, hittingDate },
    userAgent,
    ipAddress,
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}

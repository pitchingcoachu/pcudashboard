import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { canManagePlayer } from '../../../../lib/portal-access';
import { getPlayerForUser, playerExistsInOrganization, getBullpenLogEntries, saveBullpenLogEntry } from '../../../../lib/training-db';

async function resolvePlayerId(session: ReturnType<typeof getSessionFromCookies>, requestedPlayerId: number) {
  if (!session) return null;
  const organizationId = resolveProgrammingOrganizationId(session);
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
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const organizationId = resolveProgrammingOrganizationId(session);
  const url = new URL(request.url);
  const requestedPlayerId = Number(url.searchParams.get('playerId') ?? '0');
  const templateId = url.searchParams.get('templateId') ?? undefined;
  const playerId = await resolvePlayerId(session, requestedPlayerId);
  if (!playerId) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });
  const entries = await getBullpenLogEntries({ organizationId, playerId, templateId });
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const organizationId = resolveProgrammingOrganizationId(session);
  const body = (await request.json().catch(() => null)) as {
    playerId?: number;
    templateId?: string;
    bullpenDate?: string;
    rowsJson?: Array<Record<string, string>>;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const requestedPlayerId = Number(body.playerId ?? 0);
  const playerId = await resolvePlayerId(session, requestedPlayerId);
  if (!playerId) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });
  const templateId = String(body.templateId ?? '').trim();
  const bullpenDate = String(body.bullpenDate ?? '').trim();
  if (!templateId || !bullpenDate) return NextResponse.json({ error: 'templateId and bullpenDate are required.' }, { status: 400 });
  const rowsJson = Array.isArray(body.rowsJson) ? body.rowsJson : [];
  const result = await saveBullpenLogEntry({
    organizationId,
    playerId,
    userId: Number(session.userId ?? 0) || null,
    templateId,
    bullpenDate,
    rowsJson,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../../lib/programming-scope';
import { applyScheduleTemplateToPlayer, getPlayerByIdInOrganization } from '../../../../../../lib/training-db';
import { canManagePlayer } from '../../../../../../lib/portal-access';

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; templateId?: number; startDate?: string; programName?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const playerId = Number(body.playerId ?? 0);
  const templateId = Number(body.templateId ?? 0);
  const startDate = parseDate(String(body.startDate ?? ''));
  const organizationId = resolveProgrammingOrganizationId(session);
  const userId = Number(session.userId ?? 0);

  if (organizationId <= 0 || userId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }
  if (!Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(templateId) || templateId <= 0 || !startDate) {
    return NextResponse.json({ error: 'playerId, templateId, and startDate are required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const result = await applyScheduleTemplateToPlayer({
    organizationId,
    userId,
    playerId,
    templateId,
    startDate,
    programName: String(body.programName ?? 'Current Program'),
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

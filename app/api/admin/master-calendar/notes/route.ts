import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { upsertMasterCalendarNote } from '../../../../../lib/training-db';
import { canManagePlayer } from '../../../../../lib/portal-access';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; noteDate?: string; noteText?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  const userId = session.userId ?? 0;
  const playerId = Number(body.playerId ?? 0);
  const noteDate = String(body.noteDate ?? '').trim();
  if (organizationId <= 0 || userId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'playerId is required.' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(noteDate)) {
    return NextResponse.json({ error: 'noteDate must be YYYY-MM-DD.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await upsertMasterCalendarNote({
    organizationId,
    playerId,
    noteDate,
    noteText: String(body.noteText ?? ''),
    userId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

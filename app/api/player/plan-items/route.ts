import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { getPlanSectionNotes, listPlanProgramItemsForPlayer, type ProgramItemRow } from '../../../../lib/training-db';
import { canManagePlayer } from '../../../../lib/portal-access';

// Completion tally (targetCount, completedCount) is coach/admin-only --
// computed unconditionally in training-db.ts, stripped here for player
// sessions so it never reaches the response body at all. Section notes are
// visible to everyone (player-facing, unlike the tally).
function stripCoachOnlyFields(item: ProgramItemRow): ProgramItemRow {
  return { ...item, targetCount: null, completedCount: null };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'playerId is required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const isPlayerSession = session.role === 'player';
  const organizationId = session.organizationId ?? 0;
  const [items, sectionNotes] = await Promise.all([
    listPlanProgramItemsForPlayer({ playerId }),
    getPlanSectionNotes({ organizationId, playerId }),
  ]);

  return NextResponse.json({
    items: isPlayerSession ? items.map(stripCoachOnlyFields) : items,
    sectionNotes,
  });
}

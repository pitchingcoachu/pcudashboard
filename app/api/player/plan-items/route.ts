import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { getPlanSectionNotes, listPlanProgramItemsForPlayer, type ProgramItemRow } from '../../../../lib/training-db';
import { canManagePlayer } from '../../../../lib/portal-access';

// Completion tally (targetCount, completedCount) is coach/admin-only for
// most sections -- computed unconditionally in training-db.ts, stripped
// here for player sessions so it never reaches the response body at all.
// S&C and Post-Throw Arm Care are the exception: players are allowed to see
// their own tally there, per product decision. The "added" date is
// coach/admin-only in every section, no exceptions. Section notes are
// visible to everyone regardless of section (player-facing, unlike these).
const PLAYER_VISIBLE_TALLY_SECTIONS = new Set(['s_and_c', 'post_throw_arm_care']);

function stripCoachOnlyFields(item: ProgramItemRow): ProgramItemRow {
  const tallyVisible = Boolean(item.planSection && PLAYER_VISIBLE_TALLY_SECTIONS.has(item.planSection));
  return {
    ...item,
    targetCount: tallyVisible ? item.targetCount : null,
    completedCount: tallyVisible ? item.completedCount : null,
    planItemAddedAt: null,
  };
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

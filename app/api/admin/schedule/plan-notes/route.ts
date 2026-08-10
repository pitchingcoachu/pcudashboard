import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { getRawPlanSectionNotes, setPlanSectionNote } from '../../../../../lib/training-db';
import { canManagePlayer } from '../../../../../lib/portal-access';

// Returns the RAW per-player override only (no fallback to the org
// default) -- this is what the coach builder's editable note field binds
// to, so an empty box always means "no override," never the merged/
// effective text a player would actually see.
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'playerId is required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sectionNotes = await getRawPlanSectionNotes({ playerId });
  return NextResponse.json({ sectionNotes });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; planSection?: string; noteText?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  const userId = session.userId ?? 0;
  const playerId = Number(body.playerId ?? 0);
  if (organizationId <= 0 || userId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'playerId is required.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await setPlanSectionNote({
    organizationId,
    playerId,
    planSection: String(body.planSection ?? ''),
    noteText: String(body.noteText ?? ''),
    updatedByUserId: userId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

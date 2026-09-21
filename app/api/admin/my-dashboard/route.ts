import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../../lib/player-content-scope';
import {
  deleteCoachDashboardNote,
  getCoachDashboardOverview,
  replaceCoachDashboardPlayers,
  saveCoachDashboardNote,
  saveCoachDashboardMediaCategory,
} from '../../../../lib/coach-dashboard-db';

async function staffContext(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session || session.role === 'player' || !session.userId) return null;
  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (organizationId <= 0) return null;
  return { session, organizationId, ownerUserId: session.userId };
}

export async function GET(request: Request) {
  const context = await staffContext(request);
  if (!context) return NextResponse.json({ error: 'Staff access required.' }, { status: 403 });
  try {
    return NextResponse.json(await getCoachDashboardOverview(context));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load your dashboard.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const context = await staffContext(request);
  if (!context) return NextResponse.json({ error: 'Staff access required.' }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    if (body.action === 'players') {
      const playerIds = Array.isArray(body.playerIds) ? body.playerIds.map(Number) : [];
      await replaceCoachDashboardPlayers({ ...context, playerIds });
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'note') {
      const note = await saveCoachDashboardNote({
        ...context,
        id: Number(body.id) > 0 ? Number(body.id) : undefined,
        category: String(body.category ?? ''), title: String(body.title ?? ''), body: String(body.noteBody ?? ''), pinned: Boolean(body.pinned),
      });
      return NextResponse.json({ ok: true, note });
    }
    if (body.action === 'media_category') {
      const category = await saveCoachDashboardMediaCategory({ ...context, name:String(body.name??'') });
      return NextResponse.json({ ok:true, category });
    }
    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save your dashboard.' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const context = await staffContext(request);
  if (!context) return NextResponse.json({ error: 'Staff access required.' }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get('noteId') ?? 0);
  if (id <= 0) return NextResponse.json({ error: 'noteId is required.' }, { status: 400 });
  return NextResponse.json({ ok: await deleteCoachDashboardNote({ ...context, id }) });
}

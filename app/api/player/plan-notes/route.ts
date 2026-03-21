import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { canManagePlayer } from '../../../../lib/portal-access';
import {
  deleteDashboardPlayerNote,
  createDashboardPlayerNote,
  createPlayerPlanNote,
  getPlayerByIdInOrganization,
  getPlayerForUser,
  listDashboardPlayerNotes,
  listDashboardPlayerNotesByOrganization,
  listPlayerPlanNotesForPlayer,
  updateDashboardPlayerNote,
} from '../../../../lib/training-db';

async function resolveAllowedPlayerId(
  session: { role?: string; organizationId?: number; userId?: number; playerId?: number | null } | null,
  requestedPlayerId: number
) {
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };

  if (session.role === 'player') {
    const organizationId = resolveProgrammingOrganizationId(session);
    const ownPlayer = await getPlayerForUser({
      organizationId,
      userId: session.userId ?? 0,
    });
    const allowed = ownPlayer?.id ?? session.playerId ?? 0;
    if (allowed !== requestedPlayerId) return { ok: false as const, status: 403, error: 'Forbidden' };
    return { ok: true as const, playerId: allowed };
  }

  const allowed = await canManagePlayer(
    session as { role?: 'admin' | 'coach' | 'player'; organizationId?: number; userId?: number; playerId?: number | null },
    requestedPlayerId
  );
  if (!allowed) return { ok: false as const, status: 403, error: 'Forbidden' };
  const organizationId = resolveProgrammingOrganizationId(session);
  const player = await getPlayerByIdInOrganization({
    organizationId,
    playerId: requestedPlayerId,
  });
  if (!player) return { ok: false as const, status: 404, error: 'Player not found.' };
  return { ok: true as const, playerId: player.id };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ notes: [] });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const dashboardPlayerName = String(url.searchParams.get('dashboardPlayerName') ?? '').trim();
  const domain = String(url.searchParams.get('domain') ?? '');
  const normalizedDomain = domain === 'Pitching' || domain === 'Hitting' || domain === 'Catching' || domain === 'General' ? domain : undefined;

  if (dashboardPlayerName) {
    try {
      const notes = await listDashboardPlayerNotes({
        organizationId,
        dashboardPlayerName,
        domain: normalizedDomain,
      });
      return NextResponse.json({ notes });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load notes.' }, { status: 500 });
    }
  }

  if (!Number.isFinite(playerId) || playerId <= 0) {
    try {
      const notes = await listDashboardPlayerNotesByOrganization({
        organizationId,
        domain: normalizedDomain,
      });
      return NextResponse.json({ notes });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load notes.' }, { status: 500 });
    }
  }

  const allowed = await resolveAllowedPlayerId(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const notes = await listPlayerPlanNotesForPlayer({ playerId: allowed.playerId, domain: normalizedDomain });
  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Programming data is not available for this school.' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? 0);
  const dashboardPlayerName = String(body.dashboardPlayerName ?? '').trim();
  const domain = String(body.domain ?? '');
  const noteDate = String(body.noteDate ?? '');
  const category = String(body.category ?? '').trim();
  const noteText = String(body.noteText ?? '');
  const attachmentName = String(body.attachmentName ?? '');
  const attachmentMimeType = String(body.attachmentMimeType ?? '');
  const attachmentDataUrl = String(body.attachmentDataUrl ?? '');

  if (domain !== 'Pitching' && domain !== 'Hitting' && domain !== 'Catching' && domain !== 'General') {
    return NextResponse.json({ error: 'Valid domain is required.' }, { status: 400 });
  }
  if (!category) return NextResponse.json({ error: 'Category is required.' }, { status: 400 });
  if (category.length > 80) return NextResponse.json({ error: 'Category must be 80 characters or fewer.' }, { status: 400 });

  if (dashboardPlayerName) {
    try {
      const created = await createDashboardPlayerNote({
        organizationId,
        dashboardPlayerName,
        domain: domain as 'Pitching' | 'Hitting' | 'Catching' | 'General',
        noteDate,
        category,
        noteText,
        attachmentName,
        attachmentMimeType,
        attachmentDataUrl,
        createdByUserId: session.userId ?? 0,
      });
      if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });
      const notes = await listDashboardPlayerNotes({
        organizationId,
        dashboardPlayerName,
        domain: domain as 'Pitching' | 'Hitting' | 'Catching' | 'General',
      });
      return NextResponse.json({ ok: true, notes });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save note.' }, { status: 500 });
    }
  }

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId or dashboardPlayerName is required.' }, { status: 400 });
  }

  const allowed = await resolveAllowedPlayerId(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const created = await createPlayerPlanNote({
    organizationId,
    playerId: allowed.playerId,
    domain,
    noteDate,
    category,
    noteText,
    attachmentName,
    attachmentMimeType,
    attachmentDataUrl,
    createdByUserId: session.userId ?? 0,
  });
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });

  const notes = await listPlayerPlanNotesForPlayer({ playerId: allowed.playerId, domain });
  return NextResponse.json({ ok: true, notes });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Programming data is not available for this school.' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const noteId = Number(body.noteId ?? 0);
  const noteDate = String(body.noteDate ?? '');
  const category = String(body.category ?? '').trim();
  const noteText = String(body.noteText ?? '');
  const attachmentName = String(body.attachmentName ?? '');
  const attachmentMimeType = String(body.attachmentMimeType ?? '');
  const attachmentDataUrl = String(body.attachmentDataUrl ?? '');

  const updated = await updateDashboardPlayerNote({
    organizationId,
    noteId,
    noteDate,
    category,
    noteText,
    attachmentName,
    attachmentMimeType,
    attachmentDataUrl,
  });
  if (!updated.ok) return NextResponse.json({ error: updated.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Programming data is not available for this school.' }, { status: 403 });

  const url = new URL(request.url);
  const noteId = Number(url.searchParams.get('noteId') ?? '0');
  const deleted = await deleteDashboardPlayerNote({
    organizationId,
    noteId,
  });
  if (!deleted.ok) return NextResponse.json({ error: deleted.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

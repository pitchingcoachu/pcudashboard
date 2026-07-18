import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { readActivityRequestMeta } from '../../../../lib/portal-activity';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { canManagePlayer } from '../../../../lib/portal-access';
import {
  deleteDashboardPlayerNote,
  deletePlayerPlanNote,
  createDashboardPlayerNote,
  createPlayerPlanNote,
  getPlayerByIdInOrganization,
  getPlayerForUser,
  listPlayerPlanNoteCategoriesByOrganization,
  listDashboardPlayerNotes,
  listDashboardPlayerNotesByOrganization,
  listPlayerSummariesByOrganization,
  listPlayerPlanNotesForPlayer,
  recordPortalActivityEvent,
  updateDashboardPlayerNote,
  updatePlayerPlanNote,
} from '../../../../lib/training-db';

function withAuthorPrefix(rawText: string, authorName: string): string {
  const body = String(rawText ?? '').trim();
  const author = String(authorName ?? '').trim() || 'Unknown';
  const withoutExistingPrefix = body.replace(/^Created By:\s.*(?:\r?\n){1,2}/i, '');
  return `Created By: ${author}\n\n${withoutExistingPrefix}`.trim();
}

async function recordNoteNotification(request: Request, input: {
  session: NonNullable<ReturnType<typeof getSessionFromCookies>>;
  organizationId: number;
  playerId?: number | null;
  playerName?: string | null;
  dashboardPlayerName?: string | null;
  domain: string;
  category: string;
}) {
  const { userAgent, ipAddress } = await readActivityRequestMeta(request);
  const playerId = Number(input.playerId ?? 0);
  await recordPortalActivityEvent({
    userId: input.session.userId ?? null,
    email: input.session.email,
    name: input.session.name ?? null,
    role: input.session.role ?? 'admin',
    organizationId: input.organizationId,
    playerId: Number.isFinite(playerId) && playerId > 0 ? playerId : null,
    dashboardSchoolCode: input.session.dashboardSchoolCode ?? null,
    eventType: 'note_added',
    path: playerId > 0 ? `/portal/player?previewPlayerId=${playerId}` : '/profiles',
    metadata: {
      playerId: playerId > 0 ? playerId : undefined,
      playerName: input.playerName ?? undefined,
      dashboardPlayerName: input.dashboardPlayerName ?? undefined,
      domain: input.domain,
      category: input.category,
    },
    userAgent,
    ipAddress,
  }).catch(() => {});
}

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
      const categories = await listPlayerPlanNoteCategoriesByOrganization({ organizationId, domain: normalizedDomain });
      return NextResponse.json({ notes, categories });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load notes.' }, { status: 500 });
    }
  }

  if (!Number.isFinite(playerId) || playerId <= 0) {
    try {
      const dashboardNotes = await listDashboardPlayerNotesByOrganization({
        organizationId,
        domain: normalizedDomain,
      });
      const playerRows = await listPlayerSummariesByOrganization({
        organizationId,
        assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
      });
      const playerNoteGroups = await Promise.all(
        playerRows.map(async (player) => ({
          playerName: player.fullName,
          notes: await listPlayerPlanNotesForPlayer({ playerId: player.playerId, domain: normalizedDomain }),
        }))
      );
      const playerNotes = playerNoteGroups.flatMap((group) =>
        group.notes.map((note) => ({
          ...note,
          dashboardPlayerName: group.playerName,
        }))
      );
      const notes = [...dashboardNotes, ...playerNotes].sort((a, b) => {
        const byDate = String(b.noteDate ?? '').localeCompare(String(a.noteDate ?? ''));
        if (byDate !== 0) return byDate;
        return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
      });
      const categories = await listPlayerPlanNoteCategoriesByOrganization({ organizationId, domain: normalizedDomain });
      return NextResponse.json({ notes, categories });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load notes.' }, { status: 500 });
    }
  }

  const allowed = await resolveAllowedPlayerId(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const [notes, categories] = await Promise.all([
    listPlayerPlanNotesForPlayer({ playerId: allowed.playerId, domain: normalizedDomain }),
    listPlayerPlanNoteCategoriesByOrganization({ organizationId, domain: normalizedDomain }),
  ]);
  return NextResponse.json({ notes, categories });
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
  const authoredNoteText = withAuthorPrefix(noteText, String(session.name ?? session.email ?? '').trim());

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
        noteText: authoredNoteText,
        attachmentName,
        attachmentMimeType,
        attachmentDataUrl,
        createdByUserId: session.userId ?? 0,
      });
      if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });
      await recordNoteNotification(request, {
        session,
        organizationId,
        dashboardPlayerName,
        domain,
        category,
      });
      const [notes, categories] = await Promise.all([
        listDashboardPlayerNotes({
          organizationId,
          dashboardPlayerName,
          domain: domain as 'Pitching' | 'Hitting' | 'Catching' | 'General',
        }),
        listPlayerPlanNoteCategoriesByOrganization({ organizationId, domain: domain as 'Pitching' | 'Hitting' | 'Catching' | 'General' }),
      ]);
      return NextResponse.json({ ok: true, notes, categories });
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
    noteText: authoredNoteText,
    attachmentName,
    attachmentMimeType,
    attachmentDataUrl,
    createdByUserId: session.userId ?? 0,
  });
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });
  const player = await getPlayerByIdInOrganization({ organizationId, playerId: allowed.playerId });
  await recordNoteNotification(request, {
    session,
    organizationId,
    playerId: allowed.playerId,
    playerName: player?.fullName ?? null,
    domain,
    category,
  });

  const [notes, categories] = await Promise.all([
    listPlayerPlanNotesForPlayer({ playerId: allowed.playerId, domain }),
    listPlayerPlanNoteCategoriesByOrganization({ organizationId, domain }),
  ]);
  return NextResponse.json({ ok: true, notes, categories });
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
  const playerId = Number(body.playerId ?? 0);
  const noteDate = String(body.noteDate ?? '');
  const category = String(body.category ?? '').trim();
  const noteText = String(body.noteText ?? '');
  const attachmentName = String(body.attachmentName ?? '');
  const attachmentMimeType = String(body.attachmentMimeType ?? '');
  const attachmentDataUrl = String(body.attachmentDataUrl ?? '');
  const authoredNoteText = withAuthorPrefix(noteText, String(session.name ?? session.email ?? '').trim());

  if (Number.isFinite(playerId) && playerId > 0) {
    const allowed = await resolveAllowedPlayerId(session, playerId);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
    const updated = await updatePlayerPlanNote({
      organizationId,
      playerId: allowed.playerId,
      noteId,
      noteDate,
      category,
      noteText: authoredNoteText,
      attachmentName,
      attachmentMimeType,
      attachmentDataUrl,
    });
    if (!updated.ok) return NextResponse.json({ error: updated.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const updated = await updateDashboardPlayerNote({
    organizationId,
    noteId,
    noteDate,
    category,
    noteText: authoredNoteText,
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
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (Number.isFinite(playerId) && playerId > 0) {
    const allowed = await resolveAllowedPlayerId(session, playerId);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
    const deleted = await deletePlayerPlanNote({
      organizationId,
      playerId: allowed.playerId,
      noteId,
    });
    if (!deleted.ok) return NextResponse.json({ error: deleted.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const deleted = await deleteDashboardPlayerNote({
    organizationId,
    noteId,
  });
  if (!deleted.ok) return NextResponse.json({ error: deleted.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

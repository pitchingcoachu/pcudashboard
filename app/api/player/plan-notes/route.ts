import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { readActivityRequestMeta } from '../../../../lib/portal-activity';
import { resolvePlayerContentOrganizationId } from '../../../../lib/player-content-scope';
import { sendPushNotificationToUsers } from '../../../../lib/push-notifications';
import {
  deleteDashboardPlayerNote,
  deletePlayerPlanNote,
  createDashboardPlayerNote,
  createPlayerPlanNote,
  getPlayerByIdInOrganization,
  getPlayerForUser,
  getPlayerNotificationContext,
  getPlayerPlanNoteById,
  linkMediaToNote,
  listMediaForNotes,
  listPlayerPlanNoteCategoriesByOrganization,
  listDashboardPlayerNotes,
  listDashboardPlayerNotesByOrganization,
  listPlayerSummariesByOrganization,
  listPlayerPlanNotesForPlayer,
  notifyPlayerForStaffActivity,
  notifyStaffForPlayerActivity,
  recordPortalActivityEvent,
  updateDashboardPlayerNote,
  updatePlayerPlanNote,
  type PlayerPlanNoteRow,
} from '../../../../lib/training-db';

async function withNoteAttachments(notes: PlayerPlanNoteRow[]) {
  const mediaByNote = await listMediaForNotes(notes.map((note) => note.id));
  return notes.map((note) => ({ ...note, attachments: mediaByNote.get(note.id) ?? [] }));
}

function withAuthorPrefix(rawText: string, authorName: string): string {
  const body = String(rawText ?? '').trim();
  const author = String(authorName ?? '').trim() || 'Unknown';
  const withoutExistingPrefix = body.replace(/^Created By:\s.*(?:\r?\n){1,2}/i, '');
  return `Created By: ${author}\n\n${withoutExistingPrefix}`.trim();
}

async function recordNoteNotification(request: Request, input: {
  session: NonNullable<ReturnType<typeof getSessionFromRequest>>;
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

/** A player added a note about themselves -- notify every coach/admin at their school. */
async function notifyStaffForPlayerNote(request: Request, input: {
  session: NonNullable<ReturnType<typeof getSessionFromRequest>>;
  organizationId: number;
  playerId: number;
  playerName: string | null;
  domain: string;
  category: string;
}) {
  await recordNoteNotification(request, input);
  const context = await getPlayerNotificationContext({ organizationId: input.organizationId, playerId: input.playerId });
  const actorName = String(input.session.name ?? input.session.email ?? '').trim() || 'A player';
  const recipients = await notifyStaffForPlayerActivity({
    schoolCode: context?.schoolCode ?? null,
    excludeUserId: input.session.userId ?? null,
    eventType: 'note_added',
    title: 'Player note added',
    detail: `${actorName} added a note${input.category ? ` (${input.category})` : ''}`,
    path: `/portal/player?previewPlayerId=${input.playerId}`,
    actorUserId: input.session.userId ?? null,
    actorName,
    actorRole: 'player',
    playerId: input.playerId,
    playerName: input.playerName,
  }).catch(() => []);
  if (recipients.length > 0) {
    await sendPushNotificationToUsers({
      userIds: recipients,
      title: 'Player note added',
      body: `${actorName} added a note${input.playerName ? ` for ${input.playerName}` : ''}`,
      data: { path: `/portal/player?previewPlayerId=${input.playerId}` },
    });
  }
}

/** Staff added/edited a note about a player -- notify the player themselves if it's marked visible to them. */
async function notifyPlayerForStaffNote(request: Request, input: {
  session: NonNullable<ReturnType<typeof getSessionFromRequest>>;
  organizationId: number;
  playerId: number;
  playerName: string | null;
  domain: string;
  category: string;
  playerVisible: boolean;
}) {
  await recordNoteNotification(request, input);
  if (!input.playerVisible) return;
  const context = await getPlayerNotificationContext({ organizationId: input.organizationId, playerId: input.playerId });
  const actorName = String(input.session.name ?? input.session.email ?? '').trim() || 'Your coach';
  const recipients = await notifyPlayerForStaffActivity({
    playerUserId: context?.userId ?? null,
    eventType: 'note_added',
    title: 'New note from your coach',
    detail: `${actorName} added a note${input.category ? ` (${input.category})` : ''}`,
    path: `/portal/player?previewPlayerId=${input.playerId}`,
    actorUserId: input.session.userId ?? null,
    actorName,
    actorRole: input.session.role ?? 'coach',
    playerId: input.playerId,
    playerName: input.playerName,
  }).catch(() => []);
  if (recipients.length > 0) {
    await sendPushNotificationToUsers({
      userIds: recipients,
      title: 'New note from your coach',
      body: `${actorName} added a note`,
      data: { path: `/portal/player?previewPlayerId=${input.playerId}` },
    });
  }
}

async function resolveAllowedPlayerId(
  session: { role?: string; organizationId?: number; userId?: number; playerId?: number | null } | null,
  requestedPlayerId: number,
  organizationId: number
) {
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return { ok: false as const, status: 403, error: 'Player content is not available for this organization.' };
  }

  if (session.role === 'player') {
    const ownPlayer = await getPlayerForUser({
      organizationId,
      userId: session.userId ?? 0,
    });
    const allowed = ownPlayer?.id ?? session.playerId ?? 0;
    if (allowed !== requestedPlayerId) return { ok: false as const, status: 403, error: 'Forbidden' };
    return { ok: true as const, playerId: allowed };
  }

  const player = await getPlayerByIdInOrganization({
    organizationId,
    playerId: requestedPlayerId,
  });
  if (!player) return { ok: false as const, status: 404, error: 'Player not found.' };
  return { ok: true as const, playerId: player.id };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ notes: [] });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const dashboardPlayerName = String(url.searchParams.get('dashboardPlayerName') ?? '').trim();
  const domain = String(url.searchParams.get('domain') ?? '');
  const normalizedDomain = domain === 'Pitching' || domain === 'Hitting' || domain === 'Catching' || domain === 'General' ? domain : undefined;

  if (session.role === 'player') {
    if (!Number.isFinite(playerId) || playerId <= 0) return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
    const allowed = await resolveAllowedPlayerId(session, playerId, organizationId);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
    const rawNotes = await listPlayerPlanNotesForPlayer({ organizationId, playerId: allowed.playerId, domain: normalizedDomain });
    // Players only ever see their own notes plus staff notes explicitly marked visible to them.
    const visibleNotes = rawNotes.filter((note) => note.playerVisible || note.createdByUserId === (session.userId ?? -1));
    const notes = await withNoteAttachments(visibleNotes);
    return NextResponse.json({ notes, categories: [] });
  }

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
          notes: await listPlayerPlanNotesForPlayer({ organizationId, playerId: player.playerId, domain: normalizedDomain }),
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

  const allowed = await resolveAllowedPlayerId(session, playerId, organizationId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const [rawNotes, categories] = await Promise.all([
    listPlayerPlanNotesForPlayer({ organizationId, playerId: allowed.playerId, domain: normalizedDomain }),
    listPlayerPlanNoteCategoriesByOrganization({ organizationId, domain: normalizedDomain }),
  ]);
  const notes = await withNoteAttachments(rawNotes);
  return NextResponse.json({ notes, categories });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const organizationId = await resolvePlayerContentOrganizationId(session);
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
  const playerVisible = Boolean(body.playerVisible);
  const mediaIds = Array.isArray(body.mediaIds)
    ? body.mediaIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    : [];
  const authoredNoteText = withAuthorPrefix(noteText, String(session.name ?? session.email ?? '').trim());

  if (domain !== 'Pitching' && domain !== 'Hitting' && domain !== 'Catching' && domain !== 'General') {
    return NextResponse.json({ error: 'Valid domain is required.' }, { status: 400 });
  }
  if (!category) return NextResponse.json({ error: 'Category is required.' }, { status: 400 });
  if (category.length > 80) return NextResponse.json({ error: 'Category must be 80 characters or fewer.' }, { status: 400 });

  if (session.role === 'player') {
    if (!Number.isFinite(playerId) || playerId <= 0) return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
    const allowed = await resolveAllowedPlayerId(session, playerId, organizationId);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

    const created = await createPlayerPlanNote({
      organizationId,
      playerId: allowed.playerId,
      domain,
      noteDate,
      category,
      // Matches coach/admin-authored notes: prefixed with "Created By: {name}"
      // so authorship is visible wherever the raw note text is displayed.
      noteText: authoredNoteText,
      attachmentName,
      attachmentMimeType,
      attachmentDataUrl,
      // Players can never hide their own notes from staff.
      playerVisible: true,
      createdByUserId: session.userId ?? 0,
    });
    if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });
    if (mediaIds.length > 0) await linkMediaToNote({ noteId: created.id, mediaIds });
    const player = await getPlayerByIdInOrganization({ organizationId, playerId: allowed.playerId });
    await notifyStaffForPlayerNote(request, {
      session,
      organizationId,
      playerId: allowed.playerId,
      playerName: player?.fullName ?? null,
      domain,
      category,
    });

    const rawNotes = await listPlayerPlanNotesForPlayer({ organizationId, playerId: allowed.playerId, domain });
    const visibleNotes = rawNotes.filter((note) => note.playerVisible || note.createdByUserId === (session.userId ?? -1));
    const notes = await withNoteAttachments(visibleNotes);
    return NextResponse.json({ ok: true, notes, categories: [] });
  }

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

  const allowed = await resolveAllowedPlayerId(session, playerId, organizationId);
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
    playerVisible,
    createdByUserId: session.userId ?? 0,
  });
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });
  if (mediaIds.length > 0) await linkMediaToNote({ noteId: created.id, mediaIds });
  const player = await getPlayerByIdInOrganization({ organizationId, playerId: allowed.playerId });
  await notifyPlayerForStaffNote(request, {
    session,
    organizationId,
    playerId: allowed.playerId,
    playerName: player?.fullName ?? null,
    domain,
    category,
    playerVisible,
  });

  const [rawNotes, categories] = await Promise.all([
    listPlayerPlanNotesForPlayer({ organizationId, playerId: allowed.playerId, domain }),
    listPlayerPlanNoteCategoriesByOrganization({ organizationId, domain }),
  ]);
  const notes = await withNoteAttachments(rawNotes);
  return NextResponse.json({ ok: true, notes, categories });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const organizationId = await resolvePlayerContentOrganizationId(session);
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
  const playerVisible = typeof body.playerVisible === 'boolean' ? body.playerVisible : undefined;
  const authoredNoteText = withAuthorPrefix(noteText, String(session.name ?? session.email ?? '').trim());

  if (session.role === 'player') {
    // Players may only edit their own notes, and can never hide a note from staff.
    if (!Number.isFinite(playerId) || playerId <= 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const allowed = await resolveAllowedPlayerId(session, playerId, organizationId);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
    const existing = await getPlayerPlanNoteById({ organizationId, playerId: allowed.playerId, noteId });
    if (!existing || existing.createdByUserId !== (session.userId ?? -1)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
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
      playerVisible: true,
    });
    if (!updated.ok) return NextResponse.json({ error: updated.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (Number.isFinite(playerId) && playerId > 0) {
    const allowed = await resolveAllowedPlayerId(session, playerId, organizationId);
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
      playerVisible,
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
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Programming data is not available for this school.' }, { status: 403 });

  const url = new URL(request.url);
  const noteId = Number(url.searchParams.get('noteId') ?? '0');
  const playerId = Number(url.searchParams.get('playerId') ?? '0');

  if (session.role === 'player') {
    if (!Number.isFinite(playerId) || playerId <= 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const allowed = await resolveAllowedPlayerId(session, playerId, organizationId);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
    const existing = await getPlayerPlanNoteById({ organizationId, playerId: allowed.playerId, noteId });
    if (!existing || existing.createdByUserId !== (session.userId ?? -1)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const deleted = await deletePlayerPlanNote({ organizationId, playerId: allowed.playerId, noteId });
    if (!deleted.ok) return NextResponse.json({ error: deleted.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (Number.isFinite(playerId) && playerId > 0) {
    const allowed = await resolveAllowedPlayerId(session, playerId, organizationId);
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

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import {
  createPlayerGroup,
  deletePlayerGroup,
  getPlayerGroupWithMembers,
  listPlayerGroups,
  renamePlayerGroup,
  setPlayerGroupMembers,
} from '../../../../lib/training-db';

// Player groups are coach/admin-only, end to end -- there is deliberately no
// /api/player/player-groups route, and every handler below 403s the player
// role before touching the database.

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }

  const url = new URL(request.url);
  const groupIdRaw = Number(url.searchParams.get('groupId') ?? '0');
  if (Number.isFinite(groupIdRaw) && groupIdRaw > 0) {
    const group = await getPlayerGroupWithMembers({ organizationId, groupId: groupIdRaw });
    if (!group) return NextResponse.json({ error: 'Group not found.' }, { status: 404 });
    return NextResponse.json({ group });
  }

  const groups = await listPlayerGroups({ organizationId });
  return NextResponse.json({ groups });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: string; playerIds?: number[] };
  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'Group name is required.' }, { status: 400 });

  const created = await createPlayerGroup({ organizationId, name, createdByUserId: session.userId ?? 0 });
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });

  const playerIds = Array.isArray(body.playerIds) ? body.playerIds.map(Number).filter((id) => Number.isFinite(id) && id > 0) : [];
  if (playerIds.length > 0) {
    const membersResult = await setPlayerGroupMembers({ organizationId, groupId: created.groupId, playerIds });
    if (!membersResult.ok) return NextResponse.json({ error: membersResult.error }, { status: 400 });
  }

  const group = await getPlayerGroupWithMembers({ organizationId, groupId: created.groupId });
  return NextResponse.json({ ok: true, group });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { groupId?: number; name?: string; playerIds?: number[] };
  const groupId = Number(body.groupId ?? 0);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return NextResponse.json({ error: 'groupId is required.' }, { status: 400 });
  }

  if (typeof body.name === 'string') {
    const renamed = await renamePlayerGroup({ organizationId, groupId, name: body.name });
    if (!renamed.ok) return NextResponse.json({ error: renamed.error }, { status: 400 });
  }

  if (Array.isArray(body.playerIds)) {
    const playerIds = body.playerIds.map(Number).filter((id) => Number.isFinite(id) && id > 0);
    const membersResult = await setPlayerGroupMembers({ organizationId, groupId, playerIds });
    if (!membersResult.ok) return NextResponse.json({ error: membersResult.error }, { status: 400 });
  }

  const group = await getPlayerGroupWithMembers({ organizationId, groupId });
  if (!group) return NextResponse.json({ error: 'Group not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, group });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }

  const url = new URL(request.url);
  const groupId = Number(url.searchParams.get('groupId') ?? '0');
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return NextResponse.json({ error: 'groupId is required.' }, { status: 400 });
  }

  const result = await deletePlayerGroup({ organizationId, groupId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

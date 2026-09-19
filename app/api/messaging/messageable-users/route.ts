import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { findActiveMessageUserByEmail, listMessageablePlayersForOrganization, listMessageableUsersAcrossOrganizations } from '../../../../lib/messaging-db';
import { listCoachesByOrganization } from '../../../../lib/training-db';
import { COMPANY_MESSAGING_OWNER_EMAIL, isCompanyMessagingOwner } from '../../../../lib/messaging-access';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const organizationId = Number(session.organizationId ?? 0);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'No organization found for session.' }, { status: 403 });
  }

  if (isCompanyMessagingOwner(session)) {
    const directory = (await listMessageableUsersAcrossOrganizations()).filter((user) => user.userId !== (session.userId ?? -1));
    return NextResponse.json({
      players: directory.filter((user) => user.role === 'player').map((user) => ({
        userId: user.userId,
        playerId: user.playerId,
        fullName: user.name,
        organizationId: user.organizationId,
        organizationName: user.organizationName,
      })),
      coaches: directory.filter((user) => user.role !== 'player').map((user) => ({
        userId: user.userId,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: user.organizationName,
      })),
    });
  }

  const coaches = await listCoachesByOrganization(organizationId);
  // listCoachesByOrganization's userId can come back as a string at runtime
  // despite being typed as number (see identical note in
  // conversations/route.ts) -- coerce before comparing against session.userId.
  const coachOptions = coaches
    .filter((coach) => coach.isActive)
    .filter((c) => Number(c.userId) !== (session.userId ?? -1))
    .map((c) => ({ userId: Number(c.userId), name: c.name, role: c.role, organizationId }));

  if (session.role === 'player') {
    return NextResponse.json({ coaches: coachOptions });
  }

  if (session.role === 'coach' || session.role === 'admin') {
    const [players, companyOwner] = await Promise.all([
      listMessageablePlayersForOrganization(organizationId),
      findActiveMessageUserByEmail(COMPANY_MESSAGING_OWNER_EMAIL),
    ]);
    const companyOwnerOption = companyOwner && companyOwner.userId !== (session.userId ?? -1) && !coachOptions.some((coach) => coach.userId === companyOwner.userId)
      ? [{ userId: companyOwner.userId, name: companyOwner.name, role: companyOwner.role, organizationId: companyOwner.organizationId, organizationName: 'Pearl Player Development', isCompanyOwner: true }]
      : [];
    return NextResponse.json({
      players: players.map((p) => ({ userId: p.userId, playerId: p.playerId, fullName: p.fullName })),
      coaches: [...companyOwnerOption, ...coachOptions],
    });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

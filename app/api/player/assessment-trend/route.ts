import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../../lib/player-content-scope';
import { getPlayerByIdInOrganization, listPlayerAssessmentSeries } from '../../../../lib/training-db';

async function requireStaffSession(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if (session.role === 'player') return { ok: false as const, status: 403, error: 'Only coaches and admins can view assessment trends.' };
  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (organizationId <= 0) return { ok: false as const, status: 403, error: 'Programming data is not available for this school.' };
  return { ok: true as const, session, organizationId };
}

export async function GET(request: Request) {
  const scope = await requireStaffSession(request);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const fieldId = String(url.searchParams.get('fieldId') ?? '').trim();
  if (!Number.isFinite(playerId) || playerId <= 0) return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  if (!fieldId) return NextResponse.json({ error: 'fieldId is required.' }, { status: 400 });

  const player = await getPlayerByIdInOrganization({ organizationId: scope.organizationId, playerId });
  if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });

  const series = await listPlayerAssessmentSeries({ organizationId: scope.organizationId, playerId, fieldId });
  return NextResponse.json({ series });
}

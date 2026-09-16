import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveManageablePlayerOrganizationId } from '../../../../../lib/portal-access';
import { getNutritionStreakForPlayer } from '../../../../../lib/training-db';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const organizationId = await resolveManageablePlayerOrganizationId(session, playerId);
  if (!organizationId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const streak = await getNutritionStreakForPlayer({ playerId });
  return NextResponse.json({ streak });
}

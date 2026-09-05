import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveManageablePlayerOrganizationId } from '../../../../../lib/portal-access';
import { getNutritionTarget, setNutritionTarget } from '../../../../../lib/training-db';

async function ensurePlayerAccess(session: { role?: string; organizationId?: number; userId?: number; playerId?: number | null } | null, playerId: number) {
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const organizationId = await resolveManageablePlayerOrganizationId(session, playerId);
  if (!organizationId) return { ok: false as const, status: 403, error: 'Forbidden' };
  return { ok: true as const, playerId, organizationId };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await ensurePlayerAccess(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const target = await getNutritionTarget({ playerId: allowed.playerId });
  return NextResponse.json({ target });
}

// No coach-only gate here on purpose -- a player can set their own target
// just as readily as a coach managing them can, per the product decision
// that nutrition targets aren't coach-exclusive the way some other training
// targets are.
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? 0);
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await ensurePlayerAccess(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const result = await setNutritionTarget({
    playerId: allowed.playerId,
    calories: body.calories != null ? Number(body.calories) : null,
    proteinG: body.proteinG != null ? Number(body.proteinG) : null,
    carbsG: body.carbsG != null ? Number(body.carbsG) : null,
    fatG: body.fatG != null ? Number(body.fatG) : null,
    setByUserId: session.userId ?? 0,
    setByRole: session.role ?? 'unknown',
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const target = await getNutritionTarget({ playerId: allowed.playerId });
  return NextResponse.json({ ok: true, target });
}

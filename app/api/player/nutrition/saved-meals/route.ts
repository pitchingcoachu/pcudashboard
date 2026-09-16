import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveManageablePlayerOrganizationId } from '../../../../../lib/portal-access';
import { createSavedMeal, deleteSavedMeal, listSavedMealsForPlayer, type SavedMealItemInput } from '../../../../../lib/training-db';

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

  const meals = await listSavedMealsForPlayer({ playerId: allowed.playerId });
  return NextResponse.json({ meals });
}

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

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: SavedMealItemInput[] = rawItems
    .map((item) => (typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}))
    .map((item) => ({
      foodName: String(item.foodName ?? ''),
      brandName: item.brandName != null ? String(item.brandName) : null,
      servingDescription: item.servingDescription != null ? String(item.servingDescription) : null,
      quantity: item.quantity != null ? Number(item.quantity) : null,
      calories: item.calories != null ? Number(item.calories) : null,
      proteinG: item.proteinG != null ? Number(item.proteinG) : null,
      carbsG: item.carbsG != null ? Number(item.carbsG) : null,
      fatG: item.fatG != null ? Number(item.fatG) : null,
      externalFoodId: item.externalFoodId != null ? String(item.externalFoodId) : null,
    }))
    .filter((item) => item.foodName.trim().length > 0);

  const result = await createSavedMeal({
    playerId: allowed.playerId,
    createdByUserId: session.userId ?? 0,
    name: String(body.name ?? ''),
    items,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const meals = await listSavedMealsForPlayer({ playerId: allowed.playerId });
  return NextResponse.json({ ok: true, savedMealId: result.savedMealId, meals });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const savedMealId = Number(url.searchParams.get('savedMealId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(savedMealId) || savedMealId <= 0) {
    return NextResponse.json({ error: 'Valid playerId and savedMealId are required.' }, { status: 400 });
  }

  const allowed = await ensurePlayerAccess(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const result = await deleteSavedMeal({ playerId: allowed.playerId, savedMealId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const meals = await listSavedMealsForPlayer({ playerId: allowed.playerId });
  return NextResponse.json({ ok: true, meals });
}

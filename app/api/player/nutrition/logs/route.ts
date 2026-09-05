import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveManageablePlayerOrganizationId } from '../../../../../lib/portal-access';
import { deleteNutritionLog, listNutritionLogsForPlayer, upsertNutritionLog } from '../../../../../lib/training-db';

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

  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  const logs = await listNutritionLogsForPlayer({ playerId: allowed.playerId, startDate, endDate });
  return NextResponse.json({ logs });
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

  const logIdRaw = Number(body.logId ?? 0);
  const result = await upsertNutritionLog({
    playerId: allowed.playerId,
    loggedByUserId: session.userId ?? 0,
    logDate: String(body.logDate ?? ''),
    logId: Number.isFinite(logIdRaw) && logIdRaw > 0 ? logIdRaw : null,
    mealLabel: body.mealLabel != null ? String(body.mealLabel) : null,
    calories: body.calories != null ? Number(body.calories) : null,
    proteinG: body.proteinG != null ? Number(body.proteinG) : null,
    carbsG: body.carbsG != null ? Number(body.carbsG) : null,
    fatG: body.fatG != null ? Number(body.fatG) : null,
    notes: body.notes != null ? String(body.notes) : null,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const logs = await listNutritionLogsForPlayer({ playerId: allowed.playerId });
  return NextResponse.json({ ok: true, logId: result.logId, logs });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const logId = Number(url.searchParams.get('logId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(logId) || logId <= 0) {
    return NextResponse.json({ error: 'Valid playerId and logId are required.' }, { status: 400 });
  }

  const allowed = await ensurePlayerAccess(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const result = await deleteNutritionLog({ playerId: allowed.playerId, logId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const logs = await listNutritionLogsForPlayer({ playerId: allowed.playerId });
  return NextResponse.json({ ok: true, logs });
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { getPlayerByIdInOrganization, getPlayerForUser, upsertExerciseLog } from '../../../../lib/training-db';

function redirectWithMessage(request: Request, target: string, params: Record<string, string>) {
  const url = new URL(target, request.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url), 303);
  }

  const form = await request.formData();
  const itemId = Number(String(form.get('itemId') ?? '0'));
  const playerId = Number(String(form.get('playerId') ?? '0'));
  const month = String(form.get('month') ?? '');
  const previewPlayerId = String(form.get('previewPlayerId') ?? '');
  const performedLoadValues = form
    .getAll('performedLoadValues')
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);
  const performedLoadCombined = performedLoadValues.join(', ');

  if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(playerId) || playerId <= 0) {
    return redirectWithMessage(request, '/portal/player', { error: 'Invalid log payload.' });
  }

  const role = session.role === 'player' ? 'player' : 'admin';
  let allowedPlayerId: number | null = null;

  if (role === 'player') {
    const ownPlayer = await getPlayerForUser({
      organizationId: session.organizationId ?? 0,
      userId: session.userId ?? 0,
    });
    allowedPlayerId = ownPlayer?.id ?? session.playerId ?? null;
    if (allowedPlayerId !== playerId) {
      return redirectWithMessage(request, '/portal/player', { error: 'You can only log your own program.' });
    }
  }

  if (role === 'admin') {
    const player = await getPlayerByIdInOrganization({
      organizationId: session.organizationId ?? 0,
      playerId,
    });
    if (!player) {
      return redirectWithMessage(request, '/portal/admin/clients', { error: 'Player not found in your organization.' });
    }
    allowedPlayerId = player.id;
  }

  if (!allowedPlayerId) {
    return redirectWithMessage(request, '/portal/player', { error: 'Unable to resolve player access.' });
  }

  try {
    await upsertExerciseLog({
      playerId: allowedPlayerId,
      itemId,
      loggedByUserId: session.userId ?? 0,
      completed: form.get('completed') === 'on',
      performedSets: String(form.get('performedSets') ?? ''),
      performedReps: String(form.get('performedReps') ?? ''),
      performedLoad: performedLoadCombined || String(form.get('performedLoad') ?? ''),
      notes: String(form.get('notes') ?? ''),
    });
  } catch (error) {
    return redirectWithMessage(request, '/portal/player', {
      error: error instanceof Error ? error.message : 'Could not save log.',
    });
  }

  const redirectParams: Record<string, string> = { ok: 'Training log saved.' };
  if (/^\d{4}-\d{2}$/.test(month)) redirectParams.month = month;
  if (role === 'admin' && /^\d+$/.test(previewPlayerId)) redirectParams.previewPlayerId = previewPlayerId;

  return redirectWithMessage(request, '/portal/player', redirectParams);
}

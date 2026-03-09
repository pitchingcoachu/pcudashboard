import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { getPlayerByIdInOrganization, getPlayerForUser, upsertExerciseLog } from '../../../../../lib/training-db';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await request.formData();
  const itemId = Number(String(form.get('itemId') ?? '0'));
  const playerId = Number(String(form.get('playerId') ?? '0'));
  const performedLoadValues = form
    .getAll('performedLoadValues')
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);
  const performedLoadCombined = performedLoadValues.join(', ');

  if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Invalid log payload.' }, { status: 400 });
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
      return NextResponse.json({ error: 'You can only log your own program.' }, { status: 403 });
    }
  }

  if (role === 'admin') {
    const player = await getPlayerByIdInOrganization({
      organizationId: session.organizationId ?? 0,
      playerId,
    });
    if (!player) return NextResponse.json({ error: 'Player not found in your organization.' }, { status: 404 });
    allowedPlayerId = player.id;
  }

  if (!allowedPlayerId) return NextResponse.json({ error: 'Unable to resolve player access.' }, { status: 400 });

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
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save log.' }, { status: 400 });
  }
}

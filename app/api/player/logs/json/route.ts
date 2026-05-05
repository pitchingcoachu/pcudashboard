import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { upsertExerciseLog } from '../../../../../lib/training-db';
import { canManagePlayer } from '../../../../../lib/portal-access';

const ASSESSMENT_NOTES_TOKEN = '[ASSESSMENT_NOTES]';

function parseBodyWeightSetValues(form: FormData): string[] {
  const raw = form
    .getAll('performedBodyWeightSetValues')
    .map((value) => String(value).trim())
    .filter((value) => /^\d+:[01]$/.test(value));
  if (!raw.length) return [];

  const bySet = new Map<number, number>();
  for (const entry of raw) {
    const [setIndexRaw, checkedRaw] = entry.split(':');
    const setIndex = Number(setIndexRaw);
    const checked = Number(checkedRaw);
    if (!Number.isFinite(setIndex) || setIndex < 0) continue;
    const prior = bySet.get(setIndex) ?? 0;
    bySet.set(setIndex, Math.max(prior, checked === 1 ? 1 : 0));
  }

  return Array.from(bySet.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, checked]) => String(checked));
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await request.formData();
  const itemId = Number(String(form.get('itemId') ?? '0'));
  const playerId = Number(String(form.get('playerId') ?? '0'));
  const scheduleType = String(form.get('scheduleType') ?? 'calendar').trim().toLowerCase() === 'cycle' ? 'cycle' : 'calendar';
  const performedLoadValues = form
    .getAll('performedLoadValues')
    .map((value) => String(value).trim());
  const assessmentScoreValues = form
    .getAll('assessmentScoreValues')
    .map((value) => String(value).trim())
    .map((value) => (value === '1' || value === '2' || value === '3' ? value : ''));
  const assessmentNoteValues = form
    .getAll('assessmentNoteValues')
    .map((value) => String(value).trim());
  const bodyWeightSetValues = parseBodyWeightSetValues(form);
  const baseLoadValues =
    assessmentScoreValues.length > 0 ? assessmentScoreValues : bodyWeightSetValues.length > 0 ? bodyWeightSetValues : performedLoadValues;
  const performedLoadCombined = baseLoadValues.join(', ');
  const baseNotes = String(form.get('notes') ?? '').trim();
  const hasAssessmentNotes = assessmentNoteValues.some((value) => value.length > 0);
  const notes = hasAssessmentNotes
    ? `${baseNotes}\n${ASSESSMENT_NOTES_TOKEN}${JSON.stringify(assessmentNoteValues)}`
    : baseNotes;

  if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Invalid log payload.' }, { status: 400 });
  }

  const allowed = await canManagePlayer(session, playerId);
  if (!allowed) {
    return NextResponse.json({ error: 'You do not have access to log this player.' }, { status: 403 });
  }
  const allowedPlayerId = playerId;

  if (!allowedPlayerId) return NextResponse.json({ error: 'Unable to resolve player access.' }, { status: 400 });

  try {
    await upsertExerciseLog({
      playerId: allowedPlayerId,
      itemId,
      scheduleType,
      loggedByUserId: session.userId ?? 0,
      completed: form.get('completed') === 'on',
      performedSets: String(form.get('performedSets') ?? ''),
      performedReps: String(form.get('performedReps') ?? ''),
      performedLoad: performedLoadCombined || String(form.get('performedLoad') ?? ''),
      notes,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save log.' }, { status: 400 });
  }
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { upsertExerciseLog } from '../../../../../lib/training-db';
import { canManagePlayer } from '../../../../../lib/portal-access';

const ASSESSMENT_NOTES_TOKEN = '[ASSESSMENT_NOTES]';

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
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);
  const assessmentScoreValues = form
    .getAll('assessmentScoreValues')
    .map((value) => String(value).trim())
    .filter((value) => value === '1' || value === '2' || value === '3');
  const assessmentNoteValues = form
    .getAll('assessmentNoteValues')
    .map((value) => String(value).trim());
  const performedLoadCombined = (assessmentScoreValues.length > 0 ? assessmentScoreValues : performedLoadValues).join(', ');
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

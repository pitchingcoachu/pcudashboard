import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { upsertExerciseLog } from '../../../../../lib/training-db';
import { canManagePlayer } from '../../../../../lib/portal-access';

const ASSESSMENT_NOTES_TOKEN = '[ASSESSMENT_NOTES]';

function parseIndexedLoadValues(form: FormData): string[] {
  const raw = form
    .getAll('performedLoadValuesIndexed')
    .map((value) => String(value));
  if (raw.length === 0) return [];

  const byIndex = new Map<number, string>();
  let maxIndex = -1;
  for (const entry of raw) {
    const colon = entry.indexOf(':');
    if (colon <= 0) continue;
    const index = Number(entry.slice(0, colon));
    if (!Number.isFinite(index) || index < 0) continue;
    const value = entry.slice(colon + 1).trim();
    byIndex.set(index, value);
    if (index > maxIndex) maxIndex = index;
  }
  if (maxIndex < 0) return [];

  return Array.from({ length: maxIndex + 1 }, (_, idx) => byIndex.get(idx) ?? '');
}

function parseBodyWeightSetValues(form: FormData): Map<number, '0' | '1'> {
  const raw = form
    .getAll('performedBodyWeightSetValues')
    .map((value) => String(value).trim())
    .filter((value) => /^\d+:[01]$/.test(value));
  if (!raw.length) return new Map();

  const bySet = new Map<number, number>();
  for (const entry of raw) {
    const [setIndexRaw, checkedRaw] = entry.split(':');
    const setIndex = Number(setIndexRaw);
    const checked = Number(checkedRaw);
    if (!Number.isFinite(setIndex) || setIndex < 0) continue;
    const prior = bySet.get(setIndex) ?? 0;
    bySet.set(setIndex, Math.max(prior, checked === 1 ? 1 : 0));
  }

  const out = new Map<number, '0' | '1'>();
  for (const [setIndex, checked] of bySet.entries()) {
    out.set(setIndex, checked === 1 ? '1' : '0');
  }
  return out;
}

function mergeLoadValues(performedLoadValues: string[], bodyWeightSetValues: Map<number, '0' | '1'>): string[] {
  if (bodyWeightSetValues.size === 0) return performedLoadValues;
  const maxBodyIndex = Math.max(...Array.from(bodyWeightSetValues.keys()));
  const maxLen = Math.max(performedLoadValues.length, maxBodyIndex + 1);
  const merged = Array.from({ length: maxLen }, (_, idx) => performedLoadValues[idx] ?? '');
  for (const [setIndex, checkedValue] of bodyWeightSetValues.entries()) {
    if (setIndex >= 0) merged[setIndex] = checkedValue;
  }
  return merged;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await request.formData();
  const itemId = Number(String(form.get('itemId') ?? '0'));
  const playerId = Number(String(form.get('playerId') ?? '0'));
  const scheduleType = String(form.get('scheduleType') ?? 'calendar').trim().toLowerCase() === 'cycle' ? 'cycle' : 'calendar';
  const performedLoadValuesIndexed = parseIndexedLoadValues(form);
  const performedLoadValues =
    performedLoadValuesIndexed.length > 0
      ? performedLoadValuesIndexed
      : form.getAll('performedLoadValues').map((value) => String(value).trim());
  const assessmentScoreValues = form
    .getAll('assessmentScoreValues')
    .map((value) => String(value).trim())
    .map((value) => (value === '1' || value === '2' || value === '3' ? value : ''));
  const assessmentNoteValues = form
    .getAll('assessmentNoteValues')
    .map((value) => String(value).trim());
  const bodyWeightSetValues = parseBodyWeightSetValues(form);
  const mergedLoadValues = mergeLoadValues(performedLoadValues, bodyWeightSetValues);
  const baseLoadValues = assessmentScoreValues.length > 0 ? assessmentScoreValues : mergedLoadValues;
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

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { readActivityRequestMeta } from '../../../../../lib/portal-activity';
import { recordPortalActivityEvent, upsertExerciseLog } from '../../../../../lib/training-db';
import { canManagePlayer } from '../../../../../lib/portal-access';

const ASSESSMENT_NOTES_TOKEN = '[ASSESSMENT_NOTES]';

type JsonLogPayload = {
  itemId?: number | string;
  playerId?: number | string;
  scheduleType?: string;
  completed?: boolean;
  performedSets?: string;
  performedReps?: string;
  performedLoad?: string;
  notes?: string;
};

// Simple field-value accessor so the same downstream logic works whether the
// request body was multipart/form-data (web) or application/json (mobile).
type FieldSource = { get(name: string): string | null };

function fieldSourceFromJson(payload: JsonLogPayload): FieldSource {
  return {
    get(name: string) {
      const value = (payload as Record<string, unknown>)[name];
      if (value === undefined || value === null) return null;
      if (typeof value === 'boolean') return value ? 'on' : '';
      return String(value);
    },
  };
}

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
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const contentType = request.headers.get('content-type') ?? '';
  const isJsonBody = contentType.includes('application/json');

  let fields: FieldSource;
  let performedLoadCombined = '';
  let notes = '';

  if (isJsonBody) {
    const payload = (await request.json().catch(() => ({}))) as JsonLogPayload;
    fields = fieldSourceFromJson(payload);
    performedLoadCombined = String(payload.performedLoad ?? '').trim();
    notes = String(payload.notes ?? '').trim();
  } else {
    const form = await request.formData();
    fields = { get: (name: string) => (typeof form.get(name) === 'string' ? (form.get(name) as string) : null) };
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
    performedLoadCombined = baseLoadValues.join(', ');
    const baseNotes = String(form.get('notes') ?? '').trim();
    const hasAssessmentNotes = assessmentNoteValues.some((value) => value.length > 0);
    notes = hasAssessmentNotes
      ? `${baseNotes}\n${ASSESSMENT_NOTES_TOKEN}${JSON.stringify(assessmentNoteValues)}`
      : baseNotes;
  }

  const itemId = Number(String(fields.get('itemId') ?? '0'));
  const playerId = Number(String(fields.get('playerId') ?? '0'));
  const scheduleTypeRaw = String(fields.get('scheduleType') ?? 'calendar').trim().toLowerCase();
  const scheduleType = scheduleTypeRaw === 'cycle' ? 'cycle' : scheduleTypeRaw === 'plan' ? 'plan' : 'calendar';

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
      completed: fields.get('completed') === 'on',
      performedSets: String(fields.get('performedSets') ?? ''),
      performedReps: String(fields.get('performedReps') ?? ''),
      performedLoad: performedLoadCombined || String(fields.get('performedLoad') ?? ''),
      notes,
    });
    const { userAgent, ipAddress } = await readActivityRequestMeta(request);
    void recordPortalActivityEvent({
      userId: session.userId ?? null,
      email: session.email,
      name: session.name ?? null,
      role: session.role ?? 'admin',
      organizationId: session.organizationId ?? null,
      playerId: allowedPlayerId,
      dashboardSchoolCode: session.dashboardSchoolCode ?? null,
      eventType: 'workout_logged',
      path: '/portal/player',
      metadata: { itemId, scheduleType },
      userAgent,
      ipAddress,
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save log.' }, { status: 400 });
  }
}

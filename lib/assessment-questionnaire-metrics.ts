/** Shared value-normalization helpers for charting Player Assessment and
 * Questionnaire answers. Type-only imports from training-db.ts keep this
 * file safe to import from client components (training-db.ts itself pulls
 * in server-only modules via auth-db.ts). */
import { PLAYER_ASSESSMENT_FIELDS, type PlayerAssessmentField } from './player-assessment-fields';
import type { QuestionnaireQuestion } from './training-db';

export function chartableAssessmentFields(): PlayerAssessmentField[] {
  return PLAYER_ASSESSMENT_FIELDS.filter((field) => field.type === 'number_in' || field.type === 'number_sec');
}

export function numericValueForAssessmentAnswer(rawValue: string | undefined): number | null {
  const parsed = Number(String(rawValue ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function isChartableQuestionnaireQuestion(question: QuestionnaireQuestion): boolean {
  return question.type === 'number' || question.type === 'scale' || question.type === 'yes_no';
}

/** Best-effort extraction of a decimal number from free text (e.g. a
 * response saved back when a question was still type 'text'). Used only as
 * a fallback so legacy answers aren't dropped when a question is later
 * converted to a chartable type (e.g. the "hours of sleep" question). */
export function parseLegacyNumericText(rawValue: string | undefined): number | null {
  const match = String(rawValue ?? '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function numericValueForQuestionnaireAnswer(question: QuestionnaireQuestion, rawValue: string | undefined): number | null {
  const raw = String(rawValue ?? '').trim();
  if (!raw) return null;
  if (question.type === 'number' || question.type === 'scale') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
    return question.type === 'scale' ? parseLegacyNumericText(raw) : null;
  }
  if (question.type === 'yes_no') {
    if (raw === 'Yes') return 1;
    if (raw === 'No') return 0;
    return null;
  }
  return null;
}

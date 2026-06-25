'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PendingQuestionnaireRow, QuestionnaireQuestion } from '../../../lib/training-db';

type Props = {
  playerId: number;
};

function answerIsFilled(question: QuestionnaireQuestion, value: string | undefined): boolean {
  if (question.type === 'scale') return true;
  const trimmed = String(value ?? '').trim();
  if (question.type === 'text') return trimmed.length > 0;
  return trimmed.length > 0;
}

export default function PlayerQuestionnaireGate({ playerId }: Props) {
  const [pending, setPending] = useState<PendingQuestionnaireRow[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const current = pending[0] ?? null;
  const complete = useMemo(() => {
    if (!current) return true;
    return current.questions.every((question) => answerIsFilled(question, answers[question.id]));
  }, [answers, current]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/player/questionnaires?playerId=${playerId}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load questionnaires.');
        setPending(Array.isArray(payload.pending) ? payload.pending : []);
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Failed to load questionnaires.');
      });
    return () => controller.abort();
  }, [playerId]);

  useEffect(() => {
    setAnswers({});
    setError('');
  }, [current?.assignmentId, current?.dueDate]);

  async function save() {
    if (!current || !complete) {
      setError('Answer every question before saving.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/player/questionnaires', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          assignmentId: current.assignmentId,
          questionnaireId: current.questionnaireId,
          dueDate: current.dueDate,
          answers: Object.fromEntries(
            current.questions.map((question) => [question.id, answers[question.id] ?? (question.type === 'scale' ? String(question.scaleMin) : '')])
          ),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save questionnaire.');
      setPending(Array.isArray(payload.pending) ? payload.pending : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save questionnaire.');
    } finally {
      setSaving(false);
    }
  }

  if (!current) return null;

  return (
    <div className="portal-questionnaire-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="player-questionnaire-title">
      <div className="portal-questionnaire-modal">
        <div>
          <p className="portal-questionnaire-kicker">Required Questionnaire</p>
          <h2 id="player-questionnaire-title">{current.questionnaireName}</h2>
          <p>
            {current.groupName ? `${current.groupName} | ` : ''}Due {current.dueDate}
          </p>
        </div>
        <div className="portal-questionnaire-modal-questions">
          {current.questions.map((question, index) => (
            <label className="portal-inline-filter" key={question.id}>
              {index + 1}. {question.prompt}
              {question.type === 'text' ? (
                <textarea value={answers[question.id] ?? ''} onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))} rows={3} />
              ) : null}
              {question.type === 'number' ? (
                <input type="number" value={answers[question.id] ?? ''} onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))} />
              ) : null}
              {question.type === 'yes_no' ? (
                <select value={answers[question.id] ?? ''} onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))}>
                  <option value="">Select</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              ) : null}
              {question.type === 'multiple_choice' ? (
                <select value={answers[question.id] ?? ''} onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))}>
                  <option value="">Select</option>
                  {question.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : null}
              {question.type === 'scale' ? (
                <input
                  type="range"
                  min={question.scaleMin}
                  max={question.scaleMax}
                  value={answers[question.id] ?? String(question.scaleMin)}
                  onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))}
                />
              ) : null}
              {question.type === 'scale' ? <span>{answers[question.id] ?? String(question.scaleMin)}</span> : null}
            </label>
          ))}
        </div>
        {error ? <p className="portal-questionnaire-message portal-questionnaire-message--error">{error}</p> : null}
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !complete}>
          {saving ? 'Saving...' : 'Save Questionnaire'}
        </button>
      </div>
    </div>
  );
}

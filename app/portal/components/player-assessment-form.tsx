'use client';

import { PLAYER_ASSESSMENT_FIELDS, PLAYER_ASSESSMENT_SCALE_OPTIONS } from '../../../lib/player-assessment-fields';

export type PlayerAssessmentAnswers = Record<string, string>;

const UNIT_SUFFIX: Record<string, string> = { number_in: 'in', number_sec: 'sec' };

export function PlayerAssessmentForm({
  answers,
  onChange,
  disabled = false,
}: {
  answers: PlayerAssessmentAnswers;
  onChange: (next: PlayerAssessmentAnswers) => void;
  disabled?: boolean;
}) {
  const setField = (id: string, value: string) => onChange({ ...answers, [id]: value });

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {PLAYER_ASSESSMENT_FIELDS.map((field) => (
        <label key={field.id} className="portal-inline-filter" style={{ display: 'grid', gap: 4 }}>
          {field.label}
          {field.type === 'text' ? (
            <input
              value={answers[field.id] ?? ''}
              disabled={disabled}
              onChange={(event) => setField(field.id, event.target.value)}
            />
          ) : field.type === 'scale' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {PLAYER_ASSESSMENT_SCALE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={disabled}
                  className={answers[field.id] === option ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => setField(field.id, option)}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={answers[field.id] ?? ''}
                disabled={disabled}
                onChange={(event) => setField(field.id, event.target.value)}
                style={{ maxWidth: 140 }}
              />
              <span className="portal-muted-text">{UNIT_SUFFIX[field.type]}</span>
            </div>
          )}
        </label>
      ))}
    </div>
  );
}

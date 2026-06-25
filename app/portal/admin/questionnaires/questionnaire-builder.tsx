'use client';

import { useMemo, useState } from 'react';
import type { QuestionnaireResponseRow, QuestionnaireRow, QuestionnaireQuestionType } from '../../../../lib/training-db';

type PlayerOption = {
  id: number;
  name: string;
};

type QuestionDraft = {
  id: string;
  prompt: string;
  type: QuestionnaireQuestionType;
  optionsText: string;
  scaleMin: number;
  scaleMax: number;
};

type AssignmentDraft = {
  groupName: string;
  playerIds: number[];
  notifyStartDate: string;
  frequency: 'once' | 'daily' | 'weekly' | 'monthly';
};

type Props = {
  players: PlayerOption[];
  initialQuestionnaires: QuestionnaireRow[];
  initialResponses: QuestionnaireResponseRow[];
};

const QUESTION_TYPES: Array<{ value: QuestionnaireQuestionType; label: string }> = [
  { value: 'text', label: 'Text box' },
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'scale', label: 'Scale' },
  { value: 'number', label: 'Number' },
  { value: 'yes_no', label: 'Yes / No' },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function newQuestion(): QuestionDraft {
  return {
    id: `q-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    prompt: '',
    type: 'text',
    optionsText: '',
    scaleMin: 1,
    scaleMax: 10,
  };
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function QuestionnaireBuilder({ players, initialQuestionnaires, initialResponses }: Props) {
  const [name, setName] = useState('');
  const [questions, setQuestions] = useState<QuestionDraft[]>([newQuestion()]);
  const [assignment, setAssignment] = useState<AssignmentDraft>({
    groupName: '',
    playerIds: [],
    notifyStartDate: todayIso(),
    frequency: 'once',
  });
  const [questionnaires, setQuestionnaires] = useState(initialQuestionnaires);
  const [responses, setResponses] = useState(initialResponses);
  const [filterQuestionnaireId, setFilterQuestionnaireId] = useState('');
  const [filterPlayerId, setFilterPlayerId] = useState('');
  const [filterGroupName, setFilterGroupName] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [message, setMessage] = useState('');

  const selectedAll = assignment.playerIds.length > 0 && assignment.playerIds.length === players.length;
  const groupNames = useMemo(
    () =>
      Array.from(new Set(questionnaires.flatMap((questionnaire) => questionnaire.assignments.map((row) => row.groupName).filter(Boolean)))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [questionnaires]
  );

  const questionnaireById = useMemo(() => new Map(questionnaires.map((questionnaire) => [questionnaire.id, questionnaire])), [questionnaires]);

  function updateQuestion(index: number, patch: Partial<QuestionDraft>) {
    setQuestions((previous) => previous.map((question, idx) => (idx === index ? { ...question, ...patch } : question)));
  }

  function togglePlayer(playerId: number) {
    setAssignment((previous) => {
      const next = new Set(previous.playerIds);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return { ...previous, playerIds: Array.from(next) };
    });
  }

  async function refreshResponses(nextFilters?: { questionnaireId?: string; playerId?: string; groupName?: string }) {
    const questionnaireId = nextFilters?.questionnaireId ?? filterQuestionnaireId;
    const playerId = nextFilters?.playerId ?? filterPlayerId;
    const groupName = nextFilters?.groupName ?? filterGroupName;
    const params = new URLSearchParams();
    if (questionnaireId) params.set('questionnaireId', questionnaireId);
    if (playerId) params.set('playerId', playerId);
    if (groupName) params.set('groupName', groupName);
    setLoadingResponses(true);
    setMessage('');
    try {
      const response = await fetch(`/api/admin/questionnaires?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load questionnaires.');
      setQuestionnaires(Array.isArray(payload.questionnaires) ? payload.questionnaires : []);
      setResponses(Array.isArray(payload.responses) ? payload.responses : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load responses.');
    } finally {
      setLoadingResponses(false);
    }
  }

  async function saveQuestionnaire() {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        name,
        questions: questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          type: question.type,
          options: question.optionsText
            .split('\n')
            .map((option) => option.trim())
            .filter(Boolean),
          scaleMin: question.scaleMin,
          scaleMax: question.scaleMax,
        })),
        assignments: [assignment],
      };
      const response = await fetch('/api/admin/questionnaires', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Failed to save questionnaire.');
      setQuestionnaires(Array.isArray(result.questionnaires) ? result.questionnaires : []);
      setResponses(Array.isArray(result.responses) ? result.responses : []);
      setName('');
      setQuestions([newQuestion()]);
      setAssignment({ groupName: '', playerIds: [], notifyStartDate: todayIso(), frequency: 'once' });
      setMessage('Questionnaire saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save questionnaire.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="portal-questionnaire-layout">
      <article className="portal-admin-card portal-questionnaire-builder-card">
        <h3>Build Questionnaire</h3>
        <label className="portal-inline-filter">
          Questionnaire Name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Daily Readiness" />
        </label>

        <div className="portal-questionnaire-section">
          <div className="portal-questionnaire-section-head">
            <h4>Questions</h4>
            <button type="button" className="btn btn-ghost" onClick={() => setQuestions((previous) => [...previous, newQuestion()])}>
              Add Question
            </button>
          </div>
          {questions.map((question, index) => (
            <div className="portal-question-card" key={question.id}>
              <label className="portal-inline-filter">
                Question {index + 1}
                <textarea
                  value={question.prompt}
                  onChange={(event) => updateQuestion(index, { prompt: event.target.value })}
                  placeholder="How does your arm feel today?"
                  rows={2}
                />
              </label>
              <div className="portal-testing-grid-2">
                <label className="portal-inline-filter">
                  Answer Type
                  <select
                    value={question.type}
                    onChange={(event) => updateQuestion(index, { type: event.target.value as QuestionnaireQuestionType })}
                  >
                    {QUESTION_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setQuestions((previous) => previous.filter((_, idx) => idx !== index))}
                  disabled={questions.length <= 1}
                >
                  Remove
                </button>
              </div>
              {question.type === 'multiple_choice' ? (
                <label className="portal-inline-filter">
                  Multiple Choice Options (one per line)
                  <textarea value={question.optionsText} onChange={(event) => updateQuestion(index, { optionsText: event.target.value })} rows={3} />
                </label>
              ) : null}
              {question.type === 'scale' ? (
                <div className="portal-testing-grid-2">
                  <label className="portal-inline-filter">
                    Scale Min
                    <input type="number" value={question.scaleMin} onChange={(event) => updateQuestion(index, { scaleMin: Number(event.target.value) })} />
                  </label>
                  <label className="portal-inline-filter">
                    Scale Max
                    <input type="number" value={question.scaleMax} onChange={(event) => updateQuestion(index, { scaleMax: Number(event.target.value) })} />
                  </label>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="portal-questionnaire-section">
          <h4>Who Gets Notified</h4>
          <div className="portal-testing-grid-2">
            <label className="portal-inline-filter">
              Group Name
              <input value={assignment.groupName} onChange={(event) => setAssignment((previous) => ({ ...previous, groupName: event.target.value }))} placeholder="Starters" />
            </label>
            <label className="portal-inline-filter">
              Notify Starting
              <input
                type="date"
                value={assignment.notifyStartDate}
                onChange={(event) => setAssignment((previous) => ({ ...previous, notifyStartDate: event.target.value }))}
              />
            </label>
            <label className="portal-inline-filter">
              Frequency
              <select
                value={assignment.frequency}
                onChange={(event) => setAssignment((previous) => ({ ...previous, frequency: event.target.value as AssignmentDraft['frequency'] }))}
              >
                <option value="once">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setAssignment((previous) => ({ ...previous, playerIds: selectedAll ? [] : players.map((player) => player.id) }))}
            >
              {selectedAll ? 'Clear Players' : 'Select All Players'}
            </button>
          </div>
          <div className="portal-questionnaire-player-list">
            {players.map((player) => (
              <label key={player.id} className="portal-questionnaire-player-option">
                <input type="checkbox" checked={assignment.playerIds.includes(player.id)} onChange={() => togglePlayer(player.id)} />
                <span>{player.name}</span>
              </label>
            ))}
          </div>
        </div>

        {message ? <p className="portal-questionnaire-message">{message}</p> : null}
        <button type="button" className="btn btn-primary" onClick={saveQuestionnaire} disabled={saving}>
          {saving ? 'Saving...' : 'Save Questionnaire'}
        </button>
      </article>

      <article className="portal-admin-card portal-questionnaire-results-card">
        <h3>Filled Out Questionnaires</h3>
        <div className="portal-questionnaire-filters">
          <label className="portal-inline-filter">
            Questionnaire
            <select
              value={filterQuestionnaireId}
              onChange={(event) => {
                setFilterQuestionnaireId(event.target.value);
                void refreshResponses({ questionnaireId: event.target.value });
              }}
            >
              <option value="">All</option>
              {questionnaires.map((questionnaire) => (
                <option key={questionnaire.id} value={String(questionnaire.id)}>
                  {questionnaire.name}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-inline-filter">
            Player
            <select
              value={filterPlayerId}
              onChange={(event) => {
                setFilterPlayerId(event.target.value);
                void refreshResponses({ playerId: event.target.value });
              }}
            >
              <option value="">All</option>
              {players.map((player) => (
                <option key={player.id} value={String(player.id)}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-inline-filter">
            Group
            <select
              value={filterGroupName}
              onChange={(event) => {
                setFilterGroupName(event.target.value);
                void refreshResponses({ groupName: event.target.value });
              }}
            >
              <option value="">All</option>
              {groupNames.map((groupName) => (
                <option key={groupName} value={groupName}>
                  {groupName}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loadingResponses ? <p>Loading responses...</p> : null}
        <div className="portal-questionnaire-response-list">
          {responses.length === 0 ? <p>No questionnaires have been filled out for these filters.</p> : null}
          {responses.map((response) => {
            const questionnaire = questionnaireById.get(response.questionnaireId);
            const questionsForResponse = questionnaire?.questions ?? [];
            return (
              <div className="portal-questionnaire-response" key={response.id}>
                <div>
                  <h4>{response.questionnaireName}</h4>
                  <p>
                    {response.playerName}
                    {response.groupName ? ` | ${response.groupName}` : ''} | Due {shortDate(response.dueDate)} | Submitted{' '}
                    {shortDate(response.submittedAt)}
                  </p>
                </div>
                <div className="portal-questionnaire-answer-grid">
                  {questionsForResponse.map((question) => (
                    <div key={question.id}>
                      <strong>{question.prompt}</strong>
                      <span>{response.answers[question.id] || '-'}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </article>
    </div>
  );
}

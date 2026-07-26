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
  id?: number;
  groupName: string;
  playerIds: number[];
  notifyStartDate: string;
  frequency: 'once' | 'daily' | 'weekly' | 'monthly';
};

type Props = {
  players: PlayerOption[];
  initialQuestionnaires: QuestionnaireRow[];
  initialResponses: QuestionnaireResponseRow[];
  viewerRole: string;
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

function newAssignment(): AssignmentDraft {
  return {
    groupName: '',
    playerIds: [],
    notifyStartDate: todayIso(),
    frequency: 'once',
  };
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function QuestionnaireBuilder({
  players,
  initialQuestionnaires,
  initialResponses,
  viewerRole,
}: Props) {
  const [name, setName] = useState('');
  const [questions, setQuestions] = useState<QuestionDraft[]>([newQuestion()]);
  const [assignments, setAssignments] = useState<AssignmentDraft[]>([newAssignment()]);
  const [questionnaires, setQuestionnaires] = useState(initialQuestionnaires);
  const [responses, setResponses] = useState(initialResponses);
  const [filterQuestionnaireId, setFilterQuestionnaireId] = useState('');
  const [filterPlayerId, setFilterPlayerId] = useState('');
  const [filterGroupName, setFilterGroupName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingQuestionnaireId, setDeletingQuestionnaireId] = useState<number | null>(null);
  const [editingQuestionnaireId, setEditingQuestionnaireId] = useState<number | null>(null);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [message, setMessage] = useState('');

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

  function updateAssignment(index: number, patch: Partial<AssignmentDraft>) {
    setAssignments((previous) => previous.map((assignment, idx) => (idx === index ? { ...assignment, ...patch } : assignment)));
  }

  function togglePlayer(assignmentIndex: number, playerId: number) {
    setAssignments((previous) => previous.map((assignment, index) => {
      if (index !== assignmentIndex) return assignment;
      const next = new Set(assignment.playerIds);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return { ...assignment, playerIds: Array.from(next) };
    }));
  }

  function resetBuilder() {
    setName('');
    setQuestions([newQuestion()]);
    setAssignments([newAssignment()]);
    setEditingQuestionnaireId(null);
  }

  function canManage() {
    return viewerRole === 'admin' || viewerRole === 'coach';
  }

  function editQuestionnaire(questionnaire: QuestionnaireRow) {
    setEditingQuestionnaireId(questionnaire.id);
    setName(questionnaire.name);
    setQuestions(
      questionnaire.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        type: question.type,
        optionsText: question.options.join('\n'),
        scaleMin: question.scaleMin,
        scaleMax: question.scaleMax,
      }))
    );
    const activeAssignments = questionnaire.assignments.filter((assignment) => assignment.isActive);
    setAssignments(
      activeAssignments.length
        ? activeAssignments.map((assignment) => ({
            id: assignment.id,
            groupName: assignment.groupName,
            playerIds: assignment.playerIds,
            notifyStartDate: assignment.notifyStartDate,
            frequency: assignment.frequency,
          }))
        : [newAssignment()]
    );
    setMessage(`Editing "${questionnaire.name}".`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function removeQuestionnaire(questionnaire: QuestionnaireRow) {
    const confirmed = window.confirm(
      `Delete "${questionnaire.name}"? This permanently deletes the questionnaire, its assignments, and all submitted responses.`
    );
    if (!confirmed) return;
    setDeletingQuestionnaireId(questionnaire.id);
    setMessage('');
    try {
      const response = await fetch('/api/admin/questionnaires', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionnaireId: questionnaire.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Failed to delete questionnaire.');
      setQuestionnaires(Array.isArray(result.questionnaires) ? result.questionnaires : []);
      setResponses(Array.isArray(result.responses) ? result.responses : []);
      if (editingQuestionnaireId === questionnaire.id) resetBuilder();
      if (filterQuestionnaireId === String(questionnaire.id)) setFilterQuestionnaireId('');
      setMessage('Questionnaire deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete questionnaire.');
    } finally {
      setDeletingQuestionnaireId(null);
    }
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
        questionnaireId: editingQuestionnaireId,
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
        assignments,
      };
      const response = await fetch('/api/admin/questionnaires', {
        method: editingQuestionnaireId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Failed to save questionnaire.');
      setQuestionnaires(Array.isArray(result.questionnaires) ? result.questionnaires : []);
      setResponses(Array.isArray(result.responses) ? result.responses : []);
      const wasEditing = editingQuestionnaireId != null;
      resetBuilder();
      setMessage(wasEditing ? 'Questionnaire updated.' : 'Questionnaire saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save questionnaire.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="portal-questionnaire-layout">
      <article className="portal-admin-card portal-questionnaire-builder-card">
        <div className="portal-questionnaire-section-head">
          <h3>{editingQuestionnaireId ? 'Edit Questionnaire' : 'Build Questionnaire'}</h3>
          {editingQuestionnaireId ? (
            <button type="button" className="btn btn-ghost" onClick={resetBuilder} disabled={saving}>
              Cancel Edit
            </button>
          ) : null}
        </div>

        {questionnaires.length ? (
          <div className="portal-questionnaire-section">
            <h4>Built Questionnaires</h4>
            <div className="portal-questionnaire-manage-list">
              {questionnaires.map((questionnaire) => {
                const manageable = canManage();
                const activeAssignments = questionnaire.assignments.filter((assignment) => assignment.isActive);
                return (
                  <div className="portal-questionnaire-manage-row" key={questionnaire.id}>
                    <div>
                      <strong>{questionnaire.name}</strong>
                      <span>
                        {questionnaire.questions.length} {questionnaire.questions.length === 1 ? 'question' : 'questions'} ·{' '}
                        {activeAssignments.length} active {activeAssignments.length === 1 ? 'assignment' : 'assignments'}
                      </span>
                    </div>
                    {manageable ? (
                      <div className="portal-questionnaire-manage-actions">
                        <button type="button" className="btn btn-ghost" onClick={() => editQuestionnaire(questionnaire)} disabled={saving}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost portal-questionnaire-delete-button"
                          onClick={() => void removeQuestionnaire(questionnaire)}
                          disabled={deletingQuestionnaireId === questionnaire.id}
                        >
                          {deletingQuestionnaireId === questionnaire.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    ) : (
                      <span className="portal-questionnaire-owner-note">Created by another coach</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

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
          <div className="portal-questionnaire-section-head">
            <h4>Who Gets Notified</h4>
            <button type="button" className="btn btn-ghost" onClick={() => setAssignments((previous) => [...previous, newAssignment()])}>
              Add Assignment
            </button>
          </div>
          {assignments.map((assignment, assignmentIndex) => {
            const visiblePlayerIds = new Set(players.map((player) => player.id));
            const hiddenPlayerIds = assignment.playerIds.filter((playerId) => !visiblePlayerIds.has(playerId));
            const selectedAll = players.length > 0 && players.every((player) => assignment.playerIds.includes(player.id));
            return (
              <div className="portal-question-card" key={assignment.id ?? `new-assignment-${assignmentIndex}`}>
                <div className="portal-questionnaire-section-head">
                  <strong>Assignment {assignmentIndex + 1}</strong>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setAssignments((previous) => previous.filter((_, index) => index !== assignmentIndex))}
                    disabled={assignments.length <= 1}
                  >
                    Remove
                  </button>
                </div>
                <div className="portal-testing-grid-2">
                  <label className="portal-inline-filter">
                    Group Name
                    <input
                      value={assignment.groupName}
                      onChange={(event) => updateAssignment(assignmentIndex, { groupName: event.target.value })}
                      placeholder="Starters"
                    />
                  </label>
                  <label className="portal-inline-filter">
                    Notify Starting
                    <input
                      type="date"
                      value={assignment.notifyStartDate}
                      onChange={(event) => updateAssignment(assignmentIndex, { notifyStartDate: event.target.value })}
                    />
                  </label>
                  <label className="portal-inline-filter">
                    Frequency
                    <select
                      value={assignment.frequency}
                      onChange={(event) =>
                        updateAssignment(assignmentIndex, { frequency: event.target.value as AssignmentDraft['frequency'] })
                      }
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
                    onClick={() =>
                      updateAssignment(assignmentIndex, {
                        playerIds: selectedAll ? hiddenPlayerIds : [...hiddenPlayerIds, ...players.map((player) => player.id)],
                      })
                    }
                  >
                    {selectedAll ? 'Clear Players' : 'Select All Players'}
                  </button>
                </div>
                <div className="portal-questionnaire-player-list">
                  {players.map((player) => (
                    <label key={player.id} className="portal-questionnaire-player-option">
                      <input
                        type="checkbox"
                        checked={assignment.playerIds.includes(player.id)}
                        onChange={() => togglePlayer(assignmentIndex, player.id)}
                      />
                      <span>{player.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {message ? <p className="portal-questionnaire-message">{message}</p> : null}
        <button type="button" className="btn btn-primary" onClick={saveQuestionnaire} disabled={saving}>
          {saving ? 'Saving...' : editingQuestionnaireId ? 'Update Questionnaire' : 'Save Questionnaire'}
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

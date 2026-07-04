'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ExerciseLoadHistoryEntry, ProgramItemRow } from '../../../lib/training-db';

type WorkoutLogModalProps = {
  item: ProgramItemRow;
  playerId: number;
  onClose: () => void;
  onSaved?: () => Promise<void> | void;
  onDelete?: (item: ProgramItemRow) => Promise<void> | void;
  allowWorkoutCustomization?: boolean;
  exerciseOptions?: Array<{ id: number; name: string; category: string }>;
  onWorkoutCustomized?: (item: ProgramItemRow) => Promise<void> | void;
  catchPlayNote?: string;
};

const ASSESSMENT_NOTES_TOKEN = '[ASSESSMENT_NOTES]';

function parseSetCount(value: string | null): number {
  if (!value) return 1;
  const match = value.match(/\d+/);
  if (!match) return 1;
  const count = Number(match[0]);
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(count, 12);
}

function parseLoadValues(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim());
}

function parseAssessmentNotesPayload(
  value: string | null
): { generalNotes: string; assessmentNotes: string[] } {
  const raw = String(value ?? '');
  const tokenIndex = raw.indexOf(ASSESSMENT_NOTES_TOKEN);
  if (tokenIndex === -1) {
    return { generalNotes: raw, assessmentNotes: [] };
  }

  const generalNotes = raw.slice(0, tokenIndex).trimEnd();
  const payload = raw.slice(tokenIndex + ASSESSMENT_NOTES_TOKEN.length).trim();
  if (!payload) return { generalNotes, assessmentNotes: [] };

  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed)) return { generalNotes, assessmentNotes: [] };
    return {
      generalNotes,
      assessmentNotes: parsed.map((entry) => String(entry ?? '')),
    };
  } catch {
    return { generalNotes, assessmentNotes: [] };
  }
}

function formatRepTarget(repMeasure: 'reps' | 'seconds' | 'distance', repsPerSide: boolean, value: string | null): string {
  if (!value) return '-';
  if (repMeasure === 'seconds') return `${value} sec`;
  if (repMeasure === 'distance') return `${value} yd`;
  if (repsPerSide) return `${value} /side`;
  return value;
}

function dateTitle(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function cycleSlotLabel(value: string | null): string {
  if (!value) return '';
  if (value === 's_and_c') return 'S&C';
  return value[0].toUpperCase() + value.slice(1).replaceAll('_', ' ');
}

function formatLoadNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, '');
}

function trackingPlaceholder(trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight' | 'velocity'): string {
  if (trackingType === 'body_weight') return 'completed';
  if (trackingType === 'seconds') return 'sec';
  if (trackingType === 'inches') return 'in';
  if (trackingType === 'velocity') return 'mph';
  return 'lbs';
}

function isPlyoCategory(value: string | null | undefined): boolean {
  return String(value ?? '').trim().toLowerCase().startsWith('plyo');
}

function formatMaxHistory(
  entries: ExerciseLoadHistoryEntry[],
  trackingType: 'lbs' | 'seconds' | 'inches' | 'body_weight' | 'velocity'
): { load: number; dayDate: string; repsText: string } | null {
  if (trackingType === 'body_weight') return null;
  let best: { load: number; dayDate: string; repsText: string } | null = null;
  for (const entry of entries) {
    for (const loadValue of entry.loads) {
      const numeric = Number(loadValue.replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(numeric)) continue;
      if (!best || numeric > best.load) {
        best = {
          load: numeric,
          dayDate: entry.dayDate,
          repsText: formatRepTarget(entry.repMeasure, entry.repsPerSide, entry.prescribedReps),
        };
      }
    }
  }
  return best;
}

type WorkoutExerciseDraft = {
  workoutExerciseIndex: number;
  exerciseId: number | null;
  prescribedSets: string;
  prescribedReps: string;
  prescribedLoad: string;
  notes: string;
};

function buildWorkoutExerciseDrafts(item: ProgramItemRow): WorkoutExerciseDraft[] {
  return item.workoutExercises.map((exercise, index) => ({
    workoutExerciseIndex: Number.isFinite(Number(exercise.workoutExerciseIndex)) ? Number(exercise.workoutExerciseIndex) : index,
    exerciseId: exercise.exerciseId,
    prescribedSets: exercise.prescribedSets ?? '',
    prescribedReps: exercise.prescribedReps ?? '',
    prescribedLoad: exercise.prescribedLoad ?? '',
    notes: exercise.notes ?? '',
  }));
}

function buildExerciseSelectOptions(
  exercise: ProgramItemRow['workoutExercises'][number],
  exerciseOptions: Array<{ id: number; name: string; category: string }>
): Array<{ id: number; label: string }> {
  const options = new Map<number, string>();
  const currentExerciseId = Number(exercise.exerciseId ?? 0);
  const templateExerciseId = Number(exercise.templateExerciseId ?? 0);

  if (currentExerciseId > 0) {
    options.set(currentExerciseId, exercise.name);
  }

  for (const option of exerciseOptions) {
    if (!Number.isFinite(option.id) || option.id <= 0) continue;
    options.set(option.id, `${option.name}${option.category ? ` (${option.category})` : ''}`);
  }

  if (templateExerciseId > 0 && !options.has(templateExerciseId)) {
    options.set(templateExerciseId, `Original Exercise #${templateExerciseId}`);
  }

  return Array.from(options, ([id, label]) => ({ id, label }));
}

function ExerciseReplacementSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: number | null;
  options: Array<{ id: number; label: string }>;
  disabled?: boolean;
  onChange: (exerciseId: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.id === value) ?? options[0] ?? null;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
    : options;

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <div className="portal-workout-exercise-select" ref={rootRef}>
      <button
        type="button"
        className="portal-workout-exercise-select-trigger"
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected?.label ?? 'Select exercise'}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div className="portal-workout-exercise-select-menu">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search exercises..."
            autoFocus
          />
          <div className="portal-workout-exercise-select-options" role="listbox">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="portal-workout-exercise-select-option"
                  data-selected={option.id === value ? 'true' : 'false'}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  role="option"
                  aria-selected={option.id === value}
                >
                  {option.label}
                </button>
              ))
            ) : (
              <div className="portal-workout-exercise-select-empty">No matching exercises.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function WorkoutLogModal({
  item,
  playerId,
  onClose,
  onSaved,
  onDelete,
  allowWorkoutCustomization = false,
  exerciseOptions = [],
  onWorkoutCustomized,
  catchPlayNote,
}: WorkoutLogModalProps) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingCustomization, setSavingCustomization] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [historyByExercise, setHistoryByExercise] = useState<Record<number, ExerciseLoadHistoryEntry[]>>({});
  const [videoPreview, setVideoPreview] = useState<{ title: string; url: string } | null>(null);
  const [mediaUploadMessage, setMediaUploadMessage] = useState('');
  const [customizingWorkout, setCustomizingWorkout] = useState(false);
  const [exerciseDrafts, setExerciseDrafts] = useState<WorkoutExerciseDraft[]>(() => buildWorkoutExerciseDrafts(item));
  const formRef = useRef<HTMLFormElement | null>(null);

  const isCycleItem = item.scheduleType === 'cycle';
  const loadValues = useMemo(() => parseLoadValues(item.performedLoad), [item.performedLoad]);
  const isAssessmentWorkout = (item.workoutCategory ?? '').trim().toLowerCase() === 'assessment';
  const notesPayload = useMemo(() => parseAssessmentNotesPayload(item.logNotes ?? ''), [item.logNotes]);
  const exerciseIdsForHistory = useMemo(() => {
    if (item.itemType === 'workout') {
      return Array.from(
        new Set(
          item.workoutExercises
            .map((exercise) => Number(exercise.exerciseId ?? 0))
            .filter((exerciseId) => Number.isFinite(exerciseId) && exerciseId > 0)
        )
      );
    }
    return item.exerciseId && item.exerciseId > 0 ? [item.exerciseId] : [];
  }, [item.exerciseId, item.itemType, item.workoutExercises]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (exerciseIdsForHistory.length === 0) {
        setHistoryByExercise({});
        return;
      }
      const params = new URLSearchParams({
        playerId: String(playerId),
        exerciseIds: exerciseIdsForHistory.join(','),
      });
      if (!isCycleItem) params.set('beforeDate', item.dayDate);
      const response = await fetch(`/api/player/exercise-history?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => ({}))) as {
        history?: Record<string, ExerciseLoadHistoryEntry[]>;
      };
      if (cancelled) return;
      const next: Record<number, ExerciseLoadHistoryEntry[]> = {};
      for (const [key, value] of Object.entries(payload.history ?? {})) {
        const numeric = Number(key);
        if (!Number.isFinite(numeric) || numeric <= 0 || !Array.isArray(value)) continue;
        next[numeric] = value;
      }
      setHistoryByExercise(next);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [exerciseIdsForHistory, isCycleItem, item.dayDate, playerId]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    setCustomizingWorkout(false);
    setExerciseDrafts(buildWorkoutExerciseDrafts(item));
    setError('');
  }, [item]);

  const saveWorkoutCustomization = async () => {
    if (item.itemType !== 'workout' || item.scheduleType !== 'calendar') return;
    setSavingCustomization(true);
    setError('');
    try {
      const response = await fetch('/api/admin/schedule/workout-overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId,
          itemId: item.itemId,
          dayDate: item.dayDate,
          overrides: exerciseDrafts,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; item?: ProgramItemRow };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save workout customization.');
      if (payload.item && onWorkoutCustomized) await onWorkoutCustomized(payload.item);
      if (onSaved) await onSaved();
      setCustomizingWorkout(false);
    } catch (customizeError) {
      setError(customizeError instanceof Error ? customizeError.message : 'Failed to save workout customization.');
    } finally {
      setSavingCustomization(false);
    }
  };

  const embedVideoUrl = (raw: string): string => {
    try {
      const parsed = new URL(raw);
      if (parsed.hostname.includes('youtube.com')) {
        const videoId = parsed.searchParams.get('v');
        if (videoId) return `https://www.youtube.com/embed/${videoId}`;
        const shortMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/i);
        if (shortMatch?.[1]) return `https://www.youtube.com/embed/${shortMatch[1]}`;
      }
      if (parsed.hostname.includes('youtu.be')) {
        const videoId = parsed.pathname.replace('/', '').trim();
        if (videoId) return `https://www.youtube.com/embed/${videoId}`;
      }
      if (parsed.hostname.includes('vimeo.com')) {
        const id = parsed.pathname.split('/').filter(Boolean)[0];
        if (id) return `https://player.vimeo.com/video/${id}`;
      }
      return raw;
    } catch {
      return raw;
    }
  };

  const uploadExerciseMedia = async (exerciseName: string, files: File[]) => {
    if (!files.length) return;
    setMediaUploadMessage('');
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const title = files.length > 1 ? `${baseName}` : baseName;
        const form = new FormData();
        form.set('playerId', String(playerId));
        form.set('file', file);
        form.set('title', title);
        form.set('category', 'Workout');
        form.set('sourceType', 'workout_exercise');
        form.set('sourceLabel', exerciseName);
        const response = await fetch('/api/player/media', { method: 'POST', body: form });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `Failed to upload ${file.name}.`);
      }
      setMediaUploadMessage(files.length > 1 ? `${files.length} files saved to Player Notes.` : `Saved to Player Notes.`);
    } catch (error) {
      setMediaUploadMessage(error instanceof Error ? error.message : 'Failed to upload media.');
    }
  };

  if (!mounted) return null;

  const content = (
    <article
      className="portal-modal-card"
      role="dialog"
      aria-modal="true"
      spellCheck={false}
      data-gramm="false"
      data-gramm_editor="false"
      data-enable-grammarly="false"
      onClick={(event) => event.stopPropagation()}
      style={{ maxHeight: '85vh', overflow: 'auto', background: '#000', opacity: 1 }}
    >
        <div
          className="portal-modal-header"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            alignItems: 'center',
            gap: '0.6rem',
          }}
        >
          <h3 style={{ margin: 0, minWidth: 0, fontSize: '1.7rem', lineHeight: 1.05 }}>{item.itemName}</h3>
          <img
            src="/pitching-coach-u-logo.png"
            alt="PCU logo"
            className="portal-modal-logo"
            style={{
              width: '42px',
              height: '42px',
              objectFit: 'contain',
              borderRadius: '5px',
            }}
          />
        </div>
        {item.itemType === 'workout' && item.workoutDescription && (
          <p className="portal-muted-text" style={{ marginBottom: '0.3rem' }}>
            {item.workoutDescription}
          </p>
        )}
        {item.itemType === 'workout' && item.prescribedNotes && (
          <p className="portal-muted-text" style={{ marginBottom: '0.3rem', whiteSpace: 'pre-wrap' }}>
            <strong>Notes:</strong> {item.prescribedNotes}
          </p>
        )}
        {!(catchPlayNote && item.itemType === 'workout' && item.workoutExercises.length === 0) && (
          <p className="portal-muted-text" style={{ fontStyle: 'italic' }}>
            {isCycleItem
              ? `3-Day Cycle${item.cycleSlot ? ` - ${cycleSlotLabel(item.cycleSlot)}` : ''}`
              : dateTitle(item.dayDate)}
          </p>
        )}

        {catchPlayNote && (
          <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '0.65rem 0.85rem', marginBottom: '0.4rem' }}>
            <strong style={{ fontSize: '0.85rem' }}>Catch Play Routine</strong>
            <p style={{ margin: '0.3rem 0 0', whiteSpace: 'pre-wrap', fontSize: '0.92rem' }}>{catchPlayNote}</p>
          </div>
        )}

        <form
          ref={formRef}
          spellCheck={false}
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError('');
            try {
              const form = new FormData(event.currentTarget);
              const loadInputs = Array.from(
                event.currentTarget.querySelectorAll<HTMLInputElement>("input[name='performedLoadValues']")
              );
              const loadInputIndexes = Array.from(
                event.currentTarget.querySelectorAll<HTMLInputElement>("input[name='performedLoadValueIndexes']")
              );
              form.delete('performedLoadValuesIndexed');
              loadInputs.forEach((input, index) => {
                const explicitIndex = Number(loadInputIndexes[index]?.value ?? '');
                const effectiveIndex = Number.isFinite(explicitIndex) && explicitIndex >= 0 ? explicitIndex : index;
                form.append('performedLoadValuesIndexed', `${effectiveIndex}:${input.value}`);
              });
              form.set('itemId', String(item.itemId));
              form.set('playerId', String(playerId));

              const response = await fetch('/api/player/logs/json', {
                method: 'POST',
                body: form,
              });
              const payload = (await response.json().catch(() => ({}))) as { error?: string };
              if (!response.ok) throw new Error(payload.error ?? 'Failed to save log.');
              if (onSaved) await onSaved();
              onClose();
            } catch (saveError) {
              setError(saveError instanceof Error ? saveError.message : 'Failed to save log.');
            } finally {
              setSaving(false);
            }
          }}
        >
          <input type="hidden" name="scheduleType" value={item.scheduleType} />
          <input type="hidden" name="completed" value={item.completed ? 'on' : ''} />
          {allowWorkoutCustomization && item.itemType === 'workout' && item.scheduleType === 'calendar' && item.workoutExercises.length > 0 ? (
            <div className="portal-workout-customize-panel">
              <div className="portal-choice-line-actions">
                <div>
                  <strong>Player-Specific Prescription</strong>
                  <p className="portal-muted-text" style={{ margin: '0.15rem 0 0' }}>
                    Edit sets, reps, load, or notes for this player/date. Future assignments of this same workout to this player will reuse the latest saved edits.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setCustomizingWorkout((previous) => !previous)}
                  disabled={saving || savingCustomization}
                >
                  {customizingWorkout ? 'Hide Customization' : 'Customize for Player'}
                </button>
              </div>
              {customizingWorkout ? (
                <div className="portal-workout-customize-list">
                  {item.workoutExercises.map((exercise, exerciseIdx) => {
                    const draft = exerciseDrafts[exerciseIdx] ?? {
                      workoutExerciseIndex: Number.isFinite(Number(exercise.workoutExerciseIndex)) ? Number(exercise.workoutExerciseIndex) : exerciseIdx,
                      exerciseId: exercise.exerciseId,
                      prescribedSets: exercise.prescribedSets ?? '',
                      prescribedReps: exercise.prescribedReps ?? '',
                      prescribedLoad: exercise.prescribedLoad ?? '',
                      notes: exercise.notes ?? '',
                    };
                    const setDraftValue = (patch: Partial<WorkoutExerciseDraft>) => {
                      setExerciseDrafts((previous) =>
                        previous.map((entry, index) => (index === exerciseIdx ? { ...entry, ...patch } : entry))
                      );
                    };
                    const resetDraft = () => {
                      setDraftValue({
                        exerciseId: exercise.templateExerciseId ?? exercise.exerciseId,
                        prescribedSets: exercise.templatePrescribedSets ?? '',
                        prescribedReps: exercise.templatePrescribedReps ?? '',
                        prescribedLoad: exercise.templatePrescribedLoad ?? '',
                        notes: exercise.templateNotes ?? '',
                      });
                    };
                    const exerciseSelectOptions = buildExerciseSelectOptions(exercise, exerciseOptions);
                    return (
                      <div className="portal-workout-customize-row" key={`${item.itemId}-custom-${exerciseIdx}`}>
                        <div className="portal-workout-customize-row-head">
                          <strong>
                            {exercise.prefix ? `${exercise.prefix} ` : ''}
                            {exercise.name}
                          </strong>
                          {exercise.isCustomized ? <span>custom</span> : null}
                        </div>
                        <div className="portal-workout-customize-grid">
                          <label className="portal-workout-exercise-field">
                            Exercise
                            <ExerciseReplacementSelect
                              value={draft.exerciseId}
                              options={exerciseSelectOptions}
                              disabled={savingCustomization}
                              onChange={(nextExerciseId) => {
                                setDraftValue({
                                  exerciseId: Number.isFinite(nextExerciseId) && nextExerciseId > 0 ? nextExerciseId : exercise.exerciseId,
                                });
                              }}
                            />
                          </label>
                          <label>
                            Sets
                            <input value={draft.prescribedSets} onChange={(event) => setDraftValue({ prescribedSets: event.target.value })} />
                          </label>
                          <label>
                            Reps
                            <input value={draft.prescribedReps} onChange={(event) => setDraftValue({ prescribedReps: event.target.value })} />
                          </label>
                          <label>
                            Load
                            <input value={draft.prescribedLoad} onChange={(event) => setDraftValue({ prescribedLoad: event.target.value })} />
                          </label>
                          <button type="button" className="btn btn-ghost" onClick={resetDraft} disabled={savingCustomization}>
                            Reset Row
                          </button>
                        </div>
                        <label className="portal-inline-filter">
                          Notes / Cues
                          <textarea value={draft.notes} onChange={(event) => setDraftValue({ notes: event.target.value })} rows={2} />
                        </label>
                      </div>
                    );
                  })}
                  <div className="portal-choice-line-actions">
                    <button type="button" className="btn btn-primary" onClick={saveWorkoutCustomization} disabled={savingCustomization}>
                      {savingCustomization ? 'Saving Customization...' : 'Save Player Customization'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setExerciseDrafts(buildWorkoutExerciseDrafts(item))}
                      disabled={savingCustomization}
                    >
                      Undo Unsaved Edits
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {catchPlayNote && item.itemType === 'workout' && item.workoutExercises.length === 0 ? null : item.itemType === 'workout' && item.workoutExercises.length > 0 ? (
            <div className="portal-workout-player-block">
              {(() => {
                let loadIndex = 0;
                return item.workoutExercises.map((exercise, exerciseIdx) => {
                  const setCount = parseSetCount(exercise.prescribedSets);
                  const assessmentCurrent = loadValues[exerciseIdx] ?? '';
                  return (
                    <div key={`${item.itemId}-modal-ex-${exerciseIdx}`} className="portal-workout-player-exercise">
                      <div className="portal-workout-player-head">
                        <button
                          type="button"
                          className="portal-exercise-video-link portal-exercise-video-trigger"
                          onClick={() => {
                            if (!exercise.instructionVideoUrl) {
                              setError(`No video link saved for "${exercise.name}".`);
                              return;
                            }
                            setError('');
                            setVideoPreview({
                              title: exercise.name,
                              url: embedVideoUrl(exercise.instructionVideoUrl),
                            });
                          }}
                        >
                          {exercise.prefix ? `${exercise.prefix} ` : ''}
                          {exercise.name}
                        </button>
                        <label className="btn btn-ghost" style={{ padding: '0.35rem 0.55rem', minHeight: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }} title="Upload photo/video">
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                          <input
                            type="file"
                            accept="image/*,video/*"
                            multiple={true}
                            style={{ display: 'none' }}
                            onChange={(event) => {
                              const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
                              void uploadExerciseMedia(exercise.name, files);
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                      </div>
                      {exercise.description && <p className="portal-muted-text">{exercise.description}</p>}
                      {exercise.coachingCues && (
                        <p className="portal-muted-text">
                          <strong>Cues:</strong> {exercise.coachingCues}
                        </p>
                      )}
                      <p className="portal-muted-text">
                        {exercise.prescribedSets ?? '-'} x{' '}
                        {formatRepTarget(exercise.repMeasure, exercise.repsPerSide, exercise.prescribedReps)}
                      </p>
                      {exercise.notes && (
                        <p className="portal-muted-text" style={{ whiteSpace: 'pre-wrap' }}>
                          <strong>Notes:</strong> {exercise.notes}
                        </p>
                      )}
                      {isPlyoCategory(exercise.category) && String(exercise.prescribedLoad ?? '').trim() ? (
                        <p className="portal-muted-text">
                          <strong>Plyo Ball:</strong> {String(exercise.prescribedLoad ?? '').trim()}
                        </p>
                      ) : null}
                      {!isAssessmentWorkout && exercise.exerciseId && historyByExercise[exercise.exerciseId]?.length
                        ? (() => {
                            const maxEntry = formatMaxHistory(historyByExercise[exercise.exerciseId], exercise.trackingType);
                            if (!maxEntry) return null;
                            return (
                              <p className="portal-muted-text">
                                Max: {formatLoadNumber(maxEntry.load)} {trackingPlaceholder(exercise.trackingType)} x{maxEntry.repsText} ({dateTitle(maxEntry.dayDate)})
                              </p>
                            );
                          })()
                        : null}
                      {isAssessmentWorkout ? (
                        <div className="portal-set-weights">
                          <label key={`${item.itemId}-modal-ex-${exerciseIdx}-score`}>
                            Score (1-3)
                            <select name="assessmentScoreValues" defaultValue={assessmentCurrent}>
                              <option value="">Select score</option>
                              <option value="3">3 - Pass</option>
                              <option value="2">2 - Mid</option>
                              <option value="1">1 - Fail</option>
                            </select>
                            <textarea
                              name="assessmentNoteValues"
                              rows={2}
                              placeholder="Assessment note..."
                              defaultValue={notesPayload.assessmentNotes[exerciseIdx] ?? ''}
                              style={{ marginTop: '0.35rem' }}
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="portal-set-weights">
                          {Array.from({ length: setCount }).map((_, setIdx) => {
                            const current = loadValues[loadIndex] ?? '';
                            const setValueIndex = loadIndex;
                            loadIndex += 1;
                            const checked = ['1', 'true', 'yes', 'on', 'checked'].includes(current.trim().toLowerCase());
                            return (
                              <label key={`${item.itemId}-modal-ex-${exerciseIdx}-set-${setIdx}`}>
                                Set {setIdx + 1}
                                {exercise.trackingType === 'body_weight' ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                    <input
                                      type="hidden"
                                      name="performedBodyWeightSetValues"
                                      value={`${setValueIndex}:0`}
                                    />
                                    <input
                                      type="checkbox"
                                      name="performedBodyWeightSetValues"
                                      value={`${setValueIndex}:1`}
                                      defaultChecked={checked}
                                    />
                                  </div>
                                ) : (
                                  <>
                                    <input type="hidden" name="performedLoadValueIndexes" value={setValueIndex} />
                                    <input
                                      name="performedLoadValues"
                                      defaultValue={current}
                                      placeholder={trackingPlaceholder(exercise.trackingType)}
                                    />
                                  </>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <div className="portal-workout-player-block">
              <div className="portal-workout-player-head">
                <button
                  type="button"
                  className="portal-exercise-video-link portal-exercise-video-trigger"
                  onClick={() => {
                    if (!item.instructionVideoUrl) {
                      setError(`No video link saved for "${item.itemName}".`);
                      return;
                    }
                    setError('');
                    setVideoPreview({
                      title: item.itemName,
                      url: embedVideoUrl(item.instructionVideoUrl),
                    });
                  }}
                >
                  {item.itemName}
                </button>
                <label className="btn btn-ghost" style={{ padding: '0.35rem 0.55rem', minHeight: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }} title="Upload photo/video">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple={true}
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
                      void uploadExerciseMedia(item.itemName, files);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
              </div>
              {item.exerciseDescription && <p className="portal-muted-text">{item.exerciseDescription}</p>}
              {item.exerciseCoachingCues && (
                <p className="portal-muted-text">
                  <strong>Cues:</strong> {item.exerciseCoachingCues}
                </p>
              )}
              <p className="portal-muted-text">
                {item.prescribedSets ?? '-'} x {formatRepTarget(item.repMeasure, item.repsPerSide, item.prescribedReps)}
              </p>
              {item.prescribedNotes && (
                <p className="portal-muted-text" style={{ whiteSpace: 'pre-wrap' }}>
                  <strong>Notes:</strong> {item.prescribedNotes}
                </p>
              )}
              {item.exerciseId && historyByExercise[item.exerciseId]?.length
                ? (() => {
                    const maxEntry = formatMaxHistory(historyByExercise[item.exerciseId], item.trackingType);
                    if (!maxEntry) return null;
                    return (
                      <p className="portal-muted-text">
                        Max: {formatLoadNumber(maxEntry.load)} {trackingPlaceholder(item.trackingType)} x{maxEntry.repsText} ({dateTitle(maxEntry.dayDate)})
                      </p>
                    );
                  })()
                : null}
              <div className="portal-set-weights">
                {Array.from({ length: parseSetCount(item.prescribedSets) }).map((_, setIdx) => {
                  const current = loadValues[setIdx] ?? '';
                  const checked = ['1', 'true', 'yes', 'on', 'checked'].includes(current.trim().toLowerCase());
                  return (
                    <label key={`${item.itemId}-modal-set-${setIdx}`}>
                      Set {setIdx + 1}
                      {item.trackingType === 'body_weight' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                          <input type="hidden" name="performedBodyWeightSetValues" value={`${setIdx}:0`} />
                          <input
                            type="checkbox"
                            name="performedBodyWeightSetValues"
                            value={`${setIdx}:1`}
                            defaultChecked={checked}
                          />
                        </div>
                      ) : (
                        <>
                          <input type="hidden" name="performedLoadValueIndexes" value={setIdx} />
                          <input
                            name="performedLoadValues"
                            defaultValue={current}
                            placeholder={trackingPlaceholder(item.trackingType)}
                          />
                        </>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {catchPlayNote && item.itemType === 'workout' && item.workoutExercises.length === 0 ? null : (
            <div className="portal-log-grid">
              <label className="portal-form-span-2">
                Notes
                <textarea name="notes" rows={2} defaultValue={notesPayload.generalNotes} />
              </label>
            </div>
          )}

          {mediaUploadMessage ? <p className={mediaUploadMessage.includes('Failed') || mediaUploadMessage.includes('Forbidden') ? 'auth-error' : 'auth-message'}>{mediaUploadMessage}</p> : null}
          {error && <p className="auth-error">{error}</p>}
          <div className="portal-choice-line-actions">
            {!(catchPlayNote && item.itemType === 'workout' && item.workoutExercises.length === 0) && (
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Log'}
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={saving || deleting}
                onClick={async () => {
                  setDeleting(true);
                  setError('');
                  try {
                    await onDelete(item);
                    onClose();
                  } catch (deleteError) {
                    setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete workout.');
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? 'Deleting...' : 'Delete Workout'}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Close
            </button>
          </div>
        </form>
    </article>
  );

  return createPortal(
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'grid',
          placeItems: 'center',
          padding: '1rem',
          background: '#000',
        }}
        onClick={() => {
          if (saving || deleting) return;
          if (formRef.current) {
            formRef.current.requestSubmit();
            return;
          }
          onClose();
        }}
        role="presentation"
      >
        <div onClick={(event) => event.stopPropagation()} style={{ width: 'min(720px, 96vw)' }}>
          {content}
        </div>
      </div>
      {videoPreview && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'grid',
            placeItems: 'center',
            padding: '1rem',
            background: 'rgba(0,0,0,0.92)',
          }}
          onClick={() => setVideoPreview(null)}
          role="presentation"
        >
          <article
            className="portal-modal-card"
            style={{ width: 'min(860px, 96vw)', background: '#000' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="portal-choice-line-actions">
              <h4 style={{ margin: 0 }}>{videoPreview.title}</h4>
              <button type="button" className="btn btn-ghost" onClick={() => setVideoPreview(null)}>
                Close Video
              </button>
            </div>
            <div className="tutorial-video-frame-wrap">
              <iframe
                src={videoPreview.url}
                title={`${videoPreview.title} video`}
                className="tutorial-video-frame"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </article>
        </div>
      )}
    </>,
    document.body
  );
}

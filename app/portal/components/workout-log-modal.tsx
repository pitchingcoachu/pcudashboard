'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ExerciseLoadHistoryEntry, ProgramItemRow } from '../../../lib/training-db';

type WorkoutLogModalProps = {
  item: ProgramItemRow;
  playerId: number;
  onClose: () => void;
  onSaved?: () => Promise<void> | void;
  onDelete?: (item: ProgramItemRow) => Promise<void> | void;
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
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
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

function formatLoadNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, '');
}

function formatMaxHistory(
  entries: ExerciseLoadHistoryEntry[]
): { load: number; dayDate: string; repsText: string } | null {
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

export default function WorkoutLogModal({ item, playerId, onClose, onSaved, onDelete }: WorkoutLogModalProps) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [historyByExercise, setHistoryByExercise] = useState<Record<number, ExerciseLoadHistoryEntry[]>>({});
  const [videoPreview, setVideoPreview] = useState<{ title: string; url: string } | null>(null);

  const isCycleItem = item.scheduleType === 'cycle';
  const loadValues = useMemo(() => (isCycleItem ? [] : parseLoadValues(item.performedLoad)), [isCycleItem, item.performedLoad]);
  const isAssessmentWorkout = (item.workoutCategory ?? '').trim().toLowerCase() === 'assessment';
  const notesPayload = useMemo(() => (isCycleItem ? { generalNotes: '', assessmentNotes: [] } : parseAssessmentNotesPayload(item.logNotes ?? '')), [isCycleItem, item.logNotes]);
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

  const embedVideoUrl = (raw: string): string => {
    try {
      const parsed = new URL(raw);
      if (parsed.hostname.includes('youtube.com')) {
        const videoId = parsed.searchParams.get('v');
        if (videoId) return `https://www.youtube.com/embed/${videoId}`;
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
        <p className="portal-muted-text" style={{ fontStyle: 'italic' }}>
          {isCycleItem
            ? `3-Day Cycle${item.cycleSlot ? ` - ${item.cycleSlot[0].toUpperCase()}${item.cycleSlot.slice(1)}` : ''}`
            : dateTitle(item.dayDate)}
        </p>

        <form
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
          {item.itemType === 'workout' && item.workoutExercises.length > 0 ? (
            <div className="portal-workout-player-block">
              {(() => {
                let loadIndex = 0;
                return item.workoutExercises.map((exercise, exerciseIdx) => {
                  const setCount = parseSetCount(exercise.prescribedSets);
                  const assessmentCurrent = isCycleItem ? '' : loadValues[exerciseIdx] ?? '';
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
                      {!isAssessmentWorkout && exercise.exerciseId && historyByExercise[exercise.exerciseId]?.length
                        ? (() => {
                            const maxEntry = formatMaxHistory(historyByExercise[exercise.exerciseId]);
                            if (!maxEntry) return null;
                            return (
                              <p className="portal-muted-text">
                                Max: {formatLoadNumber(maxEntry.load)}x{maxEntry.repsText} ({dateTitle(maxEntry.dayDate)})
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
                              defaultValue={isCycleItem ? '' : notesPayload.assessmentNotes[exerciseIdx] ?? ''}
                              style={{ marginTop: '0.35rem' }}
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="portal-set-weights">
                          {Array.from({ length: setCount }).map((_, setIdx) => {
                            const current = isCycleItem ? '' : loadValues[loadIndex] ?? '';
                            loadIndex += 1;
                            return (
                              <label key={`${item.itemId}-modal-ex-${exerciseIdx}-set-${setIdx}`}>
                                Set {setIdx + 1}
                                <input name="performedLoadValues" defaultValue={current} placeholder="lbs" />
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
              {item.exerciseId && historyByExercise[item.exerciseId]?.length
                ? (() => {
                    const maxEntry = formatMaxHistory(historyByExercise[item.exerciseId]);
                    if (!maxEntry) return null;
                    return (
                      <p className="portal-muted-text">
                        Max: {formatLoadNumber(maxEntry.load)}x{maxEntry.repsText} ({dateTitle(maxEntry.dayDate)})
                      </p>
                    );
                  })()
                : null}
              <div className="portal-set-weights">
                {Array.from({ length: parseSetCount(item.prescribedSets) }).map((_, setIdx) => (
                  <label key={`${item.itemId}-modal-set-${setIdx}`}>
                    Set {setIdx + 1}
                    <input name="performedLoadValues" defaultValue={isCycleItem ? '' : loadValues[setIdx] ?? ''} placeholder="lbs" />
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="portal-log-grid">
            <label className="portal-form-span-2">
              Notes
              <textarea name="notes" rows={2} defaultValue={isCycleItem ? '' : notesPayload.generalNotes} />
            </label>
          </div>

          {error && <p className="auth-error">{error}</p>}
          <div className="portal-choice-line-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Log'}
            </button>
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
        onClick={onClose}
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

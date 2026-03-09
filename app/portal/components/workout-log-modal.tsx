'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProgramItemRow } from '../../../lib/training-db';

type WorkoutLogModalProps = {
  item: ProgramItemRow;
  playerId: number;
  onClose: () => void;
  onSaved?: () => Promise<void> | void;
};

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

function formatRepTarget(repMeasure: 'reps' | 'seconds' | 'distance', repsPerSide: boolean, value: string | null): string {
  if (!value) return '-';
  if (repMeasure === 'seconds') return `${value} sec`;
  if (repMeasure === 'distance') return `${value} yd`;
  if (repsPerSide) return `${value} /side`;
  return value;
}

function dateTitle(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function WorkoutLogModal({ item, playerId, onClose, onSaved }: WorkoutLogModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [historyByExercise, setHistoryByExercise] = useState<Record<number, Array<{ dayDate: string; sourceName: string; loads: string[] }>>>({});
  const [videoPreview, setVideoPreview] = useState<{ title: string; url: string } | null>(null);

  const loadValues = useMemo(() => parseLoadValues(item.performedLoad), [item.performedLoad]);
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
        beforeDate: item.dayDate,
      });
      const response = await fetch(`/api/player/exercise-history?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => ({}))) as {
        history?: Record<string, Array<{ dayDate: string; sourceName: string; loads: string[] }>>;
      };
      if (cancelled) return;
      const next: Record<number, Array<{ dayDate: string; sourceName: string; loads: string[] }>> = {};
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
  }, [exerciseIdsForHistory, item.dayDate, playerId]);

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
          {dateTitle(item.dayDate)}
        </p>

        <form
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
          {item.itemType === 'workout' && item.workoutExercises.length > 0 ? (
            <div className="portal-workout-player-block">
              {(() => {
                let loadIndex = 0;
                return item.workoutExercises.map((exercise, exerciseIdx) => {
                  const setCount = parseSetCount(exercise.prescribedSets);
                  return (
                    <div key={`${item.itemId}-modal-ex-${exerciseIdx}`} className="portal-workout-player-exercise">
                      <div className="portal-workout-player-head">
                        <strong
                          className="portal-exercise-video-link"
                          role="button"
                          tabIndex={0}
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
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
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
                        </strong>
                      </div>
                      <p className="portal-muted-text">
                        {exercise.prescribedSets ?? '-'} x{' '}
                        {formatRepTarget(exercise.repMeasure, exercise.repsPerSide, exercise.prescribedReps)}
                      </p>
                      {exercise.description && <p className="portal-muted-text">{exercise.description}</p>}
                      {exercise.coachingCues && (
                        <p className="portal-muted-text">
                          <strong>Cues:</strong> {exercise.coachingCues}
                        </p>
                      )}
                      {exercise.exerciseId && historyByExercise[exercise.exerciseId]?.length ? (
                        <div className="portal-history-list">
                          {historyByExercise[exercise.exerciseId].map((entry, idx) => (
                            <p key={`${exercise.exerciseId}-history-${idx}`} className="portal-muted-text">
                              {dateTitle(entry.dayDate)}: {entry.loads.join(', ')} ({entry.sourceName})
                            </p>
                          ))}
                        </div>
                      ) : null}
                      <div className="portal-set-weights">
                        {Array.from({ length: setCount }).map((_, setIdx) => {
                          const current = loadValues[loadIndex] ?? '';
                          loadIndex += 1;
                          return (
                            <label key={`${item.itemId}-modal-ex-${exerciseIdx}-set-${setIdx}`}>
                              Set {setIdx + 1} Weight
                              <input name="performedLoadValues" defaultValue={current} placeholder="lbs" />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <div className="portal-workout-player-block">
              <div className="portal-workout-player-head">
                <strong
                  className="portal-exercise-video-link"
                  role="button"
                  tabIndex={0}
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
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
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
                </strong>
              </div>
              <p className="portal-muted-text">
                {item.prescribedSets ?? '-'} x {formatRepTarget(item.repMeasure, item.repsPerSide, item.prescribedReps)}
              </p>
              {item.exerciseDescription && <p className="portal-muted-text">{item.exerciseDescription}</p>}
              {item.exerciseCoachingCues && (
                <p className="portal-muted-text">
                  <strong>Cues:</strong> {item.exerciseCoachingCues}
                </p>
              )}
              {item.exerciseId && historyByExercise[item.exerciseId]?.length ? (
                <div className="portal-history-list">
                  {historyByExercise[item.exerciseId].map((entry, idx) => (
                    <p key={`${item.exerciseId}-history-${idx}`} className="portal-muted-text">
                      {dateTitle(entry.dayDate)}: {entry.loads.join(', ')} ({entry.sourceName})
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="portal-set-weights">
                {Array.from({ length: parseSetCount(item.prescribedSets) }).map((_, setIdx) => (
                  <label key={`${item.itemId}-modal-set-${setIdx}`}>
                    Set {setIdx + 1} Weight
                    <input name="performedLoadValues" defaultValue={loadValues[setIdx] ?? ''} placeholder="lbs" />
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="portal-log-grid">
            <label className="portal-form-span-2">
              Notes
              <textarea name="notes" rows={2} defaultValue={item.logNotes ?? ''} />
            </label>
            <label className="portal-checkbox-row">
              <input name="completed" type="checkbox" defaultChecked={item.completed} />
              Mark complete
            </label>
          </div>

          {error && <p className="auth-error">{error}</p>}
          <div className="portal-choice-line-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Log'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Close
            </button>
          </div>
        </form>
    </article>
  );

  return createPortal(
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
        {videoPreview && (
          <article className="portal-modal-card" style={{ marginTop: '0.7rem', background: '#000' }}>
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
        )}
      </div>
    </div>,
    document.body
  );
}

'use client';

import { useMemo, useState } from 'react';
import type { ExerciseRow } from '../../../../lib/training-db';

type ExerciseSelectorProps = {
  exercises: ExerciseRow[];
  initialSelectedExerciseIds?: number[];
  initialValuesByExerciseId?: Record<number, { prefix?: string; prescribedSets?: string; prescribedReps?: string; notes?: string }>;
};

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function categoryChipStyle(category: string) {
  const hue = hashString(category) % 360;
  return {
    borderColor: `hsla(${hue}, 85%, 62%, 0.65)`,
    background: `hsla(${hue}, 80%, 52%, 0.22)`,
  };
}

function repsLabel(exercise: ExerciseRow): string {
  if (exercise.repMeasure === 'seconds') return 'Seconds';
  if (exercise.repMeasure === 'distance') return 'Distance';
  if (exercise.repsPerSide) return 'Reps / Side';
  return 'Reps';
}

function repsPlaceholder(exercise: ExerciseRow): string {
  if (exercise.repMeasure === 'seconds') return '20';
  if (exercise.repMeasure === 'distance') return '20 yd';
  return '8';
}

export default function WorkoutExerciseSelector({
  exercises,
  initialSelectedExerciseIds = [],
  initialValuesByExerciseId = {},
}: ExerciseSelectorProps) {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>(initialSelectedExerciseIds);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const exerciseById = useMemo(() => {
    const map = new Map<number, ExerciseRow>();
    for (const exercise of exercises) {
      map.set(exercise.id, exercise);
    }
    return map;
  }, [exercises]);

  const selectedExercises = useMemo(
    () => selectedIds.map((id) => exerciseById.get(id)).filter((item): item is ExerciseRow => Boolean(item)),
    [exerciseById, selectedIds]
  );

  const grouped = useMemo(() => {
    const q = normalized(query);
    const filtered = q
      ? exercises.filter((exercise) => {
          const haystack = [exercise.name, exercise.category, exercise.description ?? '', exercise.coachingCues ?? '']
            .join(' ')
            .toLowerCase();
          return haystack.includes(q);
        })
      : exercises;

    const byCategory = new Map<string, ExerciseRow[]>();
    for (const exercise of filtered) {
      const list = byCategory.get(exercise.category) ?? [];
      list.push(exercise);
      byCategory.set(exercise.category, list);
    }

    return Array.from(byCategory.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, items]) => ({ category, items }));
  }, [exercises, query]);

  const addExercise = (exerciseId: number) => {
    setSelectedIds((prev) => (prev.includes(exerciseId) ? prev : [...prev, exerciseId]));
  };

  const removeExercise = (exerciseId: number) => {
    setSelectedIds((prev) => prev.filter((id) => id !== exerciseId));
  };

  const onDropAt = (targetIndex: number) => {
    setSelectedIds((prev) => {
      if (dragIndex === null || dragIndex < 0 || dragIndex >= prev.length) return prev;
      if (dragIndex === targetIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDragIndex(null);
  };

  return (
    <div className="portal-admin-stack">
      <section className="portal-selected-block">
        <div className="portal-selected-header">
          <h4>Selected Exercises</h4>
          <span>{selectedExercises.length}</span>
        </div>
        {selectedExercises.length === 0 ? (
          <p className="portal-muted-text">Pick exercises below. Selected items appear here and can be reordered.</p>
        ) : (
          <div className="portal-selected-stack">
            {selectedExercises.map((exercise, index) => {
              const defaults = initialValuesByExerciseId[exercise.id] ?? {};
              return (
              <article
                key={exercise.id}
                className={`portal-selected-item${dragIndex === index ? ' is-dragging' : ''}`}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => onDropAt(index)}
              >
                <input type="hidden" name="exerciseIds" value={String(exercise.id)} />
                <div
                  className="portal-selected-inline-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '72px 340px auto auto',
                    alignItems: 'center',
                    columnGap: '0.7rem',
                  }}
                >
                  <label className="portal-small-field" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <input
                      name={`prefix_${exercise.id}`}
                      placeholder="A1"
                      aria-label={`Prefix for ${exercise.name}`}
                      defaultValue={defaults.prefix ?? ''}
                      style={{ width: '58px', minHeight: '30px', padding: '0.2rem 0.35rem' }}
                    />
                  </label>
                  <div className="portal-selected-item-title" style={{ minWidth: 0 }}>
                    <span className="portal-drag-handle" aria-hidden="true">
                      ::
                    </span>
                    <strong>{exercise.name}</strong>
                  </div>
                  <div
                    className="portal-selected-inline-fields"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'nowrap' }}
                  >
                    <label
                      className="portal-small-field"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem', width: '108px' }}
                    >
                    Sets
                    <input
                      name={`prescribedSets_${exercise.id}`}
                      placeholder="3"
                      defaultValue={defaults.prescribedSets ?? ''}
                      style={{ width: '58px', minHeight: '30px', padding: '0.2rem 0.35rem' }}
                    />
                    </label>
                    <label
                      className="portal-small-field"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem', width: '128px' }}
                    >
                    {repsLabel(exercise)}
                    <input
                      name={`prescribedReps_${exercise.id}`}
                      placeholder={repsPlaceholder(exercise)}
                      defaultValue={defaults.prescribedReps ?? ''}
                      style={{ width: '58px', minHeight: '30px', padding: '0.2rem 0.35rem' }}
                    />
                    </label>
                    <label
                      className="portal-small-field portal-small-field-notes"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem', width: '430px' }}
                    >
                    Notes
                    <input
                      name={`notes_${exercise.id}`}
                      placeholder="Tempo, intent, rest..."
                      defaultValue={defaults.notes ?? ''}
                      style={{ width: '360px', minHeight: '30px', padding: '0.2rem 0.35rem' }}
                    />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => removeExercise(exercise.id)}
                  >
                    Remove
                  </button>
                </div>
              </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="portal-library-toolbar">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search workout exercises by name, category, cues..."
          className="portal-library-search"
          aria-label="Search workout exercises"
        />
      </div>

      {grouped.length === 0 ? (
        <p className="portal-muted-text">No exercises match your search.</p>
      ) : (
        <div className="portal-folder-stack">
          {grouped.map((group) => (
            <section key={group.category} className="portal-folder">
              <details>
                <summary className="portal-folder-header">
                  <h4>{group.category}</h4>
                  <span>{group.items.length}</span>
                </summary>

                <div className="portal-choice-list">
                  {group.items.map((exercise) => {
                    const selectedIndex = selectedIds.indexOf(exercise.id);
                    const isSelected = selectedIndex >= 0;

                    return (
                      <div key={exercise.id} className="portal-choice-line">
                        <div className="portal-choice-line-main">
                          <strong>{exercise.name}</strong>
                          <span className="portal-category-chip" style={categoryChipStyle(exercise.category)}>
                            {exercise.category}
                          </span>
                        </div>
                        <div className="portal-choice-line-actions">
                          {isSelected ? (
                            <span className="portal-selected-pill">Selected #{selectedIndex + 1}</span>
                          ) : (
                            <button type="button" className="btn btn-ghost" onClick={() => addExercise(exercise.id)}>
                              Add
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

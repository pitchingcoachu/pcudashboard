'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ExerciseRow } from '../../../../lib/training-db';

type ExerciseLibraryProps = {
  exercises: ExerciseRow[];
};

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

export default function ExerciseLibrary({ exercises }: ExerciseLibraryProps) {
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const q = normalized(query);
    const filtered = q
      ? exercises.filter((exercise) => {
          const haystack = [
            exercise.name,
            exercise.category,
            exercise.description ?? '',
            exercise.coachingCues ?? '',
          ]
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

  return (
    <div className="portal-admin-stack">
      <div className="portal-library-toolbar">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search exercises by name, category, cues..."
          className="portal-library-search"
          aria-label="Search exercise library"
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
                <div className="portal-exercise-grid">
                  {group.items.map((exercise) => (
                    <article key={exercise.id} className="portal-exercise-card">
                      <div>
                        <p className="portal-exercise-type">{exercise.category}</p>
                        <h4>{exercise.name}</h4>
                      </div>
                      <p className="portal-muted-text">
                        Target type:{' '}
                        {exercise.repMeasure === 'seconds'
                          ? 'seconds'
                          : exercise.repMeasure === 'distance'
                            ? 'distance'
                            : exercise.repsPerSide
                              ? 'reps per side'
                              : 'reps'}
                      </p>
                      {exercise.description && <p>{exercise.description}</p>}
                      {exercise.coachingCues && (
                        <p>
                          <strong>Cues:</strong> {exercise.coachingCues}
                        </p>
                      )}
                      {exercise.instructionVideoUrl ? (
                        <a href={exercise.instructionVideoUrl} target="_blank" rel="noreferrer" className="btn btn-ghost as-link">
                          Watch Demo
                        </a>
                      ) : (
                        <p className="portal-muted-text">No video link</p>
                      )}
                      <Link href={`/portal/admin/exercises/${exercise.id}`} className="btn btn-primary as-link">
                        Edit Exercise
                      </Link>
                      <form
                        method="post"
                        action="/api/admin/exercises/delete"
                        onSubmit={(event) => {
                          const ok = window.confirm(`Delete "${exercise.name}"? This cannot be undone.`);
                          if (!ok) event.preventDefault();
                        }}
                      >
                        <input type="hidden" name="exerciseId" value={String(exercise.id)} />
                        <input type="hidden" name="redirectTo" value="/portal/admin/exercises" />
                        <button type="submit" className="btn btn-ghost">
                          Delete
                        </button>
                      </form>
                    </article>
                  ))}
                </div>
              </details>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

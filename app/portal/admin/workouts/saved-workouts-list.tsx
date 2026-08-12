'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { WorkoutRow } from '../../../../lib/training-db';
import DeleteWorkoutForm from './delete-workout-form';

export default function SavedWorkoutsList({ workouts }: { workouts: WorkoutRow[] }) {
  const [query, setQuery] = useState('');

  const filteredWorkouts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workouts;
    return workouts.filter((workout) => {
      const haystack = [
        workout.name,
        workout.category,
        workout.description ?? '',
        workout.exerciseNames.join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query, workouts]);

  return (
    <>
      <div className="portal-form-grid" style={{ marginBottom: '0.9rem' }}>
        <label>
          Search Workouts
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by workout name, category, description, or exercise..."
            aria-label="Search saved workouts"
          />
        </label>
      </div>
      {workouts.length === 0 ? (
        <p>No workouts created yet.</p>
      ) : filteredWorkouts.length === 0 ? (
        <p>No workouts match your search.</p>
      ) : (
        <div className="portal-exercise-grid">
          {filteredWorkouts.map((workout) => (
            <article key={workout.id} className="portal-exercise-card">
              <h4>{workout.name}</h4>
              {workout.isShared ? <span className="portal-tag">PCU Library</span> : null}
              <p className="portal-muted-text">{workout.category}</p>
              <p className="portal-muted-text">{workout.exerciseCount} exercises</p>
              {workout.description && <p>{workout.description}</p>}
              {workout.exerciseNames.length > 0 && <p>{workout.exerciseNames.join(', ')}</p>}
              {!workout.isShared ? (
                <Link href={`/portal/admin/workouts/${workout.id}`} className="btn btn-primary as-link portal-workout-action-btn">
                  Edit Workout
                </Link>
              ) : null}
              <Link
                href={`/portal/admin/workouts?duplicateWorkoutId=${workout.id}#create-workout`}
                className="btn btn-ghost as-link portal-workout-action-btn"
                style={{ whiteSpace: 'nowrap' }}
              >
                Duplicate Workout
              </Link>
              {!workout.isShared ? <DeleteWorkoutForm workoutId={workout.id} workoutName={workout.name} /> : null}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

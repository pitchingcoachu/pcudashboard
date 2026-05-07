'use client';

import { FormEvent, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ExerciseCategoryRow, ExerciseRow } from '../../../../lib/training-db';
import WorkoutExerciseSelector from './exercise-selector';

type ApiResult = { ok?: boolean; message?: string; error?: string };

async function postForm(url: string, formData: FormData): Promise<ApiResult> {
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'fetch',
    },
  });
  const payload = (await response.json().catch(() => ({}))) as ApiResult;
  if (!response.ok || payload.ok === false) return { ok: false, error: payload.error || 'Request failed.' };
  return { ok: true, message: payload.message };
}

export function AsyncWorkoutCreateForm({
  categories,
  exercises,
  initialName = '',
  initialCategory = '',
  initialDescription = '',
  initialSelectedExerciseIds = [],
  initialValuesByExerciseId = {},
}: {
  categories: ExerciseCategoryRow[];
  exercises: ExerciseRow[];
  initialName?: string;
  initialCategory?: string;
  initialDescription?: string;
  initialSelectedExerciseIds?: number[];
  initialValuesByExerciseId?: Record<number, { prefix?: string; prescribedSets?: string; prescribedReps?: string; notes?: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setError('');
    const form = event.currentTarget;
    const result = await postForm('/api/admin/workouts', new FormData(form));
    if (!result.ok) {
      setError(result.error || 'Failed to save workout.');
      return;
    }
    setMessage('Workout saved.');
    form.reset();
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <form method="post" action="/api/admin/workouts" className="portal-form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="redirectTo" value="/portal/admin/workouts" />
      <label>
        Workout Name
        <input name="name" defaultValue={initialName} required />
      </label>
      <label>
        Workout Category
        <select name="category" defaultValue={initialCategory || categories[0]?.name || ''} required>
          {categories.map((category) => (
            <option key={category.id} value={category.name}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label className="portal-form-span-2">
        Description
        <textarea name="description" rows={2} defaultValue={initialDescription} />
      </label>
      <div className="portal-form-span-2">
        <WorkoutExerciseSelector
          exercises={exercises}
          initialSelectedExerciseIds={initialSelectedExerciseIds}
          initialValuesByExerciseId={initialValuesByExerciseId}
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {isPending ? 'Saving...' : 'Save Workout'}
      </button>
      {message ? <p className="auth-message portal-form-span-2">{message}</p> : null}
      {error ? <p className="auth-error portal-form-span-2">{error}</p> : null}
    </form>
  );
}

export function AsyncQuickExerciseForm({ categories }: { categories: ExerciseCategoryRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setError('');
    const form = event.currentTarget;
    const result = await postForm('/api/admin/exercises', new FormData(form));
    if (!result.ok) {
      setError(result.error || 'Failed to save exercise.');
      return;
    }
    setMessage('Exercise saved.');
    form.reset();
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <form method="post" action="/api/admin/exercises" className="portal-form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="redirectTo" value="/portal/admin/workouts" />
      <label>
        Name
        <input name="name" required />
      </label>
      <label>
        Category
        <select name="category" defaultValue={categories[0]?.name ?? ''} required>
          {categories.map((category) => (
            <option key={category.id} value={category.name}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Rep Type
        <select name="repMeasure" defaultValue="reps">
          <option value="reps">Reps</option>
          <option value="seconds">Seconds</option>
          <option value="distance">Distance</option>
        </select>
      </label>
      <label>
        Tracking Type
        <select name="trackingType" defaultValue="lbs">
          <option value="lbs">lbs</option>
          <option value="seconds">seconds</option>
          <option value="inches">inches</option>
          <option value="body_weight">Body Weight</option>
        </select>
      </label>
      <label className="portal-checkbox-label">
        <input type="checkbox" name="repsPerSide" />
        Use reps per side
      </label>
      <label>
        Video URL
        <input name="instructionVideoUrl" type="url" placeholder="https://..." />
      </label>
      <label className="portal-form-span-2">
        Description
        <textarea name="description" rows={2} />
      </label>
      <button type="submit" className="btn btn-ghost" disabled={isPending}>
        {isPending ? 'Saving...' : 'Save Exercise'}
      </button>
      {message ? <p className="auth-message portal-form-span-2">{message}</p> : null}
      {error ? <p className="auth-error portal-form-span-2">{error}</p> : null}
    </form>
  );
}

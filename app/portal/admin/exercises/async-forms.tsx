'use client';

import { FormEvent, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ExerciseCategoryRow } from '../../../../lib/training-db';

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
  if (!response.ok || payload.ok === false) {
    return { ok: false, error: payload.error || 'Request failed.' };
  }
  return { ok: true, message: payload.message };
}

export function AsyncExerciseCategoryForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setError('');
    const form = event.currentTarget;
    const result = await postForm('/api/admin/exercise-categories', new FormData(form));
    if (!result.ok) {
      setError(result.error || 'Failed to add category.');
      return;
    }
    setMessage('Category added.');
    form.reset();
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <form method="post" action="/api/admin/exercise-categories" className="portal-form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="redirectTo" value="/portal/admin/exercises" />
      <label>
        New Category Name
        <input name="name" placeholder="Mobility, Plyo, Warmup..." required />
      </label>
      <button type="submit" className="btn btn-ghost" disabled={isPending}>
        {isPending ? 'Adding...' : 'Add Category'}
      </button>
      {message ? <p className="auth-message portal-form-span-2">{message}</p> : null}
      {error ? <p className="auth-error portal-form-span-2">{error}</p> : null}
    </form>
  );
}

export function AsyncExerciseCreateForm({ categories }: { categories: ExerciseCategoryRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

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
      <input type="hidden" name="redirectTo" value="/portal/admin/exercises" />
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
        Instruction Video URL
        <input name="instructionVideoUrl" type="url" placeholder="https://..." />
      </label>
      <label className="portal-form-span-2">
        Description
        <textarea name="description" rows={3} />
      </label>
      <label className="portal-form-span-2">
        Coaching Cues
        <textarea name="coachingCues" rows={3} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {isPending ? 'Saving...' : 'Save Exercise'}
      </button>
      {message ? <p className="auth-message portal-form-span-2">{message}</p> : null}
      {error ? <p className="auth-error portal-form-span-2">{error}</p> : null}
    </form>
  );
}

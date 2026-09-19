'use client';

import { FormEvent, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ExerciseCategoryRow } from '../../../../lib/training-db';
import { uploadExerciseVideo } from '../../../../lib/upload-exercise-video';

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
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setError('');
    setIsSaving(true);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const videoFile = formData.get('instructionVideoFile');
    try {
      if (videoFile instanceof File && videoFile.size > 0) {
        formData.set('instructionVideoUrl', await uploadExerciseVideo(videoFile));
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Video upload failed.');
      setIsSaving(false);
      return;
    }
    formData.delete('instructionVideoFile');
    const result = await postForm('/api/admin/exercises', formData);
    if (!result.ok) {
      setError(result.error || 'Failed to save exercise.');
      setIsSaving(false);
      return;
    }
    setMessage('Exercise saved.');
    form.reset();
    startTransition(() => {
      router.refresh();
    });
    setIsSaving(false);
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
          <option value="velocity">Velocity (mph)</option>
          <option value="body_weight">Body Weight</option>
        </select>
      </label>
      <label className="portal-checkbox-label">
        <input type="checkbox" name="repsPerSide" />
        Use reps per side
      </label>
      <label>
        Instruction Video Link
        <input name="instructionVideoUrl" type="url" placeholder="YouTube, Instagram, TikTok, X, or direct video URL" />
      </label>
      <label>
        Or Upload a Video
        <input name="instructionVideoFile" type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v" />
        <small className="portal-muted-text">An uploaded file replaces the link above. Maximum 350 MB.</small>
      </label>
      <label className="portal-form-span-2">
        Description
        <textarea name="description" rows={3} />
      </label>
      <label className="portal-form-span-2">
        Coaching Cues
        <textarea name="coachingCues" rows={3} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={isPending || isSaving}>
        {isPending || isSaving ? 'Saving...' : 'Save Exercise'}
      </button>
      {message ? <p className="auth-message portal-form-span-2">{message}</p> : null}
      {error ? <p className="auth-error portal-form-span-2">{error}</p> : null}
    </form>
  );
}

type EditableExercise = {
  id: number;
  name: string;
  category: string;
  repMeasure: string;
  trackingType: string;
  repsPerSide: boolean;
  description: string | null;
  instructionVideoUrl: string | null;
  coachingCues: string | null;
};

export function AsyncExerciseEditForm({ exercise, categories }: { exercise: EditableExercise; categories: ExerciseCategoryRow[] }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsPending(true);
    setError('');
    const formData = new FormData(event.currentTarget);
    const videoFile = formData.get('instructionVideoFile');
    try {
      if (videoFile instanceof File && videoFile.size > 0) {
        formData.set('instructionVideoUrl', await uploadExerciseVideo(videoFile));
      }
      formData.delete('instructionVideoFile');
      const result = await postForm('/api/admin/exercises/update', formData);
      if (!result.ok) throw new Error(result.error || 'Failed to update exercise.');
      router.push('/portal/admin/exercises?ok=Exercise%20updated.');
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update exercise.');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form method="post" action="/api/admin/exercises/update" className="portal-form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="exerciseId" value={String(exercise.id)} />
      <label>Name<input name="name" defaultValue={exercise.name} required /></label>
      <label>
        Category
        <select name="category" defaultValue={exercise.category} required>
          {categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
        </select>
      </label>
      <label>
        Rep Type
        <select name="repMeasure" defaultValue={exercise.repMeasure}>
          <option value="reps">Reps</option><option value="seconds">Seconds</option><option value="distance">Distance</option>
        </select>
      </label>
      <label>
        Tracking Type
        <select name="trackingType" defaultValue={exercise.trackingType}>
          <option value="lbs">lbs</option><option value="seconds">seconds</option><option value="inches">inches</option>
          <option value="velocity">Velocity (mph)</option><option value="body_weight">Body Weight</option>
        </select>
      </label>
      <label className="portal-checkbox-label"><input type="checkbox" name="repsPerSide" defaultChecked={exercise.repsPerSide} />Use reps per side</label>
      <label>
        Instruction Video Link
        <input name="instructionVideoUrl" type="url" defaultValue={exercise.instructionVideoUrl ?? ''} placeholder="YouTube, Instagram, TikTok, X, or direct video URL" />
      </label>
      <label>
        Replace with Uploaded Video
        <input name="instructionVideoFile" type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v" />
        <small className="portal-muted-text">Maximum 350 MB.</small>
      </label>
      <label className="portal-form-span-2">Description<textarea name="description" rows={3} defaultValue={exercise.description ?? ''} /></label>
      <label className="portal-form-span-2">Coaching Cues<textarea name="coachingCues" rows={3} defaultValue={exercise.coachingCues ?? ''} /></label>
      <button type="submit" className="btn btn-primary" disabled={isPending}>{isPending ? 'Saving...' : 'Save Changes'}</button>
      {error ? <p className="auth-error portal-form-span-2">{error}</p> : null}
    </form>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import {
  getExerciseByIdInOrganization,
  listExerciseCategoriesByOrganization,
} from '../../../../../lib/training-db';

type EditExercisePageProps = {
  params: Promise<{ exerciseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readMessage(params: Record<string, string | string[] | undefined>) {
  const error = typeof params.error === 'string' ? params.error : '';
  return { error };
}

export default async function EditExercisePage({ params, searchParams }: EditExercisePageProps) {
  const session = await requirePortalSession();
  if (session.role === 'player') notFound();

  const { exerciseId: rawExerciseId } = await params;
  const exerciseId = Number(rawExerciseId);
  if (!Number.isFinite(exerciseId) || exerciseId <= 0) notFound();

  const [exercise, categories, query] = await Promise.all([
    getExerciseByIdInOrganization({ organizationId: session.organizationId, exerciseId }),
    listExerciseCategoriesByOrganization(session.organizationId),
    searchParams,
  ]);
  if (!exercise) notFound();

  const { error } = readMessage(query);

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Edit Exercise</h2>
        <p>
          Update fields for this exercise.
          <Link href="/portal/admin/exercises" className="portal-inline-link">
            Back to Library
          </Link>
        </p>
      </div>

      <article className="portal-admin-card">
        <h3>{exercise.name}</h3>
        <form method="post" action="/api/admin/exercises/update" className="portal-form-grid">
          <input type="hidden" name="exerciseId" value={String(exercise.id)} />
          <input type="hidden" name="redirectTo" value={`/portal/admin/exercises/${exercise.id}`} />
          <label>
            Name
            <input name="name" defaultValue={exercise.name} required />
          </label>
          <label>
            Category
            <select name="category" defaultValue={exercise.category} required>
              {categories.map((category) => (
                <option key={category.id} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rep Type
            <select name="repMeasure" defaultValue={exercise.repMeasure}>
              <option value="reps">Reps</option>
              <option value="seconds">Seconds</option>
              <option value="distance">Distance</option>
            </select>
          </label>
          <label className="portal-checkbox-label">
            <input type="checkbox" name="repsPerSide" defaultChecked={exercise.repsPerSide} />
            Use reps per side
          </label>
          <label>
            Instruction Video URL
            <input name="instructionVideoUrl" type="url" defaultValue={exercise.instructionVideoUrl ?? ''} />
          </label>
          <label className="portal-form-span-2">
            Description
            <textarea name="description" rows={3} defaultValue={exercise.description ?? ''} />
          </label>
          <label className="portal-form-span-2">
            Coaching Cues
            <textarea name="coachingCues" rows={3} defaultValue={exercise.coachingCues ?? ''} />
          </label>
          <button type="submit" className="btn btn-primary">
            Save Changes
          </button>
        </form>
        <form method="post" action="/api/admin/exercises/delete" className="portal-delete-form">
          <input type="hidden" name="exerciseId" value={String(exercise.id)} />
          <input type="hidden" name="redirectTo" value={`/portal/admin/exercises/${exercise.id}`} />
          <button type="submit" className="btn btn-ghost">
            Delete Exercise
          </button>
          <p className="portal-muted-text">
            Deleting only works when the exercise is not used in workouts or programs.
          </p>
        </form>
        {error && <p className="auth-error">{error}</p>}
      </article>
    </div>
  );
}

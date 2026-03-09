import { requirePortalSession } from '../../../../lib/portal-session';
import { listExerciseCategoriesByOrganization, listExercisesByOrganization } from '../../../../lib/training-db';
import ExerciseLibrary from './exercise-library';

type ExercisePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  return { ok, error };
}

export default async function AdminExercisesPage({ searchParams }: ExercisePageProps) {
  const session = await requirePortalSession();
  const [exercises, categories] = await Promise.all([
    listExercisesByOrganization(session.organizationId),
    listExerciseCategoriesByOrganization(session.organizationId),
  ]);
  const params = await searchParams;
  const { ok, error } = readMessage(params);

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Exercise + Drill Library</h2>
        <p>Create reusable movement cards and attach video demos to each one.</p>
      </div>

      <article className="portal-admin-card">
        <h3>Exercise Categories</h3>
        <form method="post" action="/api/admin/exercise-categories" className="portal-form-grid">
          <input type="hidden" name="redirectTo" value="/portal/admin/exercises" />
          <label>
            New Category Name
            <input name="name" placeholder="Mobility, Plyo, Warmup..." required />
          </label>
          <button type="submit" className="btn btn-ghost">
            Add Category
          </button>
        </form>
        <div className="portal-tag-row">
          {categories.map((category) => (
            <span key={category.id} className="portal-tag">
              {category.name}
            </span>
          ))}
        </div>
      </article>

      <article className="portal-admin-card">
        <h3>Add Exercise</h3>
        <form method="post" action="/api/admin/exercises" className="portal-form-grid">
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
          <button type="submit" className="btn btn-primary">
            Save Exercise
          </button>
        </form>
        {ok && <p className="auth-message">{ok}</p>}
        {error && <p className="auth-error">{error}</p>}
      </article>

      <article className="portal-admin-card">
        <h3>Library</h3>
        {exercises.length === 0 ? <p>No exercises added yet.</p> : <ExerciseLibrary exercises={exercises} />}
      </article>
    </div>
  );
}

import Link from 'next/link';
import { requirePortalSession } from '../../../../lib/portal-session';
import {
  listExerciseCategoriesByOrganization,
  listExercisesByOrganization,
  listWorkoutsByOrganization,
} from '../../../../lib/training-db';
import DeleteWorkoutForm from './delete-workout-form';
import WorkoutExerciseSelector from './exercise-selector';

type WorkoutPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  return { ok, error };
}

export default async function AdminWorkoutsPage({ searchParams }: WorkoutPageProps) {
  const session = await requirePortalSession();
  const params = await searchParams;
  const { ok, error } = readMessage(params);

  const [workouts, exercises, categories] = await Promise.all([
    listWorkoutsByOrganization(session.organizationId),
    listExercisesByOrganization(session.organizationId),
    listExerciseCategoriesByOrganization(session.organizationId),
  ]);

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Workout Builder</h2>
        <p>Create workouts from saved exercises, or add a new exercise directly here.</p>
      </div>

      <article className="portal-admin-card">
        <h3>Create Workout</h3>
        <form method="post" action="/api/admin/workouts" className="portal-form-grid">
          <input type="hidden" name="redirectTo" value="/portal/admin/workouts" />
          <label>
            Workout Name
            <input name="name" required />
          </label>
          <label>
            Workout Category
            <select name="category" defaultValue={categories[0]?.name ?? ''} required>
              {categories.map((category) => (
                <option key={category.id} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-form-span-2">
            Description
            <textarea name="description" rows={2} />
          </label>
          <div className="portal-form-span-2">
            <WorkoutExerciseSelector exercises={exercises} />
          </div>
          <button type="submit" className="btn btn-primary">
            Save Workout
          </button>
        </form>
      </article>

      <article className="portal-admin-card">
        <h3>Quick Add Exercise (from workout page)</h3>
        <form method="post" action="/api/admin/exercises" className="portal-form-grid">
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
          <button type="submit" className="btn btn-ghost">
            Save Exercise
          </button>
        </form>
      </article>

      {ok && <p className="auth-message">{ok}</p>}
      {error && <p className="auth-error">{error}</p>}

      <article className="portal-admin-card">
        <h3>Saved Workouts</h3>
        {workouts.length === 0 ? (
          <p>No workouts created yet.</p>
        ) : (
          <div className="portal-exercise-grid">
            {workouts.map((workout) => (
              <article key={workout.id} className="portal-exercise-card">
                <h4>{workout.name}</h4>
                <p className="portal-muted-text">{workout.category}</p>
                <p className="portal-muted-text">{workout.exerciseCount} exercises</p>
                {workout.description && <p>{workout.description}</p>}
                {workout.exerciseNames.length > 0 && <p>{workout.exerciseNames.join(', ')}</p>}
                <Link href={`/portal/admin/workouts/${workout.id}`} className="btn btn-primary as-link portal-workout-action-btn">
                  Edit Workout
                </Link>
                <DeleteWorkoutForm workoutId={workout.id} workoutName={workout.name} />
              </article>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

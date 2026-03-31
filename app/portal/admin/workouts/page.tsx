import Link from 'next/link';
import { requirePortalSession } from '../../../../lib/portal-session';
import {
  listExerciseCategoriesByOrganization,
  listExercisesByOrganization,
  listWorkoutsByOrganization,
} from '../../../../lib/training-db';
import { resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import DeleteWorkoutForm from './delete-workout-form';
import { AsyncQuickExerciseForm, AsyncWorkoutCreateForm } from './async-forms';

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
  const programmingOrganizationId = resolveProgrammingOrganizationId(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const params = await searchParams;
  const { ok, error } = readMessage(params);

  const [workouts, exercises, categories] = await Promise.all([
    programmingOrganizationId > 0 ? listWorkoutsByOrganization(programmingOrganizationId) : Promise.resolve([]),
    programmingOrganizationId > 0 ? listExercisesByOrganization(programmingOrganizationId) : Promise.resolve([]),
    programmingOrganizationId > 0 ? listExerciseCategoriesByOrganization(programmingOrganizationId) : Promise.resolve([]),
  ]);

  return (
    <div className="portal-admin-stack">
      {programmingOrganizationId <= 0 ? (
        <article className="portal-admin-card">
          <h3>Programming Data</h3>
          <p>No programming data is configured for {programmingSchoolCode} yet.</p>
        </article>
      ) : null}
      <div className="portal-admin-headline">
        <h2>Workout Builder</h2>
        <p>Create workouts from saved exercises, or add a new exercise directly here.</p>
      </div>

      {programmingOrganizationId > 0 ? (
      <article className="portal-admin-card">
        <h3>Create Workout</h3>
        <AsyncWorkoutCreateForm categories={categories} exercises={exercises} />
      </article>
      ) : null}

      {programmingOrganizationId > 0 ? (
      <article className="portal-admin-card">
        <h3>Quick Add Exercise (from workout page)</h3>
        <AsyncQuickExerciseForm categories={categories} />
      </article>
      ) : null}

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

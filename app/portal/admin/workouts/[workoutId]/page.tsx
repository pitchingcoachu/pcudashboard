import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import {
  getWorkoutByIdInOrganization,
  listExerciseCategoriesByOrganization,
  listExercisesByOrganization,
} from '../../../../../lib/training-db';
import { resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import WorkoutExerciseSelector from '../exercise-selector';

type EditWorkoutPageProps = {
  params: Promise<{ workoutId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readMessage(params: Record<string, string | string[] | undefined>) {
  const error = typeof params.error === 'string' ? params.error : '';
  return { error };
}

export default async function EditWorkoutPage({ params, searchParams }: EditWorkoutPageProps) {
  const session = await requirePortalSession();
  if (session.role === 'player') notFound();
  const programmingOrganizationId = resolveProgrammingOrganizationId(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  if (programmingOrganizationId <= 0) {
    return (
      <div className="portal-admin-stack">
        <article className="portal-admin-card">
          <h3>Programming Data</h3>
          <p>No programming data is configured for {programmingSchoolCode} yet.</p>
        </article>
      </div>
    );
  }

  const { workoutId: rawWorkoutId } = await params;
  const workoutId = Number(rawWorkoutId);
  if (!Number.isFinite(workoutId) || workoutId <= 0) notFound();

  const [workout, exercises, categories, query] = await Promise.all([
    getWorkoutByIdInOrganization({ organizationId: programmingOrganizationId, workoutId }),
    listExercisesByOrganization(programmingOrganizationId),
    listExerciseCategoriesByOrganization(programmingOrganizationId),
    searchParams,
  ]);
  if (!workout) notFound();

  const { error } = readMessage(query);
  const initialSelectedExerciseIds = workout.items.map((item) => item.exerciseId);
  const initialValuesByExerciseId = Object.fromEntries(
    workout.items.map((item) => [
      item.exerciseId,
      {
        prefix: item.prefix ?? '',
        prescribedSets: item.prescribedSets ?? '',
        prescribedReps: item.prescribedReps ?? '',
        prescribedLoad: item.prescribedLoad ?? '',
        notes: item.notes ?? '',
      },
    ])
  );

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Edit Workout</h2>
        <p>
          Update workout details and selected exercises.
          <Link href="/portal/admin/workouts" className="portal-inline-link">
            Back to Workouts
          </Link>
        </p>
      </div>

      <article className="portal-admin-card">
        <h3>{workout.name}</h3>
        <form method="post" action="/api/admin/workouts/update" className="portal-form-grid">
          <input type="hidden" name="workoutId" value={String(workout.id)} />
          <input type="hidden" name="redirectTo" value={`/portal/admin/workouts/${workout.id}`} />
          <label>
            Workout Name
            <input name="name" defaultValue={workout.name} required />
          </label>
          <label>
            Workout Category
            <select name="category" defaultValue={workout.category} required>
              {categories.map((category) => (
                <option key={category.id} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-form-span-2">
            Description
            <textarea name="description" rows={2} defaultValue={workout.description ?? ''} />
          </label>
          <label className="portal-form-span-2">
            Calendar Click Target
            <select name="calendarLinkTarget" defaultValue={workout.calendarLinkTarget}>
              <option value="none">Open workout details</option>
              <option value="throwing">Throwing Calendar</option>
              <option value="bullpens">Bullpens</option>
              <option value="drills">Drills</option>
            </select>
          </label>
          <div className="portal-form-span-2">
            <WorkoutExerciseSelector
              exercises={exercises}
              initialSelectedExerciseIds={initialSelectedExerciseIds}
              initialValuesByExerciseId={initialValuesByExerciseId}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Save Changes
          </button>
        </form>
        {error && <p className="auth-error">{error}</p>}
      </article>
    </div>
  );
}

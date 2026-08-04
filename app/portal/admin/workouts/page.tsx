import Link from 'next/link';
import { requirePortalSession } from '../../../../lib/portal-session';
import {
  getWorkoutByIdInOrganization,
  listExerciseCategoriesByOrganization,
  listExercisesByOrganization,
  listWorkoutsByOrganization,
} from '../../../../lib/training-db';
import { resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { AsyncQuickExerciseForm, AsyncWorkoutCreateForm } from './async-forms';
import SavedWorkoutsList from './saved-workouts-list';

type WorkoutPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  return { ok, error };
}

function readDuplicateWorkoutId(params: Record<string, string | string[] | undefined>): number | null {
  const raw = typeof params.duplicateWorkoutId === 'string' ? params.duplicateWorkoutId : '';
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default async function AdminWorkoutsPage({ searchParams }: WorkoutPageProps) {
  const session = await requirePortalSession();
  const programmingOrganizationId = await resolveProgrammingOrganizationId(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const params = await searchParams;
  const { ok, error } = readMessage(params);
  const duplicateWorkoutId = readDuplicateWorkoutId(params);

  const [workouts, exercises, categories] = await Promise.all([
    programmingOrganizationId > 0 ? listWorkoutsByOrganization(programmingOrganizationId) : Promise.resolve([]),
    programmingOrganizationId > 0 ? listExercisesByOrganization(programmingOrganizationId) : Promise.resolve([]),
    programmingOrganizationId > 0 ? listExerciseCategoriesByOrganization(programmingOrganizationId) : Promise.resolve([]),
  ]);
  const duplicateWorkout =
    programmingOrganizationId > 0 && duplicateWorkoutId
      ? await getWorkoutByIdInOrganization({ organizationId: programmingOrganizationId, workoutId: duplicateWorkoutId })
      : null;
  const duplicateName = duplicateWorkout ? `${duplicateWorkout.name} (copy)` : '';
  const duplicateCategory = duplicateWorkout?.category ?? '';
  const duplicateDescription = duplicateWorkout?.description ?? '';
  const duplicateCalendarLinkTarget = duplicateWorkout?.calendarLinkTarget ?? 'none';
  const duplicateSelectedExerciseIds = duplicateWorkout ? duplicateWorkout.items.map((item) => item.exerciseId) : [];
  const duplicateValuesByExerciseId = duplicateWorkout
    ? Object.fromEntries(
        duplicateWorkout.items.map((item) => [
          item.exerciseId,
          {
            prefix: item.prefix ?? '',
            prescribedSets: item.prescribedSets ?? '',
            prescribedReps: item.prescribedReps ?? '',
            prescribedLoad: item.prescribedLoad ?? '',
            notes: item.notes ?? '',
          },
        ])
      )
    : {};

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
      <article id="create-workout" className="portal-admin-card">
        <h3>Create Workout</h3>
        <AsyncWorkoutCreateForm
          key={duplicateWorkoutId ? `dup-${duplicateWorkoutId}` : 'new-workout'}
          categories={categories}
          exercises={exercises}
          initialName={duplicateName}
          initialCategory={duplicateCategory}
          initialDescription={duplicateDescription}
          initialCalendarLinkTarget={duplicateCalendarLinkTarget}
          initialSelectedExerciseIds={duplicateSelectedExerciseIds}
          initialValuesByExerciseId={duplicateValuesByExerciseId}
        />
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
        <SavedWorkoutsList workouts={workouts} />
      </article>
    </div>
  );
}

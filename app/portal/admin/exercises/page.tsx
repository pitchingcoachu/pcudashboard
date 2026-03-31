import { requirePortalSession } from '../../../../lib/portal-session';
import { listExerciseCategoriesByOrganization, listExercisesByOrganization } from '../../../../lib/training-db';
import { resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import ExerciseLibrary from './exercise-library';
import { AsyncExerciseCategoryForm, AsyncExerciseCreateForm } from './async-forms';

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
  const programmingOrganizationId = resolveProgrammingOrganizationId(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const [exercises, categories] = await Promise.all([
    programmingOrganizationId > 0 ? listExercisesByOrganization(programmingOrganizationId) : Promise.resolve([]),
    programmingOrganizationId > 0 ? listExerciseCategoriesByOrganization(programmingOrganizationId) : Promise.resolve([]),
  ]);
  const params = await searchParams;
  const { ok, error } = readMessage(params);

  return (
    <div className="portal-admin-stack">
      {programmingOrganizationId <= 0 ? (
        <article className="portal-admin-card">
          <h3>Programming Data</h3>
          <p>No programming data is configured for {programmingSchoolCode} yet.</p>
        </article>
      ) : null}
      <div className="portal-admin-headline">
        <h2>Exercise + Drill Library</h2>
        <p>Create reusable movement cards and attach video demos to each one.</p>
      </div>

      {programmingOrganizationId > 0 ? (
      <article className="portal-admin-card">
        <h3>Exercise Categories</h3>
        <AsyncExerciseCategoryForm />
        <div className="portal-tag-row">
          {categories.map((category) => (
            <span key={category.id} className="portal-tag">
              {category.name}
            </span>
          ))}
        </div>
      </article>
      ) : null}

      {programmingOrganizationId > 0 ? (
      <article className="portal-admin-card">
        <h3>Add Exercise</h3>
        <AsyncExerciseCreateForm categories={categories} />
        {ok && <p className="auth-message">{ok}</p>}
        {error && <p className="auth-error">{error}</p>}
      </article>
      ) : null}

      <article className="portal-admin-card">
        <h3>Library</h3>
        {exercises.length === 0 ? <p>No exercises added yet.</p> : <ExerciseLibrary exercises={exercises} />}
      </article>
    </div>
  );
}

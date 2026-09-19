import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import {
  getExerciseByIdInOrganization,
  listExerciseCategoriesByOrganization,
} from '../../../../../lib/training-db';
import { resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import { AsyncExerciseEditForm } from '../async-forms';

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
  const programmingOrganizationId = await resolveProgrammingOrganizationId(session);
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

  const { exerciseId: rawExerciseId } = await params;
  const exerciseId = Number(rawExerciseId);
  if (!Number.isFinite(exerciseId) || exerciseId <= 0) notFound();

  const [exercise, categories, query] = await Promise.all([
    getExerciseByIdInOrganization({ organizationId: programmingOrganizationId, exerciseId }),
    listExerciseCategoriesByOrganization(programmingOrganizationId),
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
        <AsyncExerciseEditForm exercise={exercise} categories={categories} />
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

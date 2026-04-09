import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import { listClientsByOrganization, listCoachesByOrganization, resolveOrganizationIdForSchool } from '../../../../lib/training-db';
import {
  canUseClientManagement,
  resolveProgrammingSchoolCode,
} from '../../../../lib/programming-scope';
import { CoachesTable } from './table-client';

export const dynamic = 'force-dynamic';

type CoachPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  return { ok, error };
}

export default async function AdminCoachesPage({ searchParams }: CoachPageProps) {
  const session = await requirePortalSession();
  if (session.role !== 'admin') notFound();
  const canAccessClientManagement = canUseClientManagement(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const clientManagementOrganizationId = await resolveOrganizationIdForSchool({
    schoolCode: programmingSchoolCode,
    fallbackOrganizationId: 0,
    createIfMissing: session.role === 'admin' && programmingSchoolCode !== 'LEAGUE',
  });

  const [coaches, clients, params] = await Promise.all([
    clientManagementOrganizationId > 0 ? listCoachesByOrganization(clientManagementOrganizationId) : Promise.resolve([]),
    clientManagementOrganizationId > 0 ? listClientsByOrganization(clientManagementOrganizationId) : Promise.resolve([]),
    searchParams,
  ]);
  const { ok, error } = readMessage(params);
  const editIdRaw = typeof params.edit === 'string' ? params.edit : '';
  const editId = Number(editIdRaw);
  const coachToEdit =
    Number.isFinite(editId) && editId > 0
      ? coaches.find((coach) => Number(coach.userId) === editId) ?? null
      : null;

  return (
    <div className="portal-admin-stack">
      {!canAccessClientManagement || clientManagementOrganizationId <= 0 ? (
        <article className="portal-admin-card">
          <h3>Coach Management</h3>
          <p>Coach login management is not enabled for {programmingSchoolCode}.</p>
        </article>
      ) : null}
      <div className="portal-admin-headline">
        <h2>Coaches</h2>
        <p>Create coach/admin logins and assign coaches to player profiles.</p>
      </div>

      {canAccessClientManagement && clientManagementOrganizationId > 0 ? (
      <article className="portal-admin-card">
        <h3>Add Coach Profile</h3>
        <form method="post" action="/api/admin/coaches" className="portal-form-grid">
          <input type="hidden" name="redirectTo" value="/portal/admin/coaches" />
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Phone
            <input name="phone" type="tel" />
          </label>
          <label>
            Role
            <select name="role" defaultValue="coach">
              <option value="coach">Coach</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label>
            Temporary Password
            <input name="password" type="text" minLength={8} required />
          </label>
          <button type="submit" className="btn btn-primary">
            Create Coach
          </button>
        </form>
        {ok && <p className="auth-message">{ok}</p>}
        {error && <p className="auth-error">{error}</p>}
      </article>
      ) : null}

      {canAccessClientManagement && clientManagementOrganizationId > 0 && coachToEdit ? (
        <article className="portal-admin-card">
          <h3>Edit Coach</h3>
          <form method="post" action="/api/admin/coaches/manage" className="portal-form-grid">
            <input type="hidden" name="redirectTo" value="/portal/admin/coaches" />
            <input type="hidden" name="action" value="update" />
            <input type="hidden" name="staffUserId" value={String(coachToEdit.userId)} />
            <label>
              Name
              <input name="name" defaultValue={coachToEdit.name} required />
            </label>
            <label>
              Email
              <input name="email" type="email" defaultValue={coachToEdit.email} required />
            </label>
            <label>
              Phone
              <input name="phone" type="tel" defaultValue={coachToEdit.phone ?? ''} />
            </label>
            <label>
              Role
              <select name="role" defaultValue={coachToEdit.role}>
                <option value="coach">Coach</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <div className="portal-choice-line-actions">
              <button type="submit" className="btn btn-primary">
                Save Coach
              </button>
              <Link className="btn btn-ghost as-link" href="/portal/admin/coaches">
                Cancel
              </Link>
            </div>
          </form>
        </article>
      ) : null}

      <article className="portal-admin-card">
        <h3>Current Coaches</h3>
        {coaches.length === 0 ? (
          <p>No coaches yet.</p>
        ) : (
          <CoachesTable coaches={coaches} clients={clients} currentUserId={session.userId} />
        )}
      </article>
    </div>
  );
}

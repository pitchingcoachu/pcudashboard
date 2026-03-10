import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import { listCoachesByOrganization } from '../../../../lib/training-db';

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

  const [coaches, params] = await Promise.all([
    listCoachesByOrganization(session.organizationId),
    searchParams,
  ]);
  const { ok, error } = readMessage(params);

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Coaches</h2>
        <p>Create coach/admin logins and assign coaches to player profiles.</p>
      </div>

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

      <article className="portal-admin-card">
        <h3>Current Coaches</h3>
        {coaches.length === 0 ? (
          <p>No coaches yet.</p>
        ) : (
          <div className="portal-table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Assigned</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {coaches.map((coach) => (
                  <tr key={coach.userId}>
                    <td>{coach.name}</td>
                    <td>{coach.email}</td>
                    <td>{coach.phone ?? '-'}</td>
                    <td>{coach.role}</td>
                    <td>{coach.isActive ? 'Active' : 'Inactive'}</td>
                    <td>{coach.assignedPlayerCount}</td>
                    <td className="portal-table-actions">
                      {coach.userId === session.userId ? (
                        <span className="portal-muted-text">Current user</span>
                      ) : (
                        <>
                          <form method="post" action="/api/admin/coaches/manage">
                            <input type="hidden" name="redirectTo" value="/portal/admin/coaches" />
                            <input type="hidden" name="staffUserId" value={String(coach.userId)} />
                            <input type="hidden" name="action" value={coach.isActive ? 'deactivate' : 'activate'} />
                            <button type="submit" className="btn btn-ghost">
                              {coach.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          </form>
                          <form method="post" action="/api/admin/coaches/manage">
                            <input type="hidden" name="redirectTo" value="/portal/admin/coaches" />
                            <input type="hidden" name="staffUserId" value={String(coach.userId)} />
                            <input type="hidden" name="action" value="delete" />
                            <button type="submit" className="btn btn-ghost">
                              Delete
                            </button>
                          </form>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import { listClientsByOrganization, listCoachesByOrganization } from '../../../../lib/training-db';
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

  const [coaches, clients, params] = await Promise.all([
    listCoachesByOrganization(session.organizationId),
    listClientsByOrganization(session.organizationId),
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
          <CoachesTable coaches={coaches} clients={clients} currentUserId={session.userId} />
        )}
      </article>
    </div>
  );
}

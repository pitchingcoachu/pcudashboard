import Link from 'next/link';
import { requirePortalSession } from '../../../../lib/portal-session';
import { listClientsByOrganization } from '../../../../lib/training-db';

type ClientPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  return { ok, error };
}

export default async function AdminClientsPage({ searchParams }: ClientPageProps) {
  const session = await requirePortalSession();
  const clients = await listClientsByOrganization(session.organizationId);
  const params = await searchParams;
  const { ok, error } = readMessage(params);

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Client Management</h2>
        <p>Add players, create logins, and launch their plans.</p>
      </div>

      <article className="portal-admin-card">
        <h3>Add Client Login</h3>
        <form method="post" action="/api/admin/clients" className="portal-form-grid">
          <input type="hidden" name="redirectTo" value="/portal/admin/clients" />
          <label>
            Full Name
            <input name="fullName" required />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Date Of Birth
            <input name="dateOfBirth" type="date" />
          </label>
          <label>
            School / Team
            <input name="schoolTeam" />
          </label>
          <label>
            Phone Number
            <input name="phone" type="tel" />
          </label>
          <label>
            College Commitment
            <input name="collegeCommitment" />
          </label>
          <label>
            Bats
            <select name="batsHand" defaultValue="">
              <option value="">-</option>
              <option value="Right">Right</option>
              <option value="Left">Left</option>
              <option value="Switch">Switch</option>
            </select>
          </label>
          <label>
            Throws
            <select name="throwsHand" defaultValue="">
              <option value="">-</option>
              <option value="Right">Right</option>
              <option value="Left">Left</option>
            </select>
          </label>
          <label>
            Temporary Password
            <input name="password" type="text" minLength={8} required />
          </label>
          <button type="submit" className="btn btn-primary">
            Add Client
          </button>
        </form>
        {ok && <p className="auth-message">{ok}</p>}
        {error && <p className="auth-error">{error}</p>}
      </article>

      <article className="portal-admin-card">
        <h3>Current Clients</h3>
        {clients.length === 0 ? (
          <p>No clients yet.</p>
        ) : (
          <div className="portal-table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.playerId}>
                    <td>{client.fullName}</td>
                    <td>{client.email}</td>
                    <td>{client.status}</td>
                    <td className="portal-table-actions">
                      <Link className="btn btn-ghost as-link" href={`/portal/admin/programs/${client.playerId}`}>
                        Build Program
                      </Link>
                      <Link className="btn btn-ghost as-link" href={`/portal/player?previewPlayerId=${client.playerId}`}>
                        View Profile
                      </Link>
                      <Link className="btn btn-ghost as-link" href={`/portal/player/program?previewPlayerId=${client.playerId}`}>
                        Preview Program
                      </Link>
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

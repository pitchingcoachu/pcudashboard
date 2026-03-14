import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import { listClientsByOrganization, listCoachesByOrganization } from '../../../../lib/training-db';

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
  if (session.role === 'player') notFound();

  const [clients, coaches] = await Promise.all([
    listClientsByOrganization(session.organizationId),
    listCoachesByOrganization(session.organizationId),
  ]);
  const params = await searchParams;
  const { ok, error } = readMessage(params);
  const query = typeof params.q === 'string' ? params.q.trim().toLowerCase() : '';
  const coachFilter = typeof params.coach === 'string' ? params.coach.trim() : '';
  const coachFilterId = Number(coachFilter);
  const visibleClients = clients.filter((client) => {
    const matchesRole = session.role === 'coach' ? client.assignedCoachUserId === (session.userId ?? 0) : true;
    const matchesCoach = !coachFilter
      ? true
      : Number.isFinite(coachFilterId) && coachFilterId > 0
        ? client.assignedCoachUserId === coachFilterId
        : false;
    const matchesQuery = !query
      ? true
      : [client.fullName, client.email, client.assignedCoachName ?? ''].join(' ').toLowerCase().includes(query);
    return matchesRole && matchesCoach && matchesQuery;
  });

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
            Grad Year
            <input name="gradYear" />
          </label>
          <label>
            Position
            <input name="position" />
          </label>
          <label>
            Height
            <input name="height" placeholder={`6'2"`} />
          </label>
          <label>
            Profile Weight (lbs)
            <input name="profileWeightLbs" type="number" min={1} step={1} />
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
            Assigned Coach
            {session.role === 'coach' ? (
              <>
                <input value={session.name ?? session.email} readOnly />
                <input type="hidden" name="assignedCoachUserId" value={String(session.userId ?? '')} />
              </>
            ) : (
              <select name="assignedCoachUserId" defaultValue="">
                <option value="">Unassigned</option>
                {coaches.map((coach) => (
                  <option key={coach.userId} value={String(coach.userId)}>
                    {coach.name} ({coach.role})
                  </option>
                ))}
              </select>
            )}
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
        <form method="get" className="portal-form-grid" style={{ marginBottom: '0.75rem' }}>
          <label>
            Search
            <input name="q" defaultValue={typeof params.q === 'string' ? params.q : ''} placeholder="Player, email, or coach..." />
          </label>
          <label>
            Assigned Coach
            <select name="coach" defaultValue={coachFilter}>
              <option value="">All coaches</option>
              {coaches.map((coach) => (
                <option key={coach.userId} value={String(coach.userId)}>
                  {coach.name}
                </option>
              ))}
            </select>
          </label>
          <div className="portal-choice-line-actions">
            <button type="submit" className="btn btn-ghost">
              Filter
            </button>
            <Link href="/portal/admin/clients" className="btn btn-ghost as-link">
              Clear
            </Link>
          </div>
        </form>
        {visibleClients.length === 0 ? (
          <p>No clients yet.</p>
        ) : (
          <div className="portal-table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Email</th>
                  <th>Coach</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleClients.map((client) => (
                  <tr key={client.playerId}>
                    <td>{client.fullName}</td>
                    <td>{client.email}</td>
                    <td>{client.assignedCoachName ?? '-'}</td>
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

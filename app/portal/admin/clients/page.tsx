import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import { listClientsByOrganizationPaged, listCoachesByOrganization, resolveOrganizationIdForSchool } from '../../../../lib/training-db';
import {
  canUseClientManagement,
  canUseProgrammingData,
  resolveClientManagementOrganizationId,
  resolveProgrammingSchoolCode,
} from '../../../../lib/programming-scope';

type ClientPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  return { ok, error };
}

function parsePositiveInt(value: string | string[] | undefined, fallback: number): number {
  const raw = typeof value === 'string' ? value : '';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

export default async function AdminClientsPage({ searchParams }: ClientPageProps) {
  const session = await requirePortalSession();
  if (session.role === 'player') notFound();
  const canAccessClientManagement = canUseClientManagement(session);
  const canAccessProgramming = canUseProgrammingData(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const clientManagementOrganizationId = await resolveOrganizationIdForSchool({
    schoolCode: programmingSchoolCode,
    fallbackOrganizationId: resolveClientManagementOrganizationId(session),
    createIfMissing: false,
  });

  const params = await searchParams;
  const { ok, error } = readMessage(params);
  const query = typeof params.q === 'string' ? params.q.trim() : '';
  const coachFilter = typeof params.coach === 'string' ? params.coach.trim() : '';
  const page = parsePositiveInt(params.page, 1);
  const pageSize = 100;
  const coachFilterId = Number(coachFilter);
  const requestedCoachFilterId = Number.isFinite(coachFilterId) && coachFilterId > 0 ? coachFilterId : null;
  const [clientPage, coaches] = await Promise.all([
    clientManagementOrganizationId > 0
      ? listClientsByOrganizationPaged({
          organizationId: clientManagementOrganizationId,
          page,
          pageSize,
          query,
          coachUserId: requestedCoachFilterId,
          assignedCoachOnlyUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
        })
      : Promise.resolve({ rows: [], totalCount: 0, page: 1, pageSize }),
    clientManagementOrganizationId > 0 ? listCoachesByOrganization(clientManagementOrganizationId) : Promise.resolve([]),
  ]);
  const pagedClients = clientPage.rows;
  const visibleClientCount = clientPage.totalCount;
  const totalPages = Math.max(1, Math.ceil(visibleClientCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageHref = (nextPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set('q', query);
    if (coachFilter) search.set('coach', coachFilter);
    if (nextPage > 1) search.set('page', String(nextPage));
    const suffix = search.toString();
    return suffix ? `/portal/admin/clients?${suffix}` : '/portal/admin/clients';
  };

  return (
    <div className="portal-admin-stack">
      {!canAccessClientManagement || clientManagementOrganizationId <= 0 ? (
        <article className="portal-admin-card">
          <h3>Client Management</h3>
          <p>Client login management is not enabled for {programmingSchoolCode}.</p>
        </article>
      ) : null}
      <div className="portal-admin-headline">
        <h2>Player Management</h2>
        <p>Add players, create logins, and launch their plans.</p>
      </div>

      {canAccessClientManagement && clientManagementOrganizationId > 0 ? (
      <article className="portal-admin-card">
        <h3>Add Player Login</h3>
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
            Add Player
          </button>
        </form>
        {ok && <p className="auth-message">{ok}</p>}
        {error && <p className="auth-error">{error}</p>}
      </article>
      ) : null}

      <article className="portal-admin-card">
        <h3>Current Players</h3>
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
        {visibleClientCount === 0 ? (
          <p>No players yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <p className="portal-muted-text" style={{ margin: 0 }}>
              Showing {pageStart + 1}-{Math.min(pageStart + pageSize, visibleClientCount)} of {visibleClientCount}
            </p>
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
                  {pagedClients.map((client) => (
                    <tr key={client.playerId}>
                      <td>{client.fullName}</td>
                      <td>{client.email}</td>
                      <td>{client.assignedCoachName ?? '-'}</td>
                      <td>{client.status}</td>
                      <td className="portal-table-actions">
                        {canAccessProgramming ? (
                          <>
                            <Link className="btn btn-ghost as-link" href={`/portal/player?previewPlayerId=${client.playerId}`}>
                              Edit Player
                            </Link>
                            <Link className="btn btn-ghost as-link" href={`/portal/admin/programs/${client.playerId}`}>
                              Build Program
                            </Link>
                            <Link className="btn btn-ghost as-link" href={`/portal/player?previewPlayerId=${client.playerId}`}>
                              View Profile
                            </Link>
                            <Link className="btn btn-ghost as-link" href={`/portal/player/program?previewPlayerId=${client.playerId}`}>
                              Preview Program
                            </Link>
                            {session.role === 'admin' ? (
                              <form method="post" action="/api/admin/clients/manage" style={{ display: 'inline' }}>
                                <input type="hidden" name="redirectTo" value="/portal/admin/clients" />
                                <input type="hidden" name="action" value="delete" />
                                <input type="hidden" name="playerId" value={String(client.playerId)} />
                                <button type="submit" className="btn btn-ghost">
                                  Delete Player
                                </button>
                              </form>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <Link className="btn btn-ghost as-link" href={`/portal/player?previewPlayerId=${client.playerId}`}>
                              Edit Player
                            </Link>
                            {session.role === 'admin' ? (
                              <form method="post" action="/api/admin/clients/manage" style={{ display: 'inline' }}>
                                <input type="hidden" name="redirectTo" value="/portal/admin/clients" />
                                <input type="hidden" name="action" value="delete" />
                                <input type="hidden" name="playerId" value={String(client.playerId)} />
                                <button type="submit" className="btn btn-ghost">
                                  Delete Player
                                </button>
                              </form>
                            ) : null}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 ? (
              <div className="portal-choice-line-actions" style={{ justifyContent: 'space-between' }}>
                <Link className="btn btn-ghost as-link" href={safePage > 1 ? pageHref(safePage - 1) : pageHref(1)}>
                  Prev
                </Link>
                <span className="portal-muted-text">Page {safePage} / {totalPages}</span>
                <Link className="btn btn-ghost as-link" href={safePage < totalPages ? pageHref(safePage + 1) : pageHref(totalPages)}>
                  Next
                </Link>
              </div>
            ) : null}
          </div>
        )}
      </article>
    </div>
  );
}

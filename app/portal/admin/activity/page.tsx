import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import { canViewPortalActivity } from '../../../../lib/portal-activity';
import { listPortalActivityOverview } from '../../../../lib/training-db';

type ActivityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function roleLabel(value: string): string {
  if (value === 'admin') return 'Admin';
  if (value === 'coach') return 'Coach';
  if (value === 'player') return 'Player';
  return 'Unknown';
}

function eventLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

export default async function PortalActivityPage({ searchParams }: ActivityPageProps) {
  const session = await requirePortalSession();
  if (!canViewPortalActivity(session)) notFound();

  const params = await searchParams;
  const role = readParam(params.role);
  const query = readParam(params.q);
  const { users, recentEvents } = await listPortalActivityOverview({ role, query, limit: 250 });

  const totalLogins30d = users.reduce((sum, row) => sum + row.loginCount30d, 0);
  const totalPageViews30d = users.reduce((sum, row) => sum + row.pageViewCount30d, 0);
  const activeUsers30d = users.filter((row) => row.pageViewCount30d > 0 || row.loginCount30d > 0).length;

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Activity Tracker</h2>
        <p>Login frequency, page views, and recent portal activity across all schools.</p>
      </div>

      <section className="portal-admin-grid">
        <article className="portal-admin-card">
          <h3>Active Users</h3>
          <p>{activeUsers30d} users active in the last 30 days.</p>
        </article>
        <article className="portal-admin-card">
          <h3>Logins</h3>
          <p>{totalLogins30d} successful logins in the last 30 days.</p>
        </article>
        <article className="portal-admin-card">
          <h3>Page Views</h3>
          <p>{totalPageViews30d} tracked page views in the last 30 days.</p>
        </article>
      </section>

      <article className="portal-admin-card">
        <form className="portal-form-grid" action="/portal/admin/activity">
          <label>
            Search
            <input name="q" defaultValue={query} placeholder="Name, email, or school" />
          </label>
          <label>
            Role
            <select name="role" defaultValue={role}>
              <option value="">All roles</option>
              <option value="player">Players</option>
              <option value="coach">Coaches</option>
              <option value="admin">Admins</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary">Apply</button>
            <Link href="/portal/admin/activity" className="btn btn-ghost as-link">Reset</Link>
          </div>
        </form>
      </article>

      <article className="portal-admin-card portal-admin-card-wide">
        <h3>User Activity</h3>
        <div className="portal-table-wrap">
          <table className="portal-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>School</th>
                <th>Last Login</th>
                <th>Last Activity</th>
                <th>Last Page</th>
                <th>Logins 30d</th>
                <th>Views 30d</th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={`${row.email}-${row.organizationId ?? 'none'}`}>
                  <td>
                    <strong>{row.name || row.email}</strong>
                    <div className="portal-muted-text" style={{ fontSize: 12 }}>{row.email}</div>
                  </td>
                  <td>{roleLabel(row.role)}</td>
                  <td>{row.organizationName || row.dashboardSchoolCode || '-'}</td>
                  <td>{formatDateTime(row.lastLoginAt)}</td>
                  <td>{formatDateTime(row.lastActivityAt)}</td>
                  <td style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{row.lastPath || '-'}</td>
                  <td>{row.loginCount30d}</td>
                  <td>{row.pageViewCount30d}</td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr>
                  <td colSpan={8}>No activity matches the current filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

      <article className="portal-admin-card portal-admin-card-wide">
        <h3>Recent Events</h3>
        <div className="portal-table-wrap">
          <table className="portal-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Role</th>
                <th>School</th>
                <th>Event</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.createdAt)}</td>
                  <td>
                    <strong>{event.name || event.email}</strong>
                    <div className="portal-muted-text" style={{ fontSize: 12 }}>{event.email}</div>
                  </td>
                  <td>{roleLabel(event.role)}</td>
                  <td>{event.organizationName || '-'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{eventLabel(event.eventType)}</td>
                  <td style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{event.path || '-'}</td>
                </tr>
              ))}
              {recentEvents.length === 0 ? (
                <tr>
                  <td colSpan={6}>No recent activity yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

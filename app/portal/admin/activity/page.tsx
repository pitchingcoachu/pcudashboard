import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import { canViewPortalActivity } from '../../../../lib/portal-activity';
import { listPortalActivityOverview } from '../../../../lib/training-db';
import { resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';

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
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function metadataObject(metadata: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> {
  const value = metadata?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function titleFromPath(path: string | null | undefined): string {
  const pathname = String(path ?? '').split('?')[0] || '';
  if (pathname.startsWith('/portal/dashboard/pitching/leaderboard')) return 'Dashboard / Pitching / Leaderboard';
  if (pathname.startsWith('/portal/dashboard/pitching/summary')) return 'Dashboard / Pitching / Summary';
  if (pathname.startsWith('/portal/dashboard/pitching/game-log')) return 'Dashboard / Pitching / Game Log';
  if (pathname.startsWith('/portal/dashboard/pitching/pitch-log')) return 'Dashboard / Pitching / Pitch Log';
  if (pathname.startsWith('/portal/dashboard/pitching/ab-report')) return 'Dashboard / Pitching / AB Report';
  if (pathname.startsWith('/portal/dashboard/pitching/velocity')) return 'Dashboard / Pitching / Velocity';
  if (pathname.startsWith('/portal/dashboard/pitching/heatmaps')) return 'Dashboard / Pitching / HeatMaps';
  if (pathname.startsWith('/portal/dashboard/pitching/qp-locations')) return 'Dashboard / Pitching / QP Locations';
  if (pathname.startsWith('/portal/dashboard/pitching/trend')) return 'Dashboard / Pitching / Trend';
  if (pathname.startsWith('/portal/dashboard/pitching/velo-manual-entry')) return 'Dashboard / Pitching / Velo Manual Entry';
  if (pathname.startsWith('/portal/dashboard/pitching')) return 'Dashboard / Pitching';
  if (pathname.startsWith('/portal/dashboard/hitting/leaderboard')) return 'Dashboard / Hitting / Leaderboard';
  if (pathname.startsWith('/portal/dashboard/hitting/summary')) return 'Dashboard / Hitting / Summary';
  if (pathname.startsWith('/portal/dashboard/hitting/game-log')) return 'Dashboard / Hitting / Game Log';
  if (pathname.startsWith('/portal/dashboard/hitting/ab-report')) return 'Dashboard / Hitting / AB Report';
  if (pathname.startsWith('/portal/dashboard/hitting/heatmaps')) return 'Dashboard / Hitting / HeatMaps';
  if (pathname.startsWith('/portal/dashboard/hitting/swing-data')) return 'Dashboard / Hitting / Swing Data';
  if (pathname.startsWith('/portal/dashboard/hitting')) return 'Dashboard / Hitting';
  if (pathname.startsWith('/portal/dashboard/catching/leaderboard')) return 'Dashboard / Catching / Leaderboard';
  if (pathname.startsWith('/portal/dashboard/catching')) return 'Dashboard / Catching';
  if (pathname.startsWith('/portal/dashboard/custom-reports')) return 'Dashboard / Custom Reports';
  if (pathname.startsWith('/portal/dashboard/comparison-tool')) return 'Dashboard / Comparison Tool';
  if (pathname.startsWith('/portal/dashboard/biomechanics')) return 'Dashboard / Biomechanics';
  if (pathname.startsWith('/portal/dashboard/player-plans')) return 'Dashboard / Player Plans';
  if (pathname.startsWith('/portal/dashboard/player-notes')) return 'Dashboard / Player Notes';
  if (pathname.startsWith('/portal/dashboard/stuff-calculator')) return 'Dashboard / Stuff+ Calculator';
  if (pathname.startsWith('/portal/dashboard/home')) return 'Dashboard / Home';
  if (pathname.startsWith('/portal/admin/activity')) return 'Activity Tracker';
  if (pathname.startsWith('/portal/admin/coaches')) return 'Coach Management';
  if (pathname.startsWith('/portal/admin/clients')) return 'Player Management';
  if (pathname.startsWith('/portal/admin/email-templates')) return 'Email Automations';
  if (pathname.startsWith('/portal/admin/exercises')) return 'Exercise Library';
  if (pathname.startsWith('/portal/admin/master-calendar')) return 'Master Calendar';
  if (pathname.startsWith('/portal/admin/questionnaires')) return 'Questionnaires';
  if (pathname.startsWith('/portal/admin/schedule')) return 'Schedule Builder';
  if (pathname.startsWith('/portal/admin/testing')) return 'Testing Data';
  if (pathname.startsWith('/portal/admin/workouts')) return 'Workout Builder';
  if (pathname.startsWith('/portal/admin')) return 'Admin Home';
  if (pathname.startsWith('/portal/dashboard')) return 'Dashboard';
  if (pathname.startsWith('/portal/force-plates')) return 'Force Plates';
  if (pathname.startsWith('/portal/motion-capture')) return 'Motion Capture';
  if (pathname.startsWith('/portal/player/program/bullpens')) return 'Bullpens';
  if (pathname.startsWith('/portal/player/program/drills')) return 'Drills';
  if (pathname.startsWith('/portal/player/program/throwing')) return 'Throwing Calendar';
  if (pathname.startsWith('/portal/player/program/velocity')) return 'Velocity';
  if (pathname.startsWith('/portal/player/program')) return 'Player Program';
  if (pathname.startsWith('/portal/player')) return 'Player Profile';
  if (pathname.startsWith('/profiles')) return 'Profiles';
  if (pathname.startsWith('/portal')) return 'Portal Home';
  if (pathname.startsWith('/login')) return 'Login';
  return pathname.replace(/^\/+/, '').replaceAll('/', ' / ') || '-';
}

function pageSummary(path: string | null | undefined, metadata: Record<string, unknown> | null | undefined) {
  const query = metadataObject(metadata, 'query');
  const queryParts = Object.entries(query)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => `${key}: ${String(value)}`);
  return {
    label: metadataString(metadata, 'pageLabel') || titleFromPath(path),
    section: metadataString(metadata, 'section'),
    queryText: queryParts.join(' | '),
  };
}

function eventDetail(eventType: string, metadata: Record<string, unknown> | null | undefined): string {
  if (eventType === 'login_success') return metadataString(metadata, 'mode') ? `Mode: ${metadataString(metadata, 'mode')}` : '';
  if (eventType === 'bullpen_saved') {
    const date = metadataString(metadata, 'bullpenDate');
    const template = metadataString(metadata, 'templateId');
    return [date ? `Date: ${date}` : '', template ? `Template: ${template}` : ''].filter(Boolean).join(' | ');
  }
  if (eventType === 'workout_logged') {
    return metadataString(metadata, 'workoutName') || metadataString(metadata, 'workoutId');
  }
  if (eventType === 'questionnaire_completed') {
    return metadataString(metadata, 'questionnaireTitle') || metadataString(metadata, 'questionnaireId');
  }
  if (eventType === 'note_added') {
    return metadataString(metadata, 'category') || metadataString(metadata, 'domain');
  }
  if (eventType === 'media_uploaded') {
    return [metadataString(metadata, 'mediaType'), metadataString(metadata, 'mediaTitle'), metadataString(metadata, 'playerName')]
      .filter(Boolean)
      .join(' | ');
  }
  const suite = metadataString(metadata, 'suite');
  const subPage = metadataString(metadata, 'subPage');
  const tableMode = metadataString(metadata, 'tableMode');
  const splitBy = metadataString(metadata, 'splitBy');
  const visualOption = metadataString(metadata, 'visualOption');
  const swingTab = metadataString(metadata, 'swingTab');
  const leaderboardViewBy = metadataString(metadata, 'leaderboardViewBy');
  const dashboardParts = [
    suite ? `Suite: ${suite}` : '',
    subPage ? `Page: ${subPage}` : '',
    tableMode ? `Table: ${tableMode}` : '',
    splitBy ? `Split: ${splitBy}` : '',
    visualOption ? `Visual: ${visualOption}` : '',
    swingTab ? `Swing: ${swingTab}` : '',
    leaderboardViewBy ? `View: ${leaderboardViewBy}` : '',
  ].filter(Boolean);
  if (dashboardParts.length) return dashboardParts.join(' | ');
  return pageSummary(null, metadata).queryText;
}

function PagePathCell({ path, metadata }: { path: string | null; metadata?: Record<string, unknown> | null }) {
  const summary = pageSummary(path, metadata);
  return (
    <div style={{ minWidth: 220, maxWidth: 460 }}>
      <strong>{summary.label}</strong>
      {summary.section ? <div className="portal-muted-text" style={{ fontSize: 12 }}>{summary.section}</div> : null}
      {summary.queryText ? <div className="portal-muted-text" style={{ fontSize: 12 }}>{summary.queryText}</div> : null}
      <code style={{ display: 'block', marginTop: 4, whiteSpace: 'normal', overflowWrap: 'anywhere', fontSize: 12 }}>
        {path || '-'}
      </code>
    </div>
  );
}

export default async function PortalActivityPage({ searchParams }: ActivityPageProps) {
  const session = await requirePortalSession();
  if (resolveProgrammingSchoolCode(session) === 'TRIAL') notFound();
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
                  <td><PagePathCell path={row.lastPath} metadata={row.lastMetadata} /></td>
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
                <th>Page / Path</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.map((event) => {
                const detail = eventDetail(event.eventType, event.metadata);
                return (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.createdAt)}</td>
                    <td>
                      <strong>{event.name || event.email}</strong>
                      <div className="portal-muted-text" style={{ fontSize: 12 }}>{event.email}</div>
                    </td>
                    <td>{roleLabel(event.role)}</td>
                    <td>{event.organizationName || '-'}</td>
                    <td>
                      <span style={{ textTransform: 'none' }}>{eventLabel(event.eventType)}</span>
                    </td>
                    <td><PagePathCell path={event.path} metadata={event.metadata} /></td>
                    <td style={{ minWidth: 160 }}>{detail || '-'}</td>
                  </tr>
                );
              })}
              {recentEvents.length === 0 ? (
                <tr>
                  <td colSpan={7}>No recent activity yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

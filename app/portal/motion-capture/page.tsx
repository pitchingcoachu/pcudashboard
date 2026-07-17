import Link from 'next/link';
import { requirePortalSession } from '../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { resolveSessionDashboardSchoolOptions } from '../../../lib/dashboard-school-options';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../lib/programming-scope';
import { getPlayerForUser } from '../../../lib/training-db';
import DashboardSchoolSelector from '../dashboard/dashboard-school-selector';
import LogoutButton from '../logout-button';
import MobileNavSelect from '../mobile-nav-select';
import PortalNotificationsBell from '../notifications-bell';
import PortalThemeToggle from '../theme-toggle';
import MotionCaptureDashboard from './motion-capture-dashboard';

export default async function MotionCapturePage() {
  const session = await requirePortalSession();
  const selectedSchool = resolveDashboardSchoolCode(session);
  const schoolOptions = await resolveSessionDashboardSchoolOptions(session);
  const canAccessProgramming = canUseProgrammingData(session);
  const selectedSchoolCode = resolveProgrammingSchoolCode(session);
  const orgId = resolveProgrammingOrganizationId(session);
  const isPcu = String(selectedSchoolCode ?? '').trim().toUpperCase() === 'PCU';
  const ownPlayer = session.role === 'player' && orgId > 0 ? await getPlayerForUser({ organizationId: orgId, userId: session.userId ?? 0 }) : null;
  const error = !isPcu
    ? 'Motion Capture is currently enabled only for PCU.'
    : !canAccessProgramming
      ? 'Programming access is required to use Motion Capture.'
      : '';

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-left">
          <DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />
        </div>
        <div className="portal-header-center">
          <nav className="portal-nav" aria-label="Portal Navigation">
            {(session.role === 'admin' || session.role === 'coach') && (
              <Link href="/portal/admin" className="portal-nav-link">
                Home
              </Link>
            )}
            {session.role === 'player' && canAccessProgramming ? (
              <>
                <Link href="/portal/player" className="portal-nav-link">
                  Profile
                </Link>
                <Link href="/portal/player/program" className="portal-nav-link">
                  Program
                </Link>
              </>
            ) : null}
            <Link href="/portal/dashboard" className="portal-nav-link">
              Dashboard
            </Link>
          </nav>
          <MobileNavSelect
            currentHref="/portal/motion-capture"
            loggedInAs={session.name ?? session.email}
            items={[
              ...(session.role === 'admin' || session.role === 'coach' ? [{ href: '/portal/admin', label: 'Home' }] : []),
              ...(session.role === 'player' && canAccessProgramming
                ? [
                    { href: '/portal/player', label: 'Profile' },
                    { href: '/portal/player/program', label: 'Program' },
                  ]
                : []),
              { href: '/portal/dashboard', label: 'Dashboard' },
            ]}
          />
        </div>
        <div className="portal-header-right">
          <div className="portal-user-meta" aria-label="Logged in user">
            <p>Logged In As</p>
            <h1>{session.name ?? session.email}</h1>
          </div>
          {(session.role === 'admin' || session.role === 'coach') ? <PortalNotificationsBell /> : null}
          <LogoutButton />
          <PortalThemeToggle />
        </div>
      </header>

      <section className="portal-panel portal-admin-panel">
        <div className="portal-admin-stack">
          <div className="portal-admin-headline">
            <h2 style={{ margin: 0 }}>Motion Capture</h2>
            <p className="portal-muted-text" style={{ margin: 0 }}>
              Upload phone video, link it to TrackMan when available, and review motion-capture outputs by player and date.
            </p>
          </div>
          {error ? (
            <article className="portal-admin-card">
              <p className="auth-error" style={{ margin: 0 }}>
                {error}
              </p>
            </article>
          ) : (
            <MotionCaptureDashboard initialPlayerId={ownPlayer?.id ?? null} />
          )}
        </div>
      </section>
    </div>
  );
}

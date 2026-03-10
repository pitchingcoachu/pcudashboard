import Link from 'next/link';
import { requirePortalSession } from '../../../lib/portal-session';
import LogoutButton from '../logout-button';

const TM_DATA_URL = 'https://pitchingcoachu.shinyapps.io/TMdata/';

export default async function PortalDashboardPage() {
  const session = await requirePortalSession();

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-left">
          <Link href="/portal/dashboard" className="portal-header-logo-link" aria-label="PCU Home">
            <img src="/pitching-coach-u-logo.png" alt="PCU logo" className="portal-header-logo" />
          </Link>
        </div>
        <div className="portal-header-center">
          <nav className="portal-nav" aria-label="Portal Navigation">
            {(session.role === 'admin' || session.role === 'coach') && (
              <Link href="/portal/admin" className="portal-nav-link">
                Admin Home
              </Link>
            )}
            {session.role === 'player' ? (
              <>
                <Link href="/portal/player" className="portal-nav-link">
                  Profile
                </Link>
                <Link href="/portal/player/program" className="portal-nav-link">
                  Program
                </Link>
              </>
            ) : (
              <Link
                href={session.role === 'coach' ? '/portal/admin/schedule' : '/portal/player?preview=self'}
                className="portal-nav-link"
              >
                Player Preview
              </Link>
            )}
            <Link href="/portal/dashboard" className="portal-nav-link active">
              PCU Dashboard
            </Link>
            {(session.role === 'admin' || session.role === 'coach') && (
              <Link href="/tutorials" className="portal-nav-link">
                Tutorials
              </Link>
            )}
          </nav>
        </div>
        <div className="portal-header-right">
          <div className="portal-user-meta" aria-label="Logged in user">
            <p>Logged In As</p>
            <h1>{session.name ?? session.email}</h1>
          </div>
          <LogoutButton />
        </div>
      </header>

      <section className="portal-frame-wrap">
        <iframe
          className="portal-frame"
          src={TM_DATA_URL}
          title="PCU Dashboard"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </section>
    </div>
  );
}

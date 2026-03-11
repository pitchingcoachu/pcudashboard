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
              <Link href="/portal/admin/schedule" className="portal-nav-link">
                Schedule
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
          <div className="portal-social-row" aria-label="PCU Social Links">
            <Link
              href="https://x.com/pitchingcoachu"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="PCU on X"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.244 2H21l-6.528 7.462L22.148 22h-6.012l-4.708-6.163L6.035 22H3.277l6.983-7.979L2 2h6.166l4.255 5.617L18.244 2Zm-2.108 18h1.58L7.308 3.896H5.612L16.136 20Z" />
              </svg>
            </Link>
            <Link
              href="https://instagram.com/pitchingcoachu"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="PCU on Instagram"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm0 1.75A4 4 0 0 0 3.75 7.75v8.5a4 4 0 0 0 4 4h8.5a4 4 0 0 0 4-4v-8.5a4 4 0 0 0-4-4h-8.5Zm9.063 1.312a1.188 1.188 0 1 1 0 2.375 1.188 1.188 0 0 1 0-2.375ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z" />
              </svg>
            </Link>
            <Link
              href="https://youtube.com/@pitchingcoachu?si=rstmKgKPdnzbLv6q"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="PCU on YouTube"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M23 12s0-3.2-.4-4.6a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.5.3a3 3 0 0 0-2.1 2.1C1 8.8 1 12 1 12s0 3.2.4 4.6a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.5-.3a3 3 0 0 0 2.1-2.1C23 15.2 23 12 23 12ZM10 15.5v-7l6 3.5-6 3.5Z" />
              </svg>
            </Link>
          </div>
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

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../lib/portal-session';
import LogoutButton from '../logout-button';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortalSession();

  if (session.role === 'player') {
    redirect('/portal/player');
  }

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-left">
          <Link href="/portal/admin" className="portal-header-logo-link" aria-label="PCU Home">
            <img src="/pitching-coach-u-logo.png" alt="PCU logo" className="portal-header-logo" />
          </Link>
        </div>
        <div className="portal-header-center">
          <nav className="portal-nav" aria-label="Portal Navigation">
            <Link href="/portal/admin" className="portal-nav-link">
              Admin Home
            </Link>
            {session.role === 'admin' && (
              <Link href="/portal/admin/clients" className="portal-nav-link">
                Clients
              </Link>
            )}
            {session.role === 'admin' && (
              <Link href="/portal/admin/coaches" className="portal-nav-link">
                Coaches
              </Link>
            )}
            <Link href="/portal/admin/exercises" className="portal-nav-link">
              Exercise Library
            </Link>
            <Link href="/portal/admin/workouts" className="portal-nav-link">
              Workouts
            </Link>
            <Link href="/portal/admin/schedule" className="portal-nav-link">
              Schedule
            </Link>
            <Link
              href={session.role === 'coach' ? '/portal/admin/schedule' : '/portal/player?preview=self'}
              className="portal-nav-link"
            >
              Player Preview
            </Link>
            <Link href="/portal/dashboard" className="portal-nav-link">
              PCU Dashboard
            </Link>
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
      <section className="portal-panel portal-admin-panel">{children}</section>
    </div>
  );
}

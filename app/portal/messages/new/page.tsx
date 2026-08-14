import Link from 'next/link';
import { requirePortalSession } from '../../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { schoolBrandCssVars } from '../../../../lib/school-brand';
import MobileNavSelect from '../../mobile-nav-select';
import LogoutButton from '../../logout-button';
import PortalUserMenu from '../../user-menu';
import PortalNotificationsBell from '../../notifications-bell';
import PortalThemeToggle from '../../theme-toggle';
import { NewConversationPanel } from '../new-conversation-panel';

export default async function NewMessagePage() {
  const session = await requirePortalSession();
  const isStaff = session.role === 'admin' || session.role === 'coach';
  const selectedSchool = resolveDashboardSchoolCode(session);

  return (
    <div className="portal-shell" style={schoolBrandCssVars(selectedSchool)}>
      <header className="portal-header">
        <div className="portal-header-left" />
        <div className="portal-header-center">
          <nav className="portal-nav" aria-label="Portal Navigation">
            {isStaff ? (
              <Link href="/portal/admin" className="portal-nav-link">
                Admin
              </Link>
            ) : null}
            <Link href="/portal/player" className="portal-nav-link">
              Profile
            </Link>
            <Link href="/portal/messages" className="portal-nav-link active">
              Messages
            </Link>
            {session.role === 'player' ? (
              <Link href="/portal/dashboard" className="portal-nav-link">
                Dashboard
              </Link>
            ) : (
              <Link href="/profiles" className="portal-nav-link">
                Profiles
              </Link>
            )}
          </nav>
          <MobileNavSelect
            currentHref="/portal/messages"
            loggedInAs={session.name ?? session.email}
            items={[
              ...(isStaff ? [{ href: '/portal/admin', label: 'Admin' }] : []),
              { href: '/portal/player', label: 'Profile' },
              { href: '/portal/messages', label: 'Messages' },
              session.role === 'player' ? { href: '/portal/dashboard', label: 'Dashboard' } : { href: '/profiles', label: 'Profiles' },
            ]}
          />
        </div>
        <div className="portal-header-right">
          {isStaff ? (
            <PortalUserMenu displayName={session.name ?? session.email} />
          ) : (
            <div className="portal-user-meta" aria-label="Logged in user">
              <p>Logged In As</p>
              <h1>{session.name ?? session.email}</h1>
            </div>
          )}
          <PortalNotificationsBell />
          {session.role === 'player' ? <LogoutButton /> : null}
          <PortalThemeToggle />
        </div>
      </header>
      <section className="portal-messages-page portal-messages-page--single">
        <NewConversationPanel />
      </section>
    </div>
  );
}

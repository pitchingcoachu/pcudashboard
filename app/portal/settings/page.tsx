import Link from 'next/link';
import { requirePortalSession } from '../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { resolveSessionDashboardSchoolOptions } from '../../../lib/dashboard-school-options';
import { canUseProgrammingData } from '../../../lib/programming-scope';
import { schoolBrandCssVars } from '../../../lib/school-brand';
import { resolveViewMode } from '../../../lib/view-mode';
import PortalChrome from '../portal-chrome';
import DashboardSchoolSelector from '../dashboard/dashboard-school-selector';
import LogoutButton from '../logout-button';
import PortalUserMenu from '../user-menu';
import PortalThemeToggle from '../theme-toggle';
import PortalNotificationsBell from '../notifications-bell';
import PortalMessagesNavButton from '../messages-nav-button';
import ViewModeToggle from '../view-mode-toggle';
import ExportsCard from './exports-card';
import NotificationsCard from './notifications-card';
import MySavedViewsCard from './my-saved-views-card';
import { resolveStaffPrimaryNavigation } from '../../../lib/portal-primary-nav-server';
import StaffPrimaryNav, { staffPrimaryMobileItems } from '../staff-primary-nav';

export default async function PortalSettingsPage() {
  const session = await requirePortalSession();
  const isStaff = session.role === 'admin' || session.role === 'coach';
  const selectedSchool = resolveDashboardSchoolCode(session);
  const schoolOptions = await resolveSessionDashboardSchoolOptions(session);
  const canAccessProgramming = await canUseProgrammingData(session);
  const primaryNav = isStaff ? await resolveStaffPrimaryNavigation(session) : null;
  const viewMode = await resolveViewMode();

  return (
    <PortalChrome
      schoolBrandStyle={schoolBrandCssVars(selectedSchool)}
      left={<DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />}
      navLinks={
        isStaff && primaryNav ? (
          <StaffPrimaryNav {...primaryNav} />
        ) : (
          <>
          <Link href="/portal/player" className="portal-nav-link">
            Profile
          </Link>
          {canAccessProgramming ? (
            <Link href="/portal/player/program" className="portal-nav-link">
              Program
            </Link>
          ) : null}
          <Link href="/portal/settings" className="portal-nav-link active">
            Settings
          </Link>
          </>
        )
      }
      mobileNavCurrentHref="/portal/settings"
      mobileNavLoggedInAs={session.name ?? session.email}
      mobileNavItems={primaryNav ? staffPrimaryMobileItems(primaryNav) : [
        { href: '/portal/player', label: 'Profile' },
        ...(canAccessProgramming ? [{ href: '/portal/player/program', label: 'Program' }] : []),
        { href: '/portal/settings', label: 'Settings' },
      ]}
      right={
        <>
          {isStaff ? (
            <PortalUserMenu displayName={session.name ?? session.email} />
          ) : (
            <div className="portal-user-meta" aria-label="Logged in user">
              <p>Logged In As</p>
              <h1>{session.name ?? session.email}</h1>
            </div>
          )}
          <PortalMessagesNavButton />
          <PortalNotificationsBell />
          <PortalThemeToggle />
        </>
      }
      sectionClassName="portal-panel portal-admin-panel"
      tabBarRole={session.role}
    >
      <div className="portal-admin-stack">
        <div className="portal-admin-headline">
          <h2 style={{ margin: 0 }}>Settings</h2>
        </div>

        <article className="portal-admin-card">
          <h2>Account</h2>
          <p className="portal-muted-text" style={{ margin: 0 }}>
            {session.name ?? session.email}
            <br />
            {session.email}
          </p>
        </article>

        <article className="portal-admin-card">
          <h2>Display</h2>
          <p className="portal-muted-text" style={{ marginTop: 0 }}>
            Choose between the mobile app view and the full desktop site.
          </p>
          <ViewModeToggle viewMode={viewMode} />
        </article>

        {isStaff ? <NotificationsCard /> : null}

        <ExportsCard />

        {isStaff ? <MySavedViewsCard /> : null}

        <article className="portal-admin-card">
          <h2>Theme</h2>
          <p className="portal-muted-text" style={{ marginTop: 0 }}>
            The mobile view is always dark. Switch to the desktop site to use light mode.
          </p>
          <PortalThemeToggle />
        </article>

        <article className="portal-admin-card">
          <LogoutButton />
        </article>
      </div>
    </PortalChrome>
  );
}

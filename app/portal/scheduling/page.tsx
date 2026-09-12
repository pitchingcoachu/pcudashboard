import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { resolveSessionDashboardSchoolOptions } from '../../../lib/dashboard-school-options';
import { resolveStaffPrimaryNavigation } from '../../../lib/portal-primary-nav-server';
import { requirePortalSession } from '../../../lib/portal-session';
import { canUseGameTracker, canUseProgrammingData } from '../../../lib/programming-scope';
import { resolveSchoolBrand, schoolBrandCssVars } from '../../../lib/school-brand';
import DashboardSchoolSelector from '../dashboard/dashboard-school-selector';
import SchedulingSuite from '../dashboard/scheduling-suite';
import LogoutButton from '../logout-button';
import PortalMessagesNavButton from '../messages-nav-button';
import PortalNotificationsBell from '../notifications-bell';
import PortalChrome from '../portal-chrome';
import StaffPrimaryNav, { staffPrimaryMobileItems } from '../staff-primary-nav';
import PortalThemeToggle from '../theme-toggle';
import PortalUserMenu from '../user-menu';

export default async function SessionSchedulingPage() {
  const session = await requirePortalSession();
  const selectedSchool = resolveDashboardSchoolCode(session);
  if (!['PCU', 'GUND'].includes(selectedSchool.trim().toUpperCase())) redirect('/portal/dashboard');
  const brand = resolveSchoolBrand(selectedSchool);
  const schoolName = brand.schoolCode === 'PCU' ? 'PCU' : brand.logoAlt.replace(/\s+logo$/i, '').trim();

  const isStaff = session.role === 'admin' || session.role === 'coach';
  const [schoolOptions, canAccessProgramming, canAccessGameTracker, staffNavigation] = await Promise.all([
    resolveSessionDashboardSchoolOptions(session),
    canUseProgrammingData(session),
    canUseGameTracker(session),
    isStaff ? resolveStaffPrimaryNavigation(session) : Promise.resolve(null),
  ]);

  const playerNavItems = [
    { href: '/portal/player', label: 'Profile' },
    ...(canAccessProgramming ? [{ href: '/portal/player/program', label: 'Program' }] : []),
    { href: '/portal/scheduling', label: 'Booking' },
    { href: '/portal/dashboard', label: 'Dashboard' },
  ];

  return (
    <PortalChrome
      schoolBrandStyle={schoolBrandCssVars(selectedSchool)}
      wrapNavInStack
      left={<DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />}
      navLinks={
        isStaff && staffNavigation ? (
          <StaffPrimaryNav {...staffNavigation} activeHref="/portal/scheduling" />
        ) : (
          <>
            <Link href="/portal/player" className="portal-nav-link">Profile</Link>
            {canAccessProgramming ? <Link href="/portal/player/program" className="portal-nav-link">Program</Link> : null}
            <Link href="/portal/scheduling" className="portal-nav-link active">Booking</Link>
            <Link href="/portal/dashboard" className="portal-nav-link">Dashboard</Link>
          </>
        )
      }
      mobileNavCurrentHref="/portal/scheduling"
      mobileNavLoggedInAs={session.name ?? session.email}
      mobileNavItems={isStaff && staffNavigation ? staffPrimaryMobileItems(staffNavigation) : playerNavItems}
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
          {session.role === 'player' ? <LogoutButton /> : null}
          <PortalThemeToggle />
        </>
      }
      sectionClassName="portal-scheduling-page"
      tabBarRole={session.role}
      tabBarGameTrackerVisible={canAccessGameTracker}
    >
      <SchedulingSuite role={session.role} logoSrc={brand.logoSrc ?? '/pearl-clam-transparent.png'} logoAlt={brand.logoAlt} schoolName={schoolName} />
    </PortalChrome>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { canUseClientManagement, canUseProgrammingData, getSchoolProductAccess } from '../../../lib/programming-scope';
import { resolveSchoolBrand, schoolBrandCssVars } from '../../../lib/school-brand';
import PortalChrome from '../portal-chrome';
import PortalUserMenu from '../user-menu';
import DashboardSchoolSelector from '../dashboard/dashboard-school-selector';
import PortalNotificationsBell from '../notifications-bell';
import PortalThemeToggle from '../theme-toggle';
import PortalMessagesNavButton from '../messages-nav-button';
import PortalNavOverflowMenu from '../nav-overflow-menu';
import { resolveSessionDashboardSchoolOptions } from '../../../lib/dashboard-school-options';
import { canViewPortalActivity } from '../../../lib/portal-activity';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timeout = setTimeout(() => resolve(fallback), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } catch {
    return fallback;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortalSession();
  const selectedSchool = resolveDashboardSchoolCode(session);
  const schoolOptions = await withTimeout(resolveSessionDashboardSchoolOptions(session), 3_000, [selectedSchool, 'LEAGUE', 'PRO']);
  const brand = resolveSchoolBrand(selectedSchool);
  const [programmingDataAllowed, clientManagementAllowed] = await Promise.all([
    canUseProgrammingData(session),
    canUseClientManagement(session),
  ]);
  const schoolAccess =
    session.role === 'admin'
      ? await withTimeout(
          getSchoolProductAccess(selectedSchool),
          3_000,
          { dashboard: true, programming: programmingDataAllowed, clientManagement: clientManagementAllowed, mobileSchedule: true, mobileWorkouts: true }
        )
      : null;
  const canAccessProgramming = session.role === 'admin' ? schoolAccess?.programming === true : programmingDataAllowed;
  const canAccessClientManagement = session.role === 'admin' ? schoolAccess?.clientManagement !== false : clientManagementAllowed;
  const isProSchool = String(selectedSchool).trim().toUpperCase() === 'PRO';
  const showCoachClientTabs = canAccessClientManagement && !(session.role === 'coach' && isProSchool);
  const useCompactProgrammingNav = canAccessProgramming;
  const isLeagueSchool = String(selectedSchool || '').toUpperCase() === 'LEAGUE';
  const isTrialSchool = String(selectedSchool || '').toUpperCase() === 'TRIAL';
  const canAccessPlayerNotes = (session.role === 'admin' || session.role === 'coach') && !isLeagueSchool;
  const canAccessActivityTracker = !isTrialSchool && canViewPortalActivity(session);
  const canAccessEmailAutomations =
    !isTrialSchool && session.role === 'admin' && session.email.trim().toLowerCase() === 'jgaynor@pitchingcoachu.com';

  if (session.role === 'player') {
    redirect('/portal/player');
  }

  const moreItemsCompact = [
    { href: '/profiles', label: 'Profiles' },
    ...(showCoachClientTabs ? [{ href: '/portal/admin/coaches', label: 'Coaches' }] : []),
    { href: '/portal/admin/exercises', label: 'Exercise Library' },
    { href: '/portal/admin/workouts', label: 'Workout Library' },
    { href: '/portal/admin/master-calendar', label: 'Master Calendar' },
    { href: '/portal/admin/testing', label: 'Testing' },
    { href: '/portal/admin/questionnaires', label: 'Questionnaires' },
    ...(canAccessActivityTracker ? [{ href: '/portal/admin/activity', label: 'Activity Tracker' }] : []),
    ...(canAccessEmailAutomations ? [{ href: '/portal/admin/email-templates', label: 'Email Automations' }] : []),
    ...(!isTrialSchool ? [{ href: '/portal/force-plates', label: 'Force Plate Data' }] : []),
    ...(!isTrialSchool ? [{ href: '/portal/admin/force-plates-live', label: 'Force Plate Live Search' }] : []),
    ...(!isTrialSchool && session.role === 'admin' ? [{ href: '/portal/admin/csv-uploads', label: 'CSV Uploads' }] : []),
  ];

  const moreItemsClientManagement = [
    ...((session.role === 'admin' || session.role === 'coach') && showCoachClientTabs
      ? [{ href: '/portal/admin/clients', label: 'Players' }]
      : []),
    ...((session.role === 'admin' || session.role === 'coach') && showCoachClientTabs
      ? [{ href: '/portal/admin/coaches', label: 'Coaches' }]
      : []),
    ...(canAccessActivityTracker ? [{ href: '/portal/admin/activity', label: 'Activity Tracker' }] : []),
    ...(canAccessEmailAutomations ? [{ href: '/portal/admin/email-templates', label: 'Email Automations' }] : []),
    ...(!isTrialSchool ? [{ href: '/portal/force-plates', label: 'Force Plate Data' }] : []),
    ...(!isTrialSchool ? [{ href: '/portal/admin/force-plates-live', label: 'Force Plate Live Search' }] : []),
    ...(!isTrialSchool && session.role === 'admin' ? [{ href: '/portal/admin/csv-uploads', label: 'CSV Uploads' }] : []),
  ];

  return (
    <PortalChrome
      extraShellClass={isProSchool ? 'portal-shell--pro' : ''}
      schoolBrandStyle={schoolBrandCssVars(selectedSchool)}
      wrapNavInStack
      left={
        session.role === 'admin' || session.role === 'coach' ? (
          <DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />
        ) : (
          <Link href="/portal/admin" className="portal-header-logo-link" aria-label={`${brand.schoolCode} Home`}>
            <img
              src={brand.logoSrc ?? '/pearl-clam-transparent.png'}
              alt={brand.logoSrc ? brand.logoAlt : 'Pearl Player Development'}
              className={`portal-header-logo${brand.logoSrc ? ' portal-header-logo--school' : ''}`}
            />
          </Link>
        )
      }
      navLinks={
        useCompactProgrammingNav ? (
          <>
            <Link href="/portal/admin" className="portal-nav-link">
              Home
            </Link>
            <Link href="/portal/dashboard" className="portal-nav-link">
              Dashboard
            </Link>
            <Link href="/portal/admin/game-tracker" className="portal-nav-link">
              Game Tracker
            </Link>
            <Link href="/portal/admin/schedule" className="portal-nav-link">
              Schedule
            </Link>
            {canAccessPlayerNotes && (
              <Link href="/portal/admin/player-notes" className="portal-nav-link">
                Player Notes
              </Link>
            )}
            <PortalNavOverflowMenu items={moreItemsCompact} />
          </>
        ) : (
          <>
            <Link href="/portal/admin" className="portal-nav-link">
              Home
            </Link>
            <Link href="/portal/dashboard" className="portal-nav-link">
              Dashboard
            </Link>
            <Link href="/portal/admin/game-tracker" className="portal-nav-link">
              Game Tracker
            </Link>
            {canAccessPlayerNotes && (
              <Link href="/portal/admin/player-notes" className="portal-nav-link">
                Player Notes
              </Link>
            )}
            <PortalNavOverflowMenu items={moreItemsClientManagement} />
          </>
        )
      }
      mobileNavLoggedInAs={session.name ?? session.email}
      mobileNavItems={
        useCompactProgrammingNav
          ? [
              { href: '/portal/admin', label: 'Home' },
              { href: '/portal/dashboard', label: 'Dashboard' },
              { href: '/portal/admin/game-tracker', label: 'Game Tracker' },
              { href: '/portal/admin/schedule', label: 'Schedule' },
              ...(canAccessPlayerNotes ? [{ href: '/portal/admin/player-notes', label: 'Player Notes' }] : []),
              ...moreItemsCompact,
            ]
          : [
              { href: '/portal/admin', label: 'Home' },
              { href: '/portal/dashboard', label: 'Dashboard' },
              { href: '/portal/admin/game-tracker', label: 'Game Tracker' },
              ...(canAccessPlayerNotes ? [{ href: '/portal/admin/player-notes', label: 'Player Notes' }] : []),
              ...moreItemsClientManagement,
            ]
      }
      right={
        <>
          <PortalUserMenu displayName={session.name ?? session.email} />
          <PortalMessagesNavButton />
          <PortalNotificationsBell />
          <PortalThemeToggle />
          <div className="portal-social-row" aria-label="PCU Social Links">
            <Link href="https://x.com/pearlplayerdev" target="_blank" rel="noopener noreferrer" className="social-link" aria-label="Pearl Player Development on X">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.244 2H21l-6.528 7.462L22.148 22h-6.012l-4.708-6.163L6.035 22H3.277l6.983-7.979L2 2h6.166l4.255 5.617L18.244 2Zm-2.108 18h1.58L7.308 3.896H5.612L16.136 20Z" />
              </svg>
            </Link>
            <Link href="https://instagram.com/pitchingcoachu" target="_blank" rel="noopener noreferrer" className="social-link" aria-label="PCU on Instagram">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm0 1.75A4 4 0 0 0 3.75 7.75v8.5a4 4 0 0 0 4 4h8.5a4 4 0 0 0 4-4v-8.5a4 4 0 0 0-4-4h-8.5Zm9.063 1.312a1.188 1.188 0 1 1 0 2.375 1.188 1.188 0 0 1 0-2.375ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z" />
              </svg>
            </Link>
            <Link href="https://youtube.com/@pitchingcoachu?si=rstmKgKPdnzbLv6q" target="_blank" rel="noopener noreferrer" className="social-link" aria-label="PCU on YouTube">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M23 12s0-3.2-.4-4.6a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.5.3a3 3 0 0 0-2.1 2.1C1 8.8 1 12 1 12s0 3.2.4 4.6a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.5-.3a3 3 0 0 0 2.1-2.1C23 15.2 23 12 23 12ZM10 15.5v-7l6 3.5-6 3.5Z" />
              </svg>
            </Link>
          </div>
          <Link href="/portal/dashboard" className="portal-header-logo-link" aria-label="Pearl home">
            <img src="/pearl-clam-transparent.png" alt="Pearl Player Development" className="portal-header-logo portal-header-logo--pcu-right" />
          </Link>
        </>
      }
      sectionClassName="portal-panel portal-admin-panel"
      tabBarRole={session.role}
      tabBarScheduleLocked={session.role === 'admin' ? schoolAccess?.mobileSchedule === false : false}
      tabBarWorkoutsLocked={session.role === 'admin' ? schoolAccess?.mobileWorkouts === false : false}
    >
      {children}
    </PortalChrome>
  );
}

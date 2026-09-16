import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { resolveSessionDashboardSchoolOptions } from '../../../lib/dashboard-school-options';
import { resolveProgrammingOrganizationId } from '../../../lib/programming-scope';
import { getPlayerForUser } from '../../../lib/training-db';
import { listOvrSprintResults, listOvrSprintUploads } from '../../../lib/ovr-sprint';
import { resolveStaffPrimaryNavigation } from '../../../lib/portal-primary-nav-server';
import PortalChrome from '../portal-chrome';
import StaffPrimaryNav, { staffPrimaryMobileItems } from '../staff-primary-nav';
import DashboardSchoolSelector from '../dashboard/dashboard-school-selector';
import PortalUserMenu from '../user-menu';
import PortalMessagesNavButton from '../messages-nav-button';
import PortalNotificationsBell from '../notifications-bell';
import PortalThemeToggle from '../theme-toggle';
import LogoutButton from '../logout-button';
import OvrSprintDashboard from './ovr-sprint-dashboard';
import styles from './ovr-sprint.module.css';

export default async function OvrSprintPage() {
  const session = await requirePortalSession();
  const selectedSchool = resolveDashboardSchoolCode(session).trim().toUpperCase();
  if (selectedSchool !== 'PCU') notFound();
  const organizationId = await resolveProgrammingOrganizationId(session);
  const schoolOptions = await resolveSessionDashboardSchoolOptions(session);
  const isStaff = session.role === 'admin' || session.role === 'coach';
  const primaryNav = isStaff ? await resolveStaffPrimaryNavigation(session) : null;
  const ownPlayer = session.role === 'player' ? await getPlayerForUser({ organizationId, userId: session.userId ?? 0 }) : null;
  const [results, uploads] = await Promise.all([
    listOvrSprintResults({ organizationId, schoolCode: selectedSchool, playerId: session.role === 'player' ? (ownPlayer?.id ?? -1) : undefined }),
    isStaff ? listOvrSprintUploads(organizationId, selectedSchool) : Promise.resolve([]),
  ]);

  return (
    <PortalChrome
      left={<DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />}
      navLinks={isStaff && primaryNav ? <StaffPrimaryNav {...primaryNav} activeHref="/portal/ovr-sprint" /> : <><Link href="/portal/player" className="portal-nav-link">Profile</Link><Link href="/portal/player/program" className="portal-nav-link">Program</Link><Link href="/portal/dashboard" className="portal-nav-link">Dashboard</Link></>}
      mobileNavCurrentHref="/portal/ovr-sprint"
      mobileNavLoggedInAs={session.name ?? session.email}
      mobileNavItems={primaryNav ? staffPrimaryMobileItems(primaryNav) : [{ href:'/portal/player',label:'Profile' },{ href:'/portal/player/program',label:'Program' },{ href:'/portal/dashboard',label:'Dashboard' },{ href:'/portal/ovr-sprint',label:'OVR Sprint' }]}
      right={<>{isStaff ? <PortalUserMenu displayName={session.name ?? session.email} /> : <div className="portal-user-meta"><p>Logged In As</p><h1>{session.name ?? session.email}</h1></div>}<PortalMessagesNavButton />{isStaff ? <PortalNotificationsBell /> : null}{session.role === 'player' ? <LogoutButton /> : null}<PortalThemeToggle /></>}
      sectionClassName="portal-panel portal-admin-panel"
    >
      <div className="portal-admin-stack">
        <div className={`portal-admin-headline ${styles.pageHeadline}`}><h2 style={{margin:0}}>OVR Sprint</h2></div>
        <OvrSprintDashboard initialResults={results} initialUploads={uploads} canImport={isStaff} />
      </div>
    </PortalChrome>
  );
}

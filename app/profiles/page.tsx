import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../lib/dashboard-access';
import { resolveSessionDashboardSchoolOptions } from '../../lib/dashboard-school-options';
import { formatPlayerPlanGoalSummary } from '../../lib/player-plan-goal-display';
import { canUseProgrammingData, resolveProgrammingOrganizationId } from '../../lib/programming-scope';
import { schoolBrandCssVars } from '../../lib/school-brand';
import { listPlayerProfilesWithPlanGoals } from '../../lib/training-db';
import DashboardSchoolSelector from '../portal/dashboard/dashboard-school-selector';
import PortalUserMenu from '../portal/user-menu';
import PortalChrome from '../portal/portal-chrome';
import PortalNotificationsBell from '../portal/notifications-bell';
import PortalThemeToggle from '../portal/theme-toggle';
import ProfilesList from './profiles-list';
import { resolveStaffPrimaryNavigation } from '../../lib/portal-primary-nav-server';
import StaffPrimaryNav, { staffPrimaryMobileItems } from '../portal/staff-primary-nav';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timeout = setTimeout(() => resolve(fallback), timeoutMs);
    });
    return await Promise.race([promise.catch(() => fallback), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export default async function ProfilesPage() {
  const session = await requirePortalSession();
  if (session.role === 'player') {
    redirect('/portal/player');
  }

  const selectedSchool = resolveDashboardSchoolCode(session);
  const [schoolOptions, primaryNav] = await Promise.all([
    withTimeout(resolveSessionDashboardSchoolOptions(session), 3_000, [selectedSchool]),
    resolveStaffPrimaryNavigation(session),
  ]);
  const canAccessProgramming = await canUseProgrammingData(session);
  const programmingOrganizationId = await resolveProgrammingOrganizationId(session);
  const players =
    canAccessProgramming && programmingOrganizationId > 0
      ? await listPlayerProfilesWithPlanGoals({
          organizationId: programmingOrganizationId,
          assignedCoachUserId: null,
        })
      : [];

  const profileRows = players.map((player) => ({
    playerId: player.playerId,
    fullName: player.fullName,
    goals: [1, 2, 3].map((slot) => {
      const goal = player.goals.find((entry) => entry.slotIndex === slot);
      return goal ? formatPlayerPlanGoalSummary(goal) : '';
    }),
  }));

  return (
    <PortalChrome
      schoolBrandStyle={schoolBrandCssVars(selectedSchool)}
      left={<DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />}
      navLinks={
        <StaffPrimaryNav {...primaryNav} activeHref="/profiles" />
      }
      mobileNavCurrentHref="/profiles"
      mobileNavLoggedInAs={session.name ?? session.email}
      mobileNavItems={staffPrimaryMobileItems(primaryNav)}
      right={
        <>
          <PortalUserMenu displayName={session.name ?? session.email} />
          <PortalNotificationsBell />
          <PortalThemeToggle />
        </>
      }
      sectionClassName={canAccessProgramming ? undefined : 'portal-panel'}
    >
      {canAccessProgramming ? (
        <ProfilesList players={profileRows} />
      ) : (
        <>
          <h2>Profiles</h2>
          <p className="portal-muted-text">No profiles are available for this school.</p>
        </>
      )}
    </PortalChrome>
  );
}

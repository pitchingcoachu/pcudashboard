import { resolveDashboardSchoolCode } from './dashboard-access';
import { canViewPortalActivity } from './portal-activity';
import { buildStaffMoreNavItems, type StaffPrimaryNavigation } from './portal-primary-nav';
import type { PortalSession } from './portal-session';
import { canUseClientManagement, canUseGameTracker, canUseProgrammingData } from './programming-scope';

export async function resolveStaffPrimaryNavigation(session: PortalSession): Promise<StaffPrimaryNavigation> {
  const selectedSchool = resolveDashboardSchoolCode(session);
  const [canAccessSchedule, canAccessClientManagement, canAccessGameTracker] = await Promise.all([
    canUseProgrammingData(session),
    canUseClientManagement(session),
    canUseGameTracker(session),
  ]);
  const school = selectedSchool.trim().toUpperCase();
  const isTrial = school === 'TRIAL';

  return {
    canAccessSchedule,
    canAccessPlayerNotes: school !== 'LEAGUE',
    moreItems: buildStaffMoreNavItems({
      role: session.role,
      selectedSchool,
      canAccessProgramming: canAccessSchedule,
      canAccessClientManagement,
      canAccessGameTracker,
      canAccessActivityTracker: !isTrial && canViewPortalActivity(session),
      canAccessEmailAutomations:
        !isTrial && session.role === 'admin' && session.email.trim().toLowerCase() === 'jgaynor@pitchingcoachu.com',
    }),
  };
}

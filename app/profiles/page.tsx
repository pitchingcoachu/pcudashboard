import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../lib/dashboard-access';
import { resolveSessionDashboardSchoolOptions } from '../../lib/dashboard-school-options';
import { formatPlayerPlanGoalSummary } from '../../lib/player-plan-goal-display';
import { canUseProgrammingData, resolveProgrammingOrganizationId } from '../../lib/programming-scope';
import { schoolBrandCssVars } from '../../lib/school-brand';
import { listPlayerProfilesWithPlanGoals } from '../../lib/training-db';
import DashboardSchoolSelector from '../portal/dashboard/dashboard-school-selector';
import LogoutButton from '../portal/logout-button';
import MobileNavSelect from '../portal/mobile-nav-select';
import PortalNotificationsBell from '../portal/notifications-bell';
import PortalThemeToggle from '../portal/theme-toggle';
import ProfilesList from './profiles-list';

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
  const [schoolOptions] = await Promise.all([
    withTimeout(resolveSessionDashboardSchoolOptions(session), 3_000, [selectedSchool]),
  ]);
  const canAccessProgramming = canUseProgrammingData(session);
  const programmingOrganizationId = resolveProgrammingOrganizationId(session);
  const assignedCoachUserId = session.role === 'coach' ? session.userId : null;
  const players =
    canAccessProgramming && programmingOrganizationId > 0
      ? await listPlayerProfilesWithPlanGoals({
          organizationId: programmingOrganizationId,
          assignedCoachUserId,
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
    <>
      <div className="portal-shell" style={schoolBrandCssVars(selectedSchool)}>
        <header className="portal-header">
        <div className="portal-header-left">
          <DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />
        </div>
        <div className="portal-header-center">
          <nav className="portal-nav" aria-label="Portal Navigation">
            <Link href="/portal/admin" className="portal-nav-link">
              Home
            </Link>
            <Link href="/portal/dashboard" className="portal-nav-link">
              Dashboard
            </Link>
            {canAccessProgramming ? (
              <Link href="/portal/admin/schedule" className="portal-nav-link">
                Schedule
              </Link>
            ) : null}
            <Link href="/profiles" className="portal-nav-link active">
              Profiles
            </Link>
          </nav>
          <MobileNavSelect
            currentHref="/profiles"
            loggedInAs={session.name ?? session.email}
            items={[
              { href: '/portal/admin', label: 'Home' },
              { href: '/portal/dashboard', label: 'Dashboard' },
              ...(canAccessProgramming ? [{ href: '/portal/admin/schedule', label: 'Schedule' }] : []),
              { href: '/profiles', label: 'Profiles' },
            ]}
          />
        </div>
        <div className="portal-header-right">
          <div className="portal-user-meta" aria-label="Logged in user">
            <p>Logged In As</p>
            <h1>{session.name ?? session.email}</h1>
          </div>
          <PortalNotificationsBell />
          <LogoutButton />
          <PortalThemeToggle />
        </div>
        </header>

        {canAccessProgramming ? (
          <ProfilesList players={profileRows} />
        ) : (
          <section className="portal-panel">
            <h2>Profiles</h2>
            <p className="portal-muted-text">No profiles are available for this school.</p>
          </section>
        )}
      </div>
    </>
  );
}

import SchoolAccessCard from './school-access-card';
import PlayerSearch from './player-search';
import HomeNavigation, { type HomeNavigationModule } from './home-navigation';
import {
  getClientCountByOrganization,
  getExerciseCountByOrganization,
  getWorkoutCountByOrganization,
  listCoachesByOrganization,
  resolveOrganizationIdForSchool,
} from '../../../lib/training-db';
import { requirePortalSession } from '../../../lib/portal-session';
import {
  canUseClientManagement,
  canUseGameTracker,
  canUseProgrammingData,
  getSchoolProductAccess,
  resolveClientManagementOrganizationId,
  resolveProgrammingOrganizationId,
  resolveProgrammingSchoolCode,
} from '../../../lib/programming-scope';
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

export default async function AdminHomePage() {
  const session = await requirePortalSession();
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const isTrialSchool = programmingSchoolCode === 'TRIAL';
  const schoolAccess = await withTimeout(
    getSchoolProductAccess(programmingSchoolCode),
    3_000,
    { dashboard: true, programming: false, clientManagement: true, mobileSchedule: true, mobileWorkouts: true, gameTracker: true, mobileGameTracker: true, mobileNutrition: true }
  );
  const [clientManagementAllowed, programmingDataAllowed, gameTrackerAllowed, clientManagementFallbackOrgId, programmingFallbackOrgId] =
    await Promise.all([
      canUseClientManagement(session),
      canUseProgrammingData(session),
      canUseGameTracker(session),
      resolveClientManagementOrganizationId(session),
      resolveProgrammingOrganizationId(session),
    ]);
  const canAccessClientManagement =
    session.role === 'admin' ? schoolAccess.clientManagement : clientManagementAllowed;
  const canAccessProgramming = session.role === 'admin' ? schoolAccess.programming : programmingDataAllowed;
  const canAccessGameTracker = session.role === 'admin' ? schoolAccess.gameTracker : gameTrackerAllowed;
  const [resolvedClientManagementOrganizationId, resolvedProgrammingOrganizationId] = await Promise.all([
    withTimeout(
      resolveOrganizationIdForSchool({
        schoolCode: programmingSchoolCode,
        fallbackOrganizationId: clientManagementFallbackOrgId,
        createIfMissing: false,
      }),
      3_000,
      clientManagementFallbackOrgId
    ),
    withTimeout(
      resolveOrganizationIdForSchool({
        schoolCode: programmingSchoolCode,
        fallbackOrganizationId: programmingFallbackOrgId,
        createIfMissing: session.role === 'admin' && programmingSchoolCode !== 'LEAGUE',
      }),
      3_000,
      programmingFallbackOrgId
    ),
  ]);
  const clientManagementOrganizationId = canAccessClientManagement ? resolvedClientManagementOrganizationId : 0;
  const programmingOrganizationId = canAccessProgramming ? resolvedProgrammingOrganizationId : 0;
  const [visibleClientCountResult, coachesResult, exerciseCountResult, workoutCountResult] = await Promise.allSettled([
    clientManagementOrganizationId > 0
      ? withTimeout(
          getClientCountByOrganization({
            organizationId: clientManagementOrganizationId,
            assignedCoachUserId: null,
          }),
          3_500,
          0
        )
      : Promise.resolve(0),
    (session.role === 'admin' || session.role === 'coach') && clientManagementOrganizationId > 0
      ? withTimeout(listCoachesByOrganization(clientManagementOrganizationId), 3_500, [])
      : Promise.resolve([]),
    programmingOrganizationId > 0 ? withTimeout(getExerciseCountByOrganization(programmingOrganizationId), 3_500, 0) : Promise.resolve(0),
    programmingOrganizationId > 0 ? withTimeout(getWorkoutCountByOrganization(programmingOrganizationId), 3_500, 0) : Promise.resolve(0),
  ]);
  const visibleClientCount = visibleClientCountResult.status === 'fulfilled' ? visibleClientCountResult.value : 0;
  const coaches = coachesResult.status === 'fulfilled' ? coachesResult.value : [];
  const exerciseCount = exerciseCountResult.status === 'fulfilled' ? exerciseCountResult.value : 0;
  const workoutCount = workoutCountResult.status === 'fulfilled' ? workoutCountResult.value : 0;
  const school = String(programmingSchoolCode ?? '').trim().toUpperCase();
  const isLeagueSchool = school === 'LEAGUE' || school === 'INDY';
  const isProSchool = school === 'PRO';
  const canAccessSessionBooking = school === 'PCU';
  const canAccessPlayerNotes = (session.role === 'admin' || session.role === 'coach') && !isLeagueSchool;
  const canAccessActivityTracker = !isTrialSchool && canViewPortalActivity(session);
  const canAccessEmailAutomations =
    !isTrialSchool && session.role === 'admin' && session.email.trim().toLowerCase() === 'jgaynor@pitchingcoachu.com';
  const displayName = String(session.name ?? '').trim();
  const firstName = (
    displayName.includes(',')
      ? displayName.split(',').slice(1).join(' ').trim().split(/\s+/)[0]
      : displayName.split(/\s+/)[0]
  ) || String(session.email ?? '').trim().split('@')[0] || 'Coach';

  const modules: HomeNavigationModule[] = [
    {
      key: 'ball-flight',
      title: 'On Field Data',
      description: 'Pitching, hitting, catching, reports, comparisons, and player development insights.',
      href: '/portal/dashboard',
      items: [
        { href: '/portal/dashboard?suite=pitching', label: 'Pitching' },
        { href: '/portal/dashboard?suite=hitting', label: 'Hitting' },
        ...(!isProSchool ? [{ href: '/portal/dashboard?suite=catching', label: 'Catching' }] : []),
        { href: '/portal/dashboard?suite=custom-reports', label: 'Custom Reports' },
        { href: '/portal/dashboard?suite=comparison-tool', label: 'Comparison Tool' },
        ...(!isLeagueSchool ? [{ href: '/portal/dashboard?suite=player-plans', label: 'Player Plans' }] : []),
        ...(!isLeagueSchool ? [{ href: '/portal/dashboard?suite=stuff-calculator', label: 'Stuff+ Calculator' }] : []),
      ],
      meta: 'Dashboard',
    },
    ...(!isTrialSchool ? [{
      key: 'performance' as const,
      title: 'Performance Data',
      description: 'Force plates, sprint timing, velocity-based training, and pitching biomechanics.',
      href: '/portal/force-plates',
      items: [
        ...(school === 'PCU' ? [
          { href: '/portal/force-plates', label: 'VALD Force Plates' },
          { href: '/portal/force-plates?tab=sprint', label: 'OVR Sprint' },
          { href: '/portal/force-plates?tab=vbt', label: 'OVR VBT' },
          { href: '/portal/force-plates?tab=biomechanics', label: 'AxioForce Biomechanics' },
          ...(session.role === 'admin' || session.role === 'coach' ? [{ href: '/portal/force-plates?tab=imports', label: 'Imports' }] : []),
        ] : [{ href: '/portal/force-plates', label: 'Force Plate Data' }]),
        ...(!isLeagueSchool && !isProSchool ? [{ href: '/portal/admin/pulse', label: 'PULSE' }] : []),
      ],
      meta: school === 'PCU' ? 'VALD · OVR · AxioForce · PULSE' : !isLeagueSchool && !isProSchool ? 'Force plates · PULSE' : 'Force plate workspace',
    }] : []),
    ...(canAccessProgramming ? [{
      key: 'programming' as const,
      title: 'Programming',
      description: 'Build schedules, manage training content, capture sessions, and review player notes.',
      href: '/portal/admin/schedule',
      items: [
        { href: '/portal/admin/schedule', label: 'Schedule' },
        { href: '/portal/admin/workouts', label: 'Workout Library' },
        { href: '/portal/admin/exercises', label: 'Exercise Library' },
        { href: '/portal/admin/ai-sessions', label: 'AI Sessions' },
        ...(canAccessPlayerNotes ? [{ href: '/portal/admin/player-notes', label: 'Player Notes' }] : []),
        { href: '/portal/admin/master-calendar', label: 'Master Calendar' },
      ],
      meta: `${workoutCount} workouts · ${exerciseCount} exercises`,
    }] : []),
    ...(canAccessClientManagement ? [{
      key: 'roster' as const,
      title: 'Roster Management',
      description: 'Add and edit athletes, coaches, permissions, assignments, and player groups.',
      href: '/portal/admin/clients',
      items: [
        { href: '/portal/admin/clients', label: 'Players' },
        { href: '/portal/admin/coaches', label: 'Coaches' },
        { href: '/portal/admin/clients/groups', label: 'Player Groups' },
        { href: '/profiles', label: 'Player Profiles' },
      ],
      meta: `${visibleClientCount} athletes · ${coaches.length} staff`,
    }] : []),
    ...(canAccessSessionBooking ? [{
      key: 'booking' as const,
      title: 'Book Sessions',
      description: 'Publish availability, reserve sessions, and manage upcoming appointments.',
      href: '/portal/scheduling',
      items: [
        { href: '/portal/scheduling', label: 'Calendar & Bookings' },
      ],
      meta: 'PCU session calendar',
    }] : []),
    ...(canAccessGameTracker ? [{
      key: 'scorebook' as const,
      title: 'Scorebook',
      description: 'Score games, scrimmages, and live BP with lineups and situational statistics.',
      href: '/portal/admin/game-tracker',
      items: [
        { href: '/portal/admin/game-tracker', label: 'Games & Live Scoring' },
        { href: '/portal/admin/game-tracker/stats', label: 'Season Statistics' },
        { href: '/portal/admin/game-tracker/teams', label: 'Teams & Rosters' },
      ],
      meta: 'Games · Stats · Rosters',
    }] : []),
    {
      key: 'nutrition',
      title: 'Nutrition',
      description: 'Review roster-wide nutrition logging, adherence, hydration, and calorie targets.',
      href: '/portal/admin/nutrition',
      items: [{ href: '/portal/admin/nutrition', label: 'Nutrition Dashboard' }],
      meta: 'Roster nutrition overview',
    },
    {
      key: 'more',
      title: 'Admin Tools',
      description: 'School access, questionnaires, uploads, activity, exports, and organization settings.',
      href: canAccessProgramming ? '/portal/admin/questionnaires' : !isTrialSchool ? '/portal/admin/csv-uploads' : '/portal/settings',
      items: [
        ...(canAccessProgramming ? [{ href: '/portal/admin/questionnaires', label: 'Questionnaires' }] : []),
        ...(canAccessProgramming ? [{ href: '/portal/admin/testing', label: 'Testing Builder' }] : []),
        ...(!isTrialSchool ? [{ href: '/portal/admin/csv-uploads', label: 'CSV Uploads' }] : []),
        ...(canAccessActivityTracker ? [{ href: '/portal/admin/activity', label: 'Activity Tracker' }] : []),
        ...(canAccessEmailAutomations ? [{ href: '/portal/admin/email-templates', label: 'Email Automations' }] : []),
        { href: '/portal/settings', label: 'Settings & Exports' },
      ],
      meta: 'Additional workspace tools',
    },
  ];

  return (
    <div className={isTrialSchool ? 'portal-admin-home portal-admin-home--trial' : 'portal-admin-home'} style={{ display: 'grid', gap: 20 }}>
      <PlayerSearch />
      <HomeNavigation
        modules={modules}
        firstName={firstName}
        adminToolsContent={session.role === 'admin' ? (
          <SchoolAccessCard
            embedded
            schoolCode={programmingSchoolCode}
            initialAccess={{
              dashboard: schoolAccess.dashboard,
              programming: schoolAccess.programming,
              clientManagement: schoolAccess.clientManagement,
              gameTracker: schoolAccess.gameTracker,
            }}
          />
        ) : null}
      />

      <div className="portal-admin-grid">
      {programmingOrganizationId <= 0 ? (
        <article className="portal-admin-card">
          <h2>Programming Data</h2>
          <p>No programming data is configured for {programmingSchoolCode} yet.</p>
        </article>
      ) : null}
    </div>
    </div>
  );
}

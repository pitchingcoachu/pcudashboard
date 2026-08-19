import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../lib/portal-session';
import { canManagePlayer } from '../../../lib/portal-access';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { resolveSessionDashboardSchoolOptions } from '../../../lib/dashboard-school-options';
import {
  getPlayerByIdInOrganization,
  getPlayerForUser,
  listAssessmentWorkoutScoresForPlayer,
  listCoachesByOrganization,
  listBodyWeightLogsForPlayer,
  listPlayerChoicesByOrganization,
  listPlayerPlanGoalsForPlayer,
  listProgramItemsForPlayerByDateRange,
} from '../../../lib/training-db';
import { canUseGameTracker, canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../lib/programming-scope';
import PortalChrome from '../portal-chrome';
import PreviewAthleteSelect from '../preview-athlete-select';
import LogoutButton from '../logout-button';
import PortalUserMenu from '../user-menu';
import DashboardSchoolSelector from '../dashboard/dashboard-school-selector';
import PortalNotificationsBell from '../notifications-bell';
import PortalThemeToggle from '../theme-toggle';
import PortalMessagesNavButton from '../messages-nav-button';
import ProfileDashboard from './profile-dashboard';
import PlayerQuestionnaireGate from './player-questionnaire-gate';

type PlayerPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SHOW_ASSESSMENT_SCORES = false;

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timeout = setTimeout(() => resolve(fallback), timeoutMs);
    });
    const safePromise = promise.catch(() => fallback);
    return await Promise.race([safePromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export default async function PlayerPortalPage({ searchParams }: PlayerPageProps) {
  const session = await requirePortalSession();
  const schoolOptions = await resolveSessionDashboardSchoolOptions(session);
  const selectedSchool = resolveDashboardSchoolCode(session);
  const canAccessProgramming = await canUseProgrammingData(session);
  if (session.role === 'player' && !canAccessProgramming) {
    redirect('/portal/dashboard');
  }
  const canAccessGameTracker = await canUseGameTracker(session);
  const programmingOrganizationId = await resolveProgrammingOrganizationId(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const params = await searchParams;

  const previewPlayerIdRaw = typeof params.previewPlayerId === 'string' ? params.previewPlayerId : '';
  const previewSelf = typeof params.preview === 'string' ? params.preview === 'self' : false;

  let effectivePlayerId: number | null = null;

  if (session.role === 'admin' || session.role === 'coach') {
    if (previewPlayerIdRaw) {
      const parsed = Number(previewPlayerIdRaw);
      if (Number.isFinite(parsed) && parsed > 0) effectivePlayerId = parsed;
    }

    if (!effectivePlayerId && !previewSelf) {
      redirect('/portal/admin/clients');
    }
  }

  if (session.role === 'player') {
    const ownPlayer = await getPlayerForUser({
      organizationId: programmingOrganizationId,
      userId: session.userId,
    });
    effectivePlayerId = ownPlayer?.id ?? session.playerId;
  }

  if (programmingOrganizationId <= 0) {
    return (
      <PortalChrome
        left={<DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />}
        navLinks={
          <>
            {(session.role === 'admin' || session.role === 'coach') && (
              <Link href="/portal/admin" className="portal-nav-link">
                Admin
              </Link>
            )}
            <Link href="/portal/player" className="portal-nav-link active">
              Profile
            </Link>
            {canAccessProgramming ? (
              <Link href="/portal/player/program" className="portal-nav-link">
                Program
              </Link>
            ) : null}
            <Link href="/portal/dashboard" className="portal-nav-link">
              Dashboard
            </Link>
          </>
        }
        mobileNavItems={[]}
        right={
          <>
            {session.role === 'admin' || session.role === 'coach' ? (
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
        sectionClassName="portal-panel"
        tabBarRole={session.role}
        tabBarGameTrackerVisible={canAccessGameTracker}
      >
        <h2>Programming Data</h2>
        <p>No programming data is configured for {programmingSchoolCode} yet.</p>
      </PortalChrome>
    );
  }

  if (!effectivePlayerId) {
    redirect('/portal/admin/clients');
  }

  if (session.role === 'coach') {
    const allowed = await canManagePlayer(session, effectivePlayerId);
    if (!allowed) redirect('/portal/admin/clients');
  }

  const today = todayIsoDate();
  const tomorrow = addDays(today, 1);

  const [player, todayItems, bodyWeightLogs, previewClients, coaches, assessmentScores, planGoals] = await Promise.all([
    getPlayerByIdInOrganization({
      organizationId: programmingOrganizationId,
      playerId: effectivePlayerId,
    }),
    listProgramItemsForPlayerByDateRange({
      playerId: effectivePlayerId,
      startDate: today,
      endDate: tomorrow,
    }),
    withTimeout(
      listBodyWeightLogsForPlayer({
        playerId: effectivePlayerId,
        limit: 120,
      }),
      3500,
      []
    ),
    session.role === 'admin' || session.role === 'coach'
      ? listPlayerChoicesByOrganization({
          organizationId: programmingOrganizationId,
        }).then((players) =>
          players.map((player) => ({
            playerId: player.playerId,
            fullName: player.fullName,
            assignedCoachUserId: player.assignedCoachUserId,
          }))
        )
      : Promise.resolve([]),
    session.role === 'admin' || session.role === 'coach'
      ? listCoachesByOrganization(programmingOrganizationId)
      : Promise.resolve([]),
    SHOW_ASSESSMENT_SCORES
      ? withTimeout(
          listAssessmentWorkoutScoresForPlayer({
            playerId: effectivePlayerId,
            limit: session.role === 'player' ? 80 : 180,
          }),
          3500,
          []
        )
      : Promise.resolve([]),
    // player_plan_goals is a tiny, indexed (WHERE player_id = $1) lookup --
    // it should never legitimately take anywhere near 3.5s. When it did
    // time out here, the fallback (three goals with a null description) was
    // indistinguishable from "this player genuinely has no goals set" by
    // the time it reached profile-plan-goals-panel.tsx's parseGoal (which
    // drops any row with a blank description), so the whole Player Plan
    // Goals card silently vanished instead of showing real data that just
    // needed a bit more time under connection-pool contention from this
    // page's ~7 concurrent queries. A longer timeout gives the real query
    // room to win the race in the vast majority of "slow" cases instead of
    // masking them as empty.
    withTimeout(
      listPlayerPlanGoalsForPlayer({ playerId: effectivePlayerId }),
      12000,
      {
        activeGoals: [
          { slotIndex: 1 as const, category: null, goalDescription: null, createdAt: null },
          { slotIndex: 2 as const, category: null, goalDescription: null, createdAt: null },
          { slotIndex: 3 as const, category: null, goalDescription: null, createdAt: null },
        ],
        completedGoals: [],
      }
    ),
  ]);

  if (!player) {
    redirect('/portal/admin/clients');
  }

  const fullProgramHref =
    session.role === 'admin' || session.role === 'coach'
      ? `/portal/player/program?previewPlayerId=${effectivePlayerId}`
      : '/portal/player/program';

  return (
    <PortalChrome
      extraHeaderClass={session.role === 'admin' || session.role === 'coach' ? 'portal-header--player-search' : ''}
      left={
        <>
          <DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />
          {session.role === 'admin' || session.role === 'coach' ? (
            <PreviewAthleteSelect
              key={effectivePlayerId}
              basePath="/portal/player"
              selectedPlayerId={effectivePlayerId}
              players={previewClients}
            />
          ) : null}
        </>
      }
      navLinks={
        <>
          {(session.role === 'admin' || session.role === 'coach') && (
            <Link href="/portal/admin" className="portal-nav-link">
              Admin
            </Link>
          )}
          <Link href="/portal/player" className="portal-nav-link active">
            Profile
          </Link>
          {canAccessProgramming ? (
            <Link href={session.role === 'admin' || session.role === 'coach' ? '/portal/admin/schedule' : fullProgramHref} className="portal-nav-link">
              {session.role === 'admin' || session.role === 'coach' ? 'Schedule' : 'Program'}
            </Link>
          ) : null}
          {session.role === 'player' ? (
            <Link href="/portal/dashboard" className="portal-nav-link">
              Dashboard
            </Link>
          ) : (
            <Link href="/profiles" className="portal-nav-link">
              Profiles
            </Link>
          )}
        </>
      }
      mobileNavCurrentHref="/portal/player"
      mobileNavLoggedInAs={session.name ?? session.email}
      mobileNavItems={[
        ...(session.role === 'admin' || session.role === 'coach' ? [{ href: '/portal/admin', label: 'Admin' }] : []),
        { href: '/portal/player', label: 'Profile' },
        ...(canAccessProgramming
          ? [
              session.role === 'admin' || session.role === 'coach'
                ? { href: '/portal/admin/schedule', label: 'Schedule' }
                : { href: fullProgramHref, label: 'Program' },
            ]
          : []),
        ...(session.role === 'player'
          ? [{ href: '/portal/dashboard', label: 'Dashboard' }]
          : [{ href: '/profiles', label: 'Profiles' }]),
      ]}
      right={
        <>
          {session.role === 'admin' || session.role === 'coach' ? (
            <>
              <div className="portal-user-meta" aria-label="Previewing player">
                <p>Previewing</p>
                <h1>{player.fullName}</h1>
              </div>
              <PortalUserMenu displayName={session.name ?? session.email} />
            </>
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
        </>
      }
      sectionClassName="portal-panel portal-player-panel"
      tabBarRole={session.role}
      tabBarGameTrackerVisible={canAccessGameTracker}
      tabBarPreviewPlayerId={session.role === 'admin' || session.role === 'coach' ? effectivePlayerId : null}
    >
      {session.role === 'player' ? <PlayerQuestionnaireGate playerId={player.id} /> : null}
      <ProfileDashboard
          key={player.id}
          playerId={player.id}
          isAdminPreview={session.role === 'admin' || session.role === 'coach'}
          fullProgramHref={fullProgramHref}
          initialProfile={{
            fullName: player.fullName,
            email: player.email,
            status: player.status,
            dateOfBirth: player.dateOfBirth,
            schoolTeam: player.schoolTeam,
            phone: player.phone,
            collegeCommitment: player.collegeCommitment,
            gradYear: player.gradYear,
            position: player.position,
            batsHand: player.batsHand,
            throwsHand: player.throwsHand,
            height: player.height,
            profileWeightLbs: player.profileWeightLbs,
            profilePhotoDataUrl: player.profilePhotoDataUrl,
            assignedCoachUserId: player.assignedCoachUserId,
            age: player.age,
          }}
          coachOptions={coaches}
          canAssignCoach={session.role === 'admin' || session.role === 'coach'}
          canEditProfile={session.role === 'admin' || session.role === 'coach'}
          todayItems={todayItems}
          initialWeightLogs={bodyWeightLogs}
          initialAssessmentScores={assessmentScores}
          trackedExercises={[]}
          initialExerciseId={null}
          initialTrend={[]}
          sessionRole={session.role}
          sessionUserId={session.userId ?? null}
          initialPlanGoals={planGoals.activeGoals}
        />
    </PortalChrome>
  );
}

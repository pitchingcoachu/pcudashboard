import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../lib/portal-session';
import { canManagePlayer } from '../../../lib/portal-access';
import {
  getPlayerByIdInOrganization,
  getPlayerForUser,
  listAssessmentWorkoutScoresForPlayer,
  listCoachesByOrganization,
  listBodyWeightLogsForPlayer,
  listClientsByOrganization,
  listPlayerPlanGoalsForPlayer,
  listProgramItemsForPlayerByDateRange,
} from '../../../lib/training-db';
import LogoutButton from '../logout-button';
import ProfileDashboard from './profile-dashboard';

type PlayerPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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

export default async function PlayerPortalPage({ searchParams }: PlayerPageProps) {
  const session = await requirePortalSession();
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
      redirect(session.role === 'coach' ? '/portal/admin/schedule' : '/portal/admin/clients');
    }
  }

  if (session.role === 'player') {
    const ownPlayer = await getPlayerForUser({
      organizationId: session.organizationId,
      userId: session.userId,
    });
    effectivePlayerId = ownPlayer?.id ?? session.playerId;
  }

  if (!effectivePlayerId) {
    redirect(session.role === 'coach' ? '/portal/admin/schedule' : '/portal/admin/clients');
  }

  if (session.role === 'coach') {
    const allowed = await canManagePlayer(session, effectivePlayerId);
    if (!allowed) redirect('/portal/admin/schedule');
  }

  const today = todayIsoDate();
  const tomorrow = addDays(today, 1);

  const [player, todayItems, bodyWeightLogs, previewClients, coaches, assessmentScores, planGoals] = await Promise.all([
    getPlayerByIdInOrganization({
      organizationId: session.organizationId,
      playerId: effectivePlayerId,
    }),
    listProgramItemsForPlayerByDateRange({
      playerId: effectivePlayerId,
      startDate: today,
      endDate: tomorrow,
    }),
    listBodyWeightLogsForPlayer({
      playerId: effectivePlayerId,
      limit: 120,
    }),
    session.role === 'admin' || session.role === 'coach'
      ? listClientsByOrganization(session.organizationId).then((clients) =>
          session.role === 'coach' ? clients.filter((client) => client.assignedCoachUserId === session.userId) : clients
        )
      : Promise.resolve([]),
    session.role === 'admin' || session.role === 'coach'
      ? listCoachesByOrganization(session.organizationId)
      : Promise.resolve([]),
    listAssessmentWorkoutScoresForPlayer({ playerId: effectivePlayerId, limit: 240 }),
    listPlayerPlanGoalsForPlayer({ playerId: effectivePlayerId }),
  ]);

  if (!player) {
    redirect(session.role === 'coach' ? '/portal/admin/schedule' : '/portal/admin/clients');
  }

  const fullProgramHref =
    session.role === 'admin' || session.role === 'coach'
      ? `/portal/player/program?previewPlayerId=${effectivePlayerId}`
      : '/portal/player/program';

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-left">
          <Link href="/portal/player" className="portal-header-logo-link" aria-label="PCU Home">
            <img src="/pitching-coach-u-logo.png" alt="PCU logo" className="portal-header-logo" />
          </Link>
          {session.role === 'admin' || session.role === 'coach' ? (
            <form method="get" className="portal-preview-form">
              <label>
                Preview Athlete
                <select name="previewPlayerId" defaultValue={String(effectivePlayerId)}>
                  {previewClients.map((client) => (
                    <option key={client.playerId} value={String(client.playerId)}>
                      {client.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn-ghost" type="submit">
                Switch
              </button>
            </form>
          ) : null}
        </div>
        <div className="portal-header-center">
          <nav className="portal-nav" aria-label="Portal Navigation">
            {(session.role === 'admin' || session.role === 'coach') && (
              <Link href="/portal/admin" className="portal-nav-link">
                Admin
              </Link>
            )}
            <Link href="/portal/player" className="portal-nav-link active">
              Profile
            </Link>
            <Link href={fullProgramHref} className="portal-nav-link">
              Program
            </Link>
            {session.role === 'player' ? (
              <Link href="/portal/dashboard" className="portal-nav-link">
                PCU Dashboard
              </Link>
            ) : (
              <Link href="/tutorials" className="portal-nav-link">
                Tutorials
              </Link>
            )}
          </nav>
          <div className="portal-social-row" aria-label="PCU Social Links">
            <Link
              href="https://x.com/pitchingcoachu"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="PCU on X"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.244 2H21l-6.528 7.462L22.148 22h-6.012l-4.708-6.163L6.035 22H3.277l6.983-7.979L2 2h6.166l4.255 5.617L18.244 2Zm-2.108 18h1.58L7.308 3.896H5.612L16.136 20Z" />
              </svg>
            </Link>
            <Link
              href="https://instagram.com/pitchingcoachu"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="PCU on Instagram"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm0 1.75A4 4 0 0 0 3.75 7.75v8.5a4 4 0 0 0 4 4h8.5a4 4 0 0 0 4-4v-8.5a4 4 0 0 0-4-4h-8.5Zm9.063 1.312a1.188 1.188 0 1 1 0 2.375 1.188 1.188 0 0 1 0-2.375ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z" />
              </svg>
            </Link>
            <Link
              href="https://youtube.com/@pitchingcoachu?si=rstmKgKPdnzbLv6q"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="PCU on YouTube"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M23 12s0-3.2-.4-4.6a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.5.3a3 3 0 0 0-2.1 2.1C1 8.8 1 12 1 12s0 3.2.4 4.6a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.5-.3a3 3 0 0 0 2.1-2.1C23 15.2 23 12 23 12ZM10 15.5v-7l6 3.5-6 3.5Z" />
              </svg>
            </Link>
          </div>
        </div>
        <div className="portal-header-right">
          <div className="portal-user-meta" aria-label="Logged in user">
            <p>{session.role === 'admin' || session.role === 'coach' ? 'Previewing' : 'Logged In As'}</p>
            <h1>{session.role === 'admin' || session.role === 'coach' ? player.fullName : session.name ?? session.email}</h1>
          </div>
          <LogoutButton />
        </div>
      </header>

      <section className="portal-panel portal-player-panel">
        <ProfileDashboard
          playerId={player.id}
          isAdminPreview={session.role === 'admin' || session.role === 'coach'}
          fullProgramHref={fullProgramHref}
          initialProfile={{
            fullName: player.fullName,
            email: player.email,
            dateOfBirth: player.dateOfBirth,
            schoolTeam: player.schoolTeam,
            phone: player.phone,
            collegeCommitment: player.collegeCommitment,
            gradYear: player.gradYear,
            position: player.position,
            batsHand: player.batsHand,
            throwsHand: player.throwsHand,
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
          initialPlanGoals={planGoals.activeGoals}
          initialCompletedPlanGoals={planGoals.completedGoals}
        />
      </section>
    </div>
  );
}

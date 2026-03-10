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

  const [player, todayItems, bodyWeightLogs, previewClients, coaches, assessmentScores] = await Promise.all([
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
        />
      </section>
    </div>
  );
}

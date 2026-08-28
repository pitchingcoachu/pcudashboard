import { listExercisesByOrganization, listPlayerChoicesByOrganization, listWorkoutChoicesByOrganization, resolveOrganizationIdForSchool } from '../../../../lib/training-db';
import { requirePortalSession } from '../../../../lib/portal-session';
import { canUseProgrammingData, getSchoolProductAccess, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { resolveSchoolBrand } from '../../../../lib/school-brand';
import ScheduleBoard from './schedule-board';
import Link from 'next/link';

type AdminSchedulePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminSchedulePage({ searchParams }: AdminSchedulePageProps) {
  const session = await requirePortalSession();
  const params = await searchParams;
  const playerIdQueryRaw = typeof params.playerId === 'string' ? params.playerId : '';
  const playerIdQuery = Number(playerIdQueryRaw);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const brand = resolveSchoolBrand(programmingSchoolCode);
  const programmingDataAllowed = await canUseProgrammingData(session);
  const schoolAccess =
    session.role === 'admin'
      ? await getSchoolProductAccess(programmingSchoolCode)
      : { dashboard: true, programming: programmingDataAllowed, clientManagement: true };
  const canAccessProgramming = session.role === 'admin' ? schoolAccess.programming : programmingDataAllowed;
  const fallbackOrganizationId = await resolveProgrammingOrganizationId(session);
  const programmingOrganizationId = canAccessProgramming
    ? await resolveOrganizationIdForSchool({
        schoolCode: programmingSchoolCode,
        fallbackOrganizationId,
        createIfMissing: session.role === 'admin' && programmingSchoolCode !== 'LEAGUE',
      })
    : 0;
  const [playersResult, workoutsResult, exercisesResult] = await Promise.allSettled([
    programmingOrganizationId > 0
      ? listPlayerChoicesByOrganization({
          organizationId: programmingOrganizationId,
          assignedCoachUserId: null,
        })
      : Promise.resolve([]),
    programmingOrganizationId > 0 ? listWorkoutChoicesByOrganization(programmingOrganizationId) : Promise.resolve([]),
    programmingOrganizationId > 0 ? listExercisesByOrganization(programmingOrganizationId) : Promise.resolve([]),
  ]);
  const players = playersResult.status === 'fulfilled' ? playersResult.value : [];
  const workoutChoices = workoutsResult.status === 'fulfilled' ? workoutsResult.value : [];
  const loadError =
    playersResult.status === 'rejected' || workoutsResult.status === 'rejected' || exercisesResult.status === 'rejected'
      ? 'Schedule data could not be loaded right now. Please refresh and try again.'
      : '';
  const playerChoices = players.map((player) => ({ id: player.playerId, name: player.fullName }));
  const exerciseChoices =
    exercisesResult.status === 'fulfilled'
      ? exercisesResult.value.map((exercise) => ({
          id: exercise.id,
          name: exercise.name,
          category: exercise.category,
          instructionVideoUrl: exercise.instructionVideoUrl,
        }))
      : [];

  return (
    <div className="portal-admin-stack">
      {programmingOrganizationId <= 0 ? (
        <article className="portal-admin-card">
          <h3>Programming Data</h3>
          <p>No programming data is configured for {programmingSchoolCode} yet.</p>
        </article>
      ) : null}
      {loadError ? (
        <article className="portal-admin-card">
          <h3>Schedule</h3>
          <p>{loadError}</p>
        </article>
      ) : null}
      <div className="portal-admin-headline">
        <h2>Schedule Builder</h2>
        <p>Select a player, then use Workout Folder or Template Folder to drag onto the schedule.</p>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <Link href="/portal/admin/master-calendar" className="btn btn-ghost as-link">
            Open Master Calendar
          </Link>
        </div>
      </div>
      <article className="portal-admin-card">
        <ScheduleBoard
          players={playerChoices}
          workouts={workoutChoices}
          exercises={exerciseChoices}
          schoolCode={programmingSchoolCode}
          schoolLogoSrc={brand.logoSrc}
          schoolLogoAlt={brand.logoAlt}
          initialPlayerId={Number.isFinite(playerIdQuery) && playerIdQuery > 0 ? playerIdQuery : undefined}
        />
      </article>
    </div>
  );
}

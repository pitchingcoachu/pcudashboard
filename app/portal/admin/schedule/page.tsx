import { listPlayerChoicesByOrganization, listWorkoutChoicesByOrganization, resolveOrganizationIdForSchool } from '../../../../lib/training-db';
import { requirePortalSession } from '../../../../lib/portal-session';
import { canUseProgrammingData, getSchoolProductAccess, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { resolveSchoolBrand } from '../../../../lib/school-brand';
import ScheduleBoard from './schedule-board';

export default async function AdminSchedulePage() {
  const session = await requirePortalSession();
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const brand = resolveSchoolBrand(programmingSchoolCode);
  const schoolAccess =
    session.role === 'admin'
      ? await getSchoolProductAccess(programmingSchoolCode)
      : { dashboard: true, programming: canUseProgrammingData(session), clientManagement: true };
  const canAccessProgramming = session.role === 'admin' ? schoolAccess.programming : canUseProgrammingData(session);
  const fallbackOrganizationId = resolveProgrammingOrganizationId(session);
  const programmingOrganizationId = canAccessProgramming
    ? await resolveOrganizationIdForSchool({
        schoolCode: programmingSchoolCode,
        fallbackOrganizationId,
        createIfMissing: session.role === 'admin' && programmingSchoolCode !== 'LEAGUE',
      })
    : 0;
  const [playersResult, workoutsResult] = await Promise.allSettled([
    programmingOrganizationId > 0
      ? listPlayerChoicesByOrganization({
          organizationId: programmingOrganizationId,
          assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
        })
      : Promise.resolve([]),
    programmingOrganizationId > 0 ? listWorkoutChoicesByOrganization(programmingOrganizationId) : Promise.resolve([]),
  ]);
  const players = playersResult.status === 'fulfilled' ? playersResult.value : [];
  const workoutChoices = workoutsResult.status === 'fulfilled' ? workoutsResult.value : [];
  const loadError =
    playersResult.status === 'rejected' || workoutsResult.status === 'rejected'
      ? 'Schedule data could not be loaded right now. Please refresh and try again.'
      : '';
  const playerChoices = players.map((player) => ({ id: player.playerId, name: player.fullName }));

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
      </div>
      <article className="portal-admin-card">
        <ScheduleBoard
          players={playerChoices}
          workouts={workoutChoices}
          schoolCode={programmingSchoolCode}
          schoolLogoSrc={brand.logoSrc}
          schoolLogoAlt={brand.logoAlt}
        />
      </article>
    </div>
  );
}

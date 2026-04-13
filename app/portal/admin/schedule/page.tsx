import { listPlayerChoicesByOrganization, listWorkoutChoicesByOrganization } from '../../../../lib/training-db';
import { requirePortalSession } from '../../../../lib/portal-session';
import { resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import ScheduleBoard from './schedule-board';

export default async function AdminSchedulePage() {
  const session = await requirePortalSession();
  const programmingOrganizationId = resolveProgrammingOrganizationId(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const [players, workoutChoices] = await Promise.all([
    programmingOrganizationId > 0
      ? listPlayerChoicesByOrganization({
          organizationId: programmingOrganizationId,
          assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
        })
      : Promise.resolve([]),
    programmingOrganizationId > 0 ? listWorkoutChoicesByOrganization(programmingOrganizationId) : Promise.resolve([]),
  ]);
  const playerChoices = players.map((player) => ({ id: player.playerId, name: player.fullName }));

  return (
    <div className="portal-admin-stack">
      {programmingOrganizationId <= 0 ? (
        <article className="portal-admin-card">
          <h3>Programming Data</h3>
          <p>No programming data is configured for {programmingSchoolCode} yet.</p>
        </article>
      ) : null}
      <div className="portal-admin-headline">
        <h2>Schedule Builder</h2>
        <p>Select a player, then use Workout Folder or Template Folder to drag onto the schedule.</p>
      </div>
      <article className="portal-admin-card">
        <ScheduleBoard players={playerChoices} workouts={workoutChoices} />
      </article>
    </div>
  );
}

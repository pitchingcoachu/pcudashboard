import { listClientsByOrganization, listWorkoutsByOrganization } from '../../../../lib/training-db';
import { requirePortalSession } from '../../../../lib/portal-session';
import { resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import ScheduleBoard from './schedule-board';

export default async function AdminSchedulePage() {
  const session = await requirePortalSession();
  const programmingOrganizationId = resolveProgrammingOrganizationId(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const [clients, workouts] = await Promise.all([
    programmingOrganizationId > 0 ? listClientsByOrganization(programmingOrganizationId) : Promise.resolve([]),
    programmingOrganizationId > 0 ? listWorkoutsByOrganization(programmingOrganizationId) : Promise.resolve([]),
  ]);

  const visibleClients =
    session.role === 'coach' ? clients.filter((client) => client.assignedCoachUserId === session.userId) : clients;
  const players = visibleClients.map((client) => ({ id: client.playerId, name: client.fullName }));
  const workoutChoices = workouts.map((workout) => ({
    id: workout.id,
    name: workout.name,
    exerciseCount: workout.exerciseCount,
    category: workout.category,
  }));

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
        <p>Select a player, then drag workouts onto calendar dates.</p>
      </div>
      <article className="portal-admin-card">
        <ScheduleBoard players={players} workouts={workoutChoices} />
      </article>
    </div>
  );
}

import { listClientsByOrganization, listWorkoutsByOrganization } from '../../../../lib/training-db';
import { requirePortalSession } from '../../../../lib/portal-session';
import ScheduleBoard from './schedule-board';

export default async function AdminSchedulePage() {
  const session = await requirePortalSession();
  const [clients, workouts] = await Promise.all([
    listClientsByOrganization(session.organizationId),
    listWorkoutsByOrganization(session.organizationId),
  ]);

  const players = clients.map((client) => ({ id: client.playerId, name: client.fullName }));
  const workoutChoices = workouts.map((workout) => ({
    id: workout.id,
    name: workout.name,
    exerciseCount: workout.exerciseCount,
    category: workout.category,
  }));

  return (
    <div className="portal-admin-stack">
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

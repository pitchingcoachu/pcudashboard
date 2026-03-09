import Link from 'next/link';
import {
  listClientsByOrganization,
  listExercisesByOrganization,
  listProgramItemsForPlayerByMonth,
  listWorkoutsByOrganization,
} from '../../../lib/training-db';
import { requirePortalSession } from '../../../lib/portal-session';

export default async function AdminHomePage() {
  const session = await requirePortalSession();
  const [clients, exercises, workouts] = await Promise.all([
    listClientsByOrganization(session.organizationId),
    listExercisesByOrganization(session.organizationId),
    listWorkoutsByOrganization(session.organizationId),
  ]);
  const today = new Date();
  const month = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
  const firstPlayerId = clients[0]?.playerId ?? 0;
  const monthItems = firstPlayerId > 0 ? await listProgramItemsForPlayerByMonth({ playerId: firstPlayerId, month }) : [];

  return (
    <div className="portal-admin-grid">
      <article className="portal-admin-card">
        <h2>Clients</h2>
        <p>{clients.length} total athletes with plans and login access.</p>
        <Link href="/portal/admin/clients" className="btn btn-primary as-link">
          Manage Clients
        </Link>
      </article>
      <article className="portal-admin-card">
        <h2>Exercise Library</h2>
        <p>{exercises.length} exercises and drills available for assignments.</p>
        <Link href="/portal/admin/exercises" className="btn btn-primary as-link">
          Manage Exercises
        </Link>
      </article>
      <article className="portal-admin-card">
        <h2>Workout Library</h2>
        <p>{workouts.length} workouts available to assign to players.</p>
        <Link href="/portal/admin/workouts" className="btn btn-primary as-link">
          Manage Workouts
        </Link>
      </article>
      <article className="portal-admin-card">
        <h2>Schedule</h2>
        <p>Build calendars with drag/drop. {monthItems.length} assignments loaded this month.</p>
        <Link href="/portal/admin/schedule" className="btn btn-primary as-link">
          Open Schedule
        </Link>
      </article>
    </div>
  );
}

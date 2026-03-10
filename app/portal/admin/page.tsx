import Link from 'next/link';
import {
  listClientsByOrganization,
  listCoachesByOrganization,
  listExercisesByOrganization,
  listProgramItemsForPlayerByMonth,
  listWorkoutsByOrganization,
} from '../../../lib/training-db';
import { requirePortalSession } from '../../../lib/portal-session';

export default async function AdminHomePage() {
  const session = await requirePortalSession();
  const [clients, coaches, exercises, workouts] = await Promise.all([
    listClientsByOrganization(session.organizationId),
    listCoachesByOrganization(session.organizationId),
    listExercisesByOrganization(session.organizationId),
    listWorkoutsByOrganization(session.organizationId),
  ]);
  const visibleClients =
    session.role === 'coach' ? clients.filter((client) => client.assignedCoachUserId === session.userId) : clients;
  const statusCounts = visibleClients.reduce<Record<string, number>>((acc, client) => {
    const key = (client.status || 'unknown').trim() || 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const statusSummary = Object.entries(statusCounts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([status, count]) => `${status}: ${count}`)
    .join(' | ');
  const today = new Date();
  const month = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
  const firstPlayerId = visibleClients[0]?.playerId ?? 0;
  const monthItems = firstPlayerId > 0 ? await listProgramItemsForPlayerByMonth({ playerId: firstPlayerId, month }) : [];

  return (
    <div className="portal-admin-grid">
      {session.role === 'admin' ? (
        <article className="portal-admin-card">
          <h2>Clients</h2>
          <p>{visibleClients.length} total athletes with plans and login access.</p>
          <Link href="/portal/admin/clients" className="btn btn-primary as-link">
            Manage Clients
          </Link>
        </article>
      ) : (
        <article className="portal-admin-card">
          <h2>Assigned Players</h2>
          <p>{visibleClients.length} players assigned to your coaching account.</p>
          <Link href="/portal/admin/schedule" className="btn btn-primary as-link">
            Open Schedule
          </Link>
        </article>
      )}
      {session.role === 'admin' && (
        <article className="portal-admin-card">
          <h2>Coaches</h2>
          <p>{coaches.length} staff accounts with coach/admin access.</p>
          <Link href="/portal/admin/coaches" className="btn btn-primary as-link">
            Manage Coaches
          </Link>
        </article>
      )}
      {session.role === 'coach' && (
        <article className="portal-admin-card">
          <h2>My Athlete Status</h2>
          <p>{statusSummary || 'No assigned athletes yet.'}</p>
          <Link href="/portal/admin/schedule" className="btn btn-primary as-link">
            Open Assigned Schedule
          </Link>
        </article>
      )}
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
      <article className="portal-admin-card">
        <h2>PCU Dashboard</h2>
        <p>Open the main dashboard view.</p>
        <Link href="/portal" className="btn btn-primary as-link">
          Open PCU Dashboard
        </Link>
      </article>
    </div>
  );
}

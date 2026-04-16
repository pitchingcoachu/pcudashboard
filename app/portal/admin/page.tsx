import Link from 'next/link';
import SchoolAccessCard from './school-access-card';
import {
  listClientsByOrganization,
  listCoachesByOrganization,
  listExercisesByOrganization,
  listWorkoutsByOrganization,
} from '../../../lib/training-db';
import { requirePortalSession } from '../../../lib/portal-session';
import {
  canUseClientManagement,
  canUseProgrammingData,
  getSchoolProductAccess,
  refreshSchoolProductAccessCache,
  resolveClientManagementOrganizationId,
  resolveProgrammingOrganizationId,
  resolveProgrammingSchoolCode,
} from '../../../lib/programming-scope';

export default async function AdminHomePage() {
  const session = await requirePortalSession();
  await refreshSchoolProductAccessCache();
  const canAccessClientManagement = canUseClientManagement(session);
  const canAccessProgramming = canUseProgrammingData(session);
  const clientManagementOrganizationId = resolveClientManagementOrganizationId(session);
  const programmingOrganizationId = resolveProgrammingOrganizationId(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const [clients, coaches, exercises, workouts, schoolAccess] = await Promise.all([
    clientManagementOrganizationId > 0 ? listClientsByOrganization(clientManagementOrganizationId) : Promise.resolve([]),
    clientManagementOrganizationId > 0 ? listCoachesByOrganization(clientManagementOrganizationId) : Promise.resolve([]),
    programmingOrganizationId > 0 ? listExercisesByOrganization(programmingOrganizationId) : Promise.resolve([]),
    programmingOrganizationId > 0 ? listWorkoutsByOrganization(programmingOrganizationId) : Promise.resolve([]),
    getSchoolProductAccess(programmingSchoolCode),
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
  return (
    <div className="portal-admin-grid">
      {programmingOrganizationId <= 0 ? (
        <article className="portal-admin-card">
          <h2>Programming Data</h2>
          <p>No programming data is configured for {programmingSchoolCode} yet.</p>
        </article>
      ) : null}
      {session.role === 'admin' ? (
        <SchoolAccessCard
          schoolCode={programmingSchoolCode}
          initialAccess={{
            dashboard: schoolAccess.dashboard,
            programming: schoolAccess.programming,
            clientManagement: schoolAccess.clientManagement,
          }}
        />
      ) : null}
      {session.role === 'admin' && canAccessClientManagement ? (
        <article className="portal-admin-card">
          <h2>Players</h2>
          <p>{visibleClients.length} total athletes with plans and login access.</p>
          <Link href="/portal/admin/clients" className="btn btn-primary as-link">
            Manage Players
          </Link>
        </article>
      ) : null}
      {session.role === 'coach' ? (
        <article className="portal-admin-card">
          <h2>Assigned Players</h2>
          <p>{visibleClients.length} players assigned to your coaching account.</p>
          <Link href="/portal/admin/schedule" className="btn btn-primary as-link">
            Open Schedule
          </Link>
        </article>
      ) : null}
      {session.role === 'admin' && canAccessClientManagement && (
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
      {canAccessProgramming ? (
        <>
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
            <p>Build calendars with drag/drop workout scheduling.</p>
            <Link href="/portal/admin/schedule" className="btn btn-primary as-link">
              Open Schedule
            </Link>
          </article>
          <article className="portal-admin-card">
            <h2>Testing</h2>
            <p>Build testing report layouts with player/date filters and trend panels.</p>
            <Link href="/portal/admin/testing" className="btn btn-primary as-link">
              Open Testing
            </Link>
          </article>
        </>
      ) : null}
      <article className="portal-admin-card">
        <h2>Dashboard</h2>
        <p>Open the main dashboard view.</p>
        <Link href="/portal/dashboard" className="btn btn-primary as-link">
          Open Dashboard
        </Link>
      </article>
    </div>
  );
}

import Link from 'next/link';
import SchoolAccessCard from './school-access-card';
import {
  getClientCountByOrganization,
  getExerciseCountByOrganization,
  getWorkoutCountByOrganization,
  listClientStatusCountsByOrganization,
  listCoachesByOrganization,
  resolveOrganizationIdForSchool,
} from '../../../lib/training-db';
import { requirePortalSession } from '../../../lib/portal-session';
import {
  canUseClientManagement,
  canUseProgrammingData,
  getSchoolProductAccess,
  resolveClientManagementOrganizationId,
  resolveProgrammingOrganizationId,
  resolveProgrammingSchoolCode,
} from '../../../lib/programming-scope';
import { canViewPortalActivity } from '../../../lib/portal-activity';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timeout = setTimeout(() => resolve(fallback), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } catch {
    return fallback;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export default async function AdminHomePage() {
  const session = await requirePortalSession();
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const schoolAccess = await withTimeout(
    getSchoolProductAccess(programmingSchoolCode),
    3_000,
    { dashboard: true, programming: false, clientManagement: true }
  );
  const canAccessClientManagement =
    session.role === 'admin' ? schoolAccess.clientManagement : canUseClientManagement(session);
  const canAccessProgramming = session.role === 'admin' ? schoolAccess.programming : canUseProgrammingData(session);
  const [resolvedClientManagementOrganizationId, resolvedProgrammingOrganizationId] = await Promise.all([
    withTimeout(
      resolveOrganizationIdForSchool({
        schoolCode: programmingSchoolCode,
        fallbackOrganizationId: resolveClientManagementOrganizationId(session),
        createIfMissing: false,
      }),
      3_000,
      resolveClientManagementOrganizationId(session)
    ),
    withTimeout(
      resolveOrganizationIdForSchool({
        schoolCode: programmingSchoolCode,
        fallbackOrganizationId: resolveProgrammingOrganizationId(session),
        createIfMissing: session.role === 'admin' && programmingSchoolCode !== 'LEAGUE',
      }),
      3_000,
      resolveProgrammingOrganizationId(session)
    ),
  ]);
  const clientManagementOrganizationId = canAccessClientManagement ? resolvedClientManagementOrganizationId : 0;
  const programmingOrganizationId = canAccessProgramming ? resolvedProgrammingOrganizationId : 0;
  const [visibleClientCountResult, coachesResult, exerciseCountResult, workoutCountResult, coachStatusCountsResult] = await Promise.allSettled([
    clientManagementOrganizationId > 0
      ? withTimeout(
          getClientCountByOrganization({
            organizationId: clientManagementOrganizationId,
            assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
          }),
          3_500,
          0
        )
      : Promise.resolve(0),
    session.role === 'admin' && clientManagementOrganizationId > 0
      ? withTimeout(listCoachesByOrganization(clientManagementOrganizationId), 3_500, [])
      : Promise.resolve([]),
    programmingOrganizationId > 0 ? withTimeout(getExerciseCountByOrganization(programmingOrganizationId), 3_500, 0) : Promise.resolve(0),
    programmingOrganizationId > 0 ? withTimeout(getWorkoutCountByOrganization(programmingOrganizationId), 3_500, 0) : Promise.resolve(0),
    session.role === 'coach' && clientManagementOrganizationId > 0
      ? withTimeout(
          listClientStatusCountsByOrganization({
            organizationId: clientManagementOrganizationId,
            assignedCoachUserId: session.userId ?? 0,
          }),
          3_500,
          []
        )
      : Promise.resolve([]),
  ]);
  const visibleClientCount = visibleClientCountResult.status === 'fulfilled' ? visibleClientCountResult.value : 0;
  const coaches = coachesResult.status === 'fulfilled' ? coachesResult.value : [];
  const exerciseCount = exerciseCountResult.status === 'fulfilled' ? exerciseCountResult.value : 0;
  const workoutCount = workoutCountResult.status === 'fulfilled' ? workoutCountResult.value : 0;
  const coachStatusCounts = coachStatusCountsResult.status === 'fulfilled' ? coachStatusCountsResult.value : [];
  const statusSummary = coachStatusCounts
    .map(({ status, count }) => `${status}: ${count}`)
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
          <p>{visibleClientCount} total athletes with plans and login access.</p>
          <Link href="/portal/admin/clients" className="btn btn-primary as-link">
            Manage Players
          </Link>
        </article>
      ) : null}
      {session.role === 'coach' ? (
        <article className="portal-admin-card">
          <h2>Assigned Players</h2>
          <p>{visibleClientCount} players assigned to your coaching account.</p>
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
            <p>{exerciseCount} exercises and drills available for assignments.</p>
            <Link href="/portal/admin/exercises" className="btn btn-primary as-link">
              Manage Exercises
            </Link>
          </article>
          <article className="portal-admin-card">
            <h2>Workout Library</h2>
            <p>{workoutCount} workouts available to assign to players.</p>
            <Link href="/portal/admin/workouts" className="btn btn-primary as-link">
              Manage Workouts
            </Link>
          </article>
          <article className="portal-admin-card">
            <h2>Schedule</h2>
            <p>Build calendars with drag/drop workout scheduling.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link href="/portal/admin/schedule" className="btn btn-primary as-link">
                Open Schedule
              </Link>
              <Link href="/portal/admin/master-calendar" className="btn btn-ghost as-link">
                Master Calendar
              </Link>
            </div>
          </article>
          <article className="portal-admin-card">
            <h2>Testing</h2>
            <p>Build testing report layouts with player/date filters and trend panels.</p>
            <Link href="/portal/admin/testing" className="btn btn-primary as-link">
              Open Testing
            </Link>
          </article>
          <article className="portal-admin-card">
            <h2>Questionnaires</h2>
            <p>Create player questionnaires and review submitted answers.</p>
            <Link href="/portal/admin/questionnaires" className="btn btn-primary as-link">
              Open Questionnaires
            </Link>
          </article>
        </>
      ) : null}
      <article className="portal-admin-card">
        <h2>Player Notes</h2>
        <p>Open player notes in dashboard.</p>
        <Link href="/portal/dashboard?suite=player-notes" className="btn btn-primary as-link">
          Open Player Notes
        </Link>
      </article>
      {canViewPortalActivity(session) ? (
        <article className="portal-admin-card">
          <h2>Activity Tracker</h2>
          <p>Review logins, page views, and recent portal activity across all schools.</p>
          <Link href="/portal/admin/activity" className="btn btn-primary as-link">
            Open Activity Tracker
          </Link>
        </article>
      ) : null}
      {session.role === 'admin' && session.email.trim().toLowerCase() === 'jgaynor@pitchingcoachu.com' ? (
        <article className="portal-admin-card">
          <h2>Email Automations</h2>
          <p>Edit the automatic email sent after someone submits the PCU Dashboard form.</p>
          <Link href="/portal/admin/email-templates" className="btn btn-primary as-link">
            Open Email Automations
          </Link>
        </article>
      ) : null}
      <article className="portal-admin-card">
        <h2>Force Plate Data</h2>
        <p>View VALD ForceDecks metrics and test history.</p>
        <Link href="/portal/force-plates" className="btn btn-primary as-link">
          Open Force Plate Data
        </Link>
      </article>
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

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import { listClientsByOrganization, listCoachesByOrganization, listStaffOrganizationIdsByEmail } from '../../../../lib/training-db';
import { resolveAllowedDashboardSchoolCodes } from '../../../../lib/dashboard-access';
import {
  canUseClientManagement,
  resolveClientManagementOrganizationId,
  resolveProgrammingSchoolCode,
} from '../../../../lib/programming-scope';
import { CoachesTable } from './table-client';

export const dynamic = 'force-dynamic';

type CoachPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  return { ok, error };
}

function parseGlobalAdminEmails(): string[] {
  const raw = String(process.env.GLOBAL_ADMIN_EMAILS ?? 'jgaynor@pitchingcoachu.com');
  const values = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function isGlobalAdminEmail(email: string): boolean {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return parseGlobalAdminEmails().includes(normalized);
}

function parseOrgSchoolMap(raw: string): Record<number, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<number, string> = {};
    for (const [orgIdRaw, schoolRaw] of Object.entries(parsed)) {
      const orgId = Number(orgIdRaw);
      const school = typeof schoolRaw === 'string' ? schoolRaw.trim().toUpperCase() : '';
      if (!Number.isFinite(orgId) || orgId <= 0 || !school) continue;
      out[orgId] = school;
    }
    return out;
  } catch {
    return {};
  }
}

export default async function AdminCoachesPage({ searchParams }: CoachPageProps) {
  const session = await requirePortalSession();
  if (session.role !== 'admin') notFound();
  const canAccessClientManagement = canUseClientManagement(session);
  const clientManagementOrganizationId = resolveClientManagementOrganizationId(session);
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const isGlobalAdmin = isGlobalAdminEmail(session.email);
  const allSchoolCodes = resolveAllowedDashboardSchoolCodes();

  const [coaches, clients, params] = await Promise.all([
    clientManagementOrganizationId > 0 ? listCoachesByOrganization(clientManagementOrganizationId) : Promise.resolve([]),
    clientManagementOrganizationId > 0 ? listClientsByOrganization(clientManagementOrganizationId) : Promise.resolve([]),
    searchParams,
  ]);
  const { ok, error } = readMessage(params);
  const editIdRaw = typeof params.edit === 'string' ? params.edit : '';
  const editId = Number(editIdRaw);
  const coachToEdit =
    Number.isFinite(editId) && editId > 0
      ? coaches.find((coach) => Number(coach.userId) === editId) ?? null
      : null;
  const orgMap = parseOrgSchoolMap(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}');
  const editCoachOrgIds = coachToEdit ? await listStaffOrganizationIdsByEmail(coachToEdit.email) : [];
  const editCoachSchoolCodes = Array.from(
    new Set(
      editCoachOrgIds
        .map((orgId) => orgMap[orgId])
        .filter((code): code is string => Boolean(code))
    )
  );

  return (
    <div className="portal-admin-stack">
      {!canAccessClientManagement || clientManagementOrganizationId <= 0 ? (
        <article className="portal-admin-card">
          <h3>Coach Management</h3>
          <p>Coach login management is not enabled for {programmingSchoolCode}.</p>
        </article>
      ) : null}
      <div className="portal-admin-headline">
        <h2>Coaches</h2>
        <p>Create coach/admin logins and assign coaches to player profiles.</p>
      </div>

      {canAccessClientManagement && clientManagementOrganizationId > 0 ? (
      <article className="portal-admin-card">
        <h3>Add Coach Profile</h3>
        <form method="post" action="/api/admin/coaches" className="portal-form-grid">
          <input type="hidden" name="redirectTo" value="/portal/admin/coaches" />
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Phone
            <input name="phone" type="tel" />
          </label>
          <label>
            Role
            <select name="role" defaultValue="coach">
              <option value="coach">Coach</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {isGlobalAdmin ? (
            <label>
              Schools (multi-select)
              <select name="schoolCodes" multiple defaultValue={[programmingSchoolCode]} size={Math.min(8, Math.max(4, allSchoolCodes.length))}>
                {allSchoolCodes.map((schoolCode) => (
                  <option key={schoolCode} value={schoolCode}>
                    {schoolCode}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Temporary Password
            <input name="password" type="text" minLength={8} required />
          </label>
          <button type="submit" className="btn btn-primary">
            Create Coach
          </button>
        </form>
        {ok && <p className="auth-message">{ok}</p>}
        {error && <p className="auth-error">{error}</p>}
      </article>
      ) : null}

      {canAccessClientManagement && clientManagementOrganizationId > 0 && coachToEdit ? (
        <article className="portal-admin-card">
          <h3>Edit Coach</h3>
          <form method="post" action="/api/admin/coaches/manage" className="portal-form-grid">
            <input type="hidden" name="redirectTo" value="/portal/admin/coaches" />
            <input type="hidden" name="action" value="update" />
            <input type="hidden" name="staffUserId" value={String(coachToEdit.userId)} />
            <label>
              Name
              <input name="name" defaultValue={coachToEdit.name} required />
            </label>
            <label>
              Email
              <input name="email" type="email" defaultValue={coachToEdit.email} required />
            </label>
            <label>
              Phone
              <input name="phone" type="tel" defaultValue={coachToEdit.phone ?? ''} />
            </label>
            <label>
              Role
              <select name="role" defaultValue={coachToEdit.role}>
                <option value="coach">Coach</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {isGlobalAdmin ? (
              <label>
                Schools (multi-select)
                <select
                  name="schoolCodes"
                  multiple
                  defaultValue={editCoachSchoolCodes.length > 0 ? editCoachSchoolCodes : [programmingSchoolCode]}
                  size={Math.min(8, Math.max(4, allSchoolCodes.length))}
                >
                  {allSchoolCodes.map((schoolCode) => (
                    <option key={schoolCode} value={schoolCode}>
                      {schoolCode}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="portal-choice-line-actions">
              <button type="submit" className="btn btn-primary">
                Save Coach
              </button>
              <Link className="btn btn-ghost as-link" href="/portal/admin/coaches">
                Cancel
              </Link>
            </div>
          </form>
        </article>
      ) : null}

      <article className="portal-admin-card">
        <h3>Current Coaches</h3>
        {coaches.length === 0 ? (
          <p>No coaches yet.</p>
        ) : (
          <CoachesTable coaches={coaches} clients={clients} currentUserId={session.userId} />
        )}
      </article>
    </div>
  );
}

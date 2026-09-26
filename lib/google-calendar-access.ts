import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from './auth';
import { resolveDashboardSchoolCode } from './dashboard-access';
import { resolveSchoolScopedOrganizationId } from './programming-scope';

/** Google Calendar settings are managed by PCU admins only (same school gate as scheduling). */
export async function googleCalendarAdminAccess(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const schoolCode = resolveDashboardSchoolCode({
    userId: Number(session.userId ?? 0), email: session.email, name: session.name,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
    organizationId: Number(session.organizationId ?? 0), playerId: Number(session.playerId ?? 0) || null,
    dashboardSchoolCode: session.dashboardSchoolCode, appUrl: session.appUrl, apps: session.apps,
  }).toUpperCase();
  if (schoolCode !== 'PCU') return { error: NextResponse.json({ error: 'Scheduling is not enabled for this school.' }, { status: 403 }) };
  if (session.role !== 'admin') return { error: NextResponse.json({ error: 'Admin access required.' }, { status: 403 }) };
  const organizationId = resolveSchoolScopedOrganizationId(session);
  const userId = Number(session.userId ?? 0);
  if (!organizationId || !userId) return { error: NextResponse.json({ error: 'Organization access required.' }, { status: 403 }) };
  return { organizationId, userId };
}

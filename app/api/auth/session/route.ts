import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveSessionDashboardSchoolOptions } from '../../../../lib/dashboard-school-options';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);

  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  const role = session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin';
  const allowedDashboardSchoolCodes = await resolveSessionDashboardSchoolOptions({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role,
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  });

  return NextResponse.json({
    authenticated: true,
    userId: session.userId ?? null,
    name: session.name ?? null,
    email: session.email,
    role,
    organizationId: session.organizationId ?? null,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    allowedDashboardSchoolCodes,
  });
}

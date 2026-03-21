import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { getSchoolProductAccess, setSchoolProductAccess } from '../../../../lib/programming-scope';

function normalizeSchoolCode(value: string): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const requestedSchoolCode = normalizeSchoolCode(url.searchParams.get('schoolCode') ?? '');
  const schoolCode =
    requestedSchoolCode ||
    resolveDashboardSchoolCode({
      userId: session.userId ?? 0,
      email: session.email,
      name: session.name,
      role: 'admin',
      organizationId: session.organizationId ?? 0,
      playerId: session.playerId ?? null,
      dashboardSchoolCode: session.dashboardSchoolCode ?? null,
      appUrl: session.appUrl,
      apps: session.apps,
    });
  const access = await getSchoolProductAccess(schoolCode);
  return NextResponse.json({
    schoolCode,
    dashboard: access.dashboard,
    programming: access.programming,
    clientManagement: access.clientManagement,
  });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    schoolCode?: string;
    dashboard?: boolean;
    programming?: boolean;
    clientManagement?: boolean;
  };
  const schoolCode = normalizeSchoolCode(body.schoolCode ?? '');
  if (!schoolCode) return NextResponse.json({ error: 'schoolCode is required.' }, { status: 400 });

  const dashboard = body.dashboard !== false;
  const programming = body.programming === true;
  const clientManagement = body.clientManagement !== false;

  await setSchoolProductAccess({
    schoolCode,
    dashboard,
    programming,
    clientManagement,
    updatedByUserId: session.userId ?? null,
  });

  return NextResponse.json({
    ok: true,
    schoolCode,
    dashboard,
    programming,
    clientManagement,
  });
}

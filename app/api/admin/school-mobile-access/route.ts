import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { getSchoolProductAccess, setSchoolMobileAccess } from '../../../../lib/programming-scope';

function normalizeSchoolCode(value: string): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const session = getSessionFromRequest(request, cookieStore);
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
      mobileSchedule: access.mobileSchedule,
      mobileWorkouts: access.mobileWorkouts,
      mobileGameTracker: access.mobileGameTracker,
      mobileNutrition: access.mobileNutrition,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load mobile access.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const session = getSessionFromRequest(request, cookieStore);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = (await request.json().catch(() => ({}))) as {
      schoolCode?: string;
      mobileSchedule?: boolean;
      mobileWorkouts?: boolean;
      mobileGameTracker?: boolean;
      mobileNutrition?: boolean;
    };
    const schoolCode = normalizeSchoolCode(body.schoolCode ?? '');
    if (!schoolCode) return NextResponse.json({ error: 'schoolCode is required.' }, { status: 400 });

    const mobileSchedule = body.mobileSchedule !== false;
    const mobileWorkouts = body.mobileWorkouts !== false;
    const mobileGameTracker = body.mobileGameTracker !== false;
    const mobileNutrition = body.mobileNutrition !== false;

    await setSchoolMobileAccess({
      schoolCode,
      mobileSchedule,
      mobileWorkouts,
      mobileGameTracker,
      mobileNutrition,
      updatedByUserId: session.userId ?? null,
    });

    return NextResponse.json({ ok: true, schoolCode, mobileSchedule, mobileWorkouts, mobileGameTracker, mobileNutrition });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save mobile access.' },
      { status: 500 }
    );
  }
}

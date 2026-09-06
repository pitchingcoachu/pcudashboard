import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import {
  getPulseSyncStatus,
  releasePulseSyncReservation,
  reservePulseSync,
} from '../../../../../lib/pulse-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ARIZONA_SCHOOL_CODE = 'ARIZONA';
const WORKFLOW_DISPATCH_URL =
  'https://api.github.com/repos/pitchingcoachu/pcudashboard/actions/workflows/arizona-pulse-sync.yml/dispatches';

async function requireStaff() {
  const session = getSessionFromCookies(await cookies());
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  if (session.role !== 'admin' && session.role !== 'coach') {
    return { error: NextResponse.json({ error: 'PULSE is available only to coaches and admins.' }, { status: 403 }) } as const;
  }
  return { session } as const;
}

function selectedSchoolCode(session: NonNullable<ReturnType<typeof getSessionFromCookies>>): string {
  return resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role ?? 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  });
}

export async function GET() {
  try {
    const auth = await requireStaff();
    if ('error' in auth) return auth.error;
    const schoolCode = selectedSchoolCode(auth.session);
    if (schoolCode !== ARIZONA_SCHOOL_CODE) {
      return NextResponse.json({ configured: false, sync: null });
    }
    return NextResponse.json({ configured: true, sync: await getPulseSyncStatus(schoolCode) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load PULSE sync status.' },
      { status: 500 },
    );
  }
}

export async function POST() {
  const auth = await requireStaff();
  if ('error' in auth) return auth.error;
  const schoolCode = selectedSchoolCode(auth.session);
  if (schoolCode !== ARIZONA_SCHOOL_CODE) {
    return NextResponse.json({ error: 'Automatic PULSE sync is not configured for this school.' }, { status: 400 });
  }

  const token = String(process.env.GITHUB_ACTIONS_DISPATCH_TOKEN ?? '').trim();
  if (!token) {
    return NextResponse.json({ error: 'Automatic PULSE sync is not configured.' }, { status: 503 });
  }

  let hasReservation = false;
  try {
    const reserved = await reservePulseSync(schoolCode, Number(auth.session.userId ?? 0));
    if (!reserved) {
      const sync = await getPulseSyncStatus(schoolCode);
      return NextResponse.json(
        { error: 'A PULSE sync was already requested recently. Please wait 10 minutes.', sync },
        { status: 429 },
      );
    }
    hasReservation = true;

    const response = await fetch(WORKFLOW_DISPATCH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
      cache: 'no-store',
    });
    if (!response.ok) {
      await releasePulseSyncReservation(schoolCode);
      hasReservation = false;
      const detail = await response.text();
      console.error('Unable to dispatch Arizona PULSE workflow:', response.status, detail.slice(0, 500));
      return NextResponse.json({ error: 'Unable to start the PULSE sync. Please try again.' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, sync: reserved });
  } catch (error) {
    if (hasReservation) await releasePulseSyncReservation(schoolCode).catch(() => {});
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to start the PULSE sync.' },
      { status: 500 },
    );
  }
}

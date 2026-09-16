import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import {
  getTrackmanSyncStatus,
  releaseTrackmanSyncReservation,
  reserveTrackmanSync,
} from '../../../../lib/trackman-sync-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TRACKMAN_SYNC_WORKFLOWS: Record<string, string> = {
  PCU: 'pcu-trackman-sync.yml',
  ARIZONA: 'arizona-trackman-sync.yml',
  UNM: 'unm-trackman-sync.yml',
  GUND: 'gunderson-trackman-sync.yml',
  LI: 'long-island-indy-trackman-sync.yml',
  INDY: 'long-island-indy-trackman-sync.yml',
  SEMO: 'semo-trackman-sync.yml',
};

function workflowDispatchUrl(workflowFile: string): string {
  return `https://api.github.com/repos/pitchingcoachu/pcudashboard/actions/workflows/${workflowFile}/dispatches`;
}

async function requireStaff() {
  const session = getSessionFromCookies(await cookies());
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  if (session.role !== 'admin' && session.role !== 'coach') {
    return { error: NextResponse.json({ error: 'TrackMan sync is available only to coaches and admins.' }, { status: 403 }) } as const;
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
    if (!TRACKMAN_SYNC_WORKFLOWS[schoolCode]) {
      return NextResponse.json({ configured: false, sync: null });
    }
    return NextResponse.json({ configured: true, sync: await getTrackmanSyncStatus(schoolCode) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load TrackMan sync status.' },
      { status: 500 },
    );
  }
}

export async function POST() {
  const auth = await requireStaff();
  if ('error' in auth) return auth.error;
  const schoolCode = selectedSchoolCode(auth.session);
  const workflowFile = TRACKMAN_SYNC_WORKFLOWS[schoolCode];
  if (!workflowFile) {
    return NextResponse.json({ error: 'Manual TrackMan sync is not configured for this school.' }, { status: 400 });
  }

  const token = String(process.env.GITHUB_ACTIONS_DISPATCH_TOKEN ?? '').trim();
  if (!token) {
    return NextResponse.json({ error: 'Manual TrackMan sync is not configured.' }, { status: 503 });
  }

  let hasReservation = false;
  try {
    const reserved = await reserveTrackmanSync(schoolCode, Number(auth.session.userId ?? 0));
    if (!reserved) {
      const sync = await getTrackmanSyncStatus(schoolCode);
      return NextResponse.json(
        { error: 'A TrackMan sync was already requested recently. Please wait 15 minutes.', sync },
        { status: 429 },
      );
    }
    hasReservation = true;

    const response = await fetch(workflowDispatchUrl(workflowFile), {
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
      await releaseTrackmanSyncReservation(schoolCode);
      hasReservation = false;
      const detail = await response.text();
      console.error(`Unable to dispatch ${schoolCode} TrackMan workflow:`, response.status, detail.slice(0, 500));
      return NextResponse.json({ error: 'Unable to start the TrackMan sync. Please try again.' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, sync: reserved });
  } catch (error) {
    if (hasReservation) await releaseTrackmanSyncReservation(schoolCode).catch(() => {});
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to start the TrackMan sync.' },
      { status: 500 },
    );
  }
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { resolveProgrammingOrganizationId } from '../../../lib/programming-scope';
import { getPlayerForUser } from '../../../lib/training-db';
import { analyzeOvrSprintExport, importOvrSprintExport, listOvrSprintResults, listOvrSprintUploads, listOvrVbtResults } from '../../../lib/ovr-sprint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authContext() {
  const session = getSessionFromCookies(await cookies());
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  const schoolCode = resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role ?? 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  }).trim().toUpperCase();
  if (schoolCode !== 'PCU') return { error: NextResponse.json({ error: 'OVR Data is currently available only for PCU.' }, { status: 403 }) } as const;
  const organizationId = await resolveProgrammingOrganizationId(session);
  return { session, schoolCode, organizationId } as const;
}

export async function GET() {
  try {
    const auth = await authContext();
    if ('error' in auth) return auth.error;
    let playerId: number | null | undefined;
    if (auth.session.role === 'player') {
      const player = await getPlayerForUser({ organizationId: auth.organizationId, userId: auth.session.userId ?? 0 });
      playerId = player?.id ?? -1;
    }
    const [results, vbtResults, uploads] = await Promise.all([
      listOvrSprintResults({ organizationId: auth.organizationId, schoolCode: auth.schoolCode, playerId }),
      listOvrVbtResults({ organizationId: auth.organizationId, schoolCode: auth.schoolCode, playerId }),
      auth.session.role === 'player' ? Promise.resolve([]) : listOvrSprintUploads(auth.organizationId, auth.schoolCode),
    ]);
    return NextResponse.json({ results, vbtResults, uploads }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load OVR Data.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authContext();
    if ('error' in auth) return auth.error;
    if (auth.session.role !== 'admin' && auth.session.role !== 'coach') {
      return NextResponse.json({ error: 'Only coaches and admins can import OVR data.' }, { status: 403 });
    }
    const form = await request.formData();
    const action = String(form.get('action') ?? 'import').trim().toLowerCase();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose an OVR export.' }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (action === 'preview') {
      return NextResponse.json({ preview: await analyzeOvrSprintExport(file.name, bytes) });
    }
    const imported = await importOvrSprintExport({
      organizationId: auth.organizationId,
      schoolCode: auth.schoolCode,
      uploadedByUserId: auth.session.userId ?? null,
      fileName: file.name,
      bytes,
    });
    return NextResponse.json({ ok: true, ...imported });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to import the OVR export.';
    const status = /choose|missing|invalid|empty|exceeds|could not|does not contain|no data/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

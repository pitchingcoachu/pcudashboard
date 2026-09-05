import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { analyzePulseCsv, getPulseDashboard, importPulseFile, validatePulseFiles } from '../../../../lib/pulse-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

function filesFrom(form: FormData): File[] {
  return form.getAll('files').filter((entry): entry is File => typeof File !== 'undefined' && entry instanceof File);
}

export async function GET(request: Request) {
  try {
    const auth = await requireStaff();
    if ('error' in auth) return auth.error;
    const url = new URL(request.url);
    const data = await getPulseDashboard({
      schoolCode: selectedSchoolCode(auth.session),
      playerKey: url.searchParams.get('player') ?? undefined,
      startDate: url.searchParams.get('start') ?? undefined,
      endDate: url.searchParams.get('end') ?? undefined,
      sort: url.searchParams.get('sort') ?? undefined,
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load PULSE data.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStaff();
    if ('error' in auth) return auth.error;
    const form = await request.formData();
    const files = filesFrom(form);
    validatePulseFiles(files);
    const previews = await Promise.all(files.map(async (file) => analyzePulseCsv(file.name, new Uint8Array(await file.arrayBuffer()))));
    const schoolCode = selectedSchoolCode(auth.session);
    const results = [];
    for (const file of files) {
      results.push(await importPulseFile({
        schoolCode,
        organizationId: Number(auth.session.organizationId ?? 0),
        userId: Number(auth.session.userId ?? 0),
        file,
      }));
    }
    return NextResponse.json({ ok: true, schoolCode, previews, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to import PULSE CSV files.';
    const status = /choose|csv|valid|recognized|limit|exceed|specific school/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

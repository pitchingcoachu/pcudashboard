import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import {
  analyzeDashboardCsv,
  importDashboardCsv,
  listDashboardCsvUploads,
  validateDashboardCsvBatch,
} from '../../../../lib/dashboard-csv-imports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdminSession() {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  if (session.role !== 'admin' && session.role !== 'coach') {
    return { error: NextResponse.json({ error: 'Only coaches and admins can upload dashboard data.' }, { status: 403 }) } as const;
  }
  return { session } as const;
}

function selectedSchoolCode(session: {
  userId?: number;
  email: string;
  name?: string;
  role?: 'admin' | 'coach' | 'player';
  organizationId?: number;
  playerId?: number | null;
  dashboardSchoolCode?: string | null;
  appUrl: string;
  apps: Array<{ name: string; url: string }>;
}): string {
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

function uploadFiles(formData: FormData): File[] {
  return formData
    .getAll('files')
    .filter((entry): entry is File => typeof File !== 'undefined' && entry instanceof File);
}

async function queueRollupRefresh(
  schoolCode: string,
  uploads: Array<{ uploadId: number; refreshToken: string }>
): Promise<boolean> {
  if (!uploads.length) return false;
  const apiBase = resolveDashboardApiBaseUrl();
  const response = await fetch(`${apiBase}/v1/admin/csv-uploads/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      school_code: schoolCode,
      uploads: uploads.map((upload) => ({ upload_id: upload.uploadId, refresh_token: upload.refreshToken })),
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(String(payload.detail ?? payload.error ?? 'Unable to queue the dashboard refresh.'));
  }
  const payload = (await response.json().catch(() => ({}))) as { queued?: boolean };
  return payload.queued === true;
}

export async function GET() {
  try {
    const auth = await requireAdminSession();
    if ('error' in auth) return auth.error;
    const schoolCode = selectedSchoolCode(auth.session);
    const uploads = await listDashboardCsvUploads(schoolCode);
    return NextResponse.json({ schoolCode, uploads });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load CSV upload history.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdminSession();
    if ('error' in auth) return auth.error;
    const formData = await request.formData();
    const action = String(formData.get('action') ?? 'preview').trim().toLowerCase();
    if (action !== 'preview' && action !== 'import') {
      return NextResponse.json({ error: 'Invalid CSV upload action.' }, { status: 400 });
    }
    const files = uploadFiles(formData);
    validateDashboardCsvBatch(files);
    const filePayloads = await Promise.all(
      files.map(async (file) => ({ file, bytes: new Uint8Array(await file.arrayBuffer()) }))
    );

    if (action === 'preview') {
      const previews = filePayloads.map(({ file, bytes }) => {
        try {
          return { fileName: file.name, preview: analyzeDashboardCsv(file.name, bytes).preview, error: null };
        } catch (error) {
          return {
            fileName: file.name,
            preview: null,
            error: error instanceof Error ? error.message : `${file.name}: unable to analyze this CSV.`,
          };
        }
      });
      return NextResponse.json({ ok: true, provider: 'Rapsodo', previews });
    }

    const throwingHandsRaw = String(formData.get('throwingHands') ?? '[]');
    const throwingHands = JSON.parse(throwingHandsRaw) as unknown;
    if (!Array.isArray(throwingHands) || throwingHands.length !== files.length) {
      return NextResponse.json({ error: 'Select a throwing hand for every file.' }, { status: 400 });
    }
    const schoolCode = selectedSchoolCode(auth.session);
    const results = [];
    for (let index = 0; index < filePayloads.length; index += 1) {
      const throwingHand = throwingHands[index] === 'Left' ? 'Left' : throwingHands[index] === 'Right' ? 'Right' : null;
      if (!throwingHand) {
        return NextResponse.json({ error: `Select a throwing hand for ${filePayloads[index].file.name}.` }, { status: 400 });
      }
      const result = await importDashboardCsv({
        schoolCode,
        organizationId: Number(auth.session.organizationId ?? 0),
        createdByUserId: Number(auth.session.userId ?? 0) || null,
        fileName: filePayloads[index].file.name,
        fileBytes: filePayloads[index].bytes,
        throwingHand,
      });
      results.push(result);
    }

    let refreshQueued = false;
    let refreshWarning = '';
    const refreshUploads = results.flatMap((result) =>
      result.refreshToken ? [{ uploadId: result.upload.id, refreshToken: result.refreshToken }] : []
    );
    try {
      refreshQueued = await queueRollupRefresh(schoolCode, refreshUploads);
      if (refreshUploads.length && !refreshQueued) {
        refreshWarning = 'The data was imported while another dashboard refresh was already running.';
      }
    } catch (error) {
      refreshWarning = error instanceof Error ? error.message : 'The data was imported, but the dashboard refresh could not be queued.';
    }

    return NextResponse.json({
      ok: true,
      schoolCode,
      uploads: results.map((result) => ({
        ...result.upload,
        insertedRows: result.duplicateFile ? 0 : result.upload.insertedRows,
        skippedRows: result.duplicateFile ? result.upload.rowCount : result.upload.skippedRows,
        duplicateFile: result.duplicateFile,
      })),
      refreshQueued,
      refreshWarning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process CSV upload.';
    const status = /missing|required|invalid|choose|select|duplicate columns|no valid|not a csv|exceed/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

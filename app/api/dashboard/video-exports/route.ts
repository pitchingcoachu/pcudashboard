import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { isDatabaseConfigured } from '../../../../lib/auth-db';
import { deleteVideoExportJobForUser, listVideoExportJobsForUser } from '../../../../lib/training-db';
import { deleteObjectFromR2 } from '../../../../lib/biomechanics-storage';

// Exports are a personal download list scoped to the requesting user (see
// listVideoExportJobsForUser) -- there is no coach/admin "see everyone's
// exports" view, matching how a browser's own download history works.
export async function GET(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) return NextResponse.json({ jobs: [] });

  const userId = Number(session.userId ?? 0);
  if (!Number.isFinite(userId) || userId <= 0) return NextResponse.json({ jobs: [] });

  const jobs = await listVideoExportJobsForUser({ userId });
  return NextResponse.json({ jobs });
}

export async function DELETE(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 500 });

  const userId = Number(session.userId ?? 0);
  const url = new URL(request.url);
  const jobId = Number(url.searchParams.get('jobId') ?? '0');
  if (!Number.isFinite(jobId) || jobId <= 0) return NextResponse.json({ error: 'Valid jobId is required.' }, { status: 400 });

  const r2Key = await deleteVideoExportJobForUser({ userId, jobId });
  if (r2Key) await deleteObjectFromR2(r2Key).catch(() => {});
  return NextResponse.json({ ok: true });
}

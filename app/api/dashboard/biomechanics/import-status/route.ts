import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { getImportJob } from '../../../../../lib/biomechanics-import-jobs';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const jobId = String(searchParams.get('jobId') ?? '').trim();
  if (!jobId) return NextResponse.json({ error: 'jobId is required.' }, { status: 400 });
  const job = getImportJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  if (Number(job.organizationId) !== Number(session.organizationId ?? 0)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    totalRows: job.totalRows,
    processedRows: job.processedRows,
    filesProcessed: job.filesProcessed,
    fileCount: job.files.length,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}

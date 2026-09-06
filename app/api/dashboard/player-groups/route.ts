import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveSchoolScopedOrganizationId } from '../../../../lib/programming-scope';
import { listDashboardPlayerGroups } from '../../../../lib/training-db';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: string): string | null {
  if (!ISO_DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ groups: [] });

  const organizationId = resolveSchoolScopedOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ groups: [] });

  const url = new URL(request.url);
  const startRaw = String(url.searchParams.get('start_date') ?? '').trim();
  const endRaw = String(url.searchParams.get('end_date') ?? '').trim();
  const startDate = parseIsoDate(startRaw);
  const endDate = parseIsoDate(endRaw);
  if (startDate && endDate && startDate > endDate) {
    return NextResponse.json({ error: 'start_date must be on or before end_date.' }, { status: 400 });
  }

  const groups = await listDashboardPlayerGroups({ organizationId, startDate, endDate });
  return NextResponse.json(
    { groups },
    { headers: { 'cache-control': 'private, max-age=15, stale-while-revalidate=60', vary: 'Cookie' } }
  );
}

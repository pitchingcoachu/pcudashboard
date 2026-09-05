import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { listNutritionAdherenceForOrg } from '../../../../../lib/training-db';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const url = new URL(request.url);
  const endDate = url.searchParams.get('endDate') ?? new Date().toISOString().slice(0, 10);
  const startDateParam = url.searchParams.get('startDate');
  const startDate =
    startDateParam ??
    new Date(new Date(`${endDate}T00:00:00Z`).getTime() - 29 * 86_400_000).toISOString().slice(0, 10);

  const rows = await listNutritionAdherenceForOrg({ organizationId, startDate, endDate });
  return NextResponse.json({ rows, startDate, endDate });
}

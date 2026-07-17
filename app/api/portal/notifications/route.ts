import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { listPortalNotifications } from '../../../../lib/training-db';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'coach') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ count: 0, notifications: [] });

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? 15);
  const sinceDays = Number(url.searchParams.get('sinceDays') ?? 30);
  const payload = await listPortalNotifications({ organizationId, limit, sinceDays });
  return NextResponse.json(payload);
}

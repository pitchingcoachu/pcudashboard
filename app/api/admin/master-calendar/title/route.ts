import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { saveMasterCalendarTitle } from '../../../../../lib/training-db';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { title?: string } | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  const userId = session.userId ?? 0;
  if (organizationId <= 0 || userId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }

  const result = await saveMasterCalendarTitle({ organizationId, title: String(body.title ?? ''), userId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, title: result.title });
}

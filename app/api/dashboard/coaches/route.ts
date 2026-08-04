import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { listCoachesByOrganization } from '../../../../lib/training-db';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'coach') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const organizationId = await resolveProgrammingOrganizationId(session);
  const coaches = await listCoachesByOrganization(organizationId);
  return NextResponse.json({
    coaches: coaches.map((coach) => ({ userId: coach.userId, name: coach.name, role: coach.role })),
  });
}

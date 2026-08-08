import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { createClientWithLogin } from '../../../../lib/training-db';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'coach') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const organizationId = Number(session.organizationId ?? 0);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'No organization found for session.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const fullName = String(body.fullName ?? '').trim();
  const email = String(body.email ?? '').trim();
  const password = String(body.password ?? '');
  if (!fullName || !email || !password) {
    return NextResponse.json({ error: 'Name, email, and password are required.' }, { status: 400 });
  }

  const assignedCoachUserIdFromBody = Number(body.assignedCoachUserId ?? 0);
  const assignedCoachUserId =
    session.role === 'coach'
      ? session.userId ?? undefined
      : Number.isFinite(assignedCoachUserIdFromBody) && assignedCoachUserIdFromBody > 0
        ? assignedCoachUserIdFromBody
        : undefined;

  const schoolCode = resolveProgrammingSchoolCode(session);

  const result = await createClientWithLogin({
    organizationId,
    schoolCode,
    fullName,
    email,
    password,
    dateOfBirth: typeof body.dateOfBirth === 'string' ? body.dateOfBirth : undefined,
    schoolTeam: typeof body.schoolTeam === 'string' ? body.schoolTeam : undefined,
    phone: typeof body.phone === 'string' ? body.phone : undefined,
    collegeCommitment: typeof body.collegeCommitment === 'string' ? body.collegeCommitment : undefined,
    gradYear: typeof body.gradYear === 'string' ? body.gradYear : undefined,
    position: typeof body.position === 'string' ? body.position : undefined,
    height: typeof body.height === 'string' ? body.height : undefined,
    batsHand: typeof body.batsHand === 'string' ? body.batsHand : undefined,
    throwsHand: typeof body.throwsHand === 'string' ? body.throwsHand : undefined,
    assignedCoachUserId,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

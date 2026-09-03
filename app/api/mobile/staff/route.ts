import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveClientManagementOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import { createStaffUser, listCoachesByOrganization, resolveOrganizationIdForSchool } from '../../../../lib/training-db';

async function resolveSelectedOrganizationId(session: NonNullable<ReturnType<typeof getSessionFromRequest>>): Promise<number> {
  return resolveOrganizationIdForSchool({
    schoolCode: resolveProgrammingSchoolCode(session),
    fallbackOrganizationId: await resolveClientManagementOrganizationId(session),
    allowFallbackIfUnresolved: false,
  });
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const organizationId = await resolveSelectedOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'No organization found for session.' }, { status: 403 });
  }

  const coaches = await listCoachesByOrganization(organizationId);
  return NextResponse.json({ coaches });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const organizationId = await resolveSelectedOrganizationId(session);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: 'No organization found for session.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim();
  const password = String(body.password ?? '');
  const phone = typeof body.phone === 'string' ? body.phone : undefined;
  const roleRaw = String(body.role ?? '').trim().toLowerCase();
  const role = roleRaw === 'coach' ? 'coach' : 'admin';

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'Name, email, and password are required.' }, { status: 400 });
  }

  const result = await createStaffUser({
    organizationId,
    name,
    email,
    password,
    phone,
    role,
    allowCrossSchoolLinking: true,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, userId: result.userId });
}

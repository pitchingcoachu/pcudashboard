import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { deleteStaffUser, setStaffActiveStatus, updateStaffUser } from '../../../../../lib/training-db';

async function requireAdmin(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if (session.role !== 'admin') return { ok: false as const, status: 403, error: 'Forbidden' };
  const organizationId = Number(session.organizationId ?? 0);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return { ok: false as const, status: 403, error: 'No organization found for session.' };
  }
  return { ok: true as const, session, organizationId };
}

export async function PATCH(request: Request, context: { params: Promise<{ staffUserId: string }> }) {
  const allowed = await requireAdmin(request);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const { staffUserId: rawStaffUserId } = await context.params;
  const staffUserId = Number(rawStaffUserId);
  if (!Number.isFinite(staffUserId) || staffUserId <= 0) {
    return NextResponse.json({ error: 'Valid staffUserId is required.' }, { status: 400 });
  }
  if (staffUserId === (allowed.session.userId ?? 0)) {
    return NextResponse.json({ error: 'You cannot modify your own account here.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof body.isActive === 'boolean') {
    const result = await setStaffActiveStatus({
      organizationId: allowed.organizationId,
      staffUserId,
      isActive: body.isActive,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!name || !email) {
    return NextResponse.json({ error: 'Name and email are required.' }, { status: 400 });
  }
  const roleRaw = String(body.role ?? '').trim().toLowerCase();
  const role = roleRaw === 'coach' ? 'coach' : 'admin';
  const result = await updateStaffUser({
    organizationId: allowed.organizationId,
    staffUserId,
    name,
    email,
    phone: typeof body.phone === 'string' ? body.phone : undefined,
    role,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ staffUserId: string }> }) {
  const allowed = await requireAdmin(request);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const { staffUserId: rawStaffUserId } = await context.params;
  const staffUserId = Number(rawStaffUserId);
  if (!Number.isFinite(staffUserId) || staffUserId <= 0) {
    return NextResponse.json({ error: 'Valid staffUserId is required.' }, { status: 400 });
  }
  if (staffUserId === (allowed.session.userId ?? 0)) {
    return NextResponse.json({ error: 'You cannot delete your own account here.' }, { status: 400 });
  }

  const result = await deleteStaffUser({ organizationId: allowed.organizationId, staffUserId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { normalizeActivityEventType, readActivityRequestMeta } from '../../../../lib/portal-activity';
import { recordPortalActivityEvent } from '../../../../lib/training-db';

type ActivityPayload = {
  eventType?: string;
  path?: string;
  metadata?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as ActivityPayload;
  const path = String(payload.path ?? '').trim();
  if (!path.startsWith('/portal') && !path.startsWith('/profiles')) {
    return NextResponse.json({ ok: true });
  }

  const { userAgent, ipAddress } = await readActivityRequestMeta(request);
  await recordPortalActivityEvent({
    userId: session.userId ?? null,
    email: session.email,
    name: session.name ?? null,
    role: session.role ?? 'admin',
    organizationId: session.organizationId ?? null,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    eventType: normalizeActivityEventType(payload.eventType),
    path,
    metadata: payload.metadata ?? {},
    userAgent,
    ipAddress,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

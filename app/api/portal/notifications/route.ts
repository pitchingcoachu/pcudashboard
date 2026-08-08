import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { listNotificationsForUser, markNotificationsReadForUser } from '../../../../lib/training-db';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = Number(session.userId ?? 0);
  if (!Number.isFinite(userId) || userId <= 0) return NextResponse.json({ notifications: [], unreadCount: 0 });

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? 20);
  const payload = await listNotificationsForUser({ userId, limit });
  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = Number(session.userId ?? 0);
  if (!Number.isFinite(userId) || userId <= 0) return NextResponse.json({ ok: true });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const notificationIds = Array.isArray(body.notificationIds)
    ? body.notificationIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    : undefined;

  await markNotificationsReadForUser({ userId, notificationIds });
  return NextResponse.json({ ok: true });
}

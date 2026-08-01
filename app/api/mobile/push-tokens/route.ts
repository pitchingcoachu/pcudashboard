import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { deleteDevicePushToken, upsertDevicePushToken } from '../../../../lib/training-db';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { expoPushToken?: string; platform?: string };
  const expoPushToken = String(body.expoPushToken ?? '').trim();
  if (!expoPushToken) {
    return NextResponse.json({ error: 'expoPushToken is required.' }, { status: 400 });
  }

  await upsertDevicePushToken({
    userId: session.userId ?? 0,
    expoPushToken,
    platform: body.platform,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { expoPushToken?: string };
  const expoPushToken = String(body.expoPushToken ?? '').trim();
  if (!expoPushToken) {
    return NextResponse.json({ error: 'expoPushToken is required.' }, { status: 400 });
  }

  await deleteDevicePushToken(expoPushToken);
  return NextResponse.json({ ok: true });
}

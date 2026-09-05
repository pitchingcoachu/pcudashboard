import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { deleteDevicePushToken, upsertDevicePushToken } from '../../../../lib/training-db';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    deviceToken?: string;
    expoPushToken?: string;
    provider?: string;
    platform?: string;
  };
  const deviceToken = String(body.deviceToken ?? body.expoPushToken ?? '').trim();
  if (!deviceToken) {
    return NextResponse.json({ error: 'deviceToken is required.' }, { status: 400 });
  }

  await upsertDevicePushToken({
    userId: session.userId ?? 0,
    deviceToken,
    provider: body.provider === 'apns' ? 'apns' : 'expo',
    platform: body.platform,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { deviceToken?: string; expoPushToken?: string };
  const deviceToken = String(body.deviceToken ?? body.expoPushToken ?? '').trim();
  if (!deviceToken) {
    return NextResponse.json({ error: 'deviceToken is required.' }, { status: 400 });
  }

  await deleteDevicePushToken(deviceToken);
  return NextResponse.json({ ok: true });
}

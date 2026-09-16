import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { completeTrackmanSync } from '../../../../lib/trackman-sync-db';
import { createNotificationsForUsers } from '../../../../lib/training-db';
import { sendPushNotificationToUsers } from '../../../../lib/push-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isAuthorized(request: Request): boolean {
  const expected = String(process.env.TRACKMAN_SYNC_CALLBACK_TOKEN ?? '').trim();
  if (!expected) return false;
  const authorization = String(request.headers.get('authorization') ?? '').trim();
  if (!authorization.toLowerCase().startsWith('bearer ')) return false;
  return safeEqual(authorization.slice(7).trim(), expected);
}

function schoolLabel(schoolCode: string): string {
  const labels: Record<string, string> = {
    PCU: 'PCU', ARIZONA: 'Arizona', UNM: 'UNM', GUND: 'Gunderson', LI: 'Long Island Ducks', INDY: 'INDY',
  };
  return labels[schoolCode] ?? schoolCode;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { schoolCode?: string; status?: string };
  const schoolCode = String(body.schoolCode ?? '').trim().toUpperCase();
  const status = body.status === 'failed' ? 'failed' : 'success';
  if (!schoolCode) {
    return NextResponse.json({ error: 'schoolCode is required.' }, { status: 400 });
  }

  try {
    const { requestedByUserId } = await completeTrackmanSync(schoolCode, status);
    if (requestedByUserId) {
      const title = status === 'success' ? 'TrackMan sync complete' : 'TrackMan sync failed';
      const detail =
        status === 'success'
          ? `${schoolLabel(schoolCode)} TrackMan data has finished syncing.`
          : `${schoolLabel(schoolCode)} TrackMan sync failed — check the GitHub Actions log.`;
      await createNotificationsForUsers({
        recipientUserIds: [requestedByUserId],
        eventType: status === 'success' ? 'trackman_sync_complete' : 'trackman_sync_failed',
        title,
        detail,
        path: '/portal/dashboard',
      }).catch(() => {});
      await sendPushNotificationToUsers({
        userIds: [requestedByUserId],
        title,
        body: detail,
        data: { type: status === 'success' ? 'trackman_sync_complete' : 'trackman_sync_failed', schoolCode },
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true, notified: Boolean(requestedByUserId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to record sync completion.' }, { status: 500 });
  }
}

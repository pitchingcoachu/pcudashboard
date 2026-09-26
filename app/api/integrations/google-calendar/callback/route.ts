import { after, NextResponse } from 'next/server';
import { completeGoogleConnection, syncGoogleCalendarRange, verifyOAuthState } from '../../../../../lib/google-calendar';
import { googleCalendarAdminAccess } from '../../../../../lib/google-calendar-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function backToScheduling(request: Request, result: string) {
  return NextResponse.redirect(new URL(`/portal/dashboard?suite=scheduling&gcal=${encodeURIComponent(result)}`, request.url));
}

export async function GET(request: Request) {
  const auth = await googleCalendarAdminAccess(request); if ('error' in auth) return auth.error;
  const url = new URL(request.url);
  if (url.searchParams.get('error')) return backToScheduling(request, 'denied');
  const state = verifyOAuthState(url.searchParams.get('state') ?? '');
  // The state must have been issued to this same admin for this same organization.
  if (!state || state.organizationId !== auth.organizationId || state.userId !== auth.userId) return backToScheduling(request, 'invalid');
  try {
    await completeGoogleConnection({ organizationId: auth.organizationId, userId: auth.userId, code: url.searchParams.get('code') ?? '', origin: url.origin });
  } catch (error) {
    console.error('[google-calendar] connect failed', error);
    return backToScheduling(request, 'failed');
  }
  after(() => syncGoogleCalendarRange(auth.organizationId, new Date(Date.now() - 86_400_000), new Date(Date.now() + 61 * 86_400_000))
    .catch((error) => console.error('[google-calendar] initial sync failed', error)));
  return backToScheduling(request, 'connected');
}

import { NextResponse } from 'next/server';
import { buildGoogleAuthUrl, createOAuthState, isGoogleCalendarConfigured } from '../../../../../lib/google-calendar';
import { googleCalendarAdminAccess } from '../../../../../lib/google-calendar-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await googleCalendarAdminAccess(request); if ('error' in auth) return auth.error;
  if (!isGoogleCalendarConfigured()) return NextResponse.json({ error: 'Google OAuth is not configured on the server.' }, { status: 500 });
  return NextResponse.redirect(buildGoogleAuthUrl(createOAuthState(auth.organizationId, auth.userId), new URL(request.url).origin));
}

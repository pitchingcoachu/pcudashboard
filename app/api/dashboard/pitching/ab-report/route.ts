import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, shouldScopeDashboardPlayer } from '../../../../../lib/dashboard-player-scope';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const schoolCode = resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  });
  const shouldScopePlayer = shouldScopeDashboardPlayer(session.role, schoolCode);
  const inputUrl = new URL(request.url);
  const playerIdentity = shouldScopePlayer
    ? await resolveDashboardPlayerIdentity({
        role: session.role,
        organizationId: session.organizationId,
        userId: session.userId,
        name: session.name,
      })
    : null;
  if (shouldScopePlayer && !playerIdentity) {
    return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
  }
  const requestedPitcher = inputUrl.searchParams.get('pitcher')?.trim() ?? '';
  const pitcher = shouldScopePlayer && playerIdentity ? scopedPlayerQueryName(playerIdentity, 'Pitching') : requestedPitcher;
  if (!pitcher) {
    return NextResponse.json({ error: 'pitcher is required.' }, { status: 400 });
  }

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/pitching/ab-report`);
  url.searchParams.set('school_code', schoolCode);
  url.searchParams.set('pitcher', pitcher);

  const passthrough = [
    'game_key',
    'game_date',
    'opp_hitter',
    'hand',
    'batter_side',
    'session_type',
    'pitch_types',
    'ball_types',
    'start_date',
    'end_date',
  ];
  for (const key of passthrough) {
    const value = inputUrl.searchParams.get(key)?.trim() ?? '';
    if (value) url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url.toString(), { cache: 'no-store' });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const detail = String(payload.detail ?? payload.error ?? '');
      if (response.status === 404 && detail.toLowerCase() === 'not found') {
        return NextResponse.json(
          { error: 'AB Report endpoint not loaded on dashboard API. Restart the Python API server and try again.' },
          { status: 502 }
        );
      }
      return NextResponse.json(
        { error: String(payload.detail ?? payload.error ?? 'Dashboard API request failed.') },
        { status: response.status }
      );
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reach dashboard API.' },
      { status: 502 }
    );
  }
}

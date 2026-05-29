import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, shouldScopeDashboardPlayer } from '../../../../../lib/dashboard-player-scope';

function hasVideo(point: Record<string, unknown>): boolean {
  const clips = [point.video_clip_1, point.video_clip_2, point.video_clip_3]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return clips.length > 0;
}

function parseHost(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).host;
  } catch {
    return '';
  }
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const requestUrl = new URL(request.url);
  const startDate = requestUrl.searchParams.get('start_date')?.trim() ?? '';
  const endDate = requestUrl.searchParams.get('end_date')?.trim() ?? '';
  const pitcher = requestUrl.searchParams.get('pitcher')?.trim() ?? '';
  const teamType = requestUrl.searchParams.get('team_type')?.trim() ?? '';

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
  let scopedPitcher = pitcher;
  if (shouldScopePlayer) {
    const playerIdentity = await resolveDashboardPlayerIdentity({
      role: session.role,
      organizationId: session.organizationId,
      userId: session.userId,
      name: session.name,
    }).catch(() => null);
    if (!playerIdentity) {
      return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
    }
    scopedPitcher = scopedPlayerQueryName(playerIdentity, 'Pitching');
  }

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/pitching/overview`);
  url.searchParams.set('school_code', schoolCode);
  if (startDate) url.searchParams.set('start_date', startDate);
  if (endDate) url.searchParams.set('end_date', endDate);
  if (scopedPitcher) url.searchParams.set('pitcher', scopedPitcher);
  if (teamType) url.searchParams.set('team_type', teamType);
  url.searchParams.set('with_video', '1');
  url.searchParams.set('include_chart_points', '1');
  url.searchParams.set('include_row_pitches', '0');
  url.searchParams.set('include_trend_rows', '0');
  url.searchParams.set('chart_only', '1');
  url.searchParams.set('chart_points_limit', '5000');
  url.searchParams.set('force_raw', '1');

  try {
    const response = await fetch(url.toString(), { cache: 'no-store' });
    const payload = (await response.json().catch(() => ({}))) as { chart_points?: Array<Record<string, unknown>>; error?: string };
    if (!response.ok) {
      return NextResponse.json({ error: payload.error ?? 'Dashboard API request failed.' }, { status: response.status });
    }
    const points = Array.isArray(payload.chart_points) ? payload.chart_points : [];
    const withVideoCount = points.filter((point) => hasVideo(point)).length;
    const withoutVideoCount = points.length - withVideoCount;
    const hostCounts = new Map<string, number>();
    for (const point of points) {
      const host = parseHost(point.video_clip_1) || parseHost(point.video_clip_2) || parseHost(point.video_clip_3);
      if (!host) continue;
      hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    }
    return NextResponse.json({
      school_code: schoolCode,
      start_date: startDate || null,
      end_date: endDate || null,
      pitcher: scopedPitcher || null,
      total_chart_points: points.length,
      with_video: withVideoCount,
      without_video: withoutVideoCount,
      video_hosts: Array.from(hostCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([host, count]) => ({ host, count })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reach dashboard API.' },
      { status: 502 }
    );
  }
}

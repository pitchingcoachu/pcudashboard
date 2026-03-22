import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName } from '../../../../../lib/dashboard-player-scope';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const inputUrl = new URL(request.url);
  const startDate = inputUrl.searchParams.get('start_date')?.trim() ?? '';
  const endDate = inputUrl.searchParams.get('end_date')?.trim() ?? '';
  const pitcher = inputUrl.searchParams.get('pitcher')?.trim() ?? '';
  const teamType = inputUrl.searchParams.get('team_type')?.trim() ?? '';
  const oppHitter = inputUrl.searchParams.get('opp_hitter')?.trim() ?? '';
  const withVideo = inputUrl.searchParams.get('with_video')?.trim() ?? '';
  const breakLines = inputUrl.searchParams.get('break_lines')?.trim() ?? '';
  const stuffLevel = inputUrl.searchParams.get('stuff_level')?.trim() ?? '';
  const stuffBase = inputUrl.searchParams.get('stuff_base')?.trim() ?? '';
  const hand = inputUrl.searchParams.get('hand')?.trim() ?? '';
  const batterSide = inputUrl.searchParams.get('batter_side')?.trim() ?? '';
  const sessionType = inputUrl.searchParams.get('session_type')?.trim() ?? '';
  const tableMode = inputUrl.searchParams.get('table_mode')?.trim() ?? '';
  const splitBy = inputUrl.searchParams.get('split_by')?.trim() ?? '';
  const customColumns = inputUrl.searchParams.get('custom_columns')?.trim() ?? '';
  const visualOption = inputUrl.searchParams.get('visual_option')?.trim() ?? '';
  const inZone = inputUrl.searchParams.get('in_zone')?.trim() ?? '';
  const qpLocations = inputUrl.searchParams.get('qp_locations')?.trim() ?? '';
  const pitchTypes = inputUrl.searchParams.get('pitch_types')?.trim() ?? '';
  const zoneLocations = inputUrl.searchParams.get('zone_locations')?.trim() ?? '';
  const pitchResults = inputUrl.searchParams.get('pitch_results')?.trim() ?? '';
  const countFilter = inputUrl.searchParams.get('count_filter')?.trim() ?? '';
  const afterCountFilter = inputUrl.searchParams.get('after_count_filter')?.trim() ?? '';
  const veloMin = inputUrl.searchParams.get('velo_min')?.trim() ?? '';
  const veloMax = inputUrl.searchParams.get('velo_max')?.trim() ?? '';
  const ivbMin = inputUrl.searchParams.get('ivb_min')?.trim() ?? '';
  const ivbMax = inputUrl.searchParams.get('ivb_max')?.trim() ?? '';
  const hbMin = inputUrl.searchParams.get('hb_min')?.trim() ?? '';
  const hbMax = inputUrl.searchParams.get('hb_max')?.trim() ?? '';
  const pcMin = inputUrl.searchParams.get('pc_min')?.trim() ?? '';
  const pcMax = inputUrl.searchParams.get('pc_max')?.trim() ?? '';
  const playerIdentity = await resolveDashboardPlayerIdentity({
    role: session.role,
    organizationId: session.organizationId,
    userId: session.userId,
    name: session.name,
  });
  if (session.role === 'player' && !playerIdentity) {
    return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
  }
  const scopedPitcher = playerIdentity ? scopedPlayerQueryName(playerIdentity, 'Pitching') : '';

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

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/pitching/overview`);
  url.searchParams.set('school_code', schoolCode);
  if (startDate) url.searchParams.set('start_date', startDate);
  if (endDate) url.searchParams.set('end_date', endDate);
  if (scopedPitcher) url.searchParams.set('pitcher', scopedPitcher);
  else if (pitcher) url.searchParams.set('pitcher', pitcher);
  if (teamType) url.searchParams.set('team_type', teamType);
  if (oppHitter) url.searchParams.set('opp_hitter', oppHitter);
  if (withVideo) url.searchParams.set('with_video', withVideo);
  if (breakLines) url.searchParams.set('break_lines', breakLines);
  if (stuffLevel) url.searchParams.set('stuff_level', stuffLevel);
  if (stuffBase) url.searchParams.set('stuff_base', stuffBase);
  if (hand) url.searchParams.set('hand', hand);
  if (batterSide) url.searchParams.set('batter_side', batterSide);
  if (sessionType) url.searchParams.set('session_type', sessionType);
  if (tableMode) url.searchParams.set('table_mode', tableMode);
  if (splitBy) url.searchParams.set('split_by', splitBy);
  if (customColumns) url.searchParams.set('custom_columns', customColumns);
  if (visualOption) url.searchParams.set('visual_option', visualOption);
  if (inZone) url.searchParams.set('in_zone', inZone);
  if (qpLocations) url.searchParams.set('qp_locations', qpLocations);
  if (pitchTypes) url.searchParams.set('pitch_types', pitchTypes);
  if (zoneLocations) url.searchParams.set('zone_locations', zoneLocations);
  if (pitchResults) url.searchParams.set('pitch_results', pitchResults);
  if (countFilter) url.searchParams.set('count_filter', countFilter);
  if (afterCountFilter) url.searchParams.set('after_count_filter', afterCountFilter);
  if (veloMin) url.searchParams.set('velo_min', veloMin);
  if (veloMax) url.searchParams.set('velo_max', veloMax);
  if (ivbMin) url.searchParams.set('ivb_min', ivbMin);
  if (ivbMax) url.searchParams.set('ivb_max', ivbMax);
  if (hbMin) url.searchParams.set('hb_min', hbMin);
  if (hbMax) url.searchParams.set('hb_max', hbMax);
  if (pcMin) url.searchParams.set('pc_min', pcMin);
  if (pcMax) url.searchParams.set('pc_max', pcMax);

  try {
    const result = await fetchDashboardJsonWithCache({
      cacheKey: `pitching:overview:${url.toString()}`,
      ttlMs: 15000,
      fetcher: () => fetch(url.toString(), { cache: 'no-store' }),
    });
    if (result.status < 200 || result.status >= 300) {
      return NextResponse.json({ error: String(result.payload.detail ?? result.payload.error ?? 'Dashboard API request failed.') }, { status: result.status });
    }
    return NextResponse.json(result.payload, { headers: { 'x-dashboard-cache': result.cached ? 'HIT' : 'MISS' } });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to reach dashboard API.',
      },
      { status: 502 }
    );
  }
}

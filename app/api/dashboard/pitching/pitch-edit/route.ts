import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'coach') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    pitch_event_id?: number | string;
    pitch_event_ids?: Array<number | string>;
    pitch_type?: string;
    pitcher?: string;
    ball_type?: string;
  };

  const singlePitchEventId = Number(body.pitch_event_id);
  const pitchEventIds = (Array.isArray(body.pitch_event_ids) ? body.pitch_event_ids : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.trunc(value));
  if (Number.isFinite(singlePitchEventId) && singlePitchEventId > 0) {
    pitchEventIds.push(Math.trunc(singlePitchEventId));
  }
  const uniquePitchEventIds = Array.from(new Set(pitchEventIds));
  const pitchType = (body.pitch_type ?? '').toString().trim();
  const pitcher = (body.pitcher ?? '').toString().trim();
  const ballType = (body.ball_type ?? '').toString().trim();
  if (!uniquePitchEventIds.length) {
    return NextResponse.json({ error: 'pitch_event_id or pitch_event_ids is required.' }, { status: 400 });
  }
  if (!pitchType) return NextResponse.json({ error: 'pitch_type is required.' }, { status: 400 });
  if (!pitcher) return NextResponse.json({ error: 'pitcher is required.' }, { status: 400 });

  const schoolCode = resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role,
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  });

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/pitching/pitch-edit`);

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        school_code: schoolCode,
        pitch_event_ids: uniquePitchEventIds,
        pitch_type: pitchType,
        pitcher,
        ...(ballType ? { ball_type: ballType } : {}),
      }),
      cache: 'no-store',
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json(
        { error: String(payload.detail ?? payload.error ?? 'Dashboard API request failed.') },
        { status: response.status }
      );
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to reach dashboard API.',
      },
      { status: 502 }
    );
  }
}

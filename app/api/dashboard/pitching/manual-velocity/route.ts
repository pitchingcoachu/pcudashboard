import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, selectScopedPlayerName } from '../../../../../lib/dashboard-player-scope';

function getPortalSession() {
  return cookies().then((cookieStore) => {
    const session = getSessionFromCookies(cookieStore);
    if (!session) return null;
    return {
      userId: session.userId ?? 0,
      email: session.email,
      name: session.name,
      role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
      organizationId: session.organizationId ?? 0,
      playerId: session.playerId ?? null,
      dashboardSchoolCode: session.dashboardSchoolCode ?? null,
      appUrl: session.appUrl,
      apps: session.apps,
    } as const;
  });
}

export async function GET() {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const playerIdentity = await resolveDashboardPlayerIdentity(session);
  if (session.role === 'player' && !playerIdentity) {
    return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
  }
  const schoolCode = resolveDashboardSchoolCode(session);
  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/pitching/manual-velocity`);
  url.searchParams.set('school_code', schoolCode);

  try {
    const response = await fetch(url.toString(), { cache: 'no-store' });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json(
        { error: String(payload.detail ?? payload.error ?? 'Manual velocity request failed.') },
        { status: response.status }
      );
    }
    if (playerIdentity) {
      const entriesRaw = Array.isArray(payload.entries) ? payload.entries : [];
      const pitcherValues = entriesRaw.map((entry) => String((entry as { pitcher?: unknown }).pitcher ?? '').trim());
      const scopedPitcher = selectScopedPlayerName(pitcherValues, playerIdentity);
      const fallbackPitcher = scopedPlayerQueryName(playerIdentity, 'Pitching');
      const allowedPitcher = scopedPitcher || fallbackPitcher;
      const filteredEntries = entriesRaw.filter((entry) => String((entry as { pitcher?: unknown }).pitcher ?? '').trim() === allowedPitcher);
      return NextResponse.json({ ...payload, entries: filteredEntries });
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reach dashboard API.' },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const playerIdentity = await resolveDashboardPlayerIdentity(session);
  if (session.role === 'player' && !playerIdentity) {
    return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
  }
  const schoolCode = resolveDashboardSchoolCode(session);
  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/pitching/manual-velocity`);
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const payload = {
      ...body,
      school_code: schoolCode,
      ...(playerIdentity ? { pitcher: scopedPlayerQueryName(playerIdentity, 'Pitching') } : {}),
    };
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json(
        { error: String(data.detail ?? data.error ?? 'Failed to save manual velocity entries.') },
        { status: response.status }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reach dashboard API.' },
      { status: 502 }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const playerIdentity = await resolveDashboardPlayerIdentity(session);
  if (session.role === 'player' && !playerIdentity) {
    return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
  }
  const schoolCode = resolveDashboardSchoolCode(session);
  const entryId = (new URL(request.url).searchParams.get('entry_id') ?? '').trim();
  if (!entryId) {
    return NextResponse.json({ error: 'entry_id is required.' }, { status: 400 });
  }

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/pitching/manual-velocity`);
  url.searchParams.set('school_code', schoolCode);
  url.searchParams.set('entry_id', entryId);
  try {
    if (playerIdentity) {
      const verifyUrl = new URL(`${apiBase}/v1/pitching/manual-velocity`);
      verifyUrl.searchParams.set('school_code', schoolCode);
      const verifyResponse = await fetch(verifyUrl.toString(), { cache: 'no-store' });
      const verifyPayload = (await verifyResponse.json().catch(() => ({}))) as Record<string, unknown>;
      if (!verifyResponse.ok) {
        return NextResponse.json(
          { error: String(verifyPayload.detail ?? verifyPayload.error ?? 'Manual velocity request failed.') },
          { status: verifyResponse.status }
        );
      }
      const entriesRaw = Array.isArray(verifyPayload.entries) ? verifyPayload.entries : [];
      const pitcherValues = entriesRaw.map((entry) => String((entry as { pitcher?: unknown }).pitcher ?? '').trim());
      const scopedPitcher = selectScopedPlayerName(pitcherValues, playerIdentity) || scopedPlayerQueryName(playerIdentity, 'Pitching');
      const ownsEntry = entriesRaw.some((entry) => {
        const record = entry as { id?: unknown; pitcher?: unknown };
        return String(record.id ?? '').trim() === entryId && String(record.pitcher ?? '').trim() === scopedPitcher;
      });
      if (!ownsEntry) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const response = await fetch(url.toString(), { method: 'DELETE', cache: 'no-store' });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json(
        { error: String(payload.detail ?? payload.error ?? 'Failed to delete manual velocity entry.') },
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

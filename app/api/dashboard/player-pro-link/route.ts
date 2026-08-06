import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { deletePlayerProLink, getPlayerProLink, setPlayerProLink } from '../../../../lib/training-db';

type StatsApiPerson = {
  id?: number;
  fullName?: string;
};

// School names are stored "Last, First" (e.g. "Alberts, Andrew"); MLB StatsAPI
// expects and returns "First Last". Flip the order so the seeded search finds
// the right person without the coach having to retype the name themselves.
function schoolNameToSearchQuery(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed.includes(',')) return trimmed;
  const [last, ...rest] = trimmed.split(',');
  const first = rest.join(' ').trim();
  return [first, last.trim()].filter(Boolean).join(' ');
}

async function requireSession(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const organizationId = Number(session.organizationId ?? 0);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return { ok: false as const, status: 403, error: 'No organization found for session.' };
  }
  return { ok: true as const, session, organizationId };
}

export async function GET(request: Request) {
  const allowed = await requireSession(request);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const url = new URL(request.url);
  const rawSearch = url.searchParams.get('search')?.trim() ?? '';
  const seedFromName = url.searchParams.get('seedFromName')?.trim() ?? '';
  const search = rawSearch || (seedFromName ? schoolNameToSearchQuery(seedFromName) : '');
  const playerIdParam = url.searchParams.get('playerId');

  if (search) {
    try {
      const searchUrl = new URL('https://statsapi.mlb.com/api/v1/people/search');
      searchUrl.searchParams.set('names', search);
      const response = await fetch(searchUrl.toString(), { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as { people?: StatsApiPerson[] };
      const people = Array.isArray(payload.people) ? payload.people : [];
      const results = people
        .map((p) => ({ id: Number(p.id ?? 0), fullName: String(p.fullName ?? '').trim() }))
        .filter((p) => p.id > 0 && p.fullName);
      return NextResponse.json({ results });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to search PRO players.' },
        { status: 502 }
      );
    }
  }

  const playerId = Number(playerIdParam);
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }
  const link = await getPlayerProLink({ organizationId: allowed.organizationId, playerId });
  return NextResponse.json({ link });
}

export async function POST(request: Request) {
  const allowed = await requireSession(request);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  if (allowed.session.role === 'player') {
    return NextResponse.json({ error: 'Only coaches and admins can link a player to PRO data.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { playerId?: unknown; proPlayerName?: unknown };
  const playerId = Number(body.playerId);
  const proPlayerName = String(body.proPlayerName ?? '').trim();
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }
  if (!proPlayerName) {
    return NextResponse.json({ error: 'proPlayerName is required.' }, { status: 400 });
  }

  const link = await setPlayerProLink({
    organizationId: allowed.organizationId,
    playerId,
    proPlayerName,
    createdByUserId: allowed.session.userId ?? null,
  });
  if (!link) return NextResponse.json({ error: 'Player not found in your organization.' }, { status: 404 });
  return NextResponse.json({ ok: true, link });
}

export async function DELETE(request: Request) {
  const allowed = await requireSession(request);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  if (allowed.session.role === 'player') {
    return NextResponse.json({ error: 'Only coaches and admins can remove a PRO link.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId'));
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }
  const removed = await deletePlayerProLink({ organizationId: allowed.organizationId, playerId });
  if (!removed) return NextResponse.json({ error: 'Player not found in your organization.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

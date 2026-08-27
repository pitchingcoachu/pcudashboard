import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import {
  getPlayerMedia,
  listBodyWeightLogsForPlayer,
  upsertBodyWeightLog,
} from '../../../../lib/training-db';
import { resolveManageablePlayerOrganizationId } from '../../../../lib/portal-access';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';

// Coaches asked for this specifically so players can't make up a number --
// require photo evidence of the scale for every UNOH weight entry.
const PHOTO_REQUIRED_SCHOOL_CODES = new Set(['UNOH']);

async function ensurePlayerAccess(session: { role?: string; organizationId?: number; userId?: number; playerId?: number | null } | null, playerId: number) {
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const organizationId = await resolveManageablePlayerOrganizationId(session, playerId);
  if (!organizationId) return { ok: false as const, status: 403, error: 'Forbidden' };
  return { ok: true as const, playerId, organizationId };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await ensurePlayerAccess(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const logs = await listBodyWeightLogsForPlayer({ playerId: allowed.playerId, limit: 365 });
  return NextResponse.json({ logs });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? 0);
  const logDate = String(body.logDate ?? '');
  const weightLbs = Number(body.weightLbs ?? 0);
  const mediaIdRaw = Number(body.mediaId ?? 0);
  const mediaId = Number.isFinite(mediaIdRaw) && mediaIdRaw > 0 ? mediaIdRaw : null;

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  }

  const allowed = await ensurePlayerAccess(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  // Resolve the photo requirement from the PLAYER's own organization, not the
  // coach/admin session's default school -- a multi-school coach managing a
  // UNOH player must still be required to attach a photo, even if their own
  // session defaults somewhere else.
  const playerSchoolCode = resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role ?? 'coach',
    organizationId: allowed.organizationId,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: null,
    appUrl: session.appUrl,
    apps: session.apps,
  });
  if (PHOTO_REQUIRED_SCHOOL_CODES.has(playerSchoolCode)) {
    if (!mediaId) {
      return NextResponse.json({ error: 'A photo of the scale is required for weight entries.' }, { status: 400 });
    }
    const media = await getPlayerMedia({ organizationId: allowed.organizationId, mediaId });
    if (!media || media.playerId !== allowed.playerId) {
      return NextResponse.json({ error: 'Uploaded photo does not belong to this player.' }, { status: 400 });
    }
    if (media.mediaType !== 'photo') {
      return NextResponse.json({ error: 'Weight entries require a photo, not a video or document.' }, { status: 400 });
    }
  }

  const result = await upsertBodyWeightLog({
    playerId: allowed.playerId,
    loggedByUserId: session.userId ?? 0,
    logDate,
    weightLbs,
    notes: String(body.notes ?? ''),
    mediaId,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const logs = await listBodyWeightLogsForPlayer({ playerId: allowed.playerId, limit: 365 });
  return NextResponse.json({ ok: true, logs });
}

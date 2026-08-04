import { Buffer } from 'node:buffer';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../lib/auth';
import { isMotionCaptureVideoStorageConfigured, uploadMotionCaptureVideoToR2 } from '../../../lib/biomechanics-storage';
import {
  addMotionCaptureVideo,
  createMotionCaptureThrow,
  deleteMotionCaptureThrow,
  getMotionCaptureThrowForAccess,
  listMotionCaptureThrows,
  listTrackmanPitchOptionsForMotionCapture,
  updateMotionCaptureAnalysis,
  updatePlayerThrowsHand,
  type TrackmanPitchOption,
} from '../../../lib/motion-capture-db';
import { canManagePlayer } from '../../../lib/portal-access';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../lib/programming-scope';
import { getPlayerByIdInOrganization, getPlayerForUser, listPlayerChoicesByOrganization } from '../../../lib/training-db';

export const maxDuration = 300;

const MAX_VIDEO_BYTES = 350 * 1024 * 1024;

function normalizeHandedness(value: string): 'RHP' | 'LHP' {
  return String(value ?? '').trim().toUpperCase() === 'LHP' ? 'LHP' : 'RHP';
}

function toFirstLast(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',').map((x) => x.trim());
  const first = rest.join(' ').trim();
  return first && last ? `${first} ${last}` : raw;
}

function resolveApiSchoolCode(session: NonNullable<ReturnType<typeof getSessionFromCookies>>): string {
  return String(resolveProgrammingSchoolCode(session) || session.dashboardSchoolCode || process.env.DASHBOARD_DEFAULT_SCHOOL_CODE || 'PCU')
    .trim()
    .toUpperCase();
}

async function resolveAllowedPlayer(
  session: NonNullable<ReturnType<typeof getSessionFromCookies>>,
  requestedPlayerId: number
) {
  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return { ok: false as const, status: 403, error: 'No organization is available.' };

  if (session.role === 'player') {
    const own = await getPlayerForUser({ organizationId, userId: session.userId ?? 0 });
    const ownId = own?.id ?? session.playerId ?? 0;
    if (ownId !== requestedPlayerId) return { ok: false as const, status: 403, error: 'Forbidden' };
    if (!own) return { ok: false as const, status: 404, error: 'Player not found.' };
    return { ok: true as const, player: own, organizationId };
  }

  const allowed = await canManagePlayer(session, requestedPlayerId);
  if (!allowed) return { ok: false as const, status: 403, error: 'Forbidden' };
  const player = await getPlayerByIdInOrganization({ organizationId, playerId: requestedPlayerId });
  if (!player) return { ok: false as const, status: 404, error: 'Player not found.' };
  return { ok: true as const, player, organizationId };
}

function serializeTrackmanPitch(option: TrackmanPitchOption | null): Record<string, unknown> | null {
  if (!option) return null;
  return {
    pitchEventId: option.pitchEventId,
    label: option.label,
    pitchNo: option.pitchNo,
    pitchType: option.pitchType,
    velocityMph: option.velocityMph,
    pitchTime: option.pitchTime,
  };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session))) return NextResponse.json({ error: 'Programming access is required.' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  const selectedSchool = resolveApiSchoolCode(session);
  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const throwDate = String(url.searchParams.get('date') ?? '').trim();

  let players: Array<{ playerId: number; fullName: string; assignedCoachUserId: number | null }> = [];
  if (session.role === 'player') {
    const own = await getPlayerForUser({ organizationId, userId: session.userId ?? 0 });
    players = own ? [{ playerId: own.id, fullName: own.fullName, assignedCoachUserId: own.assignedCoachUserId }] : [];
  } else {
    players = await listPlayerChoicesByOrganization({
      organizationId,
      assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
      activeOnly: true,
    });
  }

  const selectedPlayerId = playerId > 0 ? playerId : (players[0]?.playerId ?? 0);
  const allowed = selectedPlayerId > 0 ? await resolveAllowedPlayer(session, selectedPlayerId) : null;
  const selectedPlayer = allowed?.ok ? allowed.player : null;
  const throws = selectedPlayer
    ? await listMotionCaptureThrows({
        organizationId,
        schoolCode: selectedSchool,
        playerId: selectedPlayer.id,
        throwDate: throwDate || null,
      })
    : [];
  const trackmanPitches =
    selectedPlayer && throwDate
      ? await listTrackmanPitchOptionsForMotionCapture({
          schoolCode: selectedSchool,
          playerName: toFirstLast(selectedPlayer.fullName),
          throwDate,
        })
      : [];

  return NextResponse.json({
    players,
    selectedPlayer,
    throws,
    trackmanPitches,
    videoStorageConfigured: isMotionCaptureVideoStorageConfigured(),
  });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session))) return NextResponse.json({ error: 'Programming access is required.' }, { status: 403 });
  if (!isMotionCaptureVideoStorageConfigured()) return NextResponse.json({ error: 'Video storage is not configured for uploads.' }, { status: 500 });

  const form = await request.formData();
  const playerId = Number(form.get('playerId') ?? '0');
  const throwDate = String(form.get('throwDate') ?? '').trim();
  const handedness = normalizeHandedness(String(form.get('handedness') ?? ''));
  const throwType = String(form.get('throwType') ?? '').trim() || 'mound_no_trackman';
  const pitchEventId = String(form.get('pitchEventId') ?? '').trim() || null;
  const trackmanPitchLabel = String(form.get('trackmanPitchLabel') ?? '').trim() || null;
  const updateDefaultHandedness = String(form.get('updateDefaultHandedness') ?? '1') === '1';
  const sideVideo = form.get('sideVideo');
  const behindVideo = form.get('behindVideo');

  if (!Number.isFinite(playerId) || playerId <= 0) return NextResponse.json({ error: 'Valid playerId is required.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(throwDate)) return NextResponse.json({ error: 'Valid throw date is required.' }, { status: 400 });
  const files = [
    sideVideo instanceof File && sideVideo.size > 0 ? { viewType: 'side' as const, file: sideVideo } : null,
    behindVideo instanceof File && behindVideo.size > 0 ? { viewType: 'behind' as const, file: behindVideo } : null,
  ].filter(Boolean) as Array<{ viewType: 'side' | 'behind'; file: File }>;
  if (!files.length) return NextResponse.json({ error: 'Upload at least one video.' }, { status: 400 });
  for (const entry of files) {
    if (entry.file.size > MAX_VIDEO_BYTES) {
      return NextResponse.json({ error: `${entry.file.name} is too large. Limit is 350 MB per video.` }, { status: 400 });
    }
    if (!String(entry.file.type || '').startsWith('video/')) {
      return NextResponse.json({ error: `${entry.file.name} must be a video file.` }, { status: 400 });
    }
  }

  const allowed = await resolveAllowedPlayer(session, playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const selectedSchool = resolveApiSchoolCode(session);
  let trackmanPitchJson: Record<string, unknown> | null = null;
  if (pitchEventId) {
    const options = await listTrackmanPitchOptionsForMotionCapture({
      schoolCode: selectedSchool,
      playerName: toFirstLast(allowed.player.fullName),
      throwDate,
    });
    const match = options.find((option) => option.pitchEventId === pitchEventId) ?? null;
    trackmanPitchJson = serializeTrackmanPitch(match) ?? { pitchEventId, label: trackmanPitchLabel };
  }

  const throwId = await createMotionCaptureThrow({
    organizationId: allowed.organizationId,
    schoolCode: selectedSchool,
    playerId,
    throwDate,
    throwType,
    handedness,
    pitchEventId,
    trackmanPitchLabel,
    trackmanPitchJson,
    createdByUserId: session.userId ?? null,
  });

  try {
    for (const entry of files) {
      const arrayBuffer = await entry.file.arrayBuffer();
      const r2Key = await uploadMotionCaptureVideoToR2({
        organizationId: allowed.organizationId,
        playerId,
        throwId,
        viewType: entry.viewType,
        fileName: entry.file.name,
        contentType: entry.file.type || 'video/quicktime',
        body: Buffer.from(arrayBuffer),
      });
      if (!r2Key) throw new Error(`Failed to upload ${entry.file.name}.`);
      await addMotionCaptureVideo({
        throwId,
        viewType: entry.viewType,
        fileName: entry.file.name,
        contentType: entry.file.type || 'video/quicktime',
        sizeBytes: entry.file.size,
        r2Key,
      });
    }
    const currentThrowsHand = String(allowed.player.throwsHand ?? '').trim().toUpperCase();
    if (updateDefaultHandedness || !currentThrowsHand) {
      await updatePlayerThrowsHand({ organizationId: allowed.organizationId, playerId, handedness });
    }
  } catch (error) {
    await deleteMotionCaptureThrow({ organizationId: allowed.organizationId, throwId });
    const message = error instanceof Error ? error.message : 'Upload failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, throwId });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session))) return NextResponse.json({ error: 'Programming access is required.' }, { status: 403 });

  const url = new URL(request.url);
  const throwId = Number(url.searchParams.get('throwId') ?? '0');
  if (!Number.isFinite(throwId) || throwId <= 0) return NextResponse.json({ error: 'Valid throwId is required.' }, { status: 400 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  const target = await getMotionCaptureThrowForAccess({ organizationId, throwId });
  if (!target) return NextResponse.json({ error: 'Motion capture throw was not found.' }, { status: 404 });
  const allowed = await canManagePlayer(session, target.playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const ok = await deleteMotionCaptureThrow({ organizationId, throwId });
  if (!ok) return NextResponse.json({ error: 'Motion capture throw was not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canUseProgrammingData(session))) return NextResponse.json({ error: 'Programming access is required.' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const throwId = Number(body.throwId ?? 0);
  if (!Number.isFinite(throwId) || throwId <= 0) return NextResponse.json({ error: 'Valid throwId is required.' }, { status: 400 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  const target = await getMotionCaptureThrowForAccess({ organizationId, throwId });
  if (!target) return NextResponse.json({ error: 'Motion capture throw was not found.' }, { status: 404 });
  const allowed = await canManagePlayer(session, target.playerId);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const ok = await updateMotionCaptureAnalysis({
    organizationId,
    throwId,
    analysisStatus: String(body.analysisStatus ?? 'analyzed'),
    analysisMessage: typeof body.analysisMessage === 'string' ? body.analysisMessage : null,
    eventsJson: Object.hasOwn(body, 'eventsJson') ? (body.eventsJson && typeof body.eventsJson === 'object' ? (body.eventsJson as Record<string, unknown>) : null) : undefined,
    metricsJson: Object.hasOwn(body, 'metricsJson') ? (body.metricsJson && typeof body.metricsJson === 'object' ? (body.metricsJson as Record<string, unknown>) : null) : undefined,
    graphJson: Object.hasOwn(body, 'graphJson') ? (body.graphJson && typeof body.graphJson === 'object' ? (body.graphJson as Record<string, unknown>) : null) : undefined,
    calibrationJson: body.calibrationJson && typeof body.calibrationJson === 'object' ? (body.calibrationJson as Record<string, unknown>) : undefined,
  });
  if (!ok) return NextResponse.json({ error: 'Failed to save analysis.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

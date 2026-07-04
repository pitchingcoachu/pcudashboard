import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { deleteObjectFromR2, uploadPlayerMediaToR2 } from '../../../../lib/biomechanics-storage';
import { canManagePlayer } from '../../../../lib/portal-access';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import {
  createPlayerMedia,
  deletePlayerMedia,
  getPlayerByIdInOrganization,
  listPlayerMedia,
  updatePlayerMedia,
} from '../../../../lib/training-db';

const MAX_PLAYER_MEDIA_BYTES = 350 * 1024 * 1024;

function inferMediaContentType(fileName: string): string {
  const ext = String(fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime',
    webm: 'video/webm', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    '3gp': 'video/3gpp', '3g2': 'video/3gpp2',
  };
  return map[ext] ?? 'application/octet-stream';
}

async function requireManagedPlayer(playerId: number) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if (session.role === 'player') return { ok: false as const, status: 403, error: 'Forbidden' };
  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return { ok: false as const, status: 403, error: 'Programming data is not available for this school.' };
  if (!Number.isFinite(playerId) || playerId <= 0) return { ok: false as const, status: 400, error: 'Valid playerId is required.' };
  const allowed = await canManagePlayer(
    session as { role?: 'admin' | 'coach' | 'player'; organizationId?: number; userId?: number; playerId?: number | null },
    playerId
  );
  if (!allowed) return { ok: false as const, status: 403, error: 'Forbidden' };
  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return { ok: false as const, status: 404, error: 'Player not found.' };
  return { ok: true as const, session, organizationId, playerId: player.id };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const allowed = await requireManagedPlayer(playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const rawType = url.searchParams.get('mediaType');
  const mediaType = rawType === 'photo' || rawType === 'video' ? rawType : undefined;
  const media = await listPlayerMedia({ organizationId: allowed.organizationId, playerId: allowed.playerId, mediaType });
  return NextResponse.json({ media });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const playerId = Number(form.get('playerId') ?? '0');
  const allowed = await requireManagedPlayer(playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const file = form.get('file');
  if (!(file instanceof File) || file.size <= 0) {
    return NextResponse.json({ error: 'Choose a photo or video file.' }, { status: 400 });
  }
  if (file.size > MAX_PLAYER_MEDIA_BYTES) {
    return NextResponse.json({ error: 'Media file is too large. Limit is 350 MB.' }, { status: 400 });
  }
  const rawContentType = String(file.type || '').trim();
  const contentType = rawContentType || inferMediaContentType(file.name);
  const mediaType = contentType.startsWith('image/') ? 'photo' : contentType.startsWith('video/') ? 'video' : null;
  if (!mediaType) return NextResponse.json({ error: 'Only photo and video uploads are supported.' }, { status: 400 });

  const body = Buffer.from(await file.arrayBuffer());
  let r2Key: string | null = null;
  let storageError = '';
  try {
    r2Key = await uploadPlayerMediaToR2({
      organizationId: allowed.organizationId,
      playerId: allowed.playerId,
      fileName: file.name,
      contentType,
      body,
    });
  } catch (err) {
    storageError = err instanceof Error ? err.message : String(err);
  }
  if (!r2Key) return NextResponse.json({ error: `Storage failed: ${storageError || 'uploadPlayerMediaToR2 returned null'}` }, { status: 500 });

  const created = await createPlayerMedia({
    organizationId: allowed.organizationId,
    playerId: allowed.playerId,
    mediaType,
    title: String(form.get('title') ?? '').trim() || file.name,
    category: String(form.get('category') ?? '').trim() || 'General',
    fileName: file.name,
    contentType,
    sizeBytes: file.size,
    r2Key,
    sourceType: String(form.get('sourceType') ?? '').trim() || undefined,
    sourceLabel: String(form.get('sourceLabel') ?? '').trim() || undefined,
    createdByUserId: allowed.session.userId ?? 0,
  });
  if (!created.ok) return NextResponse.json({ error: `DB error: ${created.error}` }, { status: 400 });
  const media = await listPlayerMedia({ organizationId: allowed.organizationId, playerId: allowed.playerId });
  return NextResponse.json({ ok: true, media });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const mediaId = Number(url.searchParams.get('mediaId') ?? '0');
  const allowed = await requireManagedPlayer(playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const deleted = await deletePlayerMedia({ organizationId: allowed.organizationId, mediaId });
  if (!deleted.ok) return NextResponse.json({ error: deleted.error }, { status: 404 });
  if (deleted.r2Key) await deleteObjectFromR2(deleted.r2Key);
  const media = await listPlayerMedia({ organizationId: allowed.organizationId, playerId: allowed.playerId });
  return NextResponse.json({ ok: true, media });
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? '0');
  const allowed = await requireManagedPlayer(playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const mediaId = Number(body.mediaId ?? 0);
  const updated = await updatePlayerMedia({
    organizationId: allowed.organizationId,
    mediaId,
    title: String(body.title ?? ''),
    category: String(body.category ?? ''),
  });
  if (!updated.ok) return NextResponse.json({ error: updated.error }, { status: 400 });
  const media = await listPlayerMedia({ organizationId: allowed.organizationId, playerId: allowed.playerId });
  return NextResponse.json({ ok: true, media });
}

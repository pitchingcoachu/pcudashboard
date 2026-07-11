import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { deleteObjectFromR2, getR2Bucket, getR2Client, isR2Configured, uploadPlayerMediaToR2 } from '../../../../lib/biomechanics-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand } from '@aws-sdk/client-s3';
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
    pdf: 'application/pdf',
  };
  return map[ext] ?? 'application/octet-stream';
}

function inferMediaType(contentType: string): 'photo' | 'video' | 'pdf' | null {
  const normalized = String(contentType ?? '').toLowerCase();
  if (normalized.startsWith('image/')) return 'photo';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized === 'application/pdf') return 'pdf';
  return null;
}

function buildR2Key(organizationId: number, playerId: number, fileName: string, contentType: string): string {
  const safeName = String(fileName ?? 'media').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const kind = inferMediaType(contentType) ?? 'file';
  return `player-media/org-${organizationId}/player-${playerId}/${kind}-${Date.now()}-${safeName}`;
}

function sanitizeBreakdownAnnotations(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .slice(0, 500)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      id: String(entry.id ?? `media-${Date.now()}`),
      tool: String(entry.tool ?? ''),
      color: String(entry.color ?? '#facc15'),
      width: Math.max(1, Math.min(30, Number(entry.width ?? 4) || 4)),
      points: Array.isArray(entry.points)
        ? entry.points
            .slice(0, 2000)
            .filter((point): point is Record<string, unknown> => Boolean(point) && typeof point === 'object' && !Array.isArray(point))
            .map((point) => ({
              x: Math.max(0, Math.min(1, Number(point.x ?? 0) || 0)),
              y: Math.max(0, Math.min(1, Number(point.y ?? 0) || 0)),
            }))
        : [],
      ...(typeof entry.text === 'string' ? { text: entry.text.slice(0, 300) } : {}),
      ...(entry.angleMode === 'acute' || entry.angleMode === 'obtuse' ? { angleMode: entry.angleMode } : {}),
    }))
    .filter((entry) => entry.tool && entry.points.length > 0);
}

async function requireManagedPlayer(playerId: number) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const organizationId = Number(session.organizationId ?? 0);
  if (organizationId <= 0) return { ok: false as const, status: 403, error: 'No organization found for session.' };
  if (!Number.isFinite(playerId) || playerId <= 0) return { ok: false as const, status: 400, error: 'Valid playerId is required.' };
  const player = await getPlayerByIdInOrganization({ organizationId, playerId });
  if (!player) return { ok: false as const, status: 404, error: 'Player not found.' };
  if (session.role === 'player' && player.id !== (session.playerId ?? -1)) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }
  return { ok: true as const, session, organizationId, playerId: player.id };
}

// ── GET: list media ──────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const url = new URL(request.url);

  // Presigned URL request: ?presign=1&fileName=...&contentType=...&playerId=...
  if (url.searchParams.get('presign') === '1') {
    const playerId = Number(url.searchParams.get('playerId') ?? '0');
    const allowed = await requireManagedPlayer(playerId);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

    const fileName = String(url.searchParams.get('fileName') ?? '').trim();
    const rawContentType = String(url.searchParams.get('contentType') ?? '').trim();
    const contentType = rawContentType || inferMediaContentType(fileName);

    if (!isR2Configured()) {
      // Signal to client to fall back to direct upload
      return NextResponse.json({ presign: false });
    }

    const r2Key = buildR2Key(allowed.organizationId, allowed.playerId, fileName, contentType);
    const client = getR2Client()!;
    const bucket = getR2Bucket();
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: r2Key, ContentType: contentType }),
      { expiresIn: 3600 }
    );
    return NextResponse.json({ presign: true, uploadUrl, r2Key, contentType });
  }

  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  const allowed = await requireManagedPlayer(playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const rawType = url.searchParams.get('mediaType');
  const mediaType = rawType === 'photo' || rawType === 'video' || rawType === 'pdf' ? rawType : undefined;
  const media = await listPlayerMedia({ organizationId: allowed.organizationId, playerId: allowed.playerId, mediaType });
  return NextResponse.json({ media });
}

// ── POST: save metadata after presigned upload, OR direct upload in local dev ─
export async function POST(request: Request) {
  const contentTypeHeader = request.headers.get('content-type') ?? '';

  // JSON body = presigned upload already done, just save metadata
  if (contentTypeHeader.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const playerId = Number(body.playerId ?? '0');
    const allowed = await requireManagedPlayer(playerId);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

    const r2Key = String(body.r2Key ?? '').trim();
    const fileName = String(body.fileName ?? '').trim();
    const rawContentType = String(body.contentType ?? '').trim();
    const contentType = rawContentType || inferMediaContentType(fileName);
    const mediaType = inferMediaType(contentType);
    if (!mediaType) return NextResponse.json({ error: 'Only photo, video, and PDF uploads are supported.' }, { status: 400 });
    if (!r2Key) return NextResponse.json({ error: 'r2Key is required.' }, { status: 400 });

    const created = await createPlayerMedia({
      organizationId: allowed.organizationId,
      playerId: allowed.playerId,
      mediaType,
      title: String(body.title ?? '').trim() || fileName,
      category: String(body.category ?? '').trim() || 'General',
      fileName,
      contentType,
      sizeBytes: Number(body.sizeBytes ?? 0) || 0,
      r2Key,
      sourceType: String(body.sourceType ?? '').trim() || undefined,
      sourceLabel: String(body.sourceLabel ?? '').trim() || undefined,
      createdByUserId: allowed.session.userId ?? 0,
    });
    if (!created.ok) return NextResponse.json({ error: `DB error: ${created.error}` }, { status: 400 });
    const media = await listPlayerMedia({ organizationId: allowed.organizationId, playerId: allowed.playerId });
    return NextResponse.json({ ok: true, media });
  }

  // FormData = direct upload (local dev fallback, no R2)
  const form = await request.formData();
  const playerId = Number(form.get('playerId') ?? '0');
  const allowed = await requireManagedPlayer(playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const file = form.get('file');
  if (!(file instanceof File) || file.size <= 0) {
    return NextResponse.json({ error: 'Choose a photo, video, or PDF file.' }, { status: 400 });
  }
  if (file.size > MAX_PLAYER_MEDIA_BYTES) {
    return NextResponse.json({ error: 'Media file is too large. Limit is 350 MB.' }, { status: 400 });
  }
  const rawContentType = String(file.type || '').trim();
  const contentType = rawContentType || inferMediaContentType(file.name);
  const mediaType = inferMediaType(contentType);
  if (!mediaType) return NextResponse.json({ error: 'Only photo, video, and PDF uploads are supported.' }, { status: 400 });

  const fileBody = Buffer.from(await file.arrayBuffer());
  let r2Key: string | null = null;
  let storageError = '';
  try {
    r2Key = await uploadPlayerMediaToR2({
      organizationId: allowed.organizationId,
      playerId: allowed.playerId,
      fileName: file.name,
      contentType,
      body: fileBody,
    });
  } catch (err) {
    storageError = err instanceof Error ? err.message : String(err);
  }
  if (!r2Key) return NextResponse.json({ error: `Storage failed: ${storageError || 'unknown'}` }, { status: 500 });

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

// ── DELETE ───────────────────────────────────────────────────────────────────
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

// ── PATCH ────────────────────────────────────────────────────────────────────
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const playerId = Number(body.playerId ?? '0');
  const allowed = await requireManagedPlayer(playerId);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const mediaId = Number(body.mediaId ?? 0);
  const breakdownAnnotations = Object.prototype.hasOwnProperty.call(body, 'breakdownAnnotations')
    ? sanitizeBreakdownAnnotations(body.breakdownAnnotations)
    : undefined;
  if (breakdownAnnotations === null) return NextResponse.json({ error: 'Invalid breakdown annotations.' }, { status: 400 });
  const updated = await updatePlayerMedia({
    organizationId: allowed.organizationId,
    mediaId,
    ...(typeof body.title === 'string' ? { title: body.title } : {}),
    ...(typeof body.category === 'string' ? { category: body.category } : {}),
    ...(breakdownAnnotations !== undefined ? { breakdownAnnotations } : {}),
  });
  if (!updated.ok) return NextResponse.json({ error: updated.error }, { status: 400 });
  const media = await listPlayerMedia({ organizationId: allowed.organizationId, playerId: allowed.playerId });
  return NextResponse.json({ ok: true, media });
}

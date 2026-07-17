// Client-side helper: uploads a file to player media, using R2 presigned URL
// when available (production) or direct POST fallback (local dev).
const MAX_PLAYER_MEDIA_BYTES = 350 * 1024 * 1024;

export async function uploadPlayerMediaFile(args: {
  playerId: number;
  file: File;
  title: string;
  category: string;
  sourceType?: string;
  sourceLabel?: string;
}): Promise<{ ok: true; media: unknown[]; categories?: string[]; createdMedia?: unknown } | { ok: false; error: string }> {
  const { playerId, file, title, category, sourceType, sourceLabel } = args;
  if (file.size > MAX_PLAYER_MEDIA_BYTES) {
    return { ok: false, error: 'Media file is too large. Limit is 350 MB.' };
  }

  const rawContentType = file.type.trim();
  const contentType = rawContentType || inferContentType(file.name);

  // Ask server if R2 presigned upload is available
  const presignParams = new URLSearchParams({
    presign: '1',
    playerId: String(playerId),
    fileName: file.name,
    contentType,
    sizeBytes: String(file.size),
  });
  const presignRes = await fetch(`/api/player/media?${presignParams.toString()}`);
  if (!presignRes.ok) {
    const body = await presignRes.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: body.error ?? 'Failed to get upload URL.' };
  }
  const presignData = await presignRes.json() as { presign: boolean; uploadUrl?: string; r2Key?: string; contentType?: string };

  if (presignData.presign && presignData.uploadUrl && presignData.r2Key) {
    // Upload directly to R2 — bypasses Vercel's 4.5MB body limit
    const putRes = await fetch(presignData.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': presignData.contentType ?? contentType },
      body: file,
    });
    if (!putRes.ok) {
      return { ok: false, error: `Storage upload failed (${putRes.status}).` };
    }

    // Save metadata to DB
    const metaRes = await fetch('/api/player/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId,
        r2Key: presignData.r2Key,
        fileName: file.name,
        contentType: presignData.contentType ?? contentType,
        sizeBytes: file.size,
        title,
        category,
        sourceType: sourceType ?? '',
        sourceLabel: sourceLabel ?? '',
      }),
    });
    const metaBody = await metaRes.json().catch(() => ({})) as { ok?: boolean; media?: unknown[]; categories?: string[]; createdMedia?: unknown; error?: string };
    if (!metaRes.ok) return { ok: false, error: metaBody.error ?? 'Failed to save media record.' };
    return {
      ok: true,
      media: Array.isArray(metaBody.media) ? metaBody.media : [],
      categories: Array.isArray(metaBody.categories) ? metaBody.categories : undefined,
      createdMedia: metaBody.createdMedia,
    };
  }

  // Fallback: direct FormData POST (local dev, no R2)
  const form = new FormData();
  form.set('playerId', String(playerId));
  form.set('file', file);
  form.set('title', title);
  form.set('category', category);
  if (sourceType) form.set('sourceType', sourceType);
  if (sourceLabel) form.set('sourceLabel', sourceLabel);
  const res = await fetch('/api/player/media', { method: 'POST', body: form });
  const resBody = await res.json().catch(() => ({})) as { ok?: boolean; media?: unknown[]; categories?: string[]; createdMedia?: unknown; error?: string };
  if (!res.ok) return { ok: false, error: resBody.error ?? `Failed to upload ${file.name}.` };
  return {
    ok: true,
    media: Array.isArray(resBody.media) ? resBody.media : [],
    categories: Array.isArray(resBody.categories) ? resBody.categories : undefined,
    createdMedia: resBody.createdMedia,
  };
}

function inferContentType(fileName: string): string {
  const ext = String(fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime',
    webm: 'video/webm', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    pdf: 'application/pdf',
  };
  return map[ext] ?? 'application/octet-stream';
}

const MAX_EXERCISE_VIDEO_BYTES = 350 * 1024 * 1024;

export async function uploadExerciseVideo(file: File): Promise<string> {
  if (file.size <= 0) throw new Error('Choose a video file.');
  if (file.size > MAX_EXERCISE_VIDEO_BYTES) throw new Error('Video must be 350 MB or smaller.');
  if (file.type && !file.type.startsWith('video/')) throw new Error('Choose a video file.');

  const params = new URLSearchParams({
    fileName: file.name,
    contentType: file.type || 'video/mp4',
    sizeBytes: String(file.size),
  });
  const presignResponse = await fetch(`/api/admin/exercises/media?${params.toString()}`, { headers: { Accept: 'application/json' } });
  const presign = (await presignResponse.json().catch(() => ({}))) as { uploadUrl?: string; r2Key?: string; contentType?: string; error?: string };
  if (!presignResponse.ok || !presign.uploadUrl || !presign.r2Key) throw new Error(presign.error || 'Could not prepare the video upload.');

  try {
    const uploadResponse = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': presign.contentType || file.type || 'video/mp4' },
      body: file,
    });
    if (!uploadResponse.ok) throw new Error(`Video upload failed (${uploadResponse.status}).`);
  } catch (uploadError) {
    // Browsers on localhost may be outside the production R2 CORS allowlist.
    // Relaying through the local Next server keeps development uploads usable.
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') throw uploadError;
    const fallback = new FormData();
    fallback.set('file', file);
    const fallbackResponse = await fetch('/api/admin/exercises/media', { method: 'POST', body: fallback, headers: { Accept: 'application/json' } });
    const fallbackBody = (await fallbackResponse.json().catch(() => ({}))) as { videoUrl?: string; error?: string };
    if (!fallbackResponse.ok || !fallbackBody.videoUrl) throw new Error(fallbackBody.error || 'Video upload failed.');
    return fallbackBody.videoUrl;
  }

  const finalizeResponse = await fetch('/api/admin/exercises/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ r2Key: presign.r2Key, sizeBytes: file.size }),
  });
  const finalized = (await finalizeResponse.json().catch(() => ({}))) as { videoUrl?: string; error?: string };
  if (!finalizeResponse.ok || !finalized.videoUrl) throw new Error(finalized.error || 'Could not finish the video upload.');
  return finalized.videoUrl;
}

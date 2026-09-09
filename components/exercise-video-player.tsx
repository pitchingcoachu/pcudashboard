'use client';

import { useEffect, useMemo, useState } from 'react';
import { resolveExerciseVideoUrl, shouldResolveExerciseVideoUrl } from '../lib/exercise-video';
import styles from './exercise-video-player.module.css';

export default function ExerciseVideoPlayer({ url, title }: { url: string; title: string }) {
  const [resolution, setResolution] = useState<{ sourceUrl: string; resolvedUrl: string | null }>({
    sourceUrl: '',
    resolvedUrl: null,
  });
  const needsResolution = shouldResolveExerciseVideoUrl(url);
  const hasResolution = resolution.sourceUrl === url;
  const resolvedUrl = hasResolution && resolution.resolvedUrl ? resolution.resolvedUrl : url;
  const resolving = needsResolution && !hasResolution;
  const video = useMemo(() => resolveExerciseVideoUrl(resolvedUrl), [resolvedUrl]);
  const stageClass = `${styles.stage} ${styles[video.layout]}`;

  useEffect(() => {
    if (!shouldResolveExerciseVideoUrl(url)) return;

    const controller = new AbortController();
    void fetch(`/api/exercise-video/resolve?url=${encodeURIComponent(url)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { url?: string };
        setResolution({ sourceUrl: url, resolvedUrl: response.ok && payload.url ? payload.url : null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolution({ sourceUrl: url, resolvedUrl: null });
      });
    return () => controller.abort();
  }, [url]);

  return (
    <div className={styles.player}>
      <div className={stageClass}>
        {resolving ? (
          <div className={styles.fallback}>
            <strong>Preparing video…</strong>
            <span>Resolving the shared link to its original post.</span>
          </div>
        ) : video.playback === 'iframe' && video.playbackUrl ? (
          <iframe
            className={styles.media}
            src={video.playbackUrl}
            title={`${title} · ${video.providerLabel}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowFullScreen
            loading="eager"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : video.playback === 'video' && video.playbackUrl ? (
          <video className={styles.media} src={video.playbackUrl} controls playsInline preload="metadata">
            Your browser cannot play this video.
          </video>
        ) : (
          <div className={styles.fallback}>
            <strong>Open this video on {video.providerLabel}</strong>
            <span>This provider does not offer a reliable in-page player for this link. The original video is still available below.</span>
          </div>
        )}
      </div>
      <div className={styles.bar}>
        <span className={styles.provider}>{video.providerLabel}</span>
        <a className={styles.external} href={url} target="_blank" rel="noopener noreferrer">
          Open on {video.providerLabel} ↗
        </a>
      </div>
    </div>
  );
}

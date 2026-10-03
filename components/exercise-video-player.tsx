'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveExerciseVideoUrl, shouldResolveExerciseVideoUrl } from '../lib/exercise-video';
import styles from './exercise-video-player.module.css';

function formatPlaybackTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function ExerciseVideoPlayer({ url, title }: { url: string; title: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [resolution, setResolution] = useState<{ sourceUrl: string; resolvedUrl: string | null }>({
    sourceUrl: '',
    resolvedUrl: null,
  });
  const [detectedLayout, setDetectedLayout] = useState<{ sourceUrl: string; layout: 'landscape' | 'portrait' } | null>(null);
  const [playback, setPlayback] = useState({ playing: false, currentTime: 0, duration: 0, muted: false });
  const needsResolution = shouldResolveExerciseVideoUrl(url);
  const hasResolution = resolution.sourceUrl === url;
  const resolvedUrl = hasResolution && resolution.resolvedUrl ? resolution.resolvedUrl : url;
  const resolving = needsResolution && !hasResolution;
  const video = useMemo(() => resolveExerciseVideoUrl(resolvedUrl), [resolvedUrl]);
  const directLayout = video.playback === 'video' && video.playbackUrl && detectedLayout?.sourceUrl === video.playbackUrl
    ? detectedLayout.layout
    : video.layout;
  const stageClass = `${styles.stage} ${styles[directLayout]}`;

  const togglePlayback = async () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) await element.play().catch(() => {});
    else element.pause();
  };

  const toggleFullscreen = async () => {
    const stage = stageRef.current;
    const element = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    if (stage?.requestFullscreen) await stage.requestFullscreen().catch(() => {});
    else element?.webkitEnterFullscreen?.();
  };

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
      <div ref={stageRef} className={stageClass}>
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
          <video
            ref={videoRef}
            className={styles.media}
            src={video.playbackUrl}
            playsInline
            preload="metadata"
            aria-label={`${title} video`}
            tabIndex={0}
            onClick={() => void togglePlayback()}
            onKeyDown={(event) => {
              if (event.key !== ' ' && event.key !== 'Enter') return;
              event.preventDefault();
              void togglePlayback();
            }}
            onLoadStart={() => setPlayback({ playing: false, currentTime: 0, duration: 0, muted: false })}
            onLoadedMetadata={(event) => {
              const element = event.currentTarget;
              setPlayback((current) => ({
                ...current,
                duration: Number.isFinite(element.duration) ? element.duration : 0,
                muted: element.muted,
              }));
              if (!element.videoWidth || !element.videoHeight) return;
              setDetectedLayout({
                sourceUrl: video.playbackUrl!,
                layout: element.videoHeight > element.videoWidth ? 'portrait' : 'landscape',
              });
            }}
            onDurationChange={(event) => {
              const duration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
              setPlayback((current) => ({ ...current, duration }));
            }}
            onTimeUpdate={(event) => {
              const currentTime = event.currentTarget.currentTime;
              setPlayback((current) => ({ ...current, currentTime }));
            }}
            onPlay={() => setPlayback((current) => ({ ...current, playing: true }))}
            onPause={() => setPlayback((current) => ({ ...current, playing: false }))}
            onEnded={() => setPlayback((current) => ({ ...current, playing: false }))}
            onVolumeChange={(event) => {
              const muted = event.currentTarget.muted;
              setPlayback((current) => ({ ...current, muted }));
            }}
          >
            Your browser cannot play this video.
          </video>
        ) : (
          <div className={styles.fallback}>
            <strong>Open this video on {video.providerLabel}</strong>
            <span>This provider does not offer a reliable in-page player for this link. The original video is still available below.</span>
          </div>
        )}
        {video.playback === 'video' && video.playbackUrl ? (
          <div className={styles.controls} role="group" aria-label="Video controls">
            <button type="button" onClick={() => void togglePlayback()} aria-label={playback.playing ? 'Pause video' : 'Play video'} title={playback.playing ? 'Pause' : 'Play'}>
              <span aria-hidden="true">{playback.playing ? '❚❚' : '▶'}</span>
            </button>
            <input
              className={styles.seek}
              type="range"
              min="0"
              max={playback.duration || 0}
              step="0.1"
              value={Math.min(playback.currentTime, playback.duration || 0)}
              disabled={!playback.duration}
              aria-label="Video position"
              onChange={(event) => {
                const nextTime = Number(event.target.value);
                if (videoRef.current && Number.isFinite(nextTime)) videoRef.current.currentTime = nextTime;
                setPlayback((current) => ({ ...current, currentTime: nextTime }));
              }}
            />
            <span className={styles.time}>{formatPlaybackTime(playback.currentTime)} / {formatPlaybackTime(playback.duration)}</span>
            <button
              type="button"
              onClick={() => {
                if (!videoRef.current) return;
                videoRef.current.muted = !videoRef.current.muted;
              }}
              aria-label={playback.muted ? 'Unmute video' : 'Mute video'}
              title={playback.muted ? 'Unmute' : 'Mute'}
            >
              <span aria-hidden="true">{playback.muted ? 'MUTE' : 'SOUND'}</span>
            </button>
            <button type="button" onClick={() => void toggleFullscreen()} aria-label="View video fullscreen" title="Fullscreen">
              <span aria-hidden="true">⛶</span>
            </button>
          </div>
        ) : null}
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

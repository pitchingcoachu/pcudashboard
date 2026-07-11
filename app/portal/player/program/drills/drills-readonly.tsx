'use client';

import { useMemo, useState } from 'react';
import type { DrillSectionState, DrillsState } from '../../../../../lib/drills-program';
import { uploadPlayerMediaFile } from '../../../../../lib/upload-player-media';

type DrillVideo = {
  name: string;
  instructionVideoUrl: string;
};

function normalizeDrillName(value: string): string {
  return value.trim().toLowerCase();
}

function embedVideoUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    if (parsed.hostname.includes('youtube.com')) {
      const videoId = parsed.searchParams.get('v');
      if (videoId) return `https://www.youtube.com/embed/${videoId}`;
      const shortMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/i);
      if (shortMatch?.[1]) return `https://www.youtube.com/embed/${shortMatch[1]}`;
    }
    if (parsed.hostname.includes('youtu.be')) {
      const videoId = parsed.pathname.replace('/', '').trim();
      if (videoId) return `https://www.youtube.com/embed/${videoId}`;
    }
    if (parsed.hostname.includes('vimeo.com')) {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
    return raw;
  } catch {
    return raw;
  }
}

function CameraIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function DrillSection({
  title,
  state,
  drillVideoByName,
  onOpenVideo,
  onUploadDrillMedia,
  uploadingDrillName,
}: {
  title: string;
  state: DrillSectionState;
  drillVideoByName: Record<string, string>;
  onOpenVideo: (title: string, url: string) => void;
  onUploadDrillMedia: (drillName: string, files: File[]) => void;
  uploadingDrillName: string;
}) {
  const visibleRows = state.rows.slice(0, state.rowCount);
  const hasPlan = visibleRows.some((row) => Object.values(row).some((value) => String(value ?? '').trim()));
  const hasVideoLinks = visibleRows.some((row) => {
    const drillName = row.drill.trim();
    return drillName && Boolean(drillVideoByName[normalizeDrillName(drillName)]);
  });
  if (!hasPlan) {
    return (
      <section className="portal-panel portal-drills-section">
        <h3>{title}</h3>
        <p className="portal-muted-text" style={{ margin: 0, textAlign: 'center' }}>No plan selected.</p>
      </section>
    );
  }
  return (
    <section className="portal-panel portal-drills-section">
      <h3>{title}</h3>
      {hasVideoLinks ? <p className="portal-drills-video-hint">Click drill to watch video</p> : null}
      <div className="portal-table-wrap">
        <table className="portal-drills-table portal-drills-table-readonly">
          <colgroup>
            <col className="portal-drills-col-drill" />
            <col className="portal-drills-col-compact" />
            <col className="portal-drills-col-compact" />
            <col className="portal-drills-col-compact" />
            <col className="portal-drills-col-notes" />
          </colgroup>
          <thead>
            <tr>
              {['Drill', 'Sets', 'Reps', 'Weight', 'Notes'].map((label) => <th key={label}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => {
              const drillName = row.drill.trim();
              const videoUrl = drillName ? drillVideoByName[normalizeDrillName(drillName)] : '';
              const isUploading = drillName && uploadingDrillName === drillName;
              return (
                <tr key={`${title}-${index}`}>
                  <td>
                    <div className="portal-drill-player-action-cell">
                      <span className="portal-drill-player-name">
                        {drillName && videoUrl ? (
                          <button
                            type="button"
                            className="portal-drill-video-link"
                            onClick={() => onOpenVideo(drillName, videoUrl)}
                          >
                            {drillName}
                          </button>
                        ) : (
                          drillName || '—'
                        )}
                      </span>
                      {drillName ? (
                        <label
                          className={`btn btn-ghost portal-drill-upload-button${isUploading ? ' is-uploading' : ''}`}
                          title={isUploading ? `Uploading ${drillName}` : `Upload photo/video for ${drillName}`}
                          aria-label={isUploading ? `Uploading ${drillName}` : `Upload photo or video for ${drillName}`}
                        >
                          <CameraIcon />
                          <input
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            disabled={Boolean(isUploading)}
                            onChange={(event) => {
                              const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
                              onUploadDrillMedia(drillName, files);
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                      ) : null}
                    </div>
                  </td>
                  <td>{row.sets || '—'}</td>
                  <td>{row.reps || '—'}</td>
                  <td>{row.weight || '—'}</td>
                  <td>{row.notes || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function DrillsReadonly({
  state,
  drillVideos,
  playerId,
}: {
  state: DrillsState;
  drillVideos: DrillVideo[];
  playerId: number;
}) {
  const [videoPreview, setVideoPreview] = useState<{ title: string; url: string } | null>(null);
  const [mediaUploadMessage, setMediaUploadMessage] = useState('');
  const [uploadingDrillName, setUploadingDrillName] = useState('');
  const drillVideoByName = useMemo(() => {
    const next: Record<string, string> = {};
    drillVideos.forEach((video) => {
      const name = normalizeDrillName(video.name);
      const url = video.instructionVideoUrl.trim();
      if (name && url) next[name] = embedVideoUrl(url);
    });
    return next;
  }, [drillVideos]);

  const uploadDrillMedia = async (drillName: string, files: File[]) => {
    if (!files.length) return;
    if (!Number.isFinite(playerId) || playerId <= 0) {
      setMediaUploadMessage('Could not find this player for upload.');
      return;
    }
    setUploadingDrillName(drillName);
    setMediaUploadMessage('');
    try {
      for (const file of files) {
        const title = file.name.replace(/\.[^.]+$/, '') || drillName;
        const result = await uploadPlayerMediaFile({
          playerId,
          file,
          title,
          category: 'Drills',
          sourceType: 'drill',
          sourceLabel: drillName,
        });
        if (!result.ok) throw new Error(result.error);
      }
      setMediaUploadMessage(files.length > 1 ? `${files.length} files saved to Player Notes.` : 'Saved to Player Notes.');
    } catch (error) {
      setMediaUploadMessage(error instanceof Error ? error.message : 'Failed to upload media.');
    } finally {
      setUploadingDrillName('');
    }
  };

  return (
    <>
      <div className="portal-drills-sections">
        {mediaUploadMessage ? <p className="portal-drills-upload-message">{mediaUploadMessage}</p> : null}
        {state.notes.trim() ? (
          <section className="portal-drills-note-section">
            <strong>Player Note</strong>
            <p>{state.notes}</p>
          </section>
        ) : null}
        <DrillSection
          title="Pre-Throw Plyos and Drills"
          state={state.pre}
          drillVideoByName={drillVideoByName}
          onOpenVideo={(title, url) => setVideoPreview({ title, url })}
          onUploadDrillMedia={uploadDrillMedia}
          uploadingDrillName={uploadingDrillName}
        />
        <DrillSection
          title="Post-Throw Plyos and Drills"
          state={state.post}
          drillVideoByName={drillVideoByName}
          onOpenVideo={(title, url) => setVideoPreview({ title, url })}
          onUploadDrillMedia={uploadDrillMedia}
          uploadingDrillName={uploadingDrillName}
        />
      </div>
      {videoPreview && (
        <div className="portal-modal-backdrop" onClick={() => setVideoPreview(null)} role="presentation">
          <article
            className="portal-modal-card portal-drills-video-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${videoPreview.title} video`}
          >
            <div className="portal-modal-header">
              <h3>{videoPreview.title}</h3>
              <button type="button" className="btn btn-ghost" onClick={() => setVideoPreview(null)}>
                Close
              </button>
            </div>
            <div className="tutorial-video-frame-wrap">
              <iframe
                src={videoPreview.url}
                title={`${videoPreview.title} video`}
                className="tutorial-video-frame"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </article>
        </div>
      )}
    </>
  );
}

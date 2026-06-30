'use client';

import { useMemo, useState } from 'react';
import type { DrillSectionState, DrillsState } from '../../../../../lib/drills-program';

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

function DrillSection({
  title,
  state,
  drillVideoByName,
  onOpenVideo,
}: {
  title: string;
  state: DrillSectionState;
  drillVideoByName: Record<string, string>;
  onOpenVideo: (title: string, url: string) => void;
}) {
  const visibleRows = state.rows.slice(0, state.rowCount);
  const hasPlan = visibleRows.some((row) => Object.values(row).some((value) => String(value ?? '').trim()));
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
              return (
                <tr key={`${title}-${index}`}>
                  <td>
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

export default function DrillsReadonly({ state, drillVideos }: { state: DrillsState; drillVideos: DrillVideo[] }) {
  const [videoPreview, setVideoPreview] = useState<{ title: string; url: string } | null>(null);
  const drillVideoByName = useMemo(() => {
    const next: Record<string, string> = {};
    drillVideos.forEach((video) => {
      const name = normalizeDrillName(video.name);
      const url = video.instructionVideoUrl.trim();
      if (name && url) next[name] = embedVideoUrl(url);
    });
    return next;
  }, [drillVideos]);

  return (
    <>
      <div className="portal-drills-sections">
        <DrillSection
          title="Pre-Throw Plyos and Drills"
          state={state.pre}
          drillVideoByName={drillVideoByName}
          onOpenVideo={(title, url) => setVideoPreview({ title, url })}
        />
        <DrillSection
          title="Post-Throw Plyos and Drills"
          state={state.post}
          drillVideoByName={drillVideoByName}
          onOpenVideo={(title, url) => setVideoPreview({ title, url })}
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

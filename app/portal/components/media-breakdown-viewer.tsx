'use client';

import { useEffect, useRef, useState, useCallback, type PointerEvent as ReactPointerEvent } from 'react';

type BreakdownTool = 'line' | 'arrow' | 'circle' | 'pen' | 'text' | 'angle' | 'erase';
type BreakdownAnnotation = {
  id: string;
  tool: Exclude<BreakdownTool, 'erase'>;
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
  text?: string;
  angleMode?: 'acute' | 'obtuse';
};

type MediaBreakdownViewerProps = {
  title: string;
  url: string;
  mimeType: string;
  downloadName?: string;
  onClose: () => void;
  players?: Array<{ playerId: number; fullName: string }>;
};

type CompareVideo = {
  playerId: number;
  playerName: string;
  mediaId: number;
  title: string;
  url: string;
  mimeType: string;
};

type PlayerMediaItem = {
  id: number;
  title: string;
  contentType: string;
  mediaType: string;
  category: string;
  createdAt: string;
};

function measureAngle(points: Array<{ x: number; y: number }>, mode: 'acute' | 'obtuse' = 'acute'): number | null {
  if (points.length < 3) return null;
  const [a, b, c] = points;
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (mag <= 0) return null;
  const radians = Math.acos(Math.max(-1, Math.min(1, dot / mag)));
  const deg = (radians * 180) / Math.PI;
  const acute = deg > 90 ? 180 - deg : deg;
  return mode === 'obtuse' ? 180 - acute : acute;
}

function pointOnOverlay(event: ReactPointerEvent<SVGSVGElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
  };
}

function renderAnnotation(annotation: BreakdownAnnotation, key: string) {
  const pts = annotation.points;
  if (!pts.length) return null;
  const u = 1000;
  const sx = (v: number) => v * u;

  const labelStyle: React.CSSProperties = { paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.82)', strokeWidth: 6 };

  if (annotation.tool === 'text') {
    return (
      <text key={key} x={sx(pts[0].x)} y={sx(pts[0].y)} fill={annotation.color} fontSize={36} fontWeight={900} style={labelStyle}>
        {annotation.text}
      </text>
    );
  }

  if (annotation.tool === 'circle' && pts.length >= 2) {
    const x = sx(Math.min(pts[0].x, pts[1].x));
    const y = sx(Math.min(pts[0].y, pts[1].y));
    const w = sx(Math.abs(pts[1].x - pts[0].x));
    const h = sx(Math.abs(pts[1].y - pts[0].y));
    return <ellipse key={key} cx={x + w / 2} cy={y + h / 2} rx={Math.max(2, w / 2)} ry={Math.max(2, h / 2)} fill="none" stroke={annotation.color} strokeWidth={annotation.width} />;
  }

  if (annotation.tool === 'angle') {
    const angle = measureAngle(pts, annotation.angleMode ?? 'acute');
    const polyPoints = pts.map((p) => `${sx(p.x)},${sx(p.y)}`).join(' ');
    const vertex = pts[1] ?? pts[0];
    const dir1 = pts.length >= 2 ? { x: pts[0].x - vertex.x, y: pts[0].y - vertex.y } : { x: 0, y: -1 };
    const dir2 = pts.length >= 3 ? { x: pts[2].x - vertex.x, y: pts[2].y - vertex.y } : { x: 0, y: -1 };
    const mag1 = Math.hypot(dir1.x, dir1.y) || 1;
    const mag2 = Math.hypot(dir2.x, dir2.y) || 1;
    const norm1 = { x: dir1.x / mag1, y: dir1.y / mag1 };
    const norm2 = { x: dir2.x / mag2, y: dir2.y / mag2 };
    const bisect = { x: norm1.x + norm2.x, y: norm1.y + norm2.y };
    const bisectMag = Math.hypot(bisect.x, bisect.y) || 1;
    const labelOffset = 60;
    const labelX = sx(vertex.x) + (bisect.x / bisectMag) * labelOffset;
    const labelY = sx(vertex.y) + (bisect.y / bisectMag) * labelOffset;
    return (
      <g key={key}>
        <polyline points={polyPoints} fill="none" stroke={annotation.color} strokeWidth={annotation.width} strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, idx) => <circle key={`${key}-p-${idx}`} cx={sx(p.x)} cy={sx(p.y)} r={8} fill={annotation.color} stroke="rgba(0,0,0,0.78)" strokeWidth={2} />)}
        {angle !== null ? (
          <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle" fill={annotation.color} fontSize={38} fontWeight={900} style={labelStyle}>
            {`${angle.toFixed(1)}°`}
          </text>
        ) : null}
      </g>
    );
  }

  const polyPoints = pts.map((p) => `${sx(p.x)},${sx(p.y)}`).join(' ');
  if (annotation.tool === 'arrow' && pts.length >= 2) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const size = 34;
    const bx = sx(b.x);
    const by = sx(b.y);
    return (
      <g key={key}>
        <polyline points={polyPoints} fill="none" stroke={annotation.color} strokeWidth={annotation.width} strokeLinecap="round" strokeLinejoin="round" />
        <polygon
          points={`${bx},${by} ${bx - size * Math.cos(angle - Math.PI / 6)},${by - size * Math.sin(angle - Math.PI / 6)} ${bx - size * Math.cos(angle + Math.PI / 6)},${by - size * Math.sin(angle + Math.PI / 6)}`}
          fill={annotation.color}
        />
      </g>
    );
  }

  return <polyline key={key} points={polyPoints} fill="none" stroke={annotation.color} strokeWidth={annotation.width} strokeLinecap="round" strokeLinejoin="round" />;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${ms}`;
}

// ── Single video panel (video + overlay + controls) ──────────────────────────

type VideoPanelProps = {
  url: string;
  title: string;
  tool: BreakdownTool;
  drawMode: boolean;
  color: string;
  width: number;
  angleMode: 'acute' | 'obtuse';
  onActivate?: () => void;
  isActive?: boolean;
  syncRef?: React.MutableRefObject<HTMLVideoElement | null>;
  synced?: boolean;
  compact?: boolean;
};

function VideoPanel({ url, title, tool, drawMode, color, width, angleMode, onActivate, isActive, syncRef, synced, compact }: VideoPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const scrubberRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);

  const [annotations, setAnnotations] = useState<BreakdownAnnotation[]>([]);
  const [active, setActive] = useState<BreakdownAnnotation | null>(null);
  const [anglePending, setAnglePending] = useState<Array<{ x: number; y: number }>>([]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrentTime(video.currentTime);
      if (synced && syncRef?.current && syncRef.current !== video) {
        const diff = Math.abs(syncRef.current.currentTime - video.currentTime);
        if (diff > 0.08) syncRef.current.currentTime = video.currentTime;
      }
    };
    const onDuration = () => setDuration(video.duration || 0);
    const onPlay = () => {
      setPlaying(true);
      if (synced && syncRef?.current && syncRef.current !== video) {
        syncRef.current.play().catch(() => {});
      }
    };
    const onPause = () => {
      setPlaying(false);
      if (synced && syncRef?.current && syncRef.current !== video) {
        syncRef.current.pause();
      }
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onDuration);
    video.addEventListener('durationchange', onDuration);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onDuration);
      video.removeEventListener('durationchange', onDuration);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [synced, syncRef]);

  // Expose this video's ref to the sync system
  useEffect(() => {
    if (isActive && syncRef) syncRef.current = videoRef.current;
  }, [isActive, syncRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate]);

  function scrubToFraction(fraction: number) {
    const video = videoRef.current;
    if (!video || !duration) return;
    const t = Math.max(0, Math.min(duration, fraction * duration));
    video.currentTime = t;
    setCurrentTime(t);
    if (synced && syncRef?.current && syncRef.current !== video) {
      syncRef.current.currentTime = t;
    }
  }

  function getScrubFraction(clientX: number): number {
    const bar = scrubberRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function onScrubStart(event: React.PointerEvent<HTMLDivElement>) {
    scrubbing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    videoRef.current?.pause();
    if (synced && syncRef?.current) syncRef.current.pause();
    scrubToFraction(getScrubFraction(event.clientX));
  }

  function onScrubMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!scrubbing.current) return;
    scrubToFraction(getScrubFraction(event.clientX));
  }

  function onScrubEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function stepFrame(direction: 1 | -1) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const t = Math.max(0, Math.min(duration, video.currentTime + direction / 30));
    video.currentTime = t;
    if (synced && syncRef?.current) {
      syncRef.current.pause();
      syncRef.current.currentTime = t;
    }
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch((err: unknown) => {
        if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
      });
    } else {
      video.pause();
    }
  }

  const distanceToAnnotation = (ann: BreakdownAnnotation, point: { x: number; y: number }) => {
    if (!ann.points.length) return 999;
    return Math.min(...ann.points.map((p) => Math.hypot(p.x - point.x, p.y - point.y)));
  };

  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawMode) return;
    onActivate?.();
    event.preventDefault();
    const point = pointOnOverlay(event);

    if (tool === 'erase') {
      setAnnotations((items) => {
        const nearest = items.map((item) => ({ item, d: distanceToAnnotation(item, point) })).sort((a, b) => a.d - b.d)[0];
        return nearest && nearest.d <= 0.08 ? items.filter((item) => item.id !== nearest.item.id) : items;
      });
      return;
    }

    if (tool === 'text') {
      const text = window.prompt('Text label');
      if (!text?.trim()) return;
      setAnnotations((items) => [...items, { id: `media-${Date.now()}`, tool: 'text', color, width, points: [point], text: text.trim() }]);
      return;
    }

    if (tool === 'angle') {
      const next = [...anglePending, point];
      if (next.length === 3) {
        setAnnotations((items) => [...items, { id: `media-${Date.now()}`, tool: 'angle', color, width, points: next, angleMode }]);
        setAnglePending([]);
      } else {
        setAnglePending(next);
      }
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setActive({ id: `media-${Date.now()}-${Math.random().toString(16).slice(2)}`, tool, color, width, points: [point, point] });
  };

  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!active) return;
    event.preventDefault();
    const point = pointOnOverlay(event);
    setActive((current) => {
      if (!current) return current;
      if (current.tool === 'pen') return { ...current, points: [...current.points, point] };
      return { ...current, points: [current.points[0], point] };
    });
  };

  const finish = (event?: ReactPointerEvent<SVGSVGElement>) => {
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!active) return;
    setAnnotations((items) => [...items, active]);
    setActive(null);
  };

  const anglePreview: BreakdownAnnotation | null = anglePending.length > 0
    ? { id: 'angle-preview', tool: 'angle', color, width, points: anglePending, angleMode }
    : null;

  const allAnnotations = [...annotations, ...(active ? [active] : []), ...(anglePreview ? [anglePreview] : [])];
  const progress = duration > 0 ? currentTime / duration : 0;
  const maxH = compact ? '38vh' : '62vh';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{title}</div>
      {/* Video + overlay */}
      <div
        style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#000', cursor: drawMode ? 'crosshair' : 'default' }}
        onClick={onActivate}
      >
        <video
          ref={videoRef}
          src={url}
          playsInline
          preload="auto"
          loop={loop}
          style={{ width: '100%', maxHeight: maxH, display: 'block' }}
          onError={(e) => {
            const v = e.currentTarget;
            console.error('[MediaBreakdownViewer] video error:', v.error?.code, v.error?.message, 'src:', v.src);
          }}
        />
        <svg
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            pointerEvents: drawMode ? 'auto' : 'none',
            cursor: drawMode ? 'crosshair' : 'default',
            touchAction: 'none',
          }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
        >
          {allAnnotations.map((ann) => renderAnnotation(ann, ann.id))}
        </svg>
        {/* Undo/Clear mini controls */}
        <div style={{ position: 'absolute', bottom: 6, right: 6, display: 'flex', gap: 4 }}>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 7px', minHeight: 0, background: 'rgba(2,6,23,0.8)' }} onClick={() => { setAnnotations((items) => items.slice(0, -1)); setAnglePending([]); }} disabled={!annotations.length}>Undo</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 7px', minHeight: 0, background: 'rgba(2,6,23,0.8)' }} onClick={() => { setAnnotations([]); setAnglePending([]); }} disabled={!annotations.length}>Clear</button>
        </div>
      </div>

      {/* Scrubber */}
      <div
        ref={scrubberRef}
        style={{ height: 24, borderRadius: 6, background: 'rgba(255,255,255,0.1)', cursor: 'pointer', position: 'relative', userSelect: 'none' }}
        onPointerDown={onScrubStart}
        onPointerMove={onScrubMove}
        onPointerUp={onScrubEnd}
        onPointerCancel={onScrubEnd}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: 'rgba(239,68,68,0.85)', borderRadius: 6, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '50%', transform: 'translate(-50%,-50%)', left: `${progress * 100}%`, width: 16, height: 16, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.5)', pointerEvents: 'none' }} />
        <span style={{ position: 'absolute', left: 5, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontWeight: 700, color: '#fff', pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{formatTime(currentTime)}</span>
        <span style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontWeight: 700, color: '#fff', pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{formatTime(duration)}</span>
      </div>

      {/* Playback controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 7px', minHeight: 0 }} onClick={() => stepFrame(-1)}>‹ Frame</button>
        <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: '3px 12px', minHeight: 0 }} onClick={togglePlay}>{playing ? '⏸' : '▶'}</button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 7px', minHeight: 0 }} onClick={() => stepFrame(1)}>Frame ›</button>
        <button type="button" className={loop ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: 11, padding: '2px 7px', minHeight: 0 }} onClick={() => setLoop((v) => !v)}>Loop</button>
        <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
          {[0.1, 0.25, 0.5, 1, 2].map((rate) => (
            <button key={rate} type="button" className={playbackRate === rate ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: 10, padding: '2px 5px', minHeight: 0 }} onClick={() => setPlaybackRate(rate)}>
              {rate === 1 ? '1×' : `${rate}×`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Compare picker ────────────────────────────────────────────────────────────

type ComparePickerProps = {
  players: Array<{ playerId: number; fullName: string }>;
  onPick: (video: CompareVideo) => void;
  onCancel: () => void;
};

function ComparePicker({ players, onPick, onCancel }: ComparePickerProps) {
  const [search, setSearch] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<{ playerId: number; fullName: string } | null>(null);
  const [media, setMedia] = useState<PlayerMediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

  const filtered = players.filter((p) => p.fullName.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (!selectedPlayer) { setMedia([]); return; }
    setLoadingMedia(true);
    fetch(`/api/player/media?playerId=${selectedPlayer.playerId}&mediaType=video`, { cache: 'no-store' })
      .then(async (r) => {
        const payload = (await r.json().catch(() => ({}))) as { media?: PlayerMediaItem[] };
        setMedia(Array.isArray(payload.media) ? payload.media : []);
      })
      .catch(() => setMedia([]))
      .finally(() => setLoadingMedia(false));
  }, [selectedPlayer]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ background: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 14, padding: 20, width: 'min(520px, 94vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 14 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h4 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>Pick comparison video</h4>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '2px 8px', minHeight: 0 }} onClick={onCancel}>Cancel</button>
        </div>

        {!selectedPlayer ? (
          <>
            <input
              autoFocus
              placeholder="Search player..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.25)', background: 'rgba(255,255,255,0.06)', color: '#f8fafc', fontSize: 13 }}
            />
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '50vh' }}>
              {filtered.length === 0 && <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>No players found.</p>}
              {filtered.map((p) => (
                <button
                  key={p.playerId}
                  type="button"
                  className="btn btn-ghost"
                  style={{ textAlign: 'left', padding: '8px 12px', fontSize: 13, justifyContent: 'flex-start' }}
                  onClick={() => setSelectedPlayer(p)}
                >
                  {p.fullName}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px', minHeight: 0 }} onClick={() => setSelectedPlayer(null)}>← Back</button>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>{selectedPlayer.fullName}</span>
            </div>
            {loadingMedia && <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Loading videos...</p>}
            {!loadingMedia && media.length === 0 && <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>No videos uploaded for this player.</p>}
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '50vh' }}>
              {media.filter((m) => m.mediaType === 'video').map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="btn btn-ghost"
                  style={{ textAlign: 'left', padding: '8px 12px', fontSize: 13, justifyContent: 'flex-start', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}
                  onClick={() => onPick({
                    playerId: selectedPlayer.playerId,
                    playerName: selectedPlayer.fullName,
                    mediaId: m.id,
                    title: m.title,
                    url: `/api/player/media/${m.id}`,
                    mimeType: m.contentType,
                  })}
                >
                  <span>{m.title}</span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>{m.category} · {new Date(m.createdAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main viewer ───────────────────────────────────────────────────────────────

export default function MediaBreakdownViewer({ title, url, mimeType, downloadName, onClose, players }: MediaBreakdownViewerProps) {
  const [tool, setTool] = useState<BreakdownTool>('line');
  const [drawMode, setDrawMode] = useState(false);
  const [color, setColor] = useState('#facc15');
  const [width, setWidth] = useState(4);
  const [angleMode, setAngleMode] = useState<'acute' | 'obtuse'>('acute');
  const [anglePendingCount, setAnglePendingCount] = useState(0);

  const [compareMode, setCompareMode] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [compareVideo, setCompareVideo] = useState<CompareVideo | null>(null);
  const [synced, setSynced] = useState(false);
  const syncRef = useRef<HTMLVideoElement | null>(null);

  const isVideo = mimeType.startsWith('video/');
  const isImage = mimeType.startsWith('image/');

  // Single-panel image/non-video state (kept for image support)
  const [annotations, setAnnotations] = useState<BreakdownAnnotation[]>([]);
  const [active, setActive] = useState<BreakdownAnnotation | null>(null);
  const [anglePending, setAnglePending] = useState<Array<{ x: number; y: number }>>([]);

  const handlePickVideo = useCallback((video: CompareVideo) => {
    setCompareVideo(video);
    setShowPicker(false);
  }, []);

  function pointerDownImage(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drawMode) return;
    event.preventDefault();
    const point = pointOnOverlay(event);
    if (tool === 'erase') {
      setAnnotations((items) => {
        const nearest = items.map((item) => ({ item, d: Math.min(...item.points.map((p) => Math.hypot(p.x - point.x, p.y - point.y))) })).sort((a, b) => a.d - b.d)[0];
        return nearest && nearest.d <= 0.08 ? items.filter((item) => item.id !== nearest.item.id) : items;
      });
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Text label');
      if (!text?.trim()) return;
      setAnnotations((items) => [...items, { id: `media-${Date.now()}`, tool: 'text', color, width, points: [point], text: text.trim() }]);
      return;
    }
    if (tool === 'angle') {
      const next = [...anglePending, point];
      if (next.length === 3) {
        setAnnotations((items) => [...items, { id: `media-${Date.now()}`, tool: 'angle', color, width, points: next, angleMode }]);
        setAnglePending([]);
        setAnglePendingCount(0);
      } else {
        setAnglePending(next);
        setAnglePendingCount(next.length);
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setActive({ id: `media-${Date.now()}-${Math.random().toString(16).slice(2)}`, tool, color, width, points: [point, point] });
  }

  function pointerMoveImage(event: ReactPointerEvent<SVGSVGElement>) {
    if (!active) return;
    event.preventDefault();
    const point = pointOnOverlay(event);
    setActive((current) => {
      if (!current) return current;
      if (current.tool === 'pen') return { ...current, points: [...current.points, point] };
      return { ...current, points: [current.points[0], point] };
    });
  }

  function finishImage(event?: ReactPointerEvent<SVGSVGElement>) {
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!active) return;
    setAnnotations((items) => [...items, active]);
    setActive(null);
  }

  const allImageAnnotations = [...annotations, ...(active ? [active] : []), ...(anglePending.length > 0 ? [{ id: 'angle-preview', tool: 'angle' as const, color, width, points: anglePending, angleMode }] : [])];

  const toolbar = (
    <div style={{
      display: 'flex', gap: 4, flexWrap: 'wrap', padding: '6px 8px', borderRadius: 10,
      background: 'rgba(2,6,23,0.92)', border: '1px solid rgba(148,163,184,0.25)', flexShrink: 0,
    }}>
      <button type="button" className={!drawMode ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: 12, padding: '3px 8px', minHeight: 0 }} onClick={() => { setDrawMode(false); setAnglePending([]); setAnglePendingCount(0); }}>View</button>
      {(['line', 'arrow', 'circle', 'pen', 'angle', 'text', 'erase'] as BreakdownTool[]).map((entry) => (
        <button key={entry} type="button" className={drawMode && tool === entry ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: 12, padding: '3px 8px', minHeight: 0 }} onClick={() => { setDrawMode(true); setTool(entry); setAnglePending([]); setAnglePendingCount(0); }}>
          {entry === 'pen' ? 'Freehand' : entry.charAt(0).toUpperCase() + entry.slice(1)}
          {entry === 'angle' && anglePendingCount > 0 ? ` (${anglePendingCount}/3)` : ''}
        </button>
      ))}
      {drawMode && tool === 'angle' ? (
        <>
          <button type="button" className={angleMode === 'acute' ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: 12, padding: '3px 8px', minHeight: 0 }} onClick={() => setAngleMode('acute')}>Acute</button>
          <button type="button" className={angleMode === 'obtuse' ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: 12, padding: '3px 8px', minHeight: 0 }} onClick={() => setAngleMode('obtuse')}>Obtuse</button>
        </>
      ) : null}
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color" style={{ width: 28, height: 28, padding: 1 }} />
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700 }}>
        W<input type="range" min={2} max={14} value={width} onChange={(e) => setWidth(Number(e.target.value))} style={{ width: 50 }} />
      </label>
      {!isVideo && (
        <>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px', minHeight: 0 }} onClick={() => { setAnnotations((items) => items.slice(0, -1)); setAnglePending([]); setAnglePendingCount(0); }} disabled={!annotations.length}>Undo</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px', minHeight: 0 }} onClick={() => { setAnnotations([]); setAnglePending([]); setAnglePendingCount(0); }} disabled={!annotations.length}>Clear</button>
        </>
      )}
    </div>
  );

  return (
    <div className="portal-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="portal-modal-panel"
        style={{
          width: compareMode ? 'min(1600px, 98vw)' : 'min(1180px, 96vw)',
          maxHeight: '98vh',
          background: '#020617',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          transition: 'width 0.2s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="portal-row-between" style={{ gap: 10, flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h3>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {isVideo && players && players.length > 0 && (
              <button
                type="button"
                className={compareMode ? 'btn btn-primary' : 'btn btn-ghost'}
                style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }}
                onClick={() => {
                  if (compareMode) { setCompareMode(false); setCompareVideo(null); setSynced(false); }
                  else { setCompareMode(true); setShowPicker(true); }
                }}
              >
                {compareMode ? 'Exit Compare' : 'Compare'}
              </button>
            )}
            {compareMode && compareVideo && (
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }} onClick={() => setShowPicker(true)}>
                Swap Video
              </button>
            )}
            {compareMode && compareVideo && (
              <button type="button" className={synced ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }} onClick={() => setSynced((v) => !v)}>
                {synced ? 'Synced ✓' : 'Sync'}
              </button>
            )}
            <a className="btn btn-ghost" href={url} download={downloadName || title} style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }}>Download</a>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }} onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Toolbar */}
        {toolbar}

        {/* Media area */}
        {isVideo && compareMode && compareVideo ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
            <VideoPanel
              url={url}
              title={title}
              tool={tool}
              drawMode={drawMode}
              color={color}
              width={width}
              angleMode={angleMode}
              synced={synced}
              syncRef={syncRef}
              compact
            />
            <VideoPanel
              url={compareVideo.url}
              title={`${compareVideo.playerName} — ${compareVideo.title}`}
              tool={tool}
              drawMode={drawMode}
              color={color}
              width={width}
              angleMode={angleMode}
              synced={synced}
              syncRef={syncRef}
              compact
            />
          </div>
        ) : isVideo ? (
          <VideoPanel
            url={url}
            title={title}
            tool={tool}
            drawMode={drawMode}
            color={color}
            width={width}
            angleMode={angleMode}
          />
        ) : isImage ? (
          <div style={{ position: 'relative', marginTop: 4, borderRadius: 10, overflow: 'hidden', background: '#000' }}>
            <img src={url} alt={title} style={{ width: '100%', maxHeight: '68vh', objectFit: 'contain', display: 'block' }} />
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: drawMode ? 'auto' : 'none', cursor: drawMode ? 'crosshair' : 'default', touchAction: 'none' }}
              onPointerDown={pointerDownImage}
              onPointerMove={pointerMoveImage}
              onPointerUp={finishImage}
              onPointerCancel={finishImage}
            >
              {allImageAnnotations.map((ann) => renderAnnotation(ann, ann.id))}
            </svg>
          </div>
        ) : (
          <iframe title={title} src={url} style={{ width: '100%', height: '68vh', border: 0 }} />
        )}
      </div>

      {showPicker && players && (
        <ComparePicker
          players={players}
          onPick={handlePickVideo}
          onCancel={() => { setShowPicker(false); if (!compareVideo) setCompareMode(false); }}
        />
      )}
    </div>
  );
}

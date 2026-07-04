'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

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
    // Place label along the bisector, close to the vertex so it touches the lines
    const dir1 = pts.length >= 2 ? { x: pts[0].x - vertex.x, y: pts[0].y - vertex.y } : { x: 0, y: -1 };
    const dir2 = pts.length >= 3 ? { x: pts[2].x - vertex.x, y: pts[2].y - vertex.y } : { x: 0, y: -1 };
    const mag1 = Math.hypot(dir1.x, dir1.y) || 1;
    const mag2 = Math.hypot(dir2.x, dir2.y) || 1;
    const norm1 = { x: dir1.x / mag1, y: dir1.y / mag1 };
    const norm2 = { x: dir2.x / mag2, y: dir2.y / mag2 };
    const bisect = { x: norm1.x + norm2.x, y: norm1.y + norm2.y };
    const bisectMag = Math.hypot(bisect.x, bisect.y) || 1;
    // 60px in SVG units (out of 1000) — sits right at the elbow of the angle
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

export default function MediaBreakdownViewer({ title, url, mimeType, downloadName, onClose }: MediaBreakdownViewerProps) {
  const [tool, setTool] = useState<BreakdownTool>('line');
  const [drawMode, setDrawMode] = useState(false);
  const [color, setColor] = useState('#facc15');
  const [width, setWidth] = useState(4);
  const [annotations, setAnnotations] = useState<BreakdownAnnotation[]>([]);
  const [active, setActive] = useState<BreakdownAnnotation | null>(null);
  // Angle tool: click-by-click mode
  const [anglePending, setAnglePending] = useState<Array<{ x: number; y: number }>>([]);
  const [angleMode, setAngleMode] = useState<'acute' | 'obtuse'>('acute');

  // Video controls
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const scrubberRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);

  const isVideo = mimeType.startsWith('video/');
  const isImage = mimeType.startsWith('image/');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setCurrentTime(video.currentTime);
    const onDuration = () => setDuration(video.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onDuration);
    video.addEventListener('durationchange', onDuration);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    let unmounted = false;
    return () => {
      unmounted = true;
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onDuration);
      video.removeEventListener('durationchange', onDuration);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      // Only clear src on real unmount, not StrictMode double-invoke.
      // We use a microtask so React has committed the next render before we act.
      Promise.resolve().then(() => {
        if (unmounted && video.parentElement === null) {
          video.pause();
          video.removeAttribute('src');
          video.load();
        }
      });
    };
  }, []);

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
    const fps = 30;
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + direction / fps));
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch((err: unknown) => {
        // AbortError is benign — browser interrupted play before it could start
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // NotAllowedError requires user gesture — ignore silently too
        if (err instanceof DOMException && err.name === 'NotAllowedError') return;
        console.error('video.play() failed:', err);
      });
    } else {
      video.pause();
    }
  }

  const distanceToAnnotation = (annotation: BreakdownAnnotation, point: { x: number; y: number }) => {
    if (!annotation.points.length) return 999;
    return Math.min(...annotation.points.map((p) => Math.hypot(p.x - point.x, p.y - point.y)));
  };

  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawMode) return;
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

    // Angle: click-by-click — 3 separate clicks
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

  // Live angle preview while clicking points
  const anglePreview: BreakdownAnnotation | null = anglePending.length > 0
    ? { id: 'angle-preview', tool: 'angle', color, width, points: anglePending, angleMode }
    : null;

  const allAnnotations = [
    ...annotations,
    ...(active ? [active] : []),
    ...(anglePreview ? [anglePreview] : []),
  ];

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div className="portal-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="portal-modal-panel"
        style={{ width: 'min(1180px, 96vw)', maxHeight: '96vh', background: '#020617', color: '#f8fafc', display: 'flex', flexDirection: 'column' }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="portal-row-between" style={{ gap: 10, flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>{title}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <a className="btn btn-ghost" href={url} download={downloadName || title}>Download</a>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Media + annotation overlay */}
        <div style={{ position: 'relative', marginTop: 10, borderRadius: 10, overflow: 'hidden', background: '#000', flexShrink: 0 }}>
          {isVideo ? (
            <video
              ref={videoRef}
              src={url}
              playsInline
              preload="auto"
              loop={loop}
              style={{ width: '100%', maxHeight: '62vh', display: 'block' }}
              onError={(e) => {
                const v = e.currentTarget;
                console.error('[MediaBreakdownViewer] video error:', v.error?.code, v.error?.message, 'src:', v.src);
              }}
            />
          ) : null}
          {isImage ? <img src={url} alt={title} style={{ width: '100%', maxHeight: '68vh', objectFit: 'contain', display: 'block' }} /> : null}
          {!isVideo && !isImage ? <iframe title={title} src={url} style={{ width: '100%', height: '68vh', border: 0 }} /> : null}

          {/* Drawing overlay — only intercepts pointer events in draw mode */}
          {(isVideo || isImage) ? (
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                pointerEvents: drawMode ? 'auto' : 'none',
                cursor: drawMode ? (tool === 'angle' ? 'crosshair' : 'crosshair') : 'default',
                touchAction: 'none',
              }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={finish}
              onPointerCancel={finish}
            >
              {allAnnotations.map((annotation) => renderAnnotation(annotation, annotation.id))}
            </svg>
          ) : null}

          {/* Toolbar — top-left overlay */}
          {(isVideo || isImage) ? (
            <div style={{
              position: 'absolute', top: 8, left: 8, zIndex: 4,
              display: 'flex', gap: 4, flexWrap: 'wrap',
              padding: '5px 7px', borderRadius: 10,
              background: 'rgba(2,6,23,0.88)', border: '1px solid rgba(148,163,184,0.3)',
            }}>
              <button type="button" className={!drawMode ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: 12, padding: '3px 8px', minHeight: 0 }} onClick={() => { setDrawMode(false); setAnglePending([]); }}>View</button>
              {(['line', 'arrow', 'circle', 'pen', 'angle', 'text', 'erase'] as BreakdownTool[]).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={drawMode && tool === entry ? 'btn btn-primary' : 'btn btn-ghost'}
                  style={{ fontSize: 12, padding: '3px 8px', minHeight: 0 }}
                  onClick={() => { setDrawMode(true); setTool(entry); setAnglePending([]); }}
                >
                  {entry === 'pen' ? 'Freehand' : entry.charAt(0).toUpperCase() + entry.slice(1)}
                  {entry === 'angle' && anglePending.length > 0 ? ` (${anglePending.length}/3)` : ''}
                </button>
              ))}
              {drawMode && tool === 'angle' ? (
                <>
                  <button
                    type="button"
                    className={angleMode === 'acute' ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ fontSize: 12, padding: '3px 8px', minHeight: 0 }}
                    onClick={() => setAngleMode('acute')}
                  >
                    Acute
                  </button>
                  <button
                    type="button"
                    className={angleMode === 'obtuse' ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ fontSize: 12, padding: '3px 8px', minHeight: 0 }}
                    onClick={() => setAngleMode('obtuse')}
                  >
                    Obtuse
                  </button>
                </>
              ) : null}
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Color" style={{ width: 30, height: 30, padding: 1 }} />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700 }}>
                W<input type="range" min={2} max={14} value={width} onChange={(event) => setWidth(Number(event.target.value))} style={{ width: 54 }} />
              </label>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px', minHeight: 0 }} onClick={() => { setAnnotations((items) => items.slice(0, -1)); setAnglePending([]); }} disabled={!annotations.length}>Undo</button>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 8px', minHeight: 0 }} onClick={() => { setAnnotations([]); setAnglePending([]); }} disabled={!annotations.length}>Clear</button>
            </div>
          ) : null}
        </div>

        {/* Custom video controls */}
        {isVideo ? (
          <div style={{ flexShrink: 0, padding: '10px 4px 4px', display: 'grid', gap: 8 }}>
            {/* Scrubber bar */}
            <div
              ref={scrubberRef}
              style={{
                height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.1)',
                cursor: 'pointer', position: 'relative', userSelect: 'none',
              }}
              onPointerDown={onScrubStart}
              onPointerMove={onScrubMove}
              onPointerUp={onScrubEnd}
              onPointerCancel={onScrubEnd}
            >
              {/* Filled portion */}
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${progress * 100}%`,
                background: 'rgba(239,68,68,0.85)', borderRadius: 6,
                pointerEvents: 'none',
              }} />
              {/* Thumb */}
              <div style={{
                position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
                left: `${progress * 100}%`,
                width: 18, height: 18, borderRadius: '50%',
                background: '#ef4444', border: '2px solid #fff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                pointerEvents: 'none',
              }} />
              {/* Time labels */}
              <span style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 700, color: '#fff', pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                {formatTime(currentTime)}
              </span>
              <span style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 700, color: '#fff', pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                {formatTime(duration)}
              </span>
            </div>

            {/* Playback buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }} onClick={() => stepFrame(-1)}>‹ Frame</button>
              <button type="button" className="btn btn-primary" style={{ fontSize: 13, padding: '4px 16px', minHeight: 0 }} onClick={togglePlay}>
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }} onClick={() => stepFrame(1)}>Frame ›</button>
              <button type="button" className={loop ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }} onClick={() => setLoop((v) => !v)}>Loop</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>Speed</span>
                {[0.1, 0.25, 0.5, 1, 1.5, 2].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    className={playbackRate === rate ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ fontSize: 11, padding: '2px 7px', minHeight: 0 }}
                    onClick={() => setPlaybackRate(rate)}
                  >
                    {rate === 1 ? '1×' : rate === 0.1 ? '0.1×' : `${rate}×`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

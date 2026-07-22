'use client';

import { useEffect, useMemo, useRef, useState, useCallback, type PointerEvent as ReactPointerEvent } from 'react';

type BreakdownTool = 'line' | 'arrow' | 'circle' | 'pen' | 'text' | 'angle' | 'erase';
export type BreakdownAnnotation = {
  id: string;
  tool: Exclude<BreakdownTool, 'erase'>;
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
  text?: string;
  fontSize?: number;
  angleMode?: 'acute' | 'obtuse';
};

type MediaBreakdownViewerProps = {
  title: string;
  url: string;
  mimeType: string;
  downloadName?: string;
  onClose: () => void;
  players?: Array<{ playerId: number; fullName: string }>;
  initialAnnotations?: BreakdownAnnotation[];
  onSaveAnnotations?: (annotations: BreakdownAnnotation[]) => Promise<void>;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  positionLabel?: string;
  onDelete?: () => void;
};

type CompareMedia = {
  playerId: number;
  playerName: string;
  mediaId: number;
  title: string;
  url: string;
  mimeType: string;
};
type CompareLayout = 'side-by-side' | 'stacked' | 'overlay';

type PlayerMediaItem = {
  id: number;
  title: string;
  contentType: string;
  mediaType: string;
  category: string;
  createdAt: string;
};
type AnnotationDragState = {
  id: string;
  anchor: { x: number; y: number };
  points: Array<{ x: number; y: number }>;
};
type RecordingCommand = { id: number; action: 'start' | 'stop' };

const TOOL_LABELS: Record<BreakdownTool, string> = {
  line: 'Line',
  arrow: 'Arrow',
  circle: 'Circle',
  pen: 'Freehand',
  text: 'Text',
  angle: 'Angle',
  erase: 'Erase',
};

const TOOL_ICONS: Record<BreakdownTool | 'view', string> = {
  view: '✥',
  line: '╱',
  arrow: '↗',
  circle: '○',
  pen: '~',
  text: 'T',
  angle: '∠',
  erase: '⌫',
};

const TOOL_ORDER: BreakdownTool[] = ['line', 'arrow', 'circle', 'pen', 'angle', 'text', 'erase'];
const DRAWING_COLOR_SWATCHES = ['#23f3f6', '#ffff00', '#f97316', '#ef4444', '#22c55e', '#ffffff'];
const DRAWING_WIDTH_STEPS = [2, 4, 6, 8, 10, 14];
const TEXT_SIZE_STEPS = [24, 36, 48, 64, 80, 96];
const RECORDING_MIME_OPTIONS = [
  { mimeType: 'video/mp4;codecs=h264,aac', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
];
const glassPanelStyle: React.CSSProperties = {
  border: '1px solid rgba(148,163,184,0.24)',
  background: 'rgba(2,6,23,0.88)',
  boxShadow: '0 18px 34px rgba(0,0,0,0.28)',
  backdropFilter: 'blur(12px)',
};
const compactIconButtonStyle: React.CSSProperties = {
  width: 36,
  minWidth: 36,
  minHeight: 36,
  height: 36,
  padding: 0,
  borderRadius: 10,
  fontSize: 17,
  lineHeight: 1,
};

// ── Geometry helpers ──────────────────────────────────────────────────────────

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

// Convert a pointer event on the SVG overlay (which moves with the video) to
// a 0-1 normalised coordinate in video space, accounting for zoom + pan.
function pointOnOverlay(
  event: ReactPointerEvent<SVGSVGElement>,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  // Raw fraction within the (zoomed+panned) SVG element
  const rx = (event.clientX - rect.left) / Math.max(1, rect.width);
  const ry = (event.clientY - rect.top) / Math.max(1, rect.height);
  // Invert the transform to get the fraction in original video space
  // transform: translate(pan.x%, pan.y%) scale(zoom), origin = 50% 50%
  // raw = (orig - 0.5) * zoom + 0.5 + pan/containerSize
  // For our use-case pan is stored as fraction of container, so:
  const ox = (rx - 0.5 - pan.x) / zoom + 0.5;
  const oy = (ry - 0.5 - pan.y) / zoom + 0.5;
  return { x: Math.max(0, Math.min(1, ox)), y: Math.max(0, Math.min(1, oy)) };
}

function renderAnnotation(annotation: BreakdownAnnotation, key: string) {
  const pts = annotation.points;
  if (!pts.length) return null;
  const u = 1000;
  const sx = (v: number) => v * u;
  const labelStyle: React.CSSProperties = { paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.82)', strokeWidth: 6 };

  if (annotation.tool === 'text') {
    return (
      <text key={key} x={sx(pts[0].x)} y={sx(pts[0].y)} fill={annotation.color} fontSize={Math.max(16, Number(annotation.fontSize ?? 36))} fontWeight={900} style={labelStyle}>
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
    const bisect = { x: dir1.x / mag1 + dir2.x / mag2, y: dir1.y / mag1 + dir2.y / mag2 };
    const bisectMag = Math.hypot(bisect.x, bisect.y) || 1;
    const labelX = sx(vertex.x) + (bisect.x / bisectMag) * 60;
    const labelY = sx(vertex.y) + (bisect.y / bisectMag) * 60;
    return (
      <g key={key}>
        <polyline points={polyPoints} fill="none" stroke={annotation.color} strokeWidth={annotation.width} strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, idx) => <circle key={`${key}-p-${idx}`} cx={sx(p.x)} cy={sx(p.y)} r={8} fill={annotation.color} stroke="rgba(0,0,0,0.78)" strokeWidth={2} />)}
        {angle !== null && (
          <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle" fill={annotation.color} fontSize={38} fontWeight={900} style={labelStyle}>
            {`${angle.toFixed(1)}°`}
          </text>
        )}
      </g>
    );
  }
  const polyPoints = pts.map((p) => `${sx(p.x)},${sx(p.y)}`).join(' ');
  if (annotation.tool === 'arrow' && pts.length >= 2) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const size = 34;
    const bx = sx(b.x); const by = sx(b.y);
    return (
      <g key={key}>
        <polyline points={polyPoints} fill="none" stroke={annotation.color} strokeWidth={annotation.width} strokeLinecap="round" strokeLinejoin="round" />
        <polygon points={`${bx},${by} ${bx - size * Math.cos(angle - Math.PI / 6)},${by - size * Math.sin(angle - Math.PI / 6)} ${bx - size * Math.cos(angle + Math.PI / 6)},${by - size * Math.sin(angle + Math.PI / 6)}`} fill={annotation.color} />
      </g>
    );
  }
  return <polyline key={key} points={polyPoints} fill="none" stroke={annotation.color} strokeWidth={annotation.width} strokeLinecap="round" strokeLinejoin="round" />;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// ── Zoom/pan helpers ──────────────────────────────────────────────────────────

const ZOOM_STEP = 0.35;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

function clampPan(pan: { x: number; y: number }, zoom: number) {
  // Maximum pan offset (as fraction of container) to keep video in view
  const maxOff = Math.max(0, (zoom - 1) / (2 * zoom));
  return {
    x: Math.max(-maxOff, Math.min(maxOff, pan.x)),
    y: Math.max(-maxOff, Math.min(maxOff, pan.y)),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function moveAnnotationPoints(drag: AnnotationDragState, point: { x: number; y: number }) {
  const rawDx = point.x - drag.anchor.x;
  const rawDy = point.y - drag.anchor.y;
  const minX = Math.min(...drag.points.map((p) => p.x));
  const maxX = Math.max(...drag.points.map((p) => p.x));
  const minY = Math.min(...drag.points.map((p) => p.y));
  const maxY = Math.max(...drag.points.map((p) => p.y));
  const dx = Math.max(-minX, Math.min(1 - maxX, rawDx));
  const dy = Math.max(-minY, Math.min(1 - maxY, rawDy));
  return drag.points.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) }));
}

// ── Video panel ───────────────────────────────────────────────────────────────

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
  initialAnnotations?: BreakdownAnnotation[];
  onAnnotationsChange?: (annotations: BreakdownAnnotation[]) => void;
  textFontSize: number;
  showTimer: boolean;
  recordingCommand?: RecordingCommand | null;
  onRecordingStarted?: () => void;
  onRecordingReady?: (url: string, downloadName: string) => void;
  onRecordingError?: (message: string) => void;
  syncRole?: 'leader' | 'follower';
  syncVersion?: number;
};

function VideoPanel({ url, title, tool, drawMode, color, width, angleMode, onActivate, isActive, syncRef, synced, compact, initialAnnotations, onAnnotationsChange, textFontSize, showTimer, recordingCommand, onRecordingStarted, onRecordingReady, onRecordingError, syncRole, syncVersion = 0 }: VideoPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const scrubberRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);
  const syncOffsetRef = useRef(0);

  // Zoom & pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const mediaWrapRef = useRef<HTMLDivElement | null>(null);
  const panelRecorderRef = useRef<MediaRecorder | null>(null);
  const panelRecordingStreamRef = useRef<MediaStream | null>(null);
  const panelRecordingAnimationRef = useRef<number | null>(null);
  const panelRecordingChunksRef = useRef<Blob[]>([]);
  const handledRecordingCommandIdRef = useRef(0);
  const liveAnnotationsRef = useRef<BreakdownAnnotation[]>([]);
  const liveShowTimerRef = useRef(false);

  // Annotation state
  const [annotations, setAnnotations] = useState<BreakdownAnnotation[]>([]);
  const [active, setActive] = useState<BreakdownAnnotation | null>(null);
  const [anglePending, setAnglePending] = useState<Array<{ x: number; y: number }>>([]);
  const [draggingAnnotation, setDraggingAnnotation] = useState<AnnotationDragState | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setAnnotations(Array.isArray(initialAnnotations) ? initialAnnotations : []);
      setActive(null);
      setAnglePending([]);
      setVideoFailed(false);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [initialAnnotations, url]);

  useEffect(() => {
    onAnnotationsChange?.(annotations);
  }, [annotations, onAnnotationsChange]);

  useEffect(() => {
    if (syncRole === 'leader' && syncRef) syncRef.current = videoRef.current;
  }, [syncRef, syncRole, url]);

  useEffect(() => {
    const video = videoRef.current;
    const leader = syncRef?.current;
    if (!synced || syncRole !== 'follower' || !video || !leader || leader === video) return;

    syncOffsetRef.current = video.currentTime - leader.currentTime;

    const syncToLeaderTime = () => {
      const target = Math.max(0, Math.min(video.duration || Number.MAX_SAFE_INTEGER, leader.currentTime + syncOffsetRef.current));
      if (Math.abs(video.currentTime - target) > 0.08) video.currentTime = target;
      setCurrentTime(video.currentTime);
    };
    const syncPlay = () => {
      syncToLeaderTime();
      video.playbackRate = leader.playbackRate;
      void video.play().catch(() => {});
    };
    const syncPause = () => {
      video.pause();
      syncToLeaderTime();
    };
    const syncRate = () => {
      video.playbackRate = leader.playbackRate;
    };

    leader.addEventListener('timeupdate', syncToLeaderTime);
    leader.addEventListener('seeking', syncToLeaderTime);
    leader.addEventListener('play', syncPlay);
    leader.addEventListener('pause', syncPause);
    leader.addEventListener('ratechange', syncRate);
    syncRate();
    return () => {
      leader.removeEventListener('timeupdate', syncToLeaderTime);
      leader.removeEventListener('seeking', syncToLeaderTime);
      leader.removeEventListener('play', syncPlay);
      leader.removeEventListener('pause', syncPause);
      leader.removeEventListener('ratechange', syncRate);
    };
  }, [syncRef, syncRole, syncVersion, synced]);

  // ── Video events ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrentTime(video.currentTime);
      if (synced && syncRole !== 'follower' && syncRef?.current && syncRef.current !== video) {
        const diff = Math.abs(syncRef.current.currentTime - video.currentTime);
        if (diff > 0.08) syncRef.current.currentTime = video.currentTime;
      }
    };
    const onDuration = () => setDuration(video.duration || 0);
    const onPlay = () => { setPlaying(true); if (synced && syncRole !== 'follower' && syncRef?.current && syncRef.current !== video) syncRef.current.play().catch(() => {}); };
    const onPause = () => { setPlaying(false); if (synced && syncRole !== 'follower' && syncRef?.current && syncRef.current !== video) syncRef.current.pause(); };
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
  }, [synced, syncRef, syncRole]);

  useEffect(() => { if (isActive && syncRef) syncRef.current = videoRef.current; }, [isActive, syncRef]);
  useEffect(() => { const video = videoRef.current; if (!video) return; video.playbackRate = playbackRate; }, [playbackRate]);

  const anglePreview: BreakdownAnnotation | null = useMemo(
    () => anglePending.length > 0
      ? { id: 'angle-preview', tool: 'angle', color, width, points: anglePending, angleMode }
      : null,
    [angleMode, anglePending, color, width]
  );
  const allAnnotations = useMemo(
    () => [...annotations, ...(active ? [active] : []), ...(anglePreview ? [anglePreview] : [])],
    [active, anglePreview, annotations]
  );

  useEffect(() => {
    liveAnnotationsRef.current = allAnnotations;
  }, [allAnnotations]);

  useEffect(() => {
    liveShowTimerRef.current = showTimer;
  }, [showTimer]);

  const stopPanelRecording = useCallback(() => {
    if (panelRecorderRef.current?.state === 'recording') {
      panelRecorderRef.current.stop();
      return;
    }
    if (panelRecordingAnimationRef.current !== null) {
      cancelAnimationFrame(panelRecordingAnimationRef.current);
      panelRecordingAnimationRef.current = null;
    }
    panelRecordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    panelRecordingStreamRef.current = null;
  }, []);

  const drawAnnotationToCanvas = useCallback((ctx: CanvasRenderingContext2D, annotation: BreakdownAnnotation) => {
    const pts = annotation.points;
    if (!pts.length) return;
    ctx.save();
    ctx.scale(ctx.canvas.width / 1000, ctx.canvas.height / 1000);
    ctx.strokeStyle = annotation.color;
    ctx.fillStyle = annotation.color;
    ctx.lineWidth = annotation.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const sx = (value: number) => value * 1000;
    const sy = (value: number) => value * 1000;
    if (annotation.tool === 'text') {
      const point = pts[0]!;
      const fontSize = annotation.fontSize ?? 36;
      ctx.font = `900 ${fontSize}px sans-serif`;
      ctx.lineWidth = Math.max(3, fontSize * 0.14);
      ctx.strokeStyle = 'rgba(0,0,0,0.82)';
      ctx.strokeText(annotation.text ?? '', sx(point.x), sy(point.y));
      ctx.fillStyle = annotation.color;
      ctx.fillText(annotation.text ?? '', sx(point.x), sy(point.y));
      ctx.restore();
      return;
    }
    if (annotation.tool === 'circle') {
      const a = pts[0]!;
      const b = pts[1] ?? a;
      const x = sx(Math.min(a.x, b.x));
      const y = sy(Math.min(a.y, b.y));
      const w = Math.abs(sx(b.x - a.x));
      const h = Math.abs(sy(b.y - a.y));
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(2, w / 2), Math.max(2, h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.beginPath();
    pts.forEach((point, index) => {
      const x = sx(point.x);
      const y = sy(point.y);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (annotation.tool === 'arrow' && pts.length >= 2) {
      const a = pts[pts.length - 2]!;
      const b = pts[pts.length - 1]!;
      const angle = Math.atan2(sy(b.y - a.y), sx(b.x - a.x));
      const size = Math.max(16, annotation.width * 4);
      const bx = sx(b.x);
      const by = sy(b.y);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - size * Math.cos(angle - Math.PI / 6), by - size * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(bx - size * Math.cos(angle + Math.PI / 6), by - size * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }
    if (annotation.tool === 'angle') {
      for (const point of pts) {
        ctx.beginPath();
        ctx.arc(sx(point.x), sy(point.y), 8, 0, Math.PI * 2);
        ctx.fill();
      }
      const value = measureAngle(pts, annotation.angleMode);
      if (value !== null && pts[1]) {
        const b = pts[1];
        ctx.font = '900 36px sans-serif';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(0,0,0,0.72)';
        ctx.strokeText(`${Math.round(value)}°`, sx(b.x) + 18, sy(b.y) - 18);
        ctx.fillStyle = annotation.color;
        ctx.fillText(`${Math.round(value)}°`, sx(b.x) + 18, sy(b.y) - 18);
      }
    }
    ctx.restore();
  }, []);

  const startPanelRecording = useCallback(() => {
    const video = videoRef.current;
    const wrap = mediaWrapRef.current;
    if (!video || !wrap || typeof MediaRecorder === 'undefined') {
      onRecordingError?.('Recording is not supported in this browser.');
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const scale = Math.max(1, Math.min(window.devicePixelRatio || 1, 1920 / Math.max(1, rect.width), 1080 / Math.max(1, rect.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(rect.width * scale));
    canvas.height = Math.max(2, Math.round(rect.height * scale));
    const ctx = canvas.getContext('2d');
    const captureStream = canvas.captureStream?.(30);
    if (!ctx || !captureStream) {
      onRecordingError?.('Canvas recording is not supported in this browser.');
      return;
    }
    panelRecordingChunksRef.current = [];
    const capturedVideo = video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
    const sourceStream = capturedVideo.captureStream?.() ?? capturedVideo.mozCaptureStream?.();
    const audioTracks = sourceStream?.getAudioTracks() ?? [];
    const stream = new MediaStream([...captureStream.getVideoTracks(), ...audioTracks]);
    panelRecordingStreamRef.current = stream;
    const recordingFormat = RECORDING_MIME_OPTIONS.find((option) => MediaRecorder.isTypeSupported(option.mimeType)) ?? RECORDING_MIME_OPTIONS[RECORDING_MIME_OPTIONS.length - 1]!;
    const recorder = new MediaRecorder(stream, { mimeType: recordingFormat.mimeType });
    panelRecorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) panelRecordingChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      if (panelRecordingAnimationRef.current !== null) {
        cancelAnimationFrame(panelRecordingAnimationRef.current);
        panelRecordingAnimationRef.current = null;
      }
      const blob = new Blob(panelRecordingChunksRef.current, { type: recordingFormat.mimeType });
      panelRecordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      panelRecordingStreamRef.current = null;
      onRecordingReady?.(URL.createObjectURL(blob), `video-breakdown-${Date.now()}.${recordingFormat.extension}`);
    };
    const renderFrame = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        const videoAspect = video.videoWidth / video.videoHeight;
        const canvasAspect = canvas.width / canvas.height;
        let drawWidth = canvas.width;
        let drawHeight = canvas.height;
        let drawX = 0;
        let drawY = 0;
        if (videoAspect > canvasAspect) {
          drawHeight = canvas.width / videoAspect;
          drawY = (canvas.height - drawHeight) / 2;
        } else {
          drawWidth = canvas.height * videoAspect;
          drawX = (canvas.width - drawWidth) / 2;
        }
        ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
      }
      for (const annotation of liveAnnotationsRef.current) drawAnnotationToCanvas(ctx, annotation);
      if (liveShowTimerRef.current) {
        const pad = 18 * scale;
        ctx.font = `900 ${18 * scale}px sans-serif`;
        const text = formatTime(video.currentTime || 0);
        const metrics = ctx.measureText(text);
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        roundRect(ctx, pad, pad, metrics.width + 54 * scale, 34 * scale, 18 * scale);
        ctx.fill();
        ctx.strokeStyle = '#23f3f6';
        ctx.lineWidth = 2.4 * scale;
        ctx.beginPath();
        ctx.arc(pad + 17 * scale, pad + 17 * scale, 8 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pad + 17 * scale, pad + 17 * scale);
        ctx.lineTo(pad + 17 * scale, pad + 11 * scale);
        ctx.moveTo(pad + 17 * scale, pad + 17 * scale);
        ctx.lineTo(pad + 21 * scale, pad + 17 * scale);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(text, pad + 36 * scale, pad + 23 * scale);
      }
      panelRecordingAnimationRef.current = requestAnimationFrame(renderFrame);
    };
    renderFrame();
    recorder.start();
    onRecordingStarted?.();
  }, [drawAnnotationToCanvas, onRecordingError, onRecordingReady, onRecordingStarted]);

  useEffect(() => {
    if (!recordingCommand || syncRole === 'follower') return;
    if (handledRecordingCommandIdRef.current === recordingCommand.id) return;
    handledRecordingCommandIdRef.current = recordingCommand.id;
    if (recordingCommand.action === 'start') startPanelRecording();
    else stopPanelRecording();
  }, [recordingCommand, startPanelRecording, stopPanelRecording, syncRole]);

  useEffect(() => () => stopPanelRecording(), [stopPanelRecording]);

  // ── Zoom & pan handlers ──
  function applyZoom(delta: number, pivot?: { x: number; y: number }) {
    setZoom((prev) => {
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev + delta));
      if (next === prev) return prev;
      // If zooming out to 1 reset pan
      if (next === 1) { setPan({ x: 0, y: 0 }); return next; }
      // Optionally shift pan toward pivot (centre of container by default)
      setPan((p) => clampPan(p, next));
      return next;
    });
  }

  // Pinch-to-zoom via wheel
  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    applyZoom(delta);
  }

  // Pan drag — only active when zoomed in and not in draw mode
  function onPanStart(e: React.PointerEvent<HTMLDivElement>) {
    if (drawMode || zoom <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panStart.current = { px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y };
  }

  function onPanMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!panStart.current) return;
    const wrap = mediaWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dx = (e.clientX - panStart.current.px) / rect.width;
    const dy = (e.clientY - panStart.current.py) / rect.height;
    setPan(clampPan({ x: panStart.current.ox + dx, y: panStart.current.oy + dy }, zoom));
  }

  function onPanEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    panStart.current = null;
  }

  function resetZoom() { setZoom(1); setPan({ x: 0, y: 0 }); }

  // ── Scrubber ──
  function scrubToFraction(fraction: number) {
    const video = videoRef.current;
    if (!video || !duration) return;
    const t = Math.max(0, Math.min(duration, fraction * duration));
    video.currentTime = t;
    setCurrentTime(t);
    if (synced && syncRole !== 'follower' && syncRef?.current && syncRef.current !== video) syncRef.current.currentTime = t;
  }
  function getScrubFraction(clientX: number) {
    const bar = scrubberRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }
  function onScrubStart(e: React.PointerEvent<HTMLDivElement>) {
    scrubbing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    videoRef.current?.pause();
    if (synced && syncRole !== 'follower' && syncRef?.current) syncRef.current.pause();
    scrubToFraction(getScrubFraction(e.clientX));
  }
  function onScrubMove(e: React.PointerEvent<HTMLDivElement>) { if (scrubbing.current) scrubToFraction(getScrubFraction(e.clientX)); }
  function onScrubEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function stepFrame(direction: 1 | -1) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const t = Math.max(0, Math.min(duration, video.currentTime + direction / 30));
    video.currentTime = t;
    if (synced && syncRole !== 'follower' && syncRef?.current) { syncRef.current.pause(); syncRef.current.currentTime = t; }
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch((err: unknown) => { if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return; });
    else video.pause();
  }

  // ── Annotation draw ──
  const distanceToAnnotation = (ann: BreakdownAnnotation, point: { x: number; y: number }) => {
    if (!ann.points.length) return 999;
    if (ann.tool === 'text') return Math.hypot(ann.points[0].x - point.x, ann.points[0].y - point.y);
    return Math.min(...ann.points.map((p) => Math.hypot(p.x - point.x, p.y - point.y)));
  };

  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawMode) return;
    onActivate?.();
    event.preventDefault();
    const point = pointOnOverlay(event, zoom, pan);
    if (tool !== 'erase') {
      const nearestAnnotation = annotations
        .filter((item) => item.points.length > 0)
        .map((item) => ({ item, d: distanceToAnnotation(item, point) }))
        .sort((a, b) => a.d - b.d)[0];
      if (nearestAnnotation && nearestAnnotation.d <= 0.08) {
        setDraggingAnnotation({ id: nearestAnnotation.item.id, anchor: point, points: nearestAnnotation.item.points });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
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
      setAnnotations((items) => [...items, { id: `media-${Date.now()}`, tool: 'text', color, width, points: [point], text: text.trim(), fontSize: textFontSize }]);
      return;
    }
    if (tool === 'angle') {
      const next = [...anglePending, point];
      if (next.length === 3) { setAnnotations((items) => [...items, { id: `media-${Date.now()}`, tool: 'angle', color, width, points: next, angleMode }]); setAnglePending([]); }
      else setAnglePending(next);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setActive({ id: `media-${Date.now()}-${Math.random().toString(16).slice(2)}`, tool, color, width, points: [point, point] });
  };

  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (draggingAnnotation) {
      event.preventDefault();
      const point = pointOnOverlay(event, zoom, pan);
      const nextPoints = moveAnnotationPoints(draggingAnnotation, point);
      setAnnotations((items) => items.map((item) => (item.id === draggingAnnotation.id ? { ...item, points: nextPoints } : item)));
      return;
    }
    if (!active) return;
    event.preventDefault();
    const point = pointOnOverlay(event, zoom, pan);
    setActive((current) => {
      if (!current) return current;
      if (current.tool === 'pen') return { ...current, points: [...current.points, point] };
      return { ...current, points: [current.points[0], point] };
    });
  };

  const finish = (event?: ReactPointerEvent<SVGSVGElement>) => {
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (draggingAnnotation) {
      setDraggingAnnotation(null);
      return;
    }
    if (!active) return;
    setAnnotations((items) => [...items, active]);
    setActive(null);
  };

  const progress = duration > 0 ? currentTime / duration : 0;
  const maxH = compact ? '38vh' : '62vh';

  // CSS transform for zoom + pan
  const transformStyle = zoom > 1
    ? `translate(${pan.x * 100}%, ${pan.y * 100}%) scale(${zoom})`
    : undefined;

  const isZoomed = zoom > 1;
  const canPan = isZoomed && !drawMode;

  return (
    <div className={`portal-media-breakdown-video-panel${synced ? ' portal-media-breakdown-video-panel--synced' : ''}${syncRole ? ` portal-media-breakdown-video-panel--sync-${syncRole}` : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
      <div className="portal-media-breakdown-panel-title" style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{title}</div>

      {/* Video + overlay wrapper — clips the zoom */}
      <div
        ref={mediaWrapRef}
        className="portal-media-breakdown-media-wrap"
        style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#000', cursor: canPan ? 'grab' : drawMode ? 'crosshair' : 'default' }}
        onClick={onActivate}
        onWheel={onWheel}
        onPointerDown={onPanStart}
        onPointerMove={onPanMove}
        onPointerUp={onPanEnd}
        onPointerCancel={onPanEnd}
      >
        {/* Inner wrapper that receives the transform */}
        <div className="portal-media-breakdown-stage-inner" style={{ transform: transformStyle, transformOrigin: '50% 50%', willChange: zoom > 1 ? 'transform' : undefined }}>
          {videoFailed ? (
            <div className="portal-media-breakdown-video-fallback" style={{ minHeight: maxH }}>
              <strong>Video preview is not supported in this browser.</strong>
              <span>Download the file or use an MP4/H.264 version.</span>
              <a className="btn btn-primary" href={url} download={title}>Download</a>
            </div>
          ) : (
            <video
              ref={videoRef}
              className="portal-media-breakdown-video"
              src={url}
              playsInline
              preload="auto"
              loop={loop}
              style={{ width: '100%', maxHeight: maxH, display: 'block', pointerEvents: 'none' }}
              onError={() => setVideoFailed(true)}
            />
          )}
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
          {showTimer ? (
            <div className="portal-media-breakdown-video-timer" aria-label="Video timer">
              <span className="portal-media-breakdown-video-timer-icon">⏱</span>
              <span>{formatTime(currentTime)}</span>
            </div>
          ) : null}
        </div>

        {/* Zoom controls — always visible, top-left corner */}
        <div className="portal-media-breakdown-zoom-controls" style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 3, zIndex: 10 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 14, padding: '1px 8px', minHeight: 0, background: 'rgba(2,6,23,0.85)', lineHeight: 1.4, fontWeight: 700 }}
            onClick={(e) => { e.stopPropagation(); applyZoom(ZOOM_STEP); }}
            title="Zoom in"
          >+</button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 14, padding: '1px 8px', minHeight: 0, background: 'rgba(2,6,23,0.85)', lineHeight: 1.4, fontWeight: 700 }}
            onClick={(e) => { e.stopPropagation(); applyZoom(-ZOOM_STEP); }}
            title="Zoom out"
          >−</button>
          {isZoomed && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 10, padding: '1px 7px', minHeight: 0, background: 'rgba(2,6,23,0.85)', fontWeight: 700 }}
              onClick={(e) => { e.stopPropagation(); resetZoom(); }}
              title="Reset zoom"
            >{Math.round(zoom * 10) / 10}× ✕</button>
          )}
        </div>

        {/* Undo/Clear — bottom-right */}
        <div className="portal-media-breakdown-overlay-actions" style={{ position: 'absolute', bottom: 6, right: 6, display: 'flex', gap: 4, zIndex: 10 }}>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 7px', minHeight: 0, background: 'rgba(2,6,23,0.8)' }} onClick={(e) => { e.stopPropagation(); setAnnotations((items) => items.slice(0, -1)); setAnglePending([]); }} disabled={!annotations.length}>Undo</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 7px', minHeight: 0, background: 'rgba(2,6,23,0.8)' }} onClick={(e) => { e.stopPropagation(); setAnnotations([]); setAnglePending([]); }} disabled={!annotations.length}>Clear</button>
        </div>

        {/* Pan hint when zoomed + draw mode conflict */}
        {isZoomed && drawMode && (
          <div style={{ position: 'absolute', top: 6, right: 6, fontSize: 9, fontWeight: 700, color: '#94a3b8', background: 'rgba(2,6,23,0.8)', borderRadius: 4, padding: '2px 6px', zIndex: 10, pointerEvents: 'none' }}>
            Switch to View to pan
          </div>
        )}
      </div>

      {/* Scrubber */}
      <div
        ref={scrubberRef}
        className="portal-media-breakdown-scrubber"
        style={{ height: 24, borderRadius: 6, background: 'rgba(255,255,255,0.1)', cursor: 'pointer', position: 'relative', userSelect: 'none' }}
        onPointerDown={onScrubStart}
        onPointerMove={onScrubMove}
        onPointerUp={onScrubEnd}
        onPointerCancel={onScrubEnd}
      >
        <div className="portal-media-breakdown-scrubber-progress" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: 'rgba(239,68,68,0.85)', borderRadius: 6, pointerEvents: 'none' }} />
        <div className="portal-media-breakdown-scrubber-thumb" style={{ position: 'absolute', top: '50%', transform: 'translate(-50%,-50%)', left: `${progress * 100}%`, width: 16, height: 16, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.5)', pointerEvents: 'none' }} />
        <span style={{ position: 'absolute', left: 5, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontWeight: 700, color: '#fff', pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{formatTime(currentTime)}</span>
        <span style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontWeight: 700, color: '#fff', pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{formatTime(duration)}</span>
      </div>
      <div className="portal-media-breakdown-frame-ticks" aria-hidden="true">
        {Array.from({ length: 19 }).map((_, index) => (
          <span key={index} className={index === 9 ? 'is-center' : index % 3 === 0 ? 'is-major' : ''} />
        ))}
      </div>

      {/* Playback controls */}
      <div className="portal-media-breakdown-playback-controls" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost portal-media-breakdown-rate-button" style={{ fontSize: 11, padding: '2px 7px', minHeight: 0 }} onClick={() => setPlaybackRate((rate) => (rate === 1 ? 0.5 : rate === 0.5 ? 0.25 : 1))}>{playbackRate === 1 ? '1×' : `${playbackRate}×`}</button>
        <button type="button" className={loop ? 'btn btn-primary portal-media-breakdown-loop-button' : 'btn btn-ghost portal-media-breakdown-loop-button'} style={{ fontSize: 11, padding: '2px 7px', minHeight: 0 }} onClick={() => setLoop((v) => !v)}>↻</button>
        <button type="button" className="btn btn-ghost portal-media-breakdown-step-button" style={{ fontSize: 11, padding: '2px 7px', minHeight: 0 }} onClick={() => stepFrame(-1)}>◁▌</button>
        <button type="button" className="btn btn-primary portal-media-breakdown-play-button" style={{ fontSize: 12, padding: '3px 12px', minHeight: 0 }} onClick={togglePlay}>{playing ? 'Ⅱ' : '▶'}</button>
        <button type="button" className="btn btn-ghost portal-media-breakdown-step-button" style={{ fontSize: 11, padding: '2px 7px', minHeight: 0 }} onClick={() => stepFrame(1)}>▐▷</button>
        <div className="portal-media-breakdown-speed-controls" style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
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
  mediaType: 'photo' | 'video';
  onPick: (media: CompareMedia) => void;
  onCancel: () => void;
};

function ComparePicker({ players, mediaType, onPick, onCancel }: ComparePickerProps) {
  const [search, setSearch] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<{ playerId: number; fullName: string } | null>(null);
  const [media, setMedia] = useState<PlayerMediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

  const filtered = players.filter((p) => p.fullName.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (!selectedPlayer) {
      const timeoutId = window.setTimeout(() => setMedia([]), 0);
      return () => window.clearTimeout(timeoutId);
    }
    const loadingTimeoutId = window.setTimeout(() => setLoadingMedia(true), 0);
    fetch(`/api/player/media?playerId=${selectedPlayer.playerId}&mediaType=${mediaType}`, { cache: 'no-store' })
      .then(async (r) => { const payload = (await r.json().catch(() => ({}))) as { media?: PlayerMediaItem[] }; setMedia(Array.isArray(payload.media) ? payload.media : []); })
      .catch(() => setMedia([]))
      .finally(() => setLoadingMedia(false));
    return () => window.clearTimeout(loadingTimeoutId);
  }, [mediaType, selectedPlayer]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147482120, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ background: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 14, padding: 20, width: 'min(520px, 94vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 14 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h4 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>Pick comparison {mediaType}</h4>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '2px 8px', minHeight: 0 }} onClick={onCancel}>Cancel</button>
        </div>
        {!selectedPlayer ? (
          <>
            <input autoFocus placeholder="Search player..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.25)', background: 'rgba(255,255,255,0.06)', color: '#f8fafc', fontSize: 13 }} />
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '50vh' }}>
              {filtered.length === 0 && <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>No players found.</p>}
              {filtered.map((p) => (
                <button key={p.playerId} type="button" className="btn btn-ghost" style={{ textAlign: 'left', padding: '8px 12px', fontSize: 13, justifyContent: 'flex-start' }} onClick={() => setSelectedPlayer(p)}>{p.fullName}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px', minHeight: 0 }} onClick={() => setSelectedPlayer(null)}>← Back</button>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>{selectedPlayer.fullName}</span>
            </div>
            {loadingMedia && <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Loading {mediaType}s...</p>}
            {!loadingMedia && media.length === 0 && <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>No {mediaType}s uploaded for this player.</p>}
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '50vh' }}>
              {media.filter((m) => m.mediaType === mediaType).map((m) => (
                <button key={m.id} type="button" className="btn btn-ghost" style={{ textAlign: 'left', padding: '8px 12px', fontSize: 13, justifyContent: 'flex-start', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}
                  onClick={() => onPick({ playerId: selectedPlayer.playerId, playerName: selectedPlayer.fullName, mediaId: m.id, title: m.title, url: `/api/player/media/${m.id}`, mimeType: m.contentType })}>
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

export default function MediaBreakdownViewer({
  title,
  url,
  mimeType,
  downloadName,
  onClose,
  players,
  initialAnnotations,
  onSaveAnnotations,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  positionLabel,
  onDelete,
}: MediaBreakdownViewerProps) {
  const [tool, setTool] = useState<BreakdownTool>('line');
  const [drawMode, setDrawMode] = useState(false);
  const [showMobileTools, setShowMobileTools] = useState(false);
  const [color, setColor] = useState('#facc15');
  const [width, setWidth] = useState(4);
  const [textFontSize, setTextFontSize] = useState(36);
  const [showTimer, setShowTimer] = useState(false);
  const [angleMode, setAngleMode] = useState<'acute' | 'obtuse'>('acute');
  const [anglePendingCount, setAnglePendingCount] = useState(0);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [compareMode, setCompareMode] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [compareMedia, setCompareMedia] = useState<CompareMedia | null>(null);
  const [compareLayout, setCompareLayout] = useState<CompareLayout>('side-by-side');
  const [synced, setSynced] = useState(false);
  const [syncVersion, setSyncVersion] = useState(0);
  const syncRef = useRef<HTMLVideoElement | null>(null);
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'ready'>('idle');
  const [recordingUrl, setRecordingUrl] = useState('');
  const [recordingDownloadName, setRecordingDownloadName] = useState('video-breakdown.webm');
  const [recordingCommand, setRecordingCommand] = useState<RecordingCommand | null>(null);

  const isVideo = mimeType.startsWith('video/');
  const isImage = mimeType.startsWith('image/');

  useEffect(() => {
    return () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
  }, [recordingUrl]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 780px)');
    const sync = () => {
      setShowMobileTools(true);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [url]);

  useEffect(() => {
    const scrollY = window.scrollY;
    const { body, documentElement } = document;
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      touchAction: body.style.touchAction,
      overscrollBehavior: body.style.overscrollBehavior,
    };
    const previousHtmlStyles = {
      overflow: documentElement.style.overflow,
      overscrollBehavior: documentElement.style.overscrollBehavior,
    };

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    body.style.touchAction = 'none';
    body.style.overscrollBehavior = 'none';
    documentElement.style.overflow = 'hidden';
    documentElement.style.overscrollBehavior = 'none';

    return () => {
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.left = previousBodyStyles.left;
      body.style.right = previousBodyStyles.right;
      body.style.width = previousBodyStyles.width;
      body.style.overflow = previousBodyStyles.overflow;
      body.style.touchAction = previousBodyStyles.touchAction;
      body.style.overscrollBehavior = previousBodyStyles.overscrollBehavior;
      documentElement.style.overflow = previousHtmlStyles.overflow;
      documentElement.style.overscrollBehavior = previousHtmlStyles.overscrollBehavior;
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Image-mode annotation state
  const [annotations, setAnnotations] = useState<BreakdownAnnotation[]>([]);
  const [draggingImageAnnotation, setDraggingImageAnnotation] = useState<AnnotationDragState | null>(null);
  const [videoAnnotations, setVideoAnnotations] = useState<BreakdownAnnotation[]>([]);
  const [active, setActive] = useState<BreakdownAnnotation | null>(null);
  const [anglePending, setAnglePending] = useState<Array<{ x: number; y: number }>>([]);

  // Image zoom/pan
  const [imgZoom, setImgZoom] = useState(1);
  const [imgPan, setImgPan] = useState({ x: 0, y: 0 });
  const imgPanStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const imgWrapRef = useRef<HTMLDivElement | null>(null);

  const handlePickMedia = useCallback((media: CompareMedia) => { setCompareMedia(media); setShowPicker(false); }, []);
  const handleMainVideoAnnotationsChange = useCallback((next: BreakdownAnnotation[]) => {
    setVideoAnnotations(next);
    setSaveState('idle');
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const next = Array.isArray(initialAnnotations) ? initialAnnotations : [];
      setAnnotations(next);
      setVideoAnnotations(next);
      setActive(null);
      setAnglePending([]);
      setAnglePendingCount(0);
      setSaveState('idle');
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [initialAnnotations, url]);

  const saveAnnotations = async () => {
    if (!onSaveAnnotations) return;
    const savedAnnotations = isVideo ? videoAnnotations : annotations;
    setSaveState('saving');
    try {
      await onSaveAnnotations(savedAnnotations);
      setSaveState('saved');
    } catch (error) {
      console.error('[MediaBreakdownViewer] save annotations failed:', error);
      setSaveState('error');
    }
  };

  // Image pan handlers
  function onImgWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    setImgZoom((prev) => {
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
      if (next === 1) setImgPan({ x: 0, y: 0 });
      else setImgPan((p) => clampPan(p, next));
      return next;
    });
  }
  function onImgPanStart(e: React.PointerEvent<HTMLDivElement>) {
    if (drawMode || imgZoom <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    imgPanStart.current = { px: e.clientX, py: e.clientY, ox: imgPan.x, oy: imgPan.y };
  }
  function onImgPanMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!imgPanStart.current) return;
    const wrap = imgWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dx = (e.clientX - imgPanStart.current.px) / rect.width;
    const dy = (e.clientY - imgPanStart.current.py) / rect.height;
    setImgPan(clampPan({ x: imgPanStart.current.ox + dx, y: imgPanStart.current.oy + dy }, imgZoom));
  }
  function onImgPanEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    imgPanStart.current = null;
  }

  function pointerDownImage(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drawMode) return;
    event.preventDefault();
    const point = pointOnOverlay(event, imgZoom, imgPan);
    if (tool !== 'erase') {
      const nearestAnnotation = annotations
        .filter((item) => item.points.length > 0)
        .map((item) => ({ item, d: Math.min(...item.points.map((p) => Math.hypot(p.x - point.x, p.y - point.y))) }))
        .sort((a, b) => a.d - b.d)[0];
      if (nearestAnnotation && nearestAnnotation.d <= 0.08) {
        setDraggingImageAnnotation({ id: nearestAnnotation.item.id, anchor: point, points: nearestAnnotation.item.points });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
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
      setAnnotations((items) => [...items, { id: `media-${Date.now()}`, tool: 'text', color, width, points: [point], text: text.trim(), fontSize: textFontSize }]);
      setSaveState('idle');
      return;
    }
    if (tool === 'angle') {
      const next = [...anglePending, point];
      if (next.length === 3) { setAnnotations((items) => [...items, { id: `media-${Date.now()}`, tool: 'angle', color, width, points: next, angleMode }]); setAnglePending([]); setAnglePendingCount(0); setSaveState('idle'); }
      else { setAnglePending(next); setAnglePendingCount(next.length); }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setActive({ id: `media-${Date.now()}-${Math.random().toString(16).slice(2)}`, tool, color, width, points: [point, point] });
  }

  function pointerMoveImage(event: ReactPointerEvent<SVGSVGElement>) {
    if (draggingImageAnnotation) {
      event.preventDefault();
      const point = pointOnOverlay(event, imgZoom, imgPan);
      const nextPoints = moveAnnotationPoints(draggingImageAnnotation, point);
      setAnnotations((items) => items.map((item) => (item.id === draggingImageAnnotation.id ? { ...item, points: nextPoints } : item)));
      setSaveState('idle');
      return;
    }
    if (!active) return;
    event.preventDefault();
    const point = pointOnOverlay(event, imgZoom, imgPan);
    setActive((current) => {
      if (!current) return current;
      if (current.tool === 'pen') return { ...current, points: [...current.points, point] };
      return { ...current, points: [current.points[0], point] };
    });
  }

  function finishImage(event?: ReactPointerEvent<SVGSVGElement>) {
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (draggingImageAnnotation) {
      setDraggingImageAnnotation(null);
      setSaveState('idle');
      return;
    }
    if (!active) return;
    setAnnotations((items) => [...items, active]);
    setSaveState('idle');
    setActive(null);
  }

  const allImageAnnotations = [...annotations, ...(active ? [active] : []), ...(anglePending.length > 0 ? [{ id: 'angle-preview', tool: 'angle' as const, color, width, points: anglePending, angleMode }] : [])];
  const cycleColor = () => {
    const currentIndex = DRAWING_COLOR_SWATCHES.findIndex((swatch) => swatch.toLowerCase() === color.toLowerCase());
    setColor(DRAWING_COLOR_SWATCHES[(currentIndex + 1) % DRAWING_COLOR_SWATCHES.length]);
  };
  const cycleWidth = () => {
    const next = DRAWING_WIDTH_STEPS.find((step) => step > width) ?? DRAWING_WIDTH_STEPS[0];
    setWidth(next);
  };
  const cycleTextSize = () => {
    const next = TEXT_SIZE_STEPS.find((step) => step > textFontSize) ?? TEXT_SIZE_STEPS[0];
    setTextFontSize(next);
  };
  const startRecording = () => {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl('');
    setRecordingState('recording');
    setRecordingCommand({ id: Date.now(), action: 'start' });
  };
  const stopRecording = () => {
    setRecordingCommand({ id: Date.now(), action: 'stop' });
  };

  const toolbar = (isVideo || isImage) && showMobileTools ? (
    <div
      className="portal-media-breakdown-toolbar is-open"
      style={{ ...glassPanelStyle, display: 'grid', gap: 8, padding: 8, borderRadius: 14, flexShrink: 0 }}
    >
      <div className="portal-media-breakdown-tool-row" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Collapse tools"
          title="Collapse tools"
          style={{ ...compactIconButtonStyle, fontSize: 20 }}
          onClick={() => setShowMobileTools(false)}
        >
          ×
        </button>
        <button
          type="button"
          className={!drawMode ? 'btn btn-primary' : 'btn btn-ghost'}
          aria-label="View and pan"
          title="View and pan"
          style={compactIconButtonStyle}
          onClick={() => { setDrawMode(false); setAnglePending([]); setAnglePendingCount(0); }}
        >
          {TOOL_ICONS.view}
        </button>
        {isVideo ? (
          <button
            type="button"
            className={showTimer ? 'btn btn-primary portal-media-breakdown-timer-tool' : 'btn btn-ghost portal-media-breakdown-timer-tool'}
            aria-label="Show timer"
            title={showTimer ? 'Hide timer' : 'Show timer'}
            style={compactIconButtonStyle}
            onClick={() => setShowTimer((current) => !current)}
          >
            ⏱
          </button>
        ) : null}
        {isVideo ? (
          <button
            type="button"
            className={recordingState === 'recording' ? 'btn btn-primary portal-media-breakdown-record-tool is-recording' : 'btn btn-ghost portal-media-breakdown-record-tool'}
            aria-label={recordingState === 'recording' ? 'Stop recording' : 'Record breakdown'}
            title={recordingState === 'recording' ? 'Stop recording' : 'Record breakdown'}
            style={compactIconButtonStyle}
            onClick={() => {
              if (recordingState === 'recording') {
                stopRecording();
              } else {
                void startRecording();
              }
            }}
          >
            <span />
          </button>
        ) : null}
        {recordingUrl ? (
          <a
            className="btn btn-ghost portal-media-breakdown-record-download"
            href={recordingUrl}
            download={recordingDownloadName}
            title="Download recording"
            style={compactIconButtonStyle}
          >
            ↓
          </a>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost portal-media-breakdown-color-tool"
          aria-label="Change drawing color"
          title="Color"
          style={compactIconButtonStyle}
          onClick={cycleColor}
        >
          <span className="portal-media-breakdown-color-tool-dot" style={{ background: color }} />
        </button>
        <button
          type="button"
          className="btn btn-ghost portal-media-breakdown-width-tool"
          aria-label="Change drawing width"
          title={`Width ${width}`}
          style={compactIconButtonStyle}
          onClick={cycleWidth}
        >
          <span style={{ width: Math.max(12, width + 8), height: Math.max(12, width + 8), borderWidth: Math.max(2, Math.min(5, width / 2)) }} />
        </button>
        {drawMode && tool === 'angle' ? (
          <button
            type="button"
            className={angleMode === 'obtuse' ? 'btn btn-primary portal-media-breakdown-mode-tool' : 'btn btn-ghost portal-media-breakdown-mode-tool'}
            aria-label="Toggle angle mode"
            title={angleMode === 'acute' ? 'Angle: acute' : 'Angle: obtuse'}
            style={compactIconButtonStyle}
            onClick={() => setAngleMode((current) => (current === 'acute' ? 'obtuse' : 'acute'))}
          >
            <span>{angleMode === 'acute' ? 'Ac' : 'Ob'}</span>
          </button>
        ) : null}
        {drawMode && tool === 'text' ? (
          <button
            type="button"
            className="btn btn-ghost portal-media-breakdown-mode-tool"
            aria-label="Change text size"
            title={`Font ${textFontSize}`}
            style={compactIconButtonStyle}
            onClick={cycleTextSize}
          >
            <span>{textFontSize}</span>
          </button>
        ) : null}
        {TOOL_ORDER.map((entry) => (
          <button
            key={entry}
            type="button"
            className={drawMode && tool === entry ? 'btn btn-primary' : 'btn btn-ghost'}
            aria-label={TOOL_LABELS[entry]}
            title={entry === 'angle' && anglePendingCount > 0 ? `${TOOL_LABELS[entry]} (${anglePendingCount}/3)` : TOOL_LABELS[entry]}
            style={compactIconButtonStyle}
            onClick={() => { setDrawMode(true); setTool(entry); setAnglePending([]); setAnglePendingCount(0); }}
          >
            {TOOL_ICONS[entry]}
          </button>
        ))}
        {!isVideo ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ ...compactIconButtonStyle, fontSize: 11, fontWeight: 900 }}
              onClick={() => { setAnnotations((items) => items.slice(0, -1)); setAnglePending([]); setAnglePendingCount(0); setSaveState('idle'); }}
              disabled={!annotations.length}
              title="Undo"
            >
              Undo
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ ...compactIconButtonStyle, fontSize: 11, fontWeight: 900 }}
              onClick={() => { setAnnotations([]); setAnglePending([]); setAnglePendingCount(0); setSaveState('idle'); }}
              disabled={!annotations.length}
              title="Clear"
            >
              Clear
            </button>
          </>
        ) : null}
        {onSaveAnnotations ? (
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '0 12px', minHeight: 36, borderRadius: 10, fontWeight: 900 }}
            onClick={() => void saveAnnotations()}
            disabled={saveState === 'saving'}
          >
            {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : 'Save'}
          </button>
        ) : null}
        {saveState === 'error' ? <span style={{ color: '#fca5a5', fontSize: 11, fontWeight: 800 }}>Save failed</span> : null}
      </div>
    </div>
  ) : null;

  const imgZoomed = imgZoom > 1;
  const compareType: 'photo' | 'video' = isImage ? 'photo' : 'video';
  const imagePanel = (
    <div
      ref={imgWrapRef}
      className="portal-media-breakdown-image-wrap"
      style={{ position: 'relative', marginTop: 4, borderRadius: 10, overflow: 'hidden', background: '#000', cursor: imgZoomed && !drawMode ? 'grab' : drawMode ? 'crosshair' : 'default' }}
      onWheel={onImgWheel}
      onPointerDown={onImgPanStart}
      onPointerMove={onImgPanMove}
      onPointerUp={onImgPanEnd}
      onPointerCancel={onImgPanEnd}
    >
      <div className="portal-media-breakdown-stage-inner" style={{ transform: imgZoomed ? `translate(${imgPan.x * 100}%, ${imgPan.y * 100}%) scale(${imgZoom})` : undefined, transformOrigin: '50% 50%', willChange: imgZoomed ? 'transform' : undefined }}>
        <img className="portal-media-breakdown-image" src={url} alt={title} style={{ width: '100%', maxHeight: compareMode && compareMedia ? '58vh' : '68vh', objectFit: 'contain', display: 'block', pointerEvents: 'none' }} />
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

      <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 3, zIndex: 10 }}>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 14, padding: '1px 8px', minHeight: 0, background: 'rgba(2,6,23,0.85)', lineHeight: 1.4, fontWeight: 700 }} onClick={(e) => { e.stopPropagation(); setImgZoom((z) => { const n = Math.min(ZOOM_MAX, z + ZOOM_STEP); setImgPan((p) => clampPan(p, n)); return n; }); }} title="Zoom in">+</button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 14, padding: '1px 8px', minHeight: 0, background: 'rgba(2,6,23,0.85)', lineHeight: 1.4, fontWeight: 700 }} onClick={(e) => { e.stopPropagation(); setImgZoom((z) => { const n = Math.max(ZOOM_MIN, z - ZOOM_STEP); if (n === 1) setImgPan({ x: 0, y: 0 }); else setImgPan((p) => clampPan(p, n)); return n; }); }} title="Zoom out">−</button>
        {imgZoomed && (
          <button type="button" className="btn btn-ghost" style={{ fontSize: 10, padding: '1px 7px', minHeight: 0, background: 'rgba(2,6,23,0.85)', fontWeight: 700 }} onClick={(e) => { e.stopPropagation(); setImgZoom(1); setImgPan({ x: 0, y: 0 }); }} title="Reset zoom">{Math.round(imgZoom * 10) / 10}× ✕</button>
        )}
      </div>
    </div>
  );

  return (
    <div className="portal-modal-backdrop portal-media-breakdown-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className={`portal-modal-panel portal-media-breakdown-modal${isVideo ? ' portal-media-breakdown-modal--video' : ''}${isImage ? ' portal-media-breakdown-modal--image' : ''}`}
        style={{ width: compareMode ? 'min(1600px, 98vw)' : 'min(1180px, 96vw)', maxHeight: '98vh', background: '#020617', color: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 10, transition: 'width 0.2s ease' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="portal-video-mobile-close" aria-label="Close media viewer" onClick={onClose}>×</button>
        {(isVideo || isImage) ? (
          <div className="portal-media-breakdown-mobile-topbar" data-breakdown-ui="true">
            <button type="button" className="portal-media-breakdown-mobile-icon" aria-label="Close media viewer" onClick={onClose}>×</button>
            <button type="button" className="portal-media-breakdown-mobile-icon portal-media-breakdown-mobile-save" aria-label="Save markup" onClick={() => void saveAnnotations()} disabled={!onSaveAnnotations || saveState === 'saving'}>{saveState === 'saved' ? '✓' : 'Save'}</button>
            <button
              type="button"
              className={compareMode ? 'portal-media-breakdown-mobile-icon is-active' : 'portal-media-breakdown-mobile-icon'}
              aria-label="Compare"
              onClick={() => { if (compareMode) { setCompareMode(false); setCompareMedia(null); setSynced(false); setCompareLayout('side-by-side'); } else if (players && players.length > 0) { setCompareMode(true); setShowPicker(true); } }}
              disabled={!players || players.length === 0}
            >
              ▭▶
            </button>
          </div>
        ) : null}
        {(isVideo || isImage) && !showMobileTools ? (
          <button
            type="button"
            className="portal-media-breakdown-show-tools"
            data-breakdown-ui="true"
            aria-label="Show toolbar"
            title="Show toolbar"
            onClick={() => setShowMobileTools(true)}
          >
            ✥
          </button>
        ) : null}
        {/* Header */}
        <div className="portal-row-between portal-media-breakdown-header" style={{ gap: 10, flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h3>
          <div className="portal-media-breakdown-actions" style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {positionLabel ? <span style={{ alignSelf: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 800 }}>{positionLabel}</span> : null}
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }} onClick={onPrevious} disabled={!hasPrevious}>Previous</button>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }} onClick={onNext} disabled={!hasNext}>Next</button>
            {(isVideo || isImage) && players && players.length > 0 && (
              <button type="button" className={compareMode ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }}
                onClick={() => { if (compareMode) { setCompareMode(false); setCompareMedia(null); setSynced(false); setCompareLayout('side-by-side'); } else { setCompareMode(true); setShowPicker(true); } }}>
                {compareMode ? 'Exit Compare' : 'Compare'}
              </button>
            )}
            {compareMode && compareMedia && (
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }} onClick={() => setShowPicker(true)}>Swap {compareType === 'photo' ? 'Photo' : 'Video'}</button>
            )}
            {isVideo && compareMode && compareMedia && (
              <button type="button" className={synced ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }} onClick={() => setSynced((v) => !v)}>
                {synced ? 'Synced ✓' : 'Sync'}
              </button>
            )}
            <a className="btn btn-ghost" href={url} download={downloadName || title} style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }}>Download</a>
            {onDelete ? (
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px', minHeight: 0, color: '#fca5a5' }} onClick={onDelete}>Delete</button>
            ) : null}
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px', minHeight: 0 }} onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Toolbar */}
        {toolbar}

        {isVideo && compareMode && compareMedia ? (
          <div className="portal-media-breakdown-compare-controls" data-breakdown-ui="true">
            <button type="button" className="btn btn-ghost" onClick={() => setShowPicker(true)}>Swap</button>
            <button type="button" className={compareLayout === 'side-by-side' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setCompareLayout('side-by-side')}>Side</button>
            <button type="button" className={compareLayout === 'stacked' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setCompareLayout('stacked')}>Stack</button>
            <button type="button" className={compareLayout === 'overlay' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setCompareLayout('overlay')}>Overlay</button>
            <button
              type="button"
              className={synced ? 'btn btn-primary' : 'btn btn-ghost'}
              onClick={() => {
                setSynced((current) => {
                  const next = !current;
                  if (next) setSyncVersion((value) => value + 1);
                  return next;
                });
              }}
            >
              {synced ? 'Synced' : 'Sync'}
            </button>
          </div>
        ) : null}

        {/* Media area */}
        {isVideo && compareMode && compareMedia ? (
          <div className={`portal-media-breakdown-compare-grid portal-media-breakdown-compare-grid--${compareLayout}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
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
              syncRole="leader"
              syncVersion={syncVersion}
              compact
              initialAnnotations={initialAnnotations}
              onAnnotationsChange={handleMainVideoAnnotationsChange}
              textFontSize={textFontSize}
              showTimer={showTimer}
              recordingCommand={recordingCommand}
              onRecordingStarted={() => setRecordingState('recording')}
              onRecordingReady={(nextUrl, nextName) => {
                if (recordingUrl) URL.revokeObjectURL(recordingUrl);
                setRecordingUrl(nextUrl);
                setRecordingDownloadName(nextName);
                setRecordingState('ready');
              }}
              onRecordingError={() => setRecordingState('idle')}
            />
            <VideoPanel url={compareMedia.url} title={`${compareMedia.playerName} - ${compareMedia.title}`} tool={tool} drawMode={drawMode} color={color} width={width} angleMode={angleMode} synced={synced} syncRef={syncRef} syncRole="follower" syncVersion={syncVersion} compact textFontSize={textFontSize} showTimer={showTimer} />
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
            initialAnnotations={initialAnnotations}
            onAnnotationsChange={handleMainVideoAnnotationsChange}
            textFontSize={textFontSize}
            showTimer={showTimer}
            recordingCommand={recordingCommand}
            onRecordingStarted={() => setRecordingState('recording')}
            onRecordingReady={(nextUrl, nextName) => {
              if (recordingUrl) URL.revokeObjectURL(recordingUrl);
              setRecordingUrl(nextUrl);
              setRecordingDownloadName(nextName);
              setRecordingState('ready');
            }}
            onRecordingError={() => setRecordingState('idle')}
          />
        ) : isImage && compareMode && compareMedia ? (
          <div className="portal-media-breakdown-compare-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
            <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{title}</div>
              {imagePanel}
            </div>
            <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{compareMedia.playerName} - {compareMedia.title}</div>
              <div style={{ borderRadius: 10, overflow: 'hidden', background: '#000' }}>
                <img src={compareMedia.url} alt={`${compareMedia.playerName} - ${compareMedia.title}`} style={{ width: '100%', maxHeight: '58vh', objectFit: 'contain', display: 'block' }} />
              </div>
            </div>
          </div>
        ) : isImage ? (
          imagePanel
        ) : (
          <iframe title={title} src={url} style={{ width: '100%', height: '68vh', border: 0 }} />
        )}
      </div>

      {showPicker && players && (
        <ComparePicker players={players} mediaType={compareType} onPick={handlePickMedia} onCancel={() => { setShowPicker(false); if (!compareMedia) setCompareMode(false); }} />
      )}
    </div>
  );
}

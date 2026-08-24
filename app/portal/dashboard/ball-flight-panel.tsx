'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import styles from './ball-flight-panel.module.css';
import SpinDesignerPanel from './spin-designer-panel';
import SpinVisualPanel, { type SpinSample } from './spin-visual-panel';

type CameraView = 'pitcher' | 'batter';
type CameraMode = CameraView | 'custom';
type CameraOrbit = { preset: CameraView; yaw: number; pitch: number; zoom: number };
type BallFlightTab = 'flight' | 'spin' | 'spin-test';

type FlightPitch = {
  pitchType: string;
  pitchCount: number;
  firstDate: string | null;
  lastDate: string | null;
  velocity: number | null;
  spinRate: number | null;
  inducedVerticalBreak: number | null;
  horizontalBreak: number | null;
  releaseHeight: number | null;
  releaseSide: number | null;
  extension: number | null;
  plateHeight: number | null;
  plateSide: number | null;
  flightTime: number | null;
  x0: number | null;
  y0: number | null;
  z0: number | null;
  vx0: number | null;
  vy0: number | null;
  vz0: number | null;
  ax0: number | null;
  ay0: number | null;
  az0: number | null;
};

type IndividualPitch = {
  pitchType: string;
  pitchUid: string | null;
  sessionDate: string | null;
  pitcher: string | null;
  velocity: number | null;
  inducedVerticalBreak: number | null;
  horizontalBreak: number | null;
  releaseHeight: number | null;
  releaseSide: number | null;
  extension: number | null;
  plateHeight: number | null;
  plateSide: number | null;
  flightTime: number | null;
  x0: number | null;
  y0: number | null;
  z0: number | null;
  vx0: number | null;
  vy0: number | null;
  vz0: number | null;
  ax0: number | null;
  ay0: number | null;
  az0: number | null;
};

type FlightPayload = {
  schoolCode: string;
  dataPolicy: 'measured-only';
  rolloutDate: string;
  backfillWindowDays: number;
  availableDateRange?: { firstDate: string | null; lastDate: string | null } | null;
  pitches: FlightPitch[];
  spinSamples?: SpinSample[];
  individualPitches?: IndividualPitch[];
  error?: string;
};

function individualPitchToFlightPitch(pitch: IndividualPitch): FlightPitch {
  return {
    pitchType: pitch.pitchType,
    pitchCount: 1,
    firstDate: pitch.sessionDate,
    lastDate: pitch.sessionDate,
    velocity: pitch.velocity,
    spinRate: null,
    inducedVerticalBreak: pitch.inducedVerticalBreak,
    horizontalBreak: pitch.horizontalBreak,
    releaseHeight: pitch.releaseHeight,
    releaseSide: pitch.releaseSide,
    extension: pitch.extension,
    plateHeight: pitch.plateHeight,
    plateSide: pitch.plateSide,
    flightTime: pitch.flightTime,
    x0: pitch.x0,
    y0: pitch.y0,
    z0: pitch.z0,
    vx0: pitch.vx0,
    vy0: pitch.vy0,
    vz0: pitch.vz0,
    ax0: pitch.ax0,
    ay0: pitch.ay0,
    az0: pitch.az0,
  };
}

function individualPitchLabel(pitch: IndividualPitch): string {
  const date = pitch.sessionDate ? displayDate(pitch.sessionDate) : 'Date unavailable';
  const pitcher = pitch.pitcher ?? 'Unknown pitcher';
  const velo = pitch.velocity !== null ? `${pitch.velocity.toFixed(1)} mph` : '— mph';
  const ivb = pitch.inducedVerticalBreak !== null ? `${pitch.inducedVerticalBreak > 0 ? '+' : ''}${pitch.inducedVerticalBreak.toFixed(1)}" IVB` : '— IVB';
  const hb = pitch.horizontalBreak !== null ? `${pitch.horizontalBreak > 0 ? '+' : ''}${pitch.horizontalBreak.toFixed(1)}" HB` : '— HB';
  return `${date} · ${pitcher} · ${velo} · ${ivb} · ${hb}`;
}

type Point3 = { x: number; y: number; z: number };
type Point2 = { x: number; y: number; depth: number };

const CAMERA_PRESETS: Record<CameraView, { camera: Point3; target: Point3; focalScale: number; defaultZoom: number }> = {
  pitcher: { camera: { x: 0, y: 68, z: 8.2 }, target: { x: 0, y: 7, z: 2.8 }, focalScale: 1.02, defaultZoom: 1 },
  // Catcher view sits at squatting eye height, a bit closer behind the
  // plate than a standing batter's-eye view.
  batter: { camera: { x: 0, y: -8, z: 3.4 }, target: { x: 0, y: 50, z: 3.5 }, focalScale: 1.0, defaultZoom: 1 },
};

const freshCamera = (preset: CameraView): CameraOrbit => ({ preset, yaw: 0, pitch: 0, zoom: CAMERA_PRESETS[preset].defaultZoom });
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const PITCH_COLORS: Record<string, string> = {
  Fastball: 'var(--portal-fastball-color)',
  Sinker: 'orange',
  Cutter: 'brown',
  Slider: 'red',
  Sweeper: 'purple',
  Curveball: 'blue',
  ChangeUp: 'darkgreen',
  Splitter: 'turquoise',
  Knuckleball: 'darkblue',
  Undefined: '#9ca3af',
};

function colorForPitch(type: string): string {
  return PITCH_COLORS[type] ?? PITCH_COLORS.Undefined;
}

function canvasColorForPitch(type: string): string {
  const color = colorForPitch(type);
  if (!color.includes('--portal-fastball-color') || typeof document === 'undefined') return color;
  return getComputedStyle(document.body).getPropertyValue('--portal-fastball-color').trim() || '#ffffff';
}

function fmt(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function displayDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function solveYTime(y0: number, vy0: number, ay0: number, targetY: number): number | null {
  const c = y0 - targetY;
  if (Math.abs(ay0) < 1e-8) {
    const t = -c / vy0;
    return Number.isFinite(t) ? t : null;
  }
  const disc = (vy0 * vy0) - (2 * ay0 * c);
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const candidates = [(-vy0 + root) / ay0, (-vy0 - root) / ay0].filter(Number.isFinite);
  const positive = candidates.filter((value) => value > 0).sort((a, b) => a - b);
  return positive[0] ?? null;
}

function durationForPitch(pitch: FlightPitch): number {
  if (pitch.flightTime !== null && pitch.flightTime >= 0.2 && pitch.flightTime <= 0.9) return pitch.flightTime;
  const y0 = pitch.y0 ?? 50;
  const vy0 = pitch.vy0;
  const ay0 = pitch.ay0;
  if (vy0 !== null && ay0 !== null) {
    const time = solveYTime(y0, vy0, ay0, 17 / 12);
    if (time !== null && time >= 0.2 && time <= 0.9) return time;
  }
  return 0;
}

function flightPoint(pitch: FlightPitch, elapsed: number): Point3 {
  const duration = Math.max(0.001, durationForPitch(pitch));
  const u = Math.max(0, Math.min(1, elapsed / duration));
  const startY = 60.5 - (pitch.extension ?? 6);
  const startX = pitch.releaseSide ?? pitch.x0 ?? 0;
  const startZ = pitch.releaseHeight ?? pitch.z0 ?? 5.8;
  const endX = pitch.plateSide ?? 0;
  const endZ = pitch.plateHeight ?? 2.55;
  // Retain measured acceleration curvature while pinning the averaged path to
  // its measured average release and plate coordinates.
  // TrackMan's trajectory x-axis is the inverse of RelSide/PlateLocSide.
  const curveX = -0.5 * (pitch.ax0 ?? 0) * duration * duration * u * (u - 1);
  const curveZ = 0.5 * (pitch.az0 ?? 0) * duration * duration * u * (u - 1);
  return {
    x: startX + ((endX - startX) * u) + curveX,
    y: startY + (((17 / 12) - startY) * u),
    z: startZ + ((endZ - startZ) * u) + curveZ,
  };
}

function subtract(a: Point3, b: Point3): Point3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Point3, b: Point3): number {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function cross(a: Point3, b: Point3): Point3 {
  return { x: (a.y * b.z) - (a.z * b.y), y: (a.z * b.x) - (a.x * b.z), z: (a.x * b.y) - (a.y * b.x) };
}

function normalize(value: Point3): Point3 {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function projector(orbit: CameraOrbit, width: number, height: number) {
  const preset = CAMERA_PRESETS[orbit.preset];
  const baseOffset = subtract(preset.camera, preset.target);
  const baseRadius = Math.hypot(baseOffset.x, baseOffset.y, baseOffset.z);
  const baseYaw = Math.atan2(baseOffset.y, baseOffset.x);
  const basePitch = Math.atan2(baseOffset.z, Math.hypot(baseOffset.x, baseOffset.y));
  const yaw = baseYaw + orbit.yaw;
  const pitch = clamp(basePitch + orbit.pitch, -1.35, 1.35);
  const radius = baseRadius * clamp(orbit.zoom, 0.5, 1.9);
  const horizontalRadius = Math.cos(pitch) * radius;
  const target = preset.target;
  const camera = {
    x: target.x + (Math.cos(yaw) * horizontalRadius),
    y: target.y + (Math.sin(yaw) * horizontalRadius),
    z: target.z + (Math.sin(pitch) * radius),
  };
  const forward = normalize(subtract(target, camera));
  // TrackMan reports a positive lateral release for right-handed pitchers.
  // Flip the camera's screen-right basis so an RHP appears on the viewer's
  // right from behind the mound and on the viewer's left from the batter box.
  const right = normalize(cross({ x: 0, y: 0, z: 1 }, forward));
  const up = normalize(cross(forward, right));
  const focal = Math.min(width, height) * preset.focalScale;
  return (point: Point3): Point2 | null => {
    const relative = subtract(point, camera);
    const depth = dot(relative, forward);
    if (depth <= 0.15) return null;
    return {
      x: (width / 2) + ((dot(relative, right) / depth) * focal),
      y: (height * 0.48) - ((dot(relative, up) / depth) * focal),
      depth,
    };
  };
}

function line3(ctx: CanvasRenderingContext2D, project: ReturnType<typeof projector>, points: Point3[], stroke: string, width: number, dash: number[] = []) {
  ctx.beginPath();
  let hasPoint = false;
  for (const point of points) {
    const p = project(point);
    if (!p) continue;
    if (!hasPoint) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
    hasPoint = true;
  }
  ctx.setLineDash(dash);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawScene(canvas: HTMLCanvasElement, pitches: FlightPitch[], elapsed: number, camera: CameraOrbit) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
  const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width;
  const height = rect.height;
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#0c0c0c');
  bg.addColorStop(0.5, '#121212');
  bg.addColorStop(1, '#0b0b0b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const project = projector(camera, width, height);
  const laneLeft = Array.from({ length: 13 }, (_, index) => ({ x: -3.15, y: index * 5, z: 0 }));
  const laneRight = laneLeft.map((point) => ({ ...point, x: 3.15 }));
  line3(ctx, project, laneLeft, 'rgba(255,255,255,0.18)', 1);
  line3(ctx, project, laneRight, 'rgba(255,255,255,0.18)', 1);
  for (let y = 5; y <= 60; y += 5) {
    line3(ctx, project, [{ x: -3.15, y, z: 0 }, { x: 3.15, y, z: 0 }], 'rgba(255,255,255,0.055)', 1);
  }

  // The 17-inch edge faces the mound; the point faces the catcher.
  const plate = [
    { x: -0.708, y: 17 / 12, z: 0.03 }, { x: 0.708, y: 17 / 12, z: 0.03 },
    { x: 0.708, y: 17 / 24, z: 0.03 }, { x: 0, y: 0, z: 0.03 },
    { x: -0.708, y: 17 / 24, z: 0.03 }, { x: -0.708, y: 17 / 12, z: 0.03 },
  ];
  line3(ctx, project, plate, 'rgba(255,255,255,0.84)', 2);
  const mound = Array.from({ length: 25 }, (_, index) => {
    const theta = (index / 24) * Math.PI * 2;
    return { x: Math.cos(theta) * 4.5, y: 60.5 + (Math.sin(theta) * 2.2), z: 0.12 };
  });
  line3(ctx, project, mound, 'rgba(206,170,111,0.42)', 1.3);
  line3(ctx, project, [{ x: -1, y: 60.5, z: 0.17 }, { x: 1, y: 60.5, z: 0.17 }], 'rgba(255,255,255,0.85)', 3);

  const zone = [
    { x: -0.88, y: 17 / 12, z: 1.5 }, { x: 0.88, y: 17 / 12, z: 1.5 },
    { x: 0.88, y: 17 / 12, z: 3.6 }, { x: -0.88, y: 17 / 12, z: 3.6 }, { x: -0.88, y: 17 / 12, z: 1.5 },
  ];
  line3(ctx, project, zone, 'rgba(255,255,255,0.56)', 1.5);
  for (const fraction of [1 / 3, 2 / 3]) {
    const x = -0.88 + (1.76 * fraction);
    const z = 1.5 + (2.1 * fraction);
    line3(ctx, project, [{ x, y: 17 / 12, z: 1.5 }, { x, y: 17 / 12, z: 3.6 }], 'rgba(255,255,255,0.18)', 1);
    line3(ctx, project, [{ x: -0.88, y: 17 / 12, z }, { x: 0.88, y: 17 / 12, z }], 'rgba(255,255,255,0.18)', 1);
  }

  const sorted = [...pitches].sort((a, b) => {
    const pa = project(flightPoint(a, elapsed));
    const pb = project(flightPoint(b, elapsed));
    return (pb?.depth ?? 0) - (pa?.depth ?? 0);
  });
  for (const pitch of sorted) {
    const duration = durationForPitch(pitch);
    if (!duration) continue;
    const color = canvasColorForPitch(pitch.pitchType);
    const allPath = Array.from({ length: 51 }, (_, index) => flightPoint(pitch, duration * index / 50));
    ctx.save();
    ctx.globalAlpha = 0.24;
    line3(ctx, project, allPath, color, 1.5, [4, 5]);
    ctx.restore();
    const visibleSteps = Math.max(1, Math.round(50 * Math.min(1, elapsed / duration)));
    line3(ctx, project, allPath.slice(0, visibleSteps + 1), color, 2.5);
    const position = project(flightPoint(pitch, elapsed));
    if (!position) continue;
    const radius = 9;
    ctx.save();
    // A colored shadowColor glow reads as a different SIZE per pitch type --
    // a white glow (Fastball) bleeds much more visibly against the black
    // background than a dim color like red or turquoise at the identical
    // shadowBlur, making same-radius dots look mismatched in size. Using a
    // fixed neutral white glow for every dot keeps the halo's brightness (and
    // so its apparent size) consistent; the pitch color still shows in the
    // outer stroke ring.
    ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#fffdf0';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

export default function BallFlightPanel({ queryString }: { queryString: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<CameraOrbit>(freshCamera('batter'));
  const dragRef = useRef<{ pointerId: number; x: number; y: number; yaw: number; pitch: number } | null>(null);
  const elapsedRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const clockUpdateRef = useRef(0);
  const [payload, setPayload] = useState<FlightPayload | null>(null);
  const [activeTab, setActiveTab] = useState<BallFlightTab>('flight');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cameraMode, setCameraMode] = useState<CameraMode>('batter');
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  // Empty/absent entry for a pitch type means "use the filtered average";
  // one or more pitchUids means the user picked specific measured pitches to
  // overlay instead -- each checked pitch gets its own dot/trail in the
  // scene, all sharing that type's color (see activePitches below).
  const [selectedPitchUidsByType, setSelectedPitchUidsByType] = useState<Map<string, Set<string>>>(new Map());

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError('');
    });
    fetch(`/api/dashboard/pitching/ball-flight?${queryString}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as FlightPayload;
        if (!response.ok) throw new Error(data.error || 'Unable to load measured ball-flight data.');
        return data;
      })
      .then((data) => {
        setPayload(data);
        setSelectedTypes(new Set(data.pitches.map((pitch) => pitch.pitchType)));
        setSelectedPitchUidsByType(new Map());
        elapsedRef.current = 0;
        setDisplayTime(0);
        setIsPlaying(false);
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setError(requestError instanceof Error ? requestError.message : 'Unable to load measured ball-flight data.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [queryString]);

  const individualPitchesByType = useMemo(() => {
    const map = new Map<string, IndividualPitch[]>();
    for (const pitch of payload?.individualPitches ?? []) {
      const list = map.get(pitch.pitchType) ?? [];
      list.push(pitch);
      map.set(pitch.pitchType, list);
    }
    return map;
  }, [payload?.individualPitches]);

  const activePitches = useMemo(
    () => (payload?.pitches ?? [])
      .filter((pitch) => selectedTypes.has(pitch.pitchType))
      .flatMap((pitch): FlightPitch[] => {
        const selectedUids = selectedPitchUidsByType.get(pitch.pitchType);
        if (!selectedUids || !selectedUids.size) return [pitch];
        const candidates = individualPitchesByType.get(pitch.pitchType) ?? [];
        return candidates
          .filter((candidate) => candidate.pitchUid !== null && selectedUids.has(candidate.pitchUid))
          .map(individualPitchToFlightPitch);
      })
      .filter((pitch) => durationForPitch(pitch) > 0),
    [payload?.pitches, selectedTypes, selectedPitchUidsByType, individualPitchesByType]
  );
  const maxDuration = useMemo(() => Math.max(0, ...activePitches.map(durationForPitch)), [activePitches]);

  useEffect(() => {
    if (activeTab !== 'flight') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frameId = 0;
    const render = (timestamp: number) => {
      if (isPlaying) {
        const previous = lastFrameRef.current ?? timestamp;
        elapsedRef.current = Math.min(maxDuration, elapsedRef.current + (((timestamp - previous) / 1000) * speed));
        if (timestamp - clockUpdateRef.current > 70) {
          clockUpdateRef.current = timestamp;
          setDisplayTime(elapsedRef.current);
        }
        if (elapsedRef.current >= maxDuration) {
          setIsPlaying(false);
          setDisplayTime(maxDuration);
        }
      }
      lastFrameRef.current = timestamp;
      drawScene(canvas, activePitches, elapsedRef.current, cameraRef.current);
      frameId = window.requestAnimationFrame(render);
    };
    frameId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frameId);
  }, [activePitches, activeTab, isPlaying, maxDuration, speed]);

  const resetCamera = (preset: CameraView) => {
    cameraRef.current = freshCamera(preset);
    dragRef.current = null;
    setCameraMode(preset);
  };

  const markCameraCustom = () => setCameraMode((current) => current === 'custom' ? current : 'custom');

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: cameraRef.current.yaw,
      pitch: cameraRef.current.pitch,
    };
    event.currentTarget.focus({ preventScroll: true });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    cameraRef.current = {
      ...cameraRef.current,
      yaw: drag.yaw - ((event.clientX - drag.x) * 0.008),
      pitch: clamp(drag.pitch + ((event.clientY - drag.y) * 0.006), -1.2, 1.2),
    };
    markCameraCustom();
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    cameraRef.current = {
      ...cameraRef.current,
      zoom: clamp(cameraRef.current.zoom * Math.exp(event.deltaY * 0.0012), 0.5, 1.9),
    };
    markCameraCustom();
  };

  const handleCameraKey = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    const step = event.shiftKey ? 0.16 : 0.07;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') {
      resetCamera(cameraRef.current.preset);
      return;
    }
    cameraRef.current = {
      ...cameraRef.current,
      yaw: cameraRef.current.yaw + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
      pitch: clamp(cameraRef.current.pitch + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), -1.2, 1.2),
      zoom: clamp(cameraRef.current.zoom * (event.key === '+' || event.key === '=' ? 0.9 : event.key === '-' || event.key === '_' ? 1.1 : 1), 0.5, 1.9),
    };
    markCameraCustom();
  };

  const reset = () => {
    elapsedRef.current = 0;
    lastFrameRef.current = null;
    setDisplayTime(0);
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (!activePitches.length) return;
    if (elapsedRef.current >= maxDuration) {
      elapsedRef.current = 0;
      setDisplayTime(0);
    }
    lastFrameRef.current = null;
    setIsPlaying((current) => !current);
  };

  const togglePitchType = (pitchType: string) => {
    setSelectedTypes((current) => {
      const next = new Set(current);
      if (next.has(pitchType)) next.delete(pitchType);
      else next.add(pitchType);
      return next;
    });
    reset();
  };

  const togglePitchUidForType = (pitchType: string, pitchUid: string) => {
    setSelectedPitchUidsByType((current) => {
      const next = new Map(current);
      const set = new Set(next.get(pitchType) ?? []);
      if (set.has(pitchUid)) set.delete(pitchUid);
      else set.add(pitchUid);
      if (set.size) next.set(pitchType, set);
      else next.delete(pitchType);
      return next;
    });
    reset();
  };

  const setAllPitchUidsForType = (pitchType: string, selectAll: boolean) => {
    setSelectedPitchUidsByType((current) => {
      const next = new Map(current);
      if (!selectAll) {
        next.delete(pitchType);
      } else {
        const uids = (individualPitchesByType.get(pitchType) ?? [])
          .map((candidate) => candidate.pitchUid)
          .filter((uid): uid is string => uid !== null);
        next.set(pitchType, new Set(uids));
      }
      return next;
    });
    reset();
  };

  return (
    <section className={styles.shell} aria-label="Ball flight simulator">
      <div className={styles.labTabs} role="tablist" aria-label="Ball Flight views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'flight'}
          className={`${styles.labTab} ${activeTab === 'flight' ? styles.labTabActive : ''}`}
          onClick={() => setActiveTab('flight')}
        >
          <span>01</span> Flight Path
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'spin-test'}
          className={`${styles.labTab} ${activeTab === 'spin-test' ? styles.labTabActive : ''}`}
          onClick={() => {
            setIsPlaying(false);
            setActiveTab('spin-test');
          }}
        >
          <span>02</span> Arsenal Spin Visual
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'spin'}
          className={`${styles.labTab} ${activeTab === 'spin' ? styles.labTabActive : ''}`}
          onClick={() => {
            setIsPlaying(false);
            setActiveTab('spin');
          }}
        >
          <span>03</span> Spin Builder
        </button>
      </div>

      {activeTab === 'flight' ? <>
      <div className={styles.stage} role="tabpanel" aria-label="Flight Path">
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          tabIndex={0}
          aria-label={`${cameraMode === 'custom' ? 'Custom 3D' : cameraMode === 'pitcher' ? 'Pitcher' : 'Catcher'} view of ${activePitches.length} average pitch trajectories. Drag to orbit, scroll to zoom, or use arrow and plus or minus keys.`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onWheel={handleWheel}
          onKeyDown={handleCameraKey}
        />
        <div className={styles.stageHud}>
          <span className={styles.clock}>{displayTime.toFixed(3)} s</span>
          <span className={styles.viewLabel}>{cameraMode === 'custom' ? 'custom 3D view' : `${cameraMode} view`} · simultaneous release</span>
        </div>
        {!loading && !error && payload?.pitches.length ? <span className={styles.orbitHint}>Drag to orbit · scroll to zoom</span> : null}
        {loading || error || !payload?.pitches.length ? (
          <div className={styles.empty}>
            <strong>{loading ? 'Loading measured trajectories…' : error ? 'Flight data unavailable' : 'No measured trajectories in this filter window'}</strong>
            <span>{error || (!loading && !payload?.pitches.length
              ? payload?.availableDateRange?.lastDate
                ? `Adjust the pitcher, date, or pitch filters. Measured trajectories for ${payload.schoolCode} are currently available through ${displayDate(payload.availableDateRange.lastDate)}.`
                : 'Adjust the pitcher, date, or pitch filters. New trajectories appear only when complete measured flight fields are available.'
              : '')}</span>
          </div>
        ) : null}
      </div>

      <div className={styles.controlDeck}>
        <div className={styles.pitchToggles} aria-label="Pitch types in playback">
          {(payload?.pitches ?? []).map((pitch) => {
            const active = selectedTypes.has(pitch.pitchType);
            const candidates = individualPitchesByType.get(pitch.pitchType) ?? [];
            const selectedUids = selectedPitchUidsByType.get(pitch.pitchType) ?? new Set<string>();
            const allSelected = candidates.length > 0 && candidates.every((candidate) => candidate.pitchUid !== null && selectedUids.has(candidate.pitchUid));
            return (
              <div key={pitch.pitchType} className={styles.pitchToggleGroup}>
                <button
                  type="button"
                  className={`${styles.pitchToggle} ${active ? styles.pitchToggleActive : ''}`}
                  style={{ '--pitch-color': colorForPitch(pitch.pitchType) } as CSSProperties}
                  aria-pressed={active}
                  onClick={() => togglePitchType(pitch.pitchType)}
                >
                  <span className={styles.swatch} />
                  {pitch.pitchType}
                </button>
                {candidates.length ? (
                  <details className={styles.pitchInstancePicker}>
                    <summary>{selectedUids.size ? `${selectedUids.size} of ${candidates.length} pitches` : `Average (n = ${pitch.pitchCount.toLocaleString()})`}</summary>
                    <div className={styles.pitchInstanceList}>
                      <label className={styles.pitchInstanceOption}>
                        <input type="checkbox" checked={allSelected} onChange={(event) => setAllPitchUidsForType(pitch.pitchType, event.target.checked)} />
                        Show all {candidates.length} filtered pitches
                      </label>
                      {candidates.map((candidate) => (
                        <label key={candidate.pitchUid ?? ''} className={styles.pitchInstanceOption}>
                          <input
                            type="checkbox"
                            checked={candidate.pitchUid !== null && selectedUids.has(candidate.pitchUid)}
                            onChange={() => candidate.pitchUid && togglePitchUidForType(pitch.pitchType, candidate.pitchUid)}
                          />
                          {individualPitchLabel(candidate)}
                        </label>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className={styles.segmented} aria-label="Camera view">
          {(['pitcher', 'batter'] as CameraView[]).map((option) => (
            <button key={option} type="button" className={`${styles.segment} ${cameraMode === option ? styles.segmentActive : ''}`} onClick={() => resetCamera(option)} aria-pressed={cameraMode === option} title={`Reset to ${option === 'pitcher' ? 'pitcher' : 'catcher'} view`}>
              {option === 'pitcher' ? 'Pitcher' : 'Catcher'}
            </button>
          ))}
        </div>
        <div className={styles.transport}>
          <div className={styles.segmented} aria-label="Playback speed">
            {[0.25, 0.5, 1].map((option) => (
              <button key={option} type="button" className={`${styles.segment} ${speed === option ? styles.segmentActive : ''}`} onClick={() => setSpeed(option)} aria-pressed={speed === option}>{option}×</button>
            ))}
          </div>
          <button type="button" className={styles.play} onClick={togglePlay} disabled={!activePitches.length}>{isPlaying ? 'Pause' : displayTime > 0 ? 'Resume' : 'Play arsenal'}</button>
          <button type="button" className={styles.reset} onClick={reset} aria-label="Reset playback">↺</button>
        </div>
      </div>

      <div className={styles.cards}>
        {activePitches.map((pitch, index) => (
          <article key={`${pitch.pitchType}-${index}`} className={styles.card} style={{ '--pitch-color': colorForPitch(pitch.pitchType) } as CSSProperties}>
            <div className={styles.cardHeader}>
              <h4 className={styles.cardTitle}>{pitch.pitchType}</h4>
              <span className={styles.sample}>n = {pitch.pitchCount.toLocaleString()}</span>
            </div>
            <div className={styles.metrics}>
              <div className={styles.metric}><span>Velo</span><strong>{fmt(pitch.velocity)} mph</strong></div>
              <div className={styles.metric}><span>Flight</span><strong>{fmt(durationForPitch(pitch), 3)} s</strong></div>
              <div className={styles.metric}><span>IVB</span><strong>{fmt(pitch.inducedVerticalBreak)} in</strong></div>
              <div className={styles.metric}><span>HB</span><strong>{fmt(pitch.horizontalBreak)} in</strong></div>
              <div className={styles.metric}><span>Plate</span><strong>{fmt(pitch.plateSide)}, {fmt(pitch.plateHeight)}</strong></div>
              <div className={styles.metric}><span>Release</span><strong>{fmt(pitch.releaseSide)}, {fmt(pitch.releaseHeight)}</strong></div>
            </div>
          </article>
        ))}
      </div>
      <p className={styles.notice}>Paths are averaged from pitches that contain complete measured trajectory fields. Dashed lines show the full projected path; solid trails show elapsed flight. Slow motion changes playback speed, not the displayed baseball flight time.</p>
      </> : activeTab === 'spin' ? (
        <div role="tabpanel" aria-label="Spin Builder pitch design sandbox">
          <SpinDesignerPanel />
        </div>
      ) : (
        <div role="tabpanel" aria-label="Arsenal Spin Visual">
          <SpinVisualPanel samples={payload?.spinSamples ?? []} loading={loading} schoolCode={payload?.schoolCode ?? ''} />
        </div>
      )}
    </section>
  );
}

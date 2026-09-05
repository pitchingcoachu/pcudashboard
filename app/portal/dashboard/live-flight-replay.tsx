'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './live-flight-replay.module.css';

type Point3 = { x: number; y: number; z: number };
type Point2 = { x: number; y: number; depth: number };
type CameraView = 'pitcher' | 'batter';
type CameraOrbit = { preset: CameraView; yaw: number; pitch: number; zoom: number };

export type LiveFlightPitch = {
  id: number;
  pitchIndex: number;
  pitchType: string | null;
  intendedSideFt: number;
  intendedHeightFt: number;
  targetRadiusFt: number;
  plateLocSide: number | null;
  plateLocHeight: number | null;
  missDirection: string | null;
  flightData: {
    position: Point3;
    velocity: Point3;
    acceleration: Point3;
    releaseSideFt: number | null;
    releaseHeightFt: number | null;
    releaseExtensionFt: number | null;
  } | null;
};

const CAMERA_PRESETS: Record<CameraView, { camera: Point3; target: Point3; focalScale: number; defaultZoom: number }> = {
  pitcher: { camera: { x: 0, y: 68, z: 8.2 }, target: { x: 0, y: 17 / 12, z: 2.55 }, focalScale: 1.15, defaultZoom: 0.24 },
  batter: { camera: { x: 0, y: -8, z: 3.4 }, target: { x: 0, y: 50, z: 3.5 }, focalScale: 1, defaultZoom: 1 },
};

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

const MISS_LABELS: Record<string, string> = {
  'up-arm': 'Up, Arm Side',
  'up-middle': 'Up, Middle',
  'up-glove': 'Up, Glove Side',
  'middle-arm': 'Middle, Arm Side',
  'on-target': 'On Target',
  'middle-glove': 'Middle, Glove Side',
  'down-arm': 'Down, Arm Side',
  'down-middle': 'Down, Middle',
  'down-glove': 'Down, Glove Side',
};

const freshCamera = (preset: CameraView): CameraOrbit => ({ preset, yaw: 0, pitch: 0, zoom: CAMERA_PRESETS[preset].defaultZoom });
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function canvasPitchColor(type: string | null): string {
  const color = PITCH_COLORS[type ?? 'Undefined'] ?? PITCH_COLORS.Undefined;
  if (!color.includes('--portal-fastball-color') || typeof document === 'undefined') return color;
  return getComputedStyle(document.body).getPropertyValue('--portal-fastball-color').trim() || '#ffffff';
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

function projector(camera: CameraOrbit, width: number, height: number) {
  const preset = CAMERA_PRESETS[camera.preset];
  const baseOffset = subtract(preset.camera, preset.target);
  const radius = Math.hypot(baseOffset.x, baseOffset.y, baseOffset.z) * (camera.preset === 'pitcher' ? 1 : clamp(camera.zoom, 0.5, 1.9));
  const yaw = Math.atan2(baseOffset.y, baseOffset.x) + camera.yaw;
  const pitch = clamp(Math.atan2(baseOffset.z, Math.hypot(baseOffset.x, baseOffset.y)) + camera.pitch, -1.35, 1.35);
  const horizontalRadius = Math.cos(pitch) * radius;
  const eye = {
    x: preset.target.x + Math.cos(yaw) * horizontalRadius,
    y: preset.target.y + Math.sin(yaw) * horizontalRadius,
    z: preset.target.z + Math.sin(pitch) * radius,
  };
  const forward = normalize(subtract(preset.target, eye));
  const right = normalize(cross({ x: 0, y: 0, z: 1 }, forward));
  const up = normalize(cross(forward, right));
  const lensZoom = camera.preset === 'pitcher' ? 1 / clamp(camera.zoom, 0.12, 2.4) : 1;
  const focal = Math.min(width, height) * preset.focalScale * lensZoom;
  return (point: Point3): Point2 | null => {
    const relative = subtract(point, eye);
    const depth = dot(relative, forward);
    if (depth <= 0.15) return null;
    return {
      x: width / 2 + (dot(relative, right) / depth) * focal,
      y: height * 0.48 - (dot(relative, up) / depth) * focal,
      depth,
    };
  };
}

function line3(ctx: CanvasRenderingContext2D, project: ReturnType<typeof projector>, points: Point3[], stroke: string, width: number, dash: number[] = []) {
  ctx.beginPath();
  let started = false;
  for (const point of points) {
    const projected = project(point);
    if (!projected) continue;
    if (started) ctx.lineTo(projected.x, projected.y);
    else ctx.moveTo(projected.x, projected.y);
    started = true;
  }
  ctx.setLineDash(dash);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.setLineDash([]);
}

function fill3(ctx: CanvasRenderingContext2D, project: ReturnType<typeof projector>, points: Point3[], fill: string) {
  const projected = points.map(project).filter((point): point is Point2 => point !== null);
  if (projected.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(projected[0].x, projected[0].y);
  for (const point of projected.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function solvePlateTime(pitch: LiveFlightPitch): number {
  const flight = pitch.flightData;
  if (!flight) return 0;
  const a = flight.acceleration.y / 2;
  const b = flight.velocity.y;
  const c = flight.position.y - 17 / 12;
  if (Math.abs(a) < 1e-8) {
    const time = -c / b;
    return Number.isFinite(time) && time > 0 && time < 1 ? time : 0;
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return 0;
  const root = Math.sqrt(discriminant);
  const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((time) => Number.isFinite(time) && time > 0 && time < 1);
  return candidates.length ? Math.min(...candidates) : 0;
}

function flightPoint(pitch: LiveFlightPitch, elapsed: number): Point3 {
  const flight = pitch.flightData;
  const duration = Math.max(0.001, solvePlateTime(pitch));
  const u = clamp(elapsed / duration, 0, 1);
  const startY = 60.5 - (flight?.releaseExtensionFt ?? 6);
  const startX = flight?.releaseSideFt ?? 0;
  const startZ = flight?.releaseHeightFt ?? 5.8;
  const endX = pitch.plateLocSide ?? 0;
  const endZ = pitch.plateLocHeight ?? 2.55;
  const curveX = -0.5 * (flight?.acceleration.x ?? 0) * duration * duration * u * (u - 1);
  const curveZ = 0.5 * (flight?.acceleration.z ?? 0) * duration * duration * u * (u - 1);
  return {
    x: startX + (endX - startX) * u + curveX,
    y: startY + (17 / 12 - startY) * u,
    z: startZ + (endZ - startZ) * u + curveZ,
  };
}

function drawScene(canvas: HTMLCanvasElement, pitch: LiveFlightPitch, elapsed: number, camera: CameraOrbit) {
  const bounds = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.max(1, Math.round(bounds.width * dpr));
  const pixelHeight = Math.max(1, Math.round(bounds.height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = bounds.width;
  const height = bounds.height;
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#0c0c0c');
  background.addColorStop(0.5, '#121212');
  background.addColorStop(1, '#0b0b0b');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const project = projector(camera, width, height);
  const laneLeft = Array.from({ length: 13 }, (_, index) => ({ x: -3.15, y: index * 5, z: 0 }));
  const laneRight = laneLeft.map((point) => ({ ...point, x: 3.15 }));
  line3(ctx, project, laneLeft, 'rgba(255,255,255,0.18)', 1);
  line3(ctx, project, laneRight, 'rgba(255,255,255,0.18)', 1);
  for (let y = 5; y <= 60; y += 5) {
    line3(ctx, project, [{ x: -3.15, y, z: 0 }, { x: 3.15, y, z: 0 }], 'rgba(255,255,255,0.055)', 1);
  }

  const plate = [
    { x: -0.708, y: 17 / 12, z: 0.03 }, { x: 0.708, y: 17 / 12, z: 0.03 },
    { x: 0.708, y: 17 / 24, z: 0.03 }, { x: 0, y: 0, z: 0.03 },
    { x: -0.708, y: 17 / 24, z: 0.03 }, { x: -0.708, y: 17 / 12, z: 0.03 },
  ];
  line3(ctx, project, plate, 'rgba(255,255,255,0.84)', 2);
  const mound = Array.from({ length: 25 }, (_, index) => {
    const theta = index / 24 * Math.PI * 2;
    return { x: Math.cos(theta) * 4.5, y: 60.5 + Math.sin(theta) * 2.2, z: 0.12 };
  });
  line3(ctx, project, mound, 'rgba(206,170,111,0.42)', 1.3);
  line3(ctx, project, [{ x: -1, y: 60.5, z: 0.17 }, { x: 1, y: 60.5, z: 0.17 }], 'rgba(255,255,255,0.85)', 3);

  const zone = [
    { x: -0.88, y: 17 / 12, z: 1.5 }, { x: 0.88, y: 17 / 12, z: 1.5 },
    { x: 0.88, y: 17 / 12, z: 3.6 }, { x: -0.88, y: 17 / 12, z: 3.6 }, { x: -0.88, y: 17 / 12, z: 1.5 },
  ];
  fill3(ctx, project, zone.slice(0, -1), 'rgba(255,255,255,0.035)');
  line3(ctx, project, zone, 'rgba(255,255,255,0.9)', 2.1);
  for (const fraction of [1 / 3, 2 / 3]) {
    const x = -0.88 + 1.76 * fraction;
    const z = 1.5 + 2.1 * fraction;
    line3(ctx, project, [{ x, y: 17 / 12, z: 1.5 }, { x, y: 17 / 12, z: 3.6 }], 'rgba(255,255,255,0.34)', 1.15);
    line3(ctx, project, [{ x: -0.88, y: 17 / 12, z }, { x: 0.88, y: 17 / 12, z }], 'rgba(255,255,255,0.34)', 1.15);
  }

  const target = Array.from({ length: 49 }, (_, index) => {
    const theta = index / 48 * Math.PI * 2;
    return {
      x: pitch.intendedSideFt + Math.cos(theta) * pitch.targetRadiusFt,
      y: 17 / 12 - 0.015,
      z: pitch.intendedHeightFt + Math.sin(theta) * pitch.targetRadiusFt,
    };
  });
  fill3(ctx, project, target.slice(0, -1), 'rgba(74,222,128,0.16)');
  line3(ctx, project, target, '#4ade80', 2, [5, 4]);
  const targetCenter = { x: pitch.intendedSideFt, y: 17 / 12 - 0.02, z: pitch.intendedHeightFt };
  const actual = { x: pitch.plateLocSide ?? 0, y: 17 / 12 - 0.025, z: pitch.plateLocHeight ?? 2.55 };
  line3(ctx, project, [targetCenter, actual], 'rgba(255,255,255,0.55)', 1.4, [4, 5]);
  const projectedTargetCenter = project(targetCenter);
  if (projectedTargetCenter) {
    ctx.beginPath();
    ctx.arc(projectedTargetCenter.x, projectedTargetCenter.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = '#4ade80';
    ctx.fill();
  }

  const duration = solvePlateTime(pitch);
  if (!duration) return;
  const color = canvasPitchColor(pitch.pitchType);
  const path = Array.from({ length: 51 }, (_, index) => flightPoint(pitch, duration * index / 50));
  ctx.save();
  ctx.globalAlpha = 0.24;
  line3(ctx, project, path, color, 1.5, [4, 5]);
  ctx.restore();
  const visibleSteps = Math.max(1, Math.round(50 * Math.min(1, elapsed / duration)));
  line3(ctx, project, path.slice(0, visibleSteps + 1), color, 2.5);
  const position = project(flightPoint(pitch, elapsed));
  if (!position) return;
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(position.x, position.y, camera.preset === 'pitcher' ? 10 : 9, 0, Math.PI * 2);
  ctx.fillStyle = '#fffdf0';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

type LiveFlightReplayProps = {
  pitch: LiveFlightPitch | null;
  currentPitchNumber: number;
  totalPitches: number;
  hasPrevious: boolean;
  hasNext: boolean;
  followingLive: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

export default function LiveFlightReplay({
  pitch,
  currentPitchNumber,
  totalPitches,
  hasPrevious,
  hasNext,
  followingLive,
  onPrevious,
  onNext,
}: LiveFlightReplayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<CameraOrbit>(freshCamera('batter'));
  const elapsedRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const clockUpdateRef = useRef(0);
  const previousPitchIdRef = useRef<number | null>(null);
  const [camera, setCamera] = useState<CameraView>('batter');
  const [speed, setSpeed] = useState(1);
  const [autoReplay, setAutoReplay] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);

  const duration = pitch ? solvePlateTime(pitch) : 0;
  const hasFlight = Boolean(pitch?.flightData && duration);

  useEffect(() => {
    if (!pitch || previousPitchIdRef.current === pitch.id) return;
    previousPitchIdRef.current = pitch.id;
    elapsedRef.current = autoReplay ? 0 : duration;
    lastFrameRef.current = null;
    setDisplayTime(elapsedRef.current);
    setPlaying(autoReplay && hasFlight);
  }, [autoReplay, duration, hasFlight, pitch]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pitch || !hasFlight) return;
    let frameId = 0;
    const render = (timestamp: number) => {
      if (playing) {
        const previous = lastFrameRef.current ?? timestamp;
        elapsedRef.current = Math.min(duration, elapsedRef.current + (timestamp - previous) / 1000 * speed);
        if (timestamp - clockUpdateRef.current > 70 || elapsedRef.current >= duration) {
          clockUpdateRef.current = timestamp;
          setDisplayTime(elapsedRef.current);
        }
        if (elapsedRef.current >= duration) setPlaying(false);
      }
      lastFrameRef.current = timestamp;
      drawScene(canvas, pitch, elapsedRef.current, cameraRef.current);
      frameId = window.requestAnimationFrame(render);
    };
    frameId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frameId);
  }, [duration, hasFlight, pitch, playing, speed]);

  const chooseCamera = (next: CameraView) => {
    cameraRef.current = freshCamera(next);
    setCamera(next);
  };

  const replay = () => {
    if (!hasFlight) return;
    elapsedRef.current = 0;
    lastFrameRef.current = null;
    setDisplayTime(0);
    setPlaying(true);
  };

  return (
    <section className={styles.shell} aria-label="Live pitch flight replay">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Live Flight</span>
          <h3 className={styles.title}>{pitch ? `${pitch.pitchType ?? 'Untagged'} · Pitch ${pitch.pitchIndex}` : 'Trajectory standby'}</h3>
        </div>
        <div className={styles.headerActions}>
          {pitch?.missDirection ? <span className={styles.miss}>{MISS_LABELS[pitch.missDirection] ?? pitch.missDirection}</span> : null}
          <button type="button" className={styles.replay} onClick={replay} disabled={!hasFlight}>Replay</button>
        </div>
      </header>

      <nav className={styles.pitchNavigation} aria-label="Pitch flight navigation">
        <button type="button" className={styles.navButton} onClick={onPrevious} disabled={!hasPrevious}>
          <span aria-hidden="true">←</span> Previous
        </button>
        <div className={styles.pitchPosition} aria-live="polite">
          <strong>{totalPitches ? `${currentPitchNumber} of ${totalPitches}` : 'No pitches'}</strong>
          {followingLive ? <span className={styles.liveIndicator}><i /> Live</span> : <span>Reviewing</span>}
        </div>
        <button type="button" className={styles.navButton} onClick={onNext} disabled={!hasNext}>
          Next <span aria-hidden="true">→</span>
        </button>
      </nav>

      <div className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={`${camera === 'batter' ? 'Catcher' : 'Pitcher'} view of the selected measured pitch trajectory with intended target`} />
        {hasFlight ? (
          <div className={styles.hud}>
            <span>{displayTime.toFixed(3)} s</span>
            <span>{camera === 'batter' ? 'catcher view' : 'pitcher view'}</span>
          </div>
        ) : (
          <div className={styles.empty}>
            <strong>{pitch ? 'Trajectory unavailable for this pitch' : 'Waiting for the first tracked pitch'}</strong>
            <span>The measured TrackMan flight will replay here automatically.</span>
          </div>
        )}
      </div>

      <footer className={styles.controls}>
        <div className={styles.segmented} aria-label="Camera view">
          {(['batter', 'pitcher'] as CameraView[]).map((option) => (
            <button key={option} type="button" className={camera === option ? styles.active : undefined} onClick={() => chooseCamera(option)}>
              {option === 'batter' ? 'Catcher' : 'Pitcher'}
            </button>
          ))}
        </div>
        <div className={styles.segmented} aria-label="Playback speed">
          {[0.25, 0.5, 1].map((option) => (
            <button key={option} type="button" className={speed === option ? styles.active : undefined} onClick={() => setSpeed(option)}>{option}×</button>
          ))}
        </div>
        <label className={styles.autoReplay}>
          <input type="checkbox" checked={autoReplay} onChange={(event) => setAutoReplay(event.target.checked)} />
          Auto replay
        </label>
      </footer>
    </section>
  );
}

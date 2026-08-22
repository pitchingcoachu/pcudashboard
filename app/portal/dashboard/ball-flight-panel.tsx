'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import styles from './ball-flight-panel.module.css';

type CameraView = 'pitcher' | 'batter';

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

type FlightPayload = {
  schoolCode: string;
  dataPolicy: 'measured-only';
  rolloutDate: string;
  backfillWindowDays: number;
  availableDateRange?: { firstDate: string | null; lastDate: string | null } | null;
  pitches: FlightPitch[];
  error?: string;
};

type Point3 = { x: number; y: number; z: number };
type Point2 = { x: number; y: number; depth: number };

const PITCH_COLORS: Record<string, string> = {
  Fastball: '#ff4d5f',
  Sinker: '#ff934f',
  Cutter: '#e8d34c',
  Slider: '#56d5ff',
  Sweeper: '#a27cff',
  Curveball: '#4ae0a0',
  ChangeUp: '#ff7bd5',
  Splitter: '#b9df62',
  Knuckleball: '#f0f2e8',
  Undefined: '#aab2ab',
};

function colorForPitch(type: string): string {
  return PITCH_COLORS[type] ?? '#f0f2e8';
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

function projector(view: CameraView, width: number, height: number) {
  const camera = view === 'pitcher' ? { x: 0, y: 68, z: 8.2 } : { x: 0, y: -9, z: 5.3 };
  const target = view === 'pitcher' ? { x: 0, y: 7, z: 2.8 } : { x: 0, y: 49, z: 5.2 };
  const forward = normalize(subtract(target, camera));
  // TrackMan reports a positive lateral release for right-handed pitchers.
  // Flip the camera's screen-right basis so an RHP appears on the viewer's
  // right from behind the mound and on the viewer's left from the batter box.
  const right = normalize(cross({ x: 0, y: 0, z: 1 }, forward));
  const up = normalize(cross(forward, right));
  const focal = Math.min(width, height) * (view === 'pitcher' ? 1.02 : 0.95);
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

function drawScene(canvas: HTMLCanvasElement, pitches: FlightPitch[], elapsed: number, view: CameraView) {
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
  bg.addColorStop(0, '#07110d');
  bg.addColorStop(0.5, '#0b1a12');
  bg.addColorStop(1, '#06100b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const project = projector(view, width, height);
  const laneLeft = Array.from({ length: 13 }, (_, index) => ({ x: -3.15, y: index * 5, z: 0 }));
  const laneRight = laneLeft.map((point) => ({ ...point, x: 3.15 }));
  line3(ctx, project, laneLeft, 'rgba(231,238,220,0.18)', 1);
  line3(ctx, project, laneRight, 'rgba(231,238,220,0.18)', 1);
  for (let y = 5; y <= 60; y += 5) {
    line3(ctx, project, [{ x: -3.15, y, z: 0 }, { x: 3.15, y, z: 0 }], 'rgba(231,238,220,0.055)', 1);
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
    const color = colorForPitch(pitch.pitchType);
    const allPath = Array.from({ length: 51 }, (_, index) => flightPoint(pitch, duration * index / 50));
    line3(ctx, project, allPath, `${color}3d`, 1.5, [4, 5]);
    const visibleSteps = Math.max(1, Math.round(50 * Math.min(1, elapsed / duration)));
    line3(ctx, project, allPath.slice(0, visibleSteps + 1), color, 2.5);
    const position = project(flightPoint(pitch, elapsed));
    if (!position) continue;
    const radius = Math.max(4, Math.min(11, 110 / position.depth));
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
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
  const elapsedRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const clockUpdateRef = useRef(0);
  const [payload, setPayload] = useState<FlightPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<CameraView>('pitcher');
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

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

  const activePitches = useMemo(
    () => (payload?.pitches ?? []).filter((pitch) => selectedTypes.has(pitch.pitchType) && durationForPitch(pitch) > 0),
    [payload?.pitches, selectedTypes]
  );
  const maxDuration = useMemo(() => Math.max(0, ...activePitches.map(durationForPitch)), [activePitches]);

  useEffect(() => {
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
      drawScene(canvas, activePitches, elapsedRef.current, view);
      frameId = window.requestAnimationFrame(render);
    };
    frameId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frameId);
  }, [activePitches, isPlaying, maxDuration, speed, view]);

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

  return (
    <section className={styles.shell} aria-label="Ball flight simulator">
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Pitching Suite / Flight Lab</p>
          <h3 className={styles.title}>Average Arsenal Tunnel</h3>
          <p className={styles.lede}>One measured average per pitch type from the active sidebar filters. Every pitch releases together; its own velocity, release geometry, movement, and measured flight time determine when and where it arrives.</p>
        </div>
        <span className={styles.measuredBadge}>Measured data only</span>
      </header>

      <div className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label={`${view === 'pitcher' ? 'Pitcher' : 'Batter'} view of ${activePitches.length} average pitch trajectories`}
        />
        <div className={styles.stageHud}>
          <span className={styles.clock}>{displayTime.toFixed(3)} s</span>
          <span className={styles.viewLabel}>{view} view · simultaneous release</span>
        </div>
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
            return (
              <button
                key={pitch.pitchType}
                type="button"
                className={`${styles.pitchToggle} ${active ? styles.pitchToggleActive : ''}`}
                style={{ '--pitch-color': colorForPitch(pitch.pitchType) } as CSSProperties}
                aria-pressed={active}
                onClick={() => togglePitchType(pitch.pitchType)}
              >
                <span className={styles.swatch} />
                {pitch.pitchType}
              </button>
            );
          })}
        </div>
        <div className={styles.segmented} aria-label="Camera view">
          {(['pitcher', 'batter'] as CameraView[]).map((option) => (
            <button key={option} type="button" className={`${styles.segment} ${view === option ? styles.segmentActive : ''}`} onClick={() => setView(option)} aria-pressed={view === option}>
              {option === 'pitcher' ? 'Pitcher' : 'Batter'}
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
        {activePitches.map((pitch) => (
          <article key={pitch.pitchType} className={styles.card} style={{ '--pitch-color': colorForPitch(pitch.pitchType) } as CSSProperties}>
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
    </section>
  );
}

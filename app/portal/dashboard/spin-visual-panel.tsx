'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { calculateExpectedMovement } from '../../../lib/expected-movement';
import { trackManEulerAxisToScene, trackManSpinVectorToScene } from '../../../lib/trackman-spin-coordinates';
import styles from './spin-visual-panel.module.css';
import type { SpinBaseballRenderer } from './spin-baseball-renderer';

type Vec3 = { x: number; y: number; z: number };
type Quaternion = { w: number; x: number; y: number; z: number };
type RotationOrder = 'XYZ' | 'XZY' | 'YXZ' | 'YZX' | 'ZXY' | 'ZYX';
type SpinCameraPreset = 'pitcher' | 'catcher';
type SpinCameraMode = SpinCameraPreset | 'custom';
type SpinCamera = { preset: SpinCameraPreset; yaw: number; pitch: number; zoom: number };
type Convention = { order: RotationOrder; intrinsic: boolean };
type MovementVector = { ivb: number; hb: number };
type MovementBreakdown = { magnus: MovementVector | null; residual: MovementVector | null };

export type SpinSample = {
  pitchType: string;
  pitchUid: string | null;
  sampleDate: string | null;
  pitcher: string | null;
  pitcherThrows: string | null;
  spinRate: number;
  activeSpinRate: number | null;
  spinEfficiency: number | null;
  velocity: number | null;
  extension: number | null;
  inducedVerticalBreak: number | null;
  horizontalBreak: number | null;
  measuredTilt: string | null;
  breakTilt: string | null;
  transverseAngle: number | null;
  longitudinalAngle: number | null;
  spinAxis: Vec3;
  seamRotation: Vec3;
  source?: 'trackman_measured' | 'edger_video';
  confidence?: number | null;
  sourceUrl?: string | null;
  coordinateFrame?: string | null;
};

const ROTATION_ORDERS: RotationOrder[] = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'];
const CONVENTIONS: Convention[] = [true, false].flatMap((intrinsic) => ROTATION_ORDERS.map((order) => ({ order, intrinsic })));
const DEFAULT_CONVENTION: Convention = { order: 'XYZ', intrinsic: true };
const VIDEO_CONVENTION: Convention = { order: 'XYZ', intrinsic: false };
const SPEEDS = [0.01, 0.025, 0.05, 0.1];
const DEG = Math.PI / 180;
const CAMERA_YAW: Record<SpinCameraPreset, number> = { pitcher: Math.PI / 2, catcher: -Math.PI / 2 };
const PITCH_COLORS: Record<string, string> = {
  Fastball: 'var(--portal-fastball-color)', Sinker: 'orange', Cutter: 'brown', Slider: 'red', Sweeper: 'purple',
  Curveball: 'blue', ChangeUp: 'darkgreen', Splitter: 'turquoise', Knuckleball: 'darkblue', Undefined: '#9ca3af',
};
// Same left-to-right pitch-type order used elsewhere in the dashboard (e.g.
// app/api/dashboard/pitching/ball-flight/route.ts's ORDER BY CASE).
const PITCH_TYPE_ORDER = ['Fastball', 'Sinker', 'Cutter', 'Slider', 'Sweeper', 'Curveball', 'ChangeUp', 'Splitter', 'Knuckleball'];
function pitchTypeSortIndex(pitchType: string): number {
  const index = PITCH_TYPE_ORDER.indexOf(pitchType);
  return index < 0 ? PITCH_TYPE_ORDER.length : index;
}
const freshCamera = (preset: SpinCameraPreset): SpinCamera => ({ preset, yaw: CAMERA_YAW[preset], pitch: 0, zoom: 1 });
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
const conventionId = (value: Convention): string => `${value.intrinsic ? 'intrinsic' : 'extrinsic'}:${value.order}`;

function normalize(vector: Vec3): Vec3 {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude };
}

function multiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    w: (a.w * b.w) - (a.x * b.x) - (a.y * b.y) - (a.z * b.z),
    x: (a.w * b.x) + (a.x * b.w) + (a.y * b.z) - (a.z * b.y),
    y: (a.w * b.y) - (a.x * b.z) + (a.y * b.w) + (a.z * b.x),
    z: (a.w * b.z) + (a.x * b.y) - (a.y * b.x) + (a.z * b.w),
  };
}

function axisAngle(axis: Vec3, angle: number): Quaternion {
  const unit = normalize(axis);
  const half = angle / 2;
  const sine = Math.sin(half);
  return { w: Math.cos(half), x: unit.x * sine, y: unit.y * sine, z: unit.z * sine };
}

function eulerQuaternion(rotation: Vec3, convention: Convention): Quaternion {
  const angles: Record<string, number> = { X: rotation.x * DEG, Y: rotation.y * DEG, Z: rotation.z * DEG };
  let result: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
  for (const axis of convention.order) {
    const next = axisAngle(trackManEulerAxisToScene(axis as 'X' | 'Y' | 'Z'), angles[axis]);
    result = convention.intrinsic ? multiply(result, next) : multiply(next, result);
  }
  return result;
}

function edgerAxisToScene(axis: 'X' | 'Y' | 'Z'): Vec3 {
  // The video fitter projects camera X right, camera Y up, and camera Z toward
  // the lens. From the renderer camera behind the pitcher, screen-right is
  // negative field X, screen-up is scene Z, and toward-lens is scene Y. This
  // is a proper basis change: camera XYZ -> scene (-X, Z, Y).
  if (axis === 'X') return { x: -1, y: 0, z: 0 };
  if (axis === 'Y') return { x: 0, y: 0, z: 1 };
  return { x: 0, y: 1, z: 0 };
}

function edgerEulerQuaternion(rotation: Vec3): Quaternion {
  const angles: Record<string, number> = { X: rotation.x * DEG, Y: rotation.y * DEG, Z: rotation.z * DEG };
  let result: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
  for (const axis of VIDEO_CONVENTION.order) {
    result = multiply(axisAngle(edgerAxisToScene(axis as 'X' | 'Y' | 'Z'), angles[axis]), result);
  }
  return result;
}

function sceneAxisFor(sample: SpinSample): Vec3 {
  if (sample.source === 'edger_video') {
    return normalize({ x: -sample.spinAxis.x, y: sample.spinAxis.z, z: sample.spinAxis.y });
  }
  return trackManSpinVectorToScene(sample.spinAxis);
}

function orientationFor(sample: SpinSample, convention: Convention, elapsed: number, direction: 1 | -1): Quaternion {
  const initial = sample.source === 'edger_video'
    ? edgerEulerQuaternion(sample.seamRotation)
    : eulerQuaternion(sample.seamRotation, convention);
  // Verified against every current video-derived sample's own measured IVB
  // sign (backspin vs. topspin): the Edger camera's raw frames read out with
  // the opposite rotational sense from the field-scene convention TrackMan
  // data already uses, so video-derived spin runs backwards without this
  // correction. This is an empirical camera-orientation fix, not a
  // coordinate-math derivation -- revisit if the Edger rig or export pipeline
  // changes.
  const videoDirectionSign = sample.source === 'edger_video' ? -1 : 1;
  const spinRadians = videoDirectionSign * direction * elapsed * sample.spinRate * Math.PI * 2 / 60;
  return multiply(axisAngle(sceneAxisFor(sample), spinRadians), initial);
}

function displayDate(value: string | null): string {
  if (!value) return 'Date unavailable';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function movement(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}\u2033`;
}

function spinEfficiencyPercent(sample: SpinSample): number | null {
  if (sample.activeSpinRate !== null && sample.spinRate > 0) return clamp((sample.activeSpinRate / sample.spinRate) * 100, 0, 100);
  if (sample.spinEfficiency !== null) return clamp(sample.spinEfficiency <= 1.25 ? sample.spinEfficiency * 100 : sample.spinEfficiency, 0, 100);
  if (sample.source === 'edger_video') {
    const axis = sceneAxisFor(sample);
    return clamp(Math.hypot(axis.x, axis.z) * 100, 0, 100);
  }
  return null;
}

function degreesToClock(degrees: number): string {
  const totalMinutes = Math.round((((degrees + 180) % 360 + 360) % 360) * 2);
  const hour = Math.floor(totalMinutes / 60) % 12 || 12;
  const minute = totalMinutes % 60;
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

function releaseTilt(sample: SpinSample): string | null {
  if (sample.measuredTilt) return sample.measuredTilt;
  if (sample.source !== 'edger_video') return null;
  const axis = sceneAxisFor(sample);
  const degrees = ((Math.atan2(axis.x, axis.z) * 180 / Math.PI) + 180 + 360) % 360;
  return degreesToClock(degrees);
}

function visualReleaseTilt(sample: SpinSample, cameraMode: SpinCameraMode): string {
  const axis = sceneAxisFor(sample);
  // releaseTilt()'s atan2(axis.x, axis.z) convention (no flip) is the
  // pitcher-view reference and matches TrackMan's own measured tilt for
  // video-derived samples. The catcher camera looks from the opposite field-Y
  // direction, so its screen-right is mirrored (+X instead of -X in the
  // pitcher's frame) and needs the sign flip; custom orbit keeps the
  // pitcher-reference label and convention.
  const screenRight = cameraMode === 'catcher' ? -axis.x : axis.x;
  const degrees = ((Math.atan2(screenRight, axis.z) * 180 / Math.PI) + 180 + 360) % 360;
  return degreesToClock(degrees);
}

function movementBreakdown(sample: SpinSample): MovementBreakdown {
  const efficiency = spinEfficiencyPercent(sample);
  const tilt = releaseTilt(sample);
  if (sample.velocity === null || !tilt || efficiency === null) return { magnus: null, residual: null };
  const model = calculateExpectedMovement({
    velocityMph: sample.velocity, spinRateRpm: sample.spinRate, activeSpinRpm: sample.activeSpinRate,
    spinEfficiency: efficiency / 100, measuredTilt: tilt, extensionFeet: sample.extension ?? 6,
  });
  if (!model) return { magnus: null, residual: null };
  const magnus = { ivb: model.expectedIvb, hb: model.expectedHb };
  const residual = sample.inducedVerticalBreak !== null && sample.horizontalBreak !== null
    ? { ivb: sample.inducedVerticalBreak - magnus.ivb, hb: sample.horizontalBreak - magnus.hb }
    : null;
  return { magnus, residual };
}

function sampleKey(sample: SpinSample): string {
  return sample.pitchUid ?? `${sample.pitchType}:${sample.sampleDate ?? ''}:${sample.spinRate}`;
}

function sampleLabel(sample: SpinSample): string {
  const date = displayDate(sample.sampleDate);
  const pitcher = sample.pitcher ?? 'Unknown pitcher';
  const velo = sample.velocity !== null ? `${sample.velocity.toFixed(1)} mph` : '— mph';
  return `${date} · ${pitcher} · ${velo}`;
}

function displayTilt(value: string | null): string {
  if (!value) return '—';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? degreesToClock(numeric) : value;
}

export default function SpinVisualPanel({ samples, loading, schoolCode }: { samples: SpinSample[]; loading: boolean; schoolCode: string }) {
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const rendererRef = useRef<SpinBaseballRenderer | null>(null);
  const cameraRef = useRef<SpinCamera>(freshCamera('pitcher'));
  const dragRef = useRef<{ pointerId: number; x: number; y: number; yaw: number; pitch: number } | null>(null);
  const elapsedRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const renderFrameRef = useRef(0);
  const [selectedConventionId, setSelectedConventionId] = useState(conventionId(DEFAULT_CONVENTION));
  const [playing, setPlaying] = useState(true);
  const [speedScale, setSpeedScale] = useState(0.025);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [cameraMode, setCameraMode] = useState<SpinCameraMode>('pitcher');
  const [axisVisible, setAxisVisible] = useState(true);
  // Empty/absent entry for a pitch type means "use the most recent filtered
  // sample" (today's default behavior); a sample key means the user picked
  // one specific measured pitch to view instead.
  const [selectedKeyByType, setSelectedKeyByType] = useState<Map<string, string>>(new Map());

  const selectedConvention = useMemo(() => CONVENTIONS.find((value) => conventionId(value) === selectedConventionId) ?? DEFAULT_CONVENTION, [selectedConventionId]);

  const samplesByType = useMemo(() => {
    const map = new Map<string, SpinSample[]>();
    for (const sample of samples) {
      const list = map.get(sample.pitchType) ?? [];
      list.push(sample);
      map.set(sample.pitchType, list);
    }
    // Most recent first within each type, matching the prior DISTINCT ON
    // (pitch_type ... ORDER BY "Date" DESC) default from the API.
    for (const list of map.values()) list.sort((a, b) => (b.sampleDate ?? '').localeCompare(a.sampleDate ?? ''));
    return map;
  }, [samples]);

  const displayedSamples = useMemo(
    () => Array.from(samplesByType.entries())
      .sort(([a], [b]) => pitchTypeSortIndex(a) - pitchTypeSortIndex(b))
      .map(([pitchType, candidates]) => {
        const selectedKey = selectedKeyByType.get(pitchType);
        const selected = selectedKey ? candidates.find((candidate) => sampleKey(candidate) === selectedKey) : null;
        return selected ?? candidates[0];
      }),
    [samplesByType, selectedKeyByType]
  );

  const breakdowns = useMemo(() => displayedSamples.map(movementBreakdown), [displayedSamples]);
  const hasMeasuredSamples = displayedSamples.some((sample) => sample.source !== 'edger_video');

  const selectSampleForType = (pitchType: string, key: string) => {
    setSelectedKeyByType((current) => {
      const next = new Map(current);
      if (key) next.set(pitchType, key);
      else next.delete(pitchType);
      return next;
    });
  };

  useEffect(() => {
    let active = true;
    void import('./spin-baseball-renderer').then(({ SpinBaseballRenderer: Renderer }) => { if (active) rendererRef.current = new Renderer(); });
    return () => { active = false; rendererRef.current?.dispose(); rendererRef.current = null; };
  }, []);

  useEffect(() => { elapsedRef.current = 0; lastFrameRef.current = null; }, [displayedSamples]);

  useEffect(() => {
    if (!displayedSamples.length) return;
    let frameId = 0;
    const render = (timestamp: number) => {
      const previous = lastFrameRef.current ?? timestamp;
      if (playing) elapsedRef.current += ((timestamp - previous) / 1000) * speedScale;
      lastFrameRef.current = timestamp;
      if ((timestamp - renderFrameRef.current) >= (1000 / 30)) {
        renderFrameRef.current = timestamp;
        const renderer = rendererRef.current;
        if (renderer) displayedSamples.forEach((sample, index) => {
          const canvas = canvasRefs.current[index];
          const sceneAxis = sceneAxisFor(sample);
          if (canvas) renderer.render(canvas, orientationFor(sample, selectedConvention, elapsedRef.current, direction), cameraRef.current, {
            axis: { visible: axisVisible, ...sceneAxis },
          });
        });
      }
      frameId = window.requestAnimationFrame(render);
    };
    frameId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frameId);
  }, [axisVisible, direction, playing, displayedSamples, selectedConvention, speedScale]);

  const reset = () => { elapsedRef.current = 0; lastFrameRef.current = null; setPlaying(false); };
  const resetCamera = (preset: SpinCameraPreset) => { cameraRef.current = freshCamera(preset); dragRef.current = null; setCameraMode(preset); };
  const markCameraCustom = () => setCameraMode((current) => current === 'custom' ? current : 'custom');

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw: cameraRef.current.yaw, pitch: cameraRef.current.pitch };
    event.currentTarget.focus({ preventScroll: true });
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    cameraRef.current = { ...cameraRef.current, yaw: drag.yaw - ((event.clientX - drag.x) * 0.009), pitch: clamp(drag.pitch + ((event.clientY - drag.y) * 0.007), -1.35, 1.35) };
    markCameraCustom();
  };
  const handlePointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    cameraRef.current = { ...cameraRef.current, zoom: clamp(cameraRef.current.zoom * Math.exp(-event.deltaY * 0.001), 0.72, 1.18) };
    markCameraCustom();
  };
  const handleCameraKey = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === ' ') { event.preventDefault(); setPlaying((current) => !current); return; }
    const step = event.shiftKey ? 0.16 : 0.07;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') return resetCamera(cameraRef.current.preset);
    cameraRef.current = {
      ...cameraRef.current,
      yaw: cameraRef.current.yaw + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
      pitch: clamp(cameraRef.current.pitch + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), -1.35, 1.35),
      zoom: clamp(cameraRef.current.zoom * (event.key === '+' || event.key === '=' ? 1.06 : event.key === '-' || event.key === '_' ? 0.94 : 1), 0.72, 1.18),
    };
    markCameraCustom();
  };

  if (loading) return <div className={styles.empty}>Loading measured and video-derived seam orientations…</div>;
  if (!samples.length) return <div className={styles.empty}>
    <strong>No seam-enabled pitches in the active filters</strong>
    <span>{schoolCode === 'PRO' ? 'Public pro data does not contain measured seam orientation or linked Edger video estimates.' : 'Adjust the dates, pitcher, pitch type, or other sidebar filters to include a measured or accepted video-derived pitch.'}</span>
  </div>;

  return <section className={styles.shell} aria-label="Filtered measured and video-derived spin visual">
    <div className={styles.toolbar}>
      {hasMeasuredSamples ? <label className={styles.conventionPicker}>TrackMan rotation convention
        <select value={selectedConventionId} onChange={(event) => setSelectedConventionId(event.target.value)}>
          {CONVENTIONS.map((value) => <option key={conventionId(value)} value={conventionId(value)}>{value.intrinsic ? 'Intrinsic' : 'Extrinsic'} {value.order} · {value.intrinsic ? 'local axes' : 'fixed axes'}</option>)}
        </select>
      </label> : <div className={styles.videoReference}><span>Orientation source</span><b>Edger camera fit · fixed XYZ</b></div>}
      <div className={styles.cameraPicker} aria-label="Spin camera view"><span>View</span>
        {(['pitcher', 'catcher'] as SpinCameraPreset[]).map((preset) => <button key={preset} type="button" className={cameraMode === preset ? styles.cameraActive : ''} aria-pressed={cameraMode === preset} onClick={() => resetCamera(preset)}>{preset === 'pitcher' ? 'Pitcher' : 'Catcher'}</button>)}
        <b>{cameraMode === 'custom' ? 'Custom 3D' : `${cameraMode} view`}</b>
      </div>
      <div className={styles.playback}>
        <button type="button" className={styles.playButton} aria-pressed={!playing} onClick={() => setPlaying((current) => !current)}>{playing ? '❚❚ Pause all' : '▶ Play all'}</button>
        <button type="button" onClick={reset}>Reset</button>
        <button type="button" onClick={() => setDirection((current) => current === 1 ? -1 : 1)}>{direction === 1 ? 'Observed direction' : 'Reverse test'}</button>
        <button type="button" className={axisVisible ? styles.axisActive : ''} aria-pressed={axisVisible} onClick={() => setAxisVisible((current) => !current)}>Axis rod {axisVisible ? 'on' : 'off'}</button>
        <label>Visual speed<select value={speedScale} onChange={(event) => setSpeedScale(Number(event.target.value))}>{SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
      </div>
    </div>

    <div className={styles.grid}>
      {displayedSamples.map((sample, index) => {
        const sceneAxis = sceneAxisFor(sample);
        const breakdown = breakdowns[index];
        const efficiency = spinEfficiencyPercent(sample);
        const candidates = samplesByType.get(sample.pitchType) ?? [];
        const selectedKey = selectedKeyByType.get(sample.pitchType) ?? '';
        return <article key={sample.pitchType} className={styles.option} style={{ '--pitch-color': PITCH_COLORS[sample.pitchType] ?? PITCH_COLORS.Undefined } as CSSProperties}>
          <div className={styles.pitchHeader}><div><span className={styles.pitchDot} /><h5>{sample.pitchType}</h5><span className={`${styles.sourceBadge} ${sample.source === 'edger_video' ? styles.videoBadge : styles.measuredBadge}`}>{sample.source === 'edger_video' ? `Video-derived${sample.confidence !== null && sample.confidence !== undefined ? ` · ${Math.round(sample.confidence * 100)}%` : ''}` : 'TrackMan measured'}</span></div><span>{sample.pitcher ?? 'Unknown pitcher'} · {displayDate(sample.sampleDate)}</span></div>
          {candidates.length > 1 ? (
            <select
              className={styles.pitchInstanceSelect}
              aria-label={`${sample.pitchType} pitch source`}
              value={selectedKey}
              onChange={(event) => selectSampleForType(sample.pitchType, event.target.value)}
            >
              <option value="">Most recent ({candidates.length} available)</option>
              {candidates.map((candidate) => (
                <option key={sampleKey(candidate)} value={sampleKey(candidate)}>{sampleLabel(candidate)}</option>
              ))}
            </select>
          ) : null}
          <canvas ref={(node) => { canvasRefs.current[index] = node; }} className={styles.ballCanvas} role="img" tabIndex={0} aria-label={`${sample.pitchType} baseball using ${selectedConvention.intrinsic ? 'intrinsic' : 'extrinsic'} ${selectedConvention.order}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onWheel={handleWheel} onKeyDown={handleCameraKey} />
          <div className={styles.pitchFacts}>
            <span>Velo <b>{sample.velocity?.toFixed(1) ?? '—'} mph</b></span><span>Spin <b>{Math.round(sample.spinRate).toLocaleString()} rpm</b></span><span>Efficiency <b>{efficiency?.toFixed(1) ?? '—'}%</b></span><span title={`${cameraMode === 'catcher' ? 'Catcher' : 'Pitcher'}-view release tilt`}>rTilt <b>{visualReleaseTilt(sample, cameraMode)}</b></span><span>bTilt <b>{displayTilt(sample.breakTilt)}</b></span>
          </div>
          <div className={styles.forceGrid}>
            <div><span>Magnus model</span><b>{movement(breakdown.magnus?.ivb ?? null)} IVB</b><b>{movement(breakdown.magnus?.hb ?? null)} HB</b></div>
            <div className={styles.residualForce}><span>SSW / residual*</span><b>{movement(breakdown.residual?.ivb ?? null)} IVB</b><b>{movement(breakdown.residual?.hb ?? null)} HB</b></div>
            <div className={styles.totalForce}><span>Measured total</span><b>{movement(sample.inducedVerticalBreak)} IVB</b><b>{movement(sample.horizontalBreak)} HB</b></div>
          </div>
          <details className={styles.rawDetails}><summary>{sample.source === 'edger_video' ? 'Video fit details' : 'Measured coordinate details'}</summary><code>{sample.source === 'edger_video' ? 'Edger camera XYZ' : 'TrackMan XYZ'} {sample.spinAxis.x.toFixed(3)}, {sample.spinAxis.y.toFixed(3)}, {sample.spinAxis.z.toFixed(3)}</code><code>Scene axis {sceneAxis.x.toFixed(3)}, {sceneAxis.y.toFixed(3)}, {sceneAxis.z.toFixed(3)}</code><code>Rotation {sample.seamRotation.x.toFixed(2)}°, {sample.seamRotation.y.toFixed(2)}°, {sample.seamRotation.z.toFixed(2)}°</code><code>{sample.pitchUid ?? 'PitchUID unavailable'}</code>{sample.source === 'edger_video' && sample.sourceUrl ? <a href={sample.sourceUrl} target="_blank" rel="noreferrer">Open source Edger clip</a> : null}</details>
        </article>;
      })}
    </div>
    <p className={styles.note}>* The residual is measured total movement minus a standard-air Magnus model. It is an SSW candidate, not a pure SSW measurement. “Video-derived” means the seam pose was fitted from the linked Edger sequence. The rotation axis is video-fitted when identifiable; otherwise measured TrackMan tilt and efficiency constrain it and held-out video frames select the gyro direction. The initial pitcher view matches the Edger camera reference and can then be orbited in 3D. TrackMan-measured seam coordinates still take precedence when both sources exist.</p>
  </section>;
}

'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  formatTiltClock,
  simulatePitchSpin,
  spinQuaternion,
  type SpinQuaternion,
  type SpinVector,
} from '../../../lib/pitch-spin-simulator';
import type { SpinBaseballRenderer } from './spin-baseball-renderer';
import styles from './spin-designer-panel.module.css';
import type { SswModelPrediction } from '../../../lib/ssw-model-runtime';

type CameraPreset = 'pitcher' | 'catcher';
type CameraMode = CameraPreset | 'custom';
type Camera = { preset: CameraPreset; yaw: number; pitch: number; zoom: number };

const CAMERA_YAW: Record<CameraPreset, number> = { pitcher: Math.PI / 2, catcher: -Math.PI / 2 };
const freshCamera = (preset: CameraPreset): Camera => ({ preset, yaw: CAMERA_YAW[preset], pitch: 0, zoom: 0.88 });
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

function multiplyQuaternion(a: SpinQuaternion, b: SpinQuaternion): SpinQuaternion {
  return {
    w: (a.w * b.w) - (a.x * b.x) - (a.y * b.y) - (a.z * b.z),
    x: (a.w * b.x) + (a.x * b.w) + (a.y * b.z) - (a.z * b.y),
    y: (a.w * b.y) - (a.x * b.z) + (a.y * b.w) + (a.z * b.x),
    z: (a.w * b.z) + (a.x * b.y) - (a.y * b.x) + (a.z * b.w),
  };
}

function signed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}″`;
}

function RangeField({ label, value, minimum, maximum, step, unit, onChange }: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.rangeField}>
      <span>{label}<b>{value.toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit}</b></span>
      <input
        type="range"
        min={minimum}
        max={maximum}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function SpinDesignerPanel() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<SpinBaseballRenderer | null>(null);
  const cameraRef = useRef<Camera>(freshCamera('pitcher'));
  const dragRef = useRef<{ pointerId: number; x: number; y: number; yaw: number; pitch: number } | null>(null);
  const elapsedRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [axisVisible, setAxisVisible] = useState(true);
  const [cameraMode, setCameraMode] = useState<CameraMode>('pitcher');
  const [tiltMinutes, setTiltMinutes] = useState(90);
  const [spinEfficiency, setSpinEfficiency] = useState(95);
  const [spinRate, setSpinRate] = useState(2300);
  const [velocity, setVelocity] = useState(92);
  const [extension, setExtension] = useState(6);
  const [releaseHeight, setReleaseHeight] = useState(6);
  const [releaseSide, setReleaseSide] = useState(1.5);
  const [gyroDirection, setGyroDirection] = useState<1 | -1>(1);
  const [seamOrientation, setSeamOrientation] = useState<SpinVector>({ x: 0, y: 0, z: 0 });
  const [modelPredictor, setModelPredictor] = useState<((input: Parameters<typeof import('../../../lib/ssw-model-runtime').predictSswMovement>[0]) => SswModelPrediction) | null>(null);
  const [elevation, setElevation] = useState(1100);
  const [temperature, setTemperature] = useState(75);
  const [humidity, setHumidity] = useState(30);
  const [headwind, setHeadwind] = useState(0);
  const [crosswind, setCrosswind] = useState(0);
  const tiltClock = formatTiltClock(tiltMinutes);
  const axisClock = `${formatTiltClock(tiltMinutes - 180)}–${formatTiltClock(tiltMinutes + 180)}`;

  const simulation = useMemo(() => simulatePitchSpin({
    velocityMph: velocity,
    spinRateRpm: spinRate,
    spinEfficiencyPercent: spinEfficiency,
    tiltClock,
    gyroDirection,
    extensionFeet: extension,
    seamOrientation,
    sswInfluencePercent: 0,
    elevationFeet: elevation,
    temperatureF: temperature,
    humidityPercent: humidity,
    headwindMph: headwind,
    crosswindMph: crosswind,
  }), [crosswind, elevation, extension, gyroDirection, headwind, humidity, seamOrientation, spinEfficiency, spinRate, temperature, tiltClock, velocity]);

  const modelPrediction = useMemo(() => modelPredictor?.({
    velocityMph: velocity, spinRateRpm: spinRate, spinEfficiencyPercent: spinEfficiency,
    extensionFeet: extension, releaseHeightFeet: releaseHeight, releaseSideFeet: releaseSide,
    sceneSpinAxis: simulation.spinAxis, seamOrientation,
  }) ?? null, [extension, modelPredictor, releaseHeight, releaseSide, seamOrientation, simulation.spinAxis, spinEfficiency, spinRate, velocity]);
  const predictedTotal = {
    hb: simulation.magnus.hb + (modelPrediction?.hb ?? 0) + simulation.environment.hb,
    ivb: simulation.magnus.ivb + (modelPrediction?.ivb ?? 0) + simulation.environment.ivb,
  };

  useEffect(() => {
    let active = true;
    void import('../../../lib/ssw-model-runtime').then((module) => { if (active) setModelPredictor(() => module.predictSswMovement); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void import('./spin-baseball-renderer').then(({ SpinBaseballRenderer: Renderer }) => {
      if (!active) return;
      rendererRef.current = new Renderer();
    });
    return () => {
      active = false;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    let frameId = 0;
    const render = (timestamp: number) => {
      const previous = lastFrameRef.current ?? timestamp;
      if (playing) elapsedRef.current += (timestamp - previous) / 1000;
      lastFrameRef.current = timestamp;
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      if (canvas && renderer) {
        const spinAngle = elapsedRef.current * spinRate * Math.PI * 2 / 60 * 0.025;
        const orientation = multiplyQuaternion(
          spinQuaternion(simulation.spinAxis, spinAngle),
          simulation.seamQuaternion,
        );
        renderer.render(canvas, orientation, cameraRef.current, {
          axis: { visible: axisVisible, ...simulation.spinAxis },
        });
      }
      frameId = window.requestAnimationFrame(render);
    };
    frameId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frameId);
  }, [axisVisible, playing, simulation.seamQuaternion, simulation.spinAxis, spinRate]);

  const resetCamera = (preset: CameraPreset) => {
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
      yaw: drag.yaw - ((event.clientX - drag.x) * 0.009),
      pitch: clamp(drag.pitch + ((event.clientY - drag.y) * 0.007), -1.35, 1.35),
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
      zoom: clamp(cameraRef.current.zoom * Math.exp(-event.deltaY * 0.001), 0.62, 1.16),
    };
    markCameraCustom();
  };

  const handleKey = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === ' ') {
      event.preventDefault();
      setPlaying((current) => !current);
      return;
    }
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
      pitch: clamp(cameraRef.current.pitch + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), -1.35, 1.35),
      zoom: clamp(cameraRef.current.zoom * (event.key === '+' || event.key === '=' ? 1.06 : event.key === '-' || event.key === '_' ? 0.94 : 1), 0.62, 1.16),
    };
    markCameraCustom();
  };

  const setSeamAxis = (axis: keyof SpinVector, value: number) => {
    setSeamOrientation((current) => ({ ...current, [axis]: value }));
  };

  const resetSpin = () => {
    elapsedRef.current = 0;
    lastFrameRef.current = null;
    setPlaying(false);
  };

  return (
    <section className={styles.shell} aria-label="Custom spin visual and movement model">
      <div className={styles.workspace}>
        <div className={styles.visualStage}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            role="img"
            tabIndex={0}
            aria-label={`${playing ? 'Spinning' : 'Paused'} custom baseball with ${axisVisible ? 'spin axis rod visible' : 'spin axis rod hidden'}. Drag to orbit, scroll to zoom, or press Space to pause.`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onWheel={handleWheel}
            onKeyDown={handleKey}
          />
          <div className={styles.visualHud}>
            <span><b>{tiltClock}</b> release tilt</span>
            <span><b>{spinEfficiency}%</b> spin efficiency</span>
          </div>
          <div className={styles.visualControls}>
            <button type="button" className={styles.primaryButton} onClick={() => setPlaying((current) => !current)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
            <button type="button" onClick={resetSpin}>Reset</button>
            <button type="button" className={axisVisible ? styles.controlActive : ''} aria-pressed={axisVisible} onClick={() => setAxisVisible((current) => !current)}>Axis rod {axisVisible ? 'on' : 'off'}</button>
            <div className={styles.viewSwitch}>
              {(['pitcher', 'catcher'] as CameraPreset[]).map((preset) => (
                <button key={preset} type="button" className={cameraMode === preset ? styles.controlActive : ''} onClick={() => resetCamera(preset)}>{preset}</button>
              ))}
            </div>
          </div>
          <span className={styles.orbitHint}>{cameraMode === 'custom' ? 'Custom 3D · clock reference changes with orbit' : `${cameraMode} view`} · drag to orbit · scroll to zoom</span>
        </div>

        <aside className={styles.controls}>
          <section className={styles.controlGroup}>
            <div className={styles.groupTitle}><span>01</span><h5>Release spin</h5></div>
            <label className={styles.rangeField}>
              <span>Release tilt<b>{tiltClock}</b></span>
              <input type="range" min={0} max={715} step={5} value={tiltMinutes} onChange={(event) => setTiltMinutes(Number(event.target.value))} />
            </label>
            <p className={styles.axisNote}>Tilt is TrackMan&apos;s movement clock. The physical axis rod is perpendicular: {tiltClock} tilt = {axisClock} axis line in the reference view.</p>
            <RangeField label="Spin efficiency" value={spinEfficiency} minimum={0} maximum={100} step={1} unit="%" onChange={setSpinEfficiency} />
            <RangeField label="Spin rate" value={spinRate} minimum={500} maximum={3500} step={25} unit=" rpm" onChange={setSpinRate} />
            <RangeField label="Velocity" value={velocity} minimum={55} maximum={105} step={0.5} unit=" mph" onChange={setVelocity} />
            <RangeField label="Extension" value={extension} minimum={3} maximum={9} step={0.1} unit=" ft" onChange={setExtension} />
            <RangeField label="Release height" value={releaseHeight} minimum={3} maximum={8} step={0.1} unit=" ft" onChange={setReleaseHeight} />
            <RangeField label="Release side" value={releaseSide} minimum={-5} maximum={5} step={0.1} unit=" ft" onChange={setReleaseSide} />
            <div className={styles.inlineChoice}>
              <span>Gyro direction</span>
              <button type="button" className={gyroDirection === 1 ? styles.choiceActive : ''} onClick={() => setGyroDirection(1)}>Toward plate</button>
              <button type="button" className={gyroDirection === -1 ? styles.choiceActive : ''} onClick={() => setGyroDirection(-1)}>Toward mound</button>
            </div>
          </section>

          <section className={styles.controlGroup}>
            <div className={styles.groupTitle}><span>02</span><h5>Seam orientation</h5></div>
            <div className={styles.presetRow}>
              <button type="button" onClick={() => setSeamOrientation({ x: 0, y: 0, z: 0 })}>Neutral</button>
              <button type="button" onClick={() => setSeamOrientation({ x: 0, y: 90, z: 0 })}>Quarter turn</button>
              <button type="button" onClick={() => setSeamOrientation({ x: 35, y: 20, z: 45 })}>Offset</button>
            </div>
            <RangeField label="Seam X" value={seamOrientation.x} minimum={-180} maximum={180} step={1} unit="°" onChange={(value) => setSeamAxis('x', value)} />
            <RangeField label="Seam Y" value={seamOrientation.y} minimum={-180} maximum={180} step={1} unit="°" onChange={(value) => setSeamAxis('y', value)} />
            <RangeField label="Seam Z" value={seamOrientation.z} minimum={-180} maximum={180} step={1} unit="°" onChange={(value) => setSeamAxis('z', value)} />
          </section>
        </aside>
      </div>

      <div className={styles.movementGrid}>
        <article className={styles.movementCard}>
          <span>Magnus</span><strong>{signed(simulation.magnus.ivb)} IVB</strong><strong>{signed(simulation.magnus.hb)} HB</strong>
          <small>Physics-based lift estimate</small>
        </article>
        <article className={`${styles.movementCard} ${styles.sswCard}`}>
          <span>Modeled seam contribution</span><strong>{modelPrediction ? signed(modelPrediction.seamIvb) : 'Loading…'} IVB</strong><strong>{modelPrediction ? signed(modelPrediction.seamHb) : 'Loading…'} HB</strong>
          <small>Full model minus matched no-seam model</small>
        </article>
        <article className={styles.movementCard}>
          <span>Other modeled residual</span><strong>{modelPrediction ? signed(modelPrediction.contextIvb) : 'Loading…'} IVB</strong><strong>{modelPrediction ? signed(modelPrediction.contextHb) : 'Loading…'} HB</strong>
          <small>Release/spin correction not attributed to seams</small>
        </article>
        <article className={styles.movementCard}>
          <span>Wind contribution</span><strong>{signed(simulation.environment.ivb)} IVB</strong><strong>{signed(simulation.environment.hb)} HB</strong>
          <small>Relative to still air</small>
        </article>
        <article className={`${styles.movementCard} ${styles.totalCard}`}>
          <span>Total predicted</span><strong>{signed(predictedTotal.ivb)} IVB</strong><strong>{signed(predictedTotal.hb)} HB</strong>
          <small>{simulation.flightTimeSeconds.toFixed(3)} s flight · {modelPrediction ? `80% error radius ±${modelPrediction.errorRadius80.toFixed(1)}″` : 'loading model'}</small>
        </article>
      </div>

      <details className={styles.environment}>
        <summary><span>Environment settings</span><b>{elevation.toLocaleString()} ft · {temperature}°F · {humidity}% RH</b></summary>
        <div className={styles.environmentGrid}>
          <RangeField label="Elevation" value={elevation} minimum={-100} maximum={8000} step={100} unit=" ft" onChange={setElevation} />
          <RangeField label="Temperature" value={temperature} minimum={30} maximum={110} step={1} unit="°F" onChange={setTemperature} />
          <RangeField label="Humidity" value={humidity} minimum={0} maximum={100} step={1} unit="%" onChange={setHumidity} />
          <RangeField label="Headwind" value={headwind} minimum={-20} maximum={20} step={1} unit=" mph" onChange={setHeadwind} />
          <RangeField label="Crosswind" value={crosswind} minimum={-20} maximum={20} step={1} unit=" mph" onChange={setCrosswind} />
        </div>
        <p>Modeled air density: {simulation.airDensityKgM3.toFixed(3)} kg/m³ · Lift coefficient: {simulation.liftCoefficient.toFixed(3)} · SSW coefficient: {simulation.sswCoefficient.toFixed(3)}</p>
      </details>

      <div className={styles.disclaimer}>
        <strong>How to read this model</strong>
        <p>Magnus uses a published baseball lift relationship and numerical flight integration. The residual model is learned from 255,560 unique TrackMan pitches using velocity, spin, release geometry, 3D axis, and seam orientation—never tagged pitch type. “Modeled seam contribution” is the difference between matched models with and without seam inputs; it is an attribution estimate, not a directly measured SSW force. Uncertainty is calibrated on pitchers the model never saw during training.</p>
      </div>
    </section>
  );
}

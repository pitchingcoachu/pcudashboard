'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import testPitchJson from '../../../public/mocap/pcu-three-camera-test.json';
import tjKenyonPitchJson from '../../../public/mocap/pcu-tj-kenyon-five-camera.json';
import generatedPitchJson from '../../../public/mocap/pcu-mocap-generated.json';
import MocapAnatomicalViewer from './mocap-anatomical-viewer';

type EventKey = 'footPlant' | 'maxEr' | 'ballRelease';

type MocapEvent = {
  key: EventKey;
  label: string;
  frame: number;
  time: number;
};

type MocapPoint = {
  frame: number;
  time: number;
  value: number;
};

type MocapMetric = {
  key: string;
  label: string;
  unit: string;
  group: 'angle' | 'velocity';
  eventValues: Record<EventKey, number | null>;
  series: MocapPoint[];
};

type MocapVideo = {
  id: string;
  label: string;
  url: string;
};

type SkeletonFrame = {
  frame: number;
  time: number;
  points: [number, number, number][];
};

type MocapSkeleton = {
  landmarks: string[];
  connections: [string, string][];
  frames: SkeletonFrame[];
  hands?: Partial<Record<'left' | 'right', SkeletonFrame[]>>;
};

type MocapPayload = {
  datasetKey: string;
  athlete: string;
  title: string;
  recordedAt: string;
  source: string;
  handedness: string;
  cameraCount: number;
  captureFps: number;
  analysisWindow: { startFrame: number; endFrame: number; durationSec: number };
  events: MocapEvent[];
  metrics: MocapMetric[];
  videos: MocapVideo[];
  skeleton: MocapSkeleton;
  notes: string[];
  isAverage?: boolean;
  pitchCount?: number;
};

const PITCH_DATASETS = [
  testPitchJson,
  tjKenyonPitchJson,
  ...(generatedPitchJson as unknown as MocapPayload[]),
] as unknown as MocapPayload[];
const EVENT_COLORS: Record<EventKey, string> = {
  footPlant: '#eab96e',
  maxEr: '#e61e49',
  ballRelease: '#59a9e5',
};
const EVENT_PRESENTATION: Record<EventKey, { abbreviation: string; label: string }> = {
  footPlant: { abbreviation: 'FC', label: 'Foot Contact' },
  maxEr: { abbreviation: 'MER', label: 'Maximum External Rotation' },
  ballRelease: { abbreviation: 'BR', label: 'Ball Release' },
};
const METRIC_COLORS = [
  '#e61e49', '#59a9e5', '#52d5a1', '#eab96e', '#c9a5ef',
];
const EVENT_ONLY_METRICS: Record<string, EventKey> = {
  armAngle: 'ballRelease',
  strideDirection: 'footPlant',
  strideLength: 'footPlant',
  extension: 'ballRelease',
};
const KINEMATIC_SEQUENCE_KEYS = [
  'pelvisRotationalVelocity',
  'torsoRotationalVelocity',
  'elbowExtensionVelocity',
  'shoulderInternalRotationVelocity',
];

const KINEMATIC_SEQUENCE_LABELS: Record<string, string> = {
  pelvisRotationalVelocity: 'Pelvis',
  torsoRotationalVelocity: 'Torso',
  elbowExtensionVelocity: 'Elbow',
  shoulderInternalRotationVelocity: 'Shoulder',
};

type EventFrameOverrides = {
  footContactFrame?: number;
  ballReleaseFrame?: number;
};

function applyEventFrames(pitch: MocapPayload, overrides: EventFrameOverrides): MocapPayload {
  const originalFootContact = pitch.events.find((event) => event.key === 'footPlant');
  const originalBallRelease = pitch.events.find((event) => event.key === 'ballRelease');
  const shoulderEr = pitch.metrics.find((metric) => metric.key === 'shoulderEr');
  if (!originalFootContact || !originalBallRelease || !shoulderEr) return pitch;

  const footContactFrame = overrides.footContactFrame ?? originalFootContact.frame;
  const ballReleaseFrame = overrides.ballReleaseFrame ?? originalBallRelease.frame;
  if (ballReleaseFrame <= footContactFrame) return pitch;

  const contactPoint = shoulderEr.series.find((point) => point.frame === footContactFrame);
  const releasePoint = shoulderEr.series.find((point) => point.frame === ballReleaseFrame);
  const maxErPoint = shoulderEr.series
    .filter((point) => point.frame >= footContactFrame && point.frame <= ballReleaseFrame)
    .reduce<MocapPoint | null>((best, point) => (!best || point.value > best.value ? point : best), null);
  if (!contactPoint || !releasePoint || !maxErPoint) return pitch;

  const events = pitch.events.map((event) => {
    if (event.key === 'footPlant') return { ...event, frame: contactPoint.frame, time: contactPoint.time };
    if (event.key === 'maxEr') return { ...event, frame: maxErPoint.frame, time: maxErPoint.time };
    if (event.key === 'ballRelease') return { ...event, frame: releasePoint.frame, time: releasePoint.time };
    return event;
  });
  const eventFrames = Object.fromEntries(events.map((event) => [event.key, event.frame])) as Record<EventKey, number>;
  const metrics = pitch.metrics.map((metric) => ({
    ...metric,
    eventValues: Object.fromEntries(
      (Object.keys(eventFrames) as EventKey[]).map((eventKey) => {
        const value = metric.series.find((point) => point.frame === eventFrames[eventKey])?.value ?? metric.eventValues[eventKey];
        const outsideDefinedEvent = EVENT_ONLY_METRICS[metric.key] && eventKey !== EVENT_ONLY_METRICS[metric.key];
        return [eventKey, outsideDefinedEvent || (metric.key === 'extension' && value !== null && value <= 0) ? null : value];
      })
    ) as Record<EventKey, number | null>,
  }));
  return { ...pitch, events, metrics };
}

function formatMetricValue(value: number | null, unit: string, compact = false, metricKey = '') {
  if (value === null) return '';
  if (metricKey === 'strideDirection') {
    const direction = Math.abs(value) < 0.05 ? 'Square' : value > 0 ? 'Open' : 'Closed';
    return `${Math.abs(value).toFixed(1)}° ${direction}`;
  }
  if (unit === 'ft') return `${value.toFixed(compact ? 1 : 2)} ft`;
  if (unit === 'ft/s') return `${value.toFixed(1)} ft/s`;
  if (unit === 'deg/s') return `${value.toFixed(0)}°/s`;
  return `${value.toFixed(1)}°`;
}

function axisLabel(unit: string) {
  if (unit === 'deg') return 'Degrees';
  if (unit === 'deg/s') return 'Degrees / Second';
  if (unit === 'ft/s') return 'Feet / Second';
  return 'Feet';
}

function peakMetricPoint(metric: MocapMetric, events?: MocapEvent[]) {
  const footContact = events?.find((event) => event.key === 'footPlant');
  const ballRelease = events?.find((event) => event.key === 'ballRelease');
  const eventWindow = footContact && ballRelease
    ? metric.series.filter((point) => point.frame >= footContact.frame && point.frame <= ballRelease.frame)
    : metric.series;
  const series = eventWindow.length ? eventWindow : metric.series;
  return series.reduce((peak, point) => point.value > peak.value ? point : peak, series[0]);
}

function maxMetricSpeed(metric: MocapMetric, events?: MocapEvent[]) {
  return peakMetricPoint(metric, events).value;
}

function millisecondsBetween(from: number, to: number) {
  return Math.round((to - from) * 1000);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function buildAveragePitch(pitches: MocapPayload[]): MocapPayload {
  const sorted = [...pitches].sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt));
  const template = sorted[sorted.length - 1];
  const sampleCount = 101;
  const averageDuration = average(sorted.map((pitch) => pitch.analysisWindow.durationSec));
  const metricKeys = template.metrics.map((metric) => metric.key);
  const metrics = metricKeys.map((metricKey) => {
    const pitchMetrics = sorted
      .map((pitch) => pitch.metrics.find((metric) => metric.key === metricKey))
      .filter((metric): metric is MocapMetric => Boolean(metric));
    const metricTemplate = pitchMetrics[0];
    const series = Array.from({ length: sampleCount }, (_, index) => {
      const progress = index / (sampleCount - 1);
      const values = pitchMetrics.map((metric) => {
        const pointIndex = Math.min(metric.series.length - 1, Math.round(progress * (metric.series.length - 1)));
        return metric.series[pointIndex].value;
      });
      return { frame: index, time: progress * averageDuration, value: average(values) };
    });
    const eventValues = Object.fromEntries((['footPlant', 'maxEr', 'ballRelease'] as EventKey[]).map((eventKey) => {
      const values = pitchMetrics.map((metric) => metric.eventValues[eventKey]).filter((value): value is number => value !== null);
      return [eventKey, values.length ? average(values) : null];
    })) as Record<EventKey, number | null>;
    return { ...metricTemplate, eventValues, series };
  });
  const events = (['footPlant', 'maxEr', 'ballRelease'] as EventKey[]).map((eventKey) => {
    const positions = sorted.map((pitch) => {
      const event = pitch.events.find((candidate) => candidate.key === eventKey)!;
      const startFrame = pitch.analysisWindow.startFrame;
      const endFrame = pitch.analysisWindow.endFrame;
      return (event.frame - startFrame) / Math.max(endFrame - startFrame, 1);
    });
    const progress = average(positions);
    return {
      key: eventKey,
      label: EVENT_PRESENTATION[eventKey].abbreviation,
      frame: Math.round(progress * (sampleCount - 1)),
      time: progress * averageDuration,
    };
  });
  return {
    ...template,
    datasetKey: `average-${template.athlete.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${sorted[0].recordedAt.slice(0, 10)}-${sorted[sorted.length - 1].recordedAt.slice(0, 10)}`,
    title: `Average · ${sorted.length} Pitches`,
    recordedAt: sorted[sorted.length - 1].recordedAt,
    analysisWindow: { startFrame: 0, endFrame: sampleCount - 1, durationSec: averageDuration },
    events,
    metrics,
    isAverage: true,
    pitchCount: sorted.length,
    notes: [`Average profile for ${sorted.length} pitches in the selected date range.`, ...template.notes],
  };
}

function niceAxisStep(roughStep: number) {
  if (!Number.isFinite(roughStep) || roughStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function formatAxisTick(value: number, unit: string, step: number) {
  const decimals = step >= 1 ? 0 : Math.min(2, Math.ceil(-Math.log10(step)));
  return `${value.toFixed(decimals)}${unit.startsWith('deg') ? '°' : ''}`;
}

function MetricChart({
  metrics,
  events,
  playheadTime,
  onSeek,
}: {
  metrics: MocapMetric[];
  events: MocapEvent[];
  playheadTime: number;
  onSeek: (time: number) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const isDragging = useRef(false);
  const width = 1000;
  const height = 420;
  const units = Array.from(new Set(metrics.map((metric) => metric.unit)));
  const hasSecondAxis = units.length > 1;
  const plot = { left: 76, right: hasSecondAxis ? 78 : 26, top: 28, bottom: 58 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const primaryMetric = metrics[0];
  const frames = primaryMetric.series.map((point) => point.frame);
  const minFrame = Math.min(...frames);
  const maxFrame = Math.max(...frames);
  const frameRange = Math.max(maxFrame - minFrame, 1);
  const relativeFrame = (frame: number) => frame - minFrame;
  const x = (frame: number) => plot.left + ((frame - minFrame) / frameRange) * plotWidth;
  const scales = new Map<string, { min: number; max: number; range: number; step: number; ticks: number[] }>();
  units.forEach((unit) => {
    const values = metrics.filter((metric) => metric.unit === unit).flatMap((metric) => metric.series.map((point) => point.value));
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const minimumPadding = unit.startsWith('ft') ? 0.25 : 4;
    const valuePadding = Math.max((rawMax - rawMin) * 0.13, minimumPadding);
    const paddedMin = Math.min(0, rawMin - valuePadding);
    const paddedMax = Math.max(0, rawMax + valuePadding);
    const step = niceAxisStep((paddedMax - paddedMin) / 5);
    const min = Math.floor(paddedMin / step) * step;
    const max = Math.ceil(paddedMax / step) * step;
    const range = Math.max(max - min, unit.startsWith('ft') ? 0.5 : 1);
    const intervalCount = Math.max(1, Math.round(range / step));
    const ticks = Array.from({ length: intervalCount + 1 }, (_, index) => Number((min + step * index).toPrecision(12)));
    scales.set(unit, { min, max, range, step, ticks });
  });
  const y = (metric: MocapMetric, value: number) => {
    const scale = scales.get(metric.unit)!;
    return plot.top + (1 - (value - scale.min) / scale.range) * plotHeight;
  };
  const pathFor = (metric: MocapMetric) => metric.series
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.frame).toFixed(2)} ${y(metric, point.value).toFixed(2)}`)
    .join(' ');
  const frameTickStep = Math.max(1, niceAxisStep(frameRange / 8));
  const xTicks = Array.from({ length: Math.floor(frameRange / frameTickStep) + 1 }, (_, index) => minFrame + index * frameTickStep);
  const hovered = hoveredIndex === null ? null : primaryMetric.series[hoveredIndex];
  const nearestPoint = (metric: MocapMetric, time: number) => metric.series.reduce((nearest, point) => (
    Math.abs(point.time - time) < Math.abs(nearest.time - time) ? point : nearest
  ), metric.series[0]);
  const playhead = nearestPoint(primaryMetric, playheadTime);

  const pointFromPointer = (event: ReactPointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const viewX = ((event.clientX - bounds.left) / bounds.width) * width;
    const frame = Math.max(minFrame, Math.min(maxFrame, minFrame + ((viewX - plot.left) / plotWidth) * frameRange));
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    primaryMetric.series.forEach((point, index) => {
      const distance = Math.abs(point.frame - frame);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    return { nearestIndex, time: primaryMetric.series[nearestIndex]?.time ?? playheadTime };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const point = pointFromPointer(event);
    const nearestIndex = point.nearestIndex;
    setHoveredIndex(nearestIndex);
    if (isDragging.current) onSeek(point.time);
  };

  return (
    <div className="pcu-mocap-chart-shell">
      <div className="pcu-mocap-series-legend" aria-label="Selected metric legend">
        {metrics.map((metric, index) => (
          <span key={metric.key}><i style={{ background: METRIC_COLORS[index % METRIC_COLORS.length] }} />{metric.label}<small>{metric.unit}</small></span>
        ))}
      </div>
      <svg
        className="pcu-mocap-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${metrics.map((metric) => metric.label).join(', ')} from the start to the end of the throw`}
      >
        {scales.get(units[0])!.ticks.map((tick) => (
          <g key={tick}>
            <line x1={plot.left} x2={width - plot.right} y1={y(primaryMetric, tick)} y2={y(primaryMetric, tick)} className={`pcu-mocap-grid-line${Math.abs(tick) < 1e-6 ? ' is-zero' : ''}`} />
            <text x={plot.left - 16} y={y(primaryMetric, tick) + 5} textAnchor="end" className="pcu-mocap-axis-text">
              {formatAxisTick(tick, units[0], scales.get(units[0])!.step)}
            </text>
          </g>
        ))}
        {hasSecondAxis ? scales.get(units[1])!.ticks.map((tick) => {
          const metric = metrics.find((candidate) => candidate.unit === units[1])!;
          return (
            <text key={tick} x={width - plot.right + 14} y={y(metric, tick) + 5} textAnchor="start" className="pcu-mocap-axis-text">
              {formatAxisTick(tick, units[1], scales.get(units[1])!.step)}
            </text>
          );
        }) : null}
        {xTicks.map((tick) => (
          <text key={tick} x={x(tick)} y={height - 22} textAnchor="middle" className="pcu-mocap-axis-text">
            {relativeFrame(tick)}
          </text>
        ))}

        {events.map((event) => (
          <g key={event.key}>
            <line
              x1={x(event.frame)}
              x2={x(event.frame)}
              y1={plot.top}
              y2={height - plot.bottom}
              stroke={EVENT_COLORS[event.key]}
              strokeWidth="2"
              strokeDasharray="7 7"
              opacity=".82"
            />
          </g>
        ))}

        {metrics.map((metric, index) => (
          <path key={metric.key} d={pathFor(metric)} fill="none" stroke={METRIC_COLORS[index % METRIC_COLORS.length]} strokeWidth={metrics.length === 1 ? 4 : 3} strokeLinecap="round" strokeLinejoin="round" />
        ))}

        {playhead ? (
          <g pointerEvents="none">
            <line
              x1={x(playhead.frame)}
              x2={x(playhead.frame)}
              y1={plot.top}
              y2={height - plot.bottom}
              className="pcu-mocap-playhead-line"
            />
            {metrics.map((metric, index) => {
              const point = nearestPoint(metric, playhead.time);
              return <circle key={metric.key} cx={x(point.frame)} cy={y(metric, point.value)} r="7" style={{ fill: METRIC_COLORS[index % METRIC_COLORS.length] }} className="pcu-mocap-playhead-point" />;
            })}
          </g>
        ) : null}

        {hovered ? (
          <g pointerEvents="none">
            <line
              x1={x(hovered.frame)}
              x2={x(hovered.frame)}
              y1={plot.top}
              y2={height - plot.bottom}
              className="pcu-mocap-hover-line"
            />
            {metrics.map((metric, index) => {
              const point = nearestPoint(metric, hovered.time);
              return <circle key={metric.key} cx={x(point.frame)} cy={y(metric, point.value)} r="6" style={{ fill: METRIC_COLORS[index % METRIC_COLORS.length] }} className="pcu-mocap-hover-point" />;
            })}
            <g transform={`translate(${Math.min(x(hovered.frame) + 14, width - 244)}, ${plot.top + 42})`}>
              <rect width="228" height={34 + metrics.length * 22} rx="10" className="pcu-mocap-tooltip-bg" />
              <text x="13" y="21" className="pcu-mocap-tooltip-label">Frame {relativeFrame(hovered.frame)}</text>
              {metrics.map((metric, index) => {
                const point = nearestPoint(metric, hovered.time);
                return (
                  <text key={metric.key} x="13" y={43 + index * 22} className="pcu-mocap-tooltip-value">
                    <tspan fill={METRIC_COLORS[index % METRIC_COLORS.length]}>{metric.label}: </tspan>
                    <tspan>{formatMetricValue(point.value, metric.unit, false, metric.key)}</tspan>
                  </text>
                );
              })}
            </g>
          </g>
        ) : null}

        <rect
          x={plot.left}
          y={plot.top}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
          className="pcu-mocap-chart-hitbox"
          onPointerDown={(event) => {
            isDragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = pointFromPointer(event);
            setHoveredIndex(point.nearestIndex);
            onSeek(point.time);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => {
            isDragging.current = false;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { isDragging.current = false; }}
          onPointerLeave={() => {
            if (!isDragging.current) setHoveredIndex(null);
          }}
        />
        <text x={plot.left + plotWidth / 2} y={height - 2} textAnchor="middle" className="pcu-mocap-axis-title">
          Frame
        </text>
        <text
          x="17"
          y={plot.top + plotHeight / 2}
          textAnchor="middle"
          className="pcu-mocap-axis-title"
          transform={`rotate(-90 17 ${plot.top + plotHeight / 2})`}
        >
          {axisLabel(units[0])}
        </text>
        {hasSecondAxis ? (
          <text
            x={width - 17}
            y={plot.top + plotHeight / 2}
            textAnchor="middle"
            className="pcu-mocap-axis-title"
            transform={`rotate(90 ${width - 17} ${plot.top + plotHeight / 2})`}
          >
            {axisLabel(units[1])}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

export default function PcuMocapDashboard({ canEditEvents = false }: { canEditEvents?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const initialAthlete = PITCH_DATASETS[0]?.athlete ?? '';
  const initialAthletePitches = PITCH_DATASETS.filter((dataset) => dataset.athlete === initialAthlete);
  const initialDates = initialAthletePitches.map((dataset) => dataset.recordedAt.slice(0, 10)).sort();
  const [selectedAthlete, setSelectedAthlete] = useState(initialAthlete);
  const [dateStart, setDateStart] = useState(initialDates[0] ?? '');
  const [dateEnd, setDateEnd] = useState(initialDates[initialDates.length - 1] ?? '');
  const [selectedPitchKey, setSelectedPitchKey] = useState(PITCH_DATASETS[0]?.datasetKey ?? '');
  const [analysisMode, setAnalysisMode] = useState<'angle' | 'velocity'>('angle');
  const [selectedMetricKeys, setSelectedMetricKeys] = useState<string[]>([PITCH_DATASETS[0]?.metrics[0]?.key ?? '']);
  const [selectedVideoId, setSelectedVideoId] = useState(PITCH_DATASETS[0]?.videos[0]?.id ?? '');
  const [captureView, setCaptureView] = useState<'overlay' | 'skeleton'>('overlay');
  const [playheadTime, setPlayheadTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(0.5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [eventOverrides, setEventOverrides] = useState<Record<string, EventFrameOverrides>>({});
  const [eventSaveState, setEventSaveState] = useState<'idle' | 'saving-fc' | 'saving-br' | 'saved-fc' | 'saved-br' | 'error-fc' | 'error-br'>('idle');
  const [deletedPitchKeys, setDeletedPitchKeys] = useState<string[]>([]);
  const [deleteState, setDeleteState] = useState<'idle' | 'deleting' | 'error'>('idle');
  const pitchDatasets = useMemo(() => {
    const visible = PITCH_DATASETS.filter((dataset) => !deletedPitchKeys.includes(dataset.datasetKey));
    return visible.length ? visible : PITCH_DATASETS;
  }, [deletedPitchKeys]);
  const athletes = Array.from(new Set(pitchDatasets.map((dataset) => dataset.athlete)));
  const activeAthlete = athletes.includes(selectedAthlete) ? selectedAthlete : athletes[0] ?? '';
  const athletePitches = useMemo(() => pitchDatasets
    .filter((dataset) => dataset.athlete === activeAthlete)
    .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt)), [activeAthlete, pitchDatasets]);
  const filteredPitches = useMemo(() => athletePitches.filter((dataset) => {
    const date = dataset.recordedAt.slice(0, 10);
    return (!dateStart || date >= dateStart) && (!dateEnd || date <= dateEnd);
  }), [athletePitches, dateEnd, dateStart]);
  const effectivePitchKey = selectedPitchKey === 'average' && filteredPitches.length > 1
    ? 'average'
    : filteredPitches.some((dataset) => dataset.datasetKey === selectedPitchKey)
      ? selectedPitchKey
      : filteredPitches[filteredPitches.length - 1]?.datasetKey ?? athletePitches[athletePitches.length - 1]?.datasetKey;
  const basePitch = useMemo(() => (
    effectivePitchKey === 'average'
      ? buildAveragePitch(filteredPitches)
      : pitchDatasets.find((dataset) => dataset.datasetKey === effectivePitchKey) ?? pitchDatasets[0]
  ), [effectivePitchKey, filteredPitches, pitchDatasets]);
  const pitch = useMemo(() => {
    const overrides = eventOverrides[basePitch.datasetKey];
    return overrides ? applyEventFrames(basePitch, overrides) : basePitch;
  }, [basePitch, eventOverrides]);
  const availableMetrics = pitch.metrics.filter((metric) => metric.group === analysisMode && metric.key !== 'throwingHandVelocity');
  const selectedMetrics = selectedMetricKeys
    .map((key) => availableMetrics.find((metric) => metric.key === key))
    .filter((metric): metric is MocapMetric => Boolean(metric));
  const displayedMetrics = selectedMetrics.length ? selectedMetrics : [availableMetrics[0]];
  const selectedVideo = pitch.videos.find((video) => video.id === selectedVideoId) ?? pitch.videos[0];
  const selectedVideoUrl = `${selectedVideo.url}${selectedVideo.url.includes('?') ? '&' : '?'}view=overlay`;
  const recordedDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(pitch.recordedAt));
  const averageRangeLabel = pitch.isAverage
    ? `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${dateStart}T12:00:00`))} – ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${dateEnd}T12:00:00`))}`
    : recordedDate;
  const firstAnalysisFrame = pitch.metrics[0]?.series[0]?.frame ?? 0;
  const isKinematicSequence = analysisMode === 'velocity'
    && KINEMATIC_SEQUENCE_KEYS.every((key) => displayedMetrics.some((metric) => metric.key === key));
  const footContact = pitch.events.find((event) => event.key === 'footPlant');
  const ballRelease = pitch.events.find((event) => event.key === 'ballRelease');
  const kinematicSequence = KINEMATIC_SEQUENCE_KEYS
    .map((key) => availableMetrics.find((metric) => metric.key === key))
    .filter((metric): metric is MocapMetric => Boolean(metric))
    .map((metric, index, metrics) => {
      const peak = peakMetricPoint(metric, pitch.events);
      const previousPeak = index > 0 ? peakMetricPoint(metrics[index - 1], pitch.events) : null;
      const fromTime = previousPeak?.time ?? footContact?.time ?? peak.time;
      const previousLabel = index > 0 ? KINEMATIC_SEQUENCE_LABELS[metrics[index - 1].key] : 'FC';
      return {
        metric,
        peak,
        label: KINEMATIC_SEQUENCE_LABELS[metric.key] ?? metric.label,
        timingLabel: `${previousLabel === 'FC' ? 'FC' : `Max ${previousLabel}`} → Max ${KINEMATIC_SEQUENCE_LABELS[metric.key] ?? metric.label}`,
        timingMs: millisecondsBetween(fromTime, peak.time),
        releaseMs: ballRelease ? millisecondsBetween(peak.time, ballRelease.time) : null,
      };
    });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/dashboard/motion-capture/pitches', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load deleted pitches.');
        return response.json() as Promise<{ deleted?: string[] }>;
      })
      .then((payload) => {
        if (!cancelled && payload.deleted?.length) setDeletedPitchKeys(payload.deleted);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (basePitch.isAverage) return;
    let cancelled = false;
    setEventSaveState('idle');
    fetch(`/api/dashboard/motion-capture/events?dataset=${encodeURIComponent(basePitch.datasetKey)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load saved events.');
        return response.json() as Promise<{ footContactFrame?: number | null; ballReleaseFrame?: number | null }>;
      })
      .then((payload) => {
        if (cancelled) return;
        const overrides: EventFrameOverrides = {};
        if (Number.isInteger(payload.footContactFrame)) overrides.footContactFrame = Number(payload.footContactFrame);
        if (Number.isInteger(payload.ballReleaseFrame)) overrides.ballReleaseFrame = Number(payload.ballReleaseFrame);
        if (!Object.keys(overrides).length) return;
        setEventOverrides((current) => ({ ...current, [basePitch.datasetKey]: overrides }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [basePitch.datasetKey, basePitch.isAverage]);

  useEffect(() => {
    videoRef.current?.pause();
    setIsPlaying(false);
    setSelectedVideoId(basePitch.videos[0]?.id ?? '');
    setPlayheadTime(0);
    setEventSaveState('idle');
    setDeleteState('idle');
    setSelectedMetricKeys((current) => {
      const availableInMode = basePitch.metrics.filter((metric) => metric.group === analysisMode && metric.key !== 'throwingHandVelocity');
      const available = new Set(availableInMode.map((metric) => metric.key));
      const retained = current.filter((key) => available.has(key));
      return retained.length ? retained : [availableInMode[0]?.key ?? ''];
    });
  }, [analysisMode, basePitch]);

  if (!displayedMetrics[0] || !selectedVideo) return null;

  const seekTo = (requestedTime: number) => {
    const time = Math.max(0, Math.min(pitch.analysisWindow.durationSec, requestedTime));
    setPlayheadTime(time);
    if (videoRef.current) videoRef.current.currentTime = time;
  };

  const changeAthlete = (athlete: string) => {
    const nextPitches = pitchDatasets
      .filter((dataset) => dataset.athlete === athlete)
      .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt));
    const nextPitch = nextPitches[nextPitches.length - 1] ?? pitchDatasets[0];
    const nextDates = nextPitches.map((dataset) => dataset.recordedAt.slice(0, 10)).sort();
    videoRef.current?.pause();
    setIsPlaying(false);
    setSelectedAthlete(nextPitch.athlete);
    setDateStart(nextDates[0] ?? '');
    setDateEnd(nextDates[nextDates.length - 1] ?? '');
    setSelectedPitchKey(nextPitch.datasetKey);
  };

  const changeAnalysisMode = (mode: 'angle' | 'velocity') => {
    const metrics = pitch.metrics.filter((metric) => metric.group === mode);
    setAnalysisMode(mode);
    setSelectedMetricKeys(
      mode === 'velocity'
        ? KINEMATIC_SEQUENCE_KEYS.filter((key) => metrics.some((metric) => metric.key === key))
        : [metrics[0]?.key ?? '']
    );
  };

  const showKinematicSequence = () => {
    setSelectedMetricKeys(KINEMATIC_SEQUENCE_KEYS.filter((key) => availableMetrics.some((metric) => metric.key === key)));
  };

  const toggleMetric = (metricKey: string) => {
    setSelectedMetricKeys((current) => {
      if (current.includes(metricKey)) {
        return current.length === 1 ? current : current.filter((key) => key !== metricKey);
      }
      return [...current, metricKey];
    });
  };

  const setEventAtPlayhead = async (eventKey: 'footContact' | 'ballRelease') => {
    const timeline = pitch.metrics[0]?.series ?? [];
    const point = timeline.reduce<MocapPoint | null>(
      (nearest, candidate) => !nearest || Math.abs(candidate.time - playheadTime) < Math.abs(nearest.time - playheadTime) ? candidate : nearest,
      null
    );
    const currentFootContact = pitch.events.find((event) => event.key === 'footPlant');
    const currentBallRelease = pitch.events.find((event) => event.key === 'ballRelease');
    const invalid = !point || !currentFootContact || !currentBallRelease
      || (eventKey === 'footContact' && point.frame >= currentBallRelease.frame)
      || (eventKey === 'ballRelease' && point.frame <= currentFootContact.frame);
    if (invalid || !point || !currentFootContact || !currentBallRelease) {
      setEventSaveState(eventKey === 'footContact' ? 'error-fc' : 'error-br');
      return;
    }
    const nextOverrides: Required<EventFrameOverrides> = {
      footContactFrame: eventKey === 'footContact' ? point.frame : currentFootContact.frame,
      ballReleaseFrame: eventKey === 'ballRelease' ? point.frame : currentBallRelease.frame,
    };
    setEventSaveState(eventKey === 'footContact' ? 'saving-fc' : 'saving-br');
    try {
      const response = await fetch('/api/dashboard/motion-capture/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset: pitch.datasetKey, ...nextOverrides }),
      });
      if (!response.ok) throw new Error('Unable to save event frame.');
      setEventOverrides((current) => ({ ...current, [pitch.datasetKey]: nextOverrides }));
      setEventSaveState(eventKey === 'footContact' ? 'saved-fc' : 'saved-br');
      seekTo(point.time);
    } catch {
      setEventSaveState(eventKey === 'footContact' ? 'error-fc' : 'error-br');
    }
  };

  const deletePitch = async () => {
    if (pitch.isAverage) return;
    if (!window.confirm(`Delete ${pitch.athlete} · ${pitch.title}? It will be removed from the dashboard and from averages.`)) return;
    setDeleteState('deleting');
    try {
      const response = await fetch(`/api/dashboard/motion-capture/pitches?dataset=${encodeURIComponent(pitch.datasetKey)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Unable to delete pitch.');
      videoRef.current?.pause();
      setIsPlaying(false);
      setDeletedPitchKeys((current) => [...current, pitch.datasetKey]);
      setDeleteState('idle');
    } catch {
      setDeleteState('error');
    }
  };

  return (
    <section className="pcu-mocap">
      <header className="pcu-mocap-hero">
        <div>
          <p className="pcu-mocap-kicker">PCU Motion Capture Lab</p>
          <h2>Motion Capture</h2>
        </div>
        <div className="pcu-mocap-recording">
          <div className="pcu-mocap-recording-field pcu-mocap-recording-field--athlete">
            <label htmlFor="pcu-mocap-athlete">Viewing Athlete</label>
            <select id="pcu-mocap-athlete" value={activeAthlete}onChange={(event) => changeAthlete(event.target.value)}>
              {athletes.map((athlete) => <option key={athlete} value={athlete}>{athlete}</option>)}
            </select>
          </div>
          <div className="pcu-mocap-date-range" aria-label="Capture date range">
            <div className="pcu-mocap-recording-field">
              <label htmlFor="pcu-mocap-date-start">From</label>
              <input
                id="pcu-mocap-date-start"
                type="date"
                value={dateStart}
                max={dateEnd || undefined}
                onChange={(event) => setDateStart(event.target.value)}
              />
            </div>
            <div className="pcu-mocap-recording-field">
              <label htmlFor="pcu-mocap-date-end">To</label>
              <input
                id="pcu-mocap-date-end"
                type="date"
                value={dateEnd}
                min={dateStart || undefined}
                onChange={(event) => setDateEnd(event.target.value)}
              />
            </div>
          </div>
          <div className="pcu-mocap-recording-field pcu-mocap-recording-field--pitch">
            <label htmlFor="pcu-mocap-pitch">Pitch View</label>
            <select
              id="pcu-mocap-pitch"
              value={effectivePitchKey}
              onChange={(event) => setSelectedPitchKey(event.target.value)}
            >
              {filteredPitches.length > 1 ? <option value="average">Average · {filteredPitches.length} Pitches</option> : null}
              {[...filteredPitches].reverse().map((dataset) => (
                <option key={dataset.datasetKey} value={dataset.datasetKey}>{dataset.title}</option>
              ))}
            </select>
          </div>
          <div className="pcu-mocap-recording-summary">
            <strong>{pitch.title}</strong>
            <small>{averageRangeLabel}</small>
          </div>
        </div>
      </header>

      <div className="pcu-mocap-capture-strip" aria-label="Capture details">
        <div><span>{pitch.isAverage ? 'Pitches' : 'Cameras'}</span><strong>{pitch.isAverage ? pitch.pitchCount : pitch.cameraCount}</strong></div>
        <div><span>Capture Rate</span><strong>{pitch.captureFps.toFixed(1)} FPS</strong></div>
        <div><span>Throwing Side</span><strong>{pitch.handedness === 'R' ? 'Right' : 'Left'}</strong></div>
        <div><span>Analysis Window</span><strong>{pitch.analysisWindow.durationSec.toFixed(2)} sec</strong></div>
        <div><span>Pipeline</span><strong>{pitch.source}</strong></div>
      </div>

      <nav className="pcu-mocap-analysis-tabs" aria-label="Motion capture analysis type">
        <button type="button" className={analysisMode === 'angle' ? 'is-active' : ''} onClick={() => changeAnalysisMode('angle')}>
          <span>01</span><strong>Angles</strong><small>Positions and delivery geometry</small>
        </button>
        <button type="button" className={analysisMode === 'velocity' ? 'is-active' : ''} onClick={() => changeAnalysisMode('velocity')}>
          <span>02</span><strong>Velocities</strong><small>Sequencing and movement speed</small>
        </button>
      </nav>

      <section className="pcu-mocap-panel">
        <div className="pcu-mocap-panel-head">
          <div>
            <p>01 · Key Positions</p>
            <h3>{analysisMode === 'angle' ? 'Event Measurements' : 'Event Velocities'}</h3>
          </div>
          <div className="pcu-mocap-event-key">
            {pitch.events.map((event) => (
              <span key={event.key} title={EVENT_PRESENTATION[event.key].label} style={{ '--event-color': EVENT_COLORS[event.key] } as CSSProperties}>
                {EVENT_PRESENTATION[event.key].abbreviation}<small>Frame {event.frame - firstAnalysisFrame}</small>
              </span>
            ))}
          </div>
        </div>
        <div className="pcu-mocap-table-wrap">
          <table className="pcu-mocap-table">
            <thead>
              <tr>
                <th>Metric</th>
                {pitch.events.map((event) => <th key={event.key} title={EVENT_PRESENTATION[event.key].label}>{EVENT_PRESENTATION[event.key].abbreviation}</th>)}
                {analysisMode === 'velocity' ? <><th>Peak Speed</th><th>Peak Frame</th><th>From FC</th></> : null}
              </tr>
            </thead>
            <tbody>
              {availableMetrics.map((metric) => (
                <tr
                  key={metric.key}
                  className={displayedMetrics.some((selected) => selected.key === metric.key) ? 'is-selected' : ''}
                  onClick={() => setSelectedMetricKeys([metric.key])}
                >
                  <th scope="row"><span>{metric.label}</span><small>View Timeline →</small></th>
                  {pitch.events.map((event) => (
                    <td key={event.key}>{formatMetricValue(metric.eventValues[event.key], metric.unit, false, metric.key)}</td>
                  ))}
                  {analysisMode === 'velocity' ? (
                    <>
                      <td className="pcu-mocap-max-value">{formatMetricValue(maxMetricSpeed(metric, pitch.events), metric.unit, false, metric.key)}</td>
                      <td>{peakMetricPoint(metric, pitch.events).frame - firstAnalysisFrame}</td>
                      <td>{footContact ? `${millisecondsBetween(footContact.time, peakMetricPoint(metric, pitch.events).time)} ms` : '—'}</td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pcu-mocap-panel pcu-mocap-panel--chart">
        <div className="pcu-mocap-panel-head">
          <div>
            <p>02 · Delivery Timeline</p>
            <h3>{isKinematicSequence
              ? 'Kinematic Sequence'
              : displayedMetrics.length === 1 ? displayedMetrics[0].label : `${displayedMetrics.length} Metric Comparison`}</h3>
          </div>
          <div className="pcu-mocap-chart-controls">
            {analysisMode === 'velocity' ? (
              <button type="button" className="pcu-mocap-sequence-button" onClick={showKinematicSequence}>
                Kinematic Sequence
              </button>
            ) : null}
            <details className="pcu-mocap-metric-select">
              <summary>
                <span>Metrics</span>
                <strong>{displayedMetrics.length === 1 ? displayedMetrics[0].label : `${displayedMetrics.length} selected`}</strong>
              </summary>
              <div className="pcu-mocap-metric-menu">
                {availableMetrics.map((metric) => {
                  const checked = displayedMetrics.some((selected) => selected.key === metric.key);
                  return (
                    <label key={metric.key}>
                      <input type="checkbox" checked={checked} onChange={() => toggleMetric(metric.key)} />
                      <span>{metric.label}<small>{metric.unit}</small></span>
                    </label>
                  );
                })}
              </div>
            </details>
          </div>
        </div>
        <div className={`pcu-mocap-review-grid${pitch.isAverage ? ' is-average' : ''}`}>
          {!pitch.isAverage ? <div className="pcu-mocap-video-station">
            <div className="pcu-mocap-view-switch" role="tablist" aria-label="Capture viewing mode">
              <button type="button" className={captureView === 'overlay' ? 'is-active' : ''} onClick={() => { videoRef.current?.pause(); setIsPlaying(false); setCaptureView('overlay'); }}>Player + Skeleton</button>
              <button type="button" className={captureView === 'skeleton' ? 'is-active' : ''} onClick={() => { videoRef.current?.pause(); setIsPlaying(false); setCaptureView('skeleton'); }}>3D Skeleton</button>
            </div>
            <div className="pcu-mocap-video-head">
              <div>
                <span>Synced Capture</span>
                <strong>{playheadTime.toFixed(2)} sec</strong>
              </div>
              {captureView !== 'skeleton' ? <label>
                <span>Camera Angle</span>
                <select
                  value={selectedVideo.id}
                  onChange={(event) => {
                    videoRef.current?.pause();
                    setSelectedVideoId(event.target.value);
                  }}
                >
                  {pitch.videos.map((video) => <option key={video.id} value={video.id}>{video.label}</option>)}
                </select>
              </label> : <div className="pcu-mocap-three-d-badge"><span>Reconstruction</span><strong>Interactive 3D</strong></div>}
            </div>
            <div className="pcu-mocap-video-frame">
              <video
                key={`${pitch.athlete}-${selectedVideo.id}-${captureView}`}
                ref={videoRef}
                src={selectedVideoUrl}
                controls={captureView !== 'skeleton'}
                className={captureView === 'skeleton' ? 'is-skeleton-driver' : ''}
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => {
                  event.currentTarget.playbackRate = playbackRate;
                  event.currentTarget.currentTime = playheadTime;
                }}
                onTimeUpdate={(event) => setPlayheadTime(event.currentTarget.currentTime)}
                onSeeking={(event) => setPlayheadTime(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
              />
              {captureView === 'skeleton' ? <MocapAnatomicalViewer skeleton={pitch.skeleton} time={playheadTime} handedness={pitch.handedness} driverRef={videoRef} /> : null}
              <span className="pcu-mocap-video-badge">{captureView === 'skeleton' ? '3D Reconstruction' : `${selectedVideo.label} · Player + Skeleton`}</span>
            </div>
            <div className="pcu-mocap-transport">
              {captureView === 'skeleton' ? <button type="button" onClick={() => {
                if (!videoRef.current) return;
                if (videoRef.current.paused) void videoRef.current.play();
                else videoRef.current.pause();
              }}>{isPlaying ? 'Pause' : 'Play'}</button> : null}
              <button type="button" onClick={() => { videoRef.current?.pause(); seekTo(playheadTime - 1 / pitch.captureFps); }} aria-label="Previous frame">− Frame</button>
              <button type="button" onClick={() => { videoRef.current?.pause(); seekTo(playheadTime + 1 / pitch.captureFps); }} aria-label="Next frame">+ Frame</button>
              <label>
                Speed
                <select
                  value={playbackRate}
                  onChange={(event) => {
                    const rate = Number(event.target.value);
                    setPlaybackRate(rate);
                    if (videoRef.current) videoRef.current.playbackRate = rate;
                  }}
                >
                  <option value={0.25}>0.25×</option>
                  <option value={0.5}>0.5×</option>
                  <option value={0.75}>0.75×</option>
                  <option value={1}>1×</option>
                </select>
              </label>
            </div>
            {canEditEvents && !pitch.isAverage ? (
              <div className="pcu-mocap-event-editor">
                <div className="pcu-mocap-event-editor-actions">
                  <button type="button" onClick={() => setEventAtPlayhead('footContact')} disabled={eventSaveState.startsWith('saving')}>
                    {eventSaveState === 'saving-fc' ? 'Saving…' : 'Set Foot Contact'}
                  </button>
                  <button type="button" onClick={() => setEventAtPlayhead('ballRelease')} disabled={eventSaveState.startsWith('saving')}>
                    {eventSaveState === 'saving-br' ? 'Saving…' : 'Set Ball Release'}
                  </button>
                  <button type="button" className="pcu-mocap-delete-pitch" onClick={deletePitch} disabled={deleteState === 'deleting'}>
                    {deleteState === 'deleting' ? 'Deleting…' : 'Delete Pitch'}
                  </button>
                </div>
                <span className={eventSaveState.startsWith('error') || deleteState === 'error' ? 'is-error' : ''}>
                  {deleteState === 'error'
                    ? 'Unable to delete this pitch. Try again.'
                    : eventSaveState === 'saved-fc'
                    ? 'Foot contact saved. MER and all event values recalculated.'
                    : eventSaveState === 'saved-br'
                      ? 'Ball release saved. MER and all event values recalculated.'
                      : eventSaveState === 'error-fc'
                        ? 'Foot contact must be set before ball release.'
                        : eventSaveState === 'error-br'
                          ? 'Ball release must be set after foot contact.'
                          : 'Pause on the correct frame, then set foot contact or ball release.'}
                </span>
              </div>
            ) : null}
            <div className="pcu-mocap-video-events">
              {pitch.events.map((event) => (
                <button key={event.key} type="button" onClick={() => { videoRef.current?.pause(); seekTo(event.time); }} style={{ '--event-color': EVENT_COLORS[event.key] } as CSSProperties}>
                  <span title={EVENT_PRESENTATION[event.key].label}>{EVENT_PRESENTATION[event.key].abbreviation}</span><strong>{event.time.toFixed(2)}s</strong>
                </button>
              ))}
            </div>
          </div> : null}
          <div className="pcu-mocap-graph-station">
            {pitch.isAverage ? (
              <div className="pcu-mocap-average-banner">
                <div><span>Average Profile</span><strong>{pitch.pitchCount} pitches</strong></div>
                <p>Every delivery is normalized to 101 frames, then averaged point-by-point so the timeline preserves the shape and sequence of the selected pitches.</p>
              </div>
            ) : null}
            <MetricChart metrics={displayedMetrics} events={pitch.events} playheadTime={playheadTime} onSeek={seekTo} />
            <div className="pcu-mocap-chart-events">
              {pitch.events.map((event) => (
                <div key={event.key}>
                  <span style={{ background: EVENT_COLORS[event.key] }} />
                  <small title={EVENT_PRESENTATION[event.key].label}>{EVENT_PRESENTATION[event.key].abbreviation}</small>
                  <div>
                    {displayedMetrics.map((metric) => (
                      <strong key={metric.key}>{metric.label}<b>{formatMetricValue(metric.eventValues[event.key], metric.unit, true, metric.key) || '—'}</b></strong>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {isKinematicSequence ? (
              <div className="pcu-mocap-sequence-summary" aria-label="Kinematic sequence peak speeds and timing">
                {kinematicSequence.map((stage, index) => (
                  <article key={stage.metric.key} style={{ '--sequence-color': METRIC_COLORS[index % METRIC_COLORS.length] } as CSSProperties}>
                    <header><i /><strong>{stage.label}</strong><small>Frame {stage.peak.frame - firstAnalysisFrame}</small></header>
                    <div><span>Max Speed</span><b>{formatMetricValue(stage.peak.value, stage.metric.unit, false, stage.metric.key)}</b></div>
                    <div><span>{stage.timingLabel}</span><b>{stage.timingMs} ms</b></div>
                    {stage.metric.key === 'shoulderInternalRotationVelocity' && stage.releaseMs !== null ? (
                      <div><span>Max {stage.label} → BR</span><b>{stage.releaseMs} ms</b></div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <footer className="pcu-mocap-method-note">
        <strong>Prototype Analysis</strong>
        <span>{pitch.notes.join(' ')}</span>
      </footer>
    </section>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

type PlayerChoice = {
  playerId: number;
  fullName: string;
};

type PlayerProfile = {
  id: number;
  fullName: string;
  throwsHand: string | null;
  height: string | null;
};

type TrackmanPitchOption = {
  pitchEventId: string;
  label: string;
  pitchNo: string | null;
  pitchType: string | null;
  velocityMph: number | null;
  pitchTime: string | null;
};

type MotionCaptureVideo = {
  id: number;
  viewType: 'side' | 'behind';
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

type MotionCaptureViewType = 'side' | 'behind';

type MotionCaptureThrow = {
  id: number;
  playerId: number;
  playerName: string;
  playerHeight: string | null;
  playerThrowsHand: string | null;
  throwDate: string;
  throwType: string;
  handedness: 'RHP' | 'LHP';
  pitchEventId: string | null;
  trackmanPitchLabel: string | null;
  analysisStatus: string;
  analysisMessage: string | null;
  calibrationJson: Record<string, unknown> | null;
  eventsJson: Record<string, unknown> | null;
  metricsJson: Record<string, unknown> | null;
  graphJson: Record<string, unknown> | null;
  videos: MotionCaptureVideo[];
};

type PoseLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

type PoseFrame = {
  viewType: MotionCaptureViewType;
  timeSec: number;
  frameIndex: number;
  landmarks: PoseLandmark[];
  throwingElbowFlexion: number | null;
  shoulderErProxy: number | null;
  shoulderAbduction2d: number | null;
  scapRetractionProxy: number | null;
  leadLegFlexion: number | null;
  leadShinAngle: number | null;
  backLegDepthPct: number | null;
  torsoLineAngle: number | null;
  pelvisLineAngle: number | null;
  armLineAngle: number | null;
  wristSpeed: number | null;
  hipShoulderSeparation2d: number | null;
  lateralTrunkTilt2d: number | null;
};

type GraphFrame = {
  timeSec: number;
  landmarks: PoseLandmark[];
  values: Record<string, number | null>;
};

type GraphMetric = {
  key: string;
  label: string;
  unit: 'deg' | 'deg/s';
  source: 'frame' | 'speed';
  color: string;
};

type Payload = {
  players: PlayerChoice[];
  selectedPlayer: PlayerProfile | null;
  throws: MotionCaptureThrow[];
  trackmanPitches: TrackmanPitchOption[];
  videoStorageConfigured: boolean;
  error?: string;
};

const THROW_TYPES = [
  { value: 'trackman_pitch', label: 'TrackMan Pitch' },
  { value: 'mound_no_trackman', label: 'Mound - No TrackMan' },
  { value: 'flat_ground', label: 'Flat Ground' },
  { value: 'plyo', label: 'Plyo' },
  { value: 'catch_play', label: 'Catch Play' },
  { value: 'other', label: 'Other' },
];

const EVENT_LABELS = [
  { key: 'frontFootContact', label: 'Front Foot Plant' },
  { key: 'maxShoulderEr', label: 'Max Shoulder ER' },
  { key: 'ballRelease', label: 'Ball Release' },
];

const GRAPH_METRICS: GraphMetric[] = [
  { key: 'throwingElbowFlexion', label: 'Elbow Flexion', unit: 'deg', source: 'frame', color: '#38bdf8' },
  { key: 'shoulderErProxy', label: 'Shoulder ER Proxy', unit: 'deg', source: 'frame', color: '#f97316' },
  { key: 'shoulderAbduction2d', label: 'Shoulder Abduction', unit: 'deg', source: 'frame', color: '#22c55e' },
  { key: 'scapRetractionProxy', label: 'Scap Retraction Proxy', unit: 'deg', source: 'frame', color: '#facc15' },
  { key: 'leadLegFlexion', label: 'Lead Leg Flexion', unit: 'deg', source: 'frame', color: '#a78bfa' },
  { key: 'leadShinAngle', label: 'Lead Shin Angle', unit: 'deg', source: 'frame', color: '#fb7185' },
  { key: 'torsoLineAngle', label: 'Torso Rotation Proxy', unit: 'deg', source: 'frame', color: '#2dd4bf' },
  { key: 'pelvisLineAngle', label: 'Pelvis Rotation Proxy', unit: 'deg', source: 'frame', color: '#60a5fa' },
  { key: 'hipShoulderSeparation2d', label: 'Hip-Shoulder Separation Proxy', unit: 'deg', source: 'frame', color: '#c084fc' },
  { key: 'pelvisAngularSpeed2d', label: 'Pelvis Rotational Speed', unit: 'deg/s', source: 'speed', color: '#60a5fa' },
  { key: 'torsoAngularSpeed2d', label: 'Torso Rotational Speed', unit: 'deg/s', source: 'speed', color: '#2dd4bf' },
  { key: 'armAngularSpeed2d', label: 'Arm Angular Speed', unit: 'deg/s', source: 'speed', color: '#f97316' },
  { key: 'hipShoulderSeparationSpeed2d', label: 'Separation Speed', unit: 'deg/s', source: 'speed', color: '#c084fc' },
  { key: 'leadLegExtensionSpeed', label: 'Lead Leg Extension Speed', unit: 'deg/s', source: 'speed', color: '#a78bfa' },
];

const GRAPH_PRESETS = [
  {
    key: 'arm-action',
    label: 'Arm Action',
    unit: 'deg' as const,
    metrics: ['throwingElbowFlexion', 'shoulderErProxy', 'shoulderAbduction2d', 'scapRetractionProxy'],
  },
  {
    key: 'rotational-speeds',
    label: 'Rotational Speeds',
    unit: 'deg/s' as const,
    metrics: ['pelvisAngularSpeed2d', 'torsoAngularSpeed2d', 'armAngularSpeed2d', 'hipShoulderSeparationSpeed2d'],
  },
  {
    key: 'lower-half',
    label: 'Lower Half',
    unit: 'deg' as const,
    metrics: ['leadLegFlexion', 'leadShinAngle', 'pelvisLineAngle'],
  },
  {
    key: 'custom',
    label: 'Custom',
    unit: 'deg' as const,
    metrics: ['throwingElbowFlexion', 'shoulderAbduction2d'],
  },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeHandedness(value: string | null | undefined): 'RHP' | 'LHP' {
  return String(value ?? '').trim().toUpperCase() === 'LHP' ? 'LHP' : 'RHP';
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function asMetricRows(metricsJson: Record<string, unknown> | null): Array<{ metric: string; event: string; value: string; confidence: string }> {
  const raw = metricsJson?.metrics;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      return {
        metric: String(row.metric ?? row.name ?? ''),
        event: String(row.event ?? ''),
        value: String(row.value ?? ''),
        confidence: String(row.confidence ?? ''),
      };
    })
    .filter((row): row is { metric: string; event: string; value: string; confidence: string } => Boolean(row?.metric));
}

function asMetricEventRows(metricsJson: Record<string, unknown> | null): Array<{ metric: string; footPlant: string; maxEr: string; ballRelease: string }> {
  const rows = asMetricRows(metricsJson);
  const byMetric = new Map<string, { metric: string; footPlant: string; maxEr: string; ballRelease: string }>();
  const eventColumn = (event: string): 'footPlant' | 'maxEr' | 'ballRelease' | null => {
    const normalized = event.trim().toLowerCase();
    if (normalized === 'front foot contact' || normalized === 'front foot plant' || normalized === 'foot plant') return 'footPlant';
    if (normalized === 'max shoulder er' || normalized === 'max er') return 'maxEr';
    if (normalized === 'ball release' || normalized === 'br') return 'ballRelease';
    return null;
  };
  for (const row of rows) {
    const column = eventColumn(row.event);
    if (!column) continue;
    const entry = byMetric.get(row.metric) ?? { metric: row.metric, footPlant: '-', maxEr: '-', ballRelease: '-' };
    entry[column] = row.value || '-';
    byMetric.set(row.metric, entry);
  }
  return Array.from(byMetric.values());
}

function readEventFrame(eventsJson: Record<string, unknown> | null, key: string): string {
  const value = eventsJson?.[key];
  if (!value || typeof value !== 'object') return '-';
  const row = value as Record<string, unknown>;
  const frame = row.frame ?? row.frameIndex;
  const time = row.timeSec;
  if (frame !== undefined && time !== undefined) return `Frame ${frame} / ${Number(time).toFixed(3)}s`;
  if (frame !== undefined) return `Frame ${frame}`;
  return '-';
}

function readEventTime(eventsJson: Record<string, unknown> | null, key: string): number | null {
  const value = eventsJson?.[key];
  if (!value || typeof value !== 'object') return null;
  return finiteNumber((value as Record<string, unknown>).timeSec);
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function finiteNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function angleAt(a: PoseLandmark | undefined, b: PoseLandmark | undefined, c: PoseLandmark | undefined): number | null {
  if (!a || !b || !c) return null;
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magA = Math.hypot(abx, aby);
  const magC = Math.hypot(cbx, cby);
  if (magA <= 0 || magC <= 0) return null;
  const cos = Math.max(-1, Math.min(1, dot / (magA * magC)));
  return radiansToDegrees(Math.acos(cos));
}

function elbowFlexionFromJointAngle(rawElbowAngle: number | null): number | null {
  if (rawElbowAngle === null) return null;
  return Math.max(0, Math.min(180, 180 - rawElbowAngle));
}

function shoulderAbductionFromTorso(elbow: PoseLandmark | undefined, shoulder: PoseLandmark | undefined, hip: PoseLandmark | undefined): number | null {
  return angleAt(elbow, shoulder, hip);
}

function lineAngle(a: PoseLandmark | undefined, b: PoseLandmark | undefined): number | null {
  if (!a || !b) return null;
  return radiansToDegrees(Math.atan2(b.y - a.y, b.x - a.x));
}

function leadShinAngle(knee: PoseLandmark | undefined, ankle: PoseLandmark | undefined): number | null {
  if (!knee || !ankle) return null;
  return Math.abs(radiansToDegrees(Math.atan2(ankle.x - knee.x, ankle.y - knee.y)));
}

function angularSpeed(prev: number | null, next: number | null, dt: number): number | null {
  if (prev === null || next === null || dt <= 0) return null;
  let delta = next - prev;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta / dt;
}

function metricAtFrame(frame: PoseFrame, eventLabel: string, field: keyof PoseFrame, label: string, unit: string, confidence: string) {
  const value = finiteNumber(frame[field]);
  return {
    metric: label,
    event: eventLabel,
    value: value === null ? '-' : `${value.toFixed(1)}${unit ? ` ${unit}` : ''}`,
    confidence,
  };
}

function nearestFrame(frames: PoseFrame[], index: number): PoseFrame {
  return frames[Math.max(0, Math.min(frames.length - 1, index))] ?? frames[0]!;
}

function angleDifference(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  let delta = a - b;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

function nearestFrameByTime(frames: PoseFrame[], timeSec: number): PoseFrame | null {
  if (!frames.length) return null;
  let best = frames[0]!;
  let bestDelta = Math.abs(best.timeSec - timeSec);
  for (const frame of frames) {
    const delta = Math.abs(frame.timeSec - timeSec);
    if (delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
  }
  return best;
}

function findPeakKneeLiftFrame(frames: PoseFrame[], handedness: 'RHP' | 'LHP'): PoseFrame | null {
  if (!frames.length) return null;
  const leadKneeIndex = handedness === 'RHP' ? 25 : 26;
  let best: PoseFrame | null = null;
  for (const frame of frames) {
    const knee = frame.landmarks[leadKneeIndex];
    if (!knee || (knee.visibility ?? 1) < 0.25) continue;
    if (!best) {
      best = frame;
      continue;
    }
    const currentY = knee.y;
    const bestY = best.landmarks[leadKneeIndex]?.y ?? Infinity;
    if (currentY < bestY) best = frame;
  }
  return best ?? frames[0] ?? null;
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio)));
  return sorted[index] ?? null;
}

function median(values: number[]): number | null {
  return percentile(values, 0.5);
}

function findFrontFootContactIndex(frames: PoseFrame[], handedness: 'RHP' | 'LHP'): number {
  const leadAnkleIndex = handedness === 'RHP' ? 27 : 28;
  const leadKneeIndex = handedness === 'RHP' ? 25 : 26;
  const leadHeelIndex = handedness === 'RHP' ? 29 : 30;
  const leadToeIndex = handedness === 'RHP' ? 31 : 32;
  const visiblePoint = (index: number, landmarkIndex: number) => {
    const point = frames[index]?.landmarks[landmarkIndex];
    return point && (point.visibility ?? 1) >= 0.25 ? point : null;
  };

  let peakKneeIndex = Math.max(0, Math.floor(frames.length * 0.18));
  const peakSearchEnd = Math.max(peakKneeIndex + 1, Math.floor(frames.length * 0.62));
  for (let i = peakKneeIndex; i < peakSearchEnd; i += 1) {
    const knee = frames[i]?.landmarks[leadKneeIndex];
    const best = frames[peakKneeIndex]?.landmarks[leadKneeIndex];
    if (knee && best && (knee.visibility ?? 1) >= 0.25 && knee.y < best.y) peakKneeIndex = i;
  }

  const searchStart = Math.min(frames.length - 1, Math.max(peakKneeIndex + 4, Math.floor(frames.length * 0.28)));
  const searchEnd = Math.max(searchStart + 1, Math.floor(frames.length * 0.82));
  const footSamples: Array<{ index: number; heelX: number; heelY: number; toeX: number; toeY: number; bottomY: number }> = [];
  for (let i = searchStart; i < searchEnd; i += 1) {
    const heel = visiblePoint(i, leadHeelIndex);
    const toe = visiblePoint(i, leadToeIndex);
    if (heel && toe) {
      footSamples.push({
        index: i,
        heelX: heel.x,
        heelY: heel.y,
        toeX: toe.x,
        toeY: toe.y,
        bottomY: Math.max(heel.y, toe.y),
      });
    }
  }
  if (footSamples.length) {
    const floorY = percentile(footSamples.map((sample) => sample.bottomY), 0.92);
    if (floorY !== null) {
      const onFloorTolerance = 0.045;
      const latePlantedSamples = footSamples.filter(
        (sample) => sample.index >= Math.floor(frames.length * 0.42) && sample.heelY >= floorY - onFloorTolerance && sample.toeY >= floorY - onFloorTolerance
      );
      const plantedHeelX = median(latePlantedSamples.map((sample) => sample.heelX));
      const plantedToeX = median(latePlantedSamples.map((sample) => sample.toeX));
      for (const sample of footSamples) {
        const bothFootDotsOnFloor = sample.heelY >= floorY - onFloorTolerance && sample.toeY >= floorY - onFloorTolerance;
        if (!bothFootDotsOnFloor) continue;
        const nearFinalFootSpot =
          plantedHeelX === null ||
          plantedToeX === null ||
          (Math.abs(sample.heelX - plantedHeelX) <= 0.15 && Math.abs(sample.toeX - plantedToeX) <= 0.15);
        if (!nearFinalFootSpot) continue;
        let stableCount = 0;
        for (let offset = 0; offset <= 5; offset += 1) {
          const heel = visiblePoint(sample.index + offset, leadHeelIndex);
          const toe = visiblePoint(sample.index + offset, leadToeIndex);
          if (!heel || !toe) continue;
          const footStillDown = heel.y >= floorY - 0.055 && toe.y >= floorY - 0.055;
          const footStillNearSpot =
            plantedHeelX === null ||
            plantedToeX === null ||
            (Math.abs(heel.x - plantedHeelX) <= 0.17 && Math.abs(toe.x - plantedToeX) <= 0.17);
          if (footStillDown && footStillNearSpot) stableCount += 1;
        }
        if (stableCount >= 3) return sample.index;
      }
    }
  }

  const ankleSamples: Array<{ index: number; x: number; y: number }> = [];
  for (let i = searchStart; i < searchEnd; i += 1) {
    const ankle = visiblePoint(i, leadAnkleIndex);
    if (ankle) ankleSamples.push({ index: i, x: ankle.x, y: ankle.y });
  }
  if (!ankleSamples.length) return Math.max(0, Math.floor(frames.length * 0.45));

  const plantedY = percentile(ankleSamples.map((sample) => sample.y), 0.88);
  if (plantedY === null) return ankleSamples[Math.floor(ankleSamples.length * 0.55)]?.index ?? 0;
  const nearPlantY = plantedY - 0.045;
  const latePlantSamples = ankleSamples.filter((sample) => sample.index >= Math.floor(frames.length * 0.42) && sample.y >= nearPlantY);
  const plantedX = median(latePlantSamples.map((sample) => sample.x));

  for (const sample of ankleSamples) {
    if (sample.y < nearPlantY) continue;
    if (plantedX !== null && Math.abs(sample.x - plantedX) > 0.16) continue;
    let stableCount = 0;
    for (let offset = 0; offset <= 5; offset += 1) {
      const ankle = visiblePoint(sample.index + offset, leadAnkleIndex);
      if (!ankle) continue;
      const yStable = ankle.y >= plantedY - 0.055;
      const xStable = plantedX === null || Math.abs(ankle.x - plantedX) <= 0.18;
      if (yStable && xStable) stableCount += 1;
    }
    if (stableCount >= 3) return sample.index;
  }

  return ankleSamples.reduce((best, sample) => (sample.y > best.y ? sample : best), ankleSamples[0]!).index;
}

function serializePoseFrames(frames: PoseFrame[]) {
  return frames.map((frame) => ({
    viewType: frame.viewType,
    timeSec: Number(frame.timeSec.toFixed(4)),
    frameIndex: frame.frameIndex,
    throwingElbowFlexion: frame.throwingElbowFlexion,
    shoulderErProxy: frame.shoulderErProxy,
    shoulderAbduction2d: frame.shoulderAbduction2d,
    scapRetractionProxy: frame.scapRetractionProxy,
    leadLegFlexion: frame.leadLegFlexion,
    leadShinAngle: frame.leadShinAngle,
    backLegDepthPct: frame.backLegDepthPct,
    torsoLineAngle: frame.torsoLineAngle,
    pelvisLineAngle: frame.pelvisLineAngle,
    hipShoulderSeparation2d: frame.hipShoulderSeparation2d,
    lateralTrunkTilt2d: frame.lateralTrunkTilt2d,
    wristSpeed: frame.wristSpeed,
    landmarks: frame.landmarks.map((point) => ({
      x: Number(point.x.toFixed(5)),
      y: Number(point.y.toFixed(5)),
      z: Number((point.z ?? 0).toFixed(5)),
      visibility: Number((point.visibility ?? 0).toFixed(4)),
    })),
  }));
}

function computePoseOutputs(sideFrames: PoseFrame[], behindFrames: PoseFrame[], handedness: 'RHP' | 'LHP', manualSyncAdjustmentMs: number) {
  const eventSourceFrames = sideFrames.length >= 8 ? sideFrames : behindFrames;
  if (eventSourceFrames.length < 8) throw new Error('Not enough pose frames were detected. Try clearer full-body videos.');
  const throwingWristIndex = handedness === 'RHP' ? 16 : 15;
  const ffcIndex = findFrontFootContactIndex(eventSourceFrames, handedness);

  let releaseIndex = Math.min(eventSourceFrames.length - 1, Math.max(ffcIndex + 1, Math.floor(eventSourceFrames.length * 0.62)));
  for (let i = Math.max(ffcIndex + 1, 1); i < eventSourceFrames.length; i += 1) {
    const speed = eventSourceFrames[i]?.wristSpeed ?? 0;
    const best = eventSourceFrames[releaseIndex]?.wristSpeed ?? 0;
    const wrist = eventSourceFrames[i]?.landmarks[throwingWristIndex];
    if (wrist && speed > best) releaseIndex = i;
  }

  let maxErIndex = Math.max(ffcIndex, Math.min(releaseIndex, Math.floor((ffcIndex + releaseIndex) / 2)));
  for (let i = ffcIndex; i <= releaseIndex; i += 1) {
    const value = eventSourceFrames[i]?.shoulderErProxy ?? -Infinity;
    const best = eventSourceFrames[maxErIndex]?.shoulderErProxy ?? -Infinity;
    if (value > best) maxErIndex = i;
  }
  const ffcFrame = nearestFrame(eventSourceFrames, ffcIndex);
  const maxErFrame = nearestFrame(eventSourceFrames, maxErIndex);
  const releaseFrame = nearestFrame(eventSourceFrames, releaseIndex);
  const sidePeakKneeLift = findPeakKneeLiftFrame(sideFrames, handedness);
  const behindPeakKneeLift = findPeakKneeLiftFrame(behindFrames, handedness);
  const autoBehindOffsetSec =
    sidePeakKneeLift && behindPeakKneeLift ? sidePeakKneeLift.timeSec - behindPeakKneeLift.timeSec : 0;
  const manualOffsetSec = Number.isFinite(manualSyncAdjustmentMs) ? manualSyncAdjustmentMs / 1000 : 0;
  const behindOffsetSec = autoBehindOffsetSec + manualOffsetSec;
  const syncConfidence = sidePeakKneeLift && behindPeakKneeLift ? 'medium' : 'low';

  const events = {
    frontFootContact: {
      frame: ffcFrame.frameIndex,
      timeSec: ffcFrame.timeSec,
      confidence: 'medium',
      source: sideFrames.length >= 8
        ? 'lead heel and toe first stable floor contact from side view'
        : 'lead heel and toe first stable floor contact from behind view',
    },
    maxShoulderEr: {
      frame: maxErFrame.frameIndex,
      timeSec: maxErFrame.timeSec,
      confidence: 'low',
      source: '2D side-view arm-slot proxy; true ER needs rear view fusion',
    },
    ballRelease: {
      frame: releaseFrame.frameIndex,
      timeSec: releaseFrame.timeSec,
      confidence: 'low',
      source: 'peak throwing-wrist speed proxy',
    },
  };

  const eventFrames = [
    { label: 'Front Foot Contact', frame: ffcFrame },
    { label: 'Max Shoulder ER', frame: maxErFrame },
    { label: 'Ball Release', frame: releaseFrame },
  ];
  const metrics = eventFrames.flatMap(({ label, frame }) => {
    const rows = [
      metricAtFrame(frame, label, 'throwingElbowFlexion', 'Throwing Arm Flexion', 'deg', 'medium'),
      metricAtFrame(frame, label, 'shoulderErProxy', 'Shoulder ER Proxy', 'deg', 'low'),
      metricAtFrame(frame, label, 'scapRetractionProxy', 'Scap Retraction Proxy', 'deg', 'low'),
      metricAtFrame(frame, label, 'backLegDepthPct', 'Back Leg Depth', '% frame height', 'medium'),
      metricAtFrame(frame, label, 'leadShinAngle', 'Lead Shin Angle', 'deg', 'medium'),
      metricAtFrame(frame, label, 'leadLegFlexion', 'Lead Leg Flexion', 'deg', 'medium'),
      metricAtFrame(frame, label, 'torsoLineAngle', 'Torso Line Angle 2D', 'deg', 'low'),
      metricAtFrame(frame, label, 'pelvisLineAngle', 'Pelvis Line Angle 2D', 'deg', 'low'),
    ];
    if (!behindFrames.length) {
      rows.splice(2, 0, metricAtFrame(frame, label, 'shoulderAbduction2d', 'Shoulder Abduction - Side Proxy', 'deg', 'low'));
    }
    return rows;
  });

  const behindEventMetrics = behindFrames.length
    ? eventFrames.flatMap(({ label, frame }) => {
        const rearFrame = nearestFrameByTime(behindFrames, frame.timeSec - behindOffsetSec);
        if (!rearFrame) return [];
        return [
          metricAtFrame(rearFrame, label, 'shoulderAbduction2d', 'Shoulder Abduction', 'deg', 'medium'),
          metricAtFrame(rearFrame, label, 'torsoLineAngle', 'Torso Rotation Proxy - Behind', 'deg', 'medium'),
          metricAtFrame(rearFrame, label, 'pelvisLineAngle', 'Pelvis Rotation Proxy - Behind', 'deg', 'medium'),
          metricAtFrame(rearFrame, label, 'hipShoulderSeparation2d', 'Hip-Shoulder Separation Proxy - Behind', 'deg', 'medium'),
          metricAtFrame(rearFrame, label, 'lateralTrunkTilt2d', 'Lateral Trunk Tilt - Behind', 'deg', 'medium'),
        ];
      })
    : [];

  const speedSourceFrames = behindFrames.length >= 8 ? behindFrames : eventSourceFrames;
  const speeds = speedSourceFrames.slice(1).map((frame, index) => {
    const prev = speedSourceFrames[index]!;
    const dt = Math.max(0.001, frame.timeSec - prev.timeSec);
    return {
      timeSec: frame.timeSec,
      pelvisAngularSpeed2d: angularSpeed(prev.pelvisLineAngle, frame.pelvisLineAngle, dt),
      torsoAngularSpeed2d: angularSpeed(prev.torsoLineAngle, frame.torsoLineAngle, dt),
      armAngularSpeed2d: angularSpeed(prev.armLineAngle, frame.armLineAngle, dt),
      hipShoulderSeparationSpeed2d: frame.hipShoulderSeparation2d !== null && prev.hipShoulderSeparation2d !== null ? (frame.hipShoulderSeparation2d - prev.hipShoulderSeparation2d) / dt : null,
      leadLegExtensionSpeed: frame.leadLegFlexion !== null && prev.leadLegFlexion !== null ? (frame.leadLegFlexion - prev.leadLegFlexion) / dt : null,
      wristSpeed: frame.wristSpeed,
    };
  });

  const speedMetrics = [
    [behindFrames.length ? 'Peak Pelvis Rotational Speed - Behind' : 'Peak Pelvis Rotational Speed 2D', 'pelvisAngularSpeed2d'],
    [behindFrames.length ? 'Peak Torso Rotational Speed - Behind' : 'Peak Torso Rotational Speed 2D', 'torsoAngularSpeed2d'],
    ['Peak Arm Angular Speed 2D', 'armAngularSpeed2d'],
    ['Peak Hip-Shoulder Separation Speed - Behind', 'hipShoulderSeparationSpeed2d'],
    ['Peak Lead Leg Extension Speed', 'leadLegExtensionSpeed'],
  ].map(([label, key]) => {
    const values = speeds.map((row) => finiteNumber(row[key as keyof typeof row])).filter((value): value is number => value !== null);
    const peak = values.length ? values.reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), values[0]!) : null;
    return {
      metric: label,
      event: 'Full Throw',
      value: peak === null ? '-' : `${peak.toFixed(1)} deg/s`,
      confidence: behindFrames.length && key !== 'armAngularSpeed2d' ? 'medium' : key === 'leadLegExtensionSpeed' ? 'medium' : 'low',
    };
  });

  return {
    eventsJson: events,
    metricsJson: {
      version: 1,
      source: behindFrames.length ? 'mediapipe_pose_side_and_behind_views' : 'mediapipe_pose_single_view',
      metrics: [...metrics, ...behindEventMetrics, ...speedMetrics],
      caveat: behindFrames.length
        ? 'Behind-view metrics improve rotation proxies, but this is still markerless 2D multi-view analysis until camera calibration/synchronization fusion is added.'
        : 'Single-view analysis provides 2D estimates. True 3D rotations and shoulder ER require behind-view fusion.',
    },
    graphJson: {
      version: 1,
      handedness,
      sync: {
        method: behindFrames.length ? 'peak_knee_lift' : 'single_view',
        sidePeakKneeLiftSec: sidePeakKneeLift?.timeSec ?? null,
        behindPeakKneeLiftSec: behindPeakKneeLift?.timeSec ?? null,
        autoBehindOffsetMs: Number((autoBehindOffsetSec * 1000).toFixed(1)),
        manualAdjustmentMs: Number(manualSyncAdjustmentMs.toFixed(1)),
        behindOffsetMs: Number((behindOffsetSec * 1000).toFixed(1)),
        confidence: syncConfidence,
      },
      frames: serializePoseFrames(sideFrames.length ? sideFrames : behindFrames),
      views: {
        side: serializePoseFrames(sideFrames),
        behind: serializePoseFrames(behindFrames),
      },
      speeds,
    },
  };
}

function readGraphFrames(graphJson: Record<string, unknown> | null, viewType: MotionCaptureViewType): GraphFrame[] {
  const parseRows = (raw: unknown): GraphFrame[] => {
    if (!Array.isArray(raw)) return [];
    const frames: GraphFrame[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;
      const timeSec = finiteNumber(row.timeSec);
      const landmarksRaw = row.landmarks;
      if (timeSec === null || !Array.isArray(landmarksRaw)) continue;
      const landmarks: PoseLandmark[] = [];
      for (const point of landmarksRaw) {
        if (!point || typeof point !== 'object') continue;
        const p = point as Record<string, unknown>;
        const x = finiteNumber(p.x);
        const y = finiteNumber(p.y);
        if (x === null || y === null) continue;
        landmarks.push({
          x,
          y,
          z: finiteNumber(p.z) ?? undefined,
          visibility: finiteNumber(p.visibility) ?? undefined,
        });
      }
      const values: Record<string, number | null> = {};
      for (const metric of GRAPH_METRICS.filter((entry) => entry.source === 'frame')) {
        values[metric.key] = finiteNumber(row[metric.key]);
      }
      frames.push({ timeSec, landmarks, values });
    }
    return frames;
  };

  const views = graphJson?.views;
  const raw =
    views &&
    typeof views === 'object' &&
    Array.isArray((views as Record<string, unknown>)[viewType]) &&
    ((views as Record<string, unknown>)[viewType] as unknown[]).length > 0
      ? (views as Record<string, unknown>)[viewType]
      : graphJson?.frames;
  const frames = parseRows(raw);
  if (
    viewType === 'side' &&
    views &&
    typeof views === 'object' &&
    Array.isArray((views as Record<string, unknown>).behind) &&
    ((views as Record<string, unknown>).behind as unknown[]).length > 0
  ) {
    const behindFrames = parseRows((views as Record<string, unknown>).behind);
    const sync = graphJson?.sync;
    const behindOffsetSec =
      sync && typeof sync === 'object' ? (finiteNumber((sync as Record<string, unknown>).behindOffsetMs) ?? 0) / 1000 : 0;
    return frames.map((frame) => {
      let nearestBehind: GraphFrame | null = null;
      let nearestDelta = Infinity;
      const targetBehindTime = frame.timeSec - behindOffsetSec;
      for (const behindFrame of behindFrames) {
        const delta = Math.abs(behindFrame.timeSec - targetBehindTime);
        if (delta < nearestDelta) {
          nearestBehind = behindFrame;
          nearestDelta = delta;
        }
      }
      const behindAbduction = finiteNumber(nearestBehind?.values.shoulderAbduction2d);
      if (behindAbduction === null) return frame;
      return {
        ...frame,
        values: {
          ...frame.values,
          shoulderAbduction2d: behindAbduction,
        },
      };
    });
  }
  return frames;
}

function readGraphSpeeds(graphJson: Record<string, unknown> | null): Array<{ timeSec: number; values: Record<string, number | null> }> {
  const raw = graphJson?.speeds;
  if (!Array.isArray(raw)) return [];
  const rows: Array<{ timeSec: number; values: Record<string, number | null> }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const timeSec = finiteNumber(row.timeSec);
    if (timeSec === null) continue;
    const values: Record<string, number | null> = {};
    for (const metric of GRAPH_METRICS.filter((item) => item.source === 'speed')) {
      values[metric.key] = finiteNumber(row[metric.key]);
    }
    rows.push({ timeSec, values });
  }
  return rows;
}

function SkeletonPreview({ mode, frame }: { mode: 'skeleton' | 'markers'; frame: { landmarks: PoseLandmark[] } | null }) {
  const landmarks = frame?.landmarks ?? [];
  const pairs = [
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [11, 23],
    [12, 24],
    [23, 24],
    [23, 25],
    [25, 27],
    [27, 29],
    [29, 31],
    [24, 26],
    [26, 28],
    [28, 30],
    [30, 32],
  ];
  const toX = (point: PoseLandmark) => point.x * 420;
  const toY = (point: PoseLandmark) => point.y * 260;
  return (
    <div className="portal-admin-card" style={{ minHeight: 320, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      <svg viewBox="0 0 420 260" role="img" aria-label="Motion capture skeleton preview" style={{ width: '100%', maxWidth: 520, height: 260 }}>
        <rect x="0" y="0" width="420" height="260" rx="8" fill="rgba(255,255,255,0.035)" />
        <line x1="50" y1="214" x2="370" y2="214" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
        <line x1="92" y1="214" x2="132" y2="214" stroke="rgba(255,255,255,0.75)" strokeWidth="5" />
        {landmarks.length ? (
          <>
            {pairs.map(([a, b]) => {
              const pa = landmarks[a];
              const pb = landmarks[b];
              if (!pa || !pb) return null;
              return (
                <line
                  key={`${a}-${b}`}
                  x1={toX(pa)}
                  y1={toY(pa)}
                  x2={toX(pb)}
                  y2={toY(pb)}
                  stroke="rgba(56,189,248,0.9)"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
              );
            })}
            {landmarks.map((point, index) => {
              const visible = (point.visibility ?? 1) >= 0.25;
              if (!visible) return null;
              return (
                <circle
                  key={`landmark-${index}`}
                  cx={toX(point)}
                  cy={toY(point)}
                  r={mode === 'markers' ? 5 : 3}
                  fill={mode === 'markers' ? 'rgba(250,204,21,0.98)' : 'rgba(248,250,252,0.92)'}
                />
              );
            })}
          </>
        ) : (
          <>
            <path d="M128 130 L164 112 L212 120 L250 92" fill="none" stroke="rgba(56,189,248,0.92)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M165 113 L182 152 L164 202" fill="none" stroke="rgba(34,197,94,0.9)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M211 121 L238 158 L276 204" fill="none" stroke="rgba(34,197,94,0.9)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M210 120 L226 78 L266 54" fill="none" stroke="rgba(249,115,22,0.9)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {!landmarks.length ? (
          <text x="210" y="242" textAnchor="middle" fill="rgba(226,232,240,0.72)" fontSize="13">
            Skeleton and marker tracks will populate after pose processing.
          </text>
        ) : null}
      </svg>
    </div>
  );
}

export default function MotionCaptureDashboard({ initialPlayerId }: { initialPlayerId?: number | null }) {
  const [players, setPlayers] = useState<PlayerChoice[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerProfile | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number>(Number(initialPlayerId ?? 0));
  const [throwDate, setThrowDate] = useState(todayIso());
  const [handedness, setHandedness] = useState<'RHP' | 'LHP'>('RHP');
  const [throwType, setThrowType] = useState('mound_no_trackman');
  const [pitchEventId, setPitchEventId] = useState('');
  const [updateDefaultHandedness, setUpdateDefaultHandedness] = useState(true);
  const [trackmanPitches, setTrackmanPitches] = useState<TrackmanPitchOption[]>([]);
  const [throws, setThrows] = useState<MotionCaptureThrow[]>([]);
  const [selectedThrowId, setSelectedThrowId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'video' | 'skeleton' | 'markers'>('video');
  const [selectedVideoView, setSelectedVideoView] = useState<MotionCaptureViewType>('side');
  const [graphPresetKey, setGraphPresetKey] = useState('arm-action');
  const [graphUnitMode, setGraphUnitMode] = useState<'deg' | 'deg/s'>('deg');
  const [selectedGraphMetricKeys, setSelectedGraphMetricKeys] = useState<string[]>(GRAPH_PRESETS[0]?.metrics ?? []);
  const [sideFile, setSideFile] = useState<File | null>(null);
  const [behindFile, setBehindFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [manualSyncAdjustmentMs, setManualSyncAdjustmentMs] = useState(0);
  const [rubberPointMode, setRubberPointMode] = useState<'left' | 'right'>('left');
  const [rubberLeft, setRubberLeft] = useState<{ x: number; y: number } | null>(null);
  const [rubberRight, setRubberRight] = useState<{ x: number; y: number } | null>(null);
  const [savingCalibration, setSavingCalibration] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [syncViewerTime, setSyncViewerTime] = useState(0);
  const [syncViewerDuration, setSyncViewerDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const calibrationVideoRef = useRef<HTMLVideoElement | null>(null);
  const syncSideVideoRef = useRef<HTMLVideoElement | null>(null);
  const syncBehindVideoRef = useRef<HTMLVideoElement | null>(null);
  const reviewSideVideoRef = useRef<HTMLVideoElement | null>(null);
  const reviewBehindVideoRef = useRef<HTMLVideoElement | null>(null);

  const selectedThrow = useMemo(
    () => throws.find((entry) => entry.id === selectedThrowId) ?? throws[0] ?? null,
    [selectedThrowId, throws]
  );
  const metricRows = useMemo(() => asMetricEventRows(selectedThrow?.metricsJson ?? null), [selectedThrow?.metricsJson]);
  const availableVideoViews = useMemo(
    () => Array.from(new Set((selectedThrow?.videos ?? []).map((video) => video.viewType))) as MotionCaptureViewType[],
    [selectedThrow?.videos]
  );
  const activeVideo = selectedThrow?.videos.find((video) => video.viewType === selectedVideoView) ?? selectedThrow?.videos[0] ?? null;
  const graphFrames = useMemo(() => readGraphFrames(selectedThrow?.graphJson ?? null, selectedVideoView), [selectedThrow?.graphJson, selectedVideoView]);
  const graphSpeeds = useMemo(() => readGraphSpeeds(selectedThrow?.graphJson ?? null), [selectedThrow?.graphJson]);
  const sideVideo = selectedThrow?.videos.find((video) => video.viewType === 'side') ?? null;
  const behindVideo = selectedThrow?.videos.find((video) => video.viewType === 'behind') ?? null;
  const syncBehindOffsetMs = useMemo(() => {
    const sync = selectedThrow?.calibrationJson?.sync;
    if (!sync || typeof sync !== 'object') return manualSyncAdjustmentMs;
    const row = sync as Record<string, unknown>;
    const auto = finiteNumber(row.autoBehindOffsetMs) ?? 0;
    return auto + manualSyncAdjustmentMs;
  }, [manualSyncAdjustmentMs, selectedThrow?.calibrationJson]);
  const currentPoseFrame = useMemo(() => {
    if (!graphFrames.length) return null;
    let best = graphFrames[0]!;
    let bestDelta = Math.abs(best.timeSec - currentTime);
    for (const frame of graphFrames) {
      const delta = Math.abs(frame.timeSec - currentTime);
      if (delta < bestDelta) {
        best = frame;
        bestDelta = delta;
      }
    }
    return best;
  }, [currentTime, graphFrames]);
  const activeGraphMetrics = useMemo(() => {
    const allowedUnit = graphUnitMode;
    const selected = new Set(selectedGraphMetricKeys);
    return GRAPH_METRICS.filter((metric) => metric.unit === allowedUnit && selected.has(metric.key));
  }, [graphUnitMode, selectedGraphMetricKeys]);
  const graphRows = useMemo(() => {
    const sourceRows =
      graphUnitMode === 'deg/s'
        ? graphSpeeds
        : graphFrames.map((frame) => ({ timeSec: frame.timeSec, values: frame.values }));
    return sourceRows.filter((row) => activeGraphMetrics.some((metric) => finiteNumber(row.values[metric.key]) !== null));
  }, [activeGraphMetrics, graphFrames, graphSpeeds, graphUnitMode]);
  const graphDomain = useMemo(() => {
    const values = graphRows.flatMap((row) =>
      activeGraphMetrics
        .map((metric) => finiteNumber(row.values[metric.key]))
        .filter((value): value is number => value !== null)
    );
    if (!values.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const minY = Math.min(...values);
    const maxY = Math.max(...values);
    const yPadding = Math.max(5, (maxY - minY) * 0.12);
    const maxX = Math.max(1, ...graphRows.map((row) => row.timeSec));
    return {
      minX: 0,
      maxX,
      minY: minY - yPadding,
      maxY: maxY + yPadding,
    };
  }, [activeGraphMetrics, graphRows]);
  const graphPaths = useMemo(() => {
    const left = 72;
    const width = 548;
    const height = 308;
    const top = 42;
    const rangeX = Math.max(0.001, graphDomain.maxX - graphDomain.minX);
    const rangeY = Math.max(0.001, graphDomain.maxY - graphDomain.minY);
    const toX = (timeSec: number) => left + ((timeSec - graphDomain.minX) / rangeX) * width;
    const toY = (value: number) => top + height - ((value - graphDomain.minY) / rangeY) * height;
    return activeGraphMetrics.map((metric) => {
      const points = graphRows
        .map((row) => {
          const value = finiteNumber(row.values[metric.key]);
          if (value === null) return null;
          return { x: toX(row.timeSec), y: toY(value) };
        })
        .filter((point): point is { x: number; y: number } => Boolean(point));
      const d = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
      return { metric, d };
    });
  }, [activeGraphMetrics, graphDomain, graphRows]);
  const graphXTicks = useMemo(() => {
    const maxX = graphDomain.maxX || 1;
    return [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      ratio,
      label: (maxX * ratio).toFixed(maxX >= 10 ? 1 : 2),
      x: 72 + ratio * 548,
    }));
  }, [graphDomain.maxX]);
  const graphYTicks = useMemo(() => {
    return [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
      const value = graphDomain.maxY - (graphDomain.maxY - graphDomain.minY) * ratio;
      return {
        ratio,
        label: value.toFixed(Math.abs(value) >= 100 ? 0 : 1),
        y: 42 + ratio * 308,
      };
    });
  }, [graphDomain.maxY, graphDomain.minY]);
  const graphEventMarkers = useMemo(() => {
    const rangeX = Math.max(0.001, graphDomain.maxX - graphDomain.minX);
    return EVENT_LABELS.map((event) => {
      const timeSec = readEventTime(selectedThrow?.eventsJson ?? null, event.key);
      if (timeSec === null) return null;
      const x = 72 + ((timeSec - graphDomain.minX) / rangeX) * 548;
      if (x < 72 || x > 620) return null;
      return { ...event, timeSec, x };
    }).filter((event): event is { key: string; label: string; timeSec: number; x: number } => Boolean(event));
  }, [graphDomain.maxX, graphDomain.minX, selectedThrow?.eventsJson]);
  const currentGraphValues = useMemo(() => {
    if (!graphRows.length) return [];
    let nearest = graphRows[0]!;
    let nearestDelta = Math.abs(nearest.timeSec - currentTime);
    for (const row of graphRows) {
      const delta = Math.abs(row.timeSec - currentTime);
      if (delta < nearestDelta) {
        nearest = row;
        nearestDelta = delta;
      }
    }
    return activeGraphMetrics.map((metric) => ({
      metric,
      value: finiteNumber(nearest.values[metric.key]),
      timeSec: nearest.timeSec,
    }));
  }, [activeGraphMetrics, currentTime, graphRows]);
  const currentGraphX = useMemo(() => {
    const timeSec = currentGraphValues[0]?.timeSec ?? currentTime;
    const rangeX = Math.max(0.001, graphDomain.maxX - graphDomain.minX);
    return Math.max(72, Math.min(620, 72 + ((timeSec - graphDomain.minX) / rangeX) * 548));
  }, [currentGraphValues, currentTime, graphDomain.maxX, graphDomain.minX]);
  const currentGraphMarkers = useMemo(() => {
    const rangeY = Math.max(0.001, graphDomain.maxY - graphDomain.minY);
    return currentGraphValues
      .map(({ metric, value, timeSec }) => {
        if (value === null) return null;
        const rangeX = Math.max(0.001, graphDomain.maxX - graphDomain.minX);
        const x = 72 + ((timeSec - graphDomain.minX) / rangeX) * 548;
        const y = 42 + 308 - ((value - graphDomain.minY) / rangeY) * 308;
        return {
          metric,
          value,
          x: Math.max(72, Math.min(620, x)),
          y: Math.max(42, Math.min(350, y)),
        };
      })
      .filter((entry): entry is { metric: GraphMetric; value: number; x: number; y: number } => Boolean(entry));
  }, [currentGraphValues, graphDomain.maxX, graphDomain.maxY, graphDomain.minX, graphDomain.minY]);

  const load = async (nextPlayerId = selectedPlayerId, nextDate = throwDate) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (nextPlayerId > 0) params.set('playerId', String(nextPlayerId));
      if (nextDate) params.set('date', nextDate);
      const response = await fetch(`/api/motion-capture?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json()) as Payload;
      if (!response.ok) throw new Error(payload.error || 'Failed to load motion capture data.');
      setPlayers(payload.players ?? []);
      setSelectedPlayer(payload.selectedPlayer ?? null);
      setTrackmanPitches(payload.trackmanPitches ?? []);
      setThrows(payload.throws ?? []);
      if (!nextPlayerId && payload.players?.[0]?.playerId) setSelectedPlayerId(payload.players[0].playerId);
      if (payload.selectedPlayer?.throwsHand) setHandedness(normalizeHandedness(payload.selectedPlayer.throwsHand));
      if (!selectedThrowId && payload.throws?.[0]?.id) setSelectedThrowId(payload.throws[0].id);
      if (!payload.videoStorageConfigured) setNotice('Video storage is not configured in this environment.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load motion capture data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(selectedPlayerId, throwDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPitchEventId('');
      load(selectedPlayerId, throwDate);
    }, 250);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlayerId, throwDate]);

  useEffect(() => {
    if (!selectedThrow) return;
    const views = new Set(selectedThrow.videos.map((video) => video.viewType));
    if (!views.has(selectedVideoView)) {
      setSelectedVideoView(views.has('side') ? 'side' : 'behind');
    }
  }, [selectedThrow, selectedVideoView]);

  useEffect(() => {
    const calibration = selectedThrow?.calibrationJson ?? null;
    const sync = calibration?.sync;
    const behindRubber = calibration?.behindRubber;
    if (sync && typeof sync === 'object') {
      setManualSyncAdjustmentMs(finiteNumber((sync as Record<string, unknown>).manualAdjustmentMs) ?? 0);
    } else {
      setManualSyncAdjustmentMs(0);
    }
    if (behindRubber && typeof behindRubber === 'object') {
      const row = behindRubber as Record<string, unknown>;
      const left = row.leftPx;
      const right = row.rightPx;
      setRubberLeft(left && typeof left === 'object' ? {
        x: finiteNumber((left as Record<string, unknown>).x) ?? 0,
        y: finiteNumber((left as Record<string, unknown>).y) ?? 0,
      } : null);
      setRubberRight(right && typeof right === 'object' ? {
        x: finiteNumber((right as Record<string, unknown>).x) ?? 0,
        y: finiteNumber((right as Record<string, unknown>).y) ?? 0,
      } : null);
    } else {
      setRubberLeft(null);
      setRubberRight(null);
    }
  }, [selectedThrow?.id, selectedThrow?.calibrationJson]);

  useEffect(() => {
    const behind = syncBehindVideoRef.current;
    if (!behind || !sideVideo || !behindVideo) return;
    const behindTarget = Math.max(0, syncViewerTime - syncBehindOffsetMs / 1000);
    if (Math.abs(behind.currentTime - behindTarget) > 0.035) behind.currentTime = behindTarget;
  }, [behindVideo, sideVideo, syncBehindOffsetMs, syncViewerTime]);

  useEffect(() => {
    const behind = reviewBehindVideoRef.current;
    if (!behind || !sideVideo || !behindVideo) return;
    const behindTarget = Math.max(0, currentTime - syncBehindOffsetMs / 1000);
    if (Math.abs(behind.currentTime - behindTarget) > 0.08) behind.currentTime = behindTarget;
  }, [behindVideo, currentTime, sideVideo, syncBehindOffsetMs]);

  const upload = async () => {
    setError('');
    setNotice('');
    if (!selectedPlayerId) {
      setError('Choose a player first.');
      return;
    }
    if (!sideFile && !behindFile) {
      setError('Upload at least one video.');
      return;
    }
    setUploading(true);
    try {
      const trackman = trackmanPitches.find((option) => option.pitchEventId === pitchEventId) ?? null;
      const form = new FormData();
      form.set('playerId', String(selectedPlayerId));
      form.set('throwDate', throwDate);
      form.set('handedness', handedness);
      form.set('throwType', pitchEventId ? 'trackman_pitch' : throwType);
      form.set('pitchEventId', pitchEventId);
      form.set('trackmanPitchLabel', trackman?.label ?? '');
      form.set('updateDefaultHandedness', updateDefaultHandedness ? '1' : '0');
      if (sideFile) form.set('sideVideo', sideFile);
      if (behindFile) form.set('behindVideo', behindFile);
      const response = await fetch('/api/motion-capture', { method: 'POST', body: form });
      const payload = (await response.json()) as { ok?: boolean; throwId?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Upload failed.');
      setNotice('Upload saved. Pose processing is ready to be wired to this throw.');
      setSideFile(null);
      setBehindFile(null);
      await load(selectedPlayerId, throwDate);
      if (payload.throwId) setSelectedThrowId(payload.throwId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const deleteThrow = async (throwId: number) => {
    if (!window.confirm('Delete this motion-capture throw and its videos?')) return;
    setError('');
    setNotice('');
    const response = await fetch(`/api/motion-capture?throwId=${throwId}`, { method: 'DELETE' });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(payload.error || 'Delete failed.');
      return;
    }
    setNotice('Motion-capture throw deleted.');
    setSelectedThrowId(null);
    await load(selectedPlayerId, throwDate);
  };

  const applyGraphPreset = (presetKey: string) => {
    const preset = GRAPH_PRESETS.find((entry) => entry.key === presetKey) ?? GRAPH_PRESETS[0]!;
    setGraphPresetKey(preset.key);
    setGraphUnitMode(preset.unit);
    setSelectedGraphMetricKeys(preset.metrics);
  };

  const toggleGraphMetric = (metricKey: string) => {
    setGraphPresetKey('custom');
    setSelectedGraphMetricKeys((current) => {
      if (current.includes(metricKey)) return current.filter((key) => key !== metricKey);
      return [...current, metricKey];
    });
  };

  const handleRubberPointClick = (event: MouseEvent<HTMLVideoElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const point = {
      x: Number(((event.clientX - rect.left) / rect.width).toFixed(5)),
      y: Number(((event.clientY - rect.top) / rect.height).toFixed(5)),
    };
    if (rubberPointMode === 'left') {
      setRubberLeft(point);
      setRubberPointMode('right');
    } else {
      setRubberRight(point);
    }
  };

  const saveCalibration = async () => {
    if (!selectedThrow) return;
    setSavingCalibration(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/motion-capture', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          throwId: selectedThrow.id,
          analysisStatus: selectedThrow.analysisStatus || 'uploaded',
          analysisMessage: selectedThrow.analysisMessage ?? null,
          calibrationJson: {
            sync: {
              method: 'peak_knee_lift',
              manualAdjustmentMs: manualSyncAdjustmentMs,
            },
            behindRubber: {
              rubberWidthIn: 24,
              leftPx: rubberLeft,
              rightPx: rubberRight,
              source: rubberLeft && rubberRight ? 'manual_endpoints' : 'pending',
            },
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Failed to save calibration.');
      setNotice('Calibration saved.');
      await load(selectedPlayerId, throwDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save calibration.');
    } finally {
      setSavingCalibration(false);
    }
  };

  const setSyncedVideoTime = (nextTime: number) => {
    const side = syncSideVideoRef.current;
    const behind = syncBehindVideoRef.current;
    const sideDuration = side?.duration && Number.isFinite(side.duration) ? side.duration : syncViewerDuration;
    const behindDuration = behind?.duration && Number.isFinite(behind.duration) ? behind.duration : syncViewerDuration;
    const clampedSide = Math.max(0, Math.min(nextTime, sideDuration || nextTime));
    const behindRawTime = clampedSide - syncBehindOffsetMs / 1000;
    const clampedBehind = Math.max(0, Math.min(behindRawTime, behindDuration || behindRawTime));
    setSyncViewerTime(clampedSide);
    if (side && Math.abs(side.currentTime - clampedSide) > 0.035) side.currentTime = clampedSide;
    if (behind && Math.abs(behind.currentTime - clampedBehind) > 0.035) behind.currentTime = clampedBehind;
  };

  const setReviewVideoTime = (nextTime: number) => {
    const side = reviewSideVideoRef.current;
    const behind = reviewBehindVideoRef.current;
    const single = videoRef.current;
    const sideDuration = side?.duration && Number.isFinite(side.duration) ? side.duration : duration || nextTime;
    const behindDuration = behind?.duration && Number.isFinite(behind.duration) ? behind.duration : duration || nextTime;
    const clampedSide = Math.max(0, Math.min(nextTime, sideDuration));
    const behindRawTime = clampedSide - syncBehindOffsetMs / 1000;
    const clampedBehind = Math.max(0, Math.min(behindRawTime, behindDuration));
    setCurrentTime(clampedSide);
    if (side && Math.abs(side.currentTime - clampedSide) > 0.035) side.currentTime = clampedSide;
    if (behind && Math.abs(behind.currentTime - clampedBehind) > 0.035) behind.currentTime = clampedBehind;
    if (single && Math.abs(single.currentTime - clampedSide) > 0.035) single.currentTime = clampedSide;
  };

  const playReviewVideos = async () => {
    setReviewVideoTime(currentTime);
    const videos = [reviewSideVideoRef.current, reviewBehindVideoRef.current, videoRef.current].filter(Boolean) as HTMLVideoElement[];
    try {
      await Promise.all(videos.map((video) => video.play()));
    } catch {
      // Browser autoplay rules can block this until the next click.
    }
  };

  const pauseReviewVideos = () => {
    reviewSideVideoRef.current?.pause();
    reviewBehindVideoRef.current?.pause();
    videoRef.current?.pause();
  };

  const playSyncedVideos = async () => {
    setSyncedVideoTime(syncViewerTime);
    const videos = [syncSideVideoRef.current, syncBehindVideoRef.current].filter(Boolean) as HTMLVideoElement[];
    try {
      await Promise.all(videos.map((video) => video.play()));
    } catch {
      // Browser autoplay rules can block this until the next click.
    }
  };

  const pauseSyncedVideos = () => {
    syncSideVideoRef.current?.pause();
    syncBehindVideoRef.current?.pause();
  };

  const runPoseAnalysis = async () => {
    if (!selectedThrow) return;
    const sideVideo = selectedThrow.videos.find((video) => video.viewType === 'side') ?? null;
    const behindVideo = selectedThrow.videos.find((video) => video.viewType === 'behind') ?? null;
    const fallbackVideo = sideVideo ?? behindVideo ?? selectedThrow.videos[0] ?? null;
    if (!fallbackVideo) {
      setError('No video is available to analyze.');
      return;
    }
    setAnalyzing(true);
    setError('');
    setNotice('');
    setAnalysisProgress('Loading pose model...');
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const wasm = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const landmarker = await vision.PoseLandmarker.createFromOptions(wasm, {
        baseOptions: {
          modelAssetPath: '/mediapipe/pose_landmarker_full.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.45,
        minPosePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
      });

      const analyzeVideo = async (sourceVideo: MotionCaptureVideo, timestampBaseMs: number): Promise<PoseFrame[]> => {
        const video = document.createElement('video');
        video.src = `/api/motion-capture/video/${sourceVideo.id}`;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error(`${sourceVideo.viewType} video metadata timed out.`)), 20000);
          video.onloadedmetadata = () => {
            window.clearTimeout(timeout);
            resolve();
          };
          video.onerror = () => {
            window.clearTimeout(timeout);
            reject(new Error(`Could not load ${sourceVideo.viewType} video for analysis.`));
          };
        });

        const durationSec = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        if (durationSec <= 0) throw new Error(`${sourceVideo.viewType} video duration is not available.`);
        const sampleFps = 30;
        const maxFrames = sourceVideo.viewType === 'behind' ? 220 : 260;
        const frameCount = Math.min(maxFrames, Math.max(12, Math.floor(durationSec * sampleFps)));
        const step = durationSec / frameCount;
        const rawFrames: PoseFrame[] = [];
        const throwing = selectedThrow.handedness === 'LHP' ? 'left' : 'right';
        const indices = {
          shoulder: throwing === 'right' ? 12 : 11,
          elbow: throwing === 'right' ? 14 : 13,
          wrist: throwing === 'right' ? 16 : 15,
          hip: throwing === 'right' ? 24 : 23,
          backHip: throwing === 'right' ? 24 : 23,
          backKnee: throwing === 'right' ? 26 : 25,
          leadHip: throwing === 'right' ? 23 : 24,
          leadKnee: throwing === 'right' ? 25 : 26,
          leadAnkle: throwing === 'right' ? 27 : 28,
          leadHeel: throwing === 'right' ? 29 : 30,
          leadToe: throwing === 'right' ? 31 : 32,
        };

        const seek = (time: number) =>
          new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error(`${sourceVideo.viewType} video seek timed out.`)), 10000);
            video.onseeked = () => {
              window.clearTimeout(timeout);
              resolve();
            };
            video.currentTime = Math.min(Math.max(time, 0), Math.max(0, durationSec - 0.001));
          });

        let previousWrist: PoseLandmark | null = null;
        let previousTime = 0;
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
          const timeSec = frameIndex * step;
          await seek(timeSec);
          const result = landmarker.detectForVideo(video, timestampBaseMs + Math.round(timeSec * 1000));
          const landmarks = (result.landmarks?.[0] ?? []) as PoseLandmark[];
          if (landmarks.length >= 33) {
            const shoulder = landmarks[indices.shoulder];
            const elbow = landmarks[indices.elbow];
            const wrist = landmarks[indices.wrist];
            const throwingHip = landmarks[indices.hip];
            const backHip = landmarks[indices.backHip];
            const backKnee = landmarks[indices.backKnee];
            const leadHip = landmarks[indices.leadHip];
            const leadKnee = landmarks[indices.leadKnee];
            const leadAnkle = landmarks[indices.leadAnkle];
            const leftShoulder = landmarks[11];
            const rightShoulder = landmarks[12];
            const leftHip = landmarks[23];
            const rightHip = landmarks[24];
            const shoulderMid =
              leftShoulder && rightShoulder
                ? { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 }
                : null;
            const hipMid =
              leftHip && rightHip
                ? { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 }
                : null;
            const torsoLineAngle = lineAngle(leftShoulder, rightShoulder);
            const pelvisLineAngle = lineAngle(leftHip, rightHip);
            const upperArmAngle = lineAngle(shoulder, elbow);
            const forearmAngle = lineAngle(elbow, wrist);
            const shoulderErProxy = angleDifference(forearmAngle, upperArmAngle);
            const dt = Math.max(0.001, timeSec - previousTime);
            const wristSpeed = previousWrist && wrist ? Math.hypot(wrist.x - previousWrist.x, wrist.y - previousWrist.y) / dt : null;
            rawFrames.push({
              viewType: sourceVideo.viewType,
              timeSec,
              frameIndex,
              landmarks,
              throwingElbowFlexion: elbowFlexionFromJointAngle(angleAt(shoulder, elbow, wrist)),
              shoulderErProxy: shoulderErProxy === null ? null : Math.abs(shoulderErProxy),
              shoulderAbduction2d: shoulderAbductionFromTorso(elbow, shoulder, throwingHip),
              scapRetractionProxy: angleAt(throwing === 'right' ? leftShoulder : rightShoulder, shoulder, elbow),
              leadLegFlexion: angleAt(leadHip, leadKnee, leadAnkle),
              leadShinAngle: leadShinAngle(leadKnee, leadAnkle),
              backLegDepthPct: backHip && backKnee ? Math.abs(backKnee.y - backHip.y) * 100 : null,
              torsoLineAngle,
              pelvisLineAngle,
              armLineAngle: upperArmAngle,
              wristSpeed,
              hipShoulderSeparation2d: angleDifference(torsoLineAngle, pelvisLineAngle),
              lateralTrunkTilt2d: shoulderMid && hipMid ? Math.abs(radiansToDegrees(Math.atan2(shoulderMid.x - hipMid.x, hipMid.y - shoulderMid.y))) : null,
            });
            previousWrist = wrist ?? previousWrist;
            previousTime = timeSec;
          }
          if (frameIndex % 12 === 0) {
            setAnalysisProgress(`Analyzing ${sourceVideo.viewType} ${Math.round((frameIndex / frameCount) * 100)}%`);
            await new Promise((resolve) => window.setTimeout(resolve, 0));
          }
        }
        return rawFrames;
      };

      const sideFrames = sideVideo ? await analyzeVideo(sideVideo, 0) : [];
      const behindFrames = behindVideo ? await analyzeVideo(behindVideo, 10_000_000) : [];
      const fallbackFrames = !sideFrames.length && !behindFrames.length && fallbackVideo ? await analyzeVideo(fallbackVideo, 20_000_000) : [];
      landmarker.close();

      setAnalysisProgress('Saving analysis...');
      const outputs = computePoseOutputs(sideFrames.length ? sideFrames : fallbackFrames, behindFrames, selectedThrow.handedness, manualSyncAdjustmentMs);
      const analyzedViews = [
        sideFrames.length ? `side ${sideFrames.length}` : '',
        behindFrames.length ? `behind ${behindFrames.length}` : '',
      ].filter(Boolean).join(', ');
      const response = await fetch('/api/motion-capture', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          throwId: selectedThrow.id,
          analysisStatus: behindFrames.length ? 'analyzed_side_and_behind' : 'analyzed_single_view',
          analysisMessage: `Analyzed ${analyzedViews || `${fallbackFrames.length} single-view`} pose frames. Behind-view rotation metrics are markerless 2D proxies.`,
          eventsJson: outputs.eventsJson,
          metricsJson: outputs.metricsJson,
          graphJson: outputs.graphJson,
          calibrationJson: {
            behindRubberWidthIn: 24,
            scaleSource: 'pitching_rubber_pending_manual_detection',
            playerHeight: selectedThrow.playerHeight,
            sync: outputs.graphJson.sync,
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Failed to save analysis.');
      setNotice('Pose analysis saved.');
      await load(selectedPlayerId, throwDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pose analysis failed.');
    } finally {
      setAnalysisProgress('');
      setAnalyzing(false);
    }
  };

  return (
    <div className="portal-admin-stack">
      <div className="portal-dashboard-suite-layout portal-dashboard-suite-layout--double">
        <section className="portal-admin-card">
          <h2>Upload Throw</h2>
          <div className="portal-form-grid">
            <label>
              Player
              <select
                value={selectedPlayerId || ''}
                onChange={(event) => setSelectedPlayerId(Number(event.target.value))}
              >
                {players.map((player) => (
                  <option key={player.playerId} value={player.playerId}>
                    {player.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input type="date" value={throwDate} onChange={(event) => setThrowDate(event.target.value)} />
            </label>
            <label>
              Handedness
              <select value={handedness} onChange={(event) => setHandedness(normalizeHandedness(event.target.value))}>
                <option value="RHP">RHP</option>
                <option value="LHP">LHP</option>
              </select>
            </label>
            <label>
              Throw Type
              <select value={throwType} onChange={(event) => setThrowType(event.target.value)} disabled={Boolean(pitchEventId)}>
                {THROW_TYPES.filter((option) => option.value !== 'trackman_pitch' || pitchEventId).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="portal-form-span-2">
              Optional TrackMan Pitch
              <select value={pitchEventId} onChange={(event) => setPitchEventId(event.target.value)}>
                <option value="">No TrackMan pitch</option>
                {trackmanPitches.map((pitch) => (
                  <option key={pitch.pitchEventId} value={pitch.pitchEventId}>
                    {pitch.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Side Video
              <input type="file" accept="video/*" onChange={(event) => setSideFile(event.target.files?.[0] ?? null)} />
            </label>
            <label>
              Behind Video
              <input type="file" accept="video/*" onChange={(event) => setBehindFile(event.target.files?.[0] ?? null)} />
            </label>
            <label className="portal-form-span-2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={updateDefaultHandedness}
                onChange={(event) => setUpdateDefaultHandedness(event.target.checked)}
                style={{ width: 18, minHeight: 18 }}
              />
              Save this handedness as the player default
            </label>
            <button type="button" className="btn btn-primary portal-form-span-2" onClick={upload} disabled={uploading || loading}>
              {uploading ? 'Uploading...' : 'Upload Motion Capture'}
            </button>
          </div>
          {selectedPlayer ? (
            <p className="portal-muted-text" style={{ marginBottom: 0 }}>
              Profile scale inputs: {selectedPlayer.height || 'height not set'}; 24 inch pitching rubber from behind view.
            </p>
          ) : null}
        </section>

        <section className="portal-admin-card">
          <h2>Saved Throws</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {throws.length === 0 ? <p className="portal-muted-text">No motion-capture throws saved for this filter.</p> : null}
            {throws.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={selectedThrow?.id === entry.id ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => setSelectedThrowId(entry.id)}
                style={{ justifyContent: 'space-between', gap: 12 }}
              >
                <span style={{ textAlign: 'left' }}>
                  <strong>{entry.throwDate}</strong> {entry.trackmanPitchLabel || entry.throwType.replace(/_/g, ' ')}
                  <br />
                  <span className="portal-muted-text">{entry.handedness} - {entry.videos.length} video{entry.videos.length === 1 ? '' : 's'} - {entry.analysisStatus}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {error ? <p className="auth-error" style={{ margin: 0 }}>{error}</p> : null}
      {notice ? <p className="portal-muted-text" style={{ margin: 0 }}>{notice}</p> : null}

      <section className="portal-admin-card portal-admin-card-wide">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Review</h2>
            <p className="portal-muted-text" style={{ margin: 0 }}>
              {selectedThrow ? `${selectedThrow.playerName} - ${selectedThrow.throwDate}` : 'Choose or upload a throw.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {availableVideoViews.length > 1 ? (
              <>
                {availableVideoViews.map((view) => (
                  <button
                    key={`view-${view}`}
                    type="button"
                    className={selectedVideoView === view ? 'btn btn-primary' : 'btn btn-ghost'}
                    onClick={() => {
                      setSelectedVideoView(view);
                      setCurrentTime(0);
                    }}
                  >
                    {view === 'side' ? 'Side View' : 'Behind View'}
                  </button>
                ))}
              </>
            ) : null}
            {(['video', 'skeleton', 'markers'] as const).map((mode) => (
              <button key={mode} type="button" className={viewMode === mode ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setViewMode(mode)}>
                {mode === 'video' ? 'Video' : mode === 'skeleton' ? 'Skeleton' : 'Markers'}
              </button>
            ))}
            {selectedThrow ? (
              <>
                <button type="button" className="btn btn-primary" onClick={runPoseAnalysis} disabled={analyzing}>
                  {analyzing ? (analysisProgress || 'Analyzing...') : 'Run Pose Analysis'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => deleteThrow(selectedThrow.id)} disabled={analyzing}>
                  Delete
                </button>
              </>
            ) : null}
          </div>
        </div>

        {selectedThrow ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(320px, 0.7fr) minmax(min(100%, 620px), 1.3fr)',
              gap: 12,
              alignItems: 'stretch',
              marginTop: 12,
              overflowX: 'auto',
            }}
          >
            <div>
              {viewMode === 'video' && sideVideo && behindVideo ? (
                <div className="portal-admin-card" style={{ padding: 10 }}>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div>
                      <p className="portal-muted-text" style={{ margin: '0 0 6px' }}>Side View</p>
                      <video
                        ref={reviewSideVideoRef}
                        src={`/api/motion-capture/video/${sideVideo.id}`}
                        playsInline
                        muted
                        controls={false}
                        style={{ width: '100%', maxHeight: 'min(30vh, 310px)', background: '#050505', borderRadius: 8 }}
                        onLoadedMetadata={(event) => {
                          const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
                          setDuration((current) => Math.max(current, nextDuration));
                        }}
                        onTimeUpdate={(event) => {
                          if (!event.currentTarget.paused) {
                            const time = event.currentTarget.currentTime;
                            setCurrentTime(time);
                            const behind = reviewBehindVideoRef.current;
                            if (behind) {
                              const behindTarget = Math.max(0, time - syncBehindOffsetMs / 1000);
                              if (Math.abs(behind.currentTime - behindTarget) > 0.08) behind.currentTime = behindTarget;
                            }
                          }
                        }}
                      />
                    </div>
                    <div>
                      <p className="portal-muted-text" style={{ margin: '0 0 6px' }}>Behind View</p>
                      <video
                        ref={reviewBehindVideoRef}
                        src={`/api/motion-capture/video/${behindVideo.id}`}
                        playsInline
                        muted
                        controls={false}
                        style={{ width: '100%', maxHeight: 'min(30vh, 310px)', background: '#050505', borderRadius: 8 }}
                        onLoadedMetadata={(event) => {
                          const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
                          setDuration((current) => Math.max(current, nextDuration));
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <button type="button" className="btn btn-primary" onClick={playReviewVideos}>
                      Play Synced
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={pauseReviewVideos}>
                      Pause
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setReviewVideoTime(Math.max(0, currentTime - 0.033))}>
                      -1 frame
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setReviewVideoTime(currentTime + 0.033)}>
                      +1 frame
                    </button>
                  </div>
                  <p className="portal-muted-text" style={{ margin: '8px 0 0' }}>
                    Behind offset: {syncBehindOffsetMs.toFixed(0)} ms
                  </p>
                </div>
              ) : null}
              {viewMode === 'video' && !(sideVideo && behindVideo) && activeVideo ? (
                <div className="portal-admin-card" style={{ padding: 10 }}>
                  <video
                    key={activeVideo.id}
                    ref={videoRef}
                    src={`/api/motion-capture/video/${activeVideo.id}`}
                    controls
                    playsInline
                    style={{ width: '100%', maxHeight: 'min(62vh, 620px)', background: '#050505', borderRadius: 8 }}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
                  />
                  <p className="portal-muted-text" style={{ margin: '8px 0 0' }}>
                    {activeVideo.viewType} - {activeVideo.fileName} - {formatBytes(activeVideo.sizeBytes)}
                  </p>
                </div>
              ) : null}
              {viewMode !== 'video' ? <SkeletonPreview mode={viewMode} frame={currentPoseFrame} /> : null}
            </div>

            <div className="portal-admin-card" style={{ minHeight: 'min(72vh, 780px)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>Synced Graph</h3>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {GRAPH_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      className={graphPresetKey === preset.key ? 'btn btn-primary' : 'btn btn-ghost'}
                      onClick={() => applyGraphPreset(preset.key)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {(['deg', 'deg/s'] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    className={graphUnitMode === unit ? 'btn btn-primary' : 'btn btn-ghost'}
                    onClick={() => {
                      setGraphUnitMode(unit);
                      setGraphPresetKey('custom');
                      const allowed = GRAPH_METRICS.filter((metric) => metric.unit === unit).map((metric) => metric.key);
                      setSelectedGraphMetricKeys((current) => current.filter((key) => allowed.includes(key)));
                    }}
                  >
                    {unit === 'deg' ? 'Degrees' : 'Rotational Speeds'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: 6, marginTop: 10 }}>
                {GRAPH_METRICS.filter((metric) => metric.unit === graphUnitMode).map((metric) => (
                  <label key={metric.key} className="portal-muted-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={selectedGraphMetricKeys.includes(metric.key)}
                      onChange={() => toggleGraphMetric(metric.key)}
                      style={{ width: 16, minHeight: 16 }}
                    />
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: metric.color, display: 'inline-block' }} />
                    {metric.label}
                  </label>
                ))}
              </div>
              <div style={{ position: 'relative', flex: '1 1 420px', minHeight: 420, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, overflow: 'hidden', background: 'rgba(255,255,255,0.035)', marginTop: 10 }}>
                <svg viewBox="0 0 640 420" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
                  <rect x="72" y="42" width="548" height="308" fill="rgba(0,0,0,0.08)" />
                  {graphYTicks.map((tick) => (
                    <g key={`y-grid-${tick.ratio}`}>
                      <line x1="72" x2="620" y1={tick.y} y2={tick.y} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                      <text x="62" y={tick.y + 4} textAnchor="end" fill="rgba(226,232,240,0.72)" fontSize="11">
                        {tick.label}
                      </text>
                    </g>
                  ))}
                  {graphXTicks.map((tick) => (
                    <g key={`x-grid-${tick.ratio}`}>
                      <line x1={tick.x} x2={tick.x} y1="42" y2="350" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                      <text x={tick.x} y="372" textAnchor="middle" fill="rgba(226,232,240,0.72)" fontSize="11">
                        {tick.label}s
                      </text>
                    </g>
                  ))}
                  <line x1="72" x2="620" y1="350" y2="350" stroke="rgba(226,232,240,0.34)" strokeWidth="1.2" />
                  <line x1="72" x2="72" y1="42" y2="350" stroke="rgba(226,232,240,0.34)" strokeWidth="1.2" />
                  <text x="346" y="406" textAnchor="middle" fill="rgba(226,232,240,0.82)" fontSize="12">
                    Time (seconds)
                  </text>
                  <text x="18" y="196" textAnchor="middle" transform="rotate(-90 18 196)" fill="rgba(226,232,240,0.82)" fontSize="12">
                    {graphUnitMode === 'deg' ? 'Degrees' : 'Degrees / second'}
                  </text>
                  {graphPaths.map((path) => (
                    <path key={path.metric.key} d={path.d} fill="none" stroke={path.metric.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  ))}
                  {graphEventMarkers.map((event, index) => {
                    const x = event.x;
                    const labelY = 54 + index * 16;
                    return (
                      <g key={`event-marker-${event.key}`}>
                        <line x1={x} x2={x} y1="42" y2="350" stroke="rgba(250,204,21,0.82)" strokeWidth="1.5" strokeDasharray="5 5" />
                        <text x={Math.min(608, Math.max(80, x + 4))} y={labelY} fill="rgba(250,204,21,0.95)" fontSize="11">
                          {event.label}
                        </text>
                      </g>
                    );
                  })}
                  <line x1={currentGraphX} y1="42" x2={currentGraphX} y2="350" stroke="rgba(248,250,252,0.95)" strokeWidth="2" />
                  {currentGraphMarkers.map((marker) => (
                    <g key={`current-marker-${marker.metric.key}`}>
                      <circle cx={marker.x} cy={marker.y} r="5" fill={marker.metric.color} stroke="rgba(2,6,23,0.95)" strokeWidth="2" />
                      <text x={Math.min(604, marker.x + 8)} y={Math.max(52, marker.y - 8)} fill="rgba(248,250,252,0.92)" fontSize="10">
                        {marker.value.toFixed(1)}
                      </text>
                    </g>
                  ))}
                </svg>
                {!graphRows.length ? (
                  <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                    <p className="portal-muted-text" style={{ margin: 0 }}>Run Pose Analysis to populate graph data.</p>
                  </div>
                ) : null}
              </div>
              {currentGraphValues.length ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginTop: 8 }}>
                  {currentGraphValues.map(({ metric, value, timeSec }) => (
                    <div
                      key={`current-value-${metric.key}`}
                      style={{
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        padding: '8px 10px',
                        background: 'rgba(255,255,255,0.035)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 999, background: metric.color, display: 'inline-block' }} />
                        <span className="portal-muted-text">{metric.label}</span>
                      </div>
                      <strong style={{ display: 'block', marginTop: 4 }}>
                        {value === null ? '-' : `${value.toFixed(1)} ${metric.unit}`}
                      </strong>
                      <span className="portal-muted-text">{timeSec.toFixed(3)}s</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                {activeGraphMetrics.map((metric) => (
                  <span key={`legend-${metric.key}`} className="portal-muted-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: metric.color, display: 'inline-block' }} />
                    {metric.label}
                  </span>
                ))}
              </div>
              <input
                type="range"
                min="0"
                max={duration || 0}
                step="0.001"
                value={Math.min(currentTime, duration || currentTime)}
                onChange={(event) => setReviewVideoTime(Number(event.target.value))}
                style={{ width: '100%', marginTop: 10 }}
              />
              <p className="portal-muted-text" style={{ margin: 0 }}>
                {duration > 0 ? `${currentTime.toFixed(3)}s / ${duration.toFixed(3)}s` : 'Load a video to scrub.'}
              </p>
              <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
                {EVENT_LABELS.map((event) => (
                  <div key={event.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>{event.label}</span>
                    <span className="portal-muted-text">{readEventFrame(selectedThrow.eventsJson, event.key)}</span>
                  </div>
                ))}
              </div>
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Foot Plant</th>
                      <th>Max ER</th>
                      <th>BR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricRows.length ? (
                      metricRows.map((row) => (
                        <tr key={row.metric}>
                          <td>{row.metric}</td>
                          <td>{row.footPlant}</td>
                          <td>{row.maxEr}</td>
                          <td>{row.ballRelease}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4}>Metrics will appear here after pose analysis runs.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {selectedThrow ? (
        <section className="portal-admin-card portal-admin-card-wide">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ marginBottom: 4 }}>Calibration</h2>
              <p className="portal-muted-text" style={{ margin: 0 }}>
                Sync uses peak knee lift. Behind-view scale uses the 24 inch pitching rubber.
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={saveCalibration} disabled={savingCalibration}>
              {savingCalibration ? 'Saving...' : 'Save Calibration'}
            </button>
          </div>

          {sideVideo && behindVideo ? (
            <div className="portal-admin-card" style={{ marginTop: 12 }}>
              <h3>Synced Playback</h3>
              <div className="portal-dashboard-suite-layout portal-dashboard-suite-layout--double">
                <div>
                  <p className="portal-muted-text" style={{ margin: '0 0 6px' }}>Side View</p>
                  <video
                    ref={syncSideVideoRef}
                    src={`/api/motion-capture/video/${sideVideo.id}`}
                    playsInline
                    muted
                    controls={false}
                    onLoadedMetadata={(event) => {
                      const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
                      setSyncViewerDuration((current) => Math.max(current, nextDuration));
                    }}
                    onTimeUpdate={(event) => {
                      if (!event.currentTarget.paused) {
                        const time = event.currentTarget.currentTime;
                        setSyncViewerTime(time);
                        const behind = syncBehindVideoRef.current;
                        if (behind) {
                          const behindTarget = Math.max(0, time - syncBehindOffsetMs / 1000);
                          if (Math.abs(behind.currentTime - behindTarget) > 0.08) behind.currentTime = behindTarget;
                        }
                      }
                    }}
                    style={{ width: '100%', maxHeight: 360, background: '#050505', borderRadius: 8 }}
                  />
                </div>
                <div>
                  <p className="portal-muted-text" style={{ margin: '0 0 6px' }}>Behind View</p>
                  <video
                    ref={syncBehindVideoRef}
                    src={`/api/motion-capture/video/${behindVideo.id}`}
                    playsInline
                    muted
                    controls={false}
                    onLoadedMetadata={(event) => {
                      const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
                      setSyncViewerDuration((current) => Math.max(current, nextDuration));
                    }}
                    style={{ width: '100%', maxHeight: 360, background: '#050505', borderRadius: 8 }}
                  />
                </div>
              </div>
              <input
                type="range"
                min="0"
                max={syncViewerDuration || 0}
                step="0.001"
                value={Math.min(syncViewerTime, syncViewerDuration || syncViewerTime)}
                onChange={(event) => setSyncedVideoTime(Number(event.target.value))}
                style={{ width: '100%', marginTop: 10 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <p className="portal-muted-text" style={{ margin: 0 }}>
                  Side {syncViewerTime.toFixed(3)}s; behind offset {syncBehindOffsetMs.toFixed(0)} ms
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setSyncedVideoTime(Math.max(0, syncViewerTime - 0.033))}>
                    -1 frame
                  </button>
                  <button type="button" className="btn btn-primary" onClick={playSyncedVideos}>
                    Play Synced
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={pauseSyncedVideos}>
                    Pause
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setSyncedVideoTime(syncViewerTime + 0.033)}>
                    +1 frame
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="portal-dashboard-suite-layout portal-dashboard-suite-layout--double" style={{ marginTop: 12 }}>
            <div className="portal-admin-card">
              <h3>Peak Knee Lift Sync</h3>
              <label className="portal-muted-text" style={{ display: 'grid', gap: 8 }}>
                Manual behind-video offset: {manualSyncAdjustmentMs} ms
                <input
                  type="range"
                  min="-500"
                  max="500"
                  step="5"
                  value={manualSyncAdjustmentMs}
                  onChange={(event) => {
                    setManualSyncAdjustmentMs(Number(event.target.value));
                    window.requestAnimationFrame(() => setSyncedVideoTime(syncViewerTime));
                  }}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <button type="button" className="btn btn-ghost" onClick={() => {
                  setManualSyncAdjustmentMs((value) => Math.max(-500, value - 10));
                  window.requestAnimationFrame(() => setSyncedVideoTime(syncViewerTime));
                }}>
                  Behind -10 ms
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => {
                  setManualSyncAdjustmentMs((value) => Math.min(500, value + 10));
                  window.requestAnimationFrame(() => setSyncedVideoTime(syncViewerTime));
                }}>
                  Behind +10 ms
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => {
                  setManualSyncAdjustmentMs(0);
                  window.requestAnimationFrame(() => setSyncedVideoTime(syncViewerTime));
                }}>
                  Reset
                </button>
              </div>
              <p className="portal-muted-text" style={{ marginBottom: 0 }}>
                Run Pose Analysis after changing sync to recompute behind-view event metrics with the saved offset.
              </p>
            </div>

            <div className="portal-admin-card">
              <h3>Behind Rubber Scale</h3>
              {behindVideo ? (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    <button type="button" className={rubberPointMode === 'left' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setRubberPointMode('left')}>
                      Mark Left End
                    </button>
                    <button type="button" className={rubberPointMode === 'right' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setRubberPointMode('right')}>
                      Mark Right End
                    </button>
                  </div>
                  <div style={{ position: 'relative', width: '100%', background: '#050505', borderRadius: 8, overflow: 'hidden' }}>
                    <video
                      ref={calibrationVideoRef}
                      src={`/api/motion-capture/video/${behindVideo.id}`}
                      controls
                      playsInline
                      onClick={handleRubberPointClick}
                      style={{ width: '100%', maxHeight: 420, display: 'block', cursor: 'crosshair' }}
                    />
                    {[['left', rubberLeft], ['right', rubberRight]].map(([label, point]) => {
                      if (!point || typeof point !== 'object') return null;
                      const p = point as { x: number; y: number };
                      return (
                        <div
                          key={String(label)}
                          style={{
                            position: 'absolute',
                            left: `${p.x * 100}%`,
                            top: `${p.y * 100}%`,
                            width: 14,
                            height: 14,
                            borderRadius: 999,
                            border: '2px solid #facc15',
                            background: 'rgba(250,204,21,0.25)',
                            transform: 'translate(-50%, -50%)',
                            pointerEvents: 'none',
                          }}
                        />
                      );
                    })}
                  </div>
                  <p className="portal-muted-text" style={{ marginBottom: 0 }}>
                    Left: {rubberLeft ? `${Math.round(rubberLeft.x * 100)}%, ${Math.round(rubberLeft.y * 100)}%` : '-'}; Right:{' '}
                    {rubberRight ? `${Math.round(rubberRight.x * 100)}%, ${Math.round(rubberRight.y * 100)}%` : '-'}
                  </p>
                </>
              ) : (
                <p className="portal-muted-text">Upload a behind video to mark the rubber endpoints.</p>
              )}
            </div>
          </div>
        </section>
      ) : null}

    </div>
  );
}

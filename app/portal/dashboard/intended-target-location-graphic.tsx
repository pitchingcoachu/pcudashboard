'use client';

import type { CSSProperties } from 'react';
import styles from './intended-zone-panel.module.css';

// Same fixed geometry as intended-zone-pitch-log.tsx's PitchLocationGraphic
// (kept identical so the two look pixel-alike) -- extracted here so it can
// also be reused by the pitch video modal's Intended Target view
// (pitching-suite.tsx), which has no reason to import the whole Pitch Log
// page just for this one graphic.
const ZONE_W = 230;
const ZONE_H = 250;
const X_MIN = -2.5;
const X_MAX = 2.5;
const Y_MIN = 0;
const Y_MAX = 4.5;
const PAD = 10;
const SCALE = Math.min((ZONE_W - PAD * 2) / (X_MAX - X_MIN), (ZONE_H - PAD * 2) / (Y_MAX - Y_MIN));
const DRAWN_W = (X_MAX - X_MIN) * SCALE;
const DRAWN_H = (Y_MAX - Y_MIN) * SCALE;
const LEFT_PAD = (ZONE_W - DRAWN_W) / 2;
const TOP_PAD = (ZONE_H - DRAWN_H) / 2;
const px = (x: number) => LEFT_PAD + (x - X_MIN) * SCALE;
const py = (y: number) => TOP_PAD + (Y_MAX - y) * SCALE;
const STRIKE_LEFT = -0.88;
const STRIKE_RIGHT = 0.88;
const STRIKE_BOTTOM = 1.5;
const STRIKE_TOP = 3.6;
const STRIKE_CENTER_Y = (STRIKE_BOTTOM + STRIKE_TOP) / 2;
const STRIKE_THIRD_X = (STRIKE_RIGHT - STRIKE_LEFT) / 3;
const STRIKE_THIRD_Y = (STRIKE_TOP - STRIKE_BOTTOM) / 3;
const POCKETS = Array.from({ length: 9 }, (_, index) => ({
  number: index + 1,
  x: STRIKE_LEFT + STRIKE_THIRD_X * ((index % 3) + 0.5),
  y: STRIKE_TOP - STRIKE_THIRD_Y * (Math.floor(index / 3) + 0.5),
}));

export const INTENDED_TARGET_GRAPHIC_PITCH_COLORS: Record<string, string> = {
  Fastball: '#ffcc33', Sinker: '#f97316', Cutter: '#c08457', Slider: '#ef4444', Sweeper: '#a855f7',
  Curveball: '#3b82f6', ChangeUp: '#22c55e', Splitter: '#2dd4bf', Knuckleball: '#6366f1', Undefined: '#94a3b8',
};

export type IntendedTargetLocationPitch = {
  pitchIndex: number;
  intendedSideFt: number;
  intendedHeightFt: number;
  targetRadiusFt: number;
  plateLocSide: number;
  plateLocHeight: number;
  pitchType: string | null;
};

// Bare SVG (no wrapper div, no gradient background, no legend row) --
// shared by IntendedTargetLocationGraphic below (Pitch Log's full card) and
// pitching-suite.tsx's compact video-modal sidebar, which needs just the
// diagram at a much smaller footprint with no legend/border/background.
export function IntendedTargetLocationSvg({
  pitch,
  ariaLabel,
  style,
}: {
  pitch: IntendedTargetLocationPitch;
  ariaLabel?: string;
  style?: CSSProperties;
}) {
  const color = INTENDED_TARGET_GRAPHIC_PITCH_COLORS[pitch.pitchType ?? 'Undefined'] ?? INTENDED_TARGET_GRAPHIC_PITCH_COLORS.Undefined;
  const targetX = px(pitch.intendedSideFt);
  const targetY = py(pitch.intendedHeightFt);
  const actualX = px(pitch.plateLocSide);
  const actualY = py(pitch.plateLocHeight);
  return (
    <svg viewBox={`0 0 ${ZONE_W} ${ZONE_H}`} style={style} aria-label={ariaLabel ?? `Pitch ${pitch.pitchIndex}: intended target and actual location`}>
      <polygon points={`${px(-0.75)},${py(0.55)} ${px(0.75)},${py(0.55)} ${px(0.75)},${py(0.65)} ${px(0)},${py(0.75)} ${px(-0.75)},${py(0.65)}`} fill="none" stroke="rgba(226,232,240,.75)" strokeWidth="3" />
      <rect x={px(-1.5)} y={py(STRIKE_CENTER_Y + 1.5)} width={px(1.5) - px(-1.5)} height={py(STRIKE_CENTER_Y - 1.5) - py(STRIKE_CENTER_Y + 1.5)} fill="none" stroke="rgba(148,163,184,.28)" strokeWidth="2" />
      <line x1={px(-1.5)} y1={py(STRIKE_CENTER_Y)} x2={px(1.5)} y2={py(STRIKE_CENTER_Y)} stroke="rgba(148,163,184,.2)" />
      <line x1={px(0)} y1={py(STRIKE_CENTER_Y - 1.5)} x2={px(0)} y2={py(STRIKE_CENTER_Y + 1.5)} stroke="rgba(148,163,184,.2)" />
      <rect x={px(STRIKE_LEFT)} y={py(STRIKE_TOP)} width={px(STRIKE_RIGHT) - px(STRIKE_LEFT)} height={py(STRIKE_BOTTOM) - py(STRIKE_TOP)} fill="rgba(15,23,42,.28)" stroke="#e2e8f0" strokeWidth="3" />
      {[1, 2].map((third) => (
        <line key={`vertical-${third}`} x1={px(STRIKE_LEFT + STRIKE_THIRD_X * third)} y1={py(STRIKE_TOP)} x2={px(STRIKE_LEFT + STRIKE_THIRD_X * third)} y2={py(STRIKE_BOTTOM)} stroke="rgba(148,163,184,.48)" strokeWidth="1" />
      ))}
      {[1, 2].map((third) => (
        <line key={`horizontal-${third}`} x1={px(STRIKE_LEFT)} y1={py(STRIKE_TOP - STRIKE_THIRD_Y * third)} x2={px(STRIKE_RIGHT)} y2={py(STRIKE_TOP - STRIKE_THIRD_Y * third)} stroke="rgba(148,163,184,.48)" strokeWidth="1" />
      ))}
      {POCKETS.map((pocket) => (
        <text key={pocket.number} x={px(pocket.x)} y={py(pocket.y)} className={styles.historyPocketNumber}>{pocket.number}</text>
      ))}
      <text x={px(-1.19)} y={py(3.825)} className={styles.historyPocketNumber}>10</text>
      <text x={px(1.19)} y={py(3.825)} className={styles.historyPocketNumber}>11</text>
      <text x={px(-1.19)} y={py(1.275)} className={styles.historyPocketNumber}>12</text>
      <text x={px(1.19)} y={py(1.275)} className={styles.historyPocketNumber}>13</text>
      <line x1={targetX} y1={targetY} x2={actualX} y2={actualY} stroke="rgba(226,232,240,.55)" strokeWidth="1.5" strokeDasharray="5 4" />
      <circle cx={targetX} cy={targetY} r={Math.max(5, pitch.targetRadiusFt * SCALE)} fill="rgba(74,222,128,.17)" stroke="#4ade80" strokeWidth="2.3" strokeDasharray="5 4" />
      <circle cx={targetX} cy={targetY} r="3" fill="#86efac" />
      <circle cx={actualX} cy={actualY} r="8" fill={color} stroke="#f8fafc" strokeWidth="2" />
    </svg>
  );
}

export function IntendedTargetLocationGraphic({ pitch }: { pitch: IntendedTargetLocationPitch }) {
  const color = INTENDED_TARGET_GRAPHIC_PITCH_COLORS[pitch.pitchType ?? 'Undefined'] ?? INTENDED_TARGET_GRAPHIC_PITCH_COLORS.Undefined;
  return (
    <div className={styles.historyPitchVisual}>
      <IntendedTargetLocationSvg pitch={pitch} />
      <div className={styles.historyPitchLegend}>
        <span>
          <svg className={styles.historyLegendTarget} viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5" /><circle cx="7" cy="7" r="1.5" /></svg>
          Intended target
        </span>
        <span><i className={styles.historyLegendActual} style={{ background: color }} /> Actual location</span>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  INTENDED_STRIKE_BOTTOM,
  INTENDED_STRIKE_LEFT,
  INTENDED_STRIKE_RIGHT,
  INTENDED_STRIKE_TOP,
  intendedTargetLocation,
} from '../../../lib/intended-target-location';

// Same fixed geometry as intended-target-location-graphic.tsx / the other
// bare strike-zone SVGs used elsewhere in Custom Reports (not
// intended-zone-targeting.tsx's own larger card layout), so this reads as
// "one of the app's normal zone panels" rather than the Targeting page's
// distinct dark-gradient card styling.
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
const feetX = (x: number) => X_MIN + (x - LEFT_PAD) / SCALE;
const feetY = (y: number) => Y_MAX - (y - TOP_PAD) / SCALE;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const STRIKE_CENTER_Y = (INTENDED_STRIKE_BOTTOM + INTENDED_STRIKE_TOP) / 2;
const STRIKE_THIRD_X = (INTENDED_STRIKE_RIGHT - INTENDED_STRIKE_LEFT) / 3;
const STRIKE_THIRD_Y = (INTENDED_STRIKE_TOP - INTENDED_STRIKE_BOTTOM) / 3;
const POCKETS = Array.from({ length: 9 }, (_, index) => ({
  number: index + 1,
  x: INTENDED_STRIKE_LEFT + STRIKE_THIRD_X * ((index % 3) + 0.5),
  y: INTENDED_STRIKE_TOP - STRIKE_THIRD_Y * (Math.floor(index / 3) + 0.5),
}));

// Fixed at the same default as the Pitch Log's TARGET_SIZE_DISPLAY_PRESETS
// default -- no size picker here, per the panel's stripped-down scope.
const TARGET_DIAMETER_INCHES = 8;

type TargetingSample = { pitchCount: number; avgMissSideFt: number; avgMissHeightFt: number };
type TargetingProfile = { pitchType: string; pitchCount: number; throwsLeft: boolean; overall: TargetingSample; byLocation: Record<string, TargetingSample> };
type TargetPoint = { sideFt: number; heightFt: number };

function buildCorrectionVector(x1: number, y1: number, x2: number, y2: number, startRadius: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 0.1) return { dashes: [] as { x1: number; y1: number; x2: number; y2: number }[], arrowPoints: '' };
  const ux = dx / length;
  const uy = dy / length;
  const perpendicularX = -uy;
  const perpendicularY = ux;
  const arrowLength = Math.min(11, length * 0.35);
  const arrowWidth = Math.min(5, length * 0.16);
  const arrowBaseX = x2 - ux * arrowLength;
  const arrowBaseY = y2 - uy * arrowLength;
  const arrowPoints = [
    `${x2},${y2}`,
    `${arrowBaseX + perpendicularX * arrowWidth},${arrowBaseY + perpendicularY * arrowWidth}`,
    `${arrowBaseX - perpendicularX * arrowWidth},${arrowBaseY - perpendicularY * arrowWidth}`,
  ].join(' ');
  const dashes: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const startDistance = Math.min(startRadius + 8, length * 0.45);
  const endDistance = Math.max(startDistance, length - arrowLength);
  const dashLength = 7;
  const gapLength = 5;
  for (let distance = startDistance; distance < endDistance; distance += dashLength + gapLength) {
    const dashEnd = Math.min(distance + dashLength, endDistance);
    dashes.push({ x1: x1 + ux * distance, y1: y1 + uy * distance, x2: x1 + ux * dashEnd, y2: y1 + uy * dashEnd });
  }
  return { dashes, arrowPoints };
}

/** Stripped-down Intended Target Map for a Custom Reports panel: click the
 * zone to set a desired result, and the recommended-aim reticle is computed
 * from that pitcher's real historical miss data -- same mechanism and same
 * /api/dashboard/pitching/intended-zone/targeting endpoint as the full
 * Targeting page's TargetingMap (intended-zone-targeting.tsx), but with no
 * card chrome, no target-size picker (fixed at 8"), no in-panel pitch
 * selector (driven by the report panel's own Pitch Types filter instead),
 * and no side recommendations readout -- just the bare zone and legend,
 * restyled to match the rest of the app's plain heatmap/zone panels instead
 * of the Targeting page's own dark-gradient card look. */
export function IntendedTargetMapMini({
  pitcherName,
  startDate,
  endDate,
  selectedPitchTypes,
  selectedBallTypes,
}: {
  pitcherName: string | null;
  startDate: string;
  endDate: string;
  selectedPitchTypes: string[];
  selectedBallTypes: string[];
}) {
  const [profiles, setProfiles] = useState<TargetingProfile[]>([]);
  const [target, setTarget] = useState<TargetPoint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    if (!pitcherName) {
      setProfiles([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pitcherName });
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (selectedPitchTypes.length) params.set('pitchTypes', selectedPitchTypes.join(','));
      if (selectedBallTypes.length) params.set('ballTypes', selectedBallTypes.join(','));
      const response = await fetch(`/api/dashboard/pitching/intended-zone/targeting?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to build targeting profile.');
      setProfiles(Array.isArray(payload.profiles) ? payload.profiles : []);
    } catch (loadError) {
      setProfiles([]);
      setError(loadError instanceof Error ? loadError.message : 'Unable to build targeting profile.');
    } finally {
      setLoading(false);
    }
  }, [endDate, pitcherName, selectedBallTypes, selectedPitchTypes, startDate]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    setTarget(null);
  }, [pitcherName, selectedPitchTypes.join(',')]);

  // Only one profile is ever shown -- selectedPitchTypes (the report panel's
  // own Pitch Types filter) is what narrows it down. When multiple pitch
  // types are selected, this uses whichever the endpoint returns first
  // (highest pitch count -- see getIntendedZonePitcherLeaderboard's sort).
  const profile = profiles[0] ?? null;
  const location = target ? intendedTargetLocation(target.sideFt, target.heightFt) : null;
  const locationSample = profile && location ? profile.byLocation[String(location)] : undefined;
  const usesPocketModel = Boolean(locationSample && locationSample.pitchCount > 25);
  const sample = profile ? (usesPocketModel ? locationSample! : profile.overall) : null;
  const aim = target && sample ? { sideFt: target.sideFt - sample.avgMissSideFt, heightFt: target.heightFt - sample.avgMissHeightFt } : null;
  const displayAim = aim ? { sideFt: clamp(aim.sideFt, X_MIN + 0.08, X_MAX - 0.08), heightFt: clamp(aim.heightFt, Y_MIN + 0.08, Y_MAX - 0.08) } : null;
  const targetRadiusPx = SCALE * (TARGET_DIAMETER_INCHES / 2 / 12);
  const correctionVector = useMemo(
    () => (target && displayAim ? buildCorrectionVector(px(displayAim.sideFt), py(displayAim.heightFt), px(target.sideFt), py(target.heightFt), targetRadiusPx) : null),
    [target, displayAim, targetRadiusPx]
  );

  function selectTarget(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * ZONE_W;
    const svgY = ((event.clientY - rect.top) / rect.height) * ZONE_H;
    setTarget({ sideFt: clamp(feetX(svgX), X_MIN, X_MAX), heightFt: clamp(feetY(svgY), Y_MIN, Y_MAX) });
  }

  if (loading && !profiles.length) {
    return <p className="portal-muted-text">Loading Intended Target data...</p>;
  }
  if (error) {
    return <p className="portal-error-text">{error}</p>;
  }
  if (!pitcherName) {
    return <p className="portal-muted-text">Select a pitcher to build a target map.</p>;
  }
  if (!profile) {
    return <p className="portal-muted-text">No Intended Target data for this pitcher/date range.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${ZONE_W} ${ZONE_H}`}
        style={{ width: '100%', height: '100%', maxHeight: 'calc(100% - 28px)', cursor: 'crosshair' }}
        onClick={selectTarget}
        role="button"
        tabIndex={0}
        aria-label="Click to set the desired pitch location"
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setTarget({ sideFt: 0, heightFt: STRIKE_CENTER_Y });
          }
        }}
      >
        <polygon points={`${px(-0.75)},${py(0.55)} ${px(0.75)},${py(0.55)} ${px(0.75)},${py(0.65)} ${px(0)},${py(0.75)} ${px(-0.75)},${py(0.65)}`} fill="none" stroke="rgba(226,232,240,.75)" strokeWidth="3" />
        <rect x={px(-1.5)} y={py(STRIKE_CENTER_Y + 1.5)} width={px(1.5) - px(-1.5)} height={py(STRIKE_CENTER_Y - 1.5) - py(STRIKE_CENTER_Y + 1.5)} fill="none" stroke="rgba(148,163,184,.28)" strokeWidth="2" />
        <line x1={px(-1.5)} y1={py(STRIKE_CENTER_Y)} x2={px(1.5)} y2={py(STRIKE_CENTER_Y)} stroke="rgba(148,163,184,.2)" />
        <line x1={px(0)} y1={py(STRIKE_CENTER_Y - 1.5)} x2={px(0)} y2={py(STRIKE_CENTER_Y + 1.5)} stroke="rgba(148,163,184,.2)" />
        <rect x={px(INTENDED_STRIKE_LEFT)} y={py(INTENDED_STRIKE_TOP)} width={px(INTENDED_STRIKE_RIGHT) - px(INTENDED_STRIKE_LEFT)} height={py(INTENDED_STRIKE_BOTTOM) - py(INTENDED_STRIKE_TOP)} fill="rgba(15,23,42,.28)" stroke="#e2e8f0" strokeWidth="3" />
        {[1, 2].map((third) => (
          <line key={`vertical-${third}`} x1={px(INTENDED_STRIKE_LEFT + STRIKE_THIRD_X * third)} y1={py(INTENDED_STRIKE_TOP)} x2={px(INTENDED_STRIKE_LEFT + STRIKE_THIRD_X * third)} y2={py(INTENDED_STRIKE_BOTTOM)} stroke="rgba(148,163,184,.48)" strokeWidth="1" />
        ))}
        {[1, 2].map((third) => (
          <line key={`horizontal-${third}`} x1={px(INTENDED_STRIKE_LEFT)} y1={py(INTENDED_STRIKE_TOP - STRIKE_THIRD_Y * third)} x2={px(INTENDED_STRIKE_RIGHT)} y2={py(INTENDED_STRIKE_TOP - STRIKE_THIRD_Y * third)} stroke="rgba(148,163,184,.48)" strokeWidth="1" />
        ))}
        {POCKETS.map((pocket) => (
          <text key={pocket.number} x={px(pocket.x)} y={py(pocket.y)} fill="rgba(148,163,184,.65)" fontSize="9" textAnchor="middle">{pocket.number}</text>
        ))}
        <text x={px(-1.19)} y={py(3.825)} fill="rgba(148,163,184,.65)" fontSize="9" textAnchor="middle">10</text>
        <text x={px(1.19)} y={py(3.825)} fill="rgba(148,163,184,.65)" fontSize="9" textAnchor="middle">11</text>
        <text x={px(-1.19)} y={py(1.275)} fill="rgba(148,163,184,.65)" fontSize="9" textAnchor="middle">12</text>
        <text x={px(1.19)} y={py(1.275)} fill="rgba(148,163,184,.65)" fontSize="9" textAnchor="middle">13</text>
        {target && displayAim ? (
          <>
            {correctionVector?.dashes.map((dash, index) => (
              <line key={`dash-${index}`} x1={dash.x1} y1={dash.y1} x2={dash.x2} y2={dash.y2} stroke="#f6c76d" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
            ))}
            {correctionVector?.arrowPoints ? <polygon points={correctionVector.arrowPoints} fill="#f6c76d" opacity="0.85" /> : null}
            <circle cx={px(target.sideFt)} cy={py(target.heightFt)} r={targetRadiusPx} fill="rgba(74,222,128,.17)" stroke="#4ade80" strokeWidth="2.3" />
            <circle cx={px(target.sideFt)} cy={py(target.heightFt)} r="3.5" fill="#86efac" />
            <g transform={`translate(${px(displayAim.sideFt)} ${py(displayAim.heightFt)})`}>
              <circle r={targetRadiusPx} fill="rgba(246,199,109,.12)" stroke="#f6c76d" strokeWidth="2.3" />
              <circle r="3.5" fill="#f6c76d" />
              <line x1={-(targetRadiusPx + 7)} y1="0" x2={-(targetRadiusPx - 4)} y2="0" stroke="#f6c76d" strokeWidth="2" strokeLinecap="round" />
              <line x1={targetRadiusPx - 4} y1="0" x2={targetRadiusPx + 7} y2="0" stroke="#f6c76d" strokeWidth="2" strokeLinecap="round" />
              <line x1="0" y1={-(targetRadiusPx + 7)} x2="0" y2={-(targetRadiusPx - 4)} stroke="#f6c76d" strokeWidth="2" strokeLinecap="round" />
              <line x1="0" y1={targetRadiusPx - 4} x2="0" y2={targetRadiusPx + 7} stroke="#f6c76d" strokeWidth="2" strokeLinecap="round" />
            </g>
          </>
        ) : null}
      </svg>
      {!target ? <p style={{ margin: 0, fontSize: '0.78rem', color: '#94a3b8' }}>Click the zone to set a desired result.</p> : null}
      <div style={{ display: 'flex', gap: 14, fontSize: '0.72rem', color: '#94a3b8' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <i style={{ width: 9, height: 9, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
          Desired result
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <i style={{ width: 9, height: 9, borderRadius: 2, background: '#f6c76d', display: 'inline-block', transform: 'rotate(45deg)' }} />
          Recommended aim
        </span>
      </div>
    </div>
  );
}

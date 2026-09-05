'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  INTENDED_STRIKE_BOTTOM,
  INTENDED_STRIKE_CENTER_X,
  INTENDED_STRIKE_CENTER_Y,
  INTENDED_STRIKE_LEFT,
  INTENDED_STRIKE_RIGHT,
  INTENDED_STRIKE_TOP,
  intendedTargetLocation,
} from '../../../lib/intended-target-location';
import { downloadContentPdf } from '../../../lib/leaderboard-pdf-export';
import styles from './intended-zone-panel.module.css';

const VIEW_W = 420;
const VIEW_H = 450;
const X_MIN = -2.35;
const X_MAX = 2.35;
const Y_MIN = 0.3;
const Y_MAX = 4.75;
const PAD = 18;
const SCALE = Math.min((VIEW_W - PAD * 2) / (X_MAX - X_MIN), (VIEW_H - PAD * 2) / (Y_MAX - Y_MIN));
const DRAWN_W = (X_MAX - X_MIN) * SCALE;
const DRAWN_H = (Y_MAX - Y_MIN) * SCALE;
const LEFT_PAD = (VIEW_W - DRAWN_W) / 2;
const TOP_PAD = (VIEW_H - DRAWN_H) / 2;
const px = (x: number) => LEFT_PAD + (x - X_MIN) * SCALE;
const py = (y: number) => TOP_PAD + (Y_MAX - y) * SCALE;
const feetX = (x: number) => X_MIN + (x - LEFT_PAD) / SCALE;
const feetY = (y: number) => Y_MAX - (y - TOP_PAD) / SCALE;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type TargetingSample = {
  pitchCount: number;
  avgMissSideFt: number;
  avgMissHeightFt: number;
  avgMissDistanceFt: number;
};

type TargetingProfile = {
  pitchType: string;
  pitchCount: number;
  throwsLeft: boolean;
  overall: TargetingSample;
  byLocation: Record<string, TargetingSample>;
};

type TargetPoint = { sideFt: number; heightFt: number };

const PITCH_COLORS: Record<string, string> = {
  Fastball: '#ffcc33',
  Sinker: '#f97316',
  Cutter: '#c08457',
  Slider: '#ef4444',
  Sweeper: '#a855f7',
  Curveball: '#3b82f6',
  ChangeUp: '#22c55e',
  Splitter: '#2dd4bf',
  Knuckleball: '#6366f1',
  Undefined: '#94a3b8',
};

const TARGET_SIZE_PRESETS = [4, 8, 12, 16, 20] as const;

function formatAdjustment(sideFt: number, heightFt: number, throwsLeft: boolean): string {
  const armSideInches = (throwsLeft ? -sideFt : sideFt) * 12;
  const verticalInches = heightFt * 12;
  const pieces: string[] = [];
  if (Math.abs(armSideInches) >= 0.5) pieces.push(`${Math.abs(armSideInches).toFixed(1)}″ ${armSideInches > 0 ? 'arm side' : 'glove side'}`);
  if (Math.abs(verticalInches) >= 0.5) pieces.push(`${Math.abs(verticalInches).toFixed(1)}″ ${verticalInches > 0 ? 'higher' : 'lower'}`);
  return pieces.length ? pieces.join(' · ') : 'Hold the selected target';
}

function formatHistoricalMiss(sample: TargetingSample, throwsLeft: boolean): string {
  return formatAdjustment(sample.avgMissSideFt, sample.avgMissHeightFt, throwsLeft)
    .replace('higher', 'up')
    .replace('lower', 'down');
}

function pocketCenters(): { location: number; x: number; y: number }[] {
  const width = (INTENDED_STRIKE_RIGHT - INTENDED_STRIKE_LEFT) / 3;
  const height = (INTENDED_STRIKE_TOP - INTENDED_STRIKE_BOTTOM) / 3;
  return Array.from({ length: 9 }, (_, index) => ({
    location: index + 1,
    x: INTENDED_STRIKE_LEFT + ((index % 3) + 0.5) * width,
    y: INTENDED_STRIKE_TOP - (Math.floor(index / 3) + 0.5) * height,
  }));
}

const POCKET_CENTERS = pocketCenters();

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
    dashes.push({
      x1: x1 + ux * distance,
      y1: y1 + uy * distance,
      x2: x1 + ux * dashEnd,
      y2: y1 + uy * dashEnd,
    });
  }
  return { dashes, arrowPoints };
}

function TargetingMap({
  pitcherName,
  startDate,
  endDate,
  selectedPitchTypes,
  selectedBallTypes,
  mapId,
  mapNumber,
  canRemove,
  onRemove,
  showRecommendations,
}: {
  pitcherName: string | null;
  startDate: string;
  endDate: string;
  selectedPitchTypes: string[];
  selectedBallTypes: string[];
  mapId: number;
  mapNumber: number;
  canRemove: boolean;
  onRemove: () => void;
  showRecommendations: boolean;
}) {
  const [profiles, setProfiles] = useState<TargetingProfile[]>([]);
  const [pitchType, setPitchType] = useState('');
  const [target, setTarget] = useState<TargetPoint | null>(null);
  const [targetDiameterInches, setTargetDiameterInches] = useState<(typeof TARGET_SIZE_PRESETS)[number]>(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    if (!pitcherName) {
      setProfiles([]);
      setPitchType('');
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
      const nextProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
      setProfiles(nextProfiles);
      setPitchType((current) => nextProfiles.some((profile: TargetingProfile) => profile.pitchType === current)
        ? current
        : nextProfiles[(mapNumber - 1) % Math.max(nextProfiles.length, 1)]?.pitchType ?? '');
    } catch (loadError) {
      setProfiles([]);
      setPitchType('');
      setError(loadError instanceof Error ? loadError.message : 'Unable to build targeting profile.');
    } finally {
      setLoading(false);
    }
  }, [endDate, mapNumber, pitcherName, selectedBallTypes, selectedPitchTypes, startDate]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    setTarget(null);
  }, [pitchType, pitcherName]);

  const profile = useMemo(() => profiles.find((item) => item.pitchType === pitchType) ?? null, [pitchType, profiles]);
  const location = target ? intendedTargetLocation(target.sideFt, target.heightFt) : null;
  const locationSample = profile && location ? profile.byLocation[String(location)] : undefined;
  const usesPocketModel = Boolean(locationSample && locationSample.pitchCount > 25);
  const sample = profile ? (usesPocketModel ? locationSample! : profile.overall) : null;
  const aim = target && sample ? {
    sideFt: target.sideFt - sample.avgMissSideFt,
    heightFt: target.heightFt - sample.avgMissHeightFt,
  } : null;
  const displayAim = aim ? {
    sideFt: clamp(aim.sideFt, X_MIN + 0.08, X_MAX - 0.08),
    heightFt: clamp(aim.heightFt, Y_MIN + 0.08, Y_MAX - 0.08),
  } : null;
  const aimIsClipped = Boolean(aim && displayAim && (aim.sideFt !== displayAim.sideFt || aim.heightFt !== displayAim.heightFt));
  const pitchColor = PITCH_COLORS[pitchType] ?? PITCH_COLORS.Undefined;
  const targetRadiusPx = SCALE * (targetDiameterInches / 2 / 12);
  const correctionVector = target && displayAim
    ? buildCorrectionVector(px(displayAim.sideFt), py(displayAim.heightFt), px(target.sideFt), py(target.heightFt), targetRadiusPx)
    : null;

  const selectTarget = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    const svgY = ((event.clientY - rect.top) / rect.height) * VIEW_H;
    setTarget({
      sideFt: clamp(feetX(svgX), X_MIN, X_MAX),
      heightFt: clamp(feetY(svgY), Y_MIN, Y_MAX),
    });
  };

  return (
    <article className={styles.targetingMapCard}>
      <header className={styles.targetingMapHeader}>
        <span className={styles.targetingMapNumber}>Map {String(mapNumber).padStart(2, '0')}{pitchType ? ` · ${pitchType}` : ''}</span>
        <div className={styles.targetingControls}>
          <label htmlFor={`targeting-pitch-type-${mapId}`}>Pitch</label>
          <select id={`targeting-pitch-type-${mapId}`} value={pitchType} onChange={(event) => setPitchType(event.target.value)} disabled={loading || !profiles.length}>
            {profiles.length ? profiles.map((item) => (
              <option key={item.pitchType} value={item.pitchType}>{item.pitchType} · {item.pitchCount}</option>
            )) : <option value="">No pitch data</option>}
          </select>
          {pitchType ? <span className={styles.targetingPitchDot} style={{ background: pitchColor }} /> : null}
        </div>
        {canRemove ? <button type="button" className={styles.targetingRemoveMap} onClick={onRemove} aria-label={`Remove target map ${mapNumber}`} data-pdf-hide="true">×</button> : null}
      </header>

      {error ? (
        <div className={styles.targetingError}>{error} <button type="button" onClick={() => void loadProfiles()}>Try again</button></div>
      ) : null}

      <div className={`${styles.targetingGrid} ${!showRecommendations ? styles.targetingGridZonesOnly : ''}`}>
        <div className={styles.targetingZonePanel}>
          <div className={styles.targetingZoneTopline}>
            <span>Target map</span>
            <button type="button" onClick={() => setTarget(null)} disabled={!target} data-pdf-hide="true">Reset target</button>
          </div>
          <div className={styles.targetingSizeRow}>
            <span>Target size</span>
            <div className={styles.targetingSizeOptions}>
              {TARGET_SIZE_PRESETS.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={targetDiameterInches === size ? styles.targetingSizeActive : undefined}
                  onClick={() => setTargetDiameterInches(size)}
                >
                  {size}″
                </button>
              ))}
            </div>
          </div>
          <div className={styles.targetingZoneFrame}>
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className={styles.targetingZoneSvg}
              onClick={selectTarget}
              role="button"
              tabIndex={0}
              aria-label="Select the desired pitch location"
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setTarget({ sideFt: INTENDED_STRIKE_CENTER_X, heightFt: INTENDED_STRIKE_CENTER_Y });
                }
              }}
            >
              <defs>
                <radialGradient id={`targetGlow-${mapId}`}>
                  <stop offset="0%" stopColor="#86efac" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                </radialGradient>
                <filter id={`aimGlow-${mapId}`} x="-100%" y="-100%" width="300%" height="300%">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <rect x="0" y="0" width={VIEW_W} height={VIEW_H} rx="18" fill="transparent" />
              <polygon
                points={`${px(-0.78)},${py(0.53)} ${px(0.78)},${py(0.53)} ${px(0.78)},${py(0.64)} ${px(0)},${py(0.78)} ${px(-0.78)},${py(0.64)}`}
                fill="rgba(226,232,240,.02)" stroke="rgba(226,232,240,.72)" strokeWidth="3"
              />
              <rect x={px(-1.5)} y={py(INTENDED_STRIKE_CENTER_Y + 1.5)} width={px(1.5) - px(-1.5)} height={py(INTENDED_STRIKE_CENTER_Y - 1.5) - py(INTENDED_STRIKE_CENTER_Y + 1.5)} fill="none" stroke="rgba(148,163,184,.25)" strokeWidth="2" />
              <line x1={px(-1.5)} y1={py(INTENDED_STRIKE_CENTER_Y)} x2={px(1.5)} y2={py(INTENDED_STRIKE_CENTER_Y)} stroke="rgba(148,163,184,.16)" />
              <line x1={px(0)} y1={py(INTENDED_STRIKE_CENTER_Y - 1.5)} x2={px(0)} y2={py(INTENDED_STRIKE_CENTER_Y + 1.5)} stroke="rgba(148,163,184,.16)" />
              <rect x={px(INTENDED_STRIKE_LEFT)} y={py(INTENDED_STRIKE_TOP)} width={px(INTENDED_STRIKE_RIGHT) - px(INTENDED_STRIKE_LEFT)} height={py(INTENDED_STRIKE_BOTTOM) - py(INTENDED_STRIKE_TOP)} fill="rgba(15,23,42,.35)" stroke="#e2e8f0" strokeWidth="3" />
              {[1, 2].map((division) => (
                <line key={`v-${division}`} x1={px(INTENDED_STRIKE_LEFT + ((INTENDED_STRIKE_RIGHT - INTENDED_STRIKE_LEFT) * division) / 3)} y1={py(INTENDED_STRIKE_BOTTOM)} x2={px(INTENDED_STRIKE_LEFT + ((INTENDED_STRIKE_RIGHT - INTENDED_STRIKE_LEFT) * division) / 3)} y2={py(INTENDED_STRIKE_TOP)} stroke="rgba(226,232,240,.35)" />
              ))}
              {[1, 2].map((division) => (
                <line key={`h-${division}`} x1={px(INTENDED_STRIKE_LEFT)} y1={py(INTENDED_STRIKE_BOTTOM + ((INTENDED_STRIKE_TOP - INTENDED_STRIKE_BOTTOM) * division) / 3)} x2={px(INTENDED_STRIKE_RIGHT)} y2={py(INTENDED_STRIKE_BOTTOM + ((INTENDED_STRIKE_TOP - INTENDED_STRIKE_BOTTOM) * division) / 3)} stroke="rgba(226,232,240,.35)" />
              ))}
              {POCKET_CENTERS.map((pocket) => (
                <text key={pocket.location} x={px(pocket.x)} y={py(pocket.y) + 5} textAnchor="middle" className={styles.targetingPocketNumber}>{pocket.location}</text>
              ))}
              <text x={px(-1.19)} y={py(3.825) + 4} textAnchor="middle" className={styles.targetingOuterNumber}>10</text>
              <text x={px(1.19)} y={py(3.825) + 4} textAnchor="middle" className={styles.targetingOuterNumber}>11</text>
              <text x={px(-1.19)} y={py(1.275) + 4} textAnchor="middle" className={styles.targetingOuterNumber}>12</text>
              <text x={px(1.19)} y={py(1.275) + 4} textAnchor="middle" className={styles.targetingOuterNumber}>13</text>

              {target && displayAim ? (
                <>
                  {correctionVector?.dashes.map((dash, index) => (
                    <line
                      key={`correction-dash-${index}`}
                      x1={dash.x1}
                      y1={dash.y1}
                      x2={dash.x2}
                      y2={dash.y2}
                      stroke="#f6c76d"
                      strokeWidth="2"
                      strokeLinecap="round"
                      opacity="0.85"
                    />
                  ))}
                  {correctionVector?.arrowPoints ? <polygon points={correctionVector.arrowPoints} fill="#f6c76d" opacity="0.85" /> : null}
                  <circle cx={px(target.sideFt)} cy={py(target.heightFt)} r={targetRadiusPx + 10} fill={`url(#targetGlow-${mapId})`} />
                  <circle
                    cx={px(target.sideFt)}
                    cy={py(target.heightFt)}
                    r={targetRadiusPx}
                    className={styles.targetingDesiredCircle}
                    fill="rgba(34,197,94,.16)"
                    stroke="#4ade80"
                    strokeWidth="2.5"
                  />
                  <circle
                    cx={px(target.sideFt)}
                    cy={py(target.heightFt)}
                    r={targetRadiusPx}
                    fill="none"
                    stroke="#4ade80"
                    strokeWidth="3"
                  />
                  <circle cx={px(target.sideFt)} cy={py(target.heightFt)} r="3.5" fill="#bbf7d0" />
                  <g
                    transform={`translate(${px(displayAim.sideFt)} ${py(displayAim.heightFt)})`}
                    className={styles.targetingAimMarker}
                    filter={`url(#aimGlow-${mapId})`}
                    fill="rgba(246,199,109,.12)"
                    stroke="#f6c76d"
                    strokeWidth="2"
                  >
                    <circle r={targetRadiusPx} fill="rgba(246,199,109,.12)" stroke="#f6c76d" strokeWidth="3" />
                    <circle r="4" fill="#f6c76d" stroke="#fff3cf" strokeWidth="2" />
                    <line x1={-(targetRadiusPx + 9)} y1="0" x2={-(targetRadiusPx - 5)} y2="0" stroke="#f6c76d" strokeWidth="2" strokeLinecap="round" />
                    <line x1={targetRadiusPx - 5} y1="0" x2={targetRadiusPx + 9} y2="0" stroke="#f6c76d" strokeWidth="2" strokeLinecap="round" />
                    <line x1="0" y1={-(targetRadiusPx + 9)} x2="0" y2={-(targetRadiusPx - 5)} stroke="#f6c76d" strokeWidth="2" strokeLinecap="round" />
                    <line x1="0" y1={targetRadiusPx - 5} x2="0" y2={targetRadiusPx + 9} stroke="#f6c76d" strokeWidth="2" strokeLinecap="round" />
                  </g>
                </>
              ) : null}
            </svg>
            {!target ? <div className={styles.targetingClickPrompt} data-pdf-hide="true"><span>＋</span> Click where you want the pitch to finish</div> : null}
            <div className={styles.targetingLegend}>
              <span><i className={styles.targetLegendDesired} /> Desired result</span>
              <span><i className={styles.targetLegendAim} /> Recommended aim</span>
            </div>
          </div>
        </div>

        {showRecommendations ? <aside className={styles.targetingReadout}>
          {loading ? (
            <div className={styles.targetingLoading}><span className={styles.spinner} /> Building command model…</div>
          ) : !profile ? (
            <div className={styles.targetingNoData}><strong>No matched target data</strong><span>This pitcher needs intended-target pitches with TrackMan locations in the selected filters.</span></div>
          ) : !target || !sample || !aim ? (
            <div className={styles.targetingStandby}>
              <span className={styles.targetingRadar}><i /><i /><i /></span>
              <strong>Awaiting destination</strong>
              <p>Select any point on the target map to calculate the visual hold.</p>
              <small>{profile.pitchCount} {pitchType} pitches available</small>
            </div>
          ) : (
            <>
              <div className={styles.targetingRecommendation}>
                <div className={styles.targetingRecommendationTopline}>
                  <span>Recommended visual hold</span>
                  <b className={usesPocketModel ? styles.targetingHighConfidence : styles.targetingBaseline}>
                    {usesPocketModel ? 'Location model' : 'Pitch model'}
                  </b>
                </div>
                <strong>{formatAdjustment(aim.sideFt - target.sideFt, aim.heightFt - target.heightFt, profile.throwsLeft)}</strong>
                <p>Aim at the gold reticle to finish inside the green target.</p>
                {aimIsClipped ? <small>The calculated aim extends beyond the visible map; the reticle is pinned to its edge.</small> : null}
              </div>

              <div className={styles.targetingMetricGrid}>
                <div><span>Destination</span><strong>Pocket {location}</strong></div>
                <div><span>Model sample</span><strong>{sample.pitchCount}</strong></div>
                <div><span>Avg. miss</span><strong>{(sample.avgMissDistanceFt * 12).toFixed(1)}″</strong></div>
                <div><span>Pitch sample</span><strong>{profile.pitchCount}</strong></div>
              </div>

              <div className={styles.targetingModelNote}>
                <span className={styles.targetingModelIcon}>{usesPocketModel ? '◎' : '◇'}</span>
                <div>
                  <strong>{usesPocketModel ? `Pocket ${location} behavior` : 'All-location fallback'}</strong>
                  <p>{usesPocketModel
                    ? `${sample.pitchCount} pitches to this pocket provide a location-specific correction.`
                    : `Pocket ${location} has ${locationSample?.pitchCount ?? 0} of 26 required pitches, so the recommendation uses all ${pitchType} targets.`}</p>
                </div>
              </div>

              <div className={styles.targetingHistoryLine}>
                <span>Typical miss</span>
                <strong>{formatHistoricalMiss(sample, profile.throwsLeft)}</strong>
              </div>
            </>
          )}
        </aside> : null}
      </div>
    </article>
  );
}

export default function IntendedZoneTargeting(props: {
  pitcherName: string | null;
  startDate: string;
  endDate: string;
  selectedPitchTypes: string[];
  selectedBallTypes: string[];
}) {
  const [mapIds, setMapIds] = useState([1]);
  const nextMapId = useRef(2);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!props.pitcherName) {
    return (
      <div className={styles.targetingEmpty}>
        <span className={styles.targetingEmptyIcon}>＋</span>
        <h3>Select one pitcher</h3>
        <p>Choose a pitcher in the sidebar to build an individualized aiming map.</p>
      </div>
    );
  }

  const addMap = () => {
    const id = nextMapId.current;
    nextMapId.current += 1;
    setMapIds((current) => [...current, id]);
  };

  const exportPdf = async () => {
    if (!exportRef.current || !props.pitcherName) return;
    setIsExporting(true);
    setExportError(null);
    let exportNode: HTMLDivElement | null = null;
    try {
      const safeName = props.pitcherName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const dateRange = props.startDate && props.endDate
        ? `${new Date(`${props.startDate}T00:00:00`).toLocaleDateString()} – ${new Date(`${props.endDate}T00:00:00`).toLocaleDateString()}`
        : '';

      // Native <select> controls are painted inconsistently by html2canvas
      // (Safari commonly clips the selected option's lower half). Export an
      // off-screen clone with each select replaced by an ordinary styled div,
      // using the live control's actual selected text.
      exportNode = exportRef.current.cloneNode(true) as HTMLDivElement;
      const liveSelects = Array.from(exportRef.current.querySelectorAll('select'));
      const clonedSelects = Array.from(exportNode.querySelectorAll('select'));
      clonedSelects.forEach((select, index) => {
        const liveSelect = liveSelects[index];
        const selectedText = liveSelect?.options[liveSelect.selectedIndex]?.textContent?.trim() || liveSelect?.value || 'Pitch';
        const replacement = document.createElement('div');
        replacement.className = styles.targetingPdfPitchValue;
        replacement.textContent = selectedText;
        select.replaceWith(replacement);
      });
      // The clone temporarily lives in the same document as the live maps.
      // Give every SVG definition a clone-only ID so marker/filter URLs
      // resolve inside the exported map rather than colliding with the live
      // SVG that happens to share its original ID.
      const exportIdSuffix = `-pdf-${Date.now()}`;
      const remappedIds = new Map<string, string>();
      exportNode.querySelectorAll<SVGElement>('[id]').forEach((element) => {
        const originalId = element.id;
        const exportId = `${originalId}${exportIdSuffix}`;
        remappedIds.set(originalId, exportId);
        element.id = exportId;
      });
      exportNode.querySelectorAll<SVGElement>('svg *').forEach((element) => {
        for (const attribute of ['fill', 'filter', 'marker-end', 'clip-path', 'mask']) {
          const value = element.getAttribute(attribute);
          if (!value?.includes('url(#')) continue;
          element.setAttribute(attribute, value.replace(/url\(#([^)]+)\)/g, (match, id: string) => {
            const remapped = remappedIds.get(id);
            return remapped ? `url(#${remapped})` : match;
          }));
        }
      });
      exportNode.classList.add(styles.targetingPdfCapture);
      exportNode.style.width = '1200px';
      exportNode.style.maxWidth = '1200px';
      document.body.appendChild(exportNode);

      await downloadContentPdf({
        node: exportNode,
        titleText: 'Pitch Targeting Plan',
        nameText: props.pitcherName,
        subtitleText: [dateRange, showRecommendations ? 'Target maps with recommended visual holds' : 'Strike-zone target maps'].filter(Boolean).join('  ·  '),
        fileName: `targeting-plan-${safeName}.pdf`,
        // A fitted custom-height page keeps an entire grid together. Fixed
        // Letter pagination can cut horizontally through a target map when a
        // second map row lands near the bottom of page one.
        singlePage: true,
        forceWidth: 1200,
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Unable to export the targeting plan.');
    } finally {
      exportNode?.remove();
      setIsExporting(false);
    }
  };

  return (
    <section className={styles.targetingShell}>
      <header className={styles.targetingHeader}>
        <div>
          <p className={styles.eyebrow}>Command Intelligence</p>
          <h3 className={styles.targetingTitle}>{props.pitcherName}</h3>
          <p className={styles.targetingSubtitle}>Build side-by-side visual plans for each pitch. Every map independently compensates for that pitch&apos;s typical miss.</p>
        </div>
        <div className={styles.targetingHeaderActions} data-pdf-hide="true">
          <button type="button" className={styles.targetingUtilityButton} onClick={() => setShowRecommendations((current) => !current)}>
            <span>{showRecommendations ? '◫' : '▣'}</span> {showRecommendations ? 'Hide recommendations' : 'Show recommendations'}
          </button>
          <button type="button" className={styles.targetingUtilityButton} onClick={() => void exportPdf()} disabled={isExporting}>
            <span>⇩</span> {isExporting ? 'Exporting…' : 'Export PDF'}
          </button>
          <button type="button" className={styles.targetingAddMap} onClick={addMap}>
            <span>＋</span> Add target map
          </button>
        </div>
      </header>
      {exportError ? <div className={styles.targetingError}>{exportError}</div> : null}
      <div
        ref={exportRef}
        className={`${styles.targetingMapsGrid} ${mapIds.length > 1 ? styles.targetingMapsGridMulti : ''} ${!showRecommendations ? styles.targetingMapsZonesOnly : ''}`}
      >
        {mapIds.map((mapId, index) => (
          <TargetingMap
            key={mapId}
            {...props}
            mapId={mapId}
            mapNumber={index + 1}
            canRemove={mapIds.length > 1}
            onRemove={() => setMapIds((current) => current.filter((id) => id !== mapId))}
            showRecommendations={showRecommendations}
          />
        ))}
      </div>
    </section>
  );
}

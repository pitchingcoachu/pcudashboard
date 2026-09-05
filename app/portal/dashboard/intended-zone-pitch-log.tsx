'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './intended-zone-panel.module.css';

const PAGE_SIZE = 18;
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

const PITCH_COLORS: Record<string, string> = {
  Fastball: '#ffcc33', Sinker: '#f97316', Cutter: '#c08457', Slider: '#ef4444', Sweeper: '#a855f7',
  Curveball: '#3b82f6', ChangeUp: '#22c55e', Splitter: '#2dd4bf', Knuckleball: '#6366f1', Undefined: '#94a3b8',
};

const DIRECTION_LABELS: Record<string, string> = {
  'up-arm': 'Up, Arm Side', 'up-middle': 'Up, Middle', 'up-glove': 'Up, Glove Side',
  'middle-arm': 'Middle, Arm Side', 'on-target': 'On Target', 'middle-glove': 'Middle, Glove Side',
  'down-arm': 'Down, Arm Side', 'down-middle': 'Down, Middle', 'down-glove': 'Down, Glove Side',
};

const PITCH_LOG_ENDPOINT = '/api/dashboard/pitching/intended-zone/pitch-log';

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

async function fetchPitchLog(query: string): Promise<PitchLogRow[]> {
  const response = await fetch(query ? `${PITCH_LOG_ENDPOINT}?${query}` : PITCH_LOG_ENDPOINT, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  const responseText = await response.text();
  let payload: { pitches?: unknown; error?: string } = {};
  if (responseText) {
    try {
      payload = JSON.parse(responseText) as typeof payload;
    } catch {
      throw new Error(response.ok
        ? 'The pitch log returned an invalid response.'
        : 'Unable to load intended target pitch history.');
    }
  }
  if (!response.ok) throw new Error(payload.error ?? 'Unable to load intended target pitch history.');
  return Array.isArray(payload.pitches) ? payload.pitches as PitchLogRow[] : [];
}

type PitchLogRow = {
  id: number;
  sessionId: number;
  pitchIndex: number;
  intendedSideFt: number;
  intendedHeightFt: number;
  targetRadiusFt: number;
  plateLocSide: number;
  plateLocHeight: number;
  missDistanceFt: number | null;
  missDirection: string | null;
  pitchType: string | null;
  relSpeed: number | null;
  inducedVertBreak: number | null;
  horzBreak: number | null;
  thrownAt: string | null;
  pitcherName: string;
  ballType: string;
  sessionMode: 'live' | 'ftp_deferred' | 'manual';
  sessionStartedAt: string;
  targetLocation: number;
  targetHit: boolean;
};

function metric(value: number | null, decimals = 1, suffix = ''): string {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(decimals)}${suffix}`;
}

function pitchTypeLabel(value: string | null): string {
  return !value || value === 'Undefined' ? 'Untagged' : value;
}

function sessionModeLabel(mode: PitchLogRow['sessionMode']): string {
  if (mode === 'ftp_deferred') return 'FTP Sync';
  if (mode === 'manual') return 'Manual';
  return 'Live';
}

function pitchDate(pitch: PitchLogRow): Date {
  return new Date(pitch.thrownAt || pitch.sessionStartedAt);
}

function PitchLocationGraphic({ pitch }: { pitch: PitchLogRow }) {
  const color = PITCH_COLORS[pitch.pitchType ?? 'Undefined'] ?? PITCH_COLORS.Undefined;
  const targetX = px(pitch.intendedSideFt);
  const targetY = py(pitch.intendedHeightFt);
  const actualX = px(pitch.plateLocSide);
  const actualY = py(pitch.plateLocHeight);
  return (
    <div className={styles.historyPitchVisual}>
      <svg viewBox={`0 0 ${ZONE_W} ${ZONE_H}`} aria-label={`Pitch ${pitch.pitchIndex}: intended target and actual location`}>
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
        <line x1={targetX} y1={targetY} x2={actualX} y2={actualY} stroke="rgba(226,232,240,.55)" strokeWidth="1.5" strokeDasharray="5 4" />
        <circle cx={targetX} cy={targetY} r={Math.max(5, pitch.targetRadiusFt * SCALE)} fill="rgba(74,222,128,.17)" stroke="#4ade80" strokeWidth="2.3" strokeDasharray="5 4" />
        <circle cx={targetX} cy={targetY} r="3" fill="#86efac" />
        <circle cx={actualX} cy={actualY} r="8" fill={color} stroke="#f8fafc" strokeWidth="2" />
      </svg>
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

export default function IntendedZonePitchLog({
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
  const [pitches, setPitches] = useState<PitchLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadPitches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (pitcherName) params.set('pitcherName', pitcherName);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (selectedPitchTypes.length) params.set('pitchTypes', selectedPitchTypes.join(','));
      if (selectedBallTypes.length) params.set('ballTypes', selectedBallTypes.join(','));
      const query = params.toString();
      let loadedPitches: PitchLogRow[];
      try {
        loadedPitches = await fetchPitchLog(query);
      } catch {
        // Safari can occasionally reject the first request while the local
        // Next dev route is compiling. Retry once so this is transparent.
        await waitForRetry(250);
        loadedPitches = await fetchPitchLog(query);
      }
      setPitches(loadedPitches);
      setPage(1);
    } catch (loadError) {
      setPitches([]);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load intended target pitch history.');
    } finally {
      setLoading(false);
    }
  }, [endDate, pitcherName, selectedBallTypes, selectedPitchTypes, startDate]);

  useEffect(() => {
    void loadPitches();
  }, [loadPitches]);

  const pageCount = Math.max(1, Math.ceil(pitches.length / PAGE_SIZE));
  const visiblePitches = pitches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const summary = useMemo(() => {
    const misses = pitches.map((pitch) => pitch.missDistanceFt).filter((value): value is number => value !== null && Number.isFinite(value));
    return {
      hitPct: pitches.length ? (pitches.filter((pitch) => pitch.targetHit).length / pitches.length) * 100 : null,
      avgMissInches: misses.length ? (misses.reduce((sum, value) => sum + value, 0) / misses.length) * 12 : null,
    };
  }, [pitches]);

  const exportPdf = useCallback(async () => {
    if (!pitches.length) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const { jsPDF, GState } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const headerHeight = 20;
      const gap = 3;
      const cardWidth = (pageWidth - margin * 2 - gap * 3) / 4;
      const cardHeight = (pageHeight - margin * 2 - headerHeight - gap) / 2;
      const dateRange = startDate && endDate
        ? `${new Date(`${startDate}T00:00:00`).toLocaleDateString()} – ${new Date(`${endDate}T00:00:00`).toLocaleDateString()}`
        : 'All selected dates';
      const filterLine = [dateRange, selectedPitchTypes.length ? selectedPitchTypes.join(', ') : 'All pitch types', selectedBallTypes.length ? selectedBallTypes.join(', ') : 'All ball types'].join('  ·  ');
      // The API returns newest first for the on-screen log. Reports read as
      // a progression: pitch 1 is the oldest selected pitch and the newest
      // pitch is last.
      const exportPitches = [...pitches].reverse();
      const totalPages = Math.ceil(exportPitches.length / 8);

      const drawCard = (pitch: PitchLogRow, exportPitchNumber: number, x: number, y: number) => {
        const colorHex = PITCH_COLORS[pitch.pitchType ?? 'Undefined'] ?? PITCH_COLORS.Undefined;
        const color = colorHex.match(/[a-f\d]{2}/gi)?.map((part) => Number.parseInt(part, 16)) ?? [148, 163, 184];
        const date = pitchDate(pitch);
        pdf.setFillColor(8, 12, 18);
        pdf.setDrawColor(43, 53, 68);
        pdf.roundedRect(x, y, cardWidth, cardHeight, 3, 3, 'FD');
        pdf.setFillColor(color[0], color[1], color[2]);
        pdf.circle(x + 5, y + 6.5, 1.2, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.5);
        pdf.setTextColor(241, 245, 249);
        pdf.text(pitchTypeLabel(pitch.pitchType), x + 8.5, y + 7.7);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(5.5);
        pdf.setTextColor(120, 134, 153);
        pdf.text(`PITCH ${exportPitchNumber} OF ${exportPitches.length}`, x + cardWidth - 4, y + 7.5, { align: 'right' });
        pdf.setFontSize(4.8);
        pdf.text(Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(), x + 8.5, y + 10.4);
        pdf.setDrawColor(35, 44, 57);
        pdf.line(x + 4, y + 12.5, x + cardWidth - 4, y + 12.5);

        const zoneX = x + 5;
        const zoneY = y + 15;
        const zoneW = cardWidth - 10;
        const zoneH = 39;
        const mapX = (value: number) => zoneX + ((value - X_MIN) / (X_MAX - X_MIN)) * zoneW;
        const mapY = (value: number) => zoneY + ((Y_MAX - value) / (Y_MAX - Y_MIN)) * zoneH;
        const strikeX = mapX(STRIKE_LEFT);
        const strikeY = mapY(STRIKE_TOP);
        const strikeW = mapX(STRIKE_RIGHT) - strikeX;
        const strikeH = mapY(STRIKE_BOTTOM) - strikeY;
        pdf.setDrawColor(75, 88, 106);
        pdf.setLineWidth(0.45);
        pdf.rect(mapX(-1.5), mapY(STRIKE_CENTER_Y + 1.5), mapX(1.5) - mapX(-1.5), mapY(STRIKE_CENTER_Y - 1.5) - mapY(STRIKE_CENTER_Y + 1.5));
        pdf.setLineWidth(0.25);
        pdf.line(mapX(0), mapY(STRIKE_CENTER_Y + 1.5), mapX(0), mapY(STRIKE_CENTER_Y - 1.5));
        pdf.line(mapX(-1.5), mapY(STRIKE_CENTER_Y), mapX(1.5), mapY(STRIKE_CENTER_Y));
        // Paint the strike-zone interior over the outer quadrant guides so
        // those guides stop cleanly at the zone border, matching the live SVG.
        pdf.setFillColor(12, 18, 28);
        pdf.setDrawColor(226, 232, 240);
        pdf.setLineWidth(0.65);
        pdf.rect(strikeX, strikeY, strikeW, strikeH, 'FD');
        pdf.setLineWidth(0.25);
        pdf.setDrawColor(105, 118, 137);
        for (const third of [1, 2]) {
          pdf.line(strikeX + strikeW * third / 3, strikeY, strikeX + strikeW * third / 3, strikeY + strikeH);
          pdf.line(strikeX, strikeY + strikeH * third / 3, strikeX + strikeW, strikeY + strikeH * third / 3);
        }
        const plateLeft = mapX(-0.75);
        const plateRight = mapX(0.75);
        const plateTop = mapY(0.66);
        const plateBottom = mapY(0.56);
        const platePoint = mapY(0.76);
        pdf.setDrawColor(184, 194, 208);
        pdf.setLineWidth(0.55);
        pdf.line(plateLeft, plateBottom, plateRight, plateBottom);
        pdf.line(plateLeft, plateBottom, plateLeft, plateTop);
        pdf.line(plateRight, plateBottom, plateRight, plateTop);
        pdf.line(plateLeft, plateTop, mapX(0), platePoint);
        pdf.line(plateRight, plateTop, mapX(0), platePoint);
        const targetX = mapX(pitch.intendedSideFt);
        const targetY = mapY(pitch.intendedHeightFt);
        const actualX = mapX(pitch.plateLocSide);
        const actualY = mapY(pitch.plateLocHeight);
        const targetRadius = Math.max(1.8, pitch.targetRadiusFt * zoneW / (X_MAX - X_MIN));
        pdf.setFillColor(74, 222, 128);
        pdf.setGState(new GState({ opacity: 0.18 }));
        pdf.circle(targetX, targetY, targetRadius, 'F');
        pdf.setGState(new GState({ opacity: 1 }));
        pdf.setDrawColor(74, 222, 128);
        pdf.setLineWidth(0.75);
        pdf.setLineDashPattern([1.4, 1], 0);
        pdf.circle(targetX, targetY, targetRadius, 'S');
        pdf.setLineDashPattern([], 0);
        pdf.setLineDashPattern([1.5, 1.2], 0);
        pdf.setDrawColor(174, 186, 202);
        pdf.line(targetX, targetY, actualX, actualY);
        pdf.setLineDashPattern([], 0);
        pdf.setFillColor(134, 239, 172);
        pdf.circle(targetX, targetY, 0.65, 'F');
        pdf.setFillColor(color[0], color[1], color[2]);
        pdf.setDrawColor(248, 250, 252);
        pdf.circle(actualX, actualY, 1.65, 'FD');

        const detailX = x + 5;
        const valueX = x + cardWidth - 5;
        const rows = [
          ['Velocity', metric(pitch.relSpeed, 1, ' mph')],
          ['IVB / HB', `${metric(pitch.inducedVertBreak, 1, ' in')}  /  ${metric(pitch.horzBreak, 1, ' in')}`],
          ['Miss distance', metric(pitch.missDistanceFt === null ? null : pitch.missDistanceFt * 12, 1, ' in')],
          ['Target', `Pocket ${pitch.targetLocation}  ·  ${Math.round(pitch.targetRadiusFt * 24)} in`],
          ['Direction', pitch.missDirection ? DIRECTION_LABELS[pitch.missDirection] ?? pitch.missDirection : '—'],
          ['Ball', pitch.ballType],
        ];
        rows.forEach(([label, value], index) => {
          const rowY = y + 58 + index * 4.4;
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(5.2);
          pdf.setTextColor(100, 116, 139);
          pdf.text(label, detailX, rowY);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(226, 232, 240);
          pdf.text(value, valueX, rowY, { align: 'right', maxWidth: cardWidth - 24 });
        });
        pdf.setFontSize(5.5);
        pdf.setTextColor(pitch.targetHit ? 74 : 248, pitch.targetHit ? 222 : 113, pitch.targetHit ? 128 : 113);
        pdf.text(pitch.targetHit ? 'TARGET HIT' : 'MISS', valueX, y + cardHeight - 3.5, { align: 'right' });
      };

      for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
        if (pageIndex > 0) pdf.addPage('letter', 'landscape');
        pdf.setFillColor(4, 7, 11);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(15);
        pdf.setTextColor(248, 250, 252);
        pdf.text('Intended Target Pitch Log', margin, margin + 5);
        pdf.setFontSize(9);
        pdf.setTextColor(246, 199, 109);
        pdf.text(pitcherName || 'All Pitchers', margin, margin + 11);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6.8);
        pdf.setTextColor(120, 134, 153);
        pdf.text(filterLine, margin, margin + 16, { maxWidth: pageWidth - 42 });
        pdf.text(`Page ${pageIndex + 1} of ${totalPages}`, pageWidth - margin, margin + 5, { align: 'right' });
        exportPitches.slice(pageIndex * 8, pageIndex * 8 + 8).forEach((pitch, index) => {
          const column = index % 4;
          const row = Math.floor(index / 4);
          drawCard(pitch, pageIndex * 8 + index + 1, margin + column * (cardWidth + gap), margin + headerHeight + row * (cardHeight + gap));
        });
      }
      const safeName = (pitcherName || 'all-pitchers').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      pdf.save(`intended-target-pitch-log-${safeName}.pdf`);
    } catch (exportFailure) {
      setExportError(exportFailure instanceof Error ? exportFailure.message : 'Unable to export the pitch log.');
    } finally {
      setIsExporting(false);
    }
  }, [endDate, pitcherName, pitches, selectedBallTypes, selectedPitchTypes, startDate]);

  return (
    <section className={styles.historyLogShell}>
      <header className={styles.historyLogHeader}>
        <div>
          <p className={styles.eyebrow}>Pitch-by-pitch review</p>
          <h3>Intended Target Pitch Log{pitcherName ? <span> / {pitcherName}</span> : <span> / All Pitchers</span>}</h3>
          <p>Every completed target from the selected sessions, paired with its actual TrackMan location.</p>
        </div>
        <div className={styles.historyLogHeaderTools}>
          <div className={styles.historyLogSummary}>
            <div><span>Pitches</span><strong>{pitches.length}</strong></div>
            <div><span>Target hit</span><strong>{summary.hitPct === null ? '—' : `${summary.hitPct.toFixed(1)}%`}</strong></div>
            <div><span>Avg. miss</span><strong>{summary.avgMissInches === null ? '—' : `${summary.avgMissInches.toFixed(1)}″`}</strong></div>
          </div>
          <button type="button" className={styles.historyExportButton} onClick={() => void exportPdf()} disabled={!pitches.length || loading || isExporting}>
            <span>⇩</span> {isExporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </header>

      {error ? <div className={styles.targetingError}>{error} <button type="button" onClick={() => void loadPitches()}>Try again</button></div> : null}
      {exportError ? <div className={styles.targetingError}>{exportError}</div> : null}
      {loading ? <div className={styles.historyLogState}><span className={styles.spinner} /> Loading pitch history…</div> : null}
      {!loading && !error && !pitches.length ? (
        <div className={styles.historyLogState}><strong>No completed pitches found</strong><span>Adjust the date, pitcher, pitch-type, or ball-type filters to see more sessions.</span></div>
      ) : null}

      {!loading && visiblePitches.length ? (
        <div className={styles.historyPitchGrid}>
          {visiblePitches.map((pitch) => {
            const color = PITCH_COLORS[pitch.pitchType ?? 'Undefined'] ?? PITCH_COLORS.Undefined;
            const date = pitchDate(pitch);
            return (
              <article key={pitch.id} className={styles.historyPitchCard}>
                <header>
                  <div>
                    <span className={styles.historyPitchSequence}>Session {pitch.sessionId} · Pitch {pitch.pitchIndex}</span>
                    <strong><i style={{ background: color }} />{pitchTypeLabel(pitch.pitchType)}</strong>
                  </div>
                  <span className={pitch.targetHit ? styles.historyHitBadge : styles.historyMissBadge}>{pitch.targetHit ? 'Target hit' : 'Miss'}</span>
                </header>
                <div className={styles.historyPitchBody}>
                  <PitchLocationGraphic pitch={pitch} />
                  <div className={styles.historyPitchDetails}>
                    <div className={styles.historyPitchTimestamp}>
                      <strong>{Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
                      <span>{Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {sessionModeLabel(pitch.sessionMode)}</span>
                    </div>
                    <div className={styles.historyPitchMetrics}>
                      <div><span>Velo</span><strong>{metric(pitch.relSpeed, 1)}</strong></div>
                      <div><span>IVB</span><strong>{metric(pitch.inducedVertBreak, 1, '″')}</strong></div>
                      <div><span>HB</span><strong>{metric(pitch.horzBreak, 1, '″')}</strong></div>
                      <div><span>Miss</span><strong>{metric(pitch.missDistanceFt === null ? null : pitch.missDistanceFt * 12, 1, '″')}</strong></div>
                    </div>
                    <dl className={styles.historyPitchMeta}>
                      <div><dt>Target</dt><dd>Pocket {pitch.targetLocation} · {Math.round(pitch.targetRadiusFt * 24)}″</dd></div>
                      <div><dt>Direction</dt><dd>{pitch.missDirection ? DIRECTION_LABELS[pitch.missDirection] ?? pitch.missDirection : '—'}</dd></div>
                      <div><dt>Ball</dt><dd>{pitch.ballType}</dd></div>
                    </dl>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {!loading && pitches.length > PAGE_SIZE ? (
        <footer className={styles.historyPagination}>
          <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, pitches.length)} of {pitches.length}</span>
          <div>
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Previous</button>
            <strong>{page} / {pageCount}</strong>
            <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>Next</button>
          </div>
        </footer>
      ) : null}
    </section>
  );
}

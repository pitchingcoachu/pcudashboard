'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadLeaderboardTablePdf, downloadContentPdf } from '../../../lib/leaderboard-pdf-export';
import styles from './intended-zone-panel.module.css';

export const MISS_DIRECTION_ORDER = [
  'up-glove',
  'up-middle',
  'up-arm',
  'middle-glove',
  'on-target',
  'middle-arm',
  'down-glove',
  'down-middle',
  'down-arm',
] as const;

export type MissDirection = (typeof MISS_DIRECTION_ORDER)[number];

const MISS_DIRECTION_SHORT_LABELS: Record<MissDirection, string> = {
  'up-glove': 'Up / Glove',
  'up-middle': 'Up',
  'up-arm': 'Up / Arm',
  'middle-glove': 'Glove',
  'on-target': 'On Target',
  'middle-arm': 'Arm',
  'down-glove': 'Down / Glove',
  'down-middle': 'Down',
  'down-arm': 'Down / Arm',
};

export type DirectionBreakdown = Record<MissDirection, number>;

export function emptyIntendedZoneDirectionBreakdown(): DirectionBreakdown {
  const breakdown = {} as DirectionBreakdown;
  for (const key of MISS_DIRECTION_ORDER) breakdown[key] = 0;
  return breakdown;
}

type TargetHitRate = {
  targetInches: number;
  hitCount: number;
  totalCount: number;
  hitPct: number;
};

type PitchTypeStat = {
  pitchType: string;
  pitchCount: number;
  avgMissDistanceFt: number | null;
  directionBreakdown: DirectionBreakdown;
  topMissDirection: MissDirection | null;
  inZonePct: number | null;
  competitivePct: number | null;
  targetHitRates: TargetHitRate[];
};

type PitcherStat = {
  pitcherName: string;
  pitchCount: number;
  avgMissDistanceFt: number | null;
  missDistanceStdDevFt: number | null;
  bestPitchType: string | null;
  directionBreakdown: DirectionBreakdown;
  topMissDirection: MissDirection | null;
  inZonePct: number | null;
  competitivePct: number | null;
  targetHitRates: TargetHitRate[];
};

function pctLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(0)}%`;
}

// Only render one column per target size that actually shows up in the
// current rows -- there's no fixed preset list, since web lets a coach drag
// a free-form slider while mobile has 3 presets, so the real data decides.
function collectTargetInchesColumns(rows: { targetHitRates: TargetHitRate[] }[]): number[] {
  const set = new Set<number>();
  for (const row of rows) {
    for (const rate of row.targetHitRates) set.add(rate.targetInches);
  }
  return Array.from(set).sort((a, b) => a - b);
}

function targetHitCellLabel(rates: TargetHitRate[], targetInches: number): string {
  const rate = rates.find((r) => r.targetInches === targetInches);
  if (!rate) return '—';
  return `${rate.hitPct.toFixed(0)}% (${rate.hitCount}/${rate.totalCount})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

// Same blue -> white -> red diverging scale used by the dashboard's other
// heatmaps (pitching-suite.tsx's divergingColor), so this reads consistently
// with the rest of the app: low values are cool, high values are hot.
function heatColorRgb(value: number, max: number): [number, number, number] {
  if (!Number.isFinite(value) || max <= 0) return [255, 255, 255];
  const t = Math.max(0, Math.min(1, value / max));
  if (t <= 0.5) {
    const localT = t / 0.5;
    return [lerp(32, 246, localT), lerp(74, 248, localT), lerp(135, 248, localT)];
  }
  const localT = (t - 0.5) / 0.5;
  return [lerp(248, 220, localT), lerp(248, 20, localT), lerp(248, 20, localT)];
}

function heatColor(value: number, max: number): string {
  const [r, g, b] = heatColorRgb(value, max);
  return rgb(r, g, b);
}

// Relative luminance -> pick dark or light text so it stays readable against
// any point on the heat scale, including the near-white middle of the range.
function heatTextColor(value: number, max: number): string {
  const [r, g, b] = heatColorRgb(value, max);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0b1220' : '#f8fafc';
}

function sumBreakdown(breakdown: DirectionBreakdown): number {
  return MISS_DIRECTION_ORDER.reduce((sum, key) => sum + (breakdown[key] ?? 0), 0);
}

function mergeBreakdowns(rows: DirectionBreakdown[]): DirectionBreakdown {
  const merged = {} as DirectionBreakdown;
  for (const key of MISS_DIRECTION_ORDER) merged[key] = 0;
  for (const row of rows) {
    for (const key of MISS_DIRECTION_ORDER) merged[key] += row[key] ?? 0;
  }
  return merged;
}

export function MiniDirectionGrid({ breakdown, size = 15 }: { breakdown: DirectionBreakdown; size?: number }) {
  const total = sumBreakdown(breakdown);
  const max = Math.max(1, ...MISS_DIRECTION_ORDER.map((key) => breakdown[key] ?? 0));
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(3, ${size}px)`,
        gridTemplateRows: `repeat(3, ${size}px)`,
        gap: 2,
      }}
      title={total ? `${total} pitches` : 'No data'}
    >
      {MISS_DIRECTION_ORDER.map((key) => {
        const count = breakdown[key] ?? 0;
        return (
          <div
            key={key}
            style={{
              width: size,
              height: size,
              borderRadius: 3,
              background: total ? heatColor(count, max) : 'rgba(148, 163, 184, 0.1)',
              border: key === 'on-target' ? '1px solid rgba(226, 232, 240, 0.5)' : 'none',
            }}
          />
        );
      })}
    </div>
  );
}

// Same 5-point home-plate shape used by the real zone graphics elsewhere in
// the dashboard (pitching-suite.tsx / intended-zone-panel.tsx's action-zone
// SVG), scaled to sit as a small anchor beneath the miss-direction grid --
// gives a heatmap-only view (no strike zone drawn) a visual reference for
// "this is looking down at the plate" the same way the live zone does.
// Renders as an <img> of a data-URI SVG rather than a live inline <svg>
// element. Matches the mobile app's plate exactly (same polygon, same
// stroke), but a live inline <svg> polygon silently mis-renders under
// html2canvas (used for the PDF export) -- html2canvas rasterizes <img>
// elements (including SVG data URIs) via a plain drawImage instead of
// trying to re-serialize the SVG DOM tree, so this survives the export.
function homePlateSvgDataUri(w: number, h: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polygon points="${w * 0.5},${h * 0.08} ${w * 0.97},${h * 0.62} ${w * 0.97},${h * 0.95} ${w * 0.03},${h * 0.95} ${w * 0.03},${h * 0.62}" fill="rgba(226, 232, 240, 0.12)" stroke="rgba(226, 232, 240, 0.5)" stroke-width="1.5"/></svg>`;
  return `data:image/svg+xml;base64,${typeof window !== 'undefined' ? window.btoa(svg) : Buffer.from(svg).toString('base64')}`;
}

function HomePlateIcon({ gridWidth }: { gridWidth: number }) {
  const w = gridWidth * 0.72;
  // Foreshortened the same way the real zone graphics draw it (pitching-suite.tsx
  // / intended-zone-panel.tsx's action-zone SVG both use a plate that's only
  // ~0.2 units tall against a 1.5-unit-wide strike zone) -- a pitcher looking
  // down at the plate from the mound sees it as a thin, wide sliver, not a
  // tall boxy pentagon. Point at the TOP (toward the mound), flat edge at
  // the BOTTOM (toward the catcher).
  const h = w * 0.16;
  return (
    <img
      src={homePlateSvgDataUri(w, h)}
      alt=""
      width={w}
      height={h}
      style={{ display: 'block', margin: '10px auto 0' }}
    />
  );
}

export function DirectionHeatmap({ breakdown }: { breakdown: DirectionBreakdown }) {
  const total = sumBreakdown(breakdown);
  const max = Math.max(1, ...MISS_DIRECTION_ORDER.map((key) => breakdown[key] ?? 0));
  const cell = 84;

  return (
    <div className={styles.zoneFrame} style={{ maxWidth: 3 * cell + 28 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(3, ${cell}px)`,
          gridTemplateRows: `repeat(3, ${cell}px)`,
          gap: 4,
        }}
      >
        {MISS_DIRECTION_ORDER.map((key) => {
          const count = breakdown[key] ?? 0;
          const pct = total ? Math.round((count / total) * 100) : 0;
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                borderRadius: 10,
                background: total ? heatColor(count, max) : 'rgba(148, 163, 184, 0.08)',
                border: key === 'on-target' ? '2px solid rgba(226, 232, 240, 0.65)' : '1px solid rgba(255,255,255,0.08)',
                color: total ? heatTextColor(count, max) : '#94a3b8',
              }}
            >
              <span style={{ fontSize: '1.1rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
              <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.85 }}>
                {MISS_DIRECTION_SHORT_LABELS[key]}
              </span>
            </div>
          );
        })}
      </div>
      <HomePlateIcon gridWidth={3 * cell + 8} />
    </div>
  );
}

function missDistanceLabel(ft: number | null): string {
  if (ft === null || !Number.isFinite(ft)) return '—';
  return `${(ft * 12).toFixed(1)}"`;
}

export default function IntendedZoneStats({
  pitcherName,
  organizationHasMultiplePitchers,
  sidebarStartDate,
  sidebarEndDate,
  sidebarPitchTypes,
}: {
  pitcherName: string | null;
  organizationHasMultiplePitchers: boolean;
  sidebarStartDate: string;
  sidebarEndDate: string;
  sidebarPitchTypes: string[];
}) {
  const [mode, setMode] = useState<'pitcher' | 'leaderboard'>('pitcher');
  const [pitchTypeStats, setPitchTypeStats] = useState<PitchTypeStat[]>([]);
  const [leaderboard, setLeaderboard] = useState<PitcherStat[]>([]);
  const [sortColumn, setSortColumn] = useState<'pitchCount' | 'avgMissDistanceFt' | 'missDistanceStdDevFt' | 'inZonePct' | 'competitivePct'>('avgMissDistanceFt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPitcherRow, setSelectedPitcherRow] = useState<string | null>(null);
  const [selectedPitcherTypeStats, setSelectedPitcherTypeStats] = useState<PitchTypeStat[]>([]);
  const [selectedPitcherStatsLoading, setSelectedPitcherStatsLoading] = useState(false);
  const [selectedPitcherPitchType, setSelectedPitcherPitchType] = useState('All');
  const [splitBy, setSplitBy] = useState<'pitchType' | 'targetSize'>('pitchType');
  const [isExportingPitcherPdf, setIsExportingPitcherPdf] = useState(false);
  const [isExportingLeaderboardPdf, setIsExportingLeaderboardPdf] = useState(false);
  const pitcherExportRef = useRef<HTMLDivElement | null>(null);
  const leaderboardExportRef = useRef<HTMLDivElement | null>(null);

  const pitchTypesParam = useMemo(
    () => sidebarPitchTypes.filter((value) => value.trim() && value.trim().toLowerCase() !== 'all').join(','),
    [sidebarPitchTypes]
  );

  const loadPitcherStats = useCallback(async () => {
    if (!pitcherName) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pitcherName, splitBy });
      if (sidebarStartDate) params.set('startDate', sidebarStartDate);
      if (sidebarEndDate) params.set('endDate', sidebarEndDate);
      if (pitchTypesParam) params.set('pitchTypes', pitchTypesParam);
      const response = await fetch(`/api/dashboard/pitching/intended-zone/stats?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load stats.');
      setPitchTypeStats(Array.isArray(payload.stats) ? payload.stats : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats.');
    } finally {
      setLoading(false);
    }
  }, [pitcherName, sidebarStartDate, sidebarEndDate, pitchTypesParam, splitBy]);

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ leaderboard: '1' });
      if (sidebarStartDate) params.set('startDate', sidebarStartDate);
      if (sidebarEndDate) params.set('endDate', sidebarEndDate);
      if (pitchTypesParam) params.set('pitchTypes', pitchTypesParam);
      const response = await fetch(`/api/dashboard/pitching/intended-zone/stats?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load leaderboard.');
      setLeaderboard(Array.isArray(payload.leaderboard) ? payload.leaderboard : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard.');
    } finally {
      setLoading(false);
    }
  }, [sidebarStartDate, sidebarEndDate, pitchTypesParam]);

  useEffect(() => {
    if (mode === 'pitcher') loadPitcherStats();
    else loadLeaderboard();
  }, [mode, loadPitcherStats, loadLeaderboard]);

  useEffect(() => {
    if (mode !== 'leaderboard' || !selectedPitcherRow) {
      setSelectedPitcherTypeStats([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setSelectedPitcherStatsLoading(true);
      try {
        const params = new URLSearchParams({ pitcherName: selectedPitcherRow, splitBy });
        if (sidebarStartDate) params.set('startDate', sidebarStartDate);
        if (sidebarEndDate) params.set('endDate', sidebarEndDate);
        if (pitchTypesParam) params.set('pitchTypes', pitchTypesParam);
        const response = await fetch(`/api/dashboard/pitching/intended-zone/stats?${params.toString()}`);
        const payload = await response.json();
        if (!cancelled && response.ok) setSelectedPitcherTypeStats(Array.isArray(payload.stats) ? payload.stats : []);
      } catch {
        // Best-effort -- the leaderboard row itself already has the summary numbers.
      } finally {
        if (!cancelled) setSelectedPitcherStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, selectedPitcherRow, sidebarStartDate, sidebarEndDate, pitchTypesParam, splitBy]);

  const sortedLeaderboard = useMemo(() => {
    const rows = [...leaderboard];
    rows.sort((a, b) => {
      const aVal = a[sortColumn] ?? Infinity;
      const bVal = b[sortColumn] ?? Infinity;
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return rows;
  }, [leaderboard, sortColumn, sortDirection]);

  const allTypeRow = pitchTypeStats.find((s) => s.pitchType === 'All') ?? null;
  const perTypeRows = pitchTypeStats.filter((s) => s.pitchType !== 'All');
  // Hidden when split-by-target-size -- each row already IS one target size,
  // so a per-row "N" Target Hit%" column would just be 100%/self or blank,
  // adding noise instead of the miss-distance-by-size comparison that's the
  // whole point of that split mode.
  const perTypeTargetColumns = useMemo(() => (splitBy === 'targetSize' ? [] : collectTargetInchesColumns(perTypeRows)), [perTypeRows, splitBy]);

  const selectedPitcherStat = selectedPitcherRow ? leaderboard.find((p) => p.pitcherName === selectedPitcherRow) ?? null : null;
  const combinedLeaderboardBreakdown = useMemo(() => mergeBreakdowns(leaderboard.map((p) => p.directionBreakdown)), [leaderboard]);
  const leaderboardTargetColumns = useMemo(() => collectTargetInchesColumns(leaderboard), [leaderboard]);

  const selectedPitcherAllRow = selectedPitcherTypeStats.find((s) => s.pitchType === 'All') ?? null;
  const selectedPitcherPerTypeRows = selectedPitcherTypeStats.filter((s) => s.pitchType !== 'All');
  const selectedPitcherTargetColumns = useMemo(
    () => (splitBy === 'targetSize' ? [] : collectTargetInchesColumns(selectedPitcherPerTypeRows)),
    [selectedPitcherPerTypeRows, splitBy]
  );
  const selectedPitcherPitchTypeRow =
    selectedPitcherPitchType === 'All' ? selectedPitcherAllRow : selectedPitcherPerTypeRows.find((s) => s.pitchType === selectedPitcherPitchType) ?? null;

  function toggleSort(column: typeof sortColumn) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      // Higher is better for zone/competitive rate, so default to
      // descending; lower is better for miss distance/inconsistency, so
      // default to ascending.
      setSortDirection(column === 'inZonePct' || column === 'competitivePct' ? 'desc' : 'asc');
    }
  }

  function sortArrow(column: typeof sortColumn) {
    if (sortColumn !== column) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  }

  const dateRangeLabel =
    sidebarStartDate && sidebarEndDate
      ? sidebarStartDate === sidebarEndDate
        ? new Date(`${sidebarStartDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : `${new Date(`${sidebarStartDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${new Date(`${sidebarEndDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : '';

  const handleExportPitcherPdf = useCallback(async () => {
    const wrapNode = pitcherExportRef.current;
    if (!wrapNode || !pitcherName) return;
    setIsExportingPitcherPdf(true);
    setError(null);
    try {
      const safeName = pitcherName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await downloadContentPdf({
        node: wrapNode,
        titleText: 'Intended Target Results',
        nameText: pitcherName,
        subtitleText: [splitBy === 'targetSize' ? 'Split by Target Size' : '', dateRangeLabel].filter(Boolean).join('  ·  '),
        fileName: `intended-target-${safeName}.pdf`,
        singlePage: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export PDF.');
    } finally {
      setIsExportingPitcherPdf(false);
    }
  }, [pitcherName, splitBy, dateRangeLabel]);

  const handleExportLeaderboardPdf = useCallback(async () => {
    const wrapNode = leaderboardExportRef.current;
    if (!wrapNode) return;
    setIsExportingLeaderboardPdf(true);
    setError(null);
    try {
      await downloadLeaderboardTablePdf({
        wrapNode,
        titleText: 'Intended Target Leaderboard',
        subtitleText: ['All Pitchers', dateRangeLabel].filter(Boolean).join('  ·  '),
        fileName: 'intended-zone-leaderboard.pdf',
        tableSelector: `table.${styles.logTable}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export PDF.');
    } finally {
      setIsExportingLeaderboardPdf(false);
    }
  }, [dateRangeLabel]);

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Stats</p>
          <h3 className={styles.title}>Intended Target Results</h3>
          <p className={styles.subtitle}>Miss distance and direction, broken down by pitch type — or across every pitcher as a leaderboard.</p>
        </div>
      </div>

      <div className={styles.setupGrid} style={{ gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {organizationHasMultiplePitchers || !pitcherName ? (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>View</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className={styles.resetButton}
                  style={mode === 'pitcher' ? { borderColor: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' } : undefined}
                  onClick={() => setMode('pitcher')}
                  disabled={!pitcherName}
                >
                  This Pitcher
                </button>
                <button
                  type="button"
                  className={styles.resetButton}
                  style={mode === 'leaderboard' ? { borderColor: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' } : undefined}
                  onClick={() => setMode('leaderboard')}
                >
                  Leaderboard
                </button>
              </div>
            </div>
          ) : null}

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="iz-split-by">
              Split By
            </label>
            <select id="iz-split-by" className={styles.select} value={splitBy} onChange={(event) => setSplitBy(event.target.value === 'targetSize' ? 'targetSize' : 'pitchType')}>
              <option value="pitchType">Pitch Type</option>
              <option value="targetSize">Target Size</option>
            </select>
          </div>
        </div>
        <p className={styles.zoneHint} style={{ textAlign: 'left' }}>
          Uses the Date Range and Pitch Type filters from the sidebar.
          {sidebarStartDate || sidebarEndDate ? ` ${sidebarStartDate || '…'} → ${sidebarEndDate || '…'}.` : ' Showing all dates.'}
          {pitchTypesParam ? ` Pitch types: ${pitchTypesParam.split(',').join(', ')}.` : ' Showing all pitch types.'}
        </p>
      </div>

      {error ? <p className={styles.errorBanner}>{error}</p> : null}
      {loading ? (
        <div className={styles.waitingCard}>
          <span className={styles.spinner} />
          Loading…
        </div>
      ) : null}

      {mode === 'pitcher' ? (
        !pitcherName ? (
          <p className={styles.noPitcher}>Select a single pitcher above to view their stats.</p>
        ) : !loading && !pitchTypeStats.length ? (
          <p className={styles.noPitcher}>No completed Intended Target pitches found for this pitcher{sidebarStartDate || sidebarEndDate ? ' in this date range' : ''}.</p>
        ) : pitchTypeStats.length ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
              <button type="button" className={styles.resetButton} onClick={handleExportPitcherPdf} disabled={isExportingPitcherPdf}>
                {isExportingPitcherPdf ? 'Exporting…' : 'Export PDF'}
              </button>
            </div>

            <div ref={pitcherExportRef} style={{ display: 'grid', gap: 20 }}>
              <div className={styles.logSection}>
                <p className={styles.logTitle} data-pdf-hide="true" style={{ marginBottom: 12 }}>{splitBy === 'targetSize' ? 'By Target Size' : 'By Pitch Type'}</p>
                <div className={styles.logScroll}>
                  <table className={styles.logTable}>
                    <thead>
                      <tr>
                        <th>{splitBy === 'targetSize' ? 'Target Size' : 'Pitch Type'}</th>
                        <th>Pitches</th>
                        <th>In Zone%</th>
                        <th>Comp%</th>
                        {perTypeTargetColumns.map((inches) => (
                          <th key={inches}>{inches}" Target Hit%</th>
                        ))}
                        <th>Avg Miss Distance</th>
                        <th>Most Common Miss Direction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...perTypeRows, ...(allTypeRow ? [allTypeRow] : [])].map((row) => {
                        const severity = row.avgMissDistanceFt === null ? null : row.avgMissDistanceFt * 12 <= 6 ? 'good' : row.avgMissDistanceFt * 12 <= 14 ? 'warn' : 'bad';
                        const isAllRow = row.pitchType === 'All';
                        return (
                          <tr key={row.pitchType} style={isAllRow ? { fontWeight: 700, background: 'rgba(148, 163, 184, 0.06)' } : undefined}>
                            <td>{row.pitchType}</td>
                            <td>{row.pitchCount}</td>
                            <td>{pctLabel(row.inZonePct)}</td>
                            <td>{pctLabel(row.competitivePct)}</td>
                            {perTypeTargetColumns.map((inches) => (
                              <td key={inches}>{targetHitCellLabel(row.targetHitRates, inches)}</td>
                            ))}
                            <td className={severity ? `${styles.logMissDistance} ${styles[severity]}` : undefined}>{missDistanceLabel(row.avgMissDistanceFt)}</td>
                            <td>{row.topMissDirection ? MISS_DIRECTION_SHORT_LABELS[row.topMissDirection] : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {perTypeRows.length ? (
                <div>
                  <p className={styles.logTitle} style={{ marginBottom: 4 }}>
                    Miss Direction by Pitch Type
                  </p>
                  <p className={styles.zoneHint} style={{ textAlign: 'left', marginBottom: 12 }}>
                    Where misses land relative to the target — glove/arm side is from the pitcher&apos;s own throwing-hand perspective.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 24 }}>
                    {perTypeRows.map((row) => (
                      <div key={row.pitchType} className={styles.zoneCard} style={{ width: 280 }}>
                        <p className={styles.historyTitle} style={{ alignSelf: 'flex-start', color: '#f8fafc' }}>
                          {row.pitchType} ({row.pitchCount})
                        </p>
                        <DirectionHeatmap breakdown={row.directionBreakdown} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null
      ) : !loading && !leaderboard.length ? (
        <p className={styles.noPitcher}>No completed Intended Target pitches found across any pitcher{sidebarStartDate || sidebarEndDate ? ' in this date range' : ''}.</p>
      ) : leaderboard.length ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button type="button" className={styles.resetButton} onClick={handleExportLeaderboardPdf} disabled={isExportingLeaderboardPdf}>
              {isExportingLeaderboardPdf ? 'Exporting…' : 'Export PDF'}
            </button>
          </div>
          <div className={styles.contentGrid} ref={leaderboardExportRef}>
          <div className={styles.logSection} style={{ gridColumn: '1 / -1' }}>
            <p className={styles.logTitle}>Pitcher Leaderboard — lowest average miss distance first</p>
            <div className={styles.logScroll}>
              <table className={styles.logTable}>
                <thead>
                  <tr>
                    <th>Pitcher</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('pitchCount')}>
                      Pitches{sortArrow('pitchCount')}
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('inZonePct')}>
                      In Zone%{sortArrow('inZonePct')}
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('competitivePct')}>
                      Comp%{sortArrow('competitivePct')}
                    </th>
                    {leaderboardTargetColumns.map((inches) => (
                      <th key={inches}>{inches}" Target Hit%</th>
                    ))}
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('avgMissDistanceFt')}>
                      Avg Miss Distance{sortArrow('avgMissDistanceFt')}
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('missDistanceStdDevFt')}>
                      Consistency (Std Dev){sortArrow('missDistanceStdDevFt')}
                    </th>
                    <th>Best Pitch Type</th>
                    <th>Most Common Miss</th>
                    <th>Direction Spread</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLeaderboard.map((row, index) => {
                    const severity = row.avgMissDistanceFt === null ? null : row.avgMissDistanceFt * 12 <= 6 ? 'good' : row.avgMissDistanceFt * 12 <= 14 ? 'warn' : 'bad';
                    return (
                      <tr
                        key={row.pitcherName}
                        onClick={() => {
                          setSelectedPitcherRow(row.pitcherName);
                          setSelectedPitcherPitchType('All');
                        }}
                        style={{ cursor: 'pointer', background: selectedPitcherRow === row.pitcherName ? 'rgba(148, 163, 184, 0.08)' : undefined }}
                      >
                        <td>
                          <span className={styles.pitchCounter} style={{ fontSize: '0.85rem' }}>
                            #{index + 1} {row.pitcherName}
                          </span>
                        </td>
                        <td>{row.pitchCount}</td>
                        <td>{pctLabel(row.inZonePct)}</td>
                        <td>{pctLabel(row.competitivePct)}</td>
                        {leaderboardTargetColumns.map((inches) => (
                          <td key={inches}>{targetHitCellLabel(row.targetHitRates, inches)}</td>
                        ))}
                        <td className={severity ? `${styles.logMissDistance} ${styles[severity]}` : undefined}>{missDistanceLabel(row.avgMissDistanceFt)}</td>
                        <td>{missDistanceLabel(row.missDistanceStdDevFt)}</td>
                        <td>{row.bestPitchType ?? '—'}</td>
                        <td>{row.topMissDirection ? MISS_DIRECTION_SHORT_LABELS[row.topMissDirection] : '—'}</td>
                        <td>
                          <MiniDirectionGrid breakdown={row.directionBreakdown} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={styles.zoneHint} style={{ textAlign: 'left', marginTop: 8 }}>
              Click a row to see that pitcher&apos;s full miss-direction breakdown below.
            </p>
          </div>

          <div className={styles.zoneCard} style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: 10 }}>
              <p className={styles.historyTitle} style={{ margin: 0 }}>
                {selectedPitcherStat ? `${selectedPitcherStat.pitcherName} — Miss Direction` : 'All Pitchers — Combined Miss Direction'}
              </p>
              {selectedPitcherStat ? (
                <div className={styles.field} style={{ gap: 4 }}>
                  <label className={styles.fieldLabel} htmlFor="iz-pitcher-pitch-type">
                    {splitBy === 'targetSize' ? 'Target Size' : 'Pitch Type'}
                  </label>
                  <select
                    id="iz-pitcher-pitch-type"
                    className={styles.select}
                    value={selectedPitcherPitchType}
                    onChange={(event) => setSelectedPitcherPitchType(event.target.value)}
                  >
                    <option value="All">{splitBy === 'targetSize' ? 'All Target Sizes' : 'All Pitch Types'}</option>
                    {selectedPitcherPerTypeRows.map((row) => (
                      <option key={row.pitchType} value={row.pitchType}>
                        {row.pitchType} ({row.pitchCount})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
            <p className={styles.zoneHint} style={{ textAlign: 'left', marginBottom: 8 }}>
              Where misses land relative to the target — glove/arm side is from the pitcher&apos;s own throwing-hand perspective.
            </p>

            <DirectionHeatmap
              breakdown={
                selectedPitcherStat
                  ? selectedPitcherPitchTypeRow?.directionBreakdown ?? selectedPitcherStat.directionBreakdown
                  : combinedLeaderboardBreakdown
              }
            />

            {selectedPitcherStat && selectedPitcherPitchTypeRow ? (
              <div className={styles.summaryCard} style={{ width: '100%' }}>
                <p className={styles.summaryTitle}>{selectedPitcherPitchTypeRow.pitchType}</p>
                <div className={styles.summaryStats}>
                  <span className={styles.summaryStat}>
                    Pitches: <strong>{selectedPitcherPitchTypeRow.pitchCount}</strong>
                  </span>
                  <span className={styles.summaryStat}>
                    In Zone: <strong>{pctLabel(selectedPitcherPitchTypeRow.inZonePct)}</strong>
                  </span>
                  <span className={styles.summaryStat}>
                    Competitive: <strong>{pctLabel(selectedPitcherPitchTypeRow.competitivePct)}</strong>
                  </span>
                  {selectedPitcherPitchTypeRow.targetHitRates.map((rate) => (
                    <span className={styles.summaryStat} key={rate.targetInches}>
                      {rate.targetInches}" Target Hit: <strong>{rate.hitPct.toFixed(0)}%</strong>
                    </span>
                  ))}
                  <span className={styles.summaryStat}>
                    Avg Miss: <strong>{missDistanceLabel(selectedPitcherPitchTypeRow.avgMissDistanceFt)}</strong>
                  </span>
                  <span className={styles.summaryStat}>
                    Most Common Miss:{' '}
                    <strong>{selectedPitcherPitchTypeRow.topMissDirection ? MISS_DIRECTION_SHORT_LABELS[selectedPitcherPitchTypeRow.topMissDirection] : '—'}</strong>
                  </span>
                </div>
              </div>
            ) : selectedPitcherStat && selectedPitcherStatsLoading ? (
              <div className={styles.waitingCard}>
                <span className={styles.spinner} />
                Loading pitch types…
              </div>
            ) : null}

            {selectedPitcherStat && selectedPitcherPerTypeRows.length ? (
              <div className={styles.logSection} style={{ width: '100%' }}>
                <p className={styles.logTitle}>
                  {splitBy === 'targetSize' ? 'All Target Sizes' : 'All Pitch Types'} for {selectedPitcherStat.pitcherName}
                </p>
                <div className={styles.logScroll}>
                  <table className={styles.logTable}>
                    <thead>
                      <tr>
                        <th>{splitBy === 'targetSize' ? 'Target Size' : 'Pitch Type'}</th>
                        <th>Pitches</th>
                        <th>In Zone%</th>
                        <th>Comp%</th>
                        {selectedPitcherTargetColumns.map((inches) => (
                          <th key={inches}>{inches}" Target Hit%</th>
                        ))}
                        <th>Avg Miss Distance</th>
                        <th>Most Common Miss Direction</th>
                        <th>Direction Spread</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...selectedPitcherPerTypeRows, ...(selectedPitcherAllRow ? [selectedPitcherAllRow] : [])].map((row) => {
                        const severity = row.avgMissDistanceFt === null ? null : row.avgMissDistanceFt * 12 <= 6 ? 'good' : row.avgMissDistanceFt * 12 <= 14 ? 'warn' : 'bad';
                        const isAllRow = row.pitchType === 'All';
                        return (
                          <tr
                            key={row.pitchType}
                            onClick={() => setSelectedPitcherPitchType(row.pitchType)}
                            style={{
                              cursor: 'pointer',
                              fontWeight: isAllRow ? 700 : undefined,
                              background: selectedPitcherPitchType === row.pitchType ? 'rgba(148, 163, 184, 0.08)' : isAllRow ? 'rgba(148, 163, 184, 0.06)' : undefined,
                            }}
                          >
                            <td>
                              <span className={styles.logPitchType}>{row.pitchType}</span>
                            </td>
                            <td>{row.pitchCount}</td>
                            <td>{pctLabel(row.inZonePct)}</td>
                            <td>{pctLabel(row.competitivePct)}</td>
                            {selectedPitcherTargetColumns.map((inches) => (
                              <td key={inches}>{targetHitCellLabel(row.targetHitRates, inches)}</td>
                            ))}
                            <td className={severity ? `${styles.logMissDistance} ${styles[severity]}` : undefined}>{missDistanceLabel(row.avgMissDistanceFt)}</td>
                            <td>{row.topMissDirection ? MISS_DIRECTION_SHORT_LABELS[row.topMissDirection] : '—'}</td>
                            <td>
                              <MiniDirectionGrid breakdown={row.directionBreakdown} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

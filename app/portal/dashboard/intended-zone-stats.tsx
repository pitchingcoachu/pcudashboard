'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { downloadLeaderboardTablePdf, downloadContentPdf } from '../../../lib/leaderboard-pdf-export';
import styles from './intended-zone-panel.module.css';

// Same fixed pitch-type ordering used everywhere else in the dashboard
// (custom-reports-suite.tsx's PITCH_ORDER, spin-visual-panel.tsx's
// PITCH_TYPE_ORDER) -- not alphabetical, matches how coaches actually
// group pitch types (fastballs first, then off-speed).
const PITCH_TYPE_ORDER = ['Fastball', 'Sinker', 'Cutter', 'Slider', 'Sweeper', 'Curveball', 'ChangeUp', 'Splitter', 'Knuckleball'];

function sortByPitchTypeOrder<T extends { pitchType: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const indexA = PITCH_TYPE_ORDER.indexOf(a.pitchType);
    const indexB = PITCH_TYPE_ORDER.indexOf(b.pitchType);
    if (indexA === -1 && indexB === -1) return a.pitchType.localeCompare(b.pitchType);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
}

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
  const [leaderboardTypeStats, setLeaderboardTypeStats] = useState<PitchTypeStat[]>([]);
  // Sort column is either a fixed PitcherStat key or a dynamic
  // `targetHit:{inches}` key for one of the per-target-size Hit% columns
  // (those columns vary per date range/pitcher pool, so they can't be a
  // fixed union member) -- see leaderboardSortValue below for how both
  // kinds resolve to a comparable value.
  const [sortColumn, setSortColumn] = useState<string>('avgMissDistanceFt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPitcherRow, setSelectedPitcherRow] = useState<string | null>(null);
  const [selectedPitcherTypeStats, setSelectedPitcherTypeStats] = useState<PitchTypeStat[]>([]);
  const [selectedPitcherStatsLoading, setSelectedPitcherStatsLoading] = useState(false);
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
      const params = new URLSearchParams({ leaderboard: '1', splitBy });
      if (sidebarStartDate) params.set('startDate', sidebarStartDate);
      if (sidebarEndDate) params.set('endDate', sidebarEndDate);
      if (pitchTypesParam) params.set('pitchTypes', pitchTypesParam);
      const response = await fetch(`/api/dashboard/pitching/intended-zone/stats?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load leaderboard.');
      setLeaderboard(Array.isArray(payload.leaderboard) ? payload.leaderboard : []);
      setLeaderboardTypeStats(Array.isArray(payload.stats) ? payload.stats : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard.');
    } finally {
      setLoading(false);
    }
  }, [sidebarStartDate, sidebarEndDate, pitchTypesParam, splitBy]);

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

  // Resolves any sortable leaderboard column (fixed field or a dynamic
  // `targetHit:{inches}` Hit% column) to a value comparable by
  // number-then-string, mirroring lib/table-sort.ts's sortTableRows
  // approach but working directly off PitcherStat's typed fields instead
  // of a flattened string-keyed record.
  function leaderboardSortValue(row: PitcherStat, column: string): number | string | null {
    if (column.startsWith('targetHit:')) {
      const inches = Number(column.slice('targetHit:'.length));
      return row.targetHitRates.find((r) => r.targetInches === inches)?.hitPct ?? null;
    }
    switch (column) {
      case 'pitcherName':
      case 'bestPitchType':
        return row[column];
      case 'topMissDirection':
        return row.topMissDirection ? MISS_DIRECTION_SHORT_LABELS[row.topMissDirection] : null;
      case 'pitchCount':
      case 'avgMissDistanceFt':
      case 'missDistanceStdDevFt':
      case 'inZonePct':
      case 'competitivePct':
        return row[column];
      default:
        return null;
    }
  }

  const sortedLeaderboard = useMemo(() => {
    const withIndex = leaderboard.map((row, idx) => ({ row, idx }));
    withIndex.sort((a, b) => {
      const av = leaderboardSortValue(a.row, sortColumn);
      const bv = leaderboardSortValue(b.row, sortColumn);
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else if (av === null && bv === null) {
        cmp = 0;
      } else if (av === null) {
        cmp = 1;
      } else if (bv === null) {
        cmp = -1;
      } else {
        cmp = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
      }
      if (cmp === 0) cmp = a.idx - b.idx;
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return withIndex.map((entry) => entry.row);
  }, [leaderboard, sortColumn, sortDirection]);

  const allTypeRow = pitchTypeStats.find((s) => s.pitchType === 'All') ?? null;
  const perTypeRowsRaw = pitchTypeStats.filter((s) => s.pitchType !== 'All');
  const perTypeRows = splitBy === 'pitchType' ? sortByPitchTypeOrder(perTypeRowsRaw) : perTypeRowsRaw;
  // Hidden when split-by-target-size -- each row already IS one target size,
  // so a per-row "N" Target Hit%" column would just be 100%/self or blank,
  // adding noise instead of the miss-distance-by-size comparison that's the
  // whole point of that split mode.
  const perTypeTargetColumns = useMemo(() => (splitBy === 'targetSize' ? [] : collectTargetInchesColumns(perTypeRows)), [perTypeRows, splitBy]);

  const selectedPitcherStat = selectedPitcherRow ? leaderboard.find((p) => p.pitcherName === selectedPitcherRow) ?? null : null;
  const leaderboardTargetColumns = useMemo(() => collectTargetInchesColumns(leaderboard), [leaderboard]);

  const leaderboardAllTypeRow = leaderboardTypeStats.find((s) => s.pitchType === 'All') ?? null;
  const leaderboardPerTypeRowsRaw = leaderboardTypeStats.filter((s) => s.pitchType !== 'All');
  const leaderboardPerTypeRows = splitBy === 'pitchType' ? sortByPitchTypeOrder(leaderboardPerTypeRowsRaw) : leaderboardPerTypeRowsRaw;
  const leaderboardPerTypeTargetColumns = useMemo(
    () => (splitBy === 'targetSize' ? [] : collectTargetInchesColumns(leaderboardPerTypeRows)),
    [leaderboardPerTypeRows, splitBy]
  );

  const selectedPitcherAllRow = selectedPitcherTypeStats.find((s) => s.pitchType === 'All') ?? null;
  const selectedPitcherPerTypeRowsRaw = selectedPitcherTypeStats.filter((s) => s.pitchType !== 'All');
  const selectedPitcherPerTypeRows = splitBy === 'pitchType' ? sortByPitchTypeOrder(selectedPitcherPerTypeRowsRaw) : selectedPitcherPerTypeRowsRaw;
  const selectedPitcherTargetColumns = useMemo(
    () => (splitBy === 'targetSize' ? [] : collectTargetInchesColumns(selectedPitcherPerTypeRows)),
    [selectedPitcherPerTypeRows, splitBy]
  );

  // Higher-is-better columns (zone/competitive/target-hit rate) default to
  // descending on first click; lower-is-better (miss distance, std dev) and
  // text columns (name, pitch type, direction) default to ascending --
  // matches this page's existing per-column semantics rather than Pitching
  // Suite leaderboard's simpler "always descending" rule.
  function toggleSort(column: string) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      const higherIsBetter = column === 'inZonePct' || column === 'competitivePct' || column.startsWith('targetHit:');
      setSortDirection(higherIsBetter ? 'desc' : 'asc');
    }
  }

  function sortArrow(column: string) {
    if (sortColumn !== column) return '';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  }

  const sortableHeaderStyle = (column: string): CSSProperties =>
    sortColumn === column
      ? { cursor: 'pointer', background: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' }
      : { cursor: 'pointer' };

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
                    <th>Rank</th>
                    <th style={sortableHeaderStyle('pitcherName')} onClick={() => toggleSort('pitcherName')}>
                      Pitcher{sortArrow('pitcherName')}
                    </th>
                    <th style={sortableHeaderStyle('pitchCount')} onClick={() => toggleSort('pitchCount')}>
                      Pitches{sortArrow('pitchCount')}
                    </th>
                    <th style={sortableHeaderStyle('inZonePct')} onClick={() => toggleSort('inZonePct')}>
                      In Zone%{sortArrow('inZonePct')}
                    </th>
                    <th style={sortableHeaderStyle('competitivePct')} onClick={() => toggleSort('competitivePct')}>
                      Comp%{sortArrow('competitivePct')}
                    </th>
                    {leaderboardTargetColumns.map((inches) => (
                      <th key={inches} style={sortableHeaderStyle(`targetHit:${inches}`)} onClick={() => toggleSort(`targetHit:${inches}`)}>
                        {inches}" Target Hit%{sortArrow(`targetHit:${inches}`)}
                      </th>
                    ))}
                    <th style={sortableHeaderStyle('avgMissDistanceFt')} onClick={() => toggleSort('avgMissDistanceFt')}>
                      Avg Miss Distance{sortArrow('avgMissDistanceFt')}
                    </th>
                    <th style={sortableHeaderStyle('missDistanceStdDevFt')} onClick={() => toggleSort('missDistanceStdDevFt')}>
                      Consistency (Std Dev){sortArrow('missDistanceStdDevFt')}
                    </th>
                    <th style={sortableHeaderStyle('bestPitchType')} onClick={() => toggleSort('bestPitchType')}>
                      Best Pitch Type{sortArrow('bestPitchType')}
                    </th>
                    <th style={sortableHeaderStyle('topMissDirection')} onClick={() => toggleSort('topMissDirection')}>
                      Most Common Miss{sortArrow('topMissDirection')}
                    </th>
                    <th>Direction Spread</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLeaderboard.map((row, index) => {
                    const severity = row.avgMissDistanceFt === null ? null : row.avgMissDistanceFt * 12 <= 6 ? 'good' : row.avgMissDistanceFt * 12 <= 14 ? 'warn' : 'bad';
                    return (
                      <tr
                        key={row.pitcherName}
                        onClick={() => setSelectedPitcherRow(row.pitcherName)}
                        style={{ cursor: 'pointer', background: selectedPitcherRow === row.pitcherName ? 'rgba(148, 163, 184, 0.08)' : undefined }}
                      >
                        <td>{index + 1}</td>
                        <td>
                          <span className={styles.pitchCounter} style={{ fontSize: '0.85rem' }}>
                            {row.pitcherName}
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
            <p className={styles.historyTitle} style={{ margin: 0, alignSelf: 'flex-start' }}>
              {selectedPitcherStat ? `${selectedPitcherStat.pitcherName} — Miss Direction` : 'All Pitchers — Miss Direction'}
            </p>

            {selectedPitcherStat && selectedPitcherStatsLoading ? (
              <div className={styles.waitingCard}>
                <span className={styles.spinner} />
                Loading pitch types…
              </div>
            ) : (
              (() => {
                const rows = selectedPitcherStat ? selectedPitcherPerTypeRows : leaderboardPerTypeRows;
                const allRow = selectedPitcherStat ? selectedPitcherAllRow : leaderboardAllTypeRow;
                const targetColumns = selectedPitcherStat ? selectedPitcherTargetColumns : leaderboardPerTypeTargetColumns;
                const titleSuffix = selectedPitcherStat ? ` for ${selectedPitcherStat.pitcherName}` : ' — All Pitchers';
                return (
                  <div style={{ width: '100%', display: 'grid', gap: 20 }}>
                    <div className={styles.logSection} style={{ width: '100%' }}>
                      <p className={styles.logTitle} style={{ marginBottom: 12 }}>
                        {splitBy === 'targetSize' ? 'By Target Size' : 'By Pitch Type'}
                        {titleSuffix}
                      </p>
                      <div className={styles.logScroll}>
                        <table className={styles.logTable}>
                          <thead>
                            <tr>
                              <th>{splitBy === 'targetSize' ? 'Target Size' : 'Pitch Type'}</th>
                              <th>Pitches</th>
                              <th>In Zone%</th>
                              <th>Comp%</th>
                              {targetColumns.map((inches) => (
                                <th key={inches}>{inches}" Target Hit%</th>
                              ))}
                              <th>Avg Miss Distance</th>
                              <th>Most Common Miss Direction</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...rows, ...(allRow ? [allRow] : [])].map((row) => {
                              const severity = row.avgMissDistanceFt === null ? null : row.avgMissDistanceFt * 12 <= 6 ? 'good' : row.avgMissDistanceFt * 12 <= 14 ? 'warn' : 'bad';
                              const isAllRow = row.pitchType === 'All';
                              return (
                                <tr key={row.pitchType} style={isAllRow ? { fontWeight: 700, background: 'rgba(148, 163, 184, 0.06)' } : undefined}>
                                  <td>{row.pitchType}</td>
                                  <td>{row.pitchCount}</td>
                                  <td>{pctLabel(row.inZonePct)}</td>
                                  <td>{pctLabel(row.competitivePct)}</td>
                                  {targetColumns.map((inches) => (
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

                    {rows.length ? (
                      <div>
                        <p className={styles.logTitle} style={{ marginBottom: 4 }}>
                          Miss Direction by {splitBy === 'targetSize' ? 'Target Size' : 'Pitch Type'}
                        </p>
                        <p className={styles.zoneHint} style={{ textAlign: 'left', marginBottom: 12 }}>
                          Where misses land relative to the target — glove/arm side is from the pitcher&apos;s own throwing-hand perspective.
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 24 }}>
                          {rows.map((row) => (
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
                );
              })()
            )}
          </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

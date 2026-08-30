'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './intended-zone-panel.module.css';

const MISS_DIRECTION_ORDER = [
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

type MissDirection = (typeof MISS_DIRECTION_ORDER)[number];

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

type DirectionBreakdown = Record<MissDirection, number>;

type PitchTypeStat = {
  pitchType: string;
  pitchCount: number;
  avgMissDistanceFt: number | null;
  directionBreakdown: DirectionBreakdown;
  topMissDirection: MissDirection | null;
};

type PitcherStat = {
  pitcherName: string;
  pitchCount: number;
  avgMissDistanceFt: number | null;
  missDistanceStdDevFt: number | null;
  bestPitchType: string | null;
  directionBreakdown: DirectionBreakdown;
  topMissDirection: MissDirection | null;
};

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

function MiniDirectionGrid({ breakdown, size = 15 }: { breakdown: DirectionBreakdown; size?: number }) {
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

function DirectionHeatmap({ breakdown }: { breakdown: DirectionBreakdown }) {
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
      <p className={styles.zoneHint} style={{ marginTop: 10 }}>
        Where misses land relative to the target — glove/arm side is from the pitcher&apos;s own throwing-hand perspective.
      </p>
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
  const [sortColumn, setSortColumn] = useState<'pitchCount' | 'avgMissDistanceFt' | 'missDistanceStdDevFt'>('avgMissDistanceFt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPitcherRow, setSelectedPitcherRow] = useState<string | null>(null);
  const [selectedPitcherTypeStats, setSelectedPitcherTypeStats] = useState<PitchTypeStat[]>([]);
  const [selectedPitcherStatsLoading, setSelectedPitcherStatsLoading] = useState(false);
  const [selectedPitcherPitchType, setSelectedPitcherPitchType] = useState('All');

  const pitchTypesParam = useMemo(
    () => sidebarPitchTypes.filter((value) => value.trim() && value.trim().toLowerCase() !== 'all').join(','),
    [sidebarPitchTypes]
  );

  const loadPitcherStats = useCallback(async () => {
    if (!pitcherName) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pitcherName });
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
  }, [pitcherName, sidebarStartDate, sidebarEndDate, pitchTypesParam]);

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
        const params = new URLSearchParams({ pitcherName: selectedPitcherRow });
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
  }, [mode, selectedPitcherRow, sidebarStartDate, sidebarEndDate, pitchTypesParam]);

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

  const selectedPitcherStat = selectedPitcherRow ? leaderboard.find((p) => p.pitcherName === selectedPitcherRow) ?? null : null;
  const combinedLeaderboardBreakdown = useMemo(() => mergeBreakdowns(leaderboard.map((p) => p.directionBreakdown)), [leaderboard]);

  const selectedPitcherAllRow = selectedPitcherTypeStats.find((s) => s.pitchType === 'All') ?? null;
  const selectedPitcherPerTypeRows = selectedPitcherTypeStats.filter((s) => s.pitchType !== 'All');
  const selectedPitcherPitchTypeRow =
    selectedPitcherPitchType === 'All' ? selectedPitcherAllRow : selectedPitcherPerTypeRows.find((s) => s.pitchType === selectedPitcherPitchType) ?? null;

  function toggleSort(column: typeof sortColumn) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  function sortArrow(column: typeof sortColumn) {
    if (sortColumn !== column) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  }

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Stats</p>
          <h3 className={styles.title}>Intended Zone Results</h3>
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
                  Leaderboard (All Pitchers)
                </button>
              </div>
            </div>
          ) : null}
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
          <p className={styles.noPitcher}>No completed Intended Zone pitches found for this pitcher{sidebarStartDate || sidebarEndDate ? ' in this date range' : ''}.</p>
        ) : pitchTypeStats.length ? (
          <div className={styles.contentGrid}>
            <div className={styles.zoneCard}>
              <p className={styles.historyTitle} style={{ alignSelf: 'flex-start' }}>
                Overall Miss Direction
              </p>
              <DirectionHeatmap breakdown={allTypeRow?.directionBreakdown ?? mergeBreakdowns([])} />
              {allTypeRow ? (
                <div className={styles.summaryCard} style={{ width: '100%' }}>
                  <p className={styles.summaryTitle}>Overall</p>
                  <div className={styles.summaryStats}>
                    <span className={styles.summaryStat}>
                      Pitches: <strong>{allTypeRow.pitchCount}</strong>
                    </span>
                    <span className={styles.summaryStat}>
                      Avg Miss: <strong>{missDistanceLabel(allTypeRow.avgMissDistanceFt)}</strong>
                    </span>
                    <span className={styles.summaryStat}>
                      Most Common Miss: <strong>{allTypeRow.topMissDirection ? MISS_DIRECTION_SHORT_LABELS[allTypeRow.topMissDirection] : '—'}</strong>
                    </span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className={styles.logSection}>
              <p className={styles.logTitle}>By Pitch Type</p>
              <div className={styles.logScroll}>
                <table className={styles.logTable}>
                  <thead>
                    <tr>
                      <th>Pitch Type</th>
                      <th>Pitches</th>
                      <th>Avg Miss Distance</th>
                      <th>Most Common Miss Direction</th>
                      <th>Direction Spread</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perTypeRows.map((row) => {
                      const severity = row.avgMissDistanceFt === null ? null : row.avgMissDistanceFt * 12 <= 6 ? 'good' : row.avgMissDistanceFt * 12 <= 14 ? 'warn' : 'bad';
                      return (
                        <tr key={row.pitchType}>
                          <td>
                            <span className={styles.logPitchType}>{row.pitchType}</span>
                          </td>
                          <td>{row.pitchCount}</td>
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
          </div>
        ) : null
      ) : !loading && !leaderboard.length ? (
        <p className={styles.noPitcher}>No completed Intended Zone pitches found across any pitcher{sidebarStartDate || sidebarEndDate ? ' in this date range' : ''}.</p>
      ) : leaderboard.length ? (
        <div className={styles.contentGrid}>
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
                    Pitch Type
                  </label>
                  <select
                    id="iz-pitcher-pitch-type"
                    className={styles.select}
                    value={selectedPitcherPitchType}
                    onChange={(event) => setSelectedPitcherPitchType(event.target.value)}
                  >
                    <option value="All">All Pitch Types</option>
                    {selectedPitcherPerTypeRows.map((row) => (
                      <option key={row.pitchType} value={row.pitchType}>
                        {row.pitchType} ({row.pitchCount})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

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
                <p className={styles.logTitle}>All Pitch Types for {selectedPitcherStat.pitcherName}</p>
                <div className={styles.logScroll}>
                  <table className={styles.logTable}>
                    <thead>
                      <tr>
                        <th>Pitch Type</th>
                        <th>Pitches</th>
                        <th>Avg Miss Distance</th>
                        <th>Most Common Miss Direction</th>
                        <th>Direction Spread</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPitcherPerTypeRows.map((row) => {
                        const severity = row.avgMissDistanceFt === null ? null : row.avgMissDistanceFt * 12 <= 6 ? 'good' : row.avgMissDistanceFt * 12 <= 14 ? 'warn' : 'bad';
                        return (
                          <tr
                            key={row.pitchType}
                            onClick={() => setSelectedPitcherPitchType(row.pitchType)}
                            style={{ cursor: 'pointer', background: selectedPitcherPitchType === row.pitchType ? 'rgba(148, 163, 184, 0.08)' : undefined }}
                          >
                            <td>
                              <span className={styles.logPitchType}>{row.pitchType}</span>
                            </td>
                            <td>{row.pitchCount}</td>
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
      ) : null}
    </div>
  );
}

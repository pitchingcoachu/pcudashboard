'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ValdPlayerSnapshot } from '../../../lib/vald-forceplates';
import LeaderboardCorrelationModal from '../dashboard/leaderboard-correlation-modal';

type Snapshot = {
  fetchedAt: string;
  tenantId: string;
  players: ValdPlayerSnapshot[];
};

function metricKey(name: string, unit: string): string {
  return `${name}__${unit}`;
}

function chartPath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function testTypeColor(index: number): string {
  const palette = [
    'rgba(56,189,248,0.95)',
    'rgba(34,197,94,0.95)',
    'rgba(249,115,22,0.95)',
    'rgba(168,85,247,0.95)',
    'rgba(236,72,153,0.95)',
    'rgba(250,204,21,0.95)',
  ];
  return palette[index % palette.length];
}

function valueRange(values: number[]): { min: number; max: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

function toIsoDate(value: string): string {
  const parsed = new Date(String(value ?? '').trim());
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeName(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const firstLast = raw.includes(',')
    ? (() => {
        const [last, ...rest] = raw.split(',').map((x) => x.trim());
        const first = rest.join(' ').trim();
        return first && last ? `${first} ${last}` : raw;
      })()
    : raw;
  return firstLast
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export default function ForcePlatesDashboard({ snapshot }: { snapshot: Snapshot }) {
  const [activeTab, setActiveTab] = useState<'player' | 'leaderboard'>('player');
  const [selectedPlayer, setSelectedPlayer] = useState(snapshot.players[0]?.playerName ?? '');
  const [pointMode, setPointMode] = useState<'average' | 'rep'>('average');
  const player = useMemo(() => snapshot.players.find((entry) => entry.playerName === selectedPlayer) ?? null, [snapshot.players, selectedPlayer]);

  const metricOptions = useMemo(() => {
    if (!player) return [];
    const map = new Map<string, { name: string; unit: string; count: number }>();
    for (const row of player.metricRows) {
      const key = metricKey(row.metricName, row.metricUnit);
      const current = map.get(key) ?? { name: row.metricName, unit: row.metricUnit, count: 0 };
      current.count += 1;
      map.set(key, current);
    }
    const values = Array.from(map.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map((row) => ({ key: metricKey(row.name, row.unit), label: `${row.name}${row.unit ? ` (${row.unit})` : ''} • ${row.count}` }));
    return values;
  }, [player]);

  const [selectedMetricKey, setSelectedMetricKey] = useState('');
  const defaultMetricKey = useMemo(() => {
    if (!metricOptions.length) return '';
    const preferred = metricOptions.find((option) => option.key.toLowerCase().includes('jump height (flight time) in inches'));
    return preferred?.key ?? metricOptions[0].key;
  }, [metricOptions]);

  const metricRows = useMemo(() => {
    if (!player) return [];
    const activeMetric = selectedMetricKey || defaultMetricKey;
    const desiredType = pointMode === 'rep' ? 'rep' : 'average';
    return player.metricRows.filter(
      (row) =>
        metricKey(row.metricName, row.metricUnit) === activeMetric &&
        String(row.pointType ?? 'average') === desiredType
    );
  }, [player, selectedMetricKey, defaultMetricKey, pointMode]);

  const [selectedTestType, setSelectedTestType] = useState('All');
  const [dateRangeByPlayer, setDateRangeByPlayer] = useState<Record<string, { start: string; end: string }>>({});
  const [leaderStartDate, setLeaderStartDate] = useState('');
  const [leaderEndDate, setLeaderEndDate] = useState('');
  const [leaderVelocityRows, setLeaderVelocityRows] = useState<Array<{ name: string; fbVelo: number | null; veloMax: number | null }>>([]);
  const [leaderColumns, setLeaderColumns] = useState<string[]>(['CMJ', 'CMJMax', 'SJ', 'SJMax', 'RSI', 'FBvelo', 'VeloMax']);
  const [leaderColumnMenuOpen, setLeaderColumnMenuOpen] = useState(false);
  const [leaderSort, setLeaderSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'CMJ', dir: 'desc' });
  const [showLeaderboardCorrelation, setShowLeaderboardCorrelation] = useState(false);
  const testTypeOptions = useMemo(() => {
    if (!player) return ['All'];
    return ['All', ...Array.from(new Set(player.metricRows.map((row) => row.testType))).sort((a, b) => a.localeCompare(b))];
  }, [player]);
  const playerDateBounds = useMemo(() => {
    if (!player) return { min: '', max: '' };
    const dates = player.metricRows
      .map((row) => toIsoDate(String(row.dateTime ?? row.date)))
      .filter(Boolean)
      .sort();
    return { min: dates[0] ?? '', max: dates[dates.length - 1] ?? '' };
  }, [player]);
  const startDate = dateRangeByPlayer[selectedPlayer]?.start || playerDateBounds.min;
  const endDate = dateRangeByPlayer[selectedPlayer]?.end || playerDateBounds.max;

  const filteredRows = useMemo(
    () =>
      metricRows.filter((row) => {
        if (!(selectedTestType === 'All' || row.testType === selectedTestType)) return false;
        const rowIso = toIsoDate(String(row.dateTime ?? row.date));
        if (startDate && rowIso && rowIso < startDate) return false;
        if (endDate && rowIso && rowIso > endDate) return false;
        return true;
      }),
    [metricRows, selectedTestType, startDate, endDate]
  );

  const pointRows = useMemo(() => [...filteredRows], [filteredRows]);
  const metricTableRows = useMemo(() => {
    const groups = new Map<
      string,
      {
        date: string;
        testType: string;
        metricLabel: string;
        values: number[];
      }
    >();
    for (const row of filteredRows) {
      const metricLabel = `${row.metricName}${row.metricUnit ? ` (${row.metricUnit})` : ''}`;
      const key = `${row.testId}__${row.metricId}__${row.testType}__${row.date}__${metricLabel}`;
      const current = groups.get(key) ?? {
        date: row.date,
        testType: row.testType,
        metricLabel,
        values: [],
      };
      current.values.push(row.value);
      groups.set(key, current);
    }
    return Array.from(groups.values()).map((entry) => {
      const avg = entry.values.length ? entry.values.reduce((sum, value) => sum + value, 0) / entry.values.length : null;
      const max = entry.values.length ? Math.max(...entry.values) : null;
      return {
        date: entry.date,
        testType: entry.testType,
        metricLabel: entry.metricLabel,
        average: avg,
        max,
      };
    });
  }, [filteredRows]);
  const chartPoints = useMemo(() => {
    if (pointRows.length < 1) return [];
    const values = pointRows.map((row) => row.value);
    const range = valueRange(values);
    const uniqueDates = Array.from(new Set(pointRows.map((row) => row.date)));
    const dateIndexMap = new Map(uniqueDates.map((date, index) => [date, index]));
    return pointRows.map((row, index) => {
      const dateIndex = dateIndexMap.get(row.date) ?? 0;
      const x = 56 + (dateIndex / Math.max(1, uniqueDates.length - 1)) * 476;
      const y = 196 - ((row.value - range.min) / (range.max - range.min)) * 156;
      return { x, y, value: row.value, date: row.date, testType: row.testType };
    });
  }, [pointRows]);
  const seriesByTestType = useMemo(() => {
    const types = Array.from(new Set(chartPoints.map((point) => point.testType)));
    return types.map((type) => ({
      testType: type,
      points: chartPoints.filter((point) => point.testType === type),
    }));
  }, [chartPoints]);
  const yScale = useMemo(() => {
    const values = filteredRows.map((row) => row.value);
    return values.length ? valueRange(values) : { min: 0, max: 1 };
  }, [filteredRows]);
  const yTicks = useMemo(() => {
    const { min, max } = yScale;
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const ratio = i / steps;
      const value = max - ratio * (max - min);
      const y = 40 + ratio * 156;
      return { y, value };
    });
  }, [yScale]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [playerColumns, setPlayerColumns] = useState<string[]>(['CMJ', 'CMJMax', 'SJ', 'SJMax', 'RSI', 'FBvelo', 'VeloMax']);
  const [playerColumnMenuOpen, setPlayerColumnMenuOpen] = useState(false);
  const [playerSort, setPlayerSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'CMJ', dir: 'desc' });

  const latest = filteredRows[filteredRows.length - 1] ?? null;
  const avg = filteredRows.length ? filteredRows.reduce((sum, row) => sum + row.value, 0) / filteredRows.length : null;

  const leaderboardBounds = useMemo(() => {
    const dates = snapshot.players
      .flatMap((entry) => entry.metricRows.map((row) => toIsoDate(String(row.dateTime ?? row.date))))
      .filter(Boolean)
      .sort();
    return { min: dates[0] ?? '', max: dates[dates.length - 1] ?? '' };
  }, [snapshot.players]);

  useEffect(() => {
    if (!leaderStartDate && leaderboardBounds.min) setLeaderStartDate(leaderboardBounds.min);
    if (!leaderEndDate && leaderboardBounds.max) setLeaderEndDate(leaderboardBounds.max);
  }, [leaderStartDate, leaderEndDate, leaderboardBounds.min, leaderboardBounds.max]);

  const leaderboardMetricOptions = useMemo(() => {
    const metricMap = new Map<string, string>();
    for (const playerEntry of snapshot.players) {
      for (const row of playerEntry.metricRows) {
        if (String(row.pointType ?? 'average') !== 'average') continue;
        const key = `metric:${metricKey(row.metricName, row.metricUnit)}`;
        if (!metricMap.has(key)) metricMap.set(key, `${row.metricName}${row.metricUnit ? ` (${row.metricUnit})` : ''}`);
      }
    }
    return [
      { key: 'CMJ', label: 'CMJ' },
      { key: 'SJ', label: 'SJ' },
      { key: 'CMJMax', label: 'CMJ Max' },
      { key: 'SJMax', label: 'SJ Max' },
      { key: 'RSI', label: 'RSI' },
      { key: 'SQ', label: 'SQ' },
      { key: 'FBvelo', label: 'FBvelo' },
      { key: 'VeloMax', label: 'VeloMax' },
      ...Array.from(metricMap.entries())
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [snapshot.players]);

  const playerTableMetricOptions = leaderboardMetricOptions;

  useEffect(() => {
    setLeaderColumns((current) => current.filter((key) => leaderboardMetricOptions.some((opt) => opt.key === key)));
  }, [leaderboardMetricOptions]);

  useEffect(() => {
    setPlayerColumns((current) => current.filter((key) => playerTableMetricOptions.some((opt) => opt.key === key)));
  }, [playerTableMetricOptions]);

  useEffect(() => {
    if (!leaderStartDate || !leaderEndDate) return;
    let cancelled = false;
    const loadVelocity = async () => {
      try {
        const params = new URLSearchParams({ startDate: leaderStartDate, endDate: leaderEndDate });
        const response = await fetch(`/api/player/force-plate-velo?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as {
          rows?: Array<{ name: string; fbVelo: number | null; veloMax: number | null }>;
        };
        if (!response.ok) throw new Error('Failed');
        if (cancelled) return;
        setLeaderVelocityRows(Array.isArray(payload.rows) ? payload.rows : []);
      } catch {
        if (cancelled) return;
        setLeaderVelocityRows([]);
      }
    };
    void loadVelocity();
    return () => {
      cancelled = true;
    };
  }, [leaderStartDate, leaderEndDate]);

  const resolveVeloForPlayer = (
    playerName: string,
    rows: Array<{ name: string; fbVelo: number | null; veloMax: number | null }>
  ): { fbVelo: number | null; veloMax: number | null } => {
    const exact = rows.find((row) => normalizeName(row.name) === normalizeName(playerName));
    if (exact) return { fbVelo: exact.fbVelo, veloMax: exact.veloMax };
    const targetTokens = normalizeName(playerName).split(' ').filter(Boolean);
    if (!targetTokens.length) return { fbVelo: null, veloMax: null };
    const targetLast = targetTokens[targetTokens.length - 1];
    const fuzzy = rows.find((row) => {
      const rowNorm = normalizeName(row.name);
      if (!rowNorm) return false;
      const rowTokens = rowNorm.split(' ').filter(Boolean);
      const rowLast = rowTokens[rowTokens.length - 1];
      if (!rowLast || rowLast !== targetLast) return false;
      return rowNorm.includes(targetTokens[0]) || normalizeName(playerName).includes(rowTokens[0] ?? '');
    });
    return fuzzy ? { fbVelo: fuzzy.fbVelo, veloMax: fuzzy.veloMax } : { fbVelo: null, veloMax: null };
  };

  const leaderboardRows = useMemo(() => {
    const inRange = (rowDate: string) =>
      (!leaderStartDate || rowDate >= leaderStartDate) && (!leaderEndDate || rowDate <= leaderEndDate);
    const preferredJumpMetric = (rows: ValdPlayerSnapshot['metricRows']) => {
      const keys = Array.from(new Set(rows.map((row) => metricKey(row.metricName, row.metricUnit))));
      const pick =
        keys.find((key) => key.toLowerCase().includes('jump height (flight time)') && key.toLowerCase().includes('inch')) ??
        keys.find((key) => key.toLowerCase().includes('jump height') && key.toLowerCase().includes('inch')) ??
        keys.find((key) => key.toLowerCase().includes('jump height')) ??
        '';
      return pick;
    };
    return snapshot.players.map((playerEntry) => {
      const avgRows = playerEntry.metricRows.filter((row) => String(row.pointType ?? 'average') === 'average');
      const ranged = avgRows.filter((row) => {
        const iso = toIsoDate(String(row.dateTime ?? row.date));
        return iso ? inRange(iso) : false;
      });
      const byMetric = new Map<string, number[]>();
      for (const row of ranged) {
        const key = metricKey(row.metricName, row.metricUnit);
        const list = byMetric.get(key) ?? [];
        list.push(row.value);
        byMetric.set(key, list);
      }
      const metricAverages = Object.fromEntries(
        Array.from(byMetric.entries()).map(([key, values]) => [key, values.length ? values.reduce((a, b) => a + b, 0) / values.length : null])
      ) as Record<string, number | null>;
      const jumpKey = preferredJumpMetric(ranged);
      const cmjRows = ranged.filter((row) => row.testType.toUpperCase() === 'CMJ' && metricKey(row.metricName, row.metricUnit) === jumpKey);
      const sqRows = ranged.filter((row) => row.testType.toUpperCase() === 'SQ' && metricKey(row.metricName, row.metricUnit) === jumpKey);
      const sjRows = ranged.filter((row) => ['SJ', 'SQUAT JUMP'].includes(row.testType.toUpperCase()) && metricKey(row.metricName, row.metricUnit) === jumpKey);
      const cmj = cmjRows.length ? cmjRows.reduce((sum, row) => sum + row.value, 0) / cmjRows.length : null;
      const sq = sqRows.length ? sqRows.reduce((sum, row) => sum + row.value, 0) / sqRows.length : null;
      const sj = sjRows.length ? sjRows.reduce((sum, row) => sum + row.value, 0) / sjRows.length : null;
      const cmjMax = cmjRows.length ? Math.max(...cmjRows.map((row) => row.value)) : null;
      const sjMax = sjRows.length ? Math.max(...sjRows.map((row) => row.value)) : null;
      const rsiKey = Array.from(byMetric.keys()).find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '').includes('rsimodified'));
      const rsiValues = rsiKey ? (byMetric.get(rsiKey) ?? []) : [];
      const rsiModified = rsiValues.length ? rsiValues.reduce((a, b) => a + b, 0) / rsiValues.length : null;
      const velo = resolveVeloForPlayer(playerEntry.playerName, leaderVelocityRows);
      return {
        playerName: playerEntry.playerName,
        cmj,
        sj,
        cmjMax,
        sjMax,
        rsiModified,
        sq,
        metricAverages,
        fbVelo: velo.fbVelo,
        veloMax: velo.veloMax,
      };
    });
  }, [snapshot.players, leaderStartDate, leaderEndDate, leaderVelocityRows]);

  const playerAggregateRows = useMemo(() => {
    if (!player) return [];
    const inRange = (rowDate: string) => (!startDate || rowDate >= startDate) && (!endDate || rowDate <= endDate);
    const preferredJumpMetric = (rows: typeof player.metricRows) => {
      const keys = Array.from(new Set(rows.map((row) => metricKey(row.metricName, row.metricUnit))));
      return (
        keys.find((key) => key.toLowerCase().includes('jump height (flight time)') && key.toLowerCase().includes('inch')) ??
        keys.find((key) => key.toLowerCase().includes('jump height') && key.toLowerCase().includes('inch')) ??
        keys.find((key) => key.toLowerCase().includes('jump height')) ??
        ''
      );
    };
    const avgRows = player.metricRows.filter((row) => String(row.pointType ?? 'average') === 'average');
    const ranged = avgRows.filter((row) => {
      const iso = toIsoDate(String(row.dateTime ?? row.date));
      return iso ? inRange(iso) : false;
    });
    const byMetric = new Map<string, number[]>();
    for (const row of ranged) {
      const mk = metricKey(row.metricName, row.metricUnit);
      const list = byMetric.get(mk) ?? [];
      list.push(row.value);
      byMetric.set(mk, list);
    }
    const metricAverages = Object.fromEntries(
      Array.from(byMetric.entries()).map(([key, values]) => [key, values.length ? values.reduce((a, b) => a + b, 0) / values.length : null])
    ) as Record<string, number | null>;
    const jumpKey = preferredJumpMetric(ranged);
    const cmjRows = ranged.filter((row) => row.testType.toUpperCase() === 'CMJ' && metricKey(row.metricName, row.metricUnit) === jumpKey);
    const sqRows = ranged.filter((row) => row.testType.toUpperCase() === 'SQ' && metricKey(row.metricName, row.metricUnit) === jumpKey);
    const sjRows = ranged.filter((row) => ['SJ', 'SQUAT JUMP'].includes(row.testType.toUpperCase()) && metricKey(row.metricName, row.metricUnit) === jumpKey);
    const cmj = cmjRows.length ? cmjRows.reduce((sum, row) => sum + row.value, 0) / cmjRows.length : null;
    const sq = sqRows.length ? sqRows.reduce((sum, row) => sum + row.value, 0) / sqRows.length : null;
    const sj = sjRows.length ? sjRows.reduce((sum, row) => sum + row.value, 0) / sjRows.length : null;
    const cmjMax = cmjRows.length ? Math.max(...cmjRows.map((row) => row.value)) : null;
    const sjMax = sjRows.length ? Math.max(...sjRows.map((row) => row.value)) : null;
    const rsiKey = Array.from(byMetric.keys()).find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '').includes('rsimodified'));
    const rsiValues = rsiKey ? (byMetric.get(rsiKey) ?? []) : [];
    const rsiModified = rsiValues.length ? rsiValues.reduce((a, b) => a + b, 0) / rsiValues.length : null;
    const velo = resolveVeloForPlayer(player.playerName, leaderVelocityRows);
    return [{
      cmj,
      sj,
      cmjMax,
      sjMax,
      rsiModified,
      sq,
      metricAverages,
      fbVelo: velo.fbVelo,
      veloMax: velo.veloMax,
    }];
  }, [player, startDate, endDate, leaderVelocityRows]);

  const sortedLeaderboardRows = useMemo(() => {
    const valueFor = (row: (typeof leaderboardRows)[number], column: string): number | string | null => {
      if (column === 'Player') return row.playerName;
      if (column === 'CMJ') return row.cmj;
      if (column === 'SJ') return row.sj;
      if (column === 'CMJMax') return row.cmjMax;
      if (column === 'SJMax') return row.sjMax;
      if (column === 'RSI') return row.rsiModified;
      if (column === 'SQ') return row.sq;
      if (column === 'FBvelo') return row.fbVelo;
      if (column === 'VeloMax') return row.veloMax;
      if (column.startsWith('metric:')) return row.metricAverages[column.slice('metric:'.length)] ?? null;
      return null;
    };
    const sorted = [...leaderboardRows].sort((a, b) => {
      const av = valueFor(a, leaderSort.key);
      const bv = valueFor(b, leaderSort.key);
      if (typeof av === 'string' || typeof bv === 'string') {
        const aText = String(av ?? '');
        const bText = String(bv ?? '');
        const cmp = aText.localeCompare(bText);
        return leaderSort.dir === 'asc' ? cmp : -cmp;
      }
      const aNum = typeof av === 'number' ? av : Number.NEGATIVE_INFINITY;
      const bNum = typeof bv === 'number' ? bv : Number.NEGATIVE_INFINITY;
      const cmp = aNum - bNum;
      return leaderSort.dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [leaderSort, leaderboardRows]);

  const correlationColumns = useMemo(
    () => ['Player', ...leaderColumns.map((column) => leaderboardMetricOptions.find((opt) => opt.key === column)?.label ?? column)],
    [leaderColumns, leaderboardMetricOptions]
  );

  const correlationRows = useMemo(() => {
    return leaderboardRows.map((row) => {
      const out: Record<string, string | number | null> = { Player: row.playerName };
      for (const column of leaderColumns) {
        const label = leaderboardMetricOptions.find((opt) => opt.key === column)?.label ?? column;
        let value: number | null = null;
        if (column === 'CMJ') value = row.cmj;
        else if (column === 'SJ') value = row.sj;
        else if (column === 'CMJMax') value = row.cmjMax;
        else if (column === 'SJMax') value = row.sjMax;
        else if (column === 'RSI') value = row.rsiModified;
        else if (column === 'SQ') value = row.sq;
        else if (column === 'FBvelo') value = row.fbVelo;
        else if (column === 'VeloMax') value = row.veloMax;
        else if (column.startsWith('metric:')) value = row.metricAverages[column.slice('metric:'.length)] ?? null;
        out[label] = value;
      }
      return out;
    });
  }, [leaderboardRows, leaderColumns, leaderboardMetricOptions]);

  return (
    <div className="portal-admin-stack">
      <article className="portal-admin-card">
        <div className="portal-schedule-view-switch" role="group" aria-label="Force plate view">
          <button
            type="button"
            className={`btn ${activeTab === 'player' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('player')}
          >
            Player Data
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'leaderboard' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('leaderboard')}
          >
            Leaderboard
          </button>
        </div>
      </article>

      {activeTab === 'player' ? (
      <article className="portal-admin-card">
        <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(6, minmax(180px, 1fr))' }}>
          <label>
            Player
            <select value={selectedPlayer} onChange={(event) => setSelectedPlayer(event.target.value)}>
              {snapshot.players.map((entry) => (
                <option key={entry.playerName} value={entry.playerName}>
                  {entry.playerName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Metric
            <select value={selectedMetricKey} onChange={(event) => setSelectedMetricKey(event.target.value)}>
              <option value="">Jump Height (Flight Time) in Inches (default)</option>
              {metricOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Chart Points
            <select value={pointMode} onChange={(event) => setPointMode(event.target.value === 'rep' ? 'rep' : 'average')}>
              <option value="average">Average by Test</option>
              <option value="rep">Every Rep</option>
            </select>
          </label>
          <label>
            Test Type
            <select value={selectedTestType} onChange={(event) => setSelectedTestType(event.target.value)}>
              {testTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start Date
            <input
              type="date"
              value={startDate}
              min={playerDateBounds.min || undefined}
              max={endDate || playerDateBounds.max || undefined}
              onChange={(event) =>
                setDateRangeByPlayer((current) => ({
                  ...current,
                  [selectedPlayer]: { start: event.target.value, end: endDate },
                }))
              }
            />
          </label>
          <label>
            End Date
            <input
              type="date"
              value={endDate}
              min={startDate || playerDateBounds.min || undefined}
              max={playerDateBounds.max || undefined}
              onChange={(event) =>
                setDateRangeByPlayer((current) => ({
                  ...current,
                  [selectedPlayer]: { start: startDate, end: event.target.value },
                }))
              }
            />
          </label>
        </div>
      </article>
      ) : null}

      {activeTab === 'player' ? (
      <article className="portal-admin-card">
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <p style={{ margin: 0 }}>
            <strong>Data points:</strong> {filteredRows.length}
          </p>
          <p style={{ margin: 0 }}>
            <strong>Latest:</strong> {latest ? `${latest.value.toFixed(1)}${latest.metricUnit ? ` ${latest.metricUnit}` : ''}` : '--'}
          </p>
          <p style={{ margin: 0 }}>
            <strong>Average:</strong> {avg !== null ? `${avg.toFixed(1)}${latest?.metricUnit ? ` ${latest.metricUnit}` : ''}` : '--'}
          </p>
        </div>
        {chartPoints.length > 0 ? (
          <div style={{ marginTop: 10, display: 'grid', gap: 12, gridTemplateColumns: selectedTestType === 'All' && seriesByTestType.length > 1 ? 'minmax(0, 1fr) 160px' : '1fr' }}>
            <svg viewBox="0 0 560 220" width="100%" height="240" role="img" aria-label="Metric trend chart" className="portal-force-plate-chart">
              <rect x="0" y="0" width="560" height="220" fill="rgba(2,6,23,0.4)" rx="10" />
              <line x1="56" y1="196" x2="532" y2="196" stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
              <line x1="56" y1="20" x2="56" y2="196" stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
              {yTicks.map((tick, idx) => (
                <g key={`y-tick-${idx}`}>
                  <line x1="56" y1={tick.y} x2="532" y2={tick.y} stroke="rgba(148,163,184,0.14)" strokeWidth="1" />
                  <text className="portal-force-plate-chart-tick" x="52" y={tick.y + 3} fill="rgba(203,213,225,0.88)" fontSize="9" textAnchor="end">
                    {tick.value.toFixed(1)}
                  </text>
                </g>
              ))}
              <text className="portal-force-plate-chart-axis-label" x="294" y="214" fill="rgba(203,213,225,0.9)" fontSize="10" textAnchor="middle">
                Date
              </text>
              <text className="portal-force-plate-chart-axis-label" x="14" y="108" fill="rgba(203,213,225,0.9)" fontSize="10" textAnchor="middle" transform="rotate(-90, 14, 108)">
                Value
              </text>
              {seriesByTestType.map((series, index) =>
                series.points.length > 1 ? (
                  <path key={`series-${series.testType}`} d={chartPath(series.points)} fill="none" stroke={testTypeColor(index)} strokeWidth="2.5" />
                ) : null
              )}
              {chartPoints.map((point, index) => (
                <circle
                  key={`${point.date}-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={hoverIndex === index ? '5' : '3.5'}
                  fill={testTypeColor(seriesByTestType.findIndex((series) => series.testType === point.testType))}
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex((current) => (current === index ? null : current))}
                />
              ))}
              {hoverIndex !== null && chartPoints[hoverIndex] ? (
                (() => {
                  const point = chartPoints[hoverIndex];
                  const row = filteredRows[hoverIndex];
                  const tooltipX = Math.min(410, Math.max(80, point.x + 12));
                  const tooltipY = Math.max(18, point.y - 58);
                  const valueText = `${point.value.toFixed(1)}${row?.metricUnit ? ` ${row.metricUnit}` : ''}`;
                  return (
                    <g>
                      <rect x={tooltipX} y={tooltipY} width="140" height="46" rx="7" fill="rgba(15,23,42,0.95)" stroke="rgba(59,130,246,0.5)" strokeWidth="1" />
                      <text x={tooltipX + 8} y={tooltipY + 13} fill="#e2e8f0" fontSize="9">
                        {selectedPlayer}
                      </text>
                      <text x={tooltipX + 8} y={tooltipY + 26} fill="#cbd5e1" fontSize="9">
                        {point.date}
                      </text>
                      <text x={tooltipX + 8} y={tooltipY + 39} fill="#7dd3fc" fontSize="9">
                        {valueText}
                      </text>
                    </g>
                  );
                })()
              ) : null}
              {chartPoints.length > 0 ? (
                <>
                  <text className="portal-force-plate-chart-edge-date" x={56} y={208} fill="rgba(203,213,225,0.8)" fontSize="9" textAnchor="start">
                    {chartPoints[0]?.date ?? ''}
                  </text>
                  {(chartPoints[0]?.date ?? '') !== (chartPoints[chartPoints.length - 1]?.date ?? '') ? (
                    <text className="portal-force-plate-chart-edge-date" x={532} y={208} fill="rgba(203,213,225,0.8)" fontSize="9" textAnchor="end">
                      {chartPoints[chartPoints.length - 1]?.date ?? ''}
                    </text>
                  ) : null}
                </>
              ) : null}
            </svg>
            {selectedTestType === 'All' && seriesByTestType.length > 1 ? (
              <div style={{ alignSelf: 'start', display: 'grid', gap: 6, paddingTop: 8 }}>
                {seriesByTestType.map((series, index) => (
                  <div key={`legend-${series.testType}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: testTypeColor(index), display: 'inline-block' }} />
                    <span className="portal-force-plate-chart-legend-text" style={{ color: 'rgba(226,232,240,0.92)', fontSize: 12 }}>{series.testType}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="portal-muted-text" style={{ marginTop: 12 }}>
            Not enough metric values for a trend line yet.
          </p>
        )}
      </article>
      ) : null}

      {activeTab === 'player' ? (
      <article className="portal-admin-card">
        <div className="portal-row-between">
          <h4 style={{ marginTop: 0 }}>Player Metrics</h4>
          <div style={{ minWidth: 220, position: 'relative' }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'space-between' }}
              onClick={() => setPlayerColumnMenuOpen((current) => !current)}
            >
              {playerColumns.length ? `${playerColumns.length} selected` : 'Select columns'}
            </button>
            {playerColumnMenuOpen ? (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  right: 0,
                  maxHeight: 260,
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  background: 'var(--panel-strong)',
                  padding: '0.5rem',
                  zIndex: 25,
                  display: 'grid',
                  gap: '0.35rem',
                }}
              >
                {playerTableMetricOptions.map((option) => {
                  const checked = playerColumns.includes(option.key);
                  return (
                    <label
                      key={`player-col-${option.key}`}
                      style={{ display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr)', gap: 8, alignItems: 'center', fontSize: '0.84rem', lineHeight: 1.15, minHeight: 22 }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const isChecked = event.target.checked;
                          setPlayerColumns((current) => {
                            if (isChecked) return current.includes(option.key) ? current : [...current, option.key];
                            return current.filter((key) => key !== option.key);
                          });
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
        {playerAggregateRows.length ? (
          <table className="portal-table">
            <thead>
              <tr>
                {playerColumns.map((column) => {
                  const option = playerTableMetricOptions.find((opt) => opt.key === column);
                  return (
                    <th
                      key={`player-metric-head-${column}`}
                      style={{
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                        background: playerSort.key === column ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : undefined,
                        color: playerSort.key === column ? '#fff' : undefined,
                      }}
                      onClick={() =>
                        setPlayerSort((current) =>
                          current.key === column
                            ? { key: column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                            : { key: column, dir: 'desc' }
                        )
                      }
                    >
                      <span style={{ userSelect: 'none' }}>
                        {option?.label ?? column}
                        {playerSort.key === column ? ` ${playerSort.dir === 'asc' ? '↑' : '↓'}` : ''}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {playerAggregateRows.map((row, rowIndex) => (
                <tr key={`player-aggregate-row-${rowIndex}`}>
                  {playerColumns.map((column) => {
                    let value: number | null = null;
                    if (column === 'CMJ') value = row.cmj;
                    else if (column === 'SJ') value = row.sj;
                    else if (column === 'CMJMax') value = row.cmjMax;
                    else if (column === 'SJMax') value = row.sjMax;
                    else if (column === 'RSI') value = row.rsiModified;
                    else if (column === 'SQ') value = row.sq;
                    else if (column === 'FBvelo') value = row.fbVelo;
                    else if (column === 'VeloMax') value = row.veloMax;
                    else if (column.startsWith('metric:')) value = row.metricAverages[column.slice('metric:'.length)] ?? null;
                    const isActiveSortColumn = playerSort.key === column;
                    return (
                      <td
                        key={`player-aggregate-cell-${rowIndex}-${column}`}
                        style={
                          isActiveSortColumn
                            ? { background: 'rgba(var(--portal-accent-rgb, 59,130,246), 0.18)', color: '#fff', fontWeight: 700, textAlign: 'center' }
                            : { textAlign: 'center' }
                        }
                      >
                        {value === null ? '-' : value.toFixed(1)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="portal-muted-text">No metric rows available for this filter.</p>
        )}
      </article>
      ) : null}

      {activeTab === 'leaderboard' ? (
      <article className="portal-admin-card">
        <div className="portal-row-between">
          <h3 style={{ marginTop: 0 }}>Leaderboard</h3>
          <button type="button" className="btn btn-ghost" onClick={() => setShowLeaderboardCorrelation(true)}>
            View Chart
          </button>
        </div>
        <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))' }}>
          <label>
            Start Date
            <input
              type="date"
              value={leaderStartDate}
              onChange={(event) => setLeaderStartDate(event.target.value)}
            />
          </label>
          <label>
            End Date
            <input
              type="date"
              value={leaderEndDate}
              onChange={(event) => setLeaderEndDate(event.target.value)}
            />
          </label>
          <label>
            Columns
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ width: '100%', justifyContent: 'space-between' }}
                onClick={() => setLeaderColumnMenuOpen((current) => !current)}
              >
                {leaderColumns.length ? `${leaderColumns.length} selected` : 'Select columns'}
              </button>
              {leaderColumnMenuOpen ? (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    left: 0,
                    right: 0,
                    maxHeight: 260,
                    overflowY: 'auto',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    background: 'var(--panel-strong)',
                    padding: '0.5rem',
                    zIndex: 25,
                    display: 'grid',
                    gap: '0.35rem',
                  }}
                >
                  {leaderboardMetricOptions.map((option) => {
                    const checked = leaderColumns.includes(option.key);
                    return (
                      <label
                        key={`leader-col-${option.key}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '16px minmax(0, 1fr)',
                          gap: 8,
                          alignItems: 'center',
                          fontSize: '0.84rem',
                          lineHeight: 1.15,
                          minHeight: 22,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const isChecked = event.target.checked;
                            setLeaderColumns((current) => {
                              if (isChecked) return current.includes(option.key) ? current : [...current, option.key];
                              return current.filter((key) => key !== option.key);
                            });
                          }}
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </label>
        </div>
        <table className="portal-table">
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  background: leaderSort.key === 'Player' ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : undefined,
                  color: leaderSort.key === 'Player' ? '#fff' : undefined,
                }}
                onClick={() =>
                  setLeaderSort((current) =>
                    current.key === 'Player'
                      ? { key: 'Player', dir: current.dir === 'asc' ? 'desc' : 'asc' }
                      : { key: 'Player', dir: 'asc' }
                  )
                }
              >
                <span style={{ userSelect: 'none' }}>
                  Player
                  {leaderSort.key === 'Player' ? ` ${leaderSort.dir === 'asc' ? '↑' : '↓'}` : ''}
                </span>
              </th>
              {leaderColumns.map((column) => {
                const option = leaderboardMetricOptions.find((opt) => opt.key === column);
                return (
                  <th
                    key={`head-${column}`}
                    style={{
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      background: leaderSort.key === column ? 'rgb(var(--portal-accent-rgb, 59,130,246))' : undefined,
                      color: leaderSort.key === column ? '#fff' : undefined,
                    }}
                    onClick={() =>
                      setLeaderSort((current) =>
                        current.key === column
                          ? { key: column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                          : { key: column, dir: 'desc' }
                      )
                    }
                  >
                    <span style={{ userSelect: 'none' }}>
                      {option?.label ?? column}
                      {leaderSort.key === column ? ` ${leaderSort.dir === 'asc' ? '↑' : '↓'}` : ''}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedLeaderboardRows.map((row) => (
              <tr key={`leader-${row.playerName}`}>
                <td
                  style={
                    leaderSort.key === 'Player'
                      ? {
                          background: 'rgba(var(--portal-accent-rgb, 59,130,246), 0.18)',
                          color: '#fff',
                          fontWeight: 700,
                          textAlign: 'center',
                        }
                      : { textAlign: 'center' }
                  }
                >
                  {row.playerName}
                </td>
                {leaderColumns.map((column) => {
                  let value: number | null = null;
                  if (column === 'CMJ') value = row.cmj;
                  else if (column === 'SJ') value = row.sj;
                  else if (column === 'CMJMax') value = row.cmjMax;
                  else if (column === 'SJMax') value = row.sjMax;
                  else if (column === 'RSI') value = row.rsiModified;
                  else if (column === 'SQ') value = row.sq;
                  else if (column === 'FBvelo') value = row.fbVelo;
                  else if (column === 'VeloMax') value = row.veloMax;
                  else if (column.startsWith('metric:')) value = row.metricAverages[column.slice('metric:'.length)] ?? null;
                  const isActiveSortColumn = leaderSort.key === column;
                  return (
                    <td
                      key={`val-${row.playerName}-${column}`}
                      style={
                        isActiveSortColumn
                          ? {
                              background: 'rgba(var(--portal-accent-rgb, 59,130,246), 0.18)',
                              color: '#fff',
                              fontWeight: 700,
                              textAlign: 'center',
                            }
                          : { textAlign: 'center' }
                      }
                    >
                      {value === null ? '-' : value.toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </article>
      ) : null}

      <LeaderboardCorrelationModal
        open={showLeaderboardCorrelation}
        onClose={() => setShowLeaderboardCorrelation(false)}
        title="Force Plate Leaderboard Correlation"
        columns={correlationColumns}
        rows={correlationRows}
        viewByLabel="Player"
        primaryColumnName="Player"
        siteLogoSrc="/vald.webp"
        siteLogoAlt="VALD"
      />
    </div>
  );
}

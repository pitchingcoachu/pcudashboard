'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatTableDisplayValue } from '../../../lib/table-sort';
import { formatPlayerPlanGoalSummary } from '../../../lib/player-plan-goal-display';
import { pitchLocationLabel as inZoneLabel } from '../../../lib/pitch-location';
import type { PlayerPlanGoalRow } from '../../../lib/training-db';

type GoalSlot = 1 | 2 | 3;
type GoalChartState = {
  loading: boolean;
  error: string;
  points: Array<Record<string, unknown>>;
};

type ParsedGoal = {
  slotIndex: GoalSlot;
  category: string;
  goalDescription: string;
  createdAt: string | null;
  objectiveText: string;
  stuffType: string;
  movementAxis: string;
  executionStat: string;
  comparator: 'Greater Than' | 'Less Than';
  targetValue: string;
  chartType: string;
  startDate: string;
  endDate: string;
  pitchTypes: string[];
  ballTypes: string[];
  pitchResults: string[];
  countOptions: string[];
  afterCountOptions: string[];
  teams: string[];
  hand: string;
  batterSide: string;
  sessionType: string;
};

type ProfilePlanGoalsPanelProps = {
  playerId: number;
  playerName: string;
  goals: PlayerPlanGoalRow[];
  canEditGoals: boolean;
};

function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeExecutionStatKey(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/%/g, 'pct')
    .replace(/[+\s\-_/]/g, '');
}

function formatMdyy(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${String(date.getUTCFullYear()).slice(-2)}`;
}

function formatTimestampDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${String(date.getUTCFullYear()).slice(-2)}`;
}

function valueList(value: unknown): string[] {
  return Array.isArray(value) && value.length ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : ['All'];
}

function parseGoal(row: PlayerPlanGoalRow): ParsedGoal | null {
  const raw = String(row.goalDescription ?? '').trim();
  if (!raw) return null;
  const base: ParsedGoal = {
    slotIndex: row.slotIndex,
    category: row.category === 'Command' ? 'Execution' : (row.category ?? ''),
    goalDescription: raw,
    createdAt: row.createdAt,
    objectiveText: raw,
    stuffType: '',
    movementAxis: '',
    executionStat: '',
    comparator: 'Greater Than',
    targetValue: '',
    chartType: 'Trend',
    startDate: '',
    endDate: '',
    pitchTypes: ['All'],
    ballTypes: ['All'],
    pitchResults: ['All'],
    countOptions: ['All'],
    afterCountOptions: ['All'],
    teams: ['All'],
    hand: 'All',
    batterSide: 'All',
    sessionType: 'Season',
  };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed?.schema !== 'pcu_goal_v2') return base;
    const filters = typeof parsed.filters === 'object' && parsed.filters ? (parsed.filters as Record<string, unknown>) : {};
    return {
      ...base,
      category: String(parsed.category ?? base.category),
      objectiveText: String(parsed.objectiveText ?? ''),
      stuffType: String(parsed.stuffType ?? ''),
      movementAxis: String(parsed.movementAxis ?? ''),
      executionStat: String(parsed.executionStat ?? ''),
      comparator: parsed.comparator === 'Less Than' ? 'Less Than' : 'Greater Than',
      targetValue:
        parsed.targetValue === null || parsed.targetValue === undefined || Number.isNaN(Number(parsed.targetValue))
          ? ''
          : String(parsed.targetValue),
      chartType: String(parsed.chartType ?? 'Trend') || 'Trend',
      startDate: String(filters.startDate ?? ''),
      endDate: String(filters.endDate ?? ''),
      pitchTypes: valueList(filters.pitchTypes),
      ballTypes: valueList(filters.ballTypes),
      pitchResults: valueList(filters.pitchResults),
      countOptions: valueList(filters.countOptions),
      afterCountOptions: valueList(filters.afterCountOptions),
      teams: valueList(filters.teams),
      hand: String(filters.hand ?? 'All') || 'All',
      batterSide: String(filters.batterSide ?? 'All') || 'All',
      sessionType: String(filters.sessionType ?? 'Season') || 'Season',
    };
  } catch {
    return base;
  }
}

function goalDomain(goal: ParsedGoal): 'pitching' | 'hitting' {
  return goal.category === 'Hitting Stats' ? 'hitting' : 'pitching';
}

function isChartCapableGoal(goal: ParsedGoal): boolean {
  return goal.category === 'Stuff' || goal.category === 'Execution' || goal.category === 'Hitting Stats';
}

function metricLabel(goal: ParsedGoal): string {
  if (goal.category === 'Stuff') {
    if (goal.stuffType === 'Movement') return goal.movementAxis || 'Movement';
    return goal.stuffType || 'Stuff';
  }
  return goal.executionStat || 'Stat';
}

function metricValue(goal: ParsedGoal, point: Record<string, unknown>): number | null {
  const num = (...keys: string[]) => {
    for (const key of keys) {
      const value = toNum(point[key]);
      if (value !== null) return value;
    }
    return null;
  };
  if (goal.category === 'Stuff') {
    if (goal.stuffType === 'Velocity') return num('velo', 'rel_speed');
    if (goal.stuffType === 'Movement') {
      if (goal.movementAxis === 'IVB') return num('ivb');
      if (goal.movementAxis === 'HB') return num('hb');
      if (goal.movementAxis === 'IVB+HB') {
        const ivb = num('ivb');
        const hb = num('hb');
        if (ivb === null || hb === null) return null;
        return (ivb + hb) / 2;
      }
    }
    return num('velo', 'rel_speed');
  }
  const key = normalizeExecutionStatKey(goal.executionStat);
  if (key === 'velocity' || key === 'velo') return num('velo', 'rel_speed');
  if (key === 'max') return num('velo', 'rel_speed');
  if (key === 'ivb') return num('ivb');
  if (key === 'hb') return num('hb');
  if (key === 'extension' || key === 'ext') return num('extension', 'ext_value');
  if (key === 'releaseheight' || key === 'height') return num('release_height', 'rel_height');
  if (key === 'releaseside' || key === 'side') return num('release_side', 'rel_side');
  if (key === 'spinrate' || key === 'spin') return num('spin_rate', 'spin');
  if (key === 'ev') return num('exit_speed');
  if (key === 'la') return num('angle');
  if (key === 'qp' || key === 'qpplus') return num('qp_plus');
  if (key === 'rv100') return num('run_value');
  return num(goal.executionStat, key);
}

function buildSeries(goal: ParsedGoal, points: Array<Record<string, unknown>>): Array<{ date: string; value: number }> {
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const point of points) {
    const date = String(point.session_date ?? '').trim();
    if (!date) continue;
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date)?.push(point);
  }
  return Array.from(grouped.entries())
    .map(([date, rows]) => {
      const avgFrom = (...keys: string[]): number | null => {
        const values: number[] = [];
        for (const row of rows) {
          for (const key of keys) {
            const value = toNum(row[key]);
            if (value !== null) {
              values.push(value);
              break;
            }
          }
        }
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      };
      const pct = (num: number, den: number): number | null => (den > 0 ? (100 * num) / den : null);
      const isStrike = (call: string): boolean =>
        call === 'StrikeCalled' ||
        call === 'StrikeSwinging' ||
        call === 'FoulBall' ||
        call === 'FoulBallFieldable' ||
        call === 'FoulBallNotFieldable' ||
        call === 'InPlay';
      const isSwing = (call: string): boolean =>
        call === 'StrikeSwinging' || call === 'FoulBall' || call === 'FoulBallFieldable' || call === 'FoulBallNotFieldable' || call === 'InPlay';
      const isWhiff = (call: string): boolean => call === 'StrikeSwinging';
      const basesForPlay = (play: string): number => {
        if (play === 'Single') return 1;
        if (play === 'Double') return 2;
        if (play === 'Triple') return 3;
        if (play === 'HomeRun') return 4;
        return 0;
      };

      if (goal.category === 'Stuff') {
        const values = rows.map((row) => metricValue(goal, row)).filter((value): value is number => value !== null);
        const value = values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null;
        return value === null ? null : { date, value };
      }

      const key = normalizeExecutionStatKey(goal.executionStat);
      const directMetric =
        key === 'velocity' || key === 'velo'
          ? avgFrom('velo', 'rel_speed')
          : key === 'max'
            ? (() => {
                const values = rows.map((row) => toNum(row.velo) ?? toNum(row.rel_speed)).filter((value): value is number => value !== null);
                return values.length ? Math.max(...values) : null;
              })()
            : key === 'ivb'
              ? avgFrom('ivb')
              : key === 'hb'
                ? avgFrom('hb')
                : key === 'extension' || key === 'ext'
                  ? avgFrom('extension', 'ext_value')
                  : key === 'releaseheight' || key === 'height'
                    ? avgFrom('release_height', 'rel_height')
                    : key === 'releaseside' || key === 'side'
                      ? avgFrom('release_side', 'rel_side')
                      : key === 'spinrate' || key === 'spin'
                        ? avgFrom('spin_rate', 'spin')
                        : key === 'ev'
                          ? avgFrom('exit_speed')
                          : key === 'la'
                            ? avgFrom('angle')
                            : key === 'qp' || key === 'qpplus'
                              ? avgFrom('qp_plus')
                              : null;
      if (directMetric !== null) return { date, value: directMetric };

      const calledStrikes = rows.filter((row) => String(row.pitch_call ?? '') === 'StrikeCalled').length;
      const swings = rows.filter((row) => isSwing(String(row.pitch_call ?? ''))).length;
      const whiffs = rows.filter((row) => isWhiff(String(row.pitch_call ?? ''))).length;
      const strikes = rows.filter((row) => isStrike(String(row.pitch_call ?? ''))).length;
      const takes = rows.filter((row) => {
        const call = String(row.pitch_call ?? '');
        return call === 'BallCalled' || call === 'StrikeCalled' || call === 'Ball';
      }).length;
      const strikeLeft = -0.88;
      const strikeRight = 0.88;
      const strikeBottom = 1.5;
      const strikeTop = 3.6;
      const strikeMidX = (strikeLeft + strikeRight) / 2;
      const strikeMidY = (strikeBottom + strikeTop) / 2;
      const greenHalf = 7 / 24;
      const greenLeft = strikeMidX - greenHalf;
      const greenRight = strikeMidX + greenHalf;
      const greenBottom = strikeMidY - greenHalf;
      const greenTop = strikeMidY + greenHalf;
      let chaseDen = 0;
      let chaseNum = 0;
      let goZoneDen = 0;
      let goZoneSwNum = 0;
      let izDen = 0;
      let izSwNum = 0;
      let edgeDen = 0;
      let edgeSwNum = 0;
      let posSdPoints = 0;
      for (const row of rows) {
        const x = toNum(row.plate_side);
        const y = toNum(row.plate_height);
        if (x === null || y === null) continue;
        const swing = isSwing(String(row.pitch_call ?? ''));
        const inZone = x >= strikeLeft && x <= strikeRight && y >= strikeBottom && y <= strikeTop;
        const green = x >= greenLeft && x <= greenRight && y >= greenBottom && y <= greenTop;
        const outside = !inZone;
        const edge = inZone && !green;
        if (outside) {
          chaseDen += 1;
          if (swing) chaseNum += 1;
        }
        if (green) {
          goZoneDen += 1;
          if (swing) goZoneSwNum += 1;
        }
        if (inZone) {
          izDen += 1;
          if (swing) izSwNum += 1;
        }
        if (edge) {
          edgeDen += 1;
          if (swing) edgeSwNum += 1;
        }
        if ((swing && green) || (!swing && outside)) posSdPoints += 1;
      }

      let locN = 0;
      let compN = 0;
      for (const row of rows) {
        const x = toNum(row.plate_side);
        const y = toNum(row.plate_height);
        if (x === null || y === null) continue;
        locN += 1;
        const label = inZoneLabel(x, y);
        if (label === 'Yes' || label === 'Competitive') compN += 1;
      }
      const fpsDen = rows.filter((row) => toNum(row.balls_num) === 0 && toNum(row.strikes_num) === 0).length;
      const fpsNum = rows.filter((row) => toNum(row.balls_num) === 0 && toNum(row.strikes_num) === 0 && isStrike(String(row.pitch_call ?? ''))).length;
      const earlyDen = rows.filter((row) => {
        const b = toNum(row.balls_num);
        const s = toNum(row.strikes_num);
        return b !== null && s !== null && b + s <= 1;
      }).length;
      const earlyNum = rows.filter((row) => {
        const b = toNum(row.balls_num);
        const s = toNum(row.strikes_num);
        return b !== null && s !== null && b + s <= 1 && isStrike(String(row.pitch_call ?? ''));
      }).length;
      const aheadDen = rows.filter((row) => {
        const b = toNum(row.balls_num);
        const s = toNum(row.strikes_num);
        return b !== null && s !== null && s > b;
      }).length;
      const aheadNum = rows.filter((row) => {
        const b = toNum(row.balls_num);
        const s = toNum(row.strikes_num);
        return b !== null && s !== null && s > b && isStrike(String(row.pitch_call ?? ''));
      }).length;
      const eaDen = rows.filter((row) => {
        const b = toNum(row.balls_num);
        const s = toNum(row.strikes_num);
        return b !== null && s !== null && (b + s <= 1 || s > b);
      }).length;
      const eaNum = rows.filter((row) => {
        const b = toNum(row.balls_num);
        const s = toNum(row.strikes_num);
        return b !== null && s !== null && (b + s <= 1 || s > b) && isStrike(String(row.pitch_call ?? ''));
      }).length;
      const oneOneDen = rows.filter((row) => toNum(row.balls_num) === 1 && toNum(row.strikes_num) === 1).length;
      const oneOneNum = rows.filter((row) => toNum(row.balls_num) === 1 && toNum(row.strikes_num) === 1 && isStrike(String(row.pitch_call ?? ''))).length;
      const qpVals = rows.map((row) => toNum(row.qp_plus)).filter((value): value is number => value !== null);
      const inPlays = rows.filter((row) => String(row.pitch_call ?? '') === 'InPlay');
      const inPlayN = inPlays.length;
      const gbN = inPlays.filter((row) => String(row.tagged_hit_type ?? '').toLowerCase() === 'groundball').length;
      const hardHitN = inPlays.filter((row) => {
        const ev = toNum(row.exit_speed);
        return ev !== null && ev >= 95;
      }).length;
      const zoneN = rows.filter((row) => inZoneLabel(toNum(row.plate_side), toNum(row.plate_height)) === 'Yes').length;

      let ab = 0;
      let hits = 0;
      let totalBases = 0;
      let bb = 0;
      let hbp = 0;
      let sf = 0;
      const bfKeys = new Set<string>();
      const kKeys = new Set<string>();
      const bbKeys = new Set<string>();
      let singles = 0;
      let doubles = 0;
      let triples = 0;
      let homers = 0;
      for (const row of rows) {
        const call = String(row.pitch_call ?? '');
        const play = String(row.play_result ?? '');
        const korbb = String(row.korbb ?? '');
        const paKey = `${String(row.game_id ?? row.game_uid ?? row.game_foreign_id ?? 'g')}|${String(row.play_id ?? row.pitch_event_id ?? row.pitch_number ?? '')}`;
        if (paKey.trim() !== 'g|') bfKeys.add(paKey);
        if (korbb === 'Walk') {
          bb += 1;
          bbKeys.add(paKey);
          continue;
        }
        if (call === 'HitByPitch' || play === 'HitByPitch') {
          hbp += 1;
          continue;
        }
        if (korbb === 'Strikeout') {
          ab += 1;
          kKeys.add(paKey);
          continue;
        }
        if (call === 'InPlay') {
          if (play === 'Sacrifice') {
            sf += 1;
            continue;
          }
          ab += 1;
          const bases = basesForPlay(play);
          if (bases > 0) {
            hits += 1;
            totalBases += bases;
            if (play === 'Single') singles += 1;
            if (play === 'Double') doubles += 1;
            if (play === 'Triple') triples += 1;
            if (play === 'HomeRun') homers += 1;
          }
        }
      }
      const avg = ab > 0 ? hits / ab : null;
      const slg = ab > 0 ? totalBases / ab : null;
      const iso = avg !== null && slg !== null ? slg - avg : null;
      const obpDen = ab + bb + hbp + sf;
      const obp = obpDen > 0 ? (hits + bb + hbp) / obpDen : null;
      const ops = obp !== null && slg !== null ? obp + slg : null;
      const kCount = kKeys.size ? Number(kKeys.size) : rows.filter((row) => String(row.korbb ?? '') === 'Strikeout').length;
      const babipDen = ab - kCount - homers + sf;
      const babip = babipDen > 0 ? (hits - homers) / babipDen : null;
      const wobaDen = ab + bb + hbp + sf;
      const woba = wobaDen > 0 ? (0.69 * bb + 0.72 * hbp + 0.88 * singles + 1.247 * doubles + 1.578 * triples + 2.031 * homers) / wobaDen : null;
      const xwobaValues = rows
        .map((row) => toNum(row.xwoba) ?? toNum(row.xwoba_value) ?? toNum(row.estimated_woba_using_speedangle))
        .filter((value): value is number => value !== null);
      const xwoba = xwobaValues.length ? xwobaValues.reduce((sum, value) => sum + value, 0) / xwobaValues.length : null;
      const xslg = avgFrom('xslg');
      const xavg = avgFrom('xavg');
      const metricMap: Record<string, number | null> = {
        strikepct: pct(strikes, rows.length),
        zonepct: pct(zoneN, rows.length),
        inzonepct: pct(zoneN, rows.length),
        cswpct: pct(calledStrikes + whiffs, rows.length),
        whiffpct: pct(whiffs, swings),
        swingpct: pct(swings, rows.length),
        takepct: pct(takes, rows.length),
        chasepct: pct(chaseNum, chaseDen),
        gozoneswpct: pct(goZoneSwNum, goZoneDen),
        izswingpct: pct(izSwNum, izDen),
        edgeswingpct: pct(edgeSwNum, edgeDen),
        possdpct: pct(posSdPoints, rows.length),
        calledstrikepct: pct(calledStrikes, rows.length),
        calledspct: pct(calledStrikes, rows.length),
        gbpct: pct(gbN, inPlayN),
        barrelpct: pct(
          inPlays.filter((row) => {
            const ev = toNum(row.exit_speed);
            const la = toNum(row.angle);
            return ev !== null && la !== null && ev >= 98 && la >= 26 && la <= 30;
          }).length,
          inPlayN
        ),
        hardhitpct: pct(hardHitN, inPlayN),
        comppct: pct(compN, locN),
        fpspct: pct(fpsNum, fpsDen),
        earlypct: pct(earlyNum, earlyDen),
        aheadpct: pct(aheadNum, aheadDen),
        eapct: pct(eaNum, eaDen),
        '11wpct': pct(oneOneNum, oneOneDen),
        qppct: pct(qpVals.filter((value) => value >= 100).length, qpVals.length),
        k: kCount,
        bb: bbKeys.size ? Number(bbKeys.size) : rows.filter((row) => String(row.korbb ?? '') === 'Walk').length,
        whiffs,
        p: rows.length,
        bf: bfKeys.size > 0 ? bfKeys.size : null,
        kpct: pct(kKeys.size, bfKeys.size),
        bbpct: pct(bbKeys.size, bfKeys.size),
        rv100: rows.length
          ? (rows.reduce((sum, row) => {
              const rv = toNum(row.run_value);
              return rv === null ? sum : sum + rv;
            }, 0) /
              rows.length) *
            100
          : null,
        avg,
        slg,
        iso,
        woba,
        xwoba,
        xiso: avgFrom('xiso') ?? (xslg !== null && xavg !== null ? xslg - xavg : null),
        obp,
        ops,
        babip,
      };
      const value = metricMap[key] ?? null;
      return value === null ? null : { date, value };
    })
    .filter((row): row is { date: string; value: number } => row !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function formatGoalValue(goal: ParsedGoal, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  const label = metricLabel(goal).trim();
  const upper = label.toUpperCase();
  if (new Set(['AVG', 'SLG', 'OBP', 'OPS', 'WOBA', 'XWOBA', 'ISO', 'XISO', 'BABIP']).has(upper)) {
    return formatTableDisplayValue(upper, value);
  }
  if (label.includes('%')) return `${value.toFixed(1)}%`;
  if (upper === 'SPIN RATE') return String(Math.round(value));
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function goalHeadline(goal: ParsedGoal): string {
  const summary = formatPlayerPlanGoalSummary(goal);
  if (summary) return summary;
  const direction = goal.comparator === 'Less Than' ? 'Decrease' : 'Increase';
  const target = goal.targetValue || '-';
  return `${direction} ${metricLabel(goal)} to ${target}`;
}

function playerNameCandidates(playerName: string): string[] {
  const trimmed = String(playerName ?? '').trim();
  if (!trimmed) return [];
  const values = new Set<string>([trimmed]);
  if (!trimmed.includes(',')) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      values.add(`${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`.trim());
    }
  } else {
    const [last, ...rest] = trimmed.split(',');
    const first = rest.join(' ').trim();
    if (first && last.trim()) values.add(`${first} ${last.trim()}`.replace(/\s+/g, ' ').trim());
  }
  return Array.from(values).filter(Boolean);
}

function TrendChart({ goal, series }: { goal: ParsedGoal; series: Array<{ date: string; value: number }> }) {
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; label: string } | null>(null);
  if (series.length === 0) return <p className="portal-muted-text" style={{ margin: 0 }}>No chart data for current filters.</p>;
  const width = 620;
  const height = 260;
  const pad = { left: 58, right: 18, top: 22, bottom: 54 };
  const target = goal.targetValue && Number.isFinite(Number(goal.targetValue)) ? Number(goal.targetValue) : null;
  const values = series.map((point) => point.value);
  const domainValues = target === null ? values : [...values, target];
  const min = Math.min(...domainValues);
  const max = Math.max(...domainValues);
  const rawSpan = max === min ? Math.max(1, Math.abs(max) * 0.08) : max - min;
  const yMin = min - rawSpan * 0.08;
  const yMax = max + rawSpan * 0.08;
  const span = yMax - yMin || 1;
  const xFor = (index: number) => pad.left + (index / Math.max(1, series.length - 1)) * (width - pad.left - pad.right);
  const yFor = (value: number) => pad.top + ((yMax - value) / span) * (height - pad.top - pad.bottom);
  const d = series.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index)} ${yFor(point.value)}`).join(' ');
  const targetY = target === null ? null : yFor(target);
  const chartColor = '#ef4444';
  const yTicks = [yMax, yMin + span / 2, yMin];
  const xLabelIndexes = series.length <= 6 ? series.map((_, index) => index) : [0, Math.floor((series.length - 1) / 2), series.length - 1];
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }} onMouseLeave={() => setHoveredPoint(null)}>
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={`y-${tick}`}>
              <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="rgba(148,163,184,0.16)" />
              <text x={pad.left - 8} y={y + 4} fill="rgba(226,232,240,0.72)" textAnchor="end" fontSize="11">
                {formatGoalValue(goal, tick)}
              </text>
            </g>
          );
        })}
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} stroke="rgba(148,163,184,0.45)" />
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} stroke="rgba(148,163,184,0.45)" />
        {targetY !== null ? (
          <line x1={pad.left} y1={targetY} x2={width - pad.right} y2={targetY} stroke="#f59e0b" strokeDasharray="5 5" strokeWidth="2" />
        ) : null}
        <path d={d} fill="none" stroke={chartColor} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {series.map((point, index) => {
          const x = xFor(index);
          const y = yFor(point.value);
          return (
            <circle
              key={`${goal.slotIndex}-${point.date}`}
              cx={x}
              cy={y}
              r={hoveredPoint?.label.includes(formatMdyy(point.date)) ? 6 : 5}
              fill={chartColor}
              stroke="rgba(255,255,255,0.9)"
              strokeWidth="1.5"
              onMouseEnter={() => setHoveredPoint({ x, y, label: `${formatMdyy(point.date)}: ${formatGoalValue(goal, point.value)}` })}
              onMouseMove={() => setHoveredPoint({ x, y, label: `${formatMdyy(point.date)}: ${formatGoalValue(goal, point.value)}` })}
            />
          );
        })}
        {xLabelIndexes.map((index) => (
          <text key={`x-${index}`} x={xFor(index)} y={height - pad.bottom + 22} fill="rgba(226,232,240,0.72)" textAnchor="middle" fontSize="11">
            {formatMdyy(series[index].date)}
          </text>
        ))}
        <text x={14} y={(height - pad.bottom + pad.top) / 2} fill="rgba(226,232,240,0.72)" textAnchor="middle" fontSize="11" transform={`rotate(-90 14 ${(height - pad.bottom + pad.top) / 2})`}>
          {metricLabel(goal)}
        </text>
        <text x={width - pad.right} y={height - 8} fill="rgba(226,232,240,0.72)" textAnchor="end" fontSize="11">
          Date
        </text>
      </svg>
      {hoveredPoint ? (
        <div
          style={{
            position: 'absolute',
            left: `${(hoveredPoint.x / width) * 100}%`,
            top: `${(hoveredPoint.y / height) * 100}%`,
            transform: 'translate(-50%, calc(-100% - 10px))',
            background: 'rgba(15,23,42,0.96)',
            border: '1px solid rgba(255,255,255,0.22)',
            borderRadius: 6,
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            padding: '5px 7px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 2,
          }}
        >
          {hoveredPoint.label}
        </div>
      ) : null}
    </div>
  );
}

function StatTable({ goal, series }: { goal: ParsedGoal; series: Array<{ date: string; value: number }> }) {
  const rows = series.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  if (!rows.length) return null;
  const target = goal.targetValue && Number.isFinite(Number(goal.targetValue)) ? Number(goal.targetValue) : null;
  return (
    <div className="portal-table-wrap" style={{ marginTop: 8 }}>
      <table className="portal-table portal-table--compact" style={{ minWidth: 0 }}>
        <thead>
          <tr>
            <th>Date</th>
            <th>{metricLabel(goal)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const meetsTarget =
              target === null
                ? null
                : goal.comparator === 'Less Than'
                  ? row.value < target
                  : row.value > target;
            return (
              <tr key={`${goal.slotIndex}-${row.date}`}>
                <td>{formatMdyy(row.date)}</td>
                <td style={{ color: meetsTarget === null ? undefined : meetsTarget ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                  {formatGoalValue(goal, row.value)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ProfilePlanGoalsPanel({ playerId, playerName, goals, canEditGoals }: ProfilePlanGoalsPanelProps) {
  const parsedGoals = useMemo(() => goals.map(parseGoal).filter((goal): goal is ParsedGoal => goal !== null), [goals]);
  const [expanded, setExpanded] = useState(true);
  const [charts, setCharts] = useState<Record<GoalSlot, GoalChartState>>({
    1: { loading: false, error: '', points: [] },
    2: { loading: false, error: '', points: [] },
    3: { loading: false, error: '', points: [] },
  });

  useEffect(() => {
    const chartGoals = parsedGoals.filter(isChartCapableGoal);
    const candidates = playerNameCandidates(playerName);
    if (!chartGoals.length || !candidates.length) return;
    let active = true;
    const controller = new AbortController();
    setCharts((prev) => {
      const next = { ...prev };
      for (const goal of chartGoals) next[goal.slotIndex] = { ...next[goal.slotIndex], loading: true, error: '' };
      return next;
    });

    Promise.allSettled(
      chartGoals.map(async (goal) => {
        const domain = goalDomain(goal);
        let lastError = '';
        for (const candidate of candidates) {
          const params = new URLSearchParams();
          params.set(domain === 'hitting' ? 'hitter' : 'pitcher', candidate);
          if (domain !== 'hitting') params.set('session_type', goal.sessionType || 'Season');
          if (goal.startDate) params.set('start_date', goal.startDate);
          if (goal.endDate) params.set('end_date', goal.endDate);
          if (!goal.pitchTypes.includes('All')) params.set('pitch_types', goal.pitchTypes.join(','));
          if (domain === 'pitching' && !goal.ballTypes.includes('All')) params.set('ball_types', goal.ballTypes.join(','));
          if (!goal.pitchResults.includes('All')) params.set('pitch_results', goal.pitchResults.join(','));
          if (!goal.countOptions.includes('All')) params.set('count_filter', goal.countOptions.join(','));
          if (!goal.afterCountOptions.includes('All')) params.set('after_count_filter', goal.afterCountOptions.join(','));
          if (goal.hand && goal.hand !== 'All') params.set('hand', goal.hand);
          if (goal.batterSide && goal.batterSide !== 'All') params.set('batter_side', goal.batterSide);
          const team = goal.teams.find((value) => value !== 'All');
          if (team) params.set('team_type', team);
          const response = await fetch(`/api/dashboard/${domain}/overview?${params.toString()}`, {
            cache: 'no-store',
            signal: controller.signal,
          });
          const payload = (await response.json().catch(() => ({}))) as { chart_points?: Array<Record<string, unknown>>; error?: string };
          if (!response.ok) {
            lastError = payload.error ?? 'Failed to load goal chart data.';
            continue;
          }
          const points = Array.isArray(payload.chart_points) ? payload.chart_points : [];
          if (points.length > 0) return { slotIndex: goal.slotIndex, points };
        }
        if (lastError) throw new Error(lastError);
        return { slotIndex: goal.slotIndex, points: [] };
      })
    ).then((results) => {
      if (!active) return;
      setCharts((prev) => {
        const next = { ...prev };
        results.forEach((result, index) => {
          const slotIndex = chartGoals[index].slotIndex;
          if (result.status === 'fulfilled') next[slotIndex] = { loading: false, error: '', points: result.value.points };
          else next[slotIndex] = { loading: false, error: result.reason instanceof Error ? result.reason.message : 'Failed to load goal chart data.', points: [] };
        });
        return next;
      });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [parsedGoals, playerName]);

  if (!parsedGoals.length) return null;

  return (
    <article className="portal-admin-card">
      <div className="portal-row-between">
        <h3>Player Plan Goals</h3>
        <div className="portal-choice-line-actions">
          {canEditGoals ? (
            <Link href={`/portal/dashboard?suite=player-plans&playerPlanPlayerId=${playerId}`} className="btn btn-ghost as-link">
              Edit Goals
            </Link>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      {!expanded ? null : <div className="portal-profile-goals-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(520px, 100%), 1fr))' }}>
        {parsedGoals.map((goal) => {
          const state = charts[goal.slotIndex];
          const series = buildSeries(goal, state.points);
          return (
            <article key={`goal-slot-${goal.slotIndex}`} className="portal-day-card">
              <div className="portal-row-between">
                <h4 style={{ margin: 0 }}>Goal {goal.slotIndex}</h4>
                <p className="portal-muted-text">Created: {formatTimestampDate(goal.createdAt)}</p>
              </div>
              <p style={{ margin: 0, fontWeight: 700 }}>{goalHeadline(goal)}</p>
              <p className="portal-muted-text" style={{ margin: 0 }}>
                {goal.chartType || 'Trend'} | {goal.category || 'Goal'}
              </p>
              {!isChartCapableGoal(goal) ? (
                <p style={{ margin: 0 }}>{goal.goalDescription}</p>
              ) : state.loading ? (
                <p className="portal-muted-text" style={{ margin: 0 }}>Loading chart...</p>
              ) : state.error ? (
                <p className="auth-error" style={{ margin: 0 }}>{state.error}</p>
              ) : (
                <>
                  <TrendChart goal={goal} series={series} />
                  <StatTable goal={goal} series={series} />
                </>
              )}
            </article>
          );
        })}
      </div>}
    </article>
  );
}

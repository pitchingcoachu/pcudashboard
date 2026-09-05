'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import type { NutritionLogRow, NutritionTargetRow } from '../../../lib/training-db';

type NutritionSectionProps = {
  playerId: number;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function sumField(logs: NutritionLogRow[], field: 'calories' | 'proteinG' | 'carbsG' | 'fatG'): number {
  return logs.reduce((total, log) => total + (log[field] ?? 0), 0);
}

type DailyTotal = { logDate: string; calories: number; proteinG: number; carbsG: number; fatG: number };

function dailyTotals(logs: NutritionLogRow[]): DailyTotal[] {
  const byDate = new Map<string, NutritionLogRow[]>();
  for (const log of logs) {
    const bucket = byDate.get(log.logDate) ?? [];
    bucket.push(log);
    byDate.set(log.logDate, bucket);
  }
  return Array.from(byDate.entries())
    .map(([logDate, dayLogs]) => ({
      logDate,
      calories: sumField(dayLogs, 'calories'),
      proteinG: sumField(dayLogs, 'proteinG'),
      carbsG: sumField(dayLogs, 'carbsG'),
      fatG: sumField(dayLogs, 'fatG'),
    }))
    .sort((a, b) => a.logDate.localeCompare(b.logDate));
}

function CalorieTrendChart({ points, targetCalories }: { points: DailyTotal[]; targetCalories: number | null }) {
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; label: string } | null>(null);
  if (points.length === 0) return <p className="portal-muted-text">Log a few days to see your calorie trend.</p>;

  const width = 620;
  const height = 220;
  const leftPad = 52;
  const rightPad = 16;
  const topPad = 18;
  const bottomPad = 32;

  const values = points.map((point) => point.calories);
  if (targetCalories) values.push(targetCalories);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(...values, 1);
  const yMin = minValue;
  const yMax = maxValue === minValue ? maxValue + 1 : maxValue;

  const yTickCount = 5;
  const yTicks = Array.from({ length: yTickCount }, (_, idx) => {
    const ratio = idx / (yTickCount - 1);
    const value = yMax - ratio * (yMax - yMin);
    const y = topPad + ratio * (height - topPad - bottomPad);
    return { value, y };
  });

  const chartPoints = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : leftPad + (index / (points.length - 1)) * (width - leftPad - rightPad);
    const y = height - bottomPad - ((point.calories - yMin) / (yMax - yMin)) * (height - topPad - bottomPad);
    return { ...point, x, y };
  });

  const path = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const xLabelStep = Math.max(1, Math.ceil(chartPoints.length / 7));
  const xTicks = chartPoints.filter((_, idx) => idx % xLabelStep === 0 || idx === chartPoints.length - 1);
  const targetY =
    targetCalories != null ? height - bottomPad - ((targetCalories - yMin) / (yMax - yMin)) * (height - topPad - bottomPad) : null;

  return (
    <div className="portal-chart-wrap portal-profile-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="portal-chart portal-profile-line-chart" role="img" aria-label="Calories vs target">
        {yTicks.map((tick) => (
          <g key={`y-${tick.value.toFixed(2)}`}>
            <line x1={leftPad} y1={tick.y} x2={width - rightPad} y2={tick.y} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            <text x={leftPad - 8} y={tick.y + 4} textAnchor="end" fill="rgba(255,255,255,0.72)" fontSize="11">
              {Math.round(tick.value)}
            </text>
          </g>
        ))}
        <line x1={leftPad} y1={topPad} x2={leftPad} y2={height - bottomPad} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <line x1={leftPad} y1={height - bottomPad} x2={width - rightPad} y2={height - bottomPad} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        {targetY != null ? (
          <line
            x1={leftPad}
            y1={targetY}
            x2={width - rightPad}
            y2={targetY}
            stroke="rgba(255,255,255,0.55)"
            strokeWidth="1.5"
            strokeDasharray="6 5"
          />
        ) : null}
        <path d={path} fill="none" stroke="rgba(200, 16, 46, 0.95)" strokeWidth="2.6" />
        {xTicks.map((point) => (
          <text
            key={`x-${point.logDate}`}
            x={point.x}
            y={height - 10}
            textAnchor="middle"
            fill="rgba(255,255,255,0.72)"
            fontSize="10"
          >
            {formatDate(point.logDate)}
          </text>
        ))}
        {chartPoints.map((point, index) => (
          <circle
            key={`${point.logDate}-${index}`}
            cx={point.x}
            cy={point.y}
            r="4"
            fill="rgba(200, 16, 46, 0.95)"
            onMouseEnter={(event: MouseEvent<SVGCircleElement>) => {
              setHoveredPoint({
                x: event.currentTarget.cx.baseVal.value,
                y: event.currentTarget.cy.baseVal.value,
                label: `${formatDate(point.logDate)} - ${Math.round(point.calories)} cal`,
              });
            }}
            onMouseLeave={() => setHoveredPoint(null)}
          />
        ))}
        <text x={leftPad} y={12} fill="rgba(255,255,255,0.7)" fontSize="11">
          Calories{targetCalories ? ` (target: ${targetCalories})` : ''}
        </text>
        {hoveredPoint && (
          <g>
            <rect
              x={Math.max(leftPad + 2, Math.min(hoveredPoint.x - 55, width - rightPad - 128))}
              y={Math.max(topPad + 2, hoveredPoint.y - 28)}
              width="128"
              height="20"
              rx="6"
              fill="rgba(0,0,0,0.92)"
              stroke="rgba(255,255,255,0.28)"
            />
            <text
              x={Math.max(leftPad + 10, Math.min(hoveredPoint.x - 47, width - rightPad - 120))}
              y={Math.max(topPad + 16, hoveredPoint.y - 14)}
              fill="rgba(255,255,255,0.96)"
              fontSize="10"
            >
              {hoveredPoint.label}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export default function NutritionSection({ playerId }: NutritionSectionProps) {
  const [logs, setLogs] = useState<NutritionLogRow[]>([]);
  const [target, setTarget] = useState<NutritionTargetRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const [logDate, setLogDate] = useState(todayIso());
  const [mealLabel, setMealLabel] = useState('');
  const [calories, setCalories] = useState('');
  const [proteinG, setProteinG] = useState('');
  const [carbsG, setCarbsG] = useState('');
  const [fatG, setFatG] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [targetCalories, setTargetCalories] = useState('');
  const [targetProteinG, setTargetProteinG] = useState('');
  const [targetCarbsG, setTargetCarbsG] = useState('');
  const [targetFatG, setTargetFatG] = useState('');
  const [targetSaving, setTargetSaving] = useState(false);
  const [targetMessage, setTargetMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const startDate = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
      const [logsResponse, targetResponse] = await Promise.all([
        fetch(`/api/player/nutrition/logs?playerId=${playerId}&startDate=${startDate}`),
        fetch(`/api/player/nutrition/target?playerId=${playerId}`),
      ]);
      const logsPayload = (await logsResponse.json().catch(() => ({}))) as { logs?: NutritionLogRow[] };
      const targetPayload = (await targetResponse.json().catch(() => ({}))) as { target?: NutritionTargetRow | null };
      setLogs(Array.isArray(logsPayload.logs) ? logsPayload.logs : []);
      setTarget(targetPayload.target ?? null);
      setTargetCalories(targetPayload.target?.calories != null ? String(targetPayload.target.calories) : '');
      setTargetProteinG(targetPayload.target?.proteinG != null ? String(targetPayload.target.proteinG) : '');
      setTargetCarbsG(targetPayload.target?.carbsG != null ? String(targetPayload.target.carbsG) : '');
      setTargetFatG(targetPayload.target?.fatG != null ? String(targetPayload.target.fatG) : '');
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    load();
  }, [load]);

  const todayLogs = useMemo(() => logs.filter((log) => log.logDate === logDate).sort((a, b) => a.id - b.id), [logs, logDate]);
  const todayTotals = useMemo(
    () => ({
      calories: sumField(todayLogs, 'calories'),
      proteinG: sumField(todayLogs, 'proteinG'),
      carbsG: sumField(todayLogs, 'carbsG'),
      fatG: sumField(todayLogs, 'fatG'),
    }),
    [todayLogs]
  );
  const trendPoints = useMemo(() => dailyTotals(logs), [logs]);

  const streak = useMemo(() => {
    const loggedDates = new Set(logs.map((log) => log.logDate));
    let count = 0;
    const cursor = new Date();
    for (;;) {
      const iso = cursor.toISOString().slice(0, 10);
      if (!loggedDates.has(iso)) break;
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }, [logs]);

  async function handleAddMeal(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/player/nutrition/logs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId,
          logDate,
          mealLabel: mealLabel || null,
          calories: calories ? Number(calories) : null,
          proteinG: proteinG ? Number(proteinG) : null,
          carbsG: carbsG ? Number(carbsG) : null,
          fatG: fatG ? Number(fatG) : null,
          notes: notes || null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { logs?: NutritionLogRow[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save entry.');
      setLogs(Array.isArray(payload.logs) ? payload.logs : []);
      setMealLabel('');
      setCalories('');
      setProteinG('');
      setCarbsG('');
      setFatG('');
      setNotes('');
      setMessage('Meal logged.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save entry.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteMeal(logId: number) {
    try {
      const response = await fetch(`/api/player/nutrition/logs?playerId=${playerId}&logId=${logId}`, { method: 'DELETE' });
      const payload = (await response.json().catch(() => ({}))) as { logs?: NutritionLogRow[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete entry.');
      setLogs(Array.isArray(payload.logs) ? payload.logs : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete entry.');
    }
  }

  async function handleSaveTarget(event: React.FormEvent) {
    event.preventDefault();
    setTargetSaving(true);
    setTargetMessage('');
    try {
      const response = await fetch('/api/player/nutrition/target', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId,
          calories: targetCalories ? Number(targetCalories) : null,
          proteinG: targetProteinG ? Number(targetProteinG) : null,
          carbsG: targetCarbsG ? Number(targetCarbsG) : null,
          fatG: targetFatG ? Number(targetFatG) : null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { target?: NutritionTargetRow | null; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save target.');
      setTarget(payload.target ?? null);
      setTargetMessage('Target saved.');
    } catch (error) {
      setTargetMessage(error instanceof Error ? error.message : 'Failed to save target.');
    } finally {
      setTargetSaving(false);
    }
  }

  if (loading) return <p className="portal-muted-text">Loading nutrition...</p>;

  return (
    <div className="portal-nutrition-section">
      <div className="portal-nutrition-summary-row">
        <div className="portal-nutrition-summary-tile">
          <span className="portal-muted-text">Today</span>
          <strong>
            {todayTotals.calories} {target?.calories ? `/ ${target.calories}` : ''} cal
          </strong>
          <span className="portal-muted-text">
            P {todayTotals.proteinG.toFixed(0)}g · C {todayTotals.carbsG.toFixed(0)}g · F {todayTotals.fatG.toFixed(0)}g
          </span>
        </div>
        <div className="portal-nutrition-summary-tile">
          <span className="portal-muted-text">Logging streak</span>
          <strong>{streak} {streak === 1 ? 'day' : 'days'}</strong>
        </div>
      </div>

      <form className="portal-form-grid" onSubmit={handleAddMeal}>
        <label>
          Date
          <input type="date" value={logDate} onChange={(event) => setLogDate(event.target.value)} required />
        </label>
        <label>
          Meal (optional)
          <input value={mealLabel} onChange={(event) => setMealLabel(event.target.value)} placeholder="Breakfast, Lunch..." />
        </label>
        <label>
          Calories
          <input type="number" min="0" step="1" value={calories} onChange={(event) => setCalories(event.target.value)} />
        </label>
        <label>
          Protein (g)
          <input type="number" min="0" step="0.1" value={proteinG} onChange={(event) => setProteinG(event.target.value)} />
        </label>
        <label>
          Carbs (g)
          <input type="number" min="0" step="0.1" value={carbsG} onChange={(event) => setCarbsG(event.target.value)} />
        </label>
        <label>
          Fat (g)
          <input type="number" min="0" step="0.1" value={fatG} onChange={(event) => setFatG(event.target.value)} />
        </label>
        <label className="portal-form-span-2">
          Notes
          <input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className="portal-form-span-2">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Log Meal'}
          </button>
        </div>
      </form>
      {message ? <p className={message === 'Meal logged.' ? 'auth-message' : 'auth-error'}>{message}</p> : null}

      {todayLogs.length > 0 ? (
        <ul className="portal-nutrition-meal-list">
          {todayLogs.map((log) => (
            <li key={log.id} className="portal-nutrition-meal-row">
              <span className="portal-nutrition-meal-label">{log.mealLabel || 'Meal'}</span>
              <span className="portal-muted-text">
                {log.calories ?? 0} cal · P {log.proteinG ?? 0}g · C {log.carbsG ?? 0}g · F {log.fatG ?? 0}g
              </span>
              <button type="button" className="btn btn-ghost" onClick={() => handleDeleteMeal(log.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="portal-muted-text">No meals logged for {formatDate(logDate)} yet.</p>
      )}

      <h4>30-Day Trend</h4>
      <CalorieTrendChart points={trendPoints} targetCalories={target?.calories ?? null} />

      <h4>Daily Target</h4>
      <form className="portal-form-grid" onSubmit={handleSaveTarget}>
        <label>
          Calories
          <input type="number" min="0" step="1" value={targetCalories} onChange={(event) => setTargetCalories(event.target.value)} />
        </label>
        <label>
          Protein (g)
          <input type="number" min="0" step="0.1" value={targetProteinG} onChange={(event) => setTargetProteinG(event.target.value)} />
        </label>
        <label>
          Carbs (g)
          <input type="number" min="0" step="0.1" value={targetCarbsG} onChange={(event) => setTargetCarbsG(event.target.value)} />
        </label>
        <label>
          Fat (g)
          <input type="number" min="0" step="0.1" value={targetFatG} onChange={(event) => setTargetFatG(event.target.value)} />
        </label>
        <div className="portal-form-span-2">
          <button type="submit" className="btn btn-ghost" disabled={targetSaving}>
            {targetSaving ? 'Saving...' : 'Save Target'}
          </button>
          {target?.setByRole ? (
            <span className="portal-muted-text" style={{ marginLeft: 12 }}>
              Last set by {target.setByRole}
            </span>
          ) : null}
        </div>
      </form>
      {targetMessage ? <p className={targetMessage === 'Target saved.' ? 'auth-message' : 'auth-error'}>{targetMessage}</p> : null}
    </div>
  );
}

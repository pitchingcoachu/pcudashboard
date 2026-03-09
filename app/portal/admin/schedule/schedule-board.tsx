'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ProgramItemRow } from '../../../../lib/training-db';
import WorkoutLogModal from '../../components/workout-log-modal';

type PlayerChoice = { id: number; name: string };
type WorkoutChoice = { id: number; name: string; exerciseCount: number; category: string };
type ViewMode = 'day' | 'week' | 'month';

type ScheduleBoardProps = {
  players: PlayerChoice[];
  workouts: WorkoutChoice[];
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function addDays(value: string, days: number): string {
  const date = fromIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function startOfWeek(value: string): string {
  const date = fromIsoDate(value);
  const offset = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - offset);
  return toIsoDate(date);
}

function endOfWeekExclusive(value: string): string {
  return addDays(startOfWeek(value), 7);
}

function startOfMonth(value: string): string {
  const date = fromIsoDate(value);
  date.setUTCDate(1);
  return toIsoDate(date);
}

function endOfMonthExclusive(value: string): string {
  const date = fromIsoDate(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return toIsoDate(date);
}

function makeMonthGrid(anchor: string): Array<string | null> {
  const first = startOfMonth(anchor);
  const firstDate = fromIsoDate(first);
  const lastDate = fromIsoDate(endOfMonthExclusive(anchor));
  lastDate.setUTCDate(lastDate.getUTCDate() - 1);

  const leading = firstDate.getUTCDay();
  const daysInMonth = lastDate.getUTCDate();
  const trailing = (7 - ((leading + daysInMonth) % 7)) % 7;

  const result: Array<string | null> = [];
  for (let i = 0; i < leading; i += 1) result.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = fromIsoDate(first);
    date.setUTCDate(day);
    result.push(toIsoDate(date));
  }
  for (let i = 0; i < trailing; i += 1) result.push(null);
  return result;
}

function dateTitle(value: string): string {
  return fromIsoDate(value).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dayNumber(value: string): string {
  return String(fromIsoDate(value).getUTCDate());
}

function shortDayLabel(value: string): string {
  return WEEKDAY_LABELS[fromIsoDate(value).getUTCDay()];
}

function isToday(value: string): boolean {
  return value === toIsoDate(new Date());
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function categoryBubbleStyle(category: string): CSSProperties {
  const hue = hashString(category) % 360;
  return {
    borderColor: `hsla(${hue}, 88%, 64%, 0.7)`,
    background: `hsla(${hue}, 82%, 52%, 0.2)`,
  };
}

export default function ScheduleBoard({ players, workouts }: ScheduleBoardProps) {
  const [playerId, setPlayerId] = useState<number>(players[0]?.id ?? 0);
  const [view, setView] = useState<ViewMode>('month');
  const [anchorDate, setAnchorDate] = useState<string>(toIsoDate(new Date()));
  const [workoutQuery, setWorkoutQuery] = useState('');
  const [items, setItems] = useState<ProgramItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedItem, setSelectedItem] = useState<ProgramItemRow | null>(null);

  const visibleRange = useMemo(() => {
    if (view === 'day') return { startDate: anchorDate, endDate: addDays(anchorDate, 1) };
    if (view === 'week') return { startDate: startOfWeek(anchorDate), endDate: endOfWeekExclusive(anchorDate) };
    const monthStart = startOfMonth(anchorDate);
    const monthEnd = endOfMonthExclusive(anchorDate);
    return { startDate: monthStart, endDate: monthEnd, monthStart };
  }, [anchorDate, view]);

  const loadItems = useCallback(async () => {
    if (!playerId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        playerId: String(playerId),
        startDate: visibleRange.startDate,
        endDate: visibleRange.endDate,
      });
      const response = await fetch(`/api/admin/schedule/assignments?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as { items?: ProgramItemRow[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load schedule.');
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load schedule.');
    } finally {
      setLoading(false);
    }
  }, [playerId, visibleRange.endDate, visibleRange.startDate]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, ProgramItemRow[]>();
    for (const item of items) {
      const list = map.get(item.dayDate) ?? [];
      list.push(item);
      map.set(item.dayDate, list);
    }
    return map;
  }, [items]);

  const monthCells = useMemo(() => (view === 'month' ? makeMonthGrid(anchorDate) : []), [anchorDate, view]);
  const weekCells = useMemo(() => (view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchorDate), i)) : []), [anchorDate, view]);
  const dayCells = useMemo(() => (view === 'day' ? [anchorDate] : []), [anchorDate, view]);
  const periodLabel = useMemo(() => {
    const anchor = fromIsoDate(anchorDate);
    if (view === 'month') {
      return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
    if (view === 'week') {
      const start = startOfWeek(anchorDate);
      const end = addDays(start, 6);
      const startText = fromIsoDate(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
      const endText = fromIsoDate(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      return `${startText} - ${endText}`;
    }
    return anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }, [anchorDate, view]);
  const filteredWorkouts = useMemo(() => {
    const q = workoutQuery.trim().toLowerCase();
    if (!q) return workouts;
    return workouts.filter((workout) => workout.name.toLowerCase().includes(q));
  }, [workoutQuery, workouts]);
  const workoutSuggestions = useMemo(() => {
    const q = workoutQuery.trim().toLowerCase();
    if (!q) return [];
    return workouts
      .filter((workout) => workout.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [workoutQuery, workouts]);

  const movePeriod = (direction: -1 | 1) => {
    if (view === 'day') setAnchorDate((prev) => addDays(prev, direction));
    else if (view === 'week') setAnchorDate((prev) => addDays(prev, direction * 7));
    else {
      const date = fromIsoDate(anchorDate);
      date.setUTCMonth(date.getUTCMonth() + direction);
      setAnchorDate(toIsoDate(date));
    }
  };

  const assignWorkout = async (dayDate: string, workoutId: number) => {
    if (!playerId) return;
    setError('');
    try {
      const response = await fetch('/api/admin/schedule/assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, dayDate, workoutId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to assign workout.');
      await loadItems();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Failed to assign workout.');
    }
  };

  const reorderDayItems = async (dayDate: string, orderedItemIds: number[]) => {
    setItems((prev) => {
      const dayMap = new Map<number, ProgramItemRow>();
      for (const item of prev.filter((item) => item.dayDate === dayDate)) dayMap.set(item.itemId, item);
      const daySorted = orderedItemIds.map((id) => dayMap.get(id)).filter((item): item is ProgramItemRow => Boolean(item));
      const other = prev.filter((item) => item.dayDate !== dayDate);
      return [...other, ...daySorted].sort((a, b) => (a.dayDate === b.dayDate ? 0 : a.dayDate.localeCompare(b.dayDate)));
    });

    const response = await fetch('/api/admin/schedule/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, dayDate, orderedItemIds }),
    });
    if (!response.ok) {
      await loadItems();
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? 'Failed to reorder day items.');
    }
  };

  const onDayDrop = async (event: React.DragEvent<HTMLElement>, dayDate: string) => {
    event.preventDefault();
    const workoutId = Number(event.dataTransfer.getData('workoutId'));
    if (!Number.isFinite(workoutId) || workoutId <= 0) return;
    await assignWorkout(dayDate, workoutId);
  };

  const onItemDrop = async (event: React.DragEvent<HTMLElement>, dayDate: string, targetItemId: number) => {
    event.preventDefault();
    const sourceItemId = Number(event.dataTransfer.getData('scheduleItemId'));
    const sourceDate = event.dataTransfer.getData('scheduleItemDay');
    if (!Number.isFinite(sourceItemId) || sourceItemId <= 0) return;
    if (sourceDate !== dayDate) return;
    const dayItems = (itemsByDate.get(dayDate) ?? []).map((item) => item.itemId);
    const from = dayItems.indexOf(sourceItemId);
    const to = dayItems.indexOf(targetItemId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...dayItems];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    await reorderDayItems(dayDate, next);
  };

  const workoutById = useMemo(() => {
    const map = new Map<number, WorkoutChoice>();
    for (const workout of workouts) map.set(workout.id, workout);
    return map;
  }, [workouts]);

  const renderDayCell = (dayDate: string, compact: boolean, monthStart?: string, showDayLabel = false) => {
    const dayItems = itemsByDate.get(dayDate) ?? [];
    const isOutsideMonth = monthStart ? !dayDate.startsWith(monthStart.slice(0, 7)) : false;
    const today = isToday(dayDate);
    return (
      <article
        key={dayDate}
        className={`portal-schedule-day${compact ? ' is-compact' : ''}${isOutsideMonth ? ' is-outside' : ''}${today ? ' is-today' : ''}`}
        style={{
          minHeight: '220px',
          borderRadius: 0,
          borderTop: 0,
          borderLeft: 0,
          borderRight: '1px solid rgba(255,255,255,0.26)',
          borderBottom: '1px solid rgba(255,255,255,0.26)',
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void onDayDrop(event, dayDate)}
      >
        <header>
          <strong>
            <span className="portal-schedule-day-num">{dayNumber(dayDate)}</span>
            {showDayLabel && <span className="portal-schedule-day-label">{shortDayLabel(dayDate)}</span>}
          </strong>
        </header>
        <div className="portal-schedule-day-body" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.3rem' }}>
          {dayItems.map((item) => (
            <button
              key={item.itemId}
              type="button"
              className="portal-schedule-item"
              style={{
                display: 'block',
                width: '100%',
                boxSizing: 'border-box',
                textAlign: 'center',
                color: 'var(--text-main)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '6px',
                padding: '0.35rem 0.45rem',
                ...categoryBubbleStyle(item.workoutCategory ?? item.exerciseCategory ?? 'Workout'),
              }}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('scheduleItemId', String(item.itemId));
                event.dataTransfer.setData('scheduleItemDay', item.dayDate);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void onItemDrop(event, dayDate, item.itemId)}
              onClick={() => setSelectedItem(item)}
            >
              <strong>{item.itemName}</strong>
            </button>
          ))}
        </div>
      </article>
    );
  };

  const renderEmptyMonthCell = (key: string) => (
    <article
      key={key}
      className="portal-schedule-day portal-schedule-day-empty"
      style={{
        minHeight: '220px',
        borderRadius: 0,
        borderTop: 0,
        borderLeft: 0,
        borderRight: '1px solid rgba(255,255,255,0.26)',
        borderBottom: '1px solid rgba(255,255,255,0.26)',
      }}
      aria-hidden="true"
    />
  );

  if (players.length === 0) {
    return <p className="portal-muted-text">Create a client first before scheduling workouts.</p>;
  }

  return (
    <div className="portal-admin-stack">
      <div className="portal-schedule-toolbar">
        <label>
          Player
          <select value={String(playerId)} onChange={(event) => setPlayerId(Number(event.target.value))}>
            {players.map((player) => (
              <option key={player.id} value={String(player.id)}>
                {player.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Focus Date
          <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />
        </label>
        <div className="portal-schedule-view-switch" role="group" aria-label="Calendar view">
          {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn ${view === mode ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setView(mode)}
            >
              {mode[0].toUpperCase()}
              {mode.slice(1)}
            </button>
          ))}
        </div>
        <div className="portal-schedule-nav">
          <button type="button" className="btn btn-ghost" onClick={() => movePeriod(-1)}>
            Prev
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => movePeriod(1)}>
            Next
          </button>
        </div>
      </div>

      <div className="portal-schedule-layout">
        <aside className="portal-workout-palette">
          <div className="portal-search-wrap">
            <input
              type="search"
              value={workoutQuery}
              onChange={(event) => setWorkoutQuery(event.target.value)}
              placeholder="Search workouts..."
              className="portal-library-search"
              aria-label="Search saved workouts"
            />
            {workoutQuery.trim().length > 0 && workoutSuggestions.length > 0 && (
              <div className="portal-search-dropdown" role="listbox" aria-label="Workout search suggestions">
                {workoutSuggestions.map((workout) => (
                  <button
                    key={`suggest-${workout.id}`}
                    type="button"
                    className="portal-search-option"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('workoutId', String(workout.id));
                    }}
                    onClick={() => {
                      setWorkoutQuery(workout.name);
                    }}
                  >
                    {workout.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <details open>
            <summary className="portal-folder-header">
              <h4>Saved Workouts</h4>
              <span>{filteredWorkouts.length}</span>
            </summary>
            <div className="portal-workout-palette-list">
              {filteredWorkouts.map((workout) => (
                <article
                  key={workout.id}
                  className="portal-workout-palette-item"
                  style={categoryBubbleStyle(workout.category)}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('workoutId', String(workout.id));
                  }}
                >
                  <strong>{workout.name}</strong>
                </article>
              ))}
              {filteredWorkouts.length === 0 && <p className="portal-muted-text">No workouts match.</p>}
            </div>
          </details>
        </aside>

        <section className="portal-schedule-calendar" aria-busy={loading}>
          <h3 className="portal-schedule-period">{periodLabel}</h3>
          {view !== 'day' && (
            <div
              className="portal-schedule-weekdays"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(140px, 1fr))',
                gap: '0',
                minWidth: '980px',
                borderTop: '1px solid rgba(255,255,255,0.26)',
                borderLeft: '1px solid rgba(255,255,255,0.26)',
              }}
            >
              {WEEKDAY_LABELS.map((label) => (
                <span key={label} style={{ borderRight: '1px solid rgba(255,255,255,0.26)', borderBottom: '1px solid rgba(255,255,255,0.26)', padding: '0.35rem 0.25rem' }}>
                  {label}
                </span>
              ))}
            </div>
          )}
          {view === 'month' && (
            <div
              className="portal-schedule-month-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(140px, 1fr))',
                gap: '0',
                minWidth: '980px',
                borderLeft: '1px solid rgba(255,255,255,0.26)',
              }}
            >
              {monthCells.map((date, index) =>
                date ? renderDayCell(date, true, visibleRange.monthStart) : renderEmptyMonthCell(`blank-${index}`)
              )}
            </div>
          )}
          {view === 'week' && (
            <div
              className="portal-schedule-week-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(140px, 1fr))',
                gap: '0',
                minWidth: '980px',
                borderLeft: '1px solid rgba(255,255,255,0.26)',
              }}
            >
              {weekCells.map((date) => renderDayCell(date, false, undefined, false))}
            </div>
          )}
          {view === 'day' && <div className="portal-schedule-day-grid">{dayCells.map((date) => renderDayCell(date, false, undefined, true))}</div>}
        </section>
      </div>

      {error && <p className="auth-error">{error}</p>}

      {selectedItem && (
        <WorkoutLogModal
          item={selectedItem}
          playerId={playerId}
          onClose={() => setSelectedItem(null)}
          onSaved={async () => {
            await loadItems();
          }}
        />
      )}
    </div>
  );
}

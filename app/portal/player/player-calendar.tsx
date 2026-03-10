'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ProgramItemRow } from '../../../lib/training-db';
import WorkoutLogModal from '../components/workout-log-modal';

type ViewMode = 'day' | 'week' | 'month';

type PlayerCalendarProps = {
  playerId: number;
  initialItems: ProgramItemRow[];
  initialStartDate: string;
  initialEndDate: string;
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
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function categoryBubbleStyle(category: string): CSSProperties {
  const hue = hashString(category) % 360;
  return {
    borderColor: `hsla(${hue}, 88%, 64%, 0.7)`,
    background: `hsla(${hue}, 82%, 52%, 0.2)`,
  };
}

export default function PlayerCalendar({ playerId, initialItems, initialStartDate, initialEndDate }: PlayerCalendarProps) {
  const [view, setView] = useState<ViewMode>('month');
  const [anchorDate, setAnchorDate] = useState<string>(toIsoDate(new Date()));
  const [items, setItems] = useState<ProgramItemRow[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedItem, setSelectedItem] = useState<ProgramItemRow | null>(null);
  const consumedInitialRef = useRef(false);

  const visibleRange = useMemo(() => {
    if (view === 'day') return { startDate: anchorDate, endDate: addDays(anchorDate, 1) };
    if (view === 'week') return { startDate: startOfWeek(anchorDate), endDate: endOfWeekExclusive(anchorDate) };
    const monthStart = startOfMonth(anchorDate);
    const monthEnd = endOfMonthExclusive(anchorDate);
    return { startDate: monthStart, endDate: monthEnd, monthStart };
  }, [anchorDate, view]);

  const loadItems = useCallback(async () => {
    const isInitialRange = visibleRange.startDate === initialStartDate && visibleRange.endDate === initialEndDate;
    if (!consumedInitialRef.current && isInitialRange) {
      consumedInitialRef.current = true;
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
      const response = await fetch(`/api/player/program-items?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as { items?: ProgramItemRow[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load program items.');
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load program items.');
    } finally {
      setLoading(false);
    }
  }, [initialEndDate, initialStartDate, playerId, visibleRange.endDate, visibleRange.startDate]);

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
      const endText = fromIsoDate(end).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
      return `${startText} - ${endText}`;
    }
    return anchor.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }, [anchorDate, view]);

  const movePeriod = (direction: -1 | 1) => {
    if (view === 'day') {
      setAnchorDate((prev) => addDays(prev, direction));
      return;
    }
    if (view === 'week') {
      setAnchorDate((prev) => addDays(prev, direction * 7));
      return;
    }

    const date = fromIsoDate(anchorDate);
    date.setUTCMonth(date.getUTCMonth() + direction);
    setAnchorDate(toIsoDate(date));
  };

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
                width: 'calc(100% - 0.35rem)',
                margin: '0 auto',
                boxSizing: 'border-box',
                textAlign: 'center',
                color: 'var(--text-main)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '6px',
                padding: '0.35rem 0.45rem',
                ...categoryBubbleStyle(item.workoutCategory ?? item.exerciseCategory ?? 'Workout'),
              }}
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

  return (
    <div className="portal-admin-stack">
      <div className="portal-schedule-toolbar">
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

      <section className="portal-schedule-calendar" aria-busy={loading}>
        <h3 className="portal-schedule-period">{periodLabel}</h3>
        {view !== 'day' && (
          <div
            className="portal-schedule-weekdays"
            style={{
              borderTop: '1px solid rgba(255,255,255,0.26)',
              borderLeft: '1px solid rgba(255,255,255,0.26)',
            }}
          >
            {WEEKDAY_LABELS.map((label) => (
              <span
                key={label}
                style={{
                  borderRight: '1px solid rgba(255,255,255,0.26)',
                  borderBottom: '1px solid rgba(255,255,255,0.26)',
                  padding: '0.35rem 0.25rem',
                }}
              >
                {label}
              </span>
            ))}
          </div>
        )}

        {view === 'month' && (
          <div
            className="portal-schedule-month-grid"
            style={{
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
              borderLeft: '1px solid rgba(255,255,255,0.26)',
            }}
          >
            {weekCells.map((date) => renderDayCell(date, false))}
          </div>
        )}

        {view === 'day' && <div className="portal-schedule-day-grid">{dayCells.map((date) => renderDayCell(date, false, undefined, true))}</div>}
      </section>

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

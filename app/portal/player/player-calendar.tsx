'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { ProgramItemRow } from '../../../lib/training-db';
import WorkoutLogModal from '../components/workout-log-modal';

type ViewMode = 'day' | 'week' | 'month' | 'cycle' | 'plan';
const CALENDAR_SUB_MODES: ViewMode[] = ['day', 'week', 'month'];
const PLAN_SECTIONS: Array<{ key: 'daily_prep' | 'throwing' | 'post_throw_arm_care' | 's_and_c' | 'movement_mobility'; label: string }> = [
  { key: 'daily_prep', label: 'Daily Prep' },
  { key: 'throwing', label: 'Throwing' },
  { key: 'post_throw_arm_care', label: 'Post-Throw Arm Care' },
  { key: 's_and_c', label: 'S&C' },
  { key: 'movement_mobility', label: 'Movement and Mobility' },
];

type PlayerCalendarProps = {
  playerId: number;
  initialItems: ProgramItemRow[];
  initialStartDate: string;
  initialEndDate: string;
  initialView?: ViewMode;
  initialAnchorDate?: string;
  previewPlayerId?: number | null;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CYCLE_COLUMNS: Array<{ key: 'medium' | 'high' | 'low' | 'mobility' | 's_and_c'; label: string }> = [
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'low', label: 'Low' },
  { key: 'mobility', label: 'Mobility' },
  { key: 's_and_c', label: 'S&C' },
];

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

function isThrowingCalendarWorkoutName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'throwing calendar' || normalized === 'throwing' || normalized.includes('throwing calendar');
}

function isBullpenWorkoutName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'bullpen' || normalized === 'bullpens' || normalized.includes('bullpen');
}

function isVelocityWorkoutName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'velocity plan' || normalized === 'velocity' || normalized.includes('velocity');
}

function isDrillsWorkoutName(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[‐‑‒–—−-]+/g, ' ').replace(/\s+/g, ' ');
  return normalized === 'drills'
    || normalized.includes('throwing drills')
    || normalized.includes('pre throw drills')
    || normalized.includes('mound drills');
}

function getCalendarLinkTarget(item: ProgramItemRow): 'none' | 'throwing' | 'bullpens' | 'velocity' | 'drills' {
  if (item.calendarLinkTarget && item.calendarLinkTarget !== 'none') return item.calendarLinkTarget;
  if (isThrowingCalendarWorkoutName(item.itemName)) return 'throwing';
  if (isBullpenWorkoutName(item.itemName)) return 'bullpens';
  if (isVelocityWorkoutName(item.itemName)) return 'velocity';
  if (isDrillsWorkoutName(item.itemName)) return 'drills';
  return 'none';
}

export default function PlayerCalendar({
  playerId,
  initialItems,
  initialStartDate,
  initialEndDate,
  initialView = 'day',
  initialAnchorDate,
  previewPlayerId = null,
}: PlayerCalendarProps) {
  const router = useRouter();
  const query = previewPlayerId && Number.isFinite(previewPlayerId) && previewPlayerId > 0 ? `?previewPlayerId=${previewPlayerId}` : '';
  const [view, setView] = useState<ViewMode>(initialView);
  // Remembers which day/week/month sub-mode "Calendar" should return to when
  // the top-level switch is Calendar/Cycle/Plan -- day/week/month remain
  // real ViewMode values throughout this file, this only affects what the
  // top button row shows as selected.
  const [calendarSubMode, setCalendarSubMode] = useState<ViewMode>(CALENDAR_SUB_MODES.includes(initialView) ? initialView : 'day');
  const [anchorDate, setAnchorDate] = useState<string>(initialAnchorDate ?? toIsoDate(new Date()));
  const [items, setItems] = useState<ProgramItemRow[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedItem, setSelectedItem] = useState<ProgramItemRow | null>(null);
  const [catchPlayNotes, setCatchPlayNotes] = useState<{ highDay: string; mediumDay: string; lowDay: string }>({ highDay: '', mediumDay: '', lowDay: '' });
  const [cycleNotes, setCycleNotes] = useState('');
  const [planSectionNotes, setPlanSectionNotes] = useState<Record<string, string> | null>(null);
  const consumedInitialRef = useRef(false);
  const loadedThrowingNotesRef = useRef(false);

  useEffect(() => {
    loadedThrowingNotesRef.current = false;
    setCatchPlayNotes({ highDay: '', mediumDay: '', lowDay: '' });
    setCycleNotes('');
    setPlanSectionNotes(null);
  }, [playerId, previewPlayerId]);

  const visibleRange = useMemo(() => {
    if (view === 'cycle' || view === 'plan') return { startDate: anchorDate, endDate: addDays(anchorDate, 1) };
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
      if (view === 'cycle') {
        const params = new URLSearchParams({
          playerId: String(playerId),
        });
        const response = await fetch(`/api/player/cycle-items?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as { items?: ProgramItemRow[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load 3-Day Cycle.');
        setItems(Array.isArray(payload.items) ? payload.items : []);
        return;
      }
      if (view === 'plan') {
        const params = new URLSearchParams({
          playerId: String(playerId),
        });
        const response = await fetch(`/api/player/plan-items?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as {
          items?: ProgramItemRow[];
          sectionNotes?: Record<string, string>;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load Training Program.');
        setItems(Array.isArray(payload.items) ? payload.items : []);
        setPlanSectionNotes(payload.sectionNotes ?? null);
        return;
      }
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
  }, [initialEndDate, initialStartDate, playerId, view, visibleRange.endDate, visibleRange.startDate]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    let cancelled = false;
    if (view !== 'cycle' && !selectedItem) return () => { cancelled = true; };
    if (loadedThrowingNotesRef.current) return () => { cancelled = true; };
    loadedThrowingNotesRef.current = true;
    const playerIdParam = previewPlayerId && Number.isFinite(previewPlayerId) && previewPlayerId > 0
      ? `?playerId=${previewPlayerId}`
      : '';
    fetch(`/api/player/throwing${playerIdParam}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const notes = data.catchPlayNotes;
        if (notes && typeof notes === 'object') {
          setCatchPlayNotes({ highDay: String(notes.highDay ?? ''), mediumDay: String(notes.mediumDay ?? ''), lowDay: String(notes.lowDay ?? '') });
        }
        setCycleNotes(String(data.cycleNotes ?? ''));
      })
      .catch(() => {
        loadedThrowingNotesRef.current = false;
      });
    return () => { cancelled = true; };
  }, [previewPlayerId, selectedItem, view]);

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
    if (view === 'cycle') return '3-Day Cycle';
    if (view === 'plan') return 'Training Program';
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
    if (view === 'cycle' || view === 'plan') return;
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
        className={`portal-schedule-day${compact ? ' is-compact' : ''}${view === 'week' ? ' is-week' : ''}${isOutsideMonth ? ' is-outside' : ''}${today ? ' is-today' : ''}`}
        style={{
          minHeight: view === 'week' ? '128px' : '220px',
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
              title={item.itemName}
              style={{
                minWidth: 0,
                width: 'calc(100% - 0.35rem)',
                margin: '0 auto',
                boxSizing: 'border-box',
                textAlign: 'center',
                color: 'var(--text-main)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '6px',
                padding: '0.24rem 0.4rem',
                ...categoryBubbleStyle(item.workoutCategory ?? item.exerciseCategory ?? 'Workout'),
              }}
              onClick={() => {
                const linkTarget = getCalendarLinkTarget(item);
                if (linkTarget === 'throwing') {
                  const dateParam = item.dayDate ?? anchorDate;
                  const sep = query ? '&' : '?';
                  router.push(`/portal/player/program/throwing${query}${sep}date=${dateParam}`);
                  return;
                }
                if (linkTarget === 'bullpens') {
                  router.push(`/portal/player/program/bullpens${query}`);
                  return;
                }
                if (linkTarget === 'velocity') {
                  router.push(`/portal/player/program/velocity${query}`);
                  return;
                }
                if (linkTarget === 'drills') {
                  router.push(`/portal/player/program/drills${query}`);
                  return;
                }
                setSelectedItem(item);
              }}
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

  const isCalendarActive = CALENDAR_SUB_MODES.includes(view);

  return (
    <div className="portal-admin-stack">
      <div className="portal-schedule-toolbar">
        <div className="portal-schedule-view-switch" role="group" aria-label="Calendar view">
          <button
            type="button"
            className={`btn ${isCalendarActive ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setView(calendarSubMode)}
          >
            Calendar
          </button>
          <button
            type="button"
            className={`btn ${view === 'plan' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setView('plan')}
          >
            Training Program
          </button>
        </div>
        {isCalendarActive && (
          <div className="portal-schedule-view-switch" role="group" aria-label="Calendar sub-view">
            {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`btn ${view === mode ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => {
                  setView(mode);
                  setCalendarSubMode(mode);
                }}
              >
                {`${mode[0].toUpperCase()}${mode.slice(1)}`}
              </button>
            ))}
          </div>
        )}
        {view !== 'cycle' && view !== 'plan' && (
          <div className="portal-schedule-nav">
            <button type="button" className="btn btn-ghost" onClick={() => movePeriod(-1)}>
              Prev
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => movePeriod(1)}>
              Next
            </button>
          </div>
        )}
      </div>

      <section className="portal-schedule-calendar" aria-busy={loading}>
        <h3 className="portal-schedule-period">{periodLabel}</h3>
        {view !== 'day' && view !== 'cycle' && view !== 'plan' && (
          <div
            className={`portal-schedule-weekdays${view === 'week' ? ' is-week' : ''}`}
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
                  padding: view === 'week' ? '0.12rem 0.2rem' : '0.35rem 0.25rem',
                  lineHeight: 1.05,
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
        {view === 'plan' && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {PLAN_SECTIONS.map((section) => {
              const sectionItems = items.filter((item) => item.scheduleType === 'plan' && item.planSection === section.key);
              const note = planSectionNotes?.[section.key]?.trim() ?? '';
              return (
                <article key={section.key} className="portal-panel">
                  <h4 style={{ marginTop: 0 }}>{section.label}</h4>
                  {note ? (
                    <section className="portal-cycle-notes-panel" style={{ marginBottom: '0.6rem' }}>
                      <strong>Notes</strong>
                      <p className="portal-muted-text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{note}</p>
                    </section>
                  ) : null}
                  <div style={{ display: 'grid', gap: '0.45rem' }}>
                    {sectionItems.map((item) => {
                      // completedCount is stripped server-side for player
                      // sessions -- its presence here IS the "am I a coach
                      // viewing this" signal, no separate role prop needed.
                      const showTally = item.completedCount !== null;
                      return (
                        <button
                          key={item.itemId}
                          type="button"
                          className="portal-schedule-item"
                          title={item.itemName}
                          style={{
                            minWidth: 0,
                            width: '100%',
                            textAlign: 'left',
                            color: 'var(--text-main)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: '6px',
                            padding: '0.4rem 0.6rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.5rem',
                            ...categoryBubbleStyle(item.workoutCategory ?? 'Workout'),
                          }}
                          onClick={() => {
                            const linkTarget = getCalendarLinkTarget(item);
                            if (linkTarget === 'throwing') {
                              const sep = query ? '&' : '?';
                              router.push(`/portal/player/program/throwing${query}${sep}date=${item.dayDate}`);
                              return;
                            }
                            if (linkTarget === 'bullpens') {
                              router.push(`/portal/player/program/bullpens${query}`);
                              return;
                            }
                            if (linkTarget === 'velocity') {
                              router.push(`/portal/player/program/velocity${query}`);
                              return;
                            }
                            if (linkTarget === 'drills') {
                              router.push(`/portal/player/program/drills${query}`);
                              return;
                            }
                            setSelectedItem(item);
                          }}
                        >
                          <strong>{item.itemName}</strong>
                          {showTally ? (
                            <span className="portal-muted-text" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                              {item.targetCount
                                ? `Completed ${item.completedCount}/${item.targetCount}`
                                : `Completed ${item.completedCount} time${item.completedCount === 1 ? '' : 's'}`}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                    {sectionItems.length === 0 && (
                      <p className="portal-muted-text" style={{ margin: 0 }}>
                        No workouts assigned
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
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
          catchPlayNote={
            selectedItem.cycleSlot === 'high' || /\bhigh\b/i.test(selectedItem.itemName) ? catchPlayNotes.highDay
              : selectedItem.cycleSlot === 'medium' || /\bmedium\b/i.test(selectedItem.itemName) ? catchPlayNotes.mediumDay
              : selectedItem.cycleSlot === 'low' || /\blow\b/i.test(selectedItem.itemName) ? catchPlayNotes.lowDay
              : undefined
          }
        />
      )}
    </div>
  );
}

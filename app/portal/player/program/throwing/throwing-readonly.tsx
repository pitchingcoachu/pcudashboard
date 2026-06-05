'use client';

import { useMemo, useState } from 'react';

type ThrowingDayEntry = { intensity: string; distance: string; throwsText: string; drills: string; bullpen: string };

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toIsoDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
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
function startOfMonth(value: string): string {
  const date = fromIsoDate(value);
  date.setUTCDate(1);
  return toIsoDate(date);
}
function makeMonthGrid(anchor: string): Array<string> {
  const first = startOfMonth(anchor);
  const firstDate = fromIsoDate(first);
  const leading = firstDate.getUTCDay();
  const result: string[] = [];
  const start = addDays(first, -leading);
  for (let i = 0; i < 35; i += 1) result.push(addDays(start, i));
  return result;
}

export default function ThrowingReadonly({
  byDate,
  weekNotes,
  initialDate,
}: {
  byDate: Record<string, ThrowingDayEntry>;
  weekNotes: Record<string, string>;
  initialDate?: string;
}) {
  const [view, setView] = useState<'month' | 'week' | 'day'>(initialDate ? 'day' : 'month');
  const [anchorDate, setAnchorDate] = useState(() => {
    if (initialDate) return initialDate;
    const dates = Object.keys(byDate).sort();
    return dates[dates.length - 1] ?? toIsoDate(new Date());
  });
  const weekStart = startOfWeek(anchorDate);
  const weekCells = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const monthCells = useMemo(() => makeMonthGrid(anchorDate), [anchorDate]);

  const move = (dir: -1 | 1) => {
    if (view === 'day') setAnchorDate((prev) => addDays(prev, dir));
    else if (view === 'week') setAnchorDate((prev) => addDays(prev, dir * 7));
    else {
      const date = fromIsoDate(anchorDate);
      date.setUTCMonth(date.getUTCMonth() + dir);
      setAnchorDate(toIsoDate(date));
    }
  };

  const periodLabel = useMemo(() => {
    if (view === 'day') {
      return `Throwing Calendar · ${fromIsoDate(anchorDate).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })}`;
    }
    if (view === 'week') {
      const start = startOfWeek(anchorDate);
      const end = addDays(start, 6);
      const startText = fromIsoDate(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
      const endText = fromIsoDate(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      return `Throwing Calendar · ${startText} - ${endText}`;
    }
    const anchor = fromIsoDate(anchorDate);
    return `Throwing Calendar · ${anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
  }, [anchorDate, view]);

  const throwingInputBaseStyle = {
    minHeight: '36px',
    padding: '0.42rem 0.55rem',
    textAlign: 'left' as const,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box' as const,
  };
  const throwingLabelStyle = {
    fontSize: '0.78rem',
    fontWeight: 700,
    color: 'var(--text-main)',
    minWidth: '74px',
    textAlign: 'left' as const,
    whiteSpace: 'nowrap' as const,
  };
  const throwingRowStyle = {
    display: 'grid',
    gridTemplateColumns: '78px 1fr',
    alignItems: 'center',
    gap: '0.32rem',
    minWidth: 0,
  };
  const throwingNotesStyle = {
    width: '100%',
    height: 'calc((36px * 4) + (0.28rem * 3))',
    minHeight: 'calc((36px * 4) + (0.28rem * 3))',
    resize: 'none' as const,
  };

  const parseIntensityValue = (raw: string): number | null => {
    const match = String(raw ?? '').match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  };
  const getThrowingCellHighlightStyle = (entry: ThrowingDayEntry) => {
    const intensity = parseIntensityValue(entry.intensity);
    if (intensity == null) return {};
    if (intensity <= 60) return { background: 'rgba(153, 27, 27, 0.30)', boxShadow: 'inset 0 0 0 1px rgba(239, 68, 68, 0.55)' };
    if (intensity >= 65 && intensity <= 85) return { background: 'rgba(202, 138, 4, 0.28)', boxShadow: 'inset 0 0 0 1px rgba(250, 204, 21, 0.55)' };
    if (intensity >= 90) return { background: 'rgba(21, 128, 61, 0.30)', boxShadow: 'inset 0 0 0 1px rgba(74, 222, 128, 0.55)' };
    return {};
  };

  const cell = (date: string) => {
    const entry = byDate[date] ?? { intensity: '', distance: '', throwsText: '', drills: '', bullpen: '' };
    return (
      <article
        key={date}
        className="portal-schedule-day portal-throwing-cell"
        style={{ minHeight: '182px', borderRadius: 0, borderRight: '1px solid var(--calendar-grid-border, var(--border))', borderBottom: '1px solid var(--calendar-grid-border, var(--border))' }}
      >
        <div className="portal-schedule-day-head">
          <span className="portal-schedule-day-num">{fromIsoDate(date).getUTCDate()}</span>
        </div>
        <div className="portal-schedule-day-body" style={{ display: 'grid', gap: '0.28rem', ...getThrowingCellHighlightStyle(entry) }}>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Intensity:</span>
            <input className="portal-throwing-field" readOnly value={entry.intensity} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Distance:</span>
            <input className="portal-throwing-field" readOnly value={entry.distance} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Throws:</span>
            <input className="portal-throwing-field" readOnly value={entry.throwsText} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Drills:</span>
            <input className="portal-throwing-field" readOnly value={entry.drills} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Bullpen:</span>
            <input className="portal-throwing-field" readOnly value={entry.bullpen} style={throwingInputBaseStyle} />
          </div>
        </div>
      </article>
    );
  };

  return (
    <section className="portal-schedule-calendar" style={{ gridColumn: '1 / -1', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.45rem' }}>
        <h3 className="portal-schedule-period">{periodLabel}</h3>
        <div className="portal-schedule-nav">
          <button type="button" className="btn btn-ghost" onClick={() => move(-1)}>←</button>
          <button type="button" className="btn btn-ghost" onClick={() => move(1)}>→</button>
        </div>
      </div>
      <div className="portal-schedule-toolbar">
        <div className="portal-schedule-view-switch" role="group" aria-label="Throwing calendar view">
          {(['day', 'week', 'month'] as const).map((mode) => (
            <button key={mode} type="button" className={`btn ${view === mode ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView(mode)}>
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div
        className="portal-schedule-weekdays is-week"
        style={{
          borderTop: '1px solid var(--calendar-grid-border, var(--border))',
          borderLeft: '1px solid var(--calendar-grid-border, var(--border))',
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr)) minmax(220px, 1.35fr)',
        }}
      >
        {[...WEEKDAY_LABELS, 'Notes'].map((label) => (
          <span key={label} style={{ borderRight: '1px solid var(--calendar-grid-border, var(--border))', borderBottom: '1px solid var(--calendar-grid-border, var(--border))', padding: '0.35rem 0.25rem', textAlign: 'center' }}>
            {label}
          </span>
        ))}
      </div>

      {view === 'day' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(220px, 1.35fr)', borderLeft: '1px solid var(--calendar-grid-border, var(--border))' }}>
          {cell(anchorDate)}
          <article className="portal-schedule-day portal-throwing-cell" style={{ minHeight: '182px', borderRadius: 0, borderRight: '1px solid var(--calendar-grid-border, var(--border))', borderBottom: '1px solid var(--calendar-grid-border, var(--border))' }}>
            <div className="portal-schedule-day-body" style={{ margin: 0 }}>
              <textarea className="portal-throwing-notes" readOnly rows={7} value={weekNotes[weekStart] || ''} style={throwingNotesStyle} />
            </div>
          </article>
        </div>
      ) : null}

      {view === 'week' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr)) minmax(220px, 1.35fr)', borderLeft: '1px solid var(--calendar-grid-border, var(--border))' }}>
          {weekCells.map((date) => cell(date))}
          <article className="portal-schedule-day portal-throwing-cell" style={{ minHeight: '182px', borderRadius: 0, borderRight: '1px solid var(--calendar-grid-border, var(--border))', borderBottom: '1px solid var(--calendar-grid-border, var(--border))' }}>
            <div className="portal-schedule-day-body" style={{ margin: 0 }}>
              <textarea className="portal-throwing-notes" readOnly rows={7} value={weekNotes[weekStart] || ''} style={throwingNotesStyle} />
            </div>
          </article>
        </div>
      ) : null}

      {view === 'month' ? (
        <div style={{ display: 'grid', gap: 0, borderLeft: '1px solid var(--calendar-grid-border, var(--border))' }}>
          {Array.from({ length: Math.ceil(monthCells.length / 7) }, (_, weekIdx) => {
            const days = monthCells.slice(weekIdx * 7, weekIdx * 7 + 7);
            const start = startOfWeek(days[0]!);
            return (
              <div key={`wk-${weekIdx}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr)) minmax(220px, 1.35fr)' }}>
                {days.map((date) => cell(date))}
                <article className="portal-schedule-day portal-throwing-cell" style={{ minHeight: '182px', borderRadius: 0, borderRight: '1px solid var(--calendar-grid-border, var(--border))', borderBottom: '1px solid var(--calendar-grid-border, var(--border))' }}>
                  <div className="portal-schedule-day-body" style={{ margin: 0 }}>
                    <textarea className="portal-throwing-notes" readOnly rows={7} value={weekNotes[start] || ''} style={throwingNotesStyle} />
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

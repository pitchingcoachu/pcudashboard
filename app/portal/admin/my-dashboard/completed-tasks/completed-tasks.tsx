'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import styles from '../coach-dashboard.module.css';
import { PRIORITY_LABEL, formatDueDate, localIsoDate, type Task } from '../task-list';

/** Local calendar date (YYYY-MM-DD) a timestamp falls on. */
function localDay(timestamp: string): string {
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function dayHeading(day: string): string {
  if (day === localIsoDate()) return 'Today';
  if (day === localIsoDate(-1)) return 'Yesterday';
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** "On time" / "3 days late" relative to the due date, or nothing when there wasn't one. */
function timeliness(task: Task): { label: string; late: boolean } | null {
  if (!task.dueDate || !task.completedAt) return null;
  const done = localDay(task.completedAt);
  if (done <= task.dueDate) return { label: `Due ${formatDueDate(task.dueDate)} · on time`, late: false };
  const days = Math.round((new Date(`${done}T12:00:00`).getTime() - new Date(`${task.dueDate}T12:00:00`).getTime()) / 86_400_000);
  return { label: `Due ${formatDueDate(task.dueDate)} · ${days} day${days === 1 ? '' : 's'} late`, late: true };
}

export default function CompletedTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/my-dashboard/tasks?status=completed', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load completed tasks.');
      setTasks(payload.tasks); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load completed tasks.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? tasks.filter((task) => [task.title, task.notes, task.playerName ?? ''].some((value) => value.toLowerCase().includes(needle))) : tasks;
  }, [tasks, query]);
  const groups = useMemo(() => {
    const byDay = new Map<string, Task[]>();
    for (const task of filtered) {
      const day = localDay(task.completedAt ?? task.updatedAt);
      byDay.set(day, [...(byDay.get(day) ?? []), task]);
    }
    return Array.from(byDay.entries());
  }, [filtered]);
  const stats = useMemo(() => {
    const weekAgo = localIsoDate(-6);
    const dated = tasks.filter((task) => task.dueDate && task.completedAt);
    const onTime = dated.filter((task) => !timeliness(task)?.late).length;
    return {
      thisWeek: tasks.filter((task) => task.completedAt && localDay(task.completedAt) >= weekAgo).length,
      onTimeRate: dated.length ? `${Math.round((onTime / dated.length) * 100)}%` : '—',
    };
  }, [tasks]);

  async function restore(task: Task) {
    setTasks((current) => current.filter((item) => item.id !== task.id));
    const response = await fetch('/api/admin/my-dashboard/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: task.id, completed: false }) });
    if (!response.ok) { setError('Could not restore the task.'); await load(); }
  }

  async function remove(task: Task) {
    if (!window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    const response = await fetch(`/api/admin/my-dashboard/tasks?id=${task.id}`, { method: 'DELETE' });
    if (!response.ok) { setError('Could not delete the task.'); await load(); }
  }

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><p><Link href="/portal/admin/my-dashboard#tasks" className={styles.taskBackLink}>← BACK TO DASHBOARD</Link></p><h1>Completed Tasks</h1><span>Everything you&apos;ve checked off, and when.</span></div>
      <div className={styles.heroStats}><span><b>{tasks.length}</b> completed</span><span><b>{stats.thisWeek}</b> last 7 days</span><span><b>{stats.onTimeRate}</b> on time</span></div>
    </header>

    <section className={styles.taskPanel}>
      <div className={styles.noteSearch} style={{ margin: 0 }}><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search completed tasks…" aria-label="Search completed tasks"/>{query ? <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button> : null}</div>
      {error ? <p className={styles.taskError}>{error}</p> : null}
      {loading ? <p className={styles.taskEmpty}>Loading…</p> : !tasks.length ? <p className={styles.taskEmpty}>No completed tasks yet. Check one off on your dashboard and it will show up here.</p> : !filtered.length ? <p className={styles.taskEmpty}>No completed tasks match “{query}”.</p> : groups.map(([day, dayTasks]) => <div key={day} className={styles.taskDay}>
        <h3>{dayHeading(day)} <span>{dayTasks.length}</span></h3>
        <ul className={styles.taskItems}>{dayTasks.map((task) => {
          const timing = timeliness(task);
          return <li key={task.id} data-priority={task.priority} data-done="true">
            <span className={styles.taskCheck} data-checked="true" aria-hidden="true"><i>✓</i></span>
            <div className={styles.taskBody}>
              <b>{task.title}</b>
              {task.notes ? <p>{task.notes}</p> : null}
              <div className={styles.taskMeta}>
                <span className={styles.taskDoneAt}>Completed {new Date(task.completedAt ?? task.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                {timing ? <span className={styles.taskDue} data-tone={timing.late ? 'overdue' : 'done'}>{timing.label}</span> : null}
                <span className={styles.taskPriority} data-priority={task.priority}>{PRIORITY_LABEL[task.priority]}</span>
                {task.playerName ? <span className={styles.taskAthlete}>{task.playerName}</span> : null}
              </div>
            </div>
            <div className={styles.taskActions}>
              <button type="button" onClick={() => void restore(task)} title="Move back to open tasks">Restore</button>
              <button type="button" onClick={() => void remove(task)} aria-label={`Delete “${task.title}”`} title="Delete">×</button>
            </div>
          </li>;
        })}</ul>
      </div>)}
    </section>
  </main>;
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import styles from './coach-dashboard.module.css';

export type TaskPriority = 'high' | 'medium' | 'low';
export type Task = {
  id: number; title: string; notes: string; dueDate: string | null; priority: TaskPriority;
  playerId: number | null; playerName: string | null; completedAt: string | null; createdAt: string; updatedAt: string;
};
type Draft = { title: string; notes: string; dueDate: string; priority: TaskPriority; playerId: string };
type Filter = 'all' | 'overdue' | 'today' | 'week' | 'nodate';
type Sort = 'priority' | 'due' | 'newest';

export const PRIORITY_LABEL: Record<TaskPriority, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
const EMPTY_DRAFT: Draft = { title: '', notes: '', dueDate: '', priority: 'medium', playerId: '' };
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'Today' },
  { value: 'week', label: 'Next 7 days' }, { value: 'nodate', label: 'No date' },
];

/** Local calendar date as YYYY-MM-DD, offset by `days`. */
export function localIsoDate(days = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function formatDueDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

/** Due-date label and tone for an open task, e.g. "Overdue · Sep 28" or "Tomorrow". */
function dueStatus(dueDate: string | null): { label: string; tone: 'overdue' | 'today' | 'soon' | 'later' } | null {
  if (!dueDate) return null;
  const today = localIsoDate();
  if (dueDate < today) return { label: `Overdue · ${formatDueDate(dueDate)}`, tone: 'overdue' };
  if (dueDate === today) return { label: 'Due today', tone: 'today' };
  if (dueDate === localIsoDate(1)) return { label: 'Due tomorrow', tone: 'soon' };
  return { label: `Due ${formatDueDate(dueDate)}`, tone: dueDate <= localIsoDate(7) ? 'soon' : 'later' };
}

function matchesFilter(task: Task, filter: Filter): boolean {
  const today = localIsoDate();
  if (filter === 'overdue') return Boolean(task.dueDate && task.dueDate < today);
  if (filter === 'today') return task.dueDate === today;
  if (filter === 'week') return Boolean(task.dueDate && task.dueDate >= today && task.dueDate <= localIsoDate(7));
  if (filter === 'nodate') return !task.dueDate;
  return true;
}

/** Due date ascending with undated tasks last. */
const byDue = (a: Task, b: Task) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
const byPriority = (a: Task, b: Task) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
const byNewest = (a: Task, b: Task) => b.createdAt.localeCompare(a.createdAt);
const SORTS: Record<Sort, (a: Task, b: Task) => number> = {
  priority: (a, b) => byPriority(a, b) || byDue(a, b) || byNewest(a, b),
  due: (a, b) => byDue(a, b) || byPriority(a, b) || byNewest(a, b),
  newest: byNewest,
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Something went wrong.');
  return payload as T;
}

const draftBody = (draft: Draft) => ({ title: draft.title, notes: draft.notes, dueDate: draft.dueDate, priority: draft.priority, playerId: Number(draft.playerId) || null });

function PriorityPicker({ value, onChange }: { value: TaskPriority; onChange: (value: TaskPriority) => void }) {
  return <div className={styles.taskPriorityPicker} role="radiogroup" aria-label="Priority">
    {(['high', 'medium', 'low'] as TaskPriority[]).map((priority) => <button type="button" role="radio" key={priority} aria-checked={value === priority} data-priority={priority} onClick={() => onChange(priority)}>{PRIORITY_LABEL[priority]}</button>)}
  </div>;
}

/** Due date, priority, notes and athlete fields, shared by the add form and inline edit. */
function TaskDetailFields({ draft, setDraft, players, showNotes }: { draft: Draft; setDraft: (draft: Draft) => void; players: Array<{ playerId: number; fullName: string }>; showNotes: boolean }) {
  return <>
    <div className={styles.taskFieldRow}>
      <label><span>Due date</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}/></label>
      <div className={styles.taskQuickDates}>
        <button type="button" onClick={() => setDraft({ ...draft, dueDate: localIsoDate() })}>Today</button>
        <button type="button" onClick={() => setDraft({ ...draft, dueDate: localIsoDate(1) })}>Tomorrow</button>
        <button type="button" onClick={() => setDraft({ ...draft, dueDate: localIsoDate(7) })}>Next week</button>
        {draft.dueDate ? <button type="button" onClick={() => setDraft({ ...draft, dueDate: '' })}>Clear</button> : null}
      </div>
      <label><span>Priority</span><PriorityPicker value={draft.priority} onChange={(priority) => setDraft({ ...draft, priority })}/></label>
    </div>
    {showNotes ? <div className={styles.taskFieldRow}>
      <label className={styles.taskNotesField}><span>Notes</span><textarea rows={2} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Details, links, anything to remember…"/></label>
      {players.length ? <label><span>Athlete</span><select value={draft.playerId} onChange={(event) => setDraft({ ...draft, playerId: event.target.value })}><option value="">None</option>{players.map((player) => <option key={player.playerId} value={player.playerId}>{player.fullName}</option>)}</select></label> : null}
    </div> : null}
  </>;
}

export default function TaskList({ players }: { players: Array<{ playerId: number; fullName: string }> }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT), [showDetails, setShowDetails] = useState(false), [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>('all'), [sort, setSort] = useState<Sort>('priority');
  const [editingId, setEditingId] = useState<number | null>(null), [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [toast, setToast] = useState<Task | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await request<{ tasks: Task[]; completedCount: number }>('/api/admin/my-dashboard/tasks');
      setTasks(payload.tasks); setCompletedCount(payload.completedCount); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load your tasks.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(({ value }) => [value, tasks.filter((task) => matchesFilter(task, value)).length])) as Record<Filter, number>, [tasks]);
  const visible = useMemo(() => tasks.filter((task) => matchesFilter(task, filter)).sort(SORTS[sort]), [tasks, filter, sort]);

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) return;
    setAdding(true); setError('');
    try {
      const { task } = await request<{ task: Task }>('/api/admin/my-dashboard/tasks', { method: 'POST', body: JSON.stringify(draftBody(draft)) });
      setTasks((current) => [task, ...current]);
      setDraft({ ...EMPTY_DRAFT, priority: draft.priority });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not add the task.'); }
    finally { setAdding(false); }
  }

  async function setCompleted(task: Task, completed: boolean) {
    setError('');
    if (completed) {
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setCompletedCount((count) => count + 1);
      setToast(task);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 6000);
    }
    try {
      const { task: saved } = await request<{ task: Task }>('/api/admin/my-dashboard/tasks', { method: 'PATCH', body: JSON.stringify({ id: task.id, completed }) });
      if (!completed) { setTasks((current) => [saved, ...current.filter((item) => item.id !== saved.id)]); setCompletedCount((count) => Math.max(0, count - 1)); setToast(null); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update the task.'); await load(); }
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (editingId === null || !editDraft.title.trim()) return;
    setError('');
    try {
      const { task } = await request<{ task: Task }>('/api/admin/my-dashboard/tasks', { method: 'PATCH', body: JSON.stringify({ id: editingId, ...draftBody(editDraft) }) });
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      setEditingId(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the task.'); }
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`Delete “${task.title}”?`)) return;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    try { await request('/api/admin/my-dashboard/tasks?id=' + task.id, { method: 'DELETE' }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not delete the task.'); await load(); }
  }

  function startEdit(task: Task) {
    setEditingId(task.id);
    setEditDraft({ title: task.title, notes: task.notes, dueDate: task.dueDate ?? '', priority: task.priority, playerId: task.playerId ? String(task.playerId) : '' });
  }

  return <section className={styles.taskPanel} id="tasks">
    <header className={styles.taskHeader}>
      <div><small>TO DO</small><h2>Tasks</h2><span>{tasks.length ? `${tasks.length} open${counts.overdue ? ` · ${counts.overdue} overdue` : ''}${counts.today ? ` · ${counts.today} due today` : ''}` : 'Nothing open'}</span></div>
      <Link href="/portal/admin/my-dashboard/completed-tasks" className={styles.taskCompletedLink}><b>{completedCount}</b> Completed <i aria-hidden="true">→</i></Link>
    </header>

    <form className={styles.taskAdd} onSubmit={addTask}>
      <div className={styles.taskAddRow}>
        <span aria-hidden="true">＋</span>
        <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Add a task and press Enter…" aria-label="New task" maxLength={300}/>
        <button type="button" className={styles.taskDetailsToggle} aria-expanded={showDetails} onClick={() => setShowDetails((current) => !current)}>
          {draft.dueDate ? formatDueDate(draft.dueDate) : 'Date'} · {PRIORITY_LABEL[draft.priority]} <i aria-hidden="true">⌄</i>
        </button>
        <button type="submit" className={styles.taskAddButton} disabled={adding || !draft.title.trim()}>{adding ? 'Adding…' : 'Add'}</button>
      </div>
      {showDetails ? <div className={styles.taskDetails}><TaskDetailFields draft={draft} setDraft={setDraft} players={players} showNotes/></div> : null}
    </form>

    {error ? <p className={styles.taskError}>{error}</p> : null}

    {tasks.length ? <div className={styles.taskToolbar}>
      <div className={styles.taskFilters}>{FILTERS.map(({ value, label }) => <button type="button" key={value} aria-pressed={filter === value} data-alert={value === 'overdue' && counts.overdue > 0 ? 'true' : undefined} onClick={() => setFilter(value)}>{label}<span>{counts[value]}</span></button>)}</div>
      <label className={styles.taskSort}><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="priority">Priority</option><option value="due">Due date</option><option value="newest">Newest</option></select></label>
    </div> : null}

    {loading ? <p className={styles.taskEmpty}>Loading tasks…</p> : !tasks.length ? <p className={styles.taskEmpty}>No open tasks. Add one above.</p> : !visible.length ? <p className={styles.taskEmpty}>No tasks in this view.</p> : <ul className={styles.taskItems}>
      {visible.map((task) => {
        const due = dueStatus(task.dueDate);
        if (editingId === task.id) return <li key={task.id} className={styles.taskEditing}><form onSubmit={saveEdit}>
          <input className={styles.taskEditTitle} autoFocus value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} aria-label="Task title" maxLength={300}/>
          <TaskDetailFields draft={editDraft} setDraft={setEditDraft} players={players} showNotes/>
          <footer><button type="button" onClick={() => setEditingId(null)}>Cancel</button><button type="submit" disabled={!editDraft.title.trim()}>Save</button></footer>
        </form></li>;
        return <li key={task.id} data-priority={task.priority}>
          <button type="button" className={styles.taskCheck} onClick={() => void setCompleted(task, true)} aria-label={`Mark “${task.title}” complete`} title="Mark complete"><i aria-hidden="true">✓</i></button>
          <div className={styles.taskBody} onDoubleClick={() => startEdit(task)}>
            <b>{task.title}</b>
            {task.notes ? <p>{task.notes}</p> : null}
            <div className={styles.taskMeta}>
              <span className={styles.taskPriority} data-priority={task.priority}>{PRIORITY_LABEL[task.priority]}</span>
              {due ? <span className={styles.taskDue} data-tone={due.tone}>{due.label}</span> : null}
              {task.playerName ? <span className={styles.taskAthlete}>{task.playerName}</span> : null}
            </div>
          </div>
          <div className={styles.taskActions}>
            <button type="button" onClick={() => startEdit(task)} aria-label={`Edit “${task.title}”`} title="Edit">Edit</button>
            <button type="button" onClick={() => void deleteTask(task)} aria-label={`Delete “${task.title}”`} title="Delete">×</button>
          </div>
        </li>;
      })}
    </ul>}

    {toast ? <div className={styles.taskToast} role="status"><span>✓ “{toast.title}” moved to Completed</span><button type="button" onClick={() => void setCompleted(toast, false)}>Undo</button></div> : null}
  </section>;
}

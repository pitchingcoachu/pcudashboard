'use client';

import { useEffect, useMemo, useState } from 'react';

type WorkoutChoice = { id: number; name: string; category: string };
type PlayerGroupRow = { id: number; name: string; memberCount: number };
type GroupWorkoutMatch = { playerId: number; playerName: string; itemId: number };

type Props = {
  open: boolean;
  onClose: () => void;
  workouts: WorkoutChoice[];
  todayIso: string;
  /** Called after a successful assignment so the caller can refresh whatever's currently on screen (e.g. reload the selected player's items if they happen to be in the group). */
  onAssigned: () => void;
};

// A separate, explicit bulk-assign action rather than extending the
// calendar's drag-and-drop (which is threaded through a single playerId
// across a very large component) -- picks a workout, a target, and a group,
// then fans the assignment out to every member server-side in one request.
export function GroupAssignModal({ open, onClose, workouts, todayIso, onAssigned }: Props) {
  const [mode, setMode] = useState<'apply' | 'remove'>('apply');
  const [groups, setGroups] = useState<PlayerGroupRow[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [target, setTarget] = useState<'calendar' | 'plan'>('calendar');
  const [dayDate, setDayDate] = useState(todayIso);
  const [planSection, setPlanSection] = useState('daily_prep');
  const [workoutQuery, setWorkoutQuery] = useState('');
  const [workoutIds, setWorkoutIds] = useState<Set<number>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Remove mode targets exactly one workout at a time (a bulk-delete needs
  // to match a single workoutId against current group members' items --
  // multi-select doesn't make sense here the way it does for Apply).
  const [removeWorkoutId, setRemoveWorkoutId] = useState<number | null>(null);
  const [matches, setMatches] = useState<GroupWorkoutMatch[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setGroupsLoading(true);
    setError('');
    setMessage('');
    fetch('/api/admin/player-groups')
      .then((response) => response.json())
      .then((payload: { groups?: PlayerGroupRow[]; error?: string }) => {
        if (payload.groups) setGroups(payload.groups);
        else setError(payload.error ?? 'Failed to load groups.');
      })
      .catch(() => setError('Failed to load groups.'))
      .finally(() => setGroupsLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'remove' || !groupId || !removeWorkoutId) {
      setMatches([]);
      return;
    }
    setMatchesLoading(true);
    setError('');
    setMessage('');
    const params = new URLSearchParams({
      groupId: String(groupId),
      workoutId: String(removeWorkoutId),
      scheduleType: target,
      ...(target === 'calendar' ? { dayDate } : { planSection }),
    });
    fetch(`/api/admin/schedule/group-delete?${params.toString()}`)
      .then((response) => response.json())
      .then((payload: { matches?: GroupWorkoutMatch[]; error?: string }) => {
        if (payload.matches) setMatches(payload.matches);
        else setError(payload.error ?? 'Failed to look up matching items.');
      })
      .catch(() => setError('Failed to look up matching items.'))
      .finally(() => setMatchesLoading(false));
  }, [open, mode, groupId, removeWorkoutId, target, dayDate, planSection]);

  const filteredWorkouts = useMemo(() => {
    const q = workoutQuery.trim().toLowerCase();
    if (!q) return workouts;
    return workouts.filter((w) => w.name.toLowerCase().includes(q));
  }, [workouts, workoutQuery]);

  if (!open) return null;

  async function handleBulkDelete() {
    if (!groupId || !removeWorkoutId || matches.length === 0) return;
    setIsDeleting(true);
    setError('');
    setMessage('');
    try {
      const body = {
        groupId,
        workoutId: removeWorkoutId,
        scheduleType: target,
        ...(target === 'calendar' ? { dayDate } : { planSection }),
      };
      const response = await fetch('/api/admin/schedule/group-delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        succeeded?: number;
        failed?: Array<{ playerId: number; error: string }>;
        error?: string;
      };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Failed to remove workout from group.');
      const failedCount = payload.failed?.length ?? 0;
      setMessage(
        failedCount > 0
          ? `Removed from ${payload.succeeded ?? 0} player(s); ${failedCount} failed.`
          : `Removed from ${payload.succeeded ?? 0} player(s).`
      );
      setMatches([]);
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove workout from group.');
    } finally {
      setIsDeleting(false);
    }
  }

  function toggleWorkout(id: number) {
    setWorkoutIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleApply() {
    if (!groupId || workoutIds.size === 0) return;
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const path = target === 'calendar' ? '/api/admin/schedule/assignments' : '/api/admin/schedule/plan';
      const selectedWorkoutIds = Array.from(workoutIds);
      const body =
        target === 'calendar'
          ? { groupId, dayDate, workoutIds: selectedWorkoutIds }
          : { groupId, workoutIds: selectedWorkoutIds, planSection };
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        succeeded?: number;
        failed?: Array<{ playerId: number; workoutId: number; error: string }>;
        error?: string;
      };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Failed to apply workout to group.');
      const failedCount = payload.failed?.length ?? 0;
      setMessage(
        failedCount > 0
          ? `Applied ${payload.succeeded ?? 0} assignment(s); ${failedCount} failed.`
          : `Applied ${payload.succeeded ?? 0} assignment(s).`
      );
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply workout to group.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="portal-modal-backdrop" role="presentation" onClick={onClose}>
      <article
        className="portal-modal-card portal-admin-card"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        style={{ maxWidth: '520px', width: '92vw' }}
      >
        <div className="portal-modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h3 style={{ margin: 0 }}>{mode === 'apply' ? 'Apply Workout to Group' : 'Remove Workout from Group'}</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="portal-choice-line-actions" style={{ marginBottom: 4 }}>
          <button
            type="button"
            className={mode === 'apply' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => {
              setMode('apply');
              setError('');
              setMessage('');
            }}
          >
            Apply
          </button>
          <button
            type="button"
            className={mode === 'remove' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => {
              setMode('remove');
              setError('');
              setMessage('');
            }}
          >
            Remove
          </button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            Group
            <select value={groupId ?? ''} onChange={(event) => setGroupId(Number(event.target.value) || null)} disabled={groupsLoading}>
              <option value="">{groupsLoading ? 'Loading groups...' : 'Select a group'}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} ({group.memberCount})
                </option>
              ))}
            </select>
          </label>
          {!groupsLoading && groups.length === 0 ? (
            <p className="portal-muted-text">No groups yet. Create one on the Player Groups page first.</p>
          ) : null}

          <label>
            {mode === 'apply' ? 'Apply To' : 'Remove From'}
            <select value={target} onChange={(event) => setTarget(event.target.value as 'calendar' | 'plan')}>
              <option value="calendar">Calendar (a specific day)</option>
              <option value="plan">Training Program (ongoing section)</option>
            </select>
          </label>

          {target === 'calendar' ? (
            <label>
              Date
              <input type="date" value={dayDate} onChange={(event) => setDayDate(event.target.value)} />
            </label>
          ) : (
            <label>
              Plan Section
              <select value={planSection} onChange={(event) => setPlanSection(event.target.value)}>
                <option value="daily_prep">Daily Prep</option>
                <option value="throwing">Throwing</option>
                <option value="post_throw_arm_care">Post-Throw Arm Care</option>
                <option value="s_and_c">S&amp;C</option>
                <option value="movement_mobility">Movement and Mobility</option>
              </select>
            </label>
          )}

          {mode === 'apply' ? (
            <>
              <label>
                Workouts ({workoutIds.size} selected)
                <input value={workoutQuery} onChange={(event) => setWorkoutQuery(event.target.value)} placeholder="Search workouts..." />
              </label>
              <div className="portal-questionnaire-player-list" style={{ maxHeight: 220 }}>
                {filteredWorkouts.map((workout) => (
                  <label key={workout.id} className="portal-questionnaire-player-option">
                    <input type="checkbox" checked={workoutIds.has(workout.id)} onChange={() => toggleWorkout(workout.id)} />
                    <span>
                      {workout.name} <span className="portal-muted-text">· {workout.category}</span>
                    </span>
                  </label>
                ))}
                {filteredWorkouts.length === 0 ? <p className="portal-muted-text">No workouts match.</p> : null}
              </div>
            </>
          ) : (
            <>
              <label>
                Workout to Remove
                <input value={workoutQuery} onChange={(event) => setWorkoutQuery(event.target.value)} placeholder="Search workouts..." />
              </label>
              <div className="portal-questionnaire-player-list" style={{ maxHeight: 220 }}>
                {filteredWorkouts.map((workout) => (
                  <label key={workout.id} className="portal-questionnaire-player-option">
                    <input
                      type="radio"
                      name="group-remove-workout"
                      checked={removeWorkoutId === workout.id}
                      onChange={() => setRemoveWorkoutId(workout.id)}
                    />
                    <span>
                      {workout.name} <span className="portal-muted-text">· {workout.category}</span>
                    </span>
                  </label>
                ))}
                {filteredWorkouts.length === 0 ? <p className="portal-muted-text">No workouts match.</p> : null}
              </div>

              {removeWorkoutId ? (
                <div style={{ border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                  {matchesLoading ? (
                    <p className="portal-muted-text" style={{ margin: 0 }}>
                      Checking who has this assigned...
                    </p>
                  ) : matches.length === 0 ? (
                    <p className="portal-muted-text" style={{ margin: 0 }}>
                      No current group member has this workout assigned there.
                    </p>
                  ) : (
                    <>
                      <p style={{ margin: '0 0 0.4rem', fontWeight: 600 }}>
                        Will remove from {matches.length} player{matches.length === 1 ? '' : 's'}:
                      </p>
                      <p className="portal-muted-text" style={{ margin: 0 }}>
                        {matches.map((match) => match.playerName).join(', ')}
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </>
          )}

          {message ? <p className="auth-message">{message}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}

          <div className="portal-choice-line-actions">
            {mode === 'apply' ? (
              <button type="button" className="btn btn-primary" onClick={handleApply} disabled={isSaving || !groupId || workoutIds.size === 0}>
                {isSaving ? 'Applying...' : `Apply ${workoutIds.size > 1 ? `${workoutIds.size} Workouts` : 'to Group'}`}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleBulkDelete}
                disabled={isDeleting || matchesLoading || !groupId || !removeWorkoutId || matches.length === 0}
              >
                {isDeleting ? 'Removing...' : `Remove from ${matches.length} Player${matches.length === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}

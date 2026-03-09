import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import {
  getPlayerByIdInOrganization,
  listExercisesByOrganization,
  listProgramItemsForPlayerByMonth,
  listWorkoutsByOrganization,
} from '../../../../../lib/training-db';

type ProgramPageProps = {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getMonthFromParams(value: string | string[] | undefined): string {
  const asString = typeof value === 'string' ? value : '';
  if (/^\d{4}-\d{2}$/.test(asString)) return asString;
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function readMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  return { ok, error };
}

export default async function AdminProgramBuilderPage({ params, searchParams }: ProgramPageProps) {
  const session = await requirePortalSession();
  if (session.role !== 'admin') notFound();

  const { playerId: playerIdRaw } = await params;
  const playerId = Number(playerIdRaw);
  if (!Number.isFinite(playerId)) notFound();

  const player = await getPlayerByIdInOrganization({ organizationId: session.organizationId, playerId });
  if (!player) notFound();

  const query = await searchParams;
  const month = getMonthFromParams(query.month);
  const { ok, error } = readMessage(query);

  const [exercises, workouts, items] = await Promise.all([
    listExercisesByOrganization(session.organizationId),
    listWorkoutsByOrganization(session.organizationId),
    listProgramItemsForPlayerByMonth({ playerId, month }),
  ]);

  const itemsByDate = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByDate.get(item.dayDate) ?? [];
    list.push(item);
    itemsByDate.set(item.dayDate, list);
  }

  const sortedDates = Array.from(itemsByDate.keys()).sort();

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Program Builder: {player.fullName}</h2>
        <p>
          Add daily assignments and create the calendar the player will follow.
          <Link className="portal-inline-link" href={`/portal/player?previewPlayerId=${player.id}`}>
            Preview Player View
          </Link>
        </p>
      </div>

      <article className="portal-admin-card">
        <h3>Add Daily Assignment</h3>
        <form method="post" action="/api/admin/program-items" className="portal-form-grid">
          <input type="hidden" name="redirectTo" value={`/portal/admin/programs/${player.id}?month=${month}`} />
          <input type="hidden" name="playerId" value={String(player.id)} />
          <label>
            Program Name
            <input name="programName" placeholder="Current Program" />
          </label>
          <label>
            Date
            <input name="dayDate" type="date" required />
          </label>
          <label>
            Assignment Type
            <select name="assignmentType" defaultValue="workout" required>
              <option value="workout">Workout</option>
              <option value="exercise">Individual Exercise</option>
            </select>
          </label>
          <label>
            Workout
            <select name="workoutId">
              <option value="">Select...</option>
              {workouts.map((workout) => (
                <option key={workout.id} value={String(workout.id)}>
                  {workout.name} ({workout.exerciseCount} exercises)
                </option>
              ))}
            </select>
          </label>
          <label>
            Exercise/Drill
            <select name="exerciseId">
              <option value="">Select...</option>
              {exercises.map((exercise) => (
                <option key={exercise.id} value={String(exercise.id)}>
                  {exercise.name} ({exercise.category})
                </option>
              ))}
            </select>
          </label>
          <label>
            Sets
            <input name="prescribedSets" placeholder="3" />
          </label>
          <label>
            Reps
            <input name="prescribedReps" placeholder="8" />
          </label>
          <label>
            Load / Intent
            <input name="prescribedLoad" placeholder="185 lbs / high intent" />
          </label>
          <label className="portal-form-span-2">
            Notes
            <textarea name="prescribedNotes" rows={2} />
          </label>
          <button type="submit" className="btn btn-primary">
            Add To Calendar
          </button>
        </form>
        {ok && <p className="auth-message">{ok}</p>}
        {error && <p className="auth-error">{error}</p>}
      </article>

      <article className="portal-admin-card">
        <div className="portal-month-header">
          <h3>Assignments for {month}</h3>
          <form method="get">
            <label className="portal-inline-filter">
              Month
              <input type="month" name="month" defaultValue={month} />
            </label>
            <button type="submit" className="btn btn-ghost">
              Load
            </button>
          </form>
        </div>

        {sortedDates.length === 0 ? (
          <p>No assignments for this month.</p>
        ) : (
          <div className="portal-day-stack">
            {sortedDates.map((dayDate) => {
              const dayItems = itemsByDate.get(dayDate) ?? [];
              return (
                <article key={dayDate} className="portal-day-card">
                  <h4>{dayDate}</h4>
                  <ul>
                    {dayItems.map((item) => (
                      <li key={item.itemId}>
                        <strong>
                          {item.itemName} <em>({item.itemType})</em>
                        </strong>
                        <span>
                          {item.prescribedSets ?? '-'} sets x {item.prescribedReps ?? '-'} reps | {item.prescribedLoad ?? 'load N/A'}
                        </span>
                        {item.itemType === 'workout' && item.workoutExerciseNames.length > 0 && (
                          <span>Includes: {item.workoutExerciseNames.join(', ')}</span>
                        )}
                        {item.instructionVideoUrl && (
                          <a href={item.instructionVideoUrl} target="_blank" rel="noreferrer">
                            Demo Video
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        )}
      </article>
    </div>
  );
}

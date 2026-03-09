'use client';

type DeleteWorkoutFormProps = {
  workoutId: number;
  workoutName: string;
};

export default function DeleteWorkoutForm({ workoutId, workoutName }: DeleteWorkoutFormProps) {
  return (
    <form
      method="post"
      action="/api/admin/workouts/delete"
      onSubmit={(event) => {
        const ok = window.confirm(`Delete "${workoutName}"? This cannot be undone.`);
        if (!ok) event.preventDefault();
      }}
    >
      <input type="hidden" name="workoutId" value={String(workoutId)} />
      <input type="hidden" name="redirectTo" value="/portal/admin/workouts" />
      <button type="submit" className="btn btn-ghost portal-workout-action-btn">
        Delete Workout
      </button>
    </form>
  );
}

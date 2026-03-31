'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type DeleteWorkoutFormProps = {
  workoutId: number;
  workoutName: string;
};

export default function DeleteWorkoutForm({ workoutId, workoutName }: DeleteWorkoutFormProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  return (
    <form
      method="post"
      action="/api/admin/workouts/delete"
      onSubmit={async (event) => {
        event.preventDefault();
        const ok = window.confirm(`Delete "${workoutName}"? This cannot be undone.`);
        if (!ok) return;
        setIsDeleting(true);
        const form = event.currentTarget;
        const response = await fetch('/api/admin/workouts/delete', {
          method: 'POST',
          body: new FormData(form),
          headers: {
            Accept: 'application/json',
            'X-Requested-With': 'fetch',
          },
        });
        setIsDeleting(false);
        if (!response.ok) return;
        router.refresh();
      }}
    >
      <input type="hidden" name="workoutId" value={String(workoutId)} />
      <input type="hidden" name="redirectTo" value="/portal/admin/workouts" />
      <button type="submit" className="btn btn-ghost portal-workout-action-btn" disabled={isDeleting}>
        {isDeleting ? 'Deleting...' : 'Delete Workout'}
      </button>
    </form>
  );
}

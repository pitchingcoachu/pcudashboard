import type { PlayerPlanGoalRow } from './training-db';

type StoredGoalPayload = {
  schema?: string;
  objectiveText?: unknown;
  executionStat?: unknown;
  comparator?: unknown;
  targetValue?: unknown;
};

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function formatPlayerPlanGoalSummary(goal: Pick<PlayerPlanGoalRow, 'category' | 'goalDescription'>): string {
  const raw = String(goal.goalDescription ?? '').trim();
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw) as StoredGoalPayload;
    if (parsed?.schema === 'pcu_goal_v2') {
      const objective = trimString(parsed.objectiveText);
      if (objective) return objective;

      const stat = trimString(parsed.executionStat);
      const comparator = trimString(parsed.comparator);
      const target =
        parsed.targetValue === null || parsed.targetValue === undefined || Number.isNaN(Number(parsed.targetValue))
          ? ''
          : String(parsed.targetValue).trim();
      const generated = [stat, comparator, target].filter(Boolean).join(' ');
      if (generated) return generated;
    }
  } catch {
    return raw;
  }

  return raw;
}

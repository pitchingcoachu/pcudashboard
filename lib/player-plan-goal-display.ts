import type { PlayerPlanGoalRow } from './training-db';

type StoredGoalPayload = {
  schema?: string;
  category?: unknown;
  objectiveText?: unknown;
  stuffType?: unknown;
  movementAxis?: unknown;
  executionStat?: unknown;
  comparator?: unknown;
  targetValue?: unknown;
  filters?: {
    startDate?: unknown;
    endDate?: unknown;
    pitchTypes?: unknown;
    pitchResults?: unknown;
    countOptions?: unknown;
    afterCountOptions?: unknown;
    teams?: unknown;
    hand?: unknown;
    batterSide?: unknown;
    sessionType?: unknown;
  };
};

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function valueList(value: unknown): string[] {
  if (!Array.isArray(value)) return ['All'];
  const values = value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  return values.length ? values : ['All'];
}

function nonAll(values: string[]): string[] {
  return values.filter((value) => value && value !== 'All');
}

function goalStatLabel(parsed: StoredGoalPayload): string {
  const category = trimString(parsed.category);
  if (category === 'Stuff') {
    const stuffType = trimString(parsed.stuffType);
    if (stuffType === 'Movement') return trimString(parsed.movementAxis) || 'Movement';
    return stuffType || 'Stuff';
  }
  return trimString(parsed.executionStat) || trimString(parsed.objectiveText) || 'Goal';
}

function goalUnit(statLabel: string): string {
  const upper = statLabel.trim().toUpperCase();
  if (upper.includes('%')) return '%';
  if (upper === 'VELOCITY') return ' mph';
  if (upper === 'IVB' || upper === 'HB') return '"';
  if (upper === 'SPIN RATE') return ' rpm';
  if (upper === 'EXTENSION' || upper === 'RELEASE HEIGHT' || upper === 'RELEASE SIDE') return ' ft';
  return '';
}

function formatTarget(parsed: StoredGoalPayload, statLabel: string): string {
  if (parsed.targetValue === null || parsed.targetValue === undefined || Number.isNaN(Number(parsed.targetValue))) return '-';
  const raw = String(parsed.targetValue).trim();
  if (!raw) return '-';
  return `${raw}${goalUnit(statLabel)}`;
}

function formatStoredGoal(parsed: StoredGoalPayload): string {
  const filters = parsed.filters ?? {};
  const comparator = trimString(parsed.comparator) === 'Less Than' ? 'Decrease' : 'Increase';
  const statLabel = goalStatLabel(parsed);
  const pitchTypes = nonAll(valueList(filters.pitchTypes));
  const target = formatTarget(parsed, statLabel);
  const parts: string[] = [];

  const pitchTypePhrase = pitchTypes.length === 1 ? `${pitchTypes[0]} ` : '';
  if (pitchTypes.length > 1) parts.push(`for ${pitchTypes.join(', ')}`);

  const pitchResults = nonAll(valueList(filters.pitchResults));
  if (pitchResults.length) parts.push(`on ${pitchResults.join(', ')} results`);

  const countValues = nonAll(valueList(filters.countOptions));
  if (countValues.length) parts.push(`in ${countValues.join(', ')} counts`);

  const afterCountValues = nonAll(valueList(filters.afterCountOptions));
  if (afterCountValues.length) parts.push(`after ${afterCountValues.join(', ')} counts`);

  const batterSide = trimString(filters.batterSide);
  if (batterSide === 'Left') parts.push('against LHH');
  if (batterSide === 'Right') parts.push('against RHH');

  const hand = trimString(filters.hand);
  if (hand === 'Left') parts.push('vs LHP');
  if (hand === 'Right') parts.push('vs RHP');

  const teams = nonAll(valueList(filters.teams));
  if (teams.length) parts.push(`for team filter ${teams.join(', ')}`);

  const suffix = parts.length ? ` ${parts.join(' ')}` : '';
  return `${comparator} ${pitchTypePhrase}${statLabel} to ${target}${suffix}`.replace(/\s+/g, ' ').trim();
}

export function formatPlayerPlanGoalSummary(goal: Pick<PlayerPlanGoalRow, 'category' | 'goalDescription'>): string {
  const raw = String(goal.goalDescription ?? '').trim();
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw) as StoredGoalPayload;
    if (parsed?.schema === 'pcu_goal_v2') {
      const generated = formatStoredGoal(parsed);
      if (generated) return generated;
    }
  } catch {
    return raw;
  }

  return raw;
}

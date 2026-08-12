import {
  DEFAULT_DRILL_ROW_COUNT,
  defaultDrillSectionState,
  normalizeDrillSectionState,
  normalizeDrillTemplates,
  type DrillRow,
  type DrillSectionState,
  type DrillTemplate,
} from './drills-program';

export type { DrillRow, DrillSectionState, DrillTemplate };
export { DEFAULT_DRILL_ROW_COUNT, normalizeDrillTemplates };

export type HittingDrillsState = {
  notes: string;
  main: DrillSectionState;
};

export function defaultHittingDrillsState(): HittingDrillsState {
  return { notes: '', main: defaultDrillSectionState() };
}

export function normalizeHittingDrillsState(raw: unknown): HittingDrillsState {
  if (!raw || typeof raw !== 'object') return defaultHittingDrillsState();
  const value = raw as Record<string, unknown>;
  return {
    notes: String(value.notes ?? ''),
    main: normalizeDrillSectionState(value.main ?? value),
  };
}

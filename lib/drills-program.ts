export type DrillRow = {
  drill: string;
  sets: string;
  reps: string;
  weight: string;
  notes: string;
};

export type DrillTemplate = {
  id: string;
  name: string;
  rowCount: number;
  rows: DrillRow[];
  updatedAt: string;
};

export type DrillSectionState = {
  rowCount: number;
  rows: DrillRow[];
  selectedTemplateId: string;
};

export type DrillsState = {
  notes: string;
  pre: DrillSectionState;
  post: DrillSectionState;
};

export const DEFAULT_DRILL_ROW_COUNT = 4;
export const MAX_DRILL_ROWS = 200;

export function emptyDrillRow(): DrillRow {
  return { drill: '', sets: '', reps: '', weight: '', notes: '' };
}

export function normalizeDrillRows(raw: unknown, rowCount: number): DrillRow[] {
  const count = Math.max(1, Math.min(MAX_DRILL_ROWS, Number(rowCount) || DEFAULT_DRILL_ROW_COUNT));
  const source = Array.isArray(raw) ? raw : [];
  const rows = source.slice(0, count).map((row) => {
    const value = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    return {
      drill: String(value.drill ?? ''),
      sets: String(value.sets ?? ''),
      reps: String(value.reps ?? ''),
      weight: String(value.weight ?? ''),
      notes: String(value.notes ?? ''),
    };
  });
  while (rows.length < count) rows.push(emptyDrillRow());
  return rows;
}

export function defaultDrillSectionState(): DrillSectionState {
  return {
    rowCount: DEFAULT_DRILL_ROW_COUNT,
    rows: normalizeDrillRows([], DEFAULT_DRILL_ROW_COUNT),
    selectedTemplateId: '',
  };
}

export function normalizeDrillSectionState(raw: unknown): DrillSectionState {
  if (!raw || typeof raw !== 'object') return defaultDrillSectionState();
  const value = raw as Record<string, unknown>;
  const rowCount = Math.max(1, Math.min(MAX_DRILL_ROWS, Number(value.rowCount ?? DEFAULT_DRILL_ROW_COUNT) || DEFAULT_DRILL_ROW_COUNT));
  return {
    rowCount,
    rows: normalizeDrillRows(value.rows, rowCount),
    selectedTemplateId: String(value.selectedTemplateId ?? '').trim(),
  };
}

export function normalizeDrillsState(raw: unknown): DrillsState {
  if (!raw || typeof raw !== 'object') {
    return { notes: '', pre: defaultDrillSectionState(), post: defaultDrillSectionState() };
  }
  const value = raw as Record<string, unknown>;
  if ('pre' in value || 'post' in value) {
    return {
      notes: String(value.notes ?? ''),
      pre: normalizeDrillSectionState(value.pre),
      post: normalizeDrillSectionState(value.post),
    };
  }
  // Existing single-section plans become the pre-throw plan.
  return {
    notes: String(value.notes ?? ''),
    pre: normalizeDrillSectionState(value),
    post: defaultDrillSectionState(),
  };
}

export function normalizeDrillTemplates(raw: unknown): DrillTemplate[] {
  const source = Array.isArray(raw) ? raw : [];
  return source
    .map((item) => {
      const value = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const rowCount = Math.max(1, Math.min(MAX_DRILL_ROWS, Number(value.rowCount ?? DEFAULT_DRILL_ROW_COUNT) || DEFAULT_DRILL_ROW_COUNT));
      return {
        id: String(value.id ?? '').trim(),
        name: String(value.name ?? '').trim(),
        rowCount,
        rows: normalizeDrillRows(value.rows, rowCount),
        updatedAt: String(value.updatedAt ?? ''),
      };
    })
    .filter((template) => template.id && template.name);
}

export type BubbleCategoryDef = {
  id: string;
  label: string;
  options: string[];
  updatedAt: string;
};

export const MAX_BUBBLE_CATEGORY_OPTIONS = 12;

/** Trims, dedupes (case-insensitive), and drops blank option strings, capping
 * the list at MAX_BUBBLE_CATEGORY_OPTIONS -- order is preserved since option
 * order drives display/legend order in graphs. */
export function normalizeBubbleCategoryOptions(raw: unknown): string[] {
  const source = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const options: string[] = [];
  for (const item of source) {
    const trimmed = String(item ?? '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(trimmed);
    if (options.length >= MAX_BUBBLE_CATEGORY_OPTIONS) break;
  }
  return options;
}

export function normalizeBubbleCategoryLabel(raw: unknown): string {
  return String(raw ?? '').trim().slice(0, 120);
}

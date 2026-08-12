// Shared by Bullpens and Hitting column-type handling (web admin builder +
// player entry/graphs). A "bubble" column type is a tagged string --
// "bubble:<categoryId>" -- referencing a row in bubble_category_defs, rather
// than a bare hardcoded type like 'strike'/'two-thirds'. This keeps
// columnTypes a flat string[] (matching every existing consumer, including
// the __templateColumnTypes JSON snapshot already embedded in immutable
// historical bullpen_log_entries rows) while still letting a column
// reference an arbitrary, user-defined set of options.
const BUBBLE_TYPE_PREFIX = 'bubble:';

export function isBubbleColumnType(type: string): boolean {
  return type.startsWith(BUBBLE_TYPE_PREFIX);
}

export function bubbleCategoryIdFromType(type: string): string | null {
  if (!isBubbleColumnType(type)) return null;
  const id = type.slice(BUBBLE_TYPE_PREFIX.length).trim();
  return id || null;
}

export function bubbleColumnType(categoryId: string): string {
  return `${BUBBLE_TYPE_PREFIX}${categoryId}`;
}

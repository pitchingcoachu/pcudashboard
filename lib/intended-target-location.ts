export const INTENDED_STRIKE_LEFT = -0.88;
export const INTENDED_STRIKE_RIGHT = 0.88;
export const INTENDED_STRIKE_BOTTOM = 1.5;
export const INTENDED_STRIKE_TOP = 3.6;
export const INTENDED_STRIKE_CENTER_X = (INTENDED_STRIKE_LEFT + INTENDED_STRIKE_RIGHT) / 2;
export const INTENDED_STRIKE_CENTER_Y = (INTENDED_STRIKE_BOTTOM + INTENDED_STRIKE_TOP) / 2;

/** Assign the center of an intended target to the dashboard's 13 locations.
 * 1–9 are the standard 3x3 strike-zone pockets, numbered left-to-right and
 * top-to-bottom. A center outside that grid is assigned to one of the four
 * outer quadrants: 10 top-left, 11 top-right, 12 bottom-left, 13 bottom-right. */
export function intendedTargetLocation(sideFt: number, heightFt: number): number {
  const inside = sideFt >= INTENDED_STRIKE_LEFT && sideFt <= INTENDED_STRIKE_RIGHT
    && heightFt >= INTENDED_STRIKE_BOTTOM && heightFt <= INTENDED_STRIKE_TOP;
  if (!inside) {
    const left = sideFt < INTENDED_STRIKE_CENTER_X;
    const top = heightFt >= INTENDED_STRIKE_CENTER_Y;
    if (top) return left ? 10 : 11;
    return left ? 12 : 13;
  }

  const pocketWidth = (INTENDED_STRIKE_RIGHT - INTENDED_STRIKE_LEFT) / 3;
  const pocketHeight = (INTENDED_STRIKE_TOP - INTENDED_STRIKE_BOTTOM) / 3;
  const column = Math.min(2, Math.floor((sideFt - INTENDED_STRIKE_LEFT) / pocketWidth));
  const rowFromBottom = Math.min(2, Math.floor((heightFt - INTENDED_STRIKE_BOTTOM) / pocketHeight));
  const rowFromTop = 2 - rowFromBottom;
  return (rowFromTop * 3) + column + 1;
}

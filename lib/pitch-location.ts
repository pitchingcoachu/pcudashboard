export type PitchLocationLabel = 'Yes' | 'Competitive' | 'No';

const STRIKE_ZONE_LEFT_FT = -0.88;
const STRIKE_ZONE_RIGHT_FT = 0.88;
const STRIKE_ZONE_BOTTOM_FT = 1.5;
const STRIKE_ZONE_TOP_FT = 3.6;
const COMPETITIVE_RADIUS_FT = 1.5;

export function pitchLocationLabel(x: number | null, y: number | null): PitchLocationLabel {
  if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return 'No';

  const inZone =
    x >= STRIKE_ZONE_LEFT_FT &&
    x <= STRIKE_ZONE_RIGHT_FT &&
    y >= STRIKE_ZONE_BOTTOM_FT &&
    y <= STRIKE_ZONE_TOP_FT;
  if (inZone) return 'Yes';

  const strikeCenterX = (STRIKE_ZONE_LEFT_FT + STRIKE_ZONE_RIGHT_FT) / 2;
  const strikeCenterY = (STRIKE_ZONE_BOTTOM_FT + STRIKE_ZONE_TOP_FT) / 2;
  const competitive =
    x >= strikeCenterX - COMPETITIVE_RADIUS_FT &&
    x <= strikeCenterX + COMPETITIVE_RADIUS_FT &&
    y >= strikeCenterY - COMPETITIVE_RADIUS_FT &&
    y <= strikeCenterY + COMPETITIVE_RADIUS_FT;

  return competitive ? 'Competitive' : 'No';
}

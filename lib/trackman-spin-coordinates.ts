export type SpinVector3 = { x: number; y: number; z: number };

export type TrackManAxis = 'X' | 'Y' | 'Z';

/**
 * Convert TrackMan's stored 3D-spin coordinates into the field scene used by
 * the baseball renderer. The scene uses X across the field, Y mound-to-plate,
 * and Z vertically, so TrackMan XYZ is represented as scene ZXY.
 */
export function trackManSpinVectorToScene(vector: SpinVector3): SpinVector3 {
  return { x: vector.z, y: vector.x, z: vector.y };
}

/** Map a TrackMan Euler rotation axis through the same proper ZXY transform. */
export function trackManEulerAxisToScene(axis: TrackManAxis): SpinVector3 {
  if (axis === 'X') return { x: 0, y: 1, z: 0 };
  if (axis === 'Y') return { x: 0, y: 0, z: 1 };
  return { x: 1, y: 0, z: 0 };
}

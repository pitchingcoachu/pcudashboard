export const EXPECTED_MOVEMENT_MODEL_VERSION = 'magnus-v1';

const BALL_RADIUS_METERS = 0.0366;
const BALL_MASS_KG = 0.145;
const STANDARD_AIR_DENSITY_KG_M3 = 1.225;
const BALL_AREA_M2 = Math.PI * BALL_RADIUS_METERS * BALL_RADIUS_METERS;
const MAGNUS_K =
  (0.5 * STANDARD_AIR_DENSITY_KG_M3 * BALL_AREA_M2) / BALL_MASS_KG;
const LIFT_A = 0.336;
const LIFT_B = 6.041;
const MPH_TO_METERS_PER_SECOND = 0.44704;
const FEET_TO_METERS = 0.3048;
const METERS_TO_INCHES = 39.3700787402;
const RUBBER_TO_PLATE_POINT_FEET = 60.5;
const PLATE_DEPTH_FEET = 17 / 12;

export type ExpectedMovementInput = {
  velocityMph: unknown;
  spinRateRpm: unknown;
  measuredTilt: unknown;
  extensionFeet: unknown;
  spinEfficiency?: unknown;
  activeSpinRpm?: unknown;
};

export type ExpectedMovementResult = {
  expectedHb: number;
  expectedIvb: number;
  activeSpinRpm: number;
  spinEfficiency: number;
  modelVersion: typeof EXPECTED_MOVEMENT_MODEL_VERSION;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.replace(/[%\s,]/g, '').match(/[-+]?[0-9]*\.?[0-9]+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSpinEfficiency(value: unknown): number | null {
  const parsed = finiteNumber(value);
  if (parsed === null || parsed < 0) return null;
  const normalized = parsed > 1 ? parsed / 100 : parsed;
  return normalized >= 0 && normalized <= 1 ? normalized : null;
}

/**
 * Converts TrackMan measured tilt to its numeric degree convention:
 * 180° = 12:00, 270° = 3:00, 0° = 6:00, 90° = 9:00.
 */
export function measuredTiltDegrees(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const clock = raw.match(/^(\d{1,2})\s*[:.]\s*(\d{1,2})$/);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    const totalMinutes = (hour % 12) * 60 + minute;
    return ((totalMinutes / 2 - 180) % 360 + 360) % 360;
  }
  const degrees = finiteNumber(raw);
  if (degrees === null) return null;
  return ((degrees % 360) + 360) % 360;
}

/**
 * Magnus-only induced movement using the Nathan lift model and standard atmosphere.
 * The output follows the existing TrackMan HB/IVB coordinate convention.
 */
export function calculateExpectedMovement(
  input: ExpectedMovementInput
): ExpectedMovementResult | null {
  const velocityMph = finiteNumber(input.velocityMph);
  const totalSpinRpm = finiteNumber(input.spinRateRpm);
  const extensionFeet = finiteNumber(input.extensionFeet);
  const tiltDegrees = measuredTiltDegrees(input.measuredTilt);
  const suppliedActiveSpin = finiteNumber(input.activeSpinRpm);
  const suppliedEfficiency = normalizeSpinEfficiency(input.spinEfficiency);

  if (
    velocityMph === null ||
    velocityMph <= 0 ||
    totalSpinRpm === null ||
    totalSpinRpm <= 0 ||
    extensionFeet === null ||
    extensionFeet < 0 ||
    tiltDegrees === null
  ) {
    return null;
  }

  const activeSpinRpm =
    suppliedActiveSpin !== null && suppliedActiveSpin >= 0 && suppliedActiveSpin <= totalSpinRpm * 1.05
      ? suppliedActiveSpin
      : suppliedEfficiency !== null
        ? totalSpinRpm * suppliedEfficiency
        : null;
  if (activeSpinRpm === null) return null;

  const spinEfficiency = Math.max(0, Math.min(1, activeSpinRpm / totalSpinRpm));
  const velocityMps = velocityMph * MPH_TO_METERS_PER_SECOND;
  const activeSpinRadiansPerSecond = activeSpinRpm * (2 * Math.PI / 60);
  const spinFactor = (BALL_RADIUS_METERS * activeSpinRadiansPerSecond) / velocityMps;
  const liftCoefficient = LIFT_A * (1 - Math.exp(-LIFT_B * spinFactor));
  const flightDistanceFeet =
    RUBBER_TO_PLATE_POINT_FEET - PLATE_DEPTH_FEET - extensionFeet;
  if (flightDistanceFeet <= 0) return null;

  const flightDistanceMeters = flightDistanceFeet * FEET_TO_METERS;
  const magnitudeInches =
    0.5 *
    MAGNUS_K *
    liftCoefficient *
    flightDistanceMeters *
    flightDistanceMeters *
    METERS_TO_INCHES;
  const movementAngleRadians = ((tiltDegrees - 180) * Math.PI) / 180;
  const expectedHb = magnitudeInches * Math.sin(movementAngleRadians);
  const expectedIvb = magnitudeInches * Math.cos(movementAngleRadians);
  if (!Number.isFinite(expectedHb) || !Number.isFinite(expectedIvb)) return null;

  return {
    expectedHb,
    expectedIvb,
    activeSpinRpm,
    spinEfficiency,
    modelVersion: EXPECTED_MOVEMENT_MODEL_VERSION,
  };
}

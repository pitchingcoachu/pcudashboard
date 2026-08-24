import { measuredTiltDegrees } from './expected-movement';

export type SpinVector = { x: number; y: number; z: number };
export type SpinQuaternion = { w: number; x: number; y: number; z: number };

export type PitchSpinSimulationInput = {
  velocityMph: number;
  spinRateRpm: number;
  spinEfficiencyPercent: number;
  tiltClock: string;
  gyroDirection: 1 | -1;
  extensionFeet: number;
  seamOrientation: SpinVector;
  sswInfluencePercent: number;
  elevationFeet: number;
  temperatureF: number;
  humidityPercent: number;
  headwindMph: number;
  crosswindMph: number;
};

export type MovementVector = { hb: number; ivb: number };

export type PitchSpinSimulationResult = {
  spinAxis: SpinVector;
  seamQuaternion: SpinQuaternion;
  airDensityKgM3: number;
  activeSpinRpm: number;
  gyroSpinRpm: number;
  liftCoefficient: number;
  sswCoefficient: number;
  flightTimeSeconds: number;
  magnus: MovementVector;
  seamShiftedWake: MovementVector;
  environment: MovementVector;
  total: MovementVector;
};

const BALL_RADIUS_METERS = 0.0366;
const BALL_MASS_KG = 0.145;
const BALL_AREA_M2 = Math.PI * BALL_RADIUS_METERS * BALL_RADIUS_METERS;
const MPH_TO_MPS = 0.44704;
const FEET_TO_METERS = 0.3048;
const METERS_TO_INCHES = 39.3700787402;
const RUBBER_TO_PLATE_FEET = 60.5 - (17 / 12);
const GRAVITY = 9.80665;
const DRAG_COEFFICIENT = 0.35;
const LIFT_A = 0.336;
const LIFT_B = 6.041;
const MAX_SSW_COEFFICIENT = 0.06;

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

function magnitude(value: SpinVector): number {
  return Math.hypot(value.x, value.y, value.z);
}

function normalize(value: SpinVector): SpinVector {
  const length = magnitude(value) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function cross(a: SpinVector, b: SpinVector): SpinVector {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function dot(a: SpinVector, b: SpinVector): number {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function add(a: SpinVector, b: SpinVector): SpinVector {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(value: SpinVector, amount: number): SpinVector {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function multiplyQuaternion(a: SpinQuaternion, b: SpinQuaternion): SpinQuaternion {
  return {
    w: (a.w * b.w) - (a.x * b.x) - (a.y * b.y) - (a.z * b.z),
    x: (a.w * b.x) + (a.x * b.w) + (a.y * b.z) - (a.z * b.y),
    y: (a.w * b.y) - (a.x * b.z) + (a.y * b.w) + (a.z * b.x),
    z: (a.w * b.z) + (a.x * b.y) - (a.y * b.x) + (a.z * b.w),
  };
}

function axisQuaternion(axis: SpinVector, angle: number): SpinQuaternion {
  const unit = normalize(axis);
  const half = angle / 2;
  const sine = Math.sin(half);
  return { w: Math.cos(half), x: unit.x * sine, y: unit.y * sine, z: unit.z * sine };
}

export function seamOrientationQuaternion(rotation: SpinVector): SpinQuaternion {
  const radians = Math.PI / 180;
  // Validated TrackMan convention: intrinsic ZXY. TrackMan axes map into the
  // renderer as X→scene Y, Y→scene Z, Z→scene X.
  const qx = axisQuaternion({ x: 0, y: 1, z: 0 }, rotation.x * radians);
  const qy = axisQuaternion({ x: 0, y: 0, z: 1 }, rotation.y * radians);
  const qz = axisQuaternion({ x: 1, y: 0, z: 0 }, rotation.z * radians);
  return multiplyQuaternion(multiplyQuaternion(qz, qx), qy);
}

export function rotateByQuaternion(value: SpinVector, quaternion: SpinQuaternion): SpinVector {
  const pure = { w: 0, ...value };
  const inverse = { w: quaternion.w, x: -quaternion.x, y: -quaternion.y, z: -quaternion.z };
  const rotated = multiplyQuaternion(multiplyQuaternion(quaternion, pure), inverse);
  return { x: rotated.x, y: rotated.y, z: rotated.z };
}

export function spinQuaternion(axis: SpinVector, angle: number): SpinQuaternion {
  return axisQuaternion(axis, angle);
}

export function spinAxisFromInputs(tiltClock: string, efficiencyPercent: number, gyroDirection: 1 | -1): SpinVector {
  const tiltDegrees = measuredTiltDegrees(tiltClock) ?? 180;
  const movementAngle = ((tiltDegrees - 180) * Math.PI) / 180;
  const movementDirection = {
    x: Math.sin(movementAngle),
    y: 0,
    z: Math.cos(movementAngle),
  };
  // TrackMan tilt is the clock direction of the Magnus movement, viewed from
  // behind the pitcher. The physical spin axis is perpendicular to that clock
  // direction, so the rendered rod must be rotated 90 degrees from the tilt.
  const transverseAxis = { x: -movementDirection.z, y: 0, z: -movementDirection.x };
  const efficiency = clamp(efficiencyPercent / 100, 0, 1);
  const gyroFraction = Math.sqrt(Math.max(0, 1 - (efficiency * efficiency)));
  const velocityDirection = { x: 0, y: -1, z: 0 };
  return normalize(add(scale(transverseAxis, efficiency), scale(velocityDirection, gyroDirection * gyroFraction)));
}

export function formatTiltClock(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 720) + 720) % 720;
  const hour = Math.floor(normalized / 60) || 12;
  const minute = normalized % 60;
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

function airDensity(elevationFeet: number, temperatureF: number, humidityPercent: number): number {
  const elevationMeters = clamp(elevationFeet, -1000, 14000) * FEET_TO_METERS;
  const temperatureC = (clamp(temperatureF, -20, 130) - 32) * (5 / 9);
  const temperatureK = temperatureC + 273.15;
  const pressure = 101325 * Math.pow(Math.max(0.2, 1 - (2.25577e-5 * elevationMeters)), 5.25588);
  const saturationVaporPressure = 610.94 * Math.exp((17.625 * temperatureC) / (temperatureC + 243.04));
  const vaporPressure = saturationVaporPressure * clamp(humidityPercent / 100, 0, 1);
  return ((pressure - vaporPressure) / (287.05 * temperatureK)) + (vaporPressure / (461.495 * temperatureK));
}

type ForceMode = { magnus: boolean; ssw: boolean; wind: boolean };
type FlightEnd = { position: SpinVector; time: number };

function simulateFlight(args: {
  input: PitchSpinSimulationInput;
  mode: ForceMode;
  density: number;
  spinAxis: SpinVector;
  liftCoefficient: number;
  seamWakeDirection: SpinVector;
  sswCoefficient: number;
}): FlightEnd {
  const { input, mode, density, spinAxis, liftCoefficient, seamWakeDirection, sswCoefficient } = args;
  const distance = Math.max(35, RUBBER_TO_PLATE_FEET - clamp(input.extensionFeet, 0, 12)) * FEET_TO_METERS;
  let position = { x: 0, y: distance, z: 6 * FEET_TO_METERS };
  let velocity = { x: 0, y: -input.velocityMph * MPH_TO_MPS, z: 0 };
  const wind = mode.wind ? {
    x: input.crosswindMph * MPH_TO_MPS,
    y: input.headwindMph * MPH_TO_MPS,
    z: 0,
  } : { x: 0, y: 0, z: 0 };
  const aerodynamicK = (0.5 * density * BALL_AREA_M2) / BALL_MASS_KG;
  const dt = 0.001;
  let time = 0;
  let previousPosition = position;
  let previousTime = time;

  while (position.y > 0 && time < 1.5) {
    previousPosition = position;
    previousTime = time;
    const relativeVelocity = add(velocity, scale(wind, -1));
    const relativeSpeed = magnitude(relativeVelocity);
    const relativeDirection = normalize(relativeVelocity);
    let acceleration = { x: 0, y: 0, z: -GRAVITY };
    acceleration = add(acceleration, scale(relativeVelocity, -aerodynamicK * DRAG_COEFFICIENT * relativeSpeed));
    if (mode.magnus && liftCoefficient > 0) {
      acceleration = add(acceleration, scale(normalize(cross(spinAxis, relativeDirection)), aerodynamicK * liftCoefficient * relativeSpeed * relativeSpeed));
    }
    if (mode.ssw && sswCoefficient > 0) {
      acceleration = add(acceleration, scale(seamWakeDirection, aerodynamicK * sswCoefficient * relativeSpeed * relativeSpeed));
    }
    velocity = add(velocity, scale(acceleration, dt));
    position = add(position, scale(velocity, dt));
    time += dt;
  }

  const ySpan = previousPosition.y - position.y;
  const fraction = ySpan > 1e-9 ? previousPosition.y / ySpan : 1;
  return {
    position: add(previousPosition, scale(add(position, scale(previousPosition, -1)), clamp(fraction, 0, 1))),
    time: previousTime + (dt * clamp(fraction, 0, 1)),
  };
}

function difference(from: FlightEnd, baseline: FlightEnd): MovementVector {
  return {
    // Preserve the dashboard convention: positive HB is arm-side/rightward on
    // the pitcher-view clock even though world X points the opposite direction.
    hb: -(from.position.x - baseline.position.x) * METERS_TO_INCHES,
    ivb: (from.position.z - baseline.position.z) * METERS_TO_INCHES,
  };
}

export function simulatePitchSpin(input: PitchSpinSimulationInput): PitchSpinSimulationResult {
  const density = airDensity(input.elevationFeet, input.temperatureF, input.humidityPercent);
  const efficiency = clamp(input.spinEfficiencyPercent / 100, 0, 1);
  const activeSpinRpm = input.spinRateRpm * efficiency;
  const gyroSpinRpm = input.spinRateRpm * Math.sqrt(Math.max(0, 1 - (efficiency * efficiency)));
  const velocityMps = Math.max(1, input.velocityMph * MPH_TO_MPS);
  const activeSpinRadians = activeSpinRpm * Math.PI * 2 / 60;
  const spinFactor = (BALL_RADIUS_METERS * activeSpinRadians) / velocityMps;
  const liftCoefficient = LIFT_A * (1 - Math.exp(-LIFT_B * spinFactor));
  const spinAxis = spinAxisFromInputs(input.tiltClock, input.spinEfficiencyPercent, input.gyroDirection);
  const seamQuaternion = seamOrientationQuaternion(input.seamOrientation);
  const velocityDirection = { x: 0, y: -1, z: 0 };
  const rawSeamDirection = rotateByQuaternion({ x: 1, y: 0, z: 0 }, seamQuaternion);
  const seamProjection = add(rawSeamDirection, scale(velocityDirection, -dot(rawSeamDirection, velocityDirection)));
  const seamCoherence = clamp(magnitude(seamProjection), 0, 1);
  const seamWakeDirection = normalize(seamProjection);
  const sswCoefficient = MAX_SSW_COEFFICIENT * clamp(input.sswInfluencePercent / 100, 0, 1) * seamCoherence;
  const common = { input, density, spinAxis, liftCoefficient, seamWakeDirection, sswCoefficient };
  const stillAirBaseline = simulateFlight({ ...common, mode: { magnus: false, ssw: false, wind: false } });
  const environmentBaseline = simulateFlight({ ...common, mode: { magnus: false, ssw: false, wind: true } });
  const magnusFlight = simulateFlight({ ...common, mode: { magnus: true, ssw: false, wind: true } });
  const sswFlight = simulateFlight({ ...common, mode: { magnus: false, ssw: true, wind: true } });
  const totalFlight = simulateFlight({ ...common, mode: { magnus: true, ssw: true, wind: true } });

  return {
    spinAxis,
    seamQuaternion,
    airDensityKgM3: density,
    activeSpinRpm,
    gyroSpinRpm,
    liftCoefficient,
    sswCoefficient,
    flightTimeSeconds: totalFlight.time,
    magnus: difference(magnusFlight, environmentBaseline),
    seamShiftedWake: difference(sswFlight, environmentBaseline),
    environment: difference(environmentBaseline, stillAirBaseline),
    total: difference(totalFlight, stillAirBaseline),
  };
}

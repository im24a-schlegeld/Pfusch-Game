import { BIKE_MODEL_SCALES } from './vehicleScale';

/** Shared metres for deterministic contacts and the pooled traffic meshes. */
export type TrafficKind = 'car' | 'van' | 'towtruck' | 'construction';
export interface TrafficShape {
  readonly width: number;
  readonly length: number;
  readonly height: number;
  readonly frontZ: number;
  readonly rearZ: number;
  readonly contactHalfWidth: number;
  readonly contactHalfLength: number;
}
function shape(
  width: number,
  length: number,
  height: number,
  centerZ = 0,
): TrafficShape {
  return Object.freeze({
    width,
    length,
    height,
    frontZ: centerZ - length / 2,
    rearZ: centerZ + length / 2,
    contactHalfWidth: width / 2 + 0.3,
    contactHalfLength: length / 2 + Math.abs(centerZ) + 1,
  });
}
export const TRAFFIC_SHAPES: Readonly<Record<TrafficKind, TrafficShape>> = {
  car: shape(2.35, 5.8, 1.98),
  van: shape(2.4, 6.5, 3),
  towtruck: shape(2.5, 10.9, 3.05, 1.35),
  construction: shape(2.3, 0.75, 1.25),
};
export const TRAFFIC_KINDS = Object.keys(TRAFFIC_SHAPES) as TrafficKind[];
export const TOW_RAMP = Object.freeze({
  rearZ: 6.8,
  frontZ: 1.92,
  rearHeight: 0.18,
  frontHeight: 1.05,
  deckThickness: 0.09,
  halfWidth: 1.25,
  launchVelocity: 8.4,
  gravity: 21,
  cabRearZ: -1.2,
});
/** World-space front tire contacts, checked against the assembled bike meshes. */
export const RAMP_FRONT_CONTACT: Readonly<
  Record<string, { axle: number; radius: number }>
> = {
  '125': { axle: -0.7 * 1.45, radius: 0.305 * 1.45 },
  scooter: { axle: -0.65 * 1.45, radius: 0.224 * 1.45 },
  '450': {
    axle: -0.77 * BIKE_MODEL_SCALES['450'] * 1.45,
    radius: 0.2999 * 1.05 * BIKE_MODEL_SCALES['450'] * 1.45,
  },
  '701': {
    axle: -0.72 * BIKE_MODEL_SCALES['701'] * 1.45,
    radius: 0.2999 * BIKE_MODEL_SCALES['701'] * 1.45,
  },
};
const RAMP_REAR_CONTACT: Readonly<
  Record<string, { axle: number; radius: number }>
> = {
  '125': { axle: 0.55 * 1.45, radius: 0.305 * 1.45 },
  scooter: { axle: 0.64 * 1.45, radius: 0.231 * 1.45 },
  '450': {
    axle: 0.76 * BIKE_MODEL_SCALES['450'] * 1.45,
    radius: 0.3119 * 1.05 * BIKE_MODEL_SCALES['450'] * 1.45,
  },
  '701': {
    axle: 0.685 * BIKE_MODEL_SCALES['701'] * 1.45,
    radius: 0.3204 * BIKE_MODEL_SCALES['701'] * 1.45,
  },
};
/** Vehicle-local +Z is the rear, matching the rendered ramp. */
export function towRampHeight(localZ: number) {
  const progress = Math.max(
    0,
    Math.min(1, (TOW_RAMP.rearZ - localZ) / (TOW_RAMP.rearZ - TOW_RAMP.frontZ)),
  );
  return (
    TOW_RAMP.rearHeight +
    (TOW_RAMP.frontHeight - TOW_RAMP.rearHeight) * progress
  );
}
const rampSlope =
  (TOW_RAMP.frontHeight - TOW_RAMP.rearHeight) /
  (TOW_RAMP.rearZ - TOW_RAMP.frontZ);

/** Highest axle required by any point of the tire over a finite support plane. */
function tireSupport(
  center: number,
  radius: number,
  start: number,
  end: number,
  slope: number,
  intercept: number,
) {
  const lo = Math.max(start, center - radius),
    hi = Math.min(end, center + radius);
  if (hi < lo) return 0;
  const contact = Math.max(
    lo,
    Math.min(hi, center - (slope * radius) / Math.sqrt(1 + slope ** 2)),
  );
  return (
    intercept -
    slope * contact +
    Math.sqrt(Math.max(0, radius ** 2 - (contact - center) ** 2))
  );
}
function supportedAxle(center: number, radius: number) {
  return Math.max(
    radius,
    tireSupport(
      center,
      radius,
      TOW_RAMP.cabRearZ,
      TOW_RAMP.frontZ,
      0,
      TOW_RAMP.frontHeight,
    ),
    tireSupport(
      center,
      radius,
      TOW_RAMP.frontZ,
      TOW_RAMP.rearZ,
      rampSlope,
      TOW_RAMP.rearHeight + rampSlope * TOW_RAMP.rearZ,
    ),
  );
}

/** Root height and rear-axle pitch for animateSuspension(pitch, 0), in metres. */
export function towRampPose(bikeId: string, localZ: number, minimumPitch = 0) {
  const front = RAMP_FRONT_CONTACT[bikeId] ?? RAMP_FRONT_CONTACT['450'];
  const rear = RAMP_REAR_CONTACT[bikeId] ?? RAMP_REAR_CONTACT['450'];
  const clearance = (pitch: number, leading: boolean) => {
    const tire = leading ? front : rear;
    const c = Math.cos(pitch),
      s = Math.sin(pitch);
    // suspensionPose retains rear axle Y, but its positive pitch also moves
    // both axle Z positions. Include both transforms and unequal tire radii.
    const centerZ = localZ + tire.axle * c + tire.radius * s;
    const centerY =
      rear.radius +
      (tire.radius - rear.radius) * c +
      (rear.axle - tire.axle) * s;
    return supportedAxle(centerZ, tire.radius) - centerY;
  };
  let low = 0,
    high = Math.PI / 4;
  if (clearance(0, true) > clearance(0, false)) {
    for (let i = 0; i < 28; i++) {
      const pitch = (low + high) / 2;
      if (clearance(pitch, true) > clearance(pitch, false)) low = pitch;
      else high = pitch;
    }
  } else high = 0;
  const pitch = Math.max((low + high) / 2,
    Number.isFinite(minimumPitch) ? Math.max(0, Math.min(Math.PI * 0.49, minimumPitch)) : 0);
  return {
    height:
      Math.max(0, clearance(pitch, true), clearance(pitch, false)) + 0.018,
    pitch,
  };
}

/** Hold on the flat tray with a visible gap between the leading tire and cab. */
export function towDeckPosition(bikeId: string) {
  const front = RAMP_FRONT_CONTACT[bikeId] ?? RAMP_FRONT_CONTACT['450'];
  return Math.max(0.5, TOW_RAMP.cabRearZ - front.axle + front.radius + 0.12);
}
/** Saturates gradually; traffic always retains its documented minimum spacing. */
export function distanceDifficulty(distance: number) {
  return Math.max(0, Math.min(1, distance / 5000));
}

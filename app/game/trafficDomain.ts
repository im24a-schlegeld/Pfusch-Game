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
  '450': { axle: -0.77 * 1.12 * 1.45, radius: 0.2999 * 1.05 * 1.12 * 1.45 },
  '701': { axle: -0.72 * 1.12 * 1.45, radius: 0.2999 * 1.12 * 1.45 },
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
/** Keep the leading tire above the slope until it has passed onto the flat tray. */
export function towRampLaunchHeight(
  bikeId: string,
  localZ: number,
  relativeSpeed: number,
) {
  const front = RAMP_FRONT_CONTACT[bikeId] ?? RAMP_FRONT_CONTACT['450'];
  const slope =
    (TOW_RAMP.frontHeight - TOW_RAMP.rearHeight) /
    (TOW_RAMP.rearZ - TOW_RAMP.frontZ);
  const surface = towRampHeight(localZ + front.axle);
  const tireClearance = front.radius * (Math.sqrt(1 + slope * slope) - 1);
  const untilFlat = Math.max(
    0,
    (localZ + front.axle - TOW_RAMP.frontZ) / Math.max(1, relativeSpeed),
  );
  // The clearance over a linear incline is concave during takeoff, so checking
  // its two ends covers the entire interval before the front wheel reaches the tray.
  const flatRequired =
    TOW_RAMP.frontHeight -
    TOW_RAMP.launchVelocity * untilFlat +
    0.5 * TOW_RAMP.gravity * untilFlat ** 2;
  return Math.max(surface, flatRequired) + tireClearance + 0.015;
}
/** Saturates gradually; traffic always retains its documented minimum spacing. */
export function distanceDifficulty(distance: number) {
  return Math.max(0, Math.min(1, distance / 5000));
}

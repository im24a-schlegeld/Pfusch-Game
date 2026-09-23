import { Vector3 } from 'three';
import { BIKE_MODEL_SCALES, type BikeModelId } from './vehicleScale';
import { SUPERMOTO_GRIP, SUPERMOTO_PEG } from './supermotoFit';
export type Point = [number, number, number];
export const RIDER_DIMENSIONS = Object.freeze({
  torsoLength: 0.53,
  neckToHelmetCenter: 0.22,
  shoulderHalf: 0.21,
  hipHalf: 0.125,
  upperArm: 0.34,
  forearm: 0.3,
  thigh: 0.43,
  shin: 0.43,
});
export interface RiderTarget {
  hip: Point;
  grip: Point;
  peg: Point;
  torsoLean: number;
}
export interface RiderPose extends RiderTarget {
  shoulder: Point;
  head: Point;
  elbow: Point;
  knee: Point;
  wrist: Point;
  ankle: Point;
}
const v = (p: Point) => new Vector3(...p);
/** Exact two-bone solve. Unreachable contact targets are configuration errors, never stretched anatomy. */
export function solveJoint(
  start: Point,
  end: Point,
  first: number,
  second: number,
  pole: Point,
): Point {
  const origin = v(start),
    delta = v(end).sub(origin),
    distance = delta.length();
  if (
    distance < Math.abs(first - second) + 1e-6 ||
    distance > first + second - 1e-6
  )
    throw new RangeError(
      'Rider contact target is outside the fixed skeleton reach',
    );
  const direction = delta.divideScalar(distance);
  const along =
    (first * first - second * second + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, first * first - along * along));
  const bend = v(pole).addScaledVector(direction, -v(pole).dot(direction));
  if (bend.lengthSq() < 1e-8) {
    const axes = [
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
    ];
    axes.sort(
      (a, b) => Math.abs(a.dot(direction)) - Math.abs(b.dot(direction)),
    );
    bend.copy(axes[0]).addScaledVector(direction, -axes[0].dot(direction));
  }
  return origin
    .addScaledVector(direction, along)
    .addScaledVector(bend.normalize(), height)
    .toArray() as Point;
}
export function resolveRiderPose(target: RiderTarget): RiderPose {
  const d = RIDER_DIMENSIONS;
  const shoulder: Point = [
    0,
    target.hip[1] + Math.cos(target.torsoLean) * d.torsoLength,
    target.hip[2] - Math.sin(target.torsoLean) * d.torsoLength,
  ];
  const head: Point = [
    0,
    shoulder[1] + d.neckToHelmetCenter,
    shoulder[2] - 0.035,
  ];
  const wrist: Point = [
    target.grip[0],
    target.grip[1] + 0.015,
    target.grip[2] + 0.02,
  ];
  const ankle: Point = [
    target.peg[0],
    target.peg[1] + 0.105,
    target.peg[2] + 0.055,
  ];
  return {
    ...target,
    shoulder,
    head,
    wrist,
    ankle,
    elbow: solveJoint(
      [d.shoulderHalf, shoulder[1], shoulder[2]],
      wrist,
      d.upperArm,
      d.forearm,
      [0.18, -0.12, 0.1],
    ),
    knee: solveJoint(
      [d.hipHalf, target.hip[1] - 0.01, target.hip[2]],
      ankle,
      d.thigh,
      d.shin,
      [0.2, 0, -1],
    ),
  };
}
/** Raw motorcycle coordinates, used to build grips, footpegs and seat mounts. */
export const BIKE_CONTACTS: Readonly<Record<BikeModelId, RiderTarget>> =
  Object.freeze({
    '125': {
      hip: [0, 0.94, 0.25],
      grip: [0.31, 1.25, -0.4],
      peg: [0.2, 0.33, 0.12],
      torsoLean: 0.16,
    },
    scooter: {
      hip: [0, 0.87, 0.25],
      grip: [0.31, 1.12, -0.4],
      peg: [0.2, 0.3, -0.13],
      torsoLean: 0.25,
    },
    '450': {
      hip: [0, 1.0, 0.18],
      grip: SUPERMOTO_GRIP,
      peg: SUPERMOTO_PEG,
      torsoLean: 0.3,
    },
    '701': {
      hip: [0, 0.88, 0.32],
      grip: [0.32, 0.94, -0.47],
      peg: [0.24, 0.41, 0.22],
      torsoLean: 0.6,
    },
  });
function scaledContacts(bike: BikeModelId, torsoLean: number): RiderTarget {
  const source = BIKE_CONTACTS[bike],
    scale = BIKE_MODEL_SCALES[bike];
  const scaled = (p: Point): Point => [
    p[0] * scale,
    p[1] * scale,
    p[2] * scale,
  ];
  return {
    hip: scaled(source.hip),
    grip: scaled(source.grip),
    peg: scaled(source.peg),
    torsoLean,
  };
}
/** Contacts follow the larger motorcycle, but bones and hand/boot offsets do not.
 * The rider group cancels its parent's bike scale, so these poses retain the
 * same world-space anatomy while reaching the scaled seat, grips and pegs. */
export const RIDER_TARGETS: Readonly<Record<BikeModelId, RiderTarget>> =
  Object.freeze({
    '125': BIKE_CONTACTS['125'],
    scooter: BIKE_CONTACTS.scooter,
    '450': scaledContacts('450', 0.42),
    '701': scaledContacts('701', 0.74),
  });
export const POSES = {
  '125': resolveRiderPose(RIDER_TARGETS['125']),
  scooter: resolveRiderPose(RIDER_TARGETS.scooter),
  '450': resolveRiderPose(RIDER_TARGETS['450']),
  '701': resolveRiderPose(RIDER_TARGETS['701']),
};

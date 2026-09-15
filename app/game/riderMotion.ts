import { Euler, Quaternion, Vector3 } from 'three';
import {
  RIDER_DIMENSIONS as d,
  solveJoint,
  type Point,
  type RiderPose,
} from './riderSkeleton';

export interface RiderMotion {
  wheelie: number;
  steer: number;
  landing: number;
  forward?: number;
  /** Short rearward pull at the start of a lift. */
  launch?: number;
  /** Signed balance and load corrections, limited to small posture changes. */
  balance?: number;
  load?: number;
  road?: number;
}
export interface LimbPose {
  start: Point;
  joint: Point;
  end: Point;
}
const vector = (p: Point) => new Vector3(...p);
const point = (v: Vector3) => v.toArray() as Point;
const bounded = (value: number | undefined, min = 0) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(1, value))
    : 0;

/** All motion changes contact-relative pose, never anatomy. Each side has its own IK solve. */
export function riderMotionPose(base: RiderPose, motion: RiderMotion) {
  const wheelie = bounded(motion.wheelie);
  const steer = bounded(motion.steer, -1);
  const landing = bounded(motion.landing);
  const forward = bounded(motion.forward);
  const launch = bounded(motion.launch);
  const balance = bounded(motion.balance, -1);
  const load = bounded(motion.load, -1);
  const road = bounded(motion.road, -1);
  const hip: Point = [
    base.hip[0] + 0.022 * steer,
    base.hip[1] - 0.015 * landing + 0.0025 * road,
    base.hip[2] +
      0.035 * wheelie -
      0.025 * forward +
      0.004 * launch +
      0.004 * load,
  ];
  let lean =
    base.torsoLean +
    0.06 * wheelie +
    0.04 * landing +
    0.09 * forward +
    -0.045 * launch +
    0.012 * balance +
    0.008 * load +
    0.003 * road;
  const roll = -0.06 * steer;
  const orientation = new Quaternion().setFromEuler(new Euler(-lean, 0, roll));
  const onTorso = (p: Point) =>
    point(vector(p).applyQuaternion(orientation).add(vector(hip)));
  // Rearward weight transfer stops where the fixed arms reach their grips.
  // Solve a contact-limited torso angle, never lengthen the rider's bones.
  const reachesGrips = () =>
    [-1, 1].every(
      (side) =>
        vector(onTorso([side * d.shoulderHalf, d.torsoLength, 0])).distanceTo(
          new Vector3(side * base.wrist[0], base.wrist[1], base.wrist[2]),
        ) <
        d.upperArm + d.forearm - 0.001,
    );
  if (!reachesGrips()) {
    let low = lean,
      high = lean + 0.25;
    for (let i = 0; i < 12; i++) {
      const candidate = (low + high) / 2;
      orientation.setFromEuler(new Euler(-candidate, 0, roll));
      if (reachesGrips()) high = candidate;
      else low = candidate;
    }
    lean = high;
    orientation.setFromEuler(new Euler(-lean, 0, roll));
  }
  const shoulder = onTorso([0, d.torsoLength, 0]);
  const head: Point = [
    shoulder[0],
    shoulder[1] + d.neckToHelmetCenter,
    shoulder[2] - 0.035,
  ];
  const limbs = [-1, 1].map((side) => {
    const start = onTorso([side * d.shoulderHalf, d.torsoLength, 0]);
    const end: Point = [side * base.wrist[0], base.wrist[1], base.wrist[2]];
    const legStart: Point = [hip[0] + side * d.hipHalf, hip[1] - 0.01, hip[2]];
    const ankle: Point = [side * base.ankle[0], base.ankle[1], base.ankle[2]];
    return {
      arm: {
        start,
        joint: solveJoint(start, end, d.upperArm, d.forearm, [
          side * 0.18,
          -0.12,
          0.1,
        ]),
        end,
      },
      leg: {
        start: legStart,
        joint: solveJoint(legStart, ankle, d.thigh, d.shin, [
          side * 0.2,
          0,
          -1,
        ]),
        end: ankle,
      },
    };
  });
  return { hip, lean, roll, shoulder, head, limbs };
}

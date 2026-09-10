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
}
export interface LimbPose {
  start: Point;
  joint: Point;
  end: Point;
}
const vector = (p: Point) => new Vector3(...p);
const point = (v: Vector3) => v.toArray() as Point;

/** All motion changes contact-relative pose, never anatomy. Each side has its own IK solve. */
export function riderMotionPose(base: RiderPose, motion: RiderMotion) {
  const wheelie = Math.max(0, Math.min(1, motion.wheelie));
  const steer = Math.max(-1, Math.min(1, motion.steer));
  const landing = Math.max(0, Math.min(1, motion.landing));
  const hip: Point = [
    base.hip[0] + 0.015 * steer,
    base.hip[1] - 0.015 * landing,
    base.hip[2] + 0.035 * wheelie,
  ];
  const lean = base.torsoLean + 0.06 * wheelie + 0.04 * landing;
  const roll = -0.03 * steer;
  const orientation = new Quaternion().setFromEuler(new Euler(-lean, 0, roll));
  const onTorso = (p: Point) =>
    point(vector(p).applyQuaternion(orientation).add(vector(hip)));
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

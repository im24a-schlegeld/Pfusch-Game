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
  /** Rendered motorcycle attitude in radians, used only for the rider's gaze. */
  bikePitch?: number;
  bikeRoll?: number;
  /** Crash-only pose releases hands and boots from bike contact points. */
  crash?: number;
  crashSide?: number;
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

const radians = (value: number | undefined, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;

/** Keep the gaze near the road horizon as the motorcycle rises. The neck
 * counters most of the chassis rotation but follows it slightly, so a wheelie
 * still has a relaxed, human head movement instead of a locked horizon;
 * no joint position, skeleton dimension or control contact is changed. */
export function riderHeadPose(motion: RiderMotion) {
  const pitch = radians(motion.bikePitch, -0.2, 1.3);
  const roll = radians(motion.bikeRoll, -0.3, 0.3);
  const steer = bounded(motion.steer, -1);
  const wheelie = bounded(motion.wheelie);
  const balance = bounded(motion.balance, -1);
  return {
    pitch: -0.06 - pitch * (0.84 - wheelie * 0.025) + balance * 0.018,
    yaw: -steer * 0.035,
    roll: -roll * 0.8 + steer * 0.008 + balance * wheelie * 0.012,
  };
}

export const WHEELIE_LANE_DURATION = 0.55;
export interface WheelieLaneInput {
  age: number;
  direction: number;
  wheelie: number;
  airborne: boolean;
  onTowTruck: boolean;
  reducedMotion: boolean;
}

/** A small lean into the lane, then a shorter counter-settle. The squared
 * sine reaches both ends without a snap; it never changes physics or lanes. */
export function wheelieLanePose(input: WheelieLaneInput) {
  if (input.reducedMotion || input.airborne || input.onTowTruck ||
    !Number.isFinite(input.age) || input.age <= 0 || input.age >= WHEELIE_LANE_DURATION)
    return { roll: 0, yaw: 0, steer: 0 };
  const direction = bounded(input.direction, -1), lift = bounded(input.wheelie);
  const t = input.age / WHEELIE_LANE_DURATION;
  const pulse = t < 0.72 ? Math.sin(Math.PI * t / 0.72) ** 2
    : -0.22 * Math.sin(Math.PI * (t - 0.72) / 0.28) ** 2;
  const weight = direction * lift * pulse;
  return { roll: -weight * 0.052, yaw: -weight * 0.032, steer: weight * 0.16 };
}

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
  const crash = bounded(motion.crash);
  const crashSide =
    typeof motion.crashSide === 'number' && Number.isFinite(motion.crashSide)
      ? Math.max(-1, Math.min(1, motion.crashSide))
      : 1;
  const hip: Point = [
    base.hip[0] + (0.022 + 0.008 * wheelie) * steer,
    base.hip[1] - 0.015 * landing + 0.0025 * road + 0.025 * crash,
    base.hip[2] +
      0.035 * wheelie -
      0.025 * forward +
      0.013 * launch +
      0.004 * load +
      0.055 * crash,
  ];
  let lean =
    base.torsoLean +
    0.06 * wheelie +
    0.04 * landing +
    0.09 * forward +
    -0.115 * launch +
    0.012 * balance +
    0.008 * load +
    0.003 * road +
    0.12 * crash;
  const roll = -(0.06 + 0.025 * wheelie) * steer + crashSide * 0.08 * crash;
  const orientation = new Quaternion().setFromEuler(new Euler(-lean, 0, roll));
  const onTorso = (p: Point) =>
    point(vector(p).applyQuaternion(orientation).add(vector(hip)));
  // Rearward weight transfer stops where the fixed arms reach their grips.
  // Solve a contact-limited torso angle, never lengthen the rider's bones.
  const crashWrist = (side: number): Point => {
    const contact = base.contactGrips?.[side < 0 ? 0 : 1];
    return [contact?.[0] ?? side * base.wrist[0],
      (contact?.[1] ?? base.wrist[1]) + 0.09 * crash,
      (contact?.[2] ?? base.wrist[2]) + 0.14 * crash];
  };
  const reachesGrips = () =>
    [-1, 1].every(
      (side) =>
        vector(onTorso([side * d.shoulderHalf, d.torsoLength, 0])).distanceTo(
          vector(crashWrist(side)),
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
    const end = crashWrist(side);
    const legStart: Point = [hip[0] + side * d.hipHalf, hip[1] - 0.01, hip[2]];
    const ankle: Point = [
      side * base.ankle[0],
      base.ankle[1] + 0.035 * crash,
      base.ankle[2] + 0.13 * crash,
    ];
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

import { describe, expect, it } from 'vitest';
import { Box3, Euler, Quaternion, Vector3 } from 'three';
import { createRagdoll, type RagdollPose } from '../app/game/ragdoll';
import { riderMotionPose } from '../app/game/riderMotion';
import {
  POSES,
  RIDER_DIMENSIONS as d,
  type Point,
} from '../app/game/riderSkeleton';

function initial(model: keyof typeof POSES = '125'): RagdollPose {
  const pose = riderMotionPose(POSES[model], {
    wheelie: 0,
    steer: 0,
    landing: 0,
  });
  return {
    ...pose,
    orientation: new Quaternion()
      .setFromEuler(new Euler(-pose.lean, 0, pose.roll))
      .toArray(),
  };
}
const length = (a: Point, b: Point) =>
  new Vector3(...a).distanceTo(new Vector3(...b));

describe('physical immutable ragdoll', () => {
  it.each(['125', 'scooter', '450', '701'] as const)(
    '%s releases riding contacts without changing human anatomy',
    (model) => {
      const start = initial(model);
      const ragdoll = createRagdoll(start);
      expect(ragdoll.particleCount).toBe(15);
      for (let step = 0; step < 144; step++) {
        const pose = ragdoll.advance(1 / 120);
        expect(length(pose.hip, pose.shoulder)).toBeCloseTo(d.torsoLength, 8);
        expect(
          length(pose.limbs[0].arm.start, pose.limbs[1].arm.start),
        ).toBeCloseTo(d.shoulderHalf * 2, 8);
        expect(
          length(pose.limbs[0].leg.start, pose.limbs[1].leg.start),
        ).toBeCloseTo(d.hipHalf * 2, 8);
        for (const { arm, leg } of pose.limbs) {
          expect(length(arm.start, arm.joint)).toBeCloseTo(d.upperArm, 8);
          expect(length(arm.joint, arm.end)).toBeCloseTo(d.forearm, 8);
          expect(length(leg.start, leg.joint)).toBeCloseTo(d.thigh, 8);
          expect(length(leg.joint, leg.end)).toBeCloseTo(d.shin, 8);
        }
      }
      const end = ragdoll.pose();
      expect(
        length(end.limbs[0].arm.end, start.limbs[0].arm.end),
      ).toBeGreaterThan(0.4);
      expect(
        length(end.limbs[1].leg.end, start.limbs[1].leg.end),
      ).toBeGreaterThan(0.4);
      expect(end.shoulder[1]).toBeLessThan(start.shoulder[1] - 0.3);
    },
  );

  it('is deterministic across render rates and ignores invalid elapsed times', () => {
    const a = createRagdoll(initial()),
      b = createRagdoll(initial());
    for (let i = 0; i < 60; i++) a.advance(1 / 60);
    for (let i = 0; i < 30; i++) b.advance(1 / 30);
    expect(a.pose()).toEqual(b.pose());
    const still = a.pose();
    for (const delta of [0, -1, NaN, Infinity]) a.advance(delta);
    expect(a.pose()).toEqual(still);
    a.advance(30);
    expect(a.elapsed).toBeCloseTo(1.1, 10);
  });

  it('collides articulated limbs against the road and a vehicle instead of travelling through it', () => {
    const obstacle = new Box3(
      new Vector3(-1.6, -0.2, -4),
      new Vector3(1.6, 1.3, -0.45),
    );
    const ragdoll = createRagdoll(initial(), {
      obstacles: [obstacle],
      velocity: [0, 0.15, -5],
    });
    for (let i = 0; i < 144; i++) {
      const pose = ragdoll.advance(1 / 120);
      const points = [
        pose.hip,
        pose.shoulder,
        pose.head,
        ...pose.limbs.flatMap(({ arm, leg }) => [
          arm.start,
          arm.joint,
          arm.end,
          leg.start,
          leg.joint,
          leg.end,
        ]),
      ];
      for (const point of points) {
        expect(point.every(Number.isFinite)).toBe(true);
        expect(point[1]).toBeGreaterThan(0.025);
        expect(obstacle.containsPoint(new Vector3(...point))).toBe(false);
      }
    }
    expect(ragdoll.pose().hip[2]).toBeGreaterThan(-0.6);
  });
});

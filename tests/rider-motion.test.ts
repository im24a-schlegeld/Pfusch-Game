import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  POSES,
  RIDER_DIMENSIONS as d,
  type Point,
} from '../app/game/riderSkeleton';
import { riderMotionPose, type RiderMotion } from '../app/game/riderMotion';
import { skinLimb } from '../app/game/limbSkin';
const distance = (a: Point, b: Point) =>
  new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));
describe('animated immutable rider', () => {
  it('preserves finite fixed-length bones and exact contacts at every combined motion extreme', () => {
    const signed = new Set<keyof RiderMotion>([
      'steer',
      'balance',
      'load',
      'road',
    ]);
    const keys: (keyof RiderMotion)[] = [
      'wheelie',
      'steer',
      'landing',
      'forward',
      'launch',
      'balance',
      'load',
      'road',
    ];
    for (const base of Object.values(POSES)) {
      for (let combination = 0; combination < 2 ** keys.length; combination++) {
        const motion: RiderMotion = { wheelie: 0, steer: 0, landing: 0 };
        keys.forEach((key, bit) => {
          motion[key] = combination & (1 << bit) ? 1 : signed.has(key) ? -1 : 0;
        });
        const p = riderMotionPose(base, motion);
        expect(
          [...p.hip, ...p.shoulder, ...p.head, p.lean, p.roll].every(
            Number.isFinite,
          ),
        ).toBe(true);
        expect(distance(p.hip, p.shoulder)).toBeCloseTo(d.torsoLength, 10);
        expect(
          distance(p.limbs[0].arm.start, p.limbs[1].arm.start),
        ).toBeCloseTo(d.shoulderHalf * 2, 10);
        expect(
          distance(p.limbs[0].leg.start, p.limbs[1].leg.start),
        ).toBeCloseTo(d.hipHalf * 2, 10);
        p.limbs.forEach(({ arm, leg }, index) => {
          expect(
            [
              ...arm.start,
              ...arm.joint,
              ...arm.end,
              ...leg.start,
              ...leg.joint,
              ...leg.end,
            ].every(Number.isFinite),
          ).toBe(true);
          expect(distance(arm.start, arm.joint)).toBeCloseTo(d.upperArm, 10);
          expect(distance(arm.joint, arm.end)).toBeCloseTo(d.forearm, 10);
          expect(distance(leg.start, leg.joint)).toBeCloseTo(d.thigh, 10);
          expect(distance(leg.joint, leg.end)).toBeCloseTo(d.shin, 10);
          const side = index ? 1 : -1;
          expect(arm.end).toEqual([
            side * base.wrist[0],
            base.wrist[1],
            base.wrist[2],
          ]);
          expect(leg.end).toEqual([
            side * base.ankle[0],
            base.ankle[1],
            base.ankle[2],
          ]);
        });
      }
    }
  });
  it('gives launch, balance, load, road and steering distinct small pose responses', () => {
    const rest: RiderMotion = { wheelie: 0, steer: 0, landing: 0 };
    for (const base of Object.values(POSES)) {
      const neutral = riderMotionPose(base, rest);
      const launch = riderMotionPose(base, { ...rest, launch: 1 });
      expect(launch.hip[2] - neutral.hip[2]).toBeCloseTo(0.004, 10);
      expect(launch.shoulder[2]).toBeGreaterThan(neutral.shoulder[2]);
      expect(launch.lean).toBeLessThan(neutral.lean);
      for (const sign of [-1, 1]) {
        const balance = riderMotionPose(base, { ...rest, balance: sign });
        expect(balance.hip).toEqual(neutral.hip);
        expect(balance.lean - neutral.lean).toBeCloseTo(sign * 0.012, 10);
        const load = riderMotionPose(base, { ...rest, load: sign });
        expect(load.hip[2] - neutral.hip[2]).toBeCloseTo(sign * 0.004, 10);
        const road = riderMotionPose(base, { ...rest, road: sign });
        expect(road.hip[1] - neutral.hip[1]).toBeCloseTo(sign * 0.0025, 10);
        const steering = riderMotionPose(base, { ...rest, steer: sign });
        expect(steering.hip[0] - neutral.hip[0]).toBeCloseTo(sign * 0.022, 10);
        expect(steering.roll).toBeCloseTo(sign * -0.06, 10);
      }
    }
  });
  it('bounds motion inputs and treats nonfinite input as neutral', () => {
    const rest: RiderMotion = { wheelie: 0, steer: 0, landing: 0 };
    const keys: (keyof RiderMotion)[] = [
      'wheelie',
      'steer',
      'landing',
      'forward',
      'launch',
      'balance',
      'load',
      'road',
    ];
    const signed = new Set<keyof RiderMotion>([
      'steer',
      'balance',
      'load',
      'road',
    ]);
    for (const base of Object.values(POSES)) {
      for (const key of keys) {
        for (const value of [NaN, Infinity, -Infinity]) {
          expect(riderMotionPose(base, { ...rest, [key]: value })).toEqual(
            riderMotionPose(base, rest),
          );
        }
        expect(riderMotionPose(base, { ...rest, [key]: 5 })).toEqual(
          riderMotionPose(base, { ...rest, [key]: 1 }),
        );
        expect(riderMotionPose(base, { ...rest, [key]: -5 })).toEqual(
          riderMotionPose(base, { ...rest, [key]: signed.has(key) ? -1 : 0 }),
        );
      }
    }
  });
  it('keeps every bone length and both contact targets through combined motion on all bikes', () => {
    for (const base of Object.values(POSES))
      for (const wheelie of [0, 0.5, 1])
        for (const steer of [-1, 0, 1])
          for (const landing of [0, 0.5, 1])
            for (const forward of [0, 0.5, 1]) {
              const p = riderMotionPose(base, {
                wheelie,
                steer,
                landing,
                forward,
              });
              expect(distance(p.hip, p.shoulder)).toBeCloseTo(
                d.torsoLength,
                10,
              );
              expect(
                distance(p.limbs[0].arm.start, p.limbs[1].arm.start),
              ).toBeCloseTo(d.shoulderHalf * 2, 10);
              expect(
                distance(p.limbs[0].leg.start, p.limbs[1].leg.start),
              ).toBeCloseTo(d.hipHalf * 2, 10);
              p.limbs.forEach(({ arm, leg }, i) => {
                expect(distance(arm.start, arm.joint)).toBeCloseTo(
                  d.upperArm,
                  10,
                );
                expect(distance(arm.joint, arm.end)).toBeCloseTo(d.forearm, 10);
                expect(distance(leg.start, leg.joint)).toBeCloseTo(d.thigh, 10);
                expect(distance(leg.joint, leg.end)).toBeCloseTo(d.shin, 10);
                expect(arm.end).toEqual([
                  (i ? 1 : -1) * base.wrist[0],
                  base.wrist[1],
                  base.wrist[2],
                ]);
                expect(leg.end).toEqual([
                  (i ? 1 : -1) * base.ankle[0],
                  base.ankle[1],
                  base.ankle[2],
                ]);
              });
            }
  });
  it('skins curved meshes without moving their rest pose or stretching endpoint contacts', () => {
    const parent = new THREE.Group();
    parent.scale.setScalar(1.45);
    const base = POSES['450'];
    const rest = riderMotionPose(base, { wheelie: 0, steer: 0, landing: 0 })
      .limbs[1].arm;
    const positions = [...rest.start, ...rest.joint, ...rest.end];
    const geometry = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    const original = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    parent.add(original);
    const update = skinLimb(parent, [original], rest);
    const mesh = parent.children.find(
      (c) => c instanceof THREE.SkinnedMesh,
    ) as THREE.SkinnedMesh;
    parent.updateMatrixWorld(true);
    mesh.skeleton.update();
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(
        geometry.getAttribute('position'),
        i,
      );
      expect(mesh.applyBoneTransform(i, p.clone()).distanceTo(p)).toBeLessThan(
        1e-6,
      );
    }
    const pose = riderMotionPose(base, { wheelie: 1, steer: 1, landing: 1 })
      .limbs[1].arm;
    update(pose);
    parent.updateMatrixWorld(true);
    mesh.skeleton.update();
    const endpoint = new THREE.Vector3().fromBufferAttribute(
      geometry.getAttribute('position'),
      2,
    );
    expect(
      mesh
        .applyBoneTransform(2, endpoint)
        .distanceTo(new THREE.Vector3(...rest.end)),
    ).toBeLessThan(1e-6);
    expect(parent.children).toHaveLength(2);
    mesh.skeleton.dispose();
    geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});

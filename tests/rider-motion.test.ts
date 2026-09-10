import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  POSES,
  RIDER_DIMENSIONS as d,
  type Point,
} from '../app/game/riderSkeleton';
import { riderMotionPose } from '../app/game/riderMotion';
import { skinLimb } from '../app/game/limbSkin';
const distance = (a: Point, b: Point) =>
  new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));
describe('animated immutable rider', () => {
  it('keeps every bone length and both contact targets through combined motion on all bikes', () => {
    for (const base of Object.values(POSES))
      for (const wheelie of [0, 0.5, 1])
        for (const steer of [-1, 0, 1])
          for (const landing of [0, 0.5, 1]) {
            const p = riderMotionPose(base, { wheelie, steer, landing });
            expect(distance(p.hip, p.shoulder)).toBeCloseTo(d.torsoLength, 10);
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

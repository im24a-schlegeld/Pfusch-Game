import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Color, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeImportedBike } from '../app/game/importedBike';
import { installImportedBikeAsset, type ImportedBikeManifest, type ImportedBikeId } from '../app/game/importedBikeAsset';
import { IMPORTED_BIKE_WHEELBASE, IMPORTED_BIKE_TAIL } from '../app/game/importedBikeDimensions';
import { RIDER_DIMENSIONS, type RiderPose } from '../app/game/riderSkeleton';
import { riderMotionPose, type RiderMotion } from '../app/game/riderMotion';
import type { RagdollPose } from '../app/game/ragdoll';

const folders = { '125': 'ciao', moped: 'moped', '450': 'fs450', '701': 'r6', scooter: 'nitro' };
const fixtures = Object.fromEntries(Object.entries(folders).map(([id, folder]) => {
  const manifest = JSON.parse(readFileSync(`public/models/${folder}/model.json`, 'utf8')) as ImportedBikeManifest;
  const buffer = readFileSync(`public/models/${folder}/model.bin`);
  installImportedBikeAsset(id as ImportedBikeId, { manifest, binary: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), textures: new Map() });
  return [id, { manifest, buffer }];
}));
function makeTestBike(id: ImportedBikeId) {
  let pose!: RiderPose;
  let motion!: ReturnType<typeof riderMotionPose>;
  const result = makeImportedBike({ ...newPlayer(), bike: id }, [], (parent, sourcePose) => {
    pose = sourcePose;
    const group = new Group(); parent.add(group);
    return {
      group,
      animate: (input: RiderMotion) => { motion = riderMotionPose(pose, input); },
      animateAccessories: () => undefined,
      captureRagdollPose: () => ({} as RagdollPose),
      applyRagdollPose: () => undefined,
    };
  });
  return { ...result, pose, motion: () => motion };
}

describe.each(['125', 'moped', '450', '701', 'scooter'] as const)('Imported %s animation contract', (id) => {
  const { manifest, buffer } = fixtures[id];
  const size = IMPORTED_BIKE_WHEELBASE[id] / (manifest.anchors.rearAxle[2] - manifest.anchors.frontAxle[2]);
  const bike = () => makeTestBike(id);
  it('shares the exact imported tail with deterministic wheelie physics', () => {
    expect(IMPORTED_BIKE_TAIL[id].tail).toEqual(manifest.anchors.tail.map((value) => value * size));
  });
  it('reproduces every exported part in its original neutral source pose', () => {
    const model = bike(); model.root.updateMatrixWorld(true);
    const inverse = model.body.matrixWorld.clone().invert();
    const point = new Vector3(), matrix = new Matrix4();
    for (const part of manifest.parts) {
      let found: Mesh | undefined;
      model.body.traverse((object) => { if (object instanceof Mesh && object.userData.importedPart === part.name) found = object; });
      expect(found, part.name).toBeDefined();
      const mesh = found!;
      const raw = new Float32Array(buffer.buffer, buffer.byteOffset + part.position.offset, part.position.count * 3);
      matrix.multiplyMatrices(inverse, mesh.matrixWorld);
      const positions = mesh.geometry.getAttribute('position');
      let maximumShapeError = 0;
      const expected = new Vector3();
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index).applyMatrix4(matrix);
        expected.set(raw[index * 3], raw[index * 3 + 1], raw[index * 3 + 2]).multiplyScalar(size);
        maximumShapeError = Math.max(maximumShapeError, point.distanceTo(expected));
      }
      expect(maximumShapeError, part.name).toBeLessThan(0.000001);
    }
  });

  it('keeps both wheel contact heights through suspension and spins each wheel around its axle', () => {
    const model = bike(); model.root.updateMatrixWorld(true);
    const rest = model.wheels.map((wheel) => wheel.getWorldPosition(new Vector3()));
    for (const travel of [-0.025, 0.045, 0.12]) {
      model.animateSuspension(0, travel); model.root.updateMatrixWorld(true);
      model.wheels.forEach((wheel, index) => {
        expect(wheel.getWorldPosition(new Vector3()).y).toBeCloseTo(rest[index].y, 7);
        const before = wheel.getWorldPosition(new Vector3());
        wheel.rotation.x += 1.2; model.root.updateMatrixWorld(true);
        expect(wheel.getWorldPosition(new Vector3()).distanceTo(before)).toBeLessThan(1e-9);
      });
    }
  });

  it('turns the real front assembly and wrists while retaining immutable arm and leg lengths', () => {
    const model = bike();
    const steering = model.body.getObjectByName('imported-steering')!;
    for (const steer of [-1, 0, 1]) for (const wheelie of [0, 1]) {
      model.animateRider({ steer, wheelie, landing: 0.7, forward: 0.5 }, 0.2);
      expect(steering.matrix.elements.every(Number.isFinite)).toBe(true);
      for (const limb of model.motion().limbs) {
        const distance = (a: number[], b: number[]) => new Vector3().fromArray(a).distanceTo(new Vector3().fromArray(b));
        expect(distance(limb.arm.start, limb.arm.joint)).toBeCloseTo(RIDER_DIMENSIONS.upperArm, 7);
        expect(distance(limb.arm.joint, limb.arm.end)).toBeCloseTo(RIDER_DIMENSIONS.forearm, 7);
        expect(distance(limb.leg.start, limb.leg.joint)).toBeCloseTo(RIDER_DIMENSIONS.thigh, 7);
        expect(distance(limb.leg.joint, limb.leg.end)).toBeCloseTo(RIDER_DIMENSIONS.shin, 7);
      }
    }
    expect(model.pose.contactGrips?.[0][2]).not.toBe(model.pose.contactGrips?.[1][2]);
  });

  it('uses the actual handlebar meshes and turns both controls independently of rider weight shift', () => {
    let nearestGrip = Infinity;
    let gripRig: string | undefined;
    for (const part of manifest.parts) {
      const raw = new Float32Array(buffer.buffer, buffer.byteOffset + part.position.offset, part.position.count * 3);
      for (let index = 0; index < raw.length; index += 3) {
        const distance = Math.hypot(Math.abs(raw[index]) - manifest.anchors.grip[0],
          raw[index + 1] - manifest.anchors.grip[1], raw[index + 2] - manifest.anchors.grip[2]);
        if (distance < nearestGrip) { nearestGrip = distance; gripRig = part.rig; }
      }
    }
    expect(nearestGrip).toBeLessThan(0.06);
    expect(gripRig).toBe('steering');
    const model = bike();
    const steering = model.body.getObjectByName('imported-steering')!;
    model.root.updateMatrixWorld(true);
    const rearBefore = model.wheels[1].getWorldPosition(new Vector3());
    const neutral = model.pose.contactGrips!.map((grip) => new Vector3(...grip));
    model.animateRider({ steer: 0, handlebarSteer: 1, wheelie: 1, landing: 0 }, 0.2);
    model.root.updateMatrixWorld(true);
    const trace = steering.matrix.elements[0] + steering.matrix.elements[5] + steering.matrix.elements[10];
    const angle = Math.acos((trace - 1) / 2);
    expect(angle).toBeGreaterThan(0.14);
    expect(angle).toBeLessThan(0.161);
    expect(model.wheels[1].getWorldPosition(new Vector3()).distanceTo(rearBefore)).toBeLessThan(1e-12);
    for (let side = 0; side < 2; side++) {
      const expected = neutral[side].clone().divideScalar(model.body.scale.x)
        .applyMatrix4(steering.matrix).multiplyScalar(model.body.scale.x);
      expect(new Vector3(...model.pose.contactGrips![side]).distanceTo(expected)).toBeLessThan(1e-12);
      expect(model.motion().limbs[side].arm.end).toEqual(model.pose.contactGrips![side]);
      expect(expected.distanceTo(neutral[side])).toBeGreaterThan(0.02);
    }
    model.animateRider({ steer: 0, handlebarSteer: 0, wheelie: 1, landing: 0 }, 1 / 60);
    expect(steering.matrix.equals(new Matrix4())).toBe(false);
    for (let frame = 0; frame < 60; frame++)
      model.animateRider({ steer: 0, handlebarSteer: 0, wheelie: 1, landing: 0 }, 1 / 60);
    for (let side = 0; side < 2; side++)
      expect(new Vector3(...model.pose.contactGrips![side]).distanceTo(neutral[side])).toBeLessThan(1e-6);
  });

  it('puts the imported scooter rider on the rear half of the saddle', () => {
    if (id !== 'scooter') return;
    expect(bike().pose.hip[2]).toBeCloseTo(0.36, 6);
    expect(bike().pose.torsoLean).toBeCloseTo(0.34, 6);
  });

  it('owns independent geometries and materials for appearance rebuilds', () => {
    const first = bike(), second = bike();
    const firstTire = first.wheels[0].getObjectByName('tire') as Mesh;
    const secondTire = second.wheels[0].getObjectByName('tire') as Mesh;
    expect(firstTire.geometry).not.toBe(secondTire.geometry);
    expect(firstTire.material).not.toBe(secondTire.material);
    firstTire.geometry.dispose();
    expect(secondTire.geometry.getAttribute('position').count).toBeGreaterThan(100);
  });

  it('keeps dark trim and matte tyre materials separate from configurable rims', () => {
    const model = bike();
    const finishes = new Map<string, MeshStandardMaterial>();
    model.body.traverse((object) => {
      if (object instanceof Mesh && object.material instanceof MeshStandardMaterial)
        finishes.set(object.material.name, object.material);
    });
    for (const definition of manifest.materials.filter((material) => /trim/i.test(material.name))) {
      const expected = Array.isArray(definition.color)
        ? new Color().fromArray(definition.color) : new Color(definition.color);
      expect(finishes.get(definition.name)!.color.getHex(), definition.name).toBe(expected.getHex());
    }
    for (const wheel of model.wheels) {
      const material = (wheel.getObjectByName('tire') as Mesh).material as MeshStandardMaterial;
      expect(material.color.getHex()).toBe(id === '450' ? 0x090909 : 0x16181a);
      expect(material.metalness).toBe(0);
      expect(material.roughness).toBe(1);
      expect(material.map).toBeNull();
      if (id === '450') expect(material.envMapIntensity).toBe(0);
    }
  });
});

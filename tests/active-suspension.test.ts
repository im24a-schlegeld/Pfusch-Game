import { installImportedBikeFixtures } from './importedBikeFixture';
installImportedBikeFixtures();
import { describe, expect, it, vi } from 'vitest';
import { Group, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';
import {
  activeSuspensionPose,
  suspensionTarget,
} from '../app/game/activeSuspension';
import { SUPERMOTO_STATIC_SAG, supermotoSettledOffset } from '../app/game/supermotoRideHeight';
import { getImportedBikeAsset } from '../app/game/importedBikeAsset';
import { IMPORTED_BIKE_WHEELBASE } from '../app/game/importedBikeDimensions';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

const closeMatrix = (a: Matrix4, b: Matrix4) =>
  expect(
    Math.max(...a.elements.map((n, i) => Math.abs(n - b.elements[i]))),
  ).toBeLessThan(1e-10);

describe('active fork and rear suspension', () => {
  it.each(['125', 'scooter', 'moped', '450', '701'] as const)(
    '%s visibly compresses and returns without moving tire contacts or changing the rider',
    (model) => {
      const bike = makeBike({ ...newPlayer(), bike: model }, []);
      const rootScale = bike.root.scale.clone(),
        riderScale = bike.rider.scale.clone();
      bike.body.updateMatrix();
      const settledBody = bike.body.matrix.clone();
      const parents = new Map(
        bike.body.children.map((part, index) => [part, index]),
      );
      const boneScales: number[][] = [];
      bike.rider.traverse((part) => {
        if (part.type === 'Bone') boneScales.push(part.scale.toArray());
      });
      const fork = bike.body.getObjectByName('front-suspension-axle')!;
      expect(fork).toBeDefined();
      for (const pitch of [0, 0.68, 1.1]) {
        bike.animateSuspension(pitch, 0);
        bike.root.updateMatrixWorld(true);
        const wheels = bike.wheels.map((wheel) =>
          wheel.getWorldPosition(new Vector3()),
        );
        const neutralBody = bike.body.position.clone();
        for (const travel of [-0.025, 0.12, 0.05, 0]) {
          bike.animateSuspension(pitch, travel);
          bike.root.updateMatrixWorld(true);
          bike.wheels.forEach((wheel, index) =>
            expect(
              wheel.getWorldPosition(new Vector3()).distanceTo(wheels[index]),
            ).toBeLessThan(1e-9),
          );
          expect(bike.root.scale).toEqual(rootScale);
          expect(bike.rider.scale).toEqual(riderScale);
          const actualScales: number[][] = [];
          bike.rider.traverse((part) => {
            if (part.type === 'Bone') actualScales.push(part.scale.toArray());
          });
          expect(actualScales).toEqual(boneScales);
          for (const [part, index] of parents)
            expect(bike.body.children[index]).toBe(part);
          expect(bike.body.matrixWorld.elements.every(Number.isFinite)).toBe(
            true,
          );
          if (travel > 0.1 && pitch === 0) {
            expect(bike.body.position.distanceTo(neutralBody)).toBeGreaterThan(.03);
          }
        }
      }
      bike.animateSuspension(0, 0);
      bike.root.updateMatrixWorld(true);
      closeMatrix(bike.body.matrix, settledBody);
    },
  );

  it.each(['scooter', 'moped', '450', '701'] as const)(
    '%s coil compresses between its real frame and moving arm mounts',
    (model) => {
      const bike = makeBike({ ...newPlayer(), bike: model }, []);
      const shock = bike.body.getObjectByName('active-rear-shock') as Group;
      const rear = bike.body.getObjectByName('rear-suspension-axle') as Group;
      const source = getImportedBikeAsset(model).manifest.anchors;
      const size = IMPORTED_BIKE_WHEELBASE[model] / (source.rearAxle[2] - source.frontAxle[2]);
      const top = new Vector3(...source.shockTop).multiplyScalar(size),
        bottom = new Vector3(...source.shockBottom).multiplyScalar(size);
      const length = top.distanceTo(bottom);
      bike.animateSuspension(0, 0);
      const settledShock = shock.matrix.clone(), settledRear = rear.matrix.clone();
      const settledLength = top.distanceTo(bottom.clone().applyMatrix4(settledShock));
      bike.animateSuspension(0, 0.12);
      expect(
        top.clone().applyMatrix4(shock.matrix).distanceTo(top),
      ).toBeLessThan(1e-10);
      expect(
        bottom
          .clone()
          .applyMatrix4(shock.matrix)
          .distanceTo(bottom.clone().applyMatrix4(rear.matrix)),
      ).toBeLessThan(1e-10);
      expect(
        top.distanceTo(bottom.clone().applyMatrix4(shock.matrix)),
      ).toBeLessThan(length - .002);
      expect(rear.rotation.x).toBeLessThan(-0.04);
      bike.animateSuspension(0, -0.025);
      expect(
        top.distanceTo(bottom.clone().applyMatrix4(shock.matrix)),
      ).toBeGreaterThan(settledLength);
      bike.animateSuspension(0, 0);
      closeMatrix(shock.matrix, settledShock);
      closeMatrix(rear.matrix, settledRear);
    },
  );

  it('uses small wheelie squat and bounded landing travel, retaining the hardtail rear', () => {
    for (const model of ['125', 'scooter', 'moped', '450', '701']) {
      const wheelie = activeSuspensionPose(
        model,
        0.8,
        0,
        0.7,
        -0.72,
        0.31,
        0.8,
      );
      const landing = activeSuspensionPose(model, 0, 0.17, 0.7, -0.72, 0.31);
      const neutral = activeSuspensionPose(model, 0, 0, 0.7, -0.72, 0.31);
      expect(Math.abs(wheelie.frontTravel - neutral.frontTravel)).toBeLessThan(
        (landing.frontTravel - neutral.frontTravel) / 4,
      );
      expect(wheelie.rearTravel - neutral.rearTravel).toBeLessThanOrEqual(
        (landing.rearTravel - neutral.rearTravel) / 3,
      );
      expect(landing.frontTravel).toBeLessThanOrEqual(0.125);
      if (model === '125') expect(landing.rearAngle).toBe(0);
    }
    const rest = {
      landing: 0,
      launch: 0,
      forward: 0,
      road: 0,
      roughness: 0,
      airborne: false,
    };
    expect(suspensionTarget(rest)).toBe(0);
    expect(suspensionTarget({ ...rest, airborne: true })).toBeLessThan(0);
    expect(suspensionTarget({ ...rest, landing: 1 })).toBeGreaterThan(0.12);
    let travel = -0.025;
    const samples: number[] = [];
    for (let step = 0; step < 90; step++) {
      const load = suspensionTarget({
        ...rest,
        landing: Math.exp((-step / 60) * 9),
      });
      travel += (load - travel) * (1 - Math.exp(-18 / 60));
      samples.push(travel);
    }
    expect(Math.max(...samples)).toBeGreaterThan(0.07);
    expect(samples.at(-1)).toBeLessThan(0.001);
  });

  it('settles the Supermoto exactly 50 mm through the real suspension without changing axle datums', () => {
    const rearRadius = 0.3059, rear = 0.736, front = -0.736;
    const pose = activeSuspensionPose('450', 0, 0, rear, front, rearRadius);
    expect(pose.frontTravel).toBe(SUPERMOTO_STATIC_SAG);
    expect(pose.rearTravel).toBe(SUPERMOTO_STATIC_SAG);
    expect(pose.pitch).toBe(0);
    expect(pose.position.y).toBeCloseTo(-0.050, 12);
    expect(pose.position.distanceTo(new Vector3(...supermotoSettledOffset(rearRadius, rear)))).toBeLessThan(1e-12);
    const sprung = new Matrix4().makeRotationX(pose.pitch).setPosition(pose.position);
    const rearRig = new Matrix4().makeRotationX(pose.rearAngle).setPosition(pose.rearPosition);
    const frontRig = new Matrix4().makeRotationX(pose.axleAngle).setPosition(pose.axlePosition);
    const rearAxle = new Vector3(0, rearRadius, rear).applyMatrix4(rearRig).applyMatrix4(sprung);
    const frontAxle = new Vector3(0, 0.29355, front).applyMatrix4(frontRig).applyMatrix4(sprung);
    expect(rearAxle.distanceTo(new Vector3(0, rearRadius, rear))).toBeLessThan(1e-12);
    expect(frontAxle.distanceTo(new Vector3(0, 0.29355, front))).toBeLessThan(1e-12);
    expect(rearAxle.z - frontAxle.z).toBeCloseTo(1.472, 12);
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.scale.setScalar(1);
    bike.animateSuspension(0, 0);
    bike.root.updateMatrixWorld(true);
    const assembled = bike.wheels.map(wheel => wheel.getWorldPosition(new Vector3()).divideScalar(bike.body.scale.x));
    expect(assembled[1].z - assembled[0].z).toBeCloseTo(1.472, 12);
    const source = getImportedBikeAsset('450').manifest.anchors;
    const size = 1.472 / (source.rearAxle[2] - source.frontAxle[2]);
    expect(assembled[0].y).toBeCloseTo(source.frontAxle[1] * size, 7);
    expect(assembled[1].y).toBeCloseTo(source.rearAxle[1] * size, 7);
    expect(bike.body.position.y).toBeCloseTo(0, 12);
  });

  it.each(['125', 'moped', '450', '701', 'scooter'] as const)('%s carries fixed brake hardware with the lower fork, never the rotating wheel', model => {
    const bike = makeBike({ ...newPlayer(), bike: model }, []);
    const fork = bike.body.getObjectByName('front-suspension-axle')!;
    const metal: Mesh[] = [];
    fork.traverse(object => { if (object instanceof Mesh && object.userData.importedRig === 'fork'
      && /mechanic|caliper/.test(object.name)) metal.push(object); });
    expect(metal.length).toBeGreaterThan(0);
    bike.animateSuspension(.5, .08); bike.root.updateMatrixWorld(true);
    const before = metal.map(part => part.matrixWorld.clone());
    bike.wheels[0].rotation.x += 2; bike.root.updateMatrixWorld(true);
    metal.forEach((part, i) => closeMatrix(part.matrixWorld, before[i]));
    const incorrectlySpinning: Mesh[] = [];
    bike.wheels[0].traverse(part => { if (part instanceof Mesh && part.userData.importedRig === 'fork') incorrectlySpinning.push(part); });
    expect(incorrectlySpinning).toHaveLength(0);
  });
});

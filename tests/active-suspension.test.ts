import { describe, expect, it, vi } from 'vitest';
import { Group, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';
import {
  activeSuspensionPose,
  suspensionTarget,
} from '../app/game/activeSuspension';
import {
  SUPERMOTO_SHOCK_BOTTOM,
  SUPERMOTO_SHOCK_TOP,
} from '../app/game/supermotoFit';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

const anchors = {
  scooter: [
    [-0.147, 0.619, 0.467],
    [-0.135, 0.27, 0.563],
  ],
  '450': [SUPERMOTO_SHOCK_TOP, SUPERMOTO_SHOCK_BOTTOM],
  '701': [
    [0, 0.73, 0.205],
    [0, 0.508, 0.335],
  ],
} as const;
const closeMatrix = (a: Matrix4, b: Matrix4) =>
  expect(
    Math.max(...a.elements.map((n, i) => Math.abs(n - b.elements[i]))),
  ).toBeLessThan(1e-10);

describe('active fork and rear suspension', () => {
  it.each(['125', 'scooter', '450', '701'] as const)(
    '%s visibly compresses and returns without moving tire contacts or changing the rider',
    (model) => {
      const bike = makeBike({ ...newPlayer(), bike: model }, []);
      const rootScale = bike.root.scale.clone(),
        riderScale = bike.rider.scale.clone();
      const parents = new Map(
        bike.body.children.map((part, index) => [part, index]),
      );
      const boneScales: number[][] = [];
      bike.rider.traverse((part) => {
        if (part.type === 'Bone') boneScales.push(part.scale.toArray());
      });
      const fork = bike.body.getObjectByName(
        model === 'scooter' ? 'fork-stanchion' : 'telescopic-fork-slider',
      ) as Mesh;
      expect(fork).toBeDefined();
      for (const pitch of [0, 0.68, 1.1]) {
        bike.animateSuspension(pitch, 0);
        bike.root.updateMatrixWorld(true);
        const wheels = bike.wheels.map((wheel) =>
          wheel.getWorldPosition(new Vector3()),
        );
        const neutralFork = fork.scale.y;
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
          if (travel > 0.1 && pitch === 0)
            expect(fork.scale.y).toBeLessThan(neutralFork - 0.04);
        }
      }
      bike.animateSuspension(0, 0);
      bike.root.updateMatrixWorld(true);
      closeMatrix(
        bike.body.matrix
          .clone()
          .scale(
            new Vector3(
              1 / bike.body.scale.x,
              1 / bike.body.scale.y,
              1 / bike.body.scale.z,
            ),
          ),
        new Matrix4(),
      );
    },
  );

  it.each(['scooter', '450', '701'] as const)(
    '%s coil compresses between its real frame and moving arm mounts',
    (model) => {
      const bike = makeBike({ ...newPlayer(), bike: model }, []);
      const shock = bike.body.getObjectByName('active-rear-shock') as Group;
      const rear = bike.body.getObjectByName('rear-suspension-axle') as Group;
      const top = new Vector3(...anchors[model][0]),
        bottom = new Vector3(...anchors[model][1]);
      const length = top.distanceTo(bottom);
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
      ).toBeLessThan(length * 0.97);
      expect(rear.rotation.x).toBeLessThan(-0.06);
      bike.animateSuspension(0, -0.025);
      expect(
        top.distanceTo(bottom.clone().applyMatrix4(shock.matrix)),
      ).toBeGreaterThan(length);
      bike.animateSuspension(0, 0);
      closeMatrix(shock.matrix, new Matrix4());
      closeMatrix(rear.matrix, new Matrix4());
    },
  );

  it('uses small wheelie squat and bounded landing travel, retaining the hardtail rear', () => {
    for (const model of ['125', 'scooter', '450', '701']) {
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
      expect(Math.abs(wheelie.frontTravel)).toBeLessThan(
        landing.frontTravel / 4,
      );
      expect(wheelie.rearTravel).toBeLessThanOrEqual(landing.rearTravel / 3);
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
});

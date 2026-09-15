import { describe, expect, it } from 'vitest';
import { Group, Scene, SpotLight, Vector3 } from 'three';
import { createBikeHeadlightRig } from '../app/game/bikeHeadlight';
import { suspensionPose } from '../app/game/bikeMotion';
import type { BikeModelId } from '../app/game/vehicleScale';

type Point = readonly [number, number, number];
type Fixture = {
  model: BikeModelId;
  scale: number;
  rear: number;
  front: number;
  radius: number;
  emitters: readonly Point[];
};

// Optical and axle coordinates verified against each model's visible geometry.
const fixtures: readonly Fixture[] = [
  {
    model: '125',
    scale: 1,
    rear: 0.55,
    front: -0.7,
    radius: 0.305,
    emitters: [[0, 0.967, -0.604]],
  },
  {
    model: 'scooter',
    scale: 1,
    rear: 0.64,
    front: -0.65,
    radius: 0.231,
    emitters: [[0, 0.611, -0.785]],
  },
  {
    model: '450',
    scale: 1.06,
    rear: 0.76,
    front: -0.77,
    radius: 0.3119 * 1.05,
    emitters: [[0, 0.99, -0.641]],
  },
  {
    model: '701',
    scale: 1.12,
    rear: 0.685,
    front: -0.72,
    radius: 0.3204,
    emitters: [
      [-0.166, 0.797, -0.7801],
      [0.166, 0.797, -0.7801],
    ],
  },
];

type Motion = {
  name: string;
  pitch: number;
  travel: number;
  height: number;
  lean: number;
  x: number;
};
const motions: readonly Motion[] = [
  { name: 'grounded', pitch: 0, travel: 0, height: 0, lean: 0, x: 0 },
  { name: 'wheelie', pitch: 0.64, travel: 0, height: 0, lean: 0, x: 0 },
  { name: 'jump', pitch: 0.12, travel: -0.008, height: 1.2, lean: 0, x: 0.8 },
  {
    name: 'lane lean',
    pitch: 0,
    travel: 0.007,
    height: 0,
    lean: -0.18,
    x: -1.1,
  },
  {
    name: 'compressed fork',
    pitch: 0,
    travel: 0.024,
    height: 0,
    lean: 0,
    x: 0,
  },
  {
    name: 'combined motion',
    pitch: 0.73,
    travel: 0.015,
    height: 0.7,
    lean: 0.17,
    x: 0.6,
  },
];

function sceneFor(fixture: Fixture) {
  const scene = new Scene(),
    root = new Group(),
    body = new Group();
  const lights = [new SpotLight(), new SpotLight()];
  root.scale.setScalar(1.45);
  body.scale.setScalar(fixture.scale);
  scene.add(root);
  root.add(body);
  for (const light of lights) scene.add(light, light.target);
  return { scene, root, body, lights };
}

function poseBody(fixture: Fixture, motion: Motion, root: Group, body: Group) {
  const pose = suspensionPose(
    motion.pitch,
    motion.travel / fixture.scale,
    fixture.rear,
    fixture.front,
    fixture.radius,
  );
  root.position.set(motion.x, motion.height, 0);
  root.rotation.z = motion.lean;
  body.rotation.x = pose.pitch;
  body.position.copy(pose.position).multiplyScalar(fixture.scale);
  // Deliberately leave matrices stale; a pre-render update must see this pose.
}

/** Independent scalar derivation of the renderer's final chassis transform. */
function expectedWorld(point: Point, fixture: Fixture, motion: Motion): Point {
  const travel = Math.max(
    -0.008,
    Math.min(0.024, motion.travel / fixture.scale),
  );
  const suspensionAngle = -travel / (fixture.rear - fixture.front);
  const pitch = motion.pitch + suspensionAngle;
  const suspensionY =
    fixture.radius * (1 - Math.cos(suspensionAngle)) +
    fixture.rear * Math.sin(suspensionAngle);
  const suspensionZ =
    fixture.rear * (1 - Math.cos(suspensionAngle)) -
    fixture.radius * Math.sin(suspensionAngle);
  const translationY =
    fixture.radius * (1 - Math.cos(motion.pitch)) +
    fixture.rear * Math.sin(motion.pitch) +
    suspensionY * Math.cos(motion.pitch) -
    suspensionZ * Math.sin(motion.pitch);
  const translationZ =
    suspensionY * Math.sin(motion.pitch) + suspensionZ * Math.cos(motion.pitch);
  const factor = fixture.scale * 1.45;
  const x = point[0] * factor;
  const y =
    (point[1] * Math.cos(pitch) - point[2] * Math.sin(pitch) + translationY) *
    factor;
  const z =
    (point[1] * Math.sin(pitch) + point[2] * Math.cos(pitch) + translationZ) *
    factor;
  return [
    x * Math.cos(motion.lean) - y * Math.sin(motion.lean) + motion.x,
    x * Math.sin(motion.lean) + y * Math.cos(motion.lean) + motion.height,
    z,
  ];
}

function expectPoint(actual: Vector3, expected: Point) {
  expect(actual.x).toBeCloseTo(expected[0], 10);
  expect(actual.y).toBeCloseTo(expected[1], 10);
  expect(actual.z).toBeCloseTo(expected[2], 10);
}

describe.each(fixtures)('$model headlight pose', (fixture) => {
  it.each(motions)('keeps source and aim attached through $name', (motion) => {
    const { root, body, lights } = sceneFor(fixture);
    const rig = createBikeHeadlightRig(fixture.model);
    poseBody(fixture, motion, root, body);
    rig.copyPose(body, lights);
    expect(rig.count).toBe(fixture.emitters.length);
    fixture.emitters.forEach((source, i) => {
      expectPoint(lights[i].position, expectedWorld(source, fixture, motion));
      const aim: Point = [
        source[0],
        source[1] - (20 * 1.22) / 23,
        source[2] - 20,
      ];
      expectPoint(
        lights[i].target.position,
        expectedWorld(aim, fixture, motion),
      );
    });
  });

  it('raises the entire beam during a wheelie, holds it, then restores its grounded pose', () => {
    const { root, body, lights } = sceneFor(fixture);
    const rig = createBikeHeadlightRig(fixture.model);
    poseBody(fixture, motions[0], root, body);
    rig.copyPose(body, lights);
    const grounded = lights.slice(0, rig.count).map((light) => ({
      source: light.position.clone(),
      target: light.target.position.clone(),
    }));
    for (let i = 0; i < rig.count; i++)
      expect(lights[i].target.position.y).toBeLessThan(lights[i].position.y);

    poseBody(fixture, motions[1], root, body);
    rig.copyPose(body, lights);
    const held = lights.slice(0, rig.count).map((light) => ({
      source: light.position.clone(),
      target: light.target.position.clone(),
    }));
    for (let i = 0; i < rig.count; i++) {
      expect(lights[i].position.y).toBeGreaterThan(grounded[i].source.y + 0.4);
      expect(lights[i].target.position.y).toBeGreaterThan(
        lights[i].position.y + 8,
      );
    }
    rig.copyPose(body, lights);
    for (let i = 0; i < rig.count; i++) {
      expect(lights[i].position).toEqual(held[i].source);
      expect(lights[i].target.position).toEqual(held[i].target);
    }
    poseBody(fixture, motions[0], root, body);
    rig.copyPose(body, lights);
    for (let i = 0; i < rig.count; i++) {
      expectPoint(
        lights[i].position,
        grounded[i].source.toArray() as [number, number, number],
      );
      expectPoint(
        lights[i].target.position,
        grounded[i].target.toArray() as [number, number, number],
      );
    }
  });
});

it('uses the explicit current body after a vehicle rebuild instead of retaining the first body', () => {
  const fixture = fixtures[1],
    rig = createBikeHeadlightRig(fixture.model);
  const previous = sceneFor(fixture),
    current = sceneFor(fixture);
  poseBody(fixture, motions[1], previous.root, previous.body);
  rig.copyPose(previous.body, previous.lights);
  poseBody(fixture, motions[5], current.root, current.body);
  rig.copyPose(current.body, previous.lights);
  expectPoint(
    previous.lights[0].position,
    expectedWorld(fixture.emitters[0], fixture, motions[5]),
  );
});

it('leaves intensity, visibility and spare pooled light positions under caller control', () => {
  const fixture = fixtures[0],
    { body, lights } = sceneFor(fixture);
  lights[0].intensity = 55;
  lights[1].intensity = 0;
  lights[1].visible = false;
  lights[1].position.set(3, 4, 5);
  lights[1].target.position.set(6, 7, 8);
  const position = lights[0].position,
    target = lights[0].target.position;
  createBikeHeadlightRig('125').copyPose(body, lights);
  expect(lights[0].position).toBe(position);
  expect(lights[0].target.position).toBe(target);
  expect(lights.map((light) => light.intensity)).toEqual([55, 0]);
  expect(lights[1].visible).toBe(false);
  expectPoint(lights[1].position, [3, 4, 5]);
  expectPoint(lights[1].target.position, [6, 7, 8]);
});

it('requires both Sport projector destinations before mutating either beam', () => {
  const rig = createBikeHeadlightRig('701'),
    body = new Group(),
    light = new SpotLight();
  light.position.set(7, 8, 9);
  light.target.position.set(1, 2, 3);
  expect(() => rig.copyPose(body, [light])).toThrow(RangeError);
  expectPoint(light.position, [7, 8, 9]);
  expectPoint(light.target.position, [1, 2, 3]);
});

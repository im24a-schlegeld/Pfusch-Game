import { describe, expect, it, vi } from 'vitest';
import { Euler, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { RIDER_DIMENSIONS as d, type Point } from '../app/game/riderSkeleton';
import { riderHeadPose, wheelieLanePose, WHEELIE_LANE_DURATION } from '../app/game/riderMotion';
import { installImportedBikeFixtures } from './importedBikeFixture';
import { disposeUnique } from '../app/game/models';

installImportedBikeFixtures();
vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));
const laneInput = { age: 0.2, direction: 1, wheelie: 1,
  airborne: false, onTowTruck: false, reducedMotion: false };
const distance = (a: Point, b: Point) => new Vector3(...a).distanceTo(new Vector3(...b));

describe('rider gaze follows the horizon', () => {
  it('looks forward near level at a 0.7 radian wheelie and counters body roll', () => {
    const gaze = riderHeadPose({ wheelie: 1, steer: 0.25, landing: 0, bikePitch: 0.7, bikeRoll: 0.12 });
    const body = new Quaternion().setFromEuler(new Euler(0, 0, 0.12))
      .multiply(new Quaternion().setFromEuler(new Euler(0.7, 0, 0)));
    const head = body.multiply(new Quaternion().setFromEuler(new Euler(gaze.pitch, gaze.yaw, gaze.roll)));
    const forward = new Vector3(0, 0, -1).applyQuaternion(head);
    const up = new Vector3(0, 1, 0).applyQuaternion(head);
    expect(Math.abs(forward.y)).toBeLessThan(0.02);
    expect(forward.z).toBeLessThan(-0.99);
    expect(Math.abs(up.x)).toBeLessThan(0.035);
  });

  it.each(['125', 'scooter', '450', '701'] as const)('%s damps its actual helmet without resizing bones or moving contacts', model => {
    const bike = makeBike({ ...newPlayer(), bike: model }, []);
    const helmet = bike.rider.getObjectByName('full-face-helmet')!;
    const scale = helmet.scale.clone();
    const rest = bike.captureRagdollPose();
    bike.root.rotation.z = 0.12;
    bike.animateSuspension(0.7, 0, 1);
    const target = { wheelie: 1, steer: 0, landing: 0,
      bikePitch: bike.body.rotation.x, bikeRoll: bike.root.rotation.z };
    const initialPitch = helmet.rotation.x;
    bike.animateRider(target, 1 / 60);
    expect(helmet.rotation.x).toBeLessThan(initialPitch - 0.1);
    expect(helmet.rotation.x).toBeGreaterThan(riderHeadPose(target).pitch + 0.1);
    for (let frame = 1; frame < 45; frame++) bike.animateRider(target, 1 / 60);
    bike.root.updateMatrixWorld(true);
    const world = helmet.getWorldQuaternion(new Quaternion());
    const forward = new Vector3(0, 0, -1).applyQuaternion(world);
    expect(Math.abs(forward.y)).toBeLessThan(0.035);
    expect(forward.z).toBeLessThan(-0.99);
    expect(Math.abs(new Vector3(0, 1, 0).applyQuaternion(world).x)).toBeLessThan(0.035);
    expect(helmet.scale.toArray()).toEqual(scale.toArray());
    const current = bike.captureRagdollPose();
    expect(distance(current.hip, current.shoulder)).toBeCloseTo(d.torsoLength, 9);
    current.limbs.forEach(({ arm, leg }, index) => {
      expect(distance(arm.start, arm.joint)).toBeCloseTo(d.upperArm, 9);
      expect(distance(arm.joint, arm.end)).toBeCloseTo(d.forearm, 9);
      expect(distance(leg.start, leg.joint)).toBeCloseTo(d.thigh, 9);
      expect(distance(leg.joint, leg.end)).toBeCloseTo(d.shin, 9);
      expect(distance(arm.end, rest.limbs[index].arm.end)).toBeLessThan(1e-12);
      expect(distance(leg.end, rest.limbs[index].leg.end)).toBeLessThan(1e-12);
    });
    disposeUnique(bike.root);
  });

  it('bounds neck rotation and keeps invalid attitude values finite', () => {
    const neutral = { wheelie: 0, steer: 0, landing: 0 };
    expect(riderHeadPose({ ...neutral, bikePitch: Infinity, bikeRoll: NaN })).toEqual(riderHeadPose(neutral));
    const extreme = riderHeadPose({ ...neutral, steer: 50, bikePitch: 50, bikeRoll: -50 });
    expect(extreme.pitch).toBeGreaterThan(-1.25);
    expect(Math.abs(extreme.roll)).toBeLessThan(0.28);
    expect(Math.abs(extreme.yaw)).toBeLessThan(0.04);
  });
});

describe('brief wheelie lane balance', () => {
  it('mirrors each direction, stays restrained and has a small counter-settle', () => {
    for (let index = 1; index < 110; index++) {
      const age = index / 200;
      const right = wheelieLanePose({ ...laneInput, age });
      const left = wheelieLanePose({ ...laneInput, age, direction: -1 });
      expect(Math.abs(right.roll)).toBeLessThanOrEqual(0.065);
      expect(Math.abs(right.yaw)).toBeLessThanOrEqual(0.04);
      for (const key of ['roll', 'yaw', 'steer'] as const) expect(left[key]).toBeCloseTo(-right[key], 12);
    }
    expect(wheelieLanePose(laneInput).roll).toBeLessThan(-0.045);
    expect(wheelieLanePose({ ...laneInput, age: 0.47 }).roll).toBeGreaterThan(0.005);
  });

  it('starts and ends at zero and stays absent on ramps, in the air or with reduced motion', () => {
    const zero = { roll: 0, yaw: 0, steer: 0 };
    for (const age of [-1, 0, WHEELIE_LANE_DURATION, 1, Infinity, NaN])
      expect(wheelieLanePose({ ...laneInput, age })).toEqual(zero);
    for (const flag of ['airborne', 'onTowTruck', 'reducedMotion'] as const)
      expect(wheelieLanePose({ ...laneInput, [flag]: true })).toEqual(zero);
    const noWheelie = wheelieLanePose({ ...laneInput, wheelie: 0 });
    expect(Object.values(noWheelie).every(value => value === 0)).toBe(true);
    expect(Math.abs(wheelieLanePose({ ...laneInput, age: 0.00001 }).roll)).toBeLessThan(1e-8);
    expect(Math.abs(wheelieLanePose({ ...laneInput, age: WHEELIE_LANE_DURATION - 0.00001 }).roll)).toBeLessThan(1e-8);
  });
});

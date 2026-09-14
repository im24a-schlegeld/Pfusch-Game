import { describe, expect, it } from 'vitest';
import { Group, Vector3 } from 'three';
import { createCarriedCapMotion } from '../app/game/carriedCapMotion';

const down = new Vector3(0, -1, 0);
const makeCap = () => {
  const bike = new Group();
  const pelvis = new Group();
  const pivot = new Group();
  const cap = new Group();
  bike.add(pelvis);
  pelvis.add(pivot);
  pivot.add(cap);
  pivot.position.set(-0.21, 1.1, 0.08);
  cap.position.set(0, -0.13, 0);
  cap.rotation.set(0.35, 0.5, 0.1);
  const motion = createCarriedCapMotion(pivot);
  const direction = () => {
    pivot.updateWorldMatrix(true, false);
    return down.clone().transformDirection(pivot.matrixWorld);
  };
  return { bike, pelvis, pivot, cap, motion, direction };
};

describe('carried cap pendulum', () => {
  it('hangs along world gravity through animated and scaled parents without moving the clip or cap geometry', () => {
    const { bike, pelvis, pivot, cap, motion, direction } = makeCap();
    const position = pivot.position.toArray();
    const capPosition = cap.position.toArray();
    const capRotation = cap.quaternion.toArray();
    for (let i = 0; i < 120; i++) {
      bike.rotation.set(i * 0.01, i * 0.017, Math.sin(i * 0.07) * 0.4);
      bike.scale.set(1.12, 0.95, 1.07);
      pelvis.rotation.set(-0.1, 0.12, -0.07);
      motion.update({}, 1 / 60);
      expect(direction().distanceTo(down)).toBeLessThan(1e-7);
      expect(pivot.position.toArray()).toEqual(position);
      expect(cap.position.toArray()).toEqual(capPosition);
      expect(cap.quaternion.toArray()).toEqual(capRotation);
    }
  });

  it('lags opposite acceleration, keeps a bounded cone and settles without drift', () => {
    const { motion, direction } = makeCap();
    for (let i = 0; i < 120; i++) {
      motion.update(
        { longitudinalAcceleration: 25, lateralAcceleration: 25 },
        1 / 60,
      );
      expect(direction().angleTo(down)).toBeLessThanOrEqual(0.400001);
    }
    expect(direction().x).toBeLessThan(-0.1);
    expect(direction().z).toBeGreaterThan(0.1);
    for (let i = 0; i < 600; i++) motion.update({}, 1 / 60);
    expect(direction().distanceTo(down)).toBeLessThan(1e-8);
  });

  it('integrates the same motion at 30, 60 and 120 Hz', () => {
    const results = [30, 60, 120].map((fps) => {
      const { motion, direction } = makeCap();
      for (let second = 0; second < 3; second++)
        for (let i = 0; i < fps; i++)
          motion.update(
            {
              longitudinalAcceleration: second === 0 ? 4 : -2,
              lateralAcceleration: second === 1 ? 5 : 0,
            },
            1 / fps,
          );
      return direction();
    });
    expect(results[0].distanceTo(results[1])).toBeLessThan(1e-9);
    expect(results[0].distanceTo(results[2])).toBeLessThan(1e-9);
  });

  it('gives one small landing impulse and does not retrigger a held landing envelope', () => {
    const { motion, direction } = makeCap();
    motion.update({ landing: 1 }, 1 / 60);
    expect(direction().z).toBeGreaterThan(0.001);
    expect(direction().angleTo(down)).toBeLessThan(0.02);
    for (let i = 0; i < 360; i++) motion.update({ landing: 1 }, 1 / 60);
    expect(direction().distanceTo(down)).toBeLessThan(1e-8);
    motion.update({ landing: 0 }, 1 / 60);
    motion.update({ landing: 1 }, 1 / 60);
    expect(direction().z).toBeGreaterThan(0.001);
  });

  it('freezes paused and invalid time without banking a later catch-up', () => {
    const frozen = makeCap(),
      reference = makeCap();
    for (const cap of [frozen, reference])
      cap.motion.update({ longitudinalAcceleration: 5 }, 1 / 60);
    const pose = frozen.pivot.quaternion.toArray();
    for (const dt of [0, -1, NaN, Infinity]) {
      frozen.motion.update({ landing: 1, longitudinalAcceleration: 30 }, dt);
      expect(frozen.pivot.quaternion.toArray()).toEqual(pose);
    }
    frozen.motion.update({ paused: true, landing: 1 }, 600);
    expect(frozen.pivot.quaternion.toArray()).toEqual(pose);
    for (const cap of [frozen, reference]) cap.motion.update({}, 1 / 60);
    expect(frozen.direction().distanceTo(reference.direction())).toBeLessThan(
      1e-12,
    );
  });

  it('limits stalls and malformed inputs, and reduced motion returns a static gravity hang', () => {
    const { bike, motion, pivot, direction } = makeCap();
    motion.update(
      {
        longitudinalAcceleration: 1e100,
        lateralAcceleration: -1e100,
        landing: 1e100,
      },
      600,
    );
    expect(direction().angleTo(down)).toBeLessThanOrEqual(0.400001);
    for (let i = 0; i < 30; i++)
      motion.update(
        {
          longitudinalAcceleration: NaN,
          lateralAcceleration: Infinity,
          landing: -Infinity,
        },
        1 / 60,
      );
    expect(pivot.quaternion.toArray().every(Number.isFinite)).toBe(true);
    bike.rotation.set(1.1, 0.7, 0.35);
    motion.update(
      { reducedMotion: true, longitudinalAcceleration: 30, landing: 1 },
      1 / 60,
    );
    expect(direction().distanceTo(down)).toBeLessThan(1e-8);
    motion.update({ landing: 1 }, 1 / 60);
    expect(direction().distanceTo(down)).toBeLessThan(1e-8);
    motion.reset();
    expect(direction().distanceTo(down)).toBeLessThan(1e-8);
  });
});

import { describe, expect, it } from 'vitest';
import { BIKE_MODEL_SCALES, type BikeModelId } from '../app/game/vehicleScale';
import {
  BIKE_CONTACTS,
  POSES,
  RIDER_DIMENSIONS,
  RIDER_TARGETS,
} from '../app/game/riderSkeleton';

describe('motorcycle scale with one adult skeleton', () => {
  it('retains the established adult anatomy and the entire Töffli target', () => {
    expect(RIDER_DIMENSIONS).toEqual({
      torsoLength: 0.53,
      neckToHelmetCenter: 0.22,
      shoulderHalf: 0.21,
      hipHalf: 0.125,
      upperArm: 0.34,
      forearm: 0.3,
      thigh: 0.43,
      shin: 0.43,
    });
    expect(BIKE_MODEL_SCALES['125']).toBe(1);
    expect(RIDER_TARGETS['125']).toEqual({
      hip: [0, 0.94, 0.25],
      grip: [0.31, 1.25, -0.4],
      peg: [0.2, 0.33, 0.12],
      torsoLean: 0.16,
    });
  });

  it.each(['450', '701'] as BikeModelId[])(
    '%s reaches the larger motorcycle with unchanged hand and boot offsets',
    (id) => {
      expect(BIKE_MODEL_SCALES[id]).toBe(1.12);
      for (const contact of ['hip', 'grip', 'peg'] as const)
        for (let axis = 0; axis < 3; axis++)
          expect(POSES[id][contact][axis]).toBeCloseTo(
            BIKE_CONTACTS[id][contact][axis] * 1.12,
            12,
          );
      expect(POSES[id].wrist[1] - POSES[id].grip[1]).toBeCloseTo(0.015, 12);
      expect(POSES[id].wrist[2] - POSES[id].grip[2]).toBeCloseTo(0.02, 12);
      expect(POSES[id].ankle[1] - POSES[id].peg[1]).toBeCloseTo(0.105, 12);
      expect(POSES[id].ankle[2] - POSES[id].peg[2]).toBeCloseTo(0.055, 12);
    },
  );

  it('seats the scooter rider at full adult scale with feet on the floorboard', () => {
    expect(BIKE_MODEL_SCALES.scooter).toBe(1);
    expect(RIDER_TARGETS.scooter).toEqual({
      hip: [0, 0.87, 0.25],
      grip: [0.31, 1.12, -0.4],
      peg: [0.2, 0.3, -0.13],
      torsoLean: 0.25,
    });
    expect(POSES.scooter.ankle[1] - POSES.scooter.peg[1]).toBeCloseTo(
      0.105,
      12,
    );
    expect(POSES.scooter.wrist[1] - POSES.scooter.grip[1]).toBeCloseTo(
      0.015,
      12,
    );
    expect(POSES.scooter.torsoLean).toBeLessThan(POSES['450'].torsoLean);
  });
});

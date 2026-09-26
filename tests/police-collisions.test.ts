import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine } from '../app/game/engine';
import {
  firstPoliceHit,
  policeImpactOffset,
  policeRampPose,
} from '../app/game/policePursuit';
import { TRAFFIC_SHAPES, TOW_RAMP } from '../app/game/trafficDomain';

function engine() {
  return new Engine(BIKES[2], 531);
}

describe('police physical traffic contacts', () => {
  it('checks the entire lateral movement rather than only the destination lane', () => {
    const run = engine();
    const car = run.spawn('car', 0, -12)!;
    const hit = firstPoliceHit(run.obstacles, -2.8, -12, 2.8, -12);
    expect(hit?.obstacle).toBe(car);
    expect(hit?.fraction).toBeGreaterThan(0);
    expect(hit?.fraction).toBeLessThan(0.5);
  });

  it('catches high-speed movement at the first bumper, independent of pool order', () => {
    const run = engine();
    run.spawn('van', 0, 20);
    const nearest = run.spawn('car', 0, -20)!;
    const hit = firstPoliceHit(run.obstacles, 0, -60, 0, 60);
    expect(hit?.obstacle).toBe(nearest);
    const impactZ = -60 + 120 * hit!.fraction;
    expect(impactZ).toBeLessThan(nearest.z - TRAFFIC_SHAPES.car.length);
    expect(impactZ).toBeGreaterThan(
      nearest.z - TRAFFIC_SHAPES.car.length - 0.1,
    );
  });

  it('allows a clear path and ignores inactive slots and nonsolid road surfaces', () => {
    const run = engine();
    run.spawn('car', 1, 0);
    run.spawn('wet', 0, 0);
    run.spawn('pothole', 0, 0);
    const expired = run.spawn('van', 0, -10)!;
    expired.active = false;
    expect(firstPoliceHit(run.obstacles, 0, -40, 0, 30)).toBeNull();
  });

  it('permits the chosen crash target without making other blocking vehicles permeable', () => {
    const run = engine();
    const target = run.spawn('towtruck', 0, 0)!;
    const blocker = run.spawn('car', 0, -15)!;
    const hit = firstPoliceHit(run.obstacles, 0, -40, 0, 0, target);
    expect(hit?.obstacle).toBe(blocker);
  });

  it('keeps the ordinary crash pose outside the target bumper', () => {
    const run = engine();
    for (const kind of ['car', 'van', 'construction'] as const) {
      const target = run.spawn(kind, 0, 0)!;
      const policeNose = policeImpactOffset(target) - TRAFFIC_SHAPES.car.frontZ;
      expect(policeNose).toBeLessThan(-TRAFFIC_SHAPES[kind].rearZ);
      expect(policeNose).toBeGreaterThan(-TRAFFIC_SHAPES[kind].rearZ - 0.04);
    }
  });

  it('raises both axles progressively when driving onto a trailer ramp', () => {
    const below = policeRampPose(TOW_RAMP.rearZ + 2);
    const onRamp = policeRampPose(4.8);
    expect(below.y).toBe(0);
    expect(below.pitch).toBe(0);
    expect(onRamp.y).toBeGreaterThan(0.1);
    expect(onRamp.y).toBeLessThan(TOW_RAMP.frontHeight);
    expect(onRamp.pitch).toBeGreaterThan(0);
    expect(onRamp.pitch).toBeLessThan(0.5);
  });
});

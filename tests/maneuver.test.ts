import { describe, expect, it } from 'vitest';
import { Engine, STEP } from '../app/game/engine';
import { BIKES } from '../app/domain/config';
const ride = () => {
  const e = new Engine(BIKES[0]);
  e.start();
  return e;
};
const steps = (e: Engine, n: number) => {
  for (let i = 0; i < n; i++) e.advance(STEP);
};
describe('motorcycle road-edge handling', () => {
  it('keeps manual lift grounded and limits repeated commands until recovery', () => {
    const e = ride();
    e.lift();
    steps(e, 10);
    const remaining = e.liftTime;
    e.lift();
    expect(e.liftTime).toBe(remaining);
    e.pause();
    steps(e, 20);
    expect(e.liftTime).toBe(remaining);
    e.resume();
    steps(e, 25);
    expect(e.liftTime).toBe(0);
    e.lift();
    expect(e.liftTime).toBe(0);
    steps(e, 20);
    e.lift();
    expect(e.liftTime).toBe(0.5);
    expect([e.height, e.velocityY, e.jumps]).toEqual([0, 0, 0]);
  });
  it('requires a timely lift or wheelie, and awards a cleared road edge once', () => {
    const crashed = ride();
    crashed.spawn('barrier', 0, 0);
    steps(crashed, 1);
    expect(crashed.phase).toBe('crashed');
    for (const held of [false, true]) {
      const e = ride();
      if (held) e.hold(true);
      else e.lift();
      const edge = e.spawn('barrier', 0, 0)!;
      steps(e, 1);
      expect(edge.cleared).toBe(true);
      e.hold(false);
      e.liftTime = 0;
      steps(e, 10);
      expect(e.phase).toBe('playing');
      expect(edge.passed).toBe(true);
      expect(e.event.text).toBe('CLEAN LIFT');
      const serial = e.event.serial;
      steps(e, 30);
      expect(e.event.serial).toBe(serial);
      edge.active = false;
      const reused = e.spawn('barrier', 0, 0)!;
      expect(reused.cleared).toBe(false);
      steps(e, 1);
      expect(e.phase).toBe('crashed');
    }
  });
  it('derives modest flight from a ramp, cannot relaunch in air, and lands once', () => {
    const e = ride();
    e.spawn('ramp', 0, 0.1);
    steps(e, 1);
    expect(e.velocityY).toBeCloseTo(e.speed * 0.22);
    expect(e.jumps).toBe(1);
    e.spawn('ramp', 0, 0.1);
    steps(e, 1);
    expect(e.jumps).toBe(1);
    let peak = 0;
    for (let i = 0; i < 80; i++) {
      e.advance(STEP);
      peak = Math.max(peak, e.height);
    }
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThan(0.8);
    expect(e.height).toBe(0);
    expect(e.landingSerial).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { Engine, STEP } from '../app/game/engine';
import { BIKES } from '../app/domain/config';
import { BALANCE, wheelieScoreFactor } from '../app/game/wheelie';
const ride = (bike = BIKES[0]) => {
  const e = new Engine(bike);
  e.start();
  return e;
};
const steps = (e: Engine, n: number) => {
  for (let i = 0; i < n; i++) e.advance(STEP);
};

describe('controlled rearward wheelie scoring', () => {
  for (const [bike, profile] of Object.entries(BALANCE)) {
    it(`${bike}: farther rearward angles earn more at comparable angular velocity`, () => {
      for (const wheelieAngularVelocity of [0, 0.2, -0.2, 0.6]) {
        let previous = 0;
        for (const wheelieAngle of [
          0.13,
          0.3,
          profile.balancePoint,
          profile.balancePoint + 0.14,
          profile.crashAngle - 0.01,
        ]) {
          const factor = wheelieScoreFactor(
            { wheelieAngle, wheelieAngularVelocity },
            profile,
          );
          expect(factor).toBeGreaterThan(previous);
          expect(factor).toBeLessThanOrEqual(3);
          previous = factor;
        }
      }
    });
    it(`${bike}: rapid uncontrolled rotation cannot outscore a controlled lift`, () => {
      const controlled = wheelieScoreFactor(
        { wheelieAngle: profile.balancePoint, wheelieAngularVelocity: 0.1 },
        profile,
      );
      for (const wheelieAngularVelocity of [1.1, -1.1, 1.2, -1.2, 3]) {
        const uncontrolled = wheelieScoreFactor(
          { wheelieAngle: profile.crashAngle - 0.001, wheelieAngularVelocity },
          profile,
        );
        expect(uncontrolled).toBeLessThan(controlled);
        if (Math.abs(wheelieAngularVelocity) >= 1.2)
          expect(uncontrolled).toBe(0);
      }
    });
    it(`${bike}: scoring remains finite and bounded for invalid or out-of-range inputs`, () => {
      for (const invalid of [NaN, Infinity, -Infinity]) {
        expect(
          wheelieScoreFactor(
            { wheelieAngle: invalid, wheelieAngularVelocity: 0 },
            profile,
          ),
        ).toBe(0);
        expect(
          wheelieScoreFactor(
            { wheelieAngle: 0.6, wheelieAngularVelocity: invalid },
            profile,
          ),
        ).toBe(0);
        expect(
          wheelieScoreFactor(
            { wheelieAngle: 0.6, wheelieAngularVelocity: 0 },
            { ...profile, crashAngle: invalid },
          ),
        ).toBe(0);
      }
      for (const wheelieAngle of [-5, 0, 0.12]) {
        expect(
          wheelieScoreFactor(
            { wheelieAngle, wheelieAngularVelocity: 0 },
            profile,
          ),
        ).toBe(0);
      }
      expect(
        wheelieScoreFactor(
          { wheelieAngle: 5, wheelieAngularVelocity: 0 },
          profile,
        ),
      ).toBe(3);
      expect(
        wheelieScoreFactor(
          { wheelieAngle: 0.6, wheelieAngularVelocity: 0 },
          { ...profile, crashAngle: 0.12 },
        ),
      ).toBe(0);
    });
  }
});

describe('motorcycle weight and road-edge handling', () => {
  for (const bike of BIKES) {
    it(
      bike.name +
        ': initial tug is stronger, continuous and identical for touch and keyboard',
      () => {
        const keyboard = ride(bike),
          touch = ride(bike);
        keyboard.hold(true);
        touch.weight(1);
        let previous = 0;
        for (let i = 0; i < 21; i++) {
          keyboard.advance(STEP);
          touch.advance(STEP);
          expect(keyboard.wheelieAngle - previous).toBeLessThan(0.04);
          expect(touch.wheelieAngle).toBe(keyboard.wheelieAngle);
          previous = keyboard.wheelieAngle;
        }
        expect(keyboard.wheelieAngle).toBeGreaterThan(0.04);
        expect(keyboard.wheelieAngle).toBeLessThan(0.35);
        expect(keyboard.liftPull).toBeLessThan(0.1);
        const pulse = keyboard.liftPull;
        keyboard.hold(false);
        keyboard.advance(STEP);
        keyboard.hold(true);
        keyboard.advance(STEP);
        expect(keyboard.liftPull).toBeLessThan(pulse);
      },
    );
    it(
      bike.name +
        ': forward weight never launches; holding throttle overrotates',
      () => {
        const e = ride(bike);
        e.forward(true);
        steps(e, 60);
        expect([e.height, e.velocityY, e.wheelieAngle, e.jumps]).toEqual([
          0, 0, 0, 0,
        ]);
        e.forward(false);
        e.hold(true);
        steps(e, 300);
        expect(e.phase).toBe('crashed');
        expect(e.stats().cause).toBe('Overrotated the wheelie');
      },
    );
    it(
      bike.name +
        ': active correction catches the rise and returns to both wheels',
      () => {
        const e = ride(bike);
        e.hold(true);
        for (let i = 0; i < 240 && e.wheelieAngle < 0.65; i++) e.advance(STEP);
        expect(e.wheelieAngle).toBeGreaterThan(0.6);
        const rising = e.wheelieAngularVelocity;
        e.hold(false);
        e.forward(true);
        steps(e, 20);
        expect(e.wheelieAngularVelocity).toBeLessThan(rising);
        steps(e, 90);
        expect(e.phase).toBe('playing');
        expect(e.wheelieAngle).toBe(0);
        expect(e.height).toBe(0);
        expect(e.landingSerial).toBe(1);
      },
    );
    it(
      bike.name +
        ': balanced inputs sustain a technical wheelie and earn skill',
      () => {
        const e = ride(bike);
        let corrections = 0,
          transitions = 0,
          peak = 0;
        for (let i = 0; i < 900; i++) {
          // Anticipate momentum through inputs, never set simulation state.
          const error = e.balanceProfile.balancePoint - e.wheelieAngle;
          const demand = error * 5 - e.wheelieAngularVelocity * 3;
          if (i % 6 === 0) {
            if (e.wheelieHeld !== demand > 0.08) transitions++;
            e.hold(demand > 0.08);
            e.forward(demand < -0.12);
          }
          if (e.forwardHeld) corrections++;
          e.advance(STEP);
          peak = Math.max(peak, e.wheelieAngle);
          for (const o of e.obstacles) o.active = false;
        }
        expect(e.phase).toBe('playing');
        expect(peak).toBeLessThan(e.balanceProfile.crashAngle);
        expect(e.balancedSeconds).toBeGreaterThan(4);
        expect(e.bestCombo).toBeGreaterThan(1);
        expect(corrections).toBeGreaterThan(0);
        expect(transitions).toBeGreaterThan(10);
      },
    );
  }
  it('has distinct lift response: tuned moped < single < sport', () => {
    const angles = BIKES.map((bike) => {
      const e = ride(bike);
      e.hold(true);
      steps(e, 45);
      return e.wheelieAngle;
    });
    expect(angles[0]).toBeGreaterThan(0);
    expect(angles[1]).toBeGreaterThan(angles[0] * 1.5);
    expect(angles[2]).toBeGreaterThan(angles[1] * 1.5);
  });
  it('freezes angle and velocity on pause and clears both inputs', () => {
    const e = ride();
    e.hold(true);
    steps(e, 60);
    e.forward(true);
    e.pause();
    const before = [e.wheelieAngle, e.wheelieAngularVelocity, e.throttleLoad];
    steps(e, 100);
    expect([e.wheelieAngle, e.wheelieAngularVelocity, e.throttleLoad]).toEqual(
      before,
    );
    expect([e.wheelieHeld, e.forwardHeld]).toEqual([false, false]);
  });
  it('touch meters each direction without replacing a held keyboard input, and pause clears it', () => {
    const e = ride();
    e.weight(0.5);
    expect([e.throttleInput, e.forwardInput]).toEqual([0.5, 0]);
    e.hold(true);
    e.weight(-0.4);
    expect([e.throttleInput, e.forwardInput]).toEqual([1, 0.4]);
    e.weight(0);
    expect(e.throttleInput).toBe(1);
    e.weight(-1);
    e.pause();
    expect([e.throttleInput, e.forwardInput, e.touchWeight]).toEqual([0, 0, 0]);
    e.weight(1);
    e.resume();
    expect(e.touchWeight).toBe(0);
  });
  it('requires actual front clearance and settles a road-edge skill once', () => {
    const crashed = ride();
    crashed.hold(true);
    crashed.spawn('barrier', 0, 0);
    steps(crashed, 1);
    expect(crashed.phase).toBe('crashed');
    const e = ride();
    e.hold(true);
    while (e.wheelieAngle < 0.25) e.advance(STEP);
    const edge = e.spawn('barrier', 0, 0)!;
    steps(e, 1);
    expect(edge.cleared).toBe(true);
    e.hold(false);
    e.forward(true);
    steps(e, 15);
    expect(e.phase).toBe('playing');
    expect(edge.passed).toBe(true);
    expect(e.event.text).toBe('CLEAN LIFT');
    const serial = e.event.serial;
    steps(e, 30);
    expect(e.event.serial).toBe(serial);
  });
});

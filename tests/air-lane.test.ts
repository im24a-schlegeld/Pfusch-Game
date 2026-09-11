import { describe, it, expect } from 'vitest';
import { Engine, STEP, LANE } from '../app/game/engine';
import { BIKES } from '../app/domain/config';
describe('one accepted lane change per flight', () => {
  for (const bike of BIKES)
    it(`resets only on landing (${bike.name})`, () => {
      const e = new Engine(bike);
      e.start();
      e.move(-1);
      e.move(1);
      expect(e.lane).toBe(0);
      // External physical flight fixture; there is no player launch action.
      e.height = 0.3;
      e.velocityY = 2;
      e.advance(STEP);
      e.move(1);
      expect(e.lane).toBe(1);
      expect(e.airLaneChangeUsed).toBe(true);
      e.move(-1);
      expect(e.lane).toBe(1);
      e.pause();
      e.resume();
      e.move(-1);
      expect(e.lane).toBe(1);
      e.forward(true);
      e.hold(true);
      e.advance(STEP);
      expect(e.airLaneChangeUsed).toBe(true);
      expect(e.height).toBeGreaterThan(0);
      e.height = 0.04;
      e.velocityY = -2;
      e.move(-1);
      expect(e.lane).toBe(1);
      for (let i = 0; i < 10; i++) e.advance(STEP);
      expect(e.height).toBe(0);
      expect(e.airLaneChangeUsed).toBe(false);
      e.move(-1);
      expect(e.lane).toBe(0);
      e.move(-1);
      expect(e.lane).toBe(-1);
    });
  it('does not spend the airborne allowance on a road-edge input', () => {
    const e = new Engine(BIKES[0]);
    e.start();
    e.move(-1);
    e.x = -LANE;
    e.height = 0.3;
    e.velocityY = 2;
    e.advance(STEP);
    e.move(-1);
    expect(e.airLaneChangeUsed).toBe(false);
    e.move(1);
    expect(e.lane).toBe(0);
    expect(e.airLaneChangeUsed).toBe(true);
  });
});

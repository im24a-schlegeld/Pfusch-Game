import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, LANE, STEP, STUNT_POINTS } from '../app/game/engine';
import { TRAFFIC_SHAPES } from '../app/game/trafficDomain';

describe('closer traffic passes', () => {
  it.each(BIKES)('$name rewards a narrow pass but leaves wider safe passes unscored', (bike) => {
    for (const gap of [0.24, 0.26, 0.55]) {
      const engine = new Engine(bike, 918);
      engine.start();
      const car = engine.spawn('car', 1, 0.4, TRAFFIC_SHAPES.car.contactHalfWidth + gap - LANE)!;
      for (let n = 0; n < 30; n++) engine.advance(STEP);
      expect(engine.phase).toBe('playing');
      expect(car.passed).toBe(true);
      expect(engine.nearMisses).toBe(gap < 0.25 ? 1 : 0);
      expect(engine.score).toBeCloseTo(engine.distance * 0.12 + (gap < 0.25 ? STUNT_POINTS.nearMiss : 0), 6);
      for (let n = 0; n < 30; n++) engine.advance(STEP);
      expect(engine.nearMisses).toBe(gap < 0.25 ? 1 : 0);
    }
  });

  it('still crashes when the rider enters the car contact area', () => {
    const engine = new Engine(BIKES[0], 918);
    engine.start();
    engine.spawn('car', 1, 0.4, TRAFFIC_SHAPES.car.contactHalfWidth - 0.01 - LANE);
    engine.advance(STEP);
    expect(engine.phase).toBe('crashed');
    expect(engine.nearMisses).toBe(0);
  });
});

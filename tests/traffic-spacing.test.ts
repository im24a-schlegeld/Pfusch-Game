import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, STEP } from '../app/game/engine';
import { TRAFFIC_SHAPES } from '../app/game/trafficDomain';
import { trafficSeparatedUntilPass } from '../app/game/trafficFlow';

describe('ordinary traffic separation', () => {
  it('rejects a later stationary car that would converge beside moving traffic ahead of the rider', () => {
    expect(trafficSeparatedUntilPass(90, 16, 0, 4.25, 3.9, 4)).toBe(false);
    expect(trafficSeparatedUntilPass(90, 16, 0, 4.25, 3.9, 2)).toBe(true);
    expect(trafficSeparatedUntilPass(130, 10, 10, 4.25, 3.9, 20)).toBe(true);
    expect(trafficSeparatedUntilPass(140, 10, 16, 4.25, 3.9, 20)).toBe(false);
  });

  it.each(BIKES)('$name never develops an ordinary side-by-side pair in long generated runs', (bike) => {
    let waves = 0;
    let towPairs = 0;
    let moving = 0;
    let stationary = 0;
    for (const seed of [47, 1741, 8191]) {
      const engine = new Engine(bike, seed);
      engine.start();
      for (let frame = 0; frame < 18000; frame++) {
        // Observe the complete natural traffic lifecycle without making the
        // rider collide or deleting obstacles before later speed convergence.
        engine.x = 100;
        engine.advance(STEP);
        const wave = engine.obstacles.filter((o) => o.active && o.z === 145);
        if (wave.length) {
          waves++;
          expect(wave.length).toBeLessThanOrEqual(2);
          if (wave.length === 2) {
            expect(wave.map((o) => o.kind).sort()).toEqual(['car', 'towtruck']);
            expect(new Set(wave.map((o) => o.lane)).size).toBe(2);
            towPairs++;
          }
          for (const obstacle of wave) {
            if (obstacle.kind === 'car' || obstacle.kind === 'van') {
              if (obstacle.velocity > 0) moving++;
              else stationary++;
            }
            if (obstacle.kind === 'ramp') {
              expect(engine.world.at(engine.distance + obstacle.z)?.kind).toBe('construction');
              expect(obstacle.velocity).toBe(0);
              expect(wave).toHaveLength(1);
            }
          }
        }
        const ordinary = engine.obstacles.filter((o) => o.active && o.z >= -18 &&
          (o.kind === 'car' || o.kind === 'van'));
        for (let a = 0; a < ordinary.length; a++) {
          for (let b = a + 1; b < ordinary.length; b++) {
            const first = ordinary[a];
            const second = ordinary[b];
            const firstLength = TRAFFIC_SHAPES[first.kind as 'car' | 'van'].length;
            const secondLength = TRAFFIC_SHAPES[second.kind as 'car' | 'van'].length;
            if (Math.abs(first.z - second.z) <= (firstLength + secondLength) / 2)
              throw new Error(`Ordinary traffic overlap: bike=${bike.id}; seed=${seed}; frame=${frame}`);
          }
        }
      }
      expect(engine.phase).toBe('playing');
      expect(engine.obstacles).toHaveLength(32);
    }
    expect(waves).toBeGreaterThan(150);
    expect(towPairs).toBeGreaterThan(0);
    expect(moving).toBeGreaterThan(0);
    expect(stationary).toBeGreaterThan(0);
  }, 30000);
});

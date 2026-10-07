import { describe, expect, it } from 'vitest';
import { createRenderCadence } from '../app/game/renderCadence';
import { Engine } from '../app/game/engine';
import { BIKES } from '../app/domain/config';

function display(rate: number) {
  const cadence = createRenderCadence();
  const engine = new Engine(BIKES[0], 42); engine.start();
  let prior = 0, frames = 0, elapsed = 0;
  for (let sample = 0; sample <= rate * 5; sample++) {
    const now = sample * 1000 / rate;
    if (!cadence.accept(now, true)) continue;
    const dt = (now - prior) / 1000; prior = now; elapsed += dt; frames++;
    engine.obstacles.forEach(obstacle => { obstacle.active = false; });
    engine.advance(dt);
  }
  return { frames, elapsed, distance: engine.distance, elapsedSimulation: engine.elapsed };
}
describe('bounded render cadence', () => {
  it('removes redundant high-refresh visual passes while preserving fixed-step progress', () => {
    const baseline = display(60);
    for (const rate of [120, 144, 240]) {
      const measured = display(rate);
      expect(measured.frames).toBe(baseline.frames);
      expect(measured.elapsed).toBeCloseTo(5, 10);
      expect(measured.distance).toBeCloseTo(baseline.distance, 8);
      expect(measured.elapsedSimulation).toBeCloseTo(baseline.elapsedSimulation, 8);
    }
    console.info(JSON.stringify({ fiveSecondVisualPasses: { uncapped144Hz: 721, capped: baseline.frames } }));
  });
  it('keeps native and slower displays responsive, including normal callback jitter', () => {
    const cadence = createRenderCadence();
    for (let i = 0; i < 120; i++) expect(cadence.accept(i * 1000 / 60 + (i % 2 ? .2 : 0), true)).toBe(true);
    const slow = createRenderCadence();
    for (let i = 0; i < 120; i++) expect(slow.accept(i * 1000 / 30, true)).toBe(true);
  });
  it('draws a paused/idle invalidation immediately and resumes without a backlog', () => {
    const cadence = createRenderCadence();
    expect(cadence.accept(0, true)).toBe(true);
    expect(cadence.accept(4, true)).toBe(false);
    expect(cadence.accept(5, false)).toBe(true);
    expect(cadence.accept(20000, true)).toBe(true);
    expect(cadence.accept(20004, true)).toBe(false);
    expect(cadence.accept(20022, true)).toBe(true);
  });
});

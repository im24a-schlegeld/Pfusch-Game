import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, STEP, STUNT_POINTS } from '../app/game/engine';
import { CONSTRUCTION_RAMP, constructionRampHeight } from '../app/game/constructionRamp';

function ride(index = 0) { const e = new Engine(BIKES[index], 539); e.start(); return e; }
function frame(e: Engine, keep: ReturnType<Engine['spawn']>) {
  // Isolate this ramp from generated waves recycling its pooled fixture slot.
  Reflect.set(e, 'spawnIn', 1000);
  for (const o of e.obstacles) if (o !== keep) o.active = false;
  e.advance(STEP);
}
describe('optional construction jump within the road', () => {
  it.each(BIKES.map((bike, index) => ({ ...bike, index })))('$name climbs, clears the gap and rewards its landing once', ({ index }) => {
    const e = ride(index), ramp = e.spawn('ramp', 0, 24)!;
    let peak = 0;
    for (let n = 0; n < 160; n++) { frame(e, ramp); peak = Math.max(peak, e.height); }
    expect(e.phase).toBe('playing');
    expect(ramp.rampUsed).toBe(true);
    expect(e.launchSerial).toBe(1);
    expect(peak).toBeGreaterThan(CONSTRUCTION_RAMP.height);
    expect(peak).toBeLessThan(2);
    expect(e.height).toBe(0);
    expect(e.jumps).toBe(1);
    expect(e.score).toBeCloseTo(e.distance * 0.12 + STUNT_POINTS.jump, 6);
    for (let n = 0; n < 60; n++) frame(e, ramp);
    expect(e.jumps).toBe(1);
  });
  it('leaves a safe normal lane with no forced jump or bonus', () => {
    const e = ride(), ramp = e.spawn('ramp', 1, 24)!;
    for (let n = 0; n < 160; n++) frame(e, ramp);
    expect(e.phase).toBe('playing'); expect(e.height).toBe(0);
    expect(e.jumps).toBe(0); expect(e.launchSerial).toBe(0);
  });
  it('a grounded late lane change into the open gap crashes rather than awarding a jump', () => {
    const e = ride(), ramp = e.spawn('ramp', 0, -1)!;
    ramp.rampUsed = true;
    frame(e, ramp);
    expect(e.phase).toBe('crashed'); expect(e.event.text).toBe('Baustellenlücke verfehlt');
    expect(e.jumps).toBe(0);
  });
  it('pauses an airborne jump and gives identical outcomes for different frame groupings', () => {
    const e = ride(), ramp = e.spawn('ramp', 0, 12)!;
    for (let n = 0; n < 120 && !e.constructionJumpActive; n++) frame(e, ramp);
    expect(e.constructionJumpActive).toBe(true);
    e.pause(); const snapshot = [e.height, e.velocityY, e.distance, ramp.z, e.score];
    for (let n = 0; n < 60; n++) frame(e, ramp);
    expect([e.height, e.velocityY, e.distance, ramp.z, e.score]).toEqual(snapshot);
    const a = ride(), b = ride(); a.spawn('ramp', 0, 24); b.spawn('ramp', 0, 24);
    for (let n = 0; n < 90; n++) { a.advance(STEP); a.advance(STEP); b.advance(2 * STEP); }
    expect([a.phase, a.height, a.jumps, a.score, a.distance]).toEqual([b.phase, b.height, b.jumps, b.score, b.distance]);
    expect(constructionRampHeight(CONSTRUCTION_RAMP.entryZ)).toBe(0);
    expect(constructionRampHeight(CONSTRUCTION_RAMP.lipZ)).toBe(CONSTRUCTION_RAMP.height);
  });
});

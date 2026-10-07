import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, STEP } from '../app/game/engine';

describe('deliberate tutorial continuation', () => {
  it('freezes the simulation and resumes immediately without held inputs or catch-up time', () => {
    const engine = new Engine(BIKES[2], 42);
    engine.start(); engine.advance(STEP / 2);
    engine.hold(true); engine.forward(true); engine.weight(.8);
    engine.pause();
    const frozen = JSON.stringify(engine);
    for (let i = 0; i < 120; i++) engine.advance(.1);
    expect(JSON.stringify(engine)).toBe(frozen);
    engine.resumeTutorial();
    expect(engine.phase).toBe('playing');
    expect(engine.resumeRemaining).toBe(0);
    expect([engine.wheelieHeld, engine.forwardHeld, engine.touchWeight]).toEqual([false, false, 0]);
    expect(engine.distance).toBe(0);
    engine.advance(STEP / 2); expect(engine.elapsed).toBe(0);
    engine.advance(STEP / 2); expect(engine.elapsed).toBeCloseTo(STEP);
  });
  it('preserves the ordinary three-second resume countdown', () => {
    const engine = new Engine(BIKES[2], 42); engine.start(); engine.pause(); engine.resume();
    expect(engine.phase).toBe('paused'); expect(engine.resumeRemaining).toBe(3);
    for (let i = 0; i < 29; i++) engine.advance(.1);
    expect(engine.phase).toBe('paused'); expect(engine.distance).toBe(0);
    engine.advance(.1);
    expect(engine.phase).toBe('playing'); expect(engine.distance).toBe(0);
    engine.advance(STEP); expect(engine.distance).toBeGreaterThan(0);
  });
  it('does not start a ready run or revive a crashed run', () => {
    const engine = new Engine(BIKES[2], 42);
    engine.resumeTutorial(); expect(engine.phase).toBe('ready');
    engine.start(); engine.crash(); engine.resumeTutorial();
    expect(engine.phase).toBe('crashed');
  });
});

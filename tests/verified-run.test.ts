import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, STEP } from '../app/game/engine';
import { MAX_VERIFIED_EVENTS, MAX_VERIFIED_TICKS, VerifiedRunRecorder, replayVerifiedRun } from '../app/game/verifiedRun';

describe('verified fixed-step run evidence', () => {
  it.each(BIKES)('replays $id with fractional frames, pause clearing and immediate tutorial resume', bike => {
    const engine = new Engine(bike, 78123);
    const recorder = new VerifiedRunRecorder(engine);
    engine.start();
    for (let frame = 0; frame < 900 && engine.phase === 'playing'; frame++) {
      if (frame === 12) engine.hold(true);
      if (frame === 35) engine.hold(false);
      if (frame === 60) engine.weight(.18);
      if (frame === 90) { engine.pause(); engine.advance(4); engine.resumeTutorial(); }
      if (frame === 160) engine.move(1);
      if (frame === 200) engine.move(-1);
      if (frame === 300) engine.forward(true);
      if (frame === 330) { engine.pause(); engine.resume(); for (let i = 0; i < 31; i++) engine.advance(.1); }
      engine.advance(frame % 2 ? STEP * 1.5 : STEP / 2);
    }
    engine.endRide();
    const proof = recorder.proof();
    expect(proof).not.toBeNull();
    expect(replayVerifiedRun(bike.id, 78123, proof)).toEqual({ score: engine.stats().score, ticks: engine.fixedTicks, crashed: true });
  });
  it('replays natural crash and its automatic input clearing', () => {
    const engine = new Engine(BIKES[0], 42), recorder = new VerifiedRunRecorder(engine);
    engine.start(); engine.hold(true);
    while (engine.phase === 'playing' && engine.fixedTicks < 4000) engine.advance(STEP);
    expect(engine.phase).toBe('crashed');
    expect(replayVerifiedRun(BIKES[0].id, 42, recorder.proof())).toEqual({ score: engine.stats().score, ticks: engine.fixedTicks, crashed: true });
  });
  it('rejects malformed, excessive and score-farming commands', () => {
    const replay = (proof: unknown) => replayVerifiedRun(BIKES[0].id, 42, proof);
    expect(replay({ ticks: MAX_VERIFIED_TICKS + 1, events: [] })).toBeNull();
    expect(replay({ ticks: 10, events: Array(MAX_VERIFIED_EVENTS + 1).fill({ tick: 0, input: { type: 'clear' } }) })).toBeNull();
    expect(replay({ ticks: 10, events: [{ tick: 2, input: { type: 'weight', value: Infinity } }] })).toBeNull();
    expect(replay({ ticks: 10, events: [{ tick: 2, input: { type: 'skill', value: 10000 } }] })).toBeNull();
    expect(replay({ ticks: 10, events: [{ tick: 0, input: { type: 'move', value: 1 } }, { tick: 1, input: { type: 'move', value: -1 } }] })).toBeNull();
    expect(replay({ ticks: 10, events: [{ tick: 0, input: { type: 'end' } }] })).toBeNull();
    expect(replay({ ticks: 10, events: [{ tick: 11, input: { type: 'clear' } }] })).toBeNull();
    expect(replay({ ticks: 10, events: [], score: 999999 })).toBeNull();
  });
  it('bounds recorder memory and declines proof after input overflow', () => {
    const engine = new Engine(BIKES[0], 42), recorder = new VerifiedRunRecorder(engine);
    engine.start();
    for (let i = 0; i <= MAX_VERIFIED_EVENTS; i++) engine.weight(i % 2 ? .2 : .3);
    expect(recorder.proof()).toBeNull();
    expect(engine.phase).toBe('playing');
  });
});

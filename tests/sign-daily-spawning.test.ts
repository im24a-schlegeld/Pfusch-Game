import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { newPlayer } from '../app/domain/progression';
import { dailySignMask, recordDailySign } from '../app/domain/dailySigns';
import { Engine, STEP } from '../app/game/engine';
import { SIGN_IDS } from '../app/game/signCollectibles';
import { VerifiedRunRecorder, replayVerifiedRun } from '../app/game/verifiedRun';

describe('saved daily sign eligibility', () => {
  it('excludes a saved H for every starting sequence and makes it eligible on the next UTC day', () => {
    const player = recordDailySign(newPlayer(), 'old-ride:1', 'H', '2026-10-13');
    const mask = dailySignMask(player.challenges, '2026-10-13');
    expect(mask).toBe(32);
    for (let seed = 0; seed < SIGN_IDS.length; seed++) {
      const engine = new Engine(BIKES[0], seed);
      engine.excludeSigns(mask);
      engine.start();
      engine.distance = 320;
      engine.score = 900;
      for (let frame = 0; frame < 120 && !engine.signs.some(sign => sign.active); frame++) engine.advance(STEP);
      const sign = engine.signs.find(sign => sign.active);
      expect(sign).toBeDefined();
      expect(sign?.id).not.toBe('H');
      expect(engine.spawnSign('H', 0, 0)).toBeUndefined();
    }
    const tomorrow = new Engine(BIKES[0], 5);
    tomorrow.excludeSigns(dailySignMask(player.challenges, '2026-10-14'));
    expect(tomorrow.spawnSign('H', 0, 0)).toBeDefined();
  });

  it('spawns the last missing letter at the first run milestone and stops after completion', () => {
    const engine = new Engine(BIKES[0], 192);
    engine.excludeSigns(31);
    engine.start();
    engine.distance = 320;
    engine.score = 900;
    for (let frame = 0; frame < 120 && !engine.signs.some(sign => sign.active); frame++) engine.advance(STEP);
    const sign = engine.signs.find(sign => sign.active)!;
    expect(sign.id).toBe('H');
    sign.lane = engine.lane;
    sign.z = 0;
    engine.advance(STEP);
    expect(engine.signPickupSerial).toBe(1);
    expect(engine.signSetCount).toBe(1);
    engine.score = 20_000;
    for (let frame = 0; frame < 6000; frame++) {
      for (const obstacle of engine.obstacles) obstacle.active = false;
      engine.advance(STEP);
      expect(engine.signs.some(pickup => pickup.active)).toBe(false);
    }
    expect(engine.phase).toBe('playing');
    expect(engine.signPickupSerial).toBe(1);
  });

  it('removes an excluded active sign without awarding points and cannot reopen it', () => {
    const engine = new Engine(BIKES[0], 192);
    const sign = engine.spawnSign('H', 0, 0)!;
    engine.excludeSigns(32);
    expect(sign.active).toBe(false);
    expect(engine.score).toBe(0);
    expect(engine.collectedSigns).toBe(0);
    expect(engine.signPickupSerial).toBe(0);
    for (const value of [0, -1, 64, 1.5, NaN, Infinity]) engine.excludeSigns(value);
    expect(engine.spawnSign('H', 0, 0)).toBeUndefined();
    expect(engine.spawnSign('P', 0, 0)).toBeDefined();
  });

  it('does not repeat a full set later in the same ride', () => {
    const engine = new Engine(BIKES[0], 192);
    engine.start();
    for (const id of SIGN_IDS) engine.spawnSign(id, 0, 0);
    engine.advance(STEP);
    engine.score = 20_000;
    for (let frame = 0; frame < 6000; frame++) {
      for (const obstacle of engine.obstacles) obstacle.active = false;
      engine.advance(STEP);
      expect(engine.signs.some(sign => sign.active)).toBe(false);
    }
    expect(engine.phase).toBe('playing');
    expect(engine.collectedSigns).toBe(63);
    expect(engine.signPickupSerial).toBe(6);
  });

  it('replays exclusions and rejects invalid masks without accepting saved letters as points', () => {
    const engine = new Engine(BIKES[0], 42), recorder = new VerifiedRunRecorder(engine);
    engine.excludeSigns(32);
    expect(engine.score).toBe(0);
    engine.start();
    for (let frame = 0; frame < 900 && engine.phase === 'playing'; frame++) {
      if (frame === 60) engine.excludeSigns(33);
      if (frame === 120) engine.excludeSigns(0);
      engine.advance(STEP);
    }
    engine.endRide();
    const proof = recorder.proof()!;
    expect(proof.events.filter(event => event.input.type === 'excludeSigns')).toEqual([
      { tick: 0, input: { type: 'excludeSigns', value: 32 } },
      { tick: 60, input: { type: 'excludeSigns', value: 33 } },
    ]);
    expect(replayVerifiedRun(BIKES[0].id, 42, proof)).toEqual({ score: engine.stats().score, ticks: engine.fixedTicks, crashed: true });
    for (const value of [-1, 64, 1.5, NaN, Infinity, '32']) {
      expect(replayVerifiedRun(BIKES[0].id, 42, { ticks: 0, events: [{ tick: 0, input: { type: 'excludeSigns', value } }] })).toBeNull();
    }
  });
});

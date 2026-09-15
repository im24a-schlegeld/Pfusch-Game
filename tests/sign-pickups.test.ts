import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { finishRun, newPlayer } from '../app/domain/progression';
import { Engine, STEP } from '../app/game/engine';
import { SIGN_IDS } from '../app/game/signCollectibles';

const ride = () => {
  const engine = new Engine(BIKES[0], 192);
  engine.start();
  return engine;
};

describe('PFUSCH road sign pickups', () => {
  it('collects the six distinct signs once each, rewards the complete set and starts a new set', () => {
    const engine = ride();
    let expectedMask = 0;
    for (const [index, id] of SIGN_IDS.entries()) {
      const pickup = engine.spawnSign(id, 0, 0)!;
      engine.advance(STEP);
      expect(pickup.active).toBe(false);
      expect(engine.lastSignId).toBe(id);
      expect(engine.signPickupSerial).toBe(index + 1);
      expectedMask |= 1 << index;
      expect(engine.collectedSigns).toBe(index === 5 ? 0 : expectedMask);
      const serial = engine.signPickupSerial;
      engine.advance(STEP);
      expect(engine.signPickupSerial).toBe(serial);
    }
    expect(engine.signSetCount).toBe(1);
    expect(engine.event.text).toBe('PFUSCH SET COMPLETE');
    expect(engine.score).toBeGreaterThan(3000);
    engine.spawnSign('P', 0, 0);
    engine.advance(STEP);
    expect(engine.collectedSigns).toBe(1);
    expect(engine.signSetCount).toBe(1);
    const settled = finishRun(newPlayer(), engine.stats())!;
    expect(settled.player.highScore).toBe(Math.floor(engine.score));
    expect(finishRun(settled.player, engine.stats())).toBeNull();
    expect(settled.player.version).toBe(1);
  });

  it('never counts duplicates as missing letters or collects signs from another lane', () => {
    const engine = ride();
    for (let index = 0; index < 8; index++) {
      engine.spawnSign('P', 0, 0);
      engine.advance(STEP);
    }
    expect(engine.collectedSigns).toBe(1);
    expect(engine.signSetCount).toBe(0);
    engine.spawnSign('F', 1, 0);
    for (let frame = 0; frame < 60; frame++) engine.advance(STEP);
    expect(engine.collectedSigns).toBe(1);
  });

  it('keeps the pool bounded, freezes it on pause, expires missed signs and resets with the run', () => {
    const engine = ride();
    for (let index = 0; index < 8; index++)
      expect(engine.spawnSign('P', 1, 1)).toBeDefined();
    expect(engine.spawnSign('F', 0, 1)).toBeUndefined();
    const refs = [...engine.signs];
    engine.pause();
    engine.advance(1);
    expect(engine.signs.every((sign) => sign.z === 1 && sign.active)).toBe(
      true,
    );
    engine.resume();
    for (let frame = 0; frame < 60; frame++) engine.advance(STEP);
    expect(engine.signs.every((sign) => !sign.active)).toBe(true);
    expect(engine.signs).toEqual(refs);
    expect(engine.signs).toHaveLength(8);
    expect(engine.spawnSign('H', 0, 0)).toBe(refs[0]);
    const fresh = ride();
    expect([
      fresh.collectedSigns,
      fresh.signSetCount,
      fresh.signPickupSerial,
    ]).toEqual([0, 0, 0]);
  });

  it('does not collect or reward an obstacle collision on the same fixed step', () => {
    const engine = ride();
    engine.spawnSign('H', 0, 0);
    engine.spawn('construction', 0, 0);
    engine.advance(STEP);
    expect(engine.phase).toBe('crashed');
    expect(engine.collectedSigns).toBe(0);
    expect(engine.signPickupSerial).toBe(0);
    expect(engine.event.text).toBe('Construction barrier collision');
  });

  it('keeps collection and traffic deterministic across rendering frame rates', () => {
    const results = [30, 60, 120].map((fps) => {
      const engine = ride();
      for (const [index, id] of SIGN_IDS.entries())
        engine.spawnSign(id, 0, 4 + index * 7);
      for (let frame = 0; frame < fps * 3; frame++) engine.advance(1 / fps);
      return [
        engine.distance,
        engine.score,
        engine.signs,
        engine.collectedSigns,
        engine.signSetCount,
        engine.signPickupSerial,
        engine.obstacles,
      ];
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });
});

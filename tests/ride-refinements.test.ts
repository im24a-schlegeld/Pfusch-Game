import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, LANE, STEP, STUNT_POINTS } from '../app/game/engine';
import { speedAtTime } from '../app/game/world';
import { TOW_TRANSFER } from '../app/game/towTransfer';
import { advanceBalance, BALANCE } from '../app/game/wheelie';

describe('readable traffic, early jumps and tipping-point recovery', () => {
  it.each(BIKES)(
    '$name queues an early ramp swipe and clears the adjacent car with one clean arc',
    (bike) => {
      for (const offset of [-0.6, 0, 0.6]) {
        const engine = new Engine(bike, 907);
        engine.elapsed = 25;
        engine.start();
        const velocity = speedAtTime(engine.elapsed, bike) - 12;
        const tow = engine.spawn('towtruck', 0, 14, 0, velocity)!;
        const car = engine.spawn('car', 1, 14 + offset, 0, velocity)!;
        while (!engine.onTowTruck && engine.phase === 'playing')
          engine.advance(STEP);
        expect(engine.height).toBeLessThan(TOW_TRANSFER.minimumTakeoffHeight);
        engine.move(1);
        expect(engine.onTowTruck).toBe(true);
        expect(engine.launchSerial).toBe(0);
        let airtime = 0,
          peak = 0,
          previousX = engine.x,
          takeoff = 0;
        for (
          let frame = 0;
          frame < 150 && engine.phase === 'playing';
          frame++
        ) {
          const wasCarried = engine.onTowTruck;
          engine.advance(STEP);
          if (wasCarried && !engine.onTowTruck) takeoff = tow.z;
          if (engine.towJumpActive) {
            peak = Math.max(peak, engine.height);
            airtime += STEP;
            expect(engine.x).toBeGreaterThanOrEqual(previousX - 1e-8);
            previousX = engine.x;
          }
          if (engine.jumps > 0 && car.passed) break;
        }
        expect(
          engine.phase,
          `${bike.id} offset=${offset}, takeoff=${takeoff}, carZ=${car.z}, height=${engine.height}`,
        ).toBe('playing');
        expect(engine.jumps).toBe(1);
        expect(engine.height).toBe(0);
        expect(engine.x).toBeCloseTo(LANE, 3);
        expect(airtime).toBeLessThan(0.89);
        expect(peak).toBeLessThan(2.32);
        expect(car.cleared && car.passed).toBe(true);
        expect(
          engine.scoreGains.find((gain) => gain.text === 'AUTO ÜBERSPRUNGEN')
            ?.points,
        ).toBe(STUNT_POINTS.carJump);
      }
    },
  );

  it.each(BIKES)(
    '$name awards one last-moment lane-change close call only after a safe pass',
    (bike) => {
      const engine = new Engine(bike);
      engine.start();
      const obstacle = engine.spawn('car', 0, 14)!;
      engine.move(1);
      for (let i = 0; i < 70; i++) engine.advance(STEP);
      expect(engine.phase).toBe('playing');
      expect(obstacle.passed).toBe(true);
      expect(engine.nearMisses).toBe(1);
      const score = engine.score;
      for (let i = 0; i < 10; i++) engine.advance(STEP);
      expect(engine.nearMisses).toBe(1);
      expect(engine.score - score).toBeLessThan(STUNT_POINTS.nearMiss);
      const early = new Engine(bike);
      early.start();
      early.spawn('car', 0, 45);
      early.move(1);
      for (let i = 0; i < 130; i++) early.advance(STEP);
      expect(early.nearMisses).toBe(0);
    },
  );

  it.each(Object.entries(BALANCE))(
    '%s drops the released front wheel promptly before the tipping point',
    (_id, profile) => {
      const state = {
        wheelieAngle: profile.balancePoint - 0.2,
        wheelieAngularVelocity: 0,
        throttleLoad: 0,
        forwardLoad: 0,
        liftPull: 0,
        liftArmed: false,
      };
      let landed = 0;
      for (let i = 0; i < 60; i++) {
        if (advanceBalance(state, profile, 22, 0, 0, STEP) > 0) landed++;
        if (i === 41) expect(state.wheelieAngle).toBeLessThan(0.07);
      }
      expect(state.wheelieAngle).toBe(0);
      expect(landed).toBe(1);
    },
  );

  it('requires regular adjacent lane changes and keeps a bounded reachable traffic route', () => {
    const engine = new Engine(BIKES[2], 743);
    engine.start();
    let lastSpawn = -Infinity;
    const waveLanes: number[][] = [];
    for (let frame = 0; frame < 7200; frame++) {
      engine.x = 100; // Observe generation without changing collision rules.
      engine.advance(STEP);
      const wave = engine.obstacles.filter(
        (obstacle) => obstacle.active && obstacle.z === 145,
      );
      if (wave.length && engine.distance - lastSpawn > 5) {
        waveLanes.push(wave.map((obstacle) => obstacle.lane));
        lastSpawn = engine.distance;
        expect(wave.length).toBeLessThanOrEqual(2);
        const recent = waveLanes.slice(-4).flat();
        if (waveLanes.length >= 4)
          for (const lane of [-1, 0, 1]) expect(recent).toContain(lane);
      }
    }
    expect(waveLanes.length).toBeGreaterThan(65);
    expect(engine.obstacles).toHaveLength(32);
  });
});

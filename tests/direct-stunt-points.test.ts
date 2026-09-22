import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { finishRun, newPlayer } from '../app/domain/progression';
import { Engine, STEP, STUNT_POINTS } from '../app/game/engine';
import { speedAtTime } from '../app/game/world';

function ride(index = 2) {
  const engine = new Engine(BIKES[index], 841);
  engine.start();
  return engine;
}
function steps(engine: Engine, frames: number) {
  for (let i = 0; i < frames; i++) engine.advance(STEP);
}

describe('direct stunt points without a combo multiplier', () => {
  it('shows each integer score change exactly once across continuous riding, wheelie and scrape gains', () => {
    const engine = ride();
    engine.wheelieAngle = engine.balanceProfile.crashAngle - 0.12;
    const shown = new Map<number, number>();
    let displayed = 0;
    for (let frame = 0; frame < 300; frame++) {
      if (frame === 1) engine.forward(true);
      engine.advance(STEP);
      for (const gain of engine.scoreGains) {
        displayed += gain.points - (shown.get(gain.serial) ?? 0);
        shown.set(gain.serial, gain.points);
        expect(Number.isInteger(gain.points) && gain.points > 0).toBe(true);
      }
      expect(displayed).toBe(Math.floor(engine.score));
      expect(engine.scoreGains.length).toBeLessThanOrEqual(10);
      for (const obstacle of engine.obstacles) obstacle.active = false;
    }
    expect(engine.phase).toBe('playing');
    expect(shown.size).toBeGreaterThan(2);
    engine.skill('SPRUNG GELANDET', STUNT_POINTS.jump);
    engine.skill('SPRUNG GELANDET', STUNT_POINTS.jump);
    const gains = engine.scoreGains.filter(
      (gain) => gain.text === 'SPRUNG GELANDET',
    );
    expect(gains.map((gain) => gain.points)).toEqual([350, 350]);
    expect(engine.score - displayed).toBeCloseTo(700 + (engine.score % 1), 8);
  });

  it('awards risky wheelies and scrapes immediately without waiting for a chain', () => {
    const engine = ride();
    engine.wheelieAngle = engine.balanceProfile.crashAngle - 0.12;
    steps(engine, 6);
    expect(
      engine.scoreGains.find((gain) => gain.text === 'SCRAPE')?.points,
    ).toBeGreaterThan(0);
    expect(
      engine.scoreGains.find((gain) => gain.text === 'RISKY WHEELIE')?.points,
    ).toBeGreaterThan(0);
    expect(engine.scoreGains.reduce((sum, gain) => sum + gain.points, 0)).toBe(
      Math.floor(engine.score),
    );
  });

  it.each([false, true])(
    'rewards one close pass, including an airborne evasion: air=%s',
    (air) => {
      const engine = ride();
      if (air) {
        engine.height = 0.4;
        engine.velocityY = 1;
      }
      engine.spawn('car', 1, 0.4, -1);
      steps(engine, 30);
      expect(engine.phase).toBe('playing');
      expect(engine.nearMisses).toBe(1);
      const reward = air ? STUNT_POINTS.airEvade : STUNT_POINTS.nearMiss;
      expect(
        engine.scoreGains.find((gain) => gain.group === undefined)?.points,
      ).toBe(reward);
      expect(engine.score).toBeCloseTo(engine.distance * 0.12 + reward, 8);
      steps(engine, 30);
      expect(engine.nearMisses).toBe(1);
    },
  );

  it.each(BIKES.map((bike, index) => ({ ...bike, index })))(
    '$name keeps exactly the same lateral arc and speed beside a car, with a larger clear-car bonus',
    ({ index }) => {
      const traces: number[][][] = [];
      const scores: number[] = [];
      for (const withCar of [false, true]) {
        const engine = ride(index);
        engine.elapsed = 25;
        const velocity = speedAtTime(engine.elapsed, engine.bike) - 12;
        const tow = engine.spawn('towtruck', 0, 14, 0, velocity)!;
        const car = withCar ? engine.spawn('car', 1, 14, 0, velocity)! : null;
        for (let frame = 0; frame < 100 && engine.height < 1; frame++)
          engine.advance(STEP);
        expect(engine.onTowTruck).toBe(true);
        expect(engine.phase).toBe('playing');
        engine.move(1);
        const trace: number[][] = [];
        let previousX = 0;
        for (let frame = 0; frame < 90; frame++) {
          engine.advance(STEP);
          expect(engine.phase, engine.event.text).toBe('playing');
          expect(engine.x).toBeGreaterThanOrEqual(previousX);
          previousX = engine.x;
          trace.push([
            engine.x,
            engine.height,
            engine.distance,
            engine.speed,
            engine.wheelieAngle,
          ]);
        }
        expect(engine.jumps).toBe(1);
        expect(engine.height).toBe(0);
        expect(tow.velocity).toBe(velocity);
        if (car) {
          expect(car.passed && car.cleared).toBe(true);
          expect(
            engine.scoreGains.find((gain) => gain.text === 'AUTO ÜBERSPRUNGEN')
              ?.points,
          ).toBe(STUNT_POINTS.carJump);
        }
        traces.push(trace);
        scores.push(engine.score);
      }
      expect(traces[0]).toEqual(traces[1]);
      expect(scores[1] - scores[0]).toBeCloseTo(STUNT_POINTS.carJump, 8);
    },
  );

  it('ignores legacy bestCombo when settling coins, XP and challenge progress', () => {
    const engine = ride();
    steps(engine, 60);
    const stats = engine.stats();
    const normal = finishRun(newPlayer(), { ...stats, bestCombo: 1 })!;
    const legacy = finishRun(newPlayer(), { ...stats, bestCombo: 5 })!;
    expect(legacy.reward.coins).toBe(normal.reward.coins);
    expect(legacy.reward.xp).toBe(normal.reward.xp);
    expect(legacy.player.challenges).toEqual(normal.player.challenges);
  });
});

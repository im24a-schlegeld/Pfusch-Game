import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, LANE, STEP, STUNT_POINTS } from '../app/game/engine';
import { RAMP_FRONT_CONTACT, TRAFFIC_SHAPES } from '../app/game/trafficDomain';
import { carJumpClearance } from '../app/game/carClearance';
import { TRAFFIC_PROGRESSION, trafficYaw } from '../app/game/trafficProgression';
import { TAIL_RECOVERY_ANGLE } from '../app/game/tailContact';

function observe(score: number, seed = 8191) {
  const engine = new Engine(BIKES[3], seed);
  engine.score = score;
  // Leave natural traffic alive through its entire lifecycle, without rider
  // collisions truncating the test or despawning cars prematurely.
  engine.lane = 100;
  engine.x = engine.lane * LANE;
  engine.start();
  return engine;
}

describe('score-based traffic progression', () => {
  it.each([0, 50_000, 100_000])('preserves a reachable lane and separated traffic at %i points', score => {
    const engine = observe(score);
    const changing = new Set<number>(), oncoming = new Set<number>();
    for (let tick = 0; tick < 14_400; tick++) {
      engine.advance(STEP);
      const ordinary = engine.obstacles.filter(o => o.active && (o.kind === 'car' || o.kind === 'van'));
      for (const car of ordinary) {
        if (car.laneShift) {
          changing.add(car.spawnId);
          expect(car.kind).toBe('car');
          expect(car.police).toBe(false);
          expect(car.velocity).toBeGreaterThan(0);
          expect(car.laneShift.from).toBe(0);
          expect(Math.abs(car.laneShift.to)).toBe(1);
          const clearEdge = -car.laneShift.to * LANE;
          expect(Math.abs(clearEdge - (car.lane * LANE + car.offsetX)))
            .toBeGreaterThan(TRAFFIC_SHAPES.car.contactHalfWidth);
          if (car.offsetX !== 0) {
            // The manoeuvre is visible before contact, never a last-second cut.
            expect(car.z / (engine.speed - car.velocity)).toBeGreaterThan(1.2);
            expect(Math.abs(trafficYaw(car.velocity, car.laneShift))).toBeLessThanOrEqual(.055);
          }
        }
        if (car.velocity < 0) {
          oncoming.add(car.spawnId);
          expect(car.kind).toBe('car');
          expect(car.police).toBe(false);
          expect(car.laneShift).toBeNull();
          expect(trafficYaw(car.velocity, car.laneShift)).toBe(Math.PI);
        }
      }
      for (let a = 0; a < ordinary.length; a++)
        for (let b = a + 1; b < ordinary.length; b++) {
          const first = ordinary[a], second = ordinary[b];
          const length = TRAFFIC_SHAPES[first.kind as 'car' | 'van'].length +
            TRAFFIC_SHAPES[second.kind as 'car' | 'van'].length;
          expect(Math.abs(first.z - second.z)).toBeGreaterThan(length / 2);
        }
    }
    expect(engine.phase).toBe('playing');
    expect(engine.obstacles).toHaveLength(32);
    if (score >= 50_000) expect(changing.size).toBeGreaterThan(0);
    else expect(changing.size).toBe(0);
    if (score >= 100_000) expect(oncoming.size).toBeGreaterThan(0);
    else expect(oncoming.size).toBe(0);
  });

  it('replays high-score traffic identically with different render frame sizes', () => {
    const first = observe(100_000), second = observe(100_000);
    for (let frame = 0; frame < 1800; frame++) {
      first.advance(STEP);
      first.advance(STEP);
      second.advance(STEP * 2);
    }
    expect(first.fixedTicks).toBe(second.fixedTicks);
    expect(first.obstacles).toEqual(second.obstacles);
    expect(first.score).toBe(second.score);
    expect(first.signs).toEqual(second.signs);
  });

  it.each(BIKES)('$name retains swept head-on collision and safe adjacent passage', bike => {
    const hit = new Engine(bike, 31), miss = new Engine(bike, 31);
    hit.start(); miss.start();
    const incoming = hit.spawn('car', 0, 25, 0, -TRAFFIC_PROGRESSION.oncomingSpeed)!;
    miss.spawn('car', 1, 25, 0, -TRAFFIC_PROGRESSION.oncomingSpeed);
    for (let frame = 0; frame < 75; frame++) {
      hit.advance(STEP); miss.advance(STEP);
    }
    expect(hit.phase).toBe('crashed');
    expect(hit.crashObstacle).toBe(incoming);
    expect(miss.phase).toBe('playing');
  });

  it.each(BIKES)('$name tests jump clearance against the rotated oncoming roof', bike => {
    const frontOverRoof = -.4 - RAMP_FRONT_CONTACT[bike.id].axle;
    expect(carJumpClearance(bike.id, 2.03, 0, frontOverRoof, 0, false, true)).toBeGreaterThan(.045);
    expect(carJumpClearance(bike.id, 1.83, 0, frontOverRoof, 0, false, true)).toBeLessThan(-.05);
  });

  it('fully resets incoming and lane-change state when recycling a pool slot', () => {
    const engine = observe(100_000);
    const car = engine.spawn('car', 0, 145, 0, -14)!;
    car.laneShift = { from: 0, to: 1, age: .5 };
    car.active = false;
    const tow = engine.spawn('towtruck', -1, 145, 0, 10)!;
    expect(tow).toBe(car);
    expect(tow.laneShift).toBeNull();
    expect(tow.velocity).toBe(10);
    expect(trafficYaw(tow.velocity, tow.laneShift)).toBe(0);
  });

  it('doubles the continuous scrape reward immediately while preserving score accounting', () => {
    const engine = new Engine(BIKES[2], 841);
    engine.start();
    engine.wheelieAngle = engine.balanceProfile.crashAngle - TAIL_RECOVERY_ANGLE / 2;
    engine.advance(STEP);
    expect(STUNT_POINTS.scrapePerMeter).toBe(24);
    expect(engine.scrapeIntensity).toBeGreaterThan(0);
    const previousRate = engine.distance * 12 * engine.scrapeIntensity;
    expect(engine.scoreGains.find(gain => gain.group === 'scrape')!.points)
      .toBeGreaterThan(Math.floor(previousRate));
    expect(engine.scoreGains.reduce((sum, gain) => sum + gain.points, 0)).toBe(Math.floor(engine.score));
  });
});

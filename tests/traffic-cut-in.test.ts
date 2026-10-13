import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, LANE, STEP } from '../app/game/engine';
import { TRAFFIC_FLOW, trafficArrivalGap, trafficSpawnRetry, trafficWaveSpacing } from '../app/game/trafficFlow';
import { TRAFFIC_PROGRESSION, trafficCutInTarget, trafficIntensity } from '../app/game/trafficProgression';

function cutIn(bike = BIKES[3], from = 0, to = 1, z = 55) {
  const engine = new Engine(bike, 42);
  engine.score = 50_000;
  engine.lane = to;
  engine.x = to * LANE;
  engine.start();
  const car = engine.spawn('car', from, z, 0, 6)!;
  car.laneShift = { from, to: from === 0 ? -to : 0, age: -STEP, committed: false };
  return { engine, car };
}

function scheduledCutIn(bike = BIKES[3]) {
  const engine = new Engine(bike, 8191);
  engine.score = 50_000;
  engine.lane = 100;
  engine.x = engine.lane * LANE;
  engine.start();
  for (let tick = 0; tick < 3600; tick++) {
    engine.advance(STEP);
    const car = engine.obstacles.find(obstacle => obstacle.active && obstacle.laneShift?.committed === false);
    if (!car) continue;
    // Isolate the actual scheduled manoeuvre from earlier natural waves.
    for (const obstacle of engine.obstacles) if (obstacle !== car) obstacle.active = false;
    engine.lane = car.lane === 0 ? 1 : 0;
    engine.x = engine.lane * LANE;
    return { engine, car };
  }
  throw new Error('No planned cut-in in the deterministic 50k route.');
}

describe('readable traffic cut-ins', () => {
  it.each(BIKES)('$name keeps a scheduled car in its lane until close, then warns before moving', bike => {
    const { engine, car } = scheduledCutIn(bike);
    expect(car.laneShift?.age).toBeLessThan(-1);
    const from = car.lane;
    let pendingTicks = 0;
    while (car.laneShift?.committed === false && pendingTicks < 600) {
      expect(car.lane).toBe(from);
      expect(Math.abs(car.offsetX)).toBe(0);
      engine.advance(STEP);
      pendingTicks++;
    }
    expect(pendingTicks).toBeGreaterThan(60);
    expect(car.laneShift).toMatchObject({ from, to: engine.lane, committed: true, age: 0 });
    // Literal contact horizon: the old 3.5-second trigger is visibly too early.
    expect(car.z / (engine.speed - car.velocity)).toBeLessThan(2.55);
    expect(engine.event).toMatchObject({ kind: 'warning', text: 'AUTO WECHSELT DIE SPUR' });
    for (let tick = 0; tick < 12; tick++) {
      engine.advance(STEP);
      expect(Math.abs(car.offsetX)).toBe(0);
    }
    for (let tick = 0; tick < 12; tick++) engine.advance(STEP);
    expect(Math.abs(car.offsetX)).toBeGreaterThan(0);
    expect(engine.phase).toBe('playing');
  });

  it.each(BIKES)('$name can escape the later scheduled cut-in after a real reaction and one swipe', bike => {
    const dodge = scheduledCutIn(bike), stay = scheduledCutIn(bike);
    for (let tick = 0; dodge.car.laneShift?.committed === false && tick < 600; tick++) {
      dodge.engine.advance(STEP); stay.engine.advance(STEP);
    }
    expect(dodge.car.laneShift?.committed).toBe(true);
    const from = dodge.car.lane, target = dodge.car.laneShift!.to;
    const changingSpawn = dodge.car.spawnId;
    for (let tick = 0; tick < Math.ceil(TRAFFIC_FLOW.reactionSeconds / STEP); tick++) {
      dodge.engine.advance(STEP); stay.engine.advance(STEP);
    }
    dodge.engine.move(Math.sign(from - dodge.engine.lane));
    expect(dodge.car.laneShift?.to).toBe(target);
    let largestStep = 0, closestWhileMoving = Infinity;
    let previous = dodge.car.lane * LANE + dodge.car.offsetX;
    for (let tick = 0; tick < 210; tick++) {
      dodge.engine.advance(STEP); stay.engine.advance(STEP);
      if (!dodge.car.active || dodge.car.spawnId !== changingSpawn) continue;
      const current = dodge.car.lane * LANE + dodge.car.offsetX;
      largestStep = Math.max(largestStep, Math.abs(current - previous));
      previous = current;
      if (dodge.car.laneShift && Math.abs(dodge.car.offsetX) > 0)
        closestWhileMoving = Math.min(closestWhileMoving,
          dodge.car.z / (dodge.engine.speed - dodge.car.velocity));
    }
    expect(largestStep).toBeLessThan(0.08);
    expect(closestWhileMoving).toBeGreaterThan(1.2);
    expect(dodge.engine.lane).toBe(from);
    expect(dodge.engine.phase).toBe('playing');
    expect(stay.engine.phase).toBe('crashed');
    expect(stay.engine.crashObstacle).toBe(stay.car);
  });

  it.each(BIKES)('$name can react once to a car entering its formerly clear lane and use the vacated lane', bike => {
    const dodge = cutIn(bike), stay = cutIn(bike);
    dodge.engine.advance(STEP); stay.engine.advance(STEP);
    expect(dodge.car.laneShift).toMatchObject({ from: 0, to: 1, committed: true, age: 0 });
    expect(dodge.car.offsetX).toBe(0);
    expect(dodge.engine.event).toMatchObject({ kind: 'warning', text: 'AUTO WECHSELT DIE SPUR' });
    // A normal reaction delay, then one swipe. The car must not follow this
    // decision into the newly chosen escape lane.
    const reactionTicks = Math.ceil(TRAFFIC_FLOW.reactionSeconds / STEP);
    for (let tick = 0; tick < reactionTicks; tick++) {
      dodge.engine.advance(STEP); stay.engine.advance(STEP);
    }
    dodge.engine.move(-1);
    expect(dodge.car.laneShift?.to).toBe(1);
    let largestStep = 0, previous = dodge.car.lane * LANE + dodge.car.offsetX;
    for (let tick = 0; tick < 210; tick++) {
      dodge.engine.advance(STEP); stay.engine.advance(STEP);
      const current = dodge.car.lane * LANE + dodge.car.offsetX;
      largestStep = Math.max(largestStep, Math.abs(current - previous));
      previous = current;
    }
    expect(largestStep).toBeLessThan(0.08);
    expect(dodge.car.lane).toBe(1);
    expect(dodge.engine.lane).toBe(0);
    expect(dodge.engine.phase).toBe('playing');
    expect(stay.engine.phase).toBe('crashed');
    expect(stay.engine.crashObstacle).toBe(stay.car);
  });

  it('allows an outer car to enter the middle, with an adjacent escape instead of a two-lane snap', () => {
    const { engine, car } = cutIn(BIKES[3], -1, 0);
    engine.advance(STEP);
    expect(car.laneShift).toMatchObject({ from: -1, to: 0, committed: true });
    for (let tick = 0; tick < 30; tick++) engine.advance(STEP);
    engine.move(-1);
    for (let tick = 0; tick < 210; tick++) engine.advance(STEP);
    expect(engine.phase).toBe('playing');
    expect(car.lane).toBe(0);
  });

  it('cancels late, longitudinally obstructed and airborne cut-ins before any lateral motion', () => {
    const late = cutIn(BIKES[3], 0, 1, 20);
    late.engine.advance(STEP);
    expect(late.car.laneShift).toBeNull();
    expect(late.car.offsetX).toBe(0);
    const blocked = cutIn();
    blocked.engine.spawn('van', -1, 57, 0, 6);
    blocked.engine.advance(STEP);
    expect(blocked.car.laneShift).toBeNull();
    expect(blocked.car.offsetX).toBe(0);
    const airborne = cutIn();
    airborne.engine.height = 1;
    airborne.engine.advance(STEP);
    expect(airborne.car.laneShift).toBeNull();
    expect(airborne.car.offsetX).toBe(0);
  });

  it('selects one adjacent target and leaves a lane outside the entire swept width', () => {
    for (const from of [-1, 0, 1]) for (const rider of [-1, 0, 1]) {
      const to = trafficCutInTarget(from, rider, -1);
      expect([-1, 0, 1]).toContain(to);
      expect(Math.abs(to - from)).toBe(1);
      if (Math.abs(rider - from) === 1) expect(to).toBe(rider);
      expect([-1, 0, 1].some(lane => lane !== from && lane !== to)).toBe(true);
    }
  });
});

describe('bounded progressive traffic density', () => {
  it('tightens spawn spacing while retaining two swipes and reaction between contact windows', () => {
    let previousGap = Infinity, previousSpacing = Infinity, previousRetry = Infinity;
    for (const score of [0, 25_000, 50_000, 100_000, 150_000, 200_000, 1_000_000]) {
      const gap = trafficArrivalGap(45, 10, -14, 4, 7, score);
      const contactDurations = 4 / (45 - 10) + 7 / (45 + 14);
      expect(gap - contactDurations).toBeGreaterThanOrEqual(TRAFFIC_FLOW.reactionSeconds + 2 * TRAFFIC_FLOW.laneChangeSeconds - 1e-10);
      expect(gap).toBeLessThanOrEqual(previousGap);
      const spacing = trafficWaveSpacing(68, 36, .7, score);
      expect(spacing).toBeLessThanOrEqual(previousSpacing);
      expect(spacing).toBeGreaterThan(0);
      const retry = trafficSpawnRetry(score);
      expect(retry).toBeGreaterThan(0);
      expect(retry).toBeLessThanOrEqual(previousRetry);
      previousRetry = retry;
      previousGap = gap; previousSpacing = spacing;
    }
    expect(trafficIntensity(-1)).toBe(0);
    expect(trafficIntensity(1_000_000)).toBe(1);
    expect(TRAFFIC_PROGRESSION.laneChangeScore).toBe(50_000);
    expect(TRAFFIC_PROGRESSION.oncomingScore).toBe(100_000);
  });

  it('generates more vehicles later while retaining the same fixed obstacle pool', () => {
    const counts = [0, 0];
    const observations: { seed: number; score: number; vehicles: number }[] = [];
    for (const seed of [47, 1741, 8191]) for (const [index, score] of [0, 200_000].entries()) {
      const engine = new Engine(BIKES[3], seed);
      const seen = new Set<number>();
      engine.start();
      for (let tick = 0; tick < 7200; tick++) {
        engine.score = score;
        engine.x = 100;
        engine.advance(STEP);
        for (const obstacle of engine.obstacles) {
          if (!obstacle.active || seen.has(obstacle.spawnId)) continue;
          seen.add(obstacle.spawnId);
          counts[index]++;
        }
      }
      expect(engine.phase).toBe('playing');
      expect(engine.obstacles).toHaveLength(32);
      observations.push({ seed, score, vehicles: seen.size });
    }
    console.info(JSON.stringify({ trafficDensity: observations, totals: counts }));
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBeGreaterThan(counts[0]);
  });
});

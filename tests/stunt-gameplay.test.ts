import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, LANE, STEP, STUNT_POINTS } from '../app/game/engine';
import { TRAFFIC_SHAPES, TOW_RAMP } from '../app/game/trafficDomain';
import { tailScrape } from '../app/game/wheelie';

function ride(bike = BIKES[0], seed = 539) {
  const engine = new Engine(bike, seed);
  engine.start();
  return engine;
}
function steps(engine: Engine, count: number) {
  for (let step = 0; step < count; step++) engine.advance(STEP);
}
function board(engine: Engine, velocity = 0) {
  const tow = engine.spawn('towtruck', engine.lane, 14, 0, velocity)!;
  for (let frame = 0; frame < 100 && engine.height < 1; frame++)
    engine.advance(STEP);
  expect(engine.phase).toBe('playing');
  expect(engine.onTowTruck).toBe(true);
  expect(engine.launchSerial).toBe(0);
  expect(engine.height).toBeGreaterThan(1);
  expect(engine.velocityY).toBe(0);
  return tow;
}

describe('ride onto the tow truck, then swipe to jump', () => {
  it.each(BIKES)(
    '$name remembers an outward swipe just before the front tire reaches the ramp',
    (bike) => {
      for (const elapsed of [25, 10000])
        for (const velocity of [0, 6])
          for (const direction of [-1, 1]) {
            const engine = ride(bike);
            engine.elapsed = elapsed;
            engine.spawn('towtruck', 0, 10, 0, velocity);
            engine.move(direction);
            steps(engine, 100);
            expect(engine.phase).toBe('playing');
            expect(engine.launchSerial).toBe(1);
            expect(engine.jumps).toBe(1);
            expect(engine.lane).toBe(direction);
            expect(engine.x).toBeCloseTo(direction * LANE, 3);
          }
    },
  );
  it.each(BIKES)(
    '$name boards without input and lands in the chosen adjacent lane',
    (bike) => {
      for (const elapsed of [25, 10000])
        for (const velocity of [0, 6])
          for (const source of [-1, 0, 1]) {
            const directions = source === 0 ? [-1, 1] : [-source];
            for (const direction of directions) {
              const engine = ride(bike);
              engine.elapsed = elapsed;
              engine.lane = source;
              engine.x = source * LANE;
              const tow = board(engine, velocity);
              expect(engine.onTowTruck).toBe(true);
              expect(engine.jumps).toBe(0);
              expect(engine.lane).toBe(source);
              const before = engine.score;
              const departureZ = tow.z;
              const departureDistance = engine.distance;
              engine.move(direction);
              expect(tow.velocity).toBe(velocity);
              expect(engine.onTowTruck).toBe(false);
              expect(engine.launchSerial).toBe(1);
              expect(engine.airLaneChangeUsed).toBe(true);
              engine.move(direction);
              expect(engine.lane).toBe(source + direction);
              steps(engine, 1);
              expect(tow.z).toBeCloseTo(
                departureZ -
                  (engine.distance - departureDistance) +
                  velocity * STEP,
                8,
              );
              steps(engine, 89);
              expect(
                engine.phase,
                `${bike.id}: ${engine.event.text}; x=${engine.x}, y=${engine.height}, tow=${tow.z}; source=${source}, elapsed=${elapsed}, velocity=${velocity}`,
              ).toBe('playing');
              expect(engine.height).toBe(0);
              expect(engine.jumps).toBe(1);
              expect(engine.lane).toBe(source + direction);
              expect(engine.x).toBeCloseTo((source + direction) * LANE, 3);
              expect(engine.score).toBeGreaterThan(before + STUNT_POINTS.jump);
              expect(
                engine.scoreGains.find(
                  (gain) => gain.text === 'SPRUNG GELANDET',
                )?.points,
              ).toBe(STUNT_POINTS.jump);
              expect(tow.velocity).toBe(velocity);
              steps(engine, 15);
              expect(engine.jumps).toBe(1);
            }
          }
    },
  );
  it('can merge onto the rear ramp before swiping again to leave', () => {
    const engine = ride(BIKES[2]);
    engine.elapsed = 25;
    engine.spawn('towtruck', 1, 10, 0, 6)!;
    engine.move(1);
    for (let frame = 0; frame < 60 && engine.height < 1; frame++)
      steps(engine, 1);
    expect(engine.phase).toBe('playing');
    expect(engine.onTowTruck).toBe(true);
    expect(engine.launchSerial).toBe(0);
    engine.move(-1);
    steps(engine, 90);
    expect(engine.phase, engine.event.text).toBe('playing');
    expect(engine.jumps).toBe(1);
    expect(engine.lane).toBe(0);
  });
  it('pauses on the deck and requires a valid side swipe before the cab', () => {
    const engine = ride();
    engine.lane = -1;
    engine.x = -LANE;
    const tow = board(engine, 6);
    engine.move(-1);
    expect(engine.launchSerial).toBe(0);
    engine.pause();
    const snapshot = [engine.height, tow.z, engine.elapsed];
    steps(engine, 120);
    expect([engine.height, tow.z, engine.elapsed]).toEqual(snapshot);
    engine.resume();
    steps(engine, 180);
    steps(engine, 150);
    expect(engine.phase).toBe('crashed');
    expect(engine.jumps).toBe(0);
    expect(engine.launchSerial).toBe(0);
  });
  it('keeps direct cab and ordinary car collisions solid', () => {
    for (const kind of ['towtruck', 'car'] as const) {
      const engine = ride();
      engine.spawn(kind, 0, kind === 'towtruck' ? -2 : 6);
      steps(engine, 25);
      expect(engine.phase).toBe('crashed');
      expect(engine.jumps).toBe(0);
    }
  });
  it('keeps a destination obstacle solid when a side jump lands into it', () => {
    const engine = ride();
    board(engine);
    engine.move(1);
    steps(engine, 12);
    engine.height = 0.01;
    engine.velocityY = -3;
    const obstacle = engine.spawn('construction', 1, 0)!;
    steps(engine, 1);
    expect(engine.phase).toBe('playing');
    expect(engine.jumps).toBe(1);
    steps(engine, 12);
    expect(engine.phase).toBe('crashed');
    expect(engine.event.text).toBe('Construction barrier collision');
    expect(obstacle.cleared).toBe(false);
    expect(engine.jumps).toBe(1);
  });
  it('accepts the last timely swipe but rejects a swipe after the deck deadline', () => {
    const missed = ride(BIKES[2]);
    missed.elapsed = 10000;
    board(missed);
    let deadline = 0;
    while (missed.phase === 'playing' && deadline < 30) {
      steps(missed, 1);
      deadline++;
    }
    expect(missed.phase).toBe('crashed');
    for (const delay of [deadline - 1, deadline]) {
      const engine = ride(BIKES[2]);
      engine.elapsed = 10000;
      board(engine);
      steps(engine, delay);
      engine.move(1);
      steps(engine, 90);
      expect(engine.phase, engine.event.text).toBe(
        delay < deadline ? 'playing' : 'crashed',
      );
      expect(engine.jumps).toBe(delay < deadline ? 1 : 0);
    }
  });
  it('replays boarding and a later swipe identically at 30, 60 and 120 Hz', () => {
    const results = [30, 60, 120].map((fps) => {
      const engine = ride();
      engine.spawn('towtruck', 0, 14, 0, 6);
      for (let frame = 0; frame < fps * 3; frame++) {
        if (frame === fps) engine.move(1);
        engine.advance(1 / fps);
      }
      return [
        engine.phase,
        engine.height,
        engine.x,
        engine.jumps,
        engine.score,
        engine.distance,
      ];
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });
});
describe('stunt scoring and recoverable tail contact', () => {
  for (const bike of BIKES) {
    it(`${bike.name}: technique earns far more than straight-line distance`, () => {
      const ordinary = ride(bike),
        stunt = ride(bike);
      for (let frame = 0; frame < 600; frame++) {
        const demand =
          (stunt.balanceProfile.balancePoint - stunt.wheelieAngle) * 5 -
          stunt.wheelieAngularVelocity * 3;
        if (frame % 6 === 0) {
          stunt.hold(demand > 0.08);
          stunt.forward(demand < -0.12);
        }
        for (const engine of [ordinary, stunt]) {
          steps(engine, 1);
          for (const obstacle of engine.obstacles) obstacle.active = false;
        }
      }
      expect(stunt.phase).toBe('playing');
      expect(ordinary.score / ordinary.distance).toBeCloseTo(0.12, 8);
      expect(stunt.score).toBeGreaterThan(ordinary.score * 20);
    });

    it(`${bike.name}: light tail contact has its material, can be recovered, and does not remove loop-out`, () => {
      const engine = ride(bike);
      engine.wheelieAngle = engine.balanceProfile.crashAngle - 0.12;
      steps(engine, 1);
      expect(engine.phase).toBe('playing');
      expect(engine.scrapeIntensity).toBeGreaterThan(0);
      expect(engine.scrapeMaterial).toBe(
        bike.id === '125' ? 'metal' : 'plastic',
      );
      engine.forward(true);
      steps(engine, 100);
      expect(engine.phase).toBe('playing');
      expect(engine.scrapeMaterial).toBeNull();
      expect(engine.scrapeIntensity).toBe(0);
      const over = ride(bike);
      over.wheelieAngle = over.balanceProfile.crashAngle - 0.001;
      over.wheelieAngularVelocity = 1;
      steps(over, 1);
      expect(over.phase).toBe('crashed');
      expect(over.event.text).toBe('Overrotated the wheelie');
      expect(over.scrapeIntensity).toBe(0);
      expect(
        tailScrape(bike.id, over.balanceProfile.crashAngle, over.balanceProfile)
          .intensity,
      ).toBe(0);
    });
  }

  it('provides a brief grounded steering lead, immediate air steering, and a new onset per real lift', () => {
    const ground = ride(),
      air = ride();
    air.height = 1;
    air.velocityY = 1;
    for (const engine of [ground, air]) {
      engine.move(1);
      steps(engine, 2);
    }
    expect(ground.x).toBe(0);
    expect(air.x).toBeGreaterThan(0.3);
    steps(ground, 25);
    expect(ground.x).toBeGreaterThan(LANE * 0.9);
    ground.hold(true);
    steps(ground, 1);
    expect(ground.wheelieLaunchSerial).toBe(1);
    steps(ground, 25);
    ground.hold(false);
    ground.forward(true);
    steps(ground, 100);
    ground.forward(false);
    steps(ground, 1);
    ground.hold(true);
    steps(ground, 1);
    expect(ground.wheelieLaunchSerial).toBe(2);
  });

  it('uses world-relative traffic speed and upright construction collision dimensions', () => {
    const engine = ride();
    const moving = engine.spawn('car', 1, 40, 0, 8)!;
    const parked = engine.spawn('car', -1, 40)!;
    steps(engine, 60);
    expect(moving.z - parked.z).toBeCloseTo(8, 8);
    const construction = ride();
    construction.wheelieAngle = 0.5;
    construction.spawn('construction', 0, 0, 0, 8);
    steps(construction, 1);
    expect(construction.phase).toBe('crashed');
    expect(construction.event.text).toBe('Construction barrier collision');
    expect(construction.obstacles[0].velocity).toBe(0);
    expect(TRAFFIC_SHAPES.construction.height).toBeGreaterThan(1);
    expect(TOW_RAMP.rearZ).toBeCloseTo(TRAFFIC_SHAPES.towtruck.rearZ);
    expect(TOW_RAMP.rearZ - TOW_RAMP.frontZ).toBeGreaterThan(4.8);
  });
});

describe('progressive traffic without impossible moving-wave overlaps', () => {
  it('increases distance difficulty smoothly while preserving an ordered reachable safe lane', () => {
    let sawMoving = false,
      sawConstruction = false,
      sawTow = false;
    for (const bike of BIKES) {
      const engine = ride(bike, 1741 + BIKES.indexOf(bike));
      const slots = new Map<object, number>();
      let waveSerial = 0,
        previousSpawn = -Infinity;
      let lastArrivalWave = 0,
        lastArrivalTime = -Infinity;
      let pairedWaves = 0;
      const difficulty = [];
      for (let frame = 0; frame < 18000; frame++) {
        // Read the full generator without changing collision rules or deleting traffic.
        // The isolated off-road rider fixture leaves every wave in its natural motion.
        engine.x = 100;
        const oldPositions = engine.obstacles.map((o) => o.z);
        steps(engine, 1);
        expect(engine.phase).toBe('playing');
        const wave = engine.obstacles.filter((o) => o.active && o.z === 145);
        if (wave.length && engine.distance - previousSpawn > 5) {
          waveSerial++;
          for (const obstacle of wave) slots.set(obstacle, waveSerial);
          const safe = [-1, 0, 1].filter((lane) =>
            wave.every(
              (o) =>
                Math.abs(lane * LANE - (o.lane * LANE + o.offsetX)) >
                TRAFFIC_SHAPES[o.kind as keyof typeof TRAFFIC_SHAPES]
                  .contactHalfWidth +
                  0.1,
            ),
          );
          expect(safe.length).toBeGreaterThan(0);
          if (wave.length === 2) pairedWaves++;
          sawMoving ||= wave.some((o) => o.velocity > 0);
          sawConstruction ||= wave.some((o) => o.kind === 'construction');
          sawTow ||= wave.some((o) => o.kind === 'towtruck');
          expect(wave.every((o) => o.velocity === wave[0].velocity)).toBe(true);
          previousSpawn = engine.distance;
        }
        for (const [index, obstacle] of engine.obstacles.entries()) {
          if (!obstacle.active || oldPositions[index] <= 0 || obstacle.z > 0)
            continue;
          const serial = slots.get(obstacle)!;
          if (serial === lastArrivalWave) continue;
          expect(serial).toBeGreaterThan(lastArrivalWave);
          expect(engine.elapsed - lastArrivalTime).toBeGreaterThanOrEqual(
            1.5 - STEP - 1e-8,
          );
          lastArrivalWave = serial;
          lastArrivalTime = engine.elapsed;
        }
        if (frame % 3600 === 0) difficulty.push(engine.difficulty);
      }
      expect(difficulty[1]).toBeGreaterThan(difficulty[0]);
      expect(engine.difficulty).toBe(1);
      expect(pairedWaves / waveSerial).toBeLessThan(0.1);
      expect(engine.obstacles).toHaveLength(32);
    }
    expect([sawMoving, sawConstruction, sawTow]).toEqual([true, true, true]);
  }, 30000);
});

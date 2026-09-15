import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, LANE, STEP } from '../app/game/engine';
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
function takeoff(engine: Engine, velocity = 0, direction = 1) {
  const tow = engine.spawn(
    'towtruck',
    direction,
    velocity ? 5.4 : 6.2,
    0,
    velocity,
  )!;
  engine.move(direction);
  for (let frame = 0; frame < 25 && engine.launchSerial === 0; frame++)
    engine.advance(STEP);
  expect(engine.phase).toBe('playing');
  expect(engine.launchSerial).toBe(1);
  expect(tow.rampUsed).toBe(true);
  expect(engine.height).toBeGreaterThan(0);
  return tow;
}

describe('automatic side ramp transfers', () => {
  it.each([-1, 1])(
    'accepts the complete collision width when entering from side %s',
    (direction) => {
      const engine = ride();
      // A partly settled prior lane change reaches the 2 cm interval between the
      // old ramp trigger and the physical bike/truck collision envelope.
      engine.x = direction * 0.06;
      const tow = engine.spawn('towtruck', direction, 6.2)!;
      engine.move(direction);
      steps(engine, 7);
      expect(Math.abs(engine.x - direction * LANE)).toBeLessThan(
        TRAFFIC_SHAPES.towtruck.contactHalfWidth,
      );
      expect(engine.phase).toBe('playing');
      expect(engine.launchSerial).toBe(1);
      expect(tow.rampUsed).toBe(true);
      engine.move(-direction);
      steps(engine, 100);
      expect(engine.phase).toBe('playing');
      expect(engine.jumps).toBe(1);
    },
  );

  for (const bike of BIKES)
    for (const velocity of [0, 6])
      it(`${bike.name}: ${velocity ? 'moving' : 'parked'} ramp accepts a side transfer and one air correction`, () => {
        const engine = ride(bike);
        const tow = takeoff(engine, velocity);
        expect(engine.airLaneChangeUsed).toBe(false);
        expect(engine.towJumpActive).toBe(true);
        expect(engine.jumps).toBe(0);
        engine.move(-1);
        expect(engine.lane).toBe(0);
        expect(engine.airLaneChangeUsed).toBe(true);
        engine.move(-1);
        expect(engine.lane).toBe(0);
        engine.pause();
        const paused = [
          engine.height,
          engine.velocityY,
          tow.z,
          engine.launchSerial,
        ];
        steps(engine, 60);
        expect([
          engine.height,
          engine.velocityY,
          tow.z,
          engine.launchSerial,
        ]).toEqual(paused);
        engine.resume();
        steps(engine, 100);
        expect(engine.phase).toBe('playing');
        expect(engine.height).toBe(0);
        expect(engine.airLaneChangeUsed).toBe(false);
        expect(engine.towJumpActive).toBe(false);
        expect(engine.jumps).toBe(1);
        expect(engine.event.text).toBe('TOW TRUCK TRANSFER');
        expect(engine.score).toBeGreaterThan(500);
        const serial = engine.event.serial;
        steps(engine, 50);
        expect(engine.jumps).toBe(1);
        expect(engine.event.serial).toBe(serial);
        engine.move(-1);
        engine.move(1);
        expect(engine.lane).toBe(0);
      });

  it('works from the other side but never grants a jump from ordinary forward riding', () => {
    const left = ride();
    takeoff(left, 6, -1);
    left.move(1);
    steps(left, 100);
    expect(left.jumps).toBe(1);
    const straight = ride();
    straight.spawn('towtruck', 0, 6.2);
    steps(straight, 60);
    expect(straight.launchSerial).toBe(0);
    expect(straight.jumps).toBe(0);
    expect(straight.phase).toBe('crashed');
  });

  it('keeps the cab solid and withholds the landing reward after an unsafe transfer', () => {
    const engine = ride();
    takeoff(engine);
    steps(engine, 80);
    expect(engine.phase).toBe('crashed');
    expect(engine.event.text).toBe('Traffic collision');
    expect(engine.jumps).toBe(0);
    expect(engine.towJumpActive).toBe(false);
    expect(engine.score).toBeLessThan(100);
  });

  it('does not use the ramp from the cab side, while already airborne, or during a high wheelie', () => {
    for (const mode of ['cab', 'air', 'wheelie'] as const) {
      const engine = ride();
      engine.spawn('towtruck', 1, mode === 'cab' ? -2 : 6.2);
      if (mode === 'air') {
        engine.height = 3.2;
        engine.velocityY = 2;
      }
      if (mode === 'wheelie') engine.wheelieAngle = 0.6;
      engine.move(1);
      steps(engine, 20);
      expect(engine.launchSerial).toBe(0);
    }
  });

  it('does not reward landing inside another obstacle on the same simulation step', () => {
    const engine = ride();
    takeoff(engine);
    engine.move(-1);
    for (const obstacle of engine.obstacles) obstacle.active = false;
    engine.x = 0;
    engine.height = 0.01;
    engine.velocityY = -3;
    engine.spawn('construction', 0, 0);
    steps(engine, 1);
    expect(engine.phase).toBe('crashed');
    expect(engine.jumps).toBe(0);
  });

  it('replays a moving side transfer identically at 30, 60, and 120 Hz', () => {
    const results = [30, 60, 120].map((fps) => {
      const engine = ride();
      engine.spawn('towtruck', 1, 5.4, 0, 6);
      engine.move(1);
      for (let frame = 0; frame < fps * 2; frame++) {
        if (frame === fps / 5) engine.move(-1);
        engine.advance(1 / fps);
      }
      return [
        engine.distance,
        engine.x,
        engine.score,
        engine.height,
        engine.jumps,
        engine.phase,
        engine.launchSerial,
        engine.obstacles,
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
    expect(TOW_RAMP.rearZ).toBe(TRAFFIC_SHAPES.towtruck.length / 2);
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
      let earlyDoubles = 0,
        lateDoubles = 0;
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
          if (engine.distance < 1000 && wave.length === 2) earlyDoubles++;
          if (engine.distance > 5000 && wave.length === 2) lateDoubles++;
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
          expect(engine.elapsed - lastArrivalTime).toBeGreaterThan(1.5);
          lastArrivalWave = serial;
          lastArrivalTime = engine.elapsed;
        }
        if (frame % 3600 === 0) difficulty.push(engine.difficulty);
      }
      expect(difficulty[1]).toBeGreaterThan(difficulty[0]);
      expect(engine.difficulty).toBe(1);
      expect(lateDoubles).toBeGreaterThan(earlyDoubles);
      expect(engine.obstacles).toHaveLength(32);
    }
    expect([sawMoving, sawConstruction, sawTow]).toEqual([true, true, true]);
  }, 30000);
});

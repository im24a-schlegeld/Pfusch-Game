import { expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, LANE, STEP } from '../app/game/engine';

function ride(bike = BIKES[0]) {
  const engine = new Engine(bike, 539);
  engine.start();
  Reflect.set(engine, 'spawnIn', 1000);
  return engine;
}

it.each(BIKES)('$name enters the tow ramp from the rear and can still jump sideways off it', bike => {
  const engine = ride(bike), truck = engine.spawn('towtruck', 0, 14, 0, 6)!;
  for (let tick = 0; tick < 120 && !engine.onTowTruck; tick++) engine.advance(STEP);
  expect(engine.onTowTruck).toBe(true);
  expect(truck.rampUsed).toBe(true);
  engine.move(1);
  expect(engine.towJumpActive).toBe(true);
  for (let tick = 0; tick < 120; tick++) engine.advance(STEP);
  expect(engine.phase).toBe('playing');
  expect(engine.lane).toBe(1);
  expect(engine.jumps).toBe(1);
});

it.each(['towtruck', 'ramp'] as const)('rejects grounded and landing lateral entry onto a %s', kind => {
  for (const airborne of [false, true]) {
    const engine = ride();
    engine.lane = 1; engine.x = LANE;
    const ramp = engine.spawn(kind, 0, kind === 'towtruck' ? 7.5 : 8, 0, kind === 'towtruck' ? 6 : 0)!;
    if (airborne) { engine.height = 0.15; engine.velocityY = -1; }
    engine.move(-1);
    let boarded = false;
    for (let tick = 0; tick < 90 && engine.phase === 'playing'; tick++) {
      engine.advance(STEP);
      boarded ||= engine.onTowTruck || engine.constructionJumpActive || ramp.rampUsed;
    }
    expect(boarded, `${kind}: airborne=${airborne}`).toBe(false);
    expect(engine.phase).toBe('crashed');
    expect(engine.crashObstacle).toBe(ramp);
    expect(engine.launchSerial).toBe(0);
    expect(engine.jumps).toBe(0);
  }
});

it.each(BIKES)('$name enters the construction ramp from the rear and can change lane during its jump', bike => {
  const engine = ride(bike), ramp = engine.spawn('ramp', 0, 24)!;
  for (let tick = 0; tick < 120 && !engine.constructionJumpActive; tick++) engine.advance(STEP);
  expect(engine.constructionJumpActive).toBe(true);
  expect(ramp.rampUsed).toBe(true);
  engine.move(1);
  for (let tick = 0; tick < 120; tick++) engine.advance(STEP);
  expect(engine.phase).toBe('playing');
  expect(engine.lane).toBe(1);
  expect(engine.jumps).toBe(1);
});

it('preserves real airborne clearance over a construction ramp without admitting side entry', () => {
  const engine = ride(), ramp = engine.spawn('ramp', 0, 6)!;
  engine.lane = 1; engine.x = 1.4;
  engine.height = 3; engine.velocityY = 2;
  engine.move(-1);
  for (let tick = 0; tick < 90; tick++) engine.advance(STEP);
  expect(engine.phase).toBe('playing');
  expect(ramp.rampUsed).toBe(false);
  expect(engine.launchSerial).toBe(0);
});

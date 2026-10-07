import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, STEP } from '../app/game/engine';
import { carContactPitch, carFrontReach, carJumpClearance, carRearReach, carSurfaceHeight } from '../app/game/carClearance';
import { speedAtTime } from '../app/game/world';
import { TOW_TRANSFER } from '../app/game/towTransfer';
import { RAMP_FRONT_CONTACT, RAMP_REAR_CONTACT, TRAFFIC_SHAPES } from '../app/game/trafficDomain';
import { TAIL_CONTACT } from '../app/game/tailContact';

function firstRampTransfer(bike = BIKES.find(item => item.id === '450')!, side = 1, paired = true) {
  const engine = new Engine(bike, 907);
  engine.elapsed = 25; engine.start();
  const velocity = speedAtTime(engine.elapsed, bike) - 12;
  const truck = engine.spawn('towtruck', 0, 14, 0, velocity)!;
  const car = paired ? engine.spawn('car', side, 14, 0, velocity)! : undefined;
  for (let frame = 0; frame < 120 && !engine.onTowTruck; frame++) engine.advance(STEP);
  expect(engine.onTowTruck).toBe(true);
  const launchHeight = engine.height, launchZ = truck.z;
  engine.move(side);
  return { engine, truck, car, launchHeight, launchZ, velocity };
}

describe('tight car clearance without changing the jump', () => {
  it.each(BIKES)('$name keeps the first-ramp side transfer playable beside its paired car', bike => {
    for (const side of [-1, 1]) {
      const { engine, car: adjacent, launchHeight, launchZ, velocity } = firstRampTransfer(bike, side);
      const car = adjacent!;
      const reference = firstRampTransfer(bike, side, false).engine;
      let landedAlongside = false;
      for (let frame = 0; frame < 110 && engine.phase === 'playing'; frame++) {
        engine.advance(STEP); reference.advance(STEP);
        expect(engine.height).toBe(reference.height);
        expect(engine.velocityY).toBe(reference.velocityY);
        landedAlongside ||= engine.jumps === 1 && !car.passed;
      }
      expect(engine.phase, `${bike.id}: launchHeight=${launchHeight}, launchZ=${launchZ}, velocity=${velocity}, impactHeight=${engine.height}, carZ=${car.z}, x=${engine.x}`).toBe('playing');
      expect(engine.jumps).toBe(1);
      expect(landedAlongside).toBe(true);
      expect(car.passed).toBe(true);
    }
  });
  it('retains rear-bumper collisions before entering alongside a paired car', () => {
    const { engine, car } = firstRampTransfer();
    for (let frame = 0; frame < 18; frame++) engine.advance(STEP);
    expect(engine.towJumpActive).toBe(true);
    expect(car!.z).toBeGreaterThan(TRAFFIC_SHAPES.car.rearZ);
    // A low tire arriving at the rear bumper has not entered the car's side.
    engine.height = .05; engine.velocityY = 0;
    for (let frame = 0; frame < 12 && engine.phase === 'playing'; frame++) engine.advance(STEP);
    expect(engine.phase).toBe('crashed');
    expect(engine.crashObstacle).toBe(car);
    expect(car!.z).toBeGreaterThan(TRAFFIC_SHAPES.car.rearZ);
  });
  it('retains ordinary side impacts and does not grant grace to cars introduced after launch', () => {
    const { engine, truck, velocity } = firstRampTransfer(undefined, 1, false);
    const unrelated = engine.spawn('car', 1, truck.z, 0, velocity)!;
    for (let frame = 0; frame < 70 && engine.phase === 'playing'; frame++) engine.advance(STEP);
    expect(engine.phase).toBe('crashed'); expect(engine.crashObstacle).toBe(unrelated);
    const ordinary = new Engine(engine.bike, 907); ordinary.start();
    const beside = ordinary.spawn('car', 1, 0, 0, speedAtTime(0, engine.bike))!;
    ordinary.move(1);
    for (let frame = 0; frame < 60 && ordinary.phase === 'playing'; frame++) ordinary.advance(STEP);
    expect(ordinary.phase).toBe('crashed'); expect(ordinary.crashObstacle).toBe(beside);
  });
  it('expires contact grace when the car pool slot is reused', () => {
    const { engine, car } = firstRampTransfer();
    for (let frame = 0; frame < 39; frame++) engine.advance(STEP);
    expect(engine.phase).toBe('playing'); expect(engine.towJumpActive).toBe(true);
    const priorId = car!.spawnId;
    car!.active = false;
    const reused = engine.spawn('car', 1, 3.5, 0, engine.speed)!;
    expect(reused).toBe(car); expect(reused.spawnId).not.toBe(priorId);
    engine.height = .05; engine.velocityY = 0;
    engine.advance(STEP);
    expect(engine.phase).toBe('crashed'); expect(engine.crashObstacle).toBe(reused);
  });
  it('uses the hood, boot and roof actually shown instead of a full-height box', () => {
    expect(carSurfaceHeight(0, -2.5)).toBeLessThan(1);
    expect(carSurfaceHeight(0, 2.5)).toBeLessThan(1.1);
    expect(carSurfaceHeight(0, 0.66)).toBe(1.98);
    expect(carSurfaceHeight(0, 0.08, true)).toBe(2.06);
    expect(carSurfaceHeight(1.5, 0)).toBe(0);
  });
  it.each(BIKES)('$name accepts narrow visible wheel clearance and rejects tire penetration', bike => {
    const frontOverRoof = .4 - RAMP_FRONT_CONTACT[bike.id].axle;
    expect(carJumpClearance(bike.id, 2.03, 0, frontOverRoof, 0)).toBeGreaterThan(.045);
    expect(carJumpClearance(bike.id, 1.83, 0, frontOverRoof, 0)).toBeLessThan(-.05);
    expect(carJumpClearance(bike.id, 1.3, 0, 3.8, 0)).toBeGreaterThan(0);
  });
  it.each(BIKES)('$name uses the displayed pitch throughout the recoverable tail-contact range', bike => {
    const displayed = TAIL_CONTACT[bike.id].angle;
    const recoverable = displayed + .06;
    expect(carContactPitch(bike.id, recoverable, .2)).toBe(displayed);
    expect(carContactPitch(bike.id, .2, .4)).toBe(.4);
    const front = RAMP_FRONT_CONTACT[bike.id], rear = RAMP_REAR_CONTACT[bike.id];
    for (const tire of [front, rear]) {
      const center = tire.radius * Math.sin(displayed) + tire.axle * Math.cos(displayed);
      expect(carFrontReach(bike.id, displayed)).toBeGreaterThanOrEqual(tire.radius - center - 1e-12);
      expect(carRearReach(bike.id, displayed)).toBeGreaterThanOrEqual(tire.radius + center - 1e-12);
    }
    expect(carJumpClearance(bike.id, 1.4, carContactPitch(bike.id, recoverable, .2), .3, 0))
      .toBe(carJumpClearance(bike.id, 1.4, displayed, .3, 0));
  });
  it.each(BIKES)('$name retains the exact same ballistic arc beside an adjacent car', bike => {
    const reference = new Engine(bike, 907), traffic = new Engine(bike, 907);
    const arcs: number[][] = [[], []];
    for (const [index, engine] of [reference, traffic].entries()) {
      engine.elapsed = 25; engine.start();
      const velocity = speedAtTime(engine.elapsed, bike) - 12;
      engine.spawn('towtruck', 0, 14, 0, velocity);
      if (index) engine.spawn('car', 1, 14, 0, velocity);
      for (let frame = 0; frame < 120 && engine.height < .55 && engine.phase === 'playing'; frame++) engine.advance(STEP);
      expect(engine.onTowTruck).toBe(true);
      engine.move(1);
      expect(engine.velocityY).toBe(TOW_TRANSFER.launchVelocity);
      for (let frame = 0; frame < 100; frame++) {
        engine.advance(STEP); arcs[index].push(engine.height);
        if (engine.phase !== 'playing') break;
      }
      expect(engine.phase, `${bike.id}: height=${engine.height}, car=${engine.crashObstacle?.z}`).toBe('playing');
      expect(engine.jumps).toBe(1);
    }
    expect(arcs[1]).toEqual(arcs[0]);
  });
  it.each(BIKES)('$name still collides when its trailing tire descends into the final hood edge', bike => {
    const engine = new Engine(bike, 901);
    engine.start();
    engine.height = .3;
    const rear = RAMP_REAR_CONTACT[bike.id];
    const carZ = TRAFFIC_SHAPES.car.frontZ - carRearReach(bike.id, 0) + rear.radius * .15;
    // The former fixed one-metre exit had already made this visible overlap immune.
    expect(carZ).toBeLessThan(TRAFFIC_SHAPES.car.frontZ - 1);
    engine.spawn('car', 0, carZ, 0, speedAtTime(STEP, bike));
    const car = engine.obstacles.find(obstacle => obstacle.active)!;
    engine.advance(STEP);
    expect(engine.phase).toBe('crashed');
    expect(engine.crashObstacle).toBe(car);
    expect(car.passed).toBe(false);
  });
  it('awards a cleared car only once and only after the entire pitched rear tire exits', () => {
    const bike = BIKES.find(bike => bike.id === '450')!;
    const engine = new Engine(bike, 903);
    engine.start(); engine.height = 3; engine.velocityY = 0;
    engine.spawn('car', 0, -4.05, 0, 0);
    const car = engine.obstacles.find(obstacle => obstacle.active)!;
    car.cleared = true; car.rewardPoints = 123; car.rewardText = 'CLEARANCE TEST';
    engine.advance(STEP);
    expect(car.passed).toBe(false);
    expect(engine.scoreGains.filter(gain => gain.text === 'CLEARANCE TEST')).toHaveLength(0);
    for (let frame = 0; frame < 8; frame++) engine.advance(STEP);
    expect(engine.phase).toBe('playing');
    expect(car.passed).toBe(true);
    expect(engine.scoreGains.filter(gain => gain.text === 'CLEARANCE TEST')).toHaveLength(1);
  });
});

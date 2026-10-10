import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import {
  Engine,
  LANE,
  STEP,
  STUNT_POINTS,
  type Obstacle,
} from '../app/game/engine';
import { POLICE, firstPoliceHit } from '../app/game/policePursuit';

function ride() {
  const engine = new Engine(BIKES.find(bike => bike.id === '450')!, 539);
  engine.start();
  return engine;
}

/** Keep generated traffic out of a focused pursuit scenario. */
function frame(engine: Engine, keep: readonly Obstacle[] = []) {
  for (const obstacle of engine.obstacles)
    if (!obstacle.police && !keep.includes(obstacle)) obstacle.active = false;
  engine.advance(STEP);
}

function patrolEncounter(engine: Engine, stunt: boolean) {
  const patrol = engine.spawn('car', 1, 1, 0, 0, true)!;
  for (let count = 0; count < 35 && !engine.policeChase; count++) {
    if (stunt) {
      engine.wheelieAngle = 0.6;
      engine.wheelieAngularVelocity = 0;
    }
    frame(engine);
  }
  engine.wheelieAngle = 0;
  engine.wheelieAngularVelocity = 0;
  engine.wheelie = false;
  return patrol;
}

function startPursuit() {
  const engine = ride();
  patrolEncounter(engine, true);
  expect(engine.phase).toBe('playing');
  expect(engine.policeChase).toBe(true);
  return engine;
}

describe('police pursuit gameplay', () => {
  it('ignores a patrol passed without a stunt', () => {
    const engine = ride();
    patrolEncounter(engine, false);
    expect(engine.phase).toBe('playing');
    expect(engine.policeChase).toBe(false);
    expect(engine.policeOutcome).toBe('none');
    expect(engine.policeRamRemaining).toBe(0);
  });

  it('starts exactly one pursuit when a patrol sees a wheelie', () => {
    const engine = startPursuit();
    expect(engine.policeVehicle.phase).toBe('chasing');
    expect(engine.policeVehicle.visible).toBe(false);
    const remaining = engine.policeRamRemaining;
    expect(remaining).toBeGreaterThanOrEqual(10 - STEP * 1.01);
    expect(remaining).toBeLessThanOrEqual(10);
    for (let count = 0; count < 30; count++) frame(engine);
    expect(engine.policeChase).toBe(true);
    expect(engine.policeRamRemaining).toBeCloseTo(remaining - 0.5, 5);
    expect(engine.policeOutcomeSerial).toBe(0);
  });

  it('does not escape by merely passing a tow truck in another lane', () => {
    const engine = startPursuit();
    const truck = engine.spawn('towtruck', -1, 0)!;
    for (let count = 0; count < 45; count++) frame(engine, [truck]);
    expect(truck.passed).toBe(true);
    expect(engine.phase).toBe('playing');
    expect(engine.policeChase).toBe(true);
    expect(engine.policeOutcome).toBe('none');
  });

  it('requires a close call or jump rather than ordinary wheelie lane switches', () => {
    const engine = startPursuit();
    for (const direction of [1, -1, -1, 1]) {
      engine.wheelie = true;
      engine.move(direction);
    }
    expect(engine.policeChase).toBe(true);
    expect(engine.policeOutcome).toBe('none');
    expect(engine.policeOutcomeSerial).toBe(0);
  });

  it('escapes with a real tow-truck side jump without freezing the truck', () => {
    const engine = startPursuit();
    const truck = engine.spawn('towtruck', 0, 14, 0, 6)!;
    for (let count = 0; count < 100 && !engine.onTowTruck; count++)
      frame(engine, [truck]);
    expect(engine.onTowTruck).toBe(true);
    engine.move(1);
    expect(engine.launchSerial).toBe(1);
    for (let count = 0; count < 100; count++) frame(engine, [truck]);
    expect(engine.phase).toBe('playing');
    expect(engine.jumps).toBe(1);
    expect(engine.policeOutcome).toBe('escaped');
    expect(engine.policeOutcomeSerial).toBe(1);
    expect(truck.velocity).toBe(6);
  });

  it('rewards a genuine close call exactly once and leaves unrelated NPCs alone', () => {
    const engine = startPursuit();
    const target = engine.spawn('car', 1, 0.4, -1.2)!;
    const innocent = engine.spawn('van', -1, 95, 0, 6)!;
    for (let count = 0; count < 30; count++) frame(engine, [target, innocent]);
    expect(engine.phase).toBe('playing');
    expect(engine.nearMisses).toBe(1);
    expect(engine.policeChase).toBe(false);
    expect(engine.policeOutcome).toBe('escaped');
    expect(engine.policeOutcomeSerial).toBe(1);
    const rewards = engine.scoreGains.filter(
      (gain) => gain.points === STUNT_POINTS.policeEscape,
    );
    expect(rewards).toHaveLength(1);
    for (let count = 0; count < 180; count++) frame(engine, [target, innocent]);
    expect(engine.policeOutcomeSerial).toBe(1);
    expect(innocent.police).toBe(false);
  });

  it('leaves the exact close-call car solid and moving normally after the police wreck retires', () => {
    const engine = startPursuit();
    const target = engine.spawn('car', 1, 0.4, -1.2, 23)!;
    const targetId = target.spawnId;
    for (let count = 0; count < 510; count++) frame(engine, [target]);
    expect(engine.phase).toBe('playing');
    expect(engine.policeOutcome).toBe('escaped');
    expect(engine.policeImpact.targetSpawnId).toBe(targetId);
    expect(engine.policeImpact.serial).toBe(1);
    expect(engine.policeImpact.fallback).toBe(false);
    expect(target.active).toBe(true);
    expect(target.velocity).toBe(23);
    engine.lane = target.lane;
    engine.x = target.lane * LANE + target.offsetX;
    target.z = 0;
    frame(engine, [target]);
    expect(engine.phase).toBe('crashed');
    expect(engine.crashObstacle).toBe(target);
    expect(engine.event.text).toBe('Traffic collision');
  });

  it('pauses the pursuit clock together with gameplay', () => {
    const engine = startPursuit();
    engine.pause();
    const snapshot = [
      engine.policeRamRemaining,
      engine.distance,
      engine.policeProgress,
    ];
    for (let count = 0; count < 120; count++) frame(engine);
    expect([
      engine.policeRamRemaining,
      engine.distance,
      engine.policeProgress,
    ]).toEqual(snapshot);
    engine.resume();
    for (let count = 0; count < 179; count++) frame(engine);
    expect(engine.policeRamRemaining).toBe(snapshot[0]);
    for (let count = 0; count < 3; count++) frame(engine);
    expect(engine.policeRamRemaining).toBeLessThan(snapshot[0]);
  });

  it('settles an ordinary collision during a pursuit once without converting the NPC to police', () => {
    const engine = startPursuit();
    const obstacle = engine.spawn('van', 0, 0)!;
    frame(engine, [obstacle]);
    expect(engine.phase).toBe('crashed');
    expect(engine.crashObstacle).toBe(obstacle);
    expect(obstacle.police).toBe(false);
    expect(engine.policeChase).toBe(false);
    expect(engine.policeVehicle.visible).toBe(false);
    const serial = engine.policeOutcomeSerial;
    for (let count = 0; count < 120; count++) engine.advance(STEP);
    expect(engine.policeOutcomeSerial).toBe(serial);
    expect(engine.crashObstacle).toBe(obstacle);
  });

  it('rams at the displayed deadline, not several seconds after zero', () => {
    const engine = startPursuit();
    const deadline = engine.policeRamRemaining;
    for (let count = 0; count < Math.ceil(deadline / STEP) + 2; count++) {
      const previousZ = engine.policeVehicle.z;
      if (engine.policeRamRemaining > STEP * 1.01)
        expect(engine.phase).toBe('playing');
      frame(engine);
      expect(engine.policeVehicle.z - previousZ).toBeLessThanOrEqual(0.1);
    }
    expect(engine.phase).toBe('crashed');
    expect(engine.policeOutcome).toBe('caught');
    expect(engine.policeRamRemaining).toBe(0);
    expect(engine.crashObstacle?.police).toBe(true);
    expect(engine.event.text).toContain('GERAMMT');
    expect(engine.policeVehicle.z).toBeCloseTo(POLICE.ramZ, 3);
    expect(engine.policeRamObstacle!.velocity).toBeGreaterThan(
      engine.speed + 2,
    );
    expect(engine.policeRamObstacle!.velocity).toBe(
      engine.policeVehicle.velocity,
    );
  });

  it('accelerates and brakes into its close-call car, then recoils independently with grounded wheels', () => {
    const engine = startPursuit();
    engine.policeVehicle.x = 1.8;
    engine.policeVehicle.velocity = 6;
    const target = engine.spawn('car', 1, 0.4, -1.2, 6)!;
    let slowing = false;
    for (
      let count = 0;
      count < 480 && engine.policeVehicle.phase !== 'wrecked';
      count++
    ) {
      const previous = { ...engine.policeVehicle };
      frame(engine, [target]);
      const police = engine.policeVehicle;
      if (previous.phase !== 'approach' || police.phase !== 'approach')
        continue;
      const acceleration = (police.velocity - previous.velocity) / STEP;
      expect(acceleration).toBeLessThanOrEqual(
        POLICE.escapeAcceleration + 1e-5,
      );
      expect(acceleration).toBeGreaterThanOrEqual(-POLICE.escapeBraking - 1e-5);
      slowing ||= acceleration < -1;
    }
    expect(slowing).toBe(true);
    const police = engine.policeVehicle;
    expect(police.phase).toBe('wrecked');
    expect(engine.policeImpact.targetSpawnId).toBe(target.spawnId);
    expect(engine.policeImpact.fallback).toBe(false);
    expect(police.impactSpeed).toBeGreaterThan(3);
    expect(police.impactSpeed).toBeLessThan(10);
    const contactGap = target.z - police.z;
    let hadPitchResponse = false;
    for (let count = 0; count < 43; count++) {
      const previousVelocity = police.velocity;
      const previousZ = police.z;
      const previousDistance = engine.distance;
      frame(engine, [target]);
      const travel = engine.distance - previousDistance;
      expect(police.z).toBeCloseTo(
        previousZ - travel + ((previousVelocity + police.velocity) * STEP) / 2,
        7,
      );
      expect(police.velocity).toBeLessThanOrEqual(previousVelocity);
      expect(previousVelocity - police.velocity).toBeLessThanOrEqual(
        POLICE.wreckBraking * STEP + 1e-6,
      );
      expect(
        police.y -
          1.85 * Math.abs(Math.sin(police.pitch)) -
          1.055 * Math.abs(Math.sin(police.roll)),
      ).toBeGreaterThanOrEqual(-1e-8);
      hadPitchResponse ||= Math.abs(police.pitch) > 0.005;
    }
    expect(hadPitchResponse).toBe(true);
    expect(police.velocity).toBe(0);
    expect(target.z - police.z).toBeGreaterThan(contactGap + 2);
    expect(target.velocity).toBe(6);
    expect(engine.policeOutcomeSerial).toBe(1);
    engine.pause();
    const paused = { ...police };
    const pausedEvent = { ...engine.policeImpact };
    for (let count = 0; count < 60; count++) frame(engine, [target]);
    expect(police).toEqual(paused);
    expect(engine.policeImpact).toEqual(pausedEvent);
  });

  it('must physically catch up after traffic delays the police instead of teleporting at timeout', () => {
    const engine = startPursuit();
    engine.policeVehicle.x = engine.x;
    engine.policeVehicle.z = -40;
    engine.policeRamRemaining = STEP;
    frame(engine);
    expect(engine.phase).toBe('playing');
    expect(engine.policeChase).toBe(true);
    expect(engine.policeVehicle.z).toBeLessThan(-30);
    expect(engine.policeRamRemaining).toBeGreaterThan(0);
  });

  it('reports the original target once when its pool slot is recycled, without touching the replacement', () => {
    const engine = startPursuit();
    const target = engine.spawn('car', 1, 0.4, -1.2)!;
    frame(engine, [target]);
    expect(engine.policeImpactTarget).toBe(target);
    expect(engine.policeImpact.serial).toBe(0);
    const originalId = target.spawnId;
    const originalWorld = engine.distance + target.z;
    const originalX = target.lane * LANE + target.offsetX;
    target.active = false;
    const replacement = engine.spawn('van', -1, 100, 0, 6)!;
    expect(replacement).toBe(target);
    const replacementId = replacement.spawnId;
    const distance = engine.distance;
    frame(engine, [replacement]);
    expect(engine.policeVehicle.phase).toBe('idle');
    expect(engine.policeImpactTarget).toBeNull();
    expect(engine.policeImpact.serial).toBe(1);
    expect(engine.policeImpact.targetSpawnId).toBe(originalId);
    expect(engine.policeImpact.fallback).toBe(true);
    expect(engine.policeImpact.x).toBe(originalX);
    expect(engine.policeImpact.worldDistance).toBeCloseTo(
      originalWorld - 2.92,
      8,
    );
    expect(replacement.spawnId).toBe(replacementId);
    expect(replacement.z).toBeCloseTo(
      100 - (engine.distance - distance) + 6 * STEP,
      8,
    );
    expect(replacement.velocity).toBe(6);
    for (let count = 0; count < 60; count++) frame(engine, [replacement]);
    expect(engine.policeImpact.serial).toBe(1);
    expect(engine.policeOutcomeSerial).toBe(1);
  });

  it('ends a blocked approach with one fallback at the same original target instead of choosing another car', () => {
    const engine = startPursuit();
    engine.policeVehicle.z = -80;
    const target = engine.spawn('car', 1, 0.4, -1.2, 6)!;
    const innocent = engine.spawn('van', -1, 95, 0, 6)!;
    frame(engine, [target, innocent]);
    engine.policeVehicle.age = POLICE.escapeSeconds;
    const targetId = target.spawnId;
    frame(engine, [target, innocent]);
    expect(engine.policeVehicle.phase).toBe('idle');
    expect(engine.policeImpact.targetSpawnId).toBe(targetId);
    expect(engine.policeImpact.serial).toBe(1);
    expect(engine.policeImpact.fallback).toBe(true);
    expect(engine.policeImpact.worldDistance).toBeCloseTo(
      engine.distance + target.z - 2.92,
      8,
    );
    expect(innocent.velocity).toBe(6);
    expect(innocent.police).toBe(false);
    for (let count = 0; count < 60; count++) frame(engine, [target, innocent]);
    expect(engine.policeImpact.serial).toBe(1);
  });

  it('waits to merge when an ordinary car occupies the police lane-change path', () => {
    const engine = startPursuit();
    engine.policeVehicle.x = LANE;
    const blocker = engine.spawn(
      'car',
      0,
      engine.policeVehicle.z,
      0,
      engine.speed,
    )!;
    for (let count = 0; count < 30; count++) {
      frame(engine, [blocker]);
      if (Math.abs(blocker.z - engine.policeVehicle.z) < 5.8)
        expect(Math.abs(engine.policeVehicle.x)).toBeGreaterThanOrEqual(2.35);
    }
    expect(blocker.police).toBe(false);
    expect(engine.policeOutcome).toBe('none');
    blocker.active = false;
    for (let count = 0; count < 50; count++) frame(engine);
    expect(engine.policeVehicle.x).toBeCloseTo(engine.x, 6);
  });

  it('keeps ordinary NPC pool slots free of chase state after a patrol is reused', () => {
    const engine = startPursuit();
    const closeCall = engine.spawn('car', 1, 0.4, -1.2)!;
    const target = engine.spawn('car', -1, 120, 0, 6)!;
    for (
      let count = 0;
      count < 180 && engine.policeImpact.serial === 0;
      count++
    )
      frame(engine, [target, closeCall]);
    expect(engine.policeOutcome).toBe('escaped');
    expect(engine.policeVehicle.phase).toBe('wrecked');
    for (const obstacle of engine.obstacles) obstacle.active = false;
    const previousSpawnIds = engine.obstacles.map(
      (obstacle) => obstacle.spawnId,
    );
    const replacements = Array.from(
      { length: engine.obstacles.length },
      (_, index) =>
        engine.spawn('car', index % 2 === 0 ? -1 : 1, 90 + index * 8, 0, 6)!,
    );
    const positions = replacements.map((obstacle) => obstacle.z);
    const previousDistance = engine.distance;
    frame(engine, replacements);
    const travel = engine.distance - previousDistance;
    replacements.forEach((obstacle, index) => {
      expect(obstacle.police).toBe(false);
      expect(obstacle.spawnId).toBeGreaterThan(previousSpawnIds[index]);
      expect(obstacle.lane).toBe(index % 2 === 0 ? -1 : 1);
      expect(obstacle.z).toBeCloseTo(positions[index] - travel + 6 * STEP, 8);
    });
    expect(engine.policeImpactTarget).toBeNull();
    expect(engine.x).toBeCloseTo(engine.lane * LANE, 8);
  });

  it('hits only the close-call car behind the rider and never substitutes visible traffic ahead', () => {
    const engine = startPursuit();
    const target = engine.spawn('car', 1, 0.4, -1.2)!;
    const innocent = engine.spawn('van', -1, 120, 0, 6)!;
    const targetId = target.spawnId;
    for (
      let count = 0;
      count < 180 && engine.policeImpact.serial === 0;
      count++
    ) {
      const oldDistance = engine.distance;
      const oldTargetZ = target.z;
      const oldInnocentZ = innocent.z;
      const oldPolice = { ...engine.policeVehicle };
      frame(engine, [target, innocent]);
      const travel = engine.distance - oldDistance;
      expect(target.z).toBeCloseTo(oldTargetZ - travel, 8);
      expect(innocent.z).toBeCloseTo(oldInnocentZ - travel + 6 * STEP, 8);
      expect(engine.policeImpactTarget).toBe(target);
      if (oldPolice.phase === 'approach') {
        expect(
          Math.abs(engine.policeVehicle.x - oldPolice.x),
        ).toBeLessThanOrEqual(POLICE.lateralSpeed * STEP + 1e-6);
        expect(engine.policeVehicle.z - oldPolice.z).toBeLessThanOrEqual(
          POLICE.escapeClosingSpeed * STEP + 1e-4,
        );
      }
    }
    expect(engine.policeVehicle.phase).toBe('wrecked');
    expect(engine.policeVehicle.z).toBeLessThan(0);
    expect(engine.policeImpact.serial).toBe(1);
    expect(engine.policeImpact.targetSpawnId).toBe(targetId);
    expect(engine.policeImpact.fallback).toBe(false);
    expect(engine.policeImpact.worldDistance).toBeCloseTo(
      engine.distance + engine.policeImpact.z,
      8,
    );
    expect(engine.policeOutcomeSerial).toBe(1);
    expect(innocent.velocity).toBe(6);
    expect(innocent.police).toBe(false);
  });

  it('waits for intervening traffic without turning the blocker into its crash target', () => {
    const engine = startPursuit();
    engine.policeVehicle.x = -LANE;
    const target = engine.spawn('car', 1, 0.4, -1.2)!;
    const blocker = engine.spawn('van', 0, -12, 0, engine.speed)!;
    const blockerId = blocker.spawnId;
    const traffic = [target, blocker];
    for (
      let count = 0;
      count < 300 && engine.policeImpact.serial === 0;
      count++
    ) {
      const old = { ...engine.policeVehicle };
      const distance = engine.distance;
      frame(engine, traffic);
      expect(blocker.spawnId).toBe(blockerId);
      expect(engine.policeImpactTarget).toBe(target);
      if (old.phase !== 'approach') continue;
      const police = engine.policeVehicle;
      const startZ = old.z - (engine.distance - distance);
      expect(
        firstPoliceHit([blocker], old.x, startZ, police.x, startZ),
      ).toBeNull();
      expect(
        firstPoliceHit([blocker], police.x, startZ, police.x, police.z),
      ).toBeNull();
    }
    expect(engine.phase).toBe('playing');
    expect(engine.policeVehicle.phase).toBe('wrecked');
    expect(engine.policeImpact.targetSpawnId).toBe(target.spawnId);
    expect(engine.policeImpact.fallback).toBe(false);
    expect(blocker.police).toBe(false);
  });

  it('crashes on the exact jumped trailer and rolls back above its ramp', () => {
    const engine = startPursuit();
    const trailer = engine.spawn('towtruck', 0, 14, 0, 6)!;
    const innocent = engine.spawn('towtruck', -1, 120, 0, 6)!;
    const traffic = [trailer, innocent];
    for (let count = 0; count < 100 && !engine.onTowTruck; count++)
      frame(engine, traffic);
    expect(engine.onTowTruck).toBe(true);
    engine.move(1);
    for (
      let count = 0;
      count < 240 && engine.policeImpact.serial === 0;
      count++
    )
      frame(engine, traffic);
    expect(engine.policeVehicle.phase).toBe('wrecked');
    expect(engine.policeImpactTarget).toBe(trailer);
    expect(engine.policeImpact.targetSpawnId).toBe(trailer.spawnId);
    expect(engine.policeImpact.serial).toBe(1);
    expect(engine.policeImpact.fallback).toBe(false);
    expect(engine.policeVehicle.y).toBeGreaterThan(0.1);
    expect(engine.policeVehicle.pitch).toBeGreaterThan(0);
    expect(trailer.velocity).toBe(6);
    const separation = trailer.z - engine.policeVehicle.z;
    for (let count = 0; count < 20; count++) frame(engine, traffic);
    expect(trailer.z - engine.policeVehicle.z).toBeGreaterThan(
      separation + 0.2,
    );
    expect(engine.policeVehicle.y).toBeGreaterThanOrEqual(0);
    expect(trailer.active).toBe(true);
    expect(innocent.velocity).toBe(6);
  });

  it('keeps the bound-target escape deterministic across render frame chunk sizes', () => {
    const a = startPursuit();
    const b = startPursuit();
    for (const run of [a, b]) {
      run.spawn('car', 1, 0.4, -1.2);
      run.spawn('van', -1, 120, 0, 6);
    }
    for (let count = 0; count < 420; count++) a.advance(STEP);
    for (let count = 0; count < 210; count++) b.advance(STEP * 2);
    expect(a.policeVehicle).toEqual(b.policeVehicle);
    expect(a.policeImpact).toEqual(b.policeImpact);
    expect(a.policeImpact.serial).toBe(1);
    expect(a.policeOutcomeSerial).toBe(b.policeOutcomeSerial);
    expect(a.score).toBe(b.score);
    expect(a.obstacles).toEqual(b.obstacles);
  });
});

describe('speed camera pursuit integration', () => {
  function approachCamera(stunt: boolean) {
    const engine = ride();
    engine.score = 7500;
    frame(engine);
    expect(engine.speedCamera.active).toBe(true);
    engine.distance = engine.speedCamera.distance - 1;
    if (stunt) engine.wheelieAngle = 0.6;
    frame(engine);
    return engine;
  }

  it('passes a camera normally without a flash or pursuit', () => {
    const engine = approachCamera(false);
    expect(engine.policeChase).toBe(false);
    expect(engine.blitzerFlashSerial).toBe(0);
    expect(engine.speedCamera.triggered).toBe(false);
  });

  it('flashes once for a stunt and keeps the pursuing police offscreen', () => {
    const engine = approachCamera(true);
    expect(engine.policeChase).toBe(true);
    expect(engine.speedCamera.triggered).toBe(true);
    expect(engine.blitzerFlashSerial).toBe(1);
    expect(engine.blitzerFlashRemaining).toBeGreaterThan(0);
    expect(engine.policeVehicle.visible).toBe(false);
    for (let count = 0; count < 10; count++) frame(engine);
    expect(engine.blitzerFlashSerial).toBe(1);
    expect(engine.policeOutcomeSerial).toBe(0);
  });

  it('does not restart the same pursuit when a patrol and camera meet in one frame', () => {
    const engine = ride();
    engine.score = 7500;
    frame(engine);
    engine.distance = engine.speedCamera.distance - 1;
    const patrol = engine.spawn('car', 1, -3.95, 0, 0, true)!;
    engine.wheelieAngle = 0.6;
    frame(engine, [patrol]);
    expect(engine.policeChase).toBe(true);
    expect(engine.blitzerFlashSerial).toBeLessThanOrEqual(1);
    const remaining = engine.policeRamRemaining;
    const serial = engine.event.serial;
    engine.wheelieAngle = 0;
    engine.wheelieAngularVelocity = 0;
    engine.wheelie = false;
    for (let count = 0; count < 30; count++) frame(engine, [patrol]);
    expect(engine.policeRamRemaining).toBeCloseTo(remaining - 0.5, 5);
    expect(engine.event.serial).toBe(serial);
    expect(engine.policeOutcomeSerial).toBe(0);
  });

  it('starts independently of a full NPC pool without converting an ordinary car', () => {
    const engine = ride();
    engine.score = 7500;
    frame(engine);
    for (const obstacle of engine.obstacles) obstacle.active = false;
    const cars = Array.from({ length: engine.obstacles.length }, (_, index) =>
      engine.spawn('car', -1, 100 + index * 9)!,
    );
    engine.distance = engine.speedCamera.distance - 1;
    engine.wheelieAngle = 0.6;
    engine.advance(STEP);
    expect(engine.policeChase).toBe(true);
    expect(engine.blitzerFlashSerial).toBe(1);
    expect(cars.every((car) => car.active && !car.police)).toBe(true);
    expect(engine.policeVehicle.phase).toBe('chasing');
  });

  it('shares one recovery window between patrols and a camera milestone crossed during escape', () => {
    const engine = approachCamera(true);
    engine.wheelieAngle = 0;
    engine.wheelieAngularVelocity = 0;
    engine.wheelie = false;
    const closeCall = engine.spawn('car', 1, 0.4, -1.2)!;
    const target = engine.spawn('van', -1, 120, 0, 6)!;
    engine.score = 22500;
    for (
      let count = 0;
      count < 900 && engine.policeVehicle.phase !== 'idle';
      count++
    )
      frame(engine, [closeCall, target]);
    expect(engine.policeVehicle.phase).toBe('idle');
    expect(engine.policeOutcomeSerial).toBe(1);
    expect(engine.speedCamera.active).toBe(false);
    const patrol = engine.spawn('car', 1, -3.95, 0, 0, true)!;
    engine.wheelieAngle = 0.6;
    for (let count = 0; count < 30 && !patrol.passed; count++)
      frame(engine, [patrol]);
    expect(patrol.passed).toBe(true);
    expect(engine.policeChase).toBe(false);
    engine.wheelieAngle = 0;
    engine.wheelieAngularVelocity = 0;
    engine.wheelie = false;
    for (
      let count = 0;
      count < (POLICE.encounterCooldownSeconds - 1) / STEP;
      count++
    ) {
      frame(engine);
      expect(engine.speedCamera.active).toBe(false);
      expect(engine.policeChase).toBe(false);
    }
    for (let count = 0; count < 1200 && !engine.speedCamera.active; count++)
      frame(engine);
    expect(engine.speedCamera.active).toBe(true);
    expect(engine.speedCamera.id).toBe(2);
    expect(engine.blitzerFlashSerial).toBe(1);
    engine.distance = engine.speedCamera.distance - 1;
    engine.wheelieAngle = 0.6;
    frame(engine);
    expect(engine.policeChase).toBe(true);
    expect(engine.blitzerFlashSerial).toBe(2);
    for (let count = 0; count < 10; count++) frame(engine);
    expect(engine.blitzerFlashSerial).toBe(2);
  });
});

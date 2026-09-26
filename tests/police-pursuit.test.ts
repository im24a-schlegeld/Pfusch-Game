import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import {
  Engine,
  LANE,
  STEP,
  STUNT_POINTS,
  type Obstacle,
} from '../app/game/engine';

function ride() {
  const engine = new Engine(BIKES[2], 539);
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
    expect(remaining).toBeGreaterThan(10);
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
    const target = engine.spawn('car', 1, 0.4, -1)!;
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

  it('keeps a visible impact partner solid beyond the old eight-second despawn timer', () => {
    const engine = startPursuit();
    const target = engine.spawn('car', 1, 0.4, -1, 23)!;
    for (let count = 0; count < 510; count++) frame(engine, [target]);
    expect(engine.phase).toBe('playing');
    expect(engine.policeOutcome).toBe('escaped');
    expect(engine.policeVehicle.phase).toBe('wrecked');
    expect(engine.policeImpactTarget).toBe(target);
    expect(target.active).toBe(true);
    expect(target.velocity).toBe(23);
    expect(Math.abs(target.z)).toBeLessThan(3);
    expect(engine.policeVehicle.y).toBe(0);
    engine.lane = target.lane;
    engine.x = target.lane * LANE + target.offsetX;
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
      if (engine.policeRamRemaining > STEP * 1.01)
        expect(engine.phase).toBe('playing');
      frame(engine);
    }
    expect(engine.phase).toBe('crashed');
    expect(engine.policeOutcome).toBe('caught');
    expect(engine.policeRamRemaining).toBe(0);
    expect(engine.crashObstacle?.police).toBe(true);
    expect(engine.event.text).toContain('GERAMMT');
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
    const target = engine.spawn('car', 1, 0.4, -1)!;
    for (let count = 0; count < 180; count++) frame(engine, [target]);
    expect(engine.policeOutcome).toBe('escaped');
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
});

import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, LANE, STEP, type Obstacle, type ObstacleKind } from '../app/game/engine';
import { ROAD_EVENTS, isRoadEvent } from '../app/game/roadEvents';
import { TRAFFIC_SHAPES } from '../app/game/trafficDomain';

type Wave = { section: string; kinds: ObstacleKind[]; velocity: number; roadblockLane?: -1 | 1 };
function schedule(run: Engine) {
  return run as unknown as { spawnWave(): void; nextSafe: number; pendingWave: Wave | null };
}
function ride(seed = 37, score = 75_000) {
  const run = new Engine(BIKES.find(bike => bike.id === '450')!, seed);
  run.score = score;
  run.start();
  return run;
}
function steps(run: Engine, count: number) {
  for (let tick = 0; tick < count; tick++) run.advance(STEP);
}
function clear(run: Engine) {
  for (const obstacle of run.obstacles) obstacle.active = false;
}
function findRoadblock(previousSafe = 0, seed = 37) {
  const run = ride(seed);
  for (let attempt = 0; attempt < 100; attempt++) {
    clear(run);
    schedule(run).nextSafe = previousSafe;
    schedule(run).spawnWave();
    if (run.obstacles.some(o => o.active && o.kind === 'spikes')) return run;
  }
  throw new Error('No roadblock generated at the eligible score');
}
function blockedLanes(wave: Obstacle[]) {
  return [-1, 0, 1].filter(lane => wave.some(o => {
    const shape = isRoadEvent(o.kind) ? ROAD_EVENTS[o.kind] : TRAFFIC_SHAPES[o.kind];
    return Math.abs(lane * LANE - o.lane * LANE - o.offsetX) < shape.contactHalfWidth;
  }));
}

describe('partial police roadblock scheduling', () => {
  it('never generates nails below 75k and unlocks them at the threshold', () => {
    const below = ride(37, 74_999);
    for (let wave = 0; wave < 150; wave++) {
      clear(below);
      schedule(below).spawnWave();
      expect(below.obstacles.some(o => o.active && o.kind === 'spikes')).toBe(false);
    }
    expect(findRoadblock().obstacles.some(o => o.active && o.kind === 'spikes')).toBe(true);
  });

  it.each([-1, 0, 1])('leaves one reachable outer lane from previous safe lane %i', previousSafe => {
    const sides = new Set<number>();
    for (const seed of [37, 951, 8421, 18591, 27451, 65223]) {
      const run = findRoadblock(previousSafe, seed);
      const wave = run.obstacles.filter(o => o.active);
      const cars = wave.filter(o => o.kind === 'car');
      const nails = wave.filter(o => o.kind === 'spikes');
      expect(wave).toHaveLength(2);
      expect(cars).toHaveLength(1);
      expect(nails).toHaveLength(1);
      expect([cars[0].lane, cars[0].velocity, cars[0].police, cars[0].roadblock])
        .toEqual([0, 0, true, true]);
      expect(Math.abs(nails[0].lane)).toBe(1);
      expect(nails[0].z).toBe(cars[0].z);
      expect(nails[0].z).toBe(145);
      expect(blockedLanes(wave).sort()).toEqual([0, nails[0].lane].sort());
      const free = -nails[0].lane;
      expect(Math.abs(free - previousSafe)).toBeLessThanOrEqual(1);
      expect(schedule(run).nextSafe).toBe(free);
      expect(cars[0].laneShift).toBeNull();
      sides.add(nails[0].lane);
    }
    if (previousSafe === 0) expect([...sides].sort()).toEqual([-1, 1]);
  });

  it('keeps a chosen pair and outer lane stable during arrival-gap and pool retries', () => {
    const run = findRoadblock();
    const nailsLane = run.obstacles.find(o => o.active && o.kind === 'spikes')!.lane as -1 | 1;
    clear(run);
    schedule(run).pendingWave = {
      section: run.world.at(run.distance + 145)!.kind,
      kinds: ['car', 'spikes'], velocity: 0, roadblockLane: nailsLane,
    };
    const blocker = run.spawn('car', 0, 140)!;
    schedule(run).spawnWave();
    expect(run.obstacles.filter(o => o.active)).toEqual([blocker]);
    expect(schedule(run).pendingWave?.roadblockLane).toBe(nailsLane);
    blocker.active = false;
    // Saturation behind the player must not allow a one-piece roadblock.
    for (let slot = 0; slot < 31; slot++) run.spawn('rough', 0, -50);
    schedule(run).spawnWave();
    expect(run.obstacles.filter(o => o.active)).toHaveLength(31);
    expect(run.obstacles.some(o => o.active && o.kind === 'spikes')).toBe(false);
    expect(schedule(run).pendingWave?.roadblockLane).toBe(nailsLane);
    run.obstacles.find(o => o.active)!.active = false;
    schedule(run).spawnWave();
    expect(run.obstacles.filter(o => o.active && (o.kind === 'spikes' || o.roadblock)))
      .toHaveLength(2);
    expect(run.obstacles.find(o => o.active && o.kind === 'spikes')!.lane).toBe(nailsLane);
  });

  it('defers a pending roadblock during police, camera, or ramp encounters', () => {
    for (const hazard of ['chase', 'camera', 'ramp', 'airborne'] as const) {
      const run = ride();
      schedule(run).pendingWave = {
        section: run.world.at(145)!.kind, kinds: ['car', 'spikes'], velocity: 0, roadblockLane: -1,
      };
      if (hazard === 'chase') run.policeChase = true;
      if (hazard === 'camera') run.speedCamera.active = true;
      if (hazard === 'ramp') run.spawn('ramp', 0, -2);
      if (hazard === 'airborne') run.height = 1;
      schedule(run).spawnWave();
      expect(run.obstacles.some(o => o.active && o.kind === 'spikes')).toBe(false);
      expect(schedule(run).pendingWave?.roadblockLane).toBe(-1);
    }
  });

  it('keeps roadblocks occasional with a distance cooldown', () => {
    const run = findRoadblock();
    run.distance = 1399;
    run.world.advance(run.distance);
    for (let wave = 0; wave < 100; wave++) {
      clear(run);
      schedule(run).spawnWave();
      expect(run.obstacles.some(o => o.active && o.kind === 'spikes')).toBe(false);
    }
  });
});

describe('nail strip tire contact', () => {
  it.each([0, 0.6])('punctures with wheelie angle %f, crashing only after clearing the strip', angle => {
    const run = ride(42, 0);
    run.wheelieAngle = angle;
    const nails = run.spawn('spikes', 0, 0)!;
    steps(run, 1);
    expect(run.phase).toBe('playing');
    expect(nails.cleared).toBe(true);
    while (nails.z > -5 && run.phase === 'playing') run.advance(STEP);
    expect(run.phase).toBe('playing');
    while (nails.z > -9 && run.phase === 'playing') run.advance(STEP);
    expect(run.phase).toBe('crashed');
    expect(nails.z).toBeLessThanOrEqual(-7);
    expect(nails.z).toBeGreaterThan(-8);
    expect(run.crashObstacle).toBe(nails);
    const serial = run.event.serial;
    steps(run, 20);
    expect(run.event.serial).toBe(serial);
  });

  it('allows actual jump clearance and the opposite lane, without phantom punctures', () => {
    for (const route of ['jump', 'adjacent'] as const) {
      const run = ride(42, 0);
      if (route === 'jump') { run.height = 2; run.velocityY = 2; }
      else { run.lane = -1; run.x = -LANE; }
      run.spawn('spikes', 0, 0);
      steps(run, 45);
      expect(run.phase).toBe('playing');
      expect(run.crashObstacle).toBeNull();
    }
  });

  it('freezes a queued puncture through pause and the resume countdown', () => {
    const run = ride(42, 0);
    const nails = run.spawn('spikes', 0, 0)!;
    steps(run, 1);
    run.pause();
    const before = [run.distance, nails.z, run.fixedTicks];
    steps(run, 120);
    expect([run.distance, nails.z, run.fixedTicks]).toEqual(before);
    run.resume();
    steps(run, 180);
    expect(run.phase).toBe('playing');
    expect([run.distance, nails.z, run.fixedTicks]).toEqual(before);
    steps(run, 25);
    expect(run.phase).toBe('crashed');
  });

  it('clears a queued puncture on revive and still permits only one total revive', () => {
    const run = ride(42, 0);
    run.spawn('spikes', 0, 0);
    steps(run, 1);
    run.crash('Traffic collision');
    expect(run.revive()).toBe(true);
    steps(run, 125);
    expect(run.phase).toBe('playing');
    run.crash('Traffic collision');
    expect(run.revive()).toBe(false);
    expect(run.reviveCount).toBe(1);
  });

  it('keeps center police-car collisions immediate and does not turn the blockade into a chase', () => {
    const hit = ride(42, 0), pass = ride(42, 0);
    const center = hit.spawn('car', 0, 0, 0, 0, true)!;
    center.roadblock = true;
    steps(hit, 1);
    expect(hit.phase).toBe('crashed');
    expect(hit.crashObstacle).toBe(center);
    pass.lane = -1; pass.x = -LANE;
    pass.wheelieAngle = 0.5;
    const car = pass.spawn('car', 0, 0, 0, 0, true)!;
    car.roadblock = true;
    steps(pass, 30);
    expect(car.passed).toBe(true);
    expect(pass.phase).toBe('playing');
    expect(pass.policeChase).toBe(false);
    car.active = false;
    expect(pass.spawn('car', 0, 145)!.roadblock).toBe(false);
  });

  it('replays queued punctures and generated waves identically at 30, 60 and 120 Hz', () => {
    const values = [30, 60, 120].map(fps => {
      const run = ride(42, 0);
      run.spawn('spikes', 0, 0);
      for (let frame = 0; frame < fps; frame++) run.advance(1 / fps);
      const generated = ride(37);
      generated.lane = 100; generated.x = 100 * LANE;
      for (let frame = 0; frame < fps * 12; frame++) generated.advance(1 / fps);
      return { phase: run.phase, distance: run.distance, ticks: run.fixedTicks,
        event: run.event, obstacles: generated.obstacles, signs: generated.signs,
        score: generated.score, generatedTicks: generated.fixedTicks };
    });
    expect(values[0]).toEqual(values[1]);
    expect(values[1]).toEqual(values[2]);
  });
});

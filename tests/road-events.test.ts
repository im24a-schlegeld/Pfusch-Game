import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine, LANE, STEP, type Obstacle } from '../app/game/engine';
import {
  ROAD_EVENTS,
  SURFACE_PROFILES,
  TRAFFIC_ENVIRONMENTS,
  isRoadEvent,
  roadResponse,
  type RoadEventKind,
} from '../app/game/roadEvents';
import { distanceAtTime, type WorldKind } from '../app/game/world';
import { TRAFFIC_SHAPES } from '../app/game/trafficDomain';
import { TRAFFIC_FLOW } from '../app/game/trafficFlow';

function ride(bike = BIKES[0], seed = 539) {
  const engine = new Engine(bike, seed);
  engine.start();
  return engine;
}
function steps(engine: Engine, count: number) {
  for (let i = 0; i < count; i++) engine.advance(STEP);
}
function clearance(obstacle: Obstacle, lane: number) {
  return (
    Math.abs(lane * LANE - (obstacle.lane * LANE + obstacle.offsetX)) -
    (isRoadEvent(obstacle.kind)
      ? ROAD_EVENTS[obstacle.kind].contactHalfWidth
      : TRAFFIC_SHAPES[obstacle.kind].contactHalfWidth)
  );
}

describe('bike-specific road contacts', () => {
  for (const bike of BIKES) {
    const profile = SURFACE_PROFILES[bike.id];
    it(`${bike.name}: the pothole requires front clearance, never a generic launch`, () => {
      const unprepared = ride(bike);
      unprepared.spawn('pothole', 0, 0);
      steps(unprepared, 1);
      expect(unprepared.phase).toBe('crashed');
      expect(unprepared.event.text).toBe('Caught the pothole edge');
      const lifted = ride(bike);
      lifted.wheelieAngle = profile.potholeClearance + 0.04;
      const pothole = lifted.spawn('pothole', 0, 0)!;
      steps(lifted, 1);
      expect(pothole.cleared).toBe(true);
      expect(lifted.phase).toBe('playing');
      expect([lifted.height, lifted.velocityY, lifted.jumps]).toEqual([
        0, 0, 0,
      ]);
      steps(lifted, 25);
      expect(pothole.passed).toBe(true);
      expect(lifted.event.text).toBe('CLEAN LIFT');
      const serial = lifted.event.serial;
      steps(lifted, 30);
      expect(lifted.event.serial).toBe(serial);
    });
    it(`${bike.name}: rough asphalt is passable, forward load absorbs its impact and earns one reward`, () => {
      const neutral = ride(bike),
        controlled = ride(bike);
      controlled.forward(true);
      controlled.forwardLoad = 1;
      const a = neutral.spawn('rough', 0, 0)!,
        b = controlled.spawn('rough', 0, 0)!;
      steps(neutral, 1);
      steps(controlled, 1);
      expect(neutral.roadRoughness).toBe(profile.roughness);
      expect(controlled.roadRoughness).toBeLessThan(neutral.roadRoughness);
      expect([a.cleared, b.cleared]).toEqual([true, true]);
      expect(a.rewardPoints).toBe(0);
      expect(b.rewardPoints).toBeGreaterThan(0);
      const initial = controlled.roadRoughness;
      steps(controlled, 1);
      expect(controlled.roadRoughness).toBeLessThan(initial);
      steps(neutral, 25);
      steps(controlled, 25);
      expect([neutral.phase, controlled.phase]).toEqual(['playing', 'playing']);
      expect(neutral.event.serial).toBe(0);
      expect(controlled.event.text).toBe('SMOOTH LINE');
      const serial = controlled.event.serial;
      steps(controlled, 45);
      expect(controlled.event.serial).toBe(serial);
      expect([
        controlled.height,
        controlled.velocityY,
        controlled.jumps,
      ]).toEqual([0, 0, 0]);
    });
    for (const kind of ['wet', 'gravel'] as const) {
      it(`${bike.name}: ${kind} punishes a high uncontrolled wheelie but accepts a forward catch`, () => {
        const safeAngle =
          kind === 'wet' ? profile.wetSafeAngle : profile.gravelSafeAngle;
        const high = ride(bike),
          caught = ride(bike),
          grounded = ride(bike);
        high.wheelieAngle = caught.wheelieAngle = safeAngle + 0.1;
        caught.forward(true);
        caught.forwardLoad = 1;
        high.spawn(kind, 0, 0);
        const correctedPatch = caught.spawn(kind, 0, 0)!;
        const ordinaryPatch = grounded.spawn(kind, 0, 0)!;
        for (const e of [high, caught, grounded]) steps(e, 1);
        expect(high.phase).toBe('crashed');
        expect(high.event.text).toMatch(/grip|traction/);
        expect([caught.phase, grounded.phase]).toEqual(['playing', 'playing']);
        expect(caught.surfaceGrip).toBe(
          kind === 'wet' ? profile.wetGrip : profile.gravelGrip,
        );
        expect(correctedPatch.rewardPoints).toBeGreaterThan(0);
        expect(ordinaryPatch.rewardPoints).toBe(0);
        steps(caught, 30);
        steps(grounded, 30);
        expect(caught.event.text).toBe('CAUGHT THE SLIP');
        expect(grounded.event.serial).toBe(0);
        const serial = caught.event.serial;
        steps(caught, 30);
        expect(caught.event.serial).toBe(serial);
        expect([caught.height, caught.velocityY, caught.jumps]).toEqual([
          0, 0, 0,
        ]);
      });
    }
  }
  it('keeps the intended relative surface tolerance instead of sharing one profile', () => {
    expect(
      Object.fromEntries(
        BIKES.map((b) => [b.id, SURFACE_PROFILES[b.id].potholeClearance]),
      ),
    ).toEqual({
      '125': 0.2,
      scooter: 0.23,
      '450': 0.12,
      '701': 0.18,
    });
    const impact = (id: string) => roadResponse('rough', id, 0, 0).roughness;
    expect(impact('450')).toBeLessThan(impact('125'));
    expect(impact('125')).toBeLessThan(impact('scooter'));
    expect(impact('scooter')).toBeLessThan(impact('701'));
    expect(SURFACE_PROFILES['450'].gravelGrip).toBeGreaterThan(
      SURFACE_PROFILES['701'].gravelGrip,
    );
  });
  it('applies actual grip to lane response, recovers, and freezes surface state during pause', () => {
    const sport = BIKES.find((bike) => bike.id === '701')!;
    const slippery = ride(sport),
      dry = ride(sport);
    slippery.spawn('wet', 0, 0);
    for (const engine of [slippery, dry]) {
      steps(engine, 1);
      engine.move(1);
      steps(engine, 6);
    }
    expect(slippery.x).toBeLessThan(dry.x);
    const grip = slippery.surfaceGrip;
    slippery.pause();
    const before = [
      slippery.distance,
      slippery.surfaceGrip,
      slippery.roadRoughness,
      slippery.environment.id,
    ];
    slippery.advance(10);
    expect([
      slippery.distance,
      slippery.surfaceGrip,
      slippery.roadRoughness,
      slippery.environment.id,
    ]).toEqual(before);
    slippery.resume();
    steps(slippery, 180);
    expect(slippery.surfaceGrip).toBeGreaterThan(grip);
    expect(slippery.surfaceGrip).toBeGreaterThan(0.995);
    expect(slippery.surfaceGrip).toBeLessThanOrEqual(1);
    expect(slippery.roadRoughness).toBeLessThan(0.001);
    expect(slippery.phase).toBe('playing');
  });
  it('does not touch a physical airborne rider or award near misses for passing beside flat patches', () => {
    for (const kind of [
      'pothole',
      'rough',
      'wet',
      'gravel',
    ] as RoadEventKind[]) {
      const airborne = ride();
      airborne.height = 0.4;
      const patch = airborne.spawn(kind, 0, 0)!;
      steps(airborne, 1);
      expect(patch.cleared).toBe(false);
      expect([airborne.roadRoughness, airborne.surfaceGrip]).toEqual([0, 1]);
      const adjacent = ride();
      adjacent.spawn(kind, 1, 0, -1.12);
      steps(adjacent, 30);
      expect(adjacent.phase).toBe('playing');
      expect(adjacent.nearMisses).toBe(0);
      expect(adjacent.event.serial).toBe(0);
    }
  });
  it('uses visible patch boundaries and preserves the raised-edge clearance/reward contract', () => {
    for (const shape of Object.values(ROAD_EVENTS)) {
      expect(shape.contactHalfWidth).toBeCloseTo(shape.width / 2 + 0.12);
      expect(shape.contactHalfLength).toBeCloseTo(shape.length / 2 + 1.25);
      expect(shape.height).toBeGreaterThan(0);
    }
    expect(ROAD_EVENTS.barrier.contactHalfLength).toBe(1.6);
    expect(roadResponse('barrier', '125', 0.17, 0).crash).not.toBeNull();
    expect(roadResponse('barrier', '125', 0.18, 0).rewardPoints).toBe(90);
    const engine = ride();
    engine.spawn('barrier', 1, 0, -1.12);
    steps(engine, 30);
    expect(engine.nearMisses).toBe(1);
  });
});

describe('world integration and readable traffic', () => {
  it('uses exact additive travel without overwriting explicit distance fixtures', () => {
    const engine = ride();
    engine.distance = 1200;
    steps(engine, 600);
    expect(engine.distance).toBeCloseTo(
      1200 + distanceAtTime(engine.elapsed, engine.bike),
      8,
    );
    expect(engine.world.at(engine.distance + 145)).toBeDefined();
    expect(engine.environment).toBe(engine.world.at(engine.distance));
  });
  it('surface responses and world state replay identically at 30, 60 and 120 Hz', () => {
    const values = [30, 60, 120].map((fps) => {
      const engine = ride(
        BIKES.find((bike) => bike.id === '450')!,
        752,
      );
      engine.spawn('gravel', 0, 0);
      engine.forward(true);
      for (let frame = 0; frame < fps * 4; frame++) engine.advance(1 / fps);
      return [
        engine.distance,
        engine.score,
        engine.surfaceGrip,
        engine.roadRoughness,
        engine.phase,
        engine.obstacles,
        engine.world.segments,
      ];
    });
    expect(values[0]).toEqual(values[1]);
    expect(values[1]).toEqual(values[2]);
  });
  it.each(BIKES)(
    '$name leaves a clean adjacent route and sufficient reaction time through many generated waves',
    (bike) => {
      const observedKinds = new Set<string>(),
        observedEnvironments = new Set<WorldKind>();
      let waves = 0;
      for (let seed = 1; seed <= 16; seed++) {
        const engine = ride(bike, seed);
        let reachable = [0],
          previousWaveExit = -Infinity;
        for (let frame = 0; frame < 12000; frame++) {
          engine.advance(STEP);
          const wave = engine.obstacles.filter((o) => o.active && o.z === 145);
          if (wave.length) {
            const environment = engine.world.at(
              engine.distance + wave[0].z,
            )!.kind;
            observedEnvironments.add(environment);
            expect(wave.length).toBeLessThanOrEqual(2);
            expect(wave[0].z / engine.bike.maxSpeed).toBeGreaterThan(3);
            // Predict actual bumper contact times from additive world travel,
            // independently of the generator's centre-arrival/gap helper.
            // Moving traffic may spawn less than 20 m after another wave yet
            // still leave more time to react than a distant stationary car.
            const contactTime = (obstacle: Obstacle, contactZ: number) => {
              const startDistance = distanceAtTime(engine.elapsed, bike);
              const relativeTravel = (seconds: number) =>
                distanceAtTime(engine.elapsed + seconds, bike) -
                startDistance -
                obstacle.velocity * seconds;
              const distance = obstacle.z - contactZ;
              let low = 0,
                high = 1;
              for (
                let expansion = 0;
                expansion < 8 && relativeTravel(high) < distance;
                expansion++
              )
                high *= 2;
              expect(relativeTravel(high)).toBeGreaterThanOrEqual(distance);
              for (let iteration = 0; iteration < 40; iteration++) {
                const middle = (low + high) / 2;
                if (relativeTravel(middle) < distance) low = middle;
                else high = middle;
              }
              return engine.elapsed + (low + high) / 2;
            };
            const firstContact = Math.min(
              ...wave.map((obstacle) =>
                contactTime(
                  obstacle,
                  isRoadEvent(obstacle.kind)
                    ? ROAD_EVENTS[obstacle.kind].contactHalfLength
                    : TRAFFIC_SHAPES[obstacle.kind].rearZ + 1,
                ),
              ),
            );
            if (Number.isFinite(previousWaveExit))
              expect(
                firstContact - previousWaveExit,
                `${bike.id} seed ${seed}: time between physical traffic envelopes`,
              ).toBeGreaterThanOrEqual(
                TRAFFIC_FLOW.reactionSeconds +
                  TRAFFIC_FLOW.laneChangeSeconds -
                  1e-6,
              );
            previousWaveExit = Math.max(
              ...wave.map((obstacle) =>
                contactTime(
                  obstacle,
                  isRoadEvent(obstacle.kind)
                    ? -ROAD_EVENTS[obstacle.kind].contactHalfLength
                    : TRAFFIC_SHAPES[obstacle.kind].frontZ - 1,
                ),
              ),
            );
            const safe = [-1, 0, 1].filter((lane) =>
              wave.every((o) => clearance(o, lane) > 0.1),
            );
            reachable = safe.filter((lane) =>
              reachable.some((previous) => Math.abs(lane - previous) <= 1),
            );
            expect(reachable.length).toBeGreaterThan(0);
            for (const o of wave) {
              observedKinds.add(o.kind);
              expect(o.z).toBeGreaterThan(143);
              expect(o.offsetX).toBe(0);
              // The occasional single-car wave is allowed in every environment.
              expect([
                ...TRAFFIC_ENVIRONMENTS[environment].kinds,
                'car',
              ]).toContain(o.kind);
            }
            waves++;
          }
          // Read the generator over long runs without inventing an invulnerability mode.
          // Contact behaviour is tested independently above with genuine engine steps.
          for (const obstacle of engine.obstacles)
            if (obstacle.z < 20) obstacle.active = false;
        }
        expect(engine.phase).toBe('playing');
        expect(engine.obstacles).toHaveLength(32);
      }
      expect(waves).toBeGreaterThan(500);
      expect([...observedKinds].sort()).toEqual([
        'car',
        'construction',
        'towtruck',
        'van',
      ]);
      expect(observedEnvironments.size).toBeGreaterThanOrEqual(9);
    },
    30000,
  );
  it('makes the center risk line optional and awards its actual offset near miss once', () => {
    for (const side of [-1, 1]) {
      const risk = ride(),
        safe = ride();
      safe.lane = -side;
      safe.x = -side * LANE;
      risk.spawn('car', side, 0, -side * 1.12);
      safe.spawn('car', side, 0, -side * 1.12);
      steps(risk, 30);
      steps(safe, 30);
      expect([risk.phase, safe.phase]).toEqual(['playing', 'playing']);
      expect(risk.nearMisses).toBe(1);
      expect(safe.nearMisses).toBe(0);
      steps(risk, 30);
      expect(risk.nearMisses).toBe(1);
    }
  });
});

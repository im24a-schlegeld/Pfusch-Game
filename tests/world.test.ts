import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import {
  World,
  WORLD_LOOK_AHEAD,
  WORLD_LOOK_BEHIND,
  WORLD_MAX_SEGMENTS,
  WORLD_TRANSITIONS,
  distanceAtTime,
  speedAtTime,
  timeAtDistance,
  segmentTunnelExposure,
  type WorldSegment,
} from '../app/game/world';

function sequence(seed: number, seconds = 2400, bike = BIKES[0]) {
  const world = new World(seed, bike);
  const seen = new Map<number, WorldSegment>();
  for (let time = 0; time <= seconds; time += 2) {
    world.advance(distanceAtTime(time, bike));
    for (const segment of world.segments) seen.set(segment.id, segment);
  }
  return [...seen.values()];
}

describe('exact road pace', () => {
  for (const bike of [
    ...BIKES,
    { acceleration: 0, maxSpeed: 41, name: 'constant' },
    { acceleration: 0.2, maxSpeed: 22, name: 'already capped' },
  ]) {
    it(`${bike.name}: distance and time are inverse before and after the speed cap`, () => {
      for (const time of [0, 1e-6, 1, 25, 90, 100, 400, 36000]) {
        const distance = distanceAtTime(time, bike);
        expect(timeAtDistance(distance, bike)).toBeCloseTo(time, 8);
        expect(speedAtTime(time, bike)).toBeGreaterThanOrEqual(22);
        expect(speedAtTime(time, bike)).toBeLessThanOrEqual(bike.maxSpeed);
      }
      const time = 50;
      const numericalSpeed =
        (distanceAtTime(time + 0.0001, bike) -
          distanceAtTime(time - 0.0001, bike)) /
        0.0002;
      expect(numericalSpeed).toBeCloseTo(speedAtTime(time, bike), 5);
    });
  }
  it('rejects invalid pace/time/distance rather than producing corrupt geometry', () => {
    expect(() => new World(NaN, BIKES[0])).toThrow(RangeError);
    for (const pace of [
      { acceleration: -1, maxSpeed: 30 },
      { acceleration: NaN, maxSpeed: 30 },
      { acceleration: 1, maxSpeed: 21 },
      { acceleration: 1, maxSpeed: Infinity },
    ])
      expect(() => new World(1, pace)).toThrow(RangeError);
    for (const value of [-1, NaN, Infinity]) {
      expect(() => distanceAtTime(value, BIKES[0])).toThrow(RangeError);
      expect(() => timeAtDistance(value, BIKES[0])).toThrow(RangeError);
    }
  });
});

describe('seeded road segments', () => {
  it('replays the same seed and composes different sequences for different seeds', () => {
    expect(sequence(951)).toEqual(sequence(951));
    expect(
      sequence(951).map((s) => [s.kind, s.end - s.start, s.lighting]),
    ).not.toEqual(
      sequence(952).map((s) => [s.kind, s.end - s.start, s.lighting]),
    );
  });
  it('is independent of advance frequency and read-only renderer lookups', () => {
    const sumo = BIKES.find((bike) => bike.id === '450')!;
    const regular = new World(175, sumo);
    const fastForward = new World(175, sumo);
    for (let distance = 0; distance <= 60000; distance += 20) {
      regular.advance(distance);
      for (let ahead = -48; ahead < 240; ahead += 12)
        regular.at(distance + ahead);
    }
    fastForward.advance(60000);
    expect(regular.segments).toEqual(fastForward.segments);
  });
  it('keeps contiguous logical transitions and bounded visible coverage over ten hours', () => {
    const sport = BIKES.find((bike) => bike.id === '701')!;
    const world = new World(419, sport);
    const kinds = new Set<string>();
    for (let time = 0; time <= 36000; time += 2) {
      const distance = distanceAtTime(time, sport);
      world.advance(distance);
      const segments = world.segments;
      expect(segments.length).toBeLessThanOrEqual(WORLD_MAX_SEGMENTS);
      expect(segments.length).toBeGreaterThan(0);
      expect(world.at(Math.max(0, distance - WORLD_LOOK_BEHIND))).toBeDefined();
      expect(world.at(distance)).toBeDefined();
      expect(world.at(distance + WORLD_LOOK_AHEAD)).toBeDefined();
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        kinds.add(segment.kind);
        expect(segment.end).toBeGreaterThan(segment.start);
        if (i === 0) continue;
        const previous = segments[i - 1];
        expect(segment.start).toBe(previous.end);
        expect(segment.startTime).toBe(previous.endTime);
        expect(segment.id).toBe(previous.id + 1);
        expect(WORLD_TRANSITIONS[previous.kind]).toContain(segment.kind);
        expect(segment.kind).not.toBe(previous.kind);
        if (segment.kind === 'tunnel')
          expect(previous.kind).toBe('tunnel-approach');
        if (previous.kind === 'tunnel')
          expect(segment.kind).toBe('tunnel-exit');
        if (segment.kind === 'bridge')
          expect(previous.kind).toBe('bridge-approach');
        if (previous.kind === 'bridge')
          expect(segment.kind).toBe('bridge-exit');
      }
    }
    expect(kinds.size).toBe(Object.keys(WORLD_TRANSITIONS).length);
    expect(world.at(0)).toBeUndefined();
    expect(world.at(NaN)).toBeUndefined();
    expect(() => world.advance(0)).toThrow(RangeError);
    expect(() => world.advance(Infinity)).toThrow(RangeError);
  }, 15000); // Ten simulated hours include ~200,000 assertions in the full worker pool.
  for (const bike of BIKES) {
    it(`${bike.name}: tunnels have continuously variable 5–60 second traversals in all duration bands`, () => {
      const tunnels = sequence(523, 15000, bike).filter(
        (s) => s.kind === 'tunnel',
      );
      const bands = new Set<number>();
      const durations = new Set<number>();
      for (const tunnel of tunnels) {
        const seconds =
          timeAtDistance(tunnel.end, bike) - timeAtDistance(tunnel.start, bike);
        expect(seconds).toBeGreaterThanOrEqual(5);
        expect(seconds).toBeLessThanOrEqual(60);
        expect(seconds).toBeCloseTo(tunnel.endTime - tunnel.startTime, 8);
        bands.add(seconds < 10 ? 0 : seconds < 20 ? 1 : seconds < 40 ? 2 : 3);
        durations.add(seconds);
        expect(tunnel.tunnel?.lightSpacing).toBeGreaterThanOrEqual(7);
        expect(tunnel.tunnel?.lightSpacing).toBeLessThan(14);
      }
      expect(bands.size).toBe(4);
      expect(durations.size).toBe(tunnels.length);
      expect(new Set(tunnels.map((s) => s.tunnel?.style)).size).toBe(2);
    });
  }
  it('exposure is zero outside real interiors and fades smoothly at both portals', () => {
    const tunnel = sequence(523).find((s) => s.kind === 'tunnel')!;
    expect(tunnel).toBeDefined();
    for (const distance of [
      tunnel.start - 1,
      tunnel.start,
      tunnel.end,
      tunnel.end + 1,
    ])
      expect(segmentTunnelExposure(tunnel, distance)).toBe(0);
    expect(segmentTunnelExposure(tunnel, tunnel.start + 7)).toBeCloseTo(0.5);
    expect(segmentTunnelExposure(tunnel, tunnel.end - 7)).toBeCloseTo(0.5);
    expect(segmentTunnelExposure(tunnel, (tunnel.start + tunnel.end) / 2)).toBe(
      1,
    );
    expect(segmentTunnelExposure(tunnel, tunnel.start + 0.001)).toBeLessThan(
      1e-7,
    );
    expect(segmentTunnelExposure(undefined, 100)).toBe(0);
    const world = new World(523, BIKES[0]);
    world.advance(tunnel.start + 7);
    expect(world.tunnelExposure(tunnel.start + 7)).toBeCloseTo(0.5);
    expect(world.tunnelExposure(tunnel.start - 1)).toBe(0);
  });
  it('starts in daylight, advances time of day at tunnel exits, and preserves bridge lighting', () => {
    const segments = sequence(523);
    expect(segments[0].lighting).toBe('day');
    expect(new Set(segments.map((s) => s.lighting)).size).toBe(4);
    for (let i = 1; i < segments.length; i++) {
      const segment = segments[i],
        previous = segments[i - 1];
      if (segment.kind === 'tunnel-exit')
        expect(segment.lighting).not.toBe(previous.lighting);
      if (
        segment.kind.startsWith('bridge') ||
        segment.kind === 'tunnel' ||
        segment.kind === 'tunnel-approach'
      )
        expect(segment.lighting).toBe(previous.lighting);
    }
  });
});

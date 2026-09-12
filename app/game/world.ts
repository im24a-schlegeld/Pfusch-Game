export const WORLD_LOOK_BEHIND = 48;
export const WORLD_LOOK_AHEAD = 240;
// Every segment lasts at least 2.5 seconds at a minimum 22 m/s. The retained
// interval therefore intersects at most eight segments, including its edges.
export const WORLD_MAX_SEGMENTS = 8;
const INITIAL_SPEED = 22;

export type WorldKind =
  | 'city'
  | 'industrial'
  | 'construction'
  | 'open'
  | 'waterfront'
  | 'tunnel-approach'
  | 'tunnel'
  | 'tunnel-exit'
  | 'bridge-approach'
  | 'bridge'
  | 'bridge-exit';
export type WorldLighting = 'day' | 'golden' | 'night' | 'dawn';
export interface WorldPace {
  readonly acceleration: number;
  readonly maxSpeed: number;
}
export interface WorldSegment {
  readonly id: number;
  readonly kind: WorldKind;
  readonly start: number;
  readonly end: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly lighting: WorldLighting;
  readonly variant: number;
  readonly tunnel?: {
    readonly style: 'modern' | 'weathered';
    readonly lightSpacing: number;
  };
}

/** Repeated entries are selection weights; all interiors have real transitions. */
export const WORLD_TRANSITIONS: Readonly<
  Record<WorldKind, readonly WorldKind[]>
> = {
  city: [
    'industrial',
    'industrial',
    'open',
    'construction',
    'waterfront',
    'tunnel-approach',
  ],
  industrial: [
    'construction',
    'city',
    'open',
    'tunnel-approach',
    'tunnel-approach',
  ],
  construction: ['industrial', 'city', 'open'],
  open: [
    'city',
    'industrial',
    'waterfront',
    'tunnel-approach',
    'bridge-approach',
  ],
  waterfront: ['open', 'city', 'bridge-approach', 'bridge-approach'],
  'tunnel-approach': ['tunnel'],
  tunnel: ['tunnel-exit'],
  'tunnel-exit': ['open', 'city', 'industrial', 'waterfront'],
  'bridge-approach': ['bridge'],
  bridge: ['bridge-exit'],
  'bridge-exit': ['open', 'waterfront', 'industrial'],
};
const LIGHTING: readonly WorldLighting[] = ['day', 'golden', 'night', 'dawn'];
const DURATIONS: Readonly<
  Record<Exclude<WorldKind, 'tunnel'>, readonly [number, number]>
> = {
  city: [8, 16],
  industrial: [7, 14],
  construction: [5, 9],
  open: [10, 20],
  waterfront: [8, 18],
  'tunnel-approach': [3, 5],
  'tunnel-exit': [2.5, 4],
  'bridge-approach': [3, 5],
  bridge: [10, 24],
  'bridge-exit': [2.5, 4],
};

function validatePace(pace: WorldPace) {
  if (
    !Number.isFinite(pace.acceleration) ||
    pace.acceleration < 0 ||
    !Number.isFinite(pace.maxSpeed) ||
    pace.maxSpeed < INITIAL_SPEED
  )
    throw new RangeError(
      'World pace needs finite nonnegative acceleration and maxSpeed >= 22.',
    );
}
function nonnegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${label} must be finite and nonnegative.`);
}

export function speedAtTime(time: number, pace: WorldPace) {
  nonnegative(time, 'Time');
  validatePace(pace);
  return Math.min(pace.maxSpeed, INITIAL_SPEED + pace.acceleration * time);
}

/** Exact integral of the game's capped acceleration schedule, in metres. */
export function distanceAtTime(time: number, pace: WorldPace) {
  nonnegative(time, 'Time');
  validatePace(pace);
  if (pace.acceleration === 0) return INITIAL_SPEED * time;
  const capTime = (pace.maxSpeed - INITIAL_SPEED) / pace.acceleration;
  const accelerating = Math.min(time, capTime);
  return (
    INITIAL_SPEED * accelerating +
    0.5 * pace.acceleration * accelerating * accelerating +
    pace.maxSpeed * Math.max(0, time - capTime)
  );
}

/** Stable inverse of distanceAtTime, including zero acceleration and the cap. */
export function timeAtDistance(distance: number, pace: WorldPace) {
  nonnegative(distance, 'Distance');
  validatePace(pace);
  if (pace.acceleration === 0) return distance / INITIAL_SPEED;
  const capTime = (pace.maxSpeed - INITIAL_SPEED) / pace.acceleration;
  const capDistance = (INITIAL_SPEED + pace.maxSpeed) * 0.5 * capTime;
  if (distance >= capDistance)
    return capTime + (distance - capDistance) / pace.maxSpeed;
  return (
    (2 * distance) /
    (INITIAL_SPEED +
      Math.sqrt(INITIAL_SPEED ** 2 + 2 * pace.acceleration * distance))
  );
}

/** Pure entry/exit fade; callers use the same segment for roofs, lights and sound. */
export function segmentTunnelExposure(
  segment: WorldSegment | undefined,
  distance: number,
) {
  if (
    !segment ||
    segment.kind !== 'tunnel' ||
    !Number.isFinite(distance) ||
    distance <= segment.start ||
    distance >= segment.end
  )
    return 0;
  const fade = Math.min(14, (segment.end - segment.start) / 4);
  const t = Math.min(
    1,
    (distance - segment.start) / fade,
    (segment.end - distance) / fade,
  );
  return t * t * (3 - 2 * t);
}

/** Bounded deterministic domain state. Its RNG never consumes traffic random values. */
export class World {
  readonly pace: WorldPace;
  private rng: number;
  private retained: WorldSegment[] = [];
  private tail: WorldSegment;
  private distance = 0;

  constructor(seed: number, pace: WorldPace) {
    if (!Number.isFinite(seed))
      throw new RangeError('World seed must be finite.');
    validatePace(pace);
    this.pace = Object.freeze({
      acceleration: pace.acceleration,
      maxSpeed: pace.maxSpeed,
    });
    this.rng = seed >>> 0;
    this.tail = this.makeSegment('city');
    this.retained.push(this.tail);
    this.advance(0);
  }

  get segments(): readonly WorldSegment[] {
    return this.retained;
  }

  /** Advance only with simulation distance, never render time or wall-clock time. */
  advance(distance: number) {
    nonnegative(distance, 'Distance');
    if (distance < this.distance)
      throw new RangeError('World distance cannot move backward.');
    this.distance = distance;
    this.prune();
    while (this.tail.end <= distance + WORLD_LOOK_AHEAD) {
      const choices = WORLD_TRANSITIONS[this.tail.kind];
      const next = choices[Math.floor(this.random() * choices.length)];
      this.tail = this.makeSegment(next, this.tail);
      this.retained.push(this.tail);
      // Prune during large advances too, so fast-forward cannot grow the queue.
      this.prune();
    }
  }

  /** Read-only lookup. Negative scenery coordinates and expired data have no segment. */
  at(distance: number): WorldSegment | undefined {
    if (!Number.isFinite(distance) || distance < 0) return undefined;
    return this.retained.find(
      (segment) => distance >= segment.start && distance < segment.end,
    );
  }

  tunnelExposure(distance: number) {
    return segmentTunnelExposure(this.at(distance), distance);
  }

  private prune() {
    while (
      this.retained.length &&
      this.retained[0].end <= this.distance - WORLD_LOOK_BEHIND
    )
      this.retained.shift();
  }

  private random() {
    this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  private makeSegment(kind: WorldKind, previous?: WorldSegment): WorldSegment {
    let range: readonly [number, number];
    if (kind === 'tunnel') {
      const weight = this.random();
      range =
        weight < 0.35
          ? [5, 10]
          : weight < 0.7
            ? [10, 20]
            : weight < 0.94
              ? [20, 40]
              : [40, 60];
    } else range = DURATIONS[kind];
    const duration = range[0] + this.random() * (range[1] - range[0]);
    const start = previous?.end ?? 0;
    const startTime = previous?.endTime ?? 0;
    const endTime = startTime + duration;
    let lighting = previous?.lighting ?? 'day';
    // A tunnel can conceal a meaningful time change. Outdoor changes occur only
    // between environments; the renderer blends their adjacent lighting states.
    if (
      previous &&
      (kind === 'tunnel-exit' ||
        (!kind.startsWith('tunnel') &&
          !kind.startsWith('bridge') &&
          this.random() < 0.13))
    )
      lighting = LIGHTING[(LIGHTING.indexOf(lighting) + 1) % LIGHTING.length];
    return Object.freeze({
      id: (previous?.id ?? -1) + 1,
      kind,
      start,
      end: distanceAtTime(endTime, this.pace),
      startTime,
      endTime,
      lighting,
      variant: Math.floor(this.random() * 4),
      ...(kind === 'tunnel'
        ? {
            tunnel: Object.freeze({
              style:
                this.random() < 0.5
                  ? ('modern' as const)
                  : ('weathered' as const),
              lightSpacing: 7 + this.random() * 7,
            }),
          }
        : {}),
    });
  }
}

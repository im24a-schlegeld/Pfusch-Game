import type { WorldKind } from './world';

export type RoadEventKind = 'barrier' | 'pothole' | 'rough' | 'gravel' | 'wet';
export interface RoadEventShape {
  readonly width: number;
  readonly length: number;
  readonly height: number;
  readonly contactHalfWidth: number;
  readonly contactHalfLength: number;
}
function shape(width: number, length: number, height: number): RoadEventShape {
  return Object.freeze({
    width,
    length,
    height,
    // Road contact tests include the tire and the longitudinal wheel contact span.
    contactHalfWidth: width / 2 + 0.12,
    contactHalfLength: length / 2 + 1.25,
  });
}
/** Metres. Render the visible patch from these same dimensions as its contact test. */
export const ROAD_EVENTS: Readonly<Record<RoadEventKind, RoadEventShape>> = {
  barrier: shape(2, 0.7, 0.16),
  pothole: shape(2, 2.6, 0.045),
  rough: shape(2.15, 4, 0.035),
  gravel: shape(2.2, 4, 0.045),
  wet: shape(2.15, 4.8, 0.012),
};
export const ROAD_EVENT_KINDS = Object.keys(ROAD_EVENTS) as RoadEventKind[];
export function isRoadEvent(kind: string): kind is RoadEventKind {
  return Object.hasOwn(ROAD_EVENTS, kind);
}

export interface SurfaceProfile {
  readonly potholeClearance: number;
  readonly roughness: number;
  readonly wetGrip: number;
  readonly gravelGrip: number;
  readonly wetSafeAngle: number;
  readonly gravelSafeAngle: number;
}
/** Grip remains controllable; every generated patch also leaves a clean route. */
export const SURFACE_PROFILES: Readonly<Record<string, SurfaceProfile>> = {
  '125': {
    potholeClearance: 0.2,
    roughness: 0.5,
    wetGrip: 0.7,
    gravelGrip: 0.65,
    wetSafeAngle: 0.5,
    gravelSafeAngle: 0.44,
  },
  scooter: {
    potholeClearance: 0.23,
    roughness: 0.59,
    wetGrip: 0.72,
    gravelGrip: 0.62,
    wetSafeAngle: 0.52,
    gravelSafeAngle: 0.42,
  },
  '450': {
    potholeClearance: 0.12,
    roughness: 0.3,
    wetGrip: 0.76,
    gravelGrip: 0.8,
    wetSafeAngle: 0.68,
    gravelSafeAngle: 0.62,
  },
  '701': {
    potholeClearance: 0.18,
    roughness: 0.68,
    wetGrip: 0.6,
    gravelGrip: 0.58,
    wetSafeAngle: 0.46,
    gravelSafeAngle: 0.4,
  },
};
export const FORWARD_SURFACE_CONTROL = 0.4;
export interface RoadResponse {
  readonly crash: string | null;
  readonly roughness: number;
  readonly grip: number;
  readonly rewardPoints: number;
  readonly rewardText: string;
}
/** Called once per actual tire contact, independent of rendering or input device. */
export function roadResponse(
  kind: RoadEventKind,
  bikeId: string,
  angle: number,
  forwardLoad: number,
): RoadResponse {
  const profile = SURFACE_PROFILES[bikeId] ?? SURFACE_PROFILES['450'];
  const controlled = forwardLoad >= FORWARD_SURFACE_CONTROL;
  if (kind === 'barrier' || kind === 'pothole') {
    const cleared =
      kind === 'barrier' ? angle > 0.17 : angle >= profile.potholeClearance;
    return {
      crash: cleared
        ? null
        : kind === 'barrier'
          ? 'Caught the raised road edge'
          : 'Caught the pothole edge',
      roughness: cleared ? profile.roughness * 0.2 : 0,
      grip: 1,
      rewardPoints: cleared ? 90 : 0,
      rewardText: 'CLEAN LIFT',
    };
  }
  if (kind === 'rough')
    return {
      crash: null,
      roughness: profile.roughness * (controlled ? 0.6 : 1),
      grip: 1,
      rewardPoints: controlled ? 60 : 0,
      rewardText: 'SMOOTH LINE',
    };
  const high =
    angle > (kind === 'wet' ? profile.wetSafeAngle : profile.gravelSafeAngle);
  return {
    crash:
      high && !controlled
        ? kind === 'wet'
          ? 'Lost rear grip on wet asphalt'
          : 'Lost traction on loose gravel'
        : null,
    roughness:
      kind === 'gravel' ? profile.roughness * 0.65 : profile.roughness * 0.12,
    grip: kind === 'wet' ? profile.wetGrip : profile.gravelGrip,
    rewardPoints: high && controlled ? 90 : 0,
    rewardText: 'CAUGHT THE SLIP',
  };
}

export interface TrafficEnvironment {
  readonly doubleChance: number;
  readonly minimumSpacing: number;
  readonly initialSpacing: number;
  readonly kinds: readonly ('car' | 'van' | RoadEventKind)[];
}
const city: TrafficEnvironment = {
  doubleChance: 0.58,
  minimumSpacing: 56,
  initialSpacing: 78,
  kinds: ['car', 'car', 'car', 'van', 'pothole', 'wet'],
};
const industrial: TrafficEnvironment = {
  doubleChance: 0.52,
  minimumSpacing: 60,
  initialSpacing: 86,
  kinds: ['van', 'van', 'car', 'barrier', 'rough', 'gravel'],
};
const open: TrafficEnvironment = {
  doubleChance: 0.25,
  minimumSpacing: 80,
  initialSpacing: 110,
  kinds: ['car', 'car', 'van', 'rough', 'gravel'],
};
const tunnel: TrafficEnvironment = {
  doubleChance: 0.38,
  minimumSpacing: 66,
  initialSpacing: 92,
  kinds: ['car', 'car', 'van', 'rough'],
};
export const TRAFFIC_ENVIRONMENTS: Readonly<
  Record<WorldKind, TrafficEnvironment>
> = {
  city,
  industrial,
  construction: {
    doubleChance: 0.48,
    minimumSpacing: 64,
    initialSpacing: 90,
    kinds: ['barrier', 'barrier', 'rough', 'gravel', 'van'],
  },
  open,
  waterfront: {
    doubleChance: 0.3,
    minimumSpacing: 74,
    initialSpacing: 100,
    kinds: ['car', 'van', 'wet', 'wet', 'pothole'],
  },
  'tunnel-approach': tunnel,
  tunnel,
  'tunnel-exit': tunnel,
  'bridge-approach': open,
  bridge: { ...open, kinds: ['car', 'car', 'van', 'wet'] },
  'bridge-exit': open,
};

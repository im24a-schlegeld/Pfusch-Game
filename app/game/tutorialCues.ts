import type { TutorialHint } from '../domain/types';
import { LANE, type Engine } from './engine';
import { TOW_RAMP, TRAFFIC_SHAPES, trafficFrontReach, type TrafficKind } from './trafficDomain';
import { ROAD_EVENTS } from './roadEvents';

export type TutorialCueId = 'ramp' | 'police' | 'radar' | 'traffic' | 'signs';
export interface TutorialCue { id: TutorialCueId; x: number; y: number }
export interface TutorialTarget {
  id: TutorialCueId;
  source: 'obstacle' | 'sign' | 'radar' | 'pursuit';
  index: number;
  x: number;
  y: number;
  z: number;
}
export interface TutorialProjection {
  /** Normalized viewport coordinates, before any UI positioning/clamping. */
  x: number;
  y: number;
  /** Positive camera-space depth and projected clip-space depth. */
  depth: number;
  clipZ: number;
}
type Observation = Pick<Engine,
  'phase' | 'resumeRemaining' | 'speed' | 'distance' | 'elapsed' | 'height' |
  'onTowTruck' | 'x' | 'bike' | 'wheelieAngle' | 'obstacles' | 'signs' |
  'speedCamera' | 'policeChase' | 'policeRamRemaining' | 'policeVehicle'>;

function obstructionShape(kind: string) {
  if (kind === 'barrier' || kind === 'ramp') {
    const plate = ROAD_EVENTS[kind];
    return { ...plate, frontZ: -plate.length / 2, rearZ: plate.length / 2 };
  }
  return TRAFFIC_SHAPES[kind as TrafficKind];
}

/** Reject behind-camera, clipped and edge-of-screen targets rather than clamp. */
export function visibleTutorialProjection(point: TutorialProjection | null): point is TutorialProjection {
  return !!point && Object.values(point).every(Number.isFinite) && point.depth > .1 &&
    point.clipZ >= -1 && point.clipZ <= 1 &&
    point.x >= .07 && point.x <= .93 && point.y >= .12 && point.y <= .82;
}

/** Read-only: do not interrupt an airborne maneuver or an imminent collision. */
export function safeTutorialWindow(state: Observation) {
  if (state.phase !== 'playing' || state.resumeRemaining > 0 ||
      state.height > .05 || state.onTowTruck ||
      (state.policeChase && state.policeRamRemaining < 6)) return false;
  const reach = trafficFrontReach(state.bike.id, state.wheelieAngle);
  return !state.obstacles.some((obstacle) => {
    if (!obstacle.active || obstacle.passed) return false;
    const shape = obstructionShape(obstacle.kind);
    if (!shape || Math.abs(obstacle.lane * LANE + obstacle.offsetX - state.x) > shape.width / 2 + .6)
      return false;
    const ahead = obstacle.z - shape.rearZ - reach;
    return obstacle.z > shape.frontZ && ahead < Math.max(10, (state.speed - obstacle.velocity) * 1.5);
  });
}

/** Select the closest useful, unseen encounter from the bounded engine pools. */
export function selectTutorialCue(
  state: Observation,
  seen: readonly TutorialHint[],
  project: (target: TutorialTarget) => TutorialProjection | null,
): TutorialCue | null {
  if (!safeTutorialWindow(state)) return null;
  let result: TutorialCue | null = null;
  let nearest = Infinity;
  const consider = (target: TutorialTarget, ahead: number, closingSpeed: number) => {
    if (seen.includes(target.id) || !Number.isFinite(ahead) || !Number.isFinite(closingSpeed) ||
        ahead < Math.max(14, closingSpeed * 1.8) ||
        // A fixed 75 m limit leaves less than 150 ms at the 140 km/h speed cap.
        // Extend the visible look-ahead so even fast approaches get a window.
        ahead > Math.min(125, Math.max(75, closingSpeed * 2.8)) || ahead >= nearest) return;
    const point = project(target);
    if (!visibleTutorialProjection(point)) return;
    nearest = ahead;
    result = { id: target.id, x: point.x, y: point.y };
  };
  state.obstacles.forEach((obstacle, index) => {
    // Construction ramps launch automatically; the tow-truck swipe tutorial
    // does not apply, but their approach still blocks unrelated interruptions.
    if (!obstacle.active || obstacle.passed || obstacle.rampUsed || obstacle.kind === 'ramp') return;
    const shape = obstructionShape(obstacle.kind);
    if (!shape) return;
    const ramp = obstacle.kind === 'towtruck';
    consider({
      id: obstacle.police ? 'police' : ramp ? 'ramp' : 'traffic',
      source: 'obstacle', index,
      x: obstacle.lane * LANE + obstacle.offsetX,
      y: ramp ? .62 : shape.height * .65,
      z: -obstacle.z + (ramp ? (TOW_RAMP.frontZ + TOW_RAMP.rearZ) / 2 : 0),
    }, obstacle.z - shape.rearZ, Math.max(0, state.speed - obstacle.velocity));
  });
  state.signs.forEach((sign, index) => {
    if (!sign.active) return;
    consider({ id: 'signs', source: 'sign', index, x: sign.lane * LANE,
      y: 1.34 + Math.sin(state.elapsed * 2 + index * .7) * .05, z: -sign.z }, sign.z, state.speed);
  });
  const radar = state.speedCamera;
  if (radar.active && !radar.triggered) {
    const ahead = radar.distance - state.distance;
    consider({ id: 'radar', source: 'radar', index: 0,
      x: radar.side * 6.35, y: 2.05, z: -ahead }, ahead, state.speed);
  }
  const police = state.policeVehicle;
  // The pursuing vehicle normally stays behind the actual camera. Its state
  // alone is not a visible target; only an approaching visible model qualifies.
  if (police.visible && police.phase !== 'wrecked')
    consider({ id: 'police', source: 'pursuit', index: 0,
      x: police.x, y: police.y + 1.3, z: -police.z }, police.z, Math.max(0, state.speed - police.velocity));
  return result;
}

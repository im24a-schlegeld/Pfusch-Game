import type { Obstacle } from './engine';
import { isRoadEvent, ROAD_EVENTS } from './roadEvents';
import { TRAFFIC_SHAPES, TOW_RAMP, towRampHeight } from './trafficDomain';

export const POLICE = Object.freeze({
  chaseSeconds: 22,
  followZ: -12,
  ramZ: -4.35,
  escapeClosingSpeed: 38,
  visibleImpactZ: 5,
  escapeSeconds: 12,
  retireZ: -48,
  lateralSpeed: 4.8,
  encounterCooldownSeconds: 12,
});

/** Separate from the NPC pool: no recycled car can become the pursuing car. */
export interface PoliceVehicleState {
  phase: 'idle' | 'chasing' | 'approach' | 'wrecked' | 'ramming';
  visible: boolean;
  x: number;
  z: number;
  y: number;
  pitch: number;
  yaw: number;
  roll: number;
  velocity: number;
  age: number;
}

export function createPoliceVehicle(): PoliceVehicleState {
  return {
    phase: 'idle',
    visible: false,
    x: 0,
    z: POLICE.followZ,
    y: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    velocity: 0,
    age: 0,
  };
}

export function policeTargetShape(obstacle: Obstacle) {
  if (isRoadEvent(obstacle.kind)) {
    if (obstacle.kind !== 'barrier') return null;
    const shape = ROAD_EVENTS.barrier;
    return {
      width: shape.width,
      rearZ: shape.length / 2,
      frontZ: -shape.length / 2,
    };
  }
  return TRAFFIC_SHAPES[obstacle.kind];
}

/** Swept car body vs actual traffic bodies, including the whole lane transition. */
export function firstPoliceHit(
  obstacles: readonly Obstacle[],
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  ignore: Obstacle | null = null,
) {
  const car = TRAFFIC_SHAPES.car;
  let first: { obstacle: Obstacle; fraction: number } | null = null;
  for (const obstacle of obstacles) {
    if (!obstacle.active || obstacle === ignore) continue;
    const shape = policeTargetShape(obstacle);
    if (!shape) continue;
    const centerX = obstacle.lane * 2.8 + obstacle.offsetX;
    const halfWidth = (shape.width + car.width) / 2 + 0.04;
    const low = [
      centerX - halfWidth,
      obstacle.z - shape.rearZ + car.frontZ - 0.04,
    ];
    const high = [
      centerX + halfWidth,
      obstacle.z - shape.frontZ + car.rearZ + 0.04,
    ];
    const origin = [fromX, fromZ],
      delta = [toX - fromX, toZ - fromZ];
    let enter = 0,
      leave = 1;
    for (let axis = 0; axis < 2; axis++) {
      if (Math.abs(delta[axis]) < 1e-9) {
        if (origin[axis] < low[axis] || origin[axis] > high[axis]) {
          enter = 2;
          break;
        }
      } else {
        const a = (low[axis] - origin[axis]) / delta[axis];
        const b = (high[axis] - origin[axis]) / delta[axis];
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (enter <= leave && enter <= 1 && (!first || enter < first.fraction))
      first = { obstacle, fraction: enter };
  }
  return first;
}

/** Center separation at bumper contact; a tow truck catches the car on its ramp. */
export function policeImpactOffset(target: Obstacle) {
  if (target.kind === 'towtruck') return -4.8;
  return TRAFFIC_SHAPES.car.frontZ - policeTargetShape(target)!.rearZ - 0.02;
}

/** Where bumper contact will occur if the police catches up at its surge speed. */
export function policeCatchPosition(
  target: Obstacle,
  fromZ: number,
  riderSpeed: number,
) {
  const contactZ = target.z + policeImpactOffset(target);
  const closingSpeed = Math.max(
    1,
    riderSpeed + POLICE.escapeClosingSpeed - target.velocity,
  );
  const seconds = Math.max(0, contactZ - fromZ) / closingSpeed;
  return contactZ - (riderSpeed - target.velocity) * seconds;
}

/** Both police axles follow the ramp; never sink a car through the loading bed. */
export function policeRampPose(localZ: number) {
  const support = (z: number) => (z > TOW_RAMP.rearZ ? 0 : towRampHeight(z));
  const front = support(localZ - 1.9),
    rear = support(localZ + 1.9);
  return { y: (front + rear) / 2, pitch: Math.atan2(front - rear, 3.8) };
}

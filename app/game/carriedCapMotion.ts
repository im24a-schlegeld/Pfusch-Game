import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';

export interface CarriedCapMotionInput {
  /** Signed m/s². Forward travel is world -Z; right is world +X. */
  longitudinalAcceleration?: number;
  lateralAcceleration?: number;
  /** Normalized landing envelope. Only an increase adds an impulse. */
  landing?: number;
  paused?: boolean;
  reducedMotion?: boolean;
}

const STEP = 1 / 120;
const MAX_FRAME = 1 / 12;
const MAX_SWING = 0.4;
const MAX_SPEED = 3;
const STIFFNESS = 78;
const DAMPING = 8.8;

const finiteClamp = (value: number | undefined, low: number, high: number) =>
  Number.isFinite(value) ? Math.max(low, Math.min(high, value!)) : 0;

/**
 * Controls only a dedicated hanging pivot's quaternion. Its initial local -Y
 * axis is the clip-to-cap direction; put the cap's authored rest pose and offset
 * in a child. The attachment position, child transform and skeleton stay fixed.
 *
 * Call update after the bike/parent pose has changed. Gravity is transformed
 * through the actual parent world matrix, including any nonuniform scale.
 * reset establishes the initial gravity hang without needing a simulation tick.
 */
export function createCarriedCapMotion(pivot: Object3D) {
  const rest = pivot.quaternion.clone().normalize();
  const restDown = new Vector3(0, -1, 0).applyQuaternion(rest);
  const localDirection = new Vector3();
  const worldDirection = new Vector3(0, -1, 0);
  const parentInverse = new Matrix4();
  const alignment = new Quaternion();
  let lateralAngle = 0;
  let longitudinalAngle = 0;
  let lateralSpeed = 0;
  let longitudinalSpeed = 0;
  let remainder = 0;
  let previousLanding = 0;

  const apply = () => {
    const angle = Math.hypot(lateralAngle, longitudinalAngle);
    const sineScale = angle > 1e-8 ? Math.sin(angle) / angle : 1;
    worldDirection.set(
      lateralAngle * sineScale,
      -Math.cos(angle),
      longitudinalAngle * sineScale,
    );
    localDirection.copy(worldDirection);
    if (pivot.parent) {
      pivot.parent.updateWorldMatrix(true, false);
      const matrix = pivot.parent.matrixWorld;
      const determinant = matrix.determinant();
      if (
        !matrix.elements.every(Number.isFinite) ||
        !Number.isFinite(determinant) ||
        Math.abs(determinant) < 1e-10
      )
        return;
      parentInverse.copy(matrix).invert();
      localDirection.transformDirection(parentInverse);
    }
    alignment.setFromUnitVectors(restDown, localDirection);
    pivot.quaternion.copy(alignment).multiply(rest).normalize();
  };

  const clear = () => {
    lateralAngle = longitudinalAngle = 0;
    lateralSpeed = longitudinalSpeed = 0;
    remainder = 0;
  };

  const reset = () => {
    clear();
    previousLanding = 0;
    apply();
  };

  const update = (input: CarriedCapMotionInput, dt: number) => {
    // Pausing and zero/invalid time freeze both simulation and rendered pose.
    if (input.paused || !Number.isFinite(dt) || dt <= 0) return;
    const landing = finiteClamp(input.landing, 0, 1);
    if (input.reducedMotion) {
      clear();
      previousLanding = landing;
      apply();
      return;
    }

    const targetLateral = finiteClamp(
      Math.atan2(-finiteClamp(input.lateralAcceleration, -30, 30), 9.81),
      -0.28,
      0.28,
    );
    const targetLongitudinal = finiteClamp(
      Math.atan2(finiteClamp(input.longitudinalAcceleration, -30, 30), 9.81),
      -0.34,
      0.34,
    );
    longitudinalSpeed += Math.max(0, landing - previousLanding) * 0.7;
    previousLanding = landing;
    remainder += Math.min(dt, MAX_FRAME);
    // At most ten small fixed steps; discarded wall-clock stalls never produce
    // a catch-up teleport. Retained fractional time keeps 30/60/120 Hz identical.
    while (remainder + 1e-10 >= STEP) {
      remainder = Math.max(0, remainder - STEP);
      lateralSpeed +=
        ((targetLateral - lateralAngle) * STIFFNESS - lateralSpeed * DAMPING) *
        STEP;
      longitudinalSpeed +=
        ((targetLongitudinal - longitudinalAngle) * STIFFNESS -
          longitudinalSpeed * DAMPING) *
        STEP;
      const speed = Math.hypot(lateralSpeed, longitudinalSpeed);
      if (speed > MAX_SPEED) {
        lateralSpeed *= MAX_SPEED / speed;
        longitudinalSpeed *= MAX_SPEED / speed;
      }
      lateralAngle += lateralSpeed * STEP;
      longitudinalAngle += longitudinalSpeed * STEP;
      const angle = Math.hypot(lateralAngle, longitudinalAngle);
      if (angle > MAX_SWING) {
        const x = lateralAngle / angle,
          z = longitudinalAngle / angle;
        lateralAngle = x * MAX_SWING;
        longitudinalAngle = z * MAX_SWING;
        // Remove only outward velocity at the cone limit, preserving the
        // tangential swing and allowing the cap to return without sticking.
        const outward = Math.max(0, lateralSpeed * x + longitudinalSpeed * z);
        lateralSpeed -= outward * x;
        longitudinalSpeed -= outward * z;
      }
    }
    apply();
  };

  reset();
  return { update, reset };
}

import { TAIL_CONTACT, TAIL_RECOVERY_ANGLE } from './tailContact';
export interface BalanceProfile {
  balancePoint: number;
  balanceWidth: number;
  throttleTorque: number;
  launchTorque: number;
  forwardWeightTorque: number;
  gravity: number;
  damping: number;
  crashAngle: number;
}

// Radians and angular acceleration in the fixed-step domain. Gravity changes
// sign at the balance point: this is an unstable equilibrium, never a lock.
export const BALANCE: Record<string, BalanceProfile> = {
  '125': {
    balancePoint: 0.72,
    balanceWidth: 0.16,
    throttleTorque: 2.35,
    launchTorque: 3.8,
    forwardWeightTorque: 3.1,
    gravity: 3,
    damping: 1.5,
    crashAngle: TAIL_CONTACT['125'].angle + TAIL_RECOVERY_ANGLE,
  },
  scooter: {
    balancePoint: 0.75,
    balanceWidth: 0.2,
    throttleTorque: 2.75,
    launchTorque: 4.5,
    forwardWeightTorque: 3.65,
    gravity: 3.1,
    damping: 1.65,
    crashAngle: TAIL_CONTACT.scooter.angle + TAIL_RECOVERY_ANGLE,
  },
  '450': {
    balancePoint: 0.8,
    balanceWidth: 0.24,
    throttleTorque: 3.35,
    launchTorque: 5.5,
    forwardWeightTorque: 4.1,
    gravity: 3.2,
    damping: 1.6,
    crashAngle: TAIL_CONTACT['450'].angle + TAIL_RECOVERY_ANGLE,
  },
  '701': {
    balancePoint: 0.7,
    balanceWidth: 0.17,
    throttleTorque: 4.65,
    launchTorque: 7.2,
    forwardWeightTorque: 5.2,
    gravity: 4,
    damping: 1.3,
    crashAngle: TAIL_CONTACT['701'].angle + TAIL_RECOVERY_ANGLE,
  },
};
export interface BalanceState {
  wheelieAngle: number;
  wheelieAngularVelocity: number;
  throttleLoad: number;
  forwardLoad: number;
  liftPull: number;
  liftArmed: boolean;
}
/** Actual tail contact precedes a short, manually recoverable loop-out band. */
export function tailScrape(
  bikeId: string,
  angle: number,
  profile: BalanceProfile,
) {
  const startAngle = profile.crashAngle - TAIL_RECOVERY_ANGLE;
  const intensity =
    Number.isFinite(angle) && angle < profile.crashAngle
      ? Math.max(0, Math.min(1, (angle - startAngle) / TAIL_RECOVERY_ANGLE))
      : 0;
  return {
    material: (TAIL_CONTACT[bikeId] ?? TAIL_CONTACT['450']).material,
    intensity,
    startAngle,
  };
}
export function advanceBalance(
  state: BalanceState,
  profile: BalanceProfile,
  speed: number,
  throttle: boolean | number,
  forward: boolean | number,
  dt: number,
) {
  // One finite torque pulse from both wheels down. Airborne pumping and
  // holding through touchdown cannot retrigger it; angular velocity stays continuous.
  if (Number(throttle) < 0.05 && state.wheelieAngle < 0.015)
    state.liftArmed = true;
  if (
    state.liftArmed &&
    Number(throttle) > 0.65 &&
    Number(forward) < 0.1 &&
    state.wheelieAngle < 0.015
  ) {
    state.liftPull = 1;
    state.liftArmed = false;
  }
  state.liftPull *= Math.exp(-dt * 7);
  state.throttleLoad +=
    (Number(throttle) - state.throttleLoad) * (1 - Math.exp(-dt * 9));
  state.forwardLoad +=
    (Number(forward) - state.forwardLoad) * (1 - Math.exp(-dt * 12));
  const speedPower = Math.max(0.85, Math.min(1.22, speed / 22));
  // Ahead of the tipping point the released front end returns decisively.
  // Retain the launch response and the unstable rearward side of the balance.
  const returnGravity =
    state.wheelieAngle < profile.balancePoint
      ? 1 +
        2.5 *
          (1 - Math.max(state.throttleLoad, state.liftPull, Number(throttle)))
      : 1;
  const torque =
    state.liftPull *
      profile.launchTorque *
      Number(throttle) *
      (1 - state.forwardLoad) +
    state.throttleLoad *
      profile.throttleTorque *
      speedPower *
      (1 - state.forwardLoad * 0.7) -
    state.forwardLoad * profile.forwardWeightTorque +
    profile.gravity *
      returnGravity *
      Math.sin(state.wheelieAngle - profile.balancePoint) -
    profile.damping * state.wheelieAngularVelocity;
  state.wheelieAngularVelocity += torque * dt;
  const next = state.wheelieAngle + state.wheelieAngularVelocity * dt;
  const touchdown =
    next <= 0 && state.wheelieAngle > 0
      ? Math.max(0, -state.wheelieAngularVelocity)
      : 0;
  state.wheelieAngle = Math.max(0, next);
  if (next <= 0) state.wheelieAngularVelocity = 0;
  return touchdown;
}
export function balanceAccuracy(state: BalanceState, profile: BalanceProfile) {
  const position = Math.max(
    0,
    1 -
      Math.abs(state.wheelieAngle - profile.balancePoint) /
        profile.balanceWidth,
  );
  const steadiness = Math.max(
    0,
    1 - Math.abs(state.wheelieAngularVelocity) / 1.2,
  );
  return position * position * steadiness;
}

/** Reward controlled rearward lift throughout the safe angle range.
 * Accuracy around the equilibrium remains a separate control measure. */
export function wheelieScoreFactor(
  state: Pick<BalanceState, 'wheelieAngle' | 'wheelieAngularVelocity'>,
  profile: BalanceProfile,
) {
  if (
    !Number.isFinite(state.wheelieAngle) ||
    !Number.isFinite(state.wheelieAngularVelocity) ||
    !Number.isFinite(profile.crashAngle) ||
    profile.crashAngle <= 0.12
  )
    return 0;
  const lift = Math.max(
    0,
    Math.min(1, (state.wheelieAngle - 0.12) / (profile.crashAngle - 0.12)),
  );
  const steadiness = Math.max(
    0,
    1 - Math.abs(state.wheelieAngularVelocity) / 1.2,
  );
  return lift * (1 + 2 * lift) * steadiness;
}

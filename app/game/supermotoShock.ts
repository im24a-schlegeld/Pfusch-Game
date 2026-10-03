/** Chosen assembly proportions along the shared top-to-bottom shock axis.
 * These describe the reference's separate upper damper / piggyback reservoir
 * and lower spring, not measurements inferred from the photograph. */
export const SUPERMOTO_SHOCK_MOUNT_ROOT = [0.143, 0.744, 0.095] as const;

export const SUPERMOTO_SHOCK_DETAILS = Object.freeze({
  mountRoot: [0, SUPERMOTO_SHOCK_MOUNT_ROOT[1], SUPERMOTO_SHOCK_MOUNT_ROOT[2]] as readonly [number, number, number],
  mountHalfWidth: SUPERMOTO_SHOCK_MOUNT_ROOT[0],
  bodyFrom: 0.10,
  bodyTo: 0.43,
  bodyRadius: 0.026,
  reservoirFrom: 0.055,
  reservoirTo: 0.21,
  reservoirX: 0.057,
  reservoirRadius: 0.024,
  reservoirCapRadius: 0.0255,
  upperSpringSeat: 0.32,
  lowerSpringSeat: 0.885,
  coilFrom: 0.335,
  coilTo: 0.87,
});

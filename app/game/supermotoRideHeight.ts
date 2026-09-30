/** Supermoto ride-height datum in unscaled motorcycle metres. The 50 mm
 * lowering is equal static fork/rear travel, not a scale change or axle move. */
export const SUPERMOTO_STATIC_SAG = 0.050;
export const SUPERMOTO_REAR_PIVOT = [0, 0.5, 0.1] as const;

/** Neutral sprung-body offset with the rear axle held at its ground datum.
 * This pure calculation is also used by deterministic tail-contact physics. */
export function supermotoSettledOffset(rearY: number, rearZ: number): [number, number, number] {
  const armY = rearY - SUPERMOTO_REAR_PIVOT[1];
  const armZ = rearZ - SUPERMOTO_REAR_PIVOT[2];
  const movedY = armY + SUPERMOTO_STATIC_SAG;
  const movedZ = Math.sqrt(armY * armY + armZ * armZ - movedY * movedY);
  return [0, -SUPERMOTO_STATIC_SAG, armZ - movedZ];
}

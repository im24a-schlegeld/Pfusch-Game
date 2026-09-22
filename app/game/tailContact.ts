export interface TailContact {
  readonly point: readonly [number, number, number];
  readonly rearPivotZ: number;
  readonly rearRadius: number;
  readonly angle: number;
  readonly material: 'metal' | 'plastic';
}
function contact(
  point: readonly [number, number, number],
  rearPivotZ: number,
  rearRadius: number,
  material: TailContact['material'],
): TailContact {
  const y = point[1] - rearRadius,
    z = point[2] - rearPivotZ;
  return Object.freeze({
    point,
    rearPivotZ,
    rearRadius,
    material,
    angle: Math.acos(-rearRadius / Math.hypot(y, z)) - Math.atan2(z, y),
  });
}
// The extended steel mudguard wraps just behind the rear axle height. Share
// its tip with the renderer so sparks and loop-out follow actual contact.
export const MOPED_REAR_FENDER_ANGLE = 1.68;
const mopedGuardRadius = 0.305 + 0.038 + 0.008 + 0.005;
/** Raw chassis coordinates, before the shared vehicle/world scale. */
export const TAIL_CONTACT: Readonly<Record<string, TailContact>> = {
  // Earliest rendered rear vertices, including the Ciao's steel mudguard and
  // the scooter's lower plastic mudflap rather than their higher saddle tails.
  '125': contact(
    [
      0,
      0.305 + Math.cos(MOPED_REAR_FENDER_ANGLE) * mopedGuardRadius,
      0.55 + Math.sin(MOPED_REAR_FENDER_ANGLE) * mopedGuardRadius,
    ],
    0.55,
    0.305,
    'metal',
  ),
  scooter: contact([0.065, 0.304, 0.9705], 0.64, 0.231, 'plastic'),
  '450': contact([0, 1.068, 1.045], 0.76, 0.327495, 'plastic'),
  '701': contact([0, 1.016, 0.885], 0.685, 0.3204, 'plastic'),
};
export const TAIL_RECOVERY_ANGLE = 0.12;

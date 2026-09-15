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
/** Raw chassis coordinates, before the shared vehicle/world scale. */
export const TAIL_CONTACT: Readonly<Record<string, TailContact>> = {
  // Earliest rendered rear vertices, including the Ciao's steel mudguard and
  // the scooter's lower plastic mudflap rather than their higher saddle tails.
  '125': contact([0, 0.417254776, 0.887838542], 0.55, 0.305, 'metal'),
  scooter: contact([0.065, 0.304, 0.9705], 0.64, 0.231, 'plastic'),
  '450': contact([0, 1.068, 1.045], 0.76, 0.327495, 'plastic'),
  '701': contact([0, 1.003, 0.855], 0.685, 0.3204, 'plastic'),
};
export const TAIL_RECOVERY_ANGLE = 0.12;

import { IMPORTED_BIKE_TAIL } from './importedBikeDimensions';

export interface TailContact {
  readonly point: readonly [number, number, number];
  readonly settledPoint: readonly [number, number, number];
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
  neutralOffset: readonly [number, number, number] = [0, 0, 0],
): TailContact {
  const settledPoint = point.map((value, index) => value + neutralOffset[index]) as [number, number, number];
  const y = settledPoint[1] - rearRadius,
    z = settledPoint[2] - rearPivotZ;
  return Object.freeze({
    point,
    settledPoint,
    rearPivotZ,
    rearRadius,
    material,
    angle: Math.acos(-rearRadius / Math.hypot(y, z)) - Math.atan2(z, y),
  });
}
// The extended steel mudguard wraps just behind the rear axle height. Share
// its tip with the renderer so sparks and loop-out follow actual contact.
export const MOPED_REAR_FENDER_ANGLE = 1.68;
/** Raw chassis coordinates, before the shared vehicle/world scale. */
export const TAIL_CONTACT: Readonly<Record<string, TailContact>> = {
  // Earliest rendered rear vertices, including the Ciao's steel mudguard and
  // the scooter's lower plastic mudflap rather than their higher saddle tails.
  '125': contact(IMPORTED_BIKE_TAIL['125'].tail, IMPORTED_BIKE_TAIL['125'].rearAxle, IMPORTED_BIKE_TAIL['125'].rearRadius, IMPORTED_BIKE_TAIL['125'].material),
  moped: contact(IMPORTED_BIKE_TAIL.moped.tail, IMPORTED_BIKE_TAIL.moped.rearAxle, IMPORTED_BIKE_TAIL.moped.rearRadius, IMPORTED_BIKE_TAIL.moped.material),
  scooter: contact(IMPORTED_BIKE_TAIL.scooter.tail, IMPORTED_BIKE_TAIL.scooter.rearAxle, IMPORTED_BIKE_TAIL.scooter.rearRadius, IMPORTED_BIKE_TAIL.scooter.material),
  '450': contact(
    IMPORTED_BIKE_TAIL['450'].tail,
    IMPORTED_BIKE_TAIL['450'].rearAxle,
    IMPORTED_BIKE_TAIL['450'].rearRadius,
    IMPORTED_BIKE_TAIL['450'].material,
  ),
  '701': contact(IMPORTED_BIKE_TAIL['701'].tail, IMPORTED_BIKE_TAIL['701'].rearAxle, IMPORTED_BIKE_TAIL['701'].rearRadius, IMPORTED_BIKE_TAIL['701'].material),
};
export const TAIL_RECOVERY_ANGLE = 0.12;

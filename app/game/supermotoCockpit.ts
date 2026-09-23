import type { Point } from './riderSkeleton';

// Both outer grip sections sweep rearward (+Z), including their controls.
const sweep = 12 * Math.PI / 180;
const across = Math.cos(sweep), rearward = Math.sin(sweep);

export function supermotoGripPoint(
  grip: Point,
  side: number,
  outward: number,
  up = 0,
  depth = 0,
): Point {
  return [
    side * (grip[0] + outward * across - depth * rearward),
    grip[1] + up,
    grip[2] + outward * rearward + depth * across,
  ];
}

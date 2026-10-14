import type { Point } from './riderSkeleton';

// The supplied sneaker's sole at the peg cross-section (local Z=.005),
// measured on the real sole triangles. These offsets are shared on every bike.
const soleY = 0.00036466501625964653, soleZ = 0.005;
const pivotY = 0.012 + soleY;

/** Change foot angle about its supported sole point, moving the ankle target
 * by that same rotation. Fixed bone lengths and original shoe geometry remain. */
export function riderFootPlacement(peg: Point, side = 1, pitch = 0): { position: Point; ankle: Point } {
  const c = Math.cos(pitch), s = Math.sin(pitch);
  const ankleY = 0.105 - pivotY, ankleZ = 0.055;
  return {
    position: [side * peg[0], peg[1] + pivotY - c * soleY + s * soleZ,
      peg[2] - s * soleY - c * soleZ],
    ankle: [side * peg[0], peg[1] + pivotY + c * ankleY - s * ankleZ,
      peg[2] + s * ankleY + c * ankleZ],
  };
}

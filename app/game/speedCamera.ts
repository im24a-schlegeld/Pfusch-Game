/** Shared deterministic placement for roadside speed cameras.
 *
 * The renderer and fixed-step engine use the same positions, so a camera can
 * flash exactly as the rider crosses it without adding a second random stream.
 */
export const BLITZER_START = 180;
export const BLITZER_SPACING = 144;

function hash(index: number) {
  return (Math.imul(index + 17, 1103515245) + 12345) >>> 0;
}

export function blitzerDistance(index: number) {
  return BLITZER_START + index * BLITZER_SPACING;
}

/** Roughly one in four candidate positions receives a camera. */
export function hasBlitzer(index: number) {
  return hash(index) % 4 === 0;
}

export function blitzerSide(index: number) {
  return hash(index + 101) % 2 === 0 ? -1 : 1;
}

export function blitzerIndexAtOrBefore(distance: number) {
  return Math.floor((distance - BLITZER_START) / BLITZER_SPACING);
}

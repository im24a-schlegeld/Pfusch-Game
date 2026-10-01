/** Unscaled chassis coordinates. +Z points to the back. */
// The requested visible outlet is on the middle of the lower front casting, between both cradle rails. Keep the
// fitting and tube start on the same authored datum.
export const SUPERMOTO_EXHAUST_OUTLET = [0, 0.560, -0.236] as const;
export const SUPERMOTO_EXHAUST_TANGENT = [0, -0.012, -0.070] as const;

export const TUBE_EXHAUST = Object.freeze({
  x: 0.060,
  startZ: 0.490,
  endZ: 0.790,
  startY: 0.760,
  endY: 0.853,
  radius: 0.032,
  verticalRadius: 0.042,
  clearance: 0.008,
});
// The oval can is mounted beside the liner, below the side-cover lower edge.
export function exhaustAxisY(z: number) {
  const e = TUBE_EXHAUST;
  return (
    e.startY +
    ((e.endY - e.startY) * (z - e.startZ)) /
      (e.endZ - e.startZ)
  );
}
export function raisedLinerY(x: number, y: number, z: number): number {
  const e = TUBE_EXHAUST;
  if (z < e.startZ - 0.018 || z > e.endZ + 0.012) return y;
  const dx = Math.abs(x - e.x),
    r = e.radius + 0.006;
  if (dx > r + 0.026) return y;
  const slope = (e.endY - e.startY) / (e.endZ - e.startZ);
  const crown =
    exhaustAxisY(z) +
    (e.verticalRadius + 0.006) *
      Math.sqrt(1 + slope * slope) *
      Math.sqrt(Math.max(0, 1 - Math.min(1, dx / r) ** 2)) +
    e.clearance;
  if (dx <= r) return Math.max(y, crown);
  const t = (dx - r) / 0.026,
    blend = 1 - t * t * (3 - 2 * t);
  return y + Math.max(0, exhaustAxisY(z) + e.clearance - y) * blend;
}

/** Unscaled chassis coordinates. +Z points to the back. */
// The requested visible outlet is on the lower front casting. Keep the
// fitting and tube start on the same authored datum.
export const SUPERMOTO_EXHAUST_OUTLET = [0.112, 0.578, -0.210] as const;
export const SUPERMOTO_EXHAUST_TANGENT = [0.05, -0.018, -0.080] as const;

export const TUBE_EXHAUST = Object.freeze({
  x: 0.185,
  startZ: 0.38,
  endZ: 0.855,
  startY: 0.725,
  endY: 0.868,
  radius: 0.051,
  verticalRadius: 0.073,
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

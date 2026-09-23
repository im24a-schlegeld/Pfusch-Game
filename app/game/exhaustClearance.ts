/** Unscaled chassis coordinates. +Z points to the back. */
export const TUBE_EXHAUST = Object.freeze({
  x: 0.091,
  startZ: 0.45,
  endZ: 0.80,
  startY: 0.773,
  endY: 0.902,
  radius: 0.047,
  clearance: 0.008,
});
// Match the rendered silencer endpoints, including its inlet/outlet offsets.
export function exhaustAxisY(z: number) {
  const e = TUBE_EXHAUST;
  return (
    e.startY +
    0.018 +
    ((e.endY + 0.03 - e.startY - 0.018) * (z - e.startZ - 0.02)) /
      (e.endZ - 0.01 - e.startZ - 0.02)
  );
}
export function raisedLinerY(x: number, y: number, z: number): number {
  const e = TUBE_EXHAUST;
  if (z < e.startZ - 0.018 || z > e.endZ + 0.012) return y;
  const dx = Math.abs(x - e.x),
    r = e.radius + 0.006;
  if (dx > r + 0.026) return y;
  const slope =
    (e.endY + 0.03 - e.startY - 0.018) / (e.endZ - 0.01 - e.startZ - 0.02);
  const crown =
    exhaustAxisY(z) +
    r *
      Math.sqrt(1 + slope * slope) *
      Math.sqrt(Math.max(0, 1 - Math.min(1, dx / r) ** 2)) +
    e.clearance;
  if (dx <= r) return Math.max(y, crown);
  const t = (dx - r) / 0.026,
    blend = 1 - t * t * (3 - 2 * t);
  return y + Math.max(0, exhaustAxisY(z) + e.clearance - y) * blend;
}

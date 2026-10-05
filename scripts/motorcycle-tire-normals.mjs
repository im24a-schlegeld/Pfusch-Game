/** Rebuild smooth rubber normals from the posed, non-indexed source surface.
 * USD split vertices may share a position but carry differently transformed
 * normals. Weld by position for this calculation only; geometry stays intact.
 */
export function recomputeWeldedNormals(positions) {
  const sums = new Map();
  const key = offset => [0, 1, 2].map(axis => Math.round(positions[offset + axis] * 100000)).join(',');
  for (let offset = 0; offset < positions.length; offset += 9) {
    const ux = positions[offset + 3] - positions[offset];
    const uy = positions[offset + 4] - positions[offset + 1];
    const uz = positions[offset + 5] - positions[offset + 2];
    const vx = positions[offset + 6] - positions[offset];
    const vy = positions[offset + 7] - positions[offset + 1];
    const vz = positions[offset + 8] - positions[offset + 2];
    const face = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (let corner = 0; corner < 3; corner++) {
      const id = key(offset + corner * 3);
      const sum = sums.get(id) ?? [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) sum[axis] += face[axis];
      sums.set(id, sum);
    }
  }
  const normals = new Float32Array(positions.length);
  for (let offset = 0; offset < positions.length; offset += 3) {
    const sum = sums.get(key(offset));
    const length = Math.hypot(...sum);
    if (length < 1e-12) throw new Error('Degenerate tire surface at vertex ' + offset / 3);
    normals.set(sum.map(value => value / length), offset);
  }
  return normals;
}

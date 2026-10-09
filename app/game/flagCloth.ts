/** Small, fixed-size cloth solver. All distances are in the shared rider frame. */
export function createFlagCloth(columns: number, rows: number, width: number, length: number, points: Float32Array) {
  const count = (columns + 1) * (rows + 1);
  const previous = new Float32Array(points.length);
  const surface = new Float32Array(points.length);
  const anchors = new Float32Array(points.length);
  const pinned = new Uint8Array(count);
  const supports = [0, columns / 2, columns];
  // The tied short edge stays wrapped around the neck. Its arc has the same
  // material length as the flat flag; all rows below that collar are free.
  for (let vertex = 0; vertex <= columns; vertex++) pinned[vertex] = 1;
  const links: number[] = [], lengths: number[] = [], stiffness: number[] = [];
  const dx = width / columns, dy = length / rows;
  const link = (a: number, b: number, distance: number, strength: number) => {
    links.push(a * 3, b * 3); lengths.push(distance); stiffness.push(strength);
  };
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const a = row * (columns + 1) + column;
    if (column < columns) link(a, a + 1, dx, 1);
    if (row < rows) link(a, a + columns + 1, dy, 1);
    if (column < columns && row < rows) {
      link(a, a + columns + 2, Math.hypot(dx, dy), .7);
      link(a + 1, a + columns + 1, Math.hypot(dx, dy), .7);
    }
    // Weak bending constraints remove sharp numerical creases, while allowing
    // a folded, hanging cloth instead of holding it in a flat sail shape.
    if (column + 2 <= columns) link(a, a + 2, dx * 2, .035);
    if (row + 2 <= rows) link(a, a + 2 * (columns + 1), dy * 2, .035);
  }
  const pairs = new Uint16Array(links), rest = new Float32Array(lengths), strength = new Float32Array(stiffness);
  const weightA = new Float32Array(rest.length), weightB = new Float32Array(rest.length);
  for (let edge = 0; edge < rest.length; edge++) {
    const a = pinned[pairs[edge * 2] / 3] ? 0 : 1, b = pinned[pairs[edge * 2 + 1] / 3] ? 0 : 1;
    weightA[edge] = a * strength[edge] / Math.max(1, a + b);
    weightB[edge] = b * strength[edge] / Math.max(1, a + b);
  }
  // Long-range strain limits transfer tension to the neck immediately instead
  // of needing hundreds of solver sweeps through every short edge. They only
  // limit extension; folded cloth is completely free to hang nearer the neck.
  const tethers = new Float32Array(count * supports.length);
  const tetherSquared = new Float32Array(tethers.length);
  for (let vertex = 0; vertex < count; vertex++) for (let support = 0; support < supports.length; support++)
    tethers[vertex * supports.length + support] = Math.hypot(
      (vertex % (columns + 1) - supports[support]) * dx, Math.floor(vertex / (columns + 1)) * dy);
  for (let i = 0; i < tethers.length; i++) tetherSquared[i] = tethers[i] * tethers[i];
  const pin = () => {
    for (let vertex = 0; vertex <= columns; vertex++) {
      const i = vertex * 3;
      points[i] = anchors[i]; points[i + 1] = anchors[i + 1]; points[i + 2] = anchors[i + 2];
    }
  };
  const reset = () => { anchors.set(points); previous.set(points); };
  const step = (ax: number, ay: number, az: number, wx: number, wy: number, wz: number, phase: number, flutter: number,
    damping: number, collide: (vertex: number) => void) => {
    const squaredStep = 1 / 3600;
    const wind = Math.sqrt(wx * wx + wy * wy + wz * wz);
    surface.set(points);
    for (let vertex = 0; vertex < count; vertex++) {
      if (pinned[vertex]) continue;
      const i = vertex * 3, x = points[i], y = points[i + 1], z = points[i + 2];
      const row = Math.floor(vertex / (columns + 1)), column = vertex % (columns + 1), u = column / columns;
      const ripple = flutter * (row / rows) * Math.sin(phase * 8 - row * .55 + u * 3);
      const left = (vertex - (column > 0 ? 1 : 0)) * 3, right = (vertex + (column < columns ? 1 : 0)) * 3;
      const above = (vertex - (row > 0 ? columns + 1 : 0)) * 3, below = (vertex + (row < rows ? columns + 1 : 0)) * 3;
      const hx = surface[right] - surface[left], hy = surface[right + 1] - surface[left + 1], hz = surface[right + 2] - surface[left + 2];
      const vx = surface[below] - surface[above], vy = surface[below + 1] - surface[above + 1], vz = surface[below + 2] - surface[above + 2];
      const nx = hy * vz - hz * vy, ny = hz * vx - hx * vz, nz = hx * vy - hy * vx;
      const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const dot = normalLength > 1e-9 ? (nx * wx + ny * wy + nz * wz) / normalLength : 0;
      // Pressure acts across the cloth, then falls off as it aligns with the
      // airflow. Constant thrust on a streamlined hem artificially stretches it.
      const pressure = wind > 1e-6 && normalLength > 1e-9 ? dot * Math.abs(dot) / (wind * normalLength) : 0;
      const exposed = Math.min(1, Math.max(0, (row - 2) / 4));
      points[i] += (x - previous[i]) * damping + (ax + (nx * pressure + wx * .06 + ripple * .3) * exposed) * squaredStep;
      points[i + 1] += (y - previous[i + 1]) * damping + (ay + (ny * pressure + wy * .06 + ripple) * exposed) * squaredStep;
      points[i + 2] += (z - previous[i + 2]) * damping + (az + (nz * pressure + wz * .06) * exposed) * squaredStep;
      previous[i] = x; previous[i + 1] = y; previous[i + 2] = z;
    }
    for (let pass = 0; pass < 20; pass++) {
      // Alternate sweep direction so neither the left edge nor the hem gets
      // a permanent bias from the constraint solver's iteration order.
      for (let n = 0; n < rest.length; n++) {
        const edge = pass % 2 ? rest.length - n - 1 : n;
        const a = pairs[edge * 2], b = pairs[edge * 2 + 1];
        const wa = weightA[edge], wb = weightB[edge];
        if (!(wa + wb)) continue;
        const x = points[b] - points[a], y = points[b + 1] - points[a + 1], z = points[b + 2] - points[a + 2];
        const distance = Math.sqrt(x * x + y * y + z * z);
        if (distance < 1e-9) continue;
        const correction = (distance - rest[edge]) / distance;
        points[a] += x * correction * wa; points[a + 1] += y * correction * wa; points[a + 2] += z * correction * wa;
        points[b] -= x * correction * wb; points[b + 1] -= y * correction * wb; points[b + 2] -= z * correction * wb;
      }
      for (let vertex = columns + 1; vertex < count; vertex++) {
        const i = vertex * 3;
        for (let support = 0; support < supports.length; support++) {
          const a = supports[support] * 3;
          const x = points[i] - anchors[a], y = points[i + 1] - anchors[a + 1], z = points[i + 2] - anchors[a + 2];
          const squared = x * x + y * y + z * z, tether = vertex * supports.length + support;
          if (squared > tetherSquared[tether]) {
            const ratio = tethers[tether] / Math.sqrt(squared);
            points[i] = anchors[a] + x * ratio; points[i + 1] = anchors[a + 1] + y * ratio; points[i + 2] = anchors[a + 2] + z * ratio;
          }
        }
        collide(vertex);
      }
      pin();
    }
  };
  return { points, previous, anchors, pinned, reset, step };
}

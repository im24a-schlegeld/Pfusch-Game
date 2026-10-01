import { BufferGeometry, Float32BufferAttribute, MathUtils } from 'three';

type Station = readonly number[];

/** Interpolate the measured sections without overshooting a narrow join. */
function section(stations: readonly Station[], z: number): number[] {
  let i = stations.findIndex((p) => p[0] >= z) - 1;
  if (i < 0) i = z <= stations[0][0] ? 0 : stations.length - 2;
  const a = stations[i],
    b = stations[i + 1];
  const h = b[0] - a[0],
    t = MathUtils.clamp((z - a[0]) / h, 0, 1);
  return a.map((value, k) => {
    if (k === 0) return z;
    const before = stations[Math.max(0, i - 1)],
      after = stations[Math.min(stations.length - 1, i + 2)];
    const slope = (b[k] - value) / h;
    const previous = (value - before[k]) / (a[0] - before[0] || h);
    const next = (after[k] - b[k]) / (after[0] - b[0] || h);
    const limit = (neighbor: number) =>
      slope * neighbor <= 0
        ? 0
        : Math.sign(slope) * Math.min(Math.abs(slope), Math.abs(neighbor));
    const m0 = i === 0 ? slope : limit(previous),
      m1 = i === stations.length - 2 ? slope : limit(next);
    return (
      (2 * t ** 3 - 3 * t * t + 1) * value +
      (t ** 3 - 2 * t * t + t) * h * m0 +
      (-2 * t ** 3 + 3 * t * t) * b[k] +
      (t ** 3 - t * t) * h * m1
    );
  });
}

// z, inner shoulder x, outer x, upper y, lower y. The shallow upper wing
// exposes the tank below it; only its forward radiator fin drops to the head.
const WING: readonly Station[] = [
  [-0.47, 0.108, 0.146, 0.93, 0.925],
  [-0.435, 0.104, 0.155, 0.953, 0.886],
  [-0.36, 0.101, 0.167, 0.978, 0.838],
  [-0.3, 0.120, 0.163, 0.967, 0.765],
  [-0.255, 0.132, 0.163, 0.955, 0.710],
  [-0.222, 0.136, 0.163, 0.956, 0.781],
  [-0.19, 0.132, 0.163, 0.966, 0.878],
  [-0.14, 0.117, 0.159, 0.977, 0.910],
  [-0.05, 0.092, 0.149, 0.959, 0.917],
  [0.05, 0.089, 0.137, 0.947, 0.915],
  [0.165, 0.087, 0.128, 0.947, 0.922],
];

/** One continuous rounded shoulder and radiator wing, with an actual return
 * edge. No separate flat strip creates a sharp crease on the tank shoulder. */
export function supermotoShroudGeometry(side: number) {
  const rows = 72,
    columns = 24,
    stride = columns + 1;
  const face = (rows + 1) * stride,
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (const depth of [0.002, -0.002])
    for (let row = 0; row <= rows; row++) {
      const z = MathUtils.lerp(
        WING[0][0],
        WING[WING.length - 1][0],
        row / rows,
      );
      const [, inner, outer, top, bottom] = section(WING, z);
      for (let c = 0; c <= columns; c++) {
        const v = c / columns;
        let x: number, y: number;
        if (v <= 0.25) {
          const a = ((v / 0.25) * Math.PI) / 2;
          x = inner + (outer - inner) * Math.sin(a);
          // The inner lip dips around the fuel reservoir. This opens the
          // marked black shoulder without painting a fake patch on the wing.
          const recess = MathUtils.smoothstep(z, -0.36, -0.255)
            * (1 - MathUtils.smoothstep(z, -0.19, -0.05));
          y = top + (0.014 - 0.027 * recess) * Math.cos(a);
        } else {
          const t = (v - 0.25) / 0.75;
          x = outer + Math.sin(t * Math.PI) ** 2 * 0.005;
          y = MathUtils.lerp(top, bottom, t);
        }
        positions.push(side * (x + depth), y, z);
        uv.push((z + 0.5) / 1.5, (y - 0.65) / 0.35);
      }
    }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      const a = r * stride + c,
        b = a + stride;
      indices.push(
        a,
        a + 1,
        b,
        a + 1,
        b + 1,
        b,
        a + face,
        b + face,
        a + 1 + face,
        a + 1 + face,
        b + face,
        b + 1 + face,
      );
    }
  const rim: number[] = [];
  for (let c = 0; c < columns; c++) rim.push(c);
  for (let r = 0; r < rows; r++) rim.push(r * stride + columns);
  for (let c = columns; c > 0; c--) rim.push(rows * stride + c);
  for (let r = rows; r > 0; r--) rim.push(r * stride);
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i],
      b = rim[(i + 1) % rim.length];
    indices.push(a, b, a + face, b, b + face, a + face);
  }
  // The grid runs down and rearward, its outside normal is negative X.
  if (side > 0)
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  return geometry(positions, indices, uv);
}

// z, half width, upper y, lower y: a neck beneath the cap, broad shoulders,
// and a rounded low reservoir hanging visibly above the cylinder head.
const TANK: readonly Station[] = [
  [-0.405, 0.035, 0.984, 0.947],
  [-0.345, 0.084, 1.009, 0.879],
  [-0.28, 0.139, 1.014, 0.831],
  [-0.195, 0.143, 0.999, 0.804],
  [-0.085, 0.144, 0.967, 0.798],
  [0.025, 0.141, 0.946, 0.808],
  [0.108, 0.123, 0.932, 0.834],
  [0.172, 0.106, 0.912, 0.834],
  [0.220, 0.082, 0.914, 0.821],
];

/** Moulded tank volume. The broad side is flatter than an ellipsoid, with
 * round upper/lower transitions rather than a triangular exposed wedge. */
export function supermotoFuelTankGeometry() {
  const rows = 64,
    sides = 40,
    stride = sides + 1;
  const positions: number[] = [],
    indices: number[] = [],
    uv: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const z = MathUtils.lerp(TANK[0][0], TANK[TANK.length - 1][0], r / rows);
    const [, width, top, bottom] = section(TANK, z);
    for (let c = 0; c <= sides; c++) {
      const a = (c / sides) * Math.PI * 2;
      const sin = Math.sin(a),
        cos = Math.cos(a);
      positions.push(
        Math.sign(sin) * Math.abs(sin) ** 0.69 * width,
        (top + bottom) / 2 +
          (Math.sign(cos) * Math.abs(cos) ** 0.86 * (top - bottom)) / 2,
        z,
      );
      uv.push(c / sides, r / rows);
    }
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < sides; c++) {
      const a = r * stride + c,
        b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  for (const r of [0, rows]) {
    const start = r * stride,
      station = section(TANK, positions[start * 3 + 2]);
    const center = positions.length / 3;
    positions.push(0, (station[2] + station[3]) / 2, station[0]);
    uv.push(0.5, r / rows);
    for (let c = 0; c < sides; c++)
      if (r === 0) indices.push(center, start + c, start + c + 1);
      else indices.push(center, start + c + 1, start + c);
  }
  const result = geometry(positions, indices, uv);
  // Weld shading across the duplicated UV meridian without changing UVs.
  const n = result.getAttribute('normal');
  for (let r = 0; r <= rows; r++) {
    const a = r * stride,
      b = a + sides;
    const x = n.getX(a) + n.getX(b),
      y = n.getY(a) + n.getY(b),
      z = n.getZ(a) + n.getZ(b);
    const length = Math.hypot(x, y, z);
    n.setXYZ(a, x / length, y / length, z / length);
    n.setXYZ(b, x / length, y / length, z / length);
  }
  return result;
}

function geometry(positions: number[], indices: number[], uv: number[]) {
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  result.setIndex(indices);
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

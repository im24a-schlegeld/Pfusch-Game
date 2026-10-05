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

// z, inner edge x, outer x, upper y, lower y. A narrow horizontal blade
// connects the number panel to the pointed front, with a short radiator
// tongue under that point. The tank remains a separate exposed moulding.
const WING: readonly Station[] = [
  [-0.505, 0.108, 0.143, 0.942, 0.938],
  [-0.475, 0.112, 0.152, 0.963, 0.923],
  [-0.430, 0.117, 0.162, 0.994, 0.910],
  [-0.410, 0.123, 0.166, 1.008, 0.830],
  [-0.380, 0.125, 0.169, 1.030, 0.752],
  [-0.346, 0.128, 0.169, 1.018, 0.752],
  [-0.324, 0.130, 0.168, 0.995, 0.898],
  [-0.300, 0.132, 0.167, 0.985, 0.899],
  [-0.265, 0.132, 0.165, 0.977, 0.900],
  [-0.210, 0.125, 0.161, 0.973, 0.900],
  [-0.110, 0.092, 0.150, 0.967, 0.900],
  [0.015, 0.090, 0.142, 0.954, 0.905],
  [0.070, 0.087, 0.140, 0.943, 0.900],
  [0.165, 0.087, 0.129, 0.916, 0.890],
];

/** Continuous radiator fin and rearward side band with a small rolled rim. */
export function supermotoShroudGeometry(side: number) {
  // Keep every corner in the silhouette. Smooth longitudinal lofts soften
  // the blade into a hose and round off the straight radiator-tongue end.
  const sections = WING.flatMap((a, i) => {
    const b = WING[i + 1];
    if (!b) return [a];
    const steps = Math.ceil((b[0] - a[0]) / 0.012);
    return Array.from({ length: steps }, (_, j) => a.map((value, k) =>
      MathUtils.lerp(value, b[k], j / steps)));
  });
  const rows = sections.length - 1,
    columns = 12,
    stride = columns + 1;
  const face = (rows + 1) * stride,
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (const depth of [0.002, -0.002])
    for (let row = 0; row <= rows; row++) {
      const [z, inner, outer, top, bottom] = sections[row];
      for (let c = 0; c <= columns; c++) {
        const v = c / columns;
        let x: number, y: number;
        if (v <= 0.25) {
          const a = ((v / 0.25) * Math.PI) / 2;
          const returnWidth = Math.min(0.0055, outer - inner);
          x = outer - returnWidth * (1 - Math.sin(a));
          y = top + 0.0025 * Math.cos(a);
        } else {
          const t = (v - 0.25) / 0.75;
          x = outer + Math.max(0, 1 - Math.abs(t - 0.38) / 0.62) * 0.003;
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

// z, half width, upper y, lower y. The reservoir's exposed side is a compact
// trapezoid: its broad shoulder sits under the blade, its lower corners pull
// in towards one another above the cylinder. The hidden rear mounting lobe
// tucks beneath the deeper saddle rather than standing above its side seam.
const TANK: readonly Station[] = [
  [-0.405, 0.035, 0.984, 0.947],
  [-0.345, 0.084, 1.009, 0.911],
  [-0.295, 0.121, 1.015, 0.899],
  [-0.270, 0.139, 1.008, 0.815],
  [-0.240, 0.150, 0.997, 0.802],
  [-0.160, 0.151, 0.977, 0.801],
  [-0.055, 0.143, 0.954, 0.818],
  [0.025, 0.130, 0.934, 0.861],
  [0.075, 0.118, 0.916, 0.883],
  [0.150, 0.099, 0.882, 0.845],
  [0.220, 0.072, 0.850, 0.821],
];

// The small front neck rises from an inclined shoulder ahead of the saddle.
// A flat cap landing merges into that shoulder without a second tall hump.
const TANK_ROOF: readonly Station[] = [
  [-0.365, section(TANK, -0.365)[2]],
  [-0.345, 1.045],
  [-0.330, 1.059],
  [-0.268, 1.059],
  [-0.240, 1.018],
  [-0.220, section(TANK, -0.220)[2]],
];

function tankSection(z: number) {
  const result = section(TANK, z);
  if (z > -0.365 && z < -0.220) result[2] = section(TANK_ROOF, z)[1];
  return result;
}

/** Lower cap face sits on the raised filler neck rather than inside it. */
export const SUPERMOTO_FUEL_CAP_MOUNT = [0, tankSection(-0.299)[2] - 0.0015, -0.299] as const;

/** Separate moulded tank with an inclined shoulder and trapezoid reservoir. */
export function supermotoFuelTankGeometry() {
  const rows = 64,
    sides = 40,
    stride = sides + 1;
  const positions: number[] = [],
    indices: number[] = [],
    uv: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const z = MathUtils.lerp(TANK[0][0], TANK[TANK.length - 1][0], r / rows);
    const [, width, baseTop, bottom] = section(TANK, z);
    const top = tankSection(z)[2];
    for (let c = 0; c <= sides; c++) {
      const a = (c / sides) * Math.PI * 2;
      const sin = Math.sin(a),
        cos = Math.cos(a);
      // Flatten only the exposed lower side. Upper tank/seat shoulders
      // retain their fit, and the bottom never moves into the engine.
      let y = (baseTop + bottom) / 2 +
        (Math.sign(cos) * Math.abs(cos) ** (cos < 0 ? 0.42 : 0.86) * (baseTop - bottom)) / 2;
      const squareLowerSide = MathUtils.smoothstep(z, -0.295, -0.240)
        * (1 - MathUtils.smoothstep(z, -0.055, 0.025));
      const x = Math.sign(sin) * Math.abs(sin) **
        (cos < 0 ? 0.69 - 0.31 * squareLowerSide : 0.69) * width;
      if (cos > 0) {
        // The raised shoulder stays above the frame rails. It tapers towards
        // the saddle nose while its lower reservoir retains engine clearance.
        const neck = MathUtils.smoothstep(z, -0.350, -0.330);
        const rearShoulder = MathUtils.smoothstep(z, -0.330, -0.290);
        const crown = 1 - MathUtils.smoothstep(Math.abs(x),
          MathUtils.lerp(0.014, 0.032, neck),
          MathUtils.lerp(0.026, 0.040, neck) + 0.045 * rearShoulder);
        y += (top - baseTop) * cos ** 0.86 * crown;
        // A moulded landing supports the whole filler cap, including its
        // perimeter. Its rounded edge blends into the tank, not the plastics.
        const landing = (1 - MathUtils.smoothstep(Math.abs(x), 0.032, 0.060))
          * MathUtils.smoothstep(z, -0.365, -0.330)
          * (1 - MathUtils.smoothstep(z, -0.268, -0.240)) * crown;
        y = MathUtils.lerp(y, top, landing);
      }
      positions.push(x, y, z);
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
      station = tankSection(positions[start * 3 + 2]);
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

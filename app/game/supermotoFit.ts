import { SUPERMOTO_WHEELS } from './supermotoWheelDimensions';

/** Supermoto-only dimensions, in unscaled motorcycle coordinates. Front is -Z. */
export type FitPoint = [number, number, number];

/** Annotated target: 1472 mm wheelbase, 16.5-inch front / 17-inch rear rim. */
export const SUPERMOTO_CHASSIS = Object.freeze({
  frontAxle: -0.736,
  rearAxle: 0.736,
  frontRadius: SUPERMOTO_WHEELS.front.outerRadius,
  rearRadius: SUPERMOTO_WHEELS.rear.outerRadius,
  rimRadius: SUPERMOTO_WHEELS.front.beadRadius,
  frontTireWidth: SUPERMOTO_WHEELS.front.tireWidth,
  rearTireWidth: SUPERMOTO_WHEELS.rear.tireWidth,
  frontBrakeRadius: 0.155,
  forkTopY: 1.02,
});

// One contact datum for the actual pegs AND the existing rider IK/boot generator.
export const SUPERMOTO_PEG: FitPoint = [0.26, 0.385, 0.105];
export const SUPERMOTO_GRIP: FitPoint = [0.33, 1.147, -0.325];
export const SUPERMOTO_BAR = Object.freeze({
  clampY: 1.114,
  clampZ: -0.375,
  shoulderY: 1.127,
  shoulderZ: -0.365,
});

/** Saddle stations: z, half width, half thickness, center height. */
export const SUPERMOTO_SEAT: [number, number, number, number][] = [
  [-0.220, 0.057, 0.013, 1.014],
  [-0.145, 0.073, 0.018, 0.992],
  [0.040, 0.091, 0.023, 0.974],
  [0.380, 0.099, 0.021, 0.972],
  [0.625, 0.082, 0.014, 1.024],
  [0.708, 0.060, 0.007, 1.052],
];

// The EXC number panel extends forward under the tank seam and continues
// behind the fixed saddle. Keep its full depth without an outboard bulge.
export const SUPERMOTO_SIDE_COVER: FitPoint[] = [
  [0.130, 0.941, 0.115],
  [0.111, 0.950, 0.345],
  [0.103, 0.975, 0.530],
  [0.090, 1.023, 0.675],
  [0.080, 1.0635, 0.810],
  [0.087, 1.026, 0.790],
  [0.117, 0.963, 0.760],
  [0.125, 0.929, 0.625],
  [0.137, 0.894, 0.530],
  [0.142, 0.756, 0.370],
  [0.142, 0.720, 0.305],
  [0.138, 0.705, 0.278],
  [0.132, 0.782, 0.190],
  [0.133, 0.881, 0.128],
];

/** Sheet cross-sections: z, half width, crown height, edge height.
 * Tail-contact physics reads the final station's upper center tip. */
export const SUPERMOTO_TAIL_FENDER: [number, number, number, number][] = [
  [0.115, 0.128, 0.008, 0.941],
  [0.34, 0.111, 0.009, 0.9485],
  [0.53, 0.103, 0.010, 0.975],
  [0.675, 0.090, 0.010, 1.023],
  [0.76, 0.081, 0.008, 1.052],
  [0.87, 0.077, 0.007, 1.077],
  [0.96, 0.068, 0.006, 1.089],
  [1.01, 0.057, 0.005, 1.095],
];

/** z, half width, crown height, edge height. The higher EXC forward blade
 * meets the mask at its crown; the short rear skirt turns steeply downward.
 * Longitudinal fit and tyre clearance are independent of this moulded profile. */
export const SUPERMOTO_FRONT_FENDER: [number, number, number, number][] = [
  [-1.045, 0.050, 0.003, 0.870],
  [-1.020, 0.067, 0.007, 0.874],
  [-0.970, 0.088, 0.014, 0.888],
  [-0.915, 0.099, 0.022, 0.898],
  [-0.870, 0.096, 0.027, 0.900],
  [-0.858, 0.078, 0.028, 0.899],
  [-0.760, 0.090, 0.030, 0.890],
  [-0.665, 0.091, 0.028, 0.880],
  [-0.572, 0.080, 0.019, 0.876],
  [-0.535, 0.074, 0.013, 0.850],
  [-0.500, 0.072, 0.012, 0.805],
  [-0.472, 0.070, 0.009, 0.766],
  [-0.452, 0.066, 0.006, 0.740],
];

// More upright shock with its lower eye carried by the articulated rocker.
export const SUPERMOTO_SHOCK_TOP: FitPoint = [0, 0.820, 0.300];
export const SUPERMOTO_SHOCK_BOTTOM: FitPoint = [0, 0.414, 0.385];

export interface FitSurface {
  name: string;
  finish: 'alloy' | 'dark';
  positions: number[];
  indices: number[];
}

function solid(name: string, finish: FitSurface['finish'], positions: number[], indices: number[]): FitSurface {
  // Consistent outward winding. Mirroring is handled separately below.
  let volume6 = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    volume6 += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      + positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  if (volume6 < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  return { name, finish, positions, indices };
}

function prism(name: string, finish: FitSurface['finish'], xy: [number, number][], z0: number, z1: number) {
  const n = xy.length, p: number[] = [], ix: number[] = [];
  for (const z of [z0, z1]) for (const [x, y] of xy) p.push(x, y, z);
  for (let i = 1; i < n - 1; i++) ix.push(0, i + 1, i, n, n + i, n + i + 1);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; ix.push(i, j, n + i, j, n + j, n + i); }
  return solid(name, finish, p, ix);
}

function box(name: string, finish: FitSurface['finish'], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  return prism(name, finish, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1);
}

function pin(name: string, x: number, y: number, z: number, radius: number, length: number, segments = 16) {
  const p: number[] = [], ix: number[] = [];
  for (const dz of [-length / 2, length / 2]) for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2; p.push(x + Math.cos(a) * radius, y + Math.sin(a) * radius, z + dz);
  }
  p.push(x, y, z - length / 2, x, y, z + length / 2);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    ix.push(i, j, i + segments, j, j + segments, i + segments,
      2 * segments, j, i, 2 * segments + 1, i + segments, j + segments);
  }
  return solid(name, 'alloy', p, ix);
}

function cage(x0: number, x1: number, y0: number, y1: number, z: number) {
  const polygon = (a: number, b: number, w: number, c: number): [number, number][] => [
    [a + c, z - w], [b - c, z - w], [b, z - w + c], [b, z + w - c],
    [b - c, z + w], [a + c, z + w], [a, z + w - c], [a, z - w + c],
  ];
  const outer = polygon(x0, x1, 0.030, 0.007), inner = polygon(x0 + 0.010, x1 - 0.010, 0.018, 0.004);
  const p: number[] = [], ix: number[] = [];
  for (const y of [y0, y1]) for (const poly of [outer, inner]) for (const [x, zz] of poly) p.push(x, y, zz);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    // Lower/upper rim plus outer/inner walls: open center, closed metal.
    ix.push(i, j, 8 + i, j, 8 + j, 8 + i);
    ix.push(16 + i, 24 + i, 16 + j, 16 + j, 24 + i, 24 + j);
    ix.push(i, 16 + i, j, j, 16 + i, 16 + j);
    ix.push(8 + i, 8 + j, 24 + i, 8 + j, 24 + j, 24 + i);
  }
  return solid('serrated-open-cage', 'alloy', p, ix);
}

/** Open metal cage and hinge, not a rubber rod or a second set of pegs. */
export function supermotoFootpegSurfaces(side: number, target: FitPoint = SUPERMOTO_PEG): FitSurface[] {
  if (side !== -1 && side !== 1) throw new Error('Footpeg side must be -1 or 1');
  const [x, y, z] = target, inside = x - 0.052, outside = x + 0.052;
  const hingeX = inside - 0.013;
  const pieces: FitSurface[] = [];
  const mount: [number, number][] = [[0.128, 0.405], [0.13, 0.440], [0.147, 0.442],
    [hingeX + 0.010, y - 0.002], [hingeX + 0.005, y - 0.030], [hingeX - 0.017, y - 0.027]];
  for (const offset of [-0.023, 0.018]) pieces.push(prism('frame-clevis', 'dark', mount, z + offset, z + offset + 0.005));
  pieces.push(pin('hinge-pin', hingeX, y - 0.012, z, 0.009, 0.064));
  pieces.push(pin('hex-head', hingeX, y - 0.012, z + 0.034, 0.0105, 0.006, 6));
  pieces.push(box('hinge-tongue', 'dark', hingeX, inside + 0.014, y - 0.018, y - 0.005, z - 0.014, z + 0.014));
  pieces.push(cage(inside, outside, y - 0.0135, y - 0.0015, z));
  pieces.push(box('open-cage-crossbar', 'alloy', x - 0.004, x + 0.004, y - 0.011, y - 0.0015, z - 0.02, z + 0.02));
  for (let i = 0; i < 5; i++) for (const edge of [-1, 1]) {
    const tx = inside + 0.014 + i * 0.019;
    pieces.push(prism('grip-tooth', 'alloy', [[tx - 0.0045, y - 0.003], [tx + 0.0045, y - 0.003],
      [tx + 0.0015, y + 0.0035], [tx - 0.0015, y + 0.0035]],
    z + edge * 0.025 - 0.004, z + edge * 0.025 + 0.004));
  }
  if (side < 0) for (const piece of pieces) {
    for (let i = 0; i < piece.positions.length; i += 3) piece.positions[i] *= -1;
    for (let i = 0; i < piece.indices.length; i += 3) [piece.indices[i + 1], piece.indices[i + 2]] = [piece.indices[i + 2], piece.indices[i + 1]];
  }
  return pieces;
}

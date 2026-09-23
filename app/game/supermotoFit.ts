/** Supermoto-only dimensions, in unscaled motorcycle coordinates. Front is -Z. */
export type FitPoint = [number, number, number];

/** Shared physical contact dimensions; front is -Z, both rims are 17 inches. */
export const SUPERMOTO_CHASSIS = Object.freeze({
  frontAxle: -0.690,
  rearAxle: 0.700,
  wheelRadius: 0.318,
  rimRadius: 0.2159,
  frontTireWidth: 0.146,
  rearTireWidth: 0.180,
  forkTopY: 1.02,
});

// Rendering-only stance adjustment. Gameplay collision/ramp datums continue
// to use SUPERMOTO_CHASSIS; the visible front wheel sits a little farther out
// so the Supermoto reads slim instead of compressed.
export const SUPERMOTO_RENDER_FRONT_AXLE = -0.768;
export const SUPERMOTO_FRONT_FENDER_SHIFT =
  SUPERMOTO_RENDER_FRONT_AXLE - SUPERMOTO_CHASSIS.frontAxle;

// One contact datum for the actual pegs AND the existing rider IK/boot generator.
export const SUPERMOTO_PEG: FitPoint = [0.26, 0.385, 0.105];
export const SUPERMOTO_GRIP: FitPoint = [0.35, 1.112, -0.335];

// Thin radiator wings leave the black fuel tank visible behind their rear seam.
export const SUPERMOTO_SHROUD: FitPoint[] = [
  [0.160, 0.925, -0.500],
  [0.173, 0.970, -0.345],
  [0.182, 0.980, -0.285],
  [0.164, 0.935, -0.025],
  [0.130, 0.944, 0.165],
  [0.147, 0.877, 0.040],
  [0.176, 0.812, -0.060],
  [0.181, 0.655, -0.175],
  [0.183, 0.718, -0.285],
  [0.187, 0.825, -0.342],
];

// One slim continuous outer side/tail cover. Its lower edge only masks the
// upper frame rail; the shock, swingarm and airbox remain readable below it.
export const SUPERMOTO_SIDE_COVER: FitPoint[] = [
  [0.125, 0.944, 0.169],
  [0.107, 0.955, 0.330],
  [0.100, 0.989, 0.530],
  [0.097, 1.022, 0.690],
  [0.088, 1.050, 0.850],
  [0.096, 1.012, 0.890],
  [0.105, 0.946, 0.790],
  [0.113, 0.905, 0.620],
  [0.120, 0.880, 0.450],
  [0.125, 0.870, 0.300],
  [0.129, 0.890, 0.205],
  [0.130, 0.900, 0.174],
];

/** Rendered sheet cross-sections: z, half width, crown height, edge height. */
export const SUPERMOTO_TAIL_FENDER: [number, number, number, number][] = [
  [0.17, 0.123, 0.013, 0.946],
  [0.33, 0.108, 0.014, 0.955],
  [0.53, 0.102, 0.016, 0.989],
  [0.69, 0.095, 0.017, 1.022],
  [0.82, 0.086, 0.018, 1.052],
  [0.90, 0.064, 0.016, 1.064],
];

// Keep tail-contact gameplay on the previous physical datum while the visible
// moulding is refined independently.
export const SUPERMOTO_TAIL_CONTACT_TIP: [number, number, number, number] =
  [0.90, 0.073, 0.019, 1.065];

export const SUPERMOTO_SHOCK_TOP: FitPoint = [0, 0.840, 0.090];
export const SUPERMOTO_SHOCK_BOTTOM: FitPoint = [0, 0.500, 0.430];

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

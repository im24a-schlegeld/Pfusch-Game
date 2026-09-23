/** Supermoto-only dimensions, in unscaled motorcycle coordinates. Front is -Z. */
export type FitPoint = [number, number, number];

// One contact datum for the actual pegs AND the existing rider IK/boot generator.
export const SUPERMOTO_PEG: FitPoint = [0.26, 0.385, 0.105];

// Keep the tank/seat attachment edge; extend the radiator plastics downward.
export const SUPERMOTO_SHROUD: FitPoint[] = [
  [0.138, 0.965, -0.408],
  [0.194, 0.965, -0.265],
  [0.182, 0.927, -0.045],
  [0.142, 0.946, 0.12],
  [0.147, 0.817, 0.073],
  [0.172, 0.645, -0.075],
  [0.194, 0.632, -0.292],
  [0.201, 0.817, -0.355],
];

// Deep lower tip retained. Narrower cheeks sit ABOVE the existing silencer,
// rather than flaring outward around it; both sides share the same boundary.
export const SUPERMOTO_SIDE_COVER: FitPoint[] = [
  [0.136, 0.944, 0.112],
  // The top seam enters the fender's actual cross section at each station.
  [0.105, 0.946, 0.170],
  [0.111, 0.952, 0.330],
  [0.099, 0.997, 0.570],
  [0.083, 1.030, 0.790],
  [0.062, 1.036, 0.838],
  [0.148, 0.873, 0.742],
  [0.162, 0.808, 0.582],
  [0.174, 0.744, 0.408],
  [0.166, 0.626, 0.246],
  [0.151, 0.668, 0.176],
  [0.146, 0.836, 0.126],
];

/** Wider rear mudguard. Tail-contact physics reads the final station's upper tip. */
export const SUPERMOTO_TAIL_FENDER: [number, number, number, number][] = [
  [0.17, 0.108, 0.011, 0.946],
  [0.33, 0.117, 0.014, 0.952],
  [0.57, 0.104, 0.017, 0.997],
  [0.79, 0.088, 0.017, 1.030],
  [0.97, 0.066, 0.013, 1.049],
  [1.045, 0.051, 0.011, 1.056],
];

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

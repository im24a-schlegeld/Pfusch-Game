import { BufferGeometry, Float32BufferAttribute, MathUtils, ShapeUtils, Vector2 } from 'three';
import { SUPERMOTO_TAIL_FENDER } from './supermotoFit';

type Section = readonly [number, number, number, number];
type Point = [number, number, number];

/** A moulded plastic sheet with a closed 4 mm edge, rather than a solid oval. */
function formedSheet(rows: number, columns: number, pointAt: (u: number, v: number) => Point, thickness: Point) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const stride = columns + 1, faceSize = (rows + 1) * stride;
  for (let layer = 0; layer < 2; layer++) for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = row / rows, v = column / columns;
      const p = pointAt(u, v * 2 - 1);
      positions.push(p[0] + layer * thickness[0], p[1] + layer * thickness[1], p[2] + layer * thickness[2]);
      uv.push(v, u);
    }
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * stride + column, b = a + stride;
    indices.push(a, b, a + 1, a + 1, b, b + 1,
      a + faceSize, a + 1 + faceSize, b + faceSize,
      a + 1 + faceSize, b + 1 + faceSize, b + faceSize);
  }
  const rim: number[] = [];
  for (let c = 0; c < columns; c++) rim.push(c);
  for (let r = 0; r < rows; r++) rim.push(r * stride + columns);
  for (let c = columns; c > 0; c--) rim.push(rows * stride + c);
  for (let r = rows; r > 0; r--) rim.push(r * stride);
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i], b = rim[(i + 1) % rim.length];
    indices.push(a, b, a + faceSize, b, b + faceSize, a + faceSize);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function sectionAt(sections: readonly Section[], u: number): Section {
  const station = u * (sections.length - 1), i = Math.min(Math.floor(station), sections.length - 2);
  const t = station - i, a = sections[i], b = sections[i + 1];
  return [
    MathUtils.lerp(a[0], b[0], t), MathUtils.lerp(a[1], b[1], t),
    MathUtils.lerp(a[2], b[2], t), MathUtils.lerp(a[3], b[3], t),
  ];
}

/** Slim, tapered tail with a narrow seat continuing into its pointed tip. */
export function supermotoTailFenderGeometry() {
  return formedSheet(40, 16, (u, v) => {
    const [z, width, crown, edgeY] = sectionAt(SUPERMOTO_TAIL_FENDER, u);
    const tip = MathUtils.smoothstep(u, 0.82, 1);
    const point = MathUtils.smoothstep(Math.abs(v), 0.32, 1) * tip;
    return [
      v * width,
      edgeY + crown * (1 - v * v),
      z - point * 0.018,
    ];
  }, [0, -0.007, 0]);
}

const FRONT_FENDER: readonly Section[] = [
  [-1.180, 0.045, 0.004, 0.775],
  [-1.075, 0.062, 0.009, 0.789],
  [-0.950, 0.084, 0.021, 0.812],
  [-0.815, 0.095, 0.034, 0.844],
  [-0.684, 0.089, 0.037, 0.858],
  [-0.595, 0.080, 0.026, 0.857],
  [-0.520, 0.067, 0.016, 0.835],
  [-0.462, 0.054, 0.010, 0.782],
  [-0.428, 0.038, 0.005, 0.704],
];

/** Thin arched front blade: raised over the tyre, with its nose bending down. */
export function supermotoFrontFenderGeometry(zShift = 0) {
  return formedSheet(48, 20, (u, v) => {
    const [z, width, crown, edgeY] = sectionAt(FRONT_FENDER, u);
    const noseCorner =
      (1 - MathUtils.smoothstep(u, 0, 0.12)) *
      (1 - Math.sqrt(Math.max(0, 1 - v * v)));
    // The center spine is high, with folded shoulders on either side. This
    // gives the blade its moulded trough section without making its wall thick.
    const shoulder = 1 - 0.58 * v * v - 0.42 * Math.pow(v, 6);
    return [
      width * v,
      edgeY + crown * shoulder - 0.025,
      -0.390 + (z + 0.428 + noseCorner * 0.020) * 0.65 + zShift,
    ];
  }, [0, -0.004, 0]);
}

type Outline = readonly (readonly [number, number])[];
const LAMP_OPENING: Outline = [
  [-0.047, 0.943], [0.047, 0.943], [0.068, 0.974],
  [0.058, 1.048], [-0.058, 1.048], [-0.068, 0.974],
];
function maskFrontZ(y: number, x: number) {
  const profile = [[0.89, -0.625], [0.945, -0.663], [1.025, -0.644], [1.096, -0.601], [1.154, -0.564]];
  const i = Math.min(profile.length - 2, Math.max(0, profile.findIndex(p => p[0] >= y) - 1));
  const a = profile[i], b = profile[i + 1];
  return MathUtils.lerp(a[1], b[1], MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1)) + x * x * 2.7;
}

/** Thin shaped front and back faces, including real return walls around holes. */
function maskShell(outline: Outline, hole: Outline | undefined, thickness: number, offset: number) {
  const contours = [outline, ...(hole ? [hole] : [])];
  const points = contours.flat(), count = points.length;
  const triangles = ShapeUtils.triangulateShape(outline.map(p => new Vector2(...p)), hole ? [hole.map(p => new Vector2(...p))] : []);
  const positions: number[] = [], indices: number[] = [], uv: number[] = [];
  for (const depth of [offset, offset + thickness]) for (const [x, y] of points) {
    positions.push(x, y, maskFrontZ(y, x) + depth); uv.push((x + 0.13) / 0.26, (y - 0.89) / 0.27);
  }
  for (const [a, b, c] of triangles) {
    const pa = points[a], pb = points[b], pc = points[c];
    const positive = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) > 0;
    indices.push(a, positive ? c : b, positive ? b : c,
      a + count, (positive ? b : c) + count, (positive ? c : b) + count);
  }
  let first = 0;
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i++) {
      const a = first + i, b = first + (i + 1) % contour.length;
      indices.push(a, b, a + count, b, b + count, a + count);
    }
    first += contour.length;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  const vertex = g.getAttribute('position');
  for (let i = 0; i < vertex.count; i++) {
    // Keep the mask close to the fork while giving it the slightly taller,
    // broader presence of a compact MX/supermoto number plate.
    const y = 0.944 + (vertex.getY(i) - 0.98) * 0.78;
    vertex.setXYZ(i, vertex.getX(i) * 1.25, y,
      vertex.getZ(i) + 0.1585 + (y - 0.926) * 0.30);
  }
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** Cut-corner front mask folds back around the fork, with a real recessed lamp aperture. */
export function supermotoHeadlightMaskGeometry() {
  return maskShell([
    [-0.051, 0.891], [0.051, 0.891], [0.083, 0.910], [0.107, 0.968],
    [0.116, 1.077], [0.102, 1.132], [0.078, 1.154],
    [-0.078, 1.154], [-0.102, 1.132], [-0.116, 1.077], [-0.107, 0.968], [-0.083, 0.910],
  ], LAMP_OPENING, 0.004, 0);
}

function lampOutline(scale: number): Outline {
  return LAMP_OPENING.map(([x, y]) => [x * scale, 0.994 + (y - 0.994) * scale] as const);
}

export function supermotoLampGeometry(part: 'bezel' | 'reflector' | 'glass') {
  if (part === 'bezel') return maskShell(lampOutline(1.045), lampOutline(0.87), 0.013, -0.001);
  return maskShell(lampOutline(0.89), undefined, 0.003, part === 'glass' ? -0.004 : 0.011);
}

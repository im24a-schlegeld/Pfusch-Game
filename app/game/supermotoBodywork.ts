import { BufferGeometry, Float32BufferAttribute, MathUtils, ShapeUtils, Vector2 } from 'three';
import { SUPERMOTO_SHROUD, SUPERMOTO_SIDE_COVER, SUPERMOTO_TAIL_FENDER, SUPERMOTO_FRONT_FENDER } from './supermotoFit';

type Section = readonly [number, number, number, number];
type Point = [number, number, number];

/** Two moulded faces sharing a thin return edge. Interior crease vertices are
 * real folds in the panel; the ordered outline remains first in each face. */
function sideSheet(side: number, outline: Point[], creases: Point[], regions: number[][]) {
  const points = [...outline, ...creases], faceSize = points.length;
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (const offset of [0.002, -0.002]) for (const [x, y, z] of points) {
    positions.push(side * (x + offset), y, z);
    uv.push((z + 0.5) / 1.5, (y - 0.65) / 0.35);
  }
  for (const region of regions) {
    const projected = region.map(i => new Vector2(points[i][2], points[i][1]));
    for (const face of ShapeUtils.triangulateShape(projected, [])) {
      const [a, b, c] = face.map(i => region[i]);
      const pa = points[a], pb = points[b], pc = points[c];
      const outward = side * ((pb[1] - pa[1]) * (pc[2] - pa[2]) - (pb[2] - pa[2]) * (pc[1] - pa[1])) > 0;
      const b0 = outward ? b : c, c0 = outward ? c : b;
      indices.push(a, b0, c0, a + faceSize, c0 + faceSize, b0 + faceSize);
    }
  }
  for (let a = 0; a < outline.length; a++) {
    const b = (a + 1) % outline.length;
    if (side > 0) indices.push(a, a + faceSize, b, b, a + faceSize, b + faceSize);
    else indices.push(a, b, a + faceSize, b, b + faceSize, a + faceSize);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function supermotoShroudGeometry(side: number) {
  return sideSheet(side, SUPERMOTO_SHROUD, [
    [0.191, 0.918, -0.280], [0.181, 0.900, -0.150], [0.149, 0.917, 0.040],
  ], [
    [0, 1, 2, 3, 4, 14, 13, 12],
    [0, 12, 13, 14, 4, 5, 6, 7, 8, 9, 10, 11],
  ]);
}

export function supermotoSideCoverGeometry(side: number) {
  return sideSheet(side, SUPERMOTO_SIDE_COVER, [
    [0.173, 0.818, 0.290], [0.145, 0.912, 0.540],
  ], [
    [0, 1, 2, 3, 4, 12, 11],
    [0, 11, 12, 4, 5, 6, 7, 8, 9, 10],
  ]);
}

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

/** Broad, gently squared-off tail, with a narrow seat continuing into its root. */
export function supermotoTailFenderGeometry() {
  return formedSheet(40, 16, (u, v) => {
    const [z, width, crown, edgeY] = sectionAt(SUPERMOTO_TAIL_FENDER, u);
    const corner = MathUtils.smoothstep(u, 0.94, 1) * MathUtils.smoothstep(Math.abs(v), 0.66, 1);
    return [v * width, edgeY + crown * (1 - v * v), z - corner * 0.013];
  }, [0, -0.007, 0]);
}

/** Thin arched front blade: raised over the tyre, with its nose bending down. */
export function supermotoFrontFenderGeometry() {
  return formedSheet(48, 20, (u, v) => {
    const [z, width, crown, edgeY] = sectionAt(SUPERMOTO_FRONT_FENDER, u);
    const noseCorner = (1 - MathUtils.smoothstep(u, 0, 0.09)) * (1 - Math.sqrt(Math.max(0, 1 - v * v)));
    // The center spine is high, with folded shoulders on either side. This
    // gives the blade its moulded trough section without making its wall thick.
    const shoulder = 1 - 0.58 * v * v - 0.42 * Math.pow(v, 6);
    return [width * v, edgeY + crown * shoulder, z + noseCorner * 0.024];
  }, [0, -0.004, 0]);
}

type Outline = readonly (readonly [number, number])[];
const LAMP_OPENING: Outline = [
  [-0.038, 0.934], [0.038, 0.934], [0.070, 1.007],
  [0.069, 1.067], [-0.069, 1.067], [-0.070, 1.007],
];
function maskFrontZ(y: number, x: number) {
  const profile = [[0.885, -0.538], [0.935, -0.559], [1.010, -0.520], [1.080, -0.464], [1.140, -0.420]];
  const next = profile.findIndex(p => p[0] >= y);
  const i = next < 0 ? profile.length - 2 : Math.max(0, next - 1);
  const a = profile[i], b = profile[i + 1];
  return MathUtils.lerp(a[1], b[1], MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1)) + x * x * 2.0;
}

/** Visible lens center, shared by the real light anchor and the lamp mesh. */
export const SUPERMOTO_LENS_FACE: Point = [0, 1.006, maskFrontZ(1.006, 0) - 0.004];

/** Thin shaped front and back faces, including real return walls around holes. */
function maskShell(outline: Outline, hole: Outline | undefined, thickness: number, offset: number, lensCenter = false, ridge?: Outline) {
  const contours = [outline, ...(hole ? [hole] : [])];
  const points = contours.flat();
  const ridgeStart = points.length;
  if (ridge) points.push(...ridge);
  if (lensCenter) points.push([SUPERMOTO_LENS_FACE[0], SUPERMOTO_LENS_FACE[1]]);
  const count = points.length;
  const triangles = ridge && hole
    ? [
      ...ShapeUtils.triangulateShape(outline.map(p => new Vector2(...p)), [ridge.map(p => new Vector2(...p))])
        .map(face => face.map(i => i < outline.length ? i : ridgeStart + i - outline.length)),
      ...ShapeUtils.triangulateShape(ridge.map(p => new Vector2(...p)), [hole.map(p => new Vector2(...p))])
        .map(face => face.map(i => i < ridge.length ? ridgeStart + i : outline.length + i - ridge.length)),
    ]
    : lensCenter
    ? outline.map((_, i) => [i, (i + 1) % outline.length, count - 1])
    : ShapeUtils.triangulateShape(outline.map(p => new Vector2(...p)), hole ? [hole.map(p => new Vector2(...p))] : []);
  const positions: number[] = [], indices: number[] = [], uv: number[] = [];
  for (const depth of [offset, offset + thickness]) for (const [i, [x, y]] of points.entries()) {
    const ridgeDepth = ridge && i >= ridgeStart ? -0.008 : 0;
    positions.push(x, y, maskFrontZ(y, x) + depth + ridgeDepth); uv.push((x + 0.13) / 0.26, (y - 0.885) / 0.255);
  }
  for (const [a, b, c] of triangles) {
    const pa = points[a], pb = points[b], pc = points[c];
    const positive = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) > 0;
    indices.push(a, positive ? c : b, positive ? b : c,
      a + count, (positive ? b : c) + count, (positive ? c : b) + count);
  }
  let first = 0;
  for (const [contourIndex, contour] of contours.entries()) {
    for (let i = 0; i < contour.length; i++) {
      const a = first + i, b = first + (i + 1) % contour.length;
      if (contourIndex === 0) indices.push(a, b, a + count, b, b + count, a + count);
      else indices.push(a, a + count, b, b, a + count, b + count);
    }
    first += contour.length;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** Cut-corner front mask folds back around the fork, with a real recessed lamp aperture. */
export function supermotoHeadlightMaskGeometry() {
  return maskShell([
    [-0.047, 0.885], [0.047, 0.885], [0.077, 0.913], [0.108, 0.988],
    [0.125, 1.086], [0.118, 1.128], [0.099, 1.140],
    [-0.099, 1.140], [-0.118, 1.128], [-0.125, 1.086], [-0.108, 0.988], [-0.077, 0.913],
  ], LAMP_OPENING, 0.004, 0, false, lampOutline(1.20));
}

function lampOutline(scale: number): Outline {
  return LAMP_OPENING.map(([x, y]) => [x * scale, 1.006 + (y - 1.006) * scale] as const);
}

export function supermotoLampGeometry(part: 'bezel' | 'reflector' | 'glass') {
  if (part === 'bezel') return maskShell(lampOutline(1.045), lampOutline(0.87), 0.013, -0.001);
  if (part === 'glass') return maskShell(lampOutline(0.89), undefined, 0.003, -0.004, true);
  // The reflector is a shallow faceted bowl behind the clear lens. A flat
  // silver plate reads as an opaque grey screen at normal riding distances.
  // Its small central aperture seats the bulb instead of drawing a white dot
  // floating on an uninterrupted surface.
  const outer = lampOutline(0.89), geometry = maskShell(outer, lampOutline(0.16), 0.003, 0.006);
  const p = geometry.getAttribute('position'), faceSize = p.count / 2;
  for (let i = 0; i < p.count; i++) if (i % faceSize >= outer.length) p.setZ(i, p.getZ(i) + 0.031);
  // Match each outer edge with the corresponding throat edge. Generic hole
  // triangulation draws long diagonals across unrelated reflector sectors.
  const indices: number[] = [], n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = i, b = j, c = i + n, d = j + n;
    indices.push(a, c, b, b, c, d,
      a + faceSize, b + faceSize, c + faceSize, b + faceSize, d + faceSize, c + faceSize,
      a, b, a + faceSize, b, b + faceSize, a + faceSize,
      c, c + faceSize, d, d, c + faceSize, d + faceSize);
  }
  geometry.setIndex(indices);
  const reflector = geometry.toNonIndexed();
  geometry.dispose();
  reflector.computeVertexNormals(); reflector.computeBoundingBox(); reflector.computeBoundingSphere();
  return reflector;
}

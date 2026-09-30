import { BufferGeometry, Float32BufferAttribute, MathUtils, ShapeUtils, Vector2 } from 'three';
import { SUPERMOTO_SIDE_COVER, SUPERMOTO_TAIL_FENDER, SUPERMOTO_FRONT_FENDER } from './supermotoFit';
export { supermotoShroudGeometry } from './supermotoTank';

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

export function supermotoSideCoverGeometry(side: number) {
  return sideSheet(side, SUPERMOTO_SIDE_COVER, [
    [0.173, 0.818, 0.290], [0.145, 0.912, 0.540],
  ], [
    [0, 1, 2, 3, 4, 12, 11],
    [0, 11, 12, 4, 5, 6, 7, 8, 9, 10],
  ]);
}

/** A moulded plastic sheet with a closed 4 mm edge, rather than a solid oval. */
function formedSheet(rows: number, columns: number, pointAt: (u: number, v: number) => Point, thickness: Point, mirrorDiagonals = false) {
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
    if (mirrorDiagonals && column >= columns / 2)
      indices.push(a, b, b + 1, a, b + 1, a + 1,
        a + faceSize, b + 1 + faceSize, b + faceSize,
        a + faceSize, a + 1 + faceSize, b + 1 + faceSize);
    else indices.push(a, b, a + 1, a + 1, b, b + 1,
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

/** Shape-preserving longitudinal bends; unlike an unconstrained spline,
 * these tangents cannot overshoot the tyre-clearance stations. Width stays
 * piecewise linear so the real stepped outline is not rounded into an oval. */
function frontFenderSectionAt(u: number): Section {
  const sections = SUPERMOTO_FRONT_FENDER;
  const station = u * (sections.length - 1), i = Math.min(Math.floor(station), sections.length - 2);
  const t = station - i, a = sections[i], b = sections[i + 1], span = b[0] - a[0];
  const slope = (index: number, component: 2 | 3) => {
    const secant = (n: number) => (sections[n + 1][component] - sections[n][component])
      / (sections[n + 1][0] - sections[n][0]);
    if (index === 0) return secant(0);
    if (index === sections.length - 1) return secant(index - 1);
    const left = secant(index - 1), right = secant(index);
    if (left * right <= 0) return 0;
    const before = sections[index][0] - sections[index - 1][0];
    const after = sections[index + 1][0] - sections[index][0];
    const w1 = 2 * after + before, w2 = after + 2 * before;
    return (w1 + w2) / (w1 / left + w2 / right);
  };
  const bend = (component: 2 | 3) => (2 * t ** 3 - 3 * t ** 2 + 1) * a[component]
    + (t ** 3 - 2 * t ** 2 + t) * span * slope(i, component)
    + (-2 * t ** 3 + 3 * t ** 2) * b[component]
    + (t ** 3 - t ** 2) * span * slope(i + 1, component);
  return [MathUtils.lerp(a[0], b[0], t), MathUtils.lerp(a[1], b[1], t), bend(2), bend(3)];
}

/** Fit the marked crown beneath the mask and shorten the forward blade.
 * Monotone tangents avoid a kink at the mounting row or rear return. */
function frontFenderMountedZ(z: number) {
  const nose = -1.045, crown = -0.665, rear = -0.452, fittedCrown = -0.550, fittedNose = -0.925;
  const frontSlope = (fittedCrown - fittedNose) / (crown - nose);
  const rearSlope = (rear - fittedCrown) / (rear - crown);
  const tangent = 2 * frontSlope * rearSlope / (frontSlope + rearSlope);
  const before = z <= crown;
  const a = before ? nose : crown, b = before ? crown : rear;
  const outA = before ? fittedNose : fittedCrown, outB = before ? fittedCrown : rear;
  const m0 = before ? frontSlope : tangent, m1 = before ? tangent : rearSlope;
  const t = MathUtils.clamp((z - a) / (b - a), 0, 1);
  return (2 * t ** 3 - 3 * t * t + 1) * outA
    + (t ** 3 - 2 * t * t + t) * (b - a) * m0
    + (-2 * t ** 3 + 3 * t * t) * outB
    + (t ** 3 - t * t) * (b - a) * m1;
}

function frontFenderPointAt(u: number, v: number): Point {
  const folds = [[0, 1], [0.25, 0.94], [0.50, 0.35], [0.625, 0.35], [0.75, 0.50], [1, 0]];
    const section = frontFenderSectionAt(u), [z, width] = section, across = Math.abs(v);
    const segment = Math.max(0, folds.findIndex(p => p[0] >= across) - 1);
    const a = folds[segment], b = folds[segment + 1];
    const height = MathUtils.lerp(a[1], b[1], (across - a[0]) / (b[0] - a[0]));
    // Clip the two corners of the broad nose. Use physical longitudinal
    // distance so dense first stations cannot fold back over one another.
    const noseCorner = 0.020 * MathUtils.smoothstep(across, 0.55, 1)
      * (1 - MathUtils.smoothstep(z, -1.045, -0.915));
    const pointZ = z + noseCorner;
    let profile = section;
    if (noseCorner > 0) {
      const next = SUPERMOTO_FRONT_FENDER.findIndex(station => station[0] >= pointZ);
      const i = Math.max(0, next - 1), start = SUPERMOTO_FRONT_FENDER[i][0];
      const t = (pointZ - start) / (SUPERMOTO_FRONT_FENDER[i + 1][0] - start);
      profile = frontFenderSectionAt((i + t) / (SUPERMOTO_FRONT_FENDER.length - 1));
    }
    // The shoulder notch only cuts the outer flange. Keep the central rib
    // continuous through it instead of pinching the entire cross-section.
    const spineWidth = z > -0.915 && z < -0.760
      ? Math.max(width, MathUtils.lerp(0.099, 0.090, (z + 0.915) / 0.155))
      : width;
    const x = across <= 0.5 ? across * spineWidth
      : MathUtils.lerp(spineWidth * 0.5, width, (across - 0.5) * 2);
    // The reinforcing folds fade into the smooth leading lip and rear skirt;
    // carrying the channels all the way to either cut edge creates two bumps.
    const foldStrength = MathUtils.smoothstep(pointZ, -1.015, -0.945)
      * (1 - MathUtils.smoothstep(pointZ, -0.520, -0.470));
    const crownHeight = MathUtils.lerp(1 - v * v, height, foldStrength);
    return [Math.sign(v) * x * 0.86, profile[3] + profile[2] * crownHeight - 0.050, frontFenderMountedZ(pointZ)];
}

/** The holder seats on the actual moulded crown, not its previous rear slope. */
export const SUPERMOTO_FRONT_FENDER_MOUNT: Point = frontFenderPointAt(
  SUPERMOTO_FRONT_FENDER.findIndex(row => row[0] === -0.665) / (SUPERMOTO_FRONT_FENDER.length - 1),
  0.034 / 0.091,
);

/** One thin moulded part: broad central spine, recessed side channels,
 * kicked-out shoulders, rounded descending nose and short rear return. */
export function supermotoFrontFenderGeometry() {
  return formedSheet(60, 16, frontFenderPointAt, [0, -0.004, 0], true);
}

type Outline = readonly (readonly [number, number])[];
const LAMP_OPENING: Outline = [
  [-0.038, 0.934], [0.038, 0.934], [0.070, 1.007],
  [0.069, 1.067], [-0.069, 1.067], [-0.070, 1.007],
];
function maskFrontZ(y: number, x: number) {
  const profile = [[0.885, -0.547], [0.935, -0.523], [1.010, -0.488], [1.080, -0.455], [1.140, -0.426]];
  const next = profile.findIndex(p => p[0] >= y);
  const i = next < 0 ? profile.length - 2 : Math.max(0, next - 1);
  const a = profile[i], b = profile[i + 1];
  return MathUtils.lerp(a[1], b[1], MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1)) + x * x * 2.0 - 0.004;
}

/** Visible lens center, shared by the real light anchor and the lamp mesh. */
export const SUPERMOTO_LENS_FACE: Point = [0, 1.006, maskFrontZ(1.006, 0) - 0.004];
export const SUPERMOTO_LAMP_BULB: Point = [0, 1.006, SUPERMOTO_LENS_FACE[2] + 0.030];
/** Real back-face attachment points; mirror X for the other fork strap. */
export const SUPERMOTO_MASK_STRAP_ANCHORS: Point[] = [[0.077, 0.913], [0.108, 0.988]]
  .map(([x, y]) => [x, y, maskFrontZ(y, x) + 0.004]);

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

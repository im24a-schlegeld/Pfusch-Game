import * as THREE from 'three';

type Point = [number, number, number];
type HelmetMesh = THREE.Mesh<
  THREE.BufferGeometry,
  THREE.MeshStandardMaterial[]
>;
const vector = (point: Point) => new THREE.Vector3(...point);

function material(color: string, metalness = 0, roughness = 0.65) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

/** An outer surface and its inward copy meet only around their boundary.
 * Holes in the supplied surface remain real holes, with finite wall thickness. */
function thickGeometry(outer: Point[], faces: number[], inner: Point[]) {
  const count = outer.length;
  const indices = [...faces];
  const innerStart = indices.length;
  for (let i = 0; i < faces.length; i += 3)
    indices.push(faces[i] + count, faces[i + 2] + count, faces[i + 1] + count);
  const boundary = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < faces.length; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = faces[i + j],
        b = faces[i + ((j + 1) % 3)];
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const edge = boundary.get(key);
      if (edge) edge.count++;
      else boundary.set(key, { a, b, count: 1 });
    }
  const rimStart = indices.length;
  for (const { a, b, count: uses } of boundary.values())
    if (uses === 1) indices.push(a, a + count, b, b, a + count, b + count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([...outer, ...inner].flat(), 3),
  );
  geometry.setIndex(indices);
  geometry.addGroup(0, innerStart, 0);
  geometry.addGroup(innerStart, rimStart - innerStart, 1);
  geometry.addGroup(rimStart, indices.length - rimStart, 2);
  geometry.computeVertexNormals();
  return geometry;
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  materials: THREE.MeshStandardMaterial[],
  name: string,
) {
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// Equipment dimensions in metres, in the caller's unchanged head space.
// Unlike v2 there is no frozen "strap belt" surrounded by a differently
// deformed shell. The shell, edge binding and band share one continuous loft.
const sections: [number, number, number, number][] = [
  [-0.180, 0.036, 0.207, 0.083],
  [-0.165, 0.055, 0.212, 0.096],
  [-0.140, 0.078, 0.222, 0.113],
  [-0.108, 0.098, 0.229, 0.129],
  [-0.074, 0.113, 0.205, 0.136],
  [-0.040, 0.123, 0.174, 0.138],
  [0.000, 0.127, 0.151, 0.138],
  [0.048, 0.124, 0.143, 0.137],
  [0.085, 0.114, 0.130, 0.129],
  [0.116, 0.096, 0.105, 0.113],
  [0.139, 0.064, 0.072, 0.081],
  [0.151, 0.028, 0.031, 0.037],
  [0.154, 0.001, 0.002, 0.003],
];

const lerp = THREE.MathUtils.lerp;
const smooth = THREE.MathUtils.smoothstep;
const wrappedAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const apertureAngle = 1.25;

// Shape-preserving cubic slopes avoid the horizontal ridges of the previous
// piecewise-linear dome, without overshooting the measured equipment bounds.
const sectionSlopes = [1, 2, 3].map((column) => {
  const secant = sections.slice(1).map((p, i) =>
    (p[column] - sections[i][column]) / (p[0] - sections[i][0]));
  return sections.map((_, i) => {
    if (i === 0) return secant[0];
    if (i === sections.length - 1) return secant[secant.length - 1];
    const before = secant[i - 1], after = secant[i];
    if (before * after <= 0) return 0;
    const h0 = sections[i][0] - sections[i - 1][0];
    const h1 = sections[i + 1][0] - sections[i][0];
    const w0 = 2 * h1 + h0, w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / before + w1 / after);
  });
});

function sectionValue(y: number, column: number) {
  let i = 1;
  while (i < sections.length - 1 && sections[i][0] < y) i++;
  const a = sections[i - 1], b = sections[i];
  const h = b[0] - a[0];
  const t = THREE.MathUtils.clamp((y - a[0]) / h, 0, 1);
  const t2 = t * t, t3 = t2 * t;
  const slopes = sectionSlopes[column - 1];
  return (2 * t3 - 3 * t2 + 1) * a[column] +
    (t3 - 2 * t2 + t) * h * slopes[i - 1] +
    (-2 * t3 + 3 * t2) * b[column] +
    (t3 - t2) * h * slopes[i];
}

function shellPoint(y: number, angle: number): Point {
  const a = wrappedAngle(angle);
  const theta = Math.abs(a);
  const width = sectionValue(y, 1);
  const front = sectionValue(y, 2);
  const rear = sectionValue(y, 3);
  let sx = Math.sin(a), cz = Math.cos(a);
  if (theta < Math.PI / 2) {
    const corners = [0, 0.24, 0.56, 0.85, apertureAngle, Math.PI / 2];
    let j = 1;
    while (corners[j] < theta) j++;
    const t = (theta - corners[j - 1]) / (corners[j] - corners[j - 1]);
    const angular = 1 - smooth(y, -0.076, -0.03);
    sx = lerp(sx, Math.sign(a) * lerp(Math.sin(corners[j - 1]),
      Math.sin(corners[j]), t), angular);
    cz = lerp(cz, lerp(Math.cos(corners[j - 1]), Math.cos(corners[j]), t), angular);
  }
  // Blend the hemispheres continuously through the temples. The former
  // front/rear Z offset jumped by 11 mm at PI/2 and made a visible side seam.
  const depth = lerp(front, rear, smooth(theta, 1.3, 1.85));
  return [sx * width, y, 0.003 - cz * depth];
}

/** The chin is equipment, not a change to the rider's skeleton or scale. */
function contours(a: number) {
  const theta = Math.abs(wrappedAngle(a));
  const lowerProfile: [number, number][] = [
    [0, -0.177], [0.24, -0.174], [0.56, -0.161], [0.85, -0.144],
    [1.25, -0.123], [1.65, -0.109], [2.05, -0.100],
    [2.55, -0.090], [Math.PI, -0.087],
  ];
  let i = 1;
  while (i < lowerProfile.length - 1 && lowerProfile[i][0] < theta) i++;
  const a0 = lowerProfile[i - 1], a1 = lowerProfile[i];
  const t = (theta - a0[0]) / (a1[0] - a0[0]);
  const corner = smooth(theta, 0.35, apertureAngle);
  return {
    bottom: lerp(a0[1], a1[1], t),
    lower: -0.065 + 0.025 * corner,
    upper: 0.067 - 0.016 * corner,
  };
}

/** Straight folded chin face; the bottom returns gently toward the neck. */
function chinFrontZ(y: number) {
  return y <= -0.108
    ? -0.226 - 0.28 * (y + 0.108)
    : -0.226 + 0.59 * (y + 0.108);
}

function moldedPoint(y: number, angle: number): Point {
  const p = shellPoint(y, angle);
  const theta = Math.abs(wrappedAngle(angle));
  const chin = (1 - smooth(y, -0.073, -0.041)) *
    (1 - smooth(theta, 0.24, apertureAngle));
  p[2] += (chinFrontZ(y) - shellPoint(y, 0)[2]) * chin;
  // A narrow, faceted chin instead of an inflated muzzle. The cranium, eye
  // opening and all caller-owned transforms remain independent of this taper.
  p[0] *= 1 - 0.035 * chin;
  return p;
}

type VentQuad = [Point, Point, Point, Point];
type ShellData = {
  geometry: THREE.BufferGeometry;
  vents: VentQuad[];
  angles: number[];
};

function shellGeometry(): ShellData {
  const angles = [...new Set([
    ...Array.from({ length: 96 }, (_, i) => -Math.PI + i * Math.PI / 48),
    ...[-1, 1].flatMap((side) =>
      [0.14, 0.22, 0.24, 0.35, 0.56, 0.7, 0.85, 1.13,
        apertureAngle, 1.35, 1.65, 1.73, 1.94, 2.15].map((a) => a * side)),
  ])].sort((a, b) => a - b);
  const outer: Point[] = [], faces: number[] = [], vents: VentQuad[] = [];
  const lowerRows = [0, 0.08, 0.20, 0.34, 0.48, 0.63, 0.78, 0.90, 1];
  const eyeRows = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
  const upperRows = [0.14, 0.29, 0.46, 0.62, 0.76, 0.87, 0.95, 1];
  const eyeStart = lowerRows.length - 1;
  const upperStart = eyeStart + eyeRows.length;
  const rows = lowerRows.length + eyeRows.length + upperRows.length;
  const count = angles.length;
  for (let row = 0; row < rows; row++) {
    for (const angle of angles) {
      const { bottom, lower, upper } = contours(angle);
      const y = row <= eyeStart ? lerp(bottom, lower, lowerRows[row]) :
        row <= upperStart ? lerp(lower, upper, eyeRows[row - eyeStart - 1]) :
        lerp(upper, 0.154, upperRows[row - upperStart - 1]);
      outer.push(moldedPoint(y, angle));
    }
  }
  for (let row = 0; row < rows - 1; row++) {
    for (let j = 0; j < count; j++) {
      const next = (j + 1) % count;
      const theta = Math.abs(j === count - 1 ? Math.PI :
        (angles[j] + angles[next]) / 2);
      const a = row * count + j, b = (row + 1) * count + j;
      const c = row * count + next, d = (row + 1) * count + next;
      if (row >= eyeStart && row < upperStart && theta < apertureAngle) continue;
      const chinVent = (row === 2 || row === 3) && theta < 0.14;
      const chinSideVent = (row === 2 || row === 3) && theta > 0.22 && theta < 0.56;
      const cheekVent = (row === 2 || row === 3) && theta > 1.35 && theta < 1.65;
      const browVent = row === upperStart + 1 && theta > 0.35 && theta < 0.56;
      const exhaustVent = row === upperStart + 3 && theta > 1.94 && theta < 2.15;
      if (chinVent || chinSideVent || cheekVent || browVent || exhaustVent) {
        vents.push([outer[a], outer[b], outer[d], outer[c]]);
        continue;
      }
      // Mirror the quad diagonal as well as the vertices. Surface-fitted
      // parts then sample exactly the same triangulation on both sides.
      const positiveSide = j === count - 1 || (angles[j] + angles[next]) >= 0;
      faces.push(...(positiveSide ? [a, b, c, c, b, d] : [a, b, d, a, d, c]));
    }
  }
  const crown = outer.length;
  outer.push([0, 0.154, 0.003]);
  for (let j = 0; j < count; j++)
    faces.push(crown, (rows - 1) * count + ((j + 1) % count), (rows - 1) * count + j);
  const remap = new Map<number, number>();
  const points: Point[] = [];
  const compact = faces.map((index) => {
    let target = remap.get(index);
    if (target === undefined) {
      target = points.length;
      remap.set(index, target);
      points.push(outer[index]);
    }
    return target;
  });
  const inner = points.map(([x, y, z]): Point =>
    [x * 0.958, y * 0.976, (z - 0.003) * 0.965 + 0.003]);
  return { geometry: skinNormals(thickGeometry(points, compact, inner)), vents, angles };
}

/** Keep the exterior smooth without averaging it with inward-facing rim
 * triangles. The original goggle geometry does not use this normal treatment. */
function skinNormals(geometry: THREE.BufferGeometry) {
  const p = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  const sums = Array.from({ length: p.count }, () => new THREE.Vector3());
  const point = (i: number) => new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
  for (const group of geometry.groups.slice(0, 2)) {
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      const n = point(b).sub(point(a)).cross(point(c).sub(point(a)));
      sums[a].add(n); sums[b].add(n); sums[c].add(n);
    }
  }
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(
    sums.flatMap((n) => n.normalize().toArray()), 3));
  return geometry;
}

/** Split shading across material boundaries and deliberate hard creases.
 * The cranium stays smoothly shaded; only molded equipment uses this. */
function crisp(geometry: THREE.BufferGeometry, angle = 0.42) {
  const index = geometry.getIndex();
  const attribute = geometry.getAttribute('position');
  const count = index ? index.count : attribute.count;
  const positions: number[] = [];
  const normals: number[] = [];
  const faceNormals: THREE.Vector3[] = [];
  const faceGroups: number[] = [];
  const adjacent = Array.from({ length: attribute.count }, () => [] as number[]);
  const at = (i: number) => index ? index.getX(i) : i;
  const get = (i: number) => new THREE.Vector3(
    attribute.getX(i), attribute.getY(i), attribute.getZ(i));
  for (let i = 0; i < count; i += 3) {
    const a = at(i), b = at(i + 1), c = at(i + 2);
    const normal = get(b).sub(get(a)).cross(get(c).sub(get(a))).normalize();
    const face = i / 3;
    faceNormals.push(normal);
    faceGroups.push(geometry.groups.find((g) => i >= g.start &&
      i < g.start + g.count)?.materialIndex ?? 0);
    adjacent[a].push(face); adjacent[b].push(face); adjacent[c].push(face);
  }
  const threshold = Math.cos(angle);
  for (let i = 0; i < count; i++) {
    const v = at(i);
    const face = Math.floor(i / 3);
    const n = new THREE.Vector3();
    for (const neighbor of adjacent[v]) {
      if (faceGroups[face] === faceGroups[neighbor] &&
        faceNormals[face].dot(faceNormals[neighbor]) >= threshold) {
        n.add(faceNormals[neighbor]);
      }
    }
    n.normalize();
    positions.push(attribute.getX(v), attribute.getY(v), attribute.getZ(v));
    normals.push(n.x, n.y, n.z);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  for (const group of geometry.groups)
    result.addGroup(group.start, group.count, group.materialIndex ?? 0);
  geometry.dispose();
  return result;
}

/** Ear clipping for small, simple 2D outlines; keeps preview/game topology
 * deterministic without importing an additional geometry utility. */
function triangulateLoop(loop: readonly UV[]): number[][] {
  const cross = (a: UV, b: UV, c: UV) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const area = loop.reduce((sum, p, i) => {
    const q = loop[(i + 1) % loop.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const vertices = Array.from({ length: loop.length }, (_, i) => i);
  if (area < 0) vertices.reverse();
  const result: number[][] = [];
  while (vertices.length > 3) {
    let clipped = false;
    for (let j = 0; j < vertices.length; j++) {
      const a = vertices[(j + vertices.length - 1) % vertices.length];
      const b = vertices[j], c = vertices[(j + 1) % vertices.length];
      if (cross(loop[a], loop[b], loop[c]) <= 1e-12) continue;
      const blocked = vertices.some((i) => i !== a && i !== b && i !== c &&
        cross(loop[a], loop[b], loop[i]) >= -1e-12 &&
        cross(loop[b], loop[c], loop[i]) >= -1e-12 &&
        cross(loop[c], loop[a], loop[i]) >= -1e-12);
      if (blocked) continue;
      result.push([a, b, c]);
      vertices.splice(j, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error('Invalid motocross panel outline');
  }
  if (vertices.length === 3) result.push([...vertices]);
  return result;
}

/** Concave polygon triangulation, oriented toward the visible surface. */
function polygonFaces(points: Point[], projection: [number, number],
  normal: THREE.Vector3) {
  const contour = points.map((p): UV => [p[projection[0]], p[projection[1]]]);
  const triangles = triangulateLoop(contour);
  const faces: number[] = [];
  for (const [a, b, c] of triangles) {
    const outward = vector(points[b]).sub(vector(points[a]))
      .cross(vector(points[c]).sub(vector(points[a])));
    faces.push(...(outward.dot(normal) >= 0 ? [a, b, c] : [a, c, b]));
  }
  return faces;
}

// Peak stations run from the rear crown mount toward the front (-Z).
// The widest station is ABOVE the brow, not at the front of the peak.
// Every station after it narrows: the two wings meet in one closed nose.
const peakStations: readonly [number, number][] = [
  [-0.030, 0.095], [-0.061, 0.106], [-0.098, 0.115],
  [-0.130, 0.108], [-0.166, 0.097], [-0.202, 0.083],
  [-0.232, 0.070], [-0.252, 0.058], [-0.266, 0.050],
];
const peakColumns = [-1, -0.88, -0.7, -0.56, -0.4, -0.26, -0.12,
  0, 0.12, 0.26, 0.4, 0.56, 0.7, 0.88, 1];

function peakPoint(row: number, u: number): Point {
  const [z, width] = peakStations[row];
  const across = Math.abs(u);
  const progress = (-z - 0.03) / 0.236;
  const sweptZ = z - 0.024 * across * (1 - progress) + 0.009 * across * progress;
  // Continuous molded peak with side roots, rather than a flat top with
  // disconnected triangular fins below it. Each longitudinal rail is linear.
  const sideProfile = 0.148 + 0.135 * (sweptZ + 0.03);
  const spine = 0.0034 * Math.max(0, 1 - across / 0.22);
  const channel = 0.0018 * Math.max(0, 1 - Math.abs(across - 0.55) / 0.14);
  const wing = across <= 0.58 ? 0.004 * across / 0.58 :
    0.004 + 0.055 * (across - 0.58) / 0.42;
  const molding = (sweptZ + 0.266) / 0.236;
  return [width * u, sideProfile + (spine - channel - wing) * molding, sweptZ];
}

function addPeak(parent: HelmetMesh, finishes: THREE.MeshStandardMaterial[]) {
  const screwMaterial = material('#777d80', 0.8, 0.36);
  const outer: Point[] = [], faces: number[] = [];
  for (let row = 0; row < peakStations.length; row++)
    for (const u of peakColumns) outer.push(peakPoint(row, u));
  for (let row = 0; row < peakStations.length - 1; row++) {
    for (let col = 0; col < peakColumns.length - 1; col++) {
      const middle = Math.abs((peakColumns[col] + peakColumns[col + 1]) / 2);
      // Rear relief slots only. The front three rows are continuous and
      // welded through their shared center column, not two separate fins.
      if ((row === 1 || row === 2) && middle > 0.26 && middle < 0.56) continue;
      const a = row * peakColumns.length + col;
      const b = a + peakColumns.length;
      faces.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  addMesh(parent, crisp(thickGeometry(outer, faces,
    outer.map(([x, y, z]): Point => [x, y - 0.0028, z])), 0.23),
    finishes, 'motocross-peak');

  for (const side of [-1, 1]) {
    // A small root plate follows the shell; the main peak itself supplies
    // the side wing. No large non-planar polygon can stick through the roof.
    const tab: Point[] = [
      moldedPoint(0.090, side * 0.98),
      moldedPoint(0.108, side * 0.98),
      moldedPoint(0.112, side * 1.18),
      moldedPoint(0.089, side * 1.18),
    ];
    const radial = (p: Point) => new THREE.Vector3(p[0], 0, p[2] - 0.003).normalize();
    const outerTab = tab.map((p): Point =>
      vector(p).addScaledVector(radial(p), 0.0012).toArray() as Point);
    const innerTab = tab.map((p): Point =>
      vector(p).addScaledVector(radial(p), -0.0015).toArray() as Point);
    addMesh(parent, crisp(thickGeometry(outerTab,
      polygonFaces(outerTab, [2, 1], new THREE.Vector3(side, 0, 0)), innerTab), 0.45),
      finishes, 'peak-temple-mount');
    const start = moldedPoint(0.100, side * 1.08);
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0062, 0.0067, 0.004, 12), screwMaterial);
    bolt.rotation.z = Math.PI / 2;
    bolt.position.set(start[0] + side * 0.003, 0.100, start[2]);
    bolt.name = 'peak-pivot-bolt';
    bolt.castShadow = true;
    parent.add(bolt);
    const socket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0022, 0.0022, 0.0006, 6), finishes[1]);
    socket.rotation.z = Math.PI / 2;
    socket.position.copy(bolt.position);
    socket.position.x += side * 0.0021;
    socket.name = 'peak-pivot-socket';
    parent.add(socket);
  }
}

/** Sample the actual triangles, not just their parametric approximation.
 * Raised panels taper back into the skin and cannot float off the crown. */
function shellSampler(parent: HelmetMesh) {
  const ray = new THREE.Raycaster();
  return (point: Point, direction?: THREE.Vector3, maximumDistance = 0.085) => {
    const p = vector(point);
    const outward = direction ?? new THREE.Vector3(p.x, p.y * 0.8, p.z - 0.003)
      .normalize();
    ray.set(p.clone().addScaledVector(outward, 0.055), outward.clone().negate());
    const hit = ray.intersectObject(parent, false).find((h) => h.distance < maximumDistance);
    const normal = outward.clone();
    return { p: hit ? hit.point.clone() : p, normal };
  };
}

type SurfaceSampler = ReturnType<typeof shellSampler>;
type UV = [number, number];

function moldedPanel(loop: UV[], pointAt: (u: number, v: number) => Point,
  sample: SurfaceSampler, rise: number) {
  const center = loop.reduce(([u, v], p) => [u + p[0] / loop.length,
    v + p[1] / loop.length] as UV, [0, 0] as UV);
  const inset = loop.map(([u, v]): UV =>
    [lerp(u, center[0], 0.1), lerp(v, center[1], 0.1)]);
  const points: Point[] = [], inner: Point[] = [], faces: number[] = [];
  const normals: THREE.Vector3[] = [];
  const vertices = new Map<string, number>();
  const vertex = (uv: UV, lift: number) => {
    const key = `${uv[0].toFixed(9)}:${uv[1].toFixed(9)}:${lift}`;
    const cached = vertices.get(key);
    if (cached !== undefined) return cached;
    const { p, normal } = sample(pointAt(...uv));
    const index = points.length;
    points.push(p.clone().addScaledVector(normal, lift).toArray() as Point);
    inner.push(p.clone().addScaledVector(normal, -0.0013).toArray() as Point);
    normals.push(normal);
    vertices.set(key, index);
    return index;
  };
  const face = (a: number, b: number, c: number) => {
    const normal = vector(points[b]).sub(vector(points[a]))
      .cross(vector(points[c]).sub(vector(points[a])));
    faces.push(...(normal.dot(normals[a]) >= 0 ? [a, b, c] : [a, c, b]));
  };
  const between = (a: UV, b: UV, t: number): UV =>
    [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  const steps = 5;
  // Sample the bevel and its top over the skin. A single large planar polygon
  // would cut through the rounded cranium and leave disconnected sharp shards.
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    for (let k = 0; k < steps; k++) {
      const a = vertex(between(loop[i], loop[j], k / steps), 0.0012);
      const b = vertex(between(loop[i], loop[j], (k + 1) / steps), 0.0012);
      const c = vertex(between(inset[i], inset[j], k / steps), rise);
      const d = vertex(between(inset[i], inset[j], (k + 1) / steps), rise);
      face(a, b, c); face(b, d, c);
    }
  }
  const bevelCount = faces.length;
  for (const [ia, ib, ic] of triangulateLoop(inset)) {
    const a = inset[ia], b = inset[ib], c = inset[ic];
    const at = (i: number, j: number) => vertex([
      a[0] + (b[0] - a[0]) * i / steps + (c[0] - a[0]) * j / steps,
      a[1] + (b[1] - a[1]) * i / steps + (c[1] - a[1]) * j / steps,
    ], rise);
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps - i; j++) {
        face(at(i, j), at(i + 1, j), at(i, j + 1));
        if (i + j < steps - 1)
          face(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
      }
    }
  }
  const geometry = thickGeometry(points, faces, inner);
  const rim = geometry.groups[2];
  // Separate the bevel normals/material from the curved top. This preserves
  // a crisp molded edge without faceting every triangle across the panel.
  geometry.clearGroups();
  geometry.addGroup(0, bevelCount, 2);
  geometry.addGroup(bevelCount, faces.length - bevelCount, 0);
  geometry.addGroup(faces.length, faces.length, 1);
  geometry.addGroup(rim.start, rim.count, 2);
  return crisp(geometry, Math.PI);
}

/** Batch small molded panels into three material groups instead of adding
 * a draw call for every bevel, vent edge and decorative plane. */
function batch(geometries: THREE.BufferGeometry[]) {
  const positions: number[][] = [[], [], []];
  const normals: number[][] = [[], [], []];
  for (const geometry of geometries) {
    const p = geometry.getAttribute('position');
    const n = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    const groups = geometry.groups.length ? geometry.groups :
      [{ start: 0, count: index ? index.count : p.count, materialIndex: 0 }];
    for (const group of groups) {
      const slot = group.materialIndex ?? 0;
      for (let i = group.start; i < group.start + group.count; i++) {
        const v = index ? index.getX(i) : i;
        positions[slot].push(p.getX(v), p.getY(v), p.getZ(v));
        normals[slot].push(n.getX(v), n.getY(v), n.getZ(v));
      }
    }
    geometry.dispose();
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions.flat(), 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals.flat(), 3));
  let offset = 0;
  for (let i = 0; i < 3; i++) {
    const count = positions[i].length / 3;
    if (count) result.addGroup(offset, count, i);
    offset += count;
  }
  return result;
}

function addSculptedPanels(parent: HelmetMesh, finishes: THREE.MeshStandardMaterial[]) {
  const sample = shellSampler(parent);
  const crownSample: SurfaceSampler = (p) =>
    sample(p, new THREE.Vector3(0, 1, 0), 0.22);
  const pieces: THREE.BufferGeometry[] = [];

  for (const side of [-1, 1]) {
    const jaw = (u: number, a: number) => {
      const { bottom, lower } = contours(a);
      return moldedPoint(lerp(bottom, lower, u), a * side);
    };
    const upper = (y: number, a: number) => moldedPoint(y, side * a);
    const top = (x: number, z: number): Point => [x, 0.155, z];

    // Main lower side panel.
    pieces.push(moldedPanel([
      [0.80, 0.34], [0.97, 0.74], [0.92, 1.08], [0.86, 1.42],
      [0.75, 1.84], [0.61, 1.99], [0.55, 1.58], [0.56, 1.06], [0.44, 0.54],
    ], jaw, sample, 0.0032));

    // Lower jaw blade below the main panel.
    pieces.push(moldedPanel([
      [0.56, 0.42], [0.68, 0.88], [0.63, 1.44], [0.52, 1.88],
      [0.40, 2.02], [0.35, 1.24], [0.42, 0.62],
    ], jaw, sample, 0.0023));

    // Intake surround / cheek detail.
    pieces.push(moldedPanel([
      [0.09, 0.34], [0.20, 0.63], [0.24, 1.03], [0.22, 1.42],
      [0.16, 1.88], [0.07, 2.08], [0.03, 1.28],
    ], jaw, sample, 0.002));

    // Brow line above the eye opening.
    pieces.push(moldedPanel([
      [0.055, 0.82], [0.073, 0.97], [0.081, 1.13],
      [0.072, 1.25], [0.055, 1.21], [0.047, 1.02],
    ], upper, sample, 0.0021));

    // Temple shoulder and rear exhaust surround.
    pieces.push(moldedPanel([
      [0.050, 1.30], [0.076, 1.42], [0.104, 1.66],
      [0.112, 1.88], [0.089, 2.03], [0.055, 1.90],
    ], upper, sample, 0.0021));
    pieces.push(moldedPanel([
      [0.066, 1.94], [0.084, 2.08], [0.105, 2.23],
      [0.096, 2.38], [0.074, 2.36], [0.058, 2.18],
    ], upper, sample, 0.0018));

    // Crown wing above the strap corridor.
    pieces.push(moldedPanel([
      [side * 0.016, -0.085], [side * 0.030, -0.050], [side * 0.041, -0.002],
      [side * 0.046, 0.053], [side * 0.039, 0.090], [side * 0.022, 0.072],
      [side * 0.018, 0.018],
    ], top, crownSample, 0.0022));

    // Small rear crown shoulder.
    pieces.push(moldedPanel([
      [side * 0.030, 0.040], [side * 0.043, 0.082], [side * 0.040, 0.124],
      [side * 0.026, 0.136], [side * 0.018, 0.098], [side * 0.020, 0.060],
    ], top, crownSample, 0.0017));
  }

  // Center roof spine to sharpen the crown silhouette.
  const top = (x: number, z: number): Point => [x, 0.155, z];
  pieces.push(moldedPanel([
    [-0.012, -0.094], [-0.024, -0.040], [-0.020, 0.024],
    [0, 0.108], [0.020, 0.024], [0.024, -0.040], [0.012, -0.094],
  ], top, crownSample, 0.0023));

  addMesh(parent, batch(pieces), finishes, 'motocross-molded-panels');

  // Multi-break chin spine for a sharper front view.
  const splitter: Point[] = [];
  const rows: [number, number, number][] = [
    [-0.173, -0.179, 0.0042],
    [-0.132, -0.132, 0.0073],
    [-0.098, -0.093, 0.0112],
    [-0.071, -0.058, 0.0142],
  ];
  for (const [edgeY, centerY, halfWidth] of rows) {
    for (const side of [-1, 0, 1]) {
      const y = side === 0 ? centerY : edgeY;
      splitter.push([
        side * halfWidth,
        y,
        moldedPoint(y, 0)[2] - (side === 0 ? 0.0023 : 0.0005),
      ]);
    }
  }
  const faces: number[] = [];
  for (let row = 0; row < rows.length - 1; row++) {
    const a = row * 3;
    faces.push(
      a, a + 3, a + 1,
      a + 1, a + 3, a + 4,
      a + 1, a + 4, a + 2,
      a + 2, a + 4, a + 5,
    );
  }
  addMesh(parent, crisp(thickGeometry(
    splitter,
    faces,
    splitter.map(([x, y, z]): Point => [x, y, z + 0.006]),
  ), 0.18), finishes, 'motocross-chin-splitter');
}

function addRearRidge(parent: HelmetMesh, finishes: THREE.MeshStandardMaterial[]) {
  const sample = shellSampler(parent);
  const columns = 28;
  const outer: Point[] = [], inner: Point[] = [], faces: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const angle = 1.94 + u * (2 * Math.PI - 3.88);
      const taper = Math.sin(u * Math.PI);
      const center = 0.088 + 0.021 * taper;
      const height = 0.16 + 0.84 * taper;
      const y = row === 0 ? center + 0.009 * height :
        row === 1 ? center : center - 0.007 * height;
      const guess = moldedPoint(y, angle);
      const radial = new THREE.Vector3(guess[0], 0, guess[2] - 0.006).normalize();
      const { p } = sample(guess, radial);
      // A short molded break, not a long hooked spoiler.
      const projection = row === 1 ? 0.0055 * taper : -0.0012;
      outer.push(p.clone().addScaledVector(radial, projection).toArray() as Point);
      inner.push(p.clone().addScaledVector(radial, -0.004).toArray() as Point);
    }
  }
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column, b = a + columns + 1;
      faces.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  addMesh(parent, crisp(thickGeometry(outer, faces, inner), 0.27),
    finishes, 'motocross-rear-ridge');
}

function addLowerBinding(parent: HelmetMesh, angles: number[],
  rubber: THREE.MeshStandardMaterial) {
  const outer: Point[] = [], faces: number[] = [];
  for (const offset of [0, 0.002, 0.0055]) {
    for (const a of angles) {
      const y = contours(a).bottom + offset;
      const p = vector(moldedPoint(y, a));
      const radial = new THREE.Vector3(p.x, 0, p.z - 0.003).normalize();
      p.addScaledVector(radial, offset === 0.002 ? 0.0015 : 0.0003);
      outer.push(p.toArray() as Point);
    }
  }
  const count = angles.length;
  for (let row = 0; row < 2; row++) {
    for (let j = 0; j < count; j++) {
      const next = (j + 1) % count;
      const a = row * count + j, b = (row + 1) * count + j;
      const c = row * count + next, d = (row + 1) * count + next;
      faces.push(a, b, c, c, b, d);
    }
  }
  const inner = outer.map(([x, y, z]): Point => [x * 0.97, y + 0.0003, z * 0.98]);
  addMesh(parent, crisp(thickGeometry(outer, faces, inner), 0.55),
    [rubber, rubber, rubber], 'motocross-lower-edge-binding');
}

function addVentMesh(parent: HelmetMesh, vents: VentQuad[],
  meshMaterial: THREE.MeshStandardMaterial) {
  const positions: number[] = [];
  // Recessed diagonal grille strips. All vents share one mesh/material.
  // These are real openings in the shell, not black shapes glued on top.
  for (const quad of vents) {
    const [a, b, c, d] = quad.map(vector);
    const normal = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
    const point = (u: number, v: number) => a.clone().lerp(d, u)
      .lerp(b.clone().lerp(c, u), v).addScaledVector(normal, -0.0048);
    const width = a.distanceTo(d);
    const height = a.distanceTo(b);
    const diagonalCount = Math.max(2, Math.ceil((width + height) / 0.004));
    const halfStrip = Math.min(0.04, 0.0004 / Math.max(width, height));
    for (let k = 0; k <= diagonalCount; k++) {
      const intercept = -1 + k * 2 / diagonalCount;
      // Clip both diagonal families to a quad in its local UV space.
      for (const sign of [-1, 1]) {
        const start = Math.max(0, -intercept);
        const end = Math.min(1, 1 - intercept);
        if (end - start < 0.025) continue;
        const uv = (t: number, delta: number) => {
          const u = THREE.MathUtils.clamp(t + delta, 0, 1);
          const v = THREE.MathUtils.clamp(t + intercept - delta, 0, 1);
          return point(u, sign > 0 ? v : 1 - v);
        };
        const p = [uv(start, -halfStrip), uv(end, -halfStrip),
          uv(end, halfStrip), uv(start, halfStrip)];
        for (const index of [0, 1, 2, 0, 2, 3]) positions.push(...p[index].toArray());
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, meshMaterial);
  mesh.name = 'motocross-recessed-vent-mesh';
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
}
// Recess the complete goggle assembly into the eye aperture. Moving the lens
// alone would leave the frame and strap brackets floating in front of it.
const lensZ = (x: number, y: number) =>
  -0.152 + 0.054 * (x / 0.1) ** 2 - 0.0015 * (1 - (y / 0.05) ** 2);

function frameGeometry(innerLoop: Point[], offset: number, depth: number) {
  const outerLoop = innerLoop.map((p, i): Point => {
    const before = innerLoop[(i + innerLoop.length - 1) % innerLoop.length];
    const after = innerLoop[(i + 1) % innerLoop.length];
    const normal = new THREE.Vector2(
      after[1] - before[1],
      before[0] - after[0],
    ).normalize();
    const x = p[0] + normal.x * 0.005,
      y = p[1] + normal.y * 0.005;
    return [x, y, lensZ(x, y) + offset];
  });
  const inner = innerLoop.map(([x, y]): Point => [x, y, lensZ(x, y) + offset]);
  const outer = [...outerLoop, ...inner],
    faces: number[] = [];
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push(i, i + n, j, j, i + n, j + n);
  }
  return thickGeometry(
    outer,
    faces,
    outer.map(([x, y, z]): Point => [x, y, z + depth]),
  );
}

function addGoggles(
  parent: THREE.Object3D,
  trim: THREE.MeshStandardMaterial,
  foam: THREE.MeshStandardMaterial,
  visorColor: string,
) {
  const points: Point[] = [],
    faces: number[] = [];
  const cols = 48,
    rows = 16;
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= cols; j++) {
      const u = (j / cols) * 2 - 1,
        v = i / rows;
      const x = 0.1 * u * (1 - 0.1 * (v * 2 - 1) ** 2);
      const lower =
        -0.036 +
        0.021 * Math.exp(-((u / 0.14) ** 2)) +
        0.008 * Math.abs(u) ** 5;
      const upper = 0.041 - 0.01 * Math.abs(u) ** 4;
      const y = THREE.MathUtils.lerp(lower, upper, v);
      points.push([x, y, lensZ(x, y)]);
    }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j,
        b = a + cols + 1;
      faces.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const lens = new THREE.MeshPhysicalMaterial({
    color: visorColor,
    metalness: 0.72,
    roughness: 0.14,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.1,
  });
  addMesh(
    parent,
    thickGeometry(
      points,
      faces,
      points.map(([x, y, z]): Point => [x, y, z + 0.0016]),
    ),
    [lens, lens, lens],
    'motocross-goggle-lens',
  );
  const boundary = [
    ...Array.from({ length: cols + 1 }, (_, j) => j),
    ...Array.from({ length: rows }, (_, i) => (i + 1) * (cols + 1) + cols),
    ...Array.from({ length: cols }, (_, j) => rows * (cols + 1) + cols - 1 - j),
    ...Array.from({ length: rows - 1 }, (_, i) => (rows - 1 - i) * (cols + 1)),
  ].map((i) => points[i]);
  addMesh(
    parent,
    frameGeometry(boundary, -0.002, 0.012),
    [trim, foam, trim],
    'motocross-goggle-frame',
  );
  addMesh(
    parent,
    frameGeometry(boundary, 0.011, 0.008),
    [foam, foam, foam],
    'goggle-face-seal',
  );
  // The separate nose guard sits beneath the lens notch, attached to the chin liner.
  const nose: Point[] = [
    [-0.032, -0.076, -0.182],
    [0.032, -0.076, -0.182],
    [0.027, -0.049, -0.153],
    [0, -0.022, -0.158],
    [-0.027, -0.049, -0.153],
  ];
  addMesh(
    parent,
    thickGeometry(
      nose,
      [0, 2, 1, 0, 3, 2, 0, 4, 3],
      nose.map(([x, y, z]): Point => [x, y, z + 0.004]),
    ),
    [foam, foam, foam],
    'motocross-breath-guard',
  );
}

/** A thin, surface-fitted textile band. The old two-row ring was generated
 * from a different shell and intersected the rear wall. Sample the actual
 * triangles at every height, and carry the same cross-section into the mounts. */
function addStrap(parent: HelmetMesh) {
  const sample = shellSampler(parent);
  const fabric = material('#171b1e', 0, 0.96);
  const edging = material('#14181a', 0, 0.98);
  const startAngle = apertureAngle + 0.025;
  const endAngle = 2 * Math.PI - startAngle;
  const steps = 128;
  const across = [-1, -0.94, -0.78, -0.4, 0, 0.4, 0.78, 0.94, 1];
  const halfWidth = 0.0185;
  const centerY = (a: number) => 0.003 +
    0.0035 * smooth(Math.abs(wrappedAngle(a)), startAngle, 2.8);
  const lift = (v: number) => Math.abs(v) > 0.94 ? 0.0010 :
    Math.abs(v) > 0.78 ? 0.0016 : 0.0019;
  const onShell = (a: number, v: number) => {
    const y = centerY(a) + v * halfWidth;
    const guess = moldedPoint(y, a);
    const direction = new THREE.Vector3(guess[0], 0, guess[2] - 0.003).normalize();
    const { p } = sample(guess, direction);
    return { p, direction };
  };
  const surface: Point[] = [], inside: Point[] = [], faces: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = lerp(startAngle, endAngle, i / steps);
    for (const v of across) {
      const { p, direction } = onShell(a, v);
      surface.push(p.clone().addScaledVector(direction, lift(v)).toArray() as Point);
      inside.push(p.addScaledVector(direction, 0.00035).toArray() as Point);
    }
  }
  const cols = across.length;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + cols;
      faces.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const band = addMesh(parent, crisp(thickGeometry(surface, faces, inside), 0.62),
    [fabric, fabric, edging], 'goggle-strap');
  band.userData.width = 2 * halfWidth;
  band.userData.surfaceFitted = true;

  // Ruled textile transitions from the frame to the band; no floating box
  // brackets, exposed side caps or discontinuities in width at the join.
  for (const side of [-1, 1]) {
    const a = side > 0 ? startAngle : endAngle;
    const outer: Point[] = [], inner: Point[] = [], triangles: number[] = [];
    const rows = 8;
    for (let row = 0; row <= rows; row++) {
      const t = row / rows;
      for (const v of across) {
        const { p, direction } = onShell(a, v);
        const front = new THREE.Vector3(side * 0.102, 0.003 + v * halfWidth, -0.096);
        const tangent = new THREE.Vector3(side * 0.26, 0, 1).normalize();
        const distance = front.distanceTo(p);
        const control1 = front.clone().addScaledVector(tangent, distance / 3);
        const contactTangent = new THREE.Vector3(side * Math.cos(startAngle), 0,
          Math.sin(startAngle)).normalize();
        const control2 = p.clone().addScaledVector(contactTangent, -distance / 3);
        const u = 1 - t;
        const point = front.clone().multiplyScalar(u * u * u)
          .addScaledVector(control1, 3 * u * u * t)
          .addScaledVector(control2, 3 * u * t * t)
          .addScaledVector(p, t * t * t);
        const normal = new THREE.Vector3(side, 0, 0).lerp(direction, t).normalize();
        outer.push(point.clone().addScaledVector(normal, lift(v)).toArray() as Point);
        inner.push(point.addScaledVector(normal, 0.00035).toArray() as Point);
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let j = 0; j < cols - 1; j++) {
        const a0 = row * cols + j, b = a0 + cols;
        const quad = [a0, a0 + 1, b, b, a0 + 1, b + 1];
        if (side < 0)
          for (let k = 0; k < quad.length; k += 3)
            [quad[k + 1], quad[k + 2]] = [quad[k + 2], quad[k + 1]];
        triangles.push(...quad);
      }
    }
    const mount = addMesh(parent, crisp(thickGeometry(outer, triangles, inner), 0.62),
      [fabric, fabric, edging], 'goggle-strap-outrigger');
    mount.userData.integratedStrapTransition = true;
  }
}

/** Drop-in replacement: the caller still owns center, uniform scale 1.065,
 * head rotation and animation. Goggles and rider anatomy are unchanged.
 * No textures, DOM, external models or additional imports are required. */
export function createMotocrossHelmet(color: string, visorColor = '#34454d'): HelmetMesh {
  const shell = material(color, 0.08, 0.58);
  const foam = material('#13191b', 0, 0.94);
  const trim = material('#252e32', 0.25, 0.5);
  const panel = material(color, 0.08, 0.6);
  panel.color.multiplyScalar(0.87);
  const panelEdge = material(color, 0.12, 0.48);
  panelEdge.color.multiplyScalar(0.96);
  const rubber = material('#111517', 0, 0.87);
  const ventMesh = material('#30383b', 0.1, 0.8);
  ventMesh.side = THREE.DoubleSide;
  const data = shellGeometry();
  const helmet = new THREE.Mesh(data.geometry, [shell, foam, trim]);
  helmet.name = 'motocross-helmet';
  helmet.userData.helmetStyle = 'motocross';
  helmet.userData.geometryRevision = 'reference-cross-v4-detailed-faceted-shell';
  helmet.castShadow = helmet.receiveShadow = true;
  helmet.updateMatrixWorld(true);
  addPeak(helmet, [shell, foam, trim]);
  addRearRidge(helmet, [shell, foam, trim]);
  addSculptedPanels(helmet, [panel, foam, panelEdge]);
  addLowerBinding(helmet, data.angles, rubber);
  addVentMesh(helmet, data.vents, ventMesh);
  // Preserve the lens, frame, foam seal and breath guard byte-for-byte.
  addGoggles(helmet, trim, foam, visorColor);
  addStrap(helmet);
  return helmet;
}

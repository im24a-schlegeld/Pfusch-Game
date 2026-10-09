import * as THREE from 'three';
import { importedGeometry } from './motocrossHelmetGeometry';

type Point = [number, number, number];
type HelmetMesh = THREE.Mesh<
  THREE.BufferGeometry,
  THREE.MeshStandardMaterial[]
>;
const lerp = THREE.MathUtils.lerp;
const smooth = THREE.MathUtils.smoothstep;
const wrappedAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const apertureAngle = 1.25;

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

/** Elastic bridges vents and sculpted recesses instead of sinking into them.
 * Convex cross-sections come from the real imported shell, not a stock oval. */
function strapSurface(geometry: THREE.BufferGeometry) {
  const attribute = geometry.getAttribute('position'), index = geometry.getIndex()!;
  const sections = new Map<number, THREE.Vector2[]>();
  const cross = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const section = (key: number) => {
    const cached = sections.get(key);
    if (cached) return cached;
    const y = key * .002, points: THREE.Vector2[] = [];
    for (let i = 0; i < index.count; i += 3) for (let side = 0; side < 3; side++) {
      const a = index.getX(i + side), b = index.getX(i + (side + 1) % 3);
      const ay = attribute.getY(a), by = attribute.getY(b);
      if (Math.abs(by - ay) < 1e-8 || (y - ay) * (y - by) > 0) continue;
      const t = (y - ay) / (by - ay);
      points.push(new THREE.Vector2(lerp(attribute.getX(a), attribute.getX(b), t),
        lerp(attribute.getZ(a), attribute.getZ(b), t)));
    }
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const half = (values: THREE.Vector2[]) => {
      const result: THREE.Vector2[] = [];
      for (const point of values) {
        while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, point) <= 0) result.pop();
        result.push(point);
      }
      return result.slice(0, -1);
    };
    const hull = [...half(points), ...half([...points].reverse())];
    sections.set(key, hull);
    return hull;
  };
  return (y: number, direction: THREE.Vector3) => {
    let distance = 0;
    for (const key of [Math.floor(y / .002), Math.ceil(y / .002)]) {
      const hull = section(key);
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i], b = hull[(i + 1) % hull.length];
        const ex = b.x - a.x, ez = b.y - a.y;
        const denominator = direction.x * ez - direction.z * ex;
        if (Math.abs(denominator) < 1e-9) continue;
        const t = (a.x * ez - a.y * ex) / denominator;
        const u = (a.x * direction.z - a.y * direction.x) / denominator;
        if (t > 0 && u >= 0 && u <= 1) distance = Math.max(distance, t);
      }
    }
    if (!distance) throw new Error('The goggle band must contact the imported shell.');
    return new THREE.Vector3(0, y, 0).addScaledVector(direction, distance + .003);
  };
}

/** A 48 mm band fitted to the shell, with continuous textile frame transitions. */
function addStrap(parent: HelmetMesh) {
  const sample = strapSurface(parent.geometry);
  const fabric = material('#171b1e', 0, 0.96);
  const edging = material('#14181a', 0, 0.98);
  const startAngle = apertureAngle + 0.025;
  const endAngle = 2 * Math.PI - startAngle;
  const steps = 128;
  const across = [-1, -0.94, -0.78, -0.4, 0, 0.4, 0.78, 0.94, 1];
  const halfWidth = 0.024;
  const centerY = (a: number) => 0.003 +
    0.0035 * smooth(Math.abs(wrappedAngle(a)), startAngle, 2.8);
  const lift = (v: number) => Math.abs(v) > 0.94 ? 0.0010 :
    Math.abs(v) > 0.78 ? 0.0016 : 0.0019;
  const onShell = (a: number, v: number) => {
    const y = centerY(a) + v * halfWidth;
    const direction = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
    return { p: sample(y, direction), direction };
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

/** The same adult head transform owns this equipment on every motorcycle. */
export function createMotocrossHelmet(color: string, visorColor = '#34454d'): HelmetMesh {
  const shell = material(color, .08, .58);
  const foam = material('#13191b', 0, .94);
  const trim = material('#252e32', .25, .5);
  const helmet = new THREE.Mesh(importedGeometry(0), [shell, foam, trim]);
  helmet.name = 'motocross-helmet';
  helmet.userData.helmetStyle = 'motocross';
  helmet.userData.geometryRevision = 'thor-source-shell-v1';
  helmet.userData.sourceModel = 'RadekC Thor helmet, clean _1 source parts';
  helmet.castShadow = helmet.receiveShadow = true;
  addMesh(helmet, importedGeometry(1), [shell, foam, trim], 'motocross-peak');
  helmet.updateMatrixWorld(true);
  addGoggles(helmet, trim, foam, visorColor);
  addStrap(helmet);
  // Match the Integral's authored tilt without altering the shared head joint.
  // The caller animates this root; all equipment, including goggles, tilts together.
  helmet.traverse(part => {
    if (part instanceof THREE.Mesh) part.geometry.rotateX(-.36);
  });
  helmet.userData.sourceTilt = -.36;
  return helmet;
}

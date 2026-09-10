import * as THREE from 'three';
import type { Player, Product } from '../domain/types';
import { garmentMaterial, sleeveMaterial } from './garmentTexture';
import { POSES, RIDER_DIMENSIONS, type RiderPose } from './riderSkeleton';
import { riderMotionPose, type RiderMotion } from './riderMotion';
import { skinLimb } from './limbSkin';

type Point = [number, number, number];
type Ring = [number, number, number, number]; // axis coordinate, half width, half depth, center offset
const V = (p: Point) => new THREE.Vector3(...p);
function material(color: string, metalness = 0, roughness = 0.68) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}
function mesh(
  parent: THREE.Object3D,
  g: THREE.BufferGeometry,
  m: THREE.Material,
) {
  g.computeVertexNormals();
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
/** Shaped cross sections with smooth normals. Used for tailored fabric and bodywork. */
function loft(
  parent: THREE.Object3D,
  rings: Ring[],
  color: THREE.Material,
  axis: 'y' | 'z' = 'y',
  segments = 24,
) {
  if (rings.length > 2) {
    const profile = new THREE.CatmullRomCurve3(
      rings.map((r) => new THREE.Vector3(r[0], r[1], r[2])),
      false,
      'catmullrom',
      0.25,
    );
    const centers = new THREE.CatmullRomCurve3(
      rings.map((r) => new THREE.Vector3(r[0], r[3], 0)),
      false,
      'catmullrom',
      0.25,
    );
    const steps = (rings.length - 1) * 4;
    rings = Array.from({ length: steps + 1 }, (_, i) => {
      const p = profile.getPoint(i / steps),
        c = centers.getPoint(i / steps);
      return [p.x, Math.max(0.002, p.y), Math.max(0.002, p.z), c.y] as Ring;
    });
  }
  const uvs: number[] = [];
  const vertices: number[] = [],
    indices: number[] = [];
  for (const [a, w, d, offset] of rings)
    for (let j = 0; j <= segments; j++) {
      const t = (j / segments) * Math.PI * 2 - Math.PI / 2;
      const x = Math.sin(t) * w,
        b = Math.cos(t) * d;
      vertices.push(
        x,
        axis === 'y' ? a : b + offset,
        axis === 'y' ? b + offset : a,
      );
      uvs.push(
        j / segments,
        (a - rings[0][0]) / (rings[rings.length - 1][0] - rings[0][0]),
      );
    }
  for (let r = 0; r < rings.length - 1; r++)
    for (let j = 0; j < segments; j++) {
      const a = r * (segments + 1) + j,
        b = a + segments + 1;
      if (axis === 'y') indices.push(a, a + 1, b, b, a + 1, b + 1);
      else indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  for (const [r, reverse] of [
    [0, axis === 'y'],
    [rings.length - 1, axis !== 'y'],
  ] as const) {
    const first = r * (segments + 1);
    for (let j = 1; j < segments - 1; j++)
      indices.push(
        first,
        first + (reverse ? j + 1 : j),
        first + (reverse ? j : j + 1),
      );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return mesh(parent, g, color);
}
function tube(
  parent: THREE.Object3D,
  points: Point[],
  radii: number[],
  m: THREE.Material,
  segments = 20,
  sides = 12,
  flatten = 1,
  outside = 0,
) {
  const curve = new THREE.CatmullRomCurve3(points.map(V));
  const frames = curve.computeFrenetFrames(segments, false);
  const uvs: number[] = [];
  const vertices: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments,
      p = curve.getPointAt(t);
    const scaled = t * (radii.length - 1),
      r = THREE.MathUtils.lerp(
        radii[Math.floor(scaled)],
        radii[Math.min(radii.length - 1, Math.ceil(scaled))],
        scaled % 1,
      );
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides - 0.5) * Math.PI * 2;
      let normal = frames.normals[i],
        binormal = frames.binormals[i];
      if (outside) {
        const tangent = frames.tangents[i];
        normal = new THREE.Vector3(outside, 0, 0)
          .addScaledVector(tangent, -outside * tangent.x)
          .normalize();
        binormal = new THREE.Vector3()
          .crossVectors(tangent, normal)
          .normalize();
      }
      const point = p
        .clone()
        .addScaledVector(normal, Math.cos(angle) * r)
        .addScaledVector(binormal, Math.sin(angle) * r * flatten);
      vertices.push(point.x, point.y, point.z);
      uvs.push(j / sides, 1 - t);
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return mesh(parent, g, m);
}
function rod(
  parent: THREE.Object3D,
  a: Point,
  b: Point,
  r: number,
  m: THREE.Material,
) {
  const direction = V(b).sub(V(a));
  const o = mesh(
    parent,
    new THREE.CylinderGeometry(r, r, direction.length(), 16),
    m,
  );
  o.position.copy(V(a).add(V(b)).multiplyScalar(0.5));
  o.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  return o;
}
/** Curved, thin fairing panels between shaped upper and lower edges. */
function fairingPanel(
  parent: THREE.Object3D,
  side: number,
  m: THREE.MeshStandardMaterial,
) {
  const upper = new THREE.CatmullRomCurve3(
    [
      [0.16, 0.97, -0.9],
      [0.255, 1.025, -0.62],
      [0.265, 0.92, -0.19],
      [0.18, 0.75, 0.2],
    ].map((p) => new THREE.Vector3(...p)),
    false,
    'catmullrom',
    0.35,
  );
  const lower = new THREE.CatmullRomCurve3(
    [
      [0.13, 0.76, -0.79],
      [0.185, 0.39, -0.45],
      [0.18, 0.32, -0.03],
      [0.12, 0.45, 0.27],
    ].map((p) => new THREE.Vector3(...p)),
    false,
    'catmullrom',
    0.35,
  );
  const vertices: number[] = [],
    indices: number[] = [];
  const rows = 24,
    cols = 10;
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= cols; j++) {
      const v = j / cols;
      const p = upper.getPoint(i / rows).lerp(lower.getPoint(i / rows), v);
      p.x = side * (p.x + Math.sin(v * Math.PI) * 0.024);
      vertices.push(p.x, p.y, p.z);
    }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j,
        b = a + cols + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  const panel = m.clone();
  panel.side = THREE.DoubleSide;
  return mesh(parent, g, panel);
}
function oval(
  parent: THREE.Object3D,
  pos: Point,
  scale: Point,
  m: THREE.Material,
) {
  const o = mesh(parent, new THREE.SphereGeometry(1, 24, 16), m);
  o.position.set(...pos);
  o.scale.set(...scale);
  return o;
}
/** Thin shaped bodywork with real edge thickness, triangulated in its side elevation. */
function sidePanel(
  parent: THREE.Object3D,
  side: number,
  outline: Point[],
  m: THREE.Material,
  thickness = 0.012,
) {
  const triangles = THREE.ShapeUtils.triangulateShape(
    outline.map((p) => new THREE.Vector2(p[2], p[1])),
    [],
  );
  const vertices: number[] = [],
    indices: number[] = [];
  for (const layer of [-1, 1])
    for (const p of outline)
      vertices.push(side * (p[0] + (layer * thickness) / 2), p[1], p[2]);
  const n = outline.length;
  for (const [a, b, c] of triangles) indices.push(a, b, c, a + n, c + n, b + n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, i + n, j, j + n, i + n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  const finish = m.clone();
  finish.side = THREE.DoubleSide;
  return mesh(parent, g, finish);
}
function makeFender(
  parent: THREE.Object3D,
  tireRadius: number,
  z: number,
  m: THREE.MeshStandardMaterial,
) {
  const positions: number[] = [],
    indices: number[] = [];
  const arc = 40,
    across = 8;
  // Every point lies at least 0.038 m outside the tire's circumscribed radius.
  const clearance = 0.038,
    thickness = 0.008;
  for (let layer = 0; layer < 2; layer++)
    for (let i = 0; i <= arc; i++)
      for (let j = 0; j <= across; j++) {
        const angle = -1.03 + (i / arc) * 2.28;
        const x = (j / across - 0.5) * 0.102;
        const r =
          tireRadius +
          clearance +
          layer * thickness +
          (1 - (x / 0.051) ** 2) * 0.005;
        positions.push(
          x,
          tireRadius + Math.cos(angle) * r,
          z + Math.sin(angle) * r,
        );
      }
  const stride = (arc + 1) * (across + 1);
  for (let layer = 0; layer < 2; layer++)
    for (let i = 0; i < arc; i++)
      for (let j = 0; j < across; j++) {
        const a = layer * stride + i * (across + 1) + j,
          b = a + across + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
  for (let i = 0; i < arc; i++)
    for (const j of [0, across]) {
      const a = i * (across + 1) + j,
        b = a + across + 1;
      indices.push(a, b, a + stride, b, b + stride, a + stride);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  const finish = m.clone();
  finish.side = THREE.DoubleSide;
  const fender = mesh(parent, geometry, finish);
  fender.name = 'moped-mudguard';
  fender.userData.tireClearance = clearance;
  for (const side of [-1, 1])
    rod(
      parent,
      [side * 0.068, tireRadius, z],
      [side * 0.053, tireRadius + 0.29, z + 0.1],
      0.006,
      m,
    );
}
function makeHelmet(parent: THREE.Object3D, center: Point) {
  const shell = material('#d7dbd7', 0.14, 0.31),
    glass = material('#122027', 0.44, 0.14),
    trim = material('#202727', 0.1, 0.65);
  const profile = new THREE.CatmullRomCurve3(
    [
      [-0.145, 0.079, 0.128],
      [-0.115, 0.101, 0.173],
      [-0.067, 0.12, 0.164],
      [0, 0.127, 0.143],
      [0.055, 0.123, 0.145],
      [0.11, 0.1, 0.103],
      [0.144, 0.052, 0.054],
      [0.154, 0.003, 0.004],
    ].map((p) => new THREE.Vector3(...p)),
    false,
    'catmullrom',
    0.35,
  );
  const positions: number[] = [],
    groups: number[][] = [[], [], []];
  const levels = 112;
  // Align mesh rows with the visor outline itself. More grid cells alone leave
  // stair-stepped material boundaries when the curved outline crosses rows.
  const angles = [
    ...Array.from({ length: 161 }, (_, j) => (j / 160) * Math.PI * 2),
    Math.PI - 1.74,
    Math.PI - 1.68,
    Math.PI + 1.68,
    Math.PI + 1.74,
  ].sort((a, b) => a - b);
  const sides = angles.length - 1;
  const samples = profile.getPoints(256);
  const atHeight = (y: number) => {
    let lo = 0,
      hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].x < y) lo = mid;
      else hi = mid;
    }
    return samples[lo]
      .clone()
      .lerp(samples[hi], (y - samples[lo].x) / (samples[hi].x - samples[lo].x));
  };
  for (let i = 0; i <= levels; i++) {
    for (let j = 0; j <= sides; j++) {
      const a = angles[j],
        front = Math.cos(a) < 0;
      const theta = Math.abs(a - Math.PI);
      const corner = THREE.MathUtils.smoothstep(theta, 1, 1.74);
      const lower = -0.049 + corner * 0.017,
        upper = 0.045 - corner * 0.012;
      const y =
        i <= 28
          ? THREE.MathUtils.lerp(-0.145, lower - 0.006, i / 28)
          : i <= 31
            ? THREE.MathUtils.lerp(lower - 0.006, lower, (i - 28) / 3)
            : i <= 66
              ? THREE.MathUtils.lerp(lower, upper, (i - 31) / 35)
              : i <= 69
                ? THREE.MathUtils.lerp(upper, upper + 0.006, (i - 66) / 3)
                : THREE.MathUtils.lerp(upper + 0.006, 0.154, (i - 69) / 43);
      const p = atHeight(y);
      const blend = THREE.MathUtils.smoothstep(p.x, -0.115, -0.015);
      const visorBand =
        THREE.MathUtils.smoothstep(p.x, -0.062, -0.033) *
        (1 - THREE.MathUtils.smoothstep(p.x, 0.033, 0.06));
      const recess =
        0.012 * visorBand * (1 - THREE.MathUtils.smoothstep(theta, 1.5, 1.8));
      const depth = front
        ? p.z - recess
        : THREE.MathUtils.lerp(0.068, 0.148, blend) *
          (p.x > 0.035 ? p.z / 0.143 : 1);
      positions.push(
        Math.sin(a) * p.y,
        p.x + Math.max(0, Math.cos(a)) * 0.045 * Math.pow(1 - i / levels, 3),
        Math.cos(a) * depth + (front ? -0.005 : 0.006),
      );
    }
  }
  for (let i = 0; i < levels; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1,
        y = (positions[a * 3 + 1] + positions[b * 3 + 1]) * 0.5;
      const theta = Math.abs((angles[j] + angles[j + 1]) / 2 - Math.PI);
      let group = 0;
      if (theta < 1.74 && i >= 28 && i < 69)
        group = theta < 1.68 && i >= 31 && i < 66 ? 1 : 2;
      if (theta < 0.4 && y > -0.116 && y < -0.098) group = 2;
      if (theta > 0.65 && theta < 1.05 && y > -0.1 && y < -0.087) group = 2;
      if (theta > 0.23 && theta < 0.42 && y > 0.074 && y < 0.086) group = 2;
      if (y < -0.134) group = 2;
      groups[group].push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const indices: number[] = [];
  for (let i = 0; i < groups.length; i++) {
    g.addGroup(indices.length, groups[i].length, i);
    indices.push(...groups[i]);
  }
  g.setIndex(indices);
  g.computeVertexNormals();
  const helmet = new THREE.Mesh(g, [shell, glass, trim]);
  helmet.position.set(...center);
  helmet.name = 'full-face-helmet';
  helmet.castShadow = true;
  helmet.receiveShadow = true;
  parent.add(helmet);
  return helmet;
}
export function makeBike(player: Player, products: Product[]) {
  const root = new THREE.Group();
  root.scale.setScalar(1.45);
  const body = new THREE.Group();
  root.add(body);
  const pose = POSES[player.bike as keyof typeof POSES] ?? POSES['125'];
  const rubber = material('#111719', 0, 0.97),
    alloy = material('#a3abad', 0.82, 0.28),
    dark = material('#20282b', 0.55, 0.44),
    seat = material('#171c20', 0, 0.9),
    paint = material(player.paint, 0.18, 0.32),
    rim = material(player.rims, 0.7, 0.35),
    engine = material('#596265', 0.75, 0.46);
  const moped = player.bike === '125',
    sport = player.bike === '701';
  const rear = moped ? 0.55 : 0.76,
    front = moped ? -0.58 : -0.77,
    radius = moped ? 0.305 : 0.325;
  const wheels: THREE.Group[] = [];
  for (const [i, z] of [front, rear].entries()) {
    const wheel = new THREE.Group();
    wheel.position.set(0, radius, z);
    body.add(wheel);
    wheels.push(wheel);
    const width = moped
      ? 0.034
      : sport
        ? i === 1
          ? 0.077
          : 0.056
        : i === 1
          ? 0.063
          : 0.05;
    const tire = mesh(
      wheel,
      new THREE.TorusGeometry(radius - width, width, 12, 48),
      rubber,
    );
    tire.rotation.y = Math.PI / 2;
    const lip = mesh(
      wheel,
      new THREE.TorusGeometry(radius - width * 1.85, 0.012, 8, 40),
      rim,
    );
    lip.rotation.y = Math.PI / 2;
    rod(wheel, [-0.06, 0, 0], [0.06, 0, 0], 0.055, dark);
    const spokes = moped ? 5 : sport ? 7 : 20;
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      rod(
        wheel,
        [0, 0, 0],
        [
          0,
          Math.sin(a) * (radius - width * 1.9),
          Math.cos(a) * (radius - width * 1.9),
        ],
        moped ? 0.014 : sport ? 0.012 : 0.0035,
        rim,
      );
    }
    if (!moped) {
      const disk = mesh(wheel, new THREE.RingGeometry(0.075, 0.145, 32), alloy);
      disk.rotation.y = Math.PI / 2;
      disk.position.x = 0.072;
    }
  }
  const forkTop: Point = [0, moped ? 0.94 : 1.1, moped ? -0.47 : -0.51];
  for (const side of [-1, 1]) {
    rod(
      body,
      [side * 0.08, radius, front],
      [side * 0.08, forkTop[1], forkTop[2]],
      moped ? 0.032 : 0.025,
      alloy,
    );
    if (!moped)
      rod(
        body,
        [side * 0.08, 0.61, front + 0.1],
        [side * 0.08, 1.08, -0.52],
        0.038,
        dark,
      );
    rod(
      body,
      [side * 0.105, radius, rear],
      [side * 0.105, 0.5, 0.04],
      0.028,
      alloy,
    );
  }
  if (moped) {
    tube(
      body,
      [
        [0, 0.33, 0.12],
        [0, 0.42, -0.14],
        [0, 0.89, -0.42],
      ],
      [0.075, 0.082, 0.065],
      paint,
      22,
      20,
      0.62,
    );
    tube(
      body,
      [
        [0, 0.35, 0.15],
        [0, 0.63, 0.23],
        [0, 0.85, 0.25],
      ],
      [0.025, 0.03, 0.034],
      paint,
      16,
      16,
    );
    for (const side of [-1, 1])
      tube(
        body,
        [
          [side * 0.085, 0.35, 0.4],
          [side * 0.085, 0.5, 0.61],
          [side * 0.085, 0.64, 0.68],
        ],
        [0.026, 0.026, 0.021],
        dark,
        14,
        16,
      );
    const chainCover = loft(
      body,
      [
        [-0.06, 0.033, 0.09, 0.3],
        [0.1, 0.038, 0.1, 0.29],
        [0.43, 0.031, 0.09, 0.3],
        [0.52, 0.025, 0.06, 0.31],
      ],
      dark,
      'z',
    );
    chainCover.position.x = 0.09;
    oval(body, [0, 0.3, 0.03], [0.115, 0.13, 0.17], engine);
    loft(
      body,
      [
        [0.06, 0.1, 0.025, 0.84],
        [0.16, 0.15, 0.042, 0.85],
        [0.4, 0.15, 0.042, 0.85],
        [0.47, 0.1, 0.025, 0.85],
      ],
      seat,
      'z',
    );
    for (const z of [front, rear]) makeFender(body, radius, z, dark);
    tube(
      body,
      [
        [-pose.grip[0], pose.grip[1], pose.grip[2]],
        [-0.2, 1.22, -0.44],
        [-0.12, 1.0, -0.45],
        [0.12, 1.0, -0.45],
        [0.2, 1.22, -0.44],
        [pose.grip[0], pose.grip[1], pose.grip[2]],
      ],
      [0.018, 0.018, 0.018, 0.018, 0.018, 0.018],
      dark,
      32,
      12,
    );
    const lamp = loft(
      body,
      [
        [-0.59, 0.065, 0.04, 0.98],
        [-0.55, 0.087, 0.063, 0.98],
        [-0.49, 0.076, 0.06, 0.98],
      ],
      dark,
      'z',
    );
    lamp.position.y = -0.02;
    oval(
      body,
      [0, 0.967, -0.595],
      [0.066, 0.045, 0.009],
      material('#e7e4b8', 0.05, 0.25),
    );
    for (const s of [-1, 1]) {
      rod(body, [s * 0.065, 0.66, 0.36], [s * 0.065, 0.66, 0.85], 0.011, dark);
      rod(body, [s * 0.065, 0.66, 0.85], [s * 0.065, 0.45, 0.68], 0.011, dark);
    }
    rod(body, [-0.23, 0.33, 0.12], [0.23, 0.33, 0.12], 0.015, alloy);

    // Visible pedal crank helps the starter vehicle read immediately as a Töffli.
    const crank = mesh(
      body,
      new THREE.TorusGeometry(0.072, 0.009, 8, 32),
      alloy,
    );

    crank.rotation.y = Math.PI / 2;
    crank.position.set(0, 0.33, 0.12);

    for (const s of [-1, 1]) {
      rod(body, [0, 0.33, 0.12], [s * 0.1, 0.33, 0.12], 0.009, alloy);

      rod(body, [s * 0.1, 0.33, 0.12], [s * 0.16, 0.33, 0.12], 0.013, dark);
    }
  } else if (!sport) {
    // Double cradle: steering head -> engine rails -> swingarm pivot, with a separate alloy subframe.
    rod(body, [0, 0.91, -0.48], [0, 1.08, -0.42], 0.055, dark).name =
      'steering-head';
    for (const s of [-1, 1]) {
      tube(
        body,
        [
          [s * 0.055, 1.01, -0.44],
          [s * 0.13, 0.82, -0.23],
          [s * 0.13, 0.51, 0.13],
        ],
        [0.035, 0.037, 0.041],
        dark,
        24,
        14,
      );
      tube(
        body,
        [
          [s * 0.035, 0.98, -0.45],
          [s * 0.11, 0.6, -0.33],
          [s * 0.12, 0.38, -0.2],
          [s * 0.13, 0.37, 0.1],
          [s * 0.13, 0.51, 0.13],
        ],
        [0.027, 0.028, 0.028, 0.027, 0.032],
        dark,
        32,
        14,
      );
      tube(
        body,
        [
          [s * 0.13, 0.51, 0.13],
          [s * 0.115, 0.84, 0.48],
          [s * 0.085, 0.965, 0.69],
        ],
        [0.022, 0.022, 0.018],
        alloy,
        20,
        12,
      );
      rod(body, [s * 0.12, 0.88, 0.12], [s * 0.085, 0.965, 0.69], 0.021, alloy);
      const swingarm = loft(
        body,
        [
          [0.1, 0.033, 0.057, 0.5],
          [0.37, 0.037, 0.053, 0.43],
          [0.72, 0.028, 0.034, 0.335],
          [0.79, 0.023, 0.026, 0.325],
        ],
        alloy,
        'z',
        16,
      );
      swingarm.position.x = s * 0.14;
      swingarm.name = 'box-section-swingarm';
      rod(
        body,
        [s * 0.08, 0.36, -0.76],
        [s * 0.08, 0.64, -0.655],
        0.043,
        paint,
      );
      const shroud = sidePanel(
        body,
        s,
        [
          [0.13, 0.95, -0.41],
          [0.18, 0.96, -0.22],
          [0.175, 0.91, 0.08],
          [0.12, 0.74, 0.03],
          [0.16, 0.64, -0.2],
          [0.19, 0.72, -0.34],
        ],
        paint,
      );
      shroud.name = 'radiator-shroud';
      sidePanel(
        body,
        s,
        [
          [0.191, 0.88, -0.325],
          [0.192, 0.88, -0.18],
          [0.178, 0.83, -0.06],
          [0.182, 0.79, -0.225],
        ],
        dark,
        0.006,
      );
      sidePanel(
        body,
        s,
        [
          [0.112, 0.94, 0.16],
          [0.115, 0.975, 0.58],
          [0.075, 1.005, 0.81],
          [0.13, 0.81, 0.54],
          [0.125, 0.79, 0.29],
        ],
        paint,
      );
      for (const z of [-0.31, -0.24])
        rod(body, [s * 0.17, 0.905, z], [s * 0.19, 0.905, z], 0.009, alloy);
      const radiator = mesh(
        body,
        new THREE.BoxGeometry(0.105, 0.25, 0.055),
        dark,
      );
      radiator.position.set(s * 0.105, 0.735, -0.315);
      radiator.rotation.x = -0.15;
      for (let k = 0; k < 7; k++)
        rod(
          body,
          [s * 0.06, 0.635 + k * 0.032, -0.349],
          [s * 0.15, 0.635 + k * 0.032, -0.349],
          0.0035,
          engine,
        );
      rod(
        body,
        [s * 0.077, 0.325, -0.77],
        [s * 0.087, 0.325, -0.77],
        0.135,
        alloy,
      );
      const caliper = mesh(
        body,
        new THREE.BoxGeometry(0.043, 0.08, 0.047),
        dark,
      );
      caliper.position.set(s * 0.085, 0.4, -0.65);
    }
    rod(body, [-0.15, 0.5, 0.12], [0.15, 0.5, 0.12], 0.05, dark);
    // Compact crankcase, cylinder and head occupy the cradle instead of floating below the tank.
    oval(body, [0, 0.51, -0.015], [0.137, 0.132, 0.185], engine);
    for (const s of [-1, 1]) {
      rod(
        body,
        [s * 0.128, 0.51, -0.035],
        [s * 0.16, 0.51, -0.035],
        0.1,
        engine,
      );
      rod(
        body,
        [s * 0.155, 0.51, -0.035],
        [s * 0.166, 0.51, -0.035],
        0.074,
        alloy,
      );
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        rod(
          body,
          [s * 0.163, 0.51 + Math.sin(a) * 0.079, -0.035 + Math.cos(a) * 0.079],
          [s * 0.172, 0.51 + Math.sin(a) * 0.079, -0.035 + Math.cos(a) * 0.079],
          0.007,
          dark,
        );
      }
    }
    loft(
      body,
      [
        [0.59, 0.085, 0.085, -0.13],
        [0.7, 0.087, 0.08, -0.15],
        [0.76, 0.1, 0.085, -0.16],
      ],
      engine,
      'y',
      16,
    );
    for (let k = 0; k < 5; k++)
      loft(
        body,
        [
          [0.61 + k * 0.025, 0.105, 0.092, -0.145],
          [0.616 + k * 0.025, 0.105, 0.092, -0.145],
        ],
        alloy,
        'y',
        16,
      );
    const damperTop = new THREE.Vector3(0, 0.85, 0.27),
      damperBottom = new THREE.Vector3(0, 0.49, 0.43),
      axis = damperBottom.clone().sub(damperTop).normalize(),
      radial = new THREE.Vector3(1, 0, 0),
      cross = new THREE.Vector3().crossVectors(axis, radial);
    rod(
      body,
      damperTop.toArray() as Point,
      damperBottom.toArray() as Point,
      0.024,
      alloy,
    );
    const coil = Array.from({ length: 85 }, (_, i) => {
      const t = i / 84,
        a = t * Math.PI * 12;
      return damperTop
        .clone()
        .lerp(damperBottom, t)
        .addScaledVector(radial, Math.cos(a) * 0.052)
        .addScaledVector(cross, Math.sin(a) * 0.052)
        .toArray() as Point;
    });
    tube(
      body,
      coil,
      coil.map(() => 0.0085),
      material('#c17d4e', 0.25, 0.44),
      100,
      8,
    ).name = 'rear-shock-spring';
    // Drive chain lies outside the wheel, parallel to the left swingarm.
    tube(
      body,
      [
        [-0.183, 0.53, 0.12],
        [-0.183, 0.4, 0.75],
        [-0.183, 0.26, 0.75],
        [-0.183, 0.43, 0.12],
        [-0.183, 0.53, 0.12],
      ],
      [0.007, 0.007, 0.007, 0.007, 0.007],
      dark,
      36,
      8,
    );
    loft(
      body,
      [
        [-0.43, 0.08, 0.047, 0.93],
        [-0.24, 0.13, 0.082, 0.91],
        [0.02, 0.115, 0.075, 0.915],
        [0.18, 0.088, 0.037, 0.945],
      ],
      seat,
      'z',
    );
    loft(
      body,
      [
        [-0.28, 0.067, 0.02, 0.978],
        [0.04, 0.1, 0.029, 0.977],
        [0.43, 0.093, 0.029, 0.983],
        [0.68, 0.067, 0.02, 1.012],
      ],
      seat,
      'z',
    );
    loft(
      body,
      [
        [-1.06, 0.057, 0.013, 0.805],
        [-0.94, 0.096, 0.024, 0.846],
        [-0.67, 0.102, 0.026, 0.853],
        [-0.49, 0.055, 0.011, 0.82],
      ],
      paint,
      'z',
    );
    loft(
      body,
      [
        [0.89, 0.069, 0.028, -0.62],
        [0.93, 0.104, 0.034, -0.607],
        [1.09, 0.126, 0.035, -0.564],
        [1.155, 0.106, 0.021, -0.55],
      ],
      paint,
      'y',
    );
    loft(
      body,
      [
        [0.947, 0.06, 0.006, -0.644],
        [0.99, 0.066, 0.008, -0.633],
        [1.032, 0.058, 0.006, -0.62],
      ],
      material('#1c272a', 0.1, 0.2),
      'y',
    );
    tube(
      body,
      [
        [-pose.grip[0], pose.grip[1], pose.grip[2]],
        [-0.22, 1.13, -0.48],
        [-0.14, 1.07, -0.51],
        [0.14, 1.07, -0.51],
        [0.22, 1.13, -0.48],
        [pose.grip[0], pose.grip[1], pose.grip[2]],
      ],
      [0.016, 0.016, 0.016, 0.016, 0.016, 0.016],
      alloy,
      28,
      12,
    );
    for (const s of [-1, 1]) {
      tube(
        body,
        [
          [s * 0.23, 1.12, -0.48],
          [s * 0.31, 1.1, -0.6],
          [s * 0.43, 1.11, -0.59],
          [s * 0.445, 1.13, -0.44],
        ],
        [0.016, 0.027, 0.031, 0.016],
        dark,
        20,
        12,
        0.65,
      );
      tube(
        body,
        [
          [s * 0.24, 1.125, -0.46],
          [s * 0.32, 1.12, -0.5],
          [s * 0.4, 1.12, -0.51],
        ],
        [0.007, 0.007, 0.009],
        alloy,
        12,
        8,
      );
    }
    tube(
      body,
      [
        [0.13, 1.13, -0.46],
        [0.16, 1.0, -0.53],
        [0.11, 0.7, -0.64],
        [0.09, 0.41, -0.68],
      ],
      [0.005, 0.005, 0.005, 0.005],
      rubber,
      24,
      8,
    );
  } else {
    // Full fairings join the broad upper cowl; the engine and lower belly pan give the front real mass.
    loft(
      body,
      [
        [-0.49, 0.092, 0.085, 0.88],
        [-0.32, 0.22, 0.16, 0.93],
        [-0.11, 0.245, 0.164, 0.95],
        [0.12, 0.18, 0.094, 0.9],
        [0.25, 0.11, 0.043, 0.845],
      ],
      paint,
      'z',
      20,
    );
    loft(
      body,
      [
        [0.12, 0.105, 0.022, 0.83],
        [0.31, 0.14, 0.035, 0.835],
        [0.51, 0.115, 0.031, 0.88],
        [0.62, 0.073, 0.019, 0.925],
      ],
      seat,
      'z',
    );
    loft(
      body,
      [
        [0.38, 0.148, 0.07, 0.8],
        [0.6, 0.13, 0.074, 0.9],
        [0.82, 0.065, 0.031, 0.977],
      ],
      paint,
      'z',
    );
    oval(body, [0, 0.52, -0.02], [0.182, 0.185, 0.25], engine);
    for (const s of [-1, 1]) {
      tube(
        body,
        [
          [s * 0.1, 1.03, -0.43],
          [s * 0.18, 0.79, -0.12],
          [s * 0.16, 0.56, 0.15],
        ],
        [0.04, 0.046, 0.044],
        alloy,
        22,
        14,
      );
      tube(
        body,
        [
          [s * 0.16, 0.56, 0.15],
          [s * 0.11, 0.86, 0.55],
          [s * 0.085, 0.95, 0.77],
        ],
        [0.025, 0.022, 0.018],
        dark,
        16,
        12,
      );
      const swingarm = loft(
        body,
        [
          [0.14, 0.032, 0.058, 0.51],
          [0.38, 0.035, 0.048, 0.43],
          [0.76, 0.027, 0.03, 0.325],
        ],
        dark,
        'z',
        16,
      );
      swingarm.position.x = s * 0.14;
      fairingPanel(body, s, paint);
      sidePanel(
        body,
        s,
        [
          [0.19, 0.45, -0.44],
          [0.235, 0.65, -0.29],
          [0.245, 0.74, -0.02],
          [0.18, 0.47, 0.25],
          [0.12, 0.34, 0.17],
          [0.17, 0.31, -0.26],
        ],
        dark,
        0.014,
      );
      // The side intake follows the fairing's actual curved shoulder.
      sidePanel(
        body,
        s,
        [
          [0.275, 0.855, -0.45],
          [0.29, 0.86, -0.25],
          [0.273, 0.77, -0.08],
          [0.26, 0.78, -0.3],
        ],
        material('#111a1e', 0.1, 0.67),
        0.012,
      );
      sidePanel(
        body,
        s,
        [
          [0.283, 0.832, -0.41],
          [0.293, 0.837, -0.28],
          [0.287, 0.818, -0.28],
          [0.28, 0.813, -0.39],
        ],
        alloy,
        0.004,
      );
      rod(
        body,
        [s * 0.068, 1.045, -0.47],
        [s * 0.32, 0.94, -0.47],
        0.017,
        dark,
      );
      tube(
        body,
        [
          [s * 0.18, 1.065, -0.69],
          [s * 0.27, 1.17, -0.64],
          [s * 0.37, 1.2, -0.58],
        ],
        [0.013, 0.011, 0.012],
        dark,
        12,
        10,
      );
      const mirror = loft(
        body,
        [
          [-0.65, 0.047, 0.02, 1.205],
          [-0.59, 0.063, 0.031, 1.21],
          [-0.53, 0.03, 0.017, 1.2],
        ],
        dark,
        'z',
        16,
      );
      mirror.position.x = s * 0.37;
    }
    // The headlight and intake material regions share the shaped front surface: no buried overlays.
    const cowlVertices: number[] = [],
      cowlGroups: number[][] = [[], [], []];
    const cowlRows = 96;
    const cowlColumns = [
      ...Array.from({ length: 161 }, (_, j) => (j / 160) * 2 - 1),
      -0.86,
      -0.28,
      0.28,
      0.86,
    ].sort((a, b) => a - b);
    const cowlCols = cowlColumns.length - 1;
    const cowlHeight = (row: number, u: number) => {
      const lower = 0.37 + Math.abs(u) * 0.17,
        upper = 0.57 + Math.abs(u) * 0.17;
      return row <= 40
        ? (lower * row) / 40
        : row <= 64
          ? THREE.MathUtils.lerp(lower, upper, (row - 40) / 24)
          : THREE.MathUtils.lerp(upper, 1, (row - 64) / 32);
    };
    for (let i = 0; i <= cowlRows; i++)
      for (let j = 0; j <= cowlCols; j++) {
        const u = cowlColumns[j],
          t = cowlHeight(i, u),
          w = 0.07 + 0.175 * Math.sin((t * Math.PI) / 2);
        cowlVertices.push(
          u * w,
          0.885 + t * 0.19 - 0.014 * u * u,
          -0.997 + t * 0.202 + u * u * 0.088,
        );
      }
    for (let i = 0; i < cowlRows; i++)
      for (let j = 0; j < cowlCols; j++) {
        const u = Math.abs((cowlColumns[j] + cowlColumns[j + 1]) / 2),
          t = cowlHeight(i + 0.5, u),
          a = i * (cowlCols + 1) + j,
          b = a + cowlCols + 1;
        let k = 0;
        if (u > 0.28 && u < 0.86 && i >= 40 && i < 64) k = 1;
        if (u < 0.18 && t > 0.14 && t < 0.36) k = 2;
        cowlGroups[k].push(a, b, a + 1, b, b + 1, a + 1);
      }
    const cowlGeometry = new THREE.BufferGeometry();
    cowlGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(cowlVertices, 3),
    );
    const cowlIndices: number[] = [];
    cowlGroups.forEach((g, i) => {
      cowlGeometry.addGroup(cowlIndices.length, g.length, i);
      cowlIndices.push(...g);
    });
    cowlGeometry.setIndex(cowlIndices);
    cowlGeometry.computeVertexNormals();
    const cowlFinish = paint.clone();
    cowlFinish.side = THREE.DoubleSide;
    const lens = material('#bbc9c8', 0.1, 0.23);
    lens.side = THREE.DoubleSide;
    const cowl = new THREE.Mesh(cowlGeometry, [cowlFinish, lens, dark]);
    cowl.castShadow = true;
    cowl.receiveShadow = true;
    cowl.name = 'integrated-sport-front';
    body.add(cowl);
    loft(
      body,
      [
        [-0.76, 0.239, 0.033, 1.046],
        [-0.61, 0.228, 0.055, 1.022],
        [-0.485, 0.185, 0.056, 1.015],
      ],
      paint,
      'z',
      20,
    );
    const vertices: number[] = [],
      indices: number[] = [];
    const rows = 22,
      cols = 22;
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j <= cols; j++) {
        const t = i / rows,
          u = (j / cols) * 2 - 1;
        vertices.push(
          u * (0.152 + 0.02 * Math.sin(t * Math.PI) - 0.016 * t),
          1.017 + 0.258 * t - 0.022 * u * u,
          -0.824 + 0.375 * t + 0.077 * u * u,
        );
      }
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const a = i * (cols + 1) + j,
          b = a + cols + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const screenGeometry = new THREE.BufferGeometry();
    screenGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    screenGeometry.setIndex(indices);
    const screen = mesh(
      body,
      screenGeometry,
      new THREE.MeshPhysicalMaterial({
        color: '#8eaaa9',
        metalness: 0.05,
        roughness: 0.13,
        transparent: true,
        opacity: 0.56,
        side: THREE.DoubleSide,
        depthWrite: false,
        clearcoat: 1,
      }),
    );
    screen.name = 'curved-windscreen';
    tube(
      body,
      [
        [0, 0.53, -0.92],
        [0, 0.678, -0.78],
        [0, 0.6, -0.54],
      ],
      [0.093, 0.098, 0.09],
      paint,
      26,
      20,
      0.18,
    );
    const rearLamp = loft(
      body,
      [
        [0.8, 0.055, 0.01, 0.966],
        [0.837, 0.042, 0.011, 0.969],
      ],
      material('#b64232', 0.1, 0.35),
      'z',
      16,
    );
    rearLamp.name = 'tail-light';
  }
  // One exhaust only, on the rider's right; curved header joins the engine.
  const exhaustX = moped ? 0.15 : 0.23;
  const exhaustY = moped ? 0.22 : sport ? 0.48 : 0.8;
  tube(
    body,
    [
      [0.1, moped ? 0.25 : 0.5, -0.05],
      [0.17, moped ? 0.19 : 0.36, -0.25],
      [exhaustX, moped ? 0.19 : 0.39, 0.25],
      [exhaustX, exhaustY, 0.56],
    ],
    [0.022, 0.022, 0.026, 0.03],
    alloy,
    24,
    14,
  );
  const muffler = rod(
    body,
    [exhaustX, exhaustY, 0.38],
    [exhaustX, exhaustY + 0.025, 0.76],
    moped ? 0.032 : sport ? 0.073 : 0.054,
    alloy,
  );
  muffler.name = 'single-exhaust';
  rod(
    body,
    [exhaustX, exhaustY + 0.025, 0.755],
    [exhaustX, exhaustY + 0.025, 0.78],
    moped ? 0.023 : 0.037,
    rubber,
  );
  for (const s of [-1, 1]) {
    rod(
      body,
      [s * (pose.grip[0] - 0.055), pose.grip[1], pose.grip[2]],
      [s * (pose.grip[0] + 0.055), pose.grip[1], pose.grip[2]],
      0.024,
      rubber,
    );
    rod(
      body,
      [s * 0.1, pose.peg[1], pose.peg[2]],
      [s * (pose.peg[0] + 0.055), pose.peg[1], pose.peg[2]],
      0.018,
      dark,
    );
  }
  const rider = makeRider(body, pose, player, products);
  return {
    root,
    body,
    wheels,
    rider: rider.group,
    animateRider: rider.animate,
    wheelRadius: radius,
    rearAxle: rear,
  };
}
function makeRider(
  parent: THREE.Object3D,
  pose: RiderPose,
  player: Player,
  products: Product[],
) {
  const rider = new THREE.Group();
  parent.add(rider);
  const pelvis = new THREE.Group();
  rider.add(pelvis);
  const rest = riderMotionPose(pose, { wheelie: 0, steer: 0, landing: 0 });
  const limbs: {
    arm: ReturnType<typeof skinLimb>;
    leg: ReturnType<typeof skinLimb>;
  }[] = [];
  const upper = products.find((p) => p.id === player.equipped.upper);
  const productColor = (p: Product | undefined) =>
    p?.preview?.colors.find((c) => c.variantIds.includes(player.variants[p.id]))
      ?.baseColor ??
    p?.baseColor ??
    '#394143';
  const color = productColor(upper),
    cloth = material(color, 0, 0.96),
    pants = material('#242d31', 0, 0.96),
    boot = material('#141c20', 0, 0.82),
    skin = material('#987565', 0, 0.9);
  const tee = !!upper && /shirt/i.test(upper.type),
    hoodie = !!upper && /hoodie|zipper/i.test(upper.type),
    zipper = !!upper && /zipper|windbreaker/i.test(upper.type);
  const volume = zipper ? 1.16 : hoodie ? 1.14 : tee ? 1.045 : 1.0;
  const hem = zipper ? -0.015 : -0.045;
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(...pose.hip);
  torsoGroup.rotation.x = -pose.torsoLean;
  rider.add(torsoGroup);
  const torso = loft(
    torsoGroup,
    [
      [hem, 0.2 * volume, 0.127 * volume, 0],
      [0.02, 0.207 * volume, 0.133 * volume, 0],
      [0.18, 0.21 * volume, 0.135 * volume, 0],
      [0.39, 0.226 * volume, 0.142 * volume, 0],
      [0.5, 0.244 * volume, 0.13 * volume, 0],
      [0.55, 0.225 * volume, 0.103 * volume, 0],
      [0.6, 0.085, 0.065, 0],
      [0.63, 0.073, 0.057, 0],
    ],
    garmentMaterial(upper, player, color),
  );
  torso.name = 'tailored-garment';
  const fabric = torso.geometry.getAttribute('position');
  for (let i = 0; i < fabric.count; i++) {
    const x = fabric.getX(i),
      y = fabric.getY(i),
      z = fabric.getZ(i);
    const waist = Math.exp(-(((y - 0.075) / 0.11) ** 2)),
      armpit =
        Math.exp(-(((y - 0.4) / 0.09) ** 2)) * Math.min(1, Math.abs(x) / 0.2);
    const fold =
      Math.sin(y * 68 + Math.abs(x) * 18) *
      (0.012 * waist + 0.008 * armpit) *
      (hoodie ? 1.25 : 1);
    const pocket =
      hoodie && z < 0
        ? Math.exp(-(((y - 0.12) / 0.065) ** 4)) *
          Math.max(0, 1 - (x / 0.19) ** 6) *
          0.011
        : 0;
    fabric.setZ(i, z + Math.sign(z) * (fold + pocket));
  }
  fabric.needsUpdate = true;
  torso.geometry.computeVertexNormals();
  loft(
    torsoGroup,
    [
      [hem - 0.015, 0.2 * volume, 0.129 * volume, 0],
      [hem + 0.01, 0.204 * volume, 0.131 * volume, 0],
      [hem + 0.03, 0.203 * volume, 0.13 * volume, 0],
    ],
    cloth,
  );
  if (hoodie) {
    loft(
      torsoGroup,
      [
        [zipper ? 0.49 : 0.47, 0.11, 0.05, 0.105],
        [0.53, 0.135, 0.065, 0.11],
        [0.6, 0.115, 0.06, 0.1],
        [0.65, 0.075, 0.045, 0.073],
      ],
      cloth,
    ).name = 'folded-hood';
  }
  if (upper?.handle === 'unisex-windbreaker')
    loft(
      torsoGroup,
      [
        [0.555, 0.098, 0.072, 0],
        [0.6, 0.09, 0.07, 0],
        [0.66, 0.078, 0.058, 0],
      ],
      cloth,
    ).name = 'stand-collar';
  if (zipper)
    tube(
      torsoGroup,
      [
        [0, -0.015, -0.132 * volume],
        [0, 0.22, -0.14 * volume],
        [0, 0.42, -0.144 * volume],
        [0, 0.585, -0.072],
      ],
      [0.003, 0.003, 0.003, 0.003],
      material('#69716f', 0.5, 0.7),
      28,
      8,
    );
  loft(
    pelvis,
    [
      [pose.hip[1] - 0.075, 0.14, 0.095, pose.hip[2]],
      [pose.hip[1], 0.182, 0.138, pose.hip[2]],
      [pose.hip[1] + 0.035, 0.172, 0.122, pose.hip[2]],
    ],
    pants,
  );
  for (const side of [-1, 1]) {
    const shoulder: Point = [
        side * RIDER_DIMENSIONS.shoulderHalf,
        pose.shoulder[1],
        pose.shoulder[2],
      ],
      elbow: Point = [side * pose.elbow[0], pose.elbow[1], pose.elbow[2]],
      wrist: Point = [side * pose.wrist[0], pose.wrist[1], pose.wrist[2]];
    // Sleeve begins inside the shoulder yoke, so its open end is buried in the torso.
    // The anatomical shoulder and both bone lengths stay unchanged.
    const yoke: Point = [side * 0.12, shoulder[1] + 0.014, shoulder[2] + 0.012];
    const armMeshes: THREE.Mesh[] = [];
    if (tee) {
      const sleeveEnd = V(shoulder).lerp(V(elbow), 0.86).toArray() as Point,
        skinStart = V(shoulder).lerp(V(elbow), 0.73).toArray() as Point;
      armMeshes.push(
        tube(
          rider,
          [yoke, shoulder, sleeveEnd],
          [0.071, 0.101, 0.095],
          cloth,
          24,
          24,
          0.92,
        ),
      );
      armMeshes.push(
        tube(
          rider,
          [
            skinStart,
            V(skinStart).lerp(V(elbow), 0.8).toArray() as Point,
            elbow,
            V(elbow).lerp(V(wrist), 0.35).toArray() as Point,
            wrist,
          ],
          [0.071, 0.064, 0.055, 0.06, 0.038],
          skin,
          28,
          20,
          0.9,
        ),
      );
    } else
      armMeshes.push(
        tube(
          rider,
          [
            yoke,
            shoulder,
            V(shoulder).lerp(V(elbow), 0.72).toArray() as Point,
            elbow,
            V(elbow).lerp(V(wrist), 0.4).toArray() as Point,
            wrist,
          ],
          [
            0.071 * volume,
            0.098 * volume,
            0.082 * volume,
            0.073 * volume,
            0.077 * volume,
            0.045,
          ],
          upper?.handle === 'racing-zipper'
            ? sleeveMaterial(upper, player, color, side)
            : cloth,
          36,
          20,
          0.94,
          side,
        ),
      );
    // The cuff overlaps the glove, which curls around the actual grip center.
    tube(
      rider,
      [
        wrist,
        [wrist[0], pose.grip[1] + 0.044, pose.grip[2]],
        [wrist[0], pose.grip[1] + 0.016, pose.grip[2] - 0.036],
        [wrist[0], pose.grip[1] - 0.019, pose.grip[2] - 0.006],
      ],
      [0.045, 0.046, 0.04, 0.03],
      boot,
      20,
      18,
      0.85,
    );
    const hip: Point = [
        side * RIDER_DIMENSIONS.hipHalf,
        pose.hip[1] - 0.01,
        pose.hip[2],
      ],
      knee: Point = [side * pose.knee[0], pose.knee[1], pose.knee[2]],
      ankle: Point = [side * pose.ankle[0], pose.ankle[1], pose.ankle[2]];
    const leg = tube(
      rider,
      [
        hip,
        V(hip).lerp(V(knee), 0.65).toArray() as Point,
        knee,
        V(knee).lerp(V(ankle), 0.5).toArray() as Point,
        ankle,
      ],
      [0.116, 0.11, 0.092, 0.084, 0.062],
      pants,
      40,
      20,
      0.96,
    );
    const lp = leg.geometry.getAttribute('position');
    for (let ring = 0; ring <= 40; ring++) {
      const t = ring / 40,
        c = new THREE.Vector3();
      for (let j = 0; j <= 20; j++)
        c.add(new THREE.Vector3().fromBufferAttribute(lp, ring * 21 + j));
      c.divideScalar(21);
      const fold =
        0.09 *
        Math.sin(t * 70) *
        (Math.exp(-(((t - 0.5) / 0.13) ** 2)) +
          0.7 * Math.exp(-(((t - 0.91) / 0.08) ** 2)));
      for (let j = 0; j <= 20; j++) {
        const k = ring * 21 + j,
          p = new THREE.Vector3()
            .fromBufferAttribute(lp, k)
            .sub(c)
            .multiplyScalar(1 + fold)
            .add(c);
        lp.setXYZ(k, p.x, p.y, p.z);
      }
    }
    leg.geometry.computeVertexNormals();
    const index = side === -1 ? 0 : 1;
    limbs.push({
      arm: skinLimb(rider, armMeshes, rest.limbs[index].arm),
      leg: skinLimb(rider, [leg], rest.limbs[index].leg),
    });
    const foot = loft(
      rider,
      [
        [pose.peg[2] - 0.15, 0.022, 0.025, pose.peg[1] + 0.048],
        [pose.peg[2] - 0.075, 0.055, 0.039, pose.peg[1] + 0.049],
        [pose.peg[2] + 0.082, 0.058, 0.072, pose.peg[1] + 0.075],
        [pose.peg[2] + 0.14, 0.031, 0.04, pose.peg[1] + 0.085],
      ],
      boot,
      'z',
      20,
    );
    foot.position.x = side * pose.peg[0];
  }
  const neck = tube(
    rider,
    [
      [0, pose.shoulder[1] + 0.04, pose.shoulder[2]],
      [0, pose.head[1] - 0.1, pose.head[2]],
    ],
    [0.055, 0.055],
    boot,
    12,
    20,
  );
  const helmet = makeHelmet(rider, pose.head);
  const accessory = products.find((p) => p.id === player.equipped.accessory);
  if (accessory?.handle === 'logo-crossbody-tasche') {
    tube(
      torsoGroup,
      [
        [-0.19, 0.53, -0.1],
        [0.05, 0.29, -0.16],
        [0.2, 0.06, 0],
      ],
      [0.019, 0.019, 0.019],
      boot,
      28,
      12,
      0.38,
    );
    const bag = loft(
      torsoGroup,
      [
        [0.09, 0.1, 0.03, -0.21],
        [0.14, 0.14, 0.047, -0.21],
        [0.29, 0.135, 0.042, -0.21],
        [0.32, 0.09, 0.023, -0.21],
      ],
      material(productColor(accessory), 0, 0.93),
    );
    bag.position.x = 0.06;
  } else if (accessory) {
    const ring = mesh(
      pelvis,
      new THREE.TorusGeometry(0.031, 0.005, 8, 24),
      material('#b2b8b9', 0.8, 0.25),
    );
    ring.position.set(0.2, pose.hip[1] - 0.04, pose.hip[2]);
    const tag = loft(
      pelvis,
      [
        [pose.hip[1] - 0.2, 0.023, 0.008, pose.hip[2]],
        [pose.hip[1] - 0.07, 0.026, 0.009, pose.hip[2]],
      ],
      material(productColor(accessory)),
      'y',
    );
    tag.position.x = 0.2;
  }
  const cap = products.find((p) => p.id === player.equipped.head);
  if (cap) {
    const capM = material(productColor(cap), 0, 0.97),
      group = new THREE.Group();
    group.position.set(-0.225, pose.hip[1] - 0.05, pose.hip[2] + 0.1);
    group.rotation.set(-0.8, 0, 0.3);
    pelvis.add(group);
    loft(
      group,
      [
        [0, 0.103, 0.1, 0],
        [0.045, 0.1, 0.095, 0],
        [0.1, 0.07, 0.065, 0],
        [0.12, 0.012, 0.013, 0],
      ],
      capM,
    );
    loft(
      group,
      [
        [-0.2, 0.016, 0.007, 0],
        [-0.15, 0.101, 0.012, 0],
        [-0.04, 0.116, 0.01, 0],
      ],
      capM,
      'z',
    );
  }
  rider.userData.skeleton = RIDER_DIMENSIONS;
  const motion: RiderMotion = { wheelie: 0, steer: 0, landing: 0 };
  const animate = (target: RiderMotion, dt: number) => {
    const blend = 1 - Math.exp(-12 * dt);
    for (const key of ['wheelie', 'steer', 'landing'] as const)
      motion[key] += (target[key] - motion[key]) * blend;
    const current = riderMotionPose(pose, motion);
    torsoGroup.position.set(...current.hip);
    torsoGroup.rotation.set(-current.lean, 0, current.roll);
    pelvis.position.set(
      current.hip[0] - pose.hip[0],
      current.hip[1] - pose.hip[1],
      current.hip[2] - pose.hip[2],
    );
    neck.position.set(
      current.shoulder[0] - pose.shoulder[0],
      current.shoulder[1] - pose.shoulder[1],
      current.shoulder[2] - pose.shoulder[2],
    );
    helmet.position.set(...current.head);
    helmet.rotation.set(-motion.wheelie * 0.16, 0, motion.steer * 0.055);
    current.limbs.forEach((limb, i) => {
      limbs[i].arm(limb.arm);
      limbs[i].leg(limb.leg);
    });
  };
  return { group: rider, animate };
}

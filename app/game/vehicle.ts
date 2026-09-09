import * as THREE from 'three';
import type { Player, Product } from '../domain/types';
import { garmentMaterial, sleeveMaterial } from './garmentTexture';
import { POSES, RIDER_DIMENSIONS, type RiderPose } from './riderSkeleton';

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
      [0.13, 0.84, -0.73],
      [0.22, 0.95, -0.48],
      [0.25, 0.84, -0.18],
      [0.16, 0.68, 0.17],
    ].map((p) => new THREE.Vector3(...p)),
    false,
    'catmullrom',
    0.35,
  );
  const lower = new THREE.CatmullRomCurve3(
    [
      [0.11, 0.58, -0.67],
      [0.17, 0.36, -0.42],
      [0.16, 0.31, -0.05],
      [0.1, 0.43, 0.2],
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
  const levels = 48,
    sides = 64;
  for (let i = 0; i <= levels; i++) {
    const p = profile.getPoint(i / levels);
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2,
        front = Math.cos(a) < 0;
      const blend = THREE.MathUtils.smoothstep(p.x, -0.115, -0.015);
      const theta = Math.abs(a - Math.PI);
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
      const theta = Math.abs(((j + 0.5) / sides) * Math.PI * 2 - Math.PI);
      const corner = THREE.MathUtils.smoothstep(theta, 1.0, 1.74);
      const lower = -0.049 + corner * 0.017,
        upper = 0.045 - corner * 0.012;
      let group = 0;
      if (theta < 1.74 && y > lower - 0.006 && y < upper + 0.006)
        group = theta < 1.68 && y > lower && y < upper ? 1 : 2;
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
    for (const s of [-1, 1]) {
      tube(
        body,
        [
          [s * 0.1, 0.45, 0.08],
          [s * 0.14, 0.88, -0.21],
          [s * 0.07, 0.97, -0.4],
        ],
        [0.027, 0.027, 0.023],
        dark,
        18,
        12,
      );
      tube(
        body,
        [
          [s * 0.1, 0.48, 0.1],
          [s * 0.08, 0.85, 0.43],
          [s * 0.07, 0.97, -0.4],
        ],
        [0.022, 0.023, 0.022],
        dark,
        18,
        12,
      );
    }
    oval(body, [0, 0.56, 0.05], [0.14, 0.19, 0.19], engine);
    oval(body, [0.13, 0.49, 0.13], [0.028, 0.1, 0.1], alloy);
    loft(
      body,
      [
        [-0.51, 0.065, 0.05, 0.91],
        [-0.35, 0.18, 0.13, 0.84],
        [-0.1, 0.16, 0.15, 0.84],
        [0.16, 0.09, 0.07, 0.9],
      ],
      paint,
      'z',
    );
    loft(
      body,
      [
        [-0.27, 0.07, 0.026, 0.965],
        [0.0, 0.105, 0.036, 0.957],
        [0.47, 0.095, 0.033, 0.97],
        [0.69, 0.045, 0.02, 1.03],
      ],
      seat,
      'z',
    );
    loft(
      body,
      [
        [0.26, 0.1, 0.02, 0.92],
        [0.49, 0.15, 0.07, 0.9],
        [0.77, 0.06, 0.027, 1.02],
      ],
      paint,
      'z',
    );
    loft(
      body,
      [
        [-1.08, 0.06, 0.016, 0.79],
        [-0.94, 0.1, 0.023, 0.85],
        [-0.65, 0.11, 0.023, 0.86],
        [-0.48, 0.05, 0.012, 0.82],
      ],
      paint,
      'z',
    );
    loft(
      body,
      [
        [0.87, 0.105, 0.024, -0.61],
        [0.92, 0.14, 0.035, -0.6],
        [1.12, 0.135, 0.025, -0.56],
        [1.18, 0.1, 0.02, -0.55],
      ],
      paint,
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
  } else {
    // Broad curved tank, twin-sided sculpted fairings, raised tail and low screen.
    loft(
      body,
      [
        [-0.52, 0.09, 0.09, 0.83],
        [-0.31, 0.23, 0.18, 0.91],
        [-0.03, 0.24, 0.14, 0.93],
        [0.21, 0.14, 0.07, 0.84],
      ],
      paint,
      'z',
    );
    for (const s of [-1, 1]) {
      fairingPanel(body, s, paint);
      const vent = loft(
        body,
        [
          [-0.4, 0.008, 0.08, 0.62],
          [-0.19, 0.013, 0.14, 0.57],
          [-0.07, 0.008, 0.07, 0.56],
        ],
        dark,
        'z',
      );
      vent.position.x = s * 0.224;
    }
    loft(
      body,
      [
        [0.09, 0.09, 0.02, 0.82],
        [0.34, 0.145, 0.035, 0.82],
        [0.55, 0.12, 0.03, 0.86],
        [0.66, 0.065, 0.02, 0.91],
      ],
      seat,
      'z',
    );
    loft(
      body,
      [
        [0.39, 0.15, 0.07, 0.79],
        [0.65, 0.12, 0.06, 0.9],
        [0.9, 0.04, 0.025, 1.04],
      ],
      paint,
      'z',
    );
    loft(
      body,
      [
        [-0.91, 0.17, 0.065, 0.98],
        [-0.76, 0.225, 0.13, 1.01],
        [-0.48, 0.2, 0.09, 0.99],
      ],
      paint,
      'z',
    );
    const screen = loft(
      body,
      [
        [-0.79, 0.09, 0.015, 1.08],
        [-0.64, 0.15, 0.02, 1.18],
        [-0.45, 0.14, 0.01, 1.2],
      ],
      material('#3b535b', 0.4, 0.17),
      'z',
    );
    screen.material.side = THREE.DoubleSide;
    for (const s of [-1, 1]) {
      rod(body, [s * 0.07, 1.04, -0.47], [s * 0.32, 0.94, -0.47], 0.017, dark);
      oval(
        body,
        [s * 0.11, 0.989, -0.914],
        [0.055, 0.022, 0.009],
        material('#d5e1d8', 0.2, 0.25),
      );
      tube(
        body,
        [
          [s * 0.18, 1.07, -0.67],
          [s * 0.27, 1.18, -0.58],
          [s * 0.38, 1.2, -0.54],
        ],
        [0.013, 0.01, 0.01],
        dark,
        12,
        10,
      );
      oval(body, [s * 0.38, 1.2, -0.54], [0.06, 0.029, 0.035], dark);
    }
    tube(
      body,
      [
        [0, 0.54, -0.84],
        [0, 0.68, -0.77],
        [0, 0.61, -0.52],
      ],
      [0.09, 0.09, 0.08],
      paint,
      20,
      16,
      0.22,
    );
    oval(body, [0, 0.5, 0.11], [0.19, 0.19, 0.2], engine);
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
  return { root, body, wheels, rider, wheelRadius: radius, rearAxle: rear };
}
function makeRider(
  parent: THREE.Object3D,
  pose: RiderPose,
  player: Player,
  products: Product[],
) {
  const rider = new THREE.Group();
  parent.add(rider);
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
  const volume = hoodie ? 1.1 : zipper ? 1.07 : 1.0;
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(...pose.hip);
  torsoGroup.rotation.x = -pose.torsoLean;
  rider.add(torsoGroup);
  const torso = loft(
    torsoGroup,
    [
      [-0.045, 0.2 * volume, 0.127 * volume, 0],
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
    const fold =
      Math.sin(y * 73 + x * 22) *
      Math.sin(y * 17) *
      0.0035 *
      (hoodie ? 1.35 : 1);
    fabric.setZ(i, z + Math.sign(z) * fold);
  }
  fabric.needsUpdate = true;
  torso.geometry.computeVertexNormals();
  loft(
    torsoGroup,
    [
      [-0.06, 0.2 * volume, 0.129 * volume, 0],
      [-0.035, 0.204 * volume, 0.131 * volume, 0],
      [-0.015, 0.203 * volume, 0.13 * volume, 0],
    ],
    cloth,
  );
  if (hoodie) {
    loft(
      torsoGroup,
      [
        [0.47, 0.11, 0.05, 0.105],
        [0.53, 0.135, 0.065, 0.11],
        [0.6, 0.115, 0.06, 0.1],
        [0.65, 0.075, 0.045, 0.073],
      ],
      cloth,
    ).name = 'folded-hood';
  }
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
    rider,
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
    if (tee) {
      const sleeveEnd = V(shoulder).lerp(V(elbow), 0.6).toArray() as Point,
        skinStart = V(shoulder).lerp(V(elbow), 0.46).toArray() as Point;
      tube(rider, [shoulder, sleeveEnd], [0.1, 0.088], cloth, 16, 20, 0.92);
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
      );
    } else
      tube(
        rider,
        [
          shoulder,
          V(shoulder).lerp(V(elbow), 0.72).toArray() as Point,
          elbow,
          V(elbow).lerp(V(wrist), 0.4).toArray() as Point,
          wrist,
        ],
        [0.098 * volume, 0.082 * volume, 0.073 * volume, 0.077 * volume, 0.045],
        upper?.handle === 'racing-zipper'
          ? sleeveMaterial(upper, player, color, side)
          : cloth,
        36,
        20,
        0.94,
        side,
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
    tube(rider, [hip, knee, ankle], [0.108, 0.096, 0.058], pants, 40, 20, 0.96);
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
  tube(
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
  makeHelmet(rider, pose.head);
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
      rider,
      new THREE.TorusGeometry(0.031, 0.005, 8, 24),
      material('#b2b8b9', 0.8, 0.25),
    );
    ring.position.set(0.2, pose.hip[1] - 0.04, pose.hip[2]);
    const tag = loft(
      rider,
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
    rider.add(group);
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
  return rider;
}

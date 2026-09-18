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

// Same adult cranium envelope as the full-face helmet. Chin and peak are
// equipment projections, not changes to the rider's head or skeleton.
const sections: [number, number, number, number][] = [
  [-0.162, 0.035, 0.218, 0.081],
  [-0.134, 0.08, 0.217, 0.107],
  [-0.1, 0.109, 0.209, 0.133],
  [-0.063, 0.123, 0.18, 0.147],
  [0, 0.127, 0.151, 0.153],
  [0.065, 0.123, 0.14, 0.14],
  [0.117, 0.096, 0.098, 0.105],
  [0.146, 0.047, 0.048, 0.052],
  [0.154, 0.002, 0.004, 0.004],
];

function shellPoint(y: number, angle: number): Point {
  const a = Math.atan2(Math.sin(angle), Math.cos(angle));
  const theta = Math.abs(a);
  let i = 1;
  while (i < sections.length - 1 && sections[i][0] < y) i++;
  const low = sections[i - 1],
    high = sections[i];
  const t = THREE.MathUtils.clamp((y - low[0]) / (high[0] - low[0]), 0, 1);
  const width = THREE.MathUtils.lerp(low[1], high[1], t);
  const depth = THREE.MathUtils.lerp(
    low[theta < Math.PI / 2 ? 2 : 3],
    high[theta < Math.PI / 2 ? 2 : 3],
    t,
  );
  let sx = Math.sin(a),
    cz = Math.cos(a);
  if (theta < Math.PI / 2) {
    const corners = [0, 0.35, 0.7, 1.13, Math.PI / 2];
    let j = 1;
    while (corners[j] < theta) j++;
    const blend = (theta - corners[j - 1]) / (corners[j] - corners[j - 1]);
    const angular = 1 - THREE.MathUtils.smoothstep(y, -0.075, 0.025);
    sx = THREE.MathUtils.lerp(
      sx,
      Math.sign(a) *
        THREE.MathUtils.lerp(
          Math.sin(corners[j - 1]),
          Math.sin(corners[j]),
          blend,
        ),
      angular,
    );
    cz = THREE.MathUtils.lerp(
      cz,
      THREE.MathUtils.lerp(
        Math.cos(corners[j - 1]),
        Math.cos(corners[j]),
        blend,
      ),
      angular,
    );
  }
  return [sx * width, y, -cz * depth + (theta < Math.PI / 2 ? -0.005 : 0.006)];
}

function shellGeometry() {
  const angles = [
    ...new Set([
      ...Array.from({ length: 64 }, (_, i) => -Math.PI + (i * Math.PI) / 32),
      ...[-1, 1].flatMap((side) =>
        [0.14, 0.35, 0.56, 0.7, 1.13, 1.35, 1.73].map((a) => a * side),
      ),
    ]),
  ].sort((a, b) => a - b);
  const outer: Point[] = [],
    faces: number[] = [];
  const count = angles.length,
    rows = 12;
  for (let row = 0; row < rows; row++)
    for (const a of angles) {
      const corner = THREE.MathUtils.smoothstep(Math.abs(a), 0.35, 1.13);
      const lower = -0.073 + 0.041 * corner;
      const upper = 0.065 - 0.019 * corner;
      const bottom = -0.13 - 0.031 * Math.exp(-((a / 0.47) ** 2));
      const y =
        row <= 4
          ? THREE.MathUtils.lerp(bottom, lower, [0, 0.23, 0.49, 0.74, 1][row])
          : row === 5
            ? upper
            : THREE.MathUtils.lerp(
                upper,
                0.154,
                [0.17, 0.37, 0.57, 0.75, 0.9, 1][row - 6],
              );
      outer.push(shellPoint(y, a));
    }
  for (let row = 0; row < rows - 1; row++)
    for (let j = 0; j < count; j++) {
      const next = (j + 1) % count;
      const mid = j === count - 1 ? Math.PI : (angles[j] + angles[next]) / 2;
      const theta = Math.abs(mid);
      const aperture = row === 4 && theta < 1.13;
      const browVent = row === 6 && theta > 0.35 && theta < 0.56;
      const cheekVent = row === 1 && theta > 1.35 && theta < 1.73;
      const chinVent = row === 1 && theta < 0.14;
      if (aperture || browVent || cheekVent || chinVent) continue;
      const a = row * count + j,
        b = (row + 1) * count + j;
      const c = row * count + next,
        d = (row + 1) * count + next;
      faces.push(a, b, c, c, b, d);
    }
  const crown = outer.length;
  outer.push([0, 0.154, 0.003]);
  for (let j = 0; j < count; j++)
    faces.push(
      crown,
      (rows - 1) * count + ((j + 1) % count),
      (rows - 1) * count + j,
    );
  const inner = outer.map(
    ([x, y, z]): Point => [x * 0.958, y * 0.976, (z - 0.003) * 0.965 + 0.003],
  );
  return thickGeometry(outer, faces, inner);
}

function addPeak(
  parent: THREE.Object3D,
  finishes: THREE.MeshStandardMaterial[],
) {
  // A molded three-point peak: a narrow crown root opens into swept wings,
  // then tapers to a downturned nose. The temple roots close the side supports;
  // the crown behind them stays visible instead of wearing a rectangular roof.
  const sections: [number, number, number][] = [[-0.037,0.017,0.15],[-0.066,0.029,0.144],[-0.103,0.054,0.138],[-0.145,0.091,0.132],[-0.181,0.115,0.128],[-0.217,0.12,0.124],[-0.253,0.108,0.116],[-0.282,0.086,0.105],[-0.302,0.064,0.092]];
  const columns = [
    -1, -0.87, -0.68, -0.56, -0.4, -0.26, -0.12, 0, 0.12, 0.26, 0.4, 0.56, 0.68,
    0.87, 1,
  ];
  const pointAt = (row: number, u: number): Point => {
    const [z, width, height] = sections[row];
    const progress = row / (sections.length - 1);
    const across = Math.abs(u);
    const spine =
      0.01 *
      Math.max(0, 1 - across / 0.26) *
      Math.sin(progress * Math.PI * 0.9);
    const channel =
      0.0032 *
      Math.max(0, 1 - Math.abs(across - 0.56) / 0.2) *
      Math.sin(progress * Math.PI);
    // A shallow central edge meets swept, clipped corners. Separate shoulder
    // planes and a molded center rib keep the upper surface from reading flat.
    const corner =
      across <= 0.68
        ? (0.006 * across) / 0.68
        : 0.006 + (0.026 * (across - 0.68)) / 0.32;
    return [
      width * u,
      height +
        spine -
        channel -
        (0.0012 + 0.0048 * Math.sin((progress * Math.PI) / 2)) * u * u,
      z + corner * progress * progress,
    ];
  };
  const outer: Point[] = [],
    faces: number[] = [];
  const rows = sections.length - 1,
    cols = columns.length - 1;
  for (let i = 0; i <= rows; i++)
    for (const u of columns) outer.push(pointAt(i, u));
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      // Two actual relief openings flank the small crown spine. Their finite
      // dark inner walls remain visible from above, as on the reference peak.
      const midpoint = Math.abs((columns[j] + columns[j + 1]) / 2);
      if ((i === 2 || i === 3) && midpoint > 0.26 && midpoint < 0.56) continue;
      const a = i * (cols + 1) + j,
        b = a + cols + 1;
      faces.push(a, a + 1, b, a + 1, b + 1, b);
    }
  addMesh(
    parent,
    thickGeometry(
      outer,
      faces,
      outer.map(([x, y, z]): Point => [x, y - 0.004, z]),
    ),
    finishes,
    'motocross-peak',
  );
  for (const side of [-1, 1]) {
    const start = shellPoint(0.104, side * 1.13);
    const tab: Point[] = [
      shellPoint(0.089, side * 1.13),
      shellPoint(0.111, side * 1.13),
      // Follow the exact outer grid edge, with no diagonal cutting through
      // the top panel or leaving a slit between the peak and its side mount.
      pointAt(2, side),
      pointAt(3, side),
      pointAt(4, side),
      pointAt(5, side),
      [side * 0.111, 0.093, -0.151],
      [side * 0.107, 0.089, -0.078],
    ];
    const tabFaces: number[] = [];
    for (let i = 1; i < tab.length - 1; i++)
      tabFaces.push(...(side > 0 ? [0, i + 1, i] : [0, i, i + 1]));
    addMesh(
      parent,
      thickGeometry(
        tab,
        tabFaces,
        tab.map(([x, y, z]): Point => [x - side * 0.004, y, z]),
      ),
      finishes,
      'peak-temple-mount',
    );
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.007, 0.016, 16),
      finishes[2],
    );
    bolt.rotation.z = Math.PI / 2;
    bolt.position.set(start[0] + side * 0.003, 0.104, start[2]);
    bolt.name = 'peak-pivot-bolt';
    parent.add(bolt);
  }
}

function addRearRidge(
  parent: THREE.Object3D,
  finishes: THREE.MeshStandardMaterial[],
) {
  // The rear shell has a molded trailing edge, tapering into both temples.
  // Both roots lie on the existing cranium; only the equipment lip projects.
  const columns = 20,
    outer: Point[] = [],
    inner: Point[] = [],
    faces: number[] = [];
  const ray = new THREE.Raycaster();
  for (let row = 0; row < 3; row++)
    for (let column = 0; column <= columns; column++) {
      const u = column / columns,
        angle = 1.94 + u * (Math.PI * 2 - 3.88),
        taper = Math.sin(u * Math.PI);
      const center = 0.097 + 0.016 * taper,
        height = 0.12 + 0.88 * taper;
      const y =
        row === 0
          ? center + 0.011 * height
          : row === 1
            ? center
            : center - 0.014 * height;
      const p = vector(shellPoint(y, angle));
      const normal = new THREE.Vector3(p.x, 0, p.z - 0.006).normalize();
      // Match the actual triangulated shell, including its crown facets.
      ray.set(p.clone().addScaledVector(normal, 0.04), normal.clone().negate());
      const shell = ray.intersectObject(parent, false)[0];
      if (shell) p.copy(shell.point);
      const projection = row === 1 ? 0.018 * taper : -0.003;
      outer.push(
        p.clone().addScaledVector(normal, projection).toArray() as Point,
      );
      inner.push(p.addScaledVector(normal, -0.004).toArray() as Point);
    }
  for (let row = 0; row < 2; row++)
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column,
        b = a + columns + 1;
      faces.push(a, a + 1, b, a + 1, b + 1, b);
    }
  addMesh(
    parent,
    thickGeometry(outer, faces, inner),
    finishes,
    'motocross-rear-ridge',
  );
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
    color: '#2697cc',
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

function addStrap(
  parent: THREE.Object3D,
  trim: THREE.MeshStandardMaterial,
  foam: THREE.MeshStandardMaterial,
) {
  const outer: Point[] = [],
    inner: Point[] = [],
    faces: number[] = [];
  const steps = 64;
  for (let i = 0; i <= steps; i++)
    for (const y of [-0.022, 0.024]) {
      const angle = 1.13 + (i / steps) * (Math.PI * 2 - 2.26);
      const p = vector(shellPoint(y, angle));
      const normal = new THREE.Vector3(p.x, 0, p.z - 0.003).normalize();
      inner.push(p.clone().addScaledVector(normal, 0.0025).toArray() as Point);
      outer.push(p.addScaledVector(normal, 0.005).toArray() as Point);
    }
  for (let i = 0; i < steps; i++) {
    const a = i * 2,
      b = a + 2;
    faces.push(a, a + 1, b, b, a + 1, b + 1);
  }
  addMesh(
    parent,
    thickGeometry(outer, faces, inner),
    [foam, foam, trim],
    'goggle-strap',
  );
  for (const side of [-1, 1]) {
    const temple = vector(shellPoint(0.002, side * 1.13));
    temple.addScaledVector(
      new THREE.Vector3(temple.x, 0, temple.z).normalize(),
      0.0035,
    );
    const front = new THREE.Vector3(side * 0.103, 0.003, -0.096);
    const direction = temple.clone().sub(front);
    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.042, direction.length() + 0.008),
      trim,
    );
    bracket.position.copy(front).add(temple).multiplyScalar(0.5);
    bracket.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      direction.normalize(),
    );
    bracket.name = 'goggle-strap-outrigger';
    bracket.castShadow = true;
    parent.add(bracket);
  }
}

/** Unposed local equipment. The existing vehicle caller owns center, common
 * scale 1.065, head rotation and animation; no rider dimensions are changed. */
export function createMotocrossHelmet(color: string): HelmetMesh {
  const shell = material(color, 0.14, 0.36);
  const foam = material('#13191b', 0, 0.94);
  const trim = material('#252e32', 0.25, 0.5);
  const helmet = new THREE.Mesh(shellGeometry(), [shell, foam, trim]);
  helmet.name = 'motocross-helmet';
  helmet.userData.helmetStyle = 'motocross';
  helmet.castShadow = helmet.receiveShadow = true;
  addPeak(helmet, [shell, foam, trim]);
  addRearRidge(helmet, [shell, foam, trim]);
  addGoggles(helmet, trim, foam);
  addStrap(helmet, trim, foam);
  return helmet;
}

import * as THREE from 'three';

type Point = [number, number, number];
type Surface = (u: number, v: number) => THREE.Vector3;
const vector = (p: Point) => new THREE.Vector3(...p);
function mesh(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
) {
  const result = new THREE.Mesh(geometry, material);
  result.name = name;
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}
/** Moulded skin with an inner surface and closed edge returns. */
function panel(
  parent: THREE.Object3D,
  name: string,
  point: Surface,
  material: THREE.Material,
  thickness = 0.006,
) {
  const rows = 24,
    cols = 24,
    count = (rows + 1) * (cols + 1);
  const vertices: number[] = [],
    indices: number[] = [];
  for (let layer = 0; layer < 2; layer++)
    for (let row = 0; row <= rows; row++)
      for (let col = 0; col <= cols; col++) {
        const u = col / cols,
          v = row / rows,
          p = point(u, v);
        const du = point(Math.min(1, u + 0.001), v).sub(
          point(Math.max(0, u - 0.001), v),
        );
        const dv = point(u, Math.min(1, v + 0.001)).sub(
          point(u, Math.max(0, v - 0.001)),
        );
        if (layer) p.addScaledVector(du.cross(dv).normalize(), -thickness);
        vertices.push(...p.toArray());
      }
  for (let layer = 0; layer < 2; layer++)
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const a = layer * count + row * (cols + 1) + col,
          b = a + cols + 1;
        if (layer) indices.push(a, b, a + 1, b, b + 1, a + 1);
        else indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
  const edge: number[] = [];
  for (let col = 0; col < cols; col++) edge.push(col);
  for (let row = 0; row < rows; row++) edge.push(row * (cols + 1) + cols);
  for (let col = cols; col > 0; col--) edge.push(rows * (cols + 1) + col);
  for (let row = rows; row > 0; row--) edge.push(row * (cols + 1));
  edge.forEach((a, i) => {
    const b = edge[(i + 1) % edge.length];
    indices.push(a, a + count, b, b, a + count, b + count);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return mesh(parent, name, geometry, material);
}
function curve(points: Point[]) {
  return new THREE.CatmullRomCurve3(
    points.map(vector),
    false,
    'catmullrom',
    0.25,
  );
}

// Built anew from the R1 reference: ram-air bridge, shoulder cowls and separate
// under-brow projectors. No geometry from the rejected one-piece nose is reused.
export function makeSportBodywork(
  parent: THREE.Object3D,
  paint: THREE.MeshStandardMaterial,
  tank?: THREE.Mesh,
) {
  const front = new THREE.Group();
  front.name = 'sport-front-assembly';
  parent.add(front);
  parent = front;
  const finish = paint.clone();
  finish.side = THREE.DoubleSide;
  const graphite = new THREE.MeshStandardMaterial({
    color: '#131b20',
    roughness: 0.47,
    metalness: 0.15,
    side: THREE.DoubleSide,
  });
  const cavity = new THREE.MeshStandardMaterial({
    color: '#060b0e',
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  const light = new THREE.MeshStandardMaterial({
    color: '#d5e6f2',
    emissive: '#7391aa',
    emissiveIntensity: 0.32,
    roughness: 0.18,
  });
  const lens = new THREE.MeshPhysicalMaterial({
    color: '#839aa9',
    roughness: 0.12,
    metalness: 0.4,
    clearcoat: 1,
  });
  const hood: Surface = (u, v) => {
    const x = u * 2 - 1,
      width = 0.064 + 0.091 * Math.sin((v * Math.PI) / 2);
    return new THREE.Vector3(
      x * width,
      0.824 +
        0.176 * v +
        0.013 * (1 - v) * Math.abs(x) -
        0.012 * v * x * x +
        0.012 * Math.sin(v * Math.PI),
      -0.963 +
        0.273 * v +
        (0.036 - 0.017 * v) * Math.abs(x) -
        0.026 * Math.sin(v * Math.PI),
    );
  };
  panel(parent, 'sport-ram-air-bridge', hood, finish);
  // Actual recessed mouth between the central bridge and the lower lip.
  const mouth = [
    vector([-0.078, 0.838, -0.935]),
    vector([0.078, 0.838, -0.935]),
    vector([0.055, 0.765, -0.909]),
    vector([-0.055, 0.765, -0.909]),
  ];
  const vertices: number[] = [],
    indices: number[] = [];
  for (let ring = 0; ring < 2; ring++)
    mouth.forEach((p) =>
      vertices.push(
        p.x * (1 - ring * 0.18),
        p.y + ring * 0.007,
        p.z + ring * 0.085,
      ),
    );
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    indices.push(i, j, i + 4, j, j + 4, i + 4);
  }
  indices.push(4, 5, 6, 4, 6, 7);
  const intake = new THREE.BufferGeometry();
  intake.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  intake.setIndex(indices);
  intake.computeVertexNormals();
  mesh(parent, 'sport-ram-air-duct', intake, cavity);
  panel(
    parent,
    'sport-intake-lower-lip',
    (u, v) =>
      new THREE.Vector3(
        (u * 2 - 1) * (0.058 + 0.005 * v),
        0.765 - 0.013 * v,
        -0.909 + 0.042 * v,
      ),
    graphite,
  );
  for (const side of [-1, 1]) {
    const shoulder = curve([
      [0.236, 0.879, -0.824],
      [0.256, 0.925, -0.747],
      [0.243, 0.969, -0.624],
    ]);
    panel(
      parent,
      'sport-shoulder-cowl',
      (u, v) => {
        const p = hood(1, v).lerp(shoulder.getPoint(v), u);
        p.y += 0.014 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
        p.z -= 0.014 * Math.sin(u * Math.PI);
        p.x *= side;
        return p;
      },
      finish,
    );
    const center = new THREE.Vector3(side * 0.166, 0.797, -0.852);
    const rim = (angle: number, radius: number) =>
      new THREE.Vector3(
        center.x + side * Math.cos(angle) * radius * 0.033,
        center.y + Math.sin(angle) * radius * 0.028,
        center.z + Math.cos(angle) * 0.012 + Math.sin(angle) * 0.008,
      );
    const cheek = new THREE.CatmullRomCurve3(
      [
        vector([0.239, 0.809, -0.797]),
        vector([0.237, 0.884, -0.831]),
        vector([0.102, 0.85, -0.923]),
        vector([0.09, 0.752, -0.876]),
        vector([0.222, 0.748, -0.795]),
      ],
      true,
      'catmullrom',
      0.12,
    );
    panel(
      parent,
      'sport-projector-surround',
      (u, v) => {
        const outer = cheek.getPoint(u);
        outer.x *= side;
        return rim(u * Math.PI * 2, 1).lerp(outer, v);
      },
      graphite,
      0.004,
    );
    panel(
      parent,
      'sport-projector-recess',
      (u, v) => {
        const p = rim(u * Math.PI * 2, 1 - v * 0.13);
        p.z += v * 0.047;
        return p;
      },
      cavity,
      0.003,
    );
    const housing = mesh(
      parent,
      'sport-projector-housing',
      new THREE.CylinderGeometry(0.024, 0.026, 0.025, 32),
      graphite,
    );
    housing.rotation.x = Math.PI / 2;
    housing.position.copy(center).add(new THREE.Vector3(0, 0, 0.036));
    const glass = mesh(
      parent,
      'sport-projector-lens',
      new THREE.SphereGeometry(1, 32, 20),
      lens,
    );
    glass.position.copy(center).add(new THREE.Vector3(0, 0, 0.015));
    glass.scale.set(0.022, 0.021, 0.01);
    const brow = curve([
      [side * 0.094, 0.847, -0.926],
      [side * 0.162, 0.862, -0.879],
      [side * 0.235, 0.891, -0.831],
    ]);
    mesh(
      parent,
      'sport-running-light-recess',
      new THREE.TubeGeometry(brow, 32, 0.01, 8, false),
      graphite,
    );
    const lightCurve = new THREE.CatmullRomCurve3(
      brow.getPoints(24).map((p) => p.add(new THREE.Vector3(0, 0, -0.004))),
    );
    mesh(
      parent,
      'sport-running-light',
      new THREE.TubeGeometry(lightCurve, 32, 0.004, 8, false),
      light,
    );
    // One continuous side shell shares the whole shoulder boundary. Its lower
    // return bends beneath the motor, with a distinct moulded character ridge.
    const topRear = curve([
      [0.243, 0.969, -0.624],
      [0.247, 0.921, -0.43],
      [0.223, 0.798, -0.16],
      [0.175, 0.64, 0.1],
      [0.151, 0.34, 0.22],
    ]);
    const lower = curve([
      [0.222, 0.748, -0.795],
      [0.219, 0.66, -0.527],
      [0.157, 0.237, -0.328],
      [0.155, 0.193, -0.055],
      [0.151, 0.207, 0.15],
      [0.151, 0.265, 0.22],
    ]);
    const outerSkin: Surface = (u, v) => {
      const top =
        v < 0.24
          ? shoulder.getPoint(v / 0.24)
          : topRear.getPoint((v - 0.24) / 0.76);
      const bottom = lower.getPoint(v);
      const p = top.lerp(bottom, u);
      const crown =
        Math.sin(u * Math.PI) * (0.017 + 0.014 * Math.sin(v * Math.PI));
      p.x += crown;
      p.z -= 0.022 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
      p.x *= side;
      return p;
    };
    const sideShell = panel(
      parent,
      'sport-continuous-side-shell',
      (u, v) => outerSkin(u * 0.68, v),
      finish,
    );
    panel(
      parent,
      'sport-lower-fairing-return',
      (u, v) => outerSkin(0.68 + u * 0.32, v),
      graphite,
    );
    if (tank) {
      // Join the real tank equator to the existing fairing edge. Sampling both
      // boundaries keeps the knee recess closed when the tank profile changes.
      const positions = tank.geometry.getAttribute('position');
      const fairingPositions = sideShell.geometry.getAttribute('position');
      const tankEdge: THREE.Vector3[] = [];
      for (let row = 0; row < positions.count / 33; row++)
        tankEdge.push(
          new THREE.Vector3().fromBufferAttribute(
            positions,
            row * 33 + (side > 0 ? 16 : 0),
          ),
        );
      const flankRows = Array.from({ length: 25 }, (_, row) => {
        const edgeRow = (0.24 + 0.76 * (0.38 + (row / 24) * 0.39)) * 24;
        const edgeIndex = Math.floor(edgeRow);
        const bottom = new THREE.Vector3()
          .fromBufferAttribute(fairingPositions, edgeIndex * 25)
          .lerp(
            new THREE.Vector3().fromBufferAttribute(
              fairingPositions,
              (edgeIndex + 1) * 25,
            ),
            edgeRow - edgeIndex,
          );
        const index = Math.max(
          1,
          tankEdge.findIndex((p) => p.z >= bottom.z),
        );
        const before = tankEdge[index - 1],
          after = tankEdge[index];
        const top = before
          .clone()
          .lerp(
            after,
            THREE.MathUtils.clamp(
              (bottom.z - before.z) / (after.z - before.z),
              0,
              1,
            ),
          );
        return { top, bottom };
      });
      panel(
        parent,
        'sport-tank-fairing-flank',
        (u, v) => {
          const row = Math.min(23, Math.floor(v * 24)),
            blend = v * 24 - row;
          const top = flankRows[row].top
            .clone()
            .lerp(flankRows[row + 1].top, blend);
          const bottom = flankRows[row].bottom
            .clone()
            .lerp(flankRows[row + 1].bottom, blend);
          const p = top.lerp(bottom, u);
          p.x += side * 0.003 * Math.sin(u * Math.PI);
          return p;
        },
        finish,
        0.004,
      );
    }
    // A formed air scoop with a recessed throat sits within the fairing surface.
    const scoopEdge = (u: number, v: number) =>
      outerSkin(0.19 + u * 0.22, 0.36 + v * 0.3 + u * 0.12);
    panel(
      parent,
      'sport-side-scoop',
      (u, v) => {
        const p = scoopEdge(u, v);
        p.x += side * (0.003 + 0.02 * Math.sin(u * Math.PI));
        return p;
      },
      graphite,
      0.003,
    );
    for (const t of [0.43, 0.72]) {
      const screw = mesh(
        parent,
        'sport-fairing-fastener',
        new THREE.SphereGeometry(0.004, 10, 8),
        graphite,
      );
      screw.position
        .copy(outerSkin(0.58, t))
        .add(new THREE.Vector3(side * 0.004, 0, 0));
    }
    const cockpitOuter = curve([
      [0.243, 0.969, -0.624],
      [0.244, 0.931, -0.466],
      [0.218, 0.863, -0.284],
    ]);
    const cockpitInner = curve([
      [0.154, 0.988, -0.671],
      [0.158, 0.969, -0.518],
      [0.16, 0.91, -0.3],
    ]);
    panel(
      parent,
      'sport-cockpit-rim',
      (u, v) => {
        const p = cockpitOuter.getPoint(v).lerp(cockpitInner.getPoint(v), u);
        p.x *= side;
        return p;
      },
      graphite,
    );
  }
  // Continue the cowl's rearward tangent into a low smoked screen. Its lower
  // edge must not kick upright against the flowing nose/shoulder silhouette.
  const screen: Surface = (u, v) => {
    const x = u * 2 - 1;
    return new THREE.Vector3(
      x * (0.12 + 0.011 * Math.sin(v * Math.PI) - 0.018 * v),
      1.002 + 0.18 * v - 0.024 * x * x * v - 0.008 * x * x,
      -0.708 +
        0.3 * v +
        (0.025 + 0.015 * v) * x * x +
        0.025 * Math.sin(v * Math.PI),
    );
  };
  panel(
    parent,
    'sport-smoked-windscreen',
    screen,
    new THREE.MeshPhysicalMaterial({
      color: '#222a31',
      transparent: true,
      opacity: 0.6,
      roughness: 0.22,
      metalness: 0,
      clearcoat: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    0.002,
  );
  const border = [
    ...Array.from({ length: 25 }, (_, i) => screen(0, i / 24)),
    ...Array.from({ length: 24 }, (_, i) => screen((i + 1) / 24, 1)),
    ...Array.from({ length: 24 }, (_, i) => screen(1, 1 - (i + 1) / 24)),
  ];
  mesh(
    parent,
    'sport-screen-binding',
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(border),
      72,
      0.0025,
      6,
      false,
    ),
    graphite,
  );
  for (const side of [-1, 1])
    for (const t of [0.06, 0.45]) {
      const bolt = mesh(
        parent,
        'sport-screen-fastener',
        new THREE.SphereGeometry(0.004, 10, 8),
        graphite,
      );
      bolt.position
        .copy(screen(side < 0 ? 0.015 : 0.985, t))
        .add(new THREE.Vector3(0, 0, -0.003));
    }
  // Keep the compact cowl's overhang short relative to the front wheel. Shape
  // the complete assembled nose together, including recessed optics and
  // screen, so shared panel edges cannot separate when setting its overhang.
  for (const child of front.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    child.updateMatrix();
    child.geometry.applyMatrix4(child.matrix);
    child.position.set(0, 0, 0);
    child.rotation.set(0, 0, 0);
    child.scale.set(1, 1, 1);
    const positions = child.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const z = positions.getZ(i);
      if (z < -0.624) positions.setZ(i, -0.624 + (z + 0.624) * 0.7);
    }
    child.geometry.computeVertexNormals();
  }
}

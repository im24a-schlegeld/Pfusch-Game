import * as THREE from 'three';

type PixelPoint = [number, number];
type Point = [number, number, number];

// Calibration taken from the supplied clean side reference (image 3):
// rear axle = (258,445), front axle = (998,445), wheelbase = 1405 mm,
// ground line = y 605. This keeps the fairing/tank/tail silhouette tied to
// the actual motorcycle instead of hand-waving the proportions.
const PX_PER_METRE = 740 / 1.405;
const REF_REAR_X = 258;
const REF_GROUND_Y = 605;

function refYZ([x, y]: PixelPoint) {
  return {
    z: 0.685 - (x - REF_REAR_X) / PX_PER_METRE,
    y: (REF_GROUND_Y - y) / PX_PER_METRE,
  };
}

function mesh(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
) {
  geometry.computeVertexNormals();
  const result = new THREE.Mesh(geometry, material);
  result.name = name;
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

/** Thin real body panel at one side of the motorcycle, traced in side elevation. */
function tracedPanel(
  parent: THREE.Object3D,
  name: string,
  side: -1 | 1,
  outline: PixelPoint[],
  outerX: number,
  material: THREE.Material,
  thickness = 0.006,
) {
  const shape = outline.map((point) => {
    const { y, z } = refYZ(point);
    return new THREE.Vector2(z, y);
  });
  const triangles = THREE.ShapeUtils.triangulateShape(shape, []);
  const vertices: number[] = [];
  const indices: number[] = [];
  const x0 = side * outerX;
  const x1 = side * (outerX - thickness);

  for (const x of [x0, x1]) {
    for (const point of outline) {
      const { y, z } = refYZ(point);
      vertices.push(x, y, z);
    }
  }
  const count = outline.length;
  for (const [a, b, c] of triangles) {
    if (side > 0) indices.push(a, b, c, a + count, c + count, b + count);
    else indices.push(a, c, b, a + count, b + count, c + count);
  }
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    indices.push(i, j, i + count, j, j + count, i + count);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return mesh(parent, name, geometry, material);
}

function mirroredPanels(
  parent: THREE.Object3D,
  name: string,
  outline: PixelPoint[],
  outerX: number,
  material: THREE.Material,
  thickness = 0.006,
) {
  return ([-1, 1] as const).map((side) =>
    tracedPanel(parent, name, side, outline, outerX, material, thickness),
  );
}

/** Closed center bridge, used where the left/right plastics actually meet. */
function bridge(
  parent: THREE.Object3D,
  name: string,
  stations: Array<{ p: PixelPoint; halfWidth: number; halfHeight: number }>,
  material: THREE.Material,
) {
  const sides = 18;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const station of stations) {
    const { y, z } = refYZ(station.p);
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      vertices.push(
        Math.sin(a) * station.halfWidth,
        y + Math.cos(a) * station.halfHeight,
        z,
      );
    }
  }
  const stride = sides + 1;
  for (let row = 0; row < stations.length - 1; row++) {
    for (let i = 0; i < sides; i++) {
      const a = row * stride + i;
      const b = a + stride;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return mesh(parent, name, geometry, material);
}

function windscreenSurface(parent: THREE.Object3D, material: THREE.Material) {
  const rows = 12;
  const cols = 18;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    const root = refYZ([884, 192]);
    const top = refYZ([943, 48]);
    const centerY = THREE.MathUtils.lerp(root.y, top.y, v);
    const centerZ = THREE.MathUtils.lerp(root.z, top.z, v) + 0.018 * Math.sin(v * Math.PI);
    const half = THREE.MathUtils.lerp(0.105, 0.055, v);
    for (let col = 0; col <= cols; col++) {
      const u = col / cols;
      const x = (u * 2 - 1) * half;
      vertices.push(x, centerY - 0.012 * x * x / (half * half), centerZ + 0.02 * (x / half) ** 2);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = row * (cols + 1) + col;
      const b = a + cols + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return mesh(parent, 'sport-smoked-windscreen', geometry, material);
}

export function makeSportBodywork(
  parent: THREE.Object3D,
  paint: THREE.MeshStandardMaterial,
  tank?: THREE.Mesh,
) {
  void tank;
  const front = new THREE.Group();
  front.name = 'sport-front-assembly';
  parent.add(front);

  const finish = paint.clone();
  finish.side = THREE.DoubleSide;
  finish.roughness = Math.min(0.38, finish.roughness);

  const dark = new THREE.MeshStandardMaterial({
    color: '#101518',
    roughness: 0.5,
    metalness: 0.16,
    side: THREE.DoubleSide,
  });
  const cavity = new THREE.MeshStandardMaterial({
    color: '#030607',
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const lens = new THREE.MeshPhysicalMaterial({
    color: '#c9d6dc',
    transparent: true,
    opacity: 0.72,
    roughness: 0.08,
    metalness: 0.12,
    clearcoat: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const screen = new THREE.MeshPhysicalMaterial({
    color: '#11171b',
    transparent: true,
    opacity: 0.62,
    roughness: 0.16,
    clearcoat: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // Major painted silhouette. Each side is a thin moulded panel, not a solid blob.
  const upperFairing: PixelPoint[] = [
    [548, 290], [656, 239], [809, 193], [930, 194], [1009, 224],
    [992, 246], [910, 232], [767, 251], [644, 292], [566, 324],
  ];
  const mainFairing: PixelPoint[] = [
    [515, 327], [614, 273], [758, 233], [918, 237], [992, 255],
    [956, 284], [882, 313], [838, 351], [805, 402], [773, 454],
    [727, 438], [686, 395], [630, 356], [573, 349],
  ];
  const lowerFairing: PixelPoint[] = [
    [451, 520], [474, 474], [523, 437], [574, 417], [631, 409],
    [694, 410], [748, 429], [785, 466], [811, 520],
  ];
  mirroredPanels(front, 'sport-upper-fairing', upperFairing, 0.205, finish);
  mirroredPanels(front, 'sport-continuous-side-shell', mainFairing, 0.195, finish);
  mirroredPanels(front, 'sport-lower-fairing-return', lowerFairing, 0.165, finish);

  // The front cowl is a compact center volume. Side panels meet it cleanly.
  bridge(
    front,
    'sport-ram-air-bridge',
    [
      { p: [1068, 219], halfWidth: 0.082, halfHeight: 0.055 },
      { p: [1020, 197], halfWidth: 0.165, halfHeight: 0.092 },
      { p: [948, 152], halfWidth: 0.182, halfHeight: 0.12 },
      { p: [884, 178], halfWidth: 0.17, halfHeight: 0.105 },
    ],
    finish,
  );

  // Sharp Yamaha-style headlamp pockets, no round cartoon eyes.
  const lampPocket: PixelPoint[] = [
    [884, 193], [936, 166], [1005, 185], [1042, 216], [1011, 221],
    [955, 208], [896, 213],
  ];
  const lampLens: PixelPoint[] = [
    [946, 181], [999, 190], [1028, 211], [1000, 208], [962, 198],
  ];
  mirroredPanels(front, 'sport-projector-surround', lampPocket, 0.184, dark, 0.004);
  mirroredPanels(front, 'sport-projector-lens', lampLens, 0.188, lens, 0.003);

  // Center ram-air mouth is truly recessed.
  const mouthOuter: PixelPoint[] = [[1044, 211], [1070, 219], [1062, 239], [1035, 230]];
  const mouthInner: PixelPoint[] = [[1048, 216], [1064, 221], [1059, 232], [1041, 228]];
  mirroredPanels(front, 'sport-intake-lower-lip', mouthOuter, 0.07, dark, 0.004);
  mirroredPanels(front, 'sport-ram-air-duct', mouthInner, 0.068, cavity, 0.012);

  // Real side vents copied from the reference silhouette.
  mirroredPanels(
    front,
    'sport-side-scoop',
    [[651, 292], [728, 260], [850, 235], [911, 238], [837, 260], [755, 294]],
    0.198,
    cavity,
    0.006,
  );
  mirroredPanels(
    front,
    'sport-lower-side-vent',
    [[752, 350], [807, 321], [853, 316], [818, 351], [789, 378]],
    0.194,
    cavity,
    0.006,
  );

  windscreenSurface(front, screen);

  // Screen binding only; deliberately no mirrors or mirror stalks.
  for (const side of [-1, 1] as const) {
    const points = [
      new THREE.Vector3(side * 0.105, refYZ([884, 192]).y, refYZ([884, 192]).z),
      new THREE.Vector3(side * 0.08, refYZ([910, 116]).y, refYZ([910, 116]).z),
      new THREE.Vector3(side * 0.055, refYZ([943, 48]).y, refYZ([943, 48]).z),
    ];
    mesh(
      front,
      'sport-screen-binding',
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 18, 0.0025, 6),
      dark,
    );
  }
}

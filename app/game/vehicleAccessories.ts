import { headerBagMaterial } from './headerBag';
import * as THREE from 'three';
import type { Player, Product } from '../domain/types';
import {
  createCarriedCapMotion,
  type CarriedCapMotionInput,
} from './carriedCapMotion';
type Point = [number, number, number];
const up = new THREE.Vector3(0, 1, 0);

// Controllers are registered during construction and invoked after the rider pose.
// This does not invent an extra property on the shared cap-motion input.
type CrossbodyController = {
  update(input: CarriedCapMotionInput, dt: number): void;
};
const crossbodyControllers = new WeakMap<THREE.Object3D, CrossbodyController>();
const crossbodyDispatch = new WeakMap<THREE.Object3D, CrossbodyController[]>();
export function updateCrossbodyMotion(
  root: THREE.Object3D,
  input: CarriedCapMotionInput,
  dt: number,
) {
  let controllers = crossbodyDispatch.get(root);
  if (!controllers) {
    controllers = [];
    root.traverse((object) => {
      const controller = crossbodyControllers.get(object);
      if (controller) controllers!.push(controller);
    });
    crossbodyDispatch.set(root, controllers);
  }
  for (const controller of controllers) controller.update(input, dt);
}

function finish(color: string, metalness = 0, roughness = 0.85) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}
function put(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  name: string,
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function bar(
  parent: THREE.Object3D,
  a: Point,
  b: Point,
  r: number,
  m: THREE.Material,
  name: string,
) {
  const start = new THREE.Vector3(...a),
    end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const o = put(
    parent,
    new THREE.CylinderGeometry(r, r, delta.length(), 12),
    m,
    name,
  );
  o.position.copy(start).lerp(end, 0.5);
  o.quaternion.setFromUnitVectors(up, delta.normalize());
  return o;
}
/** A flat, closed fabric ribbon. Constant width, stable frame, no round cord. */
export function strapGeometry(
  points: Point[],
  width = 0.027,
  thickness = 0.0022,
  fit?: (point: THREE.Vector3, t: number, edge?: boolean) => THREE.Vector3,
) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    false,
    'centripetal',
  );
  const positions: number[] = [],
    indices: number[] = [],
    uvs: number[] = [];
  const previous = new THREE.Vector3(1, 0, 0);
  const segments = 112;
  const centers = Array.from({ length: segments + 1 }, (_, i) => {
    const point = curve.getPoint(i / segments);
    return fit ? fit(point, i / segments) : point;
  });
  for (let i = 0; i <= segments; i++) {
    const t = i / segments,
      p = centers[i];
    const tangent = centers[Math.min(segments, i + 1)]
      .clone()
      .sub(centers[Math.max(0, i - 1)])
      .normalize();
    const shoulder = THREE.MathUtils.smoothstep(p.y, 0.52, 0.598);
    const normal = new THREE.Vector3(
      p.x * 0.6,
      shoulder * 2.5,
      p.z / 0.17,
    ).normalize();
    const across = new THREE.Vector3()
      .crossVectors(tangent, normal)
      .normalize();
    if (across.lengthSq() < 0.1) across.copy(previous);
    if (i && across.dot(previous) < 0) across.negate();
    previous.copy(across);
    const out = new THREE.Vector3().crossVectors(across, tangent).normalize();
    for (const [side, depth] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const v = p
        .clone()
        .addScaledVector(across, (side * width) / 2)
        .addScaledVector(out, (depth * thickness) / 2);
      fit?.(v, t, true);
      positions.push(v.x, v.y, v.z);
      uvs.push((side + 1) / 2, t);
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < 4; j++) {
      const a = i * 4 + j,
        b = i * 4 + ((j + 1) % 4);
      indices.push(a, a + 4, b, b, a + 4, b + 4);
    }
  indices.push(0, 1, 2, 0, 2, 3);
  const n = segments * 4;
  indices.push(n, n + 2, n + 1, n, n + 3, n + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
/** Preserve the real logo material, but flatten the front so the print stays readable. */
export function pouchGeometry() {
  const p: number[] = [],
    uv: number[] = [],
    ix: number[] = [];
  const rows = 40,
    sides = 60;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      y = -0.114 + t * 0.228;
    const belly = Math.sin(Math.PI * t) ** 0.5;
    const taperX = 0.79 + 0.21 * belly;
    const taperZ = 0.68 + 0.32 * belly;
    for (let j = 0; j <= sides; j++) {
      const u = j / sides;
      const a = u * Math.PI * 2 - Math.PI / 2;
      const s = Math.sin(a),
        c = Math.cos(a);
      const front = Math.max(0, c);
      const back = Math.max(0, -c);
      const x = Math.sign(s) * Math.abs(s) ** 0.58 * 0.096 * taperX;
      const z =
        front * (0.028 + 0.004 * belly) - back * (0.04 + 0.004 * (1 - belly));
      p.push(x, y, z * taperZ);
      uv.push(u, t);
    }
  }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      ix.push(a, a + 1, b, b, a + 1, b + 1);
    }
  for (const r of [0, rows])
    for (let j = 1; j < sides - 1; j++) {
      const k = r * (sides + 1);
      if (!r) ix.push(k, k + j + 1, k + j);
      else ix.push(k, k + j, k + j + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}
/** Fit the middle of the strap to the actual garment, not a fixed shirt radius.
 * Local-to-world ray tests also handle a leaning rider and the folded hood.
 * The ends stay at the real pouch lugs, so there is no floating attachment. */
function garmentClearance(torso: THREE.Group) {
  const garment = torso.getObjectByName('tailored-garment') as
    | THREE.Mesh
    | undefined;
  const position = garment?.geometry.getAttribute('position');
  const rings: { y: number; width: number; depth: number }[] = [];
  if (position)
    for (let start = 0; start < position.count; start += 25) {
      let y = 0,
        width = 0,
        depth = 0;
      for (let j = 0; j < 25 && start + j < position.count; j++) {
        y += position.getY(start + j) / 25;
        width = Math.max(width, Math.abs(position.getX(start + j)));
        depth = Math.max(depth, Math.abs(position.getZ(start + j)));
      }
      rings.push({ y, width, depth });
    }
  // Garment-local envelope stays fixed while the rider leans. It excludes the
  // hood deliberately: a crossbody strap is allowed to pass underneath it.
  return (point: THREE.Vector3, clearance = 0.0035) => {
    if (!rings.length || point.y < rings[0].y || point.y > rings.at(-1)!.y)
      return point;
    let high = 1;
    while (high < rings.length - 1 && rings[high].y < point.y) high++;
    const a = rings[high - 1],
      b = rings[high];
    const width = Math.max(a.width, b.width) + clearance,
      depth = Math.max(a.depth, b.depth) + clearance;
    const radial = Math.hypot(point.x / width, point.z / depth);
    if (radial > 1e-8 && radial < 1) {
      point.x /= radial;
      point.z /= radial;
    }
    return point;
  };
}
function garmentStrapFit(
  torso: THREE.Group,
  clear: ReturnType<typeof garmentClearance>,
) {
  const surfaces = ['tailored-garment', 'stand-collar']
    .map((name) => torso.getObjectByName(name))
    .filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
  torso.updateWorldMatrix(true, true);
  const inverse = torso.matrixWorld.clone().invert();
  const ray = new THREE.Raycaster();
  return (point: THREE.Vector3, t: number, edge = false) => {
    if (edge) return clear(point);
    const blend =
      THREE.MathUtils.smoothstep(t, 0.035, 0.14) *
      (1 - THREE.MathUtils.smoothstep(t, 0.86, 0.965));
    if (!blend || !surfaces.length) return clear(point);
    const radial = new THREE.Vector3(point.x, 0, point.z).normalize();
    if (radial.lengthSq() < 0.5) return point;
    const origin = radial
      .clone()
      .multiplyScalar(0.85)
      .setY(point.y)
      .applyMatrix4(torso.matrixWorld);
    const target = new THREE.Vector3(0, point.y, 0).applyMatrix4(
      torso.matrixWorld,
    );
    ray.set(origin, target.sub(origin).normalize());
    const hit = ray.intersectObjects(surfaces, false)[0];
    if (!hit) return clear(point);
    const surface = hit.point
      .clone()
      .applyMatrix4(inverse)
      .addScaledVector(radial, 0.0045);
    return clear(point.lerp(surface, blend));
  };
}
export function addCleanCrossbody(torso: THREE.Group) {
  const cloth = finish('#1b1c1f'),
    seam = finish('#2f3134'),
    hardware = finish('#595e63', 0.7, 0.3);
  const group = new THREE.Group();
  group.name = 'crossbody-assembly-v43';
  torso.add(group);
  const pivot = new THREE.Group();
  pivot.name = 'crossbody-hanging-pivot';
  // The strap descends to the outer hip. Its attachment is below the hem,
  // leaving the pouch free to hang beneath its lugs instead of at the armpit.
  const mount = new THREE.Vector3(0.3, -0.055, 0.16);
  pivot.position.copy(mount);
  group.add(pivot);
  const bag = new THREE.Group();
  bag.name = 'carried-crossbody-bag';
  bag.position.set(0, -0.102, 0);
  bag.rotation.set(0.08, 0.06, -0.12);
  pivot.add(bag);
  const body = put(bag, pouchGeometry(), cloth, 'crossbody-pouch');
  body.scale.set(0.94, 0.98, 0.86);
  const logoMat = headerBagMaterial('/branding/pfusch-logo.png');
  const logo = put(
    bag,
    new THREE.PlaneGeometry(0.118, 0.058),
    logoMat,
    'crossbody-logo-front',
  );
  logo.position.set(0, -0.004, 0.03);
  logo.renderOrder = 2;
  const lugs: Point[] = [
    [-0.06, 0.09, -0.006],
    [0.056, 0.088, 0.006],
  ];
  for (const p of lugs) {
    const lug = put(
      bag,
      new THREE.TorusGeometry(0.0102, 0.0021, 8, 16, Math.PI * 1.8),
      hardware,
      'crossbody-strap-ring',
    );
    lug.position.set(...p);
    lug.rotation.y = Math.PI / 2;
  }
  const motion = createCarriedCapMotion(pivot);
  const clear = garmentClearance(torso);
  const point = new THREE.Vector3(),
    outside = mount.clone().setY(0).normalize();
  const candidate = new THREE.Vector3();
  const bagMatrix = new THREE.Matrix4();
  const updateBag = () => {
    pivot.position.copy(mount);
    pivot.updateMatrix();
    bag.updateMatrix();
    bagMatrix.multiplyMatrices(pivot.matrix, bag.matrix);
    // A hanging bag can touch fabric, but cannot swing through the torso.
    let offset = 0;
    for (const x of [-0.09, 0, 0.09])
      for (const y of [-0.112, 0.0, 0.112])
        for (const z of [-0.04, 0.034]) {
          point.set(x, y, z).applyMatrix4(bagMatrix);
          candidate.copy(point);
          clear(candidate, 0.009);
          offset = Math.max(offset, candidate.sub(point).length());
        }
    pivot.position.addScaledVector(outside, offset * 1.5);
    pivot.updateMatrix();
    bagMatrix.multiplyMatrices(pivot.matrix, bag.matrix);
  };
  updateBag();
  const left = new THREE.Vector3(...lugs[0])
    .applyMatrix4(bagMatrix)
    .toArray() as Point;
  const right = new THREE.Vector3(...lugs[1])
    .applyMatrix4(bagMatrix)
    .toArray() as Point;
  const strap = put(
    group,
    strapGeometry(
      [
        left,
        [0.218, 0.145, -0.08],
        [0.004, 0.328, -0.154],
        [-0.108, 0.442, -0.154],
        [-0.145, 0.508, -0.112],
        [-0.146, 0.556, -0.034],
        [-0.142, 0.548, 0.072],
        [-0.078, 0.466, 0.154],
        [0.075, 0.285, 0.176],
        right,
      ],
      0.022,
      0.0021,
      garmentStrapFit(torso, clear),
    ),
    cloth,
    'crossbody-flat-strap',
  );
  const zip = new THREE.CatmullRomCurve3(
    [
      [-0.062, 0.071, -0.021],
      [0, 0.077, -0.028],
      [0.06, 0.071, -0.021],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  );
  put(
    bag,
    new THREE.TubeGeometry(zip, 28, 0.00145, 6, false),
    seam,
    'crossbody-zipper-seam',
  );
  const pull = put(
    bag,
    new THREE.TorusGeometry(0.0062, 0.00115, 6, 12),
    hardware,
    'crossbody-zipper-pull',
  );
  pull.scale.y = 1.45;
  pull.position.set(0.046, 0.067, -0.029);
  const adjuster = put(
    group,
    new THREE.BoxGeometry(0.029, 0.0105, 0.0043),
    hardware,
    'crossbody-strap-adjuster',
  );
  const positions = strap.geometry.getAttribute('position');
  const rest = Float32Array.from(positions.array as ArrayLike<number>);
  const leftDelta = new THREE.Vector3(),
    rightDelta = new THREE.Vector3();
  const across = new THREE.Vector3(),
    tangent = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    frame = new THREE.Matrix4();
  const fitAdjuster = () => {
    const row = 98 * 4;
    adjuster.position
      .fromBufferAttribute(positions, row + 2)
      .add(point.fromBufferAttribute(positions, row + 3))
      .multiplyScalar(0.5);
    across
      .fromBufferAttribute(positions, row + 2)
      .sub(point.fromBufferAttribute(positions, row + 3))
      .normalize();
    tangent
      .fromBufferAttribute(positions, row + 6)
      .sub(point.fromBufferAttribute(positions, row - 2))
      .normalize();
    normal.crossVectors(across, tangent).normalize();
    tangent.crossVectors(normal, across).normalize();
    adjuster.position.addScaledVector(normal, 0.002);
    adjuster.quaternion.setFromRotationMatrix(
      frame.makeBasis(across, tangent, normal),
    );
  };
  fitAdjuster();
  strap.frustumCulled = false;
  const controller: CrossbodyController = {
    update(input: CarriedCapMotionInput, dt: number) {
      if (!Number.isFinite(dt) || dt <= 0 || input.paused) return;
      motion.update(input, dt);
      updateBag();
      leftDelta
        .set(...lugs[0])
        .applyMatrix4(bagMatrix)
        .sub(point.set(...left));
      rightDelta
        .set(...lugs[1])
        .applyMatrix4(bagMatrix)
        .sub(point.set(...right));
      // Keep the shoulder/chest run fitted; only the short hanging sections
      // deform. Reuse buffers and the cap's bounded fixed-step pendulum.
      for (let i = 0; i < positions.count; i++) {
        const t = Math.floor(i / 4) / 112;
        point
          .fromArray(rest, i * 3)
          .addScaledVector(
            leftDelta,
            1 - THREE.MathUtils.smoothstep(t, 0, 0.22),
          )
          .addScaledVector(rightDelta, THREE.MathUtils.smoothstep(t, 0.78, 1));
        clear(point);
        positions.setXYZ(i, point.x, point.y, point.z);
      }
      positions.needsUpdate = true;
      strap.geometry.computeVertexNormals();
      fitAdjuster();
    },
  };
  crossbodyControllers.set(group, controller);
  return controller;
}

function selectedColor(p: Product, player: Player) {
  return (
    p.preview?.colors.find((c) => c.variantIds.includes(player.variants[p.id]))
      ?.baseColor ?? p.baseColor
  );
}
/** Detailed key and fabric fob at the ignition; never attached to the rider's hip. */
export function addIgnitionKey(
  body: THREE.Group,
  player: Player,
  products: Product[],
  grip: readonly number[],
) {
  const product = products.find(
    (p) =>
      p.id === player.equipped.accessory && p.handle === 'schlusselanhanger',
  );
  if (!product) return undefined;
  const assembly = new THREE.Group();
  assembly.name = 'ignition-keychain-v38';
  body.add(assembly);
  // Chassis-local ignition mounts. The sport fob lies rearward over the tank;
  // the scooter key faces the rider from its inner leg shield, not from inside
  // the handlebar nacelle. All mounts move with the motorcycle, never the hip.
  const mounts: Record<
    string,
    { point: Point; socketPitch: number; hangPitch: number }
  > = {
    '125': { point: [-0.05, 1.17, -0.35], socketPitch: 0, hangPitch: -0.18 },
    '450': { point: [-0.055, 1.105, -0.39], socketPitch: 0, hangPitch: -0.24 },
    '701': { point: [-0.05, 1.05, -0.435], socketPitch: 0, hangPitch: -1.33 },
    scooter: {
      point: [0.075, 0.84, -0.16],
      socketPitch: Math.PI / 2,
      hangPitch: -Math.PI / 2,
    },
  };
  const mount = mounts[player.bike] ?? {
    point: [-0.055, grip[1] - 0.025, grip[2] + 0.05] as Point,
    socketPitch: 0,
    hangPitch: -0.2,
  };
  assembly.position.set(...mount.point);
  assembly.rotation.x = mount.socketPitch;
  assembly.userData.mount = 'ignition';
  const chrome = finish('#aeb5b9', 0.86, 0.25),
    black = finish('#1e2021'),
    fabric = finish(selectedColor(product, player));
  const socket = put(
    assembly,
    new THREE.CylinderGeometry(0.017, 0.019, 0.018, 20),
    black,
    'ignition-barrel',
  );
  socket.position.y = -0.009;
  const bezel = put(
    assembly,
    new THREE.TorusGeometry(0.013, 0.002, 8, 24),
    chrome,
    'ignition-bezel',
  );
  bezel.rotation.x = Math.PI / 2;
  bar(
    assembly,
    [0, -0.022, 0],
    [0.066, -0.032, 0],
    0.01,
    black,
    'ignition-clamp-mount',
  );
  const key = put(
    assembly,
    new THREE.BoxGeometry(0.006, 0.025, 0.0025),
    chrome,
    'ignition-key-blade',
  );
  key.position.y = 0.011;
  const head = put(
    assembly,
    new THREE.BoxGeometry(0.028, 0.02, 0.006),
    black,
    'ignition-key-head',
  );
  head.position.y = 0.03;
  const pivot = new THREE.Group();
  pivot.name = 'keychain-pivot';
  pivot.position.set(-0.01, 0.034, 0.003);
  pivot.rotation.set(mount.hangPitch, 0, -0.09);
  assembly.add(pivot);
  for (const z of [0, 0.0028]) {
    const ring = put(
      pivot,
      new THREE.TorusGeometry(0.022, 0.00165, 8, 36, Math.PI * 1.9),
      chrome,
      'keychain-split-ring',
    );
    ring.position.set(-0.018, -0.012, z);
    ring.rotation.z = z ? -0.15 : 0.15;
  }
  bar(
    pivot,
    [-0.025, -0.031, 0.001],
    [-0.04, -0.048, 0.001],
    0.0035,
    chrome,
    'keychain-connector',
  );
  const tag = new THREE.Group();
  tag.name = 'keychain-fabric-tag';
  pivot.add(tag);
  tag.position.set(-0.05, -0.108, 0.008);
  tag.rotation.z = -0.28;
  tag.rotation.y = -0.45;
  const outline = new THREE.Shape();
  outline.moveTo(-0.02, -0.068);
  outline.lineTo(0.018, -0.065);
  outline.quadraticCurveTo(0.025, -0.063, 0.025, -0.055);
  outline.lineTo(0.02, 0.057);
  outline.quadraticCurveTo(0.019, 0.07, 0.008, 0.072);
  outline.lineTo(-0.014, 0.07);
  outline.quadraticCurveTo(-0.026, 0.068, -0.025, 0.055);
  outline.lineTo(-0.027, -0.055);
  outline.quadraticCurveTo(-0.027, -0.064, -0.02, -0.068);
  const tagGeometry = new THREE.ExtrudeGeometry(outline, {
    depth: 0.0028,
    bevelEnabled: true,
    bevelSize: 0.001,
    bevelThickness: 0.0008,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 8,
  });
  put(tag, tagGeometry, fabric, 'keychain-fabric-body');
  for (const x of [-0.02, 0.018])
    for (let i = 0; i < 11; i++)
      bar(
        tag,
        [x, -0.053 + i * 0.01, 0.004],
        [x, -0.048 + i * 0.01, 0.004],
        0.00065,
        chrome,
        'keychain-stitch',
      );
  const eyelet = put(
    tag,
    new THREE.TorusGeometry(0.005, 0.0014, 8, 20),
    chrome,
    'keychain-eyelet',
  );
  eyelet.position.set(-0.002, 0.058, 0.003);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 512;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 128, 512);
      const map = new THREE.CanvasTexture(c);
      map.colorSpace = THREE.SRGBColorSpace;
      const print = new THREE.MeshStandardMaterial({
        map,
        transparent: true,
        alphaTest: 0.1,
        roughness: 0.96,
        side: THREE.DoubleSide,
      });
      let disposed = false;
      print.addEventListener('dispose', () => {
        disposed = true;
        map.dispose();
      });
      // Reuse the supplied real Pfusch artwork; do not imitate its lettering.
      // The headless geometry verifier intentionally has no Image implementation.
      if (typeof Image !== 'undefined') {
        const artwork = new Image();
        artwork.onload = () => {
          if (disposed) return;
          const scale = Math.min(
            390 / artwork.naturalWidth,
            90 / artwork.naturalHeight,
          );
          const w = artwork.naturalWidth * scale,
            h = artwork.naturalHeight * scale;
          ctx.save();
          ctx.translate(64, 256);
          ctx.rotate(-Math.PI / 2);
          ctx.drawImage(artwork, -w / 2, -h / 2, w, h);
          ctx.restore();
          map.needsUpdate = true;
        };
        artwork.onerror = () => {
          if (!disposed)
            console.error('Keychain brand artwork could not load.');
        };
        artwork.src = '/images/artwork/ziptie.png';
      }
      for (const z of [-0.0015, 0.0045]) {
        const ink = put(
          tag,
          new THREE.PlaneGeometry(0.03, 0.112),
          print,
          'keychain-wordmark',
        );
        ink.position.set(-0.001, -0.002, z);
        if (z < 0) ink.rotation.y = Math.PI;
      }
    }
  }
  let sway = 0,
    velocity = 0;
  return {
    update(input: CarriedCapMotionInput, dt: number) {
      if (input.paused || !Number.isFinite(dt) || dt <= 0) return;
      const step = Math.min(dt, 0.05);
      const target = input.reducedMotion
        ? 0
        : THREE.MathUtils.clamp(
            (input.longitudinalAcceleration ?? 0) * 0.018,
            -0.18,
            0.18,
          );
      velocity += (target - sway) * 28 * step;
      velocity *= Math.exp(-step * 9);
      sway += velocity * step;
      pivot.rotation.x = mount.hangPitch + sway;
      pivot.rotation.z = -0.09;
    },
  };
}

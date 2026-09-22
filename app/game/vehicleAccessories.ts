import { headerBagMaterial } from './headerBag';
import { keychainFaceMaterial } from './keychainArtwork';
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
  return (point: THREE.Vector3, clearance = 0.0035, preserveX = false) => {
    // At the shoulder the actual posed sleeve/torso collider is authoritative.
    // The last torso ring has a hard upper bound and would otherwise kick the
    // ribbon sideways immediately before that ring ends.
    if (point.y >= 0.54) return point;
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
      if (preserveX)
        point.z = Math.sign(point.z || 1) *
          Math.sqrt(Math.max(0, 1 - (point.x / width) ** 2)) * depth;
      else {
        point.x /= radial;
        point.z /= radial;
      }
    }
    return point;
  };
}
function garmentStrapFit(
  torso: THREE.Group,
  clear: ReturnType<typeof garmentClearance>,
  rearEnd: Point,
) {
  const surfaces = ['tailored-garment', 'stand-collar']
    .map((name) => torso.getObjectByName(name))
    .filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
  torso.updateWorldMatrix(true, true);
  const inverse = torso.matrixWorld.clone().invert();
  const ray = new THREE.Raycaster();
  return (point: THREE.Vector3, t: number, edge = false) => {
    const rear = t >= 0.7;
    const front = t >= 0.2 && t <= 0.5;
    if (edge) return clear(point, 0.0035, rear || front);
    if (rear) {
      const along = (t - 0.7) / 0.3;
      point.set(
        THREE.MathUtils.lerp(-0.142, rearEnd[0], along),
        THREE.MathUtils.lerp(0.548, rearEnd[1], along),
        THREE.MathUtils.lerp(0.112, rearEnd[2], along),
      );
    }
    const blend =
      THREE.MathUtils.smoothstep(t, 0.035, 0.14) *
      (1 - THREE.MathUtils.smoothstep(t, 0.86, 0.965));
    if (!blend || !surfaces.length) return clear(point, 0.0035, rear || front);
    const radial = new THREE.Vector3(point.x, 0, point.z).normalize();
    if (radial.lengthSq() < 0.5) return point;
    if (rear || front) radial.set(0, 0, rear ? 1 : -1);
    const origin = (
      rear || front
        ? point.clone().setZ(rear ? 0.85 : -0.85)
        : radial.clone().multiplyScalar(0.85).setY(point.y)
    ).applyMatrix4(torso.matrixWorld);
    const target = new THREE.Vector3(
      rear || front ? point.x : 0,
      point.y,
      0,
    ).applyMatrix4(torso.matrixWorld);
    ray.set(origin, target.sub(origin).normalize());
    const hit = ray.intersectObjects(surfaces, false)[0];
    if (!hit) return clear(point, 0.0035, rear || front);
    const surface = hit.point
      .clone()
      .applyMatrix4(inverse)
      .addScaledVector(radial, 0.0045);
    // Clearance only pushes the ribbon out of the garment. Pulling an already
    // clear shoulder point inward creates a stepped tab when the ray switches
    // from the front plane to the rounded shoulder surface.
    if (front) point.z = Math.min(point.z, surface.z);
    else if (rear) point.z = Math.max(point.z, surface.z);
    else if (Math.hypot(point.x, point.z) < Math.hypot(surface.x, surface.z))
      point.lerp(surface, blend);
    return clear(point, 0.0035, rear || front);
  };
}

/** A small posed shoulder collider, excluding the hood. Skin each candidate
 * vertex once per update; ribbon samples then share the resulting plain mesh. */
function shoulderStrapClearance(torso: THREE.Group) {
  const source = (
    torso.parent?.getObjectsByProperty('name', 'garment-sleeve') ?? []
  ).filter(
    (mesh): mesh is THREE.SkinnedMesh => mesh instanceof THREE.SkinnedMesh,
  );
  const point = new THREE.Vector3(),
    inverse = new THREE.Matrix4(),
    transform = new THREE.Matrix4();
  torso.updateWorldMatrix(true, true);
  inverse.copy(torso.matrixWorld).invert();
  const sleeves = source.flatMap((mesh) => {
    const positions = mesh.geometry.getAttribute('position'),
      indices = mesh.geometry.getIndex();
    if (!indices) return [];
    transform.multiplyMatrices(inverse, mesh.matrixWorld);
    const selected: number[] = [];
    for (let i = 0; i < indices.count; i += 3) {
      let near = false;
      for (let j = 0; j < 3; j++) {
        point
          .fromBufferAttribute(positions, indices.getX(i + j))
          .applyMatrix4(transform);
        if (point.x < -0.08 && point.x > -0.24 && point.y > 0.4) near = true;
      }
      if (near)
        selected.push(
          indices.getX(i),
          indices.getX(i + 1),
          indices.getX(i + 2),
        );
    }
    if (!selected.length) return [];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        new Float32Array(positions.count * 3),
        3,
      ),
    );
    geometry.setIndex(selected);
    const collider = new THREE.Mesh(geometry, mesh.material);
    collider.updateMatrixWorld(true);
    return [{ mesh, collider, vertices: [...new Set(selected)] }];
  });
  const surfaces: THREE.Mesh[] = [];
  for (const name of ['tailored-garment', 'stand-collar']) {
    const mesh = torso.getObjectByName(name);
    if (mesh instanceof THREE.Mesh) {
      const copy = new THREE.Mesh(mesh.geometry, mesh.material);
      copy.updateMatrixWorld(true);
      surfaces.push(copy);
    }
  }
  surfaces.push(...sleeves.map((s) => s.collider));
  const ray = new THREE.Raycaster(),
    origin = new THREE.Vector3(),
    down = new THREE.Vector3(0, -1, 0);
  const refresh = () => {
    torso.parent?.updateWorldMatrix(true, true);
    inverse.copy(torso.matrixWorld).invert();
    for (const { mesh, collider, vertices } of sleeves) {
      // SkinnedMesh updates its attached bind inverse in updateMatrixWorld;
      // Object3D.updateWorldMatrix alone leaves the previous frame's inverse.
      mesh.updateMatrixWorld(true);
      mesh.skeleton.update();
      transform.multiplyMatrices(inverse, mesh.matrixWorld);
      const position = collider.geometry.getAttribute('position');
      for (const i of vertices) {
        mesh.getVertexPosition(i, point).applyMatrix4(transform);
        position.setXYZ(i, point.x, point.y, point.z);
      }
      collider.geometry.computeBoundingSphere();
    }
  };
  const fit = (point: THREE.Vector3) => {
    if (point.y < 0.46 || point.y > 0.7) return point;
    ray.set(origin.copy(point).setY(0.9), down);
    const hit = ray.intersectObjects(surfaces, false)[0];
    if (hit) point.y = Math.max(point.y, hit.point.y + 0.005);
    return point;
  };
  refresh();
  torso.addEventListener('removed', () => {
    for (const s of sleeves) s.collider.geometry.dispose();
  });
  return { refresh, fit };
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
  // At rest the pouch lies against the lower back. Its upper side rings form
  // the hinge; gravity can lift the bottom away from the back during a wheelie.
  // Bottom = .180 - .088 - .114*.98 = -.01972: the upper rear hem seam.
  const mount = new THREE.Vector3(0.07, 0.18, 0.183);
  pivot.position.copy(mount);
  group.add(pivot);
  const bag = new THREE.Group();
  bag.name = 'carried-crossbody-bag';
  bag.position.set(0, -0.088, 0);
  pivot.add(bag);
  const body = put(bag, pouchGeometry(), cloth, 'crossbody-pouch');
  body.scale.set(0.94, 0.98, 0.86);
  const logoMat = headerBagMaterial('/branding/pfusch-logo.webp');
  const logo = put(
    bag,
    new THREE.PlaneGeometry(0.118, 0.058),
    logoMat,
    'crossbody-logo-front',
  );
  logo.position.set(0, -0.004, 0.03);
  logo.renderOrder = 2;
  const lugs: Point[] = [
    [0.084, 0.088, 0],
    [-0.084, 0.088, 0],
  ];
  for (const p of lugs) {
    const lug = put(
      bag,
      new THREE.TorusGeometry(0.0102, 0.0021, 8, 16, Math.PI * 1.8),
      hardware,
      'crossbody-strap-ring',
    );
    lug.position.set(...p);
  }
  const motion = createCarriedCapMotion(pivot);
  const hangingDown = new THREE.Vector3(),
    down = new THREE.Vector3(0, -1, 0);
  const backContact = () => {
    hangingDown.copy(down).applyQuaternion(pivot.quaternion);
    // Leaning forward presses the bag onto the back, instead of allowing the
    // gravity solver to rotate it through the rider. Away from the back it is
    // the unmodified cap pendulum, including lateral and landing impulses.
    if (hangingDown.z < 0) {
      hangingDown.z = 0;
      pivot.quaternion.setFromUnitVectors(down, hangingDown.normalize());
    }
  };
  backContact();
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
  const shoulderClearance = shoulderStrapClearance(torso);
  const fitStrap = garmentStrapFit(torso, clear, right);
  const strap = put(
    group,
    strapGeometry(
      [
        left,
        [0.232, 0.265, 0.03],
        [0.17, 0.29, -0.112],
        [0.065, 0.385, -0.154],
        [-0.04, 0.48, -0.154],
        [-0.145, 0.575, -0.075],
        [-0.147, 0.605, 0.035],
        [-0.142, 0.548, 0.112],
        [-0.078, 0.466, 0.154],
        [-0.045, 0.36, 0.176],
        right,
      ],
      0.022,
      0.0021,
      (point, t, edge) => shoulderClearance.fit(fitStrap(point, t, edge)),
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
      backContact();
      updateBag();
      leftDelta
        .set(...lugs[0])
        .applyMatrix4(bagMatrix)
        .sub(point.set(...left));
      rightDelta
        .set(...lugs[1])
        .applyMatrix4(bagMatrix)
        .sub(point.set(...right));
      shoulderClearance.refresh();
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
          .addScaledVector(rightDelta, Math.max(0, (t - 0.7) / 0.3));
        clear(point, 0.0035, t >= 0.7 || (t >= 0.2 && t <= 0.5));
        shoulderClearance.fit(point);
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

/** Locate the actual chassis surface so an ignition never floats beside it. */
function ignitionMount(body: THREE.Group, bike: string, grip: readonly number[]) {
  body.updateWorldMatrix(true, true);
  if (bike === 'scooter') {
    const shell = body.getObjectByName('scooter-leg-shield');
    const origin = body.localToWorld(new THREE.Vector3(0.135, 0.86, 0.3));
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(body.matrixWorld);
    const hit = shell ? new THREE.Raycaster(origin, direction).intersectObject(shell)[0] : undefined;
    const support = hit
      ? body.worldToLocal(hit.point.clone())
      : new THREE.Vector3(0.135, 0.86, -0.452);
    return {
      support,
      point: support.clone().add(new THREE.Vector3(0, 0, 0.012)),
      socketPitch: Math.PI / 2,
      surface: 'scooter-leg-shield',
    };
  }
  const stem = body.getObjectByName('handlebar-stem');
  const yokes = body.getObjectsByProperty('name', 'fork-yoke');
  const supportMesh = stem ?? yokes.sort((a, b) => b.position.y - a.position.y)[0];
  const support = supportMesh
    ? body.worldToLocal(supportMesh.getWorldPosition(new THREE.Vector3()))
    : new THREE.Vector3(0, grip[1] - 0.055, grip[2] - 0.075);
  // A short visible bracket joins the barrel to the existing stem/top yoke.
  // The position follows authored handlebars without changing the rider grip.
  return {
    support,
    point: support.clone().add(new THREE.Vector3(-0.045, 0.025, 0.032)),
    socketPitch: 0,
    surface: supportMesh?.name ?? 'handlebar-support',
  };
}

/** Both authentic mockup faces hang from a visible, chassis-mounted key. */
export function addIgnitionKey(
  body: THREE.Group,
  player: Player,
  products: Product[],
  grip: readonly number[],
) {
  const selected = player.equipped.keychain ?? player.equipped.accessory;
  const product = products.find(
    (p) => p.id === selected && p.handle === 'schlusselanhanger',
  );
  if (!product) return undefined;
  const mount = ignitionMount(body, player.bike, grip);
  const assembly = new THREE.Group();
  assembly.name = 'ignition-keychain-v38';
  assembly.position.copy(mount.point);
  assembly.rotation.x = mount.socketPitch;
  assembly.userData.mount = 'ignition';
  assembly.userData.supportSurface = mount.surface;
  assembly.userData.supportPoint = mount.support.toArray();
  body.add(assembly);
  const chrome = finish('#aeb5b9', 0.86, 0.25),
    black = finish('#1e2021'),
    ringMetal = finish('#17191a', 0.7, 0.35),
    fabric = finish('#161718');
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
  const support = mount.support.clone().sub(mount.point)
    .applyQuaternion(assembly.quaternion.clone().invert());
  bar(assembly, support.toArray() as Point, [0, -0.014, 0], 0.007,
    black, 'ignition-clamp-mount');
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
  pivot.rotation.y = player.bike === 'scooter' ? -0.25 : 0.28;
  assembly.add(pivot);
  for (const z of [0, 0.0028]) {
    const ring = put(
      pivot,
      new THREE.TorusGeometry(0.021, 0.00165, 8, 32, Math.PI * 1.9),
      ringMetal,
      'keychain-split-ring',
    );
    ring.position.set(-0.015, -0.011, z);
    ring.rotation.z = z ? -0.15 : 0.15;
  }
  bar(pivot, [-0.03, -0.026, 0.002], [-0.033, -0.041, 0.006],
    0.002, ringMetal, 'keychain-connector');
  const tag = new THREE.Group();
  tag.name = 'keychain-fabric-tag';
  tag.position.set(-0.033, -0.112, 0.006);
  pivot.add(tag);
  const outline = new THREE.Shape();
  outline.moveTo(-0.019, -0.08);
  outline.lineTo(0.019, -0.08);
  outline.quadraticCurveTo(0.023, -0.08, 0.023, -0.076);
  outline.lineTo(0.023, 0.076);
  outline.quadraticCurveTo(0.023, 0.08, 0.019, 0.08);
  outline.lineTo(-0.019, 0.08);
  outline.quadraticCurveTo(-0.023, 0.08, -0.023, 0.076);
  outline.lineTo(-0.023, -0.076);
  outline.quadraticCurveTo(-0.023, -0.08, -0.019, -0.08);
  put(tag, new THREE.ExtrudeGeometry(outline, {
    depth: 0.0028,
    bevelEnabled: true,
    bevelSize: 0.0008,
    bevelThickness: 0.0005,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 6,
  }), fabric, 'keychain-fabric-body');
  const eyelet = put(tag,
    new THREE.TorusGeometry(0.004, 0.001, 6, 16),
    ringMetal, 'keychain-eyelet');
  eyelet.position.set(0, 0.071, 0.003);
  for (const side of ['front', 'back'] as const) {
    const face = put(tag, new THREE.PlaneGeometry(0.045, 0.1575),
      keychainFaceMaterial(side), `keychain-mockup-${side}`);
    face.position.z = side === 'front' ? 0.0036 : -0.0008;
    if (side === 'back') face.rotation.y = Math.PI;
  }
  // The same bounded, fixed-step gravity/acceleration/landing pendulum as caps.
  // Only this dedicated pivot rotates; the key, socket and attachment stay fixed.
  return createCarriedCapMotion(pivot);
}
